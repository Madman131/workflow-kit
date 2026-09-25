// v2.35.0 — githooks/commit-msg: every commit body carries the Step 0 `entry:` line (presence and
// shape only), and init installs the hook beside the pre-commit.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(KIT, "githooks", "commit-msg");

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "commit-msg-"));
  const git = (args, opts = {}) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", ...opts });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
  mkdirSync(path.join(dir, "hooks"));
  copyFileSync(HOOK, path.join(dir, "hooks", "commit-msg"));
  chmodSync(path.join(dir, "hooks", "commit-msg"), 0o755);
  git(["config", "core.hooksPath", "hooks"]);
  let n = 0;
  const commit = (message) => {
    writeFileSync(path.join(dir, `f${++n}.txt`), `${n}\n`);
    git(["add", `f${n}.txt`]);
    return git(["commit", "-q", "-m", message]);
  };
  return { dir, git, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a commit body needs an entry line of the right shape; the subject does not count", () => {
  const { commit, cleanup } = repo();
  try {
    const ok = (msg, why) => assert.equal(commit(msg).status, 0, why);
    const no = (msg, why) => {
      const r = commit(msg);
      assert.notEqual(r.status, 0, why);
      assert.match(r.stderr, /entry: none.*entry: class-N/s, `${why} — and the refusal names both forms`);
    };
    ok("Base\n\nentry: none", "entry: none");
    ok("Change\n\nBody text.\n\nentry: class-2,3,4\n\nCo-Authored-By: X", "entry: class-2,3,4 among trailers");
    ok("Change\n\nentry:class-1", "no space after the colon is still the shape");
    no("Change without a triage line", "no body at all");
    no("Change\n\nJust a body.", "a body with no entry line");
    no("entry: none", "an entry line only in the subject");
    no("Change\n\nentry: class-5", "a class outside the four doors");
    no("Change\n\nentry: maybe", "a value that is neither none nor class-N");
    no("Change\n\nentry:", "an empty value");
    no("Change\n\nentry: class-2,", "a trailing comma");
    no("Change\n\n# entry: none", "a comment line never satisfies the check");
    no("# template note\nentry: none", "once Git strips comments the entry line is the SUBJECT, not the body");
  } finally { cleanup(); }
});

test("Git-authored and carried commits are exempt: merge, revert, fixup/squash/amend", () => {
  const { git, commit, cleanup } = repo();
  try {
    assert.equal(commit("Base\n\nentry: none").status, 0);
    git(["checkout", "-q", "-b", "side"]);
    assert.equal(commit("Side\n\nentry: none").status, 0);
    git(["checkout", "-q", "main"]);
    assert.equal(commit("Main\n\nentry: none").status, 0);
    const merged = git(["merge", "--no-ff", "--no-edit", "side"]);
    assert.equal(merged.status, 0, `a real merge commit needs no entry line: ${merged.stderr}`);
    const reverted = git(["revert", "--no-edit", "HEAD~1"]);
    assert.equal(reverted.status, 0, `git revert --no-edit is never blocked: ${reverted.stderr}`);
    // An edited revert (or one committed by hand) keeps Git's subject and does run the hook.
    assert.equal(commit('Revert "Main"\n\nThis reverts commit 0000000.').status, 0, "a Revert subject is exempt");
    git(["checkout", "-q", "-b", "side2"]);
    assert.equal(commit("Side two\n\nentry: none").status, 0);
    git(["checkout", "-q", "main"]);
    const custom = git(["merge", "--no-ff", "-m", "Bring side two in", "side2"]);
    assert.equal(custom.status, 0, `a merge with its own message is exempt by MERGE_HEAD: ${custom.stderr}`);
    for (const prefix of ["fixup! Main", "squash! Main", "amend! Main"]) {
      assert.equal(commit(prefix).status, 0, `${prefix} is carried by its parent's line`);
    }
  } finally { cleanup(); }
});

test("init installs .githooks/commit-msg executable beside the pre-commit, and flags a differing kept copy", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "commit-msg-adopt-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "commit-msg-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const run = (...extra) => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexDir, "--skip-codex-lane", ...extra], { encoding: "utf8" });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const installed = path.join(dir, ".githooks", "commit-msg");
    assert.equal(readFileSync(installed, "utf8"), readFileSync(HOOK, "utf8"), "installed byte-identical");
    assert.ok(statSync(installed).mode & 0o100, "installed executable");
    assert.match(first.stdout, /pre-commit \+ commit-msg installed/);
    writeFileSync(installed, "#!/bin/sh\nexit 0\n");
    const again = run();
    assert.match(again.stdout + again.stderr, /existing \.githooks\/commit-msg KEPT and its content DIFFERS/);
    assert.match(again.stdout + again.stderr, /a \.githooks hook is an EXISTING, UNVERIFIED file/);
    assert.ok(existsSync(installed));
  } finally {
    rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true });
  }
});
