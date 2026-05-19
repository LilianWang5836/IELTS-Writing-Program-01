import { llmFetch } from "./http";

/** Gemini REST API（比 OpenAI 兼容层更稳定，尤其 JSON 输出） */
export async function geminiGenerateJson(
  apiKey: string,
  model: string,
  systemInstruction: string,
  userPrompt: string,
): Promise<string> {
  const modelId = model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await llmFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
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
      `Empty Gemini response (finishReason=${finish ?? "unknown"}). Try GEMINI_MODEL=gemini-2.0-flash`,
    );
  }

  return text;
}
