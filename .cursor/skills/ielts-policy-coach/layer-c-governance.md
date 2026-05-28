# Layer C Governance (Pedagogical Ontology Control)

Layer C is **not observable** like A/B. It is **human-defined pedagogical abstraction**. Without governance it becomes a junk drawer (`argumentWeaknessType`, `motivationLevel`, `cognitiveLoad`…).

## Admission criteria (all four required)

Before adding any Layer C field:

| # | Criterion | Test |
|---|-----------|------|
| 1 | **Multi-consumer** | ≥2 modules read it (policy + arbitration, or finalize + policy) |
| 2 | **Non-composable** | Cannot be derived from existing C fields via simple boolean/enum logic |
| 3 | **Stable label** | Unit-testable with ≥10 fixture turns; inter-rater agreement on label |
| 4 | **Arbitration gain** | Changes `arbitrated.action` or veto logic in documented cases |

If any fails → stay in Layer B, or compute inline at policy table (prefer B).

## Rejected examples

| Proposed field | Why reject |
|----------------|------------|
| `motivationLevel` | Subjective; no stable label; policy can use `engagement` trajectory |
| `creativityPotential` | Not composable into arbitration; LLM concern |
| `topicFamiliarity` | Derivable from `topicCoverage` + history |
| `cognitiveLoad` | Vague; use `engagement.fatigueHigh` / future multiplier |

## Approved pattern

```
Layer B: elaborationDepth = weak
Layer C: refinementCandidate = (bodyPointDepth.weak || elaborationDepth.weak on key side)
```

`refinementCandidate` passes: consumed by arbitration + policy; not trivially composable at arbitration site without duplication; testable; changes veto.

## Change process

1. RFC in PR: field name, layer, consumers, fixtures, arbitration diff
2. Add to `CoachingSignals` with `@stable` JSDoc + fixture tests
3. Update policy table **one row** — no orchestrator edits
4. Log in observability trace under `coachingSignals`

## Prefer composition over new fields

Before new C field, try:

```typescript
// arbitration reads B directly for edge case (document exception)
const weakElaboration = discourse.elaborationDepth === "weak" && coaching.readyToFinalize;
```

Exceptions must be listed in this file with expiry review.

## Layer C inventory (current — frozen until RFC)

| Field | Consumers |
|-------|-----------|
| `readyToFinalize` | finalize, arbitration |
| `refinementCandidate` | arbitration, policy veto |
| `primaryGap` | arbitration, policy, plan |
| `concessionCoverage` | policy discourseShape |
| `bodyPointDepth.*` | policy, refinementCandidate |
| `currentNeed` | legacy bridge; prefer `primaryGap` |

No new fields without RFC.

All Layer C additions also require [pedagogical-roi.md](pedagogical-roi.md) — architecture elegance alone is insufficient.
