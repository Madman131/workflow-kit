// workflow-kit — the --force exit contract (BB init hardening + the R3 init findings). Each
// behavior is pinned in BOTH polarities so reverting any one turns an assertion red:
//   · a refused .bak backup is a COUNTED failure — exit 1 and named in the end-of-run report —
//     never a warning scrolled past while the run exits 0 claiming an upgrade it did not deliver;
//   · the backup-before-overwrite is UNIFORM: ANY differing file init would overwrite under
//     --force gets a .bak first, convenience class included, not just the mechanism set;
//   · a post-force armed-check that does not pass FAILS the run (the upgraded Codex hooks are
//     CURRENT-BUT-DISARMED, and exit 0 there is manufactured assurance);
//   · a SYMLINK at an overwrite target or its .bak slot refuses rather than writing through;
//   · an unparseable settings.json under --force is backed up byte-for-byte before replacement;
//   · a lane excluded by a skip flag but PRESENT on disk still gets the read-only stale-keep check.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("--force never writes THROUGH a symlink: a link at dst or in the .bak slot refuses, counted", () => {
  // lstat-refusal in BOTH overwrite paths. existsSync/readFileSync FOLLOW links, so before this
  // check a symlinked dst read as an ordinary differing file: the "backup" copied the link's
  // target beside it and the overwrite then wrote the kit's bytes INTO the external target —
  // outside the install, exit 0. A symlink squatting in the .bak slot inverted the same hole:
  // the adopter's bytes were "preserved" into someone else's file.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-force-outside-"));
  try {
    const guard = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const kitGuard = readFileSync(path.join(KIT, "hooks", "guard-lane-authoring.mjs"), "utf8");

    // Polarity 1 — dst IS a symlink (the copyGuarded path).
    const extTarget = path.join(outside, "target.mjs");
    writeFileSync(extTarget, "// external payload\n");
    rmSync(guard);
    symlinkSync(extTarget, guard);
    let r = run(["--force"]);
    assert.equal(r.status, 1, "a symlinked dst is REFUSED, and the refusal fails the run");
    assert.match(r.stderr, /is a SYMLINK/, "…named as the symlink refusal, not a generic backup failure");
    assert.ok(r.stderr.includes(`· ${guard}`), "…and counted into the end-of-run report");
    assert.equal(readFileSync(extTarget, "utf8"), "// external payload\n", "the link's TARGET was not written through");
    assert.ok(lstatSync(guard).isSymbolicLink(), "the link itself is untouched");

    // Polarity 2 — dst is a regular differing file, but a symlink squats in its .bak slot.
    rmSync(guard);
    const drifted = kitGuard + "\n// local edit\n";
    writeFileSync(guard, drifted);
    const extBak = path.join(outside, "bak-target");
    writeFileSync(extBak, "// bak payload\n");
    symlinkSync(extBak, `${guard}.bak`);
    r = run(["--force"]);
    assert.equal(r.status, 1, "a symlinked .bak slot is REFUSED the same way");
    assert.match(r.stderr, /is a SYMLINK/);
    assert.equal(readFileSync(extBak, "utf8"), "// bak payload\n", "the adopter's bytes were NOT 'preserved' into the link's target");
    assert.equal(readFileSync(guard, "utf8"), drifted, "…and the differing file is untouched (no half-upgrade)");
    rmSync(`${guard}.bak`);

    // Polarity 3 — the [G] path (writeWithBackup): a symlinked generated doc refuses too.
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const extDoc = path.join(outside, "oc.md");
    writeFileSync(extDoc, "external OC\n");
    rmSync(doc);
    symlinkSync(extDoc, doc);
    r = run(["--force"]);
    assert.equal(r.status, 1, "a symlinked [G] doc is REFUSED through the same accounting");
    assert.match(r.stderr, /is a SYMLINK/);
    assert.equal(readFileSync(extDoc, "utf8"), "external OC\n", "the [G] regeneration did not write through the link");
    rmSync(doc);

    // Regular files keep the prior behavior: with every link gone the same forced run backs up the
    // differing guard and completes clean.
    const clean = run(["--force"]);
    assert.equal(clean.status, 0, `regular files are unchanged by the symlink refusal: ${clean.stderr}`);
    assert.equal(readFileSync(`${guard}.bak`, "utf8"), drifted, "the differing regular file still gets its .bak");
    assert.equal(readFileSync(guard, "utf8"), kitGuard, "…and the kit's bytes land");
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("an unparseable settings.json under --force is backed up byte-for-byte, never silently destroyed", () => {
  // The ONE overwrite path that bypassed the backup machinery: mergeSettings' --force branch set
  // `existing = {}` (the warn is gated on !force) and wrote the merged file unconditionally — an
  // adopter-owned unparseable settings.json was destroyed with no .bak, exit 0, and a "merged
  // (verified by read-back)" log line saying everything went fine.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  try {
    const settings = path.join(dir, ".claude", "settings.json");
    const corrupt = "NOT JSON{ adopter bytes nothing here can merge";
    writeFileSync(settings, corrupt);

    // Plain rerun: unchanged behavior — warn, leave it, no .bak.
    const plain = run();
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stderr, /not valid JSON — left untouched/);
    assert.equal(readFileSync(settings, "utf8"), corrupt, "a plain rerun leaves the corrupt file alone");
    assert.ok(!existsSync(`${settings}.bak`), "…and takes no backup it did not need");

    // --force: the ORIGINAL bytes go to .bak before the fresh registrations are written.
    const forced = run(["--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(readFileSync(`${settings}.bak`, "utf8"), corrupt, "the .bak holds the original bytes exactly");
    const merged = JSON.parse(readFileSync(settings, "utf8"));
    assert.ok(merged.hooks.PreToolUse.some((g) => (g.hooks || []).some((h) => String(h.command).includes("guard-lane-authoring.mjs"))),
      "…and the regenerated file carries the registrations");
    assert.match(forced.stderr, /not valid JSON, so nothing could be merged/, "the replacement is disclosed, with the .bak named");

    // A backup that cannot be taken refuses the replacement — same accounting as every overwrite.
    writeFileSync(settings, corrupt);
    rmSync(`${settings}.bak`);
    mkdirSync(`${settings}.bak`);   // a directory here makes the backup write fail
    const refused = run(["--force"]);
    assert.equal(refused.status, 1, "a refused settings backup fails the run");
    assert.match(refused.stderr, /REFUSED to replace/, "…named at the site");
    assert.match(refused.stderr, /--force overwrite\(s\) were REFUSED/, "…and counted into the end-of-run report");
    assert.equal(readFileSync(settings, "utf8"), corrupt, "the corrupt file is UNCHANGED rather than destroyed");
  } finally { cleanup(); }
});

test("--skip-codex-lane over a PRESENT lane still runs the read-only stale-keep check", () => {
  // The stale-keep accounting, the drift check and the armed check all lived inside the skipped
  // block, so `--force --skip-codex-lane` over a drifted .codex exited 0 saying only "left
  // untouched" — while that lane kept enforcing with old guards. The comparison is READ-ONLY:
  // nothing in the skipped lane is written, and no armed check fires (this run changed no hook).
  // The absent-lane polarity — skip over NO .codex stays silent, exit 0 — is pinned by every
  // other test in this file, whose adopters skip the lane from the first run.
  const { dir, run, cleanup } = adopt();   // codex lane ENABLED at adopt
  try {
    // Byte-identical lane: the skip stays silent and the forced run completes clean.
    const identical = run(["--force", "--skip-codex-lane"]);
    assert.equal(identical.status, 0, identical.stderr);
    assert.doesNotMatch(identical.stderr, /KEPT BUT STALE/, "an identical skipped lane is not a stale keep");

    // Drifted lane: the skip still names the stale keep and fails the run.
    const laneHook = path.join(dir, ".codex", "hooks", "guard-lane-authoring.mjs");
    const driftedLane = readFileSync(laneHook, "utf8") + "// drift\n";
    writeFileSync(laneHook, driftedLane);
    const r = run(["--force", "--skip-codex-lane"]);
    assert.equal(r.status, 1, "a drifted skipped lane is a stale install, not a clean exit");
    assert.match(r.stderr, /KEPT BUT STALE/, "…named with the stale-keep vocabulary");
    assert.ok(r.stderr.includes(laneHook), "…and the .codex path is named");
    assert.match(r.stderr, /WITHOUT the skip/, "the remedy names the skip — --force alone cannot reach an excluded lane");
    assert.equal(readFileSync(laneHook, "utf8"), driftedLane, "the check is READ-ONLY: the skipped lane was not written");
    assert.doesNotMatch(r.stderr, /NOT verified armed/, "no armed check fires for a lane this run did not touch");
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
