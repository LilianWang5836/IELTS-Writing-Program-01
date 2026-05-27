"use client";

import {
  canSubmitStage1Handoff,
  handoffProgress,
} from "@/lib/domain/handoff";
import { effectiveHandoffDraft } from "@/lib/domain/essay-substance";
import {
  HANDOFF_ANGLE_HELP,
  HANDOFF_FIELD_LABELS,
  HANDOFF_FIELD_ORDER,
} from "@/lib/domain/constants";
import type { HandoffFieldTarget, Stage1Handoff } from "@/lib/domain/types";
import { useWritingStore } from "@/lib/store/writing-store";

const PLACEHOLDERS: Record<HandoffFieldTarget, string> = {
  taskUnderstanding: "一句话：题目要我干什么",
  position: "一句话：我的总体判断（可部分同意）",
  body1Point: "Body1 要论证的核心句",
  body1Angle: "如：就业市场 / 职场技能",
  body2Point: "Body2 要论证的核心句",
  body2Angle: "如：学术深造 / 知识体系（须与 Body1 不同）",
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

function ProposalPreview({
  proposal,
  onConfirm,
  loading,
}: {
  proposal: Stage1Handoff;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50/80 p-3">
      <p className="mb-2 text-sm font-semibold text-sky-950">教练整理（待确认）</p>
      <p className="mb-3 text-xs text-sky-900/85">{HANDOFF_ANGLE_HELP}</p>
      <dl className="mb-3 space-y-1.5 text-sm text-stone-800">
        {HANDOFF_FIELD_ORDER.map((key) => (
          <div key={key}>
            <dt className="text-xs text-sky-800/90">{HANDOFF_FIELD_LABELS[key]}</dt>
            <dd>{proposal[key]?.trim() || "—"}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        disabled={loading}
        onClick={onConfirm}
        className="w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-40"
      >
        确认整理并填入
      </button>
    </div>
  );
}

export function HandoffEditor() {
  const {
    state,
    handoffDraft,
    setHandoffField,
    submitHandoff,
    confirmHandoffProposal,
    loading,
    insertTarget,
    setInsertTarget,
  } = useWritingStore();

  if (!state) return null;

  const draft = effectiveHandoffDraft(state, handoffDraft);
  const { filled, total } = handoffProgress(draft);
  const maySubmit = canSubmitStage1Handoff(state, draft);
  const showProposal =
    !!state.handoffProposal &&
    state.coachContext?.handoffPhase === "proposed";

  if (state.handoffLocked && state.handoff) {
    return <ReadonlyHandoff h={state.handoff} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {showProposal && state.handoffProposal && (
        <ProposalPreview
          proposal={state.handoffProposal}
          loading={loading}
          onConfirm={() => void confirmHandoffProposal()}
        />
      )}
      <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-amber-950">审题定稿（6 栏）</h3>
          <span className="text-xs text-amber-800/70">
            {filled}/{total}
          </span>
        </div>
        <p className="mb-2 text-xs text-amber-900/80">
          {showProposal
            ? "确认上方整理后会填入此处，可微调后提交。"
            : maySubmit
              ? "检查各栏后点下方「提交审题定稿」。"
              : "右侧先聊审题；教练整理后点「确认整理并填入」，再提交。勿在两侧未写实时提交。"}
        </p>
        {!showProposal && (
          <p className="mb-3 text-xs text-stone-600">{HANDOFF_ANGLE_HELP}</p>
        )}
        <div className="space-y-3">
          {HANDOFF_FIELD_ORDER.map((key) => (
            <label key={key} className="block">
              <span className="mb-1 flex items-center gap-2 text-xs font-medium text-stone-700">
                {HANDOFF_FIELD_LABELS[key]}
                {(key === "body1Angle" || key === "body2Angle") && (
                  <span className="font-normal text-stone-500">（讨论范围/视角）</span>
                )}
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
        disabled={!maySubmit || loading}
        onClick={() => void submitHandoff()}
        className="w-full shrink-0 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-40"
      >
        提交审题定稿
      </button>
    </div>
  );
}
