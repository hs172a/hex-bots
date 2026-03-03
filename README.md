# Hex Bots

> **Fork of [spacemolt_botrunner](https://github.com/humbrol2/spacemolt_botrunner).** Replaces the vanilla-JS frontend with a full **Vue 3 SPA** and adds extensive automation, UI, and AI features.
>
> **Repository:** https://github.com/hs172a/hex-bots

A web-based bot fleet manager for [SpaceMolt](https://www.spacemolt.com) — run multiple bots with automated routines, monitor and control everything from a reactive live dashboard.

![Interface](https://img.shields.io/badge/interface-vue3_spa-blue) ![Runtime](https://img.shields.io/badge/runtime-bun-black) ![Deps](https://img.shields.io/badge/deps-zero_runtime-green) ![Version](https://img.shields.io/badge/version-1.5.x-purple)

---

## Features at a Glance

- **Vue 3 SPA Dashboard** — reactive real-time UI, WebSocket log streaming
- **21 Routines** — from autonomous mining to full LLM fleet command
- **10-tab Bot Profile** — manual control, ship management, combat, social, AI log
- **Faction Management** — members, storage, facilities, diplomacy, missions, trade intel
- **Galaxy Map** — auto-built from explorer data, seeded from `/api/map`
- **Market Orders** — view, edit prices, and cancel active buy/sell orders per bot
- **Missions** — three-tab browser with live progress tracking
- **Shipyard** — commission ships, manage fleet and modules
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
| **Miner** | Mines ore at asteroid belts, returns to station to deposit/sell. Configurable target ore, cargo threshold, ore quotas, faction donations. |
| **Miner v2** | Anti-collision via claim registry; per-bot ore quotas; faction donate %; home system navigation. |
| **Explorer** | Jumps system to system, visits every POI, surveys resources. Builds the galaxy map. |
| **Crafter** | Crafts to configured stock limits. Auto-crafts prerequisites. Falls back to XP-grinding when set is exhausted. |
| **Coordinator** | Analyses cross-station market demand. Auto-adjusts miner ore quotas and crafter craft limits. |
| **Fuel Rescue** | Monitors fleet for stranded bots (low fuel), delivers fuel cells or credits. |
| **Salvager** | Loots wrecks, tows to salvage yard, scraps or sells while docked. |
| **Trader** | Finds price spreads between stations, buys low / sells high. Insurance before runs, mission handling at every dock. |
| **Gas Harvester** | Harvests gas clouds and nebulae, deposits to faction or station storage. |
| **Ice Harvester** | Harvests ice fields, deposits to faction or station storage. |
| **Gatherer** | Collects build materials for a faction facility. Goal assigned from Station → Build tab. |
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
- **Economy** — Miner, Crafter, Trader, Gatherer, Cleanup; deposit mode (primary/secondary)
- **Exploration** — Explorer, Scout, Return Home
- **Harvesting** — Gas/Ice Harvester (with deposit mode), Scavenger, Salvager
- **🎯 Hunter** — patrol system, thresholds, NPCs-only, faction alert range
- **AI** — PI Commander (model/session/instruction/debug), AI Agent (endpoint/model/cycle), AI Commander (fleet LLM, interval, max actions)

### Header Controls
- **🗺️ Force Refresh Map** — re-seeds galaxy map from public API (`POST /api/admin/refresh-map`)
- **📦 Force Refresh Catalog** — re-fetches item catalog via first available bot session

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
  miningclaims.ts      Shared claim registry for anti-collision between miners
  httpcache.ts         Process-level HTTP cache (ETag + Cache-Control aware)
  apilogger.ts         Optional file logging for API requests/responses
  session.ts           Credential persistence
  ui.ts                Log routing (bot → web server → browser)
  catalogstore.ts      Game catalog cache — 24 h SQLite persistence
  publicCatalog.ts     Public ship & station catalog (no auth)
  mapstore.ts          Galaxy map — persistence, BFS pathfinding, price queries
  schema.ts            JSON schema for settings validation
  types/
    game.ts            Complete SpaceMolt game type definitions
    config.ts          Routine config type definitions
  routines/
    common.ts          Shared utilities — dock, refuel, navigate, scavenge, deposit
    miner.ts           Miner (v1)
    miner-v2.ts        Miner v2 — anti-collision, ore quotas, faction donate
    explorer.ts        Explorer
    crafter.ts         Crafter — catalog cache, prerequisite crafting, XP grind
    coordinator.ts     Coordinator — global market fetch, auto-adjust quotas
    rescue.ts          Fuel Rescue
    salvager.ts        Salvager
    trader.ts          Station-to-station trader
    gas_harvester.ts   Gas cloud / nebula harvesting
    ice_harvester.ts   Ice field harvesting
    gatherer.ts        Build material collection
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
  web/
    server.ts          Bun HTTP + WebSocket server
    src/               Vue 3 SPA (Vite + TailwindCSS + Pinia)
      views/
        DashboardView.vue    Fleet table, auto-scroll logs, fleet stats bar
        BotProfile.vue       Bot profile — sidebar + 10 tabs
        MarketView.vue       Market overview + My Orders
        ShipyardView.vue     Fleet, showroom, commission, modules
        MissionsView.vue     Three-tab mission browser
        FactionView.vue      Faction: members, storage, facilities, diplomacy, missions, intel
        SettingsView.vue     Grouped settings (21 routines)
        MapView.vue          Interactive galaxy map
        StatsView.vue        Per-bot stats + faction activity log
        ActionLogView.vue    Per-bot action history
        CommanderView.vue    AI Commander control panel
      components/
        BotControlPanel.vue  Manual control — full log, craft filter, LDT, exec lock
        BotStationPanel.vue  Station info + facilities (mode='facility' → Mine+Build only)
        BotShipPanel.vue     Ship stats, modules, install/uninstall
        CaptainsLogPanel.vue Captain's log (list/view/add)
        BotProfilePanel.vue  Player profile — status, anonymous, colors, home base
        CombatPanel.vue      Combat — nearby scan, attack, stance, advance/retreat
        InsurancePanel.vue   Ship insurance
        NotesPanel.vue       In-game note documents
        SocialPanel.vue      Trades + send_gift
      composables/
        useDashboardLogs.ts  Broadcast log parsing and categorisation
        useMissions.ts       Mission state composable
      stores/
        botStore.ts          Pinia store — bots, catalog, settings, sendExec, ₡/hr
data/
  db.sqlite            SQLite — settings, catalog, map, sessions, logs, stats
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
