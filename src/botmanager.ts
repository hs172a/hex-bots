import { existsSync, readdirSync, appendFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { Bot, type Routine } from "./bot.js";
import { SessionManager } from "./session.js";
import { minerRoutineV2 } from "./routines/miner-v2.js";
import { explorerRoutine } from "./routines/explorer.js";
import { crafterRoutine } from "./routines/crafter.js";
import { rescueRoutine } from "./routines/rescue.js";
import { coordinatorRoutine } from "./routines/coordinator.js";
import { traderRoutine } from "./routines/trader.js";
import { gasHarvesterRoutine } from "./routines/gas_harvester.js";
import { iceHarvesterRoutine } from "./routines/ice_harvester.js";
import { salvagerRoutine } from "./routines/salvager.js";
import { hunterRoutine } from "./routines/hunter.js";
import { aiRoutine } from "./routines/ai.js";
import { factionTraderRoutine } from "./routines/faction_trader.js";
import { cleanupRoutine } from "./routines/cleanup.js";
import { gathererRoutine } from "./routines/gatherer.js";
import { scoutRoutine } from "./routines/scout.js";
import { returnHomeRoutine } from "./routines/return_home.js";
import { quartermasterRoutine } from "./routines/quartermaster.js";
import { missionRunnerRoutine } from "./routines/mission_runner.js";
import { shipUpgradeRoutine } from "./routines/ship_upgrade.js";
import { scavengerRoutine } from "./routines/scavenger.js";
import { piCommanderRoutine } from "./routines/pi_commander.js";
import { aiCommanderRoutine } from "./routines/ai_commander.js";
import { stationToFactionRoutine } from "./routines/station_to_faction.js";
import { smartSelectorRoutine } from "./routines/smart_selector.js";
import { mapStore } from "./mapstore.js";
import { catalogStore } from "./catalogstore.js";
import { publicCatalog } from "./publicCatalog.js";
import { WebServer, type WebAction, type WebActionResult } from "./web/server.js";
import { version } from "../package.json";
import { logApiRunStart, setApiLoggingEnabled } from "./apilogger.js";
import { setIpBlockHandler } from "./api.js";
import { logNotifications } from "./ui.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./data/database.js";
import { SessionStore } from "./data/session-store.js";
import { TrainingLogger } from "./data/training-logger.js";
import { RetentionManager } from "./data/retention.js";
import { EconomyEngine } from "./commander/economy-engine.js";
import type { FleetSummary } from "./commander/types.js";
import { GoalsStore } from "./data/goals-store.js";
import { GoalSchema } from "./types/config.js";
import { AdvisoryCommander } from "./commander/advisory-commander.js";
import { initDataSync, DataSyncClient } from "./datasync.js";

const BASE_DIR = process.cwd();
const SESSIONS_DIR = join(BASE_DIR, "sessions");
const FILE_LOG_DIR = join(BASE_DIR, "data", "logs");
const VERSION = version;

// Load config early so the file-logging block and server port can use it.
const _startupConfig = loadConfig();

// ── File Logging (daily rotating console tee) ────────────────
// Tees all console output to data/logs/hex-bots-{date}.log with timestamps.
// Controlled by [logging] file_logging in config.toml.
if (_startupConfig.logging.file_logging) {
  mkdirSync(FILE_LOG_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logPath = join(FILE_LOG_DIR, `hex-bots-${date}.log`);

  const ts = () => new Date().toISOString();
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const writeLine = (line: string) => {
    try { 
      appendFileSync(logPath, line + "\n"); 
    } catch (err) { 
      origError(`[FileLog] Error writing to ${logPath}:`, err);
    }
  };

  console.log = (...args: unknown[]) => {
    writeLine(`[${ts()}] ${args.map(String).join(" ")}`);
    origLog.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    writeLine(`[${ts()}] WARN ${args.map(String).join(" ")}`);
    origWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    writeLine(`[${ts()}] ERROR ${args.map(String).join(" ")}`);
    origError.apply(console, args);
  };

  origLog(`[FileLog] Logging to ${logPath}`);
}

const TABLE_STATUS_REFRESH_INTERVAL = 5000; // 5s, periodic live refresh of tables
const BOT_STATUS_REFRESH_INTERVAL = 30000; // 30s, periodic bots status check
const MAP_STATUS_REFRESH_INTERVAL = 30000; // 30s, periodic map status check

const bots: Map<string, Bot> = new Map();
let server: WebServer;
let sessionStore: SessionStore;

const ROUTINES: Record<string, { name: string; fn: Routine }> = {
  trader: { name: "Trader", fn: traderRoutine },
  miner: { name: "Miner", fn: minerRoutineV2 },
  crafter: { name: "Crafter", fn: crafterRoutine },
  explorer: { name: "Explorer", fn: explorerRoutine },
  faction_trader: { name: "FactionTrader", fn: factionTraderRoutine },
  coordinator: { name: "Coordinator", fn: coordinatorRoutine },
  mission_runner: { name: "MissionRunner", fn: missionRunnerRoutine },
  gatherer: { name: "Gatherer", fn: gathererRoutine },
  gas_harvester: { name: "GasHarvester", fn: gasHarvesterRoutine },
  ice_harvester: { name: "IceHarvester", fn: iceHarvesterRoutine },
  hunter: { name: "Hunter", fn: hunterRoutine },
  quartermaster: { name: "Quartermaster", fn: quartermasterRoutine },
  salvager: { name: "Salvager", fn: salvagerRoutine },
  scavenger: { name: "Scavenger", fn: scavengerRoutine },
  scout: { name: "Scout", fn: scoutRoutine },
  cleanup: { name: "Cleanup", fn: cleanupRoutine },
  return_home: { name: "ReturnHome", fn: returnHomeRoutine },
  ship_upgrade: { name: "ShipUpgrade", fn: shipUpgradeRoutine },
  station_to_faction: { name: "StationToFaction", fn: stationToFactionRoutine },
  rescue: { name: "FuelRescue", fn: rescueRoutine },
  ai: { name: "AI", fn: aiRoutine },
  pi_commander: { name: "PI Commander", fn: piCommanderRoutine },
  ai_commander: { name: "AI Commander", fn: aiCommanderRoutine },
  smart_selector: { name: "SmartSelector", fn: smartSelectorRoutine },
};

// ── Auto-discover existing sessions ─────────────────────────

function discoverBots(): void {
  if (!existsSync(SESSIONS_DIR)) return;
  const dirs = readdirSync(SESSIONS_DIR, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const name = d.name;
    if (bots.has(name)) continue;
    const credPath = join(SESSIONS_DIR, name, "credentials.json");
    if (existsSync(credPath)) {
      const bot = new Bot(name, BASE_DIR);
      setupBotLogging(bot);
      bots.set(name, bot);
    }
  }
}

/** Discover bots from SQLite session store (supplements file-based discovery). */
function discoverBotsFromDB(sessionStore: SessionStore): void {
  const allCreds = sessionStore.listBots();
  for (const creds of allCreds) {
    if (bots.has(creds.username)) continue;
    const bot = new Bot(creds.username, BASE_DIR);
    setupBotLogging(bot);
    bots.set(creds.username, bot);
  }
}

/** Categories that go to the broadcast panel instead of bot log. */
const BROADCAST_CATEGORIES = new Set(["broadcast", "chat", "dm"]);

const LOGS_DIR = join(BASE_DIR, "data", "logs");

/** Append a line to a bot's persistent log file (data/logs/{username}.log). */
function appendBotLog(username: string, line: string): void {
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(join(LOGS_DIR, `${username}.log`), line + "\n");
  } catch (err) {
    console.error(`[FileLog] Error writing bot log for ${username}:`, err);
  }
}

function setupBotLogging(bot: Bot): void {
  logApiRunStart(bot.api.label);
  
  bot.on("log", (username: string, category: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const datestamp = new Date().toISOString().slice(0, 10);
    const line = `${timestamp} [${username}] [${category}] ${message}`;
    if (category === "system" || category === "error") {
      server.logSystem(line);
    }
    server.logActivity(line);
    // Per-bot log for profile page activity log
    const botLine = `${timestamp} [${category}] ${message}`;
    server.logBot(username, botLine);
    // Persistent per-bot log file
    appendBotLog(username, `${datestamp} ${botLine}`);
  });

  bot.on("stateChange", (_username: string, _newState: string) => {
    refreshStatusTable();
  });

  bot.on("factionLog", (_username: string, line: string) => {
    server.logFaction(line);
  });

  bot.on("notifications", (notifications: unknown[], username: string) => {
    logNotifications(notifications, username);
    // Route chat/broadcast notifications to the dashboard Broadcast panel
    for (const n of notifications) {
      if (typeof n !== "object" || !n) continue;
      const notif = n as Record<string, unknown>;
      const type = notif.type as string | undefined;
      const msgType = notif.msg_type as string | undefined;
      const data = notif.data as Record<string, unknown> | undefined;
      // chat_message
      if (msgType === "chat_message" && data && typeof data === "object") {
        const channel = (data.channel as string) || "chat";
        const sender = (data.sender as string) || (data.sender_id as string) || "?";
        const content = (data.content as string) || "";
        const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
        const chanLabel = channel === "system" ? "SYS" : channel === "private" ? "DM" : channel.toUpperCase();
        server.logBroadcast(`${ts} [${chanLabel}] ${sender}: ${content}`);
        continue;
      }
      // new_forum_post
      if (msgType === "new_forum_post" && data && typeof data === "object") {
        const title = (data.title as string) || "";
        const author = (data.author as string) || "";
        const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
        server.logBroadcast(`${ts} [FORUM] 📌 ${author}: ${title}`);
        continue;
      }
      // system-level broadcast (ok/announce msgs)
      if (type === "system" && BROADCAST_CATEGORIES.has("broadcast") && data && typeof data === "object") {
        const message = (data.message as string) || "";
        if (message) {
          const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
          server.logBroadcast(`${ts} [SYS] @${username}: ${message}`);
        }
      }
    }
  });
}

function refreshStatusTable(): void {
  const statuses = [...bots.values()].map((b) => b.status());
  server.updateBotStatus(statuses);
}

// ── Action handlers ─────────────────────────────────────────

async function handleAction(action: WebAction): Promise<WebActionResult> {
  switch (action.type) {
    case "start":
      return handleStart(action);
    case "stop":
      return handleStop(action);
    case "add":
      return handleAdd(action);
    case "register":
      return handleRegister(action);
    case "chat":
      return handleChat(action);
    case "saveSettings":
      return handleSaveSettings(action);
    case "exec":
      return handleExec(action);
    case "remove":
      return handleRemove(action);
    case "refreshCatalog":
      return handleRefreshCatalog();
    default:
      return { ok: false, error: `Unknown action: ${(action as any).type}` };
  }
}

async function handleRefreshCatalog(): Promise<WebActionResult> {
  try {
    await publicCatalog.fetchShips();
    await publicCatalog.fetchStations();
    const summary = publicCatalog.getSummary();
    server.logSystem(`Public catalog force-refreshed: ${summary}`);
    return { ok: true, message: `Public catalog refreshed: ${summary}` };
  } catch (err) {
    server.logSystem(`Public catalog refresh failed: ${err}`);
    return { ok: false, error: `Catalog refresh failed: ${err}` };
  }
}

async function handleSaveSettings(action: WebAction): Promise<WebActionResult> {
  const routine = (action as any).routine as string;
  const s = action.settings;
  if (!routine || !s) return { ok: false, error: "Routine and settings required" };

  server.saveRoutineSettings(routine, s);
  server.logSystem(`Settings saved for ${routine}`);
  // Apply API logging toggle immediately when general settings are updated
  if (routine === "general" && typeof s.enableApiLogging === "boolean") {
    setApiLoggingEnabled(s.enableApiLogging);
  }
  return { ok: true, message: `${routine} settings saved`, settings: server.settings };
}

async function handleStart(action: WebAction): Promise<WebActionResult> {
  const botName = action.bot;
  if (!botName) return { ok: false, error: "No bot specified" };

  const bot = bots.get(botName);
  if (!bot) return { ok: false, error: `Bot not found: ${botName}` };
  if (bot.state === "running") return { ok: false, error: `${botName} is already running` };

  const routineKey = action.routine || "miner";
  const routine = ROUTINES[routineKey];
  if (!routine) return { ok: false, error: `Unknown routine: ${routineKey}` };

  server.logSystem(`Starting ${bot.username} with ${routine.name} routine...`);

  const needsFleet = routineKey === "rescue" || routineKey === "coordinator" || routineKey === "ai_commander";
  const startOpts = needsFleet
    ? {
        getFleetStatus: () => [...bots.values()].map(b => b.status()),
        sendBotAction: routineKey === "ai_commander"
          ? async (a: { type: string; bot?: string; routine?: string; command?: string; params?: Record<string, unknown> }) => {
              return handleAction(a as WebAction);
            }
          : undefined,
      }
    : undefined;

  bot.start(routineKey, routine.fn, startOpts).then(() => {
    server.logSystem(`Bot ${bot.username} routine finished.`);
    server.clearBotAssignment(botName);
    server.fireAlert("botStopped", `\u23F9 Hex-Bots: **${bot.username}** (${routine.name}) finished.`);
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    server.logSystem(`Bot ${bot.username} stopped with error: ${msg}`);
    server.fireAlert("botStopped", `\u26A0\uFE0F Hex-Bots: **${bot.username}** (${routine.name}) crashed: ${msg}`);
    // Auto-restart after 30s — no manual clearBotAssignment so the assignment survives
    const AUTO_RESTART_DELAY_MS = 30_000;
    server.logSystem(`Auto-restarting ${botName} (${routine.name}) in ${AUTO_RESTART_DELAY_MS / 1000}s...`);
    setTimeout(async () => {
      if (bot.state === "error" || bot.state === "idle") {
        server.saveBotAssignment(botName, routineKey);
        await handleStart({ type: "start", bot: botName, routine: routineKey }).catch((e: unknown) => {
          server.logSystem(`Auto-restart of ${botName} failed: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }, AUTO_RESTART_DELAY_MS);
  });

  server.saveBotAssignment(botName, routineKey);

  return { ok: true, message: `Started ${botName} with ${routine.name}` };
}

async function handleStop(action: WebAction): Promise<WebActionResult> {
  const botName = action.bot;
  if (!botName) return { ok: false, error: "No bot specified" };

  const bot = bots.get(botName);
  if (!bot) return { ok: false, error: `Bot not found: ${botName}` };
  if (bot.state === "idle") return { ok: false, error: `${botName} is not running` };
  if (bot.state === "stopping") return { ok: true, message: `${botName} is already stopping` };

  bot.forceStop();
  server.clearBotAssignment(botName);
  server.logSystem(`Stop signal sent to ${bot.username}`);
  return { ok: true, message: `Stop signal sent to ${botName}` };
}

async function handleRemove(action: WebAction): Promise<WebActionResult> {
  const botName = action.bot;
  if (!botName) return { ok: false, error: "No bot specified" };

  const bot = bots.get(botName);
  if (!bot) return { ok: false, error: `Bot not found: ${botName}` };

  // Stop if running
  if (bot.state === "running") {
    bot.stop();
    await new Promise((r) => setTimeout(r, 3000));
  }

  bots.delete(botName);
  server.clearBotAssignment(botName);
  server.removePerBotSettings(botName);
  sessionStore.removeBot(botName);

  // Delete legacy session directory
  const sessionDir = join(SESSIONS_DIR, botName);
  try {
    rmSync(sessionDir, { recursive: true, force: true });
  } catch { /* ignore if already gone */ }

  server.logSystem(`Removed bot: ${botName}`);
  refreshStatusTable();
  return { ok: true, message: `Removed ${botName}` };
}

async function handleAdd(action: WebAction): Promise<WebActionResult> {
  const { username, password } = action;
  if (!username || !password) return { ok: false, error: "Username and password required" };

  if (bots.has(username)) return { ok: false, error: `Bot already exists: ${username}` };

  // Save to both file-based session (for backward compat) and SQLite
  const session = new SessionManager(username, BASE_DIR);
  session.saveCredentials({ username, password, empire: "", playerId: "" });
  sessionStore.upsertBot({ username, password, empire: "", playerId: "" });

  const bot = new Bot(username, BASE_DIR);
  setupBotLogging(bot);
  bots.set(username, bot);

  server.logSystem(`Verifying credentials for ${username}...`);
  const ok = await bot.login();
  if (ok) {
    const s = bot.status();
    server.logSystem(`Added ${username}! Location: ${s.location}, Credits: ${s.credits}`);
  } else {
    server.logSystem(`Login failed for ${username} -- credentials saved, retry later.`);
  }
  refreshStatusTable();
  return { ok: true, message: `Bot added: ${username}` };
}

async function handleRegister(action: WebAction): Promise<WebActionResult> {
  const { username, empire, registration_code } = action;
  if (!username) return { ok: false, error: "Username required" };
  if (!registration_code) return { ok: false, error: "Registration code required (get one from spacemolt.com/dashboard)" };

  const selectedEmpire = empire || "solarian";
  server.logSystem(`Registering ${username} in ${selectedEmpire}...`);

  const tempBot = new Bot(username, BASE_DIR);
  const resp = await tempBot.exec("register", { username, empire: selectedEmpire, registration_code });

  if (resp.error) {
    server.logSystem(`Registration failed: ${resp.error.message}`);
    return { ok: false, error: `Registration failed: ${resp.error.message}` };
  }

  const result = resp.result as Record<string, unknown> | undefined;
  const password = (result?.password as string) || "";
  const playerId = (result?.player_id as string) || "";

  if (!password) {
    server.logSystem("Registration succeeded but no password returned.");
    return { ok: false, error: "No password returned" };
  }

  server.logSystem(`Registration successful for ${username} — password returned to dashboard only.`);

  // Save to both file-based session (for backward compat) and SQLite
  const session = new SessionManager(username, BASE_DIR);
  session.saveCredentials({ username, password, empire: selectedEmpire, playerId });
  sessionStore.upsertBot({ username, password, empire: selectedEmpire, playerId });

  const bot = new Bot(username, BASE_DIR);
  setupBotLogging(bot);
  bots.set(username, bot);
  server.logSystem(`Bot added: ${username}`);
  refreshStatusTable();

  return { ok: true, message: `Registered ${username}`, password };
}

async function handleChat(action: WebAction): Promise<WebActionResult> {
  const { bot: botName, message, channel } = action;
  if (!botName || !message) return { ok: false, error: "Bot and message required" };

  const bot = bots.get(botName);
  if (!bot) return { ok: false, error: `Bot not found: ${botName}` };

  if (!bot.api.getSession()) {
    await bot.login();
  }

  const resp = await bot.exec("chat", { content: message, channel: channel || "system" });
  if (resp.error) {
    return { ok: false, error: `Chat failed: ${resp.error.message}` };
  }

  server.logSystem(`[${channel || "system"}] ${bot.username}: ${message}`);
  return { ok: true, message: `Message sent as ${bot.username}` };
}

async function handleExec(action: WebAction): Promise<WebActionResult> {
  const { bot: botName, command, params } = action;
  if (!botName || !command) return { ok: false, error: "Bot and command required" };

  const bot = bots.get(botName);
  if (!bot) return { ok: false, error: `Bot not found: ${botName}` };

  if (!bot.api.getSession()) {
    await bot.login();
  }

  let resp = await bot.exec(command, params);

  // If still getting auth errors after API's internal recovery, do a full re-login and retry once
  if (resp.error) {
    const code = resp.error.code;
    if (code === "session_invalid" || code === "session_expired" || code === "not_authenticated") {
      server.logSystem(`Session lost for ${botName}, re-logging in...`);
      const ok = await bot.login();
      if (ok) {
        resp = await bot.exec(command, params);
      }
    }
  }

  // Refresh cached state after mutating commands
  const refreshCommands = new Set([
    "mine", "sell", "buy", "dock", "undock", "travel", "jump",
    "refuel", "repair", "deposit_items", "withdraw_items", "jettison",
    "attack", "loot_wreck", "salvage_wreck", "send_gift", "craft",
    "accept_mission", "complete_mission", "abandon_mission",
    "buy_ship", "sell_ship", "switch_ship", "install_mod", "uninstall_mod", "set_colors",
    "faction_deposit_items", "faction_withdraw_items",
  ]);
  if (refreshCommands.has(command)) {
    await bot.refreshStatus();

    // Also refresh faction storage cache after faction deposit/withdraw
    if (command === "faction_deposit_items" || command === "faction_withdraw_items") {
      await bot.refreshFactionStorage();
    }

    // Also refresh the recipient bot after gift/trade
    if (command === "send_gift" || command === "trade_offer") {
      const recipient = (params as Record<string, unknown> | undefined)?.recipient as string | undefined;
      const recipientBot = recipient ? bots.get(recipient) : undefined;
      if (recipientBot) {
        // Credits go to recipient's storage locker — auto-withdraw if docked
        if (recipientBot.docked && recipientBot.api.getSession()) {
          const giftCredits = (params as Record<string, unknown> | undefined)?.credits as number | undefined;
          if (giftCredits && giftCredits > 0) {
            server.logSystem(`Auto-withdrawing ${giftCredits} credits from storage for ${recipient}...`);
            await recipientBot.exec("withdraw_credits", { amount: giftCredits });
          }
        }
        await recipientBot.refreshStatus();
      }
    }

    refreshStatusTable();
  }

  // Sync bot cached state after read commands so periodic status broadcasts stay correct
  if (!resp.error) {
    if (command === "view_faction_storage") {
      await bot.refreshFactionStorage();
      refreshStatusTable();
    } else if (command === "view_storage") {
      await bot.refreshStorage();
      refreshStatusTable();
    } else if (command === "get_cargo") {
      await bot.refreshCargo();
      refreshStatusTable();
    }
  }

  // Log manual faction operations to faction activity log
  if (!resp.error) {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const p = params as Record<string, unknown> | undefined;
    switch (command) {
      case "faction_deposit_credits": {
        const amt = p?.amount as number | undefined;
        if (amt) server.logFaction(`${timestamp} [deposit] ${botName}: Deposited ${amt}cr to faction treasury`);
        break;
      }
      case "faction_withdraw_credits": {
        const amt = p?.amount as number | undefined;
        if (amt) server.logFaction(`${timestamp} [withdraw] ${botName}: Withdrew ${amt}cr from faction treasury`);
        break;
      }
      case "faction_deposit_items": {
        const itemId = p?.item_id as string | undefined;
        const qty = p?.quantity as number | undefined;
        if (itemId) server.logFaction(`${timestamp} [deposit] ${botName}: Deposited ${qty || 1}x ${itemId} to faction storage`);
        break;
      }
      case "faction_withdraw_items": {
        const itemId = p?.item_id as string | undefined;
        const qty = p?.quantity as number | undefined;
        if (itemId) server.logFaction(`${timestamp} [withdraw] ${botName}: Withdrew ${qty || 1}x ${itemId} from faction storage`);
        break;
      }
      case "complete_mission": {
        const mId = p?.mission_id as string | undefined;
        server.fireAlert("missionComplete", `\u2705 Hex-Bots: **${botName}** completed mission${mId ? ` ${mId}` : ""}`);
        break;
      }
    }
  }

  if (resp.error) {
    return { ok: false, error: resp.error.message, data: resp.result };
  }

  return { ok: true, message: `${command} executed`, data: resp.result };
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize SQLite database
  const db = createDatabase();
  sessionStore = new SessionStore(db);

  // Migrate file-based sessions to SQLite (one-time)
  const migrated = sessionStore.migrateFromFiles(SESSIONS_DIR);
  if (migrated > 0) {
    console.log(`[DB] Migrated ${migrated} bot session(s) from files to SQLite`);
  }

  catalogStore.connectToDb(db);
  mapStore.connectToDb(db);

  // Training logger + data retention
  const logger = new TrainingLogger(db);
  logger.startSnapshotFlush();

  const retention = new RetentionManager(db);
  const retResult = retention.run();
  const totalCleaned = retResult.decisionLogDeleted + retResult.snapshotsDeleted
    + retResult.marketHistoryDeleted + retResult.commanderLogDeleted;
  if (totalCleaned > 0) console.log(`[Retention] Cleaned ${totalCleaned} old records`);

  // Daily retention cleanup
  const retentionTimer = setInterval(() => {
    const r = retention.run();
    const total = r.decisionLogDeleted + r.snapshotsDeleted + r.marketHistoryDeleted + r.commanderLogDeleted;
    if (total > 0) console.log(`[Retention] Cleaned ${total} records`);
  }, 86_400_000);

  // Economy engine
  const economy = new EconomyEngine();
  if (config.inventory_targets.length > 0) {
    economy.setStockTargets(config.inventory_targets);
    console.log(`[Economy] ${config.inventory_targets.length} stock target(s) loaded`);
  }

  /** Build FleetSummary from current bot states (for economy analysis) */
  function buildFleetSummary(): FleetSummary {
    const statuses = [...bots.values()].map(b => b.status());
    return {
      bots: statuses.map(s => ({
        username: s.username,
        state: s.state,
        routine: s.routine || null,
        credits: s.credits || 0,
        fuelPct: s.maxFuel > 0 ? (s.fuel / s.maxFuel) * 100 : 0,
        cargoPct: s.cargoMax > 0 ? (s.cargo / s.cargoMax) * 100 : 0,
      })),
      totalCredits: statuses.reduce((sum, s) => sum + (s.credits || 0), 0),
      activeBots: statuses.filter(s => s.state === "running").length,
    };
  }

  // Goals persistence
  const goalsStore = new GoalsStore(db);
  if (goalsStore.count === 0 && config.goals.length > 0) {
    goalsStore.saveGoals(config.goals);
    console.log(`[Goals] Seeded ${config.goals.length} goal(s) from config.toml`);
  }

  // Advisory Commander (scoring brain — suggests but doesn't auto-apply)
  const commander = new AdvisoryCommander();
  commander.setRoutines(Object.keys(ROUTINES));

  const port = config.server.port;
  server = new WebServer(port);
  server.routines = Object.keys(ROUTINES);
  server.onAction = handleAction;
  server.onPlayerInfo = async (playerId: string) => {
    const bot = [...bots.values()][0];
    if (!bot) throw new Error("No bot available");
    return await bot.api.getPlayerProfile(playerId);
  };
  server.onEconomyData = () => economy.getSummary(buildFleetSummary());
  server.onCreditHistory = (sinceMs: number) => logger.getCreditHistory(sinceMs);
  server.onCommanderData = () => commander.getLastResult();

  server.onGetPiTodo = (session: string): string => {
    try {
      const mgr = new SessionManager(session, BASE_DIR);
      return mgr.loadTodo();
    } catch { return ""; }
  };
  server.onSavePiTodo = (session: string, content: string): void => {
    try {
      const mgr = new SessionManager(session, BASE_DIR);
      mgr.saveTodo(content);
    } catch (err) {
      console.error("[PiTodo] Failed to save:", err);
    }
  };
  server.onGetGoals = () => goalsStore.loadGoals();
  server.onSaveGoals = (goals: unknown[]) => {
    try {
      const parsed = goals.map((g: unknown) => GoalSchema.parse(g));
      goalsStore.saveGoals(parsed);
      console.log(`[Goals] Saved ${parsed.length} goal(s)`);
    } catch (err) {
      console.error("[Goals] Invalid goal data:", err);
    }
  };

  server.onRefreshCatalog = async (): Promise<string> => {
    const bot = [...bots.values()][0];
    if (!bot) throw new Error("No bots available");
    catalogStore.clearAll();
    await catalogStore.fetchAll(bot.api);
    server.logSystem(`[Admin] Catalog wiped and refreshed: ${catalogStore.getSummary()}`);
    return catalogStore.getSummary();
  };

  server.onRefreshMap = async (): Promise<string> => {
    mapStore.clearAll();
    const { seeded, known, failed } = await mapStore.seedFromMapAPI();
    if (failed) throw new Error("Map seed failed");
    const msg = `${seeded} system(s) seeded from API (full wipe + re-seed)`;
    server.logSystem(`[Admin] Galaxy map wiped and refreshed: ${msg}`);
    server.updateMapData();
    return msg;
  };

  setIpBlockHandler((secs: number) => {
    server.logSystem(`[Rate Limit] IP blocked — retry after ${secs}s`);
    server.broadcastRateLimit(true, secs);
    server.fireAlert("ipBlocked", `\u26D4 Hex-Bots: IP rate-limited — retry in ${secs}s.`);
    // Automatically clear block flag after the timeout expires
    setTimeout(() => server.broadcastRateLimit(false), secs * 1000);
  });

  // Apply API logging: config.toml first, then persisted settings override
  if (config.logging.api_logging) {
    setApiLoggingEnabled(true);
  }
  const startupApiLogging = server.settings?.general?.enableApiLogging;
  if (typeof startupApiLogging === "boolean") {
    setApiLoggingEnabled(startupApiLogging);
  }

  // Initialize DataSync (shared game knowledge across VMs)
  const dataSync = initDataSync(mapStore, catalogStore, config.datasync);
  if (dataSync) {
    server.dataSyncMode = config.datasync.mode;
    server.logSystem(`[DataSync] mode=${config.datasync.mode} enabled`);
    if (dataSync instanceof DataSyncClient) {
      dataSync.onStatusChange = (offline: boolean) => {
        server.broadcastDataSyncStatus(offline);
        if (offline) server.logSystem("[DataSync] Tunnel appears DOWN — cannot reach master");
        else server.logSystem("[DataSync] Tunnel restored — connected to master");
      };
    }
  }

  server.logSystem(`Hex-Bots v${VERSION}`);
  server.logSystem("Loading saved sessions...");

  discoverBots();
  discoverBotsFromDB(sessionStore);

  // Seed public catalog (ships + stations) from public API
  publicCatalog.refreshIfStale().then(({ ships, stations }) => {
    const parts = [];
    if (ships) parts.push("ships");
    if (stations) parts.push("stations");
    if (parts.length > 0) server.logSystem(`Public catalog refreshed: ${parts.join(", ")} (${publicCatalog.getSummary()})`);
    else server.logSystem(`Public catalog loaded from cache (${publicCatalog.getSummary()})`);
  }).catch(err => {
    server.logSystem(`Public catalog refresh failed: ${err}`);
  });

  // Seed galaxy map from public API so pathfinding works from first run
  server.logSystem("Seeding galaxy map from /api/map...");
  mapStore.seedFromMapAPI().then(({ seeded, known, failed }) => {
    if (failed) {
      server.logSystem("Galaxy map seed failed — will rely on exploration data");
    } else {
      server.logSystem(`Galaxy map seeded: ${seeded} new system(s), ${known} already known`);
    }
  }).catch(() => {
    server.logSystem("Galaxy map seed failed — will rely on exploration data");
  });

  if (bots.size > 0) {
    const assignments = server.getBotAssignments();
    server.logSystem(`Found ${bots.size} saved bot(s): ${[...bots.keys()].join(", ")}`);

    // Stagger logins to avoid spamming the API
    const LOGIN_DELAY_MS = config.fleet.login_stagger_ms;
    let loginIndex = 0;
    for (const [name, bot] of bots) {
      const delay = loginIndex * LOGIN_DELAY_MS;
      loginIndex++;
      setTimeout(() => {
        bot.login().then(async (ok) => {
          refreshStatusTable();
          if (!ok) return;
          // Fetch catalog data if stale (first logged-in bot triggers it)
          if (catalogStore.isStale()) {
            try {
              await catalogStore.fetchAll(bot.api);
              server.logSystem(`Catalog fetched (${catalogStore.getSummary()})`);
            } catch (err) {
              server.logSystem(`Catalog fetch failed: ${err}`);
            }
          }
          const routineKey = assignments[name];
          if (!routineKey || !ROUTINES[routineKey]) return;
          server.logSystem(`Auto-resuming ${name} with ${ROUTINES[routineKey].name}...`);
          await handleStart({ type: "start", bot: name, routine: routineKey });
        }).catch((err) => {
          server.logSystem(`Login failed for ${name}: ${err}`);
        });
      }, delay);
    }
  }

  refreshStatusTable();

  // Load catalog data (fetch if stale, using first available bot session)
  if (!catalogStore.isStale()) {
    server.logSystem(`Catalog loaded from cache (${catalogStore.getSummary()})`);
  } else {
    server.logSystem("Catalog data is stale, will fetch after first bot login...");
  }

  // Periodic timers (store IDs for cleanup)
  const intervals: ReturnType<typeof setInterval>[] = [];

  // Periodic UI push (cached data → websocket clients)
  intervals.push(setInterval(() => {
    refreshStatusTable();
  }, TABLE_STATUS_REFRESH_INTERVAL));  // Changed from 2s to 5s

  // Periodic live refresh — running bots hit API every 30s; idle/error bots every 90s
  // so the UI always shows fresh location/credits even for non-running bots.
  let idleRefreshTick = 0;
  intervals.push(setInterval(async () => {
    idleRefreshTick++;
    for (const [, bot] of bots) {
      if (!bot.api.getSession()) continue;
      // Always refresh running bots; refresh idle/error bots every 3rd tick (≈90s)
      const shouldRefresh = bot.state === "running" || idleRefreshTick % 3 === 0;
      if (shouldRefresh) {
        await bot.refreshStatus().catch((err: unknown) => {
          process.stderr.write(`[${bot.username}] refreshStatus failed: ${err instanceof Error ? err.message : String(err)}\n`);
        });
      }
    }
    refreshStatusTable();
  }, BOT_STATUS_REFRESH_INTERVAL));

  // Periodic map data push (every 30s so dashboard stays current)
  intervals.push(setInterval(() => {
    server.updateMapData();
  }, MAP_STATUS_REFRESH_INTERVAL));

  // Periodic commander advisory evaluation (every 3 minutes)
  intervals.push(setInterval(() => {
    const statuses = [...bots.values()].map(b => b.status());
    const runningCount = statuses.filter(s => s.state === "running").length;
    if (runningCount === 0) return; // Skip if no bots are running
    const goals = goalsStore.loadGoals();
    const fleet = buildFleetSummary();
    const econSnapshot = economy.analyze(fleet);
    const result = commander.evaluate(statuses, goals, econSnapshot);
    if (result.suggestions.length > 0) {
      server.logSystem(`[Commander] ${result.suggestions.length} suggestion(s):`);
      for (const s of result.suggestions) {
        server.logSystem(`  ${s.username}: ${s.currentRoutine || "idle"} → ${s.suggestedRoutine} (score ${s.score})`);
      }
    }
  }, config.commander.evaluation_interval * 1000));

  let creditsTargetAlerted = false;

  // Periodic stats flush (every 60s) + credit history logging
  intervals.push(setInterval(() => {
    const statuses = [...bots.values()].map(b => b.status());
    server.flushBotStats(statuses);
    // Log credit history for charting
    const activeBots = statuses.filter(s => s.state === "running").length;
    const totalCredits = statuses.reduce((sum, s) => sum + (s.credits || 0), 0);
    // Credits target alert (fire once, reset when credits drop below 90% of target)
    const alertsSettings = server.settings?.alerts as Record<string, unknown> | undefined;
    const creditsTarget = Number(alertsSettings?.creditsTarget || 0);
    if (creditsTarget > 0) {
      if (!creditsTargetAlerted && totalCredits >= creditsTarget) {
        server.fireAlert("creditsTarget", `\uD83D\uDCB0 Hex-Bots: Fleet credits hit ${totalCredits.toLocaleString()} \u2014 target ${creditsTarget.toLocaleString()} reached!`);
        creditsTargetAlerted = true;
      } else if (creditsTargetAlerted && totalCredits < creditsTarget * 0.9) {
        creditsTargetAlerted = false;
      }
    }
    if (activeBots > 0) {
      logger.logCreditHistory(totalCredits, activeBots);
    }
  }, 60000));

  // Daily public catalog refresh (24h)
  intervals.push(setInterval(async () => {
    try {
      const { ships, stations } = await publicCatalog.refreshIfStale();
      if (ships || stations) server.logSystem(`Public catalog refreshed (${publicCatalog.getSummary()})`);
    } catch (err) {
      server.logSystem(`Public catalog refresh failed: ${err}`);
    }
  }, 24 * 60 * 60 * 1000));

  // Daily game catalog refresh (24h)
  intervals.push(setInterval(async () => {
    if (!catalogStore.isStale()) return;
    // Find first bot with an active session
    for (const [, bot] of bots) {
      if (bot.api.getSession()) {
        try {
          await catalogStore.fetchAll(bot.api);
          server.logSystem(`Catalog refreshed (${catalogStore.getSummary()})`);
        } catch (err) {
          server.logSystem(`Catalog refresh failed: ${err}`);
        }
        break;
      }
    }
  }, 24 * 60 * 60 * 1000));

  // Start HTTP + WebSocket server
  server.start();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    // Clear intervals
    for (const id of intervals) clearInterval(id);
    clearInterval(retentionTimer);
    // Flush stats before stopping bots
    const statuses = [...bots.values()].map(b => b.status());
    server.flushBotStats(statuses);
    for (const [, bot] of bots) {
      if (bot.state === "running") bot.stop();
    }
    mapStore.flush();
    catalogStore.flush();
    logger.destroy();
    db.close();
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
