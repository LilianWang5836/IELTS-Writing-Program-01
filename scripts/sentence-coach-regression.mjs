/**
 * 句子教练回归
 * npm run test:sentence
 */
import {
  MAIN_ERROR_PRIORITY,
  applyStudentAnchoredScaffolding,
  assessLocalViability,
  assessMeaningAlignment,
  decideSentenceState,
  detectStage3SentenceIntent,
  diagnoseSentence,
  formatSentenceCoachFeedback,
  looksStructurallyWorkable,
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
ok(
  decideSentenceState({
    meaningAligned: true,
    structuralWorkable: true,
    viability: stableViab,
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

if (fail) process.exit(1);
console.log("\nAll sentence coach checks passed.");
