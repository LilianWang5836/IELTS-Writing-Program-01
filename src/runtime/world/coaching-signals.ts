import { isStage1Complete } from "@/lib/domain/stage1-complete";
import { assessExplorationContent } from "@/lib/domain/essay-substance";
import {
  extractExplorationThemes,
  isPointSpecificEnough,
} from "@/lib/domain/stage1-exploration-themes";
import {
  hasConcreteBenefitConcepts,
  hasConcreteDrawbackConcepts,
} from "@/lib/domain/stage1-coach-gap";
import { getNextNeed, type CoverageState } from "@/lib/domain/chain-discourse";
import type { SessionState } from "@/lib/domain/types";
import type { CoachingSignals, DiscourseSignals, PrimaryGap } from "../types";

function depthLabel(ok: boolean, weak: boolean): "missing" | "weak" | "adequate" {
  if (ok) return "adequate";
  if (weak) return "weak";
  return "missing";
}

function mapNeedToGap(need: ReturnType<typeof getNextNeed>): PrimaryGap {
  if (need === "causal") return "causal";
  if (need === "grounding") return "grounding";
  if (need === "closure") return "closure";
  return null;
}

function gapStrengthFromCoverage(
  gap: PrimaryGap,
  coverage: CoverageState,
): "missing" | "partial" | "adequate" {
  if (!gap) return "adequate";
  const score = coverage[gap];
  if (score <= 0) return "missing";
  if (score < 0.65) return "partial";
  return "adequate";
}

export function deriveCoachingSignalsStage1(
  state: SessionState,
  userMessages: string[],
  discourse: DiscourseSignals,
): Partial<CoachingSignals> {
  const themes = extractExplorationThemes(state, userMessages);
  const substance = assessExplorationContent(state, userMessages[userMessages.length - 1]);
  const explorationComplete = isStage1Complete(state, userMessages);

  const benefitDepth = depthLabel(
    hasConcreteBenefitConcepts(themes.benefits),
    false,
  );
  const drawbackDepth = depthLabel(
    hasConcreteDrawbackConcepts(themes.drawbacks),
    themes.drawbacks.length === 1 && themes.drawbacks[0].length < 12,
  );

  const body1Text = state.handoff?.body1Point ?? "";
  const body2Text = state.handoff?.body2Point ?? "";

  const bodyPointDepth = {
    body1: depthLabel(
      isPointSpecificEnough(body1Text),
      body1Text.trim().length >= 8,
    ),
    body2: depthLabel(
      isPointSpecificEnough(body2Text),
      body2Text.trim().length >= 8,
    ),
  };

  const refinementCandidate =
    !explorationComplete &&
    (bodyPointDepth.body1 === "weak" ||
      bodyPointDepth.body2 === "weak" ||
      discourse.elaborationDepth === "weak");

  return {
    readyToFinalize: explorationComplete || themes.readyToFinalize,
    themesComplete: explorationComplete || themes.themesComplete,
    contentReady: substance.contentReady ?? false,
    positionLean: themes.positionLean,
    benefitDepth,
    drawbackDepth,
    bodyPointDepth,
    concessionCoverage: discourse.concessionQuality,
    rewriteRisk: "low",
    refinementCandidate,
    currentNeed: themes.readyToFinalize ? "ready" : "claim",
    primaryGap: null,
    gapStrength: "missing",
    discourseReady: false,
    topicAnchor: state.topic ?? "",
  };
}

export function deriveCoachingSignalsStage2(
  state: SessionState,
  body: "body1" | "body2",
  coverage: CoverageState,
  discourseReady: boolean,
): Partial<CoachingSignals> {
  const need = getNextNeed(coverage);
  const primaryGap = mapNeedToGap(need);
  const anchor =
    body === "body1"
      ? `${state.s2?.body1Point ?? ""} · ${state.s2?.body1Angle ?? ""}`
      : `${state.s2?.body2Point ?? ""} · ${state.s2?.body2Angle ?? ""}`;

  return {
    readyToFinalize: discourseReady,
    themesComplete: false,
    contentReady: discourseReady,
    positionLean: "unknown",
    benefitDepth: "missing",
    drawbackDepth: "missing",
    bodyPointDepth: { body1: "adequate", body2: "adequate" },
    concessionCoverage: "missing",
    rewriteRisk: "low",
    refinementCandidate: false,
    currentNeed: need === "claim" ? "causal" : need,
    primaryGap,
    gapStrength: gapStrengthFromCoverage(primaryGap, coverage),
    discourseReady,
    topicAnchor: anchor.trim(),
  };
}

export function emptyCoachingSignals(): CoachingSignals {
  return {
    readyToFinalize: false,
    themesComplete: false,
    contentReady: false,
    positionLean: "unknown",
    benefitDepth: "missing",
    drawbackDepth: "missing",
    bodyPointDepth: { body1: "missing", body2: "missing" },
    concessionCoverage: "missing",
    rewriteRisk: "low",
    refinementCandidate: false,
    currentNeed: "claim",
    primaryGap: null,
    gapStrength: "missing",
    discourseReady: false,
    topicAnchor: "",
  };
}

export function mergeCoachingSignals(
  base: CoachingSignals,
  partial: Partial<CoachingSignals>,
): CoachingSignals {
  return { ...base, ...partial };
}
