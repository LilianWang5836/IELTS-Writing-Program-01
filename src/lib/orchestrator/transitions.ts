import { buildBlueprintFromStage2 } from "@/lib/domain/blueprint-from-s2";
import { defaultBodySegment } from "@/lib/domain/handoff";
import { MARKERS } from "@/lib/domain/constants";
import {
  compileModulePlan,
  getCurrentModule,
  moduleKey,
} from "@/lib/domain/module-compiler";
import type {
  BodyKey,
  Blueprint,
  BodySegment,
  LogicFill,
  LlmTurnResult,
  ModuleId,
  QuestionType,
  SessionState,
} from "@/lib/domain/types";

function readBodyLogic(
  result: LlmTurnResult,
  key: "body1Logic" | "body2Logic",
  fallbackRaw: string,
): LogicFill {
  const fromExtract =
    (result.extracted as Record<string, LogicFill | undefined>)?.[key];
  const fromBreakdown = result.logicBreakdown?.slots;
  return {
    primaryDriver: fromExtract?.primaryDriver ?? "causal",
    slots: fromExtract?.slots ?? fromBreakdown,
    missing: fromExtract?.missing ?? result.logicBreakdown?.missing,
    raw: fromExtract?.raw?.trim() || fallbackRaw,
  };
}

function nextBody(body: BodyKey): BodyKey | null {
  if (body === "body1") return "body2";
  if (body === "body2") return "conclusion";
  return null;
}

const BODY1_TASK =
  "我们一起搭 Body1 论证链（论点→原因→例子→扣题），请按教练当前环节在右侧补充；齐了之后左侧确认链条。";
const BODY2_TASK =
  "我们一起搭 Body2 论证链；注意与 Body1 不同角度，按教练环节逐环补充。";

export function applyHandoffAdvance(state: SessionState): SessionState {
  const h = state.handoff!;
  const prev = state.s2;
  return {
    ...state,
    stage: 2,
    subStep: "S2_2_BODY1",
    markers: {
      ...state.markers,
      stage1Pass: true,
      subPointsPass: true,
    },
    s2: {
      body1Point: h.body1Point,
      body2Point: h.body2Point,
      body1Angle: h.body1Angle,
      body2Angle: h.body2Angle,
      body1:
        prev?.body1?.chainPhase === "locked" ? prev.body1 : defaultBodySegment(),
      body2:
        prev?.body2?.chainPhase === "locked" ? prev.body2 : defaultBodySegment(),
    },
  };
}

export function applyStage2Body1Advance(
  state: SessionState,
  result: LlmTurnResult,
  userMessage?: string,
): SessionState {
  const logic = readBodyLogic(result, "body1Logic", userMessage ?? "");
  const body1: BodySegment = {
    status: "ready",
    draft: state.s2?.body1.draft ?? userMessage ?? "",
    chainSummary: result.logicBreakdown?.chainSummary,
    slots: logic.slots,
    openIssues: [],
  };
  return {
    ...state,
    subStep: "S2_3_BODY2",
    markers: { ...state.markers, subBody1Pass: true },
    coachContext: {},
    s2: {
      ...state.s2!,
      body1,
      body1Logic: logic,
    },
  };
}

export function applyStage2Body2Advance(
  state: SessionState,
  result: LlmTurnResult,
  userMessage?: string,
): SessionState {
  const logic = readBodyLogic(result, "body2Logic", userMessage ?? "");
  const body2: BodySegment = {
    status: "ready",
    draft: state.s2?.body2.draft ?? userMessage ?? "",
    chainSummary: result.logicBreakdown?.chainSummary,
    slots: logic.slots,
    openIssues: [],
  };
  return {
    ...state,
    stage: 3,
    subStep: "S3_1_BLUEPRINT",
    markers: { ...state.markers, stage2Pass: true },
    coachContext: {},
    s2: {
      ...state.s2!,
      body2,
      body2Logic: logic,
    },
  };
}

export function applyBlueprint(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const blueprint =
    (result.blueprint as Blueprint | undefined) ??
    buildBlueprintFromStage2(state);
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
): string | null {
  switch (subStep) {
    case "S1_EVAL":
      return MARKERS.STAGE_1_PASS;
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

export function bodyTaskAfterHandoff(): string {
  return BODY1_TASK;
}

export function bodyTaskAfterBody1(): string {
  return BODY2_TASK;
}

export function mergeS1FromResult(
  state: SessionState,
  result: LlmTurnResult,
): SessionState {
  const ex = result.extracted as Record<string, string> | undefined;
  if (!ex) return state;
  return {
    ...state,
    s1: {
      questionType: String(ex.questionType ?? state.s1?.questionType ?? ""),
      taskUnderstanding: String(
        ex.taskUnderstanding ?? state.s1?.taskUnderstanding ?? "",
      ),
      position: String(ex.position ?? state.s1?.position ?? ""),
    },
    handoff: {
      ...(state.handoff ?? {
        taskUnderstanding: "",
        position: "",
        body1Point: "",
        body1Angle: "",
        body2Point: "",
        body2Angle: "",
      }),
      questionType: String(ex.questionType ?? state.handoff?.questionType ?? ""),
      taskUnderstanding:
        state.handoff?.taskUnderstanding ||
        String(ex.taskUnderstanding ?? ""),
      position: state.handoff?.position || String(ex.position ?? ""),
    },
  };
}

function appendDraft(prev: string, userMessage?: string): string {
  const next = userMessage?.trim() ?? "";
  if (!next) return prev.trim();
  const p = prev.trim();
  if (!p) return next;
  if (p.includes(next) || next.includes(p)) return p.length >= next.length ? p : next;
  return `${p}\n${next}`;
}

export function applyBodyCoachUpdate(
  state: SessionState,
  body: "body1" | "body2",
  result: LlmTurnResult,
  userMessage?: string,
): SessionState {
  if (!state.s2) return state;
  const seg = body === "body1" ? state.s2.body1 : state.s2.body2;
  const openIssue =
    result.logicBreakdown?.missing?.[0] ??
    result.coachQuestion ??
    result.userVisibleText;
  const updated: BodySegment = {
    ...seg,
    status: "coaching",
    draft: appendDraft(seg.draft, userMessage),
    chainSummary: result.logicBreakdown?.chainSummary ?? seg.chainSummary,
    slots: result.logicBreakdown?.slots ?? seg.slots,
    openIssues: openIssue ? [String(openIssue)] : seg.openIssues,
  };
  return {
    ...state,
    coachContext: {
      lastQuestion: result.coachQuestion,
      openIssue: typeof openIssue === "string" ? openIssue : undefined,
    },
    s2: {
      ...state.s2,
      ...(body === "body1" ? { body1: updated } : { body2: updated }),
    },
  };
}
