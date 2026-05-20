import type { ParagraphSlot, ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";
import type { ChainProposal } from "./types";

export type ChainBuildStep = "claim" | "reason" | "example" | "link" | "ready";

const SLOT_LABEL: Record<Exclude<ChainBuildStep, "ready">, string> = {
  claim: "论点 Claim",
  reason: "原因 Reason",
  example: "举例 Example",
  link: "扣题 Link",
};

const CONFUSION_RE =
  /不知道怎么串|不会串|怎么连|如何串|连起来|不清楚.*链|不懂.*链|不知道怎么写/i;

const BANNED_COACH_RE =
  /满意|可以吗\s*$|够了吗|是否足够|review|满意吗/i;

export function detectChainConfusion(message?: string): boolean {
  return !!message?.trim() && CONFUSION_RE.test(message);
}

export function isBannedCoachQuestion(q: string): boolean {
  return BANNED_COACH_RE.test(q);
}

function userBlob(state: SessionState, body: WorkshopBodyKey): string {
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  const msgs = state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  return [seg?.draft ?? "", ...msgs].join("\n");
}

/** 从聊天粗提取各 slot（规则），供渐进展示与兜底 proposal */
export function buildSlotsFromChat(
  state: SessionState,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const blob = userBlob(state, body);
  const point =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  const slots: ParagraphSlots = {};

  if (point?.trim()) {
    slots.claim = point.trim();
  } else if (/大学|应该|需要|提供|侧重/.test(blob)) {
    const m = blob.match(/[^。；;\n]{8,80}/);
    if (m) slots.claim = m[0].trim();
  }

  const reasonParts: string[] = [];
  for (const s of blob.split(/[。；;\n]/)) {
    if (/因为|所以|因此|才能|有助于|使得|直接|更容易/.test(s) && s.length > 6) {
      reasonParts.push(s.trim());
    }
  }
  if (reasonParts.length) {
    slots.reason = reasonParts.slice(-2).join("；");
  }

  const exParts: string[] = [];
  for (const s of blob.split(/[。；;\n]/)) {
    if (
      /例如|比如|项目|实习|coding|编程|课程|实践|工程师/.test(s) &&
      s.length > 8
    ) {
      exParts.push(s.trim());
    }
  }
  if (exParts.length) {
    slots.example = exParts.slice(-2).join("；");
  }

  if (/就业|求职|竞争|找工作|上岗|实习/.test(blob)) {
    const link = blob.match(/[^。；;\n]*(?:就业|求职|竞争|实习)[^。；;\n]*/);
    slots.link = link?.[0]?.trim() ?? "帮助学生更快就业、提升求职竞争力";
  }

  return slots;
}

export function mergeSlots(
  a?: ParagraphSlots,
  b?: ParagraphSlots,
): ParagraphSlots {
  const out: ParagraphSlots = { ...a };
  for (const k of ["claim", "reason", "elaboration", "support", "example", "link"] as ParagraphSlot[]) {
    const v = b?.[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

export function getNextChainBuildStep(slots: ParagraphSlots): {
  step: ChainBuildStep;
  coachPrompt: string;
} {
  const claim = slots.claim?.trim() || slots.elaboration?.trim();
  if (!claim) {
    return {
      step: "claim",
      coachPrompt:
        "先钉住论点：大学提供工作技能，想帮助学生达到什么结果？（一句话）",
    };
  }
  if (!slots.reason?.trim()) {
    return {
      step: "reason",
      coachPrompt:
        "论点有了。补一层因果：为什么提供这些技能，就能帮助学生更快就业？",
    };
  }
  if (!slots.example?.trim() && !slots.support?.trim()) {
    return {
      step: "example",
      coachPrompt:
        "再给一个具体例子：学校可以提供什么实践/项目？（如 coding 项目、实习）",
    };
  }
  if (!slots.link?.trim()) {
    return {
      step: "link",
      coachPrompt:
        "最后扣题：这些技能/项目如何直接落到「尽快就业」？（一句话）",
    };
  }
  return { step: "ready", coachPrompt: "" };
}

export function formatChainProgress(
  slots: ParagraphSlots,
  currentStep: ChainBuildStep,
): string {
  const lines: string[] = ["【搭链进度】"];
  for (const step of ["claim", "reason", "example", "link"] as const) {
    const label = SLOT_LABEL[step];
    let val = "";
    if (step === "claim") val = slots.claim ?? slots.elaboration ?? "";
    else val = slots[step] ?? "";
    const mark =
      step === currentStep ? "→" : val?.trim() ? "✓" : "○";
    lines.push(
      `${mark} ${label}：${val?.trim() ? val.trim().slice(0, 60) : "待补"}`,
    );
  }
  return lines.join("\n");
}

export function formatChainSkeleton(
  slots: ParagraphSlots,
  bodyLabel: string,
): string {
  const summary = [
    slots.claim && `论点：${slots.claim}`,
    slots.reason && `原因：${slots.reason}`,
    slots.example && `例子：${slots.example}`,
    slots.link && `扣题：${slots.link}`,
  ]
    .filter(Boolean)
    .join(" → ");
  return [
    `我根据你已说的内容，先搭了一版${bodyLabel}链条骨架：`,
    summary || "（还缺几环，我们一起补）",
    "你看这条线是否顺？不顺请说哪一环要改。",
  ].join("\n");
}

export function buildChainProposalFromChat(
  state: SessionState,
  body: WorkshopBodyKey,
): ChainProposal {
  const slots = buildSlotsFromChat(state, body);
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  const merged = mergeSlots(slots, seg?.slots);
  const draft = seg?.draft?.trim() || userBlob(state, body).slice(0, 500);
  const chainSummary = [
    merged.claim,
    merged.reason,
    merged.example,
    merged.link,
  ]
    .filter(Boolean)
    .join(" → ");
  return {
    chainSummary: chainSummary || "论证链条",
    slots: merged,
    draft,
  };
}
