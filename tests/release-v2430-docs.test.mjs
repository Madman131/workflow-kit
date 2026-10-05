// v2.43.0: the repair-round controller is OPT-IN (`repairController` in .claude/kit.config.json). The guard branch is
// pinned in tests/brief-rung.test.mjs; this file pins the
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

test("init is untouched: bin/init.mjs keeps its v2.42.0 blob", () => {
  assert.equal(blob("bin/init.mjs"), "38d4af1c61077eaff24d4daeb72cd3215e5f97ce");
});

test("the controller code is untouched: the three files keep their v2.42.0 blobs", () => {
  assert.equal(blob("hooks/repair-dispatch-state.mjs"), "2d16801483a2bf4b2a7cc4713d905dae89617c83");
  assert.equal(blob("scripts/record-repair-event.mjs"), "843086041d0a9e917413e32521545b3c337c8c2e");
  assert.equal(blob("scripts/confirm-repair-brief.mjs"), "279dd2d2fe969131fd9c9f0dbe110c98442f556f");
});

test("every doc that describes the controller says it is opt-in where it would otherwise be false", () => {
  assert.match(flat("core/WORKFLOW.md"), /Round\/root-cause controller — finite aggregate cadence\.\*\* On if `repairController` is true in kit\.config, or unset beside a ledger\./);
  assert.match(flat("skills/orchestrate/CHIP_BRIEF.md"), /Repair-controller text below applies only where the controller is on \(`repairController`\)\. Aggregate repair briefs declare/);
  assert.match(flat("skills/orchestrate/SKILL.md"), /Round events \(opt-in `repairController`\): `scripts\/record-repair-event\.mjs`/);
  assert.match(flat("PORTABILITY.md"), /since v2\.43\.0 they are on automatically where a repair ledger exists; off otherwise; an explicit `repairController` in `\.claude\/kit\.config\.json` wins/);
  assert.match(flat("templates/BINDINGS.md.tmpl"), /or the key absent beside a repair ledger \(otherwise off/);
  assert.match(flat("README.md"), /where the controller is on \(`repairController: true`, or the key absent beside a repair ledger\)/);
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

test("the README note states the switch, the absent-key ledger rule, the off and on behaviour, and the upgrade path", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.43.0"), r.indexOf("## What's new in v2.42.0"));
  assert.ok(n.length > 500, "the v2.43.0 note sits above v2.42.0's");
  assert.match(n, /set `"repairController"` in/);
  assert.match(n, /on automatically where a repair ledger exists, off otherwise, and an explicit `repairController` in `\.claude\/kit\.config\.json` wins/);
  assert.match(n, /with `lstat` only, never reading or creating it/);
  assert.match(n, /a symlink, a non-regular file, any other `lstat` error or an unresolvable Git common dir keeps the controller ON/);
  assert.match(n, /`false` is OFF even beside a ledger/);
  assert.doesNotMatch(n, /`init` (?:keeps|writes the key)/, "init writes no key");
  assert.match(n, /MALFORMED and fails closed exactly like a bad `briefPathDirs`/);
  assert.match(n, /reads no repair ledger, admission-checks no source write/);
  assert.match(n, /`dispatch_kind: "repair"` is still refused/);
  assert.match(n, /byte-for-byte as in v2\.42\.0/);
  assert.match(n, /tests\/release-v2430-docs\.test\.mjs/);
  assert.match(n, /- \*\*Upgrading\.\*\* Re-run `init --force`\./);
  assert.match(n, /No `\.codex\/hooks\.json` entry changes\./);
});

test("the v2.43.0 release note is still in the README (the version stamp itself moves with each release; v2.44.0 pins the current one)", () => {
  assert.match(read("README.md"), /^## What's new in v2\.43\.0 — the repair-round controller is opt-in/m);
});

test("no codex hook registration changed: the shipped Codex registration template is byte-identical to the base", () => {
  let diff = "";
  try { diff = execFileSync("git", ["-C", KIT, "diff", "--name-only", "f1c921dabb8f91a0a75f241ff20c10241f0fbadb", "--", "templates/codex-hooks.json", "codex", "hooks/sensor-stop-notice.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return; }   // no base object here (a tarball or shallow clone): nothing to compare
  assert.equal(diff.trim(), "", "codex registration and the sensors are unchanged, so no Owner re-trust is owed");
});
