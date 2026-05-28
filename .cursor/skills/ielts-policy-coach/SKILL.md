---
name: ielts-policy-coach
description: Teaching-runtime for IELTS writing tutor with A/B/C world state, arbitration, golden conversation replay, graceful degradation kill-switches, model capability profiles, and pedagogical ROI gates. Use when changing coach runtime, adding signals, debugging finalize/adherence, or evaluating whether architecture changes improve user learning.
---

# IELTS Policy Coach System (v2.3)

## North star

**Help the user write better.** Not maintain runtime elegance.

Every runtime change passes [pedagogical-roi.md](pedagogical-roi.md). Every merge replays [golden-fixtures.md](golden-fixtures.md).

## Teaching-runtime stack

```
world state → arbitration → legality → preference → realization → guardrail
     ↓ fail                          ↓ model tier
deterministic fallback          simplified plan
```

Details: [normalized-state.md](normalized-state.md), [arbitration.md](arbitration.md), [degradation-killswitch.md](degradation-killswitch.md), [model-capability-profile.md](model-capability-profile.md).

## Turn pipeline (full mode)

```
1. resolveCoachRuntimeMode()     // kill-switch first
2. buildCoachWorldState()        // A→B→C + engagement
3. resolvePhaseGate()
4. resolveFinalizeDecision()
5. suggestPolicyPreference()     // skip if deterministic
6. arbitrateTurnDecision()
7. simplifyPlanForModel()        // portability
8. recordCoachTurnTrace()
9. generateCoachTurn(plan)
10. guardrailCheck() + adherence → maybe degrade mode
```

## Phase 3 risks

| Risk | Mitigation |
|------|------------|
| Runtime for runtime's sake | [pedagogical-roi.md](pedagogical-roi.md) |
| Local fix, global regression | [golden-fixtures.md](golden-fixtures.md) mandatory replay |
| Complex failure modes | [degradation-killswitch.md](degradation-killswitch.md) |
| Model ignores plan | [model-capability-profile.md](model-capability-profile.md) |
| Layer C sprawl | [layer-c-governance.md](layer-c-governance.md) |
| Undebuggable turns | [observability.md](observability.md) |

## Finalize authority

Unchanged: L1+L2 own finalize; policy veto bounded; `fatigueHigh` blocks veto (v2.2). Future: engagement multiplier — only with ROI + golden proof.

## Implementation checklist

- [ ] A/B/C + governance frozen
- [ ] `coach-trace.ts` + golden trace baselines
- [ ] Golden archetypes: low-silent, idk-collapse, verbose-drift, mechanical, fast-growth
- [ ] `resolveCoachRuntimeMode` + deterministic templates
- [ ] `model-capability-profile.ts` + per-model CI
- [ ] ROI section in runtime PR template
- [ ] Plan adherence + kill-switch integration tests

## Resources

- [pedagogical-roi.md](pedagogical-roi.md) — complexity gate
- [golden-fixtures.md](golden-fixtures.md) — canonical conversations
- [degradation-killswitch.md](degradation-killswitch.md) — graceful fallback
- [model-capability-profile.md](model-capability-profile.md) — portability
- [normalized-state.md](normalized-state.md)
- [layer-c-governance.md](layer-c-governance.md)
- [temporal-memory.md](temporal-memory.md)
- [arbitration.md](arbitration.md)
- [observability.md](observability.md)
- [generation-contract.md](generation-contract.md)
- [stage1-policy-router.md](stage1-policy-router.md)
- [stage2-policy-router.md](stage2-policy-router.md)
- [integration.md](integration.md)
