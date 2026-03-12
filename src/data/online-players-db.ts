/**
 * OnlinePlayersDb — CRUD for the online_players table.
 * Records players observed via get_nearby / travel API responses.
 */

import { Database } from "bun:sqlite";

export interface OnlinePlayerRecord {
  player_id: string;
  username: string;
  ship_class: string;
  ship_name: string;
  faction_id: string;
  faction_tag: string;
  primary_color: string;
  secondary_color: string;
  status_message: string;
  anonymous: boolean;
  in_combat: boolean;
  last_poi_id: string;
  last_poi_name: string;
  last_system_id: string;
  last_system_name: string;
  last_seen_at: string;
  last_seen_by: string;
}

export class OnlinePlayersDb {
  constructor(private db: Database) {}

  /** Upsert a batch of observed players. */
  upsertBatch(players: Array<Partial<OnlinePlayerRecord> & { player_id: string }>): void {
    if (!players.length) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO online_players
        (player_id, username, ship_class, ship_name, faction_id, faction_tag,
         primary_color, secondary_color, status_message, anonymous, in_combat,
         last_poi_id, last_poi_name, last_system_id, last_system_name, last_seen_at, last_seen_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        username        = CASE WHEN excluded.username != '' THEN excluded.username ELSE username END,
        ship_class      = CASE WHEN excluded.ship_class != '' THEN excluded.ship_class ELSE ship_class END,
        ship_name       = CASE WHEN excluded.ship_name != '' THEN excluded.ship_name ELSE ship_name END,
        faction_id      = CASE WHEN excluded.faction_id != '' THEN excluded.faction_id ELSE faction_id END,
        faction_tag     = CASE WHEN excluded.faction_tag != '' THEN excluded.faction_tag ELSE faction_tag END,
        primary_color   = CASE WHEN excluded.primary_color != '' THEN excluded.primary_color ELSE primary_color END,
        secondary_color = CASE WHEN excluded.secondary_color != '' THEN excluded.secondary_color ELSE secondary_color END,
        status_message  = CASE WHEN excluded.status_message != '' THEN excluded.status_message ELSE status_message END,
        anonymous       = excluded.anonymous,
        in_combat       = excluded.in_combat,
        last_poi_id     = CASE WHEN excluded.last_poi_id != '' THEN excluded.last_poi_id ELSE last_poi_id END,
        last_poi_name   = CASE WHEN excluded.last_poi_name != '' THEN excluded.last_poi_name ELSE last_poi_name END,
        last_system_id  = CASE WHEN excluded.last_system_id != '' THEN excluded.last_system_id ELSE last_system_id END,
        last_system_name = CASE WHEN excluded.last_system_name != '' THEN excluded.last_system_name ELSE last_system_name END,
        last_seen_at    = excluded.last_seen_at,
        last_seen_by    = excluded.last_seen_by
    `);
    const tx = this.db.transaction(() => {
      for (const p of players) {
        if (!p.player_id) continue;
        stmt.run(
          p.player_id,
          p.username ?? '',
          p.ship_class ?? '',
          p.ship_name ?? '',
          p.faction_id ?? '',
          p.faction_tag ?? '',
          p.primary_color ?? '#FFFFFF',
          p.secondary_color ?? '#000000',
          p.status_message ?? '',
          p.anonymous ? 1 : 0,
          p.in_combat ? 1 : 0,
          p.last_poi_id ?? '',
          p.last_poi_name ?? '',
          p.last_system_id ?? '',
          p.last_system_name ?? '',
          p.last_seen_at ?? now,
          p.last_seen_by ?? '',
        );
      }
    });
    tx();
  }

  /** Return all known players, most recently seen first. */
  getAll(): OnlinePlayerRecord[] {
    return this.db
      .query("SELECT * FROM online_players ORDER BY last_seen_at DESC")
      .all()
      .map((r: any) => ({ ...r, anonymous: r.anonymous === 1, in_combat: r.in_combat === 1 })) as OnlinePlayerRecord[];
  }

  /** Return players seen at a specific POI. */
  getByPoi(poiId: string): OnlinePlayerRecord[] {
    return this.db
      .query("SELECT * FROM online_players WHERE last_poi_id = ? ORDER BY last_seen_at DESC")
      .all(poiId)
      .map((r: any) => ({ ...r, anonymous: r.anonymous === 1, in_combat: r.in_combat === 1 })) as OnlinePlayerRecord[];
  }

  /** Return players seen in a specific system. */
  getBySystem(systemId: string): OnlinePlayerRecord[] {
    return this.db
      .query("SELECT * FROM online_players WHERE last_system_id = ? ORDER BY last_seen_at DESC")
      .all(systemId)
      .map((r: any) => ({ ...r, anonymous: r.anonymous === 1, in_combat: r.in_combat === 1 })) as OnlinePlayerRecord[];
  }

  /** Return players seen within the last N hours (active players). */
  getRecent(withinHours = 24): OnlinePlayerRecord[] {
    const cutoff = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
    return this.db
      .query("SELECT * FROM online_players WHERE last_seen_at >= ? ORDER BY last_seen_at DESC")
      .all(cutoff)
      .map((r: any) => ({ ...r, anonymous: r.anonymous === 1, in_combat: r.in_combat === 1 })) as OnlinePlayerRecord[];
  }

  /** Return count of distinct players seen within the last N hours. */
  getRecentCount(withinHours = 24): number {
    const cutoff = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
    const row = this.db
      .query("SELECT COUNT(*) as n FROM online_players WHERE last_seen_at >= ?")
      .get(cutoff) as { n: number };
    return row?.n ?? 0;
  }

  /** Remove players not seen for more than maxAgeDays. */
  pruneStale(maxAgeDays = 30): void {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400 * 1000).toISOString();
    this.db.run("DELETE FROM online_players WHERE last_seen_at < ?", [cutoff]);
  }
}
