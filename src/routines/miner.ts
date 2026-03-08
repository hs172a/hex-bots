import type { Routine, RoutineContext } from "../bot.js";
import type { CargoItem } from "../bot.js";
import type { MapStore } from "../mapstore.js";
import type { CatalogStore } from "../catalogstore.js";
import { claimMiningSystem, releaseMiningClaim, miningClaimCount } from "../miningclaims.js";
import { claimStation, releaseStationClaim, getMostNeededItem } from "../swarmcoord.js";
import {
  checkAndDeliverDemands,
  type SystemPOI,
  isOreBeltPoi,
  isStationPoi,
  findStation,
  parseSystemData,
  getSystemInfo,
  parseOreFromMineResult,
  collectFromStorage,
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  ensureFueled,
  navigateToSystem,
  refuelAtStation,
  factionDonateProfit,
  detectAndRecoverFromDeath,
  getModProfile,
  ensureModsFitted,
  readSettings,
  scavengeWrecks,
  sleep,
  sleepBot,
  logAgentEvent,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

type DepositMode = "storage" | "faction" | "sell" | "gift";

const DEFAULT_ORE_QUOTA = 1000;

/** Default ore quotas: all known ores from map at 1000 each. Returns {} if no ores known yet. */
function defaultOreQuotas(ms: MapStore): Record<string, number> {
  const ores = ms.getAllKnownOres();
  if (ores.length === 0) return {};
  const quotas: Record<string, number> = {};
  for (const ore of ores) {
    quotas[ore.item_id] = DEFAULT_ORE_QUOTA;
  }
  return quotas;
}

/** Read miner settings from data/settings.json.
 *  Per-bot overrides for targetOre, depositMode, depositBot are checked first. */
function getMinerV2Settings(username?: string, ms?: MapStore): {
  depositMode: DepositMode;
  depositFallback: DepositMode;
  cargoThreshold: number;
  refuelThreshold: number;
  repairThreshold: number;
  homeSystem: string;
  system: string;
  depositBot: string;
  targetOre: string;
  acceptMissions: boolean;
  oreQuotas: Record<string, number>;
} {
  const all = readSettings();
  const m = all.miner || {};
  const botOverrides = username ? (all[username] || {}) : {};

  // depositMode: per-bot override > global > fallback
  function parseDepositMode(val: unknown): DepositMode | null {
    if (val === "faction" || val === "sell" || val === "storage" || val === "gift") return val;
    return null;
  }

  let depositMode: DepositMode =
    parseDepositMode(botOverrides.depositMode) ??
    parseDepositMode(m.depositMode) ??
    (m.sellOre === true ? "sell" : "faction");

  let depositFallback: DepositMode =
    parseDepositMode(botOverrides.depositFallback) ??
    parseDepositMode(m.depositFallback) ??
    "storage";

  // acceptMissions: per-bot > global miner > default true
  const acceptMissions = botOverrides.acceptMissions !== undefined
    ? Boolean(botOverrides.acceptMissions)
    : m.acceptMissions !== undefined
      ? Boolean(m.acceptMissions)
      : true;

  return {
    depositMode,
    depositFallback,
    cargoThreshold: (m.cargoThreshold as number) || 80,
    refuelThreshold: (m.refuelThreshold as number) || 50,
    repairThreshold: (m.repairThreshold as number) || 40,
    homeSystem: (botOverrides.homeSystem as string) || (m.homeSystem as string) || "",
    system: (m.system as string) || "",
    depositBot: (botOverrides.depositBot as string) || (m.depositBot as string) || "",
    targetOre: (botOverrides.targetOre as string) || (m.targetOre as string) || "",
    acceptMissions,
    oreQuotas: (m.oreQuotas as Record<string, number>) || (ms ? defaultOreQuotas(ms) : {}),
  };
}

// ── Ore quota logic ──────────────────────────────────────────

/**
 * Pick the best ore to mine based on quota deficits in faction storage.
 * Returns ore ID with biggest deficit (tie-broken by base_value), or "" if all met.
 */
function pickTargetOre(
  oreQuotas: Record<string, number>,
  factionStorage: CargoItem[],
  ms: MapStore,
  cs: CatalogStore,
): { oreId: string; deficit: number; current: number; target: number } {
  const entries: Array<{ oreId: string; deficit: number; current: number; target: number; baseValue: number }> = [];

  for (const [oreId, target] of Object.entries(oreQuotas)) {
    if (target <= 0) continue;
    // Safety: skip ores with no known ore belt locations (ice/gas ores)
    const locs = ms.findOreLocations(oreId);
    const hasOreBelt = locs.some((loc: { systemId: string; poiId: string }) => {
      const sys = ms.getSystem(loc.systemId);
      const poi = sys?.pois.find(p => p.id === loc.poiId);
      return poi ? isOreBeltPoi(poi.type) : false;
    });
    if (locs.length > 0 && !hasOreBelt) continue;
    const current = factionStorage.find(i => i.itemId === oreId)?.quantity || 0;
    const deficit = target - current;
    const baseValue = cs.getItem(oreId)?.base_value as number || 0;
    entries.push({ oreId, deficit, current, target, baseValue });
  }

  if (entries.length === 0) return { oreId: "", deficit: 0, current: 0, target: 0 };

  // Sort: biggest deficit first, then highest base_value
  entries.sort((a, b) => b.deficit - a.deficit || b.baseValue - a.baseValue);

  const best = entries[0];
  // All quotas met → return empty (fall back to local mining)
  if (best.deficit <= 0) return { oreId: "", deficit: 0, current: best.current, target: best.target };

  return { oreId: best.oreId, deficit: best.deficit, current: best.current, target: best.target };
}

// ── Mission helpers ───────────────────────────────────────────

const MINING_MISSION_KEYWORDS = ["mine", "ore", "mineral", "supply", "collect", "gather", "extract", "asteroid"];

/** Accept available mining/supply missions at the current station. Respects 5-mission cap. */
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
    const isMiningMission = MINING_MISSION_KEYWORDS.some(kw =>
      name.includes(kw) || desc.includes(kw) || type.includes(kw)
    );
    if (!isMiningMission) continue;
    const acceptResp = await bot.exec("accept_mission", { mission_id: missionId });
    if (!acceptResp.error) {
      activeCount++;
      ctx.log("info", `Mission accepted: ${(mission.name as string) || missionId} (${activeCount}/5 active)`);
    }
  }
}

/** Complete any active missions while docked. Called before unloading so mission items are still in hold. */
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
      // Update credits from mission completion without full refresh
      if (completeResp.result && typeof completeResp.result === 'object') {
        const result = completeResp.result as any;
        if (result.player?.credits !== undefined) {
          bot.credits = result.player.credits;
        }
      }
    }
  }
}

const DEPLETION_WAIT_MS = 15_000;   // 15 s — wait at belt for ore to respawn
const MAX_DEPLETION_WAITS = 4;      // max consecutive waits before trying alt system

/** Check belt resources: returns depleted flag + human-readable info for UI logging. */
async function getBeltStatus(ctx: RoutineContext): Promise<{ depleted: boolean; info: string }> {
  const poiResp = await ctx.bot.exec("get_poi");
  if (!poiResp.result || typeof poiResp.result !== "object") return { depleted: false, info: "" };
  const r = poiResp.result as Record<string, unknown>;
  const resources = (
    Array.isArray(r.resources) ? r.resources :
    Array.isArray(r.asteroids) ? r.asteroids :
    Array.isArray(r.ores) ? r.ores : []
  ) as Array<Record<string, unknown>>;
  if (resources.length === 0) return { depleted: false, info: "" };
  const available = resources.filter(res => {
    const depletion = (res.depletion_percent as number) ?? 0;
    const remaining = (res.remaining as number) ?? Infinity;
    return depletion < 90 && remaining > 0;
  });
  const total = resources.length;
  const avgDepletion = Math.round(
    resources.reduce((sum, res) => sum + ((res.depletion_percent as number) ?? 0), 0) / total,
  );
  const depleted = available.length === 0;
  const info = `${available.length}/${total} resources available (${avgDepletion}% depleted avg)`;
  return { depleted, info };
}

/** Find the system ID that contains the given POI, using map store data. */
function findSystemForPoi(ms: MapStore, poiId: string): string {
  if (!poiId) return "";
  const allSystems = ms.getAllSystems();
  for (const [sysId, sys] of Object.entries(allSystems)) {
    if (sys.pois.some((p: { id: string }) => p.id === poiId)) return sysId;
  }
  return "";
}

// ── Optimized Cargo Handling ──────────────────────────────────

/** Optimized cargo handling - processes items from get_cargo response */
async function handleCargoFromResponse(
  ctx: RoutineContext,
  cargoItems: Array<Record<string, unknown>>,
  settings: ReturnType<typeof getMinerV2Settings>
): Promise<string[]> {
  const { bot } = ctx;
  const unloadedItems: string[] = [];
  const cachedFac = bot.poi ? ctx.mapStore.hasFactionStorage(bot.poi) : null;
  let noFactionStorage = cachedFac === false;

  // Deposit helper: attempts primary mode, falls back on error
  async function depositItem(itemId: string, quantity: number, displayName: string, mode: DepositMode, recipient: string): Promise<boolean> {
    if (mode === "gift" || recipient) {
      const target = recipient || settings.depositBot;
      if (target) {
        const giftResp = await bot.exec("send_gift", { recipient: target, item_id: itemId, quantity });
        if (!giftResp.error) return true;
        ctx.log("trade", `Gift to ${target} failed for ${displayName}: ${giftResp.error.message}`);
        return false;
      }
    }
    if (mode === "sell") {
      const sellResp = await bot.exec("sell", { item_id: itemId, quantity });
      if (!sellResp.error) {
        const r = sellResp.result as any;
        // quantity_sold=0 means no buyers — treat as failure so fallback deposit is used
        if ((r?.quantity_sold ?? 1) === 0) return false;
        if (r?.total_earned !== undefined) bot.credits += r.total_earned;
        return true;
      }
      ctx.log("trade", `Sell failed for ${displayName}: ${sellResp.error.message}`);
      return false;
    }
    if (mode === "faction") {
      if (!bot.inFaction || noFactionStorage) return false;
      const factionResp = await bot.exec("faction_deposit_items", { item_id: itemId, quantity });
      if (!factionResp.error) {
        if (bot.poi) ctx.mapStore.setFactionStorage(bot.poi, true);
        return true;
      }
      const ec = factionResp.error.code ?? "";
      const em = factionResp.error.message ?? "";
      if (ec === "no_faction_storage" || em.includes("no_faction_storage") || em.includes("faction_lockbox") ||
          ec === "not_in_faction" || em.includes("not_in_faction")) {
        noFactionStorage = true;
        if (bot.poi) ctx.mapStore.setFactionStorage(bot.poi, false);
      } else {
        ctx.log("trade", `Faction deposit failed for ${displayName}: ${em}`);
      }
      return false;
    }
    // Default: personal storage
    const storeResp = await bot.exec("deposit_items", { item_id: itemId, quantity });
    if (storeResp.error) {
      ctx.log("trade", `Station deposit failed for ${displayName}: ${storeResp.error.message}`);
    }
    return !storeResp.error;
  }

  const modeLabel: Record<string, string> = {
    storage: "station storage", faction: "faction storage", sell: "market",
  };
  const primaryLabel = settings.depositBot
    ? `${settings.depositBot}'s storage`
    : (modeLabel[settings.depositMode] || "storage");

  for (const item of cargoItems) {
    const itemId = (item.item_id as string) || "";
    const quantity = (item.quantity as number) || 0;
    if (!itemId || quantity <= 0) continue;
    const displayName = (item.name as string) || itemId;

    const ok = await depositItem(itemId, quantity, displayName, settings.depositMode, settings.depositBot);
    if (!ok) {
      const ok2 = await depositItem(itemId, quantity, displayName, settings.depositFallback, "");
      if (!ok2) {
        const storeResp = await bot.exec("deposit_items", { item_id: itemId, quantity });
        if (storeResp.error) {
          const factionResp = await bot.exec("faction_deposit_items", { item_id: itemId, quantity });
          if (factionResp.error) {
            ctx.log("error", `All deposit methods failed for ${displayName}: ${factionResp.error.message}`);
            continue; // item stays in cargo — skip the push below
          }
        }
      }
    }
    unloadedItems.push(`${quantity}x ${displayName}`); // only reached when at least one method succeeded
  }

  if (unloadedItems.length > 0) {
    ctx.log("trade", `Unloaded ${unloadedItems.join(", ")} → ${primaryLabel}`);
  }

  return unloadedItems;
}

// ── Optimized Status Updates ─────────────────────────────────

/** Batch status update - combines multiple refreshes into one */
async function batchStatusUpdate(ctx: RoutineContext, updateFactionStorage: boolean = false): Promise<void> {
  const { bot } = ctx;
  
  // Get status once
  const statusResp = await bot.exec("get_status");
  if (!statusResp.error && statusResp.result) {
    const result = statusResp.result as any;
    
    // Update all status fields from single response
    if (result.player) {
      bot.credits = result.player.credits ?? bot.credits;
      bot.system = result.player.current_system ?? bot.system;
      bot.poi = result.player.current_poi ?? bot.poi;
      bot.docked = !!result.player.docked_at_base;
    }
    
    if (result.ship) {
      bot.fuel = result.ship.fuel ?? bot.fuel;
      bot.maxFuel = result.ship.max_fuel ?? bot.maxFuel;
      bot.hull = result.ship.hull ?? bot.hull;
      bot.maxHull = result.ship.max_hull ?? bot.maxHull;
      bot.cargo = result.ship.cargo_used ?? bot.cargo;
      bot.cargoMax = result.ship.cargo_capacity ?? bot.cargoMax;
    }
  }
  
  // Get faction storage only if needed
  if (updateFactionStorage) {
    await bot.refreshFactionStorage();
  }
}

/** Update cargo from mining response without additional API call */
function updateCargoFromMineResult(bot: any, mineResult: any): void {
  if (mineResult.result && typeof mineResult.result === 'object') {
    const result = mineResult.result;
    if (result.ship?.cargo_used !== undefined) {
      bot.cargo = result.ship.cargo_used;
    }
  }
}

// ── Miner routine v2 ────────────────────────────────────────────

/**
 * Optimized Miner routine v2 - reduced API calls:
 * 
 * Key optimizations:
 * 1. Batch status updates instead of individual refresh calls
 * 2. Use mining response to update cargo without get_status
 * 3. Combine cargo handling with single get_cargo call
 * 4. Cache system info and reuse when possible
 * 5. Reduce redundant refresh calls in loops
 */
export const minerRoutineV2: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  // Initial status update
  await batchStatusUpdate(ctx, false);
  const settings0 = getMinerV2Settings(bot.username, ctx.mapStore);
  // homeSystem: setting > derive from homeBase POI in map > current system at startup
  const homeSystem = settings0.homeSystem ||
    findSystemForPoi(ctx.mapStore, bot.homeBase) ||
    bot.system;
  // homeStationId: the specific station POI to dock at for unloading (home base)
  const homeStationId = bot.homeBase || "";
  const depletedSystems = new Set<string>();
  let lastTargetOre = "";
  const wrongModulePois = new Set<string>();
  let cachedSystemInfo: { pois: any[]; systemId: string } | null = null;
  let lastSystemRefresh = 0;
  const SYSTEM_CACHE_DURATION = 30000; // 30 seconds
  let consecutiveDepletedCycles = 0; // how many empty-cargo depletion cycles in a row

  // ── Startup: return home and dump non-fuel cargo to storage ──
  const cargoResp = await bot.exec("get_cargo");
  if (cargoResp.result && typeof cargoResp.result === "object") {
    const result = cargoResp.result as Record<string, unknown>;
    const cargoItems = (
      Array.isArray(result) ? result :
      Array.isArray(result.items) ? result.items :
      Array.isArray(result.cargo) ? result.cargo :
      []
    ) as Array<Record<string, unknown>>;

    const nonFuelCargo = cargoItems.filter(i => {
      const itemId = (i.item_id as string) || "";
      const quantity = (i.quantity as number) || 0;
      const lower = itemId.toLowerCase();
      return quantity > 0 && !lower.includes("fuel") && !lower.includes("energy_cell");
    });

    if (nonFuelCargo.length > 0) {
      // Navigate to home system first
      if (bot.system !== homeSystem) {
        ctx.log("mining", `Startup: returning to home system ${homeSystem} to deposit cargo...`);
        const fueled = await ensureFueled(ctx, 50);
        if (fueled) {
          await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: 50, hullThresholdPct: 30 });
        }
      }
      // Navigate to station POI in current system before docking
      if (!bot.docked) {
        const { pois: startupPois } = await getSystemInfo(ctx);
        const startupStation = findStation(startupPois);
        if (startupStation) {
          const travelResp = await bot.exec("travel", { target_poi: startupStation.id });
          if (travelResp.error && !travelResp.error.message.includes("already")) {
            ctx.log("error", `Startup: travel to station failed: ${travelResp.error.message}`);
          }
        }
      }
      await ensureDocked(ctx);
      const unloaded = await handleCargoFromResponse(ctx, nonFuelCargo, settings0);
      if (unloaded.length > 0) {
        await bot.refreshCargo(); // sync bot.cargo so mine loop starts with correct fill level
        ctx.log("mining", `Startup: deposited ${unloaded.join(", ")} — cargo clear for mining`);
      } else {
        ctx.log("error", `Startup: failed to deposit cargo — will retry in main loop`);
      }
      await bot.refreshCargo();
    }
  }

  let noMinablePOIStreak = 0;

  while (bot.state === "running") {
    // ── Death recovery ──
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleepBot(ctx, 30000); continue; }

    // Re-read settings each cycle
    const settings = getMinerV2Settings(bot.username, ctx.mapStore);
    const cargoThresholdRatio = settings.cargoThreshold / 100;
    const safetyOpts = {
      fuelThresholdPct: settings.refuelThreshold,
      hullThresholdPct: settings.repairThreshold,
    };
    let targetOre = settings.targetOre;
    const miningSystem = settings.system || "";

    // ── Ore target selection (priority order) ──────────────────────────
    // 1. Needs Matrix (coordinator-written, persistent, cross-VM)
    //    Fresh = updated_target_at within last 2 hours.
    const NEEDS_MATRIX_MAX_AGE_MS = 2 * 60 * 60 * 1000;
    const nmDeficits = ctx.mapStore.getTopNeedsMatrixDeficits('mine', 20);
    const nmFresh = nmDeficits.length > 0 &&
      (Date.now() - new Date(nmDeficits[0].updated_target_at).getTime()) <= NEEDS_MATRIX_MAX_AGE_MS;

    if (nmFresh) {
      // Find the top-deficit ore that actually has a known ore-belt location
      let picked = false;
      for (const entry of nmDeficits) {
        const locs = ctx.mapStore.findOreLocations(entry.item_id);
        const hasOreBelt = locs.some((loc: { systemId: string; poiId: string }) => {
          const sys = ctx.mapStore.getSystem(loc.systemId);
          const poi = sys?.pois.find((p: any) => p.id === loc.poiId);
          return poi ? isOreBeltPoi(poi.type) : false;
        });
        if (!hasOreBelt) continue;
        targetOre = entry.item_id;
        const oreName = ctx.catalogStore.resolveItemName(entry.item_id);
        const deficit = entry.target_qty - entry.current_qty;
        ctx.log("mining", `Needs matrix: ${oreName} (${entry.current_qty}/${entry.target_qty}, deficit ${deficit})`);
        picked = true;
        break;
      }
      if (!picked && nmDeficits.length > 0) {
        targetOre = "";
        ctx.log("mining", "Needs matrix: all ore targets met — mining locally");
      }
    } else {
      // 2. Settings-based oreQuotas (fallback when coordinator hasn't written needs_matrix yet)
      if (Object.keys(settings.oreQuotas).length > 0) {
        await bot.refreshFactionStorage();
        const pick = pickTargetOre(settings.oreQuotas, bot.factionStorage, ctx.mapStore, ctx.catalogStore);
        if (pick.oreId) {
          targetOre = pick.oreId;
          const oreName = ctx.catalogStore.resolveItemName(pick.oreId);
          ctx.log("mining", `Quota pick: ${oreName} (${pick.current}/${pick.target}, deficit ${pick.deficit})`);
        } else if (pick.target > 0) {
          targetOre = "";
          ctx.log("mining", "All ore quotas met — mining locally");
        }
      }
    }

    // 3. Swarm demand override (in-process crafter signal, same VM only)
    if (!targetOre) {
      const mostNeeded = getMostNeededItem();
      if (mostNeeded) {
        const locs = ctx.mapStore.findOreLocations(mostNeeded.itemId);
        if (locs.length > 0) {
          targetOre = mostNeeded.itemId;
          const oreName = ctx.catalogStore.resolveItemName(mostNeeded.itemId);
          ctx.log("mining", `Swarm demand: mining ${oreName} (${mostNeeded.totalQuantity} units requested by crafters)`);
        }
      }
    }

    // Reset depleted systems tracker when target ore changes
    if (targetOre !== lastTargetOre) {
      depletedSystems.clear();
      lastTargetOre = targetOre;
    }

    // ── Batch status update + fuel/hull checks ──
    yield "status_check";
    await batchStatusUpdate(ctx, false);

    // Ensure fuel before doing anything
    yield "fuel_check";
    const fueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
    if (!fueled) {
      ctx.log("error", "Cannot refuel — waiting 30s...");
      await sleep(30000);
      continue;
    }

    // Hull check — repair immediately if low
    const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    if (hullPct <= 40) {
      ctx.log("system", `Hull critical (${hullPct}%) — returning to station for repair`);
      await ensureDocked(ctx);
      await repairShip(ctx);
    }

    // ── Undock if docked ──
    await ensureUndocked(ctx);

    // ── Determine mining destination ──
    yield "find_destination";
    let targetSystemId = "";
    let targetBeltId = "";
    let targetBeltName = "";

    if (targetOre) {
      const allOreLocations = ctx.mapStore.findOreLocations(targetOre);
      const oreLocations = allOreLocations.filter((loc: { systemId: string; poiId: string; systemName?: string; hasStation?: boolean }) => {
        const sys = ctx.mapStore.getSystem(loc.systemId);
        const poi = sys?.pois.find(p => p.id === loc.poiId);
        return poi ? isOreBeltPoi(poi.type) : true;
      });

      if (oreLocations.length === 0) {
        ctx.log("error", `Target ore "${targetOre}" not found at any ore belt — mining locally`);
      } else {
        // Anti-collision: prefer systems not already claimed by other bots
        const unclaimedLocations = oreLocations.filter(loc => miningClaimCount(loc.systemId) === 0);
        const candidateLocations = unclaimedLocations.length > 0 ? unclaimedLocations : oreLocations;
        if (unclaimedLocations.length === 0 && oreLocations.length > 0) {
          ctx.log("mining", "All ore locations claimed by other miners — sharing nearest available");
        }

        const inCurrentSystem = candidateLocations.find(loc => loc.systemId === bot.system);
        if (inCurrentSystem) {
          targetSystemId = inCurrentSystem.systemId;
          targetBeltId = inCurrentSystem.poiId;
          targetBeltName = inCurrentSystem.poiName;
        } else {
          const withStation = candidateLocations.filter(loc => loc.hasStation);
          const best = withStation.length > 0 ? withStation[0] : candidateLocations[0];

          const route = ctx.mapStore.findRoute(bot.system, best.systemId);
          if (route) {
            targetSystemId = best.systemId;
            targetBeltId = best.poiId;
            targetBeltName = best.poiName;
          } else {
            const routeResp = await bot.exec("find_route", { target_system: best.systemId });
            if (routeResp.result && !routeResp.error) {
              targetSystemId = best.systemId;
              targetBeltId = best.poiId;
              targetBeltName = best.poiName;
            } else {
              ctx.log("error", `Can't reach ${best.systemName} for ${targetOre} — mining locally`);
            }
          }
        }
      }
    }

    if (!targetSystemId && miningSystem && miningSystem !== bot.system) {
      targetSystemId = miningSystem;
    }

    // Register mining claim for chosen system
    const claimSystemId = targetSystemId || bot.system;
    claimMiningSystem(bot.username, claimSystemId);

    // ── Navigate to target system if needed ──
    if (targetSystemId && targetSystemId !== bot.system) {
      yield "navigate_to_target";
      const arrived = await navigateToSystem(ctx, targetSystemId, safetyOpts);
      if (!arrived) {
        ctx.log("error", "Failed to reach target system — mining locally instead");
        targetBeltId = "";
        targetBeltName = "";
      }
    }

    if (bot.state !== "running") break;

    // ── Get system info (with caching) ──
    yield "find_belt";
    const now = Date.now();
    if (!cachedSystemInfo || bot.system !== cachedSystemInfo.systemId || now - lastSystemRefresh > SYSTEM_CACHE_DURATION) {
      const { pois, systemId } = await getSystemInfo(ctx);
      cachedSystemInfo = { pois, systemId };
      lastSystemRefresh = now;
      if (systemId) bot.system = systemId;
    }

    let beltPoi: { id: string; name: string } | null = null;
    let stationPoi: { id: string; name: string } | null = null;

    const station = findStation(cachedSystemInfo.pois);
    if (station) stationPoi = { id: station.id, name: station.name };

    // Find target belt
    if (targetBeltId) {
      const match = cachedSystemInfo.pois.find(p => p.id === targetBeltId);
      if (match && isOreBeltPoi(match.type)) {
        beltPoi = { id: match.id, name: match.name };
      } else if (match) {
        ctx.log("mining", `Target POI ${match.name} is not an ore belt (${match.type}) — finding ore belt instead`);
      }
    }

    if (!beltPoi && targetOre) {
      for (const poi of cachedSystemInfo.pois) {
        if (isOreBeltPoi(poi.type)) {
          const sysData = ctx.mapStore.getSystem(bot.system);
          const storedPoi = sysData?.pois.find(p => p.id === poi.id);
          if (storedPoi?.ores_found.some(o => o.item_id === targetOre)) {
            beltPoi = { id: poi.id, name: poi.name };
            break;
          }
        }
      }
    }

    if (!beltPoi) {
      const minable = cachedSystemInfo.pois.find(p => isOreBeltPoi(p.type) && !wrongModulePois.has(p.id));
      if (minable) beltPoi = { id: minable.id, name: minable.name };
    }

    if (!beltPoi) {
      noMinablePOIStreak++;
      if (noMinablePOIStreak >= 3) {
        ctx.log("error", `No minable POI found ${noMinablePOIStreak}x in a row — yielding to SmartSelector`);
        return;
      }
      ctx.log("error", `No minable POI found (${noMinablePOIStreak}/3) — waiting 30s before retry`);
      await sleep(30000);
      continue;
    }
    noMinablePOIStreak = 0;

    // ── Travel to asteroid belt ──
    yield "travel_to_belt";
    const travelBeltResp = await bot.exec("travel", { target_poi: beltPoi.id });
    if (travelBeltResp.error && !travelBeltResp.error.message.includes("already")) {
      ctx.log("error", `Travel failed: ${travelBeltResp.error.message}`);
      await sleep(5000);
      continue;
    }
    bot.poi = beltPoi.id;

    // ── Check belt depletion ──
    yield "check_belt";
    const beltStatus = await getBeltStatus(ctx);
    if (beltStatus.info) ctx.log("mining", `Belt: ${beltStatus.info}`);
    if (beltStatus.depleted) {
      const altBelt = cachedSystemInfo.pois.find(p => isOreBeltPoi(p.type) && p.id !== beltPoi!.id && !wrongModulePois.has(p.id));
      if (altBelt) {
        ctx.log("mining", `${beltPoi.name} fully depleted — switching to ${altBelt.name}`);
        const altTravel = await bot.exec("travel", { target_poi: altBelt.id });
        if (!altTravel.error || altTravel.error.message.includes("already")) {
          beltPoi = { id: altBelt.id, name: altBelt.name };
          bot.poi = altBelt.id;
        }
      }
    }

    // ── Scavenge wrecks at belt before mining ──
    yield "scavenge";
    await scavengeWrecks(ctx);

    // ── Optimized mine loop: mine until cargo threshold ──
    yield "mine_loop";
    let miningCycles = 0;
    let stopReason = "";
    const oresMinedMap = new Map<string, number>();

    while (bot.state === "running") {
      // Use cached status, only refresh if needed for critical checks
      const midHull = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
      if (midHull <= 40) { stopReason = `hull critical (${midHull}%)`; break; }

      const midFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (midFuel < safetyOpts.fuelThresholdPct) { stopReason = `fuel low (${midFuel}%)`; break; }

      // Check cargo using current value
      const fillRatio = bot.cargoMax > 0 ? bot.cargo / bot.cargoMax : 0;
      if (fillRatio >= cargoThresholdRatio) {
        stopReason = `cargo at ${Math.round(fillRatio * 100)}%`; break;
      }

      const mineResp = await bot.exec("mine");

      if (mineResp.error) {
        const msg = mineResp.error.message.toLowerCase();
        if (msg.includes("no asteroids") || msg.includes("depleted") || msg.includes("no minable")) {
          stopReason = "belt depleted"; break;
        }
        if (msg.includes("cargo") && msg.includes("full")) {
          stopReason = "cargo full"; break;
        }
        if (msg.includes("gas harvester") || msg.includes("ice harvester") || msg.includes("harvester module") || msg.includes("survey capability")) {
          ctx.log("mining", `${beltPoi.name} requires a specialized module — blacklisting as non-ore POI`);
          wrongModulePois.add(beltPoi.id);
          stopReason = "wrong_module"; break;
        }
        ctx.log("error", `Mine error: ${mineResp.error.message}`);
        break;
      }

      miningCycles++;

      const { oreId, oreName } = parseOreFromMineResult(mineResp.result);
      if (oreId && bot.poi) {
        ctx.mapStore.recordMiningYield(bot.system, bot.poi, { item_id: oreId, name: oreName });
        oresMinedMap.set(oreName, (oresMinedMap.get(oreName) || 0) + 1);
        bot.stats.totalMined++;
        bot.stats.totalOreUnits = (bot.stats.totalOreUnits ?? 0) + 1;
      }

      // Update cargo from mine result (no additional API call)
      updateCargoFromMineResult(bot, mineResp);

      yield "mining";
    }

    // Mining summary
    if (miningCycles > 0) {
      consecutiveDepletedCycles = 0; // reset on successful mining
      const oreList = [...oresMinedMap.entries()].map(([name, qty]) => `${qty}x ${name}`).join(", ");
      ctx.log("mining", `Mined ${miningCycles} cycles (${oreList})${stopReason ? ` — ${stopReason}` : ""}`);
    } else if (stopReason) {
      ctx.log("mining", `Stopped before mining — ${stopReason}`);
    }

    // Release claim before returning home / docking
    releaseMiningClaim(bot.username);

    if (bot.state !== "running") break;

    // ── Belt depleted: wait for respawn instead of useless round-trip to station ──
    if (stopReason === "belt depleted" && bot.state === "running") {
      if (miningCycles === 0) {
        // Nothing mined → stay at belt and wait for ore respawn
        consecutiveDepletedCycles++;

        if (consecutiveDepletedCycles <= MAX_DEPLETION_WAITS) {
          // Check for an untried alt belt in this system first
          const altBelt = cachedSystemInfo?.pois.find(
            p => isOreBeltPoi(p.type) && p.id !== beltPoi!.id && !wrongModulePois.has(p.id),
          );
          if (altBelt) {
            ctx.log("mining", `${beltPoi.name} depleted — switching to ${altBelt.name}`);
            const altT = await bot.exec("travel", { target_poi: altBelt.id });
            if (!altT.error || altT.error.message.includes("already")) {
              beltPoi = { id: altBelt.id, name: altBelt.name };
              bot.poi = altBelt.id;
            }
          } else {
            ctx.log("mining", `Belt depleted (${consecutiveDepletedCycles}/${MAX_DEPLETION_WAITS}) — waiting ${Math.round(DEPLETION_WAIT_MS / 1000)}s for ore respawn...`);
            await sleep(DEPLETION_WAIT_MS);
          }
          // Skip dock/unload — retry mining directly
          continue;
        }

        // Exhausted waits → try another system
        consecutiveDepletedCycles = 0;
        if (targetOre) {
          depletedSystems.add(bot.system);
          const altLocations = ctx.mapStore.findOreLocations(targetOre)
            .filter((loc: { systemId: string; poiId: string; systemName?: string; hasStation?: boolean }) =>
              !depletedSystems.has(loc.systemId) && loc.systemId !== bot.system,
            );
          if (altLocations.length > 0) {
            const withStation = altLocations.filter((loc: { hasStation?: boolean }) => loc.hasStation);
            const nextLoc = withStation.length > 0 ? withStation[0] : altLocations[0];
            ctx.log("mining", `All belts exhausted for ${ctx.catalogStore.resolveItemName(targetOre)} — navigating to ${nextLoc.systemName}`);
            const preFueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
            if (!preFueled && stationPoi) await refuelAtStation(ctx, stationPoi, safetyOpts.fuelThresholdPct);
            const arrived = await navigateToSystem(ctx, nextLoc.systemId, safetyOpts);
            if (arrived) { ctx.log("mining", `Arrived at ${nextLoc.systemName} — continuing mining`); continue; }
            ctx.log("error", `Failed to reach ${nextLoc.systemName} — returning home`);
          } else {
            ctx.log("mining", "All known ore locations depleted — clearing cache, returning home");
            depletedSystems.clear();
          }
        }
        // With empty cargo, skip the unload/refuel cycle (nothing to deposit)
        continue;

      } else {
        // Mined something before depletion — dock normally to unload
        if (targetOre) {
          depletedSystems.add(bot.system);
          const altLocations = ctx.mapStore.findOreLocations(targetOre)
            .filter((loc: { systemId: string; poiId: string; systemName?: string; hasStation?: boolean }) =>
              !depletedSystems.has(loc.systemId) && loc.systemId !== bot.system,
            );
          if (altLocations.length > 0) {
            const withStation = altLocations.filter((loc: { hasStation?: boolean }) => loc.hasStation);
            const nextLoc = withStation.length > 0 ? withStation[0] : altLocations[0];
            ctx.log("mining", `${bot.system} depleted for ${ctx.catalogStore.resolveItemName(targetOre)} — trying ${nextLoc.systemName} after unloading`);
          } else {
            ctx.log("mining", "All known ore locations depleted — clearing depletion cache, returning home");
            depletedSystems.clear();
          }
        }
        // Fall through to dock/unload
      }
    }

    // ── Wrong module (gas/ice POI mistaken for ore belt): skip unload, find real belt ──
    if (stopReason === "wrong_module" && miningCycles === 0 && bot.state === "running") {
      const hasAltBelt = cachedSystemInfo?.pois.some(p => isOreBeltPoi(p.type) && !wrongModulePois.has(p.id));
      if (hasAltBelt) {
        // Retry this system — outer loop will pick a different, non-blacklisted belt
        continue;
      }
      // All local POIs blacklisted as non-ore — navigate to a system with a real ore belt
      ctx.log("error", `No ore belt in ${bot.system} (all POIs require special modules) — navigating to ore-belt system`);
      cachedSystemInfo = null; // force refresh after arriving
      const allSystems = ctx.mapStore.getAllSystems ? ctx.mapStore.getAllSystems() : {};
      const beltSystemEntry = Object.entries(allSystems).find(([sysId, sys]) =>
        sysId !== bot.system && sys.pois.some(p => isOreBeltPoi(p.type) && !wrongModulePois.has(p.id))
      );
      if (beltSystemEntry) {
        const arrived = await navigateToSystem(ctx, beltSystemEntry[0], safetyOpts);
        if (arrived) {
          wrongModulePois.clear(); // may be different POI types in new system
          continue;
        }
      }
      await sleep(30_000);
      continue;
    }

    // ── Return to home system if we traveled away ──
    if (bot.system !== homeSystem && homeSystem && bot.state === "running") {
      yield "return_home";

      // Ensure fueled before the journey home
      const returnFueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
      if (!returnFueled && stationPoi) {
        await refuelAtStation(ctx, stationPoi, safetyOpts.fuelThresholdPct);
      }

      const arrived = await navigateToSystem(ctx, homeSystem, safetyOpts);
      if (!arrived) {
        ctx.log("error", "Failed to return to home system — docking at nearest station");
      }

      // Refresh system info based on where the bot actually ended up
      const { pois: homePois, systemId: actualSystemId } = await getSystemInfo(ctx);
      cachedSystemInfo = { pois: homePois, systemId: actualSystemId || bot.system };
      lastSystemRefresh = Date.now();
      if (actualSystemId) bot.system = actualSystemId;
      // Use home station only if we actually reached the home system
      if (arrived && homeStationId) {
        stationPoi = { id: homeStationId, name: homeStationId };
      } else {
        const foundStation = findStation(homePois);
        stationPoi = foundStation ? { id: foundStation.id, name: foundStation.name } : null;
      }
    } else if (bot.system === homeSystem) {
      // Already in home system — use homeStationId only if it exists in the current system's POIs
      // (prevents wrong_system error when homeBase POI is from a different system than bot.system)
      const homeInCurrentSystem = homeStationId && cachedSystemInfo?.pois.some(p => p.id === homeStationId);
      if (homeInCurrentSystem) {
        stationPoi = { id: homeStationId, name: homeStationId };
      } else {
        const localStation = findStation(cachedSystemInfo?.pois ?? []);
        if (localStation) stationPoi = { id: localStation.id, name: localStation.name };
      }
    }

    // ── Travel to station ──
    yield "travel_to_station";
    if (stationPoi) {
      // Register swarm intent so other bots know this station is being used
      const cargoItemsDict: Record<string, number> = {};
      for (const item of bot.inventory) {
        if (item.quantity > 0) cargoItemsDict[item.itemId] = item.quantity;
      }
      claimStation(bot.username, stationPoi.id, cargoItemsDict);
      const travelStationResp = await bot.exec("travel", { target_poi: stationPoi.id });
      if (travelStationResp.error && !travelStationResp.error.message.includes("already")) {
        ctx.log("error", `Travel to station failed: ${travelStationResp.error.message}`);
        // wrong_system: stationPoi is from a different system — find one in the current system
        if (travelStationResp.error.message.includes("wrong_system") || travelStationResp.error.message.includes("different system")) {
          const { pois: curPois, systemId: curSysId } = await getSystemInfo(ctx);
          if (curSysId) bot.system = curSysId;
          cachedSystemInfo = { pois: curPois, systemId: curSysId || bot.system };
          lastSystemRefresh = Date.now();
          const curStation = findStation(curPois);
          if (curStation) {
            stationPoi = { id: curStation.id, name: curStation.name };
            const retryTravel = await bot.exec("travel", { target_poi: curStation.id });
            if (retryTravel.error && !retryTravel.error.message.includes("already")) {
              ctx.log("error", `Fallback travel to ${curStation.name} failed: ${retryTravel.error.message}`);
              stationPoi = null;
            }
          } else {
            ctx.log("error", "No station in current system — skipping dock");
            stationPoi = null;
          }
        }
      }
    }

    // ── Dock ──
    yield "dock";
    if (!stationPoi) {
      ctx.log("error", "No reachable station — skipping unload cycle, retrying in 15s");
      await sleep(15000);
      continue;
    }
    const dockResp = await bot.exec("dock");
    if (dockResp.error && !dockResp.error.message.includes("already")) {
      ctx.log("error", `Dock failed: ${dockResp.error.message}`);
      await sleep(5000);
      continue;
    }
    bot.docked = true;

    // ── Collect gifted credits/items + record market prices ──
    await collectFromStorage(ctx);
    await checkAndDeliverDemands(ctx);
    const creditsBefore = bot.credits;

    // ── Complete active missions before unloading ──
    if (settings.acceptMissions) {
      yield "complete_missions";
      await completeActiveMissions(ctx);
    }

    // ── Optimized cargo handling ──
    yield "unload_cargo";
    const cargoUnloadResp = await bot.exec("get_cargo");
    let cargoUnloadItems: Array<Record<string, unknown>>;
    if (cargoUnloadResp.result && typeof cargoUnloadResp.result === "object") {
      const result = cargoUnloadResp.result as Record<string, unknown>;
      cargoUnloadItems = (
        Array.isArray(result) ? result :
        Array.isArray(result.items) ? result.items :
        Array.isArray(result.cargo) ? result.cargo :
        []
      ) as Array<Record<string, unknown>>;
    } else {
      if (cargoUnloadResp.error) ctx.log("error", `get_cargo failed: ${cargoUnloadResp.error.message} — using cached inventory`);
      cargoUnloadItems = bot.inventory.map(i => ({ item_id: i.itemId, name: i.name, quantity: i.quantity } as Record<string, unknown>));
    }
    if (cargoUnloadItems.length > 0) {
      await handleCargoFromResponse(ctx, cargoUnloadItems, settings);
    }
    releaseStationClaim(bot.username);

    // Update status after unloading (single call instead of multiple)
    await batchStatusUpdate(ctx, false);

    // ── Faction donation (10% of earnings from sales + mission rewards) ──
    const earnings = bot.credits - creditsBefore;
    await factionDonateProfit(ctx, earnings);

    if (earnings >= 50_000) {
      const oreList = [...oresMinedMap.entries()].map(([name, qty]) => `${qty}x ${name}`).join(", ");
      logAgentEvent(ctx, "economy", "info",
        `Mining trip: +${earnings}cr (${oreList || "cargo"})`,
        { earnings, mining_cycles: miningCycles, ores: Object.fromEntries(oresMinedMap) },
      );
    }

    // ── Accept mining missions for the next cycle ──
    if (settings.acceptMissions) {
      yield "check_missions";
      await checkAndAcceptMissions(ctx);
    }

    // ── Refuel + Repair ──
    yield "refuel";
    await tryRefuel(ctx);
    yield "repair";
    await repairShip(ctx);

    // ── Fit mods ──
    const modProfile = getModProfile("miner");
    if (modProfile.length > 0) await ensureModsFitted(ctx, modProfile);

    // ── Check for skill level-ups ──
    yield "check_skills";
    await bot.checkSkills();

    // Final status update for cycle summary
    await batchStatusUpdate(ctx, false);
    const endFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    ctx.log("info", `Cycle done — ${bot.credits} credits, ${endFuel}% fuel, ${bot.cargo}/${bot.cargoMax} cargo`);
  }
  releaseMiningClaim(bot.username);
};
