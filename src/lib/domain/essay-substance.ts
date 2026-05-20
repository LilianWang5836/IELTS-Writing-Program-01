import type { SessionState, Stage1Handoff } from "./types";

const SUBSTANCE_MARKERS =
  /因为|所以|应该|需要|才能|例如|比如|通过|可以|有助于|提升|积累|学习|培养|实习|研究|技能|知识|工作|学术/i;

const EMPLOY_SECTION_RE =
  /(?:为)?就业(?:准备|导向)?[^:：]{0,16}[:：]\s*([^；;\n]+)/i;
const ACADEMIC_SECTION_RE =
  /知识(?:本身)?[^:：]{0,16}[:：]\s*([^；;\n]+)/i;

export interface EssaySubstanceAssessment {
  sufficient: boolean;
  gaps: string[];
  coachPrompt?: string;
}

export function userMessages(state: SessionState): string[] {
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

export function dimEmployCount(s: string): number {
  const m = s.match(
    /就业|工作|职场|技能|实操|实习|求职|竞争优势|career|job|employ/gi,
  );
  return m?.length ?? 0;
}

export function dimAcademicCount(s: string): number {
  const m = s.match(
    /学术|研究|理论|知识|深造|phd|academic|纯粹|领域|科研|系统性/gi,
  );
  return m?.length ?? 0;
}

function splitMessageByChunks(message: string): string[] {
  return message
    .split(/[；;]|(?:\n+)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function classifyChunk(chunk: string): "employ" | "academic" | "neutral" {
  const e = dimEmployCount(chunk);
  const a = dimAcademicCount(chunk);
  if (e > 0 && a === 0) return "employ";
  if (a > 0 && e === 0) return "academic";
  if (e > 0 && a > 0) {
    if (/为就业|就业准备|实习|求职|工作技能|尽快工作/.test(chunk)) return "employ";
    if (/知识本身|学术道路|学术|深造|领域|系统性/.test(chunk)) return "academic";
    return e >= a ? "employ" : "academic";
  }
  return "neutral";
}

/** 单条消息按分句/标签拆到就业侧、学术侧（避免整段只进一桶） */
export function accumulateDimensionTexts(msgs: string[]): {
  employText: string;
  academicText: string;
} {
  let employText = "";
  let academicText = "";

  for (const m of msgs) {
    const empSec = m.match(EMPLOY_SECTION_RE);
    const acadSec = m.match(ACADEMIC_SECTION_RE);
    if (empSec?.[1]) employText += ` ${empSec[1]}`;
    if (acadSec?.[1]) academicText += ` ${acadSec[1]}`;

    for (const chunk of splitMessageByChunks(m)) {
      if (empSec?.[1] && chunk.includes(empSec[1].slice(0, Math.min(8, empSec[1].length)))) {
        continue;
      }
      if (acadSec?.[1] && chunk.includes(acadSec[1].slice(0, Math.min(8, acadSec[1].length)))) {
        continue;
      }

      const kind = classifyChunk(chunk);
      if (kind === "employ") employText += ` ${chunk}`;
      else if (kind === "academic") academicText += ` ${chunk}`;
      else if (dimEmployCount(chunk) >= 1 && dimAcademicCount(chunk) >= 1) {
        const parts = chunk.split(/(?=知识本身|学术道路|学术|反之|on the other hand)/i);
        for (const p of parts) {
          const k = classifyChunk(p);
          if (k === "employ") employText += ` ${p}`;
          else if (k === "academic") academicText += ` ${p}`;
        }
      }
    }
  }

  return { employText: employText.trim(), academicText: academicText.trim() };
}

export function userAnsweredBothSidesInMessage(message?: string): boolean {
  if (!message?.trim()) return false;
  const m = message;
  if (EMPLOY_SECTION_RE.test(m) && ACADEMIC_SECTION_RE.test(m)) return true;
  return (
    dimEmployCount(m) >= 1 &&
    dimAcademicCount(m) >= 1 &&
    m.length >= 45 &&
    (/因为|所以|才能|应该|积累|时间/.test(m) || m.includes("；") || m.includes(";"))
  );
}

function inferTask(blob: string): string {
  if (/discuss|讨论|双方|两种|both views/i.test(blob)) {
    return "讨论大学教育应侧重职场技能还是为知识而学";
  }
  return "明确题目讨论范围与任务";
}

function inferPosition(blob: string): string {
  if (/取决于|看情况|规划|路径|分流|反之|尽快工作|学术道路/.test(blob)) {
    return "取决于学生个人规划：就业导向侧重技能，学术导向侧重知识积累";
  }
  return "";
}

function firstSentence(text: string, maxLen = 90): string {
  const t = text.trim();
  if (!t) return "";
  const m = t.match(/[^。；;!?]+[。；;!?]?/);
  const sent = (m?.[0] ?? t).trim();
  return sent.length > maxLen ? `${sent.slice(0, maxLen)}…` : sent;
}

function defaultBody1Point(employText: string): string {
  const s = firstSentence(employText);
  if (s) return s;
  return "以就业为导向应积累工作技能与实习经历以提升求职竞争力";
}

function defaultBody2Point(academicText: string): string {
  const s = firstSentence(academicText);
  if (s) return s;
  return "走学术道路需持续学习领域知识，系统性积累支撑深造";
}

/** 从全文聊天规则生成六栏提案（充实度够但 LLM 未返回时） */
export function buildHandoffFromChat(state: SessionState): Stage1Handoff {
  const msgs = userMessages(state);
  const blob = msgs.join("\n");
  const { employText, academicText } = accumulateDimensionTexts(msgs);
  const h = state.handoff;

  return {
    questionType:
      h?.questionType?.trim() ||
      (/\bdiscuss\b|讨论|双方/i.test(blob) ? "discuss" : "unknown"),
    taskUnderstanding:
      h?.taskUnderstanding?.trim() || inferTask(blob),
    position: h?.position?.trim() || inferPosition(blob),
    body1Point: h?.body1Point?.trim() || defaultBody1Point(employText),
    body1Angle:
      h?.body1Angle?.trim() ||
      (employText ? "就业市场与职场技能" : "就业与技能培养"),
    body2Point: h?.body2Point?.trim() || defaultBody2Point(academicText),
    body2Angle:
      h?.body2Angle?.trim() ||
      (academicText ? "学术深造与知识体系" : "学术与知识积累"),
  };
}

export function assessExplorationContent(
  state: SessionState,
  userMessage?: string,
): { contentReady: boolean } {
  const blob = [
    state.s1?.taskUnderstanding ?? "",
    state.s1?.position ?? "",
    state.handoff?.taskUnderstanding ?? "",
    state.handoff?.position ?? "",
    userMessage ?? "",
    ...state.chatHistory.filter((m) => m.role === "user").map((m) => m.content),
  ]
    .join(" ")
    .toLowerCase();

  const hasTask =
    /discuss|讨论|双方|两种观点|agree|disagree|优缺点|利弊/i.test(blob) ||
    (state.s1?.taskUnderstanding?.trim().length ?? 0) > 8;
  const hasPosition =
    /取决于|看情况|部分同意|分开|分流|不同学生|规划|路径|条件|反之|尽快/i.test(
      blob,
    ) || (state.s1?.position?.trim().length ?? 0) > 6;
  const hasEmploy =
    /就业|工作|职场|技能|实操|实习|job|career|employ|尽快工作/i.test(blob);
  const hasAcademic =
    /学术|研究|理论|知识|深造|phd|academic|纯粹|系统/i.test(blob);

  return {
    contentReady: hasTask && hasPosition && hasEmploy && hasAcademic,
  };
}

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

  const { employText, academicText } = accumulateDimensionTexts(msgs);
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

  const lastMsg = msgs[msgs.length - 1] ?? "";
  const bothSidesThisTurn = userAnsweredBothSidesInMessage(lastMsg);

  const sufficient =
    gaps.length === 0 &&
    employScore >= 2 &&
    academicScore >= 2 &&
    bothViewsInTask;

  const sufficientWithBothTurn =
    bothSidesThisTurn &&
    employScore >= 1 &&
    academicScore >= 1 &&
    bothViewsInTask;

  return {
    sufficient: sufficient || sufficientWithBothTurn,
    gaps: sufficient || sufficientWithBothTurn ? [] : gaps,
    coachPrompt: gaps[0],
  };
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

export function extractProposedHandoffRule(
  state: SessionState,
): Stage1Handoff | null {
  const fromChat = buildHandoffFromChat(state);
  if (isHandoffProposalComplete(fromChat)) return fromChat;

  const substance = assessEssaySubstance(state);
  if (substance.sufficient && isHandoffProposalComplete(fromChat)) {
    return fromChat;
  }

  return isHandoffProposalComplete(fromChat) ? fromChat : null;
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
