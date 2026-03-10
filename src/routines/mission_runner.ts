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
  sleepBot,
  logStatus,
  logAgentEvent,
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
  manualMissionId: string;
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
    manualMissionId: (m.manualMissionId as string) || "",
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

// ── Craft-objective helpers ────────────────────────────────────

/** Minimal recipe shape used by the mission runner craft handler. */
interface MissionRecipe {
  recipe_id: string;
  output_item_id: string;
  output_name: string;
  output_quantity: number;
  components: Array<{ item_id: string; quantity: number }>;
}

/** Parse a raw game API recipe list into MissionRecipe objects. */
function parseMissionRecipes(data: unknown): MissionRecipe[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  let raw: Array<Record<string, unknown>> = [];
  if (Array.isArray(d)) raw = d as Array<Record<string, unknown>>;
  else if (Array.isArray(d.recipes)) raw = d.recipes as Array<Record<string, unknown>>;
  else if (Array.isArray(d.items)) raw = d.items as Array<Record<string, unknown>>;
  else raw = Object.values(d).filter(v => v && typeof v === "object") as Array<Record<string, unknown>>;
  return raw.map(r => {
    const comps = (r.components || r.ingredients || r.inputs || r.materials || []) as Array<Record<string, unknown>>;
    const rawOut = r.outputs || r.output || r.result || r.produces;
    const out = (Array.isArray(rawOut) ? rawOut[0] : rawOut) as Record<string, unknown> | undefined ?? {};
    return {
      recipe_id: (r.recipe_id as string) || (r.id as string) || "",
      output_item_id: (out.item_id as string) || (r.output_item_id as string) || "",
      output_name: (out.name as string) || (out.item_name as string) || (r.output_name as string) || "",
      output_quantity: (out.quantity as number) || (r.output_quantity as number) || 1,
      components: comps.map(c => ({
        item_id: (c.item_id as string) || (c.id as string) || "",
        quantity: (c.quantity as number) || 1,
      })).filter(c => c.item_id),
    };
  }).filter(r => r.recipe_id);
}

type ItemStack = Array<{ itemId: string; quantity: number }>;

function countMissionCargo(inventory: ItemStack, itemId: string): number {
  return inventory.reduce((n, i) => i.itemId === itemId ? n + i.quantity : n, 0);
}
function countMissionStorage(storage: ItemStack, itemId: string): number {
  return storage.reduce((n, i) => i.itemId === itemId ? n + i.quantity : n, 0);
}
function countMissionItem(inventory: ItemStack, storage: ItemStack, itemId: string): number {
  return countMissionCargo(inventory, itemId) + countMissionStorage(storage, itemId);
}

/**
 * Estimate relative completion effort for scoring (lower = faster).
 * Used to rank missions by reward-per-effort rather than raw reward.
 */
function estimateMissionEffort(mission: Mission): number {
  let effort = 0;
  for (const obj of mission.objectives) {
    if (obj.complete) continue;
    switch (obj.type) {
      case "visit": effort += 1; break;
      case "dock":  effort += 1; break;
      case "buy":   effort += 2; break;
      case "sell":  effort += 2; break;
      case "deliver": effort += 3; break;
      case "craft": effort += 4; break;
      case "mine":  effort += Math.max(2, Math.ceil((obj.quantity || 1) / 5)); break;
      case "kill":  effort += 6 * Math.max(1, obj.quantity || 1); break;
      default:      effort += 2; break;
    }
  }
  return Math.max(1, effort);
}

/** Score = reward_credits / estimated_effort. Higher is better. */
function scoreMission(mission: Mission): number {
  return mission.reward_credits / estimateMissionEffort(mission);
}

/**
 * Pre-flight checks before accepting a mission:
 * - kill: requires at least one weapon module installed
 * - deliver/buy: skip if maxBuyPrice is set and bot cannot afford item at that cap
 * Returns true if the mission is safe to accept.
 */
function canAcceptMission(
  mission: Mission,
  installedMods: string[],
  credits: number,
  settings: MissionRunnerSettings,
): boolean {
  for (const obj of mission.objectives) {
    if (obj.complete) continue;

    if (obj.type === "kill") {
      const hasWeapon = installedMods.some(id => {
        const lower = id.toLowerCase();
        return lower.includes("cannon") || lower.includes("laser") ||
               lower.includes("weapon") || lower.includes("gun") ||
               lower.includes("torpedo") || lower.includes("missile") ||
               lower.includes("blaster") || lower.includes("railgun");
      });
      if (!hasWeapon) return false;
    }

    if ((obj.type === "buy" || obj.type === "deliver") && settings.maxBuyPrice > 0) {
      const estimatedCost = obj.quantity * settings.maxBuyPrice;
      if (estimatedCost > credits) return false;
    }
  }
  return true;
}

/** Apply settings filters and sort available missions by reward/effort score (desc). */
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
  return candidates.sort((a, b) => scoreMission(b) - scoreMission(a));
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
      // Never downgrade a locally-completed objective: only set true, never clear it.
      const apiDone = !!(ao.complete || ao.completed || ao.is_complete || ao.done || ao.finished);
      if (apiDone) objectives[i].complete = true;
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
      // Use item_id param to get full order book depth for this specific item
      const mktResp = await bot.exec("view_market", { item_id: item.itemId });
      if (!mktResp.error && mktResp.result) {
        const mkt = mktResp.result as Record<string, unknown>;
        const entries = (Array.isArray(mkt) ? mkt : (mkt.market as unknown[]) || (mkt.items as unknown[])) as Array<Record<string, unknown>>;
        const entry = (entries || []).find(e => (e.item_id as string) === item.itemId) || (entries?.[0] as Record<string, unknown> | undefined);
        if (entry) {
          const buyOrders = (entry.buy_orders as Array<Record<string, unknown>>) || [];
          if (buyOrders.length > 0) {
            price = Math.max(...buyOrders.map(o => (o.price as number) || 0));
          } else {
            // Compact summary fallback: best_sell = best price you can sell for
            price = (entry.best_sell as number) || (entry.buy_price as number) || price;
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

      // ── Helper: navigate to delivery destination and dock to trigger server-side delivery ──
      const deliverToDestination = async (): Promise<boolean> => {
        const destSystem = obj.targetSystem;
        const destPoi = obj.targetPoi;
        if (!destSystem && !destPoi) return false; // no delivery target known — can't deliver
        if (destSystem && bot.system !== destSystem) {
          await ensureUndocked(ctx);
          ctx.log("info", `Traveling to delivery destination: ${destSystem}`);
          await navigateToSystem(ctx, destSystem, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
          if (bot.system !== destSystem) return false; // navigation failed
        }
        if (destPoi && bot.poi !== destPoi) {
          await ensureUndocked(ctx);
          const tResp = await bot.exec("travel", { target_poi: destPoi });
          if (tResp.error) return false;
          await bot.refreshStatus();
        }
        await ensureDocked(ctx);
        await syncMissionProgress(ctx, missionId, objectives);
        if (obj.current >= obj.quantity) { obj.complete = true; }
        return true;
      };

      // ── Step 0: Already have items in cargo from a previous attempt → deliver immediately ──
      await bot.refreshCargo();
      const alreadyInCargo = bot.inventory.find(i => i.itemId === obj.target)?.quantity ?? 0;
      if (alreadyInCargo >= needed) {
        ctx.log("info", `Already have ${alreadyInCargo}x ${obj.targetName || obj.target} in cargo — delivering`);
        await deliverToDestination();
        return;
      }

      // ── Step 1: Try buying ──
      // Track stations that returned item_not_available so we don't retry them.
      if (!(obj as any)._buyFailedPois) (obj as any)._buyFailedPois = new Set<string>();
      const buyFailedPois = (obj as any)._buyFailedPois as Set<string>;

      if (settings.preferBuying && obj.type !== "mine" && !buyFailedPois.has(bot.poi ?? "")) {
        yield "try_buy";
        await ensureDocked(ctx);
        // Use item_id param to get full order book depth for this specific item
        const mktResp = await bot.exec("view_market", { item_id: obj.target });
        if (!mktResp.error && mktResp.result) {
          const mkt = mktResp.result as Record<string, unknown>;
          const entries = (Array.isArray(mkt) ? mkt : (mkt.market as unknown[]) || (mkt.items as unknown[])) as Array<Record<string, unknown>>;
          const entry = (entries || []).find(e => (e.item_id as string) === obj.target) || (entries?.[0] as Record<string, unknown> | undefined);
          if (entry) {
            // Only use actual sell orders — never fall back to best_buy (that's a buyer bid, not an ask price)
            const sellOrders = ((entry.sell_orders as Array<Record<string, unknown>>) || [])
              .filter(o => (o.quantity as number) > 0)
              .sort((a, b) => (a.price as number) - (b.price as number));
            const cheapestSell = sellOrders[0] ?? null;
            // Also accept a simple sell_price field when no order book is present
            const fallbackPrice = (entry.sell_price as number) > 0 ? (entry.sell_price as number) : 0;
            const unitPrice = cheapestSell ? (cheapestSell.price as number) : fallbackPrice;
            const unitQty   = cheapestSell ? (cheapestSell.quantity as number) : (entry.quantity as number) || obj.quantity;
            if (unitPrice > 0) {
              if (!settings.maxBuyPrice || unitPrice <= settings.maxBuyPrice) {
                const canBuy = Math.min(needed, unitQty || needed, Math.floor(bot.credits / unitPrice));
                if (canBuy > 0) {
                  const buyResp = await bot.exec("buy", { item_id: obj.target, quantity: canBuy, max_price: unitPrice });
                  if (!buyResp.error) {
                    ctx.log("info", `Bought ${canBuy}x ${obj.targetName || obj.target} @ ${unitPrice}cr`);
                    await bot.refreshCargo();
                    const nowInCargo = bot.inventory.find(i => i.itemId === obj.target)?.quantity ?? 0;
                    if (nowInCargo >= needed) {
                      await deliverToDestination();
                      return;
                    }
                  } else {
                    const errMsg = (buyResp.error?.message || "").toLowerCase();
                    if (errMsg.includes("item_not_available") || errMsg.includes("no one is selling") || errMsg.includes("not available")) {
                      ctx.log("info", `${obj.targetName || obj.target} not available at this station — blacklisting for this objective`);
                      buyFailedPois.add(bot.poi ?? "");
                    }
                  }
                }
              }
            } else {
              // Market exists but has no sell orders — blacklist this station
              ctx.log("info", `No sell orders for ${obj.targetName || obj.target} at this station`);
              buyFailedPois.add(bot.poi ?? "");
            }
          }
        }
      }

      // ── Step 2: Mine the resource ──
      if (settings.preferMining && !(obj as any)._skipMining) {
        yield "mine_resource";
        await ensureUndocked(ctx);

        // Navigate to the correct POI type for this resource
        const isGasRes  = /gas|hydrogen|helium|methane|noble/.test(obj.target);
        const isIceRes  = /ice|frost|cryo/.test(obj.target);
        const allowedPoiTypes = isGasRes
          ? ["gas_cloud"]
          : isIceRes
          ? ["ice_field"]
          : ["asteroid_belt", "asteroid_field", "mining"];

        const { pois } = await getSystemInfo(ctx);
        const miningPoi = pois.find(p => allowedPoiTypes.includes(p.type));
        if (!miningPoi) {
          ctx.log("warn", `No ${allowedPoiTypes[0]} POI in current system — cannot mine ${obj.target}`);
          return;
        }
        if (bot.poi !== miningPoi.id) {
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
          } else if (msg.includes("module") || msg.includes("harvester") || msg.includes("equipment") || msg.includes("collector")) {
            // Permanent equipment mismatch — mark obj so we never retry mining for it
            ctx.log("error", `Mine error (wrong equipment): ${mineResp.error.message}`);
            (obj as any)._skipMining = true;
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
              if (obj.current >= obj.quantity) {
                await deliverToDestination();
              }
            } else {
              ctx.log("info", `Mined ${qty}x ${r.resource_name || minedId} — wrong resource, need ${obj.target}`);
              // Wrong resource — this mine attempt is wasted. The outer loop's attempt counter
              // will escalate to abandonment after MAX_OBJ_ATTEMPTS.
            }
          }
        }
      } else {
        // No acquisition method configured — cannot complete this objective
        ctx.log("error", `Cannot acquire ${obj.target}: preferBuying=false and preferMining=false — abandoning mission`);
        return; // Exit generator; outer loop sees obj still incomplete → missionFailed via MAX_ATTEMPTS
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
        if (bot.system !== targetSys) return; // navigation didn't reach target — retry on next iteration
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

    // ── Craft ──
    case "craft": {
      yield "obj_craft";
      if (bot.docked) await syncMissionProgress(ctx, missionId, objectives);
      if (obj.complete || obj.current >= obj.quantity) { obj.complete = true; return; }

      const needed = obj.quantity - obj.current;
      await ensureDocked(ctx);

      // Step 1: load recipes from catalog cache (same source as crafter routine)
      yield "obj_craft_recipes";
      let catalogRecipes = Object.values(ctx.catalogStore.getAll().recipes);
      if (catalogRecipes.length === 0) {
        ctx.log("info", "Craft obj: catalog empty — fetching...");
        try {
          await ctx.catalogStore.fetchAll(ctx.api);
          catalogRecipes = Object.values(ctx.catalogStore.getAll().recipes);
        } catch (err) {
          ctx.log("warn", `Craft obj: catalog fetch failed — ${err}`);
          return;
        }
      }
      const allRecipes = parseMissionRecipes(catalogRecipes);
      if (allRecipes.length === 0) {
        ctx.log("warn", "Craft obj: no recipes in catalog");
        return;
      }

      // Step 2: find which recipe to use
      const targetId = (obj.target || "").toLowerCase();
      let mRecipe: MissionRecipe | null = null;
      if (targetId && targetId !== "any") {
        mRecipe = allRecipes.find(r =>
          r.output_item_id.toLowerCase() === targetId ||
          r.output_item_id.toLowerCase().includes(targetId) ||
          (obj.targetName ? r.output_name.toLowerCase().includes(obj.targetName.toLowerCase()) : false)
        ) ?? null;
        if (!mRecipe) {
          ctx.log("warn", `Craft obj: no recipe produces "${obj.targetName || obj.target}"`);
          return;
        }
      } else {
        // "Craft any N items" — prefer recipes where all materials are already available
        await bot.refreshStorage();
        const funded = allRecipes.filter(r =>
          r.components.every(c => countMissionItem(bot.inventory, bot.storage, c.item_id) >= c.quantity)
        );
        if (funded.length > 0) {
          mRecipe = funded.sort((a, b) => a.components.length - b.components.length)[0];
        } else if (settings.preferBuying) {
          mRecipe = [...allRecipes]
            .filter(r => r.components.length > 0)
            .sort((a, b) => a.components.length - b.components.length)[0] ?? null;
        }
        if (!mRecipe) {
          ctx.log("warn", "Craft obj: no craftable recipe (no stock and preferBuying=false)");
          return;
        }
      }

      // Step 3: check and acquire materials
      await bot.refreshStorage();
      const batchCount = Math.min(needed, 10);
      for (const comp of mRecipe.components) {
        const required = comp.quantity * batchCount;
        const have = countMissionItem(bot.inventory, bot.storage, comp.item_id);
        if (have < required) {
          if (settings.preferBuying) {
            const toBuy = required - have;
            yield "obj_craft_buy";
            const buyResp = await bot.exec("buy", { item_id: comp.item_id, quantity: toBuy });
            if (buyResp.error) {
              ctx.log("warn", `Craft obj: cannot buy ${comp.item_id} (need ${toBuy}) — ${buyResp.error.message}`);
              return;
            }
            ctx.log("info", `Craft obj: bought ${toBuy}x ${comp.item_id}`);
          } else {
            ctx.log("warn", `Craft obj: missing ${comp.item_id} (have ${have}, need ${required})`);
            return;
          }
        }
      }

      // Step 4: withdraw materials from station storage to cargo
      for (const comp of mRecipe.components) {
        const inCargo = countMissionCargo(bot.inventory, comp.item_id);
        const need4batch = comp.quantity * batchCount;
        if (inCargo < need4batch) {
          const inStorage = countMissionStorage(bot.storage, comp.item_id);
          const toWithdraw = Math.min(need4batch - inCargo, inStorage);
          if (toWithdraw > 0) {
            yield "obj_craft_withdraw";
            await bot.exec("withdraw_items", { item_id: comp.item_id, quantity: toWithdraw });
          }
        }
      }

      // Step 5: craft
      yield "obj_craft_execute";
      const craftResp = await bot.exec("craft", { recipe_id: mRecipe.recipe_id, count: batchCount });
      if (craftResp.error) {
        const emsg = craftResp.error.message.toLowerCase();
        if (emsg.includes("facility-only") || emsg.includes("cannot be crafted manually")) {
          ctx.log("warn", `Craft obj: "${mRecipe.recipe_id}" is facility-only — cannot craft manually`);
        } else {
          ctx.log("warn", `Craft obj: craft failed — ${craftResp.error.message}`);
        }
        return;
      }
      const craftResult = craftResp.result as Record<string, unknown> | undefined ?? {};
      const crafted = (craftResult?.count as number) || (craftResult?.quantity as number) || batchCount;
      obj.current += crafted;
      ctx.log("info", `Craft obj: ${obj.current}/${obj.quantity} done (crafted ${crafted}x ${mRecipe.output_name})`);
      if (obj.current >= obj.quantity) obj.complete = true;
      break;
    }

    // ── Kill ──
    case "kill": {
      yield "obj_kill";
      if (bot.docked) await syncMissionProgress(ctx, missionId, objectives);
      if (obj.complete || obj.current >= obj.quantity) { obj.complete = true; return; }

      const killTarget = obj.targetSystem || obj.targetPoi || obj.target;

      // Navigate to target system if specified
      if (obj.targetSystem && bot.system !== obj.targetSystem) {
        yield "obj_kill_navigate";
        await ensureUndocked(ctx);
        await navigateToSystem(ctx, obj.targetSystem, { fuelThresholdPct: settings.refuelThreshold, hullThresholdPct: 30 });
        await bot.refreshStatus();
        return;
      }

      // Travel to target POI if specified
      if (obj.targetPoi && bot.poi !== obj.targetPoi) {
        yield "obj_kill_travel";
        await ensureUndocked(ctx);
        const tResp = await bot.exec("travel", { target_poi: obj.targetPoi });
        if (!tResp.error) await bot.refreshStatus();
        return;
      }

      // Attempt combat
      yield "obj_kill_hunt";
      await ensureUndocked(ctx);
      const huntResp = await bot.exec("hunt", { target: obj.target || undefined });
      if (huntResp.error) {
        ctx.log("warn", `Kill obj: hunt failed — ${huntResp.error.message} (target: ${killTarget || "any"})`);
        return;
      }
      const hResult = huntResp.result as Record<string, unknown> | undefined ?? {};
      const killed = (hResult?.killed as number) || (hResult?.count as number) || 0;
      if (killed > 0) {
        obj.current += killed;
        ctx.log("info", `Kill obj: eliminated ${killed} — total ${obj.current}/${obj.quantity}`);
      } else {
        // Server may track kills independently — sync and check
        await syncMissionProgress(ctx, missionId, objectives);
      }
      if (obj.current >= obj.quantity) obj.complete = true;
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
  /** Session-level blacklist: IDs and titles of missions that failed unrecoverably this session. */
  const abandonedMissions = new Set<string>();

  while (bot.state === "running") {
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleepBot(ctx, 30000); continue; }

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

    // ── Manual mission override ──
    let manualMission: Mission | undefined;
    if (settings.manualMissionId) {
      const mid = settings.manualMissionId.trim().toLowerCase();
      manualMission = activeMissions.find(
        m => m.id === settings.manualMissionId || m.title.toLowerCase() === mid,
      );
      if (!manualMission) {
        // Try to find and accept it from the board
        yield "get_manual_mission";
        const boardResp2 = await bot.exec("get_missions");
        if (!boardResp2.error && boardResp2.result) {
          const avail2 = parseAvailableMissions(boardResp2.result);
          const onBoard = avail2.find(m => m.id === settings.manualMissionId || m.title.toLowerCase() === mid);
          if (onBoard) {
            if (activeMissions.length < MAX_ACTIVE_MISSIONS) {
              yield "accept_manual_mission";
              const ar = await bot.exec("accept_mission", { mission_id: onBoard.id });
              if (!ar.error) {
                const arResult = ar.result as Record<string, unknown> | null;
                const arId = (arResult?.mission_id as string) || (arResult?.id as string);
                if (arId) onBoard.id = arId;
                ctx.log("info", `Manual mission accepted: "${onBoard.title}"`);
                activeMissions.push(onBoard);
                manualMission = onBoard;
              } else {
                ctx.log("warn", `Could not accept manual mission "${settings.manualMissionId}": ${ar.error.message}`);
              }
            } else {
              // Displace the lowest-scoring active mission to make room for the manual target
              const toDisplace = [...activeMissions].sort((a, b) => scoreMission(a) - scoreMission(b))[0];
              ctx.log("info", `Slots full — displacing "${toDisplace.title}" to make room for manual mission "${onBoard.title}"`);
              const dispResp = await bot.exec("abandon_mission", { mission_id: toDisplace.id });
              if (!dispResp.error) {
                activeMissions = activeMissions.filter(m => m.id !== toDisplace.id);
                yield "accept_manual_mission";
                const ar2 = await bot.exec("accept_mission", { mission_id: onBoard.id });
                if (!ar2.error) {
                  const ar2Result = ar2.result as Record<string, unknown> | null;
                  const ar2Id = (ar2Result?.mission_id as string) || (ar2Result?.id as string);
                  if (ar2Id) onBoard.id = ar2Id;
                  ctx.log("info", `Manual mission accepted after displacing: "${onBoard.title}"`);
                  activeMissions.push(onBoard);
                  manualMission = onBoard;
                } else {
                  ctx.log("warn", `Could not accept manual mission after displacing: ${ar2.error.message}`);
                }
              }
            }
          } else {
            ctx.log("info", `Manual mission "${settings.manualMissionId}" not found on board — auto mode`);
          }
        }
      }
      if (manualMission) {
        ctx.log("info", `Manual override: focusing on "${manualMission.title}"`);
      }
    }

    // ── Accept a new mission only if slots are free (auto mode, skipped when manual found) ──
    if (!manualMission && activeMissions.length < MAX_ACTIVE_MISSIONS) {
      yield "get_missions";
      const boardResp = await bot.exec("get_missions");
      if (boardResp.error) {
        ctx.log("warn", `Cannot get mission board: ${boardResp.error.message}`);
      } else {
        const availableMissions = parseAvailableMissions(boardResp.result);
        ctx.log("info", `Available on board: ${availableMissions.length}`);
        const candidates = filterMissions(availableMissions, settings)
          .filter(m => !abandonedMissions.has(m.id) && !abandonedMissions.has(m.title));
        const feasible = candidates.filter(m =>
          canAcceptMission(m, bot.installedMods, bot.credits, settings)
        );
        if (feasible.length > 0) {
          const toAccept = feasible[0];
          ctx.log("info", `Best: "${toAccept.title}" (${toAccept.type}, diff: ${toAccept.difficulty || "?"}, +${toAccept.reward_credits}cr)`);
          yield "accept_mission";
          const acceptResp = await bot.exec("accept_mission", { mission_id: toAccept.id });
          if (!acceptResp.error) {
            // Capture the instance mission_id (differs from board template id)
            const acceptedResult = acceptResp.result as Record<string, unknown> | null;
            const instanceId = (acceptedResult?.mission_id as string) || (acceptedResult?.id as string);
            if (instanceId) toAccept.id = instanceId;
            ctx.log("info", `Accepted: "${toAccept.title}"`);
            await bot.refreshStatus();
            activeMissions.push(toAccept);
          } else {
            ctx.log("warn", `Accept failed: ${acceptResp.error.message}`);
          }
        } else if (candidates.length > 0) {
          ctx.log("info", `${candidates.length} mission(s) filtered — none feasible (missing weapons or insufficient credits)`);
        } else if (availableMissions.length > 0) {
          ctx.log("info", `${availableMissions.length} mission(s) on board but none match filters`);
        } else {
          ctx.log("info", "No missions on board at this station");
        }
      }
    } else if (!manualMission) {
      ctx.log("info", `Mission slots full (${activeMissions.length}/${MAX_ACTIVE_MISSIONS}) — completing existing missions`);
    }

    // ── Nothing active to work on ──
    if (activeMissions.length === 0) {
      ctx.log("info", "No active missions — waiting...");
      await sleep(settings.cycleDelayMs);
      continue;
    }

    // ── Pick the best active mission to work on now ──
    // manualMission takes priority; otherwise auto-pick by score
    const mission = manualMission ?? pickBestActiveMission(activeMissions);
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
    const MAX_OBJ_ATTEMPTS = 8; // per-objective attempt limit
    const objAttempts = new Map<number, number>(); // objective index → attempt count

    while (bot.state === "running") {
      if (bot.docked) await syncMissionProgress(ctx, mission.id, objectives);

      const incomplete = objectives.filter(o => !o.complete);
      if (incomplete.length === 0) {
        ctx.log("info", "All objectives complete!");
        break;
      }

      const obj = incomplete[0];
      const objIdx = objectives.indexOf(obj);
      const prevAttempts = objAttempts.get(objIdx) ?? 0;
      if (prevAttempts >= MAX_OBJ_ATTEMPTS) {
        ctx.log("error", `Objective [${obj.type}] exceeded ${MAX_OBJ_ATTEMPTS} attempts — abandoning "${mission.title}"`);
        missionFailed = true;
        break;
      }
      objAttempts.set(objIdx, prevAttempts + 1);
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
      if (missionFailed) {
        abandonedMissions.add(mission.id);
        abandonedMissions.add(mission.title);
      }
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
      let completeResp = await bot.exec("complete_mission", { mission_id: mission.id });
      if (completeResp.error) {
        // Retry once after a short delay (transient dock/server error)
        await sleep(3000);
        completeResp = await bot.exec("complete_mission", { mission_id: mission.id });
      }
      if (completeResp.error) {
        ctx.log("warn", `Complete failed after retry: ${completeResp.error.message} — abandoning`);
        abandonedMissions.add(mission.id);
        abandonedMissions.add(mission.title);
        const abResp = await bot.exec("abandon_mission", { mission_id: mission.id });
        if (abResp.error) ctx.log("warn", `Abandon also failed: ${abResp.error.message}`);
        sessFailed++;
      } else {
        sessCompleted++;
        bot.stats.totalMissions = (bot.stats.totalMissions ?? 0) + 1;
        bot.stats.totalMissionRewards = (bot.stats.totalMissionRewards ?? 0) + mission.reward_credits;
        bot.stats.totalEarned = (bot.stats.totalEarned ?? 0) + mission.reward_credits;
        ctx.log("info", `✓ Done: "${mission.title}" (+${mission.reward_credits}cr) — session: ${sessCompleted} done, ${sessFailed} failed`);
        logAgentEvent(ctx, "missions", "info",
          `Mission complete: "${mission.title}" (+${mission.reward_credits}cr)`,
          { reward: mission.reward_credits, session_completed: sessCompleted },
        );
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
