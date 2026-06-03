/**
 * 内层：话语功能分数 + Coverage 聚合；外层 slots 仅为投影（UI / Stage3）。
 */
import {
  hasExampleLead,
  isExampleSentence,
  isLinkSentence,
  isTooSimilarToClaim,
  isWeakExampleSentence,
  looksLikeHandoffClaim,
  normalizeHandoffClaimForChain,
  type ChainBuildStep,
} from "./chain-scaffold";
import type { ParagraphSlots, WorkshopBodyKey } from "./types";

export type FunctionType = "claim" | "causal" | "grounding" | "closure";

export type CoverageNeed = FunctionType | "ready";

/** RFC-2: multi-signal scoring per sentence (no mutual suppression). */
export type DiscourseSignals = {
  causal: number;
  closure: number;
  grounding: number;
};

/** @deprecated 单标签数组；由 DiscourseSignals 投影 */
export interface DetectedFunction {
  type: FunctionType;
  strength: number;
}

export interface DiscourseSentence {
  text: string;
  signals: DiscourseSignals;
}

export interface BodyDiscourseMemory {
  claim?: string;
  sentences: DiscourseSentence[];
  coverage: CoverageState;
}

export interface CoverageState {
  claim: number;
  causal: number;
  grounding: number;
  closure: number;
}

export interface ParagraphWorkflowState {
  coverage: CoverageState;
  currentNeed: CoverageNeed;
  canAdvance: boolean;
  canPropose: boolean;
}

/** @deprecated 兼容旧调用；由 CoverageState 派生 */
export type CoverageGap = "causal" | "grounding" | "closure";

export interface ParagraphCoverage {
  claimEstablished: boolean;
  causalExplained: boolean;
  concreteGrounding: boolean;
  argumentativeClosure: boolean;
  missing: CoverageGap[];
  scores: CoverageState;
}

const THRESHOLD = {
  claim: 0.7,
  causal: 0.7,
  grounding: 0.6,
  closure: 0.5,
} as const;

export function emptyCoverageState(claim?: string): CoverageState {
  return {
    claim: claim?.trim() ? 1 : 0,
    causal: 0,
    grounding: 0,
    closure: 0,
  };
}

export function updateCoverage(
  prev: CoverageState,
  detected: DetectedFunction[],
): CoverageState {
  const next = { ...prev };
  for (const fn of detected) {
    const k = fn.type;
    const s = Math.max(0, Math.min(1, fn.strength));
    next[k] = Math.max(next[k], s);
  }
  return next;
}

export function updateCoverageFromSignals(
  prev: CoverageState,
  signals: DiscourseSignals,
): CoverageState {
  return {
    claim: prev.claim,
    causal: Math.max(prev.causal, signals.causal),
    grounding: Math.max(prev.grounding, signals.grounding),
    closure: Math.max(prev.closure, signals.closure),
  };
}

export function aggregateCausal(signals: DiscourseSignals): number {
  return signals.causal;
}

export function aggregateClosure(signals: DiscourseSignals): number {
  return signals.closure;
}

export function aggregateGrounding(signals: DiscourseSignals): number {
  return signals.grounding;
}

/** @deprecated 将 multi-signal 投影为旧 DetectedFunction[]（带可选阈值过滤） */
export function signalsToDetectedFunctions(
  signals: DiscourseSignals,
  floors: Partial<Record<"causal" | "closure" | "grounding", number>> = {},
): DetectedFunction[] {
  const out: DetectedFunction[] = [];
  const causalFloor = floors.causal ?? 0;
  const closureFloor = floors.closure ?? 0.45;
  const groundingFloor = floors.grounding ?? 0;

  if (signals.closure >= closureFloor) {
    out.push({ type: "closure", strength: signals.closure });
  }
  if (signals.causal > causalFloor) {
    out.push({ type: "causal", strength: signals.causal });
  }
  if (signals.grounding > groundingFloor) {
    out.push({ type: "grounding", strength: signals.grounding });
  }
  return out;
}

export function countActiveDiscourseSignals(signals: DiscourseSignals): number {
  let n = 0;
  if (signals.causal >= 0.35) n++;
  if (signals.closure >= 0.45) n++;
  if (signals.grounding > 0) n++;
  return n;
}

const STRONG_CAUSAL = 0.85;
const STRONG_GROUNDING = 0.82;

/** RFC-3: relative weakness = 1 - signal score */
export type SignalGapMap = {
  causal: number;
  grounding: number;
  closure: number;
};

const GAP_NEED_ORDER: CoverageGap[] = ["causal", "grounding", "closure"];

/** When all gaps are tiny, treat discourse as ready for routing. */
const READY_GAP_EPSILON = 0.05;

export function computeSignalGaps(coverage: CoverageState): SignalGapMap {
  return {
    causal: Math.max(0, 1 - coverage.causal),
    grounding: Math.max(0, 1 - coverage.grounding),
    closure: Math.max(0, 1 - coverage.closure),
  };
}

/** RFC-3: pick the dimension with the largest relative gap (tie → causal > grounding > closure). */
export function argmaxSignalGap(gaps: SignalGapMap): CoverageGap {
  let best: CoverageGap = "causal";
  let bestGap = gaps.causal;
  for (const key of GAP_NEED_ORDER) {
    if (gaps[key] > bestGap + 1e-9) {
      best = key;
      bestGap = gaps[key];
    }
  }
  return best;
}

/** 论证闭环：立场 + 因果层 + 落地层；收束可独立成句，也可由强因果+强支撑豁免 */
export function isDiscourseArgumentReady(coverage: CoverageState): boolean {
  if (coverage.claim < THRESHOLD.claim) return false;
  if (coverage.causal < THRESHOLD.causal) return false;
  if (coverage.grounding < THRESHOLD.grounding) return false;
  if (coverage.closure >= THRESHOLD.closure) return true;
  return (
    coverage.causal >= STRONG_CAUSAL && coverage.grounding >= STRONG_GROUNDING
  );
}

/** RFC-3 soft policy: readiness gate + argmax(1 − signal). */
export function getNextNeed(coverage: CoverageState): CoverageNeed {
  if (coverage.claim < THRESHOLD.claim) return "claim";
  if (isDiscourseArgumentReady(coverage)) return "ready";

  const gaps = computeSignalGaps(coverage);
  const maxGap = Math.max(gaps.causal, gaps.grounding, gaps.closure);
  if (maxGap <= READY_GAP_EPSILON) return "ready";

  return argmaxSignalGap(gaps);
}

export function needToBuildStep(need: CoverageNeed): ChainBuildStep {
  if (need === "ready") return "ready";
  if (need === "claim") return "claim";
  if (need === "causal") return "reason";
  if (need === "grounding") return "example";
  return "link";
}

export function isCoverageReady(coverage: CoverageState): boolean {
  return isDiscourseArgumentReady(coverage);
}

export function coverageToParagraphCoverage(
  coverage: CoverageState,
): ParagraphCoverage {
  const gaps = computeSignalGaps(coverage);
  const missing: CoverageGap[] = GAP_NEED_ORDER.filter(
    (key) => coverage[key] < THRESHOLD[key],
  ).sort((a, b) => gaps[b] - gaps[a]);
  return {
    claimEstablished: coverage.claim >= THRESHOLD.claim,
    causalExplained: coverage.causal >= THRESHOLD.causal,
    concreteGrounding: coverage.grounding >= THRESHOLD.grounding,
    argumentativeClosure: coverage.closure >= THRESHOLD.closure,
    missing,
    scores: { ...coverage },
  };
}

export function isParagraphCoverageComplete(
  coverage: CoverageState | ParagraphCoverage,
): boolean {
  const s =
    "scores" in coverage
      ? coverage.scores
      : coverage;
  return isCoverageReady(s);
}

export function coverageToBuildStep(
  coverage: CoverageState | ParagraphCoverage,
): ChainBuildStep {
  const s =
    "scores" in coverage
      ? coverage.scores
      : coverage;
  return needToBuildStep(getNextNeed(s));
}

const CAUSAL_CONNECTOR_RE =
  /因为|由于|因此|所以|because|since|as a result|therefore|thus|so that|lead(?:s)? to/i;

const CLOSURE_CONNECTOR_RE =
  /因此|所以|从而|这样一来|可见|总之|综上|therefore|thus|in conclusion|to sum up|overall|in summary/i;

const BODY1_TOPIC_RE =
  /就业|工作|技能|实习|项目|职场|课本|实践|面试|公司|技术栈|游客|旅游|景区|餐饮|住宿|购物|当地|收入|产业|经济|居民|行业|从业|收益|发展|带动|tourism|tourist|tourists|economy|economic|local|restaurant|restaurants|benefit|benefits|society|improve|improves|increase|increases|grow|grows|hotel|hotels|travel|traveller|traveler|income|employment|consume|consumption|shopping/i;

const BODY2_TOPIC_RE =
  /学术|知识|研究|领域|深造|理论|课程|积累|学习|医学|读研|科研|环境|污染|垃圾|破坏|拥堵|居民|生活|景区|游客|影响|不便|academic|research|knowledge|study|learning|university|medical|environment|pollution|resident|society|benefit|benefits/i;

function onTopic(t: string, body: WorkshopBodyKey): boolean {
  if (body === "body1") {
    return BODY1_TOPIC_RE.test(t);
  }
  return BODY2_TOPIC_RE.test(t);
}

export function isClosurePrimarySentence(
  text: string,
  body: WorkshopBodyKey,
  claim?: string,
): boolean {
  const t = text.trim();
  return CLOSURE_CONNECTOR_RE.test(t) && hasFunctionalClosure(t, body, claim);
}

export function hasFunctionalClosure(
  t: string,
  body: WorkshopBodyKey,
  claim?: string,
): boolean {
  const s = t.trim();
  if (s.length < 16 || hasExampleLead(s)) return false;
  if (claim && isTooSimilarToClaim(s, claim, body)) return false;
  if (looksLikeHandoffClaim(s, body)) return false;
  if (!CLOSURE_CONNECTOR_RE.test(s)) return false;
  if (!onTopic(s, body)) return false;

  if (/in conclusion|to sum up|overall|in summary|总之|综上/i.test(s)) {
    return true;
  }

  if (body === "body1") {
    return (
      isLinkSentence(s, body, claim) ||
      (/therefore|thus|因此|所以/i.test(s) &&
        /economy|economic|tourism|tourist|benefit|improve|society|local|income|employment|产业|收入|经济|旅游|游客/.test(
          s,
        ) &&
        /improve|benefit|increase|grow|help|support|boost|enhance|促进|带动|提升|改善/.test(
          s,
        )) ||
      (/就业|求职|面试|上岗|工作|适应|对口|offer|收入|产业|经济|就业|居民/.test(
        s,
      ) &&
        /才能|有助于|更|利于|实现|落到|支撑|带动|增加/.test(s)) ||
      (/因此|所以|therefore|thus/.test(s) &&
        /实践|实习|项目|技能|职场|旅游|游客|产业|收入|就业|经济|当地/.test(
          s,
        ) &&
        /才能|有助于|更|面试|就业|适应|带动|促进|improve|benefit|grow/.test(s))
    );
  }

  return (
    isLinkSentence(s, body, claim) ||
    (/学术|深造|研究|长期|知识|领域|积累|读研|专业|理论/.test(s) &&
      /有必要|很重要|应当|必须|聚焦|打下|基础|才能|有助于|支撑|必要|扎实/.test(
        s,
      )) ||
    (/因此|所以/.test(s) &&
      /学术|深造|研究|长期|知识|领域|积累/.test(s) &&
      /路线|道路|聚焦|必要|重要|应当|必须|才能|有助于/.test(s))
  );
}

function scoreClosure(t: string, body: WorkshopBodyKey, claim?: string): number {
  if (!hasFunctionalClosure(t, body, claim)) return 0;
  let s = 0.55;
  if (isLinkSentence(t, body, claim)) s = 0.88;
  if (/in conclusion|to sum up|overall|in summary|总之|综上/i.test(t)) {
    s = Math.max(s, 0.85);
  }
  if (/因此|所以|therefore|thus/i.test(t)) s += 0.08;
  if (body === "body1" && /就业|求职|面试|上岗|employment|job/i.test(t)) s += 0.1;
  if (body === "body2" && /深造|读研|研究|积累|academic|research/i.test(t)) {
    s += 0.1;
  }
  return Math.min(1, s);
}

/** discourse 层因果机制判定：不依赖 chain-scaffold.isReasonSentence 的 demo 就业词表 */
function hasCausalMechanism(
  raw: string,
  body: WorkshopBodyKey,
  claim?: string,
): boolean {
  const s = raw.trim();
  if (s.length < 10 || !onTopic(s, body)) return false;
  if (hasExampleLead(s) && !/^原因\s*[:：]/i.test(s)) return false;
  if (/^原因\s*[:：]/i.test(s)) return true;
  if (hasFunctionalClosure(s, body, claim)) return false;
  return (
    CAUSAL_CONNECTOR_RE.test(s) ||
    /需要|使得|才能|有助于|变多|增加|扩大|带动|促进|需求|雇佣|赚钱|消费|需求也变大|increase|improve|grow|boost|expand|benefit/.test(
      s,
    )
  );
}

/** 复合因果句：因为/because…因此/therefore… 或 原因：…因此… */
function isCompoundCausalSentence(raw: string): boolean {
  const s = raw.trim();
  return (
    (/因为|because/i.test(s) && /因此|所以|therefore|thus/i.test(s)) ||
    (/^原因\s*[:：]/i.test(s) &&
      /因此|所以|therefore|thus/.test(s) &&
      /因为|由于|变多|需求|餐饮|住宿|购物|游客|餐厅|酒店|雇佣|赚|because|tourist|restaurant|grow|increase/.test(
        s,
      ))
  );
}

/** 无显式连接词但仍表达「为何成立」的机制结构 */
function hasImplicitCausalStructure(s: string, body: WorkshopBodyKey): boolean {
  if (body === "body1") {
    return /带动|促进|需求|变多|扩大|收益|产业|收入|经济|消费|雇佣|从业|发展|需要更多|increase|improve|grow|boost|expand|benefit/.test(
      s,
    );
  }
  return /系统性|由浅入深|长期|积累|需要.*(?:学习|时间|掌握)|无法从.*获得|从.*到.*学/.test(
    s,
  );
}

/** RFC-2 causal signal — 独立打分，不做 closure suppression */
function scoreCausalSignal(
  t: string,
  body: WorkshopBodyKey,
  claim?: string,
): number {
  const s = t.trim();
  if (s.length < 12) return 0;

  let score = 0;

  if (CAUSAL_CONNECTOR_RE.test(s)) {
    score += 0.35;
  } else if (hasImplicitCausalStructure(s, body) && onTopic(s, body)) {
    score += 0.35;
  }

  if (hasCausalMechanism(s, body, claim)) {
    score += 0.3;
  }

  if (isCompoundCausalSentence(s)) {
    score += 0.2;
  }

  if (onTopic(s, body)) {
    score += 0.1;
  }

  if (
    /because|因为|由于/i.test(s) &&
    /increase|improve|grow|boost|benefit|expand|促进|带动|提升|改善|变多|扩大/.test(
      s,
    ) &&
    onTopic(s, body)
  ) {
    score += 0.1;
  }

  if (s.length > 28) {
    score += 0.05;
  }

  // 弱 off-topic 句不抬分（保留 demo 题误触防护）
  if (!onTopic(s, body) && score <= 0.35) {
    return 0;
  }

  if (hasExampleLead(s) && !/^原因\s*[:：]/i.test(s) && score < 0.5) {
    return Math.min(score, 0.15);
  }

  return Math.min(score, 1);
}

/** 仅「提到项目/实习」不足以达到 grounding 阈值；须例如/具体场景 */
function scoreGroundingSignal(t: string, body: WorkshopBodyKey): number {
  const s = t.trim();
  if (s.length < 12) return 0;

  if (hasExampleLead(s) && s.length >= 18) {
    let score = 0.56;
    if (/比如|例如|比方说/.test(s)) score += 0.08;
    if (isExampleSentence(s, body) && !isWeakExampleSentence(s, body)) score += 0.08;
    return Math.min(0.95, score);
  }

  if (isExampleSentence(s, body) && !isWeakExampleSentence(s, body)) {
    return Math.min(0.9, 0.72 + s.length / 300);
  }

  if (body === "body1") {
    if (
      /比如|例如|实习|公司|技术栈|岗位|编程|计算机|餐馆|酒店|景区|旺季|购物|餐饮|住宿/.test(
        s,
      ) &&
      s.length >= 22
    ) {
      return 0.62;
    }
    if (
      /实习|项目|公司|餐馆|酒店|景区|游客|行业/.test(s) &&
      !/比如|例如/.test(s) &&
      s.length >= 20
    ) {
      return 0.38;
    }
  } else {
    if (/比如|例如|医学生|课程|研究|导师|课题|病理/.test(s) && s.length >= 20) {
      return 0.62;
    }
    if (/医学生|课程|研究/.test(s) && !/比如|例如/.test(s)) {
      return 0.3;
    }
  }
  return 0;
}

/** RFC-2: 单句 multi-signal scoring（causal / closure / grounding 并行，互不抑制） */
export function detectFunctionsFromSentence(
  text: string,
  body: WorkshopBodyKey,
  claim?: string,
): DiscourseSignals {
  const t = text.trim();
  if (t.length < 8) {
    return { causal: 0, closure: 0, grounding: 0 };
  }

  const closure = scoreClosure(t, body, claim);
  const causal = scoreCausalSignal(t, body, claim);
  const grounding = scoreGroundingSignal(t, body);

  return { causal, closure, grounding };
}

function mergeDiscourseSignals(
  a: DiscourseSignals,
  b: DiscourseSignals,
): DiscourseSignals {
  return {
    causal: Math.max(a.causal, b.causal),
    closure: Math.max(a.closure, b.closure),
    grounding: Math.max(a.grounding, b.grounding),
  };
}

function isEmptySignals(signals: DiscourseSignals): boolean {
  return signals.causal === 0 && signals.closure === 0 && signals.grounding === 0;
}

export function aggregateCoverage(
  memory: BodyDiscourseMemory,
  body: WorkshopBodyKey,
): CoverageState {
  let state = emptyCoverageState(memory.claim);
  for (const { signals } of memory.sentences) {
    state = updateCoverageFromSignals(state, signals);
  }
  return state;
}

function detectAndAppendSentence(
  memory: BodyDiscourseMemory,
  text: string,
  body: WorkshopBodyKey,
): BodyDiscourseMemory {
  const t = text.trim();
  if (t.length < 8) return memory;

  const signals = detectFunctionsFromSentence(t, body, memory.claim);
  if (isEmptySignals(signals)) return memory;

  const last = memory.sentences[memory.sentences.length - 1];
  let sentences = memory.sentences;
  if (last?.text === t) {
    sentences = [
      ...memory.sentences.slice(0, -1),
      { text: t, signals: mergeDiscourseSignals(last.signals, signals) },
    ];
  } else {
    sentences = [...memory.sentences, { text: t, signals }];
  }

  const nextMemory: BodyDiscourseMemory = {
    ...memory,
    sentences,
    coverage: emptyCoverageState(memory.claim),
  };
  nextMemory.coverage = aggregateCoverage(nextMemory, body);
  return nextMemory;
}

export function buildDiscourseMemory(
  messages: string[],
  body: WorkshopBodyKey,
  claim?: string,
): BodyDiscourseMemory {
  const claimText =
    claim?.trim() ||
    undefined;
  let memory: BodyDiscourseMemory = {
    claim: claimText,
    sentences: [],
    coverage: emptyCoverageState(claimText),
  };
  const seen = new Set<string>();

  for (const raw of messages) {
    const parts = [
      raw.trim(),
      ...raw.split(/[。；;\n]/).map((s) => s.trim()).filter((s) => s.length >= 10),
    ];
    for (const part of parts) {
      const key = part.slice(0, 52);
      if (seen.has(key)) continue;
      seen.add(key);
      memory = detectAndAppendSentence(memory, part, body);
    }
  }
  return memory;
}

export function appendDiscourseTurn(
  memory: BodyDiscourseMemory,
  text: string,
  body: WorkshopBodyKey,
): BodyDiscourseMemory {
  return detectAndAppendSentence(memory, text, body);
}

export function assessParagraphCoverage(
  memory: BodyDiscourseMemory,
  body: WorkshopBodyKey,
): ParagraphCoverage {
  const coverage =
    memory.coverage.claim > 0
      ? memory.coverage
      : aggregateCoverage(memory, body);
  return coverageToParagraphCoverage(coverage);
}

function bestSentenceForFunction(
  memory: BodyDiscourseMemory,
  fn: Exclude<FunctionType, "claim">,
  body: WorkshopBodyKey,
): string | undefined {
  let best = { text: "", score: 0 };
  for (const { text, signals } of memory.sentences) {
    const strength = signals[fn];
    if (strength <= 0) continue;
    let score = strength * 100 + text.length * 0.01;
    if (fn === "grounding" && isWeakExampleSentence(text, body)) score -= 30;
    if (fn === "causal" && isClosurePrimarySentence(text, body, memory.claim)) {
      score -= 40;
    }
    if (score > best.score) {
      best = { text, score };
    }
  }
  return best.text || undefined;
}

/** memory → slots（UI 投影，非推进状态） */
export function projectDiscourseToSlots(
  memory: BodyDiscourseMemory,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const slots: ParagraphSlots = {};
  if (memory.claim?.trim()) slots.claim = memory.claim.trim();

  const causal = bestSentenceForFunction(memory, "causal", body);
  const grounding = bestSentenceForFunction(memory, "grounding", body);
  const closure = bestSentenceForFunction(memory, "closure", body);

  if (causal && !isClosurePrimarySentence(causal, body, memory.claim)) {
    slots.reason = causal;
  }
  if (grounding && grounding !== slots.reason) slots.example = grounding;
  if (
    closure &&
    closure !== slots.reason?.trim() &&
    closure !== slots.example?.trim()
  ) {
    slots.link = closure;
  }

  return slots;
}

export function buildParagraphWorkflowState(
  coverage: CoverageState,
  opts?: { canPropose?: boolean },
): ParagraphWorkflowState {
  const currentNeed = getNextNeed(coverage);
  return {
    coverage,
    currentNeed,
    canAdvance: currentNeed === "ready",
    canPropose: !!opts?.canPropose,
  };
}

export function seedClaimOnSlots(
  slots: ParagraphSlots,
  point: string | undefined,
  body: WorkshopBodyKey,
): ParagraphSlots {
  if (slots.claim?.trim() || !point?.trim()) return slots;
  return {
    ...slots,
    claim: normalizeHandoffClaimForChain(point, body) || point.trim(),
  };
}

export function coverageCoachHint(
  need: CoverageNeed,
  body: WorkshopBodyKey,
  ctx?: { bodyPoint?: string; bodyAngle?: string },
): string {
  const point = ctx?.bodyPoint?.trim() || "";
  const angle = ctx?.bodyAngle?.trim() || "";
  const scope = angle || point.slice(0, 24) || (body === "body1" ? "本分论点" : "本分论点");

  if (need === "ready") return "";
  if (need === "claim") return "论点来自审题定稿，无需再写 Claim。";
  if (need === "causal") {
    if (point && /经济|收入|就业|产业|旅游|游客/.test(point)) {
      return `请用一句话补因果链：在「${scope}」下，游客/消费怎样经过哪一步（行业、岗位等）带来 ${/就业/.test(point) ? "就业或收入" : "你所写的好处"}？`;
    }
    return body === "body1"
      ? `请补：在「${scope}」下，为什么该分论点成立（谁→发生什么→带来什么结果）？`
      : "请补：为什么系统积累是学术深造的基础。";
  }
  if (need === "grounding") {
    if (point && /环境|污染|垃圾|破坏|景区/.test(point)) {
      return "请补：一个具体场景（例如某类景区/游客增多→垃圾或环境压力），建议用「例如/比如」开头。";
    }
    return body === "body1"
      ? `请补：一句具体场景（与「${scope}」相关，例如/比如…），不要用「合理」代替例子。`
      : "请补：课程、研究或训练场景的例子。";
  }
  return body === "body1"
    ? `请补：用「因此/所以」把上文收束到「${scope}」或分论点（一句即可）。`
    : "请补：段末收束到学术深造/长期积累。";
}

/** @deprecated 双层合并保留给旧测试；推进不再调用 */
export function mergeDiscourseWithRingSlots(
  ringSlots: ParagraphSlots,
  projected: ParagraphSlots,
  _body: WorkshopBodyKey,
): ParagraphSlots {
  return {
    ...ringSlots,
    claim: projected.claim ?? ringSlots.claim,
    reason: projected.reason ?? ringSlots.reason,
    example: projected.example ?? ringSlots.example,
    link: projected.link ?? ringSlots.link,
  };
}
