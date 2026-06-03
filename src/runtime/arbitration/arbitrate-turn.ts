import type {
  ArbitratedTurnPlan,
  CoachWorldState,
  FinalizeDecision,
  PhaseGateResult,
  PolicyPreference,
  PrimaryGap,
} from "../types";
import {
  parseStage1PlanAction,
  stage1PlanQuestion,
} from "@/lib/domain/stage1-plan";
import {
  finalizeHandoffReviewAsk,
  gapQuestionTemplate,
} from "../mode/deterministic-templates";

/** Stage1: both Body directions ready — finalize must go through handoff review. */
function stage1DualBodyHandoffReady(world: CoachWorldState): boolean {
  if (world.subStep !== "S1_EVAL") return false;
  const c = world.coaching;
  return (
    c.readyToFinalize &&
    c.themesComplete &&
    c.benefitDepth !== "missing" &&
    c.drawbackDepth !== "missing" &&
    world.handoffPhase === "exploring"
  );
}

function defaultCoachPlan(
  world: CoachWorldState,
  policy: PolicyPreference,
): ArbitratedTurnPlan {
  const gap = world.coaching.primaryGap;
  const stage1Action = parseStage1PlanAction(policy.intentHint ?? "");
  const stage1Template =
    world.subStep === "S1_EVAL" && stage1Action
      ? stage1PlanQuestion(stage1Action)
      : undefined;
  return {
    action: "coach",
    objective: policy.objective,
    discourseShape: policy.discourseShape,
    intervention: policy.intervention,
    allowCompoundMove:
      world.subStep === "S1_EVAL" ? false : (policy.allowCompoundMove ?? false),
    intentHint: policy.intentHint ?? "",
    primaryGap: gap ?? undefined,
    questionTemplate:
      stage1Template ?? (gap ? gapQuestionTemplate(gap) : undefined),
  };
}

export function arbitrateTurnDecision(input: {
  world: CoachWorldState;
  policyPreference: PolicyPreference;
  phaseGate: PhaseGateResult;
  finalizeDecision: FinalizeDecision;
}): ArbitratedTurnPlan {
  const { world, policyPreference, phaseGate, finalizeDecision } = input;

  if (!phaseGate.legal) {
    return {
      action: "blocked",
      objective: "none",
      discourseShape: "none",
      intervention: "none",
      allowCompoundMove: false,
      intentHint: "",
    };
  }

  const fatigueBlocksVeto =
    world.engagement.fatigueHigh &&
    world.engagement.fatigueConfidence !== "uncertain";

  if (finalizeDecision.defaultFinalize && finalizeDecision.canPropose) {
    if (
      world.subStep !== "S1_EVAL" &&
      policyPreference.refinementVeto &&
      world.refinementVetoBudgetRemaining > 0 &&
      world.coaching.refinementCandidate &&
      !fatigueBlocksVeto
    ) {
      return {
        ...defaultCoachPlan(world, policyPreference),
        action: "one_refinement_turn",
        decrementVetoBudget: true,
      };
    }
    const handoffReview = stage1DualBodyHandoffReady(world);
    return {
      action: "finalize",
      objective: "confirm_structure",
      discourseShape: "none",
      intervention: handoffReview ? "handoff_review" : "finalize_prompt",
      allowCompoundMove: false,
      intentHint: handoffReview
        ? "handoff_review_before_finalize"
        : "结构已齐，整理提案",
      questionTemplate: handoffReview ? finalizeHandoffReviewAsk() : undefined,
      fatigueOverride: fatigueBlocksVeto && policyPreference.refinementVeto,
    };
  }

  if (world.subStep !== "S1_EVAL" && world.discourse.userTurnFunctionCount >= 2) {
    return {
      ...defaultCoachPlan(world, policyPreference),
      allowCompoundMove: true,
    };
  }

  return defaultCoachPlan(world, policyPreference);
}

export function mapStage1Gap(world: CoachWorldState): PrimaryGap {
  if (world.coaching.concessionCoverage === "weak") return null;
  return world.coaching.primaryGap;
}
