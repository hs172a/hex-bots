/**
 * Configuration loader — reads config.toml and validates with Zod.
 * Falls back to defaults if file is missing or invalid.
 */

import { readFileSync, existsSync } from "fs";
import TOML from "toml";
import { AppConfigSchema, type AppConfig } from "./types/config.js";

const CONFIG_PATH = "config.toml";

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  if (!existsSync(CONFIG_PATH)) {
    console.log("[Config] No config.toml found, using defaults");
    _config = AppConfigSchema.parse({});
    return _config;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = TOML.parse(raw);
    _config = AppConfigSchema.parse(parsed);
    console.log("[Config] Loaded config.toml");
    return _config;
  } catch (err) {
    console.error("[Config] Failed to parse config.toml:", err);
    console.log("[Config] Using defaults");
    _config = AppConfigSchema.parse({});
    return _config;
  }
}

/** Get config (must call loadConfig first). */
export function getConfig(): AppConfig {
  if (!_config) return loadConfig();
  return _config;
}
