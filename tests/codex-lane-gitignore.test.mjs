// The Codex lane's install is PER-CHECKOUT and exactly ONE file in it is path-baked: `.codex/hooks.json`
// carries the target's ABSOLUTE path in every registered command. Committed, it registers hooks at a
// path other clones and linked worktrees do not have — and a hook that fails to START blocks nothing,
// silently. `init` therefore gitignores that file — and ONLY that file, and ONLY when the kit wrote it.
// Nothing else in the lane is ignored: `.codex/config.toml` is [P] (path-free, kept when the adopter
// carries their own), `.codex/hooks/` are byte-copies of the tracked `.claude/hooks/`, and
// `.codex/agents/*.toml` is the cold-review seat the team reviews. An ignore over any of those hides
// adopter-owned content from `git add` — the first draft of this block did that, and a cold seat caught it.
//
// Ownership is PROVENANCE, not existence: the kit stamps a `description` beginning "workflow-kit v"
// into the registration it writes; an adopter's own file at that path, or one that cannot be parsed,
// is left tracked. This file pins the contract by asking GIT (`check-ignore`), never the .gitignore text.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);

function fresh() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-gi-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-gi-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  const run = (args = []) => spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  // `git check-ignore -q` exits 0 when the path IS ignored, 1 when it is not; the path need not exist.
  const ignored = (rel) => spawnSync("git", ["-C", dir, "check-ignore", "-q", rel]).status === 0;
  const stripIgnore = () => {
    const gi = path.join(dir, ".gitignore");
    writeFileSync(gi, readFileSync(gi, "utf8").split(/\r?\n/).filter((l) => !l.includes(".codex/") && !l.includes("PER-CHECKOUT")).join("\n") + "\n");
  };
  return { dir, run, ignored, stripIgnore, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("a fresh adopt ignores the kit's path-baked hooks.json and NOTHING else in .codex/", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    const r = run();
    assert.equal(r.status, 0, `adopt failed: ${r.stderr}`);
    const hooksJson = path.join(dir, ".codex", "hooks.json");
    assert.ok(existsSync(hooksJson), "precondition: the lane installed");
    assert.match(readFileSync(hooksJson, "utf8"), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "precondition: hooks.json bakes THIS checkout's absolute path in");
    assert.match(JSON.parse(readFileSync(hooksJson, "utf8")).description, /^workflow-kit v/, "precondition: the kit stamps its provenance");
    assert.ok(ignored(".codex/hooks.json"), ".codex/hooks.json is IGNORED — committed, it registers hooks at a path other clones lack");
    for (const rel of [".codex/config.toml", ".codex/hooks/guard-lane-authoring.mjs", ".codex/agents/cold-reviewer.toml", ".codex/agents/"]) {
      assert.ok(!ignored(rel), `${rel} stays TRACKED — an ignore over it would hide adopter-owned or reviewed content`);
    }
    assert.ok(existsSync(path.join(dir, ".codex", "agents", "cold-reviewer.toml")), "…and the seat file exists to be tracked");
    assert.ok(ignored("node_modules/x"), "the adopter's own ignore is preserved");
    const out = r.stdout + r.stderr;
    assert.match(out, /DO NOT COMMIT \.codex\/hooks\.json/, "the summary names the one file");
    assert.match(out, /git rm --cached -- \.codex\/hooks\.json/, "…and carries the untrack step for an already-indexed copy, which an ignore rule cannot perform");
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

test("--skip-codex-lane on a FRESH repo appends nothing: there is no kit-written file to protect", () => {
  const { run, ignored, cleanup } = fresh();
  try {
    const r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!ignored(".codex/hooks.json"), "no ignore for a file nothing installed");
  } finally { cleanup(); }
});

test("--skip-codex-lane over a KIT-written hooks.json a previous run left behind still ignores it: provenance, not this run's write", () => {
  const { dir, run, ignored, stripIgnore, cleanup } = fresh();
  try {
    assert.equal(run().status, 0, "first run installs the lane");
    stripIgnore();
    assert.ok(!ignored(".codex/hooks.json"), "precondition: the ignore is gone, the kit's file remains");
    assert.ok(existsSync(path.join(dir, ".codex", "hooks.json")));
    const r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(ignored(".codex/hooks.json"), "re-protected: the file on disk is exactly as committable as one written today");
  } finally { cleanup(); }
});

test("an ADOPTER-OWNED registration or config at the same paths is never ignored — a foreign or unparseable hooks.json is theirs to commit", () => {
  const { dir, run, ignored, cleanup } = fresh();
  try {
    mkdirSync(path.join(dir, ".codex"), { recursive: true });
    writeFileSync(path.join(dir, ".codex", "config.toml"), "# the adopter's own codex config\nmodel = \"their-model\"\n");
    writeFileSync(path.join(dir, ".codex", "hooks.json"), JSON.stringify({ description: "the adopter's own hooks", hooks: {} }, null, 2) + "\n");
    const r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!ignored(".codex/hooks.json"), "a hooks.json WITHOUT the kit's provenance stamp is adopter-owned: left tracked");
    assert.ok(!ignored(".codex/config.toml"), "the adopter's config.toml is never ignored");
    assert.equal(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8").includes("the adopter's own hooks"), true, "…and untouched under --skip-codex-lane");
    // Unparseable at the same path: also not the kit's, also left alone.
    writeFileSync(path.join(dir, ".codex", "hooks.json"), "{ not json\n");
    assert.equal(run(["--skip-codex-lane"]).status, 0);
    assert.ok(!ignored(".codex/hooks.json"), "a file the kit cannot parse is not treated as the kit's");
  } finally { cleanup(); }
});

test("init WARNS, with the exact untrack command, when a kit-written hooks.json is already indexed", () => {
  const { dir, run, ignored, stripIgnore, cleanup } = fresh();
  try {
    assert.equal(run().status, 0, "first run installs the lane");
    stripIgnore();
    // "Already indexed" is an INDEX condition, which is what `ls-files` reads: `git add` is the whole
    // seed. (A commit here would be blocked by the pre-commit hook init just installed — correctly.)
    execFileSync("git", ["-C", dir, "add", "--", ".codex/hooks.json"]);
    const r = run(["--skip-codex-lane"]);
    assert.equal(r.status, 0, r.stderr);
    // A TRACKED path is not reported by `check-ignore` without --no-index — the index wins. Ask about
    // the rule itself, which is the thing this run wrote.
    assert.equal(spawnSync("git", ["-C", dir, "check-ignore", "-q", "--no-index", ".codex/hooks.json"]).status, 0, "the ignore rule is re-written…");
    assert.match(r.stdout + r.stderr, /\.codex\/hooks\.json is ALREADY TRACKED/, "…and init says the index still holds it");
    assert.match(r.stdout + r.stderr, /git rm --cached -r -- \.codex\/hooks\.json/, "…with the exact command");
  } finally { cleanup(); }
});
