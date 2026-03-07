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
  <div v-if="activeTab === 'advisory'" class="flex-1 flex flex-col gap-2 p-2 overflow-auto scrollbar-dark">
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
    <div class="flex gap-2">
      <!-- Economy Summary -->
      <div class="flex-1 bg-space-card border border-space-border rounded-lg">
        <div class="px-2 py-1 border-b border-space-border flex items-center justify-between">
          <span class="text-xs font-semibold text-space-text-dim uppercase">Economy</span>
          <div v-if="economyData.totalRevenue > 0 || economyData.totalCosts > 0" class="flex gap-2 text-xs">
            <span class="text-space-green" title="Credits earned today">Rev: ⃁{{ fmt(economyData.totalRevenue) }}</span>
            <span class="text-space-red" title="Credits spent today">Cost: ⃁{{ fmt(economyData.totalCosts) }}</span>
            <span :class="economyData.netProfit >= 0 ? 'text-space-green' : 'text-space-red'" title="Net profit today">
              Net: ⃁{{ fmt(economyData.netProfit) }}
            </span>
          </div>
        </div>
        <div class="p-3 space-y-3">
          <!-- Active material requests from crafters -->
          <div v-if="economyData.materialNeeds?.length">
            <span class="text-xs text-space-text-dim uppercase font-semibold" title="Materials currently requested by crafters via cooperative delivery">Material Needs</span>
            <div class="mt-1 flex flex-wrap gap-2">
              <div
                v-for="d in economyData.materialNeeds" :key="d.bot + d.itemId"
                class="px-2 py-1 rounded text-xs border border-space-accent bg-space-accent/10 text-space-accent"
                :title="`${d.bot} needs ${d.quantity}x ${d.itemId}` + (d.stationPoiId ? ` at ${d.stationPoiId}` : '')"
              >
                {{ formatItemName(d.itemId) }} ×{{ d.quantity }}
                <span class="opacity-60">← {{ d.bot }}</span>
              </div>
            </div>
          </div>
          <!-- Observed supply deficits (based on actual production/consumption rates) -->
          <div v-if="economyData.deficits?.length">
            <span class="text-xs text-space-text-dim uppercase font-semibold" title="Items consumed faster than they are produced (based on observed rates)">Production Gaps</span>
            <div class="mt-1 flex flex-wrap gap-2">
              <div
                v-for="d in economyData.deficits" :key="d.itemId"
                class="px-2 py-1 rounded text-xs border"
                :class="d.priority === 'critical' ? 'border-space-red bg-space-red/10 text-space-red' : 'border-space-yellow bg-space-yellow/10 text-space-yellow'"
              >
                {{ formatItemName(d.itemId) }}: -{{ d.shortfall.toFixed(1) }}/hr
              </div>
            </div>
          </div>
          <!-- Surpluses -->
          <div v-if="economyData.surpluses?.length">
            <span class="text-xs text-space-text-dim uppercase font-semibold" title="Items produced faster than they are consumed">Surplus Production</span>
            <div class="mt-1 flex flex-wrap gap-2">
              <div
                v-for="s in economyData.surpluses" :key="s.itemId"
                class="px-2 py-1 rounded text-xs border border-space-green bg-space-green/10 text-space-green"
              >
                {{ formatItemName(s.itemId) }}: +{{ s.excessPerHour.toFixed(1) }}/hr
              </div>
            </div>
          </div>
          <div v-if="!economyData.materialNeeds?.length && !economyData.deficits?.length && !economyData.surpluses?.length" class="text-xs text-space-text-dim">
            No active data. Material needs appear when crafters request cooperative delivery; production gaps appear after bots have been running for a while.
          </div>
        </div>
      </div>

      <!-- Commander Suggestions -->
      <div class="flex-1 bg-space-card border border-space-border rounded-lg">
        <div class="px-2 py-1 border-b border-space-border">
          <span class="text-xs font-semibold text-space-text-dim uppercase">Suggestions</span>
        </div>
        <div class="p-3">
          <div v-if="suggestions.length === 0" class="text-xs text-space-text-dim">
            {{ commanderReasoning || 'No suggestions — current assignments look optimal.' }}
          </div>
          <div v-else class="space-y-2">
            <div 
              v-for="s in suggestions" :key="s.username"
              class="flex items-center justify-between px-2 py-1 rounded border border-space-border bg-space-bg"
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
      <div class="px-2 py-1 border-b border-space-border flex items-center justify-between">
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
  </div>

  <!-- Goals Tab -->
  <div v-else-if="activeTab === 'goals'" class="flex-1 flex flex-col gap-2 p-2 overflow-auto scrollbar-dark">

    <!-- Gather Goals -->
    <div class="bg-space-card border border-space-border rounded-lg">
      <div class="px-2 py-1 border-b border-space-border flex items-center justify-between">
        <span class="text-xs font-semibold text-space-text-dim uppercase">Gather Goals</span>
        <span class="text-xs text-space-text-dim">{{ gathererGoals.length }} active</span>
      </div>
      <div class="p-3">
        <div v-if="!gathererGoals.length" class="text-xs text-space-text-dim italic">
          No gather goals active. Set from Station → Build tab, Faction → Buildings, or Shipyard → Commission.
        </div>
        <div v-else class="grid grid-cols-4 gap-2.5 mb-2">
          <div v-for="entry in gathererGoals" :key="entry.username + ':' + entry.goal.id"
            class="flex flex-col p-3 rounded-md border bg-space-bg"
            :class="(!entry.goal.target_system || !entry.goal.target_poi) && !entry.goal.target_bot ? 'border-space-red/40' : 'border-space-border'">
            <!-- Header row -->
            <div class="flex items-center justify-between mb-1.5">
              <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span class="text-[11px] px-1.5 py-0.5 rounded bg-[#21262d] text-space-accent font-mono shrink-0">{{ entry.username }}</span>
                <span class="text-sm text-space-text-bright font-medium truncate">{{ entry.goal.target_name }}</span>
                <span v-if="entry.goal.goal_type === 'crafter'" class="text-[10px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 shrink-0">crafter</span>
                <span v-else-if="entry.goal.goal_type === 'craft'" class="text-[10px] px-1 py-0.5 rounded bg-space-yellow/20 text-space-yellow shrink-0">craft</span>
                <span v-else class="text-[10px] px-1 py-0.5 rounded bg-space-accent/10 text-space-text-dim shrink-0">build</span>
                <span v-if="entry.state === 'running' && entry.routine === 'gatherer'" class="text-[10px] px-1.5 py-0.5 rounded bg-space-green/20 text-space-green shrink-0">running</span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs font-bold" :class="entry.overallPct >= 100 ? 'text-space-green' : 'text-space-text-dim'">{{ entry.overallPct }}%</span>
                <button @click="clearGathererGoal(entry.username, entry.goal.id)" class="btn btn-secondary text-xs px-2 py-0.5">✕</button>
              </div>
            </div>
            <!-- Location / extra info -->
            <div class="text-[11px] text-space-text-dim mb-1">
              <span v-if="entry.goal.target_system && entry.goal.target_poi">{{ entry.goal.target_system }} · {{ entry.goal.target_poi }}</span>
              <span v-else-if="entry.goal.target_bot" class="text-space-text-dim italic">📍 station resolved dynamically from {{ entry.goal.target_bot }}</span>
              <span v-else class="text-space-red">⚠ target station not set — goal will fail</span>
            </div>
            <div v-if="entry.goal.gift_target" class="text-[11px] text-space-yellow mb-1">🎁 gift → {{ entry.goal.gift_target }}</div>
            <div v-if="entry.goal.crafter_bot" class="text-[11px] text-space-cyan mb-1">🔧 crafter: {{ entry.goal.crafter_bot }}</div>
            <!-- Overall progress bar -->
            <div class="h-1.5 bg-space-border rounded-full mb-2.5">
              <div class="h-full rounded-full transition-all duration-500"
                :class="entry.overallPct >= 100 ? 'bg-space-green' : 'bg-space-accent'"
                :style="{ width: Math.min(entry.overallPct, 100) + '%' }"></div>
            </div>
            <!-- Per-material rows -->
            <div class="space-y-1.5">
              <div v-for="m in entry.materials" :key="m.item_id" class="flex items-center gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between text-[11px] mb-0.5">
                    <span class="text-space-text truncate">{{ m.item_name }}</span>
                    <span class="shrink-0 ml-2" :class="m.pct >= 100 ? 'text-space-green' : 'text-space-text-dim'">{{ m.collected }}/{{ m.quantity_needed }}</span>
                  </div>
                  <div class="h-1 bg-space-border rounded-full">
                    <div class="h-full rounded-full transition-all duration-500"
                      :class="m.pct >= 100 ? 'bg-space-green' : 'bg-space-accent/60'"
                      :style="{ width: Math.min(m.pct, 100) + '%' }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Craft Planner -->
    <div class="bg-space-card border border-space-border rounded-lg">
      <div class="px-2 py-1 border-b border-space-border flex items-center justify-between">
        <span class="text-xs font-semibold text-space-text-dim uppercase">Craft Planner</span>
        <span class="text-[10px] text-space-text-dim">Recipe dependency tree → gather goal</span>
      </div>
      <div class="p-3">
        <!-- Controls -->
        <div class="flex gap-2 items-end mb-3 flex-wrap">
          <div class="flex-1 min-w-32">
            <label class="text-[10px] text-space-text-dim">Target item</label>
            <select v-model="craftPlan.itemId" class="input w-full mt-0.5 text-xs">
              <option value="">— select item —</option>
              <option v-for="r in craftableItems" :key="r.item_id" :value="r.item_id">{{ r.name }}</option>
            </select>
          </div>
          <div class="w-20">
            <label class="text-[10px] text-space-text-dim">Quantity</label>
            <input v-model.number="craftPlan.quantity" type="number" min="1" class="input w-full mt-0.5 text-xs">
          </div>
          <!-- For 'crafter' type the primary selection is Crafter bot; for build/craft it's Gatherer bot -->
          <div v-if="craftPlan.goalType === 'crafter'" class="flex-1 min-w-32">
            <label class="text-[10px] text-purple-300">Crafter bot</label>
            <select v-model="craftPlan.crafterBot" class="input w-full mt-0.5 text-xs">
              <option value="">— select crafter —</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
          </div>
          <div v-else class="flex-1 min-w-32">
            <label class="text-[10px] text-space-text-dim">Gatherer bot</label>
            <select v-model="craftPlan.botName" class="input w-full mt-0.5 text-xs">
              <option value="">— select gatherer —</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
          </div>
          <button @click="analyzeCraftPlan" :disabled="!craftPlan.itemId" class="btn btn-primary px-3 py-1.5 text-xs self-end">Analyze</button>
        </div>
        <!-- Goal options row -->
        <div class="flex gap-2 items-end mb-2 flex-wrap">
          <div>
            <label class="text-[10px] text-space-text-dim">Goal type</label>
            <select v-model="craftPlan.goalType" class="input mt-0.5 text-xs">
              <option value="build">build — gather → deposit to storage</option>
              <option value="craft">craft — gather → deliver to crafter bot</option>
              <option value="crafter">crafter — crafter crafts, gatherer delivers materials</option>
            </select>
          </div>
          <!-- craft type: need separate crafter bot field -->
          <div v-if="craftPlan.goalType === 'craft'" class="flex-1 min-w-32">
            <label class="text-[10px] text-space-yellow">Crafter bot (materials delivered here)</label>
            <select v-model="craftPlan.crafterBot" class="input w-full mt-0.5 text-xs">
              <option value="">— select crafter —</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
          </div>
          <!-- crafter type: gatherer is optional (any gatherer will pick up) -->
          <div v-if="craftPlan.goalType === 'crafter'" class="flex-1 min-w-32">
            <label class="text-[10px] text-space-text-dim">Gatherer bot (optional — blank = any)</label>
            <select v-model="craftPlan.botName" class="input w-full mt-0.5 text-xs">
              <option value="">— any available gatherer —</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
          </div>
          <div class="flex-1 min-w-32">
            <label class="text-[10px] text-space-text-dim">Gift target (optional)</label>
            <input v-model="craftPlan.giftTarget" placeholder="username or leave blank" class="input w-full mt-0.5 text-xs">
          </div>
        </div>

        <!-- Result -->
        <div v-if="craftPlanResult">
          <!-- Summary + action -->
          <div class="flex items-center gap-3 mb-2">
            <span v-if="craftPlanNeeds.length === 0" class="text-xs text-green-400">✓ All materials already available — ready to craft!</span>
            <span v-else class="text-xs text-space-text">{{ craftPlanNeeds.length }} material type(s) need gathering</span>
            <button
              v-if="craftPlanNeeds.length > 0 && (craftPlan.goalType === 'crafter' ? craftPlan.crafterBot : craftPlan.botName)"
              @click="createCraftGatherGoal"
              class="btn btn-primary px-2 py-0.5 text-xs"
            >📦 {{ craftPlan.goalType === 'crafter' ? `Create Crafter Goal → ${craftPlan.crafterBot}` : craftPlan.goalType === 'craft' ? `Create Craft Goal → ${craftPlan.botName}` : `Create Gather Goal → ${craftPlan.botName}` }}</button>
          </div>

          <!-- Gather needs summary -->
          <div v-if="craftPlanNeeds.length" class="mb-3 p-2 rounded border border-orange-800/40 bg-orange-900/10">
            <div class="text-[10px] text-orange-300 uppercase font-semibold mb-1.5">📦 Items to gather:</div>
            <div v-for="need in craftPlanNeeds" :key="need.item_id" class="flex items-center justify-between text-xs py-0.5">
              <span class="text-space-text">{{ need.item_name }}</span>
              <span class="text-orange-400 font-bold tabular-nums">×{{ need.quantity_needed }}</span>
            </div>
          </div>

          <!-- Dependency tree (flat, indented) -->
          <div class="text-[10px] text-space-text-dim uppercase font-semibold mb-1">Dependency tree:</div>
          <div class="font-mono text-[11px] space-y-0.5 max-h-56 overflow-auto scrollbar-dark bg-[#0d1117] rounded p-2">
            <div
              v-for="(row, i) in flattenedTree"
              :key="i"
              class="flex items-center gap-1.5"
              :style="{ paddingLeft: (row.depth * 14) + 'px' }"
            >
              <span :class="row.node.is_satisfied ? 'text-green-400' : row.node.is_leaf ? 'text-orange-400' : 'text-blue-400'">{{ row.node.is_satisfied ? '✓' : row.node.is_leaf ? '◆' : '◇' }}</span>
              <span :class="row.node.is_satisfied ? 'text-space-text-dim line-through' : row.node.is_leaf ? 'text-orange-300' : 'text-space-text'">{{ row.node.item_name }}</span>
              <span class="text-space-text-dim">×{{ row.node.quantity_needed }}</span>
              <span v-if="row.node.quantity_available > 0" class="text-green-400/70">({{ row.node.quantity_available }} avail)</span>
              <span v-if="row.node.crafts_needed > 0" class="text-blue-400/60">→ {{ row.node.crafts_needed }}× craft</span>
            </div>
          </div>
          <div class="flex gap-3 mt-1.5 text-[10px] text-space-text-dim">
            <span><span class="text-green-400">✓</span> satisfied</span>
            <span><span class="text-blue-400">◇</span> craft</span>
            <span><span class="text-orange-400">◆</span> gather</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Goals Management -->
    <div class="bg-space-card border border-space-border rounded-lg">
      <div class="px-2 py-1 border-b border-space-border flex items-center justify-between">
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
            class="flex items-center justify-between px-2 py-1 rounded border border-space-border bg-space-bg"
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

  <!-- Missions Tab -->
  <MissionsView v-else-if="activeTab === 'missions'" />

  <!-- Stats Tab -->
  <StatsView v-else-if="activeTab === 'stats'" />

  <!-- Action Log Tab -->
  <ActionLogView v-else-if="activeTab === 'log'" />

  <!-- AI Agent Tab -->
  <div v-else-if="activeTab === 'agent'" class="flex-1 flex flex-col gap-3 p-2 overflow-auto scrollbar-dark">
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
import { ref, computed, reactive, watch, onMounted, onUnmounted } from 'vue'
import { useBotStore } from '../stores/botStore'
import StatsView from './StatsView.vue'
import ActionLogView from './ActionLogView.vue'
import MissionsView from './MissionsView.vue'
import { buildRecipeIndex, buildNode, extractGatherNeeds, buildAvailabilityMap } from '../utils/recipeTree'
import type { RecipeNode, GatherNeed } from '../utils/recipeTree'

interface EconomyData {
  deficits: Array<{ itemId: string; shortfall: number; priority: string }>
  surpluses: Array<{ itemId: string; excessPerHour: number }>
  materialNeeds: Array<{ bot: string; itemId: string; quantity: number; stationPoiId?: string }>
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
  { id: 'goals',    label: '🎯 Goals'     },
  { id: 'missions', label: '🏹 Missions'  },
  { id: 'stats',    label: '📈 Stats'     },
  { id: 'log',      label: '📜 Action Log' },
  { id: 'agent',    label: '🤖 AI Agent'  },
] as const
type TabId = typeof TABS[number]['id']

const activeTab = ref<TabId>('advisory')
const economyData = ref<EconomyData>({ deficits: [], surpluses: [], materialNeeds: [], totalRevenue: 0, totalCosts: 0, netProfit: 0 })
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

// Auto-sync agentBot when a bot profile is opened from another page
watch(() => botStore.selectedBot, (username) => {
  if (username && username !== agentBot.value) agentBot.value = username
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

// ── Craft Planner ────────────────────────────────────────────

const craftPlan = reactive({ itemId: '', quantity: 1, botName: '', goalType: 'build' as 'build' | 'craft' | 'crafter', crafterBot: '', giftTarget: '' })
const craftPlanResult = ref<RecipeNode | null>(null)
const craftPlanNeeds = ref<GatherNeed[]>([])

const craftableItems = computed(() => {
  const recipes = (botStore.catalog?.recipes || {}) as Record<string, Record<string, unknown>>
  const items = (botStore.catalog?.items || {}) as Record<string, { name?: string }>
  const index = buildRecipeIndex(recipes)
  return [...index.values()]
    .map(r => ({ item_id: r.output_item_id, name: items[r.output_item_id]?.name || r.output_name }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

function analyzeCraftPlan() {
  if (!craftPlan.itemId || craftPlan.quantity < 1) return
  const catalog = botStore.catalog || { recipes: {}, items: {} }
  const recipeIndex = buildRecipeIndex((catalog.recipes || {}) as Record<string, Record<string, unknown>>)
  const rawItems = (catalog.items || {}) as Record<string, { name?: string }>
  const itemNames = new Map(Object.entries(rawItems).map(([id, item]) => [id, item.name || id]))
  // For crafter type check the crafter's materials; otherwise the gatherer's materials
  const checkerName = craftPlan.goalType === 'crafter' ? craftPlan.crafterBot : craftPlan.botName
  const bot = botStore.bots.find(b => b.username === checkerName)
  const available = bot ? buildAvailabilityMap(bot as any) : new Map<string, number>()
  craftPlanResult.value = buildNode(craftPlan.itemId, craftPlan.quantity, itemNames, recipeIndex, available)
  craftPlanNeeds.value = extractGatherNeeds(craftPlanResult.value)
}

function createCraftGatherGoal() {
  if (!craftPlanNeeds.value.length) return
  const isCrafterType = craftPlan.goalType === 'crafter'
  // crafter type: goal saved to crafter's settings; craft/build: saved to gatherer's settings
  const goalOwnerBot = isCrafterType ? craftPlan.crafterBot : craftPlan.botName
  if (!goalOwnerBot) return
  // Materials delivered to crafter's station for 'craft'/'crafter'; gatherer's station for 'build'
  const targetBotName = craftPlan.goalType !== 'build' && craftPlan.crafterBot
    ? craftPlan.crafterBot
    : craftPlan.botName
  const targetBot = botStore.bots.find(b => b.username === targetBotName) as any
  const rawItems = (botStore.catalog?.items || {}) as Record<string, { name?: string }>
  const targetName = rawItems[craftPlan.itemId]?.name || craftPlan.itemId
  // Resolve station: prefer a station POI in current system, fallback homePoI/homeSystem
  const mapSys = targetBot?.system ? (botStore.mapData[targetBot.system] as any) : null
  const isStationPoi = (poiId: string) => !!(mapSys?.pois?.find((p: any) => p.id === poiId)?.has_base)
  const resolvedPoi = (targetBot?.poi && isStationPoi(targetBot.poi))
    ? targetBot.poi
    : (targetBot?.homePoI || '')
  const resolvedSystem = resolvedPoi
    ? (targetBot?.system || targetBot?.homeSystem || '')
    : (targetBot?.homeSystem || '')
  const newGoal: any = {
    id: `${craftPlan.goalType}_${craftPlan.itemId}_${Date.now()}`,
    target_id: craftPlan.itemId,
    target_name: targetName,
    goal_type: craftPlan.goalType,
    target_bot: targetBotName,
    target_poi: resolvedPoi,
    target_system: resolvedSystem,
    materials: craftPlanNeeds.value.map(n => ({
      item_id: n.item_id,
      item_name: n.item_name,
      quantity_needed: n.quantity_needed,
    })),
  }
  if (craftPlan.goalType !== 'build' && craftPlan.crafterBot) newGoal.crafter_bot = craftPlan.crafterBot
  if (craftPlan.giftTarget.trim()) newGoal.gift_target = craftPlan.giftTarget.trim()
  // Warn only when both poi+system are empty AND no target_bot for dynamic resolution
  if (!newGoal.target_poi && !newGoal.target_system) {
    const ok = confirm(`⚠ Could not resolve station for '${targetBotName}' (not docked and no homePoI set).\nStation will be resolved dynamically at delivery time.\n\nCreate goal anyway?`)
    if (!ok) return
  }
  const botSettings = (botStore.settings as any)?.[goalOwnerBot] || {}
  const existing: any[] = botSettings.goals?.length
    ? botSettings.goals
    : (botSettings.goal ? [botSettings.goal] : [])
  botStore.saveSettings(goalOwnerBot, { goals: [...existing, newGoal], goal: null })
}

function flattenTree(node: RecipeNode, depth = 0): Array<{ node: RecipeNode; depth: number }> {
  return [
    { node, depth },
    ...node.children.flatMap(c => flattenTree(c, depth + 1)),
  ]
}

const flattenedTree = computed(() =>
  craftPlanResult.value ? flattenTree(craftPlanResult.value) : []
)

// ── Gather Goals ───────────────────────────────────────────

const gathererGoals = computed(() => {
  const result: Array<{ username: string; state: string; routine?: string; goal: any; materials: any[]; overallPct: number }> = []
  for (const b of botStore.bots) {
    const botSettings = (botStore.settings as any)?.[b.username] || {}
    const rawGoals: any[] = botSettings.goals?.length
      ? botSettings.goals
      : (botSettings.goal ? [botSettings.goal] : [])
    for (const goal of rawGoals) {
      const materials = (goal.materials || []).map((m: any) => {
        const inFaction = b.factionStorage?.find((i: any) => i.itemId === m.item_id)?.quantity ?? 0
        const inCargo = b.inventory?.find((i: any) => i.itemId === m.item_id)?.quantity ?? 0
        const collected = Math.min(inFaction + inCargo, m.quantity_needed)
        const pct = m.quantity_needed > 0 ? Math.round(collected / m.quantity_needed * 100) : 0
        return { ...m, collected, pct }
      })
      const totalNeeded = materials.reduce((s: number, m: any) => s + m.quantity_needed, 0)
      const totalCollected = materials.reduce((s: number, m: any) => s + m.collected, 0)
      const overallPct = totalNeeded > 0 ? Math.round(totalCollected / totalNeeded * 100) : 0
      result.push({ username: b.username, state: b.state, routine: b.routine, goal, materials, overallPct })
    }
  }
  return result
})

function clearGathererGoal(username: string, goalId: string) {
  const botSettings = (botStore.settings as any)?.[username] || {}
  const rawGoals: any[] = botSettings.goals?.length
    ? botSettings.goals
    : (botSettings.goal ? [botSettings.goal] : [])
  const filtered = rawGoals.filter((g: any) => g.id !== goalId)
  botStore.saveSettings(username, { goals: filtered, goal: null })
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
