import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import type { BotStatus } from "../bot.js";
import { mapStore } from "../mapstore.js";
import { catalogStore } from "../catalogstore.js";
import { publicCatalog } from "../publicCatalog.js";
import type { ServerWebSocket } from "bun";

// ── Types ──────────────────────────────────────────────────

export interface WebAction {
  type: "start" | "stop" | "add" | "register" | "chat" | "saveSettings" | "exec" | "remove" | "refreshCatalog";
  bot?: string;
  routine?: string;
  username?: string;
  password?: string;
  empire?: string;
  message?: string;
  channel?: string;
  registration_code?: string;
  settings?: Record<string, unknown>;
  command?: string;
  params?: Record<string, unknown>;
}

export interface WebActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  password?: string;
  settings?: Record<string, Record<string, unknown>>;
  data?: unknown;
}

export interface RoutineSettings {
  [routine: string]: Record<string, unknown>;
}

type WSData = { id: number };

// ── Settings persistence ───────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const STATS_FILE = join(DATA_DIR, "stats.json");

function loadSettings(): RoutineSettings {
  if (existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as RoutineSettings;
    } catch (err) {
      console.warn(`Warning: corrupt settings.json, starting fresh —`, err);
    }
  }
  return {};
}

function saveSettings(s: RoutineSettings): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + "\n", "utf-8");
}

// ── Stats persistence ─────────────────────────────────────

interface DayStats {
  mined: number;
  crafted: number;
  trades: number;
  profit: number;
  systems: number;
}

interface StatsFile {
  daily: Record<string, Record<string, DayStats>>;   // bot -> date -> stats
  lastSeen: Record<string, DayStats>;                 // bot -> snapshot
}

function loadStats(): StatsFile {
  if (existsSync(STATS_FILE)) {
    try {
      return JSON.parse(readFileSync(STATS_FILE, "utf-8")) as StatsFile;
    } catch (err) {
      console.warn(`Warning: corrupt stats.json, starting fresh —`, err);
    }
  }
  return { daily: {}, lastSeen: {} };
}

function saveStats(s: StatsFile): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATS_FILE, JSON.stringify(s, null, 2) + "\n", "utf-8");
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function pruneOldDates(daily: Record<string, Record<string, DayStats>>, maxAgeDays = 30): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const bot of Object.keys(daily)) {
    for (const date of Object.keys(daily[bot])) {
      if (date < cutoffStr) delete daily[bot][date];
    }
    if (Object.keys(daily[bot]).length === 0) delete daily[bot];
  }
}

// ── WebServer ──────────────────────────────────────────────

const MAX_LOG_BUFFER = 200;

export class WebServer {
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Set<ServerWebSocket<WSData>>();
  private nextClientId = 1;

  // Log buffers for scrollback on reconnect
  private activityLog: string[] = [];
  private broadcastLog: string[] = [];
  private systemLog: string[] = [];
  private factionLog: string[] = [];

  // Per-bot activity log buffers (username -> lines)
  private botLogs = new Map<string, string[]>();

  // Latest bot statuses for initial page load
  private latestStatuses: BotStatus[] = [];

  // Persisted routine settings
  settings: RoutineSettings;

  // Persisted stats
  private statsData: StatsFile;

  // Action callback — set by botmanager
  onAction: ((action: WebAction) => Promise<WebActionResult>) | null = null;

  // Player profile proxy — set by botmanager
  onPlayerInfo: ((playerId: string) => Promise<unknown>) | null = null;

  // Economy data getter — set by botmanager
  onEconomyData: (() => unknown) | null = null;

  // Credit history getter — set by botmanager
  onCreditHistory: ((sinceMs: number) => unknown) | null = null;

  // Goals CRUD — set by botmanager
  onGetGoals: (() => unknown) | null = null;
  onSaveGoals: ((goals: unknown[]) => void) | null = null;

  // DataSync mode — set by botmanager when datasync is enabled
  dataSyncMode: 'master' | 'client' | 'disabled' = 'disabled';

  // When DataSync is in master mode, botmanager wires this to DataSyncServer.getAllPoolsStats()
  onAllPoolsStats: (() => Record<string, Record<string, any>>) | null = null;

  // Commander advisory data — set by botmanager
  onCommanderData: (() => unknown) | null = null;

  // PI Commander TODO read/write — set by botmanager
  onGetPiTodo: ((session: string) => string) | null = null;
  onSavePiTodo: ((session: string, content: string) => void) | null = null;

  // Admin force-refresh — set by botmanager
  onRefreshCatalog: (() => Promise<string>) | null = null;
  onRefreshMap: (() => Promise<string>) | null = null;

  // Available routines — set by botmanager
  routines: string[] = [];

  constructor(port: number = 3000) {
    this.port = port;
    this.settings = loadSettings();
    this.statsData = loadStats();
  }

  getSettings(routine: string): Record<string, unknown> {
    return this.settings[routine] || {};
  }

  saveRoutineSettings(routine: string, s: Record<string, unknown>): void {
    this.settings[routine] = { ...this.settings[routine], ...s };
    saveSettings(this.settings);
  }

  // ── Bot assignment persistence (auto-resume on restart) ───

  saveBotAssignment(username: string, routine: string): void {
    if (!this.settings.botAssignments) {
      this.settings.botAssignments = {};
    }
    (this.settings.botAssignments as Record<string, string>)[username] = routine;
    saveSettings(this.settings);
  }

  clearBotAssignment(username: string): void {
    const assignments = this.settings.botAssignments as Record<string, string> | undefined;
    if (assignments && username in assignments) {
      delete assignments[username];
      saveSettings(this.settings);
    }
  }

  getBotAssignments(): Record<string, string> {
    return (this.settings.botAssignments as Record<string, string>) || {};
  }

  removePerBotSettings(username: string): void {
    if (username in this.settings) {
      delete this.settings[username];
      saveSettings(this.settings);
    }
  }

  start(): void {
    const legacyPath = join(import.meta.dir, "legacy_ui.html");
    const distDir = join(process.cwd(), "dist", "web");
    const distIndex = join(distDir, "index.html");
    const hasBuiltApp = existsSync(distIndex);

    this.server = Bun.serve<WSData>({
      port: this.port,
      fetch: async (req, server) => {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (url.pathname === "/ws") {
          const id = this.nextClientId++;
          const ok = server.upgrade(req, { data: { id } });
          if (ok) return undefined as unknown as Response;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // REST API
        if (url.pathname === "/api/bots") {
          return Response.json(this.latestStatuses);
        }
        if (url.pathname === "/api/map") {
          return Response.json({ systems: mapStore.getAllSystems() });
        }
        if (url.pathname === "/api/routines") {
          return Response.json(this.routines);
        }
        if (url.pathname === "/api/settings") {
          return Response.json(this.settings);
        }
        if (url.pathname === "/api/stats") {
          return Response.json(this.statsData.daily);
        }
        if (url.pathname === "/api/stats/all-pools") {
          // DataSync master mode: return aggregated stats from all connected VMs
          if (this.onAllPoolsStats) {
            return Response.json(this.onAllPoolsStats());
          }
          // Standalone mode: scan local sibling directories on same machine
          const poolName = basename(process.cwd());
          const allPools: Record<string, Record<string, any>> = { [poolName]: this.statsData.daily };
          try {
            const parentDir = join(process.cwd(), "..");
            for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
              if (!entry.isDirectory() || entry.name === poolName) continue;
              const statsPath = join(parentDir, entry.name, "data", "stats.json");
              if (existsSync(statsPath)) {
                try {
                  const raw = JSON.parse(readFileSync(statsPath, "utf-8"));
                  allPools[entry.name] = raw.daily ?? raw;
                } catch { /* skip corrupt */ }
              }
            }
          } catch { /* skip on fs error */ }
          return Response.json(allPools);
        }
        if (url.pathname === "/api/catalog") {
          return Response.json(catalogStore.getAll());
        }
        if (url.pathname === "/api/public-catalog") {
          return Response.json(publicCatalog.getAll());
        }
        if (url.pathname === "/api/economy") {
          if (this.onEconomyData) return Response.json(this.onEconomyData());
          return Response.json({});
        }
        if (url.pathname === "/api/credit-history") {
          const since = parseInt(url.searchParams.get("since") || "86400000", 10);
          if (this.onCreditHistory) return Response.json(this.onCreditHistory(since));
          return Response.json([]);
        }
        if (url.pathname === "/api/commander") {
          if (this.onCommanderData) return Response.json(this.onCommanderData());
          return Response.json(null);
        }
        if (url.pathname === "/api/pi-todo") {
          const session = url.searchParams.get("session") || "default";
          if (req.method === "POST") {
            try {
              const { content } = await req.json() as { content: string };
              if (this.onSavePiTodo) this.onSavePiTodo(session, content || "");
              return Response.json({ ok: true });
            } catch (e) {
              return Response.json({ error: String(e) }, { status: 400 });
            }
          }
          const todo = this.onGetPiTodo ? this.onGetPiTodo(session) : "";
          return Response.json({ session, content: todo });
        }
        if (url.pathname === "/api/goals") {
          if (req.method === "POST") {
            try {
              const body = await req.json() as unknown[];
              if (this.onSaveGoals) this.onSaveGoals(body);
              return Response.json({ ok: true });
            } catch (e) {
              return Response.json({ error: String(e) }, { status: 400 });
            }
          }
          if (this.onGetGoals) return Response.json(this.onGetGoals());
          return Response.json([]);
        }

        // Player profile proxy
        if (url.pathname.startsWith("/api/player-info/")) {
          const playerId = url.pathname.slice("/api/player-info/".length);
          if (!playerId || !this.onPlayerInfo) return Response.json({ error: "not available" }, { status: 404 });
          try {
            const data = await this.onPlayerInfo(playerId);
            return Response.json(data);
          } catch (e) {
            return Response.json({ error: String(e) }, { status: 500 });
          }
        }

        // Per-bot persistent log files
        if (url.pathname.startsWith("/api/logs/")) {
          const botName = decodeURIComponent(url.pathname.slice("/api/logs/".length));
          const tail = parseInt(url.searchParams.get("tail") || "200");
          const logPath = join(process.cwd(), "data", "logs", `${botName}.log`);
          if (!existsSync(logPath)) {
            return Response.json({ lines: [] });
          }
          const content = readFileSync(logPath, "utf-8");
          const allLines = content.split("\n").filter(l => l);
          const lines = allLines.slice(-tail);
          return Response.json({ lines, total: allLines.length });
        }

        // Webhook test endpoint
        if (url.pathname === "/api/admin/test-webhook" && req.method === "POST") {
          try {
            const { url: wUrl, type } = await req.json() as { url: string; type: string };
            await this.sendWebhook(wUrl, type, "\uD83E\uDDEA Hex-Bots test alert — webhook is working!");
            return Response.json({ ok: true });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) }, { status: 500 });
          }
        }

        // Admin force-refresh endpoints
        if (url.pathname === "/api/admin/refresh-catalog" && req.method === "POST") {
          if (!this.onRefreshCatalog) return Response.json({ error: "Not available" }, { status: 503 });
          try {
            const msg = await this.onRefreshCatalog();
            return Response.json({ ok: true, message: msg });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) }, { status: 500 });
          }
        }
        if (url.pathname === "/api/admin/refresh-map" && req.method === "POST") {
          if (!this.onRefreshMap) return Response.json({ error: "Not available" }, { status: 503 });
          try {
            const msg = await this.onRefreshMap();
            return Response.json({ ok: true, message: msg });
          } catch (e) {
            return Response.json({ ok: false, error: String(e) }, { status: 500 });
          }
        }

        // POST actions (fallback for non-WS clients)
        if (url.pathname === "/api/action" && req.method === "POST") {
          const action = (await req.json()) as WebAction;
          if (this.onAction) {
            const result = await this.onAction(action);
            return Response.json(result);
          }
          return Response.json({ ok: false, error: "No action handler" });
        }

        // Legacy UI (always available)
        if (url.pathname === "/legacy") {
          return new Response(readFileSync(legacyPath, "utf-8"), {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          });
        }

        // Production: serve built Vue SPA from dist/web/
        if (hasBuiltApp) {
          if (url.pathname !== "/") {
            const asset = Bun.file(join(distDir, url.pathname));
            if (await asset.exists()) return new Response(asset);
          }
          return new Response(Bun.file(distIndex));
        }

        // Dev mode: new UI runs on Vite at http://localhost:5173
        // Fall back to legacy UI so port 3000 stays usable
        return new Response(readFileSync(legacyPath, "utf-8"), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      },

      websocket: {
        open: (ws: ServerWebSocket<WSData>) => {
          this.clients.add(ws);

          // Build known systems list for settings dropdowns
          const knownSystems = this.getKnownSystemsList();
          const knownOres = mapStore.getAllKnownOres();

          // Send scrollback and current state
          // Serialize per-bot logs as { username: lines[] }
          const botLogsObj: Record<string, string[]> = {};
          for (const [name, lines] of this.botLogs) {
            botLogsObj[name] = lines;
          }

          ws.send(JSON.stringify({
            type: "init",
            bots: this.latestStatuses,
            routines: this.routines,
            settings: this.settings,
            knownSystems,
            knownOres,
            catalog: catalogStore.getAll(),
            publicCatalog: publicCatalog.getAll(),
            mapData: mapStore.getAllSystems(),
            statsDaily: this.statsData.daily,
            dataSyncMode: this.dataSyncMode,
            logs: {
              activity: this.activityLog,
              broadcast: this.broadcastLog,
              system: this.systemLog,
              faction: this.factionLog,
            },
            botLogs: botLogsObj,
          }));
        },

        message: async (ws: ServerWebSocket<WSData>, msg: string | Buffer) => {
          let seq: unknown;
          let isExec = false;
          try {
            const raw = JSON.parse(typeof msg === "string" ? msg : msg.toString());
            seq = raw._seq;
            isExec = raw.type === "exec";
            const data = raw as WebAction;
            if (this.onAction) {
              const result = await this.onAction(data);
              const resType = isExec ? "execResult" : "actionResult";
              ws.send(JSON.stringify({ type: resType, _seq: seq, ...result }));
            }
          } catch (err) {
            ws.send(JSON.stringify({
              type: isExec ? "execResult" : "actionResult",
              _seq: seq,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }));
          }
        },

        close: (ws: ServerWebSocket<WSData>) => {
          this.clients.delete(ws);
        },
      },
    });

    console.log(`Dashboard: http://localhost:${this.port}`);
  }

  stop(): void {
    this.server?.stop();
  }

  // ── Interface matching TUI ─────────────────────────────────

  updateBotStatus(bots: BotStatus[]): void {
    this.latestStatuses = bots;
    this.broadcast({ type: "status", bots });
  }

  logActivity(line: string): void {
    this.pushLog(this.activityLog, line);
    this.broadcast({ type: "log", panel: "activity", line });
  }

  logBroadcast(line: string): void {
    this.pushLog(this.broadcastLog, line);
    this.broadcast({ type: "log", panel: "broadcast", line });
  }

  logSystem(line: string): void {
    this.pushLog(this.systemLog, line);
    this.broadcast({ type: "log", panel: "system", line });
  }

  logFaction(line: string): void {
    this.pushLog(this.factionLog, line);
    this.broadcast({ type: "factionLog", line });
  }

  logBot(username: string, line: string): void {
    if (!this.botLogs.has(username)) {
      this.botLogs.set(username, []);
    }
    const buf = this.botLogs.get(username)!;
    this.pushLog(buf, line);

    // Parse line format: "HH:MM:SS [category] message"
    // Extract category and message for Vue client
    const categoryMatch = line.match(/\[([^\]]+)\]\s*(.+)/);
    const category = categoryMatch ? categoryMatch[1] : 'info';
    const message = categoryMatch ? categoryMatch[2] : line;
    this.broadcast({ type: "botLog", username, line });
    this.broadcast({ 
      type: "log", 
      bot: username, 
      level: category === 'error' ? 'error' : category === 'combat' ? 'warn' : 'info',
      message: message
    });
  }

  updateMapData(): void {
    this.broadcast({
      type: "mapUpdate",
      mapData: mapStore.getAllSystems(),
      knownOres: mapStore.getAllKnownOres(),
    });
  }

  async sendWebhook(webhookUrl: string, type: string, text: string): Promise<void> {
    if (!webhookUrl) return;
    let body: string;
    if (type === "telegram") {
      body = JSON.stringify({ text });
    } else if (type === "discord") {
      body = JSON.stringify({ content: text });
    } else {
      body = JSON.stringify({ text });
    }
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      console.error("[Webhook] Failed to send alert:", err);
    }
  }

  fireAlert(trigger: string, message: string): void {
    const alerts = this.settings?.alerts as Record<string, unknown> | undefined;
    if (!alerts?.webhookUrl) return;
    const triggers = (alerts.triggers || {}) as Record<string, boolean>;
    if (!triggers[trigger]) return;
    this.sendWebhook(
      alerts.webhookUrl as string,
      (alerts.webhookType as string) || "discord",
      message,
    ).catch(() => {});
  }

  broadcastRateLimit(blocked: boolean, retryAfterSecs?: number): void {
    this.broadcast({ type: "rateLimitBlock", blocked, retryAfterSecs });
  }

  broadcastDataSyncStatus(offline: boolean): void {
    this.broadcast({ type: "dataSyncStatus", offline });
  }

  // ── Stats flushing ──────────────────────────────────────────

  flushBotStats(bots: BotStatus[]): void {
    const today = todayStr();
    let changed = false;

    for (const bot of bots) {
      if (!bot.stats) continue;
      const name = bot.username;

      const current: DayStats = {
        mined: bot.stats.totalMined,
        crafted: bot.stats.totalCrafted,
        trades: bot.stats.totalTrades,
        profit: bot.stats.totalProfit,
        systems: bot.stats.totalSystems,
      };

      // Get last seen snapshot (default zeros)
      const last = this.statsData.lastSeen[name] || { mined: 0, crafted: 0, trades: 0, profit: 0, systems: 0 };

      // If bot restarted (stats went back to zero/lower), reset lastSeen
      const botRestarted =
        current.mined < last.mined ||
        current.crafted < last.crafted ||
        current.trades < last.trades ||
        current.profit < last.profit ||
        current.systems < last.systems;

      const base = botRestarted ? { mined: 0, crafted: 0, trades: 0, profit: 0, systems: 0 } : last;

      // Compute deltas
      const dm = current.mined - base.mined;
      const dc = current.crafted - base.crafted;
      const dt = current.trades - base.trades;
      const dp = current.profit - base.profit;
      const ds = current.systems - base.systems;

      // Always update lastSeen so restart detection works next cycle
      this.statsData.lastSeen[name] = { ...current };

      if (dm === 0 && dc === 0 && dt === 0 && dp === 0 && ds === 0) continue;

      // Accumulate into daily
      if (!this.statsData.daily[name]) this.statsData.daily[name] = {};
      const day = this.statsData.daily[name][today] || { mined: 0, crafted: 0, trades: 0, profit: 0, systems: 0 };
      day.mined += dm;
      day.crafted += dc;
      day.trades += dt;
      day.profit += dp;
      day.systems += ds;
      this.statsData.daily[name][today] = day;
      changed = true;
    }

    if (changed) {
      pruneOldDates(this.statsData.daily);
      saveStats(this.statsData);
      this.broadcast({ type: "statsUpdate", statsDaily: this.statsData.daily });
    }
  }

  getStatsData(): Record<string, Record<string, DayStats>> {
    return this.statsData.daily;
  }

  // ── Internal helpers ───────────────────────────────────────

  private getKnownSystemsList(): Array<{ id: string; name: string }> {
    const ids = mapStore.getKnownSystems();
    return ids.map(id => {
      const sys = mapStore.getSystem(id);
      return { id, name: sys?.name || id };
    });
  }

  private pushLog(buffer: string[], line: string): void {
    buffer.push(line);
    if (buffer.length > MAX_LOG_BUFFER) {
      buffer.shift();
    }
  }

  private broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const ws of this.clients) {
      try {
        ws.send(msg);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}
