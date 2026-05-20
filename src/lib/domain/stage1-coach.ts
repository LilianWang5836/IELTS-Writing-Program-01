import {
  assessEssaySubstance,
  assessExplorationContent,
  buildHandoffFromChat,
  extractProposedHandoffRule,
  formatProposalCoachMessage,
  isHandoffProposalComplete,
  proposedHandoffFromResult,
  userAnsweredBothSidesInMessage,
} from "./essay-substance";
import { ANGLE_TEACH_CHAT } from "./constants";
import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

export { assessExplorationContent } from "./essay-substance";

const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|说得很清楚|什么意思|别绕|听不懂/i;

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
  if (substanceSufficient) {
    return "两侧都够写两段了，我帮你整理一版审题定稿。";
  }
  if (userAnsweredBothSidesInMessage(userMessage)) {
    return "你这轮把就业侧和学术侧都说到位了，我再核对一下就能整理。";
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

function llmSaysSubstanceOk(result: LlmTurnResult): boolean {
  return result.essaySubstanceSufficient === true;
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

  const proposalFromLlm = proposedHandoffFromResult(result);
  const rulesOk =
    substance.sufficient || userAnsweredBothSidesInMessage(userMessage);
  const llmOk = llmSaysSubstanceOk(result);

  let finalProposal = proposalFromLlm;
  if (!finalProposal) {
    finalProposal = extractProposedHandoffRule(nextState);
  }
  if (rulesOk && !isHandoffProposalComplete(finalProposal ?? {})) {
    finalProposal = buildHandoffFromChat(nextState);
  }

  const canPropose =
    (rulesOk || (llmOk && !!proposalFromLlm)) &&
    !!finalProposal &&
    isHandoffProposalComplete(finalProposal);

  const angleTeach = needsAngleTeaching(baseHandoff, userMessage, contentReady);
  const angleAlreadyTaught = !!state.coachContext?.angleTeachDone;

  if (!canPropose && angleTeach.needed && !angleAlreadyTaught) {
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

  if (canPropose && finalProposal) {
    const msg = formatProposalCoachMessage(
      finalProposal,
      result.proposalSummary ||
        summary ||
        "我按我们聊的内容整理了一版审题定稿，你看看是否准确。",
    );
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: "",
        coachQuestion: "",
        userVisibleText: msg,
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

  if (frustrated || repeated) {
    const angleAgain = detectAngleConfusion(userMessage);
    const coachQ =
      rulesOk && finalProposal
        ? "若下面整理没问题，点左侧「确认整理并填入」即可。"
        : angleAgain
          ? needsAngleTeaching(baseHandoff, userMessage, contentReady).followUp
          : substance.coachPrompt ??
            "Body1 写就业/技能、Body2 写学术/知识——各用一句话说清你想写什么。";
    const mirror = angleAgain
      ? `抱歉，我说清楚一点。${ANGLE_TEACH_CHAT}`
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

  if (contentReady && !rulesOk && substance.coachPrompt) {
    const coachQ = substance.coachPrompt;
    const mirror =
      summary ||
      "题型和立场有了；定稿要等两侧都写实后，我会在左侧给出整理。";
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
          lastQuestion: substance.coachPrompt,
        },
      },
    };
  }

  const q = result.coachQuestion?.trim() || "";
  if (q) {
    nextState = {
      ...nextState,
      coachContext: {
        ...nextState.coachContext,
        lastQuestion: q,
      },
    };
  }

  return { result, state: nextState };
}
