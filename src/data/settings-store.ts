/**
 * SQLite-backed settings store.
 * Replaces data/settings.json for routine settings, bot assignments, and general config.
 * Each setting is stored as a key-value pair with JSON-serialized values.
 */

import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";

export class SettingsStore {
  constructor(private db: Database) {}

  /** Get a single setting by key, parsed from JSON. Returns defaultValue if not found. */
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    const row = this.db
      .query("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | null;

    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return defaultValue;
    }
  }

  /** Set a single setting (JSON-serialized). */
  set(key: string, value: unknown): void {
    this.db.run(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      [key, JSON.stringify(value)]
    );
  }

  /** Delete a setting. */
  delete(key: string): void {
    this.db.run("DELETE FROM settings WHERE key = ?", [key]);
  }

  /** Get all settings as a flat object (for backward compatibility with WebServer). */
  getAll(): Record<string, unknown> {
    const rows = this.db
      .query("SELECT key, value FROM settings")
      .all() as Array<{ key: string; value: string }>;

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  /** Set all settings from a flat object (for backward compatibility). */
  setAll(settings: Record<string, unknown>): void {
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        this.set(key, value);
      }
    });
    tx();
  }

  /**
   * Migrate settings from legacy data/settings.json file.
   * Only imports if no settings exist in SQLite yet.
   * Returns true if migration occurred.
   */
  migrateFromFile(filePath: string): boolean {
    // Skip if we already have settings
    const count = (this.db.query("SELECT COUNT(*) as cnt FROM settings").get() as { cnt: number }).cnt;
    if (count > 0) return false;

    if (!existsSync(filePath)) return false;

    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      if (typeof raw !== "object" || raw === null) return false;

      const tx = this.db.transaction(() => {
        for (const [key, value] of Object.entries(raw)) {
          this.set(key, value);
        }
      });
      tx();
      console.log(`[Settings] Migrated ${Object.keys(raw).length} settings from ${filePath}`);
      return true;
    } catch (err) {
      console.warn(`[Settings] Failed to migrate from ${filePath}:`, err);
      return false;
    }
  }
}
