# Pedagogical ROI Discipline

**Primary optimization target:** user learns to write better IELTS arguments.

**Not:** runtime elegance, architecture completeness, or signal coverage for its own sake.

## The trap

Architecture is now "fun to extend." Easy to add:

```
utility scores → momentum → confidence → adaptation → student profile
```

End state: system optimizes **maintaining the runtime**, not **helping the student**.

## ROI gate (required before any runtime PR)

Every change to world state, arbitration, policy, or temporal layers must answer:

| Question | Pass bar |
|----------|----------|
| Which **user-visible failure** does this fix? | Named scenario (link golden fixture) |
| Why can't existing layers fix it? | Concrete gap in A/B/C or adherence |
| How will we **measure** learning UX improvement? | Metric + fixture replay diff |
| What is **removed or simplified** in exchange? | Net complexity budget ≤ 0 preferred |

If answers are "cleaner architecture" or "more expressive ontology" → **reject**.

## Complexity budget

Track roughly:

```
complexityUnits = LayerC_fields + arbitration_branches + engagement_derived_signals + model_profile_overrides
```

New feature must either:

1. **Replace** ≥1 unit (delete old heuristic), or
2. Prove **≥2 golden fixtures** improve on pedagogical rubric (see [golden-fixtures.md](golden-fixtures.md))

## Pedagogical rubric (fixture scoring)

Score replay output 1–5 per turn on:

- **Clarity** — one clear ask, not stacked
- **Progress** — moves toward structure/chain, not circular
- **Fit** — matches student level (5分 vs 7分)
- **Respect** — no nagging after fatigue / compliance collapse

Runtime change must not lower rubric on **any** canonical fixture without explicit product sign-off.

## Allowed vs rejected motivations

| Motivation | Verdict |
|------------|---------|
| "Users finalize too early on improving trajectory" | ✅ if golden `fast-growth` fixture proves it |
| "Layer C needs motivationLevel for policy" | ❌ unless 4-way [layer-c-governance](layer-c-governance.md) + ROI |
| "Utility arbitration is cleaner than rules" | ❌ until traces show rule misfire rate |
| "Model X ignores plan — simplify plan for that model" | ✅ [model-capability-profile.md](model-capability-profile.md) |

## Review cadence

Quarterly: list unused signals in traces. Delete signals with zero arbitration/policy consumers in 30 days of shadow logs.
