import {
  inferPositionFromText,
  projectConceptsFromMessages,
  type Stage1ConceptId,
} from "./theme-normalization";

export type SemanticState = {
  benefits: Stage1ConceptId[];
  drawbacks: Stage1ConceptId[];
  positionLean: "pro" | "con" | "unknown";
  /** 用户已表达可写作的完整语义（非仅 regex 标签） */
  userHasExpressedCompleteIdea: boolean;
};

/**
 * SPL 语义占位 token：仅用于 readiness/gate 计数，
 * 绝不可作为真实 body point 文本写入六栏。
 */
export const SEMANTIC_TOKENS = [
  "convenience",
  "time_saving",
  "economic_growth",
  "cultural_exchange",
  "impulse_buying",
  "environment_damage",
  "traffic_congestion",
  "implicit_benefit",
  "implicit_drawback",
  // legacy aliases still recognized by isSemanticToken
  "convenience_or_efficiency",
  "risk_or_overconsumption",
] as const;

export function isSemanticToken(text: string | undefined): boolean {
  const t = text?.trim() ?? "";
  if (!t) return false;
  return (SEMANTIC_TOKENS as readonly string[]).includes(t) || /^[a-z][a-z_]*$/.test(t);
}

/**
 * Rule-based semantic projection (SPL) — Theme Normalization Layer.
 * Bridges short / untagged user answers to Stage1 runtime state concepts.
 */
export function buildSemanticState(messages: string[]): SemanticState {
  const text = messages.join("\n");
  const projected = projectConceptsFromMessages(messages);

  const benefits = [...projected.benefits];
  const drawbacks = [...projected.drawbacks];

  const positionLean = inferPositionFromText(
    [text, ...messages].join("\n"),
  );

  const hasPosition =
    positionLean !== "unknown" ||
    /我认为|整体|总体|积极|消极/.test(text);

  if (benefits.length === 0 && hasPosition && positionLean === "pro") {
    benefits.push("implicit_benefit");
  }

  const userHasExpressedCompleteIdea =
    benefits.length > 0 || drawbacks.length > 0 || hasPosition;

  return {
    benefits,
    drawbacks,
    positionLean,
    userHasExpressedCompleteIdea,
  };
}
