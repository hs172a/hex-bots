<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Shipyard</h3>
      </div>
      <div class="flex-1 overflow-auto p-2 scrollbar-dark">
        <!-- Bot selector -->
        <div 
          v-for="bot in botStore.bots" 
          :key="bot.username"
          @click="selectBot(bot.username)"
          class="w-full px-2 py-2 text-sm rounded-md cursor-pointer mb-0.5 border transition-colors"
          :class="selectedBot === bot.username 
            ? 'bg-[rgba(88,166,255,0.1)] border-space-accent text-space-accent' 
            : 'border-transparent text-space-text hover:bg-space-row-hover'"
        >
          {{ bot.username }}
        </div>
        <div v-if="botStore.bots.length === 0" class="text-xs text-space-text-dim italic p-2">
          No bots available
        </div>

        <!-- Panel navigation -->
        <div v-if="selectedBot" class="mt-3 pt-3 border-t border-[#21262d]">
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
    <div class="flex-1 bg-space-card border border-space-border rounded-lg overflow-auto p-4 scrollbar-dark">
      <div v-if="!selectedBot" class="text-space-text-dim italic text-sm py-8 text-center">
        Select a bot to manage ships.
      </div>

      <!-- Overview Panel -->
      <div v-else-if="activePanel === 'overview'">
        <div v-if="!shipData" class="text-xs text-space-text-dim italic py-4">Loading ship data...</div>
        <div v-else>
          <!-- Ship Header -->
          <div class="flex items-center gap-3 mb-4">
            <div>
              <div class="text-lg font-bold text-space-text-bright">{{ shipName }}</div>
              <div class="text-xs text-space-text-dim">{{ shipClass }} {{ shipTier ? '• Tier ' + shipTier : '' }}</div>
            </div>
            <div class="ml-auto text-xs text-space-yellow font-semibold">{{ fmt(botCredits) }} cr</div>
          </div>

          <!-- Ship Stats -->
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <div class="flex justify-between text-xs text-space-text-dim mb-0.5">
                <span>Hull</span>
                <span>{{ ship.hull ?? '?' }}/{{ ship.max_hull ?? ship.hull_max ?? '?' }}</span>
              </div>
              <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" :class="hullPct > 50 ? 'bg-space-green' : hullPct > 25 ? 'bg-space-yellow' : 'bg-space-red'" :style="{ width: hullPct + '%' }"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-space-text-dim mb-0.5">
                <span>Shield</span>
                <span>{{ ship.shield ?? '?' }}/{{ ship.max_shield ?? ship.shield_max ?? '?' }}</span>
              </div>
              <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full bg-space-cyan rounded-full transition-all" :style="{ width: shieldPct + '%' }"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-space-text-dim mb-0.5">
                <span>Fuel</span>
                <span>{{ ship.fuel ?? '?' }}/{{ ship.max_fuel ?? ship.fuel_max ?? '?' }}</span>
              </div>
              <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" :class="fuelPct > 30 ? 'bg-space-cyan' : 'bg-space-yellow'" :style="{ width: fuelPct + '%' }"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-space-text-dim mb-0.5">
                <span>Cargo</span>
                <span>{{ ship.cargo_used ?? ship.cargo ?? 0 }}/{{ ship.cargo_capacity ?? ship.max_cargo ?? ship.cargo_max ?? 0 }}</span>
              </div>
              <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div class="h-full bg-space-yellow rounded-full transition-all" :style="{ width: cargoPct + '%' }"></div>
              </div>
            </div>
          </div>

          <!-- Ship Details Grid -->
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs mb-4">
            <span class="text-space-text-dim">Speed</span><span class="text-space-text">{{ ship.speed ?? '?' }}</span>
            <span class="text-space-text-dim">Armor</span><span class="text-space-text">{{ ship.armor ?? '?' }}</span>
            <span v-if="ship.cpu_capacity" class="text-space-text-dim">CPU</span>
            <span v-if="ship.cpu_capacity" class="text-space-text">{{ ship.cpu_used ?? 0 }}/{{ ship.cpu_capacity }}</span>
            <span v-if="ship.power_capacity" class="text-space-text-dim">Power</span>
            <span v-if="ship.power_capacity" class="text-space-text">{{ ship.power_used ?? 0 }}/{{ ship.power_capacity }}</span>
          </div>

          <!-- Ship catalog description -->
          <div v-if="currentShipCatalog" class="mb-4 bg-space-bg border border-[#21262d] rounded-md p-3 text-xs">
            <div class="text-space-text-dim leading-relaxed">{{ currentShipCatalog.description }}</div>
            <div class="flex flex-wrap gap-1 mt-2" v-if="currentShipCatalog.flavor_tags?.length">
              <span v-for="tag in currentShipCatalog.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[10px]">{{ tag }}</span>
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="flex gap-2 mb-4" v-if="isDocked">
            <button @click="execCmd('repair')" :disabled="loading" class="btn text-xs px-3 py-1">Repair</button>
            <button @click="execCmd('refuel')" :disabled="loading" class="btn text-xs px-3 py-1">Refuel</button>
          </div>
          <div v-else class="text-xs text-space-text-dim italic mb-4">Dock at a station to repair/refuel.</div>

          <!-- Modules -->
          <div class="mb-2">
            <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Installed Modules</h4>
            <div v-if="modules.length === 0" class="text-xs text-space-text-dim italic">No modules found</div>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
              <div v-for="m in modules" :key="m.module_id || m.id" class="bg-space-bg border border-[#21262d] rounded-md p-2">
                <div class="text-[10px] uppercase text-space-text-dim tracking-wider">{{ m.type || m.slot_type || m.category || m.slot || '' }}</div>
                <div class="text-xs font-medium text-space-text">{{ moduleName(m) }}</div>
                <div v-if="m.wear != null" class="text-[10px] text-space-text-dim mt-0.5">Wear: {{ m.wear }}{{ typeof m.wear === 'number' ? '%' : '' }}</div>
                <button v-if="isDocked" @click="uninstallMod(m.module_id || m.id)" class="text-[10px] mt-1 px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors">Uninstall</button>
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
        <div v-else class="space-y-3">
          <div v-for="s in fleet" :key="s.ship_id" class="bg-space-bg border border-[#21262d] rounded-md p-3 text-xs">
            <!-- Header -->
            <div class="flex items-center justify-between mb-2">
              <div>
                <span class="text-space-text font-semibold">{{ s.class_name }}</span>
                <span class="text-space-text-dim ml-1 text-[10px]">{{ s.class_id }}</span>
              </div>
              <span v-if="s.is_active" class="px-2 py-0.5 rounded text-[10px] bg-[rgba(63,185,80,0.15)] text-space-green border border-space-green/30">Active</span>
            </div>
            <!-- Resource bars -->
            <div class="space-y-1 mb-2">
              <div>
                <div class="flex justify-between text-[10px] text-space-text-dim mb-0.5">
                  <span>Hull</span><span>{{ s.hull_cur }}/{{ s.hull_max }}</span>
                </div>
                <div class="h-1 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="s.hull_max > 0 && s.hull_cur/s.hull_max > 0.5 ? 'bg-space-green' : 'bg-space-red'" :style="{ width: s.hull_max > 0 ? (s.hull_cur/s.hull_max*100)+'%' : '0%' }"></div>
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-space-text-dim mb-0.5">
                  <span>Fuel</span><span>{{ s.fuel_cur }}/{{ s.fuel_max }}</span>
                </div>
                <div class="h-1 bg-[#21262d] rounded-full overflow-hidden">
                  <div class="h-full bg-space-cyan rounded-full transition-all" :style="{ width: s.fuel_max > 0 ? (s.fuel_cur/s.fuel_max*100)+'%' : '0%' }"></div>
                </div>
              </div>
            </div>
            <!-- Details row -->
            <div class="flex items-center justify-between">
              <div class="text-space-text-dim space-x-3">
                <span>⚙️ {{ s.modules }} mod</span>
                <span>📦 {{ s.cargo_used }} cargo</span>
                <span>📍 {{ s.location }}</span>
              </div>
              <button
                v-if="s.can_switch && isDocked"
                @click="switchShip(s.ship_id)"
                :disabled="loading"
                class="btn btn-primary text-[10px] px-2 py-0.5"
              >Switch</button>
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
        <div v-if="currentStationCatalog" class="mb-3 bg-space-bg border border-[#21262d] rounded-md p-3 text-xs">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-space-text font-semibold">{{ currentStationCatalog.name }}</span>
            <span class="text-space-text-dim text-[10px]">{{ currentStationCatalog.empire_name }}</span>
            <span v-if="currentStationCatalog.condition" class="ml-auto text-[10px] px-1.5 py-0.5 rounded" :class="currentStationCatalog.condition === 'operational' ? 'bg-[rgba(63,185,80,0.1)] text-space-green' : 'bg-[rgba(248,81,73,0.1)] text-space-red'">{{ currentStationCatalog.condition }}</span>
          </div>
          <div class="text-space-text-dim leading-relaxed">{{ currentStationCatalog.description }}</div>
          <div v-if="currentStationCatalog.condition_text && currentStationCatalog.condition !== 'operational'" class="mt-1 text-space-red text-[10px]">{{ currentStationCatalog.condition_text }}</div>
        </div>
        <div v-if="!isDocked" class="text-xs text-space-text-dim italic py-4">Dock at a station to browse ships.</div>
        <div v-else-if="showroomLoading" class="text-xs text-space-text-dim italic">Loading showroom...</div>
        <div v-else-if="showroom.length === 0">
          <div v-if="showroomTip" class="text-xs text-space-text-dim bg-[#21262d] rounded-md p-3 mb-2">💡 {{ showroomTip }}</div>
          <div v-else class="text-xs text-space-text-dim italic py-4">No ships available at this station.</div>
          <button @click="loadShowroom" :disabled="showroomLoading" class="btn text-xs px-3 py-1">🔄 Refresh</button>
        </div>
        <div v-else class="space-y-2">
          <div v-for="s in showroom" :key="s.class_id" class="flex items-center justify-between bg-space-bg border border-[#21262d] rounded-md p-3 text-xs">
            <div>
              <div class="text-space-text font-medium">{{ s.name }}</div>
              <div class="text-space-text-dim">{{ s.category }} {{ s.scale ? '• ' + s.scale : '' }}</div>
            </div>
            <div class="text-right">
              <div class="text-space-yellow font-semibold">{{ fmt(s.price) }} cr</div>
              <button 
                @click="buyShip(s.class_id)"
                :disabled="loading || botCredits < s.price"
                class="btn btn-primary text-xs px-3 py-0.5 mt-1"
              >Buy</button>
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
              class="bg-space-bg border border-space-border rounded-md px-2 py-1 text-xs text-space-text placeholder-space-text-dim focus:border-space-accent outline-none flex-1 min-w-0"
            />
            <select v-model="commissionEmpireFilter" class="bg-space-bg border border-space-border rounded-md px-2 py-1 text-xs text-space-text focus:border-space-accent outline-none">
              <option value="">All empires</option>
              <option v-for="[empire] in shipsGroupedByEmpire" :key="empire" :value="empire">{{ empire }}</option>
            </select>
            <select v-model="commissionTierFilter" class="bg-space-bg border border-space-border rounded-md px-2 py-1 text-xs text-space-text focus:border-space-accent outline-none">
              <option value="">All tiers</option>
              <option v-for="t in allTiers" :key="t" :value="t">Tier {{ t }}</option>
            </select>
          </div>

          <!-- Ship selector -->
          <div class="flex gap-2">
            <select
              v-model="commissionShipClass"
              @change="commissionQuote = null"
              class="flex-1 bg-space-bg border border-space-border rounded-md px-2 py-1.5 text-xs text-space-text focus:border-space-accent outline-none"
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

          <!-- Selected ship details from catalog -->
          <div v-if="selectedShipCatalog" class="bg-space-bg border border-[#21262d] rounded-md p-3 text-xs space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-space-text font-semibold">{{ selectedShipCatalog.name }}</div>
                <div class="text-space-text-dim text-[10px]">{{ selectedShipCatalog.class }} · {{ selectedShipCatalog.empire_name }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-space-yellow font-semibold">{{ selectedShipCatalog.price?.toLocaleString() }} cr</div>
                <div class="text-space-text-dim text-[10px]">Tier {{ selectedShipCatalog.tier }} · Scale {{ selectedShipCatalog.scale }}</div>
              </div>
            </div>
            <div class="text-space-text-dim leading-relaxed">{{ selectedShipCatalog.description }}</div>
            <!-- Base stats grid -->
            <div class="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px] pt-1 border-t border-[#21262d]">
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
            <!-- Build materials -->
            <div v-if="selectedShipCatalog.build_materials?.length > 0" class="pt-1 border-t border-[#21262d]">
              <div class="text-[10px] uppercase tracking-wider text-space-text-dim mb-1">🔩 Build Materials</div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <div v-for="mat in selectedShipCatalog.build_materials" :key="mat.item_id" class="text-[10px] text-space-text-dim flex items-center gap-1">
                  <span>{{ matIcon(mat.item_id) }}</span>
                  <span>{{ mat.item_name }}: <span class="text-space-text">×{{ mat.quantity }}</span></span>
                </div>
              </div>
            </div>
            <div v-if="selectedShipCatalog.flavor_tags?.length" class="flex flex-wrap gap-1 pt-1 border-t border-[#21262d]">
              <span v-for="tag in selectedShipCatalog.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[10px]">{{ tag }}</span>
            </div>

            <!-- Gather goal panel -->
            <div v-if="selectedShipCatalog.build_materials?.length" class="pt-2 border-t border-[#21262d]">
              <div v-if="currentGatherGoal?.target_id === commissionShipClass"
                class="flex items-center justify-between bg-[#0d2233] border border-[#1a3a5a] rounded-md p-2 text-xs">
                <span class="text-space-cyan">⚙️ Gathering materials for build...</span>
                <button @click="clearGatherGoal()" class="text-space-red hover:text-red-400 text-[10px]">✕ Cancel</button>
              </div>
              <button
                v-else
                @click="gatherShipMaterials()"
                class="btn text-[10px] px-3 py-1 w-full"
              >� Gather Materials for Build</button>
            </div>
          </div>

          <!-- Quote result -->
          <div v-if="commissionQuote" class="bg-space-bg border border-space-accent/30 rounded-md p-3 text-xs space-y-1.5">
            <div class="text-space-text font-semibold">Quote: {{ commissionQuote.ship_class || commissionShipClass }}</div>
            <div class="text-space-yellow">💰 Total cost: {{ fmt(commissionQuote.total_cost || commissionQuote.cost || 0) }} cr</div>
            <div v-if="commissionQuote.build_time" class="text-space-text-dim">⏱️ Build time: {{ commissionQuote.build_time }}s</div>
            <div v-if="commissionQuote.materials?.length > 0" class="space-y-0.5">
              <div class="text-[10px] uppercase tracking-wider text-space-text-dim mb-1">Materials (sourced by shipyard)</div>
              <div v-for="mat in commissionQuote.materials" :key="mat.item_id" class="text-space-text-dim pl-2">
                {{ mat.item_name || mat.item_id }}: ×{{ mat.quantity }}
              </div>
            </div>
            <div v-if="commissionQuote.message" class="text-space-text-dim italic">{{ commissionQuote.message }}</div>
            <button @click="doCommissionShip" :disabled="loading" class="btn btn-primary text-xs px-3 py-1 mt-1">🔨 Commission Ship</button>
          </div>

          <div v-if="!commissionQuote && commissionShipClass" class="text-xs text-space-text-dim italic">Click Quote to preview the cost from the shipyard.</div>
          <div v-if="!commissionShipClass" class="text-xs text-space-text-dim italic">Select a ship class above to see details and get a quote.</div>
        </div>
      </div>

      <!-- Modules Panel -->
      <div v-else-if="activePanel === 'modules'">
        <h3 class="text-sm font-semibold text-space-text-bright mb-3">Module Management</h3>
        
        <!-- Installed -->
        <div class="mb-4">
          <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Installed</h4>
          <div v-if="modules.length === 0" class="text-xs text-space-text-dim italic">No modules installed.</div>
          <div v-for="m in modules" :key="m.module_id || m.id" class="flex items-center justify-between py-1.5 px-2 border-b border-[#21262d] text-xs">
            <div>
              <span class="text-space-text font-medium">{{ moduleName(m) }}</span>
              <span class="text-space-text-dim ml-2">{{ m.slot_type || m.type || '' }}</span>
            </div>
            <button v-if="isDocked" @click="uninstallMod(m.module_id || m.id)" :disabled="loading" class="text-[10px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors">Uninstall</button>
          </div>
        </div>

        <!-- Installable from cargo -->
        <div v-if="isDocked && installableModules.length > 0">
          <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Install from Cargo</h4>
          <div v-for="m in installableModules" :key="m.itemId" class="flex items-center justify-between py-1.5 px-2 border-b border-[#21262d] text-xs">
            <span class="text-space-text">{{ m.name }}</span>
            <button @click="installMod(m.itemId)" :disabled="loading" class="text-[10px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-green hover:text-space-green transition-colors">Install</button>
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
import { ref, computed, watch } from 'vue';
import { useBotStore } from '../stores/botStore';

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

const panels = [
  { id: 'overview', label: 'Overview' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'showroom', label: 'Showroom' },
  { id: 'commission', label: 'Commission' },
  { id: 'modules', label: 'Modules' },
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
      if (tier !== '' && s.tier !== Number(tier)) return false;
      if (search && !s.name.toLowerCase().includes(search) && !s.id.toLowerCase().includes(search)) return false;
      return true;
    })] as [string, any[]])
    .filter(([, ships]) => ships.length > 0);
});

const allTiers = computed(() => {
  const tiers = new Set<number>();
  for (const s of botStore.publicShips) if (s.tier) tiers.add(s.tier);
  return [...tiers].sort((a, b) => a - b);
});

const selectedShipCatalog = computed(() => {
  if (!commissionShipClass.value) return null;
  return botStore.publicShips.find((s: any) => s.id === commissionShipClass.value) || null;
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
        };
      });
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
        price: s.price || 0,
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

function doCommissionShip() {
  if (!selectedBot.value || !commissionShipClass.value) return;
  if (!confirm(`Commission a ${commissionShipClass.value}? The shipyard will source materials at a markup.`)) return;
  loading.value = true;
  const username = selectedBot.value;
  botStore.sendExec(username, 'commission_ship', { ship_class: commissionShipClass.value }, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok) {
      const msg = result.data?.message || 'Ship commissioned!';
      setStatus(msg, true);
      commissionQuote.value = null;
    } else {
      setStatus(result.error || 'Commission failed', false);
    }
  });
}

// ── Gather Goal ───────────────────────────────────────────

const currentGatherGoal = computed(() => (botStore.settings?.gatherer?.goal as any) || null);

function gatherShipMaterials() {
  if (!selectedShipCatalog.value?.build_materials?.length) return;
  const bot = botStore.bots.find((b: any) => b.username === selectedBot.value) as any;
  botStore.saveSettings('gatherer', {
    goal: {
      id: `ship_${commissionShipClass.value}_${Date.now()}`,
      target_id: commissionShipClass.value,
      target_name: selectedShipCatalog.value.name,
      target_poi: bot?.poi || '',
      target_system: bot?.system || bot?.location || '',
      materials: selectedShipCatalog.value.build_materials.map((m: any) => ({
        item_id: m.item_id,
        item_name: m.item_name || m.name,
        quantity_needed: m.quantity,
      })),
    },
  });
  setStatus('📦 Gather goal created!', true);
}

function clearGatherGoal() {
  botStore.saveSettings('gatherer', { goal: null });
  setStatus('Gather goal cleared', false);
}

// Auto-load data when switching panels
watch(activePanel, (panel) => {
  if (panel === 'fleet') loadFleet();
  if (panel === 'showroom' && showroom.value.length === 0 && isDocked.value) loadShowroom();
});
</script>
