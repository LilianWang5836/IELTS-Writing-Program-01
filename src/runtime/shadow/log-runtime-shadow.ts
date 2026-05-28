import type { SessionState } from "@/lib/domain/types";
import type { LlmTurnResult } from "@/lib/domain/types";
import { runRuntimePipeline } from "../pipeline/runtime-pipeline";
import { persistCoachTurnTrace } from "../trace/persist-trace";

/** Shadow-only: log v2.3 runtime trace without changing legacy coach output. */
export function maybeLogRuntimeShadow(
  state: SessionState,
  userMessage: string,
  llmResult: Partial<LlmTurnResult>,
  options?: { body?: "body1" | "body2" },
): void {
  if (process.env.COACH_RUNTIME_SHADOW !== "true") return;

  const turnIndex = state.coachContext?.exploreRound ?? state.chatHistory.length;

  try {
    const out = runRuntimePipeline({
      state,
      userMessage,
      llmResult,
      turnIndex,
      body: options?.body,
      persistTrace: (trace) => {
        persistCoachTurnTrace(trace);
      },
    });
    if (process.env.NODE_ENV !== "production") {
      console.info("[runtime-shadow]", {
        turnId: out.trace.turnId,
        action: out.plan.action,
        runtimeMode: out.runtimeMode,
        adherence: out.trace.adherenceReport?.overallAdherence,
      });
    }
  } catch (err) {
    console.warn("[runtime-shadow] failed", err);
  }
}
