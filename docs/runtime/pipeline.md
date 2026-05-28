# Runtime Pipeline Order

```
resolveCoachRuntimeMode
→ buildCoachWorldState        (A → B → C + engagement)
→ resolvePhaseGate            (L1)
→ resolveFinalizeDecision     (L1 + C)
→ suggestPolicyPreference     (L2.5, skip in deterministic)
→ arbitrateTurnDecision
→ simplifyPlanForModel
→ generateCoachTurn
→ evaluateAdherence
→ maybeDegradeRuntimeMode
→ recordCoachTurnTrace
```

Implementation: `src/runtime/pipeline/runtime-pipeline.ts`.

Modes: `full` | `deterministic` | `legacy` — see [arbitration/runtime-modes.md](arbitration/runtime-modes.md).
