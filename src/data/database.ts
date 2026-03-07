/**
 * SQLite database setup with schema and migrations.
 * Single file database for sessions, settings, stats, cache, and training data.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

const DB_PATH = "data/hex-bots.db";
const CURRENT_SCHEMA_VERSION = 7;

export function createDatabase(): Database {
  mkdirSync("data", { recursive: true });

  const db = new Database(DB_PATH, { create: true });

  // Performance pragmas
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA cache_size = -64000"); // 64MB cache
  db.run("PRAGMA busy_timeout = 5000");

  // Schema versioning
  db.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.query("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | null;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    applyMigrations(db, currentVersion);
  }

  return db;
}

function applyMigrations(db: Database, fromVersion: number): void {
  const tx = db.transaction(() => {
    if (fromVersion < 1) migrateV1(db);
    if (fromVersion < 2) migrateV2(db);
    if (fromVersion < 3) migrateV3(db);
    if (fromVersion < 4) migrateV4(db);
    if (fromVersion < 5) migrateV5(db);
    if (fromVersion < 6) migrateV6(db);
    if (fromVersion < 7) migrateV7(db);

    // Update schema version
    db.run("DELETE FROM schema_version");
    db.run("INSERT INTO schema_version (version) VALUES (?)", [CURRENT_SCHEMA_VERSION]);
  });

  tx();
  console.log(`[DB] Migrated from v${fromVersion} → v${CURRENT_SCHEMA_VERSION}`);
}

function migrateV1(db: Database): void {
  // ── Bot credentials and sessions ──
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      empire TEXT DEFAULT '',
      player_id TEXT DEFAULT '',
      session_id TEXT,
      session_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Settings (key-value store for routine settings, bot assignments, general) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Daily bot stats ──
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_stats (
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      mined INTEGER NOT NULL DEFAULT 0,
      crafted INTEGER NOT NULL DEFAULT 0,
      trades INTEGER NOT NULL DEFAULT 0,
      profit INTEGER NOT NULL DEFAULT 0,
      systems INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (username, date)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_stats_date ON bot_stats(date)");

  // ── Static data cache (version-gated) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      game_version TEXT,
      fetched_at INTEGER NOT NULL
    )
  `);

  // ── Timed cache (market data, system data) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS timed_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_ms INTEGER NOT NULL
    )
  `);

  // ── Goals (for future Commander) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      priority INTEGER NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      constraints TEXT
    )
  `);
}

function migrateV2(db: Database): void {
  // ── Decision log (training data) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS decision_log (
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
  db.run("CREATE INDEX IF NOT EXISTS idx_decision_log_bot ON decision_log(bot_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_decision_log_tick ON decision_log(tick)");

  // ── State snapshots (full bot state periodically) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS state_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      player_state TEXT NOT NULL,
      ship_state TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_snapshots_bot ON state_snapshots(bot_id)");

  // ── Market price history ──
  db.run(`
    CREATE TABLE IF NOT EXISTS market_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      station_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      buy_price REAL,
      sell_price REAL,
      buy_volume INTEGER,
      sell_volume INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_market_station_item ON market_history(station_id, item_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_market_tick ON market_history(tick)");

  // ── Commander decisions log ──
  db.run(`
    CREATE TABLE IF NOT EXISTS commander_log (
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
  db.run("CREATE INDEX IF NOT EXISTS idx_commander_tick ON commander_log(tick)");

  // ── Credit history (fleet total credits over time) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS credit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      total_credits INTEGER NOT NULL,
      active_bots INTEGER NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_credit_ts ON credit_history(timestamp)");
}

function migrateV3(db: Database): void {
  // ── Galaxy map (per-system rows replaces monolithic JSON blob) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS map_systems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      security_level TEXT,
      data TEXT NOT NULL,
      last_updated TEXT NOT NULL
    )
  `);

  // ── Catalog items (per-item rows, keyed by id + type) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (id, item_type)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_catalog_type ON catalog_items(item_type)");

  // ── Catalog metadata (lastFetched, version) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function migrateV4(db: Database): void {
  // Repair: ensure V3 tables exist for DBs that had schema_version=3 set
  // prematurely (before migrateV3 was complete). All statements use IF NOT EXISTS.
  db.run(`
    CREATE TABLE IF NOT EXISTS map_systems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      security_level TEXT,
      data TEXT NOT NULL,
      last_updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Add last_updated column if it's missing (pre-V3 table had different schema).
  // SQLite ADD COLUMN requires a constant literal default (no function expressions).
  try {
    db.run("ALTER TABLE map_systems ADD COLUMN last_updated TEXT NOT NULL DEFAULT '1970-01-01T00:00:00'");
  } catch { /* column already exists — ignore */ }
  db.run(`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (id, item_type)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_catalog_type ON catalog_items(item_type)");
  db.run(`
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function migrateV5(db: Database): void {
  // Fix: add last_updated column to map_systems if it's still missing.
  // SQLite ADD COLUMN requires a constant literal — not a function expression.
  try {
    db.run("ALTER TABLE map_systems ADD COLUMN last_updated TEXT NOT NULL DEFAULT '1970-01-01T00:00:00'");
  } catch { /* column already exists — ok */ }
}

function migrateV7(db: Database): void {
  // ── Expand bot_stats with additional metrics ──
  const newStatCols = [
    "earned INTEGER NOT NULL DEFAULT 0",
    "spent INTEGER NOT NULL DEFAULT 0",
    "donated INTEGER NOT NULL DEFAULT 0",
    "ore_units INTEGER NOT NULL DEFAULT 0",
    "kills INTEGER NOT NULL DEFAULT 0",
    "deaths INTEGER NOT NULL DEFAULT 0",
    "loot_value INTEGER NOT NULL DEFAULT 0",
    "craft_units INTEGER NOT NULL DEFAULT 0",
    "jumps INTEGER NOT NULL DEFAULT 0",
    "missions INTEGER NOT NULL DEFAULT 0",
    "mission_rewards INTEGER NOT NULL DEFAULT 0",
    "markets_scanned INTEGER NOT NULL DEFAULT 0",
  ];
  for (const col of newStatCols) {
    try { db.run(`ALTER TABLE bot_stats ADD COLUMN ${col}`); } catch { /* already exists */ }
  }

  // ── Add item_name to market_history ──
  try { db.run("ALTER TABLE market_history ADD COLUMN item_name TEXT NOT NULL DEFAULT ''"); } catch { /* already exists */ }
  try { db.run("ALTER TABLE market_history ADD COLUMN station_name TEXT NOT NULL DEFAULT ''"); } catch { /* already exists */ }

  // ── Structured market prices (current state per station/item) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS market_prices (
      station_id TEXT NOT NULL,
      system_id TEXT NOT NULL DEFAULT '',
      station_name TEXT NOT NULL DEFAULT '',
      system_name TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      sell_price REAL,
      sell_quantity INTEGER NOT NULL DEFAULT 0,
      buy_price REAL,
      buy_quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (station_id, item_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_mp_item ON market_prices(item_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_mp_system ON market_prices(system_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_mp_sell ON market_prices(item_id, sell_price) WHERE sell_price IS NOT NULL AND sell_quantity > 0");
  db.run("CREATE INDEX IF NOT EXISTS idx_mp_buy ON market_prices(item_id, buy_price) WHERE buy_price IS NOT NULL AND buy_quantity > 0");
}

function migrateV6(db: Database): void {
  // ── Faction storage item snapshots (per POI, per item) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS faction_storage_items (
      poi_id TEXT NOT NULL,
      system_id TEXT NOT NULL DEFAULT '',
      system_name TEXT NOT NULL DEFAULT '',
      poi_name TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (poi_id, item_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_fsi_poi ON faction_storage_items(poi_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_fsi_item ON faction_storage_items(item_id)");

  // ── Known faction building locations ──
  db.run(`
    CREATE TABLE IF NOT EXISTS faction_buildings (
      facility_id TEXT PRIMARY KEY,
      faction_id TEXT NOT NULL DEFAULT '',
      faction_name TEXT NOT NULL DEFAULT '',
      poi_id TEXT NOT NULL DEFAULT '',
      poi_name TEXT NOT NULL DEFAULT '',
      system_id TEXT NOT NULL DEFAULT '',
      system_name TEXT NOT NULL DEFAULT '',
      facility_type TEXT NOT NULL DEFAULT '',
      facility_name TEXT NOT NULL DEFAULT '',
      faction_service TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      level INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_fb_system ON faction_buildings(system_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_fb_faction ON faction_buildings(faction_id)");
}

// ── CacheHelper ──

export class CacheHelper {
  constructor(private db: Database) {}

  getStatic(key: string, gameVersion?: string): string | null {
    const query = gameVersion
      ? "SELECT data FROM cache WHERE key = ? AND game_version = ?"
      : "SELECT data FROM cache WHERE key = ?";
    const params = gameVersion ? [key, gameVersion] : [key];
    const row = this.db.query(query).get(...params) as { data: string } | null;
    return row?.data ?? null;
  }

  setStatic(key: string, data: string, gameVersion: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO cache (key, data, game_version, fetched_at) VALUES (?, ?, ?, ?)",
      [key, data, gameVersion, Date.now()]
    );
  }

  deleteStatic(key: string): void {
    this.db.run("DELETE FROM cache WHERE key = ?", [key]);
  }

  getTimed(key: string): string | null {
    const row = this.db
      .query("SELECT data, fetched_at, ttl_ms FROM timed_cache WHERE key = ?")
      .get(key) as { data: string; fetched_at: number; ttl_ms: number } | null;

    if (!row) return null;
    if (Date.now() - row.fetched_at > row.ttl_ms) return null; // expired
    return row.data;
  }

  setTimed(key: string, data: string, ttlMs: number): void {
    this.db.run(
      "INSERT OR REPLACE INTO timed_cache (key, data, fetched_at, ttl_ms) VALUES (?, ?, ?, ?)",
      [key, data, Date.now(), ttlMs]
    );
  }

  clearTimed(keyPattern?: string): void {
    if (keyPattern) {
      this.db.run("DELETE FROM timed_cache WHERE key LIKE ?", [keyPattern]);
    } else {
      this.db.run("DELETE FROM timed_cache");
    }
  }

  getAllByPrefix(prefix: string): Array<{ key: string; data: string }> {
    return this.db.query("SELECT key, data FROM cache WHERE key LIKE ?").all(`${prefix}%`) as Array<{ key: string; data: string }>;
  }

  clearAll(): void {
    this.db.run("DELETE FROM cache");
    this.db.run("DELETE FROM timed_cache");
  }
}
