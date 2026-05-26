/**
 * 句子教练回归
 * npm run test:sentence
 */
import {
  MAIN_ERROR_PRIORITY,
  applyStudentAnchoredScaffolding,
  assessLocalViability,
  assessMeaningAlignment,
  buildAssignContextPrefix,
  buildScaffoldResponse,
  decideSentenceState,
  detectStage3SentenceIntent,
  diagnoseSentence,
  formatSentenceCoachFeedback,
  formatViabilityProse,
  looksStructurallyWorkable,
  postProcessStage3Sentence,
} from "../src/lib/domain/sentence-coach.ts";

let fail = 0;
function ok(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    fail++;
  } else {
    console.log("ok:", msg);
  }
}

const badSubject = "accumulate skills can improve employability";
const d1 = diagnoseSentence(badSubject, "reason");
ok(d1.kind === "missing_subject", "主语缺失");
ok(d1.priority === "P1", "P1 优先级");
ok(/谁/.test(d1.repairQuestionZh), "中文修复问句");

const badWhich = "which can improve students get jobs faster";
const d2 = diagnoseSentence(badWhich, "reason");
ok(d2.kind === "subject_verb_broken" || d2.kind === "clause_attachment", "which 断裂");

const badVerb = "Students practical skills for workplaces";
const d2b = diagnoseSentence(badVerb, "reason");
ok(d2b.kind === "missing_verb", "缺少核心谓语");

const gerundSubject =
  "Mastering practical skills through internships can help graduates get more interviews.";
const dGerund = diagnoseSentence(gerundSubject, "impact");
ok(dGerund.kind !== "missing_subject", "动名词主语不应误判为主语缺失");

const badGap = "students join internships, competitive advantage";
const d3 = diagnoseSentence(badGap, "example");
ok(d3.kind === "cause_effect_gap", "因果断裂");

const mockState = {
  s2: {
    body1Point: "大学应教授实用技能，使毕业生能迅速找到工作",
    body1Angle: "实践经验帮助求职和适应工作",
    body2Point: "",
    body2Angle: "",
  },
  s3: {
    currentBody: "body1",
    modulePlan: { body1: ["example"], body2: [], conclusion: [] },
    moduleIndex: 0,
  },
} ;
const m1 = assessMeaningAlignment(
  mockState,
  "Students learn C++ at school.",
  "example",
);
ok(!m1.aligned, "meaning 缺失时先拦截");
ok(
  m1.missing.includes("claim_relevance") || m1.missing.includes("logic_link"),
  "example 句缺关联/连接会被指出",
);

const m2 = assessMeaningAlignment(
  mockState,
  "For instance, students learn C++ at school, but companies hardly use it in real workplace.",
  "example",
);
ok(
  m2.aligned,
  "example 局部功能成立时应通过（不强求同句含 internship/job result）",
);

// === C++ example 句：不传 module 参数，从 state 解析 ====================
const body1ExampleState = {
  stage: 3,
  subStep: "S3_2_MODULE",
  s2: {
    body1Point: "对于就业导向的学生，大学应帮助其积累实践技能以获得求职竞争优势",
    body1Angle: "实习帮助适应职场",
    body2Point: "P2",
    body2Angle: "A2",
  },
  s3: {
    currentBody: "body1",
    modulePlan: { body1: ["claim", "reason", "example"], body2: [], conclusion: [] },
    moduleIndex: 2,
    mode: "feedback",
    pendingSentence: undefined,
    confirmedSentences: {},
  },
  coachContext: {},
};
const cppExample =
  "for example, students learn c++ at school while companies rarely use it these days, instead, they use more suitable business model language";
const mCpp = assessMeaningAlignment(body1ExampleState, cppExample);
ok(mCpp.aligned, "C++ example 句不传 module 也应通过（从 state 解析 example）");
ok(
  !mCpp.missing.includes("job") && !mCpp.missing.includes("practice"),
  "C++ example 句不应被误判缺 job/practice",
);
const cppProcessed = postProcessStage3Sentence(
  body1ExampleState,
  { verdict: "pass", advance: false, userVisibleText: "", moduleComplete: false },
  cppExample,
);
ok(
  cppProcessed.state.coachContext?.sentenceState !== "repair_needed",
  "C++ example 句 postProcess 不应走 meaning_gap repair_needed",
);
ok(
  ["refine_needed", "stabilizable", "workable"].includes(
    cppProcessed.state.coachContext?.sentenceState ?? "",
  ),
  "C++ example 句应进入 refine_needed / stabilizable / workable，而非 meaning 拦截",
);
const bizViab = assessLocalViability(cppExample);
ok(
  bizViab.issues.some((i) => /business model language/i.test(i.anchor ?? "")),
  "`business model language` anchor 应被命中",
);

const good =
  "Universities should prioritize practical skills because this helps graduates adapt to workplace demands.";
const d4 = diagnoseSentence(good, "claim");
ok(d4.pass, "完整句 pass");

const fuzzy = "Good for jobs.";
const d5 = diagnoseSentence(fuzzy, "reason");
ok(d5.kind === "unclear_wording", "未命中前置规则时走 unclear 兜底");
ok(
  detectStage3SentenceIntent("我觉得不一定要人做主语") === "meta",
  "meta 讨论应识别为 meta intent",
);

const fb = formatSentenceCoachFeedback(d1, badSubject);
ok(!/grammar issue|awkward/i.test(fb), "无笼统 grammar 评语");
ok(/Keywords/.test(fb), "含 scaffolding");
ok(/问题位置：/.test(fb), "反馈标注问题位置");

const nounPileSentence =
  "it is argued that accumulate skills work needs and projects even intern experiences, so that can get competitive edge in job market";
const dn = diagnoseSentence(nounPileSentence, "reason");
const anchored = applyStudentAnchoredScaffolding(dn, nounPileSentence);
ok(dn.kind === "missing_subject", "it is argued that ... 先判主语不清");
ok(
  anchored.keywords.some((k) => /students|graduates|young people/i.test(k)),
  "主语问题优先给 actor 选项",
);
ok(
  !anchored.keywords.some((k) => /work needs|job market|competitive edge/i.test(k)),
  "主语轮不引导到内容词堆叠",
);
const fbNoun = formatSentenceCoachFeedback(anchored, nounPileSentence);
ok(/问题位置：/.test(fbNoun), "问题位置锚定原句片段");
ok(/谁/.test(fbNoun), "按优先级给出可执行修复问题");
ok(
  MAIN_ERROR_PRIORITY[0]?.kind === "missing_subject" &&
    MAIN_ERROR_PRIORITY[1]?.kind === "missing_verb",
  "主错误优先级表存在且顺序正确",
);

const notNounPileSentence =
  "therefore, students can grasp useful skills and knowledge needed at workplace through projects and internships, which enable them to get more interviews and adapt to jobs more quickly";
const dNotPile = diagnoseSentence(notNounPileSentence, "impact");
ok(
  dNotPile.kind !== "noun_pile",
  "结构完整句不应被误判为中文式堆叠",
);

// === SentenceTrainingState 决策回归 =======================================
// 1. stabilizable：meaning + 结构 + 可用性都通过
const stableSentence =
  "Universities should prioritize practical skills because this helps graduates adapt to workplace demands.";
ok(
  looksStructurallyWorkable(stableSentence),
  "稳态句应通过结构层（looksStructurallyWorkable）",
);
const stableViab = assessLocalViability(stableSentence);
ok(stableViab.issues.length === 0, "稳态句不应触发 viability issue");
// 本地规则无命中时 confidence=0.72（低于 LLM 升级阈值）→ 生产环境会调用 LLM 确认。
// decideSentenceState 测试使用 LLM 确认后的高 confidence 模拟（{score:0.9, confidence:0.9}）。
ok(
  decideSentenceState({
    meaningAligned: true,
    structuralWorkable: true,
    viability: { score: 0.9, confidence: 0.9, issues: [] },
  }) === "stabilizable",
  "三层全通过 → stabilizable（可 confirm write-in）",
);

// 2. refine_needed：结构成立但可用性扣分
const refineSentence =
  "Students should pursue sustainable studying so that they can adapt to workplace demands.";
ok(
  looksStructurallyWorkable(refineSentence),
  "refine_needed 句结构应成立",
);
const refineViab = assessLocalViability(refineSentence);
ok(
  refineViab.issues.some((i) => /sustainable studying/i.test(i.note)),
  "refine_needed 句应触发 collocation 提示",
);
ok(
  decideSentenceState({
    meaningAligned: true,
    structuralWorkable: true,
    viability: refineViab,
  }) === "refine_needed",
  "结构成立 + 可用性扣分 → refine_needed（不可 confirm）",
);

// 3. workable：结构成立、无可用性问题、但置信不足（LLM 兜底场景）
const workableState = decideSentenceState({
  meaningAligned: true,
  structuralWorkable: true,
  viability: { score: 0.7, confidence: 0.6, issues: [] },
});
ok(
  workableState === "workable",
  "无 issue 但 score/confidence 不足 → workable（继续打磨）",
);

// 4. repair_needed（meaning 未对齐）
const repairMeaning = decideSentenceState({
  meaningAligned: false,
  structuralWorkable: true,
  viability: { score: 1, confidence: 0.9, issues: [] },
});
ok(
  repairMeaning === "repair_needed",
  "meaning 未对齐 → 直接 repair_needed（即便结构/可用性 OK）",
);

// 5. repair_needed（结构不成立）
const repairStructure = decideSentenceState({
  meaningAligned: true,
  structuralWorkable: false,
  viability: { score: 1, confidence: 0.9, issues: [] },
});
ok(
  repairStructure === "repair_needed",
  "结构不成立 → 直接 repair_needed",
);

const brokenStructure = "accumulate skills can improve employability";
ok(
  !looksStructurallyWorkable(brokenStructure),
  "缺主语句不应通过结构层",
);

// === viability 表层瑕疵规则回归 ==========================================
// 1) 缺所有格 's
const apostropheSentence =
  "Universities should be aligned with students plan because they need clarity.";
const apoViab = assessLocalViability(apostropheSentence);
const apoIssue = apoViab.issues.find((i) => /students\s+plan/i.test(i.anchor ?? ""));
ok(!!apoIssue, "复数群体+名词缺所有格应被识别");
ok(
  /students'\s+plan/i.test(apoIssue?.replacement ?? ""),
  "缺所有格 issue 应给出 students' plan 替换建议",
);

// 2) 复合修饰词缺连字符
const hyphenSentence =
  "Universities should offer them more work related skills.";
const hyphenViab = assessLocalViability(hyphenSentence);
const hyphenIssue = hyphenViab.issues.find((i) =>
  /work\s+related\s+skills/i.test(i.anchor ?? ""),
);
ok(!!hyphenIssue, "复合修饰词缺连字符应被识别");
ok(
  /work-related\s+skills/i.test(hyphenIssue?.replacement ?? ""),
  "缺连字符 issue 应给出 work-related skills 替换",
);

// 3) vice versa 单独悬挂
const dangleSentence =
  "If they want to work, university should offer skills, vice versa.";
const dangleViab = assessLocalViability(dangleSentence);
ok(
  dangleViab.issues.some((i) => /vice\s+versa/i.test(i.anchor ?? "")),
  "vice versa 单独悬挂应被识别（anchor 命中）",
);

// 4) 三类合并：原始用户句应直接落到 refine_needed（不再 stabilizable）
const realProblemSentence =
  "In conclusion, curriculum design at universities should be aligned with students plan, vice versa.";
const realViab = assessLocalViability(realProblemSentence);
ok(realViab.issues.length >= 2, "原始问题句应触发多条 viability issue");
ok(
  decideSentenceState({
    meaningAligned: true,
    structuralWorkable: true,
    viability: realViab,
  }) === "refine_needed",
  "原始问题句不能再被判 stabilizable",
);

// === Conclusion 模块 meaning gate 回归 ==================================
const conclusionState = {
  s2: {
    body1Point: "大学应教授实用技能，使毕业生能迅速找到工作",
    body1Angle: "实习帮助适应职场",
    body2Point: "大学应教授学术深度，培养系统知识",
    body2Angle: "长期研究与学术训练",
  },
  s3: {
    currentBody: "conclusion",
    modulePlan: { body1: [], body2: [], conclusion: ["conclusion_summary"] },
    moduleIndex: 0,
  },
};

const summaryDrift = assessMeaningAlignment(
  conclusionState,
  "Universities should keep growing in many directions.",
  "conclusion_summary",
);
ok(
  !summaryDrift.aligned,
  "conclusion_summary 句未连接两段时应被拦截（不再 early-return 通过）",
);

const summaryGood = assessMeaningAlignment(
  conclusionState,
  "Whether universities prioritize practical skills or academic research depends on students' career goals.",
  "conclusion_summary",
);
ok(
  summaryGood.aligned,
  "conclusion_summary 同时点到两段概念 + 含连接词时应通过",
);

const restateDrift = assessMeaningAlignment(
  conclusionState,
  "Universities are doing fine.",
  "conclusion_restate",
);
ok(
  !restateDrift.aligned,
  "conclusion_restate 缺立场动词/方向时应被拦截",
);

// === academic + 动名词 / enter + work 自然度规则 =========================
const academicGerund =
  "Students who pursue further education have to focus on academic studying.";
const acViab = assessLocalViability(academicGerund);
const acIssue = acViab.issues.find((i) =>
  /academic\s+studying/i.test(i.anchor ?? ""),
);
ok(!!acIssue, "`academic + 动名词` anchor 应被命中");
ok(
  /academic\s+studies/i.test(acIssue?.replacement ?? ""),
  "`academic studying` 应给出 academic studies 替换",
);

const enterWork = "Students need to enter work after graduation.";
const ewViab = assessLocalViability(enterWork);
const ewIssue = ewViab.issues.find((i) => /enter\s+work/i.test(i.anchor ?? ""));
ok(!!ewIssue, "`enter + work` anchor 应被命中");
ok(
  /enter\s+the\s+workforce/i.test(ewIssue?.replacement ?? ""),
  "`enter work` 应给出 enter the workforce 替换",
);

const realConclusionSentence =
  "Students who want to enter work after graduation need to learn more work-related skills, while students who want to pursue further education have to focus on academic studying.";
const realCViab = assessLocalViability(realConclusionSentence);
ok(
  realCViab.issues.length >= 2,
  "用户给的 conclusion 句应至少触发 2 条 viability issue",
);
ok(
  decideSentenceState({
    meaningAligned: true,
    structuralWorkable: true,
    viability: realCViab,
  }) === "refine_needed",
  "用户给的 conclusion 句不应被判 stabilizable",
);

// === postProcessStage3Sentence: stabilizable / refine_needed 自动推进 ==
const baseStateForBody1 = {
  stage: 3,
  subStep: "S3_2_MODULE",
  s2: {
    body1Point: "大学应教授实用技能，使毕业生能迅速找到工作",
    body1Angle: "实习帮助适应职场",
    body2Point: "学术深度",
    body2Angle: "长期学习",
  },
  s3: {
    currentBody: "body1",
    modulePlan: { body1: ["claim"], body2: [], conclusion: [] },
    moduleIndex: 0,
    mode: "feedback",
    pendingSentence: undefined,
    confirmedSentences: {},
  },
  coachContext: {},
};

const cleanResult = {
  verdict: "pass",
  advance: false,
  userVisibleText: "",
  moduleComplete: false,
};

// 1) stabilizable：干净句 + LLM 确认后的高 confidence viabilityOverride → stabilizable
const stableProcessed = postProcessStage3Sentence(
  baseStateForBody1,
  { ...cleanResult },
  "Universities should prioritize practical skills because this helps graduates adapt to workplace demands.",
  { score: 0.9, confidence: 0.9, issues: [] }, // 模拟 LLM 确认后结果
);
ok(
  stableProcessed.state.coachContext?.sentenceState === "stabilizable",
  "stabilizable 路径正确标记 sentenceState",
);
ok(
  stableProcessed.state.s3?.mode === "feedback",
  "stabilizable 后 s3.mode 应为 feedback（auto-advance 前置）",
);
ok(
  stableProcessed.result.verdict === "pass",
  "stabilizable 出口 verdict=pass",
);

// 2) refine_needed：含表层瑕疵句 → mode=feedback，verdict=pass，sentenceState=refine_needed
const refineProcessed = postProcessStage3Sentence(
  baseStateForBody1,
  { ...cleanResult },
  "Universities should prioritize work related skills because students plan need clarity.",
);
ok(
  refineProcessed.state.coachContext?.sentenceState === "refine_needed",
  "refine_needed 路径正确标记 sentenceState",
);
ok(
  refineProcessed.state.s3?.mode === "feedback",
  "refine_needed 后 s3.mode 同样为 feedback（accept-with-correction）",
);
ok(
  refineProcessed.result.verdict === "pass",
  "refine_needed 出口 verdict=pass（不再阻塞）",
);
ok(
  refineProcessed.state.coachContext?.openIssue === "accept-with-correction",
  "refine_needed 路径标记 openIssue=accept-with-correction",
);

// 3) repair_needed：缺主语 → mode=coach，verdict=coach，仍然阻塞
const repairProcessed = postProcessStage3Sentence(
  baseStateForBody1,
  { ...cleanResult },
  "accumulate skills can improve employability quickly through internship.",
);
ok(
  repairProcessed.state.coachContext?.sentenceState === "repair_needed",
  "repair_needed 路径正确标记 sentenceState",
);
ok(
  repairProcessed.state.s3?.mode === "coach",
  "repair_needed 路径仍走 coach（阻塞重写）",
);
ok(
  repairProcessed.result.verdict === "coach",
  "repair_needed 出口 verdict=coach（保持阻塞）",
);

// === prose feedback 输出回归 ============================================
const proseAcademic = formatViabilityProse(acIssue);
ok(
  /「academic studying」/.test(proseAcademic) &&
    /「academic studies」/.test(proseAcademic),
  "prose 反馈应同时含原句片段与替换建议",
);
ok(
  !/【|】|主 Pattern|Keywords|修法/.test(proseAcademic),
  "prose 反馈不再含标签字段",
);

const proseDangle = formatViabilityProse(
  dangleViab.issues.find((i) => /vice\s+versa/i.test(i.anchor ?? "")),
);
ok(
  /「.*vice\s+versa.*」/i.test(proseDangle),
  "无替换建议时仍可指出原句片段",
);

// === hasFiniteVerb / looksStructurallyWorkable 回归 ======================
// 含明确主语+动词的句子不应被误判为缺谓语（原 bug：白名单里没有 learn/use）
ok(
  looksStructurallyWorkable(
    "for example, students learn c++ at school while companies rarely use it these days",
  ),
  "含 learn/use 的句子应通过结构层（之前因白名单漏掉这两个动词误判）",
);
ok(
  looksStructurallyWorkable(
    "This is because knowledge in textbooks is academic, which differs from skills required at the workplace",
  ),
  "含 is/differs 的 reason 句应通过结构层",
);
// 纯名词堆叠仍应失败
ok(
  !looksStructurallyWorkable("Students practical skills for workplaces"),
  "无动词的名词堆叠句仍应被结构层拦截",
);

// === competition advantage viability rule ================================
const compViab = assessLocalViability(
  "Students should accumulate work skills in advance, so that they can gain competition advantage",
);
ok(
  compViab.issues.some((i) => /competition advantage/.test(i.anchor ?? "")),
  "`competition advantage` anchor 应被命中",
);
ok(
  compViab.issues.some((i) => i.replacement === "competitive advantage"),
  "`competition advantage` 应给出 `competitive advantage` 替换建议",
);

const compViab2 = assessLocalViability("They can gain compete advantage in job market");
ok(
  compViab2.issues.some((i) => i.replacement === "competitive advantage"),
  "`compete advantage` 应给出 competitive advantage 替换建议",
);

// === P3a：scaffold intent ================================================
ok(
  detectStage3SentenceIntent("给个提示") === "scaffold",
  "「给个提示」应被识别为 scaffold intent",
);
ok(
  detectStage3SentenceIntent("提示") === "scaffold",
  "单独「提示」应被识别为 scaffold",
);
ok(
  detectStage3SentenceIntent("不会写") === "scaffold",
  "「不会写」应被识别为 scaffold",
);
ok(
  detectStage3SentenceIntent("给个句型") === "scaffold",
  "「给个句型」应被识别为 scaffold",
);
ok(
  detectStage3SentenceIntent("Students should adapt to workplace") === "content",
  "内容句不应被误判 scaffold",
);

const scaffoldState = {
  ...baseStateForBody1,
  s3: { ...baseStateForBody1.s3, mode: "assign" },
};
const scaffoldText = buildScaffoldResponse(scaffoldState);
ok(
  /试试这个开头：/.test(scaffoldText),
  "scaffold 响应应含「试试这个开头：」",
);
ok(
  !/【|】|Keywords|Pattern：/.test(scaffoldText),
  "scaffold 响应不带【】标签",
);

// === P3b/c：assign 上下文前缀 ============================================
// 段首且无前序 → 空
const freshAssignState = {
  s2: {
    body1Point: "P1",
    body1Angle: "A1",
    body2Point: "P2",
    body2Angle: "A2",
  },
  s3: {
    currentBody: "body1",
    modulePlan: { body1: ["claim", "reason"], body2: ["claim"], conclusion: ["conclusion_summary"] },
    moduleIndex: 0,
    mode: "assign",
    confirmedSentences: {},
  },
};
ok(
  buildAssignContextPrefix(freshAssignState) === "",
  "首句无前序时不输出上下文前缀",
);

// 同段内非首句 → 「继续这一段...」
const midBodyState = {
  s2: freshAssignState.s2,
  s3: {
    currentBody: "body1",
    modulePlan: { body1: ["claim", "reason", "example"], body2: [], conclusion: [] },
    moduleIndex: 1,
    mode: "assign",
    confirmedSentences: { "body1.claim": ["This is my claim."] },
  },
};
ok(
  /继续这一段/.test(buildAssignContextPrefix(midBodyState)),
  "同段内有前序时输出「继续这一段」前缀",
);

// 跨段进入 body2 → 「现在进入 Body 2（按蓝图：...）」
const enterBody2State = {
  s2: freshAssignState.s2,
  s3: {
    currentBody: "body2",
    modulePlan: { body1: ["claim"], body2: ["claim"], conclusion: [] },
    moduleIndex: 0,
    mode: "assign",
    confirmedSentences: { "body1.claim": ["Sentence in body1"] },
  },
};
const enterBody2Prefix = buildAssignContextPrefix(enterBody2State);
ok(
  /进入 Body 2/.test(enterBody2Prefix) && /P2/.test(enterBody2Prefix),
  "进入 Body 2 时明示并引用 body2Point",
);

// 跨段进入 conclusion
const enterConclusionState = {
  s2: freshAssignState.s2,
  s3: {
    currentBody: "conclusion",
    modulePlan: {
      body1: ["claim"],
      body2: ["claim"],
      conclusion: ["conclusion_summary"],
    },
    moduleIndex: 0,
    mode: "assign",
    confirmedSentences: {
      "body1.claim": ["B1 sentence"],
      "body2.claim": ["B2 sentence"],
    },
  },
};
ok(
  /进入 Conclusion/.test(buildAssignContextPrefix(enterConclusionState)),
  "进入 Conclusion 时给出收束引导",
);

if (fail) process.exit(1);
console.log("\nAll sentence coach checks passed.");
