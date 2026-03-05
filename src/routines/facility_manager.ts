/**
 * FacilityManager routine — monitors and maintains personal and faction facilities.
 *
 * Steps each cycle:
 *   4.1  List personal facilities → alert when rent < RENT_ALERT_TICKS
 *   4.2  Auto-renew: navigate to facility base, dock, toggle off/on to pay rent
 *   4.3  Faction facility upgrade: apply available upgrades if autoUpgrade enabled
 *   4.4  Faction facility list → log bottlenecks for crafter advisory
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  navigateToSystem,
  getSystemInfo,
  readSettings,
  sleep,
  logAgentEvent,
} from "./common.js";

// ── Settings ──────────────────────────────────────────────────

function getFacilitySettings(): {
  autoRenewFacilities: boolean;
  autoUpgradeFacilities: boolean;
  rentAlertTicks: number;
  cycleIntervalSec: number;
} {
  const all = readSettings();
  const f = all.facility_manager || {};
  return {
    autoRenewFacilities: (f.autoRenewFacilities as boolean) ?? true,
    autoUpgradeFacilities: (f.autoUpgradeFacilities as boolean) ?? false,
    rentAlertTicks: (f.rentAlertTicks as number) || 5,
    cycleIntervalSec: (f.cycleIntervalSec as number) || 300,
  };
}

// ── Types ─────────────────────────────────────────────────────

interface Facility {
  id: string;
  name: string;
  type: string;
  base_id: string;
  base_name?: string;
  system_id?: string;
  rent_paid_until_tick?: number;
  current_tick?: number;
  maintenance_satisfied?: boolean;
  active?: boolean;
  tier?: number;
}

interface FactionFacility {
  id: string;
  name: string;
  type: string;
  tier: number;
  base_id: string;
  upgrades?: Array<{ type: string; name: string; skill_locked?: boolean }>;
}

// ── Helpers ───────────────────────────────────────────────────

function parseFacilities(result: unknown): Facility[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const raw =
    Array.isArray(r) ? r :
    Array.isArray(r.facilities) ? r.facilities :
    Array.isArray(r.items) ? r.items :
    [];
  return raw as Facility[];
}

function parseFactionFacilities(result: unknown): FactionFacility[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const raw =
    Array.isArray(r) ? r :
    Array.isArray(r.facilities) ? r.facilities :
    Array.isArray(r.items) ? r.items :
    [];
  return raw as FactionFacility[];
}

function ticksRemaining(facility: Facility): number {
  if (facility.rent_paid_until_tick === undefined) return Infinity;
  const current = facility.current_tick ?? 0;
  return Math.max(0, facility.rent_paid_until_tick - current);
}

// ── Routine ───────────────────────────────────────────────────

export const facilityManagerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  ctx.log("system", "FacilityManager: starting facility monitoring routine");
  yield "init";

  while (bot.state === "running") {
    const settings = getFacilitySettings();

    await bot.refreshStatus();

    // ── Step 4.1 — List personal facilities ─────────────────
    yield "list_facilities";
    const listResp = await bot.exec("facility", { action: "list" });
    const facilities = parseFacilities(listResp.result);

    if (listResp.error) {
      ctx.log("error", `FacilityManager: list failed — ${listResp.error.message}`);
    } else {
      ctx.log("system", `FacilityManager: ${facilities.length} personal facility/facilities`);

      for (const fac of facilities) {
        const ticks = ticksRemaining(fac);
        const maintOk = fac.maintenance_satisfied !== false;

        if (ticks < settings.rentAlertTicks || !maintOk) {
          const issues: string[] = [];
          if (ticks < settings.rentAlertTicks) issues.push(`rent expires in ${ticks} tick(s)`);
          if (!maintOk) issues.push("maintenance not satisfied");

          ctx.log("system", `FacilityManager: [ALERT] ${fac.name} (${fac.type}) — ${issues.join(", ")}`);
          logAgentEvent(ctx, "economy", "warn",
            `Facility alert: ${fac.name} — ${issues.join(", ")}`,
            { facility_id: fac.id, facility_type: fac.type, ticks_remaining: ticks },
          );

          // ── Step 4.2 — Auto-renew ─────────────────────────
          if (settings.autoRenewFacilities && fac.base_id) {
            yield `renew_${fac.id}`;
            ctx.log("system", `FacilityManager: auto-renewing ${fac.name} at base ${fac.base_name || fac.base_id}`);

            // Navigate to facility's base
            const targetSystem = fac.system_id || fac.base_id.split("_")[0];
            if (targetSystem && bot.system !== targetSystem) {
              await ensureUndocked(ctx);
              const navigated = await navigateToSystem(ctx, targetSystem, {
                fuelThresholdPct: 30,
                hullThresholdPct: 20,
              });
              if (!navigated) {
                ctx.log("error", `FacilityManager: could not navigate to ${targetSystem} for renewal`);
                continue;
              }
            }

            // Travel to POI and dock
            const { pois } = await getSystemInfo(ctx);
            const targetPoi = pois.find(p => p.id === fac.base_id);
            if (targetPoi && bot.poi !== targetPoi.id) {
              await ensureUndocked(ctx);
              await bot.exec("travel", { target_poi: targetPoi.id });
            }

            const docked = await ensureDocked(ctx);
            if (!docked) {
              ctx.log("error", `FacilityManager: could not dock at ${fac.base_name || fac.base_id}`);
              continue;
            }

            // Toggle off then on to trigger rent payment
            const offResp = await bot.exec("facility", { action: "toggle", facility_id: fac.id, active: false });
            if (offResp.error) {
              ctx.log("warn", `FacilityManager: toggle-off failed for ${fac.name}: ${offResp.error.message}`);
            } else {
              await sleep(2_000);
              const onResp = await bot.exec("facility", { action: "toggle", facility_id: fac.id, active: true });
              if (!onResp.error) {
                ctx.log("system", `FacilityManager: renewed ${fac.name} successfully`);
                logAgentEvent(ctx, "economy", "info",
                  `Facility renewed: ${fac.name}`,
                  { facility_id: fac.id },
                );
              } else {
                ctx.log("warn", `FacilityManager: toggle-on failed for ${fac.name}: ${onResp.error.message}`);
              }
            }

            await tryRefuel(ctx);
          }
        } else {
          ctx.log("system", `FacilityManager: ${fac.name} OK — ${ticks === Infinity ? "no rent" : `${ticks} tick(s) left`}`);
        }
      }
    }

    // ── Step 4.3 — Faction facility upgrade check ────────────
    if (bot.factionId) {
      yield "faction_facilities";
      const factionListResp = await bot.exec("facility", { action: "faction_list" });
      const factionFacilities = parseFactionFacilities(factionListResp.result);

      if (!factionListResp.error && factionFacilities.length > 0) {
        ctx.log("system", `FacilityManager: ${factionFacilities.length} faction facility/facilities`);

        for (const fac of factionFacilities) {
          if (!Array.isArray(fac.upgrades) || fac.upgrades.length === 0) continue;

          const available = fac.upgrades.filter(u => !u.skill_locked);
          if (available.length === 0) continue;

          ctx.log("system", `FacilityManager: ${fac.name} (tier ${fac.tier ?? "?"}) — ${available.length} upgrade(s) available`);

          if (settings.autoUpgradeFacilities) {
            yield `upgrade_${fac.id}`;
            for (const upgrade of available) {
              const upResp = await bot.exec("facility", {
                action: "faction_upgrade",
                facility_id: fac.id,
                facility_type: upgrade.type,
              });
              if (!upResp.error) {
                ctx.log("system", `FacilityManager: upgraded ${fac.name} → ${upgrade.name}`);
                logAgentEvent(ctx, "economy", "info",
                  `Faction facility upgraded: ${fac.name} → ${upgrade.name}`,
                  { facility_id: fac.id, upgrade_type: upgrade.type },
                );
              } else {
                ctx.log("warn", `FacilityManager: upgrade ${upgrade.name} failed: ${upResp.error.message}`);
                break;
              }
            }
          } else {
            ctx.log("system", `FacilityManager: upgrades available for ${fac.name} — set autoUpgradeFacilities=true to apply`);
          }
        }
      }
    }

    // ── Cycle sleep ──────────────────────────────────────────
    const delaySec = settings.cycleIntervalSec;
    ctx.log("system", `FacilityManager: cycle complete — next check in ${delaySec}s`);
    await sleep(delaySec * 1_000);
  }
};
