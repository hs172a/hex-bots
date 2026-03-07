<template>
  <div class="flex flex-col w-48 shrink-0 bg-space-card border-r border-space-border overflow-hidden">

    <!-- 1-row character header (shown when a bot is selected) -->
    <div v-if="currentBot" class="px-2 py-1.5 border-b border-space-border bg-[#0d1117]">
      <div class="flex items-center gap-1 min-w-0">
        <span class="text-base leading-none shrink-0">{{ empireIcon((currentBot as any).empire) }}</span>
        <span class="font-semibold text-space-text-bright text-[11px] truncate leading-tight">{{ currentBot.username }}</span>
        <span
          class="ml-auto shrink-0 text-[9px] px-1 py-0.5 rounded font-semibold leading-none"
          :class="stateClass(currentBot.state)"
        >{{ currentBot.state }}</span>
      </div>
      <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-space-text-dim truncate leading-tight">
        <span v-if="currentBot.shipName" class="truncate">{{ currentBot.shipName }}</span>
        <span v-if="currentBot.docked" class="text-space-green shrink-0">⚓</span>
        <span v-else class="text-amber-400 shrink-0">🚀</span>
        <span class="truncate shrink min-w-0">{{ displaySystem(currentBot as any) }}</span>
      </div>
      <div class="flex items-center gap-2 mt-0.5 text-[10px] leading-tight">
        <span class="text-space-text-dim">₡{{ formatCredits(currentBot.credits) }}</span>
        <span v-if="botStore.botCreditsPerHour[currentBot.username]" class="text-space-green">+{{ botStore.botCreditsPerHour[currentBot.username] }}/h</span>
        <span v-if="(currentBot as any).routine" class="ml-auto text-space-text-dim truncate text-[9px]">{{ (currentBot as any).routine }}</span>
      </div>
    </div>

    <!-- Panel title when no bot selected -->
    <div v-else class="px-2 py-1.5 border-b border-space-border">
      <span class="text-[11px] text-space-text-dim font-semibold uppercase tracking-wide">Characters</span>
    </div>

    <!-- Bot list -->
    <div class="flex-1 overflow-y-auto scrollbar-dark py-1">
      <div
        v-for="bot in botStore.bots"
        :key="bot.username"
        @click="select(bot.username)"
        class="flex items-center gap-1.5 w-full px-2 py-1.5 text-[11px] rounded-sm cursor-pointer mx-1 transition-colors"
        :class="[
          botStore.selectedBot === bot.username
            ? 'bg-[rgba(88,166,255,0.12)] text-space-accent'
            : 'text-space-text hover:bg-space-row-hover',
        ]"
        style="width: calc(100% - 8px)"
      >
        <span
          class="shrink-0 w-1.5 h-1.5 rounded-full"
          :class="dotClass(bot.state)"
        />
        <span class="truncate leading-tight">{{ bot.username }}</span>
        <span class="ml-auto text-[10px] shrink-0">{{ empireIcon((bot as any).empire) }}</span>
      </div>

      <div v-if="botStore.bots.length === 0" class="px-3 py-4 text-[11px] text-space-text-dim italic text-center">
        No characters
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useBotStore } from '../stores/botStore';
import { empireIcon } from '../utils/empires';

const botStore = useBotStore();

const currentBot = computed(() => botStore.currentBot);

function select(username: string) {
  botStore.selectedBot = username;
}

function displaySystem(bot: any): string {
  return bot.current_system || bot.location || bot.system || '';
}

function formatCredits(v: any): string {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return `${n}`;
}

function stateClass(state: string): string {
  switch (state) {
    case 'running':  return 'bg-[rgba(63,185,80,0.15)] text-space-green';
    case 'idle':     return 'bg-[rgba(88,166,255,0.1)] text-space-accent';
    case 'error':    return 'bg-[rgba(255,80,80,0.1)] text-space-red';
    case 'stopped':  return 'bg-[rgba(100,100,100,0.1)] text-space-text-dim';
    default:         return 'bg-[rgba(100,100,100,0.1)] text-space-text-dim';
  }
}

function dotClass(state: string): string {
  switch (state) {
    case 'running':  return 'bg-space-green';
    case 'idle':     return 'bg-space-accent';
    case 'error':    return 'bg-space-red';
    default:         return 'bg-space-text-dim';
  }
}
</script>
