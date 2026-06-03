/**
 * Stage1 theme resolution — re-exports; semantic pipeline in stage1-theme-projection.
 */
import type { SessionState } from "@/lib/domain/types";
import {
  attachStage1ThemeProjection,
  bootstrapSemanticStateFromRules,
  commitStage1ThemeProjection,
  getStage1ThemeProjection,
  isStage1ProjectionFresh,
  mergeMonotonicSemanticState,
  projectionThemesComplete,
  readStage1ThemeProjection,
  rulesFactsFromUserMessage,
  sanitizeLlmThemeProjection,
  stanceToPositionLean,
  COMMIT_CONFIDENCE_THRESHOLD,
  type LlmSemanticProjectionRaw,
  type LlmThemeProjectionRaw,
} from "@/lib/domain/stage1-theme-projection";
import { userMessages } from "@/lib/domain/essay-substance";
import { enrichStage1ThemeProjection } from "@/lib/domain/stage1-exploration-themes";

export type { Stage1ThemeProjection } from "@/lib/domain/types";
export type {
  Stage1Stance,
  LlmSemanticProjectionRaw,
  LlmThemeProjectionRaw,
} from "@/lib/domain/stage1-theme-projection";

export {
  attachStage1ThemeProjection,
  bootstrapSemanticStateFromRules,
  commitStage1ThemeProjection,
  getStage1ThemeProjection,
  isStage1ProjectionFresh,
  mergeMonotonicSemanticState,
  projectionThemesComplete,
  readStage1ThemeProjection,
  rulesFactsFromUserMessage,
  sanitizeLlmThemeProjection,
  stanceToPositionLean,
  COMMIT_CONFIDENCE_THRESHOLD,
};

/** When true, projection uses LLM semantic facts per turn; otherwise rules facts. */
export function isStage1LlmProjectionEnabled(): boolean {
  return process.env.COACH_STAGE1_LLM_PROJECTION === "true";
}

/** @deprecated use getStage1ThemeProjection */
export const resolveStage1ThemeProjection = getStage1ThemeProjection;

/** @deprecated use bootstrapSemanticStateFromRules */
export function projectStage1ThemesFromRules(messages: string[], state?: SessionState) {
  void state;
  return bootstrapSemanticStateFromRules(messages);
}

/** Sync: sequential rules bootstrap + enrich (CI / regression). */
export function syncStage1ThemeProjection(state: SessionState): SessionState {
  if (state.handoffLocked) return state;
  const phase = state.coachContext?.handoffPhase ?? "exploring";
  if (phase === "proposed" || phase === "locked") return state;

  const messages = userMessages(state);
  const existing = readStage1ThemeProjection(state);
  if (
    existing &&
    isStage1ProjectionFresh(state, messages.length) &&
    existing.concepts !== undefined
  ) {
    return state;
  }

  const committed = bootstrapSemanticStateFromRules(messages);
  const enriched = enrichStage1ThemeProjection(committed, state, messages);
  return attachStage1ThemeProjection(state, enriched);
}

/** @deprecated use resolveStage1ThemeProjection */
export const resolveStage1ThemeConcepts = resolveStage1ThemeProjection;
