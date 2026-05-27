import { isDemoEmployAcademicTopic } from "./stage1-topic-profile";
import { resolveQuestionHintType } from "./stage1-question-hint";
import {
  extractExplorationThemes,
  getPointRefinementAsk,
  isPointSpecificEnough,
  isProsConsQuestionType,
  suggestStructureQuestion,
  themesToHandoffPatch,
} from "./stage1-exploration-themes";
import {
  buildGapProgressionMirror as buildGapProgressionMirrorLabeled,
  buildRecordedSidesPreview as buildRecordedSidesPreviewWithLabels,
  explorationSideLabel,
  isOppositeGapCoachQuestion,
  singleGapCoachPrompt,
} from "./stage1-exploration";
import type {
  ExplorationSide,
  ExplorationSides,
  QuestionType,
  SessionState,
  Stage1Handoff,
} from "./types";

export {
  explorationSideLabel,
  singleGapCoachPrompt,
  gapSideFromCoachQuestion,
  isOppositeGapCoachQuestion,
  brainstormFallback,
  brainstormSummaryFallback,
  shouldBrainstormFirst,
} from "./stage1-exploration";

/** @deprecated 使用 accumulateSideTexts */
export function accumulateDimensionTexts(msgs: string[]): {
  employText: string;
  academicText: string;
} {
  const { sideAText, sideBText } = accumulateSideTexts(msgs);
  return { employText: sideAText, academicText: sideBText };
}

const SUBSTANCE_MARKERS =
  /因为|所以|应该|需要|才能|例如|比如|通过|可以|有助于|提升|积累|学习|培养|实习|研究|技能|知识|工作|学术/i;

const EMPLOY_SECTION_RE =
  /(?:为)?就业(?:准备|导向)?[^:：]{0,16}[:：]\s*([^；;\n]+)/i;
const ACADEMIC_SECTION_RE =
  /知识(?:本身)?[^:：]{0,16}[:：]\s*([^；;\n]+)/i;

const TASK_BLOB_RE =
  /discuss\s+both|讨论|双方|大学教育|这题|题目|取决于学生|个人规划|我认为/i;

const MAX_BODY_POINT_CHARS = 72;

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

/** demo 题（q2）分句归类：sideA≈就业向，sideB≈学术向 */
function classifyChunkDemo(
  chunk: string,
): "sideA" | "sideB" | "neutral" | "mixed" {
  const e = dimEmployCount(chunk);
  const a = dimAcademicCount(chunk);
  if (e > 0 && a === 0) return "sideA";
  if (a > 0 && e === 0) return "sideB";
  if (e > 0 && a > 0) {
    const sideAOnly =
      /尽快工作|工作技能|就业准备|为就业|求职|实习|上岗/.test(chunk) &&
      !/纯粹|学术道路|学术深造|领域知识|知识本身|科研|读研/.test(chunk);
    const sideBOnly =
      /纯粹|学术道路|学术深造|领域知识|知识本身|科研|读研|为知识/.test(chunk) &&
      !/尽快工作|工作技能|就业准备/.test(chunk);
    if (sideAOnly) return "sideA";
    if (sideBOnly) return "sideB";
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

/** 单条消息按分句/标签拆到 sideA(Body1)、sideB(Body2) */
export function accumulateSideTexts(msgs: string[]): {
  sideAText: string;
  sideBText: string;
} {
  let sideAText = "";
  let sideBText = "";

  for (const m of msgs) {
    const empSec = m.match(EMPLOY_SECTION_RE);
    const acadSec = m.match(ACADEMIC_SECTION_RE);
    if (empSec?.[1]) sideAText = appendSide(sideAText, empSec[1]);
    if (acadSec?.[1]) sideBText = appendSide(sideBText, acadSec[1]);

    for (const chunk of splitMessageByChunks(m)) {
      if (isExplorationTaskChunk(chunk)) continue;
      if (empSec?.[1] && chunk.includes(empSec[1].slice(0, Math.min(8, empSec[1].length)))) {
        continue;
      }
      if (acadSec?.[1] && chunk.includes(acadSec[1].slice(0, Math.min(8, acadSec[1].length)))) {
        continue;
      }

      const kind = classifyChunkDemo(chunk);
      if (kind === "sideA") {
        if (!isPositionOnlyChunkDemo(chunk, "sideA")) {
          sideAText = appendSide(sideAText, chunk);
        }
      } else if (kind === "sideB") {
        if (!isPositionOnlyChunkDemo(chunk, "sideB")) {
          sideBText = appendSide(sideBText, chunk);
        }
      } else if (
        kind === "mixed" ||
        (dimEmployCount(chunk) >= 1 && dimAcademicCount(chunk) >= 1)
      ) {
        const parts = chunk.split(
          /(?=知识本身|学术道路|学术|纯粹|反之|on the other hand|尽快工作|工作技能)/i,
        );
        for (const p of parts) {
          const k = classifyChunkDemo(p);
          if (k === "sideA" && !isPositionOnlyChunkDemo(p, "sideA")) {
            sideAText = appendSide(sideAText, p);
          } else if (k === "sideB" && !isPositionOnlyChunkDemo(p, "sideB")) {
            sideBText = appendSide(sideBText, p);
          }
        }
      }
    }
  }

  return { sideAText: sideAText.trim(), sideBText: sideBText.trim() };
}

function sideTextsFromMessage(message: string): {
  sideAText: string;
  sideBText: string;
} {
  return accumulateSideTexts([message]);
}

/** 本轮是否分别给出两侧分论点方向（不能仅靠题目关键词混在一段里） */
export function userAnsweredBothSidesInMessage(message?: string): boolean {
  if (!message?.trim()) return false;
  const m = message.trim();
  if (EMPLOY_SECTION_RE.test(m) && ACADEMIC_SECTION_RE.test(m)) return true;

  const { sideAText, sideBText } = sideTextsFromMessage(m);
  return (
    scoreTextSubstance(sideAText) >= 2 && scoreTextSubstance(sideBText) >= 2
  );
}

function trimPoint(text: string): string {
  const t = text.trim().replace(/^[,，、\s]+|[,，、\s]+$/g, "");
  if (t.length <= MAX_BODY_POINT_CHARS) return t;
  const slice = t.slice(0, MAX_BODY_POINT_CHARS);
  const punct = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("；"),
    slice.lastIndexOf("，"),
    slice.lastIndexOf("、"),
  );
  if (punct >= 20) return slice.slice(0, punct).trim();
  return `${slice.trim()}…`;
}

/** 分论点在句中被截断（如「及长期」结尾） */
export function isIncompleteBodyPoint(
  text: string | undefined,
  _side: ExplorationSide,
): boolean {
  const t = text?.trim() ?? "";
  if (t.length < 10) return true;
  if (/[，,、]$/.test(t)) return true;
  if (
    /(及长期|及体系|及学生|及职场|及就业|学术兴趣及长期|兴趣及长期)$/.test(t)
  ) {
    return true;
  }
  if (!/[。！？]$/.test(t) && /(及|的|在|为|以|及长)$/.test(t) && t.length < 32) {
    return true;
  }
  return false;
}

function preferBodyPoint(
  primary: string | undefined,
  fallback: string | undefined,
  side: ExplorationSide,
  state?: SessionState,
): string {
  const p = primary?.trim() ?? "";
  const f = fallback?.trim() ?? "";
  if (!f) return p;
  if (!p) return f;
  if (isIncompleteBodyPoint(p, side)) return f;
  if (
    isValidBodyPoint(f, side, state) &&
    (!isValidBodyPoint(p, side, state) || f.length > p.length + 6)
  ) {
    return f;
  }
  return p;
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
const GENERIC_EMPLOY_POINT_RE =
  /^以就业为目标的学生|^想尽快就业的学生应侧重可上岗的工作技能/;

function sideMessageSubstantiveDemo(m: string, side: ExplorationSide): boolean {
  if (isExplorationTaskChunk(m) || isPositionOnlyChunkDemo(m, side)) return false;
  const { sideAText, sideBText } = accumulateSideTexts([m]);
  const t = side === "sideA" ? sideAText : sideBText;
  if (t.length >= 10 && scoreTextSubstance(t) >= 2) return true;
  if (side === "sideA") {
    return (
      /项目|实习|实操|课本|竞争优势|项目经验|职场|招聘/.test(m) &&
      m.length >= 12
    );
  }
  return (
    /课程|由浅入深|系统|医学|学术道路|领域|持续.*学习|知识本身/.test(m) &&
    m.length >= 10
  );
}

function isPositionOnlyChunkGeneric(message: string): boolean {
  const m = message.trim();
  if (m.length > 100) return false;
  return (
    /取决于|看情况|部分同意|利大于弊|弊大于利|好处更多|坏处更多|总体判断|立场/.test(
      m,
    ) &&
    !/例如|比如|因为|所以|才能|有助于|一方面|另一方面/.test(m) &&
    m.length < 72
  );
}

function genericSideSubstantive(message: string): boolean {
  const m = message.trim();
  if (!m || isExplorationTaskChunk(m) || isPositionOnlyChunkGeneric(m)) {
    return false;
  }
  return scoreTextSubstance(m) >= 2;
}

function explorationSideStatusDemo(msgs: string[]): ExplorationSides {
  let sideA = false;
  let sideB = false;
  for (const m of msgs) {
    if (sideMessageSubstantiveDemo(m, "sideA")) sideA = true;
    if (sideMessageSubstantiveDemo(m, "sideB")) sideB = true;
  }
  return { sideA, sideB };
}

function explorationSideStatusGeneric(
  state: SessionState,
  msgs: string[],
): ExplorationSides {
  const h = state.handoff ?? state.handoffProposal;

  if (isProsConsQuestionType(resolveQuestionHintType(state))) {
    const themes = extractExplorationThemes(state, msgs);
    return {
      sideA:
        isValidBodyPoint(h?.body1Point, "sideA", state) ||
        themes.benefits.length >= 1,
      sideB:
        isValidBodyPoint(h?.body2Point, "sideB", state) ||
        themes.drawbacks.length >= 1,
    };
  }

  const substantive = msgs.filter((m) => genericSideSubstantive(m));
  return {
    sideA:
      isValidBodyPoint(h?.body1Point, "sideA", state) || substantive.length >= 1,
    sideB:
      isValidBodyPoint(h?.body2Point, "sideB", state) || substantive.length >= 2,
  };
}

/** Body1(sideA) / Body2(sideB) 是否已有可写一段的实质方向 */
export function explorationSideStatus(
  state: SessionState,
  msgs: string[] = userMessages(state),
): ExplorationSides {
  if (isDemoEmployAcademicTopic(state)) {
    return explorationSideStatusDemo(msgs);
  }
  return explorationSideStatusGeneric(state, msgs);
}

/** demo 题：仅含立场措辞、尚无该侧分论点 substance */
function isPositionOnlyChunkDemo(message: string, side: ExplorationSide): boolean {
  const m = message.trim();
  if (m.length > 100) return false;
  if (side === "sideA") {
    const sideAish =
      /尽快工作|工作技能为主|就业导向|应以工作技能/.test(m) &&
      !/实习|项目|实践|岗位|招聘|雇主|课程|训练|因为.*(?:技能|就业|工作)/.test(m);
    const hasSubstance =
      /例如|比如|写什么|一段|论证|积累|提升|竞争力|实操|课本|项目经验|竞争优势/.test(
        m,
      );
    return sideAish && !hasSubstance && m.length < 85;
  }
  const sideBish =
    /学术道路|纯粹|反之亦然/.test(m) &&
    !/持续|积累|领域|研究|兴趣|因为|体系|医学|理论|课程|由浅入深|专业/.test(m);
  return sideBish && m.length < 40;
}

/** 学生表示暂时无法补充（两侧已够时可收口） */
export function detectExplorationStuck(message?: string): boolean {
  return (
    !!message?.trim() &&
    /想不到|暂时想不出|没有特别|说不清|不太清楚|不知道.*方法|没法说/.test(
      message,
    )
  );
}

export function isDivergentCoachQuestion(question: string): boolean {
  return /开放|批判性|教学机会|学习环境|教学方法|哪些领域|深入探索|特别的教学|更具.*批判/.test(
    question,
  );
}

export function buildRecordedSidesPreview(
  state: SessionState,
  msgs?: string[],
): string {
  const { sideAText, sideBText } = accumulateSideTexts(msgs ?? userMessages(state));
  return buildRecordedSidesPreviewWithLabels(state, sideAText, sideBText);
}

function normCoachQuestion(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").slice(0, 40);
}

export function isRepeatedQuestion(
  prev: string,
  next: string,
  state?: SessionState,
): boolean {
  if (!prev.trim() || !next.trim()) return false;
  if (state && isOppositeGapCoachQuestion(prev, next, state)) return false;
  const a = normCoachQuestion(prev);
  const b = normCoachQuestion(next);
  if (a === b) return true;
  if (a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a))) return true;
  const themes = [
    ["职能", "强调", "观点"],
    ["两个观点", "双方", "分别"],
    ["平衡", "体现", "价值"],
    ["概括", "一句话", "任务"],
    ["填左侧", "6 栏", "定稿"],
    ["各用一句话", "就业技能一侧", "学术知识一侧"],
    ["两侧", "写实"],
    ["就业/技能一侧", "就业技能一侧", "实习、项目"],
    ["学术/知识一侧", "学术知识一侧", "长期学习"],
    ["开放", "批判性", "教学机会"],
    ["哪些领域", "教学方法", "学习机会"],
    ["你认为大学", "应该提供哪些"],
    ["好处", "收入", "带动", "服务业", "利大于弊"],
    ["坏处", "弊端", "拥挤", "环境", "垃圾", "堵车"],
    ["压过", "哪一方面", "具体是什么", "最明显"],
  ];
  for (const group of themes) {
    if (group.some((w) => prev.includes(w)) && group.some((w) => next.includes(w))) {
      return true;
    }
  }
  return false;
}

/** 本轮用户是否回答了上一问所对应的一侧 */
export function userAnsweredExplorationGap(
  message: string | undefined,
  side: ExplorationSide,
  state: SessionState,
): boolean {
  if (!message?.trim()) return false;
  const m = message.trim();
  if (isDemoEmployAcademicTopic(state)) {
    return sideMessageSubstantiveDemo(m, side);
  }
  return genericSideSubstantive(m);
}

/** 一侧刚确认后，正面承接再追问另一侧 */
export function buildGapProgressionMirror(
  completedSide: ExplorationSide,
  state: SessionState,
  msgs: string[],
): string {
  const { sideAText, sideBText } = accumulateSideTexts(msgs);
  const hint =
    completedSide === "sideA" ? sideAText : sideBText;
  return buildGapProgressionMirrorLabeled(completedSide, state, hint);
}

export function isValidBodyPoint(
  text: string | undefined,
  side: ExplorationSide,
  state?: SessionState,
): boolean {
  const t = text?.trim() ?? "";
  if (t.length < 8 || t.length > MAX_BODY_POINT_CHARS + 8) return false;
  if (isIncompleteBodyPoint(t, side)) return false;
  if (isTaskOrPositionBlob(t)) return false;

  const demo = state ? isDemoEmployAcademicTopic(state) : false;
  if (demo && side === "sideA") {
    if (dimEmployCount(t) < 1) return false;
    if (/^应该以?工作技能为主[。.]?$/i.test(t)) return false;
    if (GENERIC_EMPLOY_POINT_RE.test(t)) return false;
    return true;
  }
  if (demo && side === "sideB") {
    if (dimAcademicCount(t) < 1) return false;
    if (GENERIC_ACADEMIC_POINT.test(t)) return false;
    return true;
  }

  return isPointSpecificEnough(t);
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
  return normalizeBody1PointForHandoff(text);
}

/** 合并拼接的 Body1 分论点为一句 */
export function normalizeBody1PointForHandoff(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (
    /应该以?工作技能为主/.test(t) &&
    /提前积累|项目|实习/.test(t)
  ) {
    return trimPoint(
      "大学应让学生提前积累工作技能、项目与实习经验",
    );
  }
  if (/^应该以?工作技能为主[。.]?$/i.test(t)) {
    return trimPoint("以就业为目标的学生，大学应侧重可上岗的工作技能");
  }
  return trimPoint(t.split(/(?=提前积累|另外)/)[0] ?? t);
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
      /项目经验[^。；,，]{0,36}/,
      /实操[^。；,，]{0,30}/,
      /课本[^。；,，]{0,20}[^。；,，]{0,24}/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const raw = (m[1] ?? m[0]).trim();
        if (raw.length >= 6 && !isTaskOrPositionBlob(raw)) return trimPoint(raw);
      }
    }
  }
  return "";
}

function synthesizeAcademicPoint(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (
    /学术道路|感兴趣|持续.*学习|知识本身需要时间|纯粹.*知识/.test(t)
  ) {
    return trimPoint(
      "大学应为走学术道路的学生提供持续学习感兴趣领域并系统积累知识的机会",
    );
  }
  return "";
}

function extractAcademicPoint(...sources: string[]): string {
  for (const text of sources) {
    if (!text.trim()) continue;
    const synth = synthesizeAcademicPoint(text);
    if (synth) return synth;
    if (/医学|专业理论|理论知识/.test(text) && /体系化|循序渐进|底子|花时间/.test(text)) {
      return trimPoint(
        "非就业导向学生需掌握体系化专业理论（如医学基础），打底后才能深入",
      );
    }
    if (/医学|专业理论/.test(text) && text.length >= 20) {
      return trimPoint("大学应为深造导向学生提供系统专业理论知识");
    }
    if (/课程规划|由浅入深|系统.*学习/.test(text) && text.length >= 12) {
      return trimPoint("大学应提供系统课程与由浅入深的递进式学习");
    }
    if (/看学生专业|医学/.test(text) && /系统|学习/.test(text)) {
      return trimPoint("按专业需要系统学习（如医学）以打好理论基础");
    }
    const patterns = [
      /知识(?:本身)?[:：]\s*([^；;\n,，]+)/i,
      /(?:想)?走学术(?:道路)?[^。；,，]{0,40}/,
      /持续地?学习[^。；,，]{0,36}/,
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

function pointFromSideText(text: string, side: ExplorationSide): string {
  const extracted =
    side === "sideA" ? extractEmployPoint(text) : extractAcademicPoint(text);
  if (extracted) return extracted;
  const t = text.trim();
  if (!t || isTaskOrPositionBlob(t)) return "";
  return trimPoint(firstSentence(t, MAX_BODY_POINT_CHARS));
}

export function isMostlyEnglish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const latin = (t.match(/[a-zA-Z]/g) ?? []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return latin > 10 && latin >= cjk;
}

function preferChineseHandoffText(primary: string, fallback: string): string {
  const p = primary.trim();
  const f = fallback.trim();
  if (!p) return f;
  if (!f) return p;
  if (isMostlyEnglish(p) && !isMostlyEnglish(f)) return f;
  return p;
}

/** 已进入 Body 搭链阶段的话误发到审题聊天 */
export function isStage1ChainLeakMessage(message?: string): boolean {
  const m = message?.trim() ?? "";
  if (!m || m.length < 12) return false;
  if (/搭\s*Body|论证链|S2_2|Claim|Reason|Example|Link\s*[:：]/i.test(m)) {
    return true;
  }
  return (
    /课本.*(?:职场|实践|技能)|(?:学术|职场).*(?:不匹配|脱节)|实践项目.*补充/.test(
      m,
    ) && /因此|所以|才|需要/.test(m)
  );
}

function inferTask(blob: string, state: SessionState): string {
  const fromHandoff = state.handoff?.taskUnderstanding?.trim();
  if (fromHandoff) return fromHandoff;
  if (isDemoEmployAcademicTopic(state) && /discuss|讨论|双方|两种|both views/i.test(blob)) {
    return "讨论大学教育应侧重职场技能还是为知识而学";
  }
  const topic = state.topic?.trim();
  if (topic && topic.length <= 120) {
    return topic.length > 60 ? `${topic.slice(0, 58)}…` : topic;
  }
  return "明确题目讨论范围与任务";
}

function inferPosition(blob: string, state: SessionState): string {
  const fromHandoff = state.handoff?.position?.trim();
  if (fromHandoff) return fromHandoff;
  if (isDemoEmployAcademicTopic(state) && /取决于|看情况|规划|路径|分流|反之|尽快工作|学术道路/.test(blob)) {
    return "取决于学生个人规划：就业导向侧重技能，学术导向侧重知识积累";
  }
  if (/利大于弊|好处更多|坏处更多|优势更大|劣势更大|more advantages|outweigh/i.test(blob)) {
    return "总体判断：利大于弊（或弊大于利）";
  }
  if (/同意|不同意|部分同意|to some extent/i.test(blob)) {
    return "对题目观点的明确立场";
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

/** 从聊天生成六栏（仅两侧均有用户实质内容时调用） */
export function buildHandoffFromChat(state: SessionState): Stage1Handoff {
  const msgs = userMessages(state);
  const blob = msgs.join("\n");
  const { sideAText, sideBText } = accumulateSideTexts(msgs);
  const sides = explorationSideStatus(state, msgs);
  const h = state.handoff;
  const lastAcad = lastRichAcademicMessage(msgs);
  const demo = isDemoEmployAcademicTopic(state);

  let body1 = h?.body1Point?.trim() || "";
  if (sides.sideA) {
    body1 =
      body1 ||
      (demo
        ? pointFromSideText(sideAText, "sideA") || extractEmployPoint(sideAText)
        : firstSentence(sideAText, MAX_BODY_POINT_CHARS)) ||
      "";
    if (demo) body1 = normalizeBody1PointForHandoff(body1);
  }

  let body2 = h?.body2Point?.trim() || "";
  if (sides.sideB) {
    body2 =
      body2 ||
      (demo
        ? extractAcademicPoint(lastAcad, sideBText) ||
          pointFromSideText(sideBText, "sideB")
        : firstSentence(sideBText, MAX_BODY_POINT_CHARS)) ||
      "";
  }

  const hintTypeEarly =
    h?.questionType?.trim() ||
    resolveQuestionHintType(state) ||
    (/\bdiscuss\b|讨论|双方/i.test(blob)
      ? "discuss"
      : /advantages?\s+and\s+disadvantages?|利弊|优缺点/i.test(blob)
        ? "adv_disadv"
        : "unknown");

  let body1Angle = h?.body1Angle?.trim() || "";
  let body2Angle = h?.body2Angle?.trim() || "";
  let position = h?.position?.trim() || inferPosition(blob, state);

  const hintType = hintTypeEarly as QuestionType;

  if (!demo && isProsConsQuestionType(hintType)) {
    const themes = extractExplorationThemes(state, msgs);
    if (themes.readyToFinalize && themes.themesComplete) {
      const patch = themesToHandoffPatch(themes, state, msgs);
      body1 = body1 || patch.body1Point || "";
      body2 = body2 || patch.body2Point || "";
      body1Angle = body1Angle || patch.body1Angle || "";
      body2Angle = body2Angle || patch.body2Angle || "";
      position = position || patch.position || position;
    }
  }

  return {
    questionType: String(hintType).trim() || "unknown",
    taskUnderstanding:
      h?.taskUnderstanding?.trim() || inferTask(blob, state),
    position,
    body1Point: body1,
    body1Angle:
      body1Angle ||
      (body1 && demo ? "就业市场与职场技能" : body1 ? explorationSideLabel(state, "sideA") : ""),
    body2Point: body2,
    body2Angle:
      body2Angle ||
      (body2 && demo ? "学术深造与知识体系" : body2 ? explorationSideLabel(state, "sideB") : ""),
  };
}

export function sanitizeHandoffProposal(
  proposal: Stage1Handoff,
  state: SessionState,
): Stage1Handoff | null {
  const msgs = userMessages(state);
  const sides = explorationSideStatus(state, msgs);
  const ruleBuilt = buildHandoffFromChat(state);
  const out: Stage1Handoff = { ...proposal };

  if (!sides.sideA) {
    out.body1Point = "";
    out.body1Angle = "";
  } else {
    out.body1Point = preferBodyPoint(
      normalizeBody1PointForHandoff(out.body1Point),
      ruleBuilt.body1Point,
      "sideA",
      state,
    );
    if (!out.body1Angle?.trim() && ruleBuilt.body1Angle) {
      out.body1Angle = ruleBuilt.body1Angle;
    }
  }

  if (!sides.sideB) {
    out.body2Point = "";
    out.body2Angle = "";
  } else {
    out.body2Point = preferBodyPoint(
      trimPoint(out.body2Point),
      ruleBuilt.body2Point,
      "sideB",
      state,
    );
    if (!out.body2Angle?.trim() && ruleBuilt.body2Angle) {
      out.body2Angle = ruleBuilt.body2Angle;
    }
  }
  if (
    sides.sideB &&
    ruleBuilt.body2Point &&
    (GENERIC_ACADEMIC_POINT.test(out.body2Point.trim()) ||
      isIncompleteBodyPoint(out.body2Point, "sideB")) &&
    isValidBodyPoint(ruleBuilt.body2Point, "sideB", state)
  ) {
    out.body2Point = ruleBuilt.body2Point;
  }

  out.taskUnderstanding = preferChineseHandoffText(
    out.taskUnderstanding ?? "",
    ruleBuilt.taskUnderstanding ?? "",
  );
  out.position = preferChineseHandoffText(
    out.position ?? "",
    ruleBuilt.position ?? "",
  );
  out.body1Angle = preferChineseHandoffText(
    out.body1Angle ?? "",
    ruleBuilt.body1Angle ?? "",
  );
  out.body2Angle = preferChineseHandoffText(
    out.body2Angle ?? "",
    ruleBuilt.body2Angle ?? "",
  );

  return isHandoffProposalComplete(out, state) ? out : null;
}

export function resolveConfirmableHandoffProposal(
  state: SessionState,
): Stage1Handoff | null {
  const existing = state.handoffProposal;
  if (existing) {
    return sanitizeHandoffProposal(existing, state);
  }
  const built = buildHandoffFromChat(state);
  return isHandoffProposalComplete(built, state) ? built : null;
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

  const msgs = userMessages(state);
  const hintType = resolveQuestionHintType(state);
  if (isProsConsQuestionType(hintType)) {
    const themes = extractExplorationThemes(state, msgs);
    if (themes.themesComplete) {
      return { contentReady: true };
    }
    const hasLean =
      themes.positionLean !== "unknown" ||
      /利大于弊|弊大于利|好处更多|坏处更多|好处多|坏处多|outweigh/i.test(blob);
    const hasTask =
      /discuss|讨论|双方|advantages?|disadvantages?|优缺点|利弊|国际旅游|tourism/i.test(
        blob,
      ) ||
      (state.topic?.trim().length ?? 0) > 20;
    return { contentReady: hasTask && hasLean };
  }

  const hasTask =
    /discuss|讨论|双方|两种观点|agree|disagree|优缺点|利弊|好处|坏处/i.test(blob) ||
    (state.s1?.taskUnderstanding?.trim().length ?? 0) > 8 ||
    (state.topic?.trim().length ?? 0) > 20;
  const hasPosition =
    /取决于|看情况|部分同意|利大于弊|弊大于利|好处更多|坏处更多|好处多|坏处多|优势更大|劣势更大|outweigh/i.test(
      blob,
    ) ||
    (state.handoff?.position?.trim().length ?? 0) > 6 ||
    (state.s1?.position?.trim().length ?? 0) > 6;
  if (isDemoEmployAcademicTopic(state)) {
    const hasSideA =
      /就业|工作|职场|技能|实操|实习|job|career|employ|尽快工作/i.test(blob);
    const hasSideB =
      /学术|研究|理论|知识|深造|phd|academic|纯粹|系统/i.test(blob);
    return { contentReady: hasTask && hasPosition && hasSideA && hasSideB };
  }

  return { contentReady: hasTask && hasPosition };
}

export function assessEssaySubstance(state: SessionState): EssaySubstanceAssessment {
  const { contentReady } = assessExplorationContent(state);
  const msgs = userMessages(state);
  const blob = msgs.join("\n");

  if (!contentReady) {
    const hint = resolveQuestionHintType(state);
    if (isProsConsQuestionType(hint)) {
      const themes = extractExplorationThemes(state, msgs);
      if (themes.positionLean !== "unknown" && !themes.benefits.length) {
        return {
          sufficient: false,
          gaps: ["好处方向"],
          coachPrompt: suggestStructureQuestion(state, themes),
        };
      }
      if (themes.benefits.length && !themes.drawbacks.length) {
        return {
          sufficient: false,
          gaps: ["坏处方向"],
          coachPrompt: suggestStructureQuestion(state, themes),
        };
      }
    }
    const opening =
      (state.coachContext?.exploreRound ?? 0) <= 1
        ? "这题要你讨论什么？你的总体判断是什么？"
        : "还差立场或利弊方向：你的总体判断是什么？打算从哪方面写？";
    return {
      sufficient: false,
      gaps: ["题型与任务", "你的立场", "两个 Body 方向"],
      coachPrompt: opening,
    };
  }

  const sides = explorationSideStatus(state, msgs);
  const gaps: string[] = [];

  const themes = isProsConsQuestionType(resolveQuestionHintType(state))
    ? extractExplorationThemes(state, msgs)
    : null;

  if (!sides.sideA) {
    gaps.push(singleGapCoachPrompt({ sideA: false, sideB: sides.sideB }, state));
  }
  if (!sides.sideB) {
    gaps.push(singleGapCoachPrompt({ sideA: true, sideB: false }, state));
  }

  if (
    isDemoEmployAcademicTopic(state) &&
    !/双方|两种|discuss|讨论|纯粹|技能|知识|workplace|academic/i.test(blob)
  ) {
    gaps.push("题目中的两种观点是否都点到");
  }

  const roundsHint = msgs.length;
  const sufficient =
    themes?.readyToFinalize === true ||
    (!themes &&
      gaps.filter(Boolean).length === 0 &&
      sides.sideA &&
      sides.sideB &&
      (roundsHint >= 2 || blob.length >= 80));

  let coachPrompt = singleGapCoachPrompt(sides, state) || gaps[0] || "";
  if (themes?.themesComplete && !themes.readyToFinalize) {
    coachPrompt = getPointRefinementAsk(state, themes) || coachPrompt;
  }

  return {
    sufficient,
    gaps: sufficient ? [] : gaps.filter(Boolean),
    coachPrompt,
  };
}

export function isHandoffProposalComplete(
  h: Partial<Stage1Handoff>,
  state?: SessionState,
): boolean {
  return !!(
    h.taskUnderstanding?.trim() &&
    h.position?.trim() &&
    isValidBodyPoint(h.body1Point, "sideA", state) &&
    h.body1Angle?.trim() &&
    isValidBodyPoint(h.body2Point, "sideB", state) &&
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
    return isHandoffProposalComplete(proposal, state) ? proposal : null;
  }
  return sanitizeHandoffProposal(proposal, state);
}

export function extractProposedHandoffRule(
  state: SessionState,
): Stage1Handoff | null {
  const substance = assessEssaySubstance(state);
  if (!substance.sufficient) return null;
  const fromChat = buildHandoffFromChat(state);
  return isHandoffProposalComplete(fromChat, state) ? fromChat : null;
}

export function formatProposalCoachMessage(
  _proposal: Stage1Handoff,
  summary?: string,
): string {
  const intro =
    (summary?.trim() && !isMostlyEnglish(summary) ? summary.trim() : "") ||
    "两侧都够写两段了，六栏整理在左侧，请核对。";
  return [
    intro,
    "认可请点「确认整理并填入」，或回复「是」；要改哪一栏直接说。",
  ].join("\n");
}

/** 聊天里口头认可整理提案（非改稿） */
export function isProposalAffirmation(message: string): boolean {
  const m = message.trim();
  if (!m || m.length > 16) return false;
  return /^(?:是|对|可以|好的|没问题|认可|确认|同意|嗯|好|ok|yes)[。.!]?$/i.test(
    m,
  );
}

/** 提交时用聊天记录补强六栏（避免定稿栏过短/泛化） */
export function enrichHandoffFromChat(
  handoff: Stage1Handoff,
  state: SessionState,
): Stage1Handoff {
  const built = buildHandoffFromChat(state);
  const out: Stage1Handoff = { ...handoff };

  out.body1Point = preferBodyPoint(
    out.body1Point,
    built.body1Point,
    "sideA",
    state,
  );
  out.body2Point = preferBodyPoint(
    out.body2Point,
    built.body2Point,
    "sideB",
    state,
  );
  if (!out.body1Angle?.trim() && built.body1Angle) {
    out.body1Angle = built.body1Angle;
  }
  if (!out.body2Angle?.trim() && built.body2Angle) {
    out.body2Angle = built.body2Angle;
  }
  if (!out.taskUnderstanding?.trim() && built.taskUnderstanding) {
    out.taskUnderstanding = built.taskUnderstanding;
  }
  if (!out.position?.trim() && built.position) {
    out.position = built.position;
  }
  return out;
}

const ANGLE_TERM_RE =
  /切入面|角度|视角|讨论范围|什么.*面|不懂.*(面|角度)|body\s*[12].*角度/i;

export function detectAngleConfusion(message?: string): boolean {
  return !!message?.trim() && ANGLE_TERM_RE.test(message);
}

/** 需先教切入面：学生困惑，或分论点已有但切入面未齐 */
export function needsAngleTeaching(
  handoff: Stage1Handoff,
  userMessage: string | undefined,
  contentReady: boolean,
  state?: SessionState,
): { needed: boolean; followUp: string } {
  const confused = detectAngleConfusion(userMessage);
  const p1 = handoff.body1Point?.trim();
  const p2 = handoff.body2Point?.trim();
  const a1 = handoff.body1Angle?.trim();
  const a2 = handoff.body2Angle?.trim();
  const pointsWithoutAngles =
    contentReady && ((!!p1 && !a1) || (!!p2 && !a2) || (!!p1 && !!p2 && (!a1 || !a2)));

  if (!confused && !pointsWithoutAngles) {
    return { needed: false, followUp: "" };
  }

  const labelA = state
    ? explorationSideLabel(state, "sideA")
    : "Body1 方向";
  const labelB = state
    ? explorationSideLabel(state, "sideB")
    : "Body2 方向";
  let followUp: string;
  if (!a1 && !a2) {
    followUp = `Body1 打算从哪一面写（如 ${labelA}）？Body2 用另一个范围（如 ${labelB}）？各说一个词即可。`;
  } else if (!a1) {
    followUp = `Body1（${labelA}）你打算用什么词标出「这一段的范围」？`;
  } else if (!a2) {
    followUp = `Body2（${labelB}）对应的范围词打算写什么？`;
  } else {
    followUp = `两段切入面要不同：${labelA}、${labelB} 各一个词即可。`;
  }

  return { needed: true, followUp };
}

export function resolveHandoffProposal(
  state: SessionState,
  result: {
    proposedHandoff?: Stage1Handoff;
    extracted?: Record<string, unknown>;
  },
): Stage1Handoff | null {
  let proposal = proposedHandoffFromResult(result, state);
  if (!proposal) proposal = extractProposedHandoffRule(state);
  const substance = assessEssaySubstance(state);
  const sides = explorationSideStatus(state);
  const shouldBuild =
    substance.sufficient || (sides.sideA && sides.sideB);
  if (shouldBuild && !isHandoffProposalComplete(proposal ?? {}, state)) {
    const built = buildHandoffFromChat(state);
    if (isHandoffProposalComplete(built, state)) proposal = built;
  }
  if (!proposal) return null;
  return sanitizeHandoffProposal(proposal, state);
}

/** 提交审题定稿后、进 Body1 前的短反馈 */
export function buildStage1SubmitFeedback(h: Stage1Handoff): string {
  const p1 = h.body1Point?.trim();
  const p2 = h.body2Point?.trim();
  return [
    "审题定稿已锁定，可以开始搭论证链。",
    h.position?.trim() ? `总立场：${h.position.trim()}` : "",
    p1 ? `Body1 将论证：${p1}` : "",
    p2 ? `Body2 将论证：${p2}` : "",
    "若还想改立场或分论点，可在左侧微调后再继续。",
  ]
    .filter(Boolean)
    .join("\n");
}
