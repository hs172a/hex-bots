import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// ── Interfaces ──────────────────────────────────────────────

export interface CargoItem {
  itemId: string;
  name: string;
  quantity: number;
}

export interface BotStats {
  totalMined: number;
  totalCrafted: number;
  totalTrades: number;
  totalProfit: number;
  totalSystems: number;
}

export interface PlayerStats {
  creditsEarned: number;
  creditsSpent: number;
  shipsDestroyed: number;
  shipsLost: number;
  piratesDestroyed: number;
  basesDestroyed: number;
  oreMined: number;
  itemsCrafted: number;
  tradesCompleted: number;
  systemsExplored: number;
  distanceTraveled: number;
  timePlayed: number;
}

export interface SkillEntry {
  skill_id: string;
  level: number;
  xp?: number;
  xp_to_next?: number;
  next_level_xp?: number;
}

export interface BotStatus {
  username: string;
  state: string;
  routine?: string;
  credits: number;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  cargo: number;
  cargoMax: number;
  location: string;
  shipName?: string;
  ship?: string;
  docked?: boolean;
  system?: string;
  poi?: string;
  ammo?: number;
  inventory?: CargoItem[];
  storage?: CargoItem[];
  factionStorage?: CargoItem[];
  factionId?: string;
  tradingRestrictedUntil?: string | null;
  skills?: SkillEntry[];
  playerStats?: PlayerStats;
  marketData?: any[];
  stats?: BotStats;
}

export interface KnownSystem {
  id: string;
  name?: string;
}

export interface KnownOre {
  item_id: string;
  name: string;
}

type ExecCallback = (result: any) => void;

// ── Store ───────────────────────────────────────────────────

export const useBotStore = defineStore('bots', () => {
  // ── Core state ──
  const bots = ref<BotStatus[]>([]);
  const selectedBot = ref<string | null>(null);
  const routines = ref<Array<{ id: string; name: string }>>([])
  const settings = ref<Record<string, any>>({});
  const knownSystems = ref<KnownSystem[]>([]);
  const knownOres = ref<KnownOre[]>([]);
  const catalog = ref<any>({ items: {}, ships: {}, skills: {}, recipes: {} });
  const publicShips = ref<any[]>([]);
  const publicStations = ref<any[]>([]);
  const mapData = ref<Record<string, any>>({});
  const statsDaily = ref<Record<string, any>>({});
  // poolName → { botName → { date → DayStats } }
  const allPoolsStats = ref<Record<string, Record<string, any>>>({});
  const allPoolsLoading = ref(false);

  async function fetchAllPoolsStats() {
    if (allPoolsLoading.value) return;
    allPoolsLoading.value = true;
    try {
      const res = await fetch('/api/stats/all-pools');
      if (res.ok) allPoolsStats.value = await res.json();
    } catch { /* ignore network errors */ } finally {
      allPoolsLoading.value = false;
    }
  }

  // ── Rate-limit block state ──
  const ipBlocked = ref(false);
  const ipBlockEndsAt = ref(0); // ms timestamp

  // ── DataSync status (client mode only) ──
  const dataSyncOffline = ref(false);
  const dataSyncMode = ref<'master' | 'client' | 'disabled'>('disabled');

  // ── Credits/hour tracking (rolling 1-hour window) ──
  const creditsHistory = ref<Record<string, Array<{ ts: number; credits: number }>>>({});
  const CREDITS_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  const CREDITS_MIN_WINDOW_MS = 5 * 60 * 1000; // need at least 5 min of data

  function recordCreditsSnapshot(username: string, credits: number) {
    if (!creditsHistory.value[username]) creditsHistory.value[username] = [];
    const buf = creditsHistory.value[username];
    const now = Date.now();
    // Deduplicate: only record if credits changed or 60s elapsed
    const last = buf[buf.length - 1];
    if (last && last.credits === credits && now - last.ts < 60_000) return;
    buf.push({ ts: now, credits });
    // Prune entries older than 2 hours
    const cutoff = now - CREDITS_WINDOW_MS * 2;
    while (buf.length > 1 && buf[0].ts < cutoff) buf.shift();
  }

  const botCreditsPerHour = computed<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    const now = Date.now();
    for (const [username, buf] of Object.entries(creditsHistory.value)) {
      if (buf.length < 2) { result[username] = 0; continue; }
      const cutoff = now - CREDITS_WINDOW_MS;
      // Find the oldest snapshot within the window
      let oldest = buf[0];
      for (const snap of buf) {
        if (snap.ts >= cutoff) { oldest = snap; break; }
      }
      const newest = buf[buf.length - 1];
      const elapsedMs = newest.ts - oldest.ts;
      if (elapsedMs < CREDITS_MIN_WINDOW_MS) { result[username] = 0; continue; }
      const delta = newest.credits - oldest.credits;
      result[username] = Math.round(delta / (elapsedMs / CREDITS_WINDOW_MS));
    }
    return result;
  });

  // ── Log state ──
  const activityLogs = ref<string[]>([]);
  const broadcastLogs = ref<string[]>([]);
  const systemLogs = ref<string[]>([]);
  const factionLogLines = ref<string[]>([]);
  const botLogBuffers = ref<Record<string, string[]>>({});
  const logs = ref<Array<{ bot: string; type: string; message: string }>>([]);

  // ── Exec callback system (matches old UI's sendExec/_seq pattern) ──
  let execSeq = 0;
  const execCallbacks: Record<number, ExecCallback> = {};
  const execTimers: Record<number, ReturnType<typeof setTimeout>> = {};

  // ── Getters ──
  const activeBots = computed(() => bots.value.filter(b => b.state === 'running'));
  const currentBot = computed(() =>
    bots.value.find(b => b.username === selectedBot.value)
  );

  // ── WebSocket message handler ──
  function handleWebSocketMessage(data: any) {
    switch (data.type) {
      case 'init':
        if (data.bots) bots.value = data.bots;
        if (data.routines) routines.value = Array.isArray(data.routines)
          ? data.routines.map((r: any) => typeof r === 'string' ? { id: r, name: r } : r)
          : [];
        if (data.settings) settings.value = data.settings;
        if (data.knownSystems) knownSystems.value = data.knownSystems;
        if (data.knownOres) knownOres.value = data.knownOres;
        if (data.catalog) catalog.value = data.catalog;
        if (data.publicCatalog?.ships) publicShips.value = data.publicCatalog.ships;
        if (data.publicCatalog?.stations) publicStations.value = data.publicCatalog.stations;
        if (data.mapData) mapData.value = data.mapData;
        if (data.statsDaily) statsDaily.value = data.statsDaily;
        if (data.logs?.activity) activityLogs.value = data.logs.activity.slice(-500);
        if (data.logs?.broadcast) broadcastLogs.value = data.logs.broadcast.slice(-500);
        if (data.logs?.system) systemLogs.value = data.logs.system.slice(-500);
        if (data.logs?.faction) factionLogLines.value = data.logs.faction.slice(-200);
        if (data.botLogs) botLogBuffers.value = data.botLogs;
        if (data.dataSyncMode) dataSyncMode.value = data.dataSyncMode;
        break;

      case 'status':
        if (data.bots) {
          for (const update of data.bots) {
            const idx = bots.value.findIndex(b => b.username === update.username);
            if (idx >= 0) {
              Object.assign(bots.value[idx], update);
            } else {
              bots.value.push(update);
            }
            if (update.username && typeof update.credits === 'number') {
              recordCreditsSnapshot(update.username, update.credits);
            }
          }
          // Remove bots no longer reported by server (splice in-place to avoid full re-render)
          const names = new Set(data.bots.map((b: any) => b.username));
          for (let i = bots.value.length - 1; i >= 0; i--) {
            if (!names.has(bots.value[i].username)) bots.value.splice(i, 1);
          }
        }
        break;

      case 'log':
        // Dashboard log panels (activity/broadcast/system)
        if (data.panel === 'activity') {
          pushLog(activityLogs.value, data.line, 500);
        } else if (data.panel === 'broadcast') {
          pushLog(broadcastLogs.value, data.line, 500);
        } else if (data.panel === 'system') {
          pushLog(systemLogs.value, data.line, 500);
        }
        // Bot-specific logs (from server logBot)
        if (data.bot && data.message) {
          logs.value.push({
            bot: data.bot,
            type: data.level || 'info',
            message: data.message,
          });
          if (logs.value.length > 1000) logs.value.shift();
        }
        break;

      case 'botLog':
        // Per-bot activity log line (legacy format)
        if (data.username && data.line) {
          if (!botLogBuffers.value[data.username]) botLogBuffers.value[data.username] = [];
          botLogBuffers.value[data.username].push(data.line);
          if (botLogBuffers.value[data.username].length > 200) botLogBuffers.value[data.username].shift();
        }
        break;

      case 'factionLog':
        if (data.line) {
          pushLog(factionLogLines.value, data.line, 200);
        }
        break;

      case 'actionResult':
        if (data.error) {
          systemLogs.value.push(`Error: ${data.error}`);
        } else if (data.message) {
          systemLogs.value.push(data.message);
        }
        if (data.settings) {
          settings.value = data.settings;
        }
        break;

      case 'execResult':
        handleExecResult(data);
        break;

      case 'mapUpdate':
        // Map data from backend includes market info
        if (data.mapData) mapData.value = data.mapData;
        if (data.knownOres) knownOres.value = data.knownOres;
        break;

      case 'statsUpdate':
        if (data.statsDaily) statsDaily.value = data.statsDaily;
        break;

      case 'rateLimitBlock':
        ipBlocked.value = data.blocked === true;
        ipBlockEndsAt.value = (data.blocked && data.retryAfterSecs)
          ? Date.now() + data.retryAfterSecs * 1000
          : 0;
        break;

      case 'dataSyncStatus':
        dataSyncOffline.value = data.offline === true;
        break;
    }
  }

  // ── Exec result handler (callback + bot data updates) ──
  function handleExecResult(msg: any) {
    // Match callback by _seq (like old UI's handleExecResult)
    if (msg._seq && execCallbacks[msg._seq]) {
      clearTimeout(execTimers[msg._seq]);
      delete execTimers[msg._seq];
      execCallbacks[msg._seq](msg);
      delete execCallbacks[msg._seq];
    }
  }

  // ── Send raw WebSocket message ──
  function wsSend(msg: any) {
    const ws = (window as any).__ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // ── Send exec command with callback (matches old UI's sendExec) ──
  function sendExec(botName: string, command: string, params?: any, callback?: ExecCallback): void {
    const seq = ++execSeq;
    if (callback) {
      execCallbacks[seq] = callback;
      execTimers[seq] = setTimeout(() => {
        if (execCallbacks[seq]) {
          execCallbacks[seq]({ ok: false, error: `Timeout: ${command} did not respond` });
          delete execCallbacks[seq];
        }
        delete execTimers[seq];
      }, 30000);
    }
    wsSend({ type: 'exec', bot: botName, command, params, _seq: seq });
  }

  // ── Convenience actions ──
  function startBot(username: string, routine: string) {
    wsSend({ type: 'start', bot: username, routine });
  }

  function stopBot(username: string) {
    wsSend({ type: 'stop', bot: username });
  }

  function removeBot(username: string) {
    wsSend({ type: 'remove', bot: username });
  }

  function addBot(username: string, password: string) {
    wsSend({ type: 'add', username, password });
  }

  function registerBot(code: string, username: string, empire: string) {
    wsSend({ type: 'register', registration_code: code, username, empire });
  }

  function saveSettings(routine: string, s: Record<string, any>) {
    wsSend({ type: 'saveSettings', routine, settings: s });
    // Optimistically update local state
    settings.value[routine] = { ...settings.value[routine], ...s };
  }

  function sendChat(botName: string, channel: string, message: string) {
    wsSend({ type: 'chat', bot: botName, channel, message });
  }

  // ── Helpers ──
  function pushLog(arr: string[], line: string, max: number) {
    arr.push(line);
    if (arr.length > max) arr.shift();
  }

  function resolveLocation(systemId: string, poiId?: string): string {
    if (!systemId) return '';
    const sys = mapData.value[systemId];
    const sysName = sys?.name || systemId;
    if (!poiId) return sysName;
    const poi = (sys?.pois || []).find((p: any) => p.id === poiId);
    const poiName = poi?.name || poiId;
    return `${sysName} - ${poiName}`;
  }

  function catalogName(id: string): string {
    const c = catalog.value;
    return c.items?.[id]?.name || c.ships?.[id]?.name
      || c.skills?.[id]?.name || c.recipes?.[id]?.name
      || id.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase());
  }

  return {
    // State
    bots,
    selectedBot,
    routines,
    settings,
    knownSystems,
    knownOres,
    catalog,
    publicShips,
    publicStations,
    mapData,
    statsDaily,
    allPoolsStats,
    allPoolsLoading,
    fetchAllPoolsStats,
    logs,
    activityLogs,
    broadcastLogs,
    systemLogs,
    factionLogLines,
    botLogBuffers,
    // Getters
    activeBots,
    currentBot,
    // Actions
    handleWebSocketMessage,
    wsSend,
    sendExec,
    startBot,
    stopBot,
    removeBot,
    addBot,
    registerBot,
    saveSettings,
    sendChat,
    // Rate-limit state
    ipBlocked,
    ipBlockEndsAt,
    // DataSync state
    dataSyncOffline,
    dataSyncMode,
    // Credits/hour
    botCreditsPerHour,
    // Helpers
    resolveLocation,
    catalogName,
  };
});
