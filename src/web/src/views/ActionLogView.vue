<template>
  <div class="flex-1 flex gap-2 p-2 overflow-hidden">

    <!-- Main panel -->
    <div class="flex-1 bg-space-card border border-space-border rounded-lg flex flex-col overflow-hidden">

      <!-- Toolbar -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-space-border shrink-0 flex-wrap">
        <!-- Bot selector -->
        <select v-model="selectedBotModel" class="input text-xs py-0 h-7 min-w-36">
          <option value="__all__">🌐 All Bots</option>
          <option v-for="b in botStore.sortedBots" :key="b.username" :value="b.username">{{ b.username }}</option>
        </select>
        <div class="w-px h-4 bg-space-border mx-1 shrink-0"></div>

        <!-- Category filter pills -->
        <div class="flex flex-wrap gap-1">
          <button
            v-for="cat in CATEGORIES"
            :key="cat.id"
            @click="toggleCategory(cat.id)"
            class="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
            :class="activeCategories.has(cat.id)
              ? `${cat.activeClass} border-transparent`
              : 'border-space-border text-space-text-dim hover:border-space-accent'"
          >{{ cat.icon }} {{ cat.label }}</button>
        </div>

        <div class="ml-auto flex items-center gap-2 shrink-0">
          <select v-model="pageLimit" class="input text-xs py-0 h-6 px-1">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
          <button @click="reload" :disabled="loading" class="btn btn-secondary text-xs px-3 py-1">
            <span :class="{ 'animate-spin inline-block': loading }">🔄</span> Refresh
          </button>
        </div>
      </div>

      <div v-if="!selectedBotModel" class="flex items-center justify-center h-full text-space-text-dim text-sm italic">
        Select a bot above
      </div>

      <template v-else>

        <!-- Log entries -->
        <div class="flex-1 overflow-auto px-3 py-2 space-y-1 scrollbar-dark" ref="logContainerRef">
          <div v-if="loading && entries.length === 0" class="text-xs text-space-text-dim italic py-8 text-center">Loading…</div>
          <div v-else-if="entries.length === 0" class="text-xs text-space-text-dim italic py-8 text-center bg-[#0d1117f0] rounded-lg">
            No action log entries found.
          </div>

          <template v-else>
            <div
              v-for="entry in entries"
              :key="entry.id"
              class="rounded-lg border px-3 py-2 text-xs transition-colors"
              :class="categoryStyle(entry.category).card"
            >
              <div class="flex items-start gap-2">
                <!-- Icon + category badge -->
                <span class="text-sm shrink-0 mt-0.5">{{ categoryStyle(entry.category).icon }}</span>
                <div class="flex-1 min-w-0">
                  <!-- Main description -->
                  <div class="text-space-text leading-snug mb-1">{{ entry.summary || formatEntry(entry) }}</div>

                  <!-- Meta row -->
                  <div class="flex flex-wrap items-center gap-2 text-[11px] text-space-text-dim">
                    <!-- Bot badge (shown in fleet / all-bots mode) -->
                    <span v-if="entry._bot" class="px-1.5 py-0 rounded font-mono font-semibold bg-[#1e2a3a] text-space-cyan border border-space-accent/30">
                      {{ entry._bot }}
                    </span>
                    <span class="px-1.5 py-0 rounded font-medium" :class="categoryStyle(entry.category).badge">
                      {{ entry.category }}
                    </span>

                    <!-- Combat specifics -->
                    <template v-if="entry.category === 'combat'">
                      <span v-if="entry.data?.target" class="text-red-400">vs {{ entry.data.target }}</span>
                      <span v-if="entry.data?.result === 'kill'" class="text-green-400 font-semibold">☠ Kill</span>
                      <span v-if="entry.data?.result === 'death'" class="text-red-400 font-semibold">💀 Death</span>
                      <span v-if="entry.data?.damage" class="text-orange-400">{{ entry.data.damage }} dmg</span>
                    </template>

                    <!-- Trading specifics -->
                    <template v-if="entry.category === 'trading'">
                      <span v-if="entry.data?.item_name || entry.data?.item_id" class="text-space-cyan">{{ entry.data.item_name || entry.data.item_id }}</span>
                      <span v-if="entry.data?.quantity" class="text-space-text">×{{ entry.data.quantity }}</span>
                      <span v-if="entry.data?.price" class="text-yellow-400 font-semibold">₡{{ fmt(entry.data.price) }}</span>
                      <span v-if="entry.data?.profit" :class="entry.data.profit >= 0 ? 'text-green-400' : 'text-red-400'">
                        {{ entry.data.profit >= 0 ? '+' : '' }}₡{{ fmt(entry.data.profit) }}
                      </span>
                    </template>

                    <!-- Crafting specifics -->
                    <template v-if="entry.category === 'crafting'">
                      <span v-if="entry.data?.item_name || entry.data?.item_id" class="text-orange-400">{{ entry.data.item_name || entry.data.item_id }}</span>
                      <span v-if="entry.data?.quantity" class="text-space-text">×{{ entry.data.quantity }}</span>
                    </template>

                    <!-- Ship specifics -->
                    <template v-if="entry.category === 'ship'">
                      <span v-if="entry.data?.ship_name || entry.data?.ship_type" class="text-space-accent">{{ entry.data.ship_name || entry.data.ship_type }}</span>
                    </template>

                    <!-- Skill specifics -->
                    <template v-if="entry.category === 'skill'">
                      <span v-if="entry.data?.skill_name" class="text-blue-400">{{ entry.data.skill_name }}</span>
                      <span v-if="entry.data?.level" class="text-blue-300 font-semibold">→ Lvl {{ entry.data.level }}</span>
                    </template>

                    <!-- Mission specifics -->
                    <template v-if="entry.category === 'mission'">
                      <span v-if="entry.data?.mission_title || entry.data?.mission_id" class="text-purple-400">{{ entry.data.mission_title || entry.data.mission_id }}</span>
                      <span v-if="entry.data?.credits" class="text-yellow-400">+₡{{ fmt(entry.data.credits) }}</span>
                    </template>

                    <!-- Faction specifics -->
                    <template v-if="entry.category === 'faction'">
                      <span v-if="entry.data?.faction_name" class="text-purple-400">{{ entry.data.faction_name }}</span>
                      <span v-if="entry.data?.other_player" class="text-space-text-dim">with {{ entry.data.other_player }}</span>
                    </template>

                    <!-- Salvage specifics -->
                    <template v-if="entry.category === 'salvage'">
                      <span v-if="entry.data?.item_name" class="text-lime-400">{{ entry.data.item_name }}</span>
                      <span v-if="entry.data?.quantity" class="text-space-text">×{{ entry.data.quantity }}</span>
                    </template>

                    <!-- Other party (PvP / two-party events) -->
                    <span v-if="entry.data?.other_player && entry.category !== 'faction'" class="text-space-text-dim opacity-70">
                      (with {{ entry.data.other_player }})
                    </span>

                    <!-- Timestamp -->
                    <span class="ml-auto text-[11px] text-space-text-dim opacity-50 tabular-nums shrink-0">{{ fmtTime(entry.created_at) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Load More / pagination -->
          <div v-if="hasMore" class="py-3 flex justify-center">
            <button
              @click="loadMore"
              :disabled="loading"
              class="btn btn-secondary text-xs px-6 py-1.5"
            >
              <span v-if="loading" class="animate-spin inline-block mr-1">⏳</span>
              Load Older Entries
            </button>
          </div>
          <div v-else-if="entries.length > 0" class="text-center text-[11px] text-space-text-dim opacity-40 py-2">
            — end of log —
          </div>
        </div>

        <!-- Footer stats -->
        <div class="px-3 py-1.5 border-t border-space-border shrink-0 flex items-center gap-4 text-[11px] text-space-text-dim">
          <span>{{ entries.length }} entries loaded</span>
          <span v-if="activeCategories.size < CATEGORIES.length" class="text-space-accent">
            {{ activeCategories.size }} / {{ CATEGORIES.length }} categories shown
          </span>
        </div>

      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

const botStore = useBotStore();

// ── State ─────────────────────────────────────────────────────

/** "__all__" = fleet view, or a specific bot username */
const selectedBotModel = ref<string>('__all__');

// ── Auto-sync: pre-select bot from profile navigation (if set)
onMounted(() => {
  if (botStore.selectedBot) selectedBotModel.value = botStore.selectedBot;
  reload();
});
watch(() => botStore.selectedBot, (username) => {
  if (username && username !== selectedBotModel.value) {
    selectedBotModel.value = username;
  }
});
watch(selectedBotModel, () => reload());

const entries = ref<any[]>([]);
const loading = ref(false);
const hasMore = ref(false);
const beforeCursor = ref<string | null>(null);
const pageLimit = ref<number>(50);
const logContainerRef = ref<HTMLElement | null>(null);

// ── Category config ───────────────────────────────────────────

const CATEGORIES = [
  { id: 'combat',   label: 'Combat',   icon: '⚔️',  activeClass: 'bg-red-500/20 text-red-300',     badge: 'bg-red-500/20 text-red-300' },
  { id: 'trading',  label: 'Trading',  icon: '💱',  activeClass: 'bg-green-500/20 text-green-300',  badge: 'bg-green-500/20 text-green-300' },
  { id: 'ship',     label: 'Ship',     icon: '🚀',  activeClass: 'bg-blue-500/20 text-blue-300',    badge: 'bg-blue-500/20 text-blue-300' },
  { id: 'crafting', label: 'Crafting', icon: '🔧',  activeClass: 'bg-orange-500/20 text-orange-300', badge: 'bg-orange-500/20 text-orange-300' },
  { id: 'faction',  label: 'Faction',  icon: '🏛️', activeClass: 'bg-purple-500/20 text-purple-300', badge: 'bg-purple-500/20 text-purple-300' },
  { id: 'mission',  label: 'Mission',  icon: '🎯',  activeClass: 'bg-indigo-500/20 text-indigo-300', badge: 'bg-indigo-500/20 text-indigo-300' },
  { id: 'skill',    label: 'Skill',    icon: '⭐',  activeClass: 'bg-cyan-500/20 text-cyan-300',    badge: 'bg-cyan-500/20 text-cyan-300' },
  { id: 'salvage',  label: 'Salvage',  icon: '♻️',  activeClass: 'bg-lime-500/20 text-lime-300',    badge: 'bg-lime-500/20 text-lime-300' },
  { id: 'other',    label: 'Other',    icon: '📋',  activeClass: 'bg-[#21262d] text-space-text-dim', badge: 'bg-[#21262d] text-space-text-dim' },
] as const;

const activeCategories = ref(new Set<string>(CATEGORIES.map(c => c.id)));

function toggleCategory(id: string) {
  const s = new Set(activeCategories.value);
  if (s.has(id)) {
    if (s.size === 1) return; // keep at least one
    s.delete(id);
  } else {
    s.add(id);
  }
  activeCategories.value = s;
  reload();
}

// ── Card styles per category ──────────────────────────────────

const STYLE_MAP: Record<string, { icon: string; card: string; badge: string }> = {
  combat:   { icon: '⚔️',  card: 'bg-red-950/20 border-red-800/40',      badge: 'bg-red-500/20 text-red-300' },
  trading:  { icon: '💱',  card: 'bg-green-950/20 border-green-800/40',   badge: 'bg-green-500/20 text-green-300' },
  ship:     { icon: '🚀',  card: 'bg-blue-950/20 border-blue-800/40',     badge: 'bg-blue-500/20 text-blue-300' },
  crafting: { icon: '🔧',  card: 'bg-orange-950/20 border-orange-800/40', badge: 'bg-orange-500/20 text-orange-300' },
  faction:  { icon: '🏛️', card: 'bg-purple-950/20 border-purple-800/40', badge: 'bg-purple-500/20 text-purple-300' },
  mission:  { icon: '🎯',  card: 'bg-indigo-950/20 border-indigo-800/40', badge: 'bg-indigo-500/20 text-indigo-300' },
  skill:    { icon: '⭐',  card: 'bg-cyan-950/20 border-cyan-800/40',     badge: 'bg-cyan-500/20 text-cyan-300' },
  salvage:  { icon: '♻️',  card: 'bg-lime-950/20 border-lime-800/40',     badge: 'bg-lime-500/20 text-lime-300' },
  other:    { icon: '📋',  card: 'bg-[#0d1117f0] border-[#30363d]',         badge: 'bg-[#21262d] text-space-text-dim' },
};

function categoryStyle(cat: string) {
  return STYLE_MAP[cat?.toLowerCase()] ?? STYLE_MAP.other;
}

// ── API calls ─────────────────────────────────────────────────

/** Fetch action log entries for a single bot, returning a tagged list. */
function fetchBotLog(username: string, params: Record<string, any>): Promise<any[]> {
  return new Promise((resolve) => {
    botStore.sendExec(username, 'get_action_log', params, (res: any) => {
      if (res.ok && res.data?.entries) {
        resolve((res.data.entries as any[]).map(e => ({ ...e, _bot: username })));
      } else {
        resolve([]);
      }
    });
  });
}

async function reload() {
  loading.value = true;
  entries.value = [];
  beforeCursor.value = null;
  hasMore.value = false;

  const categories = [...activeCategories.value];
  const params: Record<string, any> = { limit: pageLimit.value };
  if (categories.length < CATEGORIES.length) params.category = categories.join(',');

  if (selectedBotModel.value === '__all__') {
    // Parallel fetch all bots
    const bots = botStore.bots.map(b => b.username);
    const results = await Promise.all(bots.map(u => fetchBotLog(u, params)));
    const merged = results.flat().sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta; // newest first
    });
    entries.value = merged.slice(0, pageLimit.value * Math.max(1, bots.length));
    hasMore.value = false; // all-bots mode doesn't support cursor pagination
  } else {
    await new Promise<void>((resolve) => {
      botStore.sendExec(selectedBotModel.value, 'get_action_log', params, (res: any) => {
        if (res.ok && res.data) {
          const data = res.data;
          const newEntries: any[] = (data.entries ?? []).map((e: any) => ({ ...e, _bot: selectedBotModel.value }));
          entries.value = newEntries;
          hasMore.value = data.has_more === true;
          beforeCursor.value = newEntries.length > 0 ? String(newEntries[newEntries.length - 1].id) : null;
        }
        resolve();
      });
    });
  }

  loading.value = false;
}

async function loadMore() {
  if (selectedBotModel.value === '__all__' || !beforeCursor.value) return;
  loading.value = true;
  const categories = [...activeCategories.value];
  const params: Record<string, any> = { limit: pageLimit.value, before: beforeCursor.value };
  if (categories.length < CATEGORIES.length) params.category = categories.join(',');
  await new Promise<void>((resolve) => {
    botStore.sendExec(selectedBotModel.value, 'get_action_log', params, (res: any) => {
      if (res.ok && res.data) {
        const data = res.data;
        const newEntries: any[] = (data.entries ?? []).map((e: any) => ({ ...e, _bot: selectedBotModel.value }));
        entries.value = [...entries.value, ...newEntries];
        hasMore.value = data.has_more === true;
        beforeCursor.value = newEntries.length > 0 ? String(newEntries[newEntries.length - 1].id) : null;
      }
      resolve();
    });
  });
  loading.value = false;
}

// ── Formatters ────────────────────────────────────────────────

function fmt(n: number | undefined): string {
  if (n == null) return '0';
  return new Intl.NumberFormat().format(Math.round(n));
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatEntry(entry: any): string {
  if (entry.summary) return entry.summary;
  if (entry.event_type) return entry.event_type.replace(/\./g, ' ');
  const d = entry.data || {};
  const parts: string[] = [];
  if (d.item_name || d.item_id) parts.push(d.item_name || d.item_id);
  if (d.quantity) parts.push(`×${d.quantity}`);
  if (d.target) parts.push(`→ ${d.target}`);
  return parts.join(' ') || entry.category || '—';
}

// Reload when limit changes
watch(pageLimit, () => reload());
</script>
