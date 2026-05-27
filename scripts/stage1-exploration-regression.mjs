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
import {
  extractExplorationThemes,
  isOpeningExplorationPrompt,
} from "../src/lib/domain/stage1-exploration-themes.ts";
import {
  resolveQuestionHintType,
  topicImpliesProsConsWeighing,
} from "../src/lib/domain/stage1-question-hint.ts";
import { migrateSessionState } from "../src/lib/domain/migrate-state.ts";

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

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nAll stage1 exploration checks passed.");
