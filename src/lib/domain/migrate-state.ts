import { defaultBodySegment } from "./handoff";
import type { SessionState } from "./types";

/** Conclusion 段已简化为只做 conclusion_restate。
 *  老 session 的 modulePlan.conclusion 可能含 "conclusion_summary"——
 *  在每次 migrate 入口（无论 version）都做一次幂等清理，避免遗留 module
 *  让 stage 3 进入死路径。 */
function pruneLegacyConclusionSummary(state: SessionState): void {
  const plan = state.s3?.modulePlan;
  if (plan && Array.isArray(plan.conclusion)) {
    const filtered = plan.conclusion.filter(
      (m): m is "conclusion_restate" | "evaluation" =>
        m !== ("conclusion_summary" as unknown as typeof m),
    );
    plan.conclusion = filtered.length > 0 ? filtered : ["conclusion_restate"];
  }
  const bp = state.s3?.blueprint?.conclusion as
    | { restateDirection?: string; summaryLogicDirection?: unknown }
    | undefined;
  if (bp && "summaryLogicDirection" in bp) {
    delete bp.summaryLogicDirection;
  }
}

/** 将旧版 state 升级到 v2 */
export function migrateSessionState(raw: SessionState): SessionState {
  if ((raw as SessionState).version === 2) {
    pruneLegacyConclusionSummary(raw);
    return raw;
  }

  const s = { ...raw, version: 2 as const };

  if (!s.handoff && s.s1) {
    s.handoff = {
      taskUnderstanding: s.s1.taskUnderstanding ?? "",
      position: s.s1.position ?? "",
      body1Point: s.s2?.body1Point ?? "",
      body1Angle: s.s2?.body1Angle ?? "",
      body2Point: s.s2?.body2Point ?? "",
      body2Angle: s.s2?.body2Angle ?? "",
      questionType: s.s1.questionType ?? "",
    };
  }

  const sub = s.subStep as string;
  if (sub === "S2_1_SUBPOINTS") {
    s.subStep = s.handoffLocked ? "S2_2_BODY1" : "S1_EVAL";
  }

  if (s.s2) {
    const b1 = s.s2.body1 ?? {
      ...defaultBodySegment(),
      draft: s.s2.body1Logic?.raw ?? "",
      slots: s.s2.body1Logic?.slots,
      status: s.markers.subBody1Pass ? "ready" : "coaching",
    };
    const b2 = s.s2.body2 ?? {
      ...defaultBodySegment(),
      draft: s.s2.body2Logic?.raw ?? "",
      slots: s.s2.body2Logic?.slots,
      status: s.markers.stage2Pass ? "ready" : "coaching",
    };
    if (!b1.chainPhase) {
      b1.chainPhase = b1.status === "ready" ? "locked" : "coaching";
    }
    if (!b2.chainPhase) {
      b2.chainPhase = b2.status === "ready" ? "locked" : "coaching";
    }
    s.s2 = {
      ...s.s2,
      body1Angle: s.s2.body1Angle ?? "",
      body2Angle: s.s2.body2Angle ?? "",
      body1: b1,
      body2: b2,
    };
  }

  if (s.markers.stage1Pass && !s.handoffLocked) {
    s.handoffLocked = true;
  }

  pruneLegacyConclusionSummary(s);
  return s;
}
