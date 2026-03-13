<template>
  <span class="kb-tooltip-wrap" @mouseenter="show" @mouseleave="hide" @focus="show" @blur="hide">
    <slot />
    <Teleport to="body">
      <div
        v-if="visible && entry"
        class="kb-tooltip"
        :style="tooltipStyle"
      >
        <div class="kb-tooltip-header">
          <span class="kb-tooltip-name">{{ entry.name }}</span>
          <span class="kb-tooltip-cat">{{ shortCat }}</span>
        </div>
        <p v-if="entry.description" class="kb-tooltip-desc">{{ entry.description }}</p>
        <a :href="entry.url" target="_blank" rel="noopener" class="kb-tooltip-link">📖 More info</a>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useKbStore } from '../stores/kbStore';

const props = defineProps<{ itemId: string }>();

const kbStore = useKbStore();
const visible = ref(false);
const tooltipStyle = ref<Record<string, string>>({});
let anchorEl: HTMLElement | null = null;

const entry = computed(() => kbStore.get(props.itemId));

const shortCat = computed(() => {
  const c = entry.value?.category ?? '';
  return c.split('/').pop() ?? c;
});

function show(e: MouseEvent | FocusEvent) {
  if (!entry.value) return;
  anchorEl = (e.currentTarget as HTMLElement);
  visible.value = true;
  positionTooltip();
}

function hide() {
  visible.value = false;
}

function positionTooltip() {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 280);
  const top = rect.bottom + 6;
  tooltipStyle.value = {
    position: 'fixed',
    left: `${Math.max(4, left)}px`,
    top: `${top}px`,
    zIndex: '9999',
  };
}

onMounted(() => {
  kbStore.load();
});
</script>

<style scoped>
.kb-tooltip-wrap {
  position: relative;
  cursor: help;
  border-bottom: 1px dashed rgba(88,166,255,0.35);
}
.kb-tooltip {
  min-width: 220px;
  max-width: 320px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  pointer-events: none;
}
.kb-tooltip-header {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.kb-tooltip-name {
  font-weight: 600;
  font-size: 12px;
  color: #e6edf3;
}
.kb-tooltip-cat {
  font-size: 10px;
  color: #7d8590;
  text-transform: capitalize;
}
.kb-tooltip-desc {
  font-size: 11px;
  color: #8d96a0;
  margin: 0 0 6px;
  line-height: 1.4;
}
.kb-tooltip-link {
  font-size: 10px;
  color: #58a6ff;
  text-decoration: none;
  pointer-events: auto;
}
</style>
