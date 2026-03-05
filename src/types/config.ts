/**
 * Application configuration types with Zod validation.
 * Loaded from config.toml at startup.
 */

import { z } from "zod/v3";
// Note: Using zod/v3 compat API since zod@4 changed .default() semantics

// ── Server Config ──

export const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().default("localhost"),
});

// ── Fleet Config ──

export const FleetConfigSchema = z.object({
  /** Max concurrent bots */
  max_bots: z.number().int().default(20),
  /** Delay between bot logins (ms) */
  login_stagger_ms: z.number().default(5000),
  /** Fleet home system ID (bots return here for deposits) */
  home_system: z.string().default(""),
  /** Fleet home base/station ID (shared storage hub) */
  home_base: z.string().default(""),
  /** Default cargo disposal mode for all bots */
  default_storage_mode: z.enum(["sell", "deposit", "faction_deposit", "combi"]).default("sell"),
  /** Specific station for faction storage deposits */
  faction_storage_station: z.string().default(""),
  /** Percent of profit to deposit into faction treasury (0-100) */
  faction_donate_pct: z.number().min(0).max(100).default(0),
  /** Minimum credits a bot should maintain (0 = disabled) */
  min_bot_credits: z.number().min(0).default(0),
});

// ── Goal Types (for future Commander integration) ──

export const GoalTypeSchema = z.enum([
  "maximize_income",
  "explore_region",
  "prepare_for_war",
  "level_skills",
  "establish_trade_route",
  "resource_stockpile",
  "faction_operations",
  "custom",
]);

export type GoalType = z.infer<typeof GoalTypeSchema>;

export const GoalSchema = z.object({
  type: GoalTypeSchema,
  priority: z.number().int().min(1),
  params: z.record(z.unknown()).default({}),
  constraints: z.object({
    maxRiskLevel: z.number().int().min(0).max(4).optional(),
    regionLock: z.array(z.string()).optional(),
    budgetLimit: z.number().optional(),
  }).optional(),
});

export type Goal = z.infer<typeof GoalSchema>;

// ── Commander Config (for future Commander integration) ──

export const CommanderConfigSchema = z.object({
  brain: z.enum(["scoring", "llm", "hybrid"]).default("scoring"),
  evaluation_interval: z.number().default(180),
  reassignment_cooldown: z.number().default(300),
  reassignment_threshold: z.number().default(0.3),
  urgency_override: z.boolean().default(true),
});

// ── Logging Config ──

export const LoggingConfigSchema = z.object({
  /** Enable API call logging to files */
  api_logging: z.boolean().default(false),
  /** Enable file logging (console tee to logs/) */
  file_logging: z.boolean().default(false),
});

// ── Economy Config (for future Economy Engine) ──

export const EconomyConfigSchema = z.object({
  enable_premium_orders: z.boolean().default(true),
  max_premium_pct: z.number().default(50),
  min_crafting_margin_pct: z.number().default(30),
  batch_sell_size: z.number().default(100),
});

// ── Stock Target (for future inventory management) ──

export const StockTargetSchema = z.object({
  station_id: z.string(),
  item_id: z.string(),
  min_stock: z.number().int().min(0),
  max_stock: z.number().int().min(0),
  purpose: z.enum(["crafting", "trading", "fuel", "ammo", "strategic"]),
});

export type StockTarget = z.infer<typeof StockTargetSchema>;

// ── DataSync Config (shared game knowledge across VMs) ──

export const DataSyncConfigSchema = z.object({
  /** Enable the data sync service. */
  enabled: z.boolean().default(false),
  /** "master" — expose HTTP sync API; "client" — connect to a master. */
  mode: z.enum(["master", "client"]).default("master"),
  /** (client only) Base URL of the master DataSync server, e.g. http://127.0.0.1:4001 via SSH tunnel */
  master_url: z.string().default(""),
  /** Shared secret sent as Authorization: Bearer <api_key> on all requests. */
  api_key: z.string().default(""),
  /** (master only) Host/IP the sync server binds to. Defaults to 127.0.0.1 (SSH-tunnel model — not exposed to internet). */
  host: z.string().default("127.0.0.1"),
  /** (master only) Port the sync HTTP server listens on. */
  port: z.number().int().default(4001),
  /** (client only) How often to pull updates from master, in seconds. */
  pull_interval_sec: z.number().default(300),
  /** (client only) How often to push market+pirate fast-data to master, in seconds. */
  push_interval_sec: z.number().default(60),
  /** (client only) How often to push full topology (connections, POI structure) to master, in seconds. */
  slow_push_interval_sec: z.number().default(600),
  /** (master only) Reject incoming records whose last_updated is this many seconds in the future (clock skew guard). */
  max_clock_skew_sec: z.number().default(30),
  /** (client only) If the client has been offline longer than this many hours, force a full pull instead of a delta. */
  max_stale_hours: z.number().default(24),
  /** (client only) How often to check master for source code updates (seconds). 0 = disabled. */
  code_sync_interval_sec: z.number().default(0),
  /** Unique name for this pool/VM used in multi-pool stats aggregation.
   *  If omitted, defaults to "<hostname>/<dir>". MUST differ across VMs. */
  pool_name: z.string().default(""),
});

export type DataSyncConfig = z.infer<typeof DataSyncConfigSchema>;

// ── Full Config ──

export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  fleet: FleetConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  commander: CommanderConfigSchema.default({}),
  economy: EconomyConfigSchema.default({}),
  datasync: DataSyncConfigSchema.default({}),
  goals: z.array(GoalSchema).default([]),
  inventory_targets: z.array(StockTargetSchema).default([]),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
