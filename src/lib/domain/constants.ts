import type { HandoffFieldTarget } from "./types";

export const HANDOFF_FIELD_LABELS: Record<HandoffFieldTarget, string> = {
  taskUnderstanding: "① 题意",
  position: "② 立场",
  body1Point: "③ Body1 分论点",
  body1Angle: "④ Body1 切入面",
  body2Point: "⑤ Body2 分论点",
  body2Angle: "⑥ Body2 切入面",
};

/** 帮助理解「切入面」：同一分论点下，你从题目的哪一面展开 */
export const HANDOFF_ANGLE_HELP =
  "切入面 = 这一段的讨论范围/视角（如「就业市场」「学术深造」），与分论点配合，两段的切入面须不同。";

/** 聊天里主动教「切入面」的固定短句（口语） */
export const ANGLE_TEACH_CHAT =
  "「切入面」不是再提一个新观点，而是这一段从题目哪一面展开——比如 Body1 用「就业市场」，Body2 用「学术深造」，两段范围要不同。";

export const HANDOFF_FIELD_ORDER: HandoffFieldTarget[] = [
  "taskUnderstanding",
  "position",
  "body1Point",
  "body1Angle",
  "body2Point",
  "body2Angle",
];

export const STAGE1_OPENING =
  "同学你好，题目已锁定。先在右侧和我聊审题；聊够后我会帮你整理成左侧定稿，你确认后再提交。先说说：这题要你讨论什么？你的总体判断是什么？";

export const MARKERS = {
  STAGE_1_PASS: "[STAGE_1_PASS]",
  SUB_POINTS_PASS: "[SUB_POINTS_PASS]",
  SUB_BODY_1_PASS: "[SUB_BODY_1_PASS]",
  /** body2 完成 → 进入 conclusion 子环节（S2_4_CONCLUSION） */
  SUB_BODY_2_PASS: "[SUB_BODY_2_PASS]",
  /** conclusion 子环节完成 → 进入 stage 3 蓝图 */
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
};
