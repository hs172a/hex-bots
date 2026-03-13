<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Active Battle Alert (v0.215: populated from get_system response) -->
    <div v-if="activeBattle" class="card py-2 px-3 border-red-700/50 bg-red-950/20">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold text-red-400 uppercase">⚔️ Active Battle in System</span>
        <button @click="loadBattleStatus" class="btn text-[11px] px-2 py-0.5 border-red-700/40 text-red-300 hover:bg-red-900/40">Status</button>
      </div>
      <div class="text-[11px] text-space-text-dim space-y-0.5">
        <div v-if="activeBattle.battle_id" class="font-mono text-[10px] opacity-60">ID: {{ activeBattle.battle_id }}</div>
        <div v-if="activeBattle.participants?.length" class="flex flex-wrap gap-1">
          <span v-for="p in activeBattle.participants" :key="p.id || p.name"
            class="px-1.5 py-0 rounded text-[10px]"
            :class="p.faction ? 'bg-[#21262d] text-space-text' : 'bg-red-900/40 text-red-300'"
          >{{ p.name || p.username || p.id }}{{ p.ship_class ? ` (${p.ship_class})` : '' }}</span>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">⚔️ Combat</h3>
        <div class="flex gap-2">
          <button @click="loadBattleStatus" :disabled="battleLoading" class="btn btn-secondary text-xs px-3">{{ battleLoading ? '⏳' : '⚔️ Battle Status' }}</button>
          <button @click="scanNearby" :disabled="loading" class="btn btn-secondary text-xs px-3">{{ loading ? '⏳' : '🔄 Scan Nearby' }}</button>
        </div>
      </div>

      <!-- Hull / Shield bars -->
      <div class="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div class="flex justify-between mb-1">
            <span class="text-space-text-dim">❤️ Hull</span>
            <span :class="hullPct <= 30 ? 'text-space-red font-bold' : hullPct <= 60 ? 'text-orange-400' : 'text-space-green'">
              {{ currentBot.hull }} / {{ currentBot.maxHull }} ({{ hullPct }}%)
            </span>
          </div>
          <div class="h-2 bg-[#21262d] rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all"
              :class="hullPct <= 30 ? 'bg-space-red' : hullPct <= 60 ? 'bg-orange-400' : 'bg-space-green'"
              :style="{ width: hullPct + '%' }"></div>
          </div>
        </div>
        <div>
          <div class="flex justify-between mb-1">
            <span class="text-space-text-dim">🛡️ Shield</span>
            <span :class="shieldPct <= 15 ? 'text-space-red font-bold' : 'text-space-cyan'">
              {{ currentBot.shield }} / {{ currentBot.maxShield }} ({{ shieldPct }}%)
            </span>
          </div>
          <div class="h-2 bg-[#21262d] rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all"
              :class="shieldPct <= 15 ? 'bg-space-red' : 'bg-space-cyan'"
              :style="{ width: shieldPct + '%' }"></div>
          </div>
        </div>
      </div>

      <!-- Ammo -->
      <div class="flex items-center gap-3 mt-2 text-xs">
        <span class="text-space-text-dim">🔫 Ammo in cargo:</span>
        <span :class="(currentBot.ammo || 0) === 0 ? 'text-space-red font-bold' : 'text-space-text'">
          {{ currentBot.ammo || 0 }}
        </span>
        <span v-if="weaponMods.length > 0" class="text-space-text-dim ml-2">|</span>
        <span v-for="wep in weaponMods" :key="wep.id" class="text-space-text-dim">
          {{ wep.name || 'Weapon' }}:
          <span :class="(wep.current_ammo ?? 0) === 0 ? 'text-space-red' : 'text-space-text'">
            {{ wep.current_ammo ?? 0 }}/{{ wep.magazine_size ?? '?' }}
          </span>
        </span>
      </div>
    </div>

    <!-- Battle Status -->
    <div v-if="battleStatus" class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-space-text-dim uppercase">⚔️ Battle Status</h4>
        <button @click="battleStatus = null" class="text-space-text-dim hover:text-space-text-bright text-sm leading-none">×</button>
      </div>
      <!-- Summary row -->
      <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] mb-2">
        <span class="text-space-text-dim">Zone: <span class="text-space-text-bright font-mono">{{ battleStatus.current_zone ?? battleStatus.zone ?? '—' }}</span></span>
        <span class="text-space-text-dim">Round: <span class="text-space-text-bright font-mono">{{ battleStatus.round ?? battleStatus.tick ?? '—' }}</span></span>
        <span v-if="battleStatus.battle_id" class="text-space-text-dim">ID: <span class="text-space-text-bright font-mono text-[10px]">{{ battleStatus.battle_id }}</span></span>
        <span v-if="battleStatus.status" class="text-space-text-dim">Status: <span class="font-medium" :class="battleStatus.status === 'active' ? 'text-space-green' : 'text-space-yellow'">{{ battleStatus.status }}</span></span>
      </div>
      <!-- My stats -->
      <div v-if="battleStatus.player_stats || battleStatus.your_stats" class="mb-2 p-2 rounded bg-[#161b22] border border-space-border text-[11px] space-y-0.5">
        <div class="font-semibold text-space-text-dim uppercase text-[10px] mb-1">Your Stats</div>
        <div v-for="[k, v] in Object.entries(battleStatus.player_stats ?? battleStatus.your_stats ?? {})" :key="k" class="flex justify-between">
          <span class="text-space-text-dim">{{ formatKey(k) }}</span>
          <span class="text-space-text-bright font-mono">{{ v }}</span>
        </div>
      </div>
      <!-- Sides -->
      <div v-if="battleSides.length" class="space-y-2">
        <div v-for="(side, si) in battleSides" :key="si"
          class="p-2 rounded border text-[11px] space-y-1"
          :class="si === 0 ? 'border-space-green/30 bg-space-green/5' : 'border-space-red/30 bg-space-red/5'">
          <div class="font-semibold text-[10px] uppercase tracking-wider"
            :class="si === 0 ? 'text-space-green' : 'text-space-red'">{{ side.name || (si === 0 ? 'Allies' : 'Enemies') }}</div>
          <div v-for="p in (side.participants || side.members || [])" :key="p.id || p.name"
            class="flex items-center gap-1.5">
            <span class="text-space-text">{{ p.name || p.username || p.id }}</span>
            <span v-if="p.hull != null" class="text-space-text-dim">❤️{{ p.hull }}</span>
            <span v-if="p.shield != null" class="text-space-text-dim">🛡️{{ p.shield }}</span>
            <span v-if="p.zone != null" class="text-space-text-dim">Z{{ p.zone }}</span>
            <span v-if="p.stance" class="text-[10px] px-1 rounded bg-[#21262d] text-space-text-dim">{{ p.stance }}</span>
          </div>
        </div>
      </div>
      <!-- Zones -->
      <div v-if="battleZones.length" class="mt-2">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-space-text-dim mb-1">Zones</div>
        <div class="flex gap-1 flex-wrap">
          <div v-for="z in battleZones" :key="z.id ?? z.zone"
            class="px-2 py-1 rounded text-[11px] bg-[#21262d] border border-space-border">
            <span class="font-mono text-space-text-bright">Z{{ z.id ?? z.zone }}</span>
            <span v-if="z.name" class="text-space-text-dim ml-1">{{ z.name }}</span>
            <span v-if="z.occupants" class="text-space-text-dim ml-1">({{ z.occupants }} here)</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Combat stance controls -->
    <div class="card py-2 px-3">
      <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Stance</h4>
      <div class="flex gap-2 flex-wrap">
        <button @click="setStance('evade')" 
          class="btn text-xs px-3 py-1.5 transition-colors"
          :class="currentStance === 'evade' ? 'bg-cyan-700/60 text-cyan-200 border-cyan-600/50' : 'btn-secondary'"
          title="Evade: no damage dealt, 50% damage taken, costs fuel">🌀 Evade</button>
        <button @click="setStance('fire')"
          class="btn text-xs px-3 py-1.5 transition-colors"
          :class="currentStance === 'fire' ? 'bg-red-700/60 text-red-200 border-red-600/50' : 'btn-secondary'"
          title="Fire: full damage, full exposure">🔥 Fire</button>
        <button @click="setStance('brace')"
          class="btn text-xs px-3 py-1.5 transition-colors"
          :class="currentStance === 'brace' ? 'bg-blue-700/60 text-blue-200 border-blue-600/50' : 'btn-secondary'"
          title="Brace: no damage, shields regen 2×">🛡️ Brace</button>
        <button @click="setStance('flee')"
          class="btn text-xs px-3 py-1.5 transition-colors"
          :class="currentStance === 'flee' ? 'bg-yellow-700/60 text-yellow-200 border-yellow-600/50' : 'btn-secondary'"
          title="Flee: auto-retreat">💨 Flee</button>
        <button @click="doAdvance" class="btn btn-secondary text-xs px-3 py-1.5" title="Advance one combat zone">⬆️ Advance</button>
        <button @click="doRetreat" class="btn text-xs px-3 py-1.5 bg-orange-900/40 text-orange-300 border-orange-700/40 hover:bg-orange-900/70" title="Retreat from battle">↩️ Retreat</button>
        <button @click="doEngage" class="btn btn-secondary text-xs px-3 py-1.5" title="Join an existing battle in this system">⚔️ Engage</button>
      </div>
    </div>

    <!-- Reload Weapon -->
    <div class="card py-2 px-3">
      <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">🔄 Reload Weapon</h4>
      <div class="flex gap-2 items-center">
        <select v-model="reloadWeapon" class="input text-xs flex-1 !p-1">
          <option value="">{{ weaponMods.length > 0 ? 'Select weapon...' : 'No weapons' }}</option>
          <option v-for="wep in weaponMods" :key="wep.module_id || wep.id" :value="wep.module_id || wep.id">
            {{ wep.name || wep.type_id || 'Weapon' }} ({{ wep.current_ammo ?? 0 }}/{{ wep.magazine_size ?? '?' }})
          </option>
        </select>
        <select v-model="reloadAmmo" class="input text-xs w-40 !p-1">
          <option value="">{{ ammoItems.length > 0 ? 'Select ammo...' : 'No ammo' }}</option>
          <option v-for="ammo in ammoItems" :key="ammo.itemId" :value="ammo.itemId">
            {{ ammo.name }} ({{ ammo.quantity }})
          </option>
        </select>
        <button @click="execReload" :disabled="!reloadWeapon || !reloadAmmo" class="btn text-xs px-3 py-1 disabled:opacity-50">🔄 Reload</button>
      </div>
    </div>

    <!-- Nearby entities -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-space-text-dim uppercase">Nearby Entities</h4>
        <span v-if="nearby.length > 0" class="text-[11px] text-space-text-dim">{{ nearby.length }} detected</span>
      </div>

      <div v-if="nearby.length === 0" class="text-xs text-space-text-dim italic text-center py-4">
        No entities nearby. Click "Scan Nearby" to refresh.
      </div>
      <div v-else class="space-y-1.5">
        <div v-for="entity in nearby" :key="entity.id"
          class="flex items-center justify-between px-2 py-2 rounded border transition-colors"
          :class="entity.isPirate || entity.isHostile ? 'border-red-700/40 bg-red-900/10' : 'border-space-border bg-[#161b22]'">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-medium" :class="entity.isPirate || entity.isHostile ? 'text-red-300' : 'text-space-text-bright'">
                {{ entity.isPirate || entity.isHostile ? '☠️ ' : '👤 ' }}{{ entity.name }}
              </span>
              <span v-if="entity.faction" class="text-[11px] text-space-text-dim">[{{ entity.faction }}]</span>
              <span v-if="entity.isNPC" class="px-1 py-0.5 text-[10px] rounded bg-[#21262d] text-space-text-dim">NPC</span>
            </div>
            <div v-if="entity.hull || entity.ship_type" class="text-[11px] text-space-text-dim mt-0.5">
              <span v-if="entity.ship_type">{{ entity.ship_type }}</span>
              <span v-if="entity.hull"> · Hull {{ entity.hull }}</span>
            </div>
          </div>
          <div class="flex gap-1 shrink-0 ml-2">
            <button @click="doScan(entity)" :disabled="scanningId === entity.id"
              class="btn btn-secondary text-[11px] px-2 py-0.5">
              {{ scanningId === entity.id ? '⏳' : '🔍' }}
            </button>
            <button @click="doAttack(entity)" :disabled="attackingId === entity.id"
              class="btn text-[11px] px-2 py-0.5 bg-red-900/50 text-red-300 hover:bg-red-800/70 border-red-700/40">
              {{ attackingId === entity.id ? '⏳' : '⚔️ Attack' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Scan result detail -->
    <div v-if="scanResult" class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-semibold text-space-text-dim uppercase">🔍 Scan Result</h4>
        <button @click="scanResult = null" class="text-space-text-dim hover:text-space-text-bright text-sm">×</button>
      </div>
      <div class="space-y-1 text-xs">
        <div v-for="[key, val] in Object.entries(scanResult)" :key="key" class="flex justify-between">
          <span class="text-space-text-dim">{{ formatKey(key) }}</span>
          <span class="text-space-text-bright font-mono">{{ val }}</span>
        </div>
      </div>
    </div>

    <!-- Combat log (filtered from bot logs) -->
    <div class="card py-2 px-3">
      <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">📋 Combat Log</h4>
      <div class="font-mono text-[11px] leading-relaxed max-h-48 overflow-auto scrollbar-dark space-y-px">
        <div v-if="combatLogs.length === 0" class="text-space-text-dim italic">No combat activity logged.</div>
        <div v-for="(line, i) in combatLogs" :key="i"
          :class="line.includes('critical') || line.includes('flee') || line.includes('dead') ? 'text-space-red' : line.includes('eliminated') || line.includes('killed') ? 'text-space-green' : 'text-space-text-dim'">
          {{ line }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

interface Props { bot: any; }
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();

interface NearbyEntity {
  id: string;
  name: string;
  faction: string;
  isPirate?: boolean;
  isHostile?: boolean;
  isNPC?: boolean;
  hull?: number;
  ship_type?: string;
}

const loading = ref(false);
const nearby = ref<NearbyEntity[]>([]);
const scanningId = ref<string | null>(null);
const attackingId = ref<string | null>(null);
const scanResult = ref<Record<string, unknown> | null>(null);
const currentStance = ref<'fire' | 'evade' | 'brace' | 'flee'>('fire');
const reloadWeapon = ref('');
const reloadAmmo = ref('');
const battleStatus = ref<Record<string, unknown> | null>(null);
const battleLoading = ref(false);

const battleSides = computed(() => {
  if (!battleStatus.value) return [];
  const b = battleStatus.value as any;
  return Array.isArray(b.sides) ? b.sides
    : Array.isArray(b.teams) ? b.teams
    : [];
});

const battleZones = computed(() => {
  if (!battleStatus.value) return [];
  const b = battleStatus.value as any;
  return Array.isArray(b.zones) ? b.zones : [];
});

const currentBot = computed(() => botStore.bots.find(b => b.username === props.bot.username) || props.bot);
const activeBattle = computed(() => (currentBot.value as any).activeBattle ?? null);
const hullPct = computed(() => currentBot.value.maxHull > 0 ? Math.round((currentBot.value.hull / currentBot.value.maxHull) * 100) : 0);
const shieldPct = computed(() => currentBot.value.maxShield > 0 ? Math.round((currentBot.value.shield / currentBot.value.maxShield) * 100) : 0);

const weaponMods = computed(() => {
  const inv = (currentBot.value as any).shipModules || (currentBot.value as any).modules || [];
  return (Array.isArray(inv) ? inv : Object.values(inv as Record<string, unknown>))
    .filter((m: any) => m.ammo_type || m.slot_type === 'weapon' || (m.damage != null && m.damage > 0));
});

const ammoItems = computed(() => {
  const cargo = (currentBot.value as any).inventory || [];
  return cargo.filter((i: any) => (i.itemId || '').includes('ammo') || (i.itemId || '').includes('rounds') || (i.name || '').toLowerCase().includes('ammo'));
});

const combatLogs = computed(() => {
  const buf = botStore.botLogBuffers[props.bot.username] || [];
  return buf.filter(line => /combat|attack|engage|target|eliminated|flee|hull|shield|brace|fire/i.test(line)).slice(-50);
});

function execCmd(command: string, params?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise(resolve => {
    botStore.sendExec(props.bot.username, command, params || {}, (r: any) => resolve(r));
  });
}

async function loadBattleStatus() {
  battleLoading.value = true;
  const r = await execCmd('get_battle_status');
  battleLoading.value = false;
  if (r.ok && r.data) {
    battleStatus.value = r.data as Record<string, unknown>;
  } else {
    emit('notif', r.error || 'No active battle', 'warn');
    battleStatus.value = null;
  }
}

async function scanNearby() {
  loading.value = true;
  const r = await execCmd('get_nearby');
  loading.value = false;
  if (r.ok && r.data) {
    const d = r.data as any;
    const raw: any[] = Array.isArray(d) ? d : (Array.isArray(d.entities) ? d.entities : Array.isArray(d.nearby) ? d.nearby : []);
    const PIRATE_KW = ['pirate', 'raider', 'outlaw', 'bandit', 'corsair', 'marauder', 'hostile'];
    nearby.value = raw.map((e: any) => {
      const faction = (e.faction || '').toLowerCase();
      const name = (e.name || e.username || '').toLowerCase();
      const isPirate = e.is_pirate || e.isPirate || PIRATE_KW.some(kw => faction.includes(kw) || name.includes(kw));
      return {
        id: e.id || e.entity_id || '',
        name: e.name || e.username || e.id || 'Unknown',
        faction: e.faction || '',
        isPirate,
        isHostile: e.is_hostile || e.isHostile || isPirate,
        isNPC: e.is_npc || e.isNPC || !e.player_id,
        hull: e.hull || e.hull_current,
        ship_type: e.ship_type || e.ship,
      };
    });
  } else if (!r.ok) {
    emit('notif', r.error || 'Failed to scan nearby', 'error');
  }
}

async function doScan(entity: NearbyEntity) {
  scanningId.value = entity.id;
  const r = await execCmd('scan', { target_id: entity.id });
  scanningId.value = null;
  if (r.ok && r.data) {
    const d = r.data as any;
    const filtered: Record<string, unknown> = {};
    const SKIP = ['id', 'entity_id'];
    for (const [k, v] of Object.entries(d)) {
      if (!SKIP.includes(k) && v !== null && v !== undefined && v !== '') filtered[k] = v;
    }
    scanResult.value = filtered;
  } else {
    emit('notif', r.error || 'Scan failed', 'error');
  }
}

async function doAttack(entity: NearbyEntity) {
  attackingId.value = entity.id;
  const r = await execCmd('attack', { target_id: entity.id });
  attackingId.value = null;
  if (r.ok) {
    emit('notif', `Attacking ${entity.name}`, 'warn');
  } else {
    emit('notif', r.error || 'Attack failed', 'error');
  }
}

async function doEngage() {
  const r = await execCmd('battle', { action: 'engage' });
  emit('notif', r.ok ? 'Joined battle' : (r.error || 'Failed to join battle'), r.ok ? 'success' : 'error');
}

async function setStance(stance: 'fire' | 'evade' | 'brace' | 'flee') {
  const r = await execCmd('battle', { action: 'stance', id: stance });
  if (r.ok) {
    currentStance.value = stance;
    emit('notif', `Stance set to ${stance}`, 'success');
  } else {
    emit('notif', r.error || `Failed to set stance`, 'error');
  }
}

async function doAdvance() {
  const r = await execCmd('battle', { action: 'advance' });
  emit('notif', r.ok ? 'Advanced one zone' : (r.error || 'Failed to advance'), r.ok ? 'success' : 'error');
}

async function doRetreat() {
  const r = await execCmd('battle', { action: 'retreat' });
  emit('notif', r.ok ? 'Retreating from battle' : (r.error || 'Failed to retreat'), r.ok ? 'warn' : 'error');
}

async function execReload() {
  if (!reloadWeapon.value || !reloadAmmo.value) return;
  const r = await execCmd('reload', { weapon_instance_id: reloadWeapon.value, ammo_item_id: reloadAmmo.value });
  if (r.ok) {
    emit('notif', 'Weapon reloaded successfully', 'success');
    reloadWeapon.value = '';
    reloadAmmo.value = '';
  } else {
    emit('notif', r.error || 'Failed to reload weapon', 'error');
  }
}

function formatKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
</script>
