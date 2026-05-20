import type { LlmTurnResult, SessionState } from "@/lib/domain/types";

/** 是否允许本轮回合推进流程 */
export function shouldAdvance(
  state: SessionState,
  prevSubStep: SessionState["subStep"],
  result: LlmTurnResult,
): boolean {
  if (result.advance === false) return false;
  if (result.advance === true) return true;

  // Stage 1 聊天探索：永不因 LLM 自动推进（仅 submit_handoff）
  if (prevSubStep === "S1_EVAL") return false;

  // Stage 3.2：句子 pass 不直接跳 module（需确认写入）
  if (prevSubStep === "S3_2_MODULE" && result.verdict === "pass") {
    return false;
  }

  // Stage 3.1：生成 blueprint 后自动进入 assign
  if (prevSubStep === "S3_1_BLUEPRINT") {
    return result.verdict === "assign" || result.verdict === "pass";
  }

  // 默认：pass 可推进；coach/fail/assign 不推进（assign 在 S3.2 不切步）
  if (result.verdict === "pass") return true;
  return false;
}

export function markerWhenAdvance(
  prevSubStep: SessionState["subStep"],
  result: LlmTurnResult,
  advance: boolean,
): boolean {
  return advance && (result.verdict === "pass" || result.advance === true);
}
