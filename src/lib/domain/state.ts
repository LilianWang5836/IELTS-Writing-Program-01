import { v4 as uuidv4 } from "uuid";
import type { Question, SessionState } from "./types";

export function createInitialState(question: Question): SessionState {
  return {
    version: 1,
    sessionId: uuidv4(),
    questionId: question.id,
    topic: question.prompt,
    stage: 1,
    subStep: "S1_AWAIT",
    markers: {
      stage1Pass: false,
      subPointsPass: false,
      subBody1Pass: false,
      stage2Pass: false,
    },
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
      s1: state.s1,
      s2: state.s2,
      s3: state.s3
        ? {
            currentBody: state.s3.currentBody,
            moduleIndex: state.s3.moduleIndex,
            mode: state.s3.mode,
            modulePlan: state.s3.modulePlan,
            confirmedKeys: Object.keys(state.s3.confirmedSentences),
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

  if (state.s1) {
    parts.push("【审题】");
    parts.push(`题型：${state.s1.questionType}`);
    parts.push(`任务：${state.s1.taskUnderstanding}`);
    parts.push(`立场：${state.s1.position}`);
    parts.push("");
  }

  if (state.s2) {
    parts.push("【论点】");
    parts.push(`Body 1：${state.s2.body1Point}`);
    if (state.s2.body1Logic?.raw) parts.push(`  论证：${state.s2.body1Logic.raw}`);
    parts.push(`Body 2：${state.s2.body2Point}`);
    if (state.s2.body2Logic?.raw) parts.push(`  论证：${state.s2.body2Logic.raw}`);
    parts.push("");
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

  const sentences = state.s3?.confirmedSentences ?? {};
  const draftKeys = Object.keys(sentences).filter(
    (k) => !state.s3?.integratedBodies.body1?.includes(k),
  );
  if (draftKeys.length > 0) {
    parts.push("【逐句草稿】");
    for (const key of draftKeys.sort()) {
      const lines = sentences[key];
      if (lines?.length) parts.push(`${key}: ${lines.join(" ")}`);
    }
  }

  return parts.join("\n").trim() || "（确认后的内容将显示在这里）";
}
