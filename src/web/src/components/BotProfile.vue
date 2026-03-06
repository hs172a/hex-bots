<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Header -->
    <div class="flex flex-col px-3 py-2 border-b border-space-border bg-space-card gap-1.5">
      <!-- Row 1: navigation + identity + state controls -->
      <div class="flex items-center gap-3">
        <button @click="$emit('close')" class="text-space-text-dim hover:text-space-text-bright transition-colors text-sm shrink-0">← Back</button>
        <span v-if="currentBot.empire" :title="empireName(currentBot.empire)" class="text-base shrink-0 leading-none">{{ empireIcon(currentBot.empire) }}</span>
        <h2 class="text-base font-semibold text-space-text-bright">{{ currentBot.username }}</h2>
        <!-- Ship name with tooltip -->
        <span v-if="headerShipClassId"
          @mouseenter="onShipNameHover($event)"
          @mouseleave="shipTooltipVisible = false"
          class="flex items-center gap-1 cursor-help group shrink-0 text-xs"
        >
          <span class="text-space-text-dim">🚀</span>
          <span class="text-space-text group-hover:text-space-accent underline decoration-dotted decoration-space-text-dim/50 transition-colors font-medium">
            {{ currentBot.shipName || headerShipClassId }}
          </span>
          <span class="text-[11px] text-space-text-dim">({{ headerShipClassId }})</span>
        </span>
        <span v-else class="text-space-text-dim shrink-0">🚀 {{ currentBot.shipName || 'Unknown Ship' }}</span>
        <div class="flex-1"></div>
        <span class="badge" :class="{ 'badge-green': currentBot.state === 'running', 'badge-yellow': currentBot.state === 'idle' || currentBot.state === 'stopped', 'badge-red': currentBot.state === 'error' }">{{ currentBot.state }}</span>
        <div class="flex gap-1.5 shrink-0">
          <button v-if="currentBot.state === 'running'" @click="$emit('stop')" class="btn-danger text-xs px-3 py-1">Stop Bot</button>
          <button v-if="currentBot.state === 'idle' || currentBot.state === 'stopped'" @click="$emit('start')" class="btn btn-primary text-xs py-1 px-2">Start Bot</button>
        </div>
      </div>
      <!-- Row 2: ship, location, status pills -->
      <div class="flex items-center gap-2 flex-wrap text-xs">
        <!-- System / POI -->
        <span v-if="currentBot.system" class="flex items-center gap-1 text-[11px] text-space-text-dim shrink-0">
          <span class="opacity-75">|</span>
          <span>📍</span>
          <span class="text-space-text">{{ headerSystemName }}</span>
          <span v-if="headerPoiName" class="opacity-60">/ {{ headerPoiName }}</span>
        </span>
        <span class="opacity-75">·</span>
        <!-- Docked status -->
        <span class="text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0"
          :class="currentBot.docked ? 'bg-green-900/30 text-space-green' : 'bg-[#21262d] text-space-text-dim'">
          {{ currentBot.docked ? '🔒 Docked' : '🚀 In Space' }}
        </span>
        <span class="opacity-75">·</span>
        <!-- Routine -->
        <span class="text-[11px] px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim shrink-0">
          ⚙️ {{ currentBot.routine ? currentBot.routine : 'stopped' }}
        </span>
        <span class="opacity-75">·</span>
        <!-- Faction -->
        <span v-if="currentBot.factionId" class="text-[11px] px-1.5 py-0.5 rounded bg-purple-900/20 text-purple-300 shrink-0">
          🛡️ {{ currentBot.factionId }}
        </span>
        <!-- Row 3: lifetime statistics (compact pills) -->
        <span v-if="currentBot.playerStats">
          <span class="opacity-75">|</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-green-400">💰</span><span class="px-1">₡{{ formatNumber(currentBot.playerStats.creditsEarned ?? 0) }}</span><span class="px-1 opacity-60">earned</span></span>
          <span class="opacity-75">·</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-amber-400">⛏️</span><span class="px-1">{{ formatNumber(currentBot.playerStats.oreMined ?? 0) }}</span><span class="px-1 opacity-60">mined</span></span>
          <span class="opacity-75">·</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-blue-400">🔄</span><span class="px-1">{{ currentBot.playerStats.tradesCompleted ?? 0 }}</span><span class="px-1 opacity-60">trades</span></span>
          <span class="opacity-75">·</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-purple-400">🗺️</span><span class="px-1">{{ currentBot.playerStats.systemsExplored ?? 0 }}</span><span class="px-1 opacity-60">explored</span></span>
          <span class="opacity-75">·</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-cyan-400">🏴‍☠️</span><span class="px-1">{{ currentBot.playerStats.piratesDestroyed ?? 0 }}</span><span class="px-1 opacity-60">pirates</span></span>
          <span class="opacity-75">·</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-red-400">💥</span><span class="px-1">{{ currentBot.playerStats.shipsDestroyed ?? 0 }}</span><span class="px-1 opacity-60">kills</span></span>
          <span class="opacity-75">·</span>
          <span class="text-[11px] px-1.5 py-0.5"><span class="text-gray-400">💀</span><span class="px-1">{{ currentBot.playerStats.shipsLost ?? 0 }}</span><span class="px-1 opacity-60">deaths</span></span>
        </span>
        <!-- Credits/hour -->
        <span v-if="headerCreditsPerHour !== 0" class="text-[11px] px-1.5 py-0.5 rounded ml-auto shrink-0"
          :class="headerCreditsPerHour > 0 ? 'bg-green-900/20 text-space-green' : 'bg-red-900/20 text-space-red'">
          {{ headerCreditsPerHour > 0 ? '↗' : '↘' }} {{ Math.abs(headerCreditsPerHour).toLocaleString() }} cr/h
        </span>
      </div>
    </div>
    <!-- Body -->
    <div class="flex-1 flex gap-2 p-2 overflow-hidden">
      <!-- Sidebar col 1 -->
      <div class="w-72 space-y-3 overflow-hidden">
        <!-- Status -->
        <div class="card py-2 px-2">
          <div class="py-1 px-0 border-b border-space-border bg-space-card">
            <h3 class="text-xs font-semibold text-space-text-dim uppercase">📊 Status</h3>
          </div>
          <div class="py-1 px-0 space-y-1.5 text-xs">
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">💰</span><span class="text-space-text-dim">Credits</span></div>
              <span class="text-space-yellow font-medium">₡{{ formatNumber(currentBot.credits) }}</span>
            </div>
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">⛽</span><span class="text-space-text-dim">Fuel</span></div>
              <span class="text-space-cyan">{{ currentBot.fuel }} / {{ currentBot.maxFuel }}</span>
            </div>
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">❤️</span><span class="text-space-text-dim">Hull</span></div>
              <span class="text-space-red">{{ currentBot.hull }} / {{ currentBot.maxHull }}</span>
            </div>
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">🛡️</span><span class="text-space-text-dim">Shield</span></div>
              <span class="text-space-cyan">{{ currentBot.shield }} / {{ currentBot.maxShield }}</span>
            </div>
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">📦</span><span class="text-space-text-dim">Cargo</span></div>
              <span class="text-space-magenta">{{ currentBot.cargo || 0 }} / {{ currentBot.cargoMax || 0 }}</span>
            </div>
            <template v-if="weaponModules.length > 0">
              <div v-for="wep in weaponModules" :key="wep.id" class="flex justify-between">
                <div class="flex items-center gap-1 min-w-0">
                  <span class="w-4 text-center flex-shrink-0">🔫</span>
                  <span class="text-space-text-dim truncate" :title="wep.name || wep.type_id">{{ wep.name || 'Weapon' }}</span>
                </div>
                <span class="flex-shrink-0 ml-1" :class="(wep.current_ammo ?? 0) === 0 ? 'text-space-red font-semibold' : 'text-space-text'">
                  {{ wep.current_ammo ?? 0 }}/{{ wep.magazine_size ?? '?' }}
                  <span v-if="wep.ammo_type" class="text-[11px] text-space-text-dim">({{ wep.ammo_type }})</span>
                </span>
              </div>
              <div class="flex justify-between">
                <div class="flex items-center gap-1"><span class="w-4 text-center">📦</span><span class="text-space-text-dim">Ammo in cargo</span></div>
                <span :class="(currentBot.ammo || 0) === 0 ? 'text-space-red' : 'text-space-text'">{{ currentBot.ammo || 0 }}</span>
              </div>
            </template>
            <div v-else class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">🔫</span><span class="text-space-text-dim">Ammo</span></div>
              <span :class="(currentBot.ammo || 0) === 0 ? 'text-space-red' : 'text-space-text'">{{ currentBot.ammo || 0 }}</span>
            </div>
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">📍</span><span class="text-space-text-dim">Location</span></div>
              <span class="text-space-cyan text-xs text-right">{{ formatLocation(currentBot) }}</span>
            </div>
            <div class="flex justify-between">
              <div class="flex items-center gap-1"><span class="w-4 text-center">🏠</span><span class="text-space-text-dim">Docked</span></div>
              <span :class="currentBot.docked ? 'text-space-green' : 'text-space-red'">{{ currentBot.docked ? 'Yes' : 'No' }}</span>
            </div>
          </div>
        </div>
        <!-- Cargo Hold -->
        <div class="card py-2 px-2 !mt-2 !mb-2">
          <div class="py-1 px-0 border-b border-space-border bg-space-card">
            <h3 class="text-xs font-semibold text-space-text-dim uppercase">📦 Cargo Hold</h3>
          </div>
          <div class="py-1 px-0 max-h-40 overflow-auto scrollbar-dark">
            <div v-if="inventory.length === 0" class="text-xs text-space-text-dim text-center py-2">Empty</div>
            <div v-else class="space-y-1 pr-1">
              <div v-for="item in inventory" :key="item.itemId" class="flex justify-between text-xs">
                <span class="text-space-text">{{ item.name }}</span>
                <span class="text-space-text-dim">x{{ item.quantity }}</span>
              </div>
            </div>
          </div>
        </div>
        <!-- Station Storage -->
        <div class="card py-2 px-2 !mt-2 !mb-2">
          <div class="py-1 px-0 border-b border-space-border bg-space-card">
            <h3 class="text-xs font-semibold text-space-text-dim uppercase">🏠 Station Storage</h3>
          </div>
          <div class="py-1 px-0 max-h-60 overflow-auto scrollbar-dark">
            <div v-if="!currentBot.docked" class="text-xs text-space-text-dim text-center py-2 italic">⚠️ Not docked</div>
            <div v-else-if="storage.length === 0" class="text-xs text-space-text-dim text-center py-2">Empty</div>
            <div v-else class="space-y-1 pr-1">
              <div v-for="item in storage" :key="item.itemId" class="flex justify-between text-xs">
                <span class="text-space-text">{{ item.name }}</span>
                <span class="text-space-text-dim">x{{ item.quantity }}</span>
              </div>
            </div>
          </div>
        </div>
        <!-- Faction Storage -->
        <div v-if="currentBot.factionId" class="card py-2 px-2 !mt-2 border-space-accent/30">
          <div class="py-1 px-0 border-b border-space-border bg-space-card">
            <h3 class="text-xs font-semibold text-space-accent uppercase">🛡️ Faction Storage</h3>
          </div>
          <div class="py-1 px-0 max-h-60 overflow-auto scrollbar-dark">
            <div v-if="!currentBot.docked" class="text-xs text-space-text-dim text-center py-2 italic">⚠️ Not docked</div>
            <div v-else-if="factionStorage.length === 0" class="text-xs text-space-text-dim text-center py-2">Empty</div>
            <div v-else class="space-y-1 pr-1">
              <div v-for="item in factionStorage" :key="item.itemId" class="flex justify-between text-xs">
                <span class="text-space-text">{{ item.name }}</span>
                <span class="text-space-text-dim">x{{ item.quantity }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Sidebar col 2 -->
      <div class="w-72 space-y-3 overflow-hidden">
        <!-- Skills -->
        <div class="card py-2 px-2">
          <div class="py-1 px-0 border-b border-space-border bg-space-card">
            <h3 class="text-xs font-semibold text-space-text-dim uppercase">🎯 Skills</h3>
          </div>
          <div class="py-1 px-0">
            <div v-if="displaySkills.length === 0" class="text-xs text-space-text-dim text-center py-2">
              No skills data
              <button @click="fetchSkills" class="ml-2 text-space-accent hover:underline text-[11px]">🔄 Refresh</button>
            </div>
            <div v-else class="space-y-2">
              <template v-for="[category, catSkills] in groupedSkills" :key="category">
                <div class="flex items-center gap-1.5 mt-1.5 first:mt-0">
                  <span :class="CATEGORY_COLOR[category] || 'text-gray-400'" class="text-xs">{{ CATEGORY_ICON[category] || '📚' }}</span>
                  <span class="text-[11px] uppercase font-semibold tracking-wide" :class="CATEGORY_COLOR[category] || 'text-gray-400'">{{ category }}</span>
                  <div class="flex-1 h-px bg-space-border"></div>
                </div>
                <div class="space-y-1 pl-2 !mt-0.5 !mb-2">
                  <div v-for="skill in catSkills" :key="skill.skill_id" class="text-xs">
                    <div class="flex justify-between items-baseline">
                      <span class="text-gray-300 text-[11px]">{{ formatSkillName(skill.skill_id) }}</span>
                      <span class="text-space-text-dim flex items-center gap-1.5">
                        <span v-if="skill.xp !== undefined && skillXpNext(skill) > 0" class="text-[11px]">{{ skill.xp }}/{{ skillXpNext(skill) }}</span>
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
        <div class="flex gap-0 border-b border-space-border bg-space-card px-2 shrink-0 overflow-x-auto scrollbar-dark">
          <button @click="activeMainTab = 'control'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'control' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🛠️ Control</button>
          <button @click="currentBot.docked && (activeMainTab = 'ship')" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="[activeMainTab === 'ship' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent', currentBot.docked ? 'hover:text-space-text cursor-pointer' : 'opacity-40 cursor-not-allowed']" :title="!currentBot.docked ? 'Dock to manage ship' : ''">🛸 Ship</button>
          <button @click="currentBot.docked && loadFacilityTab()" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="[activeMainTab === 'facility' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent', currentBot.docked ? 'hover:text-space-text cursor-pointer' : 'opacity-40 cursor-not-allowed']" :title="!currentBot.docked ? 'Dock to manage facilities' : ''">⚙️ Facility</button>
          <button @click="activeMainTab = 'insurance'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'insurance' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🔰 Insurance</button>
          <button @click="activeMainTab = 'combat'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'combat' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">⚔️ Combat</button>
          <button @click="activeMainTab = 'profile'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'profile' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">👤 Profile</button>
          <button @click="currentBot.docked && loadStationTab()" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="[activeMainTab === 'station' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent', currentBot.docked ? 'hover:text-space-text cursor-pointer' : 'opacity-40 cursor-not-allowed']" :title="!currentBot.docked ? 'Dock to view station info' : ''">🏠 Station</button>
          <button @click="activeMainTab = 'log'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'log' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🗒️ Log</button>
          <button @click="activeMainTab = 'notes'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'notes' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">📝 Notes</button>
          <button @click="activeMainTab = 'social'" class="px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap" :class="activeMainTab === 'social' ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">🤝 Social</button>
        </div>
        <!-- Panel components -->
        <BotControlPanel ref="controlPanel" v-show="activeMainTab === 'control'" :bot="bot" @notif="onChildNotif" />
        <BotShipPanel v-show="activeMainTab === 'ship'" :bot="bot" @notif="onChildNotif" />
        <BotStationPanel v-show="activeMainTab === 'facility'" ref="facilityPanel" :bot="bot" mode="facility" @notif="onChildNotif" />
        <InsurancePanel v-if="activeMainTab === 'insurance'" :bot="bot" @notif="onChildNotif" />
        <CombatPanel v-if="activeMainTab === 'combat'" :bot="bot" @notif="onChildNotif" />
        <BotProfilePanel v-if="activeMainTab === 'profile'" :bot="bot" @notif="onChildNotif" />
        <BotStationPanel v-show="activeMainTab === 'station'" ref="stationPanel" :bot="bot" mode="station" @notif="onChildNotif" />
        <CaptainsLogPanel v-if="activeMainTab === 'log'" :bot="bot" @notif="onChildNotif" />
        <NotesPanel v-if="activeMainTab === 'notes'" :bot="bot" @notif="onChildNotif" />
        <SocialPanel v-if="activeMainTab === 'social'" :bot="bot" @notif="onChildNotif" />
      </div>
    </div>
    <!-- Ship class tooltip -->
    <Teleport to="body">
      <div v-if="shipTooltipVisible && headerShipClassId"
        class="fixed z-[9999] w-72 bg-[#0d1117] border border-space-border rounded-lg shadow-2xl overflow-hidden pointer-events-none"
        :style="{ top: shipTooltipPos.y + 'px', left: shipTooltipPos.x + 'px' }">
        <img v-if="headerShipCatalog"
          :src="headerShipImageUrl(headerShipClassId)"
          :alt="headerShipCatalog?.name"
          class="w-full h-28 object-cover"
          @error="($event.target as HTMLImageElement).style.display='none'" />
        <div class="p-2.5 space-y-2">
          <div class="flex justify-between items-start gap-2">
            <div class="min-w-0">
              <div class="text-xs font-semibold text-space-text-bright">{{ headerShipCatalog?.name || headerShipClassId }}</div>
              <div v-if="headerShipCatalog" class="text-[11px] text-space-text-dim">
                {{ headerShipCatalog.empire_name }} · Tier {{ headerShipCatalog.tier }} · Scale {{ headerShipCatalog.scale }}
              </div>
            </div>
            <span v-if="headerShipCatalog?.starter_ship" class="text-[11px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 shrink-0">Starter</span>
            <span v-else-if="headerShipCatalog?.price" class="text-space-yellow text-xs font-semibold shrink-0">{{ headerShipCatalog.price?.toLocaleString() }} cr</span>
          </div>
          <div v-if="headerShipCatalog?.description" class="text-[11px] text-space-text-dim leading-relaxed line-clamp-2">{{ headerShipCatalog.description }}</div>
          <div class="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px] pt-1 border-t border-[#21262d]">
            <div class="text-space-text-dim">❤️ Hull <span class="text-space-text">{{ headerShipCatalog?.base_hull ?? currentBot.maxHull ?? '?' }}</span></div>
            <div class="text-space-text-dim">🔵 Shield <span class="text-space-text">{{ headerShipCatalog?.base_shield ?? currentBot.maxShield ?? '?' }}</span></div>
            <div class="text-space-text-dim">💨 Speed <span class="text-space-text">{{ headerShipCatalog?.base_speed ?? '?' }}</span></div>
            <div class="text-space-text-dim">⛽ Fuel <span class="text-space-text">{{ headerShipCatalog?.base_fuel ?? currentBot.maxFuel ?? '?' }}</span></div>
            <div class="text-space-text-dim">📦 Cargo <span class="text-space-text">{{ headerShipCatalog?.cargo_capacity ?? currentBot.cargoMax ?? '?' }}</span></div>
            <div class="text-space-text-dim">🖥️ CPU <span class="text-space-text">{{ headerShipCatalog?.cpu_capacity ?? '?' }}</span></div>
            <div class="text-space-text-dim">⚔️ <span class="text-space-text">{{ headerShipCatalog?.weapon_slots ?? '?' }} wpn</span></div>
            <div class="text-space-text-dim">🛡️ <span class="text-space-text">{{ headerShipCatalog?.defense_slots ?? '?' }} def</span></div>
            <div class="text-space-text-dim">🔧 <span class="text-space-text">{{ headerShipCatalog?.utility_slots ?? '?' }} util</span></div>
          </div>
          <div v-if="headerShipCatalog?.flavor_tags?.length" class="flex flex-wrap gap-1 pt-1 border-t border-[#21262d]">
            <span v-for="tag in headerShipCatalog.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[11px]">{{ tag }}</span>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast notification -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-750 translate-y-0"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="opacity-750 translate-y-0"
        leave-to-class="opacity-0 translate-y-2">
        <div v-if="moduleNotif"
          class="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex items-start gap-2.5 px-4 py-3 rounded-lg shadow-2xl border text-sm max-w-sm pointer-events-none"
          :class="moduleNotif.type === 'success' ? 'bg-[#0d1117] border-green-500/60 text-green-300' : moduleNotif.type === 'warn' ? 'bg-[#0d1117] border-orange-500/60 text-orange-300' : 'bg-[#0d1117] border-red-500/60 text-red-300'">
          <span class="text-base shrink-0">{{ moduleNotif.type === 'success' ? '✅' : moduleNotif.type === 'warn' ? '📤' : '❌' }}</span>
          <span>{{ moduleNotif.text }}</span>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useBotStore } from '../stores/botStore';
import { empireIcon, empireName } from '../utils/empires';
import BotControlPanel from './BotControlPanel.vue';
import BotShipPanel from './BotShipPanel.vue';
import BotStationPanel from './BotStationPanel.vue';
import CaptainsLogPanel from './CaptainsLogPanel.vue';
import BotProfilePanel from './BotProfilePanel.vue';
import CombatPanel from './CombatPanel.vue';
import InsurancePanel from './InsurancePanel.vue';
import NotesPanel from './NotesPanel.vue';
import SocialPanel from './SocialPanel.vue';

interface Props { bot: any; }
const props = defineProps<Props>();
const emit = defineEmits(['close', 'start', 'stop']);
const botStore = useBotStore();

const SKILL_CATEGORY_MAP: Record<string, string> = {
  advanced_crafting:'crafting', basic_crafting:'crafting', blueprint_research:'crafting',
  crafting_mastery:'crafting', electronics_crafting:'crafting', mass_production:'crafting',
  module_crafting:'crafting', quality_control:'crafting', shield_crafting:'crafting',
  ship_construction:'crafting', weapon_crafting:'crafting',
  combat_drones:'drones', drone_control:'drones', drone_durability:'drones',
  drone_interfacing:'drones', drone_operation:'drones', mining_drones:'drones',
  repair_drones:'drones', salvage_drones:'drones', drone_sovereign:'prestige',
  crimson_bloodlust:'empire', crimson_fury:'empire', nebula_attunement:'empire',
  nebula_communion:'empire', outer_rim_scavenger:'empire', outer_rim_survival:'empire',
  solarian_discipline:'empire', solarian_doctrine:'empire', entropy:'empire',
  voidborn_phase_mastery:'empire',
  advanced_engineering:'engineering', cpu_management:'engineering', capacitor_systems:'engineering',
  damage_control_system:'engineering', engineering:'engineering', power_grid_management:'engineering',
  repair_systems:'engineering', rigging:'engineering',
  anomaly_detection:'exploration', anomaly_exploitation:'exploration', astrometrics:'exploration',
  cartography:'exploration', environmental_hazard_resistance:'exploration', exploration:'exploration',
  first_contact_protocols:'exploration', survey:'exploration', wormhole_navigation:'exploration',
  corporation_management:'faction', faction_warfare:'faction', station_management:'faction',
  mining:'mining', advanced_mining:'mining', advanced_refinement:'mining', biological_processing:'mining',
  deep_core_mining:'mining', gas_harvesting:'mining', gas_processing:'mining',
  ice_mining:'mining', ice_refining:'mining', ore_refinement:'mining', radioactive_handling:'mining',
  fuel_efficiency:'navigation', jump_calibration:'navigation', jump_drive_operation:'navigation',
  shield_operation:'ships', navigation:'navigation', warp_efficiency:'navigation',
  grand_admiral:'prestige', industrial_magnate:'prestige', legendary_pilot:'prestige',
  master_craftsman:'prestige', master_trader:'prestige', pathfinder:'prestige',
  shadow_operative:'prestige', titan_pilot:'prestige', warlord:'prestige',
  advanced_salvaging:'salvaging', archaeology:'salvaging', relic_identification:'salvaging', salvaging:'salvaging',
  capital_ships:'ships', covert_operations:'ships', crimson_fleet_command:'ships',
  industrial_ships:'ships', large_ships:'ships', medium_ships:'ships', small_ships:'ships',
  advanced_cloaking:'support', advanced_scanning:'support', alliance_management:'support',
  cloaking:'support', counter_hacking:'support', counter_intelligence:'support',
  diplomacy:'support', espionage:'support', fleet_coordination:'support',
  hacking:'support', leadership:'support', mentoring:'support',
  propaganda:'support', reputation_management:'support', scanning:'support',
  auction_mastery:'trading', black_market_trading:'trading', bulk_trading:'trading',
  contracts:'trading', hauling:'trading', insurance_brokering:'trading',
  loan_management:'trading', negotiation:'trading', rare_goods_expertise:'trading',
  smuggling:'trading', trading:'trading', armor_hardening:'ships',
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
  salvaging:'text-green-400', ships:'text-blue-400', support:'text-gray-400', trading:'text-lime-400',
};
const CATEGORY_BAR_COLOR: Record<string, string> = {
  crafting:'bg-orange-400', drones:'bg-teal-400', empire:'bg-yellow-500',
  engineering:'bg-slate-400', exploration:'bg-cyan-400', faction:'bg-purple-400',
  mining:'bg-amber-400', navigation:'bg-sky-400', prestige:'bg-yellow-400',
  salvaging:'bg-green-400', ships:'bg-blue-400', support:'bg-gray-400', trading:'bg-lime-400',
};
const CATEGORY_ORDER = ['mining','ships','navigation','engineering','crafting','trading',
  'exploration','drones','support','salvaging','faction','empire','prestige'];

// ── Header ship tooltip ─────────────────────────────────────────────────────
const shipTooltipVisible = ref(false);
const shipTooltipPos = ref({ x: 0, y: 0 });

const headerShipClassId = computed(() =>
  shipInfo.value?.class_id || (currentBot.value as any)?.shipClassId || ''
);

const headerShipCatalog = computed(() => {
  const id = headerShipClassId.value;
  if (!id || !botStore.publicShips?.length) return null;
  return botStore.publicShips.find((s: any) => s.id === id || s.class === id || s.ship_class === id) || null;
});

const headerSystemName = computed(() => {
  const sys = currentBot.value?.system;
  if (!sys) return '';
  const sysData = botStore.mapData[sys] as any;
  return sysData?.name || sys;
});

const headerPoiName = computed(() => {
  const poi = currentBot.value?.poi;
  const sys = currentBot.value?.system;
  if (!poi || !sys) return '';
  const sysData = botStore.mapData[sys] as any;
  const poiData = sysData?.pois?.find((p: any) => p.id === poi);
  return poiData?.name || poi;
});

const headerCreditsPerHour = computed(() =>
  botStore.botCreditsPerHour?.[currentBot.value?.username || ''] ?? 0
);

function headerShipImageUrl(classId: string): string {
  return `https://www.spacemolt.com/_next/image?url=%2Fimages%2Fships%2Fcatalog%2F${encodeURIComponent(classId)}.webp&w=640&q=75`;
}

function onShipNameHover(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  shipTooltipPos.value = {
    x: Math.min(rect.left, window.innerWidth - 300),
    y: rect.bottom + 6,
  };
  shipTooltipVisible.value = true;
}
// ─────────────────────────────────────────────────────────────────────────────

const activeMainTab = ref<'control' | 'ship' | 'station' | 'log' | 'profile' | 'combat' | 'insurance' | 'notes' | 'facility' | 'social'>('control');
const controlPanel = ref<InstanceType<typeof BotControlPanel> | null>(null);
const facilityPanel = ref<InstanceType<typeof BotStationPanel> | null>(null);
watch(activeMainTab, (tab) => {
  if (tab === 'control') nextTick(() => controlPanel.value?.scrollToBottom());
});
function loadFacilityTab() {
  activeMainTab.value = 'facility';
  facilityPanel.value?.maybeLoad();
}
const skills = ref<any[]>([]);
const shipInfo = ref<any>(null);
const moduleNotif = ref<{ text: string; type: 'success' | 'warn' | 'error' } | null>(null);
let moduleNotifTimer: ReturnType<typeof setTimeout> | null = null;
const stationPanel = ref<InstanceType<typeof BotStationPanel> | null>(null);

function showModuleNotif(text: string, type: 'success' | 'warn' | 'error') {
  if (moduleNotifTimer) clearTimeout(moduleNotifTimer);
  moduleNotif.value = { text, type };
  moduleNotifTimer = setTimeout(() => { moduleNotif.value = null; }, 5000);
}
function onChildNotif(text: string, type: 'success' | 'warn' | 'error') {
  showModuleNotif(text, type);
}
function loadStationTab() {
  activeMainTab.value = 'station';
  stationPanel.value?.maybeLoad();
}

const currentBot = computed(() => {
  const bot = botStore.bots.find(b => b.username === props.bot.username);
  return bot || props.bot;
});
const inventory = computed(() => [...(currentBot.value.inventory || [])].sort((a, b) => (a.name || a.itemId).localeCompare(b.name || b.itemId)));
const storage = computed(() => [...(currentBot.value.storage || [])].sort((a, b) => (a.name || a.itemId).localeCompare(b.name || b.itemId)));
const factionStorage = computed(() => [...(currentBot.value.factionStorage || [])].sort((a, b) => (a.name || a.itemId).localeCompare(b.name || b.itemId)));
const weaponModules = computed(() => {
  if (!shipInfo.value) return [];
  const mods = shipInfo.value.modules || [];
  return (mods as any[]).filter((m: any) => m.ammo_type || m.slot_type === 'weapon' || (m.damage != null && m.damage > 0));
});
const displaySkills = computed(() => {
  if (skills.value.length > 0) return skills.value;
  return (currentBot.value as any).skills || [];
});
const groupedSkills = computed(() => {
  const groups: Record<string, any[]> = {};
  for (const sk of displaySkills.value) {
    const cat = SKILL_CATEGORY_MAP[sk.skill_id || ''] || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(sk);
  }
  const ordered: [string, any[]][] = [];
  for (const cat of CATEGORY_ORDER) { if (groups[cat]) ordered.push([cat, groups[cat]]); }
  for (const [cat, sks] of Object.entries(groups)) { if (!CATEGORY_ORDER.includes(cat)) ordered.push([cat, sks]); }
  return ordered;
});

function formatNumber(n: number): string { return new Intl.NumberFormat().format(n); }
function formatLocation(bot: any): string {
  if (bot.poi) {
    const system = botStore.mapData[bot.system];
    if (system) {
      const poi = (system as any).pois?.find((p: any) => p.id === bot.poi);
      return `${poi?.name || bot.poi} (${(system as any).name || bot.system})`;
    }
    return `${bot.poi} (${bot.system})`;
  }
  return bot.location || bot.system || '-';
}
function skillXpNext(skill: any): number { return skill.xp_to_next ?? skill.next_level_xp ?? 0; }
function skillPct(skill: any): number {
  const next = skillXpNext(skill);
  if (!next || next <= 0) return 0;
  return Math.min(100, Math.round(((skill.xp || 0) / next) * 100));
}
function formatSkillName(skillId: string): string {
  return (skillId || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function execCommand(command: string, params?: any) {
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  botStore.sendExec(username, command, params, (result: any) => {
    if (result.ok) processExecResult(command, result.data);
    else showModuleNotif(result.error || 'Unknown error', 'error');
  });
}
function processExecResult(command: string, data: any) {
  if (!data) return;
  if (command === 'get_status' && data.ship) shipInfo.value = { ...data.ship, modules: data.modules || [] };
  if (command === 'get_skills') {
    const norm = (raw: any, key?: string): any => ({
      skill_id: raw.skill_id || raw.id || key || '',
      level: raw.level ?? raw.skill_level ?? 0,
      xp: raw.xp ?? raw.current_xp,
      xp_to_next: raw.xp_to_next ?? raw.next_level_xp ?? raw.xp_required,
    });
    let raw = data.skills || data.player_skills || data;
    if (Array.isArray(raw)) skills.value = raw.map((s: any) => norm(s));
    else if (raw && typeof raw === 'object')
      skills.value = Object.entries(raw).map(([k, v]: [string, any]) => typeof v === 'object' && v ? norm(v, k) : norm({ level: v }, k));
  }
}
function fetchSkills() { execCommand('get_skills'); }

onMounted(() => {
  execCommand('get_status');
  fetchSkills();
});
</script>