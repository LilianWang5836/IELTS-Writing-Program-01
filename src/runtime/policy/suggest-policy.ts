import type { CoachRuntimeMode, PolicyPreference, CoachWorldState } from "../types";

export function suggestStage1PolicyPreference(
  world: CoachWorldState,
): PolicyPreference {
  const c = world.coaching;
  if (c.readyToFinalize) {
    return {
      objective: "confirm_structure",
      discourseShape: "none",
      intervention: "finalize_prompt",
      refinementVeto: c.refinementCandidate,
      vetoReason: c.refinementCandidate ? "分论点仍可更具体" : "",
      allowCompoundMove: false,
      intentHint: "确认结构并整理六栏",
      confidence: 0.8,
    };
  }
  if (c.concessionCoverage === "weak" && c.themesComplete) {
    return {
      objective: "improve_argument_balance",
      discourseShape: "concession",
      intervention: "guided_probe",
      allowCompoundMove: false,
      intentHint: "承认已说坏处，引导是否可控或可补救",
      confidence: 0.85,
    };
  }
  if (c.benefitDepth === "missing" || c.drawbackDepth === "missing") {
    return {
      objective: "collect_missing_side",
      discourseShape: "none",
      intervention: "guided_probe",
      allowCompoundMove: false,
      intentHint: "补齐尚未覆盖的利弊一侧",
      confidence: 0.75,
    };
  }
  return {
    objective: "deepen_mechanism",
    discourseShape: "causal_chain",
    intervention: "guided_probe",
    allowCompoundMove: false,
    intentHint: "追问谁→变化→结果",
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
      ? `针对 ${gap} 补一句具体论证`
      : "确认本分论点论证已齐",
    confidence: 0.85,
  };
}

export function suggestPolicyPreference(world: CoachWorldState): PolicyPreference {
  if (world.subStep === "S1_EVAL") {
    return suggestStage1PolicyPreference(world);
  }
  return suggestStage2PolicyPreference(world);
}
