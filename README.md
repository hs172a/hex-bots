# Hex Bots Orchestrator

> **Originally forked from [spacemolt_botrunner](https://github.com/humbrol2/spacemolt_botrunner)**, but has since diverged completely — the frontend, backend architecture, automation engine, and data layer share little with the original beyond the SpaceMolt API integration.
>
> **Repository:** https://github.com/hs172a/hex-bots

A multi-VM autonomous bot fleet for [SpaceMolt](https://www.spacemolt.com). Bots coordinate as a single production organism — miners respond to real-time ore deficits, gatherers deliver to faction storage, crafters consume what is there, and the coordinator monitors chain efficiency and switches miners to exploration when all quotas are met. The whole fleet is controlled from one reactive Vue 3 dashboard.

![Interface](https://img.shields.io/badge/interface-vue3_spa-blue) ![Runtime](https://img.shields.io/badge/runtime-bun-black) ![Deps](https://img.shields.io/badge/deps-zero_runtime-green) ![Version](https://img.shields.io/badge/version-2.5.2-purple)

---

## Credits & Attributions

Ship artwork displayed in the Bot Profile → Ship tab and Shipyard is sourced from the **SpaceMolt** project assets at [github.com/SpaceMolt/www](https://github.com/SpaceMolt/www). These images are the property of the SpaceMolt project / their respective authors and are used here solely for identification purposes within the context of playing SpaceMolt. No ownership or authorship of these assets is claimed.

---

## Architecture

Hex Bots Orchestrator supports three deployment modes that can be combined:

### Standalone (single VM)

The simplest setup — one machine runs bots, the backend, and the Vue SPA all together.

```
┌─ Single VM ──────────────────────────────────────┐
│  bun start                                       │
│  ├── botmanager.ts   — discovers and runs bots   │
│  ├── WebServer       — WebSocket + HTTP on :3210 │
│  └── Vue SPA         — served at /               │
└──────────────────────────────────────────────────┘
```

### Hub Master + Client VMs

When bots run on multiple machines (e.g., cloud VMs, home machines), a single **master VM** with a public IP serves the Vue SPA for the entire fleet. Client VMs connect **outward** to the master — no reverse tunnels needed.

```
┌─ MASTER VM (public IP) ──────────────────────────────┐
│  [hub] mode = "master"                               │
│  ├── Vue SPA served for all VMs                      │
│  ├── ProxyHub at /hub — WebSocket proxy              │
│  │   • Aggregates bot statuses from all VMs          │
│  │   • Routes commands to the correct VM             │
│  │   • Streams logs from every bot to the UI         │
│  └── Commander Advisory — scores all bots fleet-wide │
└──────────────────────────────────────────────────────┘
         ▲ WebSocket (ws://master-ip:3210/hub)
         │  client connects OUT → no reverse tunnel
         │
┌─ CLIENT VM (any NAT / home machine) ─────────────────┐
│  [hub] mode = "client"                               │
│  [server] serve_ui = false                           │
│  ├── Own bots + botmanager                           │
│  └── Opens WS to master on startup                   │
└──────────────────────────────────────────────────────┘
```

Configure in `config.toml` — see `config.toml.example` for full reference and architecture diagrams.

### DataSync (shared game knowledge)

All VMs share one galaxy map, market data, and pirate positions via an HTTP sync API on the master. Client VMs forward master's sync port through an SSH tunnel.

```
┌─ MASTER VM ──────────────────────────────────────────┐
│  [datasync] mode = "master", port = 4001             │
│  Exposes /sync/* HTTP endpoints (SSH-tunnel only)    │
└──────────────────────────────────────────────────────┘
         ▲ SSH forward tunnel (client → master:4001)
         │
┌─ CLIENT VM ──────────────────────────────────────────┐
│  [datasync] mode = "client"                          │
│  master_url = "http://127.0.0.1:4001"                │
│  Pulls map/topology every 5 min; pushes market/      │
│  pirate data every 60 s                              │
└──────────────────────────────────────────────────────┘
```

Synced data: galaxy map systems + connections, POI resources, market prices, pirate locations, per-VM bot statistics.

### Commander Advisory

A scoring engine that evaluates every bot × routine combination and surfaces suggestions in the **Commander → Advisory** tab. Operates on the full fleet (local + all connected VMs) — never auto-applies, all assignments remain manual.

```
Every 3 minutes:
  1. Collect BotStatus[] from local bots + all remote VMs (via ProxyHub)
  2. Load active Goals from goals store
  3. Snapshot EconomyEngine (supply/demand, deficits, surpluses)
  4. AdvisoryCommander.evaluate() → Suggestion[] with scores + reasoning
  5. Display in Commander → Advisory tab (Apply button per suggestion)
```

Suggestion scoring factors: base routine score, goal strategy weights, supply chain deficits bonus, fleet diversity penalty, switch cost, fuel risk penalty, faction storage bonus.

---

## Needs Matrix & Role Protocols

The **Needs Matrix** is the fleet's shared production ledger — a SQLite table (`needs_matrix`) that every bot on every VM can read and that the coordinator writes to every cycle.

```
Coordinator (every cycle)
  ├── computeOreQuotas()  → replaceNeedsMatrixTargets('mine',  [...])
  └── computeCraftLimits() → replaceNeedsMatrixTargets('craft', [...])

botmanager (every view_faction_storage)
  └── updateNeedsMatrixCurrent(itemId, qty, bot)

botmanager (every faction_deposit/withdraw)
  └── adjustNeedsMatrixCurrent(itemId, ±delta, bot)

swarmcoord.broadcastMaterialNeed()
  └── setTarget(itemId, ..., source='buy')   ← cross-VM persistence
```

### Reading the matrix

| Role | Reads from | Logic |
|------|-----------|-------|
| **Miner** | `getTopNeedsMatrixDeficits('mine')` | Picks highest-deficit ore with a mapped ore-belt; falls back to `settings.oreQuotas` if NM is stale (>2 h) |
| **SmartSelector** | `getNeedsMatrixBySource('mine')` | Returns score=1 (miner can't win) when all targets are met; boosts explorer +20 pts as "pivot" signal; scales miner score by 0.5–1.5× based on deficit urgency |
| **Gatherer** | (indirectly via goal_type) | `build` goals deposit to faction storage; `craft` goals deposit to personal storage |

### Chain efficiency

The coordinator logs a fleet health snapshot every cycle:

```
Chain efficiency: 67% (4/6 targets met)
⚠ Bottlenecks: Iron Ore 12/500, Copper Ore 0/200
```

Items below 50% of their target are listed as bottlenecks, sorted by absolute deficit.

### REST endpoint

```
GET /api/needs-matrix                 → all entries
GET /api/needs-matrix?source=mine     → ore targets only
GET /api/needs-matrix?deficits=1      → only items short of target
GET /api/needs-matrix?source=craft&deficits=1
```

---

## Features at a Glance

- **Unified Fleet Dashboard** — all bots from all VMs in one table with live credits, fuel, hull, cargo, ₡/hr
- **Vue 3 SPA** — reactive real-time UI, WebSocket log streaming, dark space theme
- **25 Routines** — from autonomous mining to full LLM fleet command
- **10-tab Bot Profile** — manual control, ship management, combat, social, AI log
- **Faction Management** — members, storage, facilities, diplomacy, missions, trade intel
- **Galaxy Map** — auto-built from explorer data, shared via DataSync across VMs
- **Market Orders** — view, edit prices, and cancel active buy/sell orders per bot
- **Shipyard** — commission ships, manage fleet and modules
- **Commander tab** — six sub-tabs: Advisory scoring, Goals (Gather Goals + Craft Planner + Fleet Goals), Missions browser, Stats, Action Log, AI Agent
  - **Missions** — three-tab browser (Active / Available / Completed) with live objective progress, embedded in Commander
  - **Goals** — Gather Goals shows all queued goals per bot; Craft Planner appends to goal queue; Gatherer routine distributes materials across bots with non-overlapping component claims
- **Needs Matrix** — SQLite-persisted fleet production targets (`needs_matrix` table): coordinator writes ore/craft targets each cycle; every `view_faction_storage` updates current quantities; miners, gatherers, and SmartSelector all read from it for live demand-driven decisions
- **Role Protocols** — bots switch roles based on real demand: miners pivot to explorer when all ore quotas are met; SmartSelector applies a 0.5–1.5× urgency multiplier to miner score based on worst deficit; chain efficiency % logged each coordinator cycle with top-3 bottleneck list
- **Stats View** — unified fleet statistics aggregated from all VMs (no pool splitting)
- **Rate-limit protection** — IP blocking with live header countdown
- **Catalog caching** — 24 h SQLite cache, zero repeated catalog API calls

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- A SpaceMolt account — register at [spacemolt.com/dashboard](https://spacemolt.com/dashboard) to get a registration code

### Install

```bash
git clone https://github.com/hs172a/hex-bots.git
cd hex-bots
bun install
```

### Development (two terminals)

```bash
# Terminal 1 — backend + WebSocket (port 3210)
bun start

# Terminal 2 — Vue SPA hot-reload (port 5173)
bun run dev:web
```

Open `http://localhost:5173`. Vite proxies `/ws` and `/api` to the backend automatically.

### Production (single command)

```bash
bun run build:web   # compile Vue SPA → dist/web/
bun start           # serves everything at http://localhost:3210
```

Use `PORT=8080 bun start` for a different port.

### Multi-VM Setup

See `config.toml.example` for detailed configuration of Hub, DataSync, and SSH tunnel options. Quick summary:

1. **Master VM** — set `[hub] mode = "master"`, optionally `[datasync] mode = "master"`
2. **Client VMs** — set `[hub] mode = "client"`, `master_ws_url = "ws://master-ip:3210"`, `[server] serve_ui = false`
3. **DataSync** — SSH forward tunnel on each client from `localhost:4001` → `master:4001`; set `[datasync] mode = "client"`, `master_url = "http://127.0.0.1:4001"`

### Production with Code Sync

When `code_sync_interval_sec` is set in `config.toml`, client VMs pull code from the master and call `process.exit(0)` to apply updates. Use a supervisor script so the process restarts cleanly:

```bash
chmod +x start.sh
./start.sh            # foreground
nohup ./start.sh &    # background
```

> **⚠️ Never use `bun --hot` on a VM with code sync enabled.**
> HMR triggers a restart on every single file write. Syncing 50+ files causes cascading restarts that exhaust memory (3 GB RSS on 1 GB RAM → OOM segfault).
> `start.sh` replaces `--hot` with a single clean restart after all files are applied atomically.

---

## Adding Bots

From the dashboard header:

1. **Register New** — enter a registration code from [spacemolt.com/dashboard](https://spacemolt.com/dashboard), pick a username and empire
2. **Add Existing** — enter username + password for an existing account

Credentials are saved to `sessions/<username>/credentials.json` and auto-discovered on restart.

---

## Dashboard

### Bot Table
All bots at a glance — name, ship, state, routine, credits, ₡/hr, fuel, hull/shield, cargo, location.

- **₡/hr column** — rolling 1-hour earnings rate, green = earning, red = spending
- **Bot state badges** — running bots show their current routine name
- **Inline start** — select a routine and start any bot directly from the table row

### Fleet Stats Bar
Active Bots · Fleet Credits · Trade Profit (today) · Trades (today) · Avg Profit/Trade · Ores Mined · Items Crafted · Systems Explored

### Log Panels
Activity Log, Broadcast/Chat, and System Messages — all auto-scroll to newest entry.

---

## Bot Profile

Click any bot name to open its profile. A compact **sidebar** shows:
- Inventory, Station Storage, Faction Storage (if applicable)
- **Deposit Settings** — per-bot primary/secondary deposit mode (`Faction Storage` / `Station Storage`); overrides the global routine setting and is saved immediately. Falls back to the global miner/harvester setting if not set.

### Tabs

Tab order: **Control · Ship · Facility · Insurance · Combat · Profile · Station · Log · Notes · Social**

| Tab | What it does |
|-----|--------------|
| 🛠️ Control | Manual commands, travel, craft, exec panel, live log |
| 🛸 Ship | Modules, hull/shield bars, detailed stats, install/uninstall |
| 🏗 Facility | Personal facilities — Mine (view/enable/upgrade) and Build (browse types, set gatherer goal) |
| 🛡️ Insurance | Ship insurance management |
| ⚔️ Combat | Nearby scan, attack, stance (fire/brace/flee), advance/retreat, hull bars |
| 👤 Profile | Set status, clan tag, anonymous mode, ship colors, home base |
| 🏠 Station | Station info, services, all facilities at the station |
| 📜 Log | Captain's log entries (list/view/add) |
| 📝 Notes | In-game note documents (create, read, edit) |
| 🤝 Social | Player trades (view pending, accept/decline, new offer) + Send Gift |

### Control Tab
- **Full response log** — every command prints all server data line-by-line (POIs, connections, cargo, market prices, nearby players, etc.)
- **Execution lock** — control grid is dimmed while a command is in flight, preventing accidental double-clicks
- **Craft filter** — recipe dropdown shows only recipes craftable with current cargo; card shows ingredients with "in cargo" count and output item
- **Long Distance Travel** — system name search (sorted by relevance: exact → starts-with → substring), multi-hop route calculation with jump count pre-check, auto-sequential execution with progress indicator
- **Refresh Catalog** — force-refreshes station/ship catalog without restart

### Ship Tab
- Side-by-side layout: ship stats + installed modules
- Detailed stats: armor, shield recharge rate, speed, slot counts, CPU/power usage bars
- Ship class tooltip: image, base stats, description, flavor tags (from public catalog)
- Rich module cards: quality grade, wear % (color-coded), CPU/power cost, type-specific stats
- Toast notification on install/uninstall success or error

---

## Routines

| Routine | Description |
|---------|-------------|
| **Miner** | Mines ore at asteroid belts. **Needs Matrix integration**: reads `getTopNeedsMatrixDeficits('mine')` first (fresh < 2 h) — picks highest-deficit ore with a mapped belt; falls back to `settings.oreQuotas`, then swarm demand signal. Anti-collision via claim registry; cargo threshold; home system navigation; belt respawn waiting. |
| **Explorer** | Jumps system to system, visits every POI, surveys resources. Builds the galaxy map. Gets a SmartSelector +20 bonus when all ore quotas are met. |
| **Crafter** | Crafts to configured stock limits. Auto-crafts prerequisites. Falls back to XP-grinding when skill-blocked. **autoCraft mode**: ranks all craftable recipes by profit margin (volume-weighted market prices, owned items cost 0), crafts top N most profitable. BOM summary log each cycle. |
| **Coordinator** | Analyses cross-station market demand. Auto-adjusts miner ore quotas and crafter craft limits. **Publishes both to `needs_matrix`** each cycle so all bots see live targets. Logs chain efficiency % and bottleneck items. |
| **Fuel Rescue** | Monitors fleet for stranded bots (low fuel), delivers fuel cells or credits. |
| **Salvager** | Loots wrecks, tows to salvage yard, scraps or sells while docked. |
| **Trader** | Finds price spreads between stations, buys low / sells high. Insurance before runs, mission handling at every dock. |
| **Gas Harvester** | Harvests gas clouds and nebulae, deposits to faction or station storage. |
| **Ice Harvester** | Harvests ice fields, deposits to faction or station storage. |
| **Gatherer** | Collects build and craft materials for fleet goals. `goal_type='build'` deposits to **faction storage** (accessible to all bots); `goal_type='craft'` deposits to **personal storage**. Staleness guard: faction storage DB cache > 30 min is ignored to prevent false demand suppression. Non-overlapping component claims via swarmcoord. **Phase 0.5 build executor**: when all materials for an own build goal are confirmed in faction storage, gatherer navigates to the target station and issues `faction_build` — no separate bot needed. |
| **Faction Trader** | Runs faction sell routes, deposits to faction storage. Returns home when empty. |
| **Cleanup** | Consolidates scattered station storage to a home base. |
| **Hunter** | Autonomous pirate patrol with BFS navigation, combat stances (fire/brace/flee), faction alert response within configurable jump range. |
| **Scout** | Surveys a configured list of systems for resources. |
| **Return Home** | Returns bot to home station, deposits cargo to faction storage. |
| **Quartermaster** | Manages faction storage supply — buys needed items, sells surplus. |
| **Mission Runner** | Accepts and completes NPC missions automatically. |
| **Ship Upgrade** | Saves credits and purchases the next configured ship upgrade. |
| **Scavenger** | Loots abandoned POIs and derelict ships across explored systems. |
| **AI** | In-process LLM agent (OpenAI-compatible/Ollama). Maintains persistent memory, uses map/catalog tools, writes captain's log. |
| **PI Commander** | Subprocess wrapper for `commander.ts` PI-agent. Full tool suite from game's OpenAPI spec, session handoff, per-bot instruction. Best with Claude/GPT-4. |
| **AI Commander** | Fleet-level LLM reads all bot statuses and issues `start`/`stop`/`exec` decisions every N seconds. Run on a dedicated "HQ" bot. |
| **Facility Manager** | Monitors owned facilities; alerts on rent expiration; auto-renews by docking and toggling off/on; applies faction facility upgrades when configured. |
| **Trade Broker** | Intercepts P2P trade notifications; auto-accepts offers matching `acceptItems` list or `minAcceptCredits`; auto-declines others; optionally redistributes surplus to faction members at the same station. |
| **SmartSelector** | Rule-based orchestrator: scores all routines each cycle. **Needs Matrix integration**: `scoreMiner()` returns 1 when all ore targets are met (quota saturation); applies 0.5–1.5× urgency multiplier on active deficits; explorer gets +20 when all quotas satisfied. Also: miner POI-awareness, crafter profit-awareness, `get_nearby` enemy penalty, ship module awareness, faction intel signals. **Sticky gatherer**: once gatherer is selected, SmartSelector keeps re-running it (score 90 for ready builds, 25–55 for pending deliveries) without switching to miner/trader until all fleet goals and build goals are resolved. |

### Common routine features
All mining/travel routines also include:
- Auto-refuel and hull repair at configurable thresholds
- Wreck scavenging (loot fuel cells and cargo from debris)
- Emergency fuel recovery (sell cargo, wait for Fuel Rescue)
- Auto-collect credits + items from station storage on every dock
- Skill checks on startup (validates required skills are trained)

### Deposit modes
All harvesting/mining routines support configurable deposit priority:
- **`faction`** — `faction_deposit_items` (primary), falls back to `storage` on error
- **`storage`** — direct station `deposit_items`
- **`sell`** — sell to market
- **`gift`** — transfer to another bot

Global defaults set in **Settings**; per-bot overrides via **Bot Profile → Deposit Settings** sidebar.

---

## UI Views

### Market View — My Orders Tab
- Load active buy/sell orders per bot (`view_orders`)
- Inline price edit (pencil icon → Enter or ✓ → `modify_order`)
- Cancel with confirmation modal (`cancel_order`)

### Faction View
- **Overview** — leader, members, treasury, allies/enemies/wars, deposit/withdraw credits
- **Members** — role management, kick, invite, quick-invite own bots (auto-accept)
- **Storage** — view/deposit/withdraw; detects missing lockbox and offers to build one
- **Facilities** — list, toggle, upgrade, build new (lockbox, etc.)
- **Diplomacy** — ally/enemy, declare war, propose/accept peace
- **📋 Missions** — post/list/cancel faction missions (`faction_post_mission`, `faction_cancel_mission`)
- **📡 Intel** — trade intel status, query by item/system, submit observations

### Missions View
- Three-tab layout: **Active / Available / Completed** with live counts
- Active tab has a green pulse dot when a mission is ready to claim
- Mission cards: icon, difficulty/type badges, objectives with progress bars, rewards, NPC giver
- **Active:** Claim Rewards + Abandon buttons
- **Available:** grouped by System → Station; shows cap warning at 5/5
- **Completed:** "View Details" opens NPC dialog chain modal

### Shipyard View
- **Overview** — hull/shield/fuel/cargo bars, module list, quick repair/refuel
- **Fleet** — all owned ships, switch active ship
- **Showroom** — ships available at current station
- **Commission Ship** — catalog browser (empire/tier/search filter), commission + order flow
- **Module Management** — install from cargo, uninstall installed

### Settings
Grouped sidebar (System / Fleet / Economy / Exploration / Harvesting / Combat / AI):

- **⚙️ General** — faction storage station, donate %, API request logging, max jumps
- **🔔 Alerts** — webhook URL, alert triggers (credits, hull, etc.)
- **Fleet** — Coordinator, Fuel Rescue, Quartermaster, Mission Runner, Ship Upgrade
- **Economy** — Miner, Crafter (`autoCraft`, `minProfitPct`, `maxAutoCraftRecipes`), Trader, Gatherer, Cleanup; deposit mode (primary/secondary)
- **Exploration** — Explorer, Scout, Return Home
- **Harvesting** — Gas/Ice Harvester (with deposit mode), Scavenger, Salvager
- **🎯 Hunter** — patrol system, thresholds, NPCs-only, faction alert range
- **🏗 Facility Manager** — autoRenew, autoUpgradeFacilities, rentAlertTicks, cycleIntervalSec
- **🤝 Trade Broker** — acceptItems list, minAcceptCredits, autoDecline, redistributeToFaction
- **AI** — PI Commander (model/session/instruction/debug), AI Agent (endpoint/model/cycle), AI Commander (fleet LLM, interval, max actions)

### Header Controls
- **🗺️ Force Refresh Map** — **fully wipes** galaxy map (SQLite + memory + `map.json`), then re-seeds from public API
- **📦 Force Refresh Catalog** — **fully wipes** catalog (SQLite + memory + `catalog.json`), then re-fetches via first available bot session

### Stats View
Per-bot statistics — ores mined, crafted, trades, profit, systems explored, skills, ₡/hr. Faction activity log. Mission Analytics.

**Unified fleet view** — aggregates stats from all VMs automatically (DataSync master pools + local `statsDaily`). Local data takes precedence; 🔄 button force-refreshes all pools. No pool splitting — the entire fleet is always shown in one table.

### Action Log View
Per-bot action history with category filters and pagination.

### Rate-Limit IP Blocking
- Server blocks IPs with 50+ violations/min (2 min → 30 min escalating)
- Header shows **⛔ IP Blocked M:SS** orange badge with live countdown
- Automatically clears on both backend and frontend

---

## Project Structure

```
src/
  botmanager.ts        Entry point — discovers bots, starts web server, WebActions
  bot.ts               Bot class — login, exec, status caching, routine runner
  api.ts               SpaceMolt REST client (v1/v2) — session mgmt, rate-limit, cache
  swarmcoord.ts        Inter-bot coordination — station/trade/demand claims + NM bridge
  miningclaims.ts      Anti-collision claim registry for miners
  mapstore.ts          Galaxy map — persistence, BFS pathfinding, faction storage, needs matrix
  catalogstore.ts      Game catalog cache — 24 h SQLite persistence
  publicCatalog.ts     Public ship & station catalog (no auth)
  httpcache.ts         Process-level HTTP cache (ETag + Cache-Control aware)
  apilogger.ts         Optional file logging for API requests/responses
  session.ts           Credential persistence
  ui.ts                Log routing (bot → web server → browser)
  schema.ts            JSON schema for settings validation
  datasync.ts          DataSyncServer/DataSyncClient — cross-VM knowledge sync
  proxyhub.ts          ProxyHub — WebSocket proxy for multi-VM UI aggregation
  sshtunnels.ts        SSH tunnel manager
  data/
    database.ts        SQLite schema + migrations (V1–V8)
    needs-matrix-db.ts NeedsMatrixDb — fleet production targets + faction storage reality
    faction-storage-db.ts FactionStorageDb — faction storage snapshots + buildings
    market-prices-store.ts Market price history
    catalog-db.ts      Catalog SQLite cache
    session-store.ts   Bot sessions (migrated from files)
    goals-store.ts     Persistent gather + fleet goals
    training-logger.ts LLM training log writer
    retention.ts       Log retention manager
  types/
    game.ts            Complete SpaceMolt game type definitions
    config.ts          Routine config type definitions (Zod schemas)
  routines/
    common.ts          Shared utilities — dock, refuel, navigate, scavenge, deposit
    miner.ts           Miner — NM-first ore selection, ore quotas, belt respawn-wait
    explorer.ts        Explorer — search_systems routing when local map exhausted
    crafter.ts         Crafter — catalog cache, prerequisite crafting, autoCraft mode
    coordinator.ts     Coordinator — market analysis, NM ore/craft targets, chain efficiency
    gatherer.ts        Gatherer — goal_type-aware deposit, staleness-guarded cache check
    smart_selector.ts  SmartSelector — NM quota saturation scoring, role pivot
    rescue.ts          Fuel Rescue
    salvager.ts        Salvager
    trader.ts          Station-to-station trader
    gas_harvester.ts   Gas cloud / nebula harvesting
    ice_harvester.ts   Ice field harvesting
    faction_trader.ts  Faction sell routes + return-home
    hunter.ts          PvP/PvE patrol — combat alerts, BFS navigation
    cleanup.ts         Consolidate scattered station storage
    scout.ts           Multi-system resource survey
    return_home.ts     Return to home station + deposit
    quartermaster.ts   Faction storage supply management
    mission_runner.ts  Autonomous NPC mission runner
    ship_upgrade.ts    Automated ship upgrade saver
    scavenger.ts       Cross-system loot scavenger
    ai.ts              In-process LLM agent (OpenAI-compatible)
    pi_commander.ts    PI-agent subprocess wrapper (commander.ts → pi-ai)
    ai_commander.ts    Fleet-level LLM orchestrator
    facility_manager.ts Personal facility monitoring + auto-renew
    trade_broker.ts    P2P trade offer automation
  commander/
    advisory-commander.ts Scoring brain — evaluates every 3 min, ADVISORY ONLY
    economy-engine.ts  Economy snapshot — deficits, surpluses, supply/demand
    strategies.ts      Goal-based strategy weight profiles
    types.ts           FleetSummary, EconomySnapshot types
  __tests__/
    needs-matrix.test.ts   59 tests — NeedsMatrixDb, role protocols, chain efficiency
    swarmcoord.test.ts     Station/trade/material demand claims
    gather-goal.test.ts    Gatherer goal progress + demand cooperation
    mapstore.test.ts       MapStore — faction storage, BFS, price queries
    regression.test.ts     Cross-cutting regression tests
    publiccatalog.test.ts  Public catalog parsing
    training-logger.test.ts Training logger
  web/
    server.ts          Bun HTTP + WebSocket server; REST endpoints incl. /api/needs-matrix
    src/               Vue 3 SPA (Vite + TailwindCSS + Pinia)
      views/
        DashboardView.vue    Fleet table, auto-scroll logs, fleet stats bar
        BotProfile.vue       Bot profile — sidebar + 10 tabs
        MarketView.vue       Market overview + My Orders
        ShipyardView.vue     Fleet, showroom, commission, modules
        MissionsView.vue     Three-tab mission browser (embedded in Commander)
        FactionView.vue      Faction: members, storage, all-storages, buildings, diplomacy, intel
        SettingsView.vue     Grouped settings (25 routines + hub + general)
        MapView.vue          Interactive galaxy map + faction buildings overlay
        StatsView.vue        Unified fleet stats from all VMs
        ActionLogView.vue    Per-bot action history
        CommanderView.vue    Advisory + Goals + Missions + Stats + Action Log + AI Agent
      components/
        BotControlPanel.vue  Manual control — full log, craft filter, LDT, exec lock
        BotStationPanel.vue  Station info + facilities
        BotShipPanel.vue     Ship stats, modules, install/uninstall
        GalaxyMapCanvas.vue  Canvas galaxy map — faction buildings markers
        CaptainsLogPanel.vue Captain's log
        BotProfilePanel.vue  Player profile — status, colors, home base
        CombatPanel.vue      Combat — nearby scan, attack, stance
        InsurancePanel.vue   Ship insurance
        NotesPanel.vue       In-game note documents
        SocialPanel.vue      Trades + send_gift
      composables/
        useDashboardLogs.ts  Broadcast log parsing and categorisation
        useMissions.ts       Mission state composable (MAX_AVAILABLE_DISPLAY = 60)
        recipeTree.ts        Recipe dependency tree analyzer
      stores/
        botStore.ts          Pinia store — bots, catalog, settings, faction storage, ₡/hr
data/
  db.sqlite            SQLite — all persistent data (schema V8+)
  api-logs/            API request/response logs (opt-in)
sessions/
  <username>/
    credentials.json   Bot login credentials (auto-discovered on startup)
```

---

## Environment Variables

### AI Routine (`ai.ts`)
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_COMPAT_BASE_URL` | `http://localhost:11434/v1` | LLM endpoint (Ollama or OpenAI-compatible) |
| `OPENAI_COMPAT_API_KEY` | `ollama` | Bearer token |
| `AI_MODEL` | `llama3.2` | Model name |

Values in **Settings → AI** override environment variables.

### PI Commander (`pi_commander.ts`)
| Setting | Default | Description |
|---------|---------|-------------|
| `model` | `ollama/llama3.2` | Full model string, e.g. `anthropic/claude-sonnet-4-20250514` |
| `instruction` | Play SpaceMolt effectively | Mission instruction for the agent |
| `session` | bot username | Maps to `_sessions/<name>/credentials.json` |
| `debug` | `false` | Pass `--debug` for verbose LLM output |

Configure in **Settings → 🤖 PI Commander**. Per-bot overrides in `data/settings.json`:
```json
{"pi_commander":{"bots":{"HexBot7":{"model":"ollama/qwen3:8b","instruction":"Mine ore and upgrade your ship"}}}}
```

> **AI vs PI Commander:** `ai.ts` uses a direct OpenAI-compat loop (good for local/Ollama). `pi_commander.ts` wraps the full `commander.ts` agent with `pi-ai`, session handoff, and tools generated from the game's live OpenAPI spec — better for Claude/GPT-4.

---

## About SpaceMolt

[SpaceMolt](https://www.spacemolt.com) is a massively multiplayer game designed for AI agents. Thousands of LLMs play simultaneously in a vast galaxy — mining, trading, exploring, and fighting.

## License

MIT
