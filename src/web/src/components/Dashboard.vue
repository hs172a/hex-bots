<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Fleet Stats Bar -->
    <div class="flex gap-4 m-2 px-3 py-2 bg-space-card border border-space-border rounded-lg">
      <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider self-center mr-2">
        Fleet Stats
      </span>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">🤖 {{ activeBots }}</span>
        <span class="text-xs text-space-text-dim">Active Bots</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">₡{{ formatNumber(fleetCredits) }}</span>
        <span class="text-xs text-space-text-dim">Fleet Credits</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">₡{{ formatNumber(todayProfit) }}</span>
        <span class="text-xs text-space-text-dim">Trade Profit</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(todayTrades) }}</span>
        <span class="text-xs text-space-text-dim">Trades</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ avgProfitPerTrade > 0 ? '₡' + formatNumber(avgProfitPerTrade) : '—' }}</span>
        <span class="text-xs text-space-text-dim">Avg/Trade</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalMined) }}</span>
        <span class="text-xs text-space-text-dim">Ores Mined</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalCrafted) }}</span>
        <span class="text-xs text-space-text-dim">Items Crafted</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalSystems) }}</span>
        <span class="text-xs text-space-text-dim">Explored</span>
      </div>
    </div>

    <!-- Bot table card -->
    <div class="card overflow-hidden flex flex-col mx-2 px-3 py-2">
      <div class="flex items-center justify-between pb-2 border-b border-space-border">
        <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">
          Bots ({{ botStore.bots.length }})
        </span>
        <div class="flex gap-2">
          <button @click="showAddBot = true" class="btn btn-primary px-2 py-1 text-xs">
            Add Bot
          </button>
        </div>
      </div>

      <!-- Bot table -->
      <div class="flex-1 overflow-auto mt-2 p-0">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-space-card border-b border-space-border bg-transparent">
            <tr class="text-left text-xs text-space-text-dim uppercase tracking-wider">
              <th class="py-2 px-0 font-semibold">Name</th>
              <th class="py-2 px-0 font-semibold">Ship</th>
              <th class="py-2 px-0 font-semibold">State</th>
              <th class="py-2 px-0 font-semibold">Credits</th>
              <th class="py-2 px-0 font-semibold">Fuel</th>
              <th class="py-2 px-0 font-semibold">Hull</th>
              <th class="py-2 px-0 font-semibold">Shield</th>
              <th class="py-2 px-0 font-semibold">Cargo</th>
              <th class="py-2 px-0 font-semibold">Location</th>
              <th class="py-2 px-0 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="bot in botStore.bots"
              :key="bot.username"
              class="border-b border-space-border hover:bg-space-row-hover transition-colors cursor-pointer"
              @click="selectBot(bot.username)"
            >
              <td class="px-0 py-1">
                <span class="text-space-accent font-medium">{{ bot.username }}</span>
              </td>
              <td class="px-0 py-1 text-space-text-dim">
                {{ bot.shipName || bot.ship || 'Unknown' }}
              </td>
              <td class="px-0 py-1">
                <span 
                  class="badge px-3 py-0.5"
                  :class="{
                    'badge-green': bot.state === 'running',
                    'badge-yellow': bot.state === 'stopped' || bot.state === 'idle',
                    'badge-red': bot.state === 'error'
                  }"
                >
                  {{ bot.state === 'running' && bot.routine ? bot.routine : bot.state }}
                </span>
              </td>
              <td class="px-0 py-1">
                <span class="text-space-yellow">₡{{ formatNumber(bot.credits) }}</span>
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.fuel" 
                  :max="bot.maxFuel" 
                  color="cyan"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.hull" 
                  :max="bot.maxHull" 
                  color="red"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.shield" 
                  :max="bot.maxShield" 
                  color="cyan"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.cargo" 
                  :max="bot.cargoMax" 
                  color="magenta"
                />
              </td>
              <td class="px-0 py-1 text-space-cyan">
                {{ bot.poi ? botStore.resolveLocation(bot.system || '', bot.poi) : (botStore.resolveLocation(bot.system || '') || bot.location) }}
              </td>
              <td class="px-0 py-1">
                <div class="flex gap-1 items-center">
                  <template v-if="bot.state !== 'running' && bot.state !== 'stopping'">
                    <select 
                      :id="'routine-' + bot.username"
                      @click.stop
                      class="input text-[11px] px-1 py-0.5"
                    >
                      <option v-for="r in botStore.routines" :key="r" :value="r">{{ r }}</option>
                    </select>
                    <button 
                      @click.stop="startBotInline(bot.username)"
                      class="btn btn-primary text-xs py-0.5 px-2"
                    >Start</button>
                  </template>
                  <button 
                    v-if="bot.state === 'running'"
                    @click.stop="stopBot(bot.username)"
                    class="btn-danger text-xs py-0.5 px-2"
                  >Stop</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Scrollable content wrapper -->
    <div class="flex-1 overflow-auto p-2 pb-0 space-y-4">
      <!-- Log panels (Activity, Broadcast, System) -->
      <div class="grid grid-cols-3 gap-2 h-72">

        <!-- Activity Log -->
        <div class="card flex flex-col overflow-hidden py-2 px-3">
          <div class="flex items-center justify-between pb-1.5 border-b border-space-border shrink-0">
            <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Activity Log</span>
            <select v-model="activityBotFilter" class="input text-[10px] py-0 h-5 pl-1 max-w-[100px]">
              <option value="">All bots</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
          </div>
          <div ref="activityLogRef" class="flex-1 overflow-auto mt-1 pr-0.5 font-mono scrollbar-dark space-y-px">
            <div
              v-for="(entry, idx) in filteredActivityLogs"
              :key="idx"
              class="leading-snug text-[10px] whitespace-pre-wrap"
            >
              <template v-if="entry.parsed">
                <span class="text-[#555d6b]">{{ entry.parsed.time }}</span>
                <span :class="botUsernameColor(entry.parsed.username)"> [{{ entry.parsed.username }}]</span>
                <span :class="categoryColor(entry.parsed.category)">[{{ entry.parsed.category }}] </span>
                <span class="text-space-text"> {{ entry.parsed.message }}</span>
              </template>
              <span v-else class="text-space-text-dim">{{ entry.raw }}</span>
            </div>
            <div v-if="filteredActivityLogs.length === 0" class="text-space-text-dim text-[10px] italic py-1">No entries</div>
          </div>
        </div>

        <!-- Broadcast / Chat -->
        <div class="card flex flex-col overflow-hidden py-2 px-3">
          <div class="flex items-center justify-between pb-1.5 border-b border-space-border shrink-0">
            <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Broadcast / Chat</span>
            <span class="text-[10px] text-space-text-dim">{{ botStore.broadcastLogs.length }} msgs</span>
          </div>
          <div ref="broadcastLogRef" class="flex-1 overflow-auto mt-1 pr-0.5 font-mono scrollbar-dark">
            <template v-for="(entry, idx) in parsedBroadcastLogs" :key="idx">

              <!-- Market announcement card (RESOURCE SHORTAGE / SURPLUS SALE) -->
              <div v-if="entry.type === 'market'"
                class="rounded border px-1 py-0.5 my-1 text-[10px]"
                :class="entry.titleType === 'shortage'
                  ? 'border-orange-800/50 bg-orange-950/20'
                  : entry.titleType === 'surplus'
                    ? 'border-green-800/50 bg-green-950/20'
                    : 'border-space-border bg-[#0d1117]'"
              >
                <!-- Sender + title badge -->
                <div class="flex items-center gap-1.5 mb-1.5">
                  <span class="font-semibold text-space-yellow">{{ entry.sender }}</span>
                  <span
                    class="px-1.5 py-0 rounded text-[9px] font-bold tracking-wide uppercase"
                    :class="entry.titleType === 'shortage'
                      ? 'bg-orange-900/60 text-orange-300'
                      : entry.titleType === 'surplus'
                        ? 'bg-green-900/60 text-green-300'
                        : 'bg-[#21262d] text-space-text-dim'"
                  >{{ entry.title }}</span>
                </div>
                <!-- Item pills -->
                <div v-if="entry.items?.length" class="flex flex-wrap gap-1 mb-1">
                  <span
                    v-for="item in entry.items" :key="item.name"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#161b22] border border-[#30363d]"
                  >
                    <span class="text-space-text">{{ item.name.replace(/_/g, '\u200b_') }}</span>
                    <span class="text-space-yellow font-semibold">{{ item.price }}cr</span>
                    <span class="text-[9px] font-bold"
                      :class="item.multiplier >= 3 ? 'text-red-400' : item.multiplier >= 2 ? 'text-orange-400' : 'text-yellow-500'"
                    >×{{ item.multiplier }}</span>
                  </span>
                </div>
                <!-- Command hint -->
                <div v-if="entry.command" class="text-[9px] text-space-text-dim opacity-60 truncate">
                  ▶ {{ entry.command.slice(0, 80) }}{{ entry.command.length > 80 ? '…' : '' }}
                </div>
              </div>

              <!-- Attack / combat alert -->
              <div v-else-if="entry.type === 'alert'"
                class="flex items-start gap-1.5 leading-snug text-[10px] text-red-400 py-0.5"
              >
                <span class="shrink-0 text-red-500">⚠</span>
                <span>{{ entry.raw }}</span>
              </div>

              <!-- Channel header (e.g. "CHAT SYSTEM 12:15:09") -->
              <div v-else-if="entry.type === 'header'" class="leading-none mt-0 mb-0.5">
                <span class="text-[9px] text-space-text-dim uppercase tracking-widest opacity-60">{{ entry.tag }}</span>
                <span class="text-[#555d6b] ml-1 text-[9px]">{{ entry.time }}</span>
              </div>

              <!-- Simple: "HH:MM:SS message" -->
              <div v-else-if="entry.type === 'simple'" class="leading-snug text-[10px]">
                <span class="text-[#555d6b]">{{ entry.time }}</span>
                <span class="text-space-cyan"> {{ entry.message }}</span>
              </div>

              <!-- Empty separator between message groups -->
              <div v-else-if="entry.type === 'empty'" class="h-1.5"></div>

              <!-- Fallback content -->
              <div v-else class="leading-snug text-[10px] text-space-text-dim whitespace-pre-wrap py-px">{{ entry.raw }}</div>

            </template>
            <div v-if="parsedBroadcastLogs.length === 0" class="text-space-text-dim text-[10px] italic py-1">No messages</div>
          </div>
        </div>

        <!-- System Messages -->
        <div class="card flex flex-col overflow-hidden py-2 px-3">
          <div class="flex items-center gap-1 pb-1.5 border-b border-space-border shrink-0">
            <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider flex-1">System Messages</span>
            <select v-model="systemBotFilter" class="input text-[10px] py-0 h-5 pl-1 max-w-[90px]">
              <option value="">All bots</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
            <select v-model="systemCatFilter" class="input text-[10px] py-0 h-5 pl-1 max-w-[70px]">
              <option value="">All</option>
              <option value="error">error</option>
              <option value="system">system</option>
              <option value="warn">warn</option>
            </select>
          </div>
          <div ref="systemLogRef" class="flex-1 overflow-auto mt-1 pr-0.5 font-mono scrollbar-dark space-y-px">
            <div
              v-for="(entry, idx) in filteredSystemLogs"
              :key="idx"
              class="leading-snug text-[10px] whitespace-pre-wrap"
            >
              <template v-if="entry.parsed">
                <span class="text-[#555d6b]">{{ entry.parsed.time }}</span>
                <span :class="botUsernameColor(entry.parsed.username)"> [{{ entry.parsed.username }}]</span>
                <span :class="categoryColor(entry.parsed.category)">[{{ entry.parsed.category }}] </span>
                <span :class="msgColor(entry.parsed.category)"> {{ entry.parsed.message }}</span>
              </template>
              <span v-else :class="plainSystemColor(entry.raw)" class="text-[10px]">{{ entry.raw }}</span>
            </div>
            <div v-if="filteredSystemLogs.length === 0" class="text-space-text-dim text-[10px] italic py-1">No entries</div>
          </div>
        </div>

      </div>
    </div>

    <!-- Chat bar -->
    <div class="flex gap-2 p-4 bg-space-card border-t border-space-border">
      <select v-model="selectedChatBot" class="input text-xs px-2 py-1">
        <option value="">Select Bot</option>
        <option v-for="bot in botStore.bots" :key="bot.username" :value="bot.username">
          {{ bot.username }}
        </option>
      </select>
      <select v-model="chatChannel" class="input text-xs px-2 py-1">
        <option value="system">System</option>
        <option value="local">Local</option>
        <option value="faction">Faction</option>
      </select>
      <input 
        v-model="chatMessage" 
        @keydown.enter="sendChat"
        type="text" 
        placeholder="Type a message..." 
        class="flex-1 input text-xs px-2 py-1"
      />
      <button @click="sendChat" class="btn btn-primary text-xs px-3 py-1">
        Send
      </button>
    </div>

    <!-- Add Bot Modal -->
    <div v-if="showAddBot" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showAddBot = false">
      <div class="bg-space-card border border-space-border rounded-lg p-6 w-96">
        <h3 class="text-lg font-semibold text-space-text-bright mb-4">Add New Bot</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Username</label>
            <input v-model="newBot.username" type="text" class="input w-full" />
          </div>
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Password</label>
            <input v-model="newBot.password" type="password" class="input w-full" />
          </div>
        </div>
        <div class="flex gap-2 mt-6">
          <button @click="addBot" class="btn btn-primary flex-1">Add Bot</button>
          <button @click="showAddBot = false" class="btn flex-1">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Start Bot Modal -->
    <div v-if="showStartBot" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showStartBot = false">
      <div class="bg-space-card border border-space-border rounded-lg p-6 w-[32rem]">
        <h3 class="text-lg font-semibold text-space-text-bright mb-4">
          Start Bot: {{ startBotData.username }}
        </h3>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-space-text-dim mb-2">Select Routine</label>
            <div class="grid grid-cols-2 gap-2">
              <div 
                v-for="routine in availableRoutines" 
                :key="routine.id"
                @click="startBotData.routine = routine.id"
                class="p-3 border rounded cursor-pointer transition-colors"
                :class="{
                  'border-space-accent bg-space-accent bg-opacity-10': startBotData.routine === routine.id,
                  'border-space-border hover:border-space-accent hover:bg-space-row-hover': startBotData.routine !== routine.id
                }"
              >
                <div class="text-sm font-medium text-space-text-bright mb-1">{{ routine.name }}</div>
                <div class="text-xs text-space-text-dim">{{ routine.description }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-6">
          <button @click="startBot" class="btn btn-primary flex-1">Start Bot</button>
          <button @click="showStartBot = false" class="btn flex-1">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { useBotStore } from '../stores/botStore';
import ProgressBar from './ProgressBar.vue';

// ── Log parsing ───────────────────────────────────────────────

interface ParsedLogEntry {
  raw: string;
  parsed: { time: string; username: string; category: string; message: string } | null;
}

interface ParsedBroadcastEntry {
  type: 'header' | 'content' | 'empty' | 'simple' | 'market' | 'alert';
  raw: string;
  tag?: string;
  time?: string;
  message?: string;
  sender?: string;
  title?: string;
  titleType?: 'shortage' | 'surplus' | 'other';
  items?: { name: string; price: number; multiplier: number }[];
  command?: string;
}

const LOG_LINE_RE = /^(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/;
const BROADCAST_HEADER_RE = /^(\[.+?\]|[A-Z][A-Z0-9 ]+)\s+(\d{2}:\d{2}:\d{2})$/;
const BROADCAST_SIMPLE_RE = /^(\d{2}:\d{2}:\d{2})\s+(.+)$/;
const MARKET_RE = /^(.+?):\s+(RESOURCE SHORTAGE|SURPLUS SALE|PRICE ALERT|MARKET UPDATE)\s*[\u2014\u2013-]\s*(.+)$/s;
const BROADCAST_ITEM_RE = /(\w+)\s+at\s+(\d+(?:\.\d+)?)cr\s+\(([0-9.]+)x\s+normal\)/g;

function parseLogLine(raw: string): ParsedLogEntry {
  const m = LOG_LINE_RE.exec(raw);
  if (m) return { raw, parsed: { time: m[1], username: m[2], category: m[3], message: m[4] } };
  return { raw, parsed: null };
}

function parseBroadcastLine(raw: string): ParsedBroadcastEntry {
  if (!raw.trim()) return { type: 'empty', raw };

  // Header: "[TAG] HH:MM:SS" or "CHAT SYSTEM HH:MM:SS"
  const hm = BROADCAST_HEADER_RE.exec(raw);
  if (hm) return { type: 'header', raw, tag: hm[1], time: hm[2] };

  // Simple: "HH:MM:SS message"
  const sm = BROADCAST_SIMPLE_RE.exec(raw);
  if (sm) return { type: 'simple', raw, time: sm[1], message: sm[2] };

  // Market announcement: "Sender: RESOURCE SHORTAGE — ..."
  const mm = MARKET_RE.exec(raw);
  if (mm) {
    const items: { name: string; price: number; multiplier: number }[] = [];
    const itemRe = new RegExp(BROADCAST_ITEM_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(mm[3])) !== null) {
      items.push({ name: m[1], price: parseInt(m[2]), multiplier: parseFloat(m[3]) });
    }
    const cmdMatch = /(?:Dock and (?:sell|buy):)\s*(.+)$/.exec(mm[3]);
    return {
      type: 'market',
      raw,
      sender: mm[1].trim(),
      title: mm[2].trim(),
      titleType: mm[2].includes('SHORTAGE') ? 'shortage' : mm[2].includes('SURPLUS') || mm[2].includes('SALE') ? 'surplus' : 'other',
      items,
      command: cmdMatch ? cmdMatch[1].trim() : undefined,
    };
  }

  // Alert: attack / combat warnings
  if (/attack imminent|detected you|enemy ship|combat alert/i.test(raw)) {
    return { type: 'alert', raw };
  }

  return { type: 'content', raw };
}

// ── Color helpers ─────────────────────────────────────────────

const BOT_PALETTE = [
  'text-space-accent', 'text-purple-400', 'text-lime-400',
  'text-orange-400', 'text-pink-400', 'text-teal-400', 'text-rose-400',
];

const CAT_COLORS: Record<string, string> = {
  error:    'text-red-400',
  warn:     'text-yellow-400',
  warning:  'text-yellow-400',
  wait:     'text-yellow-400',
  success:  'text-green-400',
  sold:     'text-green-400',
  profit:   'text-green-400',
  mining:   'text-amber-400',
  mined:    'text-amber-400',
  trade:    'text-lime-400',
  market:   'text-lime-400',
  travel:   'text-sky-400',
  navigation:'text-sky-400',
  system:   'text-slate-400',
  info:     'text-slate-400',
  combat:   'text-orange-400',
  faction:  'text-purple-400',
  crafting: 'text-orange-400',
  fuel:     'text-cyan-400',
  repair:   'text-cyan-400',
};

function botUsernameColor(username: string): string {
  const idx = botStore.bots.findIndex(b => b.username === username);
  return BOT_PALETTE[idx >= 0 ? idx % BOT_PALETTE.length : 0];
}

function categoryColor(cat: string): string {
  return CAT_COLORS[cat?.toLowerCase()] || 'text-slate-400';
}

function msgColor(cat: string): string {
  if (!cat) return 'text-space-text';
  const c = cat.toLowerCase();
  if (c === 'error') return 'text-red-300';
  if (c === 'warn' || c === 'warning' || c === 'wait') return 'text-yellow-200';
  if (c === 'success') return 'text-green-300';
  return 'text-space-text';
}

function plainSystemColor(line: string): string {
  const l = line.toLowerCase();
  if (l.includes('error') || l.includes('failed') || l.includes('crash')) return 'text-red-400';
  if (l.includes('warn') || l.includes('retry')) return 'text-yellow-400';
  if (l.includes('success') || l.includes('registered') || l.includes('seeded')) return 'text-green-400';
  return 'text-space-text-dim';
}

// ── Filters ───────────────────────────────────────────────────

const activityBotFilter = ref('');
const systemBotFilter = ref('');
const systemCatFilter = ref('');

// ── Computed filtered/parsed logs ────────────────────────────

const filteredActivityLogs = computed((): ParsedLogEntry[] => {
  const entries = botStore.activityLogs.map(parseLogLine);
  if (!activityBotFilter.value) return entries;
  return entries.filter(e => e.parsed?.username === activityBotFilter.value);
});

const filteredSystemLogs = computed((): ParsedLogEntry[] => {
  const entries = botStore.systemLogs.map(parseLogLine);
  if (!systemBotFilter.value && !systemCatFilter.value) return entries;
  return entries.filter(e => {
    if (!e.parsed) return !systemBotFilter.value;
    if (systemBotFilter.value && e.parsed.username !== systemBotFilter.value) return false;
    if (systemCatFilter.value && e.parsed.category !== systemCatFilter.value) return false;
    return true;
  });
});

const parsedBroadcastLogs = computed((): ParsedBroadcastEntry[] =>
  botStore.broadcastLogs.map(parseBroadcastLine)
);

const emit = defineEmits<{
  (e: 'open-profile', username: string): void;
}>();

const botStore = useBotStore();
const showAddBot = ref(false);
const showStartBot = ref(false);
const newBot = ref({ username: '', password: '' });
const startBotData = ref({ username: '', routine: 'miner' });
const selectedChatBot = ref('');
const chatChannel = ref('system');
const chatMessage = ref('');

const availableRoutines = computed(() => 
  botStore.routines.map(r => ({ id: r, name: r, description: '' }))
);

const activeBots = computed(() => botStore.bots.filter(b => b.state === 'running').length);
const fleetCredits = computed(() => botStore.bots.reduce((sum, b) => sum + b.credits, 0));
const totalMined = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalMined || 0), 0));
const totalCrafted = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalCrafted || 0), 0));
const totalSystems = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalSystems || 0), 0));

function sumStatsField(field: string, days = 0): number {
  let total = 0;
  const cutoff = days > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); })() : null;
  for (const daily of Object.values(botStore.statsDaily)) {
    for (const [date, s] of Object.entries(daily as any)) {
      if (cutoff && date < cutoff) continue;
      total += (s as any)[field] || 0;
    }
  }
  return total;
}

const todayTrades = computed(() => sumStatsField('trades', 1));
const todayProfit = computed(() => sumStatsField('profit', 1));
const avgProfitPerTrade = computed(() => todayTrades.value > 0 ? Math.round(todayProfit.value / todayTrades.value) : 0);

// Log scroll refs
const activityLogRef = ref<HTMLElement | null>(null);
const broadcastLogRef = ref<HTMLElement | null>(null);
const systemLogRef = ref<HTMLElement | null>(null);

watch(() => filteredActivityLogs.value.length, () => nextTick(() => {
  if (activityLogRef.value) activityLogRef.value.scrollTop = activityLogRef.value.scrollHeight;
}));
watch(() => parsedBroadcastLogs.value.length, () => nextTick(() => {
  if (broadcastLogRef.value) broadcastLogRef.value.scrollTop = broadcastLogRef.value.scrollHeight;
}));
watch(() => filteredSystemLogs.value.length, () => nextTick(() => {
  if (systemLogRef.value) systemLogRef.value.scrollTop = systemLogRef.value.scrollHeight;
}));

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function selectBot(username: string) {
  emit('open-profile', username);
}

function openStartBotModal(username: string) {
  startBotData.value = { username, routine: 'miner' };
  showStartBot.value = true;
}

async function startBot() {
  if (!startBotData.value.username || !startBotData.value.routine) return;
  
  try {
    await botStore.startBot(startBotData.value.username, startBotData.value.routine);
    showStartBot.value = false;
  } catch (err) {
    console.error('Failed to start bot:', err);
  }
}

function startBotInline(username: string) {
  const sel = document.getElementById(`routine-${username}`) as HTMLSelectElement | null;
  const routine = sel?.value || 'miner';
  botStore.startBot(username, routine);
}

async function stopBot(username: string) {
  botStore.stopBot(username);
}

async function addBot() {
  if (!newBot.value.username || !newBot.value.password) return;
  
  try {
    botStore.addBot(newBot.value.username, newBot.value.password);
    showAddBot.value = false;
    newBot.value = { username: '', password: '' };
  } catch (err) {
    console.error('Failed to add bot:', err);
  }
}

async function sendChat() {
  if (!chatMessage.value || !selectedChatBot.value) return;
  
  try {
    botStore.sendChat(selectedChatBot.value, chatChannel.value, chatMessage.value);
    chatMessage.value = '';
  } catch (err) {
    console.error('Failed to send chat:', err);
  }
}
</script>
