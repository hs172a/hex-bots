import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  tryRefuel,
  repairShip,
  navigateToSystem,
  readSettings,
  readFleetSettings,
  getFleetAssignment,
  writeFleetSignal,
  getPendingFleetOrder,
  clearFleetOrder,
  sleepBot,
} from "./common.js";

const SIGNAL_INTERVAL_MS = 30_000;
const MIN_FUEL_CELLS = 10;
const FUEL_LOW_PCT = 30;

function getSettings(): { stationSystemId: string; stationPoiId: string } {
  const all = readSettings();
  const s = (all.fleet_refueler || {}) as Record<string, unknown>;
  const general = (all.general || {}) as Record<string, unknown>;
  return {
    stationSystemId: (s.stationSystemId as string) || (general.homeSystem as string) || "",
    stationPoiId:    (s.stationPoiId as string)    || (general.homeBase as string)   || "",
  };
}

/**
 * Fleet Refueler — stays at the group's deposit station, maintains a stock
 * of fuel cells, and broadcasts its position so low-fuel fleet members can
 * navigate here for emergency top-up.  Responds to manual dock / return_home
 * orders like other fleet routines.
 */
export const fleetRefuelerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  const assignment = getFleetAssignment(bot.username);
  if (!assignment) {
    ctx.log("warn", "⛽ No fleet assignment found. Idling 60s.");
    await sleepBot(ctx, 60_000);
    return;
  }

  ctx.log("info", `⛽ Fleet Refueler starting — group ${assignment.groupId}`);

  let lastSignalMs = 0;

  while (bot.state === "running") {
    // ── Manual order check ──────────────────────────────────────
    const order = getPendingFleetOrder(bot.username);
    if (order) {
      ctx.log("info", `⛽ Executing fleet order: ${order.cmd}`);
      clearFleetOrder(bot.username);
      if (order.cmd === "dock") {
        yield "order_dock";
        await ensureDocked(ctx);
      } else if (order.cmd === "return_home") {
        const settings = getSettings();
        if (settings.stationSystemId) {
          yield "order_return_home";
          await navigateToSystem(ctx, settings.stationSystemId, { fuelThresholdPct: 30, hullThresholdPct: 20 });
          await ensureDocked(ctx);
        }
      } else if (order.cmd === "goto" && order.targetSystem) {
        yield "order_goto";
        await navigateToSystem(ctx, order.targetSystem, { fuelThresholdPct: 30, hullThresholdPct: 20 });
      }
      continue;
    }

    const settings = getSettings();
    const { groups, signals, assignments } = readFleetSettings();
    const group = groups.find(g => g.id === assignment.groupId);

    if (!group) {
      ctx.log("warn", "⛽ Group not found. Waiting 60s...");
      yield "wait_group";
      await sleepBot(ctx, 60_000);
      continue;
    }

    // ── Determine home station ──────────────────────────────────
    const stationPoiId    = group.depositPoi       || settings.stationPoiId;
    const stationSystemId = settings.stationSystemId;

    // Navigate to station if in wrong system
    if (stationSystemId && bot.system !== stationSystemId) {
      ctx.log("info", `⛽ Moving to refuel station in ${stationSystemId}...`);
      yield "navigate_to_station";
      try {
        await navigateToSystem(ctx, stationSystemId, { fuelThresholdPct: 30, hullThresholdPct: 20 });
      } catch (e) {
        ctx.log("error", `⛽ Navigation failed: ${e}`);
        await sleepBot(ctx, 30_000);
        continue;
      }
    }

    // Dock
    if (!bot.docked) {
      yield "dock_at_station";
      await ensureDocked(ctx);
    }

    // Self-refuel + repair
    yield "self_refuel";
    await tryRefuel(ctx);
    await repairShip(ctx);

    // ── Maintain fuel cell stock ────────────────────────────────
    yield "check_fuel_cells";
    try {
      const cargoRes = await bot.exec("get_cargo");
      const items = (cargoRes?.result as Record<string, unknown>)?.items as Array<{ item_id: string; quantity: number }> | undefined ?? [];
      const cells = items.find(i => i.item_id === "fuel_cell");
      const have = cells?.quantity ?? 0;
      if (have < MIN_FUEL_CELLS) {
        const toBuy = MIN_FUEL_CELLS - have;
        ctx.log("info", `⛽ Buying ${toBuy} fuel cells (have ${have})`);
        await bot.exec("buy", { item_id: "fuel_cell", quantity: toBuy });
      }
    } catch (e) {
      ctx.log("warn", `⛽ Fuel cell check/buy failed: ${e}`);
    }

    // ── Emit position signal so fleet members can navigate here ──
    const now = Date.now();
    if (now - lastSignalMs >= SIGNAL_INTERVAL_MS) {
      lastSignalMs = now;
      const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      writeFleetSignal(bot.username, {
        poi:      bot.poi      ?? undefined,
        systemId: bot.system   ?? undefined,
        fuelPct,
        needsFuel: false,
      });
    }

    // ── Log any low-fuel fleet members so operator is aware ─────
    const lowFuelMembers = Object.entries(assignments)
      .filter(([u, a]) => u !== bot.username && a.groupId === assignment.groupId)
      .map(([u]) => ({ username: u, sig: signals[u] }))
      .filter(m => m.sig && (m.sig.fuelPct ?? 100) < FUEL_LOW_PCT);

    if (lowFuelMembers.length > 0) {
      ctx.log("warn", `⛽ Low-fuel fleet members: ${lowFuelMembers.map(m => `${m.username} (${m.sig.fuelPct}%)`).join(", ")} — they should dock here at ${stationPoiId}`);
    }

    yield "refueler_idle";
    await sleepBot(ctx, 30_000);
  }
};
