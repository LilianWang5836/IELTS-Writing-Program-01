# World State Pipeline (A → B → C)

Policy **must only consume Layer C + engagement**. Never read Layer A directly.

## Orchestrator (thin)

```typescript
function buildCoachWorldState(state, userMessage?, ctx?): CoachWorldState {
  const semantic = extractSemanticFeatures(state, userMessage);
  const discourse = interpretDiscourseSignals(semantic, state, ctx);
  const coaching = deriveCoachingSignals(discourse, semantic, state);
  const engagement = extractEngagementSignals(state, userMessage);
  return assembleWorldState({ semantic, discourse, coaching, engagement, phase: resolvePhaseMeta(state) });
}
```

**Forbidden:** one file that computes `hasStance`, `argumentBalance`, `readyToFinalize`, and `primaryGap` inline with cross-coupled if-chains.

## Layer A — Raw semantic features

Low-level, testable, **no coaching decisions**.

```typescript
interface SemanticFeatures {
  // stance / structure
  hasStance: boolean;
  stanceMarkers: string[];
  hasConcession: boolean;
  concessionMarkers: string[];
  benefitCount: number;
  drawbackCount: number;
  bodyPointCount: { body1: number; body2: number };

  // discourse markers
  causalMarkers: string[];
  exampleMarkers: string[];
  closureMarkers: string[];
  exampleCount: number;

  // lexical
  topicTerms: string[];
  genericPhrases: string[];  // "convenient", "good", "bad"
  responseWordCount: number;
}
```

**Module:** `semantic-features.ts` — regex/keyword/theme extractors only.

## Layer B — Interpreted discourse signals

Derived from A. **No finalize / gap decisions yet.**

```typescript
interface DiscourseSignals {
  stanceClarity: "missing" | "weak" | "clear";
  argumentBalance: "one_sided" | "balanced" | "unknown";
  concessionQuality: "missing" | "weak" | "adequate";
  elaborationDepth: "missing" | "weak" | "adequate";
  causalStrength: "missing" | "partial" | "adequate";
  exampleDepth: "missing" | "partial" | "adequate";
  coherenceRisk: "low" | "medium" | "high";
  topicCoverage: "off" | "partial" | "on";
  reasonSpecificity: "generic" | "specific";
  userTurnFunctionCount: number;  // ≥2 → compound move candidate
}
```

**Module:** `discourse-signals.ts` — pure functions `(SemanticFeatures, context) → DiscourseSignals`.

Each signal = **one function**. Add signals without touching others.

## Layer C — Coaching abstractions

**Only layer** that policy, finalize, and arbitration read for pedagogy.

```typescript
interface CoachingSignals {
  // Stage 1
  readyToFinalize: boolean;
  themesComplete: boolean;
  contentReady: boolean;
  positionLean: "pro" | "con" | "balanced" | "unknown";
  benefitDepth: "missing" | "weak" | "adequate";
  drawbackDepth: "missing" | "weak" | "adequate";
  bodyPointDepth: { body1: "missing" | "weak" | "adequate"; body2: "missing" | "weak" | "adequate" };
  concessionCoverage: "missing" | "weak" | "adequate";  // maps from concessionQuality
  rewriteRisk: "low" | "medium" | "high";
  refinementCandidate: boolean;  // weak bodyPoint OR weak elaboration on key side

  // Stage 2
  currentNeed: "claim" | "causal" | "grounding" | "closure" | "ready";
  primaryGap: "causal" | "grounding" | "closure" | null;
  gapStrength: "missing" | "partial" | "adequate";
  discourseReady: boolean;
  topicAnchor: string;
}
```

**Module:** `coaching-signals.ts` — maps B → C using existing rules (`getNextNeed`, theme completeness, substance assessment).

## Engagement signals (parallel track)

Not discourse quality — **conversation health**.

```typescript
interface EngagementSignals {
  responseLengthTrend: "stable" | "shrinking" | "growing";
  semanticEntropy: "low" | "medium" | "high";   // generic / repetitive lexicon
  latencyMs?: number;
  repetitionRisk: boolean;
  minimalCompliance: boolean;  // "I don't know", "maybe", very short after probe
  fatigueHigh: boolean;        // derived — see below
}
```

**Module:** `engagement-signals.ts`

### fatigueHigh derivation

Set `true` when **any two** of:

- `responseLengthTrend === "shrinking"` (last 2 turns vs baseline)
- `semanticEntropy === "high"` (generic phrases dominate)
- `minimalCompliance === true`
- `repetitionRisk === true` after prior refinement turn

Example collapse:

```
User: I don't know.
User: Maybe because online shopping is convenient.
→ minimalCompliance + shrinking → fatigueHigh
```

## Assembled CoachWorldState

```typescript
interface CoachWorldState {
  // phase (L1 meta)
  subStep, phaseLegal, handoffPhase, chainPhase, body

  // layers (debug / tests)
  semantic: SemanticFeatures;
  discourse: DiscourseSignals;
  coaching: CoachingSignals;
  engagement: EngagementSignals;

  // meta
  lastQuestion: string;
  exploreRound: number;
  refinementVetoBudgetRemaining: number;
}
```

Policy router signature:

```typescript
suggestStage1PolicyPreference(world: CoachWorldState): PolicyPreference
// reads world.coaching + world.engagement ONLY
```

## Signal ownership

| Signal | Layer | Module |
|--------|-------|--------|
| `hasConcession` | A | semantic-features |
| `concessionQuality` | B | discourse-signals |
| `concessionCoverage` | C | coaching-signals |
| `readyToFinalize` | C | coaching-signals |
| `primaryGap` | C | coaching-signals |
| `refinementCandidate` | C | coaching-signals |
| `fatigueHigh` | engagement | engagement-signals |

## Adding a new feature (safe path)

1. Add raw counter/marker to **Layer A**
2. Add interpretation rule to **Layer B** (one function)
3. Layer C only if [layer-c-governance.md](layer-c-governance.md) admission passes
4. Policy table gets one new row — **no new if-chain in orchestrator**

**Layer C is a governed ontology** — not a junk drawer. Arbitrary fields (`motivationLevel`, `cognitiveLoad`) rejected unless RFC passes all four criteria.

## Temporal track (not Layer C)

Trajectory signals live in **engagement/temporal** modules, not coaching ontology:

- Now: `responseLengthTrend`, `engagementHistory`
- Future: `learningMomentum`, `adaptationRate`, `coachingResponsiveness` — [temporal-memory.md](temporal-memory.md)

Do not add trajectory fields to `CoachingSignals` without governance RFC.

## Forbidden

- Policy reading `world.semantic` or `world.discourse`
- `buildCoachWorldState` growing past ~80 lines (orchestration only)
- Duplicate truth in policy + handoff + prompt
- New Layer C field without multi-consumer + stable label proof
