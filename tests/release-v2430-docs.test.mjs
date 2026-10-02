// v2.43.0: the repair-round controller is OPT-IN (`repairController` in .claude/kit.config.json). The guard branch and
// init behaviour are pinned in tests/brief-rung.test.mjs and tests/init-repair-controller.test.mjs; this file pins the
// release's prose, budgets, version, and that the controller code itself did not change.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");
const words = (rel) => read(rel).split(/\s+/).filter(Boolean).length;
const blob = (rel) => { const b = readFileSync(path.join(KIT, rel)); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };

test("the controller code is untouched: the three files keep their v2.42.0 blobs", () => {
  assert.equal(blob("hooks/repair-dispatch-state.mjs"), "2d16801483a2bf4b2a7cc4713d905dae89617c83");
  assert.equal(blob("scripts/record-repair-event.mjs"), "843086041d0a9e917413e32521545b3c337c8c2e");
  assert.equal(blob("scripts/confirm-repair-brief.mjs"), "279dd2d2fe969131fd9c9f0dbe110c98442f556f");
});

test("every doc that describes the controller says it is opt-in where it would otherwise be false", () => {
  assert.match(flat("core/WORKFLOW.md"), /Round\/root-cause controller — finite aggregate cadence\.\*\* Opt-in: runs only if `\.claude\/kit\.config\.json` has `repairController: true`\./);
  assert.match(flat("skills/orchestrate/CHIP_BRIEF.md"), /Repair-controller text below applies only if `repairController` is true\. Aggregate repair briefs declare/);
  assert.match(flat("skills/orchestrate/SKILL.md"), /Round events \(opt-in `repairController`\): `scripts\/record-repair-event\.mjs`/);
  assert.match(flat("PORTABILITY.md"), /since v2\.43\.0 they run only in a repo whose `\.claude\/kit\.config\.json` sets `repairController: true`; the default is off, and `init` keeps it on where a repair ledger already exists/);
  assert.match(flat("templates/BINDINGS.md.tmpl"), /only where `\.claude\/kit\.config\.json` sets `repairController: true` \(default off/);
  assert.match(flat("README.md"), /once a repair program is live, in a repo that opted in with `repairController: true`/);
});

test("budgets were trimmed to fit, never raised", () => {
  assert.match(read("skills/orchestrate/SKILL.md"), /Word budget: 1400/);
  assert.ok(words("skills/orchestrate/SKILL.md") <= 1400, `SKILL is ${words("skills/orchestrate/SKILL.md")} words`);
  assert.match(read("skills/orchestrate/CHIP_BRIEF.md"), /Word budget: 1000 /);
  assert.ok(words("skills/orchestrate/CHIP_BRIEF.md") <= 1000, `CHIP_BRIEF is ${words("skills/orchestrate/CHIP_BRIEF.md")} words`);
  assert.ok(Buffer.byteLength(read("core/WORKFLOW.md")) <= 25600, "core/WORKFLOW.md stays within the 25600 B method cap");
  assert.doesNotMatch(read("scripts/check-doc-size.mjs"), /2560[1-9]|256[1-9]\d\d|25[7-9]\d\d\d/, "the doc-size caps were not raised");
  for (const rel of ["templates/AGENTS.md.tmpl", "templates/CLAUDE.md.tmpl"]) {
    assert.ok(Buffer.byteLength(read(rel)) <= 8192, `${rel} stays under the entry cap`);
  }
});

test("the README note states the switch, the off and on behaviour, init's step, and the upgrade path", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.43.0"), r.indexOf("## What's new in v2.42.0"));
  assert.ok(n.length > 500, "the v2.43.0 note sits above v2.42.0's");
  assert.match(n, /"repairController": true/);
  assert.match(n, /absent means `false`/);
  assert.match(n, /MALFORMED and fails closed exactly like a bad `briefPathDirs`/);
  assert.match(n, /reads no repair ledger, admission-checks no source write/);
  assert.match(n, /`dispatch_kind: "repair"` is still refused/);
  assert.match(n, /byte-for-byte as in v2\.42\.0/);
  assert.match(n, /exists and is non-empty and `repairController` is absent/);
  assert.match(n, /never flipped/);
  assert.match(n, /tests\/release-v2430-docs\.test\.mjs/);
  assert.match(n, /- \*\*Upgrading\.\*\* Re-run `init --force`\./);
  assert.match(n, /No `\.codex\/hooks\.json` entry changes\./);
});

test("version is 2.43.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.43.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.43.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.43\.0$/m);
});

test("no codex hook registration changed: the shipped Codex registration template is byte-identical to the base", () => {
  let diff = "";
  try { diff = execFileSync("git", ["-C", KIT, "diff", "--name-only", "f1c921dabb8f91a0a75f241ff20c10241f0fbadb", "--", "templates/codex-hooks.json", "codex", "hooks/sensor-stop-notice.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return; }   // no base object here (a tarball or shallow clone): nothing to compare
  assert.equal(diff.trim(), "", "codex registration and the sensors are unchanged, so no Owner re-trust is owed");
});
