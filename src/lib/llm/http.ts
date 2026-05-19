import "server-only";
import { ProxyAgent, fetch as undiciFetch } from "undici";

function getProxyUrl(): string | undefined {
  return (
    process.env.GEMINI_HTTPS_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    undefined
  );
}

export function getProxyStatus(): { configured: boolean; url?: string } {
  const url = getProxyUrl();
  return { configured: !!url, url };
}

/**
 * Server-side LLM fetch.
 * - With GEMINI_HTTPS_PROXY / HTTPS_PROXY → undici ProxyAgent (Clash 等)
 * - Otherwise → global fetch (需终端能直连 Google，开 VPN 不一定够)
 */
export async function llmFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const proxy = getProxyUrl();
  if (proxy) {
    const dispatcher = new ProxyAgent(proxy);
    const res = await undiciFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
      dispatcher,
    });
    return res as unknown as Response;
  }
  return fetch(url, init);
}

export function networkHint(): string {
  if (getProxyUrl()) {
    return `已配置代理 ${getProxyUrl()}。若仍失败：确认 Clash 已开「系统代理」、端口正确，并执行 npm install 后重启 npm run dev。`;
  }
  return (
    "终端里的 Node 通常不走浏览器 VPN。请在 .env.local 增加 GEMINI_HTTPS_PROXY=http://127.0.0.1:7890（Clash 的 HTTP 端口，按你软件为准），npm install 后重启；或改用 OpenRouter。"
  );
}
