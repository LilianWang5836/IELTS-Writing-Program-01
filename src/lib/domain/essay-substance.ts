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
      if (kind === "employ") {
        if (!isPositionOnlyChunk(chunk, "employ")) {
          employText = appendSide(employText, chunk);
        }
      } else if (kind === "academic") {
        if (!isPositionOnlyChunk(chunk, "academic")) {
          academicText = appendSide(academicText, chunk);
        }
      }
      else if (kind === "mixed" || (dimEmployCount(chunk) >= 1 && dimAcademicCount(chunk) >= 1)) {
        const parts = chunk.split(
          /(?=知识本身|学术道路|学术|纯粹|反之|on the other hand|尽快工作|工作技能)/i,
        );
        for (const p of parts) {
          const k = classifyChunk(p);
          if (k === "employ" && !isPositionOnlyChunk(p, "employ")) {
            employText = appendSide(employText, p);
          } else if (k === "academic" && !isPositionOnlyChunk(p, "academic")) {
            academicText = appendSide(academicText, p);
          }
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
const GENERIC_EMPLOY_POINT_RE =
  /^以就业为目标的学生|^想尽快就业的学生应侧重可上岗的工作技能/;

function sideMessageSubstantive(m: string, side: "employ" | "academic"): boolean {
  if (isExplorationTaskChunk(m) || isPositionOnlyChunk(m, side)) return false;
  const { employText, academicText } = accumulateDimensionTexts([m]);
  const t = side === "employ" ? employText : academicText;
  if (t.length >= 10 && scoreTextSubstance(t) >= 2) return true;
  if (side === "employ") {
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

/** 用户是否分别用实质性内容说过就业侧 / 学术侧（立场总述不算） */
export function explorationSideStatus(msgs: string[]): {
  employ: boolean;
  academic: boolean;
} {
  let employ = false;
  let academic = false;

  for (const m of msgs) {
    if (sideMessageSubstantive(m, "employ")) employ = true;
    if (sideMessageSubstantive(m, "academic")) academic = true;
  }

  return { employ, academic };
}

/** 仅含「取决于/反之/尽快工作」等立场措辞，没有该侧分论点 substance */
function isPositionOnlyChunk(message: string, side: "employ" | "academic"): boolean {
  const m = message.trim();
  if (m.length > 100) return false;
  if (side === "employ") {
    const employish =
      /尽快工作|工作技能为主|就业导向|应以工作技能/.test(m) &&
      !/实习|项目|实践|岗位|招聘|雇主|课程|训练|因为.*(?:技能|就业|工作)/.test(m);
    const hasSubstance =
      /例如|比如|写什么|一段|论证|积累|提升|竞争力|实操|课本|项目经验|竞争优势/.test(
        m,
      );
    return employish && !hasSubstance && m.length < 85;
  }
  const academicish =
    /学术道路|纯粹|反之亦然/.test(m) &&
    !/持续|积累|领域|研究|兴趣|因为|体系|医学|理论|课程|由浅入深|专业/.test(
      m,
    );
  return academicish && m.length < 40;
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

export function buildRecordedSidesPreview(msgs: string[]): string {
  const { employText, academicText } = accumulateDimensionTexts(msgs);
  const parts: string[] = [];
  if (employText.length >= 10) {
    const hint = employText.slice(0, 36).trim();
    parts.push(`就业侧（技能/项目/实操）：${hint}${employText.length > 36 ? "…" : ""}`);
  }
  if (academicText.length >= 10) {
    const hint = academicText.slice(0, 36).trim();
    parts.push(`学术侧（课程/系统学习）：${hint}${academicText.length > 36 ? "…" : ""}`);
  }
  if (!parts.length) return "";
  return `我已记下 ${parts.join("；")}。`;
}

export function singleGapCoachPrompt(
  sides: { employ: boolean; academic: boolean },
): string {
  if (!sides.employ) {
    return "就业/技能一侧：用一句话说清这段想写什么（例如实习、项目、职场能力）";
  }
  if (!sides.academic) {
    return "学术/知识一侧：用一句话说清这段想写什么（例如长期学习、研究兴趣）";
  }
  return "";
}

/** 从教练追问文案判断在问哪一侧 */
export function gapSideFromCoachQuestion(question: string): "employ" | "academic" | null {
  const q = question.trim();
  if (!q) return null;
  const employ =
    /就业\/技能|就业技能|就业.*一侧|Body\s*1|body1|实习、项目|职场能力/.test(q);
  const academic =
    /学术\/知识|学术知识|学术.*一侧|Body\s*2|body2|长期学习|研究兴趣/.test(q);
  if (employ && !academic) return "employ";
  if (academic && !employ) return "academic";
  if (/就业|技能|实习|实操|职场/.test(q) && !/学术|知识|深造|研究兴趣/.test(q)) {
    return "employ";
  }
  if (/学术|知识|深造|研究|领域/.test(q) && !/就业|技能|实习|职场/.test(q)) {
    return "academic";
  }
  return null;
}

/** 就业侧与学术侧填空追问交替时，不算重复问 */
export function isOppositeGapCoachQuestion(prev: string, next: string): boolean {
  const p = gapSideFromCoachQuestion(prev);
  const n = gapSideFromCoachQuestion(next);
  return !!p && !!n && p !== n;
}

/** 本轮用户是否回答了上一问所对应的一侧 */
export function userAnsweredExplorationGap(
  message: string | undefined,
  side: "employ" | "academic",
): boolean {
  if (!message?.trim()) return false;
  return sideMessageSubstantive(message.trim(), side);
}

/** 一侧刚确认后，正面承接再追问另一侧 */
export function buildGapProgressionMirror(
  completedSide: "employ" | "academic",
  msgs: string[],
): string {
  const { employText, academicText } = accumulateDimensionTexts(msgs);
  if (completedSide === "employ" && employText.length >= 8) {
    const hint = employText.slice(0, 40).trim();
    return `就业/技能一侧记下了：${hint}${employText.length > 40 ? "…" : ""}。接下来补学术侧。`;
  }
  if (completedSide === "academic" && academicText.length >= 8) {
    const hint = academicText.slice(0, 40).trim();
    return `学术/知识一侧记下了：${hint}${academicText.length > 40 ? "…" : ""}。接下来补就业侧。`;
  }
  return completedSide === "employ"
    ? "就业/技能这一侧够了。"
    : "学术/知识这一侧够了。";
}

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
    if (GENERIC_EMPLOY_POINT_RE.test(t)) return false;
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

function pointFromSideText(text: string, side: "employ" | "academic"): string {
  const extracted =
    side === "employ" ? extractEmployPoint(text) : extractAcademicPoint(text);
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

/** 从聊天生成六栏（仅两侧均有用户实质内容时调用） */
export function buildHandoffFromChat(state: SessionState): Stage1Handoff {
  const msgs = userMessages(state);
  const blob = msgs.join("\n");
  const { employText, academicText } = accumulateDimensionTexts(msgs);
  const sides = explorationSideStatus(msgs);
  const h = state.handoff;
  const lastAcad = lastRichAcademicMessage(msgs);

  let body1 = h?.body1Point?.trim() || "";
  if (sides.employ) {
    body1 =
      body1 ||
      pointFromSideText(employText, "employ") ||
      extractEmployPoint(employText);
    body1 = normalizeBody1PointForHandoff(body1);
  }

  let body2 = h?.body2Point?.trim() || "";
  if (sides.academic) {
    body2 =
      body2 ||
      extractAcademicPoint(lastAcad, academicText) ||
      pointFromSideText(academicText, "academic");
  }

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
      (body1 && sides.employ ? "就业市场与职场技能" : ""),
    body2Point: body2,
    body2Angle:
      h?.body2Angle?.trim() ||
      (body2 && sides.academic ? "学术深造与知识体系" : ""),
  };
}

export function sanitizeHandoffProposal(
  proposal: Stage1Handoff,
  state: SessionState,
): Stage1Handoff | null {
  const msgs = userMessages(state);
  const sides = explorationSideStatus(msgs);
  const ruleBuilt = buildHandoffFromChat(state);
  const out: Stage1Handoff = { ...proposal };

  if (!sides.employ) {
    out.body1Point = "";
    out.body1Angle = "";
  } else if (!isValidBodyPoint(out.body1Point, "employ")) {
    out.body1Point = ruleBuilt.body1Point;
    if (!out.body1Angle?.trim() && ruleBuilt.body1Angle) {
      out.body1Angle = ruleBuilt.body1Angle;
    }
  } else {
    out.body1Point = normalizeBody1PointForHandoff(out.body1Point);
  }

  if (!sides.academic) {
    out.body2Point = "";
    out.body2Angle = "";
  } else if (
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
    sides.academic &&
    ruleBuilt.body2Point &&
    GENERIC_ACADEMIC_POINT.test(out.body2Point.trim()) &&
    isValidBodyPoint(ruleBuilt.body2Point, "academic")
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

  return isHandoffProposalComplete(out) ? out : null;
}

export function resolveConfirmableHandoffProposal(
  state: SessionState,
): Stage1Handoff | null {
  const existing = state.handoffProposal;
  if (existing) {
    return sanitizeHandoffProposal(existing, state);
  }
  const built = buildHandoffFromChat(state);
  return isHandoffProposalComplete(built) ? built : null;
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

  const sides = explorationSideStatus(msgs);
  const gaps: string[] = [];

  if (!sides.employ) {
    gaps.push(
      "就业/技能一侧：用一句话说清这段想写什么（例如实习、项目、职场能力）",
    );
  }
  if (!sides.academic) {
    gaps.push(
      "学术/知识一侧：用一句话说清这段想写什么（例如长期学习、研究兴趣）",
    );
  }

  const bothViewsInTask =
    /双方|两种|discuss|讨论|纯粹|技能|知识|workplace|academic/i.test(blob);
  if (!bothViewsInTask) {
    gaps.push("题目中的两种观点是否都点到（职场技能 vs 为知识而学）");
  }

  const roundsHint = msgs.length;
  const sufficient =
    gaps.length === 0 &&
    sides.employ &&
    sides.academic &&
    (roundsHint >= 2 || blob.length >= 80);

  return {
    sufficient,
    gaps: sufficient ? [] : gaps,
    coachPrompt: singleGapCoachPrompt(sides) || gaps[0],
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

  if (
    !isValidBodyPoint(out.body1Point, "employ") &&
    isValidBodyPoint(built.body1Point, "employ")
  ) {
    out.body1Point = built.body1Point;
  }
  if (
    !isValidBodyPoint(out.body2Point, "academic") &&
    isValidBodyPoint(built.body2Point, "academic")
  ) {
    out.body2Point = built.body2Point;
  }
  if (
    out.body2Point &&
    out.body2Point.length < 22 &&
    isValidBodyPoint(built.body2Point, "academic")
  ) {
    out.body2Point = built.body2Point;
  }
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
