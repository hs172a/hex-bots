<template>
  <div class="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
    <!-- Stats Header -->
    <div class="flex items-center gap-4">
      <h3 class="text-sm font-semibold text-space-text-bright">Fleet Statistics</h3>
      <div class="inline-flex border border-space-border rounded-md overflow-hidden">
        <button 
          v-for="p in periods" :key="p.id"
          @click="statsPeriod = p.id"
          class="px-4 py-1.5 text-xs font-medium border-r border-space-border last:border-r-0 transition-colors"
          :class="statsPeriod === p.id ? 'bg-space-accent text-white' : 'bg-space-card text-space-text-dim hover:text-space-text hover:bg-space-row-hover'"
        >{{ p.label }}</button>
      </div>
    </div>

    <!-- Fleet Totals -->
    <div class="flex gap-4 px-4 py-2 bg-space-card border border-space-border rounded-lg">
      <span class="text-xs font-semibold text-space-text-dim uppercase self-center mr-2">Totals</span>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ fmt(fleetTotals.mined) }}</span>
        <span class="text-xs text-space-text-dim">Ores Mined</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ fmt(fleetTotals.crafted) }}</span>
        <span class="text-xs text-space-text-dim">Items Crafted</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ fmt(fleetTotals.trades) }}</span>
        <span class="text-xs text-space-text-dim">Trades</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ fmt(fleetTotals.profit) }}cr</span>
        <span class="text-xs text-space-text-dim">Trade Profit</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">{{ fmt(fleetTotals.systems) }}</span>
        <span class="text-xs text-space-text-dim">Explored</span>
      </div>
    </div>

    <!-- Mission Analytics -->
    <div class="bg-space-card border border-space-border rounded-lg">
      <div class="px-3 py-2 border-b border-space-border flex items-center justify-between">
        <span class="text-xs font-semibold text-space-text-dim uppercase">🎯 Mission Analytics</span>
        <div class="flex items-center gap-3">
          <span v-if="missionLastLoaded" class="text-[11px] text-space-text-dim">Updated {{ missionLastLoaded }}</span>
          <button @click="loadMissionStats" :disabled="missionLoading" class="btn btn-secondary px-3 py-0.5 text-xs">
            {{ missionLoading ? '⏳' : '🔄 Load' }}
          </button>
        </div>
      </div>
      <div v-if="!missionDataLoaded" class="px-4 py-3 text-xs text-space-text-dim italic">
        Click Load to fetch mission history from the game API.
      </div>
      <div v-else class="p-3">
        <!-- Fleet totals row -->
        <div class="flex gap-4 flex-wrap mb-3">
          <div class="flex flex-col items-center min-w-16">
            <span class="text-lg font-bold text-space-text-bright">{{ missionTotals.count }}</span>
            <span class="text-[11px] text-space-text-dim">Completed</span>
          </div>
          <div class="flex flex-col items-center min-w-20">
            <span class="text-lg font-bold text-space-green">{{ fmt(missionTotals.credits) }} ₡</span>
            <span class="text-[11px] text-space-text-dim">Earned</span>
          </div>
          <div v-if="missionTotals.count > 0" class="flex flex-col items-center min-w-20">
            <span class="text-lg font-bold text-space-cyan">{{ fmt(Math.round(missionTotals.credits / missionTotals.count)) }} ₡</span>
            <span class="text-[11px] text-space-text-dim">Avg Reward</span>
          </div>
        </div>
        <!-- Per-bot table -->
        <table class="w-full text-xs">
          <thead>
            <tr class="text-left text-[11px] text-space-text-dim uppercase border-b border-space-border">
              <th class="pb-1 px-2">Bot</th>
              <th class="pb-1 px-2 text-right">Missions</th>
              <th class="pb-1 px-2 text-right">Credits Earned</th>
              <th class="pb-1 px-2 text-right">Avg Reward</th>
              <th class="pb-1 px-2">Last Mission</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="missionRows.length === 0">
              <td colspan="5" class="py-3 text-center text-space-text-dim italic text-xs">No mission data found for selected bots.</td>
            </tr>
            <tr v-for="r in missionRows" :key="r.bot" class="border-b border-[#21262d] hover:bg-space-row-hover">
              <td class="px-2 py-1.5 font-medium text-space-text-bright">{{ r.bot }}</td>
              <td class="px-2 py-1.5 text-right">{{ r.count }}</td>
              <td class="px-2 py-1.5 text-right text-space-green">{{ fmt(r.credits) }} ₡</td>
              <td class="px-2 py-1.5 text-right text-space-cyan">{{ r.count > 0 ? fmt(Math.round(r.credits / r.count)) : '—' }} ₡</td>
              <td class="px-2 py-1.5 text-space-text-dim truncate max-w-36" :title="r.lastTitle">
                {{ r.lastTitle || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Per-Bot Breakdown + Faction Activity -->
    <div class="flex gap-4 flex-1 min-h-0 overflow-hidden">
      <!-- Per-Bot Table -->
      <div class="flex-1 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden">
        <div class="px-3 py-2 border-b border-space-border">
          <span class="text-xs font-semibold text-space-text-dim uppercase">Per-Bot Breakdown</span>
        </div>
        <div class="flex-1 overflow-auto scrollbar-dark">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-space-card">
              <tr class="text-left text-xs text-space-text-dim uppercase border-b border-space-border">
                <th class="py-1.5 px-3">Bot</th>
                <th class="py-1.5 px-3 text-right">Mined</th>
                <th class="py-1.5 px-3 text-right">Crafted</th>
                <th class="py-1.5 px-3 text-right">Trades</th>
                <th class="py-1.5 px-3 text-right">Profit</th>
                <th class="py-1.5 px-3 text-right">Systems</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="botRows.length === 0">
                <td colspan="6" class="px-3 py-6 text-center text-space-text-dim text-xs">
                  No stats recorded yet. Stats are saved every 60 seconds while bots are running.
                </td>
              </tr>
              <tr v-for="r in botRows" :key="r.name" class="border-b border-[#21262d] hover:bg-space-row-hover">
                <td class="px-3 py-1.5 font-medium text-space-text-bright">{{ r.name }}</td>
                <td class="px-3 py-1.5 text-right">{{ fmt(r.mined) }}</td>
                <td class="px-3 py-1.5 text-right">{{ fmt(r.crafted) }}</td>
                <td class="px-3 py-1.5 text-right">{{ fmt(r.trades) }}</td>
                <td class="px-3 py-1.5 text-right">{{ fmt(r.profit) }}cr</td>
                <td class="px-3 py-1.5 text-right">{{ fmt(r.systems) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Faction Activity Log -->
      <div class="flex-1 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden">
        <div class="px-3 py-2 border-b border-space-border flex items-center justify-between">
          <span class="text-xs font-semibold text-space-text-dim uppercase">Faction Activity</span>
          <div class="flex gap-1">
            <button 
              v-for="f in logFilters" :key="f"
              @click="logFilter = f"
              class="px-2 py-0.5 text-[11px] rounded border transition-colors"
              :class="logFilter === f 
                ? 'bg-space-accent text-white border-space-accent' 
                : 'bg-space-bg text-space-text-dim border-space-border hover:bg-[#21262d] hover:text-space-text'"
            >{{ f }}</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto p-3 font-mono text-xs scrollbar-dark">
          <div v-if="filteredFactionLogs.length === 0" class="text-space-text-dim py-3">
            No faction activity logged yet.
          </div>
          <div v-for="(line, idx) in filteredFactionLogs" :key="idx" class="leading-relaxed text-space-text-dim">
            {{ line }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

// ── Mission Analytics state ─────────────────────────────

const botStore = useBotStore();
const statsPeriod = ref<'today' | 'week' | 'all'>('today');

interface MissionRow { bot: string; count: number; credits: number; lastTitle: string; }
const missionRows = ref<MissionRow[]>([]);
const missionLoading = ref(false);
const missionDataLoaded = ref(false);
const missionLastLoaded = ref('');

const missionTotals = computed(() => missionRows.value.reduce(
  (acc, r) => ({ count: acc.count + r.count, credits: acc.credits + r.credits }),
  { count: 0, credits: 0 },
));

async function loadMissionStats() {
  const bots = botStore.bots;
  if (!bots.length) return;
  missionLoading.value = true;
  const results: MissionRow[] = [];
  await Promise.all(bots.map(bot => new Promise<void>(resolve => {
    botStore.sendExec(bot.username, 'get_action_log', { category: 'mission', limit: 500 }, (res: any) => {
      const entries: any[] = res?.data?.entries ?? [];
      const count = entries.length;
      const credits = entries.reduce((s: number, e: any) => s + (Number(e.data?.credits) || 0), 0);
      const lastEntry = entries[0];
      const lastTitle = lastEntry?.data?.mission_title || lastEntry?.data?.mission_id || lastEntry?.summary || '';
      results.push({ bot: bot.username, count, credits, lastTitle });
      resolve();
    });
  })));
  missionRows.value = results.filter(r => r.count > 0).sort((a, b) => b.credits - a.credits);
  missionLoading.value = false;
  missionDataLoaded.value = true;
  missionLastLoaded.value = new Date().toLocaleTimeString();
}
const logFilter = ref('All');

const periods = [
  { id: 'today' as const, label: 'Today' },
  { id: 'week' as const, label: 'Week' },
  { id: 'all' as const, label: 'All Time' },
];

const logFilters = ['All', 'Deposit', 'Withdraw', 'Donation', 'Gift'];

function fmt(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function aggregateStats(botDaily: Record<string, any> | undefined, days: number) {
  const totals = { mined: 0, crafted: 0, trades: 0, profit: 0, systems: 0 };
  if (!botDaily) return totals;
  let cutoff: string | null = null;
  if (days > 0) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    cutoff = d.toISOString().slice(0, 10);
  }
  for (const [date, s] of Object.entries(botDaily)) {
    if (cutoff && date < cutoff) continue;
    const ds = s as any;
    totals.mined += ds.mined || 0;
    totals.crafted += ds.crafted || 0;
    totals.trades += ds.trades || 0;
    totals.profit += ds.profit || 0;
    totals.systems += ds.systems || 0;
  }
  return totals;
}

const periodDays = computed(() => statsPeriod.value === 'today' ? 1 : statsPeriod.value === 'week' ? 7 : 0);

const botRows = computed(() => {
  const days = periodDays.value;
  const nameSet = new Set(Object.keys(botStore.statsDaily));
  for (const b of botStore.bots) nameSet.add(b.username);
  const names = [...nameSet].sort();
  return names.map(name => ({
    name,
    ...aggregateStats(botStore.statsDaily[name], days),
  }));
});

const fleetTotals = computed(() => {
  const t = { mined: 0, crafted: 0, trades: 0, profit: 0, systems: 0 };
  for (const r of botRows.value) {
    t.mined += r.mined;
    t.crafted += r.crafted;
    t.trades += r.trades;
    t.profit += r.profit;
    t.systems += r.systems;
  }
  return t;
});

const filteredFactionLogs = computed(() => {
  if (logFilter.value === 'All') return botStore.factionLogLines;
  const tag = `[${logFilter.value.toLowerCase()}]`;
  return botStore.factionLogLines.filter(l => l.includes(tag));
});
</script>
