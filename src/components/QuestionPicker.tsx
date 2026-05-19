"use client";

import { useWritingStore } from "@/lib/store/writing-store";

export function QuestionPicker() {
  const { questions, selectedQuestionId, selectQuestion, initSession, reset, state } =
    useWritingStore();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-panel-border bg-white px-4 py-3">
      <label className="text-sm font-medium text-stone-600">题目</label>
      <select
        className="max-w-xl flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        value={selectedQuestionId ?? ""}
        onChange={(e) => selectQuestion(e.target.value)}
      >
        <option value="">选择 Task 2 题目…</option>
        {questions.map((q) => (
          <option key={q.id} value={q.id}>
            {q.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selectedQuestionId}
        onClick={() => {
          reset();
          void initSession();
        }}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40"
      >
        {state ? "重新开始" : "开始特训"}
      </button>
    </div>
  );
}
