import type { DiscourseSignals, SemanticFeatures } from "../types";

function depthFromCount(n: number): "missing" | "weak" | "adequate" {
  if (n <= 0) return "missing";
  if (n === 1) return "weak";
  return "adequate";
}

function partialFromScore(score: number): "missing" | "partial" | "adequate" {
  if (score <= 0) return "missing";
  if (score < 0.65) return "partial";
  return "adequate";
}

export function interpretDiscourseSignals(
  semantic: SemanticFeatures,
  opts?: {
    userTurnFunctionCount?: number;
    causalScore?: number;
    groundingScore?: number;
    closureScore?: number;
  },
): DiscourseSignals {
  const stanceClarity = semantic.hasStance
    ? semantic.stanceMarkers.length >= 2
      ? "clear"
      : "weak"
    : "missing";

  let argumentBalance: DiscourseSignals["argumentBalance"] = "unknown";
  if (semantic.benefitCount >= 1 && semantic.drawbackCount >= 1) {
    argumentBalance = "balanced";
  } else if (semantic.benefitCount >= 1 || semantic.drawbackCount >= 1) {
    argumentBalance = "one_sided";
  }

  const concessionQuality = semantic.hasConcession
    ? semantic.concessionMarkers.some((m) =>
        /可控|补救|规范|限制|mitigat/i.test(m),
      )
      ? "adequate"
      : "weak"
    : "missing";

  const elaborationDepth = depthFromCount(
    semantic.causalMarkers.length + semantic.exampleMarkers.length,
  );

  return {
    stanceClarity,
    argumentBalance,
    concessionQuality,
    elaborationDepth,
    causalStrength: partialFromScore(
      opts?.causalScore ?? (semantic.causalMarkers.length > 0 ? 0.5 : 0),
    ),
    exampleDepth: partialFromScore(
      opts?.groundingScore ?? (semantic.exampleCount > 0 ? 0.5 : 0),
    ),
    coherenceRisk:
      semantic.genericPhrases.length >= 2 && semantic.responseWordCount < 12
        ? "high"
        : semantic.genericPhrases.length >= 1
          ? "medium"
          : "low",
    topicCoverage: "partial",
    reasonSpecificity:
      semantic.genericPhrases.length > 0 && semantic.causalMarkers.length === 0
        ? "generic"
        : "specific",
    userTurnFunctionCount: opts?.userTurnFunctionCount ?? 0,
  };
}
