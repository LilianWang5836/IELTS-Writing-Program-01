"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { EMPTY_HANDOFF } from "@/lib/domain/handoff";
import { defaultHandoffTarget } from "@/lib/domain/router";
import type {
  WorkshopBodyKey,
  HandoffFieldTarget,
  Question,
  SessionState,
  Stage1Handoff,
} from "@/lib/domain/types";

interface WritingStore {
  questions: Question[];
  selectedQuestionId: string | null;
  state: SessionState | null;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  leftPanel: string;
  handoffDraft: Stage1Handoff | null;
  insertTarget: HandoffFieldTarget;
  loading: boolean;
  requiresConfirm: boolean;
  canSubmit: boolean;
  error: string | null;

  setQuestions: (q: Question[]) => void;
  selectQuestion: (id: string) => void;
  initSession: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  confirmSentence: () => Promise<void>;
  submitHandoff: () => Promise<void>;
  confirmHandoffProposal: () => Promise<void>;
  confirmChainProposal: (body: WorkshopBodyKey) => Promise<void>;
  setHandoffField: (key: HandoffFieldTarget, value: string) => void;
  setInsertTarget: (key: HandoffFieldTarget) => void;
  applySelectionToHandoff: (text: string) => void;
  reset: () => void;
}

const STORAGE_KEY = "ielts-writing-tutor-v2";

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
      handoffDraft: null,
      insertTarget: "taskUnderstanding",
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
          handoffDraft: null,
          insertTarget: "taskUnderstanding",
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
        if (
          existing?.questionId === selectedQuestionId &&
          existing.subStep !== "S1_AWAIT"
        ) {
          return;
        }
        set({ loading: true, error: null });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "init",
              questionId: selectedQuestionId,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Init failed");
          set({
            state: data.state,
            handoffDraft: data.state.handoff ?? { ...EMPTY_HANDOFF },
            insertTarget: defaultHandoffTarget(data.state),
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

      setHandoffField: (key, value) => {
        const { handoffDraft, state } = get();
        const base = handoffDraft ?? state?.handoff ?? { ...EMPTY_HANDOFF };
        const next = { ...base, [key]: value };
        set({
          handoffDraft: next,
          state: state ? { ...state, handoff: next } : state,
        });
      },

      setInsertTarget: (key) => set({ insertTarget: key }),

      applySelectionToHandoff: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const { insertTarget } = get();
        get().setHandoffField(insertTarget, trimmed);
      },

      confirmChainProposal: async (body: WorkshopBodyKey) => {
        const { state } = get();
        if (!state) return;
        set({ loading: true, error: null });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "confirm_chain_proposal",
              state,
              body,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Confirm failed");
          set({
            state: data.state,
            messages: [
              ...get().messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? "",
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : "确认链条失败",
          });
        }
      },

      confirmHandoffProposal: async () => {
        const { state } = get();
        if (!state?.handoffProposal) return;
        set({ loading: true, error: null });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "confirm_handoff_proposal",
              state,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Confirm failed");
          set({
            state: data.state,
            handoffDraft: data.state.handoff ?? state.handoffProposal,
            messages: [
              ...get().messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? "",
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : "确认整理失败",
          });
        }
      },

      submitHandoff: async () => {
        const { state, handoffDraft } = get();
        if (!state) return;
        const handoff = handoffDraft ?? state.handoff ?? EMPTY_HANDOFF;
        set({ loading: true, error: null });
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "submit_handoff",
              state,
              handoff,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Submit failed");
          set({
            state: data.state,
            handoffDraft: data.state.handoff ?? handoff,
            messages: [
              ...get().messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? "",
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          });
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : "提交定稿失败",
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
          set({
            state: data.state,
            handoffDraft:
              data.state.coachContext?.handoffPhase === "proposed"
                ? get().handoffDraft
                : data.state.handoff ?? get().handoffDraft,
            insertTarget: data.state.handoffLocked
              ? get().insertTarget
              : defaultHandoffTarget(data.state),
            messages: [
              ...get().messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? get().leftPanel,
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          });
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
          set({
            state: data.state,
            messages: [
              ...get().messages,
              ...data.replies.map((t: string) => ({
                role: "assistant" as const,
                text: t,
              })),
            ],
            leftPanel: data.leftPanel ?? get().leftPanel,
            requiresConfirm: data.requiresConfirm,
            canSubmit: data.canSubmit,
            loading: false,
          });
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
          handoffDraft: null,
          insertTarget: "taskUnderstanding",
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
        handoffDraft: s.handoffDraft,
        insertTarget: s.insertTarget,
        requiresConfirm: s.requiresConfirm,
        canSubmit: s.canSubmit,
      }),
    },
  ),
);
