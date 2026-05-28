import type { SessionState } from "@/lib/domain/types";
import { arbitrateTurnDecision } from "../arbitration/arbitrate-turn";
import {
  resolveFinalizeDecision,
  resolvePhaseGate,
} from "../arbitration/finalize-decision";
import {
  getModelCapabilityProfile,
  simplifyPlanForModel,
} from "../model/capability-profile";
import {
  assessRuntimeHealth,
  resolveCoachRuntimeMode,
  type RuntimeModeContext,
} from "../mode/resolve-runtime-mode";
import { suggestPolicyPreference } from "../policy/suggest-policy";
import type { ArbitratedTurnPlan } from "../types";
import { buildCoachWorldState } from "../world/coach-world-state";

/** Resolve arbitrated plan before LLM call (no generation). */
export function resolveCoachTurnPlan(
  state: SessionState,
  userMessage: string,
  options?: {
    body?: "body1" | "body2";
    runtimeCtx?: RuntimeModeContext;
  },
): ArbitratedTurnPlan {
  const health = assessRuntimeHealth(options?.runtimeCtx ?? {});
  const runtimeMode = resolveCoachRuntimeMode(options?.runtimeCtx ?? {}, health);
  const world = buildCoachWorldState(state, userMessage, { body: options?.body });
  const phaseGate = resolvePhaseGate(world);
  const finalizeDecision = resolveFinalizeDecision(world.coaching, phaseGate);

  if (runtimeMode === "deterministic") {
    return simplifyPlanForModel(
      arbitrateTurnDecision({
        world,
        policyPreference: {
          objective: "none",
          discourseShape: "none",
          intervention: "guided_probe",
          allowCompoundMove: false,
          intentHint: "",
        },
        phaseGate,
        finalizeDecision,
      }),
      getModelCapabilityProfile(),
    );
  }

  const policyPreference = suggestPolicyPreference(world);
  const plan = arbitrateTurnDecision({
    world,
    policyPreference,
    phaseGate,
    finalizeDecision,
  });
  return simplifyPlanForModel(plan, getModelCapabilityProfile());
}

export function summarizeCoachingSignalsForPrompt(
  state: SessionState,
  userMessage: string,
  body?: "body1" | "body2",
): string {
  const world = buildCoachWorldState(state, userMessage, { body });
  const c = world.coaching;
  return JSON.stringify({
    readyToFinalize: c.readyToFinalize,
    themesComplete: c.themesComplete,
    primaryGap: c.primaryGap,
    gapStrength: c.gapStrength,
    concessionCoverage: c.concessionCoverage,
    positionLean: c.positionLean,
    topicAnchor: c.topicAnchor,
  });
}
