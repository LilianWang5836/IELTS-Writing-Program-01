import type { PromptModuleId, SessionState } from "./types";

export function resolvePromptModule(state: SessionState): PromptModuleId | "OPENING" | "NONE" {
  switch (state.subStep) {
    case "S1_AWAIT":
      return "OPENING";
    case "S1_EVAL":
      return "P1";
    case "S2_1_SUBPOINTS":
      return "P2_1";
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
  if (state.stage === 2) return "Stage 2：主体段因果金字塔";
  return "Stage 3：句子写作";
}
