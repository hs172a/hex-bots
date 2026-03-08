/**
 * Scavenger routine — roams system to system collecting jettisoned goods from wrecks.
 * Adapted from v2's scavenger routine.
 *
 * Unlike salvager (tows whole ship wrecks in a configured system),
 * the scavenger is a peaceful roamer: fly to a POI, check for wrecks/containers,
 * loot items, move on. Sells or deposits cargo when full.
 *
 * Loop: pick system → visit POIs → loot wrecks → sell when full → repeat
 */
import type { Routine, RoutineContext } from "../bot.js";
import type { MapStore } from "../mapstore.js";
import {
  getSystemInfo,
  ensureDocked,
  ensureUndocked,
  ensureFueled,
  tryRefuel,
  repairShip,
  detectAndRecoverFromDeath,
  readSettings,
  scavengeWrecks,
  sleep,
  sleepBot,
  logStatus,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

type DepositMode = "sell" | "faction" | "storage";

function getScavengerSettings(): {
  depositMode: DepositMode;
  refuelThreshold: number;
  cargoThreshold: number;
  homeSystem: string;
} {
  const all = readSettings();
  const s = all.scavenger || {};
  const mode = s.depositMode as string;
  return {
    depositMode: (mode === "faction" || mode === "storage") ? mode : "sell",
    refuelThreshold: (s.refuelThreshold as number) || 60,
    cargoThreshold: (s.cargoThreshold as number) || 80,
    homeSystem: (s.homeSystem as string) || "",
  };
}

// ── Helpers ──────────────────────────────────────────────────

/** Loot all wrecks at the current POI. Returns number of items looted. */
async function lootWrecksHere(ctx: RoutineContext, attemptedWrecks: Set<string>): Promise<number> {
  const { bot } = ctx;
  let totalLooted = 0;

  const wrecksResp = await bot.exec("get_wrecks");
  if (wrecksResp.error) return 0;

  const wrecks = extractWrecks(wrecksResp.result);
  if (wrecks.length === 0) return 0;

  ctx.log("info", `Found ${wrecks.length} wreck(s) — looting...`);

  for (const wreck of wrecks) {
    if (bot.state !== "running") break;
    if (attemptedWrecks.has(wreck.id)) continue;
    attemptedWrecks.add(wreck.id);

    if (wreck.items.length === 0) continue;

    // Check cargo space
    const freeSpace = bot.cargoMax > 0 ? bot.cargoMax - bot.cargo : 0;
    if (freeSpace <= 0) {
      ctx.log("info", "Cargo full — stopping loot");
      break;
    }

    for (const item of wreck.items) {
      if (bot.state !== "running") break;
      const cFree = bot.cargoMax > 0 ? bot.cargoMax - bot.cargo : 0;
      if (cFree <= 0) break;

      const lootResp = await bot.exec("loot_wreck", {
        wreck_id: wreck.id,
        item_id: item.item_id,
        quantity: item.quantity,
      });
      if (lootResp.error) {
        const msg = lootResp.error.message.toLowerCase();
        if (!msg.includes("no_items") && !msg.includes("empty") && !msg.includes("not_found")) {
          ctx.log("warn", `Loot failed: ${lootResp.error.message}`);
        }
        break;
      }
      totalLooted += item.quantity;
      ctx.log("info", `Looted ${item.quantity}x ${item.item_id}`);
      await bot.refreshStatus();
    }
  }

  return totalLooted;
}

interface WreckData {
  id: string;
  items: Array<{ item_id: string; quantity: number }>;
}

function extractWrecks(data: unknown): WreckData[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const arr = (
    Array.isArray(d) ? d :
    Array.isArray(d.wrecks) ? d.wrecks :
    Array.isArray(d.items) ? d.items :
    []
  ) as Array<Record<string, unknown>>;

  return arr.map(w => ({
    id: (w.id as string) || (w.wreck_id as string) || "",
    items: ((w.items as Array<Record<string, unknown>>) || []).map(i => ({
      item_id: (i.item_id as string) || (i.id as string) || "",
      quantity: (i.quantity as number) || 1,
    })),
  })).filter(w => w.id);
}

/** Deposit cargo based on mode (sell / faction / storage). */
async function depositCargo(ctx: RoutineContext, mode: DepositMode): Promise<void> {
  const { bot } = ctx;
  await bot.refreshCargo();

  for (const item of [...bot.inventory]) {
    if (item.quantity <= 0) continue;
    const lower = item.itemId.toLowerCase();
    if (lower.includes("fuel") || lower.includes("energy_cell")) continue;

    if (mode === "sell") {
      const resp = await bot.exec("sell", { item_id: item.itemId, quantity: item.quantity });
      if (!resp.error) {
        ctx.log("trade", `Sold ${item.quantity}x ${item.name}`);
      } else {
        // Fallback: deposit if can't sell
        await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    } else if (mode === "faction") {
      await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
    } else {
      await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
    }
    await sleep(500);
  }
  await bot.refreshCargo();
  await bot.refreshStatus();
}

/** Pick a neighboring system to roam to. Prefers unvisited systems with more wrecks potential. */
function pickNextSystem(connections: Array<{ id: string; name: string }>, recentlyVisited: Set<string>, ms: MapStore): { id: string; name: string } | null {
  if (connections.length === 0) return null;

  const knownSystems = new Set(Object.keys(ms.getAllSystems()));

  const scored = connections.map(c => {
    let score = 10;
    if (!recentlyVisited.has(c.id)) score += 30;
    if (!knownSystems.has(c.id)) score += 20;
    // Check ms for security info on known systems
    const stored = ms.getSystem(c.id);
    if (stored) {
      const sec = stored.security_level?.toLowerCase() || "";
      if (sec === "low" || sec === "lawless" || sec === "none") score += 15;
      else if (sec === "medium" || sec === "moderate") score += 5;
      // More POIs = more wreck potential
      score += Math.min(stored.pois.length, 8) * 3;
    }
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  // Pick from top 3 randomly for variety
  const topN = scored.slice(0, Math.min(3, scored.length));
  return topN[Math.floor(Math.random() * topN.length)];
}

// ── Routine ──────────────────────────────────────────────────

export const scavengerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  await bot.refreshStatus();

  ctx.log("system", "Scavenger online — roaming for wrecks and loot...");

  const attemptedWrecks = new Set<string>();
  let lastWreckClear = Date.now();
  const WRECK_RESET_MS = 600_000; // 10 minutes

  const recentlyVisited = new Set<string>();
  let totalCollected = 0;

  while (bot.state === "running") {
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleepBot(ctx, 30000); continue; }

    const settings = getScavengerSettings();

    // Periodic wreck memory clear
    if (Date.now() - lastWreckClear > WRECK_RESET_MS) {
      attemptedWrecks.clear();
      lastWreckClear = Date.now();
    }

    // ── Cargo management: deposit when >threshold% full ──
    const cargoPct = bot.cargoMax > 0 ? (bot.cargo / bot.cargoMax) * 100 : 0;
    if (cargoPct > settings.cargoThreshold) {
      yield "deposit_cargo";
      ctx.log("info", "Cargo getting full — docking to deposit...");
      await ensureDocked(ctx);
      await depositCargo(ctx, settings.depositMode);
      await tryRefuel(ctx);
      await repairShip(ctx);
      ctx.log("info", "Cargo cleared, continuing scavenge");
    }

    // ── Ensure undocked ──
    await ensureUndocked(ctx);

    // ── Scan all POIs in current system ──
    yield "scan_system";
    const { pois, connections } = await getSystemInfo(ctx);
    let foundAnything = false;

    for (const poi of pois) {
      if (bot.state !== "running") break;

      // Don't travel if cargo is nearly full
      if (bot.cargoMax > 0 && bot.cargo / bot.cargoMax > 0.9) break;

      // Travel to POI
      if (bot.poi !== poi.id) {
        const travelResp = await bot.exec("travel", { target_poi: poi.id });
        if (travelResp.error) continue;
        await bot.refreshStatus();
        await sleep(1000);
      }

      // Use the common scavengeWrecks helper for quick loot
      await scavengeWrecks(ctx);

      // Also try the detailed loot approach
      const looted = await lootWrecksHere(ctx, attemptedWrecks);
      if (looted > 0) {
        totalCollected += looted;
        foundAnything = true;
      }
    }

    // Track visited system
    if (bot.system) {
      recentlyVisited.add(bot.system);
      if (recentlyVisited.size > 15) recentlyVisited.clear();
    }

    if (foundAnything) {
      ctx.log("info", `Session total: ${totalCollected} items collected`);
    }

    // ── Fuel check before roaming ──
    yield "refuel_check";
    const fueled = await ensureFueled(ctx, settings.refuelThreshold);
    if (!fueled) {
      ctx.log("warn", "Low fuel — docking to refuel...");
      await ensureDocked(ctx);
      await tryRefuel(ctx);
      await ensureUndocked(ctx);
    }

    if (bot.state !== "running") break;

    // ── Jump to next system ──
    yield "roam";
    const target = pickNextSystem(
      connections.map(c => ({
        id: c.id,
        name: c.name,
      })),
      recentlyVisited,
      ctx.mapStore,
    );

    if (target && target.id) {
      ctx.log("info", `Roaming to ${target.name || target.id}...`);
      const jumpResp = await bot.exec("jump", { target_system: target.id });
      if (jumpResp.error) {
        ctx.log("warn", `Jump failed: ${jumpResp.error.message}`);
        await sleep(15000);
        continue;
      }
      await bot.refreshStatus();
      logStatus(ctx);
    } else {
      ctx.log("info", "No systems to roam to — waiting...");
      await sleepBot(ctx, 30000);
    }

    await sleep(3000);
  }
};
