# Stage 1 Policy Preference (`S1_EVAL`)

## Role

`suggestStage1PolicyPreference(world: CoachWorldState): PolicyPreference`

Returns **preferences only**. Does not decide finalize, phase, or gap truth.

## When active

- `subStep === "S1_EVAL"` && `!handoffLocked` && `handoffPhase !== "proposed"`

## Input

Only `world.coaching` + `world.engagement` from [normalized-state.md](normalized-state.md). Never read `world.semantic` or `world.discourse`. No direct `extractExplorationThemes` calls.

## Three axes (reference tables)

### objective (cognitive goal)

| value | When world signals |
|-------|-------------------|
| `confirm_structure` | `readyToFinalize` — preference only; finalize decided by arbitration |
| `improve_argument_balance` | both sides adequate, `concessionCoverage` weak |
| `deepen_mechanism` | one side `weak`, other `adequate` |
| `collect_missing_side` | `benefitDepth` or `drawbackDepth` === missing |
| `clarify_stance` | `positionLean === unknown` |

### discourseShape (argument topology — not coaching action)

| value | When world signals |
|-------|-------------------|
| `concession` | `concessionCoverage` weak + position lean known |
| `comparison` | both sides adequate, concession adequate, weight unclear |
| `causal_chain` | side weak, need 谁→变化→结果 |
| `none` | collecting missing side or confirming structure |

### intervention (coaching action)

| value | When world signals |
|-------|-------------------|
| `guided_probe` | missing side or weak mechanism |
| `guided_refinement` | bodyPointDepth weak (veto candidate) |
| `acknowledge_and_narrow` | themesComplete, repeatQuestionRisk |
| `finalize_prompt` | preference when arbitration action === finalize |
| `none` | arbitration blocked |

## refinementVeto (only explicit extension)

Set `refinementVeto: true` **only when all**:

- `world.coaching.refinementCandidate === true`
- `world.engagement.fatigueHigh === false`
- `world.refinementVetoBudgetRemaining > 0`
- finalize check happens in arbitration, not here

Include `vetoReason`: one sentence (e.g. "Body2 仍缺可论证总括").

Never veto for "quality feels low" without weak depth signal.

## Preference mapping (not a state machine)

Lookup table from world → preference. No nested if-chains duplicating coverage.

| benefit | drawback | position | concession | bodyPts | → objective | discourseShape | intervention |
|---------|----------|----------|------------|---------|-------------|----------------|--------------|
| adequate | adequate | pro/con | weak | any | improve_argument_balance | concession | guided_probe |
| adequate | adequate | pro/con | adequate | weak | deepen_mechanism | comparison | guided_refinement |
| adequate | missing | any | * | * | collect_missing_side | none | guided_probe |
| weak | adequate | any | * | * | deepen_mechanism | causal_chain | guided_probe |

## Example

**World (网购):** position pro, benefit adequate, drawback adequate, concessionCoverage weak, readyToFinalize true, bodyPointDepth adequate

**Policy preference:**

```json
{
  "objective": "improve_argument_balance",
  "discourseShape": "concession",
  "intervention": "guided_probe",
  "refinementVeto": false,
  "allowCompoundMove": false,
  "intentHint": "承认已说坏处，引导是否可控/可补救，回扣利大于弊",
  "confidence": 0.85,
  "riskFlags": ["repeat_risk"]
}
```

**Arbitration:** `defaultFinalize true` + no weak bodyPoint → **action: finalize** (policy preference logged but not executed this turn if structure already enough).

If body2Point still weak → one `one_refinement_turn`, then finalize.

## intentHint

Short Chinese hint for LLM. Not a template sentence. LLM chooses wording.

## Anti-patterns

- Flat `strategy: concession_mitigation` enum
- Policy calling `readyToFinalize` logic
- Policy setting `should_finalize`
- Unlimited refinement without veto budget
