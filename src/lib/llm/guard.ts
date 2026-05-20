import { jsonrepair } from "jsonrepair";
import type {
  LanguageSupport,
  LogicBreakdown,
  LlmTurnResult,
  ParagraphSlot,
} from "@/lib/domain/types";

const SLOT_LABELS: Record<ParagraphSlot, string> = {
  claim: "论点 Claim",
  reason: "原因 Reason",
  elaboration: "论述 Elaboration",
  support: "支撑 Support",
  example: "举例 Example",
  link: "扣题 Link",
};

const SLOT_ORDER: ParagraphSlot[] = [
  "claim",
  "reason",
  "elaboration",
  "support",
  "example",
  "link",
];

function formatLogicBreakdown(bd: LogicBreakdown): string {
  const title =
    bd.target === "subpoints"
      ? "【分论点拆解】"
      : bd.target === "body1"
        ? "【Body1 论证链】"
        : "【Body2 论证链】";

  const lines: string[] = [];
  if (bd.chainSummary?.trim()) {
    lines.push(`链条：${bd.chainSummary.trim()}`);
  }
  if (bd.userBlobSummary?.trim()) {
    lines.push(`（原文归类：${bd.userBlobSummary.trim()}）`);
  }

  for (const key of SLOT_ORDER) {
    const val = bd.slots[key]?.trim();
    if (val) lines.push(`• ${SLOT_LABELS[key]}：${val}`);
  }

  const missing = bd.missing?.filter(Boolean) ?? [];
  if (missing.length) {
    const labels = missing.map((m) => SLOT_LABELS[m] ?? m);
    lines.push(`⚠ 论证仍缺：${labels.join("、")}`);
  }

  if (!lines.length) {
    lines.push("（未能从原文识别出清晰结构，请分点重写）");
  }

  return [title, ...lines].join("\n");
}

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

function prependMirror(result: LlmTurnResult, coach: string): string {
  const parts: string[] = [];
  if (result.mirror?.trim() && !coach.includes(result.mirror.trim())) {
    parts.push(result.mirror.trim());
  }
  if (result.coachQuestion?.trim() && !coach.includes(result.coachQuestion.trim())) {
    parts.push(result.coachQuestion.trim());
  }
  if (!parts.length) return coach;
  const head = parts.join(" ");
  if (coach.startsWith(head.slice(0, 20))) return coach;
  return `${head}\n\n${coach}`.trim();
}

/** Stage 1：mirror + 单问，防重复拼接 */
export function formatStage1CoachDisplay(result: LlmTurnResult): string {
  const parts: string[] = [];
  const mirror = result.mirror?.trim();
  const question = result.coachQuestion?.trim();
  const uv = result.userVisibleText?.trim();

  if (mirror) parts.push(mirror);
  if (question) {
    const joined = parts.join(" ");
    if (!joined.includes(question.slice(0, Math.min(12, question.length)))) {
      parts.push(question);
    }
  }
  if (uv) {
    const joined = parts.join(" ");
    if (
      !mirror?.includes(uv.slice(0, 10)) &&
      !question?.includes(uv.slice(0, 10)) &&
      !joined.includes(uv.slice(0, Math.min(12, uv.length)))
    ) {
      parts.push(uv);
    }
  }

  return guardUserVisibleText(parts.join(" "), 4);
}

/** Assign 模式保留 keywords；Stage 2 的 logicBreakdown 另段展示 */
export function formatCoachDisplay(
  result: LlmTurnResult,
  opts?: { stage1?: boolean },
): string {
  if (opts?.stage1) {
    return formatStage1CoachDisplay(result);
  }

  const withSupport = appendLanguageSupport(
    result.userVisibleText ?? "",
    result.languageSupport,
  );
  let coach =
    result.verdict === "assign"
      ? withSupport.slice(0, 900)
      : guardUserVisibleText(withSupport, 3);

  coach = prependMirror(result, coach);

  if (result.syntaxHint?.trim()) {
    coach = `${coach}\n💡 ${result.syntaxHint.trim()}`;
  }

  if (result.logicBreakdown?.slots) {
    return `${coach}\n\n${formatLogicBreakdown(result.logicBreakdown)}`;
  }
  return coach;
}

function extractJsonBlock(raw: string): string {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

/** 模型 JSON 断串、未转义换行时做修复 */
function salvageFromBrokenJson(raw: string): LlmTurnResult | null {
  const verdictMatch = raw.match(/"verdict"\s*:\s*"(pass|fail|assign|coach)"/i);
  if (!verdictMatch) return null;

  const verdict = verdictMatch[1].toLowerCase() as LlmTurnResult["verdict"];

  let userVisibleText = "请重试一次；若仍失败请缩短你的回答。";
  const keyIdx = raw.indexOf('"userVisibleText"');
  if (keyIdx >= 0) {
    const afterColon = raw.indexOf(":", keyIdx);
    const q0 = raw.indexOf('"', afterColon + 1);
    if (q0 >= 0) {
      let i = q0 + 1;
      let buf = "";
      while (i < raw.length) {
        const ch = raw[i];
        if (ch === "\\") {
          buf += raw[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (ch === '"') break;
        buf += ch;
        i += 1;
      }
      if (buf.trim()) userVisibleText = buf.replace(/\s+/g, " ").trim();
    }
  }

  return {
    verdict,
    userVisibleText: guardUserVisibleText(userVisibleText, 5),
  };
}

export function parseLlmJson(raw: string): LlmTurnResult {
  const block = extractJsonBlock(raw);

  try {
    return JSON.parse(block) as LlmTurnResult;
  } catch {
    // continue
  }

  try {
    const repaired = jsonrepair(block);
    return JSON.parse(repaired) as LlmTurnResult;
  } catch {
    // continue
  }

  const salvaged = salvageFromBrokenJson(raw);
  if (salvaged) return salvaged;

  throw new Error(
    "AI 返回格式异常，请重试。若反复出现，请在 Vercel 将 GEMINI_MODEL 设为 gemini-2.5-flash",
  );
}
