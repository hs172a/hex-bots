import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SpaceMoltAPI } from "./api.js";
import type { Database } from "bun:sqlite";

// ── Data model ──────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  name: string;
  category?: string;
  [key: string]: unknown;
}

export interface CatalogShip {
  id: string;
  name: string;
  class?: string;
  tier?: number;
  [key: string]: unknown;
}

export interface CatalogSkill {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CatalogRecipe {
  id: string;
  name: string;
  category?: string;
  components?: Array<{ item_id?: string; name?: string; quantity?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface CatalogData {
  version: 1;
  lastFetched: string | null;
  items: Record<string, CatalogItem>;
  ships: Record<string, CatalogShip>;
  skills: Record<string, CatalogSkill>;
  recipes: Record<string, CatalogRecipe>;
}

// ── CatalogStore singleton ──────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const CATALOG_FILE = join(DATA_DIR, "catalog.json");
const SAVE_DEBOUNCE_MS = 5000;
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class CatalogStore {
  private data: CatalogData;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _fetchPromise: Promise<void> | null = null;
  private _db: Database | null = null;

  constructor() {
    this.data = this.load();
  }

  /** Connect to SQLite backend. Loads per-item rows; migrates legacy JSON data if needed. */
  connectToDb(db: Database): void {
    this._db = db;

    // Load lastFetched from catalog_meta
    const metaRow = db.query("SELECT value FROM catalog_meta WHERE key = 'lastFetched'").get() as { value: string } | null;
    const dbLastFetched = metaRow?.value ?? null;

    // Count items already in DB
    const countRow = db.query("SELECT COUNT(*) as n FROM catalog_items").get() as { n: number };
    const dbHasData = countRow.n > 0;

    if (dbHasData) {
      // Load all rows from DB into memory
      this._loadFromDb();
      this.data.lastFetched = dbLastFetched;
      console.log(`[CatalogStore] Loaded ${countRow.n} catalog items from SQLite`);
    } else if (this.data.lastFetched) {
      // Migrate existing JSON data to SQLite
      this._migrateToDb();
    }
  }

  /** Read all catalog_items rows into memory. */
  private _loadFromDb(): void {
    if (!this._db) return;
    const rows = this._db.query("SELECT id, item_type, data FROM catalog_items").all() as { id: string; item_type: string; data: string }[];
    const fresh: CatalogData = { version: 1, lastFetched: null, items: {}, ships: {}, skills: {}, recipes: {} };
    for (const row of rows) {
      try {
        const obj = JSON.parse(row.data) as Record<string, unknown>;
        if (row.item_type === "item") fresh.items[row.id] = obj as CatalogItem;
        else if (row.item_type === "ship") fresh.ships[row.id] = obj as CatalogShip;
        else if (row.item_type === "skill") fresh.skills[row.id] = obj as CatalogSkill;
        else if (row.item_type === "recipe") fresh.recipes[row.id] = obj as CatalogRecipe;
      } catch { /* corrupt row */ }
    }
    this.data = fresh;
  }

  /** Bulk-insert all in-memory catalog entries into DB (one-time migration). */
  private _migrateToDb(): void {
    if (!this._db) return;
    this._saveToDb();
    console.log(`[CatalogStore] Migrated catalog to SQLite (${this.getSummary()})`);
  }

  // ── Persistence ─────────────────────────────────────────

  private load(): CatalogData {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    if (existsSync(CATALOG_FILE)) {
      try {
        const raw = readFileSync(CATALOG_FILE, "utf-8");
        return JSON.parse(raw) as CatalogData;
      } catch {
        // Corrupt file — start fresh
      }
    }
    return { version: 1, lastFetched: null, items: {}, ships: {}, skills: {}, recipes: {} };
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
    writeFileSync(CATALOG_FILE, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
    this.dirty = false;
  }

  /** Write to SQLite if connected, otherwise to JSON file. */
  private persist(): void {
    if (this._db) {
      this._saveToDb();
    } else {
      this.writeToDisk();
    }
  }

  /** Upsert all catalog items and metadata to SQLite. */
  private _saveToDb(): void {
    if (!this._db) return;
    const stmt = this._db.prepare(
      "INSERT OR REPLACE INTO catalog_items (id, item_type, data) VALUES (?, ?, ?)"
    );
    const tx = this._db.transaction(() => {
      for (const [id, item] of Object.entries(this.data.items))
        stmt.run(id, "item", JSON.stringify(item));
      for (const [id, ship] of Object.entries(this.data.ships))
        stmt.run(id, "ship", JSON.stringify(ship));
      for (const [id, skill] of Object.entries(this.data.skills))
        stmt.run(id, "skill", JSON.stringify(skill));
      for (const [id, recipe] of Object.entries(this.data.recipes))
        stmt.run(id, "recipe", JSON.stringify(recipe));
    });
    tx();
    if (this.data.lastFetched) {
      this._db.run(
        "INSERT OR REPLACE INTO catalog_meta (key, value) VALUES ('lastFetched', ?)",
        [this.data.lastFetched]
      );
    }
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

  // ── Staleness check ───────────────────────────────────────

  /**
   * Wipe all catalog entries from in-memory store, SQLite, and the JSON cache file.
   * Called before a force-refresh so removed/renamed items don't persist.
   */
  clearAll(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.data = { version: 1, lastFetched: null, items: {}, ships: {}, skills: {}, recipes: {} };
    if (this._db) {
      this._db.run("DELETE FROM catalog_items");
      this._db.run("DELETE FROM catalog_meta");
    }
    if (existsSync(CATALOG_FILE)) {
      writeFileSync(CATALOG_FILE, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
    }
    console.log("[CatalogStore] Cleared all catalog data");
  }

  /** True if catalog data is missing or older than 24 hours. */
  isStale(): boolean {
    if (!this.data.lastFetched) return true;
    const age = Date.now() - new Date(this.data.lastFetched).getTime();
    return age > STALE_MS;
  }

  // ── Fetch from API ────────────────────────────────────────

  /** Paginate all 4 catalog types and store results. */
  async fetchAll(api: SpaceMoltAPI): Promise<void> {
    // If a fetch is already in progress, wait for it rather than running a
    // concurrent fetch that would partially overwrite results.
    if (this._fetchPromise) return this._fetchPromise;

    this._fetchPromise = this._doFetchAll(api).finally(() => {
      this._fetchPromise = null;
    });
    return this._fetchPromise;
  }

  private async _doFetchAll(api: SpaceMoltAPI): Promise<void> {
    const types = ["items", "ships", "skills", "recipes"] as const;
    const results: Record<string, Record<string, unknown>> = {
      items: {},
      ships: {},
      skills: {},
      recipes: {},
    };

    for (const type of types) {
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const resp = await api.execute("catalog", { type, page, page_size: 50 });
        if (resp.error) break;

        const data = resp.result as Record<string, unknown> | undefined;
        if (!data) break;

        // Extract items array from various response shapes
        const entries = extractArray(data, type);

        for (const entry of entries) {
          const id = (entry.id as string) || (entry.item_id as string) || (entry.recipe_id as string) || (entry.skill_id as string) || (entry.ship_id as string) || "";
          if (id) {
            // Normalize: ensure id field is set
            entry.id = id;
            results[type][id] = entry;
          }
        }

        totalPages = (data.total_pages as number) || (data.totalPages as number) || 1;
        page++;
      }
    }

    this.data.items = results.items as Record<string, CatalogItem>;
    this.data.ships = results.ships as Record<string, CatalogShip>;
    this.data.skills = results.skills as Record<string, CatalogSkill>;
    this.data.recipes = results.recipes as Record<string, CatalogRecipe>;
    this.data.lastFetched = new Date().toISOString();

    this.dirty = true;
    this.persist();

    const counts = [
      `${Object.keys(this.data.items).length} items`,
      `${Object.keys(this.data.ships).length} ships`,
      `${Object.keys(this.data.skills).length} skills`,
      `${Object.keys(this.data.recipes).length} recipes`,
    ];
    return void counts; // logged by caller
  }

  // ── Lookup methods ────────────────────────────────────────

  getItem(id: string): CatalogItem | undefined {
    return this.data.items[id];
  }

  getShip(id: string): CatalogShip | undefined {
    return this.data.ships[id];
  }

  getSkill(id: string): CatalogSkill | undefined {
    return this.data.skills[id];
  }

  getRecipe(id: string): CatalogRecipe | undefined {
    return this.data.recipes[id];
  }

  /** Resolve a human-readable name for any catalog ID. Falls back to formatted ID. */
  resolveItemName(id: string): string {
    const entry = this.data.items[id] || this.data.ships[id] || this.data.skills[id] || this.data.recipes[id];
    if (entry?.name) return entry.name as string;
    return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Return full catalog data for WS broadcast / REST endpoint. */
  getAll(): { items: Record<string, CatalogItem>; ships: Record<string, CatalogShip>; skills: Record<string, CatalogSkill>; recipes: Record<string, CatalogRecipe>; lastFetched: string | null } {
    return {
      items: this.data.items,
      ships: this.data.ships,
      skills: this.data.skills,
      recipes: this.data.recipes,
      lastFetched: this.data.lastFetched,
    };
  }

  /** Check if an item appears as a component in any crafting recipe. */
  isCraftingComponent(itemId: string): boolean {
    for (const recipe of Object.values(this.data.recipes)) {
      if (!recipe.components) continue;
      if (recipe.components.some(c => c.item_id === itemId)) return true;
    }
    return false;
  }

  /** Check if an item is the output of any crafting recipe. */
  isCraftedItem(itemId: string): boolean {
    for (const recipe of Object.values(this.data.recipes)) {
      const outputId = (recipe as Record<string, unknown>).output_item_id as string | undefined;
      if (outputId === itemId) return true;
    }
    return false;
  }

  /** Summary string for logging. */
  getSummary(): string {
    return `${Object.keys(this.data.items).length} items, ${Object.keys(this.data.ships).length} ships, ${Object.keys(this.data.skills).length} skills, ${Object.keys(this.data.recipes).length} recipes`;
  }

  // ── DataSync helpers ─────────────────────────────────────

  /**
   * Merge catalog entries received from a remote VM.
   * Only adds entries not already present — existing local data is never overwritten.
   */
  mergeItems(
    items: CatalogItem[],
    ships: CatalogShip[],
    skills: CatalogSkill[] = [],
    recipes: CatalogRecipe[] = [],
  ): void {
    let changed = false;
    for (const item of items) {
      if (item.id && !this.data.items[item.id]) { this.data.items[item.id] = item; changed = true; }
    }
    for (const ship of ships) {
      if (ship.id && !this.data.ships[ship.id]) { this.data.ships[ship.id] = ship; changed = true; }
    }
    for (const skill of skills) {
      if (skill.id && !this.data.skills[skill.id]) { this.data.skills[skill.id] = skill; changed = true; }
    }
    for (const recipe of recipes) {
      if (recipe.id && !this.data.recipes[recipe.id]) { this.data.recipes[recipe.id] = recipe; changed = true; }
    }
    if (changed) this.scheduleSave();
  }
}

/** Extract an array of entries from a catalog API response. */
function extractArray(data: Record<string, unknown>, type: string): Array<Record<string, unknown>> {
  // Direct array response
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  // Keyed by type name
  if (Array.isArray(data[type])) return data[type] as Array<Record<string, unknown>>;
  // Common alternate keys
  for (const key of ["items", "catalog", "results", "data", "entries", "list"]) {
    if (Array.isArray(data[key])) return data[key] as Array<Record<string, unknown>>;
  }
  return [];
}

/** Singleton instance shared across the application. */
export const catalogStore = new CatalogStore();
