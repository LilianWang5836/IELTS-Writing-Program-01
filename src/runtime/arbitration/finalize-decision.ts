import type { CoachWorldState, FinalizeDecision, PhaseGateResult } from "../types";

export function resolvePhaseGate(world: CoachWorldState): PhaseGateResult {
  if (!world.phaseLegal) {
    return { legal: false, reason: "substep_not_coachable" };
  }
  if (world.handoffPhase === "locked") {
    return { legal: false, reason: "handoff_locked" };
  }
  if (world.chainPhase === "locked") {
    return { legal: false, reason: "chain_locked" };
  }
  return { legal: true };
}

export function resolveFinalizeDecision(
  coaching: CoachWorldState["coaching"],
  phaseGate: PhaseGateResult,
): FinalizeDecision {
  if (!phaseGate.legal) {
    return { defaultFinalize: false, canPropose: false };
  }
  return {
    defaultFinalize: coaching.readyToFinalize || coaching.discourseReady,
    canPropose:
      coaching.contentReady ||
      coaching.discourseReady ||
      coaching.readyToFinalize,
  };
}
