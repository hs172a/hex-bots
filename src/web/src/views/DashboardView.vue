<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Fleet Stats Bar -->
    <div class="flex gap-4 m-2 px-2 py-2 bg-space-card border border-space-border rounded-lg">
      <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider self-center mr-2">
        Fleet Stats
      </span>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">🤖 {{ activeBots }}</span>
        <span class="text-xs text-space-text-dim">Active Bots</span>
      </div>
      <div class="flex flex-col items-center min-w-20">
        <span class="text-xl font-bold text-space-text-bright">₡{{ formatNumber(fleetCredits) }}</span>
        <span class="text-xs text-space-text-dim">Fleet Credits</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">₡{{ formatNumber(todayProfit) }}</span>
        <span class="text-xs text-space-text-dim">Trade Profit</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(todayTrades) }}</span>
        <span class="text-xs text-space-text-dim">Trades</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ avgProfitPerTrade > 0 ? '₡' + formatNumber(avgProfitPerTrade) : '—' }}</span>
        <span class="text-xs text-space-text-dim">Avg/Trade</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalMined) }}</span>
        <span class="text-xs text-space-text-dim">Ores Mined</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalCrafted) }}</span>
        <span class="text-xs text-space-text-dim">Items Crafted</span>
      </div>
      <div class="flex flex-col items-center min-w-16">
        <span class="text-xl font-bold text-space-text-bright">{{ formatNumber(totalSystems) }}</span>
        <span class="text-xs text-space-text-dim">Explored</span>
      </div>
      <!-- Game server stats (pushed via WebSocket every tick ~10s) -->
      <div v-if="gameStats.online_players" class="flex items-center gap-2 ml-auto border-l border-space-border pl-4">
        <div class="flex flex-col items-center min-w-14">
          <span class="text-base font-bold text-space-cyan">{{ gameStats.online_players }} / {{ gameStats.total_players }}</span>
          <span class="text-[10px] text-space-text-dim">Online</span>
        </div>
        <div class="flex flex-col items-center min-w-14">
          <span class="text-base font-bold text-space-text-bright">#{{ gameStats.tick?.toLocaleString() }}</span>
          <span class="text-[10px] text-space-text-dim">Tick</span>
        </div>
        <div class="flex flex-col items-center min-w-16">
          <span class="text-[11px] font-mono text-space-text-dim">v{{ gameStats.version }}</span>
          <span class="text-[10px] text-space-text-dim">Game API</span>
        </div>
      </div>
      <div class="flex gap-2" :class="gameStats.online_players ? '' : 'ml-auto'">
        <button @click="showAddBot = true" class="btn btn-primary px-2 py-1 text-xs">
          Add Bot
        </button>
      </div>
    </div>

    <!-- Bot table card -->
    <div class="card overflow-hidden flex flex-col mx-2 px-2 py-2 pt-0">
      <!-- Bot table -->
      <div class="flex-1 overflow-auto p-0">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-space-card border-b border-space-border bg-transparent">
            <tr class="text-left text-xs text-space-text-dim uppercase tracking-wider">
              <th v-if="botStore.vmList.length > 0" class="py-2 px-0 font-semibold">VM</th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('name')">Name <span class="opacity-60">{{ dashSortIndicator('name') }}</span></th>
              <th class="py-2 px-0 font-semibold">Ship</th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('state')">State <span class="opacity-60">{{ dashSortIndicator('state') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('credits')">Credits <span class="opacity-60">{{ dashSortIndicator('credits') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" title="Rolling 1-hour earnings rate" @click="setDashSort('cph')">₡/hr <span class="opacity-60">{{ dashSortIndicator('cph') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('fuel')">Fuel <span class="opacity-60">{{ dashSortIndicator('fuel') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('hull')">Hull <span class="opacity-60">{{ dashSortIndicator('hull') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('shield')">Shield <span class="opacity-60">{{ dashSortIndicator('shield') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text" @click="setDashSort('cargo')">Cargo <span class="opacity-60">{{ dashSortIndicator('cargo') }}</span></th>
              <th class="py-2 px-0 font-semibold cursor-pointer select-none hover:text-space-text min-w-24" @click="setDashSort('location')">Location <span class="opacity-60">{{ dashSortIndicator('location') }}</span></th>
              <th class="py-2 px-0 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="bot in sortedDashBots"
              :key="bot.username"
              class="border-b border-space-border hover:bg-space-row-hover transition-colors cursor-pointer"
              @click="selectBot(bot.username)"
            >
              <td v-if="botStore.vmList.length > 0" class="px-0 py-1">
                <span
                  v-if="bot.vm"
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded border"
                  :class="vmBadgeClass(botStore.vmStatuses[bot.vm])"
                  :title="`Remote VM: ${bot.vm}`"
                >{{ bot.vm }}</span>
                <span v-else class="text-[10px] font-medium px-1.5 py-0.5 rounded border text-blue-400 border-blue-700/50 bg-blue-900/20">local</span>
              </td>
              <td class="px-0 py-1">
                <span v-if="(bot as any).empire" :title="empireName((bot as any).empire)" class="shrink-0 leading-none">{{ empireIcon((bot as any).empire) }}</span>
                <span class="text-space-accent font-medium">{{ bot.username }}</span>
              </td>
              <td class="px-0 py-1 text-space-text-dim">
                <span class="text-[11px]">{{ bot.docked ? '⚓' : '🚀' }}</span>
                {{ bot.shipName || bot.ship || 'Unknown' }}
              </td>
              <td class="px-0 py-1">
                <span 
                  class="badge px-2 py-0.5"
                  :class="{
                    'badge-green': bot.state === 'running',
                    'badge-yellow': bot.state === 'stopped' || bot.state === 'idle',
                    'badge-red': bot.state === 'error'
                  }"
                >
                  {{ bot.state === 'running' && bot.routine ? bot.routine : bot.state }}
                </span>
                <span
                  v-if="botStore.lrtBots.has(bot.username)"
                  class="ml-1 badge px-1.5 py-0.5 text-[10px] bg-purple-900/40 text-purple-300 border border-purple-700/50"
                  title="Long Range Travel in progress"
                >🛸 LRT</span>
              </td>
              <td class="px-0 py-1">
                <span class="text-space-yellow">₡{{ formatNumber(bot.credits) }}</span>
                <span
                  v-if="bot.tradingRestrictedUntil && new Date(bot.tradingRestrictedUntil) > new Date()"
                  class="ml-1 badge badge-red text-[10px]"
                  :title="'Trading restricted until ' + new Date(bot.tradingRestrictedUntil).toLocaleTimeString()"
                >🚫 trade</span>
              </td>
              <td class="px-0 py-1 text-xs">
                <template v-if="botStore.botCreditsPerHour[bot.username]">
                  <span :class="botStore.botCreditsPerHour[bot.username] >= 0 ? 'text-space-green' : 'text-space-red'">
                    {{ botStore.botCreditsPerHour[bot.username] >= 0 ? '+' : '' }}{{ formatNumber(botStore.botCreditsPerHour[bot.username]) }}
                  </span>
                </template>
                <span v-else class="text-space-text-dim text-[11px]">…</span>
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.fuel" 
                  :max="bot.maxFuel" 
                  color="cyan"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.hull" 
                  :max="bot.maxHull" 
                  color="red"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.shield" 
                  :max="bot.maxShield" 
                  color="cyan"
                />
              </td>
              <td class="pl-0 pr-2 py-1">
                <ProgressBar 
                  :current="bot.cargo" 
                  :max="bot.cargoMax" 
                  color="magenta"
                />
              </td>
              <td class="px-0 py-1 text-xs text-space-cyan min-w-20">
                {{ bot.poi ? botStore.resolveLocation(bot.system || '', bot.poi) : (botStore.resolveLocation(bot.system || '') || bot.location) }}
              </td>
              <td class="px-0 py-1">
                <div class="flex gap-1 items-center">
                  <template v-if="bot.state === 'idle' || bot.state === 'error'">
                    <select 
                      :id="'routine-' + bot.username"
                      @click.stop
                      class="input text-[11px] px-1 py-0.5"
                    >
                      <option v-for="r in botStore.routines" :key="r.id" :value="r.id">{{ r.name }}</option>
                    </select>
                    <button 
                      @click.stop="startBotInline(bot.username)"
                      class="btn btn-primary text-xs py-0.5 px-2"
                    >Start</button>
                  </template>
                  <button 
                    v-if="bot.state === 'running' || bot.state === 'stopping' || bot.state === 'error'"
                    @click.stop="stopBot(bot.username)"
                    :disabled="bot.state === 'stopping'"
                    class="btn-danger text-xs py-0.5 px-2 disabled:opacity-40"
                  >{{ bot.state === 'stopping' ? '…' : 'Stop' }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Scrollable content wrapper -->
    <div class="flex-1 overflow-auto p-2 pb-0 space-y-4">
      <!-- Log panels (Activity, Broadcast, System) -->
      <div class="grid grid-cols-3 gap-2 h-72">

        <!-- Activity Log -->
        <div class="card flex flex-col overflow-hidden py-2 px-2">
          <div class="flex items-center justify-between pb-1.5 border-b border-space-border shrink-0">
            <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Activity Log</span>
            <select v-model="activityBotFilter" class="input text-[11px] py-0 h-5 pl-1 max-w-[100px]">
              <option value="">All bots</option>
              <option v-for="b in botStore.sortedBots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
          </div>
          <div ref="activityLogRef" class="flex-1 overflow-auto mt-1 pr-0.5 font-mono scrollbar-dark space-y-px">
            <div
              v-for="(entry, idx) in filteredActivityLogs"
              :key="idx"
              class="leading-snug text-[11px] whitespace-pre-wrap"
            >
              <template v-if="entry.parsed">
                <span class="text-[#555d6b]">{{ entry.parsed.time }}</span>
                <span :class="botUsernameColor(entry.parsed.username)"> [{{ entry.parsed.username }}]</span>
                <span :class="categoryColor(entry.parsed.category)">[{{ entry.parsed.category }}] </span>
                <span class="text-space-text"> {{ entry.parsed.message }}</span>
              </template>
              <span v-else class="text-space-text-dim">{{ entry.raw }}</span>
            </div>
            <div v-if="filteredActivityLogs.length === 0" class="text-space-text-dim text-[11px] italic py-1">No entries</div>
          </div>
        </div>

        <!-- Broadcast / Chat -->
        <div class="card flex flex-col overflow-hidden py-2 px-2">
          <div class="flex items-center justify-between pb-1.5 border-b border-space-border shrink-0">
            <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider">Broadcast / Chat</span>
            <span class="text-[11px] text-space-text-dim">{{ botStore.broadcastLogs.length }} msgs</span>
          </div>
          <div ref="broadcastLogRef" class="flex-1 overflow-auto mt-1 pr-0.5 font-mono scrollbar-dark">
            <template v-for="(group, idx) in groupedBroadcastLogs" :key="idx">

              <!-- Market announcement card — keep rich card format (actionable) -->
              <div v-if="group.entry.type === 'market'"
                class="rounded border px-1 py-0.5 my-1 text-[11px]"
                :class="group.entry.titleType === 'shortage'
                  ? 'border-orange-800/50 bg-orange-950/20'
                  : group.entry.titleType === 'surplus'
                    ? 'border-green-800/50 bg-green-950/20'
                    : 'border-space-border bg-[#0d1117f0]'"
              >
                <div class="flex items-center gap-1.5 mb-1.5">
                  <span v-if="group.entry.time" class="text-[#555d6b] shrink-0">{{ group.entry.time }}</span>
                  <span class="font-semibold text-space-yellow">{{ group.entry.sender }}</span>
                  <span
                    class="px-1.5 py-0 rounded text-[11px] font-bold tracking-wide uppercase"
                    :class="group.entry.titleType === 'shortage'
                      ? 'bg-orange-900/60 text-orange-300'
                      : group.entry.titleType === 'surplus'
                        ? 'bg-green-900/60 text-green-300'
                        : 'bg-[#21262d] text-space-text-dim'"
                  >{{ group.entry.title }}</span>
                </div>
                <div v-if="group.entry.items?.length" class="flex flex-wrap gap-1 mb-1">
                  <span
                    v-for="item in group.entry.items" :key="item.name"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#161b22] border border-[#30363d]"
                  >
                    <span class="text-space-text">{{ item.name.replace(/_/g, '\u200b_') }}</span>
                    <span class="text-space-yellow font-semibold">{{ item.price }}cr</span>
                    <span class="text-[11px] font-bold"
                      :class="item.multiplier >= 3 ? 'text-red-400' : item.multiplier >= 2 ? 'text-orange-400' : 'text-yellow-500'"
                    >×{{ item.multiplier }}</span>
                  </span>
                </div>
                <div v-if="group.entry.command" class="text-[11px] text-space-text-dim opacity-60 truncate">
                  ▶ {{ group.entry.command.slice(0, 80) }}{{ group.entry.command.length > 80 ? '…' : '' }}
                </div>
              </div>

              <!-- Uniform two-row format for all other types -->
              <div v-else class="py-0.5 leading-tight">
                <!-- Row 1: TYPE LABEL  TIME  ×N -->
                <div class="flex items-center gap-1.5">
                  <span class="text-[10px] font-semibold uppercase tracking-widest"
                    :class="group.entry.type === 'alert'  ? 'text-red-500'
                           : group.entry.type === 'combat' ? 'text-orange-400'
                           : group.entry.type === 'forum'  ? 'text-purple-400'
                           : group.entry.tag === 'DM'      ? 'text-space-accent'
                           : 'text-space-text-dim'"
                  >
                    {{ group.entry.type === 'simple' || group.entry.type === 'header'
                        ? (group.entry.tag || 'CHAT')
                        : group.entry.type.toUpperCase() }}
                  </span>
                  <span class="text-[#555d6b] text-[11px]">{{ group.entry.time }}</span>
                  <span v-if="group.count > 1"
                    class="text-[10px] px-1 rounded bg-[#21262d] text-space-text-dim font-mono">
                    ×{{ group.count }}
                  </span>
                </div>
                <!-- Row 2: content -->
                <div class="text-[11px] leading-snug">
                  <!-- Bot name tag (for SYS notifications targeting a specific bot) -->
                  <template v-if="group.entry.botName">
                    <span class="text-[10px] px-1 rounded bg-[#21262d] text-space-accent font-mono mr-1">{{ group.entry.botName }}</span>
                  </template>
                  <!-- Alert -->
                  <span v-if="group.entry.type === 'alert'" class="text-red-300">
                    {{ group.entry.message || group.entry.raw }}
                  </span>
                  <!-- Combat -->
                  <span v-else-if="group.entry.type === 'combat'" class="text-orange-200">
                    ⚔ <span class="font-semibold">{{ group.entry.pirate }}</span>
                    <span v-if="group.entry.tier" class="text-red-500/70"> ({{ group.entry.tier }})</span>
                    <span class="text-space-text-dim"> — </span>{{ group.entry.damage }}
                    <span v-if="group.entry.victim"> → <span class="text-yellow-400">{{ group.entry.victim }}</span></span>
                    <span v-if="group.entry.hullStr" class="text-space-text-dim"> | {{ group.entry.hullStr }}</span>
                  </span>
                  <!-- Forum -->
                  <span v-else-if="group.entry.type === 'forum'" class="text-space-text">
                    📌 <span class="font-semibold text-space-yellow">{{ group.entry.author }}</span>
                    <span v-if="group.entry.category" class="text-purple-400/70"> [{{ group.entry.category }}]</span>
                    <span v-if="group.entry.forumTitle">: {{ group.entry.forumTitle }}</span>
                  </span>
                  <!-- Simple / header / content -->
                  <span v-else class="text-space-cyan">{{ group.entry.message || group.entry.raw }}</span>
                </div>
              </div>

            </template>
            <div v-if="groupedBroadcastLogs.length === 0" class="text-space-text-dim text-[11px] italic py-1">No messages</div>
          </div>
        </div>

        <!-- System Messages -->
        <div class="card flex flex-col overflow-hidden py-2 px-2">
          <div class="flex items-center gap-1 pb-1.5 border-b border-space-border shrink-0">
            <span class="text-xs font-semibold text-space-text-dim uppercase tracking-wider flex-1">System Messages</span>
            <select v-model="systemBotFilter" class="input text-[11px] py-0 h-5 pl-1 max-w-[90px]">
              <option value="">All bots</option>
              <option v-for="b in botStore.sortedBots" :key="b.username" :value="b.username">{{ b.username }}</option>
            </select>
            <select v-model="systemCatFilter" class="input text-[11px] py-0 h-5 pl-1 max-w-[70px]">
              <option value="">All</option>
              <option value="error">error</option>
              <option value="system">system</option>
              <option value="warn">warn</option>
            </select>
          </div>
          <div ref="systemLogRef" class="flex-1 overflow-auto mt-1 pr-0.5 font-mono scrollbar-dark space-y-px">
            <div
              v-for="(entry, idx) in filteredSystemLogs"
              :key="idx"
              class="leading-snug text-[11px] whitespace-pre-wrap"
            >
              <template v-if="entry.parsed">
                <span class="text-[#555d6b]">{{ entry.parsed.time }}</span>
                <span :class="botUsernameColor(entry.parsed.username)"> [{{ entry.parsed.username }}]</span>
                <span :class="categoryColor(entry.parsed.category)">[{{ entry.parsed.category }}] </span>
                <span :class="msgColor(entry.parsed.category)"> {{ entry.parsed.message }}</span>
              </template>
              <span v-else :class="plainSystemColor(entry.raw)" class="text-[11px]">{{ entry.raw }}</span>
            </div>
            <div v-if="filteredSystemLogs.length === 0" class="text-space-text-dim text-[11px] italic py-1">No entries</div>
          </div>
        </div>

      </div>
    </div>

    <!-- Chat bar -->
    <div class="flex gap-2 p-4 bg-space-card border-t border-space-border">
      <select v-model="selectedChatBot" class="input text-xs px-2 py-1">
        <option value="">Select Bot</option>
        <option v-for="bot in botStore.sortedBots" :key="bot.username" :value="bot.username">
          {{ bot.username }}
        </option>
      </select>
      <select v-model="chatChannel" class="input text-xs px-2 py-1">
        <option value="system">System</option>
        <option value="local">Local</option>
        <option value="faction">Faction</option>
      </select>
      <input 
        v-model="chatMessage" 
        @keydown.enter="sendChat"
        type="text" 
        placeholder="Type a message..." 
        class="flex-1 input text-xs px-2 py-1"
      />
      <button @click="sendChat" class="btn btn-primary text-xs px-2 py-1">
        Send
      </button>
    </div>

    <!-- Add Bot Modal -->
    <div v-if="showAddBot" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showAddBot = false">
      <div class="bg-space-card border border-space-border rounded-lg p-6 w-96">
        <h3 class="text-lg font-semibold text-space-text-bright mb-4">Add New Bot</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Username</label>
            <input v-model="newBot.username" type="text" class="input w-full" placeholder="Character name" />
          </div>
          <div>
            <label class="block text-xs text-space-text-dim mb-1">Password</label>
            <input v-model="newBot.password" type="password" class="input w-full" />
          </div>
          <div v-if="botStore.vmList.length > 1">
            <label class="block text-xs text-space-text-dim mb-1">Pool / VM</label>
            <select v-model="newBot.vm" class="input w-full">
              <option value="">Local (no VM routing)</option>
              <option v-for="vm in botStore.vmList" :key="vm" :value="vm">
                {{ vm }}
                <template v-if="botStore.vmStatuses[vm]"> — {{ botStore.vmStatuses[vm] }}</template>
              </option>
            </select>
          </div>
        </div>
        <div class="flex gap-2 mt-6">
          <button @click="addBot" class="btn btn-primary flex-1">Add Bot</button>
          <button @click="showAddBot = false" class="btn flex-1">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Start Bot Modal -->
    <div v-if="showStartBot" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click.self="showStartBot = false">
      <div class="bg-space-card border border-space-border rounded-lg p-6 w-[32rem]">
        <h3 class="text-lg font-semibold text-space-text-bright mb-4">
          Start Bot: {{ startBotData.username }}
        </h3>
        <div class="space-y-3">
          <div>
            <label class="block text-xs text-space-text-dim mb-2">Select Routine</label>
            <div class="grid grid-cols-2 gap-2">
              <div 
                v-for="routine in availableRoutines" 
                :key="routine.id"
                @click="startBotData.routine = routine.id"
                class="p-2 border rounded cursor-pointer transition-colors"
                :class="{
                  'border-space-accent bg-space-accent bg-opacity-10': startBotData.routine === routine.id,
                  'border-space-border hover:border-space-accent hover:bg-space-row-hover': startBotData.routine !== routine.id
                }"
              >
                <div class="text-sm font-medium text-space-text-bright mb-1">{{ routine.name }}</div>
                <div class="text-xs text-space-text-dim">{{ routine.description }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-6">
          <button @click="startBot" class="btn btn-primary flex-1">Start Bot</button>
          <button @click="showStartBot = false" class="btn flex-1">Cancel</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useBotStore } from '../stores/botStore';
import { empireIcon, empireName } from '../utils/empires';
import ProgressBar from '../components/ProgressBar.vue';
import {
  useDashboardLogs,
  categoryColor, msgColor, plainSystemColor,
} from '../composables/useDashboardLogs';


// ── Log composable ────────────────────────────────────────────

const {
  activityBotFilter, systemBotFilter, systemCatFilter,
  botUsernameColor, filteredActivityLogs, filteredSystemLogs, parsedBroadcastLogs, groupedBroadcastLogs,
} = useDashboardLogs();

const emit = defineEmits<{
  (e: 'open-profile', username: string): void;
}>();

const botStore = useBotStore();
const showAddBot = ref(false);
const showStartBot = ref(false);
const newBot = ref({ username: '', password: '', vm: '' });
const startBotData = ref({ username: '', routine: 'miner' });
const selectedChatBot = ref('');
const chatChannel = ref('system');
const chatMessage = ref('');

const availableRoutines = computed(() => 
  botStore.routines.map(r => ({ id: r.id, name: r.name, description: '' }))
);

const dashSortCol = ref<string>('name');
const dashSortDir = ref<'asc' | 'desc'>('asc');

function setDashSort(col: string) {
  if (dashSortCol.value === col) dashSortDir.value = dashSortDir.value === 'asc' ? 'desc' : 'asc';
  else { dashSortCol.value = col; dashSortDir.value = col === 'credits' || col === 'cph' ? 'desc' : 'asc'; }
}
function dashSortIndicator(col: string): string {
  if (dashSortCol.value !== col) return '';
  return dashSortDir.value === 'asc' ? '▲' : '▼';
}

const sortedDashBots = computed(() => {
  const dir = dashSortDir.value === 'asc' ? 1 : -1;
  return [...botStore.sortedBots].sort((a, b) => {
    switch (dashSortCol.value) {
      case 'name': return dir * a.username.localeCompare(b.username);
      case 'state': return dir * (a.state || '').localeCompare(b.state || '');
      case 'credits': return dir * ((a.credits || 0) - (b.credits || 0));
      case 'cph': return dir * ((botStore.botCreditsPerHour[a.username] || 0) - (botStore.botCreditsPerHour[b.username] || 0));
      case 'fuel': return dir * (((a.fuel / (a.maxFuel || 1)) - (b.fuel / (b.maxFuel || 1))));
      case 'hull': return dir * (((a.hull / (a.maxHull || 1)) - (b.hull / (b.maxHull || 1))));
      case 'shield': return dir * (((a.shield / (a.maxShield || 1)) - (b.shield / (b.maxShield || 1))));
      case 'cargo': return dir * (((a.cargo / (a.cargoMax || 1)) - (b.cargo / (b.cargoMax || 1))));
      case 'location': return dir * ((a.location || '').localeCompare(b.location || ''));
      default: return 0;
    }
  });
});

// s2: Game server stats — pushed from server via WebSocket every 10s (one game tick)
const gameStats = botStore.gameStats;

const activeBots = computed(() => botStore.bots.filter(b => b.state === 'running').length);
const fleetCredits = computed(() => botStore.bots.reduce((sum, b) => sum + b.credits, 0));
const totalMined = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalMined || 0), 0));
const totalCrafted = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalCrafted || 0), 0));
const totalSystems = computed(() => botStore.bots.reduce((sum, b) => sum + (b.stats?.totalSystems || 0), 0));

function sumStatsField(field: string, days = 0): number {
  let total = 0;
  const cutoff = days > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); })() : null;
  for (const daily of Object.values(botStore.statsDaily)) {
    for (const [date, s] of Object.entries(daily as any)) {
      if (cutoff && date < cutoff) continue;
      total += (s as any)[field] || 0;
    }
  }
  return total;
}

const todayTrades = computed(() => sumStatsField('trades', 1));
const todayProfit = computed(() => sumStatsField('profit', 1));
const avgProfitPerTrade = computed(() => todayTrades.value > 0 ? Math.round(todayProfit.value / todayTrades.value) : 0);

// Log scroll refs
const activityLogRef = ref<HTMLElement | null>(null);
const broadcastLogRef = ref<HTMLElement | null>(null);
const systemLogRef = ref<HTMLElement | null>(null);

watch(() => filteredActivityLogs.value.length, () => nextTick(() => {
  if (activityLogRef.value) activityLogRef.value.scrollTop = activityLogRef.value.scrollHeight;
}));
watch(() => parsedBroadcastLogs.value.length, () => nextTick(() => {
  if (broadcastLogRef.value) broadcastLogRef.value.scrollTop = broadcastLogRef.value.scrollHeight;
}));
watch(() => filteredSystemLogs.value.length, () => nextTick(() => {
  if (systemLogRef.value) systemLogRef.value.scrollTop = systemLogRef.value.scrollHeight;
}));

onMounted(() => nextTick(() => {
  if (activityLogRef.value) activityLogRef.value.scrollTop = activityLogRef.value.scrollHeight;
  if (broadcastLogRef.value) broadcastLogRef.value.scrollTop = broadcastLogRef.value.scrollHeight;
  if (systemLogRef.value) systemLogRef.value.scrollTop = systemLogRef.value.scrollHeight;
}));

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function vmBadgeClass(state: string | undefined) {
  if (state === 'online') return 'text-green-400 border-green-700/50 bg-green-900/20';
  if (state === 'connecting') return 'text-yellow-400 border-yellow-700/50 bg-yellow-900/20';
  return 'text-red-400 border-red-700/50 bg-red-900/20';
}

function selectBot(username: string) {
  emit('open-profile', username);
}

function openStartBotModal(username: string) {
  startBotData.value = { username, routine: 'miner' };
  showStartBot.value = true;
}

async function startBot() {
  if (!startBotData.value.username || !startBotData.value.routine) return;
  
  try {
    await botStore.startBot(startBotData.value.username, startBotData.value.routine);
    showStartBot.value = false;
  } catch (err) {
    console.error('Failed to start bot:', err);
  }
}

function startBotInline(username: string) {
  const sel = document.getElementById(`routine-${username}`) as HTMLSelectElement | null;
  const routine = sel?.value || 'miner';
  botStore.startBot(username, routine);
}

async function stopBot(username: string) {
  botStore.stopBot(username);
}

async function addBot() {
  if (!newBot.value.username || !newBot.value.password) return;
  const vm = newBot.value.vm || undefined;
  
  try {
    botStore.addBot(newBot.value.username, newBot.value.password, vm);
    showAddBot.value = false;
    newBot.value = { username: '', password: '', vm: '' };
  } catch (err) {
    console.error('Failed to add bot:', err);
  }
}

async function sendChat() {
  if (!chatMessage.value || !selectedChatBot.value) return;
  
  try {
    botStore.sendChat(selectedChatBot.value, chatChannel.value, chatMessage.value);
    chatMessage.value = '';
  } catch (err) {
    console.error('Failed to send chat:', err);
  }
}
</script>
