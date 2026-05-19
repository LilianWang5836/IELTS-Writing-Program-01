import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
import { getLlmMode } from "@/lib/llm/client";
import { resolveLlmConfig, providerLabel } from "@/lib/llm/config";
import { llmFetch, networkHint } from "@/lib/llm/http";

/** Quick check that Gemini/OpenAI key works. GET /api/llm-test */
export async function GET() {
  const mode = getLlmMode();
  if (mode.mode === "mock") {
    return NextResponse.json(
      {
        ok: false,
        mode: "mock",
        hint: "请在 .env.local 填写 GEMINI_API_KEY 后重启 npm run dev",
      },
      { status: 400 },
    );
  }

  const config = resolveLlmConfig();
  if (!config) {
    return NextResponse.json({ ok: false, error: "No LLM config" }, { status: 500 });
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const res = await llmFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 64,
        messages: [
          {
            role: "user",
            content: 'Reply with JSON only: {"status":"ok","provider":"gemini"}',
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          provider: config.provider,
          model: config.model,
          status: res.status,
          error: text.slice(0, 500),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      provider: config.provider,
      label: providerLabel(config.provider),
      model: config.model,
      sample: text.slice(0, 200),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
        hint: networkHint(),
      },
      { status: 502 },
    );
  }
}
