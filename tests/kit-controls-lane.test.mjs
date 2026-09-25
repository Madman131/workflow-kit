// workflow-kit — control suite, part: the installed lane and ledger controls. Tier declarations in
// both controls, a stale [P] control on a plain re-run, the ledger's UPGRADE row, and the gate-ladder
// sensor's reported cause. Split out of tests/kit-controls.test.mjs so the suite's files run in
// parallel; the test bodies are unchanged.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { adopt, HERMETIC_ENV } from "./kit-controls-helpers.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("exempt declares a TIER (v1.5.0): tier-less is blocked in BOTH controls, not grandfathered", () => {
  // `exempt` was the one route carrying no tier, so a reason set entirely about review-SEAT
  // availability selected the mode that skipped tier declaration. Both layers, both directions.
  const { dir, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const guard = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const decl = path.join(dir, ".claude", "task-lane.json");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    const write = (obj) => writeFileSync(decl, JSON.stringify(obj) + "\n");
    const guardSays = () => {
      const r = spawnSync("node", [guard], {
        cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        input: JSON.stringify({ session_id: "s1", tool_input: { file_path: "src/x.mjs" } }),
      });
      assert.equal(r.status, 0, `the guard must exit 0, got ${r.status}: ${r.stderr}`);
      return r.stdout;
    };
    const base = { mode: "exempt", sessionId: "s1", taskId: "tier-task", reason: "codex-down" };

    // WRITE-TIME: the pre-v1.5 shape blocks, with its own state and a message naming the field.
    write(base);
    const tierless = guardSays();
    assert.match(tierless, /"permissionDecision":"deny"/, "a tier-less exemption is BLOCKED (not grandfathered)");
    assert.match(tierless, /exempt-tier-missing/, "…via an explicit state, not a generic malformed");
    // BOTH POLARITIES, one honest string. This ONE state covers an ABSENT tier and a PRESENT-but-
    // invalid one; the old text asserted only "MISSING its `tier`", which is FALSE against a file
    // visibly carrying `tier:"T9"` — a control that misdescribes its input trains readers to
    // discount it. Deliberately NOT asserting on the `"tier":"T0"|…` literal: that already appears
    // in the generic remediation template emitted for EVERY deny state, so it survives deleting the
    // whole exempt-tier-missing block. `MISSING OR INVALID` is the string that discriminates.
    assert.match(tierless, /MISSING OR INVALID/, "…and the remediation admits BOTH polarities");
    // …and every valid tier permits the same write (no over-block).
    for (const tier of ["T0", "T1", "T2", "T3"]) {
      write({ ...base, tier });
      assert.doesNotMatch(guardSays(), /"permissionDecision":"deny"/, `exempt + ${tier} is permitted`);
    }
    for (const bogus of ["T9", "t2"]) {
      write({ ...base, tier: bogus });
      const invalid = guardSays();
      assert.match(invalid, /"permissionDecision":"deny"/, `an invalid tier (${bogus}) is blocked`);
      assert.match(invalid, /MISSING OR INVALID/,
        `…and the block does NOT claim the tier is missing from a file carrying ${bogus}`);
    }
    // The hash covers the tier, so re-tiering an exemption is visible in the ledger as a new hash.
    const hashFor = (tier) => {
      writeFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "");
      write({ ...base, tier });
      guardSays();
      const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8").trim().split("\n");
      return JSON.parse(rows.at(-1)).declarationHash;
    };
    assert.notEqual(hashFor("T0"), hashFor("T3"), "the declarationHash covers the tier (a re-tier is visible)");

    // THE LEDGER'S NAMED CONSUMER IS THE OWNER'S SPOT-CHECK, who cannot read a hash. An ALLOW row
    // records the tier in CLEAR TEXT (the hash still covers it); a DENY records the value it
    // rejected, or the trail asserts "missing" about a declaration that visibly carried one.
    const ledger = path.join(dir, ".claude", "lane-ledger.jsonl");
    const rows = () => readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((r) => JSON.parse(r));
    writeFileSync(ledger, "");
    write({ ...base, tier: "T2" });
    guardSays();
    assert.equal(rows().at(-1).tier, "T2", "an exempt ALLOW row carries the clear-text tier");
    assert.equal(rows().at(-1).state, "exempt", "…on the exempt state");
    // Absent THEN invalid, same state/decision/task/session/path and no hash on either. Without
    // `declaredTier` in the DEDUPE KEY the second row is swallowed as a repeat and the trail loses
    // the only field that distinguishes a tier-less deny from a T9 deny.
    writeFileSync(ledger, "");
    write(base);              // absent
    guardSays();
    write({ ...base, tier: "T9" });   // present but invalid
    guardSays();
    const denies = rows().filter((r) => r.state === "exempt-tier-missing");
    assert.equal(denies.length, 2, "an absent-tier deny and a T9 deny are TWO rows, not one deduped row");
    assert.equal(denies[0].declaredTier, undefined, "the ABSENT-tier deny records no value");
    assert.equal(denies[1].declaredTier, "T9", "the INVALID-tier deny records the value it rejected");
    // A NON-STRING tier was PRESENT and rejected. Recording nothing would make it indistinguishable
    // from a genuinely tier-less declaration — and it would then be deduped away against one, which
    // is the swallow this field exists to prevent, one TYPE over.
    writeFileSync(ledger, "");
    write(base);                       // absent
    guardSays();
    write({ ...base, tier: 7 });       // present, wrong type
    guardSays();
    const typed = rows().filter((r) => r.state === "exempt-tier-missing");
    assert.equal(typed.length, 2, "an absent-tier deny and a NUMERIC-tier deny are TWO rows");
    assert.equal(typed[1].declaredTier, "7 (number)", "a present non-string tier is recorded WITH its type, not dropped as absent");
    // …and a STRING "7" is a different declaration, so it must not dedupe against the number 7.
    write({ ...base, tier: "7" });
    guardSays();
    const bothSevens = rows().filter((r) => r.state === "exempt-tier-missing");
    assert.equal(bothSevens.length, 3, "the number 7 and the string \"7\" are DIFFERENT rejected values");
    assert.equal(bothSevens[2].declaredTier, "7", "…the string form is recorded verbatim");
    // …and two DIFFERENT over-long values must not collide into one row through truncation, which
    // is the same swallow one LENGTH over.
    writeFileSync(ledger, "");
    const long = (suffix) => `${"a".repeat(40)}${suffix}`;
    write({ ...base, tier: long("X") });
    guardSays();
    write({ ...base, tier: long("Y") });
    guardSays();
    const longRows = rows().filter((r) => r.state === "exempt-tier-missing");
    assert.equal(longRows.length, 2, "two distinct over-long tiers are TWO rows (truncation must not collide)");
    assert.notEqual(longRows[0].declaredTier, longRows[1].declaredTier,
      "…and they are recorded as DIFFERENT values");
    for (const row of longRows) {
      assert.ok(row.declaredTier.length < 120, "a recorded tier stays bounded (unvalidated input in an audit file)");
      assert.match(row.declaredTier, /truncated/, "…and truncation is marked, not silent");
    }
    // NEGATIVE CONTROL for the clear-text tier: `tier` belongs on the exempt ALLOW row and nowhere
    // else. Without this, production could attach it to every row carrying one — including these
    // deny rows — and the positive assertion above would still pass.
    // Build a ledger that actually CONTAINS every row shape before asserting field scoping — an
    // "every row satisfies X" check over rows of one state is vacuous, which is the very failure
    // these negative controls exist to catch (a first draft of this block was exactly that, and a
    // mutation leaking `declaredTier` onto every state walked straight through it).
    writeFileSync(ledger, "");
    write({ ...base, tier: "T2" });   // exempt ALLOW  — carries tier, must NOT carry declaredTier
    guardSays();
    write({ ...base, tier: "T9" });   // exempt deny   — carries declaredTier, must NOT carry tier
    guardSays();
    writeFileSync(decl, JSON.stringify({ mode: "in-thread", sessionId: "s1", taskId: "tier-task", tier: "T3" }) + "\n");
    guardSays();                      // in-thread ALLOW — neither field
    writeFileSync(decl, JSON.stringify({ mode: "lane", sessionId: "s1", taskId: "tier-task" }) + "\n");
    guardSays();                      // lane-retired deny — neither field
    const shapes = rows();
    assert.ok(shapes.some((r) => r.state === "exempt") && shapes.some((r) => r.state === "exempt-tier-missing") &&
      shapes.some((r) => r.state === "in-thread:T3") && shapes.some((r) => r.state === "lane-retired"),
      "the scoping assertions below run against a ledger holding all four row shapes");
    assert.ok(shapes.every((r) => (r.state === "exempt") === (r.tier !== undefined)),
      "`tier` appears on exempt ALLOW rows and nowhere else");
    assert.ok(shapes.every((r) => (r.state === "exempt-tier-missing" && r.declaredTier !== undefined) ||
      (r.state !== "exempt-tier-missing" && r.declaredTier === undefined)),
      "`declaredTier` appears on tier-rejecting DENY rows and nowhere else (it feeds the dedupe key)");

    // COMMIT-TIME: the every-lane floor requires it too.
    const commit = (msg) => spawnSync("git", ["-C", dir, "commit", "-q", "-m", msg], { encoding: "utf8" });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    write({ ...base, tier: "T1" });
    assert.equal(commit("baseline").status, 0, "baseline commit with a tiered exemption succeeds");
    writeFileSync(path.join(dir, "src", "y.mjs"), "export const y = 1;\n");
    execFileSync("git", ["-C", dir, "add", "src/y.mjs"]);
    write(base);   // tier-less again
    const blocked = commit("tier-less exempt");
    assert.notEqual(blocked.status, 0, "commit floor: a tier-less exemption BLOCKS a code commit");
    assert.match(blocked.stderr, /without a valid tier/, "…and the block names the tier field");
    // The commit floor told the SAME lie as the write-time guard: "without a tier" against a file
    // carrying `tier:"T9"`. Both layers now admit both polarities.
    write({ ...base, tier: "T9" });
    const invalidCommit = commit("invalid-tier exempt");
    assert.notEqual(invalidCommit.status, 0, "commit floor: an INVALID tier blocks too");
    assert.match(invalidCommit.stderr, /MISSING OR INVALID/,
      "…and the block does not claim the tier is missing from a file carrying T9");
    write({ ...base, tier: "T1" });
    assert.equal(commit("tiered exempt").status, 0, "the SAME commit passes once the tier is declared");
  } finally { cleanup(); }
});

test("a plain init re-run KEEPS a stale installed [P] control and FAILS, naming --force", () => {
  // A control fix reaches an adopter only through the instruction the release note gives them.
  // `init` never overwrites a file it did not write this run — and since v2.16.0 a plain re-run
  // that keeps STALE mechanism bytes exits NONZERO naming --force, instead of reporting success
  // while shipping nothing (the silent-claim upgrade). Both halves are executed here, and the
  // release note itself is pinned.
  const { dir, run, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const installed = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const marker = "// PRE-UPGRADE MARKER\n";
    writeFileSync(installed, marker + readFileSync(installed, "utf8"));
    const stale = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(stale.status, 1, "a plain re-run over a stale install FAILS instead of claiming the upgrade");
    assert.match(stale.stdout + stale.stderr, /KEPT BUT STALE/, "…names the stale keep");
    assert.match(stale.stdout + stale.stderr, /A plain rerun never claims the new controller/,
      "…states the rule outright");
    assert.match(stale.stdout + stale.stderr, /a \.codex\/hooks\.json entry the upgrade changes is NOT ARMED in the Codex lane until re-trusted interactively \(Codex keys trust to the entry, not the script\), so verify: node scripts\/check-codex-hooks-armed\.mjs, and re-trust only if it reports NOT ARMED\./,
      "…and carries the Codex trust consequence (keyed to the entry, verify first) beside the --force remedy");
    assert.ok(readFileSync(installed, "utf8").startsWith(marker),
      "a plain re-run still KEEPS the already-installed control (this is why --force is required)");
    // Since v2.16.0 a hermetic forced rerun exits 1 — the post-force armed-check cannot verify
    // the Codex lane, and an unverifiable lane is a named failure, not a silent success. The
    // subject here is the byte replacement, so assert the exit contract and read the bytes.
    const forcedRun = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt", "--force"], { encoding: "utf8", env: HERMETIC_ENV });
    assert.equal(forcedRun.status, 1, "a hermetic forced rerun exits 1 (armed-check unverifiable)");
    assert.match(forcedRun.stdout + forcedRun.stderr, /NOT verified armed/, "…and says why");
    assert.ok(!readFileSync(installed, "utf8").startsWith(marker),
      "--force is what actually replaces the installed control");
    // The note must therefore carry --force. Scoped to the v1.6.1 section so a neighbouring
    // release's instruction cannot satisfy it.
    const readme = readFileSync(path.join(KIT, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("## What's new in v1.6.1"), readme.indexOf("## What's new in v1.6\n"));
    assert.ok(section.length > 0, "the v1.6.1 section exists");
    assert.match(section, /--force/,
      "the v1.6.1 upgrade instruction must require --force, or it installs none of its own control fixes");
  } finally { cleanup(); }
});

test("the ledger's UPGRADE row is not suppressed by a pre-upgrade row with the same hash", () => {
  // The clear-text `tier` exists for the Owner's spot-check. A row written by the PREVIOUS version
  // carries no `tier` but an identical `declarationHash`, so on the hash alone it satisfies the whole
  // dedupe key and suppresses the first row that would have carried the tier — leaving the upgrading
  // reader looking at a tier-less exempt row precisely after upgrading to get one. `tier` is in the
  // dedupe key to close that, and this test drives it through the REAL pre-upgrade row shape.
  const { dir, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const guard = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const ledger = path.join(dir, ".claude", "lane-ledger.jsonl");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "task-lane.json"),
      JSON.stringify({ mode: "exempt", sessionId: "s1", taskId: "upgrade-task", reason: "codex-down", tier: "T2" }) + "\n");
    const run = () => spawnSync("node", [guard], {
      cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      input: JSON.stringify({ session_id: "s1", tool_input: { file_path: "src/x.mjs" } }),
    });
    // One real row, then strip `tier` from it — byte-for-byte the shape the previous version wrote.
    run();
    const rows = () => readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((r) => JSON.parse(r));
    const preUpgrade = rows().at(-1);
    assert.equal(preUpgrade.tier, "T2", "sanity: the current version records the tier");
    delete preUpgrade.tier;
    writeFileSync(ledger, `${JSON.stringify(preUpgrade)}\n`);
    run();
    const after = rows();
    assert.equal(after.length, 2, "the post-upgrade write appends rather than deduping away");
    assert.equal(after.at(-1).tier, "T2", "…and the appended row carries the clear-text tier");
    assert.equal(after.at(-1).declarationHash, preUpgrade.declarationHash,
      "…while the hash is unchanged across versions (so the row is a genuine upgrade twin)");
    // …and a true repeat under the CURRENT version still dedupes (the fix must not defeat dedupe).
    run();
    assert.equal(rows().length, 2, "an identical repeat still dedupes");
  } finally { cleanup(); }
});

test("the gate-ladder sensor reports a TRUE cause for a tiered exemption (still T3, still fail-closed)", () => {
  // The sensor deliberately does NOT honour an exemption's tier — honouring it would route to a
  // LIGHTER ladder exactly when a review seat is already down, i.e. fail-OPEN in a sensor whose
  // whole value is that it cannot under-gate. That resolution is Owner-ratified doctrine and is
  // UNCHANGED here. What was wrong was the CAUSE it reported: `no-tier` / "no valid tier
  // declaration" against a file visibly carrying one.
  const { dir, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const gate = path.join(dir, ".claude", "hooks", "guard-gate-ladder.mjs");
    const decl = path.join(dir, ".claude", "task-lane.json");
    const write = (obj) => writeFileSync(decl, JSON.stringify(obj) + "\n");
    const ladderSays = () => {
      const r = spawnSync("node", [gate], {
        cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        input: JSON.stringify({ session_id: "s1", tool_input: { command: "bash scripts/codex-gate.sh -m x" } }),
      });
      assert.equal(r.status, 0, `the sensor must exit 0, got ${r.status}: ${r.stderr}`);
      return { out: r.stdout, err: r.stderr };
    };
    const base = { mode: "exempt", sessionId: "s1", taskId: "ladder-task", reason: "codex-down" };

    // T1 is the DISCRIMINATING value: if the sensor ever started honouring the exempt tier, the
    // fail-closed assertion reddens rather than passing silently.
    write({ ...base, tier: "T1" });
    const tiered = ladderSays();
    assert.match(tiered.out, /FAIL-CLOSED to T3/, "a tiered exemption STILL fails closed to the strictest ladder");
    assert.match(tiered.out, /exempt-tier-not-honoured/, "…under its own cause code");
    assert.match(tiered.out, /deliberately NOT honoured/, "…and the text says the tier was not honoured");
    assert.doesNotMatch(tiered.out, /no tier this sensor can use/,
      "the sensor must NOT fall back to the generic cause — the file visibly carries T1");
    assert.match(tiered.err, /exempt tier not honoured/, "the stderr line carries the true cause too");
    // A SENSOR MUST NOT PRINT THE BYPASS OF THE FAIL-CLOSED IT JUST APPLIED. An earlier draft closed
    // this branch with "Declare `in-thread` with the tier to run the declared one" — one word in the
    // declaration takes the surfaced ladder from T3 to the exemption's own tier, no seat consulted,
    // on the very mode chosen when a review seat is already down.
    assert.doesNotMatch(tiered.out, /Declare `in-thread`/,
      "the exempt head must not instruct the one-word edit that lowers the ladder");
    // …and it keeps the reviewer-protective line the generic branch carries (header guard (b)):
    // this branch fires with isDeclaredPM false, so its reader may be a fresh reviewer seat.
    assert.match(tiered.out, /do NOT write/,
      "the exempt head keeps the reviewer-protective line (it is a not-provably-PM branch)");
    // The T3 ladder body is what actually gets surfaced (the resolution, not just the label).
    assert.match(tiered.out, /REQUIRED LADDER for T3/, "and the T3 ladder is the one surfaced");

    // THE MIRROR. A valid tier is not enough to call something an exemption: both enforcement
    // controls reject an unsanctioned reason as malformed, so answering `exempt-tier-not-honoured`
    // would describe a usable exemption that does not exist — the same false-cause defect one
    // branch over. Falling through to the generic cause is the honest answer.
    write({ ...base, reason: "because-I-said-so", tier: "T1" });
    const unsanctioned = ladderSays();
    assert.match(unsanctioned.out, /FAIL-CLOSED to T3/, "an unsanctioned reason still fails closed");
    assert.doesNotMatch(unsanctioned.out, /exempt-tier-not-honoured/,
      "…but must NOT be reported as a deliberately-not-honoured exemption");

    // A tier-LESS exemption keeps the generic cause: there genuinely is no tier to not-honour.
    write(base);
    const tierless = ladderSays();
    assert.match(tierless.out, /no tier this sensor can use/, "a tier-less exemption keeps the generic cause");
    // THE STDERR SURFACE NEEDS THE SAME NEGATIVE PIN AS STDOUT. Asserting only that the exempt case
    // SAYS "exempt tier not honoured" leaves a version that says it for EVERY fail-closed cause
    // fully green — reintroducing the false-cause defect on the surface nobody pinned.
    assert.doesNotMatch(tierless.err, /exempt tier not honoured/,
      "a tier-less exemption's stderr must NOT claim an exempt tier was not honoured");
    for (const decl of [
      { mode: "in-thread", sessionId: "other-session", taskId: "ladder-task", tier: "T2" },
      { mode: "lane", sessionId: "s1", taskId: "ladder-task" },
    ]) {
      write(decl);
      assert.doesNotMatch(ladderSays().err, /exempt tier not honoured/,
        `a ${decl.mode} fail-closed cause must not borrow the exempt wording`);
    }
    // EVERY sanctioned reason, and every tier: dropping one from the sensor's set would otherwise
    // leave these assertions green while that reason silently reported the false generic cause.
    for (const reason of ["codex-down", "codex-quota", "trivial-edit"]) {
      for (const tier of ["T0", "T1", "T2", "T3"]) {
        const out = (write({ ...base, reason, tier }), ladderSays().out);
        assert.match(out, /FAIL-CLOSED to T3/, `exempt ${reason}/${tier} still fails closed to T3`);
        assert.match(out, /exempt-tier-not-honoured/, `exempt ${reason}/${tier} reports the true cause`);
      }
    }
    // THE GENERIC BRANCH MUST NOT ASSERT A SPECIFIC FALSEHOOD EITHER. A retired `lane` route and an
    // unsanctioned reason can both carry a perfectly valid `tier`, and `bad-task-id` names its true
    // cause in the parenthetical — so a head reading "no VALID TIER declaration" was false of every
    // one of them. Fixing only the exempt branch and leaving these is the twin-lying failure.
    for (const decl of [
      { mode: "lane", sessionId: "s1", taskId: "ladder-task", tier: "T2" },
      { mode: "exempt", sessionId: "s1", taskId: "ladder-task", reason: "because-I-said-so", tier: "T1" },
      { mode: "in-thread", sessionId: "s1", taskId: "BAD_TASK!", tier: "T1" },
    ]) {
      write(decl);
      const out = ladderSays().out;
      assert.match(out, /FAIL-CLOSED to T3/, `${decl.mode} still fails closed`);
      assert.doesNotMatch(out, /no valid tier declaration/,
        `the head must not claim there is no valid tier — this declaration carries ${decl.tier}`);
    }

    // THE INVARIANT THIS SENSOR IS BUILT ON: no non-in-thread declaration may resolve below T3.
    // The new branch must not have opened a route to a lighter ladder for ANY mode.
    for (const decl of [
      { mode: "lane", sessionId: "s1", taskId: "ladder-task", allowedFiles: ["src/x.mjs"] },
      { mode: "exempt", sessionId: "s1", taskId: "ladder-task", reason: "codex-down", tier: "T0" },
      { mode: "nonsense", sessionId: "s1", taskId: "ladder-task", tier: "T0" },
      { mode: "in-thread", sessionId: "s1", taskId: "ladder-task", tier: "T9" },
    ]) {
      write(decl);
      const out = ladderSays().out;
      assert.match(out, /FAIL-CLOSED to T3/, `mode ${decl.mode}/${decl.tier} must resolve T3`);
      assert.match(out, /REQUIRED LADDER for T3/, `…and surface the T3 ladder for ${decl.mode}/${decl.tier}`);
    }
    // Contrast direction: a real in-thread declaration still reports its declared tier.
    write({ mode: "in-thread", sessionId: "s1", taskId: "ladder-task", tier: "T2" });
    assert.match(ladderSays().out, /declared tier T2/, "an in-thread declaration still reports its tier");

    // CHARACTERIZATION — NOT DESIRED, documented and deferred. This sensor HONOURS a symlinked
    // declaration; both enforcement controls reject one as malformed. So on this one input the
    // sensor still describes a declaration the controls refuse. The alignment the reason-check buys
    // is PER-FIELD, not total, and this test exists so that divergence is visible rather than
    // implied-absent. Delete it when the joint symlink fix lands (see the hook header's known quirks).
    const real = path.join(dir, "real-declaration.json");
    writeFileSync(real, JSON.stringify({ ...base, tier: "T1" }) + "\n");
    rmSync(decl, { force: true });
    symlinkSync(real, decl);
    const symlinked = ladderSays().out;
    assert.match(symlinked, /FAIL-CLOSED to T3/, "the resolution is still T3 (the safe direction holds)");
    assert.match(symlinked, /exempt-tier-not-honoured/,
      "DEFERRED: the sensor honours a symlinked declaration the enforcement controls call malformed");
  } finally { cleanup(); }
});
