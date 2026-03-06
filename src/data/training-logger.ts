/**
 * Training data logger.
 * Records decisions, snapshots, episodes, market prices, and financial events
 * for analytics and future model training.
 */

import type { Database } from "bun:sqlite";

export class TrainingLogger {
  private enabled = {
    decisions: true,
    snapshots: true,
    episodes: true,
    marketHistory: true,
  };

  /** Buffered snapshots for batch insert */
  private snapshotBuffer: Array<{
    tick: number; botId: string;
    playerState: Record<string, unknown>;
    shipState: Record<string, unknown>;
    location: Record<string, unknown>;
  }> = [];
  private snapshotFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private db: Database) {}

  /** Start the periodic flush timer (call from main app) */
  startSnapshotFlush(): void {
    if (this.snapshotFlushTimer) return;
    this.snapshotFlushTimer = setInterval(() => this.flushSnapshots(), 10_000);
  }

  /** Flush buffered snapshots in a single transaction */
  flushSnapshots(): void {
    if (this.snapshotBuffer.length === 0) return;
    const batch = this.snapshotBuffer;
    this.snapshotBuffer = [];
    const stmt = this.db.prepare(
      `INSERT INTO state_snapshots (tick, bot_id, player_state, ship_state, location)
       VALUES (?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      for (const s of batch) {
        stmt.run(
          s.tick, s.botId,
          JSON.stringify(s.playerState), JSON.stringify(s.shipState), JSON.stringify(s.location),
        );
      }
    });
    tx();
  }

  /** Stop flush timer and flush remaining data (call on shutdown) */
  destroy(): void {
    if (this.snapshotFlushTimer) {
      clearInterval(this.snapshotFlushTimer);
      this.snapshotFlushTimer = null;
    }
    this.flushSnapshots();
  }

  configure(opts: Partial<typeof this.enabled>): void {
    Object.assign(this.enabled, opts);
  }

  /** Log a bot's action decision and outcome */
  logDecision(params: {
    tick: number;
    botId: string;
    action: string;
    actionParams?: Record<string, unknown>;
    context: Record<string, unknown>;
    result?: Record<string, unknown>;
    commanderGoal?: string;
  }): void {
    if (!this.enabled.decisions) return;
    this.db.run(
      `INSERT INTO decision_log (tick, bot_id, action, params, context, result, commander_goal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.tick,
        params.botId,
        params.action,
        params.actionParams ? JSON.stringify(params.actionParams) : null,
        JSON.stringify(params.context),
        params.result ? JSON.stringify(params.result) : null,
        params.commanderGoal ?? null,
      ]
    );
  }

  /** Log a full bot state snapshot (buffered — flushed every 10s) */
  logSnapshot(params: {
    tick: number;
    botId: string;
    playerState: Record<string, unknown>;
    shipState: Record<string, unknown>;
    location: Record<string, unknown>;
  }): void {
    if (!this.enabled.snapshots) return;
    this.snapshotBuffer.push(params);
  }

  /** Log a completed episode (mining run, trade route, etc.) */
  logEpisode(params: {
    botId: string;
    episodeType: string;
    startTick: number;
    endTick: number;
    startCredits: number;
    endCredits: number;
    route: string[];
    itemsInvolved: Record<string, number>;
    fuelConsumed: number;
    risks: string[];
    commanderGoal?: string;
    success: boolean;
  }): void {
    if (!this.enabled.episodes) return;
    // episodes table doesn't exist in our v2 schema yet — skip if table missing
    try {
      this.db.run(
        `INSERT INTO decision_log (tick, bot_id, action, params, context, result, commander_goal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          params.endTick,
          params.botId,
          `episode:${params.episodeType}`,
          JSON.stringify({
            startTick: params.startTick,
            route: params.route,
            itemsInvolved: params.itemsInvolved,
            fuelConsumed: params.fuelConsumed,
          }),
          JSON.stringify({
            startCredits: params.startCredits,
            endCredits: params.endCredits,
            risks: params.risks,
          }),
          JSON.stringify({
            profit: params.endCredits - params.startCredits,
            success: params.success,
            duration: params.endTick - params.startTick,
          }),
          params.commanderGoal ?? null,
        ]
      );
    } catch { /* ignore if schema doesn't support it */ }
  }

  /** Log market prices at a station (for price time-series) */
  logMarketPrices(
    tick: number,
    stationId: string,
    prices: Array<{
      itemId: string;
      buyPrice: number | null;
      sellPrice: number | null;
      buyVolume: number;
      sellVolume: number;
    }>
  ): void {
    if (!this.enabled.marketHistory) return;
    if (prices.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT INTO market_history (tick, station_id, item_id, buy_price, sell_price, buy_volume, sell_volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = this.db.transaction(() => {
      for (const p of prices) {
        stmt.run(tick, stationId, p.itemId, p.buyPrice, p.sellPrice, p.buyVolume, p.sellVolume);
      }
    });

    tx();
  }

  /** Log a commander evaluation decision */
  logCommanderDecision(params: {
    tick: number;
    goal: string;
    fleetState: Record<string, unknown>;
    assignments: Record<string, unknown>[];
    reasoning: string;
    economyState?: Record<string, unknown>;
  }): void {
    this.db.run(
      `INSERT INTO commander_log (tick, goal, fleet_state, assignments, reasoning, economy_state)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        params.tick,
        params.goal,
        JSON.stringify(params.fleetState),
        JSON.stringify(params.assignments),
        params.reasoning,
        params.economyState ? JSON.stringify(params.economyState) : null,
      ]
    );
  }

  /** Log a credit history data point (for fleet credits chart) */
  logCreditHistory(totalCredits: number, activeBots: number): void {
    this.db.run(
      "INSERT INTO credit_history (timestamp, total_credits, active_bots) VALUES (?, ?, ?)",
      [Date.now(), totalCredits, activeBots]
    );
  }

  /** Get credit history for charting */
  getCreditHistory(sinceMs: number): Array<{
    timestamp: number;
    totalCredits: number;
    activeBots: number;
  }> {
    const since = Date.now() - sinceMs;
    const rows = this.db.query(`
      SELECT timestamp, total_credits, active_bots
      FROM credit_history
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `).all(since) as Array<{ timestamp: number; total_credits: number; active_bots: number }>;
    return rows.map(r => ({
      timestamp: r.timestamp,
      totalCredits: r.total_credits,
      activeBots: r.active_bots,
    }));
  }

  /**
   * Get recent episode outcomes for experience replay (ai_commander context injection).
   * Returns the N most recent episode entries from decision_log, newest first.
   * Each entry has: botId, episodeType, profit, success, durationTicks, timestamp.
   */
  getRecentEpisodes(limit = 20): Array<{
    botId: string;
    episodeType: string;
    profit: number;
    success: boolean;
    durationTicks: number;
    timestamp: number;
  }> {
    const rows = this.db.query(`
      SELECT bot_id, action, result, created_at
      FROM decision_log
      WHERE action LIKE 'episode:%'
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as Array<{
      bot_id: string;
      action: string;
      result: string | null;
      created_at: string;
    }>;

    return rows.map(row => {
      let profit = 0;
      let success = false;
      let durationTicks = 0;
      try {
        const r = JSON.parse(row.result ?? "{}") as Record<string, unknown>;
        profit = (r.profit as number) ?? 0;
        success = !!(r.success);
        durationTicks = (r.duration as number) ?? 0;
      } catch { /* malformed row */ }
      return {
        botId: row.bot_id,
        episodeType: row.action.replace("episode:", ""),
        profit,
        success,
        durationTicks,
        timestamp: row.created_at ? new Date(row.created_at).getTime() : 0,
      };
    });
  }

  /** Get training data stats */
  getStats(): {
    decisions: number;
    snapshots: number;
    marketRecords: number;
    commanderDecisions: number;
  } {
    const q = (table: string) =>
      (this.db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
    return {
      decisions: q("decision_log"),
      snapshots: q("state_snapshots"),
      marketRecords: q("market_history"),
      commanderDecisions: q("commander_log"),
    };
  }
}
