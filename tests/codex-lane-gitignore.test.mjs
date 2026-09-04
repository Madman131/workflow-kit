// The Codex lane's install is PER-CHECKOUT and one file in it is path-baked: `.codex/hooks.json`
// carries the target's ABSOLUTE path in every registered command. Committed, it registers hooks at
// a path other clones and linked worktrees do not have — and a hook that fails to START blocks
// nothing, silently. `init` therefore gitignores the lane's per-checkout output (config.toml,
// hooks.json, hooks/) while keeping `.codex/agents/*.toml` — the cold-review seat the team reviews —
// TRACKED. This file pins that contract by asking GIT, not the .gitignore text: a spelling in the
// file proves nothing about what a blanket add would stage.
//
// Three branches of the condition are pinned: the lane installed this run; the lane SKIPPED on a
// fresh repo (nothing on disk to protect ⇒ nothing appended); and the lane skipped over a repo a
// previous run already registered (a path-baked file already on disk is exactly as committable as
// one written today ⇒ appended). Plus idempotence: a re-run never duplicates the block.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
const LANE_LINES = [".codex/config.toml", ".codex/hooks.json", ".codex/hooks/"];

function fresh() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-gi-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-gi-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  const run = (args = []) => spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  // What GIT would do, which is the only thing that matters: `git check-ignore -q` exits 0 when
  // the path IS ignored, 1 when it is not. The path need not exist.
  const ignored = (rel) => spawnSync("git", ["-C", dir, "check-ignore", "-q", rel]).status === 0;
  return { dir, run, ignored, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("a fresh adopt with the Codex lane gitignores its per-checkout output and keeps the cold-review seat tracked", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    const r = run();
    assert.equal(r.status, 0, `adopt failed: ${r.stderr}`);
    assert.ok(existsSync(path.join(dir, ".codex", "hooks.json")), "precondition: the lane installed");
    // The path-baked file is the reason the whole block exists.
    assert.match(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "precondition: hooks.json bakes THIS checkout's absolute path in");
    for (const rel of [".codex/hooks.json", ".codex/config.toml", ".codex/hooks/guard-lane-authoring.mjs"]) {
      assert.ok(ignored(rel), `${rel} must be IGNORED — committed, it registers hooks at a path other clones lack`);
    }
    assert.ok(!ignored(".codex/agents/cold-reviewer.toml"), ".codex/agents/*.toml stays TRACKED — the seat the team reviews carries no path");
    assert.ok(!ignored(".codex/agents/"), "…and not via a directory rule either");
    // The adopter's own entries survive the append.
    assert.ok(ignored("node_modules/x"), "the adopter's own ignore is preserved");
    // The run SAYS so, where an adopter reads the summary.
    assert.match(r.stdout + r.stderr, /DO NOT COMMIT the lane/, "the end-of-run summary tells the adopter not to commit the lane");
  } finally { cleanup(); }
});

test("a re-run never duplicates the block", () => {
  const { dir, run, cleanup } = fresh();
  try {
    assert.equal(run().status, 0);
    const once = readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.equal(run().status, 0);
    const twice = readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.equal(twice, once, "a second run leaves .gitignore byte-identical");
    for (const line of LANE_LINES) {
      assert.equal(once.split(/\r?\n/).filter((l) => l.trim() === line).length, 1, `${line} appears exactly once`);
    }
  } finally { cleanup(); }
});

test("--skip-codex-lane on a FRESH repo appends nothing: there is no path-baked file to protect", () => {
  const { run, ignored, cleanup } = fresh();
  try {
    const r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    for (const rel of [".codex/hooks.json", ".codex/config.toml"]) {
      assert.ok(!ignored(rel), `${rel} is NOT ignored when nothing installed it — an ignore for a file that does not exist is noise in the adopter's tree`);
    }
  } finally { cleanup(); }
});

test("--skip-codex-lane over a repo a previous run REGISTERED still appends: the file on disk is exactly as committable", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    assert.equal(run().status, 0, "first run installs the lane");
    // Strip the ignore the first run wrote, so only the second run can be credited with it.
    const gi = path.join(dir, ".gitignore");
    writeFileSync(gi, readFileSync(gi, "utf8").split(/\r?\n/).filter((l) => !l.startsWith(".codex/") && !l.includes("Codex lane")).join("\n") + "\n");
    assert.ok(!ignored(".codex/hooks.json"), "precondition: the ignore is gone, the file remains");
    assert.ok(existsSync(path.join(dir, ".codex", "hooks.json")), "precondition: the path-baked file is still on disk");
    const r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(ignored(".codex/hooks.json"), "the second run, though it wrote nothing to the lane, re-protects the file already there");
    assert.ok(!ignored(".codex/agents/cold-reviewer.toml"), "…and still never the seat");
  } finally { cleanup(); }
});
