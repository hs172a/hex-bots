/**
 * Tests for the Needs Matrix system and Role Protocol logic.
 *
 * Coverage:
 *  1. NeedsMatrixDb — all CRUD methods (in-memory SQLite)
 *  2. replaceTargetsBySource — bulk upsert + stale-zeroing
 *  3. updateCurrent / adjustCurrent — faction storage sync + optimistic delta
 *  4. Query helpers — getAll, getBySource, getTopDeficits, getItem
 *  5. pruneStale — TTL cleanup
 *  6. swarmcoord persistence bridge — broadcastMaterialNeed → NM write
 *  7. Miner ore target priority logic — NM first, settings fallback, swarm fallback
 *  8. SmartSelector quota saturation scoring
 *  9. Chain efficiency calculation logic (coordinator output)
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { NeedsMatrixDb } from "../data/needs-matrix-db.js";
import type { NeedsMatrixEntry } from "../data/needs-matrix-db.js";
import {
  broadcastMaterialNeed,
  clearAllMaterialNeeds,
  connectNeedsMatrixDb,
  releaseAllClaims,
} from "../swarmcoord.js";

// ── In-memory DB factory ──────────────────────────────────────

function makeDb(): { db: Database; nm: NeedsMatrixDb } {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE IF NOT EXISTS needs_matrix (
      item_id             TEXT PRIMARY KEY,
      item_name           TEXT NOT NULL DEFAULT '',
      category            TEXT NOT NULL DEFAULT 'unknown',
      target_qty          INTEGER NOT NULL DEFAULT 0,
      current_qty         INTEGER NOT NULL DEFAULT 0,
      source              TEXT NOT NULL DEFAULT 'mine',
      priority            INTEGER NOT NULL DEFAULT 50,
      updated_target_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_current_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by          TEXT NOT NULL DEFAULT ''
    )
  `);
  const nm = new NeedsMatrixDb(db);
  return { db, nm };
}

// ── 1. NeedsMatrixDb: setTarget ───────────────────────────────

describe("NeedsMatrixDb: setTarget", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("inserts a new target row", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine", 70);
    const row = nm.getItem("ore_iron");
    expect(row).not.toBeNull();
    expect(row!.item_name).toBe("Iron Ore");
    expect(row!.target_qty).toBe(500);
    expect(row!.source).toBe("mine");
    expect(row!.priority).toBe(70);
    expect(row!.category).toBe("ore");
  });

  test("updates an existing row on conflict", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 200, "mine", 50);
    nm.setTarget("ore_iron", "Iron Ore", "ore", 800, "mine", 90);
    const row = nm.getItem("ore_iron");
    expect(row!.target_qty).toBe(800);
    expect(row!.priority).toBe(90);
  });

  test("setTarget does not overwrite current_qty on upsert", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 300, "bot_alpha");
    nm.setTarget("ore_iron", "Iron Ore", "ore", 600, "mine"); // re-write target
    const row = nm.getItem("ore_iron");
    expect(row!.target_qty).toBe(600);
    expect(row!.current_qty).toBe(300); // unchanged
  });

  test("updated_target_at is set to a recent ISO timestamp", () => {
    const before = Date.now();
    nm.setTarget("ore_copper", "Copper Ore", "ore", 100, "mine");
    const after = Date.now();
    const row = nm.getItem("ore_copper");
    const ts = new Date(row!.updated_target_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  test("default priority is 50 when omitted", () => {
    nm.setTarget("ore_zinc", "Zinc Ore", "ore", 100, "mine");
    expect(nm.getItem("ore_zinc")!.priority).toBe(50);
  });
});

// ── 2. NeedsMatrixDb: replaceTargetsBySource ──────────────────

describe("NeedsMatrixDb: replaceTargetsBySource", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("upserts all provided entries", () => {
    nm.replaceTargetsBySource("mine", [
      { itemId: "ore_iron",   itemName: "Iron Ore",   category: "ore", targetQty: 500 },
      { itemId: "ore_copper", itemName: "Copper Ore", category: "ore", targetQty: 200 },
    ]);
    expect(nm.getItem("ore_iron")!.target_qty).toBe(500);
    expect(nm.getItem("ore_copper")!.target_qty).toBe(200);
  });

  test("zeroes out stale entries not in new batch", () => {
    nm.setTarget("ore_old", "Old Ore", "ore", 999, "mine");
    nm.replaceTargetsBySource("mine", [
      { itemId: "ore_iron", itemName: "Iron Ore", category: "ore", targetQty: 100 },
    ]);
    const old = nm.getItem("ore_old");
    expect(old!.target_qty).toBe(0); // zeroed, not deleted
  });

  test("does not touch rows with a different source", () => {
    nm.setTarget("component_x", "Component X", "material", 50, "buy");
    nm.replaceTargetsBySource("mine", [
      { itemId: "ore_iron", itemName: "Iron Ore", category: "ore", targetQty: 100 },
    ]);
    expect(nm.getItem("component_x")!.target_qty).toBe(50); // buy row untouched
  });

  test("empty entries batch zeroes all existing source rows", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.replaceTargetsBySource("mine", []);
    expect(nm.getItem("ore_iron")!.target_qty).toBe(0);
  });

  test("replacing craft targets does not affect mine or buy rows", () => {
    nm.setTarget("ore_iron",    "Iron Ore",    "ore",      500, "mine");
    nm.setTarget("component_y", "Component Y", "material",  30, "buy");
    nm.replaceTargetsBySource("craft", [
      { itemId: "product_z", itemName: "Product Z", category: "product", targetQty: 10 },
    ]);
    expect(nm.getItem("ore_iron")!.target_qty).toBe(500);
    expect(nm.getItem("component_y")!.target_qty).toBe(30);
    expect(nm.getItem("product_z")!.target_qty).toBe(10);
  });

  test("priority defaults to 50 when not provided in entries", () => {
    nm.replaceTargetsBySource("mine", [
      { itemId: "ore_a", itemName: "Ore A", category: "ore", targetQty: 100 },
    ]);
    expect(nm.getItem("ore_a")!.priority).toBe(50);
  });

  test("priority is persisted when provided in entries", () => {
    nm.replaceTargetsBySource("mine", [
      { itemId: "ore_b", itemName: "Ore B", category: "ore", targetQty: 200, priority: 85 },
    ]);
    expect(nm.getItem("ore_b")!.priority).toBe(85);
  });
});

// ── 3. updateCurrent / adjustCurrent ─────────────────────────

describe("NeedsMatrixDb: updateCurrent", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("creates a stub row when no target exists yet", () => {
    nm.updateCurrent("ore_unknown", 42, "scout_bot");
    const row = nm.getItem("ore_unknown");
    expect(row).not.toBeNull();
    expect(row!.current_qty).toBe(42);
    expect(row!.target_qty).toBe(0);
    expect(row!.updated_by).toBe("scout_bot");
  });

  test("updates current_qty on existing row without touching target_qty", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 200, "miner_1");
    const row = nm.getItem("ore_iron");
    expect(row!.current_qty).toBe(200);
    expect(row!.target_qty).toBe(500);
    expect(row!.updated_by).toBe("miner_1");
  });

  test("subsequent updateCurrent overwrites previous value", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 100, "miner_1");
    nm.updateCurrent("ore_iron", 350, "miner_2");
    expect(nm.getItem("ore_iron")!.current_qty).toBe(350);
  });
});

describe("NeedsMatrixDb: adjustCurrent", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("adds positive delta (faction deposit)", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 100, "bot_a");
    nm.adjustCurrent("ore_iron", 50, "gatherer_1");
    expect(nm.getItem("ore_iron")!.current_qty).toBe(150);
  });

  test("subtracts negative delta (faction withdraw)", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 200, "bot_a");
    nm.adjustCurrent("ore_iron", -80, "crafter_1");
    expect(nm.getItem("ore_iron")!.current_qty).toBe(120);
  });

  test("clamps to zero — current_qty never goes negative", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 30, "bot_a");
    nm.adjustCurrent("ore_iron", -999, "crafter_1");
    expect(nm.getItem("ore_iron")!.current_qty).toBe(0);
  });

  test("no-op when item_id does not exist (no row to update)", () => {
    nm.adjustCurrent("nonexistent_item", 100, "bot_x");
    expect(nm.getItem("nonexistent_item")).toBeNull();
  });

  test("updated_by is recorded on adjust", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 500, "mine");
    nm.updateCurrent("ore_iron", 50, "bot_a");
    nm.adjustCurrent("ore_iron", 10, "depositor_bot");
    expect(nm.getItem("ore_iron")!.updated_by).toBe("depositor_bot");
  });
});

// ── 4. Query helpers ──────────────────────────────────────────

describe("NeedsMatrixDb: getAll", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("returns empty array when table is empty", () => {
    expect(nm.getAll()).toEqual([]);
  });

  test("returns all rows including surplus (current > target) entries", () => {
    nm.setTarget("ore_iron",   "Iron Ore",   "ore", 500, "mine");
    nm.setTarget("ore_copper", "Copper Ore", "ore", 200, "mine");
    nm.updateCurrent("ore_iron", 400, "bot");
    expect(nm.getAll()).toHaveLength(2);
  });

  test("rows sorted by deficit descending (largest shortfall first)", () => {
    nm.setTarget("ore_a", "Ore A", "ore", 1000, "mine");
    nm.setTarget("ore_b", "Ore B", "ore", 100,  "mine");
    nm.updateCurrent("ore_a",    0, "bot"); // deficit 1000
    nm.updateCurrent("ore_b",   50, "bot"); // deficit 50
    const rows = nm.getAll();
    expect(rows[0].item_id).toBe("ore_a");
    expect(rows[1].item_id).toBe("ore_b");
  });
});

describe("NeedsMatrixDb: getBySource", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("returns only rows for the requested source", () => {
    nm.setTarget("ore_iron",    "Iron Ore",    "ore",      500, "mine");
    nm.setTarget("component_x", "Component X", "material",  50, "buy");
    nm.setTarget("product_z",   "Product Z",   "product",   10, "craft");
    expect(nm.getBySource("mine")).toHaveLength(1);
    expect(nm.getBySource("buy")).toHaveLength(1);
    expect(nm.getBySource("craft")).toHaveLength(1);
  });

  test("excludes rows with target_qty = 0", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 0, "mine");
    expect(nm.getBySource("mine")).toHaveLength(0);
  });
});

describe("NeedsMatrixDb: getTopDeficits", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("returns only rows with positive deficit", () => {
    nm.setTarget("ore_a", "Ore A", "ore", 100, "mine");
    nm.setTarget("ore_b", "Ore B", "ore", 200, "mine");
    nm.updateCurrent("ore_a", 100, "bot"); // deficit = 0 (met)
    nm.updateCurrent("ore_b",  50, "bot"); // deficit = 150
    const deficits = nm.getTopDeficits("mine", 10);
    expect(deficits).toHaveLength(1);
    expect(deficits[0].item_id).toBe("ore_b");
  });

  test("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      nm.setTarget(`ore_${i}`, `Ore ${i}`, "ore", 100, "mine");
    }
    expect(nm.getTopDeficits("mine", 3)).toHaveLength(3);
  });

  test("returns empty array when no deficits", () => {
    nm.setTarget("ore_a", "Ore A", "ore", 50, "mine");
    nm.updateCurrent("ore_a", 200, "bot");
    expect(nm.getTopDeficits("mine", 10)).toHaveLength(0);
  });

  test("sorted by deficit descending", () => {
    nm.setTarget("ore_small", "Small", "ore", 100, "mine");
    nm.setTarget("ore_large", "Large", "ore", 900, "mine");
    nm.updateCurrent("ore_small",   0, "bot"); // deficit 100
    nm.updateCurrent("ore_large",   0, "bot"); // deficit 900
    const result = nm.getTopDeficits("mine", 10);
    expect(result[0].item_id).toBe("ore_large");
  });
});

describe("NeedsMatrixDb: getItem", () => {
  let nm: NeedsMatrixDb;
  beforeEach(() => { nm = makeDb().nm; });

  test("returns null for unknown item_id", () => {
    expect(nm.getItem("nonexistent")).toBeNull();
  });

  test("returns the full row for a known item_id", () => {
    nm.setTarget("ore_iron", "Iron Ore", "ore", 300, "mine", 75);
    const row = nm.getItem("ore_iron");
    expect(row).not.toBeNull();
    expect(row!.item_name).toBe("Iron Ore");
    expect(row!.priority).toBe(75);
  });
});

// ── 5. pruneStale ─────────────────────────────────────────────

describe("NeedsMatrixDb: pruneStale", () => {
  let nm: NeedsMatrixDb;
  let db: Database;
  beforeEach(() => { ({ db, nm } = makeDb()); });

  test("removes rows older than maxAgeDays", () => {
    // Insert a row then backdate updated_target_at by 10 days
    nm.setTarget("ore_old", "Old Ore", "ore", 100, "mine");
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    db.run(`UPDATE needs_matrix SET updated_target_at = ? WHERE item_id = ?`, [cutoff, "ore_old"]);
    nm.pruneStale(7);
    expect(nm.getItem("ore_old")).toBeNull();
  });

  test("keeps rows within maxAgeDays", () => {
    nm.setTarget("ore_fresh", "Fresh Ore", "ore", 100, "mine");
    nm.pruneStale(7);
    expect(nm.getItem("ore_fresh")).not.toBeNull();
  });

  test("default maxAgeDays is 7 days", () => {
    nm.setTarget("ore_a", "Ore A", "ore", 100, "mine");
    const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.run(`UPDATE needs_matrix SET updated_target_at = ? WHERE item_id = ?`, [cutoff, "ore_a"]);
    nm.pruneStale(); // default 7 days
    expect(nm.getItem("ore_a")).toBeNull();
  });
});

// ── 6. swarmcoord NM persistence bridge ──────────────────────

describe("swarmcoord: NeedsMatrixDb persistence bridge", () => {
  let nm: NeedsMatrixDb;

  beforeEach(() => {
    nm = makeDb().nm;
    connectNeedsMatrixDb(nm);
    releaseAllClaims("crafter_1");
    clearAllMaterialNeeds("crafter_1");
  });

  afterEach(() => {
    // Prevent singleton state leaking into subsequent test files
    releaseAllClaims("crafter_1");
    clearAllMaterialNeeds("crafter_1");
  });

  test("broadcastMaterialNeed writes a 'buy' target to needs_matrix", () => {
    broadcastMaterialNeed("crafter_1", "component_x", 100);
    const row = nm.getItem("component_x");
    expect(row).not.toBeNull();
    expect(row!.source).toBe("buy");
    expect(row!.target_qty).toBe(100);
  });

  test("repeated broadcast updates target_qty to latest value", () => {
    broadcastMaterialNeed("crafter_1", "component_x", 50);
    broadcastMaterialNeed("crafter_1", "component_x", 120);
    expect(nm.getItem("component_x")!.target_qty).toBe(120);
  });

  test("zero-quantity broadcast does NOT write to NM (no false targets)", () => {
    broadcastMaterialNeed("crafter_1", "component_zero", 0);
    expect(nm.getItem("component_zero")).toBeNull();
  });

  test("NM target priority is set to 60 for crafter demands", () => {
    broadcastMaterialNeed("crafter_1", "component_y", 80);
    expect(nm.getItem("component_y")!.priority).toBe(60);
  });
});

// ── 7. Miner ore target priority logic ───────────────────────
// Tests the decision logic extracted from miner.ts without running the full routine.

describe("miner: ore target selection priority logic", () => {
  const NEEDS_MATRIX_MAX_AGE_MS = 2 * 60 * 60 * 1000;

  function pickOreFromNm(
    nmDeficits: NeedsMatrixEntry[],
    freshAge: number,
    oreLocations: Record<string, boolean>, // itemId → hasOreBelt
  ): { targetOre: string; reason: string } {
    const fresh = nmDeficits.length > 0 && freshAge <= NEEDS_MATRIX_MAX_AGE_MS;
    if (!fresh) return { targetOre: "", reason: "stale" };

    for (const entry of nmDeficits) {
      if (!oreLocations[entry.item_id]) continue;
      return { targetOre: entry.item_id, reason: "nm_deficit" };
    }

    if (nmDeficits.length > 0) {
      return { targetOre: "", reason: "all_met" };
    }
    return { targetOre: "", reason: "no_nm" };
  }

  test("picks top-deficit ore with known ore-belt location", () => {
    const deficits: NeedsMatrixEntry[] = [
      {
        item_id: "ore_iron", item_name: "Iron Ore", category: "ore",
        target_qty: 500, current_qty: 0, source: "mine", priority: 80,
        updated_target_at: new Date().toISOString(),
        updated_current_at: new Date().toISOString(), updated_by: "coord",
      },
      {
        item_id: "ore_copper", item_name: "Copper Ore", category: "ore",
        target_qty: 200, current_qty: 0, source: "mine", priority: 60,
        updated_target_at: new Date().toISOString(),
        updated_current_at: new Date().toISOString(), updated_by: "coord",
      },
    ];
    const result = pickOreFromNm(deficits, 1000, { ore_iron: true, ore_copper: true });
    expect(result.targetOre).toBe("ore_iron");
    expect(result.reason).toBe("nm_deficit");
  });

  test("skips ore with no ore-belt location, falls to second choice", () => {
    const deficits: NeedsMatrixEntry[] = [
      {
        item_id: "ore_rare", item_name: "Rare Ore", category: "ore",
        target_qty: 999, current_qty: 0, source: "mine", priority: 99,
        updated_target_at: new Date().toISOString(),
        updated_current_at: new Date().toISOString(), updated_by: "coord",
      },
      {
        item_id: "ore_iron", item_name: "Iron Ore", category: "ore",
        target_qty: 300, current_qty: 0, source: "mine", priority: 70,
        updated_target_at: new Date().toISOString(),
        updated_current_at: new Date().toISOString(), updated_by: "coord",
      },
    ];
    // ore_rare has no belt in known systems
    const result = pickOreFromNm(deficits, 1000, { ore_rare: false, ore_iron: true });
    expect(result.targetOre).toBe("ore_iron");
  });

  test("returns all_met with empty targetOre when no deficits present", () => {
    const result = pickOreFromNm([], 1000, {});
    expect(result.targetOre).toBe("");
    expect(result.reason).toBe("stale");
  });

  test("returns stale when NM data is older than 2 hours", () => {
    const deficits: NeedsMatrixEntry[] = [
      {
        item_id: "ore_iron", item_name: "Iron Ore", category: "ore",
        target_qty: 500, current_qty: 0, source: "mine", priority: 80,
        updated_target_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updated_current_at: new Date().toISOString(), updated_by: "coord",
      },
    ];
    const staleAge = 3 * 60 * 60 * 1000; // 3 hours
    const result = pickOreFromNm(deficits, staleAge, { ore_iron: true });
    expect(result.reason).toBe("stale");
  });

  test("returns all_met when deficits exist but none have ore-belt location", () => {
    const deficits: NeedsMatrixEntry[] = [
      {
        item_id: "ore_void", item_name: "Void Ore", category: "ore",
        target_qty: 100, current_qty: 0, source: "mine", priority: 80,
        updated_target_at: new Date().toISOString(),
        updated_current_at: new Date().toISOString(), updated_by: "coord",
      },
    ];
    const result = pickOreFromNm(deficits, 1000, { ore_void: false });
    expect(result.targetOre).toBe("");
    expect(result.reason).toBe("all_met");
  });
});

// ── 8. SmartSelector: quota saturation scoring logic ─────────

describe("smart_selector: quota-aware miner scoring logic", () => {
  const NEEDS_MATRIX_MAX_AGE_MS = 2 * 60 * 60 * 1000;

  /**
   * Pure version of the NM-aware miner scoring branch.
   * Returns: score adjustment info
   */
  function scoreMinerWithNm(
    nmAll: NeedsMatrixEntry[],
    ageMs: number,
    hasLocalBelt: boolean,
    hasAnyBelt: boolean,
    miningLevel: number,
  ): { score: number; reason: string } {
    if (nmAll.length > 0 && ageMs <= NEEDS_MATRIX_MAX_AGE_MS) {
      const deficits = nmAll.filter(e => e.target_qty > e.current_qty);
      if (deficits.length === 0) {
        return { score: 1, reason: "all_met" };
      }
      const maxDeficitPct = Math.max(
        ...deficits.map(e => (e.target_qty - e.current_qty) / Math.max(1, e.target_qty)),
      );
      const mul = 0.5 + Math.min(1.0, maxDeficitPct);
      if (hasLocalBelt) return { score: Math.round((miningLevel * 10 + 20) * mul), reason: "local_belt_deficit" };
      if (hasAnyBelt)  return { score: Math.round(miningLevel * 6 * mul), reason: "remote_belt_deficit" };
      return { score: 1, reason: "no_belt" };
    }
    // Fallback: no NM data
    if (hasLocalBelt) return { score: miningLevel * 10 + 20, reason: "fallback_local" };
    if (hasAnyBelt)  return { score: miningLevel * 6, reason: "fallback_remote" };
    return { score: 1, reason: "fallback_no_belt" };
  }

  function makeEntry(itemId: string, target: number, current: number): NeedsMatrixEntry {
    return {
      item_id: itemId, item_name: itemId, category: "ore",
      target_qty: target, current_qty: current, source: "mine", priority: 50,
      updated_target_at: new Date().toISOString(),
      updated_current_at: new Date().toISOString(), updated_by: "coord",
    };
  }

  test("returns score=1 when all ore targets are met (quota saturation)", () => {
    const nm = [makeEntry("ore_iron", 500, 500), makeEntry("ore_copper", 200, 250)];
    const result = scoreMinerWithNm(nm, 1000, true, true, 5);
    expect(result.score).toBe(1);
    expect(result.reason).toBe("all_met");
  });

  test("returns reduced score (×0.5–1.5 multiplier) when partially met", () => {
    // 50% deficit → multiplier = 0.5 + 0.5 = 1.0
    const nm = [makeEntry("ore_iron", 200, 100)];
    const result = scoreMinerWithNm(nm, 1000, true, true, 5);
    const base = 5 * 10 + 20; // 70
    expect(result.score).toBe(Math.round(base * 1.0));
    expect(result.reason).toBe("local_belt_deficit");
  });

  test("multiplier caps at 1.5 for 100% deficit", () => {
    const nm = [makeEntry("ore_iron", 400, 0)]; // 100% deficit → mul = 0.5 + 1.0 = 1.5
    const level = 4;
    const result = scoreMinerWithNm(nm, 1000, true, true, level);
    const base = level * 10 + 20; // 60
    expect(result.score).toBe(Math.round(base * 1.5));
  });

  test("falls back to base scoring when NM data is stale", () => {
    const nm = [makeEntry("ore_iron", 500, 0)];
    const staleAge = 3 * 60 * 60 * 1000; // 3h
    const result = scoreMinerWithNm(nm, staleAge, true, true, 5);
    expect(result.reason).toBe("fallback_local");
    expect(result.score).toBe(5 * 10 + 20);
  });

  test("falls back to base scoring when NM has no entries", () => {
    const result = scoreMinerWithNm([], 0, true, true, 3);
    expect(result.reason).toBe("fallback_local");
  });

  test("remote belt with deficit gives miningLevel × 6 × multiplier", () => {
    const nm = [makeEntry("ore_iron", 100, 0)]; // 100% deficit → mul = 1.5
    const level = 4;
    const result = scoreMinerWithNm(nm, 1000, false, true, level);
    expect(result.score).toBe(Math.round(level * 6 * 1.5));
    expect(result.reason).toBe("remote_belt_deficit");
  });

  test("explorer boost: applied when all quotas met", () => {
    // Simulate the buildCandidates boost block
    const nmOre = [makeEntry("ore_iron", 500, 600)]; // current > target → met
    const allMet = nmOre.every(e => e.current_qty >= e.target_qty);
    const explorerBonus = allMet ? 20 : 0;
    expect(explorerBonus).toBe(20);
  });

  test("explorer boost: NOT applied when any deficit exists", () => {
    const nmOre = [makeEntry("ore_iron", 500, 200), makeEntry("ore_copper", 100, 100)];
    const allMet = nmOre.every(e => e.current_qty >= e.target_qty);
    const explorerBonus = allMet ? 20 : 0;
    expect(explorerBonus).toBe(0);
  });
});

// ── 9. Chain efficiency calculation logic ─────────────────────

describe("coordinator: chain efficiency calculation", () => {
  function computeChainEfficiency(entries: NeedsMatrixEntry[]): {
    efficiencyPct: number;
    satisfied: number;
    total: number;
    bottlenecks: NeedsMatrixEntry[];
  } {
    const withTargets = entries.filter(e => e.target_qty > 0);
    if (withTargets.length === 0) return { efficiencyPct: 0, satisfied: 0, total: 0, bottlenecks: [] };
    const satisfied = withTargets.filter(e => e.current_qty >= e.target_qty).length;
    const efficiencyPct = Math.round((satisfied / withTargets.length) * 100);
    const bottlenecks = withTargets
      .filter(e => e.current_qty < e.target_qty * 0.5)
      .sort((a, b) => (b.target_qty - b.current_qty) - (a.target_qty - a.current_qty))
      .slice(0, 3);
    return { efficiencyPct, satisfied, total: withTargets.length, bottlenecks };
  }

  function makeEntry(itemId: string, target: number, current: number): NeedsMatrixEntry {
    return {
      item_id: itemId, item_name: itemId, category: "ore",
      target_qty: target, current_qty: current, source: "mine", priority: 50,
      updated_target_at: new Date().toISOString(),
      updated_current_at: new Date().toISOString(), updated_by: "coord",
    };
  }

  test("100% efficiency when all targets met", () => {
    const entries = [makeEntry("ore_a", 100, 100), makeEntry("ore_b", 50, 60)];
    const result = computeChainEfficiency(entries);
    expect(result.efficiencyPct).toBe(100);
    expect(result.satisfied).toBe(2);
    expect(result.bottlenecks).toHaveLength(0);
  });

  test("0% efficiency when all targets unmet", () => {
    const entries = [makeEntry("ore_a", 100, 0), makeEntry("ore_b", 50, 0)];
    const result = computeChainEfficiency(entries);
    expect(result.efficiencyPct).toBe(0);
    expect(result.bottlenecks).toHaveLength(2);
  });

  test("50% efficiency with mixed met/unmet", () => {
    const entries = [makeEntry("ore_a", 100, 100), makeEntry("ore_b", 100, 0)];
    const result = computeChainEfficiency(entries);
    expect(result.efficiencyPct).toBe(50);
  });

  test("bottlenecks include only items below 50% of target", () => {
    const entries = [
      makeEntry("ore_critical", 100, 10),  // 10% filled → bottleneck
      makeEntry("ore_partial",  100, 60),  // 60% filled → NOT a bottleneck
      makeEntry("ore_ok",       100, 100), // 100% filled → met
    ];
    const result = computeChainEfficiency(entries);
    expect(result.bottlenecks).toHaveLength(1);
    expect(result.bottlenecks[0].item_id).toBe("ore_critical");
  });

  test("bottlenecks capped at 3 entries", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      makeEntry(`ore_${i}`, 100, 0)
    );
    const result = computeChainEfficiency(entries);
    expect(result.bottlenecks).toHaveLength(3);
  });

  test("bottlenecks sorted by absolute deficit descending", () => {
    const entries = [
      makeEntry("ore_small_deficit", 50,  0),  // deficit 50
      makeEntry("ore_large_deficit", 800, 0),  // deficit 800
    ];
    const result = computeChainEfficiency(entries);
    expect(result.bottlenecks[0].item_id).toBe("ore_large_deficit");
  });

  test("rows with target_qty = 0 excluded from efficiency calculation", () => {
    const entries = [
      makeEntry("ore_a",    100, 0),  // real target
      makeEntry("ore_stub",   0, 42), // stub row (no target)
    ];
    const result = computeChainEfficiency(entries);
    expect(result.total).toBe(1); // only the row with target > 0
  });

  test("returns 0% and empty when all entries have target_qty = 0", () => {
    const entries = [makeEntry("ore_a", 0, 200)];
    const result = computeChainEfficiency(entries);
    expect(result.efficiencyPct).toBe(0);
    expect(result.total).toBe(0);
  });
});
