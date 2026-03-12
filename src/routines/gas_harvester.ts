import type { Routine, RoutineContext } from "../bot.js";
import {
  isGasCloudPoi,
  findStation,
  parseOreFromMineResult,
  collectFromStorage,
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  ensureFueled,
  navigateToSystem,
  refuelAtStation,
  factionDonateProfit,
  readSettings,
  writeSettings,
  scavengeWrecks,
  detectAndRecoverFromDeath,
  getSystemInfo,
  sleep,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

type DepositMode = "storage" | "faction" | "sell";

function getGasSettings(username?: string): {
  depositMode: DepositMode;
  depositFallback: DepositMode;
  cargoThreshold: number;
  refuelThreshold: number;
  repairThreshold: number;
  homeSystem: string;
  system: string;
  depositBot: string;
  targetGas: string;
  /** Per-bot pinned harvest system. Overrides global system setting. */
  gas_target: { system_id: string; system_name: string } | null;
} {
  const all = readSettings();
  const m = all.gas_harvester || {};
  const botOverrides = username ? (all[username] || {}) : {};

  function parseDepositMode(val: unknown): DepositMode | null {
    if (val === "faction" || val === "sell" || val === "storage") return val;
    return null;
  }

  return {
    depositMode:
      parseDepositMode(botOverrides.depositMode) ??
      parseDepositMode(m.depositMode) ?? "faction",
    depositFallback:
      parseDepositMode(botOverrides.depositFallback) ??
      parseDepositMode(m.depositFallback) ?? "storage",
    cargoThreshold: (m.cargoThreshold as number) || 80,
    refuelThreshold: (m.refuelThreshold as number) || 50,
    repairThreshold: (m.repairThreshold as number) || 40,
    homeSystem: (botOverrides.homeSystem as string) || (m.homeSystem as string) || "",
    system: (m.system as string) || "",
    depositBot: (botOverrides.depositBot as string) || (m.depositBot as string) || "",
    targetGas: (botOverrides.targetGas as string) || (m.targetGas as string) || "",
    gas_target: (() => {
      const raw = botOverrides.gas_target as Record<string, unknown> | undefined;
      return raw?.system_id
        ? { system_id: raw.system_id as string, system_name: (raw.system_name as string) || "" }
        : null;
    })(),
  };
}

// ── Gas Harvester routine ────────────────────────────────────

export const gasHarvesterRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  await bot.refreshStatus();
  const settings0 = getGasSettings(bot.username);

  // ── Remember launch station ───────────────────────────────────────────
  const allBotSettings = readSettings();
  const botSettings0 = (allBotSettings[bot.username] || {}) as Record<string, unknown>;
  let launchStationPoi = (botSettings0.launchStationPoi as string) || "";

  if (!launchStationPoi && bot.docked && bot.poi) {
    launchStationPoi = bot.poi;
    writeSettings({ [bot.username]: { launchStationPoi, launchSystem: bot.system } });
    ctx.log("system", `Launch station recorded: ${launchStationPoi} (${bot.system})`);
  }

  const persistedLaunchSystem = (botSettings0.launchSystem as string) || "";
  // bot.homeSystem is populated from get_status (home_system field) — use it as a fallback
  // before bot.system so the harvester returns to the correct system after a server restart
  // where launchStationPoi/launchSystem were not persisted (e.g. bot was in space at restart).
  const homeSystem = settings0.homeSystem || persistedLaunchSystem || bot.homeSystem || bot.system;

  // ── Startup: return home and dump non-fuel cargo to storage ──
  await bot.refreshCargo();
  const nonFuelCargo = bot.inventory.filter(i => {
    const lower = i.itemId.toLowerCase();
    return !lower.includes("fuel") && !lower.includes("energy_cell") && i.quantity > 0;
  });
  if (nonFuelCargo.length > 0) {
    if (bot.system !== homeSystem) {
      ctx.log("harvesting", `Startup: returning to home system ${homeSystem} to deposit cargo...`);
      const fueled = await ensureFueled(ctx, 50);
      if (fueled) {
        await navigateToSystem(ctx, homeSystem, { fuelThresholdPct: 50, hullThresholdPct: 30 });
      }
    }
    // Navigate to station POI in current system before docking
    if (!bot.docked) {
      const { pois: startupPois } = await getSystemInfo(ctx);
      const startupStation = findStation(startupPois);
      if (startupStation) {
        const travelResp = await bot.exec("travel", { target_poi: startupStation.id });
        if (travelResp.error && !travelResp.error.message.includes("already")) {
          ctx.log("error", `Startup: travel to station failed: ${travelResp.error.message}`);
        }
      }
    }
    await ensureDocked(ctx);
    const startupUnloaded: string[] = [];
    for (const item of nonFuelCargo) {
      let deposited = false;
      if (settings0.depositMode === "faction") {
        const fResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
        if (!fResp.error) {
          deposited = true;
        } else {
          const sResp = await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
          if (!sResp.error) deposited = true;
        }
      } else if (settings0.depositMode === "sell") {
        const sellResp = await bot.exec("sell", { item_id: item.itemId, quantity: item.quantity });
        const sr0 = (!sellResp.error && sellResp.result && typeof sellResp.result === "object")
          ? sellResp.result as Record<string, unknown> : null;
        const unsoldQty0 = sr0 ? ((sr0.unsold as number) ?? item.quantity) : item.quantity;
        if (!sellResp.error && unsoldQty0 <= 0) {
          deposited = true;
        } else {
          const toDeposit0 = sellResp.error ? item.quantity : unsoldQty0;
          const sResp = await bot.exec("deposit_items", { item_id: item.itemId, quantity: toDeposit0 });
          if (!sResp.error) {
            deposited = true;
          } else {
            const fResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: toDeposit0 });
            if (!fResp.error) deposited = true;
          }
        }
      } else {
        const sResp = await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
        if (!sResp.error) {
          deposited = true;
        } else {
          const fResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
          if (!fResp.error) deposited = true;
        }
      }
      if (deposited) startupUnloaded.push(`${item.quantity}x ${item.name}`);
    }
    if (startupUnloaded.length > 0) {
      ctx.log("harvesting", `Startup: deposited ${startupUnloaded.join(", ")} — cargo clear for harvesting`);
    } else {
      ctx.log("error", `Startup: failed to deposit cargo — will retry in main loop`);
    }
  }

  while (bot.state === "running") {
    // ── Death recovery ──
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleep(30000); continue; }

    const settings = getGasSettings(bot.username);
    const cargoThresholdRatio = settings.cargoThreshold / 100;
    const safetyOpts = {
      fuelThresholdPct: settings.refuelThreshold,
      hullThresholdPct: settings.repairThreshold,
    };

    // ── Status + fuel/hull checks ──
    yield "get_status";
    await bot.refreshStatus();

    yield "fuel_check";
    const fueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
    if (!fueled) {
      ctx.log("error", "Cannot refuel — waiting 30s...");
      await sleep(30000);
      continue;
    }

    await bot.refreshStatus();
    const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    if (hullPct <= 40) {
      ctx.log("system", `Hull critical (${hullPct}%) — returning to station for repair`);
      await ensureDocked(ctx);
      await repairShip(ctx);
    }

    await ensureUndocked(ctx);

    // ── Navigate to target system if configured ──
    // Priority: per-bot gas_target > global system setting
    const targetSystemId = settings.gas_target?.system_id || settings.system || "";
    if (targetSystemId && targetSystemId !== bot.system) {
      if (settings.gas_target) ctx.log("harvesting", `Pinned target: ${settings.gas_target.system_name || targetSystemId}`);
      yield "navigate_to_target";
      const arrived = await navigateToSystem(ctx, targetSystemId, safetyOpts);
      if (!arrived) {
        ctx.log("error", "Failed to reach target system — harvesting locally instead");
      }
    }

    if (bot.state !== "running") break;

    // ── Get system info (always needed for station routing) ──
    yield "find_gas_cloud";
    const { pois, systemId } = await getSystemInfo(ctx);
    if (systemId) bot.system = systemId;

    let stationPoi: { id: string; name: string } | null = null;
    const station = findStation(pois);
    if (station) stationPoi = { id: station.id, name: station.name };

    // Pre-harvest cargo check — if already at threshold, skip straight to unload
    await bot.refreshStatus();
    const preHarvestFill = bot.cargoMax > 0 ? bot.cargo / bot.cargoMax : 0;
    const skipToUnload = preHarvestFill >= cargoThresholdRatio;
    if (skipToUnload) {
      ctx.log("mining", `Cargo already ${Math.round(preHarvestFill * 100)}% full — skipping to unload`);
    }

    if (!skipToUnload) {
      let cloudPoi: { id: string; name: string } | null = null;

      // Find gas cloud — prefer one with target gas if set
      if (settings.targetGas) {
        for (const poi of pois) {
          if (isGasCloudPoi(poi.type)) {
            const sysData = ctx.mapStore.getSystem(bot.system);
            const storedPoi = sysData?.pois.find(p => p.id === poi.id);
            if (storedPoi?.ores_found.some(o => o.item_id === settings.targetGas)) {
              cloudPoi = { id: poi.id, name: poi.name };
              break;
            }
          }
        }
      }

      // Fallback: any gas cloud POI
      if (!cloudPoi) {
        const gasCloud = pois.find(p => isGasCloudPoi(p.type));
        if (gasCloud) cloudPoi = { id: gasCloud.id, name: gasCloud.name };
      }

      if (!cloudPoi) {
        ctx.log("error", "No gas cloud found in this system — waiting 30s before retry");
        await sleep(30000);
        continue;
      }

      // ── Travel to gas cloud ──
      yield "travel_to_cloud";
      const travelResp = await bot.exec("travel", { target_poi: cloudPoi.id });
      if (travelResp.error && !travelResp.error.message.includes("already")) {
        ctx.log("error", `Travel failed: ${travelResp.error.message}`);
        await sleep(5000);
        continue;
      }
      bot.poi = cloudPoi.id;

      // Report gas cloud resources to deposits DB
      const gasPoiResp = await bot.exec("get_poi");
      if (!gasPoiResp.error && gasPoiResp.result && typeof gasPoiResp.result === "object") {
        const gp = gasPoiResp.result as Record<string, unknown>;
        const gasResources = (
          Array.isArray(gp.resources) ? gp.resources :
          Array.isArray(gp.gases) ? gp.gases : []
        ) as Array<Record<string, unknown>>;
        if (gasResources.length > 0 && bot.system) {
          const sysSt = ctx.mapStore.getSystem(bot.system);
          ctx.mapStore.updateDeposits(
            cloudPoi.id, bot.system, sysSt?.name ?? bot.system,
            cloudPoi.name, "gas_cloud", gasResources, bot.username,
          );
        }
      }

      // ── Scavenge wrecks at cloud before harvesting ──
      yield "scavenge";
      await scavengeWrecks(ctx);

      // ── Harvest loop: mine until cargo threshold ──
      yield "harvest_loop";
      let harvestCycles = 0;
      let stopReason = "";
      const gasMinedMap = new Map<string, number>();

      while (bot.state === "running") {
        await bot.refreshStatus();

        const midHull = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
        if (midHull <= 40) { stopReason = `hull critical (${midHull}%)`; break; }

        const midFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
        if (midFuel < safetyOpts.fuelThresholdPct) { stopReason = `fuel low (${midFuel}%)`; break; }

        const mineResp = await bot.exec("mine");

        if (mineResp.error) {
          const msg = mineResp.error.message.toLowerCase();
          if (msg.includes("depleted") || msg.includes("no resources") || msg.includes("no gas") || msg.includes("no minable")) {
            stopReason = "cloud depleted"; break;
          }
          if (msg.includes("cargo") && msg.includes("full")) {
            stopReason = "cargo full"; break;
          }
          if (msg.includes("harvester") || msg.includes("equipment")) {
            ctx.log("error", `Missing gas harvester module: ${mineResp.error.message}`);
            await sleep(30000);
            return;
          }
          ctx.log("error", `Harvest error: ${mineResp.error.message}`);
          break;
        }

        harvestCycles++;

        const { oreId, oreName } = parseOreFromMineResult(mineResp.result);
        if (oreId && bot.poi) {
          ctx.mapStore.recordMiningYield(bot.system, bot.poi, { item_id: oreId, name: oreName });
          gasMinedMap.set(oreName, (gasMinedMap.get(oreName) || 0) + 1);
          bot.stats.totalMined++;
        }

        await bot.refreshStatus();
        const fillRatio = bot.cargoMax > 0 ? bot.cargo / bot.cargoMax : 0;
        if (fillRatio >= cargoThresholdRatio) {
          stopReason = `cargo at ${Math.round(fillRatio * 100)}%`; break;
        }

        yield "harvesting";
      }

      // Harvest summary
      if (harvestCycles > 0) {
        const gasList = [...gasMinedMap.entries()].map(([name, qty]) => `${qty}x ${name}`).join(", ");
        ctx.log("mining", `Harvested ${harvestCycles} cycles (${gasList})${stopReason ? ` — ${stopReason}` : ""}`);
      } else if (stopReason) {
        ctx.log("mining", `Stopped before harvesting — ${stopReason}`);
      }
    } // end if (!skipToUnload)

    if (bot.state !== "running") break;

    // ── Return to home system if we traveled away ──
    if (bot.system !== homeSystem && homeSystem) {
      yield "return_home";
      yield "pre_return_fuel";
      const returnFueled = await ensureFueled(ctx, safetyOpts.fuelThresholdPct);
      if (!returnFueled && stationPoi) {
        await refuelAtStation(ctx, stationPoi, safetyOpts.fuelThresholdPct);
      }

      const arrived = await navigateToSystem(ctx, homeSystem, safetyOpts);
      if (!arrived) {
        ctx.log("error", "Failed to return to home system — docking at nearest station");
      }

      const { pois: homePois } = await getSystemInfo(ctx);
      // Prefer the recorded launch station; fallback to any station in homeSystem
      if (launchStationPoi && homePois.some(p => p.id === launchStationPoi)) {
        stationPoi = { id: launchStationPoi, name: launchStationPoi };
      } else {
        const homeStation = findStation(homePois);
        stationPoi = homeStation ? { id: homeStation.id, name: homeStation.name } : null;
      }
    } else if (bot.system === homeSystem && launchStationPoi && !stationPoi) {
      // Already in home system — use the launch station if it's available
      const { pois: curPois } = await getSystemInfo(ctx);
      if (curPois.some(p => p.id === launchStationPoi)) {
        stationPoi = { id: launchStationPoi, name: launchStationPoi };
      }
    }

    // ── Travel to station (preferred POI if known) ──
    yield "travel_to_station";
    if (stationPoi) {
      const travelStationResp = await bot.exec("travel", { target_poi: stationPoi.id });
      if (travelStationResp.error && !travelStationResp.error.message.includes("already")) {
        ctx.log("error", `Travel to station failed: ${travelStationResp.error.message}`);
      }
    }

    // ── Dock (ensureDocked handles BFS to nearest station if none locally) ──
    yield "dock";
    const docked = await ensureDocked(ctx);
    if (!docked) {
      ctx.log("error", "Cannot dock anywhere — waiting 30s before retry");
      await sleep(20000);
      continue;
    }
    bot.docked = true;

    // ── Collect storage + unload cargo ──
    await collectFromStorage(ctx);
    const creditsBefore = bot.credits;

    yield "unload_cargo";
    const cargoResp = await bot.exec("get_cargo");
    let cargoItems: Array<Record<string, unknown>>;
    if (cargoResp.result && typeof cargoResp.result === "object") {
      const result = cargoResp.result as Record<string, unknown>;
      cargoItems = (
        Array.isArray(result) ? result :
        Array.isArray(result.items) ? result.items :
        Array.isArray(result.cargo) ? result.cargo : []
      ) as Array<Record<string, unknown>>;
    } else {
      if (cargoResp.error) ctx.log("error", `get_cargo failed: ${cargoResp.error.message} — using cached inventory`);
      cargoItems = bot.inventory.map(i => ({ item_id: i.itemId, name: i.name, quantity: i.quantity } as Record<string, unknown>));
    }

    if (cargoItems.length > 0) {
      const modeLabel: Record<string, string> = {
        storage: "station storage", faction: "faction storage", sell: "market",
      };
      const primaryLabel = settings.depositBot
        ? `${settings.depositBot}'s storage`
        : (modeLabel[settings.depositMode] || "storage");

      const unloadedItems: string[] = [];
      for (const item of cargoItems) {
        const itemId = (item.item_id as string) || "";
        const quantity = (item.quantity as number) || 0;
        if (!itemId || quantity <= 0) continue;
        const displayName = (item.name as string) || itemId;

        let deposited = false;
        if (settings.depositMode === "sell") {
          const sellResp = await bot.exec("sell", { item_id: itemId, quantity });
          const sr = (!sellResp.error && sellResp.result && typeof sellResp.result === "object")
            ? sellResp.result as Record<string, unknown> : null;
          const unsoldQty = sr ? ((sr.unsold as number) ?? quantity) : quantity;

          if (!sellResp.error && unsoldQty <= 0) {
            deposited = true;
          } else {
            // Sell returned no buyers (quantity_sold=0) OR API error — deposit the unsold items
            const toDeposit = sellResp.error ? quantity : unsoldQty;
            if (!sellResp.error) ctx.log("trade", `No buyers for ${displayName} (${toDeposit} unsold) — depositing to storage`);
            else ctx.log("trade", `Sell failed for ${displayName}: ${sellResp.error.message} — depositing to storage`);
            const storeResp = await bot.exec("deposit_items", { item_id: itemId, quantity: toDeposit });
            if (!storeResp.error) {
              deposited = true;
            } else {
              const fResp2 = await bot.exec("faction_deposit_items", { item_id: itemId, quantity: toDeposit });
              if (!fResp2.error) deposited = true;
              else ctx.log("error", `All deposit methods failed for ${displayName}: ${fResp2.error.message}`);
            }
          }
        } else if (settings.depositMode === "faction") {
          const fResp = await bot.exec("faction_deposit_items", { item_id: itemId, quantity });
          if (!fResp.error) {
            deposited = true;
          } else {
            ctx.log("trade", `Faction deposit failed for ${displayName}: ${fResp.error.message} — trying station storage`);
            const storeResp = await bot.exec("deposit_items", { item_id: itemId, quantity });
            if (!storeResp.error) deposited = true;
            else ctx.log("error", `All deposit methods failed for ${displayName}: ${storeResp.error.message}`);
          }
        } else if (settings.depositBot) {
          const gResp = await bot.exec("send_gift", { recipient: settings.depositBot, item_id: itemId, quantity });
          if (!gResp.error) {
            deposited = true;
          } else {
            ctx.log("trade", `Gift to ${settings.depositBot} failed for ${displayName}: ${gResp.error.message} — trying storage`);
            const storeResp = await bot.exec("deposit_items", { item_id: itemId, quantity });
            if (!storeResp.error) {
              deposited = true;
            } else {
              const fResp2 = await bot.exec("faction_deposit_items", { item_id: itemId, quantity });
              if (!fResp2.error) deposited = true;
              else ctx.log("error", `All deposit methods failed for ${displayName}: ${fResp2.error.message}`);
            }
          }
        } else {
          const storeResp = await bot.exec("deposit_items", { item_id: itemId, quantity });
          if (!storeResp.error) {
            deposited = true;
          } else {
            const fResp2 = await bot.exec("faction_deposit_items", { item_id: itemId, quantity });
            if (!fResp2.error) deposited = true;
            else ctx.log("error", `All deposit methods failed for ${displayName}: ${fResp2.error.message}`);
          }
        }

        if (deposited) {
          unloadedItems.push(`${quantity}x ${displayName}`);
        }
        yield "unloading";
      }

      if (unloadedItems.length > 0) {
        ctx.log("trade", `Unloaded ${unloadedItems.join(", ")} → ${primaryLabel}`);
      }
    }

    await bot.refreshStatus();
    await bot.refreshStorage();

    const earnings = bot.credits - creditsBefore;
    await factionDonateProfit(ctx, earnings);

    // ── Refuel + Repair ──
    yield "refuel";
    await tryRefuel(ctx);
    yield "repair";
    await repairShip(ctx);

    yield "check_skills";
    await bot.checkSkills();

    await bot.refreshStatus();
    const endFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    ctx.log("info", `Cycle done — ${bot.credits} credits, ${endFuel}% fuel, ${bot.cargo}/${bot.cargoMax} cargo`);
  }
};
