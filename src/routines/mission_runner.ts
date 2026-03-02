/**
 * MissionRunner routine — accepts and completes NPC missions for credits and XP.
 * Ported algorithms from spacemolt-web MissionBot.ts.
 *
 * Objective types: deliver, mine, buy, sell, visit, dock, craft, kill
 * Features: difficulty filter, preferBuying/Mining, return-to-giver, cargo management,
 *           progress sync from API (only when docked), sell-order cargo clearing.
 *
 * Loop: dock → browse → filter → accept best → execute objectives → complete → repeat
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  ensureUndocked,
  ensureFueled,
  tryRefuel,
  repairShip,
  navigateToSystem,
  detectAndRecoverFromDeath,
  getSystemInfo,
  readSettings,
  sleep,
  logStatus,
} from "./common.js";
import type { MapStore } from "../mapstore.js";

// ── Settings ─────────────────────────────────────────────────

interface MissionRunnerSettings {
  missionTypes: string[];
  minDifficulty: number;
  maxDifficulty: number;
  minReward: number;
  preferBuying: boolean;
  preferMining: boolean;
  maxBuyPrice: number;
  refuelThreshold: number;
  cycleDelayMs: number;
}

function getMissionRunnerSettings(): MissionRunnerSettings {
  const all = readSettings();
  const m = all.mission_runner || {};
  const types = m.missionTypes as string[] | string | undefined;
  return {
    missionTypes: Array.isArray(types) ? types : (types ? String(types).split(",").map(s => s.trim()).filter(Boolean) : []),
    minDifficulty: (m.minDifficulty as number) || 0,
    maxDifficulty: (m.maxDifficulty as number) || 0,
    minReward: (m.minReward as number) || 0,
    preferBuying: (m.preferBuying as boolean) !== false,
    preferMining: (m.preferMining as boolean) !== false,
    maxBuyPrice: (m.maxBuyPrice as number) || 0,
    refuelThreshold: (m.refuelThreshold as number) || 50,
    cycleDelayMs: (m.cycleDelayMs as number) || 30000,
  };
}

// ── Types ─────────────────────────────────────────────────────

type ObjType = "deliver" | "mine" | "buy" | "sell" | "visit" | "dock" | "craft" | "kill";

interface MissionObjective {
  type: ObjType;
  target: string;
  targetName: string;
  quantity: number;
  current: number;
  targetSystem: string;
  targetPoi: string;
  targetBase: string;
  complete: boolean;
}

interface Mission {
  id: string;
  title: string;
  type: string;
  difficulty: number;
  reward_credits: number;
  giver_base: string;
  objectives: MissionObjective[];
}

// ── Parsing ────────────────────────────────────────────────────

function determineObjectiveType(obj: Record<string, unknown>): ObjType {
  const type = ((obj.type as string) || "").toLowerCase();
  if (type.includes("dock")) return "dock";
  if (type.includes("sell")) return "sell";
  if (type.includes("deliver")) return "deliver";
  if (type.includes("mine") || type.includes("extract")) return "mine";
  if (type.includes("craft") || type.includes("create")) return "craft";
  if (type.includes("kill") || type.includes("destroy") || type.includes("hunt")) return "kill";
  if (type.includes("visit") || type.includes("travel") || type.includes("explore")) return "visit";
  if (type.includes("buy") || type.includes("purchase")) return "buy";
  // Infer from fields
  if (obj.resource_type) return "mine";
  if (obj.item_id && obj.quantity) return "deliver";
  if (obj.system_id || obj.poi_id || obj.target_system) return "visit";
  if (typeof obj.target === "string" && obj.target.includes("npc")) return "kill";
  return "deliver";
}

function parseObjective(o: Record<string, unknown>): MissionObjective {
  const type = determineObjectiveType(o);
  let targetBase = (o.target_base as string) || "";
  // Extract base name from dock descriptions: "Dock at Sol Central", "Return to Sol Central with ..."
  if (type === "dock" && !targetBase && o.description) {
    const match = (o.description as string).match(/(?:at|to)\s+(.+?)(?:\s+with|\s+and|$)/i);
    if (match) targetBase = match[1].trim();
  }
  return {
    type,
    target: (o.item_id as string) || (o.resource_type as string) || (o.target as string) || "",
    targetName: (o.item_name as string) || (o.resource_name as string) || (o.target_name as string) || (o.name as string) || targetBase || "",
    quantity: (o.quantity as number) || (o.required as number) || (o.target_quantity as number) || 1,
    current: (o.current as number) || (o.progress as number) || 0,
    targetSystem: (o.target_system as string) || (o.system_id as string) || "",
    targetPoi: (o.target_poi as string) || (o.poi_id as string) || "",
    targetBase,
    complete: !!(o.complete || o.completed),
  };
}

const MAX_ACTIVE_MISSIONS = 5;

/** Parse a single raw mission record. Returns null if no id. */
function parseMission(m: Record<string, unknown>): Mission | null {
  const id = (m.mission_id as string) || (m.id as string) || "";
  if (!id) return null;
  const rewards = (m.rewards as Record<string, unknown>) || {};
  const rewardCredits = (m.reward_credits as number) || (rewards.credits as number) || 0;
  const rawObjs = (m.objectives as Array<Record<string, unknown>>) || [];
  return {
    id,
    title: (m.title as string) || (m.name as string) || "",
    type: (m.type as string) || (m.mission_type as string) || "",
    difficulty: (m.difficulty as number) || (m.level as number) || (m.min_level as number) || 0,
    reward_credits: rewardCredits,
    giver_base: (m.giver_base as string) || (m.issuing_base as string) || "",
    objectives: rawObjs.map(o => parseObjective(o)),
  };
}

/** Parse already-accepted (active) missions from a get_missions response. */
function parseActiveMissions(data: unknown): Mission[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const arr = (Array.isArray(d.active) ? d.active : []) as Array<Record<string, unknown>>;
  return arr.map(parseMission).filter((m): m is Mission => m !== null);
}

/** Parse missions available to accept from a get_missions response. */
function parseAvailableMissions(data: unknown): Mission[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const arr = (
    Array.isArray(d.available) ? d.available :
    Array.isArray(d.missions) ? d.missions :
    Array.isArray(d) ? d :
    Array.isArray(d.items) ? d.items :
    []
  ) as Array<Record<string, unknown>>;
  return arr.map(parseMission).filter((m): m is Mission => m !== null);
}

/** Apply settings filters and sort available missions by reward (desc). */
function filterMissions(missions: Mission[], settings: MissionRunnerSettings): Mission[] {
  let candidates = [...missions];
  if (settings.missionTypes.length > 0) {
    candidates = candidates.filter(m =>
      settings.missionTypes.some(t => m.type.toLowerCase().includes(t.toLowerCase()))
    );
  }
  if (settings.minReward > 0) candidates = candidates.filter(m => m.reward_credits >= settings.minReward);
  if (settings.minDifficulty > 0) candidates = candidates.filter(m => m.difficulty >= settings.minDifficulty);
  if (settings.maxDifficulty > 0) candidates = candidates.filter(m => m.difficulty === 0 || m.difficulty <= settings.maxDifficulty);
  return candidates.sort((a, b) => b.reward_credits - a.reward_credits);
}

/**
 * Pick the active mission to work on:
 * - Prefer the one closest to completion (most objectives done / total).
 * - Break ties by highest reward.
 */
function pickBestActiveMission(missions: Mission[]): Mission {
  return [...missions].sort((a, b) => {
    const aDone = a.objectives.filter(o => o.complete).length;
    const bDone = b.objectives.filter(o => o.complete).length;
    const aTotal = a.objectives.length || 1;
    const bTotal = b.objectives.length || 1;
    const aPct = aDone / aTotal;
    const bPct = bDone / bTotal;
    if (bPct !== aPct) return bPct - aPct; // most complete first
    return b.reward_credits - a.reward_credits;
  })[0];
}

// ── Helpers ────────────────────────────────────────────────────

/** Sync objective progress from API via get_active_missions (works docked or undocked). */
async function syncMissionProgress(
  ctx: RoutineContext,
  missionId: string,
  objectives: MissionObjective[],
): Promise<void> {
  const { bot } = ctx;

  const resp = await bot.exec("get_active_missions");
  if (resp.error) return;

  const d = resp.result as Record<string, unknown>;
  const active = (
    Array.isArray(d.missions) ? d.missions :
    Array.isArray(d.active) ? d.active :
    Array.isArray(d) ? d : []
  ) as Array<Record<string, unknown>>;

  const mission = active.find(m =>
    ((m.mission_id as string) || (m.id as string)) === missionId
  );
  if (!mission?.objectives) return;

  const apiObjs = mission.objectives as Array<Record<string, unknown>>;
  for (let i = 0; i < objectives.length; i++) {
    const ao = apiObjs[i];
    if (ao) {
      objectives[i].current = (ao.current as number) ?? (ao.progress as number) ?? objectives[i].current;
      objectives[i].complete = !!(ao.complete || ao.completed);
    }
  }
}

/** Search map for a base POI by name (partial match). Returns {systemId, poiId} or null. */
function findBaseByName(name: string, ms: MapStore): { systemId: string; poiId: string; poiName: string } | null {
  const lower = name.toLowerCase();
  for (const [sysId, sys] of Object.entries(ms.getAllSystems())) {
    for (const poi of sys.pois) {
      const checkName = (poi.base_name || poi.name || "").toLowerCase();
      if (checkName && (checkName.includes(lower) || lower.includes(checkName))) {
        return { systemId: sysId, poiId: poi.id, poiName: poi.base_name || poi.name || poi.id };
      }
    }
  }
  return null;
}

/** Sell non-mission cargo when full; create sell orders for items with no buyers. */
async function handleCargoFull(ctx: RoutineContext, keepItemId: string): Promise<void> {
  const { bot } = ctx;
  ctx.log("info", `Cargo full — docking to clear non-mission items (keeping ${keepItemId})...`);
  await ensureDocked(ctx);
  await bot.refreshCargo();

  for (const item of [...bot.inventory]) {
    if (item.quantity <= 0) continue;
    const lower = item.itemId.toLowerCase();
    // Keep mission objective item and fuel
    if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
    if (
      item.itemId === keepItemId ||
      item.itemId.includes(keepItemId.replace("ore_", "")) ||
      keepItemId.includes(item.itemId.replace("ore_", ""))
    ) {
      ctx.log("info", `Keeping ${item.quantity}x ${item.name} (mission item)`);
      continue;
    }

    const sellResp = await bot.exec("sell", { item_id: item.itemId, quantity: item.quantity });
    if (!sellResp.error) {
      ctx.log("info", `Sold ${item.quantity}x ${item.name}`);
    } else {
      // No direct buyer — create a sell order to free cargo space
      let price = 5;
      const mktResp = await bot.exec("view_market");
      if (!mktResp.error && mktResp.result) {
        const mkt = mktResp.result as Record<string, unknown>;
        const entries = (Array.isArray(mkt) ? mkt : (mkt.market as unknown[])) as Array<Record<string, unknown>>;
        const entry = (entries || []).find(e => (e.item_id as string) === item.itemId);
        if (entry) {
          const buyOrders = (entry.buy_orders as Array<Record<string, unknown>>) || [];
          if (buyOrders.length > 0) {
            price = Math.max(...buyOrders.map(o => (o.price as number) || 0));
          }
        }
      }
      await bot.exec("create_sell_order", { item_id: item.itemId, quantity: item.quantity, price_each: price });
      ctx.log("info", `Created sell order: ${item.quantity}x ${item.name} @ ${price}cr`);
    }
    await sleep(500);
  }
  await bot.refreshCargo();
}

// ── Objective handler ─────────────────────────────────────────

async function* executeObjective(
  ctx: RoutineContext,
  obj: MissionObjective,
  settings: MissionRunnerSettings,
  missionId: string,
  objectives: MissionObjective[],
): AsyncGenerator<string> {
  const { bot } = ctx;

  switch (obj.type) {

    // ── Deliver / Mine ──
    case "deliver":
    case "mine": {
      yield `obj_${obj.type}`;
      if (bot.docked) await syncMissionProgress(ctx, missionId, objectives);
      if (obj.complete || obj.current >= obj.quantity) { obj.complete = true; return; }

      const needed = obj.quantity - obj.current;
      ctx.log("info", `${obj.type}: need ${needed}x ${obj.targetName || obj.target} (${obj.current}/${obj.quantity})`);

      // Try buying first (not for pure mine objectives unless preferBuying)
      if (settings.preferBuying && obj.type !== "mine") {
        yield "try_buy";
        await ensureDocked(ctx);
        const mktResp = await bot.exec("view_market");
        if (!mktResp.error && mktResp.result) {
          const mkt = mktResp.result as Record<string, unknown>;
          const entries = (Array.isArray(mkt) ? mkt : (mkt.market as unknown[])) as Array<Record<string, unknown>>;
          const entry = (entries || []).find(e => (e.item_id as string) === obj.target);
          if (entry) {
            const sellOrders = ((entry.sell_orders as Array<Record<string, unknown>>) || [])
              .sort((a, b) => (a.price as number) - (b.price as number));
            const cheapest = sellOrders[0];
            if (cheapest) {
              const unitPrice = cheapest.price as number;
              if (!settings.maxBuyPrice || unitPrice <= settings.maxBuyPrice) {
                const canBuy = Math.min(
                  needed,
                  (cheapest.quantity as number) || needed,
                  Math.floor(bot.credits / unitPrice),
                );
                if (canBuy > 0) {
                  const buyResp = await bot.exec("buy", { item_id: obj.target, quantity: canBuy, max_price: unitPrice });
                  if (!buyResp.error) {
                    ctx.log("info", `Bought ${canBuy}x ${obj.targetName || obj.target} @ ${unitPrice}cr`);
                    await syncMissionProgress(ctx, missionId, objectives);
                    if (obj.current >= obj.quantity) { obj.complete = true; return; }
                  }
                }
              }
            }
          }
        }
      }

      // Mine the resource
      if (settings.preferMining) {
        yield "mine_resource";
        await ensureUndocked(ctx);

        // Navigate to mining POI
        const { pois } = await getSystemInfo(ctx);
        const miningPoi = pois.find(p =>
          p.type === "asteroid_belt" || p.type === "asteroid_field" ||
          p.type === "gas_cloud" || p.type === "ice_field" || p.type === "mining"
        );
        if (miningPoi && bot.poi !== miningPoi.id) {
          const tResp = await bot.exec("travel", { target_poi: miningPoi.id });
          if (tResp.error) { ctx.log("warn", `Travel to mining POI failed: ${tResp.error.message}`); return; }
          await bot.refreshStatus();
        }

        const mineResp = await bot.exec("mine");
        if (mineResp.error) {
          const msg = (mineResp.error.message || "").toLowerCase();
          if (msg.includes("cargo") || msg.includes("full")) {
            yield "clear_cargo";
            await handleCargoFull(ctx, obj.target);
            await ensureUndocked(ctx);
          } else if (msg.includes("cooldown")) {
            const wait = ((mineResp.error as Record<string, unknown>).wait_seconds as number) || 3;
            await sleep(wait * 1000);
          } else {
            ctx.log("warn", `Mine error: ${mineResp.error.message}`);
          }
          return;
        }

        if (mineResp.result) {
          const r = mineResp.result as Record<string, unknown>;
          const qty = (r.quantity as number) || 0;
          if (qty > 0) {
            const minedId = (r.item_id as string) || (r.resource_id as string) || "";
            const isCorrect =
              minedId === obj.target ||
              minedId.replace("ore_", "") === obj.target.replace("ore_", "") ||
              minedId.includes(obj.target.replace("ore_", "")) ||
              obj.target.includes(minedId.replace("ore_", ""));
            if (isCorrect) {
              obj.current += qty;
              ctx.log("info", `Mined ${qty}x ${r.resource_name || minedId} (${obj.current}/${obj.quantity})`);
              if (obj.current >= obj.quantity) obj.complete = true;
            } else {
              ctx.log("info", `Mined ${qty}x ${r.resource_name || minedId} — wrong resource, need ${obj.target}`);
            }
          }
        }
      } else {
        ctx.log("warn", `Cannot acquire ${obj.target}: preferBuying=false and preferMining=false`);
      }
      break;
    }

    // ── Buy ──
    case "buy": {
      yield "obj_buy";
      await ensureDocked(ctx);
      const needed = obj.quantity - obj.current;
      if (needed <= 0) { obj.complete = true; return; }
      const maxPrice = settings.maxBuyPrice || undefined;
      const buyResp = await bot.exec("buy", { item_id: obj.target, quantity: needed, ...(maxPrice ? { max_price: maxPrice } : {}) });
      if (buyResp.error) {
        ctx.log("warn", `Buy failed: ${buyResp.error.message}`);
      } else {
        obj.current = obj.quantity;
        obj.complete = true;
        ctx.log("info", `Bought ${needed}x ${obj.targetName || obj.target}`);
      }
      break;
    }

    // ── Sell ──
    case "sell": {
      yield "obj_sell";
      await ensureDocked(ctx);
      await bot.refreshCargo();
      let totalSold = 0;
      for (const item of bot.inventory) {
        if (obj.current >= obj.quantity) break;
        if (item.quantity <= 0) continue;
        const toSell = Math.min(item.quantity, obj.quantity - obj.current);
        const sellResp = await bot.exec("sell", { item_id: item.itemId, quantity: toSell });
        if (!sellResp.error) {
          totalSold += toSell;
          obj.current += toSell;
          ctx.log("info", `Sold ${toSell}x ${item.name}`);
        }
        await sleep(300);
      }
      if (obj.current >= obj.quantity) obj.complete = true;
      else if (totalSold === 0) {
        ctx.log("warn", "No items available to sell — marking objective done");
        obj.complete = true;
      }
      break;
    }

    // ── Visit ──
    case "visit": {
      yield "obj_visit";
      const targetSys = obj.targetSystem || obj.target;
      if (targetSys && bot.system !== targetSys) {
        await ensureUndocked(ctx);
        ctx.log("info", `Navigating to ${targetSys}...`);
        await navigateToSystem(ctx, targetSys, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
        await bot.refreshStatus();
      }
      if (obj.targetPoi && bot.poi !== obj.targetPoi) {
        await ensureUndocked(ctx);
        const tResp = await bot.exec("travel", { target_poi: obj.targetPoi });
        if (!tResp.error) await bot.refreshStatus();
      }
      obj.complete = true;
      ctx.log("info", `Visited ${obj.targetName || targetSys}`);
      break;
    }

    // ── Dock at base ──
    case "dock": {
      yield "obj_dock";
      const baseName = obj.targetBase || obj.targetName || obj.target;
      let targetSysId = obj.targetSystem;
      let targetPoiId = obj.targetPoi;

      // Search mapStore for base by name if IDs not provided
      if (baseName && (!targetSysId || !targetPoiId)) {
        const found = findBaseByName(baseName, ctx.mapStore);
        if (found) {
          targetSysId = found.systemId;
          targetPoiId = found.poiId;
          ctx.log("info", `Found base "${baseName}" → system ${targetSysId}, POI ${found.poiName}`);
        }
      }

      // Navigate to system
      if (targetSysId && bot.system !== targetSysId) {
        yield "dock_jump";
        await ensureUndocked(ctx);
        await navigateToSystem(ctx, targetSysId, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
        await bot.refreshStatus();
        return;
      }

      // Travel to POI
      if (targetPoiId && bot.poi !== targetPoiId) {
        yield "dock_travel";
        await ensureUndocked(ctx);
        const tResp = await bot.exec("travel", { target_poi: targetPoiId });
        if (tResp.error) { ctx.log("warn", `Travel failed: ${tResp.error.message}`); return; }
        await bot.refreshStatus();
        return;
      }

      // Dock
      if (!bot.docked) {
        const dockResp = await bot.exec("dock");
        if (dockResp.error) { ctx.log("warn", `Dock failed: ${dockResp.error.message}`); return; }
        await bot.refreshStatus();
      }

      // Sync progress (now docked)
      await syncMissionProgress(ctx, missionId, objectives);
      if (!obj.complete) {
        obj.complete = true;
        ctx.log("info", `Docked at ${baseName || "base"} — objective complete`);
      }
      // Undock to continue next objectives
      await sleep(500);
      await bot.exec("undock");
      await bot.refreshStatus();
      break;
    }

    // ── Craft (stub) ──
    case "craft": {
      yield "obj_craft";
      ctx.log("warn", `Craft objective not fully supported — skipping: ${obj.targetName || obj.target}`);
      obj.complete = true;
      break;
    }

    // ── Kill (not supported) ──
    case "kill": {
      yield "obj_kill";
      ctx.log("warn", `Kill objective not supported — skipping: ${obj.targetName || obj.target}`);
      obj.complete = true;
      break;
    }

    default:
      obj.complete = true;
  }
}

// ── Routine ──────────────────────────────────────────────────

export const missionRunnerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  await bot.refreshStatus();
  ctx.log("system", "MissionRunner online — browsing missions for credits and XP...");

  let sessCompleted = 0;
  let sessFailed = 0;

  while (bot.state === "running") {
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleep(30000); continue; }

    const settings = getMissionRunnerSettings();

    // ── Dock + service ──
    yield "dock";
    await ensureDocked(ctx);
    await tryRefuel(ctx);
    await repairShip(ctx);
    await bot.refreshStatus();

    // ── Check active missions first (separate API from mission board) ──
    yield "get_active_missions";
    const activeResp = await bot.exec("get_active_missions");
    let activeMissions: Mission[] = [];
    if (!activeResp.error && activeResp.result) {
      const d = activeResp.result as Record<string, unknown>;
      const arr = (
        Array.isArray(d.missions) ? d.missions :
        Array.isArray(d.active) ? d.active :
        Array.isArray(d) ? d : []
      ) as Array<Record<string, unknown>>;
      activeMissions = arr.map(parseMission).filter((m): m is Mission => m !== null);
    }
    ctx.log("info", `Active missions: ${activeMissions.length}/${MAX_ACTIVE_MISSIONS}`);

    // ── Accept a new mission only if slots are free ──
    if (activeMissions.length < MAX_ACTIVE_MISSIONS) {
      yield "get_missions";
      const boardResp = await bot.exec("get_missions");
      if (boardResp.error) {
        ctx.log("warn", `Cannot get mission board: ${boardResp.error.message}`);
      } else {
        const availableMissions = parseAvailableMissions(boardResp.result);
        ctx.log("info", `Available on board: ${availableMissions.length}`);
        const candidates = filterMissions(availableMissions, settings);
        if (candidates.length > 0) {
          const toAccept = candidates[0];
          ctx.log("info", `Best: "${toAccept.title}" (${toAccept.type}, diff: ${toAccept.difficulty || "?"}, +${toAccept.reward_credits}cr)`);
          yield "accept_mission";
          const acceptResp = await bot.exec("accept_mission", { mission_id: toAccept.id });
          if (!acceptResp.error) {
            ctx.log("info", `Accepted: "${toAccept.title}"`);
            await bot.refreshStatus();
            activeMissions.push(toAccept);
          } else {
            ctx.log("warn", `Accept failed: ${acceptResp.error.message}`);
          }
        } else if (availableMissions.length > 0) {
          ctx.log("info", `${availableMissions.length} mission(s) on board but none match filters`);
        } else {
          ctx.log("info", "No missions on board at this station");
        }
      }
    } else {
      ctx.log("info", `Mission slots full (${activeMissions.length}/${MAX_ACTIVE_MISSIONS}) — completing existing missions`);
    }

    // ── Nothing active to work on ──
    if (activeMissions.length === 0) {
      ctx.log("info", "No active missions — waiting...");
      await sleep(settings.cycleDelayMs);
      continue;
    }

    // ── Pick the best active mission to work on now ──
    const mission = pickBestActiveMission(activeMissions);
    const doneSoFar = mission.objectives.filter(o => o.complete).length;
    ctx.log("info", `Working on: "${mission.title}" (${doneSoFar}/${mission.objectives.length} objectives done, +${mission.reward_credits}cr)`);

    // ── Reload objectives from API ──
    yield "load_objectives";
    let objectives: MissionObjective[] = [...mission.objectives];
    if (bot.docked) {
      await syncMissionProgress(ctx, mission.id, objectives);
    }
    ctx.log("info", `${objectives.filter(o => !o.complete).length} objective(s) remaining`);

    // ── Execute objectives loop ──
    yield "execute_mission";
    let missionFailed = false;
    const MAX_ATTEMPTS = 40;
    let attempts = 0;

    while (bot.state === "running") {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        ctx.log("error", `Exceeded ${MAX_ATTEMPTS} objective attempts — abandoning "${mission.title}"`);
        missionFailed = true;
        break;
      }

      if (bot.docked) await syncMissionProgress(ctx, mission.id, objectives);

      const incomplete = objectives.filter(o => !o.complete);
      if (incomplete.length === 0) {
        ctx.log("info", "All objectives complete!");
        break;
      }

      const obj = incomplete[0];
      ctx.log("info", `Objective [${obj.type}]: ${obj.targetName || obj.target} (${obj.current}/${obj.quantity})`);

      for await (const step of executeObjective(ctx, obj, settings, mission.id, objectives)) {
        yield step;
        if (bot.state !== "running") break;
      }

      if (bot.state !== "running") break;
      await sleep(1500);
    }

    // ── Complete or abandon ──
    yield "finalize";

    if (missionFailed || bot.state !== "running") {
      const abandonResp = await bot.exec("abandon_mission", { mission_id: mission.id });
      if (!abandonResp.error) ctx.log("info", `Abandoned: "${mission.title}"`);
      sessFailed++;
    } else {
      // Navigate to mission giver base for completion if needed
      if (mission.giver_base) {
        const giverParts = mission.giver_base.split("_");
        const giverSystem = giverParts[0];
        if (giverSystem && bot.system !== giverSystem && bot.system !== mission.giver_base) {
          yield "return_to_giver";
          ctx.log("info", `Returning to mission giver: ${mission.giver_base}...`);
          await ensureUndocked(ctx);
          await navigateToSystem(ctx, giverSystem, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
          await bot.refreshStatus();
        }
        if (!bot.docked) {
          const { pois } = await getSystemInfo(ctx);
          const giverPoi = pois.find(p => p.id === mission.giver_base || p.id.startsWith(giverSystem));
          if (giverPoi && bot.poi !== giverPoi.id) {
            await bot.exec("travel", { target_poi: giverPoi.id });
            await bot.refreshStatus();
          }
          await ensureDocked(ctx);
        }
      }

      yield "complete_mission";
      const completeResp = await bot.exec("complete_mission", { mission_id: mission.id });
      if (completeResp.error) {
        ctx.log("warn", `Complete failed: ${completeResp.error.message}`);
        await bot.exec("abandon_mission", { mission_id: mission.id });
        sessFailed++;
      } else {
        sessCompleted++;
        ctx.log("info", `✓ Done: "${mission.title}" (+${mission.reward_credits}cr) — session: ${sessCompleted} done, ${sessFailed} failed`);
      }
    }

    // ── Post-mission: dock + service ──
    yield "service";
    await ensureDocked(ctx);
    await ensureFueled(ctx, settings.refuelThreshold);
    await repairShip(ctx);
    await bot.refreshStatus();
    logStatus(ctx);

    // Short delay if there are still active missions to work on; full delay when idle
    const checkResp = await bot.exec("get_active_missions");
    const checkD = (!checkResp.error && checkResp.result) ? checkResp.result as Record<string, unknown> : {};
    const checkArr = Array.isArray(checkD.missions) ? checkD.missions : Array.isArray(checkD.active) ? checkD.active : Array.isArray(checkD) ? checkD : [];
    const remainingActive = (checkArr as unknown[]).length;
    if (remainingActive > 0) {
      ctx.log("info", `${remainingActive} active mission(s) remaining — continuing immediately`);
      await sleep(2000);
    } else {
      ctx.log("info", `All missions done. Credits: ${bot.credits}. Next check in ${Math.round(settings.cycleDelayMs / 1000)}s`);
      await sleep(settings.cycleDelayMs);
    }
  }
};
