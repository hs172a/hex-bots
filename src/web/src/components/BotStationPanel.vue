<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <div v-if="!currentBot.docked" class="flex items-center justify-center h-32 text-center">
      <div><div class="text-3xl mb-2">🏠</div><div class="text-space-text-dim text-sm">Dock at a station to view station info</div></div>
    </div>
    <template v-else>
      <!-- Station info card from catalog -->
      <div v-if="stationInfo" class="card py-2 px-3">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div>
            <div class="text-sm font-semibold text-space-text-bright">{{ stationInfo.name }}</div>
            <div class="text-xs text-space-text-dim">{{ stationInfo.empire_name }} · {{ stationInfo.system_name }}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-xs px-2 py-0.5 rounded" :class="stationInfo.condition === 'operational' ? 'bg-green-900/40 text-space-green' : 'bg-yellow-900/30 text-yellow-400'">{{ stationInfo.condition }}</span>
            <div class="text-[10px] text-space-text-dim mt-0.5">{{ stationInfo.satisfaction_pct }}% satisfaction</div>
          </div>
        </div>
        <div class="text-xs text-space-text-dim leading-relaxed mb-2">{{ stationInfo.description }}</div>
        <div v-if="stationInfo.condition_text && stationInfo.condition !== 'operational'" class="text-xs text-yellow-400 mb-2">⚠️ {{ stationInfo.condition_text }}</div>
        <div class="flex flex-wrap gap-1">
          <span v-for="svc in stationInfo.services" :key="svc" class="px-1.5 py-0.5 rounded text-[10px] bg-[#21262d] text-space-cyan">{{ svc }}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] bg-[#21262d] text-space-text-dim">🏭 {{ stationInfo.facility_count }} facilities</span>
          <span v-if="stationInfo.defense_level" class="px-1.5 py-0.5 rounded text-[10px] bg-[#21262d] text-space-text-dim">🛡️ Def {{ stationInfo.defense_level }}</span>
        </div>
      </div>
      <div v-else class="card py-2 px-3 text-xs text-space-text-dim italic">Station catalog info not available for this location.</div>

      <!-- Facility panels -->
      <div class="card py-2 px-3">
        <div class="flex items-center justify-between border-b border-space-border pb-2 mb-2">
          <div class="flex gap-0.5 flex-wrap">
            <button @click="facilitySubTab = 'station'" class="px-2 py-0.5 text-xs rounded transition-colors" :class="facilitySubTab === 'station' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">🏢 Station</button>
            <button @click="facilitySubTab = 'player'" class="px-2 py-0.5 text-xs rounded transition-colors" :class="facilitySubTab === 'player' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">👤 Personal{{ myPlayerFacilities.length ? ' ★'+myPlayerFacilities.length : facilities.player.length ? ' ('+facilities.player.length+')' : '' }}</button>
            <button @click="facilitySubTab = 'faction'" class="px-2 py-0.5 text-xs rounded transition-colors" :class="facilitySubTab === 'faction' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">⚑ Faction{{ myFactionFacilities.length ? ' ★'+myFactionFacilities.length : facilities.faction.length ? ' ('+facilities.faction.length+')' : '' }}</button>
            <button @click="facilitySubTab = 'build'; buildableTypes.length === 0 && loadBuildableTypes()" class="px-2 py-0.5 text-xs rounded transition-colors" :class="facilitySubTab === 'build' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">🔨 Build</button>
          </div>
          <button @click="loadFacilities" :disabled="facilityLoading" class="btn btn-secondary text-xs py-0 px-2">{{ facilityLoading ? '⏳' : '🔄' }}</button>
        </div>

        <div v-if="facilityLoading && facilitySubTab !== 'build'" class="text-xs text-space-text-dim italic py-4 text-center">Loading facilities...</div>

        <!-- Station Facilities -->
        <div v-else-if="facilitySubTab === 'station'" class="space-y-2 max-h-[28rem] overflow-auto scrollbar-dark">
          <div v-if="!facilities.station.length" class="text-xs text-space-text-dim italic py-4 text-center">No data — click 🔄 to fetch.</div>
          <div v-for="f in facilities.station" :key="f.facility_id" class="bg-[#21262d] rounded-md p-2 text-xs">
            <div class="flex items-start justify-between gap-2 mb-1">
              <div class="font-medium text-space-text flex items-center gap-1">{{ f.name }}<span class="text-space-text-dim/40 hover:text-space-text-dim cursor-help select-none text-[10px]" @mouseenter="onFacilityHover($event, f.facility_type || f.type)" @mouseleave="onFacilityLeave">ⓘ</span></div>
              <div class="flex gap-1 shrink-0">
                <span class="px-1.5 py-0.5 rounded text-[10px]" :class="f.category === 'service' ? 'bg-blue-900/30 text-blue-400' : f.category === 'production' ? 'bg-amber-900/30 text-amber-400' : f.category === 'infrastructure' ? 'bg-purple-900/30 text-purple-400' : 'bg-[#30363d] text-space-text-dim'">{{ f.category }}</span>
                <span v-if="!f.maintenance_satisfied" class="px-1.5 py-0.5 rounded text-[10px] bg-yellow-900/30 text-yellow-400">⚠️ maint</span>
                <span v-if="!f.active" class="px-1.5 py-0.5 rounded text-[10px] bg-red-900/30 text-space-red">offline</span>
              </div>
            </div>
            <div class="text-space-text-dim leading-relaxed">{{ f.description }}</div>
            <div v-if="f.service" class="text-[10px] text-space-cyan mt-1">✦ {{ f.service }}</div>
            <div v-if="f.recipe_id" class="text-[10px] text-space-accent mt-1">⚗️ {{ f.recipe_id }}</div>
          </div>
        </div>

        <!-- Player Facilities -->
        <div v-else-if="facilitySubTab === 'player'" class="space-y-3 max-h-[28rem] overflow-auto scrollbar-dark">
          <div v-if="!facilities.player.length" class="text-xs text-space-text-dim italic py-4 text-center">No data — click 🔄 to fetch.</div>
          <template v-else>
            <!-- Own facilities -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-space-green flex items-center gap-1">
                ★ Your Facilities <span class="font-normal text-space-text-dim">({{ myPlayerFacilities.length }})</span>
              </div>
              <div v-if="!myPlayerFacilities.length" class="text-xs text-space-text-dim italic py-2 px-2 bg-[#1a1f27] rounded border border-dashed border-space-border">
                No facilities at this station — use 🔨 Build to rent your first one.
              </div>
              <div v-else class="space-y-1.5">
                <div v-for="f in myPlayerFacilities" :key="f.facility_id" class="bg-[#21262d] border border-green-900/40 rounded-md p-2 text-xs">
                  <div class="flex items-start justify-between gap-2 mb-1">
                    <div class="font-medium text-space-text flex items-center gap-1">{{ f.name }}<span class="text-space-text-dim/40 hover:text-space-text-dim cursor-help select-none text-[10px]" @mouseenter="onFacilityHover($event, f.facility_type || f.type)" @mouseleave="onFacilityLeave">ⓘ</span></div>
                    <span class="px-1.5 py-0.5 rounded text-[10px] shrink-0" :class="f.active && f.maintenance_satisfied ? 'bg-green-900/30 text-space-green' : !f.active ? 'bg-red-900/30 text-space-red' : 'bg-yellow-900/30 text-yellow-400'">{{ f.active ? (f.maintenance_satisfied ? 'active' : '⚠️ degraded') : 'offline' }}</span>
                  </div>
                  <div class="flex flex-wrap gap-3 text-[10px]">
                    <span v-if="f.rent_per_cycle" class="text-space-yellow">💰 {{ f.rent_per_cycle }} cr/cycle</span>
                    <span v-if="f.bonus_type" class="text-space-cyan">+{{ f.bonus_value }} {{ f.bonus_type.replace(/_/g,' ') }}</span>
                    <span v-if="f.personal_service" class="text-space-accent">{{ f.personal_service.replace(/_/g,' ') }}</span>
                    <span v-if="f.recipe_id" class="text-space-accent">⚗️ {{ f.recipe_id }}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Others' facilities -->
            <div v-if="othersPlayerFacilities.length">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-space-text-dim">
                Others at this Station ({{ othersPlayerFacilities.length }})
              </div>
              <div class="space-y-1">
                <div v-for="f in othersPlayerFacilities" :key="f.facility_id"
                  class="bg-[#1a1f27] rounded-md p-1.5 text-xs opacity-60 flex items-center justify-between gap-2"
                  @mouseenter="f.owner_id ? onPlayerHover($event, f.owner_id) : undefined"
                  @mouseleave="onPlayerLeave()">
                  <div class="font-medium text-space-text-dim flex items-center gap-1 truncate">{{ f.name }}<span class="shrink-0 text-space-text-dim/40 hover:text-space-text-dim cursor-help select-none text-[10px]" @mouseenter.stop="onFacilityHover($event, f.facility_type || f.type)" @mouseleave.stop="onFacilityLeave">ⓘ</span></div>
                  <div class="flex gap-2 shrink-0 text-[10px]">
                    <span v-if="f.owner_id" class="text-space-text-dim/50 cursor-help" title="Hover row for player info">👤</span>
                    <span v-if="f.bonus_type" class="text-space-cyan">+{{ f.bonus_value }} {{ f.bonus_type.replace(/_/g,' ') }}</span>
                    <span v-if="f.rent_per_cycle" class="text-space-yellow">{{ f.rent_per_cycle }}cr</span>
                    <span v-if="f.recipe_id" class="text-space-accent">⚗️ {{ f.recipe_id }}</span>
                    <span v-if="f.personal_service" class="text-space-text-dim">{{ f.personal_service.replace(/_/g,' ') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Faction Facilities -->
        <div v-else-if="facilitySubTab === 'faction'" class="space-y-3 max-h-[28rem] overflow-auto scrollbar-dark">
          <div v-if="!facilities.faction.length" class="text-xs text-space-text-dim italic py-4 text-center">No data — click 🔄 to fetch.</div>
          <template v-else>
            <!-- Own faction facilities -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-purple-400 flex items-center gap-1">
                ⚑ Your Faction <span class="font-normal text-space-text-dim">({{ myFactionFacilities.length }})</span>
              </div>
              <div v-if="!myFactionFacilities.length" class="text-xs text-space-text-dim italic py-2 px-2 bg-[#1a1f27] rounded border border-dashed border-space-border">
                {{ botFactionId ? 'Your faction has no facilities at this station.' : 'Faction unknown — fetch status first.' }}
              </div>
              <div v-else class="space-y-1.5">
                <div v-for="f in myFactionFacilities" :key="f.facility_id" class="bg-[#21262d] border border-purple-900/40 rounded-md p-2 text-xs">
                  <div class="flex items-start justify-between gap-2 mb-0.5">
                    <div class="font-medium text-space-text flex items-center gap-1">{{ f.name }}<span class="text-space-text-dim/40 hover:text-space-text-dim cursor-help select-none text-[10px]" @mouseenter="onFacilityHover($event, f.facility_type || f.type)" @mouseleave="onFacilityLeave">ⓘ</span></div>
                    <div class="flex gap-1 shrink-0">
                      <span v-if="!f.maintenance_satisfied" class="px-1.5 py-0.5 rounded text-[10px] bg-yellow-900/30 text-yellow-400">⚠️ maint</span>
                      <span class="px-1.5 py-0.5 rounded text-[10px]" :class="f.active ? 'bg-purple-900/30 text-purple-400' : 'bg-red-900/30 text-space-red'">{{ f.active ? 'active' : 'offline' }}</span>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-3 text-[10px]">
                    <span v-if="f.faction_service" class="text-space-cyan">{{ f.faction_service.replace(/_/g,' ') }}</span>
                    <span v-if="f.capacity" class="text-space-text-dim">Cap: {{ f.capacity }}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Other factions' facilities -->
            <div v-if="otherFactionFacilities.length">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-space-text-dim">
                Other Factions ({{ otherFactionFacilities.length }})
              </div>
              <div class="space-y-1">
                <div v-for="f in otherFactionFacilities" :key="f.facility_id" class="bg-[#1a1f27] rounded-md p-1.5 text-xs opacity-60 flex items-center justify-between gap-2">
                  <div class="font-medium text-space-text-dim flex items-center gap-1 truncate">{{ f.name }}<span class="shrink-0 text-space-text-dim/40 hover:text-space-text-dim cursor-help select-none text-[10px]" @mouseenter="onFacilityHover($event, f.facility_type || f.type)" @mouseleave="onFacilityLeave">ⓘ</span></div>
                  <div class="flex gap-2 shrink-0 text-[10px]">
                    <span v-if="f.faction_service" class="text-space-text-dim">{{ f.faction_service.replace(/_/g,' ') }}</span>
                    <span v-if="f.capacity" class="text-space-text-dim">Cap:{{ f.capacity }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Build Tab -->
        <div v-else-if="facilitySubTab === 'build'">
          <div class="flex gap-2 mb-2">
            <select v-model="buildCategoryFilter" @change="loadBuildableTypes(buildCategoryFilter)" class="input text-xs py-1 flex-1">
              <option value="">All categories</option>
              <option value="personal">Personal</option>
              <option value="production">Production</option>
              <option value="faction">Faction</option>
            </select>
            <button @click="loadBuildableTypes(buildCategoryFilter)" :disabled="buildableLoading" class="btn btn-secondary text-xs py-0 px-2">{{ buildableLoading ? '⏳' : '🔄' }}</button>
          </div>
          <div v-if="buildableLoading" class="text-xs text-space-text-dim italic py-4 text-center">Loading...</div>
          <div v-else-if="!buildableTypes.length" class="text-xs text-space-text-dim italic py-4 text-center">Click 🔄 to load buildable types.</div>
          <div v-else class="space-y-2 max-h-[28rem] overflow-auto scrollbar-dark">
            <div v-for="t in buildableTypes" :key="t.id" class="bg-[#21262d] rounded-md p-2 text-xs flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-medium text-space-text flex items-center gap-1">{{ t.name }}<span class="text-space-text-dim/40 hover:text-space-text-dim cursor-help select-none text-[10px]" @mouseenter="onFacilityHover($event, t.id)" @mouseleave="onFacilityLeave">ⓘ</span></div>
                <div class="flex flex-wrap gap-2 mt-0.5 text-[10px]">
                  <span class="text-space-text-dim">Lv{{ t.level }}</span>
                  <span class="text-space-text-dim">{{ t.category }}</span>
                  <span v-if="t.bonus_type" class="text-space-cyan">+{{ t.bonus_value }} {{ t.bonus_type.replace(/_/g,' ') }}</span>
                  <span v-if="t.personal_service" class="text-space-accent">{{ t.personal_service.replace(/_/g,' ') }}</span>
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-space-yellow text-[10px] mb-1">{{ t.build_cost?.toLocaleString() }} cr</div>
                <div class="flex flex-col gap-1 items-end">
                  <button
                    v-if="t.buildable !== false"
                    @click="buildFacility(t.id)"
                    :disabled="facilityLoading || currentGatherGoal?.target_id === t.id || getFacilityState(t) === 'built' || (!!facilityTypeCache[t.id]?.build_materials?.length && !hasMaterialsInCargo(t.id))"
                    class="btn btn-primary text-[10px] px-2 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    :title="currentGatherGoal?.target_id === t.id ? 'Gathering materials...' : (facilityTypeCache[t.id]?.build_materials?.length && !hasMaterialsInCargo(t.id)) ? 'Gather materials first' : ''">{{ getFacilityState(t) === 'built' ? '✓ Built' : getFacilityState(t) === 'upgrade' ? '⬆ Upgrade' : 'Build' }}</button>
                  <span v-else class="text-[10px] text-space-text-dim italic">not buildable</span>
                  <span v-if="currentGatherGoal?.target_id === t.id" class="text-[10px] text-space-cyan whitespace-nowrap flex items-center gap-1">
                    ⚙️ Gathering
                    <button @click="clearGatherGoal()" class="text-space-red hover:text-red-400 text-[10px]" title="Cancel goal">✕</button>
                  </span>
                  <button
                    v-else-if="t.buildable !== false && !(facilityTypeCache[t.id] && (!facilityTypeCache[t.id].build_materials?.length || hasMaterialsInCargo(t.id)))"
                    @click="gatherFacilityMaterials(t)"
                    class="btn btn-secondary text-[10px] px-2 py-0.5 whitespace-nowrap">📦 Gather</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Player profile tooltip -->
    <Teleport to="body">
      <div v-if="playerTooltipVisible"
        class="fixed z-[9999] w-72 bg-[#0d1117] border border-space-border rounded-lg shadow-2xl pointer-events-none text-xs"
        :style="{ top: playerTooltipPos.y + 'px', left: playerTooltipPos.x + 'px' }">
        <div v-if="playerTooltipLoading" class="p-3 text-space-text-dim text-center">Loading...</div>
        <template v-else-if="playerTooltipData && !playerTooltipData.error">
          <div class="flex items-center justify-between px-3 pt-3 pb-2 border-b border-space-border">
            <span class="font-semibold text-space-text">{{ playerTooltipData.username }}</span>
            <span class="text-[10px]" :class="playerTooltipData.online ? 'text-space-green' : 'text-space-text-dim'">{{ playerTooltipData.online ? '● online' : '○ offline' }}</span>
          </div>
          <div class="p-3 space-y-1 text-[10px] text-space-text-dim">
            <div class="flex gap-4">
              <span><span class="text-space-text-dim/50">Empire</span> {{ playerTooltipData.empire }}</span>
              <span><span class="text-space-text-dim/50">Credits</span> <span class="text-space-yellow">{{ playerTooltipData.credits?.toLocaleString() }}</span></span>
            </div>
            <div v-if="playerTooltipData.faction_name"><span class="text-space-text-dim/50">Faction</span> {{ playerTooltipData.faction_name }} <span class="text-space-accent">({{ playerTooltipData.faction_rank }})</span></div>
            <div><span class="text-space-text-dim/50">Location</span> {{ playerTooltipData.current_system }} / {{ playerTooltipData.current_poi }}</div>
            <div v-if="playerTooltipData.home_base"><span class="text-space-text-dim/50">Home</span> {{ playerTooltipData.home_base }}</div>
            <div v-if="playerTooltipData.ship" class="mt-2 pt-2 border-t border-space-border">
              <div class="text-space-text mb-1">🚀 {{ playerTooltipData.ship.name }} <span class="text-space-text-dim/60">({{ playerTooltipData.ship.class_id?.replace(/_/g,' ') }})</span></div>
              <div class="flex gap-3">
                <span>Hull {{ playerTooltipData.ship.hull }}/{{ playerTooltipData.ship.max_hull }}</span>
                <span>Fuel {{ playerTooltipData.ship.fuel }}/{{ playerTooltipData.ship.max_fuel }}</span>
              </div>
              <div>Cargo {{ playerTooltipData.ship.cargo_used }}/{{ playerTooltipData.ship.cargo_capacity }}</div>
            </div>
            <div v-if="playerTooltipData.skills && Object.keys(playerTooltipData.skills).length" class="mt-2 pt-2 border-t border-space-border">
              <div class="text-space-text mb-1">Skills</div>
              <div class="flex flex-wrap gap-1">
                <span v-for="(level, skill) in playerTooltipData.skills" :key="skill" class="px-1 py-0.5 rounded bg-[#21262d] text-[9px]">{{ String(skill).replace(/_/g,' ') }} <span class="text-space-yellow">{{ level }}</span></span>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="p-3 text-space-text-dim text-center text-[10px]">No profile data</div>
      </div>
    </Teleport>

    <!-- Facility type detail tooltip -->
    <Teleport to="body">
      <div v-if="facilityTooltipVisible && facilityTooltip"
        class="fixed z-[9998] w-80 bg-[#0d1117] border border-space-border rounded-lg shadow-2xl pointer-events-none text-xs"
        :style="{ top: facilityTooltipPos.y + 'px', left: facilityTooltipPos.x + 'px' }">
        <div class="p-3 space-y-2 max-h-[70vh] overflow-y-auto scrollbar-dark">
          <div v-if="facilityTooltip._loading" class="text-space-text-dim italic text-center py-2">Loading...</div>
          <template v-else>
            <div class="flex items-start justify-between gap-2">
              <div class="font-semibold text-space-text-bright leading-tight">{{ facilityTooltip.name }}</div>
              <div class="flex gap-1 shrink-0">
                <span v-if="facilityTooltip.level" class="px-1.5 py-0.5 rounded text-[10px] bg-[#21262d] text-space-text-dim">Lv{{ facilityTooltip.level }}</span>
                <span v-if="facilityTooltip.category" class="px-1.5 py-0.5 rounded text-[10px]" :class="facilityTooltip.category === 'personal' ? 'bg-green-900/30 text-space-green' : facilityTooltip.category === 'faction' ? 'bg-purple-900/30 text-purple-400' : 'bg-amber-900/30 text-amber-400'">{{ facilityTooltip.category }}</span>
                <span v-if="facilityTooltip.buildable === false" class="px-1.5 py-0.5 rounded text-[10px] bg-red-900/20 text-space-red">locked</span>
              </div>
            </div>
            <div v-if="facilityTooltip.description" class="text-space-text-dim leading-relaxed">{{ facilityTooltip.description }}</div>
            <div v-if="facilityTooltip.hint" class="bg-blue-950/40 border border-blue-900/40 rounded px-2 py-1.5 text-blue-300 leading-relaxed">
              💡 {{ facilityTooltip.hint }}
            </div>
            <div class="pt-1 border-t border-[#21262d] grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              <div v-if="facilityTooltip.build_cost != null" class="text-space-yellow">🏗️ {{ facilityTooltip.build_cost?.toLocaleString() }} cr</div>
              <div v-if="facilityTooltip.labor_cost" class="text-space-yellow">👷 {{ facilityTooltip.labor_cost }} cr labor</div>
              <div v-if="facilityTooltip.rent_per_cycle != null" class="text-space-yellow">🔄 {{ facilityTooltip.rent_per_cycle }} cr/cycle</div>
              <div v-if="facilityTooltip.build_time" class="text-space-text-dim">⏱️ {{ facilityTooltip.build_time }} cycles</div>
              <div v-if="facilityTooltip.bonus_type" class="text-space-cyan col-span-2">+{{ facilityTooltip.bonus_value }} {{ facilityTooltip.bonus_type?.replace(/_/g,' ') }}</div>
              <div v-if="facilityTooltip.personal_service" class="text-space-accent col-span-2">⚙️ {{ facilityTooltip.personal_service?.replace(/_/g,' ') }}</div>
              <div v-if="facilityTooltip.faction_service" class="text-purple-400 col-span-2">⚑ {{ facilityTooltip.faction_service?.replace(/_/g,' ') }}</div>
              <div v-if="facilityTooltip.recipe_id" class="text-space-accent col-span-2">⚗️ {{ facilityTooltip.recipe_id }}</div>
              <div v-if="facilityTooltip.capacity" class="text-space-text-dim">Cap: {{ facilityTooltip.capacity }}</div>
            </div>
            <div v-if="facilityTooltip.build_materials?.length" class="pt-1 border-t border-[#21262d]">
              <div class="text-[10px] text-space-text-dim uppercase tracking-wider mb-1">Build Materials</div>
              <div class="space-y-0.5">
                <div v-for="m in facilityTooltip.build_materials" :key="m.item_id" class="flex justify-between text-[10px]">
                  <span class="text-space-text">{{ m.name }}</span>
                  <span class="text-space-text-dim">×{{ m.quantity }}</span>
                </div>
              </div>
            </div>
            <div v-if="facilityTooltip.upgrades_from || facilityTooltip.upgrades_to" class="pt-1 border-t border-[#21262d] space-y-0.5 text-[10px]">
              <div v-if="facilityTooltip.upgrades_from" class="text-space-text-dim">⬆ From: <span class="text-space-text">{{ facilityTooltip.upgrades_from_name || facilityTooltip.upgrades_from }}</span></div>
              <div v-if="facilityTooltip.upgrades_to" class="text-space-cyan">→ Next: <span class="text-space-text">{{ facilityTooltip.upgrades_to_name || facilityTooltip.upgrades_to }}</span></div>
            </div>
            <div v-if="facilityTooltip.requirements && Object.keys(facilityTooltip.requirements).length" class="pt-1 border-t border-[#21262d]">
              <div class="text-[10px] text-space-text-dim uppercase tracking-wider mb-1">Requirements</div>
              <div v-for="(val, key) in facilityTooltip.requirements" :key="key" class="text-[10px] text-space-text-dim">{{ String(key).replace(/_/g,' ') }}: {{ val }}</div>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

const props = defineProps<{ bot: any }>();
const emit = defineEmits<{
  (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void;
}>();

const botStore = useBotStore();

// Facility state
const facilitySubTab = ref<'station' | 'player' | 'faction' | 'build'>('station');
const facilityLoading = ref(false);
const facilities = ref<{ station: any[]; player: any[]; faction: any[] }>({ station: [], player: [], faction: [] });
const buildableTypes = ref<any[]>([]);
const buildableLoading = ref(false);
const buildCategoryFilter = ref('');
const botPlayerId = ref('');
const botFactionId = ref('');
const facilityTypeCache = ref<Record<string, any>>({});
const facilityTooltip = ref<any>(null);
const facilityTooltipPos = ref({ x: 0, y: 0 });
const facilityTooltipVisible = ref(false);

// Player tooltip state
const playerInfoCache = ref(new Map<string, any>());
const playerTooltipData = ref<any>(null);
const playerTooltipPos = ref({ x: 0, y: 0 });
const playerTooltipVisible = ref(false);
const playerTooltipLoading = ref(false);

// Computed
const currentBot = computed(() => {
  const bot = botStore.bots.find(b => b.username === props.bot.username);
  return bot || props.bot;
});

const inventory = computed(() => currentBot.value.inventory || []);

const myPlayerFacilities = computed(() =>
  facilities.value.player.filter((f: any) =>
    f.yours === true || (botPlayerId.value && f.owner_id === botPlayerId.value)
  )
);

const othersPlayerFacilities = computed(() =>
  facilities.value.player.filter((f: any) =>
    f.yours !== true && (!botPlayerId.value || f.owner_id !== botPlayerId.value)
  )
);

const myFactionFacilities = computed(() => {
  if (!botFactionId.value) return [];
  return facilities.value.faction.filter((f: any) => f.faction_id === botFactionId.value);
});

const otherFactionFacilities = computed(() => {
  if (!botFactionId.value) return facilities.value.faction;
  return facilities.value.faction.filter((f: any) => f.faction_id !== botFactionId.value);
});

const currentGatherGoal = computed(() => (botStore.settings?.gatherer?.goal as any) || null);

const myBuiltFacilityTypeIds = computed(() =>
  new Set(myPlayerFacilities.value.map((f: any) => f.type).filter(Boolean))
);

const myBuiltServiceFacilities = computed(() => {
  const map = new Map<string, any>();
  myPlayerFacilities.value.forEach((f: any) => {
    const svc = f.personal_service || f.faction_service;
    if (svc) map.set(svc, f);
  });
  return map;
});

const stationInfo = computed(() => {
  const bot = currentBot.value;
  if (!bot || !botStore.publicStations.length) return null;
  const poi = (bot as any).poi || '';
  const sys = (bot as any).system || (bot as any).location || '';
  return botStore.publicStations.find((st: any) =>
    st.id === poi || st.system_id === sys
  ) || null;
});

// Helpers
function getFacilityState(t: any): 'built' | 'upgrade' | 'build' {
  if (myBuiltFacilityTypeIds.value.has(t.id)) return 'built';
  const svc = t.personal_service || t.faction_service
    || facilityTypeCache.value[t.id]?.personal_service
    || facilityTypeCache.value[t.id]?.faction_service;
  if (svc && myBuiltServiceFacilities.value.has(svc)) return 'upgrade';
  return 'build';
}

function hasMaterialsInCargo(typeId: string): boolean {
  const mats = facilityTypeCache.value[typeId]?.build_materials;
  if (!mats?.length) return true;
  return mats.every((m: any) => {
    const inCargo = inventory.value.find((i: any) => i.itemId === m.item_id);
    return inCargo && inCargo.quantity >= m.quantity;
  });
}

// Exec helpers
function execCommand(command: string, params?: any) {
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  if (command !== 'catalog')
    botStore.logs.push({ bot: username, type: 'info', message: `Executing: ${command}${params ? ' ' + JSON.stringify(params) : ''}` });
  botStore.sendExec(username, command, params, (result: any) => {
    if (result.ok) {
      if (command !== 'catalog')
        botStore.logs.push({ bot: username, type: 'success', message: `${command}: OK` });
      processExecResult(command, result.data);
    } else {
      const errMsg = result.error || 'Unknown error';
      botStore.logs.push({ bot: username, type: 'error', message: `${command}: ${errMsg}` });
      emit('notif', errMsg, 'error');
    }
  });
}

function execAsync(command: string, params?: any): Promise<any> {
  return new Promise((resolve) => {
    const username = currentBot.value?.username;
    if (!username) return resolve({ ok: false, error: 'No bot selected' });
    botStore.sendExec(username, command, params, (result: any) => resolve(result));
  });
}

function showNotif(text: string, type: 'success' | 'warn' | 'error') {
  emit('notif', text, type);
}

function processExecResult(command: string, data: any) {
  if (!data) return;
  switch (command) {
    case 'get_status': {
      if (data.player_id) botPlayerId.value = data.player_id;
      if (data.faction?.id) botFactionId.value = data.faction.id;
      else if (data.faction_id) botFactionId.value = data.faction_id;
      break;
    }
    case 'facility': {
      if (data?.station_facilities !== undefined || data?.player_facilities !== undefined) {
        facilities.value = {
          station: data.station_facilities || [],
          player: data.player_facilities || [],
          faction: data.faction_facilities || [],
        };
        if (!botPlayerId.value) {
          const mine = (data.player_facilities || []).find((f: any) => f.yours === true);
          if (mine?.owner_id) botPlayerId.value = mine.owner_id;
        }
        facilityLoading.value = false;
      } else if (data?.types !== undefined) {
        buildableTypes.value = [...buildableTypes.value, ...(data.types || [])];
        buildableLoading.value = false;
        if ((data.page || 1) < (data.total_pages || 1) && data.types.length > 0) {
          const nextParams: any = { action: 'types', page: (data.page || 1) + 1 };
          if (buildCategoryFilter.value) nextParams.category = buildCategoryFilter.value;
          execCommand('facility', nextParams);
        }
      } else if (data?.result?.facility_name) {
        const built = data.result;
        const xpStr = built.skill_xp
          ? ' +' + Object.entries(built.skill_xp).map(([k, v]) => `${v} ${k}`).join(', ')
          : '';
        showNotif(built.hint || `✅ Built ${built.facility_name}!${xpStr}`, 'success');
        buildableTypes.value = buildableTypes.value.filter((t: any) => t.id !== built.facility_type);
        const builtAction = built.action as string;
        facilitySubTab.value = builtAction === 'faction_build' ? 'faction' : 'player';
        loadFacilities();
      }
      break;
    }
  }
}

// Facility actions
function loadFacilities() {
  facilityLoading.value = true;
  execCommand('facility', { action: 'list' });
}

function loadBuildableTypes(category = '') {
  buildableLoading.value = true;
  buildableTypes.value = [];
  buildCategoryFilter.value = category;
  const params: any = { action: 'types', page: 1 };
  if (category) params.category = category;
  execCommand('facility', params);
}

function buildFacility(typeId: string) {
  const info = facilityTypeCache.value[typeId] || buildableTypes.value.find((t: any) => t.id === typeId);
  const category = info?.category || '';
  const svc = info?.personal_service || info?.faction_service || '';
  const existingFacility = svc ? myBuiltServiceFacilities.value.get(svc) : null;
  if (existingFacility && !myBuiltFacilityTypeIds.value.has(typeId)) {
    execCommand('facility', { action: 'upgrade', facility_id: existingFacility.facility_id, facility_type: typeId });
  } else {
    const action = category === 'personal' ? 'personal_build'
      : category === 'faction' ? 'faction_build'
      : 'build';
    execCommand('facility', { action, facility_type: typeId });
  }
}

async function onFacilityHover(e: MouseEvent, typeId: string | undefined) {
  if (!typeId) return;
  facilityTooltipVisible.value = true;
  const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
  facilityTooltipPos.value = {
    x: Math.min(el.right + 8, window.innerWidth - 328),
    y: Math.max(4, Math.min(el.top, window.innerHeight - 280)),
  };
  if (facilityTypeCache.value[typeId]) {
    facilityTooltip.value = facilityTypeCache.value[typeId];
    return;
  }
  facilityTooltip.value = { _loading: true };
  const result = await execAsync('facility', { action: 'types', facility_type: typeId });
  if (result.ok && result.data) {
    const info = (result.data.types || [])[0] ?? result.data;
    facilityTypeCache.value[typeId] = info;
    if (facilityTooltipVisible.value) facilityTooltip.value = info;
  }
}

function onFacilityLeave() {
  facilityTooltipVisible.value = false;
}

// Gather goal actions
async function gatherFacilityMaterials(t: any) {
  const username = currentBot.value?.username;
  if (!username) return;

  let mats = t.build_materials as { item_id: string; name: string; quantity: number }[] | undefined;

  if (!mats?.length) {
    if (!facilityTypeCache.value[t.id]) {
      const result = await execAsync('facility', { action: 'types', facility_type: t.id });
      if (result.ok && result.data) {
        const info = (result.data.types || [])[0] ?? result.data;
        facilityTypeCache.value[t.id] = info;
      }
    }
    mats = facilityTypeCache.value[t.id]?.build_materials;
  }

  if (!mats?.length) {
    showNotif(`No build materials defined for ${t.name}`, 'warn');
    return;
  }

  const bot = currentBot.value;
  botStore.saveSettings('gatherer', {
    goal: {
      id: `factory_${t.id}_${Date.now()}`,
      target_id: t.id,
      target_name: t.name,
      target_poi: bot?.poi || '',
      target_system: bot?.system || (bot as any)?.location || '',
      materials: mats.map(m => ({
        item_id: m.item_id,
        item_name: m.name,
        quantity_needed: m.quantity,
      })),
    },
  });

  showNotif(`📦 Gather goal created: ${t.name}`, 'success');
}

function clearGatherGoal() {
  botStore.saveSettings('gatherer', { goal: null });
  showNotif('Gather goal cleared', 'warn');
}

// Player tooltip
async function onPlayerHover(e: MouseEvent, ownerId: string | undefined) {
  if (!ownerId) return;
  playerTooltipVisible.value = true;
  playerTooltipLoading.value = true;
  playerTooltipData.value = playerInfoCache.value.get(ownerId) || null;
  const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
  playerTooltipPos.value = {
    x: Math.min(el.right + 8, window.innerWidth - 308),
    y: Math.max(4, Math.min(el.top, window.innerHeight - 360)),
  };
  if (playerInfoCache.value.has(ownerId)) {
    playerTooltipLoading.value = false;
    return;
  }
  try {
    const resp = await fetch(`/api/player-info/${ownerId}`);
    const data = await resp.json();
    playerInfoCache.value.set(ownerId, data);
    playerTooltipData.value = data;
  } catch {
    playerTooltipData.value = null;
  }
  playerTooltipLoading.value = false;
}

function onPlayerLeave() {
  playerTooltipVisible.value = false;
}

// Called by parent when switching to station tab
function maybeLoad() {
  if (!facilities.value.station.length) loadFacilities();
}

defineExpose({ maybeLoad });

onMounted(() => {
  execCommand('get_status');
});
</script>
