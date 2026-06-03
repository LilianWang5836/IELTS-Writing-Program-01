/**
 * Layer 3 — Full Stage2 replay + Policy Validation Report
 * Run: npm run test:discourse-layer3
 */
import {
  aggregateCoverage,
  buildDiscourseMemory,
  getNextNeed,
  needToBuildStep,
} from "../src/lib/domain/chain-discourse.ts";
import { resolveChainTurnDecision } from "../src/lib/domain/chain-turn-decision.ts";
import { postProcessStage2 } from "../src/lib/domain/stage2-coach.ts";
import { buildChainBaselineSlots } from "../src/lib/domain/chain-slot-pool.ts";
import { getChainBuildContext } from "../src/lib/domain/chain-scaffold.ts";
import { stage2UserMessages } from "../src/lib/domain/stage2-context.ts";

const COMPOUND_ZH =
  "原因：游客变多之后，餐饮住宿购物的需求也变大。因此，餐厅酒店等能赚更多钱，另外一方面，他们会雇佣更多的人手。因此，旅游业发展能促进当地经济发展，同时提高居民的收入";

/** Session A — 原 dead-loop：一句复合即应脱离 causal 卡死 */
const SESSION_A = {
  id: "A",
  label: "原 dead-loop（旅游一句复合）",
  body1Point: "国际旅游能促进当地经济发展，增加居民的实际收入。",
  body1Angle: "主要好处（经济维度）",
  turns: [{ user: COMPOUND_ZH, llmMirror: "机制清楚", llmQ: "" }],
  /** 模拟旧 bug：若 policy 错，同一输入连打 3 轮仍会 causal */
  repeatTurns: 3,
};

/** Session B — 正常渐进：机制 → 举例 → 收束 */
const SESSION_B = {
  id: "B",
  label: "正常渐进（旅游分步到 conclusion）",
  body1Point: "国际旅游能促进当地经济发展，增加居民的实际收入。",
  body1Angle: "主要好处（经济维度）",
  turns: [
    {
      user: "因为游客增多，餐饮和住宿需求增加，餐厅酒店收入上升并雇佣更多人",
      llmMirror: "机制方向对",
      llmQ: "请补一个具体场景",
    },
    {
      user: "例如，巴厘岛旺季时餐馆需要额外招服务员，酒店也会扩编",
      llmMirror: "例子具体",
      llmQ: "请写段末收束",
    },
    {
      user: "因此，这会带动本地经济并提高居民收入",
      llmMirror: "收束到位",
      llmQ: "",
    },
  ],
};

function baseState(session) {
  return {
    subStep: "S2_2_BODY1",
    stage: 2,
    chatHistory: [],
    s2: {
      body1Point: session.body1Point,
      body1Angle: session.body1Angle,
      body2Point: "环境破坏",
      body2Angle: "环境",
      body1: { chainPhase: "coaching", status: "coaching", slots: {}, openIssues: [] },
      body2: { chainPhase: "coaching", status: "coaching", slots: {}, openIssues: [] },
      stance: "利大于弊",
    },
    coachContext: {
      chainBuildStep: "reason",
      chainStepAskCount: 0,
      lastQuestion: "",
    },
  };
}

function runTurn(state, session, turn, turnIdx) {
  const body = "body1";
  const userMessage = turn.user;
  state.chatHistory.push({ role: "user", content: userMessage, ts: turnIdx });

  const llmResult = {
    verdict: "coach",
    advance: false,
    mirror: turn.llmMirror,
    coachQuestion: turn.llmQ,
  };

  const pp = postProcessStage2(state, llmResult, body, userMessage);
  const nextState = pp.state;

  const seg = nextState.s2?.body1;
  const baselineSlots = buildChainBaselineSlots(nextState, body, seg?.slots);
  const buildCtx = getChainBuildContext(nextState, body);
  const prevStep = state.coachContext?.chainBuildStep ?? "claim";
  const prevAskCount = state.coachContext?.chainStepAskCount ?? 0;
  const lastQ = state.coachContext?.lastQuestion ?? "";
  const preMsgs = stage2UserMessages(nextState, body);
  const preMemory = buildDiscourseMemory(
    preMsgs,
    body,
    buildCtx.bodyPoint || baselineSlots.claim || undefined,
  );
  const preCoverage = aggregateCoverage(preMemory, body);
  const expectedStep = needToBuildStep(getNextNeed(preCoverage));

  const decision = resolveChainTurnDecision({
    baselineSlots,
    result: llmResult,
    body,
    buildCtx,
    userMessage,
    prevStep,
    prevAskCount,
    sameStepAsPrev: prevStep === expectedStep,
    lastQuestion: lastQ,
    state: nextState,
  });

  return {
    turn: turnIdx + 1,
    userPreview: userMessage.slice(0, 52) + (userMessage.length > 52 ? "…" : ""),
    signals: {
      causal: round(decision.coverage.scores.causal),
      closure: round(decision.coverage.scores.closure),
      grounding: round(decision.coverage.scores.grounding),
    },
    nextNeed: decision.currentNeed,
    advanceTo: decision.advanceTo,
    coachAsk: (decision.coach.ask || "").slice(0, 70),
    postProcessAsk: (pp.result.coachQuestion || "").slice(0, 70),
    stuckOnCausal: decision.currentNeed === "causal",
    state: nextState,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function detectStuck(needs, target) {
  return needs.filter((n) => n === target).length >= 3;
}

function detectCycle(needs) {
  if (needs.length < 4) return false;
  const a = needs[0];
  const b = needs[1];
  if (a === b) return false;
  for (let i = 2; i < needs.length; i++) {
    const expected = i % 2 === 0 ? a : b;
    if (needs[i] !== expected) return false;
  }
  return true;
}

function replaySession(session, { repeatLast = 1 } = {}) {
  let state = baseState(session);
  const trace = [];
  const turns =
    repeatLast > 1
      ? Array.from({ length: repeatLast }, () => session.turns[0])
      : session.turns;

  for (let i = 0; i < turns.length; i++) {
    const row = runTurn(state, session, turns[i], i);
    trace.push(row);
    state = row.state;
  }
  return trace;
}

function signalRange(traces) {
  const all = traces.flat();
  const pick = (k) => all.map((t) => t.signals[k]);
  return {
    causal: [Math.min(...pick("causal")), Math.max(...pick("causal"))],
    closure: [Math.min(...pick("closure")), Math.max(...pick("closure"))],
    grounding: [Math.min(...pick("grounding")), Math.max(...pick("grounding"))],
  };
}

// --- Run ---
const traceA = replaySession(SESSION_A, { repeatLast: SESSION_A.repeatTurns });
const traceB = replaySession(SESSION_B);

const needsA = traceA.map((t) => t.nextNeed);
const needsB = traceB.map((t) => t.nextNeed);

const passA =
  !detectStuck(needsA, "causal") &&
  !traceA.some((t) => t.stuckOnCausal) &&
  needsA[0] !== "causal";

const passB =
  needsB[needsB.length - 1] === "ready" &&
  new Set(needsB).size >= 2;

const cyclesDetected =
  (detectCycle(needsA) ? 1 : 0) + (detectCycle(needsB) ? 1 : 0);

const stuckDetected =
  detectStuck(needsA, "causal") ||
  detectStuck(needsA, "closure") ||
  detectStuck(needsB, "causal");

const ranges = signalRange([traceA, traceB]);

const converges =
  !stuckDetected &&
  cyclesDetected === 0 &&
  passA &&
  passB;

// --- Console trace ---
console.log("=== Layer 3: Full Stage2 Replay ===\n");

for (const [label, trace] of [
  ["Session A (dead-loop case)", traceA],
  ["Session B (normal progressive)", traceB],
]) {
  console.log(`--- ${label} ---`);
  for (const row of trace) {
    console.log(`Turn ${row.turn}:`);
    console.log(`  user: ${row.userPreview}`);
    console.log(
      `  signals: { causal: ${row.signals.causal}, closure: ${row.signals.closure}, grounding: ${row.signals.grounding} }`,
    );
    console.log(`  nextNeed: ${row.nextNeed}  advanceTo: ${row.advanceTo}`);
    console.log(`  coachAsk: ${row.coachAsk || "(empty)"}`);
    console.log();
  }
  console.log(`path: ${trace.map((t) => t.nextNeed).join(" → ")}\n`);
}

// --- Report ---
console.log(`
Policy Layer Validation Report
==============================

1. Signal stability
- causal range: ${ranges.causal[0]} – ${ranges.causal[1]}
- closure range: ${ranges.closure[0]} – ${ranges.closure[1]}
- grounding range: ${ranges.grounding[0]} – ${ranges.grounding[1]}

2. NextNeed behavior
- cycles detected: ${cyclesDetected}/2 sessions
- stuck detected: ${stuckDetected ? "yes" : "no"}
- causal lock (≥3×): ${detectStuck(needsA, "causal") || detectStuck(needsB, "causal") ? "yes" : "no"}

3. Session A replay
- result: ${passA ? "pass" : "fail"}
- path: ${needsA.join(" → ")}
- Turn1 stuckOnCausal: ${traceA[0].stuckOnCausal}
- postProcess Turn1 advanceTo: ${traceA[0].advanceTo}

4. Session B replay
- result: ${passB ? "pass" : "fail"}
- path: ${needsB.join(" → ")}
- reaches ready: ${needsB[needsB.length - 1] === "ready"}

5. Verdict
- ${converges ? "safe to proceed" : "not safe"}
- convergence: no infinite repetition=${!stuckDetected}, no single-state lock=${!detectStuck(needsA, "causal")}, no oscillation explosion=${cyclesDetected === 0}
`);

if (!converges) process.exit(1);
