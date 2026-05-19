"use client";

import { useCallback, useEffect, useState } from "react";

type Json = Record<string, unknown>;

export default function TestLlmPage() {
  const [config, setConfig] = useState<Json | null>(null);
  const [network, setNetwork] = useState<Json | null>(null);
  const [test, setTest] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const [c, n, t] = await Promise.all([
        fetch("/api/config").then((r) => r.json()),
        fetch("/api/network-check").then((r) => r.json()),
        fetch("/api/llm-test").then((r) => r.json()),
      ]);
      setConfig(c);
      setNetwork(n);
      setTest(t);
    } catch (e) {
      setTest({
        ok: false,
        error: e instanceof Error ? e.message : "请求失败",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main className="mx-auto max-w-xl p-6 font-sans">
      <h1 className="text-xl font-semibold">LLM / 网络诊断</h1>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-medium">为什么 VPN 开着仍失败？</p>
        <p className="mt-2">
          浏览器走 VPN，但 <strong>终端里的 Node 常常不走</strong>。需要让 Clash
          开「系统代理」，或在 <code className="text-xs">.env.local</code> 里指定
          HTTP 代理端口。
        </p>
        <p className="mt-2 font-mono text-xs">
          GEMINI_HTTPS_PROXY=http://127.0.0.1:7890
        </p>
        <p className="mt-1 text-xs">（端口在 Clash → 设置 → 端口里查看，常见 7890）</p>
      </div>

      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="mt-4 rounded-lg bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "检测中…" : "重新检测"}
      </button>

      {["配置 /api/config", "网络 /api/network-check", "LLM /api/llm-test"].map(
        (title, i) => {
          const data = [config, network, test][i];
          return (
            <section
              key={title}
              className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <h2 className="text-sm font-medium">{title}</h2>
              <pre className="mt-2 overflow-x-auto text-xs">
                {JSON.stringify(data, null, 2)}
              </pre>
            </section>
          );
        },
      )}

      <p className="mt-4 text-sm text-stone-600">
        修改 .env.local 后必须 <strong>Ctrl+C 再 npm run dev</strong>，并先执行{" "}
        <code className="text-xs">npm install</code>
      </p>
      <a href="/" className="mt-2 inline-block text-sm text-sky-700 underline">
        返回首页
      </a>
    </main>
  );
}
