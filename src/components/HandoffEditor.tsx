"use client";

import {
  EMPTY_HANDOFF,
  handoffProgress,
  isHandoffComplete,
} from "@/lib/domain/handoff";
import type { HandoffFieldTarget } from "@/lib/domain/types";
import { useWritingStore } from "@/lib/store/writing-store";

const FIELDS: {
  key: HandoffFieldTarget;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "taskUnderstanding",
    label: "① 题意任务",
    placeholder: "一句话：题目要我干什么",
  },
  {
    key: "position",
    label: "② 立场",
    placeholder: "一句话：我的总体判断（可部分同意）",
  },
  {
    key: "body1Point",
    label: "③ Body1 分论点",
    placeholder: "分论点正文",
  },
  {
    key: "body1Angle",
    label: "③ Body1 角度",
    placeholder: "从题目哪一面切入（自由填写）",
  },
  {
    key: "body2Point",
    label: "④ Body2 分论点",
    placeholder: "分论点正文",
  },
  {
    key: "body2Angle",
    label: "④ Body2 角度",
    placeholder: "与 Body1 不同的切入面",
  },
];

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

  if (!state || state.handoffLocked) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
        审题定稿已锁定，进入论证阶段。
      </div>
    );
  }

  const draft = handoffDraft ?? state.handoff ?? EMPTY_HANDOFF;
  const { filled, total } = handoffProgress(draft);
  const complete = isHandoffComplete(draft);

  return (
    <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-950">审题定稿</h3>
        <span className="text-xs text-amber-800/70">
          {filled}/{total} 栏
        </span>
      </div>
      <p className="text-xs text-amber-900/80">
        聊天中选中文字点「使用」可填入；角度请用你自己的话标注。
      </p>
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="mb-1 flex items-center gap-2 text-xs font-medium text-stone-700">
            {f.label}
            {insertTarget === f.key && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">
                「使用」填入此处
              </span>
            )}
          </span>
          <input
            type="text"
            className={`w-full rounded-md border px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
              insertTarget === f.key
                ? "border-sky-400 bg-sky-50/50"
                : "border-stone-300 bg-white"
            }`}
            value={draft[f.key] ?? ""}
            placeholder={f.placeholder}
            onFocus={() => setInsertTarget(f.key)}
            onChange={(e) => setHandoffField(f.key, e.target.value)}
          />
        </label>
      ))}
      <button
        type="button"
        disabled={!complete || loading}
        onClick={() => void submitHandoff()}
        className="w-full rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-40"
      >
        提交审题定稿
      </button>
    </div>
  );
}
