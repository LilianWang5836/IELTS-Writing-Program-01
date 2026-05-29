import {
  chainProposalFromResult,
  formatChainProposalCoachMessage,
  isChainProposalComplete,
} from "./chain-proposal";
import { buildChainBaselineSlots } from "./chain-slot-pool";
import {
  areChainSlotsSemanticallyValid,
  buildChainProposalFromSlots,
  buildSlotsFromChat,
  detectChainConfusion,
  detectChainMetaQuestion,
  detectChainProcessQuestion,
  exampleFollowUpCoachPrompt,
  formatChainSkeleton,
  coachPromptForCoverageNeed,
  getChainBuildContext,
  getNextChainBuildStep,
  isChainStepFilled,
  isExampleSentence,
  isWeakExampleSentence,
  mergeSlots,
  normalizeHandoffClaimForChain,
  type ChainBuildStep,
} from "./chain-scaffold";
import {
  aggregateCoverage,
  buildDiscourseMemory,
  getNextNeed,
  isDiscourseArgumentReady,
  isParagraphCoverageComplete,
  needToBuildStep,
} from "./chain-discourse";
import { resolveChainTurnDecision } from "./chain-turn-decision";
import { bindPlanCoachFields } from "./runtime-plan-overlay";
import {
  deriveChainWorkflowStatus,
  formatChainWorkshopPanel,
} from "./chain-workflow-ui";
import {
  detectCoachCounterQuestion,
  detectChainFrustration,
  stage2UserMessages,
  userBlobForWorkshopBody,
} from "./stage2-context";
import type {
  ChainCoverageSnapshot,
  ChainPhase,
  ChainProposal,
  ChainWorkflowSnapshot,
  LlmTurnResult,
  ParagraphSlots,
  SessionState,
  WorkshopBodyKey,
} from "./types";
import { assessParagraphSubstance } from "./paragraph-substance";
import { buildOutputContract } from "./output-contract";

const MAX_MIRROR_CHARS = 220;

function truncateMirror(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_MIRROR_CHARS) return t;
  return `${t.slice(0, MAX_MIRROR_CHARS)}…`;
}

function getChainPhase(state: SessionState, body: WorkshopBodyKey): ChainPhase {
  const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
  return seg?.chainPhase ?? "coaching";
}

function ensureClaimInSlots(
  slots: ParagraphSlots | undefined,
  state: SessionState,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const out = { ...(slots ?? {}) };
  if (out.claim?.trim()) return out;
  const point =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  if (point?.trim()) {
    out.claim = normalizeHandoffClaimForChain(point, body);
  }
  return out;
}

function setBodyChainPhase(
  state: SessionState,
  body: WorkshopBodyKey,
  phase: ChainPhase,
  proposal?: ChainProposal | null,
  workingSlots?: ParagraphSlots,
  meta?: {
    coverage?: ChainCoverageSnapshot;
    workflow?: ChainWorkflowSnapshot;
  },
): SessionState {
  if (!state.s2) return state;
  const key = body === "body1" ? "body1" : "body2";
  const seg = state.s2[key];
  const slots = ensureClaimInSlots(workingSlots ?? seg.slots, state, body);
  return {
    ...state,
    s2: {
      ...state.s2,
      [key]: {
        ...seg,
        chainPhase: phase,
        chainProposal: proposal === undefined ? seg.chainProposal : proposal ?? undefined,
        slots,
        chainCoverage: meta?.coverage ?? seg.chainCoverage,
        chainWorkflow: meta?.workflow ?? seg.chainWorkflow,
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

function nextChainAskCount(
  state: SessionState,
  step: ChainBuildStep,
  coachQ: string,
): number {
  if (!coachQ.trim()) return 0;
  const prevStep = state.coachContext?.chainLastAskedStep;
  const prevCount = state.coachContext?.chainStepAskCount ?? 0;
  if (prevStep === step) return prevCount + 1;
  return 1;
}

function buildStage2OutputContract(input: {
  state: SessionState;
  body: WorkshopBodyKey;
  module: string;
  meaningOk: boolean;
  meaningReason: string;
  paragraphFit: boolean;
  paragraphReason: string;
  feedback: string;
  suggestedRevision: string;
  nextStep: string;
}): string {
  return buildOutputContract({
    module: `${input.body}:${input.module}`,
    meaningOk: input.meaningOk,
    meaningReason: input.meaningReason,
    paragraphFit: input.paragraphFit,
    paragraphReason: input.paragraphReason,
    feedback: input.feedback,
    suggestedRevision: input.suggestedRevision,
    nextStep: input.nextStep,
    orchestrator: input.state.s3?.orchestrator,
  });
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
  const planCoach = (
    mirror: string,
    coachQ: string,
    keepMirror = false,
  ) =>
    bindPlanCoachFields(
      nextState,
      sanitized,
      userMessage,
      body,
      { mirror, coachQuestion: coachQ },
      { keepMirror },
    );
  const seg = body === "body1" ? nextState.s2?.body1 : nextState.s2?.body2;
  const baselineSlots = buildChainBaselineSlots(nextState, body, seg?.slots);
  const buildCtx = getChainBuildContext(nextState, body);
  const prevStep = (state.coachContext?.chainBuildStep ?? "claim") as ChainBuildStep;
  const prevAskCount = state.coachContext?.chainStepAskCount ?? 0;
  const lastQ = state.coachContext?.lastQuestion ?? "";
  const preMsgs = stage2UserMessages(nextState, body);
  const preMemory = buildDiscourseMemory(
    preMsgs,
    body,
    buildCtx.bodyPoint || baselineSlots.claim || undefined,
  );
  const preCoverage = aggregateCoverage(preMemory, body);
  const expectedStep = needToBuildStep(getNextNeed(preCoverage));

  const decision = resolveChainTurnDecision({
    baselineSlots,
    result: sanitized,
    body,
    buildCtx,
    userMessage,
    prevStep,
    prevAskCount,
    sameStepAsPrev: prevStep === expectedStep,
    lastQuestion: lastQ,
    state: nextState,
  });

  const workingSlots = ensureClaimInSlots(
    decision.workingSlots,
    nextState,
    body,
  );
  const buildStep = decision.advanceTo;
  const coverageScores = decision.coverage.scores;
  const stepPrompt =
    buildStep === "ready"
      ? ""
      : decision.currentNeed === "ready"
        ? ""
        : coachPromptForCoverageNeed(
            decision.currentNeed,
            workingSlots,
            body,
            buildCtx,
          ) ||
          getNextChainBuildStep(workingSlots, body, buildCtx, coverageScores)
            .coachPrompt;

  const proposalFromLlm = chainProposalFromResult(
    sanitized,
    body,
    coverageScores,
  );
  const slotsForSubstance = mergeSlots(workingSlots, proposalFromLlm?.slots, body);
  const substance = assessParagraphSubstance(
    nextState,
    body,
    userMessage,
    slotsForSubstance,
  );

  const proposalDraft = userBlobForWorkshopBody(nextState, body).slice(0, 500);
  let finalProposal = proposalFromLlm;
  if (!finalProposal && substance.sufficient) {
    finalProposal = buildChainProposalFromSlots(workingSlots, body, proposalDraft);
  }
  if (
    substance.sufficient &&
    finalProposal &&
    !isChainProposalComplete(finalProposal, body, coverageScores)
  ) {
    finalProposal = buildChainProposalFromSlots(workingSlots, body, proposalDraft);
  }

  const llmOk = sanitized.paragraphSubstanceSufficient === true;
  const rulesOk = substance.sufficient;
  const discourseReady = isDiscourseArgumentReady(coverageScores);
  const ringsReady =
    buildStep === "ready" &&
    (discourseReady || isParagraphCoverageComplete(decision.coverage));
  const canPropose =
    ringsReady &&
    rulesOk &&
    !!finalProposal &&
    isChainProposalComplete(finalProposal, body, coverageScores) &&
    areChainSlotsSemanticallyValid(
      finalProposal.slots,
      body,
      coverageScores,
    );

  const coverageSnap: ChainCoverageSnapshot = {
    scores: { ...decision.coverage.scores },
    claimEstablished: decision.coverage.claimEstablished,
    causalExplained: decision.coverage.causalExplained,
    concreteGrounding: decision.coverage.concreteGrounding,
    argumentativeClosure: decision.coverage.argumentativeClosure,
    missing: [...decision.coverage.missing],
  };

  const workflow = deriveChainWorkflowStatus({
    body,
    coverage: decision.coverage,
    chainPhase: phase,
    canPropose,
    ringsReady,
    rulesOk,
    substanceGaps: substance.gaps,
    hasProposalDraft: !!finalProposal,
  });

  const workflowSnap: ChainWorkflowSnapshot = {
    kind: workflow.kind,
    title: workflow.title,
    detail: workflow.detail,
    nextAction: workflow.nextAction,
  };

  const progressBlock = formatChainWorkshopPanel({
    body,
    coverage: decision.coverage,
    workflow,
  });

  nextState = setBodyChainPhase(
    nextState,
    body,
    phase === "locked" ? "locked" : "coaching",
    undefined,
    workingSlots,
    { coverage: coverageSnap, workflow: workflowSnap },
  );

  if (detectCoachCounterQuestion(userMessage)) {
    const explain =
      prevStep === "reason"
        ? "你这句已被当作原因，我追问的目的是把机制说得更可写。"
        : prevStep === "example"
          ? "你这句已被当作例子，我追问通常是为了补到可直接写进段落的细节。"
          : prevStep === "link"
            ? "你这句已在做段末收束，我追问是为了更稳地落到就业结果。"
            : "你的内容我已经在使用，我会避免重复模板追问。";
    const softNext =
      stepPrompt ||
      (buildStep === "ready"
        ? "如果你愿意，我可以直接整理到左侧。"
        : `如果你愿意，我们直接继续下一环：${SLOT_LABEL[buildStep]}`);
    const coachQ =
      buildStep === "ready"
        ? "要我现在整理链条吗？"
        : `若继续，请补${SLOT_LABEL[buildStep]}（一句即可）。`;
    const { mirror: boundMirror, coachQuestion: boundQ } = planCoach(
      explain,
      coachQ,
      true,
    );
    return {
      result: {
        verdict: "coach",
        advance: false,
        mirror: boundMirror,
        coachQuestion: boundQ,
        userVisibleText: buildStage2OutputContract({
          state: nextState,
          body,
          module: buildStep,
          meaningOk: true,
          meaningReason: "流程确认，不是内容偏题",
          paragraphFit: buildStep === "ready",
          paragraphReason:
            buildStep === "ready"
              ? "链条关键环已齐，可准备并入"
              : `当前优先补 ${SLOT_LABEL[buildStep]}`,
          feedback: [explain, softNext].filter(Boolean).join("\n\n"),
          suggestedRevision:
            buildStep === "ready"
              ? "核对左侧链条，若顺就并入。"
              : `补一句${SLOT_LABEL[buildStep]}（一句即可）。`,
          nextStep: boundQ || "继续按当前环节补一句。",
        }),
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          chainBuildStep: buildStep,
          chainLastAskedStep: buildStep,
          chainStepAskCount: nextChainAskCount(state, buildStep, boundQ),
          lastQuestion: boundQ,
          openIssue: undefined,
        },
      },
    };
  }

  if (detectChainMetaQuestion(userMessage) || detectChainProcessQuestion(userMessage)) {
    const point =
      body === "body1" ? nextState.s2?.body1Point : nextState.s2?.body2Point;
    const stepLabel =
      buildStep === "ready" ? "下一环" : SLOT_LABEL[buildStep];
    const coachQ =
      stepPrompt ||
      (buildStep === "claim"
        ? `先写论点：扣住「${point || "本分论点"}」。`
        : `当前先补 ${stepLabel}。`);
    const mirror =
      buildStep === "claim"
        ? "我们按链条一环一环来，不用一次写整段。"
        : `当前环节是 ${stepLabel}，写完再说下一句。`;
    const { mirror: boundMirror, coachQuestion: boundQ } = planCoach(
      mirror,
      coachQ,
      true,
    );
    return {
      result: {
        verdict: "coach",
        advance: false,
        mirror: boundMirror,
        coachQuestion: boundQ,
        userVisibleText: buildStage2OutputContract({
          state: nextState,
          body,
          module: buildStep,
          meaningOk: true,
          meaningReason: "当前是流程/策略澄清",
          paragraphFit: buildStep === "ready",
          paragraphReason:
            buildStep === "ready"
              ? "链条完整，可并入"
              : `当前在补 ${SLOT_LABEL[buildStep]}`,
          feedback: [boundMirror, boundQ, progressBlock].filter(Boolean).join("\n\n"),
          suggestedRevision:
            buildStep === "ready"
              ? "确认是否并入链条。"
              : `按提示补一句${SLOT_LABEL[buildStep]}。`,
          nextStep: boundQ || "继续当前环节。",
        }),
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          chainBuildStep: buildStep,
          chainLastAskedStep: buildStep,
          chainStepAskCount: nextChainAskCount(state, buildStep, boundQ),
          lastQuestion: boundQ,
          openIssue: undefined,
        },
      },
    };
  }

  if (detectChainFrustration(userMessage)) {
    const prevF = (state.coachContext?.chainBuildStep ?? "claim") as ChainBuildStep;
    const afterF = getNextChainBuildStep(workingSlots, body, buildCtx);
    const ex = workingSlots.example?.trim() ?? "";

    if (
      ex &&
      isExampleSentence(ex, body) &&
      !isWeakExampleSentence(ex, body) &&
      (prevF === "example" || /举例|例子|Example/i.test(state.coachContext?.lastQuestion ?? ""))
    ) {
      nextState = setBodyChainPhase(
        nextState,
        body,
        phase === "locked" ? "locked" : "coaching",
        undefined,
        workingSlots,
      );
      const mirror = "抱歉，刚才重复问了举例；你的例子我记下了。";
      const coachQ = afterF.coachPrompt;
      const { mirror: boundMirror, coachQuestion: boundQ } = planCoach(
        mirror,
        coachQ,
        true,
      );
      const progress = formatChainWorkshopPanel({
        body,
        coverage: decision.coverage,
        workflow: deriveChainWorkflowStatus({
          body,
          coverage: decision.coverage,
          chainPhase: phase,
          canPropose: false,
          ringsReady:
            afterF.step === "ready" ||
            isParagraphCoverageComplete(decision.coverage),
          rulesOk: substance.sufficient,
          substanceGaps: substance.gaps,
          hasProposalDraft: !!finalProposal,
        }),
      });
      return {
        result: {
          verdict: "coach",
          advance: false,
          mirror: boundMirror,
          coachQuestion: boundQ,
          userVisibleText: buildStage2OutputContract({
            state: nextState,
            body,
            module: afterF.step,
            meaningOk: true,
            meaningReason: "你的输入有效，系统已吸收",
            paragraphFit: afterF.step === "ready",
            paragraphReason:
              afterF.step === "ready"
                ? "链条够写，可并入"
                : `下一步补 ${SLOT_LABEL[afterF.step]}`,
            feedback: [boundMirror, boundQ, progress].filter(Boolean).join("\n\n"),
            suggestedRevision:
              afterF.step === "ready"
                ? "检查左侧链条并确认。"
                : `补一句${SLOT_LABEL[afterF.step]}，保持一句话。`,
            nextStep: boundQ || "继续下一环。",
          }),
          logicBreakdown: undefined,
        },
        state: {
          ...nextState,
          coachContext: {
            ...nextState.coachContext,
            chainBuildStep: afterF.step,
            chainLastAskedStep: afterF.step,
            chainStepAskCount: nextChainAskCount(state, afterF.step, boundQ),
            lastQuestion: boundQ,
            openIssue: undefined,
          },
        },
      };
    }

    if (ex && isWeakExampleSentence(ex, body)) {
      const coachQ = exampleFollowUpCoachPrompt(ex, body);
      const mirror = "抱歉，刚才问法重复了；你的方向对，再具体一点即可。";
      const { mirror: boundMirror, coachQuestion: boundQ } = planCoach(
        mirror,
        coachQ,
        true,
      );
      return {
        result: {
          verdict: "coach",
          advance: false,
          mirror: boundMirror,
          coachQuestion: boundQ,
          userVisibleText: buildStage2OutputContract({
            state: nextState,
            body,
            module: "example",
            meaningOk: true,
            meaningReason: "例子方向正确，需要更具体",
            paragraphFit: false,
            paragraphReason: "example 仍偏泛，需要可写细节",
            feedback: [boundMirror, boundQ, progressBlock].filter(Boolean).join("\n\n"),
            suggestedRevision: "补一个具体场景/对象/结果。",
            nextStep: boundQ || "再具体一点后提交。",
          }),
          logicBreakdown: undefined,
        },
        state: {
          ...nextState,
          coachContext: {
            ...nextState.coachContext,
            chainBuildStep: "example",
            chainLastAskedStep: "example",
            chainStepAskCount: nextChainAskCount(state, "example", boundQ),
            lastQuestion: boundQ,
            openIssue: boundQ,
          },
        },
      };
    }
  }

  if (detectChainConfusion(userMessage)) {
    const skeleton = formatChainSkeleton(workingSlots, bodyLabel);
    const coachQ =
      buildStep === "ready"
        ? "若这条骨架顺，我会整理到左侧；要改请说哪一环。"
        : stepPrompt;
    const { mirror: boundMirror, coachQuestion: boundQ } = planCoach(
      skeleton,
      coachQ,
      true,
    );
    return {
      result: {
        verdict: "coach",
        advance: false,
        mirror: boundMirror,
        coachQuestion: boundQ,
        userVisibleText: buildStage2OutputContract({
          state: nextState,
          body,
          module: buildStep,
          meaningOk: true,
          meaningReason: "你在确认结构理解",
          paragraphFit: buildStep === "ready",
          paragraphReason:
            buildStep === "ready"
              ? "骨架已完整"
              : `当前应先完成 ${SLOT_LABEL[buildStep]}`,
          feedback: [boundMirror, progressBlock].filter(Boolean).join("\n\n"),
          suggestedRevision:
            buildStep === "ready"
              ? "指出要改的具体一环。"
              : `按骨架补一句${SLOT_LABEL[buildStep]}。`,
          nextStep: boundQ || "继续当前环节。",
        }),
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          chainBuildStep: buildStep,
          chainLastAskedStep: buildStep,
          chainStepAskCount: nextChainAskCount(state, buildStep, boundQ),
          lastQuestion: boundQ,
          openIssue: undefined,
        },
      },
    };
  }

  if (canPropose && finalProposal) {
    const finalProposalFull: ChainProposal = {
      ...finalProposal,
      draft:
        finalProposal.draft ||
        userBlobForWorkshopBody(nextState, body).slice(0, 500),
    };
    const finalizeWorkflow = deriveChainWorkflowStatus({
      body,
      coverage: decision.coverage,
      chainPhase: "proposed",
      canPropose: true,
      ringsReady: true,
      rulesOk: true,
      substanceGaps: [],
      hasProposalDraft: true,
    });
    const finalizeWorkflowSnap: ChainWorkflowSnapshot = {
      kind: finalizeWorkflow.kind,
      title: finalizeWorkflow.title,
      detail: finalizeWorkflow.detail,
      nextAction: finalizeWorkflow.nextAction,
    };
    const finalizeProgress = formatChainWorkshopPanel({
      body,
      coverage: decision.coverage,
      workflow: finalizeWorkflow,
    });
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
      ensureClaimInSlots(finalProposalFull.slots, nextState, body),
      { coverage: coverageSnap, workflow: finalizeWorkflowSnap },
    );
    return {
      result: {
        verdict: "coach",
        advance: false,
        mirror: "",
        coachQuestion: "",
        userVisibleText: buildStage2OutputContract({
          state: nextState,
          body,
          module: "ready",
          meaningOk: true,
          meaningReason: "段内 meaning 已闭环",
          paragraphFit: true,
          paragraphReason: "论证功能已闭环（机制+支撑+收束到位）",
          feedback: `${msg}\n\n${finalizeProgress}`,
          suggestedRevision: "若无异议，确认并入链条。",
          nextStep: "点击并入链条；若要改，指出具体一环。",
        }),
        logicBreakdown: undefined,
      },
      state: {
        ...nextState,
        coachContext: {
          ...nextState.coachContext,
          chainBuildStep: "ready",
          chainLastAskedStep: "ready",
          chainStepAskCount: 0,
          lastQuestion: "",
          openIssue: undefined,
        },
      },
    };
  }

  let { mirror, ask: coachQ } = decision.coach;
  ({ mirror, coachQuestion: coachQ } = planCoach(mirror, coachQ));
  if (
    buildStep === "ready" &&
    areChainSlotsSemanticallyValid(workingSlots, body)
  ) {
    coachQ = "";
    if (
      !mirror?.trim() ||
      /请补|具体.*例子|职业|行业|举例/.test(mirror)
    ) {
      mirror =
        "本段论证功能已闭环，请看左侧链条与下方进度；要改哪一层直接说。";
    }
  }
  const userVisible = [mirror, coachQ, progressBlock].filter(Boolean).join("\n\n");

  return {
    result: {
      verdict: "coach",
      advance: false,
      mirror,
      coachQuestion: coachQ,
      userVisibleText: buildStage2OutputContract({
        state: nextState,
        body,
        module: buildStep,
        meaningOk: true,
        meaningReason: "核心意思可理解",
        paragraphFit: buildStep === "ready",
        paragraphReason:
          buildStep === "ready"
            ? "链条闭环，可并入"
            : `当前还缺 ${SLOT_LABEL[buildStep]}`,
        feedback: userVisible,
        suggestedRevision:
          buildStep === "ready"
            ? "检查链条是否需要微调。"
            : `按问题只补一句${SLOT_LABEL[buildStep]}。`,
        nextStep: coachQ || "继续按当前进度推进。",
      }),
      logicBreakdown: undefined,
    },
    state: {
      ...nextState,
      coachContext: {
        ...nextState.coachContext,
        chainBuildStep: buildStep,
        chainLastAskedStep: buildStep,
        chainStepAskCount: nextChainAskCount(state, buildStep, coachQ),
        lastQuestion: coachQ,
        openIssue: coachQ || substance.coachPrompt,
      },
    },
  };
}

const SLOT_HINT: Record<Exclude<ChainBuildStep, "ready">, string> = {
  claim: "核心立场",
  reason: "因果机制",
  example: "具体支撑",
  link: "段末收束",
};

const SLOT_LABEL: Record<Exclude<ChainBuildStep, "ready">, string> = {
  claim: "核心立场（Claim）",
  reason: "因果机制（Causal）",
  example: "具体支撑（Grounding）",
  link: "段末收束（Link）",
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
