# Coding Rules

- Runtime code lives under `src/runtime/`
- Thin orchestrators; one signal per function in B layer
- No Layer C without manifest update + RFC
- Traces on every pipeline invocation (shadow ok)
- Deterministic mode: template question, no policy
- Tests: golden replay + layer snapshots

See [AGENTS.md](../../AGENTS.md).
