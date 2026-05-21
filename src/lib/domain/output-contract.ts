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

export function isOutputContractText(text?: string): boolean {
  const t = text?.trim() ?? "";
  return (
    t.includes("【Meaning Check】") &&
    t.includes("【Essay Check】") &&
    t.includes("【Paragraph Check】") &&
    t.includes("【Feedback】") &&
    t.includes("【Suggested Revision】") &&
    t.includes("【Next Step】")
  );
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
