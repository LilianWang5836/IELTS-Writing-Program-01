"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Question, SessionState } from "@/lib/domain/types";

interface WritingStore {
  questions: Question[];
  selectedQuestionId: string | null;
  state: SessionState | null;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  leftPanel: string;
  loading: boolean;
  requiresConfirm: boolean;
  canSubmit: boolean;
  error: string | null;

  setQuestions: (q: Question[]) => void;
  selectQuestion: (id: string) => void;
  initSession: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  confirmSentence: () => Promise<void>;
  reset: () => void;
}

const STORAGE_KEY = "ielts-writing-tutor-v1";

const safeStorage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  return localStorage;
});

export const useWritingStore = create<WritingStore>()(
  persist(
    (set, get) => ({
      questions: [],
      selectedQuestionId: null,
      state: null,
      messages: [],
      leftPanel: "",
      loading: false,
      requiresConfirm: false,
      canSubmit: false,
      error: null,

      setQuestions: (questions) => set({ questions }),

      selectQuestion: (id) =>
        set({
          selectedQuestionId: id,
          state: null,
          messages: [],
          leftPanel: "",
          requiresConfirm: false,
          canSubmit: false,
          error: null,
        }),

      initSession: async () => {
        const { selectedQuestionId, state: existing } = get();
        if (!selectedQuestionId) {
          set({ error: "请先选择题目" });
          return;
        }
        if (existing?.questionId === selectedQuestionId && existing.subStep !== "S1_AWAIT") {
          return;
        }
        set({ loading: true, error: null });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "init", questionId: selectedQuestionId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Init failed");
          set({
            state: data.state,
            messages: data.replies.map((t: string) => ({
              role: "assistant" as const,
              text: t,
            })),
            leftPanel: data.leftPanel ?? "",
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : "初始化失败",
          });
        }
      },

      sendMessage: async (text: string) => {
        const { state, requiresConfirm } = get();
        if (!state || requiresConfirm) return;
        set({ loading: true, error: null });
        set((s) => ({
          messages: [...s.messages, { role: "user", text }],
        }));
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "turn", message: text, state }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Request failed");
          set((s) => ({
            state: data.state,
            messages: [
              ...s.messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? s.leftPanel,
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          }));
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : "发送失败",
          });
        }
      },

      confirmSentence: async () => {
        const { state } = get();
        if (!state) return;
        set({ loading: true, error: null });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "confirm", state }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Confirm failed");
          set((s) => ({
            state: data.state,
            messages: [
              ...s.messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? s.leftPanel,
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          }));
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : "确认失败",
          });
        }
      },

      reset: () =>
        set({
          state: null,
          messages: [],
          leftPanel: "",
          requiresConfirm: false,
          canSubmit: false,
          error: null,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      skipHydration: true,
      partialize: (s) => ({
        selectedQuestionId: s.selectedQuestionId,
        state: s.state,
        messages: s.messages,
        leftPanel: s.leftPanel,
        requiresConfirm: s.requiresConfirm,
        canSubmit: s.canSubmit,
      }),
    },
  ),
);
