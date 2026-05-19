import type { SessionState } from "./types";

export function getStepHint(state: SessionState, requiresConfirm: boolean): string {
  if (requiresConfirm) {
    return "→ 请点击右侧绿色按钮「确认写入」，不要再次点提交。";
  }

  switch (state.subStep) {
    case "S1_EVAL":
      return "→ 请一次说清楚：题型 + 题目任务 + 你的总体判断（可部分同意）。例：Agree/Disagree 题，我部分同意因为…";
    case "S2_1_SUBPOINTS":
      return "→ 写出 Body1、Body2 两个分论点（各一句即可）。";
    case "S2_2_BODY1":
      return "→ 用「因为…所以…例如…」补全 Body1 论证链。";
    case "S2_3_BODY2":
      return "→ 同样方式补全 Body2 论证链。";
    case "S3_2_MODULE":
      if (state.s3?.mode === "assign") {
        return "→ 按教练要求写一句话，点「提交」。";
      }
      return "→ 根据反馈修改后重新提交。";
    default:
      return "";
  }
}
