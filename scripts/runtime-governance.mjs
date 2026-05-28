#!/usr/bin/env node
/**
 * Layer C drift protection — npm run test:runtime-governance
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, "../src/runtime/world/layer-c-manifest.json");
const coachingPath = join(__dirname, "../src/runtime/types.ts");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const source = readFileSync(coachingPath, "utf8");

const interfaceMatch = source.match(/export interface CoachingSignals \{([\s\S]*?)\n\}/);
if (!interfaceMatch) {
  console.error("FAIL: CoachingSignals interface not found");
  process.exit(1);
}

const body = interfaceMatch[1];
const fields = [...body.matchAll(/^\s+(\w+)[?:]/gm)].map((m) => m[1]);

const manifestSet = new Set(manifest);
const fieldSet = new Set(fields);

let fail = 0;
for (const f of manifestSet) {
  if (!fieldSet.has(f)) {
    console.error(`FAIL: manifest field missing from CoachingSignals: ${f}`);
    fail++;
  }
}
for (const f of fieldSet) {
  if (!manifestSet.has(f)) {
    console.error(
      `FAIL: CoachingSignals field "${f}" not in layer-c-manifest.json — governance RFC required`,
    );
    fail++;
  }
}

if (fail === 0) {
  console.log(`ok: Layer C manifest matches (${manifest.length} fields)`);
}
process.exit(fail > 0 ? 1 : 0);
