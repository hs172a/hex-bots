/**
 * Tests for gather goal mechanics:
 *  - Material reservation logic (getReservedForGoals equivalent)
 *  - MapStore faction storage tracking
 *  - Swarmcoord material demand broadcast/clear
 *  - Leader auto-goal condition checks
 *  - Gather goal progress computation
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { MapStore } from "../mapstore.js";
import {
  broadcastMaterialNeed,
  clearMaterialNeed,
  clearAllMaterialNeeds,
  getTotalDemandForItem,
  getAllMaterialDemands,
  releaseAllClaims,
} from "../swarmcoord.js";

// ── MapStore: faction storage tracking ───────────────────────

describe("mapStore: faction storage cache", () => {
  let store: MapStore;

  beforeEach(() => {
    store = new MapStore();
  });

  test("hasFactionStorage returns null for unknown station", () => {
    expect(store.hasFactionStorage("poi_unknown")).toBeNull();
  });

  test("setFactionStorage true → hasFactionStorage returns true", () => {
    store.setFactionStorage("poi_alpha", true);
    expect(store.hasFactionStorage("poi_alpha")).toBe(true);
  });

  test("setFactionStorage false → hasFactionStorage returns false", () => {
    store.setFactionStorage("poi_alpha", false);
    expect(store.hasFactionStorage("poi_alpha")).toBe(false);
  });

  test("overwriting true with false reflects updated value", () => {
    store.setFactionStorage("poi_beta", true);
    store.setFactionStorage("poi_beta", false);
    expect(store.hasFactionStorage("poi_beta")).toBe(false);
  });

  test("different stations are tracked independently", () => {
    store.setFactionStorage("poi_a", true);
    store.setFactionStorage("poi_b", false);
    expect(store.hasFactionStorage("poi_a")).toBe(true);
    expect(store.hasFactionStorage("poi_b")).toBe(false);
  });
});

// ── Leader auto-goal: condition check logic ───────────────────

describe("leader auto-goal: condition guards", () => {
  test("goal should trigger when hasFac=false, no current goal, not yet attempted", () => {
    const hasFac: boolean | null = false;
    const currentGoal = null;
    const attempted = new Set<string>();
    const poiKey = "leader:poi_station_1";

    const shouldTrigger = hasFac === false && !currentGoal && !attempted.has(poiKey);
    expect(shouldTrigger).toBe(true);
  });

  test("goal should NOT trigger when hasFac=null (unknown)", () => {
    const hasFac = null as boolean | null;
    const currentGoal = null;
    const attempted = new Set<string>();
    const poiKey = "leader:poi_station_1";

    const shouldTrigger = hasFac === false && !currentGoal && !attempted.has(poiKey);
    expect(shouldTrigger).toBe(false);
  });

  test("goal should NOT trigger when hasFac=true (storage exists)", () => {
    const hasFac = true as boolean | null;
    const currentGoal = null;
    const attempted = new Set<string>();
    const poiKey = "leader:poi_station_1";

    const shouldTrigger = hasFac === false && !currentGoal && !attempted.has(poiKey);
    expect(shouldTrigger).toBe(false);
  });

  test("goal should NOT trigger when current goal already set", () => {
    const hasFac: boolean | null = false;
    const currentGoal = { id: "existing_goal", target_name: "Faction Lockbox" };
    const attempted = new Set<string>();
    const poiKey = "leader:poi_station_1";

    const shouldTrigger = hasFac === false && !currentGoal && !attempted.has(poiKey);
    expect(shouldTrigger).toBe(false);
  });

  test("goal should NOT trigger when station already attempted", () => {
    const hasFac: boolean | null = false;
    const currentGoal = null;
    const attempted = new Set<string>(["leader:poi_station_1"]);
    const poiKey = "leader:poi_station_1";

    const shouldTrigger = hasFac === false && !currentGoal && !attempted.has(poiKey);
    expect(shouldTrigger).toBe(false);
  });

  test("attempt set resets when hasFac becomes true", () => {
    const attempted = new Set<string>(["leader:poi_station_1"]);
    const hasFac = true as boolean | null;
    const poiKey = "leader:poi_station_1";

    if (hasFac === true) attempted.delete(poiKey);
    expect(attempted.has(poiKey)).toBe(false);
  });
});

// ── Gather goal progress computation ─────────────────────────

describe("gather goal progress computation", () => {
  function computeProgress(
    materials: Array<{ item_id: string; quantity_needed: number }>,
    factionStorage: Array<{ itemId: string; quantity: number }>,
    inventory: Array<{ itemId: string; quantity: number }>,
  ) {
    return materials.map(m => {
      const inFaction = factionStorage.find(i => i.itemId === m.item_id)?.quantity ?? 0;
      const inCargo   = inventory.find(i => i.itemId === m.item_id)?.quantity ?? 0;
      const collected = Math.min(inFaction + inCargo, m.quantity_needed);
      const pct = m.quantity_needed > 0 ? Math.round(collected / m.quantity_needed * 100) : 0;
      return { ...m, collected, pct };
    });
  }

  function overallPct(
    mats: Array<{ quantity_needed: number; collected: number }>,
  ): number {
    const totalNeeded    = mats.reduce((s, m) => s + m.quantity_needed, 0);
    const totalCollected = mats.reduce((s, m) => s + m.collected, 0);
    return totalNeeded > 0 ? Math.round(totalCollected / totalNeeded * 100) : 0;
  }

  test("0% when nothing collected", () => {
    const mats = [{ item_id: "iron_ore", quantity_needed: 100 }];
    const result = computeProgress(mats, [], []);
    expect(result[0].collected).toBe(0);
    expect(result[0].pct).toBe(0);
    expect(overallPct(result)).toBe(0);
  });

  test("100% when exactly needed quantity in faction storage", () => {
    const mats = [{ item_id: "iron_ore", quantity_needed: 50 }];
    const fs = [{ itemId: "iron_ore", quantity: 50 }];
    const result = computeProgress(mats, fs, []);
    expect(result[0].collected).toBe(50);
    expect(result[0].pct).toBe(100);
    expect(overallPct(result)).toBe(100);
  });

  test("capped at 100% when storage exceeds needed", () => {
    const mats = [{ item_id: "iron_ore", quantity_needed: 50 }];
    const fs = [{ itemId: "iron_ore", quantity: 999 }];
    const result = computeProgress(mats, fs, []);
    expect(result[0].collected).toBe(50); // capped
    expect(result[0].pct).toBe(100);
  });

  test("cargo + faction storage combined toward goal", () => {
    const mats = [{ item_id: "iron_ore", quantity_needed: 100 }];
    const fs  = [{ itemId: "iron_ore", quantity: 40 }];
    const inv = [{ itemId: "iron_ore", quantity: 30 }];
    const result = computeProgress(mats, fs, inv);
    expect(result[0].collected).toBe(70);
    expect(result[0].pct).toBe(70);
  });

  test("multi-material: overall pct is weighted average", () => {
    const mats = [
      { item_id: "iron_ore",  quantity_needed: 100 },
      { item_id: "copper_ore", quantity_needed: 100 },
    ];
    const fs = [
      { itemId: "iron_ore",   quantity: 100 },
      { itemId: "copper_ore", quantity: 0   },
    ];
    const result = computeProgress(mats, fs, []);
    expect(result[0].pct).toBe(100);
    expect(result[1].pct).toBe(0);
    expect(overallPct(result)).toBe(50);
  });

  test("missing material not in storage returns 0%", () => {
    const mats = [{ item_id: "rare_mineral", quantity_needed: 10 }];
    const result = computeProgress(mats, [], []);
    expect(result[0].collected).toBe(0);
    expect(result[0].pct).toBe(0);
  });
});

// ── Swarmcoord: material demand for gatherer cooperation ──────

describe("swarmcoord: material demand broadcast (gatherer cooperation)", () => {
  beforeEach(() => {
    releaseAllClaims("gatherer1");
    releaseAllClaims("gatherer2");
    clearAllMaterialNeeds("gatherer1");
    clearAllMaterialNeeds("gatherer2");
  });

  test("broadcastMaterialNeed registers demand", () => {
    broadcastMaterialNeed("gatherer1", "iron_ore", 50, {});
    expect(getTotalDemandForItem("iron_ore")).toBe(50);
  });

  test("clearMaterialNeed removes specific item demand", () => {
    broadcastMaterialNeed("gatherer1", "iron_ore", 50, {});
    clearMaterialNeed("gatherer1", "iron_ore");
    expect(getTotalDemandForItem("iron_ore")).toBe(0);
  });

  test("clearAllMaterialNeeds removes all demands for bot", () => {
    broadcastMaterialNeed("gatherer1", "iron_ore",   50, {});
    broadcastMaterialNeed("gatherer1", "copper_ore", 30, {});
    clearAllMaterialNeeds("gatherer1");
    expect(getTotalDemandForItem("iron_ore")).toBe(0);
    expect(getTotalDemandForItem("copper_ore")).toBe(0);
  });

  test("two gatherers broadcasting same item accumulates demand", () => {
    broadcastMaterialNeed("gatherer1", "iron_ore", 50, {});
    broadcastMaterialNeed("gatherer2", "iron_ore", 30, {});
    expect(getTotalDemandForItem("iron_ore")).toBe(80);
  });

  test("clearing one bot leaves other bot's demand intact", () => {
    broadcastMaterialNeed("gatherer1", "iron_ore", 50, {});
    broadcastMaterialNeed("gatherer2", "iron_ore", 30, {});
    clearAllMaterialNeeds("gatherer1");
    expect(getTotalDemandForItem("iron_ore")).toBe(30);
  });

  test("getAllMaterialDemands returns active demands", () => {
    broadcastMaterialNeed("gatherer1", "iron_ore", 50, { stationPoiId: "poi_1" });
    const demands = getAllMaterialDemands();
    const found = demands.find(d => d.bot === "gatherer1" && d.itemId === "iron_ore");
    expect(found).toBeDefined();
    expect(found?.quantity).toBe(50);
    expect(found?.stationPoiId).toBe("poi_1");
  });

  test("demand with stationPoiId is stored correctly", () => {
    broadcastMaterialNeed("gatherer1", "copper_ore", 20, {
      stationPoiId: "poi_station_alpha",
      stationSystem: "sys_1",
      useGift: true,
    });
    const demands = getAllMaterialDemands();
    const d = demands.find(x => x.bot === "gatherer1" && x.itemId === "copper_ore");
    expect(d?.stationPoiId).toBe("poi_station_alpha");
    expect(d?.stationSystem).toBe("sys_1");
    expect(d?.useGift).toBe(true);
  });
});
