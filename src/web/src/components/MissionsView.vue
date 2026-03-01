<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">
    <!-- Sidebar -->
    <div class="w-56 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden flex-shrink-0">
      <div class="px-3 py-2 border-b border-space-border">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Bots</h3>
      </div>
      <div class="flex-1 overflow-auto p-2 space-y-0.5">
        <div
          v-for="bot in botStore.bots"
          :key="bot.username"
          @click="selectBot(bot.username)"
          class="w-full px-2 py-2 text-sm rounded-md cursor-pointer border transition-colors"
          :class="selectedBot === bot.username
            ? 'bg-[rgba(88,166,255,0.1)] border-space-accent text-space-accent'
            : 'border-transparent text-space-text hover:bg-space-row-hover'"
        >
          {{ bot.username }}
        </div>
        <div v-if="botStore.bots.length === 0" class="text-xs text-space-text-dim italic p-2">No bots</div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg p-2 overflow-auto scrollbar-dark">

      <div v-if="!selectedBot" class="flex items-center justify-center h-32 text-space-text-dim text-sm italic">
        Select a bot to view missions
      </div>

      <div v-else class="space-y-4 pr-1">

        <!-- Header + filters -->
        <div class="space-y-2">
          <!-- Status row -->
          <div class="flex items-center gap-3">
            <span class="text-sm font-semibold text-space-text-bright">{{ selectedBot }}</span>
            <span v-if="isDocked" class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">⚓ Docked</span>
            <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim">🚀 In Space</span>
            <span class="text-xs text-space-text-dim">
              Active: <b class="text-space-text">{{ activeMissions.length }}/5</b>
            </span>
            <span v-if="readyCount > 0" class="text-xs text-green-400 font-semibold">● {{ readyCount }} ready to claim</span>
            <span v-if="completedMissions.length > 0" class="text-xs text-space-text-dim">
              Completed: <b class="text-space-text">{{ completedMissions.length }}</b>
            </span>
            <button @click="refresh" :disabled="loading" class="ml-auto btn btn-secondary text-xs px-3 py-1">
              <span :class="{ 'animate-spin inline-block': loading }">🔄</span> Refresh
            </button>
          </div>

          <!-- Filter bar -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] text-space-text-dim uppercase font-semibold">Filter:</span>
            <!-- Type filter -->
            <select
              v-model="typeFilter"
              class="text-xs bg-[#0d1117] border border-space-border rounded px-2 py-1 text-space-text focus:outline-none focus:border-space-accent"
            >
              <option value="all">All Types</option>
              <option v-for="t in allTypes" :key="t" :value="t">{{ typeConfig(t).icon }} {{ t }}</option>
            </select>
            <!-- Difficulty filter -->
            <select
              v-model="diffFilter"
              class="text-xs bg-[#0d1117] border border-space-border rounded px-2 py-1 text-space-text focus:outline-none focus:border-space-accent"
            >
              <option value="all">All Difficulties</option>
              <option value="1">Easy</option>
              <option value="2">Medium</option>
              <option value="3">Hard</option>
              <option value="4">Very Hard</option>
              <option value="5">Extreme</option>
            </select>
            <button
              v-if="typeFilter !== 'all' || diffFilter !== 'all'"
              @click="typeFilter = 'all'; diffFilter = 'all'"
              class="text-[10px] px-2 py-1 rounded border border-space-border text-space-text-dim hover:text-space-red hover:border-space-red transition-colors"
            >✕ Clear</button>
          </div>
        </div>

        <!-- ── Active Missions ── -->
        <section>
          <h2 class="text-sm font-semibold text-space-text-bright mb-2 flex items-center gap-2">
            🏃 Active Missions
            <span class="text-[10px] px-1.5 py-0.5 rounded-lg bg-[#21262d] text-space-text-dim">{{ filteredActive.length }}</span>
            <span v-if="filteredActive.length !== activeMissions.length" class="text-[10px] text-space-text-dim opacity-60">({{ activeMissions.length }} total)</span>
          </h2>

          <div v-if="loading" class="text-xs text-space-text-dim italic py-4 text-center">Loading…</div>
          <div v-else-if="filteredActive.length === 0" class="text-xs text-space-text-dim italic py-4 bg-[#0d1117] rounded-lg px-3">
            {{ activeMissions.length === 0 ? 'No active missions' : 'No missions match the current filter' }}
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="m in filteredActive"
              :key="m.mission_id || m.id"
              class="bg-[#161b22] border rounded-lg p-3 transition-colors"
              :class="m.is_complete ? 'border-green-500/50' : 'border-[#30363d]'"
            >
              <!-- Mission Header: icon+title left, difficulty right -->
              <div class="flex items-start justify-between gap-2 mb-1.5">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span :class="typeConfig(m.type || '').bg.split(' ')[1] || 'text-space-text-dim'" class="text-sm">
                      {{ typeConfig(m.type || '').icon }}
                    </span>
                    <span class="text-sm font-semibold text-space-text-bright">{{ m.title || m.mission_id || m.id }}</span>
                    <span v-if="m.is_complete" class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-semibold">✓ Ready</span>
                  </div>
                  <div v-if="m.giver_name" class="text-[10px] text-space-text-dim mt-0.5">
                    {{ m.giver_name }}<span v-if="m.giver_title" class="text-space-text-dim opacity-60"> • {{ m.giver_title }}</span>
                  </div>
                </div>
                <div class="flex flex-col items-end gap-1 flex-shrink-0">
                  <span v-if="m.difficulty != null" class="text-[10px] px-1.5 py-0.5 rounded font-semibold" :class="getDifficultyClass(m.difficulty)">
                    {{ getDifficultyText(m.difficulty) }}
                  </span>
                  <span v-if="m.type" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="typeConfig(m.type).bg">
                    {{ m.type }}
                  </span>
                  <div v-if="m.time_remaining" class="text-[10px] text-orange-400">⏱ {{ fmtSecs(m.time_remaining) }}</div>
                </div>
              </div>

              <!-- Description -->
              <p v-if="m.description" class="text-xs text-space-text-dim mb-2.5 leading-relaxed">{{ m.description }}</p>

              <!-- Progress -->
              <div v-if="m.objectives?.length" class="mb-2.5">
                <div class="text-[10px] text-space-text-dim font-semibold uppercase tracking-wide mb-1.5">Progress:</div>
                <div class="space-y-1.5">
                  <div v-for="(obj, i) in m.objectives" :key="i" class="text-xs">
                    <div class="flex items-center gap-1.5 mb-0.5">
                      <span :class="obj.complete ? 'text-green-400' : 'text-space-text-dim'">{{ obj.complete ? '✓' : '○' }}</span>
                      <span :class="obj.complete ? 'text-space-text-dim line-through' : 'text-space-text'" class="flex-1">
                        {{ obj.description || fmtObj(obj) }}
                      </span>
                      <span v-if="!obj.complete && objProg(obj).required > 0" class="text-[10px] text-space-accent ml-auto tabular-nums">
                        {{ objProg(obj).current }}/{{ objProg(obj).required }}
                      </span>
                    </div>
                    <div v-if="!obj.complete && objProg(obj).required > 0" class="h-1 bg-[#21262d] rounded-full overflow-hidden ml-4">
                      <div class="h-full rounded-full transition-all" :class="m.is_complete ? 'bg-green-500' : 'bg-space-accent'" :style="{ width: objProg(obj).pct + '%' }"></div>
                    </div>
                  </div>
                </div>
                <!-- Overall progress bar -->
                <div class="mt-2 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="m.is_complete ? 'bg-green-500' : 'bg-space-accent'"
                    :style="{ width: getProgress(m) + '%' }"
                  ></div>
                </div>
              </div>

              <!-- Rewards row -->
              <div v-if="m.rewards?.credits || m.reward_credits || m.rewards?.xp || m.reward_xp" class="flex items-center gap-3 mb-2.5 text-xs">
                <span class="text-space-text-dim">Rewards:</span>
                <span v-if="m.rewards?.credits || m.reward_credits" class="text-yellow-400 font-semibold">💰 {{ fmt(m.rewards?.credits ?? m.reward_credits) }} cr</span>
                <span v-if="m.rewards?.xp || m.reward_xp" class="text-blue-400">⭐ {{ m.rewards?.xp ?? m.reward_xp }} XP</span>
              </div>

              <!-- Actions -->
              <div class="flex gap-2">
                <button
                  @click="completeM(m.mission_id || m.id)"
                  :disabled="!m.is_complete || !!inFlight[m.mission_id || m.id]"
                  class="flex-1 text-xs px-3 py-1.5 rounded transition-colors font-medium"
                  :class="m.is_complete
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-[#21262d] text-space-text-dim opacity-40 cursor-not-allowed'"
                >🎁 {{ inFlight[m.mission_id || m.id] ? 'Claiming…' : 'Claim Rewards' }}</button>
                <button
                  @click="abandonM(m.mission_id || m.id)"
                  :disabled="!!inFlight[m.mission_id || m.id]"
                  class="text-xs px-3 py-1.5 rounded border border-[#30363d] text-space-text-dim hover:border-space-red hover:text-space-red transition-colors disabled:opacity-50"
                >✕ Abandon</button>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Available Missions ── -->
        <section>
          <h2 class="text-sm font-semibold text-space-text-bright mb-2 flex items-center gap-2">
            📋 Available Missions
            <span class="text-[10px] px-1.5 py-0.5 rounded-lg bg-[#21262d] text-space-text-dim">{{ filteredAvailableCount }}</span>
            <span v-if="filteredAvailableCount !== availableMissions.length" class="text-[10px] text-space-text-dim opacity-60">({{ availableMissions.length }} total)</span>
            <span v-if="activeMissions.length >= 5" class="text-[10px] text-orange-400">(cap 5/5)</span>
          </h2>

          <div v-if="availableMissions.length === 0" class="text-xs text-space-text-dim italic py-4 bg-[#0d1117] rounded-lg px-3">
            No missions found in explored systems. Missions appear when bots visit stations.
          </div>
          <div v-else-if="filteredAvailableCount === 0" class="text-xs text-space-text-dim italic py-4 bg-[#0d1117] rounded-lg px-3">
            No missions match the current filter.
          </div>

          <!-- Group by system → station -->
          <template v-for="[sysName, stations] in groupedAvailable" :key="sysName">
            <div class="mb-1 mt-3 first:mt-0">
              <div class="flex items-center gap-1.5 mb-1.5">
                <span class="text-[10px] font-semibold text-space-text-dim uppercase tracking-wide">{{ sysName }}</span>
                <div class="flex-1 h-px bg-space-border"></div>
              </div>
              <template v-for="[stationName, mList] in stations" :key="stationName">
                <div v-if="mList.length" class="text-[10px] text-space-cyan mb-1.5 pl-1">📍 {{ stationName }}</div>
                <div class="space-y-2 mb-3">
                  <div
                    v-for="m in mList"
                    :key="m.mission_id"
                    class="bg-[#161b22] border border-[#30363d] rounded-lg p-3"
                  >
                    <!-- Header: icon+title left, difficulty right -->
                    <div class="flex items-start justify-between gap-2 mb-1.5">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm">{{ typeConfig(m.type || '').icon }}</span>
                          <span class="text-sm font-semibold text-space-text-bright">{{ m.title || m.mission_id }}</span>
                        </div>
                        <div v-if="m.giver_name" class="text-[10px] text-space-text-dim mt-0.5">
                          {{ m.giver_name }}<span v-if="m.giver_title" class="opacity-60"> • {{ m.giver_title }}</span>
                        </div>
                      </div>
                      <div class="flex flex-col items-end gap-1 flex-shrink-0">
                        <span v-if="m.difficulty != null" class="text-[10px] px-1.5 py-0.5 rounded font-semibold" :class="getDifficultyClass(m.difficulty)">
                          {{ getDifficultyText(m.difficulty) }}
                        </span>
                        <span v-if="m.last_seen" class="text-[10px] text-space-text-dim opacity-60">{{ timeAgo(m.last_seen) }}</span>
                      </div>
                    </div>

                    <p v-if="m.description" class="text-xs text-space-text-dim mb-2 leading-relaxed">{{ m.description }}</p>

                    <!-- Objectives -->
                    <div v-if="m.objectives?.length" class="mb-2">
                      <div class="text-[10px] text-space-text-dim font-semibold uppercase tracking-wide mb-1">Objectives:</div>
                      <ul class="space-y-0.5 pl-1">
                        <li v-for="(obj, i) in m.objectives" :key="i" class="text-[10px] text-space-text-dim flex items-start gap-1.5">
                          <span class="mt-0.5 opacity-60">•</span>
                          <span>{{ obj.description || fmtObj(obj) }}<span v-if="obj.quantity || obj.required" class="opacity-60"> ×{{ obj.quantity ?? obj.required }}</span></span>
                        </li>
                      </ul>
                    </div>

                    <!-- Rewards -->
                    <div v-if="m.rewards?.credits || m.reward_credits || m.rewards?.xp || m.reward_xp" class="flex items-center gap-3 mb-2 text-xs">
                      <span class="text-space-text-dim">Rewards:</span>
                      <span v-if="m.rewards?.credits || m.reward_credits" class="text-yellow-400 font-semibold">💰 {{ fmt(m.rewards?.credits ?? m.reward_credits) }} cr</span>
                      <span v-if="m.rewards?.xp || m.reward_xp" class="text-blue-400">⭐ {{ m.rewards?.xp ?? m.reward_xp }} XP</span>
                    </div>

                    <!-- Actions -->
                    <div class="flex gap-2 pt-2 border-t border-[#21262d]">
                      <button
                        v-if="activeMissions.length < 5"
                        @click="acceptM(m.mission_id)"
                        :disabled="!!inFlight[m.mission_id]"
                        class="flex-1 text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-medium transition-colors disabled:opacity-50"
                      >✓ Accept</button>
                      <span v-else class="text-[10px] text-space-text-dim opacity-60 py-1.5">Cap reached (5/5)</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </section>

        <!-- ── Completed Missions ── -->
        <section v-if="completedMissions.length > 0">
          <details>
            <summary class="text-sm font-semibold text-space-text-bright mb-2 flex items-center gap-2 cursor-pointer list-none select-none">
              ✅ Completed Missions
              <span class="text-[10px] px-1.5 py-0.5 rounded-lg bg-green-500/10 text-green-400">{{ completedMissions.length }}</span>
              <span class="text-[10px] text-space-text-dim opacity-60 ml-1">▼ expand</span>
            </summary>
            <div class="space-y-2 mt-2">
              <div
                v-for="m in completedMissions"
                :key="m.mission_id || m.id"
                class="bg-[#0d1117] border border-green-500/20 rounded-lg p-3 opacity-80"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span class="text-xs font-semibold text-space-text-dim">{{ m.title || m.mission_id || m.id }}</span>
                      <span v-if="m.type" class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="typeConfig(m.type).bg">
                        {{ typeConfig(m.type).icon }} {{ m.type }}
                      </span>
                      <span v-if="m.difficulty != null" class="text-[10px] px-1.5 py-0.5 rounded" :class="getDifficultyClass(m.difficulty)">
                        {{ getDifficultyText(m.difficulty) }}
                      </span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">✓ Done</span>
                    </div>
                    <p v-if="m.description" class="text-[10px] text-space-text-dim leading-relaxed">{{ m.description }}</p>
                    <div v-if="m.completed_at" class="text-[10px] text-space-text-dim opacity-50 mt-0.5">{{ timeAgo(m.completed_at) }}</div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div v-if="m.rewards?.credits || m.reward_credits" class="text-xs text-green-400">
                      💰 {{ fmt(m.rewards?.credits ?? m.reward_credits) }} cr
                    </div>
                    <div v-if="m.rewards?.xp || m.reward_xp" class="text-[10px] text-blue-400">⭐ {{ m.rewards?.xp ?? m.reward_xp }} XP</div>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </section>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useBotStore } from '../stores/botStore';

const botStore = useBotStore();
const selectedBot = ref<string | null>(null);
const activeMissions = ref<any[]>([]);
const completedMissions = ref<any[]>([]);
const loading = ref(false);
const inFlight = reactive<Record<string, boolean>>({});

// ── Filters ────────────────────────────────────────────────────
const typeFilter = ref('all');
const diffFilter = ref('all');

// ── Bot state helpers ──────────────────────────────────────────
const currentBotState = computed(() => botStore.bots.find(b => b.username === selectedBot.value));
const isDocked = computed(() => (currentBotState.value as any)?.docked ?? false);
const readyCount = computed(() => activeMissions.value.filter(m => m.is_complete).length);

// ── Type badge config ──────────────────────────────────────────
function typeConfig(type: string): { icon: string; bg: string } {
  const map: Record<string, { icon: string; bg: string }> = {
    delivery:             { icon: '📦', bg: 'bg-blue-500/10 text-blue-400' },
    trade:                { icon: '💱', bg: 'bg-green-500/10 text-green-400' },
    market_participation: { icon: '📊', bg: 'bg-cyan-500/10 text-cyan-400' },
    hauling:              { icon: '🚚', bg: 'bg-orange-500/10 text-orange-400' },
    mining:               { icon: '⛏️', bg: 'bg-amber-500/10 text-amber-400' },
    salvage:              { icon: '♻️', bg: 'bg-lime-500/10 text-lime-400' },
    combat:               { icon: '⚔️', bg: 'bg-red-500/10 text-red-400' },
    exploration:          { icon: '🔭', bg: 'bg-purple-500/10 text-purple-400' },
    contract:             { icon: '📋', bg: 'bg-indigo-500/10 text-indigo-400' },
  };
  return map[(type || '').toLowerCase()] ?? { icon: '🎯', bg: 'bg-[#21262d] text-space-text-dim' };
}

// ── Difficulty helpers (matches spacemolt-web logic) ───────────
function getDifficultyText(difficulty?: string | number): string {
  if (typeof difficulty === 'number') {
    if (difficulty <= 1) return 'Easy';
    if (difficulty <= 2) return 'Medium';
    if (difficulty <= 3) return 'Hard';
    if (difficulty <= 4) return 'Very Hard';
    return 'Extreme';
  }
  return (difficulty as string) || 'Normal';
}

function getDifficultyClass(difficulty?: string | number): string {
  if (typeof difficulty === 'number') {
    if (difficulty <= 1) return 'bg-green-600/30 text-green-300';
    if (difficulty <= 2) return 'bg-yellow-600/30 text-yellow-300';
    if (difficulty <= 3) return 'bg-orange-600/30 text-orange-300';
    if (difficulty <= 4) return 'bg-red-600/30 text-red-300';
    return 'bg-purple-600/30 text-purple-300';
  }
  switch ((difficulty as string)?.toLowerCase()) {
    case 'easy':    return 'bg-green-600/30 text-green-300';
    case 'medium':  return 'bg-yellow-600/30 text-yellow-300';
    case 'hard':    return 'bg-orange-600/30 text-orange-300';
    case 'extreme': return 'bg-red-600/30 text-red-300';
    default:        return 'bg-[#21262d] text-space-text-dim';
  }
}

// Normalize difficulty to numeric level for filter comparison
function diffLevel(d: string | number | undefined): number {
  if (typeof d === 'number') return d;
  switch ((d as string)?.toLowerCase()) {
    case 'easy':      return 1;
    case 'medium':    return 2;
    case 'hard':      return 3;
    case 'very hard': return 4;
    case 'extreme':   return 5;
    default:          return 0;
  }
}

// ── Objective helpers ──────────────────────────────────────────
function objProg(obj: any): { current: number; required: number; pct: number } {
  const current = typeof obj.current === 'number' ? obj.current : 0;
  const required = obj.required ?? obj.quantity ?? obj.target_amount ?? 0;
  const pct = required > 0 ? Math.min(100, Math.round((current / required) * 100)) : (obj.complete ? 100 : 0);
  return { current, required, pct };
}

function fmtObj(obj: any): string {
  const type   = obj.type   || '';
  const target = obj.targetName || obj.target || '';
  const qty    = obj.quantity ?? obj.required ?? obj.target_amount ?? '';
  if (type && target) return `${type}: ${qty ? qty + '× ' : ''}${target}`;
  if (target)         return `${qty ? qty + '× ' : ''}${target}`;
  return '';
}

// ── Formatting ─────────────────────────────────────────────────
function fmt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n || 0));
}

function timeAgo(isoStr: string): string {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 0 || diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getProgress(m: any): number {
  const objs: any[] = m.objectives || [];
  if (objs.length === 0) return m.is_complete ? 100 : 0;
  const total = objs.reduce((sum: number, obj: any) => {
    const req = obj.required ?? obj.quantity ?? obj.target_amount ?? 1;
    const cur = typeof obj.current === 'number' ? obj.current : (obj.complete ? req : 0);
    return sum + Math.min(1, cur / (req || 1));
  }, 0);
  return Math.round((total / objs.length) * 100);
}

function fmtSecs(s: number): string {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Filter predicates ──────────────────────────────────────────
function matchesFilter(m: any): boolean {
  if (typeFilter.value !== 'all' && (m.type || '').toLowerCase() !== typeFilter.value.toLowerCase()) return false;
  if (diffFilter.value !== 'all') {
    const target = parseInt(diffFilter.value, 10);
    const lvl = diffLevel(m.difficulty);
    if (lvl !== target) return false;
  }
  return true;
}

const filteredActive = computed(() => activeMissions.value.filter(matchesFilter));

// ── Available missions from mapData ───────────────────────────
const availableMissions = computed(() => {
  const missions: any[] = [];
  const seen = new Set<string>();
  for (const [sysId, sys] of Object.entries(botStore.mapData)) {
    const sysName = (sys as any).name || sysId;
    for (const poi of ((sys as any).pois || [])) {
      if (!poi.missions?.length) continue;
      for (const m of poi.missions) {
        if (!seen.has(m.mission_id)) {
          seen.add(m.mission_id);
          missions.push({ ...m, _sysName: sysName, _stationName: poi.name || poi.id, _stationId: poi.id });
        }
      }
    }
  }
  return missions.sort((a, b) => ((b.rewards?.credits ?? b.reward_credits) || 0) - ((a.rewards?.credits ?? a.reward_credits) || 0));
});

// All unique types across active + available (for filter dropdown)
const allTypes = computed(() => {
  const types = new Set<string>();
  for (const m of activeMissions.value)    if (m.type) types.add(m.type.toLowerCase());
  for (const m of availableMissions.value) if (m.type) types.add(m.type.toLowerCase());
  return [...types].sort();
});

// Group available missions by system → station, applying filter
const groupedAvailable = computed((): [string, [string, any[]][]][] => {
  const bySystem = new Map<string, Map<string, any[]>>();
  for (const m of availableMissions.value) {
    if (!matchesFilter(m)) continue;
    const sys = m._sysName;
    const sta = m._stationName;
    if (!bySystem.has(sys)) bySystem.set(sys, new Map());
    const byStation = bySystem.get(sys)!;
    if (!byStation.has(sta)) byStation.set(sta, []);
    byStation.get(sta)!.push(m);
  }
  return [...bySystem.entries()].map(([sys, stations]) => [sys, [...stations.entries()]]);
});

const filteredAvailableCount = computed(() =>
  groupedAvailable.value.reduce((n, [, stations]) =>
    n + stations.reduce((sn, [, ms]) => sn + ms.length, 0), 0)
);

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
  // Load completed missions from get_status
  botStore.sendExec(selectedBot.value, 'get_status', undefined, (res: any) => {
    if (res.ok && res.data) {
      const d = res.data;
      const player = d.player || d;
      const raw = player.completed_missions ?? d.completed_missions ?? [];
      completedMissions.value = Array.isArray(raw) ? raw : [];
    }
  });
}

function selectBot(username: string) {
  selectedBot.value = username;
  activeMissions.value = [];
  completedMissions.value = [];
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
