import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { TrainingLogger } from "../data/training-logger.js";

// ── Schema bootstrap (mirrors database.ts migrateV2) ─────────

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      action TEXT NOT NULL,
      params TEXT,
      context TEXT NOT NULL,
      result TEXT,
      commander_goal TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE state_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      player_state TEXT NOT NULL,
      ship_state TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE market_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      station_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      buy_price REAL,
      sell_price REAL,
      buy_volume INTEGER NOT NULL DEFAULT 0,
      sell_volume INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE commander_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      goal TEXT NOT NULL,
      fleet_state TEXT NOT NULL,
      assignments TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      economy_state TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE credit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      total_credits INTEGER NOT NULL,
      active_bots INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

// ── Fixtures ─────────────────────────────────────────────────

function insertEpisode(logger: TrainingLogger, botId: string, type: string, profit: number, success: boolean): void {
  logger.logEpisode({
    botId,
    episodeType: type,
    startTick: 1,
    endTick: 100,
    startCredits: 1000,
    endCredits: 1000 + profit,
    route: ["sys_a", "sys_b"],
    itemsInvolved: { ore_iron: 50 },
    fuelConsumed: 10,
    risks: [],
    success,
  });
}

// ── getRecentEpisodes ─────────────────────────────────────────

describe("TrainingLogger: getRecentEpisodes", () => {
  let logger: TrainingLogger;

  beforeEach(() => {
    logger = new TrainingLogger(createTestDb());
  });

  test("returns empty array when no episodes exist", () => {
    expect(logger.getRecentEpisodes()).toEqual([]);
  });

  test("returns one episode after logEpisode", () => {
    insertEpisode(logger, "botA", "mining", 500, true);
    const eps = logger.getRecentEpisodes();
    expect(eps).toHaveLength(1);
    expect(eps[0].botId).toBe("botA");
    expect(eps[0].episodeType).toBe("mining");
    expect(eps[0].profit).toBe(500);
    expect(eps[0].success).toBe(true);
  });

  test("returns episodes newest first", () => {
    insertEpisode(logger, "botA", "mining", 100, true);
    insertEpisode(logger, "botA", "trading", 800, true);
    const eps = logger.getRecentEpisodes();
    expect(eps[0].episodeType).toBe("trading"); // newest first
    expect(eps[1].episodeType).toBe("mining");
  });

  test("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      insertEpisode(logger, "botA", "mining", i * 100, true);
    }
    expect(logger.getRecentEpisodes(3)).toHaveLength(3);
    expect(logger.getRecentEpisodes(10)).toHaveLength(10);
  });

  test("default limit is 20 (returns at most 20)", () => {
    for (let i = 0; i < 25; i++) {
      insertEpisode(logger, "botA", "trading", i * 50, true);
    }
    expect(logger.getRecentEpisodes().length).toBeLessThanOrEqual(20);
  });

  test("failed episodes have success=false and negative profit", () => {
    insertEpisode(logger, "botB", "mission", -200, false);
    const eps = logger.getRecentEpisodes();
    expect(eps[0].success).toBe(false);
    expect(eps[0].profit).toBe(-200);
  });

  test("multiple bots mixed in results", () => {
    insertEpisode(logger, "minerBot", "mining", 300, true);
    insertEpisode(logger, "traderBot", "trading", 1200, true);
    const eps = logger.getRecentEpisodes();
    const bots = new Set(eps.map(e => e.botId));
    expect(bots.has("minerBot")).toBe(true);
    expect(bots.has("traderBot")).toBe(true);
  });

  test("non-episode decision_log entries are excluded", () => {
    // Direct action log (not an episode)
    logger.logDecision({
      tick: 1, botId: "botA",
      action: "mine",
      context: { system: "Alpha" },
      result: { qty: 5 },
    });
    // Episode
    insertEpisode(logger, "botA", "mining", 100, true);
    const eps = logger.getRecentEpisodes();
    expect(eps).toHaveLength(1); // only the episode
    expect(eps[0].episodeType).toBe("mining");
  });
});

// ── logDecision ───────────────────────────────────────────────

describe("TrainingLogger: logDecision", () => {
  let logger: TrainingLogger;

  beforeEach(() => {
    logger = new TrainingLogger(createTestDb());
  });

  test("stores decision and getStats reflects it", () => {
    logger.logDecision({
      tick: 42, botId: "botX",
      action: "travel",
      context: { from: "A", to: "B" },
    });
    const stats = logger.getStats();
    expect(stats.decisions).toBe(1);
  });

  test("multiple decisions increment count", () => {
    for (let i = 0; i < 5; i++) {
      logger.logDecision({ tick: i, botId: "botX", action: "mine", context: {} });
    }
    expect(logger.getStats().decisions).toBe(5);
  });
});

// ── getStats ─────────────────────────────────────────────────

describe("TrainingLogger: getStats", () => {
  let logger: TrainingLogger;

  beforeEach(() => {
    logger = new TrainingLogger(createTestDb());
  });

  test("all counts start at 0", () => {
    const s = logger.getStats();
    expect(s.decisions).toBe(0);
    expect(s.snapshots).toBe(0);
    expect(s.marketRecords).toBe(0);
    expect(s.commanderDecisions).toBe(0);
  });

  test("logMarketPrices increments marketRecords", () => {
    logger.logMarketPrices(1, "station_x", [
      { itemId: "ore_iron", buyPrice: 10, sellPrice: 15, buyVolume: 100, sellVolume: 50 },
      { itemId: "ore_gold", buyPrice: 200, sellPrice: 250, buyVolume: 10, sellVolume: 5 },
    ]);
    expect(logger.getStats().marketRecords).toBe(2);
  });

  test("logCommanderDecision increments commanderDecisions", () => {
    logger.logCommanderDecision({
      tick: 1, goal: "maximize_income",
      fleetState: {}, assignments: [],
      reasoning: "Test reasoning",
    });
    expect(logger.getStats().commanderDecisions).toBe(1);
  });
});
