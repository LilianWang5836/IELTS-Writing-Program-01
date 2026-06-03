import type { CoachWorldState, PolicyPreference } from "../types";
import {
  formatStage1IntentHint,
  resolveStage1CollectionGap,
  type Stage1CoachGap,
} from "@/lib/domain/stage1-coach-gap";
import type { SessionState } from "@/lib/domain/types";
import { extractExplorationThemes } from "@/lib/domain/stage1-exploration-themes";

function policyFromGap(
  gap: Stage1CoachGap,
  state: SessionState,
  themes: ReturnType<typeof extractExplorationThemes>,
): PolicyPreference {
  const intentHint = formatStage1IntentHint(gap, state, themes);

  switch (gap.gapType) {
    case "confirm_structure":
      return {
        objective: "confirm_structure",
        discourseShape: "none",
        intervention: "finalize_prompt",
        allowCompoundMove: false,
        intentHint,
        confidence: 0.85,
      };
    case "collect_benefit":
      return {
        objective: "collect_benefit_clarification",
        discourseShape: "none",
        intervention: "guided_probe",
        allowCompoundMove: false,
        intentHint,
        confidence: 0.85,
      };
    case "collect_drawback":
      return {
        objective: "collect_missing_side",
        discourseShape: "none",
        intervention: "guided_probe",
        allowCompoundMove: false,
        intentHint,
        confidence: 0.8,
      };
    case "collect_stance":
      return {
        objective: "collect_stance",
        discourseShape: "none",
        intervention: "guided_probe",
        allowCompoundMove: false,
        intentHint,
        confidence: 0.75,
      };
    case "deepen_body1":
    case "deepen_body2":
      return {
        objective: "deepen_mechanism",
        discourseShape: "causal_chain",
        intervention: "guided_refinement",
        allowCompoundMove: false,
        intentHint,
        confidence: 0.8,
      };
    default:
      return {
        objective: "deepen_mechanism",
        discourseShape: "causal_chain",
        intervention: "guided_probe",
        allowCompoundMove: false,
        intentHint,
        confidence: 0.7,
      };
  }
}

export function suggestStage1PolicyPreference(
  world: CoachWorldState,
  state?: SessionState,
  userMessages?: string[],
): PolicyPreference {
  const c = world.coaching;

  if (state && userMessages) {
    const themes = extractExplorationThemes(state, userMessages);
    const collectionGap = resolveStage1CollectionGap(themes);

    if (collectionGap.gapType !== "none") {
      const base = policyFromGap(collectionGap, state, themes);
      if (collectionGap.gapType === "confirm_structure") {
        return {
          ...base,
          refinementVeto: c.refinementCandidate,
          vetoReason: c.refinementCandidate ? "分论点仍可更具体" : "",
        };
      }
      return base;
    }

    if (c.themesComplete && !c.readyToFinalize) {
      const refineGap: Stage1CoachGap =
        c.bodyPointDepth.body1 !== "adequate"
          ? {
              gapType: "deepen_body1",
              action: "ask_refinement",
              targetBody: "body1",
              side:
                themes.positionLean === "pro" ||
                themes.positionLean === "balanced"
                  ? "benefit"
                  : "drawback",
            }
          : {
              gapType: "deepen_body2",
              action: "ask_refinement",
              targetBody: "body2",
              side:
                themes.positionLean === "pro" ||
                themes.positionLean === "balanced"
                  ? "drawback"
                  : "benefit",
            };
      return policyFromGap(refineGap, state, themes);
    }
  }

  if (c.readyToFinalize) {
    return {
      objective: "confirm_structure",
      discourseShape: "none",
      intervention: "finalize_prompt",
      refinementVeto: c.refinementCandidate,
      vetoReason: c.refinementCandidate ? "分论点仍可更具体" : "",
      allowCompoundMove: false,
      intentHint: formatStage1IntentHint(
        { gapType: "confirm_structure", action: "finalize" },
        state ?? ({ topic: world.coaching.topicAnchor } as SessionState),
        extractExplorationThemes(
          state ?? ({ coachContext: {} } as SessionState),
          userMessages ?? [],
        ),
      ),
      confidence: 0.8,
    };
  }
  if (c.concessionCoverage === "weak" && c.themesComplete) {
    return {
      objective: "improve_argument_balance",
      discourseShape: "concession",
      intervention: "guided_probe",
      allowCompoundMove: false,
      intentHint: JSON.stringify({ gapType: "concession_weak" }),
      confidence: 0.85,
    };
  }
  if (c.benefitDepth === "missing" || c.drawbackDepth === "missing") {
    return {
      objective: "collect_missing_side",
      discourseShape: "none",
      intervention: "guided_probe",
      allowCompoundMove: false,
      intentHint: JSON.stringify({
        gapType: c.benefitDepth === "missing" ? "collect_benefit" : "collect_drawback",
      }),
      confidence: 0.75,
    };
  }
  return {
    objective: "deepen_mechanism",
    discourseShape: "causal_chain",
    intervention: "guided_probe",
    allowCompoundMove: false,
    intentHint: JSON.stringify({ gapType: "none" }),
    confidence: 0.7,
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
