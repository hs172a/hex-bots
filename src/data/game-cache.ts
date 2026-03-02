/**
 * SQLite-backed game data cache service.
 * Wraps CacheHelper for convenient use by routines and API layer.
 * Provides persistent caching for market data, system info, and catalog data
 * that survives restarts (unlike the in-memory ResponseCache in api.ts).
 */

import type { Database } from "bun:sqlite";
import { CacheHelper } from "./database.js";

export class GameCache {
  private cache: CacheHelper;

  constructor(db: Database) {
    this.cache = new CacheHelper(db);
  }

  // ── Market Data (timed cache, 5 min TTL) ──

  /** Cache market data for a station. */
  setMarketData(stationId: string, data: unknown): void {
    this.cache.setTimed(`market:${stationId}`, JSON.stringify(data), 300_000);
  }

  /** Get cached market data for a station (null if expired). */
  getMarketData(stationId: string): unknown | null {
    const raw = this.cache.getTimed(`market:${stationId}`);
    return raw ? JSON.parse(raw) : null;
  }

  // ── System Data (timed cache, 1 hour TTL) ──

  /** Cache system scan data. */
  setSystemData(systemId: string, data: unknown): void {
    this.cache.setTimed(`system:${systemId}`, JSON.stringify(data), 3_600_000);
  }

  /** Get cached system data (null if expired). */
  getSystemData(systemId: string): unknown | null {
    const raw = this.cache.getTimed(`system:${systemId}`);
    return raw ? JSON.parse(raw) : null;
  }

  // ── POI Data (timed cache, 30 min TTL) ──

  /** Cache POI data. */
  setPoiData(poiId: string, data: unknown): void {
    this.cache.setTimed(`poi:${poiId}`, JSON.stringify(data), 1_800_000);
  }

  /** Get cached POI data (null if expired). */
  getPoiData(poiId: string): unknown | null {
    const raw = this.cache.getTimed(`poi:${poiId}`);
    return raw ? JSON.parse(raw) : null;
  }

  // ── Static Catalog (version-gated, permanent) ──

  /** Cache catalog data keyed by type and game version. */
  setCatalogData(type: string, data: unknown, gameVersion: string): void {
    this.cache.setStatic(`catalog:${type}`, JSON.stringify(data), gameVersion);
  }

  /** Get cached catalog data for a type and game version. */
  getCatalogData(type: string, gameVersion?: string): unknown | null {
    const raw = this.cache.getStatic(`catalog:${type}`, gameVersion);
    return raw ? JSON.parse(raw) : null;
  }

  // ── Generic timed cache ──

  /** Set any value with a custom TTL. */
  set(key: string, data: unknown, ttlMs: number): void {
    this.cache.setTimed(key, JSON.stringify(data), ttlMs);
  }

  /** Get any cached value (null if expired/missing). */
  get(key: string): unknown | null {
    const raw = this.cache.getTimed(key);
    return raw ? JSON.parse(raw) : null;
  }

  /** Clear all timed caches (e.g., on version change). */
  clearTimedCaches(): void {
    this.cache.clearTimed();
  }

  /** Clear everything. */
  clearAll(): void {
    this.cache.clearAll();
  }
}
