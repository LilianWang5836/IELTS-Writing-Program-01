/**
 * Canonical Stage1 theme concepts — shared by LLM projection + rule fallback.
 */
import type { Stage1ConceptId } from "./theme-normalization";

export interface Stage1ConceptSpec {
  id: Stage1ConceptId;
  side: "benefit" | "drawback";
  labelZh: string;
  /** Hints for LLM semantic matching (not regex gates) */
  examples: string[];
}

export const STAGE1_CONCEPT_CATALOG: Stage1ConceptSpec[] = [
  {
    id: "convenience",
    side: "benefit",
    labelZh: "便利/随时可买",
    examples: ["购物更方便", "随时下单", "不用跑实体店"],
  },
  {
    id: "time_saving",
    side: "benefit",
    labelZh: "节省时间",
    examples: ["节约时间", "通勤路上购物", "周末不用专门去商场"],
  },
  {
    id: "economic_growth",
    side: "benefit",
    labelZh: "经济/就业/收入",
    examples: ["带动当地经济", "增加就业", "居民收入上升"],
  },
  {
    id: "cultural_exchange",
    side: "benefit",
    labelZh: "文化交流",
    examples: ["促进不同地区文化交流"],
  },
  {
    id: "impulse_buying",
    side: "drawback",
    labelZh: "冲动消费/乱花钱",
    examples: ["冲动购物变多", "乱花钱", "买不需要的东西", "不理性消费"],
  },
  {
    id: "environment_damage",
    side: "drawback",
    labelZh: "环境破坏/污染",
    examples: ["垃圾增多", "污染", "破坏景区环境"],
  },
  {
    id: "traffic_congestion",
    side: "drawback",
    labelZh: "拥堵/拥挤",
    examples: ["交通拥堵", "景区拥挤", "影响居民出行"],
  },
];

const BENEFIT_IDS = new Set(
  STAGE1_CONCEPT_CATALOG.filter((c) => c.side === "benefit").map((c) => c.id),
);
const DRAWBACK_IDS = new Set(
  STAGE1_CONCEPT_CATALOG.filter((c) => c.side === "drawback").map((c) => c.id),
);

export function isKnownBenefitConcept(id: string): id is Stage1ConceptId {
  return BENEFIT_IDS.has(id as Stage1ConceptId);
}

export function isKnownDrawbackConcept(id: string): id is Stage1ConceptId {
  return DRAWBACK_IDS.has(id as Stage1ConceptId);
}

export function catalogPromptBlock(): string {
  return STAGE1_CONCEPT_CATALOG.map(
    (c) =>
      `- ${c.id} (${c.side}, ${c.labelZh}) e.g. ${c.examples.slice(0, 2).join("；")}`,
  ).join("\n");
}
