import { STAGE1_OPENING, MARKERS, MODULE_LABELS } from "@/lib/domain/constants";
import { getCurrentModule, moduleKey } from "@/lib/domain/module-compiler";
import { resolvePromptModule, stageLabel } from "@/lib/domain/router";
import { appendChat, stateSummary } from "@/lib/domain/state";
import { validateUserSentence } from "@/lib/domain/validate";
import type {
  LlmTurnResult,
  PromptModuleId,
  SessionState,
} from "@/lib/domain/types";
import { callLlm } from "@/lib/llm/client";
import { buildFullPrompt } from "@/lib/prompts/loader";
import {
  afterBodyCheck,
  advanceModuleAfterPass,
  applyBlueprint,
  applyStage1Pass,
  applyStage2_1Pass,
  applyStage2_2Pass,
  applyStage2_3Pass,
  appendMarker,
  integrateBodySentences,
  markerForSubStep,
} from "./transitions";

export interface TurnResponse {
  replies: string[];
  state: SessionState;
  requiresConfirm: boolean;
  canSubmit: boolean;
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
  };

  if (state.s1) {
    base.s1_position = state.s1.position;
    base.s1_json = JSON.stringify(state.s1);
  }
  if (state.s2) {
    base.body1_point = state.s2.body1Point;
    base.body2_point = state.s2.body2Point;
    base.body1_logic = state.s2.body1Logic?.raw ?? "";
    base.s2_json = JSON.stringify(state.s2);
  }
  if (state.s1 && state.subStep === "S2_3_BODY2") {
    base.s1_position = state.s1.position;
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
  const result = await runPrompt(
    state,
    moduleId,
    buildVars(state, userMessage),
    userMessage,
  );

  let reply = result.userVisibleText;
  let nextState = state;
  let autoContinue = false;

  const marker = markerForSubStep(prevSubStep, result.verdict);
  if (marker) reply = appendMarker(reply, marker);

  if (prevSubStep === "S1_EVAL" && result.verdict === "pass") {
    nextState = applyStage1Pass(nextState, result);
  } else if (prevSubStep === "S2_1_SUBPOINTS" && result.verdict === "pass") {
    nextState = applyStage2_1Pass(nextState, result);
  } else if (prevSubStep === "S2_2_BODY1" && result.verdict === "pass") {
    nextState = applyStage2_2Pass(nextState, result);
  } else if (prevSubStep === "S2_3_BODY2" && result.verdict === "pass") {
    nextState = applyStage2_3Pass(nextState, result);
    autoContinue = true;
  } else if (prevSubStep === "S3_1_BLUEPRINT") {
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
    } else if (result.verdict === "fail") {
      s3.mode = "assign";
      s3.pendingSentence = undefined;
    }
    nextState = { ...nextState, s3 };
  } else if (prevSubStep === "S3_3_BODY_CHECK") {
    if (result.verdict === "pass") {
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
    } else {
      nextState = afterBodyCheck(nextState, result);
    }
  }

  nextState = appendChat(nextState, "assistant", reply);
  return { reply, state: nextState, autoContinue };
}

export async function handleInit(state: SessionState): Promise<TurnResponse> {
  const opening = STAGE1_OPENING;
  const s = appendChat(
    { ...state, subStep: "S1_EVAL" as SessionState["subStep"] },
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

export async function handleTurn(
  state: SessionState,
  message: string,
): Promise<TurnResponse> {
  const replies: string[] = [];
  let s = appendChat(state, "user", message);
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

    if (currentModule === "P3_2" && s.s3?.mode === "assign" && guard > 1) break;

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
  if (state.subStep !== "S3_2_MODULE" || !state.s3?.pendingSentence) {
    return {
      replies: ["当前无需确认。"],
      state,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = advanceModuleAfterPass(state);
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
