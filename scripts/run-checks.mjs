#!/usr/bin/env node
// scripts/run-checks.mjs — the kit's `npm test`: the budget gate AND the control suite, in that
// order, with a COMBINED exit code.
//
// WHY NOT `a && b`. The budget gate is a word-count check; the control suite is what observes every
// fail-closed control both blocking and permitting (plus the acceptance harness and the FM1 guard).
// Chained with `&&`, one word over budget in one skill would stop the enforcement suite from
// running AT ALL — a notice about prose length preempting the proof that the controls work, which
// is exactly backwards. Both rungs always run; `npm test` is red if EITHER is.
//
// Order still matters and is deliberate: the deterministic, seconds-long budget rung runs FIRST so
// its output is at the top of the log where an author reads it, rather than buried under the suite.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Enumerated from disk, not shell-globbed: this runner spawns node directly (no shell), so a
// literal "tests/*.test.mjs" would reach node unexpanded. Discovering from disk also means a new
// test file is picked up with no edit here — the same discovery-from-disk property the skills and
// agents installs rely on.
const testFiles = readdirSync(path.join(KIT, "tests"))
  .filter((f) => f.endsWith(".test.mjs")).sort().map((f) => path.join("tests", f));
if (testFiles.length === 0) {
  console.error("run-checks: FAIL — no tests/*.test.mjs found. A suite governing nothing is never a pass.");
  process.exit(1);
}

const RUNGS = [
  { name: "check-skill-budgets", argv: ["scripts/check-skill-budgets.mjs"] },
  { name: "kit control suite", argv: ["--test", ...testFiles] },
];
// User-install parity is environment-owned, so clean CI hosts stay hermetic. On a developer host
// where /orchestrate is installed, however, leaving this optional recreated the exact split this
// check exists to detect: the source suite was green while the command agents actually loaded was
// stale. Presence makes parity a required local rung.
const userOrchestrate = path.join(os.homedir(), ".agents", "skills", "orchestrate");
const syncScript = path.join(KIT, "scripts", "sync-user-orchestrate-skill.mjs");
if (existsSync(userOrchestrate) && existsSync(syncScript)) {
  RUNGS.push({ name: "orchestrate user-install parity", argv: ["scripts/sync-user-orchestrate-skill.mjs", "--check"] });
}

const failed = [];
for (const rung of RUNGS) {
  console.log(`\n──── ${rung.name} ────`);
  const r = spawnSync(process.execPath, rung.argv, { cwd: KIT, stdio: "inherit" });
  // A rung killed by a signal reports status null — that is a failure, not a pass. Treating only
  // `status !== 0` as failure would let a segfaulted or timed-out rung read as green.
  if (r.status !== 0) failed.push(`${rung.name} (${r.status === null ? `signal ${r.signal}` : `exit ${r.status}`})`);
}

if (failed.length) {
  console.error(`\nnpm test FAILED: ${failed.join(" · ")}`);
  process.exit(1);
}
console.log(`\nnpm test: all ${RUNGS.length} rungs green.`);
