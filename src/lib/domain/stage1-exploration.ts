/**
 * Stage1 探索层：侧别命名、brainstorm 兜底、缺口话术（题目无关）。
 * sideA ↔ Body1，sideB ↔ Body2；展示名优先 handoff.body*Angle，否则 Body1/Body2。
 */
import { resolveQuestionHintType } from "./stage1-question-hint";
import { isProsConsQuestionType } from "./stage1-question-hint";
import { extractExplorationThemes } from "./stage1-exploration-themes";
import type {
  ExplorationSide,
  ExplorationSides,
  QuestionType,
  SessionState,
} from "./types";

const HINT_TYPE_LABEL: Record<QuestionType, string> = {
  discuss: "讨论双方观点 + 自己立场",
  agree: "对单一观点表态（多大程度同意）",
  adv_disadv: "权衡利弊（哪个更多 / 同时给出双方）",
  two_part: "回答两个子问题（原因 + 对策 / 现象 + 影响）",
  pos_neg: "判断正面还是负面影响",
  unknown: "审题",
};

const HINT_TYPE_BRAINSTORM_PROMPTS: Record<QuestionType, string> = {
  discuss:
    "可以先列一下：题目里争论的两方各看重什么？你倾向更认同哪一方、为什么？",
  agree:
    "你觉得同意/不同意哪一边？支撑这个立场最有力的两个理由是什么？",
  adv_disadv:
    "可以先列：这件事的优势主要有哪些（2~3 点）？劣势主要有哪些（2~3 点）？再看哪一边更突出。",
  two_part:
    "题目里两个子问题，你打算各用哪一两点回答？先各列一个核心方向。",
  pos_neg:
    "你判断为正面还是负面？支撑判断最关键的两点理由是什么？",
  unknown:
    "先用一两句话讲讲：这道题在问什么？你打算从哪几个方向展开？",
};

export function explorationSideLabel(
  state: SessionState,
  side: ExplorationSide,
): string {
  const h = state.handoff ?? state.handoffProposal;
  const angle =
    side === "sideA" ? h?.body1Angle?.trim() : h?.body2Angle?.trim();
  if (angle) return angle;
  return side === "sideA" ? "Body1 方向" : "Body2 方向";
}

export function brainstormFallback(state: SessionState): string {
  const t = resolveQuestionHintType(state);
  return HINT_TYPE_BRAINSTORM_PROMPTS[t] ?? HINT_TYPE_BRAINSTORM_PROMPTS.unknown;
}

export function brainstormSummaryFallback(state: SessionState): string {
  const t = resolveQuestionHintType(state);
  const label = HINT_TYPE_LABEL[t] ?? HINT_TYPE_LABEL.unknown;
  return `这是一道「${label}」题。`;
}

/** 审题初期：尚未展开 Body 两侧 → 优先 brainstorm，不按固定模板追问 */
export function shouldBrainstormFirst(
  state: SessionState,
  contentReady: boolean,
  sides: ExplorationSides,
  substanceSufficient: boolean,
  rounds: number,
  msgs?: string[],
): boolean {
  if (!contentReady) return true;
  if (substanceSufficient) return false;

  const userMsgs =
    msgs ??
    state.chatHistory
      .filter((m) => m.role === "user")
      .map((m) => m.content.trim())
      .filter(Boolean);

  if (isProsConsQuestionType(resolveQuestionHintType(state))) {
    const themes = extractExplorationThemes(state, userMsgs);
    if (themes.themesComplete) return false;
    if (rounds <= 5) return true;
    return false;
  }

  if (rounds <= 2 && !sides.sideA && !sides.sideB) return true;
  if (rounds <= 4 && (!sides.sideA || !sides.sideB)) return true;
  return false;
}

export function singleGapCoachPrompt(
  sides: ExplorationSides,
  state: SessionState,
): string {
  if (!sides.sideA) {
    const label = explorationSideLabel(state, "sideA");
    return `${label}：用一句话说清这段想论证什么（写什么 + 为什么）。`;
  }
  if (!sides.sideB) {
    const label = explorationSideLabel(state, "sideB");
    return `${label}：用一句话说清这段想论证什么（写什么 + 为什么）。`;
  }
  return "";
}

export function gapSideFromCoachQuestion(
  question: string,
  state: SessionState,
): ExplorationSide | null {
  const q = question.trim();
  if (!q) return null;

  const labelA = explorationSideLabel(state, "sideA");
  const labelB = explorationSideLabel(state, "sideB");
  if (labelA.length > 2 && q.includes(labelA) && !q.includes(labelB)) {
    return "sideA";
  }
  if (labelB.length > 2 && q.includes(labelB) && !q.includes(labelA)) {
    return "sideB";
  }

  const sideA =
    /Body\s*1|body1|sideA|第一侧|一方面|第一个方向/.test(q) ||
    /就业\/技能|就业技能|就业.*一侧|实习、项目|职场能力/.test(q);
  const sideB =
    /Body\s*2|body2|sideB|第二侧|另一方面|第二个方向/.test(q) ||
    /学术\/知识|学术知识|学术.*一侧|长期学习|研究兴趣/.test(q);
  if (sideA && !sideB) return "sideA";
  if (sideB && !sideA) return "sideB";
  return null;
}

export function isOppositeGapCoachQuestion(
  prev: string,
  next: string,
  state: SessionState,
): boolean {
  const p = gapSideFromCoachQuestion(prev, state);
  const n = gapSideFromCoachQuestion(next, state);
  return !!p && !!n && p !== n;
}

export function buildGapProgressionMirror(
  completedSide: ExplorationSide,
  state: SessionState,
  sideHint?: string,
): string {
  const label = explorationSideLabel(state, completedSide);
  const other: ExplorationSide = completedSide === "sideA" ? "sideB" : "sideA";
  const otherLabel = explorationSideLabel(state, other);
  if (sideHint && sideHint.length >= 8) {
    const hint = sideHint.slice(0, 40).trim();
    return `${label}记下了：${hint}${sideHint.length > 40 ? "…" : ""}。接下来补 ${otherLabel}。`;
  }
  return `${label}这一侧够了，接下来补 ${otherLabel}。`;
}

export function buildRecordedSidesPreview(
  state: SessionState,
  sideAText: string,
  sideBText: string,
): string {
  const parts: string[] = [];
  if (sideAText.length >= 10) {
    const label = explorationSideLabel(state, "sideA");
    const hint = sideAText.slice(0, 36).trim();
    parts.push(`${label}：${hint}${sideAText.length > 36 ? "…" : ""}`);
  }
  if (sideBText.length >= 10) {
    const label = explorationSideLabel(state, "sideB");
    const hint = sideBText.slice(0, 36).trim();
    parts.push(`${label}：${hint}${sideBText.length > 36 ? "…" : ""}`);
  }
  if (!parts.length) return "";
  return `我已记下 ${parts.join("；")}。`;
}

export function gapMirrorForMissingSide(
  gap: ExplorationSide,
  state: SessionState,
): string {
  const label = explorationSideLabel(state, gap);
  return `题型和立场有了，先补 ${label}。`;
}

export function bothSidesReadyMessage(state: SessionState): string {
  return "两个 Body 方向都够写两段了，六栏整理在左侧，请核对。";
}
