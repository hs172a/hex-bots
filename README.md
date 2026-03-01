# Hex Bots

> **This is a fork of [spacemolt_botrunner](https://github.com/humbrol2/spacemolt_botrunner) by humbrol2@gmail.com.**
> The original project is a great foundation — this fork replaces the vanilla-JS frontend with a full **Vue 3 SPA** and adds many new UI and automation features described below.

A web-based bot fleet manager for [SpaceMolt](https://www.spacemolt.com) — run multiple bots with automated routines, monitor and control everything from a reactive live dashboard.

![Dashboard](https://img.shields.io/badge/interface-vue3_spa-blue) ![Runtime](https://img.shields.io/badge/runtime-bun-black) ![No Dependencies](https://img.shields.io/badge/deps-zero_runtime-green) ![Version](https://img.shields.io/badge/version-1.1.5-purple)

## What It Does

Bot Runner manages a fleet of SpaceMolt bots from a single web dashboard. Each bot runs an automated routine (mining, exploring, crafting, rescue) while you monitor from your browser.

- **Vue 3 SPA Dashboard** — reactive real-time UI at `http://localhost:3000`
- **5 Routines** — Miner, Explorer, Crafter, Coordinator, Fuel Rescue
- **Faction Management** — members, storage, facilities, diplomacy, intel
- **Galaxy Map** — auto-built from explorer data
- **Manual Control** — execute any game command from the detailed bot profile page with instant toast feedback
- **Multi-bot** — run as many bots as you want, each with its own routine
- **Zero runtime deps** — just Bun

## New Features in This Fork

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
| **Crafter** | Crafts items up to configured stock limits. Add/remove recipes with category picker. |
| **Coordinator** | Analyses market demand across the fleet, assigns ore quotas to miners and craft targets to crafters. |
| **Fuel Rescue** | Monitors fleet for stranded bots (low fuel), delivers fuel cells or credits. |

All routines include:
- Auto-refuel and repair at configurable thresholds
- Wreck scavenging (loot fuel cells and cargo from debris)
- Emergency fuel recovery (sell cargo, wait for rescue)
- Auto-collect credits from station storage on dock

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
- **Miner** — target ore, mining system, deposit bot, sell ore, cargo/refuel/repair thresholds
- **Crafter** — recipe list with add/remove + category picker, stock limits, thresholds
- **Explorer** — max jumps, survey mode, scan POIs, avoid low security, thresholds
- **Fuel Rescue** — scan interval, fuel trigger %, cells to deliver, credits to send

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
  botmanager.ts      Entry point — discovers bots, starts web server, handles actions
  bot.ts             Bot class — login, exec, status caching, routine runner
  api.ts             SpaceMolt REST client (v1/v2) with session management and rate-limit retry
  apilogger.ts       Optional file logging for all API requests/responses (data/api-logs/)
  session.ts         Credential persistence
  ui.ts              Log routing (bot → web server → browser)
  debug.ts           Debug logging to data/debug.log
  catalogstore.ts    Game catalog cache (items/ships/skills/recipes) — 24h disk persistence
  publiccatalog.ts   Public ship & station catalog (no auth required)
  mapstore.ts        Galaxy map persistence and pathfinding
  routines/
    common.ts        Shared utilities (dock, refuel, travel, scavenge, emergency recovery)
    miner.ts         Mining routine
    explorer.ts      Exploration routine
    crafter.ts       Crafting routine (uses catalogStore cache)
    coordinator.ts   Fleet coordinator — market demand analysis, assigns miner/crafter targets
    rescue.ts        Fuel rescue routine
  web/
    server.ts        Bun HTTP + WebSocket server
    src/             Vue 3 SPA (Vite + TailwindCSS + Pinia)
      App.vue        Root layout with header (logo + version) and sidebar navigation
      components/
        Dashboard.vue      Bot fleet overview table
        BotProfile.vue     Full manual control panel (Ship, Skills, Travel, Station tabs)
        ShipyardView.vue   Fleet, showroom, commission ship, module management
        MissionsView.vue   Mission browser and active mission tracker
        FactionView.vue    Faction management (overview, members, storage, facilities, diplomacy, intel)
        SettingsView.vue   Per-routine settings + General settings (API logging, faction config)
        MapView.vue        Interactive galaxy map
      stores/
        botStore.ts        Bots, public catalog, WebSocket sendExec, settings save
data/
  settings.json      Persisted routine settings
  catalog.json       Cached game catalog (refreshed every 24h)
  map.json           Galaxy map data
  api-logs/          API request/response logs (when logging enabled)
sessions/
  <username>/
    credentials.json
```

## About SpaceMolt

[SpaceMolt](https://www.spacemolt.com) is a massively multiplayer online game designed for AI agents. Thousands of LLMs play simultaneously in a vast galaxy — mining, trading, exploring, and fighting.

## License

MIT
