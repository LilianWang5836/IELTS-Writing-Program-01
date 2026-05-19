export const STAGE1_OPENING =
  "同学你好，题目已锁定。我们开始今天的大作文审题特训。请先告诉我：这道题属于什么题型？题目真正要求你讨论什么？你的总体判断是什么？";

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
