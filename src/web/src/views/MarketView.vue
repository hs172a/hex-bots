<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Tab bar -->
    <div class="flex gap-0 border-b border-space-border bg-space-card px-4 shrink-0">
      <button @click="activeTab = 'overview'" class="px-4 py-2.5 text-sm font-medium border-b-2 transition-all" :class="activeTab === 'overview' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">📊 Overview</button>
      <button @click="activeTab = 'routes'" class="px-4 py-2.5 text-sm font-medium border-b-2 transition-all" :class="activeTab === 'routes' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🔀 Routes</button>
      <button @click="activeTab = 'faction'" class="px-4 py-2.5 text-sm font-medium border-b-2 transition-all" :class="activeTab === 'faction' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🏭 Faction Storage</button>
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
          <option value="refined">Refined / Ingots</option>
          <option value="component">Components</option>
          <option value="fuel">Fuel &amp; Energy</option>
          <option value="weapon">Weapons</option>
          <option value="ship">Ships / Hulls</option>
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

    <!-- ── Routes Tab ──────────────────────────────────────────── -->
    <div v-else-if="activeTab === 'routes'" class="flex-1 flex flex-col gap-2 p-2 overflow-hidden">
      <!-- Stats -->
      <div class="grid grid-cols-4 gap-2 shrink-0">
        <div class="card p-2">
          <div class="text-xs text-space-text-dim mb-1">Routes Found</div>
          <div class="text-2xl font-bold text-space-text-bright">{{ filteredRoutes.length }}</div>
        </div>
        <div class="card p-2">
          <div class="text-xs text-space-text-dim mb-1">Best Margin</div>
          <div class="text-2xl font-bold text-space-green">{{ filteredRoutes.length ? formatNumber(filteredRoutes[0].margin) : '—' }} ₡</div>
        </div>
        <div class="card p-2">
          <div class="text-xs text-space-text-dim mb-1">Best Margin %</div>
          <div class="text-2xl font-bold text-space-cyan">{{ filteredRoutes.length ? filteredRoutes[0].marginPct.toFixed(1) : '—' }}%</div>
        </div>
        <div class="card p-2">
          <div class="text-xs text-space-text-dim mb-1">Avg Margin</div>
          <div class="text-2xl font-bold text-space-yellow">
            {{ filteredRoutes.length ? formatNumber(Math.round(filteredRoutes.reduce((s,r)=>s+r.margin,0)/filteredRoutes.length)) : '—' }} ₡
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex items-center gap-2 shrink-0">
        <input v-model="routeSearch" type="text" placeholder="Search item / station..." class="input text-xs flex-1" />
        <label class="text-xs text-space-text-dim whitespace-nowrap">Min margin:</label>
        <input v-model.number="routeMinMargin" type="number" min="0" step="50" class="input text-xs w-24" />
        <div class="flex items-center gap-1 ml-2">
          <span class="text-xs text-space-text-dim">Sort:</span>
          <button @click="routeSortKey = 'margin'" class="btn text-xs px-2 py-0.5" :class="routeSortKey==='margin' ? 'bg-space-accent/20 text-space-accent' : ''">Margin</button>
          <button @click="routeSortKey = 'marginPct'" class="btn text-xs px-2 py-0.5" :class="routeSortKey==='marginPct' ? 'bg-space-accent/20 text-space-accent' : ''">%</button>
          <button @click="routeSortKey = 'name'" class="btn text-xs px-2 py-0.5" :class="routeSortKey==='name' ? 'bg-space-accent/20 text-space-accent' : ''">Name</button>
        </div>
      </div>

      <!-- Routes table -->
      <div class="card flex flex-col flex-1 overflow-hidden">
        <div v-if="filteredRoutes.length === 0" class="flex items-center justify-center flex-1 text-space-text-dim text-sm">
          No routes with margin ≥ {{ formatNumber(routeMinMargin) }} ₡. Lower the filter or wait for more market data.
        </div>
        <div v-else class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-space-card border-b border-space-border">
              <tr class="text-left text-xs text-space-text-dim uppercase tracking-wider">
                <th class="py-2 px-3 font-semibold">Item</th>
                <th class="py-2 px-3 font-semibold">Buy @ Station</th>
                <th class="py-2 px-3 font-semibold text-right">Buy Price</th>
                <th class="py-2 px-3 font-semibold">Sell @ Station</th>
                <th class="py-2 px-3 font-semibold text-right">Sell Price</th>
                <th class="py-2 px-3 font-semibold text-right">Margin</th>
                <th class="py-2 px-3 font-semibold text-right">%</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="route in filteredRoutes" :key="route.itemId" class="border-b border-space-border hover:bg-space-row-hover transition-colors">
                <td class="px-3 py-2 text-space-text-bright font-medium">{{ route.itemName }}</td>
                <td class="px-3 py-2 text-space-text-dim text-xs">{{ route.buyStation }}</td>
                <td class="px-3 py-2 text-right text-space-yellow font-medium">{{ formatNumber(route.buyPrice) }} ₡</td>
                <td class="px-3 py-2 text-space-text-dim text-xs">{{ route.sellStation }}</td>
                <td class="px-3 py-2 text-right text-space-cyan font-medium">{{ formatNumber(route.sellPrice) }} ₡</td>
                <td class="px-3 py-2 text-right">
                  <span class="font-bold text-space-green">+{{ formatNumber(route.margin) }} ₡</span>
                </td>
                <td class="px-3 py-2 text-right">
                  <span class="font-medium" :class="route.marginPct >= 50 ? 'text-space-green' : route.marginPct >= 20 ? 'text-space-yellow' : 'text-space-text-dim'">
                    {{ route.marginPct.toFixed(1) }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div><!-- /routes tab -->

    <!-- ── Faction Storage Tab ──────────────────────────────────── -->
    <div v-else-if="activeTab === 'faction'" class="flex-1 flex flex-col gap-2 p-2 overflow-hidden">
      <!-- Stats + bot selector -->
      <div class="flex items-center justify-between shrink-0">
        <div class="flex gap-3">
          <div class="card p-2 min-w-[90px]">
            <div class="text-xs text-space-text-dim mb-1">POIs</div>
            <div class="text-xl font-bold text-space-text-bright">{{ factionStorageGroups.length }}</div>
          </div>
          <div class="card p-2 min-w-[100px]">
            <div class="text-xs text-space-text-dim mb-1">Item Types</div>
            <div class="text-xl font-bold text-space-cyan">{{ facTotalTypes }}</div>
          </div>
          <div class="card p-2 min-w-[110px]">
            <div class="text-xs text-space-text-dim mb-1">Total Units</div>
            <div class="text-xl font-bold text-space-yellow">{{ formatNumber(facTotalItems) }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-space-text-dim">Bot:</span>
          <select v-model="facBot" class="input text-xs min-w-[150px]">
            <option v-for="b in botStore.sortedBots" :key="b.username" :value="b.username">{{ b.username }}</option>
          </select>
          <button @click="botStore.fetchFactionStorage?.()" class="btn text-xs px-3 py-1">🔄 Refresh</button>
        </div>
      </div>

      <!-- Action panel -->
      <div class="card p-3 shrink-0">
        <div class="flex items-center gap-4 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-xs text-space-text-dim font-medium uppercase tracking-wider">Withdraw:</span>
            <input v-model="facWithdrawId" type="text" placeholder="item_id" class="input text-xs w-36" />
            <input v-model.number="facWithdrawQty" type="number" min="1" class="input text-xs w-20" />
            <button @click="doFacWithdraw" :disabled="facLoading || !facBot" class="btn btn-secondary text-xs px-3">Extract</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-space-text-dim font-medium uppercase tracking-wider">Deposit:</span>
            <input v-model="facDepositId" type="text" placeholder="item_id" class="input text-xs w-36" />
            <input v-model.number="facDepositQty" type="number" min="1" class="input text-xs w-20" />
            <button @click="doFacDeposit" :disabled="facLoading || !facBot" class="btn text-xs px-3">Store</button>
          </div>
          <Transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0">
            <span v-if="facActionResult" class="text-xs font-medium" :class="facActionResult.ok ? 'text-space-green' : 'text-space-red'">{{ facActionResult.msg }}</span>
          </Transition>
        </div>
      </div>

      <!-- Storage groups -->
      <div class="flex-1 overflow-auto flex flex-col gap-2">
        <div v-if="factionStorageGroups.length === 0" class="flex items-center justify-center h-24 text-space-text-dim text-sm">
          No faction storage data. Click Refresh or wait for bots to check in.
        </div>
        <div v-for="group in factionStorageGroups" :key="group.poiId" class="card">
          <!-- POI header -->
          <div class="flex items-center justify-between px-4 py-2 border-b border-space-border">
            <div>
              <span class="font-semibold text-space-text-bright">{{ group.poiName }}</span>
              <span v-if="group.systemName" class="ml-2 text-xs text-space-text-dim">{{ group.systemName }}</span>
            </div>
            <span class="text-xs text-space-text-dim">{{ group.items.length }} item type{{ group.items.length !== 1 ? 's' : '' }}</span>
          </div>
          <!-- Items grid -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-px bg-space-border">
            <div v-for="item in group.items" :key="item.item_id"
              class="flex items-center justify-between gap-2 px-3 py-2 bg-space-card hover:bg-space-row-hover transition-colors cursor-pointer"
              @click="facWithdrawId = item.item_id; facDepositId = item.item_id"
              :title="'Click to pre-fill item ID: ' + item.item_id">
              <div class="min-w-0">
                <div class="text-xs font-medium text-space-text-bright truncate">{{ item.item_name }}</div>
                <div class="text-[10px] text-space-text-dim truncate">{{ item.item_id }}</div>
              </div>
              <div class="text-sm font-bold text-space-yellow shrink-0">{{ formatNumber(item.quantity) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div><!-- /faction tab -->

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
            <div class="bg-[#0d1117f0] border border-space-border rounded-lg shadow-2xl w-full max-w-sm mx-4 p-5">
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

const activeTab = ref<'overview' | 'routes' | 'faction' | 'orders'>('overview');
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
    const ft = filterType.value;
    items = items.filter(i => {
      const n = i.item.toLowerCase();
      if (ft === 'ore') return n.includes('ore') || n.includes('mineral');
      if (ft === 'refined') return n.includes('refined') || n.includes('ingot') || n.includes('alloy') || n.includes('compound');
      if (ft === 'component') return n.includes('component') || n.includes('module') || n.includes('part') || n.includes('circuit');
      if (ft === 'fuel') return n.includes('fuel') || n.includes('energy');
      if (ft === 'weapon') return n.includes('weapon') || n.includes('laser') || n.includes('cannon') || n.includes('missile');
      if (ft === 'ship') return n.includes('ship') || n.includes('hull') || n.includes('armor');
      return n.includes(ft);
    });
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
  // Market data updates automatically via mapUpdate WebSocket messages (every 30s)
}

// ── Trade routes ─────────────────────────────────────────────

interface TradeRoute {
  itemId: string;
  itemName: string;
  buyStation: string;
  buySystem: string;
  buyPrice: number;
  sellStation: string;
  sellSystem: string;
  sellPrice: number;
  margin: number;
  marginPct: number;
}

const routeSortKey = ref<'margin' | 'marginPct' | 'name'>('margin');
const routeMinMargin = ref(100);
const routeSearch = ref('');

const tradeRoutes = computed<TradeRoute[]>(() => {
  const routes: TradeRoute[] = [];
  const itemBuys = new Map<string, { name: string; price: number; station: string; system: string }>();
  const itemSells = new Map<string, { name: string; price: number; station: string; system: string }>();

  for (const [sysId, sys] of Object.entries(botStore.mapData)) {
    const sysName = (sys as any).name || sysId;
    for (const poi of ((sys as any).pois || [])) {
      const stationLabel = `${poi.name || poi.id} (${sysName})`;
      if (!poi.market) continue;
      for (const m of poi.market) {
        if (!m.item_id) continue;
        const name = m.item_name || m.item_id;
        // Cheapest buy (buy_from_market price = best_buy)
        if (m.best_buy != null && m.best_buy > 0) {
          const cur = itemBuys.get(m.item_id);
          if (!cur || m.best_buy < cur.price) {
            itemBuys.set(m.item_id, { name, price: m.best_buy, station: stationLabel, system: sysName });
          }
        }
        // Best sell (sell_to_market price = best_sell)
        if (m.best_sell != null && m.best_sell > 0) {
          const cur = itemSells.get(m.item_id);
          if (!cur || m.best_sell > cur.price) {
            itemSells.set(m.item_id, { name, price: m.best_sell, station: stationLabel, system: sysName });
          }
        }
      }
    }
  }

  for (const [itemId, buyInfo] of itemBuys) {
    const sellInfo = itemSells.get(itemId);
    if (!sellInfo) continue;
    const margin = sellInfo.price - buyInfo.price;
    if (margin <= 0) continue;
    const marginPct = buyInfo.price > 0 ? (margin / buyInfo.price) * 100 : 0;
    routes.push({
      itemId, itemName: buyInfo.name,
      buyStation: buyInfo.station, buySystem: buyInfo.system, buyPrice: buyInfo.price,
      sellStation: sellInfo.station, sellSystem: sellInfo.system, sellPrice: sellInfo.price,
      margin, marginPct,
    });
  }

  return routes.sort((a, b) => {
    if (routeSortKey.value === 'marginPct') return b.marginPct - a.marginPct;
    if (routeSortKey.value === 'name') return a.itemName.localeCompare(b.itemName);
    return b.margin - a.margin;
  });
});

const filteredRoutes = computed(() => {
  let r = tradeRoutes.value.filter(x => x.margin >= routeMinMargin.value);
  if (routeSearch.value.trim()) {
    const q = routeSearch.value.toLowerCase();
    r = r.filter(x => x.itemName.toLowerCase().includes(q) || x.buyStation.toLowerCase().includes(q) || x.sellStation.toLowerCase().includes(q));
  }
  return r;
});

// ── Faction Storage tab ──────────────────────────────────────

interface FacStorageGroup {
  poiId: string;
  poiName: string;
  systemName: string;
  items: Array<{ item_id: string; item_name: string; quantity: number }>;
}

const facBot = ref(botStore.sortedBots[0]?.username || '');
const facWithdrawId = ref('');
const facWithdrawQty = ref(1);
const facDepositId = ref('');
const facDepositQty = ref(1);
const facActionResult = ref<{ ok: boolean; msg: string } | null>(null);
const facLoading = ref(false);

const factionStorageGroups = computed<FacStorageGroup[]>(() => {
  const items = botStore.factionStorageItems as Array<any>;
  if (!items || items.length === 0) return [];
  const byPoi = new Map<string, FacStorageGroup>();
  for (const it of items) {
    const poiId = it.poi_id || it.poiId || '';
    const poiName = it.poi_name || it.poiName || poiId;
    const systemName = it.system_name || it.systemName || '';
    if (!byPoi.has(poiId)) byPoi.set(poiId, { poiId, poiName, systemName, items: [] });
    const entry = byPoi.get(poiId)!;
    if ((it.quantity || it.qty || 0) > 0) {
      entry.items.push({
        item_id: it.item_id || it.itemId || '',
        item_name: it.item_name || it.itemName || it.item_id || '',
        quantity: it.quantity || it.qty || 0,
      });
    }
  }
  for (const g of byPoi.values()) {
    g.items.sort((a, b) => a.item_name.localeCompare(b.item_name));
  }
  return [...byPoi.values()].sort((a, b) => a.poiName.localeCompare(b.poiName));
});

const facTotalItems = computed(() =>
  factionStorageGroups.value.reduce((s, g) => s + g.items.reduce((si, i) => si + i.quantity, 0), 0)
);
const facTotalTypes = computed(() =>
  factionStorageGroups.value.reduce((s, g) => s + g.items.length, 0)
);

function facExec(command: string, params: Record<string, unknown>) {
  if (!facBot.value) return;
  facLoading.value = true;
  facActionResult.value = null;
  botStore.sendExec(facBot.value, command, params, (r: any) => {
    facLoading.value = false;
    facActionResult.value = { ok: !!r.ok, msg: r.ok ? 'Done' : (r.error || 'Failed') };
    if (r.ok) botStore.fetchFactionStorage?.();
    setTimeout(() => { facActionResult.value = null; }, 4000);
  });
}

function doFacWithdraw() {
  if (!facWithdrawId.value.trim() || facWithdrawQty.value <= 0) return;
  facExec('faction_withdraw_items', { item_id: facWithdrawId.value.trim(), quantity: facWithdrawQty.value });
}

function doFacDeposit() {
  if (!facDepositId.value.trim() || facDepositQty.value <= 0) return;
  facExec('faction_deposit_items', { item_id: facDepositId.value.trim(), quantity: facDepositQty.value });
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
