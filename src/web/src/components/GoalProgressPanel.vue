<template>
  <div class="bg-[#0d1117] border border-space-border rounded-lg p-3 space-y-2 text-xs">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-space-text font-semibold truncate">📋 {{ goal.target_name }}</div>
        <div class="text-[10px] text-space-text-dim capitalize">{{ goal.type }} build goal</div>
      </div>
      <span class="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" :class="statusClass(goal.status)">
        {{ statusLabel(goal.status) }}
      </span>
    </div>

    <!-- Overall progress bar -->
    <div class="flex items-center gap-2">
      <div class="flex-1 bg-[#21262d] rounded-full h-1.5">
        <div
          class="h-full rounded-full transition-all"
          :class="progressPct === 100 ? 'bg-green-500' : 'bg-space-accent'"
          :style="{ width: progressPct + '%' }"
        ></div>
      </div>
      <span class="text-[10px] text-space-text-dim shrink-0">{{ readyCount }}/{{ goal.materials.length }} items</span>
    </div>

    <!-- Material list -->
    <div class="space-y-0.5 max-h-44 overflow-auto scrollbar-dark">
      <div
        v-for="mat in goal.materials"
        :key="mat.item_id"
        class="flex items-start gap-1.5 rounded px-1.5 py-1"
        :class="mat.quantity_have >= mat.quantity_needed ? 'bg-green-900/10' : 'bg-space-bg'"
      >
        <span class="mt-0.5 shrink-0 text-[12px]">{{ acquisitionIcon(mat.acquisition) }}</span>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-baseline gap-1">
            <span class="text-space-text truncate">{{ mat.item_name }}</span>
            <span
              class="shrink-0 font-mono text-[10px]"
              :class="mat.quantity_have >= mat.quantity_needed ? 'text-green-400' : 'text-space-text-dim'"
            >{{ mat.quantity_have }}/{{ mat.quantity_needed }}</span>
          </div>
          <!-- Source info -->
          <div v-if="mat.acquisition === 'buy' && mat.buy_source" class="text-[10px] text-space-text-dim mt-0.5 truncate">
            🛒 {{ mat.buy_source.station_name }}
            <span class="text-space-yellow">{{ mat.buy_source.price.toLocaleString() }} cr/ea</span>
            <span v-if="mat.buy_source.stock < (mat.quantity_needed - mat.quantity_have)" class="text-orange-400 ml-1">
              ⚠️ only {{ mat.buy_source.stock }} in stock
            </span>
          </div>
          <div v-else-if="mat.acquisition === 'mine'" class="text-[10px] text-space-text-dim mt-0.5">
            ⛏️ Mine{{ mat.mine_source?.system_name ? ' in ' + mat.mine_source.system_name : ' at asteroid belt' }}
          </div>
          <div v-else-if="mat.acquisition === 'unknown' && mat.quantity_have < mat.quantity_needed" class="text-[10px] text-orange-400/80 mt-0.5">
            ❓ Unknown source — visit markets to scan
          </div>
        </div>
      </div>
    </div>

    <!-- Acquisition summary badges -->
    <div class="flex flex-wrap gap-1 text-[10px]">
      <span v-if="countByAcq('have')" class="px-1.5 py-0.5 rounded bg-green-900/20 text-green-400">✅ {{ countByAcq('have') }} in cargo</span>
      <span v-if="countByAcq('buy')" class="px-1.5 py-0.5 rounded bg-blue-900/20 text-blue-400">🛒 {{ countByAcq('buy') }} to buy</span>
      <span v-if="countByAcq('mine')" class="px-1.5 py-0.5 rounded bg-yellow-900/20 text-yellow-400">⛏️ {{ countByAcq('mine') }} to mine</span>
      <span v-if="countByAcq('unknown')" class="px-1.5 py-0.5 rounded bg-orange-900/20 text-orange-400">❓ {{ countByAcq('unknown') }} unknown</span>
    </div>

    <!-- Bot assignment + action controls -->
    <div class="flex items-center gap-1.5 pt-1 border-t border-[#21262d]">
      <span class="text-[10px] text-space-text-dim shrink-0">Bot:</span>
      <select
        :value="goal.assigned_bot"
        @change="emit('assign', ($event.target as HTMLSelectElement).value)"
        class="flex-1 bg-space-bg border border-space-border rounded px-1.5 py-0.5 text-[10px] text-space-text focus:border-space-accent outline-none min-w-0"
      >
        <option v-for="bot in bots" :key="bot" :value="bot">{{ bot }}</option>
      </select>

      <button
        v-if="goal.status === 'paused'"
        @click="emit('resume')"
        class="btn text-[10px] px-2 py-0.5 whitespace-nowrap"
      >▶ Resume</button>
      <button
        v-else-if="goal.status !== 'done'"
        @click="emit('pause')"
        class="btn text-[10px] px-2 py-0.5 whitespace-nowrap"
      >⏸ Pause</button>

      <button
        v-if="goal.status === 'ready'"
        @click="emit('build')"
        class="btn btn-primary text-[10px] px-2 py-0.5 whitespace-nowrap"
      >🔨 Build!</button>

      <button
        @click="emit('delete')"
        title="Remove goal"
        class="btn text-[10px] px-2 py-0.5 text-red-400 border-red-900/40 hover:bg-red-900/20 whitespace-nowrap"
      >🗑</button>
    </div>

    <div v-if="hasUnknown" class="text-[10px] text-space-text-dim/70 italic">
      💡 Dock at stations to auto-discover sources for unknown materials.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BuildGoal } from '../stores/goalStore'

const props = defineProps<{
  goal: BuildGoal
  bots: string[]
}>()

const emit = defineEmits<{
  assign: [bot: string]
  pause: []
  resume: []
  delete: []
  build: []
}>()

const readyCount = computed(() =>
  props.goal.materials.filter(m => m.quantity_have >= m.quantity_needed).length,
)

const progressPct = computed(() =>
  props.goal.materials.length > 0
    ? Math.round((readyCount.value / props.goal.materials.length) * 100)
    : 0,
)

const hasUnknown = computed(() =>
  props.goal.materials.some(m => m.acquisition === 'unknown' && m.quantity_have < m.quantity_needed),
)

function countByAcq(acq: string): number {
  return props.goal.materials.filter(m => m.acquisition === acq && m.quantity_have < m.quantity_needed).length
}

function acquisitionIcon(a: string): string {
  switch (a) {
    case 'have':  return '✅'
    case 'buy':   return '🛒'
    case 'mine':  return '⛏️'
    case 'craft': return '🔨'
    default:      return '❓'
  }
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    analyzing: 'Analyzing',
    acquiring: 'In Progress',
    ready:     'Ready to Build',
    building:  'Building…',
    done:      'Done',
    paused:    'Paused',
  }
  return map[s] || s
}

function statusClass(s: string): string {
  const map: Record<string, string> = {
    analyzing: 'bg-space-text-dim/20 text-space-text-dim',
    acquiring: 'bg-blue-900/30 text-blue-400',
    ready:     'bg-green-900/30 text-green-400',
    building:  'bg-space-accent/20 text-space-accent',
    done:      'bg-green-900/30 text-green-400',
    paused:    'bg-yellow-900/30 text-yellow-400',
  }
  return map[s] || 'bg-space-text-dim/20 text-space-text-dim'
}
</script>
