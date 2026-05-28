/**
 * Stage2 左栏 / 聊天进度：话语功能分数 + 工作流（与 canPropose 对齐）。
 */
import {
  type CoverageState,
  type ParagraphCoverage,
  type CoverageGap,
  getNextNeed,
  isCoverageReady,
  isParagraphCoverageComplete,
} from "./chain-discourse";
import type { ChainPhase, WorkshopBodyKey } from "./types";

export type CoverageLevel = "missing" | "partial" | "strong";

export type ChainWorkflowKind =
  | "locked"
  | "ready_to_finalize"
  | "ready_to_draft"
  | "needs_stronger"
  | "building"
  | "blocked";

export interface ChainWorkflowStatus {
  kind: ChainWorkflowKind;
  title: string;
  detail?: string;
  nextAction?: string;
}

export interface CoverageDimensionDisplay {
  key: "claim" | "causal" | "grounding" | "closure";
  labelEn: string;
  labelZh: string;
  level: CoverageLevel;
  symbol: "✓" | "△" | "○";
  score: number;
  bar: string;
}

const THRESHOLD = {
  claim: 0.7,
  causal: 0.7,
  grounding: 0.6,
  closure: 0.5,
} as const;

const PARTIAL_FLOOR = 0.3;

function scoreToLevel(score: number, threshold: number): CoverageLevel {
  if (score >= threshold) return "strong";
  if (score > PARTIAL_FLOOR) return "partial";
  return "missing";
}

function levelToSymbol(level: CoverageLevel): "✓" | "△" | "○" {
  if (level === "strong") return "✓";
  if (level === "partial") return "△";
  return "○";
}

function scoreToBar(score: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 5);
  return "█".repeat(filled) + "░".repeat(5 - filled);
}

const DISCOURSE_LABELS: Record<
  "claim" | "causal" | "grounding" | "closure",
  { en: string; zh: string }
> = {
  claim: { en: "Main Position", zh: "核心立场" },
  causal: { en: "Why It Matters", zh: "为何重要（因果）" },
  grounding: { en: "Real-world Support", zh: "现实支撑（举例）" },
  closure: { en: "Final Evaluation", zh: "段末评价（收束）" },
};

function gapLabel(gap: CoverageGap, body: WorkshopBodyKey): string {
  if (gap === "causal") {
    return body === "body1"
      ? "因果机制（为什么这条分论点成立）"
      : "因果机制（为什么这条分论点成立）";
  }
  if (gap === "grounding") {
    return body === "body1" ? "具体支撑（真实场景/对象/变化）" : "具体支撑（真实场景/对象/变化）";
  }
  return body === "body1"
    ? "收束扣题（落回本段分论点结果）"
    : "收束扣题（落回本段分论点结果）";
}

function resolveScores(coverage: ParagraphCoverage | CoverageState): CoverageState {
  if ("scores" in coverage && coverage.scores) return coverage.scores;
  return coverage as CoverageState;
}

export function buildCoverageDimensions(
  coverage: ParagraphCoverage | CoverageState,
  _body: WorkshopBodyKey,
): CoverageDimensionDisplay[] {
  const scores = resolveScores(coverage);

  const dims: Array<{
    key: "claim" | "causal" | "grounding" | "closure";
    threshold: number;
  }> = [
    { key: "claim", threshold: THRESHOLD.claim },
    { key: "causal", threshold: THRESHOLD.causal },
    { key: "grounding", threshold: THRESHOLD.grounding },
    { key: "closure", threshold: THRESHOLD.closure },
  ];

  return dims.map(({ key, threshold }) => {
    const score = scores[key];
    const level = scoreToLevel(score, threshold);
    const labels = DISCOURSE_LABELS[key];
    return {
      key,
      labelEn: labels.en,
      labelZh: labels.zh,
      level,
      symbol: levelToSymbol(level),
      score,
      bar: scoreToBar(score),
    };
  });
}

export interface DeriveWorkflowInput {
  body: WorkshopBodyKey;
  coverage: ParagraphCoverage;
  chainPhase: ChainPhase;
  canPropose: boolean;
  ringsReady: boolean;
  rulesOk: boolean;
  substanceGaps: string[];
  hasProposalDraft: boolean;
}

export function deriveChainWorkflowStatus(
  input: DeriveWorkflowInput,
): ChainWorkflowStatus {
  const {
    body,
    coverage,
    chainPhase,
    canPropose,
    ringsReady,
    rulesOk,
    substanceGaps,
    hasProposalDraft,
  } = input;

  if (chainPhase === "locked") {
    return {
      kind: "locked",
      title: "已确认链条",
      detail: "本段论证链已锁定，可进入后续写作训练。",
    };
  }

  if (chainPhase === "proposed" || canPropose) {
    return {
      kind: "ready_to_finalize",
      title: "Ready to finalize",
      detail: "论证功能已齐，系统已整理链条提案。",
      nextAction: "请点左侧「确认链条并填入」。",
    };
  }

  if (substanceGaps.length > 0 && !rulesOk) {
    const g = substanceGaps[0] ?? "";
    return {
      kind: "blocked",
      title: "Blocked",
      detail: g,
      nextAction: "请按提示修改本段表述后再继续。",
    };
  }

  const complete = isParagraphCoverageComplete(coverage);
  const scores =
    coverage.scores ??
    ({
      claim: coverage.claimEstablished ? 1 : 0,
      causal: coverage.causalExplained ? 0.75 : 0,
      grounding: coverage.concreteGrounding ? 0.65 : 0,
      closure: coverage.argumentativeClosure ? 0.55 : 0,
    } satisfies CoverageState);
  const need = getNextNeed(scores);

  if (complete && ringsReady && !canPropose) {
    return {
      kind: "ready_to_draft",
      title: "Ready to draft chain",
      detail: hasProposalDraft
        ? "论证已齐，正在核对链条提案是否完整。"
        : "论证功能已齐，本回合将生成可确认的链条提案。",
      nextAction: "可说「整理链条」或再发一句，触发左侧提案卡片。",
    };
  }

  if (need !== "ready" && coverage.missing.length > 0) {
    const primary = coverage.missing[0]!;
    const label = gapLabel(primary, body);
    const score = coverage.scores[primary];
    const needsTitle =
      primary === "closure"
        ? "Needs stronger closure"
        : primary === "grounding"
          ? "Needs stronger grounding"
          : "Needs stronger reasoning";
    if (score > PARTIAL_FLOOR && score < THRESHOLD[primary]) {
      return {
        kind: "needs_stronger",
        title: needsTitle,
        detail: `${label}（已有部分，${Math.round(score * 100)}%，须加强）`,
        nextAction:
          primary === "grounding"
            ? "请用「例如/比如」补一个具体场景：地点/谁/发生什么。"
            : primary === "closure"
              ? "请用「因此/所以」写一句段末收束到结果。"
              : `请补：${label}（一句即可）。`,
      };
    }
    if (coverage.missing.length === 1 && !complete) {
      return {
        kind: "needs_stronger",
        title: needsTitle,
        detail: `还缺：${label}`,
        nextAction:
          primary === "closure"
            ? "用「因此/所以」写一句段末收束（勿重复全文立场）。"
            : `请补：${label}（一句即可）。`,
      };
    }
    return {
      kind: "building",
      title: "Building argument",
      detail: `还缺：${coverage.missing.map((g) => gapLabel(g, body)).join("、")}`,
      nextAction: `建议先补：${gapLabel(primary, body)}。`,
    };
  }

  if (complete && !ringsReady) {
    return {
      kind: "ready_to_draft",
      title: "Ready to draft chain",
      detail: "功能覆盖已齐，正在同步链条槽位与提案。",
      nextAction: "请稍候或再发一句以刷新状态。",
    };
  }

  return {
    kind: "building",
    title: "Building argument",
    detail: "继续用中文补充本段论证即可，不必按固定句型。",
    nextAction: "按教练追问补下一层（机制 → 具体支撑 → 收束）。",
  };
}

export function formatChainWorkshopPanel(input: {
  body: WorkshopBodyKey;
  coverage: ParagraphCoverage;
  workflow: ChainWorkflowStatus;
}): string {
  const dims = buildCoverageDimensions(input.coverage, input.body);
  const lines: string[] = [
    "【论证功能完成度 / Coverage】",
    ...dims.map(
      (d) =>
        `${d.symbol} ${d.labelEn} ${d.bar}  ${d.level === "strong" ? "Strong" : d.level === "partial" ? "Partial" : "Missing"}  (${d.labelZh})`,
    ),
    "",
    "【工作流 / Workflow】",
    `Status: ${input.workflow.title}`,
  ];
  if (input.workflow.detail) lines.push(input.workflow.detail);
  if (input.workflow.nextAction) lines.push(`Next: ${input.workflow.nextAction}`);
  return lines.join("\n");
}

export function isCoverageReadySnapshot(
  snap: { scores?: CoverageState } | ParagraphCoverage,
): boolean {
  if ("scores" in snap && snap.scores && !("claimEstablished" in snap)) {
    return isCoverageReady(snap.scores);
  }
  return isParagraphCoverageComplete(snap as ParagraphCoverage);
}
