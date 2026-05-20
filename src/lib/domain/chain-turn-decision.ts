/**
 * Stage2 单源回合决策：expectedStep 为锚，LLM 理解 + 规则守门，一轮只写主槽。
 */
import {
  areChainSlotsSemanticallyValid,
  exampleFollowUpCoachPrompt,
  getChainBuildContext,
  getNextChainBuildStep,
  getNextChainBuildStepLenient,
  isBannedCoachQuestion,
  isChainStepFilled,
  isExampleSentence,
  isLinkSentence,
  isReasonSentence,
  isWeakExampleSentence,
  linkCoachPrompt,
  mergeSlots,
  reasonCoachPrompt,
  type ChainBuildContext,
  type ChainBuildStep,
} from "./chain-scaffold";
import {
  isSameCoachPrompt,
  parseChainTurnUnderstanding,
  type ChainTurnQuality,
  type ChainTurnRole,
  type ChainTurnUnderstanding,
} from "./chain-understanding";
import { detectChainProcessQuestion } from "./stage2-context";
import type { LlmTurnResult, ParagraphSlots, WorkshopBodyKey } from "./types";

export type ChainRing = "reason" | "example" | "link";

export interface ChainTurnDecision {
  expectedStep: ChainBuildStep;
  primaryRing: ChainRing | null;
  advanceTo: ChainBuildStep;
  quality: ChainTurnQuality;
  understanding: ChainTurnUnderstanding;
  workingSlots: ParagraphSlots;
  coach: { mirror: string; ask: string };
}

const STEP_HINT: Record<Exclude<ChainBuildStep, "ready">, string> = {
  claim: "论点",
  reason: "原因",
  example: "举例",
  link: "段末收束",
};

const RING_DETECT_ORDER: ChainRing[] = ["link", "example", "reason"];

/** 在标点处截断，避免半句追问 */
export function clipCoachAsk(text: string, max = 280): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const punct = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("；"),
    slice.lastIndexOf("\n"),
  );
  if (punct >= 48) return slice.slice(0, punct + 1).trim();
  return `${slice.trim()}…`;
}

function detectMessageRing(
  msg: string,
  body: WorkshopBodyKey,
): ChainRing | null {
  for (const ring of RING_DETECT_ORDER) {
    if (messageFillsRing(msg, ring, body)) return ring;
  }
  return null;
}

function exampleRingSatisfied(
  advanceTo: ChainBuildStep,
  workingSlots: ParagraphSlots,
  body: WorkshopBodyKey,
): boolean {
  return (
    advanceTo === "link" ||
    advanceTo === "ready" ||
    isChainStepFilled(workingSlots, "example", body)
  );
}

function reconcileQuality(
  llmQuality: ChainTurnQuality,
  inferred: ChainTurnQuality,
  ring: ChainRing,
  msg: string,
  body: WorkshopBodyKey,
): ChainTurnQuality {
  if (inferred === "ok" && llmQuality === "weak" && messageFillsRing(msg, ring, body)) {
    if (ring === "example" && !isWeakExampleSentence(msg, body)) return "ok";
    if (ring === "reason" && isReasonSentence(msg, body)) return "ok";
    if (ring === "link" && isLinkSentence(msg, body)) return "ok";
  }
  if (llmQuality === "none") return inferred;
  return llmQuality;
}

function shouldUseLlmCoachQuestion(
  llmQ: string,
  advanceTo: ChainBuildStep,
  workingSlots: ParagraphSlots,
  body: WorkshopBodyKey,
): boolean {
  if (!llmQ.trim() || isBannedCoachQuestion(llmQ)) return false;
  if (advanceTo === "ready") return false;
  if (areChainSlotsSemanticallyValid(workingSlots, body)) return false;
  if (
    /具体.*(?:职业|行业)|再.*(?:举例|例子)|举一个.*例子|哪个行业|什么职业|课程名|研究课题|训练场景/.test(
      llmQ,
    ) &&
    exampleRingSatisfied(advanceTo, workingSlots, body)
  ) {
    return false;
  }
  if (
    /面试|上岗|对口|段末|收束|Link/i.test(llmQ) &&
    isChainStepFilled(workingSlots, "link", body)
  ) {
    return false;
  }
  return true;
}

function ringFromStep(step: ChainBuildStep): ChainRing | null {
  if (step === "reason" || step === "example" || step === "link") return step;
  return null;
}

function messageFillsRing(
  msg: string,
  ring: ChainRing,
  body: WorkshopBodyKey,
): boolean {
  const t = msg.trim();
  if (!t) return false;
  if (ring === "reason") return isReasonSentence(t, body);
  if (ring === "example") return isExampleSentence(t, body);
  return isLinkSentence(t, body);
}

function inferQualityForRing(
  msg: string,
  ring: ChainRing,
  body: WorkshopBodyKey,
): ChainTurnQuality {
  const t = msg.trim();
  if (!messageFillsRing(t, ring, body)) return "weak";
  if (ring === "example" && isWeakExampleSentence(t, body)) return "weak";
  if (t.length < 12) return "weak";
  return "ok";
}

/** 对齐 LLM 角色与当前缺环；不以「因此+实践」抢先判 reason */
export function parseUnderstandingForStep(
  result: LlmTurnResult,
  userMessage: string | undefined,
  expectedStep: ChainBuildStep,
  body: WorkshopBodyKey,
): ChainTurnUnderstanding {
  const base = parseChainTurnUnderstanding(result, userMessage);
  const msg = userMessage?.trim() ?? "";
  if (!msg || base.role === "meta") return base;
  if (detectChainProcessQuestion(msg)) {
    return { role: "meta", quality: "none", slotText: msg };
  }

  const detected = detectMessageRing(msg, body);
  if (detected) {
    const inferred = inferQualityForRing(msg, detected, body);
    const llmQ =
      base.role === detected && base.quality !== "none" ? base.quality : "none";
    const q =
      llmQ !== "none"
        ? reconcileQuality(llmQ, inferred, detected, msg, body)
        : inferred;
    return {
      role: detected,
      quality: q === "none" ? inferred : q,
      slotText: base.slotText || msg,
    };
  }

  const expectedRing = ringFromStep(expectedStep);
  if (!expectedRing) return base;

  if (messageFillsRing(msg, expectedRing, body)) {
    const inferred = inferQualityForRing(msg, expectedRing, body);
    const llmQ =
      base.role === expectedRing && base.quality !== "none" ? base.quality : "none";
    const q =
      llmQ !== "none"
        ? reconcileQuality(llmQ, inferred, expectedRing, msg, body)
        : inferred;
    return {
      role: expectedRing,
      quality: q === "none" ? inferred : q,
      slotText: base.slotText || msg,
    };
  }

  if (
    (base.role === "reason" ||
      base.role === "example" ||
      base.role === "link") &&
    base.quality !== "none" &&
    messageFillsRing(msg, base.role, body)
  ) {
    return { ...base, slotText: base.slotText || msg };
  }

  return {
    role: expectedRing,
    quality: inferQualityForRing(msg, expectedRing, body),
    slotText: msg,
  };
}

/** 本轮只写主环槽位，禁止同句写入多环 */
export function applyPrimaryRingWrite(
  slots: ParagraphSlots,
  ring: ChainRing,
  text: string,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const out = { ...slots };
  const t = text.trim();
  if (!t || !messageFillsRing(t, ring, body)) return out;

  if (ring === "reason") {
    out.reason = t;
    return out;
  }
  if (ring === "example") {
    out.example = t;
    return out;
  }
  if (isLinkSentence(t, body)) {
    out.link = t;
  }
  return out;
}

function shortPromptForStep(
  step: ChainBuildStep,
  body: WorkshopBodyKey,
  ctx: ChainBuildContext,
  slots: ParagraphSlots,
): string {
  if (step === "reason") return reasonCoachPrompt(body, ctx);
  if (step === "example") {
    if (isChainStepFilled(slots, "example", body)) {
      return getNextChainBuildStep(slots, body, ctx).coachPrompt;
    }
    const ex = slots.example?.trim();
    return ex
      ? exampleFollowUpCoachPrompt(ex, body)
      : getNextChainBuildStep(slots, body, ctx).coachPrompt;
  }
  if (step === "link") {
    return linkCoachPrompt(body, ctx, slots.example?.trim());
  }
  return "";
}

function buildProcessMetaCoach(input: {
  advanceTo: ChainBuildStep;
  workingSlots: ParagraphSlots;
  body: WorkshopBodyKey;
  ctx: ChainBuildContext;
  userMessage?: string;
  llmMirror: string;
}): { mirror: string; ask: string } {
  const { advanceTo, workingSlots, body, ctx, userMessage, llmMirror } = input;
  const msg = userMessage?.trim() ?? "";
  const next = getNextChainBuildStep(workingSlots, body, ctx);
  const stepHint =
    advanceTo === "ready"
      ? "链条将齐"
      : STEP_HINT[ringFromStep(advanceTo) ?? "reason"] ?? "下一环";

  let mirror = llmMirror;
  if (/分论点|论点.*(可以|行吗|够)|claim/i.test(msg)) {
    mirror =
      mirror ||
      "分论点已由审题定稿，左侧 Claim 不用再写；我们按环节补原因→举例→段末收束即可。";
  } else if (/需要提供什么|要写什么|干什么/i.test(msg)) {
    mirror =
      mirror ||
      `论点已在左侧；当前请先补${stepHint}（一句中文即可）。`;
  } else {
    mirror = mirror || "好的，我们按搭链环节往下走。";
  }

  const ask =
    advanceTo === "ready"
      ? ""
      : clipCoachAsk(next.coachPrompt || shortPromptForStep(advanceTo, body, ctx, workingSlots));

  return { mirror, ask };
}

function buildCoachMessage(input: {
  understanding: ChainTurnUnderstanding;
  expectedStep: ChainBuildStep;
  advanceTo: ChainBuildStep;
  workingSlots: ParagraphSlots;
  body: WorkshopBodyKey;
  ctx: ChainBuildContext;
  sanitized: LlmTurnResult;
  userMessage?: string;
  lastQuestion: string;
  prevAskCount: number;
  sameStepAsPrev: boolean;
}): { mirror: string; ask: string } {
  const {
    understanding,
    expectedStep,
    advanceTo,
    workingSlots,
    body,
    ctx,
    sanitized,
    userMessage,
    lastQuestion,
    prevAskCount,
    sameStepAsPrev,
  } = input;

  const llmMirror =
    sanitized.mirror?.trim() && sanitized.mirror !== userMessage?.trim()
      ? sanitized.mirror
      : "";

  if (understanding.role === "meta") {
    return buildProcessMetaCoach({
      advanceTo,
      workingSlots,
      body,
      ctx,
      userMessage,
      llmMirror,
    });
  }

  const expectedRing = ringFromStep(expectedStep);
  const exampleDone = exampleRingSatisfied(advanceTo, workingSlots, body);
  const advanced =
    expectedRing &&
    advanceTo !== expectedStep &&
    advanceTo !== "claim" &&
    isChainStepFilled(workingSlots, expectedRing, body);

  if (advanceTo === "ready" && areChainSlotsSemanticallyValid(workingSlots, body)) {
    return {
      mirror:
        llmMirror ||
        "原因、举例和段末收束都齐了，请看左侧链条与下方进度；要改哪一环直接说。",
      ask: "",
    };
  }

  if (advanced && expectedRing) {
    const next = getNextChainBuildStep(workingSlots, body, ctx);
    const nextRing = ringFromStep(next.step);
    const nextHint = nextRing ? STEP_HINT[nextRing] : "";
    const ask =
      next.step === "ready"
        ? ""
        : clipCoachAsk(next.coachPrompt);
    return {
      mirror:
        llmMirror ||
        `好，${STEP_HINT[expectedRing]}这一环够了${nextHint ? `，接下来补${nextHint}` : ""}。`,
      ask,
    };
  }

  if (
    expectedRing &&
    isChainStepFilled(workingSlots, expectedRing, body) &&
    (understanding.quality === "ok" || understanding.quality === "acceptable")
  ) {
    if (advanceTo !== expectedStep) {
      return {
        mirror: llmMirror || `好，${STEP_HINT[expectedRing]}这一环够了。`,
        ask: shortPromptForStep(advanceTo, body, ctx, workingSlots),
      };
    }
    return {
      mirror: llmMirror || `好，${STEP_HINT[expectedRing]}这一环够了。`,
      ask: "",
    };
  }

  if (
    understanding.quality === "weak" &&
    understanding.role === "example" &&
    !exampleDone
  ) {
    const attempt =
      workingSlots.example?.trim() || understanding.slotText || userMessage || "";
    return {
      mirror: llmMirror || "方向对，再具体一点即可。",
      ask: exampleFollowUpCoachPrompt(attempt, body),
    };
  }

  if (
    exampleDone &&
    advanceTo === "link" &&
    (understanding.role === "example" ||
      (understanding.quality === "weak" && !!workingSlots.example?.trim()))
  ) {
    const linkPrompt = clipCoachAsk(
      linkCoachPrompt(body, ctx, workingSlots.example?.trim()),
    );
    return {
      mirror:
        llmMirror || "好，举例这一环够了，接下来补段末收束。",
      ask: linkPrompt,
    };
  }

  if (understanding.quality === "weak" && understanding.role === "link") {
    return {
      mirror: llmMirror || "收束方向对，再明确落到就业/求职结果一句。",
      ask: "再补一句：面试/上岗/对口工作，三选一即可。",
    };
  }

  if (understanding.quality === "weak" && understanding.role === "reason") {
    return {
      mirror: llmMirror || "机制方向对，再写清课本与实践的差异。",
      ask: "请补一句：为什么需要项目/实习来补职场技能？",
    };
  }

  const fullPrompt = shortPromptForStep(expectedStep, body, ctx, workingSlots);
  if (
    expectedRing &&
    isSameCoachPrompt(fullPrompt, lastQuestion) &&
    sameStepAsPrev &&
    prevAskCount >= 1
  ) {
    if (expectedRing === "link" && workingSlots.link?.trim()) {
      return {
        mirror: llmMirror || "段末收束方向对了，我换更短问法。",
        ask: "再补8–15字：更多面试 / 更快上岗 / 更好适应（选一）。",
      };
    }
    if (
      expectedRing === "example" &&
      workingSlots.example?.trim() &&
      !exampleDone
    ) {
      return {
        mirror: llmMirror || "抱歉，刚才问重复了。",
        ask: exampleFollowUpCoachPrompt(workingSlots.example, body),
      };
    }
    if (expectedRing === "example" && exampleDone && advanceTo === "link") {
      return {
        mirror: llmMirror || "抱歉，刚才问重复了；举例已够，请补段末收束。",
        ask: clipCoachAsk(linkCoachPrompt(body, ctx, workingSlots.example?.trim())),
      };
    }
  }

  const llmQ = sanitized.coachQuestion?.trim() ?? "";
  if (
    llmQ &&
    !isSameCoachPrompt(llmQ, lastQuestion) &&
    shouldUseLlmCoachQuestion(llmQ, advanceTo, workingSlots, body)
  ) {
    return {
      mirror: llmMirror || `请补${STEP_HINT[expectedRing ?? "reason"]}。`,
      ask: clipCoachAsk(llmQ),
    };
  }

  return {
    mirror: llmMirror || `请补${STEP_HINT[expectedRing ?? "reason"]}。`,
    ask: clipCoachAsk(fullPrompt),
  };
}

export interface ResolveChainTurnInput {
  baselineSlots: ParagraphSlots;
  result: LlmTurnResult;
  body: WorkshopBodyKey;
  buildCtx: ChainBuildContext;
  userMessage?: string;
  prevStep: ChainBuildStep;
  prevAskCount: number;
  sameStepAsPrev: boolean;
  lastQuestion: string;
}

export function resolveChainTurnDecision(
  input: ResolveChainTurnInput,
): ChainTurnDecision {
  const {
    baselineSlots,
    result,
    body,
    buildCtx,
    userMessage,
    prevStep,
    prevAskCount,
    sameStepAsPrev,
    lastQuestion,
  } = input;

  const msg = userMessage?.trim() ?? "";
  let { step: expectedStep } = getNextChainBuildStep(
    baselineSlots,
    body,
    buildCtx,
  );

  const understanding = parseUnderstandingForStep(
    result,
    userMessage,
    expectedStep,
    body,
  );

  let workingSlots = { ...baselineSlots };
  const primaryRing =
    understanding.role === "reason" ||
    understanding.role === "example" ||
    understanding.role === "link"
      ? understanding.role
      : ringFromStep(expectedStep);

  if (
    primaryRing &&
    msg &&
    understanding.quality !== "off_topic" &&
    understanding.role !== "meta"
  ) {
    workingSlots = applyPrimaryRingWrite(
      workingSlots,
      primaryRing,
      understanding.slotText || msg,
      body,
    );
  }

  let { step: advanceTo, coachPrompt: stepPrompt } = getNextChainBuildStep(
    workingSlots,
    body,
    buildCtx,
  );

  const canEscalateWeak =
    (understanding.quality === "weak" ||
      understanding.quality === "acceptable") &&
    primaryRing === ringFromStep(expectedStep) &&
    sameStepAsPrev &&
    prevAskCount >= 1 &&
    isChainStepFilled(workingSlots, primaryRing!, body);

  if (canEscalateWeak) {
    const lenient = getNextChainBuildStepLenient(workingSlots, body, buildCtx);
    if (lenient.step !== expectedStep) {
      advanceTo = lenient.step;
      stepPrompt = lenient.coachPrompt;
    }
  }

  if (isChainStepFilled(workingSlots, "link", body)) {
    advanceTo = "ready";
    stepPrompt = "";
  } else if (
    areChainSlotsSemanticallyValid(workingSlots, body) &&
    getNextChainBuildStep(workingSlots, body, buildCtx).step === "ready"
  ) {
    advanceTo = "ready";
    stepPrompt = "";
  }

  const coach = buildCoachMessage({
    understanding,
    expectedStep,
    advanceTo,
    workingSlots,
    body,
    ctx: buildCtx,
    sanitized: result,
    userMessage,
    lastQuestion,
    prevAskCount,
    sameStepAsPrev,
  });

  return {
    expectedStep,
    primaryRing,
    advanceTo,
    quality: understanding.quality,
    understanding,
    workingSlots,
    coach,
  };
}
