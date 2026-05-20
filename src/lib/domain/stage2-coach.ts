import {
  chainProposalFromResult,
  formatChainProposalCoachMessage,
  isChainProposalComplete,
} from "./chain-proposal";
import type {
  ChainPhase,
  ChainProposal,
  LlmTurnResult,
  SessionState,
  WorkshopBodyKey,
} from "./types";
import { assessParagraphSubstance } from "./paragraph-substance";
const MAX_MIRROR_CHARS = 100;

function truncateMirror(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_MIRROR_CHARS) return t;
  return `${t.slice(0, MAX_MIRROR_CHARS)}…`;
}

function getChainPhase(state: SessionState, body: WorkshopBodyKey): ChainPhase {
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  return seg?.chainPhase ?? "coaching";
}

function setBodyChainPhase(
  state: SessionState,
  body: WorkshopBodyKey,
  phase: ChainPhase,
  proposal?: ChainProposal | null,
): SessionState {
  if (!state.s2) return state;
  const key = body === "body1" ? "body1" : "body2";
  const seg = state.s2[key];
  return {
    ...state,
    s2: {
      ...state.s2,
      [key]: {
        ...seg,
        chainPhase: phase,
        chainProposal: proposal === undefined ? seg.chainProposal : proposal ?? undefined,
        status: phase === "locked" ? "ready" : "coaching",
      },
    },
  };
}

function sanitizeMirror(result: LlmTurnResult, userMessage?: string): LlmTurnResult {
  let mirror = result.mirror?.trim() ?? "";
  if (userMessage && mirror === userMessage.trim()) {
    mirror = truncateMirror(mirror);
  } else if (mirror.length > MAX_MIRROR_CHARS) {
    mirror = truncateMirror(mirror);
  }
  if (!mirror && result.userVisibleText?.trim()) {
    const uv = result.userVisibleText.trim();
    if (!userMessage || uv !== userMessage.trim()) {
      mirror = truncateMirror(uv);
    }
  }
  return { ...result, mirror, coachQuestion: result.coachQuestion?.trim() ?? "" };
}

export function postProcessStage2(
  state: SessionState,
  result: LlmTurnResult,
  body: WorkshopBodyKey,
  userMessage?: string,
): { result: LlmTurnResult; state: SessionState } {
  let nextState = state;
  const phase = getChainPhase(state, body);

  if (userMessage?.trim() && phase === "proposed") {
    nextState = setBodyChainPhase(nextState, body, "coaching", null);
  }

  const sanitized = sanitizeMirror(result, userMessage);
  let r: LlmTurnResult = {
    ...sanitized,
    verdict: "coach",
    advance: false,
  };

  const proposalFromLlm = chainProposalFromResult(sanitized, body);
  const slots = proposalFromLlm?.slots ?? sanitized.logicBreakdown?.slots;
  const substance = assessParagraphSubstance(
    nextState,
    body,
    userMessage,
    slots,
  );

  const llmOk = sanitized.paragraphSubstanceSufficient === true;
  const rulesOk = substance.sufficient;
  const canPropose =
    (rulesOk || (llmOk && !!proposalFromLlm)) &&
    !!proposalFromLlm &&
    isChainProposalComplete(proposalFromLlm);

  if (canPropose && proposalFromLlm) {
    const finalProposal: ChainProposal = {
      ...proposalFromLlm,
      draft: proposalFromLlm.draft || userMessage?.trim() || "",
    };
    const msg = formatChainProposalCoachMessage(
      finalProposal,
      sanitized.proposalSummary,
      body === "body1" ? "Body1" : "Body2",
    );
    nextState = setBodyChainPhase(nextState, body, "proposed", finalProposal);
    return {
      result: {
        ...r,
        mirror: sanitized.proposalSummary?.trim()
          ? truncateMirror(sanitized.proposalSummary)
          : "",
        coachQuestion: "",
        userVisibleText: msg,
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: "",
          openIssue: undefined,
        },
      },
    };
  }

  if (!rulesOk && substance.coachPrompt) {
    const coachQ = substance.coachPrompt;
    return {
      result: {
        ...r,
        mirror:
          sanitized.mirror && sanitized.mirror !== userMessage?.trim()
            ? sanitized.mirror
            : "这段方向有了，还可以再写实一点。",
        coachQuestion: coachQ,
        userVisibleText:
          sanitized.mirror && sanitized.mirror !== userMessage?.trim()
            ? sanitized.mirror
            : "这段方向有了，还可以再写实一点。",
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          lastQuestion: coachQ,
          openIssue: coachQ,
        },
      },
    };
  }

  const q = r.coachQuestion?.trim() || r.userVisibleText?.trim() || "";
  return {
    result: { ...r, logicBreakdown: undefined },
    state: q
      ? {
          ...nextState,
          coachContext: {
            ...nextState.coachContext,
            lastQuestion: q,
          },
        }
      : nextState,
  };
}

export function applyChainProposalToState(
  state: SessionState,
  body: WorkshopBodyKey,
  proposal: ChainProposal,
): SessionState {
  if (!state.s2) return state;
  const key = body === "body1" ? "body1" : "body2";
  const seg = state.s2[key];
  return {
    ...state,
    s2: {
      ...state.s2,
      [key]: {
        ...seg,
        status: "ready",
        chainPhase: "locked",
        chainProposal: undefined,
        draft: proposal.draft || seg.draft,
        chainSummary: proposal.chainSummary,
        slots: proposal.slots,
        openIssues: [],
      },
    },
  };
}
