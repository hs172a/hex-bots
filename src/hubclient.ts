/**
 * HubClientConnector — client-side WebSocket connector to the master's /hub endpoint.
 *
 * Architecture: THIS is what runs on client VMs.
 * The client initiates the connection to the master; master never connects to clients.
 *
 * Responsibilities:
 * - Connects to ws://master-ip:port/hub?vm_name=...&hub_key=...
 * - Reconnects automatically with exponential back-off on disconnect.
 * - Receives commands from master and routes them to onCommand handler.
 * - Provides push() to send status/log messages to master.
 */

export type HubClientState = "connecting" | "online" | "offline";

export class HubClientConnector {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff = 2;
  private sendQueue: string[] = [];

  state: HubClientState = "offline";

  /** Called with every command message received from master. */
  onCommand: ((msg: Record<string, unknown>) => void) | null = null;

  /** Called when connection state changes. */
  onStateChange: ((state: HubClientState) => void) | null = null;

  constructor(
    private masterWsUrl: string,
    private vmName: string,
    private apiKey: string,
  ) {}

  connect(): void {
    if (this.stopped) return;
    this.setState("connecting");

    const url = new URL(`${this.masterWsUrl}/hub`);
    url.searchParams.set("vm_name", this.vmName);
    if (this.apiKey) url.searchParams.set("hub_key", this.apiKey);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString());
    } catch (err) {
      console.error(`[HubClient] WebSocket construct error:`, err);
      this.setState("offline");
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.addEventListener("open", () => {
      this.setState("online");
      this.backoff = 2;
      console.log(`[HubClient] Connected to master hub: ${this.masterWsUrl}`);

      // Flush queued messages
      for (const msg of this.sendQueue) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
      this.sendQueue = [];
    });

    ws.addEventListener("message", (evt: MessageEvent) => {
      try {
        const raw = typeof evt.data === "string" ? evt.data : evt.data.toString();
        const msg = JSON.parse(raw) as Record<string, unknown>;
        this.onCommand?.(msg);
      } catch { /* ignore malformed */ }
    });

    ws.addEventListener("close", (evt: CloseEvent) => {
      if (this.stopped) return;
      this.setState("offline");
      const reason = evt.reason ? ` reason=${evt.reason}` : "";
      console.warn(`[HubClient] Disconnected (code=${evt.code}${reason}) — reconnecting in ${this.backoff}s`);
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (evt: Event) => {
      const msg = (evt as ErrorEvent).message ?? "(no detail)";
      console.warn(`[HubClient] WS error: ${msg}`);
    });
  }

  /**
   * Push a message to the master hub.
   * Queues messages while disconnected (sent on reconnect, capped at 100).
   */
  push(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(json);
      } catch (err) {
        console.error(`[HubClient] Send error:`, err);
      }
    } else {
      if (this.sendQueue.length < 100) {
        this.sendQueue.push(json);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    this.sendQueue = [];
  }

  private setState(state: HubClientState): void {
    this.state = state;
    this.onStateChange?.(state);
  }

  private scheduleReconnect(): void {
    this.backoff = Math.min(this.backoff * 2, 60);
    setTimeout(() => this.connect(), this.backoff * 1000);
  }
}
