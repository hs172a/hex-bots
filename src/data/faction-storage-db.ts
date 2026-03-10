/**
 * FactionStorageDb — persists faction storage snapshots and building locations to SQLite.
 *
 * Sync contract:
 *  - On successful view_faction_storage  → updateItems() replaces all items for that POI.
 *  - On faction_deposit_items success    → adjustQuantity() increments (optimistic update).
 *  - On faction_withdraw_items success   → adjustQuantity() decrements (optimistic update).
 *  Both mutating ops also schedule a full view_faction_storage refresh via the bot so the
 *  canonical state overwrites the optimistic one on the next tick.
 */

import type { Database } from "bun:sqlite";

export interface FactionStorageEntry {
  poi_id: string;
  system_id: string;
  system_name: string;
  poi_name: string;
  item_id: string;
  item_name: string;
  quantity: number;
  updated_at: string;
}

export interface FactionBuildingEntry {
  facility_id: string;
  faction_id: string;
  faction_name: string;
  poi_id: string;
  poi_name: string;
  system_id: string;
  system_name: string;
  facility_type: string;
  facility_name: string;
  faction_service: string;
  active: boolean;
  level: number;
  updated_at: string;
}

export class FactionStorageDb {
  constructor(private readonly db: Database) {}

  // ── Storage items ────────────────────────────────────────────

  /**
   * Full replace: deletes all existing items for `poiId` then inserts fresh snapshot.
   * Called after a successful view_faction_storage response.
   */
  updateItems(
    poiId: string,
    systemId: string,
    systemName: string,
    poiName: string,
    items: Array<{ item_id: string; name?: string; item_name?: string; quantity: number }>,
  ): void {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM faction_storage_items WHERE poi_id = ?", [poiId]);
      const stmt = this.db.prepare(
        `INSERT INTO faction_storage_items
           (poi_id, system_id, system_name, poi_name, item_id, item_name, quantity, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of items) {
        if ((item.quantity ?? 0) <= 0) continue;
        stmt.run(
          poiId,
          systemId,
          systemName,
          poiName,
          item.item_id,
          item.name ?? item.item_name ?? item.item_id,
          item.quantity,
          now,
        );
      }
    });
    tx();
  }

  /**
   * Optimistic delta: add or subtract quantity for one item.
   * If resulting quantity ≤ 0 the row is deleted.
   */
  adjustQuantity(poiId: string, itemId: string, delta: number): void {
    const now = new Date().toISOString();
    const row = this.db
      .query("SELECT quantity FROM faction_storage_items WHERE poi_id = ? AND item_id = ?")
      .get(poiId, itemId) as { quantity: number } | null;

    const newQty = (row?.quantity ?? 0) + delta;
    if (newQty <= 0) {
      this.db.run(
        "DELETE FROM faction_storage_items WHERE poi_id = ? AND item_id = ?",
        [poiId, itemId],
      );
    } else if (row) {
      this.db.run(
        "UPDATE faction_storage_items SET quantity = ?, updated_at = ? WHERE poi_id = ? AND item_id = ?",
        [newQty, now, poiId, itemId],
      );
    }
  }

  /** Clear all items at a POI (called when view_faction_storage returns an error — no facility). */
  clearItems(poiId: string): void {
    this.db.run("DELETE FROM faction_storage_items WHERE poi_id = ?", [poiId]);
  }

  /** Return all items at a specific POI, sorted by item_name. */
  getItemsForPoi(poiId: string): FactionStorageEntry[] {
    return this.db
      .query("SELECT * FROM faction_storage_items WHERE poi_id = ? ORDER BY item_name")
      .all(poiId) as FactionStorageEntry[];
  }

  /** Return every item across all POIs. */
  getAllItems(): FactionStorageEntry[] {
    return this.db
      .query("SELECT * FROM faction_storage_items ORDER BY system_name, poi_name, item_name")
      .all() as FactionStorageEntry[];
  }

  /** Return total quantity of an item across all faction storage POIs. */
  getTotalQuantity(itemId: string): number {
    const row = this.db
      .query("SELECT COALESCE(SUM(quantity),0) AS total FROM faction_storage_items WHERE item_id = ?")
      .get(itemId) as { total: number } | null;
    return row?.total ?? 0;
  }

  /** Return all POIs that have at least one item, with aggregate totals. */
  getSummaryByPoi(): Array<{ poi_id: string; poi_name: string; system_id: string; system_name: string; item_count: number; total_quantity: number; updated_at: string }> {
    return this.db
      .query(`
        SELECT poi_id, poi_name, system_id, system_name,
               COUNT(*) AS item_count,
               SUM(quantity) AS total_quantity,
               MAX(updated_at) AS updated_at
        FROM faction_storage_items
        GROUP BY poi_id
        ORDER BY system_name, poi_name
      `)
      .all() as any[];
  }

  // ── Faction buildings ────────────────────────────────────────

  /** Upsert a batch of faction facilities (called after facility { action: 'list' } success). */
  updateBuildings(buildings: Array<{
    facility_id: string;
    faction_id?: string;
    faction_name?: string;
    poi_id?: string;
    poi_name?: string;
    system_id?: string;
    system_name?: string;
    facility_type?: string;
    name?: string;
    faction_service?: string;
    active?: boolean;
    level?: number;
  }>): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO faction_buildings
        (facility_id, faction_id, faction_name, poi_id, poi_name, system_id, system_name,
         facility_type, facility_name, faction_service, active, level, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const b of buildings) {
        if (!b.facility_id) continue;
        stmt.run(
          b.facility_id,
          b.faction_id ?? '',
          b.faction_name ?? '',
          b.poi_id ?? '',
          b.poi_name ?? '',
          b.system_id ?? '',
          b.system_name ?? b.system_id ?? '',
          b.facility_type ?? '',
          b.name ?? '',
          b.faction_service ?? '',
          b.active !== false ? 1 : 0,
          b.level ?? 1,
          now,
        );
      }
    });
    tx();
  }

  /** Return all known faction buildings. */
  getAllBuildings(): FactionBuildingEntry[] {
    return this.db
      .query("SELECT * FROM faction_buildings ORDER BY system_name, poi_name, facility_name")
      .all()
      .map((r: any) => ({ ...r, active: r.active === 1 })) as FactionBuildingEntry[];
  }

  /** Return buildings for a specific system. */
  getBuildingsInSystem(systemId: string): FactionBuildingEntry[] {
    return this.db
      .query("SELECT * FROM faction_buildings WHERE system_id = ? ORDER BY poi_name, facility_name")
      .all(systemId)
      .map((r: any) => ({ ...r, active: r.active === 1 })) as FactionBuildingEntry[];
  }

  /** Return buildings at a specific POI. */
  getBuildingsForPoi(poiId: string): FactionBuildingEntry[] {
    return this.db
      .query("SELECT * FROM faction_buildings WHERE poi_id = ? ORDER BY facility_name")
      .all(poiId)
      .map((r: any) => ({ ...r, active: r.active === 1 })) as FactionBuildingEntry[];
  }
}
