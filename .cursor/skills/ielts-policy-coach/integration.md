# Integration (v2.3)

## Module map

| Module | Layer | Responsibility |
|--------|-------|----------------|
| `semantic-features.ts` | A | Raw extractors |
| `discourse-signals.ts` | B | Interpret A → discourse |
| `coaching-signals.ts` | C | Derive coaching abstractions |
| `engagement-signals.ts` | — | Fatigue / compliance |
| `coach-world-state.ts` | orchestrator | Thin A→B→C→assemble (~80 lines max) |
| `coach-finalize.ts` | L2 | `resolveFinalizeDecision(coaching, phase)` |
| `stage1-policy-skill.ts` | L2.5 | Reads `coaching` + `engagement` |
| `stage2-policy-skill.ts` | L2.5 | Reads `coaching` + `engagement` |
| `coach-arbitration.ts` | — | Deterministic + fatigue gate |
| `coach-turn-generator.ts` | L3 | Plan-bound generation |
| `coach-guardrail.ts` | L4 | Validate only |
| `coach-trace.ts` | — | [observability.md](observability.md) — required Phase A |
| `plan-adherence.ts` | L3 | Score + enforce; feeds kill-switch |
| `coach-runtime-mode.ts` | — | [degradation-killswitch.md](degradation-killswitch.md) |
| `model-capability-profile.ts` | L3 | [model-capability-profile.md](model-capability-profile.md) |
| `prompt-arbitrated-plan.ts` | L3 | Serialize plan for P1/P2 |

## Pipeline

```typescript
export function postProcessStage1(state, result, userMessage) {
  const health = assessRuntimeHealth(state);
  const runtimeMode = resolveCoachRuntimeMode(state.coachContext, health);
  if (runtimeMode === "legacy") return legacyPostProcessStage1(state, result, userMessage);
  if (runtimeMode === "deterministic") return deterministicPostProcessStage1(state, userMessage);

  const world = buildCoachWorldState(state, userMessage);
  const phaseGate = resolvePhaseGate(state);
  const finalizeDecision = resolveFinalizeDecision(world.coaching, phaseGate);
  const policyPreference = suggestStage1PolicyPreference(world);
  let plan = arbitrateTurnDecision({ world, policyPreference, phaseGate, finalizeDecision });
  plan = simplifyPlanForModel(plan, getModelCapabilityProfile());

  if (plan.action === "finalize") return buildFinalizeProposalTurn(state, plan);

  const llmResult = result;
  let coach = generateCoachTurn(plan, llmResult, state, userMessage);
  coach = guardrailCheckStage1(coach, world, plan);
  const adherence = scorePlanAdherence(plan, coach, llmResult);
  recordCoachTurnTrace({ runtimeMode, ...layers, arbitrationDecision: plan, planAdherence: adherence });
  maybeDegradeRuntimeMode(state.coachContext, adherence, health);
  return assembleStage1CoachResult(coach, plan, state);
}
```

Stage 2: same shape; pass `body` + `chainDecision` into world builder ctx.

## Prompt loader changes

```typescript
// Before LLM call in handle-turn
const world = buildCoachWorldState(state, userMessage);
const plan = arbitrateTurnDecision({ ... }); // or shadow-build for logging

promptVars.arbitrated_plan_json = serializeArbitratedPlan(plan);
promptVars.substance_assessment = summarizeCoachingSignals(world.coaching); // not raw themes
// Deprecate pedagogy in rule_hints
```

See [generation-contract.md](generation-contract.md) for P1/P2 strip list.

## Types

```typescript
interface CoachContext {
  refinementVetoBudgetRemaining?: number; // default 1
  lastArbitratedPlan?: ArbitratedTurnPlan;
  engagementHistory?: { wordCount: number; turnIndex: number }[]; // for trend
}
```

## Migration phases

| Phase | Work | Gate |
|-------|------|------|
| A — Pipeline + traces | A/B/C; `coach-trace.ts` | Trace schema validates |
| B — Shadow | Plan vs legacy | Replay answers "why finalize" |
| C — Arbitration | Finalize + fatigue | Golden fixtures no rubric regression |
| D — Prompt strip | P1/P2 pedagogy removal | Adherence ≥ profile threshold |
| E — Cleanup | Legacy ask demotion | Golden replay all green |
| F — Temporal | Multiplier / momentum | [pedagogical-roi.md](pedagogical-roi.md) + fast-growth fixture |
| G — Kill-switch + profiles | Degrade path + model tiers | Degraded fixtures stable |

**No runtime PR** without [golden-fixtures.md](golden-fixtures.md) replay + ROI note.

**Block Phase F/G** unless ROI proves user UX gain on ≥2 fixtures.

## Regression matrix

| Case | coaching | engagement | arbitrated |
|------|----------|------------|------------|
| S1 structure complete | readyToFinalize | ok | finalize |
| S1 weak body2 + budget | refinementCandidate | ok | one_refinement_turn |
| S1 "I don't know" + convenient | readyToFinalize | fatigueHigh | finalize (fatigueOverride) |
| S1 concession weak, not ready | concessionCoverage weak | ok | coach / concession |
| S2 closure partial + multi-fn turn | primaryGap closure | ok | coach, allowCompoundMove |
| LLM asks 利弊 when plan=concession | — | — | guardrail reject |

## Test strategy

- **Golden replay:** `npm run test:golden-replay` — all archetypes; required on every runtime PR
- **Layer A/B/C:** fixture snapshots per layer
- **Kill-switch:** forced adherence fail → `deterministic` + template question
- **Model matrix:** profile × golden fixtures ([model-capability-profile.md](model-capability-profile.md))
- **ROI:** PR template links fixture + rubric delta
- **Trace replay:** golden `CoachTurnTrace` diff vs baseline

## Files to deprecate (pedagogy)

- `selectStage1CoachAsk` — fallback text only
- `buildCoverageCoachMessage` llmQ override when plan present
- `resolveHybridCoachTurn`
- Pedagogy strings in `rule_hints` builders
