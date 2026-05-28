import type { SessionState, LlmTurnResult, WorkshopBodyKey } from "@/lib/domain/types";
import {
  applyArbitratedPlanToCoachResult,
  isRuntimePlanEnforcementEnabled,
} from "@/runtime/generation/apply-plan-to-result";
import { finalizeHandoffReviewAsk } from "@/runtime/mode/deterministic-templates";
import { resolveCoachTurnPlan } from "@/runtime/plan/resolve-coach-turn-plan";
import type { ArbitratedTurnPlan } from "@/runtime/types";

/** Overlay runtime plan on LLM coach output (Phase 8). */
export function overlayRuntimePlanOnCoach(
  state: SessionState,
  result: LlmTurnResult,
  userMessage?: string,
  body?: WorkshopBodyKey,
): LlmTurnResult {
  if (!isRuntimePlanEnforcementEnabled()) return result;
  if (
    state.subStep !== "S1_EVAL" &&
    state.subStep !== "S2_2_BODY1" &&
    state.subStep !== "S2_3_BODY2"
  ) {
    return result;
  }
  const plan = resolveCoachTurnPlan(state, userMessage ?? "", { body });
  return applyArbitratedPlanToCoachResult(plan, result);
}

export function resolveCoachTurnPlanForSession(
  state: SessionState,
  userMessage?: string,
  body?: WorkshopBodyKey,
): ArbitratedTurnPlan | null {
  if (!isRuntimePlanEnforcementEnabled()) return null;
  if (
    state.subStep !== "S1_EVAL" &&
    state.subStep !== "S2_2_BODY1" &&
    state.subStep !== "S2_3_BODY2"
  ) {
    return null;
  }
  return resolveCoachTurnPlan(state, userMessage ?? "", { body });
}

/** Prefer plan coachQuestion; fall back to legacy rule/template ask. */
export function planCoachAsk(
  state: SessionState,
  result: LlmTurnResult,
  userMessage: string | undefined,
  legacyAsk: string,
  body?: WorkshopBodyKey,
): string {
  if (!isRuntimePlanEnforcementEnabled()) return legacyAsk;
  const overlay = overlayRuntimePlanOnCoach(state, result, userMessage, body);
  const q = overlay.coachQuestion?.trim();
  if (q) return q;
  if (resolveCoachTurnPlanForSession(state, userMessage, body)?.action === "finalize") {
    const legacy = legacyAsk.trim();
    if (legacy && /六栏|核对|确认整理/.test(legacy)) return legacy;
    return finalizeHandoffReviewAsk();
  }
  return legacyAsk;
}

/** Prefer plan/LLM mirror; fall back to legacy mirror. */
export function planCoachMirror(
  state: SessionState,
  result: LlmTurnResult,
  userMessage: string | undefined,
  legacyMirror: string,
  body?: WorkshopBodyKey,
): string {
  if (!isRuntimePlanEnforcementEnabled()) return legacyMirror;
  const overlay = overlayRuntimePlanOnCoach(state, result, userMessage, body);
  return overlay.mirror?.trim() || result.mirror?.trim() || legacyMirror;
}

/** Stage2: bind plan to mirror/question fields before return. */
export function bindPlanCoachFields(
  state: SessionState,
  result: LlmTurnResult,
  userMessage: string | undefined,
  body: WorkshopBodyKey,
  fields: { mirror: string; coachQuestion: string },
  options?: { keepMirror?: boolean },
): { mirror: string; coachQuestion: string } {
  if (!isRuntimePlanEnforcementEnabled()) return fields;
  const overlay = overlayRuntimePlanOnCoach(state, result, userMessage, body);
  return {
    mirror: options?.keepMirror
      ? fields.mirror
      : overlay.mirror?.trim() || fields.mirror,
    coachQuestion: overlay.coachQuestion?.trim() ?? fields.coachQuestion,
  };
}

export { resolveCoachTurnPlan, isRuntimePlanEnforcementEnabled };
