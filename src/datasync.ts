/**
 * DataSync — shared game knowledge layer for multi-VM deployments.
 *
 * Goal: bots on different VMs (different IPs → separate rate-limit pools) share
 * the game data they accumulate: map topology, market prices, catalog entries.
 * Routines on every VM benefit from discoveries made by bots on other VMs.
 *
 * Architecture:
 *   VM1 (master) — binds to 127.0.0.1 by default (SSH-tunnel model).
 *     Client VMs forward port 4001 via SSH: ssh -L 4001:127.0.0.1:4001 vm1
 *     Exposes HTTP endpoints for fast (market/pirate) and slow (topology) sync.
 *
 *   VM2/3 (client) — connects to master_url (typically 127.0.0.1:4001 via SSH tunnel).
 *     On startup: pulls full map + catalog from master, merges into local stores.
 *     Every push_interval_sec (60s): fast-push market prices + pirate sightings.
 *     Every slow_push_interval_sec (600s): slow-push full topology changes.
 *     Every pull_interval_sec (300s): pull fast + topology updates from master.
 *
 * Priority split:
 *   /sync/fast  — market prices, player orders, pirate sightings (high-freq, small payload)
 *   /sync/map/systems — full topology incl. connections, POIs, ore records (low-freq)
 *   /sync/catalog — catalog items/ships/skills/recipes (one-time on startup)
 *
 * Security: api_key required as Bearer token. Master defaults to 127.0.0.1 binding.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import type { MapStore, StoredSystem, FastPatch } from "./mapstore.js";
import type { CatalogStore, CatalogItem, CatalogShip, CatalogSkill, CatalogRecipe } from "./catalogstore.js";
import type { DataSyncConfig } from "./types/config.js";

// ── Validation helpers ────────────────────────────────────────────────────────

const MAX_SYSTEMS_PER_REQUEST = 500;
const MAX_PATCHES_PER_REQUEST = 500;

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isIso(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

/** True if the timestamp string is too far in the future (clock skew guard). */
function isFutureDated(ts: unknown, maxSkewSec: number): boolean {
  if (typeof ts !== "string") return false;
  const d = new Date(ts);
  return !isNaN(d.getTime()) && d.getTime() > Date.now() + maxSkewSec * 1000;
}

/** Validate and sanitize a StoredSystem received from a client. Returns null if invalid. */
function sanitizeSystem(raw: unknown, maxSkewSec: number): StoredSystem | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!isString(s.id) || !isString(s.name) || !isIso(s.last_updated as unknown)) return null;
  if (!Array.isArray(s.connections) || !Array.isArray(s.pois)) return null;
  if (isFutureDated(s.last_updated, maxSkewSec)) return null; // clock skew guard
  return s as unknown as StoredSystem;
}

/** Validate and sanitize a FastPatch received from a client. Returns null if invalid. */
function sanitizeFastPatch(raw: unknown, maxSkewSec: number): FastPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!isString(p.system_id) || !isIso(p.last_updated as unknown)) return null;
  if (!Array.isArray(p.market_updates) || !Array.isArray(p.pirate_sightings)) return null;
  if (isFutureDated(p.last_updated, maxSkewSec)) return null; // clock skew guard
  // Validate each market_update entry
  for (const mu of p.market_updates as unknown[]) {
    if (!mu || typeof mu !== "object") return null;
    const m = mu as Record<string, unknown>;
    if (!isString(m.poi_id) || !Array.isArray(m.market) || !isIso(m.last_updated as unknown)) return null;
    if (isFutureDated(m.last_updated, maxSkewSec)) return null; // per-POI skew guard
    // Validate market prices are non-negative numbers
    for (const item of m.market as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const mi = item as Record<string, unknown>;
      if (!isString(mi.item_id)) return null;
      if (mi.best_buy !== null && typeof mi.best_buy !== "number") return null;
      if (mi.best_sell !== null && typeof mi.best_sell !== "number") return null;
      if (typeof mi.best_buy === "number" && mi.best_buy < 0) return null;
      if (typeof mi.best_sell === "number" && mi.best_sell < 0) return null;
    }
  }
  return p as unknown as FastPatch;
}

// ── Code sync utilities ────────────────────────────────────────────────────────

export interface CodeManifestEntry {
  /** Relative path from src/ root, forward-slash separated. */
  path: string;
  /** SHA-256 hex hash of file contents. */
  hash: string;
  /** Byte size of the file. */
  size: number;
}

/** SHA-256 hex hash of a string. Uses Bun's built-in hasher. */
function hashString(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

/** Recursively walk a directory yielding file paths relative to baseDir.
 *  Only includes .ts and .vue source files; skips node_modules, dist, etc. */
async function* walkSrcDir(dir: string, baseDir: string): AsyncGenerator<string> {
  const SKIP_DIRS = new Set(["node_modules", ".git", ".txt"]);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { return; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkSrcDir(join(dir, entry.name), baseDir);
    } else if (entry.isFile()) {
      if (!/\.(ts|vue)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".d.ts")) continue; // skip declaration files
      const rel = relative(baseDir, join(dir, entry.name)).replace(/\\/g, "/");
      yield rel;
    }
  }
}

/** Build a manifest of all source files with their hashes. */
async function buildCodeManifest(srcDir: string): Promise<CodeManifestEntry[]> {
  const entries: CodeManifestEntry[] = [];
  for await (const relPath of walkSrcDir(srcDir, srcDir)) {
    try {
      const content = await Bun.file(join(srcDir, relPath)).text();
      entries.push({ path: relPath, hash: hashString(content), size: content.length });
    } catch { /* skip unreadable */ }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** The src/ directory — same folder this datasync module lives in. */
const CODE_SRC_DIR: string = import.meta.dir;

// ── DataSyncServer ────────────────────────────────────────────────────────────

export interface StatsSyncOpts {
  /** Returns this pool's current daily stats (bot → date → DayStats). */
  getMyStats: () => Record<string, any>;
  /** Pool name to identify this VM in aggregated results. */
  poolName: string;
}

export class DataSyncServer {
  private map: MapStore;
  private catalog: CatalogStore;
  private cfg: DataSyncConfig;
  private server: ReturnType<typeof Bun.serve> | null = null;

  private statsOpts: StatsSyncOpts | null;
  /** Per-pool stats received from client VMs: poolName → daily. */
  private clientPoolStats: Map<string, Record<string, any>> = new Map();

  constructor(map: MapStore, catalog: CatalogStore, cfg: DataSyncConfig, statsOpts?: StatsSyncOpts) {
    this.map = map;
    this.catalog = catalog;
    this.cfg = cfg;
    this.statsOpts = statsOpts ?? null;
  }

  /** Returns aggregated stats from all pools (own + all connected clients). */
  getAllPoolsStats(): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {};
    if (this.statsOpts) result[this.statsOpts.poolName] = this.statsOpts.getMyStats();
    for (const [name, daily] of this.clientPoolStats) result[name] = daily;
    return result;
  }

  start(): void {
    const { map, catalog, cfg } = this;
    const statsOpts = this.statsOpts;
    const clientPoolStats = this.clientPoolStats;

    this.server = Bun.serve({
      hostname: cfg.host,
      port: cfg.port,
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        // ── Auth ──────────────────────────────────────────────────────────
        if (cfg.api_key) {
          const auth = req.headers.get("Authorization");
          if (auth !== `Bearer ${cfg.api_key}`) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        const json = (data: unknown, status = 200): Response =>
          new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" },
          });

        // ── GET /sync/stats ───────────────────────────────────────────────
        // Returns this master pool's own stats (useful for clients to mirror)
        if (req.method === "GET" && url.pathname === "/sync/stats") {
          const myStats = statsOpts ? statsOpts.getMyStats() : {};
          return json({ pool: statsOpts?.poolName ?? "master", daily: myStats });
        }

        // ── POST /sync/stats ──────────────────────────────────────────────
        // Client VMs push their stats here; master aggregates
        if (req.method === "POST" && url.pathname === "/sync/stats") {
          try {
            const body = await req.json() as { pool?: string; daily?: unknown };
            if (typeof body.pool === "string" && body.pool && body.daily && typeof body.daily === "object") {
              clientPoolStats.set(body.pool, body.daily as Record<string, any>);
              return json({ ok: true });
            }
            return json({ error: "Missing pool or daily" }, 400);
          } catch {
            return json({ error: "Invalid JSON" }, 400);
          }
        }

        // ── GET /sync/all-stats ───────────────────────────────────────────
        // Returns aggregated stats from all known pools (master + all clients)
        if (req.method === "GET" && url.pathname === "/sync/all-stats") {
          const result: Record<string, Record<string, any>> = {};
          if (statsOpts) result[statsOpts.poolName] = statsOpts.getMyStats();
          for (const [name, daily] of clientPoolStats) result[name] = daily;
          return json(result);
        }

        // ── GET /sync/status ──────────────────────────────────────────────
        if (req.method === "GET" && url.pathname === "/sync/status") {
          const cd = catalog.getAll();
          return json({
            ok: true,
            ts: new Date().toISOString(),
            systems: map.getAllSystemIds().length,
            catalog_items: Object.keys(cd.items).length,
            catalog_ships: Object.keys(cd.ships).length,
          });
        }

        // ── GET /sync/fast?since=<iso> ────────────────────────────────────
        // Returns market prices + pirate sightings only (lightweight, high-freq)
        if (req.method === "GET" && url.pathname === "/sync/fast") {
          const sinceParam = url.searchParams.get("since");
          const since = sinceParam ? new Date(sinceParam) : new Date(0);
          const patches = map.getFastPatchesSince(since);
          return json({ patches });
        }

        // ── POST /sync/fast ───────────────────────────────────────────────
        if (req.method === "POST" && url.pathname === "/sync/fast") {
          try {
            const body = await req.json() as { patches?: unknown[] };
            const raw = body.patches ?? [];
            if (raw.length > MAX_PATCHES_PER_REQUEST)
              return json({ error: `Too many patches (max ${MAX_PATCHES_PER_REQUEST})` }, 400);
            const patches: FastPatch[] = [];
            for (const item of raw) {
              const p = sanitizeFastPatch(item, cfg.max_clock_skew_sec);
              if (p) patches.push(p);
            }
            map.applyFastPatches(patches);
            return json({ ok: true, applied: patches.length, rejected: raw.length - patches.length });
          } catch {
            return json({ error: "Invalid JSON" }, 400);
          }
        }

        // ── GET /sync/map/systems?since=<iso> ─────────────────────────────
        // Returns full topology: connections, POIs, ores, wrecks (low-freq)
        if (req.method === "GET" && url.pathname === "/sync/map/systems") {
          const sinceParam = url.searchParams.get("since");
          const since = sinceParam ? new Date(sinceParam) : new Date(0);
          const systems = map.getSystemsSince(since);
          return json({ systems });
        }

        // ── POST /sync/map/systems ────────────────────────────────────────
        if (req.method === "POST" && url.pathname === "/sync/map/systems") {
          try {
            const body = await req.json() as { systems?: unknown[] };
            const raw = body.systems ?? [];
            if (raw.length > MAX_SYSTEMS_PER_REQUEST)
              return json({ error: `Too many systems (max ${MAX_SYSTEMS_PER_REQUEST})` }, 400);
            const systems: StoredSystem[] = [];
            for (const item of raw) {
              const s = sanitizeSystem(item, cfg.max_clock_skew_sec);
              if (s) systems.push(s);
            }
            map.mergeSystems(systems);
            return json({ ok: true, merged: systems.length, rejected: raw.length - systems.length });
          } catch {
            return json({ error: "Invalid JSON" }, 400);
          }
        }

        // ── GET /sync/catalog ─────────────────────────────────────────────
        if (req.method === "GET" && url.pathname === "/sync/catalog") {
          return json(catalog.getAll());
        }

        // ── POST /sync/catalog ────────────────────────────────────────────
        if (req.method === "POST" && url.pathname === "/sync/catalog") {
          try {
            const body = await req.json() as {
              items?: CatalogItem[];
              ships?: CatalogShip[];
              skills?: CatalogSkill[];
              recipes?: CatalogRecipe[];
            };
            catalog.mergeItems(
              body.items ?? [],
              body.ships ?? [],
              body.skills ?? [],
              body.recipes ?? [],
            );
            return json({ ok: true });
          } catch {
            return json({ error: "Invalid JSON" }, 400);
          }
        }

        // ── GET /sync/code/manifest ────────────────────────────────────────
        // Returns SHA-256 hash + size for every .ts/.vue file in src/
        if (req.method === "GET" && url.pathname === "/sync/code/manifest") {
          const manifest = await buildCodeManifest(CODE_SRC_DIR);
          return json({ files: manifest, ts: new Date().toISOString() });
        }

        // ── GET /sync/code/file?path=<relPath> ─────────────────────────────
        // Returns the raw content of a single source file
        if (req.method === "GET" && url.pathname === "/sync/code/file") {
          const relPath = url.searchParams.get("path") ?? "";
          // Security: no path traversal, no absolute paths, only .ts/.vue
          if (!relPath || relPath.includes("..") || /^[/\\]/.test(relPath) || !/\.(ts|vue)$/.test(relPath)) {
            return json({ error: "Invalid path" }, 400);
          }
          const safePath = relPath.replace(/\\/g, "/");
          try {
            const content = await Bun.file(join(CODE_SRC_DIR, safePath)).text();
            return json({ path: safePath, content });
          } catch {
            return json({ error: "File not found" }, 404);
          }
        }

        return json({ error: "Not Found" }, 404);
      },
    });

    console.log(`[DataSync] Master server listening on ${cfg.host}:${cfg.port}`);
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
    console.log("[DataSync] Master server stopped");
  }
}

// ── DataSyncClient ────────────────────────────────────────────────────────────

export class DataSyncClient {
  private map: MapStore;
  private catalog: CatalogStore;
  private cfg: DataSyncConfig;

  private statsOpts: StatsSyncOpts | null;

  private lastFastPullAt = new Date(0);
  private lastSlowPullAt = new Date(0);
  private lastFastPushAt = new Date(0);
  private lastSlowPushAt = new Date(0);

  private fastPushTimer: ReturnType<typeof setInterval> | null = null;
  private slowPushTimer: ReturnType<typeof setInterval> | null = null;
  private statsPushTimer: ReturnType<typeof setInterval> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private codeSyncTimer: ReturnType<typeof setInterval> | null = null;

  /** Cached aggregated stats from all pools (pulled from master). */
  private cachedRemotePoolsStats: Record<string, Record<string, any>> = {};

  /** Consecutive network failure counter across all sync operations. */
  private consecutiveFailures = 0;
  private isOffline = false;
  private static readonly OFFLINE_THRESHOLD = 3;

  /** Called when the offline status changes. Wire this to broadcastDataSyncStatus(). */
  onStatusChange?: (offline: boolean) => void;

  constructor(map: MapStore, catalog: CatalogStore, cfg: DataSyncConfig, statsOpts?: StatsSyncOpts) {
    this.map = map;
    this.catalog = catalog;
    this.cfg = cfg;
    this.statsOpts = statsOpts ?? null;
  }

  async start(): Promise<void> {
    const { master_url, pull_interval_sec, push_interval_sec, slow_push_interval_sec } = this.cfg;
    if (!master_url) {
      console.error("[DataSync] Client mode requires master_url in config — datasync disabled");
      return;
    }

    console.log(`[DataSync] Client connecting to master: ${master_url}`);

    // Initial startup pull: full topology + full catalog
    await this.pullTopologySince(new Date(0));
    await this.pullCatalog();
    this.lastFastPullAt = new Date();
    this.lastSlowPullAt = new Date();

    // Periodic pull: fast data (market/pirates) + slow data (topology) combined
    const pullMs = (pull_interval_sec || 300) * 1000;
    this.pullTimer = setInterval(async () => {
      await this.pullFastSince(this.lastFastPullAt).catch(e =>
        console.warn("[DataSync] Fast pull error:", e instanceof Error ? e.message : e));
      await this.pullTopologySince(this.lastSlowPullAt).catch(e =>
        console.warn("[DataSync] Slow pull error:", e instanceof Error ? e.message : e));
    }, pullMs);

    // Fast push: market prices + pirate sightings (high-freq)
    const fastPushMs = (push_interval_sec || 60) * 1000;
    this.fastPushTimer = setInterval(() => {
      this.pushFast().catch(e =>
        console.warn("[DataSync] Fast push error:", e instanceof Error ? e.message : e));
    }, fastPushMs);

    // Slow push: full topology changes (low-freq)
    const slowPushMs = (slow_push_interval_sec || 600) * 1000;
    this.slowPushTimer = setInterval(() => {
      this.pushSlow().catch(e =>
        console.warn("[DataSync] Slow push error:", e instanceof Error ? e.message : e));
    }, slowPushMs);

    // Stats push: own pool stats → master (same cadence as fast push)
    if (this.statsOpts) {
      this.pushStats().catch(() => { /* ignore first-run errors */ });
      this.statsPushTimer = setInterval(() => {
        this.pushStats().catch(e =>
          console.warn("[DataSync] Stats push error:", e instanceof Error ? e.message : e));
      }, fastPushMs);
    }

    // All-pools stats pull: fetch aggregated stats from master periodically
    this.pullAllStats().catch(() => { /* ignore first-run errors */ });
    setInterval(() => {
      this.pullAllStats().catch(e =>
        console.warn("[DataSync] All-stats pull error:", e instanceof Error ? e.message : e));
    }, fastPushMs);

    // Code sync: periodically check master for source code updates
    const codeSyncMs = (this.cfg.code_sync_interval_sec || 0) * 1000;
    if (codeSyncMs > 0) {
      this.codeSyncTimer = setInterval(() => {
        this.syncCode().catch(e =>
          console.warn("[DataSync] Code sync error:", e instanceof Error ? e.message : e));
      }, codeSyncMs);
      console.log(`[DataSync] Code sync enabled — checking every ${this.cfg.code_sync_interval_sec}s`);
    }

    console.log(
      `[DataSync] Client running — pull every ${pull_interval_sec}s, ` +
      `fast-push every ${push_interval_sec}s, slow-push every ${slow_push_interval_sec}s`
    );
  }

  stop(): void {
    if (this.fastPushTimer) { clearInterval(this.fastPushTimer); this.fastPushTimer = null; }
    if (this.slowPushTimer) { clearInterval(this.slowPushTimer); this.slowPushTimer = null; }
    if (this.statsPushTimer) { clearInterval(this.statsPushTimer); this.statsPushTimer = null; }
    if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = null; }
    if (this.codeSyncTimer) { clearInterval(this.codeSyncTimer); this.codeSyncTimer = null; }
    console.log("[DataSync] Client stopped");
  }

  /**
   * Pull source code from master and write any changed files to disk.
   * If the project runs with Bun --watch or --hot, changed files trigger an auto-restart.
   *
   * Returns a summary { updated, failed } with relative paths.
   */
  async syncCode(): Promise<{ updated: string[]; failed: string[] }> {
    const updated: string[] = [];
    const failed: string[] = [];

    // Step 1: get manifest from master
    const mResp = await fetch(`${this.cfg.master_url}/sync/code/manifest`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!mResp.ok) {
      console.warn(`[CodeSync] GET /sync/code/manifest → ${mResp.status}`);
      this.recordFailure();
      return { updated, failed };
    }
    const body = await mResp.json() as { files?: CodeManifestEntry[] };
    const manifest = body.files ?? [];
    if (manifest.length === 0) return { updated, failed };

    // Step 2: compare local hashes and download only changed files
    const srcDir = CODE_SRC_DIR;
    for (const entry of manifest) {
      const localPath = join(srcDir, entry.path);
      try {
        let localContent: string | null = null;
        try {
          localContent = await Bun.file(localPath).text();
        } catch { /* file doesn't exist locally */ }

        const localHash = localContent !== null ? hashString(localContent) : "";
        if (localHash === entry.hash) continue; // up to date

        // Download the file from master
        const fResp = await fetch(
          `${this.cfg.master_url}/sync/code/file?path=${encodeURIComponent(entry.path)}`,
          { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
        );
        if (!fResp.ok) {
          console.warn(`[CodeSync] Failed to download ${entry.path}: HTTP ${fResp.status}`);
          failed.push(entry.path);
          continue;
        }
        const fBody = await fResp.json() as { content?: string };
        if (typeof fBody.content !== "string") { failed.push(entry.path); continue; }

        // Ensure directory exists and write
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, fBody.content, "utf-8");
        console.log(`[CodeSync] Updated ${entry.path} (${entry.size} bytes)`);
        updated.push(entry.path);
      } catch (err) {
        console.warn(`[CodeSync] Error syncing ${entry.path}:`, err instanceof Error ? err.message : err);
        failed.push(entry.path);
      }
    }

    if (updated.length > 0) {
      console.log(`[CodeSync] Sync complete — ${updated.length} file(s) updated, ${failed.length} failed`);
      this.recordSuccess();
    }
    return { updated, failed };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private recordSuccess(): void {
    if (this.consecutiveFailures === 0) return;
    this.consecutiveFailures = 0;
    if (this.isOffline) {
      this.isOffline = false;
      this.onStatusChange?.(false);
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (!this.isOffline && this.consecutiveFailures >= DataSyncClient.OFFLINE_THRESHOLD) {
      this.isOffline = true;
      this.onStatusChange?.(true);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.api_key) h["Authorization"] = `Bearer ${this.cfg.api_key}`;
    return h;
  }

  /** Resolve effective 'since' — if client was offline > max_stale_hours, force a full pull. */
  private effectiveSince(lastPullAt: Date): { since: Date; full: boolean } {
    const staleMs = (this.cfg.max_stale_hours || 24) * 60 * 60 * 1000;
    const full = lastPullAt.getTime() === 0 || (Date.now() - lastPullAt.getTime()) > staleMs;
    return { since: full ? new Date(0) : lastPullAt, full };
  }

  private async pullFastSince(since: Date): Promise<void> {
    const { since: effectiveSince, full } = this.effectiveSince(since);
    if (full && since.getTime() !== 0)
      console.log(`[DataSync] Fast pull: offline > ${this.cfg.max_stale_hours}h — forcing full pull`);
    const url = `${this.cfg.master_url}/sync/fast?since=${effectiveSince.toISOString()}`;
    const resp = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) { this.recordFailure(); console.warn(`[DataSync] GET /sync/fast → ${resp.status}`); return; }
    const body = await resp.json() as { patches?: FastPatch[] };
    const patches = body.patches ?? [];
    if (patches.length > 0) {
      this.map.applyFastPatches(patches);
      console.log(`[DataSync] Fast-pulled ${patches.length} patch(es) from master`);
    }
    this.lastFastPullAt = new Date();
    this.recordSuccess();
  }

  private async pullTopologySince(since: Date): Promise<void> {
    const { since: effectiveSince, full } = this.effectiveSince(since);
    if (full && since.getTime() !== 0)
      console.log(`[DataSync] Topology pull: offline > ${this.cfg.max_stale_hours}h — forcing full pull`);
    const url = `${this.cfg.master_url}/sync/map/systems?since=${effectiveSince.toISOString()}`;
    const resp = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) { this.recordFailure(); console.warn(`[DataSync] GET /sync/map/systems → ${resp.status}`); return; }
    const body = await resp.json() as { systems?: StoredSystem[] };
    const systems = body.systems ?? [];
    if (systems.length > 0) {
      this.map.mergeSystems(systems);
      console.log(`[DataSync] Slow-pulled ${systems.length} system(s) from master`);
    }
    this.lastSlowPullAt = new Date();
    this.recordSuccess();
  }

  private async pullCatalog(): Promise<void> {
    const resp = await fetch(`${this.cfg.master_url}/sync/catalog`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) { console.warn(`[DataSync] GET /sync/catalog → ${resp.status}`); return; }
    const body = await resp.json() as {
      items?: Record<string, CatalogItem>;
      ships?: Record<string, CatalogShip>;
      skills?: Record<string, CatalogSkill>;
      recipes?: Record<string, CatalogRecipe>;
    };
    this.catalog.mergeItems(
      Object.values(body.items ?? {}),
      Object.values(body.ships ?? {}),
      Object.values(body.skills ?? {}),
      Object.values(body.recipes ?? {}),
    );
    console.log("[DataSync] Pulled catalog from master");
  }

  /** Returns aggregated stats: own pool + remote pools pulled from master. */
  getAllPoolsStats(): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {};
    if (this.statsOpts) result[this.statsOpts.poolName] = this.statsOpts.getMyStats();
    for (const [pool, daily] of Object.entries(this.cachedRemotePoolsStats)) {
      if (!this.statsOpts || pool !== this.statsOpts.poolName) result[pool] = daily;
    }
    return result;
  }

  private async pullAllStats(): Promise<void> {
    // Try the aggregated endpoint first (added in the multi-pool stats patch)
    const resp = await fetch(`${this.cfg.master_url}/sync/all-stats`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      this.cachedRemotePoolsStats = await resp.json() as Record<string, Record<string, any>>;
      this.recordSuccess();
      return;
    }
    // Fallback: master may be running older code without /sync/all-stats.
    // Use /sync/stats which returns the master pool's own stats only.
    if (resp.status === 404) {
      const fallback = await fetch(`${this.cfg.master_url}/sync/stats`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (fallback.ok) {
        const body = await fallback.json() as { pool?: string; daily?: Record<string, any> };
        if (body.pool && body.daily) {
          this.cachedRemotePoolsStats = { [body.pool]: body.daily };
          this.recordSuccess();
        }
      }
      return;
    }
    this.recordFailure();
  }

  private async pushStats(): Promise<void> {
    if (!this.statsOpts) return;
    const { poolName, getMyStats } = this.statsOpts;
    const daily = getMyStats();
    const resp = await fetch(`${this.cfg.master_url}/sync/stats`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ pool: poolName, daily }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      this.recordSuccess();
    } else {
      this.recordFailure();
      console.warn(`[DataSync] POST /sync/stats → ${resp.status}`);
    }
  }

  private async pushFast(): Promise<void> {
    const patches = this.map.getFastPatchesSince(this.lastFastPushAt);
    if (patches.length === 0) return;
    const resp = await fetch(`${this.cfg.master_url}/sync/fast`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ patches }),
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      console.log(`[DataSync] Fast-pushed ${patches.length} patch(es) to master`);
      this.lastFastPushAt = new Date();
      this.recordSuccess();
    } else {
      this.recordFailure();
      console.warn(`[DataSync] POST /sync/fast → ${resp.status}`);
    }
  }

  private async pushSlow(): Promise<void> {
    const systems = this.map.getSystemsSince(this.lastSlowPushAt);
    if (systems.length === 0) return;
    const resp = await fetch(`${this.cfg.master_url}/sync/map/systems`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ systems }),
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) {
      console.log(`[DataSync] Slow-pushed ${systems.length} system(s) to master`);
      this.lastSlowPushAt = new Date();
      this.recordSuccess();
    } else {
      this.recordFailure();
      console.warn(`[DataSync] POST /sync/map/systems → ${resp.status}`);
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Initialize DataSync based on config. Returns the active instance so the
 * caller can stop it on shutdown, or null if datasync is disabled.
 */
export function initDataSync(
  map: MapStore,
  catalog: CatalogStore,
  cfg: DataSyncConfig,
  statsOpts?: StatsSyncOpts,
): DataSyncServer | DataSyncClient | null {
  if (!cfg.enabled) return null;

  if (cfg.mode === "master") {
    const server = new DataSyncServer(map, catalog, cfg, statsOpts);
    server.start();
    return server;
  }

  if (cfg.mode === "client") {
    const client = new DataSyncClient(map, catalog, cfg, statsOpts);
    client.start().catch((e) => console.error("[DataSync] Client start error:", e));
    return client;
  }

  return null;
}
