<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Faction</h3>
      </div>
      <div class="flex-1 overflow-auto p-2 scrollbar-dark">
        <!-- Bot selector -->
        <div 
          v-for="bot in botStore.bots" :key="bot.username"
          @click="selectBot(bot.username)"
          class="w-full px-2 py-2 text-sm rounded-md cursor-pointer mb-0.5 border transition-colors"
          :class="selectedBot === bot.username 
            ? 'bg-[rgba(88,166,255,0.1)] border-space-accent text-space-accent' 
            : 'border-transparent text-space-text hover:bg-space-row-hover'"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <span v-if="(bot as any).empire" :title="empireName((bot as any).empire)" class="shrink-0 leading-none">{{ empireIcon((bot as any).empire) }}</span>
            <span class="truncate">{{ bot.username }}</span>
          </div>
        </div>
        <div v-if="botStore.bots.length === 0" class="text-xs text-space-text-dim italic p-2">No bots available</div>

        <!-- Section nav (only when in own faction) -->
        <div v-if="selectedBot && factionData && isMember" class="mt-3 pt-3 border-t border-[#21262d]">
          <div v-for="sec in sections" :key="sec.id" @click="switchSection(sec.id)"
            class="w-full px-2 py-2 text-sm rounded-md cursor-pointer mb-0.5 border transition-colors"
            :class="activeSection === sec.id 
              ? 'bg-[rgba(88,166,255,0.1)] border-space-accent text-space-accent' 
              : 'border-transparent text-space-text-dim hover:bg-space-row-hover hover:text-space-text'"
          >{{ sec.label }}</div>
        </div>

        <!-- Quick actions -->
        <div v-if="selectedBot" class="mt-3 pt-3 border-t border-[#21262d] space-y-1">
          <button @click="refreshData" :disabled="loading" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-text-dim hover:bg-space-row-hover hover:text-space-text transition-colors disabled:opacity-50">Refresh</button>
          <button v-if="!factionData" @click="showCreateModal = true" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-green hover:bg-space-row-hover transition-colors">Create Faction</button>
          <button v-if="!factionData" @click="checkInvites" :disabled="loading" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-cyan hover:bg-space-row-hover transition-colors disabled:opacity-50">Check Invites</button>
          <button v-if="factionData && isMember" @click="leaveFaction" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-red hover:bg-space-row-hover transition-colors">Leave Faction</button>
          <button v-if="!factionData" @click="loadFactionList" :disabled="loading" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-text-dim hover:bg-space-row-hover hover:text-space-text transition-colors disabled:opacity-50">All Factions</button>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg p-2 overflow-auto scrollbar-dark">

      <div v-if="!selectedBot" class="text-space-text-dim italic text-sm py-8 text-center">
        Select a bot to view or manage its faction.
      </div>

      <!-- Error/Status -->
      <div v-if="errorMsg" class="mb-3 text-xs px-3 py-2 rounded bg-[#2d0000] text-space-red">{{ errorMsg }}</div>
      <div v-if="statusMsg" class="mb-3 text-xs px-3 py-2 rounded bg-[#0d2818] text-space-green">{{ statusMsg }}</div>

      <!-- Loading -->
      <div v-if="selectedBot && loading && !factionData" class="text-xs text-space-text-dim italic py-6 text-center">Loading faction data...</div>

      <!-- Not in faction -->
      <div v-if="selectedBot && !factionData && !loading">
        <div class="text-center py-6">
          <div class="text-lg font-bold text-space-text-bright mb-2">No Faction</div>
          <p class="text-xs text-space-text-dim mb-4">This bot is not a member of any faction.</p>
          <div class="flex justify-center gap-2">
            <button @click="showCreateModal = true" class="btn btn-primary text-xs px-4 py-2">Create Faction</button>
            <button @click="checkInvites" :disabled="loading" class="btn text-xs px-4 py-2">Check Invites</button>
          </div>
        </div>

        <!-- All factions list -->
        <div v-if="factionList.length > 0" class="mt-6">
          <h3 class="text-sm font-semibold text-space-text-bright mb-2">All Factions</h3>
          <div v-for="f in factionList" :key="f.id" @click="viewFactionDetails(f.id)" class="bg-space-bg border border-[#21262d] rounded-md p-3 mb-2 cursor-pointer hover:border-space-accent transition-colors">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-sm font-medium text-space-text">{{ f.name }}</span>
                <span class="text-xs text-space-text-dim ml-2">[{{ f.tag }}]</span>
              </div>
              <span class="text-xs text-space-text-dim">{{ f.member_count || 0 }} members</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Viewing a foreign faction (from list) -->
      <div v-if="selectedBot && factionData && !isMember">
        <div class="mb-4">
          <div class="flex items-start justify-between mb-2">
            <div>
              <h2 class="text-xl font-bold text-space-text-bright">{{ factionData.name }}</h2>
              <div class="flex items-center gap-3 text-xs mt-1">
                <span class="px-2 py-0.5 rounded text-space-text">[{{ factionData.tag }}]</span>
                <span class="text-space-text-dim">Members: {{ factionData.member_count || 0 }}</span>
              </div>
            </div>
            <button @click="factionData = null" class="btn text-xs px-3 py-1">← Back</button>
          </div>
          <p v-if="factionData.description" class="text-xs text-space-text-dim">{{ factionData.description }}</p>
        </div>
      </div>

      <!-- Has faction (own): show content -->
      <div v-if="selectedBot && factionData && isMember">
        <!-- Faction Header -->
        <div class="mb-4">
          <div class="flex items-start justify-between mb-3">
            <div>
              <h2 class="text-xl font-bold text-space-text-bright">{{ factionData.name }}</h2>
              <div class="flex items-center gap-3 text-xs mt-1">
                <span class="px-2 py-0.5 rounded text-space-text">[{{ factionData.tag }}]</span>
                <span class="text-space-text-dim">Leader: {{ factionData.leader_username || factionData.leader || '-' }}</span>
              </div>
            </div>
            <button @click="refreshData" :disabled="loading" class="btn text-xs px-3 py-1">Refresh</button>
          </div>

          <p v-if="factionData.description" class="text-xs text-space-text-dim mb-3">{{ factionData.description }}</p>

          <!-- Stats row -->
          <div class="grid grid-cols-4 gap-2 text-center">
            <div class="bg-space-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-cyan">{{ memberCount }}</div>
              <div class="text-[11px] text-space-text-dim">Members</div>
            </div>
            <div class="bg-space-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-green">{{ onlineCount }}</div>
              <div class="text-[11px] text-space-text-dim">Online</div>
            </div>
            <div class="bg-space-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-yellow">{{ fmt(factionData.treasury ?? factionData.credits ?? 0) }}</div>
              <div class="text-[11px] text-space-text-dim">Treasury</div>
            </div>
            <div class="bg-space-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-magenta">{{ factionFacilities.length }}</div>
              <div class="text-[11px] text-space-text-dim">Facilities</div>
            </div>
          </div>
        </div>

        <!-- Tab: Members -->
        <div v-if="activeSection === 'members'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">Members</h3>
            <button @click="showInviteModal = true" class="btn text-xs px-3 py-1">Invite</button>
          </div>
          <div v-if="!members.length" class="text-xs text-space-text-dim italic">No member data.</div>
          <div v-for="m in members" :key="m.player_id || m.username" class="flex items-center justify-between py-2 px-3 border-b border-[#21262d] hover:bg-space-row-hover transition-colors">
            <div class="flex items-center gap-3">
              <div class="w-7 h-7 bg-space-accent rounded-full flex items-center justify-center text-xs text-white font-bold">{{ (m.username || '?')[0].toUpperCase() }}</div>
              <div>
                <div class="text-xs font-medium text-space-text">{{ m.username || m.name }}</div>
                <div class="text-[11px] text-space-text-dim">{{ m.role || 'Member' }}</div>
              </div>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span :class="m.is_online ? 'text-space-green' : 'text-space-text-dim'">{{ m.is_online ? 'Online' : 'Offline' }}</span>
              <select v-if="m.username !== selectedBot" @change="promoteMember(m, ($event.target as HTMLSelectElement).value)" class="input text-[11px] py-0.5 px-1">
                <option value="" disabled selected>Role</option>
                <option value="Member">Member</option>
                <option value="Officer">Officer</option>
                <option value="Leader">Leader</option>
              </select>
              <button v-if="m.username !== selectedBot" @click="kickMember(m)" class="text-[11px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors">Kick</button>
            </div>
          </div>
        </div>

        <!-- Tab: Storage (loaded on demand) -->
        <div v-if="activeSection === 'storage'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">Faction Storage</h3>
            <button @click="loadStorage" :disabled="loading" class="btn text-xs px-3 py-1">Load Storage</button>
          </div>
          <div v-if="!storageLoaded" class="text-xs text-space-text-dim italic">Click "Load Storage" to view items (bot must be docked).</div>
          <div v-else-if="storageError" class="text-xs text-space-red">{{ storageError }}</div>
          <div v-else-if="!factionStorage.length" class="text-xs text-space-text-dim italic">No items in faction storage.</div>
          <div v-for="item in factionStorage" :key="item.item_id || item.name" class="flex items-center justify-between py-1.5 px-2 border-b border-[#21262d] text-xs">
            <span class="text-space-text">{{ item.name || item.item_id }}</span>
            <span class="text-space-text-dim font-mono">x{{ item.quantity }}</span>
          </div>
        </div>

        <!-- Tab: Buildings / Facilities -->
        <div v-if="activeSection === 'buildings'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">Faction Infrastructure</h3>
            <button @click="loadFacilities" :disabled="loading" class="btn text-xs px-3 py-1">Refresh</button>
          </div>

          <!-- Existing facilities -->
          <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Active Facilities</h4>
          <div v-if="factionFacilities.length > 0" class="grid grid-cols-5 gap-2">
            <div v-for="f in factionFacilities" :key="f.facility_id"
              class="bg-space-bg border border-[#21262d] rounded-md p-2 mb-2 text-xs"
              :class="f.active === false ? 'opacity-60' : ''">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-medium text-space-text">{{ f.name }}</span>
                    <span v-if="f.level" class="text-[11px] text-space-text-dim">Lv{{ f.level }}</span>
                    <span :class="f.active !== false ? 'text-space-green' : 'text-space-red'" class="text-[11px]">{{ f.active !== false ? '● Active' : '● Inactive' }}</span>
                  </div>
                  <div v-if="f.description" class="text-[11px] text-space-text-dim mt-0.5">{{ f.description }}</div>
                  <div v-if="f.faction_service" class="text-[11px] text-space-text-dim">Service: {{ f.faction_service }}</div>
                  <div v-if="f.capacity" class="text-[11px] text-space-text-dim">Cap: {{ f.capacity }}</div>
                </div>
                <div class="flex flex-col items-end gap-1 shrink-0">
                  <button @click="toggleFactionFacility(f)"
                    :disabled="factionActionLoading === f.facility_id"
                    class="btn btn-secondary text-[11px] px-2 py-0.5 disabled:opacity-40">
                    {{ factionActionLoading === f.facility_id ? '...' : f.active !== false ? 'Disable' : 'Enable' }}
                  </button>
                </div>
              </div>
              <!-- Upgrade options -->
              <div v-if="factionUpgradeMap[f.facility_id]?.length" class="mt-1.5 pt-1.5 border-t border-[#30363d]">
                <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-1">Upgrades available</div>
                <div class="flex flex-wrap gap-1">
                  <button v-for="u in factionUpgradeMap[f.facility_id]" :key="u.facility_type || u.id"
                    @click="upgradeFactionFacility(f, u.facility_type || u.id)"
                    :disabled="factionActionLoading === f.facility_id"
                    class="btn btn-primary text-[11px] px-2 py-0.5 disabled:opacity-40">
                    {{ factionActionLoading === f.facility_id ? '...' : '↑ ' + (u.name || u.facility_type || u.id) }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="facilitiesLoaded" class="text-xs text-space-text-dim italic mb-4">No facilities built yet.</div>
          <div v-else class="text-xs text-space-text-dim italic mb-4">Click "Refresh" to load facilities.</div>

          <!-- Buildable types -->
          <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Build New Facility</h4>
          <div v-if="buildableTypes.length > 0" class="grid grid-cols-5 gap-2">
            <div v-for="bt in buildableTypes" :key="bt.id"
              class="bg-space-bg border border-[#21262d] rounded-md p-2 mb-2 text-xs transition-opacity"
              :class="[!bt.buildable && !hasFacility(bt.id) ? 'opacity-50' : '', hasFacility(bt.id) ? 'border-green-900/30' : '']">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-medium" :class="hasFacility(bt.id) ? 'text-space-green' : 'text-space-text'">{{ bt.name }}</span>
                    <span v-if="bt.level" class="text-[11px] text-space-text-dim">Lv{{ bt.level }}</span>
                    <span v-if="hasFacility(bt.id)" class="text-[11px] px-1 py-0.5 rounded bg-green-900/30 text-space-green">✓ built</span>
                    <span v-else-if="!bt.buildable" class="text-[11px] px-1 py-0.5 rounded bg-[#30363d] text-space-text-dim">🔒 locked</span>
                  </div>
                  <div v-if="bt.description" class="text-[11px] text-space-text-dim mt-0.5 line-clamp-2">{{ bt.description }}</div>
                  <div v-if="bt.bonus_type" class="text-[11px] text-space-cyan mt-0.5">+{{ bt.bonus_value }} {{ bt.bonus_type.replace(/_/g, ' ') }}</div>
                  <div v-if="bt.faction_service" class="text-[11px] text-space-accent">⚙️ {{ bt.faction_service.replace(/_/g, ' ') }}</div>
                  <div v-if="bt.build_time" class="text-[11px] text-space-text-dim">⏱ {{ bt.build_time }} cycles</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-space-yellow text-[11px] mb-1">{{ bt.build_cost != null ? formatBuildCost(bt.build_cost) : '—' }}</div>
                  <button @click="buildFacility(bt.id, bt.name)"
                    :disabled="hasFacility(bt.id) || !bt.buildable || factionActionLoading === bt.id"
                    class="btn text-[11px] px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    :class="hasFacility(bt.id) ? 'btn-secondary' : bt.buildable ? 'btn-primary' : 'btn-secondary'">
                    {{ factionActionLoading === bt.id ? '...' : hasFacility(bt.id) ? '✓ Built' : !bt.buildable ? '🔒 Locked' : '🔨 Build' }}
                  </button>
                  <div v-if="factionBuildErrors[bt.id]" class="text-[11px] text-red-400 mt-1">⚠ {{ factionBuildErrors[bt.id] }}</div>
                </div>
              </div>
              <!-- Build materials -->
              <div v-if="(factionTypeCache[bt.id]?.build_materials || bt.build_materials)?.length"
                class="mt-1.5 pt-1.5 border-t border-[#30363d] flex items-end justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-0.5">Materials required</div>
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-space-text-dim">
                    <span v-for="m in (factionTypeCache[bt.id]?.build_materials || bt.build_materials)" :key="m.item_id">{{ m.name || m.item_id }} ×{{ m.quantity }}</span>
                  </div>
                </div>
                <div class="shrink-0 flex flex-col items-end gap-1">
                  <span v-if="currentGatherGoal?.target_id === bt.id" class="text-[11px] text-space-cyan flex items-center gap-1">
                    ⚙️ Gathering
                    <button @click="clearGatherGoal()" class="text-space-red hover:text-red-400" title="Cancel">✕</button>
                  </span>
                  <button v-else-if="!hasFacility(bt.id)" @click="gatherFacilityMaterials(bt)"
                    class="btn btn-secondary text-[11px] px-2 py-0.5 whitespace-nowrap">📦 Gather</button>
                </div>
              </div>
              <div v-else-if="!factionTypeCache[bt.id]" class="mt-1 text-[11px] text-space-text-dim/40 italic cursor-pointer hover:text-space-text-dim" @click="loadFacilityDetail(bt.id)">
                Click to load details
              </div>
            </div>
          </div>

          <!-- Facility Detail Modal -->
          <div v-if="facilityDetail" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="facilityDetail = null">
            <div class="bg-space-card border border-space-border rounded-lg p-5 w-[28rem] max-h-[80vh] overflow-auto">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-lg font-semibold text-space-text-bright">{{ facilityDetail.name }}</h3>
                <button @click="facilityDetail = null" class="text-space-text-dim hover:text-space-text">✕</button>
              </div>
              <div class="space-y-2 text-xs">
                <p v-if="facilityDetail.description" class="text-space-text-dim">{{ facilityDetail.description }}</p>
                <div v-if="facilityDetail.bonus_type" class="px-2 py-1.5 bg-[#0d2233] rounded text-space-cyan">Bonus: +{{ facilityDetail.bonus_value }} {{ facilityDetail.bonus_type.replace('_', ' ') }}</div>
                <div v-if="facilityDetail.build_materials?.length" class="px-2 py-1.5 bg-[#2d2200] rounded">
                  <div class="text-space-yellow font-medium mb-1">Build Materials:</div>
                  <div v-for="mat in facilityDetail.build_materials" :key="mat.item_id" class="text-space-text-dim">• {{ mat.quantity }}x {{ mat.name }}</div>
                </div>
                <div v-if="facilityDetail.build_cost" class="px-2 py-1.5 bg-[#0d2818] rounded text-space-green">Cost: {{ formatBuildCost(facilityDetail.build_cost) }}</div>
                <div v-if="facilityDetail.rent_per_cycle" class="px-2 py-1.5 bg-[#2d1500] rounded text-space-yellow">Rent: {{ facilityDetail.rent_per_cycle }} cr/cycle</div>
                <div v-if="facilityDetail.build_time" class="text-space-text-dim">Build time: {{ facilityDetail.build_time }} cycles</div>
                <div v-if="facilityDetail.hint" class="px-2 py-1.5 bg-[#0d2233] border border-[#1a3a5a] rounded text-space-accent">{{ facilityDetail.hint }}</div>
              </div>
              <div class="flex gap-2 mt-4 flex-wrap">
                <button @click="buildFacility(facilityDetail.id, facilityDetail.name); facilityDetail = null"
                  :disabled="loading || hasFacility(facilityDetail.id) || currentGatherGoal?.target_id === facilityDetail.id"
                  class="btn btn-primary flex-1 text-xs">
                  {{ hasFacility(facilityDetail.id) ? 'Already Built' : 'Build Now' }}
                </button>
                <button
                  v-if="!hasFacility(facilityDetail.id) && facilityDetail.build_materials?.length && currentGatherGoal?.target_id !== facilityDetail.id"
                  @click="gatherFacilityMaterials(facilityDetail); facilityDetail = null"
                  class="btn flex-1 text-xs">📦 Gather</button>
                <span v-else-if="currentGatherGoal?.target_id === facilityDetail.id" class="flex items-center gap-1 text-xs text-space-cyan flex-1 justify-center">
                  ⚙️ Gathering
                  <button @click="clearGatherGoal()" class="text-space-red text-[11px]">✕</button>
                </span>
                <button @click="facilityDetail = null" class="btn flex-1 text-xs">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: Diplomacy -->
        <div v-if="activeSection === 'diplomacy'">
          <h3 class="text-sm font-semibold text-space-text-bright mb-3">Diplomacy</h3>
          <div class="space-y-4">
            <div>
              <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Allies</h4>
              <div class="flex flex-wrap gap-1">
                <span v-for="a in (factionData.allies || [])" :key="a" class="px-2 py-0.5 text-xs bg-[#0d2818] text-space-green border border-[#1a3a2a] rounded">{{ a }}</span>
                <span v-if="!(factionData.allies || []).length" class="text-xs text-space-text-dim italic">No allies</span>
              </div>
            </div>
            <div>
              <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Enemies</h4>
              <div class="flex flex-wrap gap-1">
                <span v-for="e in (factionData.enemies || [])" :key="e" class="px-2 py-0.5 text-xs bg-[#2d0000] text-space-red border border-[#3d1111] rounded">{{ e }}</span>
                <span v-if="!(factionData.enemies || []).length" class="text-xs text-space-text-dim italic">No enemies</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: Activity -->
        <div v-if="activeSection === 'activity'">
          <h3 class="text-sm font-semibold text-space-text-bright mb-3">Faction Activity</h3>
          <div class="font-mono text-xs leading-relaxed max-h-[500px] overflow-auto scrollbar-dark">
            <div v-if="botStore.factionLogLines.length === 0" class="text-space-text-dim italic py-3">No faction activity logged yet.</div>
            <div v-for="(line, idx) in botStore.factionLogLines" :key="idx" class="text-space-text-dim">{{ line }}</div>
          </div>
        </div>
      </div>

      <!-- Create Faction Modal -->
      <div v-if="showCreateModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showCreateModal = false">
        <div class="bg-space-card border border-space-border rounded-lg p-5 w-96">
          <h3 class="text-lg font-semibold text-space-text-bright mb-4">Create Faction</h3>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-space-text-dim mb-1">Faction Name</label>
              <input v-model="createName" type="text" class="input w-full text-xs" placeholder="My Faction">
            </div>
            <div>
              <label class="block text-xs text-space-text-dim mb-1">Tag (3-5 chars)</label>
              <input v-model="createTag" type="text" class="input w-full text-xs" maxlength="5" placeholder="TAG">
            </div>
            <div>
              <label class="block text-xs text-space-text-dim mb-1">Description</label>
              <textarea v-model="createDesc" class="input w-full text-xs" rows="3" placeholder="Optional description"></textarea>
            </div>
          </div>
          <div class="flex gap-2 mt-4">
            <button @click="doCreateFaction" :disabled="!createName || !createTag || loading" class="btn btn-primary flex-1 text-xs">Create</button>
            <button @click="showCreateModal = false" class="btn flex-1 text-xs">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Invite Modal -->
      <div v-if="showInviteModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showInviteModal = false">
        <div class="bg-space-card border border-space-border rounded-lg p-5 w-96">
          <h3 class="text-lg font-semibold text-space-text-bright mb-4">Invite Player</h3>
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Player Username</label>
            <input v-model="inviteUsername" type="text" class="input w-full text-xs" placeholder="Username to invite">
          </div>
          <div class="flex gap-2 mt-4">
            <button @click="doInvite" :disabled="!inviteUsername || loading" class="btn btn-primary flex-1 text-xs">Invite</button>
            <button @click="showInviteModal = false" class="btn flex-1 text-xs">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';
import { empireIcon, empireName } from '../utils/empires';

const botStore = useBotStore();
const selectedBot = ref<string | null>(null);
const activeSection = ref('members');
const loading = ref(false);
const errorMsg = ref('');
const statusMsg = ref('');

// Data
const factionData = ref<any>(null);
const isMember = ref(false);
const factionStorage = ref<any[]>([]);
const storageLoaded = ref(false);
const storageError = ref('');
const factionList = ref<any[]>([]);
const factionFacilities = ref<any[]>([]);
const buildableTypes = ref<any[]>([]);
const facilitiesLoaded = ref(false);
const facilityDetail = ref<any>(null);
const factionTypeCache = ref<Record<string, any>>({});
const factionActionLoading = ref<string | null>(null);
const factionBuildErrors = ref<Record<string, string>>({});
const factionUpgradeMap = ref<Record<string, any[]>>({}); // facility_id → upgrade options

const currentGatherGoal = computed(() =>
  (selectedBot.value ? (botStore.settings as any)?.[selectedBot.value]?.goal : null) ??
  (botStore.settings as any)?.gatherer?.goal ?? null
);

// Modals
const showCreateModal = ref(false);
const showInviteModal = ref(false);
const createName = ref('');
const createTag = ref('');
const createDesc = ref('');
const inviteUsername = ref('');

const sections = [
  { id: 'members', label: 'Members' },
  { id: 'storage', label: 'Storage' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'activity', label: 'Activity' },
];

function fmt(n: number): string { return new Intl.NumberFormat().format(n); }

function execAsync(command: string, params?: any): Promise<any> {
  return new Promise(resolve => {
    if (!selectedBot.value) return resolve({ ok: false, error: 'No bot selected' });
    botStore.sendExec(selectedBot.value, command, params, resolve);
  });
}

function parseBuildError(raw: string): string {
  const msg = raw.replace(/^[\w_]+:\s*/i, '').trim();
  const m = msg.match(/need (\d+) x ([\w_]+),?\s*have (\d+) in storage \+ (\d+) in cargo/i);
  if (m) {
    const qty = m[1], itemId = m[2].replace(/_/g, ' '), have = parseInt(m[3]) + parseInt(m[4]);
    return `Missing: ${qty}\u00d7 ${itemId} (have ${have})`;
  }
  return msg;
}

function setError(msg: string) { errorMsg.value = msg; setTimeout(() => { errorMsg.value = ''; }, 5000); }
function setStatus(msg: string) { statusMsg.value = msg; setTimeout(() => { statusMsg.value = ''; }, 4000); }

// Computed
const members = computed(() => factionData.value?.members || []);
const memberCount = computed(() => factionData.value?.member_count ?? members.value.length);
const onlineCount = computed(() => members.value.filter((m: any) => m.is_online).length);

// ── Bot selection ───────────────────────────────────────────
function selectBot(username: string) {
  if (selectedBot.value === username) return;
  selectedBot.value = username;
  activeSection.value = 'members';
  factionData.value = null;
  isMember.value = false;
  factionStorage.value = [];
  storageLoaded.value = false;
  storageError.value = '';
  factionList.value = [];
  factionFacilities.value = [];
  buildableTypes.value = [];
  facilitiesLoaded.value = false;
  facilityDetail.value = null;
  factionTypeCache.value = {};
  factionActionLoading.value = null;
  factionBuildErrors.value = {};
  factionUpgradeMap.value = {};
  errorMsg.value = '';
  statusMsg.value = '';
  refreshData();
}

// ── Tab switch: load data on demand ─────────────────────────
function switchSection(id: string) {
  activeSection.value = id;
  if (id === 'buildings' && !facilitiesLoaded.value && isMember.value) {
    loadFacilities();
  }
}

// ── Refresh: only faction_info (single request) ─────────────
function refreshData() {
  if (!selectedBot.value || loading.value) return;
  loading.value = true;
  const username = selectedBot.value;

  botStore.sendExec(username, 'faction_info', undefined, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      factionData.value = result.data;
      // Determine membership: if we got members array, we're in the faction
      isMember.value = !!(result.data.members && result.data.members.length > 0);
    } else {
      factionData.value = null;
      isMember.value = false;
      const err = result.error || '';
      if (!err.includes('not in a faction') && !err.includes('not a member') && !err.includes('not_authenticated') && !err.includes('Too Many Requests')) {
        if (err) setError(err);
      }
    }
  });
}

// ── Storage: loaded on demand (requires docked) ─────────────
function loadStorage() {
  if (!selectedBot.value || loading.value) return;
  loading.value = true;
  storageError.value = '';
  const username = selectedBot.value;

  botStore.sendExec(username, 'view_faction_storage', undefined, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    storageLoaded.value = true;
    if (result.ok && result.data) {
      factionStorage.value = Array.isArray(result.data) ? result.data : (result.data.items || result.data.storage || []);
    } else {
      const err = result.error || '';
      if (err.includes('storage') || err.includes('facility') || err.includes('docked') || err.includes('dock')) {
        storageError.value = 'Bot must be docked at a station with faction storage facility.';
      } else {
        storageError.value = err || 'Could not load storage';
      }
    }
  });
}

// ── Facilities: loaded on demand ────────────────────────────
function loadFacilities() {
  if (!selectedBot.value || loading.value) return;
  loading.value = true;
  const username = selectedBot.value;

  botStore.sendExec(username, 'facility', { action: 'list' }, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    facilitiesLoaded.value = true;
    if (result.ok && result.data) {
      factionFacilities.value = result.data.faction_facilities || [];
    }
    loadBuildableTypes();
    loadFactionUpgrades();
  });
}

async function loadFactionUpgrades(): Promise<void> {
  const res = await execAsync('facility', { action: 'upgrades' });
  if (!res.ok || !res.data) return;
  const list: any[] = res.data.upgrades || res.data.facilities || (Array.isArray(res.data) ? res.data : []);
  const map: Record<string, any[]> = {};
  for (const entry of list) {
    const id: string = entry.facility_id;
    if (!id) continue;
    const opts: any[] = entry.available_upgrades || entry.upgrades || (entry.facility_type ? [entry] : []);
    if (opts.length) map[id] = opts;
  }
  factionUpgradeMap.value = map;
}

async function toggleFactionFacility(f: any): Promise<void> {
  factionActionLoading.value = f.facility_id;
  try {
    const res = await execAsync('facility', { action: 'toggle', facility_id: f.facility_id });
    if (res.ok) {
      f.active = !f.active;
    } else {
      setError(res.error || 'Toggle failed');
    }
  } finally {
    factionActionLoading.value = null;
  }
}

async function upgradeFactionFacility(f: any, toTypeId: string): Promise<void> {
  factionActionLoading.value = f.facility_id;
  try {
    const res = await execAsync('facility', { action: 'upgrade', facility_id: f.facility_id, facility_type: toTypeId });
    if (res.ok) {
      setStatus('Facility upgraded!');
      loadFacilities();
    } else {
      setError(parseBuildError(res.error || 'Upgrade failed'));
    }
  } finally {
    factionActionLoading.value = null;
  }
}

function loadBuildableTypes() {
  if (!selectedBot.value) return;
  const username = selectedBot.value;
  let allTypes: any[] = [];
  let currentPage = 1;

  function fetchPage(page: number) {
    botStore.sendExec(username, 'facility', { action: 'types', category: 'faction', page }, (result: any) => {
      if (selectedBot.value !== username) return;
      if (result.ok && result.data) {
        const pageTypes = result.data.types || [];
        allTypes = [...allTypes, ...pageTypes];
        const totalPages = result.data.total_pages || 1;
        if (page < totalPages && pageTypes.length > 0) {
          fetchPage(page + 1);
          return;
        }
      }
      buildableTypes.value = allTypes;
    });
  }
  fetchPage(1);
}

function loadFacilityDetail(facilityTypeId: string) {
  if (factionTypeCache.value[facilityTypeId]) {
    facilityDetail.value = factionTypeCache.value[facilityTypeId];
    return;
  }
  if (!selectedBot.value) return;
  botStore.sendExec(selectedBot.value, 'facility', { action: 'types', facility_type: facilityTypeId }, (result: any) => {
    if (result.ok && result.data) {
      const raw = (result.data.types || [])[0] ?? result.data;
      const info = { ...raw, id: raw.id || raw.type_id || facilityTypeId };
      factionTypeCache.value[facilityTypeId] = info;
      facilityDetail.value = info;
    }
  });
}

function gatherFacilityMaterials(bt: any) {
  const cached = factionTypeCache.value[bt.id];
  const mats = cached?.build_materials || bt.build_materials;
  if (!mats?.length) {
    if (!selectedBot.value) return;
    botStore.sendExec(selectedBot.value, 'facility', { action: 'types', facility_type: bt.id }, (result: any) => {
      if (result.ok && result.data) {
        const raw = (result.data.types || [])[0] ?? result.data;
        const info = { ...raw, id: raw.id || raw.type_id || bt.id };
        factionTypeCache.value[bt.id] = info;
        if (!info.build_materials?.length) { setError('No build materials defined'); return; }
        doSaveGatherGoal(bt.id, bt.name, info.build_materials);
      }
    });
    return;
  }
  doSaveGatherGoal(bt.id, bt.name, mats);
}

function doSaveGatherGoal(typeId: string, typeName: string, mats: any[]) {
  if (!selectedBot.value) return;
  botStore.saveSettings(selectedBot.value, {
    goal: {
      id: `faction_${typeId}_${Date.now()}`,
      target_id: typeId,
      target_name: typeName,
      target_poi: '',
      target_system: '',
      materials: mats.map((m: any) => ({
        item_id: m.item_id,
        item_name: m.name || m.item_name,
        quantity_needed: m.quantity,
      })),
    },
  });
  setStatus(`📦 Gather goal created: ${typeName}`);
}

function clearGatherGoal() {
  if (!selectedBot.value) return;
  botStore.saveSettings(selectedBot.value, { goal: null });
}

async function buildFacility(facilityTypeId: string, facilityName?: string): Promise<void> {
  if (!selectedBot.value) return;
  factionActionLoading.value = facilityTypeId;
  factionBuildErrors.value[facilityTypeId] = '';
  try {
    const res = await execAsync('facility', { action: 'faction_build', facility_type: facilityTypeId });
    if (res.ok) {
      setStatus(`${facilityName || facilityTypeId} built!`);
      loadFacilities();
    } else {
      const cleaned = parseBuildError(res.error || 'Build failed');
      factionBuildErrors.value[facilityTypeId] = cleaned;
      setError(cleaned);
    }
  } finally {
    factionActionLoading.value = null;
  }
}

function hasFacility(facilityTypeId: string): boolean {
  return factionFacilities.value.some((f: any) => f.type === facilityTypeId);
}

function formatBuildCost(cost: any): string {
  if (!cost) return 'Unknown';
  if (typeof cost === 'number') return `${fmt(cost)} credits`;
  if (typeof cost === 'object') {
    return Object.entries(cost).map(([item, qty]) => `${qty}x ${item}`).join(', ');
  }
  return String(cost);
}

// ── Faction list (only on demand) ───────────────────────────
function loadFactionList() {
  if (!selectedBot.value || loading.value) return;
  loading.value = true;
  const username = selectedBot.value;
  botStore.sendExec(username, 'faction_list', { limit: 100, offset: 0 }, (result: any) => {
    loading.value = false;
    if (selectedBot.value !== username) return;
    if (result.ok && result.data) {
      factionList.value = result.data.factions || (Array.isArray(result.data) ? result.data : []);
    }
  });
}

// ── View foreign faction details ────────────────────────────
function viewFactionDetails(factionId: string) {
  if (!selectedBot.value || loading.value) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'faction_info', { faction_id: factionId }, (result: any) => {
    loading.value = false;
    if (result.ok && result.data) {
      factionData.value = result.data;
      isMember.value = false;
    }
  });
}

// ── Actions ─────────────────────────────────────────────────
function leaveFaction() {
  if (!selectedBot.value || !confirm('Leave the faction?')) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'leave_faction', undefined, (result: any) => {
    loading.value = false;
    if (result.ok) {
      setStatus('Left faction');
      factionData.value = null;
      isMember.value = false;
      factionStorage.value = [];
      factionFacilities.value = [];
    } else {
      setError(result.error || 'Failed to leave');
    }
  });
}

function doCreateFaction() {
  if (!selectedBot.value || !createName.value || !createTag.value || loading.value) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'create_faction', {
    name: createName.value,
    tag: createTag.value,
    description: createDesc.value || undefined,
  }, (result: any) => {
    loading.value = false;
    if (result.ok) {
      setStatus('Faction created!');
      showCreateModal.value = false;
      createName.value = '';
      createTag.value = '';
      createDesc.value = '';
      refreshData();
    } else {
      setError(result.error || 'Failed to create faction');
    }
  });
}

function checkInvites() {
  if (!selectedBot.value || loading.value) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'faction_get_invites', undefined, (result: any) => {
    loading.value = false;
    if (result.ok && result.data) {
      const invites = result.data.invites || (Array.isArray(result.data) ? result.data : []);
      if (invites.length === 0) {
        setStatus('No pending invites');
      } else {
        const firstInvite = invites[0];
        if (confirm(`Accept invite to ${firstInvite.faction_name || firstInvite.faction_id}?`)) {
          loading.value = true;
          botStore.sendExec(selectedBot.value!, 'join_faction', { faction_id: firstInvite.faction_id }, (r: any) => {
            loading.value = false;
            if (r.ok) { setStatus('Joined faction!'); refreshData(); }
            else setError(r.error || 'Failed to accept invite');
          });
        }
      }
    } else {
      setStatus('No invites found');
    }
  });
}

function doInvite() {
  if (!selectedBot.value || !inviteUsername.value || loading.value) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'faction_invite', { player_id: inviteUsername.value }, (result: any) => {
    loading.value = false;
    if (result.ok) {
      setStatus(`Invited ${inviteUsername.value}`);
      showInviteModal.value = false;
      inviteUsername.value = '';
    } else {
      setError(result.error || 'Failed to invite');
    }
  });
}

function promoteMember(member: any, role: string) {
  if (!selectedBot.value || !role || !member.player_id || loading.value) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'faction_promote', { player_id: member.player_id, role }, (result: any) => {
    loading.value = false;
    if (result.ok) { setStatus(`${member.username} promoted to ${role}`); refreshData(); }
    else setError(result.error || 'Failed to promote');
  });
}

function kickMember(member: any) {
  if (!selectedBot.value || loading.value) return;
  if (!confirm(`Kick ${member.username || 'this member'}?`)) return;
  loading.value = true;
  botStore.sendExec(selectedBot.value, 'faction_kick', { player_id: member.player_id }, (result: any) => {
    loading.value = false;
    if (result.ok) { setStatus(`Kicked ${member.username}`); refreshData(); }
    else setError(result.error || 'Failed to kick');
  });
}
</script>
