/**
 * StationToFaction routine — transfers all items from station storage to faction storage
 * at the bot's current docked location, handling cargo limits via multi-pass batching.
 *
 * The multi-pass logic lives in transferStationToFaction() in common.ts and is shared
 * with collectFromStorage(). This routine is a thin wrapper for one-shot manual use.
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  detectAndRecoverFromDeath,
  parseStorageLocations,
  transferStationToFaction,
} from "./common.js";

export const stationToFactionRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  ctx.log("system", "StationToFaction: starting transfer from station storage → faction storage");

  // ── 1. Death check ────────────────────────────────────────────────────────
  await bot.refreshStatus();
  const alive = await detectAndRecoverFromDeath(ctx);
  if (!alive) {
    ctx.log("error", "StationToFaction: bot is dead — cannot proceed");
    return;
  }

  // ── 2. Ensure docked ─────────────────────────────────────────────────────
  yield "docking";
  const docked = await ensureDocked(ctx);
  if (!docked) {
    ctx.log("error", "StationToFaction: could not dock — aborting");
    return;
  }

  // ── 3. Check station storage ──────────────────────────────────────────────
  yield "check_storage";
  const checkResp = await bot.exec("view_storage");
  if (checkResp.error) {
    const msg = checkResp.error.message || "";
    if (checkResp.error.code === "not_docked" || msg.includes("not_docked")) {
      const stations = parseStorageLocations(bot, msg);
      ctx.log("error", `StationToFaction: not docked${stations.length ? ` — storage at: ${stations.join(", ")}` : ""}`);
    } else {
      ctx.log("error", `StationToFaction: failed to view storage — ${msg}`);
    }
    return;
  }

  await bot.refreshStorage();
  if (bot.storage.length === 0) {
    ctx.log("system", "StationToFaction: station storage is empty — nothing to transfer");
    return;
  }

  ctx.log("info", `StationToFaction: found ${bot.storage.length} item type(s) in station storage`);

  // ── 4. Dump cargo so withdraw_items has free space ────────────────────────
  yield "dump_cargo";
  await bot.refreshCargo();
  if (bot.inventory.length > 0) {
    ctx.log("info", `StationToFaction: clearing ${bot.inventory.length} cargo item type(s) to make room`);
    for (const item of [...bot.inventory]) {
      if (item.quantity <= 0) continue;
      // Try faction first, fall back to station storage
      const fResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      if (fResp.error) {
        await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    }
    await bot.refreshStatus();
  }

  // ── 5. Multi-pass transfer (shared helper) ────────────────────────────────
  yield "transferring";
  const totalTransferred = await transferStationToFaction(ctx);

  // ── 6. Summary ────────────────────────────────────────────────────────────
  ctx.log("system", `StationToFaction: done — ${totalTransferred} unit(s) transferred`);
};
