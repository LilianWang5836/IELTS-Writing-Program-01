import {
  chainProposalFromResult,
  formatChainProposalCoachMessage,
  isChainProposalComplete,
} from "./chain-proposal";
import {
  buildChainProposalFromChat,
  buildSlotsFromChat,
  detectChainConfusion,
  formatChainProgress,
  formatChainSkeleton,
  getNextChainBuildStep,
  isBannedCoachQuestion,
  mergeSlots,
  type ChainBuildStep,
} from "./chain-scaffold";
import type {
  ChainPhase,
  ChainProposal,
  LlmTurnResult,
  ParagraphSlots,
  SessionState,
  WorkshopBodyKey,
} from "./types";
import { assessParagraphSubstance } from "./paragraph-substance";

const MAX_MIRROR_CHARS = 100;

function userBlob(state: SessionState, body: WorkshopBodyKey): string {
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  const msgs = state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  return [seg?.draft ?? "", ...msgs].join("\n");
}

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
  workingSlots?: ParagraphSlots,
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
        slots: workingSlots ?? seg.slots,
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
  return { ...result, mirror, coachQuestion: result.coachQuestion?.trim() ?? "" };
}

function pickCoachQuestion(
  llmQ: string,
  scaffoldQ: string,
): string {
  if (!llmQ || isBannedCoachQuestion(llmQ)) return scaffoldQ;
  return llmQ;
}

export function postProcessStage2(
  state: SessionState,
  result: LlmTurnResult,
  body: WorkshopBodyKey,
  userMessage?: string,
): { result: LlmTurnResult; state: SessionState } {
  let nextState = state;
  const phase = getChainPhase(state, body);
  const bodyLabel = body === "body1" ? "Body1" : "Body2";

  if (userMessage?.trim() && phase === "proposed") {
    nextState = setBodyChainPhase(nextState, body, "coaching", null);
  }

  const sanitized = sanitizeMirror(result, userMessage);
  const chatSlots = buildSlotsFromChat(nextState, body);
  const seg = body === "body1" ? nextState.s2?.body1 : nextState.s2?.body2;
  const workingSlots = mergeSlots(chatSlots, seg?.slots);

  const proposalFromLlm = chainProposalFromResult(sanitized, body);
  const slotsForSubstance = mergeSlots(workingSlots, proposalFromLlm?.slots);
  const substance = assessParagraphSubstance(
    nextState,
    body,
    userMessage,
    slotsForSubstance,
  );

  const { step: buildStep, coachPrompt: stepPrompt } =
    getNextChainBuildStep(workingSlots);
  const progressBlock = formatChainProgress(workingSlots, buildStep);

  let finalProposal = proposalFromLlm;
  if (!finalProposal && substance.sufficient) {
    finalProposal = buildChainProposalFromChat(nextState, body);
  }
  if (substance.sufficient && finalProposal && !isChainProposalComplete(finalProposal)) {
    finalProposal = buildChainProposalFromChat(nextState, body);
  }

  const llmOk = sanitized.paragraphSubstanceSufficient === true;
  const rulesOk = substance.sufficient;
  const canPropose =
    (rulesOk || (llmOk && !!proposalFromLlm)) &&
    !!finalProposal &&
    isChainProposalComplete(finalProposal);

  nextState = setBodyChainPhase(
    nextState,
    body,
    phase === "locked" ? "locked" : "coaching",
    undefined,
    workingSlots,
  );

  if (detectChainConfusion(userMessage)) {
    const skeleton = formatChainSkeleton(workingSlots, bodyLabel);
    const coachQ =
      buildStep === "ready"
        ? "若这条骨架顺，我会整理到左侧；要改请说哪一环。"
        : stepPrompt;
    return {
      result: {
        verdict: "coach",
        advance: false,
        mirror: skeleton,
        coachQuestion: coachQ,
        userVisibleText: `${skeleton}\n\n${progressBlock}`,
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          chainBuildStep: buildStep,
          lastQuestion: coachQ,
          openIssue: undefined,
        },
      },
    };
  }

  if (canPropose && finalProposal) {
    const finalProposalFull: ChainProposal = {
      ...finalProposal,
      draft: finalProposal.draft || userBlob(nextState, body).slice(0, 500),
    };
    const msg = formatChainProposalCoachMessage(
      finalProposalFull,
      sanitized.proposalSummary ||
        "链条各环已齐，我整理了一版，请看左侧与下方进度。",
    );
    nextState = setBodyChainPhase(
      nextState,
      body,
      "proposed",
      finalProposalFull,
      finalProposalFull.slots,
    );
    return {
      result: {
        verdict: "coach",
        advance: false,
        mirror: "",
        coachQuestion: "",
        userVisibleText: `${msg}\n\n${progressBlock}`,
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          chainBuildStep: "ready",
          lastQuestion: "",
          openIssue: undefined,
        },
      },
    };
  }

  const scaffoldQ = stepPrompt || substance.coachPrompt || "";
  const coachQ = pickCoachQuestion(sanitized.coachQuestion ?? "", scaffoldQ);
  const mirror =
    sanitized.mirror && sanitized.mirror !== userMessage?.trim()
      ? sanitized.mirror
      : buildStep === "ready"
        ? "各环齐了，请看左侧整理。"
        : buildStep === "claim"
          ? "我们按链条一环一环来，先不用写整段。"
          : `好，${SLOT_HINT[buildStep]}这一环有了，继续下一环。`;

  const userVisible = [mirror, coachQ, progressBlock].filter(Boolean).join("\n\n");

  return {
    result: {
      verdict: "coach",
      advance: false,
      mirror,
      coachQuestion: coachQ,
      userVisibleText: userVisible,
      logicBreakdown: undefined,
    },
    state: {
      ...nextState,
      coachContext: {
        ...nextState.coachContext,
        chainBuildStep: buildStep,
        lastQuestion: coachQ,
        openIssue: scaffoldQ || substance.coachPrompt,
      },
    },
  };
}

const SLOT_HINT: Record<Exclude<ChainBuildStep, "ready">, string> = {
  claim: "论点",
  reason: "原因",
  example: "例子",
  link: "扣题",
};

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
