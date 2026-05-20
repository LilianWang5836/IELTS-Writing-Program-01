"use client";

import {
  EMPTY_HANDOFF,
  handoffProgress,
  isHandoffComplete,
} from "@/lib/domain/handoff";
import {
  HANDOFF_FIELD_LABELS,
  HANDOFF_FIELD_ORDER,
} from "@/lib/domain/constants";
import type { HandoffFieldTarget, Stage1Handoff } from "@/lib/domain/types";
import { useWritingStore } from "@/lib/store/writing-store";

const PLACEHOLDERS: Record<HandoffFieldTarget, string> = {
  taskUnderstanding: "一句话：题目要我干什么",
  position: "一句话：我的总体判断（可部分同意）",
  body1Point: "分论点正文",
  body1Angle: "从题目哪一面切入（自由填写）",
  body2Point: "分论点正文",
  body2Angle: "与 Body1 不同的切入面",
};

function ReadonlyHandoff({ h }: { h: Stage1Handoff }) {
  return (
    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
      <p className="font-medium text-emerald-900">审题定稿 · 已锁定</p>
      {HANDOFF_FIELD_ORDER.map((key) => (
        <div key={key}>
          <span className="text-xs font-medium text-emerald-800/80">
            {HANDOFF_FIELD_LABELS[key]}
          </span>
          <p className="text-stone-800">{h[key]?.trim() || "—"}</p>
        </div>
      ))}
    </div>
  );
}

export function HandoffEditor() {
  const {
    state,
    handoffDraft,
    setHandoffField,
    submitHandoff,
    loading,
    insertTarget,
    setInsertTarget,
  } = useWritingStore();

  const draft = handoffDraft ?? state?.handoff ?? EMPTY_HANDOFF;
  const { filled, total } = handoffProgress(draft);
  const complete = isHandoffComplete(draft);

  if (!state) return null;

  if (state.handoffLocked && state.handoff) {
    return <ReadonlyHandoff h={state.handoff} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-amber-950">审题定稿（6 栏）</h3>
          <span className="text-xs text-amber-800/70">
            {filled}/{total}
          </span>
        </div>
        <p className="mb-3 text-xs text-amber-900/80">
          右侧聊天探索；选中文字点「使用」填入。填完后点下方「提交审题定稿」（不是右侧「发送」）。
        </p>
        <div className="space-y-3">
          {HANDOFF_FIELD_ORDER.map((key) => (
            <label key={key} className="block">
              <span className="mb-1 flex items-center gap-2 text-xs font-medium text-stone-700">
                {HANDOFF_FIELD_LABELS[key]}
                {insertTarget === key && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">
                    「使用」填入
                  </span>
                )}
              </span>
              <input
                type="text"
                className={`w-full rounded-md border px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                  insertTarget === key
                    ? "border-sky-400 bg-sky-50/50"
                    : "border-stone-300 bg-white"
                }`}
                value={draft[key] ?? ""}
                placeholder={PLACEHOLDERS[key]}
                onFocus={() => setInsertTarget(key)}
                onChange={(e) => setHandoffField(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={!complete || loading}
        onClick={() => void submitHandoff()}
        className="w-full shrink-0 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-40"
      >
        提交审题定稿
      </button>
    </div>
  );
}
