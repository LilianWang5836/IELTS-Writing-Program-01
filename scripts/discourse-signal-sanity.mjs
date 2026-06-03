/**
 * Layer 1 — Signal sanity check (RFC-2 multi-signal scoring)
 * Run: npx tsx scripts/discourse-signal-sanity.mjs
 */
import { detectFunctionsFromSentence } from "../src/lib/domain/chain-discourse.ts";

const CLAIM =
  "国际旅游能促进当地经济发展，增加居民的实际收入。";

/** 5 类代表句 */
const CASES = [
  {
    id: 1,
    label: "纯因果 / causal-only",
    text: "Because tourism increases, local economy improves.",
    expect: {
      causalMin: 0.8,
      closureMax: 0.2,
      multiLabel: false,
      noCausalZero: true,
    },
  },
  {
    id: 2,
    label: "纯收束 / closure-only",
    text: "In conclusion, tourism benefits society.",
    expect: {
      closureMin: 0.8,
      causalMax: 0.6,
      multiLabel: false,
      noCausalZero: true, // closure-only may still have incidental causal from 'benefit'
    },
  },
  {
    id: 3,
    label: "纯支撑 / grounding-only",
    text: "For example, in Bali, tourist numbers doubled and local restaurants hired more staff.",
    expect: {
      groundingMin: 0.55,
      causalMax: 0.5,
      closureMax: 0.2,
      multiLabel: false,
      noCausalZero: true,
    },
  },
  {
    id: 4,
    label: "复合因果+收束 / compound causal+closure (原 bug EN)",
    text: "Because tourists increase, restaurants grow, therefore economy improves.",
    expect: {
      causalMin: 0.7,
      closureMin: 0.45,
      closureMax: 0.75,
      multiLabel: true,
      noCausalZero: true,
      closureDoesNotSwallowCausal: true,
    },
  },
  {
    id: 5,
    label: "复合机制+收束 / compound causal+closure (原 bug ZH)",
    text:
      "原因：游客变多之后，餐饮住宿购物的需求也变大。因此，餐厅酒店等能赚更多钱，另外一方面，他们会雇佣更多的人手。因此，旅游业发展能促进当地经济发展，同时提高居民的收入",
    expect: {
      causalMin: 0.7,
      closureMin: 0.45,
      groundingMin: 0.35,
      multiLabel: true,
      noCausalZero: true,
      closureDoesNotSwallowCausal: true,
    },
  },
];

function countActive(s) {
  let n = 0;
  if (s.causal >= 0.35) n++;
  if (s.closure >= 0.45) n++;
  if (s.grounding >= 0.35) n++;
  return n;
}

function fmt(s) {
  return {
    causal: Number(s.causal.toFixed(2)),
    closure: Number(s.closure.toFixed(2)),
    grounding: Number(s.grounding.toFixed(2)),
    active: countActive(s),
  };
}

let fail = 0;
const checks = [];

console.log("=== Layer 1: Signal Sanity Check ===\n");
console.log(`claim anchor: ${CLAIM}\n`);

for (const c of CASES) {
  const sig = detectFunctionsFromSentence(c.text, "body1", CLAIM);
  const out = fmt(sig);
  const row = { id: c.id, label: c.label, ...out, text: c.text.slice(0, 72) };

  console.log(`--- [${c.id}] ${c.label} ---`);
  console.log(`text: ${c.text.slice(0, 100)}${c.text.length > 100 ? "…" : ""}`);
  console.log(
    `signals: causal=${out.causal}  closure=${out.closure}  grounding=${out.grounding}  (active=${out.active})`,
  );

  const e = c.expect;
  const caseChecks = [];

  if (e.noCausalZero) {
    const ok = !(e.multiLabel && sig.causal === 0);
    caseChecks.push(["causal not suppressed to 0 (when compound)", ok]);
  }
  if (e.closureDoesNotSwallowCausal) {
    const ok = sig.causal > 0 && sig.closure > 0 && sig.causal >= 0.7;
    caseChecks.push(["closure does not swallow causal", ok]);
  }
  if (e.multiLabel === true) {
    const ok = countActive(sig) >= 2;
    caseChecks.push(["multi-label coexistence (≥2 active)", ok]);
  }
  if (e.multiLabel === false) {
    const ok = countActive(sig) <= 2;
    caseChecks.push(["signals stable (not over-tagged)", ok]);
  }
  if (e.causalMin != null) {
    caseChecks.push([`causal ≥ ${e.causalMin}`, sig.causal >= e.causalMin]);
  }
  if (e.causalMax != null) {
    caseChecks.push([`causal ≤ ${e.causalMax}`, sig.causal <= e.causalMax]);
  }
  if (e.closureMin != null) {
    caseChecks.push([`closure ≥ ${e.closureMin}`, sig.closure >= e.closureMin]);
  }
  if (e.closureMax != null) {
    caseChecks.push([`closure ≤ ${e.closureMax}`, sig.closure <= e.closureMax]);
  }
  if (e.groundingMin != null) {
    caseChecks.push([
      `grounding ≥ ${e.groundingMin}`,
      sig.grounding >= e.groundingMin,
    ]);
  }
  if (e.groundingMax != null) {
    caseChecks.push([
      `grounding ≤ ${e.groundingMax}`,
      sig.grounding <= e.groundingMax,
    ]);
  }

  // global: no pathological all-zero on non-trivial input
  caseChecks.push([
    "no extreme all-zero",
    sig.causal + sig.closure + sig.grounding > 0,
  ]);

  for (const [msg, ok] of caseChecks) {
    const mark = ok ? "✔" : "✘";
    console.log(`  ${mark} ${msg}`);
    if (!ok) fail++;
    checks.push({ case: c.id, msg, ok });
  }
  console.log();
}

console.log("=== Summary ===");
const passed = checks.filter((c) => c.ok).length;
console.log(`checks: ${passed}/${checks.length} passed`);

const globalOk =
  checks.some((c) => c.msg.includes("multi-label") && c.ok) &&
  checks.filter((c) => c.msg.includes("swallow") && c.ok).length >= 2 &&
  checks.filter((c) => c.msg.includes("suppressed") && c.ok).length >= 2;

console.log("\n判定标准:");
console.log(`  ✔ signals stable        → ${fail === 0 ? "PASS" : "PARTIAL"}`);
console.log(
  `  ✔ no extreme zeros      → ${checks.filter((c) => c.msg.includes("all-zero") && c.ok).length}/${CASES.length} cases`,
);
console.log(`  ✔ multi-label coexist → ${globalOk ? "PASS" : "FAIL"}`);

if (fail > 0) {
  console.error(`\n${fail} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll Layer 1 signal sanity checks passed.");
