/**
 * Layer 2 — Policy behavior trace (RFC-3 getNextNeed)
 * Run: npm run test:discourse-policy
 */
import {
  aggregateCoverage,
  buildDiscourseMemory,
  computeSignalGaps,
  getNextNeed,
} from "../src/lib/domain/chain-discourse.ts";

const SESSIONS = [
  {
    id: "A",
    name: "课本 Body1 渐进（reason → example → link）",
    claim: "大学应教授实用技能，使毕业生能迅速找到工作并贡献社会",
    body: "body1",
    turns: [
      "课本的知识偏向于学术，和职场所需要的知识技能不完全匹配，因此需要在实践项目中来补充",
      "比如课本里还在学c++, 但是实际公司里已经很少用了，会使用更适合自己业务模式的语言",
      "因此，通过实际的实践或者实习，可以学习到实际公司里面需要的技术，这个能有助于你拿到很多的面试机会，找到工作后也能更快地适应",
    ],
    expect: {
      minTurnsBeforeReady: 3,
      allowReadyOnLast: true,
      shouldVaryNeed: true,
    },
  },
  {
    id: "B",
    name: "旅游 Body1 一句复合（原 bug ZH）",
    claim: "国际旅游能促进当地经济发展，增加居民的实际收入。",
    body: "body1",
    turns: [
      "原因：游客变多之后，餐饮住宿购物的需求也变大。因此，餐厅酒店等能赚更多钱，另外一方面，他们会雇佣更多的人手。因此，旅游业发展能促进当地经济发展，同时提高居民的收入",
    ],
    expect: {
      minTurnsBeforeReady: 1,
      allowReadyOnLast: true,
      shouldNotLockOn: "causal",
    },
  },
  {
    id: "C",
    name: "旅游 Body1 分步（机制 → 举例 → 收束）",
    claim: "国际旅游能促进当地经济发展，增加居民的实际收入。",
    body: "body1",
    turns: [
      "因为游客增多，餐饮和住宿需求增加，餐厅酒店收入上升并雇佣更多人",
      "例如，巴厘岛旺季时餐馆需要额外招服务员，酒店也会扩编",
      "因此，这会带动本地经济并提高居民收入",
    ],
    expect: {
      minTurnsBeforeReady: 2,
      allowReadyOnLast: true,
      shouldVaryNeed: true,
    },
  },
  {
    id: "D",
    name: "EN 分步（because → for example → in conclusion）",
    claim: "International tourism improves local economy.",
    body: "body1",
    turns: [
      "Because tourism increases, local restaurants earn more and hire additional staff.",
      "For example, in Bali, tourist numbers doubled and local restaurants hired more staff.",
      "In conclusion, tourism benefits local economy and residents.",
    ],
    expect: {
      minTurnsBeforeReady: 2,
      allowReadyOnLast: true,
      shouldVaryNeed: true,
    },
  },
  {
    id: "E",
    name: "Body2 渐进（reason → example → 收束）",
    claim: "走学术道路者应持续学习感兴趣领域并积累系统知识",
    body: "body2",
    turns: [
      "很多专业知识是系统性的，需要花很多时间从简单到难的学习",
      "比如说医学生，本身的课业量是很大的，需要花很多时间学习，基础没有打扎实的话，后面学下去会很困难",
      "因此，如果是这些特别需要长期学习的领域，并且已经确定了走学术发展的路线，聚焦于知识本身是非常有必要的",
    ],
    expect: {
      minTurnsBeforeReady: 3,
      allowReadyOnLast: true,
      shouldVaryNeed: true,
    },
  },
];

function coverageForTurn(msgs, body, claim) {
  const memory = buildDiscourseMemory(msgs, body, claim);
  return aggregateCoverage(memory, body);
}

function traceSession(session) {
  const trace = [];
  const msgs = [];
  for (let i = 0; i < session.turns.length; i++) {
    msgs.push(session.turns[i]);
    const cov = coverageForTurn(msgs, session.body, session.claim);
    const gaps = computeSignalGaps(cov);
    const need = getNextNeed(cov);
    trace.push({
      turn: i + 1,
      userPreview: session.turns[i].slice(0, 56) + (session.turns[i].length > 56 ? "…" : ""),
      signals: {
        causal: round(cov.causal),
        closure: round(cov.closure),
        grounding: round(cov.grounding),
      },
      gaps: {
        causal: round(gaps.causal),
        closure: round(gaps.closure),
        grounding: round(gaps.grounding),
      },
      nextNeed: need,
    });
  }
  return trace;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/** 同一 need 连续 ≥3 次且非 ready → 锁死 */
function detectLockIn(needs) {
  if (needs.length < 3) return null;
  let run = 1;
  for (let i = 1; i < needs.length; i++) {
    if (needs[i] === needs[i - 1] && needs[i] !== "ready") {
      run++;
      if (run >= 3) return needs[i];
    } else {
      run = 1;
    }
  }
  return null;
}

/** A-B-A-B 交替（长度≥4）→ 抖动 */
function detectOscillation(needs) {
  const core = needs.filter((n) => n !== "ready");
  if (core.length < 4) return false;
  let alt = true;
  for (let i = 1; i < core.length; i++) {
    if (core[i] === core[i - 1]) alt = false;
  }
  if (!alt) return false;
  const uniq = new Set(core);
  return uniq.size === 2;
}

function analyzeSession(session, trace) {
  const needs = trace.map((t) => t.nextNeed);
  const issues = [];
  const notes = [];

  const lock = detectLockIn(needs);
  if (lock) {
    issues.push(`单一需求锁死: "${lock}" 连续 ≥3 轮`);
  } else if (session.expect.shouldNotLockOn) {
    const stuck = needs.filter((n) => n === session.expect.shouldNotLockOn).length;
    if (stuck === needs.length && needs[0] !== "ready") {
      issues.push(`全程卡在 ${session.expect.shouldNotLockOn}`);
    } else {
      notes.push(`✔ 未锁死在 ${session.expect.shouldNotLockOn}`);
    }
  } else if (session.expect.shouldVaryNeed) {
    const uniq = new Set(needs.filter((n) => n !== "ready"));
    if (uniq.size >= 2) {
      notes.push(`✔ need 有变化: ${[...uniq].join(" → ")}`);
    } else if (needs.every((n) => n === "ready")) {
      notes.push("✔ 首轮即 ready（复合句预期）");
    } else {
      notes.push(`△ need 序列: ${needs.join(" → ")}`);
    }
  }

  if (detectOscillation(needs)) {
    issues.push(`无意义抖动: ${needs.join(" → ")}`);
  } else {
    notes.push("✔ 无 A-B-A-B 抖动");
  }

  const readyIdx = needs.indexOf("ready");
  if (readyIdx >= 0 && readyIdx + 1 < session.expect.minTurnsBeforeReady) {
    issues.push(
      `提前 completion: Turn ${readyIdx + 1} 即 ready（期望 ≥ Turn ${session.expect.minTurnsBeforeReady}）`,
    );
  } else if (readyIdx === 0 && session.turns.length > 1) {
    notes.push("△ Turn1 即 ready — 检查是否 closure/causal 权重过强");
  } else if (readyIdx >= 0) {
    notes.push(`✔ ready 出现在 Turn ${readyIdx + 1}`);
  }

  return { needs, issues, notes };
}

let fail = 0;

console.log("=== Layer 2: Policy Behavior Trace (getNextNeed) ===\n");

for (const session of SESSIONS) {
  console.log(`########## Session ${session.id}: ${session.name} ##########`);
  console.log(`claim: ${session.claim.slice(0, 60)}${session.claim.length > 60 ? "…" : ""}\n`);

  const trace = traceSession(session);
  for (const row of trace) {
    console.log(`Turn ${row.turn}:`);
    console.log(`  user: ${row.userPreview}`);
    console.log(
      `  signals: { causal: ${row.signals.causal}, closure: ${row.signals.closure}, grounding: ${row.signals.grounding} }`,
    );
    console.log(
      `  gaps:    { causal: ${row.gaps.causal}, closure: ${row.gaps.closure}, grounding: ${row.gaps.grounding} }`,
    );
    console.log(`  nextNeed: ${row.nextNeed}`);
    console.log();
  }

  const { needs, issues, notes } = analyzeSession(session, trace);
  console.log(`need 序列: ${needs.join(" → ")}`);
  for (const n of notes) console.log(`  ${n}`);
  for (const iss of issues) {
    console.log(`  ✘ ${iss}`);
    fail++;
  }
  if (issues.length === 0) console.log("  ✔ Session policy behavior OK");
  console.log();
}

console.log("=== Layer 2 观察清单 ===");
console.log("  1. 单一需求锁死 (causal→causal→causal) — 见各 session issues");
console.log("  2. 无意义抖动 (causal↔closure) — 见各 session notes/issues");
console.log("  3. 提前 completion — 见各 session notes/issues");
console.log();

if (fail > 0) {
  console.error(`${fail} policy issue(s) detected.`);
  process.exit(1);
}
console.log("All Layer 2 policy behavior checks passed.");
