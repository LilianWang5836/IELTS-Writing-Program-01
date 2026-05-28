import type {
  CoachRuntimeMode,
  PlanAdherenceReport,
  RuntimeHealth,
} from "../types";

export interface RuntimeModeContext {
  runtimeMode?: CoachRuntimeMode;
  consecutiveAdherenceFailures?: number;
  envOverride?: CoachRuntimeMode;
}

export function assessRuntimeHealth(ctx: RuntimeModeContext): RuntimeHealth {
  return {
    adherenceFailures: ctx.consecutiveAdherenceFailures ?? 0,
    arbitrationConflict: false,
    traceConsistent: true,
    hardFailure: false,
  };
}

export function resolveCoachRuntimeMode(
  ctx: RuntimeModeContext,
  health: RuntimeHealth,
): CoachRuntimeMode {
  if (ctx.envOverride) return ctx.envOverride;
  if (process.env.COACH_RUNTIME_MODE === "deterministic") return "deterministic";
  if (process.env.COACH_RUNTIME_MODE === "legacy") return "legacy";
  if (health.hardFailure) return "legacy";
  if (health.adherenceFailures >= 2 || health.arbitrationConflict) {
    return "deterministic";
  }
  if (!health.traceConsistent) return "deterministic";
  return ctx.runtimeMode ?? "full";
}

export function maybeDegradeRuntimeMode(
  ctx: RuntimeModeContext,
  adherence: PlanAdherenceReport,
): { mode: CoachRuntimeMode; transitionReason?: string } {
  const failures = adherence.adherent
    ? 0
    : (ctx.consecutiveAdherenceFailures ?? 0) + 1;

  if (failures >= 2) {
    return { mode: "deterministic", transitionReason: "adherence_collapse" };
  }
  return { mode: ctx.runtimeMode ?? "full" };
}

export function recordAdherenceFailureCount(
  ctx: RuntimeModeContext,
  adherence: PlanAdherenceReport,
): number {
  if (adherence.adherent) return 0;
  return (ctx.consecutiveAdherenceFailures ?? 0) + 1;
}
