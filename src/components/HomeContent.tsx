"use client";

import { useEffect, useState } from "react";
import { QuestionPicker } from "@/components/QuestionPicker";
import { SentenceInput } from "@/components/SentenceInput";
import { StageProgress } from "@/components/StageProgress";
import { TutorPanel } from "@/components/TutorPanel";
import { WritingEditor } from "@/components/WritingEditor";
import { useWritingStore } from "@/lib/store/writing-store";

export function HomeContent() {
  const { setQuestions } = useWritingStore();
  const [llmLabel, setLlmLabel] = useState("加载中…");

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((d: { mode: string; provider?: string; model?: string }) => {
        if (d.mode === "mock") setLlmLabel("Mock 本地模拟");
        else setLlmLabel(`${d.provider ?? "LLM"} · ${d.model ?? ""}`);
      })
      .catch(() => setLlmLabel("未知"));
  }, []);

  useEffect(() => {
    void fetch("/api/questions")
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions ?? []))
      .catch(() => setQuestions([]));
  }, [setQuestions]);

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b border-panel-border bg-stone-900 px-4 py-3 text-white">
        <h1 className="text-lg font-semibold">AI IELTS Writing Tutor</h1>
        <p className="text-xs text-stone-400">三阶段特训 MVP · {llmLabel}</p>
      </header>
      <QuestionPicker />
      <StageProgress />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-5">
        <section className="lg:col-span-3 border-r border-panel-border">
          <WritingEditor />
        </section>
        <section className="flex min-h-0 flex-col lg:col-span-2">
          <div className="min-h-0 flex-1">
            <TutorPanel />
          </div>
        </section>
      </div>
      <SentenceInput />
    </main>
  );
}
