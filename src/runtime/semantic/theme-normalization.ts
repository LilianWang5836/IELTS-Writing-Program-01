/**
 * Stage1 Theme Normalization — different surface forms → canonical concept IDs.
 * Single source for SPL + regex overlay in stage1-exploration-themes.
 */

export type ThemeSide = "benefit" | "drawback";

export type Stage1ConceptId =
  | "convenience"
  | "time_saving"
  | "economic_growth"
  | "cultural_exchange"
  | "implicit_benefit"
  | "impulse_buying"
  | "environment_damage"
  | "traffic_congestion"
  | "implicit_drawback";

export interface ThemeConceptRule {
  id: Stage1ConceptId;
  side: ThemeSide;
  /** Surface patterns (ZH/EN) mapped to this concept */
  patterns: RegExp[];
}

/** Canonical concept registry — extend here, not scattered regex in domain code */
export const STAGE1_THEME_RULES: ThemeConceptRule[] = [
  {
    id: "time_saving",
    side: "benefit",
    patterns: [
      /节省时间/,
      /节约时间/,
      /省时间/,
      /不用专门抽时间/,
      /不用.*去线下/,
      /不用.*跑实体店/,
      /通勤.*解决/,
      /碎片时间/,
    ],
  },
  {
    id: "convenience",
    side: "benefit",
    patterns: [
      /方便|便利/,
      /省时/,
      /效率|更快|更容易/,
      /购物.*方便/,
      /随时随地.*下单/,
      /随时就可以下单/,
      /网购/,
      /online shopping/i,
    ],
  },
  {
    id: "economic_growth",
    side: "benefit",
    patterns: [
      /收入|就业|经济|带动|服务业|受益|增长|促进.*发展/,
      /餐馆|酒店.*收益/,
    ],
  },
  {
    id: "cultural_exchange",
    side: "benefit",
    patterns: [/文化交流|文化互动/],
  },
  {
    id: "impulse_buying",
    side: "drawback",
    patterns: [
      /冲动购物/,
      /冲动性?消费/,
      /乱花钱/,
      /不理性消费/,
      /盲目购买|盲目消费/,
      /过度购买|过度消费/,
      /买.*不需要/,
      /浪费.*钱/,
      /impulse (?:buy|spend)/i,
    ],
  },
  {
    id: "environment_damage",
    side: "drawback",
    patterns: [
      /垃圾|污染/,
      /环境破坏|环境压力/,
      /破坏.*环境|环境.*破坏/,
    ],
  },
  {
    id: "traffic_congestion",
    side: "drawback",
    patterns: [/拥堵|堵车|拥挤|人太多|生活被打扰|出行不便|节假日.*多/],
  },
];

function pushUniqueConcept(arr: Stage1ConceptId[], id: Stage1ConceptId): void {
  if (!arr.includes(id)) arr.push(id);
}

/** Map one text span → canonical concept IDs (both sides). */
export function projectConceptsFromText(text: string): {
  benefits: Stage1ConceptId[];
  drawbacks: Stage1ConceptId[];
} {
  const benefits: Stage1ConceptId[] = [];
  const drawbacks: Stage1ConceptId[] = [];
  const t = text.trim();
  if (!t) return { benefits, drawbacks };

  for (const rule of STAGE1_THEME_RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      if (rule.side === "benefit") pushUniqueConcept(benefits, rule.id);
      else pushUniqueConcept(drawbacks, rule.id);
    }
  }
  return { benefits, drawbacks };
}

/** Aggregate concepts across conversation messages (order preserved, deduped). */
export function projectConceptsFromMessages(messages: string[]): {
  benefits: Stage1ConceptId[];
  drawbacks: Stage1ConceptId[];
} {
  const benefits: Stage1ConceptId[] = [];
  const drawbacks: Stage1ConceptId[] = [];
  for (const m of messages) {
    const row = projectConceptsFromText(m);
    for (const id of row.benefits) pushUniqueConcept(benefits, id);
    for (const id of row.drawbacks) pushUniqueConcept(drawbacks, id);
  }
  return { benefits, drawbacks };
}

export function matchesBenefitTheme(text: string): boolean {
  return projectConceptsFromText(text).benefits.length > 0;
}

export function matchesDrawbackTheme(text: string): boolean {
  return projectConceptsFromText(text).drawbacks.length > 0;
}

export function looksLikeBenefitLine(text: string): boolean {
  if (matchesBenefitTheme(text)) return true;
  return /收入|就业|经济|带动|服务业|受益|增长|交流|便利|机会|发展|促进|节省时间|省时|节约|线下购物|通勤|周末|休息|爱好|生活质量|碎片时间|效率|更快|更方便/.test(
    text,
  );
}

export function looksLikeDrawbackLine(text: string): boolean {
  if (matchesDrawbackTheme(text)) return true;
  if (!/拥堵|堵车|拥挤|垃圾|污染|破坏|不便|噪音|成本|压力|影响居民|环境破坏|环境压力|冲动购物|冲动消费|浪费|不需要|过度购买|不理性|盲目|乱花钱/.test(
    text,
  )) {
    return false;
  }
  if (/环境/.test(text) && /破坏|污染|垃圾|压力|破坏/.test(text)) {
    return true;
  }
  return /拥堵|堵车|拥挤|垃圾|污染|破坏|不便|噪音|成本|压力|影响居民|冲动购物|冲动消费|浪费|不需要|过度购买|不理性|盲目|乱花钱/.test(
    text,
  );
}

export function inferPositionFromText(text: string): "pro" | "con" | "unknown" {
  if (/弊大于利|坏处更多|劣势更大|disadvantages?\s+outweigh/i.test(text)) {
    return "con";
  }
  if (
    /利大于弊|好处更多|优势更大|overall.*benefit|advantages?\s+outweigh|好处多|整体.*积极|总体.*积极|积极/i.test(
      text,
    )
  ) {
    return "pro";
  }
  return "unknown";
}

/** Legacy SPL token aliases → canonical IDs (for migration) */
export const LEGACY_CONCEPT_ALIASES: Record<string, Stage1ConceptId> = {
  convenience_or_efficiency: "convenience",
  risk_or_overconsumption: "impulse_buying",
};

export function normalizeConceptId(token: string): Stage1ConceptId | string {
  const t = token.trim();
  return LEGACY_CONCEPT_ALIASES[t] ?? t;
}
