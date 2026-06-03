/**
 * Stage1 semantic pipeline: LLM projection → normalize → commit gate → STATE.
 * Monotonic commits only; downstream reads STATE without re-extraction.
 */
import type {
  CoachContext,
  SessionState,
  Stage1ThemeProjection,
} from "@/lib/domain/types";
import {
  isKnownBenefitConcept,
  isKnownDrawbackConcept,
} from "@/runtime/semantic/stage1-concept-catalog";
import {
  normalizeFactToCanonical,
  type FactSide,
} from "@/runtime/semantic/stage1-fact-normalization";
import {
  inferPositionFromText,
  projectConceptsFromText,
  type Stage1ConceptId,
} from "@/runtime/semantic/theme-normalization";

export const COMMIT_CONFIDENCE_THRESHOLD = 0.7;

export type Stage1Stance = Stage1ThemeProjection["stance"];
export type PositionLean = Stage1ThemeProjection["positionLean"];

export function stanceToPositionLean(stance: Stage1Stance): PositionLean {
  if (stance === "positive") return "pro";
  if (stance === "negative") return "con";
  if (stance === "mixed") return "balanced";
  return "unknown";
}

export type SemanticFactRaw = {
  type?: unknown;
  concept?: unknown;
  normalized_concept?: unknown;
  confidence?: unknown;
};

export type LlmSemanticProjectionRaw = {
  stance?: unknown;
  facts?: unknown;
};

/** @deprecated legacy schema adapter */
export type LlmThemeProjectionRaw = {
  benefits?: unknown;
  drawbacks?: unknown;
  benefit?: unknown;
  drawback?: unknown;
  stance?: unknown;
  facts?: unknown;
};

export type SanitizedSemanticFact = {
  type: FactSide;
  concept: string;
  normalizedConcept: Stage1ConceptId;
  confidence: number;
};

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeFactSide(raw: unknown): FactSide | null {
  if (raw === "benefit" || raw === "drawback") return raw;
  return null;
}

export function sanitizeStance(raw: unknown): Stage1Stance {
  if (raw === "positive" || raw === "negative" || raw === "mixed") return raw;
  if (raw === "unclear" || raw === "unknown") return "unknown";
  return "unknown";
}

function isCommittableConcept(id: Stage1ConceptId, type: FactSide): boolean {
  if (type === "benefit" && id === "implicit_benefit") return true;
  if (type === "drawback" && id === "implicit_drawback") return true;
  return type === "benefit"
    ? isKnownBenefitConcept(id)
    : isKnownDrawbackConcept(id);
}

export function sanitizeSemanticFacts(raw: unknown): SanitizedSemanticFact[] {
  if (!Array.isArray(raw)) return [];
  const out: SanitizedSemanticFact[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as SemanticFactRaw;
    const type = sanitizeFactSide(row.type);
    if (!type) continue;

    const concept =
      typeof row.concept === "string" ? row.concept.trim() : "";
    const normalizedInput =
      typeof row.normalized_concept === "string"
        ? row.normalized_concept.trim()
        : concept;
    const normalizedConcept = normalizeFactToCanonical(normalizedInput, type);
    if (!normalizedConcept) continue;

    const sideOk = isCommittableConcept(normalizedConcept, type);
    if (!sideOk) continue;

    const key = `${type}:${normalizedConcept}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      type,
      concept: concept || normalizedInput,
      normalizedConcept,
      confidence: clampConfidence(row.confidence),
    });
  }

  return out;
}

/** Rules-only step-1 input when LLM is disabled (CI / replay). */
export function rulesFactsFromUserMessage(message: string): LlmSemanticProjectionRaw {
  const text = message.trim();
  if (!text) return { stance: "unclear", facts: [] };

  const inferred = inferPositionFromText(text);
  let stance: Stage1Stance = "unknown";
  if (inferred === "pro") stance = "positive";
  else if (inferred === "con") stance = "negative";
  else if (inferred === "balanced") stance = "mixed";

  const projected = projectConceptsFromText(text);
  const facts: SemanticFactRaw[] = [];

  for (const id of projected.benefits) {
    facts.push({
      type: "benefit",
      concept: text,
      normalized_concept: id,
      confidence: 0.85,
    });
  }
  for (const id of projected.drawbacks) {
    facts.push({
      type: "drawback",
      concept: text,
      normalized_concept: id,
      confidence: 0.85,
    });
  }

  if (
    facts.length === 0 &&
    stance === "positive" &&
    /积极|好处|利大于|positive/i.test(text)
  ) {
    facts.push({
      type: "benefit",
      concept: text,
      normalized_concept: "implicit_benefit",
      confidence: 0.8,
    });
  }

  return { stance, facts };
}

function emptyProjection(turnIndex: number, source: "llm" | "rules"): Stage1ThemeProjection {
  return {
    benefit: [],
    drawback: [],
    stance: "unknown",
    benefits: [],
    drawbacks: [],
    concepts: [],
    positionLean: "unknown",
    themesComplete: false,
    readyToFinalize: false,
    source,
    turnIndex,
  };
}

function mergeStanceMonotonic(
  existing: Stage1Stance,
  incoming: Stage1Stance,
): Stage1Stance {
  if (incoming === "unknown") return existing;
  if (existing === "unknown") return incoming;
  return existing;
}

function pushConcept(
  list: string[],
  concepts: Set<string>,
  id: Stage1ConceptId,
): void {
  if (concepts.has(id)) return;
  concepts.add(id);
  list.push(id);
}

/**
 * Step 3–4: confidence gate + monotonic STATE merge (never delete committed facts).
 */
export function mergeMonotonicSemanticState(
  existing: Stage1ThemeProjection | null,
  raw: LlmSemanticProjectionRaw,
  meta: { source: "llm" | "rules"; turnIndex: number },
): Stage1ThemeProjection {
  const base =
    existing && existing.concepts !== undefined
      ? {
          ...existing,
          benefit: [...existing.benefit],
          drawback: [...existing.drawback],
          concepts: [...(existing.concepts ?? [...existing.benefit, ...existing.drawback])],
        }
      : emptyProjection(meta.turnIndex, meta.source);

  const facts = sanitizeSemanticFacts(raw.facts);
  const approved = facts.filter((f) => f.confidence >= COMMIT_CONFIDENCE_THRESHOLD);
  const conceptSet = new Set<string>(base.concepts ?? []);

  const benefit = [...base.benefit];
  const drawback = [...base.drawback];

  for (const fact of approved) {
    if (fact.type === "benefit") {
      pushConcept(benefit, conceptSet, fact.normalizedConcept);
    } else {
      pushConcept(drawback, conceptSet, fact.normalizedConcept);
    }
  }

  const stance = mergeStanceMonotonic(base.stance, sanitizeStance(raw.stance));

  return finalizeProjectionShape({
    benefit,
    drawback,
    stance,
    concepts: [...conceptSet],
    source: meta.source,
    turnIndex: meta.turnIndex,
    readyToFinalize: base.readyToFinalize ?? false,
  });
}

export function bootstrapSemanticStateFromRules(
  messages: string[],
): Stage1ThemeProjection {
  let state: Stage1ThemeProjection | null = null;
  for (let i = 0; i < messages.length; i++) {
    const raw = rulesFactsFromUserMessage(messages[i] ?? "");
    state = mergeMonotonicSemanticState(state, raw, {
      source: "rules",
      turnIndex: i + 1,
    });
  }
  return state ?? emptyProjection(0, "rules");
}

function finalizeProjectionShape(input: {
  benefit: string[];
  drawback: string[];
  stance: Stage1Stance;
  concepts: string[];
  source: "llm" | "rules";
  turnIndex: number;
  readyToFinalize: boolean;
}): Stage1ThemeProjection {
  const positionLean = stanceToPositionLean(input.stance);
  const themesComplete =
    input.benefit.length >= 1 &&
    input.drawback.length >= 1 &&
    input.stance !== "unknown";

  return {
    benefit: input.benefit,
    drawback: input.drawback,
    stance: input.stance,
    benefits: [...input.benefit],
    drawbacks: [...input.drawback],
    concepts: input.concepts,
    positionLean,
    themesComplete,
    readyToFinalize: input.readyToFinalize,
    source: input.source,
    turnIndex: input.turnIndex,
  };
}

/** @deprecated use mergeMonotonicSemanticState */
export function sanitizeLlmThemeProjection(raw: LlmThemeProjectionRaw): {
  benefit: string[];
  drawback: string[];
  stance: Stage1Stance;
  source: "llm";
} {
  if (Array.isArray(raw.facts)) {
    const merged = mergeMonotonicSemanticState(null, raw, {
      source: "llm",
      turnIndex: 0,
    });
    return {
      benefit: merged.benefit,
      drawback: merged.drawback,
      stance: merged.stance,
      source: "llm",
    };
  }

  const legacyFacts: SemanticFactRaw[] = [];
  const benefitList = raw.benefits ?? raw.benefit;
  const drawbackList = raw.drawbacks ?? raw.drawback;
  if (Array.isArray(benefitList)) {
    for (const item of benefitList) {
      if (typeof item === "string") {
        legacyFacts.push({
          type: "benefit",
          concept: item,
          normalized_concept: item,
          confidence: 0.85,
        });
      }
    }
  }
  if (Array.isArray(drawbackList)) {
    for (const item of drawbackList) {
      if (typeof item === "string") {
        legacyFacts.push({
          type: "drawback",
          concept: item,
          normalized_concept: item,
          confidence: 0.85,
        });
      }
    }
  }
  const merged = mergeMonotonicSemanticState(
    null,
    { stance: raw.stance, facts: legacyFacts },
    { source: "llm", turnIndex: 0 },
  );
  return {
    benefit: merged.benefit,
    drawback: merged.drawback,
    stance: merged.stance,
    source: "llm",
  };
}

/** @deprecated use mergeMonotonicSemanticState */
export function commitStage1ThemeProjection(
  state: SessionState,
  messages: string[],
  input: { llmRaw?: LlmThemeProjectionRaw; source: "llm" | "rules" },
): Stage1ThemeProjection {
  void state;
  if (input.llmRaw) {
    return mergeMonotonicSemanticState(
      readStage1ThemeProjection(state),
      input.llmRaw,
      { source: input.source, turnIndex: messages.length },
    );
  }
  return bootstrapSemanticStateFromRules(messages);
}

export function readStage1ThemeProjection(
  state: SessionState,
): Stage1ThemeProjection | null {
  return state.coachContext?.stage1ThemeProjection ?? null;
}

export function isStage1ProjectionFresh(
  state: SessionState,
  messageCount: number,
): boolean {
  const proj = readStage1ThemeProjection(state);
  if (!proj) return false;
  return proj.turnIndex === messageCount;
}

export function attachStage1ThemeProjection(
  state: SessionState,
  projection: Stage1ThemeProjection,
): SessionState {
  return {
    ...state,
    coachContext: {
      ...state.coachContext,
      stage1ThemeProjection: projection,
    } as CoachContext,
  };
}

/** Read committed STATE only — no re-extraction. */
export function getStage1ThemeProjection(
  state: SessionState,
  _messages?: string[],
): Stage1ThemeProjection {
  return (
    readStage1ThemeProjection(state) ??
    emptyProjection(0, "rules")
  );
}

export const resolveStage1ThemeProjection = getStage1ThemeProjection;

export function projectionThemesComplete(
  projection: Stage1ThemeProjection,
): boolean {
  return projection.themesComplete;
}
