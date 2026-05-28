# Empirical Validation Metrics (Phase 10)

Do **not** add new runtime abstractions until these metrics exist in traces/analytics.

| Metric | Definition | Source |
|--------|------------|--------|
| completion rate | Sessions reaching handoff / chain proposal | trace `action=finalize` |
| refinement loop rate | Turns with `one_refinement_turn` / total coach turns | trace |
| finalize success | Finalize turns with empty coachQuestion | adherence |
| user drop-off | Sessions ending before readyToFinalize | session end + trace |
| response length trend | Shrinking/growing per engagement | fatigueSignals |

Log aggregates weekly from `.coach-traces/` or prod structured logs.

ROI required before new Layer C / utility / temporal fields.
