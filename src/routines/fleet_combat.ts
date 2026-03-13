import type { Routine, RoutineContext } from "../bot.js";
import { combatSelectorRoutine } from "./combat_selector.js";
import {
  writeFleetSignal,
  getFleetAssignment,
  readFleetSettings,
  getPendingFleetOrder,
  clearFleetOrder,
  navigateToSystem,
  ensureDocked,
  ensureUndocked,
} from "./common.js";

const SIGNAL_INTERVAL_MS = 60_000;
const SCOUT_MAX_AGE_MS   = 5 * 60_000; // only follow fresh scout signals

/**
 * Fleet Combat — wraps CombatSelector with fleet coordination:
 *  - Follows the scout's last-known system (same group) before engaging
 *  - Checks for manual orders (dock / goto / return_home) between iterations
 *  - Emits fuel + position signals every 60s
 */
export const fleetCombatRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  const assignment = getFleetAssignment(bot.username);
  if (!assignment) {
    ctx.log("warn", "⚔️ No fleet assignment. Running solo combat.");
  } else {
    ctx.log("info", `⚔️ Fleet Combat — group ${assignment.groupId}`);
  }

  let lastSignalMs = 0;
  let orderBreak = false;

  // Timer to flag when to check for orders / signals between inner yields
  const orderTimer = setInterval(() => { orderBreak = true; }, 30_000);

  try {
    while (bot.state === "running") {
      // ── Manual order check ────────────────────────────────────
      const order = getPendingFleetOrder(bot.username);
      if (order) {
        ctx.log("info", `⚔️ Fleet order: ${order.cmd}`);
        clearFleetOrder(bot.username);
        if (order.cmd === "dock") {
          yield "order_dock";
          await ensureDocked(ctx);
        } else if (order.cmd === "return_home") {
          const { groups, signals, assignments: asgns } = readFleetSettings();
          const group = assignment ? groups.find(g => g.id === assignment.groupId) : null;
          yield "order_return_home";
          // Prefer refueler's station, fall back to group depositPoi system or current system
          const refuelerName = assignment
            ? Object.entries(asgns).find(([, a]) => a.groupId === assignment.groupId && a.role === "refueler")?.[0]
            : undefined;
          const homeSystem = (refuelerName && signals[refuelerName]?.systemId)
            ? signals[refuelerName].systemId!
            : (group?.depositPoi ? bot.system : bot.system);
          await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: 20, hullThresholdPct: 20 });
          await ensureDocked(ctx);
        } else if (order.cmd === "goto" && order.targetSystem) {
          yield "order_goto";
          await navigateToSystem(ctx, order.targetSystem, { fuelThresholdPct: 20, hullThresholdPct: 20 });
        }
        orderBreak = false;
        continue;
      }

      // ── Follow scout to scouted system ───────────────────────
      if (assignment) {
        const { signals, assignments } = readFleetSettings();
        const now = Date.now();
        const scoutEntry = Object.entries(assignments).find(
          ([u, a]) => a.groupId === assignment.groupId && a.role === "scout" &&
                      signals[u] && (now - (signals[u].lastUpdated ?? 0)) < SCOUT_MAX_AGE_MS
        );
        if (scoutEntry) {
          const scoutSig = signals[scoutEntry[0]];
          if (scoutSig.systemId && scoutSig.systemId !== bot.system) {
            ctx.log("info", `⚔️ Following scout ${scoutEntry[0]} to ${scoutSig.systemId}`);
            yield "follow_scout";
            if (bot.docked) {
              await ensureUndocked(ctx);
            }
            await navigateToSystem(ctx, scoutSig.systemId, { fuelThresholdPct: 20, hullThresholdPct: 20 });
          }
        }
      }

      // ── Emit signal ──────────────────────────────────────────
      const now = Date.now();
      if (now - lastSignalMs >= SIGNAL_INTERVAL_MS) {
        lastSignalMs = now;
        const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
        writeFleetSignal(bot.username, {
          poi: bot.poi ?? undefined,
          systemId: bot.system ?? undefined,
          cargoPct: 0,
          cargoFull: false,
          fuelPct,
          needsFuel: fuelPct < 25,
        });
      }

      // ── Run inner combat loop, break on order ────────────────
      orderBreak = false;
      const inner = combatSelectorRoutine(ctx);
      for await (const step of inner) {
        if (bot.state !== "running") break;
        if (orderBreak) break;
        yield step;
      }
    }
  } finally {
    clearInterval(orderTimer);
  }
};
