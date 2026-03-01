<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Fleet Stats Bar -->
    <div class="flex gap-4 m-2 px-3 py-2 bg-space-card border border-space-border rounded-lg">
      <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider self-center mr-2">
        Fleet Stats
      </span>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ activeBots }}</span>
        <span class="text-xs text-space-text-dim">Active Bots</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(fleetCredits) }}</span>
        <span class="text-xs text-space-text-dim">Fleet Credits</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalMined) }}</span>
        <span class="text-xs text-space-text-dim">Ores Mined</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalCrafted) }}</span>
        <span class="text-xs text-space-text-dim">Items Crafted</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalSystems) }}</span>
        <span class="text-xs text-space-text-dim">Explored</span>
      </div>
    </div>

    <!-- Bot table card -->
    <div class="card overflow-hidden flex flex-col mx-2 px-3 py-2">
      <div class="flex items-center justify-between pb-2 border-b border-space-border">
        <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">
          Bots ({{ botStore.bots.length }})
        </span>
        <div class="flex gap-2">
          <button @click="showAddBot = true" class="btn btn-primary px-2 py-1 text-xs">
            Add Bot
          </button>
        </div>
      </div>

      <!-- Bot table -->
      <div class="flex-1 overflow-auto mt-2 p-0">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-space-card border-b border-space-border">
            <tr class="text-left text-xs text-space-text-dim uppercase tracking-wider">
              <th class="py-2 px-0 font-semibold">Name</th>
              <th class="py-2 px-0 font-semibold">Ship</th>
              <th class="py-2 px-0 font-semibold">State</th>
              <th class="py-2 px-0 font-semibold">Credits</th>
              <th class="py-2 px-0 font-semibold">Fuel</th>
              <th class="py-2 px-0 font-semibold">Hull</th>
              <th class="py-2 px-0 font-semibold">Shield</th>
              <th class="py-2 px-0 font-semibold">Cargo</th>
              <th class="py-2 px-0 font-semibold">Location</th>
              <th class="py-2 px-0 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="bot in botStore.bots"
              :key="bot.username"
              class="border-b border-space-border hover:bg-space-row-hover transition-colors cursor-pointer"
              @click="selectBot(bot.username)"
            >
              <td class="px-0 py-1">
                <span class="text-space-accent font-medium">{{ bot.username }}</span>
              </td>
              <td class="px-0 py-1 text-space-text-dim">
                {{ bot.shipName || bot.ship || 'Unknown' }}
              </td>
              <td class="px-0 py-1">
                <span 
                  class="badge"
                  :class="{
                    'badge-green': bot.state === 'running',
                    'badge-yellow': bot.state === 'stopped' || bot.state === 'idle',
                    'badge-red': bot.state === 'error'
                  }"
                >
                  {{ bot.state === 'running' && bot.routine ? bot.routine : bot.state }}
                </span>
              </td>
              <td class="px-0 py-1">
                <span class="text-space-yellow">{{ formatNumber(bot.credits) }}</span>
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.fuel" 
                  :max="bot.maxFuel" 
                  color="cyan"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.hull" 
                  :max="bot.maxHull" 
                  color="red"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.shield" 
                  :max="bot.maxShield" 
                  color="cyan"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.cargo" 
                  :max="bot.cargoMax" 
                  color="magenta"
                />
              </td>
              <td class="px-0 py-1 text-space-cyan">
                {{ bot.poi ? botStore.resolveLocation(bot.system || '', bot.poi) : (botStore.resolveLocation(bot.system || '') || bot.location) }}
              </td>
              <td class="px-0 py-1">
                <div class="flex gap-1 items-center">
                  <template v-if="bot.state !== 'running' && bot.state !== 'stopping'">
                    <select 
                      :id="'routine-' + bot.username"
                      @click.stop
                      class="input text-[11px] px-1 py-0.5"
                    >
                      <option v-for="r in botStore.routines" :key="r" :value="r">{{ r }}</option>
                    </select>
                    <button 
                      @click.stop="startBotInline(bot.username)"
                      class="btn btn-primary text-xs py-0.5 px-2"
                    >Start</button>
                  </template>
                  <button 
                    v-if="bot.state === 'running'"
                    @click.stop="stopBot(bot.username)"
                    class="btn-danger text-xs py-0.5 px-2"
                  >Stop</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Scrollable content wrapper -->
    <div class="flex-1 overflow-auto p-2 pb-0 space-y-4">
      <!-- Log panels (Activity, Broadcast, System) -->
      <div class="grid grid-cols-3 gap-2 h-64">
      <div class="card flex flex-col overflow-hidden p-3">
        <div class="text-xs font-semibold text-space-text-dim uppercase tracking-wider pb-2 border-b border-space-border">
          Activity Log
        </div>
        <div class="flex-1 overflow-auto mt-2 pr-1 font-mono text-xs space-y-0.5 scrollbar-dark">
          <div 
            v-for="(log, idx) in botStore.activityLogs.slice().reverse()" 
            :key="idx"
            class="leading-tight text-space-text-dim text-[0.8em]"
          >
            {{ log }}
          </div>
        </div>
      </div>
      
      <div class="card flex flex-col overflow-hidden p-3">
        <div class="text-xs font-semibold text-space-text-dim uppercase tracking-wider pb-2 border-b border-space-border">
          Broadcast / Chat
        </div>
        <div class="flex-1 overflow-auto mt-2 pr-1 font-mono text-xs space-y-0.5 scrollbar-dark">
          <div 
            v-for="(log, idx) in botStore.broadcastLogs.slice().reverse()" 
            :key="idx"
            class="leading-tight text-space-cyan text-[0.8em]"
          >
            {{ log }}
          </div>
        </div>
      </div>
      
      <div class="card flex flex-col overflow-hidden p-3">
        <div class="text-xs font-semibold text-space-text-dim uppercase tracking-wider pb-2 border-b border-space-border">
          System Messages
        </div>
        <div class="flex-1 overflow-auto mt-2 pr-1 font-mono text-xs space-y-0.5 scrollbar-dark">
          <div 
            v-for="(log, idx) in botStore.systemLogs.slice().reverse()" 
            :key="idx"
            class="leading-tight text-[0.8em]"
            :class="{
              'text-space-red': log.includes('error') || log.includes('failed'),
              'text-space-yellow': log.includes('warning'),
              'text-space-green': log.includes('success'),
              'text-space-text-dim': true
            }"
          >
            {{ log }}
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- Chat bar -->
    <div class="flex gap-2 p-4 bg-space-card border-t border-space-border">
      <select v-model="selectedChatBot" class="input text-xs px-2 py-1">
        <option value="">Select Bot</option>
        <option v-for="bot in botStore.bots" :key="bot.username" :value="bot.username">
          {{ bot.username }}
        </option>
      </select>
      <select v-model="chatChannel" class="input text-xs px-2 py-1">
        <option value="system">System</option>
        <option value="local">Local</option>
        <option value="faction">Faction</option>
      </select>
      <input 
        v-model="chatMessage" 
        @keydown.enter="sendChat"
        type="text" 
        placeholder="Type a message..." 
        class="flex-1 input text-xs px-2 py-1"
      />
      <button @click="sendChat" class="btn btn-primary text-xs px-3 py-1">
        Send
      </button>
    </div>

    <!-- Add Bot Modal -->
    <div v-if="showAddBot" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showAddBot = false">
      <div class="bg-space-card border border-space-border rounded-lg p-6 w-96">
        <h3 class="text-lg font-semibold text-space-text-bright mb-4">Add New Bot</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Username</label>
            <input v-model="newBot.username" type="text" class="input w-full" />
          </div>
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Password</label>
            <input v-model="newBot.password" type="password" class="input w-full" />
          </div>
        </div>
        <div class="flex gap-2 mt-6">
          <button @click="addBot" class="btn btn-primary flex-1">Add Bot</button>
          <button @click="showAddBot = false" class="btn flex-1">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Start Bot Modal -->
    <div v-if="showStartBot" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showStartBot = false">
      <div class="bg-space-card border border-space-border rounded-lg p-6 w-[32rem]">
        <h3 class="text-lg font-semibold text-space-text-bright mb-4">
          Start Bot: {{ startBotData.username }}
        </h3>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-space-text-dim mb-2">Select Routine</label>
            <div class="grid grid-cols-2 gap-2">
              <div 
                v-for="routine in availableRoutines" 
                :key="routine.id"
                @click="startBotData.routine = routine.id"
                class="p-3 border rounded cursor-pointer transition-colors"
                :class="{
                  'border-space-accent bg-space-accent bg-opacity-10': startBotData.routine === routine.id,
                  'border-space-border hover:border-space-accent hover:bg-space-row-hover': startBotData.routine !== routine.id
                }"
              >
                <div class="text-sm font-medium text-space-text-bright mb-1">{{ routine.name }}</div>
                <div class="text-xs text-space-text-dim">{{ routine.description }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-6">
          <button @click="startBot" class="btn btn-primary flex-1">Start Bot</button>
          <button @click="showStartBot = false" class="btn flex-1">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBotStore } from '../stores/botStore';
import ProgressBar from './ProgressBar.vue';

const emit = defineEmits<{
  (e: 'open-profile', username: string): void;
}>();

const botStore = useBotStore();
const showAddBot = ref(false);
const showStartBot = ref(false);
const newBot = ref({ username: '', password: '' });
const startBotData = ref({ username: '', routine: 'miner' });
const selectedChatBot = ref('');
const chatChannel = ref('system');
const chatMessage = ref('');

const availableRoutines = computed(() => 
  botStore.routines.map(r => ({ id: r, name: r, description: '' }))
);

const activeBots = computed(() => botStore.bots.filter(b => b.state === 'running').length);
const fleetCredits = computed(() => botStore.bots.reduce((sum, b) => sum + b.credits, 0));
const totalMined = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalMined || 0), 0));
const totalCrafted = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalCrafted || 0), 0));
const totalSystems = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalSystems || 0), 0));

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function selectBot(username: string) {
  emit('open-profile', username);
}

function openStartBotModal(username: string) {
  startBotData.value = { username, routine: 'miner' };
  showStartBot.value = true;
}

async function startBot() {
  if (!startBotData.value.username || !startBotData.value.routine) return;
  
  try {
    await botStore.startBot(startBotData.value.username, startBotData.value.routine);
    showStartBot.value = false;
  } catch (err) {
    console.error('Failed to start bot:', err);
  }
}

function startBotInline(username: string) {
  const sel = document.getElementById(`routine-${username}`) as HTMLSelectElement | null;
  const routine = sel?.value || 'miner';
  botStore.startBot(username, routine);
}

async function stopBot(username: string) {
  botStore.stopBot(username);
}

async function addBot() {
  if (!newBot.value.username || !newBot.value.password) return;
  
  try {
    botStore.addBot(newBot.value.username, newBot.value.password);
    showAddBot.value = false;
    newBot.value = { username: '', password: '' };
  } catch (err) {
    console.error('Failed to add bot:', err);
  }
}

async function sendChat() {
  if (!chatMessage.value || !selectedChatBot.value) return;
  
  try {
    botStore.sendChat(selectedChatBot.value, chatChannel.value, chatMessage.value);
    chatMessage.value = '';
  } catch (err) {
    console.error('Failed to send chat:', err);
  }
}
</script>
