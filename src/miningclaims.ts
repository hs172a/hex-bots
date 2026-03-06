/**
 * Mining system claim registry — prevents multiple bots from targeting
 * the same asteroid belt / system at the same time.
 *
 * Module-level singleton: all bot routines in the same process share it.
 * Claims are soft: if no unclaimed option exists, the miner may still
 * proceed to a claimed system rather than idle.
 */

/** Map of systemId → Set of bot usernames currently mining there. */
const claims = new Map<string, Set<string>>();

/** Register a claim for a bot on a specific system. Releases any prior claim. */
export function claimMiningSystem(botName: string, systemId: string): void {
  releaseMiningClaim(botName);
  let claimers = claims.get(systemId);
  if (!claimers) {
    claimers = new Set();
    claims.set(systemId, claimers);
  }
  claimers.add(botName);
}

/** Release a bot's current mining claim (call when done / cargo full / stopped). */
export function releaseMiningClaim(botName: string): void {
  for (const [sysId, claimers] of claims) {
    if (claimers.has(botName)) {
      claimers.delete(botName);
      if (claimers.size === 0) claims.delete(sysId);
      return;
    }
  }
}

/** How many bots are currently mining the given system (0 if unclaimed). */
export function miningClaimCount(systemId: string): number {
  return claims.get(systemId)?.size ?? 0;
}

/** Get all systems currently claimed, with their claimers. (for debug/UI) */
export function getAllMiningClaims(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [sysId, claimers] of claims) {
    if (claimers.size > 0) out[sysId] = [...claimers];
  }
  return out;
}

// ── Remote claims (from other VMs via DataSync) ───────────────

/**
 * Remote claims synced from other VMs: systemId → Set of bot usernames.
 * Populated by DataSyncClient.pushMiningClaims() / DataSyncServer /sync/mining-claims.
 * TTL-based: each entry expires after REMOTE_CLAIM_TTL_MS.
 */
const REMOTE_CLAIM_TTL_MS = 3 * 60 * 1000; // 3 minutes (fast push cadence × 3)

interface RemoteClaim {
  bots: string[];
  expiresAt: number;
}

const remoteClaims = new Map<string, RemoteClaim>();

/** Merge remote claim snapshot received from another VM (or the master). */
export function mergeRemoteClaims(snapshot: Record<string, string[]>): void {
  const now = Date.now();
  const expiresAt = now + REMOTE_CLAIM_TTL_MS;
  // Clear stale remote entries first
  for (const [sysId, rc] of remoteClaims) {
    if (rc.expiresAt <= now) remoteClaims.delete(sysId);
  }
  // Apply snapshot
  for (const [sysId, bots] of Object.entries(snapshot)) {
    if (bots.length > 0) remoteClaims.set(sysId, { bots, expiresAt });
    else remoteClaims.delete(sysId);
  }
}

/**
 * How many bots (local + remote VMs) are currently mining the given system.
 * Returns 0 if unclaimed everywhere.
 */
export function miningClaimCountAll(systemId: string): number {
  const local = claims.get(systemId)?.size ?? 0;
  const now = Date.now();
  const rc = remoteClaims.get(systemId);
  const remote = (rc && rc.expiresAt > now) ? rc.bots.length : 0;
  return local + remote;
}

/** Get all remote claims for UI / debug. */
export function getRemoteMiningClaims(): Record<string, string[]> {
  const now = Date.now();
  const out: Record<string, string[]> = {};
  for (const [sysId, rc] of remoteClaims) {
    if (rc.expiresAt > now && rc.bots.length > 0) out[sysId] = rc.bots;
  }
  return out;
}
