/**
 * MarketPricesStore — structured per-station/per-item market data.
 *
 * Persists the CURRENT state of known markets (latest prices + quantities)
 * into the `market_prices` SQLite table.  Unlike the MapStore which stores
 * everything as opaque JSON blobs, this table is fully indexable and can be
 * queried for trade-route analysis, auto-buy decisions, and smart-selector
 * scoring without parsing any JSON.
 *
 * Also writes time-series rows to `market_history` for trend analysis and
 * training-data purposes.
 */

import type { Database } from "bun:sqlite";

export interface MarketPriceRow {
  station_id: string;
  system_id: string;
  station_name: string;
  system_name: string;
  item_id: string;
  item_name: string;
  sell_price: number | null;   // station sells to player
  sell_quantity: number;
  buy_price: number | null;    // station buys from player
  buy_quantity: number;
  updated_at: string;
  updated_by: string;
}

export interface CheapestSource {
  station_id: string;
  system_id: string;
  station_name: string;
  system_name: string;
  price: number;
  quantity: number;
}

export interface BestBuyer {
  station_id: string;
  system_id: string;
  station_name: string;
  system_name: string;
  price: number;
  quantity: number;
}

export interface TradeRoute {
  item_id: string;
  item_name: string;
  buy_station_id: string;
  buy_station_name: string;
  buy_system_id: string;
  buy_system_name: string;
  buy_price: number;
  buy_qty: number;
  sell_station_id: string;
  sell_station_name: string;
  sell_system_id: string;
  sell_system_name: string;
  sell_price: number;
  sell_qty: number;
  margin: number;           // sell_price - buy_price
  margin_pct: number;       // margin / buy_price * 100
}

export class MarketPricesStore {
  constructor(private db: Database) {}

  /**
   * Upsert the full market listing for a station.
   * Called from recordMarketData() every time a bot does view_market.
   */
  updateStation(
    stationId: string,
    systemId: string,
    stationName: string,
    systemName: string,
    items: Array<{
      item_id: string;
      item_name?: string;
      sell_price?: number | null;
      sell_quantity?: number;
      buy_price?: number | null;
      buy_quantity?: number;
    }>,
    updatedBy: string,
    tick?: number,
  ): void {
    if (!stationId || items.length === 0) return;

    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO market_prices
        (station_id, system_id, station_name, system_name,
         item_id, item_name, sell_price, sell_quantity, buy_price, buy_quantity,
         updated_at, updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(station_id, item_id) DO UPDATE SET
        system_id    = excluded.system_id,
        station_name = excluded.station_name,
        system_name  = excluded.system_name,
        item_name    = CASE WHEN excluded.item_name != '' THEN excluded.item_name ELSE item_name END,
        sell_price   = excluded.sell_price,
        sell_quantity= excluded.sell_quantity,
        buy_price    = excluded.buy_price,
        buy_quantity = excluded.buy_quantity,
        updated_at   = excluded.updated_at,
        updated_by   = excluded.updated_by
    `);

    const histInsert = this.db.prepare(`
      INSERT INTO market_history
        (tick, station_id, station_name, item_id, item_name,
         buy_price, sell_price, buy_volume, sell_volume)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);

    const usedTick = tick ?? Math.floor(Date.now() / 10000);

    const tx = this.db.transaction(() => {
      // Remove items not in this fresh batch (no longer listed)
      const freshIds = items.map(i => i.item_id).filter(Boolean);
      if (freshIds.length > 0) {
        const placeholders = freshIds.map(() => "?").join(",");
        this.db.run(
          `DELETE FROM market_prices WHERE station_id = ? AND item_id NOT IN (${placeholders})`,
          [stationId, ...freshIds]
        );
      }

      for (const item of items) {
        if (!item.item_id) continue;
        upsert.run(
          stationId, systemId, stationName, systemName,
          item.item_id, item.item_name ?? "",
          item.sell_price ?? null, item.sell_quantity ?? 0,
          item.buy_price ?? null, item.buy_quantity ?? 0,
          now, updatedBy
        );
        // Record history snapshot
        histInsert.run(
          usedTick, stationId, stationName,
          item.item_id, item.item_name ?? "",
          item.buy_price ?? null, item.sell_price ?? null,
          item.buy_quantity ?? 0, item.sell_quantity ?? 0
        );
      }
    });
    tx();
  }

  // ── Trade-route queries ──────────────────────────────────────

  /** Find cheapest stations to buy `itemId` from (has sell_quantity > 0). */
  getCheapestSources(itemId: string, limit = 10): CheapestSource[] {
    return this.db.query(`
      SELECT station_id, system_id, station_name, system_name,
             sell_price AS price, sell_quantity AS quantity
      FROM market_prices
      WHERE item_id = ? AND sell_price IS NOT NULL AND sell_quantity > 0
      ORDER BY sell_price ASC
      LIMIT ?
    `).all(itemId, limit) as CheapestSource[];
  }

  /** Find stations paying the most to buy `itemId` from players. */
  getBestBuyers(itemId: string, limit = 10): BestBuyer[] {
    return this.db.query(`
      SELECT station_id, system_id, station_name, system_name,
             buy_price AS price, buy_quantity AS quantity
      FROM market_prices
      WHERE item_id = ? AND buy_price IS NOT NULL AND buy_quantity > 0
      ORDER BY buy_price DESC
      LIMIT ?
    `).all(itemId, limit) as BestBuyer[];
  }

  /** Find best trade routes across all known items. Min margin filter. */
  getBestTradeRoutes(minMargin = 100, limit = 20): TradeRoute[] {
    return this.db.query(`
      SELECT
        src.item_id,  src.item_name,
        src.station_id  AS buy_station_id,  src.station_name  AS buy_station_name,
        src.system_id   AS buy_system_id,   src.system_name   AS buy_system_name,
        src.sell_price  AS buy_price,       src.sell_quantity AS buy_qty,
        dst.station_id  AS sell_station_id, dst.station_name  AS sell_station_name,
        dst.system_id   AS sell_system_id,  dst.system_name   AS sell_system_name,
        dst.buy_price   AS sell_price,      dst.buy_quantity  AS sell_qty,
        (dst.buy_price - src.sell_price) AS margin,
        ROUND((dst.buy_price - src.sell_price) * 100.0 / src.sell_price, 1) AS margin_pct
      FROM market_prices src
      JOIN market_prices dst
        ON src.item_id = dst.item_id
        AND src.station_id != dst.station_id
      WHERE src.sell_price IS NOT NULL AND src.sell_quantity > 0
        AND dst.buy_price  IS NOT NULL AND dst.buy_quantity  > 0
        AND (dst.buy_price - src.sell_price) >= ?
      ORDER BY margin DESC
      LIMIT ?
    `).all(minMargin, limit) as TradeRoute[];
  }

  /** Best trade routes reachable from a specific system (buy in systemId). */
  getBestRoutesFromSystem(systemId: string, minMargin = 100, limit = 10): TradeRoute[] {
    return this.db.query(`
      SELECT
        src.item_id,  src.item_name,
        src.station_id  AS buy_station_id,  src.station_name  AS buy_station_name,
        src.system_id   AS buy_system_id,   src.system_name   AS buy_system_name,
        src.sell_price  AS buy_price,       src.sell_quantity AS buy_qty,
        dst.station_id  AS sell_station_id, dst.station_name  AS sell_station_name,
        dst.system_id   AS sell_system_id,  dst.system_name   AS sell_system_name,
        dst.buy_price   AS sell_price,      dst.buy_quantity  AS sell_qty,
        (dst.buy_price - src.sell_price) AS margin,
        ROUND((dst.buy_price - src.sell_price) * 100.0 / src.sell_price, 1) AS margin_pct
      FROM market_prices src
      JOIN market_prices dst
        ON src.item_id = dst.item_id
        AND src.station_id != dst.station_id
      WHERE src.system_id = ?
        AND src.sell_price IS NOT NULL AND src.sell_quantity > 0
        AND dst.buy_price  IS NOT NULL AND dst.buy_quantity  > 0
        AND (dst.buy_price - src.sell_price) >= ?
      ORDER BY margin DESC
      LIMIT ?
    `).all(systemId, minMargin, limit) as TradeRoute[];
  }

  /** All items available to buy at a station, sorted cheapest first. */
  getStationInventory(stationId: string): MarketPriceRow[] {
    return this.db.query(`
      SELECT * FROM market_prices
      WHERE station_id = ? AND sell_price IS NOT NULL AND sell_quantity > 0
      ORDER BY item_name ASC
    `).all(stationId) as MarketPriceRow[];
  }

  /** Check if a specific item is available at a station (and at what price). */
  getItemAtStation(stationId: string, itemId: string): MarketPriceRow | null {
    return this.db.query(`
      SELECT * FROM market_prices WHERE station_id = ? AND item_id = ?
    `).get(stationId, itemId) as MarketPriceRow | null;
  }

  /** Find the single cheapest source for an item (for gatherer auto-buy). */
  findCheapestSource(itemId: string): CheapestSource | null {
    const rows = this.getCheapestSources(itemId, 1);
    return rows[0] ?? null;
  }

  /** Summary stats: total stations, items, and stale entries older than N minutes. */
  getSummary(staleMinutes = 60): { stations: number; items: number; stale: number } {
    const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
    const r = this.db.query(`
      SELECT
        COUNT(DISTINCT station_id) AS stations,
        COUNT(*) AS items,
        SUM(CASE WHEN updated_at < ? THEN 1 ELSE 0 END) AS stale
      FROM market_prices
    `).get(cutoff) as { stations: number; items: number; stale: number };
    return r ?? { stations: 0, items: 0, stale: 0 };
  }

  /** Recent price history for a specific item+station (for charts/trend). */
  getPriceHistory(
    stationId: string,
    itemId: string,
    limit = 100,
  ): Array<{ tick: number; buy_price: number | null; sell_price: number | null; created_at: string }> {
    return this.db.query(`
      SELECT tick, buy_price, sell_price, created_at
      FROM market_history
      WHERE station_id = ? AND item_id = ?
      ORDER BY tick DESC
      LIMIT ?
    `).all(stationId, itemId, limit) as any[];
  }
}

/** Module-level singleton — set by botmanager after DB init. */
let _instance: MarketPricesStore | null = null;

export function initMarketPricesStore(db: Database): MarketPricesStore {
  _instance = new MarketPricesStore(db);
  return _instance;
}

export function getMarketPricesStore(): MarketPricesStore | null {
  return _instance;
}
