/**
 * Verbatim snippet harvest from user messages (feeds stage1ThemeProjection).
 * Domain-only — no runtime / LLM imports.
 */
import {
  looksLikeBenefitLine,
  looksLikeDrawbackLine,
  matchesBenefitTheme,
  matchesDrawbackTheme,
} from "@/runtime/semantic/theme-normalization";

function trimSnippet(s: string, max = 48): string {
  const t = s.trim().replace(/^[,，、\s]+|[,，、\s]+$/g, "");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function pushUnique(arr: string[], piece: string): void {
  const t = trimSnippet(piece);
  if (t.length < 4) return;
  if (arr.some((x) => x === t || x.includes(t) || t.includes(x))) return;
  arr.push(t);
}

function hasLabeledProsConsContent(message: string): boolean {
  return (
    /(?:好处|优势|利)[：:]\s*\S/.test(message) ||
    /(?:坏处|劣势|弊端?)[：:]\s*\S/.test(message)
  );
}

function isExplorationPositionOnlyLine(message: string): boolean {
  const t = message.trim();
  if (t.length > 88) return false;
  if (hasLabeledProsConsContent(t)) return false;
  if (
    /取决于|看情况|部分同意|利大于弊|弊大于利|好处更多|坏处更多|好处多|坏处多|outweigh/i.test(
      t,
    ) &&
    !/例如|比如|因为|所以|促进|破坏|导致|收入|就业|环境|游客|景区|居民/i.test(t)
  ) {
    return true;
  }
  if (/好处.*坏处|坏处.*好处/.test(t) && t.length < 36 && !/[。；;]/.test(t)) {
    return true;
  }
  return false;
}

/** 同条消息里「好处…。坏处，…」拆开 */
export function splitProsConsInMessage(message: string): {
  benefitPart: string;
  drawbackPart: string;
} {
  const m = message.trim();
  if (!m || isExplorationPositionOnlyLine(m)) {
    return { benefitPart: "", drawbackPart: "" };
  }

  const cleanDrawback = (s: string): string =>
    s.replace(/^(?:坏处|劣势|弊端?)[：:]\s*/gi, "").trim();
  const cleanBenefit = (s: string): string =>
    s.replace(/(?:好处|优势|利)[：:]\s*/gi, "").trim();

  const afterPeriod = m.match(
    /^(.*?)[。；;]\s*(?:坏处|劣势|弊端?)[：:，,]?\s*([\s\S]+)$/,
  );
  if (afterPeriod?.[1] && afterPeriod[2]) {
    return {
      benefitPart: cleanBenefit(afterPeriod[1]),
      drawbackPart: cleanDrawback(afterPeriod[2]),
    };
  }

  const afterComma = m.match(
    /^(.*?(?:好处|优势|利)[：:][^，,]*)[，,]\s*(?:坏处|劣势|弊端?)[：:，,]?\s*([\s\S]+)$/,
  );
  if (afterComma?.[1] && afterComma[2]) {
    return {
      benefitPart: cleanBenefit(afterComma[1]),
      drawbackPart: cleanDrawback(afterComma[2]),
    };
  }

  const afterBut = m.match(/^(.*?)[，,]?\s*(?:但是|然而|不过|但)\s*([\s\S]+)$/);
  if (afterBut?.[1] && afterBut[2]) {
    const benefitPart = afterBut[1].trim();
    const drawbackPart = afterBut[2].trim();
    if (
      (looksLikeBenefitLine(benefitPart) || matchesBenefitTheme(benefitPart)) &&
      (looksLikeDrawbackLine(drawbackPart) || matchesDrawbackTheme(drawbackPart))
    ) {
      return { benefitPart, drawbackPart };
    }
  }

  return { benefitPart: "", drawbackPart: "" };
}

/** Harvest verbatim benefit/drawback snippets from one user message. */
export function harvestMessageSnippets(message: string): {
  benefits: string[];
  drawbacks: string[];
} {
  const benefits: string[] = [];
  const drawbacks: string[] = [];
  const m = message.trim();
  if (isExplorationPositionOnlyLine(m)) {
    return { benefits, drawbacks };
  }

  const split = splitProsConsInMessage(m);
  if (split.benefitPart) pushUnique(benefits, split.benefitPart);
  if (split.drawbackPart) pushUnique(drawbacks, split.drawbackPart);
  const rest = split.benefitPart || split.drawbackPart ? "" : m;

  const benefitAfter = rest.match(/(?:好处|优势|利)[：:]\s*([^；;\n]+)/);
  if (benefitAfter?.[1]) {
    const cleaned = benefitAfter[1].split(/[，,]\s*(?:坏处|劣势|弊)/)[0].trim();
    pushUnique(benefits, cleaned);
  }

  const drawbackAfter = m.match(/(?:坏处|劣势|弊|弊端)[：:，,]?\s*([^；;\n]+)/);
  if (drawbackAfter?.[1]) {
    const cleaned = drawbackAfter[1].split(/[，,]\s*(?:好处|优势)/)[0].trim();
    pushUnique(drawbacks, cleaned);
  }

  const beforeDrawback = rest.split(/(?:坏处|劣势|弊|弊端)[：:]/)[0];
  if (/好处|优势/.test(beforeDrawback) && !benefitAfter) {
    const chunk = beforeDrawback.replace(/.*(?:好处|优势)[：:]?\s*/, "");
    if (chunk.length > 4) pushUnique(benefits, chunk);
  }

  const src = rest || m;
  if (/拥堵|堵车|拥挤/.test(src) && !/好处|优势/.test(src.slice(0, 8))) {
    pushUnique(drawbacks, src.match(/拥堵[^，,。；;]*/)?.[0] ?? "交通拥堵、出行不便");
  }
  if (/垃圾|污染|环境破坏|环境压力/.test(src)) {
    pushUnique(
      drawbacks,
      src.match(/[^，,。；;]*(?:垃圾|污染|环境破坏|环境压力)[^，,。；;]*/)?.[0] ??
        "旅游带来的环境压力",
    );
  } else if (/环境/.test(src) && /破坏|污染|垃圾|压力/.test(src)) {
    pushUnique(
      drawbacks,
      src.match(/[^，,。；;]*环境[^，,。；;]*/)?.[0] ?? "旅游带来的环境压力",
    );
  }
  if (
    /收入|服务业|带动|就业|经济|发展/.test(src) &&
    !/(?:坏处|劣势|弊|弊端)/.test(src)
  ) {
    pushUnique(
      benefits,
      src.match(/[^，,。；;]*(?:收入|服务业|带动|发展)[^，,。；;]*/)?.[0] ??
        src.slice(0, 40),
    );
  }

  if (!drawbacks.length && matchesDrawbackTheme(m)) {
    pushUnique(drawbacks, m);
  }
  if (
    !benefits.length &&
    matchesBenefitTheme(m) &&
    !matchesDrawbackTheme(m) &&
    !isExplorationPositionOnlyLine(m)
  ) {
    pushUnique(benefits, m);
  }

  return { benefits, drawbacks };
}

/** Aggregate snippets across all user messages in order. */
export function harvestExplorationSnippets(messages: string[]): {
  benefitSnippets: string[];
  drawbackSnippets: string[];
} {
  const benefitSnippets: string[] = [];
  const drawbackSnippets: string[] = [];
  for (const m of messages) {
    const { benefits, drawbacks } = harvestMessageSnippets(m);
    for (const b of benefits) pushUnique(benefitSnippets, b);
    for (const d of drawbacks) pushUnique(drawbackSnippets, d);
  }
  return { benefitSnippets, drawbackSnippets };
}
