import type {
  ArbitratedTurnPlan,
  CoachRuntimeMode,
  CoachTurnTrace,
  CoachWorldState,
  EngagementSignals,
  FinalizeDecision,
  PhaseGateResult,
  PlanAdherenceReport,
  PolicyPreference,
  RuntimeModeTransition,
} from "../types";
import { COACH_TRACE_SCHEMA_VERSION } from "../types";

export function createTurnTraceId(sessionId: string, turnIndex: number): string {
  return `${sessionId}:turn:${turnIndex}`;
}

export function buildCoachTurnTrace(input: {
  sessionId: string;
  turnIndex: number;
  subStep: string;
  runtimeMode: CoachRuntimeMode;
  world: CoachWorldState;
  phaseGate?: PhaseGateResult;
  finalizeDecision?: FinalizeDecision;
  policyPreference?: PolicyPreference;
  arbitrationDecision: ArbitratedTurnPlan;
  generatedPlan: ArbitratedTurnPlan;
  modelProfileId?: string;
  adherenceReport?: PlanAdherenceReport;
  runtimeTransition?: RuntimeModeTransition;
  llmRaw?: { mirror?: string; coachQuestion?: string };
  guardrailActions?: string[];
  finalOutput?: { mirror: string; coachQuestion: string };
}): CoachTurnTrace {
  const fatigueSignals: EngagementSignals = { ...input.world.engagement };
  return {
    schemaVersion: COACH_TRACE_SCHEMA_VERSION,
    turnId: createTurnTraceId(input.sessionId, input.turnIndex),
    timestamp: new Date().toISOString(),
    subStep: input.subStep,
    runtimeMode: input.runtimeMode,
    rawSignals: input.world.semantic,
    discourseSignals: input.world.discourse,
    coachingSignals: input.world.coaching,
    fatigueSignals,
    phaseGate: input.phaseGate,
    finalizeDecision: input.finalizeDecision,
    policyPreference: input.policyPreference,
    arbitrationDecision: input.arbitrationDecision,
    modelProfile: input.modelProfileId,
    generatedPlan: input.generatedPlan,
    adherenceReport: input.adherenceReport,
    runtimeTransition: input.runtimeTransition,
    llmRaw: input.llmRaw,
    guardrailActions: input.guardrailActions,
    finalOutput: input.finalOutput,
  };
}

const REQUIRED_KEYS: (keyof CoachTurnTrace)[] = [
  "schemaVersion",
  "turnId",
  "timestamp",
  "subStep",
  "runtimeMode",
  "rawSignals",
  "discourseSignals",
  "coachingSignals",
  "fatigueSignals",
  "arbitrationDecision",
  "generatedPlan",
];

/** Backward replay: unknown future fields are ignored; missing required fields fail. */
export function validateCoachTurnTrace(trace: unknown): trace is CoachTurnTrace {
  if (!trace || typeof trace !== "object") return false;
  const t = trace as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (!(key in t)) return false;
  }
  if (typeof t.schemaVersion !== "number") return false;
  if (typeof t.turnId !== "string") return false;
  return true;
}
