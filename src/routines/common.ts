/**
 * Shared utilities for all bot routines.
 *
 * Provides: docking, refueling, repairing, navigation, system parsing,
 * ore parsing, and safety checks.
 */
import type { RoutineContext } from "../bot.js";
import { catalogStore } from "../catalogstore.js";
import type { MapStore } from "../mapstore.js";

// ── Types ────────────────────────────────────────────────────

export interface BaseServices {
  refuel?: boolean;
  repair?: boolean;
  market?: boolean;
  storage?: boolean;
  shipyard?: boolean;
  crafting?: boolean;
  missions?: boolean;
  cloning?: boolean;
  insurance?: boolean;
}

export interface SystemPOI {
  id: string;
  name: string;
  type: string;
  has_base: boolean;
  base_id: string | null;
  /** Station services (refuel, repair, market, etc.) — null if unknown or no base. */
  services: BaseServices | null;
}

export interface Connection {
  id: string;
  name: string;
  /** Fuel cost for this jump. */
  jump_cost: number | null;
}

export interface SystemInfo {
  pois: SystemPOI[];
  connections: Connection[];
  systemId: string;
}

// ── POI classification ───────────────────────────────────────

/** Check if a POI type is ANY minable resource location (belt, gas cloud, nebula, ice, etc.) */
export function isMinablePoi(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("asteroid") || t.includes("gas") || t.includes("cloud")
    || t.includes("nebula") || t.includes("field") || t.includes("ring")
    || t.includes("belt") || t.includes("resource");
}

/** Check if a POI is an ore belt (asteroid belt/field/ring — NOT gas clouds or ice fields). */
export function isOreBeltPoi(type: string): boolean {
  const t = type.toLowerCase();
  if (t.includes("gas") || t.includes("cloud") || t.includes("nebula") || t.includes("ice")) return false;
  return t.includes("asteroid") || t.includes("belt") || t.includes("ring")
    || t.includes("field") || t.includes("resource");
}

/** Check if a POI is a gas cloud. */
export function isGasCloudPoi(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("gas") || t.includes("cloud") || t.includes("nebula");
}

/** Check if a POI is an ice field. */
export function isIceFieldPoi(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("ice");
}

/** Check if a POI type is purely scenic (only needs one visit). */
export function isScenicPoi(type: string): boolean {
  const t = type.toLowerCase();
  return t === "sun" || t === "star" || t === "wormhole" || t === "jump_gate";
}

/**
 * Parse station IDs from a `not_docked` error message returned by `view_storage`.
 * Example message: "... 1,660 items in storage at alpha_centauri_colonial_station, grand_exchange_station, confederacy_central_command"
 * Returns the list of station IDs and also updates bot.storageStations.
 */
export function parseStorageLocations(bot: RoutineContext["bot"], errorMessage: string): string[] {
  const match = errorMessage.match(/in storage at (.+)$/m);
  if (!match) return [];
  const stations = match[1].split(",").map(s => s.trim()).filter(Boolean);
  if (stations.length > 0) {
    for (const s of stations) bot.storageStations.add(s);
  }
  return stations;
}

// ── Item size helpers ────────────────────────────────────────

/** Get the cargo size (weight per unit) of an item from the catalog. Defaults to 1 if unknown. */
export function getItemSize(itemId: string): number {
  const item = catalogStore.getItem(itemId);
  const size = item?.size as number | undefined;
  return (size && size > 0) ? size : 1;
}

/** How many units of an item fit in the given free cargo weight. */
export function maxItemsForCargo(freeWeight: number, itemId: string): number {
  if (freeWeight <= 0) return 0;
  return Math.floor(freeWeight / getItemSize(itemId));
}

/** Check if a POI represents a station. */
export function isStationPoi(poi: SystemPOI): boolean {
  return poi.has_base || (poi.type || "").toLowerCase() === "station";
}

/** Find the first station POI in a list. Optionally filter by required service. */
export function findStation(pois: SystemPOI[], requiredService?: keyof BaseServices): SystemPOI | null {
  if (requiredService) {
    // Prefer station with the required service
    const withService = pois.find(p => isStationPoi(p) && p.services?.[requiredService] !== false);
    if (withService) return withService;
  }
  return pois.find(p => isStationPoi(p)) || null;
}

/** Check if a station POI is known to lack a specific service. */
export function stationHasService(poi: SystemPOI, service: keyof BaseServices): boolean {
  // If services are unknown, assume the station has the service (optimistic)
  if (!poi.services) return true;
  return poi.services[service] !== false;
}

// ── System data parsing ──────────────────────────────────────

/** Parse system data from get_system response. Optionally saves to mapStore when ms is provided. */
export function parseSystemData(resp: Record<string, unknown>, ms?: MapStore): SystemInfo {
  const sysObj = resp.system as Record<string, unknown> | undefined;
  const rawPois = (sysObj?.pois ?? resp.pois) as Array<Record<string, unknown>> | undefined;
  const rawConns = (sysObj?.connections ?? sysObj?.jump_gates ?? resp.connections) as Array<Record<string, unknown>> | undefined;
  const systemId = (sysObj?.id as string) || "";

  const pois: SystemPOI[] = [];
  if (Array.isArray(rawPois)) {
    for (const p of rawPois) {
      // Extract base services from inline base object or direct services field
      let services: BaseServices | null = null;
      const baseObj = p.base as Record<string, unknown> | undefined;
      const rawServices = baseObj?.services ?? p.services;
      if (rawServices && typeof rawServices === "object" && !Array.isArray(rawServices)) {
        services = rawServices as BaseServices;
      } else if (Array.isArray(rawServices)) {
        // Convert string array ["refuel", "repair", ...] to services object
        services = {};
        for (const s of rawServices as string[]) {
          (services as Record<string, boolean>)[s] = true;
        }
      }

      pois.push({
        id: (p.id as string) || "",
        name: (p.name as string) || (p.id as string) || "",
        type: (p.type as string) || "",
        has_base: !!(p.has_base || p.base_id || baseObj),
        base_id: (p.base_id as string) || (baseObj?.id as string) || null,
        services,
      });
    }
  }

  const connections: Connection[] = [];
  if (Array.isArray(rawConns)) {
    for (const c of rawConns) {
      const id = (c.system_id as string) || (c.id as string)
        || (c.target_system as string) || (c.target as string)
        || (c.destination as string) || "";
      if (!id) continue;
      connections.push({
        id,
        name: (c.system_name as string) || (c.name as string) || id,
        jump_cost: (c.jump_cost as number) ?? null,
      });
    }
  }

  // Save to mapStore — merge top-level fields in case API puts them outside "system"
  const merged = { ...(sysObj || {}) } as Record<string, unknown>;
  if (!merged.id && resp.id) merged.id = resp.id;
  if (!merged.security_level && resp.security_level) merged.security_level = resp.security_level;
  if (!merged.security_status && resp.security_status) merged.security_status = resp.security_status;

  if (ms && (merged.id || sysObj?.id)) {
    ms.updateSystem(merged);
  }

  return { pois, connections, systemId };
}

/** Fetch and parse system data from the API. Updates bot.system if found. */
export async function getSystemInfo(ctx: RoutineContext): Promise<SystemInfo> {
  const { bot } = ctx;
  const systemResp = await bot.exec("get_system");

  if (systemResp.result && typeof systemResp.result === "object") {
    const info = parseSystemData(systemResp.result as Record<string, unknown>, ctx.mapStore);
    if (info.systemId) bot.system = info.systemId;
    return info;
  }

  return { pois: [], connections: [], systemId: bot.system };
}

// ── Ore parsing ──────────────────────────────────────────────

/** Extract ore id and name from a mine response result. */
export function parseOreFromMineResult(result: unknown): { oreId: string; oreName: string } {
  if (!result || typeof result !== "object") return { oreId: "", oreName: "" };

  const mr = result as Record<string, unknown>;
  const ore = mr.item ?? mr.ore ?? mr.mined;
  let oreId = "";
  let oreName = "";

  if (ore && typeof ore === "object") {
    const oreObj = ore as Record<string, unknown>;
    oreId = (oreObj.item_id as string) || (oreObj.id as string) || (oreObj.name as string) || "";
    oreName = (oreObj.name as string) || oreId;
  } else {
    oreId = (mr.resource_id as string) || (mr.item_id as string) || (mr.ore_id as string) || "";
    oreName = (mr.resource_name as string) || (mr.item_name as string) || (mr.ore_name as string) || (mr.name as string) || oreId;
  }

  return { oreId, oreName };
}

// ── Docking ──────────────────────────────────────────────────

/**
 * Return POIs for the bot's current system from the MapStore cache
 * (no API call). Returns null if the system is unknown or has no POI data.
 */
export function getSystemPoisFromDb(ctx: RoutineContext): SystemPOI[] | null {
  const sys = ctx.mapStore.getSystem(ctx.bot.system);
  if (!sys || sys.pois.length === 0) return null;
  return sys.pois.map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    has_base: p.has_base,
    base_id: p.base_id,
    services: p.services as BaseServices | null,
  }));
}

/** Helper: attempt to dock at a specific POI. Returns true on success.
 *  On "No base at this location" marks the POI in MapStore so BFS skips it. */
async function tryDockAt(
  ctx: RoutineContext,
  systemId: string,
  poiId: string,
  poiName: string,
): Promise<boolean> {
  const { bot } = ctx;
  if (bot.poi !== poiId) {
    ctx.log("travel", `Traveling to ${poiName}...`);
    await bot.exec("travel", { target_poi: poiId });
    bot.poi = poiId;
  }
  ctx.log("system", "Docking...");
  const dResp = await bot.exec("dock");
  if (!dResp.error || dResp.error.message.includes("already")) {
    bot.docked = true;
    await collectFromStorage(ctx);
    await recordMarketData(ctx);
    await analyzeMarket(ctx);
    await ensureInsured(ctx);
    return true;
  }
  const msg = dResp.error?.message ?? "";
  if (msg.toLowerCase().includes("no base") || msg.includes("no_base")) {
    ctx.log("error", `${poiName} has no dockable base — invalidating in map DB`);
    ctx.mapStore.markNoBase(systemId, poiId);
  } else {
    ctx.log("error", `Dock failed at ${poiName}: ${msg}`);
  }
  return false;
}

/** Ensure the bot is docked at a station.
 *
 *  Priority:
 *  1. Already docked → done.
 *  2. MapStore DB has a station in current system → travel+dock (no API call).
 *  3. DB miss → refresh via get_system API, then try DB station again.
 *  4. No local station → BFS from MapStore to find nearest station system,
 *     jump there, and dock.
 *
 *  When dock fails with "No base at this location" the POI is invalidated in
 *  the MapStore so the next BFS pass skips it automatically.
 *
 *  Returns true if successfully docked. */
export async function ensureDocked(ctx: RoutineContext): Promise<boolean> {
  const { bot } = ctx;
  if (bot.docked) return true;

  // ── Step 1: check DB for local station (no API call) ──────────────────────
  let dbPois = getSystemPoisFromDb(ctx);
  let station = dbPois ? findStation(dbPois) : null;

  // ── Step 2: DB miss — refresh system data from API ────────────────────────
  if (!station) {
    const { pois } = await getSystemInfo(ctx);
    station = findStation(pois);
    dbPois = pois; // may have been updated by parseSystemData
  }

  if (station) {
    if (await tryDockAt(ctx, bot.system, station.id, station.name)) return true;
    // Dock failed (and markNoBase called if "no base") — fall through to BFS
  }

  // ── Step 3: BFS across MapStore to find nearest system with a station ──────
  ctx.log("system", `No station in ${bot.system} — searching map for nearest station...`);
  const nearest = ctx.mapStore.findNearestStationSystem(bot.system);
  if (!nearest) {
    ctx.log("error", "No known station in mapped systems — cannot dock");
    return false;
  }

  ctx.log("travel", `Nearest station: ${nearest.poiName} in ${nearest.systemId} (${nearest.hops} hops away)`);

  // Navigate to that system if needed
  if (nearest.systemId !== bot.system) {
    await ensureUndocked(ctx);
    const route = ctx.mapStore.findRoute(bot.system, nearest.systemId);
    if (route && route.length > 1) {
      for (let i = 1; i < route.length; i++) {
        if (bot.state !== "running") return false;
        ctx.log("travel", `Jumping to ${route[i]} (${i}/${route.length - 1})...`);
        const jumpResp = await bot.exec("jump", { target_system: route[i] });
        if (jumpResp.error) {
          ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
          return false;
        }
      }
    } else {
      const jumpResp = await bot.exec("jump", { target_system: nearest.systemId });
      if (jumpResp.error) {
        ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
        return false;
      }
    }
  }

  return tryDockAt(ctx, nearest.systemId, nearest.poiId, nearest.poiName);
}

/** Ensure the bot is undocked. */
export async function ensureUndocked(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;

  ctx.log("system", "Undocking...");
  const resp = await bot.exec("undock");
  if (!resp.error || resp.error.message.includes("already")) {
    bot.docked = false;
  }
}

// ── Market data recording ────────────────────────────────────

/** Record market prices at the current station to the galaxy map. */
export async function recordMarketData(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked || !bot.poi || !bot.system) return;

  const marketResp = await bot.exec("view_market");
  if (marketResp.result && typeof marketResp.result === "object") {
    ctx.mapStore.updateMarket(bot.system, bot.poi, marketResp.result as Record<string, unknown>);

    // Submit trade intel to faction (fire-and-forget)
    if (bot.factionId) {
      bot.exec("faction_submit_trade_intel", {
        stations: bot.poi ? [bot.poi] : [],
      }).catch(() => {});
    }
  }
}

/** Call analyze_market to build Trading XP and log top insight. Must be docked. */
export async function analyzeMarket(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;
  const resp = await bot.exec("analyze_market", { mode: "overview" });
  if (!resp.error && resp.result && typeof resp.result === "object") {
    const r = resp.result as Record<string, unknown>;
    const insights = r.top_insights as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(insights) && insights.length > 0) {
      const top = insights[0];
      ctx.log("trade", `Market intel: ${(top.message as string) ?? (top.category as string) ?? "no insights"}`);
    }
  }
}

// ── Storage collection ───────────────────────────────────────

/**
 * Check station storage for credits and items, withdraw everything useful.
 * Withdraws credits first, then fuel cells / other items if cargo space allows.
 * Also records market prices at the station.
 * Should be called every time a bot successfully docks.
 */
export async function collectFromStorage(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;

  const storageResp = await bot.exec("view_storage");
  if (storageResp.error) {
    const errCode = storageResp.error.code ?? "";
    const errMsg  = (storageResp.error.message ?? "").toLowerCase();
    const isNotDocked =
      errCode === "not_docked" ||
      errMsg.includes("not_docked") ||
      errMsg.includes("must be docked") ||
      errMsg.includes("provide a station_id");
    if (isNotDocked) {
      bot.docked = false;
      const stations = parseStorageLocations(bot, storageResp.error.message ?? "");
      if (stations.length > 0) ctx.log("info", `Storage detected at: ${stations.join(", ")}`);
    }
    return;
  }
  if (!storageResp.result || typeof storageResp.result !== "object") return;

  const r = storageResp.result as Record<string, unknown>;

  // Withdraw credits to the bot
  const credits = (r.credits as number) || (r.stored_credits as number) || 0;
  if (credits > 0) {
    const wResp = await bot.exec("withdraw_credits", { amount: credits });
    if (!wResp.error) {
      ctx.log("trade", `Collected ${credits} credits from storage`);
      await bot.refreshStatus();
    }
  }

  // Probe faction storage availability for this station and cache result
  if (bot.poi && ctx.mapStore.hasFactionStorage(bot.poi) === null) {
    const fvResp = await bot.exec("view_faction_storage");
    const available = !fvResp.error ||
      !(fvResp.error.code === "no_faction_storage" ||
        (fvResp.error.message ?? "").includes("no_faction_storage"));
    ctx.mapStore.setFactionStorage(bot.poi, available);
    if (!available) ctx.log("trade", `No faction storage at ${bot.poi} (cached for 15 min)`);
  }

  // Transfer all station storage items → faction storage (shared pool)
  await transferStationToFaction(ctx);

  await bot.refreshStatus();

  // Record market prices at this station
  await recordMarketData(ctx);
}

/**
 * Transfer all items from personal station storage into faction storage.
 * This centralises materials so any bot (crafters, traders, etc.) can access them.
 * Credits are kept on the bot (not transferred).
 * Assumes docked at a station with both storage and faction storage access.
 */
export async function transferStationToFaction(ctx: RoutineContext): Promise<number> {
  const { bot } = ctx;
  if (!bot.docked) return 0;

  await bot.refreshStorage();
  if (bot.storage.length === 0) return 0;

  let totalTransferred = 0;
  const MAX_PASSES = 20;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    await bot.refreshStorage();
    if (bot.storage.length === 0) break;
    await bot.refreshStatus();

    // ── Withdraw pass: fill cargo from station storage ──
    let withdrawnThisPass = 0;
    for (const item of [...bot.storage]) {
      if (item.quantity <= 0) continue;

      const freeSpace = bot.cargoMax > 0 ? bot.cargoMax - bot.cargo : 0;
      if (freeSpace <= 0) break;

      const qty = Math.min(item.quantity, maxItemsForCargo(freeSpace, item.itemId));
      if (qty <= 0) continue;

      const wResp = await bot.exec("withdraw_items", { item_id: item.itemId, quantity: qty });
      if (wResp.error) {
        if (wResp.error.code === "not_docked" || wResp.error.message?.includes("not_docked")) {
          bot.docked = false;
          return totalTransferred;
        }
        continue;
      }
      withdrawnThisPass += qty;
      await bot.refreshStatus();
    }

    if (withdrawnThisPass === 0) break; // nothing left to withdraw

    // ── Deposit pass: flush cargo → faction storage ──
    await bot.refreshCargo();
    const cachedFacStorage = bot.poi ? ctx.mapStore.hasFactionStorage(bot.poi) : null;
    let noFacStorage = cachedFacStorage === false;
    for (const item of [...bot.inventory]) {
      if (item.quantity <= 0) continue;

      let deposited = false;
      if (!noFacStorage) {
        const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
        if (!dResp.error) {
          if (bot.poi) ctx.mapStore.setFactionStorage(bot.poi, true);
          totalTransferred += item.quantity;
          logFactionActivity(ctx, "deposit", `Transferred ${item.quantity}x ${item.name} from station → faction storage`);
          deposited = true;
        } else {
          const ec = dResp.error.code ?? "";
          const em = dResp.error.message ?? "";
          if (ec === "no_faction_storage" || em.includes("no_faction_storage") || em.includes("faction_lockbox")) {
            noFacStorage = true;
            if (bot.poi) ctx.mapStore.setFactionStorage(bot.poi, false);
          }
        }
      }
      if (!deposited) {
        // Fallback: return to station storage so nothing is lost
        await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    }

    await bot.refreshStatus();
  }

  if (totalTransferred > 0) {
    ctx.log("trade", `Transferred ${totalTransferred} item(s) to faction storage`);
    await bot.refreshStorage();
    await bot.refreshFactionStorage();
  }
  return totalTransferred;
}

// ── Refueling ────────────────────────────────────────────────

/** Sell all cargo to raise credits. Returns number of items sold. */
export async function sellAllCargo(ctx: RoutineContext): Promise<number> {
  const { bot } = ctx;
  await bot.refreshCargo();

  let sold = 0;
  for (const item of bot.inventory) {
    const resp = await bot.exec("sell", { item_id: item.itemId, quantity: item.quantity });
    if (!resp.error) sold++;
  }
  return sold;
}

/**
 * Emergency fuel recovery when stranded (0% fuel, can't travel).
 * Tries: dock where we are → sell cargo → refuel.
 * Last resort: self-destruct to respawn at home station.
 * Returns true if recovered, false if still stuck.
 */
export async function emergencyFuelRecovery(ctx: RoutineContext): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();

  const fuelPct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : bot.fuel;
  if (fuelPct > 5) return true; // not actually stranded

  ctx.log("error", "EMERGENCY: Stranded with no fuel — attempting recovery...");

  // First: scavenge nearby wrecks/containers for fuel cells
  if (!bot.docked) {
    ctx.log("scavenge", "Checking for nearby fuel cells or containers...");
    const looted = await scavengeWrecks(ctx);
    if (looted > 0) {
      // Try refueling from cargo (fuel cells)
      ctx.log("system", "Found items — attempting refuel from cargo...");
      const refuelResp = await bot.exec("refuel");
      if (!refuelResp.error) {
        await bot.refreshStatus();
        const newFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : bot.fuel;
        ctx.log("system", `Recovery via scavenge successful! Fuel: ${newFuel}%`);
        return true;
      }
    }
  }

  // Try to dock at current location
  if (!bot.docked) {
    const dockResp = await bot.exec("dock");
    if (!dockResp.error || dockResp.error.message.includes("already")) {
      bot.docked = true;
      ctx.log("system", "Managed to dock — checking storage, selling cargo, refueling...");
      await collectFromStorage(ctx);
      await sellAllCargo(ctx);
      await bot.refreshStatus();
      const refuelResp = await bot.exec("refuel");
      if (!refuelResp.error) {
        await bot.refreshStatus();
        ctx.log("system", `Recovery successful! Fuel: ${bot.fuel}/${bot.maxFuel}`);
        return true;
      }
    }
  }

  // If docked but still can't refuel, sell cargo and try again
  if (bot.docked) {
    await sellAllCargo(ctx);
    await bot.refreshStatus();
    const refuelResp = await bot.exec("refuel");
    if (!refuelResp.error) {
      await bot.refreshStatus();
      ctx.log("system", `Recovery successful! Fuel: ${bot.fuel}/${bot.maxFuel}`);
      return true;
    }

    // Still can't refuel — stay docked and wait (rescue bot may help, or station restocks)
    ctx.log("system", "Cannot refuel — staying docked and waiting for help...");
    for (let w = 0; w < REFUEL_WAIT_RETRIES && bot.state === "running"; w++) {
      await sleep(REFUEL_WAIT_INTERVAL);
      await bot.refreshStatus();
      const fuelNow = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (fuelNow > 5) {
        ctx.log("system", `Fuel recovered to ${fuelNow}% — resuming`);
        return true;
      }
      // Try selling + refueling each cycle
      await sellAllCargo(ctx);
      const retryResp = await bot.exec("refuel");
      if (!retryResp.error) {
        await bot.refreshStatus();
        ctx.log("system", `Refuel succeeded after wait! Fuel: ${bot.fuel}/${bot.maxFuel}`);
        return true;
      }
      ctx.log("system", `Waiting at station for fuel... (${w + 1}/${REFUEL_WAIT_RETRIES})`);
    }
  }

  // Stranded — wait for rescue bot or manual intervention
  ctx.log("error", "Cannot recover fuel — stranded! Waiting for FuelRescue bot or manual help...");
  return false;
}

/** Max retries when waiting at station for fuel. */
const REFUEL_WAIT_RETRIES = 10;
/** Seconds between refuel retries when waiting at station. */
const REFUEL_WAIT_INTERVAL = 30_000;

/** Attempt to refuel to full. Calls refuel repeatedly until tank is full.
 *  If broke, sells cargo. If still can't refuel, waits at station and retries.
 *  Assumes docked. */
export async function tryRefuel(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  await bot.refreshStatus();

  let fuelPct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : bot.fuel;
  if (fuelPct >= 95) return;

  const startFuel = Math.round(fuelPct);

  // Check if current station has refuel service
  const { pois } = await getSystemInfo(ctx);
  const currentStation = pois.find(p => isStationPoi(p) && p.id === bot.poi);
  if (currentStation?.services && currentStation.services.refuel === false) {
    const refuelStation = findStation(pois, "refuel");
    if (refuelStation && refuelStation.id !== currentStation.id) {
      await bot.exec("undock");
      bot.docked = false;
      await bot.exec("travel", { target_poi: refuelStation.id });
      bot.poi = refuelStation.id;
      const dResp = await bot.exec("dock");
      if (!dResp.error || dResp.error.message.includes("already")) {
        bot.docked = true;
        await collectFromStorage(ctx);
      } else {
        ctx.log("error", `Dock at ${refuelStation.name} failed: ${dResp.error.message}`);
        return;
      }
    }
  }

  // Call refuel repeatedly until full or until it fails
  let consecutiveErrors = 0;
  let brokeAttempts = 0; // tracks no-credits failures with nothing to sell
  for (let i = 0; i < 10 && bot.state === "running"; i++) {
    const resp = await bot.exec("refuel");
    if (resp.error) {
      consecutiveErrors++;
      const msg = resp.error.message.toLowerCase();
      if (msg.includes("already full") || msg.includes("tank_full") || msg.includes("max")) {
        break;
      }
      if (msg.includes("credit") || msg.includes("fuel_source") || msg.includes("insufficient")) {
        const sold = await sellAllCargo(ctx);
        if (sold > 0) {
          brokeAttempts = 0;
          await bot.refreshStatus();
          continue;
        }
        // No cargo to sell and no credits — permanently broke
        brokeAttempts++;
        if (brokeAttempts >= 2) {
          ctx.log("error", `Cannot refuel — no credits and no cargo to sell. Stopping routine until rescue arrives.`);
          throw new Error("no_fuel_source: bankrupt — no credits and no cargo to sell");
        }
      }
      if (consecutiveErrors >= 2) break;
      continue;
    }

    consecutiveErrors = 0;
    await bot.refreshStatus();
    fuelPct = bot.maxFuel > 0 ? (bot.fuel / bot.maxFuel) * 100 : bot.fuel;
    if (fuelPct >= 95) break;
  }

  await bot.refreshStatus();
  fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (fuelPct >= 50) {
    if (fuelPct > startFuel) ctx.log("system", `Refueled ${startFuel}% → ${fuelPct}%`);
    return;
  }

  // Fuel still low — wait at station and retry periodically
  for (let attempt = 1; attempt <= REFUEL_WAIT_RETRIES && bot.state === "running"; attempt++) {
    ctx.log("system", `Fuel still at ${fuelPct}% — waiting at station (attempt ${attempt}/${REFUEL_WAIT_RETRIES})...`);
    await sleep(REFUEL_WAIT_INTERVAL);

    // Retry: sell + refuel
    await sellAllCargo(ctx);
    await bot.exec("refuel");
    await bot.refreshStatus();
    fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    if (fuelPct >= 50) {
      ctx.log("system", `Fuel recovered to ${fuelPct}% — continuing`);
      return;
    }
  }

  await bot.refreshStatus();
  ctx.log("error", `Could not refuel after ${REFUEL_WAIT_RETRIES} waits — fuel: ${bot.fuel}/${bot.maxFuel}`);
}

// ── Repair ───────────────────────────────────────────────────

/** Repair the ship if damaged. Assumes docked. */
export async function repairShip(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  await bot.refreshStatus();
  const hullPct = bot.maxHull > 0 ? (bot.hull / bot.maxHull) * 100 : 100;
  if (hullPct < 95) {
    const startHull = Math.round(hullPct);

    // Check if current station has repair service — prefer DB cache, fall back to API
    const repairDbPois = getSystemPoisFromDb(ctx);
    const repairPois = repairDbPois ?? (await getSystemInfo(ctx)).pois;
    const currentStation = repairPois.find(p => isStationPoi(p) && p.id === bot.poi);
    if (currentStation?.services && currentStation.services.repair === false) {
      const repairStation = findStation(repairPois, "repair");
      if (repairStation && repairStation.id !== currentStation.id) {
        await bot.exec("undock");
        bot.docked = false;
        await bot.exec("travel", { target_poi: repairStation.id });
        bot.poi = repairStation.id;
        const dResp = await bot.exec("dock");
        if (!dResp.error || dResp.error.message.includes("already")) {
          bot.docked = true;
          await collectFromStorage(ctx);
        } else {
          ctx.log("error", `Dock at ${repairStation.name} failed: ${dResp.error.message}`);
          return;
        }
      }
    }

    await bot.exec("repair");
    await bot.refreshStatus();
    const endHull = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    if (endHull > startHull) ctx.log("system", `Repaired hull ${startHull}% → ${endHull}%`);
  }
}

// ── Safety checks ────────────────────────────────────────────

/** Check fuel and hull, dock/refuel/repair if below thresholds.
 *  Uses ensureFueled() for robust cross-system fuel recovery. */
export async function safetyCheck(
  ctx: RoutineContext,
  opts: { fuelThresholdPct: number; hullThresholdPct: number },
): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();

  const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
  if (hullPct <= 40) {
    ctx.log("system", `Hull critical (${hullPct}%) — finding station for repair`);
    const docked = await ensureDocked(ctx);
    if (docked) {
      await repairShip(ctx);
    }
  }

  const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (fuelPct < opts.fuelThresholdPct) {
    const ok = await ensureFueled(ctx, opts.fuelThresholdPct);
    if (!ok) return false;
  }
  return true;
}

/**
 * Ensure the bot has adequate fuel. If below threshold:
 * 1. Jettison non-fuel cargo to make room, scavenge nearby fuel cells
 * 2. Try to refuel at a station in the current system
 * 3. If no local station, find the nearest known system with a station and navigate there
 * Returns true if fuel is now adequate, false if stranded.
 */
export async function ensureFueled(
  ctx: RoutineContext,
  thresholdPct: number,
  opts?: { noJettison?: boolean },
): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();
  let fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (fuelPct >= thresholdPct) return true;

  ctx.log("system", `Fuel low (${fuelPct}%) — need to refuel (threshold: ${thresholdPct}%)...`);

  // Step 1: Try local station first — prefer DB cache, fall back to API if needed
  const dbPois = getSystemPoisFromDb(ctx);
  let localStation = dbPois ? findStation(dbPois) : null;
  if (!localStation) {
    const { pois } = await getSystemInfo(ctx);
    localStation = findStation(pois);
  }

  if (localStation) {
    ctx.log("system", `Station found in current system: ${localStation.name}`);
    const ok = await refuelAtStation(ctx, localStation, thresholdPct);
    if (ok) return true;
    // refuelAtStation failed — try emergency
    return await emergencyFuelRecovery(ctx);
  }

  // Step 2: No local station — try fuel cells already in cargo
  if (!bot.docked) {
    const refuelResp = await bot.exec("refuel");
    if (!refuelResp.error) {
      await bot.refreshStatus();
      fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (fuelPct >= thresholdPct) {
        ctx.log("system", `Refueled from cargo — fuel now ${fuelPct}%`);
        return true;
      }
    }

    // Step 3: Nearly out of fuel — scavenge wrecks for fuel as last resort (never jettison cargo)
    if (bot.fuel <= 1) {
      ctx.log("system", "Nearly out of fuel — scavenging for fuel cells...");
      const looted = await scavengeWrecks(ctx, { fuelOnly: true });
      if (looted > 0) {
        const scavRefuel = await bot.exec("refuel");
        if (!scavRefuel.error) {
          await bot.refreshStatus();
          fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
          if (fuelPct >= thresholdPct) {
            ctx.log("system", `Scavenged fuel cells — fuel now ${fuelPct}%`);
            return true;
          }
        }
      }
    }
  }

  // Step 4: No local station — find nearest known system with one
  ctx.log("system", "No station in current system — searching known map for nearest station...");
  const nearest = ctx.mapStore.findNearestStationSystem(bot.system);
  if (!nearest) {
    ctx.log("error", "No known station in mapped systems — emergency recovery...");
    return await emergencyFuelRecovery(ctx);
  }

  ctx.log("travel", `Nearest station: ${nearest.poiName} in ${nearest.systemId} (${nearest.hops} jump${nearest.hops !== 1 ? "s" : ""} away)`);

  // Navigate there — use navigateToSystem if in a different system
  if (nearest.systemId !== bot.system) {
    // Check if we have enough fuel for at least one jump
    await bot.refreshStatus();
    const curFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
    if (curFuel < 10) {
      ctx.log("error", `Fuel too low (${curFuel}%) to reach station — emergency recovery...`);
      return await emergencyFuelRecovery(ctx);
    }

    await ensureUndocked(ctx);

    // Jump system by system toward the station
    const route = ctx.mapStore.findRoute(bot.system, nearest.systemId);
    if (route && route.length > 1) {
      for (let i = 1; i < route.length; i++) {
        if (bot.state !== "running") return false;
        await bot.refreshStatus();
        const preFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
        if (preFuel < 10) {
          ctx.log("error", `Fuel critical (${preFuel}%) mid-route — emergency recovery...`);
          return await emergencyFuelRecovery(ctx);
        }
        ctx.log("travel", `Jumping to ${route[i]} (${i}/${route.length - 1})...`);
        const jumpResp = await bot.exec("jump", { target_system: route[i] });
        if (jumpResp.error) {
          ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
          return await emergencyFuelRecovery(ctx);
        }
      }
    } else {
      // Direct jump
      ctx.log("travel", `Direct jump to ${nearest.systemId}...`);
      const jumpResp = await bot.exec("jump", { target_system: nearest.systemId });
      if (jumpResp.error) {
        ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
        return await emergencyFuelRecovery(ctx);
      }
    }
  }

  // Now in the station system — travel, dock, refuel
  await bot.refreshStatus();
  await ensureUndocked(ctx);
  ctx.log("travel", `Traveling to ${nearest.poiName}...`);
  const tResp = await bot.exec("travel", { target_poi: nearest.poiId });
  if (tResp.error && !tResp.error.message.includes("already")) {
    ctx.log("error", `Travel to station failed: ${tResp.error.message}`);
    return await emergencyFuelRecovery(ctx);
  }
  bot.poi = nearest.poiId;

  const dResp = await bot.exec("dock");
  if (!dResp.error || dResp.error.message.includes("already")) {
    bot.docked = true;
    await collectFromStorage(ctx);
  } else {
    ctx.log("error", `Dock failed: ${dResp.error.message}`);
    return await emergencyFuelRecovery(ctx);
  }

  await tryRefuel(ctx);
  await bot.refreshStatus();
  let newFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  ctx.log("system", `Refueled at ${nearest.poiName} — Fuel: ${newFuel}%`);

  // CRITICAL: Do NOT undock until fuel is adequate
  if (newFuel < thresholdPct) {
    ctx.log("system", `Fuel still below threshold (${newFuel}% < ${thresholdPct}%) — staying docked and waiting...`);
    for (let w = 0; w < REFUEL_WAIT_RETRIES && bot.state === "running"; w++) {
      await sleep(REFUEL_WAIT_INTERVAL);
      await bot.refreshStatus();
      await bot.exec("refuel");
      await bot.refreshStatus();
      newFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (newFuel >= thresholdPct) {
        ctx.log("system", `Fuel recovered to ${newFuel}% — resuming`);
        break;
      }
      ctx.log("system", `Still waiting for fuel (${newFuel}%)... (${w + 1}/${REFUEL_WAIT_RETRIES})`);
    }
  }

  await bot.refreshStatus();
  newFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  ctx.log("system", "Undocking...");
  await bot.exec("undock");
  bot.docked = false;
  return newFuel >= 10;
}

// ── Cargo deposit ──────────────────────────────────────────

/** Default home station for depositing cargo. */
const HOME_SYSTEM = "sol_star";
const HOME_STATION_POI = "sol_central";
const HOME_STATION_NAME = "Sol Central";

/**
 * Navigate to Sol Central and deposit all non-fuel cargo to station storage.
 * Used when cargo is full during exploration. Returns true if deposit succeeded.
 */
export async function depositCargoAtHome(
  ctx: RoutineContext,
  opts: { fuelThresholdPct: number; hullThresholdPct: number } = { fuelThresholdPct: 40, hullThresholdPct: 30 },
): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();

  ctx.log("trade", `Cargo full (${bot.cargo}/${bot.cargoMax}) — returning to ${HOME_STATION_NAME} to deposit...`);

  // Navigate to Sol if not already there
  if (bot.system !== HOME_SYSTEM) {
    await ensureUndocked(ctx);
    const arrived = await navigateToSystem(ctx, HOME_SYSTEM, opts);
    if (!arrived) {
      ctx.log("error", `Could not reach ${HOME_SYSTEM} — will try depositing at nearest station`);
      // Fallback: dock at any local station
      await ensureDocked(ctx);
      if (!bot.docked) return false;
      return await depositNonFuelCargo(ctx);
    }
  }

  // Travel to Sol Central station
  await ensureUndocked(ctx);
  if (bot.poi !== HOME_STATION_POI) {
    ctx.log("travel", `Traveling to ${HOME_STATION_NAME}...`);
    const tResp = await bot.exec("travel", { target_poi: HOME_STATION_POI });
    if (tResp.error && !tResp.error.message.includes("already")) {
      ctx.log("error", `Travel to ${HOME_STATION_NAME} failed: ${tResp.error.message}`);
      return false;
    }
    bot.poi = HOME_STATION_POI;
  }

  // Dock
  if (!bot.docked) {
    const dResp = await bot.exec("dock");
    if (dResp.error && !dResp.error.message.includes("already")) {
      ctx.log("error", `Dock failed at ${HOME_STATION_NAME}: ${dResp.error.message}`);
      return false;
    }
    bot.docked = true;
  }

  // Collect any gifted credits/items from storage
  await collectFromStorage(ctx);

  // Deposit cargo
  const deposited = await depositNonFuelCargo(ctx);

  // Refuel while we're here
  await tryRefuel(ctx);

  // Undock
  await ensureUndocked(ctx);

  return deposited;
}

/**
 * Deposit cargo at the nearest station in the current system.
 * If no station is present, falls back to `depositCargoAtHome` (Sol Central).
 * Returns true if deposit succeeded.
 */
export async function depositCargoLocal(
  ctx: RoutineContext,
  pois: SystemPOI[],
  opts: { fuelThresholdPct: number; hullThresholdPct: number } = { fuelThresholdPct: 40, hullThresholdPct: 30 },
): Promise<boolean> {
  const { bot } = ctx;
  const localStation = findStation(pois);

  if (!localStation) {
    ctx.log("trade", `No station in ${bot.system} — navigating to Sol Central to deposit...`);
    return depositCargoAtHome(ctx, opts);
  }

  ctx.log("trade", `Cargo near-full (${bot.cargo}/${bot.cargoMax}) — docking at ${localStation.name} to deposit...`);

  await ensureUndocked(ctx);
  if (bot.poi !== localStation.id) {
    const tResp = await bot.exec("travel", { target_poi: localStation.id });
    if (tResp.error && !tResp.error.message.includes("already")) {
      ctx.log("error", `Travel to ${localStation.name} failed: ${tResp.error.message} — falling back to Sol Central`);
      return depositCargoAtHome(ctx, opts);
    }
    bot.poi = localStation.id;
  }

  if (!bot.docked) {
    const dResp = await bot.exec("dock");
    if (dResp.error && !dResp.error.message.includes("already")) {
      ctx.log("error", `Dock failed at ${localStation.name}: ${dResp.error.message}`);
      return false;
    }
    bot.docked = true;
  }

  await collectFromStorage(ctx);
  const deposited = await depositNonFuelCargo(ctx);
  await tryRefuel(ctx);
  await ensureUndocked(ctx);

  if (deposited) ctx.log("trade", `Deposited cargo at ${localStation.name} — resuming exploration`);
  return deposited;
}

/** Deposit all non-fuel cargo to faction storage (shared pool). Assumes docked. Returns true if any items deposited. */
export async function depositNonFuelCargo(ctx: RoutineContext): Promise<boolean> {
  const { bot } = ctx;
  const cargoResp = await bot.exec("get_cargo");
  if (!cargoResp.result || typeof cargoResp.result !== "object") return false;

  const cResult = cargoResp.result as Record<string, unknown>;
  const cargoItems = (
    Array.isArray(cResult) ? cResult :
    Array.isArray(cResult.items) ? (cResult.items as Array<Record<string, unknown>>) :
    Array.isArray(cResult.cargo) ? (cResult.cargo as Array<Record<string, unknown>>) :
    []
  );

  // Pre-check cache: if faction storage is known-unavailable at this station, skip all faction attempts
  const cachedFac = bot.poi ? ctx.mapStore.hasFactionStorage(bot.poi) : null;
  let noFactionStorage = cachedFac === false;
  let deposited = 0;
  for (const item of cargoItems) {
    const itemId = (item.item_id as string) || "";
    const quantity = (item.quantity as number) || 0;
    if (!itemId || quantity <= 0) continue;
    const lower = itemId.toLowerCase();
    if (lower.includes("fuel") || lower.includes("energy_cell")) continue;

    const displayName = (item.name as string) || itemId;
    let usedFaction = false;
    if (!noFactionStorage) {
      const fResp = await bot.exec("faction_deposit_items", { item_id: itemId, quantity });
      if (!fResp.error) {
        if (bot.poi) ctx.mapStore.setFactionStorage(bot.poi, true);
        ctx.log("trade", `Deposited ${quantity}x ${displayName} to faction storage`);
        logFactionActivity(ctx, "deposit", `Deposited ${quantity}x ${displayName} to faction storage`);
        usedFaction = true;
      } else {
        const errCode = fResp.error.code ?? "";
        const errMsg = fResp.error.message ?? "";
        if (errCode === "no_faction_storage" || errMsg.includes("no_faction_storage") || errMsg.includes("faction_lockbox")) {
          noFactionStorage = true;
          if (bot.poi) ctx.mapStore.setFactionStorage(bot.poi, false);
        } else {
          ctx.log("trade", `Faction deposit failed for ${displayName}: ${errMsg}`);
        }
      }
    }
    if (!usedFaction) {
      await bot.exec("deposit_items", { item_id: itemId, quantity });
      ctx.log("trade", `Deposited ${quantity}x ${displayName} to station storage`);
    }
    deposited += quantity;
  }

  if (deposited > 0) {
    await bot.refreshCargo();
  }
  return deposited > 0;
}

/**
 * Pre-start cargo clearance — deposit any items in cargo that are not needed
 * for the current routine. Always keeps: fuel, energy_cell, ammo/ammunition.
 *
 * Navigates to the nearest station in the current system (or to homeSystem
 * if no local station is found). Deposits via faction storage first, falls
 * back to station storage.
 *
 * @returns List of deposited item descriptions (empty if nothing to clear).
 */
export async function clearStartupCargo(
  ctx: RoutineContext,
  opts: {
    /** Additional item_ids to preserve in cargo (e.g. craft materials, trade items). */
    keepItemIds?: Set<string>;
    /** "faction" tries faction_deposit_items first, falls back to station. "storage" goes straight to station. Default: "faction". */
    depositMode?: "faction" | "storage";
    /** System to navigate to if no station exists in the current system. */
    homeSystem?: string;
    /** Fuel % required for any cross-system travel. Default: 50. */
    fuelThresholdPct?: number;
    /** Hull % below which navigation is skipped. Default: 30. */
    hullThresholdPct?: number;
  },
): Promise<string[]> {
  const { bot } = ctx;
  const keepItemIds = opts.keepItemIds ?? new Set<string>();
  const depositMode = opts.depositMode ?? "faction";
  const homeSystem = opts.homeSystem || bot.system;
  const fuelThresholdPct = opts.fuelThresholdPct ?? 50;
  const hullThresholdPct = opts.hullThresholdPct ?? 30;

  await bot.refreshCargo();

  const KEEP_PATTERNS = ["fuel", "energy_cell", "ammo", "ammunition"];
  const toDeposit = bot.inventory.filter(item => {
    if (item.quantity <= 0) return false;
    const lower = (item.itemId || "").toLowerCase();
    if (KEEP_PATTERNS.some(p => lower.includes(p))) return false;
    if (keepItemIds.has(item.itemId)) return false;
    return true;
  });

  if (toDeposit.length === 0) return [];

  ctx.log("system", `Startup: clearing ${toDeposit.length} cargo type(s) before starting...`);

  // Find a station in the current system
  const { pois } = await getSystemInfo(ctx);
  let station = findStation(pois);

  if (!station && homeSystem && homeSystem !== bot.system) {
    ctx.log("travel", `Startup: no local station — navigating to ${homeSystem} to deposit cargo...`);
    await ensureUndocked(ctx);
    const fueled = await ensureFueled(ctx, fuelThresholdPct);
    if (!fueled) {
      ctx.log("error", "Startup: cannot refuel for cargo deposit trip — skipping clearance");
      return [];
    }
    const arrived = await navigateToSystem(ctx, homeSystem, { fuelThresholdPct, hullThresholdPct });
    if (!arrived) {
      ctx.log("error", `Startup: failed to reach ${homeSystem} — skipping cargo clearance`);
      return [];
    }
    const { pois: newPois } = await getSystemInfo(ctx);
    station = findStation(newPois);
  }

  if (!station) {
    ctx.log("error", "Startup: no station found for cargo deposit — skipping clearance");
    return [];
  }

  // Travel to station POI
  await ensureUndocked(ctx);
  if (bot.poi !== station.id) {
    const tResp = await bot.exec("travel", { target_poi: station.id });
    if (tResp.error && !tResp.error.message.includes("already")) {
      ctx.log("error", `Startup: travel to station failed: ${tResp.error.message}`);
      return [];
    }
    bot.poi = station.id;
  }

  await ensureDocked(ctx);
  if (!bot.docked) {
    ctx.log("error", "Startup: could not dock — skipping cargo clearance");
    return [];
  }

  // Deposit items
  const deposited: string[] = [];
  for (const item of toDeposit) {
    if (item.quantity <= 0) continue;
    let ok = false;
    if (depositMode === "faction") {
      const fResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      ok = !fResp.error;
    }
    if (!ok) {
      const sResp = await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      ok = !sResp.error;
    }
    if (ok) {
      deposited.push(`${item.quantity}x ${item.name}`);
    } else {
      ctx.log("error", `Startup: failed to deposit ${item.quantity}x ${item.name}`);
    }
  }

  if (deposited.length > 0) {
    ctx.log("system", `Startup: deposited ${deposited.join(", ")} — cargo cleared`);
    await bot.refreshCargo();
  }

  return deposited;
}

// ── Navigation ───────────────────────────────────────────────

/** Navigate to a target system via jump chain. Returns true if arrived. */
export async function navigateToSystem(
  ctx: RoutineContext,
  targetSystemId: string,
  opts: { fuelThresholdPct: number; hullThresholdPct: number; noJettison?: boolean; autoCloak?: boolean; onJump?: (jumpNumber: number) => Promise<boolean> },
): Promise<boolean> {
  const { bot } = ctx;
  const MAX_JUMPS = (readSettings().general?.maxJumps as number) || 20;

  await bot.refreshStatus();
  if (bot.system === targetSystemId) return true;

  // ── Upfront route feasibility check ──────────────────────────────────────
  // Query the server's find_route once upfront to get total jump count.
  // This avoids burning MAX_JUMPS iterations on an unreachable system.
  const localRoute = ctx.mapStore.findRoute(bot.system, targetSystemId);
  const localJumps = localRoute ? localRoute.length - 1 : 999;

  if (localJumps > MAX_JUMPS || !localRoute) {
    // Local map incomplete or route too long — verify with server
    const preflight = await bot.exec("find_route", { target_system: targetSystemId });
    const pfd = preflight.result as { found?: boolean; total_jumps?: number; route?: Array<{ system_id: string }> } | null;
    if (preflight.error || !pfd?.found) {
      ctx.log("error", `No route to ${targetSystemId} — cannot navigate`);
      return false;
    }
    const serverJumps = pfd.total_jumps ?? (pfd.route?.length ?? 0) - 1;
    if (serverJumps > MAX_JUMPS) {
      ctx.log("error", `Route to ${targetSystemId} requires ${serverJumps} jumps (max: ${MAX_JUMPS}) — skipping`);
      return false;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  for (let attempt = 0; attempt < MAX_JUMPS; attempt++) {
    await bot.refreshStatus();
    if (bot.system === targetSystemId) return true;

    // Plan route from current position
    const route = ctx.mapStore.findRoute(bot.system, targetSystemId);
    let nextSystem: string | null = null;

    if (route && route.length > 1) {
      nextSystem = route[1];
      ctx.log("travel", `Route: ${route.length - 1} jump${route.length - 1 !== 1 ? "s" : ""} remaining`);
    } else {
      ctx.log("travel", `No mapped route — querying server for route to ${targetSystemId}`);
      const routeResp = await bot.exec("find_route", { target_system: targetSystemId });
      const routeData = routeResp.result as { found?: boolean; route?: Array<{ system_id: string; name: string }>; total_jumps?: number } | null;
      if (!routeResp.error && routeData?.found && routeData.route && routeData.route.length > 1) {
        nextSystem = routeData.route[1].system_id;
        ctx.log("travel", `Server route: ${routeData.total_jumps} jump${routeData.total_jumps !== 1 ? "s" : ""} — next: ${nextSystem}`);
      } else {
        ctx.log("error", `No route to ${targetSystemId} — cannot navigate`);
        return false;
      }
    }

    // Hull check — repair immediately if <= 40%
    const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    if (hullPct <= 40) {
      ctx.log("system", `Hull critical (${hullPct}%) — finding station for repair`);
      const docked = await ensureDocked(ctx);
      if (docked) {
        await repairShip(ctx);
        await ensureUndocked(ctx);
      } else if (hullPct === 0) {
        ctx.log("error", "Hull at 0% and no station found — cannot continue safely");
        return false;
      }
    }

    // Fuel check — MUST have adequate fuel before jumping
    const fueled = await ensureFueled(ctx, Math.max(opts.fuelThresholdPct, 25), { noJettison: opts.noJettison });
    if (!fueled) {
      ctx.log("error", "Cannot secure fuel for jump — aborting navigation");
      return false;
    }

    // Re-check in case ensureFueled moved us
    await bot.refreshStatus();
    if (bot.system === targetSystemId) return true;

    await ensureUndocked(ctx);

    // Jump
    ctx.log("travel", `Jumping to ${nextSystem}...`);
    const jumpResp = await bot.exec("jump", { target_system: nextSystem });
    if (jumpResp.error) {
      ctx.log("error", `Jump failed: ${jumpResp.error.message}`);
      return false;
    }

    await bot.refreshStatus();

    // Update map data for the new system
    const sysResp = await bot.exec("get_system");
    if (sysResp.result && typeof sysResp.result === "object") {
      parseSystemData(sysResp.result as Record<string, unknown>, ctx.mapStore);
    }

    // Auto-cloak in dangerous systems
    if (opts.autoCloak) {
      await autoCloakIfDangerous(ctx);
    }

    // Call onJump validation callback (e.g., mid-route trade validation)
    if (opts.onJump) {
      const shouldContinue = await opts.onJump(attempt + 1);
      if (!shouldContinue) return false;
    }

    ctx.log("travel", `Arrived in ${bot.system}`);
    if (bot.system === targetSystemId) return true;
    if (bot.state !== "running") return false;
  }

  ctx.log("error", `Failed to reach ${targetSystemId} after ${MAX_JUMPS} jumps`);
  return false;
}

/** Refuel at a specific station POI if fuel is below threshold. Handles travel/dock/undock.
 *  Returns true if successfully refueled, false if stranded. */
export async function refuelAtStation(
  ctx: RoutineContext,
  station: { id: string; name: string },
  thresholdPct: number,
): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();
  const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (fuelPct >= thresholdPct) return true;

  ctx.log("system", `Fuel low (${fuelPct}%) — refueling at ${station.name}...`);

  if (bot.poi !== station.id) {
    ctx.log("travel", `Traveling to ${station.name} for fuel...`);
    const travelResp = await bot.exec("travel", { target_poi: station.id });
    if (travelResp.error) {
      const msg = travelResp.error.message.toLowerCase();
      if (msg.includes("fuel") || msg.includes("no_fuel")) {
        ctx.log("error", `Can't travel to station — no fuel!`);
        return await emergencyFuelRecovery(ctx);
      }
      ctx.log("error", `Travel to station failed: ${travelResp.error.message}`);
      return false;
    }
    bot.poi = station.id;
  }

  if (!bot.docked) {
    const dockResp = await bot.exec("dock");
    if (dockResp.error && !dockResp.error.message.includes("already")) {
      ctx.log("error", `Dock failed: ${dockResp.error.message}`);
      return await emergencyFuelRecovery(ctx);
    }
    bot.docked = true;
  }

  // Collect any gifted credits/items (may help pay for fuel)
  await collectFromStorage(ctx);

  await tryRefuel(ctx);

  // Verify refuel actually worked — do NOT undock if fuel is dangerously low
  await bot.refreshStatus();
  let newFuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (newFuelPct < thresholdPct) {
    ctx.log("system", `Fuel still at ${newFuelPct}% after refuel — waiting at ${station.name}...`);
    for (let w = 0; w < REFUEL_WAIT_RETRIES && bot.state === "running"; w++) {
      await sleep(REFUEL_WAIT_INTERVAL);
      await bot.refreshStatus();
      await bot.exec("refuel");
      await bot.refreshStatus();
      newFuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (newFuelPct >= thresholdPct) {
        ctx.log("system", `Fuel recovered to ${newFuelPct}% — resuming`);
        break;
      }
      ctx.log("system", `Still waiting for fuel (${newFuelPct}%)... (${w + 1}/${REFUEL_WAIT_RETRIES})`);
    }
  }

  await bot.refreshStatus();
  newFuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
  if (newFuelPct < thresholdPct) {
    ctx.log("error", `Fuel still at ${newFuelPct}% after all retries — cannot proceed. Staying docked at ${station.name}.`);
    return false;
  }

  ctx.log("system", "Undocking...");
  await bot.exec("undock");
  bot.docked = false;
  return true;
}

// ── Security ─────────────────────────────────────────────────

/** Try to fetch security level from get_system and update mapStore. */
export async function fetchSecurityLevel(ctx: RoutineContext, systemId: string): Promise<void> {
  const { bot } = ctx;
  const locResp = await bot.exec("get_system");
  if (!locResp.result || typeof locResp.result !== "object") return;

  const loc = locResp.result as Record<string, unknown>;
  const locSys = (loc.system as Record<string, unknown> | undefined) ?? loc;
  const secLevel = (locSys?.security_level as string) || (locSys?.security_status as string)
    || (locSys?.lawfulness as string) || (locSys?.security as string)
    || (loc.security_level as string) || (loc.security_status as string)
    || (loc.security as string);

  if (secLevel) {
    const stored = ctx.mapStore.getSystem(systemId);
    if (stored && !stored.security_level) {
      ctx.mapStore.updateSystem({ id: systemId, security_level: secLevel } as Record<string, unknown>);
      ctx.log("info", `Security level for ${systemId}: ${secLevel}`);
    }
  }
}

// ── Scavenging ──────────────────────────────────────────────

/** Items worth looting from wrecks (prioritize fuel cells). */
const LOOT_PRIORITY = ["fuel_cell", "fuel", "energy_cell"];

interface WreckItem {
  item_id: string;
  name: string;
  quantity: number;
}

interface Wreck {
  wreck_id: string;
  name: string;
  items: WreckItem[];
}

/** Parse wreck list from get_wrecks response. */
function parseWrecks(result: unknown): Wreck[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const rawList = (
    Array.isArray(r) ? r :
    Array.isArray(r.wrecks) ? r.wrecks :
    Array.isArray(r.containers) ? r.containers :
    []
  ) as Array<Record<string, unknown>>;

  return rawList.map(w => {
    const rawItems = (
      Array.isArray(w.items) ? w.items :
      Array.isArray(w.cargo) ? w.cargo :
      Array.isArray(w.contents) ? w.contents :
      []
    ) as Array<Record<string, unknown>>;

    return {
      wreck_id: (w.wreck_id as string) || (w.id as string) || "",
      name: (w.name as string) || (w.type as string) || "wreck",
      items: rawItems.map(i => ({
        item_id: (i.item_id as string) || (i.id as string) || "",
        name: (i.name as string) || (i.item_id as string) || "",
        quantity: (i.quantity as number) || 1,
      })).filter(i => i.item_id),
    };
  }).filter(w => w.wreck_id);
}

/**
 * Check for wrecks/containers at current POI and loot useful items.
 * Prioritizes fuel cells, then loots everything if cargo space allows.
 * Returns number of items looted.
 */
export async function scavengeWrecks(ctx: RoutineContext, opts?: { fuelOnly?: boolean }): Promise<number> {
  const { bot } = ctx;
  if (bot.docked) return 0; // can't scavenge while docked

  // Skip if cargo is already full or nearly full (less than 5 free)
  await bot.refreshStatus();
  if (bot.cargoMax > 0 && bot.cargoMax - bot.cargo < 5) return 0;

  const fuelOnly = opts?.fuelOnly ?? false;

  const wrecksResp = await bot.exec("get_wrecks");
  const wrecks = parseWrecks(wrecksResp.result);
  if (wrecks.length === 0) return 0;

  let totalLooted = 0;
  const lootedItems: string[] = [];
  let cargoFull = false;

  for (const wreck of wrecks) {
    if (bot.state !== "running") break;
    if (cargoFull) break; // no point trying more wrecks

    // Check cargo space
    await bot.refreshStatus();
    if (bot.cargoMax > 0 && bot.cargo >= bot.cargoMax) {
      ctx.log("scavenge", "Cargo full — stopping scavenge");
      break;
    }

    if (wreck.items.length === 0) {
      continue;
    }

    // Filter to fuel items only when fuelOnly is set
    let candidates = [...wreck.items];
    if (fuelOnly) {
      candidates = candidates.filter(i =>
        LOOT_PRIORITY.some(p => i.item_id.toLowerCase().includes(p))
      );
      if (candidates.length === 0) continue;
    }

    // Sort: fuel cells first, then everything else
    candidates.sort((a, b) => {
      const aPri = LOOT_PRIORITY.some(p => a.item_id.includes(p)) ? 0 : 1;
      const bPri = LOOT_PRIORITY.some(p => b.item_id.includes(p)) ? 0 : 1;
      return aPri - bPri;
    });

    for (const item of candidates) {
      if (bot.state !== "running") break;
      if (bot.cargoMax > 0 && bot.cargo >= bot.cargoMax) break;

      const lootResp = await bot.exec("loot_wreck", {
        wreck_id: wreck.wreck_id,
        item_id: item.item_id,
        quantity: item.quantity,
      });

      if (lootResp.error) {
        const errMsg = lootResp.error.message.toLowerCase();
        if (errMsg.includes("no_space") || errMsg.includes("not enough cargo") || errMsg.includes("cargo space")) {
          cargoFull = true; // stop looting all wrecks — cargo is full
          break;
        }
        if (errMsg.includes("empty") || errMsg.includes("not found") || errMsg.includes("not in wreck")) {
          break; // wreck gone or empty
        }
        continue;
      }

      totalLooted++;
      lootedItems.push(`${item.quantity}x ${item.name}`);
    }
  }

  if (totalLooted > 0) {
    await bot.refreshCargo();
    ctx.log("scavenge", `Scavenged ${lootedItems.join(", ")} from ${wrecks.length} wreck(s)`);
  }

  return totalLooted;
}

/**
 * Full wreck salvage chain: loot_wreck in field + optional tow_wreck.
 * salvage_wreck and scrap_wreck are no longer available in-field (use_tow error);
 * they must be called at a salvage yard station after towing.
 * Returns total items looted.
 */
export async function fullSalvageWrecks(
  ctx: RoutineContext,
  opts?: { fuelOnly?: boolean; enableTow?: boolean; minTowValue?: number },
): Promise<number> {
  const { bot } = ctx;
  if (bot.docked) return 0;

  const enableTow = opts?.enableTow ?? false;
  const fuelOnly = opts?.fuelOnly ?? false;

  const wrecksResp = await bot.exec("get_wrecks");
  const wrecks = parseWrecks(wrecksResp.result);
  if (wrecks.length === 0) return 0;

  let totalExtracted = 0;
  const extractedItems: string[] = [];
  let alreadyTowing = false;

  for (const wreck of wrecks) {
    if (bot.state !== "running") break;

    await bot.refreshStatus();
    if (bot.cargoMax > 0 && bot.cargo >= bot.cargoMax) {
      ctx.log("scavenge", "Cargo full — stopping salvage");
      break;
    }

    // Step 1: Loot all items from the wreck (loot_wreck still works in-field)
    if (wreck.items.length > 0) {
      let candidates = [...wreck.items];
      if (fuelOnly) {
        candidates = candidates.filter(i =>
          LOOT_PRIORITY.some(p => i.item_id.toLowerCase().includes(p))
        );
      }

      candidates.sort((a, b) => {
        const aPri = LOOT_PRIORITY.some(p => a.item_id.includes(p)) ? 0 : 1;
        const bPri = LOOT_PRIORITY.some(p => b.item_id.includes(p)) ? 0 : 1;
        return aPri - bPri;
      });

      for (const item of candidates) {
        if (bot.state !== "running") break;
        if (bot.cargoMax > 0 && bot.cargo >= bot.cargoMax) break;

        const lootResp = await bot.exec("loot_wreck", {
          wreck_id: wreck.wreck_id,
          item_id: item.item_id,
          quantity: item.quantity,
        });

        if (lootResp.error) {
          const msg = lootResp.error.message.toLowerCase();
          if (msg.includes("empty") || msg.includes("not found")) break;
          continue;
        }

        totalExtracted++;
        extractedItems.push(`${item.quantity}x ${item.name}`);
      }
    }

    // Step 2: Tow wreck to salvage yard (one at a time; sell_wreck/scrap_wreck at station)
    if (enableTow && !alreadyTowing) {
      const towResp = await bot.exec("tow_wreck", { wreck_id: wreck.wreck_id });
      if (!towResp.error) {
        ctx.log("scavenge", `Towing wreck: ${wreck.name} — will process at salvage yard`);
        alreadyTowing = true;
        break; // head to station with towed wreck
      }
    }
  }

  if (totalExtracted > 0) {
    await bot.refreshCargo();
    ctx.log("scavenge", `Looted ${totalExtracted} items from ${wrecks.length} wreck(s)`);
  }

  return totalExtracted;
}

// ── Role-Based Mods ──────────────────────────────────────────

/**
 * Get the desired mod profile for a routine from settings.
 * Returns [] if autoFitMods is disabled or no profile configured.
 */
export function getModProfile(routineName: string): string[] {
  const all = readSettings();
  if ((all.general?.autoFitMods as boolean) === false) return [];
  const profiles = (all.general?.modProfiles as Record<string, string[]>) || {};
  return Array.isArray(profiles[routineName]) ? profiles[routineName] : [];
}

/**
 * Ensure the bot's ship has the desired mods installed.
 * Uninstalls unwanted mods and installs missing ones.
 * Requires docked at a station with shipyard service.
 */
export async function ensureModsFitted(
  ctx: RoutineContext,
  desiredMods: string[],
): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked || desiredMods.length === 0) return;

  // Check if current station has shipyard
  const { pois } = await getSystemInfo(ctx);
  const currentStation = pois.find(p => isStationPoi(p) && p.id === bot.poi);
  if (currentStation && !stationHasService(currentStation, "shipyard")) return;

  const installed = await bot.refreshShipMods();
  const desiredSet = new Set(desiredMods);
  const installedSet = new Set(installed);

  // Uninstall mods not in the desired set
  for (const mod of installed) {
    if (!desiredSet.has(mod)) {
      const resp = await bot.exec("uninstall_mod", { module_id: mod });
      if (!resp.error) {
        ctx.log("system", `Uninstalled mod: ${mod}`);
      }
    }
  }

  // Install missing desired mods
  for (const mod of desiredMods) {
    if (!installedSet.has(mod)) {
      const resp = await bot.exec("install_mod", { module_id: mod });
      if (!resp.error) {
        ctx.log("system", `Installed mod: ${mod}`);
      } else {
        const msg = resp.error.message.toLowerCase();
        if (!msg.includes("already") && !msg.includes("not found") && !msg.includes("no slot")) {
          ctx.log("error", `Failed to install mod ${mod}: ${resp.error.message}`);
        }
      }
    }
  }
}

// ── Cloaking ─────────────────────────────────────────────────

/** Check if a system's security level is dangerous (low-sec, null-sec, lawless, etc.). */
export function isDangerousSystem(securityLevel: string | undefined): boolean {
  if (!securityLevel) return false;
  const level = securityLevel.toLowerCase().trim();

  if (level.includes("low") || level === "null" || level.includes("unregulated") ||
      level.includes("lawless") || level.includes("frontier") || level.includes("minimal")) {
    return true;
  }

  const numeric = parseInt(level, 10);
  if (!isNaN(numeric)) return numeric <= 25;

  return false;
}

/**
 * Auto-cloak if in a dangerous system. Skips if already cloaked, docked, or no cloak module.
 * Returns true if now cloaked, false otherwise.
 */
export async function autoCloakIfDangerous(ctx: RoutineContext): Promise<boolean> {
  const { bot } = ctx;
  if (bot.isCloaked || bot.docked) return bot.isCloaked;

  const sys = ctx.mapStore.getSystem(bot.system);
  if (!sys || !isDangerousSystem(sys.security_level)) return false;

  const resp = await bot.exec("cloak");
  if (!resp.error) {
    bot.isCloaked = true;
    ctx.log("system", `Cloaked in ${bot.system} (${sys.security_level})`);
    return true;
  }

  const msg = resp.error.message.toLowerCase();
  if (msg.includes("already cloaked") || msg.includes("already_cloaked")) {
    bot.isCloaked = true;
    return true;
  }
  // No cloak module or other error — gracefully skip
  return false;
}

// ── Insurance ────────────────────────────────────────────────

/** Minimum credits to keep when buying insurance. */
const INSURANCE_CREDIT_FLOOR = 500;

/**
 * Universal auto-insure: buy insurance if docked at a station with the service.
 * Checks `general.autoInsure` setting (default: true).
 * Skips if already insured, can't afford, or no insurance service.
 */
export async function ensureInsured(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;

  const all = readSettings();
  if ((all.general?.autoInsure as boolean) === false) return;

  const { pois } = await getSystemInfo(ctx);
  const currentStation = pois.find(p => isStationPoi(p) && p.id === bot.poi);
  if (currentStation && !stationHasService(currentStation, "insurance")) return;

  const quoteResp = await bot.exec("get_insurance_quote");
  if (quoteResp.error || !quoteResp.result) return;

  const q = quoteResp.result as Record<string, unknown>;
  const quoteObj = (q.quote as Record<string, unknown>) ?? q;

  // Already insured?
  const insured = (quoteObj.insured as boolean) ?? (q.insured as boolean) ?? false;
  if (insured) return;

  const cost = (quoteObj.cost as number) || (quoteObj.premium as number) || (quoteObj.price as number) || 0;
  if (cost <= 0) return;

  if (bot.credits < cost + INSURANCE_CREDIT_FLOOR) {
    ctx.log("info", `Insurance: can't afford ${cost}cr (need ${INSURANCE_CREDIT_FLOOR}cr floor) — skipping`);
    return;
  }

  const insureResp = await bot.exec("buy_insurance");
  if (!insureResp.error) {
    ctx.log("info", `Insurance purchased for ${cost}cr`);
    await bot.refreshStatus();
  } else if (insureResp.error.message.toLowerCase().includes("already")) {
    // silently skip
  }
}

/**
 * Detect death (hull=0) and attempt recovery: claim insurance, dock, refuel, repair, re-insure.
 * Returns true if alive/recovered, false if stuck dead.
 */
export async function detectAndRecoverFromDeath(ctx: RoutineContext): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();

  if (bot.hull > 0 && !bot.isDead) return true; // alive

  ctx.log("system", "DEATH DETECTED — hull at 0. Attempting insurance claim...");

  // Claim insurance
  const claimResp = await bot.exec("claim_insurance");
  if (!claimResp.error && claimResp.result) {
    const r = claimResp.result as Record<string, unknown>;
    const payout = (r.payout as number) || (r.credits as number) || 0;
    if (payout > 0) ctx.log("info", `Insurance payout: ${payout}cr`);
  }

  // Refresh — we may have respawned
  await bot.refreshStatus();

  if (bot.hull <= 0 && bot.maxHull > 0) {
    ctx.log("error", "Still dead after insurance claim — waiting for respawn...");
    // Wait up to 60s for respawn
    for (let i = 0; i < 6; i++) {
      await sleep(10_000);
      await bot.refreshStatus();
      if (bot.hull > 0) break;
    }
    if (bot.hull <= 0 && bot.maxHull > 0) {
      ctx.log("error", "Could not recover from death — stuck");
      return false;
    }
  }

  bot.isDead = false;
  ctx.log("system", "Respawned — recovering...");

  // Try to dock, refuel, repair, re-insure
  if (bot.docked) {
    await tryRefuel(ctx);
    await repairShip(ctx);
    await ensureInsured(ctx);
  } else {
    const docked = await ensureDocked(ctx);
    if (docked) {
      await tryRefuel(ctx);
      await repairShip(ctx);
      await ensureInsured(ctx);
    }
  }

  await bot.refreshStatus();
  ctx.log("system", `Recovery complete — hull: ${bot.hull}/${bot.maxHull}, credits: ${bot.credits}`);
  return true;
}

// ── Settings ─────────────────────────────────────────────────

/** Read settings from data/settings.json. */
export function readSettings(): Record<string, Record<string, unknown>> {
  try {
    const { readFileSync, existsSync } = require("fs");
    const { join } = require("path");
    const file = join(process.cwd(), "data", "settings.json");
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, "utf-8"));
    }
  } catch { /* use defaults */ }
  return {};
}

/** Write settings to data/settings.json. Merges with existing settings. */
export function writeSettings(updates: Record<string, Record<string, unknown>>): void {
  const { writeFileSync, existsSync, mkdirSync, readFileSync } = require("fs");
  const { join } = require("path");
  const dir = join(process.cwd(), "data");
  const file = join(dir, "settings.json");

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing: Record<string, Record<string, unknown>> = {};
  try {
    if (existsSync(file)) {
      existing = JSON.parse(readFileSync(file, "utf-8"));
    }
  } catch { /* start fresh */ }

  // Deep merge: update each routine section
  for (const [key, val] of Object.entries(updates)) {
    existing[key] = { ...(existing[key] || {}), ...val };
  }

  writeFileSync(file, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}

// ── Utilities ────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Log an entry to the faction activity log. Types: deposit, withdraw, donation, gift */
export function logFactionActivity(ctx: RoutineContext, type: string, message: string): void {
  const { bot } = ctx;
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  const line = `${timestamp} [${type}] ${bot.username}: ${message}`;
  bot.emit("factionLog", bot.username, line);
}

/** Log a status summary line. */
export function logStatus(ctx: RoutineContext): void {
  const { bot } = ctx;
  const fuelPct = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : bot.fuel;
  const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
  ctx.log("info", `Credits: ${bot.credits} | Fuel: ${fuelPct}% | Hull: ${hullPct}% | Cargo: ${bot.cargo}/${bot.cargoMax} | System: ${bot.system} | Docked: ${bot.docked}`);
}

/** Minimum credits a bot must keep before donating to faction. */
const FACTION_DONATE_FLOOR = 1000;

/**
 * Donate a configurable % of profit to the faction treasury.
 * Reads `general.factionDonatePct` from settings (default 10).
 * Bot retains at least 1000 credits after donation.
 */
export async function factionDonateProfit(ctx: RoutineContext, profit: number): Promise<void> {
  if (profit <= 0) return;
  const all = readSettings();
  const pct = (all.general?.factionDonatePct as number) ?? 10;
  if (pct <= 0) return;
  const { bot } = ctx;
  const donation = Math.floor(profit * (pct / 100));
  if (donation <= 0) return;
  if (bot.credits - donation < FACTION_DONATE_FLOOR) return;
  const resp = await bot.exec("faction_deposit_credits", { amount: donation });
  if (!resp.error) {
    ctx.log("trade", `Donated ${donation}cr to faction treasury (${pct}% of ${profit}cr profit)`);
    logFactionActivity(ctx, "donation", `Deposited ${donation}cr (${pct}% of ${profit}cr profit)`);
  }
}

/**
 * Post a structured event to the game's agentLogs endpoint (fire-and-forget).
 * Used for key bot milestones: kills, profitable trades, mining trips, etc.
 *
 * @param category - e.g. "combat", "economy", "navigation"
 * @param severity  - "info" | "warn" | "error"
 * @param message   - human-readable description of the event
 * @param data      - optional structured payload
 */
export function logAgentEvent(
  ctx: RoutineContext,
  category: string,
  severity: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  const { bot } = ctx;
  bot.exec("agentLogs", {
    category,
    severity,
    message,
    system_id: bot.system || undefined,
    poi_id: bot.poi || undefined,
    ...(data ? { data } : {}),
  }).catch(() => {});
}
