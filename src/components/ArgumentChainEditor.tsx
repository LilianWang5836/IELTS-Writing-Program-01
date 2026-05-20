"use client";

import { SLOT_LABELS_ORDER, slotLabel } from "@/lib/domain/chain-ui";
import { formatSlotsBlock } from "@/lib/domain/logic-slots";
import type {
  ChainProposal,
  ParagraphSlot,
  SessionState,
  WorkshopBodyKey,
} from "@/lib/domain/types";
import { useWritingStore } from "@/lib/store/writing-store";

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

  return (
    <section
      className={`rounded-lg border p-3 ${
        active ? "border-amber-400 bg-amber-50/30" : "border-stone-200 bg-white/60"
      }`}
    >
      <p className="mb-1 text-xs font-medium text-stone-500">审题锚点</p>
      <p className="mb-1 text-sm font-medium text-stone-800">{point || "—"}</p>
      <p className="mb-3 text-xs text-stone-600">
        切入面：{angle || "—"}
        <span className="text-stone-400">（讨论范围/视角）</span>
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
          <p className="mb-1 text-xs font-medium text-stone-500">论证草稿（聊天累积）</p>
          <p className="whitespace-pre-wrap text-sm text-stone-700">
            {seg.draft?.trim() || "（在右侧写出本段论证）"}
          </p>
          {active && seg.chainPhase !== "proposed" && (
            <p className="mt-2 text-xs text-amber-800/90">
              聊清后教练会整理链条，在此确认后再进入下一段。
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
