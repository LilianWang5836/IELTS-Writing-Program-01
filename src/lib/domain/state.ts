import { v4 as uuidv4 } from "uuid";
import { EMPTY_HANDOFF, defaultBodySegment } from "./handoff";
import { formatSlotsBlock } from "./logic-slots";
import type { Question, SessionState, Stage1Handoff } from "./types";

export function createInitialState(question: Question): SessionState {
  return {
    version: 2,
    sessionId: uuidv4(),
    questionId: question.id,
    topic: question.prompt,
    stage: 1,
    subStep: "S1_AWAIT",
    markers: {
      stage1Pass: false,
      subPointsPass: false,
      subBody1Pass: false,
      subBody2Pass: false,
      stage2Pass: false,
    },
    handoff: { ...EMPTY_HANDOFF },
    handoffLocked: false,
    coachContext: { handoffPhase: "exploring" },
    chatHistory: [],
    leftPanelNotes: "",
  };
}

export function stateSummary(state: SessionState): string {
  return JSON.stringify(
    {
      stage: state.stage,
      subStep: state.subStep,
      markers: state.markers,
      handoffLocked: state.handoffLocked,
      handoff: state.handoff,
      coachContext: state.coachContext,
      s1: state.s1,
      s2: state.s2
        ? {
            body1Point: state.s2.body1Point,
            body2Point: state.s2.body2Point,
            body1Angle: state.s2.body1Angle,
            body2Angle: state.s2.body2Angle,
            body1Status: state.s2.body1.status,
            body2Status: state.s2.body2.status,
            body1OpenIssue: state.s2.body1.openIssues?.[0],
            body2OpenIssue: state.s2.body2.openIssues?.[0],
          }
        : undefined,
      s3: state.s3
        ? {
            currentBody: state.s3.currentBody,
            moduleIndex: state.s3.moduleIndex,
            mode: state.s3.mode,
            modulePlan: state.s3.modulePlan,
            confirmedKeys: Object.keys(state.s3.confirmedSentences),
            orchestrator: state.s3.orchestrator,
          }
        : undefined,
    },
    null,
    2,
  );
}

export function appendChat(
  state: SessionState,
  role: "user" | "assistant",
  content: string,
): SessionState {
  return {
    ...state,
    chatHistory: [...state.chatHistory.slice(-40), { role, content }],
  };
}

export function buildLeftPanelText(state: SessionState): string {
  const parts: string[] = [];

  // Stage 1 定稿只在 HandoffEditor 展示，此处不重复
  if (state.handoffLocked && state.handoff) {
    parts.push("【审题定稿 · 摘要】");
    parts.push(`立场：${state.handoff.position || "—"}`);
    parts.push(
      `Body1：${state.handoff.body1Point || "—"}（${state.handoff.body1Angle || "—"}）`,
    );
    parts.push(
      `Body2：${state.handoff.body2Point || "—"}（${state.handoff.body2Angle || "—"}）`,
    );
    parts.push("");
  }

  if (state.coachContext?.openIssue) {
    parts.push(`⚠ 当前待解决：${state.coachContext.openIssue}`);
    parts.push("");
  }

  if (state.s2 && state.stage >= 2) {
    if (state.subStep === "S2_2_BODY1" || state.s2.body1.draft) {
      parts.push("【Body1 论证草稿】");
      parts.push(state.s2.body1.draft || "（在下方输入区提交本段论证）");
      if (state.s2.body1.chainSummary) {
        parts.push(`链条：${state.s2.body1.chainSummary}`);
      }
      parts.push(
        ...formatSlotsBlock(
          "  已识别：",
          state.s2.body1.slots,
          undefined,
        ),
      );
      parts.push("");
    }
    if (
      state.subStep === "S2_3_BODY2" ||
      state.s2.body2.status === "ready" ||
      state.s2.body2.draft
    ) {
      parts.push("【Body2 论证草稿】");
      parts.push(state.s2.body2.draft || "（待写）");
      if (state.s2.body2.chainSummary) {
        parts.push(`链条：${state.s2.body2.chainSummary}`);
      }
      parts.push(
        ...formatSlotsBlock(
          "  已识别：",
          state.s2.body2.slots,
          undefined,
        ),
      );
      parts.push("");
    }
    if (state.subStep === "S2_4_CONCLUSION" || state.s2.conclusionPoint) {
      parts.push("【Conclusion 立场（中文目标）】");
      parts.push(state.s2.conclusionPoint || "（请用一句中文写出最终立场）");
      parts.push("");
    }
  }

  if (state.s3?.integratedBodies.body1) {
    parts.push("【Body 1 成稿】");
    parts.push(state.s3.integratedBodies.body1);
    parts.push("");
  }

  if (state.s3?.integratedBodies.body2) {
    parts.push("【Body 2 成稿】");
    parts.push(state.s3.integratedBodies.body2);
    parts.push("");
  }

  if (state.s3?.conclusionText) {
    parts.push("【Conclusion】");
    parts.push(state.s3.conclusionText);
    parts.push("");
  }

  if (state.s3?.orchestrator) {
    const o = state.s3.orchestrator;
    parts.push(`【Orchestrator（${o.mode}）】`);
    parts.push(
      `Focus: ${o.focusLayer} | E-C: ${o.essayConfidence.toFixed(2)} | P-C: ${o.paragraphConfidence.toFixed(2)} | D-C: ${o.decisionConfidence.toFixed(2)}`,
    );
    parts.push(`Reason: ${o.reason}`);
    parts.push(
      `Signals: essay=${o.essayContradiction ? 1 : 0}, paragraph=${o.paragraphDrift ? 1 : 0}, sentence=${o.sentenceIssuesLikely ? 1 : 0}`,
    );
    if (o.conflict) parts.push("Signal: conflict=true");
    if (o.fallbackApplied) parts.push("Fallback: sentence-layer");
    parts.push("");
  }

  if (state.coachContext?.orchestratorGate) {
    const g = state.coachContext.orchestratorGate;
    parts.push("【Hard Gate Telemetry】");
    parts.push(
      `hits=${g.totalHits} | streak=${g.consecutiveHits} | hardTurns=${g.hardModeTurns}`,
    );
    if (g.lastLayer || g.lastReason || g.lastSubStep) {
      parts.push(
        `last=${g.lastLayer ?? "n/a"} / ${g.lastReason ?? "n/a"} / ${g.lastSubStep ?? "n/a"}`,
      );
    }
    if (g.downgradeSuggested) {
      parts.push(
        `suggest=${g.suggestedMode ?? "soft"} @hit=${g.suggestedAtHits ?? "n/a"} (${g.suggestReason ?? "high hard-gate pressure"})`,
      );
    }
    parts.push("");
  }

  const sentences = state.s3?.confirmedSentences ?? {};
  const keys = Object.keys(sentences).sort();
  if (keys.length > 0) {
    parts.push("【已确认句子】");
    for (const key of keys) {
      const lines = sentences[key];
      if (lines?.length) parts.push(`${key}: ${lines.join(" ")}`);
    }
  }

  return parts.join("\n").trim() || "（内容将显示在这里）";
}

export function initS2FromHandoff(state: SessionState): SessionState {
  const h = state.handoff!;
  return {
    ...state,
    stage: 2,
    s2: {
      body1Point: h.body1Point,
      body2Point: h.body2Point,
      body1Angle: h.body1Angle,
      body2Angle: h.body2Angle,
      body1: defaultBodySegment(),
      body2: defaultBodySegment(),
    },
  };
}
