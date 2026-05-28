# Generation Contract (Prompt vs Policy)

## The fake modularity trap

Correct layering in code means nothing if **P1 / P2_* prompts still encode pedagogy**.

Symptoms:

- Prompt says "先列利弊再确认立场" while policy says `discourseShape: concession`
- Prompt says "按 currentNeed 推进" while arbitration says `action: finalize`
- Prompt says "继续引导学生把 Body 收成总括" while `readyToFinalize: true`

**True controller = whatever the LLM reads last with strongest imperative.** Usually the phase template.

## Audit: current prompt conflicts (must fix)

### P1_stage1.txt — dictatorship lines

| Line / section | Conflict | Action |
|----------------|----------|--------|
| §3 "先想角度，再启发" | Re-implements exploration policy | Move to Layer C; prompt: "follow arbitrated_plan" |
| §4 利弊题流程 | Hidden state machine in prompt | Delete step order; inject `coaching.*` summary |
| §4 `themesComplete` / `readyToFinalize` branches | Duplicates finalize authority | Prompt reads `arbitrated_plan.action` only |
| §6 收口条件 | LLM decides finalize | System sets finalize; prompt does not |

### P2_2_body1.txt / P2_3_body2.txt

| Section | Conflict | Action |
|---------|----------|--------|
| §推进原则 1–4 | Duplicates gap routing | Replace with `arbitrated_plan.primaryGap` |
| "按话语功能推进" | Second state machine | Layer C owns `currentNeed` |
| quality=weak 追问规则 | Duplicates intervention | Use `arbitrated_plan.intervention` |

### P0_flow.txt

Keep: advance/subStep mechanics.  
Remove: any coach strategy hints that duplicate policy.

## Generation objective contract

**Rule:** `ArbitratedTurnPlan` is the **sole pedagogical instruction** to the LLM.

### Prompt structure (target)

```markdown
## 本轮教学计划（系统已仲裁，必须执行）
{{arbitrated_plan_json}}

- action=finalize → coachQuestion 留空，填 proposal 字段
- action=coach → mirror + 一问，对齐 objective / discourseShape / intervention
- allowCompoundMove=true → 可自然融合回应，仍只问 primaryGap 一个问题
- 禁止偏离 intentHint 所指的论证形态

## 表达约束（非教学策略）
- 全程中文，mirror 1–2 句，禁止编号清单
- 禁止重复 {{last_coach_question}}
- 禁止空泛「请写原因/举例」

## 用户本轮回答
{{user_message}}
```

Pedagogy lives in `arbitrated_plan`. Prompt **expresses** it; prompt does **not** re-derive it.

### arbitrated_plan_json shape (injected)

```json
{
  "action": "coach",
  "objective": "improve_argument_balance",
  "discourseShape": "concession",
  "intervention": "guided_probe",
  "primaryGap": null,
  "allowCompoundMove": false,
  "intentHint": "承认已说坏处，引导是否可控/可补救",
  "topicAnchor": "网购/便利/消费"
}
```

## generateCoachTurn responsibilities

```typescript
function generateCoachTurn(plan: ArbitratedTurnPlan, llmResult, state, userMessage) {
  // 1. If plan.action === "finalize" → ignore llm coachQuestion, use proposal builder
  // 2. Else merge llm mirror/question ONLY if aligned to plan
  // 3. Never let llmResult override plan.action or primaryGap
}
```

## Verification checklist

After prompt migration, for each turn log:

```
[ ] arbitrated_plan.action matches visible coach behavior
[ ] coachQuestion targets plan.primaryGap or plan.intentHint (not prompt default flow)
[ ] finalize turns never ask another exploration question
[ ] fatigueHigh turns never show refinement probe
```

**Red flag:** LLM asks for benefits/drawbacks when `coaching.themesComplete && action=coach` with `discourseShape=concession` — prompt still dictating.

## Migration order

1. Add `{{arbitrated_plan_json}}` to P1 / P2 without removing old rules (shadow)
2. Compare LLM output: old prompt vs plan-driven
3. Strip conflicting § from prompts
4. Keep expression-only rules (language, length, no numbering)
5. Delete `{{rule_hints}}` pedagogy strings that duplicate Layer C

## rule_hints demotion

`rule_hints` may contain **legality** ("advance always false") and **format** — not gap selection.

Bad rule_hint: "当前缺 grounding，请举例"  
Good rule_hint: "本分论点: {{body1_point}} · {{body1_angle}}"

Gap text comes from `arbitrated_plan.intentHint`.

## Plan adherence

**Risk:** Architecture sophistication > model capability. Complex runtime + small/soft LLM → plan soft-ignore.

### Adherence definition

| plan.action | Pass | Fail |
|-------------|------|------|
| `finalize` | `coachQuestion` empty; proposal filled | Any follow-up question |
| `coach` + `primaryGap=grounding` | Question asks for example/scene | Summarize only; ask different gap |
| `coach` + `intervention=guided_probe` | One targeted question | Multi-gap checklist |
| `one_refinement_turn` | Single refinement on vetoReason | Re-explore completed themes |

### PlanAdherenceReport

```typescript
interface PlanAdherenceReport {
  adherent: boolean;
  violations: ("extra_question_on_finalize" | "wrong_gap" | "ignored_intervention")[];
  enforcedBy: "llm" | "generateCoachTurn" | "guardrail";
}
```

Compute post-turn; store in [CoachTurnTrace](observability.md).

### Enforcement ladder

1. **Prompt:** `arbitrated_plan_json` as sole pedagogy block
2. **generateCoachTurn:** if `plan.action === "finalize"` → strip `coachQuestion` regardless of LLM
3. **Guardrail:** reject wrong-gap question; regenerate once with stricter intentHint
4. **Do not** add 4th rewrite layer — if adherence < threshold, simplify plan or upgrade model

### CI threshold (starting targets — override per model)

| Metric | Default | low-tier model |
|--------|---------|----------------|
| finalize adherence | ≥95% | ≥95% (system-enforced) |
| primaryGap adherence | ≥80% | ≥60% or deterministic |
| overall plan adherence | ≥85% | ≥60% |

Per-model thresholds: [model-capability-profile.md](model-capability-profile.md). Run on [golden-fixtures.md](golden-fixtures.md) archetypes.

### Red flags in traces

```
plan.action=finalize + finalOutput.coachQuestion non-empty  → enforcement bug
plan.primaryGap=grounding + coachQuestion about 利弊        → prompt dictatorship or LLM drift
```
