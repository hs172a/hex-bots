import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface Credentials {
  username: string;
  password: string;
  empire: string;
  playerId: string;
}

export interface PersistedSession {
  id: string;
  playerId?: string;
  createdAt: string;
  expiresAt: string;
}

export class SessionManager {
  readonly dir: string;
  private credentialsPath: string;
  private legacyCredentialsPath: string;
  private todoPath: string;
  private sessionPath: string;

  constructor(sessionName: string, baseDir: string) {
    this.dir = join(baseDir, "sessions", sessionName);
    this.credentialsPath = join(this.dir, "credentials.json");
    this.legacyCredentialsPath = join(this.dir, "CREDENTIALS.md");
    this.todoPath = join(this.dir, "TODO.md");
    this.sessionPath = join(this.dir, "session.json");
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  loadCredentials(): Credentials | null {
    // Try JSON first
    if (existsSync(this.credentialsPath)) {
      try {
        const data = JSON.parse(readFileSync(this.credentialsPath, "utf-8"));
        if (data.username && data.password) {
          return {
            username: data.username,
            password: data.password,
            empire: data.empire || "",
            playerId: data.playerId || data.player_id || "",
          };
        }
      } catch {}
    }
    // Fall back to legacy markdown format
    if (existsSync(this.legacyCredentialsPath)) {
      const creds = this.parseLegacyCredentials(
        readFileSync(this.legacyCredentialsPath, "utf-8")
      );
      if (creds) {
        // Migrate to JSON
        this.saveCredentials(creds);
        return creds;
      }
    }
    return null;
  }

  private parseLegacyCredentials(text: string): Credentials | null {
    const get = (label: string): string => {
      const match = text.match(new RegExp(`- ${label}:\\s*(.+)`, "i"));
      return match ? match[1].trim() : "";
    };
    const username = get("Username");
    const password = get("Password");
    const empire = get("Empire");
    const playerId = get("Player ID");
    if (!username || !password) return null;
    return { username, password, empire, playerId };
  }

  saveCredentials(creds: Credentials): void {
    writeFileSync(
      this.credentialsPath,
      JSON.stringify(creds, null, 2) + "\n",
      "utf-8"
    );
  }

  /** Load a previously persisted session. Returns null if missing, malformed, or already expired. */
  loadSession(): PersistedSession | null {
    if (!existsSync(this.sessionPath)) return null;
    try {
      const data = JSON.parse(readFileSync(this.sessionPath, "utf-8")) as PersistedSession;
      if (!data.id || !data.expiresAt) return null;
      // Reject if session expires within 60 seconds (same grace period as api.ts)
      if (new Date(data.expiresAt).getTime() - Date.now() < 60_000) return null;
      return data;
    } catch {
      return null;
    }
  }

  saveSession(session: PersistedSession): void {
    try {
      writeFileSync(
        this.sessionPath,
        JSON.stringify(session, null, 2) + "\n",
        "utf-8"
      );
    } catch {
      // Non-fatal — worst case the next restart does a full login
    }
  }

  loadTodo(): string {
    if (!existsSync(this.todoPath)) return "";
    return readFileSync(this.todoPath, "utf-8");
  }

  saveTodo(content: string): void {
    writeFileSync(this.todoPath, content, "utf-8");
  }
}
