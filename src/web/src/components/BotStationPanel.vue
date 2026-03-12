<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Not docked -->
    <div v-if="!currentBot.docked" class="flex items-center justify-center h-32 text-center">
      <div><div class="text-3xl mb-2">🏠</div><div class="text-space-text-dim text-sm">Dock at a station to view facilities</div></div>
    </div>

    <template v-else>
      <!-- Dock story + station condition (from latest dock result) -->
      <div v-if="dockData && props.mode !== 'facility'" class="card py-2 px-2 space-y-2">
        <!-- Condition banner -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded" :class="conditionClass">{{ conditionLabel }}</span>
          <span class="text-[11px] text-space-text-dim">{{ dockData.station_condition?.satisfied_count ?? 0 }}/{{ dockData.station_condition?.total_service_infra ?? 0 }} services</span>
          <div class="flex-1 min-w-16 h-1.5 bg-space-border rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="conditionBarClass" :style="{ width: (dockData.station_condition?.satisfaction_pct ?? 0) + '%' }"></div>
          </div>
          <span class="text-[11px] text-space-text-dim shrink-0">{{ dockData.station_condition?.satisfaction_pct ?? 0 }}%</span>
        </div>
        <div v-if="dockData.station_condition?.condition_text && dockData.station_condition?.condition !== 'operational'" class="text-[11px] text-yellow-400">⚠️ {{ dockData.station_condition.condition_text }}</div>
        <!-- Storage summary from dock result -->
        <div v-if="dockData.storage_items != null || dockData.storage_credits != null" class="flex gap-3 text-[11px] text-space-text-dim">
          <span v-if="dockData.storage_items != null">📦 {{ dockData.storage_items }} item stacks stored</span>
          <span v-if="dockData.storage_credits != null">💰 {{ dockData.storage_credits.toLocaleString() }} cr storage credits</span>
        </div>
        <!-- Story (collapsible) -->
        <details v-if="dockData.story" class="text-xs">
          <summary class="cursor-pointer text-space-text-dim hover:text-space-text select-none">📖 Station story</summary>
          <div class="mt-1.5 whitespace-pre-wrap text-[11px] text-space-text-dim leading-relaxed border-t border-space-border pt-1.5">{{ dockData.story }}</div>
        </details>
      </div>

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
            <button @click="switchToChat"
              class="px-2 py-0.5 text-xs rounded transition-colors flex items-center gap-1"
              :class="tab === 'chat' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">
              💬 Chat
              <span v-if="totalUnread > 0" class="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold bg-space-red text-white">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
            </button>
            <button v-if="props.mode !== 'facility'" @click="switchToMarket"
              class="px-2 py-0.5 text-xs rounded transition-colors"
              :class="tab === 'market' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">
              🛒 Market<span v-if="marketItems.length" class="opacity-60 ml-0.5">({{ marketItems.length }})</span>
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
                    <!-- Faction ownership badge -->
                    <div v-if="factionFor(f)" class="flex items-center gap-1.5 text-[11px] mt-0.5">
                      <div class="w-3 h-3 rounded-full border border-white/20 shrink-0"
                        :style="{ backgroundColor: factionFor(f)?.primary_color || '#7c3aed' }"
                      ></div>
                      <span class="text-purple-300">⚑ {{ factionFor(f)?.name }}</span>
                      <span v-if="factionFor(f)?.tag" class="text-space-text-dim">[{{ factionFor(f)?.tag }}]</span>
                    </div>
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
          <!-- Current gatherer goals banner with progress (supports multiple goals) -->
          <div v-if="currentGathererGoals.length" class="mb-2 space-y-2">
            <div v-for="goal in currentGathererGoals" :key="goal.id"
              class="p-2.5 rounded border border-space-accent/30 bg-space-accent/5">
              <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-[11px] font-semibold text-space-accent">📦</span>
                  <span class="text-xs text-space-text-bright font-medium truncate">{{ goal.target_name }}</span>
                  <span v-if="goal.goal_type === 'craft'" class="text-[10px] px-1 py-0.5 rounded bg-space-yellow/20 text-space-yellow">craft</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-xs font-bold" :class="goal.overallPct >= 100 ? 'text-space-green' : 'text-space-text-dim'">{{ goal.overallPct }}%</span>
                  <button @click="clearGathererGoalById(goal.id)" class="btn btn-secondary text-[11px] px-1.5 py-0.5">✕</button>
                </div>
              </div>
              <div class="h-1 bg-space-border rounded-full mb-2">
                <div class="h-full rounded-full transition-all duration-500"
                  :class="goal.overallPct >= 100 ? 'bg-space-green' : 'bg-space-accent'"
                  :style="{ width: Math.min(goal.overallPct, 100) + '%' }"></div>
              </div>
              <div class="space-y-1.5">
                <div v-for="m in goal.materials" :key="m.item_id">
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
                currentGathererGoals.some(g => g.target_id === t.id) ? 'border-space-accent/40 bg-[#21262d]' :
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
                    <span v-if="currentGathererGoals.some(g => g.target_id === t.id)" class="text-[10px] px-1 py-0.5 rounded bg-space-accent/20 text-space-accent">gathering</span>
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
                <button v-if="!isBuilt(t.id)"
                  @click="setGathererGoal(t)"
                  class="btn btn-secondary text-[11px] px-2 py-0.5 shrink-0 whitespace-nowrap mt-1.5">
                  {{ currentGathererGoals.some(g => g.target_id === t.id) ? '📦 +add' : '📦 Gather' }}
                </button>
              </div>
              <div v-else-if="!isBuilt(t.id) && !typeDetails[t.id]" class="px-2 pb-1.5 text-[11px] text-space-text-dim/30 italic">fetching materials…</div>
            </div>
          </div>
        </template>
        <!-- ── Market Tab ──────────────────────────────── -->
        <template v-else-if="tab === 'market'">
          <div class="flex gap-2 mb-2">
            <input v-model="marketSearch" type="text" placeholder="Search items…" class="input text-xs flex-1 py-1" />
            <input v-model.number="marketTradeQty" type="number" min="1" class="input text-xs w-14 py-1" title="Trade quantity" />
            <button @click="loadMarket" :disabled="marketLoading" class="btn btn-secondary text-xs py-0 px-2">{{ marketLoading ? '⏳' : '🔄' }}</button>
          </div>
          <!-- Trade result notification -->
          <div v-if="marketTradeResult" class="text-[11px] px-2 py-1 rounded mb-2"
            :class="marketTradeResult.ok ? 'bg-space-green/10 text-space-green border border-space-green/20' : 'bg-space-red/10 text-space-red border border-space-red/20'">
            {{ marketTradeResult.ok ? '✅' : '❌' }} {{ marketTradeResult.message }}
          </div>
          <div v-if="marketLoading && !marketItems.length" class="text-xs text-space-text-dim italic py-6 text-center">Loading market…</div>
          <div v-else-if="!marketItems.length" class="text-xs text-space-text-dim italic py-6 text-center">No market data. Click 🔄 to fetch.</div>
          <div v-else class="overflow-auto scrollbar-dark pr-0.5" style="max-height: 30rem">
            <table class="w-full text-[11px] border-collapse">
              <thead class="sticky top-0 bg-space-card z-10">
                <tr class="text-left text-space-text-dim">
                  <th class="pb-1.5 pr-1 font-semibold">Item</th>
                  <th class="pb-1.5 px-1 font-semibold text-right">Buy<span class="font-normal opacity-60 ml-0.5">cr</span></th>
                  <th class="pb-1.5 px-1 font-semibold text-right">Sell<span class="font-normal opacity-60 ml-0.5">cr</span></th>
                  <th class="pb-1.5 pl-1 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredMarket" :key="item.item_id"
                  class="border-t border-space-border/40 hover:bg-[#1e242d] transition-colors">
                  <td class="py-1 pr-1 text-space-text-bright max-w-[8rem] truncate" :title="item.item_name">{{ item.item_name }}</td>
                  <!-- Station BUY price (station pays player to sell to it) -->
                  <td class="py-1 px-1 text-right font-mono"
                    :class="item.buy_price != null ? 'text-space-green' : 'text-space-text-dim/30'">
                    {{ item.buy_price != null ? item.buy_price.toLocaleString() : '—' }}
                    <span v-if="item.buy_price != null && item.buy_quantity" class="text-space-text-dim/60 text-[10px] ml-0.5">({{ item.buy_quantity }})</span>
                  </td>
                  <!-- Station SELL price (player buys from station) -->
                  <td class="py-1 px-1 text-right font-mono"
                    :class="item.sell_price != null ? 'text-space-yellow' : 'text-space-text-dim/30'">
                    {{ item.sell_price != null ? item.sell_price.toLocaleString() : '—' }}
                    <span v-if="item.sell_price != null && item.sell_quantity" class="text-space-text-dim/60 text-[10px] ml-0.5">({{ item.sell_quantity }})</span>
                  </td>
                  <!-- Action buttons -->
                  <td class="py-1 pl-1 text-right">
                    <div class="flex gap-0.5 justify-end">
                      <!-- Buy from station → auto-deposit to faction storage -->
                      <button v-if="item.sell_price != null"
                        @click="execMarketBuy(item)"
                        :disabled="marketActionItem === item.item_id"
                        class="btn text-[10px] px-1.5 py-0.5 bg-space-yellow/20 text-space-yellow border-space-yellow/30 hover:bg-space-yellow/40 disabled:opacity-40"
                        title="Buy from station → auto-deposit to faction storage">
                        {{ marketActionItem === item.item_id && marketActionType === 'buy' ? '⏳' : 'Buy' }}
                      </button>
                      <!-- Sell to station → auto-withdraw from storage -->
                      <button v-if="item.buy_price != null"
                        @click="execMarketSell(item)"
                        :disabled="marketActionItem === item.item_id"
                        class="btn text-[10px] px-1.5 py-0.5 bg-space-green/20 text-space-green border-space-green/30 hover:bg-space-green/40 disabled:opacity-40"
                        title="Auto-withdraw from storage → sell to station">
                        {{ marketActionItem === item.item_id && marketActionType === 'sell' ? '⏳' : 'Sell' }}
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="filteredMarket.length === 0">
                  <td colspan="4" class="py-4 text-center text-space-text-dim italic">No items match filter</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- ── Chat Tab ──────────────────────────────────── -->
        <template v-else-if="tab === 'chat'">
          <!-- Channel selector -->
          <div class="flex gap-1 mb-2 flex-wrap">
            <button v-for="ch in chatChannels" :key="ch.id"
              @click="selectChatChannel(ch.id)"
              class="px-2 py-0.5 text-[11px] rounded transition-colors flex items-center gap-1"
              :class="chatChannel === ch.id ? 'bg-space-accent text-white' : 'bg-[#21262d] text-space-text-dim hover:text-space-text'">
              {{ ch.label }}
              <span v-if="(dockData?.unread_chat?.[ch.id] ?? 0) > 0"
                class="inline-flex items-center justify-center px-1 rounded text-[9px] font-bold bg-space-red/80 text-white">
                {{ dockData?.unread_chat?.[ch.id] }}
              </span>
            </button>
          </div>
          <!-- Load / refresh -->
          <div class="flex items-center gap-2 mb-2">
            <button @click="loadChat(true)" :disabled="chatLoading" class="btn btn-secondary text-xs py-0 px-2">{{ chatLoading ? '⏳' : '🔄 Refresh' }}</button>
            <span v-if="chatTotal > 0" class="text-[11px] text-space-text-dim">{{ chatMessages.length }} / {{ chatTotal }} messages</span>
            <span v-if="dockData?.unread_chat_note" class="text-[11px] text-yellow-400 truncate">{{ dockData.unread_chat_note }}</span>
          </div>
          <!-- Messages -->
          <div v-if="chatLoading && !chatMessages.length" class="text-xs text-space-text-dim italic py-6 text-center">Loading messages…</div>
          <div v-else-if="!chatMessages.length" class="text-xs text-space-text-dim italic py-6 text-center">No messages. Click Refresh to load.</div>
          <div v-else class="space-y-1.5 max-h-96 overflow-auto scrollbar-dark pr-0.5">
            <div v-for="msg in chatMessages" :key="msg.id || (msg.timestamp + msg.author)"
              class="bg-[#21262d] rounded px-2 py-1.5 text-[11px]">
              <div class="flex items-baseline gap-1.5 mb-0.5">
                <span class="font-semibold text-space-accent">{{ msg.author || msg.sender || 'System' }}</span>
                <span class="text-space-text-dim text-[10px]">{{ formatChatTime(msg.timestamp || msg.created_at) }}</span>
              </div>
              <div class="text-space-text leading-relaxed">{{ msg.text || msg.message || msg.content }}</div>
            </div>
          </div>
          <!-- Load more -->
          <div v-if="chatMessages.length < chatTotal" class="mt-2 text-center">
            <button @click="loadChat(false)" :disabled="chatLoading" class="btn btn-secondary text-xs px-3">{{ chatLoading ? '...' : 'Load more' }}</button>
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
const tab = ref<'station' | 'personal' | 'build' | 'chat' | 'market'>(props.mode === 'facility' ? 'personal' : 'station');
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

// Faction ownership lookup (from DB cache)
const cachedFactions = ref<Record<string, { id: string; name: string; tag: string; primary_color: string }>>({});

async function loadFactionCache(): Promise<void> {
  try {
    const r = await fetch('/api/factions');
    if (r.ok) {
      const list: any[] = await r.json();
      const map: Record<string, any> = {};
      for (const f of list) if (f.id) map[f.id] = f;
      cachedFactions.value = map;
    }
  } catch { /* silent */ }
}

function factionFor(f: any): { name: string; tag: string; primary_color: string } | null {
  const id = f.faction_id || f.owner_faction_id;
  if (!id) return null;
  const cached = cachedFactions.value[id];
  if (cached) return cached;
  // Fallback: if the facility itself carries faction_name
  if (f.faction_name) return { name: f.faction_name, tag: '', primary_color: '' };
  return null;
}

// ── Computed ─────────────────────────────────────────────
const hasQuarters = computed(() =>
  myFacilities.value.some((f: any) => f.personal_service === 'quarters')
);
const currentBot = computed(() =>
  botStore.bots.find(b => b.username === props.bot.username) || props.bot
);

// ── Dock data from botStore ─────────────────────────────────
const dockData = computed(() => botStore.stationDockInfo?.[currentBot.value?.username] ?? null);

const conditionLabel = computed(() => {
  const c = dockData.value?.station_condition?.condition;
  if (c === 'operational') return '✅ Operational';
  if (c === 'degraded') return '⚠️ Degraded';
  if (c === 'critical') return '🚨 Critical';
  return c || 'Unknown';
});

const conditionClass = computed(() => {
  const c = dockData.value?.station_condition?.condition;
  if (c === 'operational') return 'bg-green-900/30 text-space-green';
  if (c === 'degraded') return 'bg-yellow-900/30 text-yellow-400';
  return 'bg-red-900/30 text-space-red';
});

const conditionBarClass = computed(() => {
  const c = dockData.value?.station_condition?.condition;
  if (c === 'operational') return 'bg-space-green';
  if (c === 'degraded') return 'bg-yellow-400';
  return 'bg-space-red';
});

const totalUnread = computed(() => {
  const u = dockData.value?.unread_chat;
  if (!u) return 0;
  return Object.values(u).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
});

// ── Chat ────────────────────────────────────────────
const chatChannels = [
  { id: 'system',  label: '📡 System'  },
  { id: 'local',   label: '📍 Local'   },
  { id: 'faction', label: '⚔️ Faction' },
  { id: 'private', label: '🔒 Private' },
];
// ── Market ─────────────────────────────────────────────────
const marketItems = ref<any[]>([]);
const marketLoading = ref(false);
const marketSearch = ref('');

const filteredMarket = computed(() => {
  const q = marketSearch.value.toLowerCase().trim();
  return q
    ? marketItems.value.filter(i =>
        (i.item_name || i.name || i.item_id || '').toLowerCase().includes(q)
      )
    : marketItems.value;
});

async function loadMarket(): Promise<void> {
  if (marketLoading.value) return;
  marketLoading.value = true;
  try {
    const res = await execAsync('view_market');
    if (!res.ok) { notif(res.error || 'Failed to load market', 'error'); return; }
    const d = res.data || {};
    const raw: any[] = Array.isArray(d) ? d
      : Array.isArray(d.items) ? d.items
      : Array.isArray(d.market) ? d.market
      : [];
    marketItems.value = raw.map((i: any) => ({
      item_id:      i.item_id || i.id || '',
      item_name:    i.name || i.item_name || (i.item_id || '').replace(/_/g, ' '),
      buy_price:    i.buy_price ?? i.buy ?? null,
      buy_quantity: i.buy_quantity ?? i.buy_volume ?? 0,
      sell_price:   i.sell_price ?? i.sell ?? null,
      sell_quantity:i.sell_quantity ?? i.sell_volume ?? 0,
    })).filter((i: any) => i.item_id).sort((a: any, b: any) => (a.item_name || '').localeCompare(b.item_name || ''));
  } finally {
    marketLoading.value = false;
  }
}

function switchToMarket(): void {
  tab.value = 'market';
  if (!marketItems.value.length) loadMarket();
}

const marketTradeQty = ref(1);
const marketActionItem = ref<string | null>(null);
const marketActionType = ref<'buy' | 'sell' | null>(null);
const marketTradeResult = ref<{ ok: boolean; message: string } | null>(null);

async function execMarketBuy(item: any): Promise<void> {
  const qty = marketTradeQty.value || 1;
  marketActionItem.value = item.item_id;
  marketActionType.value = 'buy';
  marketTradeResult.value = null;
  try {
    const buyRes = await execAsync('buy', { item_id: item.item_id, quantity: qty });
    if (!buyRes.ok) { marketTradeResult.value = { ok: false, message: buyRes.error || 'Buy failed' }; return; }
    const deposited = await execAsync('faction_deposit_items', { item_id: item.item_id, quantity: qty });
    if (!deposited.ok) await execAsync('deposit_items', { item_id: item.item_id, quantity: qty });
    marketTradeResult.value = { ok: true, message: `Bought ${qty}× ${item.item_name} → deposited to storage` };
  } catch (e: any) {
    marketTradeResult.value = { ok: false, message: e.message || 'Error' };
  } finally {
    marketActionItem.value = null;
    marketActionType.value = null;
  }
}

async function execMarketSell(item: any): Promise<void> {
  const qty = marketTradeQty.value || 1;
  marketActionItem.value = item.item_id;
  marketActionType.value = 'sell';
  marketTradeResult.value = null;
  try {
    const withdrawn = await execAsync('faction_withdraw_items', { item_id: item.item_id, quantity: qty });
    if (!withdrawn.ok) {
      const altWithdraw = await execAsync('withdraw_items', { item_id: item.item_id, quantity: qty });
      if (!altWithdraw.ok) { marketTradeResult.value = { ok: false, message: `Nothing in storage: ${withdrawn.error || altWithdraw.error}` }; return; }
    }
    const sellRes = await execAsync('sell', { item_id: item.item_id, quantity: qty });
    if (!sellRes.ok) { marketTradeResult.value = { ok: false, message: sellRes.error || 'Sell failed' }; return; }
    marketTradeResult.value = { ok: true, message: `Sold ${qty}× ${item.item_name} for ${((sellRes.data?.credits_earned ?? sellRes.data?.total_value ?? 0) as number).toLocaleString()} cr` };
  } catch (e: any) {
    marketTradeResult.value = { ok: false, message: e.message || 'Error' };
  } finally {
    marketActionItem.value = null;
    marketActionType.value = null;
  }
}

const chatChannel = ref<string>('system');
const chatMessages = ref<any[]>([]);
const chatLoading = ref(false);
const chatTotal = ref(0);
const chatPage = ref(1);

function switchToChat(): void {
  tab.value = 'chat';
  if (!chatMessages.value.length) loadChat(true);
}

function selectChatChannel(ch: string): void {
  chatChannel.value = ch;
  chatMessages.value = [];
  chatTotal.value = 0;
  chatPage.value = 1;
  loadChat(true);
}

async function loadChat(reset: boolean): Promise<void> {
  if (chatLoading.value) return;
  if (reset) { chatMessages.value = []; chatTotal.value = 0; chatPage.value = 1; }
  chatLoading.value = true;
  try {
    const res = await execAsync('get_chat_history', { channel: chatChannel.value, page: chatPage.value, limit: 50 });
    if (!res.ok) { notif(res.error || 'Failed to load chat', 'error'); return; }
    const d = res.data || {};
    const msgs: any[] = d.messages || d.chat || (Array.isArray(d) ? d : []);
    chatTotal.value = d.total ?? d.total_count ?? msgs.length;
    if (reset) {
      chatMessages.value = msgs;
    } else {
      chatMessages.value = [...chatMessages.value, ...msgs];
      chatPage.value++;
    }
  } finally {
    chatLoading.value = false;
  }
}

function formatChatTime(ts: string | number | undefined): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  } catch { return String(ts); }
}
function getBotGoals(username: string): any[] {
  const s = (botStore.settings as any)?.[username] || {};
  if (s.goals?.length) return s.goals;
  if (s.goal) return [s.goal];
  return [];
}

const currentGathererGoals = computed(() => {
  const bot = currentBot.value as any;
  return getBotGoals(props.bot.username).map((goal: any) => {
    const materials = (goal.materials || []).map((m: any) => {
      const inFaction = (bot.factionStorage || []).find((i: any) => i.itemId === m.item_id)?.quantity ?? 0;
      const inCargo = (bot.inventory || []).find((i: any) => i.itemId === m.item_id)?.quantity ?? 0;
      const collected = Math.min(inFaction + inCargo, m.quantity_needed);
      const pct = m.quantity_needed > 0 ? Math.round(collected / m.quantity_needed * 100) : 0;
      return { ...m, collected, pct };
    });
    const totalNeeded = materials.reduce((s: number, m: any) => s + m.quantity_needed, 0);
    const totalCollected = materials.reduce((s: number, m: any) => s + m.collected, 0);
    const overallPct = totalNeeded > 0 ? Math.round(totalCollected / totalNeeded * 100) : 0;
    return { ...goal, materials, overallPct };
  });
});

function clearGathererGoalById(goalId: string): void {
  const filtered = getBotGoals(props.bot.username).filter((g: any) => g.id !== goalId);
  botStore.saveSettings(props.bot.username, { goals: filtered, goal: null });
}

const stationInfo = computed(() => {
  const bot = currentBot.value;
  if (!bot || !(botStore as any).publicStations?.length) return null;
  return (botStore as any).publicStations.find((st: any) =>
    st.id === (bot as any).poi || st.system_id === (bot as any).system
  ) || null;
});

const filteredStation = computed(() => {
  const q = stationSearch.value.toLowerCase().trim();
  const src = q
    ? stationFacilities.value.filter((f: any) =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q) ||
        (f.category || '').toLowerCase().includes(q)
      )
    : stationFacilities.value;
  return [...src].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
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
  if (!bot?.poi || !bot?.system) {
    notif('Bot must be docked at the target station when setting a Build goal', 'warn');
    return;
  }
  const newGoal = {
    id: `goal_${t.id}_${Date.now()}`,
    target_id: t.id,
    target_name: t.name,
    goal_type: 'build',
    target_poi: bot.poi,
    target_system: bot.system,
    materials: mats.map((m: any) => ({
      item_id: m.item_id || '',
      item_name: m.name || m.item_name || (m.item_id || '').replace(/_/g, ' '),
      quantity_needed: m.quantity || m.quantity_needed || 1,
    })),
  };
  const existing = getBotGoals(props.bot.username);
  botStore.saveSettings(props.bot.username, { goals: [...existing, newGoal], goal: null });
  notif(`Gather goal added: ${t.name} (×${mats.length} material type${mats.length > 1 ? 's' : ''})`, 'success');
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
  loadFactionCache();
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
