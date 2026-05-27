/**
 * Stage1 探索：从聊天提取利弊/立场主题，供判齐、防重复问、按立场分配 Body。
 */
import {
  brainstormFallback,
  explorationSideLabel,
} from "./stage1-exploration";
import { resolveQuestionHintType } from "./stage1-question-hint";
import type { QuestionType, SessionState, Stage1Handoff } from "./types";

export type PositionLean = "pro" | "con" | "balanced" | "unknown";

export interface ExplorationThemes {
  benefits: string[];
  drawbacks: string[];
  positionLean: PositionLean;
  /** 利弊 + 立场已齐（尚可能需细化分论点） */
  themesComplete: boolean;
  /** 分论点够具体，可整理六栏 */
  readyToFinalize: boolean;
}

type SideKind = "benefit" | "drawback";

function trimSnippet(s: string, max = 48): string {
  const t = s.trim().replace(/^[,，、\s]+|[,，、\s]+$/g, "");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function pushUnique(arr: string[], piece: string): void {
  const t = trimSnippet(piece);
  if (t.length < 4) return;
  if (arr.some((x) => x === t || x.includes(t) || t.includes(x))) return;
  arr.push(t);
}

function extractLabeledParts(message: string): {
  benefits: string[];
  drawbacks: string[];
} {
  const benefits: string[] = [];
  const drawbacks: string[] = [];
  const m = message.trim();

  const benefitAfter = m.match(/(?:好处|优势|利)[：:]\s*([^；;\n]+)/);
  if (benefitAfter?.[1]) {
    const cleaned = benefitAfter[1].split(/[，,]\s*(?:坏处|劣势|弊)/)[0].trim();
    pushUnique(benefits, cleaned);
  }

  const drawbackAfter = m.match(/(?:坏处|劣势|弊|弊端)[：:]\s*([^；;\n]+)/);
  if (drawbackAfter?.[1]) {
    const cleaned = drawbackAfter[1].split(/[，,]\s*(?:好处|优势)/)[0].trim();
    pushUnique(drawbacks, cleaned);
  }

  const beforeDrawback = m.split(/(?:坏处|劣势|弊|弊端)[：:]/)[0];
  if (/好处|优势/.test(beforeDrawback) && !benefitAfter) {
    const chunk = beforeDrawback.replace(/.*(?:好处|优势)[：:]?\s*/, "");
    if (chunk.length > 4) pushUnique(benefits, chunk);
  }

  if (/拥堵|堵车|拥挤/.test(m) && !/好处|优势/.test(m.slice(0, 8))) {
    pushUnique(drawbacks, m.match(/拥堵[^，,。；;]*/)?.[0] ?? "交通拥堵、出行不便");
  }
  if (/垃圾|污染|环境破坏|环境/.test(m)) {
    pushUnique(
      drawbacks,
      m.match(/[^，,。；;]*(?:垃圾|污染|环境)[^，,。；;]*/)?.[0] ??
        "旅游带来的环境压力",
    );
  }
  if (/收入|服务业|带动|就业|经济/.test(m) && !/坏处|劣势|弊/.test(m.slice(0, 6))) {
    pushUnique(
      benefits,
      m.match(/[^，,。；;]*(?:收入|服务业|带动)[^，,。；;]*/)?.[0] ??
        m.slice(0, 40),
    );
  }

  return { benefits, drawbacks };
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

export function extractExplorationThemes(
  state: SessionState,
  msgs: string[],
): ExplorationThemes {
  const benefits: string[] = [];
  const drawbacks: string[] = [];
  const blob = msgs.join("\n");

  for (const m of msgs) {
    const { benefits: b, drawbacks: d } = extractLabeledParts(m);
    for (const x of b) pushUnique(benefits, x);
    for (const x of d) pushUnique(drawbacks, x);
  }

  const positionLean =
    inferPositionLean(
      [blob, state.handoff?.position ?? "", state.s1?.position ?? ""].join("\n"),
    );

  const themesComplete =
    benefits.length >= 1 &&
    drawbacks.length >= 1 &&
    positionLean !== "unknown" &&
    (benefits.length + drawbacks.length >= 2 || blob.length >= 50);

  let readyToFinalize = false;
  if (themesComplete) {
    const patch = themesToHandoffPatch(
      { benefits, drawbacks, positionLean, themesComplete, readyToFinalize: false },
      state,
      msgs,
    );
    readyToFinalize =
      isPointSpecificEnough(patch.body1Point) &&
      isPointSpecificEnough(patch.body2Point);
  }

  return { benefits, drawbacks, positionLean, themesComplete, readyToFinalize };
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
    /游客|居民|当地|本地人|环境|景区|餐馆|交通|垃圾|收入|就业|服务业|道路|生活/.test(
      t,
    );
  const relational =
    /导致|造成|带来|增加|减少|让|使得|因为|通过|带动|破坏|影响|提升|挤出|造成/.test(
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

export function getPointRefinementAsk(
  state: SessionState,
  themes: ExplorationThemes,
): string | null {
  if (!themes.themesComplete) return null;
  const patch = themesToHandoffPatch(
    themes,
    state,
    state.chatHistory
      .filter((m) => m.role === "user")
      .map((m) => m.content.trim())
      .filter(Boolean),
  );
  const pro = themes.positionLean === "pro";
  const body1Candidate = patch.body1Point || "";
  const body2Candidate = patch.body2Point || "";

  if (!isPointSpecificEnough(body1Candidate)) {
    return suggestPointRefinementQuestion(state, themes, "body1", pro);
  }
  if (!isPointSpecificEnough(body2Candidate)) {
    return suggestPointRefinementQuestion(state, themes, "body2", pro);
  }
  return null;
}

export function suggestPointRefinementQuestion(
  state: SessionState,
  themes: ExplorationThemes,
  body: "body1" | "body2",
  pro: boolean,
): string {
  const isBenefitBody = (body === "body1" && pro) || (body === "body2" && !pro);
  const hint = themes.benefits[0] || themes.drawbacks[0] || "";
  if (isBenefitBody) {
    if (/经济|收入|就业|服务/.test(hint)) {
      return (
        "Body1 的好处还想再写实一点：例如游客消费怎样带动本地人收入或就业？" +
        "请用一句话写出这一段要论证的核心（谁 + 怎么受益）。"
      );
    }
    if (/文化|交流/.test(hint)) {
      return (
        "Body1 可以写文化方面：具体是哪些交流、对当地人或游客有什么影响？" +
        "用一句话写出这一段的总括论点。"
      );
    }
    return (
      "Body1 的好处还偏笼统。请用一句话写清：谁（游客/政府/居民）+ 发生什么 + 带来什么好处。"
    );
  }
  if (/拥堵|交通|拥挤/.test(hint) || /垃圾|环境|污染/.test(hint)) {
    return (
      "Body2 的坏处可以再具体：拥堵或垃圾怎样影响居民日常生活？" +
      "用一句话写出这一段的核心论点（对象 + 负面影响）。"
    );
  }
  return (
    "Body2 的坏处请再具体一点：对谁、造成什么不便或破坏？用一句话写出能展开论证的总括。"
  );
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
): string {
  const lines: string[] = [];
  if (themes.positionLean !== "unknown") {
    const label =
      themes.positionLean === "pro"
        ? "利大于弊 / 好处更多"
        : themes.positionLean === "con"
          ? "弊大于利 / 坏处更多"
          : "利弊相当";
    lines.push(`立场倾向：${label}`);
  }
  if (themes.benefits.length) {
    lines.push(`已收集的好处（勿再问）：${themes.benefits.join("；")}`);
  }
  if (themes.drawbacks.length) {
    lines.push(`已收集的坏处（勿再问）：${themes.drawbacks.join("；")}`);
  }
  if (themes.themesComplete && !themes.readyToFinalize) {
    lines.push(
      "系统判断：利弊与立场已齐，但分论点仍偏笼统——引导学生把 Body1/Body2 各收成一句可论证的总括（谁+机制+结果），勿整理六栏，勿再问审题开场白。",
    );
  }
  if (themes.readyToFinalize) {
    lines.push(
      "系统判断：可整理六栏；禁止重复追问好处/坏处/「这题讨论什么」。",
    );
  }
  const hint = resolveQuestionHintType(state);
  if (hint === "adv_disadv" || hint === "pos_neg") {
    lines.push(
      "教练内部可先想：经济（收入/就业）、居民生活（拥堵/拥挤）、自然环境（垃圾/污染）等角度；只向学生追问尚未覆盖的角度。",
    );
  }
  return lines.join("\n");
}

/** 教练追问是否在要学生重复已说过的利弊 */
export function isExplorationQuestionRedundant(
  question: string,
  themes: ExplorationThemes,
): boolean {
  const q = question.trim();
  if (!q) return false;

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
    themes.readyToFinalize &&
    /能.*说说|具体是什么|还有什么|哪一方面/i.test(q) &&
    !/Body|结构|整理|具体一点|写实/.test(q)
  ) {
    return true;
  }
  return false;
}

export function suggestStructureQuestion(
  state: SessionState,
  themes: ExplorationThemes,
): string {
  const refine = getPointRefinementAsk(state, themes);
  if (refine) return refine;

  if (themes.readyToFinalize) {
    if (themes.positionLean === "pro" && themes.benefits.length >= 2) {
      return (
        "好处你有两条（如收入和服务业），可以都放在 Body1 一段里写，也可以拆成两段；" +
        "Body2 写弊端。你更倾向哪种？确认后我整理六栏。"
      );
    }
    return (
      `利弊和立场都够了：Body1 写${themes.positionLean === "pro" ? "主要好处" : themes.positionLean === "con" ? "主要坏处" : "一方面"}，` +
      `Body2 写${themes.positionLean === "pro" ? "主要坏处" : themes.positionLean === "con" ? "主要好处" : "另一方面"}。若无异议我整理六栏？`
    );
  }
  if (themes.themesComplete) {
    return getPointRefinementAsk(state, themes) ?? "请把 Body1、Body2 各收成一句更具体的总括论点。";
  }
  if (!themes.benefits.length) {
    return "还差「好处」一侧：从当地人、经济或文化里选一个你最想写的点，用一句话说说？";
  }
  if (!themes.drawbacks.length) {
    return "还差「坏处」一侧：对居民生活或环境，你最想提的一点是什么？";
  }
  return brainstormAngleQuestion(state, themes);
}

function brainstormAngleQuestion(
  state: SessionState,
  themes: ExplorationThemes,
): string {
  const missing: string[] = [];
  if (!themes.benefits.some((b) => /收入|经济|就业|服务/.test(b))) {
    missing.push("经济/收入");
  }
  if (!themes.drawbacks.some((d) => /环境|垃圾|污染/.test(d))) {
    missing.push("自然环境");
  }
  if (!themes.drawbacks.some((d) => /拥堵|拥挤|生活/.test(d))) {
    missing.push("居民生活");
  }
  if (missing.length) {
    return `还可以从${missing.slice(0, 2).join("、")}想一点：你最想补哪一侧？`;
  }
  return "再补一个你还没写到的角度（当地人 / 环境 / 经济），用一句话即可。";
}

/** 按立场把 themes 写入六栏（利大于弊 → Body1 好处可含多点，Body2 弊端） */
export function themesToHandoffPatch(
  themes: ExplorationThemes,
  state: SessionState,
  msgs: string[] = [],
): Partial<Stage1Handoff> {
  const pro = themes.positionLean === "pro";
  const con = themes.positionLean === "con";

  const benefitText = themes.benefits.join("；");
  const drawbackText = themes.drawbacks.join("；");

  const body1Kind: SideKind =
    pro || themes.positionLean === "balanced" ? "benefit" : "drawback";
  const body2Kind: SideKind =
    pro || themes.positionLean === "balanced" ? "drawback" : "benefit";

  const latestBody1 =
    pickLatestSpecificPoint(msgs, body1Kind) ||
    pickLatestSpecificPoint(msgs, body1Kind === "benefit" ? "drawback" : "benefit");
  const latestBody2 =
    pickLatestSpecificPoint(msgs, body2Kind) ||
    pickLatestSpecificPoint(msgs, body2Kind === "benefit" ? "drawback" : "benefit");

  const fallbackBody1 =
    body1Kind === "benefit"
      ? benefitText || themes.benefits[0] || ""
      : drawbackText || themes.drawbacks[0] || "";
  const fallbackBody2 =
    body2Kind === "benefit"
      ? benefitText || themes.benefits[0] || ""
      : drawbackText || themes.drawbacks[0] || "";

  const body1Point = trimSnippet(latestBody1 || fallbackBody1, 72);
  const body2Point = trimSnippet(latestBody2 || fallbackBody2, 72);

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

function looksLikeBenefitLine(text: string): boolean {
  return /收入|就业|经济|带动|服务业|受益|增长|交流|便利|机会|发展/.test(text);
}

function looksLikeDrawbackLine(text: string): boolean {
  return /拥堵|堵车|拥挤|垃圾|污染|环境|破坏|不便|噪音|成本|压力|影响居民/.test(text);
}

function pickLatestSpecificPoint(msgs: string[], kind: SideKind): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const line = msgs[i]?.trim() ?? "";
    if (!line) continue;
    if (!isPointSpecificEnough(line)) continue;

    const isBenefit = looksLikeBenefitLine(line);
    const isDrawback = looksLikeDrawbackLine(line);

    if (kind === "benefit" && isBenefit) return line;
    if (kind === "drawback" && isDrawback) return line;
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
    return (
      getPointRefinementAsk(state, themes) ||
      suggestStructureQuestion(state, themes) ||
      llm ||
      gap ||
      ""
    );
  }

  if (themes.themesComplete && themes.readyToFinalize) {
    return llm || suggestStructureQuestion(state, themes) || "";
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

  if (themes.positionLean !== "unknown") {
    const structured = suggestStructureQuestion(state, themes);
    if (structured && !isOpeningExplorationPrompt(structured)) {
      return structured;
    }
  }

  if (substance && !isOpeningExplorationPrompt(substance)) {
    return substance;
  }

  if (!contentReady) {
    const partial = suggestStructureQuestion(state, themes);
    if (partial && !isOpeningExplorationPrompt(partial)) {
      return partial;
    }
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
    a =
      getPointRefinementAsk(state, themes) ||
      suggestStructureQuestion(state, themes) ||
      "";
  }
  return sanitizeExplorationCoachAsk(a, themes);
}

export { isProsConsQuestionType } from "./stage1-question-hint";
