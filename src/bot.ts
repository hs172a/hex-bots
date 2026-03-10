import { SpaceMoltAPI, type ApiResponse, type GameNotification } from "./api.js";
import { SessionManager } from "./session.js";
import { mapStore, MapStore } from "./mapstore.js";
import { catalogStore, CatalogStore } from "./catalogstore.js";
import { sharedMarketCache } from "./shared-cache.js";
import { EventEmitter } from "events";
import { releaseAllClaims } from "./swarmcoord.js";

export type BotState = "idle" | "running" | "stopping" | "error";

export interface CargoItem {
  itemId: string;
  name: string;
  quantity: number;
  size?: number;
}

export interface ShipModule {
  id: string;
  type_id: string;
  name?: string;
  type?: string;
  slot_type?: string;
  size?: number;
  cpu_usage?: number;
  power_usage?: number;
  cpu_cost?: number;
  power_cost?: number;
  wear?: number;
  wear_status?: string;
  quality?: number;
  quality_grade?: string;
  // Combat
  damage?: number;
  damage_type?: string;
  ammo_type?: string;
  current_ammo?: number;
  loaded_ammo_id?: string;
  magazine_size?: number;
  range?: number;
  // Defense / hull
  armor_bonus?: number;
  hull_bonus?: number;
  shield_bonus?: number;
  speed_bonus?: number;
  cargo_bonus?: number;
  // Industrial
  mining_power?: number;
  mining_range?: number;
  harvest_power?: number;
  harvest_range?: number;
  scanner_power?: number;
  fuel_efficiency?: number;
  cloak_strength?: number;
}

export interface BotStats {
  // ── Existing ──
  totalMined: number;       // mining sessions
  totalCrafted: number;     // craft sessions
  totalTrades: number;      // trade runs completed
  totalProfit: number;      // net trade profit (cr)
  totalSystems: number;     // unique systems visited

  // ── Economic ──
  totalEarned: number;      // gross credits earned (trades + missions + loot)
  totalSpent: number;       // credits spent (purchases)
  totalDonated: number;     // credits donated to faction

  // ── Mining ──
  totalOreUnits: number;    // total ore/gas/ice units extracted

  // ── Combat ──
  totalKills: number;       // enemies destroyed
  totalDeaths: number;      // times ship destroyed
  totalLootValue: number;   // estimated value of combat loot

  // ── Production ──
  totalCraftUnits: number;  // total units produced (across craft sessions)

  // ── Navigation ──
  totalJumps: number;       // travel/jump actions taken

  // ── Missions ──
  totalMissions: number;    // missions completed
  totalMissionRewards: number; // credits from mission rewards

  // ── Market intel ──
  totalMarketsScanned: number; // number of view_market calls recorded
}

export interface PlayerStats {
  creditsEarned: number;
  creditsSpent: number;
  shipsDestroyed: number;
  shipsLost: number;
  piratesDestroyed: number;
  basesDestroyed: number;
  oreMined: number;
  itemsCrafted: number;
  tradesCompleted: number;
  systemsExplored: number;
  distanceTraveled: number;
  timePlayed: number;
}

export interface SkillEntry {
  skill_id: string;
  level: number;
  xp?: number;
  xp_to_next?: number;
  next_level_xp?: number;
}

export interface BotStatus {
  username: string;
  state: BotState;
  routine: string | null;
  credits: number;
  fuel: number;
  maxFuel: number;
  cargo: number;
  cargoMax: number;
  location: string;
  system: string;
  poi: string;
  docked: boolean;
  lastAction: string;
  error: string | null;
  shipName: string;
  shipId: string;
  shipClassId: string;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  shieldRecharge: number;
  armor: number;
  speed: number;
  ammo: number;
  cpuUsed: number;
  cpuCapacity: number;
  powerUsed: number;
  powerCapacity: number;
  weaponSlots: number;
  defenseSlots: number;
  utilitySlots: number;
  installedMods: string[];
  shipModules: ShipModule[];
  empire: string;
  homeBase: string;
  homeSystem: string;
  homePoI: string;
  factionId: string;
  factionRank: string;
  isCloaked: boolean;
  tradingRestrictedUntil: Date | null;
  empireRep: Record<string, unknown> | null;
  inventory: CargoItem[];
  storage: CargoItem[];
  factionStorage: CargoItem[];
  stats: BotStats;
  playerStats: PlayerStats;
  skills: SkillEntry[];
}

export interface RoutineContext {
  api: SpaceMoltAPI;
  bot: Bot;
  log: (category: string, message: string) => void;
  mapStore: MapStore;
  catalogStore: CatalogStore;
  /** Optional: get status of all bots in the fleet (used by rescue routine). */
  getFleetStatus?: () => BotStatus[];
  /** Optional: send a start/stop/exec action for any bot (used by ai_commander). */
  sendBotAction?: (action: { type: string; bot?: string; routine?: string; command?: string; params?: Record<string, unknown> }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Optional: get the latest economy snapshot (deficits/surpluses).
   * Provided by botmanager from EconomyEngine — available to crafter, trader, miner.
   */
  getEconomySnapshot?: () => { deficits: Array<{ itemId: string; shortfall: number; priority: string }>; surpluses: Array<{ itemId: string; excessPerHour: number }> } | null;
  /**
   * Optional: get recent episode outcomes from the training DB for experience replay.
   * Used by ai_commander to inject historical bot performance into the LLM prompt.
   */
  getRecentEpisodes?: (limit?: number) => Array<{
    botId: string;
    episodeType: string;
    profit: number;
    success: boolean;
    durationTicks: number;
    timestamp: number;
  }>;
}

/** A routine is an async generator that yields state names as it progresses. */
export type Routine = (ctx: RoutineContext) => AsyncGenerator<string, void, void>;

const BOT_COLORS = [
  "\x1b[96m", // bright cyan
  "\x1b[93m", // bright yellow
  "\x1b[92m", // bright green
  "\x1b[95m", // bright magenta
  "\x1b[94m", // bright blue
  "\x1b[91m", // bright red
];
const RESET = "\x1b[0m";

let colorIndex = 0;

export class Bot extends EventEmitter {
  readonly username: string;
  readonly api: SpaceMoltAPI;
  readonly session: SessionManager;
  private color: string;
  private _state: BotState = "idle";
  private _routine: string | null = null;
  private _lastAction = "";
  private _error: string | null = null;
  private _abortController: AbortController | null = null;

  _modules: Record<string, unknown> | undefined = undefined;
  _player: Record<string, unknown> | undefined = undefined;
  _ship: Record<string, unknown> | undefined = undefined;

  // Cached game state from last get_status
  credits = 0;
  fuel = 0;
  maxFuel = 0;
  cargo = 0;
  cargoMax = 0;
  location = "unknown";
  system = "unknown";
  poi = "";
  docked = false;
  shipName = "";
  shipId = "";
  shipClassId = "";
  hull = 0;
  maxHull = 0;
  shield = 0;
  maxShield = 0;
  shieldRecharge = 0;
  armor = 0;
  speed = 0;
  ammo = 0;
  cpuUsed = 0;
  cpuCapacity = 0;
  powerUsed = 0;
  powerCapacity = 0;
  weaponSlots = 0;
  defenseSlots = 0;
  utilitySlots = 0;
  empire = "";
  homeBase = "";
  homeSystem = "";
  homePoI = "";
  factionId = "";
  factionRank = "";

  /** True when this bot is a member of a faction and can use faction storage. */
  get inFaction(): boolean { return this.factionId !== ""; }

  /** Station IDs known to have items in storage (populated from not_docked error messages). */
  storageStations: Set<string> = new Set();

  /** Full module objects from last get_status. */
  shipModules: ShipModule[] = [];

  /** Cached inventory items from last get_cargo. */
  inventory: CargoItem[] = [];

  /** Cached station storage items from last view_storage. */
  storage: CargoItem[] = [];

  /** Cached faction storage items from last view_faction_storage. */
  factionStorage: CargoItem[] = [];

  /** Whether the bot's ship is currently cloaked. */
  isCloaked = false;

  /** ISO timestamp until which trading/gifting is restricted (null = unrestricted). */
  tradingRestrictedUntil: Date | null = null;

  /** Empire reputation data from last get_status call. */
  empireRep: Record<string, unknown> | null = null;

  /** Whether the bot's ship is dead (hull <= 0). */
  isDead = false;

  /**
   * Optional hook called for every notification received from the server.
   * Routines can set this to react to in-progress events (e.g., combat, trade offers).
   * Called with (type, data) where type is e.g. "combat", "trade", "system".
   */
  onNotification: ((type: string, data: Record<string, unknown>) => void) | null = null;

  /**
   * When true, the bot will automatically take a defensive brace/retreat stance
   * upon receiving an unexpected combat notification while running any routine.
   * Set by hunter.ts (and any other combat-aware routine) based on its autoDefend setting.
   */
  autoDefend = false;

  /**
   * When true, the bot will automatically call attack + set fire stance when hit by a pirate.
   * Requires the bot NOT to be docked. Cooldown prevents spamming every damage tick.
   */
  autoFightBack = false;
  private _lastFightBackMs = 0;
  private static readonly FIGHT_BACK_COOLDOWN_MS = 12_000;
  private _lastEmergencyUndockMs = 0;
  private static readonly EMERGENCY_UNDOCK_COOLDOWN_MS = 30_000;

  /** Set true while a jump command is in-flight. Prevents fight-back on notifications
   * from the previous system that arrive inside the jump response. */
  isJumping = false;

  /** Cached installed mod IDs from last refreshShipMods(). */
  installedMods: string[] = [];

  /** Accumulated session stats for this bot (runtime tracking). */
  stats: BotStats = {
    totalMined: 0, totalCrafted: 0, totalTrades: 0, totalProfit: 0, totalSystems: 0,
    totalEarned: 0, totalSpent: 0, totalDonated: 0,
    totalOreUnits: 0,
    totalKills: 0, totalDeaths: 0, totalLootValue: 0,
    totalCraftUnits: 0,
    totalJumps: 0,
    totalMissions: 0, totalMissionRewards: 0,
    totalMarketsScanned: 0,
  };

  /** Server-side player stats from last get_status. */
  playerStats: PlayerStats = {
    creditsEarned: 0, creditsSpent: 0, shipsDestroyed: 0, shipsLost: 0,
    piratesDestroyed: 0, basesDestroyed: 0, oreMined: 0, itemsCrafted: 0,
    tradesCompleted: 0, systemsExplored: 0, distanceTraveled: 0, timePlayed: 0,
  };

  /** Player skills from last get_status. */
  skills: SkillEntry[] = [];

  // Action log (last N entries)
  readonly actionLog: string[] = [];
  private maxLogEntries = 200;

  /** Cached skill levels for detecting level-ups. */
  private skillLevels: Map<string, number> = new Map();

  /** Timestamp of the last faction combat alert (ms). Rate-limits chat spam. */
  private lastCombatAlertMs = 0;
  private static readonly COMBAT_ALERT_COOLDOWN_MS = 30_000;

  /** Timestamp of the last combat warning alert (separate from hull-damage alerts). */
  private lastWarningAlertMs = 0;
  private static readonly WARNING_ALERT_COOLDOWN_MS = 60_000;

  /** Timestamp of the last rate limit log message (ms). Rate-limits log spam. */
  private lastRateLimitLogMs = 0;
  private static readonly RATE_LIMIT_LOG_COOLDOWN_MS = 15_000;

  /** Mutex: prevents concurrent bot.login() calls from each resetting the session
   *  and spawning redundant auth sequences. */
  private _loginLock: Promise<boolean> | null = null;

  constructor(username: string, baseDir: string) {
    super();
    this.username = username;
    this.api = new SpaceMoltAPI();
    this.api.label = username;
    this.session = new SessionManager(username, baseDir);
    this.color = BOT_COLORS[colorIndex % BOT_COLORS.length];
    colorIndex++;
  }

  get state(): BotState {
    return this._state;
  }

  set state(newState: BotState) {
    if (this._state !== newState) {
      this._state = newState;
      this.emit("stateChange", this.username, newState);
    }
  }

  get routineName(): string | null {
    return this._routine;
  }

  log(category: string, message: string): void {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const line = `${timestamp} [${category}] ${message}`;
    this.actionLog.push(line);
    if (this.actionLog.length > this.maxLogEntries) {
      this.actionLog.shift();
    }
    
    this.emit("log", this.username, category, message);
    console.log(
      `\x1b[2m${timestamp}${RESET} ${this.color}[${this.username}]${RESET} ` +
        `${getCategoryColor(category)}[${category}]${RESET} ${message}`
    );
  }

  /** Execute an API command, log the result, handle notifications. */
  async exec(command: string, payload?: Record<string, unknown>): Promise<ApiResponse> {
    // Fast-fail all routine API calls when a stop has been requested.
    // This causes any nested await chain (navigateToSystem, ensureFueled, etc.)
    // to unwind within milliseconds instead of waiting minutes for long operations.
    if (this._state === "stopping") {
      return { error: { code: "stopped", message: "Bot is stopping" } } as ApiResponse;
    }
    this._lastAction = command;

    // Fleet-wide shared market cache (L1) — avoid redundant API calls when multiple
    // bots are docked at the same POI. Per-bot cache in api.ts acts as L2.
    if (command === "view_market" && this.poi) {
      const cached = sharedMarketCache.get(this.poi);
      if (cached) return cached;
    }

    let resp = await this.api.execute(command, payload);

    // ── Post-flight abort check ──────────────────────────────────────────────
    // The API call above may take 10-30 seconds (jump, undock, etc.). If the bot
    // was force-stopped while it was in-flight, the routine must NOT continue to
    // process the result — return "stopped" so every subsequent exec() fast-fails
    // and the routine unwinds through normal error handling.
    if ((this._state as BotState) === "stopping") {
      return { error: { code: "stopped", message: "Bot is stopping" } } as ApiResponse;
    }

    // Populate shared market cache on success; invalidate on buy/sell mutations.
    if (command === "view_market" && this.poi && !resp.error) {
      sharedMarketCache.set(this.poi, resp);
    } else if ((command === "sell" || command === "buy" ||
                command === "create_sell_order" || command === "create_buy_order" ||
                command === "cancel_order") && this.poi && !resp.error) {
      sharedMarketCache.invalidate(this.poi);
    }

    // v2 PendingActionResponse — action queued for next game tick.
    // Wait for the tick then poll get_queue until the action resolves.
    if (resp.pending === true) {
      await sleep(10_000);
      for (let p = 0; p < 6; p++) {
        const qResp = await this.api.execute("v2_get_queue");
        const queue = qResp.result as Record<string, unknown> | undefined;
        const queued = Array.isArray(queue?.queue) ? queue!.queue as Array<Record<string, unknown>> : [];
        const stillPending = queued.some((a: Record<string, unknown>) => a.command === command);
        if (!stillPending) {
          resp = await this.api.execute(command, payload);
          break;
        }
        await sleep(5_000);
      }
    }

    // Action pending — a previous game action is still resolving (10s tick).
    // Wait for the tick to complete then retry once.
    if (resp.error) {
      const msg = resp.error.message || "";
      if (resp.error.code === "action_pending" || msg.includes("action is already pending")) {
        await sleep(10_000);
        resp = await this.api.execute(command, payload);
      }

      // Transient server errors (504, 503, 500) — the server may still be processing the action.
      // Wait 15s to let any server-side operation complete before retrying.
      const transientCodes = ["gateway_timeout", "service_unavailable", "internal_server_error"];
      if (resp.error && transientCodes.includes(resp.error.code ?? "")) {
        await sleep(15_000);
        resp = await this.api.execute(command, payload);
      }

      // "Another action is already in progress" — server is still processing a previous request.
      // Wait and retry up to 4 times with increasing delays (5s, 10s, 15s, 20s).
      if (resp.error) {
        const isActionBusy =
          resp.error.code === "action_in_progress" ||
          resp.error.message?.toLowerCase().includes("action is already in progress");
        if (isActionBusy) {
          for (let attempt = 1; attempt <= 4; attempt++) {
            await sleep(5000 * attempt);
            resp = await this.api.execute(command, payload);
            if (!resp.error || !(
              resp.error.code === "action_in_progress" ||
              resp.error.message?.toLowerCase().includes("action is already in progress")
            )) break;
          }
        }
      }

      // Rate limit — exponential backoff retry (max 3 attempts)
      if (resp.error && resp.error.code === "rate_limit") {
        const MAX_RETRIES = 3;
        const now = Date.now();
        const shouldLog = now - this.lastRateLimitLogMs > Bot.RATE_LIMIT_LOG_COOLDOWN_MS;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          const delay = 5000 * Math.pow(2, attempt - 1); // 5s, 10s, 20s

          // Only log first retry or if cooldown expired
          if (attempt === 1 && shouldLog) {
            // this.log("system", `Rate limited, retrying in ${delay/1000}s... (${attempt}/${MAX_RETRIES})`);
            this.lastRateLimitLogMs = now;
          }

          await sleep(delay);
          resp = await this.api.execute(command, payload);
          if (!resp.error || resp.error.code !== "rate_limit") break;
        }
      }
    }

    if (resp.notifications && Array.isArray(resp.notifications) && resp.notifications.length > 0) {
      this.emit("notifications", resp.notifications, this.username);
      await this.handleNotifications(resp.notifications);
    }

    if (resp.error) {
      // Ensure message is always a non-empty string — prevents .toLowerCase() crashes in routines
      if (!resp.error.message) {
        resp.error.message = resp.error.code || "Unknown error";
      }
      // Suppress noisy expected errors — callers handle these gracefully
      const code = resp.error.code || "";
      const quiet =
        code === "stopped" || // routine is stopping — not an unexpected error
        code === "mission_incomplete" ||
        (command === "view_faction_storage" && code !== "session_invalid") ||
        (command === "get_missions" && code !== "session_invalid") ||
        (command === "complete_mission" && code === "mission_incomplete") ||
        (command === "get_insurance_quote" && code !== "session_invalid") ||
        (command === "survey_system" && code === "no_scanner") ||
        (command === "faction_deposit_items" && code === "no_faction_storage") ||
        (command === "faction_deposit_credits" && code === "no_faction_storage") ||
        (command === "withdraw_items" && code === "cargo_full") ||
        (command === "faction_withdraw_items" && code === "cargo_full") ||
        (command === "faction_submit_trade_intel" && code === "no_trade_ledger") ||
        (command === "faction_submit_intel" && code === "no_trade_ledger") ||
        (command === "cloak" && code === "no_cloak");
      if (!quiet) {
        this.log("error", `${command}: ${resp.error.message}`);
      }
    }

    return resp;
  }

  /** Login using stored credentials. Returns true on success. */
  async login(): Promise<boolean> {
    // Serialize concurrent calls — if a login is already in progress, wait for it.
    if (this._loginLock) {
      return this._loginLock;
    }
    this._loginLock = this._doLogin().finally(() => { this._loginLock = null; });
    return this._loginLock;
  }

  private async _doLogin(): Promise<boolean> {
    const creds = this.session.loadCredentials();
    if (!creds) {
      this._error = "No credentials found";
      this._state = "error";
      return false;
    }

    this.api.setCredentials(creds.username, creds.password);

    // Wire up session persistence: save to disk after every new session creation
    this.api.setSessionSavedCallback((s) => this.session.saveSession(s));

    // ── Attempt to resume a previously saved session (avoids full login on restart) ──
    const saved = this.session.loadSession();
    if (saved) {
      this.api.setSession(saved);
      this.log("system", `Resuming session ${saved.id.slice(0, 8)}...`);
      const resumeResp = await this.refreshStatus();
      if (!resumeResp.error) {
        this.log("system", "Session resumed — no login required");
        return true;
      }
      // Session rejected by server (expired/invalidated) — fall through to full login
      this.log("system", `Session ${saved.id.slice(0, 8)} rejected (${resumeResp.error?.code ?? "unknown"}), logging in fresh...`);
    }

    // ── Full login: create new session + authenticate ──
    // Clear any stale session so ensureSession() creates a fresh one and
    // re-authenticates internally via doRequest("login") with stored credentials.
    // This avoids a double-login: one inside ensureSession() + one from exec("login").
    this.api.resetSession();
    this.log("system", `Logging in as ${creds.username}...`);

    const resp = await this.refreshStatus();

    if (resp.error) {
      this._error = `Login failed: ${resp.error.message}`;
      this._state = "error";
      return false;
    }

    this.log("system", "Login successful");
    return true;
  }

  /** Fetch current game state and cache it. */
  async refreshStatus(): Promise<ApiResponse> {
    const resp = await this.exec("get_status");
    if (resp.result && typeof resp.result === "object") {
      const r = resp.result as Record<string, unknown>;

      this._modules = r.modules as Record<string, unknown> | undefined;
      this._player = r.player as Record<string, unknown> | undefined;
      this._ship = r.ship as Record<string, unknown> | undefined;

      // Player data may be nested under r.player or flat at top level
      const player = r.player as Record<string, unknown> | undefined;
      const p = player || r;

      // Parse server-side player stats
      const apiStats = (p.stats || r.stats) as Record<string, number> | undefined;
      if (apiStats && typeof apiStats === "object") {
        this.playerStats = {
          creditsEarned: apiStats.credits_earned ?? 0,
          creditsSpent: apiStats.credits_spent ?? 0,
          shipsDestroyed: apiStats.ships_destroyed ?? 0,
          shipsLost: apiStats.ships_lost ?? 0,
          piratesDestroyed: apiStats.pirates_destroyed ?? 0,
          basesDestroyed: apiStats.bases_destroyed ?? 0,
          oreMined: apiStats.ore_mined ?? 0,
          itemsCrafted: apiStats.items_crafted ?? 0,
          tradesCompleted: apiStats.trades_completed ?? 0,
          systemsExplored: apiStats.systems_explored ?? 0,
          distanceTraveled: apiStats.distance_traveled ?? 0,
          timePlayed: apiStats.time_played ?? 0,
        };
      }

      // Parse player skills (Record<string, number> → SkillEntry[])
      const apiSkills = (p.skills || r.skills) as Record<string, unknown> | unknown[] | undefined;
      if (apiSkills && typeof apiSkills === "object" && !Array.isArray(apiSkills)) {
        this.skills = Object.entries(apiSkills as Record<string, unknown>).map(([skill_id, val]) => ({
          skill_id,
          level: typeof val === "number" ? val : (typeof val === "object" && val !== null ? (val as any).level ?? 0 : 0),
        }));
      } else if (Array.isArray(apiSkills)) {
        this.skills = (apiSkills as any[]).map((s: any) => ({
          skill_id: s.skill_id || s.id || s.name || "",
          level: s.level ?? 0,
        }));
      }

      this.credits = (p.credits as number) ?? this.credits;
      this.system = (p.current_system as string) ?? this.system;
      this.poi = (p.current_poi as string) ?? (p.poi_id as string) ?? this.poi;
      this.docked = p.docked_at_base != null
        ? !!(p.docked_at_base)
        : (p.docked as boolean) ?? (p.status === "docked");
      this.location =
        (p.current_system as string) ||
        (p.location as string) ||
        this.location;

      // Player identity fields
      if (typeof p.empire === "string") this.empire = p.empire;
      if (typeof p.home_base === "string") this.homeBase = p.home_base;
      if (typeof p.home_system === "string") this.homeSystem = p.home_system;
      if (typeof p.home_poi === "string") this.homePoI = p.home_poi;
      if (typeof p.faction_id === "string") this.factionId = p.faction_id;
      if (typeof p.faction_rank === "string") this.factionRank = p.faction_rank;

      // Ship fields
      const ship = r.ship as Record<string, unknown> | undefined;
      if (ship) {
        const rawName = (ship.name as string) || "";
        const shipType = (ship.ship_type as string) || (ship.type as string) || "";
        this.shipName = (rawName && rawName.toLowerCase() !== "unnamed" ? rawName : shipType) || this.shipName;
        if (typeof ship.id === "string") this.shipId = ship.id;
        if (typeof ship.class_id === "string") this.shipClassId = ship.class_id;
        this.fuel = (ship.fuel as number) ?? this.fuel;
        this.maxFuel = (ship.max_fuel as number) ?? this.maxFuel;
        this.cargo = (ship.cargo_used as number) ?? this.cargo;
        this.cargoMax = (ship.cargo_capacity as number) ?? (ship.max_cargo as number) ?? this.cargoMax;
        this.hull = (ship.hull as number) ?? (ship.hp as number) ?? this.hull;
        this.maxHull = (ship.max_hull as number) ?? (ship.max_hp as number) ?? this.maxHull;
        this.shield = (ship.shield as number) ?? (ship.shields as number) ?? this.shield;
        this.maxShield = (ship.max_shield as number) ?? (ship.max_shields as number) ?? this.maxShield;
        if (typeof ship.shield_recharge === "number") this.shieldRecharge = ship.shield_recharge;
        if (typeof ship.armor === "number") this.armor = ship.armor;
        if (typeof ship.speed === "number") this.speed = ship.speed;
        this.ammo = (ship.ammo as number) ?? this.ammo;
        if (typeof ship.cpu_used === "number") this.cpuUsed = ship.cpu_used;
        if (typeof ship.cpu_capacity === "number") this.cpuCapacity = ship.cpu_capacity;
        if (typeof ship.power_used === "number") this.powerUsed = ship.power_used;
        if (typeof ship.power_capacity === "number") this.powerCapacity = ship.power_capacity;
        if (typeof ship.weapon_slots === "number") this.weaponSlots = ship.weapon_slots;
        if (typeof ship.defense_slots === "number") this.defenseSlots = ship.defense_slots;
        if (typeof ship.utility_slots === "number") this.utilitySlots = ship.utility_slots;
        // Populate installedMods directly from get_status (avoids a separate get_ship call)
        if (Array.isArray(ship.modules)) {
          this.installedMods = (ship.modules as Array<string | Record<string, unknown>>)
            .map(m => (typeof m === "string" ? m : (m.id as string) || ""))
            .filter(Boolean);
        }
      }

      // Full module details — captures all stat fields now correctly populated by the API
      if (Array.isArray(r.modules)) {
        this.shipModules = (r.modules as Array<Record<string, unknown>>).map(m => ({
          id: (m.id as string) || "",
          type_id: (m.type_id as string) || "",
          name: m.name as string | undefined,
          slot_type: m.slot_type as string | undefined,
          type: (m.type as string) || (m.slot_type as string) || "",
          cpu_usage: m.cpu_usage as number | undefined,
          power_usage: m.power_usage as number | undefined,
          cpu_cost: m.cpu_cost as number | undefined,
          power_cost: m.power_cost as number | undefined,
          wear: m.wear as number | undefined,
          wear_status: m.wear_status as string | undefined,
          quality: m.quality as number | undefined,
          quality_grade: m.quality_grade as string | undefined,
          // Combat
          damage: m.damage as number | undefined,
          damage_type: m.damage_type as string | undefined,
          ammo_type: m.ammo_type as string | undefined,
          current_ammo: m.current_ammo as number | undefined,
          loaded_ammo_id: m.loaded_ammo_id as string | undefined,
          magazine_size: m.magazine_size as number | undefined,
          range: m.range as number | undefined,
          // Defense / hull (now correctly populated)
          armor_bonus: m.armor_bonus as number | undefined,
          hull_bonus: m.hull_bonus as number | undefined,
          shield_bonus: m.shield_bonus as number | undefined,
          speed_bonus: m.speed_bonus as number | undefined,
          cargo_bonus: m.cargo_bonus as number | undefined,
          // Industrial
          mining_power: m.mining_power as number | undefined,
          mining_range: m.mining_range as number | undefined,
          harvest_power: m.harvest_power as number | undefined,
          harvest_range: m.harvest_range as number | undefined,
          scanner_power: m.scanner_power as number | undefined,
          fuel_efficiency: m.fuel_efficiency as number | undefined,
          cloak_strength: m.cloak_strength as number | undefined,
        }));

        // Compute loaded ammo from weapon modules (ship object has no ammo field)
        const weaponModsWithAmmo = this.shipModules.filter(m => m.ammo_type);
        if (weaponModsWithAmmo.length > 0) {
          this.ammo = weaponModsWithAmmo.reduce((sum, m) => sum + (m.current_ammo ?? 0), 0);
        } else if (this.shipModules.length > 0) {
          this.ammo = -1; // no ammo-using weapons fitted — skip ammo checks
        }
      }

      // Cloak detection
      this.isCloaked = !!(p.is_cloaked || p.cloaked);

      // Empire reputation
      const rawRep = p.empire_rep ?? p.empire_reputations;
      if (rawRep && typeof rawRep === "object" && !Array.isArray(rawRep)) {
        this.empireRep = rawRep as Record<string, unknown>;
      }

      // Trading/gifting restriction (added in API update)
      const rawRestriction = p.trading_restricted_until as string | null | undefined;
      if (rawRestriction) {
        const d = new Date(rawRestriction);
        this.tradingRestrictedUntil = isNaN(d.getTime()) ? null : d;
      } else {
        this.tradingRestrictedUntil = null;
      }

      // Death detection
      if (this.hull <= 0 && this.maxHull > 0) {
        this.isDead = true;
      } else if (this.hull > 0 && this.isDead) {
        this.isDead = false; // respawned
      }

      // Fallback: fuel at top level
      if (typeof r.fuel === "number") this.fuel = r.fuel;
    }

    // Also refresh cargo inventory (and storage only if docked)
    await this.refreshCargo();
    if (this.docked) {
      await this.refreshStorage();
    }

    return resp;
  }

  /** Parse an item list from API response, handling both item_id and resource_id formats. */
  private parseItemList(result: unknown): CargoItem[] {
    if (!result || typeof result !== "object") return [];

    const r = result as Record<string, unknown>;
    const items = (
      Array.isArray(r) ? r :
      Array.isArray(r.items) ? r.items :
      Array.isArray(r.cargo) ? r.cargo :
      Array.isArray(r.storage) ? r.storage :
      []
    ) as Array<Record<string, unknown>>;

    return items
      .map((item) => ({
        itemId: (item.item_id as string) || (item.resource_id as string) || (item.id as string) || "",
        name: (item.name as string) || (item.item_name as string) || (item.resource_name as string) || (item.item_id as string) || "",
        quantity: (item.quantity as number) || (item.count as number) || 0,
        size: typeof item.size === "number" ? item.size : undefined,
      }))
      .filter((i) => i.itemId && i.quantity > 0);
  }

  /** Fetch cargo contents and cache them. */
  async refreshCargo(): Promise<void> {
    const resp = await this.exec("get_cargo");
    // Always update inventory — even if response is empty/null, clear stale data
    this.inventory = this.parseItemList(resp.result);
  }

  /** Fetch station storage contents and cache them. Pass station_id to check remotely. */
  async refreshStorage(stationId?: string): Promise<void> {
    const resp = await this.exec("view_storage", stationId ? { station_id: stationId } : undefined);
    this.storage = this.parseItemList(resp.result);
  }

  /**
   * Call view_storage and return the full response (including hint field).
   * Pass station_id to query a specific station remotely.
   */
  async viewStorage(stationId?: string): Promise<Record<string, unknown>> {
    const resp = await this.exec("view_storage", stationId ? { station_id: stationId } : undefined);
    if (resp.error || !resp.result || typeof resp.result !== "object") return {};
    return resp.result as Record<string, unknown>;
  }

  /**
   * Call view_orders with optional station_id and scope for remote order checking.
   * scope='faction' returns faction orders (v0.191.0: separated from personal orders).
   */
  async viewOrders(stationId?: string, scope?: 'personal' | 'faction'): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (stationId) params.station_id = stationId;
    if (scope) params.scope = scope;
    const resp = await this.exec("view_orders", Object.keys(params).length ? params : undefined);
    if (resp.error || !resp.result || typeof resp.result !== "object") return {};
    return resp.result as Record<string, unknown>;
  }

  /**
   * Called after a successful view_faction_storage response.
   * Set by botmanager to persist the snapshot to the faction storage DB.
   */
  onFactionStorageViewed?: (rawItems: unknown[], poiId: string, systemId: string) => void;

  /** Fetch faction storage contents and cache them. Silently returns empty on error. */
  async refreshFactionStorage(): Promise<void> {
    const resp = await this.exec("view_faction_storage");
    if (resp.error) {
      this.factionStorage = [];
      return;
    }
    this.factionStorage = this.parseItemList(resp.result);
    // Notify DB hook so routine-triggered refreshes also persist the snapshot
    if (this.onFactionStorageViewed && this.poi) {
      const raw: unknown[] = Array.isArray(resp.result)
        ? (resp.result as unknown[])
        : ((resp.result as any)?.items ?? (resp.result as any)?.storage ?? []);
      this.onFactionStorageViewed(raw, this.poi, this.system ?? "");
    }
  }

  /** Start running a routine. */
  async start(
    routineName: string,
    routine: Routine,
    opts?: {
      getFleetStatus?: () => BotStatus[];
      sendBotAction?: RoutineContext["sendBotAction"];
      getEconomySnapshot?: RoutineContext["getEconomySnapshot"];
      getRecentEpisodes?: RoutineContext["getRecentEpisodes"];
    },
  ): Promise<void> {
    if (this._state === "running" || this._state === "stopping") {
      this.log("error", "Bot is already running or stopping");
      return;
    }

    this.state = "running";
    this._routine = routineName;
    this._error = null;
    this._abortController = new AbortController();

    // Only login if we don't already have an active session
    if (!this.api.getSession()) {
      const loggedIn = await this.login();
      if (!loggedIn) {
        // login() already set _state = "error" and _error; throw so the caller's
        // .catch() handler fires instead of .then() (which would log "routine finished").
        throw new Error(this._error || "Login failed");
      }
    }

    this.log("system", `Starting routine: ${routineName}`);

    const ctx: RoutineContext = {
      api: this.api,
      bot: this,
      log: (cat, msg) => this.log(cat, msg),
      mapStore,
      catalogStore,
      getFleetStatus: opts?.getFleetStatus,
      sendBotAction: opts?.sendBotAction,
      getEconomySnapshot: opts?.getEconomySnapshot,
      getRecentEpisodes: opts?.getRecentEpisodes,
    };

    try {
      for await (const stateName of routine(ctx)) {
        if ((this._state as BotState) !== "running") {
          this.log("system", `Stopped during state: ${stateName}`);
          break;
        }
        // Small gap between actions
        await sleep(2000, this._abortController?.signal);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;
      this.log("error", `Routine error: ${msg}`);
      this._state = "error";
      // Write full stack trace to stderr for post-mortem analysis
      if (err instanceof Error && err.stack) {
        process.stderr.write(`[${this.username}] Routine crash:\n${err.stack}\n`);
      }
      this.emit("routineError", this.username, msg, err);
      // Re-throw so the caller's .catch() handler fires, ensuring the bot
      // assignment is cleared and "stopped with error" is logged rather than "finished".
      throw err;
    }

    releaseAllClaims(this.username);
    this.state = "idle";
    this._routine = null;
    this.log("system", "Routine finished");
  }

  /** Fetch ship modules and cache installed mod IDs. */
  async refreshShipMods(): Promise<string[]> {
    const resp = await this.exec("get_ship");
    if (resp.result && typeof resp.result === "object") {
      const r = resp.result as Record<string, unknown>;
      const ship = (r.ship as Record<string, unknown>) || r;
      const modules = (
        Array.isArray(ship.modules) ? ship.modules :
        Array.isArray(ship.mods) ? ship.mods :
        Array.isArray(ship.installed_mods) ? ship.installed_mods :
        []
      ) as Array<Record<string, unknown> | string>;

      this.installedMods = modules.map(m => {
        if (typeof m === "string") return m;
        return (m.mod_id as string) || (m.id as string) || (m.name as string) || "";
      }).filter(Boolean);
    }
    return this.installedMods;
  }

  /** Get the current cached level for a skill. Returns 0 if unknown. Call checkSkills() first to populate. */
  getSkillLevel(skillId: string): number {
    const fromMap = this.skillLevels.get(skillId);
    if (fromMap !== undefined) return fromMap;
    // Fallback: skills array populated by refreshStatus() from get_status
    const fromArray = this.skills.find(s => s.skill_id === skillId);
    return fromArray?.level ?? 0;
  }

  /** Fetch skills and log any level-ups since the last check. */
  async checkSkills(): Promise<void> {
    const resp = await this.exec("get_skills");
    if (!resp.result || typeof resp.result !== "object") return;

    const r = resp.result as Record<string, unknown>;

    // Build a unified list from various API shapes:
    //   1. Array at top level: [{ skill_id, name, level }, ...]
    //   2. Array nested under .skills: { skills: [...] }
    //   3. Dict keyed by skill_id: { basic_crafting: { level: 7, name: "..." }, ... }
    //   4. Dict keyed by skill_id with numeric values: { basic_crafting: 7, ... }
    const entries: Array<{ id: string; name: string; level: number }> = [];

    const rawArray: unknown[] = Array.isArray(r) ? r : Array.isArray(r.skills) ? r.skills as unknown[] : [];

    if (rawArray.length > 0) {
      for (const skill of rawArray as Array<Record<string, unknown>>) {
        const id = (skill.skill_id as string) || (skill.id as string) || (skill.name as string) || "";
        const name = (skill.name as string) || id;
        const level = (skill.level as number) ?? 0;
        if (id) entries.push({ id, name, level });
      }
    } else {
      // Dict format — when API wraps skills under a "skills" key (e.g. { skills: { basic_crafting: { level: 5 } }, message: "..." })
      // use that nested dict directly instead of iterating top-level keys.
      const dictSource = (r.skills && typeof r.skills === "object" && !Array.isArray(r.skills))
        ? r.skills as Record<string, unknown>
        : r;
      for (const [key, val] of Object.entries(dictSource)) {
        if (key === "message" || key === "hint") continue;
        if (typeof val === "number") {
          entries.push({ id: key, name: key, level: val });
        } else if (val && typeof val === "object") {
          const s = val as Record<string, unknown>;
          const level = (s.level as number) ?? (s.current_level as number) ?? 0;
          const name = (s.name as string) || key;
          entries.push({ id: key, name, level });
        }
      }
    }

    for (const { id, name, level } of entries) {
      const prev = this.skillLevels.get(id);
      if (prev !== undefined && level > prev) {
        this.log("skill", `LEVEL UP! ${name}: ${prev} -> ${level}`);
      }
      this.skillLevels.set(id, level);
    }
  }

  /**
   * Route notifications to the bot's own activity log and detect hull damage.
   * Uses this.api.execute() directly (not this.exec()) to avoid recursion.
   */
  private async handleNotifications(notifications: GameNotification[]): Promise<void> {
    for (const n of notifications) {
      if (typeof n !== "object" || !n) {
        if (typeof n === "string") this.log("info", `[NOTIFY] ${n}`);
        continue;
      }

      const notif = n as Record<string, unknown>;
      const type = notif.type as string | undefined;
      const msgType = notif.msg_type as string | undefined;

      // Chat messages are already displayed via notifications event — skip
      if (msgType === "chat_message") continue;

      let data = notif.data as Record<string, unknown> | string | undefined;
      if (typeof data === "string") {
        try { data = JSON.parse(data) as Record<string, unknown>; } catch { /* leave as string */ }
      }

      if (type === "system" && data && typeof data === "object") {
        const d = data as Record<string, unknown>;

        if (d.damage !== undefined) {
          const pirateName = (d.pirate_name as string) || "Unknown";
          const pirateT    = (d.pirate_tier as string) || "";
          const damage     = (d.damage as number) ?? 0;
          const damageType = (d.damage_type as string) || "";
          const yourHull   = d.your_hull as number | undefined;
          const maxHull    = d.your_max_hull as number | undefined;
          const yourShield = d.your_shield as number | undefined;

          const hullStr   = yourHull !== undefined && maxHull !== undefined
            ? ` | Hull: ${yourHull}/${maxHull} (${maxHull > 0 ? Math.round((yourHull / maxHull) * 100) : 100}%)`
            : "";
          const shieldStr = yourShield !== undefined ? ` | Shield: ${yourShield}` : "";

          this.log("combat",
            `UNDER ATTACK! ${pirateName}${pirateT ? ` (${pirateT})` : ""} dealt ${damage} ${damageType} dmg${hullStr}${shieldStr}`
          );

          // Combat chat alerts disabled — was spamming faction chat
          // const now = Date.now();
          // if (now - this.lastCombatAlertMs > Bot.COMBAT_ALERT_COOLDOWN_MS) {
          //   this.lastCombatAlertMs = now;
          //   await this.sendCombatFactionAlert(
          //     pirateName, pirateT, damage, damageType,
          //     yourHull ?? this.hull, maxHull ?? this.maxHull, yourShield,
          //   );
          // }

          if (yourHull !== undefined) this.hull = yourHull;
          if (yourShield !== undefined) this.shield = yourShield;

          // Record pirate sighting for map intelligence
          if (this.system) {
            mapStore.recordPirate(this.system, { player_id: pirateName, name: pirateName });
          }

          // Auto-fight-back: engage and return fire when attacked by a pirate.
          // Skip if jumping — notifications from jump responses reference the previous system.
          if (this.autoFightBack && this.state === "running" && !this.isJumping) {
            const now = Date.now();

            if (this.docked) {
              // Emergency undock: can't fight from dock — undock to enable fight-back or flee
              if (now - this._lastEmergencyUndockMs > Bot.EMERGENCY_UNDOCK_COOLDOWN_MS) {
                this._lastEmergencyUndockMs = now;
                this.log("combat", `[EMERGENCY] Under attack while docked — undocking to escape`);
                this.api.execute("undock")
                  .then(() => { this.docked = false; })
                  .catch(() => {});
              }
            } else {
              // Undocked: fight back or flee based on hull
              if (now - this._lastFightBackMs > Bot.FIGHT_BACK_COOLDOWN_MS) {
                this._lastFightBackMs = now;
                const hullPct = this.maxHull > 0 ? (this.hull / this.maxHull) * 100 : 100;
                const attackerId = (d.attacker_id as string) || (d.pirate_id as string) || pirateName;

                if (hullPct < 20) {
                  // Hull critical — flee rather than fight
                  this.log("combat", `[AUTO-FLEE] Hull critical (${Math.round(hullPct)}%) — fleeing`);
                  this.api.execute("battle", { action: "stance", id: "flee" }).catch(() => {});
                } else if (attackerId && attackerId !== "Unknown") {
                  const attackSystem = this.system;
                  this.log("combat", `[AUTO-FIGHT] Engaging ${attackerId} in ${attackSystem}`);
                  // Sequential: attack first, then set stance only after attack lands
                  this.api.execute("attack", { target_id: attackerId, id: attackerId })
                    .then(res => {
                      if (res.error) return;
                      if (this.system !== attackSystem || this.docked || this.isJumping) return;
                      return this.api.execute("battle", { action: "stance", id: "fire" });
                    })
                    .catch(() => {});
                }
              }
            }
          }

        } else {
          const message = (d.message as string) || "";
          if (message) {
            const msgLower = message.toLowerCase();
            const isCombatWarning =
              msgLower.includes("attack") ||
              msgLower.includes("detected you") ||
              msgLower.includes("hostile");
            this.log(isCombatWarning ? "combat" : "info", `[SYSTEM] ${message}`);
            // Combat warning chat alerts disabled — was spamming faction chat
            // if (isCombatWarning) {
            //   const now = Date.now();
            //   if (now - this.lastWarningAlertMs > Bot.WARNING_ALERT_COOLDOWN_MS) {
            //     this.lastWarningAlertMs = now;
            //     await this.sendWarningFactionAlert(message);
            //   }
            // }
          }
        }

      } else if (type === "combat" && data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        const message = (d.message as string) || "";
        if (message) this.log("combat", `[COMBAT] ${message}`);
        this.onNotification?.("combat", d);

        // Phase 2.3: Auto-defend — brace when hit unexpectedly while any routine is running
        if (this.autoDefend && this.state === "running") {
          const hullPct = this.maxHull > 0 ? (this.hull / this.maxHull) * 100 : 100;
          const defStance = hullPct < 25 ? "flee" : "brace";
          this.api.execute("battle", { action: "stance", id: defStance }).catch(() => {});
          this.log("combat", `[AUTO-DEFEND] Unexpected combat — auto-stance: ${defStance}`);
        }

      } else if (type === "trade" && data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        const tradeId = (d.trade_id as string) || "";
        const from = (d.from_username as string) || (d.from as string) || "?";
        const items = Array.isArray(d.offered_items) ? (d.offered_items as Array<Record<string, unknown>>) : [];
        const credits = (d.offered_credits as number) ?? 0;
        const itemSummary = items.map(i => `${i.quantity ?? 1}x ${i.item_id ?? i.name ?? "?"}`).join(", ");
        const summary = [itemSummary, credits > 0 ? `${credits}cr` : ""].filter(Boolean).join(" + ");
        this.log("trade", `[TRADE OFFER] ${from} offers: ${summary || "(nothing)"} (id: ${tradeId})`);
        this.onNotification?.("trade", d);

      } else if (type === "system" && data && typeof data === "object") {
        this.onNotification?.("system", data as Record<string, unknown>);
      }
    }
  }

  /**
   * Refresh bot state using v2 get_state (single combined call).
   * Falls back to refreshStatus() if get_state is unavailable or errors.
   * TODO Phase 0.3: extract _parseStateResult() to parse get_state response directly
   * without the fallback refreshStatus() call once the v2 get_state shape is confirmed.
   */
  async refreshState(): Promise<ApiResponse> {
    const resp = await this.exec("v2_get_state");
    if (!resp.error && resp.result && typeof resp.result === "object") {
      return resp; // got combined state — caller can use it directly
    }
    return this.refreshStatus();
  }

  /** Post a faction chat alert with attack details, location, and nearby entities. */
  private async sendCombatFactionAlert(
    pirateName: string,
    pirateT: string,
    damage: number,
    damageType: string,
    yourHull: number,
    maxHull: number,
    yourShield: number | undefined,
  ): Promise<void> {
    try {
      let nearbyInfo = "";
      const nearbyResp = await this.api.execute("get_nearby");
      if (nearbyResp.result && typeof nearbyResp.result === "object") {
        const nearby = nearbyResp.result as Record<string, unknown>;

        const players = Array.isArray(nearby.players)
          ? (nearby.players as Array<Record<string, unknown>>)
          : [];
        const pirates = Array.isArray(nearby.pirates)
          ? (nearby.pirates as Array<Record<string, unknown>>)
          : [];

        if (players.length > 0) {
          const names = players
            .map(p => (p.username as string) || (p.name as string) || "?")
            .join(", ");
          nearbyInfo += ` | Players: ${names}`;
        }
        if (pirates.length > 0) {
          const ps = pirates
            .map(p => `${(p.name as string) || (p.type as string) || "?"}${p.tier ? ` (${p.tier})` : ""}`)
            .join(", ");
          nearbyInfo += ` | Pirates: ${ps}`;
        }
      }

      const hullPct = maxHull > 0 ? Math.round((yourHull / maxHull) * 100) : 100;
      const shieldStr = yourShield !== undefined ? ` Shield: ${yourShield}` : "";
      const content = `[HULL DAMAGE] ${this.username} hit by ${pirateName}${pirateT ? ` (${pirateT})` : ""} — ${damage} ${damageType} dmg | Hull: ${yourHull}/${maxHull} (${hullPct}%)${shieldStr} | ${this.system}/${this.poi}${nearbyInfo}`;

      await this.api.execute("chat", { channel: "faction", content });
      this.log("combat", `Faction alert sent: ${pirateName} at ${this.system}`);
    } catch (err) {
      this.log("error", `Combat alert failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Post a faction chat warning about an imminent attack or pirate detection. */
  private async sendWarningFactionAlert(message: string): Promise<void> {
    try {
      const content = `[COMBAT WARNING] ${this.username} — ${message} | ${this.system}/${this.poi}`;
      await this.api.execute("chat", { channel: "faction", content });
      this.log("combat", `Faction warning sent`);
    } catch (err) {
      this.log("error", `Warning alert failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Expose the current abort signal so routines can make sleep() interruptible. */
  get abortSignal(): AbortSignal | null {
    return this._abortController?.signal ?? null;
  }

  /** Signal the bot to stop after the current action. */
  stop(): void {
    if (this._state !== "running") return;
    this.state = "stopping";
    this._abortController?.abort();
    this.log("system", "Stop requested — will halt after current action");
  }

  /** Force-stop regardless of current state — clears error/ghost/stuck states. */
  forceStop(): void {
    this._abortController?.abort();
    this._abortController = null;
    this._routine = null;
    this._error = null;
    // Use "stopping" if currently running so the for-await loop in start() detects it
    // on the next yield and breaks cleanly. Going directly to "idle" bypasses that check.
    // If already idle/stopping/error, set to idle immediately.
    if (this._state === "running") {
      this.state = "stopping";
      // Fallback: if the generator is stuck in a long API retry and never yields,
      // force "idle" after 15s so the bot doesn't remain in "stopping" indefinitely.
      setTimeout(() => {
        if (this._state === "stopping") {
          this.state = "idle";
          this.log("system", "Force-stopped (timeout)");
        }
      }, 15_000);
    } else {
      this.state = "idle";
    }
    this.log("system", "Force-stopped");
  }

  /** Get a summary of the bot's current state. */
  status(): BotStatus {
    return {
      username: this.username,
      state: this._state,
      routine: this._routine,
      credits: this.credits,
      fuel: this.fuel,
      maxFuel: this.maxFuel,
      cargo: this.cargo,
      cargoMax: this.cargoMax,
      location: this.location,
      system: this.system,
      poi: this.poi,
      docked: this.docked,
      lastAction: this._lastAction,
      error: this._error,
      shipName: this.shipName,
      shipId: this.shipId,
      shipClassId: this.shipClassId,
      hull: this.hull,
      maxHull: this.maxHull,
      shield: this.shield,
      maxShield: this.maxShield,
      shieldRecharge: this.shieldRecharge,
      armor: this.armor,
      speed: this.speed,
      ammo: this.ammo,
      cpuUsed: this.cpuUsed,
      cpuCapacity: this.cpuCapacity,
      powerUsed: this.powerUsed,
      powerCapacity: this.powerCapacity,
      weaponSlots: this.weaponSlots,
      defenseSlots: this.defenseSlots,
      utilitySlots: this.utilitySlots,
      installedMods: [...this.installedMods],
      shipModules: [...this.shipModules],
      empire: this.empire,
      homeBase: this.homeBase,
      homeSystem: this.homeSystem,
      homePoI: this.homePoI,
      factionId: this.factionId,
      factionRank: this.factionRank,
      isCloaked: this.isCloaked,
      tradingRestrictedUntil: this.tradingRestrictedUntil,
      empireRep: this.empireRep,
      inventory: this.inventory,
      storage: this.storage,
      factionStorage: this.factionStorage,
      stats: { ...this.stats },
      playerStats: { ...this.playerStats },
      skills: [...this.skills],
    };
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  system: "\x1b[34m",
  mining: "\x1b[32m",
  travel: "\x1b[36m",
  trade: "\x1b[33m",
  error: "\x1b[91m",
  info: "\x1b[37m",
  combat: "\x1b[31m",
  skill: "\x1b[95m",
  scavenge: "\x1b[33m",
  rescue: "\x1b[96m",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.info;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); resolve(); return; }
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }
  });
}
