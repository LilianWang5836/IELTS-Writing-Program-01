/**
 * Stage1 exploration completion — benefit + drawback collected (minimal gate).
 */
import { readStage1ThemeProjection } from "@/lib/domain/stage1-theme-projection";
import type { SessionState, Stage1ThemeProjection } from "./types";

const IMPLICIT_PLACEHOLDERS = new Set(["implicit_benefit", "implicit_drawback"]);

function committedBenefits(projection: Stage1ThemeProjection): string[] {
  return projection.benefit?.length
    ? projection.benefit
    : (projection.benefits ?? []);
}

function committedDrawbacks(projection: Stage1ThemeProjection): string[] {
  return projection.drawback?.length
    ? projection.drawback
    : (projection.drawbacks ?? []);
}

export function isStage1ProjectionComplete(
  projection: Stage1ThemeProjection | null | undefined,
): boolean {
  if (!projection) return false;
  const benefits = committedBenefits(projection).filter(
    (b) => !IMPLICIT_PLACEHOLDERS.has(b),
  );
  const drawbacks = committedDrawbacks(projection).filter(
    (d) => !IMPLICIT_PLACEHOLDERS.has(d),
  );
  return benefits.length >= 1 && drawbacks.length >= 1;
}

export function isStage1Complete(
  state: SessionState,
  _userMessages?: string[],
): boolean {
  return isStage1ProjectionComplete(readStage1ThemeProjection(state));
}
