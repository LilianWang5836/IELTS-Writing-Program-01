# Temporal Memory Policy (Trajectory > Snapshot)

World state is **turn-local dominant** today. Real tutoring weights **trajectory** over single-turn snapshot.

## Problem

```
Turn 1: user stuck
Turn 2: improvement
Turn 3: active elaboration
Turn 4: weak answer (one slip)
```

Snapshot-only Layer C may finalize or stop coaching. Trajectory says **continue** — learning momentum is positive.

## Now (v2.2)

Implemented in engagement track only:

- `responseLengthTrend` — last N turns vs baseline
- `engagementHistory` on `CoachContext` — word counts per turn

Used for fatigue only. **Do not** add trajectory fields to Layer C yet.

## Next phase (document only — do NOT implement until observability baseline)

```typescript
interface TemporalSignals {
  learningMomentum: "negative" | "flat" | "positive";   // elaboration depth trend across turns
  adaptationRate: "low" | "medium" | "high";            // user incorporates last coach ask
  coachingResponsiveness: "ignore" | "partial" | "full"; // answers targeted gap vs generic
}
```

**Module (future):** `temporal-signals.ts` — reads turn history + last coach `primaryGap`, outputs trajectory.

### Derivation sketch

```
learningMomentum:
  positive — last 2 turns increase specific markers (causal, example) vs turn-2
  negative — shrinking + generic after coach probe
  flat     — otherwise

coachingResponsiveness:
  full    — user message tags match last plan.primaryGap
  partial — related but generic
  ignore  — off-topic or minimal compliance
```

## Interaction with fatigue (future)

**Not:** `fatigueHigh → force finalize` for all short/low-entropy turns.

**Instead:** engagement confidence decay:

```
engagementMultiplier = f(fatigueSignals, learningMomentum, coachingResponsiveness)

refinementUtility *= engagementMultiplier   // future utility arbitration
// OR today: block veto only when fatigueHigh AND momentum !== "positive"
```

Protects IELTS 5.0 users: short + low entropy may be **language ceiling**, not fatigue.

| Profile | Snapshot | Trajectory | v2.2 action | Future action |
|---------|----------|------------|-------------|---------------|
| Collapsing | weak | negative momentum | finalize | finalize |
| Low level | weak | flat, responsive | finalize (careful) | coach with simpler probe |
| Improving | weak this turn | positive momentum | finalize if ready | **continue coaching** |
| Fatigued | minimal compliance | negative | finalize | finalize |

## Storage

```typescript
interface CoachContext {
  engagementHistory: { turnIndex: number; wordCount: number; genericRatio: number }[];
  lastArbitratedPlan?: ArbitratedTurnPlan;
  temporal?: TemporalSignals;  // future
}
```

Append each turn in `postProcess*`. Replay uses same history.

## Policy rule (future)

```
if temporal.learningMomentum === "positive" && !coaching.readyToFinalize {
  policy.intervention prefer guided_probe over finalize_prompt
}
```

Policy reads **temporal** alongside **coaching** — temporal stays out of Layer C until governance RFC + [pedagogical-roi.md](pedagogical-roi.md) pass.

Ship only after `fast-growth` golden fixture shows rubric improvement vs snapshot-only fatigue.
