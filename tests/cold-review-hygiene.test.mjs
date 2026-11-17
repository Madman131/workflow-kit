// v2.45.0 KIT-REVIEW-HYGIENE: (a) the design prompt never claims a prior review that did not happen;
// (b) the frozen review tree carries no prior verdicts (Gemini log + adopter-declared reviewRecordPaths),
// except a record the change EDITS (bytes the base already has). Real runs use a fake `agy`; no model is ever called.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = "docs/journal/gemini_review_log.md";
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

function repo(files = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hygiene-repo-"));
  git(dir, "init", "-q"); git(dir, "config", "user.email", "t@example.invalid"); git(dir, "config", "user.name", "T");
  cpSync(path.join(root, "scripts"), path.join(dir, "scripts"), { recursive: true });
  const base = { "core/INVARIANTS.md": "inv\n", "core/REPO_INVARIANTS.md": "repo inv\n", "docs/design.md": "# design\nbody\n", "docs/keep.md": "keep\n", ".gitignore": "/.gemini-gate/\n", ...files };
  for (const [name, text] of Object.entries(base)) put(dir, name, text);
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "base");
  return dir;
}
function put(dir, name, text) { const f = path.join(dir, name); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); }
function config(dir, value) { put(dir, ".claude/kit.config.json", typeof value === "string" ? value : JSON.stringify(value)); }

// A fake agy that records the frozen tree it is run in (git index + files on disk) and the argv it was
// handed, then fails. The runner's freeze happens before this, so the listing is the reviewer's view.
function fakeAgy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hygiene-agy-")), bin = path.join(dir, "agy");
  writeFileSync(bin, `#!/bin/sh
case "$*" in *--version*) echo 1.2.2; exit 0;; esac
git ls-files > "$AGY_DIR/tracked"
find . -path ./.git -prune -o \\( -type f -o -type l \\) -print | sed 's|^\\./||' | sort > "$AGY_DIR/disk"
printf '%s' "$*" > "$AGY_DIR/args"
echo "fake agy: no review" >&2
exit 1
`);
  chmodSync(bin, 0o755);
  return { dir, bin };
}
function review(dir, extra = [], env = {}) {
  const agy = fakeAgy();
  try {
    const result = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--design", "docs/design.md", "--no-log", ...extra], { cwd: dir, encoding: "utf8", env: { ...process.env, GEMINI_AGY_BIN: agy.bin, AGY_DIR: agy.dir, ...env } });
    const read = (n) => (existsSync(path.join(agy.dir, n)) ? readFileSync(path.join(agy.dir, n), "utf8") : null);
    return { ...result, ran: existsSync(path.join(agy.dir, "tracked")), tracked: (read("tracked") || "").split("\n").filter(Boolean), disk: (read("disk") || "").split("\n").filter(Boolean), args: read("args") };
  } finally { rmSync(agy.dir, { recursive: true, force: true }); }
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

// ───────────────────────── (a) the folded premise ─────────────────────────
function dry(dir, extra) { const r = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--design", "docs/design.md", "--dry-run", ...extra], { cwd: dir, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; }

test("(a) design mode without --folded claims no prior review, in prompt or payload", () => {
  const dir = repo(); try {
    const out = dry(dir, []);
    assert.doesNotMatch(out, /already|folded/i, "no ALREADY / FOLDED / folded claim anywhere");
    assert.doesNotMatch(out, /same-family reviewers/i);
    assert.doesNotMatch(out, /none provided|found nothing/i);
    assert.match(out, /You are the first, independent review of this design\./);
    assert.match(out, /=== THE DESIGN \/ SPEC UNDER REVIEW: docs\/design\.md ===/);
    for (const hunt of ["1. INTER-SECTION CONTRADICTIONS", "7. COMPLETENESS GAPS", "VERDICT: GO  (or VERDICT: NO-GO)", "Separate CONFIRMED problems from suspicions"]) assert.ok(out.includes(hunt), `hunt list/contract kept: ${hunt}`);
  } finally { cleanup(dir); }
});

test("(a) design mode with --folded keeps today's wording and the FOLDED section", () => {
  const dir = repo({ "docs/folded.md": "folded note: X\n" }); try {
    for (const extra of [["--folded", "docs/folded.md"], ["--folded", "literal note"]]) {
      const out = dry(dir, extra);
      assert.ok(out.includes('(there is NO code yet — do NOT ask for a diff). Same-family (Claude/Opus) reviewers have ALREADY reviewed this and folded the fixes listed in the "ALREADY FOUND + FOLDED" section. Your job is to find what they MISSED — your value is decorrelated blind spots, so hunt the classes a same-family panel tends to wave through.'));
      assert.ok(out.includes("=== WHAT SAME-FAMILY REVIEWERS ALREADY FOUND + FOLDED (hunt what they MISSED, not these) ==="));
      assert.ok(out.includes("- You have the full design + the invariants + what was already folded. Judge the MECHANISM, not prose style. Cross-reference sections — the best catches are contradictions and missed failure modes, not typos.\n- Do NOT re-report anything already in the \"ALREADY FOUND + FOLDED\" list. Find NEW issues.\n- Separate CONFIRMED problems"));
      assert.doesNotMatch(out, /first, independent review/);
    }
    assert.match(dry(dir, ["--folded", "docs/folded.md"]), /\(from docs\/folded\.md\)\n\nfolded note: X/);
    assert.match(dry(dir, ["--folded", "literal note"]), /^literal note$/m);
  } finally { cleanup(dir); }
});

test("(a) the folded-notes helper has no unconditional 'found nothing' assumption", () => {
  const sh = readFileSync(path.join(root, "scripts/cold-review-gemini.sh"), "utf8");
  assert.doesNotMatch(sh, /assume the same-family panel found nothing/);
});

// ───────────────────────── (b) review records out of the frozen tree ─────────────────────────
test("(b) the Gemini log is absent from the frozen tree: tracked-and-appended, untracked, and symlinked", () => {
  const cases = {
    "tracked, dirty by the runner's own append": (dir) => { writeFileSync(path.join(dir, LOG), "old verdict\nnew attempt\n"); },
    "untracked": (dir) => { git(dir, "rm", "-q", "--cached", LOG); git(dir, "commit", "-qm", "untrack"); put(dir, LOG, "fresh log\n"); },
    "tracked and clean": () => {},
    "replaced by a symlink": (dir) => { rmSync(path.join(dir, LOG)); symlinkSync("../keep.md", path.join(dir, LOG)); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const dir = repo({ [LOG]: "old verdict\n" }); try {
      mutate(dir); put(dir, "docs/design.md", "# design\nbody\nedited\n");
      const r = review(dir); assert.ok(r.ran, `${name}: ${r.stderr}`);
      assert.ok(!r.tracked.includes(LOG) && !r.disk.includes(LOG), `${name}: log must not be in the frozen tree`);
      assert.ok(r.tracked.includes("docs/keep.md"), `${name}: ordinary files stay`);
    } finally { cleanup(dir); }
  }
});

test("(b) the Gemini log IS kept when the candidate edits bytes the base has", () => {
  const dir = repo({ [LOG]: "line one\nline two\n" }); try {
    writeFileSync(path.join(dir, LOG), "line one\nline TWO edited\n");
    const r = review(dir); assert.ok(r.ran, r.stderr);
    assert.ok(r.tracked.includes(LOG), "an edit of existing log bytes makes the log part of the candidate");
  } finally { cleanup(dir); }
});

const DENY = { reviewRecordPaths: [{ glob: "docs/chips/**", reason: "prior gate verdicts" }] };

test("(b) one keep rule: a declared record is kept only when the change edits bytes the base has", () => {
  const dir = repo({ "docs/chips/untouched.md": "u\n", "docs/chips/edited.md": "line one\nline two\n", "docs/chips/appended.md": "a1\n", "docs/chips/deleted-line.md": "k\nx\n", "docs/chips/swapped.md": "s\n", "docs/chips/renamed-old.md": "r\n", "docs/chips/removed.md": "gone\n" }); try {
    config(dir, DENY); git(dir, "add", "-A"); git(dir, "commit", "-qm", "cfg");
    put(dir, "docs/chips/edited.md", "line one\nline TWO changed\n");         // bytes changed: KEPT
    put(dir, "docs/chips/deleted-line.md", "k\n");                           // bytes deleted: KEPT
    put(dir, "docs/chips/appended.md", "a1\na2 appended\n");                  // pure append: dropped
    put(dir, "docs/chips/new-untracked.md", "R1 verdict\n");                  // untracked: dropped
    rmSync(path.join(dir, "docs/chips/swapped.md")); symlinkSync("../keep.md", path.join(dir, "docs/chips/swapped.md")); // symlink swapped in: dropped
    renameSync(path.join(dir, "docs/chips/renamed-old.md"), path.join(dir, "docs/chips/renamed-new.md")); // new path untracked: dropped
    rmSync(path.join(dir, "docs/chips/removed.md"));
    const r = review(dir); assert.ok(r.ran, r.stderr);
    for (const gone of ["untouched", "appended", "new-untracked", "swapped", "renamed-old", "renamed-new", "removed"]) assert.ok(!r.tracked.includes(`docs/chips/${gone}.md`) && !r.disk.includes(`docs/chips/${gone}.md`), `${gone} dropped`);
    for (const kept of ["edited", "deleted-line"]) assert.ok(r.tracked.includes(`docs/chips/${kept}.md`) && r.disk.includes(`docs/chips/${kept}.md`), `${kept} kept (the change edits its existing bytes)`);
    assert.ok(r.tracked.includes("docs/keep.md"));
  } finally { cleanup(dir); }
});

test("(b) glob semantics: * stays in a segment, ** crosses, a bare directory matches beneath it, matching is case-sensitive, a symlink is matched as its own path", () => {
  const files = { "docs/chips/a.md": "a\n", "docs/chips/sub/b.md": "b\n", "docs/other/d.md": "d\n", "notes/rec-1.md": "r1\n", "deep/er/rec-2.md": "r2\n" };
  const run = (globs, mutate = () => {}) => {
    const dir = repo(files); try {
      symlinkSync("a.md", path.join(dir, "docs/chips/link.md")); mutate(dir);
      config(dir, { reviewRecordPaths: globs.map((glob) => ({ glob, reason: "r" })) }); git(dir, "add", "-A"); git(dir, "commit", "-qm", "x");
      const r = review(dir); assert.ok(r.ran, r.stderr); return new Set(r.disk);
    } finally { cleanup(dir); }
  };
  let t = run(["docs/chips/*"]); assert.ok(!t.has("docs/chips/a.md") && !t.has("docs/chips/link.md") && t.has("docs/chips/sub/b.md"), "* does not cross a slash; the symlink is matched by its own path");
  t = run(["docs/chips"]); assert.ok(!t.has("docs/chips/a.md") && !t.has("docs/chips/sub/b.md"), "a directory glob matches beneath it");
  t = run(["**/rec-*.md"]); assert.ok(!t.has("notes/rec-1.md") && !t.has("deep/er/rec-2.md") && t.has("docs/chips/a.md"), "** crosses segments");
  t = run(["docs/other/**"]); assert.ok(!t.has("docs/other/d.md"), "exact-case match dropped");
  t = run(["docs/OTHER/**"]); assert.ok(t.has("docs/other/d.md"), "a wrong-case glob drops nothing");
});

test("(b) a symlinked alias of a record is dropped with it", () => {
  const dir = repo({ "docs/chips/verdict.md": "SECRET-VERDICT\n" }); try {
    config(dir, DENY); symlinkSync("verdict.md", path.join(dir, "docs/chips/alias.md")); git(dir, "add", "-A"); git(dir, "commit", "-qm", "x");
    const r = review(dir); assert.ok(r.ran, r.stderr);
    assert.ok(!r.disk.includes("docs/chips/verdict.md") && !r.disk.includes("docs/chips/alias.md"));
  } finally { cleanup(dir); }
});

for (const [name, body, detail] of [
  ["not JSON", "{ nope", /not valid JSON/],
  ["a JSON array", "[]", /must be a JSON object/],
  ["a JSON null", "null", /must be a JSON object/],
  ["reviewRecordPaths not an array", JSON.stringify({ reviewRecordPaths: "docs/chips/**" }), /must be an array/],
  ["an entry that is not an object", JSON.stringify({ reviewRecordPaths: ["docs/chips/**"] }), /must be an object/],
  ["reason missing", JSON.stringify({ reviewRecordPaths: [{ glob: "docs/chips/**" }] }), /reason must be a non-empty string/],
  ["reason empty", JSON.stringify({ reviewRecordPaths: [{ glob: "docs/chips/**", reason: "  " }] }), /reason must be a non-empty string/],
  ["glob missing", JSON.stringify({ reviewRecordPaths: [{ reason: "r" }] }), /glob must be a non-empty string/],
  ["glob empty", JSON.stringify({ reviewRecordPaths: [{ glob: "", reason: "r" }] }), /glob must be a non-empty string/],
  ["glob with a leading ./", JSON.stringify({ reviewRecordPaths: [{ glob: "./docs/chips/**", reason: "r" }] }), /repo-relative git glob/],
  ["glob with a .. segment", JSON.stringify({ reviewRecordPaths: [{ glob: "docs/../chips/**", reason: "r" }] }), /repo-relative git glob/],
  ["absolute glob", JSON.stringify({ reviewRecordPaths: [{ glob: "/docs/chips/**", reason: "r" }] }), /repo-relative git glob/],
  ["glob carrying pathspec magic", JSON.stringify({ reviewRecordPaths: [{ glob: ":(top)docs", reason: "r" }] }), /repo-relative git glob/],
  ["glob with padding whitespace", JSON.stringify({ reviewRecordPaths: [{ glob: " docs/chips/**", reason: "r" }] }), /whitespace/],
]) {
  test(`(b) fails CLOSED on a malformed reviewRecordPaths: ${name}`, () => {
    const dir = repo({ "docs/chips/old.md": "v\n" }); try {
      config(dir, body); git(dir, "add", "-A"); git(dir, "commit", "-qm", "cfg");
      const r = review(dir);
      assert.equal(r.status, 3, r.stderr); assert.equal(r.ran, false, "the reviewer must never run");
      assert.match(r.stderr, /fail closed/); assert.match(r.stderr, detail);
      assert.equal(git(dir, "for-each-ref", "refs/pil/gate-artifacts"), "", "no frozen artifact ref is left");
    } finally { cleanup(dir); }
  });
}

test("(b) fails CLOSED when kit.config.json is a symlink, a directory, or .claude is a symlink", () => {
  for (const make of [
    (dir) => { put(dir, "elsewhere.json", "{}"); mkdirSync(path.join(dir, ".claude")); symlinkSync("../elsewhere.json", path.join(dir, ".claude/kit.config.json")); },
    (dir) => { mkdirSync(path.join(dir, ".claude/kit.config.json"), { recursive: true }); },
    (dir) => { mkdirSync(path.join(dir, "real-claude")); put(dir, "real-claude/kit.config.json", "{}"); symlinkSync("real-claude", path.join(dir, ".claude")); },
  ]) {
    const dir = repo(); try {
      make(dir); const r = review(dir);
      assert.equal(r.status, 3, r.stderr); assert.equal(r.ran, false); assert.match(r.stderr, /fail closed/);
    } finally { cleanup(dir); }
  }
});

test("(b) a missing config file or a missing key is an empty list", () => {
  for (const setup of [() => {}, (dir) => config(dir, { worktreeRoots: ["/x"] }), (dir) => config(dir, { reviewRecordPaths: [] })]) {
    const dir = repo({ "docs/chips/old.md": "v\n" }); try {
      setup(dir); const r = review(dir); assert.ok(r.ran, r.stderr);
      assert.ok(r.tracked.includes("docs/chips/old.md"), "nothing declared, nothing dropped");
    } finally { cleanup(dir); }
  }
});

test("(b) code mode: the diff and file list never show a dropped record as a deletion", () => {
  const dir = repo({ "src.mjs": "export const a = 1;\n", "docs/chips/verdict.md": "SECRET-VERDICT-TEXT\n" }); try {
    config(dir, DENY); git(dir, "add", "-A"); git(dir, "commit", "-qm", "cfg");
    put(dir, "src.mjs", "export const a = 2;\n");
    writeFileSync(path.join(dir, "docs/chips/verdict.md"), "SECRET-VERDICT-TEXT\nSECRET-APPENDED-TEXT\n"); // pure append
    put(dir, "docs/chips/new-record.mjs", "export const SECRET_UNTRACKED_TEXT = 1;\n");               // untracked code-ish record
    const agy = fakeAgy();
    try {
      const r = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--no-log"], { cwd: dir, encoding: "utf8", env: { ...process.env, GEMINI_AGY_BIN: agy.bin, AGY_DIR: agy.dir, GEMINI_ALLOW_CODE_MODE: "1" } });
      const args = existsSync(path.join(agy.dir, "args")) ? readFileSync(path.join(agy.dir, "args"), "utf8") : null;
      assert.ok(args !== null, r.stderr);
      assert.match(args, /export const a = 2;/, "the real change is reviewed");
      assert.doesNotMatch(args, /SECRET-VERDICT-TEXT|SECRET-APPENDED-TEXT|SECRET_UNTRACKED_TEXT|docs\/chips\/(verdict|new-record)/, "no dropped record (deleted, appended or untracked) reaches the diff payload");
    } finally { rmSync(agy.dir, { recursive: true, force: true }); }
  } finally { cleanup(dir); }
});

test("(b) the slice validator ignores runner-dropped paths (incl. non-ASCII names) only when the runner supplies both inputs", () => {
  const dir = repo({ "docs/chips/Üni.md": "v\n", "docs/chips/plain.md": "v\n" }); try {
    const base = git(dir, "rev-parse", "HEAD");
    rmSync(path.join(dir, "docs/chips/Üni.md")); rmSync(path.join(dir, "docs/chips/plain.md")); put(dir, "docs/design.md", "# design\nedited\n");
    put(dir, "m.json", JSON.stringify({ version: 2, approval: { status: "DRAFT", by: "pm", expected_plan_id: "" }, scope: { base_commit: base, files: ["docs/design.md"] }, uncovered: [], slices: [
      { name: "s1", kind: "coverage", files: ["docs/design.md"], contract_context: ["docs/design.md"], fragments: [] }, { name: "x", kind: "cross_boundary", files: ["docs/design.md"], contract_context: ["docs/design.md"], fragments: [] }] }));
    const dropped = path.join(dir, "..", `dropped-${path.basename(dir)}.nul`); writeFileSync(dropped, "docs/chips/Üni.md\0docs/chips/plain.md\0");
    const run = (env) => spawnSync(process.execPath, ["scripts/gemini-gate-slices.mjs", "fingerprint", "--repo", ".", "--manifest", "m.json"], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    const without = run({}); assert.match(without.stderr, /scope\.files does not equal the actual changed surface/);
    const onlyFile = run({ GEMINI_GATE_DROPPED_PATHS_FILE: dropped }); assert.match(onlyFile.stderr, /scope\.files does not equal/, "the list alone (no runner artifact parent) widens nothing");
    const both = run({ GEMINI_GATE_ARTIFACT_PARENT: base, GEMINI_GATE_DROPPED_PATHS_FILE: dropped }); assert.doesNotMatch(both.stderr, /scope\.files does not equal/, both.stderr);
    rmSync(dropped, { force: true });
  } finally { cleanup(dir); }
});
const sliceSh = readFileSync(path.join(root, "scripts/cold-review-gemini.sh"), "utf8");
test("(b) the runner hands the slice validator the dropped-paths file together with the artifact parent", () => {
  assert.match(sliceSh, /GEMINI_GATE_ARTIFACT_PARENT="\$ARTIFACT_BASE_SHA" GEMINI_GATE_DROPPED_PATHS_FILE="\$FREEZE_DROPPED_FILE"/);
});

test("(b) no other runner builds a review worktree or states a prior review", () => {
  for (const f of ["scripts/codex-gate.sh", "scripts/gemini-frozen-gate.mjs", "scripts/gemini-gate-slices.mjs", "scripts/gemini-gate-supervisor.mjs"]) {
    const t = readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(t, /worktree add/, `${f} builds no review worktree`);
    assert.doesNotMatch(t, /ALREADY (FOUND|reviewed)|assume the same-family panel/, `${f} states no prior review`);
  }
  assert.equal((readFileSync(path.join(root, "scripts/cold-review-gemini.sh"), "utf8").match(/worktree add/g) || []).length, 1, "exactly one review-worktree builder");
});
