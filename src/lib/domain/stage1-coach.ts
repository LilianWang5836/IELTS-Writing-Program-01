import {
  buildRecordedSidesPreview,
  explorationHandoffPreview,
  explorationSideStatus,
  formatProposalCoachMessage,
  isMostlyEnglish,
  isHandoffProposalComplete,
  mergeExplorationIntoHandoff,
  userAnsweredBothSidesInMessage,
  userMessages,
} from "./essay-substance";
import { explorationSideLabel } from "./stage1-exploration";
import {
  extractExplorationThemes,
  reconcileMirrorAndAsk,
} from "./stage1-exploration-themes";
import { resolveHandoffTurnDecision } from "./handoff-turn-decision";
import { readRewriteRiskGate } from "./stage1-rewrite-risk";
import { overlayRuntimePlanOnCoach, isRuntimePlanEnforcementEnabled } from "./runtime-plan-overlay";
import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

export {
  assessExplorationContent,
  isProposalAffirmation,
} from "./essay-substance";

function proposalCoachResponse(
  finalProposal: Stage1Handoff,
  nextState: SessionState,
  result: LlmTurnResult,
  summary: string,
): { result: LlmTurnResult; state: SessionState } {
  const fallbackSummary = "六栏整理稿已在左侧，请核对。";
  const briefSummary =
    result.proposalSummary?.trim() && !isMostlyEnglish(result.proposalSummary)
      ? result.proposalSummary.trim().slice(0, 60)
      : summary?.includes("记下")
        ? fallbackSummary
        : summary?.trim() || fallbackSummary;
  const msg = formatProposalCoachMessage(finalProposal, briefSummary);
  return {
    result: {
      ...result,
      verdict: "coach",
      advance: false,
      mirror: "",
      coachQuestion: "",
      userVisibleText: msg,
      essaySubstanceSufficient: true,
    },
    state: {
      ...nextState,
      handoffProposal: finalProposal,
      coachContext: {
        ...nextState.coachContext,
        handoffPhase: "proposed",
        readyForHandoff: false,
        lastQuestion: "",
      },
    },
  };
}

export { detectAngleConfusion, needsAngleTeaching } from "./essay-substance";

export { detectFrustration } from "@/runtime/shared/frustration";

export function buildExplorationSummary(
  state: SessionState,
  contentReady: boolean,
  substanceSufficient: boolean,
  userMessage?: string,
): string {
  if (!contentReady) return "";
  const sides = explorationSideStatus(state);
  if (substanceSufficient) {
    const preview = buildRecordedSidesPreview(state);
    return preview
      ? `${preview}两个 Body 方向都够写两段了，我帮你整理一版审题定稿。`
      : "两个 Body 方向都够写两段了，我帮你整理一版审题定稿。";
  }
  if (sides.sideB && !sides.sideA) {
    const label = explorationSideLabel(state, "sideA");
    return `${explorationSideLabel(state, "sideB")}有了，请再补一句 ${label}：这段想写什么、为什么。`;
  }
  if (sides.sideA && !sides.sideB) {
    const label = explorationSideLabel(state, "sideB");
    return `${explorationSideLabel(state, "sideA")}有了，请再补一句 ${label}：这段想写什么、为什么。`;
  }
  if (userAnsweredBothSidesInMessage(userMessage)) {
    return "两个方向有了，再各用一句话说清 Body1、Body2 各写什么，我就能整理定稿。";
  }
  const rounds = state.coachContext?.exploreRound ?? 0;
  if (rounds <= 1) {
    return "题型和立场我听到了，我们把两条线各再写实一点。";
  }
  return "两条线方向有了，再补具体一点就能整理定稿。";
}

function isExplorationHandoffMerge(state: SessionState): boolean {
  const phase = state.coachContext?.handoffPhase ?? "exploring";
  return phase === "exploring";
}

export { isRepeatedQuestion } from "./essay-substance";

function mergeExtractedToHandoff(
  handoff: Stage1Handoff,
  extracted?: Record<string, unknown>,
  explorationOnly = true,
): Stage1Handoff {
  const ex = extracted as Record<string, string> | undefined;
  if (!ex) return handoff;
  const base = {
    ...handoff,
    questionType: ex.questionType || handoff.questionType,
    taskUnderstanding:
      handoff.taskUnderstanding || ex.taskUnderstanding || "",
    position: handoff.position || ex.position || "",
  };
  if (explorationOnly) return base;
  return {
    ...base,
    body1Point: handoff.body1Point || ex.body1Point || "",
    body1Angle: handoff.body1Angle || ex.body1Angle || "",
    body2Point: handoff.body2Point || ex.body2Point || "",
    body2Angle: handoff.body2Angle || ex.body2Angle || "",
  };
}

export function postProcessStage1(
  state: SessionState,
  result: LlmTurnResult,
  userMessage?: string,
): { result: LlmTurnResult; state: SessionState } {
  const rounds = (state.coachContext?.exploreRound ?? 0) + 1;
  const mergedExtracted = mergeExtractedToHandoff(
    state.handoff ?? {
      taskUnderstanding: "",
      position: "",
      body1Point: "",
      body1Angle: "",
      body2Point: "",
      body2Angle: "",
    },
    result.extracted,
    isExplorationHandoffMerge(state),
  );
  const baseHandoff = mergeExplorationIntoHandoff(
    mergedExtracted,
    explorationHandoffPreview({ ...state, handoff: mergedExtracted }),
  );

  const nextState: SessionState = {
    ...state,
    handoff: baseHandoff,
    coachContext: {
      ...state.coachContext,
      exploreRound: rounds,
    },
  };

  const rewriteGate = readRewriteRiskGate(result);
  const decision = resolveHandoffTurnDecision({
    state: nextState,
    result,
    userMessage,
  });

  const llmTriedPropose =
    !!result.proposedHandoff ||
    /确认整理并填入/.test(
      [result.userVisibleText, result.mirror, result.proposalSummary]
        .filter(Boolean)
        .join("\n"),
    );

  if (rewriteGate.blockProposal && llmTriedPropose) {
    const planOverlay = isRuntimePlanEnforcementEnabled()
      ? overlayRuntimePlanOnCoach(nextState, result, userMessage)
      : null;
    const ask =
      rewriteGate.followUpAsk ||
      planOverlay?.coachQuestion?.trim() ||
      decision.coach.ask ||
      "请把你刚说的观点收成一句更具体的总括（谁 + 发生什么 + 带来什么结果），我再整理左侧。";
    const mirror =
      rewriteGate.mirrorNote ||
      planOverlay?.mirror?.trim() ||
      result.mirror?.trim() ||
      "我先不直接整理进左侧：六栏里有几处是你还没明确说到的判断。请按下面问题补一句你自己的说法。";
    const userVisible =
      [mirror, ask].filter(Boolean).join("\n\n") ||
      ask ||
      "请补充一句更具体的分论点。";

    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror,
        coachQuestion: ask,
        userVisibleText: userVisible,
        essaySubstanceSufficient: false,
        proposedHandoff: undefined,
        proposalSummary: undefined,
      },
      state: {
        ...nextState,
        handoffProposal: undefined,
        coachContext: {
          ...nextState.coachContext,
          handoffPhase: "exploring",
          lastQuestion: ask,
        },
      },
    };
  }

  if (decision.shouldPropose && decision.proposal) {
    const summary = buildExplorationSummary(
      nextState,
      true,
      true,
      userMessage,
    );
    return proposalCoachResponse(
      decision.proposal,
      {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          handoffPhase: "proposed",
        },
      },
      { ...result, proposalSummary: decision.proposalSummary ?? result.proposalSummary },
      summary,
    );
  }

  let mirror: string;
  let ask: string;
  const themes = extractExplorationThemes(nextState, userMessages(nextState));
  if (isRuntimePlanEnforcementEnabled()) {
    const planOverlay = overlayRuntimePlanOnCoach(nextState, result, userMessage);
    mirror =
      decision.coach.mirror?.trim() ||
      planOverlay.mirror?.trim() ||
      result.mirror?.trim() ||
      "";
    // Rule layer (handoff decision) is authoritative; overlay only fills gaps.
    ask =
      decision.coach.ask?.trim() ||
      planOverlay.coachQuestion?.trim() ||
      "";
  } else {
    ({ mirror, ask } = decision.coach);
  }
  ask = reconcileMirrorAndAsk(mirror, ask, nextState, themes);
  const userVisible =
    [mirror, ask].filter(Boolean).join("\n\n") ||
    ask ||
    "继续按提示补充即可。";

  return {
    result: {
      ...result,
      verdict: "coach",
      advance: false,
      mirror,
      coachQuestion: ask,
      userVisibleText: userVisible,
      essaySubstanceSufficient:
        decision.essaySubstanceSufficient ?? decision.gap === "ready",
    },
    state: {
      ...nextState,
      handoffProposal: decision.proposal ?? nextState.handoffProposal,
      coachContext: {
        ...nextState.coachContext,
        handoffPhase: decision.handoffPhase,
        lastQuestion: ask,
        ...(decision.setAngleTeachDone ? { angleTeachDone: true } : {}),
      },
    },
  };
}
