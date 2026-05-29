export type SemanticState = {
  benefits: string[];
  drawbacks: string[];
  positionLean: "pro" | "con" | "unknown";
  /** 用户已表达可写作的完整语义（非仅 regex 标签） */
  userHasExpressedCompleteIdea: boolean;
};

/** Rule-based semantic projection (SPL) — bridges short / untagged user answers to Stage1 gates. */
export function buildSemanticState(messages: string[]): SemanticState {
  const text = messages.join("\n");

  const hasPositiveMeaning =
    /节约|方便|便利|省时间|不用.*线下|效率|更快|更容易|省时|购物.*方便|网购/.test(
      text,
    );

  const hasNegativeMeaning =
    /冲动消费|浪费|麻烦|增加.*成本|不理性|过度|破坏|环境|拥堵|垃圾|污染/.test(
      text,
    );

  const hasPosition =
    /总体.*积极|总体.*消极|我认为.*好|我认为.*坏|整体.*好处|好处更多|利大于弊|积极/.test(
      text,
    );

  const benefits: string[] = [];
  const drawbacks: string[] = [];

  if (hasPositiveMeaning) {
    benefits.push("convenience_or_efficiency");
  }

  if (hasNegativeMeaning) {
    drawbacks.push("risk_or_overconsumption");
  }

  const positionLean: SemanticState["positionLean"] =
    /积极|好处多|利大于弊|好处更多|整体.*好处/i.test(text)
      ? "pro"
      : /消极|弊大于利|坏处更多/i.test(text)
        ? "con"
        : "unknown";

  const userHasExpressedCompleteIdea =
    hasPositiveMeaning || hasNegativeMeaning || hasPosition;

  return {
    benefits,
    drawbacks,
    positionLean,
    userHasExpressedCompleteIdea,
  };
}
