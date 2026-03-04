/**
 * SmartSelector routine — rule-based routine orchestrator (no LLM required).
 *
 * Algorithm per cycle:
 *   1. Safety override — hull < 30% → return_home immediately.
 *   2. Fuel check — fuel < 15% → refuel in place (tryRefuel), then re-evaluate.
 *   3. Score available routines using skills, status, missions, and market data.
 *   4. Delegate to the winning routine as an inline sub-generator.
 *   5. After sub-routine completes (or yields termination), re-evaluate from step 1.
 *
 * Scoring weights:
 *   mission_runner  — reward / (objective_count + jumps * 800); bonus for active missions
 *   trader          — trading_level × 15; +20 if analyze_market finds margin > 500 cr
 *   gas/ice harvest — harvesting_level × 12 if matching POI in current system
 *   miner           — mining_level × 10 + 20 base (always-available fallback)
 *   explorer        — 18 if < 3 mapped systems, else 6
 *
 * Settings (under "smart_selector" in data/settings.json):
 *   minMissionReward     — ignore missions below this credit reward (default: 500)
 *   minTradeMargin       — minimum cr margin to prefer trader over miner (default: 300)
 *   enableHunter         — allow hunter routine when faction war is active (default: false)
 *   forcedRoutine        — bypass scoring and always run this routine key (default: "")
 */

import type { Routine, RoutineContext } from "../bot.js";
import { minerRoutineV2 } from "./miner-v2.js";
import { traderRoutine } from "./trader.js";
import { missionRunnerRoutine } from "./mission_runner.js";
import { explorerRoutine } from "./explorer.js";
import { gasHarvesterRoutine } from "./gas_harvester.js";
import { iceHarvesterRoutine } from "./ice_harvester.js";
import { returnHomeRoutine } from "./return_home.js";
import { hunterRoutine } from "./hunter.js";
import { crafterRoutine, scoreCrafter } from "./crafter.js";
import {
  readSettings,
  ensureDocked,
  tryRefuel,
  sleep,
  isOreBeltPoi,
} from "./common.js";

// ── Types ─────────────────────────────────────────────────────

interface SmartSelectorSettings {
  minMissionReward: number;
  minTradeMargin: number;
  enableHunter: boolean;
  forcedRoutine: string;
  minCrafterProfitPct: number;
}

interface RoutineCandidate {
  key: string;
  name: string;
  fn: Routine;
  score: number;
}

// ── Settings ─────────────────────────────────────────────────

function getSettings(username: string): SmartSelectorSettings {
  const all = readSettings();
  const s = (all.smart_selector || {}) as Record<string, unknown>;
  const perBot = ((s.bots || {}) as Record<string, Record<string, unknown>>)[username] || {};
  return {
    minMissionReward:    (perBot.minMissionReward    as number)  ?? (s.minMissionReward    as number)  ?? 500,
    minTradeMargin:      (perBot.minTradeMargin      as number)  ?? (s.minTradeMargin      as number)  ?? 300,
    enableHunter:        (perBot.enableHunter        as boolean) ?? (s.enableHunter        as boolean) ?? false,
    forcedRoutine:       (perBot.forcedRoutine       as string)  ?? (s.forcedRoutine       as string)  ?? "",
    minCrafterProfitPct: (perBot.minCrafterProfitPct as number)  ?? (s.minCrafterProfitPct as number)  ?? 10,
  };
}

// ── Skill helpers ─────────────────────────────────────────────

function skillLevel(ctx: RoutineContext, ...ids: string[]): number {
  const skills = ctx.bot.skills;
  for (const id of ids) {
    const found = skills.find(s => s.skill_id === id);
    if (found) return found.level;
  }
  return 0;
}

// ── System POI helpers ────────────────────────────────────────

/**
 * Score the miner based on ore belt availability:
 * - Current system has a belt  → full score (miningLevel * 10 + 20)
 * - Another known system has a belt → reduced score (miningLevel * 6) — miner will navigate
 * - No belt anywhere in the map → near-zero (1) — should not win selection
 */
function scoreMiner(ctx: RoutineContext, miningLevel: number): number {
  const sys = ctx.mapStore.getSystem(ctx.bot.system);

  // Check current system first
  if (sys?.pois.some(p => isOreBeltPoi(p.type))) {
    return miningLevel * 10 + 20;
  }

  // Check entire known map for any ore belt
  const allSystems = ctx.mapStore.getAllSystems ? ctx.mapStore.getAllSystems() : {};
  const anyBeltKnown = Object.values(allSystems).some(s =>
    s.pois.some(p => isOreBeltPoi(p.type))
  );

  if (anyBeltKnown) {
    // Miner will travel to another system — give it a lower score
    return miningLevel * 6;
  }

  // No ore belt mapped at all — miner cannot do anything useful
  return 1;
}

function currentSystemHasPoi(ctx: RoutineContext, keyword: string): boolean {
  const sys = ctx.mapStore.getSystem(ctx.bot.system);
  if (!sys) return false;
  return sys.pois.some(p => {
    const name = p.name.toLowerCase();
    const type = p.type.toLowerCase();
    return name.includes(keyword) || type.includes(keyword);
  });
}

// ── Mission scoring ───────────────────────────────────────────

async function scoreMissions(
  ctx: RoutineContext,
  minReward: number,
): Promise<number> {
  const { bot } = ctx;

  const resp = await bot.exec("get_missions");
  if (resp.error || !resp.result) return 0;

  const r = resp.result as Record<string, unknown>;
  const missions = (
    Array.isArray(r) ? r :
    Array.isArray(r.missions) ? r.missions :
    Array.isArray(r.available) ? r.available :
    []
  ) as Array<Record<string, unknown>>;

  if (missions.length === 0) return 0;

  // Check for active (accepted) missions first — always worth completing
  const active = missions.filter(
    m => m.status === "active" || m.status === "accepted" || m.accepted === true
  );
  if (active.length > 0) return 80;

  // Score available missions
  let best = 0;
  for (const m of missions) {
    const reward = Number(m.reward_credits ?? m.reward ?? m.credits ?? 0);
    if (reward < minReward) continue;
    const objs = Array.isArray(m.objectives) ? m.objectives.length : 1;
    const jumps = Number(m.jumps_required ?? m.distance ?? 0);
    const score = reward / (objs + jumps * 800);
    if (score > best) best = score;
  }

  // Normalise to a 0–70 range (score 70 = very good mission, 0 = nothing worth doing)
  return Math.min(70, best / 10);
}

// ── Trade scoring ─────────────────────────────────────────────

async function scoreTrading(
  ctx: RoutineContext,
  tradingLevel: number,
  minMargin: number,
): Promise<number> {
  const { bot } = ctx;
  if (!bot.docked) return tradingLevel * 10;

  const resp = await bot.exec("analyze_market", { mode: "overview" });
  if (resp.error || !resp.result) return tradingLevel * 10;

  const r = resp.result as Record<string, unknown>;
  const insights = r.top_insights as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(insights) || insights.length === 0) return tradingLevel * 10;

  // Extract best margin from insights
  let bestMargin = 0;
  for (const insight of insights) {
    const margin = Number(insight.margin ?? insight.profit ?? insight.value ?? 0);
    if (margin > bestMargin) bestMargin = margin;
  }

  const marginBonus = bestMargin >= minMargin ? 20 : 0;
  return tradingLevel * 15 + marginBonus;
}

// ── Candidate builder ─────────────────────────────────────────

async function buildCandidates(
  ctx: RoutineContext,
  settings: SmartSelectorSettings,
): Promise<RoutineCandidate[]> {
  const { bot } = ctx;

  const miningLevel     = skillLevel(ctx, "mining",     "ore_mining",  "asteroid_mining");
  const tradingLevel    = skillLevel(ctx, "trading",    "trade",       "market_trading");
  const harvestLevel    = skillLevel(ctx, "harvesting", "gas_harvest", "ice_harvest");
  const explorationLevel= skillLevel(ctx, "exploration","surveying",   "scouting");

  const isTradeRestricted =
    bot.tradingRestrictedUntil !== null && bot.tradingRestrictedUntil > new Date();

  if (isTradeRestricted) {
    const minutesLeft = Math.ceil(
      (bot.tradingRestrictedUntil!.getTime() - Date.now()) / 60_000
    );
    ctx.log("warn", `SmartSelector: trading restricted for ~${minutesLeft} more minute(s) — skipping trader`);
  }

  const [missionScore, tradeScore] = await Promise.all([
    scoreMissions(ctx, settings.minMissionReward),
    isTradeRestricted
      ? Promise.resolve(0)
      : tradingLevel >= 3 && bot.docked
        ? scoreTrading(ctx, tradingLevel, settings.minTradeMargin)
        : Promise.resolve(tradingLevel * 10),
  ]);

  const hasGasPoi = currentSystemHasPoi(ctx, "gas");
  const hasIcePoi = currentSystemHasPoi(ctx, "ice") || currentSystemHasPoi(ctx, "asteroid belt");

  const candidates: RoutineCandidate[] = [
    {
      key: "mission_runner",
      name: "MissionRunner",
      fn: missionRunnerRoutine,
      score: missionScore,
    },
    {
      key: "trader",
      name: "Trader",
      fn: traderRoutine,
      score: tradeScore,
    },
    {
      key: "gas_harvester",
      name: "GasHarvester",
      fn: gasHarvesterRoutine,
      score: hasGasPoi ? harvestLevel * 12 + 5 : 0,
    },
    {
      key: "ice_harvester",
      name: "IceHarvester",
      fn: iceHarvesterRoutine,
      score: hasIcePoi ? harvestLevel * 11 + 4 : 0,
    },
    {
      key: "explorer",
      name: "Explorer",
      fn: explorerRoutine,
      score: explorationLevel * 5 + (ctx.mapStore.getAllSystems
        ? Math.min(18, Object.keys(ctx.mapStore.getAllSystems()).length < 3 ? 18 : 6)
        : 6),
    },
    {
      key: "miner",
      name: "Miner",
      fn: minerRoutineV2,
      score: scoreMiner(ctx, miningLevel),
    },
  ];

  // Crafter — dynamic score based on profitable craftable recipes in catalog cache
  const craftingLevel = skillLevel(ctx, "crafting", "crafting_basic", "manufacturing");
  if (craftingLevel > 0) {
    candidates.push({
      key: "crafter",
      name: "Crafter",
      fn: crafterRoutine,
      score: scoreCrafter(ctx, settings.minCrafterProfitPct),
    });
  }

  if (settings.enableHunter) {
    const combatLevel = skillLevel(ctx, "combat", "fighting", "battle");
    candidates.push({
      key: "hunter",
      name: "Hunter",
      fn: hunterRoutine,
      score: combatLevel * 14,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// ── Route map for forced-routine lookup ───────────────────────

const FORCED_ROUTINES: Record<string, Routine> = {
  miner:          minerRoutineV2,
  trader:         traderRoutine,
  mission_runner: missionRunnerRoutine,
  explorer:       explorerRoutine,
  gas_harvester:  gasHarvesterRoutine,
  ice_harvester:  iceHarvesterRoutine,
  return_home:    returnHomeRoutine,
  hunter:         hunterRoutine,
};

// ── Main routine ──────────────────────────────────────────────

export const smartSelectorRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  ctx.log("system", "SmartSelector: starting rule-based routine orchestrator");
  yield "init";

  while (bot.state === "running") {
    await bot.refreshStatus();

    const settings = getSettings(bot.username);

    // ── Forced routine override ──────────────────────────────
    if (settings.forcedRoutine && FORCED_ROUTINES[settings.forcedRoutine]) {
      ctx.log("system", `SmartSelector: forced routine = ${settings.forcedRoutine}`);
      yield `forced:${settings.forcedRoutine}`;
      yield* FORCED_ROUTINES[settings.forcedRoutine](ctx);
      await sleep(5_000);
      continue;
    }

    // ── Safety: hull critical → return home ─────────────────
    const hullPct = bot.maxHull > 0 ? (bot.hull / bot.maxHull) * 100 : 100;
    if (hullPct < 30) {
      ctx.log("system", `SmartSelector: hull critical (${Math.round(hullPct)}%) — returning home`);
      yield "safety:return_home";
      yield* returnHomeRoutine(ctx);
      await sleep(10_000);
      continue;
    }

    // ── Safety: fuel critical → refuel in place ──────────────
    const fuelPct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : 100;
    if (fuelPct < 15) {
      ctx.log("system", `SmartSelector: fuel critical (${Math.round(fuelPct)}%) — refueling`);
      yield "safety:refuel";
      await ensureDocked(ctx);
      await tryRefuel(ctx);
      await sleep(5_000);
      continue;
    }

    // ── Cargo-full escape hatch ───────────────────────────────
    // If cargo is near-full, try to flush before scoring so the miner can work.
    // Only loops back if flush actually freed space; otherwise falls through to
    // routine scoring (return_home / trader can handle stuck cargo better).
    const cargoRatio = bot.cargoMax > 0 ? bot.cargo / bot.cargoMax : 0;
    if (cargoRatio >= 0.85) {
      ctx.log("system", `SmartSelector: cargo full (${Math.round(cargoRatio * 100)}%) — flushing before next cycle`);
      yield "flush_cargo";
      const docked = await ensureDocked(ctx);
      if (docked) {
        await bot.refreshCargo();
        for (const item of [...bot.inventory]) {
          if (item.quantity <= 0) continue;
          const sellResp = await bot.exec("sell", { item_id: item.itemId, quantity: item.quantity });
          if (sellResp.error) {
            const facResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
            if (facResp.error) {
              await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
            }
          }
        }
        await bot.refreshStatus();
        ctx.log("system", `SmartSelector: cargo after flush — ${bot.cargo}/${bot.cargoMax}`);
      }
      const newRatio = bot.cargoMax > 0 ? bot.cargo / bot.cargoMax : 0;
      if (newRatio < 0.85) {
        // Cargo freed — re-evaluate from scratch
        await sleep(3_000);
        continue;
      }
      // Flush had no effect — fall through to scoring so a routine can handle it
      ctx.log("system", "SmartSelector: cargo flush ineffective — proceeding to scoring");
    }

    // ── Score and select ─────────────────────────────────────
    yield "evaluating";
    const candidates = await buildCandidates(ctx, settings);
    const winner = candidates[0];

    if (!winner || winner.score <= 0) {
      ctx.log("system", "SmartSelector: no viable routine found — defaulting to miner");
      yield "running:miner";
      yield* minerRoutineV2(ctx);
      await sleep(5_000);
      continue;
    }

    ctx.log(
      "system",
      `SmartSelector: selected ${winner.name} (score ${winner.score.toFixed(1)}) ` +
      `| candidates: ${candidates.slice(0, 3).map(c => `${c.key}=${c.score.toFixed(0)}`).join(", ")}`
    );

    yield `running:${winner.key}`;
    yield* winner.fn(ctx);

    ctx.log("system", `SmartSelector: ${winner.name} completed — re-evaluating in 5s`);
    await sleep(5_000);
  }
};
