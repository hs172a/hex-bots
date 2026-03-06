import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

// ── Types ─────────────────────────────────────────────────────

export interface ParsedLogEntry {
  raw: string;
  parsed: { time: string; username: string; category: string; message: string } | null;
}

export interface ParsedBroadcastEntry {
  type: 'empty' | 'header' | 'simple' | 'market' | 'combat' | 'forum' | 'alert' | 'content';
  raw: string;
  tag?: string;
  time?: string;
  message?: string;
}

export interface BroadcastGroup {
  entry: ParsedBroadcastEntry;
  count: number;
}

// Re-open to continue remaining fields (TS trick avoided — we extend above)
export interface ParsedBroadcastEntry {
  sender?: string;
  title?: string;
  titleType?: 'shortage' | 'surplus' | 'other';
  items?: { name: string; price: number; multiplier: number }[];
  command?: string;
  pirate?: string;
  tier?: string;
  damage?: string;
  hullStr?: string;
  victim?: string;
  author?: string;
  forumTitle?: string;
  category?: string;
  botName?: string;
}

// ── Regex constants ───────────────────────────────────────────

const LOG_LINE_RE = /^(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/;
const BROADCAST_HEADER_RE = /^(\[.+?\]|[A-Z][A-Z0-9 ]+)\s+(\d{2}:\d{2}:\d{2})$/;
const BROADCAST_SIMPLE_RE = /^(\d{2}:\d{2}:\d{2})\s+(.+)$/s;
const NEW_TAGGED_RE = /^(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.+)$/s;
const MARKET_RE = /^(.+?):\s+(RESOURCE SHORTAGE|SURPLUS SALE|PRICE ALERT|MARKET UPDATE)\s*[\u2014\u2013-]\s*(.+)$/s;
const BROADCAST_ITEM_RE = /(\w+)\s+at\s+(\d+(?:\.\d+)?)cr\s+\(([0-9.]+)x\s+normal\)/g;

// ── Parse functions ───────────────────────────────────────────

export function parseLogLine(raw: string): ParsedLogEntry {
  const m = LOG_LINE_RE.exec(raw);
  if (m) return { raw, parsed: { time: m[1], username: m[2], category: m[3], message: m[4] } };
  return { raw, parsed: null };
}

function parseKV(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = s.split(/,\s*(?=[a-zA-Z_]+:\s)/);
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (/^[a-zA-Z_]+$/.test(key)) result[key] = val;
    }
  }
  return result;
}

function classifyInner(inner: string, raw: string): ParsedBroadcastEntry | null {
  const mm = MARKET_RE.exec(inner);
  if (mm) {
    const items: { name: string; price: number; multiplier: number }[] = [];
    const itemRe = new RegExp(BROADCAST_ITEM_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(mm[3])) !== null) {
      items.push({ name: m[1], price: parseInt(m[2]), multiplier: parseFloat(m[3]) });
    }
    const cmdMatch = /(?:Dock and (?:sell|buy):)\s*(.+)$/.exec(mm[3]);
    return {
      type: 'market', raw,
      sender: mm[1].trim(),
      title: mm[2].trim(),
      titleType: mm[2].includes('SHORTAGE') ? 'shortage' : mm[2].includes('SURPLUS') || mm[2].includes('SALE') ? 'surplus' : 'other',
      items,
      command: cmdMatch ? cmdMatch[1].trim() : undefined,
    };
  }

  if (/\bdamage:\s*\d/.test(inner) && /\bpirate_name:/.test(inner)) {
    const kv = parseKV(inner);
    const dmgType = kv.damage_type ? ` ${kv.damage_type}` : '';
    const hullParts: string[] = [];
    if (kv.your_hull && kv.your_max_hull) hullParts.push(`Hull: ${kv.your_hull}/${kv.your_max_hull}`);
    if (kv.your_shield !== undefined) hullParts.push(`Shield: ${kv.your_shield}`);
    return {
      type: 'combat', raw,
      pirate: kv.pirate_name || 'Unknown',
      tier: kv.pirate_tier || undefined,
      damage: `${kv.damage || '?'}${dmgType} dmg`,
      hullStr: hullParts.join(' | ') || undefined,
    };
  }

  if (/\bthread_id:/.test(inner) || /\btype:\s*new_forum_post/.test(inner)) {
    const kv = parseKV(inner);
    return { type: 'forum', raw, author: kv.author || '', category: kv.category || undefined, forumTitle: kv.title || undefined };
  }

  const combatM = /^⚔\s+(.+?)(?:\s+\(([^)]+)\))?\s+—\s+([^|]+?)(?:\s+\|\s+(?!👤)([^|]+?))?(?:\s+\|\s+👤\s+(.+))?$/.exec(inner);
  if (combatM) {
    return { type: 'combat', raw, pirate: combatM[1]?.trim(), tier: combatM[2], damage: combatM[3]?.trim(), hullStr: combatM[4]?.trim(), victim: combatM[5]?.trim() };
  }

  const forumM = /^📌\s+(.+?)(?:\s+\[([^\]]+)\])?(?:\s*:\s*(.+))?$/.exec(inner);
  if (forumM) {
    return { type: 'forum', raw, author: forumM[1]?.trim(), category: forumM[2], forumTitle: forumM[3]?.trim() };
  }

  if (/attack imminent|detected you|enemy ship|combat alert|attacking you/i.test(inner)) {
    return { type: 'alert', raw, message: inner };
  }

  return null;
}

// Match embedded bot-name prefix: "@BotName: rest of message"
const BOT_PREFIX_RE = /^@([\w]+):\s+(.+)$/s;

export function parseBroadcastLine(raw: string): ParsedBroadcastEntry {
  if (!raw.trim()) return { type: 'empty', raw };

  // New format: "HH:MM:SS [TAG] inner message" — classify inner before falling back to simple
  const ntm = NEW_TAGGED_RE.exec(raw);
  if (ntm) {
    const time = ntm[1];
    const tag = ntm[2];
    let inner = ntm[3];
    // Extract optional @BotName: prefix embedded by the server for SYS notifications
    let botName: string | undefined;
    const bpm = BOT_PREFIX_RE.exec(inner);
    if (bpm) { botName = bpm[1]; inner = bpm[2]; }
    const classified = classifyInner(inner, raw);
    if (classified) {
      classified.time = time;
      if (!classified.tag) classified.tag = tag;
      if (!classified.message) classified.message = inner;
      if (botName) classified.botName = botName;
      return classified;
    }
    return { type: 'simple', raw, time, tag, message: inner, botName };
  }

  // Old format header: "SYSTEM 12:15:09"
  const hm = BROADCAST_HEADER_RE.exec(raw);
  if (hm) return { type: 'header', raw, tag: hm[1], time: hm[2] };

  // Old format content lines — classify before simple fallback
  const classified = classifyInner(raw, raw);
  if (classified) return classified;

  // Old plain "HH:MM:SS message" (no tag)
  const sm = BROADCAST_SIMPLE_RE.exec(raw);
  if (sm) return { type: 'simple', raw, time: sm[1], message: sm[2] };

  return { type: 'content', raw };
}

// ── Deduplication ───────────────────────────────────────────────

function getDedupeKey(entry: ParsedBroadcastEntry): string | null {
  switch (entry.type) {
    case 'empty':  return null; // skip empties
    case 'market': return null; // never deduplicate actionable cards
    case 'alert':  return `a:${entry.message || entry.raw.replace(/^\d{2}:\d{2}:\d{2}\s*(\[[^\]]+\]\s*)?/, '')}`;
    case 'simple': return `s:${entry.tag || ''}:${entry.message}`;
    case 'combat': return `c:${entry.pirate}:${entry.damage}`;
    case 'forum':  return `f:${entry.author}:${entry.forumTitle}`;
    case 'header': return `h:${entry.tag}`;
    default:       return `x:${entry.raw}`;
  }
}

export function deduplicateGroups(entries: ParsedBroadcastEntry[]): BroadcastGroup[] {
  const groups: BroadcastGroup[] = [];
  for (const entry of entries) {
    const key = getDedupeKey(entry);
    if (key === null) {
      if (entry.type !== 'empty') groups.push({ entry, count: 1 });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && getDedupeKey(last.entry) === key) {
      last.count++;
      // Keep latest timestamp so the displayed time is the most recent occurrence
      if (entry.time) last.entry = { ...last.entry, time: entry.time };
    } else {
      groups.push({ entry, count: 1 });
    }
  }
  return groups;
}

// ── Color helpers ─────────────────────────────────────────────

export const BOT_PALETTE = [
  'text-space-accent', 'text-purple-400', 'text-lime-400',
  'text-orange-400', 'text-pink-400', 'text-teal-400', 'text-rose-400',
];

export const CAT_COLORS: Record<string, string> = {
  error:     'text-red-400',
  warn:      'text-yellow-400',
  warning:   'text-yellow-400',
  wait:      'text-yellow-400',
  success:   'text-green-400',
  sold:      'text-green-400',
  profit:    'text-green-400',
  mining:    'text-amber-400',
  mined:     'text-amber-400',
  trade:     'text-lime-400',
  market:    'text-lime-400',
  travel:    'text-sky-400',
  navigation:'text-sky-400',
  system:    'text-slate-400',
  info:      'text-slate-400',
  combat:    'text-orange-400',
  faction:   'text-purple-400',
  crafting:  'text-orange-400',
  fuel:      'text-cyan-400',
  repair:    'text-cyan-400',
};

export function categoryColor(cat: string): string {
  return CAT_COLORS[cat?.toLowerCase()] || 'text-slate-400';
}

export function msgColor(cat: string): string {
  if (!cat) return 'text-space-text';
  const c = cat.toLowerCase();
  if (c === 'error') return 'text-red-300';
  if (c === 'warn' || c === 'warning' || c === 'wait') return 'text-yellow-200';
  if (c === 'success') return 'text-green-300';
  return 'text-space-text';
}

export function plainSystemColor(line: string): string {
  const l = line.toLowerCase();
  if (l.includes('error') || l.includes('failed') || l.includes('crash')) return 'text-red-400';
  if (l.includes('warn') || l.includes('retry')) return 'text-yellow-400';
  if (l.includes('success') || l.includes('registered') || l.includes('seeded')) return 'text-green-400';
  return 'text-space-text-dim';
}

// ── Composable ────────────────────────────────────────────────

export function useDashboardLogs() {
  const botStore = useBotStore();

  const activityBotFilter = ref('');
  const systemBotFilter = ref('');
  const systemCatFilter = ref('');

  function botUsernameColor(username: string): string {
    const idx = botStore.bots.findIndex(b => b.username === username);
    return BOT_PALETTE[idx >= 0 ? idx % BOT_PALETTE.length : 0];
  }

  const filteredActivityLogs = computed((): ParsedLogEntry[] => {
    const entries = botStore.activityLogs.slice(-200).map(parseLogLine);
    if (!activityBotFilter.value) return entries;
    return entries.filter(e => e.parsed?.username === activityBotFilter.value);
  });

  const filteredSystemLogs = computed((): ParsedLogEntry[] => {
    const entries = botStore.systemLogs.slice(-200).map(parseLogLine);
    if (!systemBotFilter.value && !systemCatFilter.value) return entries;
    return entries.filter(e => {
      if (!e.parsed) return !systemBotFilter.value;
      if (systemBotFilter.value && e.parsed.username !== systemBotFilter.value) return false;
      if (systemCatFilter.value && e.parsed.category !== systemCatFilter.value) return false;
      return true;
    });
  });

  const parsedBroadcastLogs = computed((): ParsedBroadcastEntry[] =>
    botStore.broadcastLogs.slice(-200).map(parseBroadcastLine)
  );

  const groupedBroadcastLogs = computed((): BroadcastGroup[] =>
    deduplicateGroups(parsedBroadcastLogs.value)
  );

  return {
    activityBotFilter,
    systemBotFilter,
    systemCatFilter,
    botUsernameColor,
    filteredActivityLogs,
    filteredSystemLogs,
    parsedBroadcastLogs,
    groupedBroadcastLogs,
  };
}
