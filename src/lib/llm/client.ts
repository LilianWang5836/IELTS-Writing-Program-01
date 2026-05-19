import { resolveLlmConfig, providerLabel } from "./config";
import { geminiGenerateJson } from "./gemini-native";
import { parseLlmJson } from "./guard";
import { llmFetch, networkHint } from "./http";
import { mockLlmResponse } from "./mock";
import {
  fallbackFlashModel,
  isHeavyThinkingModel,
  outputTokenBudget,
} from "./model-utils";
import type { LlmTurnResult, PromptModuleId } from "@/lib/domain/types";

const SYSTEM_JSON =
  "You are an IELTS writing coach API. Always respond with a single valid JSON object only, no markdown fences.";

type ChatCompletionBody = {
  model: string;
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object" };
  messages: Array<{ role: string; content: string }>;
};

type ChatResponse = {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

function extractOpenAiContent(data: ChatResponse): string | null {
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (content) return content;
  return null;
}

function buildChatBody(
  config: NonNullable<ReturnType<typeof resolveLlmConfig>>,
  prompt: string,
  jsonMode: boolean,
): ChatCompletionBody {
  const body: ChatCompletionBody = {
    model: config.model,
    temperature: 0.4,
    max_tokens: outputTokenBudget(config.model),
    messages: [
      { role: "system", content: SYSTEM_JSON },
      { role: "user", content: prompt },
    ],
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

async function chatCompletionsOpenAi(
  config: NonNullable<ReturnType<typeof resolveLlmConfig>>,
  prompt: string,
  jsonMode: boolean,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_REFERER ?? "https://vercel.app";
    headers["X-Title"] = "AI IELTS Writing Tutor";
  }

  let res: Response;
  try {
    res = await llmFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildChatBody(config, prompt, jsonMode)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    throw new Error(`${msg}. ${networkHint()}`);
  }

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `${providerLabel(config.provider)} API error ${res.status}: ${raw.slice(0, 400)}`,
    );
  }

  let data: ChatResponse;
  try {
    data = JSON.parse(raw) as ChatResponse;
  } catch {
    throw new Error(`Invalid JSON from API: ${raw.slice(0, 200)}`);
  }

  const content = extractOpenAiContent(data);
  if (content) return content;

  const refusal = data.choices?.[0]?.message?.refusal;
  const reason = data.choices?.[0]?.finish_reason;

  if (
    config.provider === "gemini" &&
    reason === "length" &&
    isHeavyThinkingModel(config.model)
  ) {
    return chatCompletionsOpenAi(
      { ...config, model: fallbackFlashModel(config.model) },
      prompt,
      true,
    );
  }

  throw new Error(
    `Empty LLM response (finish_reason=${reason ?? "n/a"}${refusal ? `, refusal=${refusal}` : ""}). 建议 Vercel 将 GEMINI_MODEL 改为 gemini-2.5-flash`,
  );
}

async function chatCompletions(
  config: NonNullable<ReturnType<typeof resolveLlmConfig>>,
  prompt: string,
): Promise<string> {
  if (config.provider === "gemini") {
    try {
      return await geminiGenerateJson(
        config.apiKey,
        config.model,
        SYSTEM_JSON,
        prompt,
      );
    } catch (nativeErr) {
      console.warn("[llm] Gemini native failed, trying OpenAI compat:", nativeErr);
    }
  }

  try {
    return await chatCompletionsOpenAi(config, prompt, true);
  } catch (firstErr) {
    if (config.provider !== "gemini" && config.provider !== "openrouter") {
      throw firstErr;
    }
    return await chatCompletionsOpenAi(config, prompt, false);
  }
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
