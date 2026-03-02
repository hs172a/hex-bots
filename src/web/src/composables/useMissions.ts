import { ref, computed, type Ref } from 'vue';
import { useBotStore } from '../stores/botStore';

// ── Types ─────────────────────────────────────────────────────

export function typeConfig(type: string): { icon: string; bg: string } {
  const map: Record<string, { icon: string; bg: string }> = {
    delivery:             { icon: '📦', bg: 'bg-blue-500/10 text-blue-400' },
    trade:                { icon: '💱', bg: 'bg-green-500/10 text-green-400' },
    market_participation: { icon: '📊', bg: 'bg-cyan-500/10 text-cyan-400' },
    hauling:              { icon: '🚚', bg: 'bg-orange-500/10 text-orange-400' },
    mining:               { icon: '⛏️', bg: 'bg-amber-500/10 text-amber-400' },
    salvage:              { icon: '♻️', bg: 'bg-lime-500/10 text-lime-400' },
    combat:               { icon: '⚔️', bg: 'bg-red-500/10 text-red-400' },
    exploration:          { icon: '🔭', bg: 'bg-purple-500/10 text-purple-400' },
    contract:             { icon: '📋', bg: 'bg-indigo-500/10 text-indigo-400' },
  };
  return map[(type || '').toLowerCase()] ?? { icon: '🎯', bg: 'bg-[#21262d] text-space-text-dim' };
}

// ── Difficulty helpers ────────────────────────────────────────

export function getDifficultyText(difficulty?: string | number): string {
  if (typeof difficulty === 'number') {
    if (difficulty <= 1) return 'Easy';
    if (difficulty <= 2) return 'Medium';
    if (difficulty <= 3) return 'Hard';
    if (difficulty <= 4) return 'Very Hard';
    return 'Extreme';
  }
  return (difficulty as string) || 'Normal';
}

export function getDifficultyClass(difficulty?: string | number): string {
  if (typeof difficulty === 'number') {
    if (difficulty <= 1) return 'bg-green-600/30 text-green-300';
    if (difficulty <= 2) return 'bg-yellow-600/30 text-yellow-300';
    if (difficulty <= 3) return 'bg-orange-600/30 text-orange-300';
    if (difficulty <= 4) return 'bg-red-600/30 text-red-300';
    return 'bg-purple-600/30 text-purple-300';
  }
  switch ((difficulty as string)?.toLowerCase()) {
    case 'easy':    return 'bg-green-600/30 text-green-300';
    case 'medium':  return 'bg-yellow-600/30 text-yellow-300';
    case 'hard':    return 'bg-orange-600/30 text-orange-300';
    case 'extreme': return 'bg-red-600/30 text-red-300';
    default:        return 'bg-[#21262d] text-space-text-dim';
  }
}

export function diffLevel(d: string | number | undefined): number {
  if (typeof d === 'number') return d;
  switch ((d as string)?.toLowerCase()) {
    case 'easy':      return 1;
    case 'medium':    return 2;
    case 'hard':      return 3;
    case 'very hard': return 4;
    case 'extreme':   return 5;
    default:          return 0;
  }
}

// ── Objective helpers ─────────────────────────────────────────

export function objProg(obj: any): { current: number; required: number; pct: number } {
  const current = typeof obj.current === 'number' ? obj.current : 0;
  const required = obj.required ?? obj.quantity ?? obj.target_amount ?? 0;
  const pct = required > 0 ? Math.min(100, Math.round((current / required) * 100)) : (obj.complete ? 100 : 0);
  return { current, required, pct };
}

export function fmtObj(obj: any): string {
  const type   = obj.type   || '';
  const target = obj.targetName || obj.target || '';
  const qty    = obj.quantity ?? obj.required ?? obj.target_amount ?? '';
  if (type && target) return `${type}: ${qty ? qty + '× ' : ''}${target}`;
  if (target)         return `${qty ? qty + '× ' : ''}${target}`;
  return '';
}

export function getProgress(m: any): number {
  const objs: any[] = m.objectives || [];
  if (objs.length === 0) return m.is_complete ? 100 : 0;
  const total = objs.reduce((sum: number, obj: any) => {
    const req = obj.required ?? obj.quantity ?? obj.target_amount ?? 1;
    const cur = typeof obj.current === 'number' ? obj.current : (obj.complete ? req : 0);
    return sum + Math.min(1, cur / (req || 1));
  }, 0);
  return Math.round((total / objs.length) * 100);
}

// ── Formatting ────────────────────────────────────────────────

export function fmt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n || 0));
}

export function timeAgo(isoStr: string): string {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 0 || diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function fmtSecs(s: number): string {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Composable ────────────────────────────────────────────────

export function useMissions(
  activeMissions: Ref<any[]>,
  typeFilter: Ref<string>,
  diffFilter: Ref<string>,
) {
  const botStore = useBotStore();

  function matchesFilter(m: any): boolean {
    if (typeFilter.value !== 'all' && (m.type || '').toLowerCase() !== typeFilter.value.toLowerCase()) return false;
    if (diffFilter.value !== 'all') {
      const target = parseInt(diffFilter.value, 10);
      const lvl = diffLevel(m.difficulty);
      if (lvl !== target) return false;
    }
    return true;
  }

  const filteredActive = computed(() => activeMissions.value.filter(matchesFilter));

  const availableMissions = computed(() => {
    const missions: any[] = [];
    const seen = new Set<string>();
    for (const [sysId, sys] of Object.entries(botStore.mapData)) {
      const sysName = (sys as any).name || sysId;
      for (const poi of ((sys as any).pois || [])) {
        if (!poi.missions?.length) continue;
        for (const m of poi.missions) {
          if (!seen.has(m.mission_id)) {
            seen.add(m.mission_id);
            missions.push({ ...m, _sysName: sysName, _stationName: poi.name || poi.id, _stationId: poi.id });
          }
        }
      }
    }
    return missions.sort((a, b) => ((b.rewards?.credits ?? b.reward_credits) || 0) - ((a.rewards?.credits ?? a.reward_credits) || 0));
  });

  const allTypes = computed(() => {
    const types = new Set<string>();
    for (const m of activeMissions.value)    if (m.type) types.add(m.type.toLowerCase());
    for (const m of availableMissions.value) if (m.type) types.add(m.type.toLowerCase());
    return [...types].sort();
  });

  const groupedAvailable = computed((): [string, [string, any[]][]][] => {
    const bySystem = new Map<string, Map<string, any[]>>();
    for (const m of availableMissions.value) {
      if (!matchesFilter(m)) continue;
      const sys = m._sysName;
      const sta = m._stationName;
      if (!bySystem.has(sys)) bySystem.set(sys, new Map());
      const byStation = bySystem.get(sys)!;
      if (!byStation.has(sta)) byStation.set(sta, []);
      byStation.get(sta)!.push(m);
    }
    return [...bySystem.entries()].map(([sys, stations]) => [sys, [...stations.entries()]]);
  });

  const filteredAvailableCount = computed(() =>
    groupedAvailable.value.reduce((n, [, stations]) =>
      n + stations.reduce((sn, [, ms]) => sn + ms.length, 0), 0)
  );

  return {
    filteredActive,
    availableMissions,
    allTypes,
    groupedAvailable,
    filteredAvailableCount,
    matchesFilter,
  };
}
