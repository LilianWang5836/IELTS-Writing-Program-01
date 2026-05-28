# Runtime Kill-Switch & Graceful Degradation

Complex runtime → unpredictable failure modes. When subsystems fail, **degrade to simple deterministic coaching** — do not stack more logic.

## Runtime modes

```typescript
type CoachRuntimeMode =
  | "full"           // A/B/C + policy + arbitration + plan LLM
  | "deterministic"  // coverage gap → template ask; no policy/arbitration
  | "legacy"         // pre-refactor selectStage1CoachAsk / buildCoverageCoachMessage
  | "meta_only";     // blocked phase; apology + handoff hint
```

Default prod: `full`. Kill-switch drops mode down one level.

## Trip conditions (auto degrade)

| Condition | Detect | Degrade to |
|-----------|--------|------------|
| Adherence collapse | ≥2 consecutive turns `planAdherence.adherent === false` after enforcement | `deterministic` |
| Arbitration conflict | `finalizeDecision` vs `plan.action` mismatch in trace assembly | `deterministic` |
| Trace inconsistent | Missing required trace fields mid-pipeline | `deterministic` + log incident |
| Temporal unavailable | `temporal` expected but module throws / stale history | `full` minus temporal (skip multiplier) |
| Fatigue uncertain | Low-level profile + `fatigueHigh` + `coachingResponsiveness: partial` (future) | `deterministic`; **no** fatigue finalize |
| Policy throws | `suggestPolicyPreference` error | `deterministic` |
| World build throws | Any A/B/C extractor fails | `legacy` |

```typescript
function resolveCoachRuntimeMode(ctx: CoachContext, health: RuntimeHealth): CoachRuntimeMode {
  if (health.hardFailure) return "legacy";
  if (health.adherenceFailures >= 2 || health.arbitrationConflict) return "deterministic";
  return ctx.runtimeMode ?? "full";
}
```

Persist `runtimeMode` on session until manual reset or successful `full` streak (3 turns clean adherence).

## Deterministic mode behavior

**Keep:** phase legality, `readyToFinalize`, `primaryGap` from minimal coverage (existing `getNextNeed` / handoff rules).

**Skip:** policy preference, refinement veto, temporal, utility.

**Coach text:** gap template from `primaryGap` or `currentNeed` — one question, topic anchor from handoff/body point.

```typescript
// Example — not pedagogy-rich, but stable
const QUESTION_BY_GAP = {
  causal: "能再说说谁做了什么、带来什么结果吗？",
  grounding: "能举一个具体例子吗？",
  closure: "因此这对你的分论点意味着什么？",
};
```

LLM may still mirror; **question** comes from template if LLM adherence fails once.

## Philosophy

```
Complex runtime failed → simpler path
Never: retry with more arbitration layers
Never: hide failure and continue full mode
```

Log every mode transition in trace:

```json
{
  "runtimeModeTransition": { "from": "full", "to": "deterministic", "reason": "adherence_collapse" }
}
```

## Manual kill-switch

Env / feature flag:

```
COACH_RUNTIME_MODE=deterministic
COACH_DISABLE_POLICY=true
```

For incidents without deploy. Prefer session-level degrade over global unless widespread.

## Recovery

After 3 turns in `deterministic` with clean guardrail + non-empty coach:

- Optionally promote back to `full` for session
- Do not auto-promote if adherence failures were on finalize turns

## Testing

Fixture: force adherence failure → assert mode drops + template question + trace transition.

See [golden-fixtures.md](golden-fixtures.md) `idk-collapse` under degraded path.
