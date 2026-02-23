/**
 * Cleanup Agent routine — consolidates scattered station storage to home base.
 *
 * Visits all known stations, withdraws credits and items from personal storage,
 * and deposits everything at the home station's faction storage.
 */
import type { Routine, RoutineContext } from "../bot.js";
import { mapStore } from "../mapstore.js";
import {
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  ensureFueled,
  navigateToSystem,
  maxItemsForCargo,
  readSettings,
  sleep,
  logFactionActivity,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

function getCleanupSettings(username?: string): {
  homeSystem: string;
  homeStation: string;
  refuelThreshold: number;
  repairThreshold: number;
} {
  const all = readSettings();
  const t = all.cleanup || {};
  const botOverrides = username ? (all[username] || {}) : {};
  return {
    homeSystem: (botOverrides.homeSystem as string) || (t.homeSystem as string) || "sol",
    homeStation: (botOverrides.homeStation as string) || (t.homeStation as string) || "sol_station",
    refuelThreshold: (t.refuelThreshold as number) || 50,
    repairThreshold: (t.repairThreshold as number) || 40,
  };
}

// ── Types ────────────────────────────────────────────────────

interface StationTarget {
  systemId: string;
  poiId: string;
  poiName: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Get all known stations except the home station. */
function getAllKnownStations(homeSystem: string, homeStation: string): StationTarget[] {
  const stations: StationTarget[] = [];
  const allSystems = mapStore.getAllSystems();

  for (const [sysId, sys] of Object.entries(allSystems)) {
    for (const poi of sys.pois) {
      if (!poi.has_base) continue;
      // Skip home station
      if (sysId === homeSystem && poi.id === homeStation) continue;
      stations.push({
        systemId: sysId,
        poiId: poi.id,
        poiName: poi.name || poi.id,
      });
    }
  }

  return stations;
}

/** Navigate to home station and deposit all non-fuel cargo to faction storage. */
async function depositAtHome(ctx: RoutineContext, settings: ReturnType<typeof getCleanupSettings>): Promise<void> {
  const { bot } = ctx;
  const safetyOpts = {
    fuelThresholdPct: settings.refuelThreshold,
    hullThresholdPct: settings.repairThreshold,
  };

  // Navigate to home system
  if (bot.system !== settings.homeSystem) {
    await ensureUndocked(ctx);
    const fueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
    if (!fueled) {
      ctx.log("error", "Cannot refuel for return to home — staying put");
      return;
    }
    ctx.log("travel", `Returning to home system ${settings.homeSystem}...`);
    const arrived = await navigateToSystem(ctx, settings.homeSystem, safetyOpts);
    if (!arrived) {
      ctx.log("error", "Failed to reach home system");
      return;
    }
  }

  // Travel to home station
  await ensureUndocked(ctx);
  if (bot.poi !== settings.homeStation) {
    ctx.log("travel", `Traveling to home station...`);
    const tResp = await bot.exec("travel", { target_poi: settings.homeStation });
    if (tResp.error && !tResp.error.message.includes("already")) {
      ctx.log("error", `Travel to home station failed: ${tResp.error.message}`);
      return;
    }
    bot.poi = settings.homeStation;
  }

  // Dock
  await ensureDocked(ctx);

  // Deposit all non-fuel cargo to faction storage
  await bot.refreshCargo();
  const deposited: string[] = [];
  for (const item of [...bot.inventory]) {
    if (item.quantity <= 0) continue;
    const lower = item.itemId.toLowerCase();
    if (lower.includes("fuel") || lower.includes("energy_cell")) continue;

    const fResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
    if (!fResp.error) {
      deposited.push(`${item.quantity}x ${item.name}`);
      logFactionActivity(ctx, "deposit", `Deposited ${item.quantity}x ${item.name} (cleanup)`);
    } else {
      // Fallback to station storage
      await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      deposited.push(`${item.quantity}x ${item.name} (station)`);
    }
  }

  if (deposited.length > 0) {
    ctx.log("trade", `Deposited at home: ${deposited.join(", ")}`);
    await bot.refreshCargo();
  }
}

// ── Main routine ─────────────────────────────────────────────

export const cleanupRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  await bot.refreshStatus();

  while (bot.state === "running") {
    const settings = getCleanupSettings(bot.username);
    const safetyOpts = {
      fuelThresholdPct: settings.refuelThreshold,
      hullThresholdPct: settings.repairThreshold,
    };

    // ── Plan route ──
    yield "plan_route";
    const stations = getAllKnownStations(settings.homeSystem, settings.homeStation);
    ctx.log("info", `Cleanup run: ${stations.length} station(s) to visit`);

    if (stations.length === 0) {
      ctx.log("info", "No stations to clean up — waiting 5 minutes");
      await sleep(300000);
      continue;
    }

    let totalCredits = 0;
    let totalItems = 0;

    for (const station of stations) {
      if (bot.state !== "running") break;

      // ── Travel to station ──
      yield "travel_to_station";
      ctx.log("travel", `Heading to ${station.poiName} in ${station.systemId}...`);

      if (bot.system !== station.systemId) {
        await ensureUndocked(ctx);
        const fueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
        if (!fueled) {
          ctx.log("error", `Cannot refuel to reach ${station.systemId} — skipping`);
          continue;
        }
        const arrived = await navigateToSystem(ctx, station.systemId, safetyOpts);
        if (!arrived) {
          ctx.log("error", `Failed to reach ${station.systemId} — skipping`);
          continue;
        }
      }

      await ensureUndocked(ctx);
      if (bot.poi !== station.poiId) {
        const tResp = await bot.exec("travel", { target_poi: station.poiId });
        if (tResp.error && !tResp.error.message.includes("already")) {
          ctx.log("error", `Travel to ${station.poiName} failed: ${tResp.error.message} — skipping`);
          continue;
        }
        bot.poi = station.poiId;
      }

      // Dock
      await ensureDocked(ctx);
      if (!bot.docked) {
        ctx.log("error", `Could not dock at ${station.poiName} — skipping`);
        continue;
      }

      // Check storage
      const storageResp = await bot.exec("view_storage");
      if (!storageResp.result || typeof storageResp.result !== "object") continue;

      const sr = storageResp.result as Record<string, unknown>;
      const storedCredits = (sr.credits as number) || (sr.stored_credits as number) || 0;

      await bot.refreshStorage();
      const hasItems = bot.storage.length > 0;

      if (storedCredits === 0 && !hasItems) {
        ctx.log("info", `${station.poiName}: empty — skipping`);
        // Still refuel while docked
        await tryRefuel(ctx);
        continue;
      }

      // Withdraw credits
      if (storedCredits > 0) {
        const wResp = await bot.exec("withdraw_credits", { amount: storedCredits });
        if (!wResp.error) {
          totalCredits += storedCredits;
          ctx.log("trade", `Withdrew ${storedCredits}cr from ${station.poiName}`);
        }
      }

      // Withdraw items (capped by free space)
      if (hasItems) {
        for (const item of bot.storage) {
          if (item.quantity <= 0) continue;
          await bot.refreshStatus();
          const freeSpace = bot.cargoMax > 0 ? bot.cargoMax - bot.cargo : 0;
          if (freeSpace <= 0) break;

          const qty = Math.min(item.quantity, maxItemsForCargo(freeSpace, item.itemId));
          if (qty <= 0) continue;
          const wResp = await bot.exec("withdraw_items", { item_id: item.itemId, quantity: qty });
          if (!wResp.error) {
            totalItems += qty;
            ctx.log("trade", `Withdrew ${qty}x ${item.name} from ${station.poiName}`);
          }
        }
      }

      // Refuel while docked
      await tryRefuel(ctx);

      // If cargo >= 80% full, deposit at home before continuing
      await bot.refreshStatus();
      const usedPct = bot.cargoMax > 0 ? (bot.cargo / bot.cargoMax) * 100 : 0;
      if (usedPct >= 80) {
        yield "deposit_home";
        ctx.log("trade", `Cargo ${Math.round(usedPct)}% full — depositing at home`);
        await depositAtHome(ctx, settings);
      }
    }

    // ── Final deposit ──
    yield "final_deposit";
    await bot.refreshCargo();
    const hasCargoLeft = bot.inventory.some(i => {
      if (i.quantity <= 0) return false;
      const lower = i.itemId.toLowerCase();
      return !lower.includes("fuel") && !lower.includes("energy_cell");
    });

    if (hasCargoLeft) {
      ctx.log("trade", "Final deposit run...");
      await depositAtHome(ctx, settings);
    }

    // Summary
    ctx.log("info", `Cleanup complete: ${totalCredits}cr + ${totalItems} items collected from ${stations.length} station(s)`);

    // Maintenance at home
    await ensureDocked(ctx);
    await tryRefuel(ctx);
    await repairShip(ctx);

    // Wait before next run
    ctx.log("info", "Next cleanup run in 5 minutes");
    await sleep(300000);
  }
};
