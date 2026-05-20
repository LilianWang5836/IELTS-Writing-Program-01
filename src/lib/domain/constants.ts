import type { HandoffFieldTarget } from "./types";

export const HANDOFF_FIELD_LABELS: Record<HandoffFieldTarget, string> = {
  taskUnderstanding: "① 题意",
  position: "② 立场",
  body1Point: "③ Body1 分论点",
  body1Angle: "④ Body1 角度",
  body2Point: "⑤ Body2 分论点",
  body2Angle: "⑥ Body2 角度",
};

export const HANDOFF_FIELD_ORDER: HandoffFieldTarget[] = [
  "taskUnderstanding",
  "position",
  "body1Point",
  "body1Angle",
  "body2Point",
  "body2Angle",
];

export const STAGE1_OPENING =
  "同学你好，题目已锁定。请在右侧和我聊审题；定稿请填左侧 6 栏并点「提交审题定稿」。先说说：这题属于什么题型？要你讨论什么？";

export const MARKERS = {
  STAGE_1_PASS: "[STAGE_1_PASS]",
  SUB_POINTS_PASS: "[SUB_POINTS_PASS]",
  SUB_BODY_1_PASS: "[SUB_BODY_1_PASS]",
  STAGE_2_PASS: "[STAGE_2_PASS]",
} as const;

export const MAX_USER_SENTENCE_WORDS = 45;

export const MODULE_LABELS: Record<string, string> = {
  claim: "Claim — 表达观点",
  reason: "Reason — 解释原因/机制",
  example: "Example — 现实支撑",
  impact: "Impact — 结果/影响",
  evaluation: "Evaluation — 平衡判断",
  conclusion_restate: "Conclusion — 重申立场",
  conclusion_summary: "Conclusion — 总结两论点关系",
};
