/**
 * SQLite-backed session store for bot credentials.
 * Replaces file-based SessionManager for persistence.
 * Provides migration from legacy sessions/ directory.
 */

import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export interface BotCredentials {
  username: string;
  password: string;
  empire: string;
  playerId: string;
}

export class SessionStore {
  constructor(private db: Database) {}

  /** Get credentials for a single bot. */
  getBot(username: string): BotCredentials | null {
    const row = this.db
      .query("SELECT username, password, empire, player_id FROM bot_sessions WHERE username = ?")
      .get(username) as { username: string; password: string; empire: string | null; player_id: string | null } | null;

    if (!row) return null;
    return {
      username: row.username,
      password: row.password,
      empire: row.empire || "",
      playerId: row.player_id || "",
    };
  }

  /** List all stored bot credentials. */
  listBots(): BotCredentials[] {
    const rows = this.db
      .query("SELECT username, password, empire, player_id FROM bot_sessions ORDER BY username")
      .all() as Array<{ username: string; password: string; empire: string | null; player_id: string | null }>;

    return rows.map((r) => ({
      username: r.username,
      password: r.password,
      empire: r.empire || "",
      playerId: r.player_id || "",
    }));
  }

  /** Insert or update bot credentials. */
  upsertBot(creds: BotCredentials): void {
    this.db.run(
      `INSERT OR REPLACE INTO bot_sessions (username, password, empire, player_id, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [creds.username, creds.password, creds.empire || "", creds.playerId || ""]
    );
  }

  /** Remove a bot's credentials. */
  removeBot(username: string): boolean {
    const result = this.db.run("DELETE FROM bot_sessions WHERE username = ?", [username]);
    return result.changes > 0;
  }

  /** Update session ID after login. */
  updateSession(username: string, sessionId: string, expiresAt?: string): void {
    this.db.run(
      "UPDATE bot_sessions SET session_id = ?, session_expires_at = ?, updated_at = datetime('now') WHERE username = ?",
      [sessionId, expiresAt || null, username]
    );
  }

  /** Get stored session ID for a bot. */
  getSession(username: string): { sessionId: string; expiresAt: string | null } | null {
    const row = this.db
      .query("SELECT session_id, session_expires_at FROM bot_sessions WHERE username = ? AND session_id IS NOT NULL")
      .get(username) as { session_id: string; session_expires_at: string | null } | null;

    if (!row) return null;
    return { sessionId: row.session_id, expiresAt: row.session_expires_at };
  }

  /** Check if any bots exist in the store. */
  get count(): number {
    const row = this.db.query("SELECT COUNT(*) as cnt FROM bot_sessions").get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Migrate credentials from legacy file-based sessions/ directory.
   * Only imports bots that don't already exist in SQLite.
   * Returns the number of migrated bots.
   */
  migrateFromFiles(sessionsDir: string): number {
    if (!existsSync(sessionsDir)) return 0;

    let migrated = 0;
    const dirs = readdirSync(sessionsDir, { withFileTypes: true });

    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const username = entry.name;

      // Skip if already in SQLite
      if (this.getBot(username)) continue;

      // Try JSON credentials
      const jsonPath = join(sessionsDir, username, "credentials.json");
      if (existsSync(jsonPath)) {
        try {
          const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
          if (data.username && data.password) {
            this.upsertBot({
              username: data.username,
              password: data.password,
              empire: data.empire || "",
              playerId: data.playerId || data.player_id || "",
            });
            migrated++;
            continue;
          }
        } catch { /* skip invalid JSON */ }
      }

      // Try legacy markdown format
      const mdPath = join(sessionsDir, username, "CREDENTIALS.md");
      if (existsSync(mdPath)) {
        try {
          const text = readFileSync(mdPath, "utf-8");
          const get = (label: string): string => {
            const match = text.match(new RegExp(`- ${label}:\\s*(.+)`, "i"));
            return match ? match[1].trim() : "";
          };
          const u = get("Username");
          const p = get("Password");
          if (u && p) {
            this.upsertBot({
              username: u,
              password: p,
              empire: get("Empire"),
              playerId: get("Player ID"),
            });
            migrated++;
          }
        } catch { /* skip */ }
      }
    }

    return migrated;
  }
}
