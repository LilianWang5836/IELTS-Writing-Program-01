# Priority Arbitration

```typescript
arbitrateTurnDecision(input: {
  world: CoachWorldState;
  policyPreference: PolicyPreference;
  phaseGate: PhaseGateResult;
  finalizeDecision: FinalizeDecision;
}): ArbitratedTurnPlan
```

## Priority (upper overrides lower)

```
L1 State machine     → phase legality, finalize authority
L2 Coverage (Layer C) → objective completeness
L2.5 Policy skill    → coaching preference (when not blocked)
L3 Coach generation  → expression (must obey plan — enforced post-hoc)
L4 Guardrail         → safety validation only
```

## Fatigue — now vs later

### Now (v2.2): hard gate on veto only

```
if world.engagement.fatigueHigh {
  refinementVeto = DISABLED
  // if defaultFinalize → action: finalize
}
```

Blocks infinite refinement after minimal compliance. Log `fatigueOverride: true`.

### Known false positive

IELTS ~5.0 users: short replies + low entropy + high compliance ≠ fatigue — often **language ceiling**.

Do **not** expand hard finalize on all fatigue signals until temporal layer exists.

### Later: engagement confidence decay (do NOT implement now)

Replace binary gate with multiplier on refinement decision:

```typescript
engagementMultiplier = computeEngagementMultiplier({
  fatigueSignals: world.engagement,
  temporal: world.temporal,  // learningMomentum, coachingResponsiveness
});

// utility path:
refinementUtility *= engagementMultiplier;

// interim bridge (when temporal shipped):
if fatigueHigh && temporal?.learningMomentum === "positive" {
  allow one_refinement_turn with simpler intervention  // NOT auto-finalize
}
```

See [temporal-memory.md](temporal-memory.md).

| Signal (now) | Effect |
|--------------|--------|
| `fatigueHigh` | Block veto; finalize if `defaultFinalize` |
| `minimalCompliance` | Contributes to fatigue score |
| `learningMomentum: positive` (future) | May override fatigue finalize |

## Finalize arbitration (deterministic)

```typescript
interface FinalizeDecision {
  defaultFinalize: boolean;
  canPropose: boolean;
}
```

```
if !phaseGate.legal → blocked

if defaultFinalize && canPropose {
  if refinementVeto && budget > 0 && refinementCandidate && !fatigueHigh {
    return one_refinement_turn;
  }
  return finalize;
}

return coach with policyPreference + coaching.primaryGap
```

Policy cannot set `defaultFinalize`. Veto budget: **1** per segment.

## Future: utility arbitration

```typescript
interface TurnUtilityScores {
  finalizeUtility: number;
  refinementUtility: number;  // *= engagementMultiplier when temporal ready
  explorationUtility: number;
}
```

Use when rule conflicts are **learning-value tradeoffs**. Requires [observability.md](observability.md) shadow data first.

## ArbitratedTurnPlan

```typescript
interface ArbitratedTurnPlan {
  action: "coach" | "one_refinement_turn" | "finalize" | "blocked";
  objective: string;
  discourseShape: string;
  intervention: string;
  allowCompoundMove: boolean;
  intentHint: string;
  primaryGap?: string;
  decrementVetoBudget?: boolean;
  fatigueOverride?: boolean;
}
```

Record full object in [CoachTurnTrace](observability.md).

## Conflict examples

| coaching | engagement | temporal (future) | Outcome |
|----------|------------|-------------------|---------|
| readyToFinalize | fatigueHigh | — | finalize |
| readyToFinalize | fatigueHigh | momentum positive | coach (future) |
| readyToFinalize | ok | — | finalize or one_refinement |
| primaryGap causal | ok | — | coach causal |
