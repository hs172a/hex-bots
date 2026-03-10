<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Tab bar -->
    <div class="flex gap-0 border-b border-space-border bg-space-card px-4 shrink-0">
      <button @click="activeTab = 'overview'" class="px-4 py-2.5 text-sm font-medium border-b-2 transition-all" :class="activeTab === 'overview' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">📊 Overview</button>
      <button @click="activeTab = 'orders'" class="px-4 py-2.5 text-sm font-medium border-b-2 transition-all" :class="activeTab === 'orders' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">📋 My Orders</button>
    </div>

    <!-- ── Overview Tab ─────────────────────────────────────── -->
    <div v-if="activeTab === 'overview'" class="flex-1 flex flex-col gap-2 p-2 overflow-hidden">
    <!-- Market Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-space-text-bright">Market Overview</h2>
      <div class="flex gap-2">
        <button @click="refreshMarket" class="btn text-xs px-3 py-1">
          Refresh Data
        </button>
      </div>
    </div>

    <!-- Market Stats -->
    <div class="grid grid-cols-4 gap-2">
      <div class="card p-2">
        <div class="text-xs text-space-text-dim mb-1">Total Items</div>
        <div class="text-2xl font-bold text-space-text-bright">{{ marketItems.length }}</div>
      </div>
      <div class="card p-2">
        <div class="text-xs text-space-text-dim mb-1">Stations</div>
        <div class="text-2xl font-bold text-space-text-bright">{{ uniqueStations }}</div>
      </div>
      <div class="card p-2">
        <div class="text-xs text-space-text-dim mb-1">Best Profit</div>
        <div class="text-2xl font-bold text-space-green">{{ formatNumber(bestProfit) }} ₡</div>
      </div>
      <div class="card p-2">
        <div class="text-xs text-space-text-dim mb-1">Avg Price</div>
        <div class="text-2xl font-bold text-space-yellow">{{ formatNumber(avgPrice) }} ₡</div>
      </div>
    </div>

    <!-- Market Table -->
    <div class="card flex flex-col flex-1 overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-space-border">
        <input 
          v-model="searchQuery"
          type="text" 
          placeholder="Search items..." 
          class="input text-xs flex-1"
        />
        <select v-model="filterType" class="input text-xs">
          <option value="all">All Types</option>
          <option value="ore">Ores</option>
          <option value="component">Components</option>
          <option value="fuel">Fuel</option>
          <option value="weapon">Weapons</option>
        </select>
        <button @click="refreshMarket" class="btn text-xs px-3 py-1">
          Refresh Data
        </button>
      </div>

      <div class="flex-1 overflow-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-space-card border-b border-space-border">
            <tr class="text-left text-xs text-space-text-dim uppercase tracking-wider">
              <th @click="sortMarketBy('name')" class="py-2 px-3 font-semibold cursor-pointer hover:text-space-accent">Item{{ getSortArrow('name') }}</th>
              <th @click="sortMarketBy('bestSell')" class="py-2 px-3 font-semibold text-right cursor-pointer hover:text-space-accent">Best Sell{{ getSortArrow('bestSell') }}</th>
              <th class="py-2 px-3 font-semibold">Station</th>
              <th @click="sortMarketBy('sellQty')" class="py-2 px-3 font-semibold text-right cursor-pointer hover:text-space-accent">Sell Orders{{ getSortArrow('sellQty') }}</th>
              <th @click="sortMarketBy('bestBuy')" class="py-2 px-3 font-semibold text-right cursor-pointer hover:text-space-accent">Cheapest Buy{{ getSortArrow('bestBuy') }}</th>
              <th class="py-2 px-3 font-semibold">Station</th>
              <th @click="sortMarketBy('buyQty')" class="py-2 px-3 font-semibold text-right cursor-pointer hover:text-space-accent">Buy Orders{{ getSortArrow('buyQty') }}</th>
              <th @click="sortMarketBy('spread')" class="py-2 px-3 font-semibold text-right cursor-pointer hover:text-space-accent">Spread{{ getSortArrow('spread') }}</th>
              <th @click="sortMarketBy('stations')" class="py-2 px-3 font-semibold text-right cursor-pointer hover:text-space-accent"># Stations{{ getSortArrow('stations') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filteredMarketItems"
              :key="item.item"
              class="border-b border-space-border hover:bg-space-row-hover transition-colors"
            >
              <td class="px-3 py-2">
                <span class="text-space-text-bright font-medium">{{ item.item }}</span>
              </td>
              <td class="px-3 py-2 text-right text-space-text-dim">
                {{ item.bestSell > 0 ? formatNumber(item.bestSell) : '-' }}
              </td>
              <td class="px-3 py-2 text-space-text-dim text-xs">
                {{ item.sellStation || '-' }}
              </td>
              <td class="px-3 py-2 text-right text-space-cyan">
                {{ item.sellOrderQty > 0 ? item.sellOrderQty : '-' }}
              </td>
              <td class="px-3 py-2 text-right text-space-yellow font-medium">
                {{ item.cheapestBuy > 0 ? formatNumber(item.cheapestBuy) + ' ₡' : '-' }}
              </td>
              <td class="px-3 py-2 text-space-text-dim text-xs">
                {{ item.buyStation || '-' }}
              </td>
              <td class="px-3 py-2 text-right text-space-magenta">
                {{ item.buyOrderQty > 0 ? item.buyOrderQty : '-' }}
              </td>
              <td class="px-3 py-2 text-right">
                <span 
                  v-if="item.spread !== 0"
                  :class="item.spread > 0 ? 'text-space-green' : 'text-space-red'"
                  class="font-medium"
                >
                  {{ item.spread > 0 ? '+' : '' }}{{ formatNumber(item.spread) }} ₡
                </span>
                <span v-else class="text-space-text-dim">-</span>
              </td>
              <td class="px-3 py-2 text-right text-space-text-dim">
                {{ item.numStations }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </div><!-- /overview tab -->

    <!-- ── My Orders Tab ────────────────────────────────────── -->
    <div v-else-if="activeTab === 'orders'" class="flex-1 flex flex-col gap-2 p-2 overflow-hidden">
      <!-- Controls -->
      <div class="flex items-center gap-2 shrink-0">
        <h2 class="text-lg font-semibold text-space-text-bright">My Orders</h2>
        <select v-model="orderBot" class="input text-xs min-w-[160px]">
          <option v-for="b in botStore.sortedBots" :key="b.username" :value="b.username">{{ b.username }}</option>
        </select>
        <button @click="loadOrders" :disabled="ordersLoading || !orderBot" class="btn btn-secondary text-xs px-3">
          {{ ordersLoading ? '⏳' : '🔄 Load' }}
        </button>
        <span v-if="orders.length > 0" class="text-xs text-space-text-dim">{{ orders.length }} order{{ orders.length !== 1 ? 's' : '' }}</span>
      </div>

      <!-- Orders table -->
      <div class="card flex flex-col flex-1 overflow-hidden">
        <div v-if="!ordersLoaded" class="flex items-center justify-center h-32 text-center">
          <div class="text-space-text-dim text-sm">Select a bot and click Load to view active orders.</div>
        </div>
        <div v-else-if="ordersLoading" class="flex items-center justify-center h-32 text-space-text-dim text-sm">Loading…</div>
        <div v-else-if="orders.length === 0" class="flex items-center justify-center h-32 text-center">
          <div><div class="text-2xl mb-2">📋</div><div class="text-space-text-dim text-sm">No active orders for {{ orderBot }}.</div></div>
        </div>
        <div v-else class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-space-card border-b border-space-border">
              <tr class="text-left text-xs text-space-text-dim uppercase tracking-wider">
                <th class="py-2 px-3 font-semibold">Type</th>
                <th class="py-2 px-3 font-semibold">Item</th>
                <th class="py-2 px-3 font-semibold text-right">Qty</th>
                <th class="py-2 px-3 font-semibold text-right">Price</th>
                <th class="py-2 px-3 font-semibold">Station</th>
                <th class="py-2 px-3 font-semibold text-right">Total</th>
                <th class="py-2 px-3 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in orders" :key="order.id" class="border-b border-space-border hover:bg-space-row-hover transition-colors">
                <td class="px-3 py-2">
                  <span class="px-1.5 py-0.5 rounded text-[11px] font-medium"
                    :class="order.type === 'buy' ? 'bg-blue-900/40 text-blue-300' : 'bg-green-900/40 text-green-300'">
                    {{ order.type === 'buy' ? '🛒 BUY' : '💰 SELL' }}
                  </span>
                </td>
                <td class="px-3 py-2 text-space-text-bright font-medium">{{ order.item_name || order.item_id }}</td>
                <td class="px-3 py-2 text-right text-space-text">{{ formatNumber(order.quantity) }}</td>
                <td class="px-3 py-2 text-right">
                  <div v-if="editingOrder?.id === order.id" class="flex items-center gap-1 justify-end">
                    <input v-model.number="editingOrder.price" type="number" min="1" class="input text-xs w-24 py-0.5 text-right" @keydown.enter="saveOrderPrice(order)" @keydown.escape="editingOrder = null" />
                    <button @click="saveOrderPrice(order)" :disabled="modifyingId === order.id" class="btn btn-primary text-[11px] py-0.5 px-2">{{ modifyingId === order.id ? '⏳' : '✓' }}</button>
                    <button @click="editingOrder = null" class="text-space-text-dim hover:text-space-text text-xs px-1">✕</button>
                  </div>
                  <div v-else class="flex items-center gap-1 justify-end">
                    <span class="text-space-yellow">{{ formatNumber(order.price_each ?? order.price ?? 0) }} ₡</span>
                    <button @click="startEditPrice(order)" class="text-space-text-dim hover:text-space-accent text-xs ml-1" title="Edit price">✏️</button>
                  </div>
                </td>
                <td class="px-3 py-2 text-space-text-dim text-xs">{{ order.station_name || order.base_name || order.location || '—' }}</td>
                <td class="px-3 py-2 text-right text-space-text-dim text-xs">{{ formatNumber((order.price_each ?? order.price ?? 0) * order.quantity) }} ₡</td>
                <td class="px-3 py-2 text-center">
                  <button @click="confirmCancel(order)" :disabled="cancellingId === order.id"
                    class="btn text-[11px] px-2 py-0.5 bg-red-900/40 text-red-300 hover:bg-red-900/70 border-red-700/40"
                    title="Cancel order">
                    {{ cancellingId === order.id ? '⏳' : '✕ Cancel' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Cancel confirmation modal -->
      <Teleport to="body">
        <Transition enter-active-class="transition-opacity duration-150" enter-from-class="opacity-0" enter-to-class="opacity-100"
          leave-active-class="transition-opacity duration-100" leave-from-class="opacity-100" leave-to-class="opacity-0">
          <div v-if="cancelTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="cancelTarget = null">
            <div class="bg-[#0d1117] border border-space-border rounded-lg shadow-2xl w-full max-w-sm mx-4 p-5">
              <h3 class="text-sm font-semibold text-space-text-bright mb-2">Cancel Order</h3>
              <p class="text-xs text-space-text-dim mb-4">
                Cancel <span class="text-space-text-bright">{{ cancelTarget.type === 'buy' ? 'BUY' : 'SELL' }}</span> order for
                <span class="text-space-text-bright">{{ formatNumber(cancelTarget.quantity) }}x {{ cancelTarget.item_name || cancelTarget.item_id }}</span>
                @ <span class="text-space-yellow">{{ formatNumber(cancelTarget.price_each ?? cancelTarget.price ?? 0) }} ₡</span>?
              </p>
              <div class="flex justify-end gap-2">
                <button @click="cancelTarget = null" class="btn btn-secondary text-xs px-4">Keep</button>
                <button @click="doCancel" :disabled="cancellingId !== null" class="btn text-xs px-4 bg-red-900/60 text-red-300 hover:bg-red-900/90 border-red-700/50">
                  {{ cancellingId ? '⏳ Cancelling…' : 'Cancel Order' }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>
    </div><!-- /orders tab -->

  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

const botStore = useBotStore();

interface MarketItem {
  item: string;
  bestSell: number;
  sellStation: string;
  sellOrderQty: number;
  cheapestBuy: number;
  buyStation: string;
  buyOrderQty: number;
  spread: number;
  numStations: number;
}

const activeTab = ref<'overview' | 'orders'>('overview');
const searchQuery = ref('');
const filterType = ref('all');
const sortKey = ref('name');
const sortAsc = ref(true);

// ── Orders tab state ──────────────────────────────────────────

interface Order {
  id: string;
  type: 'buy' | 'sell';
  item_id: string;
  item_name?: string;
  quantity: number;
  price_each?: number;
  price?: number;
  station_name?: string;
  base_name?: string;
  location?: string;
}

const orderBot = ref(botStore.sortedBots[0]?.username || '');
const orders = ref<Order[]>([]);
const ordersLoading = ref(false);
const ordersLoaded = ref(false);
const editingOrder = ref<{ id: string; price: number } | null>(null);
const cancelTarget = ref<Order | null>(null);
const cancellingId = ref<string | null>(null);
const modifyingId = ref<string | null>(null);

function execOrderCmd(command: string, params?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise(resolve => {
    botStore.sendExec(orderBot.value, command, params || {}, (r: any) => resolve(r));
  });
}

async function loadOrders() {
  if (!orderBot.value) return;
  ordersLoading.value = true;
  ordersLoaded.value = false;
  const r = await execOrderCmd('view_orders');
  ordersLoading.value = false;
  ordersLoaded.value = true;
  if (r.ok && r.data) {
    const d = r.data as any;
    const raw: any[] = Array.isArray(d) ? d
      : Array.isArray(d.orders) ? d.orders
      : Array.isArray(d.buy_orders || d.sell_orders)
        ? [...(d.buy_orders || []).map((o: any) => ({ ...o, type: 'buy' })), ...(d.sell_orders || []).map((o: any) => ({ ...o, type: 'sell' }))]
      : [];
    orders.value = raw.map((o: any) => ({
      id: o.id || o.order_id || String(Math.random()),
      type: o.type || (o.order_type?.toLowerCase().includes('buy') ? 'buy' : 'sell'),
      item_id: o.item_id || '',
      item_name: o.item_name || o.name || o.item_id || '',
      quantity: o.quantity || o.amount || 0,
      price_each: o.price_each || o.price_per_unit || o.price || 0,
      price: o.price || o.price_each || 0,
      station_name: o.station_name || o.base_name || o.location || '',
    }));
  } else {
    orders.value = [];
  }
}

function startEditPrice(order: Order) {
  editingOrder.value = { id: order.id, price: order.price_each ?? order.price ?? 0 };
}

async function saveOrderPrice(order: Order) {
  if (!editingOrder.value) return;
  const newPrice = editingOrder.value.price;
  modifyingId.value = order.id;
  const r = await execOrderCmd('modify_order', { order_id: order.id, price_each: newPrice });
  modifyingId.value = null;
  if (r.ok) {
    order.price_each = newPrice;
    order.price = newPrice;
    editingOrder.value = null;
  }
}

function confirmCancel(order: Order) {
  cancelTarget.value = order;
}

async function doCancel() {
  if (!cancelTarget.value) return;
  cancellingId.value = cancelTarget.value.id;
  const r = await execOrderCmd('cancel_order', { order_id: cancelTarget.value.id });
  if (r.ok) {
    orders.value = orders.value.filter(o => o.id !== cancelTarget.value!.id);
  }
  cancellingId.value = null;
  cancelTarget.value = null;
}

// Реальні market data з mapData (як в старому UI)
const marketItems = computed<MarketItem[]>(() => {
  const itemMap = new Map<string, {
    name: string;
    stations: Array<{ sysId: string; sysName: string; stationName: string; buy: number | null; sell: number | null }>;
    buyOrderQty: number;
    sellOrderQty: number;
  }>();

  // Collect all market + order data across all stations
  for (const [sysId, sys] of Object.entries(botStore.mapData)) {
    const sysName = (sys as any).name || sysId;
    for (const poi of ((sys as any).pois || [])) {
      const stationName = poi.name || poi.id;
      
      if (poi.market && poi.market.length > 0) {
        for (const m of poi.market) {
          if (!m.item_id) continue;
          if (!itemMap.has(m.item_id)) {
            itemMap.set(m.item_id, {
              name: m.item_name || m.item_id,
              stations: [],
              buyOrderQty: 0,
              sellOrderQty: 0
            });
          }
          const entry = itemMap.get(m.item_id)!;
          entry.stations.push({
            sysId,
            sysName,
            stationName,
            buy: m.best_buy,
            sell: m.best_sell
          });
          // Підтримка різних назв полів з backend
          entry.buyOrderQty += (m.buy_quantity || m.buy_orders || m.buyQuantity || 0);
          entry.sellOrderQty += (m.sell_quantity || m.sell_orders || m.sellQuantity || 0);
        }
      }
    }
  }

  // Build rows
  const rows: MarketItem[] = [];
  for (const [itemId, data] of itemMap) {
    let bestSell: number | null = null, bestSellStation = '';
    for (const s of data.stations) {
      if (s.sell != null && (bestSell === null || s.sell > bestSell)) {
        bestSell = s.sell;
        bestSellStation = `${s.stationName} (${s.sysName})`;
      }
    }

    let bestBuy: number | null = null, bestBuyStation = '';
    for (const s of data.stations) {
      if (s.buy != null && s.buy > 0 && (bestBuy === null || s.buy < bestBuy)) {
        bestBuy = s.buy;
        bestBuyStation = `${s.stationName} (${s.sysName})`;
      }
    }

    const spread = (bestSell != null && bestBuy != null) ? bestSell - bestBuy : 0;

    rows.push({
      item: data.name,
      bestSell: bestSell || 0,
      sellStation: bestSellStation,
      sellOrderQty: data.sellOrderQty,
      cheapestBuy: bestBuy || 0,
      buyStation: bestBuyStation,
      buyOrderQty: data.buyOrderQty,
      spread: spread,
      numStations: data.stations.length
    });
  }

  return rows;
});

const filteredMarketItems = computed(() => {
  let items = [...marketItems.value];
  
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter(i => 
      i.item.toLowerCase().includes(query) || 
      i.sellStation.toLowerCase().includes(query) ||
      i.buyStation.toLowerCase().includes(query)
    );
  }
  
  if (filterType.value !== 'all') {
    items = items.filter(i => i.item.toLowerCase().includes(filterType.value));
  }
  
  // Sort
  items = [...items].sort((a, b) => {
    let av: any, bv: any;
    switch (sortKey.value) {
      case 'name': av = a.item.toLowerCase(); bv = b.item.toLowerCase(); break;
      case 'bestSell': av = a.bestSell ?? -1; bv = b.bestSell ?? -1; break;
      case 'bestBuy': av = a.cheapestBuy ?? Infinity; bv = b.cheapestBuy ?? Infinity; break;
      case 'spread': av = a.spread ?? -Infinity; bv = b.spread ?? -Infinity; break;
      case 'buyQty': av = a.buyOrderQty; bv = b.buyOrderQty; break;
      case 'sellQty': av = a.sellOrderQty; bv = b.sellOrderQty; break;
      case 'stations': av = a.numStations; bv = b.numStations; break;
      default: av = a.item; bv = b.item;
    }
    if (av < bv) return sortAsc.value ? -1 : 1;
    if (av > bv) return sortAsc.value ? 1 : -1;
    return 0;
  });
  
  return items;
});

const uniqueStations = computed(() => {
  const stationSet = new Set<string>();
  for (const [sysId, sys] of Object.entries(botStore.mapData)) {
    for (const poi of ((sys as any).pois || [])) {
      if (poi.market && poi.market.length > 0) {
        stationSet.add(`${sysId}:${poi.id}`);
      }
    }
  }
  return stationSet.size;
});

const bestProfit = computed(() => {
  return Math.max(...marketItems.value.filter(i => i.spread > 0).map(i => i.spread), 0);
});

const avgPrice = computed(() => {
  const validPrices = marketItems.value.filter(i => i.cheapestBuy > 0);
  if (validPrices.length === 0) return 0;
  return Math.round(validPrices.reduce((sum, i) => sum + i.cheapestBuy, 0) / validPrices.length);
});

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function refreshMarket() {
  console.log('Market data updates automatically via mapUpdate WebSocket messages');
  // Market data оновлюється автоматично через mapUpdate повідомлення від backend
  // Backend періодично відправляє mapUpdate кожні 30 секунд
}

function sortMarketBy(key: string) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    sortAsc.value = key === 'name'; // name defaults ascending, numbers descending
  }
}

function getSortArrow(key: string): string {
  return sortKey.value === key ? (sortAsc.value ? ' ▲' : ' ▼') : '';
}
</script>
