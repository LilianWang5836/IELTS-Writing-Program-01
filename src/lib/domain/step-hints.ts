import { handoffProgress } from "./handoff";
import type { SessionState } from "./types";

export function getStepHint(state: SessionState, requiresConfirm: boolean): string {
  if (requiresConfirm) {
    return "→ 请点击「确认写入」，不要再次点提交。";
  }

  switch (state.subStep) {
    case "S1_EVAL":
      if (!state.handoffLocked) {
        if (state.coachContext?.readyForHandoff) {
          return "→ 探索已够：请填左侧「审题定稿」四栏并点「提交审题定稿」，不必再在聊天重复。";
        }
        const { filled, total } = handoffProgress(
          state.handoff ?? {
            taskUnderstanding: "",
            position: "",
            body1Point: "",
            body1Angle: "",
            body2Point: "",
            body2Angle: "",
          },
        );
        return `→ 聊天探索审题；左侧定稿 ${filled}/${total} 栏，完成后点「提交审题定稿」。`;
      }
      return "";
    case "S2_2_BODY1":
      return "→ 写出 Body1 整段论证（可中文、可乱序）；教练会拆链条并追问缺口。";
    case "S2_3_BODY2":
      return "→ 写出 Body2 论证；注意与 Body1 不同角度。";
    case "S3_2_MODULE":
      if (state.s3?.mode === "assign") {
        return "→ 按教练要求写一句英文，点「提交」。";
      }
      if (state.s3?.mode === "coach") {
        return "→ 根据反馈修改本句后重新提交。";
      }
      return "→ 根据反馈修改后重新提交。";
    default:
      return "";
  }
}
