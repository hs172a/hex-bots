<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Add Entry -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">📜 Captain's Log</h3>
        <button @click="loadLogs" :disabled="loading" class="btn btn-secondary text-xs py-0 px-2">{{ loading ? '⏳' : '🔄' }}</button>
      </div>
      <div class="flex gap-2">
        <textarea
          v-model="newEntry"
          placeholder="Write a log entry…"
          rows="2"
          class="input text-xs flex-1 resize-none"
          @keydown.ctrl.enter.prevent="addEntry"
        ></textarea>
        <button @click="addEntry" :disabled="!newEntry.trim() || saving" class="btn btn-primary text-xs px-3 self-stretch">
          {{ saving ? '⏳' : '✍️ Add' }}
        </button>
      </div>
      <div class="text-[10px] text-space-text-dim mt-1">Ctrl+Enter to submit</div>
    </div>

    <!-- Log List -->
    <div class="card py-2 px-3">
      <div v-if="loading && logs.length === 0" class="text-xs text-space-text-dim italic py-6 text-center">Loading logs…</div>
      <div v-else-if="logs.length === 0" class="text-xs text-space-text-dim italic py-6 text-center">No log entries yet.</div>
      <div v-else class="space-y-2">
        <div
          v-for="entry in logs"
          :key="entry.id"
          class="rounded border border-space-border bg-[#161b22] px-3 py-2 cursor-pointer hover:border-space-accent/50 transition-colors"
          @click="selectEntry(entry)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="text-xs text-space-text-bright font-medium leading-snug flex-1 min-w-0">
              {{ entryPreview(entry) }}
            </div>
            <span class="text-[11px] text-space-text-dim shrink-0 whitespace-nowrap">{{ formatDate(entry.created_at || entry.timestamp) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Entry Detail Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0">
        <div v-if="selectedEntry" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="selectedEntry = null">
          <div class="bg-[#0d1117f0] border border-space-border rounded-lg shadow-2xl w-full max-w-lg mx-4 p-5">
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs text-space-text-dim">{{ formatDate(selectedEntry.created_at || selectedEntry.timestamp) }}</span>
              <button @click="selectedEntry = null" class="text-space-text-dim hover:text-space-text-bright text-lg leading-none">×</button>
            </div>
            <div class="text-sm text-space-text-bright whitespace-pre-wrap leading-relaxed max-h-80 overflow-auto scrollbar-dark">{{ selectedEntry.entry || selectedEntry.text || selectedEntry.content }}</div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

interface Props { bot: any; }
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();

const logs = ref<any[]>([]);
const loading = ref(false);
const saving = ref(false);
const newEntry = ref('');
const selectedEntry = ref<any>(null);

function execCmd(command: string, params?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise(resolve => {
    botStore.sendExec(props.bot.username, command, params || {}, (r: any) => resolve(r));
  });
}

async function loadLogs() {
  loading.value = true;
  const r = await execCmd('captains_log_list');
  loading.value = false;
  if (r.ok && r.data) {
    const d = r.data as any;
    logs.value = Array.isArray(d) ? d : (Array.isArray(d.entries) ? d.entries : Array.isArray(d.logs) ? d.logs : []);
    logs.value = logs.value.slice().reverse();
  } else if (!r.ok) {
    emit('notif', r.error || 'Failed to load logs', 'error');
  }
}

async function addEntry() {
  const text = newEntry.value.trim();
  if (!text) return;
  saving.value = true;
  const r = await execCmd('captains_log_add', { entry: text });
  saving.value = false;
  if (r.ok) {
    emit('notif', 'Log entry saved', 'success');
    newEntry.value = '';
    await loadLogs();
  } else {
    emit('notif', r.error || 'Failed to save entry', 'error');
  }
}

async function selectEntry(entry: any) {
  if (entry.entry || entry.text || entry.content) {
    selectedEntry.value = entry;
    return;
  }
  const r = await execCmd('captains_log_get', { log_id: entry.id || entry.log_id });
  if (r.ok && r.data) {
    selectedEntry.value = r.data;
  } else {
    selectedEntry.value = entry;
  }
}

function entryPreview(entry: any): string {
  const text = entry.entry || entry.text || entry.content || entry.title || '';
  return text.length > 120 ? text.slice(0, 120) + '…' : text;
}

function formatDate(ts: string | number | undefined): string {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

onMounted(loadLogs);
</script>
