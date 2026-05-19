import { resolveLlmConfig, providerLabel } from "./config";
import { parseLlmJson } from "./guard";
import { llmFetch, networkHint } from "./http";
import { mockLlmResponse } from "./mock";
import type { LlmTurnResult, PromptModuleId } from "@/lib/domain/types";

async function chatCompletions(
  config: NonNullable<ReturnType<typeof resolveLlmConfig>>,
  prompt: string,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_REFERER ?? "http://localhost:3000";
    headers["X-Title"] = "AI IELTS Writing Tutor";
  }

  let res: Response;
  try {
    res = await llmFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an IELTS writing coach API. Always respond with a single valid JSON object only, no markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    throw new Error(`${msg}. ${networkHint()}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `${providerLabel(config.provider)} API error ${res.status}: ${errText.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty LLM response");
  return content;
}

export function getLlmMode(): {
  mode: "mock" | "live";
  provider?: string;
  model?: string;
} {
  const config = resolveLlmConfig();
  if (!config) return { mode: "mock" };
  return {
    mode: "live",
    provider: config.provider,
    model: config.model,
  };
}

export async function callLlm(
  prompt: string,
  moduleId: PromptModuleId,
  context: { userMessage?: string; subStep: string },
): Promise<LlmTurnResult> {
  const config = resolveLlmConfig();

  if (!config) {
    return mockLlmResponse(moduleId, context);
  }

  const raw = await chatCompletions(config, prompt);
  return parseLlmJson(raw);
}
