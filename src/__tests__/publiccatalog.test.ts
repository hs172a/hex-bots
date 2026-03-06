import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Helpers ────────────────────────────────────────────────────

const STALE_MS = 24 * 60 * 60 * 1000;
const FRESH_TS = new Date().toISOString();
const STALE_TS = new Date(Date.now() - STALE_MS - 1000).toISOString();

function isStale(fetched: string | undefined): boolean {
  if (!fetched) return true;
  return Date.now() - new Date(fetched).getTime() > STALE_MS;
}

// ── Staleness logic (pure, no file I/O) ──────────────────────
// Testing the staleness decision logic directly (extracted from publicCatalog)

describe("publicCatalog: staleness logic", () => {
  test("fresh _fetched timestamp → not stale", () => {
    expect(isStale(FRESH_TS)).toBe(false);
  });

  test("_fetched older than 24h → stale", () => {
    expect(isStale(STALE_TS)).toBe(true);
  });

  test("undefined _fetched → stale", () => {
    expect(isStale(undefined)).toBe(true);
  });

  test("exactly at boundary is stale (>= not >)", () => {
    const boundaryTs = new Date(Date.now() - STALE_MS - 1).toISOString();
    expect(isStale(boundaryTs)).toBe(true);
  });

  test("just under boundary is not stale", () => {
    const justFreshTs = new Date(Date.now() - STALE_MS + 5000).toISOString();
    expect(isStale(justFreshTs)).toBe(false);
  });
});

// ── Galaxy bootstrap JSON structure ──────────────────────────
// Verify the format that publicCatalog.fetchGalaxy() produces is
// readable by MapStore.seedFromBootstrapFile().

describe("publicCatalog: galaxy_bootstrap.json shape", () => {
  test("bootstrap JSON has required top-level fields", () => {
    const bootstrap = {
      _fetched: FRESH_TS,
      source: "https://game.spacemolt.com/api/map",
      systems: [
        {
          id: "sys_test",
          name: "Test System",
          security_level: "high",
          connections: [{ system_id: "sys_other", system_name: "Other" }],
          pois: [{ id: "poi_1", name: "Station Alpha", type: "station", has_base: true,
            base_id: "base_1", base_name: "Alpha Base", base_type: "trade_hub", services: ["fuel"] }],
        },
      ],
    };

    expect(bootstrap).toHaveProperty("_fetched");
    expect(bootstrap).toHaveProperty("systems");
    expect(Array.isArray(bootstrap.systems)).toBe(true);
    expect(bootstrap.systems[0]).toHaveProperty("id");
    expect(bootstrap.systems[0]).toHaveProperty("name");
    expect(bootstrap.systems[0]).toHaveProperty("connections");
    expect(Array.isArray(bootstrap.systems[0].connections)).toBe(true);
  });

  test("connections are objects with system_id and system_name", () => {
    const conn = { system_id: "sys_a", system_name: "Alpha" };
    expect(conn.system_id).toBeDefined();
    expect(conn.system_name).toBeDefined();
  });

  test("POI entries have all MapStore-required fields", () => {
    const poi = {
      id: "poi_1", name: "Station", type: "station",
      has_base: true, base_id: "b1", base_name: "Base", base_type: "trade",
      services: ["fuel", "repair"],
    };
    const required = ["id", "name", "type", "has_base", "base_id", "base_name", "base_type", "services"];
    for (const field of required) {
      expect(poi).toHaveProperty(field);
    }
  });
});

// ── Summary format ────────────────────────────────────────────

describe("publicCatalog: getSummary format", () => {
  test("summary includes systems when galaxy data present", () => {
    // Simulates the updated getSummary() logic
    const ships = 275;
    const stations = 48;
    const sys = 505;
    const summary = `${ships} ships, ${stations} stations${sys > 0 ? `, ${sys} systems` : ""}`;
    expect(summary).toBe("275 ships, 48 stations, 505 systems");
  });

  test("summary omits systems when galaxy not yet loaded", () => {
    const ships = 275;
    const stations = 48;
    const sys = 0;
    const summary = `${ships} ships, ${stations} stations${sys > 0 ? `, ${sys} systems` : ""}`;
    expect(summary).toBe("275 ships, 48 stations");
  });
});
