<template>
  <div class="min-h-screen bg-space-bg text-space-text flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-3 border-b border-space-border bg-space-card">
      <div class="flex items-center gap-8">
        <h1 class="text-sm font-semibold text-space-text-bright tracking-wide py-2 flex items-center gap-2">
          <img src="/favicon.png" alt="" class="w-6 h-6">
          Hex Bots
          <span class="text-[11px] text-space-text-dim">v{{ version }}</span>
        </h1>
        
        <!-- Top tabs -->
        <div class="flex gap-0">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="switchTab(tab.id)"
            class="px-5 py-3 text-sm font-medium transition-all border-b-2"
            :class="activeTab === tab.id && !showProfile
              ? 'text-space-text-bright border-space-accent' 
              : 'text-space-text-dim border-transparent hover:text-space-text'"
          >
            <span class="text-xs">{{ tab.icon }}</span> {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Right side: block indicator + admin buttons + connection status -->
      <div class="flex items-center gap-2">

        <!-- DataSync mode badge -->
        <div
          v-if="dataSyncMode === 'master'"
          class="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-blue-700/50 bg-blue-900/20 text-blue-400"
          title="This instance is the DataSync master server"
        >
          🌐 DS Master
        </div>
        <div
          v-else-if="dataSyncMode === 'client' && !dataSyncOffline"
          class="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-cyan-700/50 bg-cyan-900/20 text-cyan-400"
          title="DataSync client — connected to master"
        >
          🔗 DS Client
        </div>

        <!-- DataSync offline warning -->
        <div
          v-if="dataSyncOffline"
          class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-red-700/60 bg-red-900/20 text-red-400 font-medium animate-pulse"
          title="DataSync cannot reach master — SSH tunnel may be down"
        >
          🔌 DataSync Offline
        </div>

        <!-- IP block warning -->
        <div
          v-if="ipBlocked"
          class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-orange-700/60 bg-orange-900/20 text-orange-400 font-medium animate-pulse"
          title="All bots are paused until the block expires"
        >
          ⛔ IP Blocked {{ blockCountdownText }}
        </div>

        <!-- Refresh map -->
        <button
          @click="adminRefreshMap"
          :disabled="refreshing.map"
          title="Force-refresh galaxy map from API"
          class="flex items-center justify-center w-7 h-7 rounded border border-space-border text-space-text-dim hover:border-space-accent hover:text-space-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span :class="refreshing.map ? 'animate-spin inline-block' : ''" style="display:inline-block">🗺️</span>
        </button>

        <!-- Refresh catalog -->
        <button
          @click="adminRefreshCatalog"
          :disabled="refreshing.catalog"
          title="Force-refresh item catalog from API"
          class="flex items-center justify-center w-7 h-7 rounded border border-space-border text-space-text-dim hover:border-space-accent hover:text-space-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span :class="refreshing.catalog ? 'animate-spin inline-block' : ''" style="display:inline-block">📦</span>
        </button>

        <!-- Sync Code (DataSync client mode only) -->
        <button
          v-if="dataSyncMode === 'client'"
          @click="adminSyncCode"
          :disabled="refreshing.code"
          :title="syncCodeResult || 'Pull source code updates from DataSync master'"
          class="flex items-center justify-center w-7 h-7 rounded border border-space-border text-space-text-dim hover:border-space-accent hover:text-space-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span :class="refreshing.code ? 'animate-spin inline-block' : ''" style="display:inline-block">🔄</span>
        </button>

        <!-- Separator -->
        <div class="w-px h-5 bg-space-border mx-1" />

        <!-- Connection status -->
        <div class="flex items-center gap-1.5 text-xs text-space-text-dim">
          <div
            class="w-2 h-2 rounded-full transition-colors"
            :class="wsConnected ? 'bg-space-green' : 'bg-space-red'"
          />
          <span>{{ wsConnected ? 'Connected' : 'Disconnected' }}</span>
        </div>

      </div>
    </header>

    <!-- Main content -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <BotProfile 
        v-if="showProfile" 
        :bot="profileBot!" 
        @close="closeProfile" 
      />
      <component v-else :is="currentTabComponent" @open-profile="openProfile" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide, reactive } from 'vue';
import { useBotStore } from './stores/botStore';
import Dashboard from './views/DashboardView.vue';
import BotProfile from './components/BotProfile.vue';
import SettingsView from './views/SettingsView.vue';
import MarketView from './views/MarketView.vue';
import MissionsView from './views/MissionsView.vue';
import FactionView from './views/FactionView.vue';
import MapView from './views/MapView.vue';
import ShipyardView from './views/ShipyardView.vue';
import CommanderView from './views/CommanderView.vue';
import { version } from '../../../package.json';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', component: Dashboard, icon: '📊' },
  { id: 'map', label: 'Map', component: MapView, icon: '🗺️' },
  { id: 'market', label: 'Market', component: MarketView, icon: '🛒' },
  { id: 'missions', label: 'Missions', component: MissionsView, icon: '🎯' },
  { id: 'faction', label: 'Faction', component: FactionView, icon: '🏛️' },
  { id: 'shipyard', label: 'Shipyard', component: ShipyardView, icon: '🛠️' },
  { id: 'commander', label: 'Commander', component: CommanderView, icon: '🧠' },
  { id: 'settings', label: 'Settings', component: SettingsView, icon: '⚙️' },
];

const activeTab = ref('dashboard');
const wsConnected = ref(false);
const showProfile = ref(false);
const profileBot = ref<any>(null);
const botStore = useBotStore();
let reconnectDelay = 1000;

// ── DataSync state ──
const dataSyncOffline = computed(() => botStore.dataSyncOffline);
const dataSyncMode = computed(() => botStore.dataSyncMode);

// ── IP block state ──
const ipBlocked = computed(() => botStore.ipBlocked);
const blockSecsLeft = ref(0);
const blockCountdownText = computed(() => {
  if (!blockSecsLeft.value) return '';
  const m = Math.floor(blockSecsLeft.value / 60);
  const s = blockSecsLeft.value % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
});
let countdownTick: ReturnType<typeof setInterval> | null = null;

// ── Admin refresh state ──
const refreshing = reactive({ catalog: false, map: false, code: false });
const syncCodeResult = ref('');

async function adminRefreshCatalog() {
  if (refreshing.catalog) return;
  refreshing.catalog = true;
  try {
    await fetch('/api/admin/refresh-catalog', { method: 'POST' });
  } finally {
    refreshing.catalog = false;
  }
}

async function adminRefreshMap() {
  if (refreshing.map) return;
  refreshing.map = true;
  try {
    await fetch('/api/admin/refresh-map', { method: 'POST' });
  } finally {
    refreshing.map = false;
  }
}

async function adminSyncCode() {
  if (refreshing.code) return;
  refreshing.code = true;
  syncCodeResult.value = '';
  try {
    const resp = await fetch('/api/sync-code', { method: 'POST' });
    const data = await resp.json() as { ok?: boolean; updated?: string[]; failed?: string[]; error?: string };
    if (data.error) {
      syncCodeResult.value = `Error: ${data.error}`;
    } else {
      const u = data.updated?.length ?? 0;
      const f = data.failed?.length ?? 0;
      syncCodeResult.value = u > 0 ? `Synced ${u} file(s)${f > 0 ? `, ${f} failed` : ''}` : 'Already up to date';
    }
  } catch (e) {
    syncCodeResult.value = 'Sync failed';
  } finally {
    refreshing.code = false;
  }
}

const currentTabComponent = computed(() => {
  return tabs.find(t => t.id === activeTab.value)?.component;
});

function switchTab(id: string) {
  if (id === 'legacy') {
    window.location.href = '/legacy_ui.html';
    return;
  }
  showProfile.value = false;
  activeTab.value = id;
}

function openProfile(username: string) {
  botStore.selectedBot = username;
  profileBot.value = botStore.bots.find(b => b.username === username);
  showProfile.value = true;
}

function closeProfile() {
  showProfile.value = false;
  botStore.selectedBot = null;
}

// Provide openProfile to child components
provide('openProfile', openProfile);

// WebSocket connection
let ws: WebSocket | null = null;

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  
  ws.onopen = () => {
    wsConnected.value = true;
    reconnectDelay = 1000;
  };
  
  ws.onclose = () => {
    wsConnected.value = false;
    setTimeout(connectWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };
  
  ws.onerror = () => {};
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      botStore.handleWebSocketMessage(data);
    } catch {}
  };
  
  (window as any).__ws = ws;
}

onMounted(() => {
  connectWebSocket();
  countdownTick = setInterval(() => {
    const endsAt = botStore.ipBlockEndsAt;
    blockSecsLeft.value = endsAt > 0 ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0;
  }, 1000);
});

onUnmounted(() => {
  ws?.close();
  if (countdownTick) clearInterval(countdownTick);
});
</script>
