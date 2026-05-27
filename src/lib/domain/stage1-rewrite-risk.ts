/**
 * Stage1：LLM 对「用户原话 vs 拟整理六栏」的改写幅度评估；规则仅拦截 high。
 */
import type { LlmTurnResult, RewriteRiskLevel } from "./types";

export interface RewriteRiskGate {
  risk: RewriteRiskLevel;
  blockProposal: boolean;
  followUpAsk: string;
  mirrorNote: string;
  reasons: string[];
}

function normalizeRisk(raw: string): RewriteRiskLevel {
  const r = raw.trim().toLowerCase();
  if (r === "high" || r === "medium" || r === "low") return r;
  return "low";
}

function strField(
  result: LlmTurnResult,
  key:
    | "rewriteRisk"
    | "rewriteFollowUpAsk"
    | "rewriteMirror"
    | "rewriteReasons",
): string | string[] | undefined {
  const top = result[key];
  if (top !== undefined && top !== null) return top as string | string[];
  const ex = result.extracted as Record<string, unknown> | undefined;
  const fromEx = ex?.[key];
  if (fromEx === undefined || fromEx === null) return undefined;
  return fromEx as string | string[];
}

/** 从 LLM 回合结果读取改写风险评估（仅 high 时 blockProposal=true） */
export function readRewriteRiskGate(result: LlmTurnResult): RewriteRiskGate {
  const risk = normalizeRisk(String(strField(result, "rewriteRisk") ?? "low"));
  const followUpAsk = String(strField(result, "rewriteFollowUpAsk") ?? "").trim();
  const mirrorNote = String(strField(result, "rewriteMirror") ?? "").trim();
  const reasonsRaw = strField(result, "rewriteReasons");
  const reasons = Array.isArray(reasonsRaw)
    ? reasonsRaw.map((x) => String(x).trim()).filter(Boolean)
    : typeof reasonsRaw === "string" && reasonsRaw.trim()
      ? [reasonsRaw.trim()]
      : [];

  return {
    risk,
    blockProposal: risk === "high",
    followUpAsk,
    mirrorNote,
    reasons,
  };
}
