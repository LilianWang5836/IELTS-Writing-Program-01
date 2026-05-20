"use client";

import {
  formatChainProgress,
  type ChainBuildStep,
} from "@/lib/domain/chain-scaffold";
import { SLOT_LABELS_ORDER, slotLabel } from "@/lib/domain/chain-ui";
import { formatSlotsBlock } from "@/lib/domain/logic-slots";
import { HANDOFF_FIELD_LABELS } from "@/lib/domain/constants";
import type {
  ChainProposal,
  ParagraphSlot,
  SessionState,
  WorkshopBodyKey,
} from "@/lib/domain/types";
import { useWritingStore } from "@/lib/store/writing-store";

function HandoffSummaryBar({ state }: { state: SessionState }) {
  const h = state.handoff;
  if (!state.handoffLocked || !h) return null;

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/90 p-3 text-xs text-stone-700">
      <p className="mb-2 font-semibold text-stone-800">审题定稿（已提交，供本阶段对照）</p>
      <p>
        <span className="text-stone-500">{HANDOFF_FIELD_LABELS.taskUnderstanding} </span>
        {h.taskUnderstanding || "—"}
      </p>
      <p>
        <span className="text-stone-500">{HANDOFF_FIELD_LABELS.position} </span>
        {h.position || "—"}
      </p>
      <p>
        <span className="text-stone-500">{HANDOFF_FIELD_LABELS.body1Point} </span>
        {h.body1Point || "—"}
        <span className="text-stone-400">
          {" "}
          · {HANDOFF_FIELD_LABELS.body1Angle} {h.body1Angle || "—"}
        </span>
      </p>
      <p>
        <span className="text-stone-500">{HANDOFF_FIELD_LABELS.body2Point} </span>
        {h.body2Point || "—"}
        <span className="text-stone-400">
          {" "}
          · {HANDOFF_FIELD_LABELS.body2Angle} {h.body2Angle || "—"}
        </span>
      </p>
    </div>
  );
}

function ChainProposalCard({
  bodyLabel,
  proposal,
  loading,
  onConfirm,
}: {
  bodyLabel: string;
  proposal: ChainProposal;
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50/80 p-3">
      <p className="mb-2 text-sm font-semibold text-sky-950">
        教练整理 · {bodyLabel}（待确认）
      </p>
      {proposal.chainSummary && (
        <p className="mb-2 text-sm text-stone-800">
          <span className="text-xs font-medium text-sky-800">链条：</span>
          {proposal.chainSummary}
        </p>
      )}
      <ul className="mb-3 space-y-1 text-sm text-stone-800">
        {SLOT_LABELS_ORDER.map((key: ParagraphSlot) => {
          const v = proposal.slots[key]?.trim();
          if (!v) return null;
          return (
            <li key={key}>
              <span className="text-xs text-sky-800">{slotLabel(key)}：</span>
              {v}
            </li>
          );
        })}
      </ul>
      {proposal.draft && (
        <p className="mb-3 text-xs text-stone-600">
          段落意图：{proposal.draft.slice(0, 200)}
          {proposal.draft.length > 200 ? "…" : ""}
        </p>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={onConfirm}
        className="w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-40"
      >
        确认链条并填入
      </button>
    </div>
  );
}

function ChainBuildProgress({
  slots,
  buildStep,
}: {
  slots?: ChainProposal["slots"];
  buildStep?: ChainBuildStep;
}) {
  const step = buildStep ?? "claim";
  return (
    <div className="mb-3 rounded-md border border-amber-200/80 bg-amber-50/40 p-2">
      <p className="mb-1 text-xs font-medium text-amber-900">
        搭链进度（随右侧聊天更新）
      </p>
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-stone-800">
        {formatChainProgress(slots ?? {}, step)}
      </pre>
    </div>
  );
}

function LockedChain({
  title,
  draft,
  chainSummary,
  slots,
}: {
  title: string;
  draft: string;
  chainSummary?: string;
  slots?: ChainProposal["slots"];
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
      <p className="mb-2 text-sm font-semibold text-emerald-900">{title} · 已确认</p>
      <p className="mb-2 whitespace-pre-wrap text-sm text-stone-800">{draft || "—"}</p>
      {chainSummary && (
        <p className="mb-2 text-xs text-emerald-900/80">链条：{chainSummary}</p>
      )}
      <div className="text-xs text-stone-700">
        {formatSlotsBlock("", slots).filter(Boolean).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function BodySection({
  state,
  body,
  active,
  loading,
  onConfirm,
}: {
  state: SessionState;
  body: WorkshopBodyKey;
  active: boolean;
  loading: boolean;
  onConfirm: (body: WorkshopBodyKey) => void;
}) {
  const s2 = state.s2!;
  const isB1 = body === "body1";
  const label = isB1 ? "Body1" : "Body2";
  const point = isB1 ? s2.body1Point : s2.body2Point;
  const angle = isB1 ? s2.body1Angle : s2.body2Angle;
  const seg = isB1 ? s2.body1 : s2.body2;
  const pointLabel = isB1
    ? HANDOFF_FIELD_LABELS.body1Point
    : HANDOFF_FIELD_LABELS.body2Point;
  const angleLabel = isB1
    ? HANDOFF_FIELD_LABELS.body1Angle
    : HANDOFF_FIELD_LABELS.body2Angle;

  return (
    <section
      className={`rounded-lg border p-3 ${
        active ? "border-amber-400 bg-amber-50/30" : "border-stone-200 bg-white/60"
      }`}
    >
      <p className="mb-2 text-xs font-medium text-stone-500">
        {label} · 已定稿分论点（只读，来自审题）
      </p>
      <p className="mb-1 text-sm text-stone-800">
        <span className="text-xs text-stone-500">{pointLabel} </span>
        {point || "—"}
      </p>
      <p className="mb-3 text-sm text-stone-700">
        <span className="text-xs text-stone-500">{angleLabel} </span>
        {angle || "—"}
      </p>

      {seg.chainPhase === "proposed" && seg.chainProposal && active && (
        <div className="mb-3">
          <ChainProposalCard
            bodyLabel={label}
            proposal={seg.chainProposal}
            loading={loading}
            onConfirm={() => onConfirm(body)}
          />
        </div>
      )}

      {seg.chainPhase === "locked" ? (
        <LockedChain
          title={label}
          draft={seg.draft}
          chainSummary={seg.chainSummary}
          slots={seg.slots}
        />
      ) : (
        <div>
          {active && seg.chainPhase === "coaching" && (
            <ChainBuildProgress
              slots={seg.slots}
              buildStep={state.coachContext?.chainBuildStep}
            />
          )}
          <p className="mb-1 text-xs font-medium text-stone-500">
            本段论证（在右侧聊天写出，会自动出现在这里）
          </p>
          <p className="whitespace-pre-wrap rounded-md border border-dashed border-stone-300 bg-white/80 p-2 text-sm text-stone-700">
            {seg.draft?.trim() ||
              "尚未输入。请在右侧用中文写出本段论证（可乱序），勿与上方分论点栏混淆。"}
          </p>
          {active && seg.chainPhase !== "proposed" && (
            <p className="mt-2 text-xs text-amber-800/90">
              教练会按 Claim→Reason→Example→Link 逐环引导；够齐后请点「确认链条并填入」。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function ArgumentChainEditor() {
  const { state, loading, confirmChainProposal } = useWritingStore();
  if (!state?.s2) return null;

  const activeBody: WorkshopBodyKey =
    state.subStep === "S2_3_BODY2" ? "body2" : "body1";

  return (
    <div className="flex flex-col gap-4">
      <HandoffSummaryBar state={state} />
      <BodySection
        state={state}
        body="body1"
        active={activeBody === "body1"}
        loading={loading}
        onConfirm={(b) => void confirmChainProposal(b)}
      />
      {(state.subStep === "S2_3_BODY2" ||
        state.s2.body1.chainPhase === "locked") && (
        <BodySection
          state={state}
          body="body2"
          active={activeBody === "body2"}
          loading={loading}
          onConfirm={(b) => void confirmChainProposal(b)}
        />
      )}
    </div>
  );
}
