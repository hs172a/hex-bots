<template>
  <div class="flex flex-col h-full overflow-hidden">
      <!-- Header -->
      <div class="flex items-center gap-4 px-3 py-2 border-b border-space-border bg-space-card">
        <button @click="$emit('close')" class="text-space-text-dim hover:text-space-text-bright transition-colors">
          ← Back
        </button>
        <h2 class="text-xl font-semibold text-space-text-bright">{{ currentBot.username }}</h2>
        <span class="text-sm text-space-text-dim">{{ currentBot.shipName || 'Unknown Ship' }}</span>
        <span 
          class="badge ml-auto"
          :class="{
            'badge-green': currentBot.state === 'running',
            'badge-yellow': currentBot.state === 'idle' || currentBot.state === 'stopped',
            'badge-red': currentBot.state === 'error'
          }"
        >
          {{ currentBot.state }}
        </span>
        <div class="flex gap-2">
          <button 
            v-if="currentBot.state === 'running'" 
            @click="$emit('stop')"
            class="btn-danger text-sm px-4"
          >
            Stop Bot
          </button>
          <button 
            v-if="currentBot.state === 'idle' || currentBot.state === 'stopped'" 
            @click="$emit('start')"
            class="btn btn-primary text-xs py-1 px-2"
          >
            Start Bot
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="flex-1 flex gap-2 p-2 overflow-hidden">
        <!-- Sidebar -->
        <div class="w-72 space-y-3 overflow-hidden">
          <!-- Status -->
          <div class="card py-2 px-3">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">📊 Status</h3>
            </div>
            <div class="py-1 px-0 space-y-1.5 text-xs">
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">💰</span>
                  <span class="text-space-text-dim">Credits</span>
                </div>
                <span class="text-space-yellow font-medium">₡{{ formatNumber(currentBot.credits) }}</span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">⛽</span>
                  <span class="text-space-text-dim">Fuel</span>
                </div>
                <span class="text-space-cyan">{{ currentBot.fuel }} / {{ currentBot.maxFuel }}</span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">❤️</span>
                  <span class="text-space-text-dim">Hull</span>
                </div>
                <span class="text-space-red">{{ currentBot.hull }} / {{ currentBot.maxHull }}</span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">🛡️</span>
                  <span class="text-space-text-dim">Shield</span>
                </div>
                <span class="text-space-cyan">{{ currentBot.shield }} / {{ currentBot.maxShield }}</span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">📦</span>
                  <span class="text-space-text-dim">Cargo</span>
                </div>
                <span class="text-space-magenta">{{ currentBot.cargo || 0 }} / {{ currentBot.cargoMax || 0 }}</span>
              </div>
              <!-- Weapon modules with magazine status (available after loadShipData) -->
              <template v-if="weaponModules.length > 0">
                <div v-for="wep in weaponModules" :key="wep.id" class="flex justify-between">
                  <div class="flex items-center gap-1 min-w-0">
                    <span class="w-4 text-center flex-shrink-0">🔫</span>
                    <span class="text-space-text-dim truncate" :title="wep.name || wep.type_id">{{ wep.name || 'Weapon' }}</span>
                  </div>
                  <span class="flex-shrink-0 ml-1" :class="(wep.current_ammo ?? 0) === 0 ? 'text-space-red font-semibold' : 'text-space-text'">
                    {{ wep.current_ammo ?? 0 }}/{{ wep.magazine_size ?? '?' }}
                    <span v-if="wep.ammo_type" class="text-[10px] text-space-text-dim">({{ wep.ammo_type }})</span>
                  </span>
                </div>
                <div class="flex justify-between">
                  <div class="flex items-center gap-1">
                    <span class="w-4 text-center">📦</span>
                    <span class="text-space-text-dim">Ammo in cargo</span>
                  </div>
                  <span :class="(currentBot.ammo || 0) === 0 ? 'text-space-red' : 'text-space-text'">{{ currentBot.ammo || 0 }}</span>
                </div>
              </template>
              <div v-else class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">🔫</span>
                  <span class="text-space-text-dim">Ammo</span>
                </div>
                <span :class="(currentBot.ammo || 0) === 0 ? 'text-space-red' : 'text-space-text'">{{ currentBot.ammo || 0 }}</span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">📍</span>
                  <span class="text-space-text-dim">Location</span>
                </div>
                <span class="text-space-cyan text-xs text-right">{{ formatLocation(currentBot) }}</span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1">
                  <span class="w-4 text-center">🏠</span>
                  <span class="text-space-text-dim">Docked</span>
                </div>
                <span :class="currentBot.docked ? 'text-space-green' : 'text-space-red'">{{ currentBot.docked ? 'Yes' : 'No' }}</span>
              </div>
            </div>
          </div>

          <!-- Cargo Hold -->
          <div class="card py-2 px-3 !mt-2">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">📦 Cargo Hold</h3>
            </div>
            <div class="py-1 px-0 max-h-40 overflow-auto scrollbar-dark">
              <div v-if="inventory.length === 0" class="text-xs text-space-text-dim text-center py-2">Empty</div>
              <div v-else class="space-y-1">
                <div v-for="item in inventory" :key="item.itemId" class="flex justify-between text-xs">
                  <span class="text-space-text">{{ item.name }}</span>
                  <span class="text-space-text-dim">x{{ item.quantity }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Station Storage -->
          <div class="card py-2 px-3 !mt-2">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">🏠 Station Storage</h3>
            </div>
            <div class="py-1 px-0 max-h-60 overflow-auto scrollbar-dark">
              <div v-if="storage.length === 0" class="text-xs text-space-text-dim text-center py-2">Empty</div>
              <div v-else class="space-y-1">
                <div v-for="item in storage" :key="item.itemId" class="flex justify-between text-xs">
                  <span class="text-space-text">{{ item.name }}</span>
                  <span class="text-space-text-dim">x{{ item.quantity }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Deposit Settings -->
          <div class="card py-2 px-3 !mt-2">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">💰 Deposit Settings</h3>
            </div>
            <div class="py-1 px-0 space-y-2 text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="text-space-text-dim">Primary</span>
                <select v-model="depositPrimary" class="input text-[11px] flex-1 !p-1">
                  <option value="station_storage">(global) Station Storage</option>
                  <option value="faction_storage">(global) Faction Storage</option>
                </select>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-space-text-dim">Secondary</span>
                <select v-model="depositSecondary" class="input text-[11px] flex-1 !p-1">
                  <option value="station_storage">(global) Station Storage</option>
                  <option value="faction_storage">(global) Faction Storage</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="w-72 space-y-3 overflow-hidden">
          <!-- Statistics -->
          <div class="card py-2 px-3">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">📊 Statistics</h3>
            </div>
            <div class="py-1 px-0">
              <div class="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
                <!-- Economy -->
                <div class="flex items-center gap-1 text-green-400">
                  <span>💰</span>
                  <span>₡{{ formatNumber(currentBot.playerStats?.creditsEarned ?? 0) }}</span>
                  <span class="text-gray-500">earned</span>
                </div>
                <div class="flex items-center gap-1 text-red-400">
                  <span>💸</span>
                  <span>{{ formatNumber(currentBot.playerStats?.creditsSpent ?? 0) }}</span>
                  <span class="text-gray-500">spent</span>
                </div>
                <!-- Mining -->
                <div class="flex items-center gap-1 text-amber-400">
                  <span>⛏️</span>
                  <span>{{ formatNumber(currentBot.playerStats?.oreMined ?? 0) }}</span>
                  <span class="text-gray-500">mined</span>
                </div>
                <div class="flex items-center gap-1 text-blue-400">
                  <span>🔄</span>
                  <span>{{ currentBot.playerStats?.tradesCompleted ?? 0 }}</span>
                  <span class="text-gray-500">trades</span>
                </div>

                <!-- Combat -->
                <div class="flex items-center gap-1 text-red-400">
                  <span>💥</span>
                  <span>{{ currentBot.playerStats?.shipsDestroyed ?? 0 }}</span>
                  <span class="text-gray-500">kills</span>
                </div>
                <div class="flex items-center gap-1 text-gray-400">
                  <span>💀</span>
                  <span>{{ currentBot.playerStats?.shipsLost ?? 0 }}</span>
                  <span class="text-gray-500">deaths</span>
                </div>

                <!-- Exploration -->
                <div class="flex items-center gap-1 text-purple-400">
                  <span>🗺️</span>
                  <span>{{ currentBot.playerStats?.systemsExplored ?? 0 }}</span>
                  <span class="text-gray-500">explored</span>
                </div>
                <div class="flex items-center gap-1 text-cyan-400">
                  <span>🏴‍☠️</span>
                  <span>{{ currentBot.playerStats?.piratesDestroyed ?? 0 }}</span>
                  <span class="text-gray-500">pirates</span>
                </div>
              </div>
            </div>
          </div>
          <!-- Skills -->
          <div class="card py-2 px-3 !mt-2">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">🎯 Skills</h3>
            </div>
            <div class="py-1 px-0">
              <div v-if="displaySkills.length === 0" class="text-xs text-space-text-dim text-center py-2">
                No skills data
                <button @click="fetchSkills" class="ml-2 text-space-accent hover:underline text-[10px]">🔄 Refresh</button>
              </div>
              <div v-else class="space-y-2">
                <template v-for="[category, catSkills] in groupedSkills" :key="category">
                  <!-- Category header -->
                  <div class="flex items-center gap-1.5 mt-1.5 first:mt-0">
                    <span :class="CATEGORY_COLOR[category] || 'text-gray-400'" class="text-xs">{{ CATEGORY_ICON[category] || '📚' }}</span>
                    <span class="text-[10px] uppercase font-semibold tracking-wide" :class="CATEGORY_COLOR[category] || 'text-gray-400'">{{ category }}</span>
                    <div class="flex-1 h-px bg-space-border"></div>
                  </div>
                  <!-- Skills in this category -->
                  <div class="space-y-1 pl-1">
                    <div v-for="skill in catSkills" :key="skill.skill_id" class="text-xs">
                      <div class="flex justify-between items-baseline">
                        <span class="text-gray-300 text-[10px]">{{ formatSkillName(skill.skill_id) }}</span>
                        <span class="text-space-text-dim flex items-center gap-1.5">
                          <span v-if="skill.xp !== undefined && skillXpNext(skill) > 0" class="text-[10px]">
                            {{ skill.xp }}/{{ skillXpNext(skill) }}
                          </span>
                          <span class="text-space-green font-medium">Lv{{ skill.level || 0 }}</span>
                        </span>
                      </div>
                      <div v-if="skill.xp !== undefined && skillXpNext(skill) > 0" class="h-1 bg-[#21262d] rounded-full mt-0.5 overflow-hidden">
                        <div class="h-full rounded-full transition-all" :class="CATEGORY_BAR_COLOR[category] || 'bg-space-accent'" :style="{ width: skillPct(skill) + '%' }"></div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <!-- Tab navigation -->
          <div class="flex gap-0 border-b border-space-border bg-space-card px-2 shrink-0">
            <button @click="activeMainTab = 'control'" class="px-4 py-2 text-xs font-medium border-b-2 transition-all" :class="activeMainTab === 'control' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🛠️ Control</button>
            <button @click="currentBot.docked && (activeMainTab = 'ship')" class="px-4 py-2 text-xs font-medium border-b-2 transition-all" :class="[activeMainTab === 'ship' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent', currentBot.docked ? 'hover:text-space-text cursor-pointer' : 'opacity-40 cursor-not-allowed']" :title="!currentBot.docked ? 'Dock at a station to manage ship modules' : ''">🛸 Ship</button>
            <button @click="currentBot.docked && loadStationTab()" class="px-4 py-2 text-xs font-medium border-b-2 transition-all" :class="[activeMainTab === 'station' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent', currentBot.docked ? 'hover:text-space-text cursor-pointer' : 'opacity-40 cursor-not-allowed']" :title="!currentBot.docked ? 'Dock at a station to view station info' : ''">🏠 Station</button>
          </div>
          <!-- Control tab -->
          <div v-show="activeMainTab === 'control'" class="flex-1 flex flex-col gap-2 py-2 px-0 overflow-hidden">
          <!-- Manual Control Panel -->
          <div class="card  py-2 px-3 flex flex-col flex-1 overflow-hidden">
            <div class="py-1 px-0 border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">Manual Control</h3>
            </div>
            <div class="flex-1 py-1 px-0 overflow-auto scrollbar-dark">
              <div class="grid grid-cols-2 gap-x-6 gap-y-3">
                
                <!-- Travel -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Travel</label>
                  <select v-model="travelPoi" class="input text-xs flex-1 !p-1">
                    <option value="">Select POI...</option>
                    <option v-for="poi in systemPois" :key="poi.id" :value="poi.id">
                      {{ poi.name }} ({{ poi.type }})
                    </option>
                  </select>
                  <button @click="execTravel" class="btn btn-primary text-xs px-3 py-1">Go</button>
                </div>

                <!-- Long Distance Travel -->
                <div class="flex flex-col gap-1.5 col-span-2">
                  <label class="text-xs font-semibold text-space-text-dim">🗺️ Long Distance Travel</label>
                  <div class="flex gap-2 items-center">
                    <input
                      type="text"
                      v-model="destSystem"
                      list="ld-system-list"
                      placeholder="Type destination system name..."
                      class="input text-xs flex-1 !p-1"
                      @keyup.enter="findRouteLD"
                    />
                    <datalist id="ld-system-list">
                      <option v-for="sys in knownSystems" :key="sys.id" :value="sys.name || sys.id" />
                    </datalist>
                    <button @click="findRouteLD" :disabled="!destSystem || ldLoading" class="btn btn-primary text-xs px-3 py-1 flex-shrink-0">
                      {{ ldLoading ? '⏳' : '🔍 Find Route' }}
                    </button>
                  </div>
                  <div v-if="ldRouteError" class="text-xs text-space-red">⚠ {{ ldRouteError }}</div>
                  <div v-if="ldRoute.length > 0" class="bg-[#0d1117] border border-space-border rounded p-1 space-y-2 text-[11px]">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-semibold text-space-text-bright">Route: {{ ldRoute.length }} jumps</span>
                      <button @click="ldRoute = []; ldRouteError = ''" class="text-[10px] text-space-text-dim hover:text-space-red">✕</button>
                    </div>
                    <div class="text-xs text-space-text-dim max-h-20 overflow-auto scrollbar-dark space-y-0.5">
                      <div
                        v-for="(sys, i) in ldRoute.slice(0, 20)" :key="i"
                        :class="i < ldProgress ? 'text-green-400 opacity-60' : i === ldProgress && ldRelocating ? 'text-space-accent font-semibold' : 'text-space-text-dim'"
                      >{{ i + 1 }}. {{ sys.name || sys.system_id || sys }}</div>
                      <div v-if="ldRoute.length > 20" class="opacity-40">+{{ ldRoute.length - 20 }} more…</div>
                    </div>
                    <!-- Progress when relocating -->
                    <div v-if="ldRelocating" class="space-y-1">
                      <div class="text-xs text-space-text-dim">{{ ldProgress }}/{{ ldRoute.length }} jumps complete</div>
                      <div class="h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                        <div class="h-full bg-green-500 rounded-full transition-all" :style="{ width: (ldProgress / ldRoute.length * 100) + '%' }"></div>
                      </div>
                    </div>
                    <!-- Action buttons -->
                    <div class="flex gap-2">
                      <button
                        v-if="currentBot.docked && !ldRelocating"
                        @click="ldUndockAndStart"
                        class="flex-1 btn btn-primary text-xs py-1"
                      >🚀 Undock &amp; Jump</button>
                      <button
                        v-else-if="!ldRelocating"
                        @click="ldStartRelocation"
                        :disabled="!!(currentBot.docked)"
                        class="flex-1 btn btn-primary text-xs py-1 disabled:opacity-50"
                      >🚀 Start Jumping</button>
                      <button
                        v-if="ldRelocating"
                        @click="ldStopRelocation"
                        class="btn text-xs px-3 py-1 border border-space-red text-space-red hover:bg-space-red/10"
                      >⏹ Stop</button>
                      <span v-if="ldRelocating" class="flex-1 text-xs text-space-text-dim flex items-center">
                        Jumping to {{ ldRoute[ldProgress]?.name || ldRoute[ldProgress]?.system_id || 'destination' }}…
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Dock/Undock -->
                <div class="flex gap-2 items-center col-span-2">
                  <label class="text-xs text-space-text-dim w-20"></label>
                  <button @click="execCommand('dock')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🏠 Dock</button>
                  <button @click="execCommand('undock')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🚀 Undock</button>

                  <!-- Mine/Scan -->
                  <button @click="execCommand('mine')" class="btn btn-secondary text-xs px-3 py-1 flex-1">⛏️ Mine</button>
                  <button @click="execCommand('scan')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🔍 Scan</button>

                  <!-- Refuel/Repair -->
                  <button @click="execCommand('refuel')" class="btn btn-secondary text-xs px-3 py-1 flex-1">⛽ Refuel</button>
                  <button @click="execCommand('repair')" class="btn btn-secondary text-xs px-3 py-1 flex-1">🔧 Repair</button>
                </div>
                                <div class="flex gap-2 items-center"></div>

                <!-- Craft -->
                <div class="flex gap-2 items-center col-span-2">
                  <label class="text-xs text-space-text-dim w-10">Craft</label>
                  <select v-model="craftRecipe" class="input text-xs flex-1 !p-1">
                    <option value="">{{ recipes.length > 0 ? 'Select recipe...' : 'No recipes' }}</option>
                    <option v-for="r in recipes" :key="r.id" :value="r.id">
                      {{ r.name || r.id }} {{ r.category ? `[${r.category}]` : '' }}
                    </option>
                  </select>
                  <input v-model.number="craftQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
                  <button @click="execCraft" class="btn btn-primary text-xs px-3 py-1">Craft</button>
                </div>

                <!-- Sell -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Sell</label>
                  <select v-model="sellItem" class="input text-xs flex-1 !p-1">
                    <option value="">No items</option>
                    <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                      {{ item.name }} ({{ item.quantity }})
                    </option>
                  </select>
                  <input v-model.number="sellQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
                  <button @click="execSell" class="btn text-xs px-3 py-1">Sell</button>
                </div>

                <!-- Buy -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Buy</label>
                  <select v-model="buyItem" class="input text-xs flex-1 !p-1">
                    <option value="">No market data</option>
                    <option v-for="item in marketItems" :key="item.item_id" :value="item.item_id">
                      {{ item.name }} ({{ item.buy_price }}₡)
                    </option>
                  </select>
                  <input v-model.number="buyQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
                  <button @click="execBuy" class="btn text-xs px-3 py-1">Buy</button>
                </div>

                <!-- Deposit -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Deposit</label>
                  <select v-model="depositItem" class="input text-xs flex-1 !p-1">
                    <option value="">No items</option>
                    <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                      {{ item.name }} ({{ item.quantity }})
                    </option>
                  </select>
                  <input v-model.number="depositQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
                  <button @click="execDeposit" class="btn text-xs px-3 py-1">Deposit</button>
                </div>

                <!-- Withdraw -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Withdraw</label>
                  <select v-model="withdrawItem" class="input text-xs flex-1 !p-1">
                    <option value="">No items</option>
                    <option v-for="item in storage" :key="item.itemId" :value="item.itemId">
                      {{ item.name }} ({{ item.quantity }})
                    </option>
                  </select>
                  <input v-model.number="withdrawQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
                  <button @click="execWithdraw" class="btn text-xs px-3 py-1">Withdraw</button>
                </div>

                <!-- Gift Item -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Gift Item</label>
                  <select v-model="giftTarget" class="input text-xs w-32 !p-1">
                    <option value="">No bots</option>
                    <option v-for="b in otherBots" :key="b.username" :value="b.username">
                      {{ b.username }}
                    </option>
                  </select>
                  <select v-model="giftItem" class="input text-xs flex-1 !p-1">
                    <option value="">No items</option>
                    <option v-for="item in inventory" :key="item.itemId" :value="item.itemId">
                      {{ item.name }} ({{ item.quantity }})
                    </option>
                  </select>
                  <input v-model.number="giftQty" type="number" min="1" class="input text-xs w-16 !p-1 scrollbar-dark" value="1">
                  <button @click="execGiftItem" class="btn text-xs px-3 py-1">Send</button>
                </div>

                <!-- Send Credits -->
                <div class="flex gap-2 items-center">
                  <label class="text-xs text-space-text-dim w-20">Send Credits</label>
                  <select v-model="creditsTarget" class="input text-xs flex-1 !p-1">
                    <option value="">No bots</option>
                    <option v-for="b in otherBots" :key="b.username" :value="b.username">
                      {{ b.username }}
                    </option>
                  </select>
                  <input v-model.number="creditsAmount" type="number" min="1" class="input text-xs w-24 !p-1 scrollbar-dark" value="100">
                  <button @click="execSendCredits" class="btn text-xs px-3 py-1">Send</button>
                </div>

                <!-- Status Commands -->
                <div class="flex gap-2 items-center col-span-2">
                  <label class="text-xs text-space-text-dim w-20"></label>
                  <button @click="execCommand('get_status')" class="btn text-xs px-2 py-1">🚀 Status</button>
                  <button @click="execCommand('get_cargo')" class="btn text-xs px-2 py-1">📦 Cargo</button>
                  <button @click="execCommand('view_storage')" class="btn text-xs px-2 py-1">🏠 Storage</button>
                  <button @click="execCommand('view_market')" class="btn text-xs px-2 py-1">💰 Market</button>
                  <button @click="execCommand('get_system')" class="btn text-xs px-2 py-1">🌌 System</button>
                  <button @click="execCommand('get_nearby')" class="btn text-xs px-2 py-1">🌌 Nearby</button>
                </div>

                <!-- Custom Command -->
                <div class="flex gap-2 items-center col-span-2">
                  <label class="text-xs text-space-text-dim w-20">Custom</label>
                  <input v-model="customCmd" type="text" placeholder="command" class="input text-xs w-32 !p-1">
                  <input v-model="customParams" type="text" placeholder='{"key":"val"}' class="input text-xs flex-1 !p-1">
                  <button @click="execCustom" class="btn btn-primary text-xs px-3 py-1">Run</button>
                </div>

              </div>
            </div>
          </div>

          <!-- Activity Log -->
          <div class="card  py-2 px-3 flex flex-col h-56">
            <div class="flex py-1 px-0 items-center justify-between border-b border-space-border bg-space-card">
              <h3 class="text-xs font-semibold text-space-text-dim uppercase">Activity Log</h3>
              <div class="flex gap-2">
                <button @click="loadFullLog" class="btn btn-secondary text-xs py-0 px-2">Full Log</button>
                <button @click="clearLog" class="btn btn-secondary text-xs py-0 px-2">Clear</button>
              </div>
            </div>
            <div class="flex-1 overflow-auto scrollbar-dark font-mono text-xs space-y-0.5 py-1">
              <div 
                v-for="(log, idx) in botLogs.reverse()" 
                :key="idx"
                class="leading-tight whitespace-pre-wrap text-[10px]"
                :class="{
                  'text-space-red': log.type === 'error',
                  'text-space-yellow': log.type === 'warn',
                  'text-space-green': log.type === 'success',
                  'text-space-text-dim': log.type === 'info'
                }"
              >
                {{ log.message }}
              </div>
              <div v-if="botLogs.length === 0" class="text-space-text-dim">No activity yet</div>
            </div>
          </div>
          </div><!-- /control tab -->

          <!-- Ship tab -->
          <div v-show="activeMainTab === 'ship'" class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
            <div v-if="!currentBot.docked" class="flex items-center justify-center h-32 text-center">
              <div><div class="text-3xl mb-2">🚀</div><div class="text-space-text-dim text-sm">Dock at a station to manage ship modules</div></div>
            </div>
            <template v-else>
              <!-- Ship Stats + Modules side by side -->
              <div class="flex gap-2 items-start">
              <!-- Ship Stats -->
              <div class="card py-2 px-3 flex-1 min-w-0">
                <div class="flex items-center justify-between border-b border-space-border pb-1 mb-2">
                  <h3 class="text-xs font-semibold text-space-text-dim uppercase">🛸 Ship</h3>
                  <button @click="loadShipData()" :disabled="shipActionLoading" class="btn btn-secondary text-xs py-0 px-2">🔄</button>
                </div>
                <div v-if="!shipInfo" class="text-center py-3">
                  <button @click="loadShipData()" class="btn btn-primary text-xs px-4">Load</button>
                </div>
                <div v-else class="space-y-1.5 text-xs">
                  <div>
                    <div class="flex justify-between mb-0.5"><span class="text-space-text-dim">🖥️ CPU</span><span class="text-space-text">{{ shipInfo.cpu_used ?? 0 }} / {{ shipInfo.cpu_capacity ?? 0 }}</span></div>
                    <div class="w-full bg-[#21262d] rounded-full h-1.5"><div class="h-full bg-green-500 rounded-full" :style="{ width: shipCpuPercent + '%' }"></div></div>
                  </div>
                  <div>
                    <div class="flex justify-between mb-0.5"><span class="text-space-text-dim">⚡ Power</span><span class="text-space-text">{{ shipInfo.power_used ?? 0 }} / {{ shipInfo.power_capacity ?? 0 }}</span></div>
                    <div class="w-full bg-[#21262d] rounded-full h-1.5"><div class="h-full bg-yellow-500 rounded-full" :style="{ width: shipPowerPercent + '%' }"></div></div>
                  </div>
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] pt-0.5">
                    <span class="text-space-text-dim">⚔️ Weapons: <span class="text-space-text">{{ shipInfo.weapon_slots ?? '?' }}</span></span>
                    <span class="text-space-text-dim">🛡️ Defense: <span class="text-space-text">{{ shipInfo.defense_slots ?? '?' }}</span></span>
                    <span class="text-space-text-dim">🔧 Utility: <span class="text-space-text">{{ shipInfo.utility_slots ?? '?' }}</span></span>
                  </div>
                  <!-- Extra ship stats -->
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] pt-0.5 border-t border-[#21262d]">
                    <span v-if="shipInfo.armor != null" class="text-space-text-dim">🛡️ Armor: <span class="text-space-text">{{ shipInfo.armor }}</span></span>
                    <span v-if="shipInfo.shield_recharge != null" class="text-space-text-dim">🔋 Shield: <span class="text-space-text">{{ shipInfo.shield_recharge }}/tick</span></span>
                    <span v-if="shipInfo.speed != null" class="text-space-text-dim">💨 Speed: <span class="text-space-text">{{ shipInfo.speed }} AU/tick</span></span>
                  </div>
                  <!-- Class with tooltip trigger -->
                  <div v-if="shipInfo.class_id" @mouseenter="onShipClassHover($event)" @mouseleave="shipTooltipVisible = false">
                    <span class="text-space-text-dim text-[11px] cursor-help">🚀 Class: <span class="text-space-accent underline decoration-dotted">{{ shipInfo.class_id }}</span></span>
                  </div>
                </div>
              </div>

              <!-- Installed Modules -->
              <div class="card py-2 px-3 flex-1 min-w-0">
                <h3 class="text-xs font-semibold text-space-text-dim uppercase border-b border-space-border pb-1 mb-2">⚙️ Installed Modules</h3>
                <div v-if="installedModules.length === 0" class="text-xs text-space-text-dim text-center py-2">{{ shipInfo ? 'No modules installed' : 'Load ship data first' }}</div>
                <div v-else class="space-y-1.5 max-h-56 overflow-auto scrollbar-dark">
                  <div v-for="mod in installedModules" :key="mod.module_id || mod.id || mod.name" class="bg-[#21262d] rounded p-1.5">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="text-sm">{{ moduleTypeIcon(mod.type || mod.slot_type) }}</span>
                          <span class="text-xs text-space-text-bright truncate">{{ mod.name || mod.module_id || mod.id }}</span>
                        </div>
                        <!-- Module stats grid -->
                        <div class="flex flex-wrap gap-x-2.5 gap-y-0 mt-1 text-[10px]">
                          <span v-if="mod.quality_grade" class="text-yellow-400">⭐ {{ mod.quality_grade }}</span>
                          <span v-if="mod.wear_status" :class="wearColor(mod.wear)">{{ mod.wear_status }}{{ mod.wear > 0 ? ` (${mod.wear}%)` : '' }}</span>
                          <span v-if="mod.cpu_usage != null" class="text-green-400">CPU: {{ mod.cpu_usage }}</span>
                          <span v-if="mod.power_usage != null" class="text-yellow-400">PWR: {{ mod.power_usage }}</span>
                          <span v-if="mod.mining_power != null" class="text-amber-400">⛏️ {{ mod.mining_power }} pwr</span>
                          <span v-if="mod.mining_range != null" class="text-amber-400">📡 {{ mod.mining_range }} rng</span>
                          <span v-if="mod.damage != null" class="text-red-400">💥 {{ mod.damage }} dmg</span>
                          <span v-if="mod.shield_bonus != null" class="text-blue-400">🛡️ +{{ mod.shield_bonus }}</span>
                          <span v-if="mod.armor_bonus != null" class="text-slate-400">🔩 +{{ mod.armor_bonus }}</span>
                          <span v-if="mod.ammo_type" class="text-orange-400">🎯 {{ mod.ammo_type }}</span>
                        </div>
                      </div>
                      <button @click="uninstallModule(mod.module_id || mod.id)" :disabled="shipActionLoading" class="ml-1 text-xs px-2 py-0.5 bg-red-600/40 hover:bg-red-600 rounded transition-colors disabled:opacity-50 shrink-0">Remove</button>
                    </div>
                  </div>
                </div>
              </div>
              </div><!-- /side-by-side row -->

              <!-- Install from Cargo -->
              <div class="card py-2 px-3">
                <h3 class="text-xs font-semibold text-space-text-dim uppercase border-b border-space-border pb-1 mb-2">📦 Install from Cargo</h3>
                <div v-if="inventory.length === 0" class="text-xs text-space-text-dim text-center py-2">Cargo is empty</div>
                <div v-else class="space-y-1 max-h-36 overflow-auto scrollbar-dark">
                  <div v-for="item in inventory" :key="item.itemId" class="flex items-center justify-between bg-[#21262d] rounded p-1.5">
                    <div class="min-w-0 flex-1"><div class="text-xs text-space-text-bright truncate">{{ item.name }}</div><div class="text-[10px] text-space-text-dim">x{{ item.quantity }}</div></div>
                    <button @click="installModule(item.itemId)" :disabled="shipActionLoading" class="ml-2 text-xs px-2 py-0.5 bg-green-600/40 hover:bg-green-600 rounded transition-colors disabled:opacity-50 shrink-0">Install</button>
                  </div>
                </div>
              </div>

              <!-- Buy from Market -->
              <div class="card py-2 px-3">
                <div class="flex items-center justify-between border-b border-space-border pb-1 mb-2">
                  <h3 class="text-xs font-semibold text-space-text-dim uppercase">🛒 Station Shop</h3>
                  <div class="flex gap-1.5 items-center">
                    <select v-model="shopFilter" class="input text-[11px] py-0 h-6">
                      <option value="all">All items</option>
                      <option value="module">Modules</option>
                      <option value="consumable">Consumables</option>
                      <option value="component">Components</option>
                      <option value="ore">Ores</option>
                      <option value="refined">Refined</option>
                      <option value="">Others</option>
                    </select>
                    <button @click="execCommand('view_market')" :disabled="shipActionLoading" class="btn btn-secondary text-xs py-0 px-2">🔄</button>
                  </div>
                </div>
                <div v-if="filteredShopItems.length === 0" class="text-xs text-space-text-dim text-center py-2">No items. Click 🔄 to load market.</div>
                <div v-else class="space-y-1 max-h-72 overflow-auto scrollbar-dark">
                  <div
                    v-for="item in filteredShopItems"
                    :key="item.item_id"
                    class="rounded p-1.5"
                    :class="item.sell_quantity > 0 ? 'bg-[#1a2535] border border-blue-900/40' : 'bg-[#21262d]'"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="text-sm flex-shrink-0">{{ shopCatIcon(item.category) }}</span>
                          <span class="text-xs text-space-text-bright truncate">{{ item.item_name || item.name }}</span>
                        </div>
                        <div class="flex flex-wrap gap-x-2.5 gap-y-0 mt-0.5 text-[10px] text-space-text-dim">
                          <span v-if="item.sell_quantity > 0" class="text-green-400">📦 {{ item.sell_quantity.toLocaleString() }} in stock</span>
                          <span v-if="item.buy_quantity > 0" class="text-blue-400">🏷️ Station buys: {{ item.buy_price?.toLocaleString() }}₡ ×{{ item.buy_quantity.toLocaleString() }}</span>
                          <span v-if="item.spread > 0" class="text-purple-400">📈 Spread: {{ item.spread.toLocaleString() }}₡</span>
                        </div>
                      </div>
                      <div class="flex flex-col items-end gap-1 shrink-0">
                        <div v-if="item.sell_price > 0" class="flex items-center gap-1">
                          <span class="text-xs text-space-yellow font-semibold">{{ item.sell_price.toLocaleString() }}₡</span>
                          <button @click="buyModuleItem(item.item_id, 1)" :disabled="shipActionLoading" class="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50">Buy</button>
                        </div>
                        <div v-else class="text-[10px] text-space-text-dim italic">no sell orders</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div><!-- /ship tab -->
          <!-- Station tab -->
          <div v-show="activeMainTab === 'station'" class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
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
                    <button @click="facilitySubTab = 'player'" class="px-2 py-0.5 text-xs rounded transition-colors" :class="facilitySubTab === 'player' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">👤 Personal{{ facilities.player.length ? ' ('+facilities.player.length+')' : '' }}</button>
                    <button @click="facilitySubTab = 'faction'" class="px-2 py-0.5 text-xs rounded transition-colors" :class="facilitySubTab === 'faction' ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text'">⚑ Faction</button>
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
                      <div class="font-medium text-space-text">{{ f.name }}</div>
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
                <div v-else-if="facilitySubTab === 'player'" class="space-y-2 max-h-[28rem] overflow-auto scrollbar-dark">
                  <div v-if="!facilities.player.length" class="text-xs text-space-text-dim italic py-4 text-center">No personal facilities — click 🔄 to fetch.</div>
                  <div v-for="f in facilities.player" :key="f.facility_id" class="bg-[#21262d] rounded-md p-2 text-xs">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <div class="font-medium text-space-text">{{ f.name }}</div>
                      <span class="px-1.5 py-0.5 rounded text-[10px] shrink-0" :class="f.active && f.maintenance_satisfied ? 'bg-green-900/30 text-space-green' : !f.active ? 'bg-red-900/30 text-space-red' : 'bg-yellow-900/30 text-yellow-400'">{{ f.active ? (f.maintenance_satisfied ? 'active' : '⚠️ degraded') : 'offline' }}</span>
                    </div>
                    <div class="text-space-text-dim leading-relaxed">{{ f.description }}</div>
                    <div class="flex flex-wrap gap-3 mt-1 text-[10px]">
                      <span v-if="f.rent_per_cycle" class="text-space-yellow">💰 {{ f.rent_per_cycle }} cr/cycle</span>
                      <span v-if="f.bonus_type" class="text-space-cyan">+{{ f.bonus_value }} {{ f.bonus_type.replace(/_/g,' ') }}</span>
                      <span v-if="f.personal_service" class="text-space-accent">{{ f.personal_service.replace(/_/g,' ') }}</span>
                      <span v-if="f.recipe_id" class="text-space-accent">⚗️ {{ f.recipe_id }}</span>
                    </div>
                  </div>
                </div>

                <!-- Faction Facilities -->
                <div v-else-if="facilitySubTab === 'faction'" class="space-y-2 max-h-[28rem] overflow-auto scrollbar-dark">
                  <div v-if="!facilities.faction.length" class="text-xs text-space-text-dim italic py-4 text-center">No faction facilities — click 🔄 to fetch.</div>
                  <div v-for="f in facilities.faction" :key="f.facility_id" class="bg-[#21262d] rounded-md p-2 text-xs">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <div class="font-medium text-space-text">{{ f.name }}</div>
                      <span class="px-1.5 py-0.5 rounded text-[10px] bg-purple-900/30 text-purple-400 shrink-0">faction</span>
                    </div>
                    <div class="text-space-text-dim leading-relaxed">{{ f.description }}</div>
                    <div class="flex flex-wrap gap-3 mt-1 text-[10px]">
                      <span v-if="f.faction_service" class="text-space-cyan">{{ f.faction_service.replace(/_/g,' ') }}</span>
                      <span v-if="f.capacity" class="text-space-text-dim">Cap: {{ f.capacity }}</span>
                    </div>
                  </div>
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
                        <div class="font-medium text-space-text">{{ t.name }}</div>
                        <div class="flex flex-wrap gap-2 mt-0.5 text-[10px]">
                          <span class="text-space-text-dim">Lv{{ t.level }}</span>
                          <span class="text-space-text-dim">{{ t.category }}</span>
                          <span v-if="t.bonus_type" class="text-space-cyan">+{{ t.bonus_value }} {{ t.bonus_type.replace(/_/g,' ') }}</span>
                          <span v-if="t.personal_service" class="text-space-accent">{{ t.personal_service.replace(/_/g,' ') }}</span>
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="text-space-yellow text-[10px] mb-1">{{ t.build_cost?.toLocaleString() }} cr</div>
                        <button v-if="t.buildable !== false" @click="buildFacility(t.id)" :disabled="facilityLoading" class="btn btn-primary text-[10px] px-2 py-0.5">Build</button>
                        <span v-else class="text-[10px] text-space-text-dim italic">not buildable</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div><!-- /station tab -->
        </div><!-- /main content -->
      </div>
  </div>

  <!-- Module install/uninstall notification toast -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2">
      <div v-if="moduleNotif"
        class="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex items-start gap-2.5 px-4 py-3 rounded-lg shadow-2xl border text-sm max-w-sm pointer-events-none"
        :class="moduleNotif.type === 'success'
          ? 'bg-[#0d1117] border-green-500/60 text-green-300'
          : moduleNotif.type === 'warn'
          ? 'bg-[#0d1117] border-orange-500/60 text-orange-300'
          : 'bg-[#0d1117] border-red-500/60 text-red-300'">
        <span class="text-base shrink-0">{{ moduleNotif.type === 'success' ? '✅' : moduleNotif.type === 'warn' ? '📤' : '❌' }}</span>
        <span>{{ moduleNotif.text }}</span>
      </div>
    </Transition>
  </Teleport>

  <!-- Ship class tooltip — teleported to body to escape overflow:auto clipping -->
  <Teleport to="body">
    <div v-if="shipTooltipVisible && shipInfo?.class_id"
      class="fixed z-[9999] w-72 bg-[#0d1117] border border-space-border rounded-lg shadow-2xl overflow-hidden pointer-events-none"
      :style="{ top: shipTooltipPos.y + 'px', left: shipTooltipPos.x + 'px' }">
      <img v-if="shipCatalogEntry" :src="shipImageUrl(shipInfo?.class_id || '')" :alt="shipCatalogEntry.name" class="w-full h-28 object-cover" @error="($event.target as HTMLImageElement).style.display='none'" />
      <div class="p-2.5 space-y-2">
        <div class="flex justify-between items-start">
          <div>
            <div class="text-xs font-semibold text-space-text-bright">{{ shipCatalogEntry?.name || shipInfo?.class_id }}</div>
            <div v-if="shipCatalogEntry" class="text-[10px] text-space-text-dim">{{ shipCatalogEntry.empire_name }} · Tier {{ shipCatalogEntry.tier }} · Scale {{ shipCatalogEntry.scale }}</div>
          </div>
          <div v-if="shipCatalogEntry" class="text-space-yellow text-xs font-semibold shrink-0">{{ shipCatalogEntry.price?.toLocaleString() }} cr</div>
        </div>
        <div v-if="shipCatalogEntry?.description" class="text-[10px] text-space-text-dim leading-relaxed line-clamp-2">{{ shipCatalogEntry.description }}</div>
        <div class="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] pt-1 border-t border-[#21262d]">
          <div class="text-space-text-dim">❤️ Hull <span class="text-space-text">{{ shipCatalogEntry?.base_hull ?? shipInfo?.hull ?? '?' }}</span></div>
          <div class="text-space-text-dim">🔵 Shield <span class="text-space-text">{{ shipCatalogEntry?.base_shield ?? '?' }}</span></div>
          <div class="text-space-text-dim">💨 Speed <span class="text-space-text">{{ shipCatalogEntry?.base_speed ?? shipInfo?.speed ?? '?' }}</span></div>
          <div class="text-space-text-dim">⛽ Fuel <span class="text-space-text">{{ shipCatalogEntry?.base_fuel ?? '?' }}</span></div>
          <div class="text-space-text-dim">📦 Cargo <span class="text-space-text">{{ shipCatalogEntry?.cargo_capacity ?? '?' }}</span></div>
          <div class="text-space-text-dim">🖥️ CPU <span class="text-space-text">{{ shipCatalogEntry?.cpu_capacity ?? '?' }}</span></div>
          <div class="text-space-text-dim">⚔️ <span class="text-space-text">{{ shipCatalogEntry?.weapon_slots ?? shipInfo?.weapon_slots ?? '?' }} wpn</span></div>
          <div class="text-space-text-dim">🛡️ <span class="text-space-text">{{ shipCatalogEntry?.defense_slots ?? shipInfo?.defense_slots ?? '?' }} def</span></div>
          <div class="text-space-text-dim">🔧 <span class="text-space-text">{{ shipCatalogEntry?.utility_slots ?? shipInfo?.utility_slots ?? '?' }} util</span></div>
        </div>
        <div v-if="shipCatalogEntry?.flavor_tags?.length" class="flex flex-wrap gap-1 pt-1 border-t border-[#21262d]">
          <span v-for="tag in shipCatalogEntry.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[10px]">{{ tag }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

interface Props {
  bot: any;
}

const props = defineProps<Props>();
const emit = defineEmits(['close', 'start', 'stop']);

const botStore = useBotStore();

// ── Skill category lookup tables ────────────────────────────────────────────
const SKILL_CATEGORY_MAP: Record<string, string> = {
  // Crafting
  advanced_crafting:'crafting', basic_crafting:'crafting', blueprint_research:'crafting',
  crafting_mastery:'crafting', electronics_crafting:'crafting', mass_production:'crafting',
  module_crafting:'crafting', quality_control:'crafting', shield_crafting:'crafting',
  ship_construction:'crafting', weapon_crafting:'crafting',
  // Drones
  combat_drones:'drones', drone_control:'drones', drone_durability:'drones',
  drone_interfacing:'drones', drone_operation:'drones', mining_drones:'drones',
  repair_drones:'drones', salvage_drones:'drones', drone_sovereign:'prestige',
  // Empire
  crimson_bloodlust:'empire', crimson_fury:'empire', nebula_attunement:'empire',
  nebula_communion:'empire', outer_rim_scavenger:'empire', outer_rim_survival:'empire',
  solarian_discipline:'empire', solarian_doctrine:'empire', voidborn_entropy:'empire',
  voidborn_phase_mastery:'empire',
  // Engineering
  advanced_engineering:'engineering', cpu_management:'engineering', capacitor_systems:'engineering',
  damage_control:'engineering', engineering:'engineering', power_grid_management:'engineering',
  repair_systems:'engineering', rigging:'engineering',
  // Exploration
  anomaly_detection:'exploration', anomaly_exploitation:'exploration', astrometrics:'exploration',
  cartography:'exploration', environmental_hazard_resistance:'exploration', exploration:'exploration',
  first_contact_protocols:'exploration', survey:'exploration', wormhole_navigation:'exploration',
  // Faction
  corporation_management:'faction', faction_warfare:'faction', station_management:'faction',
  // Mining
  mining_basic:'mining', mining_advanced:'mining', advanced_refinement:'mining', biological_processing:'mining',
  deep_core_mining:'mining', gas_harvesting:'mining', gas_processing:'mining',
  ice_mining:'mining', ice_refining:'mining', mining:'mining', ore_refinement:'mining',
  radioactive_handling:'mining',
  // Navigation
  fuel_efficiency:'navigation', jump_calibration:'navigation', jump_drive_operation:'navigation',
  jump_drive:'navigation',navigation:'navigation', warp_efficiency:'navigation',
  // Prestige
  grand_admiral:'prestige', industrial_magnate:'prestige', legendary_pilot:'prestige',
  master_craftsman:'prestige', master_trader:'prestige', pathfinder:'prestige',
  shadow_operative:'prestige', titan_pilot:'prestige', warlord:'prestige',
  // Salvaging
  advanced_salvaging:'salvaging', archaeology:'salvaging', relic_identification:'salvaging',
  salvaging:'salvaging',
  // Ships
  capital_ships:'ships', covert_operations:'ships', fleet_command:'ships',
  industrial_ships:'ships', large_ships:'ships', medium_ships:'ships', small_ships:'ships',
  // Support
  advanced_cloaking:'support', advanced_scanning:'support', alliance_management:'support',
  cloaking:'support', counter_hacking:'support', counter_intelligence:'support',
  diplomacy:'support', espionage:'support', fleet_coordination:'support',
  hacking:'support', leadership:'support', mentoring:'support',
  propaganda:'support', reputation_management:'support', scanning:'support',
  // Trading
  auction_mastery:'trading', black_market_trading:'trading', bulk_trading:'trading',
  contracts:'trading', hauling:'trading', insurance_brokering:'trading',
  loan_management:'trading', negotiation:'trading', rare_goods_expertise:'trading',
  smuggling:'trading', trading:'trading',
};
const CATEGORY_ICON: Record<string, string> = {
  crafting:'🔨', drones:'🤖', empire:'⚜️', engineering:'🔧', exploration:'🔭',
  faction:'⚑', mining:'⛏️', navigation:'🧭', prestige:'👑', salvaging:'♻️',
  ships:'🚀', support:'🕵️', trading:'💰',
};
const CATEGORY_COLOR: Record<string, string> = {
  crafting:'text-orange-400', drones:'text-teal-400', empire:'text-yellow-500',
  engineering:'text-slate-400', exploration:'text-cyan-400', faction:'text-purple-400',
  mining:'text-amber-400', navigation:'text-sky-400', prestige:'text-yellow-400',
  salvaging:'text-green-400', ships:'text-blue-400', support:'text-gray-400',
  trading:'text-lime-400',
};
const CATEGORY_BAR_COLOR: Record<string, string> = {
  crafting:'bg-orange-400', drones:'bg-teal-400', empire:'bg-yellow-500',
  engineering:'bg-slate-400', exploration:'bg-cyan-400', faction:'bg-purple-400',
  mining:'bg-amber-400', navigation:'bg-sky-400', prestige:'bg-yellow-400',
  salvaging:'bg-green-400', ships:'bg-blue-400', support:'bg-gray-400',
  trading:'bg-lime-400',
};
const CATEGORY_ORDER = ['mining','ships','navigation','engineering','crafting','trading',
  'exploration','drones','support','salvaging','faction','empire','prestige'];

// Manual Control state
const travelPoi = ref('');
const destSystem = ref('');
const ldRoute = ref<any[]>([]);
const ldRouteError = ref('');
const ldLoading = ref(false);
const ldRelocating = ref(false);
const ldProgress = ref(0);
let ldTimer: ReturnType<typeof setTimeout> | null = null;
const craftRecipe = ref('');
const craftQty = ref(1);
const sellItem = ref('');
const sellQty = ref(1);
const buyItem = ref('');
const buyQty = ref(1);
const depositItem = ref('');
const depositQty = ref(1);
const withdrawItem = ref('');
const withdrawQty = ref(1);
const giftTarget = ref('');
const giftItem = ref('');
const giftQty = ref(1);
const creditsTarget = ref('');
const creditsAmount = ref(100);
const customCmd = ref('');
const customParams = ref('');

// Profile data
const systemPois = ref<any[]>([]);
const marketItems = ref<any[]>([]);
const skills = ref<any[]>([]);
const recipes = ref<any[]>([]);
const depositPrimary = ref('station_storage');
const depositSecondary = ref('station_storage');

// Ship tab state
const activeMainTab = ref<'control' | 'ship' | 'station'>('control');
const shipInfo = ref<any>(null);
const shipActionLoading = ref(false);
const shopFilter = ref('all');

// Station tab state
const facilitySubTab = ref<'station' | 'player' | 'faction' | 'build'>('station');
const facilityLoading = ref(false);
const facilities = ref<{ station: any[]; player: any[]; faction: any[] }>({ station: [], player: [], faction: [] });
const buildableTypes = ref<any[]>([]);
const buildableLoading = ref(false);
const buildCategoryFilter = ref('');

const stationInfo = computed(() => {
  const bot = currentBot.value;
  if (!bot || !botStore.publicStations.length) return null;
  const poi = (bot as any).poi || '';
  const sys = (bot as any).system || (bot as any).location || '';
  return botStore.publicStations.find((st: any) =>
    st.id === poi || st.system_id === sys
  ) || null;
});

const installedModules = computed(() => {
  if (!shipInfo.value) return [];
  const mods = shipInfo.value.modules || shipInfo.value.installed_modules || [];
  if (Array.isArray(mods)) return mods;
  return Object.values(mods as Record<string, unknown>);
});

const weaponModules = computed(() =>
  (installedModules.value as any[]).filter(
    (m: any) => m.ammo_type || m.slot_type === 'weapon' || (m.damage != null && m.damage > 0)
  )
);

const filteredShopItems = computed(() => {
  if (!marketItems.value.length) return [];
  const items = shopFilter.value === 'all'
    ? [...marketItems.value]
    : marketItems.value.filter((item: any) =>
        (item.category || '').toLowerCase() === shopFilter.value
      );
  return items.sort((a: any, b: any) => {
    const aStock = (a.sell_quantity || 0) > 0 ? 1 : 0;
    const bStock = (b.sell_quantity || 0) > 0 ? 1 : 0;
    if (aStock !== bStock) return bStock - aStock;
    return (b.sell_price || 0) - (a.sell_price || 0);
  });
});

const shipCpuPercent = computed(() => {
  if (!shipInfo.value) return 0;
  const cap = shipInfo.value.cpu_capacity || 1;
  return Math.min(100, Math.round(((shipInfo.value.cpu_used ?? 0) / cap) * 100));
});

const shipPowerPercent = computed(() => {
  if (!shipInfo.value) return 0;
  const cap = shipInfo.value.power_capacity || 1;
  return Math.min(100, Math.round(((shipInfo.value.power_used ?? 0) / cap) * 100));
});

// Get current bot from store (reactive!)
const currentBot = computed(() => {
  const bot = botStore.bots.find(b => b.username === props.bot.username);
  return bot || props.bot; // Fallback to props if not found
});

const inventory = computed(() => {
  // console.log('Bot inventory:', currentBot.value.inventory);
  return currentBot.value.inventory || [];
});
const storage = computed(() => {
  // console.log('Bot storage:', currentBot.value.storage);
  return currentBot.value.storage || [];
});
const displaySkills = computed(() => {
  // console.log('Bot skills from store:', skills.value);
  // console.log('Bot skills from currentBot:', currentBot.value.skills);
  // Local fetch (get_skills) has full xp data — prefer it when available
  if (skills.value.length > 0) return skills.value;
  if (currentBot.value.skills && currentBot.value.skills.length > 0) return currentBot.value.skills;
  // Fall back to WS-state skills (may lack xp)
  return (currentBot.value as any).skills || [];
});

const groupedSkills = computed(() => {
  const groups: Record<string, any[]> = {};
  for (const sk of displaySkills.value) {
    const id = sk.skill_id || '';
    const cat = SKILL_CATEGORY_MAP[id] || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(sk);
  }
  const ordered: [string, any[]][] = [];
  for (const cat of CATEGORY_ORDER) {
    if (groups[cat]) ordered.push([cat, groups[cat]]);
  }
  for (const [cat, sks] of Object.entries(groups)) {
    if (!CATEGORY_ORDER.includes(cat)) ordered.push([cat, sks]);
  }
  return ordered;
});

function skillXpNext(skill: any): number {
  return skill.xp_to_next ?? skill.next_level_xp ?? 0;
}
function skillPct(skill: any): number {
  const next = skillXpNext(skill);
  if (!next || next <= 0) return 0;
  return Math.min(100, Math.round(((skill.xp || 0) / next) * 100));
}
const knownSystems = computed(() => {
  const systems: any[] = [];
  for (const [id, sys] of Object.entries(botStore.mapData)) {
    if (id !== currentBot.value.system) {
      systems.push({ id, name: (sys as any).name || id });
    }
  }
  return systems;
});

const otherBots = computed(() => {
  return botStore.bots.filter(b => b.username !== currentBot.value.username);
});

const botLogs = computed(() => {
  return botStore.logs.filter(log => log.bot === currentBot.value.username).slice(-100);
});

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatLocation(bot: any): string {
  if (bot.poi) {
    const system = botStore.mapData[bot.system];
    if (system) {
      const poi = (system as any).pois?.find((p: any) => p.id === bot.poi);
      const sysName = (system as any).name || bot.system;
      const poiName = poi?.name || bot.poi;
      return `${poiName} (${sysName})`;
    }
    return `${bot.poi} (${bot.system})`;
  }
  return bot.location || bot.system || '-';
}

function execCommand(command: string, params?: any) {
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  
  botStore.logs.push({
    bot: username,
    type: 'info',
    message: `Executing: ${command}${params ? ' ' + JSON.stringify(params) : ''}`,
  });
  
  botStore.sendExec(username, command, params, (result: any) => {
    if (result.ok) {
      botStore.logs.push({ bot: username, type: 'success', message: `${command}: OK` });
      // Process specific command results
      processExecResult(command, result.data, username);
    } else {
      const errMsg = result.error || 'Unknown error';
      botStore.logs.push({ bot: username, type: 'error', message: `${command}: ${errMsg}` });
      showModuleNotif(errMsg, 'error');
    }
  });
}

function processExecResult(command: string, data: any, username: string) {
  if (!data) return;
  
  switch (command) {
    case 'get_skills': {
      const normalizeSkill = (raw: any, key?: string): any => {
        const skill_id = raw.skill_id || raw.id || key || raw.name || '';
        return {
          skill_id,
          level: raw.level ?? raw.skill_level ?? 0,
          xp: raw.xp ?? raw.current_xp,
          xp_to_next: raw.xp_to_next ?? raw.next_level_xp ?? raw.xp_required,
        };
      };
      let raw = data.skills || data.player_skills || data;
      if (Array.isArray(raw)) {
        skills.value = raw.map((s: any) => normalizeSkill(s));
      } else if (raw && typeof raw === 'object') {
        skills.value = Object.entries(raw).map(([key, val]: [string, any]) =>
          typeof val === 'object' && val ? normalizeSkill(val, key) : normalizeSkill({ level: val }, key)
        );
      }
      break;
    }
    case 'view_market': {
      const items = data.market || data.items || data.listings || (Array.isArray(data) ? data : []);
      marketItems.value = items;
      break;
    }
    case 'get_status': {
      if (data.ship) {
        shipInfo.value = { ...data.ship, modules: data.modules || [] };
      }
      shipActionLoading.value = false;
      break;
    }
    case 'install_mod':
    case 'uninstall_mod': {
      shipActionLoading.value = false;
      if (data?.message) showModuleNotif(data.message, command === 'install_mod' ? 'success' : 'warn');
      loadShipData();
      break;
    }
    case 'facility': {
      if (data?.station_facilities !== undefined || data?.player_facilities !== undefined) {
        facilities.value = {
          station: data.station_facilities || [],
          player: data.player_facilities || [],
          faction: data.faction_facilities || [],
        };
        facilityLoading.value = false;
      } else if (data?.types !== undefined) {
        buildableTypes.value = [...buildableTypes.value, ...(data.types || [])];
        buildableLoading.value = false;
        if ((data.page || 1) < (data.total_pages || 1) && data.types.length > 0) {
          const nextParams: any = { action: 'types', page: (data.page || 1) + 1 };
          if (buildCategoryFilter.value) nextParams.category = buildCategoryFilter.value;
          execCommand('facility', nextParams);
        }
      }
      break;
    }
    case 'get_system': {
      const pois = data.pois || data.points_of_interest || [];
      if (pois.length > 0) systemPois.value = pois;
      break;
    }
    case 'catalog': {
      const items = data.items || data.recipes || (Array.isArray(data) ? data : []);
      if (params_lastCatalogType === 'recipes') {
        const pageItems = extractRecipes(data);
        recipes.value = [...recipes.value, ...pageItems];
        const totalPages = data.total_pages || 1;
        const currentPage = data.page || 1;
        if (currentPage < totalPages && pageItems.length > 0) {
          execCommand('catalog', { type: 'recipes', page: currentPage + 1, page_size: 50 });
        }
      }
      break;
    }
  }
}

let params_lastCatalogType = '';

function extractRecipes(data: any): any[] {
  const items = data.items || data.recipes || (Array.isArray(data) ? data : []);
  return items.map((r: any) => ({
    id: r.recipe_id || r.id || r.item_id,
    name: r.name || r.recipe_name || r.recipe_id || r.id,
    category: r.category || '',
  }));
}

async function execTravel() {
  if (!travelPoi.value) return;
  await execCommand('travel', { target_poi: travelPoi.value });
}

// ── Long Distance Travel ──────────────────────────────────────

function execAsync(command: string, params?: any): Promise<any> {
  return new Promise((resolve) => {
    const username = currentBot.value?.username;
    if (!username) return resolve({ ok: false, error: 'No bot selected' });
    botStore.sendExec(username, command, params, (result: any) => resolve(result));
  });
}

async function findRouteLD() {
  if (!destSystem.value) return;
  ldLoading.value = true;
  ldRouteError.value = '';
  ldRoute.value = [];

  const searchRes = await execAsync('search_systems', { query: destSystem.value });
  const systems = searchRes.data?.systems || searchRes.data || [];
  if (!systems.length) {
    ldRouteError.value = `System "${destSystem.value}" not found`;
    ldLoading.value = false;
    return;
  }

  const targetId = systems[0].system_id || systems[0].id || systems[0].name;
  const routeRes = await execAsync('find_route', { target_system: targetId });
  const route = routeRes.data?.route || routeRes.data || [];
  if (!route.length) {
    ldRouteError.value = routeRes.error?.message || 'No route found';
    ldLoading.value = false;
    return;
  }

  ldRoute.value = route.slice(1); // skip current system
  ldProgress.value = 0;
  ldLoading.value = false;
}

async function ldUndockAndStart() {
  await execAsync('undock');
  await new Promise(r => setTimeout(r, 1500));
  ldStartRelocation();
}

function ldStartRelocation() {
  if (!ldRoute.value.length) return;
  ldRelocating.value = true;
  ldProgress.value = 0;
  ldDoRelocationStep();
}

function ldStopRelocation() {
  ldRelocating.value = false;
  if (ldTimer) { clearTimeout(ldTimer); ldTimer = null; }
}

async function ldDoRelocationStep() {
  if (!ldRelocating.value) return;
  const route = ldRoute.value;
  if (ldProgress.value >= route.length) {
    ldRelocating.value = false;
    return;
  }
  const next = route[ldProgress.value];
  const systemId = next.system_id || next.id || next;
  const res = await execAsync('jump', { target_system: systemId });
  if (!res.ok && !ldRelocating.value) return;
  ldProgress.value++;
  if (ldProgress.value < route.length && ldRelocating.value) {
    ldTimer = setTimeout(() => ldDoRelocationStep(), 12000);
  } else {
    ldRelocating.value = false;
  }
}

async function execCraft() {
  if (!craftRecipe.value) return;
  await execCommand('craft', { recipe_id: craftRecipe.value, count: craftQty.value });
}

async function execSell() {
  if (!sellItem.value) return;
  await execCommand('sell', { item_id: sellItem.value, quantity: sellQty.value });
}

async function execBuy() {
  if (!buyItem.value) return;
  await execCommand('buy', { item_id: buyItem.value, quantity: buyQty.value });
}

async function execDeposit() {
  if (!depositItem.value) return;
  await execCommand('deposit_items', { item_id: depositItem.value, quantity: depositQty.value });
}

async function execWithdraw() {
  if (!withdrawItem.value) return;
  await execCommand('withdraw_items', { item_id: withdrawItem.value, quantity: withdrawQty.value });
}

async function execGiftItem() {
  if (!giftTarget.value || !giftItem.value) return;
  await execCommand('send_gift', { recipient: giftTarget.value, item_id: giftItem.value, quantity: giftQty.value });
}

async function execSendCredits() {
  if (!creditsTarget.value) return;
  await execCommand('send_gift', { recipient: creditsTarget.value, credits: creditsAmount.value });
}

async function execCustom() {
  if (!customCmd.value) return;
  let params = undefined;
  if (customParams.value.trim()) {
    try {
      params = JSON.parse(customParams.value);
    } catch (err) {
      alert('Invalid JSON parameters');
      return;
    }
  }
  await execCommand(customCmd.value, params);
}

function clearLog() {
  botStore.logs = botStore.logs.filter(log => log.bot !== currentBot.value.username);
}

function loadFullLog() {
  console.log('Load full log - TODO: implement pagination');
}

function fetchSkills() {
  execCommand('get_skills');
}

function fetchRecipes() {
  recipes.value = [];
  params_lastCatalogType = 'recipes';
  execCommand('catalog', { type: 'recipes', page: 1, page_size: 50 });
}

function loadShipData() {
  shipActionLoading.value = true;
  execCommand('get_status');
}

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
  execCommand('facility', { action: 'build', facility_type: typeId });
}

function loadStationTab() {
  activeMainTab.value = 'station';
  if (!facilities.value.station.length) loadFacilities();
}

function installModule(moduleId: string) {
  if (!moduleId || shipActionLoading.value) return;
  shipActionLoading.value = true;
  execCommand('install_mod', { module_id: moduleId });
}

function uninstallModule(moduleId: string) {
  if (!moduleId || shipActionLoading.value) return;
  shipActionLoading.value = true;
  execCommand('uninstall_mod', { module_id: moduleId });
}

function buyModuleItem(itemId: string, quantity: number) {
  if (!itemId || shipActionLoading.value) return;
  execCommand('buy', { item_id: itemId, quantity });
}

onMounted(() => {
  // Fetch full bot status
  execCommand('get_status');
  execCommand('get_cargo');
  fetchSkills();

  // Fetch system data
  if (currentBot.value.system) {
    execCommand('get_system');
  }
  
  // Fetch market data and ship data if docked
  if (currentBot.value.docked) {
    execCommand('view_market');
    execCommand('view_storage');
    loadShipData();
  }
  
  fetchRecipes();
  
  // Extract POIs from current system mapData
  const currentSystem = botStore.mapData[currentBot.value.system];
  if (currentSystem) {
    systemPois.value = (currentSystem as any).pois || [];
  }
});

function formatSkillName(skillId: string | undefined): string {
  if (!skillId) return '?';
  return skillId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSkillCategory(skillId: string | undefined): string {
  if (!skillId) return 'other';
  return SKILL_CATEGORY_MAP[skillId] || 'other';
}

const shipTooltipVisible = ref(false);
const shipTooltipPos = ref({ x: 0, y: 0 });

const moduleNotif = ref<{ text: string; type: 'success' | 'warn' | 'error' } | null>(null);
let moduleNotifTimer: ReturnType<typeof setTimeout> | null = null;

function showModuleNotif(text: string, type: 'success' | 'warn' | 'error' = 'success') {
  if (moduleNotifTimer) clearTimeout(moduleNotifTimer);
  moduleNotif.value = { text, type };
  moduleNotifTimer = setTimeout(() => { moduleNotif.value = null; }, 5000);
}

function onShipClassHover(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  shipTooltipPos.value = {
    x: Math.min(rect.left, window.innerWidth - 300),
    y: rect.bottom + 6,
  };
  shipTooltipVisible.value = true;
}

const shipCatalogEntry = computed(() => {
  const id = shipInfo.value?.class_id;
  if (!id) return null;
  if (!botStore.publicShips?.length) return null;
  return botStore.publicShips.find(
    (s: any) => s.id === id || s.class === id || s.ship_class === id
  ) || null;
});

function shipImageUrl(classId: string): string {
  return `https://www.spacemolt.com/_next/image?url=%2Fimages%2Fships%2Fcatalog%2F${encodeURIComponent(classId)}.webp&w=640&q=75`;
}

function moduleTypeIcon(type: string): string {
  switch ((type || '').toLowerCase()) {
    case 'mining':    return '⛏️';
    case 'defense':   return '🛡️';
    case 'weapon':    return '⚔️';
    case 'utility':   return '🔧';
    case 'engine':    return '🚀';
    default:          return '📦';
  }
}

function wearColor(wear: number): string {
  if (!wear || wear <= 0) return 'text-green-400';
  if (wear < 30) return 'text-yellow-400';
  if (wear < 70) return 'text-orange-400';
  return 'text-red-400';
}

function shopCatIcon(category: string): string {
  switch ((category || '').toLowerCase()) {
    case 'module':      return '🔫';
    case 'consumable':  return '💊';
    case 'component':   return '🔩';
    case 'ore':         return '⛏️';
    case 'refined':     return '🔨';
    default:            return '📦';
  }
}

function getSkillIcon(skillId: string | undefined): string {
  const cat = getSkillCategory(skillId);
  return CATEGORY_ICON[cat] || '📚';
}

function getSkillColor(skillId: string | undefined): string {
  const cat = getSkillCategory(skillId);
  return CATEGORY_COLOR[cat] || 'text-gray-400';
}
</script>
