/**
 * Replay Session A/B Body1 turn1 — discourse coverage only (no postProcess).
 */
import {
  appendDiscourseTurn,
  aggregateCoverage,
  buildDiscourseMemory,
  detectFunctionsFromSentence,
  getNextNeed,
  needToBuildStep,
} from "../src/lib/domain/chain-discourse.ts";
import { resolveChainTurnDecision } from "../src/lib/domain/chain-turn-decision.ts";
import { buildChainBaselineSlots } from "../src/lib/domain/chain-slot-pool.ts";
import { getChainBuildContext } from "../src/lib/domain/chain-scaffold.ts";

const userMsg =
  "原因：游客变多之后，餐饮住宿购物的需求也变大。因此，餐厅酒店等能赚更多钱，另外一方面，他们会雇佣更多的人手。因此，旅游业发展能促进当地经济发展，同时提高居民的收入";

const sessions = {
  A: {
    body1Point: "国际旅游能显著带动当地经济发展并创造更多就业机会。",
    body1Angle: "主要好处（经济与就业）",
    llm: {
      mirror:
        "你清晰地解释了游客增加如何通过刺激消费需求来创造就业并增加居民收入的因果链条。",
      coachQuestion:
        "请写原因（Reason）：一句说明为什么 主要好处（经济与就业） 下，大学要提供实习/项目/实操",
    },
  },
  B: {
    body1Point: "国际旅游能促进当地经济发展，增加居民的实际收入。",
    body1Angle: "主要好处（经济维度）",
    llm: {
      mirror:
        "你清晰地阐述了经济运作机制：游客消费带动商家收入，进而创造就业并提升居民收入。",
      coachQuestion: "为了让论证更具体，你能试着举一个具体的旅游城市或",
    },
  },
};

function replayAppendPath(claim) {
  let memory = buildDiscourseMemory([], "body1", claim);
  memory = appendDiscourseTurn(memory, userMsg, "body1");
  const cov = aggregateCoverage(memory, "body1");
  return {
    path: "appendDiscourseTurn (turn pipeline)",
    coverage: cov,
    nextNeed: getNextNeed(cov),
    advanceTo: needToBuildStep(getNextNeed(cov)),
    signals: detectFunctionsFromSentence(userMsg, "body1", claim),
  };
}

function replaySplitPath(claim) {
  const memory = buildDiscourseMemory([userMsg], "body1", claim);
  const cov = aggregateCoverage(memory, "body1");
  return {
    path: "buildDiscourseMemory (split sentences)",
    coverage: cov,
    nextNeed: getNextNeed(cov),
    advanceTo: needToBuildStep(getNextNeed(cov)),
  };
}

function replayChainDecision(label, session) {
  const state = {
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
    coachContext: { chainBuildStep: "reason", chainStepAskCount: 0, lastQuestion: "" },
  };
  const decision = resolveChainTurnDecision({
    baselineSlots: buildChainBaselineSlots(state, "body1", {}),
    result: {
      mirror: session.llm.mirror,
      coachQuestion: session.llm.coachQuestion,
      verdict: "coach",
      advance: false,
    },
    body: "body1",
    buildCtx: getChainBuildContext(state, "body1"),
    userMessage: userMsg,
    prevStep: "reason",
    prevAskCount: 0,
    sameStepAsPrev: true,
    lastQuestion: "",
    state,
  });
  return {
    label,
    coverage: decision.coverage.scores,
    nextNeed: decision.currentNeed,
    advanceTo: decision.advanceTo,
    coachAsk: decision.coach.ask?.slice(0, 80),
    stuckOnCausal: decision.currentNeed === "causal",
  };
}

function formatSignals(s) {
  return `causal:${s.causal.toFixed(2)} closure:${s.closure.toFixed(2)} grounding:${s.grounding.toFixed(2)}`;
}

console.log("=== Per-sentence detectFunctionsFromSentence ===");
for (const part of userMsg.split(/[。；]/).filter((s) => s.trim().length >= 8)) {
  const sig = detectFunctionsFromSentence(part.trim(), "body1", sessions.B.body1Point);
  console.log(part.trim().slice(0, 50) + "…");
  console.log(" ", formatSignals(sig));
}

console.log("\n=== Full message detectFunctionsFromSentence (Session B claim) ===");
console.log(formatSignals(detectFunctionsFromSentence(userMsg, "body1", sessions.B.body1Point)));

for (const [key, session] of Object.entries(sessions)) {
  console.log(`\n========== Session ${key} ==========`);
  console.log(JSON.stringify(replayAppendPath(session.body1Point), null, 2));
  console.log(JSON.stringify(replaySplitPath(session.body1Point), null, 2));
  console.log(JSON.stringify(replayChainDecision(key, session), null, 2));
}
