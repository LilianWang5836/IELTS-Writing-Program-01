/**
 * 句子教练回归
 * npm run test:sentence
 */
import {
  MAIN_ERROR_PRIORITY,
  applyStudentAnchoredScaffolding,
  diagnoseSentence,
  formatSentenceCoachFeedback,
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

const badGap = "students join internships, competitive advantage";
const d3 = diagnoseSentence(badGap, "example");
ok(d3.kind === "cause_effect_gap", "因果断裂");

const good =
  "Universities should prioritize practical skills because this helps graduates adapt to workplace demands.";
const d4 = diagnoseSentence(good, "claim");
ok(d4.pass, "完整句 pass");

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

if (fail) process.exit(1);
console.log("\nAll sentence coach checks passed.");
