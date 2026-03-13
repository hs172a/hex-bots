import type { Routine, RoutineContext } from "../bot.js";
import { minerRoutineV2 } from "./miner.js";
import { writeFleetSignal, sleepBot } from "./common.js";

/**
 * Fleet Miner — identical to the standard miner but periodically broadcasts
 * a fleet signal (cargo%, current POI/system) so fleet_hauler can track it.
 */
export const fleetMinerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  // Background signal emitter — fires every 30s independent of mining loop
  let signalTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    try {
      const cargoPct = bot.cargoMax > 0 ? Math.round((bot.cargo / bot.cargoMax) * 100) : 0;
      writeFleetSignal(bot.username, {
        poi: bot.poi ?? undefined,
        systemId: bot.system ?? undefined,
        cargoPct,
        cargoFull: cargoPct >= 85,
      });
    } catch { /* non-critical */ }
  }, 30_000);

  try {
    // Delegate entirely to the standard miner; yield its steps through
    const inner = minerRoutineV2(ctx);
    for await (const step of inner) {
      yield step;
    }
  } finally {
    if (signalTimer) { clearInterval(signalTimer); signalTimer = null; }
    // Clear signal on stop so hauler doesn't chase a stale entry
    try {
      writeFleetSignal(bot.username, { cargoFull: false, cargoPct: 0 });
    } catch { /* ignore */ }
  }
};
