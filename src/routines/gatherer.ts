/**
 * Gatherer routine — acquires build materials for a facility goal and
 * deposits them at the target station.
 *
 * Algorithm:
 *  1. Dock at current station, dump all cargo, refuel/repair.
 *  2. For each material: find cheapest market source (buy) or mine.
 *  3. Execute acquisition trips (multi-trip if cargo limit reached).
 *  4. After each full cargo load, return to target station and deposit.
 *  5. After all materials are gathered, final deposit + done.
 *
 * Settings (data/settings.json → "gatherer" key):
 *   goal: GatherGoal — set from the UI when the user clicks "📦 Gather".
 *   refuelThreshold: number (default 30) — fuel % below which we refuel.
 *   repairThreshold: number (default 40) — hull % below which we repair.
 */
import type { Routine, RoutineContext } from "../bot.js";
import type { MapStore } from "../mapstore.js";
import {
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  ensureFueled,
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
  claimGatherComponent, releaseGatherClaim, releaseAllGatherClaims, isGatherClaimedByOther,
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
}

interface MarketSource {
  system_id: string;
  poi_id: string;
  poi_name: string;
  price: number;
  stock: number;
}

// ── Settings ──────────────────────────────────────────────────

function getSettings(username?: string): {
  refuelThreshold: number;
  repairThreshold: number;
  /** All goals for this bot. Supports legacy single-goal format (goal) and new array format (goals). */
  goals: GatherGoal[];
} {
  const all = readSettings();
  const g = (all.gatherer || {}) as Record<string, unknown>;
  const bot = username ? ((all[username] || {}) as Record<string, unknown>) : {};
  // Support both legacy `goal` (single) and new `goals` (array)
  const arr = (bot.goals as GatherGoal[] | undefined) || [];
  const legacy = (bot.goal || g.goal || null) as GatherGoal | null;
  const goals: GatherGoal[] = arr.length > 0 ? arr : (legacy ? [legacy] : []);
  return {
    refuelThreshold: (g.refuelThreshold as number) || 30,
    repairThreshold: (g.repairThreshold as number) || 40,
    goals,
  };
}

// ── Market helpers ────────────────────────────────────────────

/** Find the cheapest market source (where we can BUY an item from NPCs). */
function findCheapestBuySource(itemId: string, ms: MapStore): MarketSource | null {
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

/** Find a known minable POI for an item (by recorded ores_found). */
function findMineSource(itemId: string, ms: MapStore): { system_id: string; poi_id: string; poi_name: string } | null {
  for (const sysId of ms.getAllSystemIds()) {
    const sys = ms.getSystem(sysId);
    if (!sys) continue;
    for (const poi of sys.pois) {
      if (!isMinablePoi(poi.type)) continue;
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

/** Count how many of an item are in station storage right now. */
function countInStorage(bot: RoutineContext["bot"], itemId: string): number {
  const entry = bot.storage.find((i: any) => (i.itemId || i.item_id) === itemId);
  return entry ? (entry.quantity || 0) : 0;
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

// ── Target station deposit ────────────────────────────────────

/**
 * Return to the target station and deposit all goal materials from cargo.
 * Also refuels and repairs while there. Returns true on success.
 */
async function returnAndDeposit(
  ctx: RoutineContext,
  goal: GatherGoal,
  goalItemIds: Set<string>,
  fuelThreshold: number,
  repairThreshold: number,
): Promise<boolean> {
  const { bot } = ctx;

  ctx.log("trade", `Returning to ${goal.target_name} to deposit...`);

  const ok = await goToStation(ctx, goal.target_system, goal.target_poi, goal.target_name, fuelThreshold, repairThreshold);
  if (!ok) return false;

  await tryRefuel(ctx);
  await repairShip(ctx);
  await recordMarketData(ctx);

  // Deposit only goal materials (leave fuel cells etc.)
  await bot.refreshCargo();
  let deposited = 0;
  for (const item of bot.inventory) {
    const id = item.itemId || (item as any).item_id;
    if (!goalItemIds.has(id)) continue;
    if (item.quantity <= 0) continue;

    const resp = await bot.exec("deposit_items", { item_id: id, quantity: item.quantity });
    if (!resp.error) {
      ctx.log("trade", `Deposited ${item.quantity}x ${item.name} → ${goal.target_name}`);
      deposited += item.quantity;
    } else {
      ctx.log("error", `Deposit failed for ${item.name}: ${resp.error.message}`);
    }
  }

  if (deposited > 0) await bot.refreshCargo();
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
  await bot.refreshStatus();

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

/** Find a minable POI in the current system. */
async function findLocalMinePOI(ctx: RoutineContext): Promise<{ id: string; name: string } | null> {
  const { pois } = await getSystemInfo(ctx);
  const mineable = pois.find(p => isMinablePoi(p.type));
  return mineable ? { id: mineable.id, name: mineable.name } : null;
}

/** Mine at current POI until `wantQty` is reached or cargo is full. Returns qty mined. */
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
    await bot.refreshStatus();
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
    const qty = (r?.quantity as number) || (r?.amount as number) || 1;
    mined += qty;

    if (mined % 20 === 0) {
      ctx.log("mine", `Mined ${mined}/${wantQty} ${itemName}`);
    }
  }

  return mined;
}

// ── Main routine ──────────────────────────────────────────────

/**
 * Execute a single GatherGoal: navigate, acquire all materials (respecting
 * component claims to avoid overlap with other gatherer bots), deposit at target.
 *
 * Returns true when goal is fully deposited, false if aborted.
 */
async function executeGoal(
  ctx: RoutineContext,
  goal: GatherGoal,
  FUEL_THR: number,
  HULL_THR: number,
): Promise<boolean> {
  const { bot } = ctx;
  const goalItemIds = new Set<string>(goal.materials.map((m: GatherMaterial) => m.item_id));

  ctx.log("system", `Goal: '${goal.target_name}' (${goal.target_id})`);
  ctx.log("system", `Destination: ${goal.target_poi} in ${goal.target_system}`);
  ctx.log("system", `Materials: ${goal.materials.map((m: GatherMaterial) => `${m.quantity_needed}x ${m.item_name}`).join(" | ")}`);

  // ── PHASE 2: Check target storage and build acquisition plan ────────

  ctx.log("system", "Checking existing materials at target...");

  const atTarget = await goToStation(ctx, goal.target_system, goal.target_poi, goal.target_name, FUEL_THR, HULL_THR);
  if (!atTarget) {
    ctx.log("error", "Cannot reach target station — aborting goal");
    return false;
  }

  await bot.refreshStorage();
  await tryRefuel(ctx);
  await repairShip(ctx);
  await recordMarketData(ctx);

  interface AcqTask {
    mat: GatherMaterial;
    remaining: number;
    source: "buy" | "mine" | "skip";
    buySource?: MarketSource | undefined;
    minePoi?: { system_id: string; poi_id: string; poi_name: string } | undefined;
  }

  const tasks: AcqTask[] = [];

  for (const mat of goal.materials) {
    const inStorage = countInStorage(bot, mat.item_id);
    const remaining = Math.max(0, mat.quantity_needed - inStorage);

    if (remaining === 0) {
      ctx.log("system", `✓ ${mat.item_name}: already have ${inStorage}/${mat.quantity_needed} in storage`);
      tasks.push({ mat, remaining: 0, source: "skip" });
      continue;
    }

    // Non-overlap: skip materials claimed by another gatherer bot
    if (isGatherClaimedByOther(bot.username, mat.item_id)) {
      ctx.log("system", `⏭ ${mat.item_name}: claimed by another gatherer — skipping (they will deliver it)`);
      tasks.push({ mat, remaining: 0, source: "skip" });
      continue;
    }

    ctx.log("system", `${mat.item_name}: need ${remaining} more (${inStorage} already stored)`);

    const buySource = findCheapestBuySource(mat.item_id, ctx.mapStore);
    if (buySource) {
      ctx.log("system", `  → Buy @ ${buySource.poi_name}: ${buySource.price} cr/unit (stock: ${buySource.stock})`);
      tasks.push({ mat, remaining, source: "buy", buySource });
      continue;
    }

    const mineSource = findMineSource(mat.item_id, ctx.mapStore);
    if (mineSource) {
      ctx.log("system", `  → Mine @ ${mineSource.poi_name} (${mineSource.system_id})`);
      tasks.push({ mat, remaining, source: "mine", minePoi: mineSource });
      continue;
    }

    ctx.log("warn", `  → No known source for ${mat.item_name} — will scan markets while traveling`);
    tasks.push({ mat, remaining, source: "buy" });
  }

  // ── PHASE 3: Acquire each material ────────────────────────────────────

  // Broadcast demand + claim all items we intend to acquire
  for (const task of tasks) {
    if (task.remaining <= 0 || task.source === "skip") continue;
    // Claim this item — if another bot just grabbed it, fall back gracefully
    const claimed = claimGatherComponent(bot.username, task.mat.item_id, goal.id);
    if (!claimed) {
      ctx.log("system", `⏭ ${task.mat.item_name}: claimed by another gatherer just now — skipping`);
      task.remaining = 0;
      task.source = "skip";
      continue;
    }
    const hasFaction = ctx.mapStore.hasFactionStorage(goal.target_poi);
    broadcastMaterialNeed(bot.username, task.mat.item_id, task.remaining, {
      stationPoiId: goal.target_poi,
      stationSystem: goal.target_system,
      useGift: hasFaction === false,
    });
  }

  for (const task of tasks) {
    if (bot.state !== "running") break;
    if (task.remaining <= 0 || task.source === "skip") continue;

    ctx.log("system", `--- Acquiring ${task.remaining}x ${task.mat.item_name} (${task.source}) ---`);

    await ensureUndocked(ctx);
    const safe = await safetyCheck(ctx, { fuelThresholdPct: FUEL_THR, hullThresholdPct: HULL_THR });
    if (!safe) {
      ctx.log("error", "Safety check failed — aborting");
      releaseAllGatherClaims(bot.username);
      return false;
    }

    let acquired = 0;
    let tripCount = 0;
    const MAX_TRIPS = 20;

    while (bot.state === "running" && acquired < task.remaining && tripCount < MAX_TRIPS) {
      tripCount++;
      ctx.log("system", `Trip ${tripCount}: ${acquired}/${task.remaining} ${task.mat.item_name} acquired so far`);

      if (task.source === "buy") {
        let src = task.buySource;
        if (!src) src = findCheapestBuySource(task.mat.item_id, ctx.mapStore) ?? undefined;

        if (!src) {
          ctx.log("warn", `No market source for ${task.mat.item_name} — checking nearby stations...`);
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
            await bot.exec("dock");
            bot.docked = true;
            await collectFromStorage(ctx);
            await recordMarketData(ctx);
            await ensureUndocked(ctx);
            src = findCheapestBuySource(task.mat.item_id, ctx.mapStore) ?? undefined;
            if (src) { ctx.log("trade", `Found ${task.mat.item_name} at ${src.poi_name} (${src.price} cr)`); break; }
          }
        }

        if (!src) {
          ctx.log("error", `Cannot find market source for ${task.mat.item_name} — skipping`);
          break;
        }

        const atSrc = await goToStation(ctx, src.system_id, src.poi_id, src.poi_name, FUEL_THR, HULL_THR);
        if (!atSrc) { ctx.log("error", `Cannot reach ${src.poi_name} — aborting this task`); break; }

        await tryRefuel(ctx);
        await recordMarketData(ctx);
        await ensureUndocked(ctx);

        const wantThisTrip = task.remaining - acquired;
        await bot.exec("dock");
        bot.docked = true;

        const bought = await buyItem(ctx, task.mat.item_id, task.mat.item_name, wantThisTrip);
        if (bought <= 0) {
          ctx.log("warn", `Could not buy ${task.mat.item_name} — market may be out`);
          task.buySource = undefined;
          await ensureUndocked(ctx);
          break;
        }

        acquired += bought;
        ctx.log("trade", `Acquired ${acquired}/${task.remaining} ${task.mat.item_name}`);
        if (acquired >= task.remaining) { clearMaterialNeed(bot.username, task.mat.item_id); }
        await ensureUndocked(ctx);

      } else if (task.source === "mine") {
        let mineTarget = task.minePoi;
        if (!mineTarget) {
          const local = await findLocalMinePOI(ctx);
          if (local) mineTarget = { system_id: bot.system, poi_id: local.id, poi_name: local.name };
          else { ctx.log("warn", `No known mine location for ${task.mat.item_name}`); break; }
        }

        if (bot.system !== mineTarget.system_id) {
          await ensureUndocked(ctx);
          const arrived = await navigateToSystem(ctx, mineTarget.system_id, { fuelThresholdPct: FUEL_THR, hullThresholdPct: HULL_THR });
          if (!arrived) { ctx.log("error", `Cannot reach mine system ${mineTarget.system_id}`); break; }
        }

        await ensureUndocked(ctx);
        if (bot.poi !== mineTarget.poi_id) {
          ctx.log("travel", `Traveling to ${mineTarget.poi_name}...`);
          const tResp = await bot.exec("travel", { target_poi: mineTarget.poi_id });
          if (tResp.error) { ctx.log("error", `Travel to mine failed: ${tResp.error.message}`); break; }
          bot.poi = mineTarget.poi_id;
        }

        const wantThisTrip = task.remaining - acquired;
        const mined = await mineItem(ctx, task.mat.item_id, task.mat.item_name, wantThisTrip);
        if (mined === 0) {
          ctx.log("warn", `No ${task.mat.item_name} mined — location depleted`);
          task.minePoi = undefined;
          break;
        }

        acquired += mined;
        ctx.log("mine", `Acquired ${acquired}/${task.remaining} ${task.mat.item_name}`);
        if (acquired >= task.remaining) { clearMaterialNeed(bot.username, task.mat.item_id); }
      }

      await bot.refreshStatus();
      const doneSoFar = acquired >= task.remaining;
      if (doneSoFar || cargoFullPct(bot) >= 80) {
        const deposited = await returnAndDeposit(ctx, goal, goalItemIds, FUEL_THR, HULL_THR);
        if (!deposited) { ctx.log("error", "Failed to deposit at target — aborting"); releaseAllGatherClaims(bot.username); return false; }
        if (!doneSoFar) await ensureUndocked(ctx);
      }
    }

    if (tripCount >= MAX_TRIPS) ctx.log("warn", `Reached max trips (${MAX_TRIPS}) for ${task.mat.item_name} — moving on`);

    // Release this specific item claim now that we're done with it
    releaseGatherClaim(bot.username, task.mat.item_id);
  }

  // ── PHASE 4: Final deposit ─────────────────────────────────────────────

  await bot.refreshCargo();
  const hasMaterialsInCargo = bot.inventory.some((i: any) => goalItemIds.has(i.itemId || i.item_id));
  if (hasMaterialsInCargo) {
    await returnAndDeposit(ctx, goal, goalItemIds, FUEL_THR, HULL_THR);
  } else {
    const ok = await goToStation(ctx, goal.target_system, goal.target_poi, goal.target_name, FUEL_THR, HULL_THR);
    if (ok) { await tryRefuel(ctx); await repairShip(ctx); }
  }

  await bot.refreshStorage();
  const summary = goal.materials.map((m: GatherMaterial) => {
    const have = countInStorage(bot, m.item_id);
    return `${m.item_name}: ${have >= m.quantity_needed ? "✓" : `${have}/${m.quantity_needed}`}`;
  }).join(" | ");
  clearAllMaterialNeeds(bot.username);
  ctx.log("system", `=== Goal complete: ${goal.target_name} === ${summary}`);
  bot.emit("systemLog", `[Gatherer] ${bot.username} completed goal for ${goal.target_name}: ${summary}`);
  return true;
}

export const gathererRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  ctx.log("system", "=== Gatherer started ===");

  const settings = getSettings(bot.username);
  const goals = settings.goals;

  if (!goals.length) {
    ctx.log("error", "No gather goals configured. Assign goals from the Commander → Goals tab.");
    return;
  }

  const FUEL_THR = settings.refuelThreshold;
  const HULL_THR = settings.repairThreshold;

  ctx.log("system", `${goals.length} goal(s) queued.`);

  // ── PHASE 1: Dock at current station, clear cargo, refuel/repair ──────

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

  // ── Process each goal sequentially ───────────────────────────────────

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < goals.length; i++) {
    if (bot.state !== "running") break;
    const goal = goals[i];
    ctx.log("system", `--- Goal ${i + 1}/${goals.length}: ${goal.target_name} ---`);
    yield `goal_${i}`;

    const ok = await executeGoal(ctx, goal, FUEL_THR, HULL_THR);
    if (ok) completed++;
    else failed++;
  }

  releaseAllGatherClaims(bot.username);
  clearAllMaterialNeeds(bot.username);
  ctx.log("system", `=== Gatherer complete: ${completed}/${goals.length} goals done${failed > 0 ? `, ${failed} failed` : ""} ===`);
};
