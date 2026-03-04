/**
 * CombatSelector routine — rule-based orchestrator for combat-focused bots.
 *
 * Prioritises combat activities: hunting pirate NPCs for bounties, combat
 * missions, scouting new systems, and salvaging wrecks.
 * Economy routines (mining/trading) are intentionally excluded.
 *
 * Algorithm per cycle:
 *   1. Safety: hull < 35%  → return home for repairs
 *   2. Safety: fuel < 15%  → refuel in place
 *   3. Score candidates and delegate to winner; re-evaluate after each run.
 *
 * Scoring:
 *   hunter        — combatLevel × 12 + 20 (hull ≥ minHull, fuel ≥ minFuel)
 *                   combatLevel × 7        (hull 40–minHull, still flyable)
 *                   0                      (hull < 40 or fuel < minFuel)
 *   mission_runner— combatLevel × 5 + mission-reward score (0–65)
 *                   +75 flat if active missions found
 *   scout         — explorationLevel × 8 + discovery bonus
 *   explorer      — explorationLevel × 5 + 4
 *   salvager      — salvageLevel × 8 + 12
 *   scavenger     — salvageLevel × 6 + 8
 *
 * Settings (under "combat_selector" in data/settings.json):
 *   minHullForHunting — hull% required before hunter is allowed (default: 60)
 *   minFuelForHunting — fuel% required before hunter is allowed (default: 30)
 *   enablePvP         — allow hunter to attack players (default: false)
 *   patrolSystem      — fixed system to patrol (default: "")
 *   forcedRoutine     — bypass scoring and always run this key (default: "")
 *   enableSalvager    — include salvager/scavenger as candidates (default: true)
 *   minMissionReward  — ignore missions below this reward (default: 300)
 */

import type { Routine, RoutineContext } from "../bot.js";
import { hunterRoutine } from "./hunter.js";
import { missionRunnerRoutine } from "./mission_runner.js";
import { explorerRoutine } from "./explorer.js";
import { scoutRoutine } from "./scout.js";
import { salvagerRoutine } from "./salvager.js";
import { scavengerRoutine } from "./scavenger.js";
import { returnHomeRoutine } from "./return_home.js";
import {
  readSettings,
  ensureDocked,
  tryRefuel,
  sleep,
} from "./common.js";

// ── Types ─────────────────────────────────────────────────────

interface CombatSelectorSettings {
  minHullForHunting: number;
  minFuelForHunting: number;
  enablePvP: boolean;
  patrolSystem: string;
  forcedRoutine: string;
  enableSalvager: boolean;
  minMissionReward: number;
}

interface RoutineCandidate {
  key: string;
  name: string;
  fn: Routine;
  score: number;
}

// ── Settings ─────────────────────────────────────────────────

function getSettings(username: string): CombatSelectorSettings {
  const all = readSettings();
  const s = (all.combat_selector || {}) as Record<string, unknown>;
  const perBot = ((s.bots || {}) as Record<string, Record<string, unknown>>)[username] || {};
  return {
    minHullForHunting: (perBot.minHullForHunting as number)  ?? (s.minHullForHunting as number)  ?? 60,
    minFuelForHunting: (perBot.minFuelForHunting as number)  ?? (s.minFuelForHunting as number)  ?? 30,
    enablePvP:         (perBot.enablePvP         as boolean) ?? (s.enablePvP         as boolean) ?? false,
    patrolSystem:      (perBot.patrolSystem       as string)  ?? (s.patrolSystem       as string)  ?? "",
    forcedRoutine:     (perBot.forcedRoutine      as string)  ?? (s.forcedRoutine      as string)  ?? "",
    enableSalvager:    (perBot.enableSalvager     as boolean) ?? (s.enableSalvager     as boolean) ?? true,
    minMissionReward:  (perBot.minMissionReward   as number)  ?? (s.minMissionReward   as number)  ?? 300,
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

// ── Hunter scoring ────────────────────────────────────────────

function scoreHunter(
  ctx: RoutineContext,
  combatLevel: number,
  minHullPct: number,
  minFuelPct: number,
): number {
  const { bot } = ctx;
  const hullPct = bot.maxHull > 0 ? (bot.hull / bot.maxHull) * 100 : 100;
  const fuelPct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : 100;

  if (fuelPct < minFuelPct) return 0;

  if (hullPct >= minHullPct) {
    return combatLevel * 12 + 20;
  }
  if (hullPct >= 40) {
    return combatLevel * 7; // weakened but able to fight
  }
  return 0; // hull too low — must repair
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

  // Active missions — always worth completing
  const active = missions.filter(
    m => m.status === "active" || m.status === "accepted" || m.accepted === true
  );
  if (active.length > 0) return 75;

  // Score available missions by reward / complexity
  let best = 0;
  for (const m of missions) {
    const reward = Number(m.reward_credits ?? m.reward ?? m.credits ?? 0);
    if (reward < minReward) continue;
    const objs = Array.isArray(m.objectives) ? m.objectives.length : 1;
    const jumps = Number(m.jumps_required ?? m.distance ?? 0);
    const score = reward / (objs + jumps * 800);
    if (score > best) best = score;
  }

  return Math.min(65, best / 10);
}

// ── Scout scoring ─────────────────────────────────────────────

function scoreScout(ctx: RoutineContext, explorationLevel: number): number {
  const allSystems = ctx.mapStore.getAllSystems ? ctx.mapStore.getAllSystems() : {};
  const mappedCount = Object.keys(allSystems).length;
  // More bonus when galaxy is barely mapped — scouts are crucial early on
  const discoveryBonus = mappedCount < 10 ? 15 : mappedCount < 30 ? 8 : 2;
  return explorationLevel * 8 + discoveryBonus;
}

// ── Candidate builder ─────────────────────────────────────────

async function buildCandidates(
  ctx: RoutineContext,
  settings: CombatSelectorSettings,
): Promise<RoutineCandidate[]> {
  const combatLevel      = skillLevel(ctx, "combat",      "fighting",  "battle", "piracy");
  const explorationLevel = skillLevel(ctx, "exploration", "surveying", "scouting");
  const salvageLevel     = skillLevel(ctx, "salvaging",   "salvage",   "scavenging");

  const missionScore = await scoreMissions(ctx, settings.minMissionReward);

  const candidates: RoutineCandidate[] = [
    {
      key:   "hunter",
      name:  "Hunter",
      fn:    hunterRoutine,
      score: scoreHunter(ctx, combatLevel, settings.minHullForHunting, settings.minFuelForHunting),
    },
    {
      key:   "mission_runner",
      name:  "MissionRunner",
      fn:    missionRunnerRoutine,
      score: missionScore + combatLevel * 5,
    },
    {
      key:   "scout",
      name:  "Scout",
      fn:    scoutRoutine,
      score: scoreScout(ctx, explorationLevel),
    },
    {
      key:   "explorer",
      name:  "Explorer",
      fn:    explorerRoutine,
      score: explorationLevel * 5 + 4,
    },
  ];

  if (settings.enableSalvager) {
    candidates.push({
      key:   "salvager",
      name:  "Salvager",
      fn:    salvagerRoutine,
      score: salvageLevel * 8 + 12,
    });
    candidates.push({
      key:   "scavenger",
      name:  "Scavenger",
      fn:    scavengerRoutine,
      score: salvageLevel * 6 + 8,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// ── Forced-routine map ────────────────────────────────────────

const FORCED_ROUTINES: Record<string, Routine> = {
  hunter:         hunterRoutine,
  mission_runner: missionRunnerRoutine,
  scout:          scoutRoutine,
  explorer:       explorerRoutine,
  salvager:       salvagerRoutine,
  scavenger:      scavengerRoutine,
  return_home:    returnHomeRoutine,
};

// ── Main routine ──────────────────────────────────────────────

export const combatSelectorRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  ctx.log("system", "CombatSelector: starting combat-focused routine orchestrator");
  yield "init";

  while (bot.state === "running") {
    await bot.refreshStatus();

    const settings = getSettings(bot.username);

    // ── Forced routine override ──────────────────────────────
    if (settings.forcedRoutine && FORCED_ROUTINES[settings.forcedRoutine]) {
      ctx.log("system", `CombatSelector: forced routine = ${settings.forcedRoutine}`);
      yield `forced:${settings.forcedRoutine}`;
      yield* FORCED_ROUTINES[settings.forcedRoutine](ctx);
      await sleep(5_000);
      continue;
    }

    // ── Safety: hull critical → return home for repairs ──────
    const hullPct = bot.maxHull > 0 ? (bot.hull / bot.maxHull) * 100 : 100;
    if (hullPct < 35) {
      ctx.log("system", `CombatSelector: hull critical (${Math.round(hullPct)}%) — returning home for repairs`);
      yield "safety:return_home";
      yield* returnHomeRoutine(ctx);
      await sleep(10_000);
      continue;
    }

    // ── Safety: fuel critical → refuel in place ──────────────
    const fuelPct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : 100;
    if (fuelPct < 15) {
      ctx.log("system", `CombatSelector: fuel critical (${Math.round(fuelPct)}%) — refueling`);
      yield "safety:refuel";
      await ensureDocked(ctx);
      await tryRefuel(ctx);
      await sleep(5_000);
      continue;
    }

    // ── Score and select ─────────────────────────────────────
    yield "evaluating";
    const candidates = await buildCandidates(ctx, settings);
    const winner = candidates[0];

    if (!winner || winner.score <= 0) {
      ctx.log("system", "CombatSelector: no viable routine — defaulting to scout");
      yield "running:scout";
      yield* scoutRoutine(ctx);
      await sleep(5_000);
      continue;
    }

    ctx.log(
      "system",
      `CombatSelector: selected ${winner.name} (score ${winner.score.toFixed(1)}) ` +
      `| candidates: ${candidates.slice(0, 4).map(c => `${c.key}=${c.score.toFixed(0)}`).join(", ")}`,
    );

    yield `running:${winner.key}`;
    yield* winner.fn(ctx);

    ctx.log("system", `CombatSelector: ${winner.name} completed — re-evaluating in 5s`);
    await sleep(5_000);
  }
};
