import type { OrchestratorSnapshot } from "./essay-orchestrator";

export interface OutputContractInput {
  module: string | null;
  meaningOk: boolean;
  meaningReason: string;
  paragraphFit: boolean;
  paragraphReason: string;
  feedback: string;
  suggestedRevision: string;
  nextStep: string;
  orchestrator?: OrchestratorSnapshot;
}

const COMPACT_SENTINEL = "<!--stage3-compact-->";

export function isOutputContractText(text?: string): boolean {
  const t = text?.trim() ?? "";
  if (t.includes(COMPACT_SENTINEL)) return true;
  return (
    t.includes("【Meaning Check】") &&
    t.includes("【Essay Check】") &&
    t.includes("【Paragraph Check】") &&
    t.includes("【Feedback】") &&
    t.includes("【Suggested Revision】") &&
    t.includes("【Next Step】")
  );
}

/** 显示前去掉内部 marker（前端 markdown 不会过滤 HTML 注释，必须自己清）。 */
export function stripCompactSentinel(text?: string): string {
  if (!text) return "";
  return text.replace(new RegExp(COMPACT_SENTINEL, "g"), "").trim();
}

export function buildOutputContract(input: OutputContractInput): string {
  const o = input.orchestrator;
  const essayLine = o
    ? `thesis consistency: ${o.essayContradiction ? "risk" : "ok"} | structure: ${o.focusLayer} focus (${o.mode})`
    : "thesis consistency: n/a | structure: n/a";

  return [
    `【Meaning Check】${input.meaningOk ? "yes" : "no"} - ${input.meaningReason}`,
    `【Essay Check】${essayLine}`,
    `【Paragraph Check】role=${input.module ?? "sentence"} | ${input.paragraphFit ? "fit" : "drift"} - ${input.paragraphReason}`,
    `【Feedback】\n${input.feedback}`,
    `【Suggested Revision】\n${input.suggestedRevision}`,
    `【Next Step】${input.nextStep}`,
  ].join("\n\n");
}

export const buildStage3OutputContract = buildOutputContract;

/* === Stage 3 紧凑显示 ====================================================
 * 用户每轮真正关心的信息按 sentenceState 不同。
 * compact 模式只展示"头部 + 主体"，把六段合同折叠到末尾的【诊断详情】区。 */

export type Stage3DisplayMode =
  | "assign"
  | "stabilizable"
  | "needs_repair"
  | "meta"
  | "hard_gate";

export interface Stage3CompactInput {
  mode: Stage3DisplayMode;
  /** 头部一行：状态总结，如「这句没问题，可以写入」「需要先修：缺主语」。 */
  headline: string;
  /** 主体：assign 显示翻译目标 + Pattern；needs_repair 显示问题位置 + 修法。 */
  body?: string;
  /** 详情：完整六段合同，留作可翻看。 */
  contract: OutputContractInput;
}

export function buildStage3CompactDisplay(input: Stage3CompactInput): string {
  // 仅给用户展示「头部 + 主体」；六段合同保留在 contract 里供状态/调试使用，
  // 不再进对话（避免重复 feedback）。
  const top = [input.headline.trim(), input.body?.trim()].filter(Boolean).join("\n\n");
  return [COMPACT_SENTINEL, top].filter(Boolean).join("\n");
}
