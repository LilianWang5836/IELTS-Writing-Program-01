"use client";

import {
  buildCoverageDimensions,
  type CoverageDimensionDisplay,
} from "@/lib/domain/chain-workflow-ui";
import type {
  ChainCoverageSnapshot,
  ChainWorkflowSnapshot,
  WorkshopBodyKey,
} from "@/lib/domain/types";

function WorkflowBadge({ workflow }: { workflow: ChainWorkflowSnapshot }) {
  const kind = workflow.kind;
  const tone =
    kind === "ready_to_finalize" || kind === "locked"
      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
      : kind === "blocked"
        ? "border-rose-300 bg-rose-50 text-rose-950"
        : kind === "needs_stronger"
          ? "border-amber-400 bg-amber-50 text-amber-950"
          : kind === "ready_to_draft"
            ? "border-sky-300 bg-sky-50 text-sky-950"
            : "border-stone-300 bg-stone-50 text-stone-800";

  return (
    <div className={`rounded-md border px-2 py-2 ${tone}`}>
      <p className="text-xs font-semibold">Workflow · {workflow.title}</p>
      {workflow.detail && (
        <p className="mt-1 text-xs leading-relaxed opacity-90">{workflow.detail}</p>
      )}
      {workflow.nextAction && (
        <p className="mt-1 text-xs font-medium leading-relaxed">{workflow.nextAction}</p>
      )}
    </div>
  );
}

function DimensionRow({ dim }: { dim: CoverageDimensionDisplay }) {
  const levelLabel =
    dim.level === "strong"
      ? "Strong"
      : dim.level === "partial"
        ? "Partial"
        : "Missing";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-stone-700">
          <span className="mr-1 font-mono">{dim.symbol}</span>
          {dim.labelEn}
        </span>
        <span className="font-mono text-[11px] tracking-tight text-stone-800">
          {dim.bar}
        </span>
      </div>
      <p className="text-[11px] text-stone-600">
        {levelLabel} · {dim.labelZh}
        {dim.level === "partial" ? ` (${Math.round(dim.score * 100)}%)` : ""}
      </p>
    </div>
  );
}

export function ChainWorkshopProgress({
  body,
  coverage,
  workflow,
}: {
  body: WorkshopBodyKey;
  coverage?: ChainCoverageSnapshot;
  workflow?: ChainWorkflowSnapshot;
}) {
  if (!coverage || !workflow) {
    return (
      <div className="mb-3 rounded-md border border-amber-200/80 bg-amber-50/40 p-2 text-xs text-stone-600">
        搭链开始后，这里会显示论证功能完成度与工作流状态。
      </div>
    );
  }

  const dims = buildCoverageDimensions(
    {
      claimEstablished: coverage.claimEstablished,
      causalExplained: coverage.causalExplained,
      concreteGrounding: coverage.concreteGrounding,
      argumentativeClosure: coverage.argumentativeClosure,
      missing: coverage.missing,
      scores: coverage.scores,
    },
    body,
  );

  return (
    <div className="mb-3 space-y-2 rounded-md border border-amber-200/80 bg-amber-50/40 p-2">
      <p className="text-xs font-medium text-amber-900">
        论证功能完成度（Coverage）
      </p>
      <div className="space-y-2">
        {dims.map((d) => (
          <DimensionRow key={d.key} dim={d} />
        ))}
      </div>
      <WorkflowBadge workflow={workflow} />
    </div>
  );
}
