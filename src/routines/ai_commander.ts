/**
 * AI Commander routine — multi-bot fleet orchestrator using an LLM.
 *
 * This routine runs on a single "commander" bot and uses an LLM to evaluate
 * the state of the ENTIRE fleet, then issues start/stop/exec commands to other
 * bots via the sendBotAction callback.
 *
 * Each cycle:
 *   1. Gather fleet status (all bots, their state, credits, location, routine)
 *   2. Send context to LLM with crimson_fleet_command tool
 *   3. Parse decisions and execute via sendBotAction
 *   4. Log all decisions
 *
 * Configure via Settings → 🧠 AI Commander.
 * Requires OPENAI_COMPAT_BASE_URL + OPENAI_COMPAT_API_KEY env vars (or settings).
 */

import type { Routine, RoutineContext } from "../bot.js";
import { readSettings, sleep } from "./common.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ── Settings ──────────────────────────────────────────────────

function getCommanderSettings(): {
  model: string;
  baseUrl: string;
  apiKey: string;
  cycleIntervalSec: number;
  maxActionsPerCycle: number;
  instruction: string;
} {
  const all = readSettings();
  const s = (all.ai_commander || {}) as Record<string, unknown>;

  return {
    baseUrl: process.env.OPENAI_COMPAT_BASE_URL || (s.baseUrl as string) || "http://localhost:11434/v1",
    apiKey: process.env.OPENAI_COMPAT_API_KEY || (s.apiKey as string) || "ollama",
    model: process.env.AI_MODEL || (s.model as string) || "llama3.2",
    cycleIntervalSec: (s.cycleIntervalSec as number) || 300,
    maxActionsPerCycle: (s.maxActionsPerCycle as number) || 5,
    instruction: (s.instruction as string) || "Maximize fleet earnings. Balance mining, trading, and exploration.",
  };
}

// ── Types ─────────────────────────────────────────────────────

interface FleetCommand {
  bot: string;
  action: "start" | "stop" | "exec";
  routine?: string;
  command?: string;
  params?: Record<string, unknown>;
  reason: string;
}

interface CommanderMemory {
  cycleCount: number;
  lastCycle: string;
  decisions: Array<{ timestamp: string; commands: FleetCommand[]; summary: string }>;
}

// ── Memory persistence ────────────────────────────────────────

const MEMORY_DIR = join(process.cwd(), "data");
const MEMORY_PATH = join(MEMORY_DIR, "ai_commander_memory.json");

function loadMemory(): CommanderMemory {
  try {
    if (existsSync(MEMORY_PATH)) {
      return JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { cycleCount: 0, lastCycle: "", decisions: [] };
}

function saveMemory(mem: CommanderMemory): void {
  try {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
    writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2), "utf-8");
  } catch { /* ignore */ }
}

// ── LLM call ──────────────────────────────────────────────────

async function callLlm(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<FleetCommand[]> {
  const tool = {
    type: "function",
    function: {
      name: "crimson_fleet_command",
      description: "Issue commands to fleet bots. Called once per cycle with all decisions.",
      parameters: {
        type: "object",
        properties: {
          commands: {
            type: "array",
            description: "List of commands to execute this cycle",
            items: {
              type: "object",
              properties: {
                bot: { type: "string", description: "Bot username" },
                action: { type: "string", enum: ["start", "stop", "exec"], description: "Action type" },
                routine: { type: "string", description: "Routine name for start action (e.g. miner, trader, explorer)" },
                command: { type: "string", description: "Game command for exec action" },
                params: { type: "object", description: "Parameters for exec action" },
                reason: { type: "string", description: "Brief reason for this command" },
              },
              required: ["bot", "action", "reason"],
            },
          },
          summary: { type: "string", description: "One-line summary of this cycle's strategy" },
        },
        required: ["commands", "summary"],
      },
    },
  };

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "crimson_fleet_command" } },
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`LLM API error ${resp.status}: ${err}`);
  }

  const data = await resp.json() as {
    choices: Array<{
      message: {
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
        content?: string;
      };
    }>;
  };

  const choice = data.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall) return [];

  try {
    const parsed = JSON.parse(toolCall.function.arguments) as { commands: FleetCommand[]; summary?: string };
    return parsed.commands || [];
  } catch {
    return [];
  }
}

// ── Main routine ──────────────────────────────────────────────

export const aiCommanderRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;

  if (!ctx.getFleetStatus) {
    ctx.log("error", "ai_commander requires getFleetStatus — not available");
    return;
  }
  if (!ctx.sendBotAction) {
    ctx.log("error", "ai_commander requires sendBotAction — not available");
    return;
  }

  const mem = loadMemory();

  const AVAILABLE_ROUTINES = [
    "miner", "trader", "explorer", "crafter", "coordinator",
    "faction_trader", "gatherer", "hunter", "mission_runner",
    "scout", "salvager", "scavenger", "ice_harvester", "gas_harvester",
    "ship_upgrade", "quartermaster", "return_home", "ai", "pi_commander",
  ];

  while (bot.state === "running") {
    yield "ai_commander_cycle";

    const settings = getCommanderSettings();
    mem.cycleCount++;
    mem.lastCycle = new Date().toISOString();

    ctx.log("ai_commander", `Cycle #${mem.cycleCount} — gathering fleet status...`);

    const fleet = ctx.getFleetStatus();

    // Build fleet context string
    const fleetLines = fleet.map(b => {
      const parts = [
        `  ${b.username}:`,
        `state=${b.state}`,
        `routine=${b.routine || "idle"}`,
        `credits=${b.credits}`,
        `system=${b.system || "?"}`,
        `docked=${b.docked}`,
        `hull=${b.hull}/${b.maxHull}`,
        `fuel=${b.fuel}/${b.maxFuel}`,
        `cargo=${b.cargo}/${b.cargoMax}`,
      ];
      if (b.stats) {
        parts.push(`mined=${b.stats.totalMined}`, `trades=${b.stats.totalTrades}`, `profit=${b.stats.totalProfit}`);
      }
      return parts.join(" ");
    });

    const totalCredits = fleet.reduce((s, b) => s + (b.credits || 0), 0);
    const runningBots = fleet.filter(b => b.state === "running");
    const idleBots = fleet.filter(b => b.state !== "running");

    const recentDecisions = mem.decisions.slice(-3).map(d =>
      `  [${d.timestamp}] ${d.summary}`
    ).join("\n");

    const systemPrompt = [
      "You are an AI fleet commander for SpaceMolt, a multiplayer space MMO.",
      "You control multiple bots and must optimize fleet performance.",
      "",
      "STRATEGIC OBJECTIVE:",
      settings.instruction,
      "",
      "AVAILABLE ROUTINES:",
      AVAILABLE_ROUTINES.map(r => `  ${r}`).join("\n"),
      "",
      "RULES:",
      "  - Only stop a bot if it is clearly inefficient or you have a better assignment.",
      "  - Only start a bot if it is currently idle.",
      "  - Use exec sparingly — prefer routine assignments.",
      "  - Never stop ALL bots simultaneously.",
      "  - Max " + settings.maxActionsPerCycle + " commands per cycle.",
      "  - If fleet is performing well, issue no commands (empty array).",
    ].join("\n");

    const userMessage = [
      `FLEET STATUS (${fleet.length} bots, ${runningBots.length} running, ${idleBots.length} idle):`,
      fleetLines.join("\n"),
      "",
      `Total fleet credits: ${totalCredits.toLocaleString()}`,
      "",
      recentDecisions ? `RECENT DECISIONS:\n${recentDecisions}` : "",
      "",
      "Evaluate the fleet and issue commands if needed.",
    ].filter(Boolean).join("\n");

    ctx.log("ai_commander", `Fleet: ${fleet.length} bots (${runningBots.length} running). Querying LLM...`);

    let commands: FleetCommand[] = [];
    try {
      commands = await callLlm(settings.baseUrl, settings.apiKey, settings.model, systemPrompt, userMessage);
      commands = commands.slice(0, settings.maxActionsPerCycle);
    } catch (err) {
      ctx.log("error", `LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Execute commands
    let executed = 0;
    const summary: string[] = [];

    for (const cmd of commands) {
      if (bot.state !== "running") break;

      ctx.log("ai_commander", `→ ${cmd.bot}: ${cmd.action}${cmd.routine ? ` (${cmd.routine})` : ""}${cmd.command ? ` ${cmd.command}` : ""} — ${cmd.reason}`);

      try {
        const result = await ctx.sendBotAction({
          type: cmd.action,
          bot: cmd.bot,
          routine: cmd.routine,
          command: cmd.command,
          params: cmd.params,
        });

        if (result.ok) {
          executed++;
          summary.push(`${cmd.bot}: ${cmd.action}${cmd.routine ? ` ${cmd.routine}` : ""}`);
        } else {
          ctx.log("warn", `Command failed for ${cmd.bot}: ${result.error}`);
        }
      } catch (err) {
        ctx.log("warn", `Error sending command to ${cmd.bot}: ${err instanceof Error ? err.message : String(err)}`);
      }

      await sleep(500);
    }

    if (executed > 0) {
      const decisionSummary = summary.join(", ");
      ctx.log("ai_commander", `Executed ${executed} command(s): ${decisionSummary}`);
      mem.decisions.unshift({
        timestamp: new Date().toLocaleTimeString(),
        commands,
        summary: decisionSummary,
      });
      if (mem.decisions.length > 20) mem.decisions.length = 20;
      saveMemory(mem);
    } else {
      ctx.log("ai_commander", "No commands issued — fleet on track.");
    }

    ctx.log("ai_commander", `Next cycle in ${settings.cycleIntervalSec}s`);
    await sleep(settings.cycleIntervalSec * 1000);
  }
};
