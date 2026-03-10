<template>
  <div class="flex-1 flex gap-2 py-2 overflow-hidden">

    <!-- Left: skill list -->
    <div class="card p-2 w-72 shrink-0 overflow-y-auto scrollbar-dark">
      <h3 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Progress</h3>
      <div v-if="displaySkills.length === 0" class="text-xs text-space-text-dim text-center py-4">
        No skills data
        <button @click="$emit('refresh')" class="ml-2 text-space-accent hover:underline text-[11px]">🔄 Refresh</button>
      </div>
      <div v-else class="space-y-1">
        <template v-for="group in grouped" :key="group.category.id">
          <!-- Category header -->
          <div class="flex items-center gap-1.5 mt-2 first:mt-0">
            <span :class="group.category.color" class="text-xs">{{ group.category.icon }}</span>
            <span class="text-[11px] uppercase font-semibold tracking-wide" :class="group.category.color">
              {{ group.category.label }}
            </span>
            <div class="flex-1 h-px bg-space-border"></div>
          </div>
          <!-- Skills in category -->
          <div class="space-y-1 pl-2 mb-1.5">
            <div
              v-for="sk in group.skills"
              :key="sk.entry.skill_id"
              class="relative group"
            >
              <div class="flex justify-between items-baseline text-xs">
                <span
                  class="text-gray-300 text-[11px] cursor-help underline decoration-dotted decoration-gray-600"
                  @mouseenter="onSkillHover($event, sk.info)"
                  @mouseleave="hideTooltip"
                >{{ sk.info.name }}</span>
                <span class="text-space-text-dim flex items-center gap-1.5 shrink-0">
                  <span v-if="sk.entry.xp !== undefined && xpNext(sk.entry) > 0" class="text-[11px]">
                    {{ sk.entry.xp }}/{{ xpNext(sk.entry) }}
                  </span>
                  <span class="text-space-green font-medium">Lv{{ sk.entry.level || 0 }}</span>
                </span>
              </div>
              <div v-if="sk.entry.xp !== undefined && xpNext(sk.entry) > 0"
                class="h-0.5 bg-[#21262d] rounded-full mt-0.5 overflow-hidden">
                <div class="h-full rounded-full transition-all" :class="group.category.barColor"
                  :style="{ width: skillPct(sk.entry) + '%' }"></div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Right: Radar chart -->
    <div class="card flex-1 flex flex-col items-center justify-start p-2 shrink-0 overflow-y-auto scrollbar-dark">
      <h3 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Skill Radar</h3>
      <div class="relative" :style="{ width: chartSize + 'px', height: chartSize + 'px' }">
        <svg :width="chartSize" :height="chartSize" :viewBox="`0 0 ${chartSize} ${chartSize}`" overflow="visible">
          <!-- Background rings -->
          <polygon v-for="r in [0.2, 0.4, 0.6, 0.8, 1.0]" :key="r"
            :points="ringPoints(r)"
            fill="none" stroke="#21262d" stroke-width="1" />

          <!-- Axis lines -->
          <line v-for="(axis, i) in radarAxes" :key="'line-' + i"
            :x1="cx" :y1="cy"
            :x2="axis.x" :y2="axis.y"
            stroke="#30363d" stroke-width="1" />

          <!-- Data polygon -->
          <polygon v-if="radarAxes.length >= 3"
            :points="dataPoints"
            :fill="radarFillColor"
            :stroke="radarStrokeColor"
            stroke-width="1.5"
            stroke-linejoin="round" />

          <!-- Data point dots -->
          <circle v-for="(axis, i) in radarAxes" :key="'dot-' + i"
            :cx="dataCoords[i]?.x || cx"
            :cy="dataCoords[i]?.y || cy"
            r="3"
            :fill="radarStrokeColor"
            stroke="#0d1117" stroke-width="1" />

          <!-- Axis labels -->
          <text v-for="(axis, i) in radarAxes" :key="'label-' + i"
            :x="axis.labelX"
            :y="axis.labelY"
            text-anchor="middle"
            dominant-baseline="middle"
            class="text-[10px]"
            :style="{ fontSize: '10px', fill: axis.color }"
          >{{ axis.icon }} {{ axis.label }}</text>
        </svg>
      </div>

      <!-- Legend: category avg levels -->
      <div v-if="radarAxes.length > 0" class="mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px] w-full max-w-xs">
        <div v-for="axis in radarAxes" :key="axis.id" class="flex items-center justify-between">
          <span :style="{ color: axis.color }">{{ axis.icon }} {{ axis.label }}</span>
          <span class="text-space-text-dim">{{ axis.avgLevel.toFixed(1) }}</span>
        </div>
      </div>
      <div v-else class="text-[11px] text-space-text-dim italic mt-4">
        Train skills to see radar chart
      </div>
    </div>

    <!-- Skill tooltip -->
    <Teleport to="body">
      <div v-if="tooltip.visible"
        class="fixed z-[9999] max-w-xs bg-[#0d1117] border border-space-border rounded-lg shadow-2xl p-2.5 pointer-events-none"
        :style="{ top: tooltip.y + 'px', left: tooltip.x + 'px' }">
        <div class="text-[11px] font-semibold text-space-text-bright mb-0.5">{{ tooltip.name }}</div>
        <div class="text-[11px] text-space-text-dim leading-relaxed">{{ tooltip.description }}</div>
      </div>
    </Teleport>

  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import { groupSkillsByCategory, categoryRadarData, CATEGORIES, type SkillInfo } from '../utils/skillsData';
import type { SkillEntry } from '../stores/botStore';

interface Props { skills: SkillEntry[] }
const props = defineProps<Props>();
defineEmits<{ (e: 'refresh'): void }>();

const displaySkills = computed(() => props.skills);

const grouped = computed(() => groupSkillsByCategory(displaySkills.value));

const radarData = computed(() => categoryRadarData(displaySkills.value));

// ── SVG Radar Chart ────────────────────────────────────────────────────────
const chartSize = 380;
const cx = chartSize / 2;
const cy = chartSize / 2;
const maxRadius = (chartSize / 2) - 40;
const MAX_LEVEL = 10;

const radarFillColor = 'rgba(88, 166, 255, 0.12)';
const radarStrokeColor = '#58a6ff';

interface RadarAxis {
  id: string;
  label: string;
  icon: string;
  color: string;
  avgLevel: number;
  x: number;   // axis tip point
  y: number;
  labelX: number;
  labelY: number;
}

const radarAxes = computed<RadarAxis[]>(() => {
  const data = radarData.value;
  if (data.length < 3) return [];

  return data.map((d, i) => {
    const angle = (2 * Math.PI * i) / data.length - Math.PI / 2;
    const tipX = cx + maxRadius * Math.cos(angle);
    const tipY = cy + maxRadius * Math.sin(angle);
    const labelR = maxRadius + 20;
    const labelX = cx + labelR * Math.cos(angle);
    const labelY = cy + labelR * Math.sin(angle);

    const catInfo = CATEGORIES.find(c => c.id === d.category.id);
    return {
      id: d.category.id,
      label: d.category.label,
      icon: d.category.icon,
      color: catInfo ? getColorHex(catInfo.color) : '#888',
      avgLevel: d.avgLevel,
      x: tipX,
      y: tipY,
      labelX,
      labelY,
    };
  });
});

const dataCoords = computed(() => {
  const data = radarData.value;
  if (data.length < 3) return [];

  return data.map((d, i) => {
    const angle = (2 * Math.PI * i) / data.length - Math.PI / 2;
    const r = (d.avgLevel / MAX_LEVEL) * maxRadius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });
});

const dataPoints = computed(() =>
  dataCoords.value.map(p => `${p.x},${p.y}`).join(' ')
);

function ringPoints(fraction: number): string {
  const data = radarData.value;
  if (data.length < 3) return '';
  const n = data.length;
  return data.map((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = fraction * maxRadius;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');
}

function getColorHex(tailwindClass: string): string {
  const map: Record<string, string> = {
    'text-amber-400': '#fbbf24', 'text-blue-400': '#60a5fa', 'text-sky-400': '#38bdf8',
    'text-slate-400': '#94a3b8', 'text-orange-400': '#fb923c', 'text-lime-400': '#a3e635',
    'text-red-400': '#f87171', 'text-teal-400': '#2dd4bf', 'text-cyan-400': '#22d3ee',
    'text-gray-400': '#9ca3af', 'text-green-400': '#4ade80', 'text-purple-400': '#c084fc',
    'text-yellow-500': '#eab308', 'text-yellow-400': '#facc15',
  };
  return map[tailwindClass] || '#888';
}

// ── Skill utilities ────────────────────────────────────────────────────────
function xpNext(entry: SkillEntry): number {
  return entry.xp_to_next ?? entry.next_level_xp ?? 0;
}
function skillPct(entry: SkillEntry): number {
  const next = xpNext(entry);
  if (!next || next <= 0) return 0;
  return Math.min(100, Math.round(((entry.xp || 0) / next) * 100));
}

// ── Tooltip ────────────────────────────────────────────────────────────────
const tooltip = reactive({ visible: false, x: 0, y: 0, name: '', description: '' });

function onSkillHover(e: MouseEvent, info: SkillInfo) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  tooltip.x = Math.min(rect.left, window.innerWidth - 320);
  tooltip.y = rect.bottom + 6;
  tooltip.name = info.name;
  tooltip.description = info.description;
  tooltip.visible = true;
}
function hideTooltip() {
  tooltip.visible = false;
}
</script>
