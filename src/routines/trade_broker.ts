/**
 * TradeBroker routine — P2P trade notification handler and resource redistribution.
 *
 * Phase 6 implementation:
 *   6.1  Watch for "trade" notifications → auto-accept or decline based on rules
 *   6.2  Accept incoming offers matching configured accept list (items or credits ≥ threshold)
 *        Decline all other offers immediately
 *   6.3  Optionally send trade offers to faction members for resource redistribution
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  readSettings,
  sleep,
  logAgentEvent,
} from "./common.js";

// ── Settings ──────────────────────────────────────────────────

interface AcceptRule {
  item_id: string;
  min_quantity: number;
}

function getBrokerSettings(): {
  autoAccept: boolean;
  autoDecline: boolean;
  acceptItems: AcceptRule[];
  acceptMinCredits: number;
  redistributeItems: string[];
  cycleIntervalSec: number;
} {
  const all = readSettings();
  const b = all.trade_broker || {};
  return {
    autoAccept: (b.autoAccept as boolean) ?? true,
    autoDecline: (b.autoDecline as boolean) ?? true,
    acceptItems: Array.isArray(b.acceptItems)
      ? (b.acceptItems as AcceptRule[])
      : [],
    acceptMinCredits: (b.acceptMinCredits as number) || 0,
    redistributeItems: Array.isArray(b.redistributeItems)
      ? (b.redistributeItems as string[])
      : [],
    cycleIntervalSec: (b.cycleIntervalSec as number) || 60,
  };
}

// ── Trade offer evaluation ────────────────────────────────────

function shouldAccept(
  offeredItems: Array<Record<string, unknown>>,
  offeredCredits: number,
  settings: ReturnType<typeof getBrokerSettings>,
): boolean {
  // Always accept if offered credits meet threshold (no items required)
  if (offeredCredits >= settings.acceptMinCredits && settings.acceptMinCredits > 0) {
    return true;
  }

  // Accept if offered items match the accept list
  if (settings.acceptItems.length === 0) return false;

  for (const rule of settings.acceptItems) {
    const match = offeredItems.find(i => {
      const id = (i.item_id as string) || (i.id as string) || "";
      return id === rule.item_id || id.includes(rule.item_id);
    });
    if (!match) return false;
    const qty = (match.quantity as number) || 0;
    if (qty < rule.min_quantity) return false;
  }
  return settings.acceptItems.length > 0;
}

// ── Routine ───────────────────────────────────────────────────

export const tradeBrokerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  ctx.log("trade", "TradeBroker: starting P2P trade notification handler");
  yield "init";

  // Queue of pending trade offers received via notifications
  const pendingOffers: Array<{
    tradeId: string;
    from: string;
    offeredItems: Array<Record<string, unknown>>;
    offeredCredits: number;
    receivedAt: number;
  }> = [];

  // Register notification hook to catch incoming trade offers
  bot.onNotification = (type, data) => {
    if (type !== "trade") return;
    const tradeId = (data.trade_id as string) || "";
    const from = (data.from_username as string) || (data.from as string) || "?";
    const items = Array.isArray(data.offered_items)
      ? (data.offered_items as Array<Record<string, unknown>>)
      : [];
    const credits = (data.offered_credits as number) ?? 0;
    if (!tradeId) return;

    ctx.log("trade", `TradeBroker: offer from ${from} — ${items.length} item(s) + ${credits}cr (id: ${tradeId})`);
    pendingOffers.push({ tradeId, from, offeredItems: items, offeredCredits: credits, receivedAt: Date.now() });
  };

  while (bot.state === "running") {
    const settings = getBrokerSettings();

    // ── Process queued trade offers ──────────────────────────
    while (pendingOffers.length > 0) {
      const offer = pendingOffers.shift()!;

      // Expire stale offers (> 5 minutes old)
      if (Date.now() - offer.receivedAt > 5 * 60_000) {
        ctx.log("trade", `TradeBroker: offer ${offer.tradeId} from ${offer.from} expired — skipping`);
        continue;
      }

      const accept = settings.autoAccept && shouldAccept(offer.offeredItems, offer.offeredCredits, settings);

      if (accept) {
        yield `accept_${offer.tradeId}`;
        const resp = await bot.exec("accept_trade", { trade_id: offer.tradeId });
        if (!resp.error) {
          const itemSummary = offer.offeredItems
            .map(i => `${i.quantity ?? 1}x ${(i.item_id as string) || "?"}`)
            .join(", ");
          ctx.log("trade", `TradeBroker: accepted offer from ${offer.from} (${itemSummary || `${offer.offeredCredits}cr`})`);
          logAgentEvent(ctx, "economy", "info",
            `Trade accepted from ${offer.from}: ${itemSummary || `${offer.offeredCredits}cr`}`,
            { trade_id: offer.tradeId, from: offer.from },
          );
        } else {
          ctx.log("warn", `TradeBroker: accept failed (${offer.tradeId}): ${resp.error.message}`);
        }
      } else if (settings.autoDecline) {
        yield `decline_${offer.tradeId}`;
        const resp = await bot.exec("decline_trade", { trade_id: offer.tradeId });
        if (!resp.error) {
          ctx.log("trade", `TradeBroker: declined offer from ${offer.from} (${offer.tradeId})`);
        } else {
          const msg = resp.error.message.toLowerCase();
          if (!msg.includes("not found") && !msg.includes("expired")) {
            ctx.log("warn", `TradeBroker: decline failed (${offer.tradeId}): ${resp.error.message}`);
          }
        }
      }
    }

    // ── Step 6.3 — Resource redistribution offers ────────────
    if (settings.redistributeItems.length > 0 && bot.factionId) {
      yield "check_redistribution";

      // Get faction roster to find online members at same station
      await bot.refreshStatus();
      if (bot.docked) {
        const nearbyResp = await bot.exec("get_nearby");
        if (!nearbyResp.error && nearbyResp.result) {
          const nearbyData = nearbyResp.result as Record<string, unknown>;
          const entities = Array.isArray(nearbyData)
            ? (nearbyData as Array<Record<string, unknown>>)
            : Array.isArray(nearbyData.entities)
              ? (nearbyData.entities as Array<Record<string, unknown>>)
              : [];

          // Find faction members at same POI
          const factionMembers = entities.filter(e => {
            const factionId = (e.faction_id as string) || "";
            const isPlayer = (e.type as string) === "player" || (e.is_player as boolean);
            return isPlayer && factionId === bot.factionId && (e.id as string) !== bot.username;
          });

          if (factionMembers.length > 0) {
            await bot.refreshCargo();
            for (const itemId of settings.redistributeItems) {
              const cargoItem = bot.inventory.find(i => i.itemId === itemId);
              if (!cargoItem || cargoItem.quantity <= 0) continue;

              // Offer surplus to first available faction member (split evenly)
              const shareQty = Math.floor(cargoItem.quantity / (factionMembers.length + 1));
              if (shareQty <= 0) continue;

              for (const member of factionMembers) {
                const memberId = (member.id as string) || "";
                if (!memberId) continue;
                const offerResp = await bot.exec("send_trade_offer", {
                  target_id: memberId,
                  items: [{ item_id: itemId, quantity: shareQty }],
                });
                if (!offerResp.error) {
                  ctx.log("trade", `TradeBroker: sent ${shareQty}x ${itemId} offer to ${memberId}`);
                } else {
                  ctx.log("warn", `TradeBroker: offer to ${memberId} failed: ${offerResp.error.message}`);
                }
              }
            }
          }
        }
      }
    }

    yield "idle";
    await sleep(settings.cycleIntervalSec * 1_000);
  }

  // Clear notification hook on exit
  bot.onNotification = null;
};
