import { getCurrentModule } from "./module-compiler";
import type { BodyKey, SessionState } from "./types";

export type OrchestratorFocusLayer = "essay" | "paragraph" | "sentence";
export type OrchestratorMode = "shadow" | "soft" | "hard";

export interface OrchestratorSnapshot {
  mode: OrchestratorMode;
  focusLayer: OrchestratorFocusLayer;
  reason: string;
  essayConfidence: number;
  paragraphConfidence: number;
  decisionConfidence: number;
  conflict: boolean;
  fallbackApplied: boolean;
  essayContradiction: boolean;
  paragraphDrift: boolean;
  sentenceIssuesLikely: boolean;
}

function resolveOrchestratorMode(
  prev?: OrchestratorSnapshot,
): OrchestratorMode {
  const raw = (process.env.ORCHESTRATOR_MODE ?? "").toLowerCase().trim();
  if (raw === "shadow" || raw === "soft" || raw === "hard") return raw;
  // Phase 1 默认 soft：给建议，不强制接管。
  return prev?.mode ?? "soft";
}

interface OrchestratorSignals {
  essayContradiction: boolean;
  paragraphDrift: boolean;
  sentenceIssuesLikely: boolean;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function smooth(prev: number | undefined, next: number, alpha = 0.3): number {
  if (typeof prev !== "number") return clamp01(next);
  return clamp01((1 - alpha) * prev + alpha * next);
}

function likelyChinese(text?: string): boolean {
  if (!text?.trim()) return false;
  return /[\u4e00-\u9fa5]/.test(text);
}

function essayContradictionSignal(state: SessionState): boolean {
  const b1 = state.s2?.body1Point?.trim() ?? "";
  const b2 = state.s2?.body2Point?.trim() ?? "";
  if (!b1 || !b2) return false;
  if (b1 === b2) return true;
  if (b1.length > 10 && b2.length > 10 && (b1.includes(b2) || b2.includes(b1))) return true;
  return false;
}

function paragraphDriftSignal(state: SessionState, userMessage?: string): boolean {
  const s3 = state.s3;
  if (!s3 || !userMessage?.trim() || s3.currentBody === "conclusion") return false;
  const current = getCurrentModule(s3.modulePlan, s3.currentBody, s3.moduleIndex);
  const text = userMessage.toLowerCase();
  if (!current) return false;

  if (current === "claim" && /\bfor example|for instance|such as\b/.test(text)) return true;
  if (current === "example" && /\bfor example|for instance|such as|at school|at work|company|companies\b/.test(text)) {
    return false;
  }
  if (current === "example" && /\bbecause|therefore|thus|as a result\b/.test(text)) {
    return false;
  }
  return false;
}

function sentenceIssueSignal(state: SessionState, userMessage?: string): boolean {
  if (!userMessage?.trim()) return false;
  if (likelyChinese(userMessage) && state.subStep === "S3_2_MODULE") return true;
  const words = userMessage.trim().split(/\s+/).filter(Boolean).length;
  if (words > 0 && words < 4) return true;
  return false;
}

function collectSignals(state: SessionState, userMessage?: string): OrchestratorSignals {
  return {
    essayContradiction: essayContradictionSignal(state),
    paragraphDrift: paragraphDriftSignal(state, userMessage),
    sentenceIssuesLikely: sentenceIssueSignal(state, userMessage),
  };
}

function decideFocus(signals: OrchestratorSignals): {
  focusLayer: OrchestratorFocusLayer;
  reason: string;
  conflict: boolean;
  decisionConfidence: number;
} {
  const active = [
    signals.essayContradiction ? "essay" : null,
    signals.paragraphDrift ? "paragraph" : null,
    signals.sentenceIssuesLikely ? "sentence" : null,
  ].filter(Boolean) as OrchestratorFocusLayer[];

  const conflict = active.length > 1;
  if (signals.essayContradiction) {
    return {
      focusLayer: "essay",
      reason: "essay contradiction detected",
      conflict,
      decisionConfidence: conflict ? 0.55 : 0.85,
    };
  }
  if (signals.paragraphDrift) {
    return {
      focusLayer: "paragraph",
      reason: "paragraph role drift detected",
      conflict,
      decisionConfidence: conflict ? 0.6 : 0.8,
    };
  }
  return {
    focusLayer: "sentence",
    reason: "no higher-level contradiction; sentence execution",
    conflict,
    decisionConfidence: signals.sentenceIssuesLikely ? 0.75 : 0.9,
  };
}

function fallbackIfUnsafe(decision: {
  focusLayer: OrchestratorFocusLayer;
  reason: string;
  conflict: boolean;
  decisionConfidence: number;
}): { focusLayer: OrchestratorFocusLayer; reason: string; fallbackApplied: boolean; decisionConfidence: number; conflict: boolean } {
  if (decision.conflict || decision.decisionConfidence < 0.58) {
    return {
      focusLayer: "sentence",
      reason: "fallback: low-confidence or conflicting signals",
      fallbackApplied: true,
      decisionConfidence: Math.min(decision.decisionConfidence, 0.58),
      conflict: decision.conflict,
    };
  }
  return { ...decision, fallbackApplied: false };
}

function scoreEssayConfidence(state: SessionState, signals: OrchestratorSignals): number {
  const hasHandoff = !!state.handoffLocked && !!state.s2?.body1Point?.trim() && !!state.s2?.body2Point?.trim();
  const hasBodyDrafts =
    !!state.s2?.body1?.draft?.trim() &&
    !!state.s2?.body2?.draft?.trim();
  let score = 0;
  if (hasHandoff) score += 0.45;
  if (hasBodyDrafts) score += 0.35;
  if (!signals.essayContradiction) score += 0.2;
  return clamp01(score);
}

function scoreParagraphConfidence(state: SessionState, currentBody: BodyKey | undefined, signals: OrchestratorSignals): number {
  if (!currentBody || currentBody === "conclusion") return 0.7;
  const seg = currentBody === "body1" ? state.s2?.body1 : state.s2?.body2;
  let score = 0;
  if (seg?.draft?.trim()) score += 0.4;
  if ((seg?.slots?.claim || seg?.slots?.reason || seg?.slots?.example || seg?.slots?.link)) score += 0.35;
  if (!signals.paragraphDrift) score += 0.25;
  return clamp01(score);
}

export function buildOrchestratorSnapshot(
  state: SessionState,
  userMessage?: string,
): OrchestratorSnapshot | undefined {
  if (state.stage !== 3 || !state.s3) return undefined;
  const prev = state.s3.orchestrator;
  const signals = collectSignals(state, userMessage);
  const decision = decideFocus(signals);
  const guarded = fallbackIfUnsafe(decision);
  const rawE = scoreEssayConfidence(state, signals);
  const rawP = scoreParagraphConfidence(state, state.s3.currentBody, signals);

  return {
    mode: resolveOrchestratorMode(prev),
    focusLayer: guarded.focusLayer,
    reason: guarded.reason,
    essayConfidence: smooth(prev?.essayConfidence, rawE),
    paragraphConfidence: smooth(prev?.paragraphConfidence, rawP),
    decisionConfidence: smooth(prev?.decisionConfidence, guarded.decisionConfidence, 0.5),
    conflict: guarded.conflict,
    fallbackApplied: guarded.fallbackApplied,
    essayContradiction: signals.essayContradiction,
    paragraphDrift: signals.paragraphDrift,
    sentenceIssuesLikely: signals.sentenceIssuesLikely,
  };
}

export function applyOrchestratorShadow(
  state: SessionState,
  userMessage?: string,
): SessionState {
  const snapshot = buildOrchestratorSnapshot(state, userMessage);
  if (!snapshot || !state.s3) return state;
  return {
    ...state,
    s3: {
      ...state.s3,
      orchestrator: snapshot,
    },
  };
}
