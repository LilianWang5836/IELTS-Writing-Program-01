import {
  buildRecordedSidesPreview,
  explorationSideStatus,
  formatProposalCoachMessage,
  gapSideFromCoachQuestion,
  isMostlyEnglish,
  isHandoffProposalComplete,
  userAnsweredBothSidesInMessage,
  userMessages,
} from "./essay-substance";
import { resolveHandoffTurnDecision } from "./handoff-turn-decision";
import { buildOutputContract } from "./output-contract";
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
  const briefSummary =
    result.proposalSummary?.trim() && !isMostlyEnglish(result.proposalSummary)
      ? result.proposalSummary.trim().slice(0, 60)
      : summary?.includes("记下")
        ? "两侧都够写两段了，六栏整理在左侧，请核对。"
        : summary?.trim() || "两侧都够写两段了，六栏整理在左侧，请核对。";
  const msg = formatProposalCoachMessage(finalProposal, briefSummary);
  return {
    result: {
      ...result,
      verdict: "coach",
      advance: false,
      mirror: "",
      coachQuestion: "",
      userVisibleText: buildOutputContract({
        module: "stage1:planning",
        meaningOk: true,
        meaningReason: "审题与立场信息已够生成方案",
        paragraphFit: true,
        paragraphReason: "两侧分论点已成型，可进入下一阶段",
        feedback: msg,
        suggestedRevision: "核对六栏是否符合你的真实意图。",
        nextStep: "若无误，继续进入 Body 链条构建。",
        orchestrator: nextState.s3?.orchestrator,
      }),
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

const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|说得很清楚|什么意思|别绕|听不懂/i;

export function detectFrustration(message: string): boolean {
  return FRUSTRATION_RE.test(message);
}

/** 按轮次变化的短反馈，避免每轮重复同一句 */
export function buildExplorationSummary(
  state: SessionState,
  contentReady: boolean,
  substanceSufficient: boolean,
  userMessage?: string,
): string {
  if (!contentReady) return "";
  const sides = explorationSideStatus(userMessages(state));
  if (substanceSufficient) {
    const preview = buildRecordedSidesPreview(userMessages(state));
    return preview
      ? `${preview}两侧都够写两段了，我帮你整理一版审题定稿。`
      : "两侧都够写两段了，我帮你整理一版审题定稿。";
  }
  if (sides.academic && !sides.employ) {
    return "学术侧方向有了，请再补一句就业/技能侧：这段想写什么、为什么。";
  }
  if (sides.employ && !sides.academic) {
    return "就业侧方向有了，请再补一句学术/知识侧：这段想写什么、为什么。";
  }
  if (userAnsweredBothSidesInMessage(userMessage)) {
    return "两侧方向有了，再各用一句话说清 Body1、Body2 各写什么，我就能整理定稿。";
  }
  const rounds = state.coachContext?.exploreRound ?? 0;
  if (rounds <= 1) {
    return "题型和立场我听到了，我们把两条线各再写实一点。";
  }
  return "两条线方向有了，再补具体一点就能整理定稿。";
}

/** 探索阶段只合并题意/立场，避免 Body 栏被 LLM 占位导致左侧误亮「可提交」 */
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
  const baseHandoff = mergeExtractedToHandoff(
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

  const nextState: SessionState = {
    ...state,
    handoff: baseHandoff,
    coachContext: {
      ...state.coachContext,
      exploreRound: rounds,
    },
  };

  const decision = resolveHandoffTurnDecision({
    state: nextState,
    result,
    userMessage,
  });

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

  const { mirror, ask } = decision.coach;
  const userVisible = [mirror, ask].filter(Boolean).join("\n\n");

  return {
    result: {
      ...result,
      verdict: "coach",
      advance: false,
      mirror,
      coachQuestion: ask,
      userVisibleText: buildOutputContract({
        module: "stage1:planning",
        meaningOk: decision.gap === "ready",
        meaningReason:
          decision.gap === "ready"
            ? "题意与立场已清楚"
            : "还在补齐题意/立场信息",
        paragraphFit: decision.gap === "ready",
        paragraphReason:
          decision.gap === "ready"
            ? "可进入下一阶段"
            : "先补齐两侧观点与理由",
        feedback: userVisible || ask || "继续按提示补充即可。",
        suggestedRevision:
          decision.gap === "ready"
            ? "确认两侧观点是否准确表达你的立场。"
            : "围绕缺口补一句更具体的内容。",
        nextStep:
          ask || (decision.gap === "ready" ? "确认后进入 Stage2。" : "按问题继续补充。"),
        orchestrator: nextState.s3?.orchestrator,
      }),
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
