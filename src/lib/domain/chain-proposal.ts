import type { CoverageState } from "./chain-discourse";
import { areChainSlotsSemanticallyValid } from "./chain-scaffold";
import type {
  ChainProposal,
  LogicBreakdown,
  LlmTurnResult,
  ParagraphSlots,
  WorkshopBodyKey,
} from "./types";

export type { ChainPhase, ChainProposal } from "./types";

export function isChainProposalComplete(
  p: ChainProposal | null | undefined,
  body: WorkshopBodyKey = "body1",
  coverage?: CoverageState,
): boolean {
  if (!p?.chainSummary?.trim()) return false;
  const s = p.slots ?? {};
  const draftOk = (p.draft?.trim().length ?? 0) >= 12;
  return draftOk && areChainSlotsSemanticallyValid(s, body, coverage);
}

export function chainProposalFromResult(
  result: LlmTurnResult,
  target: "body1" | "body2",
  coverage?: CoverageState,
): ChainProposal | null {
  const raw = result.chainProposal as ChainProposal | undefined;
  const bd = result.logicBreakdown;
  const slots =
    raw?.slots ??
    bd?.slots ??
    (result.extracted as { body1Logic?: { slots?: ParagraphSlots }; body2Logic?: { slots?: ParagraphSlots } })
      ?.[target === "body1" ? "body1Logic" : "body2Logic"]?.slots;

  const chainSummary =
    raw?.chainSummary?.trim() ||
    bd?.chainSummary?.trim() ||
    "";

  const draft =
    raw?.draft?.trim() ||
    (result.extracted as { body1Logic?: { raw?: string }; body2Logic?: { raw?: string } })?.[
      target === "body1" ? "body1Logic" : "body2Logic"
    ]?.raw?.trim() ||
    "";

  if (!chainSummary && !slots && !draft) return null;

  const proposal: ChainProposal = {
    chainSummary,
    slots: slots ?? {},
    draft,
  };
  return isChainProposalComplete(proposal, target, coverage) ? proposal : null;
}

export function formatChainProposalCoachMessage(
  proposal: ChainProposal,
  summary?: string,
  bodyLabel = "本段",
): string {
  const intro =
    summary?.trim() ||
    `我把你刚才说的整理成${bodyLabel}论证链条，请看左侧是否准确。`;
  const slots = proposal.slots ?? {};
  const readback = buildChainReadback(slots);
  return [
    intro,
    readback ? `段内逻辑朗读：\n${readback}` : "",
    "若认可，请点左侧「确认链条并填入」；想改可以说一句，我再帮你调整。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildChainReadback(slots: ParagraphSlots): string {
  const lines: string[] = [];
  if (slots.claim?.trim()) lines.push(`1) 先立住本段主张：${slots.claim.trim()}`);
  if (slots.reason?.trim()) lines.push(`2) 再说明机制：${slots.reason.trim()}`);
  if (slots.example?.trim()) lines.push(`3) 用具体场景支撑：${slots.example.trim()}`);
  if (slots.link?.trim()) lines.push(`4) 最后收束回分论点：${slots.link.trim()}`);
  return lines.slice(0, 4).join("\n");
}

export function logicBreakdownFromProposal(
  proposal: ChainProposal,
  target: "body1" | "body2",
): LogicBreakdown {
  return {
    target,
    chainSummary: proposal.chainSummary,
    slots: proposal.slots,
    missing: [],
  };
}
