// workflow-kit — the kit's OWN every-lane commit floor, turned on the kit.
//
// `templates/kit-precommit.test.mjs` is the FM1 pin the installer hands an ADOPTER: it goes red when
// that repository's core.hooksPath does not resolve to its tracked `.githooks`. The kit shipped that
// pin and never ran one on itself, so its own floor was silently dead — core.hooksPath named
// `.githooks`, a directory the kit source does not have (it tracks `githooks/pre-commit`, the SOURCE
// `bin/init.mjs` copies into adopters), and every kit commit made in that state bypassed the floor.
// `git config` is per-clone and untracked, so a FRESH clone was worse still: unset, git looks in
// `.git/hooks/`, nothing runs, and nothing in the tree says so.
//
// This file is the kit-native counterpart of that pin, plus the coverage the bootstrap branch never
// had. It asserts three separable things, because "the control is installed" and "the control is
// armed" and "the control RUNS and discriminates" fail independently:
//   (1) armed    — core.hooksPath is exactly this repository's tracked githooks/, hook executable;
//   (2) runs     — a real `git commit` in the kit's OWN layout passes a declared commit and blocks
//                  an undeclared one, by execution, not by reading the source;
//   (3) portable — the adopter's `.githooks` layout and the bootstrap branch behave as before.
//
// Every fixture repository is built with the developer's environment CUT OUT: every `GIT_*`
// variable is dropped, and the global and system config files are pointed at an empty file this
// test owns. A global `core.hooksPath`, a global commit-signing requirement, a global hook or an
// inherited `GIT_DIR` could otherwise decide the result of a test about hooks, which would make
// this suite report the host rather than the artifact.

import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_DIR = "githooks";                     // the kit's own tracked spelling (no dot)
const ADOPTER_HOOK_DIR = ".githooks";            // what `bin/init.mjs` installs into an adopter
const KIT_HOOK = path.join(KIT, HOOK_DIR, "pre-commit");
const ARM = `npm install (which runs scripts/arm-commit-floor.mjs), or: git config core.hooksPath ${HOOK_DIR}`;
const SCRATCH = mkdtempSync(path.join(os.tmpdir(), "kit-floor-cfg-"));
const EMPTY_CONFIG = path.join(SCRATCH, "gitconfig");
writeFileSync(EMPTY_CONFIG, "");
process.on("exit", () => { try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* best effort */ } });
const HERMETIC = Object.fromEntries([
  ...Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  ["GIT_CONFIG_GLOBAL", EMPTY_CONFIG],
  ["GIT_CONFIG_SYSTEM", EMPTY_CONFIG],
]);

function git(cwd, args, env = undefined) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }).trim();
}

// The configured value EXACTLY as git stores it, with ONLY the single "\n" git appends to its own
// output removed — not `\r\n`, because a carriage return at the end of the value belongs to the
// value and git keeps it. `git config` keeps a trailing space too, and a stored "githooks " or
// "githooks\r" finds no hook at all while a trimmed read reports the floor as armed — the one
// whitespace difference that is a dead floor rather than formatting.
function rawConfig(cwd, key) {
  return execFileSync("git", ["-C", cwd, "config", "--get", key], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .replace(/\n$/, "");
}

test(`the kit's OWN commit floor is ARMED: core.hooksPath is the tracked ${HOOK_DIR}/`, () => {
  let top;
  try { top = git(KIT, ["rev-parse", "--show-toplevel"]); }
  catch { assert.fail("the kit checkout is not a git repository — its commit floor cannot be wired"); }

  let hooksPath;
  try { hooksPath = rawConfig(KIT, "core.hooksPath"); }
  catch {
    assert.fail(`core.hooksPath is UNSET in this checkout — the kit's own every-lane commit floor is ` +
      `SILENTLY ABSENT (FM1, the failure the floor exists to prevent). Run: ${ARM}`);
  }

  // Compared as the LITERAL configured string, not as a resolved path. git does not normalise the
  // value it stores: `githooks/nonexistent/..` resolves to `githooks` for `path.resolve` and to a
  // directory git cannot find, so a resolved-path comparison would certify an absent floor. The
  // adopter's own FM1 pin (`tests/kit-controls.test.mjs`) compares the literal value for the same
  // reason. The kit's arming script writes exactly this value.
  assert.equal(hooksPath, HOOK_DIR,
    `core.hooksPath must be exactly "${HOOK_DIR}" — the directory this repository TRACKS the hook ` +
    `in; got ${hooksPath ? `"${hooksPath}"` : "an empty value"}. A hooksPath naming anything git ` +
    `cannot find does not fall back to .git/hooks, it disables hooks entirely. Run: ${ARM}`);

  const hook = path.join(top, hooksPath, "pre-commit");
  const st = statSync(hook);                     // throws if missing → red, correctly
  assert.ok(st.isFile(), `${hook} is not a file`);
  try { accessSync(hook, constants.X_OK); }
  catch { assert.fail(`${HOOK_DIR}/pre-commit is not executable — git will not run it (chmod +x it)`); }

  // Ask git, do not infer: the hook must be the one git itself would run. Deliberately WITHOUT
  // `--ignore-missing`, which suppresses the "cannot find a hook named pre-commit" line this
  // assertion is looking for and would make the check vacuous. Asserted only when git understands
  // the question — `git hook run` arrived in git 2.36, and a check that quietly passes on an older
  // git would be worse than one that says it did not run.
  const found = spawnSync("git", ["-C", KIT, "hook", "run", "pre-commit"], { encoding: "utf8" });
  const said = String(found.stderr || "");
  if (!/is not a git command|unknown subcommand|usage: git hook/i.test(said)) {
    assert.doesNotMatch(said, /cannot find a hook named pre-commit/,
      `git cannot find a hook named pre-commit even though core.hooksPath is "${hooksPath}" — the ` +
      `floor is not actually reachable. Run: ${ARM}`);
  }
});

function newRepo(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["init", "-q", dir], { env: HERMETIC });
  git(dir, ["config", "user.email", "t@t"], HERMETIC);
  git(dir, ["config", "user.name", "t"], HERMETIC);
  git(dir, ["config", "commit.gpgsign", "false"], HERMETIC);
  return dir;
}

function installHook(dir, hookDir) {
  mkdirSync(path.join(dir, hookDir), { recursive: true });
  copyFileSync(KIT_HOOK, path.join(dir, hookDir, "pre-commit"));
  chmodSync(path.join(dir, hookDir, "pre-commit"), 0o755);
}

// A repository that TRACKS the hook at `hookDir/pre-commit` and has it armed. The seed commit is
// made before arming, so the hook cannot block the commit that introduces it.
function repoTrackingHookAt(dir, hookDir) {
  installHook(dir, hookDir);
  writeFileSync(path.join(dir, "README.md"), "seed\n");
  git(dir, ["add", path.posix.join(hookDir, "pre-commit"), "README.md"], HERMETIC);
  git(dir, ["commit", "-q", "-m", "seed"], HERMETIC);
  git(dir, ["config", "core.hooksPath", hookDir], HERMETIC);
}

function declare(dir, body = '{"mode":"in-thread","sessionId":"s","taskId":"floor-probe","tier":"T1"}\n') {
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  writeFileSync(path.join(dir, ".claude", "task-lane.json"), body);
}

function commit(dir, message) {
  return spawnSync("git", ["-C", dir, "commit", "-m", message], { encoding: "utf8", env: HERMETIC });
}

function stageCode(dir, name) {
  writeFileSync(path.join(dir, name), "export const x = 1;\n");
  git(dir, ["add", name], HERMETIC);
}

// The load-bearing pair. Before the tracked-spelling fix the kit-layout cases FAILED: the hook's
// bootstrap check knew only the adopter spelling, could not find itself in HEAD, and blocked EVERY
// code-bearing commit — declared or not — with "absent from HEAD but is not staged for bootstrap".
// Arming the floor would have broken every kit commit while looking like enforcement.
for (const [layout, hookDir] of [["the kit's own", HOOK_DIR], ["an adopter's", ADOPTER_HOOK_DIR]]) {
  test(`the floor RUNS in ${layout} layout (${hookDir}/): a declared code commit passes`, () => {
    const dir = newRepo("kit-floor-");
    try {
      repoTrackingHookAt(dir, hookDir);
      declare(dir);
      stageCode(dir, "feature.mjs");
      const r = commit(dir, "declared");
      assert.equal(r.status, 0,
        `a declared code-bearing commit must pass the floor in ${hookDir}/; got exit ${r.status}:\n${r.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`the floor BLOCKS in ${layout} layout (${hookDir}/): an undeclared code commit is refused`, () => {
    const dir = newRepo("kit-floor-");
    try {
      repoTrackingHookAt(dir, hookDir);
      stageCode(dir, "feature.mjs");
      const r = commit(dir, "undeclared");
      assert.notEqual(r.status, 0, `an undeclared code-bearing commit must be BLOCKED in ${hookDir}/`);
      assert.match(r.stderr, /pre-commit BLOCKED: \.claude\/task-lane\.json is undeclared/,
        `the block must name the real cause — the missing declaration — not the bootstrap branch:\n${r.stderr}`);
      // The remediation must name a hooks directory that is actually THERE. Naming one that is not
      // tells a reader to point git at nothing, which disables hooks rather than installing them.
      assert.match(r.stderr, new RegExp(`git config core\\.hooksPath ${hookDir.replace(".", "\\.")}$`, "m"),
        `the remediation must name ${hookDir}:\n${r.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`the floor still passes a docs-only commit in ${layout} layout (${hookDir}/)`, () => {
    const dir = newRepo("kit-floor-");
    try {
      repoTrackingHookAt(dir, hookDir);
      writeFileSync(path.join(dir, "notes.md"), "note\n");
      git(dir, ["add", "notes.md"], HERMETIC);
      const r = commit(dir, "docs");
      assert.equal(r.status, 0, `docs-only must not be over-blocked in ${hookDir}/:\n${r.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// The remediation names an install target only if the hook FILE is there. An empty directory left
// behind after the hook was deleted is not an install target: pointing core.hooksPath at it
// disables the floor exactly as a missing directory does, so advising it would turn a working
// external hooks configuration into no configuration at all.
test("the remediation never advertises a hooks directory whose pre-commit is gone", () => {
  const dir = newRepo("kit-floor-empty-");
  const elsewhere = mkdtempSync(path.join(os.tmpdir(), "kit-floor-ext-"));
  try {
    repoTrackingHookAt(dir, HOOK_DIR);
    // The hook now runs from an EXTERNAL directory, and the tracked one is deleted from the working
    // tree while `githooks/` itself remains.
    copyFileSync(KIT_HOOK, path.join(elsewhere, "pre-commit"));
    chmodSync(path.join(elsewhere, "pre-commit"), 0o755);
    git(dir, ["config", "core.hooksPath", elsewhere], HERMETIC);
    rmSync(path.join(dir, HOOK_DIR, "pre-commit"));

    stageCode(dir, "feature.mjs");
    const r = commit(dir, "undeclared");
    assert.notEqual(r.status, 0, "the external hook must still block an undeclared code commit");
    assert.doesNotMatch(r.stderr, new RegExp(`git config core\\.hooksPath ${HOOK_DIR}$`, "m"),
      `${HOOK_DIR}/ holds no pre-commit here, so the remediation must not name it:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

// The bootstrap branch: HEAD tracks the hook at NEITHER spelling, so the only commit the floor lets
// through without a declaration is the one that introduces the hook at the DOCUMENTED install
// location. That exemption waives the declaration for a pathname whose content nothing validates,
// so teaching the HEAD lookup a second spelling must not have widened it to a second pathname.
test("bootstrap: only the documented install path is exempt, and code cannot ride in beside it", () => {
  const dir = newRepo("kit-floor-boot-");
  try {
    writeFileSync(path.join(dir, "README.md"), "seed\n");
    git(dir, ["add", "README.md"], HERMETIC);
    git(dir, ["commit", "-q", "-m", "seed"], HERMETIC);
    installHook(dir, ADOPTER_HOOK_DIR);
    git(dir, ["config", "core.hooksPath", ADOPTER_HOOK_DIR], HERMETIC);

    // (a) code alone, even with a valid declaration: refused — the hook is not in HEAD.
    declare(dir);
    stageCode(dir, "feature.mjs");
    const rode = commit(dir, "code while the hook is untracked");
    assert.notEqual(rode.status, 0, "code must not commit while the hook is untracked");
    assert.match(rode.stderr, /is not staged for bootstrap/,
      `the block must name the bootstrap condition:\n${rode.stderr}`);

    // (b) the OTHER spelling staged alone is NOT exempt: the waiver is one pathname, not two.
    git(dir, ["reset", "-q"], HERMETIC);
    rmSync(path.join(dir, "feature.mjs"));
    rmSync(path.join(dir, ".claude"), { recursive: true, force: true });
    mkdirSync(path.join(dir, HOOK_DIR), { recursive: true });
    writeFileSync(path.join(dir, HOOK_DIR, "pre-commit"), "#!/bin/sh\nexit 0\n");
    git(dir, ["add", path.posix.join(HOOK_DIR, "pre-commit")], HERMETIC);
    const decoy = commit(dir, "the other spelling, undeclared");
    assert.notEqual(decoy.status, 0,
      `staging ${HOOK_DIR}/pre-commit must not waive the declaration — that waiver is for ` +
      `${ADOPTER_HOOK_DIR}/pre-commit, the documented install location, and widening it would mint a ` +
      `second pathname that carries undeclared executable content into a commit`);

    // (c) the hook plus code together, undeclared: refused — only the hook alone is exempt.
    git(dir, ["reset", "-q"], HERMETIC);
    rmSync(path.join(dir, HOOK_DIR), { recursive: true, force: true });
    stageCode(dir, "feature.mjs");
    git(dir, ["add", path.posix.join(ADOPTER_HOOK_DIR, "pre-commit")], HERMETIC);
    const beside = commit(dir, "hook plus code, undeclared");
    assert.notEqual(beside.status, 0, "code must not ride in beside the hook-only introduction");
    assert.match(beside.stderr, /pre-commit BLOCKED: \.claude\/task-lane\.json is undeclared/,
      `co-staged code falls through to the declaration check:\n${beside.stderr}`);

    // (d) the hook ALONE, with no declaration at all: the one-time introduction passes.
    git(dir, ["reset", "-q"], HERMETIC);
    rmSync(path.join(dir, "feature.mjs"));
    git(dir, ["add", path.posix.join(ADOPTER_HOOK_DIR, "pre-commit")], HERMETIC);
    const boot = commit(dir, "install the floor");
    assert.equal(boot.status, 0, `the hook-only bootstrap commit must pass with no declaration:\n${boot.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
