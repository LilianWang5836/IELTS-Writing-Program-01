"use client";

import { useCallback, useState } from "react";
import { stageLabel } from "@/lib/domain/router";
import type { HandoffFieldTarget } from "@/lib/domain/types";
import { useWritingStore } from "@/lib/store/writing-store";

const TARGET_LABELS: Record<HandoffFieldTarget, string> = {
  taskUnderstanding: "① 题意",
  position: "② 立场",
  body1Point: "③ Body1 分论点",
  body1Angle: "③ Body1 角度",
  body2Point: "④ Body2 分论点",
  body2Angle: "④ Body2 角度",
};

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
    x: number;
    y: number;
  } | null>(null);

  const showUse =
    state?.stage === 1 && !state.handoffLocked && selection?.text.trim();

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || text.length < 2) {
      setSelection(null);
      return;
    }
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    if (rect) {
      setSelection({
        text,
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
    }
  }, []);

  const onUse = () => {
    if (!selection?.text) return;
    applySelectionToHandoff(selection.text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const targets: HandoffFieldTarget[] = [
    "taskUnderstanding",
    "position",
    "body1Point",
    "body1Angle",
    "body2Point",
    "body2Angle",
  ];

  return (
    <div
      className="relative flex h-full flex-col bg-panel-right"
      onMouseUp={onMouseUp}
    >
      <header className="border-b border-sky-200/80 px-4 py-3">
        <h2 className="text-sm font-semibold text-sky-900">AI 教练</h2>
        <p className="mt-1 text-xs text-sky-700/80">
          {state ? stageLabel(state) : "等待开始"}
        </p>
        {state?.stage === 1 && !state.handoffLocked && (
          <p className="mt-1 text-[10px] text-sky-600/90">
            选中文本后可点「使用」填入左侧定稿
          </p>
        )}
      </header>

      {showUse && selection && (
        <div
          className="fixed z-50 flex -translate-x-1/2 -translate-y-full flex-col gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-lg"
          style={{ left: selection.x, top: selection.y }}
        >
          <button
            type="button"
            onClick={onUse}
            className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700"
          >
            使用 → {TARGET_LABELS[insertTarget]}
          </button>
          <div className="flex flex-wrap gap-0.5 px-1 pb-1">
            {targets.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setInsertTarget(t)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  insertTarget === t
                    ? "bg-sky-100 text-sky-900"
                    : "text-stone-500 hover:bg-stone-100"
                }`}
              >
                {TARGET_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

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
        {loading && <p className="text-sm text-stone-400">思考中…</p>}
      </div>
    </div>
  );
}
