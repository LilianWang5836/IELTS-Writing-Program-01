import {
  detectChainMetaQuestion,
  userBlobForWorkshopBody,
} from "./stage2-context";
import type { ParagraphSlot, ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";
import type { ChainProposal } from "./types";

export type ChainBuildStep = "claim" | "reason" | "example" | "link" | "ready";

export { detectChainMetaQuestion } from "./stage2-context";

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

const BODY1_REASON_RE =
  /因为|所以|因此|才能|有助于|使得|直接|更容易|提升|增强/i;
const BODY1_EXAMPLE_RE =
  /例如|比如|实习|项目|coding|编程|实践|工程师|招聘|雇主|岗位|工作技能|上岗/i;
const BODY2_REASON_RE =
  /因为|所以|因此|才能|有助于|使得|基础|积累|支撑|打底/i;
const BODY2_EXAMPLE_RE =
  /例如|比如|医学|课程|研究|导师|论文|理论|知识|领域|体系|专业/i;

export function detectChainConfusion(message?: string): boolean {
  return !!message?.trim() && CONFUSION_RE.test(message);
}

export function isBannedCoachQuestion(q: string): boolean {
  return BANNED_COACH_RE.test(q);
}

function normSnippet(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").slice(0, 80);
}

function snippetsTooSimilar(a: string, b: string): boolean {
  const na = normSnippet(a);
  const nb = normSnippet(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length > 16 && nb.length > 16 && (na.includes(nb) || nb.includes(na));
}

function dedupeSlots(slots: ParagraphSlots): ParagraphSlots {
  const out = { ...slots };
  if (
    out.reason?.trim() &&
    out.example?.trim() &&
    snippetsTooSimilar(out.reason, out.example)
  ) {
    delete out.example;
  }
  return out;
}

/** 从聊天粗提取各 slot（仅 Stage2 + 本 Body 相关消息） */
export function buildSlotsFromChat(
  state: SessionState,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const blob = userBlobForWorkshopBody(state, body);
  const point =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  const slots: ParagraphSlots = {};

  if (point?.trim()) {
    slots.claim = point.trim();
  }

  const reasonRe = body === "body1" ? BODY1_REASON_RE : BODY2_REASON_RE;
  const exampleRe = body === "body1" ? BODY1_EXAMPLE_RE : BODY2_EXAMPLE_RE;

  const reasonParts: string[] = [];
  for (const s of blob.split(/[。；;\n]/)) {
    if (reasonRe.test(s) && s.length > 8) {
      if (body === "body1" && /医学|理论体系|纯粹.*知识|专业理论/.test(s) && !/就业|技能|实习|求职|工作/.test(s)) {
        continue;
      }
      if (body === "body2" && /就业|求职|实习|招聘|工作技能/.test(s) && !/学术|知识|研究|医学|理论/.test(s)) {
        continue;
      }
      reasonParts.push(s.trim());
    }
  }
  if (reasonParts.length) {
    slots.reason = reasonParts.slice(-1).join("；");
  }

  const exParts: string[] = [];
  for (const s of blob.split(/[。；;\n]/)) {
    if (exampleRe.test(s) && s.length > 8) {
      if (body === "body1" && /医学|专业理论|循序渐进|底子没打好/.test(s) && !BODY1_EXAMPLE_RE.test(s)) {
        continue;
      }
      exParts.push(s.trim());
    }
  }
  if (exParts.length) {
    slots.example = exParts.slice(-1).join("；");
  }

  if (body === "body1" && /就业|求职|竞争|找工作|上岗|实习|工作技能/.test(blob)) {
    const link = blob.match(
      /[^。；;\n]*(?:就业|求职|竞争|实习|工作技能|尽快)[^。；;\n]*/,
    );
    slots.link =
      link?.[0]?.trim() ?? "帮助学生更快就业、提升求职竞争力";
  }

  if (body === "body2" && /深造|读研|学术|科研|研究|领域/.test(blob)) {
    const link = blob.match(
      /[^。；;\n]*(?:深造|读研|学术|科研|研究)[^。；;\n]*/,
    );
    slots.link = link?.[0]?.trim() ?? "支撑长期学术深造与系统学习";
  }

  return dedupeSlots(slots);
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
  return dedupeSlots(out);
}

export function getNextChainBuildStep(
  slots: ParagraphSlots,
  body: WorkshopBodyKey = "body1",
): {
  step: ChainBuildStep;
  coachPrompt: string;
} {
  const claim = slots.claim?.trim() || slots.elaboration?.trim();
  if (!claim) {
    return {
      step: "claim",
      coachPrompt:
        body === "body1"
          ? "先钉住论点：扣住审题里的 Body1 分论点，想证什么结果？（一句话）"
          : "先钉住论点：扣住审题里的 Body2 分论点，想证什么结果？（一句话）",
    };
  }
  if (!slots.reason?.trim()) {
    return {
      step: "reason",
      coachPrompt:
        body === "body1"
          ? "补因果：为什么提供这些技能/训练，能帮助学生更快就业？"
          : "补因果：为什么体系化知识积累，是学术深造的基础？",
    };
  }
  if (!slots.example?.trim() && !slots.support?.trim()) {
    return {
      step: "example",
      coachPrompt:
        body === "body1"
          ? "给一个就业侧具体例子（实习、项目、岗位技能等）。"
          : "给一个学术侧具体例子（课程、研究、领域训练等）。",
    };
  }
  if (!slots.link?.trim()) {
    return {
      step: "link",
      coachPrompt:
        body === "body1"
          ? "扣题到审题：这些如何落到「尽快就业」？（一句话）"
          : "扣题：这些如何落到「学术深造/纯粹知识」？（一句话）",
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
  const workshop = userBlobForWorkshopBody(state, body);
  const chainSummary = [
    merged.claim,
    merged.reason,
    merged.example,
    merged.link,
  ]
    .filter(Boolean)
    .join(" → ");
  const draft =
    seg?.draft?.trim() ||
    workshop.slice(0, 500) ||
    chainSummary ||
    merged.claim ||
    "";
  return {
    chainSummary: chainSummary || "论证链条",
    slots: merged,
    draft,
  };
}
