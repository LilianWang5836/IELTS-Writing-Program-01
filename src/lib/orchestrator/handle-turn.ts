import { STAGE1_OPENING, MODULE_LABELS } from "@/lib/domain/constants";
import { applyHandoffToState, validateHandoff } from "@/lib/domain/handoff";
import { sampleStage3Task } from "@/lib/domain/stage3-task-sampler";
import { buildRuleHintsBlock, ruleHintsForHandoff } from "@/lib/domain/rule-hints";
import { resolvePromptModule, stageLabel } from "@/lib/domain/router";
import { normalizeBlueprint } from "@/lib/domain/blueprint-from-s2";
import { migrateSessionState } from "@/lib/domain/migrate-state";
import { applyOrchestratorShadow } from "@/lib/domain/essay-orchestrator";
import { buildStage3OutputContract } from "@/lib/domain/output-contract";
import {
  applyOrchestratorHardGate,
  observeOrchestratorHardGate,
} from "@/lib/domain/orchestrator-gate";
import { appendChat, stateSummary } from "@/lib/domain/state";
import { validateUserSentence } from "@/lib/domain/validate";
import type {
  LlmTurnResult,
  PromptModuleId,
  SessionState,
  Stage1Handoff,
} from "@/lib/domain/types";
import { logicBreakdownFromProposal } from "@/lib/domain/chain-proposal";
import {
  assessEssaySubstance,
  explorationSideStatus,
  isStage1ChainLeakMessage,
  resolveConfirmableHandoffProposal,
  userMessages,
} from "@/lib/domain/essay-substance";
import { assessParagraphSubstance } from "@/lib/domain/paragraph-substance";
import {
  assessExplorationContent,
  isProposalAffirmation,
  postProcessStage1,
} from "@/lib/domain/stage1-coach";
import {
  buildStage1SubmitFeedback,
  enrichHandoffFromChat,
  sanitizeHandoffProposal,
} from "@/lib/domain/essay-substance";
import {
  applyChainProposalToState,
  postProcessStage2,
} from "@/lib/domain/stage2-coach";
import {
  assessMeaningAlignment,
  assessLocalViability,
  buildScaffoldResponse,
  detectStage3SentenceIntent,
  diagnoseSentence,
  looksStructurallyWorkable,
  type LocalViabilityResult,
  postProcessStage3Sentence,
} from "@/lib/domain/sentence-coach";
import type { BodyKey, WorkshopBodyKey } from "@/lib/domain/types";
import { formatCoachDisplay } from "@/lib/llm/guard";
import { callLlm, callLlmJson } from "@/lib/llm/client";
import { buildFullPrompt } from "@/lib/prompts/loader";
import { markerWhenAdvance, shouldAdvance } from "./advance";
import {
  afterBodyCheck,
  advanceModuleAfterPass,
  applyBlueprint,
  applyBodyCoachUpdate,
  applyHandoffAdvance,
  applyStage2Body1Advance,
  applyStage2Body2Advance,
  appendMarker,
  bodyTaskAfterBody1,
  bodyTaskAfterHandoff,
  integrateBodySentences,
  markerForSubStep,
  mergeS1FromResult,
} from "./transitions";

export interface TurnResponse {
  replies: string[];
  state: SessionState;
  requiresConfirm: boolean;
  canSubmit: boolean;
}

/**
 * 句子写入条件满足时自动推进：
 * - stabilizable：完全通过，无 correction。
 * - refine_needed：accept-with-correction，原句已写入，coach 上一条消息已贴 correction。
 *
 * 触发后调 advanceModuleAfterPass + 下一句 assign（或 body check）。
 * 用户不再需要点「确认写入」按钮；handleConfirm 保留作兜底入口。
 */
async function autoAdvanceIfPassable(
  state: SessionState,
  replies: string[],
): Promise<SessionState> {
  const passable =
    state.coachContext?.sentenceState === "stabilizable" ||
    state.coachContext?.sentenceState === "refine_needed";
  if (
    state.subStep !== "S3_2_MODULE" ||
    state.s3?.mode !== "feedback" ||
    !state.s3?.pendingSentence ||
    !passable
  ) {
    return state;
  }

  let s = advanceModuleAfterPass(state);

  if (s.subStep === "S3_3_BODY_CHECK") {
    const { reply, state: ns, autoContinue } = await processLlmTurn(s, "P3_3");
    replies.push(reply);
    s = ns;
    if (autoContinue && s.subStep === "S3_2_MODULE") {
      const next = await processLlmTurn(s, "P3_2");
      replies.push(next.reply);
      s = next.state;
    }
  } else if (s.subStep === "S3_2_MODULE") {
    const { reply, state: ns } = await processLlmTurn(s, "P3_2");
    replies.push(reply);
    s = ns;
  }
  return s;
}

function ensureMigrated(state: SessionState): SessionState {
  return migrateSessionState(state);
}

async function runPrompt(
  state: SessionState,
  moduleId: PromptModuleId,
  vars: Record<string, string>,
  userMessage?: string,
): Promise<LlmTurnResult> {
  const prompt = buildFullPrompt(moduleId, { query: state.topic, ...vars }, {
    stageName: stageLabel(state),
    subStepName: state.subStep,
  });
  return callLlm(prompt, moduleId, {
    userMessage,
    subStep: state.subStep,
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeViabilityFromLlm(raw: unknown): LocalViabilityResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    score?: unknown;
    confidence?: unknown;
    issues?: unknown;
  };
  const score =
    typeof obj.score === "number" ? clamp01(obj.score) : undefined;
  const confidence =
    typeof obj.confidence === "number" ? clamp01(obj.confidence) : undefined;
  if (typeof score !== "number" || typeof confidence !== "number") return null;

  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const i = it as { kind?: unknown; severity?: unknown; note?: unknown };
          const kind =
            i.kind === "collocation" ||
            i.kind === "phrase_naturalness" ||
            i.kind === "semantic_plausibility" ||
            i.kind === "target_role"
              ? i.kind
              : null;
          const severity =
            typeof i.severity === "number" ? clamp01(i.severity) : 0.2;
          const note = typeof i.note === "string" ? i.note.trim() : "";
          if (!kind || !note) return null;
          return { kind, severity, note };
        })
        .filter(
          (
            it,
          ): it is {
            kind:
              | "collocation"
              | "phrase_naturalness"
              | "semantic_plausibility"
              | "target_role";
            severity: number;
            note: string;
          } => !!it,
        )
    : [];

  return {
    score,
    confidence,
    issues,
  };
}

async function reviewViabilityWithLlm(
  sentence: string,
): Promise<LocalViabilityResult | null> {
  const prompt = [
    "You are a sentence viability evaluator for IELTS writing coaching.",
    "Task: assess minimum linguistic naturalness only.",
    "DO NOT evaluate argument completeness, paragraph coherence, discourse sufficiency, thesis alignment, or stance quality.",
    "Return JSON only with this exact schema:",
    '{"score": number, "confidence": number, "issues": [{"kind":"collocation|phrase_naturalness|semantic_plausibility|target_role","severity": number, "note": string}]}',
    "score and confidence must be between 0 and 1.",
    `Sentence: ${sentence}`,
  ].join("\n");

  try {
    const raw = await callLlmJson<unknown>(prompt);
    return normalizeViabilityFromLlm(raw);
  } catch {
    return null;
  }
}

function buildVars(
  state: SessionState,
  userMessage?: string,
): Record<string, string> {
  const base: Record<string, string> = {
    state_summary: stateSummary(state),
    user_message: userMessage ?? "",
    rule_hints: buildRuleHintsBlock(state),
  };

  if (state.handoff) {
    base.handoff_json = JSON.stringify(state.handoff);
  }
  if (state.s1) {
    base.s1_position = state.s1.position;
    base.s1_json = JSON.stringify(state.s1);
  }
  if (state.s2) {
    base.body1_point = state.s2.body1Point;
    base.body2_point = state.s2.body2Point;
    base.body1_angle = state.s2.body1Angle;
    base.body2_angle = state.s2.body2Angle;
    base.body1_logic = state.s2.body1Logic?.slots
      ? JSON.stringify(state.s2.body1Logic.slots)
      : (state.s2.body1.chainSummary ?? state.s2.body1Logic?.raw ?? "");
    base.body2_logic = state.s2.body2Logic?.slots
      ? JSON.stringify(state.s2.body2Logic.slots)
      : (state.s2.body2.chainSummary ?? state.s2.body2Logic?.raw ?? "");
    base.s2_json = JSON.stringify({
      body1: state.s2.body1,
      body2: state.s2.body2,
    });
  }
  if (state.coachContext?.openIssue) {
    base.open_issue = state.coachContext.openIssue;
  }
  if (state.coachContext?.lastQuestion) {
    base.last_coach_question = state.coachContext.lastQuestion;
  }
  if (state.subStep === "S1_EVAL" && !state.handoffLocked) {
    const substance = assessEssaySubstance(state);
    const { contentReady } = assessExplorationContent(state, userMessage);
    const explorationSides = explorationSideStatus(userMessages(state));
    base.substance_assessment = JSON.stringify({
      contentReady,
      substanceSufficient: substance.sufficient,
      explorationSides,
      gaps: substance.gaps,
      handoffPhase: state.coachContext?.handoffPhase ?? "exploring",
      exploreRound: state.coachContext?.exploreRound ?? 0,
    });
  }
  if (state.subStep === "S2_2_BODY1" || state.subStep === "S2_3_BODY2") {
    const body: WorkshopBodyKey = state.subStep === "S2_2_BODY1" ? "body1" : "body2";
    const substance = assessParagraphSubstance(state, body, userMessage);
    const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
    base.paragraph_substance_assessment = JSON.stringify({
      substanceSufficient: substance.sufficient,
      gaps: substance.gaps,
      chainPhase: seg?.chainPhase ?? "coaching",
      chainBuildStep: state.coachContext?.chainBuildStep ?? "claim",
      bodyPoint: body === "body1" ? state.s2?.body1Point : state.s2?.body2Point,
      bodyAngle: body === "body1" ? state.s2?.body1Angle : state.s2?.body2Angle,
      coachMode: "hybrid_llm_role_rule_gate",
    });
  }

  if (state.s3) {
    const sampledTask = sampleStage3Task(state);
    const body = sampledTask?.body ?? state.s3.currentBody;
    const mod = sampledTask?.taskType ?? null;
    base.current_body = body;
    base.current_module = mod ?? "";
    base.module_label = mod ? MODULE_LABELS[mod] ?? mod : "";
    base.mode = state.s3.mode;
    const bp = normalizeBlueprint(state, state.s3.blueprint);
    if (body !== "conclusion" && mod) {
      const b = bp[body as "body1" | "body2"];
      const flow = b?.logicFlow;
      if (flow) {
        const dir =
          mod === "claim"
            ? flow.claimDirection
            : mod === "reason"
              ? flow.reasonDirection
              : flow.supportDirection;
        base.module_direction = dir;
      }
    } else if (mod && bp.conclusion) {
      base.module_direction =
        mod === "conclusion_restate"
          ? bp.conclusion.restateDirection
          : bp.conclusion.summaryLogicDirection;
    }
    if (state.subStep === "S3_3_BODY_CHECK") {
      base.body_sentences = integrateBodySentences(state, body);
    }
    if (state.subStep === "S3_2_MODULE" && userMessage?.trim()) {
      const sentenceTask = sampledTask?.taskType ?? null;
      const meaning = assessMeaningAlignment(
        state,
        userMessage,
        sentenceTask ?? undefined,
      );
      const diagnosis = diagnoseSentence(userMessage, sentenceTask ?? undefined);
      base.sentence_diagnosis = JSON.stringify({
        meaningAligned: meaning.aligned,
        meaningMissing: meaning.missing,
        pass: diagnosis.pass,
        priority: diagnosis.priority,
        kind: diagnosis.kind,
        labelZh: diagnosis.labelZh,
        repairQuestionZh: diagnosis.repairQuestionZh,
        hintZh: diagnosis.hintZh,
      });
    }
    if (state.s3.orchestrator) {
      base.orchestrator_snapshot = JSON.stringify(state.s3.orchestrator);
      base.current_focus_layer = state.s3.orchestrator.focusLayer;
    }
    if (state.coachContext?.sentenceState) {
      base.sentence_state = state.coachContext.sentenceState;
    }
    if (state.coachContext?.orchestratorGate) {
      base.orchestrator_gate_telemetry = JSON.stringify(
        state.coachContext.orchestratorGate,
      );
    }
  }
  return base;
}

async function processLlmTurn(
  state: SessionState,
  moduleId: PromptModuleId,
  userMessage?: string,
): Promise<{ reply: string; state: SessionState; autoContinue: boolean }> {
  const prevSubStep = state.subStep;
  let result = await runPrompt(
    state,
    moduleId,
    buildVars(state, userMessage),
    userMessage,
  );

  let nextState = state;
  let autoContinue = false;
  const gated = applyOrchestratorHardGate(state, result, prevSubStep);
  if (gated) {
    result = gated.result;
    nextState = gated.state;
    const reply = formatCoachDisplay(result, {
      stage1: prevSubStep === "S1_EVAL",
      stage2: prevSubStep === "S2_2_BODY1" || prevSubStep === "S2_3_BODY2",
      stage3Sentence: prevSubStep === "S3_2_MODULE",
    });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }
  nextState = observeOrchestratorHardGate(state, {
    subStep: prevSubStep,
    hit: false,
  });

  if (prevSubStep === "S1_EVAL") {
    const processed = postProcessStage1(nextState, result, userMessage);
    result = processed.result;
    nextState = mergeS1FromResult(processed.state, result);
    const reply = formatCoachDisplay(result, { stage1: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  if (prevSubStep === "S2_2_BODY1" || prevSubStep === "S2_3_BODY2") {
    const body: BodyKey = prevSubStep === "S2_2_BODY1" ? "body1" : "body2";
    const processed = postProcessStage2(nextState, result, body, userMessage);
    result = processed.result;
    nextState = applyBodyCoachUpdate(processed.state, body, result, userMessage);
    const reply = formatCoachDisplay(result, { stage2: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  if (prevSubStep === "S3_2_MODULE") {
    let viabilityOverride: LocalViabilityResult | undefined;
    const sentenceInput =
      userMessage?.trim() ?? nextState.s3?.pendingSentence?.trim() ?? "";
    const sampledTask = sampleStage3Task(nextState);
    const sentenceTask = sampledTask?.taskType ?? undefined;
    if (sentenceInput) {
      const meaning = assessMeaningAlignment(nextState, sentenceInput, sentenceTask);
      const structuralWorkable = looksStructurallyWorkable(sentenceInput);
      if (meaning.aligned && structuralWorkable) {
        const local = assessLocalViability(sentenceInput);
        if (!(local.score >= 0.75 && local.confidence >= 0.8)) {
          const llmReviewed = await reviewViabilityWithLlm(sentenceInput);
          if (llmReviewed) viabilityOverride = llmReviewed;
        }
      }
    }
    const processed = postProcessStage3Sentence(
      nextState,
      result,
      userMessage,
      viabilityOverride,
    );
    result = processed.result;
    nextState = processed.state;
    const reply = formatCoachDisplay(result, { stage3Sentence: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  let reply = formatCoachDisplay(result);
  const advance = shouldAdvance(state, prevSubStep, result);

  if (markerWhenAdvance(prevSubStep, result, advance)) {
    const m = markerForSubStep(prevSubStep);
    if (m) reply = appendMarker(reply, m);
  }

  if (prevSubStep === "S3_1_BLUEPRINT" && advance) {
    nextState = applyBlueprint(nextState, result);
    autoContinue = true;
  } else if (prevSubStep === "S3_3_BODY_CHECK") {
    if (result.verdict === "pass" && advance) {
      const integrated =
        result.integratedBodyText ??
        integrateBodySentences(nextState, nextState.s3!.currentBody);
      nextState = afterBodyCheck(
        {
          ...nextState,
          s3: {
            ...nextState.s3!,
            integratedBodies: {
              ...nextState.s3!.integratedBodies,
              ...(nextState.s3!.currentBody !== "conclusion"
                ? { [nextState.s3!.currentBody]: integrated }
                : {}),
            },
          },
        },
        { ...result, integratedBodyText: integrated },
      );
      autoContinue = nextState.subStep === "S3_2_MODULE";
    } else if (result.verdict === "fail" || result.verdict === "coach") {
      nextState = afterBodyCheck(nextState, result);
    }
  }

  nextState = appendChat(nextState, "assistant", reply);
  return { reply, state: nextState, autoContinue };
}

export async function handleInit(state: SessionState): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const opening = STAGE1_OPENING;
  const s = appendChat(
    { ...s0, subStep: "S1_EVAL" as SessionState["subStep"] },
    "assistant",
    opening,
  );
  return {
    replies: [opening],
    state: s,
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleConfirmChainProposal(
  state: SessionState,
  body: WorkshopBodyKey,
): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const seg = body === "body1" ? s0.s2?.body1 : s0.s2?.body2;
  const proposal = seg?.chainProposal;

  if (!proposal || seg?.chainPhase !== "proposed") {
    return {
      replies: ["请先与教练聊清论证，待左侧出现「教练整理链条」后再确认。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = applyChainProposalToState(s0, body, proposal);
  const logicKey = body === "body1" ? "body1Logic" : "body2Logic";
  const synthetic: LlmTurnResult = {
    verdict: "pass",
    advance: true,
    userVisibleText: "",
    logicBreakdown: logicBreakdownFromProposal(proposal, body),
    extracted: {
      [logicKey]: {
        primaryDriver: "causal",
        slots: proposal.slots,
        missing: [],
        raw: proposal.draft,
      },
    },
  };

  const replies: string[] = [];

  if (body === "body1") {
    s = applyStage2Body1Advance(s, synthetic, proposal.draft);
    const reply = `Body1 论证链已确认。${bodyTaskAfterBody1(s)}`;
    replies.push(reply);
    s = appendChat(s, "assistant", reply);
    return {
      replies,
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyStage2Body2Advance(s, synthetic, proposal.draft);
  let reply = "Body2 论证链已确认，正在准备逐句写作…";
  replies.push(reply);
  s = appendChat(s, "assistant", reply);

  const bp = await processLlmTurn(s, "P3_1");
  replies.push(bp.reply);
  s = bp.state;

  if (bp.autoContinue && s.subStep === "S3_2_MODULE") {
    const next = await processLlmTurn(s, "P3_2");
    replies.push(next.reply);
    s = next.state;
  }

  return {
    replies,
    state: s,
    requiresConfirm: false,
    canSubmit: s.subStep !== "COMPLETED",
  };
}

export async function handleConfirmHandoffProposal(
  state: SessionState,
): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const raw = s0.handoffProposal;
  if (!raw) {
    return {
      replies: ["还没有可确认的整理，请继续在右侧聊审题。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  const proposal =
    sanitizeHandoffProposal(enrichHandoffFromChat(raw, s0), s0) ?? raw;

  const s: SessionState = {
    ...s0,
    handoff: { ...proposal },
    handoffProposal: undefined,
    coachContext: {
      ...s0.coachContext,
      handoffPhase: "editing",
      readyForHandoff: true,
    },
  };
  const reply =
    "好，已填入左侧。请核对六栏，无误后点「提交审题定稿」，再进入 Body1。";
  return {
    replies: [reply],
    state: appendChat(s, "assistant", reply),
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleSubmitHandoff(
  state: SessionState,
  handoff: Stage1Handoff,
): Promise<TurnResponse> {
  const handoffEnriched = enrichHandoffFromChat(handoff, state);
  let s = ensureMigrated({ ...state, handoff: handoffEnriched });

  const v = validateHandoff(handoffEnriched);
  if (!v.ok) {
    return {
      replies: [v.errors.join("；")],
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  const rules = ruleHintsForHandoff(handoffEnriched);
  if (rules.blockAdvance) {
    return {
      replies: [
        `请先调整审题定稿：${rules.warnings.join(" ")}`,
      ],
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyHandoffToState(s, handoffEnriched);

  let result: LlmTurnResult;
  try {
    result = await runPrompt(s, "P1H", {
      query: s.topic,
      handoff_json: JSON.stringify(handoffEnriched),
      s1_json: JSON.stringify(s.s1 ?? {}),
      state_summary: stateSummary(s),
    });
  } catch {
    result = {
      verdict: "pass",
      advance: true,
      userVisibleText: `审题定稿已收到。${bodyTaskAfterHandoff(s)}`,
    };
  }

  if (!shouldAdvance(s, "S1_EVAL", result)) {
    const reply = formatCoachDisplay({
      ...result,
      advance: false,
    });
    return {
      replies: [reply],
      state: appendChat(s, "assistant", reply),
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyHandoffAdvance(s);
  const reply = `${buildStage1SubmitFeedback(handoffEnriched)}\n\n${bodyTaskAfterHandoff(s)}`;
  s = appendChat(s, "assistant", reply);

  return {
    replies: [reply],
    state: s,
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleTurn(
  state: SessionState,
  message: string,
): Promise<TurnResponse> {
  const replies: string[] = [];
  let s = ensureMigrated(state);
  s = applyOrchestratorShadow(s, message);
  s = appendChat(s, "user", message);
  const moduleId = resolvePromptModule(s);

  if (moduleId === "OPENING" || moduleId === "NONE") {
    return {
      replies: ["训练已完成或未初始化。"],
      state: s,
      requiresConfirm: false,
      canSubmit: false,
    };
  }

  if (s.subStep === "COMPLETED") {
    return {
      replies: ["恭喜，本篇特训已完成！可重新开始新题目。"],
      state: s,
      requiresConfirm: false,
      canSubmit: false,
    };
  }

  if (s.subStep === "S1_EVAL" && !s.handoffLocked) {
    if (isProposalAffirmation(message)) {
      const prop = resolveConfirmableHandoffProposal(s);
      if (prop) {
        return handleConfirmHandoffProposal({
          ...s,
          handoffProposal: prop,
          coachContext: { ...s.coachContext, handoffPhase: "proposed" },
        });
      }
    }

    if (isStage1ChainLeakMessage(message)) {
      const reply =
        "这条更像 Body1 搭链里的句子。请先完成审题：点「确认整理并填入」→「提交审题定稿」，再写论证链。";
      return {
        replies: [reply],
        state: appendChat(s, "assistant", reply),
        requiresConfirm: false,
        canSubmit: true,
      };
    }

    if (s.coachContext?.handoffPhase === "proposed" && s.handoffProposal) {
      const reply =
        "整理稿已给出。请点左侧「确认整理并填入」，或回复「是」；要改哪一栏直接说。";
      return {
        replies: [reply],
        state: appendChat(s, "assistant", reply),
        requiresConfirm: false,
        canSubmit: true,
      };
    }
  }

  if (
    s.subStep === "S3_2_MODULE" &&
    (s.s3?.mode === "assign" ||
      s.s3?.mode === "coach" ||
      s.s3?.mode === "feedback") &&
    detectStage3SentenceIntent(message) === "scaffold"
  ) {
    const reply = buildScaffoldResponse(s);
    return {
      replies: [reply],
      state: appendChat(s, "assistant", reply),
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  if (s.subStep === "S3_2_MODULE" && s.s3?.mode === "assign") {
    const v = validateUserSentence(message);
    if (!v.ok) {
      return {
        replies: [
          buildStage3OutputContract({
            module: sampleStage3Task(s)?.taskType ?? null,
            meaningOk: false,
            meaningReason: "未进入判定（输入未通过基本规则）",
            paragraphFit: false,
            paragraphReason: v.error!,
            feedback: `输入有限制：${v.error!}\n请把这一句拆成一条不超过 45 词的英文句，再发一次。`,
            suggestedRevision: "把核心一句保留，把展开/解释拆到下一句。",
            nextStep: "改成单句（≤45 词）后重新发送。",
          }),
        ],
        state: s,
        requiresConfirm: false,
        canSubmit: true,
      };
    }
    s = {
      ...s,
      s3: { ...s.s3!, mode: "feedback", pendingSentence: message },
    };
    const { reply, state: ns } = await processLlmTurn(s, "P3_2", message);
    replies.push(reply);
    const advanced = await autoAdvanceIfPassable(ns, replies);
    return {
      replies,
      state: advanced,
      requiresConfirm: false,
      canSubmit: advanced.subStep !== "COMPLETED",
    };
  }

  if (
    s.subStep === "S3_2_MODULE" &&
    (s.s3?.mode === "feedback" || s.s3?.mode === "coach")
  ) {
    const v = validateUserSentence(message);
    if (!v.ok) {
      return {
        replies: [
          buildStage3OutputContract({
            module: sampleStage3Task(s)?.taskType ?? null,
            meaningOk: false,
            meaningReason: "未进入判定（输入未通过基本规则）",
            paragraphFit: false,
            paragraphReason: v.error!,
            feedback: `输入有限制：${v.error!}\n请把这一句拆成一条不超过 45 词的英文句，再发一次。`,
            suggestedRevision: "把核心一句保留，把展开/解释拆到下一句。",
            nextStep: "改成单句（≤45 词）后重新发送。",
          }),
        ],
        state: s,
        requiresConfirm: false,
        canSubmit: true,
      };
    }
    s = {
      ...s,
      s3: {
        ...s.s3!,
        pendingSentence: message,
        mode: "coach",
      },
    };
  }

  let auto = true;
  let guard = 0;
  while (auto && guard < 4) {
    guard++;
    const currentModule = resolvePromptModule(s);
    if (currentModule === "NONE" || currentModule === "OPENING") break;

    if (
      currentModule === "P3_2" &&
      s.s3?.mode === "assign" &&
      guard > 1 &&
      s.s3.lastAssignText
    ) {
      break;
    }

    const needsUser =
      s.subStep !== "S3_1_BLUEPRINT" &&
      !(s.subStep === "S3_2_MODULE" && s.s3?.mode === "assign" && guard > 1);

    const userMsg =
      s.subStep === "S3_2_MODULE" && s.s3?.mode === "feedback"
        ? message
        : guard === 1
          ? message
          : undefined;

    if (needsUser && guard > 1) break;

    const { reply, state: ns, autoContinue } = await processLlmTurn(
      s,
      currentModule as PromptModuleId,
      userMsg,
    );
    replies.push(reply);
    s = ns;
    auto = autoContinue;
  }

  s = await autoAdvanceIfPassable(s, replies);
  const requiresConfirm = false;

  return {
    replies,
    state: s,
    requiresConfirm,
    canSubmit: !requiresConfirm && s.subStep !== "COMPLETED",
  };
}

export async function handleConfirm(state: SessionState): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const acceptable =
    s0.coachContext?.sentenceState === "stabilizable" ||
    s0.coachContext?.sentenceState === "refine_needed";
  if (
    s0.subStep !== "S3_2_MODULE" ||
    !s0.s3?.pendingSentence ||
    !acceptable
  ) {
    return {
      replies: ["当前无需确认。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = advanceModuleAfterPass(s0);
  const replies: string[] = [];

  if (s.subStep === "S3_3_BODY_CHECK") {
    const { reply, state: ns, autoContinue } = await processLlmTurn(s, "P3_3");
    replies.push(reply);
    s = ns;
    if (autoContinue && s.subStep === "S3_2_MODULE") {
      const next = await processLlmTurn(s, "P3_2");
      replies.push(next.reply);
      s = next.state;
    }
  } else if (s.subStep === "S3_2_MODULE") {
    const { reply, state: ns } = await processLlmTurn(s, "P3_2");
    replies.push(reply);
    s = ns;
  }

  return {
    replies,
    state: s,
    requiresConfirm: false,
    canSubmit: s.subStep !== "COMPLETED",
  };
}
