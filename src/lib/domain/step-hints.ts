import { handoffProgress } from "./handoff";
import type { SessionState } from "./types";

export function getStepHint(state: SessionState, requiresConfirm: boolean): string {
  // 注意：「确认写入」按钮已下线，stabilizable / refine_needed 改为自动写入。
  // 仍保留 requiresConfirm 分支兜底（兼容旧 persist），但提示语不再要求点击按钮。
  if (requiresConfirm) {
    return "→ 这一句可以写入，刷新页面或继续写下一句即可。";
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
    case "S2_4_CONCLUSION":
      return "→ 用一句中文写出你的最终立场（结论段只做这一件事）。";
    case "S3_2_MODULE":
      if (state.s3?.mode === "assign") {
        return "→ 按教练要求写一句英文，点「提交」；一次只写一句。";
      }
      if (state.s3?.mode === "feedback") {
        return "→ 已自动写入，请继续写下一句。";
      }
      if (state.s3?.mode === "coach") {
        return "→ 根据中文修复问句改本句后重新提交（一次只修一个问题）。";
      }
      return "→ 写一句英文或按反馈修改后提交。";
    default:
      return "";
  }
}
