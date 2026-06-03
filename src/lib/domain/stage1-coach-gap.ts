/**
 * Stage1 PLAN layer — gap types and collection-phase decisions (no NL generation).
 */
import type { SessionState } from "./types";
import { isSemanticToken } from "@/runtime/semantic/semantic-projection";
import type { ExplorationThemes } from "./stage1-exploration-themes";

export type Stage1CoachGapType =
  | "none"
  | "collect_benefit"
  | "collect_drawback"
  | "collect_stance"
  | "deepen_body1"
  | "deepen_body2"
  | "confirm_structure";

export type Stage1CoachGapAction = "coach" | "ask_refinement" | "finalize";

export interface Stage1CoachGap {
  gapType: Stage1CoachGapType;
  action: Stage1CoachGapAction;
  targetBody?: "body1" | "body2";
  side?: "benefit" | "drawback";
}

export function hasConcreteBenefitConcepts(benefits: string[]): boolean {
  return benefits.some((b) => !isSemanticToken(b));
}

export function hasConcreteDrawbackConcepts(drawbacks: string[]): boolean {
  return drawbacks.some((d) => !isSemanticToken(d));
}

/** Collection / stance gaps only (no body-refinement dependency). */
export function resolveStage1CollectionGap(
  themes: ExplorationThemes,
): Stage1CoachGap {
  if (themes.readyToFinalize) {
    return { gapType: "confirm_structure", action: "finalize" };
  }

  const hasBenefit = hasConcreteBenefitConcepts(themes.benefits);
  const hasDrawback = hasConcreteDrawbackConcepts(themes.drawbacks);
  const hasStance = themes.positionLean !== "unknown";

  if (!hasStance) {
    return { gapType: "collect_stance", action: "coach" };
  }
  if (!hasBenefit) {
    return { gapType: "collect_benefit", action: "coach", side: "benefit" };
  }
  if (!hasDrawback) {
    return { gapType: "collect_drawback", action: "coach", side: "drawback" };
  }

  return { gapType: "none", action: "coach" };
}

/** Machine-readable hint for LLM / policy — no domain vocabulary. */
export function formatStage1IntentHint(
  gap: Stage1CoachGap,
  state: SessionState,
  themes: ExplorationThemes,
): string {
  return JSON.stringify({
    gapType: gap.gapType,
    action: gap.action,
    targetBody: gap.targetBody ?? null,
    side: gap.side ?? null,
    topic: (state.topic ?? "").trim().slice(0, 200),
    positionLean: themes.positionLean,
    committedBenefits: themes.benefits.filter((b) => !isSemanticToken(b)),
    committedDrawbacks: themes.drawbacks.filter((d) => !isSemanticToken(d)),
    implicitBenefitOnly:
      themes.benefits.some((b) => isSemanticToken(b)) &&
      !hasConcreteBenefitConcepts(themes.benefits),
  });
}

/** Factual memory block for coach prompt — no coaching templates. */
export function formatStage1GapMemorySummary(
  gap: Stage1CoachGap,
  themes: ExplorationThemes,
): string {
  const lines: string[] = [];
  if (themes.positionLean !== "unknown") {
    lines.push(`立场倾向：${themes.positionLean}`);
  }
  const realB = themes.benefits.filter((b) => !isSemanticToken(b));
  const realD = themes.drawbacks.filter((d) => !isSemanticToken(d));
  if (realB.length) lines.push(`已 commit 好处 concept：${realB.join("；")}`);
  if (realD.length) lines.push(`已 commit 坏处 concept：${realD.join("；")}`);
  if (
    themes.benefits.some((b) => isSemanticToken(b)) &&
    !hasConcreteBenefitConcepts(themes.benefits)
  ) {
    lines.push("系统：仅有立场占位，尚无具体好处 concept");
  }
  if (gap.gapType !== "none") {
    lines.push(`本轮 PLAN 缺口：${gap.gapType}`);
  }
  return lines.join("\n");
}
