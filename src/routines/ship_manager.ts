/**
 * ShipManager routine — automates the ship lifecycle:
 *   1. Poll commission_status → claim ready commissions → auto-install configured mods
 *   2. Browse ship market → auto-buy ships matching class + price criteria
 *   3. Auto-buy insurance after any new ship acquisition
 *
 * Runs one pass then idles. Schedule via smart_selector or run periodically.
 */
import type { Routine, RoutineContext } from "../bot.js";
import {
  ensureDocked,
  ensureUndocked,
  navigateToSystem,
  tryRefuel,
  sleep,
  readSettings,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

interface ShipManagerSettings {
  /** Automatically claim ready commissions. Default: true */
  autoClaimCommissions: boolean;
  /** Map of ship_class → list of mod_id strings to install after commissioning. */
  autoInstallMods: Record<string, string[]>;
  /** Automatically buy insurance after acquiring a new ship. Default: true */
  autoBuyInsurance: boolean;
  /** If > 0, browse market and buy listed ships priced ≤ this value. Default: 0 (disabled) */
  maxBuyPrice: number;
  /** Ship class to target when browsing market (e.g. "corvette"). Empty = any. */
  targetClass: string;
  /** Home base to return to after claiming/buying ships. Falls back to bot.homeBase. */
  homeBase: string;
}

function getSettings(): ShipManagerSettings {
  const all = readSettings();
  const s = (all.ship_manager || {}) as Record<string, unknown>;
  return {
    autoClaimCommissions: (s.autoClaimCommissions as boolean) ?? true,
    autoInstallMods: (s.autoInstallMods as Record<string, string[]>) ?? {},
    autoBuyInsurance: (s.autoBuyInsurance as boolean) ?? true,
    maxBuyPrice: (s.maxBuyPrice as number) ?? 0,
    targetClass: (s.targetClass as string) ?? "",
    homeBase: (s.homeBase as string) ?? "",
  };
}

// ── Helpers ───────────────────────────────────────────────────

/** Navigate to a base by ID: undock → travel (if in same system) → dock. */
async function goToBase(ctx: RoutineContext, baseId: string, baseName: string): Promise<boolean> {
  const { bot } = ctx;
  await bot.refreshStatus();

  if (bot.poi !== baseId || !bot.docked) {
    await ensureUndocked(ctx);

    // If the POI is in a different system we'd need jump navigation — for now
    // attempt a direct travel (works within the same system or if already adjacent).
    if (bot.poi !== baseId) {
      ctx.log("travel", `Traveling to ${baseName}...`);
      const tResp = await bot.exec("travel", { target_poi: baseId });
      if (tResp.error) {
        ctx.log("error", `Could not travel to ${baseName}: ${tResp.error.message}`);
        return false;
      }
      bot.poi = baseId;
    }

    const dResp = await bot.exec("dock");
    if (dResp.error && !dResp.error.message.includes("already")) {
      ctx.log("error", `Dock at ${baseName} failed: ${dResp.error.message}`);
      return false;
    }
    bot.docked = true;
  }
  return true;
}

/** Buy insurance for the current ship if none is active. */
async function buyInsuranceIfNeeded(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;

  const quoteResp = await bot.exec("get_insurance_quote");
  if (quoteResp.error) {
    ctx.log("system", "Insurance quote unavailable — skipping insurance check");
    return;
  }

  const quote = quoteResp.result as Record<string, unknown> | undefined;
  if (!quote) return;

  // If already insured, skip
  const existing = quote.active_policy ?? quote.policy ?? quote.insured;
  if (existing) {
    ctx.log("system", "Ship already insured — skipping");
    return;
  }

  const cost = (quote.premium as number) ?? (quote.cost as number) ?? 0;
  if (cost > 0 && bot.credits < cost) {
    ctx.log("system", `Cannot afford insurance (${cost}cr, have ${bot.credits}cr) — skipping`);
    return;
  }

  ctx.log("system", `Buying insurance (${cost > 0 ? `${cost}cr` : "free"})...`);
  const buyResp = await bot.exec("buy_insurance");
  if (buyResp.error) {
    ctx.log("error", `Insurance purchase failed: ${buyResp.error.message}`);
  } else {
    ctx.log("system", "Insurance purchased successfully");
  }
}

/** Install a list of mods on the current ship. Skips already-installed mods. */
async function installMods(ctx: RoutineContext, modIds: string[]): Promise<void> {
  const { bot } = ctx;
  if (modIds.length === 0) return;

  await bot.refreshShipMods();
  const installed = new Set(bot.installedMods);

  for (const modId of modIds) {
    if (installed.has(modId)) {
      ctx.log("system", `Mod ${modId} already installed — skipping`);
      continue;
    }
    ctx.log("system", `Installing mod: ${modId}...`);
    const resp = await bot.exec("install_mod", { mod_id: modId });
    if (resp.error) {
      ctx.log("error", `Failed to install ${modId}: ${resp.error.message}`);
    } else {
      ctx.log("system", `Installed mod: ${modId}`);
      installed.add(modId);
    }
    await sleep(1000);
  }
}

// ── Commission claiming ───────────────────────────────────────

async function handleCommissions(ctx: RoutineContext, settings: ShipManagerSettings): Promise<number> {
  const { bot } = ctx;
  let claimed = 0;

  ctx.log("system", "Checking commission status...");
  const resp = await bot.exec("commission_status");
  if (resp.error) {
    ctx.log("system", `Commission status unavailable: ${resp.error.message}`);
    return 0;
  }

  const result = resp.result as Record<string, unknown> | undefined;
  if (!result) return 0;

  const commissions: Array<Record<string, unknown>> = Array.isArray(result.commissions)
    ? result.commissions as Array<Record<string, unknown>>
    : Array.isArray(result) ? result as Array<Record<string, unknown>>
    : [];

  const ready = commissions.filter(c =>
    (c.status as string) === "ready" ||
    (c.status as string) === "complete" ||
    (c.completed as boolean) === true
  );

  if (ready.length === 0) {
    ctx.log("system", "No commissions ready to claim");
    return 0;
  }

  ctx.log("system", `${ready.length} commission(s) ready to claim`);

  for (const commission of ready) {
    const baseId = (commission.base_id as string) || (commission.station_id as string) || "";
    const baseName = (commission.base_name as string) || baseId || "commission base";
    const shipClass = (commission.ship_class as string) || (commission.class as string) || "";
    const commissionId = (commission.id as string) || (commission.commission_id as string) || "";

    if (!commissionId) {
      ctx.log("error", "Commission has no ID — skipping");
      continue;
    }

    // Navigate to the base where the commission is ready
    if (baseId && (bot.poi !== baseId || !bot.docked)) {
      ctx.log("travel", `Navigating to ${baseName} to claim commission...`);
      if (!await goToBase(ctx, baseId, baseName)) continue;
    } else {
      await ensureDocked(ctx);
    }

    ctx.log("system", `Claiming commission ${commissionId} (${shipClass || "unknown class"})...`);
    const claimResp = await bot.exec("claim_commission", { commission_id: commissionId });
    if (claimResp.error) {
      ctx.log("error", `Failed to claim commission ${commissionId}: ${claimResp.error.message}`);
      continue;
    }

    const claimResult = claimResp.result as Record<string, unknown> | undefined;
    const newShipId = (claimResult?.ship_id as string) || (claimResult?.id as string) || "";
    ctx.log("system", `Claimed commission${newShipId ? ` — new ship: ${newShipId}` : ""}`);
    claimed++;

    // Auto-install configured mods for this ship class
    if (shipClass && settings.autoInstallMods[shipClass]?.length > 0) {
      ctx.log("system", `Auto-installing mods for ${shipClass}...`);
      await installMods(ctx, settings.autoInstallMods[shipClass]);
    }

    // Auto-buy insurance
    if (settings.autoBuyInsurance) {
      await buyInsuranceIfNeeded(ctx);
    }

    await sleep(1000);
  }

  return claimed;
}

// ── Market browsing ───────────────────────────────────────────

async function handleMarketBrowse(ctx: RoutineContext, settings: ShipManagerSettings): Promise<void> {
  const { bot } = ctx;
  if (settings.maxBuyPrice <= 0) return;

  ctx.log("system", `Browsing ship market (budget: ${settings.maxBuyPrice}cr, class: ${settings.targetClass || "any"})...`);

  await ensureDocked(ctx);
  const resp = await bot.exec("browse_ships");
  if (resp.error) {
    ctx.log("system", `Ship market unavailable: ${resp.error.message}`);
    return;
  }

  const result = resp.result as Record<string, unknown> | undefined;
  const listings: Array<Record<string, unknown>> = Array.isArray(result?.ships)
    ? result!.ships as Array<Record<string, unknown>>
    : Array.isArray(result)
    ? result as Array<Record<string, unknown>>
    : [];

  if (listings.length === 0) {
    ctx.log("system", "No ships listed at current station");
    return;
  }

  for (const listing of listings) {
    const listingId = (listing.listing_id as string) || (listing.id as string) || "";
    const price = (listing.price as number) ?? 0;
    const shipClass = (listing.ship_class as string) || (listing.class as string) || "";
    const shipName = (listing.name as string) || shipClass || "unknown";

    if (!listingId || price <= 0) continue;
    if (price > settings.maxBuyPrice) continue;
    if (settings.targetClass && shipClass !== settings.targetClass) continue;
    if (bot.credits < price) {
      ctx.log("system", `Found ${shipName} at ${price}cr but insufficient credits (${bot.credits}cr)`);
      continue;
    }

    ctx.log("system", `Buying ${shipName} for ${price}cr (listing: ${listingId})...`);
    const buyResp = await bot.exec("buy_listed_ship", { listing_id: listingId });
    if (buyResp.error) {
      ctx.log("error", `Failed to buy ${shipName}: ${buyResp.error.message}`);
      continue;
    }

    const buyResult = buyResp.result as Record<string, unknown> | undefined;
    const newShipId = (buyResult?.ship_id as string) || (buyResult?.id as string) || "";
    ctx.log("system", `Purchased ${shipName}${newShipId ? ` (id: ${newShipId})` : ""}`);
    await bot.refreshStatus();

    // Auto-install mods for newly bought class
    if (shipClass && settings.autoInstallMods[shipClass]?.length > 0) {
      ctx.log("system", `Auto-installing mods for ${shipClass}...`);
      await installMods(ctx, settings.autoInstallMods[shipClass]);
    }

    // Auto-insurance
    if (settings.autoBuyInsurance) {
      await buyInsuranceIfNeeded(ctx);
    }

    // Buy one ship at a time
    break;
  }
}

// ── Main routine ──────────────────────────────────────────────

export const shipManagerRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  const settings = getSettings();

  ctx.log("system", "ShipManager: starting...");

  yield "init";
  await bot.refreshStatus();

  // Ensure fueled before traveling
  if (bot.docked) {
    await tryRefuel(ctx);
  }

  // ── Step 1: Check and claim commissions ───────────────────
  if (settings.autoClaimCommissions) {
    yield "check_commissions";
    await handleCommissions(ctx, settings);
  }

  // ── Step 2: Browse market for ships to buy ────────────────
  if (settings.maxBuyPrice > 0) {
    yield "browse_market";
    await handleMarketBrowse(ctx, settings);
  }

  // ── Step 3: Ensure current ship is insured ────────────────
  if (settings.autoBuyInsurance) {
    yield "check_insurance";
    await ensureDocked(ctx);
    await buyInsuranceIfNeeded(ctx);
  }

  ctx.log("system", "ShipManager: pass complete");
};
