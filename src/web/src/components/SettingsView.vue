<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Bot Types</h3>
      </div>
      <div class="flex-1 overflow-auto">
        <div 
          v-for="tab in settingsTabs" 
          :key="tab.id"
          @click="activeTab = tab.id"
          class="px-3 py-2 text-sm cursor-pointer border-b border-[#21262d] transition-colors"
          :class="activeTab === tab.id 
            ? 'bg-space-row-hover text-space-accent border-l-2 border-l-space-accent pl-[10px]' 
            : 'text-space-text-dim hover:bg-space-row-hover hover:text-space-text'"
        >
          {{ tab.name }}
        </div>
      </div>
    </div>

    <!-- Settings Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg p-5 overflow-auto scrollbar-dark">

      <!-- General Settings -->
      <div v-if="activeTab === 'general'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">General Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Fleet-wide settings that apply to all bot routines.</p>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Faction Storage Station</div>
            <div class="text-xs text-space-text-dim mt-0.5">Home station for faction storage deposits.</div>
          </div>
          <select v-model="generalForm.factionStation" class="input text-sm min-w-[200px]">
            <option value="">(not set)</option>
            <option v-for="s in stationOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Faction Profit Donation %</div>
            <div class="text-xs text-space-text-dim mt-0.5">Percentage of profit donated to faction treasury.</div>
          </div>
          <div class="flex items-center gap-2">
            <input type="range" v-model.number="generalForm.factionDonatePct" min="0" max="100" step="5" class="w-28" />
            <span class="text-sm min-w-[36px] text-right tabular-nums">{{ generalForm.factionDonatePct }}%</span>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Enable API Request Logging</div>
            <div class="text-xs text-space-text-dim mt-0.5">Write all game API requests and responses to <code class="text-space-accent">data/api-logs/</code>. Default: off.</div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="generalForm.enableApiLogging" class="w-4 h-4 accent-space-accent" />
            <span class="text-sm" :class="generalForm.enableApiLogging ? 'text-green-400' : 'text-space-text-dim'">{{ generalForm.enableApiLogging ? 'Enabled' : 'Disabled' }}</span>
          </label>
        </div>

        <div class="save-bar">
          <button @click="saveGeneral" class="btn btn-primary">Save Settings</button>
        </div>
      </div>

      <!-- Miner Settings -->
      <div v-else-if="activeTab === 'miner'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Miner Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure how mining bots operate. Changes apply to all bots with the Miner routine.</p>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Target Ore (default)</div>
            <div class="text-xs text-space-text-dim mt-0.5">Seek out a specific ore type. Bot will travel to the best known location. Requires Explorer to have mapped ore locations.</div>
          </div>
          <select v-model="minerForm.targetOre" class="input text-sm min-w-[200px]">
            <option value="">(any ore — mine whatever is available)</option>
            <option v-for="ore in botStore.knownOres" :key="ore.item_id" :value="ore.item_id">{{ ore.name }}</option>
          </select>
        </div>

        <!-- Per-Bot Target Ore -->
        <div v-if="minerBots.length > 0" class="mt-4 pt-3 border-t border-[#21262d]">
          <div class="text-sm text-space-text mb-1">Per-Bot Target Ore</div>
          <div class="text-xs text-space-text-dim mb-2">Override the default target ore for individual miners. Leave as "(use default)" to use the global setting above.</div>
          <div v-for="bot in minerBots" :key="bot.username" class="setting-row py-2">
            <span class="text-xs text-space-text" style="min-width:120px">{{ bot.username }}</span>
            <select :value="perBotOre[bot.username] || ''" @change="perBotOre[bot.username] = ($event.target as HTMLSelectElement).value" class="input text-xs min-w-[180px]">
              <option value="">(use default)</option>
              <option v-for="ore in botStore.knownOres" :key="ore.item_id" :value="ore.item_id">{{ ore.name }}</option>
            </select>
          </div>
        </div>

        <!-- Ore Quotas -->
        <div class="mt-4 pt-3 border-t border-[#21262d]">
          <div class="text-sm text-space-text mb-1">Ore Quotas</div>
          <div class="text-xs text-space-text-dim mb-2">Maintain target stock levels per ore in faction storage. Miners prioritize the ore with biggest deficit. When all quotas are met, miners fall back to local mining.</div>
          <div v-if="Object.keys(minerForm.oreQuotas).length === 0" class="text-xs text-space-text-dim italic mb-2">No quotas set.</div>
          <div v-for="(qty, oreId) in minerForm.oreQuotas" :key="oreId" class="flex items-center justify-between py-1.5 border-b border-[#21262d]">
            <span class="text-xs text-space-text">{{ oreNameById(String(oreId)) }}</span>
            <div class="flex items-center gap-2">
              <input type="number" :value="qty" min="1" max="9999" @change="minerForm.oreQuotas[String(oreId)] = Number(($event.target as HTMLInputElement).value)" class="input text-xs w-[70px]" />
              <button @click="delete minerForm.oreQuotas[String(oreId)]" class="text-space-red text-xs hover:underline">✕</button>
            </div>
          </div>
          <div class="flex gap-2 items-center mt-2">
            <select v-model="quotaAddOre" class="input text-xs flex-1">
              <option value="">-- select ore --</option>
              <option v-for="ore in botStore.knownOres" :key="ore.item_id" :value="ore.item_id">{{ ore.name }}</option>
            </select>
            <input v-model.number="quotaAddQty" type="number" min="1" max="9999" class="input text-xs w-[70px]" />
            <button @click="addOreQuota" class="btn text-xs px-2 py-1">Add</button>
          </div>
        </div>

        <div class="setting-row mt-4">
          <div>
            <div class="text-sm text-space-text">Mining System</div>
            <div class="text-xs text-space-text-dim mt-0.5">Override system to mine in (ignored if Target Ore is set).</div>
          </div>
          <select v-model="minerForm.system" class="input text-sm min-w-[200px]">
            <option value="">(current system)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Primary Deposit</div>
            <div class="text-xs text-space-text-dim mt-0.5">Where to send ore when returning to station.</div>
          </div>
          <select v-model="minerForm.depositPrimary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Secondary Deposit</div>
            <div class="text-xs text-space-text-dim mt-0.5">Fallback if primary fails (e.g. faction storage full).</div>
          </div>
          <select v-model="minerForm.depositSecondary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Cargo Fill Threshold</div>
            <div class="text-xs text-space-text-dim mt-0.5">Return to station when cargo reaches this % full.</div>
          </div>
          <input type="number" v-model.number="minerForm.cargoThreshold" min="50" max="100" class="input text-sm w-24" />
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Refuel Threshold</div>
            <div class="text-xs text-space-text-dim mt-0.5">Refuel at station when fuel drops below this %.</div>
          </div>
          <input type="number" v-model.number="minerForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Repair Threshold</div>
            <div class="text-xs text-space-text-dim mt-0.5">Repair hull at station when HP drops below this %.</div>
          </div>
          <input type="number" v-model.number="minerForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>

        <div class="save-bar">
          <button @click="saveMiner" class="btn btn-primary">Save Settings</button>
        </div>
      </div>

      <!-- Crafter Settings -->
      <div v-else-if="activeTab === 'crafter'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Crafter Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Add recipes and set stock limits. The crafter bot will craft each item up to its limit, then stop.</p>

        <div class="mb-4">
          <div class="text-sm text-space-text mb-2">Craft Limits</div>
          <div v-if="Object.keys(crafterForm.craftLimits).length === 0" class="text-xs text-space-text-dim italic mb-2">No recipes configured. Add one below.</div>
          <div v-for="(qty, id) in crafterForm.craftLimits" :key="id" class="flex items-center justify-between py-1.5 border-b border-[#21262d]">
            <div>
              <span class="text-xs text-space-text font-medium">{{ recipeDisplayName(String(id)) }}</span>
              <span v-if="recipeCategoryById(String(id))" class="ml-2 text-[10px] px-1.5 py-0.5 bg-[#21262d] rounded text-space-text-dim">{{ recipeCategoryById(String(id)) }}</span>
              <div class="text-[10px] text-space-text-dim">{{ recipeComponentsStr(String(id)) }}</div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <input type="number" :value="qty" min="1" @change="crafterForm.craftLimits[String(id)] = Number(($event.target as HTMLInputElement).value)" class="input text-xs w-[70px]" />
              <button @click="delete crafterForm.craftLimits[String(id)]" class="text-space-red text-xs hover:underline">✕</button>
            </div>
          </div>

          <!-- Add recipe picker -->
          <div class="mt-3 p-2 border border-[#21262d] rounded-md bg-space-bg">
            <div class="flex gap-2 items-center mb-2">
              <input v-model="crafterSearch" type="text" placeholder="Search recipes..." class="input text-xs flex-1" />
              <select v-model="crafterFilterCat" class="input text-xs min-w-[100px]">
                <option value="">All</option>
                <option v-for="cat in recipeCategories" :key="cat" :value="cat">{{ cat }}</option>
              </select>
            </div>
            <div class="flex gap-2 items-center">
              <select v-model="crafterAddId" class="input text-xs flex-1">
                <option value="">-- select recipe --</option>
                <option v-for="r in filteredRecipes" :key="r.id" :value="r.id">{{ r.label }}</option>
              </select>
              <input v-model.number="crafterAddQty" type="number" min="1" class="input text-xs w-[70px]" />
              <button @click="addCraftLimit" :disabled="!crafterAddId" class="btn text-xs px-2 py-1">+ Add</button>
            </div>
            <div v-if="crafterAddId && selectedRecipeDetail" class="text-[10px] text-space-text-dim mt-1">{{ selectedRecipeDetail }}</div>
          </div>
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold</div><div class="text-xs text-space-text-dim mt-0.5">Refuel when fuel drops below this %.</div></div>
          <input type="number" v-model.number="crafterForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold</div><div class="text-xs text-space-text-dim mt-0.5">Repair hull when HP drops below this %.</div></div>
          <input type="number" v-model.number="crafterForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveCrafter" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Rescue Settings -->
      <div v-else-if="activeTab === 'rescue'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">FuelRescue Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Monitors fleet for stranded bots and delivers fuel cells or credits.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Scan Interval (seconds)</div><div class="text-xs text-space-text-dim mt-0.5">How often to check fleet for stranded bots.</div></div>
          <input type="number" v-model.number="rescueForm.scanIntervalSec" min="10" max="300" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Rescue Trigger (fuel %)</div><div class="text-xs text-space-text-dim mt-0.5">Bots below this fuel % trigger a rescue.</div></div>
          <input type="number" v-model.number="rescueForm.fuelThreshold" min="0" max="50" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Fuel Cells to Deliver</div></div>
          <input type="number" v-model.number="rescueForm.rescueFuelCells" min="1" max="50" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Credits to Send</div><div class="text-xs text-space-text-dim mt-0.5">Fallback when fuel cells unavailable. 0 = disabled.</div></div>
          <input type="number" v-model.number="rescueForm.rescueCredits" min="0" max="10000" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Self Refuel Threshold (%)</div></div>
          <input type="number" v-model.number="rescueForm.refuelThreshold" min="30" max="90" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveRescue" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Explorer Settings -->
      <div v-else-if="activeTab === 'explorer'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Explorer Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure how explorer bots chart distant systems.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Jumps per Run</div><div class="text-xs text-space-text-dim mt-0.5">Maximum number of system jumps before returning home.</div></div>
          <input type="number" v-model.number="explorerForm.maxJumps" min="1" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Survey Mode</div><div class="text-xs text-space-text-dim mt-0.5">Thorough visits every POI; quick only scans from arrival.</div></div>
          <select v-model="explorerForm.surveyMode" class="input text-sm min-w-[200px]">
            <option value="thorough">Thorough (visit all POIs)</option>
            <option value="quick">Quick (scan only)</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Scan POIs</div><div class="text-xs text-space-text-dim mt-0.5">Scan at each POI for ships and objects.</div></div>
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="explorerForm.scanPois" class="rounded" /><span class="text-sm">Enabled</span></label>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Avoid Low Security</div><div class="text-xs text-space-text-dim mt-0.5">Skip low-security systems to reduce risk.</div></div>
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="explorerForm.avoidLowSec" class="rounded" /><span class="text-sm">Enabled</span></label>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel when fuel drops below this %.</div></div>
          <input type="number" v-model.number="explorerForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Repair hull when HP drops below this %.</div></div>
          <input type="number" v-model.number="explorerForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveExplorer" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Coordinator Settings -->
      <div v-else-if="activeTab === 'coordinator'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Coordinator Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Analyzes market demand to auto-adjust crafter limits and miner ore targets.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Analysis Cycle (seconds)</div><div class="text-xs text-space-text-dim mt-0.5">How often to re-analyze market data.</div></div>
          <input type="number" v-model.number="coordForm.cycleIntervalSec" min="60" max="3600" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Min Profit Margin (%)</div><div class="text-xs text-space-text-dim mt-0.5">Only recommend recipes above this margin.</div></div>
          <input type="number" v-model.number="coordForm.minProfitMargin" min="1" max="500" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Craft Limit</div><div class="text-xs text-space-text-dim mt-0.5">Cap on any single recipe's craft limit.</div></div>
          <input type="number" v-model.number="coordForm.maxCraftLimit" min="5" max="500" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto-adjust Ore Target</div><div class="text-xs text-space-text-dim mt-0.5">Set miner targetOre to most-needed material.</div></div>
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="coordForm.autoAdjustOre" class="rounded" /><span class="text-sm">Enabled</span></label>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto-adjust Craft Limits</div><div class="text-xs text-space-text-dim mt-0.5">Adjust crafter craftLimits based on demand.</div></div>
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="coordForm.autoAdjustCraft" class="rounded" /><span class="text-sm">Enabled</span></label>
        </div>
        <div class="save-bar"><button @click="saveCoordinator" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Trader Settings -->
      <div v-else-if="activeTab === 'trader'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Trader Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Finds price spreads between stations, buys low and sells high.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Min Profit Per Unit (credits)</div><div class="text-xs text-space-text-dim mt-0.5">Only run routes where per-item profit exceeds this.</div></div>
          <input type="number" v-model.number="traderForm.minProfitPerUnit" min="1" max="10000" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Cargo Value (credits)</div><div class="text-xs text-space-text-dim mt-0.5">Cap on total investment per run. 0 = unlimited.</div></div>
          <input type="number" v-model.number="traderForm.maxCargoValue" min="0" max="1000000" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Fuel Cost Per Jump</div><div class="text-xs text-space-text-dim mt-0.5">Estimated fuel cost per jump for profit calc.</div></div>
          <input type="number" v-model.number="traderForm.fuelCostPerJump" min="0" max="1000" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Home System</div><div class="text-xs text-space-text-dim mt-0.5">Fallback system between trades. Empty = stay.</div></div>
          <input type="text" v-model="traderForm.homeSystem" placeholder="e.g. sol" class="input text-sm min-w-[200px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div></div>
          <input type="number" v-model.number="traderForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div></div>
          <input type="number" v-model.number="traderForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveTrader" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Gatherer Settings -->
      <div v-else-if="activeTab === 'gatherer'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Gatherer Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Collects build materials for a facility. Goal is assigned from the Station → Build tab.</p>

        <!-- Current goal (read-only) -->
        <div class="mb-4 p-3 rounded-md border border-space-border bg-space-bg">
          <div class="text-xs font-semibold text-space-text-dim uppercase mb-2">Current Goal</div>
          <template v-if="gathererGoal">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm text-space-text-bright font-medium">{{ gathererGoal.target_name }}</div>
                <div class="text-[10px] text-space-text-dim mt-0.5">{{ gathererGoal.target_system }} · {{ gathererGoal.target_poi }}</div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  <span v-for="m in gathererGoal.materials" :key="m.item_id" class="px-1.5 py-0.5 rounded text-[10px] bg-[#21262d] text-space-text">
                    {{ m.quantity_needed }}x {{ m.item_name }}
                  </span>
                </div>
              </div>
              <button @click="clearGathererGoal" class="btn btn-secondary text-xs px-2 py-0.5 shrink-0">✕ Clear</button>
            </div>
          </template>
          <div v-else class="text-xs text-space-text-dim italic">No goal set. Click 📦 Gather on a facility in the Station → Build tab.</div>
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel when fuel drops below this %.</div></div>
          <input type="number" v-model.number="gathererForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Repair hull when HP drops below this %.</div></div>
          <input type="number" v-model.number="gathererForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveGatherer" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Cleanup Settings -->
      <div v-else-if="activeTab === 'cleanup'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Cleanup Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Consolidates scattered station storage to a home base.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Deposit Station</div><div class="text-xs text-space-text-dim mt-0.5">Overrides general Faction Storage Station for this agent.</div></div>
          <select v-model="cleanupForm.homeStation" class="input text-sm min-w-[200px]">
            <option value="">(use general setting)</option>
            <option v-for="s in stationOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
        <div class="save-bar"><button @click="saveCleanup" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Gas Harvester Settings -->
      <div v-else-if="activeTab === 'gas_harvester'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Gas Harvester Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure gas cloud harvesting bots. They travel to gas clouds/nebulae and mine gas resources.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Target Gas</div><div class="text-xs text-space-text-dim mt-0.5">Seek a specific gas type. Bot will look for gas clouds with this resource.</div></div>
          <select v-model="gasForm.targetGas" class="input text-sm min-w-[200px]">
            <option value="">(any gas — harvest whatever is available)</option>
            <option v-for="ore in botStore.knownOres" :key="ore.item_id" :value="ore.item_id">{{ ore.name }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Harvesting System</div><div class="text-xs text-space-text-dim mt-0.5">Override system to harvest in. Bot will jump there on start.</div></div>
          <select v-model="gasForm.system" class="input text-sm min-w-[200px]">
            <option value="">(current system)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Primary Deposit</div><div class="text-xs text-space-text-dim mt-0.5">Where to send harvested gas when returning to station.</div></div>
          <select v-model="gasForm.depositPrimary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Secondary Deposit</div><div class="text-xs text-space-text-dim mt-0.5">Fallback if primary fails.</div></div>
          <select v-model="gasForm.depositSecondary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cargo Fill Threshold</div><div class="text-xs text-space-text-dim mt-0.5">Return to station when cargo reaches this % full.</div></div>
          <input type="number" v-model.number="gasForm.cargoThreshold" min="50" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel at station when fuel drops below this %.</div></div>
          <input type="number" v-model.number="gasForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Repair hull at station when HP drops below this %.</div></div>
          <input type="number" v-model.number="gasForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveGasHarvester" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Ice Harvester Settings -->
      <div v-else-if="activeTab === 'ice_harvester'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Ice Harvester Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure ice field harvesting bots. They travel to ice fields and mine ice resources.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Target Ice</div><div class="text-xs text-space-text-dim mt-0.5">Seek a specific ice type. Bot will look for ice fields with this resource.</div></div>
          <select v-model="iceForm.targetIce" class="input text-sm min-w-[200px]">
            <option value="">(any ice — harvest whatever is available)</option>
            <option v-for="ore in botStore.knownOres" :key="ore.item_id" :value="ore.item_id">{{ ore.name }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Harvesting System</div><div class="text-xs text-space-text-dim mt-0.5">Override system to harvest in. Bot will jump there on start.</div></div>
          <select v-model="iceForm.system" class="input text-sm min-w-[200px]">
            <option value="">(current system)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Primary Deposit</div><div class="text-xs text-space-text-dim mt-0.5">Where to send harvested ice when returning to station.</div></div>
          <select v-model="iceForm.depositPrimary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Secondary Deposit</div><div class="text-xs text-space-text-dim mt-0.5">Fallback if primary fails.</div></div>
          <select v-model="iceForm.depositSecondary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cargo Fill Threshold</div><div class="text-xs text-space-text-dim mt-0.5">Return to station when cargo reaches this % full.</div></div>
          <input type="number" v-model.number="iceForm.cargoThreshold" min="50" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel at station when fuel drops below this %.</div></div>
          <input type="number" v-model.number="iceForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Repair hull at station when HP drops below this %.</div></div>
          <input type="number" v-model.number="iceForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveIceHarvester" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Salvager Settings -->
      <div v-else-if="activeTab === 'salvager'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Salvager Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure salvage bots. They visit POIs in a system, scavenging wrecks for loot and materials.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Target System</div><div class="text-xs text-space-text-dim mt-0.5">Override system to salvage in. Bot will jump there on start.</div></div>
          <select v-model="salvagerForm.system" class="input text-sm min-w-[200px]">
            <option value="">(current system)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Home System</div><div class="text-xs text-space-text-dim mt-0.5">Station the salvager returns to for unloading. Defaults to start system.</div></div>
          <select v-model="salvagerForm.homeSystem" class="input text-sm min-w-[200px]">
            <option value="">(start system)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Primary Deposit</div><div class="text-xs text-space-text-dim mt-0.5">Where to send salvaged items when returning to station.</div></div>
          <select v-model="salvagerForm.depositPrimary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Secondary Deposit</div><div class="text-xs text-space-text-dim mt-0.5">Fallback if primary fails.</div></div>
          <select v-model="salvagerForm.depositSecondary" class="input text-sm min-w-[200px]">
            <option v-for="o in depositOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cargo Fill Threshold</div><div class="text-xs text-space-text-dim mt-0.5">Return to station when cargo reaches this % full.</div></div>
          <input type="number" v-model.number="salvagerForm.cargoThreshold" min="50" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel at station when fuel drops below this %.</div></div>
          <input type="number" v-model.number="salvagerForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Repair hull at station when HP drops below this %.</div></div>
          <input type="number" v-model.number="salvagerForm.repairThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveSalvager" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Hunter Settings -->
      <div v-else-if="activeTab === 'hunter'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Hunter Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure PvP/PvE hunter bots. They patrol lawless systems, engage targets, and respond to faction combat alerts.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Patrol System</div><div class="text-xs text-space-text-dim mt-0.5">Fixed system to patrol. Leave empty to use current system.</div></div>
          <select v-model="hunterForm.system" class="input text-sm min-w-[200px]">
            <option value="">(current system)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Return to dock when fuel drops below this %.</div></div>
          <input type="number" v-model.number="hunterForm.refuelThreshold" min="10" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Repair Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Return to dock when hull drops below this %.</div></div>
          <input type="number" v-model.number="hunterForm.repairThreshold" min="10" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Flee Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Flee combat when hull drops below this %.</div></div>
          <input type="number" v-model.number="hunterForm.fleeThreshold" min="5" max="60" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Ammo Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Resupply when ammo drops below this %.</div></div>
          <input type="number" v-model.number="hunterForm.ammoThreshold" min="0" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Reload Attempts</div><div class="text-xs text-space-text-dim mt-0.5">Give up reloading ammo after this many failed attempts.</div></div>
          <input type="number" v-model.number="hunterForm.maxReloadAttempts" min="1" max="10" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Faction Alert Response Range</div><div class="text-xs text-space-text-dim mt-0.5">Max jumps to respond to a faction combat alert. Set 0 to disable.</div></div>
          <input type="number" v-model.number="hunterForm.responseRange" min="0" max="10" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">NPCs Only</div><div class="text-xs text-space-text-dim mt-0.5">Only engage NPC ships, never players.</div></div>
          <input type="checkbox" v-model="hunterForm.onlyNPCs" class="w-4 h-4" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto Cloak</div><div class="text-xs text-space-text-dim mt-0.5">Activate cloak while patrolling (if ship has cloak module).</div></div>
          <input type="checkbox" v-model="hunterForm.autoCloak" class="w-4 h-4" />
        </div>
        <div class="save-bar"><button @click="saveHunter" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- AI Settings -->
      <div v-else-if="activeTab === 'ai'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">AI Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Configure the LLM used by the AI routine. Leave fields empty to use environment variables (OPENAI_COMPAT_BASE_URL, OPENAI_COMPAT_API_KEY, AI_MODEL) or Ollama defaults.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Base URL</div><div class="text-xs text-space-text-dim mt-0.5">OpenAI-compatible endpoint, e.g. https://api.openai.com/v1 or http://localhost:11434/v1</div></div>
          <input type="text" v-model="aiForm.baseUrl" placeholder="http://localhost:11434/v1" class="input text-sm min-w-[260px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">API Key</div><div class="text-xs text-space-text-dim mt-0.5">Bearer token. Use "ollama" for local Ollama.</div></div>
          <input type="password" v-model="aiForm.apiKey" placeholder="ollama" class="input text-sm min-w-[200px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Model</div><div class="text-xs text-space-text-dim mt-0.5">Model name, e.g. llama3.2, gpt-4o-mini</div></div>
          <input type="text" v-model="aiForm.model" placeholder="llama3.2" class="input text-sm min-w-[200px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cycle Interval (seconds)</div><div class="text-xs text-space-text-dim mt-0.5">Sleep between AI decision cycles.</div></div>
          <input type="number" v-model.number="aiForm.cycleIntervalSec" min="5" max="300" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Tool Calls Per Cycle</div><div class="text-xs text-space-text-dim mt-0.5">Safety cap on tool calls per cycle.</div></div>
          <input type="number" v-model.number="aiForm.maxToolCallsPerCycle" min="5" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Captain's Log Every N Cycles</div><div class="text-xs text-space-text-dim mt-0.5">How often the AI writes a captain's log entry.</div></div>
          <input type="number" v-model.number="aiForm.captainsLogEveryN" min="1" max="20" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveAi" class="btn btn-primary">Save Settings</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue';
import { useBotStore } from '../stores/botStore';

const botStore = useBotStore();
const activeTab = ref('general');

const settingsTabs = [
  { id: 'general', name: 'General' },
  { id: 'miner', name: 'Miner' },
  { id: 'crafter', name: 'Crafter' },
  { id: 'rescue', name: 'FuelRescue' },
  { id: 'explorer', name: 'Explorer' },
  { id: 'coordinator', name: 'Coordinator' },
  { id: 'trader', name: 'Trader' },
  { id: 'gas_harvester', name: 'GasHarvester' },
  { id: 'ice_harvester', name: 'IceHarvester' },
  { id: 'salvager', name: 'Salvager' },
  { id: 'hunter', name: 'Hunter' },
  { id: 'ai', name: 'AI' },
  { id: 'cleanup', name: 'Cleanup' },
  { id: 'gatherer', name: 'Gatherer' },
];

// ── Shared helpers ──────────────────────────────────────────
const depositOptions = computed(() => {
  const opts = [
    { value: 'faction', label: 'Faction storage' },
    { value: 'storage', label: 'Station storage' },
    { value: 'sell', label: 'Sell at market' },
  ];
  for (const bot of botStore.bots) {
    opts.push({ value: `bot:${bot.username}`, label: bot.username });
  }
  return opts;
});

function splitDeposit(val: string): { depositBot: string; depositMode: string } {
  if (val.startsWith('bot:')) return { depositBot: val.slice(4), depositMode: 'gift' };
  return { depositBot: '', depositMode: val };
}
function mergeDeposit(mode: string, bot: string): string {
  return bot ? `bot:${bot}` : mode;
}

function oreNameById(id: string): string {
  return botStore.knownOres.find((o: any) => o.item_id === id)?.name || id;
}

// ── General form ────────────────────────────────────────────
const generalForm = ref({ factionDonatePct: 10, factionStation: '', enableApiLogging: false });

// ── Miner form ──────────────────────────────────────────────
const minerForm = ref({
  targetOre: '',
  system: '',
  depositPrimary: 'faction',
  depositSecondary: 'storage',
  cargoThreshold: 80,
  refuelThreshold: 50,
  repairThreshold: 40,
  oreQuotas: {} as Record<string, number>,
});
const perBotOre = reactive<Record<string, string>>({});
const quotaAddOre = ref('');
const quotaAddQty = ref(50);

const minerBots = computed(() => botStore.bots.filter((b: any) => b.routine === 'miner'));

function addOreQuota() {
  if (!quotaAddOre.value) return;
  minerForm.value.oreQuotas[quotaAddOre.value] = quotaAddQty.value || 50;
  quotaAddOre.value = '';
  quotaAddQty.value = 50;
}

// ── Crafter form ────────────────────────────────────────────
const crafterForm = ref<{ craftLimits: Record<string, number>; refuelThreshold: number; repairThreshold: number }>({
  craftLimits: {},
  refuelThreshold: 50,
  repairThreshold: 40,
});
const crafterAddId = ref('');
const crafterAddQty = ref(10);
const crafterSearch = ref('');
const crafterFilterCat = ref('');

const allRecipes = computed(() => {
  const recipes = botStore.catalog?.recipes || {};
  return Object.entries(recipes).map(([id, r]: [string, any]) => ({
    id: r.recipe_id || r.id || id,
    name: r.name || id,
    category: r.category || 'Other',
    components: r.components || r.ingredients || r.inputs || r.materials || [],
    outputs: r.outputs || r.output || r.result || r.produces,
  }));
});

const recipeCategories = computed(() => {
  const cats = new Set<string>();
  for (const r of allRecipes.value) cats.add(r.category);
  return [...cats].sort();
});

const filteredRecipes = computed(() => {
  const usedIds = new Set(Object.keys(crafterForm.value.craftLimits));
  const search = crafterSearch.value.toLowerCase();
  const cat = crafterFilterCat.value;
  return allRecipes.value
    .filter(r => !usedIds.has(r.id))
    .filter(r => {
      if (search) return r.name.toLowerCase().includes(search) || r.id.toLowerCase().includes(search) || r.category.toLowerCase().includes(search);
      return !cat || r.category === cat;
    })
    .map(r => ({
      id: r.id,
      label: (search || !cat) && r.category ? `${r.name} [${r.category}]` : r.name,
    }));
});

const selectedRecipeDetail = computed(() => {
  const r = allRecipes.value.find(r => r.id === crafterAddId.value);
  if (!r) return '';
  const comps = r.components.map((c: any) => `${c.quantity || c.amount || 1}x ${c.name || c.item_name || c.item_id || c.id}`).join(', ');
  const rawOut = Array.isArray(r.outputs) ? r.outputs[0] : r.outputs;
  const out = rawOut || {};
  const outName = out.name || out.item_name || out.item_id || out.id || r.name;
  const outQty = out.quantity || out.amount || 1;
  return `${comps} → ${outQty}x ${outName}`;
});

function recipeDisplayName(id: string): string {
  return allRecipes.value.find(r => r.id === id)?.name || botStore.catalogName(id);
}
function recipeCategoryById(id: string): string {
  return allRecipes.value.find(r => r.id === id)?.category || '';
}
function recipeComponentsStr(id: string): string {
  const r = allRecipes.value.find(r => r.id === id);
  if (!r) return id;
  return r.components.map((c: any) => `${c.quantity || c.amount || 1}x ${c.name || c.item_name || c.item_id || c.id}`).join(', ');
}

// ── Rescue form ─────────────────────────────────────────────
const rescueForm = ref({
  scanIntervalSec: 30,
  fuelThreshold: 10,
  rescueFuelCells: 10,
  rescueCredits: 500,
  refuelThreshold: 60,
});

// ── Explorer form ───────────────────────────────────────────
const explorerForm = ref({
  maxJumps: 20,
  surveyMode: 'thorough',
  scanPois: true,
  avoidLowSec: false,
  refuelThreshold: 50,
  repairThreshold: 40,
});

// ── Coordinator form ────────────────────────────────────────
const coordForm = ref({
  cycleIntervalSec: 300,
  minProfitMargin: 20,
  maxCraftLimit: 50,
  autoAdjustOre: true,
  autoAdjustCraft: true,
});

// ── Trader form ─────────────────────────────────────────────
const traderForm = ref({
  minProfitPerUnit: 10,
  maxCargoValue: 0,
  fuelCostPerJump: 50,
  homeSystem: '',
  refuelThreshold: 50,
  repairThreshold: 40,
});

// ── Gatherer form ───────────────────────────────────────────
const gathererForm = ref({ refuelThreshold: 30, repairThreshold: 40 });

const gathererGoal = computed(() => (botStore.settings?.gatherer?.goal as any) || null);

function clearGathererGoal() {
  botStore.saveSettings('gatherer', { goal: null });
}

// ── Cleanup form ────────────────────────────────────────────
const cleanupForm = ref({ homeStation: '' });

// ── Gas Harvester form ──────────────────────────────────────
const gasForm = ref({
  targetGas: '',
  system: '',
  depositPrimary: 'faction',
  depositSecondary: 'storage',
  cargoThreshold: 80,
  refuelThreshold: 50,
  repairThreshold: 40,
});

// ── Ice Harvester form ──────────────────────────────────────
const iceForm = ref({
  targetIce: '',
  system: '',
  depositPrimary: 'faction',
  depositSecondary: 'storage',
  cargoThreshold: 80,
  refuelThreshold: 50,
  repairThreshold: 40,
});

// ── Hunter form ─────────────────────────────────────────────
const hunterForm = ref({
  system: '',
  refuelThreshold: 40,
  repairThreshold: 30,
  fleeThreshold: 20,
  ammoThreshold: 20,
  maxReloadAttempts: 3,
  responseRange: 3,
  onlyNPCs: true,
  autoCloak: false,
});

// ── AI form ───────────────────────────────────────────────────
const aiForm = ref({
  baseUrl: '',
  apiKey: '',
  model: '',
  cycleIntervalSec: 10,
  maxToolCallsPerCycle: 40,
  captainsLogEveryN: 5,
});

// ── Salvager form ───────────────────────────────────────────
const salvagerForm = ref({
  system: '',
  homeSystem: '',
  depositPrimary: 'sell',
  depositSecondary: 'faction',
  cargoThreshold: 80,
  refuelThreshold: 50,
  repairThreshold: 40,
});

// ── Station options (from mapData) ──────────────────────────
const stationOptions = computed(() => {
  const opts: { value: string; label: string }[] = [];
  for (const [sysId, sys] of Object.entries(botStore.mapData)) {
    const sysName = (sys as any).name || sysId;
    for (const poi of ((sys as any).pois || [])) {
      if (!poi.has_base) continue;
      opts.push({
        value: `${sysId}|${poi.id}`,
        label: `${poi.base_name || poi.name || poi.id} (${sysName})`,
      });
    }
  }
  return opts;
});

// ── Sync forms from server settings ─────────────────────────
watch(() => botStore.settings, (s) => {
  if (s.general) {
    generalForm.value.factionDonatePct = s.general.factionDonatePct ?? 10;
    const fSys = s.general.factionStorageSystem || '';
    const fSta = s.general.factionStorageStation || '';
    generalForm.value.factionStation = fSys && fSta ? `${fSys}|${fSta}` : '';
    generalForm.value.enableApiLogging = s.general.enableApiLogging ?? false;
  }
  if (s.miner) {
    const m = s.miner;
    minerForm.value.targetOre = m.targetOre || '';
    minerForm.value.system = m.system || '';
    minerForm.value.depositPrimary = mergeDeposit(m.depositMode || 'faction', m.depositBot || '');
    minerForm.value.depositSecondary = m.depositFallback || 'storage';
    minerForm.value.cargoThreshold = m.cargoThreshold ?? 80;
    minerForm.value.refuelThreshold = m.refuelThreshold ?? 50;
    minerForm.value.repairThreshold = m.repairThreshold ?? 40;
    minerForm.value.oreQuotas = { ...(m.oreQuotas || {}) };
  }
  if (s.crafter) {
    crafterForm.value.craftLimits = { ...(s.crafter.craftLimits || {}) };
    crafterForm.value.refuelThreshold = s.crafter.refuelThreshold ?? 50;
    crafterForm.value.repairThreshold = s.crafter.repairThreshold ?? 40;
  }
  if (s.rescue) {
    const r = s.rescue;
    rescueForm.value.scanIntervalSec = r.scanIntervalSec ?? 30;
    rescueForm.value.fuelThreshold = r.fuelThreshold ?? 10;
    rescueForm.value.rescueFuelCells = r.rescueFuelCells ?? 10;
    rescueForm.value.rescueCredits = r.rescueCredits ?? 500;
    rescueForm.value.refuelThreshold = r.refuelThreshold ?? 60;
  }
  if (s.explorer) {
    const e = s.explorer;
    explorerForm.value.maxJumps = e.maxJumps ?? 20;
    explorerForm.value.surveyMode = e.surveyMode ?? 'thorough';
    explorerForm.value.scanPois = e.scanPois ?? true;
    explorerForm.value.avoidLowSec = e.avoidLowSec ?? false;
    explorerForm.value.refuelThreshold = e.refuelThreshold ?? 50;
    explorerForm.value.repairThreshold = e.repairThreshold ?? 40;
  }
  if (s.coordinator) {
    const co = s.coordinator;
    coordForm.value.cycleIntervalSec = co.cycleIntervalSec ?? 300;
    coordForm.value.minProfitMargin = co.minProfitMargin ?? 20;
    coordForm.value.maxCraftLimit = co.maxCraftLimit ?? 50;
    coordForm.value.autoAdjustOre = co.autoAdjustOre !== false;
    coordForm.value.autoAdjustCraft = co.autoAdjustCraft !== false;
  }
  if (s.trader) {
    const t = s.trader;
    traderForm.value.minProfitPerUnit = t.minProfitPerUnit ?? 10;
    traderForm.value.maxCargoValue = t.maxCargoValue ?? 0;
    traderForm.value.fuelCostPerJump = t.fuelCostPerJump ?? 50;
    traderForm.value.homeSystem = t.homeSystem ?? '';
    traderForm.value.refuelThreshold = t.refuelThreshold ?? 50;
    traderForm.value.repairThreshold = t.repairThreshold ?? 40;
  }
  if (s.gatherer) {
    gathererForm.value.refuelThreshold = s.gatherer.refuelThreshold ?? 30;
    gathererForm.value.repairThreshold = s.gatherer.repairThreshold ?? 40;
  }
  if (s.cleanup) {
    const sys = s.cleanup.homeSystem || '';
    const sta = s.cleanup.homeStation || '';
    cleanupForm.value.homeStation = sys && sta ? `${sys}|${sta}` : '';
  }
  if (s.gas_harvester) {
    const g = s.gas_harvester;
    gasForm.value.targetGas = g.targetGas || '';
    gasForm.value.system = g.system || '';
    gasForm.value.depositPrimary = mergeDeposit(g.depositMode || 'faction', g.depositBot || '');
    gasForm.value.depositSecondary = g.depositFallback || 'storage';
    gasForm.value.cargoThreshold = g.cargoThreshold ?? 80;
    gasForm.value.refuelThreshold = g.refuelThreshold ?? 50;
    gasForm.value.repairThreshold = g.repairThreshold ?? 40;
  }
  if (s.ice_harvester) {
    const ic = s.ice_harvester;
    iceForm.value.targetIce = ic.targetIce || '';
    iceForm.value.system = ic.system || '';
    iceForm.value.depositPrimary = mergeDeposit(ic.depositMode || 'faction', ic.depositBot || '');
    iceForm.value.depositSecondary = ic.depositFallback || 'storage';
    iceForm.value.cargoThreshold = ic.cargoThreshold ?? 80;
    iceForm.value.refuelThreshold = ic.refuelThreshold ?? 50;
    iceForm.value.repairThreshold = ic.repairThreshold ?? 40;
  }
  if (s.salvager) {
    const sv = s.salvager;
    salvagerForm.value.system = sv.system || '';
    salvagerForm.value.homeSystem = sv.homeSystem || '';
    salvagerForm.value.depositPrimary = mergeDeposit(sv.depositMode || 'sell', '');
    salvagerForm.value.depositSecondary = sv.depositFallback || 'faction';
    salvagerForm.value.cargoThreshold = sv.cargoThreshold ?? 80;
    salvagerForm.value.refuelThreshold = sv.refuelThreshold ?? 50;
    salvagerForm.value.repairThreshold = sv.repairThreshold ?? 40;
  }
  if (s.hunter) {
    const h = s.hunter;
    hunterForm.value.system = h.system || '';
    hunterForm.value.refuelThreshold = h.refuelThreshold ?? 40;
    hunterForm.value.repairThreshold = h.repairThreshold ?? 30;
    hunterForm.value.fleeThreshold = h.fleeThreshold ?? 20;
    hunterForm.value.ammoThreshold = h.ammoThreshold ?? 20;
    hunterForm.value.maxReloadAttempts = h.maxReloadAttempts ?? 3;
    hunterForm.value.responseRange = h.responseRange ?? 3;
    hunterForm.value.onlyNPCs = h.onlyNPCs !== false;
    hunterForm.value.autoCloak = h.autoCloak === true;
  }
  if (s.ai) {
    const a = s.ai;
    aiForm.value.baseUrl = a.baseUrl || '';
    aiForm.value.apiKey = a.apiKey || '';
    aiForm.value.model = a.model || '';
    aiForm.value.cycleIntervalSec = a.cycleIntervalSec ?? 10;
    aiForm.value.maxToolCallsPerCycle = a.maxToolCallsPerCycle ?? 40;
    aiForm.value.captainsLogEveryN = a.captainsLogEveryN ?? 5;
  }
  // Per-bot ore overrides
  for (const bot of botStore.bots) {
    if (s[bot.username]?.targetOre !== undefined) {
      perBotOre[bot.username] = s[bot.username].targetOre || '';
    }
  }
}, { immediate: true, deep: true });

// ── Save functions ──────────────────────────────────────────
function saveGeneral() {
  const [factionStorageSystem, factionStorageStation] = generalForm.value.factionStation
    ? generalForm.value.factionStation.split('|') : ['', ''];
  botStore.saveSettings('general', {
    factionDonatePct: generalForm.value.factionDonatePct,
    factionStorageSystem, factionStorageStation,
    enableApiLogging: generalForm.value.enableApiLogging,
  });
}

function saveMiner() {
  const primary = splitDeposit(minerForm.value.depositPrimary);
  const secondary = splitDeposit(minerForm.value.depositSecondary);
  botStore.saveSettings('miner', {
    targetOre: minerForm.value.targetOre,
    system: minerForm.value.system,
    depositBot: primary.depositBot,
    depositMode: primary.depositMode,
    depositFallback: secondary.depositMode,
    sellOre: minerForm.value.depositPrimary === 'sell',
    cargoThreshold: minerForm.value.cargoThreshold,
    refuelThreshold: minerForm.value.refuelThreshold,
    repairThreshold: minerForm.value.repairThreshold,
    oreQuotas: { ...minerForm.value.oreQuotas },
  });
  // Save per-bot ore overrides
  for (const bot of minerBots.value) {
    const oreVal = perBotOre[bot.username] || '';
    botStore.saveSettings(bot.username, { targetOre: oreVal });
  }
}

function addCraftLimit() {
  if (!crafterAddId.value) return;
  crafterForm.value.craftLimits[crafterAddId.value] = crafterAddQty.value || 10;
  crafterAddId.value = '';
  crafterAddQty.value = 10;
}

function saveCrafter() {
  botStore.saveSettings('crafter', {
    craftLimits: { ...crafterForm.value.craftLimits },
    refuelThreshold: crafterForm.value.refuelThreshold,
    repairThreshold: crafterForm.value.repairThreshold,
  });
}

function saveRescue() { botStore.saveSettings('rescue', { ...rescueForm.value }); }
function saveExplorer() { botStore.saveSettings('explorer', { ...explorerForm.value }); }
function saveCoordinator() { botStore.saveSettings('coordinator', { ...coordForm.value }); }
function saveTrader() { botStore.saveSettings('trader', { ...traderForm.value }); }

function saveGatherer() {
  botStore.saveSettings('gatherer', {
    refuelThreshold: gathererForm.value.refuelThreshold,
    repairThreshold: gathererForm.value.repairThreshold,
  });
}

function saveCleanup() {
  const [homeSystem, homeStation] = cleanupForm.value.homeStation
    ? cleanupForm.value.homeStation.split('|') : ['', ''];
  botStore.saveSettings('cleanup', { homeSystem, homeStation });
}

function saveGasHarvester() {
  const primary = splitDeposit(gasForm.value.depositPrimary);
  const secondary = splitDeposit(gasForm.value.depositSecondary);
  botStore.saveSettings('gas_harvester', {
    targetGas: gasForm.value.targetGas,
    system: gasForm.value.system,
    depositBot: primary.depositBot,
    depositMode: primary.depositMode,
    depositFallback: secondary.depositMode,
    cargoThreshold: gasForm.value.cargoThreshold,
    refuelThreshold: gasForm.value.refuelThreshold,
    repairThreshold: gasForm.value.repairThreshold,
  });
}

function saveIceHarvester() {
  const primary = splitDeposit(iceForm.value.depositPrimary);
  const secondary = splitDeposit(iceForm.value.depositSecondary);
  botStore.saveSettings('ice_harvester', {
    targetIce: iceForm.value.targetIce,
    system: iceForm.value.system,
    depositBot: primary.depositBot,
    depositMode: primary.depositMode,
    depositFallback: secondary.depositMode,
    cargoThreshold: iceForm.value.cargoThreshold,
    refuelThreshold: iceForm.value.refuelThreshold,
    repairThreshold: iceForm.value.repairThreshold,
  });
}

function saveSalvager() {
  const primary = splitDeposit(salvagerForm.value.depositPrimary);
  const secondary = splitDeposit(salvagerForm.value.depositSecondary);
  botStore.saveSettings('salvager', {
    system: salvagerForm.value.system,
    homeSystem: salvagerForm.value.homeSystem,
    depositMode: primary.depositMode,
    depositFallback: secondary.depositMode,
    cargoThreshold: salvagerForm.value.cargoThreshold,
    refuelThreshold: salvagerForm.value.refuelThreshold,
    repairThreshold: salvagerForm.value.repairThreshold,
  });
}

function saveHunter() {
  botStore.saveSettings('hunter', { ...hunterForm.value });
}

function saveAi() {
  botStore.saveSettings('ai', { ...aiForm.value });
}
</script>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #21262d;
}
.setting-row:last-child { border-bottom: none; }
.save-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border, #30363d);
}
</style>
