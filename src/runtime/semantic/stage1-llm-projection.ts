/**
 * Stage1 LLM Semantic Projection — async server path (handle-turn only).
 * Pipeline: LLM raw → commitStage1ThemeProjection → enrich → attach STATE.
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
  commitStage1ThemeProjection,
  type LlmThemeProjectionRaw,
} from "@/lib/domain/stage1-theme-projection";
import { catalogPromptBlock } from "./stage1-concept-catalog";
import {
  isStage1LlmProjectionEnabled,
  syncStage1ThemeProjection,
} from "./stage1-theme-resolution";

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
  type Stage1Stance,
  type Stage1ThemeProjection,
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
  messages: string[];
}): string {
  const userBlock =
    input.messages.length === 0
      ? "（尚无学生发言）"
      : input.messages.map((m, i) => `${i + 1}. ${m}`).join("\n");

  return interpolate(loadProjectionPromptTemplate(), {
    query: input.topic,
    question_hint_type: input.questionHintType ?? "unknown",
    user_messages_block: userBlock,
    concept_catalog: catalogPromptBlock(),
  });
}

function finalizeProjection(
  state: SessionState,
  messages: string[],
  input: { llmRaw?: LlmThemeProjectionRaw; source: "llm" | "rules" },
): Stage1ThemeProjection {
  const committed = commitStage1ThemeProjection(state, messages, input);
  return enrichStage1ThemeProjection(committed, state, messages);
}

/** Async LLM projection; falls back to rules commit on missing config or error. */
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

  if (!resolveLlmConfig()) {
    return finalizeProjection(stubState, input.messages, { source: "rules" });
  }

  const prompt = buildStage1ProjectionPrompt(input);
  try {
    const raw = await callLlmJson<LlmThemeProjectionRaw>(prompt);
    return finalizeProjection(stubState, input.messages, {
      llmRaw: raw,
      source: "llm",
    });
  } catch (err) {
    console.warn("[stage1] LLM theme projection failed, using rules fallback:", err);
    return finalizeProjection(stubState, input.messages, { source: "rules" });
  }
}

/**
 * Always refresh stage1ThemeProjection before coach turn (SOURCE OF TRUTH).
 * LLM when flag+config; else rules engine.
 */
export async function ensureStage1ThemeProjection(
  state: SessionState,
): Promise<SessionState> {
  if (state.handoffLocked) return state;
  const phase = state.coachContext?.handoffPhase ?? "exploring";
  if (phase === "proposed" || phase === "locked") return state;

  const messages = userMessages(state);
  const projection = isStage1LlmProjectionEnabled()
    ? await projectStage1ThemesWithLlm({
        topic: state.topic,
        questionHintType: state.questionHintType,
        messages,
        state,
      })
    : finalizeProjection(state, messages, { source: "rules" });

  return attachStage1ThemeProjection(state, projection);
}

/** @deprecated use ensureStage1ThemeProjection */
export const refreshStage1ThemeProjection = ensureStage1ThemeProjection;
