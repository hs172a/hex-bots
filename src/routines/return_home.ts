/**
 * ReturnHome routine — navigates a bot back to its home system, docks, refuels, and idles.
 * Simple utility routine from v2 — useful when Commander wants a bot to come back.
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  ensureUndocked,
  ensureFueled,
  navigateToSystem,
  detectAndRecoverFromDeath,
  readSettings,
  sleep,
  logStatus,
  tryRefuel,
  collectFromStorage,
} from "./common.js";

function getReturnHomeSettings(): {
  homeSystem: string;
  refuelThreshold: number;
} {
  const all = readSettings();
  const r = all.return_home || {};
  return {
    homeSystem: (r.homeSystem as string) || "",
    refuelThreshold: (r.refuelThreshold as number) || 60,
  };
}

export const returnHomeRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  await bot.refreshStatus();

  const settings = getReturnHomeSettings();
  const homeSystem = settings.homeSystem || bot.homeSystem || bot.system;

  ctx.log("system", `ReturnHome: navigating to ${homeSystem}...`);

  // Death recovery
  const alive = await detectAndRecoverFromDeath(ctx);
  if (!alive) {
    ctx.log("error", "Bot is dead — cannot return home.");
    return;
  }

  // Navigate home if not already there
  if (bot.system !== homeSystem) {
    yield "navigate";
    await ensureUndocked(ctx);
    const arrived = await navigateToSystem(ctx, homeSystem, {
      fuelThresholdPct: settings.refuelThreshold,
      hullThresholdPct: 30,
    });
    if (!arrived) {
      ctx.log("error", `Could not reach ${homeSystem}`);
      return;
    }
  }

  // Dock at station
  yield "dock";
  await ensureDocked(ctx);
  ctx.log("info", "Docked at home station.");

  // Refuel
  yield "refuel";
  await tryRefuel(ctx);

  // Deposit cargo items to faction storage
  yield "deposit";
  await bot.refreshCargo();
  for (const item of [...bot.inventory]) {
    if (item.quantity <= 0) continue;
    const lower = item.itemId.toLowerCase();
    if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
    const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
    if (dResp.error) {
      await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
    }
  }
  // Also consolidate station storage → faction storage
  await collectFromStorage(ctx);

  await bot.refreshStatus();
  logStatus(ctx);
  ctx.log("system", "ReturnHome complete — bot is docked and refueled at home.");

  // Idle until stopped
  while (bot.state === "running") {
    await sleep(30000);
    yield "idle";
  }
};
