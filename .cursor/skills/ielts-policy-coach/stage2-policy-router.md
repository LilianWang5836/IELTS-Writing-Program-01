# Stage 2 Policy Preference (`S2_2` / `S2_3`)

## Role

`suggestStage2PolicyPreference(world: CoachWorldState): PolicyPreference`

Maps **precomputed** `primaryGap` + `gapStrength` to coaching preferences. Does not re-run coverage math.

## When active

- `subStep` in `S2_2_BODY1`, `S2_3_BODY2`
- `chainPhase === "coaching"`

## Input

Only `world.coaching` + `world.engagement`. `currentNeed` / `primaryGap` already set in Layer C.

## Three axes

### objective

| value | When primaryGap |
|-------|-----------------|
| `deepen_mechanism` | causal |
| `add_grounding` | grounding |
| `close_paragraph` | closure |
| `confirm_structure` | ready (preference only; finalize via arbitration) |

### discourseShape

| value | When |
|-------|------|
| `causal_chain` | primaryGap causal |
| `example_scene` | primaryGap grounding |
| `closure` | primaryGap closure |
| `none` | ready / meta |

### intervention

| value | When gapStrength |
|-------|------------------|
| `guided_probe` | missing |
| `guided_refinement` | partial |
| `acknowledge_and_narrow` | partial + userTurnFunctionCount >= 2 |
| `none` | adequate / ready |

## allowCompoundMove (not multi_function_ack)

When `world.discourse.userTurnFunctionCount >= 2` (arbitration sets `allowCompoundMove`; policy may mirror):

```json
{ "allowCompoundMove": true }
```

Means:

- LLM **may** combine acknowledgment + one probe in natural language
- LLM **must not** be forced into dense multi-requirement templates
- Still **one** question targeting `primaryGap` only

Forbidden: strategy enum `multi_function_ack`, mandatory "一句里同时完成 ack+grounding+closure".

## refinementVeto (Stage2)

Rare. Only when:

- `discourseReady` true but `workingSlots` projection weak for proposal quality
- `refinementVetoBudgetRemaining > 0`
- One turn delay max

Default: coverage ready → finalize chain via arbitration.

## Topic hints via intentHint only

Policy sets `intentHint` using `world.coaching.topicAnchor` keywords. No cross-topic templates.

| Anchor | intentHint focus (causal gap) |
|--------|------------------------------|
| 旅游/经济 | 消费→产业→就业/收入 |
| 环境/居民 | 压力→生活/污染 |
| 网购 | 便利→行为→总体利弊 |

Guardrail rejects LLM questions off anchor; policy does not rewrite LLM.

## Example — causal done, grounding missing

**World:** primaryGap grounding, gapStrength missing, userTurnFunctionCount 1

```json
{
  "objective": "add_grounding",
  "discourseShape": "example_scene",
  "intervention": "guided_probe",
  "refinementVeto": false,
  "allowCompoundMove": false,
  "intentHint": "用例如/比如补一个具体场景（地点/谁/发生什么），支撑本分论点",
  "confidence": 0.9
}
```

## Example — multi-function user turn

**World:** primaryGap closure, gapStrength partial, userTurnFunctionCount >= 2

```json
{
  "objective": "close_paragraph",
  "discourseShape": "closure",
  "intervention": "acknowledge_and_narrow",
  "refinementVeto": false,
  "allowCompoundMove": true,
  "intentHint": "可先肯定机制/例子方向，再只问一句因此/所以扣回分论点",
  "confidence": 0.8
}
```

## Anti-patterns

- Policy reading raw `coverage.scores` and re-deriving `currentNeed`
- Forcing compound multi-gap questions for 5.0–5.5 users
- `finalize_chain` as policy strategy — use arbitration `action: finalize`
