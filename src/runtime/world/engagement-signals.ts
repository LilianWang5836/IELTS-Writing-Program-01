import type { SessionState } from "@/lib/domain/types";
import type { EngagementSignals } from "../types";
import {
  extractSemanticFeatures,
  isMinimalComplianceMessage,
} from "./semantic-features";

function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const cjk = t.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = t.split(/\s+/).filter(Boolean).length;
  return cjk > 0 ? cjk + words : words;
}

function lengthTrend(
  history: { wordCount: number }[],
): EngagementSignals["responseLengthTrend"] {
  if (history.length < 2) return "stable";
  const last = history[history.length - 1]?.wordCount ?? 0;
  const prev = history[history.length - 2]?.wordCount ?? 0;
  if (last < prev * 0.6) return "shrinking";
  if (last > prev * 1.4) return "growing";
  return "stable";
}

export function extractEngagementSignals(
  state: SessionState,
  userMessage: string,
  userMessages: string[],
): EngagementSignals {
  const semantic = extractSemanticFeatures(userMessage);
  const minimalCompliance = isMinimalComplianceMessage(userMessage);
  const lastQ = state.coachContext?.lastQuestion ?? "";

  const history = userMessages.slice(-4).map((m) => ({ wordCount: wordCount(m) }));
  const responseLengthTrend = lengthTrend(history);

  const semanticEntropy: EngagementSignals["semanticEntropy"] =
    semantic.genericPhrases.length >= 2 || minimalCompliance
      ? "high"
      : semantic.genericPhrases.length >= 1
        ? "medium"
        : "low";

  const repetitionRisk =
    lastQ.length > 0 &&
    userMessage.length > 0 &&
    /重复|问过了|already asked/i.test(userMessage);

  let fatigueSignals = 0;
  if (responseLengthTrend === "shrinking") fatigueSignals++;
  if (semanticEntropy === "high") fatigueSignals++;
  if (minimalCompliance) fatigueSignals++;
  if (repetitionRisk) fatigueSignals++;

  const fatigueHigh = fatigueSignals >= 2;
  const fatigueConfidence: EngagementSignals["fatigueConfidence"] =
    minimalCompliance && responseLengthTrend === "shrinking"
      ? "certain"
      : fatigueHigh && semanticEntropy === "high" && !minimalCompliance
        ? "uncertain"
        : fatigueHigh
          ? "certain"
          : "uncertain";

  return {
    responseLengthTrend,
    semanticEntropy,
    repetitionRisk,
    minimalCompliance,
    fatigueHigh,
    fatigueConfidence,
  };
}
