/**
 * SshTunnelManager — automatically opens SSH port-forwarding tunnels on startup.
 *
 * Config: [ssh_tunnels] section in config.toml.
 * Each tunnel entry spawns either a reverse or forward SSH tunnel.
 *
 * direction = "reverse" (default, for ProxyHub)
 *   ssh -N -R <remote_port>:127.0.0.1:<local_port> <user>@<master_host>
 *   Opens <remote_port> on the master that forwards back to this client's
 *   local hex-bots port. Master ProxyHub connects to ws://127.0.0.1:<remote_port>.
 *
 * direction = "forward" (for DataSync)
 *   ssh -N -L <local_port>:127.0.0.1:<remote_port> <user>@<master_host>
 *   Opens <local_port> locally that forwards to master's DataSync port.
 *   Client DataSync reaches http://127.0.0.1:<local_port> → master's <remote_port>.
 *
 * Processes are monitored and restarted on exit with exponential back-off.
 */

import type { SshTunnelsConfig, SshTunnelEntry } from "./types/config.js";

export type TunnelState = "connecting" | "up" | "down";

export interface TunnelStatus {
  name: string;
  state: TunnelState;
  localPort: number;
  remotePort: number;
  host: string;
}

export class SshTunnelManager {
  private cfg: SshTunnelsConfig;
  private processes = new Map<string, ReturnType<typeof Bun.spawn>>();
  private backoffs = new Map<string, number>();
  private states = new Map<string, TunnelState>();
  private stopped = false;

  /** Called when a tunnel's state changes — wire to broadcastVmStatus. */
  onTunnelState?: (name: string, state: TunnelState) => void;

  constructor(cfg: SshTunnelsConfig) {
    this.cfg = cfg;
  }

  start(): void {
    for (const entry of this.cfg.tunnels) {
      this.spawnTunnel(entry);
    }
  }

  private spawnTunnel(entry: SshTunnelEntry): void {
    if (this.stopped) return;

    this.setState(entry.name, "connecting");

    const keyFile = entry.ssh_key_file.replace(/^~/, process.env.HOME ?? "/root");

    const isReverse = (entry.direction ?? "reverse") === "reverse";
    // Explicitly bind to 127.0.0.1 on the listening side to avoid SSH defaulting
    // to ::1 (IPv6 loopback) on dual-stack systems, which breaks ws://127.0.0.1:... connections.
    const fwdArg = isReverse
      ? `127.0.0.1:${entry.remote_port}:127.0.0.1:${entry.local_port}`
      : `127.0.0.1:${entry.local_port}:127.0.0.1:${entry.remote_port}`;
    const flag = isReverse ? "-R" : "-L";

    const args = [
      "ssh",
      "-N",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "ExitOnForwardFailure=yes",
      "-i", keyFile,
      flag, fwdArg,
      `${entry.ssh_user}@${entry.ssh_host}`,
    ];

    console.log(`[SshTunnels] Tunnel ${entry.name}: ssh ${flag} ${fwdArg} ${entry.ssh_user}@${entry.ssh_host}`);

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(args, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
    } catch (err) {
      console.error(`[SshTunnels] Failed to spawn ssh for ${entry.name}:`, err);
      this.setState(entry.name, "down");
      this.scheduleRestart(entry);
      return;
    }

    this.processes.set(entry.name, proc);

    // Drain stderr for diagnostics; detect "Address already in use" to auto-free the port
    (async () => {
      if (!proc.stderr) return;
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let portConflict = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trim();
        if (text) console.warn(`[SshTunnels:${entry.name}] ${text}`);
        if (!portConflict && text.toLowerCase().includes("address already in use")) {
          portConflict = true;
          const localPort = isReverse ? entry.remote_port : entry.local_port;
          console.warn(`[SshTunnels:${entry.name}] Port ${localPort} occupied by orphan process — freeing with fuser -k`);
          this.backoffs.set(entry.name, 2); // reset backoff so retry is quick
          try {
            const fuser = Bun.spawn(["fuser", "-k", `${localPort}/tcp`], {
              stdin: "ignore", stdout: "ignore", stderr: "ignore",
            });
            await fuser.exited;
          } catch { /* fuser not available */ }
        }
      }
    })().catch(() => {});

    // Monitor for exit
    proc.exited.then((code) => {
      if (this.stopped) return;
      this.setState(entry.name, "down");
      const backoff = this.backoffs.get(entry.name) ?? 2;
      console.warn(`[SshTunnels] Tunnel ${entry.name} exited (code ${code}) — restarting in ${backoff}s`);
      this.scheduleRestart(entry);
    }).catch(() => {});

    // After 2s with no exit, assume the tunnel is up
    setTimeout(() => {
      if (this.stopped) return;
      if (this.states.get(entry.name) === "connecting") {
        this.setState(entry.name, "up");
        this.backoffs.set(entry.name, 2); // reset back-off on presumed success
        const desc = isReverse
          ? `${entry.ssh_host}:${entry.remote_port} → local:${entry.local_port}`
          : `local:${entry.local_port} → ${entry.ssh_host}:${entry.remote_port}`;
        console.log(`[SshTunnels] Tunnel ${entry.name} presumed up (${desc})`);
      }
    }, 2000);
  }

  private setState(name: string, state: TunnelState): void {
    this.states.set(name, state);
    this.onTunnelState?.(name, state);
  }

  private scheduleRestart(entry: SshTunnelEntry): void {
    const current = this.backoffs.get(entry.name) ?? 2;
    const next = Math.min(current * 2, 60);
    this.backoffs.set(entry.name, next);
    setTimeout(() => this.spawnTunnel(entry), next * 1000);
  }

  stopAll(): void {
    this.stopped = true;
    for (const [name, proc] of this.processes) {
      console.log(`[SshTunnels] Killing tunnel ${name}`);
      try { proc.kill(); } catch { /* already exited */ }
    }
    this.processes.clear();
  }

  getStatus(): TunnelStatus[] {
    return this.cfg.tunnels.map(t => ({
      name: t.name,
      state: this.states.get(t.name) ?? "down",
      localPort: t.local_port,
      remotePort: t.remote_port,
      host: t.ssh_host,
    }));
  }
}
