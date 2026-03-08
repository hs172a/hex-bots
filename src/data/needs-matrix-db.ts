/**
 * NeedsMatrixDb — persists the fleet's production needs to SQLite.
 *
 * The Needs Matrix is the single source of truth for "what does the fleet need?":
 *  - target_qty: how much of this item the coordinator wants in faction storage.
 *  - current_qty: last observed quantity in faction storage (updated on view_faction_storage).
 *  - deficit = target_qty - current_qty → drives miner/gatherer priorities.
 *  - source: how this item should be obtained ('mine' | 'buy' | 'craft').
 *
 * Write contract:
 *  - Coordinator calls setTarget() each cycle after computing ore quotas / craft needs.
 *  - botmanager calls updateCurrent() after every successful view_faction_storage.
 *  - faction_deposit_items / faction_withdraw_items call adjustCurrent() for optimistic deltas.
 */

import type { Database } from "bun:sqlite";

export interface NeedsMatrixEntry {
  item_id: string;
  item_name: string;
  /** 'ore' | 'gas' | 'material' | 'product' | 'unknown' */
  category: string;
  /** Coordinator-set target level in faction storage. */
  target_qty: number;
  /** Last observed quantity from view_faction_storage. */
  current_qty: number;
  /** How this item should be obtained: 'mine' | 'buy' | 'craft'. */
  source: string;
  /** Coordinator-assigned priority 0–100 (higher = more urgent). */
  priority: number;
  /** ISO timestamp of last setTarget() call. */
  updated_target_at: string;
  /** ISO timestamp of last updateCurrent() call. */
  updated_current_at: string;
  /** Bot that last reported current_qty. */
  updated_by: string;
}

export class NeedsMatrixDb {
  constructor(private readonly db: Database) {}

  // ── Target management (coordinator) ─────────────────────────

  /**
   * Set or update the coordinator's target for an item.
   * Use priority 0–100; 80+ means critical bottleneck.
   */
  setTarget(
    itemId: string,
    itemName: string,
    category: string,
    targetQty: number,
    source: 'mine' | 'buy' | 'craft',
    priority = 50,
  ): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO needs_matrix
         (item_id, item_name, category, target_qty, source, priority, updated_target_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         item_name            = excluded.item_name,
         category             = excluded.category,
         target_qty           = excluded.target_qty,
         source               = excluded.source,
         priority             = excluded.priority,
         updated_target_at    = excluded.updated_target_at`,
      [itemId, itemName, category, targetQty, source, priority, now],
    );
  }

  /**
   * Bulk-replace all coordinator targets for a given source type.
   * Items in `entries` are upserted; existing rows for that source NOT in the
   * new entries get their target_qty zeroed (no longer needed).
   */
  replaceTargetsBySource(
    source: 'mine' | 'buy' | 'craft',
    entries: Array<{ itemId: string; itemName: string; category: string; targetQty: number; priority?: number }>,
  ): void {
    const now = new Date().toISOString();
    const newIds = new Set(entries.map(e => e.itemId));

    const tx = this.db.transaction(() => {
      // Zero out stale entries for this source
      const existing = this.db.query(
        `SELECT item_id FROM needs_matrix WHERE source = ? AND target_qty > 0`,
      ).all(source) as Array<{ item_id: string }>;
      for (const row of existing) {
        if (!newIds.has(row.item_id)) {
          this.db.run(
            `UPDATE needs_matrix SET target_qty = 0, updated_target_at = ? WHERE item_id = ?`,
            [now, row.item_id],
          );
        }
      }

      // Upsert new targets
      for (const e of entries) {
        this.db.run(
          `INSERT INTO needs_matrix
             (item_id, item_name, category, target_qty, source, priority, updated_target_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_id) DO UPDATE SET
             item_name         = excluded.item_name,
             category          = excluded.category,
             target_qty        = excluded.target_qty,
             source            = excluded.source,
             priority          = excluded.priority,
             updated_target_at = excluded.updated_target_at`,
          [e.itemId, e.itemName, e.category, e.targetQty, source, e.priority ?? 50, now],
        );
      }
    });
    tx();
  }

  // ── Current quantity (faction storage sync) ──────────────────

  /**
   * Update the observed current quantity for an item.
   * If the item doesn't have a target row yet, a stub row is created so
   * the surplus/deficit can still be tracked.
   */
  updateCurrent(itemId: string, currentQty: number, updatedBy: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO needs_matrix
         (item_id, item_name, category, target_qty, current_qty, source, priority, updated_current_at, updated_by)
       VALUES (?, '', 'unknown', 0, ?, 'mine', 50, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         current_qty         = excluded.current_qty,
         updated_current_at  = excluded.updated_current_at,
         updated_by          = excluded.updated_by`,
      [itemId, currentQty, now, updatedBy],
    );
  }

  /**
   * Apply an optimistic ±delta to current_qty (after faction_deposit/withdraw).
   * Clamps to zero so current_qty never goes negative.
   */
  adjustCurrent(itemId: string, delta: number, updatedBy: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE needs_matrix
       SET current_qty        = MAX(0, current_qty + ?),
           updated_current_at = ?,
           updated_by         = ?
       WHERE item_id = ?`,
      [delta, now, updatedBy, itemId],
    );
  }

  // ── Queries ──────────────────────────────────────────────────

  /** All entries sorted by deficit (target − current) descending. */
  getAll(): NeedsMatrixEntry[] {
    return this.db.query(
      `SELECT * FROM needs_matrix ORDER BY (target_qty - current_qty) DESC, priority DESC`,
    ).all() as NeedsMatrixEntry[];
  }

  /** Entries for a specific source, sorted by deficit descending. */
  getBySource(source: string): NeedsMatrixEntry[] {
    return this.db.query(
      `SELECT * FROM needs_matrix WHERE source = ? AND target_qty > 0
       ORDER BY (target_qty - current_qty) DESC, priority DESC`,
    ).all(source) as NeedsMatrixEntry[];
  }

  /**
   * Top N items with a positive deficit for a given source.
   * These are what the fleet is actively short of.
   */
  getTopDeficits(source: string, limit = 10): NeedsMatrixEntry[] {
    return this.db.query(
      `SELECT * FROM needs_matrix
       WHERE source = ? AND target_qty > current_qty
       ORDER BY (target_qty - current_qty) DESC, priority DESC
       LIMIT ?`,
    ).all(source, limit) as NeedsMatrixEntry[];
  }

  /** Single entry by item_id. */
  getItem(itemId: string): NeedsMatrixEntry | null {
    return this.db.query(
      `SELECT * FROM needs_matrix WHERE item_id = ?`,
    ).get(itemId) as NeedsMatrixEntry | null;
  }

  /** Delete target entries not updated in the last `maxAgeDays` days. */
  pruneStale(maxAgeDays = 7): void {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.run(`DELETE FROM needs_matrix WHERE updated_target_at < ?`, [cutoff]);
  }
}
