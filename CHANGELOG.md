# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.4.5] - 2026-03-08

### Added

#### Bot Control Panel — Jump Gates & Open Orders UI (`src/web/src/components/BotControlPanel.vue`)

- **Jump Gates section**: after pressing `🌌 System`, a 4-col grid appears listing connected systems; each button shows the system name and fuel cost (`N⚡`); button is red and disabled when fuel is insufficient or bot is docked
- **Open Orders panel**: appears after pressing `📋 Orders`; lists all open buy/sell orders; clicking the price shows an inline input to modify it via `modify_order`; `✕` cancels the order via `cancel_order`; `🔄` refresh button; duplicate handling for `view_orders` in `processExecResult`
- **`📋 Orders` button** added to Status Commands row
- New script refs: `systemConnections`, `openOrders`, `modifyOrderId`, `modifyNewPrice`
- New computed: `otherSystemPois`, `connectedSystems`, `currentFuel`
- New helpers: `hasEnoughFuelForJump(distance)`, `getPoiIcon(type)`, `startModifyOrder`, `submitModifyOrder`, `execCancelOrder`

#### `modify_order` API integration (`src/api.ts`)

- Added `modify_order` to `ACTION_COMMANDS` (rate-limit counted) and `MUTATION_INVALIDATIONS` (invalidates order cache)

### Fixed

#### Trader sold cargo for 0 cr (`src/routines/trader.ts`)

- **Root cause**: `best_sell` field (= other players' sell-side order book) was used as fallback for `buy_price` in the `cargoMarketBuyable` filter; the station accepted the `sell` command at 0 cr
- **Fix 1**: removed `|| (l.best_sell as number)` from all 3 buy-price filters — now strictly `buy_price > 0`
- **Fix 2**: before selling, items in cargo that the current market won't buy (`buy_price = 0`) are automatically deposited to faction storage (fallback: personal storage) instead of being sold for 0 cr

#### ZodError: `constraints` is null when saving goals (`src/types/config.ts`)

- **Root cause**: `GoalSchema.constraints` used `.optional()` which rejects `null`; the DB stores `constraints = NULL` for goals without constraints
- **Fix**: changed to `.nullish().transform(v => v ?? undefined)` — accepts both `null` and `undefined`

#### Miner dead loop — "No minable POI found" spinning indefinitely (`src/routines/miner.ts`)

- Added `noMinablePOIStreak` counter: after **3** consecutive "no minable POI" cycles, miner returns (yielding to SmartSelector) instead of waiting 30s and retrying forever
- Counter resets to 0 on any successful `beltPoi` resolution

#### SmartSelector trader → trader → trader dead loop (`src/routines/smart_selector.ts`)

- **Root cause**: trader score (170) consistently beat miner (120); after trader returned due to `noRouteStreak >= 3`, SmartSelector immediately re-selected trader
- **Fix**: added **trader cooldown** (8 min / 75 pts max), same pattern as existing miner cooldown — immediately after trader completes, penalty ≈ 75 pts reduces score to ~95, allowing miner (120) to win next cycle; penalty decays linearly over 8 minutes

#### Commission Ship UI — wrong costs and missing requirements (`src/web/src/views/ShipyardView.vue`)

- **Root cause**: quote panel read `total_cost || cost` (both `undefined`) → showed "0 cr"; read `commissionQuote.materials` (field doesn't exist in API) → showed nothing
- **Fix**:
  - Costs now use correct fields: `credits_only_total` / `provide_materials_total` (with `material_cost` breakdown), each showing `✓`/`✗` affordability indicator
  - "Your credits" line shows `player_credits` from response
  - Shipyard tier check: shows `tier_here / req tier_required` with `✓`/`✗`
  - Issues block appears when `can_commission === false` (red warning panel with reason list)
  - Build materials grid uses `build_materials[]` and shows `you_have/needed` with green/red coloring using `botBuildMats`
  - Commission button disabled (with tooltip) when `can_commission === false`

---

## [2.4.0] - 2026-03-07

### Added

#### Needs Matrix — fleet-wide production target system

A persistent SQLite-backed coordination layer that replaces scattered in-memory signals with a single source of truth for "what does the fleet need right now?". All bots on all VMs share the same picture of demand vs. reality.

- **`src/data/needs-matrix-db.ts`** — new `NeedsMatrixDb` class:
  - Schema: `item_id` (PK), `item_name`, `category`, `target_qty`, `current_qty`, `source` (`mine`|`buy`|`craft`), `priority` (0–100), `updated_target_at`, `updated_current_at`, `updated_by`
  - `setTarget(itemId, …)` — coordinator sets individual targets
  - `replaceTargetsBySource(source, entries[])` — atomic bulk-replace: upserts new entries, zeroes stale entries no longer in the batch
  - `updateCurrent(itemId, qty, bot)` — called after every `view_faction_storage` (canonical sync)
  - `adjustCurrent(itemId, delta, bot)` — optimistic ±delta after `faction_deposit/withdraw_items`; clamps to zero
  - `getAll()`, `getBySource(source)`, `getTopDeficits(source, limit)`, `getItem(itemId)`, `pruneStale(maxAgeDays)`
- **DB migration V8** (`src/data/database.ts`): creates `needs_matrix` table with `idx_nm_source` and `idx_nm_deficit` indexes; `CURRENT_SCHEMA_VERSION` bumped to 8
- **`src/mapstore.ts`** — 10 new delegate methods: `connectToNeedsMatrixDb`, `setNeedsMatrixTarget`, `replaceNeedsMatrixTargets`, `updateNeedsMatrixCurrent`, `adjustNeedsMatrixCurrent`, `getAllNeedsMatrix`, `getNeedsMatrixBySource`, `getTopNeedsMatrixDeficits`, `getNeedsMatrixItem`, and private `_needsMatrixDb` field
- **`src/botmanager.ts`** — wiring:
  - Instantiates `NeedsMatrixDb` after DB is ready; wires to `mapStore` and `swarmcoord`
  - After `view_faction_storage`: iterates raw items and calls `mapStore.updateNeedsMatrixCurrent(itemId, qty, botName)`
  - After `faction_deposit/withdraw_items`: calls `mapStore.adjustNeedsMatrixCurrent(itemId, delta, botName)`
- **`src/web/server.ts`** — `/api/needs-matrix` REST endpoint with optional `?source=mine|buy|craft` and `?deficits=1` filters

#### Role Protocols — quota-driven role switching

- **Coordinator (`src/routines/coordinator.ts`)**:
  - After computing `oreQuotas`: writes to `needs_matrix` via `replaceNeedsMatrixTargets('mine', …)` with proportional priority scores
  - After finalising `craftLimits`: writes profitable recipe outputs via `replaceNeedsMatrixTargets('craft', …)` with profit-based priority
  - **Chain efficiency metric**: logs `Chain efficiency: X% (N/M targets met)` and lists up to 3 bottleneck items (items below 50% of target), sorted by absolute deficit
- **Miner (`src/routines/miner.ts`)** — three-tier ore target selection:
  1. Needs Matrix (fresh < 2 h): picks the top-deficit ore that has an ore-belt location in the known map
  2. Settings-based `oreQuotas` (fallback when coordinator has not yet written NM)
  3. Swarm demand signal (`getMostNeededItem`) as final fallback
- **SmartSelector (`src/routines/smart_selector.ts`)**:
  - `scoreMiner()` now consults the Needs Matrix (fresh < 2 h):
    - All ore targets met → returns score `1` (miner will not win candidate selection)
    - Active deficits → applies a `0.5–1.5×` priority multiplier based on worst deficit percentage
  - `buildCandidates()`: when all NM ore targets satisfied, adds `+20` to explorer score ("pivot to exploration")

#### swarmcoord persistence bridge (`src/swarmcoord.ts`)

- New `connectNeedsMatrixDb(db: NeedsMatrixDb)` export — called once in `botmanager.ts` at startup
- `broadcastMaterialNeed()` now also writes a `source='buy'` target to the Needs Matrix (positive quantities only) so craft material demands survive restarts and are visible to bots on other VMs via DataSync
- Import: `import type { NeedsMatrixDb } from "./data/needs-matrix-db.js"`

#### Tests

- **`src/__tests__/needs-matrix.test.ts`** — 59 tests across 9 groups:
  - `NeedsMatrixDb: setTarget` — insert, upsert, timestamp, default priority
  - `NeedsMatrixDb: replaceTargetsBySource` — bulk upsert, stale-zeroing, cross-source isolation
  - `NeedsMatrixDb: updateCurrent` — stub creation, non-destructive update, sequential overwrites
  - `NeedsMatrixDb: adjustCurrent` — positive/negative delta, zero-clamp, no-op on missing row
  - `NeedsMatrixDb: getAll / getBySource / getTopDeficits / getItem` — all query helpers
  - `NeedsMatrixDb: pruneStale` — TTL removal, retention within window, default 7-day cutoff
  - `swarmcoord: NeedsMatrixDb persistence bridge` — broadcast→NM write, zero guard, priority value
  - `miner: ore target selection priority logic` — NM-first, fallback, stale detection, belt filter
  - `smart_selector: quota-aware miner scoring logic` — saturation→score=1, multiplier math, stale fallback, explorer bonus trigger
  - `coordinator: chain efficiency calculation` — efficiency %, bottleneck filter/sort/cap, zero-target exclusion

### Fixed

#### Gatherer deposit destination (`src/routines/gatherer.ts`)

- **Root cause**: `depositAllToTargets` always called `deposit_items` (personal storage), so materials gathered for `build` goals were inaccessible to other bots in the faction
- **Fix**: deposit destination is now driven by `goal_type`:
  - `'build'` (default) → `faction_deposit_items` so any faction member can access the materials; gracefully falls back to `deposit_items` on `faction_storage` API error
  - `'craft'` → `deposit_items` (crafter withdraws from personal storage directly)
- `DeliveryTask` interface: added `goal_type?: 'build' | 'craft'` field, propagated from `GatherGoal` in `buildDeliveryPlan`

#### Gatherer stale faction storage cache (`src/routines/gatherer.ts`)

- **Root cause**: `buildDeliveryPlan` trusted cached faction storage DB entries regardless of age; a snapshot from >30 min ago could suppress demand for items the crafter had already withdrawn, leaving gathering goals perpetually unfulfilled
- **Fix**: introduced a 30-minute freshness guard (`FACTION_DB_MAX_AGE_MS = 30 * 60 * 1000`) on the DB cache check; stale entries are ignored with a `⏰` log message so live demand is re-evaluated correctly

---

## [2.2.0] - 2026-03-06

### Added

- **Commander: Goals tab** (`CommanderView.vue`):
  - Moved **Gather Goals**, **Craft Planner**, and **Fleet Goals** out of the Advisory tab into a dedicated `🎯 Goals` tab
  - Gather Goals now shows **all goals per bot** (previously only one goal per bot was displayed)
- **Commander: Missions tab** (`CommanderView.vue`):
  - `MissionsView` embedded as a new `🏹 Missions` tab inside Commander
  - Removed `Missions` from the top-level App.vue navigation (fewer tabs, less visual noise)
- **Gatherer: multi-goal queue** (`gatherer.ts`):
  - Settings now support a `goals: GatherGoal[]` array per bot in addition to the legacy `goal` (single); both formats are read with backward compatibility
  - The routine processes all queued goals sequentially in one run
  - `createCraftGatherGoal` in Commander now **appends** to the `goals[]` array instead of overwriting the single goal — multiple craft targets can be queued at once
- **Gatherer: non-overlapping component allocation** (`gatherer.ts`, `swarmcoord.ts`):
  - New `GatherComponentClaim` primitive in `swarmcoord.ts`: item-level mutex, keyed by `itemId`, TTL = 45 min
  - Before acquiring each material, a gatherer bot calls `claimGatherComponent()` — if another bot already holds the claim it logs `⏭ claimed by another gatherer — skipping` and skips that item
  - Claims are released per-item as each acquisition completes, and all claims are released on routine exit via `releaseAllGatherClaims()`
  - `releaseAllClaims()` now also calls `releaseAllGatherClaims()` for full cleanup on bot stop

### Changed

- **UI performance: log batching** (`botStore.ts`, `useDashboardLogs.ts`):
  - All incoming log lines (activity/broadcast/system/faction/per-bot) are now queued in plain non-reactive arrays and flushed to reactive state at most once per 100 ms — single Vue reactivity trigger instead of one per message
  - `botLogBuffers` converted from `ref` (deep reactive) to `shallowRef`
  - `groupedBroadcastLogs` now reuses the already-computed `parsedBroadcastLogs` instead of re-parsing the broadcast array a second time
  - Displayed log sliced to last 200 entries before parsing to reduce per-recomputation cost
  - Log buffer caps reduced: 500→300 (panels), 200→150 (faction), 200→100 (per-bot), 1000→500 (global `logs[]`)
- **MissionsView: available missions cap** (`useMissions.ts`):
  - `groupedAvailable` now renders at most **60 mission cards** (sorted by reward) to prevent DOM overload when hundreds of missions are present across explored systems
  - Shows "Showing top N of Total — adjust filters to narrow results" when truncated

---

## [1.9.5] - 2026-03-06

### Changed

- **Project renamed** to **Hex Bots Orchestrator** (`package.json`, page title, app header, README)
- **README rewritten** — added Architecture section covering Standalone, Hub Master+Client, DataSync, and Commander Advisory modes with ASCII diagrams
- **Stats View: unified fleet stats** (`StatsView.vue`):
  - Removed VM pool selector — stats now always aggregate all pools into one unified view
  - `activeStatsSource` merges all DataSync pools + local `statsDaily` (local takes precedence)
  - All bots from all VMs appear in one Per-Bot Breakdown table and Fleet Totals
  - Pool selector replaced by a single 🔄 Refresh button
- **Commander Advisory: full fleet evaluation** (`botmanager.ts`):
  - `evaluate()` now receives `[...localBots, ...server.remoteBots as BotStatus[]]`
  - Suggestions cover bots on all connected VMs, not only the local VM
- **`config.toml.example` updated**:
  - `[commander]` and `[economy]` sections: removed "Future:" labels — both are implemented
  - Added `serve_ui` to `[server]` section
  - Added `reassignment_threshold` to commander config documentation
  - Expanded `[datasync]` with full field reference for master and client modes (all timing intervals, `max_clock_skew_sec`, `code_sync_interval_sec`)
  - Added `[[goals]]` and `[[inventory_targets]]` documentation sections

### API Compatibility

- **v0.176.1** — `view_market` returns full order book to direct API clients; compact summary (best prices + available_categories) applies only to MCP text interface. The compact-format fallbacks added in v0.174.x (`best_buy`, `best_sell`, `summary` key) remain as safe no-ops.
- **v0.176.2** — Ship lore text formatting fixed in catalog; no code changes required.

---

## [1.9.0] - 2026-03-05

### Added

- **Mission Runner: `manualMissionId`** (`mission_runner.ts`, `MissionsView.vue`):
  - Per-bot setting to manually target a specific mission by ID; auto-selection is used as fallback when the mission is not found on the board or in the active list
  - "Set Target" toggle button on each active mission card in `MissionsView.vue`; selected card highlighted; "Clear" link shown in the top bar
  - Wired to `botStore.saveSettings('mission_runner')`
- **Mining UI: belt resource status pill** (`BotControlPanel.vue`):
  - Extracts latest `Belt:` info line from the activity log each cycle
  - Shown as a coloured status pill above the Activity Log when the bot is actively mining (e.g., `12/15 resources available (8% depleted avg)`)
- **Activity Log: auto-scroll** (`BotProfile.vue`, `BotControlPanel.vue`):
  - Log scrolls to the bottom on mount and on every new log entry
  - `BotProfile.vue` triggers scroll when switching to the Control tab

### Fixed

- **Miner: home base tracking for remote-system mining** (`miner.ts`):
  - Added `findSystemForPoi()` helper — searches the map store to find which system contains a given POI ID
  - `homeSystem` is now derived from `bot.homeBase` POI via map lookup (`findSystemForPoi`) rather than defaulting to `bot.system` at startup — correct even when the bot starts in a remote system
  - Return-to-home block now triggers whenever `bot.system !== homeSystem`, regardless of whether `targetOre` or `oreQuotas` are set — fixes the scenario where `miningSystem` is configured without a target ore
  - After returning home, docking uses `bot.homeBase` directly as the station POI instead of searching the home system for any station; falls back to `findStation()` if `homeBase` is unset
  - When already in the home system, `stationPoi` is set to `homeStationId` (`bot.homeBase`) before the travel-to-station step
- **Crafter: cargo full with crafted `fuel_cell` items** (`crafter.ts`):
  - Start-of-cycle cargo clear now deposits excess `fuel_cell` items, keeping ≤ 5 as an emergency backup; previously kept all of them (matched by `lower.includes("fuel")`) which left no room for recipe components when 60+ fuel cells had accumulated
  - `energy_cell` (ship fuel) continues to be excluded from the deposit loop
- **Crafter: skill level always read as 0** (`bot.ts`):
  - `checkSkills()` dict-format branch now iterates the nested `r.skills` object directly instead of iterating top-level response keys (which included `"skills"` and `"message"`)
  - `getSkillLevel()` falls back to the `this.skills` array (correctly populated by `refreshStatus()`) when the `skillLevels` map has no entry for the requested skill

---

## [1.8.0] - 2026-03-04

### Added

#### New Routines
- **`facility_manager.ts`** — Personal facility monitoring and management:
  - Lists all owned facilities; alerts when rent expiration is within `rentAlertTicks` cycles (default 5)
  - Auto-renew: navigates to the facility base, docks, toggles off → on to reset rent timer
  - Faction facility upgrades: queries available upgrades and applies them when `autoUpgradeFacilities = true`
  - Settings: `autoRenew`, `autoUpgradeFacilities`, `rentAlertTicks`, `cycleIntervalSec`
  - Registered in `botmanager.ts`, `strategies.ts`, `advisory-commander.ts`, `SettingsView.vue`
- **`trade_broker.ts`** — P2P trade offer automation:
  - Hooks `bot.onNotification` to intercept incoming trade offers in real time
  - Auto-accepts offers matching configured `acceptItems` list or `minAcceptCredits` threshold
  - Auto-declines all other offers when `autoDecline = true`
  - Faction redistribution: offers surplus items to faction members docked at the same station
  - Settings: `acceptItems`, `minAcceptCredits`, `autoDecline`, `redistributeToFaction`
  - Registered in `botmanager.ts`, `strategies.ts`, `advisory-commander.ts`

#### SmartSelector Enhancements (Phase 7)
- **Phase 7.1 — `get_nearby` enemy awareness** (`smart_selector.ts`):
  - `get_nearby` called in parallel with existing scoring calls (zero extra latency)
  - Hostile players detected → `-12 pts × enemy_count` (max −40) on all passive routines (miner, trader, harvesters, explorer, mission runner)
  - Faction allies nearby → `+3 pts × ally_count` (max +10) safety bonus on economic routines
  - Enemy count → `+15 pts × enemy_count` (max +35) boost to hunter score
  - All applied before faction-intel and module-awareness adjustments
- **Phase 7.2 — Ship module awareness** (`smart_selector.ts`):
  - Reads `bot.installedMods` (populated from `get_status`) — no extra API call
  - Combat modules (weapon/laser_cannon/railgun/missile) → +15 to hunter
  - Mining modules (mining_laser/drill/ore_extractor) → +12 to miner
  - Gas harvester modules → +14 to gas_harvester
  - Ice harvester modules → +14 to ice_harvester
  - Large cargo modules (cargo_hold/cargo_bay/extended_cargo) → +10 to trader
- **Phase 7.3 — `search_systems` exploration routing** (`explorer.ts`, `api.ts`):
  - When all locally connected systems are exhausted, calls `search_systems` with `filter: "unexplored"` before falling back to random jump
  - Routes to the first unvisited result via `navigateToSystem` (multi-hop)
  - `search_systems` added to `COMMAND_TTL` cache (60 s TTL)

#### API v2 Integration (Phases 2–5)
- **Phase 2 — v2 battle state machine** (`hunter.ts`):
  - Uses `v2_battle_status`, `v2_engage`, `v2_set_stance`, `v2_set_target`, `v2_advance`
  - `bot.autoDefend` flag: automatically braces on unexpected combat notifications during any routine
  - `bot.autoDefend` reset to `false` at hunter routine exit to avoid affecting other routines
- **Phase 3 — Faction intel** (`explorer.ts`, `hunter.ts`, `scout.ts`, `smart_selector.ts`):
  - `faction_submit_intel` called after `survey_system`, pirate sightings, and market data collection
  - `faction_query_intel` called in `smart_selector.ts` for trade signal + threat boosts (already present, now wired to v2 data)
- **Phase 5 — Agent event logging** (`hunter.ts`, `miner.ts`, `trader.ts`, `crafter.ts`, `mission_runner.ts`):
  - Key events (kills, trade runs, mine cycles, craft completions, mission rewards) submitted via `logAgentEvent`

### Fixed
- **Multi-pool stats collision** (`botmanager.ts`, `types/config.ts`):
  - Root cause: all VMs used `basename(process.cwd())` (e.g. `"hex-bots"`) as pool name → each pool overwrote the others in the master's in-memory `clientPoolStats` Map
  - Fix: pool name now defaults to `hostname()/dirname` (unique per machine); configurable via `[datasync] pool_name = "vm1"` in `config.toml`
  - Added `pool_name` field to `DataSyncConfigSchema` with empty-string default
  - Startup logs: `[DataSync] pool_name: <resolved>`
- **Force-stop race condition** (`bot.ts`):
  - Root cause: `forceStop()` set state to `"stopping"` but `exec()` never checked it; routines blocked inside multi-hop helpers (navigateToSystem, ensureFueled) continued for minutes
  - Fix: `exec()` immediately returns `{ error: { code: "stopped" } }` when `_state === "stopping"`, unwinding all nested awaits within seconds
  - `"stopped"` added to the quiet-errors list to suppress log noise
- **LDT infinite loop on jump failure** (`BotControlPanel.vue`):
  - Root cause: `ldDoRelocationStep()` called `ldProgress++` unconditionally — even on `"Systems are not connected"` errors — causing the LDT to iterate through the entire stale route while logging errors every ~20 s
  - Fix: fatal jump errors (`not connected`, `not found`, `invalid system`, `no route`) now abort the LDT and display `"route may be stale, please recalculate"`; transient errors (fuel, docked, action_pending) retry the same hop after 15 s
  - `ldAutoStart()` now blocks with an error message if bot state is `"stopping"`

---

## [1.7.0] - 2026-03-04

### Added
- **SmartSelector: miner POI-awareness** (`smart_selector.ts`) — new `scoreMiner()` helper:
  - Current system has ore belt → full score (`miningLevel × 10 + 20`)
  - Another known system has ore belt → reduced score (`miningLevel × 6`, miner will navigate)
  - No ore belt mapped anywhere → score = 1 (will not win candidate selection)
  - Prevents the recurring `No minable POI found — waiting 30s` loop when placed in a system without asteroids
- **Multi-pool stats** — Stats page now shows statistics across all sibling bot pools:
  - `server.ts` new `/api/stats/all-pools` endpoint scans `../*/data/stats.json`
  - `botStore.ts` new `allPoolsStats`, `allPoolsLoading`, `fetchAllPoolsStats()`
  - `StatsView.vue` pool selector in header (Current + one button per discovered pool + 🔄 reload); Per-Bot table and Fleet Totals switch data source on selection; yellow pool name badge on table header
- **Force-refresh full wipe** — Force-refresh buttons now completely clear stale data before re-seeding:
  - `mapStore.clearAll()` — deletes all SQLite rows, in-memory data, and `map.json`
  - `catalogStore.clearAll()` — deletes all SQLite rows, in-memory data, and `catalog.json`
  - Both called in `botmanager.ts` before `seedFromMapAPI` / `fetchAll` respectively
- **Crafter: profit engine** (`crafter.ts` + `mapStore.ts`):
  - `mapStore.getPriceAt(itemId, poiId, side)` — volume-weighted average from individual order book, fallback to `MarketRecord` summary
  - `mapStore.getBestSellToMarketPrice(itemId)` — highest buy-price across all known stations
  - `getRecipeProfitability(ctx, recipe)` — calculates `outputPrice`, `inputCost` (owned items = 0 cost), `profit`, `profitPct`, `fullyFunded`, `bestSellPoi`
  - `scoreCrafter(ctx, minProfitPct)` — fast score from catalog cache (no API calls), used by SmartSelector
  - `autoCraft` mode — new settings `autoCraft / minProfitPct / maxAutoCraftRecipes`; ranks all craftable recipes by profit margin, crafts top N after `craftLimits` loop
  - BOM summary log — at each cycle start logs craftable recipe count + top-5 by profit with `+Xcr` annotation
- **SmartSelector: crafter as dynamic candidate** — crafter added to `buildCandidates()` when `craftingLevel > 0`; score = `scoreCrafter()`; new `minCrafterProfitPct` setting (per-bot + global)
- **SmartSelector: cargo-full escape hatch** — if cargo ≥ 85% at evaluation time, dock and flush before scoring (prevents miner dead loop)

### Fixed
- **`common.ts collectFromStorage`** — broadened not-docked detection: now catches `'must be docked'` and `'provide a station_id'` server messages in addition to `not_docked` code
- **`miner-v2.ts depositItem`** — `storage` mode now returns `!storeResp.error` instead of always `true`, so failed deposits are properly handled
- **`miner-v2.ts unloadedItems`** — `unloadedItems.push()` moved inside the success path so items are only counted as unloaded when at least one deposit method succeeded

---

## [1.6.0] - 2026-03-03

### Added
- **DataSync UI indicators** — App.vue header now shows:
  - 🌐 DS Master badge (blue) when instance is running as DataSync master
  - 🔗 DS Client badge (cyan) when client is connected to master
  - 🔌 DataSync Offline badge (red, pulsing) after 3 consecutive sync failures; auto-clears on reconnect
- **`NO_FILE_LOG=1`** environment variable — set to suppress `data/logs/` file logging without code changes
- **FactionView: treasury deposit/withdraw** — amount input + ↑ Deposit / ↓ Withdraw buttons (`faction_deposit_credits` / `faction_withdraw_credits`), visible in the faction header stats row
- **FactionView: "+ Own Bots" quick-invite** — batch-invites all fleet bots not yet in the faction

### Changed
- **FactionView: members** — sorted online-first; role badge with color (leader=yellow, officer=blue, member=gray); online dot indicator on avatar
- **FactionView: storage** — grouped by category (Ores / Refined / Components / Modules / Other), each sorted by quantity desc; 2-column grid layout
- **FactionView: facilities** — shows 📍 system location if `system_name` / `systemName` field present
- **DataSync `dataSyncMode`** — included in `init` WS message; `botStore.dataSyncMode` tracks it; `botmanager.ts` sets it on startup

---

## [1.5.0] - 2026-03-03

### Fixed
- **BotProfile.vue** — Deposit Settings panel: option values were `"faction_storage"`/`"station_storage"` (not recognised by backend `parseDepositMode`); corrected to `"faction"`/`"storage"`. Added `watch` to load per-bot overrides on mount and auto-save changes via `botStore.saveSettings`.
- **MissionsView.vue** — Completed Missions "View Details" button passed `{ id: templateId }` to `view_completed_mission`; corrected to `{ template_id: templateId }`.
- **BotControlPanel.vue** — Long Distance Travel: `search_systems` results now sorted by relevance (exact match → starts-with → substring) before selecting the target system, preventing wrong-system selection (e.g. "Millhaven" when searching "Haven").
- **common.ts `navigateToSystem`** — Added upfront `find_route` preflight check; fails fast with an error log if `total_jumps > maxJumps`, avoiding wasted sequential jump attempts on unreachable systems.
- **bot.ts `exec`** — Increased transient error (504/503/500) wait from 5 s to 15 s; increased `action_in_progress` retries from 2 to 4 attempts with 5 s incremental back-off (5 s / 10 s / 15 s / 20 s).

---

## [1.4.3] - 2026-03-02

### Added
- **AI routines**: `ai.ts` (in-process LLM agent), `ai_commander.ts` (fleet-level LLM orchestrator), `pi_commander.ts` (subprocess wrapper for `commander.ts` PI-agent).
- **UI panels**: `CombatPanel`, `InsurancePanel`, `NotesPanel`, `SocialPanel`, `CaptainsLogPanel`.
- **`httpcache.ts`**: process-level HTTP cache (ETag + Cache-Control aware) for external fetches.
- **`miningclaims.ts`**: shared in-process claim registry for anti-collision between miners.
- **`ComposeDashboardLogs` / `useMissions`** composables extracted from Dashboard/Missions views.
- Per-bot deposit override dropdowns in BotProfile sidebar.
- Rate-limit IP blocking: server broadcasts `rateLimitBlock` WS event; header shows live countdown badge.
- API request logging to `data/api-logs/` (opt-in, toggle in Settings → General).

### Changed
- Views reorganised: all page-level components moved from `components/` to `views/`.
- `ActionLogView`, `CommanderView` added as dedicated views.
- `DashboardView` fully rewritten: ₡/hr column, auto-scroll logs, fleet stats bar, inline routine start.
- `SettingsView` expanded to cover all 21 routines with grouped sidebar (System / Fleet / Economy / Exploration / Harvesting / Combat / AI).
- `MissionsView` redesigned as three-tab layout (Active / Available / Completed) with live progress bars.

### Removed
- Legacy `legacy_ui.html` (vanilla-JS frontend, 9 051 lines) fully deleted.

---

## [1.3.0] - 2026-03-01

### Added
- **New routines**: `mission_runner.ts`, `quartermaster.ts`, `return_home.ts`, `scavenger.ts`, `scout.ts`, `ship_upgrade.ts`.
- `src/types/config.ts`: full TypeScript config type definitions for all routines.
- `BotProfilePanel` component (player profile — status, anonymous, ship colors, home base).
- `BotStationPanel` mode `'facility'` for Mine + Build tabs.

### Changed
- `FactionView`: Missions section (post/list/cancel), Trade Intel section (query/submit/status).
- `MarketView` → My Orders tab (view/edit/cancel active orders).
- Removed MissionsView from components (moved to views/).

---

## [1.2.0] - 2026-03-01

### Added
- `BotControlPanel.vue`: full manual control panel (command grid, exec lock, craft filter with cargo check, Long Distance Travel multi-hop with progress indicator).
- `BotShipPanel.vue`: ship stats, module cards with quality/wear/CPU/power, install/uninstall.
- `BotStationPanel.vue`: station info, services, facilities; Shop with sorted availability.
- Bundled `data/catalog.json`, `data/ships.json`, `data/stations.json` snapshots.
- Ship class tooltip with catalog card (image, base stats, description).

### Changed
- `BotProfile.vue` refactored into tab-based layout (Control · Ship · Facility · Insurance · Combat · Profile · Station · Log · Notes · Social).
- `ShipyardView`: Overview, Fleet, Showroom, Commission, Module Management panels.
- `Dashboard`: Credits/hr column (rolling 1-hour rate), bot state badges show routine name.

### Fixed
- `common.ts`: multiple stability fixes (gas harvester field matching, cleanup keeps credits, cargo account for item size).
- `miner-v2.ts`: ore belt filtering, fuel handling, ore quota improvements.

---

## [1.1.5] - 2026-03-01

### Added
- **Vue 3 SPA** replaces vanilla-JS frontend: Vite + TailwindCSS + Pinia, hot-reload dev mode.
  - `Dashboard.vue`, `BotProfile.vue`, `FactionView.vue`, `MapView.vue`, `MarketView.vue`, `MissionsView.vue`, `SettingsView.vue`, `ShipyardView.vue`, `StatsView.vue`.
  - `botStore.ts` (Pinia), `goalStore.ts`.
- **`gatherer.ts`** routine: collects build materials for faction facilities; goal assigned from Station → Build tab.
- **`apilogger.ts`**: optional file logger for all game API requests/responses.
- **`publicCatalog.ts`**: public ship & station catalog (no auth required).
- Faction View: Facilities tab (toggle, upgrade, build new), quick-invite own bots.

### Changed
- `api.ts`: rate-limit IP blocking detection and module-level handler.
- `bot.ts`: factionId, factionStorage fields in BotStatus.
- Previous `index.html` archived as `legacy_ui.html`.

---

## [1.1.1] - 2026-02-26

### Added
- **`miner-v2.ts`**: anti-collision claim registry, per-bot ore quotas, configurable faction donations, ore belt targeting only, startup cargo dump at home system.

### Changed
- `api.ts`: improved session handling and response parsing.

---

## [1.1.0] - 2026-02-26

### Fixed
- Rate limit handling: escalating back-off, avoid infinite retry loops.
- Improved logging verbosity and categorisation across all routines.

---

## [0.6.x] - 2026-02-21 to 2026-02-23

Patch series applied on top of v0.6 before the v1.1.0 milestone.

### Added
- Persistent per-bot log files (`data/logs/<username>.log`).
- Faction storage trading and unified deposit UI (faction / station / sell / gift modes).
- Staggered bot login sequence to avoid simultaneous session collisions.
- Miner ore quotas (configurable per-ore limits), material-aware crafting, configurable faction donation %.
- Default ore quotas of 1 000 units for all known ores.
- Miner `homeSystem` setting: startup navigates home before dumping cargo.
- Home System dropdown in miner bot profile page.
- Gas/Ice harvesters and Salvager `homeSystem` setting + startup cargo dump.
- Bot fleet expansion: insurance management, cloaking, module management, ammo, salvage, market orders via UI.
- Cleanup agent: remote storage scan + faction storage station setting.

### Changed
- Cargo: all quantity calculations account for per-item size/volume.
- Miner: filters POI list to ore belts only; blocks ice/gas POI targeting.
- Miner, gas/ice harvesters: filter ice/gas commodities from ore quotas and target selection.
- Faction trader: clears cargo to faction storage before trade run; clears fuel cells from cargo.
- Never jettison cargo under any condition.

### Fixed
- Trader: fuel cell overbuy (1 cell per 4 jumps, capped at 25% cargo); subtract fuel cell weight from capacity.
- Trader: cargo overflow (use item count not weight for free space check).
- Trader: reserve quantities in market cache to prevent bot competition.
- Trader: refresh market cache after selling to update quantities.
- Trader: sell cargo first → storage second → find new routes.
- Trader: sell unsold items at alternative buyers; store remainder at Sol Central.
- Trader: profit calculation; batch in-station faction sales; purge stale market data.
- Trader: skip routes that sell back to the same station where items were just sold.
- Trader: prioritise selling existing cargo before finding new trades.
- Crafter: only grind XP on recipes defined in settings, not random catalog items.
- Crafter: auto-craft prerequisites; grind XP for skill-blocked recipes.
- `scavengeWrecks`: skip when cargo nearly full; break on `no_space` errors.
- Routine dropdown: stop closing on bot status WebSocket updates.

---

## [0.6.0] - 2026-02-21

### Added
- **`CatalogStore`**: SQLite-backed item/ship/skill/recipe cache with 24 h auto-refresh; O(1) lookups; broadcast to frontend on load.
- **`hunter.ts`** routine: autonomous pirate patrol with BFS system navigation, combat stances (fire/brace/flee), mission/insurance/loot management, faction combat alert response within configurable jump range.
- **`gas_harvester.ts`**, **`ice_harvester.ts`**, **`salvager.ts`** routines.
- Combat notification system: hull damage alerts + warnings to faction chat (30 s / 60 s cooldowns).
- Galaxy map pre-seeded from `/api/map` on startup.
- Coordinator: global market data from `/api/market` for demand supplementation; fallback material cost estimation.
- Trader: insurance before trade runs; mission completion/acceptance at every dock; market analysis for XP.
- Frontend: combat log category (red highlight); catalog-powered name resolution for shipyard/crafter/modules.

### Fixed
- v2 API session management: separate v1/v2 session lifecycles; correct v2 login URL.
- `ensureFueled`: try station first, only jettison at fuel ≤ 1, use `find_route`.
- Crafter: withdraw from both station and faction storage before crafting.

---

## [0.5.0] - 2026-02-20

### Added
- **`coordinator.ts`**: stays docked, analyses cross-station market demand, auto-adjusts miner `targetOre` and crafter `craftLimits`.
- **`trader.ts`**: finds price spreads between stations, buys low / sells high; emergency fuel reserve; insurance before runs; `estimate_purchase` pre-validation.
- `MapStore`: `findBestBuyPrice`, `getAllBuyDemand`, `findPriceSpreads` methods.
- `common.ts`: `writeSettings()` for programmatic settings updates.

---

## [0.4.0] - 2026-02-20

### Added
- Complete SpaceMolt game type definitions (`src/types/game.ts`, 630 lines).
- Miner `depositMode` setting: `storage` / `faction` / `sell`; `faction_deposit_items` API support.
- Per-bot target ore overrides.
- Market price recording on every dock via `collectFromStorage`.
- Market Overview panel (cross-station price comparison) in Map tab.
- SVG system map viewer with POI-specific visuals.
- Shipyard tab with ship overview, fleet, catalog, and module panels.
- `collectFromStorage`: auto-collect credits + items on every dock.
- `resolveLocation`: display name resolution for system/POI IDs in dashboard.

### Changed
- `ensureFueled`: BFS station search; retry loop to 95 % fuel.
- `repairShip`: auto-repair at ≤ 40 % hull across all routines.
- `ensureDocked`: BFS navigation to nearest station (no more dock at non-station POIs).
- Explorer: fixed wrong-system POI visits after repair/refuel moves bot; added cargo-full deposit at Sol Central.

### Fixed
- Base service checks for refuel/repair (`findStation` with required service filter).

---

## [0.2.1] - 2026-02-13

### Fixed
- Reject unknown LLM providers instead of silently falling back to Ollama.

---

## [0.2.0] - 2026-02-13

### Changed
- Minor package version bump.
- Added configurable `LMSTUDIO_BASE_URL`; improved LM Studio documentation.
- Updated credential flow for registration code system.

---

## [0.1.0] - 2026-02-10 — *Initial Release*

### Added (commander.ts — autonomous AI agent)
- Multi-provider LLM support via `@mariozechner/pi-ai` (Ollama, Anthropic, OpenAI, Groq, LM Studio).
- ~50 tools generated dynamically from the game's OpenAPI spec (`/api/openapi.json`).
- Per-session credential and state persistence (`sessions/<name>/credentials.json`).
- ANSI-coloured terminal output with category logging (tool calls, reasoning, notifications).
- LLM-based context compaction (token-aware budget, turn-boundary-aware eviction, rolling summary).
- Session handoff generated on shutdown and before compaction.
- `--debug` flag: full untruncated LLM I/O with rich separators.
- `--file / -f` flag: read mission instruction from a file.
- Reasoning extraction from thinking blocks (Qwen3, etc.).
- Rate limit handling with exponential back-off; server restart recovery.
- Credential migration from legacy markdown format to JSON.
- GitHub Actions CI for cross-platform binary releases.

### Added (bot runner — web dashboard)
- Multi-bot fleet manager with Vue 3 SPA dashboard.
- Miner, Explorer, Crafter, Fuel Rescue routines.
- WebSocket-based live log streaming per bot.
- Faction management: members, storage, facilities, diplomacy.
- Galaxy map auto-built from explorer data.
