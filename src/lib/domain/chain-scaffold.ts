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
  link: "段末收束 Link",
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

function normalizeCoachSentence(s: string): string {
  return s
    .trim()
    .replace(
      /^(?:原因|举例|例子|段末收束|扣题|link|reason|example)\s*[:：]\s*/i,
      "",
    )
    .trim();
}

export function isReasonSentence(s: string, body: WorkshopBodyKey): boolean {
  const raw = s.trim();
  const t = normalizeCoachSentence(s);
  if (t.length < 10 || isStanceOnlySentence(t)) return false;
  if (hasOutcomeForward(t, body)) return false;

  const labeledReason = /^原因\s*[:：]/i.test(raw);
  if (hasExampleLead(raw) && !labeledReason) return false;
  const hasCausal =
    /因为|所以|因此|才能|有助于|使得|由于|需要|差异|不同于|无法从|所以才|只有.*才/.test(
      t,
    );

  if (body === "body1") {
    const onTopic =
      /就业|工作|技能|实习|项目|职场|雇主|课本|实操|实践|经验|面试|实际/.test(
        t,
      );
    if (!onTopic) return false;
    if (labeledReason) return true;
    if (/需要.*(?:学习|掌握|积累)|实践.*(?:学习|掌握)|课本/.test(t)) {
      return true;
    }
    return hasCausal;
  }

  const onTopic = /学术|知识|研究|领域|积累|学习|深造|理论|兴趣/.test(t);
  if (!onTopic) return false;
  if (labeledReason) return true;
  return hasCausal;
}

function reasonQualityScore(s: string, body: WorkshopBodyKey): number {
  const t = normalizeCoachSentence(s);
  if (!isReasonSentence(s, body)) return 0;
  let score = t.length >= 20 ? 2 : 1;
  if (/课本|实践|差异|机制|无法从|项目|实习/.test(t)) score += 3;
  if (/因为|因此/.test(t)) score += 1;
  return score;
}

function linkQualityScore(s: string, body: WorkshopBodyKey): number {
  const t = normalizeCoachSentence(s);
  if (!isLinkSentence(s, body)) return 0;
  let score = t.length >= 16 ? 2 : 1;
  if (/因此|所以/.test(t)) score += 2;
  if (/面试|找工作|就业|上岗|适应/.test(t)) score += 2;
  if (/职业方向|对口|针对性|技术栈|项目/.test(t)) score += 1;
  return score;
}

export function hasExampleLead(s: string): boolean {
  return /例如|比如|举例\s*[:：]|比方说/.test(s.trim());
}

/** 因果/机制句（无例如标记）不应算作 Example，即使出现「项目」等词 */
function looksLikeMechanismNotExample(s: string): boolean {
  const t = s.trim();
  if (hasExampleLead(t)) return false;
  return (
    /因此|因为|所以|由于|才|需要|差异|不匹配|不同于|无法从|偏向/.test(t) &&
    /课本|学术|实践|职场|技能|知识/.test(t)
  );
}

export function isExampleSentence(s: string, body: WorkshopBodyKey): boolean {
  const t = s.trim();
  if (t.length < 10 || isStanceOnlySentence(t)) return false;
  if (/^因为/.test(t) && !hasExampleLead(t)) return false;
  if (looksLikeMechanismNotExample(t)) return false;
  if (hasExampleLead(t)) return true;

  if (body === "body1") {
    return (
      /实习|实操|项目经验|岗位实训|coding|编程|技术栈|计算机|工程师|工作坊|校企|在公司|公司学习/.test(
        t,
      ) &&
      !/^从就业角度/.test(t) &&
      !/因此|因为|所以|课本.*(?:技能|知识)|不匹配/.test(t)
    );
  }
  return /医学|课程|研究|导师|论文|实验|领域训练|临床/.test(t);
}

function exampleQualityScore(s: string, body: WorkshopBodyKey): number {
  const t = s.trim();
  if (!isExampleSentence(s, body)) return 0;
  let score = t.length >= 28 ? 2 : 1;
  if (hasExampleLead(t)) score += 1;
  if (
    /技术栈|实习|项目|实训|编程|计算机|岗位|医学|课程|导师|公司|实操/.test(
      t,
    )
  ) {
    score += 3;
  }
  return score;
}

/** 有举例意图但偏泛，需启发式追问 */
export function isWeakExampleSentence(
  s: string,
  body: WorkshopBodyKey,
): boolean {
  if (!isExampleSentence(s, body)) return true;
  const t = s.trim();
  if (
    /公司|实习|项目|编程|c\+\+|技术栈|岗位|校企|工程师|工作坊/.test(t)
  ) {
    return false;
  }
  if (exampleQualityScore(s, body) >= 4) return false;
  if (hasExampleLead(t) && t.length < 22) return true;
  return hasExampleLead(t) && !/实习|项目|技术栈|计算机|岗位|课程|医学|公司/.test(t);
}

export function exampleFollowUpCoachPrompt(
  attempt: string,
  body: WorkshopBodyKey,
): string {
  const hint =
    body === "body1"
      ? "公司名/岗位、技术栈名称，或实习/项目里具体做了什么"
      : "课程名、研究课题或训练场景";
  const clip = attempt.trim().slice(0, 40);
  return (
    `你举的方向我听到了（${clip}${attempt.length > 40 ? "…" : ""}）。` +
    `请再补一点：${hint}（一句即可）。`
  );
}

/** 段末须落到就业/深造结果；仅「因此+需要补充/不匹配」的机制句不算 Link */
function hasOutcomeForward(t: string, body: WorkshopBodyKey): boolean {
  if (body === "body1") {
    return (
      /(?:才能|有助于|更容易|更利|更好|更顺|更快|利于|提升|增强).*(?:就业|求职|上岗|找工作|面试|offer|招聘|竞争力)/.test(
        t,
      ) ||
      /(?:就业|求职|面试|上岗|找工作|招聘|竞争力|offer|对口).*(?:才能|有助于|更容易|更顺|更快)/.test(
        t,
      ) ||
      /(?:找到|获得|赢得).*(?:工作|岗位|offer|面试机会)/.test(t) ||
      /(?:更快|更好).*(?:就业|上岗|适应职场|找到工作)/.test(t)
    );
  }
  return (
    /(?:才能|有助于|更容易|从而|支撑).*(?:深造|读研|学术|科研)/.test(t) ||
    /(?:深造|读研|学术道路).*(?:才能|有助于|基础|积累)/.test(t)
  );
}

function looksLikeMechanismNotLink(s: string, body: WorkshopBodyKey): boolean {
  const t = s.trim();
  if (hasExampleLead(t)) return false;
  const mechanism =
    /因此|因为|所以|由于|才|需要|差异|不匹配|不同于|偏向|补充/.test(t) &&
    /课本|学术|实践|职场|技能|知识|项目/.test(t);
  if (!mechanism) return false;
  return !hasOutcomeForward(t, body);
}

export function isLinkSentence(s: string, body: WorkshopBodyKey): boolean {
  const t = s.trim();
  if (t.length < 10 || isStanceOnlySentence(t)) return false;
  if (/^因为/.test(t) && !/就业|求职|深造|学术|面试|工作/.test(t)) {
    return false;
  }
  if (looksLikeMechanismNotLink(s, body)) return false;
  if (isReasonSentence(s, body) && !hasOutcomeForward(t, body)) return false;

  const linkLead =
    /因此|所以|从而|这样一来|换言之|可见|总之|综上|这意味着/.test(t);

  if (body === "body1") {
    if (hasOutcomeForward(t, body)) return true;
    if (linkLead && /(?:落到|达成|最终实现).*(?:就业|求职|面试|上岗)/.test(t)) {
      return true;
    }
    return (
      /(?:才能|有助于|从而|最终实现|落到|达成).*(?:就业|求职|上岗|找工作|面试)/.test(
        t,
      ) &&
      !/不匹配|偏向|补充|差异|需要在.*(?:实践|项目)/.test(t)
    );
  }

  if (hasOutcomeForward(t, body)) return true;
  if (linkLead && /(?:落到|支撑).*(?:深造|读研|学术|科研)/.test(t)) {
    return true;
  }
  return (
    /(?:才能|有助于|从而|支撑).*(?:深造|读研|学术|科研)/.test(t) ||
    (/(?:深造|读研|学术道路)/.test(t) && /知识|积累|系统/.test(t))
  );
}

export function reasonCoachPrompt(
  body: WorkshopBodyKey,
  ctx?: ChainBuildContext,
): string {
  const angle = ctx?.bodyAngle?.trim() || "";
  const scope = angle || (body === "body1" ? "就业/职场技能" : "学术深造");
  if (body === "body1") {
    return (
      `请写原因（Reason）：一句说明为什么 ${scope} 下，大学要提供实习/项目/实操（` +
      `可写课本 vs 实践、技能差异等；可用「因为」或「原因：」开头，勿只写「合理」）。`
    );
  }
  return (
    `请写原因（Reason）：一句说明为什么 ${scope} 下，系统学习与领域积累是深造基础（勿只写「需要时间」）。`
  );
}

/** 段末收束（Link）：按本分论点与切入面生成引导，非重复全文立场 */
export function linkCoachPrompt(
  body: WorkshopBodyKey,
  ctx?: ChainBuildContext,
  exampleSnippet?: string,
): string {
  const point = ctx?.bodyPoint || "本分论点";
  const angle = ctx?.bodyAngle?.trim() || "";
  const shortPoint =
    point.length > 36 ? `${point.slice(0, 36)}…` : point;
  const ex =
    exampleSnippet && exampleSnippet.length > 8
      ? `（承接刚举的例子：${exampleSnippet.slice(0, 28)}…）`
      : "";

  if (body === "body1") {
    const scope = angle || "就业/职场技能这一侧";
    return (
      `请写段末收束（Link）：用「因此/所以」一句${ex}，接到「${scope}」，` +
      `说明它如何支撑「${shortPoint}」（可写求职、面试、对口经验、上岗等；` +
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

/** 保留 reason/example/link 并行；不因相似就跨功能删槽 */
function dedupeSlots(slots: ParagraphSlots): ParagraphSlots {
  return { ...slots };
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

  let bestReason = { text: "", score: 0 };
  let bestExample = { text: "", score: 0 };
  let bestLink = { text: "", score: 0 };

  for (const msg of msgs) {
    const labeled = msg.trim();
    const extraSents: string[] = [];
    if (/^原因\s*[:：]/i.test(labeled)) extraSents.push(labeled);
    if (/^举例\s*[:：]/i.test(labeled) || hasExampleLead(labeled)) {
      extraSents.push(labeled);
    }
    const sents = [...extraSents, ...splitSentences(msg), labeled];

    const seen = new Set<string>();
    for (const sent of sents) {
      const key = sent.trim().slice(0, 48);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      if (body === "body1" && /医学|理论体系|纯粹.*知识|专业理论/.test(sent) && !/就业|实习|工作技能|项目实操|技术栈|计算机/.test(sent)) {
        continue;
      }
      if (body === "body2" && /就业|求职|工作技能/.test(sent) && !/学术|知识|研究|深造/.test(sent)) {
        continue;
      }
      if (isReasonSentence(sent, body)) {
        const sc = reasonQualityScore(sent, body);
        if (sc > bestReason.score) {
          bestReason = {
            text: normalizeCoachSentence(sent) || sent.trim(),
            score: sc,
          };
        }
      }
      if (isExampleSentence(sent, body)) {
        const sc = exampleQualityScore(sent, body);
        if (sc > bestExample.score) {
          bestExample = { text: sent.trim(), score: sc };
        }
      }
      if (isLinkSentence(sent, body)) {
        const sc = linkQualityScore(sent, body);
        const cand = sent.trim();
        if (
          sc > bestLink.score &&
          cand !== bestReason.text.trim() &&
          !bestReason.text.trim().includes(cand.slice(0, 20))
        ) {
          bestLink = { text: cand, score: sc };
        }
      }
    }
  }

  if (bestReason.text) slots.reason = bestReason.text;
  if (bestExample.text) slots.example = bestExample.text;
  if (bestLink.text) slots.link = bestLink.text;

  return dedupeSlots(slots);
}

/** 指定环是否已有合格用户内容 */
export function isChainStepFilled(
  slots: ParagraphSlots,
  step: ChainBuildStep,
  body: WorkshopBodyKey,
): boolean {
  if (step === "claim") {
    return !!(slots.claim?.trim() || slots.elaboration?.trim());
  }
  if (step === "reason") {
    return !!slots.reason?.trim() && isReasonSentence(slots.reason, body);
  }
  if (step === "example") {
    const ex = slots.example?.trim() || slots.support?.trim() || "";
    return (
      !!ex &&
      isExampleSentence(ex, body) &&
      !isWeakExampleSentence(ex, body)
    );
  }
  if (step === "link") {
    const link = slots.link?.trim() ?? "";
    const reason = slots.reason?.trim() ?? "";
    return (
      !!link &&
      link !== reason &&
      isLinkSentence(link, body)
    );
  }
  return step === "ready";
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
  const link = slots.link?.trim() ?? "";
  const reason = slots.reason?.trim() ?? "";
  if (!link || link === reason || !isLinkSentence(link, body)) {
    return false;
  }
  return true;
}

export function mergeSlots(
  a?: ParagraphSlots,
  b?: ParagraphSlots,
): ParagraphSlots {
  const prevReason = a?.reason?.trim();
  const out: ParagraphSlots = { ...a };
  for (const k of ["claim", "reason", "elaboration", "support", "example", "link"] as ParagraphSlot[]) {
    const v = b?.[k]?.trim();
    if (v) out[k] = v;
  }
  const nr = out.reason?.trim();
  const ne = out.example?.trim();
  if (nr && ne && nr === ne && prevReason && prevReason !== ne) {
    out.reason = prevReason;
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

  if (!slots.reason?.trim() || !isReasonSentence(slots.reason, body)) {
    return {
      step: "reason",
      coachPrompt: reasonCoachPrompt(body, ctx),
    };
  }

  const ex = slots.example?.trim();
  if (
    !ex ||
    !isExampleSentence(ex, body) ||
    isWeakExampleSentence(ex, body)
  ) {
    const hint =
      body === "body1" && /实习|项目/.test(point)
        ? "可写定稿里提到的实习或项目实操"
        : body === "body1"
          ? "如校企实习、coding 项目、岗位实训"
          : "如课程、研究课题、导师指导";
    const coachPrompt = ex
      ? exampleFollowUpCoachPrompt(ex, body)
      : `请写举例（Example）：给一个具体场景（${hint}）。不要用「有理/合理」代替例子。`;
    return { step: "example", coachPrompt };
  }

  const link = slots.link?.trim();
  if (!link || !isLinkSentence(link, body)) {
    return {
      step: "link",
      coachPrompt: linkCoachPrompt(body, ctx, slots.example?.trim()),
    };
  }

  return { step: "ready", coachPrompt: "" };
}

/** 宽松推进：用于防止同一环节反复追问（允许 weak 先过，再下一环修整） */
export function getNextChainBuildStepLenient(
  slots: ParagraphSlots,
  body: WorkshopBodyKey = "body1",
  ctx?: ChainBuildContext,
): {
  step: ChainBuildStep;
  coachPrompt: string;
} {
  const claim = slots.claim?.trim() || slots.elaboration?.trim();
  if (!claim) return getNextChainBuildStep(slots, body, ctx);
  if (!slots.reason?.trim() || !isReasonSentence(slots.reason, body)) {
    return getNextChainBuildStep(slots, body, ctx);
  }
  const ex = slots.example?.trim() || slots.support?.trim();
  if (!ex || !isExampleSentence(ex, body)) {
    return getNextChainBuildStep(slots, body, ctx);
  }
  const link = slots.link?.trim();
  if (!link || !isLinkSentence(link, body)) {
    return {
      step: "link",
      coachPrompt: linkCoachPrompt(body, ctx, slots.example?.trim()),
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
  const merged = mergeSlots(seg?.slots, slots);
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
