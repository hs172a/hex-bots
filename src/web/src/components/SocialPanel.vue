<template>
  <div class="flex-1 flex flex-col overflow-hidden p-3 gap-3">

    <!-- Sub-tabs -->
    <div class="flex gap-1 border-b border-space-border pb-2 shrink-0">
      <button v-for="t in tabs" :key="t.id" @click="tab = t.id"
        class="px-3 py-1 text-xs rounded transition-colors"
        :class="tab === t.id ? 'bg-space-accent text-white' : 'text-space-text-dim hover:text-space-text hover:bg-space-row-hover'">
        {{ t.label }}
      </button>
    </div>

    <!-- ── Pending Trades ── -->
    <div v-if="tab === 'trades'" class="flex-1 flex flex-col gap-2 overflow-hidden">
      <div class="flex items-center gap-2">
        <button @click="loadTrades" :disabled="loading" class="btn btn-secondary text-xs px-3">{{ loading ? '⏳' : '🔄' }} Refresh</button>
        <span class="text-xs text-space-text-dim ml-auto">{{ trades.length }} pending</span>
      </div>
      <div v-if="trades.length === 0 && !loading" class="text-xs text-space-text-dim text-center py-8">No pending trade offers</div>
      <div class="flex-1 overflow-auto space-y-2">
        <div v-for="tr in trades" :key="tr.trade_id" class="p-3 rounded bg-[#0d1117f0] border border-space-border">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs px-1.5 py-0.5 rounded" :class="tr.direction === 'incoming' ? 'bg-blue-900 text-blue-300' : 'bg-orange-900 text-orange-300'">
                  {{ tr.direction === 'incoming' ? '📥 Incoming' : '📤 Outgoing' }}
                </span>
                <span class="text-xs text-space-text-dim">{{ tr.direction === 'incoming' ? `from ${tr.from_name || tr.from_id}` : `to ${tr.to_name || tr.to_id}` }}</span>
              </div>
              <div v-if="tr.credits" class="text-xs text-space-text">💰 {{ fmtCredits(tr.credits) }} credits</div>
              <div v-if="tr.items && Object.keys(tr.items).length" class="text-xs text-space-text">
                📦 {{ Object.entries(tr.items).map(([k,v]) => `${v}x ${k}`).join(', ') }}
              </div>
              <div v-if="tr.message" class="text-xs text-space-text-dim mt-1 italic">"{{ tr.message }}"</div>
            </div>
            <div v-if="tr.direction === 'incoming'" class="flex flex-col gap-1 shrink-0">
              <button @click="acceptTrade(tr.trade_id)" :disabled="!bot.docked || acting === tr.trade_id" class="btn btn-primary text-xs px-2 py-0.5">
                {{ acting === tr.trade_id ? '⏳' : '✓ Accept' }}
              </button>
              <button @click="declineTrade(tr.trade_id)" :disabled="acting === tr.trade_id" class="btn btn-secondary text-xs px-2 py-0.5">✗ Decline</button>
            </div>
            <div v-else class="flex flex-col gap-1 shrink-0">
              <button @click="cancelTrade(tr.trade_id)" :disabled="acting === tr.trade_id" class="btn btn-secondary text-xs px-2 py-0.5">
                {{ acting === tr.trade_id ? '⏳' : '✗ Cancel' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── New Trade Offer ── -->
    <div v-else-if="tab === 'offer'" class="flex-1 overflow-auto">
      <div class="p-3 rounded bg-[#0d1117f0] border border-space-border space-y-3">
        <div class="text-xs font-semibold text-space-text">New Trade Offer</div>
        <div v-if="!bot.docked" class="text-xs text-yellow-500">⚠️ Both players must be docked at the same POI to trade.</div>

        <div class="space-y-2">
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Target player (username or ID)</label>
            <input v-model="offerTarget" placeholder="PlayerName" class="input text-xs w-full" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Credits to offer</label>
            <input v-model.number="offerCredits" type="number" min="0" placeholder="0" class="input text-xs w-40" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Items (item_id: quantity, one per line)</label>
            <textarea v-model="offerItemsText" rows="4" placeholder="iron_ore: 50&#10;fuel_cell: 5" class="input text-xs w-full resize-y font-mono"></textarea>
          </div>
          <button @click="sendOffer" :disabled="!offerTarget.trim() || acting === 'offer'" class="btn btn-primary text-xs px-4">
            {{ acting === 'offer' ? '⏳ Sending…' : '📨 Send Offer' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Send Gift ── -->
    <div v-else-if="tab === 'gift'" class="flex-1 overflow-auto">
      <div class="p-3 rounded bg-[#0d1117f0] border border-space-border space-y-3">
        <div class="text-xs font-semibold text-space-text">Send Gift</div>
        <p class="text-xs text-space-text-dim">Transfer credits or items to another player's storage at this station. They don't need to be online.</p>
        <div v-if="!bot.docked" class="text-xs text-yellow-500">⚠️ Must be docked at a station with storage service.</div>

        <div class="space-y-2">
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Recipient (username or ID)</label>
            <input v-model="giftTarget" placeholder="PlayerName" class="input text-xs w-full" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Credits</label>
            <input v-model.number="giftCredits" type="number" min="0" placeholder="0" class="input text-xs w-40" />
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Item (optional)</label>
            <div class="flex gap-2">
              <input v-model="giftItemId" placeholder="item_id (e.g. iron_ore)" class="input text-xs flex-1" />
              <input v-model.number="giftQty" type="number" min="1" placeholder="qty" class="input text-xs w-20" />
            </div>
          </div>
          <div>
            <label class="text-xs text-space-text-dim block mb-1">Message (optional)</label>
            <input v-model="giftMessage" placeholder="For you!" class="input text-xs w-full" />
          </div>
          <button @click="sendGift" :disabled="!giftTarget.trim() || (!giftCredits && !giftItemId.trim()) || acting === 'gift'" class="btn btn-primary text-xs px-4">
            {{ acting === 'gift' ? '⏳ Sending…' : '🎁 Send Gift' }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useBotStore } from '../stores/botStore';

const props = defineProps<{ bot: { username: string; docked: boolean } }>();
const emit = defineEmits<{ (e: 'notif', text: string, type: 'success' | 'warn' | 'error'): void }>();

const botStore = useBotStore();

type SocialTab = 'trades' | 'offer' | 'gift';
const tabs: { id: SocialTab; label: string }[] = [
  { id: 'trades', label: '🔄 Pending Trades' },
  { id: 'offer', label: '📨 New Offer' },
  { id: 'gift', label: '🎁 Send Gift' },
];
const tab = ref<SocialTab>('trades');

interface TradeEntry {
  trade_id: string;
  direction: 'incoming' | 'outgoing';
  from_id?: string;
  from_name?: string;
  to_id?: string;
  to_name?: string;
  credits?: number;
  items?: Record<string, number>;
  message?: string;
}

const trades = ref<TradeEntry[]>([]);
const loading = ref(false);
const acting = ref('');

const offerTarget = ref('');
const offerCredits = ref(0);
const offerItemsText = ref('');

const giftTarget = ref('');
const giftCredits = ref(0);
const giftItemId = ref('');
const giftQty = ref(1);
const giftMessage = ref('');

function fmtCredits(n: number): string {
  return n?.toLocaleString() ?? '0';
}

function parseItems(text: string): Record<string, number> {
  const items: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const [key, val] = line.split(':').map(s => s.trim());
    if (key && val) {
      const qty = parseInt(val, 10);
      if (!isNaN(qty) && qty > 0) items[key] = qty;
    }
  }
  return items;
}

function loadTrades() {
  loading.value = true;
  botStore.sendExec(props.bot.username, 'get_trades', {}, (data: unknown) => {
    loading.value = false;
    const d = data as Record<string, unknown>;
    const incoming: TradeEntry[] = ((Array.isArray(d?.incoming) ? d.incoming : []) as TradeEntry[])
      .map((t: TradeEntry) => ({ ...t, direction: 'incoming' as const }));
    const outgoing: TradeEntry[] = ((Array.isArray(d?.outgoing) ? d.outgoing : []) as TradeEntry[])
      .map((t: TradeEntry) => ({ ...t, direction: 'outgoing' as const }));
    trades.value = [...incoming, ...outgoing];
  });
}

function acceptTrade(tradeId: string) {
  acting.value = tradeId;
  botStore.sendExec(props.bot.username, 'trade_accept', { trade_id: tradeId }, (data: unknown) => {
    acting.value = '';
    const d = data as Record<string, unknown>;
    if (d?.error) { emit('notif', `Accept failed: ${d.error}`, 'error'); return; }
    emit('notif', 'Trade accepted!', 'success');
    loadTrades();
  });
}

function declineTrade(tradeId: string) {
  acting.value = tradeId;
  botStore.sendExec(props.bot.username, 'trade_decline', { trade_id: tradeId }, (data: unknown) => {
    acting.value = '';
    const d = data as Record<string, unknown>;
    if (d?.error) { emit('notif', `Decline failed: ${d.error}`, 'error'); return; }
    emit('notif', 'Trade declined', 'success');
    loadTrades();
  });
}

function cancelTrade(tradeId: string) {
  acting.value = tradeId;
  botStore.sendExec(props.bot.username, 'trade_cancel', { trade_id: tradeId }, (data: unknown) => {
    acting.value = '';
    const d = data as Record<string, unknown>;
    if (d?.error) { emit('notif', `Cancel failed: ${d.error}`, 'error'); return; }
    emit('notif', 'Trade cancelled', 'success');
    loadTrades();
  });
}

function sendOffer() {
  if (!offerTarget.value.trim()) return;
  acting.value = 'offer';
  const items = parseItems(offerItemsText.value);
  const payload: Record<string, unknown> = { target_id: offerTarget.value.trim() };
  if (offerCredits.value > 0) payload.credits = offerCredits.value;
  if (Object.keys(items).length) payload.items = items;
  botStore.sendExec(props.bot.username, 'trade_offer', payload, (data: unknown) => {
    acting.value = '';
    const d = data as Record<string, unknown>;
    if (d?.error) { emit('notif', `Offer failed: ${d.error}`, 'error'); return; }
    emit('notif', 'Trade offer sent!', 'success');
    offerTarget.value = '';
    offerCredits.value = 0;
    offerItemsText.value = '';
  });
}

function sendGift() {
  if (!giftTarget.value.trim()) return;
  acting.value = 'gift';
  const payload: Record<string, unknown> = { recipient: giftTarget.value.trim() };
  if (giftCredits.value > 0) payload.credits = giftCredits.value;
  if (giftItemId.value.trim()) { payload.item_id = giftItemId.value.trim(); payload.quantity = giftQty.value; }
  if (giftMessage.value.trim()) payload.message = giftMessage.value.trim();
  botStore.sendExec(props.bot.username, 'send_gift', payload, (data: unknown) => {
    acting.value = '';
    const d = data as Record<string, unknown>;
    if (d?.error) { emit('notif', `Gift failed: ${d.error}`, 'error'); return; }
    emit('notif', `Gift sent to ${giftTarget.value}!`, 'success');
    giftTarget.value = '';
    giftCredits.value = 0;
    giftItemId.value = '';
    giftMessage.value = '';
  });
}

loadTrades();
</script>
