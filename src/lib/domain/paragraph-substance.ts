import { hasFunctionalClosure } from "./chain-discourse";
import { areChainSlotsSemanticallyValid, isLinkSentence } from "./chain-scaffold";
import { claimReasonRedundant } from "./rule-hints";
import { userBlobForWorkshopBody } from "./stage2-context";
import type { ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";

const CAUSAL_MARKERS =
  /因为|所以|因此|从而|才能|有助于|使得|导致|由于|through|because|so that|therefore/i;

const BODY1_EMPLOY_RE =
  /就业|工作技能|职场|实习|求职|招聘|上岗|项目|工程师|实践|雇主/i;
const BODY2_ACADEMIC_RE =
  /学术|纯粹|知识|医学|理论|体系|研究|导师|论文|课程|领域|深造|科研|专业/i;

export interface ParagraphSubstanceAssessment {
  sufficient: boolean;
  gaps: string[];
  coachPrompt?: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function slotText(slots?: ParagraphSlots): string {
  if (!slots) return "";
  return Object.values(slots)
    .filter((v): v is string => !!v?.trim())
    .join(" ");
}

function scoreBlob(text: string): number {
  const t = text.trim();
  if (t.length < 20) return 0;
  let score = 1;
  if (t.length >= 45) score += 1;
  if (CAUSAL_MARKERS.test(t)) score += 1;
  if (/例如|比如|实习|研究|项目|雇主|招聘|论文|导师|医学|理论/.test(t)) score += 1;
  return score;
}

function textsTooSimilar(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 12 && nb.length > 12 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
}

const STANCE_ONLY_RE =
  /^(?:从|就).*(?:角度|方面)|有其合理性|是合理的|学习工作技能.*合理/i;

export function assessParagraphSubstance(
  state: SessionState,
  body: WorkshopBodyKey,
  userMessage?: string,
  slots?: ParagraphSlots,
): ParagraphSubstanceAssessment {
  const workshopBlob = userBlobForWorkshopBody(state, body);
  const blob = [workshopBlob, userMessage?.trim() ?? ""]
    .filter(Boolean)
    .join("\n");
  const point =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  const angle =
    body === "body1" ? state.s2?.body1Angle : state.s2?.body2Angle;
  const gaps: string[] = [];

  if (workshopBlob.trim().length < 12 && (userMessage?.trim().length ?? 0) < 12) {
    return {
      sufficient: false,
      gaps: ["本段论证尚未开始"],
      coachPrompt:
        body === "body1"
          ? `请用几句话说明：${point || "就业侧分论点"}为什么成立？（实习/项目/技能等）`
          : `请用几句话说明：${point || "学术侧分论点"}为什么成立？`,
    };
  }

  const score = scoreBlob(blob);
  const hasClaimDir = !!(slots?.claim?.trim() || slots?.elaboration?.trim());
  const hasReasonDir = !!slots?.reason?.trim();
  const hasExample = !!(slots?.example?.trim() || slots?.support?.trim());
  const linkText = slots?.link?.trim() ?? "";
  const reasonText = slots?.reason?.trim() ?? "";
  const claim = slots?.claim?.trim();
  const hasLink =
    !!linkText &&
    linkText !== reasonText &&
    (isLinkSentence(linkText, body, claim) ||
      hasFunctionalClosure(linkText, body, claim));

  if (body === "body1" && blob.length >= 15 && !BODY1_EMPLOY_RE.test(blob)) {
    gaps.push("请围绕就业/工作技能写，勿用 Stage1 学术举例（如医学理论）代替本段");
  }
  if (body === "body2" && blob.length >= 15 && !BODY2_ACADEMIC_RE.test(blob)) {
    gaps.push("请围绕学术/知识/研究写，与 Body1 就业技能区分开");
  }

  if (!hasClaimDir) {
    gaps.push("缺清晰论点：扣住审题分论点");
  }
  if (!hasReasonDir) {
    gaps.push("缺因果/机制：为什么成立？");
  }
  if (!hasExample) {
    gaps.push(
      body === "body1"
        ? "缺具体例子：实习、项目、岗位技能等"
        : "缺具体例子：课程、研究、领域训练等",
    );
  }
  if (!hasLink) {
    gaps.push(
      body === "body1"
        ? "缺扣题：如何落到「尽快就业」"
        : "缺扣题：如何落到「学术深造/纯粹知识」",
    );
  }
  if (score < 2 && workshopBlob.length >= 20) {
    gaps.push("论述偏薄：再补一句「怎么做/会怎样」");
  }

  if (claimReasonRedundant(slots)) {
    gaps.push("论点与原因像在重复，请补不同功能的一层");
  }
  if (slots?.example?.trim() && STANCE_ONLY_RE.test(slots.example)) {
    gaps.push("举例须是具体场景（实习/项目等），不能用「合理/角度」代替");
  }
  if (linkText && reasonText && linkText === reasonText) {
    gaps.push("段末收束不能与原因同句，请用「因此」写一句落到就业/求职结果");
  }
  if (slots?.link?.trim() && STANCE_ONLY_RE.test(slots.link)) {
    gaps.push("扣题须落到就业或深造目标，不能复述立场句");
  }
  if (slots && !areChainSlotsSemanticallyValid(slots, body)) {
    if (hasReasonDir && !hasExample) {
      gaps.push(
        body === "body1"
          ? "缺具体例子：校企实习、coding 项目、岗位实训等（需新写一句）"
          : "缺具体例子：课程、研究、领域训练等",
      );
    } else if (hasExample && !hasLink) {
      gaps.push(
        body === "body1"
          ? "缺扣题：写一句如何落到「尽快就业」（勿重复原因）"
          : "缺扣题：写一句如何落到「学术深造」",
      );
    } else if (!hasReasonDir) {
      gaps.push("缺因果：用「因为…所以…」写清机制（勿只写合理）");
    }
  }

  if (body === "body2") {
    const b1slots = state.s2?.body1.slots;
    const b1text = slotText(b1slots) + (state.s2?.body1.draft ?? "");
    if (b1text && textsTooSimilar(blob, b1text)) {
      gaps.push("与 Body1 表述过近，请从学术/知识维度展开");
    }
  }

  const sufficient =
    gaps.length === 0 &&
    score >= 2 &&
    areChainSlotsSemanticallyValid(slots, body);

  return {
    sufficient,
    gaps,
    coachPrompt: gaps[0],
  };
}
