<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">

    <!-- Main Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden">

      <!-- Empty state -->
      <div v-if="!selectedBot" class="flex items-center justify-center flex-1 text-space-text-dim text-sm italic">
        Select a bot to view missions
      </div>

      <template v-else>
        <!-- Top bar: bot status + actions -->
        <div class="flex items-center gap-3 px-3 py-2 border-b border-space-border flex-shrink-0">
          <span class="text-sm font-semibold text-space-text-bright">{{ selectedBot }}</span>
          <span v-if="isDocked" class="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/25">⚓ Docked</span>
          <span v-else class="text-[11px] px-1.5 py-0.5 rounded bg-[#161b22] text-space-text-dim border border-space-border">🚀 In Space</span>
          <span class="text-xs text-space-text-dim">Active: <b class="text-space-text">{{ activeMissions.length }}/5</b></span>
          <span v-if="readyCount > 0" class="text-xs text-green-400 font-semibold animate-pulse">● {{ readyCount }} ready</span>

          <!-- Manual target indicator -->
          <div v-if="manualMissionId" class="flex items-center gap-1.5 text-xs">
            <span class="text-[11px] text-space-text-dim">🎯 Target:</span>
            <span class="text-[11px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-700/40 font-medium max-w-[160px] truncate" :title="manualMissionTitle">{{ manualMissionTitle }}</span>
            <button @click="clearManualMission" class="text-[10px] text-space-text-dim hover:text-red-400 transition-colors" title="Clear manual target">✕</button>
          </div>

          <!-- Filters inline -->
          <div class="flex items-center gap-2 ml-auto">
            <select v-model="typeFilter"
              class="text-xs bg-[#0d1117] border border-space-border rounded px-2 py-1 text-space-text focus:outline-none focus:border-space-accent">
              <option value="all">All Types</option>
              <option v-for="t in allTypes" :key="t" :value="t">{{ typeConfig(t).icon }} {{ t }}</option>
            </select>
            <select v-model="diffFilter"
              class="text-xs bg-[#0d1117] border border-space-border rounded px-2 py-1 text-space-text focus:outline-none focus:border-space-accent">
              <option value="all">All Difficulties</option>
              <option value="1">Easy</option>
              <option value="2">Medium</option>
              <option value="3">Hard</option>
              <option value="4">Very Hard</option>
              <option value="5">Extreme</option>
            </select>
            <button v-if="typeFilter !== 'all' || diffFilter !== 'all'"
              @click="typeFilter = 'all'; diffFilter = 'all'"
              class="text-[11px] px-2 py-1 rounded border border-space-border text-space-text-dim hover:text-red-400 hover:border-red-700 transition-colors">✕</button>
            <button @click="refresh" :disabled="loading"
              class="text-xs px-3 py-1 rounded border border-space-border text-space-text hover:border-space-accent hover:text-space-accent transition-colors disabled:opacity-40">
              <span :class="loading ? 'animate-spin inline-block' : ''">🔄</span>
            </button>
          </div>
        </div>

        <!-- Tab bar -->
        <div class="flex border-b border-space-border flex-shrink-0 bg-[#0d1117]/40">
          <button
            v-for="tab in missionTabs"
            :key="tab.id"
            @click="switchMissionTab(tab.id)"
            class="flex items-center gap-2 px-5 py-2.5 text-xs font-medium border-b-2 transition-all"
            :class="missionTab === tab.id
              ? 'text-space-accent border-space-accent'
              : 'text-space-text-dim border-transparent hover:text-space-text hover:border-space-border'"
          >
            {{ tab.label }}
            <span
              class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
              :class="missionTab === tab.id ? 'bg-space-accent/20 text-space-accent' : 'bg-[#21262d] text-space-text-dim'"
            >{{ tab.count.value }}</span>
            <span v-if="tab.id === 'active' && readyCount > 0"
              class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          </button>
        </div>

        <!-- Tab content -->
        <div class="flex-1 overflow-auto p-2.5 scrollbar-dark">

          <!-- ═══ ACTIVE MISSIONS ═══ -->
          <div v-if="missionTab === 'active'">
            <div v-if="loading" class="text-xs text-space-text-dim italic py-8 text-center">Loading…</div>
            <div v-else-if="filteredActive.length === 0"
              class="text-xs text-space-text-dim italic py-6 text-center bg-[#0d1117] rounded-lg">
              {{ activeMissions.length === 0 ? 'No active missions' : 'No missions match the filter' }}
            </div>
            <div v-else class="grid grid-cols-4 gap-2.5">
              <div
                v-for="m in filteredActive"
                :key="m.mission_id || m.id"
                class="flex flex-col rounded-lg border transition-colors"
                :class="(m.id === manualMissionId || m.mission_id === manualMissionId) && manualMissionId
                  ? 'bg-blue-950/20 border-blue-600/50 hover:border-blue-500/70'
                  : m.is_complete
                    ? 'bg-green-950/15 border-green-800/30 hover:border-green-700/50'
                    : 'bg-orange-950/20 border-orange-800/40 hover:border-[#30363d]'"
              >
                <!-- Card header -->
                <div class="flex items-start justify-between gap-2 p-3 pb-2">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span class="text-sm leading-none">{{ typeConfig(m.type || '').icon }}</span>
                      <span class="text-sm font-semibold text-space-text-bright leading-tight">{{ m.title || m.mission_id || m.id }}</span>
                      <span v-if="m.is_complete" class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-bold border border-green-600/30">✓ READY</span>
                    </div>
                    <div v-if="m.giver_name" class="text-[11px] text-space-text-dim">
                      {{ m.giver_name }}<span v-if="m.giver_title" class="opacity-50"> • {{ m.giver_title }}</span>
                    </div>
                  </div>
                  <div class="flex flex-col items-end gap-1 flex-shrink-0">
                    <span v-if="m.difficulty != null" class="text-[10px] px-1.5 py-0.5 rounded font-bold" :class="getDifficultyClass(m.difficulty)">
                      {{ getDifficultyText(m.difficulty) }}
                    </span>
                    <span v-if="m.type" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="typeConfig(m.type).bg">{{ m.type }}</span>
                    <span v-if="m.time_remaining" class="text-[10px] text-orange-400">⏱ {{ fmtSecs(m.time_remaining) }}</span>
                  </div>
                </div>

                <!-- Description -->
                <p v-if="m.description" class="text-xs text-space-text-dim px-3 pb-2 leading-relaxed">{{ m.description }}</p>

                <!-- Progress -->
                <div v-if="m.objectives?.length" class="px-3 pb-2">
                  <div class="text-[10px] text-space-text-dim font-semibold uppercase tracking-wider mb-1.5">Progress</div>
                  <div class="space-y-1.5">
                    <div v-for="(obj, i) in m.objectives" :key="i">
                      <div class="flex items-center gap-1.5 text-xs">
                        <span :class="obj.complete ? 'text-green-400' : 'text-space-text-dim'">{{ obj.complete ? '✓' : '○' }}</span>
                        <span :class="obj.complete ? 'text-space-text-dim line-through' : 'text-space-text'" class="flex-1 leading-tight">{{ obj.description || fmtObj(obj) }}</span>
                        <span v-if="!obj.complete && objProg(obj).required > 0" class="text-[11px] text-space-accent tabular-nums shrink-0">
                          {{ objProg(obj).current }}/{{ objProg(obj).required }}
                        </span>
                      </div>
                      <div v-if="!obj.complete && objProg(obj).required > 0" class="mt-0.5 h-1 bg-[#21262d] rounded-full overflow-hidden ml-4">
                        <div class="h-full rounded-full transition-all" :class="m.is_complete ? 'bg-green-500' : 'bg-space-accent'" :style="{ width: objProg(obj).pct + '%' }" />
                      </div>
                    </div>
                  </div>
                  <!-- Overall bar -->
                  <div class="mt-2 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all" :class="m.is_complete ? 'bg-green-500' : 'bg-space-accent'" :style="{ width: getProgress(m) + '%' }" />
                  </div>
                </div>

                <!-- Spacer -->
                <div class="flex-1" />

                <!-- Rewards + Actions footer -->
                <div class="px-3 pt-2 pb-2.5 border-t border-[#21262d] mt-auto space-y-2">
                  <div v-if="m.rewards?.credits || m.reward_credits || m.rewards?.xp || m.reward_xp || m.rewards?.skill_xp" class="flex flex-col gap-1.5 text-xs">
                    <div class="flex items-center gap-3">
                      <span class="text-space-text-dim text-[11px]">Rewards:</span>
                      <span v-if="m.rewards?.credits || m.reward_credits" class="text-yellow-400 font-semibold">💰 {{ fmt(m.rewards?.credits ?? m.reward_credits) }} cr</span>
                      <span v-if="m.rewards?.xp || m.reward_xp" class="text-blue-400">⭐ {{ m.rewards?.xp ?? m.reward_xp }} XP</span>
                    </div>
                    <div v-if="m.rewards?.skill_xp" class="flex items-center gap-2 flex-wrap">
                      <span class="text-space-text-dim text-[10px]">📚</span>
                      <span v-for="(xp, skill) in m.rewards.skill_xp" :key="skill" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 font-medium">
                        {{ skill }} +{{ xp }}
                      </span>
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <button
                      @click="completeM(m.mission_id || m.id)"
                      :disabled="!m.is_complete || !!inFlight[m.mission_id || m.id]"
                      :title="!!inFlight[m.mission_id || m.id] ? 'Claim request in progress…' : !m.is_complete ? 'Complete all objectives first to claim rewards' : 'Claim mission rewards'"
                      class="flex-1 text-xs px-3 py-1.5 rounded font-semibold transition-colors"
                      :class="m.is_complete
                        ? 'bg-green-600 hover:bg-green-500 text-white shadow-sm'
                        : 'bg-[#1c2128] text-space-text-dim border border-[#30363d] cursor-not-allowed'"
                    >
                      {{ inFlight[m.mission_id || m.id] ? '⏳ Claiming…' : '🎁 Claim Rewards' }}
                    </button>
                    <!-- Manual target toggle -->
                    <button
                      @click="(m.id === manualMissionId || m.mission_id === manualMissionId) && manualMissionId ? clearManualMission() : setManualMission(m.mission_id || m.id)"
                      class="text-xs px-2 py-1.5 rounded border font-medium transition-colors"
                      :class="(m.id === manualMissionId || m.mission_id === manualMissionId) && manualMissionId
                        ? 'border-blue-500 text-blue-300 bg-blue-900/20'
                        : 'border-[#30363d] text-space-text-dim hover:border-blue-500/50 hover:text-blue-400'"
                      :title="(m.id === manualMissionId || m.mission_id === manualMissionId) && manualMissionId ? 'Clear manual target' : 'Set as manual target for mission_runner'"
                    >🎯</button>
                    <button
                      @click="abandonM(m.mission_id || m.id)"
                      :disabled="!!inFlight[m.mission_id || m.id]"
                      class="text-xs px-3 py-1.5 rounded border font-medium transition-colors disabled:opacity-40"
                      :class="inFlight[m.mission_id || m.id]
                        ? 'border-[#30363d] text-space-text-dim'
                        : 'border-red-900/50 text-red-400/70 hover:border-red-500 hover:text-red-400 hover:bg-red-900/15'"
                    >✕ Abandon</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ AVAILABLE MISSIONS ═══ -->
          <div v-if="missionTab === 'available'">
            <div v-if="availableMissions.length === 0"
              class="text-xs text-space-text-dim italic py-6 text-center bg-[#0d1117] rounded-lg">
              No missions found in explored systems. Missions appear when bots visit stations.
            </div>
            <div v-else-if="filteredAvailableCount === 0"
              class="text-xs text-space-text-dim italic py-6 text-center bg-[#0d1117] rounded-lg">
              No missions match the current filter.
            </div>
            <div v-else>
              <template v-for="[sysName, stations] in groupedAvailable" :key="sysName">
                <div class="mb-4 first:mt-0 mt-4">
                  <!-- System header -->
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-[11px] font-bold text-space-text-dim uppercase tracking-widest">{{ sysName }}</span>
                    <div class="flex-1 h-px bg-space-border" />
                  </div>
                  <template v-for="[stationName, mList] in stations" :key="stationName">
                    <div v-if="mList.length" class="flex items-center gap-1.5 text-[11px] text-space-cyan mb-2 pl-0.5">
                      📍 <span class="font-medium">{{ stationName }}</span>
                    </div>
                    <div class="grid grid-cols-4 gap-2.5 mb-2">
                      <div
                        v-for="m in mList"
                        :key="m.mission_id"
                        class="flex flex-col bg-orange-950/20 border border-orange-800/40 rounded-lg hover:border-[#30363d] transition-colors"
                      >
                        <!-- Card header -->
                        <div class="flex items-start justify-between gap-2 p-3 pb-2">
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span class="text-sm leading-none">{{ typeConfig(m.type || '').icon }}</span>
                              <span class="text-sm font-semibold text-space-text-bright leading-tight">{{ m.title || m.mission_id }}</span>
                            </div>
                            <div v-if="m.giver_name" class="text-[11px] text-space-text-dim">
                              {{ m.giver_name }}<span v-if="m.giver_title" class="opacity-50"> • {{ m.giver_title }}</span>
                            </div>
                          </div>
                          <div class="flex flex-col items-end gap-1 flex-shrink-0">
                            <span v-if="m.difficulty != null" class="text-[10px] px-1.5 py-0.5 rounded font-bold" :class="getDifficultyClass(m.difficulty)">
                              {{ getDifficultyText(m.difficulty) }}
                            </span>
                            <span v-if="m.type" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="typeConfig(m.type).bg">{{ m.type }}</span>
                            <span v-if="m.last_seen" class="text-[10px] text-space-text-dim opacity-50">{{ timeAgo(m.last_seen) }}</span>
                          </div>
                        </div>

                        <p v-if="m.description" class="text-xs text-space-text-dim px-3 pb-2 leading-relaxed">{{ m.description }}</p>

                        <!-- Objectives -->
                        <div v-if="m.objectives?.length" class="px-3 pb-2">
                          <div class="text-[10px] text-space-text-dim font-semibold uppercase tracking-wider mb-1">Objectives</div>
                          <ul class="space-y-0.5 pl-1">
                            <li v-for="(obj, i) in m.objectives" :key="i" class="text-[11px] text-space-text-dim flex items-start gap-1.5">
                              <span class="mt-0.5 opacity-40 shrink-0">•</span>
                              <span>{{ obj.description || fmtObj(obj) }}<span v-if="obj.quantity || obj.required" class="opacity-50"> ×{{ obj.quantity ?? obj.required }}</span></span>
                            </li>
                          </ul>
                        </div>

                        <!-- Progress -->
                        <div v-if="m.objectives?.length" class="px-3 pb-2">
                          <div class="text-[10px] text-space-text-dim font-semibold uppercase tracking-wider mb-1.5">Progress</div>
                          <div class="space-y-1.5">
                            <div v-for="(obj, i) in m.objectives" :key="i">
                              <div class="flex items-center gap-1.5 text-xs">
                                <span :class="obj.complete ? 'text-green-400' : 'text-space-text-dim'">{{ obj.complete ? '✓' : '○' }}</span>
                                <span :class="obj.complete ? 'text-space-text-dim line-through' : 'text-space-text'" class="flex-1 leading-tight">{{ obj.description || fmtObj(obj) }}</span>
                                <span v-if="!obj.complete && objProg(obj).required > 0" class="text-[11px] text-space-accent tabular-nums shrink-0">
                                  {{ objProg(obj).current }}/{{ objProg(obj).required }}
                                </span>
                              </div>
                              <div v-if="!obj.complete && objProg(obj).required > 0" class="mt-0.5 h-1 bg-[#21262d] rounded-full overflow-hidden ml-4">
                                <div class="h-full rounded-full transition-all" :class="m.is_complete ? 'bg-green-500' : 'bg-space-accent'" :style="{ width: objProg(obj).pct + '%' }" />
                              </div>
                            </div>
                          </div>
                          <!-- Overall bar -->
                          <div class="mt-2 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all" :class="m.is_complete ? 'bg-green-500' : 'bg-space-accent'" :style="{ width: getProgress(m) + '%' }" />
                          </div>
                        </div>

                        <div class="flex-1" />

                        <!-- Footer -->
                        <div class="px-3 pt-2 pb-2.5 border-t border-[#21262d] space-y-2">
                          <div v-if="m.rewards?.credits || m.reward_credits || m.rewards?.xp || m.reward_xp || m.rewards?.skill_xp" class="flex flex-col gap-1.5 text-xs">
                            <div class="flex items-center gap-3">
                              <span class="text-space-text-dim text-[11px]">Rewards:</span>
                              <span v-if="m.rewards?.credits || m.reward_credits" class="text-yellow-400 font-semibold">💰 {{ fmt(m.rewards?.credits ?? m.reward_credits) }} cr</span>
                              <span v-if="m.rewards?.xp || m.reward_xp" class="text-blue-400">⭐ {{ m.rewards?.xp ?? m.reward_xp }} XP</span>
                            </div>
                            <div v-if="m.rewards?.skill_xp" class="flex items-center gap-2 flex-wrap">
                              <span class="text-space-text-dim text-[10px]">📚</span>
                              <span v-for="(xp, skill) in m.rewards.skill_xp" :key="skill" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 font-medium">
                                {{ skill }} +{{ xp }}
                              </span>
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <button
                              v-if="activeMissions.length < 5"
                              @click="acceptM(m.mission_id)"
                              :disabled="!!inFlight[m.mission_id]"
                              class="flex-1 text-xs px-3 py-1.5 rounded font-semibold transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
                            >{{ inFlight[m.mission_id] ? '⏳ Accepting…' : '✓ Accept' }}</button>
                            <span v-else class="text-[11px] text-orange-400/80 py-1.5">⚠ Cap 5/5</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
              <div v-if="filteredAvailableCount > displayedAvailableCount"
                class="text-center text-[11px] text-space-text-dim py-3 border-t border-space-border mt-2">
                Showing top {{ displayedAvailableCount }} of {{ filteredAvailableCount }} — adjust filters to narrow results
              </div>
            </div>
          </div>

          <!-- ═══ COMPLETED MISSIONS ═══ -->
          <div v-if="missionTab === 'completed'">
            <div v-if="loadingCompleted" class="text-xs text-space-text-dim italic py-8 text-center">Loading…</div>
            <div v-else-if="completedMissions.length === 0"
              class="flex flex-col items-center gap-3 py-10 text-center">
              <span class="text-space-text-dim text-sm">No completed missions loaded</span>
              <button @click="loadCompleted"
                class="text-xs px-4 py-2 rounded border border-space-accent text-space-accent hover:bg-space-accent/10 transition-colors font-medium">
                🔄 Load History
              </button>
            </div>
            <template v-else>
              <div class="flex items-center justify-between mb-3">
                <span class="text-xs text-space-text-dim">{{ completedMissions.length }} completed missions</span>
                <button @click="loadCompleted" :disabled="loadingCompleted"
                  class="text-xs px-3 py-1 rounded border border-space-border text-space-text-dim hover:border-space-accent hover:text-space-accent transition-colors">
                  🔄 Reload
                </button>
              </div>
              <div class="grid grid-cols-4 gap-2.5">
                <div
                  v-for="m in completedMissions"
                  :key="m.template_id || m.mission_id || m.id"
                  class="flex flex-col bg-indigo-990/20 border border-green-900/40 rounded-lg hover:border-green-700/50 transition-colors"
                >
                  <div class="p-3 pb-2 flex-1">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <span class="text-sm font-semibold text-space-text-bright leading-tight flex-1 min-w-0">
                        {{ m.title || m.template_id || m.mission_id || '(unknown mission)' }}
                      </span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-700/30 font-bold shrink-0">✓ Done</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-1 mb-1.5">
                      <span v-if="m.type" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="typeConfig(m.type).bg">
                        {{ typeConfig(m.type).icon }} {{ m.type }}
                      </span>
                      <span v-if="m.difficulty != null" class="text-[10px] px-1.5 py-0.5 rounded font-semibold" :class="getDifficultyClass(m.difficulty)">
                        {{ getDifficultyText(m.difficulty) }}
                      </span>
                    </div>
                    <div v-if="m.giver" class="text-[11px] text-space-text-dim">👤 {{ m.giver?.name ?? m.giver }}</div>
                    <div v-if="m.completed_at || m.completion_time" class="text-[11px] text-space-text-dim opacity-40 mt-0.5">
                      {{ timeAgo(m.completion_time ?? m.completed_at) }}
                    </div>
                  </div>
                  <div class="px-3 pb-3 border-t border-green-900/20 pt-2">
                    <button
                      @click="viewCompleted(m.template_id || m.mission_id)"
                      class="w-full text-xs px-2 py-1.5 rounded border border-green-900/40 text-green-400/70 hover:border-green-600 hover:text-green-400 hover:bg-green-900/10 transition-colors font-medium"
                    >📖 View Details</button>
                  </div>
                </div>
              </div>
            </template>
          </div>

        </div>
      </template>
    </div>
  </div>

  <!-- ── Completed Mission Detail Modal ── -->
  <div v-if="completedDetail" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" @click.self="completedDetail = null">
    <div class="bg-space-card border border-space-border rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
      <div class="flex items-center justify-between px-5 py-3 border-b border-space-border shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-lg">{{ typeConfig(completedDetail.type || '').icon }}</span>
          <span class="font-semibold text-space-text-bright truncate">{{ completedDetail.title || completedDetail.template_id }}</span>
          <span v-if="completedDetail.type" class="text-[11px] px-1.5 py-0.5 rounded" :class="typeConfig(completedDetail.type).bg">{{ completedDetail.type }}</span>
          <span v-if="completedDetail.difficulty != null" class="text-[11px] px-1.5 py-0.5 rounded font-semibold" :class="getDifficultyClass(completedDetail.difficulty)">{{ getDifficultyText(completedDetail.difficulty) }}</span>
        </div>
        <button @click="completedDetail = null"
          class="ml-4 shrink-0 w-7 h-7 flex items-center justify-center rounded border border-space-border text-space-text-dim hover:text-space-text hover:border-[#484f58] transition-colors text-base leading-none">✕</button>
      </div>

      <div class="flex-1 overflow-auto p-5 space-y-4">
        <!-- NPC Dialog chain -->
        <div v-if="completedDetail.dialog?.offer || completedDetail.offer_dialog" class="space-y-2">
          <h3 class="text-[11px] font-bold text-space-text-dim uppercase tracking-wider">NPC Dialog</h3>
          <div v-if="completedDetail.dialog?.offer || completedDetail.offer_dialog"
            class="bg-[#0d1117] border border-space-border rounded-lg p-3 text-xs text-space-text leading-relaxed italic">
            <span class="text-space-text-dim not-italic text-[10px] font-bold uppercase tracking-wide block mb-1">📨 Offer</span>
            {{ completedDetail.dialog?.offer || completedDetail.offer_dialog }}
          </div>
          <div v-if="completedDetail.dialog?.accept || completedDetail.accept_dialog"
            class="bg-[#0d1117] border border-space-border rounded-lg p-3 text-xs text-space-text leading-relaxed italic">
            <span class="text-green-400 not-italic text-[10px] font-bold uppercase tracking-wide block mb-1">✅ Accept</span>
            {{ completedDetail.dialog?.accept || completedDetail.accept_dialog }}
          </div>
          <div v-if="completedDetail.dialog?.complete || completedDetail.complete_dialog"
            class="bg-green-950/20 border border-green-800/30 rounded-lg p-3 text-xs text-space-text leading-relaxed italic">
            <span class="text-green-400 not-italic text-[10px] font-bold uppercase tracking-wide block mb-1">🎉 Completion</span>
            {{ completedDetail.dialog?.complete || completedDetail.complete_dialog }}
          </div>
          <div v-if="completedDetail.dialog?.decline || completedDetail.decline_dialog"
            class="bg-[#0d1117] border border-space-border rounded-lg p-3 text-xs text-space-text-dim leading-relaxed italic opacity-60">
            <span class="not-italic text-[10px] font-bold uppercase tracking-wide block mb-1">✕ Decline</span>
            {{ completedDetail.dialog?.decline || completedDetail.decline_dialog }}
          </div>
        </div>

        <!-- Objectives -->
        <div v-if="completedDetail.objectives?.length">
          <h3 class="text-[11px] font-bold text-space-text-dim uppercase tracking-wider mb-2">Objectives</h3>
          <ul class="space-y-1">
            <li v-for="(obj, i) in completedDetail.objectives" :key="i"
              class="flex items-start gap-2 text-xs text-space-text bg-[#0d1117] rounded px-3 py-1.5">
              <span class="text-green-400 mt-0.5 shrink-0">✓</span>
              <span>{{ obj.description || fmtObj(obj) }}<span v-if="obj.quantity || obj.required" class="text-space-text-dim"> ×{{ obj.quantity ?? obj.required }}</span></span>
            </li>
          </ul>
        </div>

        <!-- Rewards -->
        <div v-if="completedDetail.rewards">
          <h3 class="text-[11px] font-bold text-space-text-dim uppercase tracking-wider mb-2">Rewards</h3>
          <div class="flex flex-wrap gap-3 text-xs">
            <span v-if="completedDetail.rewards.credits" class="text-yellow-400 font-semibold">💰 {{ fmt(completedDetail.rewards.credits) }} cr</span>
            <span v-if="completedDetail.rewards.xp" class="text-blue-400">⭐ {{ completedDetail.rewards.xp }} XP</span>
            <span v-if="completedDetail.rewards.reputation" class="text-purple-400">🏛️ +{{ completedDetail.rewards.reputation }} rep</span>
          </div>
          <div v-if="completedDetail.rewards.skill_xp" class="flex items-center gap-2 flex-wrap mt-2">
            <span class="text-space-text-dim text-[11px]">📚 Skill XP:</span>
            <span v-for="(xp, skill) in completedDetail.rewards.skill_xp" :key="skill" class="text-[11px] px-2 py-1 rounded bg-blue-900/30 text-blue-300 font-medium">
              {{ skill }} +{{ xp }}
            </span>
          </div>
        </div>

        <!-- Giver -->
        <div v-if="completedDetail.giver" class="text-xs text-space-text-dim">
          👤 Given by:
          <span class="text-space-text">{{ completedDetail.giver?.name ?? completedDetail.giver }}</span>
          <span v-if="completedDetail.giver?.title" class="opacity-60">, {{ completedDetail.giver.title }}</span>
        </div>
      </div>
    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';
import { empireIcon, empireName } from '../utils/empires';
import {
  useMissions,
  typeConfig, getDifficultyText, getDifficultyClass,
  objProg, fmtObj, getProgress, fmt, timeAgo, fmtSecs,
} from '../composables/useMissions';

defineEmits(['openProfile']);

const botStore = useBotStore();
const selectedBot = ref<string | null>(null);

// ── Auto-sync: when a bot profile is opened from another page, auto-select here
onMounted(() => {
  if (botStore.selectedBot && !selectedBot.value) selectBot(botStore.selectedBot);
});
watch(() => botStore.selectedBot, (username) => {
  if (username && username !== selectedBot.value) selectBot(username);
});

// ── Manual mission target (mission_runner setting) ──────────────
const manualMissionId = computed(() =>
  (botStore.settings?.mission_runner?.manualMissionId as string) || ''
);
const manualMissionTitle = computed(() => {
  if (!manualMissionId.value) return '';
  const m = activeMissions.value.find(
    (m: any) => m.id === manualMissionId.value || m.mission_id === manualMissionId.value
  );
  return m?.title || manualMissionId.value;
});
function setManualMission(id: string) {
  botStore.saveSettings('mission_runner', { manualMissionId: id });
}
function clearManualMission() {
  botStore.saveSettings('mission_runner', { manualMissionId: '' });
}
const activeMissions = ref<any[]>([]);
const completedMissions = ref<any[]>([]);
const loading = ref(false);
const loadingCompleted = ref(false);
const inFlight = reactive<Record<string, boolean>>({});
const completedDetail = ref<any | null>(null);

// ── Filters ────────────────────────────────────────────────────
const typeFilter = ref('all');
const diffFilter = ref('all');

// ── Bot state helpers ──────────────────────────────────────────
const currentBotState = computed(() => botStore.bots.find(b => b.username === selectedBot.value));
const isDocked = computed(() => (currentBotState.value as any)?.docked ?? false);
const readyCount = computed(() => activeMissions.value.filter(m => m.is_complete).length);

const {
  filteredActive, availableMissions, allTypes, groupedAvailable,
  filteredAvailableCount, displayedAvailableCount,
} = useMissions(activeMissions, typeFilter, diffFilter);

// ── Mission tabs ────────────────────────────────────────────────
const missionTab = ref<'active' | 'available' | 'completed'>('active');

const missionTabs = [
  { id: 'active',    label: '🏃 Active',    count: computed(() => activeMissions.value.length) },
  { id: 'available', label: '📋 Available',  count: computed(() => filteredAvailableCount.value) },
  { id: 'completed', label: '✅ Completed',  count: computed(() => completedMissions.value.length) },
];

function switchMissionTab(id: string) {
  missionTab.value = id as 'active' | 'available' | 'completed';
  if (id === 'completed' && completedMissions.value.length === 0 && !loadingCompleted.value) {
    loadCompleted();
  }
}

// ── Data loading ───────────────────────────────────────────────
function loadActive() {
  if (!selectedBot.value) return;
  loading.value = true;
  // Load active missions
  botStore.sendExec(selectedBot.value, 'get_active_missions', undefined, (res: any) => {
    loading.value = false;
    if (res.ok && res.data) {
      activeMissions.value = Array.isArray(res.data) ? res.data : (res.data.missions || []);
    } else {
      activeMissions.value = [];
    }
  });
}

function loadCompleted() {
  if (!selectedBot.value) return;
  loadingCompleted.value = true;
  completedMissions.value = [];
  botStore.sendExec(selectedBot.value, 'completed_missions', undefined, (res: any) => {
    loadingCompleted.value = false;
    if (res.ok && res.data) {
      completedMissions.value = res.data.missions ?? [];
    }
  });
}

function viewCompleted(templateId: string) {
  if (!selectedBot.value || !templateId) return;
  botStore.sendExec(selectedBot.value, 'view_completed_mission', { template_id: templateId }, (res: any) => {
    if (res.ok && res.data) {
      completedDetail.value = res.data;
    }
  });
}

function selectBot(username: string) {
  selectedBot.value = username;
  activeMissions.value = [];
  completedMissions.value = [];
  completedDetail.value = null;
  loadActive();
}

function refresh() { loadActive(); }

function completeM(id: string) {
  if (!selectedBot.value || inFlight[id]) return;
  inFlight[id] = true;
  botStore.sendExec(selectedBot.value, 'complete_mission', { mission_id: id }, () => {
    delete inFlight[id];
    loadActive();
  });
}

function abandonM(id: string) {
  if (!selectedBot.value || inFlight[id]) return;
  inFlight[id] = true;
  botStore.sendExec(selectedBot.value, 'abandon_mission', { mission_id: id }, () => {
    delete inFlight[id];
    loadActive();
  });
}

function acceptM(id: string) {
  if (!selectedBot.value || inFlight[id]) return;
  inFlight[id] = true;
  botStore.sendExec(selectedBot.value, 'accept_mission', { mission_id: id }, () => {
    delete inFlight[id];
    loadActive();
  });
}
</script>
