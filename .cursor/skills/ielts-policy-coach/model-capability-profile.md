# Model Capability Profile (Runtime Portability)

Runtime sophistication may exceed model ability to obey `ArbitratedTurnPlan`. Same pipeline, different models → different failure modes.

## Problem

| Model class | Typical behavior |
|-------------|------------------|
| Strong instruction | Stable plan adherence, good discourse |
| Divergent | Ignores `primaryGap`; extra questions |
| Small / weak | Soft-ignore abstractions; template drift |
| Question-obsessed | Always asks even on `action: finalize` |

**Runtime portability:** one arbitration stack must adapt per model, not assume one LLM.

## ModelCapabilityProfile

```typescript
interface ModelCapabilityProfile {
  modelId: string;
  planAdherenceTier: "high" | "medium" | "low";
  abstractionTolerance: "full" | "reduced" | "minimal";  // objective/discourseShape/intervention
  maxIntentHintLength: number;
  requiresHardFinalizeEnforcement: boolean;  // always strip coachQuestion on finalize
  allowLlmQuestionOnGap: boolean;            // false → template question after 1 fail
  adherenceThreshold: number;                // CI gate per model
}
```

**Module:** `model-capability-profile.ts` — registry keyed by env `LLM_MODEL` or config.

## Runtime adjustments by tier

### high (e.g. strong GPT-class)

- Full `ArbitratedTurnPlan` in prompt
- `abstractionTolerance: full`
- Adherence CI ≥85%
- One guardrail regen on gap mismatch

### medium

- Same plan; shorter `intentHint`
- `requiresHardFinalizeEnforcement: true`
- Adherence CI ≥75%
- Prefer `generateCoachTurn` enforcement over prompt trust

### low

- `abstractionTolerance: minimal` — inject only:
  ```json
  { "action": "coach|finalize", "primaryGap": "causal", "questionTemplate": "..." }
  ```
- Drop `discourseShape` / `objective` from prompt (keep in trace for debug)
- Adherence CI ≥60% or **force deterministic mode** for coach question
- Consider `COACH_RUNTIME_MODE=deterministic` as default for session

## Plan simplification

```typescript
function simplifyPlanForModel(plan: ArbitratedTurnPlan, profile: ModelCapabilityProfile): ArbitratedTurnPlan {
  if (profile.abstractionTolerance === "minimal") {
    return {
      ...plan,
      objective: "none",
      discourseShape: "none",
      intervention: plan.action === "finalize" ? "none" : "guided_probe",
      intentHint: truncate(plan.intentHint, profile.maxIntentHintLength),
      questionTemplate: gapToTemplate(plan.primaryGap),
    };
  }
  return plan;
}
```

Simplify **prompt input**, not arbitration logic — trace still records full plan.

## Calibration workflow

1. Run [golden-fixtures.md](golden-fixtures.md) per model
2. Record adherence distribution
3. Assign tier; set thresholds
4. Re-run CI matrix: `model × fixture`

Store results: `tests/fixtures/model-profiles/{modelId}.json`

## PR rule

New model support PR must include profile + golden replay scores — not copy default tier.

## Interaction with kill-switch

Low tier + 2 adherence failures → auto [degradation-killswitch.md](degradation-killswitch.md) `deterministic`.

Do not add model-specific branches inside arbitration — only realization layer + mode selection.

## Anti-pattern

Duplicating entire runtime per vendor. **One arbitration, N realization profiles.**
