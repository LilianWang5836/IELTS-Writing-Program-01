import type { LanguageSupport, LlmTurnResult } from "@/lib/domain/types";

const BANNED_PATTERNS = [
  /here is a (sample|model)/i,
  /model answer/i,
  /范文/,
  /参考段落/,
];

export function guardUserVisibleText(text: string, maxSentences = 3): string {
  let out = text.trim();
  for (const p of BANNED_PATTERNS) {
    if (p.test(out)) {
      out = out.split(p)[0]?.trim() ?? out;
    }
  }
  const sentences = out.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [out];
  if (sentences.length > maxSentences) {
    out = sentences.slice(0, maxSentences).join("").trim();
  }
  return out;
}

function appendLanguageSupport(
  text: string,
  ls?: LanguageSupport,
): string {
  if (!ls) return text;
  const lines: string[] = [];
  if (ls.keywords?.length && !/keyword/i.test(text)) {
    lines.push(`Keywords: ${ls.keywords.join(", ")}`);
  }
  if (ls.phraseFragments?.length && !/pattern/i.test(text)) {
    lines.push(`Patterns: ${ls.phraseFragments.join(" | ")}`);
  }
  if (ls.starterStructures?.length && !/starter/i.test(text)) {
    lines.push(`Starters: ${ls.starterStructures.join(" | ")}`);
  }
  if (!lines.length) return text;
  return [text.trim(), ...lines].filter(Boolean).join("\n");
}

/** Assign 模式保留 keywords；feedback 仍限制 3 句 */
export function formatCoachDisplay(result: LlmTurnResult): string {
  const withSupport = appendLanguageSupport(
    result.userVisibleText ?? "",
    result.languageSupport,
  );
  if (result.verdict === "assign") {
    return withSupport.slice(0, 900);
  }
  return guardUserVisibleText(withSupport, 3);
}

export function parseLlmJson(raw: string): LlmTurnResult {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as LlmTurnResult;
}
