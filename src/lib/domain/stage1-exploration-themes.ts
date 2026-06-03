/**
 * Stage1 探索：compatibility layer over stage1ThemeProjection (single source of truth).
 */
import {
  brainstormFallback,
  explorationSideLabel,
} from "./stage1-exploration";
import {
  formatStage1GapMemorySummary,
  hasConcreteBenefitConcepts,
  resolveStage1CollectionGap,
  type Stage1CoachGap,
} from "./stage1-coach-gap";
import { isStage1ProjectionComplete } from "./stage1-complete";
import {
  readStage1ThemeProjection,
  stanceToPositionLean,
} from "@/lib/domain/stage1-theme-projection";
import {
  isSemanticToken,
  type SemanticState,
} from "@/runtime/semantic/semantic-projection";
import {
  looksLikeBenefitLine,
  looksLikeDrawbackLine,
} from "@/runtime/semantic/theme-normalization";
import { normalizeFactToCanonical } from "@/runtime/semantic/stage1-fact-normalization";
import type { Stage1ConceptId } from "@/runtime/semantic/theme-normalization";
import {
  splitProsConsInMessage,
} from "./stage1-snippet-harvest";
import type { QuestionType, SessionState, Stage1Handoff, Stage1ThemeProjection } from "./types";

export type PositionLean = Stage1ThemeProjection["positionLean"];

export interface ExplorationThemes {
  benefits: string[];
  drawbacks: string[];
  positionLean: PositionLean;
  /** 利弊 + 立场已齐（尚可能需细化分论点） */
  themesComplete: boolean;
  /** 分论点够具体，可整理六栏 */
  readyToFinalize: boolean;
  /** SPL 语义投影（Stage1 门控补充） */
  semantic?: SemanticState;
}

type SideKind = "benefit" | "drawback";

function trimSnippet(s: string, max = 48): string {
  const t = s.trim().replace(/^[,，、\s]+|[,，、\s]+$/g, "");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function projectionConceptIds(
  ids: string[],
  side: "benefit" | "drawback",
): Stage1ConceptId[] {
  const out: Stage1ConceptId[] = [];
  for (const id of ids) {
    const canonical = normalizeFactToCanonical(id, side);
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

function semanticFromProjection(
  projection: Stage1ThemeProjection,
): SemanticState {
  return {
    benefits: projectionConceptIds(projection.benefit, "benefit"),
    drawbacks: projectionConceptIds(projection.drawback, "drawback"),
    positionLean: (() => {
      const lean = stanceToPositionLean(projection.stance);
      return lean === "balanced" ? "unknown" : lean;
    })(),
    userHasExpressedCompleteIdea:
      projection.benefit.length > 0 ||
      projection.drawback.length > 0 ||
      projection.stance !== "unknown",
  };
}

function explorationThemesFromProjection(
  projection: Stage1ThemeProjection,
): ExplorationThemes {
  return {
    benefits: projection.benefits,
    drawbacks: projection.drawbacks,
    positionLean: projection.positionLean,
    themesComplete: projection.themesComplete,
    readyToFinalize: projection.readyToFinalize,
    semantic: semanticFromProjection(projection),
  };
}

/** Set readyToFinalize once at write time (refinement gate — not concept mapping). */
export function enrichStage1ThemeProjection(
  projection: Stage1ThemeProjection,
  state: SessionState,
  msgs: string[],
): Stage1ThemeProjection {
  if (isStage1ProjectionComplete(projection)) {
    return { ...projection, themesComplete: true, readyToFinalize: true };
  }

  if (!projection.themesComplete) {
    return { ...projection, readyToFinalize: false };
  }

  const themesSnapshot = explorationThemesFromProjection(projection);
  const readyToFinalize =
    isBodyRefinementSatisfied("body1", themesSnapshot, state, msgs) &&
    isBodyRefinementSatisfied("body2", themesSnapshot, state, msgs);

  return { ...projection, readyToFinalize };
}

/** Reads committed stage1ThemeProjection STATE only — no re-extraction. */
export function extractExplorationThemes(
  state: SessionState,
  msgs: string[],
): ExplorationThemes {
  const projection = readStage1ThemeProjection(state);
  if (!projection || projection.concepts === undefined) {
    return {
      benefits: [],
      drawbacks: [],
      positionLean: "unknown",
      themesComplete: false,
      readyToFinalize: false,
      semantic: {
        benefits: [],
        drawbacks: [],
        positionLean: "unknown",
        userHasExpressedCompleteIdea: false,
      },
    };
  }
  const enriched = enrichStage1ThemeProjection(projection, state, msgs);
  return explorationThemesFromProjection(enriched);
}

/** 利大于弊题：从混合句或 LLM 草案中只保留该 Body 对应一侧 */
export function sanitizeBodyPointForLean(
  text: string,
  body: "body1" | "body2",
  positionLean: PositionLean,
): string {
  let kind: SideKind = body === "body1" ? "benefit" : "drawback";
  if (positionLean === "pro") {
    kind = body === "body1" ? "benefit" : "drawback";
  } else if (positionLean === "con") {
    kind = body === "body1" ? "drawback" : "benefit";
  }
  return trimSnippet(isolatePointForSide(text, kind), 72);
}

function isolatePointForSide(text: string, kind: SideKind): string {
  const t = text.trim();
  if (!t) return "";
  const { benefitPart, drawbackPart } = splitProsConsInMessage(t);
  if (kind === "benefit") {
    if (benefitPart) return benefitPart;
    if (/(?:坏处|劣势|弊端)/.test(t)) {
      return t.split(/(?:坏处|劣势|弊端)[：:，,]?\s*/i)[0]?.trim() ?? "";
    }
    if (/(?:但是|然而|不过|但)/.test(t)) {
      return t.split(/(?:但是|然而|不过|但)/)[0]?.replace(/[，,]\s*$/, "").trim() ?? "";
    }
    return t;
  }
  if (drawbackPart) return drawbackPart;
  const afterBut = t.match(/(?:但是|然而|不过|但)\s*([^。；;]+)/)?.[1];
  if (afterBut?.trim()) return afterBut.trim();
  const after = t.match(/(?:坏处|劣势|弊端)[：:，,]?\s*([^。；;]+)/)?.[1];
  if (after?.trim()) return after.trim();
  if (looksLikeDrawbackLine(t) && !/(?:好处|优势|利大于)/.test(t)) {
    return t;
  }
  return "";
}

export function inferPositionLean(blob: string): PositionLean {
  if (/弊大于利|坏处更多|劣势更大|disadvantages?\s+outweigh/i.test(blob)) {
    return "con";
  }
  if (
    /利大于弊|好处更多|优势更大|overall.*benefit|advantages?\s+outweigh|好处多/i.test(
      blob,
    )
  ) {
    return "pro";
  }
  if (/各有|都有|平衡|相当/i.test(blob)) return "balanced";
  return "unknown";
}

const VAGUE_POINT_RE =
  /^(促进|推动|加强|提高|改善|带来).{0,8}(经济|文化|发展|交流)/;

/** 分论点是否够具体（能支撑一段，而非空泛口号） */
export function isPointSpecificEnough(text: string | undefined): boolean {
  const t = text?.trim() ?? "";
  if (t.length < 14) return false;
  if (/^(好处|坏处|利大于弊|弊大于利|整体)/.test(t) && t.length < 24) {
    return false;
  }
  const compact = t.replace(/\s/g, "");
  if (VAGUE_POINT_RE.test(compact) && t.length < 28) return false;
  if (/^(经济|文化)(发展|交流)/.test(compact) && t.length < 20) return false;

  const concrete =
    /游客|居民|当地|本地人|环境|景区|餐馆|交通|垃圾|收入|就业|服务业|道路|生活|时间|线下|消费|网购|便利|通勤|周末|休息|工作日|购物|爱好|消费者|现代人/.test(
      t,
    );
  const relational =
    /导致|造成|带来|增加|减少|让|使得|因为|通过|带动|破坏|影响|提升|挤出|造成|不用|可以|用来|解决|变多|节省|节约/.test(
      t,
    );

  if (t.length >= 22 && concrete && relational) return true;
  if (t.length >= 32 && concrete) return true;
  return false;
}

/** 开场审题话术；利弊已齐后禁止再出现 */
export function isOpeningExplorationPrompt(text: string): boolean {
  return /这题要你讨论什么|你的总体判断是什么|打算从哪两个不同方面写/.test(
    text.trim(),
  );
}

/** 用户本条是否在细化某一 Body 的分论点（与 handoff 回合决策共用） */
export function userMessageRefinesBody(
  message: string,
  body: "body1" | "body2",
  themes: ExplorationThemes,
): boolean {
  const m = message.trim();
  if (!m) return false;

  const objectRe = /游客|居民|当地|本地人|餐馆|酒店|景区|环境|道路|生活|行业|从业|消费者|现代人|工作日|通勤|周末|时间|购物|人们|大家/;
  const relationalRe =
    /导致|造成|带来|带动|增加|减少|让|使得|因为|通过|破坏|影响|提升|挤出|促进|促使|扩大|需要|不用|可以|用来|解决|变多|节省|节约|花费/;
  const benefitKw =
    /收入|就业|服务业|经济|消费|食宿|餐馆|酒店|带动|促进|文化|交流|收益|购物|餐饮|住宿|节省时间|省时|节约|通勤|周末|休息|爱好|效率|便利|生活质量/;
  const drawbackKw =
    /拥堵|堵车|拥挤|垃圾|污染|环境|破坏|不便|影响|耗时|节假日|不良|冲动购物|冲动性?消费|浪费|不需要|过度|不理性|盲目|乱花钱/;

  if (!objectRe.test(m) || !relationalRe.test(m)) return false;

  if (themes.positionLean === "balanced") {
    return benefitKw.test(m) || drawbackKw.test(m);
  }

  const pro = themes.positionLean === "pro";
  const expectsBenefit =
    (body === "body1" && pro) || (body === "body2" && !pro);
  const kw = expectsBenefit ? benefitKw : drawbackKw;
  return kw.test(m);
}

/** 该 Body 是否已有够具体的分论点（整理稿或聊天中任一条写实回答） */
export function isBodyRefinementSatisfied(
  body: "body1" | "body2",
  themes: ExplorationThemes,
  state: SessionState,
  msgs: string[],
): boolean {
  const patch = themesToHandoffPatch(themes, state, msgs);
  const point = body === "body1" ? patch.body1Point : patch.body2Point;
  if (isPointSpecificEnough(point)) return true;
  return msgs.some((m) => userMessageRefinesBody(m, body, themes));
}

function benefitBodyForLean(pro: boolean, body: "body1" | "body2"): SideKind {
  if (pro) return body === "body1" ? "benefit" : "drawback";
  return body === "body1" ? "drawback" : "benefit";
}

/** PLAN layer: collection + refinement gaps — no NL output. */
export function resolveStage1CoachGap(
  state: SessionState,
  themes: ExplorationThemes,
  msgs: string[],
): Stage1CoachGap {
  const collection = resolveStage1CollectionGap(themes);
  if (collection.gapType !== "none") return collection;

  if (!themes.themesComplete) {
    return { gapType: "none", action: "coach" };
  }

  const pro = themes.positionLean === "pro";
  if (!isBodyRefinementSatisfied("body1", themes, state, msgs)) {
    return {
      gapType: "deepen_body1",
      action: "ask_refinement",
      targetBody: "body1",
      side: benefitBodyForLean(pro, "body1"),
    };
  }
  if (!isBodyRefinementSatisfied("body2", themes, state, msgs)) {
    return {
      gapType: "deepen_body2",
      action: "ask_refinement",
      targetBody: "body2",
      side: benefitBodyForLean(pro, "body2"),
    };
  }
  return { gapType: "none", action: "coach" };
}

/** @deprecated Rule layer must not generate NL; use resolveStage1CoachGap + LLM. */
export function getPointRefinementAsk(
  _state: SessionState,
  _themes: ExplorationThemes,
  _msgs: string[] = [],
): string | null {
  return null;
}

/** @deprecated Removed — rule layer must not generate domain-specific questions. */
export function suggestPointRefinementQuestion(
  _state: SessionState,
  _themes: ExplorationThemes,
  _body: "body1" | "body2",
  _pro: boolean,
): string {
  return "";
}

/** 过滤不应再展示的开场式追问 */
export function sanitizeExplorationCoachAsk(
  ask: string,
  themes: ExplorationThemes,
): string {
  const q = ask.trim();
  if (!q) return "";
  if (themes.themesComplete && isOpeningExplorationPrompt(q)) {
    return "";
  }
  return q;
}

export function buildExplorationMemorySummary(
  state: SessionState,
  themes: ExplorationThemes,
  msgs: string[] = state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean),
): string {
  const gap = resolveStage1CoachGap(state, themes, msgs);
  return formatStage1GapMemorySummary(gap, themes);
}

/** 教练追问是否在要学生重复已说过的利弊 */
export function isExplorationQuestionRedundant(
  question: string,
  themes: ExplorationThemes,
): boolean {
  const q = question.trim();
  if (!q) return false;

  const semantic = themes.semantic;
  if (semantic?.userHasExpressedCompleteIdea) {
    if (/好处|优势|benefit|核心.*好|具体.*优势|更受欢迎/i.test(q)) {
      return true;
    }
    if (
      themes.drawbacks.length >= 1 &&
      /坏处|弊端|劣势|不利|负面|什么.*坏/i.test(q) &&
      !/结构|Body|段落|整理|六栏/.test(q)
    ) {
      return true;
    }
  }

  if (
    themes.benefits.length >= 1 &&
    /好处|优势|利|收入|带动|服务业|压过|outweigh|具体.*好处|什么.*好处/i.test(q)
  ) {
    return true;
  }
  if (
    themes.drawbacks.length >= 1 &&
    /坏处|弊端|劣势|不利|拥挤|环境|堵车|垃圾|哪个方面.*负面|针对.*方面/i.test(
      q,
    ) &&
    !/结构|Body|段落|整理|六栏/.test(q)
  ) {
    return true;
  }
  if (themes.themesComplete && isOpeningExplorationPrompt(q)) {
    return true;
  }
  if (
    themes.drawbacks.length >= 1 &&
    themes.positionLean !== "unknown" &&
    !hasConcreteBenefitConcepts(themes.benefits) &&
    /怎么.*平衡|如何.*平衡|平衡这两个|在文章中平衡|两方面.*平衡/i.test(q) &&
    !/结构|Body|段落|整理|六栏/.test(q)
  ) {
    return true;
  }
  if (
    themes.themesComplete &&
    /怎么.*平衡|如何.*平衡|平衡这两个|在文章中平衡|两方面.*平衡/i.test(q) &&
    !/结构|Body|段落|整理|六栏/.test(q)
  ) {
    return true;
  }
  if (
    themes.drawbacks.length >= 1 &&
    /实体店.*倒闭|质量不好|具体定一个|最主要的坏处.*还是/i.test(q) &&
    !/结构|Body|段落|整理|六栏/.test(q)
  ) {
    return true;
  }
  if (
    themes.readyToFinalize &&
    /能.*说说|具体是什么|还有什么|哪一方面/i.test(q) &&
    !/Body|结构|整理|具体一点|写实/.test(q)
  ) {
    return true;
  }
  return false;
}

/** @deprecated Rule layer must not generate NL; PLAN gap → LLM only. */
export function suggestStructureQuestion(
  _state: SessionState,
  _themes: ExplorationThemes,
): string {
  return "";
}

/** 按立场把 themes 写入六栏（利大于弊 → Body1 好处可含多点，Body2 弊端） */
export function themesToHandoffPatch(
  themes: ExplorationThemes,
  state: SessionState,
  msgs: string[] = [],
): Partial<Stage1Handoff> {
  const pro = themes.positionLean === "pro";
  const con = themes.positionLean === "con";

  // SPL token 仅用于判齐计数，不能作为真实 body 文本
  const realBenefits = themes.benefits.filter((b) => !isSemanticToken(b));
  const realDrawbacks = themes.drawbacks.filter((d) => !isSemanticToken(d));

  const benefitText = realBenefits.join("；");
  const drawbackText = realDrawbacks.join("；");

  const body1Kind: SideKind =
    pro || themes.positionLean === "balanced" ? "benefit" : "drawback";
  const body2Kind: SideKind =
    pro || themes.positionLean === "balanced" ? "drawback" : "benefit";

  const latestBody1 = pickLatestSpecificPoint(msgs, body1Kind);
  const latestBody2 = pickLatestSpecificPoint(msgs, body2Kind);

  let fallbackBody1 =
    body1Kind === "benefit"
      ? benefitText || realBenefits[realBenefits.length - 1] || ""
      : drawbackText || realDrawbacks[realDrawbacks.length - 1] || "";
  let fallbackBody2 =
    body2Kind === "benefit"
      ? benefitText || realBenefits[realBenefits.length - 1] || ""
      : drawbackText || realDrawbacks[realDrawbacks.length - 1] || "";

  if (body2Kind === "drawback" && realDrawbacks.length === 0) {
    fallbackBody2 = "";
  }
  if (body1Kind === "benefit" && realBenefits.length === 0) {
    fallbackBody1 = "";
  }

  let body1Point = trimSnippet(
    isolatePointForSide(latestBody1 || fallbackBody1, body1Kind),
    72,
  );
  let body2Point = trimSnippet(
    isolatePointForSide(latestBody2 || fallbackBody2, body2Kind),
    72,
  );

  if (body1Point && body2Point && bodyPointsTooSimilar(body1Point, body2Point)) {
    if (body2Kind === "drawback" && realDrawbacks.length > 0) {
      body2Point = trimSnippet(
        isolatePointForSide(
          realDrawbacks[realDrawbacks.length - 1] ?? "",
          "drawback",
        ),
        72,
      );
    } else {
      body2Point = "";
    }
  }
  if (body1Point && body2Point && bodyPointsTooSimilar(body1Point, body2Point)) {
    body2Point = "";
  }

  let body1Angle = "";
  let body2Angle = "";
  if (pro) {
    body1Angle =
      themes.benefits.length >= 2
        ? `主要好处（${themes.benefits.length}点：经济等）`
        : "主要好处";
    body2Angle = "主要弊端（生活/环境等）";
  } else if (con) {
    body1Angle = "主要弊端";
    body2Angle =
      themes.benefits.length >= 2 ? `主要好处（${themes.benefits.length}点）` : "主要好处";
  } else {
    body1Angle = explorationSideLabel(state, "sideA");
    body2Angle = explorationSideLabel(state, "sideB");
  }

  const position =
    state.handoff?.position?.trim() ||
    (themes.positionLean === "pro"
      ? "总体利大于弊"
      : themes.positionLean === "con"
        ? "总体弊大于利"
        : "利弊兼有、需权衡");

  return {
    body1Point,
    body2Point,
    body1Angle,
    body2Angle,
    position,
  };
}

export function bodyPointsTooSimilar(a: string, b: string): boolean {
  const x = a.trim().replace(/\s/g, "");
  const y = b.trim().replace(/\s/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 10 && y.length > 10 && (x.includes(y) || y.includes(x))) {
    return true;
  }
  return false;
}

export { looksLikeBenefitLine, looksLikeDrawbackLine } from "@/runtime/semantic/theme-normalization";

function pickLatestSpecificPoint(msgs: string[], kind: SideKind): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const line = msgs[i]?.trim() ?? "";
    if (!line) continue;

    const isBenefit = looksLikeBenefitLine(line);
    const isDrawback = looksLikeDrawbackLine(line);

    if (kind === "benefit" && isBenefit) {
      const isolated = isolatePointForSide(line, "benefit");
      if (isolated && isPointSpecificEnough(isolated)) return isolated;
      if (isolated.length >= 8) return isolated;
    }
    if (kind === "drawback" && isDrawback) {
      const isolated = isolatePointForSide(line, "drawback");
      if (isolated && isPointSpecificEnough(isolated)) return isolated;
      if (isolated.length >= 8) return isolated;
    }
  }
  return "";
}

/** 规则层统一选出本轮 coachQuestion（避免 LLM 空问时露出开场兜底） */
export function selectStage1CoachAsk(
  state: SessionState,
  themes: ExplorationThemes,
  contentReady: boolean,
  coachPrompt: string,
  options: {
    llmAsk?: string;
    gapQ?: string;
    preferGapFirst?: boolean;
  } = {},
): string {
  const llm = sanitizeExplorationCoachAsk(options.llmAsk?.trim() ?? "", themes);
  const gap = sanitizeExplorationCoachAsk(options.gapQ?.trim() ?? "", themes);

  if (themes.themesComplete && !themes.readyToFinalize) {
    return llm || gap || "";
  }

  if (themes.themesComplete && themes.readyToFinalize) {
    return llm || "";
  }

  let substance = coachPrompt.trim();
  if (
    isOpeningExplorationPrompt(substance) &&
    (themes.themesComplete ||
      (themes.positionLean !== "unknown" &&
        (themes.benefits.length > 0 || themes.drawbacks.length > 0)))
  ) {
    substance = "";
  }

  const ordered = options.preferGapFirst
    ? [gap, llm, substance]
    : [llm, gap, substance];

  for (const c of ordered) {
    const q = c?.trim();
    if (!q) continue;
    if (isExplorationQuestionRedundant(q, themes)) continue;
    const clean = sanitizeExplorationCoachAsk(q, themes);
    if (clean) return clean;
  }

  if (substance && !isOpeningExplorationPrompt(substance)) {
    return substance;
  }

  const bb = brainstormFallback(state);
  return sanitizeExplorationCoachAsk(bb, themes) || bb;
}

/** mirror 已总结时，禁止再拼开场式 ask */
export function reconcileMirrorAndAsk(
  mirror: string,
  ask: string,
  state: SessionState,
  themes: ExplorationThemes,
): string {
  let a = ask.trim();
  if (!a) return "";
  const mirrorWrapUp =
    /梳理清楚|都记下了|利弊和立场|已经清楚|都齐了|总结|整理清楚/i.test(mirror);
  if (
    (mirrorWrapUp || themes.themesComplete) &&
    isOpeningExplorationPrompt(a)
  ) {
    a = "";
  }
  return sanitizeExplorationCoachAsk(a, themes);
}

export { isProsConsQuestionType } from "./stage1-question-hint";
