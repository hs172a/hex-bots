<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <div v-if="!currentBot.docked" class="flex items-center justify-center h-32 text-center">
      <div><div class="text-3xl mb-2">🚀</div><div class="text-space-text-dim text-sm">Dock at a station to manage ship modules</div></div>
    </div>
    <template v-else>
      <!-- Ship Stats + Modules side by side -->
      <div class="flex gap-2 items-start">
        <!-- Ship Stats -->
        <div class="card py-2 px-2 flex-1 min-w-0">
          <div class="flex items-center justify-between border-b border-space-border pb-1 mb-2">
            <h3 class="text-xs font-semibold text-space-text-dim uppercase">🛸 Ship</h3>
            <button @click="loadShipData()" :disabled="shipActionLoading" class="btn btn-secondary text-xs py-0 px-2">🔄</button>
          </div>
          <div v-if="!shipInfo" class="text-center py-3">
            <button @click="loadShipData()" class="btn btn-primary text-xs px-4">Load</button>
          </div>
          <div v-else class="space-y-1.5 text-xs">
            <div>
              <div class="flex justify-between mb-0.5"><span class="text-space-text-dim">🖥️ CPU</span><span class="text-space-text">{{ shipInfo.cpu_used ?? 0 }} / {{ shipInfo.cpu_capacity ?? 0 }}</span></div>
              <div class="w-full bg-[#21262d] rounded-full h-1.5"><div class="h-full bg-green-500 rounded-full" :style="{ width: shipCpuPercent + '%' }"></div></div>
            </div>
            <div>
              <div class="flex justify-between mb-0.5"><span class="text-space-text-dim">⚡ Power</span><span class="text-space-text">{{ shipInfo.power_used ?? 0 }} / {{ shipInfo.power_capacity ?? 0 }}</span></div>
              <div class="w-full bg-[#21262d] rounded-full h-1.5"><div class="h-full bg-yellow-500 rounded-full" :style="{ width: shipPowerPercent + '%' }"></div></div>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] pt-0.5">
              <span class="text-space-text-dim">⚔️ Weapons: <span class="text-space-text">{{ shipInfo.weapon_slots ?? '?' }}</span></span>
              <span class="text-space-text-dim">🛡️ Defense: <span class="text-space-text">{{ shipInfo.defense_slots ?? '?' }}</span></span>
              <span class="text-space-text-dim">🔧 Utility: <span class="text-space-text">{{ shipInfo.utility_slots ?? '?' }}</span></span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] pt-0.5 border-t border-[#21262d]">
              <span v-if="shipInfo.armor != null" class="text-space-text-dim">🛡️ Armor: <span class="text-space-text">{{ shipInfo.armor }}</span></span>
              <span v-if="shipInfo.shield_recharge != null" class="text-space-text-dim">🔋 Shield: <span class="text-space-text">{{ shipInfo.shield_recharge }}/tick</span></span>
              <span v-if="shipInfo.speed != null" class="text-space-text-dim">💨 Speed: <span class="text-space-text">{{ shipInfo.speed }} AU/tick</span></span>
            </div>
            <div v-if="shipInfo.class_id" @mouseenter="onShipClassHover($event)" @mouseleave="shipTooltipVisible = false">
              <span class="text-space-text-dim text-[11px] cursor-help">🚀 Class: <span class="text-space-accent underline decoration-dotted">{{ shipInfo.class_id }}</span></span>
            </div>
          </div>
        </div>

        <!-- Installed Modules -->
        <div class="card py-2 px-2 flex-1 min-w-0">
          <h3 class="text-xs font-semibold text-space-text-dim uppercase border-b border-space-border pb-1 mb-2">⚙️ Installed Modules</h3>
          <div v-if="installedModules.length === 0" class="text-xs text-space-text-dim text-center py-2">{{ shipInfo ? 'No modules installed' : 'Load ship data first' }}</div>
          <div v-else class="space-y-1.5 max-h-56 overflow-auto scrollbar-dark">
            <div v-for="mod in installedModules" :key="mod.module_id || mod.id || mod.name" class="bg-[#21262d] rounded p-1.5">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="text-sm">{{ moduleTypeIcon(mod.type || mod.slot_type) }}</span>
                    <span class="text-xs text-space-text-bright truncate">{{ mod.name || mod.module_id || mod.id }}</span>
                  </div>
                  <div class="flex flex-wrap gap-x-2.5 gap-y-0 mt-1 text-[11px]">
                    <span v-if="mod.quality_grade" class="text-yellow-400">⭐ {{ mod.quality_grade }}</span>
                    <span v-if="mod.wear_status" :class="wearColor(mod.wear)">{{ mod.wear_status }}{{ mod.wear > 0 ? ` (${mod.wear}%)` : '' }}</span>
                    <span v-if="mod.cpu_usage != null" class="text-green-400">CPU: {{ mod.cpu_usage }}</span>
                    <span v-if="mod.power_usage != null" class="text-yellow-400">PWR: {{ mod.power_usage }}</span>
                    <span v-if="mod.mining_power != null" class="text-amber-400">⛏️ {{ mod.mining_power }} pwr</span>
                    <span v-if="mod.mining_range != null" class="text-amber-400">📡 {{ mod.mining_range }} rng</span>
                    <span v-if="mod.damage != null" class="text-red-400">💥 {{ mod.damage }} dmg</span>
                    <span v-if="mod.damage_type" class="text-red-300">{{ mod.damage_type }}</span>
                    <span v-if="mod.shield_bonus != null && mod.shield_bonus !== 0" class="text-blue-400">🛡️ +{{ mod.shield_bonus }}</span>
                    <span v-if="mod.hull_bonus != null && mod.hull_bonus !== 0" class="text-emerald-400">❤️ +{{ mod.hull_bonus }}</span>
                    <span v-if="mod.armor_bonus != null && mod.armor_bonus !== 0" class="text-slate-400">🔩 +{{ mod.armor_bonus }}</span>
                    <span v-if="mod.speed_bonus != null && mod.speed_bonus !== 0" :class="mod.speed_bonus > 0 ? 'text-cyan-400' : 'text-orange-300'">💨 {{ mod.speed_bonus > 0 ? '+' : '' }}{{ mod.speed_bonus }}</span>
                    <span v-if="mod.cargo_bonus != null && mod.cargo_bonus !== 0" class="text-amber-400">📦 +{{ mod.cargo_bonus }}</span>
                    <span v-if="mod.ammo_type" class="text-orange-400">🎯 {{ mod.ammo_type }}</span>
                  </div>
                </div>
                <button @click="uninstallModule(mod.module_id || mod.id)" :disabled="shipActionLoading" class="ml-1 text-xs px-2 py-0.5 bg-red-600/40 hover:bg-red-600 rounded transition-colors disabled:opacity-50 shrink-0">Remove</button>
              </div>
            </div>
          </div>
        </div>
      </div><!-- /side-by-side row -->

      <!-- Reload Weapon -->
      <div class="card py-2 px-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase border-b border-space-border pb-1 mb-2">🔄 Reload Weapon</h3>
        <div class="flex gap-2 items-center">
          <select v-model="reloadWeapon" class="input text-xs flex-1 !p-1">
            <option value="">{{ weaponModules.length > 0 ? 'Select weapon...' : 'No weapons installed' }}</option>
            <option v-for="wep in weaponModules" :key="wep.module_id || wep.id" :value="wep.module_id || wep.id">
              {{ wep.name || wep.type_id || 'Weapon' }} ({{ wep.current_ammo ?? 0 }}/{{ wep.magazine_size ?? '?' }})
            </option>
          </select>
          <select v-model="reloadAmmo" class="input text-xs w-56 !p-1">
            <option value="">{{ ammoItems.length > 0 ? 'Select ammo...' : 'No ammo in cargo' }}</option>
            <option v-for="ammo in ammoItems" :key="ammo.itemId" :value="ammo.itemId">
              {{ ammo.name }} ({{ ammo.quantity }})
            </option>
          </select>
          <button @click="execReload" :disabled="!reloadWeapon || !reloadAmmo || shipActionLoading" class="btn text-xs px-3 py-1 disabled:opacity-50">🔄 Reload</button>
        </div>
      </div>

      <!-- Install from Cargo -->
      <div class="card py-2 px-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase border-b border-space-border pb-1 mb-2">📦 Install from Cargo</h3>
        <div v-if="inventory.length === 0" class="text-xs text-space-text-dim text-center py-2">Cargo is empty</div>
        <div v-else class="space-y-1 max-h-36 overflow-auto scrollbar-dark">
          <div v-for="item in inventory" :key="item.itemId" class="flex items-center justify-between bg-[#21262d] rounded py-0.5 px-2">
            <div class="min-w-0 flex-1"><div class="text-[11px] text-space-text-bright truncate">{{ item.name }}</div><div class="text-[11px] text-space-text-dim">x{{ item.quantity }}</div></div>
            <button @click="installModule(item.itemId)" :disabled="shipActionLoading" class="ml-2 text-xs px-2 py-0.5 bg-green-600/40 hover:bg-green-600 rounded transition-colors disabled:opacity-50 shrink-0">Install</button>
          </div>
        </div>
      </div>

      <!-- Rename Ship (v0.200) -->
      <div class="card py-2 px-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase border-b border-space-border pb-1 mb-2">✏️ Rename Ship</h3>
        <div class="flex gap-2 items-center">
          <input v-model="renameShipName" type="text" maxlength="32" placeholder="New name (3–32 chars, globally unique)…" class="input text-xs flex-1 !p-1" />
          <button @click="doRenameShip" :disabled="renameSaving || renameShipName.trim().length < 3" class="btn btn-primary text-xs px-3 py-1 shrink-0">{{ renameSaving ? '⏳' : '✏️ Save' }}</button>
        </div>
        <div class="text-[11px] text-space-text-dim mt-1">Send empty name to clear. Names are globally unique and visible to other players.</div>
      </div>

      <!-- Buy from Market -->
      <div class="card py-2 px-2">
        <div class="flex items-center justify-between border-b border-space-border pb-1 mb-2">
          <h3 class="text-xs font-semibold text-space-text-dim uppercase">🛒 Station Shop</h3>
          <div class="flex gap-1.5 items-center">
            <select v-model="shopFilter" class="input text-[11px] py-0 h-6">
              <option value="all">All items</option>
              <option value="module">Modules</option>
              <option value="consumable">Consumables</option>
              <option value="component">Components</option>
              <option value="ore">Ores</option>
              <option value="refined">Refined</option>
              <option value="">Others</option>
            </select>
            <button @click="refreshMarket()" :disabled="shipActionLoading" class="btn btn-secondary text-xs py-0 px-2">🔄</button>
          </div>
        </div>
        <div v-if="filteredShopItems.length === 0" class="text-xs text-space-text-dim text-center py-2">No items. Click 🔄 to load market.</div>
        <div v-else class="space-y-1 max-h-72 overflow-auto scrollbar-dark">
          <div
            v-for="item in filteredShopItems"
            :key="item.item_id"
            class="rounded p-0.5"
            :class="item.sell_quantity > 0 ? 'bg-[#1a2535] border border-blue-900/40' : 'bg-[#21262d]'"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm flex-shrink-0">{{ shopCatIcon(item.category) }}</span>
                  <span class="text-xs text-space-text-bright truncate">{{ item.item_name || item.name }}</span>
                </div>
                <div class="flex flex-wrap gap-x-2.5 gap-y-0 mt-0.5 text-[11px] text-space-text-dim">
                  <span v-if="item.sell_quantity > 0" class="text-green-400">📦 {{ item.sell_quantity.toLocaleString() }} in stock</span>
                  <span v-if="item.buy_quantity > 0" class="text-blue-400">🏷️ Station buys: {{ item.buy_price?.toLocaleString() }}₡ ×{{ item.buy_quantity.toLocaleString() }}</span>
                  <span v-if="item.spread > 0" class="text-purple-400">📈 Spread: {{ item.spread.toLocaleString() }}₡</span>
                </div>
              </div>
              <div class="flex flex-col items-end gap-1 shrink-0">
                <div v-if="item.sell_price > 0" class="flex items-center gap-1">
                  <span class="text-xs text-space-yellow font-semibold">{{ item.sell_price.toLocaleString() }}₡</span>
                  <input
                    :value="shopQty[item.item_id] ?? 1"
                    @input="shopQty[item.item_id] = Math.max(1, parseInt(($event.target as HTMLInputElement).value) || 1)"
                    type="number" min="1" :max="item.sell_quantity || 9999"
                    class="input text-xs w-14 !p-0.5 scrollbar-dark text-center"
                  />
                  <button @click="buyModuleItem(item.item_id, shopQty[item.item_id] ?? 1)" :disabled="shipActionLoading || item.sell_quantity <= 0" class="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50">Buy</button>
                </div>
                <div v-else class="text-[11px] text-space-text-dim italic">no sell orders</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Ship class tooltip -->
    <Teleport to="body">
      <div v-if="shipTooltipVisible && shipInfo?.class_id"
        class="fixed z-[9999] w-86 bg-[#0d1117f0] border border-space-border rounded-lg shadow-2xl overflow-hidden pointer-events-none"
        :style="{ top: shipTooltipPos.y + 'px', left: shipTooltipPos.x + 'px' }">
        <img v-if="shipCatalogEntry" :src="shipImageUrl(shipInfo?.class_id || '')" :alt="shipCatalogEntry.name" class="w-full h-28 object-cover" @error="($event.target as HTMLImageElement).style.display='none'" />
        <div class="p-2.5 space-y-2">
          <div class="flex justify-between items-start">
            <div>
              <div class="text-xs font-semibold text-space-text-bright">{{ shipCatalogEntry?.name || shipInfo?.class_id }}</div>
              <div v-if="shipCatalogEntry" class="text-[11px] text-space-text-dim">{{ shipCatalogEntry.empire_name }} · Tier {{ shipCatalogEntry.tier }} · Scale {{ shipCatalogEntry.scale }}</div>
            </div>
            <div v-if="shipCatalogEntry" class="text-space-yellow text-xs font-semibold shrink-0">{{ shipCatalogEntry.price?.toLocaleString() }} cr</div>
          </div>
          <div v-if="shipCatalogEntry?.description" class="text-[11px] text-space-text-dim leading-relaxed line-clamp-2">{{ shipCatalogEntry.description }}</div>
          <div class="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px] pt-1 border-t border-[#21262d]">
            <div class="text-space-text-dim">❤️ Hull <span class="text-space-text">{{ shipCatalogEntry?.base_hull ?? shipInfo?.hull ?? '?' }}</span></div>
            <div class="text-space-text-dim">🔵 Shield <span class="text-space-text">{{ shipCatalogEntry?.base_shield ?? '?' }}</span></div>
            <div class="text-space-text-dim">💨 Speed <span class="text-space-text">{{ shipCatalogEntry?.base_speed ?? shipInfo?.speed ?? '?' }}</span></div>
            <div class="text-space-text-dim">⛽ Fuel <span class="text-space-text">{{ shipCatalogEntry?.base_fuel ?? '?' }}</span></div>
            <div class="text-space-text-dim">📦 Cargo <span class="text-space-text">{{ shipCatalogEntry?.cargo_capacity ?? '?' }}</span></div>
            <div class="text-space-text-dim">🖥️ CPU <span class="text-space-text">{{ shipCatalogEntry?.cpu_capacity ?? '?' }}</span></div>
            <div class="text-space-text-dim">⚔️ <span class="text-space-text">{{ shipCatalogEntry?.weapon_slots ?? shipInfo?.weapon_slots ?? '?' }} wpn</span></div>
            <div class="text-space-text-dim">🛡️ <span class="text-space-text">{{ shipCatalogEntry?.defense_slots ?? shipInfo?.defense_slots ?? '?' }} def</span></div>
            <div class="text-space-text-dim">🔧 <span class="text-space-text">{{ shipCatalogEntry?.utility_slots ?? shipInfo?.utility_slots ?? '?' }} util</span></div>
          </div>
          <div v-if="shipCatalogEntry?.flavor_tags?.length" class="flex flex-wrap gap-1 pt-1 border-t border-[#21262d]">
            <span v-for="tag in shipCatalogEntry.flavor_tags" :key="tag" class="px-1.5 py-0.5 rounded bg-[#21262d] text-space-text-dim text-[11px]">{{ tag }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useBotStore } from '../stores/botStore';

const props = defineProps<{ bot: any }>();
const emit = defineEmits<{
  (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void;
  (e: 'refresh'): void;
}>();

const botStore = useBotStore();

const shipInfo = ref<any>(null);
const shipActionLoading = ref(false);
const shopFilter = ref('all');
const marketItems = ref<any[]>([]);
const shipTooltipVisible = ref(false);
const shipTooltipPos = ref({ x: 0, y: 0 });
const reloadWeapon = ref('');
const reloadAmmo = ref('');
const shopQty = ref<Record<string, number>>({});
const renameShipName = ref('');
const renameSaving = ref(false);

const currentBot = computed(() => {
  const bot = botStore.bots.find(b => b.username === props.bot.username);
  return bot || props.bot;
});

const inventory = computed(() => currentBot.value.inventory || []);

const installedModules = computed(() => {
  if (!shipInfo.value) return [];
  const mods = shipInfo.value.modules || shipInfo.value.installed_modules || [];
  if (Array.isArray(mods)) return mods;
  return Object.values(mods as Record<string, unknown>);
});

const filteredShopItems = computed(() => {
  if (!marketItems.value.length) return [];
  const items = shopFilter.value === 'all'
    ? [...marketItems.value]
    : marketItems.value.filter((item: any) =>
        (item.category || '').toLowerCase() === shopFilter.value
      );
  return items.sort((a: any, b: any) => {
    const aStock = (a.sell_quantity || 0) > 0 ? 1 : 0;
    const bStock = (b.sell_quantity || 0) > 0 ? 1 : 0;
    if (aStock !== bStock) return bStock - aStock;
    return (b.sell_price || 0) - (a.sell_price || 0);
  });
});

const shipCpuPercent = computed(() => {
  if (!shipInfo.value) return 0;
  const cap = shipInfo.value.cpu_capacity || 1;
  return Math.min(100, Math.round(((shipInfo.value.cpu_used ?? 0) / cap) * 100));
});

const shipPowerPercent = computed(() => {
  if (!shipInfo.value) return 0;
  const cap = shipInfo.value.power_capacity || 1;
  return Math.min(100, Math.round(((shipInfo.value.power_used ?? 0) / cap) * 100));
});

const shipCatalogEntry = computed(() => {
  const id = shipInfo.value?.class_id;
  if (!id) return null;
  if (!botStore.publicShips?.length) return null;
  return botStore.publicShips.find(
    (s: any) => s.id === id || s.class === id || s.ship_class === id
  ) || null;
});

const weaponModules = computed(() => {
  return installedModules.value.filter((m: any) => m.ammo_type || m.slot_type === 'weapon' || (m.damage != null && m.damage > 0));
});

const ammoItems = computed(() => {
  return inventory.value.filter((i: any) => {
    const id = (i.itemId || '').toLowerCase();
    const name = (i.name || '').toLowerCase();
    return id.includes('ammo') || id.includes('rounds') || id.includes('_pack') ||
           id.includes('_charge') || id.includes('torpedo') || id.includes('missile') ||
           id.includes('_cell') || id.includes('_core') || name.includes('ammo') ||
           name.includes('rounds') || name.includes('charges') || name.includes('munition');
  });
});

function refreshMarket() {
  const params = shopFilter.value && shopFilter.value !== 'all' ? { category: shopFilter.value } : undefined;
  execCommand('view_market', params);
}

function execCommand(command: string, params?: any) {
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  botStore.logs.push({ bot: username, type: 'info', message: `Executing: ${command}${params ? ' ' + JSON.stringify(params) : ''}` });
  botStore.sendExec(username, command, params, (result: any) => {
    if (result.ok) {
      botStore.logs.push({ bot: username, type: 'success', message: `${command}: OK` });
      processExecResult(command, result.data);
    } else {
      const errMsg = result.error || 'Unknown error';
      botStore.logs.push({ bot: username, type: 'error', message: `${command}: ${errMsg}` });
      emit('notif', errMsg, 'error');
      if (command === 'install_mod' || command === 'uninstall_mod') shipActionLoading.value = false;
    }
  });
}

function processExecResult(command: string, data: any) {
  if (!data) return;
  switch (command) {
    case 'get_status': {
      if (data.ship) shipInfo.value = { ...data.ship, modules: data.modules || [] };
      shipActionLoading.value = false;
      break;
    }
    case 'view_market': {
      const raw: any[] = data.items || data.summary || data.market || data.listings || (Array.isArray(data) ? data : []);
      // Normalize compact summary fields (best_buy/best_sell) → sell_price/buy_price
      marketItems.value = raw.map((i: any) => ({
        ...i,
        sell_price: i.sell_price ?? i.best_buy ?? 0,
        buy_price:  i.buy_price  ?? i.best_sell ?? 0,
        sell_quantity: i.sell_quantity ?? i.quantity ?? 0,
        buy_quantity:  i.buy_quantity  ?? i.quantity ?? 0,
      }));
      break;
    }
    case 'install_mod':
    case 'uninstall_mod': {
      shipActionLoading.value = false;
      if (data?.message) emit('notif', data.message, command === 'install_mod' ? 'success' : 'warn');
      loadShipData();
      emit('refresh'); // cargo changed (item added/removed) — refresh Status+Cargo panels
      break;
    }
    case 'buy': {
      emit('refresh'); // cargo changed after purchase
      break;
    }
    case 'reload': {
      shipActionLoading.value = false;
      emit('refresh'); // ammo loaded, cargo counts changed
      break;
    }
  }
}

function loadShipData() {
  shipActionLoading.value = true;
  execCommand('get_status');
}

function installModule(moduleId: string) {
  if (!moduleId || shipActionLoading.value) return;
  shipActionLoading.value = true;
  execCommand('install_mod', { module_id: moduleId });
}

function uninstallModule(moduleId: string) {
  if (!moduleId || shipActionLoading.value) return;
  shipActionLoading.value = true;
  execCommand('uninstall_mod', { module_id: moduleId });
}

function doRenameShip() {
  const name = renameShipName.value.trim();
  const username = currentBot.value?.username || props.bot.username;
  if (!username) return;
  renameSaving.value = true;
  botStore.sendExec(username, 'rename_ship', { name }, (result: any) => {
    renameSaving.value = false;
    if (result.ok) {
      emit('notif', name ? `Ship renamed to "${name}"` : 'Ship name cleared', 'success');
      renameShipName.value = '';
      emit('refresh');
    } else {
      emit('notif', result.error || 'Rename failed', 'error');
    }
  });
}

function execReload() {
  if (!reloadWeapon.value || !reloadAmmo.value) return;
  shipActionLoading.value = true;
  execCommand('reload', { weapon_instance_id: reloadWeapon.value, ammo_item_id: reloadAmmo.value });
  setTimeout(() => { shipActionLoading.value = false; }, 3000);
}

function buyModuleItem(itemId: string, quantity: number) {
  if (!itemId || shipActionLoading.value) return;
  execCommand('buy', { item_id: itemId, quantity });
}

function onShipClassHover(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  shipTooltipPos.value = {
    x: Math.min(rect.left, window.innerWidth - 300),
    y: rect.bottom + 6,
  };
  shipTooltipVisible.value = true;
}

function moduleTypeIcon(type: string): string {
  switch ((type || '').toLowerCase()) {
    case 'mining':  return '⛏️';
    case 'defense': return '🛡️';
    case 'weapon':  return '⚔️';
    case 'utility': return '🔧';
    case 'engine':  return '🚀';
    default:        return '📦';
  }
}

function wearColor(wear: number): string {
  if (!wear || wear <= 0) return 'text-green-400';
  if (wear < 30) return 'text-yellow-400';
  if (wear < 70) return 'text-orange-400';
  return 'text-red-400';
}

function shopCatIcon(category: string): string {
  switch ((category || '').toLowerCase()) {
    case 'module':     return '🔫';
    case 'consumable': return '💊';
    case 'component':  return '🔩';
    case 'ore':        return '⛏️';
    case 'refined':    return '🔨';
    default:           return '📦';
  }
}

function shipImageUrl(classId: string): string {
  return `/ships/${classId}.webp`;
}

onMounted(() => {
  if (currentBot.value.docked) {
    loadShipData();
    execCommand('view_market');
  }
});
</script>
