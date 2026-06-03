/**
 * Stage1 semantic pipeline — async server path (handle-turn only).
 * user input → LLM projection → commit gate → state update
 */
import fs from "fs";
import path from "path";
import { callLlmJson } from "@/lib/llm/client";
import { resolveLlmConfig } from "@/lib/llm/config";
import type { QuestionType, SessionState, Stage1ThemeProjection } from "@/lib/domain/types";
import { userMessages } from "@/lib/domain/essay-substance";
import { enrichStage1ThemeProjection } from "@/lib/domain/stage1-exploration-themes";
import {
  attachStage1ThemeProjection,
  bootstrapSemanticStateFromRules,
  isStage1ProjectionFresh,
  mergeMonotonicSemanticState,
  readStage1ThemeProjection,
  rulesFactsFromUserMessage,
  type LlmSemanticProjectionRaw,
} from "@/lib/domain/stage1-theme-projection";
import { catalogPromptBlock } from "./stage1-concept-catalog";
import { isStage1LlmProjectionEnabled } from "./stage1-theme-resolution";

export {
  isStage1LlmProjectionEnabled,
  sanitizeLlmThemeProjection,
  projectStage1ThemesFromRules,
  resolveStage1ThemeProjection,
  resolveStage1ThemeConcepts,
  syncStage1ThemeProjection,
  stanceToPositionLean,
  projectionThemesComplete,
  commitStage1ThemeProjection,
  mergeMonotonicSemanticState,
  bootstrapSemanticStateFromRules,
  rulesFactsFromUserMessage,
  COMMIT_CONFIDENCE_THRESHOLD,
  type Stage1Stance,
  type Stage1ThemeProjection,
  type LlmSemanticProjectionRaw,
} from "./stage1-theme-resolution";

let promptTemplateCache: string | null = null;

function loadProjectionPromptTemplate(): string {
  if (promptTemplateCache) return promptTemplateCache;
  const filePath = path.join(
    process.cwd(),
    "prompts",
    "P1_stage1_theme_projection.txt",
  );
  promptTemplateCache = fs.readFileSync(filePath, "utf-8");
  return promptTemplateCache;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function buildStage1ProjectionPrompt(input: {
  topic: string;
  questionHintType?: QuestionType;
  userSentence: string;
}): string {
  return interpolate(loadProjectionPromptTemplate(), {
    query: input.topic,
    question_hint_type: input.questionHintType ?? "unknown",
    user_sentence: input.userSentence.trim() || "（空）",
    concept_catalog: catalogPromptBlock(),
  });
}

async function projectLatestUserSentence(input: {
  topic: string;
  questionHintType?: QuestionType;
  userSentence: string;
}): Promise<LlmSemanticProjectionRaw | null> {
  if (!resolveLlmConfig()) return null;
  const prompt = buildStage1ProjectionPrompt(input);
  try {
    return await callLlmJson<LlmSemanticProjectionRaw>(prompt);
  } catch (err) {
    console.warn("[stage1] LLM semantic projection failed:", err);
    return null;
  }
}

function applySemanticPipeline(
  state: SessionState,
  messages: string[],
  source: "llm" | "rules",
  llmRaw: LlmSemanticProjectionRaw | null,
): Stage1ThemeProjection {
  const existing = readStage1ThemeProjection(state);
  const latest = messages[messages.length - 1] ?? "";
  const raw =
    llmRaw ??
    (latest ? rulesFactsFromUserMessage(latest) : { stance: "unclear", facts: [] });

  const committed = mergeMonotonicSemanticState(existing, raw, {
    source,
    turnIndex: messages.length,
  });
  return enrichStage1ThemeProjection(committed, state, messages);
}

/** Async LLM projection for latest user sentence; monotonic merge into STATE. */
export async function projectStage1ThemesWithLlm(input: {
  topic: string;
  questionHintType?: QuestionType;
  messages: string[];
  state?: SessionState;
}): Promise<Stage1ThemeProjection> {
  const stubState =
    input.state ??
    ({
      topic: input.topic,
      questionHintType: input.questionHintType,
      coachContext: {},
    } as SessionState);

  const latest = input.messages[input.messages.length - 1] ?? "";
  const llmRaw = latest
    ? await projectLatestUserSentence({
        topic: input.topic,
        questionHintType: input.questionHintType,
        userSentence: latest,
      })
    : null;

  return applySemanticPipeline(
    stubState,
    input.messages,
    llmRaw ? "llm" : "rules",
    llmRaw,
  );
}

/**
 * Refresh stage1ThemeProjection: one LLM/rules projection per turn, monotonic commit.
 */
export async function ensureStage1ThemeProjection(
  state: SessionState,
): Promise<SessionState> {
  if (state.handoffLocked) return state;
  const phase = state.coachContext?.handoffPhase ?? "exploring";
  if (phase === "proposed" || phase === "locked") return state;

  const messages = userMessages(state);
  if (
    isStage1ProjectionFresh(state, messages.length) &&
    readStage1ThemeProjection(state)?.concepts !== undefined
  ) {
    return state;
  }

  let projection: Stage1ThemeProjection;
  if (isStage1LlmProjectionEnabled()) {
    projection = await projectStage1ThemesWithLlm({
      topic: state.topic,
      questionHintType: state.questionHintType,
      messages,
      state,
    });
  } else {
    const existing = readStage1ThemeProjection(state);
    if (existing?.concepts !== undefined && messages.length > 0) {
      const latest = messages[messages.length - 1] ?? "";
      const raw = rulesFactsFromUserMessage(latest);
      projection = enrichStage1ThemeProjection(
        mergeMonotonicSemanticState(existing, raw, {
          source: "rules",
          turnIndex: messages.length,
        }),
        state,
        messages,
      );
    } else {
      projection = enrichStage1ThemeProjection(
        bootstrapSemanticStateFromRules(messages),
        state,
        messages,
      );
    }
  }

  return attachStage1ThemeProjection(state, projection);
}

/** @deprecated use ensureStage1ThemeProjection */
export const refreshStage1ThemeProjection = ensureStage1ThemeProjection;
