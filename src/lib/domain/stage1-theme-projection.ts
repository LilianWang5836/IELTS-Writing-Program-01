/**
 * Stage1 theme STATE commit — single pipeline: (LLM raw | rules) → sanitize → STATE.
 * No second extraction layer; extractExplorationThemes only passthroughs this shape.
 */
import { harvestExplorationSnippets } from "@/lib/domain/stage1-snippet-harvest";
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
  inferPositionFromText,
  normalizeConceptId,
  projectConceptsFromMessages,
  projectConceptsFromText,
  type Stage1ConceptId,
} from "@/runtime/semantic/theme-normalization";

export type Stage1Stance = Stage1ThemeProjection["stance"];
export type PositionLean = Stage1ThemeProjection["positionLean"];

export function stanceToPositionLean(stance: Stage1Stance): PositionLean {
  if (stance === "positive") return "pro";
  if (stance === "negative") return "con";
  if (stance === "mixed") return "balanced";
  return "unknown";
}

export type LlmThemeProjectionRaw = {
  /** New schema (preferred) */
  benefits?: unknown;
  drawbacks?: unknown;
  /** Legacy aliases */
  benefit?: unknown;
  drawback?: unknown;
  stance?: unknown;
  benefitSnippets?: unknown;
  drawbackSnippets?: unknown;
  topics?: unknown;
  confidence?: unknown;
};

function pushUnique(arr: string[], piece: string): void {
  const t = piece.trim();
  if (t.length < 4) return;
  if (arr.some((x) => x === t || x.includes(t) || t.includes(x))) return;
  arr.push(t);
}

function rawConceptList(raw: LlmThemeProjectionRaw, side: "benefit" | "drawback"): unknown {
  if (side === "benefit") {
    return raw.benefits ?? raw.benefit;
  }
  return raw.drawbacks ?? raw.drawback;
}

function resolveConceptItem(
  item: string,
  side: "benefit" | "drawback",
): Stage1ConceptId[] {
  const id = normalizeConceptId(item.trim()) as Stage1ConceptId;
  const known =
    side === "benefit" ? isKnownBenefitConcept(id) : isKnownDrawbackConcept(id);
  if (known) return [id];

  const projected = projectConceptsFromText(item);
  return side === "benefit" ? projected.benefits : projected.drawbacks;
}

function sanitizeConceptList(
  raw: unknown,
  side: "benefit" | "drawback",
): Stage1ConceptId[] {
  if (!Array.isArray(raw)) return [];
  const out: Stage1ConceptId[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    for (const id of resolveConceptItem(item, side)) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

function sanitizeTopics(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().replace(/\s+/g, "_").slice(0, 48))
    .filter(Boolean);
  return out.length ? out.slice(0, 3) : undefined;
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function sanitizeConfidence(raw: unknown): Stage1ThemeProjection["confidence"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const benefits = clampConfidence(row.benefits);
  const drawbacks = clampConfidence(row.drawbacks);
  if (benefits === undefined && drawbacks === undefined) return undefined;
  return { benefits, drawbacks };
}

function sanitizeSnippets(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 48);
  return out.length ? out.slice(0, 2) : undefined;
}

function sanitizeStance(raw: unknown): Stage1Stance {
  if (raw === "positive" || raw === "negative" || raw === "mixed") return raw;
  if (raw === "unclear" || raw === "unknown") return "unknown";
  return "unknown";
}

function dedupeAcrossSides(
  benefit: Stage1ConceptId[],
  drawback: Stage1ConceptId[],
): { benefit: Stage1ConceptId[]; drawback: Stage1ConceptId[] } {
  const overlap = new Set(benefit.filter((id) => drawback.includes(id)));
  if (overlap.size === 0) return { benefit, drawback };
  return {
    benefit: benefit.filter((id) => !overlap.has(id)),
    drawback: drawback.filter((id) => !overlap.has(id)),
  };
}

/** LLM JSON → canonical fields (internal step of commitStage1ThemeProjection). */
export function sanitizeLlmThemeProjection(raw: LlmThemeProjectionRaw): {
  benefit: string[];
  drawback: string[];
  stance: Stage1Stance;
  benefitSnippets?: string[];
  drawbackSnippets?: string[];
  topics?: string[];
  confidence?: Stage1ThemeProjection["confidence"];
  source: "llm";
} {
  let benefit = sanitizeConceptList(rawConceptList(raw, "benefit"), "benefit");
  let drawback = sanitizeConceptList(rawConceptList(raw, "drawback"), "drawback");
  ({ benefit, drawback } = dedupeAcrossSides(benefit, drawback));

  return {
    benefit,
    drawback,
    stance: sanitizeStance(raw.stance),
    benefitSnippets: sanitizeSnippets(raw.benefitSnippets),
    drawbackSnippets: sanitizeSnippets(raw.drawbackSnippets),
    topics: sanitizeTopics(raw.topics),
    confidence: sanitizeConfidence(raw.confidence),
    source: "llm",
  };
}

function inferPositionLeanFromBlob(blob: string): PositionLean {
  if (/弊大于利|坏处更多|劣势更大|disadvantages?\s+outweigh/i.test(blob)) {
    return "con";
  }
  if (
    /利大于弊|好处更多|优势更大|overall.*benefit|advantages?\s+outweigh|好处多/i.test(
      blob,
    )
  ) {
    return "pro";
  }
  if (/各有|都有|平衡|相当/i.test(blob)) return "balanced";
  return "unknown";
}

function sidePresent(
  benefit: string[],
  drawback: string[],
  benefitSnippets: string[] | undefined,
  drawbackSnippets: string[] | undefined,
  side: "benefit" | "drawback",
): boolean {
  if (side === "benefit") {
    return benefit.length >= 1 || (benefitSnippets?.length ?? 0) >= 1;
  }
  return drawback.length >= 1 || (drawbackSnippets?.length ?? 0) >= 1;
}

function buildRulesConcepts(messages: string[]): {
  benefit: string[];
  drawback: string[];
  stance: Stage1Stance;
  benefitSnippets?: string[];
  drawbackSnippets?: string[];
} {
  const projected = projectConceptsFromMessages(messages);
  const blob = messages.join("\n");
  const inferred = inferPositionFromText(blob);

  let stance: Stage1Stance = "unknown";
  if (inferred === "pro") stance = "positive";
  else if (inferred === "con") stance = "negative";
  else if (inferred === "balanced") stance = "mixed";

  const benefit = [...projected.benefits];
  const drawback = [...projected.drawbacks];

  if (benefit.length === 0 && stance === "positive") {
    benefit.push("implicit_benefit");
  }

  const { benefitSnippets, drawbackSnippets } = harvestExplorationSnippets(messages);

  for (const s of benefitSnippets) {
    for (const id of projectConceptsFromText(s).benefits) {
      if (!benefit.includes(id)) benefit.push(id);
    }
  }
  for (const s of drawbackSnippets) {
    for (const id of projectConceptsFromText(s).drawbacks) {
      if (!drawback.includes(id)) drawback.push(id);
    }
  }

  if (drawback.length === 0 && drawbackSnippets.length >= 1 && stance !== "unknown") {
    drawback.push("implicit_drawback");
  }

  return {
    benefit,
    drawback,
    stance,
    benefitSnippets: benefitSnippets.length ? benefitSnippets : undefined,
    drawbackSnippets: drawbackSnippets.length ? drawbackSnippets : undefined,
  };
}

function mergeDisplayLists(
  concepts: string[],
  snippets: string[] | undefined,
): string[] {
  const out = [...concepts];
  for (const s of snippets ?? []) {
    pushUnique(out, s);
  }
  return out;
}

/**
 * Single commit: sanitize (LLM or rules) → full Stage1ThemeProjection STATE.
 * readyToFinalize stays false until enrichStage1ThemeProjection.
 */
export function commitStage1ThemeProjection(
  state: SessionState,
  messages: string[],
  input: { llmRaw?: LlmThemeProjectionRaw; source: "llm" | "rules" },
): Stage1ThemeProjection {
  const rulesFallback = buildRulesConcepts(messages);

  let benefit: string[];
  let drawback: string[];
  let stance: Stage1Stance;
  let benefitSnippets: string[] | undefined;
  let drawbackSnippets: string[] | undefined;
  let topics: string[] | undefined;
  let confidence: Stage1ThemeProjection["confidence"];
  let source = input.source;

  if (input.llmRaw) {
    const sanitized = sanitizeLlmThemeProjection(input.llmRaw);
    benefit = sanitized.benefit.length ? sanitized.benefit : rulesFallback.benefit;
    drawback = sanitized.drawback.length ? sanitized.drawback : rulesFallback.drawback;
    stance =
      sanitized.stance !== "unknown" ? sanitized.stance : rulesFallback.stance;
    benefitSnippets = sanitized.benefitSnippets?.length
      ? sanitized.benefitSnippets
      : rulesFallback.benefitSnippets;
    drawbackSnippets = sanitized.drawbackSnippets?.length
      ? sanitized.drawbackSnippets
      : rulesFallback.drawbackSnippets;
    topics = sanitized.topics;
    confidence = sanitized.confidence;
    source = "llm";
  } else {
    benefit = rulesFallback.benefit;
    drawback = rulesFallback.drawback;
    stance = rulesFallback.stance;
    benefitSnippets = rulesFallback.benefitSnippets;
    drawbackSnippets = rulesFallback.drawbackSnippets;
    topics = undefined;
    confidence = undefined;
    source = "rules";
  }

  const benefits = mergeDisplayLists(benefit, benefitSnippets);
  const drawbacks = mergeDisplayLists(drawback, drawbackSnippets);

  let positionLean = stanceToPositionLean(stance);
  if (positionLean === "unknown") {
    positionLean = inferPositionLeanFromBlob(
      [
        messages.join("\n"),
        state.handoff?.position ?? "",
        state.s1?.position ?? "",
      ].join("\n"),
    );
  }

  const themesComplete =
    sidePresent(benefit, drawback, benefitSnippets, drawbackSnippets, "benefit") &&
    sidePresent(benefit, drawback, benefitSnippets, drawbackSnippets, "drawback") &&
    stance !== "unknown";

  return {
    benefit,
    drawback,
    stance,
    benefitSnippets,
    drawbackSnippets,
    benefits,
    drawbacks,
    positionLean,
    themesComplete,
    readyToFinalize: false,
    topics,
    confidence,
    source,
    turnIndex: messages.length,
  };
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

function projectionNeedsRecommit(proj: Stage1ThemeProjection | null): boolean {
  if (!proj) return true;
  return proj.benefits === undefined || proj.drawbacks === undefined;
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

/**
 * Read fresh STATE or rules commit (no readyToFinalize enrich — caller or extract handles that).
 */
export function getStage1ThemeProjection(
  state: SessionState,
  messages: string[],
): Stage1ThemeProjection {
  const stored = readStage1ThemeProjection(state);
  if (
    stored &&
    isStage1ProjectionFresh(state, messages.length) &&
    !projectionNeedsRecommit(stored)
  ) {
    return stored;
  }
  return commitStage1ThemeProjection(state, messages, { source: "rules" });
}

/** @deprecated use getStage1ThemeProjection */
export const resolveStage1ThemeProjection = getStage1ThemeProjection;

export function projectionThemesComplete(
  projection: Stage1ThemeProjection,
): boolean {
  return projection.themesComplete;
}
