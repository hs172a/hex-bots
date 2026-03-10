/**
 * Gatherer routine — multi-goal courier that acquires build/craft materials
 * for ANY bot's goals and delivers them to the correct target stations.
 *
 * Algorithm (courier pattern):
 *  1. Scan ALL bots' goals from settings (not just this bot's).
 *  2. Resolve target stations: use stored target_system/target_poi or look up
 *     the target_bot's current docked station via getFleetStatus().
 *  3. Build a delivery plan: for each unclaimed material across all goals,
 *     find the best buy source. Claim items to prevent duplicate work.
 *  4. Cargo optimization: group items by buy source → fewer acquisition trips.
 *     Pack cargo across multiple goals in one load.
 *  5. Acquisition run: buy/mine items from best sources.
 *  6. Multi-drop delivery: visit each target station and deposit the correct items.
 *  7. Repeat until all claimed work is done, then release claims.
 *
 * Settings (data/settings.json):
 *   Per-bot: goals: GatherGoal[] — array of goals; or legacy goal: GatherGoal.
 *   Global gatherer key: refuelThreshold, repairThreshold.
 */
import type { Routine, RoutineContext } from "../bot.js";
import type { MapStore } from "../mapstore.js";
import { getMarketPricesStore } from "../data/market-prices-store.js";
import {
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  navigateToSystem,
  collectFromStorage,
  recordMarketData,
  getSystemInfo,
  maxItemsForCargo,
  sleep,
  readSettings,
  isMinablePoi,
  safetyCheck,
} from "./common.js";
import {
  broadcastMaterialNeed, clearMaterialNeed, clearAllMaterialNeeds,
  claimGatherComponent, releaseGatherClaim, releaseAllGatherClaims,
  getClaimedQuantityByOthers,
} from "../swarmcoord.js";

// ── Types ─────────────────────────────────────────────────────

interface GatherMaterial {
  item_id: string;
  item_name: string;
  quantity_needed: number;
}

interface GatherGoal {
  id: string;
  target_id: string;
  target_name: string;
  /** POI ID of the station where gathered materials must be deposited. */
  target_poi: string;
  /** System ID of the target station. */
  target_system: string;
  materials: GatherMaterial[];
  /**
   * 'build' (default) — deposit to faction/personal storage at target station.
   * 'craft' / 'crafter' — deliver materials to crafter_bot's station so they can craft.
   */
  goal_type?: 'build' | 'craft' | 'crafter';
  /** Give materials as a gift to this character (send_gift) instead of depositing to storage. */
  gift_target?: string;
  /** For craft goals: bot username that will perform the crafting. */
  crafter_bot?: string;
  /** For craft goals: recipe ID to craft after delivery. */
  recipe_id?: string;
  /**
   * Username of the bot that OWNS this goal. If omitted, `owner_bot` (from settings key)
   * is used. When target_system/target_poi are empty the routine looks up this bot's
   * current docked station via getFleetStatus().
   */
  target_bot?: string;
}

interface MarketSource {
  system_id: string;
  poi_id: string;
  poi_name: string;
  price: number;
  stock: number;
}

/** A goal with a confirmed delivery destination. */
interface ResolvedGoal extends GatherGoal {
  target_system: string;
  target_poi: string;
  /** Bot whose settings contain this goal. */
  owner_bot: string;
}

/**
 * One atomic delivery task: acquire `quantity` units of `item_id` and deposit
 * them to the goal's target station.
 */
interface DeliveryTask {
  goalId: string;
  owner_bot: string;
  target_name: string;
  target_poi: string;
  target_system: string;
  gift_target?: string;
  /** Inherited from GatherGoal — controls which storage type receives the deposit. */
  goal_type?: 'build' | 'craft' | 'crafter';
  item_id: string;
  item_name: string;
  /** How many units this courier is responsible for. */
  quantity: number;
  /**
   * 'buy'    — market purchase.
   * 'mine'   — mining run.
   * 'search' — no known source yet; probe markets then mines at acquisition time.
   */
  source: 'buy' | 'mine' | 'search';
  buySource?: MarketSource;
  minePoi?: { system_id: string; poi_id: string; poi_name: string };
  /** How many have been acquired so far this run. */
  acquired: number;
  /** True when the task was abandoned because no source could be found. */
  skipped?: boolean;
}

// ── Settings ──────────────────────────────────────────────

function getThresholds(): { refuelThreshold: number; repairThreshold: number } {
  const all = readSettings();
  const g = (all.gatherer || {}) as Record<string, unknown>;
  return {
    refuelThreshold: (g.refuelThreshold as number) || 30,
    repairThreshold: (g.repairThreshold as number) || 40,
  };
}

/**
 * Scan ALL bots' settings and return every active gather goal with its owner bot.
 * Skips goals with no materials.
 */
function getAllGoalsAcrossFleet(): Array<{ goal: GatherGoal; owner_bot: string }> {
  const allSettings = readSettings();
  const result: Array<{ goal: GatherGoal; owner_bot: string }> = [];
  for (const [username, botSettings] of Object.entries(allSettings)) {
    if (username === 'gatherer' || typeof botSettings !== 'object' || !botSettings) continue;
    const bs = botSettings as Record<string, unknown>;
    const arr = (bs.goals as GatherGoal[] | undefined) || [];
    const legacy = (bs.goal || null) as GatherGoal | null;
    const goals: GatherGoal[] = arr.length > 0 ? arr : (legacy ? [legacy] : []);
    for (const goal of goals) {
      if (goal?.materials?.length) result.push({ goal, owner_bot: username });
    }
  }
  return result;
}

/**
 * Resolve a goal's delivery station. Priority:
 *  1. Stored target_system + target_poi in the goal settings.
 *  2. Target bot's current location if it's at a station POI.
 *  3. Target bot's homePoI / homeSystem (permanent base).
 *  4. Any station POI in the target bot's current system.
 * Returns null only when none of the above can be determined.
 */
function resolveTargetStation(
  goal: GatherGoal,
  owner_bot: string,
  ctx: RoutineContext,
): { system: string; poi: string } | null {
  // 1. Explicitly stored destination — always preferred
  if (goal.target_system && goal.target_poi) {
    return { system: goal.target_system, poi: goal.target_poi };
  }

  const fleet = ctx.getFleetStatus?.();
  const targetBotName = goal.target_bot || (goal.crafter_bot ?? owner_bot);
  const targetBot = fleet?.find(b => b.username === targetBotName);

  /** Check if a poi_id is a station (has_base) using mapStore. */
  const isStation = (sysId: string, poiId: string): boolean => {
    const sys = ctx.mapStore.getSystem(sysId);
    const poi = sys?.pois?.find((p: any) => p.id === poiId);
    return !!poi?.has_base;
  };

  // 2. Bot's current location if it's at a station POI (doesn't need to be docked)
  if (targetBot?.system && targetBot?.poi && isStation(targetBot.system, targetBot.poi)) {
    return { system: targetBot.system, poi: targetBot.poi };
  }

  // 3. Bot's home POI (permanent base, even if bot is traveling)
  if (targetBot?.homeSystem && targetBot?.homePoI) {
    return { system: targetBot.homeSystem, poi: targetBot.homePoI };
  }

  // 4. If target bot is in a known system but at a non-station POI, find the nearest station
  if (targetBot?.system) {
    const sys = ctx.mapStore.getSystem(targetBot.system);
    const stationPoi = sys?.pois?.find((p: any) => p.has_base);
    if (stationPoi) return { system: targetBot.system, poi: stationPoi.id };
  }

  return null;
}

// ── Market helpers ────────────────────────────────────────────

/** Find the cheapest market source (where we can BUY an item from NPCs).
 *  First queries the structured market_prices DB (all known stations),
 *  then falls back to MapStore in-memory data. */
function findCheapestBuySource(itemId: string, ms: MapStore): MarketSource | null {
  // Primary: query market_prices SQLite (structured, fast, all known stations)
  const mps = getMarketPricesStore();
  if (mps) {
    const cheapest = mps.findCheapestSource(itemId);
    if (cheapest) {
      return {
        system_id: cheapest.system_id,
        poi_id: cheapest.station_id,
        poi_name: cheapest.station_name || cheapest.station_id,
        price: cheapest.price,
        stock: cheapest.quantity,
      };
    }
  }

  // Fallback: scan in-memory MapStore (covers stations not yet in DB)
  let best: MarketSource | null = null;
  for (const sysId of ms.getAllSystemIds()) {
    const sys = ms.getSystem(sysId);
    if (!sys) continue;
    for (const poi of sys.pois) {
      for (const m of poi.market) {
        if (m.item_id !== itemId) continue;
        if (m.best_sell === null || m.sell_quantity <= 0) continue;
        if (!best || m.best_sell < best.price) {
          best = {
            system_id: sysId,
            poi_id: poi.id,
            poi_name: poi.name,
            price: m.best_sell,
            stock: m.sell_quantity,
          };
        }
      }
    }
  }
  return best;
}

/** Find a known minable POI for an item (by recorded ores_found), skipping POI types the bot can't mine. */
function findMineSource(
  itemId: string,
  ms: MapStore,
  ctx: RoutineContext,
): { system_id: string; poi_id: string; poi_name: string } | null {
  for (const sysId of ms.getAllSystemIds()) {
    const sys = ms.getSystem(sysId);
    if (!sys) continue;
    for (const poi of sys.pois) {
      if (!isMinablePoi(poi.type)) continue;
      if (!canMinePoiType(ctx.bot, poi.type)) continue;
      const ore = poi.ores_found.find(o => o.item_id === itemId);
      if (ore) return { system_id: sysId, poi_id: poi.id, poi_name: poi.name };
    }
  }
  return null;
}

// ── Cargo helpers ─────────────────────────────────────────────

function getFreeWeight(bot: RoutineContext["bot"]): number {
  if (bot.cargoMax <= 0) return 9999;
  return Math.max(0, bot.cargoMax - bot.cargo);
}

function cargoFullPct(bot: RoutineContext["bot"]): number {
  if (bot.cargoMax <= 0) return 0;
  return (bot.cargo / bot.cargoMax) * 100;
}

/** Dump ALL current cargo to station storage. Assumes docked. */
async function dumpAllCargo(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  await bot.refreshCargo();
  let dumped = 0;
  for (const item of bot.inventory) {
    if (item.quantity <= 0) continue;
    const resp = await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
    if (!resp.error) {
      dumped += item.quantity;
    }
  }
  if (dumped > 0) {
    ctx.log("trade", `Cleared cargo: dumped ${dumped} units to station storage`);
    await bot.refreshCargo();
  }
}

/** Count how many of an item are in cargo right now. */
function countInCargo(bot: RoutineContext["bot"], itemId: string): number {
  const entry = bot.inventory.find((i: any) => (i.itemId || i.item_id) === itemId);
  return entry ? (entry.quantity || 0) : 0;
}

/** Count how many of an item exist in personal + faction storage at the current station. */
function countInStorage(bot: RoutineContext["bot"], itemId: string): number {
  const find = (arr: any[] | undefined) =>
    (arr ?? []).find((i: any) => (i.itemId || i.item_id) === itemId)?.quantity ?? 0;
  return find(bot.storage) + find(bot.factionStorage);
}


// ── Navigation helpers ────────────────────────────────────────

/** Navigate to a specific station POI (within same or different system). */
async function goToStation(
  ctx: RoutineContext,
  systemId: string,
  poiId: string,
  poiName: string,
  fuelThreshold: number,
  repairThreshold: number,
): Promise<boolean> {
  const { bot } = ctx;

  if (bot.system !== systemId) {
    await ensureUndocked(ctx);
    const arrived = await navigateToSystem(ctx, systemId, {
      fuelThresholdPct: fuelThreshold,
      hullThresholdPct: repairThreshold,
    });
    if (!arrived) {
      ctx.log("error", `Cannot reach system ${systemId}`);
      return false;
    }
  }

  await ensureUndocked(ctx);

  if (bot.poi !== poiId) {
    ctx.log("travel", `Traveling to ${poiName}...`);
    const resp = await bot.exec("travel", { target_poi: poiId });
    if (resp.error && !resp.error.message.includes("already")) {
      ctx.log("error", `Travel to ${poiName} failed: ${resp.error.message}`);
      return false;
    }
    bot.poi = poiId;
  }

  if (!bot.docked) {
    const dockResp = await bot.exec("dock");
    if (dockResp.error && !dockResp.error.message.includes("already")) {
      ctx.log("error", `Dock at ${poiName} failed: ${dockResp.error.message}`);
      return false;
    }
    bot.docked = true;
    await collectFromStorage(ctx);
  }

  return true;
}

// ── Buy at market ─────────────────────────────────────────────

/**
 * Buy as much of an item as we can fit / afford / is available.
 * Returns quantity actually bought.
 */
async function buyItem(
  ctx: RoutineContext,
  itemId: string,
  itemName: string,
  wantQty: number,
): Promise<number> {
  const { bot } = ctx;
  // Status is already fresh from the outer navigation + refuel cycle — no redundant refreshStatus here.
  const canFit = maxItemsForCargo(getFreeWeight(bot), itemId);
  const toBuy = Math.min(wantQty, canFit);
  if (toBuy <= 0) return 0;

  ctx.log("trade", `Buying ${toBuy}x ${itemName}...`);
  const resp = await bot.exec("buy", { item_id: itemId, quantity: toBuy });

  if (resp.error) {
    const msg = resp.error.message.toLowerCase();
    if (msg.includes("not_available") || msg.includes("no_stock") || msg.includes("out of stock")) {
      ctx.mapStore.removeMarketItem(bot.system, bot.poi, itemId);
      ctx.log("warn", `${itemName} not available here — removing from market cache`);
    } else {
      ctx.log("error", `Buy failed for ${itemName}: ${resp.error.message}`);
    }
    return 0;
  }

  await bot.refreshCargo();
  ctx.log("trade", `Bought ${toBuy}x ${itemName}`);
  return toBuy;
}

// ── Mining ────────────────────────────────────────────────────

/**
 * Check if the bot's fitted modules support mining the given POI type.
 * Ice fields require an ice harvester; gas clouds/nebulae require a gas harvester.
 * Falls back gracefully when shipModules is not yet loaded.
 */
function canMinePoiType(bot: RoutineContext["bot"], poiType: string): boolean {
  const t = poiType.toLowerCase();
  if (t.includes("ice")) {
    if (bot.shipModules.length === 0) return false; // modules not loaded — assume no harvester
    return bot.shipModules.some(m => {
      const mId = ((m.type as string) || (m.id as string) || (m.name as string) || "").toLowerCase();
      return mId.includes("ice") || (((m as unknown) as Record<string, unknown>).ice_harvest_strength as number ?? 0) > 0;
    });
  }
  if (t.includes("gas") || t.includes("nebula") || t.includes("cloud")) {
    if (bot.shipModules.length === 0) return false;
    return bot.shipModules.some(m => {
      const mId = ((m.type as string) || (m.id as string) || (m.name as string) || "").toLowerCase();
      return mId.includes("gas") || (((m as unknown) as Record<string, unknown>).gas_harvest_strength as number ?? 0) > 0;
    });
  }
  return true; // standard asteroid/ore belt — any mining laser works
}

/** Find a minable POI in the current system that this bot can actually mine. */
async function findLocalMinePOI(ctx: RoutineContext): Promise<{ id: string; name: string } | null> {
  const { pois } = await getSystemInfo(ctx);
  const mineable = pois.find(p => isMinablePoi(p.type) && canMinePoiType(ctx.bot, p.type));
  return mineable ? { id: mineable.id, name: mineable.name } : null;
}

/**
 * Mine at current POI until `wantQty` is reached or cargo is full.
 * Returns qty mined of the requested item, or -1 if the POI yields a
 * DIFFERENT resource (item cannot be mined here — e.g. craft-only items).
 */
async function mineItem(
  ctx: RoutineContext,
  itemId: string,
  itemName: string,
  wantQty: number,
): Promise<number> {
  const { bot } = ctx;
  let mined = 0;
  let failures = 0;
  const MAX_FAILURES = 6;

  ctx.log("mine", `Mining ${itemName} — need ${wantQty}`);

  while (bot.state === "running" && mined < wantQty) {
    await bot.refreshCargo(); // lightweight: only cargo, no full status
    if (cargoFullPct(bot) >= 90) {
      ctx.log("mine", "Cargo full — stopping mine pass");
      break;
    }

    const resp = await bot.exec("mine", { resource_id: itemId });
    if (resp.error) {
      const msg = resp.error.message.toLowerCase();
      if (msg.includes("depleted") || msg.includes("no_resource") || msg.includes("exhausted")) {
        ctx.log("mine", `Deposit depleted`);
        break;
      }
      // Wrong harvester module (ice/gas field) — bail immediately, no point retrying
      if (msg.includes("ice harvester") || msg.includes("gas harvester") ||
          msg.includes("harvester module") || msg.includes("specialized module")) {
        ctx.log("error", `${itemName}: requires a specialized harvester module — cannot mine here`);
        return -2;
      }
      failures++;
      if (failures >= MAX_FAILURES) {
        ctx.log("error", `Mining failed ${MAX_FAILURES} times — aborting mine pass`);
        break;
      }
      await sleep(3000);
      continue;
    }

    failures = 0;
    const r = resp.result as Record<string, unknown> | null;

    // Verify the mine returned the expected resource (craft-only items like heat_sink
    // are not minable — the API returns whatever the POI yields instead).
    const returnedId = r?.resource_id as string | undefined;
    if (returnedId && returnedId !== itemId) {
      ctx.log("mine", `POI yielded '${returnedId}' instead of '${itemId}' — ${itemName} cannot be mined here`);
      return -1; // caller must handle: mark task skipped
    }

    const qty = (r?.quantity as number) || (r?.amount as number) || 1;
    mined += qty;

    if (mined % 20 === 0) {
      ctx.log("mine", `Mined ${mined}/${wantQty} ${itemName}`);
    }
  }

  return mined;
}

// ── Multi-goal delivery logic ──────────────────────────────────

/**
 * Scan ALL bots' goals, resolve target stations, and build a list of
 * DeliveryTasks that this courier will handle (claims each item).
 */
async function buildDeliveryPlan(
  ctx: RoutineContext,
  _FUEL_THR: number,
  _HULL_THR: number,
): Promise<DeliveryTask[]> {
  const { bot } = ctx;
  const allGoals = getAllGoalsAcrossFleet();

  if (allGoals.length === 0) return [];
  ctx.log("system", `Scanning ${allGoals.length} goal(s) across fleet...`);

  // Refresh storage once at the current station so we can subtract items
  // already present in faction/personal storage at any goal whose target
  // station happens to be this bot's current station.
  await bot.refreshStorage();
  const storageCheckedPois = new Set<string>([bot.poi]);

  const tasks: DeliveryTask[] = [];

  for (const { goal, owner_bot } of allGoals) {
    // Skip goals where THIS bot is the crafter — crafter handles its own delivery
    if (goal.crafter_bot === bot.username) continue;

    const station = resolveTargetStation(goal, owner_bot, ctx);
    if (!station) {
      const targetBotName = goal.target_bot || goal.crafter_bot || owner_bot;
      ctx.log("warn", `Goal '${goal.target_name}' (owner: ${owner_bot}): cannot resolve delivery station — skipping`);
      ctx.log("warn", `  → Tried bot '${targetBotName}' — not in fleet status or no station POI found in their system`);
      ctx.log("warn", `  → Fix: set target_system/target_poi on the goal, or ensure '${targetBotName}' is reachable via fleet status`);
      continue;
    }

    for (const mat of goal.materials) {
      // Subtract items already present:
      // 1. Bot's own storage at current station (only valid if bot is there)
      let alreadyPresent = 0;
      if (storageCheckedPois.has(station.poi)) {
        alreadyPresent = countInStorage(bot, mat.item_id);
        if (alreadyPresent > 0) {
          ctx.log("system", `  📦 ${alreadyPresent}x ${mat.item_name} already in storage at ${goal.target_name}`);
        }
      }
      // 2. Faction storage DB cache for the target POI (any bot may have seen it previously)
      // Only trust cached data if it was updated within the last 30 minutes to avoid
      // stale snapshots suppressing demand for items already consumed by the crafter.
      const FACTION_DB_MAX_AGE_MS = 30 * 60 * 1000;
      const facDbItems = ctx.mapStore.getFactionStorageItemsForPoi(station.poi);
      const facDbEntry = facDbItems.find((i: any) => i.item_id === mat.item_id);
      if (facDbEntry && (facDbEntry.quantity ?? 0) > 0 && facDbEntry.quantity > alreadyPresent) {
        const ageMs = Date.now() - new Date(facDbEntry.updated_at).getTime();
        if (ageMs <= FACTION_DB_MAX_AGE_MS) {
          ctx.log("system", `  🗄️  ${facDbEntry.quantity}x ${mat.item_name} in faction storage DB at ${goal.target_name} — reducing demand`);
          alreadyPresent = facDbEntry.quantity;
        } else {
          ctx.log("system", `  ⏰ Faction storage cache for ${goal.target_name} is ${Math.round(ageMs / 60000)}min stale — ignoring (will verify on delivery)`);
        }
      }

      // Subtract already-claimed quantity by other bots for this goal+item
      const claimedByOthers = getClaimedQuantityByOthers(bot.username, mat.item_id, goal.id);
      const toAcquire = Math.max(0, mat.quantity_needed - alreadyPresent - claimedByOthers);
      if (toAcquire === 0) {
        ctx.log("system", `⏭ ${mat.item_name} [${goal.target_name}]: fully claimed or already present in storage`);
        continue;
      }

      const claimed = claimGatherComponent(bot.username, mat.item_id, goal.id, toAcquire);
      if (claimed === 0) {
        ctx.log("system", `⏭ ${mat.item_name} [${goal.target_name}]: just taken by another courier`);
        continue;
      }

      const buySource = findCheapestBuySource(mat.item_id, ctx.mapStore) ?? undefined;
      const minePoi = !buySource ? (findMineSource(mat.item_id, ctx.mapStore, ctx) ?? undefined) : undefined;

      if (buySource) {
        ctx.log("system", `  ✓ ${toAcquire}x ${mat.item_name} → buy @ ${buySource.poi_name} (${buySource.price} cr) → ${goal.target_name}`);
      } else if (minePoi) {
        ctx.log("system", `  ✓ ${toAcquire}x ${mat.item_name} → mine @ ${minePoi.poi_name} → ${goal.target_name}`);
      } else {
        ctx.log("warn", `  ? ${toAcquire}x ${mat.item_name} → no known source yet → ${goal.target_name}`);
      }

      tasks.push({
        goalId: goal.id,
        owner_bot,
        target_name: goal.target_name,
        target_poi: station.poi,
        target_system: station.system,
        gift_target: goal.gift_target,
        goal_type: goal.goal_type,
        item_id: mat.item_id,
        item_name: mat.item_name,
        quantity: toAcquire,
        source: buySource ? 'buy' : (minePoi ? 'mine' : 'search'),
        buySource,
        minePoi,
        acquired: 0,
      });
    }
  }

  // Sort: group tasks by buy source → fewer market visits
  tasks.sort((a, b) => {
    const ka = a.buySource ? `${a.buySource.system_id}:${a.buySource.poi_id}` : 'zzz';
    const kb = b.buySource ? `${b.buySource.system_id}:${b.buySource.poi_id}` : 'zzz';
    return ka.localeCompare(kb);
  });

  return tasks;
}

/**
 * Deposit all relevant cargo items to their target stations (multi-drop).
 * Groups by target POI to minimise travel legs.
 */
async function depositAllToTargets(
  ctx: RoutineContext,
  tasks: DeliveryTask[],
  FUEL_THR: number,
  HULL_THR: number,
): Promise<number> {
  const { bot } = ctx;
  await bot.refreshCargo();

  // Group by destination
  const byDest = new Map<string, DeliveryTask[]>();
  for (const task of tasks) {
    const key = `${task.target_system}:${task.target_poi}`;
    if (!byDest.has(key)) byDest.set(key, []);
    byDest.get(key)!.push(task);
  }

  let totalDeposited = 0;

  for (const [, stationTasks] of byDest) {
    const first = stationTasks[0];
    const itemIds = new Set(stationTasks.map(t => t.item_id));
    const hasCargo = bot.inventory.some((i: any) => itemIds.has(i.itemId || i.item_id) && (i.quantity || 0) > 0);
    if (!hasCargo) continue;

    ctx.log("trade", `Delivering to ${first.target_name}...`);
    const ok = await goToStation(ctx, first.target_system, first.target_poi, first.target_name, FUEL_THR, HULL_THR);
    if (!ok) { ctx.log("error", `Cannot reach ${first.target_name} — skipping`); continue; }

    await tryRefuel(ctx);
    await repairShip(ctx);
    await recordMarketData(ctx);
    await bot.refreshCargo();

    for (const task of stationTasks) {
      const inv = bot.inventory.find((i: any) => (i.itemId || i.item_id) === task.item_id);
      if (!inv || (inv.quantity || 0) <= 0) continue;

      if (task.gift_target) {
        const r = await bot.exec("send_gift", { recipient: task.gift_target, item_id: task.item_id, quantity: inv.quantity });
        if (!r.error) {
          ctx.log("trade", `Gifted ${inv.quantity}x ${task.item_name} → ${task.gift_target}`);
          totalDeposited += inv.quantity;
          releaseGatherClaim(bot.username, task.item_id, task.goalId);
        } else ctx.log("error", `Gift failed for ${task.item_name}: ${r.error.message}`);
      } else {
        // 'build' goals (default) → faction storage so any bot can access the materials.
        // 'craft'/'crafter' goals → personal station storage (crafter withdraws from both sources).
        const useFaction = task.goal_type !== 'craft' && task.goal_type !== 'crafter';
        let depositOk = false;
        let depositErrMsg = "";
        if (useFaction) {
          const rf = await bot.exec("faction_deposit_items", { item_id: task.item_id, quantity: inv.quantity });
          if (!rf.error) {
            depositOk = true;
          } else {
            ctx.log("warn", `Faction deposit failed for ${task.item_name} (${rf.error.message}) — falling back to personal storage`);
            const rp = await bot.exec("deposit_items", { item_id: task.item_id, quantity: inv.quantity });
            depositOk = !rp.error;
            depositErrMsg = rp.error?.message ?? rf.error.message;
          }
        } else {
          const rp = await bot.exec("deposit_items", { item_id: task.item_id, quantity: inv.quantity });
          depositOk = !rp.error;
          depositErrMsg = rp.error?.message ?? "";
        }
        if (depositOk) {
          ctx.log("trade", `Deposited ${inv.quantity}x ${task.item_name} → ${task.target_name}`);
          totalDeposited += inv.quantity;
          releaseGatherClaim(bot.username, task.item_id, task.goalId);
          clearMaterialNeed(bot.username, task.item_id);
        } else {
          ctx.log("error", `Deposit failed for ${task.item_name}: ${depositErrMsg}`);
        }
      }
    }
    await bot.refreshCargo();
  }

  return totalDeposited;
}

/**
 * Phase 0 (highest priority): If this bot is assigned as `crafter_bot` on any goal,
 * attempt to craft those items immediately — before doing any courier work.
 *
 * Goals are sorted so fully-funded goals (all materials already in faction storage)
 * are processed first. This ensures VoltBot2 (or similar) doesn't spend a courier
 * pass fetching materials for OTHER bots' goals while its own craft goals are ready.
 *
 * Returns true when at least one item was crafted.
 */
async function craftOwnGoals(
  ctx: RoutineContext,
  FUEL_THR: number,
  HULL_THR: number,
): Promise<boolean> {
  const { bot } = ctx;

  const allGoals = getAllGoalsAcrossFleet();
  const ownCraftGoals = allGoals.filter(({ goal }) =>
    goal.crafter_bot === bot.username &&
    (goal.goal_type === "craft" || goal.goal_type === "crafter") &&
    (goal.materials?.length ?? 0) > 0,
  );
  if (ownCraftGoals.length === 0) return false;

  // Load recipes from catalog cache (fetch once if empty)
  type RawRecipe = Record<string, unknown>;
  let rawRecipes: RawRecipe[] = Object.values(ctx.catalogStore.getAll().recipes) as RawRecipe[];
  if (rawRecipes.length === 0) {
    try {
      await ctx.catalogStore.fetchAll(ctx.api);
      rawRecipes = Object.values(ctx.catalogStore.getAll().recipes) as RawRecipe[];
    } catch { /* proceed with empty */ }
  }
  if (rawRecipes.length === 0) return false;

  // Use faction storage DB cache to determine which goals have all materials ready.
  // Sort: fully-funded goals first so we craft those before doing any courier work.
  const goalsRanked = ownCraftGoals
    .map(({ goal }) => {
      const facDbItems = ctx.mapStore.getFactionStorageItemsForPoi(goal.target_poi);
      const ready = goal.materials.every(mat => {
        const entry = facDbItems.find((i: any) => i.item_id === mat.item_id);
        return entry && (entry.quantity ?? 0) >= mat.quantity_needed;
      });
      return { goal, ready };
    })
    .sort((a, b) => Number(b.ready) - Number(a.ready));

  let didCraft = false;

  for (const { goal, ready } of goalsRanked) {
    if (bot.state !== "running") break;
    if (!ready) {
      ctx.log("craft", `[CraftOwn] Materials not yet ready for '${goal.target_name}' — courier pass will handle`);
      continue;
    }

    // Find the recipe — prefer the explicitly configured recipe_id
    const recipe = rawRecipes.find(r =>
      (goal.recipe_id && r.recipe_id === goal.recipe_id) ||
      r.output_item_id === goal.target_id ||
      r.recipe_id === goal.target_id ||
      (goal.target_name && (r.name === goal.target_name || r.output_name === goal.target_name)),
    ) as (RawRecipe & {
      recipe_id: string;
      name?: string;
      output_item_id?: string;
      output_name?: string;
      output_quantity?: number;
      components?: Array<{ item_id: string; name?: string; quantity: number }>;
      required_skill?: { id?: string; skill_id?: string; name?: string; skill_name?: string; level: number };
    }) | undefined;

    if (!recipe?.recipe_id) {
      ctx.log("warn", `[CraftOwn] No recipe found for '${goal.target_name}' — skipping`);
      continue;
    }
    if (!recipe.components?.length) continue;

    // Skill check
    if (recipe.required_skill) {
      const skillId = recipe.required_skill.skill_id ?? recipe.required_skill.id ?? "";
      const skillName = recipe.required_skill.skill_name ?? recipe.required_skill.name ?? skillId;
      const required = recipe.required_skill.level ?? 0;
      const have = bot.getSkillLevel(skillId);
      if (have < required) {
        ctx.log("warn", `[CraftOwn] Skill too low for '${recipe.name}': ${skillName} Lv${required} required (have Lv${have}) — skipping`);
        continue;
      }
    }

    // Navigate to target station
    const station = resolveTargetStation(goal, bot.username, ctx);
    if (!station) {
      ctx.log("warn", `[CraftOwn] Cannot resolve station for '${goal.target_name}' — skipping`);
      continue;
    }

    const ok = await goToStation(ctx, station.system, station.poi, goal.target_name, FUEL_THR, HULL_THR);
    if (!ok) continue;

    if (!bot.docked) {
      const dResp = await bot.exec("dock");
      if (!dResp.error) bot.docked = true;
    }
    if (!bot.docked) continue;

    await bot.refreshFactionStorage();

    // Verify materials are actually present in faction storage now
    const components = recipe.components;
    const allAvail = components.every(c => {
      const entry = bot.factionStorage.find((i: any) => (i.itemId || i.item_id) === c.item_id);
      return entry && (entry.quantity ?? 0) >= c.quantity;
    });
    if (!allAvail) {
      ctx.log("craft", `[CraftOwn] Materials not confirmed in storage for '${recipe.name}' — deferring`);
      continue;
    }

    ctx.log("craft", `[CraftOwn] All materials ready — crafting '${recipe.name}'`);

    // Withdraw components from faction storage into cargo
    for (const comp of components) {
      const inCargo = countInCargo(bot, comp.item_id);
      const need = comp.quantity - inCargo;
      if (need <= 0) continue;
      const wResp = await bot.exec("faction_withdraw_items", { item_id: comp.item_id, quantity: need });
      if (wResp.error) {
        ctx.log("warn", `[CraftOwn] Withdraw ${need}x ${comp.name ?? comp.item_id} failed: ${wResp.error.message}`);
      }
    }

    const craftResp = await bot.exec("craft", { recipe_id: recipe.recipe_id, count: 1 });
    if (craftResp.error) {
      ctx.log("error", `[CraftOwn] Craft '${recipe.name}' failed: ${craftResp.error.message}`);
    } else {
      ctx.log("craft", `[CraftOwn] Crafted 1x ${recipe.name}`);
      didCraft = true;
      // Deposit everything back to faction storage
      await bot.refreshCargo();
      for (const item of [...bot.inventory]) {
        if (item.quantity <= 0) continue;
        const lower = (item.itemId ?? "").toLowerCase();
        if (lower.includes("energy_cell")) continue;
        await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    }
  }

  return didCraft;
}

/**
 * Phase 0.5: Execute own build goals whose materials are all available at the target station.
 * Navigates to the target station, flushes personal storage → faction storage via
 * collectFromStorage(), then issues `facility { action: 'faction_build' }`.
 *
 * @param builtGoalIds — goal IDs already built this run (prevents re-execution on same pass)
 * Returns true when at least one facility was built.
 */
async function executeBuildGoals(
  ctx: RoutineContext,
  FUEL_THR: number,
  HULL_THR: number,
  builtGoalIds: Set<string>,
): Promise<boolean> {
  const { bot } = ctx;

  const allGoals = getAllGoalsAcrossFleet();
  const ownBuildGoals = allGoals.filter(({ goal, owner_bot }) =>
    owner_bot === bot.username &&
    (!goal.goal_type || goal.goal_type === 'build') &&
    goal.target_id &&
    (goal.materials?.length ?? 0) > 0 &&
    !builtGoalIds.has(goal.id),
  );

  if (ownBuildGoals.length === 0) return false;

  let didBuild = false;

  for (const { goal } of ownBuildGoals) {
    if (bot.state !== "running") break;

    const station = resolveTargetStation(goal, bot.username, ctx);
    if (!station) {
      ctx.log("warn", `[Build] Cannot resolve station for '${goal.target_name}' — skipping`);
      continue;
    }

    // Pre-check via faction storage DB cache
    const facDbItems = ctx.mapStore.getFactionStorageItemsForPoi(station.poi);
    const allInFacDb = goal.materials.every(mat => {
      const entry = facDbItems.find((i: any) => i.item_id === mat.item_id);
      return entry && (entry.quantity ?? 0) >= mat.quantity_needed;
    });

    // Also accept if bot is already at target station and personal storage has the items
    const botAtTarget = bot.poi === station.poi;
    const allInPersonal = botAtTarget && goal.materials.every(
      mat => countInStorage(bot, mat.item_id) >= mat.quantity_needed,
    );

    if (!allInFacDb && !allInPersonal) {
      ctx.log("system", `[Build] Materials not yet confirmed for '${goal.target_name}' — courier pass will handle delivery`);
      continue;
    }

    ctx.log("system", `[Build] '${goal.target_name}': materials ready — navigating to build`);

    const ok = await goToStation(ctx, station.system, station.poi, goal.target_name, FUEL_THR, HULL_THR);
    if (!ok) {
      ctx.log("warn", `[Build] Cannot reach ${goal.target_name} — skipping`);
      continue;
    }

    if (!bot.docked) {
      const dResp = await bot.exec("dock");
      if (!dResp.error) bot.docked = true;
    }
    if (!bot.docked) continue;

    // Move any items from personal station storage → faction storage
    await collectFromStorage(ctx);

    // Live-verify faction storage now has everything
    await bot.refreshFactionStorage();
    const allVerified = goal.materials.every(mat => {
      const entry = bot.factionStorage.find((i: any) => (i.itemId || i.item_id) === mat.item_id);
      return entry && (entry.quantity ?? 0) >= mat.quantity_needed;
    });

    if (!allVerified) {
      ctx.log("warn", `[Build] Materials not confirmed in faction storage for '${goal.target_name}' — deferring`);
      builtGoalIds.add(goal.id); // don't retry this pass
      continue;
    }

    ctx.log("system", `[Build] Issuing faction_build for '${goal.target_name}' (type: ${goal.target_id})`);
    const buildResp = await bot.exec("facility", { action: "faction_build", facility_type: goal.target_id });
    if (buildResp.error) {
      ctx.log("error", `[Build] Build '${goal.target_name}' failed: ${buildResp.error.message}`);
    } else {
      ctx.log("system", `[Build] '${goal.target_name}' built successfully!`);
      didBuild = true;
      const r = buildResp.result as any;
      const built = r?.facility ?? r?.faction_facility ?? r;
      if (built?.facility_id) ctx.mapStore.updateFactionBuildings([built]);
    }
    builtGoalIds.add(goal.id); // mark whether success or failure — don't retry this run
  }

  return didBuild;
}

export const gathererRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  ctx.log("system", "=== Gatherer (courier) started ===");

  const { refuelThreshold: FUEL_THR, repairThreshold: HULL_THR } = getThresholds();

  // ── PHASE 1: Initial dock and prepare ───────────────────────────────

  ctx.log("system", "Phase 1: Docking and clearing cargo...");
  const startDocked = await ensureDocked(ctx);
  if (!startDocked) {
    ctx.log("error", "Cannot dock at starting station — aborting");
    return;
  }
  await dumpAllCargo(ctx);
  await tryRefuel(ctx);
  await repairShip(ctx);
  await recordMarketData(ctx);

  // ── Outer pass loop — re-scans goals after every delivery pass ────────

  let passCount = 0;
  const MAX_PASSES = 20;
  let noProgressPasses = 0;
  // Track goals built this run to prevent re-execution within the same invocation
  const builtGoalIds = new Set<string>();

  while (bot.state === "running" && passCount < MAX_PASSES) {
    passCount++;
    yield `scan_pass_${passCount}`;

    // ── PHASE 0: Craft own assigned goals with ready materials (highest priority) ──
    yield "craft_own_goals";
    await craftOwnGoals(ctx, FUEL_THR, HULL_THR);

    // ── PHASE 0.5: Execute own build goals whose materials are all at the target station ──
    yield "execute_build_goals";
    const didBuild = await executeBuildGoals(ctx, FUEL_THR, HULL_THR, builtGoalIds);

    // Re-dock and tidy up after any crafting/building before the courier scan
    if (bot.docked) {
      await tryRefuel(ctx);
      await repairShip(ctx);
    }

    // ── PHASE 2: Build multi-goal delivery plan ────────────────────────

    const tasks = await buildDeliveryPlan(ctx, FUEL_THR, HULL_THR);

    if (tasks.length === 0) {
      const allGoals = getAllGoalsAcrossFleet().filter(({ goal }) => goal.crafter_bot !== bot.username);
      if (allGoals.length === 0) {
        ctx.log("system", "No goals configured across fleet — stopping gatherer.");
        break;
      }
      if (didBuild) {
        // Just executed a build — reset counter and re-scan on next pass
        noProgressPasses = 0;
        continue;
      }
      noProgressPasses++;
      if (noProgressPasses >= 3) {
        ctx.log("system", `No actionable tasks after ${noProgressPasses} pass(es) — stopping.`);
        ctx.log("system", "  Ensure target bots are docked, or set target_system/target_poi on goals.");
        break;
      }
      ctx.log("system", `No actionable tasks (pass ${noProgressPasses}/3) — waiting 2 min for target bots to dock...`);
      await sleep(120_000);
      continue;
    }
    noProgressPasses = 0;

    // Broadcast material needs
    for (const task of tasks) {
      broadcastMaterialNeed(bot.username, task.item_id, task.quantity, {
        stationPoiId: task.target_poi,
        stationSystem: task.target_system,
        useGift: !!task.gift_target,
      });
    }

    const goalNames = [...new Set(tasks.map(t => t.target_name))];
    ctx.log("system", `=== Delivery plan (pass ${passCount}): ${tasks.length} task(s) for ${goalNames.length} goal(s): ${goalNames.join(', ')} ===`);

    // ── PHASE 3: Acquisition + delivery rounds ─────────────────────────

    yield "acquiring";
    const MAX_ROUNDS = 40;
    let round = 0;

    while (bot.state === "running" && round < MAX_ROUNDS) {
      round++;

      const pending = tasks.filter(t => !t.skipped && t.acquired < t.quantity);
      if (pending.length === 0) break;

      ctx.log("system", `Round ${round}: ${pending.length} task(s) pending`);

      await ensureUndocked(ctx);
      const safe = await safetyCheck(ctx, { fuelThresholdPct: FUEL_THR, hullThresholdPct: HULL_THR });
      if (!safe) {
        ctx.log("error", "Safety check failed — aborting");
        break;
      }

      const task = pending[0];
      const stillNeed = task.quantity - task.acquired;

      // ── 'search': probe market first, then specific mine, then skip ──────
      if (task.source === 'search') {
        const found = findCheapestBuySource(task.item_id, ctx.mapStore);
        if (found) {
          ctx.log("system", `Found market source for ${task.item_name}: ${found.poi_name} (${found.price} cr) — switching to buy`);
          task.source = 'buy';
          task.buySource = found;
        } else {
          // Use item-specific mine lookup — only picks POIs where this item was
          // actually recorded in ores_found, and only if bot has the right module.
          // Avoids blind "mine at local belt" which yields wrong items (e.g. Heat Sink).
          const specific = findMineSource(task.item_id, ctx.mapStore, ctx);
          if (specific) {
            ctx.log("system", `Found mine for ${task.item_name}: ${specific.poi_name} — switching to mine`);
            task.source = 'mine';
            task.minePoi = specific;
          } else {
            ctx.log("error", `${task.item_name}: no market or recorded mine source...`);
            task.skipped = true;
          }
        }
        continue; // re-enter round loop with updated source
      }

      // ── 'buy' ──────────────────────────────────────────────────────────
      if (task.source === "buy") {
        let src = task.buySource ?? findCheapestBuySource(task.item_id, ctx.mapStore) ?? undefined;

        if (!src) {
          ctx.log("warn", `No market source for ${task.item_name} — scanning ${15}...`);
          const sysIds = ctx.mapStore.getAllSystemIds().slice(0, 15);
          for (const sysId of sysIds) {
            if (bot.state !== "running") break;
            const sys = ctx.mapStore.getSystem(sysId);
            if (!sys) continue;
            const stationPoi = sys.pois.find((p: any) => p.has_base);
            if (!stationPoi) continue;
            const ok = await navigateToSystem(ctx, sysId, { fuelThresholdPct: FUEL_THR, hullThresholdPct: HULL_THR });
            if (!ok) continue;
            await bot.exec("travel", { target_poi: stationPoi.id });
            bot.poi = stationPoi.id;
            await bot.exec("dock"); bot.docked = true;
            await collectFromStorage(ctx);
            await recordMarketData(ctx);
            await ensureUndocked(ctx);
            src = findCheapestBuySource(task.item_id, ctx.mapStore) ?? undefined;
            if (src) { task.buySource = src; break; }
          }
        }

        if (!src) {
          ctx.log("error", `Cannot find market source for ${task.item_name} — skipping task`);
          task.skipped = true;
          continue;
        }

        const atSrc = await goToStation(ctx, src.system_id, src.poi_id, src.poi_name, FUEL_THR, HULL_THR);
        if (!atSrc) { ctx.log("error", `Cannot reach ${src.poi_name}`); continue; }

        await tryRefuel(ctx);
        await recordMarketData(ctx);
        await ensureUndocked(ctx);
        await bot.exec("dock"); bot.docked = true;

        // Batch buy: pick up ALL pending buy tasks at this source in one dock
        const sameSrc = tasks.filter(t =>
          !t.skipped &&
          t.acquired < t.quantity &&
          t.source === 'buy' &&
          t.buySource?.system_id === src!.system_id &&
          t.buySource?.poi_id === src!.poi_id,
        );
        for (const buyTask of sameSrc) {
          if (bot.state !== "running") break;
          if (cargoFullPct(bot) >= 90) break;
          const want = buyTask.quantity - buyTask.acquired;
          const bought = await buyItem(ctx, buyTask.item_id, buyTask.item_name, want);
          buyTask.acquired += bought;
          if (bought > 0) {
            ctx.log("trade", `Loaded ${bought}x ${buyTask.item_name} for '${buyTask.target_name}' (${buyTask.acquired}/${buyTask.quantity})`);
          }
        }
        await ensureUndocked(ctx);

      // ── 'mine' ─────────────────────────────────────────────────────────
      } else if (task.source === "mine") {
        let mineTarget = task.minePoi;
        if (!mineTarget) {
          const local = await findLocalMinePOI(ctx);
          if (local) {
            mineTarget = { system_id: bot.system, poi_id: local.id, poi_name: local.name };
          } else {
            ctx.log("error", `No mine location for ${task.item_name} — skipping task`);
            task.skipped = true;
            continue;
          }
        }
        if (bot.system !== mineTarget.system_id) {
          await ensureUndocked(ctx);
          const arrived = await navigateToSystem(ctx, mineTarget.system_id, { fuelThresholdPct: FUEL_THR, hullThresholdPct: HULL_THR });
          if (!arrived) { ctx.log("error", `Cannot reach mine system ${mineTarget.system_id}`); continue; }
        }
        await ensureUndocked(ctx);
        if (bot.poi !== mineTarget.poi_id) {
          await bot.exec("travel", { target_poi: mineTarget.poi_id });
          bot.poi = mineTarget.poi_id;
        }
        const mined = await mineItem(ctx, task.item_id, task.item_name, stillNeed);
        if (mined === -1) {
          // POI yielded a different resource — this item cannot be mined (likely craft-only)
          ctx.log("error", `${task.item_name} is not obtainable by mining — skipping task (check if it requires crafting)`);
          task.skipped = true;
        } else if (mined === -2) {
          // POI requires ice/gas harvester module that this bot does not have
          ctx.log("error", `${task.item_name}: mine POI requires a specialized harvester`);
          task.skipped = true;
        } else if (mined === 0) {
          ctx.log("warn", `Mine depleted for ${task.item_name} — reverting to search`);
          task.minePoi = undefined;
          task.source = 'search'; // re-probe next round
        } else {
          task.acquired += mined;
        }
      }

      // ── Delivery trigger: when cargo full or all tasks fulfilled ────────
      await bot.refreshStatus();
      const allDone = tasks.every(t => t.skipped || t.acquired >= t.quantity);
      const cargoFull = cargoFullPct(bot) >= 80;

      if (allDone || cargoFull) {
        yield "delivering";
        const withCargo = tasks.filter(t => countInCargo(bot, t.item_id) > 0);
        if (withCargo.length > 0) {
          const deposited = await depositAllToTargets(ctx, withCargo, FUEL_THR, HULL_THR);
          const stations = new Set(withCargo.map(t => t.target_poi)).size;
          ctx.log("system", `Deposited ${deposited} units across ${stations} station(s)`);
        }
        if (allDone) break;
      }
    }

    // ── PHASE 4: Final deposit (anything left in cargo) ──────────────────

    await bot.refreshCargo();
    const leftover = tasks.filter(t => countInCargo(bot, t.item_id) > 0);
    if (leftover.length > 0) {
      ctx.log("system", "Final deposit of remaining cargo...");
      await depositAllToTargets(ctx, leftover, FUEL_THR, HULL_THR);
    }

    releaseAllGatherClaims(bot.username);
    clearAllMaterialNeeds(bot.username);

    const delivered = tasks.filter(t => !t.skipped && t.acquired >= t.quantity).length;
    const partial = tasks.filter(t => !t.skipped && t.acquired > 0 && t.acquired < t.quantity).length;
    const skippedCount = tasks.filter(t => t.skipped).length;
    const parts: string[] = [`${delivered}/${tasks.length - skippedCount} delivered`];
    if (partial > 0) parts.push(`${partial} partial`);
    if (skippedCount > 0) parts.push(`${skippedCount} skipped (no source)`);
    ctx.log("system", `=== Pass ${passCount} complete: ${parts.join(', ')} ===`);

    // Re-dock and prepare for next pass
    const docked = await ensureDocked(ctx);
    if (docked) {
      await dumpAllCargo(ctx);
      await tryRefuel(ctx);
      await repairShip(ctx);
      await recordMarketData(ctx);
    }
  }

  ctx.log("system", "=== Gatherer routine finished ===");
};

/**
 * Score the gatherer routine for SmartSelector.
 * Returns 0 when no fleet goals have pending materials, higher when more work exists.
 * Follows the same pattern as scoreCrafter() in crafter.ts.
 */
export function scoreGatherer(ctx: RoutineContext): number {
  const goals = getAllGoalsAcrossFleet();
  if (goals.length === 0) return 0;

  // Highest priority: own build goals with all materials confirmed in faction storage DB.
  // This means the build command can execute immediately — no courier work needed.
  for (const { goal, owner_bot } of goals) {
    if (owner_bot !== ctx.bot.username) continue;
    if (goal.goal_type && goal.goal_type !== 'build') continue;
    if (!goal.target_id || !goal.materials?.length || !goal.target_poi) continue;
    const facDbItems = ctx.mapStore.getFactionStorageItemsForPoi(goal.target_poi);
    const allReady = goal.materials.every(mat => {
      const entry = facDbItems.find((i: any) => i.item_id === mat.item_id);
      return entry && (entry.quantity ?? 0) >= mat.quantity_needed;
    });
    if (allReady) return 90; // Ready to build — beat trader/miner, run immediately
  }

  let pendingMaterials = 0;
  for (const { goal, owner_bot } of goals) {
    if (!goal.materials?.length) continue;
    // Goals where this bot is the crafter are handled by the crafter routine, not gatherer
    if (goal.crafter_bot === ctx.bot.username) continue;
    // Own build goals with materials configured: count them so gatherer gets selected
    // and can verify/transfer materials then execute the build
    if (owner_bot === ctx.bot.username && (!goal.goal_type || goal.goal_type === 'build') && goal.target_id) {
      pendingMaterials += goal.materials.length;
      continue;
    }
    pendingMaterials += goal.materials.length;
  }

  if (pendingMaterials === 0) return 0;
  // Base 25 + 2 per pending material type, capped at 55
  return Math.min(55, 25 + pendingMaterials * 2);
}
