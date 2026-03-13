import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface KbEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
}

export const useKbStore = defineStore('kb', () => {
  const entries = ref<KbEntry[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  /** Map from id → entry for O(1) lookup. */
  const byId = computed(() => {
    const m = new Map<string, KbEntry>();
    for (const e of entries.value) m.set(e.id, e);
    return m;
  });

  async function load() {
    if (loaded.value || loading.value) return;
    loading.value = true;
    try {
      const resp = await fetch('/api/kb/index');
      if (resp.ok) {
        const data = await resp.json();
        entries.value = Array.isArray(data) ? data as KbEntry[] : [];
        loaded.value = true;
      } else {
        const body = await resp.text().catch(() => '');
        console.warn(`[KB] /api/kb/index returned ${resp.status}:`, body);
        loaded.value = true; // don't retry on error
      }
    } catch (err) { console.warn('[KB] fetch failed:', err); }
    loading.value = false;
  }

  function get(id: string): KbEntry | undefined {
    return byId.value.get(id);
  }

  return { entries, loading, loaded, load, get };
});
