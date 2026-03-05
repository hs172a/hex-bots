/**
 * Hunter routine — patrols a system hunting pirate NPCs for bounties and loot.
 *
 * Loop:
 *   1. Navigate to configured patrol system
 *   2. Visit each non-station POI looking for pirate targets
 *   3. Scan -> engage -> loot each target
 *   4. Flee and dock if hull drops below flee threshold
 *   5. Post-patrol: complete missions, sell loot, accept new missions,
 *      insure ship, refuel, repair
 *
 * Combat stances:
 *   - Fire   (default): 100% damage dealt/taken
 *   - Brace  (shields critical): 0% damage dealt, shields regen 2x — use briefly to recover
 *   - Flee   (hull critical): auto-retreat — triggers when hull <= fleeThreshold
 *
 * Settings (data/settings.json under "hunter"):
 *   system          — system ID to patrol (default: current system)
 *   refuelThreshold — fuel % to trigger refuel stop (default: 40)
 *   repairThreshold — hull % to abort patrol and dock (default: 30)
 *   fleeThreshold   — hull % to flee an active fight (default: 20)
 *   onlyNPCs        — only attack NPC pirates, never players (default: true)
 */

import type { Routine, RoutineContext } from "../bot.js";
import type { MapStore } from "../mapstore.js";
import {
  findStation,
  isStationPoi,
  getSystemInfo,
  collectFromStorage,
  ensureDocked,
  ensureUndocked,
  tryRefuel,
  repairShip,
  ensureFueled,
  navigateToSystem,
  fetchSecurityLevel,
  scavengeWrecks,
  depositNonFuelCargo,
  clearStartupCargo,
  ensureInsured,
  detectAndRecoverFromDeath,
  getModProfile,
  ensureModsFitted,
  readSettings,
  sleep,
  logStatus,
  logAgentEvent,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

function getHunterSettings(username?: string): {
  system: string;
  refuelThreshold: number;
  repairThreshold: number;
  fleeThreshold: number;
  onlyNPCs: boolean;
  autoCloak: boolean;
  ammoThreshold: number;
  maxReloadAttempts: number;
  responseRange: number;
  preferredStance: string;
  retreatHpPct: number;
  autoDefend: boolean;
} {
  const all = readSettings();
  const h = all.hunter || {};
  const botOverrides = username ? (all[username] || {}) : {};

  return {
    system: (botOverrides.system as string) || (h.system as string) || "",
    refuelThreshold: (h.refuelThreshold as number) || 40,
    repairThreshold: (h.repairThreshold as number) || 30,
    fleeThreshold: (h.fleeThreshold as number) || 20,
    onlyNPCs: (h.onlyNPCs as boolean) !== false,
    autoCloak: (h.autoCloak as boolean) ?? false,
    ammoThreshold: (h.ammoThreshold as number) || 5,
    maxReloadAttempts: (h.maxReloadAttempts as number) || 3,
    responseRange: (h.responseRange as number) ?? 3,
    preferredStance: (h.preferredStance as string) || "fire",
    retreatHpPct: (h.retreatHpPct as number) || 20,
    autoDefend: (h.autoDefend as boolean) ?? true,
  };
}

// ── Security level helpers ────────────────────────────────────

function isHuntableSystem(securityLevel: string | undefined): boolean {
  if (!securityLevel) return false;
  const level = securityLevel.toLowerCase().trim();

  if (level.includes("low") || level.includes("frontier") ||
      level.includes("lawless") || level.includes("null") ||
      level.includes("unregulated") || level.includes("minimal")) return true;

  if (level.includes("high") || level.includes("medium") ||
      level.includes("maximum") || level.includes("empire")) return false;

  const numeric = parseInt(level, 10);
  if (!isNaN(numeric)) return numeric <= 25;

  return false;
}

function findNearestHuntableSystem(fromSystemId: string, ms: MapStore): string | null {
  // Phase 1: BFS through stored connections
  const visited = new Set<string>([fromSystemId]);
  const queue: string[] = [fromSystemId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const conn of ms.getConnections(current)) {
      if (visited.has(conn.system_id)) continue;
      visited.add(conn.system_id);

      const secLevel = conn.security_level || ms.getSystem(conn.system_id)?.security_level;
      if (isHuntableSystem(secLevel)) return conn.system_id;

      queue.push(conn.system_id);
    }
  }

  // Phase 2: scan all known systems
  for (const systemId of ms.getAllSystemIds()) {
    if (visited.has(systemId)) continue;
    const sys = ms.getSystem(systemId);
    if (!sys || !isHuntableSystem(sys.security_level)) continue;
    if (ms.findRoute(fromSystemId, systemId)) return systemId;
  }

  return null;
}

function isSafeSystem(securityLevel: string | undefined): boolean {
  if (!securityLevel) return false;
  const level = securityLevel.toLowerCase().trim();

  if (level.includes("high") || level.includes("maximum") ||
      level.includes("empire")) return true;

  if (level.includes("low") || level.includes("frontier") ||
      level.includes("lawless") || level.includes("null") ||
      level.includes("unregulated") || level.includes("medium") ||
      level.includes("minimal")) return false;

  const numeric = parseInt(level, 10);
  if (!isNaN(numeric)) return numeric > 50;
  return false;
}

function findNearestSafeSystem(fromSystemId: string, ms: MapStore): string | null {
  const visited = new Set<string>([fromSystemId]);
  const queue: string[] = [fromSystemId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const conn of ms.getConnections(current)) {
      if (visited.has(conn.system_id)) continue;
      visited.add(conn.system_id);

      const secLevel = conn.security_level || ms.getSystem(conn.system_id)?.security_level;
      if (isSafeSystem(secLevel)) return conn.system_id;

      queue.push(conn.system_id);
    }
  }
  return null;
}

// ── Nearby entity parsing ─────────────────────────────────────

interface NearbyEntity {
  id: string;
  name: string;
  type: string;
  faction: string;
  isNPC: boolean;
  isPirate: boolean;
}

function parseNearby(result: unknown): NearbyEntity[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const raw = (
    Array.isArray(r) ? r :
    Array.isArray(r.entities) ? r.entities :
    Array.isArray(r.players) ? r.players :
    Array.isArray(r.nearby) ? r.nearby :
    []
  ) as Array<Record<string, unknown>>;

  return raw
    .map(e => {
      const isPirate = !!(e.pirate_id);
      const id = (e.id as string) || (e.player_id as string) || (e.entity_id as string) || (e.pirate_id as string) || "";
      const faction = ((e.faction as string) || (e.faction_id as string) || "").toLowerCase();
      const type = ((e.type as string) || (e.entity_type as string) || "").toLowerCase();
      const isNPC = isPirate || !!(e.is_npc) || type === "npc" || type === "pirate" || type === "enemy";
      return {
        id,
        name: (e.name as string) || (e.username as string) || (e.pirate_name as string) || id,
        type,
        faction,
        isNPC,
        isPirate,
      };
    })
    .filter(e => e.id);
}

const PIRATE_KEYWORDS = ["pirate", "raider", "outlaw", "bandit", "corsair", "marauder", "hostile"];

function isPirateTarget(entity: NearbyEntity, onlyNPCs: boolean): boolean {
  if (entity.isPirate) return true;
  if (onlyNPCs && !entity.isNPC) return false;
  const factionMatch = PIRATE_KEYWORDS.some(kw => entity.faction.includes(kw));
  const typeMatch = PIRATE_KEYWORDS.some(kw => entity.type.includes(kw));
  const nameMatch = PIRATE_KEYWORDS.some(kw => entity.name.toLowerCase().includes(kw));
  return factionMatch || typeMatch || (entity.isNPC && nameMatch);
}

// ── Mission helpers ───────────────────────────────────────────

const COMBAT_MISSION_KEYWORDS = [
  "bounty", "pirate", "hunt", "kill", "eliminate", "destroy",
  "combat", "hostile", "contract", "patrol", "neutralize",
];

async function checkAndAcceptMissions(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;

  const activeResp = await bot.exec("get_active_missions");
  let activeCount = 0;
  if (activeResp.result && typeof activeResp.result === "object") {
    const r = activeResp.result as Record<string, unknown>;
    const list = Array.isArray(r) ? r : Array.isArray(r.missions) ? r.missions : [];
    activeCount = (list as unknown[]).length;
  }
  if (activeCount >= 5) return;

  const availResp = await bot.exec("get_missions");
  if (!availResp.result || typeof availResp.result !== "object") return;

  const r = availResp.result as Record<string, unknown>;
  const available = (
    Array.isArray(r) ? r :
    Array.isArray(r.missions) ? r.missions :
    []
  ) as Array<Record<string, unknown>>;

  for (const mission of available) {
    if (activeCount >= 5) break;

    const missionId = (mission.id as string) || (mission.mission_id as string) || "";
    if (!missionId) continue;

    const name = ((mission.name as string) || "").toLowerCase();
    const desc = ((mission.description as string) || "").toLowerCase();
    const type = ((mission.type as string) || "").toLowerCase();

    if (!COMBAT_MISSION_KEYWORDS.some(kw => name.includes(kw) || desc.includes(kw) || type.includes(kw))) continue;

    const acceptResp = await bot.exec("accept_mission", { mission_id: missionId });
    if (!acceptResp.error) {
      activeCount++;
      ctx.log("info", `Mission accepted: ${(mission.name as string) || missionId} (${activeCount}/5 active)`);
    }
  }
}

async function completeActiveMissions(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;

  const activeResp = await bot.exec("get_active_missions");
  if (!activeResp.result || typeof activeResp.result !== "object") return;

  const r = activeResp.result as Record<string, unknown>;
  const missions = (
    Array.isArray(r) ? r :
    Array.isArray(r.missions) ? r.missions :
    []
  ) as Array<Record<string, unknown>>;

  for (const mission of missions) {
    const missionId = (mission.id as string) || (mission.mission_id as string) || "";
    if (!missionId) continue;

    const completeResp = await bot.exec("complete_mission", { mission_id: missionId });
    if (!completeResp.error) {
      const reward = (mission.reward as number) || (mission.reward_credits as number) || 0;
      ctx.log("trade", `Mission complete: ${(mission.name as string) || missionId}${reward > 0 ? ` (+${reward} credits)` : ""}`);
      await bot.refreshStatus();
    }
  }
}

// ── Safe-system docking ───────────────────────────────────────

async function navigateToSafeStation(ctx: RoutineContext, safetyOpts: { fuelThresholdPct: number; hullThresholdPct: number }): Promise<boolean> {
  const { bot } = ctx;

  const currentSec = ctx.mapStore.getSystem(bot.system)?.security_level;
  if (!isSafeSystem(currentSec)) {
    const safeSystem = findNearestSafeSystem(bot.system, ctx.mapStore);
    if (safeSystem) {
      const sys = ctx.mapStore.getSystem(safeSystem);
      ctx.log("travel", `Heading to safe system ${sys?.name || safeSystem} (${sys?.security_level}) for repairs...`);
      const arrived = await navigateToSystem(ctx, safeSystem, safetyOpts);
      if (!arrived) {
        ctx.log("error", "Could not reach safe system — attempting local dock");
      }
    } else {
      ctx.log("info", "No safe system mapped yet — docking locally");
    }
  }

  const sysInfo = await getSystemInfo(ctx);
  const station = findStation(sysInfo.pois, "repair") || findStation(sysInfo.pois);
  if (station) {
    ctx.log("travel", `Traveling to ${station.name}...`);
    const tResp = await bot.exec("travel", { target_poi: station.id });
    if (tResp.error && !tResp.error.message.includes("already")) {
      ctx.log("error", `Travel to station failed: ${tResp.error.message}`);
    }
    bot.poi = station.id;
  } else {
    ctx.log("error", `No station found in ${bot.system} — falling back to ensureDocked`);
    const fallback = await ensureDocked(ctx);
    if (!fallback) return false;
    return true;
  }

  ctx.log("system", `Docking at ${station.name}...`);
  const dockResp = await bot.exec("dock");
  if (dockResp.error && !dockResp.error.message.includes("already")) {
    ctx.log("error", `Dock failed at ${station.name}: ${dockResp.error.message}`);
    return false;
  }
  bot.docked = true;
  await collectFromStorage(ctx);
  return true;
}

// ── Combat ───────────────────────────────────────────────────

async function engageTarget(
  ctx: RoutineContext,
  target: NearbyEntity,
  fleeThreshold: number,
  preferredStance = "fire",
): Promise<boolean> {
  const { bot } = ctx;

  // Check if a previous battle is still active (v2 battle_status)
  const statusResp = await bot.exec("v2_battle_status");
  if (!statusResp.error && statusResp.result && typeof statusResp.result === "object") {
    const bs = statusResp.result as Record<string, unknown>;
    const inBattle = bs.in_battle ?? bs.active ?? bs.status === "active";
    if (inBattle) {
      ctx.log("combat", "Previous battle still active — waiting for it to resolve...");
      await sleep(10_000);
      const bs2Resp = await bot.exec("v2_battle_status");
      const bs2 = bs2Resp.result as Record<string, unknown> | undefined;
      if (bs2?.in_battle || bs2?.active) {
        ctx.log("combat", "Battle still unresolved — retreating and skipping target");
        await bot.exec("battle", { action: "retreat" });
        return false;
      }
    }
  }

  // Scan before engaging
  const scanResp = await bot.exec("scan", { target_id: target.id });
  if (!scanResp.error && scanResp.result) {
    const s = scanResp.result as Record<string, unknown>;
    const shipType = (s.ship_type as string) || (s.ship as string) || "unknown";
    const faction = (s.faction as string) || target.faction || "unknown";
    ctx.log("combat", `Scan: ${target.name} — ${shipType} | Faction: ${faction}`);
  }

  // Initiate combat via v2 battle/engage
  ctx.log("combat", `Engaging ${target.name}...`);
  const engageResp = await bot.exec("battle", { action: "engage", target_id: target.id });
  if (engageResp.error) {
    const msg = engageResp.error.message.toLowerCase();
    if (msg.includes("not found") || msg.includes("invalid") || msg.includes("no target")) {
      ctx.log("combat", `${target.name} is no longer available`);
      return false;
    }
    // Fallback to v1 attack if v2 engage is not available
    ctx.log("combat", `v2 engage unavailable (${engageResp.error.message}) — falling back to v1 attack`);
    const fallbackResp = await bot.exec("attack", { target_id: target.id });
    if (fallbackResp.error) {
      ctx.log("error", `Attack failed: ${fallbackResp.error.message}`);
      return false;
    }
  }

  ctx.log("combat", "Combat initiated — advancing to close range...");
  // Initial advance (3 zones: Outer → Mid → Inner → Engaged)
  for (let zone = 0; zone < 3; zone++) {
    if (bot.state !== "running") return false;
    const advResp = await bot.exec("battle", { action: "advance" });
    if (advResp.error) break;
  }

  // ── v2 Battle state machine ──────────────────────────────────
  // Per tick: status → stance decision → target → advance → check resolved
  const MAX_COMBAT_TICKS = 30;
  for (let tick = 0; tick < MAX_COMBAT_TICKS; tick++) {
    if (bot.state !== "running") return false;

    // Get live battle state from v2
    const bsResp = await bot.exec("v2_battle_status");
    let ownHpPct = 100;
    let targetHpPct = 100;
    let inBattle = true;

    if (!bsResp.error && bsResp.result && typeof bsResp.result === "object") {
      const bs = bsResp.result as Record<string, unknown>;

      // Battle resolved
      const over = (bs.battle_over ?? bs.resolved ?? (bs.status === "resolved")) || (bs.in_battle === false);
      if (over) {
        ctx.log("combat", `${target.name} eliminated (battle resolved)`);
        return true;
      }

      inBattle = !(bs.in_battle === false);

      // Parse own HP from sides[] or own_hp field
      const sides = Array.isArray(bs.sides) ? (bs.sides as Array<Record<string, unknown>>) : [];
      const ownSide = sides.find(s => (s.player_id as string) === bot.username || (s.is_self as boolean));
      const enemySide = sides.find(s => s !== ownSide);

      if (ownSide) {
        const ownHp = (ownSide.hp as number) ?? (ownSide.hull as number) ?? -1;
        const ownMaxHp = (ownSide.max_hp as number) ?? (ownSide.max_hull as number) ?? -1;
        ownHpPct = ownMaxHp > 0 ? Math.round((ownHp / ownMaxHp) * 100) : (bs.own_hp_pct as number) ?? 100;
      } else {
        ownHpPct = (bs.own_hp_pct as number) ?? (bs.own_hull_pct as number) ??
          (bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100);
      }

      if (enemySide) {
        const eHp = (enemySide.hp as number) ?? (enemySide.hull as number) ?? -1;
        const eMaxHp = (enemySide.max_hp as number) ?? (enemySide.max_hull as number) ?? -1;
        targetHpPct = eMaxHp > 0 ? Math.round((eHp / eMaxHp) * 100) : (bs.target_hp_pct as number) ?? 100;
      } else {
        targetHpPct = (bs.target_hp_pct as number) ?? (bs.enemy_hp_pct as number) ?? 100;
      }
    } else {
      // Fallback: read own hull from bot status
      await bot.refreshStatus();
      ownHpPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    }

    if (!inBattle) {
      ctx.log("combat", `${target.name} — battle ended`);
      return true;
    }

    // Emergency flee
    if (ownHpPct <= fleeThreshold) {
      ctx.log("combat", `Hull critical (${ownHpPct}%) — fleeing!`);
      await bot.exec("battle", { action: "stance", stance: "flee" });
      await bot.exec("battle", { action: "retreat" });
      return false;
    }

    // Stance decision per roadmap:
    //   target_hp < 30% → 'fire' (press the attack)
    //   own shields critical → 'brace'
    //   otherwise → preferredStance (fire/evade)
    let stance: string;
    if (targetHpPct < 30) {
      stance = "fire";
    } else if (ownHpPct < 40 && ownHpPct > fleeThreshold) {
      stance = "brace";
    } else {
      stance = preferredStance;
    }
    await bot.exec("battle", { action: "stance", stance });

    // Set targeting priority on the current target
    await bot.exec("battle", { action: "target", player_id: target.id });

    // Advance to maintain close range
    await bot.exec("battle", { action: "advance" });

    ctx.log("combat", `Tick ${tick + 1}: own ${ownHpPct}% | target ${targetHpPct}% | stance ${stance} — fighting ${target.name}`);
  }

  ctx.log("combat", `Combat with ${target.name} reached max ticks — moving on`);
  return true;
}

function findNextHuntSystem(fromSystemId: string, ms: MapStore): string | null {
  const conns = ms.getConnections(fromSystemId);
  if (conns.length === 0) return null;

  // Priority 1: adjacent lawless/null-sec system
  for (const conn of conns) {
    const sec = (conn.security_level || ms.getSystem(conn.system_id)?.security_level || "").toLowerCase();
    if (sec.includes("lawless") || sec.includes("null") || sec.includes("unregulated")) {
      return conn.system_id;
    }
  }

  // Priority 2: any adjacent huntable system
  for (const conn of conns) {
    const sec = conn.security_level || ms.getSystem(conn.system_id)?.security_level;
    if (isHuntableSystem(sec)) return conn.system_id;
  }

  // Priority 3: unmapped adjacent system
  const unmapped = conns.find(c => !ms.getSystem(c.system_id)?.security_level);
  if (unmapped) return unmapped.system_id;

  return null;
}

// ── Ammo management ──────────────────────────────────────────

/**
 * Buy ammo for all fitted weapon modules when docked.
 * Targets 5 magazines worth of stock per weapon.
 */
async function buyAmmoIfNeeded(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;

  const shipResp = await bot.exec("get_ship");
  const rawModules: any[] = (shipResp.result as any)?.modules ?? [];
  const weaponMods = rawModules.filter((m: any) => m.ammo_type && m.id);

  if (weaponMods.length === 0) {
    ctx.log("combat", "⚠️  No weapon modules found — fit a weapon before hunting");
    return;
  }

  await bot.refreshCargo();

  for (const wep of weaponMods) {
    const magazineSize = (wep.magazine_size as number) ?? 100;
    const target = magazineSize * 5;
    const inCargo = bot.inventory.find((i) => i.itemId === wep.ammo_type)?.quantity ?? 0;
    if (inCargo >= magazineSize) continue;

    const toBuy = target - inCargo;
    ctx.log("combat", `Buying ${toBuy}x ${wep.ammo_type} for ${wep.name || wep.id}...`);
    const resp = await bot.exec("buy", { item_id: wep.ammo_type, quantity: toBuy });
    if (resp.error) {
      ctx.log("combat", `Could not buy ${wep.ammo_type}: ${resp.error.message}`);
    } else {
      ctx.log("combat", `Bought ammo ${wep.ammo_type} (cargo: ${inCargo} → ~${inCargo + toBuy})`);
    }
  }

  await bot.refreshCargo();
}

/**
 * Ensure the hunter has ammo loaded. Attempts reload up to maxAttempts times.
 * Returns false if out of ammo and needs to dock for resupply.
 */
async function ensureAmmoLoaded(
  ctx: RoutineContext,
  threshold: number,
  maxAttempts: number,
): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();

  if (bot.ammo > threshold) return true;
  if (bot.ammo < 0) return true; // ammo field not supported by this ship

  ctx.log("combat", `Ammo low (${bot.ammo}) — reloading...`);

  // Fetch weapon modules with ammo_type from get_ship (get_status modules lack ammo_type)
  const shipResp = await bot.exec("get_ship");
  const rawModules: any[] = (shipResp.result as any)?.modules ?? [];
  const weaponModules = rawModules.filter(
    (m: any) => m.ammo_type && m.id && (m.slot_type === "weapon" || m.damage != null),
  );

  if (weaponModules.length === 0) {
    ctx.log("combat", "No weapon modules with ammo_type found — skipping reload");
    return bot.ammo > 0;
  }

  // Refresh cargo to get current ammo items
  await bot.refreshCargo();

  // Build reload pairs: weapon → matching cargo ammo item
  const reloadPairs: { weapon_instance_id: string; ammo_item_id: string }[] = [];
  for (const wep of weaponModules) {
    const ammoItem = bot.inventory.find((item) => item.itemId === wep.ammo_type);
    if (ammoItem) {
      reloadPairs.push({ weapon_instance_id: wep.id, ammo_item_id: ammoItem.itemId });
    } else {
      ctx.log("combat", `No cargo ammo for weapon ${wep.id} (needs ${wep.ammo_type})`);
    }
  }

  if (reloadPairs.length === 0) {
    ctx.log("combat", "No ammo available in cargo — need to resupply at station");
    return false;
  }

  for (let i = 0; i < maxAttempts; i++) {
    let anySuccess = false;
    for (const pair of reloadPairs) {
      const resp = await bot.exec("reload", pair);
      if (resp.error) {
        const msg = resp.error.message.toLowerCase();
        if (msg.includes("full") || msg.includes("already")) {
          anySuccess = true;
          continue;
        }
        if (msg.includes("no ammo") || msg.includes("no_ammo") || msg.includes("empty")) {
          ctx.log("combat", "No ammo available — need to resupply at station");
          return false;
        }
        ctx.log("combat", `Reload attempt ${i + 1} failed: ${resp.error.message}`);
      } else {
        anySuccess = true;
      }
    }

    await bot.refreshStatus();
    if (bot.ammo > threshold) {
      ctx.log("combat", `Reloaded — ammo: ${bot.ammo}`);
      return true;
    }
    if (!anySuccess) continue;
  }

  ctx.log("combat", `Could not reload after ${maxAttempts} attempts — ammo: ${bot.ammo}`);
  return bot.ammo > 0;
}

// ── Faction alert response ────────────────────────────────────

/** Cooldown per system so we don't divert repeatedly (5 minutes). */
const ALERT_RESPONSE_COOLDOWN_MS = 5 * 60 * 1000;
/** Ignore faction alerts older than this (seconds). */
const ALERT_STALENESS_SECS = 5 * 60;

/** Map<systemId, lastRespondedTimestamp> */
const respondedAlerts = new Map<string, number>();

/** Extract the system ID from a [COMBAT WARNING] or [HULL DAMAGE] faction message. */
function extractAlertSystem(content: string): string | null {
  const match = content.match(/\|\s*(sys_[a-z0-9_]+)\//i);
  return match ? match[1] : null;
}

/**
 * Scan recent faction chat for combat alerts from allied bots.
 * Returns the nearest threatened system if it's within responseRange jumps, else null.
 */
async function checkFactionAlerts(
  ctx: RoutineContext,
  responseRange: number,
): Promise<string | null> {
  if (responseRange <= 0) return null;
  const { bot } = ctx;

  const chatResp = await bot.exec("get_chat_history", { channel: "faction" });
  if (chatResp.error || !chatResp.result) return null;

  const r = chatResp.result as Record<string, unknown>;
  const msgs = (
    Array.isArray(chatResp.result) ? chatResp.result :
    Array.isArray(r.messages) ? r.messages :
    Array.isArray(r.history) ? r.history :
    []
  ) as Array<Record<string, unknown>>;

  const nowSecs = Date.now() / 1000;
  const nowMs = Date.now();

  for (const msg of [...msgs].reverse()) {
    const content = (msg.content as string) || (msg.message as string) || (msg.text as string) || "";
    if (!content.includes("[COMBAT WARNING]") && !content.includes("[HULL DAMAGE]")) continue;

    const ts = (msg.timestamp as number) || (msg.created_at as number) || 0;
    if (ts > 0 && nowSecs - ts > ALERT_STALENESS_SECS) continue;

    const alertSystem = extractAlertSystem(content);
    if (!alertSystem) continue;
    if (alertSystem === bot.system) continue;

    const lastMs = respondedAlerts.get(alertSystem) ?? 0;
    if (nowMs - lastMs < ALERT_RESPONSE_COOLDOWN_MS) continue;

    const route = ctx.mapStore.findRoute(bot.system, alertSystem);
    if (!route || route.length > responseRange) continue;

    return alertSystem;
  }

  return null;
}

// ── Hunter routine ───────────────────────────────────────────

export const hunterRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  await bot.refreshStatus();

  // ── Startup: deposit any leftover loot from a previous run ──
  const settings0 = getHunterSettings(bot.username);
  await clearStartupCargo(ctx, {
    depositMode: "faction",
    homeSystem: settings0.system || bot.system,
    fuelThresholdPct: settings0.refuelThreshold,
    hullThresholdPct: settings0.repairThreshold,
  });

  // Enable auto-defend so the bot braces when hit while patrolling between engagements
  const settings0AutoDefend = settings0.autoDefend;
  bot.autoDefend = settings0AutoDefend;

  let totalKills = 0;

  while (bot.state === "running") {
    // ── Death recovery ──
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleep(30000); continue; }

    const settings = getHunterSettings(bot.username);
    const safetyOpts = {
      fuelThresholdPct: settings.refuelThreshold,
      hullThresholdPct: settings.repairThreshold,
      autoCloak: settings.autoCloak,
    };
    const patrolSystem = settings.system || "";

    // ── Status ──
    yield "get_status";
    await bot.refreshStatus();
    logStatus(ctx);

    // ── Weapon + ammo check ──
    if (bot.ammo >= 0 && bot.ammo < settings.ammoThreshold && !bot.docked) {
      ctx.log("combat", `⚠️  Ammo low (${bot.ammo}/${settings.ammoThreshold} threshold) — docking to resupply before patrol...`);
      yield "dock_for_ammo";
      const docked = await navigateToSafeStation(ctx, safetyOpts);
      if (docked) {
        await buyAmmoIfNeeded(ctx);
        await ensureAmmoLoaded(ctx, settings.ammoThreshold, settings.maxReloadAttempts);
        await bot.refreshStatus();
        ctx.log("combat", `Ammo after resupply: ${bot.ammo}`);
      } else {
        ctx.log("error", "Could not dock to buy ammo — continuing anyway");
      }
      await ensureUndocked(ctx);
    }

    // ── Fuel check ──
    yield "fuel_check";
    const fueled = await ensureFueled(ctx, settings.refuelThreshold);
    if (!fueled) {
      ctx.log("error", "Cannot secure fuel — waiting 30s...");
      await sleep(30000);
      continue;
    }

    // ── Hull check — retreat to a high-security system to repair ──
    await bot.refreshStatus();
    const hullPct = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    if (hullPct <= settings.repairThreshold) {
      ctx.log("system", `Hull at ${hullPct}% — retreating to high-security system for repairs`);
      yield "emergency_repair";
      const docked = await navigateToSafeStation(ctx, safetyOpts);
      if (docked) {
        await completeActiveMissions(ctx);
        await repairShip(ctx);
        await tryRefuel(ctx);
        await checkAndAcceptMissions(ctx);
        await ensureInsured(ctx);
        await bot.checkSkills();
        await ensureUndocked(ctx);
      }
      continue;
    }

    // ── Faction alert check — divert if an ally is nearby and under attack ──
    yield "faction_alert_check";
    const alertTarget = await checkFactionAlerts(ctx, settings.responseRange);
    if (alertTarget) {
      const sys = ctx.mapStore.getSystem(alertTarget);
      const route = ctx.mapStore.findRoute(bot.system, alertTarget);
      const jumps = route ? route.length : "?";
      ctx.log("combat", `Faction alert! ${sys?.name || alertTarget} is under attack (${jumps} jump(s)) — diverting to assist`);
      respondedAlerts.set(alertTarget, Date.now());
      try {
        await bot.exec("chat", {
          channel: "faction",
          content: `[HUNTER RESPONSE] ${bot.username} en route to ${sys?.name || alertTarget} (${jumps} jump(s)) to assist`,
        });
      } catch { /* non-fatal */ }
      const arrived = await navigateToSystem(ctx, alertTarget, safetyOpts);
      if (!arrived) {
        ctx.log("error", `Could not reach ${alertTarget} — resuming normal patrol`);
      }
    }

    // ── Navigate to a huntable (low/unregulated) system ──
    yield "find_patrol_system";

    if (patrolSystem && bot.system !== patrolSystem) {
      ctx.log("travel", `Navigating to configured patrol system ${patrolSystem}...`);
      const arrived = await navigateToSystem(ctx, patrolSystem, safetyOpts);
      if (!arrived) {
        ctx.log("error", `Could not reach ${patrolSystem} — patrolling ${bot.system} instead`);
      }
    } else {
      await fetchSecurityLevel(ctx, bot.system);
      const currentSec = ctx.mapStore.getSystem(bot.system)?.security_level;

      if (!isHuntableSystem(currentSec)) {
        ctx.log("travel", `${bot.system} is ${currentSec || "unknown"} security — searching for a huntable system...`);

        const huntTarget = findNearestHuntableSystem(bot.system, ctx.mapStore);
        if (huntTarget) {
          const sys = ctx.mapStore.getSystem(huntTarget);
          ctx.log("travel", `Found huntable system: ${sys?.name || huntTarget} (${sys?.security_level}) — navigating...`);
          await navigateToSystem(ctx, huntTarget, safetyOpts);
        } else {
          const conns = ctx.mapStore.getConnections(bot.system);
          const unmapped = conns.find(c => !ctx.mapStore.getSystem(c.system_id)?.security_level);
          const target = unmapped ?? conns[0];
          if (target) {
            ctx.log("travel", `No huntable system mapped yet — scouting ${target.system_name || target.system_id}...`);
            await navigateToSystem(ctx, target.system_id, safetyOpts);
            await getSystemInfo(ctx);
            await fetchSecurityLevel(ctx, bot.system);
          } else {
            ctx.log("error", "No connected systems found — waiting 30s");
            await sleep(30000);
            continue;
          }
        }
      }
    }

    if (bot.state !== "running") break;

    // ── Confirm we're actually in a huntable system ──
    await fetchSecurityLevel(ctx, bot.system);
    const confirmedSec = ctx.mapStore.getSystem(bot.system)?.security_level;
    if (!isHuntableSystem(confirmedSec)) {
      ctx.log("info", `${bot.system} is ${confirmedSec || "unknown"} security — no pirates here. Will search again next cycle`);
      await sleep(3000);
      continue;
    }

    // ── Get system layout ──
    yield "scan_system";
    await fetchSecurityLevel(ctx, bot.system);
    const { pois } = await getSystemInfo(ctx);
    const station = findStation(pois);
    const patrolPois = pois.filter(p => !isStationPoi(p));

    if (patrolPois.length === 0) {
      ctx.log("info", "No non-station POIs to patrol — docking to refuel");
      if (station) {
        await bot.exec("travel", { target_poi: station.id });
        await bot.exec("dock");
        bot.docked = true;
        await tryRefuel(ctx);
        await ensureUndocked(ctx);
      }
      continue;
    }

    ctx.log("info", `Patrolling ${patrolPois.length} POI(s) in ${bot.system}...`);

    // ── Patrol loop — visit each non-station POI ──
    let patrolKills = 0;
    let abortPatrol = false;

    for (const poi of patrolPois) {
      if (bot.state !== "running" || abortPatrol) break;

      await bot.refreshStatus();
      const midHull = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
      const midFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;
      if (midHull <= settings.repairThreshold) {
        ctx.log("system", `Hull at ${midHull}% — aborting patrol, heading to station`);
        abortPatrol = true;
        break;
      }
      if (midFuel < settings.refuelThreshold) {
        ctx.log("system", `Fuel at ${midFuel}% — aborting patrol, heading to refuel`);
        abortPatrol = true;
        break;
      }

      // Travel to POI
      yield "travel_to_poi";
      ctx.log("travel", `Patrolling ${poi.name}...`);
      const travelResp = await bot.exec("travel", { target_poi: poi.id });
      if (travelResp.error && !travelResp.error.message.includes("already")) {
        ctx.log("error", `Travel to ${poi.name} failed: ${travelResp.error.message}`);
        continue;
      }
      bot.poi = poi.id;

      // Scan for targets
      yield "scan_for_targets";
      const nearbyResp = await bot.exec("get_nearby");
      if (nearbyResp.error) {
        ctx.log("error", `get_nearby at ${poi.name}: ${nearbyResp.error.message}`);
        continue;
      }

      const entities = parseNearby(nearbyResp.result);
      const targets = entities.filter(e => isPirateTarget(e, settings.onlyNPCs));

      if (targets.length === 0) {
        ctx.log("combat", `No targets at ${poi.name}`);
        await scavengeWrecks(ctx);
        continue;
      }

      ctx.log("combat", `Found ${targets.length} target(s) at ${poi.name}: ${targets.map(t => t.name).join(", ")}`);

      // Engage each target
      for (const target of targets) {
        if (bot.state !== "running") break;

        await bot.refreshStatus();
        const preHull = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
        if (preHull <= settings.repairThreshold) {
          ctx.log("system", `Hull at ${preHull}% — too low for another fight`);
          abortPatrol = true;
          break;
        }

        // Pre-fight ammo check
        if (bot.ammo === 0) {
          ctx.log("combat", "Out of ammo — aborting patrol to resupply");
          abortPatrol = true;
          break;
        }

        yield "engage";
        const won = await engageTarget(ctx, target, settings.fleeThreshold, settings.preferredStance);

        if (won) {
          totalKills++;
          patrolKills++;
          ctx.log("combat", `Kill #${totalKills} — looting wreck...`);
          logAgentEvent(ctx, "combat", "info",
            `Kill #${totalKills}: ${target.name} eliminated at ${poi.name} (${bot.system})`,
            { kill_number: totalKills, target_name: target.name, poi_name: poi.name },
          );

          // Submit pirate activity intel to faction (fire-and-forget)
          if (bot.factionId) {
            bot.exec("faction_submit_intel", {
              system_id: bot.system,
              intel_type: "pirate_activity",
              data: {
                poi_id: poi.id,
                poi_name: poi.name,
                target_name: target.name,
                target_tier: (target as unknown as Record<string, unknown>).tier ?? "",
                kills: 1,
              },
            }).catch(() => {});
          }

          yield "loot";
          await scavengeWrecks(ctx);

          // Post-kill reload
          const hasAmmo = await ensureAmmoLoaded(ctx, settings.ammoThreshold, settings.maxReloadAttempts);
          if (!hasAmmo) {
            ctx.log("combat", "No ammo after kill — aborting patrol to resupply");
            abortPatrol = true;
          }

          await bot.refreshStatus();
          ctx.log("combat", `Post-fight: hull ${bot.hull}/${bot.maxHull} | ammo ${bot.ammo} | credits ${bot.credits}`);
        } else {
          ctx.log("combat", "Retreated — aborting patrol to dock and repair");
          abortPatrol = true;
          break;
        }
      }
    }

    // ── Post-patrol decision ──
    yield "post_patrol";
    await bot.refreshStatus();
    const postHull = bot.maxHull > 0 ? Math.round((bot.hull / bot.maxHull) * 100) : 100;
    const postFuel = bot.maxFuel > 0 ? Math.round((bot.fuel / bot.maxFuel) * 100) : 100;

    const needsRepair = abortPatrol || postHull <= settings.repairThreshold;
    const needsFuel = postFuel < settings.refuelThreshold;

    if (needsRepair || needsFuel) {
      const reason = needsRepair ? `hull ${postHull}%` : `fuel ${postFuel}%`;
      ctx.log("system", `Patrol sweep done — ${patrolKills} kill(s). Returning to safe system (${reason})...`);

      yield "dock";
      const docked = await navigateToSafeStation(ctx, safetyOpts);
      if (!docked) {
        ctx.log("error", "Could not dock anywhere — retrying next cycle");
        continue;
      }

      await collectFromStorage(ctx);

      yield "complete_missions";
      await completeActiveMissions(ctx);

      // Sell loot (everything except fuel cells)
      yield "sell_loot";
      await bot.refreshCargo();
      let unsold = false;
      for (const item of bot.inventory) {
        if (item.itemId.toLowerCase().includes("fuel") || item.itemId.toLowerCase().includes("energy_cell")) continue;
        ctx.log("trade", `Selling ${item.quantity}x ${item.name}...`);
        const sellResp = await bot.exec("sell", { item_id: item.itemId, quantity: item.quantity });
        if (sellResp.error) unsold = true;
        yield "selling";
      }
      if (unsold) await depositNonFuelCargo(ctx);
      await bot.refreshStatus();

      yield "check_missions";
      await checkAndAcceptMissions(ctx);

      yield "ensure_insured";
      await ensureInsured(ctx);

      yield "refuel";
      await tryRefuel(ctx);

      yield "repair";
      await repairShip(ctx);

      yield "buy_ammo";
      await buyAmmoIfNeeded(ctx);

      yield "reload";
      await ensureAmmoLoaded(ctx, settings.ammoThreshold, settings.maxReloadAttempts);

      yield "fit_mods";
      const modProfile = getModProfile("hunter");
      if (modProfile.length > 0) await ensureModsFitted(ctx, modProfile);

      yield "check_skills";
      await bot.checkSkills();

      ctx.log("info", `=== Patrol complete. Total kills: ${totalKills} | Credits: ${bot.credits} ===`);

    } else {
      ctx.log("system", `Patrol sweep done — ${patrolKills} kill(s). Hull: ${postHull}% | Fuel: ${postFuel}% — continuing hunt...`);

      // Restock ammo if low even when not stopping for repairs/fuel
      await bot.refreshStatus();
      if (bot.ammo >= 0 && bot.ammo < settings.ammoThreshold) {
        ctx.log("combat", `Ammo low (${bot.ammo}) — restocking before continuing...`);
        yield "restock_ammo";
        const docked = await navigateToSafeStation(ctx, safetyOpts);
        if (docked) {
          await buyAmmoIfNeeded(ctx);
          await ensureAmmoLoaded(ctx, settings.ammoThreshold, settings.maxReloadAttempts);
          await bot.refreshStatus();
          ctx.log("combat", `Ammo after restock: ${bot.ammo}`);
        }
        await ensureUndocked(ctx);
      }

      if (!patrolSystem) {
        const nextSystem = findNextHuntSystem(bot.system, ctx.mapStore);
        if (nextSystem) {
          const sys = ctx.mapStore.getSystem(nextSystem);
          ctx.log("travel", `Moving to ${sys?.name || nextSystem} (${sys?.security_level || "unknown"}) to continue hunt...`);
          await navigateToSystem(ctx, nextSystem, safetyOpts);
          await getSystemInfo(ctx);
          await fetchSecurityLevel(ctx, bot.system);
        } else {
          ctx.log("info", "No adjacent huntable system found — will search next cycle");
        }
      }
    }
  }

  bot.autoDefend = false;
};
