/**
 * Stage1 探索：从聊天提取利弊/立场主题，供判齐、防重复问、按立场分配 Body。
 */
import { explorationSideLabel } from "./stage1-exploration";
import type { QuestionType, SessionState, Stage1Handoff } from "./types";

export type PositionLean = "pro" | "con" | "balanced" | "unknown";

export interface ExplorationThemes {
  benefits: string[];
  drawbacks: string[];
  positionLean: PositionLean;
  /** 给 LLM / 规则：是否已够整理六栏 */
  readyToFinalize: boolean;
}

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

  const readyToFinalize =
    benefits.length >= 1 &&
    drawbacks.length >= 1 &&
    positionLean !== "unknown" &&
    (benefits.length + drawbacks.length >= 2 || blob.length >= 50);

  return { benefits, drawbacks, positionLean, readyToFinalize };
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
  if (themes.readyToFinalize) {
    lines.push(
      "系统判断：利弊与立场已够，应引导确认 Body 结构或整理六栏，禁止重复追问已给出的好处/坏处。",
    );
  }
  const hint = state.questionHintType ?? "unknown";
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
  if (
    themes.readyToFinalize &&
    /能.*说说|具体是什么|还有什么|哪一方面/i.test(q) &&
    !/Body|结构|整理/.test(q)
  ) {
    return true;
  }
  return false;
}

export function suggestStructureQuestion(
  state: SessionState,
  themes: ExplorationThemes,
): string {
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
): Partial<Stage1Handoff> {
  const pro = themes.positionLean === "pro";
  const con = themes.positionLean === "con";

  const benefitText = themes.benefits.join("；");
  const drawbackText = themes.drawbacks.join("；");

  const body1Point = trimSnippet(
    pro ? benefitText || themes.benefits[0] || "" : drawbackText || themes.drawbacks[0] || "",
    72,
  );
  const body2Point = trimSnippet(
    pro ? drawbackText || themes.drawbacks[0] || "" : benefitText || themes.benefits[0] || "",
    72,
  );

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

export function isProsConsQuestionType(t: QuestionType | undefined): boolean {
  return t === "adv_disadv" || t === "pos_neg";
}
