import {
  detectChainMetaQuestion,
  stage2UserMessages,
  userBlobForWorkshopBody,
} from "./stage2-context";
import type { ParagraphSlot, ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";
import type { ChainProposal } from "./types";

export type ChainBuildStep = "claim" | "reason" | "example" | "link" | "ready";

export { detectChainMetaQuestion } from "./stage2-context";

const MAX_CLAIM_CHARS = 52;

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

const STANCE_ONLY_RE =
  /^(?:从|就).*(?:角度|方面)|有其合理性|是合理的|我?认为.*合理|学习工作技能.*合理/i;

export type ChainBuildContext = {
  bodyPoint: string;
  bodyAngle: string;
};

export function detectChainConfusion(message?: string): boolean {
  return !!message?.trim() && CONFUSION_RE.test(message);
}

export function isBannedCoachQuestion(q: string): boolean {
  return BANNED_COACH_RE.test(q);
}

function trimClaim(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_CLAIM_CHARS) return t;
  return `${t.slice(0, MAX_CLAIM_CHARS)}…`;
}

/** 审题分论点 → 链条 Claim（一句，不与立场句拼接） */
export function normalizeHandoffClaimForChain(
  point: string,
  body: WorkshopBodyKey,
): string {
  const t = point.trim().replace(/\s+/g, " ");
  if (!t) return "";

  if (body === "body1") {
    if (
      /应该以?工作技能为主/.test(t) &&
      /提前积累|项目|实习/.test(t)
    ) {
      return trimClaim(
        "大学应让学生提前积累工作技能、项目与实习经验",
      );
    }
    if (/应该.*工作技能|工作技能为主/.test(t) && t.length < 36) {
      return trimClaim("以就业为目标的学生，大学应侧重可上岗的工作技能");
    }
  }

  if (body === "body2") {
    if (/持续.*学习.*领域|感兴趣的领域/.test(t)) {
      return trimClaim(
        "走学术道路者应持续学习感兴趣领域并积累系统知识",
      );
    }
  }

  const first = t.split(/[。；;]|(?=提前)|(?=另外)/)[0]?.trim() ?? t;
  return trimClaim(first);
}

function normSnippet(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").slice(0, 80);
}

function snippetsTooSimilar(a: string, b: string): boolean {
  const na = normSnippet(a);
  const nb = normSnippet(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length > 14 && nb.length > 14 && (na.includes(nb) || nb.includes(na));
}

function isStanceOnlySentence(s: string): boolean {
  const t = s.trim();
  if (t.length < 10) return false;
  if (STANCE_ONLY_RE.test(t)) return true;
  if (
    /合理|有道理|我?认为|从.*角度/.test(t) &&
    !/因为|所以|例如|比如|实习|项目实操|才能.*就业/.test(t)
  ) {
    return true;
  }
  return false;
}

function isReasonSentence(s: string, body: WorkshopBodyKey): boolean {
  const t = s.trim();
  if (t.length < 10 || isStanceOnlySentence(t)) return false;
  if (!/因为|所以|因此|才能|有助于|使得|由于|才/.test(t)) return false;
  if (body === "body1") {
    return /就业|工作|技能|实习|项目|职场|雇主|课本|实操|经验/.test(t);
  }
  return /学术|知识|研究|领域|积累|学习|深造|理论/.test(t);
}

function isExampleSentence(s: string, body: WorkshopBodyKey): boolean {
  const t = s.trim();
  if (t.length < 10 || isStanceOnlySentence(t)) return false;
  if (/^因为/.test(t)) return false;

  if (body === "body1") {
    if (/例如|比如/.test(t)) return true;
    return (
      /实习|实操|项目经验|岗位实训|coding|编程项目|工作坊|校企/.test(t) &&
      !/^从就业角度/.test(t)
    );
  }
  if (/例如|比如/.test(t)) return true;
  return /医学|课程|研究|导师|论文|实验|领域训练|临床/.test(t);
}

function isLinkSentence(s: string, body: WorkshopBodyKey): boolean {
  const t = s.trim();
  if (t.length < 10 || isStanceOnlySentence(t)) return false;
  if (/^因为/.test(t) && !/就业|求职|深造|学术|面试|工作/.test(t)) {
    return false;
  }

  const linkLead =
    /因此|所以|从而|这样一来|换言之|可见|总之|综上|这意味着/.test(t);

  if (body === "body1") {
    const employOutcome =
      /就业|求职|找工作|面试|上岗|招聘|雇主|职场|毕业生|工作中|企业|适应|竞争力|offer/i.test(
        t,
      );
    if (linkLead && employOutcome) return true;
    if (
      employOutcome &&
      /才能|有助于|更容易|更利|更好|更顺|更快|直接应用/.test(t)
    ) {
      return true;
    }
    return (
      /(?:才能|有助于|从而|最终实现|落到|达成).*(?:就业|求职|上岗|找工作|面试)/.test(
        t,
      ) ||
      (/(?:就业|求职|尽快就业|找工作|面试)/.test(t) &&
        /目标|目的|让学生|毕业生/.test(t))
    );
  }

  const academicOutcome =
    /深造|读研|学术|科研|研究|领域|知识|积累|理论|专业基础/.test(t);
  if (linkLead && academicOutcome) return true;
  return (
    /(?:才能|有助于|从而|支撑).*(?:深造|读研|学术|科研)/.test(t) ||
    (/(?:深造|读研|学术道路)/.test(t) && /知识|积累|系统/.test(t))
  );
}

/** 段末收束（Link）：按本分论点与切入面生成引导，非重复全文立场 */
export function linkCoachPrompt(
  body: WorkshopBodyKey,
  ctx?: ChainBuildContext,
): string {
  const point = ctx?.bodyPoint || "本分论点";
  const angle = ctx?.bodyAngle?.trim() || "";
  const shortPoint =
    point.length > 36 ? `${point.slice(0, 36)}…` : point;

  if (body === "body1") {
    const scope = angle || "就业/职场技能这一侧";
    return (
      `请写段末收束（Link）：用「因此/所以」一句，把刚才的例子接到「${scope}」，` +
      `说明它如何支撑「${shortPoint}」（可写求职、面试、上岗、适应工作等；` +
      `勿再重复「取决于个人规划」等全文立场）。`
    );
  }

  const scope = angle || "学术深造 / 纯粹知识这一侧";
  return (
    `请写段末收束（Link）：用「因此/所以」一句，把例子接到「${scope}」，` +
    `说明它如何支撑「${shortPoint}」（可写长期学习、研究基础、领域积累等；` +
    `勿再重复全文立场）。`
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。；;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function dedupeSlots(slots: ParagraphSlots): ParagraphSlots {
  const out = { ...slots };
  const pairs: Array<[ParagraphSlot, ParagraphSlot]> = [
    ["reason", "example"],
    ["reason", "link"],
    ["example", "link"],
  ];
  for (const [a, b] of pairs) {
    const va = out[a]?.trim();
    const vb = out[b]?.trim();
    if (va && vb && snippetsTooSimilar(va, vb)) {
      delete out[b];
    }
  }
  return out;
}

/** 从 Stage2 用户话按环严格填充（Claim 仅来自审题分论点） */
export function buildSlotsFromChat(
  state: SessionState,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const point =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  const slots: ParagraphSlots = {};

  if (point?.trim()) {
    slots.claim = normalizeHandoffClaimForChain(point, body);
  }

  const msgs = stage2UserMessages(state).filter(
    (m) => m.length >= 10,
  );

  for (const msg of msgs) {
    for (const sent of splitSentences(msg)) {
      if (body === "body1" && /医学|理论体系|纯粹.*知识|专业理论/.test(sent) && !/就业|实习|工作技能|项目实操/.test(sent)) {
        continue;
      }
      if (body === "body2" && /就业|求职|工作技能/.test(sent) && !/学术|知识|研究|深造/.test(sent)) {
        continue;
      }
      if (!slots.reason && isReasonSentence(sent, body)) {
        slots.reason = sent;
        continue;
      }
      if (!slots.example && isExampleSentence(sent, body)) {
        slots.example = sent;
        continue;
      }
      if (!slots.link && isLinkSentence(sent, body)) {
        slots.link = sent;
      }
    }
  }

  return dedupeSlots(slots);
}

export function areChainSlotsSemanticallyValid(
  slots: ParagraphSlots | undefined,
  body: WorkshopBodyKey,
): boolean {
  if (!slots?.claim?.trim()) return false;
  if (!slots.reason?.trim() || !isReasonSentence(slots.reason, body)) {
    return false;
  }
  if (!slots.example?.trim() || !isExampleSentence(slots.example, body)) {
    return false;
  }
  if (!slots.link?.trim() || !isLinkSentence(slots.link, body)) {
    return false;
  }
  return true;
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

export function getChainBuildContext(
  state: SessionState,
  body: WorkshopBodyKey,
): ChainBuildContext {
  const point =
    body === "body1" ? state.s2?.body1Point ?? "" : state.s2?.body2Point ?? "";
  const angle =
    body === "body1" ? state.s2?.body1Angle ?? "" : state.s2?.body2Angle ?? "";
  return { bodyPoint: point.trim(), bodyAngle: angle.trim() };
}

export function getNextChainBuildStep(
  slots: ParagraphSlots,
  body: WorkshopBodyKey = "body1",
  ctx?: ChainBuildContext,
): {
  step: ChainBuildStep;
  coachPrompt: string;
} {
  const claim = slots.claim?.trim() || slots.elaboration?.trim();
  const point = ctx?.bodyPoint || claim || "本分论点";
  const angle = ctx?.bodyAngle || "";

  if (!claim) {
    return {
      step: "claim",
      coachPrompt:
        body === "body1"
          ? "论点已由左侧审题给出；若需改论点请先说。否则请写「原因」：为什么这样能支持就业侧分论点？"
          : "论点来自审题；请写「原因」：为什么体系化知识是深造基础？",
    };
  }

  if (!slots.reason?.trim()) {
    const angleBit = angle ? `（切入面：${angle}）` : "";
    return {
      step: "reason",
      coachPrompt:
        body === "body1"
          ? `审题分论点：「${point}」${angleBit}。请写原因：为什么提供技能/实习/项目，能让学生更快就业？（一句因果，勿只写「合理」）`
          : `审题分论点：「${point}」${angleBit}。请写原因：为什么持续积累领域知识，是学术深造的基础？`,
    };
  }

  if (!slots.example?.trim() && !slots.support?.trim()) {
    const hint =
      body === "body1" && /实习|项目/.test(point)
        ? "可写定稿里提到的实习或项目实操"
        : body === "body1"
          ? "如校企实习、coding 项目、岗位实训"
          : "如课程、研究课题、导师指导";
    return {
      step: "example",
      coachPrompt: `请写举例（Example）：给一个具体场景（${hint}）。不要用「有理/合理」代替例子。`,
    };
  }

  const link = slots.link?.trim();
  if (!link || !isLinkSentence(link, body)) {
    return {
      step: "link",
      coachPrompt: linkCoachPrompt(body, ctx),
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
    const suffix = step === "claim" && val ? "（来自审题）" : "";
    lines.push(
      `${mark} ${label}：${val?.trim() ? val.trim().slice(0, 60) : "待补"}${suffix}`,
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
