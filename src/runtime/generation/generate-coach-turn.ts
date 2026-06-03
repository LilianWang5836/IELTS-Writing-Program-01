import type { ArbitratedTurnPlan } from "../types";
import type { LlmTurnResult } from "@/lib/domain/types";
import {
  parseStage1PlanAction,
  stage1PlanQuestion,
} from "@/lib/domain/stage1-plan";
import {
  buildDeterministicCoachQuestion,
  buildDeterministicMirror,
  finalizeHandoffReviewAsk,
} from "../mode/deterministic-templates";

function stage1QuestionFromPlan(plan: ArbitratedTurnPlan): string | null {
  const action = parseStage1PlanAction(plan.intentHint ?? "");
  if (action) return stage1PlanQuestion(action);
  return null;
}

export function generateCoachTurn(
  plan: ArbitratedTurnPlan,
  llmResult?: Partial<LlmTurnResult>,
  options?: { forceDeterministic?: boolean },
): { mirror: string; coachQuestion: string; enforcedBy: "llm" | "generateCoachTurn" } {
  const stage1Question = stage1QuestionFromPlan(plan);

  if (plan.action === "finalize") {
    return {
      mirror: llmResult?.mirror?.trim() || "结构已经比较清楚了，我来帮你整理一版。",
      coachQuestion: plan.questionTemplate?.trim() || finalizeHandoffReviewAsk(),
      enforcedBy: "generateCoachTurn",
    };
  }

  if (plan.action === "blocked") {
    return {
      mirror: "这一步暂时无法继续，请先看左侧进度。",
      coachQuestion: "",
      enforcedBy: "generateCoachTurn",
    };
  }

  // Stage1: system owns the question; LLM only supplies mirror tone.
  if (stage1Question) {
    return {
      mirror: llmResult?.mirror?.trim() || buildDeterministicMirror(),
      coachQuestion: plan.questionTemplate?.trim() || stage1Question,
      enforcedBy: "generateCoachTurn",
    };
  }

  if (options?.forceDeterministic || plan.questionTemplate) {
    return {
      mirror: buildDeterministicMirror(llmResult?.mirror),
      coachQuestion:
        plan.questionTemplate ??
        buildDeterministicCoachQuestion(plan.primaryGap ?? null),
      enforcedBy: "generateCoachTurn",
    };
  }

  return {
    mirror: llmResult?.mirror?.trim() || buildDeterministicMirror(),
    coachQuestion:
      plan.questionTemplate ||
      buildDeterministicCoachQuestion(plan.primaryGap ?? null),
    enforcedBy: "generateCoachTurn",
  };
}
