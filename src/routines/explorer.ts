import type { Routine, RoutineContext } from "../bot.js";
import type { MapStore } from "../mapstore.js";
import {
  type SystemPOI,
  type Connection,
  isMinablePoi,
  isScenicPoi,
  isStationPoi,
  isWormholePoi,
  findStation,
  getSystemInfo,
  parseOreFromMineResult,
  collectFromStorage,
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  ensureFueled,
  depositCargoAtHome,
  depositCargoLocal,
  navigateToSystem,
  fetchSecurityLevel,
  scavengeWrecks,
  detectAndRecoverFromDeath,
  readSettings,
  sleep,
  logAgentEvent,
} from "./common.js";

/** Number of mine attempts per resource POI to sample ores. */
const SAMPLE_MINES = 5;

// ── Build Goal helpers ────────────────────────────────────────

interface GoalMaterial {
  item_id: string;
  item_name: string;
  quantity_needed: number;
  quantity_have: number;
}

interface BuildGoalSettings {
  type: string;
  target_id: string;
  target_name: string;
  assigned_bot: string;
  status: string;
  materials: GoalMaterial[];
}

/**
 * When docked at a station, buy any goal materials available on the market.
 * Only runs if `settings.buildGoal.assigned_bot` matches this bot.
 */
async function checkAndBuyGoalMaterials(
  ctx: RoutineContext,
  marketItems: Array<Record<string, unknown>>,
  poiName: string,
): Promise<void> {
  const { bot } = ctx;
  const settings = readSettings() as Record<string, unknown>;
  const goal = settings.buildGoal as BuildGoalSettings | undefined;
  if (!goal?.materials?.length) return;
  if (goal.assigned_bot && goal.assigned_bot !== bot.username) return;
  if (goal.status === "paused" || goal.status === "done") return;

  // Build sell-market lookup: item_id → cheapest entry with stock
  const marketMap: Record<string, { sell_price: number; sell_quantity: number }> = {};
  for (const item of marketItems) {
    const id = (item.item_id as string) || "";
    const sellQty = Number(item.sell_quantity ?? item.quantity ?? 0);
    const sellPrice = Number(item.sell_price ?? item.price ?? 0);
    if (id && sellQty > 0 && (!marketMap[id] || sellPrice < marketMap[id].sell_price)) {
      marketMap[id] = { sell_price: sellPrice, sell_quantity: sellQty };
    }
  }

  for (const task of goal.materials) {
    const needed = task.quantity_needed - (task.quantity_have ?? 0);
    if (needed <= 0) continue;
    const mkt = marketMap[task.item_id];
    if (!mkt) continue;

    await bot.refreshStatus();
    const cargoFree = bot.cargoMax > 0 ? bot.cargoMax - bot.cargo : 0;
    if (cargoFree <= 0) {
      ctx.log("info", `[Build Goal] Cargo full — pausing buys at ${poiName}`);
      break;
    }

    const toBuy = Math.min(needed, mkt.sell_quantity, cargoFree);
    if (toBuy <= 0) continue;

    const buyResp = await bot.exec("buy", { item_id: task.item_id, quantity: toBuy });
    if (!buyResp.error) {
      ctx.log("trade", `[Build Goal] Bought ${toBuy}x ${task.item_name} at ${poiName} (${mkt.sell_price.toLocaleString()} cr/ea)`);
    } else {
      ctx.log("info", `[Build Goal] Buy ${task.item_name} failed: ${buyResp.error.message}`);
    }
  }
}

/** Minimum fuel % before heading back to refuel. */
const FUEL_SAFETY_PCT = 40;
/** Minimum fuel % required before attempting a system jump. */
const JUMP_FUEL_PCT = 70;

// ── Mission helpers ───────────────────────────────────────────

const EXPLORER_MISSION_KEYWORDS = [
  "explore", "survey", "scan", "chart", "discover", "map", "navigate",
  "visit", "investigate", "reconnaissance", "recon", "scout", "patrol",
  "deliver", "supply", "collect",
];

/** Accept available exploration missions at the current station. Respects 5-mission cap. */
async function checkAndAcceptMissions(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;

  const activeResp = await bot.exec("get_active_missions");
  let activeCount = 0;
  if (activeResp.result && typeof activeResp.result === "object") {
    const r = activeResp.result as Record<string, unknown>;
    const list = Array.isArray(r) ? r : Array.isArray(r.missions) ? r.missions : [];
    activeCount = (list as unknown[]).length;
  }
  if (activeCount >= 5) return;

  const availResp = await bot.exec("get_missions");
  if (!availResp.result || typeof availResp.result !== "object") return;
  const r = availResp.result as Record<string, unknown>;
  const available = (
    Array.isArray(r) ? r :
    Array.isArray(r.missions) ? r.missions : []
  ) as Array<Record<string, unknown>>;

  for (const mission of available) {
    if (activeCount >= 5) break;
    const missionId = (mission.id as string) || (mission.mission_id as string) || "";
    if (!missionId) continue;
    const name = ((mission.name as string) || "").toLowerCase();
    const desc = ((mission.description as string) || "").toLowerCase();
    const type = ((mission.type as string) || "").toLowerCase();
    const isExplorerMission = EXPLORER_MISSION_KEYWORDS.some(kw =>
      name.includes(kw) || desc.includes(kw) || type.includes(kw)
    );
    if (!isExplorerMission) continue;
    const acceptResp = await bot.exec("accept_mission", { mission_id: missionId });
    if (!acceptResp.error) {
      activeCount++;
      ctx.log("info", `Mission accepted: ${(mission.name as string) || missionId} (${activeCount}/5 active)`);
    }
  }
}

/** Complete any active missions while docked. */
async function completeActiveMissions(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;

  const activeResp = await bot.exec("get_active_missions");
  if (!activeResp.result || typeof activeResp.result !== "object") return;
  const r = activeResp.result as Record<string, unknown>;
  const missions = (
    Array.isArray(r) ? r :
    Array.isArray(r.missions) ? r.missions : []
  ) as Array<Record<string, unknown>>;

  for (const mission of missions) {
    const missionId = (mission.id as string) || (mission.mission_id as string) || "";
    if (!missionId) continue;
    const completeResp = await bot.exec("complete_mission", { mission_id: missionId });
    if (!completeResp.error) {
      const reward = (mission.reward as number) || (mission.reward_credits as number) || 0;
      ctx.log("trade", `Mission complete: ${(mission.name as string) || missionId}${reward > 0 ? ` (+${reward} credits)` : ""}`);
      await bot.refreshStatus();
    }
  }
}

/** Minutes before a station's market/orders/missions data is considered stale. */
const STATION_REFRESH_MINS = 30;
/** Minutes before a resource POI should be re-sampled. */
const RESOURCE_REFRESH_MINS = 120;

// ── Per-bot settings ─────────────────────────────────────────

export type ExplorerMode = "explore" | "trade_update";

function getExplorerSettings(username?: string): {
  mode: ExplorerMode;
  acceptMissions: boolean;
} {
  const all = readSettings();
  const botOverrides = username ? (all[username] || {}) : {};
  const mode = (botOverrides.explorerMode as string) || "explore";
  const e = all.explorer || {};

  // acceptMissions: per-bot > global explorer > default true
  const acceptMissions = botOverrides.acceptMissions !== undefined
    ? Boolean(botOverrides.acceptMissions)
    : e.acceptMissions !== undefined
      ? Boolean(e.acceptMissions)
      : true;

  return {
    mode: (mode === "trade_update" ? "trade_update" : "explore") as ExplorerMode,
    acceptMissions,
  };
}

/**
 * Explorer routine — systematically maps the galaxy:
 *
 * Exploration logic per POI:
 *   - Scenic (sun, star, gate): visit once, never revisit
 *   - Resource (belt, gas cloud, etc.): sample mine, revisit every RESOURCE_REFRESH_MINS
 *   - Station: dock, scan market/orders/missions, revisit every STATION_REFRESH_MINS
 *   - Other (planet, anomaly, etc.): check nearby, revisit every RESOURCE_REFRESH_MINS
 *
 * After visiting all POIs in a system, jump to least-explored connected system.
 */
export const explorerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  // Check per-bot mode
  const initialSettings = getExplorerSettings(bot.username);
  if (initialSettings.mode === "trade_update") {
    yield* tradeUpdateRoutine(ctx);
    return;
  }

  const visitedSystems = new Set<string>();

  // ── Startup: dock at local station to clear cargo & refuel ──
  yield "startup_prep";
  await bot.refreshStatus();
  const { pois: startPois } = await getSystemInfo(ctx);
  const startStation = findStation(startPois);
  if (startStation) {
    ctx.log("system", `Startup: docking at ${startStation.name} to clear cargo & refuel...`);

    // Travel to station if not already there
    if (bot.poi !== startStation.id) {
      await ensureUndocked(ctx);
      const tResp = await bot.exec("travel", { target_poi: startStation.id });
      if (tResp.error && !tResp.error.message.includes("already")) {
        ctx.log("error", `Could not reach station: ${tResp.error.message}`);
      }
    }

    // Dock
    if (!bot.docked) {
      const dResp = await bot.exec("dock");
      if (!dResp.error || dResp.error.message.includes("already")) {
        bot.docked = true;
      }
    }

    if (bot.docked) {
      // Collect gifted credits/items from storage
      await collectFromStorage(ctx);

      // Deposit non-fuel cargo
      yield "startup_deposit";
      const cargoResp = await bot.exec("get_cargo");
      if (cargoResp.result && typeof cargoResp.result === "object") {
        const cResult = cargoResp.result as Record<string, unknown>;
        const cargoItems = (
          Array.isArray(cResult) ? cResult :
          Array.isArray(cResult.items) ? (cResult.items as Array<Record<string, unknown>>) :
          Array.isArray(cResult.cargo) ? (cResult.cargo as Array<Record<string, unknown>>) :
          []
        );
        let deposited = 0;
        for (const item of cargoItems) {
          const itemId = (item.item_id as string) || "";
          const quantity = (item.quantity as number) || 0;
          if (!itemId || quantity <= 0) continue;
          const lower = itemId.toLowerCase();
          if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
          const displayName = (item.name as string) || itemId;
          ctx.log("trade", `Depositing ${quantity}x ${displayName}...`);
          await bot.exec("deposit_items", { item_id: itemId, quantity });
          deposited += quantity;
        }
        if (deposited > 0) ctx.log("trade", `Deposited ${deposited} items to storage`);
      }

      // Refuel
      yield "startup_refuel";
      await tryRefuel(ctx);
      await bot.refreshStatus();
      const startFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      ctx.log("system", `Startup complete — Fuel: ${startFuel}% | Cargo: ${bot.cargo}/${bot.cargoMax}`);
    }
  } else {
    ctx.log("system", "No station in current system — skipping startup prep");
  }

  while (bot.state === "running") {
    // ── Death recovery ──
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleep(30000); continue; }

    // ── Get current system data ──
    yield "scan_system";
    await bot.refreshStatus();
    const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    ctx.log("info", `Exploring ${bot.system} — ${bot.credits} cr, ${fuelPct}% fuel, ${bot.cargo}/${bot.cargoMax} cargo`);

    let { pois, connections, systemId } = await getSystemInfo(ctx);
    if (!systemId) {
      ctx.log("error", "Could not determine current system — waiting 30s");
      await sleep(30000);
      continue;
    }
    visitedSystems.add(systemId);

    // Try to capture security level
    await fetchSecurityLevel(ctx, systemId);

    // ── Survey the system to reveal hidden POIs ──
    yield "survey_system";
    const surveyResp = await bot.exec("survey_system");
    if (!surveyResp.error) {
      ctx.log("info", `Surveyed ${bot.system} — checking for newly revealed POIs...`);
      // Parse deposit data if the survey response includes resource info
      if (surveyResp.result && typeof surveyResp.result === "object") {
        const sr = surveyResp.result as Record<string, unknown>;
        const surveyPois = (Array.isArray(sr.pois) ? sr.pois : []) as Array<Record<string, unknown>>;
        for (const sp of surveyPois) {
          const spResources = (Array.isArray(sp.resources) ? sp.resources : []) as Array<Record<string, unknown>>;
          const spId = (sp.id as string) || "";
          if (spId && spResources.length > 0) {
            const sysSt = ctx.mapStore.getSystem(systemId);
            ctx.mapStore.updateDeposits(
              spId, systemId, sysSt?.name ?? systemId,
              (sp.name as string) || spId, (sp.type as string) || "unknown",
              spResources, bot.username,
            );
          }
        }
      }
      // Re-fetch system info to pick up any hidden POIs that were revealed
      const refreshed = await getSystemInfo(ctx);
      if (refreshed.pois.length > pois.length) {
        ctx.log("info", `Survey revealed ${refreshed.pois.length - pois.length} new POI(s)!`);
      }
      pois = refreshed.pois;
      connections = refreshed.connections;

      // Detect wormhole POIs revealed by this survey and resolve their destinations
      for (const poi of pois) {
        if (!isWormholePoi(poi.type)) continue;
        const sysInfo = ctx.mapStore.getSystem(systemId);
        const sysName = sysInfo?.name ?? systemId;
        const existing = ctx.mapStore.getWormhole(poi.id);

        if (!existing) {
          // New wormhole — record as active, try to resolve destination via get_poi
          ctx.log("info", `Wormhole detected: ${poi.name || poi.id} (${poi.type})`);
          ctx.mapStore.upsertWormhole({
            entrance_poi_id: poi.id,
            entrance_system_id: systemId,
            entrance_system_name: sysName,
            exit_system_id: "",
            exit_system_name: "",
            exit_poi_id: "",
            status: "active",
            discovered_by: bot.username,
            last_seen_at: new Date().toISOString(),
            expires_estimated_at: null,
            collapse_seen_at: null,
          });
        } else if (existing.status === "collapsed") {
          ctx.log("info", `Wormhole remnant: ${poi.name || poi.id} — still visible`);
          ctx.mapStore.markWormholeSeen(poi.id);
          continue;
        } else {
          ctx.mapStore.markWormholeSeen(poi.id);
        }

        // Only resolve destination for active wormholes with unknown exit
        const wh = ctx.mapStore.getWormhole(poi.id);
        if (wh && wh.status === "active" && !wh.exit_system_id) {
          yield "wormhole_probe";
          const poiResp = await bot.exec("get_poi", { poi_id: poi.id });
          if (!poiResp.error && poiResp.result && typeof poiResp.result === "object") {
            const pr = poiResp.result as Record<string, unknown>;
            const exitSysId   = (pr.wormhole_destination_id as string) ?? "";
            const exitSysName = (pr.wormhole_destination as string) ?? "";
            const poiObj      = pr.poi as Record<string, unknown> | undefined;
            const exitPoiId   = (poiObj?.id as string) ?? "";
            const expiresRaw  = (poiObj?.expires_at as string) ?? null;
            if (exitSysId) {
              ctx.log("info", `Wormhole ${poi.id} → ${exitSysName || exitSysId}`);
              ctx.mapStore.upsertWormhole({
                entrance_poi_id: poi.id,
                entrance_system_id: systemId,
                entrance_system_name: sysName,
                exit_system_id: exitSysId,
                exit_system_name: exitSysName,
                exit_poi_id: exitPoiId,
                status: "active",
                discovered_by: bot.username,
                last_seen_at: new Date().toISOString(),
                expires_estimated_at: expiresRaw,
                collapse_seen_at: null,
              });
            }
          }
        }
      }

      // Check for collapsed wormholes (was known active, no longer in POI list)
      for (const knownWh of ctx.mapStore.getWormholesBySystem(systemId)) {
        if (knownWh.status !== "active") continue;
        const stillPresent = pois.some(p => p.id === knownWh.entrance_poi_id);
        if (!stillPresent) {
          ctx.log("info", `Wormhole ${knownWh.entrance_poi_id} no longer detected — may have collapsed`);
          ctx.mapStore.markWormholeCollapsed(knownWh.entrance_poi_id);
        }
      }
    } else {
      const msg = surveyResp.error.message.toLowerCase();
      // Don't log for expected errors like "already surveyed" or skill-related
      if (!msg.includes("already") && !msg.includes("cooldown")) {
        ctx.log("info", `Survey: ${surveyResp.error.message}`);
      }
    }

    // ── Classify POIs and determine what needs visiting ──
    const toVisit: Array<{ poi: SystemPOI; reason: string }> = [];
    let skippedCount = 0;

    for (const poi of pois) {
      const isStation = isStationPoi(poi);
      const isMinable = isMinablePoi(poi.type);
      const isScenic = isScenicPoi(poi.type);
      const isWormhole = isWormholePoi(poi.type);
      const minutesAgo = ctx.mapStore.minutesSinceExplored(systemId, poi.id);

      if (isStation) {
        if (minutesAgo < STATION_REFRESH_MINS) { skippedCount++; continue; }
        toVisit.push({ poi, reason: minutesAgo === Infinity ? "new" : "refresh" });
      } else if (isMinable) {
        const storedPoi = ctx.mapStore.getSystem(systemId)?.pois.find(p => p.id === poi.id);
        const hasOreData = (storedPoi?.ores_found?.length ?? 0) > 0;
        if (minutesAgo < RESOURCE_REFRESH_MINS && hasOreData) { skippedCount++; continue; }
        toVisit.push({ poi, reason: minutesAgo === Infinity ? "new" : (hasOreData ? "re-sample" : "no-data") });
      } else if (isWormhole) {
        // Visit active wormholes to confirm status; skip collapsed remnants
        const wh = ctx.mapStore.getWormhole(poi.id);
        if (wh?.status === "collapsed") { skippedCount++; continue; }
        if (minutesAgo < STATION_REFRESH_MINS) { skippedCount++; continue; }
        toVisit.push({ poi, reason: wh?.exit_system_id ? "confirm" : "new" });
      } else if (isScenic) {
        if (minutesAgo < Infinity) { skippedCount++; continue; }
        toVisit.push({ poi, reason: "new" });
      } else {
        if (minutesAgo < RESOURCE_REFRESH_MINS) { skippedCount++; continue; }
        toVisit.push({ poi, reason: minutesAgo === Infinity ? "new" : "refresh" });
      }
    }

    if (toVisit.length === 0) {
      ctx.log("info", `${bot.system}: all ${skippedCount} POIs up to date — moving on`);
    } else {
      ctx.log("info", `${bot.system}: ${toVisit.length} to visit, ${skippedCount} already explored`);
    }

    // ── Hull check — repair if <= 40% ──
    await bot.refreshStatus();
    const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    if (hullPct <= 40) {
      ctx.log("system", `Hull critical (${hullPct}%) — finding station for repair`);
      const docked = await ensureDocked(ctx);
      if (docked) {
        await repairShip(ctx);
      }
    }

    // ── Ensure fueled before exploring ──
    yield "fuel_check";
    const fueled = await ensureFueled(ctx, FUEL_SAFETY_PCT);
    if (!fueled) {
      ctx.log("error", "Could not refuel — waiting 30s before retry...");
      await sleep(30000);
      continue;
    }

    // If hull repair or refueling moved us to a different system, restart the loop
    await bot.refreshStatus();
    if (bot.system !== systemId) {
      ctx.log("info", `Moved to ${bot.system} during repair/refuel — restarting system scan`);
      continue;
    }

    // ── Undock if docked ──
    await ensureUndocked(ctx);

    // Find station for emergency refueling
    const station = findStation(pois);

    // ── Visit each POI ──
    for (const { poi, reason } of toVisit) {
      if (bot.state !== "running") break;

      const isMinable = isMinablePoi(poi.type);
      const isStation = isStationPoi(poi);

      // Check fuel before traveling to each POI (skip if cached fuel is clearly above threshold)
      const cachedFuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (cachedFuelPct < FUEL_SAFETY_PCT + 15) {
        yield "fuel_check";
        const poiFueled = await ensureFueled(ctx, FUEL_SAFETY_PCT);
        if (!poiFueled) {
          ctx.log("error", "Could not refuel — restarting system loop...");
          break;
        }
        // ensureFueled already called refreshStatus internally
        if (bot.system !== systemId) {
          ctx.log("info", `Moved to ${bot.system} during refuel — restarting system scan`);
          break;
        }
        await ensureUndocked(ctx);
      }

      yield `visit_${poi.id}`;
      const travelResp = await bot.exec("travel", { target_poi: poi.id });
      if (travelResp.error && !travelResp.error.message.includes("already")) {
        ctx.log("error", `Travel to ${poi.name} failed: ${travelResp.error.message}`);
        continue;
      }
      bot.poi = poi.id;

      if (isMinable) {
        yield* sampleResourcePoi(ctx, systemId, poi);
      } else if (isStation) {
        yield* scanStation(ctx, systemId, poi);
      } else {
        yield* visitOtherPoi(ctx, systemId, poi);
      }

      // ── Check cargo — if nearly full, deposit at nearest in-system station ──
      await bot.refreshStatus();
      if (bot.cargoMax > 0 && bot.cargoMax - bot.cargo < 5) {
        yield "deposit_cargo";
        await depositCargoLocal(ctx, pois, { fuelThresholdPct: FUEL_SAFETY_PCT, hullThresholdPct: 30 });
        // May have moved to a different system (no local station fallback)
        await bot.refreshStatus();
        if (bot.system !== systemId) {
          ctx.log("info", `Moved to ${bot.system} after deposit — restarting system scan`);
          break;
        }
      }
    }

    if (bot.state !== "running") break;

    // ── Check skills for level-ups ──
    yield "check_skills";
    await bot.checkSkills();

    // ── Pick next system to explore ──
    yield "pick_next_system";

    // ALWAYS ensure fueled before jumping — will navigate to nearest station if needed
    yield "pre_jump_fuel";
    const jumpFueled = await ensureFueled(ctx, JUMP_FUEL_PCT);
    if (!jumpFueled) {
      ctx.log("error", "Could not refuel before jump — waiting 30s...");
      await sleep(30000);
      continue;
    }

    const validConns = connections.filter(c => c.id);
    let nextSystem = pickNextSystem(validConns, visitedSystems, ctx.mapStore);
    if (!nextSystem) {
      // Phase 7.3: Try search_systems API to find unexplored/high-value targets
      let searchTarget: string | null = null;
      const searchResp = await bot.exec("search_systems", {
        query: "unexplored",
      }).catch(() => null);

      if (searchResp && !searchResp.error && searchResp.result) {
        const sr = searchResp.result as Record<string, unknown>;
        const found = (
          Array.isArray(sr) ? sr :
          Array.isArray(sr.systems) ? sr.systems :
          []
        ) as Array<Record<string, unknown>>;

        if (found.length > 0) {
          const candidate = found[0];
          const cId = (candidate.id as string) || (candidate.system_id as string) || "";
          if (cId && !visitedSystems.has(cId)) {
            searchTarget = cId;
            ctx.log("info", `search_systems: routing to unexplored ${(candidate.name as string) || cId}`);
          }
        }
      }

      if (searchTarget) {
        // Navigate to the search result via multi-hop route
        await ensureUndocked(ctx);
        const routed = await navigateToSystem(ctx, searchTarget, { fuelThresholdPct: JUMP_FUEL_PCT, hullThresholdPct: 20 });
        if (routed) { continue; }
      }

      ctx.log("info", "All connected systems explored! Picking a random connection...");
      if (validConns.length > 0) {
        // Ensure fuel before random jump
        const rndFueled = await ensureFueled(ctx, JUMP_FUEL_PCT);
        if (!rndFueled) {
          ctx.log("error", "Cannot refuel for random jump — waiting 30s...");
          await sleep(30000);
          continue;
        }
        const random = validConns[Math.floor(Math.random() * validConns.length)];
        await ensureUndocked(ctx);
        ctx.log("travel", `Jumping to ${random.name || random.id}...`);
        const jumpResp = await bot.exec("jump", { target_system: random.id });
        if (jumpResp.error) {
          ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
          await sleep(10000);
        }
      } else {
        ctx.log("error", "No connections from this system — stuck! Waiting 60s...");
        await sleep(60000);
      }
      continue;
    }

    // Final fuel verify before jumping
    await bot.refreshStatus();
    const preJumpFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    if (preJumpFuel < 25) {
      ctx.log("system", `Fuel too low for jump (${preJumpFuel}%) — refueling first...`);
      const jf = await ensureFueled(ctx, JUMP_FUEL_PCT);
      if (!jf) {
        ctx.log("error", "Cannot refuel — waiting 30s...");
        await sleep(30000);
        continue;
      }
    }

    await ensureUndocked(ctx);
    ctx.log("travel", `Jumping to ${nextSystem.name || nextSystem.id}...`);
    const jumpResp = await bot.exec("jump", { target_system: nextSystem.id });
    if (jumpResp.error) {
      const msg = jumpResp.error.message.toLowerCase();
      if (msg.includes("fuel")) {
        ctx.log("error", "Insufficient fuel for jump — will refuel next loop");
      } else {
        ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
      }
      await sleep(10000);
      continue;
    }

    ctx.log("travel", `Jumped to ${nextSystem.name || nextSystem.id}`);
    bot.stats.totalSystems++;
  }
};

// ── POI visit sub-routines ───────────────────────────────────

/** Sample mine at a resource POI to discover ores. */
async function* sampleResourcePoi(
  ctx: RoutineContext,
  systemId: string,
  poi: SystemPOI,
): AsyncGenerator<string, void, void> {
  const { bot } = ctx;
  yield `sample_${poi.id}`;

  // Always call get_poi first — records resource list without needing a mining module.
  // Covers gas clouds and ice fields which the explorer can't mine directly.
  const poiDetailResp = await bot.exec("get_poi");
  if (!poiDetailResp.error && poiDetailResp.result && typeof poiDetailResp.result === "object") {
    const pr = poiDetailResp.result as Record<string, unknown>;
    const apiResources = (Array.isArray(pr.resources) ? pr.resources : []) as Array<Record<string, unknown>>;
    if (apiResources.length > 0) {
      const sysSt = ctx.mapStore.getSystem(systemId);
      ctx.mapStore.updateDeposits(
        poi.id, systemId, sysSt?.name ?? systemId,
        poi.name, poi.type, apiResources, bot.username,
      );
      const resNames = apiResources
        .map(r => (r.name as string) || (r.resource_id as string) || "")
        .filter(Boolean).join(", ");
      if (resNames) ctx.log("mining", `POI ${poi.name}: resources — ${resNames}`);
    }
  }

  // Skip mine attempts for gas/ice POIs when the ship lacks the required harvester module
  const poiTypeLower = poi.type.toLowerCase();
  if (bot.shipModules.length > 0) {
    const needsGas = poiTypeLower.includes("gas");
    const needsIce = poiTypeLower.includes("ice");
    const hasGas = bot.shipModules.some(m =>
      (m.type_id || "").includes("gas_harvester") || (m.name || "").toLowerCase().includes("gas harvester"));
    const hasIce = bot.shipModules.some(m =>
      (m.type_id || "").includes("ice_harvester") || (m.name || "").toLowerCase().includes("ice harvester"));
    if ((needsGas && !hasGas) || (needsIce && !hasIce)) {
      ctx.mapStore.markExplored(systemId, poi.id);
      return;
    }
  }

  const oresFound = new Set<string>();
  let mined = 0;
  let cantMine = false;

  for (let i = 0; i < SAMPLE_MINES && bot.state === "running"; i++) {
    const mineResp = await bot.exec("mine");

    if (mineResp.error) {
      const msg = mineResp.error.message.toLowerCase();
      if (msg.includes("no asteroids") || msg.includes("depleted") || msg.includes("no minable") || msg.includes("nothing to mine")) break;
      if (msg.includes("cargo") && msg.includes("full")) break;
      // Missing module (gas/ice harvester) — resource data already recorded via get_poi above
      if (msg.includes("gas harvester") || msg.includes("ice harvester")) {
        ctx.mapStore.markExplored(systemId, poi.id);
        return;
      }
      if (mined === 0) cantMine = true;
      break;
    }

    mined++;
    const { oreId, oreName } = parseOreFromMineResult(mineResp.result);
    if (oreId) {
      ctx.mapStore.recordMiningYield(systemId, poi.id, { item_id: oreId, name: oreName });
      oresFound.add(oreName);
    }

    yield "sampling";
  }

  // Single summary line
  if (oresFound.size > 0) {
    ctx.log("mining", `Sampled ${poi.name}: ${[...oresFound].join(", ")} (${mined} cycles)`);
  }

  if (!cantMine) {
    ctx.mapStore.markExplored(systemId, poi.id);
  }
}

/** Dock at station, scan market/orders/missions, refuel. */
async function* scanStation(
  ctx: RoutineContext,
  systemId: string,
  poi: SystemPOI,
): AsyncGenerator<string, void, void> {
  const { bot } = ctx;

  yield `dock_${poi.id}`;
  const dockResp = await bot.exec("dock");
  if (dockResp.error && !dockResp.error.message.includes("already")) {
    ctx.log("error", `Dock failed at ${poi.name}: ${dockResp.error.message}`);
    return;
  }
  bot.docked = true;

  await collectFromStorage(ctx);

  // Complete active missions (while cargo still intact from exploration)
  const stationSettings = getExplorerSettings(bot.username);
  if (stationSettings.acceptMissions) {
    yield `complete_missions_${poi.id}`;
    await completeActiveMissions(ctx);
  }

  // Scan market, orders, missions — collect stats for summary
  yield `scan_${poi.id}`;
  let marketCount = 0;
  let missionCount = 0;

  const marketResp = await bot.exec("view_market");
  let marketItemsList: Array<Record<string, unknown>> = [];
  if (marketResp.result && typeof marketResp.result === "object") {
    ctx.mapStore.updateMarket(systemId, poi.id, marketResp.result as Record<string, unknown>);
    const result = marketResp.result as Record<string, unknown>;
    marketItemsList = (
      Array.isArray(result) ? result :
      Array.isArray(result.items) ? result.items :
      Array.isArray(result.market) ? result.market :
      []
    ) as Array<Record<string, unknown>>;
    marketCount = marketItemsList.length;

    // Submit trade intel to faction (fire-and-forget, delayed to avoid 409 tick-rate collision)
    if (bot.factionId && poi.id && marketItemsList.length > 0) {
      const intelItems = marketItemsList
        .filter(i => i.buy_price != null || i.sell_price != null || i.buy != null || i.sell != null)
        .map(i => ({
          item_id:     ((i.item_id as string) || (i.id as string) || ""),
          item_name:   ((i.name as string) || (i.item_name as string) || ""),
          best_buy:    (i.buy_price as number) ?? (i.buy as number) ?? null,
          best_sell:   (i.sell_price as number) ?? (i.sell as number) ?? null,
          buy_volume:  (i.buy_quantity as number) ?? (i.buy_volume as number) ?? 0,
          sell_volume: (i.sell_quantity as number) ?? (i.sell_volume as number) ?? 0,
        }))
        .filter(i => i.item_id);
      if (intelItems.length > 0) {
        const poiId = poi.id;
        const stationName = poi.name || poiId;
        setTimeout(() => {
          bot.exec("faction_submit_trade_intel", {
            stations: [{ base_id: poiId, station_name: stationName, items: intelItems }],
          }).catch(() => {});
        }, 11_000);
      }
    }
  }

  // Buy build goal materials if this bot is assigned and they're on the market
  yield `goal_buy_${poi.id}`;
  await checkAndBuyGoalMaterials(ctx, marketItemsList, poi.name);

  const missionsResp = await bot.exec("get_missions");
  if (missionsResp.result && typeof missionsResp.result === "object") {
    const mData = missionsResp.result as Record<string, unknown>;
    const missions = (
      Array.isArray(mData) ? mData :
      Array.isArray(mData.missions) ? mData.missions :
      Array.isArray(mData.available) ? mData.available :
      Array.isArray(mData.available_missions) ? mData.available_missions :
      []
    ) as Array<Record<string, unknown>>;
    if (missions.length > 0) {
      ctx.mapStore.updateMissions(systemId, poi.id, missions);
      missionCount = missions.length;
    }
  }

  // Station scan summary
  const scanParts: string[] = [];
  if (marketCount > 0) scanParts.push(`${marketCount} market items`);
  if (missionCount > 0) scanParts.push(`${missionCount} missions`);
  ctx.log("info", `Scanned ${poi.name}: ${scanParts.length > 0 ? scanParts.join(", ") : "empty station"}`);

  // Refuel
  yield `refuel_${poi.id}`;
  await bot.refreshStatus();
  const stationFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (stationFuel < 90) {
    await tryRefuel(ctx);
  }

  // Deposit non-fuel cargo to station storage
  yield `deposit_${poi.id}`;
  const depositedItems: string[] = [];
  const cargoResp = await bot.exec("get_cargo");
  if (cargoResp.result && typeof cargoResp.result === "object") {
    const cResult = cargoResp.result as Record<string, unknown>;
    const cargoItems = (
      Array.isArray(cResult) ? cResult :
      Array.isArray(cResult.items) ? cResult.items :
      Array.isArray(cResult.cargo) ? cResult.cargo :
      []
    ) as Array<Record<string, unknown>>;

    // Build set of item_ids needed by active build goal — don't deposit those
    const goalSettings = readSettings() as Record<string, unknown>;
    const activeGoal = goalSettings.buildGoal as BuildGoalSettings | undefined;
    const goalItemIds = new Set<string>(
      (activeGoal?.assigned_bot === bot.username &&
       activeGoal?.status !== "done" &&
       activeGoal?.status !== "paused")
        ? (activeGoal.materials ?? []).map((m: GoalMaterial) => m.item_id)
        : [],
    );

    for (const item of cargoItems) {
      const itemId = (item.item_id as string) || "";
      const quantity = (item.quantity as number) || 0;
      if (!itemId || quantity <= 0) continue;
      const lower = itemId.toLowerCase();
      if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
      // Keep goal materials in cargo — don't deposit them
      if (goalItemIds.has(itemId)) continue;

      const displayName = (item.name as string) || itemId;
      await bot.exec("deposit_items", { item_id: itemId, quantity });
      depositedItems.push(`${quantity}x ${displayName}`);
      yield "depositing";
    }
  }
  if (depositedItems.length > 0) {
    ctx.log("trade", `Deposited ${depositedItems.join(", ")} to storage`);
  }

  // Accept new exploration missions before leaving
  if (stationSettings.acceptMissions) {
    yield `accept_missions_${poi.id}`;
    await checkAndAcceptMissions(ctx);
  }

  // Undock
  yield `undock_${poi.id}`;
  await bot.exec("undock");
  bot.docked = false;

  ctx.mapStore.markExplored(systemId, poi.id);
}

/** Visit a non-minable, non-station POI — check what's nearby. */
async function* visitOtherPoi(
  ctx: RoutineContext,
  systemId: string,
  poi: SystemPOI,
): AsyncGenerator<string, void, void> {
  const { bot } = ctx;

  yield `scan_${poi.id}`;
  const nearbyResp = await bot.exec("get_nearby");
  if (nearbyResp.result && typeof nearbyResp.result === "object") {
    const nr = nearbyResp.result as Record<string, unknown>;
    const objects = (nr.objects || nr.results || nr.ships || nr.players || []) as unknown[];
    if (objects.length > 0) {
      ctx.log("info", `Visited ${poi.name}: ${objects.length} objects nearby`);
    }
  }

  ctx.mapStore.markExplored(systemId, poi.id);
}

// ── Trade Update routine ─────────────────────────────────────

/**
 * Trade update mode — cycles through known systems with stations,
 * refreshing market/orders/missions data. Stays in known space.
 */
async function* tradeUpdateRoutine(ctx: RoutineContext): AsyncGenerator<string, void, void> {
  const { bot } = ctx;

  await bot.refreshStatus();
  const homeSystem = bot.system;

  ctx.log("system", "Trade Update mode — cycling known stations to refresh market data...");

  // ── Startup: dock, refuel, deposit cargo ──
  yield "startup_prep";
  const { pois: startPois } = await getSystemInfo(ctx);
  const startStation = findStation(startPois);
  if (startStation) {
    if (bot.poi !== startStation.id) {
      await ensureUndocked(ctx);
      await bot.exec("travel", { target_poi: startStation.id });
    }
    await ensureDocked(ctx);
    await collectFromStorage(ctx);
    await tryRefuel(ctx);
    await bot.refreshStatus();
  }

  while (bot.state === "running") {
    // ── Death recovery ──
    const alive2 = await detectAndRecoverFromDeath(ctx);
    if (!alive2) { await sleep(30000); continue; }

    // Re-read settings each cycle — user might switch mode mid-run
    const modeCheck = getExplorerSettings(bot.username);
    if (modeCheck.mode !== "trade_update") {
      ctx.log("system", "Mode changed to explore — restarting as explorer...");
      break;
    }

    // ── Build list of known systems with stations, sorted by stalest market data ──
    yield "plan_route";
    const allSystems = ctx.mapStore.getAllSystems();
    const stationSystems: Array<{ systemId: string; systemName: string; stationPoi: string; stationName: string; staleMins: number }> = [];

    for (const [sysId, sys] of Object.entries(allSystems)) {
      for (const poi of sys.pois) {
        if (!poi.has_base) continue;
        // Find the stalest market entry, or Infinity if no market data
        let oldestMins = Infinity;
        if (poi.market && poi.market.length > 0) {
          for (const m of poi.market) {
            if (m.last_updated) {
              const mins = (Date.now() - new Date(m.last_updated).getTime()) / 60000;
              if (mins < oldestMins) oldestMins = mins;
            }
          }
        }
        stationSystems.push({
          systemId: sysId,
          systemName: sys.name,
          stationPoi: poi.id,
          stationName: poi.name,
          staleMins: oldestMins,
        });
      }
    }

    // Sort: stalest data first (or no data = Infinity first)
    stationSystems.sort((a, b) => b.staleMins - a.staleMins);

    if (stationSystems.length === 0) {
      ctx.log("info", "No known stations on map — run an explorer in 'explore' mode first. Waiting 60s...");
      await sleep(60000);
      continue;
    }

    ctx.log("info", `Found ${stationSystems.length} known stations to update`);

    // ── Visit each station ──
    for (const target of stationSystems) {
      if (bot.state !== "running") break;

      // Re-check mode
      const mc = getExplorerSettings(bot.username);
      if (mc.mode !== "trade_update") {
        ctx.log("system", "Mode changed — stopping trade update loop");
        break;
      }

      // Skip if recently updated (< 15 mins)
      const freshCheck = ctx.mapStore.minutesSinceExplored(target.systemId, target.stationPoi);
      if (freshCheck < 15) {
        continue;
      }

      // ── Navigate to target system if needed ──
      yield "fuel_check";
      const fueled = await ensureFueled(ctx, FUEL_SAFETY_PCT);
      if (!fueled) {
        ctx.log("error", "Cannot refuel — waiting 30s...");
        await sleep(30000);
        continue;
      }

      if (target.systemId !== bot.system) {
        yield "navigate";
        await ensureUndocked(ctx);
        const arrived = await navigateToSystem(ctx, target.systemId, { fuelThresholdPct: FUEL_SAFETY_PCT, hullThresholdPct: 30 });
        if (!arrived) {
          ctx.log("error", `Could not reach ${target.systemName} — skipping`);
          continue;
        }
      }

      if (bot.state !== "running") break;

      // ── Travel to station POI ──
      yield "travel_to_station";
      await ensureUndocked(ctx);
      const tResp = await bot.exec("travel", { target_poi: target.stationPoi });
      if (tResp.error && !tResp.error.message.includes("already")) {
        ctx.log("error", `Travel failed: ${tResp.error.message}`);
        continue;
      }
      bot.poi = target.stationPoi;

      // ── Scavenge wrecks en route ──
      yield "scavenge";
      await scavengeWrecks(ctx);

      // ── Dock and scan ──
      yield "scan_station";
      const sysPois = (await getSystemInfo(ctx)).pois;
      const stPoi = sysPois.find(p => p.id === target.stationPoi);
      if (stPoi) {
        yield* scanStation(ctx, target.systemId, stPoi);
      } else {
        // POI not found in live data — try docking anyway
        const dResp = await bot.exec("dock");
        if (!dResp.error || dResp.error.message.includes("already")) {
          bot.docked = true;
          await collectFromStorage(ctx);

          const marketResp = await bot.exec("view_market");
          if (marketResp.result && typeof marketResp.result === "object") {
            ctx.mapStore.updateMarket(target.systemId, target.stationPoi, marketResp.result as Record<string, unknown>);
          }

          const missResp = await bot.exec("get_missions");
          if (missResp.result && typeof missResp.result === "object") {
            const mData = missResp.result as Record<string, unknown>;
            const missions = (
              Array.isArray(mData) ? mData :
              Array.isArray(mData.missions) ? mData.missions :
              Array.isArray(mData.available) ? mData.available :
              []
            ) as Array<Record<string, unknown>>;
            if (missions.length > 0) ctx.mapStore.updateMissions(target.systemId, target.stationPoi, missions);
          }

          await tryRefuel(ctx);
          await bot.exec("undock");
          bot.docked = false;
          ctx.mapStore.markExplored(target.systemId, target.stationPoi);
          ctx.log("info", `Updated ${target.stationName} in ${target.systemName}`);
        }
      }

      // ── Deposit cargo if getting full ──
      await bot.refreshStatus();
      if (bot.cargoMax > 0 && bot.cargoMax - bot.cargo < 5) {
        yield "deposit_cargo";
        const sysPoisForDeposit = (await getSystemInfo(ctx)).pois;
        await depositCargoLocal(ctx, sysPoisForDeposit, { fuelThresholdPct: FUEL_SAFETY_PCT, hullThresholdPct: 30 });
      }

      // ── Check skills ──
      yield "check_skills";
      await bot.checkSkills();

      await bot.refreshStatus();
    }

    await bot.refreshStatus();
    const cycleFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    ctx.log("info", `Trade update cycle done — ${stationSystems.length} stations, ${bot.credits} cr, ${cycleFuel}% fuel`);
    await sleep(5000);
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Pick the best next system: prefer unvisited, then least-explored in mapStore. */
function pickNextSystem(connections: Connection[], visited: Set<string>, ms: MapStore): Connection | null {
  const unvisited = connections.filter(c => !visited.has(c.id));
  if (unvisited.length > 0) {
    const unmapped = unvisited.filter(c => !ms.getSystem(c.id));
    if (unmapped.length > 0) return unmapped[0];

    unvisited.sort((a, b) => {
      const aPois = ms.getSystem(a.id)?.pois?.length ?? 0;
      const bPois = ms.getSystem(b.id)?.pois?.length ?? 0;
      return aPois - bPois;
    });
    return unvisited[0];
  }

  return null;
}
