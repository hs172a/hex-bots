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
    console.log("[DataSync] Client stopped");
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
