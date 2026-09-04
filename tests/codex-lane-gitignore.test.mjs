// The Codex lane's install is PER-CHECKOUT and exactly ONE file in it is path-baked: `.codex/hooks.json`
// carries the target's ABSOLUTE path in every registered command. Committed, it registers hooks at a
// path other clones and linked worktrees do not have — and a hook that fails to START blocks nothing,
// silently. `init` gitignores that file — and ONLY that file, and ONLY on a run in which it wrote it.
//
// THE ONE PROVENANCE THE INSTALLER HAS IS WHAT IT WROTE THIS RUN. Three rounds of cold review took
// apart every content heuristic for "is the file at this path the kit's / path-baked" — a stamp anyone
// can write, a substring a status message can carry, a raw path the generator shell-escapes — and each
// patch minted the next defect. There is no heuristic here: the rule follows the write. Where init
// preserved an adopter's registration while an ignore rule for it is active, it says it cannot tell
// whose file that is now, and names the line to delete. This file pins the contract by asking GIT
// (`check-ignore`, `ls-files`), never the .gitignore text.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);

function fresh(prefix = "kit-codex-gi-") {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-gi-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  const run = (args = []) => spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  // `git check-ignore -q` exits 0 when the path IS ignored (--no-index: the rule itself, even for a tracked path).
  const ignored = (rel) => spawnSync("git", ["-C", dir, "check-ignore", "-q", "--no-index", "--", rel]).status === 0;
  const stripIgnore = () => {
    const gi = path.join(dir, ".gitignore");
    writeFileSync(gi, readFileSync(gi, "utf8").split(/\r?\n/).filter((l) => !l.includes(".codex/") && !l.includes("PER-CHECKOUT")).join("\n") + "\n");
  };
  return { dir, run, ignored, stripIgnore, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("a fresh adopt ignores the hooks.json init just wrote and NOTHING else in .codex/", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    const r = run();
    assert.equal(r.status, 0, `adopt failed: ${r.stderr}`);
    const hooksJson = path.join(dir, ".codex", "hooks.json");
    assert.ok(existsSync(hooksJson), "precondition: the lane installed");
    assert.match(readFileSync(hooksJson, "utf8"), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "precondition: hooks.json bakes THIS checkout's absolute path in");
    assert.ok(ignored(".codex/hooks.json"), ".codex/hooks.json is IGNORED — committed, it registers hooks at a path other clones lack");
    for (const rel of [".codex/config.toml", ".codex/hooks/guard-lane-authoring.mjs", ".codex/agents/cold-reviewer.toml", ".codex/agents/"]) {
      assert.ok(!ignored(rel), `${rel} stays TRACKED — an ignore over it would hide adopter-owned or reviewed content`);
    }
    assert.ok(existsSync(path.join(dir, ".codex", "agents", "cold-reviewer.toml")), "…and the seat file exists to be tracked");
    assert.ok(ignored("node_modules/x"), "the adopter's own ignore is preserved");
    const out = r.stdout + r.stderr;
    assert.match(out, /DO NOT COMMIT \.codex\/hooks\.json/, "the summary names the one file");
    assert.match(out, /git rm --cached -- \.codex\/hooks\.json/, "…and carries the untrack step, which an ignore rule cannot perform");
  } finally { cleanup(); }
});

test("a target path with an apostrophe — which the generator shell-escapes — is handled exactly the same, because nothing reads the path back", () => {
  const { dir, run, ignored, cleanup } = fresh("kit-codex-gi-a'b-");
  try {
    assert.ok(dir.includes("'"), "precondition: the path carries an apostrophe");
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout + r.stderr, /shell-QUOTED/, "precondition: the generator took its quoting branch");
    assert.ok(ignored(".codex/hooks.json"), "the rule follows the write, not a substring of the path");
  } finally { cleanup(); }
});

test("a re-run never duplicates the block", () => {
  const { dir, run, cleanup } = fresh();
  try {
    assert.equal(run().status, 0);
    const once = readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.equal(run().status, 0);
    assert.equal(readFileSync(path.join(dir, ".gitignore"), "utf8"), once, "a second run leaves .gitignore byte-identical");
    assert.equal(once.split(/\r?\n/).filter((l) => l.trim() === ".codex/hooks.json").length, 1, "the entry appears exactly once");
  } finally { cleanup(); }
});

test("--skip-codex-lane writes nothing and says nothing new: on a fresh repo no rule; over an earlier kit install the earlier rule simply persists", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    let r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!ignored(".codex/hooks.json"), "fresh + skip: nothing installed it, nothing ignores it");
    assert.equal(run().status, 0, "now a real install");
    assert.ok(ignored(".codex/hooks.json"), "…which writes the rule");
    r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(ignored(".codex/hooks.json"), "skip over it: the earlier rule persists on its own");
    assert.doesNotMatch(r.stdout + r.stderr, /it is gitignored now|CHECK \.codex\/hooks\.json/, "…and this run claims nothing it did not do");
    assert.ok(existsSync(path.join(dir, ".codex", "hooks.json")), "the file is untouched");
  } finally { cleanup(); }
});

test("a run that PRESERVES an adopter's registration (config.toml declares hooks) ignores nothing and says so", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    mkdirSync(path.join(dir, ".codex"), { recursive: true });
    writeFileSync(path.join(dir, ".codex", "config.toml"), "hooks = \"./hooks.json\"\n");
    writeFileSync(path.join(dir, ".codex", "hooks.json"), JSON.stringify({ description: "ours", hooks: {} }, null, 2) + "\n");
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"), /"ours"/, "precondition: the kit did not replace the adopter's registration");
    assert.ok(!ignored(".codex/hooks.json"), "the adopter's registration stays tracked — init wrote nothing there");
    assert.doesNotMatch(r.stdout + r.stderr, /it is gitignored now/, "no claim of an ignore it did not write");
    assert.match(r.stdout + r.stderr, /init did not write it this run \(your registration is preserved\) and did not ignore it/, "…it says what actually happened");
  } finally { cleanup(); }
});

test("an ignore rule left by an earlier kit install, with the adopter's OWN registration now at that path, is named as a CHECK — init cannot know whose file it is", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    assert.equal(run().status, 0, "first: a kit install writes the rule");
    assert.ok(ignored(".codex/hooks.json"));
    // The adopter takes the lane over: their config declares hooks, their registration replaces the kit's.
    writeFileSync(path.join(dir, ".codex", "config.toml"), "hooks = \"./hooks.json\"\n");
    writeFileSync(path.join(dir, ".codex", "hooks.json"), JSON.stringify({ description: "ours now", hooks: {} }, null, 2) + "\n");
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"), /"ours now"/, "precondition: preserved, not replaced");
    assert.match(r.stdout + r.stderr, /cannot tell whose registration it is now/, "init says it cannot decide…");
    assert.match(r.stdout + r.stderr, /delete the \.codex\/hooks\.json line from \.gitignore/, "…and names the line to delete if the file is theirs");
    assert.match(r.stdout + r.stderr, /CHECK \.codex\/hooks\.json/, "…in the end-of-run checklist too");
    assert.ok(ignored(".codex/hooks.json"), "init never edits .gitignore lines itself — the rule is still there for the adopter to remove");
  } finally { cleanup(); }
});

test("init REFUSES, with the exact untrack command, when the hooks.json it just wrote is already indexed", () => {
  const { dir, run, ignored, stripIgnore, cleanup } = fresh();
  try {
    assert.equal(run().status, 0, "first run installs the lane");
    stripIgnore();
    // "Already indexed" is an INDEX condition, which is what `ls-files` reads: `git add` is the whole
    // seed. (A commit here would be blocked by the pre-commit hook init just installed — correctly.)
    execFileSync("git", ["-C", dir, "add", "--", ".codex/hooks.json"]);
    const r = run();
    assert.equal(r.status, 1, "a tracked path-baked registration is a FAILING state, counted at the exit code");
    assert.ok(ignored(".codex/hooks.json"), "the ignore rule is re-written…");
    assert.match(r.stdout + r.stderr, /\.codex\/hooks\.json is ALREADY TRACKED/, "…and init says the index still holds it");
    assert.match(r.stdout + r.stderr, /git rm --cached -- \.codex\/hooks\.json/, "…with the exact command (no -r: a file)");
    assert.doesNotMatch(r.stdout + r.stderr, /git rm --cached -r -- \.codex/, "…and never the directory form for a file");
  } finally { cleanup(); }
});
