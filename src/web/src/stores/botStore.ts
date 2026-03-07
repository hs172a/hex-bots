import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';

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
  /** Which remote VM hosts this bot (undefined = local). */
  vm?: string;
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
  const catalog = shallowRef<any>({ items: {}, ships: {}, skills: {}, recipes: {} });
  const publicShips = ref<any[]>([]);
  const gameStats = ref<{ online_players?: number; total_players?: number; tick?: number; version?: string }>({});
  const publicStations = ref<any[]>([]);
  const mapData = shallowRef<Record<string, any>>({});
  const statsDaily = shallowRef<Record<string, any>>({});
  // poolName → { botName → { date → DayStats } }
  const allPoolsStats = shallowRef<Record<string, Record<string, any>>>({}); 
  const allPoolsLoading = ref(false);
  // This VM's own pool name, returned by /api/stats/all-pools since v1.8.1
  const myPoolName = ref('');

  // ── Faction storage DB (global across all stations) ──
  const factionStorageItems = ref<Array<{ poi_id: string; system_id: string; system_name: string; poi_name: string; item_id: string; item_name: string; quantity: number; updated_at: string }>>([]); 
  const factionBuildings = ref<Array<{ facility_id: string; faction_id: string; faction_name: string; poi_id: string; poi_name: string; system_id: string; system_name: string; facility_type: string; facility_name: string; faction_service: string; active: boolean; level: number; updated_at: string }>>([]); 
  const factionStorageLoading = ref(false);

  // ── Per-bot dock results (story, station_condition, unread_chat) ──
  const stationDockInfo = ref<Record<string, any>>({});

  async function fetchFactionStorage() {
    if (factionStorageLoading.value) return;
    factionStorageLoading.value = true;
    try {
      const [r1, r2] = await Promise.all([fetch('/api/faction-storage'), fetch('/api/faction-buildings')]);
      if (r1.ok) factionStorageItems.value = await r1.json();
      if (r2.ok) factionBuildings.value = await r2.json();
    } catch { /* ignore */ } finally {
      factionStorageLoading.value = false;
    }
  }

  async function fetchAllPoolsStats() {
    if (allPoolsLoading.value) return;
    allPoolsLoading.value = true;
    try {
      const res = await fetch('/api/stats/all-pools');
      if (res.ok) {
        const data = await res.json();
        // New format: { pools: {...}, currentPool: "..." }
        // Old format (legacy): flat Record<string, any> — pools are direct keys
        if (data && typeof data.currentPool === 'string' && data.pools) {
          allPoolsStats.value = data.pools;
          myPoolName.value = data.currentPool;
        } else {
          // Legacy fallback
          allPoolsStats.value = data;
          myPoolName.value = Object.keys(data)[0] ?? '';
        }
      }
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

  // ── Hub (centralized UI proxy) ──
  /** vm name → connection state ('connecting' | 'online' | 'offline') */
  const vmStatuses = ref<Record<string, string>>({});
  const vmList = computed(() => Object.keys(vmStatuses.value));
  /** vm name → routine settings (received from remote VM on hub connect) */
  const vmSettings = ref<Record<string, Record<string, Record<string, unknown>>>>({});

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
  // Reactive refs — written at most every 100 ms via _flushPendingLogs (see below).
  const activityLogs = ref<string[]>([]);
  const broadcastLogs = ref<string[]>([]);
  const systemLogs = ref<string[]>([]);
  const factionLogLines = ref<string[]>([]);
  // shallowRef: avoids deep reactivity on string arrays inside the map.
  const botLogBuffers = shallowRef<Record<string, string[]>>({});
  const logs = ref<Array<{ bot: string; type: string; message: string }>>([]);

  // ── Log caps ──
  const LOG_CAP_PANEL  = 300; // activity / broadcast / system
  const LOG_CAP_FACTION = 150;
  const LOG_CAP_BOTBUF  = 100; // per-bot detail buffer
  const LOG_CAP_GLOBAL  = 500; // logs[] used in BotProfile

  // ── Log batch buffers (plain, non-reactive) ──
  const _pActivity: string[] = [];
  const _pBroadcast: string[] = [];
  const _pSystem: string[] = [];
  const _pFaction: string[] = [];
  const _pBotLogs: Record<string, string[]> = {};
  const _pLogs: Array<{ bot: string; type: string; message: string }> = [];
  let _logFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function _flushPendingLogs() {
    _logFlushTimer = null;
    if (_pActivity.length) {
      activityLogs.value = [...activityLogs.value, ..._pActivity].slice(-LOG_CAP_PANEL);
      _pActivity.length = 0;
    }
    if (_pBroadcast.length) {
      broadcastLogs.value = [...broadcastLogs.value, ..._pBroadcast].slice(-LOG_CAP_PANEL);
      _pBroadcast.length = 0;
    }
    if (_pSystem.length) {
      systemLogs.value = [...systemLogs.value, ..._pSystem].slice(-LOG_CAP_PANEL);
      _pSystem.length = 0;
    }
    if (_pFaction.length) {
      factionLogLines.value = [...factionLogLines.value, ..._pFaction].slice(-LOG_CAP_FACTION);
      _pFaction.length = 0;
    }
    if (_pLogs.length) {
      logs.value = [...logs.value, ..._pLogs].slice(-LOG_CAP_GLOBAL);
      _pLogs.length = 0;
    }
    const botKeys = Object.keys(_pBotLogs);
    if (botKeys.length) {
      const next = { ...botLogBuffers.value };
      for (const username of botKeys) {
        next[username] = [...(next[username] || []), ..._pBotLogs[username]].slice(-LOG_CAP_BOTBUF);
        delete _pBotLogs[username];
      }
      botLogBuffers.value = next;
    }
  }

  function _scheduleLogFlush() {
    if (_logFlushTimer === null) _logFlushTimer = setTimeout(_flushPendingLogs, 100);
  }

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
        if (data.vmStates && typeof data.vmStates === 'object') {
          vmStatuses.value = { ...data.vmStates as Record<string, string> };
        }
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
        if (data.logs?.activity) activityLogs.value = data.logs.activity.slice(-LOG_CAP_PANEL);
        if (data.logs?.broadcast) broadcastLogs.value = data.logs.broadcast.slice(-LOG_CAP_PANEL);
        if (data.logs?.system) systemLogs.value = data.logs.system.slice(-LOG_CAP_PANEL);
        if (data.logs?.faction) factionLogLines.value = data.logs.faction.slice(-LOG_CAP_FACTION);
        if (data.botLogs) botLogBuffers.value = data.botLogs;
        if (data.dataSyncMode) dataSyncMode.value = data.dataSyncMode;
        // Replay cached per-VM settings so clients connecting after VM init still see them
        if (data.vmSettingsSnapshot && typeof data.vmSettingsSnapshot === 'object') {
          vmSettings.value = { ...vmSettings.value, ...(data.vmSettingsSnapshot as Record<string, Record<string, Record<string, unknown>>>) };
        }
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
        // Dashboard log panels — queued and flushed every 100 ms
        if (data.panel === 'activity' && data.line) { _pActivity.push(data.line); _scheduleLogFlush(); }
        else if (data.panel === 'broadcast' && data.line) { _pBroadcast.push(data.line); _scheduleLogFlush(); }
        else if (data.panel === 'system' && data.line) { _pSystem.push(data.line); _scheduleLogFlush(); }
        // Bot-specific structured logs (used in BotProfile)
        if (data.bot && data.message) {
          _pLogs.push({ bot: data.bot, type: data.level || 'info', message: data.message });
          _scheduleLogFlush();
        }
        break;

      case 'botLog':
        // Per-bot activity log line (legacy format) — queued and flushed every 100 ms
        if (data.username && data.line) {
          if (!_pBotLogs[data.username]) _pBotLogs[data.username] = [];
          _pBotLogs[data.username].push(data.line);
          _scheduleLogFlush();
        }
        break;

      case 'factionLog':
        if (data.line) { _pFaction.push(data.line); _scheduleLogFlush(); }
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

      case 'vmStatus':
        if (data.vm && data.state) {
          vmStatuses.value = { ...vmStatuses.value, [data.vm as string]: data.state as string };
        }
        break;

      case 'vmSettings':
        if (data.vm && data.settings && typeof data.settings === 'object') {
          vmSettings.value = { ...vmSettings.value, [data.vm as string]: data.settings as Record<string, Record<string, unknown>> };
        }
        break;

      case 'gameStats':
        if (data.data && typeof data.data === 'object') gameStats.value = data.data as any;
        break;
    }
  }

  // ── Exec result handler (callback + bot data updates) ──
  function handleExecResult(msg: any) {
    // Capture dock results so Station tab can show story/condition/unread_chat
    if (msg.command === 'dock' && msg.ok && msg.bot && msg.data) {
      stationDockInfo.value = { ...stationDockInfo.value, [msg.bot]: msg.data };
    }
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
    const botVm = bots.value.find(b => b.username === botName)?.vm;
    wsSend({ type: 'exec', bot: botName, command, params, _seq: seq, ...(botVm ? { vm: botVm } : {}) });
  }

  // ── Convenience actions ──
  function getVm(username: string): string | undefined {
    return bots.value.find(b => b.username === username)?.vm;
  }

  function startBot(username: string, routine: string) {
    const vm = getVm(username);
    wsSend({ type: 'start', bot: username, routine, ...(vm ? { vm } : {}) });
  }

  function stopBot(username: string) {
    const vm = getVm(username);
    wsSend({ type: 'stop', bot: username, ...(vm ? { vm } : {}) });
  }

  function removeBot(username: string) {
    const vm = getVm(username);
    wsSend({ type: 'remove', bot: username, ...(vm ? { vm } : {}) });
  }

  function addBot(username: string, password: string) {
    wsSend({ type: 'add', username, password });
  }

  function registerBot(code: string, username: string, empire: string) {
    wsSend({ type: 'register', registration_code: code, username, empire });
  }

  function saveSettings(routine: string, s: Record<string, any>, vm?: string) {
    const msg: Record<string, any> = { type: 'saveSettings', routine, settings: s };
    if (vm) msg.vm = vm;
    wsSend(msg);
    if (!vm) {
      // Optimistically update local state
      settings.value[routine] = { ...settings.value[routine], ...s };
    } else {
      // Optimistically update remote VM settings cache
      if (!vmSettings.value[vm]) vmSettings.value[vm] = {};
      vmSettings.value[vm][routine] = { ...vmSettings.value[vm][routine], ...s };
    }
  }

  function sendChat(botName: string, channel: string, message: string) {
    wsSend({ type: 'chat', bot: botName, channel, message });
  }

  // ── Helpers ──

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
    myPoolName,
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
    // Hub (centralized UI proxy)
    vmStatuses,
    vmList,
    vmSettings,
    // Credits/hour
    botCreditsPerHour,
    // Helpers
    resolveLocation,
    catalogName,
    // Game stats (pushed from server every tick)
    gameStats,
    // Faction storage DB
    factionStorageItems,
    factionBuildings,
    factionStorageLoading,
    fetchFactionStorage,
    // Dock results (story, condition, unread_chat)
    stationDockInfo,
  };
});
