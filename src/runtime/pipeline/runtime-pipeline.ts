import type { SessionState } from "@/lib/domain/types";
import type { LlmTurnResult } from "@/lib/domain/types";
import { evaluateAdherence } from "../adherence/evaluate-adherence";
import { arbitrateTurnDecision } from "../arbitration/arbitrate-turn";
import {
  resolveFinalizeDecision,
  resolvePhaseGate,
} from "../arbitration/finalize-decision";
import { generateCoachTurn } from "../generation/generate-coach-turn";
import {
  getModelCapabilityProfile,
  simplifyPlanForModel,
} from "../model/capability-profile";
import {
  assessRuntimeHealth,
  maybeDegradeRuntimeMode,
  recordAdherenceFailureCount,
  resolveCoachRuntimeMode,
  type RuntimeModeContext,
} from "../mode/resolve-runtime-mode";
import { suggestPolicyPreference } from "../policy/suggest-policy";
import { buildCoachTurnTrace } from "../trace/coach-trace";
import { buildCoachWorldState } from "../world/coach-world-state";
import type { RuntimeCoachOutput, RuntimeModeTransition } from "../types";

export interface RuntimePipelineInput {
  state: SessionState;
  userMessage: string;
  llmResult?: Partial<LlmTurnResult>;
  turnIndex: number;
  runtimeCtx?: RuntimeModeContext;
  body?: "body1" | "body2";
  persistTrace?: (trace: ReturnType<typeof buildCoachTurnTrace>) => void;
}

/** v2.3 pipeline skeleton — no replacement of legacy postProcess yet. */
export function runRuntimePipeline(input: RuntimePipelineInput): RuntimeCoachOutput {
  const health = assessRuntimeHealth(input.runtimeCtx ?? {});
  const runtimeMode = resolveCoachRuntimeMode(input.runtimeCtx ?? {}, health);
  const profile = getModelCapabilityProfile();

  const world = buildCoachWorldState(input.state, input.userMessage, {
    body: input.body,
  });

  const phaseGate = resolvePhaseGate(world);
  const finalizeDecision = resolveFinalizeDecision(world.coaching, phaseGate);

  const userMsgs = input.state.chatHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  const policyContext = {
    state: input.state,
    userMessages: userMsgs,
  };

  let plan =
    runtimeMode === "deterministic"
      ? arbitrateTurnDecision({
          world,
          policyPreference: {
            objective: "none",
            discourseShape: "none",
            intervention: "guided_probe",
            allowCompoundMove: false,
            intentHint: "",
          },
          phaseGate,
          finalizeDecision,
        })
      : (() => {
          const policyPreference = suggestPolicyPreference(world, policyContext);
          return arbitrateTurnDecision({
            world,
            policyPreference,
            phaseGate,
            finalizeDecision,
          });
        })();

  plan = simplifyPlanForModel(plan, profile);

  const coach = generateCoachTurn(plan, input.llmResult, {
    forceDeterministic: runtimeMode === "deterministic",
  });

  const adherence = evaluateAdherence({
    plan,
    mirror: coach.mirror,
    coachQuestion: coach.coachQuestion,
  });
  adherence.enforcedBy = coach.enforcedBy;

  const degrade = maybeDegradeRuntimeMode(input.runtimeCtx ?? {}, adherence);
  let runtimeTransition: RuntimeModeTransition | undefined;
  if (degrade.transitionReason && degrade.mode !== runtimeMode) {
    runtimeTransition = {
      from: runtimeMode,
      to: degrade.mode,
      reason: degrade.transitionReason,
    };
  }

  const trace = buildCoachTurnTrace({
    sessionId: input.state.sessionId,
    turnIndex: input.turnIndex,
    subStep: input.state.subStep,
    runtimeMode,
    world,
    phaseGate,
    finalizeDecision,
    policyPreference:
      runtimeMode === "full"
        ? suggestPolicyPreference(world, policyContext)
        : undefined,
    arbitrationDecision: plan,
    generatedPlan: plan,
    modelProfileId: profile.modelId,
    adherenceReport: adherence,
    runtimeTransition,
    llmRaw: {
      mirror: input.llmResult?.mirror,
      coachQuestion: input.llmResult?.coachQuestion,
    },
    finalOutput: { mirror: coach.mirror, coachQuestion: coach.coachQuestion },
  });

  input.persistTrace?.(trace);

  if (input.runtimeCtx) {
    input.runtimeCtx.consecutiveAdherenceFailures = recordAdherenceFailureCount(
      input.runtimeCtx,
      adherence,
    );
    if (degrade.transitionReason) {
      input.runtimeCtx.runtimeMode = degrade.mode;
    }
  }

  return {
    mirror: coach.mirror,
    coachQuestion: coach.coachQuestion,
    plan,
    trace,
    runtimeMode,
  };
}
