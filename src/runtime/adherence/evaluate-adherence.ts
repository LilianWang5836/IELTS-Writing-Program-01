import type { ArbitratedTurnPlan, PlanAdherenceReport, PrimaryGap } from "../types";

const GAP_KEYWORDS: Record<Exclude<PrimaryGap, null>, RegExp> = {
  causal: /因为|导致|机制|谁|发生|结果|reason|why|cause/i,
  grounding: /比如|例如|举例|场景|例子|for example|such as/i,
  closure: /因此|所以|意味着|扣回|overall|thus/i,
};

function questionCount(text: string): number {
  return (text.match(/[？?]/g) ?? []).length || (text.trim() ? 1 : 0);
}

function matchesGap(question: string, gap: PrimaryGap): boolean {
  if (!gap) return true;
  const re = GAP_KEYWORDS[gap];
  return re.test(question);
}

export function evaluateAdherence(input: {
  plan: ArbitratedTurnPlan;
  mirror: string;
  coachQuestion: string;
}): PlanAdherenceReport {
  const { plan, coachQuestion } = input;
  const violations: string[] = [];
  const q = coachQuestion.trim();

  let finalizeAdherence = true;
  if (plan.action === "finalize") {
    const handoffReview = /六栏|核对|确认整理/.test(q);
    finalizeAdherence = q.length === 0 || handoffReview;
    if (!finalizeAdherence) violations.push("extra_question_on_finalize");
  }

  let primaryGapAdherence = true;
  if (plan.action === "coach" || plan.action === "one_refinement_turn") {
    if (plan.primaryGap && q.length > 0) {
      primaryGapAdherence = matchesGap(q, plan.primaryGap);
      if (!primaryGapAdherence) violations.push("wrong_gap");
    }
  }

  let questionCountAdherence = true;
  const count = questionCount(q);
  if (plan.action !== "finalize" && count > 1) {
    questionCountAdherence = false;
    violations.push("multiple_questions");
  }

  const noHiddenRefinement =
    plan.action !== "finalize" ||
    !/再展开|还有别的|更具体|another|more detail/i.test(q);

  if (!noHiddenRefinement) violations.push("hidden_refinement_on_finalize");

  const checks = [
    finalizeAdherence,
    primaryGapAdherence,
    questionCountAdherence,
    noHiddenRefinement,
  ];
  const passed = checks.filter(Boolean).length;
  const overallAdherence = passed / checks.length;

  return {
    adherent: violations.length === 0,
    finalizeAdherence,
    primaryGapAdherence,
    questionCountAdherence,
    noHiddenRefinement,
    overallAdherence,
    violations,
  };
}

export function aggregateAdherenceRates(
  reports: PlanAdherenceReport[],
): {
  finalizeRate: number;
  primaryGapRate: number;
  overallRate: number;
} {
  if (reports.length === 0) {
    return { finalizeRate: 1, primaryGapRate: 1, overallRate: 1 };
  }
  const n = reports.length;
  return {
    finalizeRate:
      reports.filter((r) => r.finalizeAdherence).length / n,
    primaryGapRate:
      reports.filter((r) => r.primaryGapAdherence).length / n,
    overallRate:
      reports.reduce((s, r) => s + r.overallAdherence, 0) / n,
  };
}

export const ADHERENCE_CI_TARGETS = {
  finalize: 0.95,
  primaryGap: 0.8,
  overall: 0.85,
} as const;

export function adherenceMeetsCiTargets(rates: {
  finalizeRate: number;
  primaryGapRate: number;
  overallRate: number;
}): boolean {
  return (
    rates.finalizeRate >= ADHERENCE_CI_TARGETS.finalize &&
    rates.primaryGapRate >= ADHERENCE_CI_TARGETS.primaryGap &&
    rates.overallRate >= ADHERENCE_CI_TARGETS.overall
  );
}
