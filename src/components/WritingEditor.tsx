"use client";

import { HandoffEditor } from "@/components/HandoffEditor";
import { useWritingStore } from "@/lib/store/writing-store";

function leftColumnTitle(stage: number | undefined): string {
  if (stage === 1) return "审题定稿";
  if (stage === 2) return "论证笔记";
  return "成稿进度";
}

export function WritingEditor() {
  const { state, leftPanel, selectedQuestionId, questions } = useWritingStore();
  const question = questions.find((q) => q.id === selectedQuestionId);

  const isStage1 = state?.stage === 1;
  const showNotes = state && state.stage >= 2;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel-left">
      <header className="shrink-0 border-b border-panel-border px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-800">
          {state ? leftColumnTitle(state.stage) : "工作区"}
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          {isStage1
            ? "填写 6 栏 · 探索在右侧教练栏"
            : state
              ? `Stage ${state.stage}`
              : "选择题目并开始特训"}
        </p>
      </header>

      {question && (
        <section className="shrink-0 border-b border-panel-border bg-amber-50/50 px-4 py-3">
          <p className="text-xs font-medium text-amber-900/70">题干</p>
          <p className="mt-1 max-h-28 overflow-y-auto text-sm leading-relaxed text-stone-700">
            {question.prompt}
          </p>
        </section>
      )}

      {isStage1 && (
        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
          <HandoffEditor />
        </section>
      )}

      {showNotes && (
        <section className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-stone-800">
            {leftPanel?.trim() || "（论证与成稿将显示在这里）"}
          </pre>
        </section>
      )}
    </div>
  );
}
