<template>
  <div class="flex-1 flex flex-col overflow-hidden p-3 gap-3">

    <!-- Toolbar -->
    <div class="flex items-center gap-2">
      <button @click="loadNotes" :disabled="loading" class="btn btn-secondary text-xs px-3">
        {{ loading ? '⏳' : '🔄' }} Refresh
      </button>
      <button @click="startCreate" :disabled="!bot.docked" :title="!bot.docked ? 'Must be docked to create a note' : ''" class="btn btn-primary text-xs px-3">
        ✏️ New Note
      </button>
      <span v-if="!bot.docked" class="text-xs text-yellow-500">⚠️ Dock to create/edit notes</span>
      <span class="ml-auto text-xs text-space-text-dim">{{ notes.length }} note{{ notes.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Create form -->
    <div v-if="creating" class="p-3 rounded bg-[#0d1117f0] border border-space-border">
      <div class="text-xs font-semibold text-space-text mb-2">New Note</div>
      <input
        v-model="newTitle"
        maxlength="100"
        placeholder="Title (max 100 chars)…"
        class="input text-xs w-full mb-2"
      />
      <textarea
        v-model="newContent"
        rows="5"
        placeholder="Content…"
        class="input text-xs w-full resize-y mb-2"
      ></textarea>
      <div class="flex gap-2">
        <button @click="submitCreate" :disabled="!newTitle.trim() || saving" class="btn btn-primary text-xs px-3">
          {{ saving ? '⏳ Saving…' : '💾 Create' }}
        </button>
        <button @click="creating = false" class="btn btn-secondary text-xs px-3">Cancel</button>
      </div>
    </div>

    <!-- Main content: list + viewer -->
    <div class="flex flex-1 gap-3 overflow-hidden min-h-0">

      <!-- Note list -->
      <div class="w-52 flex-shrink-0 flex flex-col overflow-hidden rounded bg-space-card border border-space-border">
        <div class="px-2 py-1.5 border-b border-space-border text-[11px] text-space-text-dim uppercase tracking-wider font-semibold">Notes</div>
        <div v-if="notes.length === 0 && !loading" class="text-xs text-space-text-dim text-center py-6">No notes</div>
        <div v-if="loading && notes.length === 0" class="text-xs text-space-text-dim text-center py-6">Loading…</div>
        <div class="flex-1 overflow-auto">
          <div
            v-for="note in notes"
            :key="note.note_id"
            @click="selectNote(note)"
            class="px-2 py-2 cursor-pointer border-b border-[#21262d] transition-colors"
            :class="selectedId === note.note_id
              ? 'bg-space-row-hover text-space-accent border-l-2 border-l-space-accent pl-[7px]'
              : 'text-space-text-dim hover:bg-space-row-hover hover:text-space-text'"
          >
            <div class="text-xs font-medium truncate">{{ note.title || '(untitled)' }}</div>
            <div v-if="note.created_at" class="text-[11px] text-space-text-dim mt-0.5">{{ fmtDate(note.created_at) }}</div>
          </div>
        </div>
      </div>

      <!-- Note viewer / editor -->
      <div class="flex-1 flex flex-col overflow-hidden rounded bg-space-card border border-space-border">
        <div v-if="!selectedId" class="flex-1 flex items-center justify-center text-xs text-space-text-dim">
          Select a note to read it
        </div>

        <template v-else>
          <!-- Header -->
          <div class="flex items-center gap-2 px-3 py-2 border-b border-space-border">
            <span class="text-sm font-semibold text-space-text-bright flex-1 truncate">{{ selectedNote?.title }}</span>
            <button v-if="!editing" @click="startEdit" :disabled="!bot.docked" :title="!bot.docked ? 'Must be docked to edit' : ''" class="btn btn-secondary text-xs px-2 py-0.5">✏️ Edit</button>
            <button v-if="editing" @click="submitEdit" :disabled="saving" class="btn btn-primary text-xs px-2 py-0.5">{{ saving ? '⏳' : '💾 Save' }}</button>
            <button v-if="editing" @click="cancelEdit" class="btn btn-secondary text-xs px-2 py-0.5">✗</button>
          </div>

          <!-- Content loading -->
          <div v-if="contentLoading" class="flex-1 flex items-center justify-center text-xs text-space-text-dim">Loading…</div>

          <!-- View mode -->
          <div v-else-if="!editing" class="flex-1 overflow-auto p-3">
            <pre class="text-xs text-space-text whitespace-pre-wrap font-sans leading-relaxed">{{ viewContent }}</pre>
          </div>

          <!-- Edit mode -->
          <div v-else class="flex-1 flex flex-col p-3 gap-2">
            <textarea
              v-model="editContent"
              class="flex-1 input text-xs resize-none font-mono leading-relaxed"
              placeholder="Note content…"
            ></textarea>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

const props = defineProps<{ bot: { username: string; docked: boolean } }>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();

interface NoteEntry {
  note_id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  size?: number;
}

const notes = ref<NoteEntry[]>([]);
const loading = ref(false);
const saving = ref(false);
const contentLoading = ref(false);

const creating = ref(false);
const newTitle = ref('');
const newContent = ref('');

const selectedId = ref<string | null>(null);
const selectedNote = computed(() => notes.value.find(n => n.note_id === selectedId.value) ?? null);
const viewContent = ref('');
const editing = ref(false);
const editContent = ref('');

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function loadNotes() {
  loading.value = true;
  botStore.sendExec(props.bot.username, 'get_notes', {}, (data: unknown) => {
    loading.value = false;
    const d = data as Record<string, unknown>;
    const arr = (Array.isArray(d?.notes) ? d.notes :
                 Array.isArray(d?.items) ? d.items :
                 Array.isArray(d) ? d : []) as NoteEntry[];
    notes.value = arr;
  });
}

function selectNote(note: NoteEntry) {
  if (selectedId.value === note.note_id) return;
  selectedId.value = note.note_id;
  editing.value = false;
  viewContent.value = '';
  contentLoading.value = true;
  botStore.sendExec(props.bot.username, 'read_note', { note_id: note.note_id }, (data: unknown) => {
    contentLoading.value = false;
    const d = data as Record<string, unknown>;
    viewContent.value = (d?.content as string) ?? (d?.text as string) ?? JSON.stringify(data, null, 2);
  });
}

function startCreate() {
  creating.value = true;
  newTitle.value = '';
  newContent.value = '';
}

function submitCreate() {
  if (!newTitle.value.trim()) return;
  saving.value = true;
  botStore.sendExec(props.bot.username, 'create_note', { title: newTitle.value.trim(), content: newContent.value }, (data: unknown) => {
    saving.value = false;
    const d = data as Record<string, unknown>;
    if (d?.error) {
      emit('notif', `Failed: ${d.error}`, 'error');
      return;
    }
    creating.value = false;
    emit('notif', `Note "${newTitle.value}" created`, 'success');
    loadNotes();
  });
}

function startEdit() {
  editContent.value = viewContent.value;
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
  editContent.value = '';
}

function submitEdit() {
  if (!selectedId.value) return;
  saving.value = true;
  botStore.sendExec(props.bot.username, 'write_note', { note_id: selectedId.value, content: editContent.value }, (data: unknown) => {
    saving.value = false;
    const d = data as Record<string, unknown>;
    if (d?.error) { emit('notif', `Save failed: ${d.error}`, 'error'); return; }
    viewContent.value = editContent.value;
    editing.value = false;
    emit('notif', 'Note saved', 'success');
  });
}

loadNotes();
</script>
