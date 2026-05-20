import type { PromptModuleId, SessionState } from "./types";

export function resolvePromptModule(state: SessionState): PromptModuleId | "OPENING" | "NONE" {
  switch (state.subStep) {
    case "S1_AWAIT":
      return "OPENING";
    case "S1_EVAL":
      return "P1";
    case "S2_2_BODY1":
      return "P2_2";
    case "S2_3_BODY2":
      return "P2_3";
    case "S3_1_BLUEPRINT":
      return "P3_1";
    case "S3_2_MODULE":
      return "P3_2";
    case "S3_3_BODY_CHECK":
      return "P3_3";
    default:
      return "NONE";
  }
}

export function stageLabel(state: SessionState): string {
  if (state.stage === 1) return "Stage 1：审题立意";
  if (state.stage === 2) return "Stage 2：主体段论证链";
  return "Stage 3：句子写作";
}

export function defaultHandoffTarget(state: SessionState): import("./types").HandoffFieldTarget {
  if (!state.handoff?.taskUnderstanding?.trim()) return "taskUnderstanding";
  if (!state.handoff?.position?.trim()) return "position";
  if (!state.handoff?.body1Point?.trim()) return "body1Point";
  if (!state.handoff?.body1Angle?.trim()) return "body1Angle";
  if (!state.handoff?.body2Point?.trim()) return "body2Point";
  return "body2Angle";
}
