<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Not docked -->
    <div v-if="!currentBot.docked" class="flex items-center justify-center h-32 text-center">
      <div><div class="text-3xl mb-2">🏠</div><div class="text-space-text-dim text-sm">Dock at a station to view facilities</div></div>
    </div>

    <template v-else>
      <!-- Station header from catalog -->
      <div v-if="stationInfo && props.mode !== 'facility'" class="card py-2 px-2">
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <div>
            <div class="text-sm font-semibold text-space-text-bright">{{ stationInfo.name }}</div>
            <div class="text-xs text-space-text-dim">{{ stationInfo.empire_name }} · {{ stationInfo.system_name }}</div>
          </div>
          <span class="text-xs px-2 py-0.5 rounded shrink-0"
            :class="stationInfo.condition === 'operational' ? 'bg-green-900/40 text-space-green' : 'bg-yellow-900/30 text-yellow-400'">
            {{ stationInfo.condition }}
          </span>
        </div>
        <div class="text-xs text-space-text-dim leading-relaxed mb-1.5">{{ stationInfo.description }}</div>
        <div v-if="stationInfo.condition_text && stationInfo.condition !== 'operational'" class="text-xs text-yellow-400 mb-1.5">⚠️ {{ stationInfo.condition_text }}</div>
        <div class="flex flex-wrap gap-1">
          <span v-for="svc in stationInfo.services" :key="svc" class="px-1.5 py-0.5 rounded text-[11px] bg-[#21262d] text-space-cyan">{{ svc }}</span>
          <span class="px-1.5 py-0.5 rounded text-[11px] bg-[#21262d] text-space-text-dim">🏭 {{ stationFacilities.length || stationInfo.facility_count || 0 }} facilities</span>
          <span v-if="stationInfo.defense_level" class="px-1.5 py-0.5 rounded text-[11px] bg-[#21262d] text-space-text-dim">🛡️ Def {{ stationInfo.defense_level }}</span>
        </div>
      </div>
      <div v-else-if="props.mode !== 'facility'" class="card py-2 px-2 text-xs text-space-text-dim italic">Station catalog info not available for this location.</div>

      <!-- Facility panel -->
      <div class="card py-2 px-2">
        <!-- Tab bar -->
        <div class="flex items-center justify-between border-b border-space-border pb-2 mb-3">
          <div class="flex gap-0.5 flex-wrap">
            <button v-if="props.mode !== 'facility'" @click="tab = 'station'"
              class="px-2 py-0.5 text-xs rounded transition-colors"
              :class="tab === 'station' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">
              🏢 Station<span v-if="stationFacilities.length" class="opacity-60 ml-0.5">({{ stationFacilities.length }})</span>
            </button>
            <button v-if="props.mode !== 'station'" @click="switchToMine"
              class="px-2 py-0.5 text-xs rounded transition-colors"
              :class="tab === 'personal' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">
              👤 Mine<span v-if="myFacilities.length" class="text-space-green ml-0.5">★{{ myFacilities.length }}</span>
            </button>
            <button v-if="props.mode !== 'station'" @click="switchToBuild"
              class="px-2 py-0.5 text-xs rounded transition-colors"
              :class="tab === 'build' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">
              🔨 Build
            </button>
          </div>
          <button @click="reloadAll" :disabled="loading" class="btn btn-secondary text-xs py-0 px-2">{{ loading ? '⏳' : '🔄' }}</button>
        </div>

        <div v-if="loading && !stationFacilities.length" class="text-xs text-space-text-dim italic py-6 text-center">Loading facilities...</div>

        <!-- ── Station Tab ─────────────────────────────────── -->
        <template v-else-if="tab === 'station'">
          <input v-model="stationSearch" type="text" placeholder="Search facilities…"
            class="input text-xs w-full py-1 mb-2" />
          <div v-if="!filteredStation.length" class="text-xs text-space-text-dim italic py-4 text-center">
            No facilities found. Click 🔄 to fetch.
          </div>
          <div v-else class="space-y-4 max-h-[32rem] overflow-auto scrollbar-dark pr-0.5">
            <div v-for="(group, cat) in groupedStation" :key="cat">
              <div class="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                :class="catColor(String(cat))">
                {{ catIcon(String(cat)) }} {{ cat }}
                <span class="font-normal opacity-60 ml-1">({{ group.length }})</span>
              </div>
              <div class="space-y-1.5">
                <div v-for="f in group" :key="f.facility_id"
                  class="bg-[#21262d] rounded-md p-2 text-xs cursor-pointer select-none"
                  :class="f.yours ? 'border border-green-900/40' : ''"
                  @click="toggleExpand(f.facility_id)">
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="font-medium text-space-text truncate">{{ f.name }}</span>
                      <span v-if="f.yours" class="shrink-0 text-[11px] px-1 py-0.5 rounded bg-green-900/30 text-space-green">yours</span>
                    </div>
                    <div class="flex gap-1 shrink-0 items-center">
                      <span v-if="f.maintenance_satisfied === false" class="text-yellow-400 text-[11px]">⚠️</span>
                      <span class="text-[11px] px-1.5 py-0.5 rounded"
                        :class="f.active !== false ? 'bg-green-900/20 text-space-green' : 'bg-red-900/20 text-space-red'">
                        {{ f.active !== false ? 'on' : 'off' }}
                      </span>
                      <span class="text-[11px] text-space-text-dim">{{ expanded.has(f.facility_id) ? '▲' : '▼' }}</span>
                    </div>
                  </div>
                  <!-- Expanded details -->
                  <div v-if="expanded.has(f.facility_id)" class="pt-1.5 mt-1.5 border-t border-[#30363d] space-y-1">
                    <div v-if="f.description" class="text-space-text-dim leading-relaxed">{{ f.description }}</div>
                    <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] mt-0.5">
                      <span v-if="f.level" class="text-space-text-dim">Level {{ f.level }}</span>
                      <span v-if="f.bonus_type" class="text-space-cyan">+{{ f.bonus_value }} {{ f.bonus_type?.replace(/_/g, ' ') }}</span>
                      <span v-if="f.service || f.personal_service" class="text-space-accent">⚙️ {{ (f.service || f.personal_service)?.replace(/_/g, ' ') }}</span>
                      <span v-if="f.faction_service" class="text-purple-400">⚑ {{ f.faction_service.replace(/_/g, ' ') }}</span>
                      <span v-if="f.recipe_id" class="text-space-accent">⚗️ {{ f.recipe_id }}</span>
                      <span v-if="f.capacity" class="text-space-text-dim">Cap: {{ f.capacity }}</span>
                      <span v-if="f.rent_per_cycle" class="text-space-yellow">💰 {{ f.rent_per_cycle }}cr/cycle</span>
                    </div>
                    <div v-if="f.yours" class="flex gap-2 mt-1">
                      <button @click.stop="toggleFacility(f)"
                        :disabled="actionLoading === f.facility_id"
                        class="btn text-[11px] px-2 py-0.5"
                        :class="f.active !== false ? 'btn-secondary' : 'btn-primary'">
                        {{ actionLoading === f.facility_id ? '⏳' : (f.active !== false ? '⏹ Disable' : '▶ Enable') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ── Mine Tab ───────────────────────────────────── -->
        <template v-else-if="tab === 'personal'">
          <div v-if="!myFacilities.length" class="text-xs text-space-text-dim italic py-6 text-center space-y-2">
            <div>You have no personal facilities at this station.</div>
            <button @click="switchToBuild" class="btn btn-primary text-xs px-3 py-1">🔨 Browse Build Options</button>
          </div>
          <div v-else class="space-y-2 max-h-[32rem] overflow-auto scrollbar-dark pr-0.5">
            <div v-for="f in myFacilities" :key="f.facility_id"
              class="bg-[#21262d] border border-green-900/40 rounded-md p-2.5 text-xs">
              <!-- Header -->
              <div class="flex items-start justify-between gap-2 mb-1.5">
                <div class="min-w-0">
                  <div class="font-medium text-space-text-bright">{{ f.name }}</div>
                  <div v-if="f.description" class="text-[11px] text-space-text-dim mt-0.5 leading-relaxed">{{ f.description }}</div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  :class="f.active !== false && f.maintenance_satisfied !== false
                    ? 'bg-green-900/30 text-space-green'
                    : f.active === false
                      ? 'bg-red-900/30 text-space-red'
                      : 'bg-yellow-900/30 text-yellow-400'">
                  {{ f.active !== false ? (f.maintenance_satisfied !== false ? 'active' : '⚠️ degraded') : 'offline' }}
                </span>
              </div>
              <!-- Stats -->
              <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] mb-2">
                <span v-if="f.level" class="text-space-text-dim">Level {{ f.level }}</span>
                <span v-if="f.rent_per_cycle" class="text-space-yellow">💰 {{ f.rent_per_cycle }}cr/cycle</span>
                <span v-if="f.bonus_type" class="text-space-cyan">+{{ f.bonus_value }} {{ f.bonus_type?.replace(/_/g, ' ') }}</span>
                <span v-if="f.personal_service" class="text-space-accent">⚙️ {{ f.personal_service.replace(/_/g, ' ') }}</span>
                <span v-if="f.recipe_id" class="text-space-accent">⚗️ {{ f.recipe_id }}</span>
              </div>
              <!-- Actions -->
              <div class="flex gap-2 flex-wrap">
                <button @click="toggleFacility(f)"
                  :disabled="actionLoading === f.facility_id"
                  class="btn text-[11px] px-2 py-0.5"
                  :class="f.active !== false ? 'btn-secondary' : 'btn-primary'">
                  {{ actionLoading === f.facility_id ? '⏳' : (f.active !== false ? '⏹ Disable' : '▶ Enable') }}
                </button>
                <button v-if="upgradesFor(f.facility_id).length"
                  @click="activeUpgrade = activeUpgrade === f.facility_id ? null : f.facility_id"
                  class="btn btn-secondary text-[11px] px-2 py-0.5">
                  ⬆ Upgrades ({{ upgradesFor(f.facility_id).length }})
                </button>
              </div>
              <!-- Inline upgrade options -->
              <div v-if="activeUpgrade === f.facility_id" class="mt-2 pt-2 border-t border-[#30363d] space-y-1.5">
                <div class="text-[11px] font-semibold uppercase tracking-wider text-space-text-dim mb-1">Available Upgrades</div>
                <div v-for="u in upgradesFor(f.facility_id)" :key="u.facility_type || u.id"
                  class="flex items-center justify-between gap-2 bg-[#1a1f27] rounded px-2 py-1.5 text-[11px]">
                  <div class="min-w-0">
                    <div class="text-space-text font-medium">{{ u.name }}</div>
                    <div v-if="u.description" class="text-space-text-dim mt-0.5 leading-relaxed line-clamp-2">{{ u.description }}</div>
                    <div class="flex gap-3 mt-0.5">
                      <span v-if="u.build_cost" class="text-space-yellow">{{ u.build_cost?.toLocaleString() }}cr</span>
                      <span v-if="u.bonus_type" class="text-space-cyan">+{{ u.bonus_value }} {{ u.bonus_type?.replace(/_/g, ' ') }}</span>
                    </div>
                  </div>
                  <button @click="upgradeFacility(f, u.facility_type || u.id)"
                    :disabled="actionLoading === f.facility_id"
                    class="btn btn-primary text-[11px] px-2 py-0.5 shrink-0">
                    {{ actionLoading === f.facility_id ? '⏳' : '⬆ Upgrade' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ── Build Tab ──────────────────────────────────── -->
        <template v-else-if="tab === 'build'">
          <div class="flex gap-2 mb-2">
            <select v-model="buildCategory" @change="loadTypes" class="input text-xs py-1 flex-1">
              <option value="personal">Personal facilities</option>
              <option value="production">Production facilities</option>
              <option value="">All categories</option>
            </select>
            <button @click="loadTypes" :disabled="typesLoading" class="btn btn-secondary text-xs py-0 px-2">
              {{ typesLoading ? '...' : '↺' }}
            </button>
          </div>
          <!-- Current gatherer goal banner with progress -->
          <div v-if="currentGathererGoal" class="mb-2 p-2.5 rounded border border-space-accent/30 bg-space-accent/5">
            <div class="flex items-center justify-between mb-1.5">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-[11px] font-semibold text-space-accent">📦 Gather goal</span>
                <span class="text-xs text-space-text-bright font-medium truncate">{{ currentGathererGoal.target_name }}</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs font-bold" :class="goalOverallPct >= 100 ? 'text-space-green' : 'text-space-text-dim'">{{ goalOverallPct }}%</span>
                <button @click="botStore.saveSettings(props.bot.username, { goal: null })" class="btn btn-secondary text-[11px] px-1.5 py-0.5">✕</button>
              </div>
            </div>
            <!-- Overall bar -->
            <div class="h-1 bg-space-border rounded-full mb-2">
              <div class="h-full rounded-full transition-all duration-500"
                :class="goalOverallPct >= 100 ? 'bg-space-green' : 'bg-space-accent'"
                :style="{ width: Math.min(goalOverallPct, 100) + '%' }"></div>
            </div>
            <!-- Per-material rows -->
            <div class="space-y-1.5">
              <div v-for="m in goalMaterials" :key="m.item_id">
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text">{{ m.item_name }}</span>
                  <span :class="m.pct >= 100 ? 'text-space-green' : 'text-space-text-dim'">{{ m.collected }}/{{ m.quantity_needed }}</span>
                </div>
                <div class="h-0.5 bg-space-border rounded-full">
                  <div class="h-full rounded-full transition-all duration-500"
                    :class="m.pct >= 100 ? 'bg-space-green' : 'bg-space-accent/50'"
                    :style="{ width: Math.min(m.pct, 100) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="typesLoading" class="text-xs text-space-text-dim italic py-6 text-center">Loading types...</div>
          <div v-else-if="!facilityTypes.length" class="text-xs text-space-text-dim italic py-6 text-center">No types found — click ↺ to reload.</div>
          <div v-else class="space-y-2 max-h-[32rem] overflow-auto scrollbar-dark pr-0.5">
            <!-- Prerequisite banner inside list so it doesn't hide the type cards -->
            <div v-if="buildCategory === 'personal' && !hasQuarters"
              class="mb-1 px-2 py-1.5 rounded text-[11px] bg-yellow-900/20 border border-yellow-700/30 text-yellow-400 flex items-start gap-1.5">
              <span class="shrink-0">⚠️</span>
              <span><strong>Crew Bunk required</strong> — build Personal Quarters first before any other personal facility.</span>
            </div>
            <div v-for="t in facilityTypes" :key="t.id"
              class="rounded-md border text-xs transition-all"
              :class="[
                isBuilt(t.id) ? 'border-green-900/40 bg-[#1a2120]' :
                !t.buildable ? 'border-[#30363d] bg-[#161b22] opacity-60' :
                currentGathererGoal?.target_id === t.id ? 'border-space-accent/40 bg-[#21262d]' :
                'border-[#30363d] bg-[#21262d] hover:border-[#444d56]'
              ]">
              <!-- Card header -->
              <div class="flex items-start gap-2 p-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span class="font-semibold" :class="isBuilt(t.id) ? 'text-space-green' : !t.buildable ? 'text-space-text-dim' : 'text-space-text-bright'">{{ t.name }}</span>
                    <span class="text-[10px] text-space-text-dim">Lv{{ t.level }}</span>
                    <span v-if="isBuilt(t.id)" class="text-[10px] px-1 py-0.5 rounded bg-green-900/30 text-space-green">✓ built</span>
                    <span v-else-if="!t.buildable" class="text-[10px] px-1 py-0.5 rounded bg-[#30363d] text-space-text-dim">🔒 locked</span>
                    <span v-if="currentGathererGoal?.target_id === t.id" class="text-[10px] px-1 py-0.5 rounded bg-space-accent/20 text-space-accent">gathering</span>
                  </div>
                  <div v-if="t.description" class="text-[11px] text-space-text-dim leading-relaxed line-clamp-2">{{ t.description }}</div>
                  <!-- Bonuses & services -->
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] mt-0.5">
                    <span v-if="t.bonus_type" class="text-space-cyan">+{{ t.bonus_value }} {{ t.bonus_type?.replace(/_/g, ' ') }}</span>
                    <span v-if="t.personal_service" class="text-space-accent">⚙️ {{ t.personal_service.replace(/_/g, ' ') }}</span>
                    <span v-if="t.rent_per_cycle" class="text-space-yellow">💰 {{ t.rent_per_cycle }}cr/cycle</span>
                    <span v-if="t.build_time" class="text-space-text-dim">⏱ {{ t.build_time }} cycles</span>
                  </div>
                </div>
                <!-- Right: cost + build button -->
                <div class="shrink-0 flex flex-col items-end gap-1">
                  <span class="text-[11px] font-semibold" :class="t.build_cost ? 'text-space-yellow' : 'text-space-text-dim'">{{ t.build_cost != null ? t.build_cost.toLocaleString() + ' cr' : '—' }}</span>
                  <button @click="buildFacility(t)"
                    :disabled="isBuilt(t.id) || !t.buildable || actionLoading === t.id"
                    class="btn text-[11px] px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    :class="isBuilt(t.id) ? 'btn-secondary' : t.buildable ? 'btn-primary' : 'btn-secondary'">
                    {{ actionLoading === t.id ? '...' : isBuilt(t.id) ? '✓ Built' : !t.buildable ? '🔒' : '🔨 Build' }}
                  </button>
                </div>
              </div>
              <!-- Build error -->
              <div v-if="buildErrors[t.id]" class="px-2 pb-1.5 text-[11px] text-red-400">⚠ {{ buildErrors[t.id] }}</div>
              <!-- Materials row -->
              <div v-if="buildMaterials(t).length" class="px-2 pb-2 pt-0 border-t border-[#30363d] mt-0 flex items-center justify-between gap-2">
                <div class="min-w-0 pt-1.5">
                  <div class="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                    <span v-for="m in buildMaterials(t)" :key="m.item_id"
                      class="text-space-text-dim">{{ m.name || m.item_name || m.item_id }}<span class="text-space-text ml-0.5">×{{ m.quantity || m.quantity_needed }}</span></span>
                  </div>
                </div>
                <button v-if="!isBuilt(t.id) && currentGathererGoal?.target_id !== t.id"
                  @click="setGathererGoal(t)"
                  class="btn btn-secondary text-[11px] px-2 py-0.5 shrink-0 whitespace-nowrap mt-1.5">
                  📦 Gather
                </button>
                <span v-else-if="currentGathererGoal?.target_id === t.id"
                  class="text-[11px] text-space-accent shrink-0 mt-1.5">⚙️ active</span>
              </div>
              <div v-else-if="!isBuilt(t.id) && !typeDetails[t.id]" class="px-2 pb-1.5 text-[11px] text-space-text-dim/30 italic">fetching materials…</div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

const props = defineProps<{ bot: any; mode?: 'all' | 'station' | 'facility' }>();
const emit = defineEmits<{
  (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void;
}>();

const botStore = useBotStore();

// ── State ─────────────────────────────────────────────────────
const tab = ref<'station' | 'personal' | 'build'>(props.mode === 'facility' ? 'personal' : 'station');
const loading = ref(false);
const typesLoading = ref(false);
const actionLoading = ref<string | null>(null);

const stationFacilities = ref<any[]>([]);
const myFacilities = ref<any[]>([]);
const upgradeMap = ref<Record<string, any[]>>({}); // facility_id → upgrade options
const facilityTypes = ref<any[]>([]);

const currentPlayerId = ref<string>(''); // fetched once via get_status; used to filter player_facilities

const buildCategory = ref('personal');
const stationSearch = ref('');
const expanded = ref(new Set<string>());
const activeUpgrade = ref<string | null>(null);
const buildErrors = ref<Record<string, string>>({});
const typeDetails = ref<Record<string, any>>({}); // facility_type id → detailed type info (build_materials etc.)

// ── Computed ──────────────────────────────────────────────────
const hasQuarters = computed(() =>
  myFacilities.value.some((f: any) => f.personal_service === 'quarters')
);
const currentBot = computed(() =>
  botStore.bots.find(b => b.username === props.bot.username) || props.bot
);
const currentGathererGoal = computed(() =>
  (botStore.settings as any)?.[props.bot.username]?.goal ??
  (botStore.settings as any)?.gatherer?.goal ?? null
);

const goalMaterials = computed(() => {
  const goal = currentGathererGoal.value;
  if (!goal) return [];
  const bot = currentBot.value as any;
  return (goal.materials || []).map((m: any) => {
    const inFaction = (bot.factionStorage || []).find((i: any) => i.itemId === m.item_id)?.quantity ?? 0;
    const inCargo = (bot.inventory || []).find((i: any) => i.itemId === m.item_id)?.quantity ?? 0;
    const collected = Math.min(inFaction + inCargo, m.quantity_needed);
    const pct = m.quantity_needed > 0 ? Math.round(collected / m.quantity_needed * 100) : 0;
    return { ...m, collected, pct };
  });
});

const goalOverallPct = computed(() => {
  const mats = goalMaterials.value;
  if (!mats.length) return 0;
  const totalNeeded = mats.reduce((s: number, m: any) => s + m.quantity_needed, 0);
  const totalCollected = mats.reduce((s: number, m: any) => s + m.collected, 0);
  return totalNeeded > 0 ? Math.round(totalCollected / totalNeeded * 100) : 0;
});

const stationInfo = computed(() => {
  const bot = currentBot.value;
  if (!bot || !(botStore as any).publicStations?.length) return null;
  return (botStore as any).publicStations.find((st: any) =>
    st.id === (bot as any).poi || st.system_id === (bot as any).system
  ) || null;
});

const filteredStation = computed(() => {
  const q = stationSearch.value.toLowerCase().trim();
  if (!q) return stationFacilities.value;
  return stationFacilities.value.filter((f: any) =>
    (f.name || '').toLowerCase().includes(q) ||
    (f.description || '').toLowerCase().includes(q) ||
    (f.category || '').toLowerCase().includes(q)
  );
});

const groupedStation = computed(() => {
  const order = ['service', 'production', 'personal', 'infrastructure', 'faction', 'other'];
  const groups: Record<string, any[]> = {};
  for (const f of filteredStation.value) {
    const cat = f.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(f);
  }
  const sorted = order.filter(k => groups[k]).map(k => [k, groups[k]] as [string, any[]]);
  const rest = Object.entries(groups).filter(([k]) => !order.includes(k));
  return Object.fromEntries([...sorted, ...rest]);
});

// ── Helpers ───────────────────────────────────────────────────
function catIcon(cat: string): string {
  const m: Record<string, string> = { production: '⚗️', service: '🔧', personal: '👤', faction: '⚑', infrastructure: '🏗️' };
  return m[cat] ?? '🏢';
}

function catColor(cat: string): string {
  const m: Record<string, string> = { production: 'text-amber-400', service: 'text-blue-400', personal: 'text-space-green', faction: 'text-purple-400' };
  return m[cat] ?? 'text-space-text-dim';
}

// ── Helpers ──────────────────────────────────────────────────
function buildMaterials(t: any): any[] {
  return typeDetails.value[t.id]?.build_materials || t.build_materials || [];
}

// ── Error message parser ──────────────────────────────────────
function parseBuildError(raw: string): string {
  // Strip error code prefix: "build_failed: " or "error_code: "
  const msg = raw.replace(/^[\w_]+:\s*/i, '').trim();
  // Parse "need N x item_id, have X in storage + Y in cargo"
  const m = msg.match(/need (\d+) x ([\w_]+),?\s*have (\d+) in storage \+ (\d+) in cargo/i);
  if (m) {
    const qty = m[1], itemId = m[2].replace(/_/g, ' '), inStorage = parseInt(m[3]), inCargo = parseInt(m[4]);
    const have = inStorage + inCargo;
    return `Missing: ${qty}\u00d7 ${itemId} (have ${have})`;
  }
  // Parse prerequisite errors
  if (msg.toLowerCase().includes('personal quarters')) return 'Build Crew Bunk (Personal Quarters) first.';
  return msg;
}

function isBuilt(typeId: string): boolean {
  return myFacilities.value.some((f: any) => f.type === typeId);
}

function upgradesFor(facilityId: string): any[] {
  return upgradeMap.value[facilityId] || [];
}

function toggleExpand(id: string): void {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}

// ── Exec helper ───────────────────────────────────────────────
function execAsync(command: string, params?: any): Promise<any> {
  return new Promise(resolve => {
    const username = currentBot.value?.username;
    if (!username) return resolve({ ok: false, error: 'No bot selected' });
    botStore.sendExec(username, command, params, (r: any) => resolve(r));
  });
}

function notif(text: string, type: 'success' | 'warn' | 'error'): void {
  emit('notif', text, type);
}

// ── Data loading ──────────────────────────────────────────────
async function fetchPlayerId(): Promise<void> {
  if (currentPlayerId.value) return;
  const res = await execAsync('get_status', {});
  if (res.ok && res.data) {
    const pid = res.data.player?.id || res.data.player?.player_id || res.data.id || res.data.player_id || '';
    if (pid) currentPlayerId.value = pid;
  }
}

async function loadFacilities(): Promise<void> {
  loading.value = true;
  try {
    await fetchPlayerId();
    const res = await execAsync('facility', { action: 'list' });
    if (!res.ok) { notif(res.error || 'Failed to load facilities', 'error'); return; }
    const d = res.data || {};

    const stationList: any[] = d.station_facilities || [];
    const playerList: any[] = d.player_facilities || [];
    const factionList: any[] = d.faction_facilities || [];

    if (stationList.length || playerList.length || factionList.length) {
      // v2 split format — player_facilities contains ALL players' personal facilities at this station
      // filter to only current bot's by matching owner_id
      const mine = currentPlayerId.value
        ? playerList.filter((f: any) => f.owner_id === currentPlayerId.value)
        : playerList;
      stationFacilities.value = [
        ...stationList,
        ...mine.map((f: any) => ({ ...f, yours: true })),
        ...factionList,
      ];
      myFacilities.value = mine;
    } else {
      // flat list fallback
      const all: any[] = Array.isArray(d) ? d : (d.facilities || []);
      stationFacilities.value = all;
      myFacilities.value = all.filter((f: any) => f.yours === true);
    }
  } finally {
    loading.value = false;
  }
}

async function loadUpgrades(): Promise<void> {
  if (!myFacilities.value.length) return;
  const res = await execAsync('facility', { action: 'upgrades' });
  if (!res.ok) return;
  const d = res.data || {};
  const list: any[] = d.upgrades || d.available_upgrades || (Array.isArray(d) ? d : []);
  const map: Record<string, any[]> = {};
  for (const entry of list) {
    const id: string = entry.facility_id;
    if (!id) continue;
    const opts: any[] = entry.available_upgrades || entry.upgrades || (entry.facility_type ? [entry] : []);
    if (opts.length) map[id] = opts;
  }
  upgradeMap.value = map;
}

async function loadTypeDetails(): Promise<void> {
  const types = facilityTypes.value;
  if (!types.length) return;
  await Promise.all(types.map(async (t: any) => {
    if (typeDetails.value[t.id]) return;
    const res = await execAsync('facility', { action: 'types', facility_type: t.id });
    if (res.ok && res.data) {
      const detail = res.data.types?.[0] || res.data || {};
      typeDetails.value[t.id] = detail;
    }
  }));
}

function setGathererGoal(t: any): void {
  const mats = buildMaterials(t);
  if (!mats.length) { notif('No build materials for this facility', 'warn'); return; }
  const bot = currentBot.value as any;
  const goal = {
    id: `goal_${t.id}_${Date.now()}`,
    target_id: t.id,
    target_name: t.name,
    target_poi: bot?.poi || '',
    target_system: bot?.system || '',
    materials: mats.map((m: any) => ({
      item_id: m.item_id || '',
      item_name: m.name || m.item_name || (m.item_id || '').replace(/_/g, ' '),
      quantity_needed: m.quantity || m.quantity_needed || 1,
    })),
  };
  botStore.saveSettings(props.bot.username, { goal });
  notif(`Gather goal set: ${t.name} (×${mats.length} material type${mats.length > 1 ? 's' : ''})`, 'success');
}

async function loadTypes(): Promise<void> {
  typesLoading.value = true;
  facilityTypes.value = [];
  typeDetails.value = {};
  try {
    let page = 1;
    while (true) {
      const params: any = { action: 'types', page };
      if (buildCategory.value) params.category = buildCategory.value;
      const res = await execAsync('facility', params);
      if (!res.ok) { notif(res.error || 'Failed to load facility types', 'error'); break; }
      const d = res.data || {};
      const types: any[] = d.types || (Array.isArray(d) ? d : []);
      facilityTypes.value.push(...types);
      if (!types.length || (d.page || 1) >= (d.total_pages || 1)) break;
      if (++page > 15) break;
    }
  } finally {
    typesLoading.value = false;
  }
  loadTypeDetails(); // background — fills build_materials per type
}

async function reloadAll(): Promise<void> {
  await loadFacilities();
  if (myFacilities.value.length) await loadUpgrades();
}

// ── Actions ───────────────────────────────────────────────────
async function toggleFacility(f: any): Promise<void> {
  actionLoading.value = f.facility_id;
  try {
    const res = await execAsync('facility', { action: 'toggle', facility_id: f.facility_id });
    if (res.ok) {
      f.active = !f.active;
      notif(`${f.name} ${f.active ? 'enabled' : 'disabled'}`, 'success');
    } else {
      notif(res.error || 'Toggle failed', 'error');
    }
  } finally {
    actionLoading.value = null;
  }
}

async function buildFacility(t: any): Promise<void> {
  actionLoading.value = t.id;
  try {
    const action = t.category === 'personal' ? 'personal_build' : 'build';
    const res = await execAsync('facility', { action, facility_type: t.id });
    if (res.ok) {
      const r = res.data?.result || res.data || {};
      const xp = r.skill_xp
        ? ' +XP: ' + Object.entries(r.skill_xp).map(([k, v]) => `${v} ${k}`).join(', ')
        : '';
      notif(r.hint || `Built ${r.facility_name || t.name}!${xp}`, 'success');
      await reloadAll();
      tab.value = 'personal';
    } else {
      const cleaned = parseBuildError(res.error || 'Build failed');
      buildErrors.value[t.id] = cleaned;
      notif(cleaned, 'error');
    }
  } finally {
    actionLoading.value = null;
  }
}

async function upgradeFacility(f: any, toTypeId: string): Promise<void> {
  actionLoading.value = f.facility_id;
  try {
    const res = await execAsync('facility', { action: 'upgrade', facility_id: f.facility_id, facility_type: toTypeId });
    if (res.ok) {
      notif(`Upgraded ${f.name}!`, 'success');
      activeUpgrade.value = null;
      await reloadAll();
    } else {
      notif(res.error || 'Upgrade failed', 'error');
    }
  } finally {
    actionLoading.value = null;
  }
}

// ── Tab switch helpers ────────────────────────────────────────
function switchToMine(): void {
  tab.value = 'personal';
  if (!stationFacilities.value.length) reloadAll();
  else if (myFacilities.value.length && !Object.keys(upgradeMap.value).length) loadUpgrades();
}

function switchToBuild(): void {
  tab.value = 'build';
  if (!facilityTypes.value.length) loadTypes();
}

// ── Lifecycle ─────────────────────────────────────────────────
onMounted(() => {
  if ((currentBot.value as any)?.docked) reloadAll();
});

watch(() => props.bot.username, () => {
  currentPlayerId.value = ''; // reset when switching bots so ID is re-fetched for new character
});

watch(() => (currentBot.value as any)?.docked, (docked, prev) => {
  if (docked && !prev) {
    stationFacilities.value = [];
    myFacilities.value = [];
    upgradeMap.value = {};
    facilityTypes.value = [];
    expanded.value.clear();
    reloadAll();
  }
});

function maybeLoad(): void {
  if (!stationFacilities.value.length) reloadAll();
}

defineExpose({ maybeLoad });
</script>
