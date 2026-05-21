/**
 * 句子教练回归
 * npm run test:sentence
 */
import {
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

const badGap = "students join internships, competitive advantage";
const d3 = diagnoseSentence(badGap, "example");
ok(d3.kind === "cause_effect_gap", "因果断裂");

const good =
  "Universities should prioritize practical skills because this helps graduates adapt to workplace demands.";
const d4 = diagnoseSentence(good, "claim");
ok(d4.pass, "完整句 pass");

const fb = formatSentenceCoachFeedback(d1);
ok(!/grammar issue|awkward/i.test(fb), "无笼统 grammar 评语");
ok(/Keywords/.test(fb), "含 scaffolding");

if (fail) process.exit(1);
console.log("\nAll sentence coach checks passed.");
