/**
 * PI Commander routine — launches the autonomous LLM agent (commander.ts)
 * as a managed subprocess, bridging its output into the bot's log stream.
 *
 * Settings (under "pi_commander" in data/settings.json):
 *   model       — LLM model string, e.g. "ollama/qwen3:8b"
 *                 or "anthropic/claude-sonnet-4-20250514" (default: "ollama/llama3.2")
 *   instruction — Mission instruction for the agent (default: "Play SpaceMolt effectively")
 *   session     — Session name for credentials/state (default: bot username)
 *   debug       — Pass --debug flag to commander (default: false)
 */

import type { Routine, RoutineContext } from "../bot.js";
import { join } from "path";
import { readSettings, sleep } from "./common.js";

// ── Settings ─────────────────────────────────────────────────

interface PiCommanderSettings {
  model: string;
  instruction: string;
  session: string;
  debug: boolean;
}

function getSettings(botUsername: string): PiCommanderSettings {
  const all = readSettings();
  const s = (all.pi_commander || {}) as Record<string, unknown>;

  // Per-bot overrides stored under pi_commander.bots.{username}
  const perBot = ((s.bots || {}) as Record<string, Record<string, unknown>>)[botUsername] || {};

  return {
    model: (perBot.model as string) || (s.model as string) || "ollama/llama3.2",
    instruction: (perBot.instruction as string) || (s.instruction as string) || "Play SpaceMolt effectively — mine ore, trade, and develop your character.",
    session: (perBot.session as string) || (s.session as string) || botUsername,
    debug: Boolean(perBot.debug ?? s.debug ?? false),
  };
}

// ── Log line parser ───────────────────────────────────────────

/** Strip ANSI escape codes from commander.ts terminal output. */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, "").replace(/\r/g, "");
}

/** Map commander log prefixes to routine log levels. */
function classifyLine(line: string): "info" | "error" | "system" | "mining" | "combat" {
  const l = line.toLowerCase();
  if (l.includes("[error]") || l.includes("fatal:") || l.includes("failed:")) return "error";
  if (l.includes("[setup]") || l.includes("[system]") || l.includes("shutdown")) return "system";
  if (l.includes("mine") || l.includes("ore") || l.includes("cargo")) return "mining";
  if (l.includes("attack") || l.includes("combat") || l.includes("fight")) return "combat";
  return "info";
}

// ── Routine ───────────────────────────────────────────────────

export const piCommanderRoutine: Routine = async function* (ctx: RoutineContext) {
  const { bot } = ctx;
  const settings = getSettings(bot.username);

  ctx.log("system", `PI Commander starting — model: ${settings.model}, session: ${settings.session}`);
  ctx.log("info", `Instruction: ${settings.instruction}`);

  yield "init";

  // Build the subprocess argv
  const commanderScript = join(process.cwd(), "src", "commander.ts");
  const argv: string[] = [
    "bun", "run", "--no-install", commanderScript,
    "--model", settings.model,
    "--session", settings.session,
  ];
  if (settings.debug) argv.push("--debug");
  argv.push(settings.instruction);

  let proc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    proc = Bun.spawn(argv, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    ctx.log("system", `PI Commander subprocess started (PID: ${proc.pid})`);
    yield "running";

    // Stream stdout and stderr concurrently
    const decoder = new TextDecoder();
    let stdoutBuf = "";
    let stderrBuf = "";

    // Helper: flush buffered lines
    function flushLines(buf: string, isErr: boolean): string {
      const lines = buf.split("\n");
      const remaining = lines.pop() ?? "";
      for (const raw of lines) {
        const line = stripAnsi(raw).trim();
        if (!line) continue;
        const level = isErr ? "error" : classifyLine(line);
        ctx.log(level, line);
      }
      return remaining;
    }

    // Async read loop — interleave stdout + stderr reads
    const stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();

    let stdoutDone = false;
    let stderrDone = false;

    while (!stdoutDone || !stderrDone) {
      if (bot.state !== "running") break;

      // Read a chunk from stdout
      if (!stdoutDone) {
        const { value, done } = await stdoutReader.read();
        if (done) {
          stdoutBuf = flushLines(stdoutBuf + "\n", false);
          stdoutDone = true;
        } else if (value) {
          stdoutBuf += decoder.decode(value, { stream: true });
          stdoutBuf = flushLines(stdoutBuf, false);
        }
      }

      // Read a chunk from stderr
      if (!stderrDone) {
        const { value, done } = await stderrReader.read();
        if (done) {
          stderrBuf = flushLines(stderrBuf + "\n", true);
          stderrDone = true;
        } else if (value) {
          stderrBuf += decoder.decode(value, { stream: true });
          stderrBuf = flushLines(stderrBuf, true);
        }
      }

      yield "running";
    }

    // Wait for process exit if still running
    if (bot.state === "running") {
      const exitCode = await proc.exited;
      ctx.log("system", `PI Commander exited with code ${exitCode}`);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log("error", `PI Commander error: ${msg}`);
  } finally {
    if (proc) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
    ctx.log("system", "PI Commander stopped.");
  }
};
