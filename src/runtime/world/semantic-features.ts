import type { SemanticFeatures } from "../types";

const STANCE_RE = /我认为|我觉得|我倾向|利大于弊|弊大于利|overall|more harm|more benefit/i;
const CONCESSION_RE = /虽然|尽管|but|however|缺点|坏处|drawback|negative|可控|补救|规范|限制|mitigat/i;
const CAUSAL_RE = /因为|导致|带来|造成|所以|therefore|thus|result|lead to|使得|让|通过/gi;
const EXAMPLE_RE = /比如|例如|for example|such as|像|举例/gi;
const CLOSURE_RE = /因此|所以|overall|总之|in conclusion|thus|这意味着/gi;
const GENERIC_RE = /convenient|good|bad|方便|很好|不好|maybe|可能|不知道|I don't know/i;
const MINIMAL_RE = /^(不知道|不清楚|I don't know\.?|maybe|可能吧)[\s.!？?]*$/i;

function countMatches(text: string, re: RegExp): string[] {
  const flags = re.flags.includes("g") ? re : new RegExp(re.source, re.flags + "g");
  return text.match(flags) ?? [];
}

function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const cjk = t.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = t.split(/\s+/).filter(Boolean).length;
  return cjk > 0 ? cjk + words : words;
}

export function extractSemanticFeatures(
  userMessage: string,
  chatBlob?: string,
): SemanticFeatures {
  const blob = [chatBlob ?? "", userMessage].join("\n");
  const benefits = (blob.match(/好处|优点|benefit|advantage/gi) ?? []).length;
  const drawbacks = (blob.match(/坏处|缺点|drawback|disadvantage|harm/gi) ?? []).length;

  return {
    hasStance: STANCE_RE.test(blob),
    stanceMarkers: countMatches(blob, STANCE_RE),
    hasConcession: CONCESSION_RE.test(blob),
    concessionMarkers: countMatches(blob, CONCESSION_RE),
    benefitCount: benefits,
    drawbackCount: drawbacks,
    bodyPointCount: { body1: 0, body2: 0 },
    causalMarkers: countMatches(blob, CAUSAL_RE),
    exampleMarkers: countMatches(blob, EXAMPLE_RE),
    closureMarkers: countMatches(blob, CLOSURE_RE),
    exampleCount: countMatches(blob, EXAMPLE_RE).length,
    topicTerms: [],
    genericPhrases: countMatches(blob, GENERIC_RE),
    responseWordCount: wordCount(userMessage),
  };
}

export function isMinimalComplianceMessage(userMessage: string): boolean {
  const t = userMessage.trim();
  if (MINIMAL_RE.test(t)) return true;
  if (wordCount(t) <= 6 && GENERIC_RE.test(t)) return true;
  return false;
}
