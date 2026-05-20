import { defaultBodySegment } from "./handoff";
import type { SessionState } from "./types";

/** 将旧版 state 升级到 v2 */
export function migrateSessionState(raw: SessionState): SessionState {
  if ((raw as SessionState).version === 2) return raw;

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

  return s;
}
