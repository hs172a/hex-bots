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
