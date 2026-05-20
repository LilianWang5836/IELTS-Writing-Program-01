import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|说得很清楚|什么意思|别绕|听不懂/i;

const TASK_RE =
  /discuss|讨论|双方|两种观点|两个观点|agree|disagree|优缺点|利弊/i;

const POSITION_RE =
  /取决于|看情况|部分同意|分开|分流|不同学生|规划|路径|条件|反之|尽快/i;

const DIM_EMPLOY_RE =
  /就业|工作|职场|技能|实操|实习|job|career|employ|尽快工作/i;

const DIM_ACADEMIC_RE =
  /学术|研究|理论|知识|深造|phd|academic|纯粹|系统/i;

const MIN_USER_TURNS_BEFORE_HANDOFF_NUDGE = 2;

export function detectFrustration(message: string): boolean {
  return FRUSTRATION_RE.test(message);
}

function userTurnCount(state: SessionState): number {
  return state.chatHistory.filter((m) => m.role === "user").length;
}

/** 内容是否够写定稿（与聊了几轮无关） */
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

  const hasTask =
    TASK_RE.test(blob) ||
    (state.s1?.taskUnderstanding?.trim().length ?? 0) > 8;
  const hasPosition =
    POSITION_RE.test(blob) || (state.s1?.position?.trim().length ?? 0) > 6;
  const hasEmploy = DIM_EMPLOY_RE.test(blob);
  const hasAcademic = DIM_ACADEMIC_RE.test(blob);
  const twoDims = hasEmploy && hasAcademic;

  const contentReady = hasTask && hasPosition && twoDims;

  const summary = contentReady
    ? "Discuss 题、条件立场，以及就业技能 vs 学术知识两条线，我都听到了。"
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
  ];
  for (const group of themes) {
    const prevHit = group.some((w) => prev.includes(w));
    const nextHit = group.some((w) => next.includes(w));
    if (prevHit && nextHit) return true;
  }
  return false;
}

/** 收口定稿提示（单条消息，含换行） */
export function buildHandoffNudge(turns: number): string {
  const warm =
    turns >= 4
      ? "我们聊了几轮，可以收束了。"
      : "你这轮已经把题型、立场和两个角度说清楚了。";
  return [
    warm,
    "请在左侧「审题定稿」6 栏填写并点「提交审题定稿」（不必在聊天重复）：",
    "① 题意　② 立场　③ Body1 分论点　④ Body1 角度",
    "⑤ Body2 分论点　⑥ Body2 角度",
    "可用聊天里选中文字 →「使用」填入。",
  ].join("\n");
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
  };
}

export function postProcessStage1(
  state: SessionState,
  result: LlmTurnResult,
  userMessage?: string,
): { result: LlmTurnResult; state: SessionState } {
  const rounds = (state.coachContext?.exploreRound ?? 0) + 1;
  let nextState: SessionState = {
    ...state,
    coachContext: {
      ...state.coachContext,
      exploreRound: rounds,
    },
    handoff: mergeExtractedToHandoff(
      state.handoff ?? {
        taskUnderstanding: "",
        position: "",
        body1Point: "",
        body1Angle: "",
        body2Point: "",
        body2Angle: "",
      },
      result.extracted,
    ),
  };

  const turns = userTurnCount(nextState);
  const { contentReady, summary } = assessExplorationContent(
    nextState,
    userMessage,
  );
  const canNudgeHandoff =
    contentReady && turns >= MIN_USER_TURNS_BEFORE_HANDOFF_NUDGE;
  const forceNudge = turns >= 4 && contentReady;

  const frustrated = userMessage ? detectFrustration(userMessage) : false;
  const repeated = isRepeatedQuestion(
    state.coachContext?.lastQuestion ?? "",
    result.coachQuestion ?? result.userVisibleText ?? "",
  );

  if (canNudgeHandoff || forceNudge || (frustrated && contentReady)) {
    const nudge = buildHandoffNudge(turns);
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: "",
        coachQuestion: "",
        userVisibleText: nudge,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          readyForHandoff: true,
          lastQuestion: "",
        },
      },
    };
  }

  if (frustrated || repeated) {
    const simplify = contentReady
      ? buildHandoffNudge(turns)
      : "Body1 先写「就业/职场技能」还是 Body2 先写「学术/知识」？选一个回答即可。";
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: "抱歉，我说具体一点。",
        coachQuestion: contentReady ? "" : simplify,
        userVisibleText: contentReady
          ? simplify
          : "不是在考审题，是帮你定两个分论点方向。",
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: simplify,
        },
      },
    };
  }

  // 首轮信息已够：肯定 + 可选微调，不催定稿
  if (contentReady && turns < MIN_USER_TURNS_BEFORE_HANDOFF_NUDGE) {
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: summary,
        coachQuestion:
          "若你认可「就业技能 / 学术知识」两条线，可直接填左侧定稿；若想补充限制条件（如国家/专业），请说一句。",
        userVisibleText: summary,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion:
            "若认可两条线，可填左侧定稿；或补充一个限制条件。",
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
