/**
 * Fleet-wide shared read cache.
 *
 * Unlike the per-bot ResponseCache in api.ts (30 s), this cache is shared
 * across all bot instances in the same process. It is used for expensive
 * query commands that return the same data for every bot at the same location
 * (e.g. view_market at a given POI).
 *
 * The cache is module-level (singleton), so all Bot instances share it.
 */

import type { ApiResponse } from "./api.js";

const MARKET_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: ApiResponse;
  expiresAt: number;
}

class SharedMarketCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(poiId: string): ApiResponse | null {
    const entry = this.entries.get(poiId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(poiId);
      return null;
    }
    return entry.data;
  }

  set(poiId: string, data: ApiResponse): void {
    this.entries.set(poiId, { data, expiresAt: Date.now() + MARKET_TTL_MS });
  }

  /** Invalidate market data for a specific POI (e.g. after a buy/sell). */
  invalidate(poiId: string): void {
    this.entries.delete(poiId);
  }

  /** Diagnostic: number of live entries. */
  get size(): number {
    const now = Date.now();
    let count = 0;
    for (const e of this.entries.values()) {
      if (now <= e.expiresAt) count++;
    }
    return count;
  }
}

export const sharedMarketCache = new SharedMarketCache();
