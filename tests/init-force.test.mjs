// workflow-kit — the --force exit contract (BB init hardening). Three behaviors, each pinned in
// BOTH polarities so reverting any one turns an assertion red:
//   · a refused .bak backup is a COUNTED failure — exit 1 and named in the end-of-run report —
//     never a warning scrolled past while the run exits 0 claiming an upgrade it did not deliver;
//   · the backup-before-overwrite is UNIFORM: ANY differing file init would overwrite under
//     --force gets a .bak first, convenience class included, not just the mechanism set;
//   · a post-force armed-check that does not pass FAILS the run (the upgraded Codex hooks are
//     CURRENT-BUT-DISARMED, and exit 0 there is manufactured assurance).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `codex` deliberately OFF the PATH: any --force over a codex-lane adopter would otherwise spend a
// real model call in the armed-check, and its verdict would track this machine's codex auth state
// rather than the code under test. node and git stay reachable.
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);

function adopt(extra = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-force-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-force-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  const run = (args = []) => spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...extra, ...args],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  const first = run();
  assert.equal(first.status, 0, `fresh adopt failed: ${first.stderr}`);
  return { dir, run, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("a refused mechanism backup under --force is COUNTED: exit 1, named in the report, file untouched", () => {
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  try {
    const guard = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const drifted = readFileSync(guard, "utf8") + "\n// local edit\n";
    writeFileSync(guard, drifted);
    mkdirSync(`${guard}.bak`);   // a directory here makes the backup copy fail
    const r = run(["--force"]);
    assert.equal(r.status, 1, "a refused backup must FAIL the run — before this contract it warned and exited 0");
    assert.match(r.stderr, /REFUSED: could not back up/, "the refusal is printed at the site");
    assert.match(r.stderr, /1 --force overwrite\(s\) were REFUSED/, "…and COUNTED into the end-of-run report");
    assert.ok(r.stderr.includes(`· ${guard}`), "…which names the refused file");
    assert.equal(readFileSync(guard, "utf8"), drifted, "the refused file is UNTOUCHED — old content, no half-upgrade");

    // The other polarity: clear the blocker and the SAME forced run completes clean, proving the
    // exit 1 above was the refusal's and not something general about --force.
    rmSync(`${guard}.bak`, { recursive: true, force: true });
    const clean = run(["--force"]);
    assert.equal(clean.status, 0, `a clean --force run exits 0: ${clean.stderr}`);
    assert.doesNotMatch(clean.stderr, /were REFUSED/, "no refusal report on a clean run");
    assert.equal(readFileSync(`${guard}.bak`, "utf8"), drifted, "the backup that could not be taken before is taken now");
    assert.equal(readFileSync(guard, "utf8"), readFileSync(path.join(KIT, "hooks", "guard-lane-authoring.mjs"), "utf8"),
      "…and the overwrite then delivers the kit's bytes");
  } finally { cleanup(); }
});

test("the backup is UNIFORM: a differing NON-mechanism file gets a .bak under --force too", () => {
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  try {
    // Two convenience-class files (`mechanism: false` in init): the Claude /thread-restart command
    // and the personal /humanize body. Before this contract only mechanism files were backed up,
    // so --force destroyed the only copy of an adopter's edit to either of these.
    const cmd = path.join(dir, ".claude", "commands", "thread-restart.md");
    const body = path.join(dir, ".agents", "skills", "humanize", "SKILL.md");
    const edits = {};
    for (const f of [cmd, body]) { edits[f] = readFileSync(f, "utf8") + "\n<!-- local edit -->\n"; writeFileSync(f, edits[f]); }
    const r = run(["--force"]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of [cmd, body]) {
      assert.equal(readFileSync(`${f}.bak`, "utf8"), edits[f], `${f} gets a .bak holding the adopter's edited version`);
    }
    assert.equal(readFileSync(cmd, "utf8"), readFileSync(path.join(KIT, "commands", "claude", "thread-restart.md"), "utf8"),
      "the file itself is the kit's version again");
    assert.equal(readFileSync(body, "utf8"), readFileSync(path.join(KIT, "skills", "humanize", "SKILL.md"), "utf8"),
      "…both classes");
    // No backup NOISE: an IDENTICAL kept file gets no .bak — backups exist for differing files
    // only, or every --force rerun would litter the tree and bury the one .bak that matters.
    assert.ok(!existsSync(path.join(dir, ".claude", "skills", "humanize", "SKILL.md.bak")),
      "an untouched convenience file (the humanize shim) gets NO .bak");
  } finally { cleanup(); }
});

test("a post-force armed-check that does not pass FAILS the run — and still prints the guidance", () => {
  const { dir, run, cleanup } = adopt();   // codex lane ENABLED — the armed-check exists and runs
  try {
    // Control first: a PLAIN re-run over the pristine adopter exits 0, so the failure below is the
    // armed-check's own (it only runs after --force), not something general about re-runs.
    const plain = run();
    assert.equal(plain.status, 0, plain.stderr);
    const r = run(["--force"]);
    assert.equal(r.status, 1, "an unverified armed state after --force is a FAILING state, not a warning");
    assert.match(r.stderr, /NOT verified armed/, "the guidance still prints");
    assert.match(r.stderr, /check-codex-hooks-armed\.mjs/, "…and names the check to re-run after re-trusting");
    // …and the exit code is the armed-check's doing: the same --force over the same tree with the
    // Codex lane skipped runs no armed-check and exits 0.
    const skipped = run(["--force", "--skip-codex-lane"]);
    assert.equal(skipped.status, 0, skipped.stderr);
  } finally { cleanup(); }
});

test("a refused [G] backup is the SAME failing state — counted into the report, exit 1", () => {
  // The [G] path (writeWithBackup) refused honestly before but still exited 0, so a --force run
  // could leave a MIXED tree — regenerated docs beside one stale, un-backed-up doc — while
  // reporting success at the exit code, the one place scripts look. Same accounting, both paths.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const edited = readFileSync(doc, "utf8").replace("{{IRREVERSIBLE_ASSET}}", "the customer corpus");
    writeFileSync(doc, edited);
    mkdirSync(`${doc}.bak`);   // a directory here makes the backup write fail
    const r = run(["--force"]);
    assert.equal(r.status, 1, "a refused [G] backup fails the run like a refused copy backup");
    assert.match(r.stderr, /REFUSED to overwrite/, "the refusal is printed at the site");
    assert.match(r.stderr, /generation is INCOMPLETE/, "the mixed-tree warning is unchanged");
    assert.match(r.stderr, /--force overwrite\(s\) were REFUSED/, "…and the end-of-run report counts it");
    assert.ok(r.stderr.includes(`· ${doc}`), "…naming the [G] file");
    assert.match(readFileSync(doc, "utf8"), /the customer corpus/, "the un-backup-able file is left UNCHANGED");
  } finally { cleanup(); }
});
