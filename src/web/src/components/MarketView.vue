<template>
  <div class="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
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
    <div class="grid grid-cols-4 gap-4">
      <div class="card p-4">
        <div class="text-xs text-space-text-dim mb-1">Total Items</div>
        <div class="text-2xl font-bold text-space-text-bright">{{ marketItems.length }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-space-text-dim mb-1">Stations</div>
        <div class="text-2xl font-bold text-space-text-bright">{{ uniqueStations }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-space-text-dim mb-1">Best Profit</div>
        <div class="text-2xl font-bold text-space-green">{{ formatNumber(bestProfit) }} ₡</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-space-text-dim mb-1">Avg Price</div>
        <div class="text-2xl font-bold text-space-yellow">{{ formatNumber(avgPrice) }} ₡</div>
      </div>
    </div>

    <!-- Market Table -->
    <div class="card flex flex-col flex-1 overflow-hidden">
      <div class="flex items-center gap-4 px-4 py-3 border-b border-space-border">
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

const searchQuery = ref('');
const filterType = ref('all');
const sortKey = ref('name');
const sortAsc = ref(true);

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
