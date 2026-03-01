import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const API_LOGS_DIR = join(process.cwd(), "data", "api-logs");
const MAX_BODY_LENGTH = 90000;

/** Global on/off switch — default OFF. Set via Settings → General → "Enable API Logging". */
let loggingEnabled = false;

export function setApiLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

function ensureDir(): void {
  if (!existsSync(API_LOGS_DIR)) {
    mkdirSync(API_LOGS_DIR, { recursive: true });
  }
}

function safeStringify(obj: unknown): string {
  if (obj === undefined || obj === null) return String(obj);
  try {
    return JSON.stringify(obj) ?? String(obj);
  } catch {
    return String(obj);
  }
}

/** Remove sensitive fields before logging. */
function sanitizePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if ("password" in p) p.password = "***";
  return p;
}

function truncate(s: string): string {
  return s.length > MAX_BODY_LENGTH ? s.slice(0, MAX_BODY_LENGTH) + "…" : s;
}

function write(label: string, line: string): void {
  if (!loggingEnabled) return;
  try {
    ensureDir();
    appendFileSync(join(API_LOGS_DIR, `${label}.log`), line);
  } catch { /* ignore write errors */ }
}

export function logApiRequest(
  label: string,
  url: string,
  sessionId: string | undefined,
  payload: unknown,
): void {
  if (!label) return;
  const sid = sessionId ? sessionId.slice(0, 8) + "..." : "none";
  const hasPayload = payload !== undefined && payload !== null;
  const body = hasPayload ? `  ${truncate(safeStringify(sanitizePayload(payload)))}` : "";
  const line = `${new Date().toISOString()} → POST ${url}  session=${sid}${body}\n`;
  write(label, line);
}

export function logApiResponse(
  label: string,
  url: string,
  status: number,
  duration: number,
  data: unknown,
): void {
  if (!label) return;
  const body = truncate(safeStringify(data));
  const line = `${new Date().toISOString()} ← ${status} (${duration}ms) ${url}  ${body}\n`;
  write(label, line);
}

export function logApiSession(
  label: string,
  event: string,
  detail: string,
): void {
  if (!label) return;
  const line = `${new Date().toISOString()} ◆ SESSION ${event}  ${detail}\n`;
  write(label, line);
}

/** Write a separator line to a bot's log file at the start of a new server run. */
export function logApiRunStart(label: string): void {
  if (!label) return;
  const line = `\n${'='.repeat(60)}\n${new Date().toISOString()} ► RUN START\n${'='.repeat(60)}\n`;
  write(label, line);
}
