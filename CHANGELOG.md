# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
