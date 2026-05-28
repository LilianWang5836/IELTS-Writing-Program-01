# Runtime Invariants

1. **Finalize authority** — only L1 + Layer C (`readyToFinalize` + phase legal). Policy may veto once with budget.
2. **Single truth** — completeness signals computed once in A→B→C pipeline.
3. **Policy consumption** — policy reads Layer C + engagement only.
4. **Trace append-only** — schema versioned; replay must read older traces.
5. **Degrade not stack** — on failure → `deterministic` or `legacy`, never add arbitration branches.
6. **Layer C frozen** — field changes require governance RFC + CI manifest update.
7. **Prompt expression-only** — no gap routing or finalize policy in P1/P2 after migration.
