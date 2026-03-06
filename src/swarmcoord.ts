/**
 * Swarm Coordinator — lightweight goal-level coordination between bots.
 *
 * Module-level singleton: all routines in the same process share it.
 * All registrations are TTL-based and expire automatically so stale
 * claims never block other bots indefinitely.
 *
 * Three coordination primitives:
 *  1. Station claims  — "I'm heading to station X to deposit/sell item Y"
 *  2. Trade route claims — "I own the fromSystem→toSystem route for item Z this cycle"
 *  3. Material demand signals — "I need N units of item W" (crafter → miners)
 */

// ── Constants ─────────────────────────────────────────────────

/** Default TTL for station claims (ms). Enough time to travel + dock + unload. */
const STATION_CLAIM_TTL_MS = 10 * 60 * 1000; // 10 min

/** Default TTL for trade route claims (ms). One trader cycle. */
const TRADE_ROUTE_TTL_MS = 20 * 60 * 1000; // 20 min

/** Default TTL for material demand signals (ms). */
const MATERIAL_DEMAND_TTL_MS = 15 * 60 * 1000; // 15 min

/** How many bots heading to the same station before it's considered "crowded". */
export const STATION_CROWD_THRESHOLD = 2;

// ── Types ─────────────────────────────────────────────────────

export interface StationClaim {
  /** Bot that registered this claim. */
  bot: string;
  /** POI ID of the destination station. */
  stationId: string;
  /** Items being brought (item_id → quantity). Empty means "any cargo". */
  items: Record<string, number>;
  /** Epoch ms when this claim was registered. */
  registeredAt: number;
  /** Epoch ms when this claim expires. */
  expiresAt: number;
}

export interface TradeRouteClaim {
  bot: string;
  /** Origin system ID (empty string = faction storage at current station). */
  fromSystem: string;
  /** Destination system ID. */
  toSystem: string;
  /** Destination POI ID. */
  destPoi: string;
  /** Item being traded. */
  itemId: string;
  registeredAt: number;
  expiresAt: number;
}

export interface MaterialDemand {
  /** Bot that needs the material (usually a crafter/gatherer). */
  bot: string;
  itemId: string;
  quantity: number;
  registeredAt: number;
  expiresAt: number;
  /** POI ID where the item must be delivered (faction storage or gift target). */
  stationPoiId?: string;
  /** System ID of the target station. */
  stationSystem?: string;
  /** If true, use send_gift instead of faction_deposit_items when delivering. */
  useGift?: boolean;
}

// ── Internal state ────────────────────────────────────────────

/** Active station claims, keyed by bot name. */
const stationClaims = new Map<string, StationClaim>();

/** Active trade route claims, keyed by bot name. */
const tradeRouteClaims = new Map<string, TradeRouteClaim>();

/** Active material demands, keyed by `${bot}:${itemId}`. */
const materialDemands = new Map<string, MaterialDemand>();

// ── Cleanup helpers ───────────────────────────────────────────

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, claim] of stationClaims) {
    if (claim.expiresAt <= now) stationClaims.delete(key);
  }
  for (const [key, claim] of tradeRouteClaims) {
    if (claim.expiresAt <= now) tradeRouteClaims.delete(key);
  }
  for (const [key, demand] of materialDemands) {
    if (demand.expiresAt <= now) materialDemands.delete(key);
  }
}

// ── Station claims ────────────────────────────────────────────

/**
 * Register intent to travel to a station and deposit/sell a set of items.
 * Replaces any prior claim for this bot.
 */
export function claimStation(
  botName: string,
  stationId: string,
  items: Record<string, number> = {},
  ttlMs: number = STATION_CLAIM_TTL_MS,
): void {
  pruneExpired();
  const now = Date.now();
  stationClaims.set(botName, {
    bot: botName,
    stationId,
    items,
    registeredAt: now,
    expiresAt: now + ttlMs,
  });
}

/** Release a bot's station claim (call when docking complete or bot stops). */
export function releaseStationClaim(botName: string): void {
  stationClaims.delete(botName);
}

/** Get all active station claims (excluding the requesting bot). */
export function getStationClaims(excludeBot?: string): StationClaim[] {
  pruneExpired();
  const result: StationClaim[] = [];
  for (const [bot, claim] of stationClaims) {
    if (excludeBot && bot === excludeBot) continue;
    result.push(claim);
  }
  return result;
}

/**
 * How many OTHER bots are heading to the given station.
 * Optionally filter by item being delivered (0 = ignore item filter).
 */
export function stationClaimCount(
  stationId: string,
  itemId?: string,
  excludeBot?: string,
): number {
  pruneExpired();
  let count = 0;
  for (const [bot, claim] of stationClaims) {
    if (excludeBot && bot === excludeBot) continue;
    if (claim.stationId !== stationId) continue;
    if (itemId && Object.keys(claim.items).length > 0 && !(itemId in claim.items)) continue;
    count++;
  }
  return count;
}

/**
 * Pick the least-crowded station from a list.
 * Returns the station with the fewest bots heading to it.
 * Ties broken by original order.
 */
export function pickLeastCrowdedStation(
  stationIds: string[],
  excludeBot?: string,
): string | null {
  if (stationIds.length === 0) return null;
  pruneExpired();
  let bestStation = stationIds[0];
  let bestCount = stationClaimCount(bestStation, undefined, excludeBot);
  for (let i = 1; i < stationIds.length; i++) {
    const count = stationClaimCount(stationIds[i], undefined, excludeBot);
    if (count < bestCount) {
      bestCount = count;
      bestStation = stationIds[i];
    }
  }
  return bestStation;
}

/** True when the given station is crowded (>= STATION_CROWD_THRESHOLD bots heading there). */
export function isStationCrowded(stationId: string, excludeBot?: string): boolean {
  return stationClaimCount(stationId, undefined, excludeBot) >= STATION_CROWD_THRESHOLD;
}

// ── Trade route claims ────────────────────────────────────────

/**
 * Register a trade route claim.
 * Replaces any prior route claim for this bot.
 */
export function claimTradeRoute(
  botName: string,
  fromSystem: string,
  toSystem: string,
  destPoi: string,
  itemId: string,
  ttlMs: number = TRADE_ROUTE_TTL_MS,
): void {
  pruneExpired();
  const now = Date.now();
  tradeRouteClaims.set(botName, {
    bot: botName,
    fromSystem,
    toSystem,
    destPoi,
    itemId,
    registeredAt: now,
    expiresAt: now + ttlMs,
  });
}

/** Release a bot's trade route claim. */
export function releaseTradeRouteClaim(botName: string): void {
  tradeRouteClaims.delete(botName);
}

/**
 * Check whether another bot has already claimed this exact route + item.
 * Used by traders to avoid duplicate arbitrage.
 */
export function isTradeRouteClaimed(
  fromSystem: string,
  toSystem: string,
  itemId: string,
  excludeBot?: string,
): boolean {
  pruneExpired();
  for (const [bot, claim] of tradeRouteClaims) {
    if (excludeBot && bot === excludeBot) continue;
    if (claim.itemId !== itemId) continue;
    if (claim.fromSystem === fromSystem && claim.toSystem === toSystem) return true;
  }
  return false;
}

/** All active trade route claims (excluding the requesting bot). */
export function getTradeRouteClaims(excludeBot?: string): TradeRouteClaim[] {
  pruneExpired();
  const result: TradeRouteClaim[] = [];
  for (const [bot, claim] of tradeRouteClaims) {
    if (excludeBot && bot === excludeBot) continue;
    result.push(claim);
  }
  return result;
}

// ── Material demand signals ───────────────────────────────────

/**
 * Broadcast that a bot needs a given quantity of an item.
 * Replaces any prior demand from this bot for this item.
 */
export function broadcastMaterialNeed(
  botName: string,
  itemId: string,
  quantity: number,
  opts?: {
    ttlMs?: number;
    stationPoiId?: string;
    stationSystem?: string;
    useGift?: boolean;
  },
): void {
  pruneExpired();
  const key = `${botName}:${itemId}`;
  const now = Date.now();
  materialDemands.set(key, {
    bot: botName,
    itemId,
    quantity,
    registeredAt: now,
    expiresAt: now + (opts?.ttlMs ?? MATERIAL_DEMAND_TTL_MS),
    stationPoiId: opts?.stationPoiId,
    stationSystem: opts?.stationSystem,
    useGift: opts?.useGift,
  });
}

/** Clear a specific material demand (call when the crafter obtained what it needed). */
export function clearMaterialNeed(botName: string, itemId: string): void {
  materialDemands.delete(`${botName}:${itemId}`);
}

/** Clear all material demands from a bot (call on routine stop). */
export function clearAllMaterialNeeds(botName: string): void {
  for (const key of [...materialDemands.keys()]) {
    if (key.startsWith(`${botName}:`)) materialDemands.delete(key);
  }
}

/**
 * Get the total quantity demanded for an item across all active demand signals.
 * Useful for miners to prioritise which ore to mine.
 */
export function getTotalDemandForItem(itemId: string): number {
  pruneExpired();
  let total = 0;
  for (const demand of materialDemands.values()) {
    if (demand.itemId === itemId) total += demand.quantity;
  }
  return total;
}

/**
 * Get all active material demands, sorted by quantity descending.
 * Useful for miners to pick the most-needed item.
 */
export function getAllMaterialDemands(): MaterialDemand[] {
  pruneExpired();
  return [...materialDemands.values()].sort((a, b) => b.quantity - a.quantity);
}

/**
 * Get the item most in demand (highest total quantity across all signals).
 * Returns null if no active demands exist.
 */
export function getMostNeededItem(): { itemId: string; totalQuantity: number } | null {
  pruneExpired();
  const totals = new Map<string, number>();
  for (const demand of materialDemands.values()) {
    totals.set(demand.itemId, (totals.get(demand.itemId) ?? 0) + demand.quantity);
  }
  if (totals.size === 0) return null;
  let bestItem = "";
  let bestQty = 0;
  for (const [itemId, qty] of totals) {
    if (qty > bestQty) { bestQty = qty; bestItem = itemId; }
  }
  return bestItem ? { itemId: bestItem, totalQuantity: bestQty } : null;
}

// ── Full cleanup (on process stop) ───────────────────────────

/** Release all claims and demands registered by a bot. Call when a bot stops. */
export function releaseAllClaims(botName: string): void {
  stationClaims.delete(botName);
  tradeRouteClaims.delete(botName);
  clearAllMaterialNeeds(botName);
  // Also release mining claim (imported separately to avoid circular dep)
}

/** Snapshot of all coordinator state (for debug / UI display). */
export function getCoordinatorSnapshot(): {
  stationClaims: StationClaim[];
  tradeRouteClaims: TradeRouteClaim[];
  materialDemands: MaterialDemand[];
} {
  pruneExpired();
  return {
    stationClaims: [...stationClaims.values()],
    tradeRouteClaims: [...tradeRouteClaims.values()],
    materialDemands: [...materialDemands.values()],
  };
}
