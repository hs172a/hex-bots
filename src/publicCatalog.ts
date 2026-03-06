import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const SHIPS_FILE = join(DATA_DIR, "ships.json");
const STATIONS_FILE = join(DATA_DIR, "stations.json");
const GALAXY_FILE = join(DATA_DIR, "galaxy_bootstrap.json");
const SHIPS_URL = "https://game.spacemolt.com/api/ships";
const STATIONS_URL = "https://game.spacemolt.com/api/stations";
const GALAXY_URL = "https://game.spacemolt.com/api/map";
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

class PublicCatalog {
  private shipsData: Record<string, unknown> = {};
  private stationsData: Record<string, unknown> = {};
  private galaxyData: Record<string, unknown> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(SHIPS_FILE)) {
        this.shipsData = JSON.parse(readFileSync(SHIPS_FILE, "utf-8"));
      }
    } catch {}
    try {
      if (existsSync(STATIONS_FILE)) {
        this.stationsData = JSON.parse(readFileSync(STATIONS_FILE, "utf-8"));
      }
    } catch {}
    try {
      if (existsSync(GALAXY_FILE)) {
        this.galaxyData = JSON.parse(readFileSync(GALAXY_FILE, "utf-8"));
      }
    } catch {}
  }

  private fileAge(path: string): number {
    try { return Date.now() - statSync(path).mtime.getTime(); } catch { return Infinity; }
  }

  isShipsStale(): boolean {
    if (!existsSync(SHIPS_FILE)) return true;
    const fetched = this.shipsData._fetched as string | undefined;
    if (fetched) return Date.now() - new Date(fetched).getTime() > STALE_MS;
    return this.fileAge(SHIPS_FILE) > STALE_MS;
  }

  isStationsStale(): boolean {
    if (!existsSync(STATIONS_FILE)) return true;
    const fetched = this.stationsData._fetched as string | undefined;
    if (fetched) return Date.now() - new Date(fetched).getTime() > STALE_MS;
    return this.fileAge(STATIONS_FILE) > STALE_MS;
  }

  isGalaxyStale(): boolean {
    if (!existsSync(GALAXY_FILE)) return true;
    const fetched = (this.galaxyData._fetched ?? this.galaxyData.generated_at) as string | undefined;
    if (fetched) return Date.now() - new Date(fetched).getTime() > STALE_MS;
    return this.fileAge(GALAXY_FILE) > STALE_MS;
  }

  async fetchShips(): Promise<void> {
    const res = await fetch(SHIPS_URL, { headers: { "User-Agent": "SpaceMoltBot/0.2" } });
    if (!res.ok) throw new Error(`Ships fetch failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    this.shipsData = { ...data, _fetched: new Date().toISOString() };
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SHIPS_FILE, JSON.stringify(this.shipsData, null, 2) + "\n", "utf-8");
  }

  async fetchStations(): Promise<void> {
    const res = await fetch(STATIONS_URL, { headers: { "User-Agent": "SpaceMoltBot/0.2" } });
    if (!res.ok) throw new Error(`Stations fetch failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    this.stationsData = { ...data, _fetched: new Date().toISOString() };
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATIONS_FILE, JSON.stringify(this.stationsData, null, 2) + "\n", "utf-8");
  }

  async fetchGalaxy(): Promise<void> {
    const res = await fetch(GALAXY_URL, {
      headers: { "User-Agent": "SpaceMoltBot/0.2" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Galaxy fetch failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const systems = Array.isArray(data.systems) ? data.systems as Array<Record<string, unknown>> : [];
    // Store only topology fields to keep the file lean
    const nameById = new Map<string, string>();
    for (const s of systems) {
      if (s.id && s.name) nameById.set(s.id as string, s.name as string);
    }
    const stripped = systems.map(s => ({
      id: s.id,
      name: s.name,
      security_level: s.security_level ?? s.security_status ?? s.lawfulness ?? undefined,
      connections: Array.isArray(s.connections)
        ? (s.connections as string[]).map(cid => ({ system_id: cid, system_name: nameById.get(cid) || cid }))
        : [],
      pois: Array.isArray(s.pois)
        ? (s.pois as Array<Record<string, unknown>>).map(p => ({
            id: p.id, name: p.name, type: p.type,
            has_base: p.has_base ?? false,
            base_id: p.base_id ?? null, base_name: p.base_name ?? null, base_type: p.base_type ?? null,
            services: p.services ?? [],
          }))
        : [],
    }));
    this.galaxyData = { _fetched: new Date().toISOString(), source: GALAXY_URL, systems: stripped };
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(GALAXY_FILE, JSON.stringify(this.galaxyData, null, 2) + "\n", "utf-8");
  }

  async refreshIfStale(): Promise<{ ships: boolean; stations: boolean; galaxy: boolean }> {
    const result = { ships: false, stations: false, galaxy: false };
    if (this.isShipsStale()) {
      await this.fetchShips();
      result.ships = true;
    }
    if (this.isStationsStale()) {
      await this.fetchStations();
      result.stations = true;
    }
    if (this.isGalaxyStale()) {
      await this.fetchGalaxy();
      result.galaxy = true;
    }
    return result;
  }

  getShips(): unknown[] { return (this.shipsData.ships as unknown[]) || []; }
  getStations(): unknown[] { return (this.stationsData.stations as unknown[]) || []; }
  getGalaxySystems(): Array<Record<string, unknown>> {
    return (this.galaxyData.systems as Array<Record<string, unknown>>) || [];
  }
  getSummary(): string {
    const sys = this.getGalaxySystems().length;
    return `${this.getShips().length} ships, ${this.getStations().length} stations${sys > 0 ? `, ${sys} systems` : ""}`;
  }

  getAll(): { ships: unknown[]; stations: unknown[] } {
    return { ships: this.getShips(), stations: this.getStations() };
  }
}

export const publicCatalog = new PublicCatalog();
