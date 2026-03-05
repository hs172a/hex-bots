# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
