import { MARKERS } from "@/lib/domain/constants";
import {
  compileModulePlan,
  getCurrentModule,
  moduleKey,
} from "@/lib/domain/module-compiler";
import type {
  BodyKey,
  Blueprint,
  LlmTurnResult,
  ModuleId,
  QuestionType,
  SessionState,
} from "@/lib/domain/types";

function nextBody(body: BodyKey): BodyKey | null {
  if (body === "body1") return "body2";
  if (body === "body2") return "conclusion";
  return null;
}

export function applyStage1Pass(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const ex = result.extracted as Record<string, string> | undefined;
  return {
    ...state,
    stage: 2,
    subStep: "S2_1_SUBPOINTS",
    markers: { ...state.markers, stage1Pass: true },
    s1: ex
      ? {
          questionType: String(ex.questionType ?? ""),
          taskUnderstanding: String(ex.taskUnderstanding ?? ""),
          position: String(ex.position ?? ""),
        }
      : state.s1,
  };
}

export function applyStage2_1Pass(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const ex = result.extracted as { body1Point?: string; body2Point?: string };
  return {
    ...state,
    subStep: "S2_2_BODY1",
    markers: { ...state.markers, subPointsPass: true },
    s2: {
      body1Point: String(ex?.body1Point ?? ""),
      body2Point: String(ex?.body2Point ?? ""),
      ...state.s2,
    },
  };
}

export function applyStage2_2Pass(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const raw =
    (result.extracted as { body1Logic?: { raw?: string } })?.body1Logic?.raw ??
    "";
  return {
    ...state,
    subStep: "S2_3_BODY2",
    markers: { ...state.markers, subBody1Pass: true },
    s2: {
      ...state.s2!,
      body1Logic: { raw, primaryDriver: "causal" },
    },
  };
}

export function applyStage2_3Pass(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const raw =
    (result.extracted as { body2Logic?: { raw?: string } })?.body2Logic?.raw ??
    "";
  return {
    ...state,
    stage: 3,
    subStep: "S3_1_BLUEPRINT",
    markers: { ...state.markers, stage2Pass: true },
    s2: {
      ...state.s2!,
      body2Logic: { raw, primaryDriver: "causal" },
    },
  };
}

export function applyBlueprint(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const blueprint = result.blueprint as Blueprint | undefined;
  const planFromLlm = result.modulePlan;
  const qType = (state.s1?.questionType ?? "unknown") as QuestionType;
  const modulePlan = planFromLlm ?? compileModulePlan(qType);

  return {
    ...state,
    subStep: "S3_2_MODULE",
    s3: {
      blueprint,
      modulePlan,
      currentBody: "body1",
      moduleIndex: 0,
      mode: "assign",
      confirmedSentences: {},
      integratedBodies: {},
    },
  };
}

export function appendMarker(reply: string, marker: string): string {
  if (reply.includes(marker)) return reply;
  return `${reply}\n${marker}`;
}

export function markerForSubStep(
  subStep: SessionState["subStep"],
  verdict: string,
): string | null {
  if (verdict !== "pass") return null;
  switch (subStep) {
    case "S1_EVAL":
      return MARKERS.STAGE_1_PASS;
    case "S2_1_SUBPOINTS":
      return MARKERS.SUB_POINTS_PASS;
    case "S2_2_BODY1":
      return MARKERS.SUB_BODY_1_PASS;
    case "S2_3_BODY2":
      return MARKERS.STAGE_2_PASS;
    default:
      return null;
  }
}

export function advanceModuleAfterPass(state: SessionState): SessionState {
  if (!state.s3) return state;
  const s3 = { ...state.s3 };
  const body = s3.currentBody;
  const mod = getCurrentModule(s3.modulePlan, body, s3.moduleIndex);
  if (!mod) return state;

  const key = moduleKey(body, mod);
  const sentence = s3.pendingSentence ?? "";
  const existing = s3.confirmedSentences[key] ?? [];
  s3.confirmedSentences = {
    ...s3.confirmedSentences,
    [key]: [...existing, sentence],
  };
  s3.pendingSentence = undefined;
  s3.moduleIndex += 1;
  s3.mode = "assign";
  s3.lastAssignText = undefined;

  const nextMod = getCurrentModule(s3.modulePlan, body, s3.moduleIndex);
  if (nextMod) {
    return { ...state, subStep: "S3_2_MODULE", s3 };
  }
  return { ...state, subStep: "S3_3_BODY_CHECK", s3 };
}

export function afterBodyCheck(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  if (!state.s3) return state;
  const s3 = { ...state.s3 };

  if (result.verdict === "fail" && result.action === "append_sentence") {
    const gap = (result.missingGap ?? "reason") as ModuleId;
    const list = [...(s3.modulePlan[s3.currentBody] ?? [])];
    list.push(gap);
    s3.modulePlan = { ...s3.modulePlan, [s3.currentBody]: list };
    s3.moduleIndex = list.length - 1;
    s3.mode = "assign";
    return { ...state, subStep: "S3_2_MODULE", s3 };
  }

  if (result.integratedBodyText && s3.currentBody !== "conclusion") {
    s3.integratedBodies = {
      ...s3.integratedBodies,
      [s3.currentBody]: result.integratedBodyText,
    };
  }

  if (s3.currentBody === "conclusion" && result.integratedBodyText) {
    s3.conclusionText = result.integratedBodyText;
  }

  const nb = nextBody(s3.currentBody);
  if (nb) {
    s3.currentBody = nb;
    s3.moduleIndex = 0;
    s3.mode = "assign";
    return { ...state, subStep: "S3_2_MODULE", s3 };
  }

  return { ...state, subStep: "COMPLETED", s3 };
}

export function integrateBodySentences(state: SessionState, body: BodyKey): string {
  if (!state.s3) return "";
  const modules = state.s3.modulePlan[body] ?? [];
  const parts: string[] = [];
  for (const mod of modules) {
    const key = moduleKey(body, mod);
    const lines = state.s3.confirmedSentences[key];
    if (lines?.length) parts.push(lines.join(" "));
  }
  return parts.join(" ");
}
