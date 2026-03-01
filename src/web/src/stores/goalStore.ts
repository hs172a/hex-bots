import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface MaterialTask {
  item_id: string
  item_name: string
  quantity_needed: number
  quantity_have: number
  acquisition: 'have' | 'buy' | 'mine' | 'craft' | 'unknown'
  buy_source?: {
    station_id: string
    station_name: string
    system_id: string
    price: number
    stock: number
  }
  mine_source?: {
    system_id: string
    system_name: string
  }
}

export interface BuildGoal {
  id: string
  type: 'ship' | 'factory' | 'recipe'
  target_id: string
  target_name: string
  assigned_bot: string
  materials: MaterialTask[]
  status: 'analyzing' | 'acquiring' | 'ready' | 'building' | 'done' | 'paused'
  created_at: number
}

export interface MarketEntry {
  item_id: string
  station_id: string
  station_name: string
  system_id: string
  sell_price: number
  sell_quantity: number
}

const STORAGE_KEY = 'spacemolt_build_goals'

const MINEABLE_PATTERNS = [
  /^ore_/i, /^raw_/i, /^mineral_/i, /^crystal_/i, /^dust_/i,
  /^gas_/i, /^plasma_/i, /^ice_/i, /^rock_/i, /^alloy_/i,
  /iron/i, /titanite/i, /carbon/i, /silicate/i, /helium/i,
]

function isMineable(itemId: string): boolean {
  return MINEABLE_PATTERNS.some(p => p.test(itemId))
}

function cargoMap(cargo: any[], storage: any[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of [...cargo, ...storage]) {
    const id = item.item_id || item.itemId || item.id
    const qty = Number(item.quantity ?? item.qty ?? item.amount ?? 0)
    if (id) map[id] = (map[id] || 0) + qty
  }
  return map
}

export const useGoalStore = defineStore('goal', () => {
  const goals = ref<BuildGoal[]>([])

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) goals.value = JSON.parse(raw)
    } catch { /* ignore */ }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(goals.value))
    } catch { /* ignore */ }
  }

  function createGoal(
    type: BuildGoal['type'],
    targetId: string,
    targetName: string,
    rawMaterials: { item_id: string; item_name: string; quantity: number }[],
    assignedBot: string,
  ): BuildGoal {
    // Replace any existing non-done goal for the same target
    goals.value = goals.value.filter(
      g => !(g.target_id === targetId && g.type === type && g.status !== 'done'),
    )

    const goal: BuildGoal = {
      id: `${type}_${targetId}_${Date.now()}`,
      type,
      target_id: targetId,
      target_name: targetName,
      assigned_bot: assignedBot,
      materials: rawMaterials.map(m => ({
        item_id: m.item_id,
        item_name: m.item_name,
        quantity_needed: m.quantity,
        quantity_have: 0,
        acquisition: 'unknown' as const,
      })),
      status: 'analyzing',
      created_at: Date.now(),
    }
    goals.value.push(goal)
    saveToStorage()
    return goal
  }

  /**
   * Classify acquisition method for each missing material.
   * Cheapest market source wins; item_id patterns determine mineability.
   */
  function analyzeGoal(
    goalId: string,
    cargo: any[],
    storage: any[],
    marketEntries: MarketEntry[],
  ) {
    const goal = goals.value.find(g => g.id === goalId)
    if (!goal) return

    const have = cargoMap(cargo, storage)

    // Build cheapest-market lookup per item_id
    const cheapest: Record<string, MarketEntry> = {}
    for (const e of marketEntries) {
      if (e.sell_quantity > 0) {
        if (!cheapest[e.item_id] || e.sell_price < cheapest[e.item_id].sell_price) {
          cheapest[e.item_id] = e
        }
      }
    }

    for (const task of goal.materials) {
      task.quantity_have = Math.min(have[task.item_id] || 0, task.quantity_needed)

      if (task.quantity_have >= task.quantity_needed) {
        task.acquisition = 'have'
        task.buy_source = undefined
        task.mine_source = undefined
        continue
      }

      const mkt = cheapest[task.item_id]
      if (mkt) {
        task.acquisition = 'buy'
        task.buy_source = {
          station_id: mkt.station_id,
          station_name: mkt.station_name,
          system_id: mkt.system_id,
          price: mkt.sell_price,
          stock: mkt.sell_quantity,
        }
        task.mine_source = undefined
        continue
      }

      if (isMineable(task.item_id)) {
        task.acquisition = 'mine'
        task.buy_source = undefined
        continue
      }

      task.acquisition = 'unknown'
    }

    const allHave = goal.materials.every(m => m.quantity_have >= m.quantity_needed)
    if (allHave) {
      goal.status = 'ready'
    } else if (goal.status === 'analyzing') {
      goal.status = 'acquiring'
    }

    saveToStorage()
  }

  /** Refresh quantity_have from current bot cargo without re-classifying sources. */
  function updateProgress(goalId: string, cargo: any[], storage: any[] = []) {
    const goal = goals.value.find(g => g.id === goalId)
    if (!goal) return

    const have = cargoMap(cargo, storage)
    for (const task of goal.materials) {
      task.quantity_have = Math.min(have[task.item_id] || 0, task.quantity_needed)
      if (task.quantity_have >= task.quantity_needed && task.acquisition !== 'have') {
        task.acquisition = 'have'
        task.buy_source = undefined
        task.mine_source = undefined
      }
    }

    const allHave = goal.materials.every(m => m.quantity_have >= m.quantity_needed)
    if (allHave && goal.status === 'acquiring') goal.status = 'ready'

    saveToStorage()
  }

  function setAssignedBot(goalId: string, bot: string) {
    const goal = goals.value.find(g => g.id === goalId)
    if (goal) { goal.assigned_bot = bot; saveToStorage() }
  }

  function pauseGoal(goalId: string) {
    const goal = goals.value.find(g => g.id === goalId)
    if (goal && goal.status !== 'done') { goal.status = 'paused'; saveToStorage() }
  }

  function resumeGoal(goalId: string) {
    const goal = goals.value.find(g => g.id === goalId)
    if (goal && goal.status === 'paused') { goal.status = 'acquiring'; saveToStorage() }
  }

  function markBuilding(goalId: string) {
    const goal = goals.value.find(g => g.id === goalId)
    if (goal) { goal.status = 'building'; saveToStorage() }
  }

  function completeGoal(goalId: string) {
    const goal = goals.value.find(g => g.id === goalId)
    if (goal) { goal.status = 'done'; saveToStorage() }
  }

  function deleteGoal(goalId: string) {
    goals.value = goals.value.filter(g => g.id !== goalId)
    saveToStorage()
  }

  const activeGoals = computed(() => goals.value.filter(g => g.status !== 'done'))

  loadFromStorage()

  return {
    goals,
    activeGoals,
    createGoal,
    analyzeGoal,
    updateProgress,
    setAssignedBot,
    pauseGoal,
    resumeGoal,
    markBuilding,
    completeGoal,
    deleteGoal,
  }
})
