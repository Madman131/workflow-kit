// workflow-kit — portable FM1 test. `init` installs this into the ADOPTER's tests/ so the adopter's
// CI goes RED when the harness-agnostic pre-commit control is not actually wired up.
//
// FM1 (PORTABILITY.md): core.hooksPath is LOCAL git config, not tracked. A fresh clone / new worktree
// / CI checkout with it unset has the pre-commit control silently ABSENT — a dormant control that
// manufactures assurance (core/INVARIANTS.md rules 2 & 10). This test makes that state loud: it fails
// unless core.hooksPath resolves to the tracked .githooks dir AND the hook exists and is executable.

import { execFileSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("FM1: core.hooksPath resolves to the tracked .githooks and pre-commit is installed + executable", () => {
  let top;
  try { top = git(["rev-parse", "--show-toplevel"]); }
  catch { assert.fail("not a git repository — cannot verify the pre-commit control is wired"); }

  let hooksPath;
  try { hooksPath = git(["config", "core.hooksPath"]); }
  catch {
    assert.fail(
      "core.hooksPath is UNSET — the harness-agnostic pre-commit control is SILENTLY ABSENT (FM1). " +
      "Run: git config core.hooksPath .githooks");
  }
  assert.ok(hooksPath, "core.hooksPath is empty — the pre-commit control is not wired (FM1)");

  const resolved = path.resolve(top, hooksPath);
  assert.equal(resolved, path.join(top, ".githooks"),
    `core.hooksPath must resolve to ${path.join(top, ".githooks")}; got ${resolved}`);

  const hook = path.join(resolved, "pre-commit");
  const st = statSync(hook); // throws if missing → RED, which is correct
  assert.ok(st.isFile(), `${hook} is not a file`);
  assertExecutable(hook);
});

function assertExecutable(file) {
  try { accessSync(file, constants.X_OK); }
  catch { assert.fail(`${file} is not executable — git will not run it as a hook (chmod +x it)`); }
}
