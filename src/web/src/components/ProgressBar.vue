<template>
  <div class="flex items-center gap-2 min-w-[80px]">
    <div class="flex-1 h-1.5 bg-space-border rounded-full overflow-hidden">
      <div 
        class="h-full transition-all duration-300 rounded-full"
        :class="barColorClass"
        :style="{ width: percentage + '%' }"
      />
    </div>
    <span class="text-[10px] text-space-text-dim tabular-nums min-w-[45px]">
      {{ current }}/{{ max }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  current: number;
  max: number;
  color?: 'red' | 'cyan' | 'green' | 'yellow' | 'magenta';
}>();

const percentage = computed(() => {
  if (!props.max) return 0;
  return Math.min(100, (props.current / props.max) * 100);
});

const barColorClass = computed(() => {
  switch (props.color) {
    case 'red': return 'bg-space-red';
    case 'cyan': return 'bg-space-cyan';
    case 'green': return 'bg-space-green';
    case 'yellow': return 'bg-space-yellow';
    case 'magenta': return 'bg-space-magenta';
    default: return 'bg-space-accent';
  }
});
</script>
