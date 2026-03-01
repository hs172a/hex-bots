# Hex Bots

> **This is a fork of [spacemolt_botrunner](https://github.com/humbrol2/spacemolt_botrunner) by humbrol2@gmail.com.**
> The original project is a great foundation — this fork replaces the vanilla-JS frontend with a full **Vue 3 SPA** and adds many new UI and automation features described below.

A web-based bot fleet manager for [SpaceMolt](https://www.spacemolt.com) — run multiple bots with automated routines, monitor and control everything from a reactive live dashboard.

![Dashboard](https://img.shields.io/badge/interface-vue3_spa-blue) ![Runtime](https://img.shields.io/badge/runtime-bun-black) ![No Dependencies](https://img.shields.io/badge/deps-zero_runtime-green) ![Version](https://img.shields.io/badge/version-1.3.0-purple)

## What It Does

Bot Runner manages a fleet of SpaceMolt bots from a single web dashboard. Each bot runs an automated routine (mining, exploring, crafting, salvaging, hunting, or full AI control) while you monitor from your browser.

- **Vue 3 SPA Dashboard** — reactive real-time UI at `http://localhost:3000`
- **13 Routines** — Miner, Explorer, Crafter, Coordinator, Fuel Rescue, Salvager, Trader, Gas Harvester, Ice Harvester, Gatherer, Faction Trader, Hunter, AI
- **Faction Management** — members, storage, facilities, diplomacy, intel
- **Galaxy Map** — auto-built from explorer data
- **Manual Control** — full command panel per bot with detailed live log output, craft filter, and execution lock
- **Multi-bot** — run as many bots as you want, each with its own routine
- **Zero runtime deps** — just Bun

## New Features in This Fork

### Dashboard
- **Extended fleet stats bar** — Active Bots, Fleet Credits, Trade Profit (today), Trades (today), Avg Profit/Trade, Ores Mined, Items Crafted, Explored systems
- **Auto-scrolling log panels** — Activity Log, Broadcast/Chat, and System Messages all scroll to the newest entry automatically
- **Bot state badges** — running bots show their current routine name instead of just "running"
- **Inline start** — select a routine and start any bot directly from the fleet table row

### Bot Profile — Control Panel
- **Full response log** — every command prints all server data line-by-line just like the legacy UI (POIs, connections, cargo items, market prices, nearby players, etc.)
- **Execution lock** — the control grid is dimmed and pointer-events disabled while a command is in flight, preventing accidental double-clicks
- **Craft filter** — the recipe dropdown only shows recipes you can actually craft with your current cargo; recipe card shows each ingredient with quantity and "in cargo" count, plus the output item
- **Refresh Catalog button** — force-refreshes the public station and ship catalog from the SpaceMolt API without restarting the server
- **Long Distance Travel** — unified "Auto Start" button handles undocking and sequential multi-hop jumps; shows the final destination system in the route header

### Bot Profile — Ship Tab
- **Side-by-side layout** — Ship stats and Installed Modules displayed in one row
- **Detailed ship stats** — armor, shield recharge rate, speed, slot counts (weapons/defense/utility), CPU/power usage bars
- **Ship class tooltip** — hover the class name to see a graphical card with the ship image, base stats, description and flavor tags (sourced from the public catalog)
- **Rich module cards** — quality grade, wear percentage (color-coded), CPU/power cost, and type-specific stats (mining power/range, damage, shield/armor bonus, ammo type)
- **Module notifications** — toast notification (bottom-center) on successful install/uninstall showing the server message; red toast on any command error
- **Station Shop** — items sorted by availability (in-stock first), category icons, buy/sell prices, market spread, stock quantity

### Bot Profile — Skills Tab
- Skills grouped by category with color-coded headers and icons
- Progress bars per skill showing XP towards next level

### Bot Profile — Travel Tab
- **Long Distance Travel** — system name search with autocomplete, multi-hop route calculation, automatic sequential jump execution with progress indicator

### Shipyard View (new page)
- **Overview** — ship hull/shield/fuel/cargo bars, current module list, quick repair/refuel
- **Fleet** — list all owned ships with status, switch active ship
- **Showroom** — browse ships available for purchase at the current station
- **Commission Ship** — full ship catalog browser with filters (empire, tier, search), ship card with image + stats + build materials, commission quote + order flow
- **Module Management** — install from cargo, uninstall installed modules

### Missions View (redesigned)
- Mission cards with icon + title, difficulty badge, objectives list, overall progress bar
- Larger prominent action buttons (Accept, Complete, Abandon)

### API Request Logging
- Optional file logging of all game API requests and responses to `data/api-logs/`
- Disabled by default; toggle in **Settings → General → Enable API Request Logging**
- Setting persists across restarts and takes effect immediately

### Catalog Caching
- Game catalog (items, ships, skills, recipes) is fetched once on first bot login and cached to `data/catalog.json`
- Cached data is reused for 24 hours — routines (Crafter, Coordinator) read from cache instead of calling `/api/v1/catalog` on every cycle
- Dramatically reduces catalog API traffic for long-running bots

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- [Node.js](https://nodejs.org) (for Vite build tooling)
- A SpaceMolt account — register at [spacemolt.com/dashboard](https://spacemolt.com/dashboard) to get a registration code

### Install

```bash
git clone https://github.com/humbrol2/spacemolt_botrunner.git
cd spacemolt_botrunner
bun install
```

### Development mode (two terminals)

The new Vue 3 SPA requires Vite to compile TypeScript and Vue files. Run the backend and frontend separately:

**Terminal 1 — Backend + WebSocket server:**
```bash
bun start
```

**Terminal 2 — Vue SPA (new UI, with hot-reload):**
```bash
bun run dev:web
```

| URL | What you get |
|-----|--------------|
| `http://localhost:5173` | ✅ New Vue 3 UI (hot-reload) |
| `http://localhost:3000` | Legacy UI (original vanilla JS) |
| `http://localhost:3000/legacy` | Legacy UI (always available) |

Vite automatically proxies `/ws` and `/api` requests to the Bun backend on port 3000.

### Production mode (single command)

Build the Vue SPA once, then run a single server that serves everything:

```bash
bun run build:web   # compile Vue SPA → dist/web/
bun start           # serves new UI at port 3000
```

| URL | What you get |
|-----|--------------|
| `http://localhost:3000` | ✅ New Vue 3 UI (built) |
| `http://localhost:3000/legacy` | Legacy UI |

Use `PORT=8080 bun start` for a different port.

## Dashboard

### Bot Table
All bots at a glance — name, ship, state, credits, fuel, hull/shield, cargo, location. Click a bot name to open its profile.

### Bot Profile
Full manual control panel for any bot:
- Travel, jump, dock/undock
- Mine, scan, refuel, repair
- Buy/sell with live market prices
- Craft with recipe browser
- Deposit/withdraw station storage
- Send gifts/credits between bots
- Custom command input for any API call
- **Toast notifications** — success (green), warning (orange) and error (red) feedback for every command

### Routines

| Routine | Description |
|---------|-------------|
| **Miner** | Mines ore at asteroid belts, returns to station to sell/deposit. Configurable target ore, cargo threshold, sell vs deposit. |
| **Explorer** | Jumps system to system, visits every POI, surveys resources. Builds the galaxy map. |
| **Crafter** | Crafts items up to configured stock limits. Add/remove recipes with category picker. Includes fallback XP-grinding when configured set is exhausted. |
| **Coordinator** | Analyses market demand across the fleet, assigns ore quotas to miners and craft targets to crafters. Uses cached global market data. |
| **Fuel Rescue** | Monitors fleet for stranded bots (low fuel), delivers fuel cells or credits. |
| **Salvager** | Scavenges wrecks for loot. In full-salvage mode: loots wrecks, tows them to a salvage yard, then scraps or sells them while docked. |
| **Trader** | Finds price spreads between stations, buys low and sells high. |
| **Gas Harvester** | Harvests gas clouds and nebulae, deposits to faction storage or station. |
| **Ice Harvester** | Harvests ice fields, deposits to faction storage or station. |
| **Gatherer** | Collects build materials for a faction facility. Goal assigned from Station → Build tab. |
| **Faction Trader** | Runs faction sell routes, deposits items to faction storage. Returns home when storage is empty. |
| **Hunter** | Patrols lawless systems, engages NPC/player targets, monitors ammo/hull thresholds. Responds to faction combat alerts within a configurable jump range. |
| **AI** | Uses an LLM (Ollama or any OpenAI-compatible endpoint) to play SpaceMolt autonomously. Maintains persistent memory, uses map/catalog tools, and writes captain's log entries. |

All routines include:
- Auto-refuel and repair at configurable thresholds
- Wreck scavenging (loot fuel cells and cargo from debris)
- Emergency fuel recovery (sell cargo, wait for rescue)
- Auto-collect credits from station storage on dock
- Skill checks before starting (validates required skills are trained)

### Faction Tab
Full faction management from the browser:
- **Overview** — leader, members, treasury, allies/enemies/wars, deposit/withdraw credits
- **Members** — role management (recruit/member/officer/leader), kick, invite players, quick-invite your other bots with auto-accept
- **Storage** — view/deposit/withdraw faction items. Detects missing lockbox and offers to build one
- **Facilities** — list faction facilities at current station, toggle on/off, check upgrades, build new facilities (lockbox, etc.)
- **Diplomacy** — set ally/enemy, declare war, propose/accept peace
- **Intel** — query intel by system/player, view intel status, trade intel

### Settings
Configuration saved to `data/settings.json`. Changes apply immediately (no restart needed).

- **General** — faction storage system/station, faction donate %, enable API request logging
- **Miner** — target ore, mining system, deposit bot, sell ore, cargo/refuel/repair thresholds, per-bot ore quotas
- **Crafter** — recipe list with add/remove + category picker, stock limits, thresholds
- **Explorer** — max jumps, survey mode, scan POIs, avoid low security, thresholds
- **Fuel Rescue** — scan interval, fuel trigger %, cells to deliver, credits to send
- **Trader** — min profit/unit, max cargo value, home system, thresholds
- **Gas Harvester** / **Ice Harvester** — target resource type, system, deposit mode, thresholds
- **Salvager** — target system, home system, primary/secondary deposit mode, thresholds
- **Hunter** — patrol system, refuel/repair/flee thresholds, ammo threshold, NPCs-only, auto cloak, faction alert response range
- **AI** — LLM base URL, API key, model name, cycle interval, max tool calls per cycle, captain's log frequency

### Other Tabs
- **Map** — galaxy map built from explorer data, filterable by security level and resources
- **Missions** — browse available missions per system, view/claim/complete active missions per bot
- **Shipyard** — fleet management, ship showroom, commission new ships, module management

## Adding Bots

From the dashboard:

1. **Register New** — enter a registration code from [spacemolt.com/dashboard](https://spacemolt.com/dashboard), pick a username and empire
2. **Add Existing** — enter username and password for an existing account

Credentials are saved to `sessions/<username>/credentials.json`. Bots auto-discover on restart.

## Project Structure

```
src/
  botmanager.ts      Entry point — discovers bots, starts web server, handles WebActions
  bot.ts             Bot class — login, exec, status caching, routine runner
  api.ts             SpaceMolt REST client (v1/v2) — session mgmt, rate-limit retry, response cache
  httpcache.ts       Process-level HTTP cache for external fetches (ETag + Cache-Control aware)
  apilogger.ts       Optional file logging for all API requests/responses (data/api-logs/)
  session.ts         Credential persistence
  ui.ts              Log routing (bot → web server → browser)
  debug.ts           Debug logging to data/debug.log
  catalogstore.ts    Game catalog cache (items/ships/skills/recipes) — 24h disk persistence
  publicCatalog.ts   Public ship & station catalog (no auth required)
  mapstore.ts        Galaxy map persistence and pathfinding
  routines/
    common.ts          Shared utilities (dock, refuel, travel, scavenge, emergency recovery)
    miner.ts           Mining routine
    explorer.ts        Exploration routine
    crafter.ts         Crafting routine — catalog cache, fallback XP grind
    coordinator.ts     Fleet coordinator — market demand analysis, cached global market fetch
    rescue.ts          Fuel rescue routine
    salvager.ts        Salvage routine
    trader.ts          Station-to-station price spread trading
    gas_harvester.ts   Gas cloud / nebula harvesting
    ice_harvester.ts   Ice field harvesting
    gatherer.ts        Build material collection
    faction_trader.ts  Faction sell routes + return-home when storage empty
    hunter.ts          PvP/PvE patrol — faction combat alert response, configurable flee/ammo thresholds
    ai.ts              LLM-driven autonomous play (Ollama / OpenAI-compatible)
    cleanup.ts         Consolidate scattered station storage
  web/
    server.ts          Bun HTTP + WebSocket server
    legacy_ui.html     Legacy vanilla-JS UI (always at /legacy)
    src/               Vue 3 SPA (Vite + TailwindCSS + Pinia)
      App.vue          Root layout — sidebar navigation
      components/
        Dashboard.vue         Fleet table, auto-scroll logs, extended fleet stats bar
        BotProfile.vue        Bot profile tabs (Ship, Skills, Travel, Station, Control)
        BotControlPanel.vue   Manual control panel — full log output, craft filter, execution lock
        ShipyardView.vue      Fleet, showroom, commission ship, module management
        MissionsView.vue      Mission browser and active mission tracker
        FactionView.vue       Faction management (overview, members, storage, facilities, diplomacy, intel)
        SettingsView.vue      Per-routine settings — all 13 routines + General
        MapView.vue           Interactive galaxy map
        StatsView.vue         Per-bot stats + faction activity log
      stores/
        botStore.ts           Pinia store — bots, catalog, settings, sendExec, wsSend
data/
  settings.json      Persisted routine settings
  catalog.json       Cached game catalog (refreshed every 24h)
  map.json           Galaxy map data
  ai_memory.json     AI routine persistent memory (goals, insights, decisions)
  api-logs/          API request/response logs (when enabled)
sessions/
  <username>/
    credentials.json
```

## Environment Variables (AI Routine)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_COMPAT_BASE_URL` | `http://localhost:11434/v1` | LLM endpoint (Ollama or OpenAI-compatible) |
| `OPENAI_COMPAT_API_KEY` | `ollama` | Bearer token for LLM endpoint |
| `AI_MODEL` | `llama3.2` | Model name |

Values in **Settings → AI** override these environment variables.

## About SpaceMolt

[SpaceMolt](https://www.spacemolt.com) is a massively multiplayer online game designed for AI agents. Thousands of LLMs play simultaneously in a vast galaxy — mining, trading, exploring, and fighting.

## License

MIT
