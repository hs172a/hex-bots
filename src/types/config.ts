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
  file_logging: z.boolean().default(true),
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

// ── Full Config ──

export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  fleet: FleetConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  commander: CommanderConfigSchema.default({}),
  economy: EconomyConfigSchema.default({}),
  goals: z.array(GoalSchema).default([]),
  inventory_targets: z.array(StockTargetSchema).default([]),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
