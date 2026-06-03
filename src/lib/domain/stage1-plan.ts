/**
 * Stage1 deterministic PLAN — system decides next step; LLM only extracts + verbalizes.
 */
import { readStage1ThemeProjection } from "@/lib/domain/stage1-theme-projection";
import { finalizeHandoffReviewAsk } from "@/runtime/mode/deterministic-templates";
import type { SessionState, Stage1ThemeProjection } from "./types";
import type { Stage1CoachGap } from "./stage1-coach-gap";

export type Stage1PlanAction =
  | "finalize"
  | "collect_drawback"
  | "collect_benefit";

const IMPLICIT_PLACEHOLDERS = new Set(["implicit_benefit", "implicit_drawback"]);

export function committedConceptIds(
  projection: Stage1ThemeProjection | null | undefined,
): { benefits: string[]; drawbacks: string[] } {
  if (!projection) return { benefits: [], drawbacks: [] };
  const benefits = (
    projection.benefit?.length ? projection.benefit : (projection.benefits ?? [])
  ).filter((b) => !IMPLICIT_PLACEHOLDERS.has(b));
  const drawbacks = (
    projection.drawback?.length ? projection.drawback : (projection.drawbacks ?? [])
  ).filter((d) => !IMPLICIT_PLACEHOLDERS.has(d));
  return { benefits, drawbacks };
}

/** Deterministic PLAN — no deepen / explain / follow-up chains. */
export function decideStage1Plan(state: SessionState): Stage1PlanAction {
  const { benefits, drawbacks } = committedConceptIds(
    readStage1ThemeProjection(state),
  );
  if (benefits.length >= 1 && drawbacks.length >= 1) return "finalize";
  if (benefits.length >= 1 && drawbacks.length === 0) return "collect_drawback";
  return "collect_benefit";
}

export function stage1PlanToCoachGap(action: Stage1PlanAction): Stage1CoachGap {
  switch (action) {
    case "finalize":
      return { gapType: "confirm_structure", action: "finalize" };
    case "collect_drawback":
      return { gapType: "collect_drawback", action: "coach", side: "drawback" };
    default:
      return { gapType: "collect_benefit", action: "coach", side: "benefit" };
  }
}

export function stage1PlanQuestion(action: Stage1PlanAction): string {
  switch (action) {
    case "collect_benefit":
      return "这个现象带来了什么主要好处？";
    case "collect_drawback":
      return "那这个现象有没有什么潜在的坏处或负面影响？";
    case "finalize":
      return finalizeHandoffReviewAsk();
  }
}

export function formatStage1PlanIntentHint(
  action: Stage1PlanAction,
  state: SessionState,
): string {
  const gap = stage1PlanToCoachGap(action);
  const { benefits, drawbacks } = committedConceptIds(
    readStage1ThemeProjection(state),
  );
  return JSON.stringify({
    stage1PlanAction: action,
    gapType: gap.gapType,
    committedBenefits: benefits,
    committedDrawbacks: drawbacks,
    topic: (state.topic ?? "").trim().slice(0, 200),
  });
}

export function parseStage1PlanAction(intentHint: string): Stage1PlanAction | null {
  if (!intentHint.trim()) return null;
  try {
    const parsed = JSON.parse(intentHint) as { stage1PlanAction?: string };
    const action = parsed.stage1PlanAction;
    if (
      action === "finalize" ||
      action === "collect_drawback" ||
      action === "collect_benefit"
    ) {
      return action;
    }
  } catch {
    /* ignore */
  }
  return null;
}
