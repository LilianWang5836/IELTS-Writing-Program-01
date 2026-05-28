# AGENTS.md — IELTS Tutoring Runtime v2.3

## Runtime philosophy

This repo implements a **teaching-runtime**, not prompt engineering.

Primary optimization target: **help the user write better IELTS arguments**.

Layers:

```
world state (A→B→C) → arbitration → legality → policy preference
  → realization (LLM) → guardrail → trace
```

North star docs: `docs/runtime/README.md`, `.cursor/skills/ielts-policy-coach/`.

## Forbidden modifications (hard constraints)

- **No Layer C field additions** without RFC in `docs/runtime/ontology/layer-c-governance.md` + pedagogical ROI proof
- **No arbitration priority changes** without explicit product approval
- **No hidden pedagogy in prompts** — P1/P2 may only express tone, language, brevity, format; strategy comes from `arbitrated_plan_json`
- **No rewrite layers** — guardrail validates/rejects; does not substitute pedagogy. Max one regen on adherence fail
- **No runtime-for-runtime** — new complexity must link golden fixture + user UX metric (`docs/runtime/pedagogy/pedagogical-roi.md`)

## Arbitration hierarchy (fixed)

```
L1 State machine     → phase legality, finalize authority
L2 Coverage (Layer C) → objective completeness
L2.5 Policy skill    → coaching preference; may veto finalize once
L3 Coach generation  → expression bound to ArbitratedTurnPlan
L4 Guardrail         → safety validation only
```

Policy **cannot** extend coaching indefinitely or set `defaultFinalize`.

## Generation contract

- `ArbitratedTurnPlan` is the sole pedagogical instruction to the LLM
- `action=finalize` → system strips `coachQuestion`; LLM does not decide finalize
- See `docs/runtime/pedagogy/generation-contract.md`

## Coding rules

- `src/runtime/` owns new pipeline code; do not bloat `handle-turn.ts` until migration gate passes
- `buildCoachWorldState` orchestrates only (~80 lines); extractors live in separate modules
- Policy reads `coaching` + `engagement` only — never `semantic` or `discourse`
- Append-only trace schema; backward replay compatible
- One gap, one question in deterministic mode

## Replay requirements

Every runtime PR must:

1. Run `npm run test:golden-replay` — all fixtures green
2. Run `npm run test:runtime-governance` — Layer C drift check
3. Include ROI note linking fixture + rubric delta when behavior changes

Golden fixtures: `tests/fixtures/golden-conversations/`.

## Execution order

Do not skip ahead:

1. AGENTS.md + docs/runtime
2. Trace schema + persistence
3. Replay runner
4. Golden fixtures
5. Runtime modes
6. Adherence engine
7. Runtime pipeline skeleton
8. A/B/C world state
9. Arbitration
10. Prompt strip (separate PR)
11. Governance CI
12. Empirical metrics (no new abstractions before metrics)

## Codex task framing

Good: "Implement trace persistence. Do not modify arbitration or prompts."

Bad: "Improve runtime architecture" / "Make coaching smarter"
