import { fallbackFlashModel, isHeavyThinkingModel, outputTokenBudget } from "./model-utils";
import { llmFetch } from "./http";

/** Gemini REST API（比 OpenAI 兼容层更稳定） */
export async function geminiGenerateJson(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
): Promise<string> {
  const tryModels = isHeavyThinkingModel(model)
    ? [model, fallbackFlashModel(model)]
    : [model];

  let lastError: Error | null = null;

  for (const m of tryModels) {
    try {
      return await callOnce(apiKey, m, systemInstruction, userPrompt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[llm] Gemini model ${m} failed:`, lastError.message);
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

async function callOnce(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
): Promise<string> {
  const modelId = model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0.4,
    maxOutputTokens: outputTokenBudget(model),
    responseMimeType: "application/json",
  };

  if (isHeavyThinkingModel(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const res = await llmFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${raw.slice(0, 400)}`);
  }

  const data = JSON.parse(raw) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  const finish = data.candidates?.[0]?.finishReason;

  if (!text) {
    throw new Error(
      `Empty Gemini response (model=${modelId}, finishReason=${finish ?? "unknown"})`,
    );
  }

  return text;
}
