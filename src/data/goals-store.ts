/**
 * SQLite-backed goals persistence.
 * CRUD operations for fleet strategic goals.
 */

import type { Database } from "bun:sqlite";
import type { Goal } from "../types/config.js";

export class GoalsStore {
  constructor(private db: Database) {}

  /** Load all goals ordered by priority (descending). */
  loadGoals(): Goal[] {
    const rows = this.db
      .query("SELECT type, priority, params, constraints FROM goals ORDER BY priority DESC")
      .all() as Array<{ type: string; priority: number; params: string; constraints: string | null }>;

    return rows.map((r) => ({
      type: r.type as Goal["type"],
      priority: r.priority,
      params: JSON.parse(r.params),
      constraints: r.constraints ? JSON.parse(r.constraints) : undefined,
    }));
  }

  /** Replace all goals (atomic). */
  saveGoals(goals: Goal[]): void {
    const tx = this.db.transaction(() => {
      this.db.run("DELETE FROM goals");
      const insert = this.db.prepare(
        "INSERT INTO goals (type, priority, params, constraints) VALUES (?, ?, ?, ?)"
      );
      for (const g of goals) {
        insert.run(g.type, g.priority, JSON.stringify(g.params ?? {}), JSON.stringify(g.constraints ?? null));
      }
    });
    tx();
  }

  /** Add a single goal. */
  addGoal(goal: Goal): void {
    this.db.run(
      "INSERT INTO goals (type, priority, params, constraints) VALUES (?, ?, ?, ?)",
      [goal.type, goal.priority, JSON.stringify(goal.params ?? {}), JSON.stringify(goal.constraints ?? null)]
    );
  }

  /** Update a goal by its DB row index (0-based, matching loadGoals order). */
  updateGoal(index: number, goal: Goal): void {
    const goals = this.loadGoals();
    if (index < 0 || index >= goals.length) return;
    goals[index] = goal;
    this.saveGoals(goals);
  }

  /** Remove a goal by its DB row index (0-based). */
  removeGoal(index: number): void {
    const goals = this.loadGoals();
    if (index < 0 || index >= goals.length) return;
    goals.splice(index, 1);
    this.saveGoals(goals);
  }

  /** Get goal count. */
  get count(): number {
    return (this.db.query("SELECT COUNT(*) as cnt FROM goals").get() as { cnt: number }).cnt;
  }
}
