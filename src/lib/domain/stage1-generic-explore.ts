/**
 * Stage 1 通用题目无关探索决策。
 *
 * 设计原则：
 *   - 题目内容、追问方向、立场两侧的命名权全部交给 LLM 输出（mirror、coachQuestion、
 *     proposedHandoff、essaySubstanceSufficient）。
 *   - 系统层只做格式化、节流、去重和题型 fallback：不注入任何与具体题目无关的
 *     关键词（如「就业/技能」「学术/知识」）。
 *   - 当 LLM 输出空时，按 questionHintType 给一个"打开 brainstorm 角度"的兜底
 *     问题，鼓励学生先列方向再选论点。
 */
import type {
  LlmTurnResult,
  QuestionType,
  SessionState,
  Stage1Handoff,
} from "./types";
import { isHandoffProposalComplete } from "./essay-substance";

export type GenericExploreGap = "exploring" | "ready" | "none";

export interface GenericExploreDecision {
  gap: GenericExploreGap;
  shouldPropose: boolean;
  proposal: Stage1Handoff | null;
  coach: { mirror: string; ask: string };
  handoffPhase: "exploring" | "proposed" | "editing" | "locked";
  proposalSummary?: string;
  essaySubstanceSufficient?: boolean;
}

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

function brainstormFallback(state: SessionState): string {
  const t = state.questionHintType ?? "unknown";
  return HINT_TYPE_BRAINSTORM_PROMPTS[t] ?? HINT_TYPE_BRAINSTORM_PROMPTS.unknown;
}

function brainstormSummaryFallback(state: SessionState): string {
  const t = state.questionHintType ?? "unknown";
  const label = HINT_TYPE_LABEL[t] ?? HINT_TYPE_LABEL.unknown;
  return `这是一道「${label}」题。`;
}

function userMessages(state: SessionState): string[] {
  return state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);
}

function isProposalAffirmation(message: string | undefined): boolean {
  const m = (message ?? "").trim();
  if (!m) return false;
  return /^(?:好的?|可以|没问题|确认|嗯|ok|sure|yes)$/i.test(m);
}

function trim(s?: string): string {
  return (s ?? "").trim();
}

const PROPOSAL_NUDGE =
  "整理稿已在上一轮给出。请点左侧「确认整理并填入」，或回复「是」。";

/** 仅当 LLM 明确给出 proposedHandoff 六栏完整 + essaySubstanceSufficient 才视为 ready */
function llmProposedReady(result: LlmTurnResult): Stage1Handoff | null {
  const proposed = (result as { proposedHandoff?: Stage1Handoff })
    .proposedHandoff;
  if (!proposed) return null;
  if (!isHandoffProposalComplete(proposed)) return null;
  if (result.essaySubstanceSufficient !== true) return null;
  return proposed;
}

export function resolveGenericExploreDecision(input: {
  state: SessionState;
  result: LlmTurnResult;
  userMessage?: string;
}): GenericExploreDecision {
  const { state, result, userMessage } = input;
  const phase = state.coachContext?.handoffPhase ?? "exploring";

  if (phase === "editing" || state.handoffLocked) {
    return {
      gap: "none",
      shouldPropose: false,
      proposal: null,
      coach: {
        mirror: trim(result.mirror) || "定稿在左侧；确认无误后点「提交审题定稿」。",
        ask: trim(result.coachQuestion) || "无误后点「提交审题定稿」。",
      },
      handoffPhase: state.handoffLocked ? "locked" : "editing",
    };
  }

  const existingProposal = state.handoffProposal;
  if (
    phase === "proposed" &&
    existingProposal &&
    isHandoffProposalComplete(existingProposal)
  ) {
    if (isProposalAffirmation(userMessage)) {
      return {
        gap: "ready",
        shouldPropose: true,
        proposal: existingProposal,
        coach: {
          mirror: "好，已按整理填入左侧，请核对六栏。",
          ask: "无误后点「提交审题定稿」。",
        },
        handoffPhase: "proposed",
      };
    }
    return {
      gap: "none",
      shouldPropose: false,
      proposal: existingProposal,
      coach: { mirror: "", ask: PROPOSAL_NUDGE },
      handoffPhase: "proposed",
    };
  }

  const llmReadyProposal = llmProposedReady(result);
  if (llmReadyProposal) {
    return {
      gap: "ready",
      shouldPropose: true,
      proposal: llmReadyProposal,
      coach: {
        mirror: "",
        ask:
          trim(result.proposalSummary) ||
          "我整理了一版六栏到左侧，请核对。无误后点「确认整理并填入」。",
      },
      handoffPhase: "proposed",
      proposalSummary: trim(result.proposalSummary) || undefined,
      essaySubstanceSufficient: true,
    };
  }

  const llmMirror =
    trim(result.mirror) && result.mirror !== userMessage?.trim()
      ? trim(result.mirror)
      : "";
  const llmAsk = trim(result.coachQuestion);

  const msgsCount = userMessages(state).length;
  const fallbackMirror =
    msgsCount === 0
      ? brainstormSummaryFallback(state)
      : "我先记下你这边的想法。";
  const fallbackAsk = brainstormFallback(state);

  return {
    gap: "exploring",
    shouldPropose: false,
    proposal: null,
    coach: {
      mirror: llmMirror || fallbackMirror,
      ask: llmAsk || fallbackAsk,
    },
    handoffPhase: "exploring",
  };
}
