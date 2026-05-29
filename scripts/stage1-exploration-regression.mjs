/**
 * Stage1 探索回归：旅游题（outweigh）不应在利弊齐后重复开场问。
 * 运行：npm run test:stage1
 */
import { createInitialState } from "../src/lib/domain/state.ts";
import {
  assessExplorationContent,
  assessEssaySubstance,
  explorationSideStatus,
  userMessages,
} from "../src/lib/domain/essay-substance.ts";
import { postProcessStage1 } from "../src/lib/domain/stage1-coach.ts";
import { resolveHandoffTurnDecision } from "../src/lib/domain/handoff-turn-decision.ts";
import {
  extractExplorationThemes,
  isOpeningExplorationPrompt,
  themesToHandoffPatch,
} from "../src/lib/domain/stage1-exploration-themes.ts";
import {
  resolveQuestionHintType,
  topicImpliesProsConsWeighing,
} from "../src/lib/domain/stage1-question-hint.ts";
import { migrateSessionState } from "../src/lib/domain/migrate-state.ts";
import { readRewriteRiskGate } from "../src/lib/domain/stage1-rewrite-risk.ts";

const TOURISM_PROMPT =
  "International tourism has brought enormous benefits to many places. At the same time, there is concern about its impact on local inhabitants and the environment. Do the disadvantages of international tourism outweigh the advantages?";

let fail = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    fail++;
  } else {
    console.log("ok:", msg);
  }
}

const q3 = {
  id: "q3",
  title: "Global tourism",
  prompt: TOURISM_PROMPT,
  hintType: "adv_disadv",
};

ok(topicImpliesProsConsWeighing(TOURISM_PROMPT), "outweigh 题干识别为利弊权衡");
ok(resolveQuestionHintType(createInitialState(q3)) === "adv_disadv", "q3 有效题型为 adv_disadv");

const legacyAgree = migrateSessionState({
  ...createInitialState({ ...q3, hintType: "agree" }),
  version: 2,
});
ok(
  legacyAgree.questionHintType === "adv_disadv",
  "老 session agree+q3 迁移为 adv_disadv",
);

function stateAfterUserLines(lines) {
  let state = createInitialState(q3);
  state = {
    ...state,
    subStep: "S1_EVAL",
    coachContext: { handoffPhase: "exploring", exploreRound: 0 },
  };
  for (const content of lines) {
    state = {
      ...state,
      chatHistory: [
        ...state.chatHistory,
        { role: "user", content, ts: Date.now() },
      ],
    };
  }
  return state;
}

const s1 = stateAfterUserLines([
  "好处多还是坏处多，我觉得整体好处更多",
]);
const { contentReady: cr1 } = assessExplorationContent(s1);
ok(cr1, "仅立场句后 contentReady（利弊题 hasLean）");

const s3 = stateAfterUserLines([
  "好处多还是坏处多，我觉得整体好处更多",
  "能促进经济发展，不同地区的文化交流",
  "交通拥堵，餐馆或景区等游客多的地方垃圾多",
]);
const msgs = userMessages(s3);
const themes = extractExplorationThemes(s3, msgs);
ok(themes.themesComplete, "三轮后 themesComplete");
ok(themes.positionLean === "pro", "立场为 pro");

const sides = explorationSideStatus(s3, msgs);
ok(sides.sideA && sides.sideB, "sideA/sideB 按利弊主题齐");

const substance = assessEssaySubstance(s3);
ok(
  !isOpeningExplorationPrompt(substance.coachPrompt),
  "利弊齐后 coachPrompt 不是开场白",
);

const decisionState = {
  ...s3,
  coachContext: { ...s3.coachContext, exploreRound: 3 },
};
const { result } = postProcessStage1(decisionState, {
  verdict: "coach",
  advance: false,
  mirror: "你补充了交通拥堵和垃圾，利弊和立场都梳理清楚了。",
  coachQuestion: "",
  extracted: {},
});
const visible = result.userVisibleText ?? "";
ok(
  !isOpeningExplorationPrompt(visible),
  "总结轮 LLM 无问时不拼开场三问",
);
ok(
  /Body|具体|写实|论点/.test(visible) || !result.coachQuestion?.trim(),
  "总结轮应细化分论点或不再追问",
);

const mixedMsg =
  "能够促进旅游业发展，增加本地居民的收入。坏处，可能会破坏景区环境";
const mixedState = stateAfterUserLines([
  "好处多于坏处（利大于弊）",
  mixedMsg,
]);
const mixedMsgs = userMessages(mixedState);
const mixedThemes = extractExplorationThemes(mixedState, mixedMsgs);
const mixedPatch = themesToHandoffPatch(mixedThemes, mixedState, mixedMsgs);
ok(
  mixedPatch.body1Point?.includes("收入") && !/坏处|破坏景区/.test(mixedPatch.body1Point ?? ""),
  "同条消息利弊混写时 Body1 不含坏处句",
);
ok(
  mixedPatch.body2Point?.includes("环境") || mixedPatch.body2Point?.includes("破坏"),
  "坏处部分进入 Body2",
);

const dupState = stateAfterUserLines([
  "好处更多，利大于弊",
  "旅游业能促进当地经济发展，同时增加当地居民的就业机会",
]);
const dupMsgs = userMessages(dupState);
const dupThemes = extractExplorationThemes(dupState, dupMsgs);
const dupPatch = themesToHandoffPatch(dupThemes, dupState, dupMsgs);
ok(
  dupPatch.body1Point?.includes("经济") || dupPatch.body1Point?.includes("就业"),
  "仅有好处句时 Body1 保留经济/就业",
);
ok(
  !dupPatch.body2Point?.trim() ||
    (dupPatch.body1Point !== dupPatch.body2Point &&
      !dupPatch.body2Point?.includes("经济")),
  "无坏处句时 Body2 不与 Body1 重复同一句好处",
);

const refineFlow = stateAfterUserLines([
  "好处和坏处哪个更多，我觉得好处更多",
  "好处：促进当地经济发展，和居民就业；坏处：破坏景区环境",
  "游客带动购物，餐饮住宿等行业的发展，餐馆酒店规模扩大，收益增加，行业需要更多从业人员",
]);
const refineState = {
  ...refineFlow,
  coachContext: {
    ...refineFlow.coachContext,
    exploreRound: 4,
    lastQuestion:
      "Body2 的坏处请再具体一点：对谁、造成什么不便或破坏？用一句话写出能展开论证的总括。",
  },
};
const body2Answer =
  "对景区的环境带来不良影响，特别是自然景区，游客增多可能导致垃圾增多等";
const refineDecision = resolveHandoffTurnDecision({
  state: refineState,
  result: { verdict: "coach", advance: false },
  userMessage: body2Answer,
});
ok(
  !/Body1 的好处还想再写实/.test(refineDecision.coach.ask ?? ""),
  "Body2 答完后不再复读 Body1 细化模板",
);
ok(
  refineDecision.shouldPropose ||
    /确认整理|六栏|核对/.test(
      [refineDecision.coach.ask, refineDecision.coach.mirror].join(" "),
    ),
  "Body1+Body2 均已写实时应进入整理或提示核对六栏",
);

ok(readRewriteRiskGate({ userVisibleText: "", rewriteRisk: "high" }).blockProposal, "high 拦截 proposed");
ok(!readRewriteRiskGate({ userVisibleText: "", rewriteRisk: "medium" }).blockProposal, "medium 不拦截");
ok(!readRewriteRiskGate({ userVisibleText: "", rewriteRisk: "low" }).blockProposal, "low 不拦截");

const sShort = stateAfterUserLines([
  "好处和坏处哪个多，我觉得好处更多",
  "好处：促进当地经济发展；坏处：可能会对景区带来环境破坏",
]);
const inflatedProposal = {
  taskUnderstanding: "讨论国际旅游对经济与环境的影响并权衡利弊",
  position: "利大于弊",
  body1Point: "国际旅游业能显著促进当地经济发展并提升居民收入。",
  body2Point: "虽然旅游业会给当地环境带来一定压力，但这种破坏是可控的。",
  body1Angle: "侧重经济效益与就业",
  body2Angle: "侧重环境影响及应对",
  questionType: "adv_disadv",
};
const blocked = postProcessStage1(
  { ...sShort, coachContext: { ...sShort.coachContext, exploreRound: 2 } },
  {
    verdict: "coach",
    advance: false,
    mirror: "利弊和立场我都记下了。",
    coachQuestion: "",
    userVisibleText: "",
    essaySubstanceSufficient: true,
    rewriteRisk: "high",
    rewriteReasons: ["added_new_mechanism", "strengthened_claim"],
    rewriteFollowUpAsk:
      "你提到环境破坏，但「破坏可控」需要你自己补一句：对谁、通过什么措施、为什么可控？",
    rewriteMirror: "我先不整理进左侧，因为有几处判断还不是你原话里的。",
    proposedHandoff: inflatedProposal,
    proposalSummary: "总体利大于弊。",
  },
);
ok(
  blocked.state.coachContext?.handoffPhase === "exploring",
  "rewriteRisk=high 时不进入 proposed",
);
ok(
  !/确认整理并填入/.test(blocked.result.userVisibleText ?? ""),
  "high 时不展示整理确认话术",
);
ok(
  blocked.result.coachQuestion?.includes("可控"),
  "high 时用 LLM rewriteFollowUpAsk",
);

const allowed = postProcessStage1(
  { ...sShort, coachContext: { ...sShort.coachContext, exploreRound: 2 } },
  {
    verdict: "coach",
    advance: false,
    mirror: "",
    coachQuestion: "",
    userVisibleText: "",
    essaySubstanceSufficient: true,
    rewriteRisk: "medium",
    rewriteFollowUpAsk: "",
    rewriteMirror: "",
    proposedHandoff: inflatedProposal,
    proposalSummary: "利弊与立场已齐。",
  },
);
ok(
  allowed.state.coachContext?.handoffPhase === "proposed" ||
    /确认整理并填入/.test(allowed.result.userVisibleText ?? ""),
  "rewriteRisk=medium 仍可按原流程 proposed",
);

// ── 网购短答 + 确认 → 应进入六栏整理 ─────────────────────────────────────
const ONLINE_SHOPPING_PROMPT =
  "Online shopping is becoming more popular than in-store shopping. Is this a positive or negative development?";

const q7 = {
  id: "q7",
  title: "Online shopping",
  prompt: ONLINE_SHOPPING_PROMPT,
  hintType: "pos_neg",
};

function stateAfterUserLinesQ7(lines) {
  let state = createInitialState(q7);
  state = {
    ...state,
    subStep: "S1_EVAL",
    coachContext: { handoffPhase: "exploring", exploreRound: 0 },
  };
  for (const content of lines) {
    state = {
      ...state,
      chatHistory: [
        ...state.chatHistory,
        { role: "user", content, ts: Date.now() },
      ],
    };
  }
  return state;
}

const onlineConfirmState = stateAfterUserLinesQ7([
  "整体是积极的",
  "好处：节省时间，坏处：容易冲动消费",
  "好的",
]);
const onlineConfirmDecision = resolveHandoffTurnDecision({
  state: { ...onlineConfirmState, coachContext: { ...onlineConfirmState.coachContext, exploreRound: 3 } },
  result: { verdict: "coach", advance: false },
  userMessage: "好的",
});
ok(
  onlineConfirmDecision.shouldPropose ||
    /六栏|核对|确认整理/.test(
      [onlineConfirmDecision.coach.ask, onlineConfirmDecision.coach.mirror].join(" "),
    ),
  "网购题：用户确认后应进入整理或提示核对六栏",
);

const onlineFrustrationState = stateAfterUserLinesQ7([
  "整体是积极的",
  "好处：节省时间，坏处：容易冲动消费",
  "这我不是已经回答了吗",
]);
const onlineFrustrationDecision = resolveHandoffTurnDecision({
  state: { ...onlineFrustrationState, coachContext: { ...onlineFrustrationState.coachContext, exploreRound: 3 } },
  result: { verdict: "coach", advance: false },
  userMessage: "这我不是已经回答了吗",
});
ok(
  onlineFrustrationDecision.shouldPropose ||
    /六栏|核对|确认整理/.test(
      [onlineFrustrationDecision.coach.ask, onlineFrustrationDecision.coach.mirror].join(" "),
    ),
  "网购题：用户挫折时应进入整理或提示核对六栏",
);

const onlineContentReadyState = stateAfterUserLinesQ7([
  "整体是积极的",
  "好处：节省时间，坏处：容易冲动消费",
]);
const { contentReady: onlineContentReady } = assessExplorationContent(onlineContentReadyState);
ok(onlineContentReady, "网购题：利弊+立场后 contentReady 为 true");

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nAll stage1 exploration checks passed.");
