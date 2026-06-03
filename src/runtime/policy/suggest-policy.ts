import type { SessionState } from "@/lib/domain/types";
import {
  decideStage1Plan,
  formatStage1PlanIntentHint,
} from "@/lib/domain/stage1-plan";
import type { CoachWorldState, PolicyPreference } from "../types";

function policyFromStage1Plan(state: SessionState): PolicyPreference {
  const action = decideStage1Plan(state);
  const intentHint = formatStage1PlanIntentHint(action, state);

  if (action === "finalize") {
    return {
      objective: "confirm_structure",
      discourseShape: "none",
      intervention: "finalize_prompt",
      allowCompoundMove: false,
      intentHint,
      confidence: 0.9,
    };
  }
  if (action === "collect_drawback") {
    return {
      objective: "collect_missing_side",
      discourseShape: "none",
      intervention: "guided_probe",
      allowCompoundMove: false,
      intentHint,
      confidence: 0.85,
    };
  }
  return {
    objective: "collect_benefit_clarification",
    discourseShape: "none",
    intervention: "guided_probe",
    allowCompoundMove: false,
    intentHint,
    confidence: 0.85,
  };
}

export function suggestStage1PolicyPreference(
  world: CoachWorldState,
  state?: SessionState,
  _userMessages?: string[],
): PolicyPreference {
  if (state) {
    return policyFromStage1Plan(state);
  }

  if (world.coaching.readyToFinalize) {
    return {
      objective: "confirm_structure",
      discourseShape: "none",
      intervention: "finalize_prompt",
      allowCompoundMove: false,
      intentHint: JSON.stringify({
        stage1PlanAction: "finalize",
        gapType: "confirm_structure",
      }),
      confidence: 0.8,
    };
  }

  const missingBenefit = world.coaching.benefitDepth === "missing";
  return {
    objective: missingBenefit ? "collect_benefit_clarification" : "collect_missing_side",
    discourseShape: "none",
    intervention: "guided_probe",
    allowCompoundMove: false,
    intentHint: JSON.stringify({
      stage1PlanAction: missingBenefit ? "collect_benefit" : "collect_drawback",
      gapType: missingBenefit ? "collect_benefit" : "collect_drawback",
    }),
    confidence: 0.75,
  };
}

export function suggestStage2PolicyPreference(
  world: CoachWorldState,
): PolicyPreference {
  const gap = world.coaching.primaryGap;
  const objective =
    gap === "causal"
      ? "deepen_mechanism"
      : gap === "grounding"
        ? "add_grounding"
        : gap === "closure"
          ? "close_paragraph"
          : "confirm_structure";

  const discourseShape =
    gap === "causal"
      ? "causal_chain"
      : gap === "grounding"
        ? "example_scene"
        : gap === "closure"
          ? "closure"
          : "none";

  return {
    objective,
    discourseShape,
    intervention: world.coaching.gapStrength === "partial" ? "guided_refinement" : "guided_probe",
    allowCompoundMove: world.discourse.userTurnFunctionCount >= 2,
    intentHint: gap
      ? JSON.stringify({ gapType: gap, stage: "stage2" })
      : JSON.stringify({ gapType: "none", stage: "stage2" }),
    confidence: 0.85,
  };
}

export function suggestPolicyPreference(
  world: CoachWorldState,
  context?: { state?: SessionState; userMessages?: string[] },
): PolicyPreference {
  if (world.subStep === "S1_EVAL") {
    return suggestStage1PolicyPreference(
      world,
      context?.state,
      context?.userMessages,
    );
  }
  return suggestStage2PolicyPreference(world);
}
