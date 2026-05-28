# Runtime Observability

At this complexity, debugging without traces fails. Required from **Phase A shadow** onward.

## CoachTurnTrace (per turn)

```typescript
interface CoachTurnTrace {
  turnId: string;           // sessionId + turnIndex
  timestamp: string;
  subStep: string;

  // pipeline layers
  rawSignals: SemanticFeatures;
  discourseSignals: DiscourseSignals;
  coachingSignals: CoachingSignals;
  engagementSignals: EngagementSignals;
  temporalSignals?: TemporalSignals;  // when available

  // decision chain
  phaseGate: PhaseGateResult;
  finalizeDecision: FinalizeDecision;
  policyPreference: PolicyPreference;
  arbitrationDecision: ArbitratedTurnPlan;
  vetoReason?: string;
  fatigueOverride?: boolean;

  // realization
  generatedPlan: ArbitratedTurnPlan;   // plan sent to LLM
  llmRaw?: { mirror?: string; coachQuestion?: string };
  guardrailActions: string[];
  finalOutput: { mirror: string; coachQuestion: string };

  // runtime health
  runtimeMode: CoachRuntimeMode;
  runtimeModeTransition?: { from: string; to: string; reason: string };
  modelProfileId?: string;

  // adherence (post-hoc)
  planAdherence?: PlanAdherenceReport;
}
```

## Golden fixture replay

All runtime changes replay canonical sessions — see [golden-fixtures.md](golden-fixtures.md).

```bash
npm run test:golden-replay -- --fixture=idk-collapse --compare-trace
```

Compare: `arbitrated.action`, rubric scores, `runtimeMode`, adherence. Fail CI on unexplained trace diff.

## Module

`coach-trace.ts`:

```typescript
function recordCoachTurnTrace(trace: CoachTurnTrace): void;
function getTraceReplay(sessionId: string): CoachTurnTrace[];
```

**Dev:** append JSON lines to `.coach-traces/{sessionId}.jsonl`  
**Prod:** structured log or debug panel API.

## Replay workflow

When user asks "为什么突然 finalize？":

1. Load `getTraceReplay(sessionId)`
2. Find turn where `arbitrationDecision.action` flipped to `finalize`
3. Read chain: `coachingSignals.readyToFinalize`, `engagementSignals.fatigueHigh`, `fatigueOverride`

Single answer path — no grep across 5 modules.

## Minimum log (shadow mode)

If full trace too heavy, log compact:

```json
{
  "turn": 7,
  "subStep": "S1_EVAL",
  "readyToFinalize": true,
  "fatigueHigh": true,
  "refinementVeto": true,
  "action": "finalize",
  "fatigueOverride": true,
  "primaryGap": null
}
```

Expand to full trace before Phase C cutover.

## Debug UI (recommended)

Turn timeline:

```
[6] coach  primaryGap=concession  fatigue=ok
[7] finalize  fatigueOverride=true  veto blocked
```

Click turn → full `CoachTurnTrace` JSON.

## Alerts

| Pattern | Meaning |
|---------|---------|
| `action=finalize` + non-empty `coachQuestion` in finalOutput | **plan adherence failure** |
| Same `primaryGap` 3+ turns | stuck loop — check policy table |
| `fatigueOverride` on low-silent fixture | possible low-level false positive — review profile |
| `runtimeModeTransition` in trace | Kill-switch fired — check [degradation-killswitch.md](degradation-killswitch.md) |

## Testing

- Fixture sessions → golden trace snapshots (`tests/fixtures/traces/`)
- CI: trace schema validation + adherence rate threshold

See [generation-contract.md](generation-contract.md#plan-adherence).
