/**
 * ProxyHub — aggregates inbound client VM connections and routes UI↔VM traffic.
 *
 * Architecture: client VMs connect OUT to the master's /hub WebSocket endpoint.
 * The master never initiates connections to clients.
 *
 * Responsibilities:
 * - Accepts inbound HubSession registrations from client VMs.
 * - Receives messages from all connected VMs; injects `vm` tag; forwards to local WebServer.
 * - Routes exec/start/stop/saveSettings commands from the master UI to the correct VM.
 * - Tracks aggregated bot state lists and per-bot logs from remote VMs.
 */

import type { HubClient } from "./types/config.js";

const MAX_BOT_LOG_LINES = 200;
const MAX_GENERAL_LOG_LINES = 500;

export type RemoteVMState = "connecting" | "online" | "offline";

/** Represents one connected client VM session (server-side handle). */
export interface HubSession {
  readonly name: string;
  send(msg: Record<string, unknown>): void;
  disconnect(): void;
}

/** Minimal interface so ProxyHub can call back into the WebServer without a circular import. */
export interface ProxyHubServer {
  broadcastToClients(data: unknown): void;
  broadcastVmStatus(vm: string, state: RemoteVMState): void;
  mergeRemoteBots(bots: unknown[]): void;
  remoteBotLogs: Map<string, string[]>;
  remoteActivityLog: string[];
}

export class ProxyHub {
  /** Allowlist of permitted client VMs (from config). Empty = accept any vm_name. */
  private allowlist: Map<string, string>;
  private sessions = new Map<string, HubSession>();
  private server: ProxyHubServer;

  /** vm → tagged bot status array */
  private remoteStatuses = new Map<string, unknown[]>();

  constructor(clientConfigs: HubClient[], server: ProxyHubServer) {
    this.server = server;
    this.allowlist = new Map(clientConfigs.map(c => [c.name, c.api_key]));
  }

  /**
   * Called by server.ts when a client VM connects at /hub.
   * Returns false if the vm_name/hub_key pair is not in the allowlist.
   */
  isAllowed(vmName: string, hubKey: string): boolean {
    if (this.allowlist.size === 0) return true; // no allowlist = open
    const expected = this.allowlist.get(vmName);
    if (expected === undefined) return false;   // unknown VM
    if (expected === "") return true;           // no api_key required for this VM
    return expected === hubKey;
  }

  /** Register an accepted inbound connection from a client VM. */
  registerSession(session: HubSession): void {
    const existing = this.sessions.get(session.name);
    if (existing) {
      existing.disconnect(); // evict stale session
    }
    this.sessions.set(session.name, session);
    this.server.broadcastVmStatus(session.name, "online");
    console.log(`[ProxyHub] VM ${session.name} connected`);
  }

  /** Called when a client VM's WebSocket closes. */
  unregisterSession(vmName: string): void {
    if (!this.sessions.has(vmName)) return;
    this.sessions.delete(vmName);
    this.remoteStatuses.delete(vmName);
    this.server.mergeRemoteBots(this.getAllRemoteBots());
    this.server.broadcastVmStatus(vmName, "offline");
    console.warn(`[ProxyHub] VM ${vmName} disconnected`);
  }

  /** Handle a message arriving from a connected client VM. */
  handleMessage(msg: Record<string, unknown>): void {
    return this.handleRemoteMessage(msg);
  }

  private handleRemoteMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;
    const vm = msg.vm as string;

    switch (type) {
      case "init": {
        // Extract initial bot list and re-broadcast aggregated status
        if (Array.isArray(msg.bots)) {
          this.remoteStatuses.set(vm, (msg.bots as unknown[]).map(b => ({ ...(b as object), vm })));
          this.server.mergeRemoteBots(this.getAllRemoteBots());
        }
        // Import initial per-bot logs (no vm prefix — logs already contain bot username)
        if (msg.botLogs && typeof msg.botLogs === "object") {
          for (const [username, lines] of Object.entries(msg.botLogs as Record<string, string[]>)) {
            this.server.remoteBotLogs.set(username, (lines as string[]).slice(-MAX_BOT_LOG_LINES));
          }
        }
        // Broadcast remote VM's settings to UI so master can show per-VM settings
        if (msg.settings && typeof msg.settings === "object") {
          this.server.broadcastToClients({ type: "vmSettings", vm, settings: msg.settings });
        }
        // Do NOT re-broadcast the full init (catalog/map data is huge and local is authoritative)
        break;
      }

      case "status": {
        if (Array.isArray(msg.bots)) {
          this.remoteStatuses.set(vm, (msg.bots as unknown[]).map(b => ({ ...(b as object), vm })));
          this.server.mergeRemoteBots(this.getAllRemoteBots());
        }
        // Don't re-broadcast; mergeRemoteBots calls updateBotStatus with combined list
        break;
      }

      case "botLog": {
        const username = msg.username as string;
        if (username && typeof msg.line === "string") {
          const line = `[${vm}] ${msg.line}`;
          if (!this.server.remoteBotLogs.has(username)) {
            this.server.remoteBotLogs.set(username, []);
          }
          const buf = this.server.remoteBotLogs.get(username)!;
          buf.push(line);
          if (buf.length > MAX_BOT_LOG_LINES) buf.shift();
          // Forward to master UI with vm tag already present in msg
          this.server.broadcastToClients({ ...msg, line });
        }
        break;
      }

      case "log": {
        // Forward all log messages without vm prefix — keep uniform format for UI colorization
        if (msg.panel === "activity" && typeof msg.line === "string") {
          this.server.remoteActivityLog.push(msg.line);
          if (this.server.remoteActivityLog.length > MAX_GENERAL_LOG_LINES) {
            this.server.remoteActivityLog.shift();
          }
        }
        this.server.broadcastToClients(msg);
        break;
      }

      case "execResult":
      case "actionResult": {
        // Route command results back to master UI clients (keep _seq intact)
        this.server.broadcastToClients(msg);
        break;
      }

      case "mapUpdate":
      case "statsUpdate":
        // Remote map/stats updates are ignored — master is authoritative for map,
        // and DataSync handles stats aggregation independently
        break;

      default:
        // Forward everything else (factionLog, dataSyncStatus, etc.)
        this.server.broadcastToClients(msg);
        break;
    }
  }

  /** Route a UI command to a specific remote VM. */
  sendToVM(vmName: string, msg: Record<string, unknown>): void {
    const session = this.sessions.get(vmName);
    if (!session) {
      console.error(`[ProxyHub] Unknown VM: "${vmName}" — cannot route command`);
      return;
    }
    session.send(msg);
  }

  /** Flat list of all bot statuses from all connected remote VMs. */
  getAllRemoteBots(): unknown[] {
    const result: unknown[] = [];
    for (const bots of this.remoteStatuses.values()) {
      result.push(...bots);
    }
    return result;
  }

  /** Map of vmName → connection state (online if session exists, offline otherwise). */
  getVmStates(): Record<string, RemoteVMState> {
    const result: Record<string, RemoteVMState> = {};
    for (const name of this.allowlist.keys()) {
      result[name] = this.sessions.has(name) ? "online" : "offline";
    }
    for (const name of this.sessions.keys()) {
      result[name] = "online";
    }
    return result;
  }

  /** Names of all known VMs (allowlisted + currently connected). */
  getVmNames(): string[] {
    return [...new Set([...this.allowlist.keys(), ...this.sessions.keys()])];
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.disconnect();
    }
    this.sessions.clear();
  }
}
