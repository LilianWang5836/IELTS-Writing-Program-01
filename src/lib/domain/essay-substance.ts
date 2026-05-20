import { HANDOFF_FIELD_LABELS } from "./constants";
import type { SessionState, Stage1Handoff } from "./types";

const SUBSTANCE_MARKERS =
  /因为|所以|应该|需要|才能|例如|比如|通过|可以|有助于|提升|积累|学习|培养|实习|研究|技能|知识|工作|学术/i;

const EMPLOY_SECTION_RE =
  /(?:为)?就业(?:准备|导向)?[^:：]{0,16}[:：]\s*([^；;\n]+)/i;
const ACADEMIC_SECTION_RE =
  /知识(?:本身)?[^:：]{0,16}[:：]\s*([^；;\n]+)/i;

const TASK_BLOB_RE =
  /discuss\s+both|讨论|双方|大学教育|这题|题目|取决于学生|个人规划|我认为/i;

const MAX_BODY_POINT_CHARS = 52;

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
  const rough = message
    .split(/[；;]|(?:\n+)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (const chunk of rough) {
    if (
      chunk.length > 36 &&
      dimEmployCount(chunk) >= 1 &&
      dimAcademicCount(chunk) >= 1
    ) {
      const parts = chunk
        .split(/(?=，|,)|(?=反之)|(?=相反)|(?=另一方面)|(?=反之亦然)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 4);
      out.push(...(parts.length > 1 ? parts : [chunk]));
    } else {
      out.push(chunk);
    }
  }
  return out;
}

/** 题型+立场总述（同时含两侧关键词），不计入任一侧分论点素材 */
function isExplorationTaskChunk(chunk: string): boolean {
  const t = chunk.trim();
  if (/大学教育|discuss\s+both/i.test(t) && t.length > 22) return true;
  if (/取决于学生|个人规划|我认为/.test(t) && t.length > 14 && t.length < 48) {
    return true;
  }
  return (
    TASK_BLOB_RE.test(t) &&
    dimEmployCount(t) >= 1 &&
    dimAcademicCount(t) >= 1 &&
    t.length > 32
  );
}

function classifyChunk(chunk: string): "employ" | "academic" | "neutral" | "mixed" {
  const e = dimEmployCount(chunk);
  const a = dimAcademicCount(chunk);
  if (e > 0 && a === 0) return "employ";
  if (a > 0 && e === 0) return "academic";
  if (e > 0 && a > 0) {
    const employOnly =
      /尽快工作|工作技能|就业准备|为就业|求职|实习|上岗/.test(chunk) &&
      !/纯粹|学术道路|学术深造|领域知识|知识本身|科研|读研/.test(chunk);
    const academicOnly =
      /纯粹|学术道路|学术深造|领域知识|知识本身|科研|读研|为知识/.test(chunk) &&
      !/尽快工作|工作技能|就业准备/.test(chunk);
    if (employOnly) return "employ";
    if (academicOnly) return "academic";
    return "mixed";
  }
  return "neutral";
}

function appendSide(
  target: string,
  piece: string,
  maxLen = 220,
): string {
  const p = piece.trim();
  if (!p) return target;
  const next = target ? `${target} ${p}` : p;
  return next.length > maxLen ? next.slice(-maxLen) : next;
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
    if (empSec?.[1]) employText = appendSide(employText, empSec[1]);
    if (acadSec?.[1]) academicText = appendSide(academicText, acadSec[1]);

    for (const chunk of splitMessageByChunks(m)) {
      if (isExplorationTaskChunk(chunk)) continue;
      if (empSec?.[1] && chunk.includes(empSec[1].slice(0, Math.min(8, empSec[1].length)))) {
        continue;
      }
      if (acadSec?.[1] && chunk.includes(acadSec[1].slice(0, Math.min(8, acadSec[1].length)))) {
        continue;
      }

      const kind = classifyChunk(chunk);
      if (kind === "employ") employText = appendSide(employText, chunk);
      else if (kind === "academic") academicText = appendSide(academicText, chunk);
      else if (kind === "mixed" || (dimEmployCount(chunk) >= 1 && dimAcademicCount(chunk) >= 1)) {
        const parts = chunk.split(
          /(?=知识本身|学术道路|学术|纯粹|反之|on the other hand|尽快工作|工作技能)/i,
        );
        for (const p of parts) {
          const k = classifyChunk(p);
          if (k === "employ") employText = appendSide(employText, p);
          else if (k === "academic") academicText = appendSide(academicText, p);
        }
      }
    }
  }

  return { employText: employText.trim(), academicText: academicText.trim() };
}

function sideTextsFromMessage(message: string): {
  employText: string;
  academicText: string;
} {
  return accumulateDimensionTexts([message]);
}

/** 本轮是否分别给出两侧分论点方向（不能仅靠题目关键词混在一段里） */
export function userAnsweredBothSidesInMessage(message?: string): boolean {
  if (!message?.trim()) return false;
  const m = message.trim();
  if (EMPLOY_SECTION_RE.test(m) && ACADEMIC_SECTION_RE.test(m)) return true;

  const { employText, academicText } = sideTextsFromMessage(m);
  return (
    scoreTextSubstance(employText) >= 2 &&
    scoreTextSubstance(academicText) >= 2
  );
}

function trimPoint(text: string): string {
  const t = text.trim().replace(/^[,，、\s]+|[,，、\s]+$/g, "");
  if (t.length <= MAX_BODY_POINT_CHARS) return t;
  return `${t.slice(0, MAX_BODY_POINT_CHARS)}…`;
}

function isTaskOrPositionBlob(text: string): boolean {
  const t = text.trim();
  if (t.length > MAX_BODY_POINT_CHARS + 8) return true;
  if (TASK_BLOB_RE.test(t) && t.length > 36) return true;
  if (/discuss\s+both/i.test(t)) return true;
  return false;
}

const GENERIC_ACADEMIC_POINT =
  /^走学术深造路径者应侧重纯粹知识与领域积累$/;

export function isValidBodyPoint(
  text: string | undefined,
  side: "employ" | "academic",
): boolean {
  const t = text?.trim() ?? "";
  if (t.length < 8 || t.length > MAX_BODY_POINT_CHARS + 4) return false;
  if (isTaskOrPositionBlob(t)) return false;
  if (side === "employ") {
    if (dimEmployCount(t) < 1) return false;
    if (/^应该以?工作技能为主[。.]?$/i.test(t)) return false;
  }
  if (side === "academic" && dimAcademicCount(t) < 1) return false;
  if (side === "academic" && GENERIC_ACADEMIC_POINT.test(t)) return false;
  return true;
}

function lastRichAcademicMessage(msgs: string[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (
      m.length >= 24 &&
      (/医学|专业理论|理论知识|体系化|循序渐进|底子|纯粹/.test(m) ||
        dimAcademicCount(m) >= 2)
    ) {
      return m;
    }
  }
  return "";
}

function normalizeEmployPoint(text: string): string {
  const t = text.trim();
  if (/^应该以?工作技能为主[。.]?$/i.test(t)) {
    return "以就业为目标的学生，大学应侧重可上岗的工作技能与实务训练";
  }
  return trimPoint(t);
}

function extractEmployPoint(...sources: string[]): string {
  for (const text of sources) {
    if (!text.trim()) continue;
    const patterns = [
      /(?:为)?就业(?:准备|导向)?[:：]\s*([^；;\n,，]+)/i,
      /(?:想)?尽快工作[^。；,，]{0,40}/,
      /(?:应以|应该|需要)[^。；,，]{0,20}(?:工作技能|职场技能|就业)[^。；,，]{0,24}/,
      /(?:侧重|优先)[^。；,，]{0,16}(?:工作技能|就业|职场)[^。；,，]{0,20}/,
      /工作技能[^。；,，]{0,36}/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const raw = (m[1] ?? m[0]).trim();
        if (raw.length >= 6 && !isTaskOrPositionBlob(raw)) return trimPoint(raw);
      }
    }
  }
  if (/尽快工作|工作技能|就业/.test(sources.join(" "))) {
    return "想尽快就业的学生应侧重可上岗的工作技能";
  }
  return "";
}

function extractAcademicPoint(...sources: string[]): string {
  for (const text of sources) {
    if (!text.trim()) continue;
    if (/医学|专业理论|理论知识/.test(text) && /体系化|循序渐进|底子|花时间/.test(text)) {
      return trimPoint(
        "非就业导向学生需掌握体系化专业理论（如医学基础），打底后才能深入",
      );
    }
    if (/医学|专业理论/.test(text) && text.length >= 20) {
      return trimPoint("大学应为深造导向学生提供系统专业理论知识");
    }
    const patterns = [
      /知识(?:本身)?[:：]\s*([^；;\n,，]+)/i,
      /(?:走)?学术(?:道路)?[^。；,，]{0,40}/,
      /纯粹(?:的)?知识[^。；,，]{0,36}/,
      /(?:应以|应该|需要)[^。；,，]{0,20}(?:知识|学术|深造)[^。；,，]{0,24}/,
      /(?:侧重|优先)[^。；,，]{0,16}(?:知识|学术|领域)[^。；,，]{0,20}/,
      /(?:系统|持续)[^。；,，]{0,12}(?:学习|积累)[^。；,，]{0,28}/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const raw = (m[1] ?? m[0]).trim();
        if (raw.length >= 8 && !isTaskOrPositionBlob(raw)) return trimPoint(raw);
      }
    }
  }
  return "";
}

function pointFromSideText(text: string, side: "employ" | "academic"): string {
  const extracted =
    side === "employ" ? extractEmployPoint(text) : extractAcademicPoint(text);
  if (extracted) return extracted;
  const t = text.trim();
  if (!t || isTaskOrPositionBlob(t)) return "";
  return trimPoint(firstSentence(t, MAX_BODY_POINT_CHARS));
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

/** 从聊天生成六栏（仅 substance 够时调用） */
export function buildHandoffFromChat(state: SessionState): Stage1Handoff {
  const msgs = userMessages(state);
  const blob = msgs.join("\n");
  const { employText, academicText } = accumulateDimensionTexts(msgs);
  const h = state.handoff;
  const lastAcad = lastRichAcademicMessage(msgs);

  let body1 =
    h?.body1Point?.trim() ||
    pointFromSideText(employText, "employ") ||
    extractEmployPoint(blob);
  body1 = normalizeEmployPoint(body1);

  let body2 =
    h?.body2Point?.trim() ||
    extractAcademicPoint(lastAcad, academicText, blob) ||
    pointFromSideText(academicText, "academic");

  return {
    questionType:
      h?.questionType?.trim() ||
      (/\bdiscuss\b|讨论|双方/i.test(blob) ? "discuss" : "unknown"),
    taskUnderstanding:
      h?.taskUnderstanding?.trim() || inferTask(blob),
    position: h?.position?.trim() || inferPosition(blob),
    body1Point: body1,
    body1Angle:
      h?.body1Angle?.trim() ||
      (body1 && employText.length >= 8 ? "就业市场与职场技能" : ""),
    body2Point: body2,
    body2Angle:
      h?.body2Angle?.trim() ||
      (body2 && academicText.length >= 8 ? "学术深造与知识体系" : ""),
  };
}

export function sanitizeHandoffProposal(
  proposal: Stage1Handoff,
  state: SessionState,
): Stage1Handoff | null {
  const ruleBuilt = buildHandoffFromChat(state);
  const out: Stage1Handoff = { ...proposal };

  if (!isValidBodyPoint(out.body1Point, "employ")) {
    out.body1Point = ruleBuilt.body1Point;
    if (!out.body1Angle?.trim() && ruleBuilt.body1Angle) {
      out.body1Angle = ruleBuilt.body1Angle;
    }
  } else {
    out.body1Point = normalizeEmployPoint(out.body1Point);
  }

  if (
    !isValidBodyPoint(out.body2Point, "academic") ||
    GENERIC_ACADEMIC_POINT.test(out.body2Point.trim())
  ) {
    out.body2Point = ruleBuilt.body2Point;
    if (!out.body2Angle?.trim() && ruleBuilt.body2Angle) {
      out.body2Angle = ruleBuilt.body2Angle;
    }
  } else {
    out.body2Point = trimPoint(out.body2Point);
  }
  if (
    ruleBuilt.body2Point &&
    GENERIC_ACADEMIC_POINT.test(out.body2Point.trim()) &&
    isValidBodyPoint(ruleBuilt.body2Point, "academic")
  ) {
    out.body2Point = ruleBuilt.body2Point;
  }

  if (!out.taskUnderstanding?.trim()) {
    out.taskUnderstanding = ruleBuilt.taskUnderstanding;
  }
  if (!out.position?.trim()) {
    out.position = ruleBuilt.position;
  }

  return isHandoffProposalComplete(out) ? out : null;
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
      "就业/技能一侧：用一句话说清这段想写什么（例如实习、项目、职场能力）",
    );
  }
  if (academicScore < 2) {
    gaps.push(
      "学术/知识一侧：用一句话说清这段想写什么（例如长期学习、研究兴趣）",
    );
  }

  const bothViewsInTask =
    /双方|两种|discuss|讨论|纯粹|技能|知识|workplace|academic/i.test(blob);
  if (!bothViewsInTask) {
    gaps.push("题目中的两种观点是否都点到（职场技能 vs 为知识而学）");
  }

  const sufficient =
    gaps.length === 0 &&
    employScore >= 2 &&
    academicScore >= 2 &&
    bothViewsInTask;

  return {
    sufficient,
    gaps: sufficient ? [] : gaps,
    coachPrompt: gaps[0],
  };
}

export function isHandoffProposalComplete(h: Partial<Stage1Handoff>): boolean {
  return !!(
    h.taskUnderstanding?.trim() &&
    h.position?.trim() &&
    isValidBodyPoint(h.body1Point, "employ") &&
    h.body1Angle?.trim() &&
    isValidBodyPoint(h.body2Point, "academic") &&
    h.body2Angle?.trim()
  );
}

export function proposedHandoffFromResult(
  result: {
    proposedHandoff?: Stage1Handoff;
    extracted?: Record<string, unknown>;
    proposalSummary?: string;
  },
  state?: SessionState,
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
  if (!state) {
    return isHandoffProposalComplete(proposal) ? proposal : null;
  }
  return sanitizeHandoffProposal(proposal, state);
}

export function extractProposedHandoffRule(
  state: SessionState,
): Stage1Handoff | null {
  const substance = assessEssaySubstance(state);
  if (!substance.sufficient) return null;
  const fromChat = buildHandoffFromChat(state);
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
    `${HANDOFF_FIELD_LABELS.taskUnderstanding}：${proposal.taskUnderstanding}`,
    `${HANDOFF_FIELD_LABELS.position}：${proposal.position}`,
    `${HANDOFF_FIELD_LABELS.body1Point}：${proposal.body1Point}`,
    `${HANDOFF_FIELD_LABELS.body1Angle}：${proposal.body1Angle}`,
    `${HANDOFF_FIELD_LABELS.body2Point}：${proposal.body2Point}`,
    `${HANDOFF_FIELD_LABELS.body2Angle}：${proposal.body2Angle}`,
    "若认可，请点左侧「确认整理并填入」，可改几个字后再提交定稿。",
  ].join("\n");
}
