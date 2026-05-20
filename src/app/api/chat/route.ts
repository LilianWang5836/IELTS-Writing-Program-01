import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
import { z } from "zod";
import questions from "@/data/questions.json";
import { createInitialState, buildLeftPanelText } from "@/lib/domain/state";
import { migrateSessionState } from "@/lib/domain/migrate-state";
import type { Question, SessionState, Stage1Handoff } from "@/lib/domain/types";
import {
  handleConfirm,
  handleInit,
  handleSubmitHandoff,
  handleTurn,
} from "@/lib/orchestrator/handle-turn";

const handoffSchema = z.object({
  taskUnderstanding: z.string(),
  position: z.string(),
  body1Point: z.string(),
  body1Angle: z.string(),
  body2Point: z.string(),
  body2Angle: z.string(),
  questionType: z.string().optional(),
});

const bodySchema = z.object({
  action: z.enum(["init", "turn", "confirm", "submit_handoff"]),
  questionId: z.string().optional(),
  message: z.string().optional(),
  handoff: handoffSchema.optional(),
  state: z.custom<SessionState>().optional(),
});

function respond(result: {
  replies: string[];
  state: SessionState;
  requiresConfirm: boolean;
  canSubmit: boolean;
}) {
  const state = migrateSessionState(result.state);
  return NextResponse.json({
    replies: result.replies,
    state,
    requiresConfirm: result.requiresConfirm,
    canSubmit: result.canSubmit,
    leftPanel: buildLeftPanelText(state),
  });
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { action, questionId, message, state, handoff } = parsed.data;

    if (action === "init") {
      if (!questionId) {
        return NextResponse.json({ error: "questionId required" }, { status: 400 });
      }
      const q = (questions as Question[]).find((x) => x.id === questionId);
      if (!q) {
        return NextResponse.json({ error: "Question not found" }, { status: 404 });
      }
      const initial = createInitialState(q);
      const result = await handleInit(initial);
      return respond(result);
    }

    if (!state) {
      return NextResponse.json({ error: "state required" }, { status: 400 });
    }

    const migrated = migrateSessionState(state);

    if (action === "submit_handoff") {
      if (!handoff) {
        return NextResponse.json({ error: "handoff required" }, { status: 400 });
      }
      const result = await handleSubmitHandoff(
        migrated,
        handoff as Stage1Handoff,
      );
      return respond(result);
    }

    if (action === "turn") {
      if (!message?.trim()) {
        return NextResponse.json({ error: "message required" }, { status: 400 });
      }
      const result = await handleTurn(migrated, message.trim());
      return respond(result);
    }

    if (action === "confirm") {
      const result = await handleConfirm(migrated);
      return respond(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 },
    );
  }
}
