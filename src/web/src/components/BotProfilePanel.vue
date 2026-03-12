<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Deposit Settings -->
    <div class="card py-2 px-3">
      <h3 class="text-xs font-semibold text-space-text-dim uppercase mb-2">💰 Deposit Settings</h3>
      <div class="space-y-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="text-space-text-dim">Primary</span>
          <select v-model="depositPrimary" class="input text-[11px] flex-1 !p-1">
            <option value="storage">Station Storage</option>
            <option value="faction">Faction Storage</option>
            <option value="sell">Sell</option>
            <option value="gift">Gift</option>
          </select>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-space-text-dim">Fallback</span>
          <select v-model="depositSecondary" class="input text-[11px] flex-1 !p-1">
            <option value="storage">Station Storage</option>
            <option value="faction">Faction Storage</option>
            <option value="sell">Sell</option>
            <option value="gift">Gift</option>
          </select>
        </div>
      </div>
    </div>
    <!-- Load button -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">👤 Player Profile</h3>
        <button @click="loadProfile" :disabled="loading" class="btn btn-secondary text-xs py-0 px-2">{{ loading ? '⏳' : '🔄' }}</button>
      </div>
      <div v-if="loading" class="text-xs text-space-text-dim italic py-2 text-center">Loading...</div>
    </div>

    <template v-if="loaded">
      <!-- Status Message -->
      <div class="card py-2 px-3 space-y-3">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">💬 Status</h3>

        <div class="space-y-2">
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Status Message</label>
            <input v-model="form.status" type="text" maxlength="100" placeholder="Your status message…" class="input text-sm w-full" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Clan Tag</label>
            <input v-model="form.clan_tag" type="text" maxlength="10" placeholder="[TAG]" class="input text-sm w-48" />
          </div>
          <div class="flex justify-end">
            <button @click="saveStatus" :disabled="saving.status" class="btn btn-primary text-xs px-4">
              {{ saving.status ? '⏳ Saving…' : '💾 Save Status' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Stealth (v0.206.0: set_anonymous removed — cloaking devices only) -->
      <div class="card py-2 px-3">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase mb-3">🕵️ Stealth</h3>
        <div class="text-xs text-space-text-dim leading-relaxed">
          Anonymous mode was removed in v0.206.0. Stealth is now handled exclusively through
          <span class="text-space-text font-semibold">cloaking devices</span> — install a cloak module
          (or fly a ship with an integrated cloak) and use the
          <span class="text-space-accent font-mono">cloak</span> command.
          Cloaked ships are hidden from <span class="text-space-accent font-mono">get_nearby</span>
          and the galaxy map, but cloaking burns fuel and breaks on attack.
        </div>
      </div>

      <!-- Ship Colors -->
      <div class="card py-2 px-3 space-y-3">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">🎨 Ship Colors</h3>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Primary Color</label>
            <div class="flex items-center gap-2">
              <input type="color" v-model="form.primary_color" class="w-8 h-8 rounded cursor-pointer border border-space-border bg-transparent" />
              <input v-model="form.primary_color" type="text" maxlength="7" placeholder="#ffffff" class="input text-xs w-24 font-mono" />
            </div>
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Secondary Color</label>
            <div class="flex items-center gap-2">
              <input type="color" v-model="form.secondary_color" class="w-8 h-8 rounded cursor-pointer border border-space-border bg-transparent" />
              <input v-model="form.secondary_color" type="text" maxlength="7" placeholder="#ffffff" class="input text-xs w-24 font-mono" />
            </div>
          </div>
        </div>

        <!-- Preview -->
        <div class="flex items-center gap-3 py-2 px-3 rounded bg-[#161b22] border border-space-border">
          <span class="text-lg" style="filter: drop-shadow(0 0 4px currentColor)">🚀</span>
          <div class="flex gap-2">
            <div class="w-6 h-6 rounded border border-space-border" :style="{ background: form.primary_color }" title="Primary"></div>
            <div class="w-6 h-6 rounded border border-space-border" :style="{ background: form.secondary_color }" title="Secondary"></div>
          </div>
          <span class="text-xs text-space-text-dim">{{ currentBot.username }}</span>
        </div>

        <div class="flex justify-end">
          <button @click="saveColors" :disabled="saving.colors" class="btn btn-primary text-xs px-4">
            {{ saving.colors ? '⏳ Saving…' : '🎨 Apply Colors' }}
          </button>
        </div>
      </div>

      <!-- Home Base -->
      <div class="card py-2 px-3">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase mb-2">🏠 Home Base</h3>
        <div class="text-xs text-space-text-dim mb-3">
          Sets your respawn location when docked at a station. After death, your clone returns here.
        </div>
        <div class="flex items-center justify-between">
          <div class="text-xs">
            <span class="text-space-text-dim">Current: </span>
            <span class="text-space-cyan">{{ currentBot.docked ? formatLocation(currentBot) : '—' }}</span>
          </div>
          <button
            @click="setHomeBase"
            :disabled="!currentBot.docked || saving.home"
            class="btn btn-secondary text-xs px-3"
            :title="!currentBot.docked ? 'Must be docked at a station' : 'Set current station as home base'"
          >
            {{ saving.home ? '⏳' : '📍 Set as Home' }}
          </button>
        </div>
        <div v-if="!currentBot.docked" class="text-[11px] text-space-text-dim mt-1.5 italic">Dock at a station to set home base.</div>
      </div>
    </template>

    <!-- Empire Reputation — always visible from bot state, refresh optional -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">⚜️ Empire Reputation</h3>
        <button @click="refreshReputation" :disabled="loadingRep" class="btn btn-secondary text-xs py-0 px-2">{{ loadingRep ? '⏳' : '🔄' }}</button>
      </div>
      <div v-if="empireReputations.length" class="space-y-2">
        <div v-for="rep in empireReputations" :key="rep.empire" class="bg-[#21262d] rounded-md p-2 text-xs">
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-space-text-bright">{{ rep.empire_name }}</span>
            <div class="flex gap-1 flex-wrap justify-end">
              <span v-if="rep.criminal > 0" class="px-1.5 py-0.5 rounded text-[10px] bg-red-900/40 text-red-300">🚔 Criminal {{ rep.criminal }}</span>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px]">
            <span v-if="rep.fame !== undefined" class="text-space-text-dim">⭐ Fame <span class="text-space-text">{{ rep.fame }}</span></span>
            <span v-if="rep.need !== undefined" class="text-space-text-dim">📦 Need <span class="text-space-text">{{ rep.need }}</span></span>
            <span v-if="rep.love !== undefined" class="text-space-text-dim">💚 Love <span class="text-space-text">{{ rep.love }}</span></span>
            <span v-if="rep.hate !== undefined" class="text-space-text-dim">💢 Hate <span class="text-space-red">{{ rep.hate }}</span></span>
            <span v-if="rep.fear !== undefined" class="text-space-text-dim">😱 Fear <span class="text-space-red">{{ rep.fear }}</span></span>
          </div>
        </div>
      </div>
      <div v-else class="text-xs text-space-text-dim italic py-1">No reputation data — click 🔄 to fetch.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

interface Props { bot: any; }
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();
const loading = ref(false);
const loaded = ref(false);
const loadingRep = ref(false);

const reputationRaw = ref<any>(null);

async function refreshReputation() {
  loadingRep.value = true;
  const r = await execCmd('get_status');
  loadingRep.value = false;
  if (r.ok && r.data) {
    const d = r.data as any;
    const player = d.player || d.character || d;
    reputationRaw.value = player.empire_rep || d.empire_rep || player.empire_reputations || d.empire_reputations || null;
  } else {
    emit('notif', r.error || 'Failed to refresh reputation', 'error');
  }
}

const empireReputations = computed(() => {
  const src = reputationRaw.value
    || (currentBot.value as any)?.empireRep
    || (currentBot.value as any)?.playerStats?.empire_reputations
    || (currentBot.value as any)?.empire_reputations
    || null;
  if (!src || typeof src !== 'object') return [];
  const EMPIRE_NAMES: Record<string, string> = {
    nebula: 'Nebula Collective', crimson: 'Crimson Pact', solarian: 'Solarian Union', outer_rim: 'Outer Rim'
  };
  return Object.entries(src).map(([k, v]: [string, any]) => ({
    empire: k,
    empire_name: EMPIRE_NAMES[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    fame:    v?.fame    ?? v?.Fame,
    need:    v?.need    ?? v?.Need,
    love:    v?.love    ?? v?.Love,
    hate:    v?.hate    ?? v?.Hate,
    fear:    v?.fear    ?? v?.Fear,
    criminal: v?.criminal ?? v?.Criminal ?? 0,
  }));
});

const form = ref({
  status: '',
  clan_tag: '',
  primary_color: '#4a9eff',
  secondary_color: '#ffffff',
});

const saving = ref({ status: false, colors: false, home: false });

const depositPrimary = ref('faction');
const depositSecondary = ref('storage');

onMounted(() => { loadProfile(); });
watch(() => props.bot.username, () => { loaded.value = false; loadProfile(); });

let _skipDepositSave = false;
watch(() => botStore.settings, (s) => {
  _skipDepositSave = true;
  const username = props.bot.username;
  const perBot = (s[username] || {}) as Record<string, unknown>;
  const globalMiner = (s.miner || {}) as Record<string, unknown>;
  depositPrimary.value = (perBot.depositMode as string) || (globalMiner.depositMode as string) || 'faction';
  depositSecondary.value = (perBot.depositFallback as string) || (globalMiner.depositFallback as string) || 'storage';
  nextTick(() => { _skipDepositSave = false; });
}, { immediate: true, deep: true });
watch([depositPrimary, depositSecondary], ([primary, secondary]) => {
  if (_skipDepositSave) return;
  const username = props.bot.username;
  if (username) botStore.saveSettings(username, { depositMode: primary, depositFallback: secondary });
});

const currentBot = computed(() => botStore.bots.find(b => b.username === props.bot.username) || props.bot);

function execCmd(command: string, params?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise(resolve => {
    botStore.sendExec(props.bot.username, command, params || {}, (r: any) => resolve(r));
  });
}

async function loadProfile() {
  loading.value = true;
  const r = await execCmd('get_status');
  loading.value = false;
  if (r.ok && r.data) {
    const d = r.data as any;
    const player = d.player || d.character || d;
    form.value.status = player.status_message || player.status || '';
    form.value.clan_tag = player.clan_tag || player.tag || '';
    form.value.primary_color = player.primary_color || player.color || '#4a9eff';
    form.value.secondary_color = player.secondary_color || '#ffffff';
    reputationRaw.value = player.empire_rep || d.empire_rep || player.empire_reputations || d.empire_reputations || d.reputations || player.reputations || null;
    loaded.value = true;
  } else {
    emit('notif', r.error || 'Failed to load profile', 'error');
    loaded.value = true;
  }
}

async function saveStatus() {
  saving.value.status = true;
  const r = await execCmd('set_status', { status: form.value.status, clan_tag: form.value.clan_tag });
  saving.value.status = false;
  emit('notif', r.ok ? 'Status updated' : (r.error || 'Failed to update status'), r.ok ? 'success' : 'error');
}

async function saveColors() {
  saving.value.colors = true;
  const r = await execCmd('set_colors', {
    primary_color: form.value.primary_color,
    secondary_color: form.value.secondary_color,
  });
  saving.value.colors = false;
  emit('notif', r.ok ? 'Ship colors updated' : (r.error || 'Failed to update colors'), r.ok ? 'success' : 'error');
}

async function setHomeBase() {
  saving.value.home = true;
  const r = await execCmd('set_home_base');
  saving.value.home = false;
  emit('notif', r.ok ? `Home base set to ${formatLocation(currentBot.value)}` : (r.error || 'Failed to set home base'), r.ok ? 'success' : 'error');
}

function formatLocation(bot: any): string {
  if (bot.poi) {
    const system = botStore.mapData[bot.system];
    if (system) {
      const poi = (system as any).pois?.find((p: any) => p.id === bot.poi);
      return `${poi?.name || bot.poi} (${(system as any).name || bot.system})`;
    }
    return `${bot.poi} (${bot.system})`;
  }
  return bot.location || bot.system || '—';
}
</script>
