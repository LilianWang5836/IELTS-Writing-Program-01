import type { LlmTurnResult } from "@/lib/domain/types";

const BANNED_PATTERNS = [
  /here is a (sample|model)/i,
  /model answer/i,
  /范文/,
  /参考段落/,
];

export function guardUserVisibleText(text: string): string {
  let out = text.trim();
  for (const p of BANNED_PATTERNS) {
    if (p.test(out)) {
      out = out.split(p)[0]?.trim() ?? out;
    }
  }
  const sentences = out.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [out];
  if (sentences.length > 3) {
    out = sentences.slice(0, 3).join("").trim();
  }
  return out;
}

export function parseLlmJson(raw: string): LlmTurnResult {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as LlmTurnResult;
  parsed.userVisibleText = guardUserVisibleText(parsed.userVisibleText ?? "");
  return parsed;
}
