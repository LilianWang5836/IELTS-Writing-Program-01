/**
 * 搭链回归：Reason → Example → Link 不应卡在 Link 模板复读。
 * 运行：npm run test:chain
 */
import {
  applyPrimaryRingWrite,
  parseUnderstandingForStep,
  resolveChainTurnDecision,
} from "../src/lib/domain/chain-turn-decision.ts";
import {
  aggregateCoverage,
  appendDiscourseTurn,
  argmaxSignalGap,
  assessParagraphCoverage,
  buildDiscourseMemory,
  computeSignalGaps,
  detectFunctionsFromSentence,
  getNextNeed,
  hasFunctionalClosure,
  isDiscourseArgumentReady,
  isParagraphCoverageComplete,
  needToBuildStep,
} from "../src/lib/domain/chain-discourse.ts";
import { assessParagraphSubstance } from "../src/lib/domain/paragraph-substance.ts";
import { detectChainUserIntent } from "../src/lib/domain/stage2-context.ts";
import {
  deriveChainWorkflowStatus,
  formatChainWorkshopPanel,
} from "../src/lib/domain/chain-workflow-ui.ts";
import {
  areChainSlotsSemanticallyValid,
  getNextChainBuildStep,
  isChainStepFilled,
  isLinkSentence,
  isReasonSentence,
  isTooSimilarToClaim,
  isWeakExampleSentence,
  looksLikeHandoffClaim,
} from "../src/lib/domain/chain-scaffold.ts";
import {
  buildChainBaselineSlots,
  collectRingCandidates,
  materializeSlotsFromPool,
} from "../src/lib/domain/chain-slot-pool.ts";

const reason =
  "课本的知识偏向于学术，和职场所需要的知识技能不完全匹配，因此需要在实践项目中来补充";
const exampleCpp =
  "比如课本里还在学c++, 但是实际公司里已经很少用了，会使用更适合自己业务模式的语言";
const exampleCoop =
  "学校如果和企业合作，引入实习机会或者实践项目，学生就可以学到工作中真正会用到的技能";
const link =
  "因此，通过实际的实践或者实习，可以学习到实际公司里面需要的技术，这个能有助于你拿到很多的面试机会，找到工作后也能更快地适应";

let fail = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    fail++;
  } else {
    console.log("ok:", msg);
  }
}

ok(!isReasonSentence(link, "body1") || isLinkSentence(link, "body1"), "link 句优先作 link 而非纯 reason");
ok(isLinkSentence(link, "body1"), "link 句通过 isLinkSentence");

ok(!isWeakExampleSentence(exampleCpp, "body1"), "C++ 举例不算弱例");

const mockState = {
  chatHistory: [
    { role: "assistant", content: "我们一起搭 Body1 论证链" },
    { role: "user", content: reason },
    { role: "user", content: exampleCpp },
    { role: "user", content: exampleCoop },
    { role: "user", content: link },
  ],
  handoffLocked: true,
  stage: 2,
  s2: {
    body1Point: "大学应教授实用技能，使毕业生能迅速找到工作并贡献社会",
    body1Angle: "提供就业技能，帮助学生快速适应职场",
  },
};

const pool = collectRingCandidates(mockState, "body1");
let slots = materializeSlotsFromPool(
  pool,
  "大学应教授实用技能，使毕业生能迅速找到工作",
);
ok(slots.reason?.includes("课本"), "池化 reason 保留");
ok(
  slots.example?.includes("校企") ||
    slots.example?.includes("实习") ||
    slots.example?.includes("公司"),
  "池化 example 保留",
);
ok(slots.link?.includes("面试"), "池化 link 保留");
ok(slots.link !== slots.reason, "link 不同于 reason");

const staleSeg = { reason, example: exampleCpp };
const baseline = buildChainBaselineSlots(mockState, "body1", staleSeg);
ok(baseline.link === link, "陈旧 seg 不冲掉池化 link");
ok(isChainStepFilled(baseline, "example", "body1"), "baseline example 已够");

const uLink = parseUnderstandingForStep(
  { chainTurnRole: "reason", chainTurnQuality: "ok" },
  link,
  "link",
  "body1",
);
ok(uLink.role === "link", "缺 link 时 parseUnderstandingForStep 锚定 link");

slots = applyPrimaryRingWrite(slots, "link", link, "body1");
ok(slots.link === link, "主槽写入 link");

const decision = resolveChainTurnDecision({
  baselineSlots: baseline,
  result: {
    mirror: "你阐述了通过实践和实习学习公司所需技术。",
    chainTurnRole: "example",
    chainTurnQuality: "ok",
    coachQuestion: "请提供一个具体的职业或行业例子，说明大学",
  },
  body: "body1",
  buildCtx: {
    bodyPoint: "大学应教授实用技能，使毕业生能迅速找到工作",
    bodyAngle: "就业市场与职场技能",
  },
  userMessage: link,
  prevStep: "example",
  prevAskCount: 1,
  sameStepAsPrev: false,
  lastQuestion: "再补一句：面试/上岗/对口工作",
});

ok(decision.advanceTo === "ready", "link 够用时 advanceTo 为 ready");
ok(!decision.coach.ask?.trim(), "ready 时不追问行业例子");
ok(
  !/职业|行业|具体.*例子/.test(decision.coach.ask || ""),
  "忽略 LLM 倒退追问",
);
ok(
  areChainSlotsSemanticallyValid(decision.workingSlots, "body1"),
  "四环语义有效",
);
ok(
  areChainSlotsSemanticallyValid(baseline, "body1"),
  "baseline 四环语义有效",
);

const step = getNextChainBuildStep(decision.workingSlots, "body1").step;
ok(step === "ready", "getNextChainBuildStep 为 ready");

const body2Reason =
  "很多专业知识是系统性的，需要花很多时间从简单到难的学习";
const body2Example =
  "比如说医学生，本身的课业量是很大的，需要花很多时间学习，基础没有打扎实的话，后面学下去会很困难";
const body2Baseline = buildChainBaselineSlots(
  {
    chatHistory: [
      { role: "assistant", content: "我们一起搭 Body2 论证链" },
      { role: "user", content: body2Reason },
      { role: "user", content: body2Example },
    ],
    handoffLocked: true,
    stage: 2,
    s2: {
      body2Point: "大学应提供持续学习个人兴趣领域的机会",
      body2Angle: "纯粹知识、深入探索兴趣领域",
    },
  },
  "body2",
  {
    claim: "走学术道路者应持续学习感兴趣领域并积累系统知识",
    reason: body2Reason,
    example: body2Example,
  },
);
const body2Decision = resolveChainTurnDecision({
  baselineSlots: body2Baseline,
  result: {
    mirror: "你以医学生为例，解释了持续学习和扎实基础的重要性。",
    chainTurnRole: "example",
    chainTurnQuality: "weak",
    coachQuestion: "请你提供一个具体的课程名、研究课题或训练场景。",
  },
  body: "body2",
  buildCtx: {
    bodyPoint: "大学应提供持续学习个人兴趣领域的机会",
    bodyAngle: "纯粹知识、深入探索兴趣领域",
  },
  userMessage: body2Example,
  prevStep: "example",
  prevAskCount: 1,
  sameStepAsPrev: true,
  lastQuestion: "课程名、研究课题或训练场景",
  state: {
    chatHistory: [
      { role: "assistant", content: "我们一起搭 Body2 论证链" },
      { role: "user", content: body2Reason },
      { role: "user", content: body2Example },
    ],
    handoffLocked: true,
    stage: 2,
    s2: {
      body2Point: "大学应提供持续学习个人兴趣领域的机会",
      body2Angle: "纯粹知识、深入探索兴趣领域",
    },
  },
});
ok(body2Decision.advanceTo === "link", "Body2 医学生例后 advanceTo 为 link");
ok(
  !/课程名|研究课题|训练场景/.test(body2Decision.coach.ask || ""),
  "Body2 不因 LLM weak 再追举例细节",
);
ok(
  /段末收束|因此|所以|Link/i.test(body2Decision.coach.ask || ""),
  "Body2 改问 Link",
);

const metaDecision = resolveChainTurnDecision({
  baselineSlots: {
    claim: "走学术道路者应持续学习感兴趣领域并积累系统知识",
    reason: body2Reason,
  },
  result: {
    chainTurnRole: "example",
    chainTurnQuality: "weak",
    coachQuestion: "请再补一点：课程名",
  },
  body: "body2",
  buildCtx: {
    bodyPoint: "大学应提供持续学习个人兴趣领域的机会",
    bodyAngle: "纯粹知识、深入探索兴趣领域",
  },
  userMessage: "我现在需要提供什么，分论点已经给了，你觉着这个分论点可以么",
  prevStep: "example",
  prevAskCount: 0,
  sameStepAsPrev: false,
  lastQuestion: "",
});
ok(metaDecision.understanding.role === "meta", "流程/meta 问句标 meta");
ok(
  !/你举的方向我听到了/.test(metaDecision.coach.ask || ""),
  "meta 不走举例追问模板",
);
ok(
  /分论点|审题|Claim|原因|举例|收束/.test(metaDecision.coach.mirror || ""),
  "meta 镜像说明定稿/环节",
);

const b2Claim =
  "大学应为走学术道路的学生提供持续学习感兴趣领域并系统积累知识的机会";
const b2ClaimNorm = "走学术道路者应持续学习感兴趣领域并积累系统知识";
const b2Link =
  "因此，系统打好专业基础才能为长期深造与领域研究提供支撑";

ok(looksLikeHandoffClaim(b2Claim, "body2"), "Body2 分论点句式不算 Link");
ok(!isLinkSentence(b2Claim, "body2", b2ClaimNorm), "Body2 分论点不写入 link 槽");
ok(isLinkSentence(b2Link, "body2", b2ClaimNorm), "真正收束句可作 Link");
ok(!isTooSimilarToClaim(b2Link, b2ClaimNorm, "body2"), "Link 与 claim 不判同句");

const b2SoftLink =
  "因此，如果是这些特别需要长期学习的领域，并且已经确定了走学术发展的路线，聚焦于知识本身是非常有必要的";
ok(
  hasFunctionalClosure(b2SoftLink, "body2", b2ClaimNorm),
  "Body2 功能收束：长期学习+学术路线+有必要",
);
const b2SoftState = {
  chatHistory: [
    { role: "assistant", content: "我们一起搭 Body2 论证链" },
    { role: "user", content: body2Reason },
    { role: "user", content: body2Example },
    { role: "user", content: b2SoftLink },
  ],
  handoffLocked: true,
  stage: 2,
  s2: {
    body2Point: "大学应提供持续学习个人兴趣领域的机会",
    body2Angle: "纯粹知识、深入探索兴趣领域",
  },
};
const b2SoftBaseline = buildChainBaselineSlots(b2SoftState, "body2", {
  claim: b2ClaimNorm,
  reason: body2Reason,
  example: body2Example,
});
const b2SoftCov = assessParagraphCoverage(
  buildDiscourseMemory(
    b2SoftState.chatHistory.filter((m) => m.role === "user").map((m) => m.content),
    "body2",
    b2ClaimNorm,
  ),
  "body2",
);
ok(isParagraphCoverageComplete(b2SoftCov), "Body2 医学生+软收束 coverage 完整");
const b2SoftDecision = resolveChainTurnDecision({
  baselineSlots: b2SoftBaseline,
  result: {
    mirror: "你用因此总结了长期学习与学术路线。",
    chainTurnRole: "link",
    chainTurnQuality: "weak",
    coachQuestion: "请更具体说明如何支撑分论点",
  },
  body: "body2",
  buildCtx: {
    bodyPoint: "大学应提供持续学习个人兴趣领域的机会",
    bodyAngle: "学术深造与知识体系",
  },
  userMessage: b2SoftLink,
  prevStep: "link",
  prevAskCount: 1,
  sameStepAsPrev: true,
  lastQuestion: "请写段末收束",
  state: b2SoftState,
});
ok(b2SoftDecision.advanceTo === "ready", "Body2 软收束句 coverage 推进 ready");
ok(!!b2SoftDecision.workingSlots.link?.includes("因此"), "软收束写入 link 槽");
ok(
  b2SoftDecision.workingSlots.reason?.includes("系统性") ||
    b2SoftDecision.workingSlots.reason?.includes("由浅入深"),
  "reason 不被收束句覆盖",
);

const reasonSignals = detectFunctionsFromSentence(reason, "body1");
ok(
  reasonSignals.causal >= 0.7,
  "课本句含 causal ≥0.7",
);
ok(
  reasonSignals.grounding < 0.6,
  "课本句 grounding 未达标（仅提到项目）",
);
const reasonCov = aggregateCoverage(
  buildDiscourseMemory([reason], "body1", "大学应教授实用技能"),
  "body1",
);
ok(
  getNextNeed(reasonCov) === "closure",
  "RFC-3 reason 句后 argmax gap 为 closure（closure score=0）",
);
ok(needToBuildStep("grounding") === "example", "grounding need → example 步");

const reasonOnlyDecision = resolveChainTurnDecision({
  baselineSlots: {
    claim: "大学应教授实用技能，使毕业生能迅速找到工作并贡献社会",
  },
  result: {
    mirror: "你说明了课本与实践的差异。",
    chainTurnRole: "reason",
    chainTurnQuality: "ok",
    coachQuestion: "请写段末收束",
  },
  body: "body1",
  buildCtx: {
    bodyPoint: "大学应教授实用技能，使毕业生能迅速找到工作",
    bodyAngle: "就业市场与职场技能",
  },
  userMessage: reason,
  prevStep: "reason",
  prevAskCount: 0,
  sameStepAsPrev: false,
  lastQuestion: "",
});
ok(
  reasonOnlyDecision.advanceTo === "link",
  "RFC-3 reason 句后 closure gap 最大 → advanceTo link",
);
ok(
  reasonOnlyDecision.currentNeed === "closure",
  "RFC-3 reason 句 primaryNeed 为 closure",
);

ok(detectChainUserIntent("所以呢") === "clarify", "所以呢 走 clarify intent");
const clarifyDecision = resolveChainTurnDecision({
  baselineSlots: b2SoftBaseline,
  result: {
    mirror: "你问所以呢，是在询问下一步",
    chainTurnRole: "meta",
    chainTurnQuality: "none",
  },
  body: "body2",
  buildCtx: {
    bodyPoint: "大学应提供持续学习个人兴趣领域的机会",
    bodyAngle: "学术深造与知识体系",
  },
  userMessage: "所以呢",
  prevStep: "link",
  prevAskCount: 2,
  sameStepAsPrev: true,
  lastQuestion: "请写段末收束",
  state: b2SoftState,
});
ok(clarifyDecision.understanding.role === "meta", "所以呢 标 meta 不写槽");
ok(
  !/课程名|研究课题/.test(clarifyDecision.coach.ask || ""),
  "所以呢 不触发举例追问",
);

const wfReady = deriveChainWorkflowStatus({
  body: "body2",
  coverage: b2SoftCov,
  chainPhase: "coaching",
  canPropose: true,
  ringsReady: true,
  rulesOk: true,
  substanceGaps: [],
  hasProposalDraft: true,
});
ok(wfReady.kind === "ready_to_finalize", "coverage 齐 + canPropose → Ready to finalize");
ok(
  /Ready to finalize|确认链条/.test(
    formatChainWorkshopPanel({ body: "body2", coverage: b2SoftCov, workflow: wfReady }),
  ),
  "工作流面板含 finalize 提示",
);

const wfDraft = deriveChainWorkflowStatus({
  body: "body2",
  coverage: b2SoftCov,
  chainPhase: "coaching",
  canPropose: false,
  ringsReady: true,
  rulesOk: true,
  substanceGaps: [],
  hasProposalDraft: false,
});
ok(wfDraft.kind === "ready_to_draft", "功能齐但未 canPropose → Ready to draft chain");
ok(
  formatChainWorkshopPanel({
    body: "body2",
    coverage: b2SoftCov,
    workflow: wfDraft,
  }).includes("Why It Matters"),
  "面板含 Coverage 维度",
);

const wfMissing = deriveChainWorkflowStatus({
  body: "body2",
  coverage: {
    scores: { claim: 1, causal: 0.8, grounding: 0.2, closure: 0 },
    claimEstablished: true,
    causalExplained: true,
    concreteGrounding: false,
    argumentativeClosure: false,
    missing: ["grounding", "closure"],
  },
  chainPhase: "coaching",
  canPropose: false,
  ringsReady: false,
  rulesOk: true,
  substanceGaps: [],
  hasProposalDraft: false,
});
ok(wfMissing.kind === "building", "缺多环 → Building argument");

const tourismMsgs = [
  "游客带动购物，餐饮住宿等行业的发展，餐馆酒店规模扩大，收益增加，行业需要更多从业人员",
  "对景区的环境带来不良影响，特别是自然景区，游客增多可能导致垃圾增多等",
];
const tourismClaim =
  "游客带动购物，餐饮住宿等行业的发展，餐馆酒店规模扩大，收益增加，行业需要更多从业人员";
const tourismMem = buildDiscourseMemory(tourismMsgs, "body1", tourismClaim);
const tourismCov = aggregateCoverage(tourismMem, "body1");
ok(
  isDiscourseArgumentReady(tourismCov) || tourismCov.grounding >= 0.6,
  "旅游题 Body1 因果+支撑可被 discourse 识别",
);
const tourismState = {
  chatHistory: tourismMsgs.map((content) => ({ role: "user", content, ts: 1 })),
  stage: 2,
  s2: {
    body1Point: tourismClaim,
    body1Angle: "主要好处（经济等）",
    body1: { slots: {}, draft: "" },
    body2: { slots: {}, draft: "" },
  },
};
const tourismSub = assessParagraphSubstance(tourismState, "body1", undefined, {
  claim: tourismClaim,
  reason: tourismMsgs[0],
  example: "例如景区周边餐馆旺季需要更多服务员",
});
ok(
  tourismSub.sufficient || tourismSub.gaps.every((g) => g.startsWith("可选收束")),
  "旅游题 substance 不因缺独立 link 槽而卡死",
);

const tourismTurn1 =
  "原因：游客变多之后，餐饮住宿购物的需求也变大。因此，餐厅酒店等能赚更多钱，另外一方面，他们会雇佣更多的人手。因此，旅游业发展能促进当地经济发展，同时提高居民的收入";
const tourismClaimB =
  "国际旅游能促进当地经济发展，增加居民的实际收入。";
let tourismAppendMem = buildDiscourseMemory([], "body1", tourismClaimB);
tourismAppendMem = appendDiscourseTurn(
  tourismAppendMem,
  tourismTurn1,
  "body1",
);
const tourismAppendCov = aggregateCoverage(tourismAppendMem, "body1");
ok(
  tourismAppendCov.causal >= 0.7,
  "旅游 Body1 首句 append 路径 causal ≥0.7",
);
ok(
  getNextNeed(tourismAppendCov) !== "causal",
  "旅游 Body1 首句后 nextNeed 不再卡在 causal",
);

const enClaim = "International tourism improves local economy.";
const enCase1 = detectFunctionsFromSentence(
  "Because tourism increases, local economy improves.",
  "body1",
  enClaim,
);
ok(enCase1.causal > 0.8, "RFC-2 EN case1: because → causal > 0.8");
const enCase2 = detectFunctionsFromSentence(
  "In conclusion, tourism benefits society.",
  "body1",
  enClaim,
);
ok(enCase2.closure > 0.8, "RFC-2 EN case2: in conclusion → closure > 0.8");
const enCase3 = detectFunctionsFromSentence(
  "Because tourists increase, restaurants grow, therefore economy improves.",
  "body1",
  enClaim,
);
ok(enCase3.causal >= 0.7, "RFC-2 EN case3: compound causal high");
ok(
  enCase3.closure >= 0.45 && enCase3.closure <= 0.75,
  "RFC-2 EN case3: therefore closure medium",
);

const softCov = { claim: 1, causal: 0.75, grounding: 0.55, closure: 0.1 };
const softGaps = computeSignalGaps(softCov);
ok(softGaps.closure > softGaps.grounding, "RFC-3 gap: closure weakest when score lowest");
ok(
  argmaxSignalGap(softGaps) === "closure",
  "RFC-3 argmax picks largest signal gap",
);
ok(
  getNextNeed(softCov) === "closure",
  "RFC-3 getNextNeed uses argmax not waterfall",
);
ok(
  getNextNeed({ claim: 1, causal: 0.95, grounding: 0.62, closure: 0.63 }) ===
    "ready",
  "RFC-3 ready gate still applies when isDiscourseArgumentReady",
);

if (fail) {
  process.exit(1);
}
console.log("\nAll chain regression checks passed.");
