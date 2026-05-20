import { assessExplorationContent } from "./stage1-coach";
import type { SessionState, Stage1Handoff } from "./types";

const SUBSTANCE_MARKERS =
  /因为|所以|应该|需要|才能|例如|比如|通过|可以|有助于|提升|积累|学习|培养|实习|研究|技能|知识|工作|学术/i;

export interface EssaySubstanceAssessment {
  sufficient: boolean;
  gaps: string[];
  /** 给教练生成追问用 */
  coachPrompt?: string;
}

function userMessages(state: SessionState): string[] {
  return state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);
}

function scoreTextSubstance(text: string): number {
  const t = text.trim();
  if (t.length < 12) return 0;
  let score = 1;
  if (t.length >= 28) score += 1;
  if (SUBSTANCE_MARKERS.test(t)) score += 1;
  if (t.length >= 55) score += 1;
  return score;
}

function bucketByDimension(text: string): "employ" | "academic" | "mixed" {
  const e = DIM_EMPLOY_COUNT(text);
  const a = DIM_ACADEMIC_COUNT(text);
  if (e > a && e >= 1) return "employ";
  if (a > e && a >= 1) return "academic";
  if (e >= 1 && a >= 1) return "mixed";
  return "mixed";
}

function DIM_EMPLOY_COUNT(s: string): number {
  const m = s.match(/就业|工作|职场|技能|实操|实习|求职|career|job|employ/gi);
  return m?.length ?? 0;
}

function DIM_ACADEMIC_COUNT(s: string): number {
  const m = s.match(/学术|研究|理论|知识|深造|phd|academic|纯粹|领域|科研/gi);
  return m?.length ?? 0;
}

/** 两侧是否各有可写成段落的料（规则版，配合 LLM proposedHandoff） */
export function assessEssaySubstance(state: SessionState): EssaySubstanceAssessment {
  const { contentReady } = assessExplorationContent(state);
  const msgs = userMessages(state);
  const blob = msgs.join("\n");

  if (!contentReady) {
    return {
      sufficient: false,
      gaps: ["题型与任务", "你的立场", "两个不同切入面（如就业 vs 学术）"],
      coachPrompt: "这题要你讨论什么？你的总体判断是什么？打算从哪两个不同方面写？",
    };
  }

  let employText = "";
  let academicText = "";

  for (const m of msgs) {
    const b = bucketByDimension(m);
    if (b === "employ") employText += ` ${m}`;
    else if (b === "academic") academicText += ` ${m}`;
    else {
      if (DIM_EMPLOY_COUNT(m) >= DIM_ACADEMIC_COUNT(m)) employText += ` ${m}`;
      else academicText += ` ${m}`;
    }
  }

  const employScore = scoreTextSubstance(employText);
  const academicScore = scoreTextSubstance(academicText);
  const gaps: string[] = [];

  if (employScore < 2) {
    gaps.push(
      "就业/技能一侧：补一句「写什么 + 为什么」（例如实习、项目、职场能力）",
    );
  }
  if (academicScore < 2) {
    gaps.push(
      "学术/知识一侧：补一句「写什么 + 为什么」（例如长期学习、研究兴趣）",
    );
  }

  const bothViewsInTask =
    /双方|两种|discuss|讨论|纯粹|技能|知识|workplace|academic/i.test(blob);
  if (!bothViewsInTask) {
    gaps.push("题目中的两种观点是否都点到（职场技能 vs 为知识而学）");
  }

  const sufficient =
    gaps.length === 0 && employScore >= 2 && academicScore >= 2 && bothViewsInTask;

  let coachPrompt: string | undefined;
  if (!sufficient && gaps.length) {
    coachPrompt = gaps[0];
  }

  return { sufficient, gaps, coachPrompt };
}

export function isHandoffProposalComplete(h: Partial<Stage1Handoff>): boolean {
  return !!(
    h.taskUnderstanding?.trim() &&
    h.position?.trim() &&
    h.body1Point?.trim() &&
    h.body1Angle?.trim() &&
    h.body2Point?.trim() &&
    h.body2Angle?.trim()
  );
}

export function proposedHandoffFromResult(
  result: {
    proposedHandoff?: Stage1Handoff;
    extracted?: Record<string, unknown>;
    proposalSummary?: string;
  },
): Stage1Handoff | null {
  const raw = result.proposedHandoff ?? result.extracted;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, string>;
  const proposal: Stage1Handoff = {
    taskUnderstanding: String(o.taskUnderstanding ?? "").trim(),
    position: String(o.position ?? "").trim(),
    body1Point: String(o.body1Point ?? "").trim(),
    body1Angle: String(o.body1Angle ?? "").trim(),
    body2Point: String(o.body2Point ?? "").trim(),
    body2Angle: String(o.body2Angle ?? "").trim(),
    questionType: String(o.questionType ?? "discuss").trim(),
  };
  return isHandoffProposalComplete(proposal) ? proposal : null;
}

/** 从已合并的 handoff + 聊天兜底提案（LLM 未返回完整 proposedHandoff 时） */
export function extractProposedHandoffRule(state: SessionState): Stage1Handoff | null {
  const h = state.handoff;
  if (!h) return null;
  const proposal: Stage1Handoff = {
    taskUnderstanding: h.taskUnderstanding?.trim() ?? "",
    position: h.position?.trim() ?? "",
    body1Point: h.body1Point?.trim() ?? "",
    body1Angle: h.body1Angle?.trim() ?? "",
    body2Point: h.body2Point?.trim() ?? "",
    body2Angle: h.body2Angle?.trim() ?? "",
    questionType: h.questionType ?? "discuss",
  };
  if (isHandoffProposalComplete(proposal)) return proposal;

  const msgs = userMessages(state);
  const last = msgs[msgs.length - 1] ?? "";
  if (!proposal.body1Angle && /就业|工作|技能|实习/.test(last)) {
    proposal.body1Angle = "就业与职场技能";
  }
  if (!proposal.body2Angle && /学术|知识|研究|深造/.test(last)) {
    proposal.body2Angle = "学术与知识积累";
  }
  if (!proposal.body1Point && proposal.body1Angle) {
    proposal.body1Point = "大学应侧重可就业的技能培养";
  }
  if (!proposal.body2Point && proposal.body2Angle) {
    proposal.body2Point = "大学应保留为知识而学的空间";
  }

  return isHandoffProposalComplete(proposal) ? proposal : null;
}

export function formatProposalCoachMessage(
  proposal: Stage1Handoff,
  summary?: string,
): string {
  const intro =
    summary?.trim() ||
    "我按我们聊的内容整理了一版审题定稿，你看看是否准确。";
  return [
    intro,
    `题意：${proposal.taskUnderstanding}`,
    `立场：${proposal.position}`,
    `Body1：${proposal.body1Point}（切入面：${proposal.body1Angle}）`,
    `Body2：${proposal.body2Point}（切入面：${proposal.body2Angle}）`,
    "若认可，请点左侧「确认整理并填入」，可改几个字后再提交定稿。",
  ].join("\n");
}
