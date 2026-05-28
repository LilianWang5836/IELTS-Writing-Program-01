#!/usr/bin/env node
/**
 * Golden conversation replay — npm run test:golden-replay
 */
import { replayAllFixtures } from "../src/runtime/replay/replay-runner.ts";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = join(__dirname, "../tests/fixtures/golden-conversations");

let fail = 0;
const diffs = replayAllFixtures(baseDir);

if (diffs.length === 0) {
  console.log("ok: all golden fixtures passed");
} else {
  for (const d of diffs) {
    console.error(
      `FAIL [${d.fixtureId} turn ${d.turnIndex}] ${d.field}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`,
    );
    fail++;
  }
}

process.exit(fail > 0 ? 1 : 0);
