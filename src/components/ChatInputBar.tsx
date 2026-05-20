"use client";

import { useState, type KeyboardEvent } from "react";
import { getStepHint } from "@/lib/domain/step-hints";
import { useWritingStore } from "@/lib/store/writing-store";

/** 固定在教练栏底部：探索/论证对话；与左侧「提交审题定稿」区分 */
export function ChatInputBar() {
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

  if (!state) return null;

  const disabled = loading;
  const stage3 = state.stage === 3;
  const stage1Explore = state.stage === 1 && !state.handoffLocked;
  const awaitingSentence = stage3 && state.s3?.mode === "assign";

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

  const placeholder = stage1Explore
    ? "与教练探索审题（Enter 发送，定稿请用左侧按钮）"
    : awaitingSentence
      ? "按教练要求写一句英文…"
      : stage3
        ? "写一句英文（Shift+Enter 换行）"
        : "输入论证等内容，Enter 发送";

  const hint = getStepHint(state, requiresConfirm);

  return (
    <div className="shrink-0 border-t border-sky-200/80 bg-white px-3 py-3">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {hint && (
        <p
          className={
            requiresConfirm
              ? "mb-2 rounded-md bg-amber-100 px-2 py-1.5 text-xs font-medium text-amber-900"
              : "mb-2 text-xs text-stone-600"
          }
        >
          {hint}
        </p>
      )}
      <div className="flex gap-2">
        <textarea
          className="min-h-[64px] flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-stone-50"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || requiresConfirm || !canSubmit}
          aria-label="教练对话输入"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={
              disabled || requiresConfirm || !canSubmit || !text.trim()
            }
            className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-40"
          >
            发送
          </button>
          {stage3 && (
            <button
              type="button"
              onClick={() => void confirmSentence()}
              disabled={disabled || !requiresConfirm}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              确认写入
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
