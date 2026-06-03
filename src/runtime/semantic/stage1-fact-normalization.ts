/**
 * Deterministic fact → canonical concept ID (no LLM).
 */
import {
  isKnownBenefitConcept,
  isKnownDrawbackConcept,
} from "./stage1-concept-catalog";
import {
  normalizeConceptId,
  projectConceptsFromText,
  type Stage1ConceptId,
} from "./theme-normalization";

export type FactSide = "benefit" | "drawback";

export function normalizeFactToCanonical(
  input: string,
  side: FactSide,
): Stage1ConceptId | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = normalizeConceptId(trimmed) as Stage1ConceptId;
  if (side === "benefit" && direct === "implicit_benefit") return direct;
  if (side === "drawback" && direct === "implicit_drawback") return direct;
  const directOk =
    side === "benefit"
      ? isKnownBenefitConcept(direct)
      : isKnownDrawbackConcept(direct);
  if (directOk) return direct;

  const projected = projectConceptsFromText(trimmed);
  const candidates = side === "benefit" ? projected.benefits : projected.drawbacks;
  return candidates[0] ?? null;
}

export function normalizeConcepts(input: {
  benefits?: string[];
  drawbacks?: string[];
}): { benefits: Stage1ConceptId[]; drawbacks: Stage1ConceptId[] } {
  const benefits: Stage1ConceptId[] = [];
  const drawbacks: Stage1ConceptId[] = [];
  for (const raw of input.benefits ?? []) {
    const id = normalizeFactToCanonical(raw, "benefit");
    if (id && !benefits.includes(id)) benefits.push(id);
  }
  for (const raw of input.drawbacks ?? []) {
    const id = normalizeFactToCanonical(raw, "drawback");
    if (id && !drawbacks.includes(id)) drawbacks.push(id);
  }
  return { benefits, drawbacks };
}
