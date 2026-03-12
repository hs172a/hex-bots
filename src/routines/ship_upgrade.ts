/**
 * ShipUpgrade routine — one-shot: buy or switch to a better ship.
 * Adapted from v2's ship_upgrade routine.
 *
 * Flow: dock → empty cargo → buy/switch ship → refuel → done (idles after)
 *
 * Settings:
 *   targetShipClass: string  - Ship class ID to buy
 *   sellOldShip: boolean     - Sell previous ship after switching (default: true)
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  tryRefuel,
  repairShip,
  detectAndRecoverFromDeath,
  readSettings,
  sleepBot,
  logStatus,
} from "./common.js";

function getShipUpgradeSettings(): {
  targetShipClass: string;
  sellOldShip: boolean;
} {
  const all = readSettings();
  const s = all.ship_upgrade || {};
  return {
    targetShipClass: (s.targetShipClass as string) || "",
    sellOldShip: (s.sellOldShip as boolean) !== false,
  };
}

export const shipUpgradeRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  await bot.refreshStatus();

  const settings = getShipUpgradeSettings();

  if (!settings.targetShipClass) {
    ctx.log("error", "No target ship class configured — check ShipUpgrade settings.");
    return;
  }

  // Check if already flying the target
  if (bot.shipClassId === settings.targetShipClass) {
    ctx.log("info", `Already flying ${settings.targetShipClass} — nothing to do.`);
    return;
  }

  ctx.log("system", `ShipUpgrade: upgrading to ${settings.targetShipClass}...`);

  const alive = await detectAndRecoverFromDeath(ctx);
  if (!alive) {
    ctx.log("error", "Bot is dead — cannot upgrade ship.");
    return;
  }

  // Dock at station
  yield "dock";
  await ensureDocked(ctx);

  // Record old ship info
  const oldShipClass = bot.shipClassId || "unknown";
  const oldShipId = bot.shipId || "";

  // Empty cargo (can't switch ships with cargo)
  yield "empty_cargo";
  await bot.refreshCargo();
  if (bot.inventory.length > 0) {
    ctx.log("info", "Emptying cargo before ship switch...");
    for (const item of [...bot.inventory]) {
      if (item.quantity <= 0) continue;
      const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      if (dResp.error) {
        await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    }
    await bot.refreshCargo();
  }

  // Check if we already own the target ship
  yield "check_ships";
  const shipsResp = await bot.exec("list_ships");
  if (!shipsResp.error && shipsResp.result) {
    const ships = (Array.isArray(shipsResp.result) ? shipsResp.result :
      (shipsResp.result as Record<string, unknown>).ships as unknown[] || []) as Array<Record<string, unknown>>;

    const ownedTarget = ships.find(s => {
      const classId = (s.class_id as string) || (s.classId as string) || "";
      const shipId = (s.ship_id as string) || (s.id as string) || "";
      return classId === settings.targetShipClass && shipId !== oldShipId;
    });

    if (ownedTarget) {
      const switchId = (ownedTarget.ship_id as string) || (ownedTarget.id as string) || "";
      ctx.log("info", `Already own ${settings.targetShipClass} — switching to it...`);
      yield "switch_ship";
      const switchResp = await bot.exec("switch_ship", { ship_id: switchId });
      if (switchResp.error) {
        ctx.log("error", `Switch failed: ${switchResp.error.message}`);
        return;
      }
      await bot.refreshStatus();
      ctx.log("info", `Switched: ${oldShipClass} → ${settings.targetShipClass}`);

      // Sell old ship if requested
      if (settings.sellOldShip && oldShipId) {
        const sellResp = await bot.exec("sell_ship", { ship_id: oldShipId });
        if (!sellResp.error) ctx.log("info", `Sold old ${oldShipClass}`);
      }

      await tryRefuel(ctx);
      await repairShip(ctx);
      logStatus(ctx);
      ctx.log("system", "ShipUpgrade complete.");
      while (bot.state === "running") { await sleepBot(ctx, 30000); yield "idle"; }
      return;
    }
  }

  // v0.209: Use browse_ships (shows both station-built and player listings) + buy_listed_ship
  yield "check_shipyard";
  ctx.log("info", `Browsing ship market for ${settings.targetShipClass}...`);
  const browseResp = await bot.exec("browse_ships");
  if (browseResp.error) {
    ctx.log("error", `Ship market unavailable: ${browseResp.error.message}`);
    return;
  }

  const rawListings = browseResp.result as Record<string, unknown> | undefined;
  const listings = (Array.isArray(rawListings?.ships) ? rawListings!.ships :
    Array.isArray(rawListings) ? rawListings : []) as Array<Record<string, unknown>>;

  const targetListing = listings.find(s => {
    const classId = (s.ship_class as string) || (s.class_id as string) || (s.id as string) || "";
    return classId === settings.targetShipClass;
  });

  if (!targetListing) {
    ctx.log("error", `${settings.targetShipClass} not available at this station.`);
    return;
  }

  const listingId = (targetListing.listing_id as string) || (targetListing.id as string) || "";
  const price = (targetListing.price as number) || 0;
  if (!listingId || price <= 0) {
    ctx.log("error", `Invalid listing for ${settings.targetShipClass}`);
    return;
  }

  await bot.refreshStatus();
  if (bot.credits < price) {
    ctx.log("error", `Can't afford ${settings.targetShipClass} (need ${price}cr, have ${bot.credits}cr)`);
    return;
  }

  // Buy the ship — v0.209: buy_listed_ship auto-swaps, no switch_ship needed
  yield "buy_ship";
  ctx.log("info", `Buying ${settings.targetShipClass} for ${price}cr (listing: ${listingId})...`);
  const buyResp = await bot.exec("buy_listed_ship", { listing_id: listingId });
  if (buyResp.error) {
    ctx.log("error", `Buy failed: ${buyResp.error.message}`);
    return;
  }
  await bot.refreshStatus();
  // Auto-swap confirms active ship is the purchased one — no manual switch_ship required

  // Sell old ship if requested
  if (settings.sellOldShip && oldShipId && bot.shipId !== oldShipId) {
    yield "sell_old";
    const sellResp = await bot.exec("sell_ship", { ship_id: oldShipId });
    if (!sellResp.error) ctx.log("info", `Sold old ${oldShipClass}`);
  }

  // Service
  await tryRefuel(ctx);
  await repairShip(ctx);

  await bot.refreshStatus();
  logStatus(ctx);
  ctx.log("system", `ShipUpgrade complete: ${oldShipClass} → ${settings.targetShipClass} (cost ${price}cr)`);

  // Idle until stopped
  while (bot.state === "running") { await sleepBot(ctx, 30000); yield "idle"; }
};
