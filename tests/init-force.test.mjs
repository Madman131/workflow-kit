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
//   · a lane excluded by a skip flag but PRESENT on disk still gets the read-only stale-keep check;
//   · the core.hooksPath write — git's, not ours — is refused when a SYMLINKED .git resolves the
//     target's git directory into another repository, while a normal repo and a linked
//     `git worktree` adoptee (git dir outside the root, .git a FILE) keep adopting;
//   · the containment check answers BEFORE any mkdir, so a refused write leaves NO directory
//     behind it inside a linked-out `.claude`.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  return { dir, codexDir, run, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
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
    // A directory squatting in the .bak slot is "a prior thing that would be destroyed" to the
    // one-writer saveBackup — the remedy (move it aside) is the same either way.
    assert.match(r.stderr, /prior backup at .+ would be destroyed/, "the refusal is printed at the site");
    assert.match(r.stderr, /1 overwrite\(s\) were REFUSED/, "…and COUNTED into the end-of-run report");
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
    assert.match(refused.stderr, /overwrite\(s\) were REFUSED/, "…and counted into the end-of-run report");
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
    assert.match(r.stderr, /overwrite\(s\) were REFUSED/, "…and the end-of-run report counts it");
    assert.ok(r.stderr.includes(`· ${doc}`), "…naming the [G] file");
    assert.match(readFileSync(doc, "utf8"), /the customer corpus/, "the un-backup-able file is left UNCHANGED");
  } finally { cleanup(); }
});

test("a DANGLING dst symlink is refused on plain AND force runs — never created through", () => {
  // existsSync FOLLOWS links, so a dangling dst symlink read "nothing here", slipped past BOTH the
  // keep gate and the force gate, and the plain write created the link's EXTERNAL target, exit 0.
  // The refusal is hoisted above the gates, so it fires unconditionally.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-force-dangling-"));
  try {
    const guard = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const extTarget = path.join(outside, "never-created.mjs");   // does NOT exist — the link dangles
    rmSync(guard);
    symlinkSync(extTarget, guard);
    assert.ok(!existsSync(guard), "precondition: the dangling link reads as absent to existsSync");

    const plain = run();
    assert.equal(plain.status, 1, "a PLAIN run refuses the dangling link instead of creating its target");
    assert.match(plain.stderr, /is a SYMLINK/);
    assert.ok(plain.stderr.includes(`· ${guard}`), "…and it is counted");
    assert.ok(!existsSync(extTarget), "the external target was NOT created");
    assert.ok(lstatSync(guard).isSymbolicLink(), "the link itself is untouched");

    const forced = run(["--force"]);
    assert.equal(forced.status, 1, "a FORCE run refuses it the same way");
    assert.ok(!existsSync(extTarget), "…still nothing created through the link");

    // Polarity: replace the link with a real file and the plain run completes clean.
    rmSync(guard);
    const clean = run();
    assert.equal(clean.status, 0, `with the link gone the hook reinstalls cleanly: ${clean.stderr}`);
    assert.ok(!lstatSync(guard).isSymbolicLink() && existsSync(guard), "a regular file is back");
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("an INTERMEDIATE directory symlink is refused — the write may not resolve outside the install", () => {
  // With `.claude/hooks` itself a symlink to an external dir, every file inside it is a REGULAR
  // file — the per-dst lstat sees nothing wrong, and both the copy and its .bak landed outside the
  // repo, exit 0. Only the resolved PARENT exposes the escape.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-force-extdir-"));
  try {
    const hooksDir = path.join(dir, ".claude", "hooks");
    rmSync(hooksDir, { recursive: true, force: true });
    symlinkSync(outside, hooksDir);

    const plain = run();
    assert.equal(plain.status, 1, "a plain run refuses to install through the linked directory");
    assert.match(plain.stderr, /resolves OUTSIDE the install target/);
    assert.deepEqual(readdirSync(outside), [], "NOTHING was written into the external directory");

    const forced = run(["--force"]);
    assert.equal(forced.status, 1, "a force run refuses the same way");
    assert.deepEqual(readdirSync(outside), [], "…still nothing outside");

    // Polarity: a real directory in place and the same run completes clean.
    rmSync(hooksDir);
    const clean = run();
    assert.equal(clean.status, 0, `with a real directory the hooks install: ${clean.stderr}`);
    assert.ok(existsSync(path.join(hooksDir, "guard-lane-authoring.mjs")), "…into the repo this time");
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("a SYMLINKED .git refuses the core.hooksPath write — it may not land in ANOTHER repository", () => {
  // `git config` writes into whatever git directory the target RESOLVES to, and that write went
  // through none of this file's protections: no lstat refusal, no containment check, no backup,
  // no accounting. With .git a link into another repo's git dir, init armed THAT repository's
  // commits with this target's .githooks and exited 0. The refusal keys on the LINK, because a
  // linked `git worktree` legitimately keeps its git dir outside the worktree root.
  const home = mkdtempSync(path.join(os.tmpdir(), "kit-force-gitdir-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-force-prompts-"));
  const runInit = (target) => spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", target, "--repo-name", "adopter",
      "--codex-prompts-dir", codexDir, "--skip-codex-lane"],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  const hooksPathOf = (dir) => spawnSync("git", ["-C", dir, "config", "--get", "core.hooksPath"], { encoding: "utf8" });
  try {
    const other = path.join(home, "other");
    const target = path.join(home, "adopter");
    for (const d of [other, target]) execFileSync("git", ["init", "-q", d]);
    const otherConfig = path.join(other, ".git", "config");
    const before = readFileSync(otherConfig, "utf8");
    rmSync(path.join(target, ".git"), { recursive: true, force: true });
    symlinkSync(path.join(other, ".git"), path.join(target, ".git"));

    const r = runInit(target);
    assert.equal(r.status, 1, "an escaping git-dir write is a FAILING state — this run exited 0 before");
    assert.match(r.stderr, /REFUSED to set core\.hooksPath/, "the refusal is printed at the site");
    assert.match(r.stderr, /resolves OUTSIDE the install target/, "…named as the escape it is");
    assert.match(r.stderr, /overwrite\(s\) were REFUSED/, "…and counted into the end-of-run report");
    assert.ok(r.stderr.includes(`· ${path.join(target, ".git")}`), "…which names the link");
    assert.equal(readFileSync(otherConfig, "utf8"), before, "the OTHER repository's config is byte-identical");
    assert.notEqual(hooksPathOf(target).status, 0, "…so core.hooksPath is set nowhere at all");

    // Polarity 1 — a REGULAR .git: the same install sets core.hooksPath and exits 0, so the exit 1
    // above was the escape's and not something general about this target.
    rmSync(path.join(target, ".git"));
    execFileSync("git", ["init", "-q", target]);
    const clean = runInit(target);
    assert.equal(clean.status, 0, `a normal repo is untouched by the refusal: ${clean.stderr}`);
    assert.match(clean.stdout, /core\.hooksPath=\.githooks/, "…and reports the binding");
    assert.equal(hooksPathOf(target).stdout.trim(), ".githooks", "…which really landed");
    assert.equal(readFileSync(otherConfig, "utf8"), before, "…still nothing written to the other repo");

    // Polarity 2 — a real linked worktree, built with git itself. Its git dir IS outside the
    // worktree root (that is what a worktree is), but its .git is a FILE, so a refusal keyed on
    // the git dir's LOCATION would break every worktree adoptee. This one adopts.
    const primary = path.join(home, "primary");
    execFileSync("git", ["init", "-q", primary]);
    execFileSync("git", ["-C", primary, "-c", "user.email=kit@example.invalid", "-c", "user.name=kit",
      "commit", "-q", "--allow-empty", "-m", "base"]);
    const wt = path.join(home, "adoptee-worktree");
    execFileSync("git", ["-C", primary, "worktree", "add", "-q", wt, "-b", "lane"]);
    assert.ok(!lstatSync(path.join(wt, ".git")).isSymbolicLink(), "precondition: a worktree's .git is a FILE");
    const adopted = runInit(wt);
    assert.equal(adopted.status, 0, `a worktree adoptee still adopts cleanly: ${adopted.stderr}`);
    assert.match(adopted.stdout, /core\.hooksPath=\.githooks/, "…binding every lane as before");
    assert.equal(hooksPathOf(wt).stdout.trim(), ".githooks", "…and the setting is readable from the worktree");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
});

test("a linked .claude creates NOTHING outside: the containment check runs BEFORE the mkdir", () => {
  // The check ran AFTER ensureDir, so with `.claude` linked out every FILE write refused while the
  // directory tree was built inside the external target anyway — and settings.json, the one write
  // that had no containment check at all, was created in there beside it.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-force-linked-claude-"));
  try {
    const claude = path.join(dir, ".claude");
    rmSync(claude, { recursive: true, force: true });
    symlinkSync(outside, claude);

    const plain = run();
    assert.equal(plain.status, 1, "the escape fails the run");
    assert.deepEqual(readdirSync(outside), [], "not one file OR DIRECTORY was created outside the install");
    assert.match(plain.stderr, /resolves OUTSIDE the install target/, "…refused with the containment vocabulary");
    assert.ok(plain.stderr.includes(`REFUSED to write ${path.join(claude, "settings.json")}`),
      "…the registrations merge is refused too, not written into someone else's directory");
    assert.match(plain.stderr, /overwrite\(s\) were REFUSED/, "…and the refusals are counted");
    assert.ok(plain.stderr.includes(`· ${path.join(claude, "hooks", "guard-lane-authoring.mjs")}`), "…named one by one");

    const forced = run(["--force"]);
    assert.equal(forced.status, 1, "--force refuses the same way");
    assert.deepEqual(readdirSync(outside), [], "…still nothing outside");

    // Polarity: with a real directory in place the same run installs into the repo.
    rmSync(claude);
    const clean = run();
    assert.equal(clean.status, 0, `with a real .claude the install completes: ${clean.stderr}`);
    assert.ok(existsSync(path.join(claude, "hooks", "guard-lane-authoring.mjs")), "the hooks land inside the repo");
    assert.ok(existsSync(path.join(claude, "settings.json")), "…and so do the registrations");
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("a linked .codex creates NOTHING outside either — the eager agents-dir mkdir is guarded too", () => {
  // The Codex lane creates `.codex/agents` EAGERLY (so an unwritable lane fails at that line rather
  // than deep in the template loop) — a mkdir ahead of every containment check, which built a
  // directory inside the external target the copies beside it then refused.
  const { dir, run, cleanup } = adopt();   // codex lane ENABLED
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-force-linked-codex-"));
  try {
    const codex = path.join(dir, ".codex");
    rmSync(codex, { recursive: true, force: true });
    symlinkSync(outside, codex);

    const r = run();
    assert.equal(r.status, 1, "the escape fails the run");
    assert.deepEqual(readdirSync(outside), [], "no agents/ directory — nothing at all — outside the install");
    assert.match(r.stderr, /resolves OUTSIDE the install target/, "…refused with the containment vocabulary");
    assert.match(r.stderr, /overwrite\(s\) were REFUSED/, "…and counted");

    // Polarity: a real directory back in place and the lane installs into the repo.
    rmSync(codex);
    const clean = run();
    assert.equal(clean.status, 0, `with a real .codex the lane installs: ${clean.stderr}`);
    assert.ok(existsSync(path.join(codex, "hooks", "guard-lane-authoring.mjs")), "the lane's hooks are inside the repo");
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("a PARSEABLE settings.json is never written through a symlink, and a changing force-merge backs it up", () => {
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-force-settings-"));
  try {
    const settings = path.join(dir, ".claude", "settings.json");
    // (a) symlinked settings: the parse-OK branch wrote unconditionally, so the link's EXTERNAL
    // target was rewritten — no .bak, exit 0, on plain and force runs alike.
    const extSettings = path.join(outside, "their-settings.json");
    const extBytes = JSON.stringify({ theirs: true }, null, 2) + "\n";
    writeFileSync(extSettings, extBytes);
    const realBytes = readFileSync(settings, "utf8");
    rmSync(settings);
    symlinkSync(extSettings, settings);

    const plain = run();
    assert.equal(plain.status, 0, `a plain run warns but does not fail: ${plain.stderr}`);
    assert.match(plain.stderr, /is a SYMLINK \(resolves to /, "…and the warning prints the RESOLVED target");
    assert.ok(plain.stderr.includes(realpathSync(extSettings)), "…by its real path");
    assert.equal(readFileSync(extSettings, "utf8"), extBytes, "the linked file was NOT rewritten (plain)");

    const forced = run(["--force"]);
    assert.equal(forced.status, 1, "under --force the refusal is counted and fails the run");
    assert.ok(forced.stderr.includes(`· ${settings}`), "…named in the end-of-run report");
    assert.equal(readFileSync(extSettings, "utf8"), extBytes, "the linked file was NOT rewritten (force)");

    // (b) a regular settings.json whose bytes the force-merge CHANGES is backed up first…
    rmSync(settings);
    const preMerge = JSON.stringify({ env: { KEEP_ME: "1" } }, null, 2) + "\n";
    writeFileSync(settings, preMerge);
    const merged = run(["--force"]);
    assert.equal(merged.status, 0, merged.stderr);
    assert.equal(readFileSync(`${settings}.bak`, "utf8"), preMerge, "the pre-merge bytes are in the .bak");
    const after = JSON.parse(readFileSync(settings, "utf8"));
    assert.equal(after.env?.KEEP_ME, "1", "…and the merge still PRESERVES the adopter's own settings");
    assert.ok(after.hooks.PreToolUse.some((g) => (g.hooks || []).some((h) => String(h.command).includes("guard-lane-authoring.mjs"))),
      "…alongside the kit's registrations");

    // …and an IDENTICAL re-merge writes nothing: no second backup, the existing (differing) .bak
    // is neither touched nor refused — no noise on the idempotent rerun.
    const again = run(["--force"]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(`${settings}.bak`, "utf8"), preMerge, "the prior .bak is untouched by an identical merge");
    void realBytes;
  } finally { cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("a second --force never destroys the only backup: a differing prior .bak refuses; identical is idempotent", () => {
  // The reproduction: force #1 preserves the hand edit in .bak; force #2 (with different flags or a
  // newer hand edit) re-backed-up the CURRENT file over it — both runs exit 0 and the only copy of
  // the original edit is gone. Now a prior .bak whose bytes differ from what this run would save
  // there is never overwritten.
  const { dir, run, cleanup } = adopt(["--skip-codex-lane"]);
  try {
    // The [G] path (backupBeforeOverwrite → saveBackup).
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const v1 = readFileSync(doc, "utf8").replace("{{OWNER_PROFILE}}", "profile ONE");
    writeFileSync(doc, v1);
    let r = run(["--force"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(`${doc}.bak`, "utf8"), v1, "force #1 preserved the hand edit");

    const v2 = readFileSync(doc, "utf8").replace("{{OWNER_PROFILE}}", "profile TWO");
    writeFileSync(doc, v2);
    r = run(["--force"]);
    assert.equal(r.status, 1, "force #2 REFUSES rather than destroy the only copy of edit ONE");
    assert.match(r.stderr, /prior backup at .+ would be destroyed/);
    assert.ok(r.stderr.includes(`· ${doc}`), "…counted and named");
    assert.equal(readFileSync(`${doc}.bak`, "utf8"), v1, "the .bak still holds the FIRST hand edit");
    assert.equal(readFileSync(doc, "utf8"), v2, "…and the doc itself is untouched too");

    // Idempotence: when the current bytes MATCH the prior .bak, the backup is already in place and
    // the run completes clean.
    writeFileSync(doc, v1);
    r = run(["--force"]);
    assert.equal(r.status, 0, `an identical prior .bak is idempotent: ${r.stderr}`);
    assert.equal(readFileSync(`${doc}.bak`, "utf8"), v1, "…and it is left exactly as it was");

    // The copyGuarded path pays the same rule (mechanism hook, two successive hand edits).
    const guard = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const kitGuard = readFileSync(path.join(KIT, "hooks", "guard-lane-authoring.mjs"), "utf8");
    writeFileSync(guard, kitGuard + "// edit A\n");
    r = run(["--force"]);
    assert.equal(r.status, 0, r.stderr);
    writeFileSync(guard, kitGuard + "// edit B\n");
    r = run(["--force"]);
    assert.equal(r.status, 1, "the copy path refuses the clobber the same way");
    assert.equal(readFileSync(`${guard}.bak`, "utf8"), kitGuard + "// edit A\n", "edit A survives");
    assert.equal(readFileSync(guard, "utf8"), kitGuard + "// edit B\n", "edit B untouched");
  } finally { cleanup(); }
});

test("every skip-excluded mechanism family gets the read-only stale check: runners, prompt shims, armed probe", () => {
  // The .codex/hooks check landed first; three families still escaped it: gate runners present
  // while --with-gate-runners is omitted, the two MECHANISM prompt shims under --skip-codex-prompt,
  // and the armed probe under --skip-codex-lane. Same rule for all three — read-only, absent or
  // identical is silent, a differing keep is KEPT BUT STALE and fails the run.
  const { dir, codexDir, run, cleanup } = adopt();   // codex lane + prompts installed
  const SKIPS = ["--skip-codex-prompt", "--skip-codex-lane"];   // runners are excluded by default
  try {
    // Baseline: everything absent-or-identical under all three exclusions ⇒ silent, exit 0.
    let r = run(SKIPS);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /KEPT BUT STALE/, "absent/identical skipped families stay silent");

    // Plant a differing keep in each family — plus a NON-mechanism prompt as the negative control.
    const runner = path.join(dir, "scripts", "codex-gate.sh");
    writeFileSync(runner, readFileSync(path.join(KIT, "scripts", "codex-gate.sh"), "utf8") + "# drift\n");
    const shim = path.join(codexDir, "orchestrate.md");
    const shimDrift = readFileSync(shim, "utf8") + "<!-- drift -->\n";
    writeFileSync(shim, shimDrift);
    const probe = path.join(dir, "scripts", "check-codex-hooks-armed.mjs");
    writeFileSync(probe, readFileSync(probe, "utf8") + "// drift\n");
    const personal = path.join(codexDir, "humanize.md");
    writeFileSync(personal, readFileSync(personal, "utf8") + "<!-- adopter-owned -->\n");

    r = run(SKIPS);
    assert.equal(r.status, 1, "differing keeps in skipped families fail the run");
    for (const p of [runner, shim, probe]) {
      assert.ok(r.stderr.includes(p), `${p} is named`);
    }
    assert.equal((r.stderr.match(/KEPT BUT STALE/g) || []).length, 3, "…exactly the three mechanism keeps, no more");
    assert.ok(!r.stderr.includes(personal), "the adopter-owned personal prompt is NOT flagged");
    assert.equal(readFileSync(shim, "utf8"), shimDrift, "the check is READ-ONLY (the drifted shim was not rewritten)");

    // Polarity: bring each back to kit bytes and the same skipped run is clean again.
    writeFileSync(runner, readFileSync(path.join(KIT, "scripts", "codex-gate.sh")));
    writeFileSync(shim, readFileSync(path.join(KIT, "skill-shims", "codex", "orchestrate.md")));
    writeFileSync(probe, readFileSync(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs")));
    r = run(SKIPS);
    assert.equal(r.status, 0, `identical skipped families are silent again: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /KEPT BUT STALE/);
  } finally { cleanup(); }
});
