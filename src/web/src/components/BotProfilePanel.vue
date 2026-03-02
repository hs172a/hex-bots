<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Load button -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">👤 Player Profile</h3>
        <button @click="loadProfile" :disabled="loading" class="btn btn-secondary text-xs py-0 px-2">{{ loading ? '⏳' : '🔄 Load' }}</button>
      </div>
      <div v-if="!loaded" class="text-xs text-space-text-dim italic py-4 text-center">Click Load to fetch current profile settings.</div>
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

      <!-- Anonymous Mode -->
      <div class="card py-2 px-3">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase mb-3">🕵️ Anonymous Mode</h3>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-sm text-space-text">Hide from player lists</div>
            <div class="text-xs text-space-text-dim mt-0.5">When enabled, your character won't appear in public player scans.</div>
          </div>
          <button
            @click="toggleAnonymous"
            :disabled="saving.anon"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4"
            :class="form.anonymous ? 'bg-space-accent' : 'bg-[#30363d]'"
          >
            <span class="inline-block h-4 w-4 rounded-full bg-white transform transition-transform"
              :class="form.anonymous ? 'translate-x-6' : 'translate-x-1'"></span>
          </button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

interface Props { bot: any; }
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();
const loading = ref(false);
const loaded = ref(false);

const form = ref({
  status: '',
  clan_tag: '',
  anonymous: false,
  primary_color: '#4a9eff',
  secondary_color: '#ffffff',
});

const saving = ref({ status: false, anon: false, colors: false, home: false });

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
    form.value.anonymous = !!(player.anonymous || player.is_anonymous);
    form.value.primary_color = player.primary_color || player.color || '#4a9eff';
    form.value.secondary_color = player.secondary_color || '#ffffff';
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

async function toggleAnonymous() {
  saving.value.anon = true;
  const newVal = !form.value.anonymous;
  const r = await execCmd('set_anonymous', { anonymous: newVal });
  saving.value.anon = false;
  if (r.ok) {
    form.value.anonymous = newVal;
    emit('notif', newVal ? 'Anonymous mode enabled' : 'Anonymous mode disabled', 'success');
  } else {
    emit('notif', r.error || 'Failed to toggle anonymous mode', 'error');
  }
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
