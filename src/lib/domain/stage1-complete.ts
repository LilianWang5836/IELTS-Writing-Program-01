/**
 * Stage1 exploration completion — benefit + drawback collected (minimal gate).
 */
import {
  committedConceptIds,
  decideStage1Plan,
} from "./stage1-plan";
import { readStage1ThemeProjection } from "@/lib/domain/stage1-theme-projection";
import type { SessionState, Stage1ThemeProjection } from "./types";

export function isStage1ProjectionComplete(
  projection: Stage1ThemeProjection | null | undefined,
): boolean {
  const { benefits, drawbacks } = committedConceptIds(projection);
  return benefits.length >= 1 && drawbacks.length >= 1;
}

export function isStage1Complete(
  state: SessionState,
  _userMessages?: string[],
): boolean {
  return decideStage1Plan(state) === "finalize";
}
