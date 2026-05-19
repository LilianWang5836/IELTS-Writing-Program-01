export type LlmProvider = "mock" | "openai" | "gemini" | "openrouter";

export interface LlmRuntimeConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Resolve which LLM backend to use. Returns null → mock mode. */
export function resolveLlmConfig(): LlmRuntimeConfig | null {
  if (process.env.LLM_MOCK === "true") {
    return null;
  }

  const explicit = process.env.LLM_PROVIDER?.toLowerCase();

  if (
    explicit === "openrouter" ||
    (!explicit && process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY)
  ) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return {
      provider: "openrouter",
      apiKey,
      baseUrl:
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-pro",
    };
  }

  if (explicit === "gemini" || (!explicit && process.env.GEMINI_API_KEY)) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return {
      provider: "gemini",
      apiKey,
      baseUrl:
        process.env.GEMINI_BASE_URL ??
        "https://generativelanguage.googleapis.com/v1beta/openai",
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    };
  }

  if (explicit === "openai" || process.env.OPENAI_API_KEY) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return {
      provider: "openai",
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    };
  }

  return null;
}

export function providerLabel(provider: LlmProvider): string {
  switch (provider) {
    case "gemini":
      return "Google Gemini";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    default:
      return "Mock";
  }
}
