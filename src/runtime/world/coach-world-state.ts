import type { SessionState } from "@/lib/domain/types";
import {
  aggregateCoverage,
  buildDiscourseMemory,
  detectFunctionsFromSentence,
} from "@/lib/domain/chain-discourse";
import type { CoachWorldState } from "../types";
import {
  deriveCoachingSignalsStage1,
  deriveCoachingSignalsStage2,
  emptyCoachingSignals,
  mergeCoachingSignals,
} from "./coaching-signals";
import { interpretDiscourseSignals } from "./discourse-signals";
import { extractEngagementSignals } from "./engagement-signals";
import { extractSemanticFeatures } from "./semantic-features";

export interface WorldBuildContext {
  body?: "body1" | "body2";
  userMessages?: string[];
}

function userMessagesFromState(state: SessionState): string[] {
  return state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content);
}

function resolvePhaseMeta(state: SessionState, body?: "body1" | "body2") {
  const subStep = state.subStep;
  const handoffPhase = state.coachContext?.handoffPhase;
  const chainPhase =
    body === "body1"
      ? state.s2?.body1?.chainPhase
      : body === "body2"
        ? state.s2?.body2?.chainPhase
        : undefined;
  const phaseLegal =
    subStep === "S1_EVAL" ||
    subStep === "S2_2_BODY1" ||
    subStep === "S2_3_BODY2";
  return { subStep, handoffPhase, chainPhase, body, phaseLegal };
}

/** Thin orchestrator — A → B → C + engagement. */
export function buildCoachWorldState(
  state: SessionState,
  userMessage = "",
  ctx?: WorldBuildContext,
): CoachWorldState {
  const msgs = ctx?.userMessages ?? userMessagesFromState(state);
  const chatBlob = msgs.join("\n");
  const semantic = extractSemanticFeatures(userMessage, chatBlob);

  let userTurnFunctionCount = 0;
  if (userMessage.trim() && ctx?.body) {
    const fns = detectFunctionsFromSentence(userMessage, ctx.body);
    userTurnFunctionCount = fns.length;
  }

  let discourseOpts: Parameters<typeof interpretDiscourseSignals>[1] = {
    userTurnFunctionCount,
  };

  const phase = resolvePhaseMeta(state, ctx?.body);
  let coachingPartial = emptyCoachingSignals();

  if (state.subStep === "S1_EVAL") {
    const discourse = interpretDiscourseSignals(semantic, discourseOpts);
    coachingPartial = mergeCoachingSignals(
      emptyCoachingSignals(),
      deriveCoachingSignalsStage1(state, msgs, discourse),
    );
    const engagement = extractEngagementSignals(state, userMessage, msgs);
    return {
      ...phase,
      semantic,
      discourse,
      coaching: coachingPartial,
      engagement,
      lastQuestion: state.coachContext?.lastQuestion ?? "",
      exploreRound: state.coachContext?.exploreRound ?? 0,
      refinementVetoBudgetRemaining: 1,
    };
  }

  if (
    (state.subStep === "S2_2_BODY1" || state.subStep === "S2_3_BODY2") &&
    state.s2
  ) {
    const body = ctx?.body ?? (state.subStep === "S2_2_BODY1" ? "body1" : "body2");
    const claim =
      body === "body1" ? state.s2.body1Point : state.s2.body2Point;
    const historyMsgs = state.chatHistory
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    const memory = buildDiscourseMemory(historyMsgs, body, claim);
    const coverage = aggregateCoverage(memory, body);
    discourseOpts = {
      ...discourseOpts,
      causalScore: coverage.causal,
      groundingScore: coverage.grounding,
      closureScore: coverage.closure,
    };
    const discourse = interpretDiscourseSignals(semantic, discourseOpts);
    const discourseReady =
      coverage.causal >= 0.65 &&
      coverage.grounding >= 0.65 &&
      (coverage.closure >= 0.5 || coverage.causal >= 0.8);
    coachingPartial = mergeCoachingSignals(
      emptyCoachingSignals(),
      deriveCoachingSignalsStage2(state, body, coverage, discourseReady),
    );
    const engagement = extractEngagementSignals(state, userMessage, msgs);
    return {
      ...phase,
      body,
      semantic,
      discourse,
      coaching: coachingPartial,
      engagement,
      lastQuestion: state.coachContext?.lastQuestion ?? "",
      exploreRound: state.coachContext?.exploreRound ?? 0,
      refinementVetoBudgetRemaining: 1,
    };
  }

  const discourse = interpretDiscourseSignals(semantic, discourseOpts);
  const engagement = extractEngagementSignals(state, userMessage, msgs);
  return {
    ...phase,
    semantic,
    discourse,
    coaching: coachingPartial,
    engagement,
    lastQuestion: state.coachContext?.lastQuestion ?? "",
    exploreRound: state.coachContext?.exploreRound ?? 0,
    refinementVetoBudgetRemaining: 1,
  };
}
