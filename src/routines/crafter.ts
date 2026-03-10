import type { Routine, RoutineContext } from "../bot.js";
import { broadcastMaterialNeed, clearMaterialNeed } from "../swarmcoord.js";
import {
  ensureDocked,
  tryRefuel,
  repairShip,
  ensureFueled,
  detectAndRecoverFromDeath,
  navigateToSystem,
  readSettings,
  scavengeWrecks,
  sleep,
  logFactionActivity,
  logAgentEvent,
  getReservedForGoals,
  sleepBot,
} from "./common.js";

// ── Settings ─────────────────────────────────────────────────

interface CraftLimit {
  recipeId: string;
  limit: number;
}

function getCrafterSettings(): {
  craftLimits: CraftLimit[];
  refuelThreshold: number;
  repairThreshold: number;
  cycleDelayMs: number;
  autoCraft: boolean;
  minProfitPct: number;
  maxAutoCraftRecipes: number;
  /** Max units of any single output item allowed in faction storage before crafting is paused. 0 = unlimited. */
  maxFactionStoragePerItem: number;
} {
  const all = readSettings();
  const c = all.crafter || {};
  const rawLimits = (c.craftLimits as Record<string, number>) || {};
  const craftLimits: CraftLimit[] = [];
  for (const [recipeId, limit] of Object.entries(rawLimits)) {
    if (limit > 0) {
      craftLimits.push({ recipeId, limit });
    }
  }
  return {
    craftLimits,
    refuelThreshold: (c.refuelThreshold as number) || 50,
    repairThreshold: (c.repairThreshold as number) || 40,
    cycleDelayMs: (c.cycleDelayMs as number) || 10000,
    // autoCraft: scan all recipes, rank by profit, craft the top ones
    autoCraft: (c.autoCraft as boolean) ?? false,
    minProfitPct: (c.minProfitPct as number) ?? 10,
    maxAutoCraftRecipes: (c.maxAutoCraftRecipes as number) ?? 5,
    maxFactionStoragePerItem: (c.maxFactionStoragePerItem as number) ?? 0,
  };
}

// ── Recipe/inventory helpers ─────────────────────────────────

interface RecipeSkillReq {
  skillId: string;
  skillName: string;
  level: number;
}

interface Recipe {
  recipe_id: string;
  name: string;
  components: Array<{ item_id: string; name: string; quantity: number }>;
  output_item_id: string;
  output_name: string;
  output_quantity: number;
  requiredSkill: RecipeSkillReq | null;
}

function parseRecipes(data: unknown): Recipe[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;

  let raw: Array<Record<string, unknown>> = [];
  if (Array.isArray(d)) {
    raw = d;
  } else if (Array.isArray(d.items)) {
    raw = d.items as Array<Record<string, unknown>>;
  } else if (Array.isArray(d.recipes)) {
    raw = d.recipes as Array<Record<string, unknown>>;
  } else {
    // Object-keyed recipes
    const values = Object.values(d).filter(v => v && typeof v === "object");
    if (values.length > 0 && Array.isArray(values[0])) {
      // Nested arrays — skip
    } else {
      raw = values as Array<Record<string, unknown>>;
    }
  }

  return raw.map(r => {
    const comps = (r.components || r.ingredients || r.inputs || r.materials || []) as Array<Record<string, unknown>>;

    // outputs may be an array (catalog) or a single object (legacy)
    const rawOutputs = r.outputs || r.output || r.result || r.produces;
    const output: Record<string, unknown> = Array.isArray(rawOutputs)
      ? (rawOutputs[0] as Record<string, unknown>) || {}
      : (rawOutputs as Record<string, unknown>) || {};

    // Parse skill requirement from various API shapes
    let requiredSkill: RecipeSkillReq | null = null;
    const skillObj = (r.required_skill || r.skill) as Record<string, unknown> | undefined;
    if (skillObj && typeof skillObj === "object") {
      const sId = (skillObj.skill_id as string) || (skillObj.id as string) || (skillObj.name as string) || "";
      const sName = (skillObj.name as string) || sId;
      const sLevel = (skillObj.level as number) || (skillObj.min_level as number) || 0;
      if (sId && sLevel > 0) requiredSkill = { skillId: sId, skillName: sName, level: sLevel };
    }
    // Also check required_skills: Record<string, number>
    if (!requiredSkill && r.required_skills && typeof r.required_skills === "object") {
      const skills = r.required_skills as Record<string, number>;
      for (const [sId, sLevel] of Object.entries(skills)) {
        if (sLevel > 0) {
          requiredSkill = { skillId: sId, skillName: sId, level: sLevel };
          break; // use the first skill requirement
        }
      }
    }

    return {
      recipe_id: (r.recipe_id as string) || (r.id as string) || "",
      name: (r.name as string) || (r.recipe_id as string) || "",
      components: comps.map(c => ({
        item_id: (c.item_id as string) || (c.id as string) || (c.item as string) || "",
        name: (c.name as string) || (c.item_name as string) || (c.item_id as string) || (c.id as string) || "",
        quantity: (c.quantity as number) || (c.amount as number) || (c.count as number) || 1,
      })),
      output_item_id: (output.item_id as string) || (output.id as string) || (output.item as string) || (r.output_item_id as string) || "",
      output_name: (output.name as string) || (output.item_name as string) || (r.name as string) || "",
      output_quantity: (output.quantity as number) || (output.amount as number) || (output.count as number) || 1,
      requiredSkill,
    };
  }).filter(r => r.recipe_id);
}

/** Return recipes from the catalogStore cache; fetch from API only when cache is empty. */
async function fetchAllRecipes(ctx: RoutineContext): Promise<Recipe[]> {
  const cached = Object.values(ctx.catalogStore.getAll().recipes);
  if (cached.length > 0) {
    const recipes = parseRecipes(cached);
    ctx.log("info", `${recipes.length} recipes loaded from cache`);
    return recipes;
  }

  // Cache empty — populate catalogStore (handles all 4 types + disk persistence)
  ctx.log("info", "Recipe cache empty, fetching from API...");
  try {
    await ctx.catalogStore.fetchAll(ctx.api);
  } catch (err) {
    ctx.log("error", `Catalog fetch failed: ${err}`);
    return [];
  }
  const fresh = Object.values(ctx.catalogStore.getAll().recipes);
  const recipes = parseRecipes(fresh);
  ctx.log("info", `${recipes.length} recipes fetched and cached`);
  return recipes;
}

/** Count how many of an item exist in cargo + storage + faction storage. */
function countItem(ctx: RoutineContext, itemId: string): number {
  const { bot } = ctx;
  let total = 0;
  for (const i of bot.inventory) {
    if (i.itemId === itemId) total += i.quantity;
  }
  for (const i of bot.storage) {
    if (i.itemId === itemId) total += i.quantity;
  }
  for (const i of bot.factionStorage) {
    if (i.itemId === itemId) total += i.quantity;
  }
  return total;
}

/** Count how many of an item exist in cargo only. */
function countInCargo(ctx: RoutineContext, itemId: string): number {
  let total = 0;
  for (const i of ctx.bot.inventory) {
    if (i.itemId === itemId) total += i.quantity;
  }
  return total;
}

/**
 * Count how many of an item are available for crafting.
 * Items in cargo are fully available; items in station/faction storage are reduced
 * by the reserved quantity so gather-goal materials are protected.
 */
function countItemAvailable(ctx: RoutineContext, itemId: string, reserved: Map<string, number>): number {
  const { bot } = ctx;
  const inCargo = countInCargo(ctx, itemId);
  let inStorage = 0;
  for (const i of bot.storage) if (i.itemId === itemId) inStorage += i.quantity;
  let inFaction = 0;
  for (const i of bot.factionStorage) if (i.itemId === itemId) inFaction += i.quantity;
  const res = reserved.get(itemId) ?? 0;
  return inCargo + Math.max(0, inStorage - res) + Math.max(0, inFaction - res);
}

/** Maximum items per craft API call (enforced by game server). */
const MAX_CRAFT_BATCH = 10;

// ── In-memory delta helpers ───────────────────────────────────
// These apply API response data directly to bot state, avoiding redundant
// get_cargo / view_storage / view_faction_storage round-trips.

/** Apply a withdraw_items / faction_withdraw_items response to in-memory bot state. */
function applyWithdrawDelta(
  ctx: RoutineContext,
  itemId: string,
  result: Record<string, unknown>,
  source: "faction" | "station",
): void {
  const { bot } = ctx;
  // cargo_total = exact new quantity of this item in cargo
  const cargoTotal = result.cargo_total as number | undefined;
  if (cargoTotal !== undefined) {
    const inv = bot.inventory.find(i => i.itemId === itemId);
    if (inv) inv.quantity = cargoTotal;
    else if (cargoTotal > 0) bot.inventory.push({ itemId, name: itemId, quantity: cargoTotal });
  }
  // cargo_space = free space remaining → derive cargo used
  if (typeof result.cargo_space === "number") {
    bot.cargo = Math.max(0, bot.cargoMax - (result.cargo_space as number));
  }
  // storage_remaining = exact quantity left in source storage
  const remaining = result.storage_remaining as number | undefined;
  if (remaining !== undefined) {
    const arr = source === "faction" ? bot.factionStorage : bot.storage;
    const entry = arr.find(i => i.itemId === itemId);
    if (entry) entry.quantity = remaining;
  }
}

/** Apply a deposit_items / faction_deposit_items response to in-memory bot state. */
function applyDepositDelta(
  ctx: RoutineContext,
  itemId: string,
  quantity: number,
  result: Record<string, unknown>,
  dest: "faction" | "station",
): void {
  const { bot } = ctx;
  // cargo_remaining = exact quantity left in cargo after deposit
  const cargoRemaining = result.cargo_remaining as number | undefined;
  const inv = bot.inventory.find(i => i.itemId === itemId);
  if (inv) {
    inv.quantity = cargoRemaining ?? Math.max(0, inv.quantity - quantity);
    if (inv.quantity <= 0) bot.inventory = bot.inventory.filter(i => i.itemId !== itemId);
  }
  if (typeof result.cargo_space === "number") {
    bot.cargo = Math.max(0, bot.cargoMax - (result.cargo_space as number));
  }
  // storage_total = new total in destination storage
  const storageTotal = result.storage_total as number | undefined;
  if (storageTotal !== undefined) {
    const arr = dest === "faction" ? bot.factionStorage : bot.storage;
    const entry = arr.find(i => i.itemId === itemId);
    if (entry) entry.quantity = storageTotal;
    else arr.push({ itemId, name: itemId, quantity: storageTotal });
  }
}

/** Apply a craft response to in-memory inventory (consume inputs, add outputs). */
function applyCraftDelta(
  ctx: RoutineContext,
  recipe: Recipe,
  batchCount: number,
  result: Record<string, unknown>,
): void {
  const { bot } = ctx;
  for (const comp of recipe.components) {
    const inv = bot.inventory.find(i => i.itemId === comp.item_id);
    if (inv) inv.quantity = Math.max(0, inv.quantity - comp.quantity * batchCount);
  }
  bot.inventory = bot.inventory.filter(i => i.quantity > 0);
  const outputs = result.outputs as Array<{ item_id: string; name?: string; quantity: number }> | undefined;
  if (Array.isArray(outputs)) {
    for (const out of outputs) {
      const inv = bot.inventory.find(i => i.itemId === out.item_id);
      if (inv) inv.quantity += out.quantity;
      else bot.inventory.push({ itemId: out.item_id, name: out.name || out.item_id, quantity: out.quantity });
    }
  }
  // Re-derive bot.cargo from inventory so cargoCapBatches stays accurate across loop iterations
  bot.cargo = bot.inventory.reduce((s, i) => s + i.quantity, 0);
}

/** Withdraw materials from station storage into cargo for a recipe.
 *  count = how many craft batches we want to perform in one go.
 *  Respects gather goal reservations — leaves reserved quantities untouched.
 *  Updates bot state in-memory from API responses — no extra get_cargo calls. */
async function withdrawStorageMaterials(ctx: RoutineContext, recipe: Recipe, count = 1): Promise<void> {
  const { bot } = ctx;
  const reserved = getReservedForGoals(bot.poi ?? "", bot.username);
  for (const comp of recipe.components) {
    const inCargo = countInCargo(ctx, comp.item_id);
    const wantInCargo = comp.quantity * count;
    if (inCargo >= wantInCargo) continue;

    const actualCargo = bot.inventory.reduce((s, i) => s + i.quantity, 0);
    const freeSpace = bot.cargoMax > 0 ? bot.cargoMax - actualCargo : 0;
    if (freeSpace <= 0) break;

    const needed = wantInCargo - inCargo;
    const inStorage = bot.storage.find(i => i.itemId === comp.item_id);
    if (!inStorage || inStorage.quantity <= 0) continue;

    // Leave reserved quantities for active gather goals at this station
    const reservedQty = reserved.get(comp.item_id) ?? 0;
    const available = inStorage.quantity - reservedQty;
    if (available <= 0) continue;

    const withdrawQty = Math.min(needed, available, freeSpace);
    const resp = await bot.exec("withdraw_items", { item_id: comp.item_id, quantity: withdrawQty });
    if (!resp.error) {
      ctx.log("craft", `Withdrew ${withdrawQty}x ${comp.name || comp.item_id} from station storage`);
      applyWithdrawDelta(ctx, comp.item_id, resp.result as Record<string, unknown> || {}, "station");
    }
  }
}

/** Withdraw materials from faction storage into cargo for a recipe.
 *  count = how many craft batches we want to perform in one go.
 *  Respects gather goal reservations — leaves reserved quantities untouched.
 *  Updates bot state in-memory from API responses — no extra get_cargo calls. */
async function withdrawFactionMaterials(ctx: RoutineContext, recipe: Recipe, count = 1): Promise<void> {
  const { bot } = ctx;
  const reserved = getReservedForGoals(bot.poi ?? "", bot.username);
  for (const comp of recipe.components) {
    const inCargo = countInCargo(ctx, comp.item_id);
    const wantInCargo = comp.quantity * count;
    if (inCargo >= wantInCargo) continue;

    const actualCargo2 = bot.inventory.reduce((s, i) => s + i.quantity, 0);
    const freeSpace = bot.cargoMax > 0 ? bot.cargoMax - actualCargo2 : 0;
    if (freeSpace <= 0) break;

    const needed = wantInCargo - inCargo;
    const inFaction = bot.factionStorage.find(i => i.itemId === comp.item_id);
    if (!inFaction || inFaction.quantity <= 0) continue;

    // Leave reserved quantities for active gather goals at this station
    const reservedQty = reserved.get(comp.item_id) ?? 0;
    const available = inFaction.quantity - reservedQty;
    if (available <= 0) {
      ctx.log("craft", `${comp.name || comp.item_id}: ${reservedQty} reserved for gather goal at ${bot.poi} — skipping`);
      continue;
    }

    const withdrawQty = Math.min(needed, available, freeSpace);
    const resp = await bot.exec("faction_withdraw_items", { item_id: comp.item_id, quantity: withdrawQty });
    if (!resp.error) {
      ctx.log("craft", `Withdrew ${withdrawQty}x ${comp.name || comp.item_id} from faction storage`);
      logFactionActivity(ctx, "withdraw", `Withdrew ${withdrawQty}x ${comp.name || comp.item_id} from faction storage`);
      applyWithdrawDelta(ctx, comp.item_id, resp.result as Record<string, unknown> || {}, "faction");
    }
  }
}

/** Check if we have materials in cargo for a recipe. Returns missing item info or null if all present. */
function getMissingMaterial(ctx: RoutineContext, recipe: Recipe): { name: string; itemId: string; need: number; have: number } | null {
  for (const comp of recipe.components) {
    const have = countInCargo(ctx, comp.item_id);
    if (have < comp.quantity) {
      return { name: comp.name || comp.item_id, itemId: comp.item_id, need: comp.quantity, have };
    }
  }
  return null;
}

/** Check if materials exist anywhere (cargo + storage + faction). */
function hasMaterialsAnywhere(ctx: RoutineContext, recipe: Recipe): boolean {
  for (const comp of recipe.components) {
    if (countItem(ctx, comp.item_id) < comp.quantity) return false;
  }
  return true;
}

/** Build a lookup: output_item_id → Recipe[], so we can find all recipes that produce a given item.
 * Multiple recipes may produce the same output (e.g. different recipes for Circuit Board). */
function buildRecipeIndex(recipes: Recipe[]): Map<string, Recipe[]> {
  const index = new Map<string, Recipe[]>();
  for (const r of recipes) {
    if (!r.output_item_id) continue;
    if (!index.has(r.output_item_id)) index.set(r.output_item_id, []);
    index.get(r.output_item_id)!.push(r);
  }
  return index;
}

/**
 * Pick the best recipe from a list of candidates:
 * 1. Prefer the explicitly requested recipe_id (from goal settings).
 * 2. Otherwise prefer a recipe the bot has the skill to craft.
 * 3. Fall back to the first available.
 */
function pickRecipe(
  candidates: Recipe[],
  ctx: RoutineContext,
  preferRecipeId?: string,
): Recipe | null {
  if (candidates.length === 0) return null;
  if (preferRecipeId) {
    const explicit = candidates.find(r => r.recipe_id === preferRecipeId);
    if (explicit) return explicit;
  }
  return candidates.find(r => canCraftSkillwise(ctx, r).ok) ?? candidates[0];
}

/**
 * Attempt to craft prerequisite materials that a recipe needs.
 * For each missing component, check if there's a recipe to produce it,
 * and if raw materials are available, craft it first.
 * Returns list of items crafted (for logging). Max 2 levels of recursion.
 */
async function craftPrerequisites(
  ctx: RoutineContext,
  recipe: Recipe,
  recipeIndex: Map<string, Recipe[]>,
  depth: number = 0,
): Promise<string[]> {
  if (depth > 2) return []; // prevent infinite recursion
  const { bot } = ctx;
  const crafted: string[] = [];

  for (const comp of recipe.components) {
    const totalAvailable = countItem(ctx, comp.item_id);
    if (totalAvailable >= comp.quantity) continue; // have enough

    const deficit = comp.quantity - totalAvailable;
    const prereqRecipe = pickRecipe(recipeIndex.get(comp.item_id) ?? [], ctx);
    if (!prereqRecipe) continue; // no suitable recipe to craft this item

    // Skip if the bot lacks the required skill for this prereq recipe
    const prereqSkill = canCraftSkillwise(ctx, prereqRecipe);
    if (!prereqSkill.ok) {
      ctx.log("warn", `[craftPrerequisites] Skill too low for '${prereqRecipe.name}': ${prereqSkill.reason} — cannot craft prereq`);
      continue;
    }

    // How many batches do we need? (each batch produces output_quantity)
    const batchesNeeded = Math.ceil(deficit / (prereqRecipe.output_quantity || 1));

    // Recursively craft sub-prerequisites first
    const subCrafted = await craftPrerequisites(ctx, prereqRecipe, recipeIndex, depth + 1);
    crafted.push(...subCrafted);

    // Refresh cargo after sub-crafting to get updated counts
    await bot.refreshCargo();

    // Check if we can craft the prerequisite now
    if (!hasMaterialsAnywhere(ctx, prereqRecipe)) continue;

    // Withdraw materials for the prerequisite
    // First deposit any non-essential cargo to make space
    for (const item of [...bot.inventory]) {
      if (item.quantity <= 0) continue;
      const lower = item.itemId.toLowerCase();
      if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
      if (prereqRecipe.components.some(c => c.item_id === item.itemId)) continue;
      const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      if (!dResp.error) {
        applyDepositDelta(ctx, item.itemId, item.quantity, dResp.result as Record<string, unknown> || {}, "faction");
      } else {
        await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    }

    await withdrawFactionMaterials(ctx, prereqRecipe);
    await withdrawStorageMaterials(ctx, prereqRecipe);

    const stillMissing = getMissingMaterial(ctx, prereqRecipe);
    if (stillMissing) continue; // can't get all materials into cargo

    // Craft all needed batches (in chunks of MAX_CRAFT_BATCH)
    let remaining = batchesNeeded;
    while (remaining > 0 && bot.state === "running") {
      const chunk = Math.min(remaining, MAX_CRAFT_BATCH);
      const craftResp = await bot.exec("craft", { recipe_id: prereqRecipe.recipe_id, count: chunk });
      if (craftResp.error) break;
      const result = craftResp.result as Record<string, unknown> | undefined || {};
      const qty = (result?.count as number) || (result?.quantity as number) || (prereqRecipe.output_quantity * chunk);
      crafted.push(`${qty}x ${prereqRecipe.output_name || prereqRecipe.name}`);
      bot.stats.totalCrafted += qty;
      applyCraftDelta(ctx, prereqRecipe, chunk, result);
      remaining -= chunk;
      if (remaining > 0) {
        await withdrawFactionMaterials(ctx, prereqRecipe);
        await withdrawStorageMaterials(ctx, prereqRecipe);
        if (getMissingMaterial(ctx, prereqRecipe)) break;
      }
    }
  }

  return crafted;
}

/**
 * Grind crafting XP by crafting the simplest recipes we have materials for.
 * Tries up to 5 crafts of the cheapest available recipe to level up skill.
 * Returns list of items crafted for logging.
 */
async function grindCraftingXP(
  ctx: RoutineContext,
  recipes: Recipe[],
  recipeIndex: Map<string, Recipe[]>,
  allowedRecipeIds?: Set<string>,
  excludeRecipeIds?: Set<string>,
): Promise<string[]> {
  const { bot } = ctx;
  const crafted: string[] = [];

  // Find recipes we can actually craft right now (have materials, not skill-blocked)
  // Only consider recipes from settings (or their prerequisites) — not random items
  const candidates: Array<{ recipe: Recipe; complexity: number }> = [];

  for (const recipe of recipes) {
    // Skip recipes banned by game rules this session
    if (excludeRecipeIds?.has(recipe.recipe_id)) continue;
    // If settings specify allowed recipes, only grind those (or their components)
    if (allowedRecipeIds && allowedRecipeIds.size > 0) {
      const isAllowed = allowedRecipeIds.has(recipe.recipe_id) ||
        allowedRecipeIds.has(recipe.name) ||
        allowedRecipeIds.has(recipe.name.toLowerCase());
      // Also allow recipes whose output is a component of an allowed recipe
      // NOTE: recipeIndex is keyed by output_item_id, not recipe_id — look up in recipes array
      const isPrereq = [...allowedRecipeIds].some(allowedId => {
        const parent = recipes.find(r =>
          r.recipe_id === allowedId ||
          r.name === allowedId ||
          r.name.toLowerCase() === allowedId.toLowerCase()
        );
        return parent?.components.some(c => c.item_id === recipe.output_item_id);
      });
      if (!isAllowed && !isPrereq) continue;
    }
    // Skip recipes with no ingredients — they grant no skill XP
    if (recipe.components.length === 0) continue;
    if (!hasMaterialsAnywhere(ctx, recipe)) continue;
    // Only grind recipes we have the skill for
    if (!canCraftSkillwise(ctx, recipe).ok) continue;
    // Complexity = total number of component items needed
    const complexity = recipe.components.reduce((sum, c) => sum + c.quantity, 0);
    candidates.push({ recipe, complexity });
  }

  if (candidates.length === 0) return crafted;

  // Sort by complexity (simplest first — basic refining recipes)
  candidates.sort((a, b) => a.complexity - b.complexity);

  // Try all candidates in order; when one runs out of materials, move to the next
  for (const { recipe: target } of candidates) {
    if (bot.state !== "running") break;

    if (!hasMaterialsAnywhere(ctx, target)) continue;

    // Deposit non-essential cargo to make space for this recipe's materials
    for (const item of [...bot.inventory]) {
      if (item.quantity <= 0) continue;
      const lower = item.itemId.toLowerCase();
      if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
      if (target.components.some(c => c.item_id === item.itemId)) continue;
      const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
      if (!dResp.error) {
        applyDepositDelta(ctx, item.itemId, item.quantity, dResp.result as Record<string, unknown> || {}, "faction");
      } else {
        await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
      }
    }

    ctx.log("craft", `Grinding XP: ${target.name} (${target.components.map(c => `${c.quantity}x ${c.name}`).join(", ")})`);

    // Craft until materials are exhausted for this candidate
    while (bot.state === "running") {
      if (!hasMaterialsAnywhere(ctx, target)) break;

      // Calculate how many batches to pull BEFORE withdrawing so withdrawal fills cargo
      // for multiple crafts rather than just 1 (the old bug: withdraw count defaulted to 1).
      const reserved = getReservedForGoals(bot.poi ?? "", bot.username);
      let wantBatches = MAX_CRAFT_BATCH;
      if (target.components.length > 0) {
        const currentCargo = bot.inventory.reduce((s, i) => s + i.quantity, 0);
        const slotsPerCraft = target.components.reduce((s, c) => s + c.quantity, 0);
        const freeSlots = bot.cargoMax > 0 ? bot.cargoMax - currentCargo : 0;
        const cargoCapBatches = slotsPerCraft > 0 ? Math.max(1, Math.floor(freeSlots / slotsPerCraft)) : MAX_CRAFT_BATCH;
        const availBatches = target.components.reduce((min, c) => {
          const avail = countItemAvailable(ctx, c.item_id, reserved);
          return Math.min(min, Math.floor(avail / c.quantity));
        }, MAX_CRAFT_BATCH);
        wantBatches = Math.max(1, Math.min(MAX_CRAFT_BATCH, cargoCapBatches, availBatches));
      }

      await withdrawFactionMaterials(ctx, target, wantBatches);
      await withdrawStorageMaterials(ctx, target, wantBatches);

      if (getMissingMaterial(ctx, target)) break;

      // Calculate actual batch from what landed in cargo
      let batchCount = 1;
      if (target.components.length > 0) {
        batchCount = target.components.reduce((min, c) => {
          const have = countInCargo(ctx, c.item_id);
          return Math.min(min, Math.floor(have / c.quantity));
        }, 99);
        batchCount = Math.max(1, Math.min(batchCount, MAX_CRAFT_BATCH));
      }

      const craftResp = await bot.exec("craft", { recipe_id: target.recipe_id, count: batchCount });
      if (craftResp.error) break;

      const result = craftResp.result as Record<string, unknown> | undefined || {};
      const qty = (result?.count as number) || (result?.quantity as number) || (target.output_quantity * batchCount);
      crafted.push(`${qty}x ${target.output_name || target.name}`);
      bot.stats.totalCrafted += qty;
      applyCraftDelta(ctx, target, batchCount, result);

      // Flush crafted output if cargo is getting full to prevent accumulation
      if (bot.cargoMax > 0 && bot.inventory.reduce((s, i) => s + i.quantity, 0) / bot.cargoMax > 0.75) {
        await dumpCargo(ctx);
      }
    }
  }

  return crafted;
}

// ── Profitability engine ──────────────────────────────────

export interface RecipeProfitability {
  recipe: Recipe;
  /** Price we can sell 1 unit of output for at any known market. null = no data. */
  outputPrice: number | null;
  /** Total market cost to BUY all missing inputs (owned items cost 0). */
  inputCost: number;
  /** Net profit per craft cycle: outputPrice * outputQty - inputCost. */
  profit: number;
  /** profit / inputCost * 100. Infinity when inputs are all owned. */
  profitPct: number;
  /** True when all inputs exist in faction/station storage right now. */
  fullyFunded: boolean;
  /** Where to sell output — best market across all known stations. */
  bestSellPoi: string | null;
}

/**
 * Calculate profitability of a recipe at the current moment.
 *
 * Input cost accounts for items already owned in faction/station/cargo storage
 * (those are treated as free — opportunity cost is ignored intentionally so the
 * crafter prioritises consuming existing stockpiles).
 */
export function getRecipeProfitability(ctx: RoutineContext, recipe: Recipe): RecipeProfitability {
  const { bot, mapStore } = ctx;

  // ── Output revenue ──
  const bestSell = mapStore.getBestSellToMarketPrice(recipe.output_item_id);
  const outputPrice = bestSell?.price ?? null;

  // ── Input cost (zero for owned items) ──
  let inputCost = 0;
  for (const comp of recipe.components) {
    const owned = countItem(ctx, comp.item_id);
    const shortfall = Math.max(0, comp.quantity - owned);
    if (shortfall <= 0) continue;

    // Use current-station price first, fall back to best known price anywhere
    const localPrice = bot.poi
      ? mapStore.getPriceAt(comp.item_id, bot.poi, 'buy_from_market')
      : null;
    const globalBest = mapStore.findBestSellPrice(comp.item_id);
    const unitCost = localPrice ?? globalBest?.price ?? 0;
    inputCost += unitCost * shortfall;
  }

  // ── Derived metrics ──
  const outputValue = outputPrice !== null ? outputPrice * (recipe.output_quantity || 1) : null;
  const profit      = outputValue !== null ? outputValue - inputCost : -inputCost;
  const profitPct   = inputCost > 0
    ? (profit / inputCost) * 100
    : (profit > 0 ? Infinity : 0);

  return {
    recipe,
    outputPrice,
    inputCost,
    profit,
    profitPct,
    fullyFunded: hasMaterialsAnywhere(ctx, recipe),
    bestSellPoi: bestSell?.poiId ?? null,
  };
}

/**
 * Deposit all non-essential cargo items to faction storage (fallback: own storage).
 * Called at start/end of cycle AND whenever cargo exceeds the safety threshold mid-craft.
 */
async function dumpCargo(ctx: RoutineContext): Promise<void> {
  const { bot } = ctx;
  if (!bot.docked) return;
  const MIN_FUEL_CELLS = 5;
  for (const item of [...bot.inventory]) {
    if (item.quantity <= 0) continue;
    const lower = item.itemId.toLowerCase();
    if (lower.includes("energy_cell")) continue;
    const qty = lower === "fuel_cell"
      ? Math.max(0, item.quantity - MIN_FUEL_CELLS)
      : item.quantity;
    if (qty <= 0) continue;
    const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: qty });
    if (!dResp.error) {
      applyDepositDelta(ctx, item.itemId, qty, dResp.result as Record<string, unknown> || {}, "faction");
    } else {
      const dResp2 = await bot.exec("deposit_items", { item_id: item.itemId, quantity: qty });
      if (!dResp2.error) {
        applyDepositDelta(ctx, item.itemId, qty, dResp2.result as Record<string, unknown> || {}, "station");
      } else {
        ctx.log("warn", `[dumpCargo] Cannot deposit ${qty}x ${item.name || item.itemId}: ${dResp2.error.message}`);
      }
    }
  }
}

/** Check if the bot has the required skill level to craft a recipe. */
function canCraftSkillwise(ctx: RoutineContext, recipe: Recipe): { ok: boolean; reason: string } {
  if (!recipe.requiredSkill) return { ok: true, reason: "" };
  const { skillId, skillName, level } = recipe.requiredSkill;
  const myLevel = ctx.bot.getSkillLevel(skillId);
  if (myLevel >= level) return { ok: true, reason: "" };
  return { ok: false, reason: `${skillName} Lv${level} required (have Lv${myLevel})` };
}

// ── Crafter score for smart_selector ────────────────────────

/**
 * Quick crafter attractiveness score.
 * Reads the catalog cache only — no API calls, safe to call during scoring.
 *
 * Returns 0 when there is nothing to craft, higher values when more
 * profitable recipes are available with current materials.
 */
export function scoreCrafter(ctx: RoutineContext, minProfitPct = 10): number {
  const cached = Object.values(ctx.catalogStore.getAll().recipes);
  const craftingSkill =
    ctx.bot.getSkillLevel("crafting") ||
    ctx.bot.getSkillLevel("crafting_basic") ||
    ctx.bot.getSkillLevel("manufacturing") ||
    1;

  // No catalog yet — give a moderate base so crafter can run once to populate it
  if (cached.length === 0) return craftingSkill * 6;

  const recipes = parseRecipes(cached).filter(r => r.components.length > 0);
  if (recipes.length === 0) return 0;

  let profitableCount = 0;
  let totalProfit = 0;
  for (const recipe of recipes) {
    if (!canCraftSkillwise(ctx, recipe).ok) continue;
    if (!hasMaterialsAnywhere(ctx, recipe)) continue;
    const p = getRecipeProfitability(ctx, recipe);
    if (p.profitPct >= minProfitPct) {
      profitableCount++;
      totalProfit += p.profit;
    }
  }

  if (profitableCount === 0) return craftingSkill * 4; // skill-based fallback
  const profitBonus = Math.min(30, Math.round(totalProfit / 500));
  return craftingSkill * 5 + profitableCount * 8 + profitBonus;
}

// ── Crafter routine ──────────────────────────────────────────

/**
 * Crafter routine — maintains stock of crafted/refined items:
 *
 * 1. Dock at station
 * 2. Fetch recipes and inventory
 * 3. For each configured recipe with a limit:
 *    - Count current stock (cargo + storage) of output item
 *    - If below limit, craft until limit reached or materials exhausted
 * 4. Refuel, repair
 * 5. Wait, then repeat
 */
export const crafterRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  /** Recipes banned by game rules — skip for the lifetime of this routine run */
  const illegalRecipes = new Set<string>();

  await bot.refreshStatus();

  while (bot.state === "running") {
    // ── Death recovery ──
    const alive = await detectAndRecoverFromDeath(ctx);
    if (!alive) { await sleepBot(ctx, 30000); continue; }

    const settings = getCrafterSettings();

    if (settings.craftLimits.length === 0 && !settings.autoCraft) {
      ctx.log("info", "No craft limits configured and autoCraft is off — check Crafter settings. Waiting 30s...");
      await sleepBot(ctx, 30000);
      continue;
    }

    // ── Scavenge wrecks before docking ──
    yield "scavenge";
    await scavengeWrecks(ctx);

    // ── Dock at station ──
    yield "dock";
    await bot.refreshStatus();
    await ensureDocked(ctx);

    // ── Fetch recipes via catalog ──
    yield "fetch_recipes";
    const recipes = await fetchAllRecipes(ctx);
    if (recipes.length === 0) {
      ctx.log("error", "No recipes available — waiting 60s");
      await sleepBot(ctx, 60000);
      continue;
    }

    // ── Refresh skills for pre-craft skill checks ──
    yield "check_skills";
    await bot.checkSkills();

    // ── Clear cargo space for material withdrawal ──
    // Note: refreshStatus() inside ensureDocked() already populated inventory
    if (bot.docked && bot.inventory.length > 0) {
      const MIN_CRAFT_FUEL_CELLS = 5; // keep as emergency fuel, deposit the rest
      for (const item of [...bot.inventory]) {
        if (item.quantity <= 0) continue;
        const lower = item.itemId.toLowerCase();
        if (lower.includes("energy_cell")) continue; // always keep — it's ship fuel
        let qty = item.quantity;
        if (lower === "fuel_cell") {
          qty = Math.max(0, item.quantity - MIN_CRAFT_FUEL_CELLS);
          if (qty === 0) continue;
        }
        const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: qty });
        if (!dResp.error) {
          applyDepositDelta(ctx, item.itemId, qty, dResp.result as Record<string, unknown> || {}, "faction");
        } else {
          const dResp2 = await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
          if (dResp2.error) {
            ctx.log("warn", `Cannot deposit ${item.quantity}x ${item.name || item.itemId} — stays in cargo (${dResp2.error.message})`);
          }
        }
      }
    }

    // ── Refresh faction storage (station storage already up-to-date from ensureDocked) ──
    if (bot.docked) {
      await bot.refreshFactionStorage();
    }

    // ── Build recipe index for prerequisite lookup ──
    const recipeIndex = buildRecipeIndex(recipes);

    // ── BOM summary: log what's craftable right now (Step 5) ──
    yield "bom_check";
    {
      const craftableNow = recipes.filter(r =>
        r.components.length > 0 &&
        hasMaterialsAnywhere(ctx, r) &&
        canCraftSkillwise(ctx, r).ok
      );
      const profItems = craftableNow
        .map(r => getRecipeProfitability(ctx, r))
        .filter(p => p.outputPrice !== null)
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 5);
      if (craftableNow.length > 0) {
        const profStr = profItems.length > 0
          ? profItems.map(p => `${p.recipe.name} (+${Math.round(p.profit)}cr)`).join(", ")
          : craftableNow.slice(0, 5).map(r => r.name).join(", ");
        ctx.log("craft", `Craftable now (${craftableNow.length}): ${profStr}`);
      }
    }

    // ── Phase 0: Process assigned crafter goals (highest priority) ──────────────
    // Any fleet goal where crafter_bot === this bot's username gets processed here.
    // Gatherer bots deliver materials to this station; once present, we craft and
    // gift/deposit the result. Cargo is dumped whenever it nears capacity.
    let totalCrafted = 0;
    const craftedSummary: string[] = [];
    const prereqSummary: string[] = [];
    const missingSummary: string[] = [];
    const skillSummary: string[] = [];
    const atLimitCount = { count: 0 };

    yield "crafter_goals";
    {
      const allBotSettings = readSettings();
      for (const [settingsKey, botSettings] of Object.entries(allBotSettings)) {
        if (bot.state !== "running") break;
        if (settingsKey === "crafter" || settingsKey === "gatherer" || typeof botSettings !== "object" || !botSettings) continue;
        const bs = botSettings as Record<string, unknown>;
        const arr = (bs.goals as any[] | undefined) ?? [];
        const legacy = (bs.goal || null) as any | null;
        const goals: any[] = arr.length > 0 ? arr : (legacy ? [legacy] : []);
        for (const goal of goals) {
          if (bot.state !== "running") break;
          if (!goal?.crafter_bot || goal.crafter_bot !== bot.username) continue;
          if (goal.goal_type !== "craft" && goal.goal_type !== "crafter") continue;

          const recipe = recipes.find(r =>
            (goal.recipe_id && r.recipe_id === goal.recipe_id) ||
            r.output_item_id === goal.target_id ||
            r.recipe_id === goal.target_id ||
            (goal.target_name && (r.name === goal.target_name || r.output_name === goal.target_name))
          );
          if (!recipe) {
            ctx.log("warn", `[CrafterGoal] No recipe for '${goal.target_name || goal.target_id}' — skipping`);
            continue;
          }
          // Navigate to the goal's target station if this bot is elsewhere
          if (goal.target_system && goal.target_system !== bot.system) {
            ctx.log("craft", `[CrafterGoal] Navigating to ${goal.target_system} for '${goal.target_name || recipe.name}'`);
            await navigateToSystem(ctx, goal.target_system, { fuelThresholdPct: 50, hullThresholdPct: 30 });
            await ensureDocked(ctx);
            await bot.refreshFactionStorage();
          } else if (goal.target_poi && bot.docked && goal.target_poi !== bot.poi) {
            ctx.log("craft", `[CrafterGoal] Need to dock at ${goal.target_poi} — undocking and traveling`);
            await ensureDocked(ctx); // travel within system handled by ensureDocked logic
            await bot.refreshFactionStorage();
          }

          // Skill check BEFORE withdrawing any materials
          const goalSkillOk = canCraftSkillwise(ctx, recipe);
          if (!goalSkillOk.ok) {
            ctx.log("warn", `[CrafterGoal] Skill too low for '${recipe.name}': ${goalSkillOk.reason} — grinding XP`);
            const xpItems = await grindCraftingXP(ctx, recipes, recipeIndex, undefined, illegalRecipes);
            if (xpItems.length > 0) {
              ctx.log("craft", `[CrafterGoal] XP grind: ${xpItems.join(", ")}`);
              await dumpCargo(ctx);
            }
            continue;
          }

          if (!hasMaterialsAnywhere(ctx, recipe)) {
            ctx.log("craft", `[CrafterGoal] Waiting for materials: ${goal.target_name || recipe.name}`);
            continue;
          }
          ctx.log("craft", `[CrafterGoal] Crafting: ${goal.target_name || recipe.name}${goal.gift_target ? ` → gift to ${goal.gift_target}` : ""}`);

          let goalCrafted = 0;
          while (bot.state === "running" && hasMaterialsAnywhere(ctx, recipe)) {
            // Dump cargo if nearly full before pulling more materials
            if (bot.cargoMax > 0 && bot.inventory.reduce((s, i) => s + i.quantity, 0) / bot.cargoMax > 0.75) {
              await dumpCargo(ctx);
            }
            const reserved = getReservedForGoals(bot.poi ?? "");
            let wantBatches = MAX_CRAFT_BATCH;
            if (recipe.components.length > 0) {
              const currentCargo = bot.inventory.reduce((s, i) => s + i.quantity, 0);
              const slotsPerCraft = recipe.components.reduce((s, c) => s + c.quantity, 0);
              const freeSlots = bot.cargoMax > 0 ? bot.cargoMax - currentCargo : 999;
              const cargoCapBatches = slotsPerCraft > 0 ? Math.max(1, Math.floor(freeSlots / slotsPerCraft)) : MAX_CRAFT_BATCH;
              const availBatches = recipe.components.reduce((min, c) => {
                const avail = countItemAvailable(ctx, c.item_id, reserved);
                return Math.min(min, Math.floor(avail / c.quantity));
              }, MAX_CRAFT_BATCH);
              wantBatches = Math.max(1, Math.min(MAX_CRAFT_BATCH, cargoCapBatches, availBatches));
            }
            await withdrawFactionMaterials(ctx, recipe, wantBatches);
            await withdrawStorageMaterials(ctx, recipe, wantBatches);
            if (getMissingMaterial(ctx, recipe)) break;

            let batchCount = 1;
            if (recipe.components.length > 0) {
              batchCount = recipe.components.reduce((min, c) => {
                const have = countInCargo(ctx, c.item_id);
                return Math.min(min, Math.floor(have / c.quantity));
              }, 99);
              batchCount = Math.max(1, Math.min(batchCount, MAX_CRAFT_BATCH));
            }
            yield `crafter_goal_${recipe.recipe_id}`;
            const craftResp = await bot.exec("craft", { recipe_id: recipe.recipe_id, count: batchCount });
            if (craftResp.error) {
              ctx.log("error", `[CrafterGoal] ${recipe.name}: ${craftResp.error.message}`);
              break;
            }
            const result = craftResp.result as Record<string, unknown> || {};
            const qty = (result?.count as number) || (result?.quantity as number) || batchCount;
            goalCrafted += qty;
            totalCrafted += qty;
            bot.stats.totalCrafted += qty;
            applyCraftDelta(ctx, recipe, batchCount, result);
            // Flush cargo immediately if next batch is not possible
            if (!hasMaterialsAnywhere(ctx, recipe)) {
              await dumpCargo(ctx);
              break;
            }
          }

          if (goalCrafted > 0) {
            craftedSummary.push(`${goalCrafted}x ${recipe.name} [goal]`);
            const outputId = recipe.output_item_id || recipe.recipe_id;
            const outputItem = bot.inventory.find(i => i.itemId === outputId);
            if (outputItem && outputItem.quantity > 0) {
              if (goal.gift_target) {
                const giftResp = await bot.exec("send_gift", {
                  recipient: goal.gift_target,
                  item_id: outputId,
                  quantity: outputItem.quantity,
                });
                if (!giftResp.error) {
                  ctx.log("trade", `[CrafterGoal] Gifted ${outputItem.quantity}x ${recipe.name} to ${goal.gift_target}`);
                  applyDepositDelta(ctx, outputId, outputItem.quantity, giftResp.result as Record<string, unknown> || {}, "station");
                } else {
                  ctx.log("error", `[CrafterGoal] Gift to ${goal.gift_target} failed: ${giftResp.error.message} — depositing to storage`);
                  await dumpCargo(ctx);
                }
              } else {
                await dumpCargo(ctx);
              }
            }
          }
        }
      }
    }

    for (const { recipeId, limit } of settings.craftLimits) {
      if (bot.state !== "running") break;
      if (illegalRecipes.has(recipeId)) continue;

      const recipe = recipes.find(r =>
        r.recipe_id === recipeId ||
        r.name === recipeId ||
        r.name.toLowerCase() === recipeId.toLowerCase()
      );
      if (!recipe) {
        const similar = recipes
          .filter(r => r.recipe_id.toLowerCase().includes(recipeId.toLowerCase()) || r.name.toLowerCase().includes(recipeId.toLowerCase()))
          .slice(0, 5)
          .map(r => `${r.recipe_id} (${r.name})`);
        ctx.log("error", `Recipe "${recipeId}" not found${similar.length > 0 ? ` — similar: ${similar.join(", ")}` : ""}`);
        continue;
      }

      const outputId = recipe.output_item_id || recipeId;
      const currentStock = countItem(ctx, outputId);
      let needed = limit - currentStock;

      // Economy boost: if the fleet has a supply deficit for this item, increase the target
      if (needed <= 0 && ctx.getEconomySnapshot) {
        const snap = ctx.getEconomySnapshot();
        const deficit = snap?.deficits.find(d => d.itemId === outputId);
        if (deficit) {
          const boost = Math.ceil(deficit.shortfall);
          if (boost > 0) {
            ctx.log("craft", `Economy deficit for ${recipe.output_name || recipe.name}: +${boost} units needed (priority: ${deficit.priority})`);
            needed = boost;
          }
        }
      }

      if (needed <= 0) {
        atLimitCount.count++;
        continue;
      }

      // Faction storage quota: stop if already over the per-item cap
      if (settings.maxFactionStoragePerItem > 0) {
        const inFactionStorage = bot.factionStorage.find(i => i.itemId === outputId)?.quantity ?? 0;
        if (inFactionStorage >= settings.maxFactionStoragePerItem) {
          ctx.log("craft", `${recipe.output_name || recipe.name}: faction storage at ${inFactionStorage}/${settings.maxFactionStoragePerItem} — skipping (quota reached)`);
          atLimitCount.count++;
          clearMaterialNeed(bot.username, outputId);
          continue;
        }
      }

      // ── Skill check: don't withdraw materials if we can't craft this yet ──
      const skillCheck = canCraftSkillwise(ctx, recipe);
      if (!skillCheck.ok) {
        // Skill too low — grind XP on simpler recipes instead of pulling materials
        const allowedIds = new Set(settings.craftLimits.map(cl => cl.recipeId));
        let xpCrafted = await grindCraftingXP(ctx, recipes, recipeIndex, allowedIds, illegalRecipes);
        if (xpCrafted.length === 0) {
          xpCrafted = await grindCraftingXP(ctx, recipes, recipeIndex, undefined, illegalRecipes);
        }
        if (xpCrafted.length > 0) {
          await dumpCargo(ctx); // flush crafted XP items before next recipe
          skillSummary.push(`${recipe.name} (${skillCheck.reason}, ground ${xpCrafted.join(", ")} for XP)`);
        } else {
          skillSummary.push(`${recipe.name} (${skillCheck.reason})`);
        }
        continue;
      }

      // Craft in batches
      let crafted = 0;
      let hitSkillBlock = false;
      let storageRefreshedThisRecipe = false; // avoid repeated storage API calls per iteration
      while (crafted < needed && bot.state === "running") {
        // ── Calculate how many we can/should craft in one API call ──────────
        const remaining = needed - crafted;
        // Cap by what's available anywhere, respecting gather-goal reservations
        const craftReserved = getReservedForGoals(bot.poi ?? "");
        const availableFromAll = recipe.components.length > 0
          ? recipe.components.reduce((min, c) => {
              const avail = countItemAvailable(ctx, c.item_id, craftReserved);
              return Math.min(min, Math.floor(avail / c.quantity));
            }, remaining)
          : remaining;
        // Cap by cargo capacity: how many full sets fit in free space
        // Use inventory sum (not bot.cargo) — applyCraftDelta keeps inventory current but not bot.cargo
        let cargoCapBatches = remaining;
        if (recipe.components.length > 0 && bot.cargoMax > 0) {
          const slotsPerCraft = recipe.components.reduce((s, c) => s + c.quantity, 0);
          const currentCargo = bot.inventory.reduce((s, i) => s + i.quantity, 0);
          const freeSlots = bot.cargoMax - currentCargo;
          if (slotsPerCraft > 0) cargoCapBatches = Math.max(1, Math.floor(freeSlots / slotsPerCraft));
        }
        if (availableFromAll === 0) {
          missingSummary.push(`${recipe.name} (all materials reserved for gather goals)`);
          break;
        }
        const batchSize = Math.max(1, Math.min(remaining, MAX_CRAFT_BATCH, availableFromAll, cargoCapBatches));

        const missing = getMissingMaterial(ctx, recipe);
        if (missing) {
          // Lazy-load storage: only refresh once per recipe when we need to pull materials
          if (bot.docked && !storageRefreshedThisRecipe) {
            await bot.refreshStorage();
            await bot.refreshFactionStorage();
            storageRefreshedThisRecipe = true;
          }
          // Materials not in cargo — try pulling from storage sources (for full batchSize)
          if (hasMaterialsAnywhere(ctx, recipe)) {
            await withdrawFactionMaterials(ctx, recipe, batchSize);
            await withdrawStorageMaterials(ctx, recipe, batchSize);
            const stillMissing = getMissingMaterial(ctx, recipe);
            if (stillMissing) {
              // Try crafting the missing prerequisites
              const preCrafted = await craftPrerequisites(ctx, recipe, recipeIndex);
              if (preCrafted.length > 0) {
                prereqSummary.push(...preCrafted);
                await withdrawFactionMaterials(ctx, recipe, batchSize);
                await withdrawStorageMaterials(ctx, recipe, batchSize);
              }
              const finalMissing = getMissingMaterial(ctx, recipe);
              if (finalMissing) {
                missingSummary.push(`${recipe.name} (${finalMissing.need}x ${finalMissing.name})`);
                broadcastMaterialNeed(bot.username, finalMissing.itemId, finalMissing.need - finalMissing.have);
                break;
              }
            }
          } else {
            // Materials don't exist anywhere — try crafting prerequisites
            const preCrafted = await craftPrerequisites(ctx, recipe, recipeIndex);
            if (preCrafted.length > 0) {
              prereqSummary.push(...preCrafted);
              await withdrawFactionMaterials(ctx, recipe, batchSize);
              await withdrawStorageMaterials(ctx, recipe, batchSize);
              const finalMissing = getMissingMaterial(ctx, recipe);
              if (finalMissing) {
                missingSummary.push(`${recipe.name} (${finalMissing.need}x ${finalMissing.name})`);
                broadcastMaterialNeed(bot.username, finalMissing.itemId, finalMissing.need - finalMissing.have);
                break;
              }
            } else {
              missingSummary.push(`${recipe.name} (${missing.need}x ${missing.name})`);
              broadcastMaterialNeed(bot.username, missing.itemId, missing.need - missing.have);
              break;
            }
          }
        } else {
          // All materials already in cargo — still top up to fill the batch
          await withdrawFactionMaterials(ctx, recipe, batchSize);
          await withdrawStorageMaterials(ctx, recipe, batchSize);
        }

        yield `craft_${recipeId}`;
        const craftResp = await bot.exec("craft", { recipe_id: recipe.recipe_id, count: batchSize });

        if (craftResp.error) {
          const msg = craftResp.error.message.toLowerCase();
          if (msg.includes("skill")) {
            hitSkillBlock = true;
          } else if (msg.includes("material") || msg.includes("component") || msg.includes("insufficient")) {
            missingSummary.push(`${recipe.name} (no materials)`);
            const componentList = recipe.components.map(c => {
              const inCargo = countInCargo(ctx, c.item_id);
              return `${c.item_id}(need ${c.quantity}, have ${inCargo})`;
            }).join(", ");
            ctx.log("error", `${recipe.name} components mismatch — local recipe: [${componentList}]`);
          } else if (msg.includes("illegal") || msg.includes("banned") || msg.includes("forbidden") || msg.includes("production_banned") || msg.includes("restricted") || msg.includes("facility-only") || msg.includes("cannot be crafted manually")) {
            illegalRecipes.add(recipe.recipe_id);
            illegalRecipes.add(recipeId);
            ctx.log("error", `Craft ${recipe.name}: not manually craftable — blacklisting for this session`);
          } else {
            ctx.log("error", `Craft ${recipe.name}: ${craftResp.error.message}`);
          }
          break;
        }

        const result = craftResp.result as Record<string, unknown> | undefined || {};
        const actualCount = (result?.count as number) || (result?.quantity as number) || batchSize;
        crafted += actualCount;
        totalCrafted += actualCount;
        bot.stats.totalCrafted += actualCount;
        applyCraftDelta(ctx, recipe, batchSize, result);
        // Flush cargo immediately when no materials left for the next batch
        if (!hasMaterialsAnywhere(ctx, recipe)) {
          await dumpCargo(ctx);
          break;
        }
      }

      if (crafted > 0) {
        craftedSummary.push(`${crafted}x ${recipe.name}`);
        // Dump any remaining crafted output before processing the next recipe
        if (bot.docked) await dumpCargo(ctx);
      }

      // ── Skill too low: try grinding XP on configured recipes only ──
      if (hitSkillBlock && bot.state === "running") {
        const allowedIds = new Set(settings.craftLimits.map(cl => cl.recipeId));
        let xpCrafted = await grindCraftingXP(ctx, recipes, recipeIndex, allowedIds, illegalRecipes);
        if (xpCrafted.length === 0) {
          xpCrafted = await grindCraftingXP(ctx, recipes, recipeIndex, undefined, illegalRecipes);
        }
        if (xpCrafted.length > 0) {
          skillSummary.push(`${recipe.name} (skill too low, ground ${xpCrafted.join(", ")} for XP)`);
        } else {
          skillSummary.push(`${recipe.name} (skill too low, no XP recipes available)`);
        }
      }
    }

    // ── autoCraft: profit-based recipe selection (Step 3) ──
    // Also force autoCraft when ALL configured recipes are skill-blocked and nothing was crafted
    const allSkillBlocked =
      settings.craftLimits.length > 0 &&
      craftedSummary.length === 0 &&
      missingSummary.length === 0 &&
      skillSummary.length > 0 &&
      skillSummary.length + atLimitCount.count >= settings.craftLimits.length &&
      !settings.autoCraft;

    if ((settings.autoCraft || allSkillBlocked) && bot.state === "running") {
      yield "auto_craft_select";
      if (allSkillBlocked) {
        ctx.log("craft", "All target recipes skill-blocked — switching to autoCraft mode for this cycle");
      }

      // Score all recipes: skill ok + has materials + profit >= threshold
      const ranked = recipes
        .filter(r => r.components.length > 0 && canCraftSkillwise(ctx, r).ok && !illegalRecipes.has(r.recipe_id))
        .map(r => getRecipeProfitability(ctx, r))
        .filter(p => p.fullyFunded && p.profitPct >= settings.minProfitPct)
        .sort((a, b) => b.profit - a.profit)
        .slice(0, settings.maxAutoCraftRecipes);

      if (ranked.length === 0) {
        ctx.log("craft", `autoCraft: no recipe meets minProfitPct=${settings.minProfitPct}% with current stock`);
      } else {
        ctx.log("craft", `autoCraft: top picks — ${ranked.map(p => `${p.recipe.name} (${Math.round(p.profitPct)}%)`).join(", ")}`);
      }

      for (const prof of ranked) {
        if (bot.state !== "running") break;
        const recipe = prof.recipe;

        if (!hasMaterialsAnywhere(ctx, recipe)) continue; // materials may have been consumed

        // Compute maximum viable batch respecting gather-goal reservations
        const autoReserved = getReservedForGoals(bot.poi ?? "");
        const targetBatch = (): number => recipe.components.length > 0
          ? Math.min(MAX_CRAFT_BATCH, recipe.components.reduce((min, c) =>
              Math.min(min, Math.floor(countItemAvailable(ctx, c.item_id, autoReserved) / c.quantity)), MAX_CRAFT_BATCH))
          : MAX_CRAFT_BATCH;

        if (targetBatch() === 0) continue; // all materials reserved — skip this recipe

        await withdrawFactionMaterials(ctx, recipe, targetBatch());
        await withdrawStorageMaterials(ctx, recipe, targetBatch());
        if (getMissingMaterial(ctx, recipe)) {
          // Try prereqs once
          const preC = await craftPrerequisites(ctx, recipe, recipeIndex);
          if (preC.length > 0) prereqSummary.push(...preC);
          await withdrawFactionMaterials(ctx, recipe, targetBatch());
          await withdrawStorageMaterials(ctx, recipe, targetBatch());
          if (getMissingMaterial(ctx, recipe)) continue;
        }

        // Calculate max batches from current cargo and craft in one shot, then loop if more available
        while (hasMaterialsAnywhere(ctx, recipe) && bot.state === "running") {
          const batchCount = recipe.components.length > 0
            ? Math.min(MAX_CRAFT_BATCH, recipe.components.reduce((min, c) => {
                const have = countInCargo(ctx, c.item_id);
                return Math.min(min, Math.floor(have / c.quantity));
              }, MAX_CRAFT_BATCH))
            : 1;
          if (batchCount === 0) break; // nothing in cargo after withdrawal — all reserved
          yield `auto_craft_${recipe.recipe_id}`;
          const craftResp = await bot.exec("craft", { recipe_id: recipe.recipe_id, count: batchCount });
          if (craftResp.error) {
            const emsg = craftResp.error.message.toLowerCase();
            if (emsg.includes("facility-only") || emsg.includes("cannot be crafted manually") || emsg.includes("illegal") || emsg.includes("banned") || emsg.includes("production_banned")) {
              illegalRecipes.add(recipe.recipe_id);
              ctx.log("error", `autoCraft ${recipe.name}: not manually craftable — blacklisting`);
            } else {
              ctx.log("error", `autoCraft ${recipe.name}: ${craftResp.error.message}`);
            }
            break;
          }
          const result = craftResp.result as Record<string, unknown> || {};
          const qty = (result?.count as number) || (result?.quantity as number) || recipe.output_quantity * batchCount;
          totalCrafted += qty;
          bot.stats.totalCrafted += qty;
          craftedSummary.push(`${qty}x ${recipe.name}`);
          applyCraftDelta(ctx, recipe, batchCount, result);
          if (!hasMaterialsAnywhere(ctx, recipe)) {
            await dumpCargo(ctx);
            break;
          }
          await withdrawFactionMaterials(ctx, recipe, targetBatch());
          await withdrawStorageMaterials(ctx, recipe, targetBatch());
          if (getMissingMaterial(ctx, recipe)) {
            await dumpCargo(ctx);
            break;
          }
        }
      }
    }

    // ── Deposit crafted goods back to faction storage ──
    if (totalCrafted > 0 && bot.docked) {
      const depositedItems: string[] = [];
      for (const item of [...bot.inventory]) {
        if (item.quantity <= 0) continue;
        const lower = item.itemId.toLowerCase();
        if (lower.includes("fuel") || lower.includes("energy_cell")) continue;
        const dResp = await bot.exec("faction_deposit_items", { item_id: item.itemId, quantity: item.quantity });
        if (!dResp.error) {
          depositedItems.push(`${item.quantity}x ${item.name}`);
          logFactionActivity(ctx, "deposit", `Deposited ${item.quantity}x ${item.name} (crafted)`);
          applyDepositDelta(ctx, item.itemId, item.quantity, dResp.result as Record<string, unknown> || {}, "faction");
        } else {
          await bot.exec("deposit_items", { item_id: item.itemId, quantity: item.quantity });
        }
      }
      if (depositedItems.length > 0) {
        ctx.log("trade", `Deposited to faction: ${depositedItems.join(", ")}`);
      }
    }

    // ── Single summary line ──
    const parts: string[] = [];
    if (craftedSummary.length > 0) parts.push(`Crafted ${craftedSummary.join(", ")}`);
    if (prereqSummary.length > 0) parts.push(`Prereqs: ${prereqSummary.join(", ")}`);
    if (atLimitCount.count > 0) parts.push(`${atLimitCount.count} at limit`);
    if (skillSummary.length > 0) parts.push(`Skill: ${skillSummary.join(", ")}`);
    if (missingSummary.length > 0) parts.push(`Missing: ${missingSummary.join(", ")}`);
    if (parts.length > 0) {
      ctx.log("craft", parts.join(". "));
    } else {
      ctx.log("craft", "Nothing to craft");
    }
    if (totalCrafted > 0) {
      logAgentEvent(ctx, "economy", "info",
        `Crafted ${craftedSummary.join(", ")} (${totalCrafted} items)`,
        { total_crafted: totalCrafted, items: craftedSummary },
      );
    }

    // ── Refuel + Repair ──
    yield "refuel";
    await ensureFueled(ctx, settings.refuelThreshold);
    yield "repair";
    await repairShip(ctx);

    // ── Check for skill level-ups (only when crafting happened — XP only changes on craft) ──
    if (totalCrafted > 0) {
      yield "check_skills";
      await bot.checkSkills();
    }

    // ── Adaptive cycle delay ──
    // Short delay after productive work; longer when idle or materials are missing
    const productive = totalCrafted > 0 || prereqSummary.length > 0;
    const materialsShortage = missingSummary.length > 0;
    const delayMs = productive
      ? settings.cycleDelayMs
      : materialsShortage
        ? Math.max(settings.cycleDelayMs * 6, 60000)   // Wait longer when materials missing
        : settings.cycleDelayMs * 3;                   // Moderate wait when nothing to craft
    ctx.log("info", `Waiting ${Math.round(delayMs / 1000)}s before next cycle...`);
    await sleepBot(ctx, delayMs);
  }
};
