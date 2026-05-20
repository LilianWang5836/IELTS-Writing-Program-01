import { claimReasonRedundant } from "./rule-hints";
import type { ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";

const CAUSAL_MARKERS =
  /因为|所以|因此|从而|才能|有助于|使得|导致|由于|through|because|so that|therefore/i;

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
  if (/例如|比如|比如|实习|研究|项目|雇主|招聘|论文|导师/.test(t)) score += 1;
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

function userBlobForBody(state: SessionState, body: WorkshopBodyKey): string {
  const msgs = state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  return [seg?.draft ?? "", ...msgs].join("\n");
}

export function assessParagraphSubstance(
  state: SessionState,
  body: WorkshopBodyKey,
  userMessage?: string,
  slots?: ParagraphSlots,
): ParagraphSubstanceAssessment {
  const blob = [userBlobForBody(state, body), userMessage ?? ""].join("\n");
  const point =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  const angle =
    body === "body1" ? state.s2?.body1Angle : state.s2?.body2Angle;
  const gaps: string[] = [];

  if (blob.trim().length < 18) {
    return {
      sufficient: false,
      gaps: ["本段论证太短"],
      coachPrompt: `请用几句话说明：${point || "本分论点"}为什么成立？`,
    };
  }

  const score = scoreBlob(blob);
  const slotBlob = slotText(slots);
  const hasClaimDir =
    !!(slots?.claim?.trim() || slots?.elaboration?.trim()) ||
    /应该|需要|可以|必须|主张|认为|提供|侧重/.test(blob);
  const hasReasonDir =
    !!(slots?.reason?.trim() || slots?.link?.trim() || slots?.support?.trim()) ||
    CAUSAL_MARKERS.test(blob);
  const hasExample =
    !!(slots?.example?.trim() || slots?.support?.trim()) ||
    /例如|比如|实习|项目|研究|雇主|招聘|课程|论文/.test(blob);

  if (!hasClaimDir) {
    gaps.push("缺清晰论点：你在证什么？（扣住审题分论点）");
  }
  if (!hasReasonDir) {
    gaps.push("缺因果/机制：为什么成立？");
  }
  if (score < 2) {
    gaps.push("论述偏薄：再补一句「怎么做/会怎样」");
  }

  if (claimReasonRedundant(slots)) {
    gaps.push("论点与原因像在重复同一句，请补不同功能的一层");
  }

  if (body === "body1" && !hasExample && score < 3) {
    gaps.push("就业/技能侧建议补一个具体例子（实习、项目、招聘等）");
  }

  if (body === "body2") {
    if (!hasExample && !/(研究|论文|导师|课程|领域|深入|系统)/.test(blob)) {
      gaps.push(
        "学术侧建议补：知识/纯粹学习如何支撑深造（而非只说「学习要时间」）",
      );
    }
    const b1slots = state.s2?.body1.slots;
    const b1text = slotText(b1slots) + (state.s2?.body1.draft ?? "");
    if (b1text && textsTooSimilar(blob, b1text)) {
      gaps.push("与 Body1 表述过近，请从学术/知识维度展开");
    }
  }

  if (point && angle) {
    const anchor = `${point} ${angle}`;
    const anchorNorm = norm(anchor);
    const blobNorm = norm(blob);
    if (
      anchorNorm.length > 8 &&
      !blobNorm.includes(norm(point).slice(0, 6)) &&
      score < 3
    ) {
      gaps.push(`请扣住审题：${point.slice(0, 40)}…`);
    }
  }

  const sufficient = gaps.length === 0 && score >= 2 && hasClaimDir && hasReasonDir;

  return {
    sufficient,
    gaps,
    coachPrompt: gaps[0],
  };
}
