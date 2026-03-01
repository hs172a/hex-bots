<template>
  <div class="min-h-screen bg-space-bg text-space-text flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-3 border-b border-space-border bg-space-card">
      <div class="flex items-center gap-8">
        <h1 class="text-sm font-semibold text-space-text-bright tracking-wide py-2 flex items-center gap-2">
          <img src="/favicon.png" alt="" class="w-6 h-6">
          Hex Bots
          <span class="text-[10px] text-space-text-dim">v{{ version }}</span>
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

      <!-- Connection status -->
      <div class="flex items-center gap-3.5">
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
import { ref, computed, onMounted, onUnmounted, provide } from 'vue';
import { useBotStore } from './stores/botStore';
import Dashboard from './components/Dashboard.vue';
import BotProfile from './components/BotProfile.vue';
import SettingsView from './components/SettingsView.vue';
import MarketView from './components/MarketView.vue';
import MissionsView from './components/MissionsView.vue';
import StatsView from './components/StatsView.vue';
import FactionView from './components/FactionView.vue';
import MapView from './components/MapView.vue';
import ShipyardView from './components/ShipyardView.vue';
import { version } from '../../../package.json';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', component: Dashboard, icon: '📊' },
  { id: 'map', label: 'Map', component: MapView, icon: '🗺️' },
  { id: 'market', label: 'Market', component: MarketView, icon: '🛒' },
  { id: 'missions', label: 'Missions', component: MissionsView, icon: '🎯' },
  { id: 'faction', label: 'Faction', component: FactionView, icon: '🏛️' },
  { id: 'shipyard', label: 'Shipyard', component: ShipyardView, icon: '🛠️' },
  { id: 'stats', label: 'Stats', component: StatsView, icon: '📊' },
  { id: 'settings', label: 'Settings', component: SettingsView, icon: '⚙️' },
];

const activeTab = ref('dashboard');
const wsConnected = ref(false);
const showProfile = ref(false);
const profileBot = ref<any>(null);
const botStore = useBotStore();
let reconnectDelay = 1000;

const currentTabComponent = computed(() => {
  return tabs.find(t => t.id === activeTab.value)?.component;
});

function switchTab(id: string) {
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
});

onUnmounted(() => {
  ws?.close();
});
</script>
