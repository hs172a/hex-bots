<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Tab bar -->
    <div class="flex border-b border-space-border bg-space-card px-3 shrink-0">
      <button v-for="t in TABS" :key="t.id" @click="activeTab = t.id"
        class="px-4 py-2 text-xs font-medium border-b-2 transition-all"
        :class="activeTab === t.id ? 'text-space-text-bright border-space-accent' : 'text-space-text-dim border-transparent hover:text-space-text'">
        {{ t.label }}
      </button>
    </div>

  <!-- Advisory Tab -->
  <div v-if="activeTab === 'advisory'" class="flex-1 flex flex-col gap-4 p-4 overflow-auto scrollbar-dark">
    <!-- Commander Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-space-text-bright">Commander Advisory</h3>
      <div class="flex items-center gap-3">
        <span v-if="lastEvalTime" class="text-xs text-space-text-dim">
          Last eval: {{ formatTimeAgo(lastEvalTime) }}
        </span>
        <button @click="refreshAll" class="btn btn-primary px-3 py-1 text-xs">
          Refresh
        </button>
      </div>
    </div>

    <!-- Top Row: Economy + Suggestions -->
    <div class="flex gap-4">
      <!-- Economy Summary -->
      <div class="flex-1 bg-space-card border border-space-border rounded-lg">
        <div class="px-3 py-2 border-b border-space-border flex items-center justify-between">
          <span class="text-xs font-semibold text-space-text-dim uppercase">Economy</span>
          <div class="flex gap-4 text-xs">
            <span class="text-space-green">Rev: ₡{{ fmt(economyData.totalRevenue) }}</span>
            <span class="text-space-red">Cost: ₡{{ fmt(economyData.totalCosts) }}</span>
            <span :class="economyData.netProfit >= 0 ? 'text-space-green' : 'text-space-red'">
              Net: ₡{{ fmt(economyData.netProfit) }}
            </span>
          </div>
        </div>
        <div class="p-3">
          <!-- Deficits -->
          <div v-if="economyData.deficits?.length" class="mb-3">
            <span class="text-xs text-space-text-dim uppercase font-semibold">Supply Deficits</span>
            <div class="mt-1 flex flex-wrap gap-2">
              <div 
                v-for="d in economyData.deficits" :key="d.itemId"
                class="px-2 py-1 rounded text-xs border"
                :class="d.priority === 'critical' ? 'border-space-red bg-space-red/10 text-space-red' : 'border-space-yellow bg-space-yellow/10 text-space-yellow'"
              >
                {{ formatItemName(d.itemId) }}: -{{ d.shortfall.toFixed(1) }}/hr
                <span class="opacity-60">({{ d.priority }})</span>
              </div>
            </div>
          </div>
          <!-- Surpluses -->
          <div v-if="economyData.surpluses?.length" class="mb-3">
            <span class="text-xs text-space-text-dim uppercase font-semibold">Surpluses</span>
            <div class="mt-1 flex flex-wrap gap-2">
              <div 
                v-for="s in economyData.surpluses" :key="s.itemId"
                class="px-2 py-1 rounded text-xs border border-space-green bg-space-green/10 text-space-green"
              >
                {{ formatItemName(s.itemId) }}: +{{ s.excessPerHour.toFixed(1) }}/hr
              </div>
            </div>
          </div>
          <div v-if="!economyData.deficits?.length && !economyData.surpluses?.length" class="text-xs text-space-text-dim">
            No supply data yet. Economy data accumulates as bots run routines.
          </div>
        </div>
      </div>

      <!-- Commander Suggestions -->
      <div class="flex-1 bg-space-card border border-space-border rounded-lg">
        <div class="px-3 py-2 border-b border-space-border">
          <span class="text-xs font-semibold text-space-text-dim uppercase">Suggestions</span>
        </div>
        <div class="p-3">
          <div v-if="suggestions.length === 0" class="text-xs text-space-text-dim">
            {{ commanderReasoning || 'No suggestions — current assignments look optimal.' }}
          </div>
          <div v-else class="space-y-2">
            <div 
              v-for="s in suggestions" :key="s.username"
              class="flex items-center justify-between px-3 py-2 rounded border border-space-border bg-space-bg"
            >
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-space-text-bright">{{ s.username }}</span>
                <span class="text-xs text-space-text-dim">{{ s.currentRoutine || 'idle' }}</span>
                <span class="text-space-accent text-xs">→</span>
                <span class="text-xs font-medium text-space-accent">{{ s.suggestedRoutine }}</span>
                <span class="text-[11px] text-space-text-dim">score {{ s.score }}</span>
              </div>
              <button
                @click="applySuggestion(s)"
                :disabled="isBotRunning(s.username)"
                :title="isBotRunning(s.username) ? 'Stop the bot first' : `Apply: start ${s.suggestedRoutine}`"
                class="btn text-xs px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Credit History Chart -->
    <div class="bg-space-card border border-space-border rounded-lg">
      <div class="px-3 py-2 border-b border-space-border flex items-center justify-between">
        <span class="text-xs font-semibold text-space-text-dim uppercase">Credit History (24h)</span>
        <span v-if="creditHistory.length" class="text-xs text-space-text-dim">
          {{ creditHistory.length }} data points
        </span>
      </div>
      <div class="p-3">
        <div v-if="creditHistory.length < 2" class="text-xs text-space-text-dim py-4 text-center">
          Not enough data yet. Credit history is recorded every 60 seconds while bots are active.
        </div>
        <div v-else class="h-40 flex items-end gap-px">
          <div
            v-for="(bar, i) in chartBars" :key="i"
            class="flex-1 bg-space-accent/60 rounded-t-sm hover:bg-space-accent transition-colors relative group"
            :style="{ height: bar.height + '%', minHeight: '2px' }"
          >
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                        bg-space-card border border-space-border rounded px-2 py-1 text-xs whitespace-nowrap z-10">
              ₡{{ fmt(bar.credits) }} ({{ bar.bots }} bots)
              <br>{{ bar.time }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Goals Management -->
    <div class="bg-space-card border border-space-border rounded-lg">
      <div class="px-3 py-2 border-b border-space-border flex items-center justify-between">
        <span class="text-xs font-semibold text-space-text-dim uppercase">Fleet Goals</span>
        <button @click="showAddGoal = !showAddGoal" class="btn btn-primary px-2 py-1 text-xs">
          {{ showAddGoal ? 'Cancel' : '+ Add Goal' }}
        </button>
      </div>
      <div class="p-3">
        <!-- Add Goal Form -->
        <div v-if="showAddGoal" class="mb-3 p-3 border border-space-border rounded bg-space-bg">
          <div class="flex gap-3 items-end">
            <div class="flex-1">
              <label class="text-xs text-space-text-dim">Type</label>
              <select v-model="newGoal.type" class="input w-full mt-1 text-xs">
                <option v-for="t in goalTypes" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div class="w-24">
              <label class="text-xs text-space-text-dim">Priority</label>
              <input v-model.number="newGoal.priority" type="number" min="1" max="10" class="input w-full mt-1 text-xs">
            </div>
            <button @click="addGoal" class="btn btn-primary px-3 py-1.5 text-xs">Add</button>
          </div>
        </div>

        <!-- Goals List -->
        <div v-if="goals.length === 0" class="text-xs text-space-text-dim">
          No goals configured. Add goals to guide the Commander's routine suggestions.
        </div>
        <div v-else class="space-y-2">
          <div 
            v-for="(goal, i) in goals" :key="i"
            class="flex items-center justify-between px-3 py-2 rounded border border-space-border bg-space-bg"
          >
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium text-space-text-bright">{{ goal.type }}</span>
              <span class="text-xs px-2 py-0.5 rounded bg-space-accent/20 text-space-accent">
                priority {{ goal.priority }}
              </span>
            </div>
            <button @click="removeGoal(i)" class="text-xs text-space-red hover:text-red-400 transition-colors">
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Stats Tab -->
  <StatsView v-else-if="activeTab === 'stats'" />

  <!-- Action Log Tab -->
  <ActionLogView v-else-if="activeTab === 'log'" />

  <!-- AI Agent Tab -->
  <div v-else-if="activeTab === 'agent'" class="flex-1 flex flex-col gap-3 p-4 overflow-auto scrollbar-dark">
    <!-- Bot Selector -->
    <div class="card py-2 px-3">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs font-semibold text-space-text-dim uppercase">Bot</span>
        <select v-model="agentBot" class="input text-xs min-w-36">
          <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
        </select>
        <span v-if="agentBotStatus" class="px-2 py-0.5 text-[11px] rounded"
          :class="agentBotStatus === 'running' ? 'bg-green-900/40 text-green-300' : 'bg-[#21262d] text-space-text-dim'">{{ agentBotStatus }}</span>
        <span v-if="agentBotRoutine" class="text-[11px] text-space-cyan">{{ agentBotRoutine }}</span>
        <div class="ml-auto flex gap-2">
          <button v-if="agentBotStatus !== 'running'" @click="startAgent('pi_commander')" class="btn btn-primary text-xs px-3">▶ Start PI Commander</button>
          <button v-if="agentBotStatus !== 'running'" @click="startAgent('ai')" class="btn btn-secondary text-xs px-3">▶ Start AI</button>
          <button v-if="agentBotStatus === 'running'" @click="stopAgent" class="btn text-xs px-3 bg-red-900/40 text-red-300 border-red-700/40 hover:bg-red-900/70">⏹ Stop</button>
        </div>
      </div>
    </div>

    <!-- Instruction Editor -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-space-text-dim uppercase">Mission Instruction</h4>
        <button @click="saveInstruction" class="btn btn-primary text-xs px-3">Save</button>
      </div>
      <textarea v-model="agentInstruction" rows="3" class="input w-full text-xs resize-y font-mono"
        placeholder="Mine ore, sell it, and upgrade your ship when you can afford a better one."></textarea>
      <div class="text-[11px] text-space-text-dim mt-1">Saved to Settings → 🤖 PI Commander and applied on next start.</div>
    </div>

    <!-- TODO Editor -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-space-text-dim uppercase">Agent TODO List</h4>
        <div class="flex gap-2">
          <button @click="loadTodo" :disabled="todoLoading" class="btn btn-secondary text-xs px-3">{{ todoLoading ? '⏳' : '🔄 Load' }}</button>
          <button @click="saveTodo" class="btn btn-primary text-xs px-3">Save</button>
          <button @click="clearTodo" class="btn text-xs px-3 bg-red-900/30 text-red-300 border-red-700/30 hover:bg-red-900/60">🗑️ Clear</button>
        </div>
      </div>
      <textarea v-model="agentTodo" rows="8" class="input w-full text-xs resize-y font-mono"
        placeholder="(empty — load from session to edit)"></textarea>
      <div class="text-[11px] text-space-text-dim mt-1">Session: <span class="text-space-cyan">{{ agentSession }}</span> → sessions/{{ agentSession }}/TODO.md</div>
    </div>

    <!-- Agent Log -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-space-text-dim uppercase">📝 Agent Log</h4>
        <span class="text-[11px] text-space-text-dim">{{ agentLogs.length }} lines</span>
      </div>
      <div class="font-mono text-[11px] leading-relaxed max-h-72 overflow-auto scrollbar-dark space-y-px">
        <div v-if="agentLogs.length === 0" class="text-space-text-dim italic">No log output yet. Start the agent to see activity here.</div>
        <div v-for="(line, i) in agentLogs" :key="i"
          :class="line.includes('[error]') || line.includes('ERROR') ? 'text-space-red' : line.includes('[setup]') || line.includes('[system]') ? 'text-space-text-dim' : line.includes('✓') || line.includes('success') || line.includes('purchased') ? 'text-space-green' : 'text-space-text'">
          {{ line }}
        </div>
      </div>
    </div>
  </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/botStore'
import StatsView from './StatsView.vue'
import ActionLogView from './ActionLogView.vue'

interface EconomyData {
  deficits: Array<{ itemId: string; shortfall: number; priority: string }>
  surpluses: Array<{ itemId: string; excessPerHour: number }>
  totalRevenue: number
  totalCosts: number
  netProfit: number
}

interface Suggestion {
  username: string
  currentRoutine: string | null
  suggestedRoutine: string
  score: number
  reasoning: string
}

interface CommanderResult {
  suggestions: Suggestion[]
  reasoning: string
  timestamp: number
}

interface CreditPoint {
  timestamp: number
  totalCredits: number
  activeBots: number
}

interface Goal {
  type: string
  priority: number
  params?: Record<string, unknown>
}

const botStore = useBotStore()
const TABS = [
  { id: 'advisory', label: '📊 Advisory' },
  { id: 'stats',    label: '📈 Stats'    },
  { id: 'log',      label: '📜 Action Log' },
  { id: 'agent',    label: '🤖 AI Agent'  },
] as const
type TabId = typeof TABS[number]['id']

const activeTab = ref<TabId>('advisory')
const economyData = ref<EconomyData>({ deficits: [], surpluses: [], totalRevenue: 0, totalCosts: 0, netProfit: 0 })
const suggestions = ref<Suggestion[]>([])
const commanderReasoning = ref('')
const lastEvalTime = ref<number | null>(null)
const creditHistory = ref<CreditPoint[]>([])
const goals = ref<Goal[]>([])
const showAddGoal = ref(false)
const newGoal = ref({ type: 'maximize_income', priority: 5 })

const goalTypes = [
  'maximize_income',
  'explore_region',
  'prepare_for_war',
  'level_skills',
  'establish_trade_route',
  'resource_stockpile',
  'faction_operations',
  'custom',
]

let pollTimer: ReturnType<typeof setInterval> | null = null

// ── AI Agent tab state ──────────────────────────────────────

const agentBot = ref(botStore.bots[0]?.username || '')
const agentInstruction = ref('')
const agentTodo = ref('')
const todoLoading = ref(false)

const agentBotObj = computed(() => botStore.bots.find(b => b.username === agentBot.value))
const agentBotStatus = computed(() => agentBotObj.value?.state || '')
const agentBotRoutine = computed(() => agentBotObj.value?.routine || '')
const agentSession = computed(() => {
  const s = botStore.settings?.pi_commander?.session || agentBot.value
  return s || agentBot.value
})
const agentLogs = computed(() => {
  const buf = botStore.botLogBuffers[agentBot.value] || []
  return buf.slice(-100)
})

watch(agentBot, () => {
  const s = botStore.settings?.pi_commander
  agentInstruction.value = (s as any)?.bots?.[agentBot.value]?.instruction || (s as any)?.instruction || ''
})


async function loadTodo() {
  todoLoading.value = true
  try {
    const resp = await fetch(`/api/pi-todo?session=${encodeURIComponent(agentSession.value)}`)
    if (resp.ok) {
      const { content } = await resp.json()
      agentTodo.value = content || ''
    }
  } catch {}
  todoLoading.value = false
}

async function saveTodo() {
  try {
    await fetch('/api/pi-todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: agentSession.value, content: agentTodo.value }),
    })
  } catch {}
}

async function clearTodo() {
  agentTodo.value = ''
  await saveTodo()
}

function saveInstruction() {
  const existing = (botStore.settings?.pi_commander || {}) as Record<string, unknown>
  botStore.saveSettings('pi_commander', { ...existing, instruction: agentInstruction.value })
}

function startAgent(routine: string) {
  if (!agentBot.value) return
  botStore.startBot(agentBot.value, routine)
}

function stopAgent() {
  if (!agentBot.value) return
  botStore.stopBot(agentBot.value)
}

// ── Chart computation ──

const chartBars = computed(() => {
  if (creditHistory.value.length < 2) return []
  const pts = creditHistory.value
  const max = Math.max(...pts.map(p => p.totalCredits), 1)
  // Downsample to max 60 bars
  const step = Math.max(1, Math.floor(pts.length / 60))
  const bars = []
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i]
    bars.push({
      height: (p.totalCredits / max) * 100,
      credits: p.totalCredits,
      bots: p.activeBots,
      time: new Date(p.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
    })
  }
  return bars
})

// ── API calls ──

async function fetchEconomy() {
  try {
    const resp = await fetch('/api/economy')
    if (resp.ok) economyData.value = await resp.json()
  } catch {}
}

async function fetchCommander() {
  try {
    const resp = await fetch('/api/commander')
    if (resp.ok) {
      const data: CommanderResult | null = await resp.json()
      if (data) {
        suggestions.value = data.suggestions
        commanderReasoning.value = data.reasoning
        lastEvalTime.value = data.timestamp
      }
    }
  } catch {}
}

async function fetchCreditHistory() {
  try {
    const resp = await fetch('/api/credit-history?since=86400000')
    if (resp.ok) creditHistory.value = await resp.json()
  } catch {}
}

async function fetchGoals() {
  try {
    const resp = await fetch('/api/goals')
    if (resp.ok) goals.value = await resp.json()
  } catch {}
}

async function saveGoals() {
  try {
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goals.value),
    })
  } catch {}
}

async function addGoal() {
  goals.value.push({ ...newGoal.value })
  await saveGoals()
  showAddGoal.value = false
  newGoal.value = { type: 'maximize_income', priority: 5 }
}

async function removeGoal(index: number) {
  goals.value.splice(index, 1)
  await saveGoals()
}

async function refreshAll() {
  await Promise.all([fetchEconomy(), fetchCommander(), fetchCreditHistory(), fetchGoals()])
}

function isBotRunning(username: string): boolean {
  return botStore.bots.find(b => b.username === username)?.state === 'running'
}

function applySuggestion(s: Suggestion): void {
  if (isBotRunning(s.username)) return
  botStore.startBot(s.username, s.suggestedRoutine)
}

// ── Formatting ──

function fmt(n: number | undefined): string {
  if (n == null) return '0'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toLocaleString()
}

function formatItemName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatTimeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── Lifecycle ──

onMounted(() => {
  if (botStore.bots.length > 0 && !agentBot.value) agentBot.value = botStore.bots[0].username
  const s = botStore.settings?.pi_commander
  agentInstruction.value = (s as any)?.instruction || ''
  refreshAll()
  pollTimer = setInterval(refreshAll, 30_000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>
