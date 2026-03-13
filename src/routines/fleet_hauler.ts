import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  collectFromStorage,
  depositNonFuelCargo,
  getSystemPoisFromDb,
  getSystemInfo,
  findStation,
  navigateToSystem,
  readSettings,
  readFleetSettings,
  getFleetAssignment,
  sleepBot,
} from "./common.js";

const SIGNAL_MAX_AGE_MS = 10 * 60_000; // 10 min — ignore stale miner signals

// ── Settings ────────────────────────────────────────────────

function getSettings(): {
  depositSystemId: string;
  depositPoiId: string;
  cargoThresholdPct: number;
  cycleWaitSec: number;
} {
  const all = readSettings();
  const s = (all.fleet_hauler || {}) as Record<string, unknown>;
  const general = (all.general || {}) as Record<string, unknown>;
  return {
    depositSystemId: (s.depositSystemId as string) || (general.homeSystem as string) || "",
    depositPoiId: (s.depositPoiId as string) || (general.homeBase as string) || "",
    cargoThresholdPct: (s.cargoThresholdPct as number) || 40,
    cycleWaitSec: (s.cycleWaitSec as number) || 60,
  };
}

// ── Main routine ─────────────────────────────────────────────

export const fleetHaulerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  ctx.log("info", "⚓ Fleet Hauler starting...");

  while (bot.state === "running") {
    const assignment = getFleetAssignment(bot.username);
    if (!assignment || assignment.role !== "hauler") {
      ctx.log("warn", "No fleet assignment found or role is not 'hauler'. Waiting 60s...");
      yield "wait_assignment";
      await sleepBot(ctx, 60_000);
      continue;
    }

    const settings = getSettings();
    const { groups, signals, assignments } = readFleetSettings();
    const group = groups.find(g => g.id === assignment.groupId);

    if (!group) {
      ctx.log("warn", `Group '${assignment.groupId}' not found. Waiting 60s...`);
      yield "wait_group";
      await sleepBot(ctx, 60_000);
      continue;
    }

    // ── Find active miners in same group ──────────────────────
    const now = Date.now();
    const activeMiners = Object.entries(assignments)
      .filter(([, a]) => a.groupId === assignment.groupId && a.role === "miner")
      .map(([username]) => ({ username, signal: signals[username] }))
      .filter(m =>
        m.signal &&
        m.signal.systemId &&
        (now - (m.signal.lastUpdated ?? 0)) < SIGNAL_MAX_AGE_MS &&
        (m.signal.cargoPct ?? 0) >= settings.cargoThresholdPct,
      );

    if (activeMiners.length === 0) {
      ctx.log("info", `No active miners needing pickup in group '${group.name}'. Waiting ${settings.cycleWaitSec}s...`);
      yield "wait_miners";
      await sleepBot(ctx, settings.cycleWaitSec * 1_000);
      continue;
    }

    // Pick miner with highest cargo — most urgent
    const target = activeMiners.sort((a, b) => (b.signal.cargoPct ?? 0) - (a.signal.cargoPct ?? 0))[0];
    const targetSystem = target.signal.systemId!;
    ctx.log("info", `📦 Picking up from ${target.username}'s system (${targetSystem}), cargo ${target.signal.cargoPct}%`);

    // ── Navigate to miner's system ────────────────────────────
    yield "navigate_to_miner";
    await ensureUndocked(ctx);
    if (bot.system !== targetSystem) {
      const ok = await navigateToSystem(ctx, targetSystem, {
        fuelThresholdPct: 40,
        hullThresholdPct: 30,
      });
      if (!ok) {
        ctx.log("error", `Could not navigate to ${targetSystem}. Waiting...`);
        await sleepBot(ctx, 30_000);
        continue;
      }
    }

    // ── Find a station in target system and dock ──────────────
    yield "dock_at_station";
    let pois = getSystemPoisFromDb(ctx);
    if (!pois || pois.length === 0) {
      const sysInfo = await getSystemInfo(ctx);
      pois = sysInfo.pois;
    }

    const station = findStation(pois);
    if (!station) {
      ctx.log("warn", `No station in system ${targetSystem}. Cannot pickup. Skipping...`);
      await sleepBot(ctx, 30_000);
      continue;
    }

    if (bot.poi !== station.id) {
      await bot.exec("travel", { target_poi: station.id });
      bot.poi = station.id;
    }
    await ensureDocked(ctx);

    // ── Withdraw from faction storage ─────────────────────────
    yield "withdraw_cargo";
    ctx.log("info", `🏭 Withdrawing faction storage at ${station.name}...`);
    try {
      const _canFac = !bot.poi || (
        ctx.mapStore.hasFactionStorage(bot.poi) !== false &&
        ctx.mapStore.hasFactionStorageBuilding(bot.poi) !== false
      );
      const fResp = _canFac ? await bot.exec("view_faction_storage") : { result: {}, error: null };
      const fResult = (fResp?.result as Record<string, unknown>) ?? {};
      const items: any[] = (fResult.items as any[]) ?? [];
      let withdrawn = 0;
      for (const item of items) {
        if (!item.item_id || item.quantity <= 0) continue;
        if (item.item_id.startsWith("fuel") || item.item_id === "energy_cell") continue;
        const freeWeight = bot.cargoMax - bot.cargo;
        if (freeWeight <= 0) break;
        const qty = Math.min(item.quantity, Math.floor(freeWeight));
        if (qty <= 0) continue;
        const wResp = await bot.exec("faction_withdraw_items", { item_id: item.item_id, quantity: qty });
        if (!wResp.error) {
          bot.cargo = Math.min(bot.cargo + qty, bot.cargoMax);
          withdrawn += qty;
        }
      }
      if (withdrawn > 0) {
        ctx.log("trade", `Withdrew ${withdrawn} units from faction storage at ${station.name}`);
      } else {
        ctx.log("info", `Nothing to withdraw at ${station.name} — miners may not have deposited yet.`);
      }
    } catch (err) {
      ctx.log("warn", `Faction storage withdraw error: ${err}`);
    }

    await tryRefuel(ctx);
    await repairShip(ctx);
    await ensureUndocked(ctx);

    // ── Navigate to deposit destination ───────────────────────
    const destSystem = group.depositPoi ? (group.depositPoi.split(":")[0] || settings.depositSystemId) : settings.depositSystemId;
    const destPoi = group.depositPoi ? (group.depositPoi.split(":")[1] || settings.depositPoiId) : settings.depositPoiId;

    if (destSystem && destSystem !== bot.system) {
      yield "navigate_to_deposit";
      ctx.log("info", `🚀 Hauling to deposit system ${destSystem}...`);
      const ok2 = await navigateToSystem(ctx, destSystem, { fuelThresholdPct: 40, hullThresholdPct: 30 });
      if (!ok2) {
        ctx.log("error", `Could not navigate to deposit system ${destSystem}. Waiting...`);
        await sleepBot(ctx, 30_000);
        continue;
      }
    }

    // ── Dock at deposit station and deposit/sell ──────────────
    yield "deposit_cargo";
    let destPois = getSystemPoisFromDb(ctx);
    if (!destPois || destPois.length === 0) {
      const si = await getSystemInfo(ctx);
      destPois = si.pois;
    }

    let destStationPoi = destPoi ? destPois.find(p => p.id === destPoi) : findStation(destPois);
    if (!destStationPoi) destStationPoi = findStation(destPois) ?? undefined;

    if (destStationPoi) {
      if (bot.poi !== destStationPoi.id) {
        await bot.exec("travel", { target_poi: destStationPoi.id });
        bot.poi = destStationPoi.id;
      }
      await ensureDocked(ctx);
      await collectFromStorage(ctx);
      const deposited = await depositNonFuelCargo(ctx);
      ctx.log("trade", `Deposited ${deposited} cargo units at ${destStationPoi.name}`);
      await tryRefuel(ctx);
      await repairShip(ctx);
      await ensureUndocked(ctx);
    } else {
      ctx.log("warn", `No deposit station found in ${destSystem || bot.system} — cargo retained.`);
    }

    await sleepBot(ctx, 5_000);
  }
};
