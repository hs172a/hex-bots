<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Shipyard</h3>
      </div>
      <div class="flex-1 overflow-auto p-2 scrollbar-dark">
        <div v-if="!selectedBot" class="text-[11px] text-space-text-dim italic p-2 text-center">Select a character</div>
        <!-- Panel navigation -->
        <div v-if="selectedBot">
          <div 
            v-for="p in panels" :key="p.id"
            @click="activePanel = p.id"
            class="w-full px-2 py-2 text-sm rounded-md cursor-pointer mb-0.5 border transition-colors"
            :class="activePanel === p.id 
              ? 'bg-[rgba(88,166,255,0.1)] border-space-accent text-space-accent' 
              : 'border-transparent text-space-text-dim hover:bg-space-row-hover hover:text-space-text'"
          >
            {{ p.label }}
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg overflow-auto p-2 scrollbar-dark">
      <div v-if="!selectedBot" class="text-space-text-dim italic text-sm py-8 text-center">
        Select a bot to manage ships.
      </div>

      <!-- Overview Panel -->
      <div v-else-if="activePanel === 'overview'">
        <div v-if="!shipData" class="text-xs text-space-text-dim italic py-4">Loading ship data...</div>
        <div v-else class="space-y-3">

          <!-- ── Header ── -->
          <div class="bg-deep-bg border border-[#21262d] rounded-md overflow-hidden">
            <!-- Ship image banner -->
            <div v-if="shipClass" class="relative h-32 bg-[#0d1117] overflow-hidden">
              <img :src="shipImageUrl(shipClass)" :alt="shipName"
                class="w-full h-full object-cover opacity-70"
                @error="($event.target as HTMLImageElement).style.display='none'" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#0d1117] via-[#0d1117]/40 to-transparent"></div>
              <div class="absolute bottom-2 left-3 flex items-center gap-2">
                <span v-if="currentBot?.empire" :title="empireName(currentBot.empire)" class="text-lg leading-none">{{ empireIcon(currentBot.empire) }}</span>
                <div class="text-base font-bold text-white drop-shadow">{{ shipName }}</div>
              </div>
            </div>
            <div class="p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div v-if="!shipClass" class="flex items-center gap-2 mb-0.5">
                    <span v-if="currentBot?.empire" :title="empireName(currentBot.empire)" class="text-base leading-none shrink-0">{{ empireIcon(currentBot.empire) }}</span>
                    <div class="text-base font-bold text-space-text-bright truncate">{{ shipName }}</div>
                  </div>
                  <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-space-text-dim mt-0.5">
                    <span v-if="shipClass">{{ shipClass }}</span>
                    <span v-if="shipTier">• Tier {{ shipTier }}</span>
                    <span v-if="ship.scale">• Scale {{ ship.scale }}</span>
                    <span v-if="currentShipCatalog?.empire_name">• {{ currentShipCatalog.empire_name }}</span>
                    <span v-if="currentShipCatalog?.starter_ship" class="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 font-medium">Starter</span>
                  </div>
                </div>
                <div class="text-right shrink-0 space-y-1">
                  <div class="text-space-yellow font-semibold">{{ fmt(botCredits) }} cr</div>
                  <div class="flex items-center justify-end gap-1.5 flex-wrap">
                    <span v-if="currentBot?.routine" class="text-[11px] px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim">{{ currentBot.routine }}</span>
                    <span class="text-[11px] px-1.5 py-0.5 rounded font-medium"
                      :class="currentBot?.state === 'running' ? 'bg-green-900/40 text-space-green'
                        : currentBot?.state === 'error' ? 'bg-red-900/40 text-space-red'
                        : currentBot?.state === 'paused' ? 'bg-yellow-900/30 text-space-yellow'
                        : 'bg-[#21262d] text-space-text-dim'">
                      {{ currentBot?.state || 'idle' }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3 mt-2 pt-2 border-t border-[#21262d] text-[11px] flex-wrap">
                <span class="text-space-text-dim">📍 {{ currentBot?.system || ship.system || '—' }}</span>
                <span v-if="currentBot?.poi" class="text-space-text-dim">→ {{ currentBot.poi }}</span>
                <span class="ml-auto px-1.5 py-0.5 rounded text-[11px] font-medium"
                  :class="isDocked ? 'bg-green-900/30 text-space-green' : 'bg-[#21262d] text-space-text-dim'">
                  {{ isDocked ? '🔒 Docked' : '🚀 In Space' }}
                </span>
              </div>
            </div>
          </div>

          <!-- ── Resource Bars ── -->
          <div class="bg-deep-bg border border-[#21262d] rounded-md p-3">
            <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-2">Ship Status</div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text-dim">❤️ Hull</span>
                  <span :class="hullPct > 50 ? 'text-space-green' : hullPct > 25 ? 'text-space-yellow' : 'text-space-red'">
                    {{ ship.hull ?? '?' }}/{{ ship.max_hull ?? ship.hull_max ?? '?' }} <span class="opacity-60">({{ hullPct }}%)</span>
                  </span>
                </div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="hullPct > 50 ? 'bg-space-green' : hullPct > 25 ? 'bg-space-yellow' : 'bg-space-red'" :style="{ width: hullPct + '%' }"></div>
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text-dim">🔵 Shield</span>
                  <span class="text-space-cyan">{{ ship.shield ?? '?' }}/{{ ship.max_shield ?? ship.shield_max ?? '?' }} <span class="opacity-60">({{ shieldPct }}%)</span></span>
                </div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-space-cyan rounded-full transition-all" :style="{ width: shieldPct + '%' }"></div>
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text-dim">⛽ Fuel</span>
                  <span :class="fuelPct > 30 ? 'text-space-cyan' : 'text-space-yellow'">
                    {{ ship.fuel ?? '?' }}/{{ ship.max_fuel ?? ship.fuel_max ?? '?' }} <span class="opacity-60">({{ fuelPct }}%)</span>
                  </span>
                </div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="fuelPct > 30 ? 'bg-space-cyan' : 'bg-space-yellow'" :style="{ width: fuelPct + '%' }"></div>
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text-dim">📦 Cargo</span>
                  <span class="text-space-yellow">
                    {{ ship.cargo_used ?? ship.cargo ?? 0 }}/{{ ship.cargo_capacity ?? ship.max_cargo ?? ship.cargo_max ?? 0 }} <span class="opacity-60">({{ cargoPct }}%)</span>
                  </span>
                </div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-space-yellow rounded-full transition-all" :style="{ width: cargoPct + '%' }"></div>
                </div>
              </div>
              <div v-if="ship.cpu_capacity">
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text-dim">🖥️ CPU</span>
                  <span class="text-purple-300">{{ ship.cpu_used ?? 0 }}/{{ ship.cpu_capacity }}</span>
                </div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-purple-500 rounded-full transition-all" :style="{ width: pct(ship.cpu_used ?? 0, ship.cpu_capacity) + '%' }"></div>
                </div>
              </div>
              <div v-if="ship.power_capacity">
                <div class="flex justify-between text-[11px] mb-0.5">
                  <span class="text-space-text-dim">⚡ Power</span>
                  <span class="text-amber-300">{{ ship.power_used ?? 0 }}/{{ ship.power_capacity }}</span>
                </div>
                <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-amber-400 rounded-full transition-all" :style="{ width: pct(ship.power_used ?? 0, ship.power_capacity) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Characteristics ── -->
          <div class="bg-deep-bg border border-[#21262d] rounded-md p-3">
            <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-2">Characteristics</div>
            <div class="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11px]">
              <div v-if="ship.speed != null || currentShipCatalog?.base_speed" class="flex justify-between gap-1">
                <span class="text-space-text-dim">💨 Speed</span>
                <span class="text-space-text font-medium">{{ ship.speed ?? currentShipCatalog?.base_speed ?? '—' }}</span>
              </div>
              <div v-if="ship.armor != null" class="flex justify-between gap-1">
                <span class="text-space-text-dim">🛡️ Armor</span>
                <span class="text-space-text font-medium">{{ ship.armor }}</span>
              </div>
              <div v-if="(ship.weapon_slots ?? currentShipCatalog?.weapon_slots) != null" class="flex justify-between gap-1">
                <span class="text-space-text-dim">⚔️ Wpn slots</span>
                <span class="text-space-text font-medium">{{ ship.weapon_slots ?? currentShipCatalog?.weapon_slots }}</span>
              </div>
              <div v-if="(ship.defense_slots ?? currentShipCatalog?.defense_slots) != null" class="flex justify-between gap-1">
                <span class="text-space-text-dim">🛡️ Def slots</span>
                <span class="text-space-text font-medium">{{ ship.defense_slots ?? currentShipCatalog?.defense_slots }}</span>
              </div>
              <div v-if="(ship.utility_slots ?? currentShipCatalog?.utility_slots) != null" class="flex justify-between gap-1">
                <span class="text-space-text-dim">🔧 Util slots</span>
                <span class="text-space-text font-medium">{{ ship.utility_slots ?? currentShipCatalog?.utility_slots }}</span>
              </div>
              <div v-if="!ship.cpu_capacity && currentShipCatalog?.cpu_capacity" class="flex justify-between gap-1">
                <span class="text-space-text-dim">🖥️ CPU cap</span>
                <span class="text-space-text font-medium">{{ currentShipCatalog.cpu_capacity }}</span>
              </div>
              <div v-if="currentShipCatalog?.base_hull" class="flex justify-between gap-1">
                <span class="text-space-text-dim">❤️ Base hull</span>
                <span class="text-space-text font-medium">{{ currentShipCatalog.base_hull }}</span>
              </div>
              <div v-if="currentShipCatalog?.base_shield" class="flex justify-between gap-1">
                <span class="text-space-text-dim">🔵 Base shield</span>
                <span class="text-space-text font-medium">{{ currentShipCatalog.base_shield }}</span>
              </div>
              <div v-if="currentShipCatalog?.base_fuel" class="flex justify-between gap-1">
                <span class="text-space-text-dim">⛽ Base fuel</span>
                <span class="text-space-text font-medium">{{ currentShipCatalog.base_fuel }}</span>
              </div>
              <div v-if="currentShipCatalog?.cargo_capacity" class="flex justify-between gap-1">
                <span class="text-space-text-dim">📦 Cargo cap</span>
                <span class="text-space-text font-medium">{{ currentShipCatalog.cargo_capacity }}</span>
              </div>
            </div>
          </div>

          <!-- ── Description ── -->
          <div v-if="currentShipCatalog?.description" class="bg-deep-bg border border-[#21262d] rounded-md p-3">
            <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-1.5">Description</div>
            <div class="text-xs text-space-text-dim leading-relaxed">{{ currentShipCatalog.description }}</div>
            <div class="flex flex-wrap gap-1 mt-2" v-if="currentShipCatalog.flavor_tags?.length">
              <span v-for="tag in currentShipCatalog.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[11px]">{{ tag }}</span>
            </div>
          </div>

          <!-- ── Quick Actions ── -->
          <div class="bg-deep-bg border border-[#21262d] rounded-md p-3">
            <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-2">Quick Actions</div>
            <div class="flex gap-2 flex-wrap">
              <button v-if="isDocked" @click="execCmd('repair')" :disabled="loading" class="btn text-xs px-3 py-1">🔧 Repair</button>
              <button v-if="isDocked" @click="execCmd('refuel')" :disabled="loading" class="btn text-xs px-3 py-1">⛽ Refuel</button>
              <button v-if="isDocked" @click="execCmd('undock')" :disabled="loading" class="btn text-xs px-3 py-1">🚀 Undock</button>
              <button v-else @click="execCmd('dock')" :disabled="loading" class="btn text-xs px-3 py-1">🔒 Dock</button>
              <button @click="fetchShipData(selectedBot!)" :disabled="loading" class="btn text-xs px-3 py-1">🔄 Refresh</button>
            </div>
            <div v-if="!isDocked" class="text-[11px] text-space-text-dim italic mt-1.5">Dock at a station to repair or refuel.</div>
            <!-- Rename ship (v0.200) -->
            <div class="mt-3 pt-3 border-t border-[#21262d]">
              <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-1.5">✏️ Rename Ship</div>
              <div class="flex gap-2 items-center">
                <input v-model="renameShipName" type="text" maxlength="32" minlength="3" placeholder="New name (3–32 chars, globally unique)…" class="input text-xs flex-1 !py-1" />
                <button @click="renameShip" :disabled="renameSaving || renameShipName.trim().length < 3" class="btn btn-primary text-xs px-3 py-1 shrink-0">{{ renameSaving ? '⏳' : '✏️ Rename' }}</button>
              </div>
              <div class="text-[11px] text-space-text-dim mt-1">Send empty name to clear custom name. Names are globally unique and visible to other players.</div>
            </div>
          </div>

          <!-- ── Modules ── -->
          <div class="bg-deep-bg border border-[#21262d] rounded-md p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider">Installed Modules</div>
              <span class="text-[11px] text-space-text-dim">{{ modules.length }} installed</span>
            </div>
            <div v-if="modules.length === 0" class="text-xs text-space-text-dim italic">No modules found</div>
            <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
              <div v-for="m in modules" :key="m.module_id || m.id" class="bg-[#0d1117] border border-[#21262d] rounded-md p-2">
                <div class="text-[11px] uppercase text-space-text-dim tracking-wider mb-0.5">{{ m.type || m.slot_type || m.category || m.slot || '—' }}</div>
                <div class="text-[11px] font-medium text-space-text leading-tight">{{ moduleName(m) }}</div>
                <div v-if="m.wear != null" class="text-[11px] text-space-text-dim mt-0.5">Wear: {{ m.wear }}{{ typeof m.wear === 'number' ? '%' : '' }}</div>
                <button v-if="isDocked" @click="uninstallMod(m.module_id || m.id)" class="text-[11px] mt-1.5 px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors w-full">Uninstall</button>
              </div>
            </div>
            <!-- Install from cargo -->
            <div v-if="isDocked && installableModules.length > 0" class="mt-3 pt-3 border-t border-[#21262d]">
              <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-1.5">Install from Cargo</div>
              <div class="space-y-1">
                <div v-for="m in installableModules" :key="m.itemId" class="flex items-center justify-between py-1 px-2 bg-[#0d1117] rounded border border-[#21262d] text-xs">
                  <span class="text-space-text text-[11px]">{{ m.name }}</span>
                  <button @click="installMod(m.itemId)" :disabled="loading" class="text-[11px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-green hover:text-space-green transition-colors">Install</button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Cargo hold ── -->
          <div v-if="currentBot?.inventory?.length" class="bg-deep-bg border border-[#21262d] rounded-md p-3">
            <div class="text-[11px] font-semibold text-space-text-dim uppercase tracking-wider mb-2">Cargo Hold</div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1">
              <div v-for="item in currentBot.inventory" :key="item.itemId || item.item_id" class="flex items-center justify-between text-[11px]">
                <span class="text-space-text-dim truncate">{{ item.name }}</span>
                <span class="text-space-text font-medium shrink-0 ml-2">×{{ item.quantity }}</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Fleet Panel -->
      <div v-else-if="activePanel === 'fleet'">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-space-text-bright">My Ships</h3>
          <button @click="loadFleet" :disabled="fleetLoading" class="btn text-xs px-2 py-0.5">{{ fleetLoading ? '⏳' : '🔄' }} Refresh</button>
        </div>
        <div v-if="fleetLoading" class="text-xs text-space-text-dim italic">Loading fleet...</div>
        <div v-else-if="fleet.length === 0" class="text-xs text-space-text-dim italic py-4">No ships found. Click Refresh to load.</div>
        <div v-else class="grid grid-cols-3 gap-3">
          <div v-for="s in fleet" :key="s.ship_id" class="bg-deep-bg border border-[#21262d] rounded-md text-xs overflow-hidden flex flex-col">
            <!-- Ship image strip -->
            <div class="relative h-20 bg-[#0d1117] overflow-hidden">
              <img :src="shipImageUrl(s.class_id)" :alt="s.class_name"
                class="w-full h-full object-cover opacity-60"
                @error="($event.target as HTMLImageElement).style.display='none'" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#0d1117] via-transparent to-transparent"></div>
              <div class="absolute bottom-1.5 left-2.5 flex items-center gap-1.5">
                <span class="font-semibold text-white text-xs drop-shadow">{{ s.class_name }}</span>
                <span class="text-[10px] text-white/60">{{ s.class_id }}</span>
              </div>
              <div class="absolute top-1.5 right-1.5 flex gap-1">
                <span v-if="s.is_active" class="px-1.5 py-0.5 rounded text-[11px] bg-[rgba(63,185,80,0.25)] text-space-green border border-space-green/40 backdrop-blur-sm">Active</span>
                <span v-if="s.starter_ship" class="px-1.5 py-0.5 rounded text-[11px] bg-blue-900/40 text-blue-300 border border-blue-500/30 backdrop-blur-sm">Starter</span>
              </div>
            </div>
            <div class="p-3">
            <!-- Resource bars -->
            <div class="space-y-1 mb-2">
              <div>
                <div class="flex justify-between text-[11px] text-space-text-dim mb-0.5">
                  <span>Hull</span><span>{{ s.hull_cur }}/{{ s.hull_max }}</span>
                </div>
                <div class="h-1 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="s.hull_max > 0 && s.hull_cur/s.hull_max > 0.5 ? 'bg-space-green' : 'bg-space-red'" :style="{ width: s.hull_max > 0 ? (s.hull_cur/s.hull_max*100)+'%' : '0%' }"></div>
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[11px] text-space-text-dim mb-0.5">
                  <span>Fuel</span><span>{{ s.fuel_cur }}/{{ s.fuel_max }}</span>
                </div>
                <div class="h-1 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-space-cyan rounded-full transition-all" :style="{ width: s.fuel_max > 0 ? (s.fuel_cur/s.fuel_max*100)+'%' : '0%' }"></div>
                </div>
              </div>
            </div>
            <!-- Details + actions -->
            <div class="space-y-1.5">
              <div class="text-[11px] text-space-text-dim flex flex-wrap gap-x-2">
                <span>⚙️ {{ s.modules }} mod</span>
                <span>📦 {{ s.cargo_used }}</span>
                <span class="truncate">📍 {{ s.location }}</span>
              </div>
              <div class="flex gap-1 flex-wrap">
                <button
                  v-if="s.can_switch && isDocked"
                  @click="switchShip(s.ship_id)"
                  :disabled="loading"
                  class="btn btn-primary text-[11px] px-2 py-0.5"
                >Switch</button>
                <template v-if="!s.is_active && !s.starter_ship && isDocked">
                  <template v-if="sellConfirmId === s.ship_id">
                    <button @click="sellShip(s.ship_id)" :disabled="loading"
                      class="text-[11px] px-2 py-0.5 rounded border border-space-red/60 text-space-red bg-red-900/20 hover:bg-red-900/40 transition-colors">
                      ✓ Sell
                    </button>
                    <button @click="sellConfirmId = ''" class="text-[11px] px-1.5 py-0.5 rounded border border-space-border text-space-text-dim hover:text-space-text transition-colors">✕</button>
                  </template>
                  <button v-else @click="sellConfirmId = s.ship_id" :disabled="loading"
                    class="text-[11px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors">
                    💰 Sell
                  </button>
                </template>
              </div>
              <!-- Transfer ship to player -->
              <div v-if="!s.is_active && !s.starter_ship && isDocked" class="flex gap-1 items-center pt-1 border-t border-[#21262d]">
                <input
                  :value="transferTargets[s.ship_id] || ''"
                  @input="transferTargets[s.ship_id] = ($event.target as HTMLInputElement).value"
                  type="text" placeholder="📤 Transfer to player…"
                  class="input text-[11px] flex-1 !py-0.5"
                />
                <button
                  @click="transferShip(s.ship_id)"
                  :disabled="loading || !(transferTargets[s.ship_id] || '').trim()"
                  class="text-[11px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-accent hover:text-space-accent transition-colors disabled:opacity-40 shrink-0"
                >🤝</button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Showroom Panel -->
      <div v-else-if="activePanel === 'showroom'">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-space-text-bright">Ship Showroom</h3>
          <span v-if="showroomLevel !== null" class="text-xs text-space-text-dim">Shipyard Level {{ showroomLevel }}</span>
        </div>
        <!-- Station description from catalog -->
        <div v-if="currentStationCatalog" class="mb-3 bg-deep-bg border border-[#21262d] rounded-md p-3 text-xs">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-space-text font-semibold">{{ currentStationCatalog.name }}</span>
            <span class="text-space-text-dim text-[11px]">{{ currentStationCatalog.empire_name }}</span>
            <span v-if="currentStationCatalog.condition" class="ml-auto text-[11px] px-1.5 py-0.5 rounded" :class="currentStationCatalog.condition === 'operational' ? 'bg-[rgba(63,185,80,0.1)] text-space-green' : 'bg-[rgba(248,81,73,0.1)] text-space-red'">{{ currentStationCatalog.condition }}</span>
          </div>
          <div class="text-space-text-dim leading-relaxed">{{ currentStationCatalog.description }}</div>
          <div v-if="currentStationCatalog.condition_text && currentStationCatalog.condition !== 'operational'" class="mt-1 text-space-red text-[11px]">{{ currentStationCatalog.condition_text }}</div>
        </div>
        <div v-if="!isDocked" class="text-xs text-space-text-dim italic py-4">Dock at a station to browse ships.</div>
        <div v-else-if="showroomLoading" class="text-xs text-space-text-dim italic">Loading showroom...</div>
        <div v-else-if="showroom.length === 0">
          <div v-if="showroomTip" class="text-xs text-space-text-dim bg-[#21262d] rounded-md p-3 mb-2">💡 {{ showroomTip }}</div>
          <div v-else class="text-xs text-space-text-dim italic py-4">No ships available at this station.</div>
          <button @click="loadShowroom" :disabled="showroomLoading" class="btn text-xs px-3 py-1">🔄 Refresh</button>
        </div>
        <div v-else class="grid grid-cols-3 gap-2">
          <div v-for="s in [...showroom].sort((a,b) => (a.name||'').localeCompare(b.name||''))" :key="s.class_id" class="flex flex-col !mb-2 bg-deep-bg border border-[#21262d] rounded-md text-xs overflow-hidden">
            <div class="relative h-24 bg-[#0d1117] overflow-hidden">
              <img :src="shipImageUrl(s.class_id)" :alt="s.name"
                class="w-full h-full object-cover opacity-65"
                @error="($event.target as HTMLImageElement).style.display='none'" />
              <div class="absolute inset-0 bg-gradient-to-t from-[#0d1117] via-[#0d1117]/30 to-transparent"></div>
              <div class="absolute bottom-1.5 left-2.5">
                <div class="font-semibold text-white drop-shadow">{{ s.name }}</div>
                <div class="text-[10px] text-white/60">{{ s.category }} {{ s.scale ? '• ' + s.scale : '' }}</div>
              </div>
            </div>
            <div class="px-3 py-2 space-y-1.5">
              <div class="flex items-center justify-between gap-1 text-[11px] text-space-text-dim flex-wrap">
                <span v-if="s.hull !== null">🛡 {{ s.hull }}</span>
                <span v-if="s.shield !== null">🔵 {{ s.shield }}</span>
                <span v-if="s.cargo !== null">📦 {{ s.cargo }}</span>
                <span v-if="s.speed !== null">⚡ {{ s.speed }}</span>
              </div>
              <div class="flex items-center justify-between">
                <div class="text-[10px] text-space-text-dim leading-tight">
                  <div class="text-space-yellow font-semibold text-[11px]">{{ fmt(s.price) }} cr</div>
                  <div v-if="s.material_cost !== null" class="opacity-70">Mat: {{ fmt(s.material_cost) }} + Labor: {{ fmt(s.labor_cost) }}</div>
                </div>
                <button
                  @click="buyShip(s.class_id)"
                  :disabled="loading || botCredits < s.price"
                  class="btn btn-primary text-xs px-3 py-0.5"
                >Buy</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Commission Panel -->
      <div v-else-if="activePanel === 'commission'">
        <h3 class="text-sm font-semibold text-space-text-bright mb-1">Commission Ship</h3>
        <p class="text-xs text-space-text-dim mb-3">Order a custom build. The shipyard sources materials at a markup — or supply your own via <em>build_ship</em> for less.</p>
        <div v-if="!isDocked" class="text-xs text-space-text-dim italic py-4">Dock at a station shipyard to commission a ship.</div>
        <div v-else class="space-y-3">
          <!-- Filters -->
          <div class="flex gap-1.5 flex-wrap">
            <input
              v-model="commissionSearch"
              type="text"
              placeholder="Search ship name..."
              class="bg-deep-bg border border-space-border rounded-md px-2 py-1 text-xs text-space-text placeholder-space-text-dim focus:border-space-accent outline-none flex-1 min-w-0"
            />
            <select v-model="commissionEmpireFilter" class="bg-deep-bg border border-space-border rounded-md px-2 py-1 text-xs text-space-text focus:border-space-accent outline-none">
              <option value="">All empires</option>
              <option v-for="[empire] in shipsGroupedByEmpire" :key="empire" :value="empire">{{ empire }}</option>
            </select>
            <select v-model="commissionTierFilter" class="bg-deep-bg border border-space-border rounded-md px-2 py-1 text-xs text-space-text focus:border-space-accent outline-none">
              <option value="">All tiers</option>
              <option v-for="t in allTiers" :key="t" :value="t">Tier {{ t }}</option>
            </select>
          </div>

          <!-- Ship selector -->
          <div class="flex gap-2">
            <select
              v-model="commissionShipClass"
              @change="onShipClassChange"
              class="flex-1 bg-deep-bg border border-space-border rounded-md px-2 py-1.5 text-xs text-space-text focus:border-space-accent outline-none"
            >
              <option value="">— Select a ship class —</option>
              <optgroup v-for="[empire, ships] in filteredShipsGrouped" :key="empire" :label="empire">
                <option v-for="s in ships" :key="s.id" :value="s.id">
                  {{ s.name }} (Tier {{ s.tier }}) — {{ s.price?.toLocaleString() }} cr
                </option>
              </optgroup>
            </select>
            <button
              @click="getCommissionQuote"
              :disabled="!commissionShipClass || commissionLoading || loading"
              class="btn text-xs px-3 py-1 whitespace-nowrap"
            >{{ commissionLoading ? '⏳' : '📊' }} Quote</button>
          </div>

          <!-- Commission result notification (persistent, styled) -->
          <div v-if="commissionResult" class="rounded-md p-3 text-xs border"
            :class="commissionResult.ok
              ? 'bg-[#0d2818] border-space-green/40 text-space-green'
              : 'bg-[#2d1010] border-space-red/40 text-space-red'">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-start gap-2 min-w-0">
                <span class="text-base leading-none mt-0.5 shrink-0">{{ commissionResult.ok ? '✅' : '❌' }}</span>
                <div class="min-w-0">
                  <div class="font-semibold mb-0.5">{{ commissionResult.ok ? 'Commission Submitted' : 'Commission Failed' }}</div>
                  <div class="text-[11px] leading-relaxed whitespace-pre-wrap break-words opacity-90">{{ commissionResult.message }}</div>
                </div>
              </div>
              <button @click="commissionResult = null" class="shrink-0 opacity-50 hover:opacity-100 text-[13px] leading-none mt-0.5 transition-opacity">✕</button>
            </div>
          </div>

          <!-- Two-column layout: Ship details (2/3) + Quote (1/3) -->
          <div v-if="selectedShipCatalog || commissionQuote" class="flex gap-3 items-start">

            <!-- Left: Selected ship details (2/3) -->
            <div v-if="selectedShipCatalog" class="flex-[2] bg-deep-bg border border-[#21262d] rounded-md p-3 text-xs space-y-2 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-space-text font-semibold">{{ selectedShipCatalog.name }} | {{ selectedShipCatalog.id }}</div>
                  <div class="text-space-text-dim text-[11px]">{{ selectedShipCatalog.class }} · {{ selectedShipCatalog.empire_name }}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-space-yellow font-semibold">{{ selectedShipCatalog.price?.toLocaleString() }} cr</div>
                  <div class="text-space-text-dim text-[11px]">Tier {{ selectedShipCatalog.tier }} · Scale {{ selectedShipCatalog.scale }}</div>
                </div>
              </div>
              <div class="text-space-text-dim leading-relaxed">{{ selectedShipCatalog.description }}</div>
              <!-- Base stats grid -->
              <div class="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px] pt-1 border-t border-[#21262d]">
                <div class="text-space-text-dim">❤️ Hull <span class="text-space-text">{{ selectedShipCatalog.base_hull }}</span></div>
                <div class="text-space-text-dim">🔵 Shield <span class="text-space-text">{{ selectedShipCatalog.base_shield }}</span></div>
                <div class="text-space-text-dim">💨 Speed <span class="text-space-text">{{ selectedShipCatalog.base_speed }}</span></div>
                <div class="text-space-text-dim">⛽ Fuel <span class="text-space-text">{{ selectedShipCatalog.base_fuel }}</span></div>
                <div class="text-space-text-dim">📦 Cargo <span class="text-space-text">{{ selectedShipCatalog.cargo_capacity }}</span></div>
                <div class="text-space-text-dim">🖥️ CPU <span class="text-space-text">{{ selectedShipCatalog.cpu_capacity }}</span></div>
                <div class="text-space-text-dim">⚔️ <span class="text-space-text">{{ selectedShipCatalog.weapon_slots }} wpn</span></div>
                <div class="text-space-text-dim">🛡️ <span class="text-space-text">{{ selectedShipCatalog.defense_slots }} def</span></div>
                <div class="text-space-text-dim">🔧 <span class="text-space-text">{{ selectedShipCatalog.utility_slots }} util</span></div>
              </div>
              <!-- Build materials with availability -->
              <div v-if="selectedShipCatalog.build_materials?.length > 0" class="pt-1 border-t border-[#21262d]">
                <div class="text-[11px] uppercase tracking-wider text-space-text-dim mb-1.5">🔩 Build Materials</div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                  <div v-for="mat in selectedShipCatalog.build_materials" :key="mat.item_id" class="text-[11px] flex items-center gap-1 min-w-0">
                    <span class="shrink-0">{{ matIcon(mat.item_id) }}</span>
                    <span class="text-space-text-dim truncate">{{ mat.item_name }}:</span>
                    <span class="text-space-text font-medium shrink-0">×{{ mat.quantity }}</span>
                    <span class="ml-auto shrink-0 text-[11px] px-1 py-0.5 rounded font-medium"
                      :class="(botBuildMats[mat.item_id] || 0) >= mat.quantity
                        ? 'bg-green-900/40 text-space-green'
                        : (botBuildMats[mat.item_id] || 0) > 0
                          ? 'bg-yellow-900/40 text-space-yellow'
                          : 'text-space-text-dim/50'">
                      {{ botBuildMats[mat.item_id] ? `${botBuildMats[mat.item_id]}/${mat.quantity}` : `0/${mat.quantity}` }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="selectedShipCatalog.flavor_tags?.length" class="flex flex-wrap gap-1 pt-1 border-t border-[#21262d]">
                <span v-for="tag in selectedShipCatalog.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[11px]">{{ tag }}</span>
              </div>
              <!-- Gather goal panel -->
              <div v-if="selectedShipCatalog.build_materials?.length" class="pt-2 border-t border-[#21262d]">
                <div v-if="currentGatherGoals.some(g => g.target_id === commissionShipClass)"
                  class="flex items-center justify-between bg-[#0d2233] border border-[#1a3a5a] rounded-md p-2 text-xs">
                  <span class="text-space-cyan">⚙️ Gathering materials for build...</span>
                  <button @click="clearGatherGoal()" class="text-space-red hover:text-red-400 text-[11px]">✕ Cancel all</button>
                </div>
                <button @click="gatherShipMaterials()" class="btn text-[11px] px-3 py-1 w-full mt-1">
                  {{ currentGatherGoals.some(g => g.target_id === commissionShipClass) ? '🔩 +Add goal' : '🔩 Gather Materials for Build' }}
                </button>
              </div>
            </div>

            <!-- Right: Quote (1/3) -->
            <div v-if="commissionQuote" class="flex-1 bg-deep-bg border border-space-accent/30 rounded-md p-3 text-xs space-y-1.5 min-w-0">
              <div class="text-space-text font-semibold">Quote: {{ commissionQuote.ship_class || commissionShipClass }}</div>

              <!-- Cost breakdown -->
              <div class="space-y-0.5">
                <div class="flex justify-between items-center">
                  <span class="text-space-text-dim">💰 Credits only:</span>
                  <span :class="commissionQuote.can_afford_credits_only ? 'text-space-green' : 'text-red-400'" class="font-medium">
                    {{ fmt(commissionQuote.credits_only_total || 0) }} cr
                    <span class="text-[10px]">{{ commissionQuote.can_afford_credits_only ? '✓' : '✗' }}</span>
                  </span>
                </div>
                <div class="flex justify-between items-center">
                  <span class="text-space-text-dim">� Provide materials:</span>
                  <span :class="commissionQuote.can_afford_provide_materials ? 'text-space-green' : 'text-red-400'" class="font-medium">
                    {{ fmt(commissionQuote.provide_materials_total || commissionQuote.labor_cost || 0) }} cr
                    <span class="text-[10px]">{{ commissionQuote.can_afford_provide_materials ? '✓' : '✗' }}</span>
                  </span>
                </div>
                <div v-if="commissionQuote.material_cost" class="flex justify-between text-[11px]">
                  <span class="text-space-text-dim pl-2">↳ material markup:</span>
                  <span class="text-space-text-dim">{{ fmt(commissionQuote.material_cost) }} cr</span>
                </div>
                <div v-if="commissionQuote.player_credits != null" class="flex justify-between text-[11px] pt-0.5 border-t border-[#21262d]">
                  <span class="text-space-text-dim">Your credits:</span>
                  <span class="text-space-cyan">{{ fmt(commissionQuote.player_credits) }} cr</span>
                </div>
              </div>

              <!-- Shipyard tier -->
              <div v-if="commissionQuote.shipyard_tier_required != null" class="flex justify-between text-[11px]">
                <span class="text-space-text-dim">🏭 Shipyard tier:</span>
                <span :class="commissionQuote.shipyard_tier_here >= commissionQuote.shipyard_tier_required ? 'text-space-green' : 'text-red-400'">
                  {{ commissionQuote.shipyard_tier_here }} / req {{ commissionQuote.shipyard_tier_required }}
                  {{ commissionQuote.shipyard_tier_here >= commissionQuote.shipyard_tier_required ? '✓' : '✗' }}
                </span>
              </div>

              <div v-if="commissionQuote.build_time" class="text-space-text-dim">⏱️ Build time: {{ commissionQuote.build_time }}s</div>

              <!-- Issues / skill requirements -->
              <div v-if="!commissionQuote.can_commission" class="rounded bg-red-950/40 border border-red-800/40 p-1.5 space-y-0.5">
                <div class="text-[11px] text-red-400 font-medium">Cannot commission here — {{ commissionQuote.issues?.length || 1 }} issue(s):</div>
                <div v-if="commissionQuote.issues?.length" v-for="(issue, i) in commissionQuote.issues" :key="i" class="text-[11px] text-red-300/80 pl-1">• {{ issue }}</div>
                <div v-else class="text-[11px] text-red-300/80 pl-1">• Check skill or shipyard requirements above</div>
              </div>

              <!-- Build materials with your inventory counts -->
              <div v-if="(commissionQuote.build_materials || commissionQuote.materials)?.length > 0" class="space-y-0.5 pt-1 border-t border-[#21262d]">
                <div class="text-[11px] uppercase tracking-wider text-space-text-dim mb-1">🔩 Build Materials</div>
                <div class="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <div v-for="mat in (commissionQuote.build_materials || commissionQuote.materials)" :key="mat.item_id"
                    class="text-[11px] flex items-center justify-between gap-1">
                    <span class="text-space-text-dim truncate">{{ mat.name || mat.item_name || mat.item_id }}</span>
                    <span :class="(botBuildMats[mat.item_id] || 0) >= mat.quantity ? 'text-space-green' : 'text-red-400'" class="shrink-0 font-medium">
                      {{ botBuildMats[mat.item_id] || 0 }}/{{ mat.quantity }}
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="commissionQuote.message" class="text-space-text-dim italic text-[11px]">{{ commissionQuote.message }}</div>

              <!-- provide_materials + commission button -->
              <div class="mt-2 pt-2 border-t border-[#21262d] space-y-2">
                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input type="checkbox" v-model="provideMaterials" class="accent-space-accent mt-0.5 shrink-0" />
                  <div>
                    <div class="text-space-text">Provide materials myself</div>
                    <div class="text-[11px] text-space-text-dim italic">{{ provideMaterials ? 'cheaper — you supply from cargo/storage' : 'default — shipyard sources at markup' }}</div>
                  </div>
                </label>

                <!-- Inline confirmation panel -->
                <div v-if="showCommissionConfirm" class="rounded-md border border-space-accent/40 bg-[#0d1a2d] p-2 space-y-2">
                  <div class="text-[11px] text-space-text leading-snug">
                    Commission <span class="text-space-accent font-semibold">{{ selectedShipCatalog?.name || commissionShipClass }}</span>?
                  </div>
                  <div class="text-[11px] text-space-text-dim">{{ provideMaterials ? '🔩 You supply build materials from cargo/storage.' : '🏪 Shipyard sources materials at markup.' }}</div>
                  <div class="flex gap-2">
                    <button @click="confirmAndCommission" :disabled="loading" class="btn btn-primary text-[11px] px-3 py-1 flex-1">
                      {{ loading ? '⏳ Submitting...' : '✅ Confirm' }}
                    </button>
                    <button @click="showCommissionConfirm = false" class="text-[11px] px-3 py-1 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors">Cancel</button>
                  </div>
                </div>
                <button v-else @click="showCommissionConfirm = true"
                  :disabled="loading || commissionQuote.can_commission === false"
                  :title="commissionQuote.can_commission === false ? 'Resolve issues above before commissioning' : ''"
                  class="btn btn-primary text-xs px-3 py-1 w-full disabled:opacity-50">🔨 Commission Ship</button>
              </div>
            </div>
          </div>

          <div v-if="!commissionQuote && commissionShipClass && selectedShipCatalog" class="text-xs text-space-text-dim italic">Click Quote to preview the cost from the shipyard.</div>
          <div v-if="!commissionShipClass" class="text-xs text-space-text-dim italic">Select a ship class above to see details and get a quote.</div>
        </div>
      </div>

      <!-- Commission Status Panel -->
      <div v-else-if="activePanel === 'commission-status'">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-space-text-bright">📋 Build Commissions</h3>
          <button @click="loadCommissionStatus" :disabled="statusLoading" class="btn text-xs px-2 py-0.5">{{ statusLoading ? '⏳' : '🔄' }} Refresh</button>
        </div>
        <div v-if="statusLoading" class="text-xs text-space-text-dim italic">Loading commissions...</div>
        <div v-else-if="commissionStatuses.length === 0" class="text-xs text-space-text-dim italic py-4">No commissions found. Click Refresh to load.</div>
        <div v-else class="space-y-3">
          <div v-for="c in commissionStatuses" :key="c.commission_id || c.id" class="bg-deep-bg border border-[#21262d] rounded-md p-3 text-xs">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-space-text font-semibold">{{ c.ship_class_name || c.ship_class || c.class_id || '?' }}</span>
              <span class="px-2 py-0.5 rounded text-[11px] font-medium"
                :class="c.status === 'ready' ? 'bg-green-900/40 text-space-green' : c.status === 'building' ? 'bg-blue-900/30 text-space-cyan' : c.status === 'sourcing' ? 'bg-yellow-900/40 text-yellow-300' : 'bg-[#21262d] text-space-text-dim'">
                {{ c.status || 'pending' }}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-space-text-dim">
              <div v-if="c.base_id || c.station">📍 {{ c.base_id || c.station }}</div>
              <div v-if="c.cost != null">💰 {{ fmt(c.cost) }} cr</div>
              <div v-if="c.build_time_remaining != null">⏱️ {{ c.build_time_remaining }}s left</div>
              <div v-if="c.build_time != null && c.build_time_remaining == null">⏱️ {{ c.build_time }}s total</div>
              <div v-if="c.provide_materials != null">🔩 {{ c.provide_materials ? 'Own materials' : 'Shipyard sourced' }}</div>
              <div v-if="c.progress_pct != null">{{ c.progress_pct }}% done</div>
              <div v-if="c.created_at">📅 {{ c.created_at }}</div>
            </div>
            <div v-if="c.status === 'ready'" class="mt-2 pt-2 border-t border-[#21262d]">
              <span class="text-space-green text-[11px] font-semibold">✅ Your ship is ready for pickup!</span>
            </div>
            <div v-if="c.status === 'sourcing'" class="mt-2 pt-2 border-t border-[#21262d] space-y-2">
              <div class="text-yellow-300 text-[11px] font-semibold">⏳ Shipyard is sourcing materials — you can donate to speed it up</div>
              <div v-if="supplyTarget === (c.commission_id || c.id)" class="flex gap-2 items-center flex-wrap">
                <input v-model="supplyItemId" placeholder="item_id" class="input text-xs flex-1 min-w-[120px]" />
                <input v-model.number="supplyQty" type="number" min="1" placeholder="qty" class="input text-xs w-20" />
                <button @click="submitSupply(c.commission_id || c.id)" :disabled="!supplyItemId.trim() || supplyLoading" class="btn btn-primary text-xs px-3">
                  {{ supplyLoading ? '⏳' : '📦 Supply' }}
                </button>
                <button @click="supplyTarget = ''" class="btn btn-secondary text-xs px-2">✗</button>
              </div>
              <button v-else @click="supplyTarget = c.commission_id || c.id; supplyItemId = ''; supplyQty = 1" class="btn btn-secondary text-xs px-3">
                📦 Supply Materials
              </button>
            </div>
            <div v-if="c.materials_needed?.length" class="mt-1.5 pt-1.5 border-t border-[#21262d]">
              <div class="text-[11px] uppercase tracking-wider text-space-text-dim mb-1">Materials needed</div>
              <div v-for="m in c.materials_needed" :key="m.item_id" class="text-[11px] text-space-text-dim pl-1">
                {{ m.item_name || m.item_id }}: ×{{ m.quantity_needed ?? m.quantity }}
                <span v-if="m.have != null" :class="m.have >= (m.quantity_needed ?? m.quantity) ? 'text-space-green' : 'text-space-red'">
                  (have {{ m.have }})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Status message -->
      <div v-if="statusMsg" class="mt-3 text-xs px-3 py-2 rounded" :class="statusOk ? 'bg-[#0d2818] text-space-green' : 'bg-[#2d0000] text-space-red'">
        {{ statusMsg }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';
import { empireIcon, empireName } from '../utils/empires';

const botStore = useBotStore();
const selectedBot = ref<string | null>(null);
const activePanel = ref('overview');
const loading = ref(false);
const statusMsg = ref('');
const statusOk = ref(true);

// Data
const shipData = ref<any>(null);
const fleet = ref<any[]>([]);
const fleetLoading = ref(false);
const showroom = ref<any[]>([]);
const showroomLoading = ref(false);
const showroomTip = ref('');
const showroomLevel = ref<number | null>(null);
const commissionShipClass = ref('');
const commissionQuote = ref<any>(null);
const commissionLoading = ref(false);
const commissionSearch = ref('');
const commissionEmpireFilter = ref('');
const commissionTierFilter = ref<number | ''>('');
const provideMaterials = ref(false);
const commissionStatuses = ref<any[]>([]);
const statusLoading = ref(false);
const commissionResult = ref<{ ok: boolean; message: string } | null>(null);
const showCommissionConfirm = ref(false);
const supplyTarget = ref('');
const supplyItemId = ref('');
const supplyQty = ref(1);
const supplyLoading = ref(false);
const sellConfirmId = ref('');
const renameShipName = ref('');
const renameSaving = ref(false);
const transferTargets = ref<Record<string, string>>({});

function submitSupply(commissionId: string) {
  if (!supplyItemId.value.trim() || !selectedBot.value) return;
  supplyLoading.value = true;
  botStore.sendExec(selectedBot.value, 'supply_commission', {
    commission_id: commissionId,
    item_id: supplyItemId.value.trim(),
    quantity: supplyQty.value,
  }, (data: unknown) => {
    supplyLoading.value = false;
    const d = data as Record<string, unknown>;
    if (d?.error) { setStatus(`Supply failed: ${d.error}`, false); return; }
    setStatus(`Supplied ${supplyQty.value}× ${supplyItemId.value} to commission`, true);
    supplyTarget.value = '';
    loadCommissionStatus();
  });
}

const panels = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'fleet', label: '🚀 Fleet' },
  { id: 'showroom', label: '🏪 Showroom' },
  { id: 'commission', label: '🔨 Commission' },
  { id: 'commission-status', label: '📋 Build Status' },
];

function fmt(n: number): string { return new Intl.NumberFormat().format(n); }

function setStatus(msg: string, ok = true) {
  statusMsg.value = msg;
  statusOk.value = ok;
  setTimeout(() => { statusMsg.value = ''; }, 4000);
}

// Computed ship fields
const ship = computed(() => {
  if (!shipData.value) return {} as any;
  const d = shipData.value;
  return d.ship || d.state?.ship || d.player?.ship || d;
});

const shipName = computed(() => {
  const s = ship.value;
  const raw = s.name || s.ship_name || '';
  const cls = s.class || s.ship_class || s.class_id || '';
  return (raw && raw.toLowerCase() !== 'unnamed') ? raw : (cls || '?');
});

const shipClass = computed(() => ship.value.class || ship.value.ship_class || ship.value.class_id || '');
const shipTier = computed(() => ship.value.tier || '');

const botCredits = computed(() => {
  const bot = botStore.bots.find(b => b.username === selectedBot.value);
  return bot?.credits || 0;
});

const isDocked = computed(() => {
  const bot = botStore.bots.find(b => b.username === selectedBot.value);
  return !!bot?.docked;
});

const currentBot = computed(() => (botStore.bots.find(b => b.username === selectedBot.value) as any) || null);

function pct(cur: any, max: any): number {
  const c = Number(cur) || 0;
  const m = Number(max) || 0;
  return m > 0 ? Math.round((c / m) * 100) : 0;
}

const hullPct = computed(() => pct(ship.value.hull, ship.value.max_hull ?? ship.value.hull_max));
const shieldPct = computed(() => pct(ship.value.shield, ship.value.max_shield ?? ship.value.shield_max));
const fuelPct = computed(() => pct(ship.value.fuel, ship.value.max_fuel ?? ship.value.fuel_max));
const cargoPct = computed(() => pct(ship.value.cargo_used ?? ship.value.cargo, ship.value.cargo_capacity ?? ship.value.max_cargo ?? ship.value.cargo_max));

// Modules extraction (same logic as old UI)
const modules = computed(() => {
  if (!shipData.value) return [];
  const d = shipData.value;
  const s = ship.value;
  
  // Top-level enriched modules from get_status
  if (Array.isArray(d.modules) && d.modules.length > 0 && typeof d.modules[0] === 'object') return d.modules;
  if (d.state && Array.isArray(d.state.modules) && d.state.modules.length > 0 && typeof d.state.modules[0] === 'object') return d.state.modules;
  
  // Search ship object
  const keys = ['installed_modules', 'fitted_modules', 'loadout', 'fitted', 'mods', 'equipment', 'fittings', 'modules'];
  for (const k of keys) {
    if (Array.isArray(s[k]) && s[k].length > 0 && typeof s[k][0] === 'object') return s[k];
  }
  
  // String UUIDs fallback
  for (const k of keys) {
    if (Array.isArray(s[k]) && s[k].length > 0 && typeof s[k][0] === 'string') {
      return s[k].map((id: string) => ({ module_id: id, id, name: botStore.catalogName(id) }));
    }
  }
  return [];
});

const installableModules = computed(() => {
  const bot = botStore.bots.find(b => b.username === selectedBot.value);
  const cargo = bot?.inventory || [];
  return cargo.filter((i: any) => (i.itemId || i.item_id || '').includes('mod_') || (i.name || '').toLowerCase().includes('module'));
});

function matIcon(itemId: string): string {
  const id = (itemId || '').toLowerCase();
  if (id.includes('steel') || id.includes('alloy') || id.includes('metal')) return '🔩';
  if (id.includes('crystal') || id.includes('gem')) return '💎';
  if (id.includes('circuit') || id.includes('chip') || id.includes('cpu')) return '🖥️';
  if (id.includes('fuel') || id.includes('gas') || id.includes('plasma')) return '⛽';
  if (id.includes('ore')) return '⛏️';
  if (id.includes('shield')) return '🛡️';
  if (id.includes('engine') || id.includes('thruster')) return '🚀';
  if (id.includes('wire') || id.includes('cable') || id.includes('coil')) return '🔌';
  return '📦';
}

function moduleName(m: any): string {
  const name = m.name || m.module_name || m.type_id || m.module_id || m.id || '?';
  if ((name === m.module_id || name === m.id) && !m.name) return botStore.catalogName(name);
  return name;
}

// ── Catalog helpers ───────────────────────────────────────

function parseStat(val: string | number | undefined): { cur: number; max: number } {
  if (val === undefined || val === null) return { cur: 0, max: 0 };
  if (typeof val === 'number') return { cur: val, max: val };
  const parts = String(val).split('/');
  if (parts.length === 2) return { cur: Number(parts[0]) || 0, max: Number(parts[1]) || 0 };
  const n = Number(val) || 0;
  return { cur: n, max: n };
}

const currentShipCatalog = computed(() => {
  const id = shipClass.value;
  if (!id || !botStore.publicShips.length) return null;
  return botStore.publicShips.find((s: any) => s.id === id) || null;
});

const shipsGroupedByEmpire = computed(() => {
  const groups: Record<string, any[]> = {};
  for (const s of botStore.publicShips) {
    if (s.starter_ship) continue; // exclude starter ships from commission
    const empire = s.empire_name || s.empire || 'Unknown';
    if (!groups[empire]) groups[empire] = [];
    groups[empire].push(s);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
});

const filteredShipsGrouped = computed(() => {
  const search = commissionSearch.value.toLowerCase().trim();
  const empire = commissionEmpireFilter.value;
  const tier = commissionTierFilter.value;
  return shipsGroupedByEmpire.value
    .filter(([emp]) => !empire || emp === empire)
    .map(([emp, ships]) => [emp, (ships as any[]).filter((s: any) => {
      if (s.starter_ship) return false; // starter ships cannot be commissioned
      if (tier !== '' && s.tier !== Number(tier)) return false;
      if (search && !s.name.toLowerCase().includes(search) && !s.id.toLowerCase().includes(search)) return false;
      return true;
    })] as [string, any[]])
    .filter(([, ships]) => ships.length > 0);
});

const allTiers = computed(() => {
  const tiers = new Set<number>();
  for (const s of botStore.publicShips) if (s.tier && !s.starter_ship) tiers.add(s.tier);
  return [...tiers].sort((a, b) => a - b);
});

const selectedShipCatalog = computed(() => {
  if (!commissionShipClass.value) return null;
  return botStore.publicShips.find((s: any) => s.id === commissionShipClass.value) || null;
});

const botBuildMats = computed(() => {
  const bot = botStore.bots.find(b => b.username === selectedBot.value) as any;
  const result: Record<string, number> = {};
  for (const item of (bot?.inventory || [])) {
    const id = item.itemId || item.item_id || '';
    if (id) result[id] = (result[id] || 0) + (item.quantity || 0);
  }
  for (const item of (bot?.storage || [])) {
    const id = item.itemId || item.item_id || '';
    if (id) result[id] = (result[id] || 0) + (item.quantity || 0);
  }
  return result;
});

const currentStationCatalog = computed(() => {
  const bot = botStore.bots.find(b => b.username === selectedBot.value);
  if (!bot || !botStore.publicStations.length) return null;
  const poi = (bot as any).poi || (bot as any).current_poi || '';
  const loc = (bot as any).location || (bot as any).current_system || '';
  return botStore.publicStations.find((st: any) =>
    st.id === poi || st.system_id === loc
  ) || null;
});

// ── Auto-sync: pre-select bot from profile navigation
onMounted(() => {
  if (botStore.selectedBot && !selectedBot.value) selectBot(botStore.selectedBot);
});
watch(() => botStore.selectedBot, (username) => {
  if (username && username !== selectedBot.value) selectBot(username);
});

// Bot selection
function selectBot(username: string) {
  selectedBot.value = username;
  activePanel.value = 'overview';
  shipData.value = null;
  fleet.value = [];
  showroom.value = [];
  fetchShipData(username);
}

function fetchShipData(username: string) {
  loading.value = true;
  botStore.sendExec(username, 'get_status', undefined, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      shipData.value = result.data;
    } else {
      shipData.value = null;
      setStatus(result.error || 'Could not load ship data', false);
    }
  });
}

function execCmd(cmd: string, params?: any) {
  if (!selectedBot.value) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, cmd, params, (result: any) => {
    loading.value = false;
    if (result.ok) {
      setStatus(`${cmd}: OK`, true);
      fetchShipData(selectedBot.value!);
    } else {
      setStatus(result.error || `${cmd} failed`, false);
    }
  });
}

function loadFleet() {
  if (!selectedBot.value) return;
  fleetLoading.value = true;
  const username = selectedBot.value;
  botStore.sendExec(username, 'list_ships', undefined, (result: any) => {
    fleetLoading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      const ships = result.data.ships || result.data || [];
      fleet.value = (Array.isArray(ships) ? ships : []).map((s: any) => {
        const hull = parseStat(s.hull);
        const fuel = parseStat(s.fuel);
        return {
          ship_id: s.ship_id,
          class_id: s.class_id,
          class_name: s.class_name || s.class_id,
          is_active: !!s.is_active,
          hull_cur: hull.cur, hull_max: hull.max,
          fuel_cur: fuel.cur, fuel_max: fuel.max,
          modules: s.modules || 0,
          cargo_used: s.cargo_used || 0,
          location: s.location || 'Unknown',
          can_switch: !s.is_active,
          starter_ship: !!s.starter_ship,
        };
      }).sort((a, b) =>
        // Active ship first, then alphabetical by class name
        (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0) ||
        (a.class_name || '').localeCompare(b.class_name || '')
      );
    }
  });
}

function loadShowroom() {
  if (!selectedBot.value || !isDocked.value) return;
  showroomLoading.value = true;
  const username = selectedBot.value;
  botStore.sendExec(username, 'shipyard_showroom', undefined, (result: any) => {
    showroomLoading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      showroomTip.value = result.data.tip || '';
      showroomLevel.value = result.data.shipyard_level ?? null;
      const ships = result.data.ships || result.data || [];
      showroom.value = (Array.isArray(ships) ? ships : []).map((s: any) => ({
        class_id: s.class_id,
        name: s.name,
        category: s.category || 'Unknown',
        scale: s.scale || '',
        tier: s.tier || '',
        price: s.showroom_price ?? s.price ?? 0,
        material_cost: s.material_cost ?? null,
        labor_cost: s.labor_cost ?? null,
        hull: s.hull ?? null,
        shield: s.shield ?? null,
        cargo: s.cargo ?? null,
        speed: s.speed ?? null,
      }));
    }
  });
}

function switchShip(shipId: string) {
  execCmd('switch_ship', { ship_id: shipId });
}

function buyShip(classId: string) {
  execCmd('buy_ship', { ship_class: classId });
}

function installMod(moduleId: string) {
  execCmd('install_mod', { module_id: moduleId });
}

function uninstallMod(moduleId: string) {
  execCmd('uninstall_mod', { module_id: moduleId });
}

function sellShip(shipId: string) {
  sellConfirmId.value = '';
  execCmd('sell_ship', { ship_id: shipId });
  // Reload fleet after selling
  setTimeout(() => loadFleet(), 1500);
}

function transferShip(shipId: string) {
  if (!selectedBot.value) return;
  const target = (transferTargets.value[shipId] || '').trim();
  if (!target) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'gift_ship', { ship_id: shipId, target_username: target }, (result: any) => {
    loading.value = false;
    if (result.ok) {
      setStatus(`Ship transferred to ${target}`, true);
      transferTargets.value[shipId] = '';
      setTimeout(() => loadFleet(), 1000);
    } else {
      setStatus(result.error || 'Transfer failed', false);
    }
  });
}

function renameShip() {
  if (!selectedBot.value) return;
  const name = renameShipName.value.trim();
  renameSaving.value = true;
  botStore.sendExec(selectedBot.value, 'rename_ship', { name }, (result: any) => {
    renameSaving.value = false;
    if (result.ok) {
      setStatus(name ? `Ship renamed to "${name}"` : 'Ship name cleared', true);
      renameShipName.value = '';
      fetchShipData(selectedBot.value!);
    } else {
      setStatus(result.error || 'Rename failed', false);
    }
  });
}

function shipImageUrl(classId: string): string {
  return `/ships/${classId}.webp`;
}

function getCommissionQuote() {
  if (!selectedBot.value || !commissionShipClass.value) return;
  commissionLoading.value = true;
  commissionQuote.value = null;
  const username = selectedBot.value;
  botStore.sendExec(username, 'commission_quote', { ship_class: commissionShipClass.value }, (result: any) => {
    commissionLoading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      commissionQuote.value = result.data;
    } else {
      setStatus(result.error || 'Quote failed', false);
    }
  });
}

function onShipClassChange() {
  commissionQuote.value = null;
  commissionResult.value = null;
  showCommissionConfirm.value = false;
}

function doCommissionShip() {
  showCommissionConfirm.value = true;
}

function confirmAndCommission() {
  if (!selectedBot.value || !commissionShipClass.value) return;
  showCommissionConfirm.value = false;
  loading.value = true;
  commissionResult.value = null;
  const username = selectedBot.value;
  const params: any = { ship_class: commissionShipClass.value };
  if (provideMaterials.value) params.provide_materials = true;
  botStore.sendExec(username, 'commission_ship', params, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok) {
      const r = result.data?.result ?? result.data ?? {};
      const msg = r.message || r.hint || `Ship commissioned! Commission ID: ${r.commission_id ?? '—'}`.trim();
      commissionResult.value = { ok: true, message: msg };
      commissionQuote.value = null;
      loadCommissionStatus();
    } else {
      const errMsg = (result.error || 'Commission failed') as string;
      commissionResult.value = { ok: false, message: errMsg };
    }
  });
}

function loadCommissionStatus() {
  if (!selectedBot.value) return;
  statusLoading.value = true;
  const username = selectedBot.value;
  const bot = botStore.bots.find(b => b.username === username) as any;
  const params: any = {};
  if (bot?.poi) params.base_id = bot.poi;
  botStore.sendExec(username, 'commission_status', params, (result: any) => {
    statusLoading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      const r = result.data?.result ?? result.data;
      commissionStatuses.value = r.commissions || r.orders || (Array.isArray(r) ? r : []);
    } else {
      setStatus(result.error || 'Could not load commission status', false);
    }
  });
}

// ── Gather Goal ───────────────────────────────────────────

function getBotGoals(username: string): any[] {
  const s = (botStore.settings as any)?.[username] || {};
  if (s.goals?.length) return s.goals;
  if (s.goal) return [s.goal];
  return [];
}

const currentGatherGoals = computed(() =>
  selectedBot.value ? getBotGoals(selectedBot.value) : []
);

function gatherShipMaterials() {
  if (!selectedShipCatalog.value?.build_materials?.length || !selectedBot.value) return;
  const bot = botStore.bots.find((b: any) => b.username === selectedBot.value) as any;
  if (!bot?.poi || !bot?.system) {
    setStatus('⚠ Bot must be docked at target station to create a Gather goal', false);
    return;
  }
  const newGoal = {
    id: `ship_${commissionShipClass.value}_${Date.now()}`,
    target_id: commissionShipClass.value,
    target_name: selectedShipCatalog.value.name,
    goal_type: 'build',
    target_poi: bot.poi,
    target_system: bot.system,
    materials: selectedShipCatalog.value.build_materials.map((m: any) => ({
      item_id: m.item_id,
      item_name: m.item_name || m.name,
      quantity_needed: m.quantity,
    })),
  };
  const existing = getBotGoals(selectedBot.value);
  botStore.saveSettings(selectedBot.value, { goals: [...existing, newGoal], goal: null });
  setStatus('📦 Gather goal added!', true);
}

function clearGatherGoal() {
  if (!selectedBot.value) return;
  botStore.saveSettings(selectedBot.value, { goals: [], goal: null });
  setStatus('Gather goal cleared', false);
}

// Auto-load data when switching panels
watch(activePanel, (panel) => {
  if (panel === 'fleet') loadFleet();
  if (panel === 'showroom' && showroom.value.length === 0 && isDocked.value) loadShowroom();
  if (panel === 'commission-status') loadCommissionStatus();
});
</script>
