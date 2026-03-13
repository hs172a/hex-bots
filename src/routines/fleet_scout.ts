import type { Routine, RoutineContext } from "../bot.js";
import { scoutRoutine } from "./scout.js";
import {
  writeFleetSignal,
  getPendingFleetOrder,
  clearFleetOrder,
  navigateToSystem,
  ensureDocked,
} from "./common.js";

const SIGNAL_INTERVAL_MS = 60_000;

/**
 * Fleet Scout — wraps the standard scout routine, emits fleet position + fuel
 * signals every 60s, and responds to manual orders (dock/goto/return_home).
 */
export const fleetScoutRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  let lastSignalMs = 0;
  let orderBreak = false;
  const orderTimer = setInterval(() => { orderBreak = true; }, 30_000);

  try {
    while (bot.state === "running") {
      // ── Manual order check ────────────────────────────────────
      const order = getPendingFleetOrder(bot.username);
      if (order) {
        ctx.log("info", `🔭 Fleet order: ${order.cmd}`);
        clearFleetOrder(bot.username);
        if (order.cmd === "dock") {
          yield "order_dock";
          await ensureDocked(ctx);
        } else if (order.cmd === "goto" && order.targetSystem) {
          yield "order_goto";
          await navigateToSystem(ctx, order.targetSystem, { fuelThresholdPct: 30, hullThresholdPct: 20 });
        } else if (order.cmd === "return_home") {
          yield "order_return_home";
          await ensureDocked(ctx);
        }
        orderBreak = false;
        continue;
      }

      // ── Emit position + fuel signal ───────────────────────────
      const now = Date.now();
      if (now - lastSignalMs >= SIGNAL_INTERVAL_MS) {
        lastSignalMs = now;
        const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
        try {
          writeFleetSignal(bot.username, {
            poi: bot.poi ?? undefined,
            systemId: bot.system ?? undefined,
            cargoPct: 0,
            cargoFull: false,
            fuelPct,
            needsFuel: fuelPct < 25,
          });
        } catch { /* non-critical */ }
      }

      // ── Run one scout pass, break on order flag ───────────────
      orderBreak = false;
      const inner = scoutRoutine(ctx);
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
