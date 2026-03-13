<template>
  <div class="flex flex-col h-full overflow-hidden p-3 gap-3">

    <!-- Header row -->
    <div class="flex items-center justify-between shrink-0">
      <h2 class="text-sm font-semibold text-space-text-bright">⚔️ Fleet Coordination</h2>
      <button @click="botStore.fetchFleet()" :disabled="botStore.fleetLoading" class="btn text-xs px-2 py-1">
        {{ botStore.fleetLoading ? 'Loading…' : '↺ Refresh' }}
      </button>
    </div>

    <div class="flex gap-3 flex-1 overflow-hidden">

      <!-- Left: Groups + Assignments -->
      <div class="flex flex-col gap-3 w-80 shrink-0 overflow-y-auto">

        <!-- Groups card -->
        <div class="card px-3 py-2">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold uppercase text-space-text-dim">Fleet Groups</h3>
            <button @click="openGroupModal()" class="btn text-xs px-2 py-0.5">+ New</button>
          </div>

          <div v-if="!botStore.fleetGroups.length" class="text-xs text-space-text-dim italic py-2 text-center">No groups defined yet.</div>

          <div v-for="g in botStore.fleetGroups" :key="g.id"
            class="rounded mb-1 border transition-colors"
            :class="selectedGroupId === g.id ? 'border-space-accent/40 bg-space-accent/10' : 'border-space-border/30 bg-deep-bg'"
          >
            <!-- Group header row -->
            <div class="flex items-center justify-between py-1.5 px-2 cursor-pointer" @click="selectedGroupId = g.id">
              <div>
                <div class="text-xs font-medium text-space-text-bright flex items-center gap-2">
                  {{ g.name }}
                  <span class="text-[10px] font-normal" :class="groupRunningCount(g.id) > 0 ? 'text-green-400' : 'text-space-text-dim'">
                    {{ groupRunningCount(g.id) }}/{{ groupMemberCount(g.id) }} running
                  </span>
                </div>
                <div class="text-[11px] text-space-text-dim">{{ objectiveLabel(g.objective) }}<span v-if="g.targetPoi"> · {{ g.targetPoi }}</span></div>
              </div>
              <div class="flex gap-1 items-center">
                <button @click.stop="openGroupModal(g)" class="text-[11px] text-space-text-dim hover:text-space-accent px-1" title="Edit">✏️</button>
                <button @click.stop="confirmDeleteGroup(g.id)" class="text-[11px] text-space-text-dim hover:text-space-red px-1" title="Delete">🗑</button>
              </div>
            </div>
            <!-- Group order buttons -->
            <div class="flex gap-1 px-2 pb-1.5">
              <button @click.stop="startGroup(g.id)" class="btn text-[11px] px-2 py-0.5 text-green-400 border-green-700/50 hover:bg-green-900/20" title="Start all bots in group">▶ Start All</button>
              <button @click.stop="stopGroup(g.id)" class="btn text-[11px] px-2 py-0.5 text-red-400 border-red-700/50 hover:bg-red-900/20" title="Stop all bots in group">⏹ Stop All</button>
            </div>
          </div>
        </div>

        <!-- Assignments card (for selected group) -->
        <div class="card px-3 py-2" v-if="selectedGroupId">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold uppercase text-space-text-dim">
              Assignments — {{ botStore.fleetGroups.find(g => g.id === selectedGroupId)?.name }}
            </h3>
          </div>

          <!-- Assign bot row -->
          <div class="flex gap-1 mb-3">
            <select v-model="assignBot" class="input text-xs py-0.5 px-1 flex-1">
              <option value="">Select bot…</option>
              <option v-for="b in botStore.bots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
            <select v-model="assignRole" class="input text-xs py-0.5 px-1 w-28">
              <option v-for="r in ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
            </select>
            <button @click="doAssign" :disabled="!assignBot" class="btn text-xs px-2 py-0.5">Assign</button>
          </div>

          <!-- Current assignments for this group -->
          <div v-if="!groupMembers.length" class="text-xs text-space-text-dim italic">No members assigned.</div>
          <div v-for="[username, asgn] in groupMembers" :key="username"
            class="flex items-center justify-between py-1 px-2 rounded mb-1 bg-deep-bg text-xs"
          >
            <div class="flex items-center gap-2">
              <span :class="roleColor(asgn.role)">{{ roleIcon(asgn.role) }}</span>
              <span class="text-space-text-bright font-medium">{{ username }}</span>
              <span class="text-space-text-dim">{{ roleName(asgn.role) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span :class="statusDot(botStatusFor(username)?.state)" class="text-[10px]">●</span>
              <template v-if="botStatusFor(username)?.state !== 'running' && botStatusFor(username)?.state !== 'stopping'">
                <button @click="startBotRole(username, asgn.role)" class="text-[11px] px-1.5 py-0.5 rounded border border-green-700/50 text-green-400 hover:bg-green-900/20">▶</button>
              </template>
              <template v-else-if="botStatusFor(username)?.state === 'running'">
                <button @click="botStore.stopBot(username)" class="text-[11px] px-1.5 py-0.5 rounded border border-red-700/50 text-red-400 hover:bg-red-900/20">⏹</button>
              </template>
              <button @click="botStore.issueFleetOrder(username, 'dock')" class="text-[11px] px-1.5 py-0.5 rounded border border-space-border/40 text-space-text-dim hover:text-blue-400 hover:border-blue-700/50" title="Order: Dock now">🛥</button>
              <button @click="botStore.issueFleetOrder(username, 'return_home')" class="text-[11px] px-1.5 py-0.5 rounded border border-space-border/40 text-space-text-dim hover:text-yellow-400 hover:border-yellow-700/50" title="Order: Return to station">🏠</button>
              <button @click="botStore.removeFleetAssignment(username)" class="text-space-text-dim hover:text-space-red px-1">✕</button>
            </div>
          </div>
          <!-- Goto order row -->
          <div class="border-t border-space-border/30 mt-2 pt-2">
            <div class="text-[11px] text-space-text-dim mb-1">Send Goto Order</div>
            <div class="flex gap-1 items-center">
              <select v-model="gotoUsername" class="input text-xs py-0.5 px-1 flex-1">
                <option value="">All in group…</option>
                <option v-for="[un] in groupMembers" :key="un" :value="un">{{ un }}</option>
              </select>
              <input v-model="gotoSystem" class="input text-xs py-0.5 px-1 flex-1" placeholder="system_id" @keyup.enter="sendGotoOrder" />
              <button @click="sendGotoOrder" :disabled="!gotoSystem.trim()" class="btn text-[11px] px-2 py-0.5 text-sky-400 border-sky-700/50 hover:bg-sky-900/20">📍 Goto</button>
            </div>
          </div>
        </div>

      </div>

      <!-- Right: Member Status Table -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="card px-3 py-2 flex flex-col overflow-hidden h-full">
          <h3 class="text-xs font-semibold uppercase text-space-text-dim mb-2 shrink-0">All Fleet Members</h3>

          <div v-if="!allAssigned.length" class="text-xs text-space-text-dim italic py-4 text-center">No bots assigned to any fleet group yet.</div>

          <div v-else class="overflow-y-auto flex-1">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-space-card">
                <tr class="text-left text-[11px] text-space-text-dim border-b border-space-border">
                  <th class="pb-1.5 pr-2">Bot</th>
                  <th class="pb-1.5 pr-2">Role</th>
                  <th class="pb-1.5 pr-2">Group</th>
                  <th class="pb-1.5 pr-2">State</th>
                  <th class="pb-1.5 pr-2">Location</th>
                  <th class="pb-1.5 pr-2">Cargo</th>
                  <th class="pb-1.5 pr-2">Fuel</th>
                  <th class="pb-1.5">Signal</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in allAssigned" :key="row.username"
                  class="border-b border-space-border/30 hover:bg-space-row-hover transition-colors"
                >
                  <td class="py-1.5 pr-2 font-medium text-space-text-bright">{{ row.username }}</td>
                  <td class="py-1.5 pr-2">
                    <span :class="roleColor(row.role)" class="flex items-center gap-1">
                      {{ roleIcon(row.role) }} {{ roleName(row.role) }}
                    </span>
                  </td>
                  <td class="py-1.5 pr-2 text-space-text-dim">{{ row.groupName }}</td>
                  <td class="py-1.5 pr-2">
                    <span v-if="row.bot" :class="stateClass(row.bot.state)" class="px-1.5 py-0.5 rounded text-[10px] font-medium">{{ row.bot.state }}</span>
                    <span v-else class="text-space-text-dim">offline</span>
                  </td>
                  <td class="py-1.5 pr-2 text-space-text-dim max-w-[140px] truncate" :title="resolveLocation(row.bot)">{{ resolveLocation(row.bot) }}</td>
                  <td class="py-1.5 pr-2">
                    <span v-if="row.bot">
                      <span :class="cargoClass(row.bot)">{{ row.bot.cargo ?? 0 }}/{{ row.bot.cargoMax ?? '?' }}</span>
                    </span>
                    <span v-else class="text-space-text-dim">—</span>
                  </td>
                  <td class="py-1.5 pr-2">
                    <span v-if="row.bot" :class="fuelClass(row.bot)">{{ row.bot.fuel ?? 0 }}%</span>
                    <span v-else class="text-space-text-dim">—</span>
                  </td>
                  <td class="py-1.5">
                    <span v-if="row.signal" class="text-[10px] flex flex-wrap gap-x-1 items-center">
                      <span v-if="row.signal.cargoPct != null" class="text-space-text-dim">{{ Math.round(row.signal.cargoPct) }}% cargo</span>
                      <span v-if="row.signal.cargoFull" class="text-space-yellow">FULL</span>
                      <span v-if="row.signal.fuelPct != null" :class="row.signal.needsFuel ? 'text-red-400 font-semibold' : 'text-space-text-dim'">⛽{{ row.signal.fuelPct }}%</span>
                      <span v-if="row.signal.order" class="text-yellow-400 font-semibold">📋{{ row.signal.order.cmd }}</span>
                      <span class="opacity-40">{{ signalAge(row.signal.lastUpdated) }}</span>
                    </span>
                    <span v-else class="text-space-text-dim text-[10px]">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Group modal -->
    <div v-if="groupModal.open" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="groupModal.open = false">
      <div class="card w-96 p-4 space-y-3">
        <h3 class="text-sm font-semibold text-space-text-bright">{{ groupModal.id ? 'Edit Group' : 'New Fleet Group' }}</h3>
        <div class="space-y-2">
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Name</label>
            <input v-model="groupModal.name" class="input w-full text-xs py-1 px-2" placeholder="Mining Alpha" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Objective</label>
            <select v-model="groupModal.objective" class="input w-full text-xs py-1 px-2">
              <option value="mine">Mine — miners + hauler</option>
              <option value="hybrid">Hybrid — mine + trade</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Target POI (optional)</label>
            <input v-model="groupModal.targetPoi" class="input w-full text-xs py-1 px-2" placeholder="asteroid_belt_alpha" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Deposit POI (optional)</label>
            <input v-model="groupModal.depositPoi" class="input w-full text-xs py-1 px-2" placeholder="station_prime" />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button @click="groupModal.open = false" class="btn text-xs px-3 py-1">Cancel</button>
          <button @click="saveGroup" :disabled="!groupModal.name.trim()" class="btn btn-primary text-xs px-3 py-1">Save</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useBotStore, type FleetGroup, type FleetAssignment } from '../stores/botStore';

const botStore = useBotStore();

onMounted(() => botStore.fetchFleet());

// ── Role → Routine mapping ────────────────────────────────
const ROLE_ROUTINE: Record<string, string> = {
  miner:    'fleet_miner',
  hauler:   'fleet_hauler',
  scout:    'fleet_scout',
  combat:   'fleet_combat',
  refueler: 'fleet_refueler',
};

function startBotRole(username: string, role: string) {
  const routine = ROLE_ROUTINE[role] ?? 'fleet_miner';
  botStore.startBot(username, routine);
}

function startGroup(groupId: string) {
  for (const [username, asgn] of Object.entries(botStore.fleetAssignments)) {
    if (asgn.groupId !== groupId) continue;
    const bot = botStore.bots.find(b => b.username === username);
    if (bot && bot.state !== 'running' && bot.state !== 'stopping') {
      startBotRole(username, asgn.role);
    }
  }
}

function stopGroup(groupId: string) {
  for (const [username, asgn] of Object.entries(botStore.fleetAssignments)) {
    if (asgn.groupId !== groupId) continue;
    const bot = botStore.bots.find(b => b.username === username);
    if (bot && bot.state === 'running') botStore.stopBot(username);
  }
}

function groupMemberCount(groupId: string) {
  return Object.values(botStore.fleetAssignments).filter(a => a.groupId === groupId).length;
}

function groupRunningCount(groupId: string) {
  return Object.entries(botStore.fleetAssignments)
    .filter(([, a]) => a.groupId === groupId)
    .filter(([u]) => botStore.bots.find(b => b.username === u)?.state === 'running')
    .length;
}

// ── Roles ──────────────────────────────────────────────────
const ROLES: { id: FleetAssignment['role']; label: string }[] = [
  { id: 'miner',    label: '⛏ Miner' },
  { id: 'hauler',   label: '📦 Hauler' },
  { id: 'scout',    label: '🔭 Scout' },
  { id: 'combat',   label: '⚔️ Combat' },
  { id: 'refueler', label: '⛽ Refueler' },
];

function roleName(r: string)  { return ROLES.find(x => x.id === r)?.label.split(' ').slice(1).join(' ') ?? r; }
function roleIcon(r: string)  { return ROLES.find(x => x.id === r)?.label.split(' ')[0] ?? '❓'; }
function roleColor(r: string) {
  const m: Record<string, string> = {
    miner: 'text-amber-400', hauler: 'text-blue-400', scout: 'text-cyan-400',
    combat: 'text-red-400', refueler: 'text-green-400',
  };
  return m[r] ?? 'text-space-text-dim';
}
function objectiveLabel(o: string) {
  return o === 'mine' ? 'Mining' : o === 'hybrid' ? 'Hybrid' : 'Custom';
}

// ── Selected group + assignment UI ─────────────────────────────
const selectedGroupId = ref<string>('');
const assignBot  = ref('');
const assignRole = ref<FleetAssignment['role']>('miner');
const gotoUsername = ref('');
const gotoSystem   = ref('');

async function sendGotoOrder() {
  const sys = gotoSystem.value.trim();
  if (!sys) return;
  if (gotoUsername.value) {
    await botStore.issueFleetOrder(gotoUsername.value, 'goto', sys);
  } else {
    for (const [un] of groupMembers.value) {
      await botStore.issueFleetOrder(un, 'goto', sys);
    }
  }
  gotoSystem.value = '';
  gotoUsername.value = '';
}

const groupMembers = computed(() => {
  if (!selectedGroupId.value) return [];
  return Object.entries(botStore.fleetAssignments).filter(([, a]) => a.groupId === selectedGroupId.value);
});

function doAssign() {
  if (!assignBot.value || !selectedGroupId.value) return;
  botStore.setFleetAssignment(assignBot.value, selectedGroupId.value, assignRole.value);
  assignBot.value = '';
}

// ── All assigned members table ──────────────────────────────
const allAssigned = computed(() => {
  return Object.entries(botStore.fleetAssignments).map(([username, asgn]) => {
    const group = botStore.fleetGroups.find(g => g.id === asgn.groupId);
    const bot = botStore.bots.find(b => b.username === username);
    const signal = botStore.fleetSignals[username];
    return { username, role: asgn.role, groupName: group?.name ?? asgn.groupId, bot, signal };
  }).sort((a, b) => a.groupName.localeCompare(b.groupName) || a.role.localeCompare(b.role));
});

function botStatusFor(username: string) {
  return botStore.bots.find(b => b.username === username);
}

function resolveLocation(bot: any): string {
  if (!bot) return '—';
  const sys = botStore.mapData[bot.system] as any;
  const sysName = sys?.name || bot.system || '—';
  if (bot.poi) {
    const poi = sys?.pois?.find((p: any) => p.id === bot.poi);
    return poi ? `${poi.name}, ${sysName}` : `${bot.poi}, ${sysName}`;
  }
  return sysName;
}

function stateClass(state: string) {
  const m: Record<string, string> = {
    running: 'bg-green-900/40 text-green-400',
    stopping: 'bg-yellow-900/40 text-yellow-400',
    idle: 'bg-gray-800 text-space-text-dim',
    stopped: 'bg-gray-800 text-space-text-dim',
    error: 'bg-red-900/40 text-red-400',
  };
  return m[state] ?? 'bg-gray-800 text-space-text-dim';
}

function statusDot(state?: string) {
  if (state === 'running') return 'text-green-400';
  if (state === 'error')   return 'text-red-400';
  return 'text-space-text-dim';
}

function cargoClass(bot: any) {
  const pct = bot.cargoMax > 0 ? (bot.cargo / bot.cargoMax) * 100 : 0;
  if (pct >= 90) return 'text-space-red';
  if (pct >= 70) return 'text-space-yellow';
  return 'text-space-text';
}

function fuelClass(bot: any) {
  const pct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : 100;
  if (pct <= 20) return 'text-space-red';
  if (pct <= 40) return 'text-space-yellow';
  return 'text-space-cyan';
}

function signalAge(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Group modal ─────────────────────────────────────────────
const groupModal = ref({ open: false, id: '', name: '', objective: 'mine' as FleetGroup['objective'], targetPoi: '', depositPoi: '' });

function openGroupModal(g?: FleetGroup) {
  groupModal.value = {
    open: true,
    id: g?.id ?? '',
    name: g?.name ?? '',
    objective: g?.objective ?? 'mine',
    targetPoi: g?.targetPoi ?? '',
    depositPoi: g?.depositPoi ?? '',
  };
}

async function saveGroup() {
  const { id, name, objective, targetPoi, depositPoi } = groupModal.value;
  if (!name.trim()) return;
  await botStore.saveFleetGroup({
    ...(id ? { id } : {}),
    name: name.trim(),
    objective,
    ...(targetPoi.trim() ? { targetPoi: targetPoi.trim() } : {}),
    ...(depositPoi.trim() ? { depositPoi: depositPoi.trim() } : {}),
  });
  groupModal.value.open = false;
}

function confirmDeleteGroup(id: string) {
  if (confirm('Delete this group and all its assignments?')) {
    botStore.deleteFleetGroup(id);
    if (selectedGroupId.value === id) selectedGroupId.value = '';
  }
}
</script>
