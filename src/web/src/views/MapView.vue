<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Tab bar -->
    <div class="flex border-b border-space-border bg-space-card px-3 shrink-0">
        <button v-for="t in ['galaxy', 'explorer', 'analytics']" :key="t" @click="mapTab = t"
        class="px-4 py-2 text-xs font-medium border-b-2 transition-all capitalize"
        :class="mapTab === t ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">
        {{ t === 'galaxy' ? '🗺️ Galaxy Map' : t === 'explorer' ? '📋 Explorer Data' : '📈 Analytics' }}
      </button>
    </div>

    <!-- Galaxy canvas tab -->
    <GalaxyMapCanvas v-if="mapTab === 'galaxy'" class="flex-1" />

    <!-- Explorer Data tab -->
    <div v-if="mapTab === 'explorer'" class="flex-1 min-h-0 flex gap-2 p-2 overflow-hidden">
    <!-- Filters Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Galaxy Map</h3>
      </div>
      <!-- Stats -->
      <div class="px-3 py-2 border-b border-space-border text-xs text-space-text-dim flex flex-wrap gap-2">
        <span>Systems: <span class="text-space-text font-semibold">{{ totalSystems }}</span></span>
        <span>POIs: <span class="text-space-text font-semibold">{{ totalPois }}</span></span>
        <span>Stations: <span class="text-space-text font-semibold">{{ totalStations }}</span></span>
      </div>
      <!-- Filters -->
      <div class="flex-1 overflow-auto p-3 space-y-3 scrollbar-dark">
        <div>
          <label class="block text-xs text-space-text-dim mb-1">Search System / POI</label>
          <input v-model="searchQuery" type="text" placeholder="System or POI name..." class="input w-full text-xs" />
        </div>
        <div>
          <label class="block text-xs text-space-text-dim mb-1">Security Level</label>
          <select v-model="secFilter" class="input w-full text-xs">
            <option value="">All</option>
            <option value="high">High Security</option>
            <option value="medium">Medium Security</option>
            <option value="low">Low Security</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-space-text-dim mb-1">Sort By</label>
          <select v-model="sortBy" class="input w-full text-xs">
            <option value="name">Name</option>
            <option value="updated">Last Updated</option>
            <option value="pois">Most POIs</option>
            <option value="security">Security Level</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Map Content -->
    <div class="flex-1 min-h-0 bg-space-card border border-space-border rounded-lg overflow-auto p-3 scrollbar-dark">
      <div v-if="displayedSystems.length === 0" class="text-center text-space-text-dim italic py-10">
        {{ totalSystems === 0 ? 'No map data yet. Start a bot to begin exploring!' : 'No systems match your filters' }}
      </div>

      <!-- System Cards -->
      <div v-for="sys in displayedSystems" :key="sys.id" 
        class="border border-space-border rounded-lg mb-2 overflow-hidden transition-colors"
        :class="expanded.has(sys.id) ? 'border-space-accent' : 'hover:border-[#484f58]'"
      >
        <!-- System Header -->
        <div @click="toggleExpand(sys.id)" class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none bg-[rgba(255,255,255,0.02)] hover:bg-space-row-hover transition-colors">
          <span class="text-[11px] text-space-text-dim w-4 text-center transition-transform" :class="expanded.has(sys.id) ? 'rotate-90' : ''">&#9654;</span>
          <span class="text-sm font-semibold text-space-text-bright">{{ sys.name || sys.id }}</span>
          <span v-html="secBadge(sys.security_level)" class="flex-shrink-0"></span>
          <div class="text-xs text-space-text-dim ml-auto flex gap-3 flex-shrink-0">
            <span>{{ (sys.pois || []).length }} POI{{ (sys.pois || []).length !== 1 ? 's' : '' }}</span>
            <span>{{ (sys.connections || []).length }} jump{{ (sys.connections || []).length !== 1 ? 's' : '' }}</span>
          </div>
          <span class="text-[11px] text-space-text-dim opacity-70">{{ timeAgo(sys.last_updated) }}</span>
        </div>

        <!-- System Body (expanded) -->
        <div v-if="expanded.has(sys.id)" class="border-t border-space-border px-3 py-3">
          <!-- Connections -->
          <div v-if="sys.connections?.length" class="flex flex-wrap gap-1 items-center mb-3 text-xs">
            <span class="font-semibold text-space-text-dim uppercase text-[11px] tracking-wider mr-1">Connections</span>
            <span v-for="c in [...(sys.connections || [])].sort((a, b) => (a.system_name || a.system_id || a.id || '').localeCompare(b.system_name || b.system_id || b.id || ''))" :key="c.system_id || c.id" class="px-2 py-0.5 rounded-full bg-[#21262d] text-space-text text-xs">
              {{ c.system_name || c.system_id || c.id }}
            </span>
          </div>

          <!-- POIs (sorted alphabetically by name) -->
          <div v-for="poi in [...(sys.pois || [])].sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || ''))" :key="poi.id" class="bg-space-bg border border-[#21262d] rounded-md p-2.5 mb-2 last:mb-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-semibold text-space-text">{{ poi.name || poi.id }}</span>
              <span class="text-[11px] px-1.5 py-0.5 rounded-lg bg-[#21262d] text-space-text-dim">{{ poi.type }}</span>
              <span v-if="poi.has_base" class="text-xs text-space-cyan font-medium">{{ poi.base_name || 'Station' }}</span>
            </div>
            <!-- Ores -->
            <div v-if="poi.ores_found?.length" class="mt-1.5">
              <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-1">Resources Mined</div>
              <div class="flex flex-wrap gap-1">
                <span v-for="ore in [...poi.ores_found].sort((a,b) => (a.name||'').localeCompare(b.name||''))" :key="ore.item_id" class="text-[11px] px-1.5 py-0.5 rounded-lg bg-[#0d2818] text-space-green">
                  {{ ore.name }} x{{ ore.total_mined }}
                </span>
              </div>
            </div>
            <!-- Market (first 5) -->
            <div v-if="poi.market?.length" class="mt-1.5">
              <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-1">Market Prices</div>
              <table class="w-full text-xs border-collapse">
                <thead><tr class="text-[11px] text-space-text-dim uppercase">
                  <th class="text-left py-0.5 px-1">Item</th><th class="text-left py-0.5 px-1">Buy</th><th class="text-left py-0.5 px-1">Sell</th>
                </tr></thead>
                <tbody>
                  <tr v-for="m in poi.market.slice(0, 5)" :key="m.item_id" class="border-b border-[#161b22] last:border-b-0">
                    <td class="py-0.5 px-1">{{ m.item_name || m.item_id }}</td>
                    <td class="py-0.5 px-1 text-space-green">{{ m.best_buy != null ? fmt(m.best_buy) + ' cr' : '-' }}</td>
                    <td class="py-0.5 px-1 text-space-yellow">{{ m.best_sell != null ? fmt(m.best_sell) + ' cr' : '-' }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="poi.market.length > 5" class="text-[11px] text-space-accent mt-0.5">+{{ poi.market.length - 5 }} more items</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>

    <!-- Analytics tab -->
    <div v-if="mapTab === 'analytics'" class="flex-1 overflow-auto p-3 space-y-4 scrollbar-dark">
      <!-- Summary row -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div class="card py-2 px-3">
          <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-0.5">Systems explored</div>
          <div class="text-2xl font-bold text-space-text-bright">{{ totalSystems }}</div>
        </div>
        <div class="card py-2 px-3">
          <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-0.5">Total POIs</div>
          <div class="text-2xl font-bold text-space-text-bright">{{ totalPois }}</div>
        </div>
        <div class="card py-2 px-3">
          <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-0.5">Faction buildings</div>
          <div class="text-2xl font-bold text-yellow-400">{{ (botStore.factionBuildings || []).length }}</div>
        </div>
        <div class="card py-2 px-3">
          <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-0.5">Factions tracked</div>
          <div class="text-2xl font-bold text-purple-400">{{ factionBuildingStats.length }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <!-- Buildings per faction -->
        <div class="card py-2 px-3">
          <h3 class="text-xs font-semibold text-space-text-bright mb-3">🏛 Buildings per Faction</h3>
          <div v-if="!factionBuildingStats.length" class="text-xs text-space-text-dim italic">No faction buildings recorded yet.</div>
          <div v-else class="space-y-1.5">
            <div v-for="f in factionBuildingStats" :key="f.faction_id" class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                :style="{ backgroundColor: f.color || '#7c3aed' }"></div>
              <span class="text-xs text-space-text min-w-[120px] truncate">{{ f.name }}</span>
              <div class="flex-1 h-2 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all"
                  :style="{ width: (f.count / factionBuildingStats[0].count * 100) + '%', backgroundColor: f.color || '#7c3aed' }"></div>
              </div>
              <span class="text-xs text-space-text-dim shrink-0 w-8 text-right">{{ f.count }}</span>
            </div>
          </div>
        </div>

        <!-- Top systems by building count -->
        <div class="card py-2 px-3">
          <h3 class="text-xs font-semibold text-space-text-bright mb-3">🏗️ Top Systems by Buildings</h3>
          <div v-if="!topBuildingSystems.length" class="text-xs text-space-text-dim italic">No faction buildings recorded yet.</div>
          <div v-else class="space-y-1.5">
            <div v-for="s in topBuildingSystems" :key="s.system_id" class="flex items-center gap-2">
              <span class="text-xs text-space-text min-w-[120px] truncate">{{ s.system_name }}</span>
              <div class="flex-1 h-2 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full bg-yellow-500 rounded-full transition-all"
                  :style="{ width: (s.count / topBuildingSystems[0].count * 100) + '%' }"></div>
              </div>
              <span class="text-xs text-space-text-dim shrink-0 w-8 text-right">{{ s.count }}</span>
            </div>
          </div>
        </div>

        <!-- Building types breakdown -->
        <div class="card py-2 px-3">
          <h3 class="text-xs font-semibold text-space-text-bright mb-3">⚙️ Building Types</h3>
          <div v-if="!buildingTypeStats.length" class="text-xs text-space-text-dim italic">No faction buildings recorded yet.</div>
          <div v-else class="space-y-1.5">
            <div v-for="t in buildingTypeStats" :key="t.type" class="flex items-center gap-2">
              <span class="text-xs text-space-text min-w-[140px] truncate">{{ t.type }}</span>
              <div class="flex-1 h-2 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full bg-space-accent rounded-full transition-all"
                  :style="{ width: (t.count / buildingTypeStats[0].count * 100) + '%' }"></div>
              </div>
              <span class="text-xs text-space-text-dim shrink-0 w-8 text-right">{{ t.count }}</span>
            </div>
          </div>
        </div>

        <!-- Security level breakdown -->
        <div class="card py-2 px-3">
          <h3 class="text-xs font-semibold text-space-text-bright mb-3">🛡️ Systems by Security</h3>
          <div class="space-y-1.5">
            <div v-for="s in securityStats" :key="s.level" class="flex items-center gap-2">
              <span class="text-xs min-w-[100px]" :class="s.cls">{{ s.label }}</span>
              <div class="flex-1 h-2 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" :class="s.barCls"
                  :style="{ width: totalSystems > 0 ? (s.count / totalSystems * 100) + '%' : '0%' }"></div>
              </div>
              <span class="text-xs text-space-text-dim shrink-0 w-8 text-right">{{ s.count }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';
import GalaxyMapCanvas from '../components/GalaxyMapCanvas.vue';

const mapTab = ref('galaxy');
const botStore = useBotStore();

const searchQuery = ref('');
const secFilter = ref('');
const sortBy = ref('name');
const expanded = ref(new Set<string>());

function toggleExpand(sysId: string) {
  if (expanded.value.has(sysId)) expanded.value.delete(sysId);
  else expanded.value.add(sysId);
}

function fmt(n: number): string { return new Intl.NumberFormat().format(n); }

function timeAgo(isoStr: string): string {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function secBadge(level: string): string {
  if (!level) return '<span class="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-[#21262d] text-[#8b949e]">Unknown</span>';
  const lc = level.toLowerCase();
  if (lc.includes('high') || lc.includes('safe')) return `<span class="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-[#0d2818] text-[#3fb950]">${level}</span>`;
  if (lc.includes('low') || lc.includes('danger')) return `<span class="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-[#2d0000] text-[#f85149]">${level}</span>`;
  return `<span class="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-[#2d1b00] text-[#d29922]">${level}</span>`;
}

function secOrder(level: string): number {
  if (!level) return 3;
  const lc = level.toLowerCase();
  if (lc.includes('high') || lc.includes('safe')) return 0;
  if (lc.includes('low') || lc.includes('danger')) return 2;
  return 1;
}

const allSystems = computed(() => Object.entries(botStore.mapData).map(([id, sys]) => ({ id, ...(sys as any) })));

// ── Analytics computeds ──────────────────────────────────────────
const factionBuildingStats = computed(() => {
  const counts: Record<string, { name: string; color: string; count: number; faction_id: string }> = {};
  for (const b of (botStore.factionBuildings || [])) {
    const key = b.faction_id || b.faction_name || 'unknown';
    if (!counts[key]) counts[key] = { faction_id: key, name: b.faction_name || key, color: '', count: 0 };
    counts[key].count++;
  }
  return Object.values(counts).sort((a, b) => b.count - a.count);
});

const topBuildingSystems = computed(() => {
  const counts: Record<string, { system_id: string; system_name: string; count: number }> = {};
  for (const b of (botStore.factionBuildings || [])) {
    const key = b.system_id || b.system_name || 'unknown';
    if (!counts[key]) counts[key] = { system_id: key, system_name: b.system_name || key, count: 0 };
    counts[key].count++;
  }
  return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10);
});

const buildingTypeStats = computed(() => {
  const counts: Record<string, number> = {};
  for (const b of (botStore.factionBuildings || [])) {
    const key = (b.facility_type || 'unknown').replace(/_/g, ' ');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 10);
});

const securityStats = computed(() => {
  const groups = [
    { level: 'high',    label: 'High Security',  cls: 'text-space-green', barCls: 'bg-green-500', count: 0 },
    { level: 'medium',  label: 'Medium Security', cls: 'text-yellow-400',  barCls: 'bg-yellow-500', count: 0 },
    { level: 'low',     label: 'Low Security',    cls: 'text-red-400',     barCls: 'bg-red-500', count: 0 },
    { level: 'unknown', label: 'Unknown',          cls: 'text-space-text-dim', barCls: 'bg-[#5a6a7a]', count: 0 },
  ];
  for (const s of allSystems.value) {
    const sl = ((s as any).security_level || '').toLowerCase();
    if (sl.includes('high') || sl.includes('safe')) groups[0].count++;
    else if (sl && !sl.includes('low') && !sl.includes('danger')) groups[1].count++;
    else if (sl.includes('low') || sl.includes('danger')) groups[2].count++;
    else groups[3].count++;
  }
  return groups;
});
const totalSystems = computed(() => allSystems.value.length);
const totalPois = computed(() => allSystems.value.reduce((s, sys) => s + (sys.pois || []).length, 0));
const totalStations = computed(() => allSystems.value.reduce((s, sys) => s + (sys.pois || []).filter((p: any) => p.has_base).length, 0));

const displayedSystems = computed(() => {
  let filtered = allSystems.value;
  const q = searchQuery.value.toLowerCase();
  if (q) filtered = filtered.filter(s =>
    (s.name || s.id || '').toLowerCase().includes(q) ||
    (s.id || '').toLowerCase().includes(q) ||
    (s.pois || []).some((p: any) => (p.name || p.id || '').toLowerCase().includes(q))
  );
  if (secFilter.value) {
    filtered = filtered.filter(s => {
      const sl = (s.security_level || '').toLowerCase();
      if (secFilter.value === 'unknown') return !sl;
      if (secFilter.value === 'high') return sl.includes('high') || sl.includes('safe');
      if (secFilter.value === 'low') return sl.includes('low') || sl.includes('danger');
      if (secFilter.value === 'medium') return sl && !sl.includes('high') && !sl.includes('safe') && !sl.includes('low') && !sl.includes('danger');
      return true;
    });
  }
  filtered.sort((a, b) => {
    if (sortBy.value === 'name') return (a.name || a.id || '').localeCompare(b.name || b.id || '');
    if (sortBy.value === 'updated') return (b.last_updated || '').localeCompare(a.last_updated || '');
    if (sortBy.value === 'pois') return (b.pois || []).length - (a.pois || []).length;
    if (sortBy.value === 'security') return secOrder(a.security_level) - secOrder(b.security_level);
    return 0;
  });
  return filtered;
});
</script>
