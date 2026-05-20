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
  isLinkSentence,
  isReasonSentence,
} from "../src/lib/domain/chain-scaffold.ts";
import { materializeSlotsFromPool } from "../src/lib/domain/chain-slot-pool.ts";

const reason =
  "课本的知识偏向于学术，和职场所需要的知识技能不完全匹配，因此需要在实践项目中来补充";
const example =
  "比如读计算机的，课本里还在学c++, 但是实际公司里已经很少用了，会使用更适合自己业务模式的语言";
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

const pool = {
  reason: [reason],
  example: [example],
  link: [link],
};
let slots = materializeSlotsFromPool(pool, "提前积累技能才能在求职中获得竞争优势");
ok(slots.reason === reason, "池化 reason 保留");
ok(slots.example === example, "池化 example 保留");
ok(slots.link === link, "池化 link 保留且不同于 reason");

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
  baselineSlots: slots,
  result: { mirror: "好，收束够了。", chainTurnRole: "link", chainTurnQuality: "ok" },
  body: "body1",
  buildCtx: { bodyPoint: "提前积累技能", bodyAngle: "就业市场与职场技能" },
  userMessage: link,
  prevStep: "link",
  prevAskCount: 1,
  sameStepAsPrev: true,
  lastQuestion: "请写段末收束",
});

ok(decision.advanceTo === "ready", "link 够用时 advanceTo 为 ready");
ok(!decision.coach.ask || decision.coach.ask.length < 80, "ready 时不复读长 link 模板");
ok(areChainSlotsSemanticallyValid(decision.workingSlots, "body1"), "四环语义有效");

const step = getNextChainBuildStep(decision.workingSlots, "body1").step;
ok(step === "ready", "getNextChainBuildStep 为 ready");

if (fail) {
  process.exit(1);
}
console.log("\nAll chain regression checks passed.");
