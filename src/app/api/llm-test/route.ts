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

  try {
    const { callLlm } = await import("@/lib/llm/client");
    const result = await callLlm(
      'Return JSON: {"status":"ok"}',
      "P1",
      { subStep: "test" },
    );

    return NextResponse.json({
      ok: true,
      provider: config.provider,
      label: providerLabel(config.provider),
      model: config.model,
      sample: result.userVisibleText?.slice(0, 200) ?? JSON.stringify(result),
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
