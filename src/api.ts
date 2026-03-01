import { log, logError } from "./ui.js";
import { logApiRequest, logApiResponse, logApiSession } from "./apilogger.js";

export interface ApiSession {
  id: string;
  playerId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApiResponse {
  result?: unknown;
  notifications?: unknown[];
  session?: ApiSession;
  error?: { code: string; message: string; wait_seconds?: number } | null;
}

const DEFAULT_BASE_URL = "https://game.spacemolt.com/api/v1";

// Commands with sub-actions that route through v2 endpoints instead of v1.
// v1: POST /api/v1/{command} { action: "sub", ...params }
// v2: POST /api/v2/spacemolt_{command}/{action} { ...params }
const V2_ROUTED_COMMANDS = new Set(["facility"]);

// Commands that always route directly to v2 (no sub-action needed).
// v2: POST /api/v2/spacemolt_{command} { ...params }
const V2_DIRECT_COMMANDS = new Set([
  "v2_get_cargo", "v2_get_player",
  "v2_get_queue", "v2_get_skills", "v2_get_missions",
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
  /** Mutex: prevents concurrent ensureSession() calls from each creating a session. */
  private _sessionLock: Promise<void> | null = null;
  private _v2SessionLock: Promise<void> | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.SPACEMOLT_URL || DEFAULT_BASE_URL;
  }

  setCredentials(username: string, password: string): void {
    this.credentials = { username, password };
  }

  getSession(): ApiSession | null {
    return this.session;
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

  async execute(command: string, payload?: Record<string, unknown>): Promise<ApiResponse> {
    const needsV2 = this.isV2Command(command, payload);
    try {
      await this.ensureSession();
      if (needsV2) await this.ensureV2Session();
    } catch {
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
      } catch {
        return { error: { code: "connection_failed", message: "Could not reconnect to server" } };
      }
    }

    // Handle session/auth errors by refreshing and retrying
    if (resp.error) {
      const code = resp.error.code;

      if (code === "rate_limited" || code === "rate_limit") {
        const secs = resp.error.wait_seconds || 10;
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
        return this.doRequest(command, payload);
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
            logError(`Login failed: ${loginResp.error.message}`);
            logApiSession(this.label, "LOGIN_FAILED", loginResp.error.message);
          } else {
            log("system", "Logged in successfully");
          }
          // Login may return a new session — capture it
          if (loginResp.session) {
            this.session = loginResp.session;
            logApiSession(this.label, "SESSION_UPDATED", `new id=${this.session.id.slice(0, 8)}...`);
          } else {
            logApiSession(this.label, "SESSION_KEPT", `kept id=${this.session.id.slice(0, 8)}... (login did not return new session)`);
          }
        }
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
    return expiresAt - now < 60_000; // Less than 60s remaining
  }

  private isV2SessionExpiring(): boolean {
    if (!this.v2Session) return true;
    const expiresAt = new Date(this.v2Session.expiresAt).getTime();
    const now = Date.now();
    return expiresAt - now < 60_000;
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

    // Log request to console and per-bot file
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] → HTTP POST ${url}`);
    if (body) {
      console.log(`  Payload: ${JSON.stringify(body)}`);
    }
    logApiRequest(this.label, url, activeSession?.id, body);

    // fetch() only throws on network errors (DNS, connection refused, etc.)
    // Any HTTP response — even 4xx/5xx — means the server is reachable.
    const startTime = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const duration = Date.now() - startTime;
    // Log HTTP response
    console.log(`[${timestamp}] ← HTTP ${resp.status} ${resp.statusText} (${duration}ms)`);

    // 401 = session gone (server restarted, etc.) — return as session error
    if (resp.status === 401) {
      const errResp = { error: { code: "session_invalid", message: "Unauthorized — session lost" } };
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
