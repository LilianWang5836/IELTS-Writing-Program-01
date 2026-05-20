"use client";

import { HandoffEditor } from "@/components/HandoffEditor";
import { useWritingStore } from "@/lib/store/writing-store";
import { stageLabel } from "@/lib/domain/router";

export function WritingEditor() {
  const { state, leftPanel, selectedQuestionId, questions } = useWritingStore();
  const question = questions.find((q) => q.id === selectedQuestionId);

  const showHandoff = state && state.stage === 1 && !state.handoffLocked;

  return (
    <div className="flex h-full flex-col bg-panel-left">
      <header className="border-b border-panel-border px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-800">写作区</h2>
        <p className="mt-1 text-xs text-stone-500">
          {state ? stageLabel(state) : "选择题目并开始特训"}
        </p>
      </header>
      {question && (
        <section className="border-b border-panel-border bg-amber-50/50 px-4 py-3">
          <p className="text-xs font-medium text-amber-900/70">题干</p>
          <p className="mt-1 text-sm leading-relaxed text-stone-700">
            {question.prompt}
          </p>
        </section>
      )}
      {showHandoff && (
        <section className="border-b border-panel-border px-4 py-3">
          <HandoffEditor />
        </section>
      )}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-stone-800">
          {leftPanel || "（定稿与论证进度将显示在这里）"}
        </pre>
      </div>
    </div>
  );
}
