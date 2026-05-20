/**
 * 双层兼容：内层功能覆盖（discourse）+ 外层槽位投影（ParagraphSlots）。
 * 推进以 coverage 为准，slots 供 UI / Stage3 沿用。
 */
import {
  hasExampleLead,
  isExampleSentence,
  isLinkSentence,
  isReasonSentence,
  isTooSimilarToClaim,
  isWeakExampleSentence,
  looksLikeHandoffClaim,
  type ChainBuildStep,
} from "./chain-scaffold";
import type { ParagraphSlots, WorkshopBodyKey } from "./types";

export type DiscourseFunction = "causal" | "grounding" | "closure" | "evaluation";

export type CoverageGap = "causal" | "grounding" | "closure";

export interface DiscourseSentence {
  text: string;
  functions: DiscourseFunction[];
}

export interface BodyDiscourseMemory {
  claim?: string;
  sentences: DiscourseSentence[];
}

export interface ParagraphCoverage {
  claimEstablished: boolean;
  causalExplained: boolean;
  concreteGrounding: boolean;
  argumentativeClosure: boolean;
  missing: CoverageGap[];
}

function onTopic(t: string, body: WorkshopBodyKey): boolean {
  if (body === "body1") {
    return /就业|工作|技能|实习|项目|职场|课本|实践|面试|公司|技术栈/.test(t);
  }
  return /学术|知识|研究|领域|深造|理论|课程|积累|学习|医学|读研|科研/.test(t);
}

/** 功能型收束：不要求命中 isLinkSentence 的 outcome 模板 */
/** 以收束为主：含因此/所以 且满足功能收束（即使 isReasonSentence 也为 true） */
export function isClosurePrimarySentence(
  text: string,
  body: WorkshopBodyKey,
  claim?: string,
): boolean {
  const t = text.trim();
  return (
    /因此|所以|从而|这样一来|总之|综上/.test(t) &&
    hasFunctionalClosure(t, body, claim)
  );
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
  if (!/因此|所以|从而|这样一来|可见|总之|综上/.test(s)) return false;
  if (!onTopic(s, body)) return false;

  if (body === "body1") {
    return (
      isLinkSentence(s, body, claim) ||
      (/就业|求职|面试|上岗|工作|适应|对口|offer/.test(s) &&
        /才能|有助于|更|利于|实现|落到|支撑/.test(s)) ||
      (/因此|所以/.test(s) &&
        /实践|实习|项目|技能|职场/.test(s) &&
        /才能|有助于|更|面试|就业|适应/.test(s))
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

function hasFunctionalCausal(t: string, body: WorkshopBodyKey): boolean {
  if (isReasonSentence(t, body) && !hasFunctionalClosure(t, body)) return true;
  const s = t.trim();
  if (s.length < 12 || !onTopic(s, body)) return false;
  if (hasExampleLead(s) && !/^原因\s*[:：]/i.test(s)) return false;
  return /因为|所以|因此|才能|有助于|需要|差异|不同于|使得|由于|积累|基础/.test(
    s,
  );
}

function hasFunctionalGrounding(t: string, body: WorkshopBodyKey): boolean {
  if (isExampleSentence(t, body) && !isWeakExampleSentence(t, body)) return true;
  const s = t.trim();
  if (hasExampleLead(s) && s.length >= 18) return true;
  if (body === "body1") {
    return /比如|例如|实习|项目|公司|技术栈|岗位|编程|计算机/.test(s) && s.length >= 20;
  }
  return (
    /比如|例如|比方说|医学生|课程|研究|导师|课题|训练|病理|误诊/.test(s) &&
    s.length >= 18
  );
}

/** 从单句推断承担的话语功能（可多标签） */
export function inferDiscourseFunctions(
  text: string,
  body: WorkshopBodyKey,
  claim?: string,
): DiscourseFunction[] {
  const t = text.trim();
  if (t.length < 8) return [];

  const fns = new Set<DiscourseFunction>();

  if (hasFunctionalClosure(t, body, claim)) {
    fns.add("closure");
    if (/有必要|很重要|应当|必须|合理|值得|非常关键|十分重要/.test(t)) {
      fns.add("evaluation");
    }
    return Array.from(fns);
  }

  if (hasFunctionalCausal(t, body)) {
    fns.add("causal");
  }
  if (hasFunctionalGrounding(t, body)) {
    fns.add("grounding");
  }
  if (/有必要|很重要|应当|必须|合理|值得|非常关键|十分重要/.test(t)) {
    fns.add("evaluation");
  }

  if (fns.size === 0 && onTopic(t, body) && t.length >= 12) {
    if (/因为|因此|所以|需要|才能/.test(t)) fns.add("causal");
  }

  return Array.from(fns);
}

export function buildDiscourseMemory(
  messages: string[],
  body: WorkshopBodyKey,
  claim?: string,
): BodyDiscourseMemory {
  const memory: BodyDiscourseMemory = { claim, sentences: [] };
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
      const functions = inferDiscourseFunctions(part, body, claim);
      if (functions.length === 0) continue;
      memory.sentences.push({ text: part, functions });
    }
  }
  return memory;
}

export function appendDiscourseTurn(
  memory: BodyDiscourseMemory,
  text: string,
  body: WorkshopBodyKey,
): BodyDiscourseMemory {
  const t = text.trim();
  if (!t) return memory;
  const functions = inferDiscourseFunctions(t, body, memory.claim);
  if (functions.length === 0) return memory;
  const last = memory.sentences[memory.sentences.length - 1];
  if (last?.text === t) {
    const merged = new Set(last.functions.concat(functions));
    last.functions = Array.from(merged);
    return memory;
  }
  return {
    ...memory,
    sentences: [...memory.sentences, { text: t, functions }],
  };
}

export function assessParagraphCoverage(
  memory: BodyDiscourseMemory,
  body: WorkshopBodyKey,
): ParagraphCoverage {
  const claimEstablished = !!(memory.claim?.trim());
  let causalExplained = false;
  let concreteGrounding = false;
  let argumentativeClosure = false;

  for (const { text, functions } of memory.sentences) {
    if (functions.includes("causal") || hasFunctionalCausal(text, body)) {
      causalExplained = true;
    }
    if (functions.includes("grounding") || hasFunctionalGrounding(text, body)) {
      concreteGrounding = true;
    }
    if (
      functions.includes("closure") ||
      hasFunctionalClosure(text, body, memory.claim)
    ) {
      argumentativeClosure = true;
    }
  }

  const missing: CoverageGap[] = [];
  if (!causalExplained) missing.push("causal");
  if (!concreteGrounding) missing.push("grounding");
  if (!argumentativeClosure) missing.push("closure");

  return {
    claimEstablished,
    causalExplained,
    concreteGrounding,
    argumentativeClosure,
    missing,
  };
}

export function isParagraphCoverageComplete(coverage: ParagraphCoverage): boolean {
  return (
    coverage.claimEstablished &&
    coverage.causalExplained &&
    coverage.concreteGrounding &&
    coverage.argumentativeClosure
  );
}

/** 缺什么功能 → 仍用旧 step 名驱动教练 UI */
export function coverageToBuildStep(coverage: ParagraphCoverage): ChainBuildStep {
  if (isParagraphCoverageComplete(coverage)) return "ready";
  if (!coverage.causalExplained) return "reason";
  if (!coverage.concreteGrounding) return "example";
  if (!coverage.argumentativeClosure) return "link";
  return "ready";
}

function bestSentenceForFunction(
  memory: BodyDiscourseMemory,
  fn: DiscourseFunction,
  body: WorkshopBodyKey,
): string | undefined {
  let best = { text: "", score: 0 };
  for (const { text, functions } of memory.sentences) {
    if (!functions.includes(fn)) continue;
    let score = text.length;
    if (fn === "grounding" && isWeakExampleSentence(text, body)) score -= 20;
    if (fn === "closure" && hasFunctionalClosure(text, body, memory.claim)) {
      score += 10;
    }
    if (fn === "causal" && isReasonSentence(text, body)) score += 5;
    if (score > best.score) {
      best = { text, score };
    }
  }
  return best.text || undefined;
}

/** 内层 memory → 外层 slots（投影，不破坏已有合法槽） */
export function projectDiscourseToSlots(
  memory: BodyDiscourseMemory,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const slots: ParagraphSlots = {};
  if (memory.claim?.trim()) slots.claim = memory.claim.trim();

  const causal = bestSentenceForFunction(memory, "causal", body);
  const grounding = bestSentenceForFunction(memory, "grounding", body);
  const closure = bestSentenceForFunction(memory, "closure", body);

  if (causal && !hasFunctionalClosure(causal, body, memory.claim)) {
    slots.reason = causal;
  }
  if (grounding) slots.example = grounding;
  if (closure) slots.link = closure;

  if (slots.link && slots.reason && slots.link.trim() === slots.reason.trim()) {
    delete slots.link;
  }
  if (
    slots.link &&
    slots.example &&
    slots.link.trim() === slots.example.trim()
  ) {
    delete slots.link;
  }

  return slots;
}

function pickRicher(
  a?: string | null,
  b?: string | null,
): string | undefined {
  const ta = (a ?? "").trim();
  const tb = (b ?? "").trim();
  if (!ta) return tb || undefined;
  if (!tb) return ta;
  return tb.length > ta.length ? tb : ta;
}

/**
 * 双层合并：环写入结果 +  discourse 投影；禁止用「仅收束」句覆盖 reason。
 */
export function mergeDiscourseWithRingSlots(
  ringSlots: ParagraphSlots,
  projected: ParagraphSlots,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const out: ParagraphSlots = { ...ringSlots };

  if (projected.claim?.trim()) out.claim = projected.claim;

  const projReason = projected.reason?.trim();
  const ringReason = ringSlots.reason?.trim();
  const ringReasonOk = ringReason && isReasonSentence(ringReason, body);
  const projReasonOk = projReason && isReasonSentence(projReason, body);
  const claimRef = out.claim?.trim() || undefined;
  const ringClosureOnly =
    !!ringReason && isClosurePrimarySentence(ringReason, body, claimRef);

  if (ringClosureOnly && projReasonOk) {
    out.reason = projReason;
  } else if (projReasonOk && !ringReasonOk) {
    out.reason = projReason;
  } else if (ringReasonOk && !projReasonOk) {
    out.reason = ringReason;
  } else if (projReasonOk && ringReasonOk) {
    const ringCo = isClosurePrimarySentence(ringReason!, body, claimRef);
    const projCo = isClosurePrimarySentence(projReason!, body, claimRef);
    if (ringCo && !projCo) out.reason = projReason;
    else if (projCo && !ringCo) out.reason = projReason;
    else out.reason = pickRicher(ringReason, projReason);
  } else if (projReason && !ringReasonOk) {
    const closureOnly =
      hasFunctionalClosure(projReason, body, claimRef) &&
      !hasFunctionalCausal(projReason, body);
    if (!closureOnly) out.reason = projReason;
  }

  if (projected.example?.trim()) {
    const ex = projected.example.trim();
    const exOk =
      isExampleSentence(ex, body) &&
      !hasFunctionalClosure(ex, body, claimRef);
    if (exOk) {
      const ringEx = ringSlots.example?.trim();
      out.example =
        ringEx && isExampleSentence(ringEx, body)
          ? pickRicher(ringEx, ex)
          : ex;
    }
  }

  if (projected.link?.trim()) {
    const link = projected.link.trim();
    if (link !== out.reason?.trim() && link !== out.example?.trim()) {
      out.link = link;
    }
  }

  return out;
}

export function coverageCoachHint(
  coverage: ParagraphCoverage,
  body: WorkshopBodyKey,
): string {
  const gap = coverage.missing[0];
  if (!gap) return "";
  if (gap === "causal") {
    return body === "body1"
      ? "还缺：为什么职场技能需要项目/实习来补"
      : "还缺：为什么系统积累是学术深造的基础";
  }
  if (gap === "grounding") {
    return body === "body1"
      ? "还缺：具体实习/项目/岗位例子"
      : "还缺：课程、研究或训练场景的例子";
  }
  return body === "body1"
    ? "还缺：段末收束到就业/求职结果"
    : "还缺：段末收束到学术深造/长期积累（可用「因此」接到分论点）";
}
