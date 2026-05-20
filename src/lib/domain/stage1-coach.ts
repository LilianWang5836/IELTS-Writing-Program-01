import {
  assessEssaySubstance,
  extractProposedHandoffRule,
  formatProposalCoachMessage,
  isHandoffProposalComplete,
  proposedHandoffFromResult,
} from "./essay-substance";
import { ANGLE_TEACH_CHAT } from "./constants";
import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

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

export function assessExplorationContent(
  state: SessionState,
  userMessage?: string,
): { contentReady: boolean; summary: string } {
  const blob = [
    state.s1?.taskUnderstanding ?? "",
    state.s1?.position ?? "",
    state.handoff?.taskUnderstanding ?? "",
    state.handoff?.position ?? "",
    userMessage ?? "",
    ...state.chatHistory.filter((m) => m.role === "user").map((m) => m.content),
  ]
    .join(" ")
    .toLowerCase();

  const TASK_RE =
    /discuss|讨论|双方|两种观点|agree|disagree|优缺点|利弊/i;
  const POSITION_RE =
    /取决于|看情况|部分同意|分开|分流|不同学生|规划|路径|条件|反之|尽快/i;
  const DIM_EMPLOY_RE =
    /就业|工作|职场|技能|实操|实习|job|career|employ|尽快工作/i;
  const DIM_ACADEMIC_RE =
    /学术|研究|理论|知识|深造|phd|academic|纯粹|系统/i;

  const hasTask =
    TASK_RE.test(blob) ||
    (state.s1?.taskUnderstanding?.trim().length ?? 0) > 8;
  const hasPosition =
    POSITION_RE.test(blob) || (state.s1?.position?.trim().length ?? 0) > 6;
  const hasEmploy = DIM_EMPLOY_RE.test(blob);
  const hasAcademic = DIM_ACADEMIC_RE.test(blob);
  const contentReady = hasTask && hasPosition && hasEmploy && hasAcademic;

  const summary = contentReady
    ? "题型、立场和两条线（就业技能 / 学术知识）我都听到了。"
    : "";

  return { contentReady, summary };
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
  ];
  for (const group of themes) {
    if (group.some((w) => prev.includes(w)) && group.some((w) => next.includes(w))) {
      return true;
    }
  }
  return false;
}

function mergeExtractedToHandoff(
  handoff: Stage1Handoff,
  extracted?: Record<string, unknown>,
): Stage1Handoff {
  const ex = extracted as Record<string, string> | undefined;
  if (!ex) return handoff;
  return {
    ...handoff,
    questionType: ex.questionType || handoff.questionType,
    taskUnderstanding:
      handoff.taskUnderstanding || ex.taskUnderstanding || "",
    position: handoff.position || ex.position || "",
    body1Point: handoff.body1Point || ex.body1Point || "",
    body1Angle: handoff.body1Angle || ex.body1Angle || "",
    body2Point: handoff.body2Point || ex.body2Point || "",
    body2Angle: handoff.body2Angle || ex.body2Angle || "",
  };
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
  const { contentReady, summary } = assessExplorationContent(
    nextState,
    userMessage,
  );
  const frustrated = userMessage ? detectFrustration(userMessage) : false;
  const repeated = isRepeatedQuestion(
    state.coachContext?.lastQuestion ?? "",
    result.coachQuestion ?? result.userVisibleText ?? "",
  );

  const proposalFromLlm = proposedHandoffFromResult(result);
  const rulesOk = substance.sufficient;
  const llmOk = llmSaysSubstanceOk(result);

  let finalProposal = proposalFromLlm;
  if (rulesOk && !finalProposal) {
    finalProposal = extractProposedHandoffRule(nextState);
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
      result.proposalSummary,
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

  if (rulesOk && !canPropose) {
    const coachQ =
      substance.gaps[0] ??
      "请各用一句话说清：就业技能一侧写什么？学术知识一侧写什么？";
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: summary || "两条线有了，还可以再写实一点。",
        coachQuestion: coachQ,
        userVisibleText: summary || "两条线有了，还可以再写实一点。",
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
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: summary,
        coachQuestion: substance.coachPrompt,
        userVisibleText: summary,
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
