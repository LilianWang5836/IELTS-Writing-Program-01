import { appendFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { CoachTurnTrace } from "../types";
import { validateCoachTurnTrace } from "./coach-trace";

const DEFAULT_TRACE_DIR = join(process.cwd(), ".coach-traces");

export function getTraceFilePath(sessionId: string, baseDir = DEFAULT_TRACE_DIR): string {
  return join(baseDir, `${sessionId}.jsonl`);
}

/** Append one trace per turn — JSON lines, timestamp-ordered. */
export function persistCoachTurnTrace(
  trace: CoachTurnTrace,
  options?: { baseDir?: string; sessionId?: string },
): void {
  if (!validateCoachTurnTrace(trace)) {
    throw new Error("Invalid CoachTurnTrace — refusing to persist");
  }
  const sessionId =
    options?.sessionId ?? trace.turnId.split(":turn:")[0] ?? "unknown";
  const baseDir = options?.baseDir ?? DEFAULT_TRACE_DIR;
  mkdirSync(baseDir, { recursive: true });
  const line = `${JSON.stringify(trace)}\n`;
  appendFileSync(getTraceFilePath(sessionId, baseDir), line, "utf8");
}

export function loadCoachTurnTraces(
  sessionId: string,
  baseDir = DEFAULT_TRACE_DIR,
): CoachTurnTrace[] {
  const filePath = getTraceFilePath(sessionId, baseDir);
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
  const traces: CoachTurnTrace[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (validateCoachTurnTrace(parsed)) traces.push(parsed);
    } catch {
      // skip corrupt lines for backward replay tolerance
    }
  }
  return traces;
}
