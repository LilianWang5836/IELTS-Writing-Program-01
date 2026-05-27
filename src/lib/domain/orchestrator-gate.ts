import { sampleStage3Task } from "./stage3-task-sampler";
import { buildOutputContract } from "./output-contract";
import type { LlmTurnResult, SessionState } from "./types";

function resolveModuleLabel(state: SessionState, subStep: SessionState["subStep"]): string {
  if (subStep === "S1_EVAL") return "stage1:planning";
  if (subStep === "S2_2_BODY1") return "body1:global";
  if (subStep === "S2_3_BODY2") return "body2:global";
  if (subStep === "S2_4_CONCLUSION") return "conclusion:planning";
  if (subStep === "S3_2_MODULE") {
    const task = sampleStage3Task(state);
    return task?.taskType ?? "sentence";
  }
  if (subStep === "S3_3_BODY_CHECK") return "body-check";
  return subStep.toLowerCase();
}

export function observeOrchestratorHardGate(
  state: SessionState,
  input: {
    subStep: SessionState["subStep"];
    hit: boolean;
    layer?: "essay" | "paragraph";
    reason?: string;
  },
): SessionState {
  const o = state.s3?.orchestrator;
  if (!o || o.mode !== "hard") return state;

  const prev = state.coachContext?.orchestratorGate;
  const totalHits = (prev?.totalHits ?? 0) + (input.hit ? 1 : 0);
  const consecutiveHits = input.hit ? (prev?.consecutiveHits ?? 0) + 1 : 0;
  const hardModeTurns = (prev?.hardModeTurns ?? 0) + 1;
  const shouldSuggestDowngrade =
    input.hit && consecutiveHits >= 3 && hardModeTurns >= 5;

  return {
    ...state,
    coachContext: {
      ...state.coachContext,
      orchestratorGate: {
        totalHits,
        consecutiveHits,
        hardModeTurns,
        lastLayer: input.hit ? input.layer : prev?.lastLayer,
        lastReason: input.hit ? input.reason : prev?.lastReason,
        lastSubStep: input.hit ? input.subStep : prev?.lastSubStep,
        downgradeSuggested:
          shouldSuggestDowngrade || prev?.downgradeSuggested || false,
        suggestedMode:
          shouldSuggestDowngrade ? "soft" : prev?.suggestedMode,
        suggestReason: shouldSuggestDowngrade
          ? "hard gate 连续命中 >=3 且 hard 轮数 >=5"
          : prev?.suggestReason,
        suggestedAtHits: shouldSuggestDowngrade
          ? totalHits
          : prev?.suggestedAtHits,
      },
    },
  };
}

export function applyOrchestratorHardGate(
  state: SessionState,
  result: LlmTurnResult,
  subStep: SessionState["subStep"],
): { result: LlmTurnResult; state: SessionState } | null {
  const o = state.s3?.orchestrator;
  if (!o || o.mode !== "hard") return null;

  const blockedByEssay = o.focusLayer === "essay" && o.essayContradiction;
  const blockedByParagraph = o.focusLayer === "paragraph" && o.paragraphDrift;
  if (!blockedByEssay && !blockedByParagraph) return null;

  if (subStep !== "S1_EVAL" && subStep !== "S2_2_BODY1" && subStep !== "S2_3_BODY2" && subStep !== "S3_2_MODULE" && subStep !== "S3_3_BODY_CHECK") {
    return null;
  }

  const hitLayer: "essay" | "paragraph" = blockedByEssay ? "essay" : "paragraph";
  const hitReason = blockedByEssay ? "essay-contradiction" : "paragraph-drift";
  const observed = observeOrchestratorHardGate(state, {
    subStep,
    hit: true,
    layer: hitLayer,
    reason: hitReason,
  });

  const feedback = blockedByEssay
    ? "当前先处理全篇一致性：你的两段或论点方向存在冲突。先把主张统一，再做句子细修。"
    : "当前先处理段内角色一致性：这句/这段偏离了当前模块功能。先修回该段职责，再做词法语法细修。";
  const gateTelemetry = observed.coachContext?.orchestratorGate;
  const downgradeHint = gateTelemetry?.downgradeSuggested
    ? "（系统建议：Hard Gate 连续拦截较多，可临时切到 soft 以恢复推进，再回 hard。）"
    : "";
  const nextStepBase = blockedByEssay
    ? "先提交一句与总论点同向的句子，确认整篇方向一致。"
    : "先提交一句明确承担当前段功能的句子（claim/reason/example/link）。";
  const nextStep = `${nextStepBase}${downgradeHint}`;

  const coachQuestion = blockedByEssay
    ? "先统一整篇方向，再继续下一步。"
    : "先修回段内角色，再继续。";

  const gateResult: LlmTurnResult = {
    ...result,
    verdict: "coach",
    advance: false,
    mirror: feedback,
    coachQuestion,
    userVisibleText: buildOutputContract({
      module: resolveModuleLabel(state, subStep),
      meaningOk: false,
      meaningReason: "Hard Gate 生效：优先处理上层矛盾",
      paragraphFit: !blockedByParagraph,
      paragraphReason: blockedByEssay ? "先修全篇一致性" : "先修段内角色一致性",
      feedback,
      suggestedRevision: blockedByEssay
        ? "先写一句和你的总立场同向的句子。"
        : "先写一句只承担当前段功能的句子。",
      nextStep,
      orchestrator: o,
    }),
    syntaxHint: undefined,
  };

  const nextState: SessionState = {
    ...observed,
    coachContext: {
      ...observed.coachContext,
      lastQuestion: coachQuestion,
      openIssue: blockedByEssay ? "Orchestrator(essay)" : "Orchestrator(paragraph)",
    },
    ...(state.s3
      ? {
          s3: {
            ...state.s3,
            mode: "coach",
          },
        }
      : {}),
  };

  return { result: gateResult, state: nextState };
}
