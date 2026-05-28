import type { ArbitratedTurnPlan, ModelCapabilityProfile } from "../types";

const DEFAULT_PROFILE: ModelCapabilityProfile = {
  modelId: "default",
  planAdherenceTier: "high",
  abstractionTolerance: "full",
  maxIntentHintLength: 120,
  requiresHardFinalizeEnforcement: true,
  adherenceThreshold: 0.85,
};

const PROFILES: Record<string, ModelCapabilityProfile> = {
  default: DEFAULT_PROFILE,
  low: {
    modelId: "low",
    planAdherenceTier: "low",
    abstractionTolerance: "minimal",
    maxIntentHintLength: 60,
    requiresHardFinalizeEnforcement: true,
    adherenceThreshold: 0.6,
  },
};

export function getModelCapabilityProfile(modelId?: string): ModelCapabilityProfile {
  const key = modelId ?? process.env.LLM_MODEL ?? "default";
  return PROFILES[key] ?? DEFAULT_PROFILE;
}

export function simplifyPlanForModel(
  plan: ArbitratedTurnPlan,
  profile: ModelCapabilityProfile,
): ArbitratedTurnPlan {
  if (profile.abstractionTolerance === "full") return plan;
  if (profile.abstractionTolerance === "reduced") {
    return {
      ...plan,
      intentHint: plan.intentHint.slice(0, profile.maxIntentHintLength),
    };
  }
  return {
    action: plan.action,
    objective: "none",
    discourseShape: "none",
    intervention: plan.action === "finalize" ? "none" : "guided_probe",
    allowCompoundMove: false,
    intentHint: plan.intentHint.slice(0, profile.maxIntentHintLength),
    primaryGap: plan.primaryGap,
    questionTemplate: plan.questionTemplate,
    decrementVetoBudget: plan.decrementVetoBudget,
    fatigueOverride: plan.fatigueOverride,
  };
}

export function serializeArbitratedPlan(plan: ArbitratedTurnPlan): string {
  return JSON.stringify(plan, null, 2);
}
