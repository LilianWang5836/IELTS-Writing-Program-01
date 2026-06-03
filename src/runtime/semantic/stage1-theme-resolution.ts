/**
 * Stage1 theme resolution — re-exports; STATE commit lives in stage1-theme-projection.
 */
import type { SessionState } from "@/lib/domain/types";
import {
  attachStage1ThemeProjection,
  commitStage1ThemeProjection,
  getStage1ThemeProjection,
  isStage1ProjectionFresh,
  projectionThemesComplete,
  readStage1ThemeProjection,
  resolveStage1ThemeProjection,
  sanitizeLlmThemeProjection,
  stanceToPositionLean,
  type LlmThemeProjectionRaw,
} from "@/lib/domain/stage1-theme-projection";
import { userMessages } from "@/lib/domain/essay-substance";
import { enrichStage1ThemeProjection } from "@/lib/domain/stage1-exploration-themes";

export type { Stage1ThemeProjection } from "@/lib/domain/types";
export type { Stage1Stance, LlmThemeProjectionRaw } from "@/lib/domain/stage1-theme-projection";

export {
  attachStage1ThemeProjection,
  commitStage1ThemeProjection,
  getStage1ThemeProjection,
  isStage1ProjectionFresh,
  projectionThemesComplete,
  readStage1ThemeProjection,
  resolveStage1ThemeProjection,
  sanitizeLlmThemeProjection,
  stanceToPositionLean,
};

/** When true, projection is computed via dedicated LLM call; otherwise rules engine. */
export function isStage1LlmProjectionEnabled(): boolean {
  return process.env.COACH_STAGE1_LLM_PROJECTION === "true";
}

/** @deprecated use resolveStage1ThemeProjection */
export const resolveStage1ThemeConcepts = resolveStage1ThemeProjection;

/** @deprecated use commitStage1ThemeProjection(state, messages, { source: 'rules' }) */
export function projectStage1ThemesFromRules(messages: string[], state?: SessionState) {
  const stubState = state ?? ({ coachContext: {} } as SessionState);
  return commitStage1ThemeProjection(stubState, messages, { source: "rules" });
}

/** Sync: rules commit + enrich (CI, regression scripts, non-LLM path). */
export function syncStage1ThemeProjection(state: SessionState): SessionState {
  if (state.handoffLocked) return state;
  const phase = state.coachContext?.handoffPhase ?? "exploring";
  if (phase === "proposed" || phase === "locked") return state;

  const messages = userMessages(state);
  const existing = readStage1ThemeProjection(state);
  if (
    existing &&
    isStage1ProjectionFresh(state, messages.length) &&
    existing.benefits !== undefined
  ) {
    return state;
  }

  const committed = commitStage1ThemeProjection(state, messages, { source: "rules" });
  const enriched = enrichStage1ThemeProjection(committed, state, messages);
  return attachStage1ThemeProjection(state, enriched);
}
