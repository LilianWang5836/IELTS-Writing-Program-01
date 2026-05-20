/**
 * Stage1 单源回合决策：缺 employ / academic / 可整理 为锚。
 */
import {
  assessEssaySubstance,
  assessExplorationContent,
  buildGapProgressionMirror,
  buildHandoffFromChat,
  buildRecordedSidesPreview,
  explorationSideStatus,
  formatProposalCoachMessage,
  gapSideFromCoachQuestion,
  isDivergentCoachQuestion,
  isHandoffProposalComplete,
  isIncompleteBodyPoint,
  isProposalAffirmation,
  isRepeatedQuestion,
  needsAngleTeaching,
  resolveConfirmableHandoffProposal,
  resolveHandoffProposal,
  sanitizeHandoffProposal,
  singleGapCoachPrompt,
  userAnsweredExplorationGap,
  userMessages,
} from "./essay-substance";
import { detectHandoffHelpQuestion } from "./stage2-context";
import { ANGLE_TEACH_CHAT } from "./constants";
import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|说得很清楚|什么意思|别绕|听不懂/i;

function detectFrustration(message: string): boolean {
  return FRUSTRATION_RE.test(message);
}

export type HandoffGap = "employ" | "academic" | "ready" | "none";

export interface HandoffTurnDecision {
  gap: HandoffGap;
  sides: { employ: boolean; academic: boolean };
  shouldPropose: boolean;
  proposal: Stage1Handoff | null;
  coach: { mirror: string; ask: string };
  handoffPhase: "exploring" | "proposed" | "editing" | "locked";
  proposalSummary?: string;
  setAngleTeachDone?: boolean;
  essaySubstanceSufficient?: boolean;
}

const PROPOSAL_NUDGE =
  "整理稿已在上一轮给出。请点左侧「确认整理并填入」，或回复「是」。";

const MAX_EXPLORE_ROUNDS = 4;

function expectedGap(
  sides: { employ: boolean; academic: boolean },
  sufficient: boolean,
): HandoffGap {
  if (sufficient || (sides.employ && sides.academic)) return "ready";
  if (!sides.employ) return "employ";
  if (!sides.academic) return "academic";
  return "ready";
}

function shouldForceProposal(
  contentReady: boolean,
  sufficient: boolean,
  sides: { employ: boolean; academic: boolean },
  rounds: number,
  userMessage?: string,
): boolean {
  if (!contentReady) return false;
  if (sufficient) return true;
  if (sides.employ && sides.academic) return true;
  if (rounds >= MAX_EXPLORE_ROUNDS && sides.employ && sides.academic) return true;
  if (
    userMessage &&
    /看不懂|已经说|说得很清楚|重复/.test(userMessage) &&
    sides.employ &&
    sides.academic
  ) {
    return true;
  }
  return false;
}

export interface ResolveHandoffTurnInput {
  state: SessionState;
  result: LlmTurnResult;
  userMessage?: string;
}

function repairProposalFromChat(state: SessionState): Stage1Handoff | null {
  const built = buildHandoffFromChat(state);
  return sanitizeHandoffProposal(built, state);
}

export function resolveHandoffTurnDecision(
  input: ResolveHandoffTurnInput,
): HandoffTurnDecision {
  const { state, result, userMessage } = input;
  const phase = state.coachContext?.handoffPhase ?? "exploring";

  if (userMessage?.trim() && detectHandoffHelpQuestion(userMessage)) {
    const h = state.handoff ?? state.handoffProposal;
    const body2Bad = isIncompleteBodyPoint(h?.body2Point, "academic");
    if (state.handoffLocked || phase === "editing") {
      return {
        gap: "none",
        sides: explorationSideStatus(userMessages(state)),
        shouldPropose: false,
        proposal: state.handoffProposal ?? null,
        coach: {
          mirror: body2Bad
            ? "⑤ Body2 分论点在左侧被截断了，请直接改那一栏补全整句（学术侧：持续学习、领域积累），保存后再点「提交审题定稿」。"
            : "审题定稿已在左侧；请核对六栏，无误后点「提交审题定稿」，再进入 Body1 搭链。",
          ask: body2Bad
            ? "改好后无需在右侧重聊，左侧保存即可。"
            : "若只改某一栏，在左侧编辑后提交。",
        },
        handoffPhase: state.handoffLocked ? "locked" : "editing",
      };
    }
    if (phase === "proposed" && state.handoffProposal) {
      return {
        gap: "none",
        sides: explorationSideStatus(userMessages(state)),
        shouldPropose: false,
        proposal: state.handoffProposal,
        coach: { mirror: "", ask: PROPOSAL_NUDGE },
        handoffPhase: "proposed",
      };
    }
  }

  if (phase === "editing" || state.handoffLocked) {
    const h = state.handoff;
    if (h && userMessage?.trim()) {
      const llmMirror =
        result.mirror?.trim() && result.mirror !== userMessage.trim()
          ? result.mirror
          : "";
      const bad = isIncompleteBodyPoint(h.body2Point, "academic");
      return {
        gap: "none",
        sides: explorationSideStatus(userMessages(state)),
        shouldPropose: false,
        proposal: null,
        coach: {
          mirror:
            llmMirror ||
            (bad
              ? "左侧 Body2 分论点不完整，请补全后再提交定稿。"
              : "定稿在左侧；确认无误后点「提交审题定稿」。"),
          ask: bad
            ? "在左侧 ⑤ 栏补全学术侧分论点一句即可。"
            : "无误后点「提交审题定稿」。",
        },
        handoffPhase: "editing",
      };
    }
  }

  const existingProposal = state.handoffProposal;
  if (
    existingProposal &&
    isHandoffProposalComplete(existingProposal) &&
    phase === "proposed"
  ) {
    return {
      gap: "none",
      sides: explorationSideStatus(userMessages(state)),
      shouldPropose: false,
      proposal: existingProposal,
      coach: { mirror: "", ask: PROPOSAL_NUDGE },
      handoffPhase: "proposed",
    };
  }

  if (
    existingProposal &&
    (!isHandoffProposalComplete(existingProposal) ||
      isIncompleteBodyPoint(existingProposal.body2Point, "academic") ||
      isIncompleteBodyPoint(existingProposal.body1Point, "employ"))
  ) {
    const repaired = repairProposalFromChat(state);
    if (repaired && isHandoffProposalComplete(repaired)) {
      return {
        gap: "ready",
        sides: explorationSideStatus(userMessages(state)),
        shouldPropose: true,
        proposal: repaired,
        coach: {
          mirror: "",
          ask: formatProposalCoachMessage(
            repaired,
            "已按你的聊天补全六栏（含 Body2），请核对左侧整理稿。",
          ),
        },
        handoffPhase: "proposed",
        essaySubstanceSufficient: true,
      };
    }
  }

  if (userMessage && isProposalAffirmation(userMessage)) {
    const prop = resolveConfirmableHandoffProposal(state);
    if (prop) {
      return {
        gap: "ready",
        sides: explorationSideStatus(userMessages(state)),
        shouldPropose: true,
        proposal: prop,
        coach: {
          mirror: "好，已按整理填入左侧，请核对六栏。",
          ask: "无误后点「提交审题定稿」。",
        },
        handoffPhase: "proposed",
      };
    }
  }

  const msgs = userMessages(state);
  const sides = explorationSideStatus(msgs);
  const substance = assessEssaySubstance(state);
  const { contentReady } = assessExplorationContent(state, userMessage);
  const rounds = state.coachContext?.exploreRound ?? 0;
  const gap = expectedGap(sides, substance.sufficient);
  const gapQ = singleGapCoachPrompt(sides);
  const lastQ = state.coachContext?.lastQuestion ?? "";

  let proposal =
    resolveHandoffProposal(state, result) ??
    (shouldForceProposal(contentReady, substance.sufficient, sides, rounds, userMessage)
      ? sanitizeHandoffProposal(buildHandoffFromChat(state), state)
      : null);

  const shouldPropose =
    !!proposal &&
    isHandoffProposalComplete(proposal) &&
    shouldForceProposal(contentReady, substance.sufficient, sides, rounds, userMessage);

  const llmMirror =
    result.mirror?.trim() && result.mirror !== userMessage?.trim()
      ? result.mirror
      : "";

  if (shouldPropose && proposal) {
    const repaired =
      sanitizeHandoffProposal(proposal, state) ??
      repairProposalFromChat(state) ??
      proposal;
    const intro =
      isIncompleteBodyPoint(repaired.body2Point, "academic") ||
      isIncompleteBodyPoint(repaired.body1Point, "employ")
        ? "六栏已整理，但分论点需你核对补全（尤其 Body2）。"
        : result.proposalSummary?.trim() ||
          "两侧都够写两段了，六栏整理在左侧，请核对。";
    proposal = repaired;
    return {
      gap: "ready",
      sides,
      shouldPropose: true,
      proposal,
      coach: {
        mirror: "",
        ask: formatProposalCoachMessage(proposal, intro),
      },
      handoffPhase: "proposed",
      proposalSummary: result.proposalSummary,
      essaySubstanceSufficient: true,
    };
  }

  const askedSide = gapSideFromCoachQuestion(lastQ);
  if (
    contentReady &&
    !substance.sufficient &&
    askedSide &&
    gapQ &&
    userMessage?.trim() &&
    userAnsweredExplorationGap(userMessage, askedSide)
  ) {
    const mirror = buildGapProgressionMirror(askedSide, msgs);
    return {
      gap: askedSide === "employ" ? "academic" : "employ",
      sides,
      shouldPropose: false,
      proposal: null,
      coach: { mirror, ask: gapQ },
      handoffPhase: "exploring",
    };
  }

  const handoff = state.handoff;
  const angleTeach = needsAngleTeaching(
    handoff ?? {
      taskUnderstanding: "",
      position: "",
      body1Point: "",
      body1Angle: "",
      body2Point: "",
      body2Angle: "",
    },
    userMessage,
    contentReady,
  );
  if (angleTeach.needed && !state.coachContext?.angleTeachDone) {
    return {
      gap,
      sides,
      shouldPropose: false,
      proposal: null,
      coach: { mirror: ANGLE_TEACH_CHAT, ask: angleTeach.followUp },
      handoffPhase: "exploring",
      setAngleTeachDone: true,
    };
  }

  if (userMessage && detectFrustration(userMessage)) {
    const preview = buildRecordedSidesPreview(msgs);
    const coachQ =
      gapQ ||
      substance.coachPrompt ||
      "就业/技能一侧、学术/知识一侧各用一句话说清即可。";
    return {
      gap,
      sides,
      shouldPropose: false,
      proposal: null,
      coach: {
        mirror: preview ? `${preview}我换种更具体的问法。` : "抱歉，我换种更具体的说法。",
        ask: coachQ,
      },
      handoffPhase: "exploring",
    };
  }

  const nextQ = result.coachQuestion?.trim() || substance.coachPrompt || "";
  if (
    nextQ &&
    /body\s*2|论点.*不完整|补充完整|描述不完整/i.test(nextQ) &&
    sides.employ &&
    sides.academic
  ) {
    const repaired = repairProposalFromChat(state);
    if (repaired && isHandoffProposalComplete(repaired)) {
      return {
        gap: "ready",
        sides,
        shouldPropose: true,
        proposal: repaired,
        coach: {
          mirror: "",
          ask: formatProposalCoachMessage(
            repaired,
            "已按你的聊天补全六栏（含 Body2 分论点），请核对左侧整理稿。",
          ),
        },
        handoffPhase: "proposed",
        essaySubstanceSufficient: true,
      };
    }
  }

  if (
    isDivergentCoachQuestion(nextQ) &&
    sides.employ &&
    sides.academic &&
    proposal &&
    isHandoffProposalComplete(proposal)
  ) {
    return {
      gap: "ready",
      sides,
      shouldPropose: true,
      proposal,
      coach: {
        mirror: "",
        ask: formatProposalCoachMessage(proposal, "两侧都够写两段了，六栏整理在左侧，请核对。"),
      },
      handoffPhase: "proposed",
    };
  }

  if (nextQ && isRepeatedQuestion(lastQ, nextQ)) {
    return {
      gap,
      sides,
      shouldPropose: false,
      proposal: null,
      coach: {
        mirror: llmMirror || buildRecordedSidesPreview(msgs) || "我们继续填空式问题。",
        ask: gapQ || nextQ,
      },
      handoffPhase: "exploring",
    };
  }

  const preview = buildRecordedSidesPreview(msgs);
  const mirror =
    llmMirror ||
    preview ||
    (gap === "employ"
      ? "题型和立场有了，先补就业/技能一侧。"
      : gap === "academic"
        ? "先补学术/知识一侧。"
        : "我们继续把两侧写实。");

  const ask =
    gapQ ||
    (gap === "employ"
      ? "就业/技能一侧：用一句话说清这段想写什么（实习、项目、职场能力）。"
      : gap === "academic"
        ? "学术/知识一侧：用一句话说清（长期学习、研究兴趣）。"
        : "");

  return {
    gap,
    sides,
    shouldPropose: false,
    proposal: null,
    coach: { mirror, ask },
    handoffPhase: "exploring",
  };
}
