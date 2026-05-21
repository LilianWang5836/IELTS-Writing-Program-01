/**
 * Stage2 左栏 / 聊天进度：功能覆盖度 + 工作流状态（与 canPropose 对齐，非 ✓✓✓✓）。
 */
import type { ParagraphCoverage, CoverageGap } from "./chain-discourse";
import { isParagraphCoverageComplete } from "./chain-discourse";
import type { ChainPhase, WorkshopBodyKey } from "./types";

export type CoverageLevel = "missing" | "acceptable" | "strong";

export type ChainWorkflowKind =
  | "locked"
  | "ready_to_finalize"
  | "ready_to_draft"
  | "needs_stronger"
  | "building"
  | "blocked";

export interface ChainWorkflowStatus {
  kind: ChainWorkflowKind;
  /** 主标题（中文） */
  title: string;
  /** 副说明 */
  detail?: string;
  /** 建议下一步 */
  nextAction?: string;
}

export interface CoverageDimensionDisplay {
  key: "claim" | "reasoning" | "grounding" | "closure";
  labelEn: string;
  labelZh: string;
  level: CoverageLevel;
  bar: string;
}

const BAR_STRONG = "█████";
const BAR_ACCEPTABLE = "███░░";
const BAR_MISSING = "░░░░░";

function levelToBar(level: CoverageLevel): string {
  if (level === "strong") return BAR_STRONG;
  if (level === "acceptable") return BAR_ACCEPTABLE;
  return BAR_MISSING;
}

function gapLabel(gap: CoverageGap, body: WorkshopBodyKey): string {
  if (gap === "causal") {
    return body === "body1"
      ? "因果机制（为何需要项目/实习）"
      : "因果机制（为何需要系统积累）";
  }
  if (gap === "grounding") {
    return body === "body1" ? "具体支撑（实习/项目）" : "具体支撑（课程/训练场景）";
  }
  return body === "body1"
    ? "收束扣题（落到就业/求职）"
    : "收束扣题（学术深造/长期积累）";
}

export function buildCoverageDimensions(
  coverage: ParagraphCoverage,
  body: WorkshopBodyKey,
  opts?: { closureAcceptable?: boolean },
): CoverageDimensionDisplay[] {
  const closureLevel: CoverageLevel = coverage.argumentativeClosure
    ? opts?.closureAcceptable
      ? "acceptable"
      : "strong"
    : "missing";

  return [
    {
      key: "claim",
      labelEn: "Claim (handoff)",
      labelZh: "论点（审题）",
      level: coverage.claimEstablished ? "strong" : "missing",
      bar: levelToBar(coverage.claimEstablished ? "strong" : "missing"),
    },
    {
      key: "reasoning",
      labelEn: "Reasoning",
      labelZh: "因果机制",
      level: coverage.causalExplained ? "strong" : "missing",
      bar: levelToBar(coverage.causalExplained ? "strong" : "missing"),
    },
    {
      key: "grounding",
      labelEn: "Grounding",
      labelZh: "具体支撑",
      level: coverage.concreteGrounding ? "strong" : "missing",
      bar: levelToBar(coverage.concreteGrounding ? "strong" : "missing"),
    },
    {
      key: "closure",
      labelEn: "Closure",
      labelZh: "收束扣题",
      level: closureLevel,
      bar: levelToBar(closureLevel),
    },
  ];
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

  if (complete && ringsReady && !canPropose) {
    return {
      kind: "ready_to_draft",
      title: "Ready to draft chain",
      detail: hasProposalDraft
        ? "论证已齐，正在核对链条提案是否完整。"
        : "论证功能已齐，尚未生成可确认的链条提案。",
      nextAction: "可说「整理链条」或再发一句，触发左侧提案卡片。",
    };
  }

  if (coverage.missing.length > 0) {
    const primary = coverage.missing[0]!;
    const label = gapLabel(primary, body);
    const needsTitle =
      primary === "closure"
        ? "Needs stronger closure"
        : primary === "grounding"
          ? "Needs stronger grounding"
          : "Needs stronger reasoning";
    if (coverage.missing.length === 1 && !complete) {
      return {
        kind: "needs_stronger",
        title: needsTitle,
        detail:
          primary === "closure"
            ? body === "body1"
              ? "已有因果与例子，收束须落到就业/求职结果。"
              : "已有因果与例子，收束须接到学术深造或长期积累。"
            : `还缺：${label}`,
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
    nextAction: "按教练追问补下一层（机制 → 例子 → 收束）。",
  };
}

/** 聊天区 / 左栏共用的进度文本 */
export function formatChainWorkshopPanel(input: {
  body: WorkshopBodyKey;
  coverage: ParagraphCoverage;
  workflow: ChainWorkflowStatus;
  closureAcceptable?: boolean;
}): string {
  const dims = buildCoverageDimensions(input.coverage, input.body, {
    closureAcceptable: input.closureAcceptable,
  });
  const lines: string[] = [
    "【论证功能完成度 / Coverage】",
    ...dims.map(
      (d) =>
        `${d.labelEn} ${d.bar}  ${d.level === "strong" ? "Strong" : d.level === "acceptable" ? "Acceptable" : "Missing"}  (${d.labelZh})`,
    ),
    "",
    "【工作流 / Workflow】",
    `Status: ${input.workflow.title}`,
  ];
  if (input.workflow.detail) lines.push(input.workflow.detail);
  if (input.workflow.nextAction) lines.push(`Next: ${input.workflow.nextAction}`);
  return lines.join("\n");
}
