/**
 * Recipe dependency tree resolver.
 *
 * Given a target item + quantity and a bot's current available inventory,
 * builds a tree of what needs to be crafted or gathered from scratch.
 *
 * Algorithm:
 *  1. Check how much of the item is already available.
 *  2. If available >= needed → node is satisfied (no children).
 *  3. If a recipe exists for the item → recurse into components
 *     scaled by the number of craft batches needed.
 *  4. If no recipe → leaf node (must be gathered externally).
 *
 * Leaf nodes with quantity_to_gather > 0 become the gatherer goal materials.
 */

// ── Types ─────────────────────────────────────────────────────

export interface RecipeNode {
  item_id: string;
  item_name: string;
  quantity_needed: number;
  quantity_available: number;
  quantity_to_gather: number;
  /** Has a crafting recipe. */
  has_recipe: boolean;
  /** Satisfied from existing stock — no further work needed for this branch. */
  is_satisfied: boolean;
  /** No recipe + still needed → raw material that must be sourced externally. */
  is_leaf: boolean;
  /** Number of craft operations required (0 when satisfied or leaf). */
  crafts_needed: number;
  /** Output quantity per single craft operation. */
  craft_output_qty: number;
  children: RecipeNode[];
}

export interface GatherNeed {
  item_id: string;
  item_name: string;
  quantity_needed: number;
}

interface ParsedRecipe {
  recipe_id: string;
  output_item_id: string;
  output_name: string;
  output_quantity: number;
  components: Array<{ item_id: string; name: string; quantity: number }>;
}

// ── Recipe index builder ──────────────────────────────────────

/** Parse the raw catalog recipes into a lookup map: output_item_id → ParsedRecipe. */
export function buildRecipeIndex(
  rawRecipes: Record<string, Record<string, unknown>>,
): Map<string, ParsedRecipe> {
  const index = new Map<string, ParsedRecipe>();
  for (const [recipeId, r] of Object.entries(rawRecipes)) {
    const comps = (r.components || r.ingredients || r.inputs || r.materials || []) as Array<Record<string, unknown>>;

    const rawOutputs = r.outputs || r.output || r.result || r.produces;
    const outputObj: Record<string, unknown> = Array.isArray(rawOutputs)
      ? ((rawOutputs[0] as Record<string, unknown>) || {})
      : ((rawOutputs as Record<string, unknown>) || {});

    const outputItemId =
      (outputObj.item_id as string) ||
      (outputObj.id as string) ||
      (outputObj.item as string) ||
      (r.output_item_id as string) ||
      "";

    if (!outputItemId) continue;

    const outputQty =
      (outputObj.quantity as number) ||
      (outputObj.amount as number) ||
      (outputObj.count as number) ||
      1;

    const components = comps
      .filter(c => c.item_id || c.id)
      .map(c => ({
        item_id: (c.item_id as string) || (c.id as string) || "",
        name: (c.name as string) || (c.item_name as string) || "",
        quantity: (c.quantity as number) || (c.amount as number) || 1,
      }))
      .filter(c => c.item_id);

    if (components.length === 0) continue;

    index.set(outputItemId, {
      recipe_id: recipeId,
      output_item_id: outputItemId,
      output_name: (r.name as string) || outputItemId,
      output_quantity: outputQty,
      components,
    });
  }
  return index;
}

// ── Tree builder ──────────────────────────────────────────────

const MAX_DEPTH = 8;

/**
 * Recursively build a recipe dependency node.
 *
 * @param item_id       Item to resolve
 * @param quantity      How many are needed for this node
 * @param itemNames     item_id → display name (from catalog.items)
 * @param recipeIndex   Output of buildRecipeIndex()
 * @param available     item_id → total available quantity (cargo + storage + factionStorage)
 * @param visited       Set of item_ids on the current call path (cycle guard)
 * @param depth         Current recursion depth
 */
export function buildNode(
  item_id: string,
  quantity: number,
  itemNames: Map<string, string>,
  recipeIndex: Map<string, ParsedRecipe>,
  available: Map<string, number>,
  visited = new Set<string>(),
  depth = 0,
): RecipeNode {
  const item_name = itemNames.get(item_id) || item_id.replace(/_/g, " ");
  const qty_available = Math.min(available.get(item_id) ?? 0, quantity);
  const qty_to_gather = Math.max(0, quantity - qty_available);
  const is_satisfied = qty_to_gather === 0;

  if (is_satisfied) {
    return {
      item_id, item_name, quantity_needed: quantity,
      quantity_available: qty_available, quantity_to_gather: 0,
      has_recipe: recipeIndex.has(item_id), is_satisfied: true, is_leaf: false,
      crafts_needed: 0, craft_output_qty: recipeIndex.get(item_id)?.output_quantity ?? 1,
      children: [],
    };
  }

  const recipe = recipeIndex.get(item_id);
  const has_recipe = !!recipe && depth < MAX_DEPTH && !visited.has(item_id);

  if (!has_recipe) {
    return {
      item_id, item_name, quantity_needed: quantity,
      quantity_available: qty_available, quantity_to_gather: qty_to_gather,
      has_recipe: !!recipe, is_satisfied: false, is_leaf: true,
      crafts_needed: 0, craft_output_qty: recipe?.output_quantity ?? 1,
      children: [],
    };
  }

  // How many craft batches to produce qty_to_gather?
  const crafts_needed = Math.ceil(qty_to_gather / recipe.output_quantity);

  const childVisited = new Set(visited).add(item_id);
  const children = recipe.components.map(comp =>
    buildNode(
      comp.item_id,
      comp.quantity * crafts_needed,
      itemNames,
      recipeIndex,
      available,
      childVisited,
      depth + 1,
    ),
  );

  return {
    item_id, item_name, quantity_needed: quantity,
    quantity_available: qty_available, quantity_to_gather: qty_to_gather,
    has_recipe: true, is_satisfied: false, is_leaf: false,
    crafts_needed, craft_output_qty: recipe.output_quantity,
    children,
  };
}

/**
 * Walk the tree and collect all leaf nodes (items that must be gathered externally).
 * Merges duplicate item_ids by summing quantities.
 */
export function extractGatherNeeds(node: RecipeNode): GatherNeed[] {
  const acc = new Map<string, GatherNeed>();

  function walk(n: RecipeNode) {
    if (n.is_leaf && n.quantity_to_gather > 0) {
      const existing = acc.get(n.item_id);
      if (existing) {
        existing.quantity_needed += n.quantity_to_gather;
      } else {
        acc.set(n.item_id, {
          item_id: n.item_id,
          item_name: n.item_name,
          quantity_needed: n.quantity_to_gather,
        });
      }
      return;
    }
    for (const child of n.children) walk(child);
  }

  walk(node);
  return [...acc.values()];
}

/**
 * Build an availability map from a bot status object.
 * Merges cargo (inventory) + station storage + faction storage.
 */
export function buildAvailabilityMap(bot: {
  inventory?: Array<{ itemId: string; quantity: number }>;
  storage?: Array<{ itemId: string; quantity: number }>;
  factionStorage?: Array<{ itemId: string; quantity: number }>;
}): Map<string, number> {
  const m = new Map<string, number>();
  const add = (arr: Array<{ itemId: string; quantity: number }> | undefined) => {
    for (const i of arr ?? []) m.set(i.itemId, (m.get(i.itemId) ?? 0) + i.quantity);
  };
  add(bot.inventory);
  add(bot.storage);
  add(bot.factionStorage);
  return m;
}
