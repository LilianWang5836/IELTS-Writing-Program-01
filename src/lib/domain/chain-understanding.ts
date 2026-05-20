import {
  applyPrimaryRingWrite,
  parseUnderstandingForStep,
} from "./chain-turn-decision";
import {
  buildSlotsFromChat,
  exampleFollowUpCoachPrompt,
  getChainBuildContext,
  getNextChainBuildStep,
  hasExampleLead,
  isChainStepFilled,
  isExampleSentence,
  isLinkSentence,
  isReasonSentence,
  isWeakExampleSentence,
  mergeSlots,
  type ChainBuildStep,
} from "./chain-scaffold";
import { detectChainFrustration } from "./stage2-context";
import type { LlmTurnResult, ParagraphSlots, WorkshopBodyKey } from "./types";

export type ChainTurnRole = "reason" | "example" | "link" | "none" | "meta";
export type ChainTurnQuality = "ok" | "acceptable" | "weak" | "off_topic" | "none";

export interface ChainTurnUnderstanding {
  role: ChainTurnRole;
  quality: ChainTurnQuality;
  slotText: string;
}

function normalizeRole(v: unknown): ChainTurnRole {
  const s = String(v ?? "")
    .toLowerCase()
    .trim();
  if (s === "reason" || s === "example" || s === "link" || s === "meta") {
    return s;
  }
  return "none";
}

function normalizeQuality(v: unknown): ChainTurnQuality {
  const s = String(v ?? "")
    .toLowerCase()
    .trim();
  if (s === "ok" || s === "acceptable" || s === "weak" || s === "off_topic") return s;
  return "none";
}

/** 从 LLM JSON 读取本轮话轮功能（理解轨） */
export function parseChainTurnUnderstanding(
  result: LlmTurnResult,
  userMessage?: string,
): ChainTurnUnderstanding {
  const ex = result.extracted as Record<string, unknown> | undefined;
  const fromLlm: ChainTurnUnderstanding = {
    role: normalizeRole(result.chainTurnRole ?? ex?.chainTurnRole),
    quality: normalizeQuality(result.chainTurnQuality ?? ex?.chainTurnQuality),
    slotText: String(result.chainTurnText ?? ex?.chainTurnText ?? "").trim(),
  };

  const msg = userMessage?.trim() ?? "";
  if (!msg) return fromLlm;

  if (detectChainFrustration(msg)) {
    return { role: "meta", quality: "none", slotText: msg };
  }

  if (fromLlm.role !== "none" && fromLlm.quality !== "none") {
    return { ...fromLlm, slotText: fromLlm.slotText || msg };
  }

  return { ...inferTurnFromMessage(msg), slotText: msg };
}

/** 规则兜底：话轮标记 + 整句功能 */
function inferTurnFromMessage(msg: string): Omit<ChainTurnUnderstanding, "slotText"> {
  if (
    (/^原因\s*[:：]|^因为/.test(msg) ||
      (/因此|因为|所以/.test(msg) &&
        /课本|学术|实践|职场|不匹配|差异/.test(msg))) &&
    !/比如|例如|举例/.test(msg)
  ) {
    const weak =
      msg.length < 18 ||
      (!/课本|实践|项目|差异|实习|技能|工作/.test(msg) && !/因为|因此/.test(msg));
    return { role: "reason", quality: weak ? "weak" : "ok" };
  }
  if (/比如|例如|举例\s*[:：]|比方说/.test(msg)) {
    const weak =
      msg.length < 22 ||
      !/技术栈|实习|项目|计算机|岗位|公司|医学|课程|实训|编程/.test(msg);
    return { role: "example", quality: weak ? "weak" : "ok" };
  }
  if (/^(所以呢|然后呢|接下来|怎么办)[？?]?$/i.test(msg.trim())) {
    return { role: "none", quality: "none" };
  }
  if (/因此|所以|从而|这样一来/.test(msg) && msg.length > 24) {
    const weak =
      !/就业|求职|面试|工作|深造|学术|知识|对口|职业|适应|找到|必要|重要|路线|积累|研究/.test(
        msg,
      );
    return { role: "link", quality: weak ? "weak" : "ok" };
  }
  return { role: "none", quality: "none" };
}

function bestSentenceForRole(
  msg: string,
  role: ChainTurnRole,
  body: WorkshopBodyKey,
): string {
  const parts = msg
    .split(/[。；;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  const candidates = [msg.trim(), ...parts];
  for (const s of candidates) {
    if (role === "reason" && isReasonSentence(s, body)) return s;
    if (role === "example" && isExampleSentence(s, body)) return s;
    if (role === "link" && isLinkSentence(s, body)) return s;
  }
  return msg.trim();
}

function inferAdditionalRoles(
  msg: string,
  body: WorkshopBodyKey,
  primary: ChainTurnRole,
): Array<"reason" | "example" | "link"> {
  const out: Array<"reason" | "example" | "link"> = [];
  const add = (r: "reason" | "example" | "link") => {
    if (primary === r) return;
    if (!out.includes(r)) out.push(r);
  };
  if (isReasonSentence(msg, body)) add("reason");
  if (isExampleSentence(msg, body)) add("example");
  if (isLinkSentence(msg, body)) add("link");
  return out;
}

function upsertRoleSlot(
  slots: ParagraphSlots,
  role: "reason" | "example" | "link",
  text: string,
  body: WorkshopBodyKey,
): void {
  if (role === "reason") {
    const raw = text.trim();
    if (hasExampleLead(raw) && !/^原因\s*[:：]/i.test(raw)) return;
    if (!isReasonSentence(text, body)) return;
    const ex = slots.example?.trim();
    if (ex && ex === raw) return;
    slots.reason = text;
    return;
  }
  if (role === "example") {
    if (!isExampleSentence(text, body)) return;
    if (
      !slots.example ||
      isWeakExampleSentence(slots.example, body) ||
      !isWeakExampleSentence(text, body)
    ) {
      slots.example = text;
    }
    return;
  }
  if (isLinkSentence(text, body)) {
    const r = slots.reason?.trim();
    if (r && r === text.trim()) return;
    slots.link = text;
  }
}

/**
 * @deprecated 使用 chain-turn-decision.applyPrimaryRingWrite（一轮只写主槽）
 */
export function mergeSlotsWithTurnUnderstanding(
  ruleSlots: ParagraphSlots,
  understanding: ChainTurnUnderstanding,
  userMessage: string | undefined,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const slots = { ...ruleSlots };
  const msg = userMessage?.trim() || understanding.slotText;
  if (!msg || understanding.role === "none" || understanding.role === "meta") {
    return slots;
  }
  if (understanding.quality === "off_topic") return slots;

  const role = understanding.role;
  if (role !== "reason" && role !== "example" && role !== "link") {
    return slots;
  }

  const roles: Array<"reason" | "example" | "link"> = [
    role,
    ...inferAdditionalRoles(msg, body, role),
  ] as Array<"reason" | "example" | "link">;
  for (const r of roles) {
    const text = bestSentenceForRole(msg, r, body);
    upsertRoleSlot(slots, r, text, body);
  }

  return slots;
}

export function isSameCoachPrompt(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\s+/g, "").slice(0, 36);
  const nb = b.toLowerCase().replace(/\s+/g, "").slice(0, 36);
  return !!na && na === nb;
}

const STEP_HINT: Record<Exclude<ChainBuildStep, "ready">, string> = {
  claim: "论点",
  reason: "原因",
  example: "举例",
  link: "段末收束",
};

export interface HybridCoachTurnInput {
  understanding: ChainTurnUnderstanding;
  buildStep: ChainBuildStep;
  stepPrompt: string;
  prevStep: ChainBuildStep;
  lastQuestion: string;
  sanitized: LlmTurnResult;
  workingSlots: ParagraphSlots;
  body: WorkshopBodyKey;
  userMessage?: string;
}

/** @deprecated 使用 resolveChainTurnDecision */
export function resolveHybridCoachTurn(
  input: HybridCoachTurnInput,
): { mirror: string; coachQ: string } {
  const {
    understanding,
    buildStep,
    stepPrompt,
    prevStep,
    lastQuestion,
    sanitized,
    workingSlots,
    body,
    userMessage,
  } = input;

  const llmMirror =
    sanitized.mirror?.trim() && sanitized.mirror !== userMessage?.trim()
      ? sanitized.mirror
      : "";
  const llmQ = sanitized.coachQuestion?.trim() ?? "";

  const advanced =
    !!userMessage?.trim() &&
    prevStep !== "ready" &&
    prevStep !== "claim" &&
    buildStep !== prevStep &&
    isChainStepFilled(workingSlots, prevStep, body);

  if (advanced) {
    return {
      mirror:
        llmMirror ||
        `好，${STEP_HINT[prevStep]}这一环够了，接下来补${STEP_HINT[buildStep as Exclude<ChainBuildStep, "ready">]}。`,
      coachQ: stepPrompt,
    };
  }

  if (
    (understanding.quality === "ok" || understanding.quality === "acceptable") &&
    (understanding.role === "reason" ||
      understanding.role === "example" ||
      understanding.role === "link") &&
    isChainStepFilled(workingSlots, understanding.role, body)
  ) {
    if (buildStep !== understanding.role) {
      return {
        mirror: llmMirror || `好，${STEP_HINT[understanding.role]}这一环够了。`,
        coachQ: stepPrompt,
      };
    }
    if (llmMirror && /够了|听到了|原因|例子|收束/.test(llmMirror)) {
      return {
        mirror: llmMirror,
        coachQ: stepPrompt,
      };
    }
  }

  if (understanding.quality === "weak" && understanding.role === "example") {
    const attempt =
      workingSlots.example?.trim() || understanding.slotText || userMessage || "";
    return {
      mirror: llmMirror || "方向对，再具体一点即可。",
      coachQ: exampleFollowUpCoachPrompt(attempt, body),
    };
  }

  if (understanding.quality === "weak" && understanding.role === "link") {
    return {
      mirror: llmMirror || "收束方向对，再明确落到就业/求职结果一句。",
      coachQ: stepPrompt,
    };
  }

  if (understanding.quality === "weak" && understanding.role === "reason") {
    return {
      mirror: llmMirror || "机制方向对，再用「因为/所以」写清课本与实践的差异。",
      coachQ: stepPrompt,
    };
  }

  if (
    llmQ &&
    !isSameCoachPrompt(llmQ, lastQuestion) &&
    understanding.role === buildStep &&
    (understanding.quality === "weak" ||
      understanding.quality === "ok" ||
      understanding.quality === "acceptable")
  ) {
    return {
      mirror: llmMirror || `这一步还差一句，请参考下面提示补全。`,
      coachQ: llmQ,
    };
  }

  if (isSameCoachPrompt(stepPrompt, lastQuestion) && buildStep === prevStep) {
    if (buildStep === "example" && workingSlots.example?.trim()) {
      return {
        mirror: llmMirror || "抱歉，刚才问重复了。",
        coachQ: exampleFollowUpCoachPrompt(workingSlots.example, body),
      };
    }
    if (buildStep === "reason" && workingSlots.reason?.trim()) {
      return {
        mirror: llmMirror || "你这句原因方向是对的，我换个更短问法。",
        coachQ: "请再补一个机制词：为什么这会直接提升就业竞争力？（一句）",
      };
    }
    if (buildStep === "link" && workingSlots.link?.trim()) {
      return {
        mirror: llmMirror || "你的段末收束方向是对的，我换个更短问法。",
        coachQ: "再补8-15字结果：更快就业/更多面试/更快上岗（三选一即可）。",
      };
    }
    if (llmQ && !isSameCoachPrompt(llmQ, lastQuestion)) {
      return { mirror: llmMirror || "我换种问法。", coachQ: llmQ };
    }
    return {
      mirror: llmMirror || "我不重复上句模板了，换个更具体的补法。",
      coachQ:
        buildStep === "example"
          ? "补1个具体细节：公司/岗位/技术栈名称（三选一）。"
          : buildStep === "link"
            ? "补1句结果：如何落到就业/求职收益。"
            : "补1句机制：为什么这一步能成立。",
    };
  }

  return {
    mirror:
      llmMirror ||
      (buildStep === "ready"
        ? "各环齐了，请看左侧整理。"
        : buildStep === "claim"
          ? "我们按链条一环一环来，先不用写整段。"
          : isChainStepFilled(workingSlots, buildStep, body)
            ? `好，${STEP_HINT[buildStep as Exclude<ChainBuildStep, "ready">]}这一环有了，继续下一环。`
            : "这一步还差一句，请参考下面提示补全。"),
    coachQ: stepPrompt,
  };
}

/** 单条用户话 + 理解轨，快速补 slot（供挫败恢复） */
export function slotsAfterUserTurn(
  state: import("./types").SessionState,
  body: WorkshopBodyKey,
  userMessage: string | undefined,
  result: LlmTurnResult,
): ParagraphSlots {
  const ruleSlots = buildSlotsFromChat(state, body);
  const ctx = getChainBuildContext(state, body);
  const expectedStep = getNextChainBuildStep(ruleSlots, body, ctx).step;
  const understanding = parseUnderstandingForStep(
    result,
    userMessage,
    expectedStep,
    body,
  );
  const ring = understanding.role;
  if (ring === "reason" || ring === "example" || ring === "link") {
    return applyPrimaryRingWrite(
      ruleSlots,
      ring,
      understanding.slotText || userMessage || "",
      body,
    );
  }
  return ruleSlots;
}
