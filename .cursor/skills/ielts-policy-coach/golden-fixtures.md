# Golden Conversation Fixtures

Canonical tutoring sessions. **All runtime changes must replay** against these before merge.

Prevents: local optimization → global regression.

## Location

```
tests/fixtures/golden-conversations/
├── low-silent/           # 低水平沉默型
├── idk-collapse/         # "I don't know." compliance collapse
├── verbose-drift/        # 高水平啰嗦、跑题
├── mechanical-compliance/ # 机械短答、填空白
├── fast-growth/          # 快速成长型 trajectory
├── tourism-body1/        # Stage2 串题回归
└── online-shopping-s1/   # Stage1 concession 路径
```

Each folder:

```
session.jsonl          # ordered user turns + minimal session state seeds
expected-rubric.json   # per-turn pedagogical expectations (not exact strings)
golden-trace.jsonl     # optional: committed CoachTurnTrace after baseline
```

## Archetypes (required)

### 1. low-silent (`low-silent`)

- Very short replies, low entropy, **not** hostile
- Tests: no false `fatigueHigh` finalize; simpler probes
- Rubric: coach stays encouraging; one short question

### 2. idk-collapse (`idk-collapse`)

```
User: I don't know.
User: Maybe because online shopping is convenient.
```

- Tests: fatigue gate, no infinite refinement
- Rubric: finalize or single narrow ask; no lecture

### 3. verbose-drift (`verbose-drift`)

- Long answers, off-angle examples, topic drift
- Tests: guardrail + primaryGap hold
- Rubric: acknowledge + one anchor question

### 4. mechanical-compliance (`mechanical-compliance`)

- Fills slots with generic phrases to pass
- Tests: refinementCandidate vs finalize; no reward gaming
- Rubric: push specificity once, then structure

### 5. fast-growth (`fast-growth`)

```
Turn 1: stuck
Turn 2: improvement
Turn 3: active elaboration
Turn 4: weak slip
```

- Tests: temporal / momentum (future); **must not finalize** on turn 4 if trajectory positive (future gate)
- Rubric: continue coaching on slip when momentum positive

### 6. Domain regressions

- `tourism-body1` — no 大学/实习 cross-topic
- `online-shopping-s1` — concession path when coverage allows

## Replay command (target)

```bash
npm run test:golden-replay
# For each fixture: rebuild world → arbitrate → (mock LLM or recorded) → score rubric + trace diff
```

## CI gates

| Check | Fail condition |
|-------|----------------|
| Trace schema | Any fixture trace invalid |
| Rubric regression | Any turn drops >1 point vs baseline |
| Adherence | Below model-profile threshold |
| Golden trace diff | `arbitrated.action` changes without PR note |

## Adding a fixture

1. Real or synthesized transcript (anonymized)
2. `expected-rubric.json` — action, primaryGap, max question count, forbidden patterns
3. Run replay → commit `golden-trace.jsonl` as baseline
4. Link fixture ID in PR [pedagogical-roi.md](pedagogical-roi.md) section

## PR template snippet

```markdown
## Golden replay
- [ ] idk-collapse — no regression
- [ ] fast-growth — ...
- Rubric delta: +0 / -0 / explain
```

No runtime PR merges without checked golden replay.
