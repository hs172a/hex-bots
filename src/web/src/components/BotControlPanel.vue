<template>
  <div class="flex-1 flex flex-col gap-2 py-2 px-0 overflow-hidden">
    <!-- Manual Control Panel -->
    <div class="card py-2 px-2 flex flex-col flex-1 overflow-hidden">
      <div class="py-1 px-0 border-b border-space-border bg-space-card">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">Manual Control</h3>
      </div>
      <div class="flex-1 pt-2 px-0 overflow-auto scrollbar-dark relative">
        <div v-if="commandRunning" class="absolute inset-0 z-10 bg-black/25 rounded cursor-wait pointer-events-auto"></div>
        <div class="grid grid-cols-2 gap-x-5 gap-y-2" :class="commandRunning ? 'pointer-events-none opacity-60' : ''">

          <!-- Travel -->
          <div class="flex gap-2 items-center self-start">
            <label class="text-xs text-space-text-dim w-20">Travel</label>
            <select v-model="travelPoi" class="input text-xs flex-1 !p-1">
              <option value="">Select POI...</option>
              <option v-for="poi in systemPois" :key="poi.id" :value="poi.id">
                {{ poi.name }} ({{ poi.type }})
              </option>
            </select>
            <button @click="execTravel" class="btn btn-primary text-xs px-3 py-1">Go</button>
          </div>

          <!-- Long Distance Travel -->
          <div class="flex flex-col gap-1.5">
            <div class="flex gap-2 items-center">
              <div class="relative flex-1 min-w-0">
                <input
                  type="text"
                  v-model="destSystem"
                  placeholder="Type system name or POI..."
                  class="input text-xs w-full !p-1"
                  autocomplete="off"
                  @input="onLdFocus"
                  @focus="onLdFocus"
                  @blur="onLdBlur"
                  @keyup.enter="onLdEnter"
                />
                <div
                  v-if="ldInputFocused && ldFiltered.length > 0"
                  class="absolute z-50 top-full left-0 right-0 mt-0.5 max-h-44 overflow-auto scrollbar-dark bg-[#161b22] border border-space-border rounded shadow-lg"
                >
                  <div
                    v-for="sys in ldFiltered"
                    :key="sys.id"
                    class="px-2 py-0.5 cursor-pointer text-[11px] leading-5 text-space-text hover:bg-space-accent/20 hover:text-space-accent"
                    @mousedown.prevent="selectLdSystem(sys)"
                  >{{ sys.name }}</div>
                </div>
              </div>
              <button @click="findRouteLD" :disabled="!destSystem || ldLoading" class="btn btn-primary text-xs px-3 py-1 flex-shrink-0">
                {{ ldLoading ? '⏳' : '🔍 Find Route' }}
              </button>
            </div>
            <div v-if="ldRouteError" class="text-xs text-space-red">⚠ {{ ldRouteError }}</div>
            <div v-if="ldRoute.length > 0" class="bg-[#0d1117] border border-space-border rounded p-1 space-y-2 text-[11px]">
              <div class="flex items-center gap-1">
                <span class="text-xs font-semibold text-space-text-bright shrink-0">Route: {{ ldRoute.length }} jumps</span>
                <span class="text-[11px] text-space-accent flex-1 truncate text-right">→ {{ ldRoute[ldRoute.length - 1]?.name || ldRoute[ldRoute.length - 1]?.system_id || '' }}</span>
                <button @click="ldRoute = []; ldRouteError = ''" class="text-[11px] text-space-text-dim hover:text-space-red shrink-0 ml-1">✕</button>
              </div>
              <div class="text-xs text-space-text-dim max-h-20 overflow-auto scrollbar-dark space-y-0.5">
                <div
                  v-for="(sys, i) in ldRoute.slice(0, 20)" :key="i"
                  :class="i < ldProgress ? 'text-green-400 opacity-60' : i === ldProgress && ldRelocating ? 'text-space-accent font-semibold' : 'text-space-text-dim'"
                >{{ i + 1 }}. {{ sys.name || sys.system_id || sys }}</div>
                <div v-if="ldRoute.length > 20" class="opacity-40">+{{ ldRoute.length - 20 }} more…</div>
              </div>
              <div v-if="ldRelocating" class="space-y-1">
                <div class="text-xs text-space-text-dim">{{ ldProgress }}/{{ ldRoute.length }} jumps complete</div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-green-500 rounded-full transition-all" :style="{ width: (ldProgress / ldRoute.length * 100) + '%' }"></div>
                </div>
              </div>
              <div class="flex gap-2">
                <button
                  v-if="!ldRelocating"
                  @click="ldAutoStart"
                  :disabled="ldStarting"
                  class="flex-1 btn btn-primary text-xs py-1 disabled:opacity-50"
                >{{ ldStarting ? '⏳ Starting...' : currentBot.docked ? '🚀 Undock & Jump' : '🚀 Start Jumping' }}</button>
                <button
                  v-if="ldRelocating"
                  @click="ldStopRelocation"
                  class="btn text-xs px-3 py-1 border border-space-red text-space-red hover:bg-space-red/10"
                >⏹ Stop</button>
                <span v-if="ldRelocating" class="flex-1 text-xs text-space-text-dim flex items-center">
                  Jumping to {{ ldRoute[ldProgress]?.name || ldRoute[ldProgress]?.system_id || 'destination' }}…
                </span>
              </div>
            </div>
          </div>

          <!-- Dock/Undock / Mine/Scan / Refuel/Repair -->
          <div class="flex gap-2 items-center col-span-2">
            <label class="text-xs text-space-text-dim w-20"></label>
            <button @click="execCommand('dock')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🏠 Dock</button>
            <button @click="execCommand('undock')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🚀 Undock</button>
            <button @click="execCommand('mine')" class="btn btn-secondary text-xs px-3 py-1 flex-1">⛏️ Mine</button>
            <button @click="execCommand('scan')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🔍 Scan</button>
            <button @click="execCommand('refuel')" class="btn btn-secondary text-xs px-3 py-1 flex-1">⛽ Refuel</button>
            <button @click="execCommand('repair')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🔧 Repair</button>
          </div>

          <!-- Craft -->
          <div class="flex flex-col gap-1 col-span-2">
            <div class="flex gap-2 items-center">
              <label class="text-xs text-space-text-dim w-20">Craft</label>
              <select v-model="craftRecipe" class="input text-xs flex-1 !p-1">
                <option value="">{{ craftableRecipes.length > 0 ? `Select recipe... (${craftableRecipes.length} available)` : (recipes.length > 0 ? 'No craftable recipes' : 'Loading...') }}</option>
                <option v-for="r in craftableRecipes" :key="r.id" :value="r.id">
                  {{ r.name || r.id }} {{ r.category ? `[${r.category}]` : '' }}
                </option>
              </select>
              <input v-model.number="craftQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
              <button @click="execCraft" class="btn btn-primary text-xs px-3 py-1">Craft</button>
            </div>
            <div v-if="selectedRecipeInfo" class="ml-20 bg-[#0d1117] border border-space-border rounded p-2 text-[11px]">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="font-semibold text-space-text">{{ selectedRecipeInfo.name }}</span>
                <span v-if="selectedRecipeInfo.category" class="text-space-text-dim px-1 py-0.5 bg-space-border/20 rounded text-[11px]">{{ selectedRecipeInfo.category }}</span>
              </div>
              <template v-if="selectedRecipeInfo.components?.length">
                <div class="text-space-text-dim font-semibold mb-1">Requires:</div>
                <div v-for="c in selectedRecipeInfo.components" :key="c.item_id" class="flex items-center gap-1.5 leading-5">
                  <span class="text-space-accent font-semibold w-8 text-right">{{ c.quantity || 1 }}x</span>
                  <span class="flex-1">{{ c.name || c.item_id }}</span>
                  <span class="text-space-text-dim">
                    ({{ inventory.find((i: any) => i.itemId === c.item_id || i.item_id === c.item_id)?.quantity ?? 0 }} in cargo)
                  </span>
                </div>
              </template>
              <div v-else class="text-space-text-dim">No ingredients required</div>
              <div v-if="selectedRecipeInfo.output" class="mt-1.5 pt-1.5 border-t border-space-border/50 flex items-center gap-2">
                <span class="text-space-text-dim">Output:</span>
                <span class="text-space-green font-semibold">{{ selectedRecipeInfo.output.quantity || 1 }}x {{ selectedRecipeInfo.output.name || selectedRecipeInfo.output.item_id }}</span>
              </div>
            </div>
          </div>

          <!-- Sell -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-text-dim w-20">Sell</label>
            <select v-model="sellItem" class="input text-xs flex-1 !p-1">
              <option value="">No items</option>
              <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                {{ item.name }} ({{ item.quantity }})
              </option>
            </select>
            <input v-model.number="sellQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execSell" class="btn text-xs px-3 py-1">Sell</button>
          </div>

          <!-- Buy -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-text-dim w-20">Buy</label>
            <select v-model="buyItem" class="input text-xs flex-1 !p-1">
              <option value="">No market data</option>
              <option v-for="item in marketItems" :key="item.item_id" :value="item.item_id">
                {{ item.name || item.item_id }} (₡{{ item.buy_price }})
              </option>
            </select>
            <input v-model.number="buyQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execBuy" class="btn text-xs px-3 py-1">Buy</button>
          </div>

          <!-- Deposit -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-text-dim w-20">Deposit</label>
            <select v-model="depositItem" class="input text-xs flex-1 !p-1">
              <option value="">No items</option>
              <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                {{ item.name }} ({{ item.quantity }})
              </option>
            </select>
            <input v-model.number="depositQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execDeposit" class="btn text-xs px-3 py-1">Deposit</button>
          </div>

          <!-- Withdraw -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-text-dim w-20">Withdraw</label>
            <select v-model="withdrawItem" class="input text-xs flex-1 !p-1">
              <option value="">No items</option>
              <option v-for="item in storage" :key="item.itemId" :value="item.itemId">
                {{ item.name }} ({{ item.quantity }})
              </option>
            </select>
            <input v-model.number="withdrawQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execWithdraw" class="btn text-xs px-3 py-1">Withdraw</button>
          </div>

          <!-- Faction Deposit -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-accent w-20">F.Deposit</label>
            <select v-model="factionDepositItem" class="input text-xs flex-1 !p-1">
              <option value="">No items</option>
              <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                {{ item.name }} ({{ item.quantity }})
              </option>
            </select>
            <input v-model.number="factionDepositQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execFactionDeposit" class="btn text-xs px-3 py-1 border-space-accent/50">F.Deposit</button>
          </div>

          <!-- Faction Withdraw -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-accent w-20">F.Withdraw</label>
            <select v-model="factionWithdrawItem" class="input text-xs flex-1 !p-1">
              <option value="">No items</option>
              <option v-for="item in factionStorage" :key="item.itemId" :value="item.itemId">
                {{ item.name }} ({{ item.quantity }})
              </option>
            </select>
            <input v-model.number="factionWithdrawQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execFactionWithdraw" class="btn text-xs px-3 py-1 border-space-accent/50">F.Withdraw</button>
          </div>

          <!-- Gift Item -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-text-dim w-20">Gift Item</label>
            <select v-model="giftTarget" class="input text-xs w-32 !p-1">
              <option value="">No bots</option>
              <option v-for="b in otherBots" :key="b.username" :value="b.username">
                {{ b.username }}
              </option>
            </select>
            <select v-model="giftItem" class="input text-xs flex-1 !p-1">
              <option value="">No items</option>
              <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                {{ item.name }} ({{ item.quantity }})
              </option>
            </select>
            <input v-model.number="giftQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
            <button @click="execGiftItem" class="btn text-xs px-3 py-1">Send</button>
          </div>

          <!-- Send Credits -->
          <div class="flex gap-2 items-center">
            <label class="text-xs text-space-text-dim w-20">Send Credits</label>
            <select v-model="creditsTarget" class="input text-xs flex-1 !p-1">
              <option value="">No bots</option>
              <option v-for="b in otherBots" :key="b.username" :value="b.username">
                {{ b.username }}
              </option>
            </select>
            <input v-model.number="creditsAmount" type="number" min="1" class="input text-xs w-24 !p-1 scrollbar-dark" value="100">
            <button @click="execSendCredits" class="btn text-xs px-3 py-1">Send</button>
          </div>

          <!-- Status Commands -->
          <div class="flex gap-2 items-center col-span-2">
            <label class="text-xs text-space-text-dim w-20"></label>
            <button @click="execCommand('get_status')" class="btn text-xs px-2 py-1">🚀 Status</button>
            <button @click="execCommand('get_cargo')" class="btn text-xs px-2 py-1">📦 Cargo</button>
            <button @click="execCommand('view_storage')" class="btn text-xs px-2 py-1">🏠 Storage</button>
            <button @click="execCommand('view_faction_storage')" class="btn text-xs px-2 py-1">🛡 F.Storage</button>
            <button @click="execCommand('view_market')" class="btn text-xs px-2 py-1">💰 Market</button>
            <button @click="execCommand('get_system')" class="btn text-xs px-2 py-1">🌌 System</button>
            <button @click="execCommand('get_nearby')" class="btn text-xs px-2 py-1">👁 Nearby</button>
            <button @click="refreshPublicCatalog" class="btn text-xs px-2 py-1">🔄 Catalog</button>
          </div>

          <!-- Nearby Players (shown after get_nearby) -->
          <div v-if="nearbyPlayers.length > 0" class="col-span-2 bg-[#0d1117] border border-space-border rounded p-1.5">
            <div class="text-[11px] font-semibold text-space-text-dim uppercase mb-1">Nearby ({{ nearbyPlayers.length }})</div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="p in nearbyPlayers" :key="p.username || p.id || p.name"
                class="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border"
                :class="p._pirate
                  ? 'border-space-red/40 bg-space-red/10 text-space-red'
                  : 'border-space-border bg-[#161b22] text-space-text'"
              >
                <span>{{ p._pirate ? '☠' : '👤' }}</span>
                <span>{{ p.username || p.name || p.id }}</span>
                <span v-if="p.ship_class || p.class" class="opacity-60">{{ p.ship_class || p.class }}</span>
              </span>
            </div>
          </div>

          <!-- Custom Command -->
          <div class="flex gap-2 items-center col-span-2">
            <label class="text-xs text-space-text-dim w-20">Custom</label>
            <input v-model="customCmd" type="text" placeholder="command" class="input text-xs w-32 !p-1">
            <input v-model="customParams" type="text" placeholder='{"key":"val"}' class="input text-xs flex-1 !p-1">
            <button @click="execCustom" class="btn btn-primary text-xs px-3 py-1">Run</button>
          </div>

        </div>
      </div>
    </div>

    <!-- Activity Log -->
    <div class="card py-2 px-2 flex flex-col h-56">
      <div class="flex py-1 px-0 items-center justify-between border-b border-space-border bg-space-card">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold text-space-text-dim uppercase">Activity Log</h3>
          <span v-if="lastBeltStatus" class="text-[11px] px-1.5 py-0.5 rounded font-medium"
            :class="lastBeltStatus.includes('depleted') && !lastBeltStatus.includes('resources available') ? 'bg-orange-900/30 text-orange-300' : lastBeltStatus.startsWith('Belt depleted') ? 'bg-red-900/30 text-red-300' : 'bg-amber-900/30 text-amber-300'">
            ⛏️ {{ lastBeltStatus }}
          </span>
        </div>
        <div class="flex gap-2">
          <button @click="loadFullLog" class="btn btn-secondary text-xs py-0 px-2">{{ showFullLog ? '◀ Recent' : 'Full Log ▶' }}</button>
          <button @click="clearLog" class="btn btn-secondary text-xs py-0 px-2">Clear</button>
        </div>
      </div>
      <div ref="logContainerRef" class="flex-1 overflow-auto scrollbar-dark font-mono text-xs space-y-0.5 py-1">
        <div
          v-for="(log, idx) in botLogs"
          :key="idx"
          class="leading-tight whitespace-pre-wrap text-[11px]"
          :class="{
            'text-space-red': log.type === 'error',
            'text-space-yellow': log.type === 'warn',
            'text-space-green': log.type === 'success',
            'text-space-text-dim': log.type === 'info'
          }"
        >
          {{ log.message }}
        </div>
        <div v-if="botLogs.length === 0" class="text-space-text-dim">No activity yet</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useBotStore } from '../stores/botStore';

const props = defineProps<{ bot: any }>();
const emit = defineEmits<{
  (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void;
}>();

const botStore = useBotStore();

// Form state
const travelPoi = ref('');
const destSystem = ref('');
const ldRoute = ref<any[]>([]);
const ldRouteError = ref('');
const ldInputFocused = ref(false);
let _ldBlurTimer: ReturnType<typeof setTimeout> | null = null;
const ldLoading = ref(false);
const ldRelocating = ref(false);
const ldStarting = ref(false);
const ldProgress = ref(0);
let ldTimer: ReturnType<typeof setTimeout> | null = null;
const craftRecipe = ref('');
const craftQty = ref(1);
const sellItem = ref('');
const sellQty = ref(1);
const buyItem = ref('');
const buyQty = ref(1);
const depositItem = ref('');
const depositQty = ref(1);
const withdrawItem = ref('');
const withdrawQty = ref(1);
const factionDepositItem = ref('');
const factionDepositQty = ref(1);
const factionWithdrawItem = ref('');
const factionWithdrawQty = ref(1);
const giftTarget = ref('');
const giftItem = ref('');
const giftQty = ref(1);
const creditsTarget = ref('');
const creditsAmount = ref(100);
const customCmd = ref('');
const customParams = ref('');

// Data state
const systemPois = ref<any[]>([]);
const nearbyPlayers = ref<any[]>([]);
const marketItems = ref<any[]>([]);
const recipes = ref<any[]>([]);
let lastCatalogType = '';

// Computed
const currentBot = computed(() => {
  const bot = botStore.bots.find(b => b.username === props.bot.username);
  return bot || props.bot;
});

const inventory = computed(() => [...(currentBot.value.inventory || [])].sort((a: any, b: any) => (a.name || a.itemId).localeCompare(b.name || b.itemId)));
const storage = computed(() => [...(currentBot.value.storage || [])].sort((a: any, b: any) => (a.name || a.itemId).localeCompare(b.name || b.itemId)));
const factionStorage = computed(() => [...(currentBot.value.factionStorage || [])].sort((a: any, b: any) => (a.name || a.itemId).localeCompare(b.name || b.itemId)));

const otherBots = computed(() =>
  botStore.bots.filter(b => b.username !== currentBot.value.username)
);

const cargoFree = computed(() => {
  const max = currentBot.value.cargoMax ?? 0;
  const used = currentBot.value.cargo ?? 0;
  return Math.max(0, max - used);
});

watch(sellItem, (itemId) => {
  if (!itemId) return;
  const item = inventory.value.find((i: any) => i.itemId === itemId);
  if (item) sellQty.value = item.quantity;
});
watch(depositItem, (itemId) => {
  if (!itemId) return;
  const item = inventory.value.find((i: any) => i.itemId === itemId);
  if (item) depositQty.value = item.quantity;
});
watch(withdrawItem, (itemId) => {
  if (!itemId) return;
  const item = storage.value.find((i: any) => i.itemId === itemId);
  if (item) withdrawQty.value = cargoFree.value > 0 ? Math.min(item.quantity, cargoFree.value) : item.quantity;
});
watch(factionDepositItem, (itemId) => {
  if (!itemId) return;
  const item = inventory.value.find((i: any) => i.itemId === itemId);
  if (item) factionDepositQty.value = item.quantity;
});
watch(factionWithdrawItem, (itemId) => {
  if (!itemId) return;
  const item = factionStorage.value.find((i: any) => i.itemId === itemId);
  if (item) factionWithdrawQty.value = cargoFree.value > 0 ? Math.min(item.quantity, cargoFree.value) : item.quantity;
});
watch(giftItem, (itemId) => {
  if (!itemId) return;
  const item = inventory.value.find((i: any) => i.itemId === itemId);
  if (item) giftQty.value = item.quantity;
});

const showFullLog = ref(false);
const commandRunning = ref(false);
const logContainerRef = ref<HTMLElement | null>(null);
const botLogs = computed(() => {
  const filtered = botStore.logs.filter(log => log.bot === currentBot.value.username);
  return showFullLog.value ? filtered : filtered.slice(-100);
});

const lastBeltStatus = computed(() => {
  const all = botLogs.value;
  for (let i = all.length - 1; i >= 0; i--) {
    const msg = (all[i].message || '') as string;
    if (msg.includes('Belt:') && msg.includes('resources available')) {
      const idx = msg.indexOf('Belt:');
      return idx >= 0 ? msg.slice(idx) : msg;
    }
    if (msg.includes('Belt depleted') && (msg.includes('waiting') || msg.includes('respawn'))) {
      const idx = msg.indexOf('Belt depleted');
      return idx >= 0 ? msg.slice(idx) : msg;
    }
  }
  return '';
});

function scrollToBottom() {
  nextTick(() => {
    if (logContainerRef.value) logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight;
  });
}
watch(() => botLogs.value.length, scrollToBottom);
defineExpose({ scrollToBottom });

const knownSystems = computed(() => {
  const systems: any[] = [];
  for (const [id, sys] of Object.entries(botStore.mapData)) {
    if (id !== currentBot.value.system) {
      systems.push({ id, name: (sys as any).name || id });
    }
  }
  return systems;
});

const ldFiltered = computed(() => {
  const q = destSystem.value.trim().toLowerCase();
  return knownSystems.value
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
});

function execCommand(command: string, params?: any) {
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  commandRunning.value = true;
  let logRef: any = null;
  if (command !== 'catalog') {
    (botStore.logs as any[]).push({
      bot: username,
      type: 'info',
      message: `Executing: ${command}${params ? ' ' + JSON.stringify(params) : ''}`,
    });
    logRef = (botStore.logs as any[])[(botStore.logs as any[]).length - 1];
  }
  botStore.sendExec(username, command, params, (result: any) => {
    commandRunning.value = false;
    const data = result.result ?? result.data;
    if (logRef) {
      if (result.ok) {
        logRef.type = 'success';
        logRef.message += ' — OK';
        pushDetailLines(command, data, username);
      } else {
        const errMsg = result.error || 'Unknown error';
        logRef.type = 'error';
        logRef.message += ` — ❌ ${errMsg}`;
        emit('notif', errMsg, 'error');
      }
      logRef = null;
    }
    if (result.ok) processExecResult(command, data);
  });
}

function pushDetailLines(command: string, data: any, username: string): void {
  if (!data) return;
  const push = (msg: string) => (botStore.logs as any[]).push({ bot: username, type: 'info', message: msg });
  switch (command) {
    case 'get_system': {
      const sys = data.system || data;
      push(`System: ${sys.name || sys.id} (${sys.id || ''})`);
      const pois = sys.pois || sys.points_of_interest || [];
      push(`POIs (${pois.length}):`);
      for (const poi of pois) push(`  ${poi.name} [${poi.type}]`);
      const conns = sys.connections || [];
      push(`Connections (${conns.length}):`);
      for (const conn of conns) push(`  -> ${conn.name || conn.system_id}`);
      break;
    }
    case 'get_nearby': {
      const nearby = data.nearby || [];
      const pirates = data.pirates || [];
      push(`nearby: [${nearby.map((p: any) => p.username || p.name).join(', ')}]`);
      push(`pirates: [${pirates.map((p: any) => p.username || p.name).join(', ')}]`);
      push(`count: ${nearby.length}`);
      push(`pirate_count: ${pirates.length}`);
      push(`poi_id: ${data.poi_id || '?'}`);
      break;
    }
    case 'get_status': {
      const player = data.player || data;
      const ship = data.ship || {};
      const credits = player.credits != null ? `₡${Number(player.credits).toLocaleString()}` : '?';
      const docked = player.docked_at_base ? 'Yes' : (player.docked ? 'Yes' : 'No');
      const system = player.current_system || player.system || '?';
      const poi = player.current_poi || player.poi_id || '';
      push(`credits: ${credits} | docked: ${docked} | ${poi ? `poi: ${poi} | ` : ''}system: ${system}`);
      const hull = ship.hull ?? ship.hp;
      const maxHull = ship.max_hull ?? ship.max_hp;
      const shield = ship.shield ?? ship.shields;
      const maxShield = ship.max_shield;
      const fuel = ship.fuel;
      const maxFuel = ship.max_fuel;
      const cargo = ship.cargo_used;
      const cargoMax = ship.cargo_capacity ?? ship.max_cargo;
      const shipName = ship.name || '?';
      const shipClass = ship.class_id || '';
      push(`ship: ${shipName}${shipClass ? ` (${shipClass})` : ''} | hull: ${hull ?? '?'}/${maxHull ?? '?'} | shield: ${shield ?? '?'}/${maxShield ?? '?'} | fuel: ${fuel ?? '?'}/${maxFuel ?? '?'} | cargo: ${cargo ?? '?'}/${cargoMax ?? '?'}`);
      break;
    }
    case 'view_faction_storage': {
      const items = data.items || data.storage || data.faction_storage || [];
      push(`faction storage (${items.length} types):`);
      for (const item of items) push(`  ${item.quantity}x ${item.name || item.item_id}`);
      break;
    }
    case 'get_cargo': {
      const items = data.items || data.cargo || [];
      push(`cargo (${items.length} types):`);
      for (const item of items) push(`  ${item.quantity}x ${item.name || item.item_id}`);
      break;
    }
    case 'view_storage': {
      const items = data.items || data.storage || [];
      push(`storage (${items.length} types):`);
      for (const item of items) push(`  ${item.quantity}x ${item.name || item.item_id}`);
      break;
    }
    case 'view_market': {
      const items = data.market || data.items || data.listings || [];
      push(`market (${items.length} items):`);
      for (const item of items.slice(0, 20)) push(`  ${item.name || item.item_id}: buy ₡${item.buy_price ?? '?'} sell ₡${item.sell_price ?? '?'}`);
      if (items.length > 20) push(`  ...and ${items.length - 20} more`);
      break;
    }
    default:
      if (data && typeof data === 'object') {
        const skip = new Set(['notifications', 'session']);
        for (const [k, v] of Object.entries(data)) {
          if (skip.has(k)) continue;
          push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        }
      }
  }
}


function execAsync(command: string, params?: any): Promise<any> {
  return new Promise((resolve) => {
    const username = currentBot.value?.username;
    if (!username) return resolve({ ok: false, error: 'No bot selected' });
    botStore.sendExec(username, command, params, (result: any) => resolve(result));
  });
}

function processExecResult(command: string, data: any) {
  if (!data) return;
  switch (command) {
    case 'get_status': {
      const player = data.player || data;
      const ship = data.ship || {};
      const upd: Record<string, any> = {};
      if (player.credits != null) upd.credits = player.credits;
      if (ship.fuel != null) upd.fuel = ship.fuel;
      if (ship.max_fuel != null) upd.maxFuel = ship.max_fuel;
      const hull = ship.hull ?? ship.hp;
      if (hull != null) upd.hull = hull;
      const maxHull = ship.max_hull ?? ship.max_hp;
      if (maxHull != null) upd.maxHull = maxHull;
      const shield = ship.shield ?? ship.shields;
      if (shield != null) upd.shield = shield;
      if (ship.cargo_used != null) upd.cargo = ship.cargo_used;
      const cargoMax = ship.cargo_capacity ?? ship.max_cargo;
      if (cargoMax != null) upd.cargoMax = cargoMax;
      if (player.docked_at_base !== undefined) upd.docked = !!player.docked_at_base;
      else if (player.docked !== undefined) upd.docked = player.docked;
      if (player.current_system) upd.system = player.current_system;
      const poi = player.current_poi ?? player.poi_id;
      if (poi) upd.poi = poi;
      if (Object.keys(upd).length) updateBotInStore(upd);
      break;
    }
    case 'get_cargo': {
      const rawItems = data.items || data.cargo || [];
      updateBotInStore({
        inventory: rawItems.map((i: any) => ({
          itemId: i.item_id || i.id || '',
          name: i.name || i.item_id || '',
          quantity: i.quantity ?? 0,
        }))
      });
      break;
    }
    case 'view_storage': {
      const rawItems = data.items || data.storage || [];
      updateBotInStore({
        storage: rawItems.map((i: any) => ({
          itemId: i.item_id || i.id || '',
          name: i.name || i.item_id || '',
          quantity: i.quantity ?? 0,
        }))
      });
      break;
    }
    case 'view_faction_storage': {
      const rawItems = data.items || data.storage || data.faction_storage || [];
      updateBotInStore({
        factionStorage: rawItems.map((i: any) => ({
          itemId: i.item_id || i.id || '',
          name: i.name || i.item_id || '',
          quantity: i.quantity ?? 0,
        }))
      });
      break;
    }
    case 'get_system': {
      const pois = data.system?.pois || data.pois || data.points_of_interest || [];
      if (pois.length > 0) systemPois.value = pois;
      break;
    }
    case 'get_nearby': {
      const nearby = data.nearby || [];
      const pirates = (data.pirates || []).map((p: any) => ({ ...p, _pirate: true }));
      nearbyPlayers.value = [...nearby, ...pirates];
      break;
    }
    case 'view_market': {
      const items = data.market || data.items || data.listings || (Array.isArray(data) ? data : []);
      marketItems.value = [...items]
        .map((i: any) => ({ ...i, name: i.name || botStore.catalogName(i.item_id) }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      break;
    }
    case 'catalog': {
      if (lastCatalogType === 'recipes') {
        const pageItems = extractRecipes(data);
        recipes.value = [...recipes.value, ...pageItems];
        const totalPages = data.total_pages || 1;
        const currentPage = data.page || 1;
        if (currentPage < totalPages && pageItems.length > 0) {
          execCommand('catalog', { type: 'recipes', page: currentPage + 1, page_size: 50 });
        }
      }
      break;
    }
  }
}

function updateBotInStore(partial: Record<string, any>): void {
  const idx = botStore.bots.findIndex(b => b.username === currentBot.value.username);
  if (idx !== -1) Object.assign(botStore.bots[idx], partial);
}

function extractRecipes(data: any): any[] {
  const items = data.items || data.recipes || (Array.isArray(data) ? data : []);
  return items.map((r: any) => ({
    id: r.recipe_id || r.id || r.item_id,
    name: r.name || r.recipe_name || r.recipe_id || r.id,
    category: r.category || '',
    components: r.components || r.ingredients || r.inputs || r.requires || [],
    output: r.output || r.result_item || null,
  }));
}

const craftableRecipes = computed(() => {
  const inv = inventory.value;
  return recipes.value
    .filter(r => {
      if (!r.components?.length) return true;
      return r.components.every((comp: any) => {
        const item = inv.find((i: any) => i.itemId === comp.item_id || i.item_id === comp.item_id);
        return item && (item.quantity ?? 0) >= (comp.quantity || 1);
      });
    })
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
});

const selectedRecipeInfo = computed(() =>
  craftRecipe.value ? recipes.value.find(r => r.id === craftRecipe.value) ?? null : null
);

// Travel
async function execTravel() {
  if (!travelPoi.value) return;
  execCommand('travel', { target_poi: travelPoi.value });
}

function onLdFocus() {
  if (_ldBlurTimer) { clearTimeout(_ldBlurTimer); _ldBlurTimer = null; }
  ldInputFocused.value = true;
}
function onLdBlur() {
  _ldBlurTimer = setTimeout(() => { ldInputFocused.value = false; }, 200);
}
function onLdEnter() {
  ldInputFocused.value = false;
  findRouteLD();
}
function selectLdSystem(sys: any) {
  destSystem.value = sys.name || sys.id;
  ldInputFocused.value = false;
}

// Long Distance Travel
async function findRouteLD() {
  if (!destSystem.value) return;
  ldLoading.value = true;
  ldRouteError.value = '';
  ldRoute.value = [];

  const searchRes = await execAsync('search_systems', { query: destSystem.value });
  const systems = searchRes.data?.systems || searchRes.data || [];
  if (!systems.length) {
    ldRouteError.value = `System "${destSystem.value}" not found`;
    ldLoading.value = false;
    return;
  }

  // Sort by relevance: exact name match > starts-with > substring
  const q = destSystem.value.trim().toLowerCase();
  const sorted = [...systems].sort((a: any, b: any) => {
    const an = (a.name || '').toLowerCase();
    const bn = (b.name || '').toLowerCase();
    const rank = (n: string) => n === q ? 0 : n.startsWith(q) ? 1 : 2;
    return rank(an) - rank(bn);
  });
  const targetId = sorted[0].system_id || sorted[0].id || sorted[0].name;
  const routeRes = await execAsync('find_route', { target_system: targetId });
  const route = routeRes.data?.route || routeRes.data || [];
  if (!route.length) {
    ldRouteError.value = routeRes.error?.message || 'No route found';
    ldLoading.value = false;
    return;
  }

  ldRoute.value = route.slice(1);
  ldProgress.value = 0;
  ldLoading.value = false;
}

async function ldAutoStart() {
  if (ldStarting.value || ldRelocating.value || !ldRoute.value.length) return;
  // Guard: if the bot just received a stop signal, wait briefly for it to settle
  const botState = (currentBot.value as any).state;
  if (botState === 'stopping') {
    ldRouteError.value = 'Bot is still stopping — please wait a moment and try again';
    return;
  }
  ldStarting.value = true;
  if (currentBot.value.docked) {
    await execAsync('undock');
    await new Promise(r => setTimeout(r, 1500));
  }
  ldStartRelocation();
  ldStarting.value = false;
}

function ldStartRelocation() {
  if (!ldRoute.value.length) return;
  ldRelocating.value = true;
  ldProgress.value = 0;
  ldDoRelocationStep();
}

function ldStopRelocation() {
  ldRelocating.value = false;
  if (ldTimer) { clearTimeout(ldTimer); ldTimer = null; }
}

async function ldDoRelocationStep() {
  if (!ldRelocating.value) return;
  const route = ldRoute.value;
  if (ldProgress.value >= route.length) { ldRelocating.value = false; return; }
  const next = route[ldProgress.value];
  const systemId = next.system_id || next.id || next;
  const res = await execAsync('jump', { target_system: systemId });

  // Abort on unrecoverable jump errors — bot is likely in the wrong position
  if (res && !res.ok) {
    const errMsg = (res.error?.message || res.error || '').toString().toLowerCase();
    const isFatal =
      errMsg.includes('not connected') ||
      errMsg.includes('not found') ||
      errMsg.includes('invalid system') ||
      errMsg.includes('no route') ||
      errMsg.includes('stopped');
    if (isFatal) {
      ldRelocating.value = false;
      ldRouteError.value = `Jump failed: ${res.error?.message || res.error} — route may be stale, please recalculate`;
      return;
    }
    // Transient errors (fuel, docked, action_pending) — retry same hop after delay
    ldTimer = setTimeout(() => ldDoRelocationStep(), 15000);
    return;
  }

  ldProgress.value++;
  if (ldProgress.value < route.length && ldRelocating.value) {
    ldTimer = setTimeout(() => ldDoRelocationStep(), 12000);
  } else {
    ldRelocating.value = false;
  }
}

// Exec actions
function refreshPublicCatalog() {
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  commandRunning.value = true;
  botStore.wsSend({ type: 'refreshCatalog' });
  setTimeout(() => { commandRunning.value = false; }, 5000);
}

function execCraft() { if (craftRecipe.value) execCommand('craft', { recipe_id: craftRecipe.value, count: craftQty.value }); }
function execSell() { if (sellItem.value) execCommand('sell', { item_id: sellItem.value, quantity: sellQty.value }); }
function execBuy() { if (buyItem.value) execCommand('buy', { item_id: buyItem.value, quantity: buyQty.value }); }
function execDeposit() { if (depositItem.value) execCommand('deposit_items', { item_id: depositItem.value, quantity: depositQty.value }); }
function execWithdraw() { if (withdrawItem.value) execCommand('withdraw_items', { item_id: withdrawItem.value, quantity: withdrawQty.value }); }
function execFactionDeposit() { if (factionDepositItem.value) execCommand('faction_deposit_items', { item_id: factionDepositItem.value, quantity: factionDepositQty.value }); }
function execFactionWithdraw() { if (factionWithdrawItem.value) execCommand('faction_withdraw_items', { item_id: factionWithdrawItem.value, quantity: factionWithdrawQty.value }); }
function execGiftItem() { if (giftTarget.value && giftItem.value) execCommand('send_gift', { recipient: giftTarget.value, item_id: giftItem.value, quantity: giftQty.value }); }
function execSendCredits() { if (creditsTarget.value) execCommand('send_gift', { recipient: creditsTarget.value, credits: creditsAmount.value }); }

async function execCustom() {
  if (!customCmd.value) return;
  let params = undefined;
  if (customParams.value.trim()) {
    try { params = JSON.parse(customParams.value); }
    catch { alert('Invalid JSON parameters'); return; }
  }
  execCommand(customCmd.value, params);
}

function clearLog() {
  botStore.logs = botStore.logs.filter(log => log.bot !== currentBot.value.username);
}

function loadFullLog() {
  showFullLog.value = !showFullLog.value;
}

function fetchRecipes() {
  recipes.value = [];
  lastCatalogType = 'recipes';
  execCommand('catalog', { type: 'recipes', page: 1, page_size: 50 });
}

onMounted(() => {
  if (currentBot.value.system) execCommand('get_system');
  if (currentBot.value.docked) execCommand('view_market');
  fetchRecipes();
  const currentSystem = botStore.mapData[currentBot.value.system];
  if (currentSystem) systemPois.value = (currentSystem as any).pois || [];
  scrollToBottom();
});
</script>
