import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const SHIPS_FILE = join(DATA_DIR, "ships.json");
const STATIONS_FILE = join(DATA_DIR, "stations.json");
const SHIPS_URL = "https://game.spacemolt.com/api/ships";
const STATIONS_URL = "https://game.spacemolt.com/api/stations";
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

class PublicCatalog {
  private shipsData: Record<string, unknown> = {};
  private stationsData: Record<string, unknown> = {};

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

  async refreshIfStale(): Promise<{ ships: boolean; stations: boolean }> {
    const result = { ships: false, stations: false };
    if (this.isShipsStale()) {
      await this.fetchShips();
      result.ships = true;
    }
    if (this.isStationsStale()) {
      await this.fetchStations();
      result.stations = true;
    }
    return result;
  }

  getShips(): unknown[] { return (this.shipsData.ships as unknown[]) || []; }
  getStations(): unknown[] { return (this.stationsData.stations as unknown[]) || []; }
  getSummary(): string {
    return `${this.getShips().length} ships, ${this.getStations().length} stations`;
  }

  getAll(): { ships: unknown[]; stations: unknown[] } {
    return { ships: this.getShips(), stations: this.getStations() };
  }
}

export const publicCatalog = new PublicCatalog();
