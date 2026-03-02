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
  sleep,
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
      while (bot.state === "running") { await sleep(30000); yield "idle"; }
      return;
    }
  }

  // Buy from shipyard
  yield "check_shipyard";
  ctx.log("info", `Checking shipyard for ${settings.targetShipClass}...`);
  const showroomResp = await bot.exec("shipyard_showroom");
  if (showroomResp.error) {
    ctx.log("error", `Shipyard unavailable: ${showroomResp.error.message}`);
    return;
  }

  const showroom = (Array.isArray(showroomResp.result) ? showroomResp.result :
    (showroomResp.result as Record<string, unknown>)?.ships as unknown[] || []) as Array<Record<string, unknown>>;

  const targetShip = showroom.find(s => {
    const classId = (s.class_id as string) || (s.classId as string) || (s.id as string) || "";
    return classId === settings.targetShipClass;
  });

  if (!targetShip) {
    ctx.log("error", `${settings.targetShipClass} not available at this shipyard.`);
    return;
  }

  const price = (targetShip.price as number) || (targetShip.base_price as number) || 0;
  if (price <= 0) {
    ctx.log("error", `Invalid price for ${settings.targetShipClass}`);
    return;
  }

  await bot.refreshStatus();
  if (bot.credits < price) {
    ctx.log("error", `Can't afford ${settings.targetShipClass} (need ${price}cr, have ${bot.credits}cr)`);
    return;
  }

  // Buy the ship
  yield "buy_ship";
  ctx.log("info", `Buying ${settings.targetShipClass} for ${price}cr...`);
  const buyResp = await bot.exec("buy_ship", { class_id: settings.targetShipClass });
  if (buyResp.error) {
    ctx.log("error", `Buy failed: ${buyResp.error.message}`);
    return;
  }
  await bot.refreshStatus();

  // Switch to new ship if not auto-switched
  if (bot.shipClassId !== settings.targetShipClass) {
    yield "switch_ship";
    const shipsResp2 = await bot.exec("list_ships");
    if (!shipsResp2.error && shipsResp2.result) {
      const ships2 = (Array.isArray(shipsResp2.result) ? shipsResp2.result :
        (shipsResp2.result as Record<string, unknown>).ships as unknown[] || []) as Array<Record<string, unknown>>;
      const newShip = ships2.find(s => {
        const classId = (s.class_id as string) || (s.classId as string) || "";
        const shipId = (s.ship_id as string) || (s.id as string) || "";
        return classId === settings.targetShipClass && shipId !== oldShipId;
      });
      if (newShip) {
        const newId = (newShip.ship_id as string) || (newShip.id as string) || "";
        await bot.exec("switch_ship", { ship_id: newId });
        await bot.refreshStatus();
      }
    }
  }

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
  while (bot.state === "running") { await sleep(30000); yield "idle"; }
};
