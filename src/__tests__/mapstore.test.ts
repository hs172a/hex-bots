import { describe, test, expect, beforeEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MapStore } from "../mapstore.js";

// ── Helpers ────────────────────────────────────────────────────

/** Create a fresh MapStore starting from an empty state. */
function freshStore(): MapStore {
  const store = new MapStore();
  store.clearAll(); // wipe any on-disk state
  return store;
}

/** Build a minimal bootstrap JSON payload. */
function bootstrapJson(systems: Array<{ id: string; name: string; connections?: string[] }>): string {
  return JSON.stringify({
    _fetched: new Date().toISOString(),
    systems: systems.map(s => ({
      id: s.id,
      name: s.name,
      connections: (s.connections ?? []).map(cid => ({ system_id: cid, system_name: cid })),
      pois: [],
    })),
  });
}

/** Write bootstrap JSON to a temp file and return its path. */
function writeTempBootstrap(
  systems: Array<{ id: string; name: string; connections?: string[] }>,
): string {
  const dir = join(tmpdir(), `mapstore-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "bootstrap.json");
  writeFileSync(file, bootstrapJson(systems));
  return file;
}

// ── seedFromBootstrapFile ─────────────────────────────────────

describe("mapStore: seedFromBootstrapFile", () => {
  let store: MapStore;
  beforeEach(() => { store = freshStore(); });

  test("returns 0 when file does not exist", () => {
    expect(store.seedFromBootstrapFile("/nonexistent/path/bootstrap.json")).toBe(0);
  });

  test("inserts new systems from file", () => {
    const file = writeTempBootstrap([
      { id: "sys_a", name: "Alpha" },
      { id: "sys_b", name: "Beta" },
    ]);
    const inserted = store.seedFromBootstrapFile(file);
    expect(inserted).toBe(2);
    expect(store.getSystemCount()).toBe(2);
  });

  test("skips already-known systems (non-destructive)", () => {
    store.updateSystem({ id: "sys_a", name: "Alpha", connections: [], pois: [] });
    const file = writeTempBootstrap([
      { id: "sys_a", name: "Alpha Renamed" }, // already known
      { id: "sys_b", name: "Beta" },           // new
    ]);
    const inserted = store.seedFromBootstrapFile(file);
    expect(inserted).toBe(1); // only Beta is new
    expect(store.getSystemCount()).toBe(2);
    // Alpha's name should NOT be overwritten
    expect(store.getSystem("sys_a")?.name).toBe("Alpha");
  });

  test("returns 0 on empty systems array", () => {
    const dir = join(tmpdir(), `mapstore-test-empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "empty.json");
    writeFileSync(file, JSON.stringify({ systems: [] }));
    expect(store.seedFromBootstrapFile(file)).toBe(0);
  });

  test("returns 0 on malformed JSON", () => {
    const dir = join(tmpdir(), `mapstore-test-bad-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "bad.json");
    writeFileSync(file, "NOT VALID JSON {{{}");
    expect(store.seedFromBootstrapFile(file)).toBe(0);
  });

  test("seeds connections correctly for pathfinding", () => {
    const file = writeTempBootstrap([
      { id: "sys_a", name: "Alpha", connections: ["sys_b"] },
      { id: "sys_b", name: "Beta",  connections: ["sys_a", "sys_c"] },
      { id: "sys_c", name: "Gamma", connections: ["sys_b"] },
    ]);
    store.seedFromBootstrapFile(file);
    const route = store.findRoute("sys_a", "sys_c");
    expect(route).toEqual(["sys_a", "sys_b", "sys_c"]);
  });
});

// ── getSystemCount ────────────────────────────────────────────

describe("mapStore: getSystemCount", () => {
  let store: MapStore;
  beforeEach(() => { store = freshStore(); });

  test("returns 0 for empty store", () => {
    expect(store.getSystemCount()).toBe(0);
  });

  test("increments after updateSystem", () => {
    store.updateSystem({ id: "sys_x", name: "X", connections: [], pois: [] });
    expect(store.getSystemCount()).toBe(1);
    store.updateSystem({ id: "sys_y", name: "Y", connections: [], pois: [] });
    expect(store.getSystemCount()).toBe(2);
  });

  test("does not double-count duplicate upserts", () => {
    store.updateSystem({ id: "sys_x", name: "X", connections: [], pois: [] });
    store.updateSystem({ id: "sys_x", name: "X Updated", connections: [], pois: [] });
    expect(store.getSystemCount()).toBe(1);
  });

  test("resets to 0 after clearAll", () => {
    store.updateSystem({ id: "sys_x", name: "X", connections: [], pois: [] });
    store.clearAll();
    expect(store.getSystemCount()).toBe(0);
  });
});

// ── findRoute (BFS pathfinding) ───────────────────────────────

describe("mapStore: findRoute", () => {
  let store: MapStore;

  beforeEach(() => {
    store = freshStore();
    // Linear chain: A → B → C → D
    store.updateSystem({ id: "A", name: "Alpha", connections: [{ system_id: "B", system_name: "Beta" }], pois: [] });
    store.updateSystem({ id: "B", name: "Beta",  connections: [{ system_id: "A", system_name: "Alpha" }, { system_id: "C", system_name: "Gamma" }], pois: [] });
    store.updateSystem({ id: "C", name: "Gamma", connections: [{ system_id: "B", system_name: "Beta" }, { system_id: "D", system_name: "Delta" }], pois: [] });
    store.updateSystem({ id: "D", name: "Delta", connections: [{ system_id: "C", system_name: "Gamma" }], pois: [] });
  });

  test("same system returns single-element path", () => {
    expect(store.findRoute("A", "A")).toEqual(["A"]);
  });

  test("direct neighbor returns 2-hop path", () => {
    expect(store.findRoute("A", "B")).toEqual(["A", "B"]);
  });

  test("finds shortest path through chain", () => {
    expect(store.findRoute("A", "D")).toEqual(["A", "B", "C", "D"]);
  });

  test("returns null for unconnected system", () => {
    store.updateSystem({ id: "Z", name: "Zeta", connections: [], pois: [] });
    expect(store.findRoute("A", "Z")).toBeNull();
  });

  test("returns null when destination does not exist in store", () => {
    expect(store.findRoute("A", "UNKNOWN")).toBeNull();
  });

  test("reverse path works (bidirectional)", () => {
    const route = store.findRoute("D", "A");
    expect(route).toEqual(["D", "C", "B", "A"]);
  });

  test("prefers shorter path over longer (diamond topology)", () => {
    // A connects to both B and C; B and C both connect to D
    // Shortest path: A → B → D  or  A → C → D (both length 3)
    store.clearAll();
    store.updateSystem({ id: "A", name: "A", connections: [{ system_id: "B", system_name: "B" }, { system_id: "C", system_name: "C" }], pois: [] });
    store.updateSystem({ id: "B", name: "B", connections: [{ system_id: "A", system_name: "A" }, { system_id: "D", system_name: "D" }], pois: [] });
    store.updateSystem({ id: "C", name: "C", connections: [{ system_id: "A", system_name: "A" }, { system_id: "D", system_name: "D" }], pois: [] });
    store.updateSystem({ id: "D", name: "D", connections: [{ system_id: "B", system_name: "B" }, { system_id: "C", system_name: "C" }], pois: [] });
    const route = store.findRoute("A", "D");
    expect(route).not.toBeNull();
    expect(route!.length).toBe(3); // A → (B or C) → D
    expect(route![0]).toBe("A");
    expect(route![route!.length - 1]).toBe("D");
  });

  test("route is cached on second call", () => {
    const r1 = store.findRoute("A", "D");
    const r2 = store.findRoute("A", "D");
    expect(r1).toEqual(r2);
  });
});
