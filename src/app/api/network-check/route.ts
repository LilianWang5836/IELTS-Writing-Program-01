import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
import { getProxyStatus, llmFetch, networkHint } from "@/lib/llm/http";

export async function GET() {
  const proxy = getProxyStatus();
  const targets = [
    { name: "google", url: "https://www.google.com" },
    { name: "gemini_api", url: "https://generativelanguage.googleapis.com/" },
  ];

  const results: Array<{
    name: string;
    ok: boolean;
    status?: number;
    error?: string;
    ms?: number;
  }> = [];

  for (const t of targets) {
    const start = Date.now();
    try {
      const res = await llmFetch(t.url, {
        method: "GET",
        signal: AbortSignal.timeout(8000),
      });
      results.push({
        name: t.name,
        ok: res.ok || res.status < 500,
        status: res.status,
        ms: Date.now() - start,
      });
    } catch (e) {
      results.push({
        name: t.name,
        ok: false,
        error: e instanceof Error ? e.message : "failed",
        ms: Date.now() - start,
      });
    }
  }

  const anyOk = results.some((r) => r.ok);

  return NextResponse.json({
    proxy,
    nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY ?? "(not set)",
    results,
    ok: anyOk,
    hint: anyOk ? "网络可达，可再测 /api/llm-test" : networkHint(),
  });
}
