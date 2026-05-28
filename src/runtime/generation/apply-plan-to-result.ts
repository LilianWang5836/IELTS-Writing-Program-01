import type { LlmTurnResult } from "@/lib/domain/types";
import type { ArbitratedTurnPlan } from "../types";
import { generateCoachTurn } from "../generation/generate-coach-turn";

/**
 * Apply runtime plan to LLM coach fields (finalize strip, gap-aligned question).
 * Expression (mirror tone) may come from LLM; pedagogy from plan.
 */
export function applyArbitratedPlanToCoachResult(
  plan: ArbitratedTurnPlan,
  result: LlmTurnResult,
  options?: { forceDeterministic?: boolean },
): LlmTurnResult {
  const gen = generateCoachTurn(plan, result, {
    forceDeterministic: options?.forceDeterministic,
  });

  if (plan.action === "finalize") {
    return {
      ...result,
      coachQuestion: gen.coachQuestion,
      mirror: gen.mirror,
      essaySubstanceSufficient: result.essaySubstanceSufficient ?? true,
      paragraphSubstanceSufficient: result.paragraphSubstanceSufficient ?? true,
    };
  }

  if (plan.action === "blocked") {
    return {
      ...result,
      mirror: gen.mirror,
      coachQuestion: gen.coachQuestion,
    };
  }

  return {
    ...result,
    mirror: gen.mirror,
    coachQuestion: gen.coachQuestion,
  };
}

export function isRuntimePlanEnforcementEnabled(): boolean {
  return process.env.COACH_RUNTIME_PLAN_ENFORCE !== "false";
}
