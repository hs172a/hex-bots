import { describe, test, expect, beforeEach } from "bun:test";
import {
  claimStation,
  releaseStationClaim,
  stationClaimCount,
  isStationCrowded,
  pickLeastCrowdedStation,
  claimTradeRoute,
  releaseTradeRouteClaim,
  isTradeRouteClaimed,
  broadcastMaterialNeed,
  clearMaterialNeed,
  clearAllMaterialNeeds,
  getTotalDemandForItem,
  getMostNeededItem,
  getAllMaterialDemands,
  releaseAllClaims,
  getCoordinatorSnapshot,
  STATION_CROWD_THRESHOLD,
} from "../swarmcoord.js";

// Reset coordinator state between tests by releasing all claims
const ALL_TEST_BOTS = ["botA", "botB", "botC", "botD", "bot0", "bot1", "bot2",
  "minerA", "minerB", "traderA", "traderB"];

function resetAll(): void {
  for (const name of ALL_TEST_BOTS) {
    releaseAllClaims(name);
  }
}

// ── Station claims ────────────────────────────────────────────

describe("swarmcoord: station claims", () => {
  beforeEach(() => resetAll());

  test("claimStation registers a bot for a station", () => {
    claimStation("botA", "station_1", { ore_iron: 100 });
    expect(stationClaimCount("station_1")).toBe(1);
  });

  test("releaseStationClaim removes the registration", () => {
    claimStation("botA", "station_1");
    releaseStationClaim("botA");
    expect(stationClaimCount("station_1")).toBe(0);
  });

  test("multiple bots claiming same station increments count", () => {
    claimStation("botA", "station_1");
    claimStation("botB", "station_1");
    expect(stationClaimCount("station_1")).toBe(2);
  });

  test("excludeBot does not count the excluded bot", () => {
    claimStation("botA", "station_1");
    claimStation("botB", "station_1");
    expect(stationClaimCount("station_1", undefined, "botA")).toBe(1);
  });

  test("isStationCrowded true when >= STATION_CROWD_THRESHOLD bots", () => {
    const testBots = ["botA", "botB", "botC", "botD"].slice(0, STATION_CROWD_THRESHOLD);
    for (const name of testBots) {
      claimStation(name, "station_1");
    }
    expect(isStationCrowded("station_1")).toBe(true);
  });

  test("isStationCrowded false when below threshold", () => {
    claimStation("botA", "station_1");
    expect(isStationCrowded("station_1")).toBe(false);
  });

  test("reclaiming a station replaces bot's prior claim (not additive)", () => {
    claimStation("botA", "station_1");
    claimStation("botA", "station_2"); // replaces station_1
    expect(stationClaimCount("station_1")).toBe(0);
    expect(stationClaimCount("station_2")).toBe(1);
  });

  test("pickLeastCrowdedStation picks uncrowded station", () => {
    claimStation("botA", "station_1");
    claimStation("botB", "station_1");
    const picked = pickLeastCrowdedStation(["station_1", "station_2"]);
    expect(picked).toBe("station_2");
  });

  test("pickLeastCrowdedStation returns null for empty list", () => {
    expect(pickLeastCrowdedStation([])).toBeNull();
  });

  test("pickLeastCrowdedStation returns single option", () => {
    expect(pickLeastCrowdedStation(["station_x"])).toBe("station_x");
  });
});

// ── Trade route claims ────────────────────────────────────────

describe("swarmcoord: trade route claims", () => {
  beforeEach(() => resetAll());

  test("claimTradeRoute registers a route", () => {
    claimTradeRoute("botA", "sysA", "sysB", "station_b", "iron_ore");
    expect(isTradeRouteClaimed("sysA", "sysB", "iron_ore")).toBe(true);
  });

  test("releaseTradeRouteClaim removes the route", () => {
    claimTradeRoute("botA", "sysA", "sysB", "station_b", "iron_ore");
    releaseTradeRouteClaim("botA");
    expect(isTradeRouteClaimed("sysA", "sysB", "iron_ore")).toBe(false);
  });

  test("excludeBot: bot's own claim is not counted against itself", () => {
    claimTradeRoute("botA", "sysA", "sysB", "station_b", "iron_ore");
    expect(isTradeRouteClaimed("sysA", "sysB", "iron_ore", "botA")).toBe(false);
  });

  test("different item on same route is NOT claimed", () => {
    claimTradeRoute("botA", "sysA", "sysB", "station_b", "iron_ore");
    expect(isTradeRouteClaimed("sysA", "sysB", "copper_ore")).toBe(false);
  });

  test("reclaiming replaces prior route claim for the same bot", () => {
    claimTradeRoute("botA", "sysA", "sysB", "station_b", "iron_ore");
    claimTradeRoute("botA", "sysC", "sysD", "station_d", "gold");
    expect(isTradeRouteClaimed("sysA", "sysB", "iron_ore")).toBe(false);
    expect(isTradeRouteClaimed("sysC", "sysD", "gold")).toBe(true);
  });
});

// ── Material demand signals ───────────────────────────────────

describe("swarmcoord: material demand signals", () => {
  beforeEach(() => resetAll());

  test("broadcastMaterialNeed registers demand", () => {
    broadcastMaterialNeed("botA", "ore_iron", 500);
    expect(getTotalDemandForItem("ore_iron")).toBe(500);
  });

  test("clearMaterialNeed removes specific demand", () => {
    broadcastMaterialNeed("botA", "ore_iron", 500);
    clearMaterialNeed("botA", "ore_iron");
    expect(getTotalDemandForItem("ore_iron")).toBe(0);
  });

  test("clearAllMaterialNeeds removes all demands from a bot", () => {
    broadcastMaterialNeed("botA", "ore_iron", 200);
    broadcastMaterialNeed("botA", "ore_copper", 100);
    clearAllMaterialNeeds("botA");
    expect(getTotalDemandForItem("ore_iron")).toBe(0);
    expect(getTotalDemandForItem("ore_copper")).toBe(0);
  });

  test("multiple bots demanding same item sums correctly", () => {
    broadcastMaterialNeed("botA", "ore_iron", 300);
    broadcastMaterialNeed("botB", "ore_iron", 200);
    expect(getTotalDemandForItem("ore_iron")).toBe(500);
  });

  test("getMostNeededItem returns highest-demand item", () => {
    broadcastMaterialNeed("botA", "ore_iron", 100);
    broadcastMaterialNeed("botB", "ore_copper", 500);
    const most = getMostNeededItem();
    expect(most).not.toBeNull();
    expect(most!.itemId).toBe("ore_copper");
    expect(most!.totalQuantity).toBe(500);
  });

  test("getMostNeededItem returns null when no demands", () => {
    expect(getMostNeededItem()).toBeNull();
  });

  test("getAllMaterialDemands returns sorted list", () => {
    broadcastMaterialNeed("botA", "ore_a", 50);
    broadcastMaterialNeed("botB", "ore_b", 200);
    const demands = getAllMaterialDemands();
    expect(demands[0].quantity).toBeGreaterThanOrEqual(demands[1]?.quantity ?? 0);
  });
});

// ── releaseAllClaims ──────────────────────────────────────────

describe("swarmcoord: releaseAllClaims", () => {
  beforeEach(() => resetAll());

  test("releaseAllClaims clears station, trade route, and material demands", () => {
    claimStation("botA", "station_1");
    claimTradeRoute("botA", "sysA", "sysB", "poi_b", "iron");
    broadcastMaterialNeed("botA", "ore_x", 999);

    releaseAllClaims("botA");

    expect(stationClaimCount("station_1")).toBe(0);
    expect(isTradeRouteClaimed("sysA", "sysB", "iron")).toBe(false);
    expect(getTotalDemandForItem("ore_x")).toBe(0);
  });
});

// ── getCoordinatorSnapshot ────────────────────────────────────

describe("swarmcoord: snapshot", () => {
  beforeEach(() => resetAll());

  test("snapshot reflects current state", () => {
    claimStation("botA", "poi_x", { ore_iron: 50 });
    claimTradeRoute("botB", "s1", "s2", "poi_s2", "gold");
    broadcastMaterialNeed("botC", "ore_silver", 100);

    const snap = getCoordinatorSnapshot();
    expect(snap.stationClaims).toHaveLength(1);
    expect(snap.tradeRouteClaims).toHaveLength(1);
    expect(snap.materialDemands).toHaveLength(1);
  });
});
