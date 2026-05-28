import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { SessionState } from "@/lib/domain/types";
import { runRuntimePipeline } from "../pipeline/runtime-pipeline";
import type { ArbitratedTurnPlan, CoachRuntimeMode } from "../types";
import { validateCoachTurnTrace } from "../trace/coach-trace";

export interface GoldenFixtureInput {
  fixtureId: string;
  state: SessionState;
  turns: Array<{ userMessage: string; llmResult?: { mirror?: string; coachQuestion?: string } }>;
}

export interface GoldenExpectedPlan {
  turnIndex: number;
  action: ArbitratedTurnPlan["action"];
  primaryGap?: string | null;
}

export interface GoldenExpectedMode {
  turnIndex: number;
  runtimeMode: CoachRuntimeMode;
}

export interface GoldenExpectedRuntime {
  turnIndex: number;
  readyToFinalize?: boolean;
  fatigueHigh?: boolean;
}

export interface ReplayDiff {
  fixtureId: string;
  turnIndex: number;
  field: string;
  expected: unknown;
  actual: unknown;
}

export function loadFixtureDir(fixtureDir: string): GoldenFixtureInput {
  const inputPath = join(fixtureDir, "input.json");
  const raw = JSON.parse(readFileSync(inputPath, "utf8")) as {
    fixtureId: string;
    state: SessionState;
    turns: GoldenFixtureInput["turns"];
  };
  return { fixtureId: raw.fixtureId, state: raw.state, turns: raw.turns };
}

export function loadExpectedPlans(fixtureDir: string): GoldenExpectedPlan[] {
  const p = join(fixtureDir, "expected-plan.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as GoldenExpectedPlan[];
}

export function loadExpectedModes(fixtureDir: string): GoldenExpectedMode[] {
  const p = join(fixtureDir, "expected-mode.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as GoldenExpectedMode[];
}

export function loadExpectedRuntime(fixtureDir: string): GoldenExpectedRuntime[] {
  const p = join(fixtureDir, "expected-runtime.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as GoldenExpectedRuntime[];
}

export function replayFixture(fixture: GoldenFixtureInput): {
  outputs: ReturnType<typeof runRuntimePipeline>[];
  diffs: ReplayDiff[];
} {
  let state = structuredClone(fixture.state);
  const outputs: ReturnType<typeof runRuntimePipeline>[] = [];
  const runtimeCtx = { runtimeMode: "full" as const, consecutiveAdherenceFailures: 0 };

  fixture.turns.forEach((turn, turnIndex) => {
    state = {
      ...state,
      chatHistory: [
        ...state.chatHistory,
        { role: "user", content: turn.userMessage },
      ],
    };
    const out = runRuntimePipeline({
      state,
      userMessage: turn.userMessage,
      llmResult: turn.llmResult,
      turnIndex,
      runtimeCtx,
    });
    outputs.push(out);
    state = {
      ...state,
      chatHistory: [
        ...state.chatHistory,
        {
          role: "assistant",
          content: [out.mirror, out.coachQuestion].filter(Boolean).join("\n"),
        },
      ],
      coachContext: {
        ...state.coachContext,
        lastQuestion: out.coachQuestion,
        exploreRound: (state.coachContext?.exploreRound ?? 0) + 1,
      },
    };
  });

  return { outputs, diffs: [] };
}

export function diffFixtureReplay(
  fixtureDir: string,
): ReplayDiff[] {
  const fixture = loadFixtureDir(fixtureDir);
  const { outputs } = replayFixture(fixture);
  const diffs: ReplayDiff[] = [];

  for (const exp of loadExpectedPlans(fixtureDir)) {
    const out = outputs[exp.turnIndex];
    if (!out) {
      diffs.push({
        fixtureId: fixture.fixtureId,
        turnIndex: exp.turnIndex,
        field: "plan.action",
        expected: exp.action,
        actual: undefined,
      });
      continue;
    }
    if (out.plan.action !== exp.action) {
      diffs.push({
        fixtureId: fixture.fixtureId,
        turnIndex: exp.turnIndex,
        field: "plan.action",
        expected: exp.action,
        actual: out.plan.action,
      });
    }
    if (exp.primaryGap !== undefined && out.plan.primaryGap !== exp.primaryGap) {
      diffs.push({
        fixtureId: fixture.fixtureId,
        turnIndex: exp.turnIndex,
        field: "plan.primaryGap",
        expected: exp.primaryGap,
        actual: out.plan.primaryGap ?? null,
      });
    }
  }

  for (const exp of loadExpectedModes(fixtureDir)) {
    const out = outputs[exp.turnIndex];
    if (out && out.runtimeMode !== exp.runtimeMode) {
      diffs.push({
        fixtureId: fixture.fixtureId,
        turnIndex: exp.turnIndex,
        field: "runtimeMode",
        expected: exp.runtimeMode,
        actual: out.runtimeMode,
      });
    }
  }

  for (const exp of loadExpectedRuntime(fixtureDir)) {
    const out = outputs[exp.turnIndex];
    if (!out) continue;
    if (exp.readyToFinalize !== undefined) {
      const actual = out.trace.coachingSignals.readyToFinalize;
      if (actual !== exp.readyToFinalize) {
        diffs.push({
          fixtureId: fixture.fixtureId,
          turnIndex: exp.turnIndex,
          field: "coaching.readyToFinalize",
          expected: exp.readyToFinalize,
          actual,
        });
      }
    }
    if (exp.fatigueHigh !== undefined) {
      const actual = out.trace.fatigueSignals.fatigueHigh;
      if (actual !== exp.fatigueHigh) {
        diffs.push({
          fixtureId: fixture.fixtureId,
          turnIndex: exp.turnIndex,
          field: "engagement.fatigueHigh",
          expected: exp.fatigueHigh,
          actual,
        });
      }
    }
  }

  const expectedTracePath = join(fixtureDir, "expected-trace.json");
  if (existsSync(expectedTracePath)) {
    const expected = JSON.parse(readFileSync(expectedTracePath, "utf8")) as {
      turnIndex: number;
      arbitrationDecision: { action: string };
    }[];
    for (const exp of expected) {
      const out = outputs[exp.turnIndex];
      if (!out) continue;
      if (!validateCoachTurnTrace(out.trace)) {
        diffs.push({
          fixtureId: fixture.fixtureId,
          turnIndex: exp.turnIndex,
          field: "trace.valid",
          expected: true,
          actual: false,
        });
      } else if (out.trace.arbitrationDecision.action !== exp.arbitrationDecision.action) {
        diffs.push({
          fixtureId: fixture.fixtureId,
          turnIndex: exp.turnIndex,
          field: "trace.arbitrationDecision.action",
          expected: exp.arbitrationDecision.action,
          actual: out.trace.arbitrationDecision.action,
        });
      }
    }
  }

  return diffs;
}

export function replayAllFixtures(baseDir: string): ReplayDiff[] {
  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(baseDir, d.name));
  return dirs.flatMap((d) => diffFixtureReplay(d));
}
