/**
 * DepositsDb — CRUD for the resource_deposits table.
 * Records surveyed resource information from mining/harvesting/exploration.
 */

import { Database } from "bun:sqlite";

export interface DepositRecord {
  poi_id: string;
  system_id: string;
  system_name: string;
  poi_name: string;
  poi_type: string;
  resource_id: string;
  resource_name: string;
  /** 'ore' | 'gas' | 'ice' | 'crystal' | 'other' */
  category: string;
  remaining: number;
  quality: number;
  depletion_pct: number;
  last_seen_at: string;
  last_seen_by: string;
}

export class DepositsDb {
  constructor(private db: Database) {}

  /** Upsert a single deposit record. */
  upsert(r: DepositRecord): void {
    this.db.run(
      `INSERT INTO resource_deposits
         (poi_id, system_id, system_name, poi_name, poi_type,
          resource_id, resource_name, category,
          remaining, quality, depletion_pct,
          last_seen_at, last_seen_by)
       VALUES (?,?,?,?,?, ?,?,?, ?,?,?, ?,?)
       ON CONFLICT(poi_id, resource_id) DO UPDATE SET
         system_id     = excluded.system_id,
         system_name   = excluded.system_name,
         poi_name      = excluded.poi_name,
         poi_type      = excluded.poi_type,
         resource_name = excluded.resource_name,
         category      = excluded.category,
         remaining     = excluded.remaining,
         quality       = excluded.quality,
         depletion_pct = excluded.depletion_pct,
         last_seen_at  = excluded.last_seen_at,
         last_seen_by  = excluded.last_seen_by`,
      [
        r.poi_id, r.system_id, r.system_name, r.poi_name, r.poi_type,
        r.resource_id, r.resource_name, r.category,
        r.remaining, r.quality, r.depletion_pct,
        r.last_seen_at, r.last_seen_by,
      ],
    );
  }

  /** Batch upsert multiple deposit records in a single transaction. */
  upsertBatch(records: DepositRecord[]): void {
    if (records.length === 0) return;
    const tx = this.db.transaction(() => {
      for (const r of records) this.upsert(r);
    });
    tx();
  }

  /** All resources at a specific POI. */
  getByPoi(poiId: string): DepositRecord[] {
    return this.db
      .query("SELECT * FROM resource_deposits WHERE poi_id = ? ORDER BY remaining DESC")
      .all(poiId) as DepositRecord[];
  }

  /** All deposits in a specific system, sorted by remaining desc. */
  getBySystem(systemId: string): DepositRecord[] {
    return this.db
      .query("SELECT * FROM resource_deposits WHERE system_id = ? ORDER BY remaining DESC")
      .all(systemId) as DepositRecord[];
  }

  /** All known locations for a specific resource_id, freshest first. */
  getByResource(resourceId: string): DepositRecord[] {
    return this.db
      .query(
        "SELECT * FROM resource_deposits WHERE resource_id = ? AND depletion_pct < 95 ORDER BY remaining DESC, last_seen_at DESC",
      )
      .all(resourceId) as DepositRecord[];
  }

  /** All deposits across all systems. */
  getAll(): DepositRecord[] {
    return this.db
      .query("SELECT * FROM resource_deposits ORDER BY system_id, poi_id, remaining DESC")
      .all() as DepositRecord[];
  }

  /** Distinct system IDs that have at least one non-depleted deposit. */
  getSystemsWithDeposits(): Array<{ system_id: string; system_name: string; count: number }> {
    return this.db
      .query(
        `SELECT system_id, system_name, COUNT(*) AS count
         FROM resource_deposits
         WHERE depletion_pct < 95
         GROUP BY system_id, system_name`,
      )
      .all() as Array<{ system_id: string; system_name: string; count: number }>;
  }

  /**
   * Find the best non-depleted deposit for a resource.
   * Optionally prefers a specific system.
   */
  findBest(resourceId: string, preferSystemId?: string): DepositRecord | null {
    if (preferSystemId) {
      const inSystem = this.db
        .query(
          `SELECT * FROM resource_deposits
           WHERE resource_id = ? AND system_id = ? AND depletion_pct < 85
           ORDER BY remaining DESC LIMIT 1`,
        )
        .get(resourceId, preferSystemId) as DepositRecord | null;
      if (inSystem) return inSystem;
    }
    return (
      this.db
        .query(
          `SELECT * FROM resource_deposits
           WHERE resource_id = ? AND depletion_pct < 85
           ORDER BY remaining DESC, last_seen_at DESC LIMIT 1`,
        )
        .get(resourceId) as DepositRecord | null
    );
  }

  /** All deposits for a resource category. */
  getByCategory(category: string): DepositRecord[] {
    return this.db
      .query(
        "SELECT * FROM resource_deposits WHERE category = ? AND depletion_pct < 95 ORDER BY remaining DESC",
      )
      .all(category) as DepositRecord[];
  }

  /** Remove deposits not seen for more than `days` days. */
  pruneStale(days = 7): number {
    const result = this.db.run(
      `DELETE FROM resource_deposits WHERE last_seen_at < datetime('now', ?)`,
      [`-${days} days`],
    );
    return result.changes;
  }

  /** Summary grouped by system + poi for quick map overlay. */
  getSummaryBySystem(): Array<{
    system_id: string;
    system_name: string;
    poi_id: string;
    poi_name: string;
    poi_type: string;
    category: string;
    resource_count: number;
    total_remaining: number;
    avg_depletion: number;
    last_seen_at: string;
  }> {
    return this.db
      .query(
        `SELECT
           system_id, system_name,
           poi_id, poi_name, poi_type, category,
           COUNT(*) AS resource_count,
           SUM(remaining) AS total_remaining,
           AVG(depletion_pct) AS avg_depletion,
           MAX(last_seen_at) AS last_seen_at
         FROM resource_deposits
         GROUP BY poi_id, category
         ORDER BY system_id, poi_id`,
      )
      .all() as Array<{
        system_id: string; system_name: string;
        poi_id: string; poi_name: string; poi_type: string; category: string;
        resource_count: number; total_remaining: number; avg_depletion: number; last_seen_at: string;
      }>;
  }
}
