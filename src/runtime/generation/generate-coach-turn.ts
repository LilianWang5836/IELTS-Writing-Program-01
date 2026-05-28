import type { ArbitratedTurnPlan } from "../types";
import type { LlmTurnResult } from "@/lib/domain/types";
import {
  buildDeterministicCoachQuestion,
  buildDeterministicMirror,
  finalizeHandoffReviewAsk,
} from "../mode/deterministic-templates";

export function generateCoachTurn(
  plan: ArbitratedTurnPlan,
  llmResult?: Partial<LlmTurnResult>,
  options?: { forceDeterministic?: boolean },
): { mirror: string; coachQuestion: string; enforcedBy: "llm" | "generateCoachTurn" } {
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

  if (options?.forceDeterministic || plan.questionTemplate) {
    return {
      mirror: buildDeterministicMirror(llmResult?.mirror),
      coachQuestion:
        plan.questionTemplate ??
        buildDeterministicCoachQuestion(plan.primaryGap ?? null),
      enforcedBy: "generateCoachTurn",
    };
  }

  const mirror = llmResult?.mirror?.trim() || buildDeterministicMirror();
  const coachQuestion =
    llmResult?.coachQuestion?.trim() ||
    plan.questionTemplate ||
    buildDeterministicCoachQuestion(plan.primaryGap ?? null);

  return {
    mirror,
    coachQuestion,
    enforcedBy: llmResult?.coachQuestion ? "llm" : "generateCoachTurn",
  };
}
