<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Status bar -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">⚔️ Combat</h3>
        <div class="flex gap-2">
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

    <!-- Combat stance controls -->
    <div class="card py-2 px-3">
      <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">Stance</h4>
      <div class="flex gap-2 flex-wrap">
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
const currentStance = ref<'fire' | 'brace' | 'flee'>('fire');

const currentBot = computed(() => botStore.bots.find(b => b.username === props.bot.username) || props.bot);
const hullPct = computed(() => currentBot.value.maxHull > 0 ? Math.round((currentBot.value.hull / currentBot.value.maxHull) * 100) : 0);
const shieldPct = computed(() => currentBot.value.maxShield > 0 ? Math.round((currentBot.value.shield / currentBot.value.maxShield) * 100) : 0);

const weaponMods = computed(() => {
  const inv = (currentBot.value as any).modules || [];
  return inv.filter((m: any) => m.ammo_type || m.slot_type === 'weapon' || (m.damage != null && m.damage > 0));
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

async function setStance(stance: 'fire' | 'brace' | 'flee') {
  const r = await execCmd('stance', { stance });
  if (r.ok) {
    currentStance.value = stance;
    emit('notif', `Stance set to ${stance}`, 'success');
  } else {
    emit('notif', r.error || `Failed to set stance`, 'error');
  }
}

async function doAdvance() {
  const r = await execCmd('advance');
  emit('notif', r.ok ? 'Advanced one zone' : (r.error || 'Failed to advance'), r.ok ? 'success' : 'error');
}

async function doRetreat() {
  const r = await execCmd('retreat');
  emit('notif', r.ok ? 'Retreating from battle' : (r.error || 'Failed to retreat'), r.ok ? 'warn' : 'error');
}

function formatKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
</script>
