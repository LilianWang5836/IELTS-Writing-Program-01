import type { Blueprint, SessionState } from "./types";

/** Stage 2 定稿链条 → Stage 3 轻量 Blueprint（P2） */
export function buildBlueprintFromStage2(state: SessionState): Blueprint {
  const h = state.handoff;
  const s2 = state.s2;
  const b1Slots = s2?.body1?.slots ?? s2?.body1Logic?.slots;
  const b2Slots = s2?.body2?.slots ?? s2?.body2Logic?.slots;

  const dir = (point: string, slots?: { reason?: string | null; example?: string | null; elaboration?: string | null }) => ({
    claimDirection: `Express the claim: ${point}`,
    reasonDirection: slots?.reason
      ? `Explain why: ${slots.reason}`
      : slots?.elaboration
        ? `Develop mechanism: ${slots.elaboration}`
        : "Explain why this claim holds",
    supportDirection: slots?.example
      ? `Give concrete support: ${slots.example}`
      : "Add example or evidence from your chain",
  });

  return {
    body1: {
      coreIdea: s2?.body1Point ?? h?.body1Point ?? "body1",
      logicFlow: dir(s2?.body1Point ?? "", b1Slots ?? undefined),
    },
    body2: {
      coreIdea: s2?.body2Point ?? h?.body2Point ?? "body2",
      logicFlow: dir(s2?.body2Point ?? "", b2Slots ?? undefined),
    },
    conclusion: {
      restateDirection: `Restate position: ${h?.position ?? s2?.body1Point ?? ""}`,
      summaryLogicDirection: `Link Body1 (${s2?.body1Angle}) and Body2 (${s2?.body2Angle})`,
    },
  };
}
