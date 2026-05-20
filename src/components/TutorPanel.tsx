"use client";

import { useCallback, useState } from "react";
import { ChatInputBar } from "@/components/ChatInputBar";
import {
  HANDOFF_FIELD_LABELS,
  HANDOFF_FIELD_ORDER,
} from "@/lib/domain/constants";
import { stageLabel } from "@/lib/domain/router";
import { useWritingStore } from "@/lib/store/writing-store";

export function TutorPanel() {
  const {
    messages,
    state,
    loading,
    insertTarget,
    setInsertTarget,
    applySelectionToHandoff,
  } = useWritingStore();

  const [selection, setSelection] = useState<{
    text: string;
  } | null>(null);

  const showUseBar =
    state?.stage === 1 && !state.handoffLocked && selection?.text.trim();

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || text.length < 2) {
      setSelection(null);
      return;
    }
    setSelection({ text });
  }, []);

  const onUse = () => {
    if (!selection?.text) return;
    applySelectionToHandoff(selection.text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-panel-right"
      onMouseUp={onMouseUp}
    >
      <header className="shrink-0 border-b border-sky-200/80 px-4 py-3">
        <h2 className="text-sm font-semibold text-sky-900">AI 教练 · 对话</h2>
        <p className="mt-1 text-xs text-sky-700/80">
          {state ? stageLabel(state) : "等待开始"}
        </p>
      </header>

      {showUseBar && selection && (
        <div className="shrink-0 border-b border-sky-200 bg-sky-50/90 px-3 py-2">
          <p className="mb-1.5 truncate text-xs text-stone-600">
            已选：「{selection.text.slice(0, 40)}
            {selection.text.length > 40 ? "…" : ""}」
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onUse}
              className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700"
            >
              使用 → {HANDOFF_FIELD_LABELS[insertTarget]}
            </button>
            {HANDOFF_FIELD_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setInsertTarget(t)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  insertTarget === t
                    ? "bg-white font-medium text-sky-900 shadow-sm"
                    : "text-stone-600 hover:bg-white/80"
                }`}
              >
                {HANDOFF_FIELD_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-sm text-stone-500">选择题目后点击「开始特训」。</p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={
              m.role === "user"
                ? "ml-6 rounded-lg bg-white px-3 py-2 text-sm text-stone-800 shadow-sm"
                : "mr-2 rounded-lg bg-sky-100/80 px-3 py-2 text-sm text-sky-950"
            }
          >
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide opacity-60">
              {m.role === "user" ? "你" : "教练"}
            </span>
            <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
          </div>
        ))}
        {loading && <p className="text-sm text-stone-400">思考中…</p>}
      </div>

      <ChatInputBar />
    </div>
  );
}
