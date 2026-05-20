import { STAGE1_OPENING, MODULE_LABELS } from "@/lib/domain/constants";
import { applyHandoffToState, validateHandoff } from "@/lib/domain/handoff";
import { getCurrentModule } from "@/lib/domain/module-compiler";
import { buildRuleHintsBlock, ruleHintsForHandoff } from "@/lib/domain/rule-hints";
import { resolvePromptModule, stageLabel } from "@/lib/domain/router";
import { migrateSessionState } from "@/lib/domain/migrate-state";
import { appendChat, stateSummary } from "@/lib/domain/state";
import { validateUserSentence } from "@/lib/domain/validate";
import type {
  LlmTurnResult,
  PromptModuleId,
  SessionState,
  Stage1Handoff,
} from "@/lib/domain/types";
import { logicBreakdownFromProposal } from "@/lib/domain/chain-proposal";
import { assessEssaySubstance } from "@/lib/domain/essay-substance";
import { assessParagraphSubstance } from "@/lib/domain/paragraph-substance";
import { assessExplorationContent, postProcessStage1 } from "@/lib/domain/stage1-coach";
import {
  applyChainProposalToState,
  postProcessStage2,
} from "@/lib/domain/stage2-coach";
import type { BodyKey, WorkshopBodyKey } from "@/lib/domain/types";
import { formatCoachDisplay } from "@/lib/llm/guard";
import { callLlm } from "@/lib/llm/client";
import { buildFullPrompt } from "@/lib/prompts/loader";
import { markerWhenAdvance, shouldAdvance } from "./advance";
import {
  afterBodyCheck,
  advanceModuleAfterPass,
  applyBlueprint,
  applyBodyCoachUpdate,
  applyHandoffAdvance,
  applyStage2Body1Advance,
  applyStage2Body2Advance,
  appendMarker,
  bodyTaskAfterBody1,
  bodyTaskAfterHandoff,
  integrateBodySentences,
  markerForSubStep,
  mergeS1FromResult,
} from "./transitions";

export interface TurnResponse {
  replies: string[];
  state: SessionState;
  requiresConfirm: boolean;
  canSubmit: boolean;
}

function ensureMigrated(state: SessionState): SessionState {
  return migrateSessionState(state);
}

async function runPrompt(
  state: SessionState,
  moduleId: PromptModuleId,
  vars: Record<string, string>,
  userMessage?: string,
): Promise<LlmTurnResult> {
  const prompt = buildFullPrompt(moduleId, { query: state.topic, ...vars }, {
    stageName: stageLabel(state),
    subStepName: state.subStep,
  });
  return callLlm(prompt, moduleId, {
    userMessage,
    subStep: state.subStep,
  });
}

function buildVars(
  state: SessionState,
  userMessage?: string,
): Record<string, string> {
  const base: Record<string, string> = {
    state_summary: stateSummary(state),
    user_message: userMessage ?? "",
    rule_hints: buildRuleHintsBlock(state),
  };

  if (state.handoff) {
    base.handoff_json = JSON.stringify(state.handoff);
  }
  if (state.s1) {
    base.s1_position = state.s1.position;
    base.s1_json = JSON.stringify(state.s1);
  }
  if (state.s2) {
    base.body1_point = state.s2.body1Point;
    base.body2_point = state.s2.body2Point;
    base.body1_angle = state.s2.body1Angle;
    base.body2_angle = state.s2.body2Angle;
    base.body1_logic = state.s2.body1Logic?.slots
      ? JSON.stringify(state.s2.body1Logic.slots)
      : (state.s2.body1.chainSummary ?? state.s2.body1Logic?.raw ?? "");
    base.body2_logic = state.s2.body2Logic?.slots
      ? JSON.stringify(state.s2.body2Logic.slots)
      : (state.s2.body2.chainSummary ?? state.s2.body2Logic?.raw ?? "");
    base.s2_json = JSON.stringify({
      body1: state.s2.body1,
      body2: state.s2.body2,
    });
  }
  if (state.coachContext?.openIssue) {
    base.open_issue = state.coachContext.openIssue;
  }
  if (state.coachContext?.lastQuestion) {
    base.last_coach_question = state.coachContext.lastQuestion;
  }
  if (state.subStep === "S1_EVAL" && !state.handoffLocked) {
    const substance = assessEssaySubstance(state);
    const { contentReady } = assessExplorationContent(state, userMessage);
    base.substance_assessment = JSON.stringify({
      contentReady,
      substanceSufficient: substance.sufficient,
      gaps: substance.gaps,
      handoffPhase: state.coachContext?.handoffPhase ?? "exploring",
    });
  }
  if (state.subStep === "S2_2_BODY1" || state.subStep === "S2_3_BODY2") {
    const body: WorkshopBodyKey = state.subStep === "S2_2_BODY1" ? "body1" : "body2";
    const substance = assessParagraphSubstance(state, body, userMessage);
    const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
    base.paragraph_substance_assessment = JSON.stringify({
      substanceSufficient: substance.sufficient,
      gaps: substance.gaps,
      chainPhase: seg?.chainPhase ?? "coaching",
      chainBuildStep: state.coachContext?.chainBuildStep ?? "claim",
      bodyPoint: body === "body1" ? state.s2?.body1Point : state.s2?.body2Point,
      bodyAngle: body === "body1" ? state.s2?.body1Angle : state.s2?.body2Angle,
    });
  }

  if (state.s3) {
    const body = state.s3.currentBody;
    const mod = getCurrentModule(
      state.s3.modulePlan,
      body,
      state.s3.moduleIndex,
    );
    base.current_body = body;
    base.current_module = mod ?? "";
    base.module_label = mod ? MODULE_LABELS[mod] ?? mod : "";
    base.mode = state.s3.mode;
    const bp = state.s3.blueprint;
    if (bp && body !== "conclusion" && mod) {
      const b = bp[body as "body1" | "body2"];
      const dir =
        mod === "claim"
          ? b.logicFlow.claimDirection
          : mod === "reason"
            ? b.logicFlow.reasonDirection
            : b.logicFlow.supportDirection;
      base.module_direction = dir;
    } else if (bp?.conclusion) {
      base.module_direction =
        mod === "conclusion_restate"
          ? bp.conclusion.restateDirection
          : bp.conclusion.summaryLogicDirection;
    }
    if (state.subStep === "S3_3_BODY_CHECK") {
      base.body_sentences = integrateBodySentences(state, body);
    }
  }
  return base;
}

async function processLlmTurn(
  state: SessionState,
  moduleId: PromptModuleId,
  userMessage?: string,
): Promise<{ reply: string; state: SessionState; autoContinue: boolean }> {
  const prevSubStep = state.subStep;
  let result = await runPrompt(
    state,
    moduleId,
    buildVars(state, userMessage),
    userMessage,
  );

  let nextState = state;
  let autoContinue = false;

  if (prevSubStep === "S1_EVAL") {
    const processed = postProcessStage1(state, result, userMessage);
    result = processed.result;
    nextState = mergeS1FromResult(processed.state, result);
    const reply = formatCoachDisplay(result, { stage1: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  if (prevSubStep === "S2_2_BODY1" || prevSubStep === "S2_3_BODY2") {
    const body: BodyKey = prevSubStep === "S2_2_BODY1" ? "body1" : "body2";
    const processed = postProcessStage2(state, result, body, userMessage);
    result = processed.result;
    nextState = applyBodyCoachUpdate(processed.state, body, result, userMessage);
    const reply = formatCoachDisplay(result, { stage2: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  let reply = formatCoachDisplay(result);
  const advance = shouldAdvance(state, prevSubStep, result);

  if (markerWhenAdvance(prevSubStep, result, advance)) {
    const m = markerForSubStep(prevSubStep);
    if (m) reply = appendMarker(reply, m);
  }

  if (prevSubStep === "S3_1_BLUEPRINT" && advance) {
    nextState = applyBlueprint(nextState, result);
    autoContinue = true;
  } else if (prevSubStep === "S3_2_MODULE" && nextState.s3) {
    const s3 = { ...nextState.s3 };
    if (result.verdict === "assign") {
      s3.mode = "assign";
      s3.lastAssignText = result.userVisibleText;
      s3.pendingSentence = undefined;
    } else if (result.verdict === "pass") {
      s3.mode = "feedback";
      s3.pendingSentence = userMessage ?? s3.pendingSentence;
    } else {
      s3.mode = result.verdict === "coach" ? "coach" : "assign";
      s3.pendingSentence = undefined;
    }
    nextState = { ...nextState, s3 };
  } else if (prevSubStep === "S3_3_BODY_CHECK") {
    if (result.verdict === "pass" && advance) {
      const integrated =
        result.integratedBodyText ??
        integrateBodySentences(nextState, nextState.s3!.currentBody);
      nextState = afterBodyCheck(
        {
          ...nextState,
          s3: {
            ...nextState.s3!,
            integratedBodies: {
              ...nextState.s3!.integratedBodies,
              ...(nextState.s3!.currentBody !== "conclusion"
                ? { [nextState.s3!.currentBody]: integrated }
                : {}),
            },
          },
        },
        { ...result, integratedBodyText: integrated },
      );
      autoContinue = nextState.subStep === "S3_2_MODULE";
    } else if (result.verdict === "fail" || result.verdict === "coach") {
      nextState = afterBodyCheck(nextState, result);
    }
  }

  nextState = appendChat(nextState, "assistant", reply);
  return { reply, state: nextState, autoContinue };
}

export async function handleInit(state: SessionState): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const opening = STAGE1_OPENING;
  const s = appendChat(
    { ...s0, subStep: "S1_EVAL" as SessionState["subStep"] },
    "assistant",
    opening,
  );
  return {
    replies: [opening],
    state: s,
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleConfirmChainProposal(
  state: SessionState,
  body: WorkshopBodyKey,
): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const seg = body === "body1" ? s0.s2?.body1 : s0.s2?.body2;
  const proposal = seg?.chainProposal;

  if (!proposal || seg?.chainPhase !== "proposed") {
    return {
      replies: ["请先与教练聊清论证，待左侧出现「教练整理链条」后再确认。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = applyChainProposalToState(s0, body, proposal);
  const logicKey = body === "body1" ? "body1Logic" : "body2Logic";
  const synthetic: LlmTurnResult = {
    verdict: "pass",
    advance: true,
    userVisibleText: "",
    logicBreakdown: logicBreakdownFromProposal(proposal, body),
    extracted: {
      [logicKey]: {
        primaryDriver: "causal",
        slots: proposal.slots,
        missing: [],
        raw: proposal.draft,
      },
    },
  };

  const replies: string[] = [];

  if (body === "body1") {
    s = applyStage2Body1Advance(s, synthetic, proposal.draft);
    const reply = `Body1 论证链已确认。${bodyTaskAfterBody1()}`;
    replies.push(reply);
    s = appendChat(s, "assistant", reply);
    return {
      replies,
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyStage2Body2Advance(s, synthetic, proposal.draft);
  let reply = "Body2 论证链已确认，正在准备逐句写作…";
  replies.push(reply);
  s = appendChat(s, "assistant", reply);

  const bp = await processLlmTurn(s, "P3_1");
  replies.push(bp.reply);
  s = bp.state;

  if (bp.autoContinue && s.subStep === "S3_2_MODULE") {
    const next = await processLlmTurn(s, "P3_2");
    replies.push(next.reply);
    s = next.state;
  }

  return {
    replies,
    state: s,
    requiresConfirm: false,
    canSubmit: s.subStep !== "COMPLETED",
  };
}

export async function handleConfirmHandoffProposal(
  state: SessionState,
): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const proposal = s0.handoffProposal;
  if (!proposal) {
    return {
      replies: ["还没有可确认的整理，请继续在右侧聊审题。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  const s: SessionState = {
    ...s0,
    handoff: { ...proposal },
    handoffProposal: undefined,
    coachContext: {
      ...s0.coachContext,
      handoffPhase: "editing",
      readyForHandoff: true,
    },
  };
  const reply =
    "已按整理填入左侧定稿，请检查各栏（可改几个字），无误后点「提交审题定稿」。";
  return {
    replies: [reply],
    state: appendChat(s, "assistant", reply),
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleSubmitHandoff(
  state: SessionState,
  handoff: Stage1Handoff,
): Promise<TurnResponse> {
  let s = ensureMigrated({ ...state, handoff });

  const v = validateHandoff(handoff);
  if (!v.ok) {
    return {
      replies: [v.errors.join("；")],
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  const rules = ruleHintsForHandoff(handoff);
  if (rules.blockAdvance) {
    return {
      replies: [
        `请先调整审题定稿：${rules.warnings.join(" ")}`,
      ],
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyHandoffToState(s, handoff);

  let result: LlmTurnResult;
  try {
    result = await runPrompt(s, "P1H", {
      query: s.topic,
      handoff_json: JSON.stringify(handoff),
      s1_json: JSON.stringify(s.s1 ?? {}),
      state_summary: stateSummary(s),
    });
  } catch {
    result = {
      verdict: "pass",
      advance: true,
      userVisibleText: `审题定稿已收到。${bodyTaskAfterHandoff(s)}`,
    };
  }

  if (!shouldAdvance(s, "S1_EVAL", result)) {
    const reply = formatCoachDisplay({
      ...result,
      advance: false,
    });
    return {
      replies: [reply],
      state: appendChat(s, "assistant", reply),
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyHandoffAdvance(s);
  const reply = `${formatCoachDisplay(result)}\n\n${bodyTaskAfterHandoff(s)}`;
  s = appendChat(s, "assistant", reply);

  return {
    replies: [reply],
    state: s,
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleTurn(
  state: SessionState,
  message: string,
): Promise<TurnResponse> {
  const replies: string[] = [];
  let s = ensureMigrated(state);
  s = appendChat(s, "user", message);
  const moduleId = resolvePromptModule(s);

  if (moduleId === "OPENING" || moduleId === "NONE") {
    return {
      replies: ["训练已完成或未初始化。"],
      state: s,
      requiresConfirm: false,
      canSubmit: false,
    };
  }

  if (s.subStep === "COMPLETED") {
    return {
      replies: ["恭喜，本篇特训已完成！可重新开始新题目。"],
      state: s,
      requiresConfirm: false,
      canSubmit: false,
    };
  }

  if (s.subStep === "S3_2_MODULE" && s.s3?.mode === "assign") {
    const v = validateUserSentence(message);
    if (!v.ok) {
      return {
        replies: [v.error!],
        state: s,
        requiresConfirm: false,
        canSubmit: true,
      };
    }
    s = {
      ...s,
      s3: { ...s.s3!, mode: "feedback", pendingSentence: message },
    };
    const { reply, state: ns } = await processLlmTurn(s, "P3_2", message);
    replies.push(reply);
    const requiresConfirm =
      ns.subStep === "S3_2_MODULE" &&
      ns.s3?.mode === "feedback" &&
      !!ns.s3.pendingSentence;
    return {
      replies,
      state: ns,
      requiresConfirm,
      canSubmit: !requiresConfirm,
    };
  }

  if (s.subStep === "S3_2_MODULE" && s.s3?.mode === "feedback") {
    const v = validateUserSentence(message);
    if (!v.ok) {
      return {
        replies: [v.error!],
        state: s,
        requiresConfirm: false,
        canSubmit: true,
      };
    }
  }

  let auto = true;
  let guard = 0;
  while (auto && guard < 4) {
    guard++;
    const currentModule = resolvePromptModule(s);
    if (currentModule === "NONE" || currentModule === "OPENING") break;

    if (
      currentModule === "P3_2" &&
      s.s3?.mode === "assign" &&
      guard > 1 &&
      s.s3.lastAssignText
    ) {
      break;
    }

    const needsUser =
      s.subStep !== "S3_1_BLUEPRINT" &&
      !(s.subStep === "S3_2_MODULE" && s.s3?.mode === "assign" && guard > 1);

    const userMsg =
      s.subStep === "S3_2_MODULE" && s.s3?.mode === "feedback"
        ? message
        : guard === 1
          ? message
          : undefined;

    if (needsUser && guard > 1) break;

    const { reply, state: ns, autoContinue } = await processLlmTurn(
      s,
      currentModule as PromptModuleId,
      userMsg,
    );
    replies.push(reply);
    s = ns;
    auto = autoContinue;
  }

  const requiresConfirm =
    s.subStep === "S3_2_MODULE" && s.s3?.mode === "feedback" && !!s.s3.pendingSentence;

  return {
    replies,
    state: s,
    requiresConfirm,
    canSubmit: !requiresConfirm && s.subStep !== "COMPLETED",
  };
}

export async function handleConfirm(state: SessionState): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  if (s0.subStep !== "S3_2_MODULE" || !s0.s3?.pendingSentence) {
    return {
      replies: ["当前无需确认。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = advanceModuleAfterPass(s0);
  const replies: string[] = [];

  if (s.subStep === "S3_3_BODY_CHECK") {
    const { reply, state: ns, autoContinue } = await processLlmTurn(s, "P3_3");
    replies.push(reply);
    s = ns;
    if (autoContinue && s.subStep === "S3_2_MODULE") {
      const next = await processLlmTurn(s, "P3_2");
      replies.push(next.reply);
      s = next.state;
    }
  } else if (s.subStep === "S3_2_MODULE") {
    const { reply, state: ns } = await processLlmTurn(s, "P3_2");
    replies.push(reply);
    s = ns;
  }

  return {
    replies,
    state: s,
    requiresConfirm: false,
    canSubmit: s.subStep !== "COMPLETED",
  };
}
