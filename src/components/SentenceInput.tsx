"use client";

import { useState, KeyboardEvent } from "react";
import { getStepHint } from "@/lib/domain/step-hints";
import { useWritingStore } from "@/lib/store/writing-store";

export function SentenceInput() {
  const [text, setText] = useState("");
  const {
    state,
    loading,
    requiresConfirm,
    canSubmit,
    sendMessage,
    confirmSentence,
    error,
  } = useWritingStore();

  const disabled = !state || loading;
  const stage3 = state?.stage === 3;
  const awaitingSentence = stage3 && state?.s3?.mode === "assign";

  const onSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void sendMessage(trimmed);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!requiresConfirm) onSubmit();
    }
  };

  return (
    <div className="border-t border-panel-border bg-white px-4 py-3">
      {error && (
        <p className="mb-2 text-sm text-red-600">{error}</p>
      )}
      {state && getStepHint(state, requiresConfirm) && (
        <p
          className={
            requiresConfirm
              ? "mb-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900"
              : "mb-2 text-sm text-stone-600"
          }
        >
          {getStepHint(state, requiresConfirm)}
        </p>
      )}
      <div className="flex gap-2">
        <textarea
          className="min-h-[72px] flex-1 resize-y rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-stone-50"
          placeholder={
            !state
              ? "请先选择题目并开始特训…"
              : awaitingSentence
                ? "按教练给的 Keywords/Patterns 写一句英文，Enter 提交"
                : stage3
                  ? "写一句话，Enter 提交（Shift+Enter 换行）"
                  : "输入你的回答…"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || requiresConfirm || !canSubmit}
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || requiresConfirm || !canSubmit || !text.trim()}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-900 disabled:opacity-40"
          >
            提交
          </button>
          {stage3 && (
            <button
              type="button"
              onClick={() => void confirmSentence()}
              disabled={disabled || !requiresConfirm}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              确认写入
            </button>
          )}
        </div>
      </div>
      {state && (
        <p className="mt-2 text-xs text-stone-400">
          Stage {state.stage} · {state.subStep}
          {state.markers.stage1Pass ? " · S1✓" : ""}
          {state.markers.stage2Pass ? " · S2✓" : ""}
        </p>
      )}
    </div>
  );
}
