<template>
  <div class="flex-1 overflow-auto scrollbar-dark py-2 px-0 space-y-2">
    <!-- Home Base -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">🏠 Home Base</h3>
      </div>
      <div class="flex items-center gap-3 text-xs">
        <span class="text-space-text-dim">Current:</span>
        <span class="text-space-cyan">{{ homeBase || '(not set)' }}</span>
        <button
          @click="setHomeBase"
          :disabled="!currentBot.docked || settingHome"
          class="btn btn-secondary text-xs px-3 py-1"
          :title="!currentBot.docked ? 'Must be docked to set home base' : 'Set current station as home base'"
        >
          {{ settingHome ? '⏳' : '📍 Set Here' }}
        </button>
        <span v-if="!currentBot.docked" class="text-space-text-dim italic">(dock first)</span>
      </div>
    </div>

    <!-- Insurance Quote / Status -->
    <div class="card py-2 px-3">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs font-semibold text-space-text-dim uppercase">🛡️ Insurance</h3>
        <button @click="loadQuote" :disabled="quoteLoading || !currentBot.docked" class="btn btn-secondary text-xs px-3">
          {{ quoteLoading ? '⏳' : '🔄 Get Quote' }}
        </button>
      </div>

      <div v-if="!currentBot.docked" class="text-xs text-space-text-dim italic py-2">
        Dock at a station to manage insurance.
      </div>

      <!-- Quote result -->
      <div v-else-if="quote" class="space-y-2">
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="flex justify-between px-2 py-1.5 rounded bg-[#161b22]">
            <span class="text-space-text-dim">Coverage</span>
            <span class="text-space-text-bright">{{ formatNumber(quote.coverage || quote.ship_value || 0) }} ₡</span>
          </div>
          <div class="flex justify-between px-2 py-1.5 rounded bg-[#161b22]">
            <span class="text-space-text-dim">Premium</span>
            <span class="text-space-yellow font-medium">{{ formatNumber(quote.cost || quote.premium || quote.price || 0) }} ₡</span>
          </div>
          <div v-if="quote.duration_hours" class="flex justify-between px-2 py-1.5 rounded bg-[#161b22]">
            <span class="text-space-text-dim">Duration</span>
            <span class="text-space-text-bright">{{ quote.duration_hours }}h</span>
          </div>
          <div v-if="quote.deductible" class="flex justify-between px-2 py-1.5 rounded bg-[#161b22]">
            <span class="text-space-text-dim">Deductible</span>
            <span class="text-space-text-bright">{{ formatNumber(quote.deductible) }} ₡</span>
          </div>
          <div v-if="quote.risk_factor" class="flex justify-between px-2 py-1.5 rounded bg-[#161b22]">
            <span class="text-space-text-dim">Risk Factor</span>
            <span :class="Number(quote.risk_factor) > 1.5 ? 'text-space-red' : 'text-space-green'">{{ quote.risk_factor }}×</span>
          </div>
          <div v-if="quote.status" class="flex justify-between px-2 py-1.5 rounded bg-[#161b22]">
            <span class="text-space-text-dim">Status</span>
            <span :class="quote.status === 'active' || quote.status === 'insured' ? 'text-space-green' : 'text-space-text-dim'">
              {{ quote.status }}
            </span>
          </div>
        </div>

        <!-- Extra quote fields -->
        <div v-if="quoteExtras.length > 0" class="text-xs text-space-text-dim space-y-0.5">
          <div v-for="[k, v] in quoteExtras" :key="k" class="flex justify-between px-2 py-1 rounded bg-[#0d1117]">
            <span>{{ formatKey(k) }}</span>
            <span class="text-space-text">{{ v }}</span>
          </div>
        </div>

        <div class="flex gap-2 pt-1">
          <button
            @click="buyInsurance"
            :disabled="buying || isAlreadyInsured"
            class="btn btn-primary text-xs px-4 py-1.5"
            :title="isAlreadyInsured ? 'Already insured' : ''"
          >
            {{ buying ? '⏳ Purchasing…' : isAlreadyInsured ? '✅ Already Insured' : '🛒 Buy Insurance' }}
          </button>
          <button
            @click="claimInsurance"
            :disabled="claiming"
            class="btn text-xs px-4 py-1.5 bg-orange-900/40 text-orange-300 border-orange-700/40 hover:bg-orange-900/70"
            title="Claim insurance payout (use after ship destruction)"
          >
            {{ claiming ? '⏳ Claiming…' : '💰 Claim Payout' }}
          </button>
        </div>
      </div>

      <!-- No quote loaded yet -->
      <div v-else class="text-xs text-space-text-dim italic py-2">
        Click "Get Quote" to check insurance options at this station.
      </div>
    </div>

    <!-- Active Policies (if returned by API) -->
    <div v-if="policies.length > 0" class="card py-2 px-3">
      <h4 class="text-xs font-semibold text-space-text-dim uppercase mb-2">📋 Active Policies</h4>
      <div class="space-y-1.5">
        <div v-for="policy in policies" :key="policy.id || policy.policy_id"
          class="flex items-center justify-between px-2 py-2 rounded bg-[#161b22] border border-space-border text-xs">
          <div>
            <div class="text-space-text-bright">{{ policy.ship_name || policy.ship || policy.id || 'Policy' }}</div>
            <div class="text-space-text-dim mt-0.5">
              Coverage: {{ formatNumber(policy.coverage || policy.ship_value || 0) }} ₡
              <span v-if="policy.expires_at"> · Expires: {{ formatDate(policy.expires_at) }}</span>
            </div>
          </div>
          <span :class="policy.status === 'active' ? 'text-space-green' : 'text-space-text-dim'" class="text-[11px]">
            {{ policy.status || 'active' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useBotStore } from '../stores/botStore';

interface Props { bot: any; }
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();

const quoteLoading = ref(false);
const buying = ref(false);
const claiming = ref(false);
const settingHome = ref(false);
const quote = ref<Record<string, unknown> | null>(null);
const policies = ref<any[]>([]);

const currentBot = computed(() => botStore.bots.find(b => b.username === props.bot.username) || props.bot);
const homeBase = computed(() => (currentBot.value as any).home_base || (currentBot.value as any).homeBase || '');

const isAlreadyInsured = computed(() => {
  if (!quote.value) return false;
  const s = (quote.value.status as string || '').toLowerCase();
  return s === 'active' || s === 'insured' || s.includes('insured');
});

const QUOTE_KNOWN_KEYS = new Set(['coverage', 'cost', 'premium', 'price', 'duration_hours', 'deductible', 'risk_factor', 'status', 'ship_value']);
const quoteExtras = computed(() => {
  if (!quote.value) return [];
  return Object.entries(quote.value).filter(([k]) => !QUOTE_KNOWN_KEYS.has(k) && !['error', 'ok', 'id'].includes(k));
});

function execCmd(command: string, params?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise(resolve => {
    botStore.sendExec(props.bot.username, command, params || {}, (r: any) => resolve(r));
  });
}

async function loadQuote() {
  quoteLoading.value = true;
  const r = await execCmd('get_insurance_quote');
  quoteLoading.value = false;
  if (r.ok && r.data) {
    const d = r.data as any;
    quote.value = typeof d === 'object' && !Array.isArray(d) ? d : { raw: d };
    // Also check for policies array in the response
    if (Array.isArray(d.policies)) policies.value = d.policies;
    else if (Array.isArray(d)) policies.value = d;
  } else {
    emit('notif', r.error || 'Failed to get insurance quote', 'error');
  }
}

async function buyInsurance() {
  buying.value = true;
  const r = await execCmd('buy_insurance');
  buying.value = false;
  if (r.ok) {
    emit('notif', 'Insurance purchased ✅', 'success');
    await loadQuote();
  } else {
    emit('notif', r.error || 'Failed to buy insurance', 'error');
  }
}

async function claimInsurance() {
  claiming.value = true;
  const r = await execCmd('claim_insurance');
  claiming.value = false;
  if (r.ok) {
    const payout = (r.data as any)?.payout || (r.data as any)?.credits || 0;
    emit('notif', payout > 0 ? `Insurance payout: ${payout.toLocaleString()} ₡` : 'Insurance claimed', 'success');
  } else {
    emit('notif', r.error || 'Claim failed', 'error');
  }
}

async function setHomeBase() {
  settingHome.value = true;
  const r = await execCmd('set_home_base');
  settingHome.value = false;
  emit('notif', r.ok ? '🏠 Home base set to current station' : (r.error || 'Failed to set home base'), r.ok ? 'success' : 'error');
}

function formatNumber(n: unknown): string {
  return Number(n || 0).toLocaleString();
}

function formatKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(ts: string | number): string {
  try {
    return new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts).toLocaleString();
  } catch { return String(ts); }
}
</script>
