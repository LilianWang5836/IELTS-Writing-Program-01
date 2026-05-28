import {
  aggregateCoverage,
  buildDiscourseMemory,
  getNextNeed,
  isDiscourseArgumentReady,
} from "./chain-discourse";
import {
  areChainSlotsSemanticallyValid,
  hasFlexibleCausal,
  hasFlexibleGrounding,
  isLinkSentence,
} from "./chain-scaffold";
import { claimReasonRedundant } from "./rule-hints";
import { stage2UserMessages, userBlobForWorkshopBody } from "./stage2-context";
import type { ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";

const CAUSAL_MARKERS =
  /因为|所以|因此|从而|才能|有助于|使得|导致|由于|through|because|so that|therefore/i;

const BODY1_TOPIC_RE =
  /就业|工作技能|职场|实习|求职|招聘|上岗|项目|工程师|实践|雇主|游客|旅游|景区|餐饮|住宿|购物|当地|收入|产业|经济|居民|行业|从业|收益|发展|带动/i;
const BODY2_TOPIC_RE =
  /学术|纯粹|知识|医学|理论|体系|研究|导师|论文|课程|领域|深造|科研|专业|环境|污染|垃圾|破坏|拥堵|居民|生活|景区|游客|影响|不便/i;

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

function hasSubstantiveSlots(slots?: ParagraphSlots): boolean {
  if (!slots) return false;
  const causal = slots.reason?.trim() || slots.elaboration?.trim() || "";
  const grounding = slots.example?.trim() || slots.support?.trim() || "";
  return causal.length >= 10 || grounding.length >= 10;
}

function scoreBlob(text: string): number {
  const t = text.trim();
  if (t.length < 20) return 0;
  let score = 1;
  if (t.length >= 45) score += 1;
  if (CAUSAL_MARKERS.test(t)) score += 1;
  if (/例如|比如|实习|研究|项目|雇主|招聘|论文|导师|医学|理论|游客|景区|餐饮|垃圾|环境/.test(t)) {
    score += 1;
  }
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

function gapForCoverageNeed(
  need: ReturnType<typeof getNextNeed>,
  body: WorkshopBodyKey,
): string {
  if (need === "causal") return "缺因果/机制：为什么成立？";
  if (need === "grounding") {
    return body === "body1"
      ? "缺具体支撑：一句与分论点相关的场景或例证"
      : "缺具体支撑：课程、研究或现场例子等";
  }
  if (need === "closure") {
    return body === "body1"
      ? "可选收束：用「因此」把上文接到分论点或切入面（一句即可）"
      : "可选收束：用「因此」接到学术/环境分论点";
  }
  return "缺清晰论点：扣住审题分论点";
}

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

  if (
    workshopBlob.trim().length < 12 &&
    (userMessage?.trim().length ?? 0) < 12 &&
    !hasSubstantiveSlots(slots)
  ) {
    return {
      sufficient: false,
      gaps: ["本段论证尚未开始"],
      coachPrompt: point
        ? `请用几句话说明：「${point}」为什么成立？（机制 + 一句具体场景）`
        : "请用几句话说明本分论点为什么成立。",
    };
  }

  const msgs = stage2UserMessages(state, body);
  if (userMessage?.trim()) msgs.push(userMessage.trim());
  const claim = slots?.claim?.trim() || point?.trim();
  const memory = buildDiscourseMemory(msgs, body, claim);
  const coverage = aggregateCoverage(memory, body);
  const discourseReady = isDiscourseArgumentReady(coverage);

  const score = scoreBlob(blob);
  const topicRe = body === "body1" ? BODY1_TOPIC_RE : BODY2_TOPIC_RE;

  if (blob.length >= 15 && !topicRe.test(blob)) {
    gaps.push(
      body === "body1"
        ? "请围绕 Body1 分论点与切入面写，勿跑题到另一段主题"
        : "请围绕 Body2 分论点与切入面写，与 Body1 区分开",
    );
  }

  if (!discourseReady) {
    const need = getNextNeed(coverage);
    if (need !== "ready") gaps.push(gapForCoverageNeed(need, body));
  }

  if (score < 2 && workshopBlob.length >= 20) {
    gaps.push("论述偏薄：再补一句「怎么做/会怎样」");
  }

  if (claimReasonRedundant(slots) && !hasFlexibleGrounding(slots, body)) {
    gaps.push("论点与机制句像在重复，请补不同功能的一层");
  }
  if (slots?.example?.trim() && STANCE_ONLY_RE.test(slots.example)) {
    gaps.push("支撑须是具体场景，不能用「合理/角度」代替");
  }

  const linkText = slots?.link?.trim() ?? "";
  const reasonText = slots?.reason?.trim() ?? "";
  const claimText = slots?.claim?.trim();
  if (linkText && reasonText && linkText === reasonText) {
    gaps.push("段末收束不能与机制句完全相同，请另写一句收束");
  }
  if (slots?.link?.trim() && STANCE_ONLY_RE.test(slots.link)) {
    gaps.push("收束须落到分论点或切入面，不能复述空泛立场");
  }

  if (body === "body2") {
    const b1slots = state.s2?.body1.slots;
    const b1text = slotText(b1slots) + (state.s2?.body1.draft ?? "");
    if (b1text && textsTooSimilar(blob, b1text)) {
      gaps.push("与 Body1 表述过近，请从本分论点维度展开");
    }
  }

  const slotsOk =
    !!slots &&
    areChainSlotsSemanticallyValid(slots, body, coverage) &&
    hasFlexibleCausal(slots, body) &&
    hasFlexibleGrounding(slots, body);

  const sufficient =
    gaps.filter((g) => !g.startsWith("可选收束")).length === 0 &&
    score >= 2 &&
    (discourseReady || slotsOk);

  const coachPrompt =
    gaps.find((g) => !g.startsWith("可选收束")) ?? gaps[0];

  return {
    sufficient,
    gaps,
    coachPrompt,
  };
}
