import type { PrimaryGap } from "../types";

const GAP_TEMPLATES: Record<Exclude<PrimaryGap, null>, string> = {
  causal: "能再说说谁做了什么、带来什么结果吗？",
  grounding: "能举一个具体例子或场景吗？",
  closure: "因此这对你的分论点意味着什么？",
};

export function gapQuestionTemplate(gap: PrimaryGap): string {
  if (!gap) return "能再具体一点吗？";
  return GAP_TEMPLATES[gap];
}

/** Deterministic mode: one gap, one question, no compound moves. */
export function buildDeterministicCoachQuestion(primaryGap: PrimaryGap): string {
  return gapQuestionTemplate(primaryGap);
}

export function buildDeterministicMirror(ack?: string): string {
  return ack?.trim() || "好的，我们继续把这个点说清楚。";
}

/** Stage1 finalize: handoff review before structural lock-in. */
export function finalizeHandoffReviewAsk(): string {
  return "六栏整理在左侧，请核对；若无异议点「确认整理并填入」。";
}
