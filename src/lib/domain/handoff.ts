import type { Stage1Handoff, SessionState } from "./types";

export const EMPTY_HANDOFF: Stage1Handoff = {
  taskUnderstanding: "",
  position: "",
  body1Point: "",
  body1Angle: "",
  body2Point: "",
  body2Angle: "",
  questionType: "",
};

export function handoffProgress(h: Stage1Handoff): { filled: number; total: number } {
  const keys: (keyof Stage1Handoff)[] = [
    "taskUnderstanding",
    "position",
    "body1Point",
    "body1Angle",
    "body2Point",
    "body2Angle",
  ];
  const filled = keys.filter((k) => (h[k] ?? "").trim().length > 0).length;
  return { filled, total: keys.length };
}

export function isHandoffComplete(h: Stage1Handoff): boolean {
  return handoffProgress(h).filled === handoffProgress(h).total;
}

/** 角度文本相似（P3 规则 hint） */
export function anglesTooSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  const ta = na.split(/\s+/).filter(Boolean);
  const tb = new Set(nb.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (let i = 0; i < ta.length; i++) {
    if (tb.has(ta[i]!)) overlap++;
  }
  const ratio = overlap / Math.min(ta.length, tb.size);
  return ratio >= 0.7;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "")
    .trim();
}

export interface HandoffValidation {
  ok: boolean;
  errors: string[];
  hints: string[];
}

export function validateHandoff(h: Stage1Handoff): HandoffValidation {
  const errors: string[] = [];
  const hints: string[] = [];

  if (!h.taskUnderstanding.trim()) errors.push("请填写：题意任务");
  if (!h.position.trim()) errors.push("请填写：立场");
  if (!h.body1Point.trim()) errors.push("请填写：Body1 分论点");
  if (!h.body1Angle.trim()) errors.push("请填写：Body1 角度");
  if (!h.body2Point.trim()) errors.push("请填写：Body2 分论点");
  if (!h.body2Angle.trim()) errors.push("请填写：Body2 角度");

  if (h.body1Point.trim() && h.body2Point.trim()) {
    const p1 = normalize(h.body1Point);
    const p2 = normalize(h.body2Point);
    if (p1 === p2 || (p1.length > 8 && p2.includes(p1))) {
      hints.push("两个分论点表述过于接近，请区分 Body1 / Body2。");
    }
  }

  if (h.body1Angle.trim() && h.body2Angle.trim() && anglesTooSimilar(h.body1Angle, h.body2Angle)) {
    hints.push("两个「角度」似乎同一切入面，请从题目不同侧面标注。");
  }

  return { ok: errors.length === 0, errors, hints };
}

export function handoffToSummary(h: Stage1Handoff): string {
  return [
    `题意：${h.taskUnderstanding}`,
    `立场：${h.position}`,
    `Body1：${h.body1Point}（角度：${h.body1Angle}）`,
    `Body2：${h.body2Point}（角度：${h.body2Angle}）`,
  ].join("\n");
}

export function applyHandoffToState(
  state: SessionState,
  h: Stage1Handoff,
): SessionState {
  return {
    ...state,
    handoff: h,
    handoffLocked: true,
    s1: {
      questionType: h.questionType ?? state.s1?.questionType ?? "",
      taskUnderstanding: h.taskUnderstanding,
      position: h.position,
    },
    s2: {
      body1Point: h.body1Point,
      body2Point: h.body2Point,
      body1Angle: h.body1Angle,
      body2Angle: h.body2Angle,
      body1: defaultBodySegment(),
      body2: defaultBodySegment(),
    },
  };
}

export function defaultBodySegment() {
  return {
    status: "coaching" as const,
    draft: "",
    openIssues: [] as string[],
  };
}
