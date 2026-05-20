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

if (fail) {
  process.exit(1);
}
console.log("\nAll chain regression checks passed.");
