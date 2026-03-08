/**
 * Quartermaster routine — manages faction storage at home station.
 * Sells surplus goods on the market, buys needed supplies, manages inventory.
 * Lightweight port from v2's quartermaster routine.
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  findStation,
  getSystemInfo,
  ensureDocked,
  ensureUndocked,
  ensureFueled,
  tryRefuel,
  detectAndRecoverFromDeath,
  readSettings,
  getReservedForGoals,
  sleep,
  logStatus,
} from "./common.js";

function getQuartermasterSettings(): {
  refuelThreshold: number;
  sellThreshold: number;
  cycleDelayMs: number;
} {
  const all = readSettings();
  const q = all.quartermaster || {};
  return {
    refuelThreshold: (q.refuelThreshold as number) || 60,
    /** Minimum quantity of a crafted item before selling */
    sellThreshold: (q.sellThreshold as number) || 5,
    /** Delay between inventory management cycles */
    cycleDelayMs: (q.cycleDelayMs as number) || 60000,
  };
}

export const quartermasterRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  await bot.refreshStatus();

  ctx.log("system", "Quartermaster online — managing faction storage and market...");

  while (bot.state === "running") {
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleep(30000); continue; }

    const settings = getQuartermasterSettings();

    // Ensure docked at a station with market
    yield "dock_check";
    await ensureDocked(ctx);
    await tryRefuel(ctx);
    await bot.refreshStatus();
    logStatus(ctx);

    // ── Check faction storage ──
    yield "check_storage";
    ctx.log("info", "Checking faction storage...");
    const storageResp = await bot.exec("view_faction_storage");
    if (storageResp.error) {
      ctx.log("warn", `Faction storage unavailable: ${storageResp.error.message}`);
      await sleep(settings.cycleDelayMs);
      continue;
    }

    const storageData = storageResp.result as Record<string, unknown> | undefined;
    const items = extractStorageItems(storageData);

    if (items.length === 0) {
      ctx.log("info", "Faction storage is empty — waiting...");
      await sleep(settings.cycleDelayMs);
      continue;
    }

    ctx.log("info", `Faction storage: ${items.length} item type(s)`);

    // ── Withdraw sellable items (skip goal-reserved items) ──
    yield "withdraw_goods";
    const qmReserved = bot.poi ? getReservedForGoals(bot.poi) : new Map<string, number>();
    const sellable = items.filter(i => {
      const lower = i.id.toLowerCase();
      // Keep raw ores for crafters, keep fuel/energy for fleet
      if (lower.startsWith("ore_")) return false;
      if (lower.includes("fuel") || lower.includes("energy_cell")) return false;
      // Skip items reserved for active gather/crafter goals
      const res = qmReserved.get(i.id) ?? 0;
      if (i.qty <= res) return false;
      return i.qty >= settings.sellThreshold;
    }).map(i => {
      const res = qmReserved.get(i.id) ?? 0;
      return { ...i, qty: i.qty - res }; // only sell surplus
    });

    if (!bot.inFaction) {
      ctx.log("info", "Quartermaster: not in a faction — skipping faction storage withdrawal");
    } else {
      for (const item of sellable) {
        ctx.log("info", `Withdrawing ${item.qty}x ${item.name} from faction storage...`);
        const wResp = await bot.exec("faction_withdraw_items", {
          item_id: item.id,
          quantity: item.qty,
        });
        if (wResp.error) {
          ctx.log("warn", `Withdraw failed: ${wResp.error.message}`);
        }
        await sleep(1000);
      }
    }

    // ── Sell on market ──
    yield "sell_goods";
    await bot.refreshCargo();
    for (const cargo of bot.inventory) {
      const lower = cargo.itemId.toLowerCase();
      if (!lower.startsWith("ore_") && !lower.includes("fuel") && !lower.includes("energy_cell")) {
        if (cargo.quantity >= settings.sellThreshold) {
          ctx.log("info", `Selling ${cargo.quantity}x ${cargo.name}...`);
          const sellResp = await bot.exec("sell", {
            item_id: cargo.itemId,
            quantity: cargo.quantity,
          });
          if (sellResp.error) {
            ctx.log("warn", `Sell failed for ${cargo.name}: ${sellResp.error.message}`);
          } else {
            ctx.log("info", `Sold ${cargo.quantity}x ${cargo.name}`);
          }
          await sleep(1000);
        }
      }
    }

    // ── Deposit raw ores back (they shouldn't be sold, crafters need them) ──
    yield "deposit_ores";
    await bot.refreshCargo();
    for (const cargo of bot.inventory) {
      if (cargo.itemId.startsWith("ore_") && cargo.quantity > 0) {
        ctx.log("info", `Depositing ${cargo.quantity}x ${cargo.name} to faction storage...`);
        if (bot.inFaction) {
          const dResp = await bot.exec("faction_deposit_items", {
            item_id: cargo.itemId,
            quantity: cargo.quantity,
          });
          if (dResp.error) {
            await bot.exec("deposit_items", { item_id: cargo.itemId, quantity: cargo.quantity });
          }
        } else {
          await bot.exec("deposit_items", { item_id: cargo.itemId, quantity: cargo.quantity });
        }
        await sleep(1000);
      }
    }

    await bot.refreshStatus();
    logStatus(ctx);
    ctx.log("info", `Cycle complete. Credits: ${bot.credits}. Next cycle in ${Math.round(settings.cycleDelayMs / 1000)}s`);

    await sleep(settings.cycleDelayMs);
  }
};

/** Extract items from faction storage response */
function extractStorageItems(data: Record<string, unknown> | undefined): Array<{ id: string; name: string; qty: number }> {
  if (!data) return [];
  const items: Array<{ id: string; name: string; qty: number }> = [];

  // Try various response shapes
  const arr = (
    Array.isArray(data) ? data :
    Array.isArray((data as any).items) ? (data as any).items :
    Array.isArray((data as any).storage) ? (data as any).storage :
    Array.isArray((data as any).inventory) ? (data as any).inventory :
    []
  ) as Array<Record<string, unknown>>;

  for (const entry of arr) {
    const id = (entry.item_id as string) || (entry.id as string) || "";
    const name = (entry.name as string) || id;
    const qty = (entry.quantity as number) || (entry.amount as number) || 0;
    if (id && qty > 0) items.push({ id, name, qty });
  }
  return items;
}
