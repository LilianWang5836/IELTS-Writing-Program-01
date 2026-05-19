import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
/** Vercel Hobby 上限 10s；Pro 可调更高 */
export const maxDuration = 60;
import { z } from "zod";
import questions from "@/data/questions.json";
import { createInitialState } from "@/lib/domain/state";
import type { Question, SessionState } from "@/lib/domain/types";
import {
  handleConfirm,
  handleInit,
  handleTurn,
} from "@/lib/orchestrator/handle-turn";

const bodySchema = z.object({
  action: z.enum(["init", "turn", "confirm"]),
  questionId: z.string().optional(),
  message: z.string().optional(),
  state: z.custom<SessionState>().optional(),
});

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

    const { action, questionId, message, state } = parsed.data;

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
      const { buildLeftPanelText } = await import("@/lib/domain/state");
      return NextResponse.json({
        replies: result.replies,
        state: result.state,
        requiresConfirm: result.requiresConfirm,
        canSubmit: result.canSubmit,
        leftPanel: buildLeftPanelText(result.state),
      });
    }

    if (!state) {
      return NextResponse.json({ error: "state required" }, { status: 400 });
    }

    if (action === "turn") {
      if (!message?.trim()) {
        return NextResponse.json({ error: "message required" }, { status: 400 });
      }
      const result = await handleTurn(state, message.trim());
      const { buildLeftPanelText } = await import("@/lib/domain/state");
      return NextResponse.json({
        replies: result.replies,
        state: result.state,
        requiresConfirm: result.requiresConfirm,
        canSubmit: result.canSubmit,
        leftPanel: buildLeftPanelText(result.state),
      });
    }

    if (action === "confirm") {
      const result = await handleConfirm(state);
      const { buildLeftPanelText } = await import("@/lib/domain/state");
      return NextResponse.json({
        replies: result.replies,
        state: result.state,
        requiresConfirm: result.requiresConfirm,
        canSubmit: result.canSubmit,
        leftPanel: buildLeftPanelText(result.state),
      });
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
