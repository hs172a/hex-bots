/**
 * WormholesDb — persists known wormhole entrances discovered via survey_system / get_poi.
 * Wormholes are temporary one-way rifts (v0.196.0). They last 2–5 days and can collapse.
 * Collapsed remnants remain visible for a few hours, then fade.
 */

import { Database } from "bun:sqlite";

export interface WormholeEntry {
  entrance_poi_id: string;
  entrance_system_id: string;
  entrance_system_name: string;
  exit_system_id: string;
  exit_system_name: string;
  exit_poi_id: string;
  /** 'active' | 'collapsed' */
  status: string;
  discovered_at: string;
  discovered_by: string;
  last_seen_at: string;
  /** ISO timestamp if predicted lifetime known from get_poi, else null */
  expires_estimated_at: string | null;
  /** ISO timestamp when collapse was first observed, null if still active */
  collapse_seen_at: string | null;
}

export class WormholesDb {
  constructor(private db: Database) {}

  /** Insert or update a wormhole entry. */
  upsert(entry: Omit<WormholeEntry, "discovered_at"> & { discovered_at?: string }): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO wormholes (
        entrance_poi_id, entrance_system_id, entrance_system_name,
        exit_system_id, exit_system_name, exit_poi_id,
        status, discovered_at, discovered_by, last_seen_at,
        expires_estimated_at, collapse_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entrance_poi_id) DO UPDATE SET
        entrance_system_id   = excluded.entrance_system_id,
        entrance_system_name = excluded.entrance_system_name,
        exit_system_id       = CASE WHEN excluded.exit_system_id != '' THEN excluded.exit_system_id ELSE exit_system_id END,
        exit_system_name     = CASE WHEN excluded.exit_system_name != '' THEN excluded.exit_system_name ELSE exit_system_name END,
        exit_poi_id          = CASE WHEN excluded.exit_poi_id != '' THEN excluded.exit_poi_id ELSE exit_poi_id END,
        status               = excluded.status,
        discovered_by        = CASE WHEN discovered_by = '' THEN excluded.discovered_by ELSE discovered_by END,
        last_seen_at         = excluded.last_seen_at,
        expires_estimated_at = COALESCE(excluded.expires_estimated_at, expires_estimated_at),
        collapse_seen_at     = excluded.collapse_seen_at`,
      [
        entry.entrance_poi_id,
        entry.entrance_system_id,
        entry.entrance_system_name,
        entry.exit_system_id,
        entry.exit_system_name,
        entry.exit_poi_id,
        entry.status ?? "active",
        entry.discovered_at ?? now,
        entry.discovered_by,
        entry.last_seen_at ?? now,
        entry.expires_estimated_at ?? null,
        entry.collapse_seen_at ?? null,
      ],
    );
  }

  /** Mark a wormhole as collapsed (remnant visible but not traversable). */
  markCollapsed(entrancePoiId: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE wormholes SET status = 'collapsed', collapse_seen_at = ?, last_seen_at = ?
       WHERE entrance_poi_id = ?`,
      [now, now, entrancePoiId],
    );
  }

  /** Update last_seen_at to now (confirms wormhole is still active on a survey). */
  markSeen(entrancePoiId: string): void {
    this.db.run(
      "UPDATE wormholes SET last_seen_at = ? WHERE entrance_poi_id = ?",
      [new Date().toISOString(), entrancePoiId],
    );
  }

  /** All active (non-collapsed) wormholes. */
  getActive(): WormholeEntry[] {
    return this.db
      .query("SELECT * FROM wormholes WHERE status = 'active' ORDER BY last_seen_at DESC")
      .all() as WormholeEntry[];
  }

  /** All wormholes including collapsed remnants. */
  getAll(): WormholeEntry[] {
    return this.db
      .query("SELECT * FROM wormholes ORDER BY last_seen_at DESC")
      .all() as WormholeEntry[];
  }

  /** Wormholes whose entrance is in the given system. */
  getBySystem(systemId: string): WormholeEntry[] {
    return this.db
      .query("SELECT * FROM wormholes WHERE entrance_system_id = ? ORDER BY status, last_seen_at DESC")
      .all(systemId) as WormholeEntry[];
  }

  /** Single wormhole by entrance POI ID. */
  get(entrancePoiId: string): WormholeEntry | null {
    return (this.db
      .query("SELECT * FROM wormholes WHERE entrance_poi_id = ?")
      .get(entrancePoiId) as WormholeEntry | null);
  }

  /**
   * Delete collapsed wormholes whose collapse was seen more than `hours` ago (default 12h).
   * Also deletes active wormholes not seen in `maxAgeDays` days (default 6 — max wormhole lifetime).
   */
  pruneOld(collapsedHours = 12, maxAgeDays = 6): void {
    const collapsedCutoff = new Date(Date.now() - collapsedHours * 3600 * 1000).toISOString();
    const staleCutoff = new Date(Date.now() - maxAgeDays * 86400 * 1000).toISOString();
    this.db.run(
      "DELETE FROM wormholes WHERE (status = 'collapsed' AND collapse_seen_at < ?) OR last_seen_at < ?",
      [collapsedCutoff, staleCutoff],
    );
  }
}
