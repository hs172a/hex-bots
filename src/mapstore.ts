import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cachedFetch } from "./httpcache.js";
import type { Database } from "bun:sqlite";
import { FactionStorageDb } from "./data/faction-storage-db.js";
import type { FactionStorageEntry, FactionBuildingEntry } from "./data/faction-storage-db.js";
import { NeedsMatrixDb } from "./data/needs-matrix-db.js";
import type { NeedsMatrixEntry } from "./data/needs-matrix-db.js";
import { DepositsDb } from "./data/deposits-db.js";
import type { DepositRecord } from "./data/deposits-db.js";
import { WormholesDb } from "./data/wormholes-db.js";
import type { WormholeEntry } from "./data/wormholes-db.js";

// ── Data model ──────────────────────────────────────────────

export interface StoredConnection {
  system_id: string;
  system_name: string;
  security_level?: string;
  jump_cost?: number;
  distance?: number;
}

export interface OreRecord {
  item_id: string;
  name: string;
  total_mined: number;
  times_seen: number;
  last_seen: string;
}

export interface MarketRecord {
  item_id: string;
  item_name: string;
  best_buy: number | null;
  best_sell: number | null;
  buy_quantity: number;
  sell_quantity: number;
  last_updated: string;
}

export interface OrderRecord {
  order_id: string;
  player_name?: string;
  item_id: string;
  item_name: string;
  order_type: "buy" | "sell";
  price: number;
  quantity: number;
  last_seen: string;
}

export interface MissionRecord {
  mission_id: string;
  title: string;
  description?: string;
  type?: string;
  reward_credits?: number;
  reward_items?: string;
  level_required?: number;
  expires_at?: string;
  last_seen: string;
}

export interface StoredPOI {
  id: string;
  name: string;
  type: string;
  has_base: boolean;
  base_id: string | null;
  base_name: string | null;
  base_type: string | null;
  services: string[];
  ores_found: OreRecord[];
  market: MarketRecord[];
  orders: OrderRecord[];
  missions: MissionRecord[];
  last_explored: string | null;
  last_updated: string;
}

export interface PirateSighting {
  player_id?: string;
  name?: string;
  count: number;
  last_seen: string;
}

export interface WreckRecord {
  id: string;
  ship_type: string;
  wreck_type?: string;
  poi_id?: string;
  expires_at?: string;
  last_seen: string;
}

export interface StoredSystem {
  id: string;
  name: string;
  security_level?: string;
  connections: StoredConnection[];
  pois: StoredPOI[];
  pirate_sightings: PirateSighting[];
  wrecks: WreckRecord[];
  last_updated: string;
}

/** Lightweight delta used by the high-frequency /sync/fast path. */
export interface FastPatch {
  system_id: string;
  last_updated: string;
  market_updates: Array<{
    poi_id: string;
    market: MarketRecord[];
    orders: OrderRecord[];
    last_updated: string;
  }>;
  pirate_sightings: PirateSighting[];
}

export interface MapData {
  version: 1;
  last_saved: string;
  systems: Record<string, StoredSystem>;
}

// ── MapStore singleton ──────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const MAP_FILE = join(DATA_DIR, "map.json");
const SAVE_DEBOUNCE_MS = 5000;

export class MapStore {
  private data: MapData;
  private dirty = false;
  private dirtySystemIds = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _db: Database | null = null;
  private _factionStorageDb: FactionStorageDb | null = null;
  private _needsMatrixDb: NeedsMatrixDb | null = null;
  private _depositsDb: DepositsDb | null = null;
  private _wormholesDb: WormholesDb | null = null;
  /** Memoized BFS routes. Cleared when map topology changes. */
  private routeCache = new Map<string, string[] | null>();

  constructor() {
    this.data = this.load();
  }

  /** Connect to SQLite backend. Loads per-system rows; migrates legacy JSON/blob data if needed. */
  connectToDb(db: Database): void {
    this._db = db;
    const rows = db.query("SELECT id, data FROM map_systems").all() as { id: string; data: string }[];
    if (rows.length > 0) {
      for (const row of rows) {
        try { this.data.systems[row.id] = JSON.parse(row.data) as StoredSystem; } catch { /* corrupt row */ }
      }
      console.log(`[MapStore] Loaded ${rows.length} systems from SQLite`);
    } else if (Object.keys(this.data.systems).length > 0) {
      this._migrateToDb();
    }
  }

  /** Bulk-insert all in-memory systems into the DB (one-time migration). */
  private _migrateToDb(): void {
    if (!this._db) return;
    const stmt = this._db.prepare(
      "INSERT OR REPLACE INTO map_systems (id, name, security_level, data, last_updated) VALUES (?, ?, ?, ?, ?)"
    );
    const tx = this._db.transaction(() => {
      for (const sys of Object.values(this.data.systems)) {
        stmt.run(sys.id, sys.name, sys.security_level ?? null, JSON.stringify(sys), sys.last_updated);
      }
    });
    tx();
    console.log(`[MapStore] Migrated ${Object.keys(this.data.systems).length} systems to SQLite`);
  }

  // ── Persistence ─────────────────────────────────────────

  private load(): MapData {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    if (existsSync(MAP_FILE)) {
      try {
        const raw = readFileSync(MAP_FILE, "utf-8");
        return JSON.parse(raw) as MapData;
      } catch {
        // Corrupt file — start fresh
      }
    }
    return { version: 1, last_saved: now(), systems: {} };
  }

  /** Mark a single system as dirty and schedule a debounced flush. */
  private scheduleSystemSave(id: string): void {
    this.dirtySystemIds.add(id);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, SAVE_DEBOUNCE_MS);
  }

  private writeToDisk(): void {
    if (!this.dirty) return;
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    this.data.last_saved = now();
    writeFileSync(MAP_FILE, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
    this.dirty = false;
  }

  /** Flush only dirty systems to SQLite, or fall back to JSON. */
  private persist(): void {
    if (this._db) {
      this._saveToDb();
    } else {
      this.writeToDisk();
    }
  }

  /** Upsert only changed system rows. */
  private _saveToDb(): void {
    if (!this._db || this.dirtySystemIds.size === 0) return;
    const stmt = this._db.prepare(
      "INSERT OR REPLACE INTO map_systems (id, name, security_level, data, last_updated) VALUES (?, ?, ?, ?, ?)"
    );
    const tx = this._db.transaction(() => {
      for (const id of this.dirtySystemIds) {
        const sys = this.data.systems[id];
        if (sys) stmt.run(sys.id, sys.name, sys.security_level ?? null, JSON.stringify(sys), sys.last_updated);
      }
    });
    tx();
    this.dirtySystemIds.clear();
    this.dirty = false;
  }

  /** Flush pending writes immediately. Call on shutdown. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }

  // ── Update methods ──────────────────────────────────────

  /** Merge system data from a get_system API response. */
  updateSystem(systemData: Record<string, unknown>): void {
    const id = (systemData.system_id as string) || (systemData.id as string);
    if (!id) return;

    const existing = this.data.systems[id];
    const sys: StoredSystem = existing || {
      id,
      name: "",
      connections: [],
      pois: [],
      pirate_sightings: [],
      wrecks: [],
      last_updated: now(),
    };

    sys.name = (systemData.name as string) || (systemData.system_name as string) || sys.name;
    sys.security_level = (systemData.security_level as string)
      || (systemData.security_status as string)
      || (systemData.lawfulness as string)
      || (systemData.security as string)
      || (systemData.police_level as string)
      || sys.security_level;
    sys.last_updated = now();

    // Merge connections
    const conns = systemData.connections as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(conns)) {
      sys.connections = conns.map((c) => ({
        system_id: (c.system_id as string) || (c.id as string) || "",
        system_name: (c.system_name as string) || (c.name as string) || "",
        security_level: (c.security_level as string) || (c.security_status as string) || (c.lawfulness as string) || (c.security as string) || undefined,
        jump_cost: c.jump_cost as number | undefined,
        distance: c.distance as number | undefined,
      }));
      // New topology — old cached routes may be stale
      this.routeCache.clear();
    }

    // Merge POIs — preserve existing ore & market data
    const pois = systemData.pois as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(pois)) {
      const existingPois = new Map(sys.pois.map((p) => [p.id, p]));
      sys.pois = pois.map((p) => {
        const poiId = (p.id as string) || "";
        const prev = existingPois.get(poiId);
        return {
          id: poiId,
          name: (p.name as string) || prev?.name || "",
          type: (p.type as string) || prev?.type || "",
          has_base: !!(p.has_base || p.base_id),
          base_id: (p.base_id as string) ?? prev?.base_id ?? null,
          base_name: (p.base_name as string) ?? prev?.base_name ?? null,
          base_type: (p.base_type as string) ?? prev?.base_type ?? null,
          services: (p.services as string[]) ?? prev?.services ?? [],
          ores_found: prev?.ores_found ?? [],
          market: prev?.market ?? [],
          orders: prev?.orders ?? [],
          missions: prev?.missions ?? [],
          last_explored: prev?.last_explored ?? null,
          last_updated: now(),
        };
      });
    }

    // Merge wrecks from system data
    const wrecks = systemData.wrecks as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(wrecks)) {
      const existingWrecks = new Map(sys.wrecks.map((w) => [w.id, w]));
      for (const w of wrecks) {
        const wId = (w.id as string) || (w.wreck_id as string) || "";
        if (!wId) continue;
        existingWrecks.set(wId, {
          id: wId,
          ship_type: (w.ship_type as string) || "",
          wreck_type: w.wreck_type as string | undefined,
          poi_id: w.poi_id as string | undefined,
          expires_at: w.expires_at as string | undefined,
          last_seen: now(),
        });
      }
      sys.wrecks = [...existingWrecks.values()];
    }

    this.data.systems[id] = sys;
    this.scheduleSystemSave(id);
  }

  /** Update market prices for a station POI from view_market response. */
  updateMarket(systemId: string, poiId: string, marketData: Record<string, unknown>): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi) return;

    const items = (
      Array.isArray(marketData) ? marketData :
      Array.isArray(marketData.items) ? marketData.items :
      Array.isArray(marketData.market) ? marketData.market :
      []
    ) as Array<Record<string, unknown>>;

    const existingMarket = new Map(poi.market.map((m) => [m.item_id, m]));
    const freshItemIds = new Set<string>();

    for (const item of items) {
      const itemId = (item.item_id as string) || (item.id as string) || "";
      if (!itemId) continue;
      freshItemIds.add(itemId);

      const buyPrice = item.buy_price as number ?? item.buy as number ?? null;
      const sellPrice = item.sell_price as number ?? item.sell as number ?? null;
      const prev = existingMarket.get(itemId);

      // Extract order quantities from order book data — use fresh values as-is,
      // don't fall back to stale cached quantities (they may no longer be available)
      const buyQty = (item.buy_quantity as number) ?? (item.buy_volume as number) ?? (item.buy_orders as number) ?? 0;
      const sellQty = (item.sell_quantity as number) ?? (item.sell_volume as number) ?? (item.sell_orders as number) ?? 0;

      existingMarket.set(itemId, {
        item_id: itemId,
        item_name: (item.name as string) || (item.item_name as string) || prev?.item_name || itemId,
        best_buy: buyPrice,
        best_sell: sellPrice,
        buy_quantity: buyQty,
        sell_quantity: sellQty,
        last_updated: now(),
      });
    }

    // Remove items not in the fresh API response — they're no longer on this market
    if (freshItemIds.size > 0) {
      for (const [id] of existingMarket) {
        if (!freshItemIds.has(id)) existingMarket.delete(id);
      }
    }

    poi.market = [...existingMarket.values()];
    poi.last_updated = now();
    this.scheduleSystemSave(systemId);
  }

  /** Remove an item from a station's cached market data (e.g. when buy fails with item_not_available). */
  removeMarketItem(systemId: string, poiId: string, itemId: string): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;
    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi) return;
    const before = poi.market.length;
    poi.market = poi.market.filter((m) => m.item_id !== itemId);
    if (poi.market.length < before) this.scheduleSystemSave(systemId);
  }

  /** Reduce cached market quantities when a bot commits to a trade route.
   *  Decrements sell_quantity at source (fewer items for sale) and
   *  buy_quantity at dest (less demand to fill). Prevents other bots
   *  from chasing the same trade. */
  reserveTradeQuantity(
    sourceSystem: string, sourcePoi: string,
    destSystem: string, destPoi: string,
    itemId: string, quantity: number,
  ): void {
    // Reduce supply at source
    const srcSys = this.data.systems[sourceSystem];
    if (srcSys) {
      const srcStation = srcSys.pois.find(p => p.id === sourcePoi);
      const srcItem = srcStation?.market.find(m => m.item_id === itemId);
      if (srcItem) {
        srcItem.sell_quantity = Math.max(0, srcItem.sell_quantity - quantity);
        if (srcItem.sell_quantity === 0) srcItem.best_sell = null;
      }
    }
    // Reduce demand at dest
    const dstSys = this.data.systems[destSystem];
    if (dstSys) {
      const dstStation = dstSys.pois.find(p => p.id === destPoi);
      const dstItem = dstStation?.market.find(m => m.item_id === itemId);
      if (dstItem) {
        dstItem.buy_quantity = Math.max(0, dstItem.buy_quantity - quantity);
        if (dstItem.buy_quantity === 0) dstItem.best_buy = null;
      }
    }
    this.dirtySystemIds.add(sourceSystem);
    this.dirtySystemIds.add(destSystem);
    this.scheduleSave();
  }

  /** Update player buy/sell orders at a station POI. */
  updateOrders(systemId: string, poiId: string, orders: Array<Record<string, unknown>>): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi) return;

    const existingOrders = new Map((poi.orders || []).map((o) => [o.order_id, o]));

    for (const order of orders) {
      const orderId = (order.order_id as string) || (order.id as string) || "";
      if (!orderId) continue;

      const orderType = (order.order_type as string) || (order.type as string) || "";
      const isBuy = orderType.toLowerCase().includes("buy");

      existingOrders.set(orderId, {
        order_id: orderId,
        player_name: (order.player_name as string) || (order.username as string) || undefined,
        item_id: (order.item_id as string) || "",
        item_name: (order.item_name as string) || (order.name as string) || (order.item_id as string) || "",
        order_type: isBuy ? "buy" : "sell",
        price: (order.price as number) || (order.unit_price as number) || 0,
        quantity: (order.quantity as number) || (order.remaining as number) || 0,
        last_seen: now(),
      });
    }

    poi.orders = [...existingOrders.values()];
    poi.last_updated = now();
    this.scheduleSystemSave(systemId);
  }

  /** Mark a POI as explored (sets last_explored timestamp). */
  markExplored(systemId: string, poiId: string): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi) return;

    poi.last_explored = now();
    poi.last_updated = now();
    this.scheduleSystemSave(systemId);
  }

  /** Get minutes since a POI was last explored. Returns Infinity if never explored. */
  minutesSinceExplored(systemId: string, poiId: string): number {
    const sys = this.data.systems[systemId];
    if (!sys) return Infinity;

    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi || !poi.last_explored) return Infinity;

    return (Date.now() - new Date(poi.last_explored).getTime()) / 60000;
  }

  /** Update available missions at a station POI. */
  updateMissions(systemId: string, poiId: string, missions: Array<Record<string, unknown>>): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi) return;

    poi.missions = missions.map((m) => {
      // Extract reward — handles multiple API formats
      let rewardCredits: number | undefined;
      let rewardItems: string | undefined;
      const reward = m.reward ?? m.rewards ?? m.payout;

      if (typeof reward === "number") {
        rewardCredits = reward;
      } else if (reward && typeof reward === "object") {
        const rObj = reward as Record<string, unknown>;
        rewardCredits = (rObj.credits as number) || (rObj.credit as number) || (rObj.amount as number) || undefined;
        const items = rObj.items ?? rObj.item;
        if (items) rewardItems = typeof items === "string" ? items : JSON.stringify(items);
      }
      rewardCredits = rewardCredits || (m.reward_credits as number) || (m.credits as number) || undefined;
      rewardItems = rewardItems || (m.reward_items as string) || undefined;

      return {
        mission_id: (m.mission_id as string) || (m.id as string) || "",
        title: (m.title as string) || (m.name as string) || "",
        description: (m.description as string) || (m.summary as string) || undefined,
        type: (m.type as string) || (m.mission_type as string) || undefined,
        reward_credits: rewardCredits,
        reward_items: rewardItems,
        level_required: (m.level_required as number) || (m.min_level as number) || undefined,
        expires_at: (m.expires_at as string) || undefined,
        last_seen: now(),
      };
    });

    poi.last_updated = now();
    this.scheduleSystemSave(systemId);
  }

  /** Record ore mined at a POI. Increments totals. */
  recordMiningYield(systemId: string, poiId: string, oreItem: { item_id: string; name: string }): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const poi = sys.pois.find((p) => p.id === poiId);
    if (!poi) return;

    const existing = poi.ores_found.find((o) => o.item_id === oreItem.item_id);
    if (existing) {
      existing.total_mined++;
      existing.times_seen++;
      existing.last_seen = now();
    } else {
      poi.ores_found.push({
        item_id: oreItem.item_id,
        name: oreItem.name,
        total_mined: 1,
        times_seen: 1,
        last_seen: now(),
      });
    }

    this.scheduleSystemSave(systemId);
  }

  /** Record a pirate sighting in a system. */
  recordPirate(systemId: string, info: { player_id?: string; name?: string }): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const key = info.player_id || info.name || "unknown";
    const existing = sys.pirate_sightings.find(
      (p) => (p.player_id && p.player_id === info.player_id) || (p.name && p.name === info.name)
    );

    if (existing) {
      existing.count++;
      existing.last_seen = now();
    } else {
      sys.pirate_sightings.push({
        player_id: info.player_id,
        name: info.name || key,
        count: 1,
        last_seen: now(),
      });
    }

    this.scheduleSystemSave(systemId);
  }

  /** Record a wreck in a system. */
  recordWreck(systemId: string, wreck: { id: string; ship_type: string; wreck_type?: string; poi_id?: string; expires_at?: string }): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;

    const existing = sys.wrecks.find((w) => w.id === wreck.id);
    if (existing) {
      existing.last_seen = now();
      existing.ship_type = wreck.ship_type || existing.ship_type;
    } else {
      sys.wrecks.push({
        id: wreck.id,
        ship_type: wreck.ship_type,
        wreck_type: wreck.wreck_type,
        poi_id: wreck.poi_id,
        expires_at: wreck.expires_at,
        last_seen: now(),
      });
    }

    this.scheduleSystemSave(systemId);
  }

  // ── Query methods ───────────────────────────────────────

  /** Get stored system data by ID. */
  getSystem(id: string): StoredSystem | null {
    return this.data.systems[id] ?? null;
  }

  /** Return all stored system IDs. */
  getAllSystemIds(): string[] {
    return Object.keys(this.data.systems);
  }

  /** How many systems are currently in memory (useful for bootstrap decisions). */
  getSystemCount(): number {
    return Object.keys(this.data.systems).length;
  }

  /**
   * Seed map topology from a pre-saved JSON file (e.g. data/galaxy_bootstrap.json).
   * Same format as the /api/map response: { systems: [{id, name, connections, pois?, security_level?}] }.
   * Only inserts systems that are NOT already known (non-destructive).
   * Returns the number of new systems inserted.
   */
  seedFromBootstrapFile(filePath?: string): number {
    const path = filePath ?? join(DATA_DIR, "galaxy_bootstrap.json");
    if (!existsSync(path)) return 0;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      const systems = Array.isArray(raw.systems)
        ? (raw.systems as Array<Record<string, unknown>>)
        : [];
      if (systems.length === 0) return 0;

      const nameById = new Map<string, string>();
      for (const sys of systems) {
        if (sys.id && sys.name) nameById.set(sys.id as string, sys.name as string);
      }

      let inserted = 0;
      for (const sys of systems) {
        const id = sys.id as string;
        if (!id || this.data.systems[id]) continue; // skip already-known systems
        const rawConns = sys.connections;
        const connections: Array<Record<string, unknown>> = Array.isArray(rawConns)
          ? (rawConns as Array<string | Record<string, unknown>>).map((conn) =>
              typeof conn === "string"
                ? { system_id: conn, system_name: nameById.get(conn) || conn }
                : conn as Record<string, unknown> // already a {system_id, system_name} object
            )
          : [];
        this.updateSystem({ ...sys, connections });
        inserted++;
      }
      return inserted;
    } catch {
      return 0;
    }
  }

  /** Mark a POI as having no dockable base — called when dock returns "No base at this location". */
  markNoBase(systemId: string, poiId: string): void {
    const sys = this.data.systems[systemId];
    if (!sys) return;
    const poi = sys.pois.find(p => p.id === poiId);
    if (poi && poi.has_base) {
      poi.has_base = false;
      this.scheduleSystemSave(systemId);
    }
  }

  /** Find nearest station POI within a known system. */
  findNearestStation(systemId: string): StoredPOI | null {
    const sys = this.data.systems[systemId];
    if (!sys) return null;
    return sys.pois.find((p) => p.has_base) ?? null;
  }

  /** BFS to find the nearest known system that has a station. Returns { systemId, poiId, hops } or null. */
  findNearestStationSystem(fromSystemId: string): { systemId: string; poiId: string; poiName: string; hops: number } | null {
    // Check current system first
    const localStation = this.findNearestStation(fromSystemId);
    if (localStation) return { systemId: fromSystemId, poiId: localStation.id, poiName: localStation.name, hops: 0 };

    const visited = new Set<string>([fromSystemId]);
    const queue: Array<{ id: string; hops: number }> = [{ id: fromSystemId, hops: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const conns = this.data.systems[current.id]?.connections ?? [];

      for (const conn of conns) {
        const nextId = conn.system_id;
        if (!nextId || visited.has(nextId)) continue;
        visited.add(nextId);

        const station = this.findNearestStation(nextId);
        if (station) {
          return { systemId: nextId, poiId: station.id, poiName: station.name, hops: current.hops + 1 };
        }
        queue.push({ id: nextId, hops: current.hops + 1 });
      }
    }

    return null;
  }

  /**
   * Get a representative price for an item at a specific station POI.
   *
   * - `side = 'sell_to_market'` → we want to SELL this item → look for buy orders
   *   (buyers willing to pay). Returns best_buy or VW-avg of buy orders.
   * - `side = 'buy_from_market'` → we want to BUY this item → look for sell orders
   *   (sellers asking). Returns best_sell or VW-avg of sell orders.
   *
   * Uses volume-weighted average across individual orders when available,
   * falls back to the MarketRecord summary price.
   */
  getPriceAt(itemId: string, poiId: string, side: 'sell_to_market' | 'buy_from_market'): number | null {
    const orderType: OrderRecord['order_type'] = side === 'sell_to_market' ? 'buy' : 'sell';

    for (const sys of Object.values(this.data.systems)) {
      const poi = sys.pois.find(p => p.id === poiId);
      if (!poi) continue;

      // Try individual order book first — volume-weighted average
      const relevant = poi.orders.filter(
        o => o.item_id === itemId && o.order_type === orderType && o.quantity > 0 && o.price > 0
      );
      if (relevant.length > 0) {
        const totalVol = relevant.reduce((s, o) => s + o.quantity, 0);
        const vwPrice  = relevant.reduce((s, o) => s + o.price * o.quantity, 0) / totalVol;
        return Math.round(vwPrice);
      }

      // Fallback: MarketRecord summary
      const rec = poi.market.find(m => m.item_id === itemId);
      if (!rec) return null;
      return side === 'sell_to_market' ? rec.best_buy : rec.best_sell;
    }
    return null;
  }

  /**
   * Get the best sell-to-market price for an item across ALL known stations.
   * Used by crafter to find where to sell crafted output.
   */
  getBestSellToMarketPrice(itemId: string): { poiId: string; poiName: string; systemId: string; price: number } | null {
    let best: { poiId: string; poiName: string; systemId: string; price: number } | null = null;
    for (const [sysId, sys] of Object.entries(this.data.systems)) {
      for (const poi of sys.pois) {
        const price = this.getPriceAt(itemId, poi.id, 'sell_to_market');
        if (price !== null && (best === null || price > best.price)) {
          best = { poiId: poi.id, poiName: poi.name, systemId: sysId, price };
        }
      }
    }
    return best;
  }

  /** Find the best sell price for an item across all known markets. */
  findBestSellPrice(itemId: string): { systemId: string; poiId: string; poiName: string; price: number } | null {
    let best: { systemId: string; poiId: string; poiName: string; price: number } | null = null;

    for (const [sysId, sys] of Object.entries(this.data.systems)) {
      for (const poi of sys.pois) {
        for (const m of poi.market) {
          if (m.item_id === itemId && m.best_sell !== null) {
            if (!best || m.best_sell > best.price) {
              best = { systemId: sysId, poiId: poi.id, poiName: poi.name, price: m.best_sell };
            }
          }
        }
      }
    }

    return best;
  }

  /** Get list of all known system IDs. */
  getKnownSystems(): string[] {
    return Object.keys(this.data.systems);
  }

  /** Get connections for a system. */
  getConnections(systemId: string): StoredConnection[] {
    return this.data.systems[systemId]?.connections ?? [];
  }

  /** Find all locations where a specific ore has been mined, sorted by total_mined descending. */
  findOreLocations(oreId: string): Array<{
    systemId: string;
    systemName: string;
    poiId: string;
    poiName: string;
    totalMined: number;
    hasStation: boolean;
  }> {
    const results: Array<{
      systemId: string;
      systemName: string;
      poiId: string;
      poiName: string;
      totalMined: number;
      hasStation: boolean;
    }> = [];

    for (const [sysId, sys] of Object.entries(this.data.systems)) {
      const hasStation = sys.pois.some((p) => p.has_base);
      for (const poi of sys.pois) {
        const ore = poi.ores_found.find((o) => o.item_id === oreId);
        if (ore) {
          results.push({
            systemId: sysId,
            systemName: sys.name || sysId,
            poiId: poi.id,
            poiName: poi.name || poi.id,
            totalMined: ore.total_mined,
            hasStation,
          });
        }
      }
    }

    results.sort((a, b) => b.totalMined - a.totalMined);
    return results;
  }

  /** BFS pathfinding between two systems using known connections + active wormholes. Returns system IDs in order, or null if no path. */
  findRoute(fromSystemId: string, toSystemId: string): string[] | null {
    if (fromSystemId === toSystemId) return [fromSystemId];

    const cacheKey = `${fromSystemId}→${toSystemId}`;
    if (this.routeCache.has(cacheKey)) return this.routeCache.get(cacheKey)!;

    // Build wormhole edge index: entranceSystemId → {exitSystemId, entrancePoiId}
    const wormholeEdges = new Map<string, Array<{ exitSystem: string; poiId: string }>>();
    if (this._wormholesDb) {
      for (const wh of this._wormholesDb.getActive()) {
        if (!wh.entrance_system_id || !wh.exit_system_id) continue;
        const list = wormholeEdges.get(wh.entrance_system_id) ?? [];
        list.push({ exitSystem: wh.exit_system_id, poiId: wh.entrance_poi_id });
        wormholeEdges.set(wh.entrance_system_id, list);
      }
    }

    const visited = new Set<string>([fromSystemId]);
    const queue: Array<{ id: string; path: string[] }> = [
      { id: fromSystemId, path: [fromSystemId] },
    ];

    let result: string[] | null = null;
    while (queue.length > 0) {
      const current = queue.shift()!;
      const conns = this.data.systems[current.id]?.connections ?? [];

      // Regular hyperspace connections
      for (const conn of conns) {
        const nextId = conn.system_id;
        if (!nextId || visited.has(nextId)) continue;
        const newPath = [...current.path, nextId];
        if (nextId === toSystemId) { result = newPath; break; }
        visited.add(nextId);
        queue.push({ id: nextId, path: newPath });
      }
      if (result) break;

      // Wormhole shortcuts (one-way)
      for (const wh of (wormholeEdges.get(current.id) ?? [])) {
        const nextId = wh.exitSystem;
        if (!nextId || visited.has(nextId)) continue;
        const newPath = [...current.path, nextId];
        if (nextId === toSystemId) { result = newPath; break; }
        visited.add(nextId);
        queue.push({ id: nextId, path: newPath });
      }
      if (result) break;
    }

    this.routeCache.set(cacheKey, result);
    return result;
  }

  /**
   * Detailed route with per-hop metadata. Each hop includes the target system
   * and, if the jump uses a wormhole, the entrance POI ID to travel to first.
   * Returns null if no route found.
   */
  findDetailedRoute(
    fromSystemId: string,
    toSystemId: string,
  ): Array<{ systemId: string; wormholeEntrancePoi?: string }> | null {
    if (fromSystemId === toSystemId) return [{ systemId: fromSystemId }];

    // Build wormhole edge index
    const wormholeEdges = new Map<string, Array<{ exitSystem: string; poiId: string }>>();
    if (this._wormholesDb) {
      for (const wh of this._wormholesDb.getActive()) {
        if (!wh.entrance_system_id || !wh.exit_system_id) continue;
        const list = wormholeEdges.get(wh.entrance_system_id) ?? [];
        list.push({ exitSystem: wh.exit_system_id, poiId: wh.entrance_poi_id });
        wormholeEdges.set(wh.entrance_system_id, list);
      }
    }

    type HopMeta = { systemId: string; wormholeEntrancePoi?: string };
    const visited = new Set<string>([fromSystemId]);
    const queue: Array<{ id: string; path: HopMeta[] }> = [
      { id: fromSystemId, path: [{ systemId: fromSystemId }] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const conns = this.data.systems[current.id]?.connections ?? [];

      for (const conn of conns) {
        const nextId = conn.system_id;
        if (!nextId || visited.has(nextId)) continue;
        const newPath = [...current.path, { systemId: nextId }];
        if (nextId === toSystemId) return newPath;
        visited.add(nextId);
        queue.push({ id: nextId, path: newPath });
      }

      for (const wh of (wormholeEdges.get(current.id) ?? [])) {
        const nextId = wh.exitSystem;
        if (!nextId || visited.has(nextId)) continue;
        const newPath = [...current.path, { systemId: nextId, wormholeEntrancePoi: wh.poiId }];
        if (nextId === toSystemId) return newPath;
        visited.add(nextId);
        queue.push({ id: nextId, path: newPath });
      }
    }

    return null;
  }

  /** Get all unique ores found across all systems. Returns [{item_id, name}]. */
  getAllKnownOres(): Array<{ item_id: string; name: string }> {
    const ores = new Map<string, string>();
    for (const sys of Object.values(this.data.systems)) {
      for (const poi of sys.pois) {
        for (const ore of poi.ores_found) {
          if (ore.item_id && !ores.has(ore.item_id)) {
            ores.set(ore.item_id, ore.name || ore.item_id);
          }
        }
      }
    }
    return [...ores.entries()]
      .map(([item_id, name]) => ({ item_id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Find the best buy price (highest buyer) for an item across all known markets. */
  findBestBuyPrice(itemId: string): { systemId: string; poiId: string; poiName: string; price: number; quantity: number } | null {
    let best: { systemId: string; poiId: string; poiName: string; price: number; quantity: number } | null = null;

    for (const [sysId, sys] of Object.entries(this.data.systems)) {
      for (const poi of sys.pois) {
        for (const m of poi.market) {
          if (m.item_id === itemId && m.best_buy !== null && m.buy_quantity > 0) {
            if (!best || m.best_buy > best.price) {
              best = { systemId: sysId, poiId: poi.id, poiName: poi.name, price: m.best_buy, quantity: m.buy_quantity };
            }
          }
        }
      }
    }

    return best;
  }

  /** Find all items with buy orders across all known stations. */
  getAllBuyDemand(): Array<{ itemId: string; itemName: string; systemId: string; poiId: string; poiName: string; price: number; quantity: number }> {
    const results: Array<{ itemId: string; itemName: string; systemId: string; poiId: string; poiName: string; price: number; quantity: number }> = [];

    for (const [sysId, sys] of Object.entries(this.data.systems)) {
      for (const poi of sys.pois) {
        for (const m of poi.market) {
          if (m.best_buy !== null && m.buy_quantity > 0) {
            results.push({
              itemId: m.item_id,
              itemName: m.item_name,
              systemId: sysId,
              poiId: poi.id,
              poiName: poi.name,
              price: m.best_buy,
              quantity: m.buy_quantity,
            });
          }
        }
      }
    }

    return results;
  }

  /** Find price spreads for an item or all items between stations.
   *  Returns opportunities where an item can be bought cheaply and sold at a higher price. */
  findPriceSpreads(itemId?: string): Array<{
    itemId: string; itemName: string;
    sourceSystem: string; sourcePoi: string; sourcePoiName: string; buyAt: number; buyQty: number;
    destSystem: string; destPoi: string; destPoiName: string; sellAt: number; sellQty: number;
    spread: number;
  }> {
    // Collect all sell listings (where we can buy from NPC market)
    const sellListings: Array<{ itemId: string; itemName: string; systemId: string; poiId: string; poiName: string; price: number; quantity: number }> = [];
    // Collect all buy listings (where we can sell to NPC market / fill buy orders)
    const buyListings: Array<{ itemId: string; itemName: string; systemId: string; poiId: string; poiName: string; price: number; quantity: number }> = [];

    for (const [sysId, sys] of Object.entries(this.data.systems)) {
      for (const poi of sys.pois) {
        for (const m of poi.market) {
          if (itemId && m.item_id !== itemId) continue;
          if (m.best_sell !== null && m.best_sell > 0 && m.sell_quantity > 0) {
            sellListings.push({ itemId: m.item_id, itemName: m.item_name, systemId: sysId, poiId: poi.id, poiName: poi.name, price: m.best_sell, quantity: m.sell_quantity });
          }
          if (m.best_buy !== null && m.best_buy > 0 && m.buy_quantity > 0) {
            buyListings.push({ itemId: m.item_id, itemName: m.item_name, systemId: sysId, poiId: poi.id, poiName: poi.name, price: m.best_buy, quantity: m.buy_quantity });
          }
        }
      }
    }

    const results: Array<{
      itemId: string; itemName: string;
      sourceSystem: string; sourcePoi: string; sourcePoiName: string; buyAt: number; buyQty: number;
      destSystem: string; destPoi: string; destPoiName: string; sellAt: number; sellQty: number;
      spread: number;
    }> = [];

    // Match: buy cheaply at source (sell listing), sell expensively at dest (buy listing)
    for (const sell of sellListings) {
      for (const buy of buyListings) {
        if (sell.itemId !== buy.itemId) continue;
        if (sell.systemId === buy.systemId && sell.poiId === buy.poiId) continue; // same station
        const spread = buy.price - sell.price;
        if (spread <= 0) continue;

        results.push({
          itemId: sell.itemId,
          itemName: sell.itemName,
          sourceSystem: sell.systemId,
          sourcePoi: sell.poiId,
          sourcePoiName: sell.poiName,
          buyAt: sell.price,
          buyQty: sell.quantity,
          destSystem: buy.systemId,
          destPoi: buy.poiId,
          destPoiName: buy.poiName,
          sellAt: buy.price,
          sellQty: buy.quantity,
          spread,
        });
      }
    }

    results.sort((a, b) => b.spread - a.spread);
    return results;
  }

  /**
   * Seed the galaxy map from the public /api/map endpoint.
   * Adds all systems and their connections without requiring any bot session.
   * Existing POI, market, and ore data is preserved — only system metadata
   * and connection graphs are updated.
   */
  async seedFromMapAPI(): Promise<{ seeded: number; known: number; failed: boolean }> {
    const MAP_API_URL = "https://game.spacemolt.com/api/map";
    let raw: Record<string, unknown>;
    try {
      raw = await cachedFetch<Record<string, unknown>>(MAP_API_URL, 30 * 60_000, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { seeded: 0, known: 0, failed: true };
    }
    try {
      const systems = Array.isArray(raw.systems)
        ? (raw.systems as Array<Record<string, unknown>>)
        : [];

      if (systems.length === 0) return { seeded: 0, known: 0, failed: true };

      // Build ID → name lookup so connections can be resolved to names
      const nameById = new Map<string, string>();
      for (const sys of systems) {
        const id = sys.id as string;
        const name = sys.name as string;
        if (id && name) nameById.set(id, name);
      }

      let seeded = 0;
      let known = 0;

      for (const sys of systems) {
        const id = sys.id as string;
        if (!id) continue;

        if (this.data.systems[id]) {
          known++;
        } else {
          seeded++;
        }

        // Transform connection ID array → StoredConnection objects
        const rawConns = sys.connections;
        const connections: Array<Record<string, unknown>> = Array.isArray(rawConns)
          ? (rawConns as string[]).map((connId) => ({
              system_id: connId,
              system_name: nameById.get(connId) || connId,
            }))
          : [];

        this.updateSystem({ ...sys, connections });
      }

      return { seeded, known, failed: false };
    } catch {
      return { seeded: 0, known: 0, failed: true };
    }
  }

  /**
   * Wipe all systems from in-memory store, SQLite, and the JSON cache file.
   * Called before a force-refresh so stale/removed systems don't persist.
   */
  clearAll(): void {
    this.data = { version: 1, last_saved: now(), systems: {} };
    this.routeCache.clear();
    if (this._db) {
      this._db.run("DELETE FROM map_systems");
    }
    if (existsSync(MAP_FILE)) {
      writeFileSync(MAP_FILE, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
    }
    console.log("[MapStore] Cleared all system data");
  }

  /** Return the full systems map for the web dashboard. */
  getAllSystems(): Record<string, StoredSystem> {
    return this.data.systems;
  }

  /** Formatted summary string for menu display. */
  getSummary(): string {
    const systems = Object.values(this.data.systems);
    if (systems.length === 0) {
      return "Galaxy map is empty. Start a bot to begin mapping!";
    }

    const lines: string[] = [];
    lines.push(`=== Galaxy Map ===`);
    lines.push(`Known systems: ${systems.length}`);
    lines.push(`Last saved: ${this.data.last_saved}`);
    lines.push("");

    for (const sys of systems) {
      const security = sys.security_level ? ` [${sys.security_level}]` : "";
      lines.push(`--- ${sys.name || sys.id}${security} ---`);

      if (sys.connections.length > 0) {
        lines.push(`  Connections: ${sys.connections.map((c) => c.system_name || c.system_id).join(", ")}`);
      }

      // Show asteroid belts first with ore details
      const belts = sys.pois.filter((p) => p.type.toLowerCase().includes("asteroid"));
      const others = sys.pois.filter((p) => !p.type.toLowerCase().includes("asteroid"));

      for (const poi of belts) {
        const oreList = poi.ores_found.length > 0
          ? poi.ores_found.map((o) => `${o.name} x${o.total_mined}`).join(", ")
          : "no data yet";
        lines.push(`  * ${poi.name} [${poi.type}]`);
        lines.push(`    Ores: ${oreList}`);
      }

      for (const poi of others) {
        const base = poi.has_base ? ` (${poi.base_name || "base"})` : "";
        lines.push(`  ${poi.name} [${poi.type}]${base}`);

        if (poi.market.length > 0) {
          const prices = poi.market
            .filter((m) => m.best_sell !== null || m.best_buy !== null)
            .map((m) => {
              const parts = [m.item_name];
              if (m.best_buy !== null) parts.push(`buy:${m.best_buy}`);
              if (m.best_sell !== null) parts.push(`sell:${m.best_sell}`);
              return parts.join(" ");
            });
          if (prices.length > 0) {
            lines.push(`    Market: ${prices.join(" | ")}`);
          }
        }
      }

      if (sys.pirate_sightings.length > 0) {
        const pirates = sys.pirate_sightings.map((p) => `${p.name || p.player_id} (x${p.count})`).join(", ");
        lines.push(`  Pirates: ${pirates}`);
      }

      if (sys.wrecks.length > 0) {
        lines.push(`  Wrecks: ${sys.wrecks.length}`);
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  // ── DataSync helpers ─────────────────────────────────────

  /**
   * Return all systems updated after the given timestamp (for push/pull sync).
   * Used by the slow topology sync path.
   */
  getSystemsSince(since: Date): StoredSystem[] {
    const sinceMs = since.getTime();
    return Object.values(this.data.systems).filter(
      (s) => new Date(s.last_updated).getTime() > sinceMs
    );
  }

  /**
   * Merge an array of StoredSystem objects from a remote VM.
   * Newer last_updated wins; route cache is cleared if topology changed.
   */
  mergeSystems(systems: StoredSystem[]): void {
    let topologyChanged = false;
    for (const incoming of systems) {
      if (!incoming.id) continue;
      const existing = this.data.systems[incoming.id];
      if (existing && new Date(existing.last_updated) >= new Date(incoming.last_updated)) continue;
      if (existing && incoming.connections.length !== existing.connections.length) topologyChanged = true;
      this.data.systems[incoming.id] = incoming;
      this.scheduleSystemSave(incoming.id);
    }
    if (topologyChanged) this.routeCache.clear();
  }

  /**
   * Return lightweight fast-patches (market + pirate data only) for systems
   * updated after the given timestamp. Used by the high-frequency sync path.
   */
  getFastPatchesSince(since: Date): FastPatch[] {
    const sinceMs = since.getTime();
    const patches: FastPatch[] = [];
    for (const sys of Object.values(this.data.systems)) {
      if (new Date(sys.last_updated).getTime() <= sinceMs) continue;
      const market_updates = sys.pois
        .filter(p => p.market.length > 0 || p.orders.length > 0)
        .map(p => ({ poi_id: p.id, market: p.market, orders: p.orders, last_updated: p.last_updated }));
      if (market_updates.length === 0 && sys.pirate_sightings.length === 0) continue;
      patches.push({
        system_id: sys.id,
        last_updated: sys.last_updated,
        market_updates,
        pirate_sightings: sys.pirate_sightings,
      });
    }
    return patches;
  }

  /**
   * Apply lightweight fast-patches from a remote VM.
   * Only updates market/orders/pirate data; never overwrites topology or ore records.
   */
  // ── Faction storage availability cache ───────────────────────────────────

  private factionStorageCache = new Map<string, { available: boolean; checkedAt: number }>();
  private static readonly FACTION_STORAGE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  /** Connect the faction storage DB (called once after database is ready). */
  connectToFactionStorageDb(db: FactionStorageDb): void {
    this._factionStorageDb = db;
  }

  /** Connect the needs matrix DB (called once after database is ready). */
  connectToNeedsMatrixDb(db: NeedsMatrixDb): void {
    this._needsMatrixDb = db;
  }

  /** Connect the deposits DB (called once after database is ready). */
  connectToDepositsDb(db: DepositsDb): void {
    this._depositsDb = db;
  }

  /** Connect the wormholes DB (called once after database is ready). */
  connectToWormholesDb(db: WormholesDb): void {
    this._wormholesDb = db;
    this.routeCache.clear(); // wormholes change routing
  }

  // ── Wormholes DB delegates ──────────────────────────────────────────

  /** Upsert a wormhole record (discovered via survey_system / get_poi). Clears route cache. */
  upsertWormhole(entry: Parameters<WormholesDb["upsert"]>[0]): void {
    this._wormholesDb?.upsert(entry);
    this.routeCache.clear();
  }

  /** Mark a wormhole as collapsed (remnant stage). Clears route cache. */
  markWormholeCollapsed(entrancePoiId: string): void {
    this._wormholesDb?.markCollapsed(entrancePoiId);
    this.routeCache.clear();
  }

  /** Mark a wormhole as seen (confirms still active). */
  markWormholeSeen(entrancePoiId: string): void {
    this._wormholesDb?.markSeen(entrancePoiId);
  }

  /** All active (non-collapsed) wormholes. */
  getActiveWormholes(): WormholeEntry[] {
    return this._wormholesDb?.getActive() ?? [];
  }

  /** All wormholes including collapsed remnants. */
  getAllWormholes(): WormholeEntry[] {
    return this._wormholesDb?.getAll() ?? [];
  }

  /** Wormholes whose entrance is in the given system. */
  getWormholesBySystem(systemId: string): WormholeEntry[] {
    return this._wormholesDb?.getBySystem(systemId) ?? [];
  }

  /** Single wormhole by entrance POI ID. */
  getWormhole(entrancePoiId: string): WormholeEntry | null {
    return this._wormholesDb?.get(entrancePoiId) ?? null;
  }

  /** Prune old/stale wormhole records. */
  pruneWormholes(collapsedHours = 12, maxAgeDays = 6): void {
    this._wormholesDb?.pruneOld(collapsedHours, maxAgeDays);
  }

  // ── Resource Deposits DB delegates ────────────────────────────────

  /**
   * Update deposit records for a POI from raw API resource data.
   * Called by miner / gas_harvester / ice_harvester / explorer after a get_poi or survey_system.
   */
  updateDeposits(
    poiId: string,
    systemId: string,
    systemName: string,
    poiName: string,
    poiType: string,
    resources: Array<Record<string, unknown>>,
    by: string,
  ): void {
    if (!this._depositsDb || resources.length === 0) return;
    const now = new Date().toISOString();
    const records: DepositRecord[] = resources.map(r => {
      const resourceId = (r.resource_id as string) || (r.id as string) || (r.ore_id as string) || "";
      const resourceName = (r.name as string) || (r.resource_name as string) || resourceId;
      const raw = resourceId.toLowerCase();
      const category =
        raw.includes("gas") || raw.includes("helium") || raw.includes("hydrogen") ? "gas"
        : raw.includes("ice") || raw.includes("water") ? "ice"
        : raw.includes("crystal") ? "crystal"
        : "ore";
      return {
        poi_id: poiId,
        system_id: systemId,
        system_name: systemName,
        poi_name: poiName,
        poi_type: poiType,
        resource_id: resourceId,
        resource_name: resourceName,
        category,
        remaining: (r.remaining as number) ?? (r.quantity as number) ?? 0,
        quality: (r.quality as number) ?? (r.richness as number) ?? 0,
        depletion_pct: (r.depletion_percent as number) ?? (r.depletion as number) ?? 0,
        last_seen_at: now,
        last_seen_by: by,
      };
    }).filter(r => r.resource_id);
    this._depositsDb.upsertBatch(records);
  }

  /** All deposits for a system. */
  getDepositsInSystem(systemId: string): DepositRecord[] {
    return this._depositsDb?.getBySystem(systemId) ?? [];
  }

  /** All known deposits. */
  getAllDeposits(): DepositRecord[] {
    return this._depositsDb?.getAll() ?? [];
  }

  /** Find best deposit for a resource (optionally prefer a system). */
  findBestDeposit(resourceId: string, preferSystemId?: string): DepositRecord | null {
    return this._depositsDb?.findBest(resourceId, preferSystemId) ?? null;
  }

  /** Systems that have at least one non-depleted deposit (for map markers). */
  getSystemsWithDeposits(): Array<{ system_id: string; system_name: string; count: number }> {
    return this._depositsDb?.getSystemsWithDeposits() ?? [];
  }

  /** Summary grouped by poi+category for map overlay. */
  getDepositsSummary() {
    return this._depositsDb?.getSummaryBySystem() ?? [];
  }

  /**
   * Optional live provider: called when DB is empty to return in-memory bot faction storage.
   * Wired by botmanager so the All Storages tab shows data immediately even before DB is populated.
   */
  private _liveFactionStorageProvider?: () => FactionStorageEntry[];

  setLiveFactionStorageProvider(fn: () => FactionStorageEntry[]): void {
    this._liveFactionStorageProvider = fn;
  }

  /** Record whether a station has faction storage. Call after any faction_deposit_items attempt. */
  setFactionStorage(stationId: string, available: boolean): void {
    this.factionStorageCache.set(stationId, { available, checkedAt: Date.now() });
  }

  /**
   * Check cached faction storage availability for a station.
   * Returns true/false if known and fresh, null if unknown or stale.
   */
  hasFactionStorage(stationId: string): boolean | null {
    const rec = this.factionStorageCache.get(stationId);
    if (!rec) return null;
    if (Date.now() - rec.checkedAt > MapStore.FACTION_STORAGE_TTL_MS) return null;
    return rec.available;
  }

  // ── Faction storage DB delegates ─────────────────────────────

  /** Full replace of faction storage items at a POI (from view_faction_storage success). */
  updateFactionStorageItems(
    poiId: string,
    systemId: string,
    systemName: string,
    poiName: string,
    items: Array<{ item_id: string; name?: string; item_name?: string; quantity: number }>,
  ): void {
    this.setFactionStorage(poiId, true);
    this._factionStorageDb?.updateItems(poiId, systemId, systemName, poiName, items);
  }

  /** Optimistic ±delta for one item after a deposit/withdraw. */
  adjustFactionStorageItem(poiId: string, itemId: string, delta: number): void {
    this._factionStorageDb?.adjustQuantity(poiId, itemId, delta);
  }

  /** Clear all items at a POI when view_faction_storage returns "no facility" error. */
  clearFactionStorageItems(poiId: string): void {
    this.setFactionStorage(poiId, false);
    this._factionStorageDb?.clearItems(poiId);
  }

  /** Return all faction storage items across all POIs (for UI / gatherer use). */
  getAllFactionStorageItems(): FactionStorageEntry[] {
    const dbItems = this._factionStorageDb?.getAllItems() ?? [];
    if (dbItems.length > 0) return dbItems;
    // Fallback: synthesize from in-memory bot faction storage (before DB is populated on first run)
    return this._liveFactionStorageProvider?.() ?? [];
  }

  /** Return faction storage items at a specific POI. */
  getFactionStorageItemsForPoi(poiId: string): FactionStorageEntry[] {
    return this._factionStorageDb?.getItemsForPoi(poiId) ?? [];
  }

  /** Return total quantity of an item across all faction storages. */
  getFactionStorageTotalFor(itemId: string): number {
    return this._factionStorageDb?.getTotalQuantity(itemId) ?? 0;
  }

  /** Upsert faction building records (from facility { action:'list' } response). */
  updateFactionBuildings(buildings: Parameters<FactionStorageDb['updateBuildings']>[0]): void {
    this._factionStorageDb?.updateBuildings(buildings);
  }

  /**
   * Faction storage facility types that determine per-item storage capacity.
   * A higher-level storage facility raises the per-item cap above the default 100k.
   */
  private static readonly STORAGE_FACILITY_TYPES = new Set([
    'faction_lockbox', 'faction_warehouse', 'faction_depot',
  ]);

  /** Per-item faction storage cap (units) by facility level. */
  private static readonly FACTION_STORAGE_CAPS: Record<number, number> = {
    1: 100_000,
    2: 200_000,
    3: 300_000,
    4: 500_000,
  };

  /**
   * Return the per-item faction storage cap at a given POI.
   * Looks up the storage-type facility installed there and maps its level to a cap.
   * Falls back to 100,000 (L1 default) when no DB data is available.
   */
  getFactionStorageCapPerItem(poiId: string): number {
    if (!this._factionStorageDb) return 100_000;
    const buildings = this._factionStorageDb.getBuildingsForPoi(poiId);
    let maxLevel = 1;
    for (const b of buildings) {
      const isStorage =
        MapStore.STORAGE_FACILITY_TYPES.has(b.facility_type) ||
        b.faction_service?.toLowerCase().includes('storage');
      if (isStorage && b.level > maxLevel) maxLevel = b.level;
    }
    return MapStore.FACTION_STORAGE_CAPS[maxLevel] ?? 500_000;
  }

  /** Return all known faction buildings. */
  getAllFactionBuildings(): FactionBuildingEntry[] {
    return this._factionStorageDb?.getAllBuildings() ?? [];
  }

  /** Return faction buildings in a specific system. */
  getFactionBuildingsInSystem(systemId: string): FactionBuildingEntry[] {
    return this._factionStorageDb?.getBuildingsInSystem(systemId) ?? [];
  }

  // ── Needs Matrix ─────────────────────────────────────────────

  /** Set or update the coordinator's target for an item. */
  setNeedsMatrixTarget(
    itemId: string,
    itemName: string,
    category: string,
    targetQty: number,
    source: 'mine' | 'buy' | 'craft',
    priority = 50,
  ): void {
    this._needsMatrixDb?.setTarget(itemId, itemName, category, targetQty, source, priority);
  }

  /**
   * Bulk-replace all coordinator targets for a given source type.
   * Called by coordinator after computing oreQuotas / craft needs.
   */
  replaceNeedsMatrixTargets(
    source: 'mine' | 'buy' | 'craft',
    entries: Array<{ itemId: string; itemName: string; category: string; targetQty: number; priority?: number }>,
  ): void {
    this._needsMatrixDb?.replaceTargetsBySource(source, entries);
  }

  /** Update current qty from a faction storage snapshot (called after view_faction_storage). */
  updateNeedsMatrixCurrent(itemId: string, currentQty: number, updatedBy: string): void {
    this._needsMatrixDb?.updateCurrent(itemId, currentQty, updatedBy);
  }

  /** Optimistic ±delta after faction_deposit/withdraw. */
  adjustNeedsMatrixCurrent(itemId: string, delta: number, updatedBy: string): void {
    this._needsMatrixDb?.adjustCurrent(itemId, delta, updatedBy);
  }

  /** All needs matrix entries sorted by deficit descending. */
  getAllNeedsMatrix(): NeedsMatrixEntry[] {
    return this._needsMatrixDb?.getAll() ?? [];
  }

  /** Needs matrix entries for a specific source, sorted by deficit. */
  getNeedsMatrixBySource(source: 'mine' | 'buy' | 'craft'): NeedsMatrixEntry[] {
    return this._needsMatrixDb?.getBySource(source) ?? [];
  }

  /** Top N items with a positive deficit for the given source. */
  getTopNeedsMatrixDeficits(source: 'mine' | 'buy' | 'craft', limit = 10): NeedsMatrixEntry[] {
    return this._needsMatrixDb?.getTopDeficits(source, limit) ?? [];
  }

  /** Single needs matrix entry for a given item_id. */
  getNeedsMatrixItem(itemId: string): NeedsMatrixEntry | null {
    return this._needsMatrixDb?.getItem(itemId) ?? null;
  }

  applyFastPatches(patches: FastPatch[]): void {
    for (const patch of patches) {
      const sys = this.data.systems[patch.system_id];
      if (!sys) continue; // unknown system — skip (topology sync will add it later)

      // Market + orders updates
      for (const mu of patch.market_updates ?? []) {
        const poi = sys.pois.find(p => p.id === mu.poi_id);
        if (!poi) continue;
        const incomingMs = new Date(mu.last_updated).getTime();
        const existingMs = new Date(poi.last_updated).getTime();
        if (incomingMs <= existingMs) continue; // already have newer data
        poi.market = mu.market;
        if (mu.orders) poi.orders = mu.orders;
        poi.last_updated = mu.last_updated;
      }

      // Pirate sightings — merge by player_id/name, keep higher count
      for (const incoming of patch.pirate_sightings ?? []) {
        const key = incoming.player_id || incoming.name || "";
        if (!key) continue;
        const existing = sys.pirate_sightings.find(
          p => (p.player_id && p.player_id === incoming.player_id) || (p.name && p.name === incoming.name)
        );
        if (existing) {
          if (incoming.count > existing.count) {
            existing.count = incoming.count;
            existing.last_seen = incoming.last_seen;
          }
        } else {
          sys.pirate_sightings.push(incoming);
        }
      }

      this.scheduleSystemSave(patch.system_id);
    }
  }
}

function now(): string {
  return new Date().toISOString();
}

/** Singleton instance shared by all bots. */
export const mapStore = new MapStore();
