/**
 * Scout routine — visits systems and scans for market/POI data.
 * Lightweight port from v2's scout routine.
 * Purpose: gather intel by visiting stations and scanning markets.
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  getSystemInfo,
  findStation,
  ensureDocked,
  ensureUndocked,
  ensureFueled,
  navigateToSystem,
  detectAndRecoverFromDeath,
  readSettings,
  sleep,
  sleepBot,
  logStatus,
} from "./common.js";

const INTEL_COOLDOWN_MS = 30 * 60_000; // 30 min per-system cooldown
const lastIntelMs = new Map<string, number>(); // systemId → last submit timestamp

function getScoutSettings(): {
  refuelThreshold: number;
  scanDelayMs: number;
  maxJumps: number;
} {
  const all = readSettings();
  const s = all.scout || {};
  return {
    refuelThreshold: (s.refuelThreshold as number) || 60,
    scanDelayMs: (s.scanDelayMs as number) || 3000,
    maxJumps: (s.maxJumps as number) || 20,
  };
}

export const scoutRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  await bot.refreshStatus();
  const homeSystem = bot.system;

  ctx.log("system", "Scout online — scanning systems for intel...");

  let jumps = 0;

  while (bot.state === "running") {
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleepBot(ctx, 30000); continue; }

    const settings = getScoutSettings();

    // Refuel check
    yield "refuel_check";
    const fueled = await ensureFueled(ctx, settings.refuelThreshold);
    if (!fueled) {
      ctx.log("warn", "Low fuel — returning home...");
      if (homeSystem && bot.system !== homeSystem) {
        await ensureUndocked(ctx);
        await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: 20, hullThresholdPct: 30 });
      }
      await sleep(10000);
      continue;
    }

    // Scan current system
    yield "scan_system";
    const { pois, connections, systemId } = await getSystemInfo(ctx);
    ctx.log("info", `System ${systemId}: ${pois.length} POIs, ${connections.length} connections`);

    // Dock at station to scan market (if available)
    const station = findStation(pois);
    if (station) {
      yield "scan_market";
      await ensureDocked(ctx);
      ctx.log("info", `Scanning market at ${station.name}...`);
      const marketResp = await bot.exec("view_market");
      if (!marketResp.error) {
        ctx.log("info", `Market data collected at ${station.name}`);
        ctx.mapStore.updateMarket(systemId, bot.poi, marketResp.result as Record<string, unknown>);

        // Submit scan intel to faction (fire-and-forget, max once per 30 min per system)
        if (bot.factionId) {
          const nowMs = Date.now();
          if (nowMs - (lastIntelMs.get(systemId) ?? 0) >= INTEL_COOLDOWN_MS) {
            lastIntelMs.set(systemId, nowMs);
            const sysData = ctx.mapStore.getSystem(systemId);
            const sysPayload = sysData
              ? { system_id: sysData.id, name: sysData.name, pois: sysData.pois.map(p => ({ id: p.id, name: p.name, type: p.type })) }
              : { system_id: systemId };
            bot.exec("faction_submit_intel", { systems: [sysPayload] }).catch(() => {});
          }
        }
      }
      await sleep(settings.scanDelayMs);
      await ensureUndocked(ctx);
    }

    // Check if we should return or continue
    if (jumps >= settings.maxJumps) {
      ctx.log("info", `Reached ${jumps} jumps — returning home...`);
      if (homeSystem && bot.system !== homeSystem) {
        yield "return_home";
        await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
      }
      jumps = 0;
      await sleep(10000);
      continue;
    }

    // Pick a connected system to jump to (prefer unvisited)
    yield "choose_next";
    if (connections.length === 0) {
      ctx.log("warn", "No connections from current system — returning home...");
      if (homeSystem && bot.system !== homeSystem) {
        await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
      }
      jumps = 0;
      await sleep(10000);
      continue;
    }

    // Prefer systems we haven't visited (not in mapStore)
    const knownSystems = new Set(Object.keys(ctx.mapStore.getAllSystems()));
    const unvisited = connections.filter(c => !knownSystems.has(c.id));
    const target = unvisited.length > 0
      ? unvisited[Math.floor(Math.random() * unvisited.length)]
      : connections[Math.floor(Math.random() * connections.length)];

    // Check fuel cost
    const fuelCost = target.jump_cost || 10;
    if (bot.fuel < fuelCost + 10) {
      ctx.log("warn", "Not enough fuel for next jump — returning home...");
      if (homeSystem && bot.system !== homeSystem) {
        await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
      }
      jumps = 0;
      await sleep(10000);
      continue;
    }

    yield "jump";
    ctx.log("info", `Jumping to ${target.name} (${unvisited.length > 0 ? "unvisited" : "random"})...`);
    const jumpResp = await bot.exec("jump", { target_system: target.id });
    if (jumpResp.error) {
      ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
      await sleep(5000);
      continue;
    }

    jumps++;
    await bot.refreshStatus();
    logStatus(ctx);
    await sleep(settings.scanDelayMs);
  }
};
