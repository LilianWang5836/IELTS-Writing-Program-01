/**
 * Stage1 题型标签：题库 hintType + 题干语义校正（如 outweigh 题误标 agree）。
 */
import type { QuestionType, SessionState } from "./types";

export function isProsConsQuestionType(t: QuestionType | undefined): boolean {
  return t === "adv_disadv" || t === "pos_neg";
}

const OUTWEIGH_TOPIC_RE =
  /\boutweigh\b|利大于弊|弊大于利|好处多还是坏处|坏处多还是好处|disadvantages?\s+of\s+.+\s+outweigh/i;

const LIST_ADV_DISADV_RE =
  /advantages?\s+and\s+disadvantages?|what\s+are\s+the\s+advantages|优缺点/i;

/** 从题干判断是否为「列利弊 + 权衡哪边更重」类 Task2 */
export function topicImpliesProsConsWeighing(topic: string): boolean {
  const t = topic.trim();
  if (!t) return false;
  if (OUTWEIGH_TOPIC_RE.test(t)) return true;
  if (LIST_ADV_DISADV_RE.test(t)) return true;
  return false;
}

/**
 * Stage1 探索/判齐使用的有效题型。
 * 优先校正：outweigh / 纯利弊列举题不应走 agree 的通用立场+消息条数逻辑。
 */
export function resolveQuestionHintType(state: SessionState): QuestionType {
  const tagged = state.questionHintType ?? "unknown";
  const topic = (state.topic ?? "").trim();
  const fromHandoff = state.handoff?.questionType?.trim();

  if (topicImpliesProsConsWeighing(topic)) {
    return "adv_disadv";
  }

  if (fromHandoff && isProsConsQuestionType(fromHandoff as QuestionType)) {
    return fromHandoff as QuestionType;
  }

  if (tagged === "agree" && topicImpliesProsConsWeighing(topic)) {
    return "adv_disadv";
  }

  return tagged;
}

export function isEffectiveProsConsExploration(state: SessionState): boolean {
  return isProsConsQuestionType(resolveQuestionHintType(state));
}
