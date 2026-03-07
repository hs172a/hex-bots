<template>
  <div ref="containerRef" class="relative w-full h-full bg-[#050810] overflow-hidden select-none">
    <canvas ref="canvasRef" class="absolute inset-0 w-full h-full" />

    <!-- Hint -->
    <div class="absolute top-2 left-1/2 -translate-x-1/2 text-[11px] text-space-text-dim/60 pointer-events-none">
      Ctrl + scroll to zoom · drag to pan
    </div>

    <!-- Stats (top-left) -->
    <div class="absolute top-2 left-2 bg-[#0d1117cc] border border-space-border rounded-md px-3 py-1.5 text-xs space-y-0.5 pointer-events-none">
      <div class="flex items-center gap-1.5 mb-1">
        <span class="w-2 h-2 rounded-full bg-space-green animate-pulse inline-block"></span>
        <span class="text-space-text-dim font-semibold">Live</span>
      </div>
      <div class="flex gap-3 text-space-text-dim">
        <span>Systems: <span class="text-space-text font-semibold">{{ totalSystems }}</span></span>
        <span>Our bots: <span class="text-space-accent font-semibold">{{ botStore.bots.length }}</span></span>
      </div>
    </div>

    <!-- Zoom controls (bottom-right) -->
    <div class="absolute bottom-3 right-3 flex flex-col gap-1">
      <button @click="resetView" title="Reset view" class="w-7 h-7 rounded bg-[#161b22] border border-space-border text-space-text hover:bg-[#21262d] text-sm flex items-center justify-center">⌂</button>
      <button @click="zoomIn" title="Zoom in" class="w-7 h-7 rounded bg-[#161b22] border border-space-border text-space-text hover:bg-[#21262d] text-sm font-bold flex items-center justify-center">+</button>
      <button @click="zoomOut" title="Zoom out" class="w-7 h-7 rounded bg-[#161b22] border border-space-border text-space-text hover:bg-[#21262d] text-sm font-bold flex items-center justify-center">−</button>
    </div>

    <!-- Faction buildings toggle button (top-right) -->
    <button
      @click="showBuildingsPanel = !showBuildingsPanel"
      :title="showBuildingsPanel ? 'Hide faction buildings' : 'Show faction buildings'"
      class="absolute top-2 right-2 px-2.5 py-1 rounded border text-[11px] font-medium transition-colors"
      :class="showBuildingsPanel
        ? 'bg-[rgba(255,200,50,0.15)] border-yellow-600/60 text-yellow-400'
        : 'bg-[#161b22] border-space-border text-space-text-dim hover:text-space-text'"
    >
      🏛 {{ botStore.factionBuildings.length || '' }} Buildings
    </button>

    <!-- Faction buildings panel -->
    <div v-if="showBuildingsPanel"
      class="absolute top-10 right-2 w-72 max-h-[70vh] bg-[#0d1117f0] border border-space-border rounded-lg flex flex-col overflow-hidden"
    >
      <div class="px-3 py-2 border-b border-space-border flex items-center justify-between shrink-0">
        <span class="text-xs font-semibold text-yellow-400">🏛 Faction Buildings ({{ botStore.factionBuildings.length }})</span>
        <button @click="showBuildingsPanel = false" class="text-space-text-dim hover:text-space-text text-lg leading-none">×</button>
      </div>
      <div v-if="botStore.factionBuildings.length === 0" class="p-4 text-xs text-space-text-dim italic text-center">
        No faction buildings recorded yet.<br/>
        <span class="text-[11px]">Bots update this when running the facility command.</span>
      </div>
      <div v-else class="flex-1 overflow-auto p-2 scrollbar-dark">
        <div v-for="(group, sysName) in buildingsGroupedBySystem" :key="sysName" class="mb-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-space-text-dim mb-1 px-1">
            {{ sysName }}
          </div>
          <div v-for="b in group" :key="b.facility_id"
            class="mb-1 px-2 py-1.5 rounded border border-[#2a2200] bg-[#18150a] text-xs cursor-pointer hover:border-yellow-700/60 transition-colors"
            @click="jumpToSystem(b.system_id)"
          >
            <div class="flex items-start justify-between gap-1">
              <span class="text-yellow-300 font-medium truncate">{{ b.facility_name || b.facility_type }}</span>
              <span v-if="b.level" class="text-[10px] text-space-text-dim shrink-0">Lv{{ b.level }}</span>
            </div>
            <div class="text-[11px] text-space-text-dim mt-0.5">{{ b.poi_name }}</div>
            <div v-if="b.faction_service" class="text-[11px] text-space-cyan/70 mt-0.5">{{ b.faction_service }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Legend (bottom-left) -->
    <div class="absolute bottom-3 left-2 bg-[#0d1117cc] border border-space-border rounded-md px-2 py-1.5 text-[11px] space-y-1 pointer-events-none">
      <div class="text-space-text-dim font-semibold uppercase tracking-wider mb-1">Legend</div>
      <div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:#ffd700"></div><span class="text-space-text-dim">Solarian</span></div>
      <div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:#9b59b6"></div><span class="text-space-text-dim">Voidborn</span></div>
      <div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:#e63946"></div><span class="text-space-text-dim">Crimson</span></div>
      <div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:#00d4ff"></div><span class="text-space-text-dim">Nebula</span></div>
      <div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:#2dd4bf"></div><span class="text-space-text-dim">Outer Rim</span></div>
      <div class="flex items-center gap-1.5"><div class="w-2.5 h-2.5 rounded-full" style="background:#5a6a7a"></div><span class="text-space-text-dim">Neutral</span></div>
      <div class="flex items-center gap-1.5">
        <div class="w-2.5 h-2.5 rounded-full" style="background:#4ecdc4; box-shadow:0 0 4px #4ecdc4"></div>
        <span class="text-space-accent font-semibold">Our bots</span>
      </div>
      <div class="flex items-center gap-1.5">
        <svg width="10" height="10" viewBox="-5 -5 10 10"><polygon points="0,-4 4,0 0,4 -4,0" fill="rgba(255,200,50,0.9)"/></svg>
        <span class="text-space-text-dim">Faction building</span>
      </div>
    </div>

    <!-- Tooltip -->
    <div ref="tooltipRef" class="absolute pointer-events-none bg-[#0d1117ee] border border-space-border rounded-md px-2.5 py-2 text-xs hidden">
      <div ref="tooltipNameRef" class="font-semibold text-space-text-bright mb-0.5"></div>
      <div ref="tooltipEmpireRef" class="text-space-text-dim text-[11px]"></div>
      <div ref="tooltipBotsRef" class="text-space-accent text-[11px] mt-0.5 font-medium"></div>
    </div>

    <!-- Bot panel (right side, shown on click) -->
    <div v-if="selectedSystem" class="absolute top-0 right-0 h-full w-64 bg-[#0d1117f0] border-l border-space-border flex flex-col overflow-hidden">
      <div class="px-3 py-2 border-b border-space-border flex items-center justify-between shrink-0">
        <div>
          <div class="text-sm font-semibold" :style="{ color: selectedSystem.empire_color || '#e8f4f8' }">{{ selectedSystem.name }}</div>
          <div v-if="selectedSystem.empire" class="text-[11px] text-space-text-dim">{{ EMPIRE_NAMES[selectedSystem.empire] || selectedSystem.empire }}</div>
        </div>
        <button @click="selectedSystem = null" class="text-space-text-dim hover:text-space-text text-lg leading-none">×</button>
      </div>
      <div class="flex-1 overflow-auto p-2 scrollbar-dark">
        <!-- Faction buildings in selected system -->
      <div v-if="buildingsInSelected.length" class="mb-3">
        <div class="text-[10px] font-semibold text-space-yellow uppercase tracking-wider mb-1 px-1">🏛 Faction Buildings</div>
        <div v-for="b in buildingsInSelected" :key="b.facility_id"
          class="mb-1 px-2 py-1 rounded border border-[#2a2200] bg-[#18150a] text-xs">
          <div class="text-space-yellow font-medium truncate">{{ b.facility_name || b.facility_type }}</div>
          <div class="text-[11px] text-space-text-dim flex gap-2 mt-0.5">
            <span>{{ b.poi_name }}</span>
            <span v-if="b.faction_service" class="text-space-text-dim/70">· {{ b.faction_service }}</span>
          </div>
        </div>
      </div>

      <div v-if="botsInSelected.length === 0 && buildingsInSelected.length === 0" class="text-xs text-space-text-dim italic py-4 text-center">No bots in this system</div>
      <div v-if="botsInSelected.length === 0 && buildingsInSelected.length > 0" class="text-xs text-space-text-dim italic py-2 text-center">No bots here</div>
        <div v-for="bot in botsInSelected" :key="bot.username"
          class="mb-2 p-2 rounded-md border border-space-border bg-space-bg text-xs">
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-space-text-bright">{{ bot.username }}</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-medium"
              :class="bot.state === 'running' ? 'bg-space-green/20 text-space-green' : 'bg-space-yellow/20 text-space-yellow'">
              {{ bot.state || 'idle' }}
            </span>
          </div>
          <div class="text-space-text-dim text-[11px]">
            <span v-if="bot.routine" class="mr-2">⚙️ {{ bot.routine }}</span>
            <span v-if="(bot as any).poi" class="text-space-text-dim">@ {{ (bot as any).poi }}</span>
          </div>
          <div class="flex gap-2 mt-1.5 text-[11px]">
            <span class="text-space-green">⛽ {{ bot.fuel }}%</span>
            <span class="text-space-red">🛡 {{ bot.hull }}%</span>
            <span class="text-space-yellow">₡{{ bot.credits?.toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading overlay -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-[#050810dd]">
      <div class="text-space-text-dim text-sm animate-pulse">Loading Galaxy…</div>
    </div>
    <div v-if="loadError" class="absolute inset-0 flex items-center justify-center bg-[#050810dd]">
      <div class="text-space-red text-sm">{{ loadError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useBotStore } from '../stores/botStore'

// ── Types ──────────────────────────────────────────────────────────────

interface SystemData {
  id: string
  name: string
  x: number
  y: number
  empire?: string
  empire_color?: string
  is_home?: boolean
  is_stronghold?: boolean
  has_station?: boolean
  connections: string[]
}

interface Star {
  x: number; y: number; size: number; brightness: number
  twinkleSpeed: number; twinkleOffset: number; color: string
}

// ── Constants ──────────────────────────────────────────────────────────

const NODE_RADIUS = 6
const DEFAULT_COLOR = '#5a6a7a'
const LINE_COLOR = 'rgba(140, 170, 200, 0.6)'
const MIN_ZOOM = 0.001
const MAX_ZOOM = 50
const ZOOM_SENSITIVITY = 0.002
const STAR_COUNT = 600
const ZOOM_EASE = 0.15
const PAN_EASE = 0.12
const DEFAULT_ZOOM = 0.08

const EMPIRE_NAMES: Record<string, string> = {
  solarian: 'Solarian Confederacy',
  voidborn: 'Voidborn Collective',
  crimson: 'Crimson Pact',
  nebula: 'Nebula Trade Federation',
  outerrim: 'Outer Rim Explorers',
}

// ── Store & Refs ───────────────────────────────────────────────────────

const botStore = useBotStore()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const tooltipRef = ref<HTMLDivElement | null>(null)
const tooltipNameRef = ref<HTMLDivElement | null>(null)
const tooltipEmpireRef = ref<HTMLDivElement | null>(null)
const tooltipBotsRef = ref<HTMLDivElement | null>(null)

const loading = ref(true)
const loadError = ref('')
const selectedSystem = ref<SystemData | null>(null)

// ── Mutable render state (not reactive — updated every frame) ──────────

const state = {
  systems: [] as SystemData[],
  hoveredSystem: null as SystemData | null,
  viewX: 0, viewY: 0,
  zoom: DEFAULT_ZOOM, targetZoom: DEFAULT_ZOOM,
  targetViewX: 0, targetViewY: 0,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  viewStart: { x: 0, y: 0 },
  animTime: 0,
  lastFrameTime: 0,
  stars: [] as Star[],
  lastTouchDistance: null as number | null,
  initialTouchPos: null as { x: number; y: number } | null,
  touchStartTime: 0,
}

// ── Computed ───────────────────────────────────────────────────────────

const totalSystems = computed(() => state.systems.length)

const botsBySystem = computed(() => {
  const map = new Map<string, typeof botStore.bots>()
  for (const bot of botStore.bots) {
    const sys = (bot as any).system
    if (!sys) continue
    if (!map.has(sys)) map.set(sys, [])
    map.get(sys)!.push(bot)
  }
  return map
})

const botsInSelected = computed(() =>
  selectedSystem.value ? (botsBySystem.value.get(selectedSystem.value.id) || []) : []
)

const buildingsBySystem = computed(() => {
  const map = new Map<string, typeof botStore.factionBuildings>()
  for (const b of botStore.factionBuildings) {
    if (!b.system_id) continue
    if (!map.has(b.system_id)) map.set(b.system_id, [])
    map.get(b.system_id)!.push(b)
  }
  return map
})

const buildingsInSelected = computed(() =>
  selectedSystem.value ? (buildingsBySystem.value.get(selectedSystem.value.id) || []) : []
)

const showBuildingsPanel = ref(false)

const buildingsGroupedBySystem = computed(() => {
  const groups: Record<string, typeof botStore.factionBuildings> = {}
  for (const b of botStore.factionBuildings) {
    const key = b.system_name || b.system_id || 'Unknown'
    if (!groups[key]) groups[key] = []
    groups[key].push(b)
  }
  return groups
})

function jumpToSystem(systemId: string) {
  const sys = state.systems.find(s => s.id === systemId)
  if (!sys) return
  state.targetViewX = -sys.x
  state.targetViewY = -sys.y
  selectedSystem.value = sys
  showBuildingsPanel.value = false
}

// ── Helpers ────────────────────────────────────────────────────────────

function worldToScreen(wx: number, wy: number) {
  const canvas = canvasRef.value!
  const cx = canvas.width / 2, cy = canvas.height / 2
  return { x: cx + (wx + state.viewX) * state.zoom, y: cy + (wy + state.viewY) * state.zoom }
}

function screenToWorld(sx: number, sy: number) {
  const canvas = canvasRef.value!
  const cx = canvas.width / 2, cy = canvas.height / 2
  return { x: (sx - cx) / state.zoom - state.viewX, y: (sy - cy) / state.zoom - state.viewY }
}

function findSystemAt(sx: number, sy: number): SystemData | null {
  const hitR = NODE_RADIUS * 2.5
  let best: SystemData | null = null, bestDist = Infinity
  for (const sys of state.systems) {
    const pos = worldToScreen(sys.x, sys.y)
    const d = Math.hypot(pos.x - sx, pos.y - sy)
    if (d < hitR && d < bestDist) { best = sys; bestDist = d }
  }
  return best
}

// ── Stars ──────────────────────────────────────────────────────────────

function generateStars() {
  state.stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random(), y: Math.random(),
    size: 0.3 + Math.random() * 1.5,
    brightness: 0.15 + Math.random() * 0.6,
    twinkleSpeed: 0.3 + Math.random() * 1.5,
    twinkleOffset: Math.random() * Math.PI * 2,
    color: Math.random() > 0.92 ? (Math.random() > 0.5 ? '#aaddff' : '#ffddaa') : '#ffffff',
  }))
}

// ── Drawing ────────────────────────────────────────────────────────────

function drawStarfield(ctx: CanvasRenderingContext2D) {
  const canvas = canvasRef.value!
  for (const star of state.stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(state.animTime * 0.001 * star.twinkleSpeed + star.twinkleOffset)
    const alpha = star.brightness * twinkle
    if (star.color === '#ffffff') ctx.fillStyle = `rgba(255,255,255,${alpha})`
    else if (star.color.startsWith('#aa')) ctx.fillStyle = `rgba(170,221,255,${alpha})`
    else ctx.fillStyle = `rgba(255,221,170,${alpha})`
    ctx.beginPath()
    ctx.arc(star.x * canvas.width, star.y * canvas.height, star.size, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawGrid(ctx: CanvasRenderingContext2D) {
  const canvas = canvasRef.value!
  const levels = [
    { size: 1000, alpha: 0.35 }, { size: 200, alpha: 0.18 },
    { size: 50, alpha: 0.1 }, { size: 10, alpha: 0.06 },
  ]
  const sw = screenToWorld(0, 0), ew = screenToWorld(canvas.width, canvas.height)
  ctx.lineWidth = 1
  for (const lv of levels) {
    const scaled = lv.size * state.zoom
    if (scaled < 25 || scaled > 500) continue
    ctx.strokeStyle = `rgba(90,106,122,${lv.alpha})`
    const sx = Math.floor(sw.x / lv.size) * lv.size
    const sy = Math.floor(sw.y / lv.size) * lv.size
    for (let wx = sx; wx <= ew.x; wx += lv.size) {
      const p = worldToScreen(wx, 0)
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, canvas.height); ctx.stroke()
    }
    for (let wy = sy; wy <= ew.y; wy += lv.size) {
      const p = worldToScreen(0, wy)
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(canvas.width, p.y); ctx.stroke()
    }
  }
}

function render(ctx?: CanvasRenderingContext2D | null) {
  const canvas = canvasRef.value
  if (!canvas) return
  if (!ctx) ctx = canvas.getContext('2d')
  if (!ctx || !state.systems.length) return

  ctx.fillStyle = '#050810'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  drawStarfield(ctx)
  drawGrid(ctx)

  // Connections
  const drawn = new Set<string>()
  for (const sys of state.systems) {
    const p1 = worldToScreen(sys.x, sys.y)
    for (const connId of sys.connections) {
      const key = [sys.id, connId].sort().join('-')
      if (drawn.has(key)) continue
      drawn.add(key)
      const conn = state.systems.find(s => s.id === connId)
      if (!conn) continue
      const p2 = worldToScreen(conn.x, conn.y)
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()
    }
  }

  // Nodes
  const bySys = botsBySystem.value
  for (const sys of state.systems) {
    const pos = worldToScreen(sys.x, sys.y)
    const color = sys.empire_color || DEFAULT_COLOR
    const isHovered = state.hoveredSystem?.id === sys.id
    const isSelected = selectedSystem.value?.id === sys.id
    const botCount = bySys.get(sys.id)?.length ?? 0
    const hasOurBots = botCount > 0

    // Pulsing glow for systems with our bots
    if (hasOurBots) {
      const phase = (state.animTime * 0.002 + sys.x * 0.001) % (Math.PI * 2)
      const scale = 1 + Math.sin(phase) * 0.3
      const alpha = 0.35 + Math.sin(phase) * 0.15
      const glowR = NODE_RADIUS * 3.5 * scale
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR)
      g.addColorStop(0, `rgba(78,205,196,${alpha})`)
      g.addColorStop(1, 'rgba(78,205,196,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2); ctx.fill()
    }

    // Selected ring
    if (isSelected) {
      const phase = (state.animTime * 0.003) % (Math.PI * 2)
      ctx.strokeStyle = `rgba(255,255,255,${0.6 + Math.sin(phase) * 0.2})`
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(pos.x, pos.y, NODE_RADIUS * 2.5, 0, Math.PI * 2); ctx.stroke()
    }

    // Hover glow
    if (isHovered) {
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, NODE_RADIUS * 4)
      g.addColorStop(0, color + 'bb')
      g.addColorStop(0.5, color + '40')
      g.addColorStop(1, color + '00')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(pos.x, pos.y, NODE_RADIUS * 4, 0, Math.PI * 2); ctx.fill()
    }

    // Node
    const nodeR = sys.is_home ? NODE_RADIUS * 1.6 : NODE_RADIUS
    const hoverScale = isHovered ? 1.5 : 1
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(pos.x, pos.y, nodeR * hoverScale, 0, Math.PI * 2); ctx.fill()

    // Home rings
    if (sys.is_home) {
      for (let i = 1; i <= 3; i++) {
        ctx.strokeStyle = color + (i === 1 ? '' : i === 2 ? '80' : '40')
        ctx.lineWidth = i === 1 ? 2.5 : i === 2 ? 1.5 : 1
        ctx.beginPath(); ctx.arc(pos.x, pos.y, nodeR * hoverScale + i * 4, 0, Math.PI * 2); ctx.stroke()
      }
    } else if (sys.has_station) {
      ctx.strokeStyle = color + 'aa'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(pos.x, pos.y, nodeR * hoverScale + 3, 0, Math.PI * 2); ctx.stroke()
    }

    // Bright center
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(pos.x, pos.y, nodeR * 0.35 * hoverScale, 0, Math.PI * 2); ctx.fill()

    // Faction building diamond marker
    const hasFactionBuilding = buildingsBySystem.value.has(sys.id)
    if (hasFactionBuilding) {
      const dx = pos.x + nodeR * hoverScale + 4
      const dy = pos.y - nodeR * hoverScale - 4
      const s = 4
      ctx.fillStyle = 'rgba(255,200,50,0.9)'
      ctx.beginPath()
      ctx.moveTo(dx, dy - s); ctx.lineTo(dx + s, dy); ctx.lineTo(dx, dy + s); ctx.lineTo(dx - s, dy)
      ctx.closePath(); ctx.fill()
    }

    // Bot count badge (our bots only)
    if (hasOurBots) {
      const text = botCount.toString()
      ctx.font = 'bold 11px monospace'
      const tw = ctx.measureText(text).width
      const bw = Math.max(tw + 8, 18), bh = 14
      const bx = pos.x, by = pos.y + NODE_RADIUS + 10
      ctx.fillStyle = 'rgba(78,205,196,0.9)'
      ctx.beginPath()
      ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 3)
      ctx.fill()
      ctx.fillStyle = '#050810'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, bx, by)
    }

    // System name
    if (state.zoom > 0.15 || isHovered) {
      ctx.font = isHovered ? 'bold 14px sans-serif' : '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(168,197,214,0.9)'
      const labelY = hasOurBots ? pos.y + NODE_RADIUS + 22 : pos.y + NODE_RADIUS + 8
      ctx.fillText(sys.name, pos.x, labelY)
    }
  }
}

// ── Tooltip ────────────────────────────────────────────────────────────

function showTooltip(sys: SystemData, mx: number, my: number) {
  const el = tooltipRef.value; if (!el) return
  if (tooltipNameRef.value) { tooltipNameRef.value.textContent = sys.name }
  if (tooltipEmpireRef.value) {
    tooltipEmpireRef.value.textContent = sys.empire ? (EMPIRE_NAMES[sys.empire] || sys.empire) : ''
    tooltipEmpireRef.value.style.display = sys.empire ? '' : 'none'
  }
  if (tooltipBotsRef.value) {
    const n = botsBySystem.value.get(sys.id)?.length ?? 0
    tooltipBotsRef.value.textContent = n > 0 ? `${n} bot${n > 1 ? 's' : ''} here` : ''
    tooltipBotsRef.value.style.display = n > 0 ? '' : 'none'
  }
  el.style.left = (mx + 14) + 'px'
  el.style.top = (my + 14) + 'px'
  el.classList.remove('hidden')
}

function hideTooltip() {
  tooltipRef.value?.classList.add('hidden')
}

// ── View Controls ──────────────────────────────────────────────────────

function resetView() {
  state.viewX = 0; state.viewY = 0; state.zoom = DEFAULT_ZOOM
  state.targetViewX = 0; state.targetViewY = 0; state.targetZoom = DEFAULT_ZOOM
}

function zoomIn() { state.targetZoom = Math.min(MAX_ZOOM, state.targetZoom * 1.5) }
function zoomOut() { state.targetZoom = Math.max(MIN_ZOOM, state.targetZoom / 1.5) }

// ── Data Fetching ──────────────────────────────────────────────────────

async function fetchMapData() {
  try {
    const res = await fetch('https://game.spacemolt.com/api/map')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    state.systems = data.systems || []

    // Try to mark station systems
    try {
      const sr = await fetch('https://game.spacemolt.com/api/stations')
      if (sr.ok) {
        const sd = await sr.json()
        const stationSystems = new Set((sd.stations || []).map((s: any) => s.system_id))
        for (const sys of state.systems) {
          if (stationSystems.has(sys.id)) sys.has_station = true
        }
      }
    } catch { /* optional */ }

    loading.value = false
  } catch (err: any) {
    loadError.value = 'Failed to load galaxy data: ' + (err?.message || err)
    loading.value = false
  }
}

// ── Main Mount ────────────────────────────────────────────────────────

let animFrameId = 0
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  const canvas = canvasRef.value!
  const ctx = canvas.getContext('2d')!

  function resizeCanvas() {
    const container = containerRef.value
    if (container) {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
    }
    render(ctx)
  }

  state.lastFrameTime = performance.now()
  generateStars()
  resizeCanvas()

  // Pre-load faction buildings for map markers
  botStore.fetchFactionStorage()

  resizeObserver = new ResizeObserver(resizeCanvas)
  if (containerRef.value) resizeObserver.observe(containerRef.value)

  // Animation loop
  function loop(ts: number) {
    const dt = ts - state.lastFrameTime
    state.lastFrameTime = ts
    state.animTime += dt

    state.zoom += (state.targetZoom - state.zoom) * ZOOM_EASE
    state.viewX += (state.targetViewX - state.viewX) * PAN_EASE
    state.viewY += (state.targetViewY - state.viewY) * PAN_EASE

    render(ctx)
    animFrameId = requestAnimationFrame(loop)
  }
  animFrameId = requestAnimationFrame(loop)

  // ── Mouse ─────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    state.isDragging = true
    state.dragStart = { x: e.clientX, y: e.clientY }
    state.viewStart = { x: state.viewX, y: state.viewY }
  })

  canvas.addEventListener('mousemove', (e) => {
    if (state.isDragging) {
      state.viewX = state.viewStart.x + (e.clientX - state.dragStart.x) / state.zoom
      state.viewY = state.viewStart.y + (e.clientY - state.dragStart.y) / state.zoom
      state.targetViewX = state.viewX; state.targetViewY = state.viewY
    } else {
      const sys = findSystemAt(e.clientX, e.clientY)
      state.hoveredSystem = sys
      if (sys) showTooltip(sys, e.clientX, e.clientY)
      else hideTooltip()
    }
  })

  canvas.addEventListener('mouseup', (e) => {
    const dx = e.clientX - state.dragStart.x, dy = e.clientY - state.dragStart.y
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
      const sys = findSystemAt(e.clientX, e.clientY)
      if (sys) selectedSystem.value = sys
    }
    state.isDragging = false
  })

  canvas.addEventListener('mouseleave', () => {
    state.isDragging = false; state.hoveredSystem = null; hideTooltip()
  })

  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const factor = Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * ZOOM_SENSITIVITY)
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.targetZoom * factor))
    const cx = canvas.width / 2, cy = canvas.height / 2
    const wx = (e.clientX - cx) / state.zoom - state.viewX
    const wy = (e.clientY - cy) / state.zoom - state.viewY
    state.zoom = newZoom; state.targetZoom = newZoom
    const nx = (e.clientX - cx) / state.zoom - state.viewX
    const ny = (e.clientY - cy) / state.zoom - state.viewY
    state.targetViewX = state.viewX + (nx - wx)
    state.targetViewY = state.viewY + (ny - wy)
  }, { passive: false })

  // ── Touch ──────────────────────────────────────────────────────────────
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault()
    state.touchStartTime = Date.now()
    if (e.touches.length === 1) {
      state.isDragging = true
      state.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      state.initialTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      state.viewStart = { x: state.viewX, y: state.viewY }
      state.lastTouchDistance = null
    } else if (e.touches.length === 2) {
      state.isDragging = false
      state.lastTouchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    }
  }, { passive: false })

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault()
    if (e.touches.length === 1 && state.isDragging) {
      state.viewX = state.viewStart.x + (e.touches[0].clientX - state.dragStart.x) / state.zoom
      state.viewY = state.viewStart.y + (e.touches[0].clientY - state.dragStart.y) / state.zoom
      state.targetViewX = state.viewX; state.targetViewY = state.viewY
    } else if (e.touches.length === 2 && state.lastTouchDistance !== null) {
      const newDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * (newDist / state.lastTouchDistance)))
      state.zoom = zoom; state.targetZoom = zoom
      state.lastTouchDistance = newDist
    }
  }, { passive: false })

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault()
    if (Date.now() - state.touchStartTime < 300 && e.changedTouches.length === 1 && state.initialTouchPos) {
      const t = e.changedTouches[0]
      if (Math.abs(t.clientX - state.initialTouchPos.x) < 10 && Math.abs(t.clientY - state.initialTouchPos.y) < 10) {
        const sys = findSystemAt(t.clientX, t.clientY)
        if (sys) selectedSystem.value = sys
      }
    }
    state.isDragging = false; state.lastTouchDistance = null; state.initialTouchPos = null
  }, { passive: false })

  // ── Watch bot positions for reactivity ───────────────────────────────
  // The animation loop re-renders every frame, so botsBySystem computed
  // is automatically picked up — no explicit watcher needed.

  await fetchMapData()
})

onUnmounted(() => {
  cancelAnimationFrame(animFrameId)
  resizeObserver?.disconnect()
})
</script>
