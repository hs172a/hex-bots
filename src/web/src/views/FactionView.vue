<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-2 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Faction</h3>
      </div>
      <div class="flex-1 overflow-auto p-2 scrollbar-dark">
        <div v-if="!selectedBot" class="text-[11px] text-space-text-dim italic p-2 text-center">Select a character</div>
        <!-- Quick actions -->
        <div v-if="selectedBot" class="space-y-1">
          <button @click="refreshData" :disabled="loading" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-text-dim hover:bg-space-row-hover hover:text-space-text transition-colors disabled:opacity-50">Refresh</button>
          <button v-if="!factionData" @click="showCreateModal = true" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-green hover:bg-space-row-hover transition-colors">Create Faction</button>
          <button v-if="!factionData" @click="checkInvites" :disabled="loading" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-cyan hover:bg-space-row-hover transition-colors disabled:opacity-50">Check Invites</button>
          <button v-if="factionData && isMember" @click="leaveFaction" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-red hover:bg-space-row-hover transition-colors">Leave Faction</button>
          <button _vif="!factionData" @click="loadFactionList" :disabled="loading" class="w-full text-left px-2 py-1.5 text-xs rounded-md text-space-text-dim hover:bg-space-row-hover hover:text-space-text transition-colors disabled:opacity-50">All Factions</button>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg p-2 overflow-auto scrollbar-dark">

      <div v-if="!selectedBot" class="text-space-text-dim italic text-sm py-8 text-center">
        Select a bot to view or manage its faction.
      </div>

      <!-- Error/Status -->
      <div v-if="errorMsg" class="mb-3 text-xs px-2 py-2 rounded bg-[#2d0000] text-space-red">{{ errorMsg }}</div>
      <div v-if="statusMsg" class="mb-3 text-xs px-2 py-2 rounded bg-[#0d2818] text-space-green">{{ statusMsg }}</div>

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
          <div v-for="f in factionList" :key="f.id" @click="viewFactionDetails(f.id)" class="bg-deep-bg border border-[#21262d] rounded-md p-2 mb-2 cursor-pointer hover:border-space-accent transition-colors">
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
              <div class="flex items-center gap-2 text-xs mt-1">
                <span class="px-2 py-0.5 rounded text-space-text">[{{ factionData.tag }}]</span>
                <span class="text-space-text-dim">Members: {{ factionData.member_count || 0 }}</span>
              </div>
            </div>
            <button @click="factionData = null" class="btn text-xs px-2 py-1">← Back</button>
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
              <div class="flex items-center gap-2 text-xs mt-1">
                <span class="px-2 py-0.5 rounded text-space-text">[{{ factionData.tag }}]</span>
                <span class="text-space-text-dim">Leader: {{ factionData.leader_username || factionData.leader || '-' }}</span>
              </div>
            </div>
            <button @click="refreshData" :disabled="loading" class="btn text-xs px-2 py-1">Refresh</button>
          </div>

          <p v-if="factionData.description" class="text-xs text-space-text-dim mb-3">{{ factionData.description }}</p>

          <!-- Stats row -->
          <div class="grid grid-cols-4 gap-2 text-center">
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-cyan">{{ memberCount }}</div>
              <div class="text-[11px] text-space-text-dim">Members</div>
            </div>
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-green">{{ onlineCount }}</div>
              <div class="text-[11px] text-space-text-dim">Online</div>
            </div>
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-yellow">{{ fmt(factionData.treasury ?? factionData.credits ?? 0) }}</div>
              <div class="text-[11px] text-space-text-dim">Treasury</div>
            </div>
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2">
              <div class="text-lg font-bold text-space-magenta">{{ ownFacilities.length }}</div>
              <div class="text-[11px] text-space-text-dim">Facilities</div>
            </div>
          </div>

          <!-- Treasury controls -->
          <div class="flex items-center gap-2 mt-2 pt-2 border-t border-[#21262d]">
            <span class="text-[11px] text-space-text-dim shrink-0">Treasury:</span>
            <input
              v-model.number="treasuryAmount"
              type="number" min="1" placeholder="Amount"
              class="input text-xs py-0.5 px-2 w-28"
              @keydown.enter="depositCredits"
            />
            <button @click="depositCredits" :disabled="treasuryLoading || !treasuryAmount"
              class="btn btn-secondary text-xs px-2 py-1 disabled:opacity-40">
              {{ treasuryLoading ? '⏳' : '↑ Deposit' }}
            </button>
            <button @click="withdrawCredits" :disabled="treasuryLoading || !treasuryAmount"
              class="btn text-xs px-2 py-1 disabled:opacity-40">
              {{ treasuryLoading ? '⏳' : '↓ Withdraw' }}
            </button>
          </div>
        </div>

        <!-- Horizontal section tabs -->
        <div class="flex gap-1 flex-wrap border-b border-[#21262d] mb-4 -mx-2 px-2 pb-0">
          <button v-for="sec in sections" :key="sec.id" @click="switchSection(sec.id)"
            class="px-2 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors whitespace-nowrap"
            :class="activeSection === sec.id
              ? 'border-space-accent text-space-accent bg-[rgba(88,166,255,0.08)]'
              : 'border-transparent text-space-text-dim hover:text-space-text hover:border-[#30363d]'"
          >{{ sec.label }}</button>
        </div>

        <!-- Tab: Members -->
        <div v-if="activeSection === 'members'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">Members <span class="text-space-text-dim font-normal">({{ memberCount }}, {{ onlineCount }} online)</span></h3>
            <div class="flex gap-2">
              <button @click="inviteOwnBots" :disabled="loading" class="btn btn-secondary text-xs px-2 py-1" title="Quick-invite bots from your fleet">+ Own Bots</button>
              <button @click="showInviteModal = true" class="btn text-xs px-2 py-1">Invite Player</button>
            </div>
          </div>
          <div v-if="!members.length" class="text-xs text-space-text-dim italic">No member data.</div>
          <div v-for="m in members" :key="m.player_id || m.username" class="flex items-center justify-between py-2 px-2 border-b border-[#21262d] hover:bg-space-row-hover transition-colors">
            <div class="flex items-center gap-2">
              <div class="relative w-7 h-7 bg-space-accent rounded-full flex items-center justify-center text-xs text-white font-bold shrink-0">
                {{ (m.username || '?')[0].toUpperCase() }}
                <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-space-card"
                  :class="(m.is_online ?? m.online) ? 'bg-space-green' : 'bg-[#484f58]'"
                />
              </div>
              <div>
                <div class="text-xs font-medium text-space-text">{{ m.username || m.name }}</div>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span class="text-[11px] px-1.5 py-0.5 rounded border capitalize"
                    :class="roleColorClass(m.role)">{{ m.role || 'member' }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <select v-if="m.username !== selectedBot" @change="promoteMember(m, ($event.target as HTMLSelectElement).value)" class="input text-[11px] py-0.5 px-1">
                <option value="" disabled selected>Set role…</option>
                <option v-for="r in availableRoles" :key="r" :value="r">{{ r }}</option>
              </select>
              <button v-if="m.username !== selectedBot" @click="kickMember(m)" class="text-[11px] px-2 py-0.5 rounded border border-space-border text-space-text-dim hover:border-space-red hover:text-space-red transition-colors">Kick</button>
            </div>
          </div>
        </div>

        <!-- Tab: Storage (loaded on demand) -->
        <div v-if="activeSection === 'storage'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">Faction Storage</h3>
            <button @click="loadStorage" :disabled="loading" class="btn text-xs px-2 py-1">{{ storageLoaded ? 'Reload' : 'Load Storage' }}</button>
          </div>
          <div v-if="!storageLoaded" class="text-xs text-space-text-dim italic py-4 text-center">Click "Load Storage" to view items (bot must be docked at a faction storage facility).</div>
          <div v-else-if="storageError" class="text-xs text-space-red px-2 py-2">{{ storageError }}</div>
          <div v-else-if="!factionStorage.length" class="text-xs text-space-text-dim italic py-4 text-center">Storage is empty.</div>
          <div v-else>
            <div v-for="(items, category) in storageByCategory" :key="category" class="mb-4">
              <h4 class="text-[11px] font-semibold uppercase tracking-wider text-space-text-dim mb-1.5">{{ category }}</h4>
              <div class="grid grid-cols-2 gap-1">
                <div v-for="item in items" :key="item.item_id || item.name"
                  class="flex items-center justify-between py-1.5 px-2 rounded bg-deep-bg hover:bg-space-row-hover transition-colors">
                  <span class="text-xs text-space-text truncate">{{ item.name || item.item_id }}</span>
                  <span class="text-xs font-mono ml-2 shrink-0" :class="CATEGORY_COLORS[category] || 'text-space-text-dim'">{{ fmt(item.quantity) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: Buildings / Facilities -->
        <div v-if="activeSection === 'buildings'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">Faction Infrastructure</h3>
            <button @click="loadFacilities" :disabled="loading" class="btn text-xs px-2 py-1">Refresh</button>
          </div>

          <!-- Existing facilities -->
          <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Active Facilities</h4>
          <div v-if="ownFacilities.length > 0" class="grid grid-cols-5 gap-2">
            <div v-for="f in ownFacilities" :key="f.facility_id"
              class="bg-deep-bg border border-[#21262d] rounded-md p-2 mb-2 text-xs"
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
                  <div v-if="f.system_name || f.systemName" class="text-[11px] text-space-text-dim">📍 {{ f.system_name || f.systemName }}</div>
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
          <div v-if="allBuildableTypes.length > 0" class="grid grid-cols-5 gap-2">
            <div v-for="bt in allBuildableTypes" :key="bt.id"
              class="bg-deep-bg border border-[#21262d] rounded-md p-2 mb-2 text-xs transition-opacity"
              :class="[!bt.buildable && !hasFacility(bt.id) ? 'opacity-50' : '', !bt.buildable && hasFacility(bt.id) ? 'border-green-900/30' : '']">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-medium" :class="!bt.buildable && hasFacility(bt.id) ? 'text-space-green' : 'text-space-text'">{{ bt.name }}</span>
                    <span v-if="bt.level" class="text-[11px] text-space-text-dim">Lv{{ bt.level }}</span>
                    <span v-if="!bt.buildable && hasFacility(bt.id)" class="text-[11px] px-1 py-0.5 rounded bg-green-900/30 text-space-green">✓ built</span>
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
                    :disabled="!bt.buildable || factionActionLoading === bt.id"
                    class="btn text-[11px] px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    :class="bt.buildable ? 'btn-primary' : 'btn-secondary'">
                    {{ factionActionLoading === bt.id ? '...' : bt.buildable ? '🔨 Build' : hasFacility(bt.id) ? '✓ Built' : '🔒 Locked' }}
                  </button>
                  <div v-if="factionBuildErrors[bt.id]" class="text-[11px] text-red-400 mt-1">⚠ {{ factionBuildErrors[bt.id] }}</div>
                </div>
              </div>
              <!-- Build materials -->
              <div v-if="(factionTypeCache[bt.id]?.build_materials || bt.build_materials)?.length"
                class="mt-1.5 pt-1.5 border-t border-[#30363d] flex items-end justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-[11px] text-space-text-dim uppercase tracking-wider mb-0.5">Materials required</div>
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    <span v-for="m in (factionTypeCache[bt.id]?.build_materials || bt.build_materials)" :key="m.item_id"
                      :class="hasMaterial(m.item_id, m.quantity) ? 'text-space-green' : 'text-red-400'">
                      {{ hasMaterial(m.item_id, m.quantity) ? '✓' : '✗' }} {{ m.name || m.item_id }} ×{{ m.quantity }}
                    </span>
                  </div>
                </div>
                <div class="shrink-0 flex flex-col items-end gap-1">
                  <span v-if="currentGatherGoal?.target_id === bt.id" class="text-[11px] text-space-cyan flex items-center gap-1">
                    ⚙️ Gathering
                    <button @click="clearGatherGoal()" class="text-space-red hover:text-red-400" title="Cancel">✕</button>
                  </span>
                  <button v-else-if="bt.buildable" @click="gatherFacilityMaterials(bt)"
                    class="btn btn-secondary text-[11px] px-2 py-0.5 whitespace-nowrap">📦 Gather</button>
                </div>
              </div>
              <div v-else-if="!factionTypeCache[bt.id]" class="mt-1 text-[11px] text-space-text-dim/40 italic cursor-pointer hover:text-space-text-dim" @click="loadFacilityDetail(bt.id)">
                Click to load details
              </div>
            </div>
          </div>

          <!-- Facility Detail Modal -->
          <Teleport to="body">
          <div v-if="facilityDetail" class="fixed inset-0 bg-black/30 flex items-center justify-center z-50" @click.self="facilityDetail = null">
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
                  <div v-for="mat in facilityDetail.build_materials" :key="mat.item_id"
                  :class="hasMaterial(mat.item_id, mat.quantity) ? 'text-space-green' : 'text-red-400'">
                {{ hasMaterial(mat.item_id, mat.quantity) ? '✓' : '✗' }} {{ mat.quantity }}x {{ mat.name || mat.item_id }}
              </div>
                </div>
                <div v-if="facilityDetail.build_cost" class="px-2 py-1.5 bg-[#0d2818] rounded text-space-green">Cost: {{ formatBuildCost(facilityDetail.build_cost) }}</div>
                <div v-if="facilityDetail.rent_per_cycle" class="px-2 py-1.5 bg-[#2d1500] rounded text-space-yellow">Rent: {{ facilityDetail.rent_per_cycle }} cr/cycle</div>
                <div v-if="facilityDetail.build_time" class="text-space-text-dim">Build time: {{ facilityDetail.build_time }} cycles</div>
                <div v-if="facilityDetail.hint" class="px-2 py-1.5 bg-[#0d2233] border border-[#1a3a5a] rounded text-space-accent">{{ facilityDetail.hint }}</div>
              </div>
              <div class="flex gap-2 mt-4 flex-wrap">
                <button @click="buildFacility(facilityDetail.id, facilityDetail.name); facilityDetail = null"
                  :disabled="loading || facilityDetail.buildable === false"
                  class="btn btn-primary flex-1 text-xs">
                  {{ facilityDetail.buildable === false ? (hasFacility(facilityDetail.id) ? 'Already Built' : 'Locked') : 'Build Now' }}
                </button>
                <button
                  v-if="facilityDetail.buildable !== false && facilityDetail.build_materials?.length && currentGatherGoal?.target_id !== facilityDetail.id"
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
          </Teleport>
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

        <!-- Tab: All Faction Storages (global DB view) -->
        <div v-if="activeSection === 'allstorages'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-space-text-bright">All Faction Storages <span class="text-space-text-dim font-normal text-xs">({{ filteredAllStorageItems.length }} items)</span></h3>
            <button @click="fetchAllStorages" :disabled="botStore.factionStorageLoading" class="btn text-xs px-2 py-1">{{ botStore.factionStorageLoading ? '⏳' : '🔄 Refresh' }}</button>
          </div>

          <!-- Filters -->
          <div class="flex flex-wrap gap-2 mb-3">
            <input v-model="allStorageNameFilter" type="text" placeholder="Filter by name..." class="input text-xs py-0.5 px-2 flex-1 min-w-[120px]" />
            <select v-model="allStorageTypeFilter" class="input text-xs py-0.5 px-2">
              <option value="">All types</option>
              <option value="ore">Ores</option>
              <option value="refined">Refined</option>
              <option value="component">Components</option>
              <option value="module">Modules</option>
              <option value="other">Other</option>
            </select>
            <select v-model="allStorageSystemFilter" class="input text-xs py-0.5 px-2 flex-1 min-w-[120px]">
              <option value="">All systems</option>
              <option v-for="sys in allStorageSystems" :key="sys" :value="sys">{{ sys }}</option>
            </select>
          </div>

          <div v-if="botStore.factionStorageItems.length === 0" class="text-xs text-space-text-dim italic py-4 text-center">No data yet — bots must view faction storage first.</div>
          <div v-else-if="filteredAllStorageItems.length === 0" class="text-xs text-space-text-dim italic py-4 text-center">No items match current filters.</div>
          <div v-else>
            <!-- Grouped by system + poi -->
            <div v-for="(group, key) in allStorageGrouped" :key="key" class="mb-4">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="text-[11px] font-semibold text-space-accent">📍 {{ group.system_name }}</span>
                <span class="text-[11px] text-space-text-dim">/</span>
                <span class="text-[11px] text-space-text-dim">{{ group.poi_name }}</span>
                <span class="text-[11px] text-space-text-dim/60 ml-auto">{{ timeAgoShort(group.updated_at) }}</span>
              </div>
              <div class="grid grid-cols-2 gap-1">
                <div v-for="item in group.items" :key="item.item_id"
                  class="flex items-center justify-between py-1 px-2 rounded bg-deep-bg hover:bg-space-row-hover transition-colors">
                  <span class="text-xs text-space-text truncate">{{ item.item_name || item.item_id }}</span>
                  <span class="text-xs font-mono ml-2 shrink-0" :class="itemTypeColor(item.item_id)">{{ fmt(item.quantity) }}</span>
                </div>
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

        <!-- Tab: Missions -->
        <div v-if="activeSection === 'missions'">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-space-text-bright">Faction Missions</h3>
            <div class="flex gap-2">
              <button @click="loadFactionMissions" :disabled="missionsLoading" class="btn btn-secondary text-xs px-2">{{ missionsLoading ? '⏳' : '🔄 Refresh' }}</button>
              <button @click="showPostMissionModal = true" class="btn btn-primary text-xs px-2">+ Post Mission</button>
            </div>
          </div>

          <div v-if="!missionsLoaded" class="text-xs text-space-text-dim italic text-center py-6">Click Refresh to load posted missions.</div>
          <div v-else-if="factionMissions.length === 0" class="text-xs text-space-text-dim italic text-center py-6">No missions posted by this faction.</div>
          <div v-else class="space-y-2">
            <div v-for="m in factionMissions" :key="m.id || m.mission_id"
              class="bg-deep-bg border border-[#21262d] rounded-md p-2 hover:border-space-accent/30 transition-colors">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-space-text-bright">{{ m.title || m.name }}</span>
                    <span class="px-1.5 py-0.5 text-[11px] rounded bg-[#21262d] text-space-cyan">{{ m.type || 'unknown' }}</span>
                    <span v-if="m.difficulty" class="text-[11px] text-space-text-dim">Diff {{ m.difficulty }}</span>
                  </div>
                  <div v-if="m.description" class="text-xs text-space-text-dim mt-1 line-clamp-2">{{ m.description }}</div>
                  <div class="flex items-center gap-2 mt-1.5 text-[11px]">
                    <span v-if="m.reward_credits || m.reward?.credits" class="text-space-yellow">💰 {{ fmt(m.reward_credits || m.reward?.credits || 0) }} cr</span>
                    <span v-if="m.expires_at" class="text-space-text-dim">⏱ Expires {{ formatDate(m.expires_at) }}</span>
                    <span v-if="m.accepted_count !== undefined" class="text-space-text-dim">{{ m.accepted_count }} accepted</span>
                  </div>
                </div>
                <button @click="cancelFactionMission(m)" :disabled="missionCancellingId === (m.id || m.mission_id)"
                  class="btn text-[11px] px-2 py-0.5 bg-red-900/40 text-red-300 hover:bg-red-900/70 border-red-700/40 shrink-0">
                  {{ missionCancellingId === (m.id || m.mission_id) ? '⏳' : '✕ Cancel' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Post Mission Modal -->
          <Teleport to="body">
            <Transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0" enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-150" leave-from-class="opacity-100" leave-to-class="opacity-0">
              <div v-if="showPostMissionModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="showPostMissionModal = false">
                <div class="bg-[#0d1117] border border-space-border rounded-lg shadow-2xl w-full max-w-lg mx-4 p-5 overflow-auto max-h-[90vh]">
                  <div class="flex items-center justify-between mb-4">
                    <h3 class="text-sm font-semibold text-space-text-bright">Post Faction Mission</h3>
                    <button @click="showPostMissionModal = false" class="text-space-text-dim hover:text-space-text-bright">×</button>
                  </div>
                  <div class="space-y-3">
                    <div>
                      <label class="text-xs text-space-text-dim block mb-1">Title *</label>
                      <input v-model="newMission.title" type="text" placeholder="Mission title" class="input text-sm w-full" />
                    </div>
                    <div>
                      <label class="text-xs text-space-text-dim block mb-1">Description</label>
                      <textarea v-model="newMission.description" rows="3" placeholder="Mission briefing…" class="input text-sm w-full resize-none"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <div>
                        <label class="text-xs text-space-text-dim block mb-1">Type</label>
                        <select v-model="newMission.type" class="input text-sm w-full">
                          <option value="delivery">Delivery</option>
                          <option value="mining">Mining</option>
                          <option value="combat">Combat</option>
                          <option value="exploration">Exploration</option>
                          <option value="trading">Trading</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label class="text-xs text-space-text-dim block mb-1">Reward (credits)</label>
                        <input v-model.number="newMission.reward_credits" type="number" min="0" placeholder="0" class="input text-sm w-full" />
                      </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <div>
                        <label class="text-xs text-space-text-dim block mb-1">Min Level</label>
                        <input v-model.number="newMission.min_level" type="number" min="0" placeholder="0" class="input text-sm w-full" />
                      </div>
                      <div>
                        <label class="text-xs text-space-text-dim block mb-1">Expires (hours)</label>
                        <input v-model.number="newMission.expires_hours" type="number" min="1" max="168" placeholder="24" class="input text-sm w-full" />
                      </div>
                    </div>
                  </div>
                  <div class="flex justify-end gap-2 mt-4">
                    <button @click="showPostMissionModal = false" class="btn btn-secondary text-xs px-4">Cancel</button>
                    <button @click="doPostMission" :disabled="!newMission.title || postingMission" class="btn btn-primary text-xs px-4">
                      {{ postingMission ? '⏳ Posting…' : '📋 Post Mission' }}
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </Teleport>
        </div>

        <!-- Tab: Trade Intel -->
        <div v-if="activeSection === 'intel'">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-space-text-bright">Trade Intelligence</h3>
            <button @click="loadIntelStatus" :disabled="intelLoading" class="btn btn-secondary text-xs px-2">{{ intelLoading ? '⏳' : '🔄 Refresh' }}</button>
          </div>

          <!-- Coverage stats -->
          <div v-if="intelStatus" class="grid grid-cols-3 gap-2 mb-4">
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2 text-center">
              <div class="text-xl font-bold text-space-cyan">{{ intelStatus.systems_covered ?? '—' }}</div>
              <div class="text-[11px] text-space-text-dim">Systems Covered</div>
            </div>
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2 text-center">
              <div class="text-xl font-bold text-space-yellow">{{ intelStatus.total_reports ?? '—' }}</div>
              <div class="text-[11px] text-space-text-dim">Reports</div>
            </div>
            <div class="bg-deep-bg border border-[#21262d] rounded-md p-2 text-center">
              <div class="text-xl font-bold text-space-green">{{ intelStatus.freshness_score ?? '—' }}</div>
              <div class="text-[11px] text-space-text-dim">Freshness</div>
            </div>
          </div>

          <!-- Query intel -->
          <div class="card py-2 px-2 mb-3">
            <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Query Intel</h4>
            <div class="flex gap-2">
              <input v-model="intelQuery" type="text" placeholder="Item ID or system ID…" class="input text-xs flex-1" @keydown.enter="queryIntel" />
              <button @click="queryIntel" :disabled="intelLoading || !intelQuery.trim()" class="btn btn-primary text-xs px-2">Search</button>
            </div>
            <div v-if="intelResults.length > 0" class="mt-3 space-y-1">
              <div v-for="(r, i) in intelResults" :key="i"
                class="flex items-center justify-between px-2 py-1.5 bg-deep-bg border border-[#21262d] rounded text-xs">
                <div>
                  <span class="text-space-text-bright">{{ r.item_name || r.item_id }}</span>
                  <span class="text-space-text-dim ml-2">@ {{ r.station_name || r.base_name || r.location }}</span>
                </div>
                <div class="flex gap-2 shrink-0">
                  <span v-if="r.buy_price" class="text-space-cyan">Buy: {{ fmt(r.buy_price) }}</span>
                  <span v-if="r.sell_price" class="text-space-yellow">Sell: {{ fmt(r.sell_price) }}</span>
                  <span v-if="r.timestamp" class="text-space-text-dim">{{ formatDate(r.timestamp) }}</span>
                </div>
              </div>
            </div>
            <div v-else-if="intelQueried" class="text-xs text-space-text-dim italic mt-2">No results found.</div>
          </div>

          <!-- Submit intel -->
          <div class="card py-2 px-2">
            <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Submit Market Observation</h4>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[11px] text-space-text-dim block mb-1">Item ID</label>
                <input v-model="submitIntel.item_id" type="text" placeholder="iron_ore" class="input text-xs w-full" />
              </div>
              <div>
                <label class="text-[11px] text-space-text-dim block mb-1">System ID</label>
                <input v-model="submitIntel.system_id" type="text" placeholder="sol_star" class="input text-xs w-full" />
              </div>
              <div>
                <label class="text-[11px] text-space-text-dim block mb-1">Buy Price</label>
                <input v-model.number="submitIntel.buy_price" type="number" min="0" placeholder="0" class="input text-xs w-full" />
              </div>
              <div>
                <label class="text-[11px] text-space-text-dim block mb-1">Sell Price</label>
                <input v-model.number="submitIntel.sell_price" type="number" min="0" placeholder="0" class="input text-xs w-full" />
              </div>
            </div>
            <div class="flex justify-end mt-2">
              <button @click="doSubmitIntel" :disabled="!submitIntel.item_id || submittingIntel" class="btn btn-primary text-xs px-4">
                {{ submittingIntel ? '⏳' : '📡 Submit' }}
              </button>
            </div>
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
import { ref, computed, watch, onMounted } from 'vue';
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

function getBotGoalsForUser(username: string): any[] {
  const s = (botStore.settings as any)?.[username] || {};
  if (s.goals?.length) return s.goals;
  if (s.goal) return [s.goal];
  return [];
}
const currentGatherGoals = computed(() =>
  selectedBot.value ? getBotGoalsForUser(selectedBot.value) : []
);
const currentGatherGoal = computed(() => currentGatherGoals.value[0] ?? null);

// Modals
const showCreateModal = ref(false);
const showInviteModal = ref(false);
const createName = ref('');
const createTag = ref('');
const createDesc = ref('');
const inviteUsername = ref('');

// Treasury deposit/withdraw
const treasuryAmount = ref(0);
const treasuryLoading = ref(false);

// ── All Faction Storages (global DB view) ─────────────────────
const allStorageNameFilter = ref('');
const allStorageTypeFilter = ref('');
const allStorageSystemFilter = ref('');

async function fetchAllStorages() {
  await botStore.fetchFactionStorage();
}

// Auto-load when switching to the All Storages tab
watch(activeSection, (sec) => {
  if (sec === 'allstorages' && botStore.factionStorageItems.length === 0) {
    fetchAllStorages();
  }
});

// Pre-load on mount so data is ready if user opens the tab
onMounted(() => {
  botStore.fetchFactionStorage();
  // Auto-sync: if a bot was selected via profile, pre-select it here
  if (botStore.selectedBot && !selectedBot.value) selectBot(botStore.selectedBot);
});
// Keep in sync when user opens a profile while this tab is visible
watch(() => botStore.selectedBot, (username) => {
  if (username && username !== selectedBot.value) selectBot(username);
});

const allStorageSystems = computed(() => {
  const names = new Set(botStore.factionStorageItems.map(i => i.system_name).filter(Boolean));
  return [...names].sort();
});

function itemTypeClass(itemId: string): string {
  if (itemId.startsWith('ore_')) return 'ore';
  if (itemId.startsWith('refined_')) return 'refined';
  if (itemId.startsWith('component_')) return 'component';
  if (itemId.startsWith('module_') || itemId.startsWith('ship_')) return 'module';
  return 'other';
}

function itemTypeColor(itemId: string): string {
  const t = itemTypeClass(itemId);
  if (t === 'ore') return 'text-space-yellow';
  if (t === 'refined') return 'text-space-cyan';
  if (t === 'component') return 'text-space-green';
  if (t === 'module') return 'text-space-accent';
  return 'text-space-text';
}

const filteredAllStorageItems = computed(() => {
  let items = botStore.factionStorageItems;
  const nameF = allStorageNameFilter.value.toLowerCase().trim();
  const typeF = allStorageTypeFilter.value;
  const sysF = allStorageSystemFilter.value;
  if (nameF) items = items.filter(i => (i.item_name || i.item_id).toLowerCase().includes(nameF));
  if (typeF) items = items.filter(i => itemTypeClass(i.item_id) === typeF);
  if (sysF) items = items.filter(i => i.system_name === sysF);
  return items;
});

const allStorageGrouped = computed(() => {
  const groups: Record<string, { poi_id: string; poi_name: string; system_id: string; system_name: string; updated_at: string; items: typeof filteredAllStorageItems.value }> = {};
  for (const item of filteredAllStorageItems.value) {
    const key = item.poi_id;
    if (!groups[key]) {
      groups[key] = { poi_id: item.poi_id, poi_name: item.poi_name, system_id: item.system_id, system_name: item.system_name, updated_at: item.updated_at, items: [] };
    }
    groups[key].items.push(item);
    if (item.updated_at > groups[key].updated_at) groups[key].updated_at = item.updated_at;
  }
  return groups;
});

function timeAgoShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const sections = [
  { id: 'members', label: ' Members' },
  { id: 'storage', label: ' Storage' },
  { id: 'allstorages', label: '🗄️ All Storages' },
  { id: 'buildings', label: '🏠 Buildings' },
  { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'missions', label: '📋 Missions' },
  { id: 'intel', label: '📡 Intel' },
  { id: 'activity', label: '📜 Activity' },
];

// ── Faction Missions ─────────────────────────────────────────
const factionMissions = ref<any[]>([]);
const missionsLoading = ref(false);
const missionsLoaded = ref(false);
const missionCancellingId = ref<string | null>(null);
const showPostMissionModal = ref(false);
const postingMission = ref(false);
const newMission = ref({ title: '', description: '', type: 'delivery', reward_credits: 0, min_level: 0, expires_hours: 24 });

async function loadFactionMissions() {
  missionsLoading.value = true;
  const r = await execAsync('faction_list_missions');
  missionsLoading.value = false;
  missionsLoaded.value = true;
  if (r.ok && r.data) {
    const d = r.data as any;
    factionMissions.value = Array.isArray(d) ? d : (Array.isArray(d.missions) ? d.missions : []);
  }
}

async function doPostMission() {
  if (!newMission.value.title) return;
  postingMission.value = true;
  const r = await execAsync('faction_post_mission', {
    title: newMission.value.title,
    description: newMission.value.description,
    type: newMission.value.type,
    reward_credits: newMission.value.reward_credits,
    min_level: newMission.value.min_level,
    expires_hours: newMission.value.expires_hours,
  });
  postingMission.value = false;
  if (r.ok) {
    showPostMissionModal.value = false;
    newMission.value = { title: '', description: '', type: 'delivery', reward_credits: 0, min_level: 0, expires_hours: 24 };
    setStatus('Mission posted successfully');
    await loadFactionMissions();
  } else {
    setError(r.error || 'Failed to post mission');
  }
}

async function cancelFactionMission(m: any) {
  const id = m.id || m.mission_id;
  missionCancellingId.value = id;
  const r = await execAsync('faction_cancel_mission', { mission_id: id });
  missionCancellingId.value = null;
  if (r.ok) {
    factionMissions.value = factionMissions.value.filter(x => (x.id || x.mission_id) !== id);
    setStatus('Mission cancelled');
  } else {
    setError(r.error || 'Failed to cancel mission');
  }
}

// ── Trade Intel ──────────────────────────────────────────────
const intelStatus = ref<any>(null);
const intelLoading = ref(false);
const intelQuery = ref('');
const intelResults = ref<any[]>([]);
const intelQueried = ref(false);
const submittingIntel = ref(false);
const submitIntel = ref({ item_id: '', system_id: '', buy_price: 0, sell_price: 0 });

async function loadIntelStatus() {
  intelLoading.value = true;
  const r = await execAsync('faction_trade_intel_status');
  intelLoading.value = false;
  if (r.ok && r.data) intelStatus.value = r.data;
}

async function queryIntel() {
  const q = intelQuery.value.trim();
  if (!q) return;
  intelLoading.value = true;
  intelQueried.value = false;
  const r = await execAsync('faction_query_trade_intel', { query: q });
  intelLoading.value = false;
  intelQueried.value = true;
  if (r.ok && r.data) {
    const d = r.data as any;
    intelResults.value = Array.isArray(d) ? d : (Array.isArray(d.results) ? d.results : d.intel ? [d.intel] : []);
  } else {
    intelResults.value = [];
  }
}

async function doSubmitIntel() {
  if (!submitIntel.value.item_id) return;
  submittingIntel.value = true;
  const r = await execAsync('faction_submit_trade_intel', { ...submitIntel.value });
  submittingIntel.value = false;
  if (r.ok) {
    setStatus('Trade intel submitted');
    submitIntel.value = { item_id: '', system_id: '', buy_price: 0, sell_price: 0 };
  } else {
    setError(r.error || 'Failed to submit intel');
  }
}

function formatDate(ts: string | number | undefined): string {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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

const selectedBotObj = computed(() => botStore.bots.find(b => b.username === selectedBot.value));

function hasMaterial(itemId: string, qty: number): boolean {
  const bot = selectedBotObj.value as any;
  if (!bot) return false;
  const inv  = (bot.inventory      || []).find((i: any) => i.itemId === itemId || i.item_id === itemId);
  const stor = (bot.storage        || []).find((i: any) => i.itemId === itemId || i.item_id === itemId);
  const fac  = (bot.factionStorage || []).find((i: any) => i.itemId === itemId || i.item_id === itemId);
  return ((inv?.quantity ?? 0) + (stor?.quantity ?? 0) + (fac?.quantity ?? 0)) >= qty;
}

// Computed
const members = computed(() => {
  const raw: any[] = factionData.value?.members || [];
  return [...raw].sort((a, b) => {
    const aOn = a.is_online ?? a.online ?? false;
    const bOn = b.is_online ?? b.online ?? false;
    return (bOn ? 1 : 0) - (aOn ? 1 : 0);
  });
});
const memberCount = computed(() => factionData.value?.member_count ?? members.value.length);
const onlineCount = computed(() => members.value.filter((m: any) => (m.is_online ?? m.online)).length);

// Derive promotable roles from API (available_roles field) or from unique member roles as fallback.
const availableRoles = computed<string[]>(() => {
  const apiRoles = factionData.value?.available_roles as string[] | undefined;
  if (Array.isArray(apiRoles) && apiRoles.length) return apiRoles;
  const fromMembers = [...new Set<string>(members.value.map((m: any) => m.role).filter(Boolean))];
  return fromMembers.length ? fromMembers : ['recruit', 'member', 'officer', 'leader'];
});

function roleColorClass(role?: string): string {
  const r = (role || '').toLowerCase();
  if (r === 'leader') return 'bg-yellow-900/30 text-yellow-400 border-yellow-700/30';
  if (r === 'officer') return 'bg-blue-900/30 text-blue-400 border-blue-700/30';
  return 'bg-[#30363d] text-space-text-dim border-transparent';
}

/** Storage items grouped by category, sorted by quantity desc. */
const storageByCategory = computed(() => {
  const items: any[] = factionStorage.value;
  const cats: Record<string, any[]> = {};
  for (const item of items) {
    const id: string = item.item_id || item.itemId || '';
    const cat = id.startsWith('ore_') ? 'Ores'
      : id.startsWith('refined_') ? 'Refined'
      : id.startsWith('component_') ? 'Components'
      : id.startsWith('module_') ? 'Modules'
      : 'Other';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(item);
  }
  for (const cat of Object.keys(cats)) {
    cats[cat].sort((a, b) => b.quantity - a.quantity);
  }
  return cats;
});

const CATEGORY_COLORS: Record<string, string> = {
  Ores: 'text-orange-400',
  Refined: 'text-space-cyan',
  Components: 'text-space-magenta',
  Modules: 'text-space-accent',
  Other: 'text-space-text-dim',
};

/** Only the facilities that belong to the current bot's faction. */
const ownFacilities = computed(() => {
  const botFactionId = (selectedBotObj.value as any)?.factionId;
  if (!botFactionId || factionFacilities.value.length === 0) return factionFacilities.value;
  const own = factionFacilities.value.filter((f: any) => f.faction_id === botFactionId);
  return own.length > 0 ? own : factionFacilities.value;
});

/** All buildable types — shown with status badges (built / locked / available). */
const allBuildableTypes = computed(() => buildableTypes.value);

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
      // Membership: own faction always has an id + members array defined (even if empty)
      isMember.value = !!(result.data.id && result.data.members !== undefined);
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
  const botStatus = botStore.bots.find(b => b.username === selectedBot.value) as any;
  if (!botStatus?.poi || !botStatus?.system) {
    setStatus('⚠ Bot must be docked at the target station to set a Build goal');
    return;
  }
  const newGoal = {
    id: `faction_${typeId}_${Date.now()}`,
    target_id: typeId,
    target_name: typeName,
    goal_type: 'build',
    target_poi: botStatus.poi,
    target_system: botStatus.system,
    materials: mats.map((m: any) => ({
      item_id: m.item_id,
      item_name: m.name || m.item_name,
      quantity_needed: m.quantity,
    })),
  };
  const existing = getBotGoalsForUser(selectedBot.value);
  botStore.saveSettings(selectedBot.value, { goals: [...existing, newGoal], goal: null });
  setStatus(`📦 Gather goal added: ${typeName} @ ${botStatus.poi}`);
}

function clearGatherGoal(goalId?: string) {
  if (!selectedBot.value) return;
  if (goalId) {
    const filtered = getBotGoalsForUser(selectedBot.value).filter((g: any) => g.id !== goalId);
    botStore.saveSettings(selectedBot.value, { goals: filtered, goal: null });
  } else {
    botStore.saveSettings(selectedBot.value, { goals: [], goal: null });
  }
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
  return ownFacilities.value.some((f: any) => (f.facility_type ?? f.type) === facilityTypeId);
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

async function depositCredits() {
  const amount = treasuryAmount.value;
  if (!amount || amount <= 0) return;
  treasuryLoading.value = true;
  const r = await execAsync('faction_deposit_credits', { amount });
  treasuryLoading.value = false;
  if (r.ok) {
    setStatus(`Deposited ${fmt(amount)} cr to treasury`);
    treasuryAmount.value = 0;
    refreshData();
  } else {
    setError(r.error || 'Deposit failed');
  }
}

async function withdrawCredits() {
  const amount = treasuryAmount.value;
  if (!amount || amount <= 0) return;
  treasuryLoading.value = true;
  const r = await execAsync('faction_withdraw_credits', { amount });
  treasuryLoading.value = false;
  if (r.ok) {
    setStatus(`Withdrew ${fmt(amount)} cr from treasury`);
    treasuryAmount.value = 0;
    refreshData();
  } else {
    setError(r.error || 'Withdraw failed');
  }
}

async function inviteOwnBots() {
  const currentMembers = new Set(
    (factionData.value?.members || []).map((m: any) => m.username)
  );
  const ownBots = botStore.bots
    .map(b => b.username)
    .filter(u => u !== selectedBot.value && !currentMembers.has(u));
  if (ownBots.length === 0) { setStatus('All your bots are already members'); return; }
  for (const username of ownBots) {
    const r = await execAsync('faction_invite', { player_id: username });
    if (!r.ok && !r.error?.includes('already')) {
      setError(`Could not invite ${username}: ${r.error || 'unknown error'}`);
    }
  }
  setStatus(`Sent invites to: ${ownBots.join(', ')}`);
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
  const role_id = role.toLowerCase();
  botStore.sendExec(selectedBot.value, 'faction_promote', { player_id: member.player_id, role_id }, (result: any) => {
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
