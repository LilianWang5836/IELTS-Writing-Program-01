# IELTS Tutoring Runtime v2.3

Teaching-runtime orchestration for Stage 1 / Stage 2 coach turns.

## Invariants

See [invariants.md](invariants.md).

## Pipeline

See [pipeline.md](pipeline.md).

## Subsystems

| Area | Doc |
|------|-----|
| Ontology A/B/C | [ontology/](ontology/) |
| Arbitration | [arbitration/](arbitration/) |
| Pedagogy contract | [pedagogy/](pedagogy/) |
| Observability | [observability/](observability/) |
| Golden fixtures | [fixtures/golden-fixtures.md](fixtures/golden-fixtures.md) |
| Implementation | [implementation/](implementation/) |

## Code entry

- Pipeline: `src/runtime/pipeline/runtime-pipeline.ts`
- Trace: `src/runtime/trace/`
- Replay: `src/runtime/replay/replay-runner.ts`

## Agent rules

See root [AGENTS.md](../../AGENTS.md).
