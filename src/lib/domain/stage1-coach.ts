import type { LlmTurnResult, SessionState, Stage1Handoff } from "./types";

const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|说得很清楚|什么意思|别绕|听不懂/i;

const TASK_RE =
  /discuss|讨论|双方|两种观点|两个观点|agree|disagree|优缺点|利弊/i;

const POSITION_RE =
  /取决于|看情况|部分同意|分开|分流|不同学生|规划|路径|条件/i;

const DIM_EMPLOY_RE =
  /就业|工作|职场|技能|实操|实习|job|career|employ/i;

const DIM_ACADEMIC_RE =
  /学术|研究|理论|知识|深造|phd|academic|knowledge|系统/i;

export function detectFrustration(message: string): boolean {
  return FRUSTRATION_RE.test(message);
}

function userTurnCount(state: SessionState): number {
  return state.chatHistory.filter((m) => m.role === "user").length;
}

export function assessExplorationReady(
  state: SessionState,
  userMessage?: string,
): { ready: boolean; summary: string } {
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

  const ready = hasTask && hasPosition && twoDims;

  const summary = ready
    ? "题型与条件立场已清楚，且已有「就业/技能」与「学术/知识」两个切入面。"
    : "";

  return { ready, summary };
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

export function buildHandoffNudge(
  handoff: Stage1Handoff | undefined,
  extracted?: Record<string, unknown>,
): string {
  const ex = extracted as Record<string, string> | undefined;
  const lines = [
    "探索够了，请改填左侧「审题定稿」并提交（聊天不用再重复）。",
    "① 题意 ② 立场 ③ Body1 分论点+角度 ④ Body2 分论点+角度。",
  ];
  if (ex?.taskUnderstanding || handoff?.taskUnderstanding) {
    lines.push(`题意可参考：${ex?.taskUnderstanding ?? handoff?.taskUnderstanding}`);
  }
  if (ex?.position || handoff?.position) {
    lines.push(`立场可参考：${ex?.position ?? handoff?.position}`);
  }
  lines.push("Body1 建议写就业/技能路径；Body2 建议写学术/知识路径（角度用你自己的话）。");
  return lines.slice(0, 3).join(" ");
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

  const { ready, summary } = assessExplorationReady(nextState, userMessage);
  const frustrated = userMessage ? detectFrustration(userMessage) : false;
  const repeated = isRepeatedQuestion(
    state.coachContext?.lastQuestion ?? "",
    result.coachQuestion ?? result.userVisibleText ?? "",
  );
  const manyRounds = userTurnCount(nextState) >= 4;

  if (ready || (manyRounds && assessExplorationReady(nextState).ready)) {
    const nudge = buildHandoffNudge(nextState.handoff, result.extracted);
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: summary || "你的审题要素已经齐全。",
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
    const simplify = ready
      ? buildHandoffNudge(nextState.handoff, result.extracted)
      : "我们具体一点：Body1 你更想写「就业/职场技能」还是「学术/理论知识」？只选一个先写。";
    return {
      result: {
        ...result,
        verdict: "coach",
        advance: false,
        mirror: "抱歉，我换种更具体的说法。",
        coachQuestion: simplify,
        userVisibleText: "不是在考你审题，而是帮你定两个分论点方向。",
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
