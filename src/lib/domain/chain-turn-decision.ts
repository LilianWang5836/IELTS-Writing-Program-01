/**
 * Stage2 单源回合决策：expectedStep 为锚，LLM 理解 + 规则守门，一轮只写主槽。
 */
import {
  areChainSlotsSemanticallyValid,
  exampleFollowUpCoachPrompt,
  getChainBuildContext,
  getNextChainBuildStep,
  getNextChainBuildStepLenient,
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

  const expectedRing = ringFromStep(expectedStep);
  if (!expectedRing) return base;

  if (messageFillsRing(msg, expectedRing, body)) {
    const q =
      base.role === expectedRing && base.quality !== "none"
        ? base.quality
        : inferQualityForRing(msg, expectedRing, body);
    return {
      role: expectedRing,
      quality: q === "none" ? inferQualityForRing(msg, expectedRing, body) : q,
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

  const expectedRing = ringFromStep(expectedStep);
  const advanced =
    expectedRing &&
    advanceTo !== expectedStep &&
    advanceTo !== "claim" &&
    isChainStepFilled(workingSlots, expectedRing, body);

  if (advanceTo === "ready" && areChainSlotsSemanticallyValid(workingSlots, body)) {
    return {
      mirror: llmMirror || "各环齐了，请看左侧与下方进度。",
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
        : next.coachPrompt.length > 160
          ? `${next.coachPrompt.slice(0, 160)}…`
          : next.coachPrompt;
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

  if (understanding.quality === "weak" && understanding.role === "example") {
    const attempt =
      workingSlots.example?.trim() || understanding.slotText || userMessage || "";
    return {
      mirror: llmMirror || "方向对，再具体一点即可。",
      ask: exampleFollowUpCoachPrompt(attempt, body),
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
    if (expectedRing === "example" && workingSlots.example?.trim()) {
      return {
        mirror: llmMirror || "抱歉，刚才问重复了。",
        ask: exampleFollowUpCoachPrompt(workingSlots.example, body),
      };
    }
  }

  const llmQ = sanitized.coachQuestion?.trim() ?? "";
  if (llmQ && !isSameCoachPrompt(llmQ, lastQuestion)) {
    return {
      mirror: llmMirror || `请补${STEP_HINT[expectedRing ?? "reason"]}。`,
      ask: llmQ,
    };
  }

  return {
    mirror: llmMirror || `请补${STEP_HINT[expectedRing ?? "reason"]}。`,
    ask: fullPrompt.length > 140 ? `${fullPrompt.slice(0, 140)}…` : fullPrompt,
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

  if (
    primaryRing === "link" &&
    isChainStepFilled(workingSlots, "link", body)
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
