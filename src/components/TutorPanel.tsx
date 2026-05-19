"use client";

import { useWritingStore } from "@/lib/store/writing-store";
import { stageLabel } from "@/lib/domain/router";

export function TutorPanel() {
  const { messages, state, loading } = useWritingStore();

  return (
    <div className="flex h-full flex-col bg-panel-right">
      <header className="border-b border-sky-200/80 px-4 py-3">
        <h2 className="text-sm font-semibold text-sky-900">AI 教练</h2>
        <p className="mt-1 text-xs text-sky-700/80">
          {state ? stageLabel(state) : "等待开始"}
        </p>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-sm text-stone-500">选择题目后点击「开始特训」。</p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-white px-3 py-2 text-sm text-stone-800 shadow-sm"
                : "mr-4 rounded-lg bg-sky-100/80 px-3 py-2 text-sm text-sky-950"
            }
          >
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide opacity-60">
              {m.role === "user" ? "你" : "教练"}
            </span>
            <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
          </div>
        ))}
        {loading && (
          <p className="text-sm text-stone-400">思考中…</p>
        )}
      </div>
    </div>
  );
}
