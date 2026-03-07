import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import type { BotStatus } from "../bot.js";
import type { Database } from "bun:sqlite";
import { mapStore } from "../mapstore.js";
import { catalogStore } from "../catalogstore.js";
import { publicCatalog } from "../publicCatalog.js";
import type { ServerWebSocket } from "bun";
import type { ProxyHub, HubSession } from "../proxyhub.js";
import { getMarketPricesStore } from "../data/market-prices-store.js";

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

type WSData = { id: number; isHubClient?: true; vmName?: string };

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
  // Extended stats (v7)
  earned: number;
  spent: number;
  donated: number;
  ore_units: number;
  kills: number;
  deaths: number;
  loot_value: number;
  craft_units: number;
  jumps: number;
  missions: number;
  mission_rewards: number;
  markets_scanned: number;
}

const ZERO_DAY: DayStats = {
  mined: 0, crafted: 0, trades: 0, profit: 0, systems: 0,
  earned: 0, spent: 0, donated: 0, ore_units: 0,
  kills: 0, deaths: 0, loot_value: 0, craft_units: 0,
  jumps: 0, missions: 0, mission_rewards: 0, markets_scanned: 0,
};

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

/** One-time import of stats.json into bot_stats SQLite table. */
function importStatsToDb(db: Database, stats: StatsFile): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO bot_stats
      (username, date, mined, crafted, trades, profit, systems,
       earned, spent, donated, ore_units, kills, deaths, loot_value,
       craft_units, jumps, missions, mission_rewards, markets_scanned)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const tx = db.transaction(() => {
    for (const [username, days] of Object.entries(stats.daily)) {
      for (const [date, d] of Object.entries(days)) {
        stmt.run(
          username, date,
          d.mined, d.crafted, d.trades, d.profit, d.systems,
          d.earned ?? 0, d.spent ?? 0, d.donated ?? 0, d.ore_units ?? 0,
          d.kills ?? 0, d.deaths ?? 0, d.loot_value ?? 0, d.craft_units ?? 0,
          d.jumps ?? 0, d.missions ?? 0, d.mission_rewards ?? 0, d.markets_scanned ?? 0
        );
      }
    }
  });
  tx();
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

  // ── Hub (centralized UI proxy) ─────────────────────────────
  proxyHub: ProxyHub | null = null;
  /** api_key the master must supply when connecting (set on client VMs). */
  hubApiKey: string = "";
  /** When false, the Vue SPA is not served (use on client VMs in hub mode). */
  serveUi: boolean = true;
  /** Aggregated bot statuses from remote VMs (tagged with vm field). */
  remoteBots: unknown[] = [];
  /** Per-bot log lines from remote VMs (username → lines). */
  remoteBotLogs = new Map<string, string[]>();
  /** Activity log lines forwarded from remote VMs. */
  remoteActivityLog: string[] = [];

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

  // Real-time material demands from swarmcoord — set by botmanager
  onMaterialDemands: (() => Array<{ bot: string; itemId: string; quantity: number; stationPoiId?: string; stationSystem?: string }>) | null = null;

  // Credit history getter — set by botmanager
  onCreditHistory: ((sinceMs: number) => unknown) | null = null;

  // Goals CRUD — set by botmanager
  onGetGoals: (() => unknown) | null = null;
  onSaveGoals: ((goals: unknown[]) => void) | null = null;

  // DataSync mode — set by botmanager when datasync is enabled
  dataSyncMode: 'master' | 'client' | 'disabled' = 'disabled';

  // When DataSync is in master mode, botmanager wires this to DataSyncServer.getAllPoolsStats()
  onAllPoolsStats: (() => Record<string, Record<string, any>>) | null = null;

  // Current pool name — set by botmanager, used in /api/stats/all-pools response
  currentPoolName: string | null = null;

  // When DataSync is in client mode, botmanager wires this to DataSyncClient.syncCode()
  onSyncCode: (() => Promise<{ updated: string[]; failed: string[] }>) | null = null;

  // Commander advisory data — set by botmanager
  onCommanderData: (() => unknown) | null = null;

  // s2: Game server stats cache (proxied from game API)
  private gameStatsCache: { data: Record<string, unknown>; expiry: number } | null = null;
  private _gameStatsTimer: ReturnType<typeof setInterval> | null = null;

  // PI Commander TODO read/write — set by botmanager
  onGetPiTodo: ((session: string) => string) | null = null;
  onSavePiTodo: ((session: string, content: string) => void) | null = null;

  // Admin force-refresh — set by botmanager
  onRefreshCatalog: (() => Promise<string>) | null = null;
  onRefreshMap: (() => Promise<string>) | null = null;

  /** Set by botmanager on client VMs: forwards every broadcast message to master hub. */
  hubClientPush: ((msg: Record<string, unknown>) => void) | null = null;
  /** Returns the current init payload for hub registration (used by HubClientConnector on connect). */
  getHubInitPayload(): Record<string, unknown> {
    const botLogsObj: Record<string, string[]> = {};
    for (const [name, lines] of this.botLogs) {
      botLogsObj[name] = [...lines];
    }
    return {
      type: "init",
      bots: this.latestStatuses,
      botLogs: botLogsObj,
      settings: this.settings,
      logs: {
        activity: this.activityLog,
        system: this.systemLog,
      },
    };
  }

  // Available routines — set by botmanager
  routines: Array<{ id: string; name: string }> = [];

  /** SQLite database — injected by botmanager after construction. */
  private db: Database | null = null;

  constructor(port: number = 3000) {
    this.port = port;
    this.settings = loadSettings();
    this.statsData = loadStats();
  }

  /** Wire up the database and import any existing stats.json data. */
  setDatabase(db: Database): void {
    this.db = db;
    importStatsToDb(db, this.statsData);
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

        // WebSocket upgrade — UI clients
        if (url.pathname === "/ws") {
          if (this.hubApiKey) {
            const key = url.searchParams.get("hub_key") ?? "";
            if (key !== this.hubApiKey) {
              return new Response("Unauthorized", { status: 401 });
            }
          }
          const id = this.nextClientId++;
          const ok = server.upgrade(req, { data: { id } });
          if (ok) return undefined as unknown as Response;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // WebSocket upgrade — hub client VMs connecting IN to master
        if (url.pathname === "/hub") {
          if (!this.proxyHub) return new Response("Not a hub master", { status: 404 });
          const vmName = url.searchParams.get("vm_name") ?? "";
          const hubKey = url.searchParams.get("hub_key") ?? "";
          if (!vmName) return new Response("Missing vm_name", { status: 400 });
          if (!this.proxyHub.isAllowed(vmName, hubKey)) {
            console.warn(`[Hub] Rejected connection from VM "${vmName}" — invalid hub_key`);
            return new Response("Unauthorized", { status: 401 });
          }
          const id = this.nextClientId++;
          const ok = server.upgrade(req, { data: { id, isHubClient: true, vmName } });
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
          let pools: Record<string, Record<string, any>>;
          let currentPool: string;
          if (this.onAllPoolsStats) {
            // DataSync master/client mode: aggregated stats from all connected VMs
            pools = this.onAllPoolsStats();
            currentPool = this.currentPoolName ?? Object.keys(pools)[0] ?? '';
          } else {
            // Standalone mode: scan local sibling directories on same machine
            currentPool = this.currentPoolName ?? basename(process.cwd());
            pools = { [currentPool]: this.statsData.daily };
            try {
              const parentDir = join(process.cwd(), "..");
              for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.name === currentPool) continue;
                const statsPath = join(parentDir, entry.name, "data", "stats.json");
                if (existsSync(statsPath)) {
                  try {
                    const raw = JSON.parse(readFileSync(statsPath, "utf-8"));
                    pools[entry.name] = raw.daily ?? raw;
                  } catch { /* skip corrupt */ }
                }
              }
            } catch { /* skip on fs error */ }
          }
          return Response.json({ pools, currentPool });
        }
        // ── Bot stats from SQLite (full history, all metrics) ──
        if (url.pathname === "/api/bot-stats") {
          if (!this.db) return Response.json({ error: "DB not initialized" }, { status: 503 });
          const bot = url.searchParams.get("bot");
          const days = Math.min(365, Number(url.searchParams.get("days") || "30"));
          const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
          const rows = bot
            ? this.db.query("SELECT * FROM bot_stats WHERE username=? AND date>=? ORDER BY date DESC").all(bot, cutoff)
            : this.db.query("SELECT * FROM bot_stats WHERE date>=? ORDER BY username, date DESC").all(cutoff);
          return Response.json(rows);
        }

        // ── Structured market prices ──
        if (url.pathname === "/api/market-prices") {
          const mps = getMarketPricesStore();
          if (!mps) return Response.json({ error: "Market prices store not ready" }, { status: 503 });
          const itemId    = url.searchParams.get("item");
          const stationId = url.searchParams.get("station");
          const action    = url.searchParams.get("action") || "summary";
          if (action === "routes") {
            const minMargin = Number(url.searchParams.get("min_margin") || "100");
            const systemId  = url.searchParams.get("system");
            const routes = systemId
              ? mps.getBestRoutesFromSystem(systemId, minMargin, 20)
              : mps.getBestTradeRoutes(minMargin, 20);
            return Response.json(routes);
          }
          if (action === "sources" && itemId) {
            return Response.json(mps.getCheapestSources(itemId, 20));
          }
          if (action === "buyers" && itemId) {
            return Response.json(mps.getBestBuyers(itemId, 20));
          }
          if (action === "station" && stationId) {
            return Response.json(mps.getStationInventory(stationId));
          }
          if (action === "history" && stationId && itemId) {
            return Response.json(mps.getPriceHistory(stationId, itemId));
          }
          return Response.json(mps.getSummary());
        }

        if (url.pathname === "/api/debug/stats") {
          // Diagnostic endpoint — returns the full stats pipeline state.
          // Open in browser: http://localhost:3210/api/debug/stats
          const myDaily = this.statsData.daily;
          const allPools = this.onAllPoolsStats ? this.onAllPoolsStats() : null;
          return Response.json({
            dataSyncMode: this.dataSyncMode,
            onAllPoolsStats_wired: this.onAllPoolsStats !== null,
            myStats: {
              bots: Object.keys(myDaily),
              sample: myDaily,
            },
            allPoolsStats: allPools,
            note: allPools === null
              ? "onAllPoolsStats not wired — DataSync disabled or not yet started"
              : `${Object.keys(allPools).length} pool(s) in result`,
          });
        }
        if (url.pathname === "/api/sync-code" && req.method === "POST") {
          if (!this.onSyncCode) {
            return Response.json({ error: "Code sync not available (master mode or datasync disabled)" }, { status: 503 });
          }
          try {
            const result = await this.onSyncCode();
            return Response.json({ ok: true, ...result });
          } catch (e) {
            return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
          }
        }
        if (url.pathname === "/api/catalog") {
          return Response.json(catalogStore.getAll());
        }
        if (url.pathname === "/api/public-catalog") {
          return Response.json(publicCatalog.getAll());
        }
        if (url.pathname === "/api/economy") {
          const eco = this.onEconomyData ? this.onEconomyData() as Record<string, unknown> : {};
          const materialNeeds = this.onMaterialDemands ? this.onMaterialDemands() : [];
          return Response.json({ ...eco, materialNeeds });
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
        if (url.pathname === "/api/game-stats") {
          await this.fetchAndBroadcastGameStats();
          return Response.json(this.gameStatsCache?.data ?? {});
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

        if (url.pathname === "/api/faction-storage") {
          return Response.json(mapStore.getAllFactionStorageItems());
        }
        if (url.pathname === "/api/faction-buildings") {
          return Response.json(mapStore.getAllFactionBuildings());
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

        // Production / dev UI — skipped when hub.mode = "client"
        if (this.serveUi) {
          if (hasBuiltApp) {
            if (url.pathname !== "/") {
              const asset = Bun.file(join(distDir, url.pathname));
              if (await asset.exists()) return new Response(asset);
            }
            return new Response(Bun.file(distIndex));
          }
          // Dev mode: fall back to legacy UI so the port stays usable
          return new Response(readFileSync(legacyPath, "utf-8"), {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          });
        }

        // Hub client mode: UI is served on the master VM only
        return new Response("Hex-Bots (hub client — UI on master)", { status: 200 });
      },

      websocket: {
        open: (ws: ServerWebSocket<WSData>) => {
          // Hub client VM connecting IN — register session with ProxyHub
          if (ws.data.isHubClient) {
            const vmName = ws.data.vmName!;
            const session: HubSession = {
              name: vmName,
              send: (msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* ignore closed */ } },
              disconnect: () => { try { ws.close(); } catch { /* ignore */ } },
            };
            this.proxyHub?.registerSession(session);
            return;
          }

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

          // Merge remote VM bot logs into the snapshot sent on connect
          for (const [name, lines] of this.remoteBotLogs) {
            if (!botLogsObj[name]) botLogsObj[name] = [];
            botLogsObj[name] = [...(botLogsObj[name] ?? []), ...lines].slice(-200);
          }

          ws.send(JSON.stringify({
            type: "init",
            bots: [...this.latestStatuses, ...this.remoteBots],
            vmStates: this.proxyHub?.getVmStates() ?? {},
            vmSettingsSnapshot: this.proxyHub?.getAllVmSettings() ?? {},
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
          // Hub client VM message — route through ProxyHub
          if (ws.data.isHubClient) {
            try {
              const raw = JSON.parse(typeof msg === "string" ? msg : msg.toString()) as Record<string, unknown>;
              raw.vm = ws.data.vmName;
              this.proxyHub?.handleMessage(raw);
            } catch { /* ignore malformed */ }
            return;
          }

          let seq: unknown;
          let isExec = false;
          try {
            const raw = JSON.parse(typeof msg === "string" ? msg : msg.toString());
            seq = raw._seq;
            isExec = raw.type === "exec";
            const data = raw as WebAction;
            // Route commands with `vm` field to the appropriate remote VM
            const vmTarget = (raw as Record<string, unknown>).vm as string | undefined;
            if (vmTarget && this.proxyHub) {
              this.proxyHub.sendToVM(vmTarget, raw as Record<string, unknown>);
              return; // Response arrives asynchronously via broadcastToClients
            }
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
          if (ws.data.isHubClient) {
            this.proxyHub?.unregisterSession(ws.data.vmName!);
            return;
          }
          this.clients.delete(ws);
        },
      },
    });

    console.log(`Dashboard: http://localhost:${this.port}`);
    // Periodic game stats fetch + WS push every 10s — master/standalone only (client VMs have no UI)
    if (this.serveUi) {
      this.fetchAndBroadcastGameStats();
      this._gameStatsTimer = setInterval(() => this.fetchAndBroadcastGameStats(), 10_000);
    }
  }

  stop(): void {
    if (this._gameStatsTimer) clearInterval(this._gameStatsTimer);
    this.server?.stop();
  }

  /** Fetch game stats from upstream if cache is stale; broadcast fresh data to all WS clients. */
  async fetchAndBroadcastGameStats(): Promise<void> {
    const now = Date.now();
    if (this.gameStatsCache && this.gameStatsCache.expiry > now) return;
    try {
      const resp = await fetch("https://game.spacemolt.com/api/stats", { signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        this.gameStatsCache = { data, expiry: now + 10_000 };
        this.broadcast({ type: "gameStats", data });
      }
    } catch { /* keep stale cache */ }
  }

  // ── Interface matching TUI ─────────────────────────────────

  updateBotStatus(bots: BotStatus[]): void {
    this.latestStatuses = bots;
    this.broadcast({ type: "status", bots: [...bots, ...this.remoteBots] });
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

  /** Forward any message from ProxyHub to all connected UI clients. */
  broadcastToClients(data: unknown): void {
    this.broadcast(data);
  }

  /** Notify the UI about a remote VM's connection state. */
  broadcastVmStatus(vm: string, state: string): void {
    this.broadcast({ type: "vmStatus", vm, state });
  }

  /** Called by ProxyHub when the list of remote bots changes. Broadcasts merged status. */
  mergeRemoteBots(remoteBots: unknown[]): void {
    this.remoteBots = remoteBots;
    this.broadcast({ type: "status", bots: [...this.latestStatuses, ...remoteBots] });
  }

  // ── Stats flushing ──────────────────────────────────────────

  flushBotStats(bots: BotStatus[]): void {
    const today = todayStr();
    let changed = false;

    for (const bot of bots) {
      if (!bot.stats) continue;
      const name = bot.username;

      const current: DayStats = {
        mined:   bot.stats.totalMined,
        crafted: bot.stats.totalCrafted,
        trades:  bot.stats.totalTrades,
        profit:  bot.stats.totalProfit,
        systems: bot.stats.totalSystems,
        earned:          bot.stats.totalEarned         ?? 0,
        spent:           bot.stats.totalSpent          ?? 0,
        donated:         bot.stats.totalDonated        ?? 0,
        ore_units:       bot.stats.totalOreUnits       ?? 0,
        kills:           bot.stats.totalKills          ?? 0,
        deaths:          bot.stats.totalDeaths         ?? 0,
        loot_value:      bot.stats.totalLootValue      ?? 0,
        craft_units:     bot.stats.totalCraftUnits     ?? 0,
        jumps:           bot.stats.totalJumps          ?? 0,
        missions:        bot.stats.totalMissions       ?? 0,
        mission_rewards: bot.stats.totalMissionRewards ?? 0,
        markets_scanned: bot.stats.totalMarketsScanned ?? 0,
      };

      // Get last seen snapshot (default zeros)
      const last = this.statsData.lastSeen[name] || { ...ZERO_DAY };

      // If bot restarted (stats went back to zero/lower), reset lastSeen
      const botRestarted =
        current.mined < last.mined ||
        current.crafted < last.crafted ||
        current.trades < last.trades ||
        current.profit < last.profit ||
        current.systems < last.systems;

      const base: DayStats = botRestarted ? { ...ZERO_DAY } : last;

      // Compute deltas
      const dm = current.mined - base.mined;
      const dc = current.crafted - base.crafted;
      const dt = current.trades - base.trades;
      const dp = current.profit - base.profit;
      const ds = current.systems - base.systems;

      // Always update lastSeen so restart detection works next cycle
      this.statsData.lastSeen[name] = { ...current };

      const dEarned   = Math.max(0, (current.earned         ?? 0) - ((base as any).earned         ?? 0));
      const dSpent    = Math.max(0, (current.spent          ?? 0) - ((base as any).spent          ?? 0));
      const dDonated  = Math.max(0, (current.donated        ?? 0) - ((base as any).donated        ?? 0));
      const dOreUnits = Math.max(0, (current.ore_units      ?? 0) - ((base as any).ore_units      ?? 0));
      const dKills    = Math.max(0, (current.kills          ?? 0) - ((base as any).kills          ?? 0));
      const dDeaths   = Math.max(0, (current.deaths         ?? 0) - ((base as any).deaths         ?? 0));
      const dLoot     = Math.max(0, (current.loot_value     ?? 0) - ((base as any).loot_value     ?? 0));
      const dCraftU   = Math.max(0, (current.craft_units    ?? 0) - ((base as any).craft_units    ?? 0));
      const dJumps    = Math.max(0, (current.jumps          ?? 0) - ((base as any).jumps          ?? 0));
      const dMissions = Math.max(0, (current.missions       ?? 0) - ((base as any).missions       ?? 0));
      const dMRew     = Math.max(0, (current.mission_rewards?? 0) - ((base as any).mission_rewards?? 0));
      const dMarkets  = Math.max(0, (current.markets_scanned?? 0) - ((base as any).markets_scanned?? 0));

      if (dm === 0 && dc === 0 && dt === 0 && dp === 0 && ds === 0 &&
          dEarned === 0 && dSpent === 0 && dDonated === 0 && dOreUnits === 0 &&
          dKills === 0 && dDeaths === 0 && dLoot === 0 && dCraftU === 0 &&
          dJumps === 0 && dMissions === 0 && dMRew === 0 && dMarkets === 0) continue;

      // Accumulate into daily
      if (!this.statsData.daily[name]) this.statsData.daily[name] = {};
      const day: DayStats = this.statsData.daily[name][today] || { ...ZERO_DAY };
      day.mined   += dm;
      day.crafted += dc;
      day.trades  += dt;
      day.profit  += dp;
      day.systems += ds;
      day.earned        = (day.earned        ?? 0) + dEarned;
      day.spent         = (day.spent         ?? 0) + dSpent;
      day.donated       = (day.donated       ?? 0) + dDonated;
      day.ore_units     = (day.ore_units     ?? 0) + dOreUnits;
      day.kills         = (day.kills         ?? 0) + dKills;
      day.deaths        = (day.deaths        ?? 0) + dDeaths;
      day.loot_value    = (day.loot_value    ?? 0) + dLoot;
      day.craft_units   = (day.craft_units   ?? 0) + dCraftU;
      day.jumps         = (day.jumps         ?? 0) + dJumps;
      day.missions      = (day.missions      ?? 0) + dMissions;
      day.mission_rewards = (day.mission_rewards ?? 0) + dMRew;
      day.markets_scanned = (day.markets_scanned ?? 0) + dMarkets;
      this.statsData.daily[name][today] = day;

      // Persist to SQLite
      if (this.db) {
        this.db.run(
          `INSERT INTO bot_stats
            (username, date, mined, crafted, trades, profit, systems,
             earned, spent, donated, ore_units, kills, deaths, loot_value,
             craft_units, jumps, missions, mission_rewards, markets_scanned)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(username, date) DO UPDATE SET
            mined=mined+excluded.mined, crafted=crafted+excluded.crafted,
            trades=trades+excluded.trades, profit=profit+excluded.profit,
            systems=MAX(systems,excluded.systems),
            earned=earned+excluded.earned, spent=spent+excluded.spent,
            donated=donated+excluded.donated, ore_units=ore_units+excluded.ore_units,
            kills=kills+excluded.kills, deaths=deaths+excluded.deaths,
            loot_value=loot_value+excluded.loot_value, craft_units=craft_units+excluded.craft_units,
            jumps=jumps+excluded.jumps, missions=missions+excluded.missions,
            mission_rewards=mission_rewards+excluded.mission_rewards,
            markets_scanned=markets_scanned+excluded.markets_scanned`,
          [name, today,
          dm, dc, dt, dp, ds,
          dEarned, dSpent, dDonated, dOreUnits,
          dKills, dDeaths, dLoot, dCraftU,
          dJumps, dMissions, dMRew, dMarkets]
        );
      }

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
    // Forward to master hub when running as a hub client VM
    if (this.hubClientPush) {
      try { this.hubClientPush(data as Record<string, unknown>); } catch { /* ignore */ }
    }
  }
}
