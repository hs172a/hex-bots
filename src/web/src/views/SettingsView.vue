<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Bot Types</h3>
      </div>
      <div class="flex-1 overflow-auto">
        <template v-for="(groupTabs, groupName) in groupedTabs" :key="groupName">
          <div class="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-space-text-dim/60 select-none">{{ groupName }}</div>
          <div
            v-for="tab in groupTabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="px-3 py-1.5 text-xs cursor-pointer border-b border-[#21262d] transition-colors"
            :class="activeTab === tab.id
              ? 'bg-space-row-hover text-space-accent border-l-2 border-l-space-accent pl-[11px]'
              : 'text-space-text-dim hover:bg-space-row-hover hover:text-space-text'"
          >
            {{ tab.name }}
          </div>
        </template>
      </div>
    </div>

    <!-- Settings Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg p-5 overflow-auto scrollbar-dark">

      <!-- VM Pool Selector (only shown in hub master mode with connected VMs, not on hub tab) -->
      <div v-if="botStore.vmList.length > 0 && activeTab !== 'hub'" class="flex items-center gap-1.5 mb-4 pb-3 border-b border-space-border flex-wrap">
        <span class="text-[11px] text-space-text-dim uppercase tracking-wider mr-0.5">Pool:</span>
        <button
          @click="selectedVm = 'local'"
          class="px-2.5 py-0.5 rounded text-xs font-medium transition-colors border"
          :class="selectedVm === 'local'
            ? 'bg-space-accent text-black border-space-accent'
            : 'text-space-text-dim border-space-border hover:text-space-text hover:border-space-text-dim'"
        >local</button>
        <button
          v-for="vm in botStore.vmList"
          :key="vm"
          @click="selectedVm = vm"
          class="px-2.5 py-0.5 rounded text-xs font-medium transition-colors border"
          :class="selectedVm === vm
            ? 'bg-space-accent text-black border-space-accent'
            : 'text-space-text-dim border-space-border hover:text-space-text hover:border-space-text-dim'"
        >
          {{ vm }}
          <span v-if="botStore.vmStatuses[vm] !== 'online'" class="ml-1 opacity-50 text-[10px]">●</span>
          <span v-else-if="!botStore.vmSettings[vm]" class="ml-1 opacity-50 text-[10px]">(no data)</span>
        </button>
        <span v-if="selectedVm !== 'local'" class="ml-2 text-[11px] text-yellow-400/70 italic">
          editing settings for <strong class="text-yellow-400">{{ selectedVm }}</strong> — saved remotely
        </span>
      </div>

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
            <div class="text-sm text-space-text">Max Navigation Jumps</div>
            <div class="text-xs text-space-text-dim mt-0.5">Maximum jumps allowed per <code class="text-space-accent">navigateToSystem</code> call. Increase for larger galaxies. Default: 20.</div>
          </div>
          <input type="number" v-model.number="generalForm.maxJumps" min="5" max="100" class="input w-20 text-sm" />
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

        <!-- Routines Quick Reference -->
        <div class="mt-6 p-4 rounded bg-[#0d1117] border border-[#21262d] text-xs">
          <div class="font-semibold text-space-text mb-3 text-sm">📋 Routines Quick Reference</div>
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-space-text-dim border-b border-[#21262d]">
                <th class="pb-2 pr-4 font-medium">Routine</th>
                <th class="pb-2 pr-4 font-medium">LLM?</th>
                <th class="pb-2 pr-4 font-medium">Scope</th>
                <th class="pb-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody class="text-space-text-dim">
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">miner / ice_harvester / gas_harvester</td><td class="pr-4">—</td><td class="pr-4">Single bot</td><td>Mine resources, sell at station, loop</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">crafter</td><td class="pr-4">—</td><td class="pr-4">Single bot</td><td>Craft items to set stock limits</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">trader</td><td class="pr-4">—</td><td class="pr-4">Single bot</td><td>Buy low / sell high between stations</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">explorer / scout</td><td class="pr-4">—</td><td class="pr-4">Single bot</td><td>Chart systems, gather market intel</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">mission_runner</td><td class="pr-4">—</td><td class="pr-4">Single bot</td><td>Accept &amp; complete NPC missions for credits+XP</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">hunter</td><td class="pr-4">—</td><td class="pr-4">Single bot</td><td>PvP/PvE combat in lawless systems</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">rescue</td><td class="pr-4">—</td><td class="pr-4">Fleet-aware</td><td>Deliver fuel to stranded bots</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-text">coordinator</td><td class="pr-4">❌ rule-based</td><td class="pr-4">Fleet-aware</td><td>Auto-adjust miner ore targets + crafter limits</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-cyan font-medium">ai</td><td class="pr-4 text-yellow-400">✅ single-bot</td><td class="pr-4">Single bot</td><td>Fully autonomous: LLM plays the game for one bot</td></tr>
              <tr class="border-b border-[#21262d]"><td class="py-1.5 pr-4 text-space-cyan font-medium">pi_commander</td><td class="pr-4 text-yellow-400">✅ single-bot</td><td class="pr-4">Single bot</td><td>LLM agent with TODO list, wraps commander.ts CLI</td></tr>
              <tr><td class="py-1.5 pr-4 text-space-cyan font-medium">ai_commander</td><td class="pr-4 text-orange-400">✅ fleet LLM</td><td class="pr-4">All bots</td><td>One LLM brain controls the entire fleet</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Hub Settings -->
      <div v-else-if="activeTab === 'hub'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">🌐 Hub Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Centralized UI proxy — manage bots across multiple VMs from one dashboard. Master VM serves the Vue SPA; client VMs connect OUT to master's <code class="text-space-accent">/hub</code> WebSocket endpoint (no reverse tunnel needed). Configure in <code class="text-space-accent">config.toml</code> and restart to apply.</p>

        <!-- VM Connection Status table -->
        <div v-if="botStore.vmList.length > 0" class="mb-6">
          <div class="text-sm text-space-text mb-2 font-medium">Connected Remote VMs</div>
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-space-text-dim border-b border-[#21262d]">
                <th class="py-2 pr-6 text-left font-medium">Name</th>
                <th class="py-2 pr-6 text-left font-medium">Status</th>
                <th class="py-2 pr-6 text-left font-medium">Local Bots</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="vm in botStore.vmList" :key="vm" class="border-b border-[#21262d]">
                <td class="py-2 pr-6 text-space-text font-medium font-mono">{{ vm }}</td>
                <td class="py-2 pr-6">
                  <span
                    class="px-2 py-0.5 rounded border text-[11px] font-medium"
                    :class="vmBadgeClass(botStore.vmStatuses[vm])"
                  >{{ botStore.vmStatuses[vm] ?? 'offline' }}</span>
                </td>
                <td class="py-2 pr-6 text-space-text-dim">
                  {{ botStore.bots.filter(b => b.vm === vm).length }} bot(s)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Standalone notice -->
        <div v-else class="mb-6 p-4 rounded bg-[#0d1117] border border-[#21262d] text-xs">
          <div class="font-semibold text-space-text mb-2">Hub mode not active</div>
          <p class="text-space-text-dim mb-2">This instance is running in <strong class="text-space-text">standalone</strong> mode. To enable the hub, set <code class="text-space-accent">[hub] mode = &quot;master&quot;</code> in <code class="text-space-accent">config.toml</code>, then restart. Client VMs connect directly to this master's <code class="text-space-accent">/hub</code> WebSocket endpoint.</p>
          <p class="text-space-text-dim">See <code class="text-space-accent">config.toml.example</code> for full documentation and architecture diagrams.</p>
        </div>

        <!-- Config quick reference -->
        <div class="mt-2 p-4 rounded bg-[#0d1117] border border-[#21262d] text-xs mb-4">
          <div class="font-semibold text-space-text mb-2">Master VM config (Oracle Cloud / public IP)</div>
          <pre class="text-space-text-dim leading-relaxed overflow-x-auto text-[11px] whitespace-pre">[hub]
mode = &quot;master&quot;

# Optional allowlist — clients connect IN with vm_name + hub_key
[[hub.clients]]
name    = &quot;asus&quot;
api_key = &quot;hub_secret&quot;

[[hub.clients]]
name    = &quot;volt&quot;
api_key = &quot;hub_secret&quot;</pre>
        </div>
        <div class="p-4 rounded bg-[#0d1117] border border-[#21262d] text-xs mb-4">
          <div class="font-semibold text-space-text mb-2">Client VM config (any machine, even behind NAT)</div>
          <pre class="text-space-text-dim leading-relaxed overflow-x-auto text-[11px] whitespace-pre">[server]
serve_ui = false

[hub]
mode           = &quot;client&quot;
master_ws_url  = &quot;ws://&lt;master-public-ip&gt;:3210&quot;  # direct connection to master
api_key        = &quot;hub_secret&quot;

# Only DataSync needs SSH tunnel (forward tunnel to master's port 4001)
[ssh_tunnels]
enabled = true

[[ssh_tunnels.tunnels]]
name         = &quot;datasync&quot;
direction    = &quot;forward&quot;
ssh_host     = &quot;&lt;master-public-ip&gt;&quot;
ssh_user     = &quot;ubuntu&quot;
ssh_key_file = &quot;~/.ssh/id_rsa&quot;
local_port   = 4001   # client reaches http://127.0.0.1:4001
remote_port  = 4001   # master's DataSync HTTP port</pre>
        </div>
        <div class="p-4 rounded bg-[#0d1117] border border-[#21262d] text-xs">
          <div class="font-semibold text-space-text mb-2">How it works</div>
          <div class="text-space-text-dim space-y-1">
            <div>1. Master listens at <code class="text-space-accent">ws://master-ip:3210/hub</code></div>
            <div>2. Client opens: <code class="text-space-accent">ws://master-ip:3210/hub?vm_name=asus&amp;hub_key=...</code></div>
            <div>3. Master's ProxyHub registers the session — full bi-directional messaging</div>
            <div class="mt-2 text-green-400/80">No SSH reverse tunnel needed. Works from any NAT, any client IP.</div>
          </div>
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
              <span v-if="recipeCategoryById(String(id))" class="ml-2 text-[11px] px-1.5 py-0.5 bg-[#21262d] rounded text-space-text-dim">{{ recipeCategoryById(String(id)) }}</span>
              <div class="text-[11px] text-space-text-dim">{{ recipeComponentsStr(String(id)) }}</div>
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
            <div v-if="crafterAddId && selectedRecipeDetail" class="text-[11px] text-space-text-dim mt-1">{{ selectedRecipeDetail }}</div>
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
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cycle Delay (ms)</div><div class="text-xs text-space-text-dim mt-0.5">Wait after a successful craft cycle. Automatically extended (3–6×) when idle or materials are missing.</div></div>
          <input type="number" v-model.number="crafterForm.cycleDelayMs" min="2000" max="120000" step="1000" class="input text-sm w-28" />
        </div>

        <div class="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-space-text-dim">Auto-Craft Mode</div>
        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Enable Auto-Craft</div>
            <div class="text-xs text-space-text-dim mt-0.5">Scan all recipes and craft the most profitable ones automatically. Does not require craft limits to be set.</div>
          </div>
          <input type="checkbox" v-model="crafterForm.autoCraft" class="w-4 h-4 accent-space-accent" />
        </div>
        <div class="setting-row" :class="{ 'opacity-40 pointer-events-none': !crafterForm.autoCraft }">
          <div><div class="text-sm text-space-text">Min Profit %</div><div class="text-xs text-space-text-dim mt-0.5">Only craft recipes with profit margin above this %.</div></div>
          <input type="number" v-model.number="crafterForm.minProfitPct" min="1" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row" :class="{ 'opacity-40 pointer-events-none': !crafterForm.autoCraft }">
          <div><div class="text-sm text-space-text">Max Recipes</div><div class="text-xs text-space-text-dim mt-0.5">Max number of recipes to craft per cycle (ranked by profit).</div></div>
          <input type="number" v-model.number="crafterForm.maxAutoCraftRecipes" min="1" max="20" class="input text-sm w-24" />
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
        <p class="text-xs text-space-text-dim mb-3">Analyzes market demand to auto-adjust crafter limits and miner ore targets. <strong class="text-space-text">No LLM — pure rule-based logic.</strong></p>
        <div class="mb-5 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs text-space-text-dim">
          <div class="font-semibold text-space-text mb-1">How it works</div>
          <ol class="list-decimal list-inside space-y-0.5">
            <li>Scans market data across all known stations</li>
            <li>Finds which recipe ingredients have lowest stock / highest buy pressure</li>
            <li>Sets <code class="text-space-accent">targetOre</code> on all miners to the most-needed ingredient</li>
            <li>Adjusts <code class="text-space-accent">craftLimits</code> on crafter based on demand and current stock</li>
            <li>Repeats every N seconds</li>
          </ol>
          <div class="mt-2 text-space-text-dim"><span class="text-yellow-400">⚠️</span> Requires bots to have visited multiple stations so market data is populated. Does <strong class="text-white">not</strong> start or stop other bots.</div>
        </div>

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
          <input type="text" v-model="traderForm.homeSystem" placeholder="e.g. sol_star" class="input text-sm min-w-[200px]" />
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

        <!-- Per-bot goals (read-only) -->
        <div class="mb-4">
          <div class="text-xs font-semibold text-space-text-dim uppercase mb-2">Active Goals</div>
          <div v-if="!botGathererGoals.length" class="p-3 rounded-md border border-space-border bg-space-bg text-xs text-space-text-dim italic">No goals set. Click 📦 Gather on a facility in the Station → Build tab.</div>
          <div v-for="entry in botGathererGoals" :key="entry.username"
            class="p-3 rounded-md border border-space-border bg-space-bg mb-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-[11px] px-1.5 py-0.5 rounded bg-[#21262d] text-space-accent font-mono">{{ entry.username }}</span>
                  <span class="text-sm text-space-text-bright font-medium truncate">{{ entry.goal.target_name }}</span>
                </div>
                <div class="text-[11px] text-space-text-dim">{{ entry.goal.target_system || '—' }} · {{ entry.goal.target_poi || '—' }}</div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  <span v-for="m in entry.goal.materials" :key="m.item_id" class="px-1.5 py-0.5 rounded text-[11px] bg-[#21262d] text-space-text">
                    {{ m.quantity_needed }}× {{ m.item_name }}
                  </span>
                </div>
              </div>
              <button @click="clearGathererGoal(entry.username)" class="btn btn-secondary text-xs px-2 py-0.5 shrink-0">✕</button>
            </div>
          </div>
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

      <!-- CombatSelector Settings -->
      <div v-else-if="activeTab === 'combat_selector'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Combat Selector Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Rule-based orchestrator for combat bots. Scores hunter, missions, scout, explorer, and salvager each cycle and delegates to the best match.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Min Hull for Hunting (%)</div><div class="text-xs text-space-text-dim mt-0.5">Hunter is only enabled when hull is above this %. Below this it falls back to missions/scout.</div></div>
          <input type="number" v-model.number="combatSelectorForm.minHullForHunting" min="30" max="90" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Min Fuel for Hunting (%)</div><div class="text-xs text-space-text-dim mt-0.5">Hunter is disabled when fuel is below this %. Ensures reserves for combat.</div></div>
          <input type="number" v-model.number="combatSelectorForm.minFuelForHunting" min="10" max="70" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Min Mission Reward (cr)</div><div class="text-xs text-space-text-dim mt-0.5">Ignore available missions below this credit reward.</div></div>
          <input type="number" v-model.number="combatSelectorForm.minMissionReward" min="0" max="100000" step="100" class="input text-sm w-28" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Enable Salvager</div><div class="text-xs text-space-text-dim mt-0.5">Include salvager and scavenger as candidate routines between patrols.</div></div>
          <input type="checkbox" v-model="combatSelectorForm.enableSalvager" class="w-4 h-4" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Enable PvP</div><div class="text-xs text-space-text-dim mt-0.5">Allow hunter to attack player ships. Disabled by default (NPC only).</div></div>
          <input type="checkbox" v-model="combatSelectorForm.enablePvP" class="w-4 h-4" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Patrol System</div><div class="text-xs text-space-text-dim mt-0.5">Fixed system to patrol. Leave empty to use Hunter's own setting.</div></div>
          <select v-model="combatSelectorForm.patrolSystem" class="input text-sm min-w-[200px]">
            <option value="">(use Hunter setting)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Forced Routine</div><div class="text-xs text-space-text-dim mt-0.5">Bypass scoring and always run this routine. Leave empty for auto.</div></div>
          <select v-model="combatSelectorForm.forcedRoutine" class="input text-sm min-w-[200px]">
            <option value="">(auto)</option>
            <option value="hunter">Hunter</option>
            <option value="mission_runner">Mission Runner</option>
            <option value="scout">Scout</option>
            <option value="explorer">Explorer</option>
            <option value="salvager">Salvager</option>
            <option value="scavenger">Scavenger</option>
            <option value="return_home">Return Home</option>
          </select>
        </div>
        <div class="save-bar"><button @click="saveCombatSelector" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Scout Settings -->
      <div v-else-if="activeTab === 'scout'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Scout Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Visits systems and scans markets to gather intel. Prefers unvisited systems.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Jumps per Run</div><div class="text-xs text-space-text-dim mt-0.5">Maximum system jumps before returning home.</div></div>
          <input type="number" v-model.number="scoutForm.maxJumps" min="1" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Scan Delay (ms)</div><div class="text-xs text-space-text-dim mt-0.5">Delay between scanning actions in each system.</div></div>
          <input type="number" v-model.number="scoutForm.scanDelayMs" min="1000" max="30000" step="1000" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Return home when fuel drops below this %.</div></div>
          <input type="number" v-model.number="scoutForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveScout" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- ReturnHome Settings -->
      <div v-else-if="activeTab === 'return_home'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">ReturnHome Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Navigates a bot back to its home system, docks, refuels, and idles.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Home System</div><div class="text-xs text-space-text-dim mt-0.5">System to return to. Leave empty to use the bot's current system at start.</div></div>
          <select v-model="returnHomeForm.homeSystem" class="input text-sm min-w-[200px]">
            <option value="">(current system at start)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel along the way when fuel drops below this %.</div></div>
          <input type="number" v-model.number="returnHomeForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveReturnHome" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Quartermaster Settings -->
      <div v-else-if="activeTab === 'quartermaster'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Quartermaster Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Manages faction storage — withdraws refined goods to sell on market, deposits raw ores back.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Sell Threshold</div><div class="text-xs text-space-text-dim mt-0.5">Minimum quantity of an item before selling it on the market.</div></div>
          <input type="number" v-model.number="quartermasterForm.sellThreshold" min="1" max="100" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cycle Delay (ms)</div><div class="text-xs text-space-text-dim mt-0.5">Delay between inventory management cycles.</div></div>
          <input type="number" v-model.number="quartermasterForm.cycleDelayMs" min="10000" max="300000" step="10000" class="input text-sm w-28" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel when fuel drops below this %.</div></div>
          <input type="number" v-model.number="quartermasterForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="save-bar"><button @click="saveQuartermaster" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- MissionRunner Settings -->
      <div v-else-if="activeTab === 'mission_runner'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">MissionRunner Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Accepts and completes NPC missions for credits and XP. Supports deliver, mine, buy, sell, visit, and dock objective types.</p>

        <div class="setting-row items-start">
          <div><div class="text-sm text-space-text">Mission Types</div><div class="text-xs text-space-text-dim mt-0.5">Select mission types to accept. Leave all unchecked to accept any type.</div></div>
          <div class="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
            <label v-for="t in MISSION_TYPES" :key="t" class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" :value="t" v-model="missionRunnerForm.missionTypes" class="accent-space-accent" />
              <span class="text-sm text-space-text capitalize">{{ t }}</span>
            </label>
          </div>
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Difficulty Range</div><div class="text-xs text-space-text-dim mt-0.5">Filter by mission difficulty/level. 0 = no limit.</div></div>
          <div class="flex items-center gap-2">
            <input type="number" v-model.number="missionRunnerForm.minDifficulty" min="0" max="20" placeholder="Min" class="input text-sm w-20" />
            <span class="text-space-text-dim text-xs">–</span>
            <input type="number" v-model.number="missionRunnerForm.maxDifficulty" min="0" max="20" placeholder="Max" class="input text-sm w-20" />
          </div>
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Min Reward (credits)</div><div class="text-xs text-space-text-dim mt-0.5">Only accept missions with at least this credit reward. 0 = accept all.</div></div>
          <input type="number" v-model.number="missionRunnerForm.minReward" min="0" class="input text-sm w-28" />
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Prefer Buying Resources</div><div class="text-xs text-space-text-dim mt-0.5">Try to buy delivery items from market before mining them.</div></div>
          <input type="checkbox" v-model="missionRunnerForm.preferBuying" class="w-4 h-4 accent-space-accent" />
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Prefer Mining Resources</div><div class="text-xs text-space-text-dim mt-0.5">Mine resources when buying is unavailable or disabled.</div></div>
          <input type="checkbox" v-model="missionRunnerForm.preferMining" class="w-4 h-4 accent-space-accent" />
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Buy Price (per unit)</div><div class="text-xs text-space-text-dim mt-0.5">Skip buying if unit price exceeds this. 0 = no limit.</div></div>
          <input type="number" v-model.number="missionRunnerForm.maxBuyPrice" min="0" class="input text-sm w-28" />
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Refuel when fuel drops below this %.</div></div>
          <input type="number" v-model.number="missionRunnerForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cycle Delay (ms)</div><div class="text-xs text-space-text-dim mt-0.5">Wait time between mission cycles.</div></div>
          <input type="number" v-model.number="missionRunnerForm.cycleDelayMs" min="10000" max="300000" step="5000" class="input text-sm w-28" />
        </div>

        <div class="save-bar"><button @click="saveMissionRunner" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- ShipUpgrade Settings -->
      <div v-else-if="activeTab === 'ship_upgrade'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">ShipUpgrade Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">One-shot routine: buys or switches to a target ship class, then idles. Empties cargo, checks owned ships first, then checks shipyard.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Target Ship Class</div><div class="text-xs text-space-text-dim mt-0.5">The ship class ID to buy/switch to (e.g. "heavy_freighter").</div></div>
          <input type="text" v-model="shipUpgradeForm.targetShipClass" placeholder="ship_class_id" class="input text-sm min-w-[200px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Sell Old Ship</div><div class="text-xs text-space-text-dim mt-0.5">Sell the previous ship after switching.</div></div>
          <input type="checkbox" v-model="shipUpgradeForm.sellOldShip" class="w-4 h-4" />
        </div>
        <div class="save-bar"><button @click="saveShipUpgrade" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- FacilityManager Settings -->
      <div v-else-if="activeTab === 'facility_manager'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Facility Manager Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Monitors personal and faction facilities: alerts on expiring rent, auto-renews leases, and applies available faction facility upgrades.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto-Renew Facilities</div><div class="text-xs text-space-text-dim mt-0.5">Navigate to base and toggle facility off/on to pay rent when nearing expiry.</div></div>
          <input type="checkbox" v-model="facilityManagerForm.autoRenewFacilities" class="w-4 h-4 accent-space-accent" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto-Upgrade Faction Facilities</div><div class="text-xs text-space-text-dim mt-0.5">Automatically apply available faction facility tier upgrades (requires ManageFacilities permission).</div></div>
          <input type="checkbox" v-model="facilityManagerForm.autoUpgradeFacilities" class="w-4 h-4 accent-space-accent" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Rent Alert (ticks)</div><div class="text-xs text-space-text-dim mt-0.5">Alert and trigger renewal when fewer than this many ticks remain on the lease.</div></div>
          <input type="number" v-model.number="facilityManagerForm.rentAlertTicks" min="1" max="50" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cycle Interval (sec)</div><div class="text-xs text-space-text-dim mt-0.5">How often to re-check facility status (default 300s).</div></div>
          <input type="number" v-model.number="facilityManagerForm.cycleIntervalSec" min="60" class="input text-sm w-28" />
        </div>
        <div class="save-bar"><button @click="saveFacilityManager" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- ShipManager Settings -->
      <div v-else-if="activeTab === 'ship_manager'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">ShipManager Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Automates ship lifecycle: claims ready commissions, auto-installs mods, browses market, and keeps insurance active.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto-Claim Commissions</div><div class="text-xs text-space-text-dim mt-0.5">Automatically claim ships when commissions are ready.</div></div>
          <input type="checkbox" v-model="shipManagerForm.autoClaimCommissions" class="w-4 h-4 accent-space-accent" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Auto-Buy Insurance</div><div class="text-xs text-space-text-dim mt-0.5">Purchase insurance after claiming or buying a new ship.</div></div>
          <input type="checkbox" v-model="shipManagerForm.autoBuyInsurance" class="w-4 h-4 accent-space-accent" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Buy Price (cr)</div><div class="text-xs text-space-text-dim mt-0.5">Auto-buy listed ships priced at or below this. Set 0 to disable market browsing.</div></div>
          <input type="number" v-model.number="shipManagerForm.maxBuyPrice" min="0" class="input text-sm w-36" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Target Ship Class</div><div class="text-xs text-space-text-dim mt-0.5">Only buy ships of this class (e.g. "corvette"). Leave empty for any class.</div></div>
          <input type="text" v-model="shipManagerForm.targetClass" placeholder="any" class="input text-sm min-w-[180px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Home Base</div><div class="text-xs text-space-text-dim mt-0.5">Optional base POI ID to return to after acquiring ships. Falls back to bot home_base.</div></div>
          <input type="text" v-model="shipManagerForm.homeBase" placeholder="station_id" class="input text-sm min-w-[200px]" />
        </div>
        <div class="save-bar"><button @click="saveShipManager" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- Scavenger Settings -->
      <div v-else-if="activeTab === 'scavenger'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">Scavenger Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Roams between systems looting wrecks and jettisoned cargo. Deposits or sells when cargo is full.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Deposit Mode</div><div class="text-xs text-space-text-dim mt-0.5">What to do with looted goods.</div></div>
          <select v-model="scavengerForm.depositMode" class="input text-sm min-w-[160px]">
            <option value="sell">Sell at market</option>
            <option value="faction">Faction storage</option>
            <option value="storage">Station storage</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cargo Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Dock to deposit when cargo exceeds this %.</div></div>
          <input type="number" v-model.number="scavengerForm.cargoThreshold" min="50" max="95" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Refuel Threshold (%)</div><div class="text-xs text-space-text-dim mt-0.5">Dock to refuel when fuel drops below this %.</div></div>
          <input type="number" v-model.number="scavengerForm.refuelThreshold" min="20" max="80" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Home System</div><div class="text-xs text-space-text-dim mt-0.5">Optional home system to return to. Leave empty for free roaming.</div></div>
          <select v-model="scavengerForm.homeSystem" class="input text-sm min-w-[200px]">
            <option value="">(free roam)</option>
            <option v-for="sys in botStore.knownSystems" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
          </select>
        </div>
        <div class="save-bar"><button @click="saveScavenger" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- PI Commander Settings -->
      <div v-else-if="activeTab === 'pi_commander'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">🤖 PI Commander Settings</h3>
        <p class="text-xs text-space-text-dim mb-3">Single-bot LLM agent using the <strong class="text-space-text">pi-ai library</strong> (multi-provider, token-aware). Best for structured task-focused play with a clear mission goal.</p>
        <div class="mb-5 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs text-space-text-dim">
          <div class="font-semibold text-space-text mb-1">How it works</div>
          <ol class="list-decimal list-inside space-y-0.5">
            <li>Starts <code class="text-space-accent">commander.ts</code> CLI as a subprocess bound to this bot</li>
            <li>LLM reads game state + <code class="text-space-accent">_sessions/&lt;name&gt;/TODO.md</code></li>
            <li>Executes game commands, writes new TODO items, logs decisions</li>
            <li>On token limit: generates a handoff summary and restarts fresh context</li>
          </ol>
          <div class="mt-2 grid grid-cols-3 gap-2">
            <div class="p-2 rounded bg-[#161b22] border border-[#30363d]">
              <div class="text-yellow-400 font-medium mb-0.5">vs ai routine</div>
              <div>Uses pi-ai library (Anthropic/Ollama/OpenAI), has context compaction. Better for long missions.</div>
            </div>
            <div class="p-2 rounded bg-[#161b22] border border-[#30363d]">
              <div class="text-yellow-400 font-medium mb-0.5">vs ai_commander</div>
              <div>Controls ONE bot only. Can't start/stop other bots. Mission-focused.</div>
            </div>
            <div class="p-2 rounded bg-[#161b22] border border-[#30363d]">
              <div class="text-space-cyan font-medium mb-0.5">CLI alternative</div>
              <div><code class="text-space-accent">bun run src/commander.ts --model ollama/qwen3:8b "mine ore"</code></div>
            </div>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Model</div>
            <div class="text-xs text-space-text-dim mt-0.5">LLM model string, e.g. <code class="text-space-accent">ollama/qwen3:8b</code>, <code class="text-space-accent">anthropic/claude-sonnet-4-20250514</code></div>
          </div>
          <input type="text" v-model="piCommanderForm.model" placeholder="ollama/llama3.2" class="input text-sm min-w-[260px]" />
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Mission Instruction</div>
            <div class="text-xs text-space-text-dim mt-0.5">The agent's goal. Be specific about what you want it to do.</div>
          </div>
          <textarea v-model="piCommanderForm.instruction" rows="3" placeholder="Mine ore, sell it, and upgrade your ship when you can afford a better one." class="input text-sm min-w-[320px] resize-y"></textarea>
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Session Name</div>
            <div class="text-xs text-space-text-dim mt-0.5">Credentials directory under <code class="text-space-accent">_sessions/</code>. Leave blank to use the bot's username.</div>
          </div>
          <input type="text" v-model="piCommanderForm.session" placeholder="(bot username)" class="input text-sm min-w-[200px]" />
        </div>

        <div class="setting-row">
          <div>
            <div class="text-sm text-space-text">Debug Mode</div>
            <div class="text-xs text-space-text-dim mt-0.5">Pass <code class="text-space-accent">--debug</code> to commander — logs LLM token counts and retry details.</div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="piCommanderForm.debug" class="w-4 h-4 accent-space-accent" />
            <span class="text-sm" :class="piCommanderForm.debug ? 'text-green-400' : 'text-space-text-dim'">{{ piCommanderForm.debug ? 'Enabled' : 'Disabled' }}</span>
          </label>
        </div>

        <div class="mt-4 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs text-space-text-dim">
          <div class="font-semibold text-space-text mb-1">Per-Bot Overrides</div>
          <p class="mb-2">You can override model/instruction/session per bot. In <code class="text-space-accent">data/settings.json</code> add:</p>
          <pre class="font-mono text-[11px] text-space-cyan overflow-auto">{"pi_commander":{"bots":{"BotName":{"model":"ollama/qwen3:8b","instruction":"Mine ore"}}}}</pre>
        </div>

        <div class="save-bar"><button @click="savePiCommander" class="btn btn-primary">Save Settings</button></div>
      </div>

      <!-- AI Settings -->
      <!-- Alerts Settings -->
      <div v-else-if="activeTab === 'alerts'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">🔔 Alert Settings</h3>
        <p class="text-xs text-space-text-dim mb-5">Send webhook notifications to Telegram or Discord when important events occur. Leave URL blank to disable.</p>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Webhook URL</div><div class="text-xs text-space-text-dim mt-0.5">Telegram: <code class="text-space-accent">https://api.telegram.org/bot&lt;TOKEN&gt;/sendMessage?chat_id=&lt;ID&gt;</code><br>Discord: <code class="text-space-accent">https://discord.com/api/webhooks/...</code></div></div>
          <input type="text" v-model="alertsForm.webhookUrl" placeholder="https://..." class="input text-sm min-w-[340px]" />
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Webhook Type</div><div class="text-xs text-space-text-dim mt-0.5">How to format the payload. Discord uses <code>content</code> field, Telegram uses <code>text</code>.</div></div>
          <select v-model="alertsForm.webhookType" class="input text-sm">
            <option value="discord">Discord</option>
            <option value="telegram">Telegram</option>
            <option value="generic">Generic JSON ({text: ...})</option>
          </select>
        </div>

        <div class="text-xs font-semibold text-space-text-dim uppercase mt-4 mb-2">Triggers</div>
        <div v-for="trigger in alertTriggers" :key="trigger.key" class="setting-row">
          <div>
            <div class="text-sm text-space-text">{{ trigger.label }}</div>
            <div class="text-xs text-space-text-dim mt-0.5">{{ trigger.description }}</div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="alertsForm.triggers[trigger.key as keyof typeof alertsForm.triggers]" class="w-4 h-4 accent-space-accent" />
            <span class="text-sm" :class="alertsForm.triggers[trigger.key as keyof typeof alertsForm.triggers] ? 'text-space-green' : 'text-space-text-dim'">{{ alertsForm.triggers[trigger.key as keyof typeof alertsForm.triggers] ? 'On' : 'Off' }}</span>
          </label>
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Credits Target (optional)</div><div class="text-xs text-space-text-dim mt-0.5">Alert when total fleet credits exceed this value. 0 = disabled.</div></div>
          <input type="number" v-model.number="alertsForm.creditsTarget" min="0" class="input w-32 text-sm" />
        </div>

        <div class="flex gap-3 mt-6">
          <button @click="saveAlerts" class="btn btn-primary">Save Settings</button>
          <button @click="testWebhook" :disabled="!alertsForm.webhookUrl || testingWebhook" class="btn btn-secondary text-sm px-4">
            {{ testingWebhook ? '⏳ Sending…' : '🧪 Test Webhook' }}
          </button>
        </div>
      </div>

      <div v-else-if="activeTab === 'ai'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">🤖 AI Routine Settings</h3>
        <p class="text-xs text-space-text-dim mb-3">Single-bot fully autonomous LLM agent using <strong class="text-space-text">OpenAI-compatible tool-calling</strong>. Works with Ollama, OpenAI, Anthropic, or any compatible endpoint.</p>
        <div class="mb-5 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs text-space-text-dim">
          <div class="font-semibold text-space-text mb-1">How it works</div>
          <ol class="list-decimal list-inside space-y-0.5">
            <li>Refreshes game state every N seconds</li>
            <li>Builds context: current status, POIs, recent action log, persistent memory</li>
            <li>LLM calls tools: <code class="text-space-accent">game_exec</code>, <code class="text-space-accent">map_*</code>, <code class="text-space-accent">catalog_lookup</code>, <code class="text-space-accent">memory_update</code></li>
            <li>Persists goals/insights/decisions to <code class="text-space-accent">data/ai_memory.json</code></li>
            <li>Optionally writes a Captain's Log entry every N cycles</li>
          </ol>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <div class="p-2 rounded bg-[#161b22] border border-[#30363d]">
              <div class="text-yellow-400 font-medium mb-0.5">vs pi_commander</div>
              <div>Uses raw OpenAI API (no pi-ai library). Simpler setup, no context compaction — best for shorter cycles or strong models like GPT-4o.</div>
            </div>
            <div class="p-2 rounded bg-[#161b22] border border-[#30363d]">
              <div class="text-yellow-400 font-medium mb-0.5">vs ai_commander</div>
              <div>Controls ONE bot. Cannot start/stop other bots. Plays the game like a human player for this bot only.</div>
            </div>
          </div>
          <div class="mt-2">Leave fields empty to use <code class="text-space-accent">OPENAI_COMPAT_BASE_URL</code>, <code class="text-space-accent">OPENAI_COMPAT_API_KEY</code>, <code class="text-space-accent">AI_MODEL</code> env vars, or Ollama defaults.</div>
        </div>

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

      <!-- AI Commander Settings -->
      <div v-else-if="activeTab === 'ai_commander'">
        <h3 class="text-[15px] font-semibold text-space-text-bright mb-1">🧠 AI Commander Settings</h3>
        <p class="text-xs text-space-text-dim mb-3">Fleet-level LLM that controls <strong class="text-space-text">all bots</strong> — can start, stop, and redirect any bot based on fleet economy and goals. Run on a dedicated "HQ" bot.</p>
        <div class="mb-5 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs text-space-text-dim">
          <div class="font-semibold text-space-text mb-1">How it works</div>
          <ol class="list-decimal list-inside space-y-0.5">
            <li>Every N seconds: reads all bot statuses (state, credits, system, routine, stats)</li>
            <li>Sends fleet context + strategic instruction to LLM</li>
            <li>LLM returns <code class="text-space-accent">crimson_fleet_command</code> decisions: start/stop/exec per bot</li>
            <li>Executes decisions in order, up to max-actions-per-cycle cap</li>
            <li>Logs all decisions to <code class="text-space-accent">data/ai_commander_memory.json</code></li>
          </ol>
          <div class="mt-2 p-2 rounded bg-[#161b22] border border-[#30363d]">
            <span class="text-orange-400 font-medium">⚠️ Warning:</span> The LLM can stop running bots if it decides to reassign them. Use a clear strategic instruction and set Max Actions Per Cycle to limit its reach. Monitor the Commander → AI Agent tab for decisions.
          </div>
          <div class="mt-2">Uses same OpenAI-compatible API as the <code class="text-space-accent">ai</code> routine — can share endpoint/key. Leave blank to fall back to <code class="text-space-accent">OPENAI_COMPAT_*</code> env vars.</div>
        </div>

        <div class="setting-row">
          <div><div class="text-sm text-space-text">Base URL</div><div class="text-xs text-space-text-dim mt-0.5">OpenAI-compatible endpoint</div></div>
          <input type="text" v-model="aiCommanderForm.baseUrl" placeholder="http://localhost:11434/v1" class="input text-sm min-w-[260px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">API Key</div><div class="text-xs text-space-text-dim mt-0.5">Bearer token. Use "ollama" for local Ollama.</div></div>
          <input type="password" v-model="aiCommanderForm.apiKey" placeholder="ollama" class="input text-sm min-w-[200px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Model</div><div class="text-xs text-space-text-dim mt-0.5">e.g. llama3.2, gpt-4o-mini, claude-3-5-haiku</div></div>
          <input type="text" v-model="aiCommanderForm.model" placeholder="llama3.2" class="input text-sm min-w-[200px]" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Cycle Interval (seconds)</div><div class="text-xs text-space-text-dim mt-0.5">How often the commander re-evaluates the fleet. Default: 300s (5 min).</div></div>
          <input type="number" v-model.number="aiCommanderForm.cycleIntervalSec" min="60" max="3600" class="input text-sm w-24" />
        </div>
        <div class="setting-row">
          <div><div class="text-sm text-space-text">Max Actions Per Cycle</div><div class="text-xs text-space-text-dim mt-0.5">Cap on start/stop/exec commands per evaluation.</div></div>
          <input type="number" v-model.number="aiCommanderForm.maxActionsPerCycle" min="1" max="20" class="input text-sm w-24" />
        </div>
        <div class="setting-row items-start">
          <div><div class="text-sm text-space-text">Strategic Instruction</div><div class="text-xs text-space-text-dim mt-0.5">High-level goal for the fleet commander LLM.</div></div>
          <textarea v-model="aiCommanderForm.instruction" rows="3" placeholder="Maximize fleet earnings. Balance mining, trading, and exploration." class="input text-sm min-w-[320px] resize-y"></textarea>
        </div>

        <div class="mt-4 p-3 rounded bg-[#0d1117] border border-[#21262d] text-xs text-space-text-dim">
          <div class="font-semibold text-space-text mb-1">How It Works</div>
          <p>Start the <code class="text-space-accent">AI Commander</code> routine on any bot. Every cycle it reads the full fleet status and asks the LLM to decide which bots to start, stop, or redirect. All decisions are logged in <code class="text-space-cyan">data/ai_commander_memory.json</code>.</p>
        </div>

        <div class="save-bar"><button @click="saveAiCommander" class="btn btn-primary">Save Settings</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue';
import { useBotStore } from '../stores/botStore';

const botStore = useBotStore();
const activeTab = ref('general');

/** Selected pool/VM for settings: 'local' = this server, otherwise a remote VM name */
const selectedVm = ref('local');

/** Settings object for the currently selected VM */
const currentSettings = computed(() =>
  selectedVm.value === 'local'
    ? botStore.settings
    : (botStore.vmSettings[selectedVm.value] ?? {})
);

/** Save settings to the currently selected VM (local or remote via ProxyHub) */
function doSave(routine: string, s: Record<string, any>) {
  botStore.saveSettings(routine, s, selectedVm.value === 'local' ? undefined : selectedVm.value);
}

const settingsTabs = [
  { id: 'general',        name: '⚙️ General',        group: 'System' },
  { id: 'hub',            name: '🌐 Hub',             group: 'System' },
  { id: 'alerts',         name: '🔔 Alerts',          group: 'System' },
  { id: 'coordinator',    name: '📊 Coordinator',     group: 'Fleet' },
  { id: 'rescue',         name: '⛽ Fuel Rescue',     group: 'Fleet' },
  { id: 'quartermaster',  name: '📦 Quartermaster',   group: 'Fleet' },
  { id: 'mission_runner', name: '📋 Mission Runner',  group: 'Fleet' },
  { id: 'ship_upgrade',   name: '🔧 Ship Upgrade',    group: 'Fleet' },
  { id: 'ship_manager',      name: '🚀 Ship Manager',       group: 'Fleet' },
  { id: 'facility_manager',  name: '🏭 Facility Manager',   group: 'Fleet' },
  { id: 'miner',          name: '⛏️ Miner',           group: 'Economy' },
  { id: 'crafter',        name: '⚗️ Crafter',         group: 'Economy' },
  { id: 'trader',         name: '💹 Trader',          group: 'Economy' },
  { id: 'gatherer',       name: '🧲 Gatherer',        group: 'Economy' },
  { id: 'cleanup',        name: '🧹 Cleanup',         group: 'Economy' },
  { id: 'explorer',       name: '🗺️ Explorer',        group: 'Exploration' },
  { id: 'scout',          name: '🔭 Scout',           group: 'Exploration' },
  { id: 'return_home',    name: '🏠 Return Home',     group: 'Exploration' },
  { id: 'gas_harvester',  name: '🌫️ Gas Harvester',  group: 'Harvesting' },
  { id: 'ice_harvester',  name: '🧊 Ice Harvester',  group: 'Harvesting' },
  { id: 'scavenger',      name: '♻️ Scavenger',       group: 'Harvesting' },
  { id: 'salvager',       name: '🔩 Salvager',        group: 'Harvesting' },
  { id: 'hunter',           name: '🎯 Hunter',           group: 'Combat' },
  { id: 'combat_selector', name: '⚔️ Combat Selector', group: 'Combat' },
  { id: 'pi_commander',   name: '🤖 PI Commander',    group: 'AI' },
  { id: 'ai',             name: '🧠 AI Agent',        group: 'AI' },
  { id: 'ai_commander',   name: '🌐 AI Commander',    group: 'AI' },
];

const groupedTabs = computed(() => {
  const groups: Record<string, typeof settingsTabs> = {};
  for (const tab of settingsTabs) {
    if (!groups[tab.group]) groups[tab.group] = [];
    groups[tab.group].push(tab);
  }
  return groups;
});

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
const generalForm = ref({ factionDonatePct: 10, factionStation: '', enableApiLogging: false, maxJumps: 20 });

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
const crafterForm = ref<{ craftLimits: Record<string, number>; refuelThreshold: number; repairThreshold: number; cycleDelayMs: number; autoCraft: boolean; minProfitPct: number; maxAutoCraftRecipes: number }>({  
  craftLimits: {},
  refuelThreshold: 50,
  repairThreshold: 40,
  cycleDelayMs: 10000,
  autoCraft: false,
  minProfitPct: 10,
  maxAutoCraftRecipes: 5,
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

const botGathererGoals = computed(() =>
  botStore.bots
    .map(b => ({ username: b.username, goal: (botStore.settings as any)?.[b.username]?.goal ?? null }))
    .filter(e => e.goal != null)
);

function clearGathererGoal(username: string) {
  botStore.saveSettings(username, { goal: null });
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

// ── CombatSelector form ────────────────────────────────────
const combatSelectorForm = ref({
  minHullForHunting: 60,
  minFuelForHunting: 30,
  enablePvP: false,
  patrolSystem: '',
  forcedRoutine: '',
  enableSalvager: true,
  minMissionReward: 300,
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

// ── Alerts form ─────────────────────────────────────────────
const alertTriggers = [
  { key: 'botStopped',      label: 'Bot stopped',          description: 'When any bot routine stops (error or normal).' },
  { key: 'ipBlocked',       label: 'IP rate-limit block',   description: 'When the server receives an IP block from SpaceMolt.' },
  { key: 'missionComplete', label: 'Mission completed',     description: 'When a bot completes and claims a mission reward.' },
  { key: 'goalReached',     label: 'Goal reached',          description: 'When a fleet goal is marked as achieved.' },
  { key: 'creditsTarget',   label: 'Credits target hit',    description: 'When total fleet credits exceed the configured target.' },
];

const alertsForm = ref({
  webhookUrl: '',
  webhookType: 'discord' as 'discord' | 'telegram' | 'generic',
  creditsTarget: 0,
  triggers: { botStopped: true, ipBlocked: true, missionComplete: false, goalReached: true, creditsTarget: false },
});
const testingWebhook = ref(false);

async function testWebhook() {
  if (!alertsForm.value.webhookUrl) return;
  testingWebhook.value = true;
  try {
    await fetch('/api/admin/test-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: alertsForm.value.webhookUrl, type: alertsForm.value.webhookType }),
    });
  } catch {}
  testingWebhook.value = false;
}

// ── PI Commander form ──────────────────────────────────────
const piCommanderForm = ref({
  model: '',
  instruction: '',
  session: '',
  debug: false,
});

// ── AI Commander form ──────────────────────────────────
const aiCommanderForm = ref({
  baseUrl: '',
  apiKey: '',
  model: '',
  cycleIntervalSec: 300,
  maxActionsPerCycle: 5,
  instruction: 'Maximize fleet earnings. Balance mining, trading, and exploration.',
});

// ── AI form ─────────────────────────────────────────────
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

// ── Scout form ──────────────────────────────────────────────
const scoutForm = ref({
  refuelThreshold: 60,
  scanDelayMs: 3000,
  maxJumps: 20,
});

// ── ReturnHome form ─────────────────────────────────────────
const returnHomeForm = ref({
  homeSystem: '',
  refuelThreshold: 60,
});

// ── Quartermaster form ──────────────────────────────────────
const quartermasterForm = ref({
  refuelThreshold: 60,
  sellThreshold: 5,
  cycleDelayMs: 60000,
});

// ── MissionRunner form ──────────────────────────────────────
const MISSION_TYPES = ['delivery', 'mining', 'exploration', 'bounty', 'trade', 'craft', 'fetch'];
const missionRunnerForm = ref({
  missionTypes: [] as string[],
  minDifficulty: 0,
  maxDifficulty: 0,
  minReward: 0,
  preferBuying: true,
  preferMining: true,
  maxBuyPrice: 0,
  refuelThreshold: 50,
  cycleDelayMs: 30000,
});

// ── ShipUpgrade form ────────────────────────────────────────
const shipUpgradeForm = ref({
  targetShipClass: '',
  sellOldShip: true,
});

// ── FacilityManager form ────────────────────────────────────
const facilityManagerForm = ref({
  autoRenewFacilities: true,
  autoUpgradeFacilities: false,
  rentAlertTicks: 5,
  cycleIntervalSec: 300,
});

// ── ShipManager form ─────────────────────────────────────────
const shipManagerForm = ref({
  autoClaimCommissions: true,
  autoBuyInsurance: true,
  maxBuyPrice: 0,
  targetClass: '',
  homeBase: '',
});

// ── Scavenger form ──────────────────────────────────────────
const scavengerForm = ref({
  depositMode: 'sell',
  refuelThreshold: 60,
  cargoThreshold: 80,
  homeSystem: '',
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
function initForms(s: Record<string, any>) {
  if (s.general) {
    generalForm.value.factionDonatePct = s.general.factionDonatePct ?? 10;
    const fSys = s.general.factionStorageSystem || '';
    const fSta = s.general.factionStorageStation || '';
    generalForm.value.factionStation = fSys && fSta ? `${fSys}|${fSta}` : '';
    generalForm.value.enableApiLogging = s.general.enableApiLogging ?? false;
    generalForm.value.maxJumps = s.general.maxJumps ?? 20;
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
    crafterForm.value.cycleDelayMs = s.crafter.cycleDelayMs ?? 10000;
    crafterForm.value.autoCraft = s.crafter.autoCraft ?? false;
    crafterForm.value.minProfitPct = s.crafter.minProfitPct ?? 10;
    crafterForm.value.maxAutoCraftRecipes = s.crafter.maxAutoCraftRecipes ?? 5;
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
  if (s.combat_selector) {
    const cs = s.combat_selector;
    combatSelectorForm.value.minHullForHunting = cs.minHullForHunting ?? 60;
    combatSelectorForm.value.minFuelForHunting = cs.minFuelForHunting ?? 30;
    combatSelectorForm.value.enablePvP = cs.enablePvP === true;
    combatSelectorForm.value.patrolSystem = cs.patrolSystem || '';
    combatSelectorForm.value.forcedRoutine = cs.forcedRoutine || '';
    combatSelectorForm.value.enableSalvager = cs.enableSalvager !== false;
    combatSelectorForm.value.minMissionReward = cs.minMissionReward ?? 300;
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
  if (s.scout) {
    const sc = s.scout;
    scoutForm.value.refuelThreshold = sc.refuelThreshold ?? 60;
    scoutForm.value.scanDelayMs = sc.scanDelayMs ?? 3000;
    scoutForm.value.maxJumps = sc.maxJumps ?? 20;
  }
  if (s.return_home) {
    const rh = s.return_home;
    returnHomeForm.value.homeSystem = rh.homeSystem || '';
    returnHomeForm.value.refuelThreshold = rh.refuelThreshold ?? 60;
  }
  if (s.quartermaster) {
    const qm = s.quartermaster;
    quartermasterForm.value.refuelThreshold = qm.refuelThreshold ?? 60;
    quartermasterForm.value.sellThreshold = qm.sellThreshold ?? 5;
    quartermasterForm.value.cycleDelayMs = qm.cycleDelayMs ?? 60000;
  }
  if (s.mission_runner) {
    const mr = s.mission_runner;
    missionRunnerForm.value.missionTypes = Array.isArray(mr.missionTypes) ? mr.missionTypes : (mr.missionTypes ? String(mr.missionTypes).split(',').map((t: string) => t.trim()).filter(Boolean) : []);
    missionRunnerForm.value.minDifficulty = mr.minDifficulty ?? 0;
    missionRunnerForm.value.maxDifficulty = mr.maxDifficulty ?? 0;
    missionRunnerForm.value.minReward = mr.minReward ?? 0;
    missionRunnerForm.value.preferBuying = mr.preferBuying !== false;
    missionRunnerForm.value.preferMining = mr.preferMining !== false;
    missionRunnerForm.value.maxBuyPrice = mr.maxBuyPrice ?? 0;
    missionRunnerForm.value.refuelThreshold = mr.refuelThreshold ?? 50;
    missionRunnerForm.value.cycleDelayMs = mr.cycleDelayMs ?? 30000;
  }
  if (s.ship_upgrade) {
    const su = s.ship_upgrade;
    shipUpgradeForm.value.targetShipClass = su.targetShipClass || '';
    shipUpgradeForm.value.sellOldShip = su.sellOldShip !== false;
  }
  if (s.facility_manager) {
    const fm = s.facility_manager as Record<string, unknown>;
    facilityManagerForm.value.autoRenewFacilities = fm.autoRenewFacilities !== false;
    facilityManagerForm.value.autoUpgradeFacilities = (fm.autoUpgradeFacilities as boolean) ?? false;
    facilityManagerForm.value.rentAlertTicks = (fm.rentAlertTicks as number) ?? 5;
    facilityManagerForm.value.cycleIntervalSec = (fm.cycleIntervalSec as number) ?? 300;
  }
  if (s.ship_manager) {
    const sm = s.ship_manager as Record<string, unknown>;
    shipManagerForm.value.autoClaimCommissions = sm.autoClaimCommissions !== false;
    shipManagerForm.value.autoBuyInsurance = sm.autoBuyInsurance !== false;
    shipManagerForm.value.maxBuyPrice = (sm.maxBuyPrice as number) ?? 0;
    shipManagerForm.value.targetClass = (sm.targetClass as string) || '';
    shipManagerForm.value.homeBase = (sm.homeBase as string) || '';
  }
  if (s.scavenger) {
    const sv = s.scavenger;
    scavengerForm.value.depositMode = sv.depositMode || 'sell';
    scavengerForm.value.refuelThreshold = sv.refuelThreshold ?? 60;
    scavengerForm.value.cargoThreshold = sv.cargoThreshold ?? 80;
    scavengerForm.value.homeSystem = sv.homeSystem || '';
  }
  if (s.alerts) {
    const a = s.alerts;
    alertsForm.value.webhookUrl = a.webhookUrl || '';
    alertsForm.value.webhookType = (a.webhookType as any) || 'discord';
    alertsForm.value.creditsTarget = a.creditsTarget ?? 0;
    if (a.triggers) {
      Object.assign(alertsForm.value.triggers, a.triggers);
    }
  }
  if (s.pi_commander) {
    const p = s.pi_commander;
    piCommanderForm.value.model = p.model || '';
    piCommanderForm.value.instruction = p.instruction || '';
    piCommanderForm.value.session = p.session || '';
    piCommanderForm.value.debug = Boolean(p.debug ?? false);
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
  if (s.ai_commander) {
    const a = s.ai_commander;
    aiCommanderForm.value.baseUrl = a.baseUrl || '';
    aiCommanderForm.value.apiKey = a.apiKey || '';
    aiCommanderForm.value.model = a.model || '';
    aiCommanderForm.value.cycleIntervalSec = a.cycleIntervalSec ?? 300;
    aiCommanderForm.value.maxActionsPerCycle = a.maxActionsPerCycle ?? 5;
    aiCommanderForm.value.instruction = a.instruction || 'Maximize fleet earnings. Balance mining, trading, and exploration.';
  }
  // Per-bot ore overrides
  for (const bot of botStore.bots) {
    if (s[bot.username]?.targetOre !== undefined) {
      perBotOre[bot.username] = s[bot.username].targetOre || '';
    }
  }
}

// Apply local settings immediately and on every server update
watch(() => botStore.settings, s => {
  if (selectedVm.value === 'local') initForms(s);
}, { immediate: true, deep: true });

// Reload forms whenever the user picks a different VM pool
watch(selectedVm, vm => {
  initForms(vm === 'local' ? botStore.settings : (botStore.vmSettings[vm] ?? {}));
});

// Reload forms when fresh vmSettings arrive for the currently selected VM
watch(() => botStore.vmSettings, all => {
  if (selectedVm.value !== 'local') initForms(all[selectedVm.value] ?? {});
}, { deep: true });

// ── Save functions ──────────────────────────────────────────
function saveGeneral() {
  const [factionStorageSystem, factionStorageStation] = generalForm.value.factionStation
    ? generalForm.value.factionStation.split('|') : ['', ''];
  doSave('general', {
    factionDonatePct: generalForm.value.factionDonatePct,
    factionStorageSystem, factionStorageStation,
    enableApiLogging: generalForm.value.enableApiLogging,
    maxJumps: generalForm.value.maxJumps,
  });
}

function saveMiner() {
  const primary = splitDeposit(minerForm.value.depositPrimary);
  const secondary = splitDeposit(minerForm.value.depositSecondary);
  doSave('miner', {
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
    doSave(bot.username, { targetOre: oreVal });
  }
}

function addCraftLimit() {
  if (!crafterAddId.value) return;
  crafterForm.value.craftLimits[crafterAddId.value] = crafterAddQty.value || 10;
  crafterAddId.value = '';
  crafterAddQty.value = 10;
}

function saveCrafter() {
  doSave('crafter', {
    craftLimits: { ...crafterForm.value.craftLimits },
    refuelThreshold: crafterForm.value.refuelThreshold,
    repairThreshold: crafterForm.value.repairThreshold,
    cycleDelayMs: crafterForm.value.cycleDelayMs,
    autoCraft: crafterForm.value.autoCraft,
    minProfitPct: crafterForm.value.minProfitPct,
    maxAutoCraftRecipes: crafterForm.value.maxAutoCraftRecipes,
  });
}

function saveRescue() { doSave('rescue', { ...rescueForm.value }); }
function saveExplorer() { doSave('explorer', { ...explorerForm.value }); }
function saveCoordinator() { doSave('coordinator', { ...coordForm.value }); }
function saveTrader() { doSave('trader', { ...traderForm.value }); }

function saveGatherer() {
  doSave('gatherer', {
    refuelThreshold: gathererForm.value.refuelThreshold,
    repairThreshold: gathererForm.value.repairThreshold,
  });
}

function saveCleanup() {
  const [homeSystem, homeStation] = cleanupForm.value.homeStation
    ? cleanupForm.value.homeStation.split('|') : ['', ''];
  doSave('cleanup', { homeSystem, homeStation });
}

function saveGasHarvester() {
  const primary = splitDeposit(gasForm.value.depositPrimary);
  const secondary = splitDeposit(gasForm.value.depositSecondary);
  doSave('gas_harvester', {
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
  doSave('ice_harvester', {
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
  doSave('salvager', {
    system: salvagerForm.value.system,
    homeSystem: salvagerForm.value.homeSystem,
    depositMode: primary.depositMode,
    depositFallback: secondary.depositMode,
    cargoThreshold: salvagerForm.value.cargoThreshold,
    refuelThreshold: salvagerForm.value.refuelThreshold,
    repairThreshold: salvagerForm.value.repairThreshold,
  });
}

function saveCombatSelector() { doSave('combat_selector', { ...combatSelectorForm.value }); }
function saveHunter() { doSave('hunter', { ...hunterForm.value }); }
function saveScout() { doSave('scout', { ...scoutForm.value }); }
function saveReturnHome() { doSave('return_home', { ...returnHomeForm.value }); }
function saveQuartermaster() { doSave('quartermaster', { ...quartermasterForm.value }); }
function saveMissionRunner() {
  doSave('mission_runner', {
    missionTypes: missionRunnerForm.value.missionTypes,
    minDifficulty: missionRunnerForm.value.minDifficulty,
    maxDifficulty: missionRunnerForm.value.maxDifficulty,
    minReward: missionRunnerForm.value.minReward,
    preferBuying: missionRunnerForm.value.preferBuying,
    preferMining: missionRunnerForm.value.preferMining,
    maxBuyPrice: missionRunnerForm.value.maxBuyPrice,
    refuelThreshold: missionRunnerForm.value.refuelThreshold,
    cycleDelayMs: missionRunnerForm.value.cycleDelayMs,
  });
}
function saveShipUpgrade() { doSave('ship_upgrade', { ...shipUpgradeForm.value }); }
function saveFacilityManager() { doSave('facility_manager', { ...facilityManagerForm.value }); }
function saveShipManager() { doSave('ship_manager', { ...shipManagerForm.value }); }
function saveScavenger() { doSave('scavenger', { ...scavengerForm.value }); }

function saveAlerts() {
  doSave('alerts', {
    webhookUrl: alertsForm.value.webhookUrl,
    webhookType: alertsForm.value.webhookType,
    creditsTarget: alertsForm.value.creditsTarget,
    triggers: { ...alertsForm.value.triggers },
  });
}

function savePiCommander() { doSave('pi_commander', { ...piCommanderForm.value }); }
function saveAiCommander() { doSave('ai_commander', { ...aiCommanderForm.value }); }
function saveAi() { doSave('ai', { ...aiForm.value }); }

function vmBadgeClass(state: string | undefined) {
  if (state === 'online') return 'text-green-400 border-green-700/50 bg-green-900/20';
  if (state === 'connecting') return 'text-yellow-400 border-yellow-700/50 bg-yellow-900/20';
  return 'text-red-400 border-red-700/50 bg-red-900/20';
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
