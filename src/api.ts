import { log, logError } from "./ui.js";
import { logApiRequest, logApiResponse, logApiSession } from "./apilogger.js";

export interface ApiSession {
  id: string;
  playerId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface GameNotification {
  type?: string;
  msg_type?: string;
  data?: Record<string, unknown> | string;
  message?: string;
  [key: string]: unknown;
}

export interface ApiResponse {
  result?: unknown;
  notifications?: GameNotification[];
  session?: ApiSession;
  error?: { code: string; message: string; wait_seconds?: number; retry_after?: number } | null;
  /** v2 async action: server has queued this action for the next game tick. Poll with get_queue. */
  pending?: boolean;
}

/**
 * Typed response from v2 API endpoints.
 * `structuredContent` carries the machine-readable payload; `result` is a human-readable text summary.
 */
export interface V2Response<T = unknown> {
  /** Human-readable text summary. */
  result?: string;
  /** Machine-readable structured payload — prefer this over result. */
  structuredContent?: T;
  notifications?: GameNotification[];
  session?: ApiSession;
  error?: { code: string; message: string; wait_seconds?: number; retry_after?: number } | null;
  /** True when the server queued the action for the next game tick (async actions). */
  pending?: boolean;
}

const DEFAULT_BASE_URL = "https://game.spacemolt.com/api/v1";

// ── IP-block event (module-level so botmanager can subscribe) ──
let _ipBlockHandler: ((retryAfterSecs: number) => void) | null = null;
export function setIpBlockHandler(fn: (retryAfterSecs: number) => void): void {
  _ipBlockHandler = fn;
}

// ── Per-session action throttler ────────────────────────────
// Each SpaceMoltAPI instance (= one bot session) gets its own throttler.
// Server rate limits (as of the latest update):
//   Actions (mine, travel, craft, sell, …): 30/min per session
//   Queries (get_status, get_ship, …):    300/min per session
// We only throttle action commands — queries have a generous budget we'll never hit.

const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_SOFT_CAP  = 28;   // stay below server's 30 actions/min per session
const THROTTLE_LOG_COOLDOWN_MS = 15_000;

/** Commands that count toward the 30 actions/min per-session rate limit. */
const ACTION_COMMANDS = new Set([
  "travel", "jump", "dock", "undock",
  "attack", "cloak",
  "mine", "loot", "salvage",
  "sell", "buy", "jettison", "craft",
  "create_sell_order", "create_buy_order", "cancel_order", "modify_order",
  "refuel", "repair",
  "deposit_items", "withdraw_items",
  "faction_deposit_items", "faction_withdraw_items",
  "faction_deposit_credits", "faction_withdraw_credits",
  "install_mod", "uninstall_mod", "repair_module", "buy_ship", "sell_ship", "switch_ship", "set_colors",
  "accept_mission", "complete_mission", "decline_mission", "abandon_mission",
  "chat", "send_gift", "trade_offer", "trade_accept", "trade_decline",
  "facility", "battle",
  "register",
]);

class RequestThrottler {
  private timestamps: number[] = [];
  private lastLogMs = 0;
  /** Serializes all throttle() calls — each waits for the previous to fully complete
   *  (including the timestamp write) before reading state. This prevents concurrent
   *  callers from all seeing timestamps.length < cap simultaneously and bypassing it. */
  private _queue: Promise<void> = Promise.resolve();

  throttle(): Promise<void> {
    // Chain onto the queue; keep queue alive even if a call somehow rejects
    const slot = this._queue.then(() => this._doThrottle());
    this._queue = slot.catch(() => {});
    return slot;
  }

  private async _doThrottle(): Promise<void> {
    const now = Date.now();
    // Drop timestamps outside the sliding window
    this.timestamps = this.timestamps.filter(t => now - t < THROTTLE_WINDOW_MS);

    if (this.timestamps.length >= THROTTLE_SOFT_CAP) {
      // Wait until the oldest request exits the window, plus a small buffer
      const oldest = this.timestamps[0];
      const waitMs = THROTTLE_WINDOW_MS - (now - oldest) + 250;
      if (waitMs > 0) {
        if (now - this.lastLogMs > THROTTLE_LOG_COOLDOWN_MS) {
          log("wait", `Throttle: ${this.timestamps.length} req/60s — waiting ${Math.round(waitMs / 1000)}s`);
          this.lastLogMs = now;
        }
        await sleep(waitMs);
        // Re-prune after sleeping
        const after = Date.now();
        this.timestamps = this.timestamps.filter(t => after - t < THROTTLE_WINDOW_MS);
      }
    }

    this.timestamps.push(Date.now());
  }

  /** Current request count in the last 60 seconds (for diagnostics). */
  get count(): number {
    const now = Date.now();
    return this.timestamps.filter(t => now - t < THROTTLE_WINDOW_MS).length;
  }
}

// (throttler is now per-instance inside SpaceMoltAPI — see _throttler field)

// ── Response cache ────────────────────────────────────────────

interface CacheEntry {
  response: ApiResponse;
  expiresAt: number;
}

/** In-memory cache for read-only game query responses, keyed by "command:payload". */
class ResponseCache {
  private entries = new Map<string, CacheEntry>();

  get(key: string): ApiResponse | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.response;
  }

  set(key: string, response: ApiResponse, ttlMs: number): void {
    this.entries.set(key, { response, expiresAt: Date.now() + ttlMs });
  }

  /** Delete all entries for the given commands. */
  invalidate(commands: string[]): void {
    for (const cmd of commands) {
      const prefix = `${cmd}:`;
      for (const key of this.entries.keys()) {
        if (key.startsWith(prefix)) this.entries.delete(key);
      }
    }
  }
}

// Cacheable read-only commands and their fallback TTLs (ms).
const COMMAND_TTL: Record<string, number> = {
  get_status:             15_000,
  get_system:             30_000,
  get_ship:               60_000,
  get_cargo:              10_000,
  get_nearby:             15_000,
  get_poi:                30_000,
  get_base:              120_000,
  get_skills:            120_000,
  get_missions:           60_000,
  view_storage:           30_000,
  view_faction_storage:   30_000,
  find_route:            300_000,
  survey_system:          60_000,
  search_systems:         60_000,
  get_queue:               5_000,
  view_market:            30_000,
  view_orders:            30_000,
  estimate_purchase:      30_000,
  get_wrecks:             15_000,
  v2_get_ship:            60_000,
  v2_get_cargo:           10_000,
  v2_get_player:          30_000,
  v2_get_skills:         120_000,
  v2_get_queue:            5_000,
  v2_get_missions:        60_000,
  v2_get_state:           15_000,
  v2_battle_status:        3_000,
};

// Cache groups for mutation invalidation
const INV_STATUS   = ["get_status", "v2_get_player", "get_queue", "v2_get_queue"];
const INV_LOCATION = ["get_system", "get_nearby", "get_poi", "get_base", "survey_system"];
const INV_CARGO    = ["get_cargo", "v2_get_cargo"];
const INV_SHIP     = ["get_ship", "v2_get_ship"];
const INV_MISSIONS = ["get_missions", "v2_get_missions"];
const INV_STORAGE  = ["view_storage", "view_faction_storage"];
const INV_MARKET   = ["view_market", "view_orders"];

/** Which cache entries to invalidate when a mutation command succeeds. */
const MUTATION_INVALIDATIONS: Record<string, string[]> = {
  travel:   [...INV_STATUS, ...INV_CARGO],
  jump:     [...INV_STATUS, ...INV_LOCATION],
  dock:     [...INV_STATUS, ...INV_STORAGE, ...INV_MARKET],
  undock:   INV_STATUS,
  mine:     [...INV_STATUS, ...INV_CARGO],
  sell:     [...INV_STATUS, ...INV_CARGO, ...INV_MARKET],
  buy:      [...INV_STATUS, ...INV_CARGO, ...INV_MARKET],
  jettison: [...INV_STATUS, ...INV_CARGO],
  craft:    [...INV_STATUS, ...INV_CARGO],
  loot:     [...INV_STATUS, ...INV_CARGO],
  salvage:  [...INV_STATUS, ...INV_CARGO],
  withdraw_items:           [...INV_STATUS, ...INV_CARGO, ...INV_STORAGE],
  deposit_items:            [...INV_STATUS, ...INV_CARGO, ...INV_STORAGE],
  faction_withdraw_items:   [...INV_STATUS, ...INV_CARGO, ...INV_STORAGE],
  faction_deposit_items:    [...INV_STATUS, ...INV_CARGO, ...INV_STORAGE],
  faction_deposit_credits:  INV_STATUS,
  faction_withdraw_credits: INV_STATUS,
  create_sell_order: [...INV_STATUS, ...INV_CARGO, ...INV_MARKET],
  create_buy_order:  [...INV_STATUS, ...INV_MARKET],
  cancel_order:      [...INV_STATUS, ...INV_MARKET],
  modify_order:      [...INV_STATUS, ...INV_MARKET],
  install_mod:    [...INV_STATUS, ...INV_SHIP, ...INV_CARGO],
  uninstall_mod:  [...INV_STATUS, ...INV_SHIP, ...INV_CARGO],
  repair_module:  [...INV_STATUS, ...INV_SHIP, ...INV_CARGO],
  repair:        [...INV_STATUS, ...INV_SHIP],
  refuel:        [...INV_STATUS, ...INV_SHIP],
  accept_mission:   [...INV_STATUS, ...INV_MISSIONS],
  complete_mission: [...INV_STATUS, ...INV_MISSIONS],
  abandon_mission:  [...INV_STATUS, ...INV_MISSIONS],
  decline_mission:  [...INV_STATUS, ...INV_MISSIONS],
  cloak:  INV_STATUS,
  attack: [...INV_STATUS, ...INV_SHIP],
  battle: [...INV_STATUS, ...INV_SHIP],
  trade_accept:  [...INV_STATUS, ...INV_CARGO],
  trade_decline: INV_STATUS,
};

// Commands with sub-actions that route through v2 endpoints instead of v1.
// v1: POST /api/v1/{command} { action: "sub", ...params }
// v2: POST /api/v2/spacemolt_{command}/{action} { ...params }
const V2_ROUTED_COMMANDS = new Set(["facility", "battle"]);

// Commands that always route directly to v2 (no sub-action needed).
// v2: POST /api/v2/spacemolt_{command} { ...params }
const V2_DIRECT_COMMANDS = new Set([
  "v2_get_cargo", "v2_get_player",
  "v2_get_queue", "v2_get_skills", "v2_get_missions",
  "v2_get_state", "v2_battle_status",
]);
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BASE_DELAY = 5_000; // 5s, 10s, 20s, 40s, 80s, 160s
const USER_AGENT = "HexBots/1.1.2";

export class SpaceMoltAPI {
  readonly baseUrl: string;
  /** Set to bot username to enable per-bot API logging. */
  label = "";
  private session: ApiSession | null = null;
  private v2Session: ApiSession | null = null;
  private credentials: { username: string; password: string } | null = null;
  private _rateLimitRetries = 0;
  private _cache = new ResponseCache();
  /** Mutex: prevents concurrent ensureSession() calls from each creating a session. */
  private _sessionLock: Promise<void> | null = null;
  private _v2SessionLock: Promise<void> | null = null;
  private _onSessionSaved: ((session: ApiSession) => void) | null = null;
  /** Per-session action throttler (30 actions/min server limit). */
  private _throttler = new RequestThrottler();
  /** Random jitter (0–300 s) so bots don't all renew sessions at the same second. */
  private readonly _sessionJitterMs = Math.floor(Math.random() * 300_000);

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.SPACEMOLT_URL || DEFAULT_BASE_URL;
  }

  setCredentials(username: string, password: string): void {
    this.credentials = { username, password };
  }

  getSession(): ApiSession | null {
    return this.session;
  }

  /** Inject a previously saved session directly (skips /session POST). */
  setSession(session: ApiSession): void {
    this.session = session;
  }

  /** Register a callback that fires whenever a new session is created or renewed. */
  setSessionSavedCallback(fn: (session: ApiSession) => void): void {
    this._onSessionSaved = fn;
  }

  /** Clear both sessions — next execute() will create fresh ones and re-authenticate. */
  resetSession(): void {
    this.session = null;
    this.v2Session = null;
  }

  /** Check if a command will route to a v2 endpoint. */
  private isV2Command(command: string, payload?: Record<string, unknown>): boolean {
    return V2_DIRECT_COMMANDS.has(command)
      || (V2_ROUTED_COMMANDS.has(command) && !!payload?.action && typeof payload.action === "string");
  }

  async execute(command: string, payload?: Record<string, unknown>, _tickRetry = 0): Promise<ApiResponse> {
    // Return cached response for read-only commands when fresh
    const cacheTtl = COMMAND_TTL[command];
    const cacheKey = `${command}:${JSON.stringify(payload ?? {})}`;
    if (cacheTtl !== undefined) {
      const cached = this._cache.get(cacheKey);
      if (cached) return cached;
    }

    const needsV2 = this.isV2Command(command, payload);
    try {
      await this.ensureSession();
      if (needsV2) await this.ensureV2Session();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("Login failed:")) {
        return { error: { code: "login_failed", message: msg } };
      }
      return { error: { code: "connection_failed", message: "Could not connect to server" } };
    }

    let resp: ApiResponse;
    try {
      resp = await this.doRequest(command, payload);
    } catch {
      // Network error — server may have restarted mid-request
      log("system", "Connection lost, reconnecting...");
      this.session = null;
      this.v2Session = null;
      try {
        await this.ensureSession();
        if (needsV2) await this.ensureV2Session();
        resp = await this.doRequest(command, payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("Login failed:")) {
          return { error: { code: "login_failed", message: msg } };
        }
        return { error: { code: "connection_failed", message: "Could not reconnect to server" } };
      }
    }

    // Handle session/auth errors by refreshing and retrying
    if (resp.error) {
      const code = resp.error.code;

      if (code === "ip_blocked" || code === "blocked" || code === "rate_blocked") {
        const secs = resp.error.retry_after ?? resp.error.wait_seconds ?? 120;
        log("error", `IP blocked by server — retry after ${secs}s`);
        _ipBlockHandler?.(secs);
        await sleep(Math.ceil(secs * 1000));
        return this.execute(command, payload);
      }

      if (code === "rate_limited" || code === "rate_limit") {
        const secs = resp.error.retry_after ?? resp.error.wait_seconds ?? 10;
        this._rateLimitRetries++;
        if (this._rateLimitRetries >= 5) {
          log("error", `Rate limited ${this._rateLimitRetries} times, giving up on ${command}`);
          this._rateLimitRetries = 0;
          return resp;
        }
        log("wait", `Rate limited — sleeping ${secs}s... (retry ${this._rateLimitRetries}/5)`);
        await sleep(Math.ceil(secs * 1000));
        return this.execute(command, payload);
      }

      if (code === "action_in_progress" || (resp.error.message ?? "").includes("Another action is already in progress")) {
        if (_tickRetry < 3) {
          await sleep(11_000);
          return this.execute(command, payload, _tickRetry + 1);
        }
      }

      if (code === "session_invalid" || code === "session_expired" || code === "not_authenticated") {
        log("system", `Session invalid for '${command}' (${needsV2 ? "v2" : "v1"}), refreshing... [code=${code}]`);
        logApiSession(this.label, "SESSION_INVALIDATED", `command=${command} code=${code}`);
        if (needsV2) {
          this.v2Session = null;
          await this.ensureV2Session();
        } else {
          this.session = null;
          await this.ensureSession();
        }
        // Fall through with fresh request so cache logic runs below
        resp = await this.doRequest(command, payload);
      }
    }

    // Reset rate-limit counter on success
    this._rateLimitRetries = 0;

    // Update session info from response
    if (resp.session) {
      if (needsV2) {
        this.v2Session = resp.session;
      } else {
        this.session = resp.session;
      }
    }

    if (!resp.error) {
      // Cache successful read responses
      if (cacheTtl !== undefined) {
        this._cache.set(cacheKey, resp, cacheTtl);
      }
      // Invalidate affected caches on successful mutations
      const toInvalidate = MUTATION_INVALIDATIONS[command];
      if (toInvalidate) this._cache.invalidate(toInvalidate);
    }

    return resp;
  }

  private async ensureSession(): Promise<void> {
    if (this.session && !this.isSessionExpiring()) return;

    // Serialize concurrent calls: if another call is already creating a session, wait
    if (this._sessionLock) {
      log("system", "[SESSION] Another creation in progress, waiting for lock...");
      await this._sessionLock;
      log("system", "[SESSION] Lock released, reusing session");
      return; // session is now set by the call that held the lock
    }

    // We're first — take the lock and create the session
    let unlock!: () => void;
    this._sessionLock = new Promise<void>(r => { unlock = r; });
    try {
      await this._doCreateSession();
    } finally {
      this._sessionLock = null;
      unlock();
    }
  }

  private async _doCreateSession(): Promise<void> {
    const callerTrace = new Error().stack?.split("\n").slice(3, 6).map(l => l.trim()).join(" | ") ?? "unknown";
    log("system", this.session ? "Renewing session..." : "Creating new session...");
    logApiSession(this.label, "LOCK_ACQUIRED", `caller: ${callerTrace}`);

    // Retry with backoff — server may be restarting
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      try {
        const sessionUrl = `${this.baseUrl}/session`;
        const sessionStart = Date.now();
        logApiSession(this.label, "CREATE", sessionUrl);
        const resp = await fetch(sessionUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        });
        const sessionDuration = Date.now() - sessionStart;

        if (!resp.ok) {
          throw new Error(`Failed to create session: ${resp.status} ${resp.statusText}`);
        }

        const data = (await resp.json()) as ApiResponse;
        logApiResponse(this.label, sessionUrl, resp.status, sessionDuration, data);
        if (data.session) {
          this.session = data.session;
          log("system", `Session created: ${this.session.id.slice(0, 8)}...`);
          logApiSession(this.label, "CREATED", `id=${this.session.id.slice(0, 8)}...`);
        } else {
          throw new Error("No session in response");
        }

        // Re-authenticate if we have credentials
        if (this.credentials) {
          log("system", `Logging in as ${this.credentials.username}...`);
          const loginResp = await this.doRequest("login", {
            username: this.credentials.username,
            password: this.credentials.password,
          });
          if (loginResp.error) {
            logApiSession(this.label, "LOGIN_FAILED", loginResp.error.message);
            // Throw so callers get an explicit error rather than continuing with
            // an unauthenticated session that will fail on every subsequent request.
            throw new Error(`Login failed: ${loginResp.error.message}`);
          }
          log("system", "Logged in successfully");
          // Login may return a new session — capture it
          if (loginResp.session) {
            this.session = loginResp.session;
            logApiSession(this.label, "SESSION_UPDATED", `new id=${this.session.id.slice(0, 8)}...`);
          } else {
            logApiSession(this.label, "SESSION_KEPT", `kept id=${this.session.id.slice(0, 8)}... (login did not return new session)`);
          }
        }
        // Persist session so the next restart can resume without re-login
        if (this.session) this._onSessionSaved?.(this.session);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempt);
        log("system", `Server unreachable (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS}), retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
    throw lastError || new Error("Failed to connect to server");
  }

  private isSessionExpiring(): boolean {
    if (!this.session) return true;
    const expiresAt = new Date(this.session.expiresAt).getTime();
    const now = Date.now();
    // Jitter spreads hourly renewals across 0–300 s so all bots don't reconnect at once
    return expiresAt - now < (60_000 + this._sessionJitterMs);
  }

  private isV2SessionExpiring(): boolean {
    if (!this.v2Session) return true;
    const expiresAt = new Date(this.v2Session.expiresAt).getTime();
    const now = Date.now();
    return expiresAt - now < (60_000 + this._sessionJitterMs);
  }

  /** Create and authenticate a v2 session (separate session store from v1). */
  private async ensureV2Session(): Promise<void> {
    if (this.v2Session && !this.isV2SessionExpiring()) return;

    if (this._v2SessionLock) {
      await this._v2SessionLock;
      return;
    }

    let unlock!: () => void;
    this._v2SessionLock = new Promise<void>(r => { unlock = r; });
    try {
      await this._doCreateV2Session();
    } finally {
      this._v2SessionLock = null;
      unlock();
    }
  }

  private async _doCreateV2Session(): Promise<void> {
    const v2Base = this.baseUrl.replace("/api/v1", "/api/v2");
    log("system", this.v2Session ? "Renewing v2 session..." : "Creating v2 session...");

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      try {
        const v2SessionUrl = `${v2Base}/session`;
        logApiSession(this.label, "CREATE_V2", v2SessionUrl);
        const resp = await fetch(v2SessionUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        });

        if (!resp.ok) {
          throw new Error(`Failed to create v2 session: ${resp.status} ${resp.statusText}`);
        }

        const data = (await resp.json()) as ApiResponse;
        if (data.session) {
          // Normalize v2 snake_case fields
          const s = data.session as unknown as Record<string, unknown>;
          if (s.created_at && !s.createdAt) {
            s.createdAt = s.created_at;
            s.expiresAt = s.expires_at;
            s.playerId = s.player_id;
          }
          this.v2Session = data.session;
          log("system", `v2 session created: ${this.v2Session.id.slice(0, 8)}...`);
          logApiSession(this.label, "CREATED_V2", `id=${this.v2Session.id.slice(0, 8)}...`);
        } else {
          throw new Error("No session in v2 response");
        }

        // Authenticate on v2
        if (this.credentials) {
          const loginResp = await fetch(`${v2Base}/spacemolt_auth/login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": USER_AGENT,
              "X-Session-Id": this.v2Session.id,
            },
            body: JSON.stringify({
              username: this.credentials.username,
              password: this.credentials.password,
            }),
          });

          const loginData = (await loginResp.json()) as ApiResponse & { structuredContent?: unknown };
          if (loginData.structuredContent !== undefined) {
            loginData.result = loginData.structuredContent;
          }
          if (loginData.error) {
            logError(`v2 login failed: ${loginData.error.message}`);
          } else {
            log("system", "v2 session authenticated");
          }
          // Capture updated session from login response
          if (loginData.session) {
            const ls = loginData.session as unknown as Record<string, unknown>;
            if (ls.created_at && !ls.createdAt) {
              ls.createdAt = ls.created_at;
              ls.expiresAt = ls.expires_at;
              ls.playerId = ls.player_id;
            }
            this.v2Session = loginData.session;
          }
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempt);
        log("system", `v2 server unreachable (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS}), retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
    throw lastError || new Error("Failed to connect to v2 server");
  }

  /**
   * Call any v2 API endpoint directly.
   * Usage: callV2("spacemolt_battle", "engage", { target_id: "..." })
   * → POST /api/v2/spacemolt_battle/engage
   *
   * Handles v2 session, throttling for action commands, and one retry on session expiry.
   */
  async callV2<T = unknown>(namespace: string, cmd: string, body?: Record<string, unknown>): Promise<V2Response<T>> {
    await this.ensureV2Session();

    const v2Base = this.baseUrl.replace("/api/v1", "/api/v2");
    const url = `${v2Base}/${namespace}/${cmd}`;

    // Throttle action commands (non-query)
    const isQuery = /^(get_|list_|view_|find_|search_|survey_|browse_|estimate_)/.test(cmd);
    if (!isQuery) await this._throttler.throttle();

    const doFetch = (): Promise<Response> =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": this.v2Session!.id,
          "User-Agent": USER_AGENT,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

    let resp = await doFetch();

    // Session expired — refresh once and retry
    if (resp.status === 401) {
      this.v2Session = null;
      await this.ensureV2Session();
      resp = await doFetch();
    }

    // Rate limited
    if (resp.status === 429) {
      const retry = parseInt(resp.headers.get("Retry-After") ?? "10", 10);
      await sleep(retry * 1000);
      resp = await doFetch();
    }

    try {
      const data = await resp.json() as V2Response<T>;
      logApiResponse(this.label, url, resp.status, 0, data as unknown as Record<string, unknown>);
      return data;
    } catch {
      return { error: { code: "http_error", message: `HTTP ${resp.status}: ${resp.statusText}` } } as V2Response<T>;
    }
  }

  async getPlayerProfile(playerId: string): Promise<unknown> {
    return null;
    /* await this.ensureSession();
    const baseUrl = this.baseUrl.replace(/\/api\/v\d+$/, "");
    const url = `${baseUrl}/api/player/${playerId}`;
    const resp = await fetch(url, {
      headers: {
        "X-Session-Id": this.session!.id,
        "User-Agent": USER_AGENT,
      },
    });
    return await resp.json(); */
  }

  private async doRequest(command: string, payload?: Record<string, unknown>): Promise<ApiResponse> {
    // Route commands with sub-actions through v2 endpoints where each action
    // is a separate path: /api/v2/spacemolt_{command}/{action}
    // This fixes facility commands where v1 doesn't pass parameters correctly.
    let url: string;
    let body = payload;

    if (V2_DIRECT_COMMANDS.has(command)) {
      // Route directly to v2 endpoint (no sub-action)
      // Strip v2_ prefix from command name — it's just a naming convention,
      // the actual endpoint is /api/v2/spacemolt_{base_command}
      const v2Base = this.baseUrl.replace("/api/v1", "/api/v2");
      const v2Command = command.replace(/^v2_/, "");
      url = `${v2Base}/spacemolt_${v2Command}`;
    } else if (payload?.action && typeof payload.action === "string" && V2_ROUTED_COMMANDS.has(command)) {
      const action = payload.action as string;
      const v2Base = this.baseUrl.replace("/api/v1", "/api/v2");
      url = `${v2Base}/spacemolt_${command}/${action}`;
      // Keep full payload in body — v2 endpoint needs all params for validation
      body = payload;
    } else {
      url = `${this.baseUrl}/${command}`;
    }

    // Use v2 session for v2 endpoints, v1 session for v1
    const isV2 = url.includes("/api/v2/");
    const activeSession = isV2 ? this.v2Session : this.session;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (activeSession) {
      headers["X-Session-Id"] = activeSession.id;
    }

    headers["User-Agent"] = USER_AGENT;

    // Pre-emptive throttle — only for action commands (30/min per session limit).
    // Queries (get_status, get_cargo, …) have a 300/min budget and are never throttled.
    if (ACTION_COMMANDS.has(command)) {
      await this._throttler.throttle();
    }

    // Log request to console and per-bot file
    const timestamp = new Date().toISOString();
    // console.log(`\n[${timestamp}] → HTTP POST ${url}`);
    // if (body) {
    //   console.log(`  Payload: ${JSON.stringify(body)}`);
    // }
    logApiRequest(this.label, url, activeSession?.id, body);

    // fetch() only throws on network errors (DNS, connection refused, etc.)
    // Any HTTP response — even 4xx/5xx — means the server is reachable.
    let resp!: Response;
    let duration = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      const startTime = Date.now();
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      duration = Date.now() - startTime;

      // Retry on 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
      if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
        const delay = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s
        console.warn(`[${timestamp}] ← HTTP ${resp.status} ${resp.statusText} (${duration}ms) — retrying in ${delay / 1000}s...`);
        if (attempt < 2) await sleep(delay);
        continue;
      }
      break;
    }

    // Log HTTP response
    // console.log(`[${timestamp}] ← HTTP ${resp.status} ${resp.statusText} (${duration}ms)`);

    // 401 = session gone (server restarted, etc.) — return as session error
    if (resp.status === 401) {
      const errResp = { error: { code: "session_invalid", message: "Unauthorized — session lost" } };
      logApiResponse(this.label, url, resp.status, duration, errResp);
      return errResp;
    }

    // 429 = HTTP-level rate limit — normalize to a guaranteed rate_limited error
    if (resp.status === 429) {
      const errResp: ApiResponse = { error: { code: "rate_limited", message: "Too Many Requests" } };
      try {
        const data = await resp.json() as Record<string, unknown>;
        const e = data.error as Record<string, unknown> | undefined;
        if (e?.message) errResp.error!.message = e.message as string;
        if (e?.retry_after) (errResp.error as Record<string, unknown>).retry_after = e.retry_after;
      } catch { /* ignore — use synthetic error */ }
      logApiResponse(this.label, url, resp.status, duration, errResp);
      return errResp;
    }

    // Try to parse JSON for any status code. If the server returned an HTTP
    // response (even an error), the connection is fine — don't throw.
    try {
      const data = (await resp.json()) as ApiResponse & { structuredContent?: unknown };
      // v2 returns structured data in structuredContent; prefer it over result
      // (v2 result is a human-readable text summary, structuredContent is the raw JSON)
      if (data.structuredContent !== undefined) {
        data.result = data.structuredContent;
      }
      // Normalize v2 session fields (snake_case → camelCase)
      if (data.session) {
        const s = data.session as unknown as Record<string, unknown>;
        if (s.created_at && !s.createdAt) {
          s.createdAt = s.created_at;
          s.expiresAt = s.expires_at;
          s.playerId = s.player_id;
        }
      }
      if (command !== "catalog") {
        logApiResponse(this.label, url, resp.status, duration, data);
      }
      return data as ApiResponse;
    } catch {
      // Non-JSON response (e.g. HTML error page, empty body)
      const errResp = { error: { code: "http_error", message: `HTTP ${resp.status}: ${resp.statusText}` } };
      logApiResponse(this.label, url, resp.status, duration, errResp);
      return errResp;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
