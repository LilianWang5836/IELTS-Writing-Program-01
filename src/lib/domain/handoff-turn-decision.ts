/**
 * Stage1 单源回合决策：缺 sideA(Body1) / sideB(Body2) / 可整理 为锚。
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
  isHandoffProposalCompleteConversational,
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
import { detectFrustration } from "@/runtime/shared/frustration";
import {
  buildConversationalReadiness,
} from "@/runtime/stage1/conversational-ready";
import {
  brainstormSummaryFallback,
  explorationSideLabel,
  gapMirrorForMissingSide,
  shouldBrainstormFirst,
} from "./stage1-exploration";
import {
  extractExplorationThemes,
  isExplorationQuestionRedundant,
  reconcileMirrorAndAsk,
  sanitizeExplorationCoachAsk,
  selectStage1CoachAsk,
  userMessageRefinesBody,
} from "./stage1-exploration-themes";
import type { ExplorationThemes } from "./stage1-exploration-themes";
import { detectHandoffHelpQuestion } from "./stage2-context";
import { decideStage1Plan, stage1PlanQuestion } from "./stage1-plan";
import { ANGLE_TEACH_CHAT } from "./constants";
import {
  isRuntimePlanEnforcementEnabled,
  planCoachAsk,
  planCoachMirror,
  resolveCoachTurnPlanForSession,
} from "./runtime-plan-overlay";
import type {
  ExplorationSide,
  ExplorationSides,
  HandoffGap,
  LlmTurnResult,
  SessionState,
  Stage1Handoff,
} from "./types";

export type { HandoffGap, ExplorationSides };

export interface HandoffTurnDecision {
  gap: HandoffGap;
  sides: ExplorationSides;
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
  sides: ExplorationSides,
  sufficient: boolean,
): HandoffGap {
  if (sufficient || (sides.sideA && sides.sideB)) return "ready";
  if (!sides.sideA) return "sideA";
  if (!sides.sideB) return "sideB";
  return "ready";
}

function shouldForceProposal(
  contentReady: boolean,
  sufficient: boolean,
  sides: ExplorationSides,
  rounds: number,
  userMessage?: string,
): boolean {
  if (!contentReady) return false;
  if (sufficient) return true;
  if (sides.sideA && sides.sideB) return true;
  if (rounds >= MAX_EXPLORE_ROUNDS && sides.sideA && sides.sideB) return true;
  if (
    userMessage &&
    /看不懂|已经说|说得很清楚|重复/.test(userMessage) &&
    sides.sideA &&
    sides.sideB
  ) {
    return true;
  }
  return false;
}

type RefinementTarget = "body1" | "body2";

function refinementTargetFromAsk(ask: string): RefinementTarget | null {
  if (/Body\s*1|好处还想再写实|Body1/.test(ask)) return "body1";
  if (/Body\s*2|坏处可以再具体|Body2/.test(ask)) return "body2";
  return null;
}

export interface ResolveHandoffTurnInput {
  state: SessionState;
  result: LlmTurnResult;
  userMessage?: string;
}

function repairProposalFromChat(
  state: SessionState,
  opts?: { conversational?: boolean },
): Stage1Handoff | null {
  const built = buildHandoffFromChat(state);
  const sanitized = sanitizeHandoffProposal(built, state);
  if (sanitized) return sanitized;
  if (opts?.conversational) {
    return isHandoffProposalCompleteConversational(built) ? built : null;
  }
  return null;
}

function trySemanticHandoffOverride(input: {
  state: SessionState;
  msgs: string[];
  themes: ExplorationThemes;
  sides: ExplorationSides;
  userMessage?: string;
}): HandoffTurnDecision | null {
  const { state, msgs, themes, sides, userMessage } = input;
  const semantic = themes.semantic;

  const semanticOk =
    semantic?.userHasExpressedCompleteIdea &&
    themes.benefits.length >= 1 &&
    themes.drawbacks.length >= 1;
  if (!semanticOk) return null;

  const userMsgsArr = msgs;
  const latestUserMsg = userMsgsArr.at(-1);
  const prevUserMsg = userMsgsArr.at(-2);
  const readiness = buildConversationalReadiness({
    semanticComplete: true,
    latestUserMessage: userMessage ?? latestUserMsg,
    prevUserMessage: prevUserMsg,
  });

  const canProceed =
    themes.readyToFinalize ||
    readiness.conversationalReady ||
    (semantic?.positionLean !== "unknown" && themes.themesComplete);

  if (!canProceed) return null;

  const auto = repairProposalFromChat(state, { conversational: readiness.conversationalReady });
  if (!auto) return null;

  const mirror = readiness.userConfirmed
    ? "好，我来帮你整理六栏结构。"
    : readiness.frustrationDetected
      ? "抱歉重复了，你已经把核心想法说清楚了，我们直接整理六栏。"
      : "你其实已经说出完整想法了，我们可以直接帮你整理六栏结构。";

  return {
    gap: "ready",
    sides,
    shouldPropose: true,
    proposal: auto,
    coach: {
      mirror,
      ask: formatProposalCoachMessage(
        auto,
        "请核对左侧六栏；若无异议点「确认整理并填入」。",
      ),
    },
    handoffPhase: "proposed",
    essaySubstanceSufficient: true,
  };
}

function otherSide(side: ExplorationSide): ExplorationSide {
  return side === "sideA" ? "sideB" : "sideA";
}

export function resolveHandoffTurnDecision(
  input: ResolveHandoffTurnInput,
): HandoffTurnDecision {
  const { state, result, userMessage } = input;
  const phase = state.coachContext?.handoffPhase ?? "exploring";

  if (userMessage?.trim() && detectHandoffHelpQuestion(userMessage)) {
    const h = state.handoff ?? state.handoffProposal;
    const body2Bad = isIncompleteBodyPoint(h?.body2Point, "sideB");
    if (state.handoffLocked || phase === "editing") {
      return {
        gap: "none",
        sides: explorationSideStatus(state),
        shouldPropose: false,
        proposal: state.handoffProposal ?? null,
        coach: {
          mirror: body2Bad
            ? `⑤ Body2 分论点在左侧被截断了，请直接改那一栏补全整句（${explorationSideLabel(state, "sideB")}），保存后再点「提交审题定稿」。`
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
        sides: explorationSideStatus(state),
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
      const bad = isIncompleteBodyPoint(h.body2Point, "sideB");
      return {
        gap: "none",
        sides: explorationSideStatus(state),
        shouldPropose: false,
        proposal: null,
        coach: {
          mirror:
            llmMirror ||
            (bad
              ? "左侧 Body2 分论点不完整，请补全后再提交定稿。"
              : "定稿在左侧；确认无误后点「提交审题定稿」。"),
          ask: bad
            ? `在左侧 ⑤ 栏补全 ${explorationSideLabel(state, "sideB")} 分论点一句即可。`
            : "无误后点「提交审题定稿」。",
        },
        handoffPhase: "editing",
      };
    }
  }

  const existingProposal = state.handoffProposal;
  if (
    existingProposal &&
    isHandoffProposalComplete(existingProposal, state) &&
    phase === "proposed"
  ) {
    return {
      gap: "none",
      sides: explorationSideStatus(state),
      shouldPropose: false,
      proposal: existingProposal,
      coach: { mirror: "", ask: PROPOSAL_NUDGE },
      handoffPhase: "proposed",
    };
  }

  if (
    existingProposal &&
    (!isHandoffProposalComplete(existingProposal, state) ||
      isIncompleteBodyPoint(existingProposal.body2Point, "sideB") ||
      isIncompleteBodyPoint(existingProposal.body1Point, "sideA"))
  ) {
    const repaired = repairProposalFromChat(state);
    if (repaired && isHandoffProposalComplete(repaired, state)) {
      return {
        gap: "ready",
        sides: explorationSideStatus(state),
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
        sides: explorationSideStatus(state),
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
  const sides = explorationSideStatus(state, msgs);
  const substance = assessEssaySubstance(state);
  const { contentReady } = assessExplorationContent(state, userMessage);
  const rounds = state.coachContext?.exploreRound ?? 0;
  const gap = expectedGap(sides, substance.sufficient);
  const gapQ = singleGapCoachPrompt(sides, state);
  const lastQ = state.coachContext?.lastQuestion ?? "";
  const themes = extractExplorationThemes(state, msgs);

  const semanticHandoff = trySemanticHandoffOverride({ state, msgs, themes, sides, userMessage });
  if (semanticHandoff) return semanticHandoff;

  const llmMirrorEarly =
    result.mirror?.trim() && result.mirror !== userMessage?.trim()
      ? result.mirror.trim()
      : "";

  if (themes.themesComplete && !themes.readyToFinalize) {
    const lastTarget = refinementTargetFromAsk(lastQ);
    const curr = userMessage?.trim() ?? "";
    if (lastTarget && curr && userMessageRefinesBody(curr, lastTarget, themes)) {
      const refreshed = extractExplorationThemes(state, msgs);
      if (refreshed.readyToFinalize) {
        const auto = repairProposalFromChat(state);
        if (auto && isHandoffProposalComplete(auto, state)) {
          return {
            gap: "ready",
            sides,
            shouldPropose: true,
            proposal: auto,
            coach: {
              mirror: llmMirrorEarly || "两侧论点都够具体了。",
              ask: formatProposalCoachMessage(
                auto,
                "六栏整理在左侧，请核对；若要改某一栏直接说。",
              ),
            },
            handoffPhase: "proposed",
            essaySubstanceSufficient: true,
          };
        }
      }
    }
  }

  if (contentReady && themes.readyToFinalize && rounds >= 3) {
    const auto = repairProposalFromChat(state);
    if (auto) {
      return {
        gap: "ready",
        sides,
        shouldPropose: true,
        proposal: auto,
        coach: {
          mirror: "",
          ask: formatProposalCoachMessage(
            auto,
            "利弊和立场都清楚了，六栏整理在左侧，请核对。",
          ),
        },
        handoffPhase: "proposed",
        essaySubstanceSufficient: true,
      };
    }
  }

  let proposal =
    resolveHandoffProposal(state, result) ??
    (shouldForceProposal(contentReady, substance.sufficient, sides, rounds, userMessage)
      ? sanitizeHandoffProposal(buildHandoffFromChat(state), state)
      : null);

  const shouldPropose =
    !!proposal &&
    isHandoffProposalComplete(proposal, state) &&
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
      isIncompleteBodyPoint(repaired.body2Point, "sideB") ||
      isIncompleteBodyPoint(repaired.body1Point, "sideA")
        ? "六栏已整理，但分论点需你核对补全（尤其 Body2）。"
        : result.proposalSummary?.trim() ||
          "两个 Body 方向都够写两段了，六栏整理在左侧，请核对。";
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

  if (
    shouldBrainstormFirst(
      state,
      contentReady,
      sides,
      substance.sufficient,
      rounds,
      msgs,
    ) &&
    !shouldPropose
  ) {
    return {
      gap,
      sides,
      shouldPropose: false,
      proposal: null,
      coach: {
        mirror:
          llmMirror ||
          (msgs.length <= 1
            ? brainstormSummaryFallback(state)
            : "我先记下你这边的想法。"),
        ask: planCoachAsk(
          state,
          result,
          userMessage,
          selectStage1CoachAsk(
            state,
            themes,
            contentReady,
            substance.coachPrompt ?? "",
            { llmAsk: result.coachQuestion },
          ),
        ),
      },
      handoffPhase: "exploring",
    };
  }

  const askedSide = gapSideFromCoachQuestion(lastQ, state);
  if (
    contentReady &&
    !substance.sufficient &&
    askedSide &&
    gapQ &&
    userMessage?.trim() &&
    userAnsweredExplorationGap(userMessage, askedSide, state)
  ) {
    const mirror = buildGapProgressionMirror(askedSide, state, msgs);
    return {
      gap: otherSide(askedSide),
      sides,
      shouldPropose: false,
      proposal: null,
      coach: {
        mirror,
        ask: planCoachAsk(state, result, userMessage, gapQ),
      },
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
    state,
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
    const preview = buildRecordedSidesPreview(state, msgs);
    const coachQ = planCoachAsk(
      state,
      result,
      userMessage,
      selectStage1CoachAsk(state, themes, contentReady, substance.coachPrompt ?? "", {
        gapQ,
        preferGapFirst: true,
      }) ||
        `请分别用一句话说清 ${explorationSideLabel(state, "sideA")} 和 ${explorationSideLabel(state, "sideB")}。`,
    );
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

  let nextQ = isRuntimePlanEnforcementEnabled()
    ? planCoachAsk(state, result, userMessage, result.coachQuestion ?? "")
    : selectStage1CoachAsk(
        state,
        themes,
        contentReady,
        substance.coachPrompt ?? "",
        { llmAsk: result.coachQuestion, gapQ },
      );
  if (nextQ && isExplorationQuestionRedundant(nextQ, themes)) {
    if (themes.readyToFinalize) {
      const auto = repairProposalFromChat(state);
      if (auto && isHandoffProposalComplete(auto, state)) {
        return {
          gap: "ready",
          sides,
          shouldPropose: true,
          proposal: auto,
          coach: {
            mirror: "前面说的利弊我都记下了。",
            ask: formatProposalCoachMessage(
              auto,
              "六栏整理在左侧，请核对；若要改结构再说一声。",
            ),
          },
          handoffPhase: "proposed",
          essaySubstanceSufficient: true,
        };
      }
    }
    nextQ = stage1PlanQuestion(decideStage1Plan(state)) || gapQ || "";
  }

  if (
    nextQ &&
    /body\s*2|论点.*不完整|补充完整|描述不完整/i.test(nextQ) &&
    sides.sideA &&
    sides.sideB
  ) {
    const repaired = repairProposalFromChat(state);
    if (repaired && isHandoffProposalComplete(repaired, state)) {
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
    sides.sideA &&
    sides.sideB &&
    proposal &&
    isHandoffProposalComplete(proposal, state)
  ) {
    return {
      gap: "ready",
      sides,
      shouldPropose: true,
      proposal,
      coach: {
        mirror: "",
        ask: formatProposalCoachMessage(
          proposal,
          "两个 Body 方向都够写两段了，六栏整理在左侧，请核对。",
        ),
      },
      handoffPhase: "proposed",
    };
  }

  if (
    nextQ &&
    (isRepeatedQuestion(lastQ, nextQ, state) ||
      isExplorationQuestionRedundant(nextQ, themes))
  ) {
    const replacement = themes.readyToFinalize ? "" : gapQ || nextQ;
    return {
      gap,
      sides,
      shouldPropose: false,
      proposal: null,
      coach: {
        mirror:
          llmMirror ||
          buildRecordedSidesPreview(state, msgs) ||
          "前面说的我都记下了。",
        ask: planCoachAsk(state, result, userMessage, replacement),
      },
      handoffPhase: "exploring",
    };
  }

  if (
    themes.readyToFinalize &&
    sides.sideA &&
    sides.sideB &&
    resolveCoachTurnPlanForSession(state, userMessage)?.action === "finalize"
  ) {
    const auto = repairProposalFromChat(state);
    if (auto) {
      return {
        gap: "ready",
        sides,
        shouldPropose: true,
        proposal: auto,
        coach: {
          mirror: "",
          ask: formatProposalCoachMessage(
            auto,
            "两个 Body 方向都够写两段了，六栏整理在左侧，请核对。",
          ),
        },
        handoffPhase: "proposed",
        essaySubstanceSufficient: true,
      };
    }
  }

  const preview = buildRecordedSidesPreview(state, msgs);
  const mirror = planCoachMirror(
    state,
    result,
    userMessage,
    llmMirror ||
      preview ||
      (gap === "sideA" || gap === "sideB"
        ? gapMirrorForMissingSide(gap, state)
        : "我们继续把两个 Body 方向写实。"),
  );

  let ask = planCoachAsk(
    state,
    result,
    userMessage,
    selectStage1CoachAsk(state, themes, contentReady, substance.coachPrompt ?? "", {
      llmAsk: nextQ || result.coachQuestion,
      gapQ,
      preferGapFirst: !result.coachQuestion?.trim(),
    }) || "",
  );

  if (!isRuntimePlanEnforcementEnabled()) {
    ask = reconcileMirrorAndAsk(mirror, ask, state, themes);
  }

  return {
    gap,
    sides,
    shouldPropose: false,
    proposal: null,
    coach: { mirror, ask },
    handoffPhase: "exploring",
  };
}
