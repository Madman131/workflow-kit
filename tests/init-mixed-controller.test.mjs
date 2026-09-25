// tests/init-mixed-controller.test.mjs — v2.33.1 B1: init refuses to create a mixed-version repair
// controller across the worktrees of one repository.
//
// Every worktree shares ONE repair ledger (Git common dir). An older controller rejects the whole
// ledger once a newer one appends a row it does not know, which denies every tool-bound source write
// in the older worktree for good (no ledger row may be rewritten). init is where an operator chooses
// to create that mix, so init compares the controller it would install with every other worktree's.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INIT = path.join(KIT, "bin", "init.mjs");
const FLAG = "--allow-mixed-repair-controllers";
const KIT_CONTROLLER = readFileSync(path.join(KIT, "hooks", "repair-dispatch-state.mjs"));
const OLD_CONTROLLER = "// an older repair controller\nexport const AGGREGATE_POLICY_VERSION = 2;\n";

function repoWithTwoWorktrees() {
  const root = mkdtempSync(path.join(os.tmpdir(), "kit-mixed-"));
  const wt1 = path.join(root, "main");
  const wt2 = path.join(root, "wt2");
  const prompts = path.join(root, "prompts");
  execFileSync("git", ["init", "-q", "-b", "main", wt1]);
  execFileSync("git", ["-C", wt1, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", wt1, "config", "user.name", "t"]);
  writeFileSync(path.join(wt1, "README"), "x\n");
  execFileSync("git", ["-C", wt1, "add", "README"]);
  execFileSync("git", ["-C", wt1, "commit", "-q", "-m", "init"]);
  execFileSync("git", ["-C", wt1, "worktree", "add", "-q", "-b", "side", wt2]);
  return { root, wt1, wt2, prompts, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const plant = (wt, lane, bytes) => {
  mkdirSync(path.join(wt, lane, "hooks"), { recursive: true });
  writeFileSync(path.join(wt, lane, "hooks", "repair-dispatch-state.mjs"), bytes);
};
const init = (target, prompts, extra = []) => spawnSync(process.execPath, [INIT, "--target", target,
  "--repo-name", "adopter", "--codex-prompts-dir", prompts, "--skip-codex-lane", ...extra], { encoding: "utf8" });
const listing = (dir) => readdirSync(dir).sort();

test("a sibling worktree with a DIFFERENT .claude controller refuses the run, names it and the flag, and writes NOTHING", () => {
  const { wt1, wt2, prompts, cleanup } = repoWithTwoWorktrees();
  try {
    plant(wt2, ".claude", OLD_CONTROLLER);
    const before = listing(wt1);
    const r = init(wt1, prompts);
    assert.notEqual(r.status, 0, "refused");
    assert.match(r.stderr, /REFUSED/);
    assert.ok(r.stderr.includes(wt2) || r.stderr.includes(path.basename(wt2)), "names the worktree");
    assert.match(r.stderr, /\[side\] \.claude\/hooks\/repair-dispatch-state\.mjs/, "names its branch and which copy");
    assert.ok(r.stderr.includes(FLAG), "the refusal names the acknowledgement flag verbatim");
    assert.match(r.stderr, /every run except the last/, "…and the order that upgrades them all one run at a time");
    assert.match(r.stderr, /Never edit the ledger/);
    assert.deepEqual(listing(wt1), before, "nothing written in the target");
  } finally { cleanup(); }
});

test("a differing per-checkout .codex controller alone is also a finding", () => {
  const { wt1, wt2, prompts, cleanup } = repoWithTwoWorktrees();
  try {
    plant(wt2, ".codex", OLD_CONTROLLER);
    const r = init(wt1, prompts);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\.codex\/hooks\/repair-dispatch-state\.mjs/);
  } finally { cleanup(); }
});

test("an identical controller, or none at all, in the sibling proceeds", () => {
  const { wt1, wt2, prompts, cleanup } = repoWithTwoWorktrees();
  try {
    const r0 = init(wt1, prompts);
    assert.equal(r0.status, 0, `no controller in the sibling: ${r0.stderr}`);
    rmSync(path.join(wt1, ".claude"), { recursive: true, force: true });
    plant(wt2, ".claude", KIT_CONTROLLER);
    const r1 = init(wt1, prompts, ["--force"]);
    assert.equal(r1.status, 0, `identical bytes: ${r1.stderr}`);
    assert.doesNotMatch(`${r1.stdout}${r1.stderr}`, /REFUSED —|mismatched repair controller/);
  } finally { cleanup(); }
});

test("the flag proceeds and still prints the list; a sequential upgrade of two old worktrees completes", () => {
  const { wt1, wt2, prompts, cleanup } = repoWithTwoWorktrees();
  try {
    plant(wt1, ".claude", OLD_CONTROLLER);
    plant(wt2, ".claude", OLD_CONTROLLER);
    const refused = init(wt1, prompts, ["--force"]);
    assert.notEqual(refused.status, 0, "without the flag, the first upgrade refuses");
    assert.ok(refused.stderr.includes(FLAG));
    const first = init(wt1, prompts, ["--force", FLAG]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /proceeding with 1 mismatched repair controller/, "the acknowledgement is visible");
    assert.deepEqual(readFileSync(path.join(wt1, ".claude", "hooks", "repair-dispatch-state.mjs")), KIT_CONTROLLER);
    const last = init(wt2, prompts, ["--force"]);
    assert.equal(last.status, 0, `the last worktree needs no flag: ${last.stderr}`);
    assert.deepEqual(readFileSync(path.join(wt2, ".claude", "hooks", "repair-dispatch-state.mjs")), KIT_CONTROLLER);
  } finally { cleanup(); }
});

test("a missing (prunable) sibling is skipped with a note; a symlinked controller is unreadable, hence a finding", () => {
  const { root, wt1, wt2, prompts, cleanup } = repoWithTwoWorktrees();
  try {
    rmSync(wt2, { recursive: true, force: true });
    const r = init(wt1, prompts);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skipped by the repair-controller comparison: .*prunable/);
    const wt3 = path.join(root, "wt3");
    execFileSync("git", ["-C", wt1, "worktree", "add", "-q", "-b", "third", wt3]);
    mkdirSync(path.join(wt3, ".claude", "hooks"), { recursive: true });
    const real = path.join(root, "elsewhere.mjs");
    writeFileSync(real, KIT_CONTROLLER);
    symlinkSync(real, path.join(wt3, ".claude", "hooks", "repair-dispatch-state.mjs"));
    const s = init(wt1, prompts, ["--force"]);
    assert.notEqual(s.status, 0, "a symlink is never trusted as the same controller");
    assert.match(s.stderr, /installed unreadable/);
  } finally { cleanup(); }
});

test("a target outside any Git work tree is not refused", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-mixed-nogit-"));
  const prompts = mkdtempSync(path.join(os.tmpdir(), "kit-mixed-nogit-p-"));
  try {
    const r = init(path.join(dir, "fresh"), prompts);
    assert.doesNotMatch(r.stderr, /REFUSED —/);
    assert.ok(existsSync(path.join(dir, "fresh", ".claude")), "adoption proceeded");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(prompts, { recursive: true, force: true }); }
});

test("a sibling worktree whose PATH holds a newline is still read (worktree list -z), and its old controller refuses", () => {
  const { root, wt1, prompts, cleanup } = repoWithTwoWorktrees();
  try {
    const odd = path.join(root, "odd\nname");
    execFileSync("git", ["-C", wt1, "worktree", "add", "-q", "-b", "odd", odd]);
    plant(odd, ".claude", OLD_CONTROLLER);
    const r = init(wt1, prompts);
    assert.notEqual(r.status, 0, "the newline-path sibling is compared, not skipped");
    assert.match(r.stderr, /\[odd\] \.claude\/hooks\/repair-dispatch-state\.mjs/, "…and named with its branch");
  } finally { cleanup(); }
});
