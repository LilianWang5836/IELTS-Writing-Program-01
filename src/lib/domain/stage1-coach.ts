import {
  assessEssaySubstance,
  assessExplorationContent,
  buildHandoffFromChat,
  buildRecordedSidesPreview,
  detectExplorationStuck,
  explorationSideStatus,
  extractProposedHandoffRule,
  formatProposalCoachMessage,
  isDivergentCoachQuestion,
  isHandoffProposalComplete,
  proposedHandoffFromResult,
  sanitizeHandoffProposal,
  singleGapCoachPrompt,
  userAnsweredBothSidesInMessage,
  userMessages,
} from "./essay-substance";
import { ANGLE_TEACH_CHAT } from "./constants";
import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

export { assessExplorationContent } from "./essay-substance";

const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|说得很清楚|什么意思|别绕|听不懂/i;

/** 两侧已齐后不再无限追问 */
const MAX_EXPLORE_ROUNDS_BEFORE_FORCE = 4;

function resolveHandoffProposal(
  state: SessionState,
  result: LlmTurnResult,
): Stage1Handoff | null {
  let proposal = proposedHandoffFromResult(result, state);
  if (!proposal) proposal = extractProposedHandoffRule(state);
  const substance = assessEssaySubstance(state);
  const sides = explorationSideStatus(userMessages(state));
  const shouldBuild =
    substance.sufficient || (sides.employ && sides.academic);
  if (shouldBuild && !isHandoffProposalComplete(proposal ?? {})) {
    const built = buildHandoffFromChat(state);
    if (isHandoffProposalComplete(built)) proposal = built;
  }
  if (!proposal) return null;
  return sanitizeHandoffProposal(proposal, state);
}

function shouldForceStage1Proposal(
  contentReady: boolean,
  substanceSufficient: boolean,
  sides: { employ: boolean; academic: boolean },
  exploreRound: number,
  userMessage?: string,
): boolean {
  if (!contentReady) return false;
  if (substanceSufficient) return true;
  if (sides.employ && sides.academic) return true;
  if (
    detectExplorationStuck(userMessage) &&
    sides.employ &&
    sides.academic
  ) {
    return true;
  }
  if (exploreRound >= MAX_EXPLORE_ROUNDS_BEFORE_FORCE && sides.employ && sides.academic) {
    return true;
  }
  return false;
}

function proposalCoachResponse(
  finalProposal: Stage1Handoff,
  nextState: SessionState,
  result: LlmTurnResult,
  summary: string,
): { result: LlmTurnResult; state: SessionState } {
  const msg = formatProposalCoachMessage(
    finalProposal,
    result.proposalSummary ||
      summary ||
      "两侧内容够了，我按我们聊的整理一版审题定稿，你看看是否准确。",
  );
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

const ANGLE_TERM_RE =
  /切入面|角度|视角|讨论范围|什么.*面|不懂.*(面|角度)|body\s*[12].*角度/i;

export function detectAngleConfusion(message?: string): boolean {
  return !!message?.trim() && ANGLE_TERM_RE.test(message);
}

/** 需先教切入面并多发散一轮：学生困惑，或分论点已有但切入面未齐 */
export function needsAngleTeaching(
  handoff: Stage1Handoff,
  userMessage: string | undefined,
  contentReady: boolean,
): { needed: boolean; followUp: string } {
  const confused = detectAngleConfusion(userMessage);
  const p1 = handoff.body1Point?.trim();
  const p2 = handoff.body2Point?.trim();
  const a1 = handoff.body1Angle?.trim();
  const a2 = handoff.body2Angle?.trim();
  const pointsWithoutAngles =
    contentReady && ((!!p1 && !a1) || (!!p2 && !a2) || (!!p1 && !!p2 && (!a1 || !a2)));

  if (!confused && !pointsWithoutAngles) {
    return { needed: false, followUp: "" };
  }

  let followUp: string;
  if (!a1 && !a2) {
    followUp =
      "Body1 打算从哪一面写（如就业市场）？Body2 用另一个范围（如学术深造）？各说一个词即可。";
  } else if (!a1) {
    followUp =
      "Body1 就业/技能这条线，你打算用什么词标出「这一段的范围」？";
  } else if (!a2) {
    followUp =
      "Body2 学术/知识这条线，对应的范围词打算写什么？";
  } else {
    followUp =
      "两段切入面要不同：就业侧你标什么？学术侧你标什么？各一个词即可。";
  }

  return { needed: true, followUp };
}

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

function normQ(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").slice(0, 40);
}

export function isRepeatedQuestion(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  const a = normQ(prev);
  const b = normQ(next);
  if (a === b) return true;
  if (a.length > 8 && b.length > 8 && (a.includes(b) || b.includes(a))) return true;
  const themes = [
    ["职能", "强调", "观点"],
    ["两个观点", "双方", "分别"],
    ["平衡", "体现", "价值"],
    ["概括", "一句话", "任务"],
    ["填左侧", "6 栏", "定稿"],
    ["各用一句话", "就业技能一侧", "学术知识一侧"],
    ["两侧", "写实"],
    ["补一句", "写什么", "为什么"],
    ["开放", "批判性", "教学机会"],
    ["哪些领域", "教学方法", "学习机会"],
    ["你认为大学", "应该提供哪些"],
  ];
  for (const group of themes) {
    if (group.some((w) => prev.includes(w)) && group.some((w) => next.includes(w))) {
      return true;
    }
  }
  return false;
}

/** 探索阶段只合并题意/立场，避免 Body 栏被 LLM 占位导致左侧误亮「可提交」 */
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

function isExplorationHandoffMerge(state: SessionState): boolean {
  const phase = state.coachContext?.handoffPhase;
  return !state.handoffLocked && phase !== "editing" && phase !== "locked";
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

  let nextState: SessionState = {
    ...state,
    handoff: baseHandoff,
    coachContext: {
      ...state.coachContext,
      exploreRound: rounds,
    },
  };

  const substance = assessEssaySubstance(nextState);
  const { contentReady } = assessExplorationContent(nextState, userMessage);
  const summary = buildExplorationSummary(
    nextState,
    contentReady,
    substance.sufficient,
    userMessage,
  );
  const frustrated = userMessage ? detectFrustration(userMessage) : false;
  const lastQ = state.coachContext?.lastQuestion ?? "";
  const nextQ =
    result.coachQuestion?.trim() ||
    substance.coachPrompt ||
    result.userVisibleText ||
    "";
  const repeated =
    isRepeatedQuestion(lastQ, nextQ) ||
    (substance.sufficient &&
      /各用一句话|就业技能一侧|学术知识一侧/.test(lastQ) &&
      userAnsweredBothSidesInMessage(userMessage));

  const msgs = userMessages(nextState);
  const sides = explorationSideStatus(msgs);
  const forcePropose = shouldForceStage1Proposal(
    contentReady,
    substance.sufficient,
    sides,
    rounds,
    userMessage,
  );
  const finalProposal = resolveHandoffProposal(nextState, result);
  const canPropose =
    forcePropose &&
    !!finalProposal &&
    isHandoffProposalComplete(finalProposal);

  const angleTeach = needsAngleTeaching(baseHandoff, userMessage, contentReady);
  const angleAlreadyTaught = !!state.coachContext?.angleTeachDone;

  if (canPropose) {
    return proposalCoachResponse(finalProposal, nextState, result, summary);
  }

  if (!canPropose && angleTeach.needed && !angleAlreadyTaught && !forcePropose) {
    const coachQ = angleTeach.followUp;
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: ANGLE_TEACH_CHAT,
        coachQuestion: coachQ,
        userVisibleText: ANGLE_TEACH_CHAT,
        essaySubstanceSufficient: false,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          angleTeachDone: true,
          lastQuestion: coachQ,
        },
      },
    };
  }

  if (frustrated || repeated) {
    if (forcePropose && finalProposal && isHandoffProposalComplete(finalProposal)) {
      return proposalCoachResponse(finalProposal, nextState, result, summary);
    }
    const angleAgain = detectAngleConfusion(userMessage);
    const coachQ =
      forcePropose && finalProposal
        ? "若下面整理没问题，点左侧「确认整理并填入」即可。"
        : angleAgain
          ? needsAngleTeaching(baseHandoff, userMessage, contentReady).followUp
          : singleGapCoachPrompt(sides) ||
            substance.coachPrompt ||
            "Body1 写就业/技能、Body2 写学术/知识——各用一句话说清你想写什么。";
    const preview = buildRecordedSidesPreview(msgs);
    const mirror = angleAgain
      ? `抱歉，我说清楚一点。${ANGLE_TEACH_CHAT}`
      : preview
        ? `${preview}我换种更具体的问法。`
        : "抱歉，我换种更具体的说法。";
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror,
        coachQuestion: coachQ,
        userVisibleText: mirror,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: coachQ,
        },
      },
    };
  }

  if (
    (isDivergentCoachQuestion(nextQ) || isDivergentCoachQuestion(result.coachQuestion ?? "")) &&
    sides.employ &&
    sides.academic &&
    finalProposal &&
    isHandoffProposalComplete(finalProposal)
  ) {
    return proposalCoachResponse(finalProposal, nextState, result, summary);
  }

  if (contentReady && !forcePropose && substance.coachPrompt) {
    const coachQ = singleGapCoachPrompt(sides) || substance.coachPrompt;
    const preview = buildRecordedSidesPreview(msgs);
    const mirror =
      preview ||
      summary ||
      "题型和立场有了；还差一侧各一句，补完我就整理定稿。";
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror,
        coachQuestion: coachQ,
        userVisibleText: mirror,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: coachQ,
        },
      },
    };
  }

  if (forcePropose && finalProposal && isHandoffProposalComplete(finalProposal)) {
    return proposalCoachResponse(finalProposal, nextState, result, summary);
  }

  let coachQ = result.coachQuestion?.trim() || "";
  if (isDivergentCoachQuestion(coachQ) && sides.employ && sides.academic) {
    coachQ = "";
  }
  if (coachQ && isRepeatedQuestion(lastQ, coachQ)) {
    coachQ = singleGapCoachPrompt(sides) || substance.coachPrompt || coachQ;
  }

  const preview = buildRecordedSidesPreview(msgs);
  const mirror =
    result.mirror?.trim() && result.mirror !== userMessage?.trim()
      ? result.mirror
      : preview || summary || "";

  if (coachQ || mirror) {
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror,
        coachQuestion: coachQ,
        userVisibleText: [mirror, coachQ].filter(Boolean).join("\n\n"),
        essaySubstanceSufficient: false,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: coachQ || lastQ,
        },
      },
    };
  }

  return { result, state: nextState };
}
