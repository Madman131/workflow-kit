// workflow-kit — the kit's CONTROL suite: one of the two rungs `npm test` runs (the other is the
// budget gate; `scripts/run-checks.mjs` runs both and combines their exit codes). It (1) runs the
// full plant-the-bug acceptance harness and asserts it passes, (2) unit-tests the fail-closed
// config loader, and (3) proves the portable FM1 test itself discriminates (goes RED when
// core.hooksPath is unset).

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A nested `node --test` inherits the parent runner's env (NODE_TEST_CONTEXT / NODE_OPTIONS) and then
// reports up over IPC instead of exiting non-zero — so a failing inner run would look green. Strip
// those so the child's own exit code is trustworthy.
function cleanTestEnv() {
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST")) delete e[k];
  return e;
}

test("acceptance/plant-the-bug.sh passes — every control observed both blocking and permitting", () => {
  const r = spawnSync("bash", [path.join(KIT, "acceptance", "plant-the-bug.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, `acceptance harness failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ACCEPTANCE PASSED/);
});

test("check-doc-size loadKitConfig is fail-closed: absent -> defaults, malformed -> not ok", async () => {
  const { loadKitConfig } = await import(path.join(KIT, "scripts", "check-doc-size.mjs"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-cfg-"));
  try {
    // absent config -> ok with empty repo-specific families
    let c = loadKitConfig(dir);
    assert.equal(c.ok, true);
    assert.deepEqual(c.stateDocs, []);
    assert.equal(c.memoryDir, null);
    // malformed config -> NOT ok (fail closed)
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), "NOT JSON{");
    c = loadKitConfig(dir);
    assert.equal(c.ok, false, "a malformed config must be reported not-ok (fail closed)");
    // wrong-typed field -> NOT ok
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ stateDocs: "nope" }));
    assert.equal(loadKitConfig(dir).ok, false, "a wrong-typed stateDocs must be not-ok");
    // valid partial config -> ok
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ stateDocs: ["docs/s.md"] }));
    c = loadKitConfig(dir);
    assert.equal(c.ok, true);
    assert.deepEqual(c.stateDocs, ["docs/s.md"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init installs the /thread-restart dual-harness assets + AGENTS pointer, idempotently", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-cmd-"));
  // Codex prompts are user-global; point init at a scratch dir so this test never touches ~/.codex.
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    const run = () => execFileSync(
      "node",
      [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir],
      { stdio: "ignore" },
    );
    run();
    const claudeCmd = path.join(dir, ".claude", "commands", "thread-restart.md");
    const codexCmd = path.join(codexDir, "thread-restart.md");
    const agents = path.join(dir, "AGENTS.md");
    // lands in the right place
    assert.ok(existsSync(claudeCmd), "Claude command installed under .claude/commands/");
    assert.ok(existsSync(codexCmd), "Codex prompt installed into the overridable --codex-prompts-dir");
    // syntactically valid per harness + the load-bearing method text copied verbatim into both
    const claudeText = readFileSync(claudeCmd, "utf8");
    const codexText = readFileSync(codexCmd, "utf8");
    assert.match(claudeText, /^---\n/, "Claude command opens with YAML frontmatter");
    assert.match(codexText, /^# /, "Codex prompt opens with a markdown H1");
    for (const [name, t] of [["Claude", claudeText], ["Codex", codexText]]) {
      assert.match(t, /VERIFY before finalizing/, `${name} asset: the mandatory verify pass is preserved`);
      assert.match(t, /Index, don't duplicate/, `${name} asset: index-don't-duplicate is preserved`);
    }
    // AGENTS fallback pointer appended exactly once
    const marker = "workflow-kit:thread-restart-pointer";
    const occurrences = (s) => s.split(marker).length - 1;
    assert.equal(occurrences(readFileSync(agents, "utf8")), 1, "AGENTS.md carries the pointer exactly once");
    // idempotent: a second run neither clobbers a USER-EDITED command nor duplicates the pointer.
    // Plant a real edit first — hashing the pristine install would pass even if copyGuarded regressed
    // to overwrite (a re-copy is byte-identical to the source), so it must be MUTATED to be a real test.
    const editedClaude = readFileSync(claudeCmd, "utf8") + "\n<!-- user edit: keep me -->\n";
    const editedCodex = readFileSync(codexCmd, "utf8") + "\n<!-- user edit: keep me -->\n";
    writeFileSync(claudeCmd, editedClaude);
    writeFileSync(codexCmd, editedCodex);
    const agentsBefore = readFileSync(agents, "utf8");
    run();
    assert.equal(readFileSync(claudeCmd, "utf8"), editedClaude, "re-run KEEPS a user-edited Claude command (no clobber without --force)");
    assert.equal(readFileSync(codexCmd, "utf8"), editedCodex, "re-run KEEPS a user-edited Codex prompt (no clobber without --force)");
    assert.equal(readFileSync(agents, "utf8"), agentsBefore, "AGENTS.md unchanged on re-run");
    assert.equal(occurrences(readFileSync(agents, "utf8")), 1, "pointer still appears exactly once after re-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
});

// Adopt into a fresh scratch repo. Codex prompts are user-global, so ALWAYS point init at a scratch
// dir — a test that writes to a real ~/.codex/prompts is not hermetic.
function adopt(extraArgs = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adopt-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  const run = (args = extraArgs) => execFileSync(
    "node",
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
    { stdio: "ignore" },
  );
  run();
  return { dir, codexDir, run, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("init rejects a flag-shaped value for every value-taking flag", () => {
  // `--target -h` must not adopt into a directory literally named "-h" while silently swallowing the
  // help flag. Single-dash flags are real (-h), so rejecting only "--" prefixes left this open.
  for (const argv of [["--target"], ["--target", "-h"], ["--target", "--help"], ["--repo-name", "--force"],
    ["--owner-name", "--force"], ["--codex-prompts-dir", ""], ["--memory-dir", "--target"]]) {
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), ...argv], { encoding: "utf8" });
    assert.equal(r.status, 2, `${argv.join(" ")} must exit 2, not proceed (got ${r.status})`);
    assert.doesNotMatch(r.stderr, /ERR_INVALID_ARG_TYPE|at ModuleLoader/, "and it must be a clean message, not a stack trace");
  }
  // …but a legitimate value that merely starts with a dash must still work. Rejecting every leading
  // "-" also rejected `--source-dirs -generated`, a directory name the config loaders accept and
  // which has no alternative spelling (slashes are separately forbidden).
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-dash-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--source-dirs", "-generated", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a dash-leading directory name is a legitimate value: ${r.stderr}`);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ".claude", "kit.config.json"), "utf8")).executedPathDirs,
      ["-generated"], "and it reaches kit.config.json intact");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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

test("a plain init re-run does NOT update an installed [P] control — so the upgrade note must say --force", () => {
  // A control fix reaches an adopter only through the instruction the release note gives them.
  // `init` never overwrites a file it did not write this run: a plain re-run prints "exists, kept",
  // EXITS 0, and leaves the old control in place. A release that changes `[P]` controls and tells the
  // reader to "re-run init with your original flags" therefore ships them nothing while reporting
  // success. Both halves are executed here, and the note itself is pinned.
  const { dir, run, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const installed = path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs");
    const marker = "// PRE-UPGRADE MARKER\n";
    writeFileSync(installed, marker + readFileSync(installed, "utf8"));
    run(["--skip-codex-prompt"]);
    assert.ok(readFileSync(installed, "utf8").startsWith(marker),
      "a plain re-run KEEPS the already-installed control (this is why --force is required)");
    run(["--skip-codex-prompt", "--force"]);
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

test("--risk-tokens is REMOVED (v2.0): the flag fails LOUDLY and names the migration", () => {
  // v1.5.0 deprecated it (parse-warn-ignore) and printed a removal horizon of v2.0; this is that
  // removal. A breaking CLI change must BREAK — a silently-ignored flag would let an adopter keep a
  // saved invocation forever believing it configured something. exit 2, not 0.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-rm-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--risk-tokens", "billing", "--source-dirs", "app", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 2, "a removed flag is a clean exit 2, never a silent ignore");
    assert.match(r.stderr, /--risk-tokens was REMOVED at v2\.0/, "the failure names the flag and the version");
    // The message must carry the FIX, not just the refusal — this is the error an adopter meets while
    // already frustrated, and every other refusal in this kit names its remediation.
    assert.match(r.stderr, /Drop the flag/, "…and tells them what to do instead");
    assert.match(r.stderr, /TOLERATED/, "…and says an existing laneRiskTokens key needs no edit");
    // It must not have adopted a half-tree on the way out: the parser rejects BEFORE any write.
    assert.equal(existsSync(path.join(dir, ".claude", "kit.config.json")), false,
      "the run aborts in argument parsing, so nothing was written");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("…while a legacy laneRiskTokens KEY in an adopter's config stays TOLERATED (the flag died, the key did not)", () => {
  // The two are separate contracts and only one changed. An older adopter's kit.config.json still
  // carries laneRiskTokens; every control ignores it rather than treating it as corrupt. Removing the
  // flag must not turn those existing configs into fail-closed bricks — that would be a silent,
  // repo-wide outage delivered by an upgrade.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-legacy-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--source-dirs", "app", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a clean invocation still adopts: ${r.stderr}`);
    // Hand-write the legacy shape an older adopt would have left behind, then prove the write guard
    // still ALLOWS a declared write rather than reading the stale key as config corruption.
    writeFileSync(path.join(dir, ".claude", "kit.config.json"),
      '{"executedPathDirs":["app"],"laneRiskTokens":["billing"]}\n');
    const sid = "legacy-session-id";
    writeFileSync(path.join(dir, ".claude", "task-lane.json"),
      JSON.stringify({ mode: "in-thread", sessionId: sid, taskId: "legacy-key-check", tier: "T1" }));
    const g = spawnSync("node", [path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs")], {
      input: JSON.stringify({ session_id: sid, tool_input: { file_path: "app/x.mjs" } }),
      cwd: dir, encoding: "utf8",
    });
    assert.equal(g.status, 0, "the guard exits cleanly");
    assert.doesNotMatch(g.stdout, /"permissionDecision":"deny"/,
      "a legacy laneRiskTokens key is IGNORED, never read as a malformed config");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init installs the dual-lane skills: one shared body, a shim per harness, idempotently", () => {
  const { dir, codexDir, run, cleanup } = adopt();
  try {
    const body = path.join(dir, ".agents", "skills", "humanize", "SKILL.md");
    const bullet = path.join(dir, ".agents", "skills", "humanize", "BULLET.md");
    const claudeShim = path.join(dir, ".claude", "skills", "humanize", "SKILL.md");
    const aliasShim = path.join(dir, ".claude", "skills", "humanize-bullet", "SKILL.md");
    const codexShim = path.join(codexDir, "humanize.md");
    const codexAlias = path.join(codexDir, "humanize-bullet.md");
    for (const [label, p] of [["shared body", body], ["body sibling BULLET.md", bullet], ["Claude shim", claudeShim],
      ["Claude alias shim", aliasShim], ["Codex shim", codexShim], ["Codex alias shim", codexAlias]]) {
      assert.ok(existsSync(p), `${label} installed at ${p}`);
    }
    assert.match(readFileSync(claudeShim, "utf8"), /^---\n/, "Claude skill shim opens with YAML frontmatter");
    assert.match(readFileSync(codexShim, "utf8"), /^# /, "Codex skill prompt opens with a markdown H1");
    // THE load-bearing property: every shim points at a body that EXISTS. A shim naming a renamed or
    // dropped body ships a command that dead-ends, which is the failure this mechanism must not hide.
    for (const shim of [claudeShim, aliasShim, codexShim, codexAlias]) {
      const refs = [...readFileSync(shim, "utf8").matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
      assert.ok(refs.length > 0, `${shim} names a shared body`);
      for (const [, skill, file] of refs) {
        assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
          `${shim} points at .agents/skills/${skill}/${file}, which must exist`);
      }
    }
    // The shims carry NO rules of their own — that is the point of a single shared body.
    for (const shim of [claudeShim, codexShim]) {
      assert.doesNotMatch(readFileSync(shim, "utf8"), /Word budget/, `${shim} must not duplicate the body's rules`);
    }
    // Idempotent: plant a real USER EDIT first. Hashing a pristine install would stay green even if
    // copyGuarded regressed to overwrite (a re-copy is byte-identical), so it must be MUTATED.
    const edited = {};
    for (const p of [body, claudeShim, codexShim]) {
      edited[p] = readFileSync(p, "utf8") + "\n<!-- user edit: keep me -->\n";
      writeFileSync(p, edited[p]);
    }
    run();
    for (const p of [body, claudeShim, codexShim]) {
      assert.equal(readFileSync(p, "utf8"), edited[p], `re-run KEEPS the user-edited ${p} (no clobber without --force)`);
    }
  } finally { cleanup(); }
});

test("init installs the frontier-review skill + reviewer agents; the tools: [] cage survives verbatim", () => {
  const { dir, codexDir, run, cleanup } = adopt();
  try {
    const body = path.join(dir, ".agents", "skills", "frontier-review", "SKILL.md");
    const invoke = path.join(dir, ".agents", "skills", "frontier-review", "INVOKE.md");
    const claudeShim = path.join(dir, ".claude", "skills", "frontier-review", "SKILL.md");
    const codexShim = path.join(codexDir, "frontier-review.md");
    const cold = path.join(dir, ".claude", "agents", "cold-reviewer.md");
    const consult = path.join(dir, ".claude", "agents", "frontier-consult.md");
    for (const [label, p] of [["shared body", body], ["reference-layer sibling INVOKE.md", invoke],
      ["Claude shim", claudeShim], ["Codex shim", codexShim],
      ["cold-reviewer agent", cold], ["frontier-consult agent", consult]]) {
      assert.ok(existsSync(p), `${label} installed at ${p}`);
    }
    // The body is budget-capped, so on-demand mechanics live in the sibling — but a pointer to a
    // file that is not installed is a dead end, the same class as a shim naming a missing body.
    const bodyRefs = [...readFileSync(body, "utf8").matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
    assert.ok(bodyRefs.length > 0, "the body points at its reference layer");
    for (const [, skill, file] of bodyRefs) {
      assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
        `the body points at .agents/skills/${skill}/${file}, which must be installed`);
    }
    // The five honesty corrections stay in the BODY — a correction of a false claim must never sit
    // in a layer the executor may not load. Pinned so a future fold cannot quietly relocate one.
    const honestyText = readFileSync(body, "utf8");
    for (const [claim, probe] of [
      ["the cap is not mechanical", /nothing counts it/],
      ["the kit does not execute the cage enforcement", /does not execute the enforcement/],
      ["the consult never substitutes for a gate seat", /never substitutes/],
      ["the Codex lane is not packet-only", /NOT packet-only/],
      ["the packet carries the doctrine the caged seat cannot read", /the doctrine excerpts it is judged against/],
    ]) assert.match(honestyText, probe, `the body itself states: ${claim}`);
    // the shims point at a body that exists and carry no rules of their own (the shared-body invariant)
    for (const shim of [claudeShim, codexShim]) {
      assert.match(readFileSync(shim, "utf8"), /\.agents\/skills\/frontier-review\/SKILL\.md/, `${shim} names the shared body`);
      assert.doesNotMatch(readFileSync(shim, "utf8"), /Word budget/, `${shim} must not duplicate the body's rules`);
    }
    // THE load-bearing line, asserted as the LITERAL string the harness parses. `tools: []` is what
    // makes the consult seat's packet-only limit mechanical; a reworded or dropped line is the cage gone.
    const consultText = readFileSync(consult, "utf8");
    assert.match(consultText, /^tools: \[\]$/m, "frontier-consult carries the literal tools: [] line (the packet cage)");
    assert.match(readFileSync(cold, "utf8"), /^tools: Read, Grep, Glob$/m,
      "cold-reviewer keeps its read-only toolset (NOT caged — it must verify claims against the code)");
    // idempotent: a plain re-run keeps user edits (mutated first, so a regressed overwrite cannot hide)
    const edited = {};
    for (const p of [body, consult]) { edited[p] = readFileSync(p, "utf8") + "\n<!-- user edit: keep me -->\n"; writeFileSync(p, edited[p]); }
    run();
    for (const p of [body, consult]) assert.equal(readFileSync(p, "utf8"), edited[p], `re-run KEEPS the user-edited ${p} (no clobber without --force)`);
    // The cage check reads the INSTALLED file (a kept agent may be edited or stale). Probe it at
    // SEVERAL points, not one: a check proven against a single broken shape is proven against that
    // shape only — a relaxed anchor or a whole-file scope stayed green under a one-mutation suite
    // (found by a cold seat's mutation battery).
    const initSays = (args = []) => {
      const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
        "--codex-prompts-dir", codexDir, ...args], { encoding: "utf8" });
      assert.equal(r.status, 0, `init should exit 0: ${r.stderr}`);
      return r.stdout + r.stderr;
    };
    const fmSwap = (line) => writeFileSync(consult, consultText.replace(/^tools: \[\]$/m, line));
    for (const [line, label] of [["tools: '*'", "wildcard"], ["tools: [Read]", "a NON-empty list"],
      ["tools: Read, Bash, Write", "a plain tool list"], ["# tools: []", "the line commented out"]]) {
      fmSwap(line);
      assert.match(initSays(), /packet-only cage is NOT confirmed/, `init warns when the frontmatter reads ${label}`);
    }
    // THE false-pass a whole-file grep allows: frontmatter grants tools while some BODY line happens
    // to spell `tools: []`. The harness parses only the frontmatter; so must the check.
    writeFileSync(consult, consultText.replace(/^tools: \[\]$/m, "tools: Read, Bash, Write")
      + "\nMaintainer note — the kit default for this seat is:\ntools: []\n");
    assert.match(initSays(), /packet-only cage is NOT confirmed/,
      "a body line spelling `tools: []` must NOT certify a frontmatter that grants tools");
    // …and the converse: spellings YAML reads as an empty list must NOT warn. A check that cries
    // wolf on a genuinely caged seat is one adopters learn to ignore.
    for (const [line, label] of [["tools: []  ", "trailing whitespace"], ["tools: [] # none at all", "a trailing comment"],
      ["tools: [ ]", "a space inside the brackets"]]) {
      fmSwap(line);
      assert.doesNotMatch(initSays(), /cage is NOT confirmed/, `no false warning for ${label}`);
    }
    // ABSENCE IS NOT A PASS. The skill names a `subagent_type`; if THAT seat is not installed the
    // consult dead-ends, and a check that silently skips would report health on a broken adopt —
    // the same vacuity the shim check was hardened against ("zero matches means zero comparisons").
    // Produced the way it actually happens: the installed body names a seat that does not exist
    // (a renamed or half-updated skill). Note deleting the installed agent does NOT produce this —
    // init simply reinstalls it, which is why the check keys on the NAME, not on a fixed filename.
    writeFileSync(consult, consultText);   // healthy seat on disk…
    const bodyText = readFileSync(body, "utf8");
    writeFileSync(body, bodyText.replace('subagent_type: "frontier-consult"', 'subagent_type: "frontier-consult-v2"'));
    const absent = initSays();
    assert.match(absent, /"frontier-consult-v2".*is NOT installed/s, "a named seat that is NOT installed is reported, not silently skipped");
    assert.doesNotMatch(absent, /cage \("tools: \[\]"\) is present/, "…and init does not also certify a cage it never checked");
    writeFileSync(body, bodyText);
    // --force restores the kit's verbatim agent ([P] class: overwritten, no .bak) and the check clears.
    run(["--force"]);
    assert.equal(readFileSync(consult, "utf8"), readFileSync(path.join(KIT, "agents", "frontier-consult.md"), "utf8"),
      "--force restores the kit's frontier-consult verbatim");
    assert.ok(!existsSync(`${consult}.bak`), "[P] assets get NO .bak on --force (only [G] files do) — documented in PORTABILITY");
    const clean = initSays();
    assert.doesNotMatch(clean, /cage is NOT confirmed/, "no cage warning against a healthy installed seat (discriminates, no cry-wolf)");
    assert.match(clean, /cage \("tools: \[\]"\) is present/, "…and it says so positively, so silence is never the only evidence");
  } finally { cleanup(); }
});

test("the agents install is FAILURE-ISOLATED: it cannot abort the hook registration that follows it", () => {
  // § 4e is a NUDGE; § 5 (merging the PreToolUse/Stop registrations) is a CONTROL. An exception
  // escaping the agents block would leave hook FILES on disk with ZERO registrations — the silent
  // fail-open mergeSettings' own read-back exists to stop. The commands block has had this proof
  // since v1.1; § 4e shipped without its counterpart, and removing the try/catch left BOTH suites
  // green (found by a cold seat's mutation battery). This is that missing canary.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-agentfail-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    // A regular FILE where the directory must be: the copy throws (ENOTDIR/EEXIST) mid-block.
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "agents"), "not a directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a failed agents install must NOT abort the adopt: ${r.stderr}`);
    assert.match(r.stderr, /review-seat agents install failed/, "…it warns plainly instead of dying");
    // THE assertion that matters: the CONTROL downstream of the failure still ran.
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const cmds = [...(settings.hooks?.PreToolUse ?? []), ...(settings.hooks?.Stop ?? [])].flatMap((g) => g.hooks ?? []).map((h) => String(h.command));
    assert.equal(cmds.filter((c) => /guard-(cross-repo-writes|lane-authoring|gate-ladder)\.mjs/.test(c)).length, 3,
      "the 3 PreToolUse guards are STILL registered after the agents block failed");
    assert.equal(cmds.filter((c) => c.includes("guard-owner-comms.mjs")).length, 1,
      "…and so is the Stop sensor");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init generates core/OWNER_COMMS.md as [G]; --owner-name fills only the name", () => {
  const plain = adopt();
  try {
    const doc = path.join(plain.dir, "core", "OWNER_COMMS.md");
    assert.ok(existsSync(doc), "core/OWNER_COMMS.md is generated");
    const text = readFileSync(doc, "utf8");
    assert.match(text, /CLASS: BINDING/, "declares CLASS: BINDING so check-doc-size governs it automatically");
    assert.match(text, /\{\{OWNER_NAME\}\}/, "without --owner-name the placeholder stays (sensor dormant)");
    // The kit must NEVER ship a concrete Owner: [G] means generated, never copied.
    assert.ok(!existsSync(path.join(KIT, "core", "OWNER_COMMS.md")),
      "the kit itself must not ship a concrete core/OWNER_COMMS.md — it names a person ([G])");
  } finally { plain.cleanup(); }

  const named = adopt(["--owner-name", "Alex"]);
  try {
    const text = readFileSync(path.join(named.dir, "core", "OWNER_COMMS.md"), "utf8");
    assert.match(text, /^## How to talk to Alex — Owner, not a developer$/m, "--owner-name fills the heading the sensor parses");
    // The three judgment-call placeholders are deliberately LEFT for the adopter.
    for (const tok of ["OWNER_PROFILE", "IRREVERSIBLE_ASSET", "OWNER_SHORTHAND"]) {
      assert.match(text, new RegExp(`\\{\\{${tok}\\}\\}`), `{{${tok}}} is left for manual completion`);
    }
  } finally { named.cleanup(); }
});

test("rule 8 ships in the GENERATED Owner contract and in the INSTALLED /humanize body", () => {
  // Read what an ADOPTER gets, never the template: a rule that survives in templates/ and dies in
  // generation is the failure this whole [G] path can have, and grepping the source would miss it.
  const named = adopt(["--owner-name", "Alex"]);
  try {
    const doc = readFileSync(path.join(named.dir, "core", "OWNER_COMMS.md"), "utf8");
    const rule8 = /^8\. \*\*Questions and recommendations never blend in\.\*\*([\s\S]*?)(?=\n\n)/m.exec(doc);
    assert.ok(rule8, "the generated contract carries rule 8");
    for (const lead of ["**QUESTION:**", "**RECOMMENDATION:**", "**DECISION NEEDED:**"]) {
      assert.ok(rule8[0].includes(lead), `rule 8 names the ${lead} lead verbatim — the label IS the rule`);
    }
    assert.ok(rule8[0].includes("Alex"), "the Owner's real name reached rule 8; a rule addressed to {{OWNER_NAME}} names nobody");
    assert.doesNotMatch(doc, /^9\. /m, "the rules stop at 8 — a duplicate would renumber silently");
    // The labels alone are not the rule: a version that kept the three strings and dropped the SHAPE
    // requirement would satisfy every assertion above while permitting exactly what rule 8 forbids.
    assert.match(rule8[0], /bolded, on its own bulleted line, with\s+a labeled lead/,
      "rule 8 still states the SHAPE it requires, not only the labels");

    // The count sweep, made mechanical on the GENERATED side: the claim in the release note is that
    // no artifact an adopter receives states a rule TOTAL, so a later edit that reintroduces one
    // (in the contract or in the skill that repairs against it) must go red here, not in review.
    // A detector must OVER-trigger relative to the thing it warns about, or it is decoration. The
    // first cut matched "eight rules" and "rules 1-8" and sailed past "eight numbered rules",
    // "rules 1 through 8" and "rules 1 to 8" — a seat found all three. It allows up to two words
    // between the number and "rules", and spells the range separators out. It is still a blacklist
    // of spellings, not a proof: a genuinely novel phrasing of a total would pass, and the sweep in
    // the release note is what covers that.
    const COUNT_CLAIM = /\b(six|seven|eight|nine|ten|\d+)\s+(?:\w+\s+){0,2}rules\b|\brules\s*1\s*(?:[-–—]|through|thru|to)\s*\d/i;
    for (const rel of [["core", "OWNER_COMMS.md"], [".agents", "skills", "humanize", "SKILL.md"],
      [".agents", "skills", "humanize", "BULLET.md"]]) {
      const generated = readFileSync(path.join(named.dir, ...rel), "utf8");
      assert.doesNotMatch(generated, COUNT_CLAIM,
        `${path.join(...rel)} states no rule TOTAL — a count is what goes stale when a rule is added`);
    }

    // The skill that repairs a message against these rules must know about the new one, or /humanize
    // certifies as clean a message rule 8 rejects.
    const skill = readFileSync(path.join(named.dir, ".agents", "skills", "humanize", "SKILL.md"), "utf8");
    assert.match(skill, /buried ask/, "the /humanize miss list checks for a buried ask");
    assert.match(skill, /\(rule 8\)/, "…and points at the rule it comes from");
  } finally { named.cleanup(); }
});

test("the Stop registration merges into settings.json exactly once, confirmed by read-back", () => {
  const { dir, run, cleanup } = adopt();
  try {
    const settingsPath = path.join(dir, ".claude", "settings.json");
    const countStop = () => {
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      return (s.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? [])
        .filter((h) => String(h.command).includes("guard-owner-comms.mjs")).length;
    };
    const countPreToolUse = () => {
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      return (s.hooks?.PreToolUse ?? []).flatMap((g) => g.hooks ?? [])
        .filter((h) => /guard-(cross-repo-writes|lane-authoring|gate-ladder)\.mjs/.test(String(h.command))).length;
    };
    assert.equal(countStop(), 1, "Stop sensor registered once on disk");
    assert.equal(countPreToolUse(), 3, "the 3 PreToolUse guards are still registered alongside it");
    run(); // merging is idempotent — a re-run must not duplicate the registration
    assert.equal(countStop(), 1, "re-run does not duplicate the Stop registration");
    assert.equal(countPreToolUse(), 3, "re-run does not duplicate the PreToolUse registrations");
    // the hook file itself landed and is executable-ish (copied like every other hook)
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs")), "the Stop hook file is installed");

    // MERGED, not REPLACED. Counting only our own registrations would stay green against a
    // mergeSettings that overwrote the file wholesale — the assertion would be about the template,
    // not about the merge. Plant settings a real adopter would have and require they survive.
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.env = { KIT_MERGE_SENTINEL: "keep-me" };           // a top-level key we know nothing about
    settings.hooks.Stop.push({ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff" }] });
    settings.hooks.PreToolUse.push({ matcher: "WebFetch", hooks: [{ type: "command", command: "node ./mine.mjs" }] });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    run();
    const after = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(after.env?.KIT_MERGE_SENTINEL, "keep-me", "an unrelated top-level setting SURVIVES the merge (not replaced)");
    const allCommands = [...(after.hooks?.Stop ?? []), ...(after.hooks?.PreToolUse ?? [])].flatMap((g) => g.hooks ?? []).map((h) => h.command);
    assert.ok(allCommands.some((c) => c.includes("afplay")), "the adopter's own Stop hook SURVIVES the merge");
    assert.ok(allCommands.some((c) => c.includes("./mine.mjs")), "the adopter's own PreToolUse hook SURVIVES the merge");
    assert.equal(countStop(), 1, "our Stop registration is still present exactly once");
    assert.equal(countPreToolUse(), 3, "our 3 PreToolUse guards are still present");
  } finally { cleanup(); }
});

test("init --force backs up hand-authored [G] content instead of destroying it", () => {
  const { dir, run, cleanup } = adopt(["--owner-name", "Alex", "--source-dirs", "app"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const cfg = path.join(dir, ".claude", "kit.config.json");
    // Complete the contract the way an adopter must, then take the upgrade path init itself
    // recommends for a stale hook ("re-run with --force"). --force is GLOBAL, so without a backup it
    // silently destroys the hand-written Owner doc AND resets the source-dir family to defaults.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_PROFILE}}", "They read fast and hate preamble."));
    run(["--force"]);   // note: no --owner-name and no family flags this time
    assert.ok(existsSync(`${doc}.bak`), "--force leaves a .bak of the previous OWNER_COMMS");
    assert.match(readFileSync(`${doc}.bak`, "utf8"), /They read fast and hate preamble\./,
      "the hand-written Owner profile is recoverable, not lost");
    assert.ok(existsSync(`${cfg}.bak`), "--force leaves a .bak of the previous kit.config.json");
    assert.match(readFileSync(`${cfg}.bak`, "utf8"), /app/,
      "the configured executedPathDirs family is recoverable — a silent reset to {} WIDENS the write guard");

    // If the backup CANNOT be written, the overwrite must not happen either. Warning about a failed
    // backup and then destroying the file anyway is worse than not offering backups at all, because
    // the console says the upgrade path is recoverable.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{IRREVERSIBLE_ASSET}}", "the customer corpus"));
    rmSync(`${doc}.bak`, { force: true });
    mkdirSync(`${doc}.bak`);          // a directory here makes the backup write fail
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt", "--force"], { encoding: "utf8" });
    assert.equal(r.status, 0, "init still completes the rest of the adopt");
    assert.match(r.stderr, /REFUSED to overwrite/, "init says plainly that it refused");
    assert.match(readFileSync(doc, "utf8"), /the customer corpus/,
      "the un-backup-able file is left UNCHANGED rather than destroyed");
    // …and the SUMMARY must not describe the refused file as backed up. Folding a refusal into the
    // "kept" count printed "your version is backed up first" about the one file whose backup failed,
    // and hid that the tree is now a mix of regenerated and stale [G] files.
    assert.match(r.stderr, /generation is INCOMPLETE/, "init flags the mixed-version tree explicitly");
    assert.match(r.stdout, /1 REFUSED \(NOT backed up, NOT overwritten\)/, "the summary counts the refusal separately");
  } finally { cleanup(); }
});

test("init verifies the INSTALLED shims, and a shim naming no body is a failure not a pass", () => {
  const { dir, run, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const shim = path.join(dir, ".claude", "skills", "humanize", "SKILL.md");
    // BOTH streams: init's log() goes to stdout but warn() goes to stderr, and the dangling-shim
    // report is a warning. Reading stdout alone would make every assertion below unfalsifiable.
    const runOut = (args) => {
      const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
        "--repo-name", "adopter", "--skip-codex-prompt", ...args], { encoding: "utf8" });
      assert.equal(r.status, 0, `init should exit 0: ${r.stderr}`);
      return r.stdout + r.stderr;
    };
    assert.match(runOut([]), /body reference\(s\).*all resolve on disk/, "a healthy install reports resolution");
    // A KEPT shim is the one the harness loads. Point it at a body that does not exist: init must
    // read the INSTALLED file, not the kit's pristine source, or it certifies a shim it never saw.
    writeFileSync(shim, "---\nname: humanize\n---\nRead `.agents/skills/gone-forever/SKILL.md`.\n");
    const out = runOut([]);
    assert.match(out, /gone-forever\/SKILL\.md, which is NOT installed/, "a dangling INSTALLED shim is reported");
    assert.match(out, /do NOT resolve/, "and the summary line says so rather than claiming success");
    assert.doesNotMatch(out, /all resolve on disk/, "init must not also print a clean bill of health");
    // A shim naming NO body at all: zero matches must not read as zero failures.
    writeFileSync(shim, "---\nname: humanize\n---\nNo body reference here at all.\n");
    assert.match(runOut([]), /names NO \.agents\/skills/, "a shim with zero body references is a failure, not a vacuous pass");
    run(["--force"]); // restore for any later assertions in this test file
  } finally { cleanup(); }
});

test("guard-owner-comms is a FAIL-OPEN sensor: dormant until named, then it discriminates", () => {
  const { dir, cleanup } = adopt(["--owner-name", "Alex"]);
  try {
    const hook = path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs");
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const transcript = path.join(dir, "transcript.jsonl");
    // Complete the contract as an adopter must: real shorthand rows OUTSIDE the template's example
    // fence. Until this is done the sensor knows no question tokens — see the dedicated test below.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`AR` = archive ready? — is this thread closed out on the remote.\n`MIS` = make it so — proceed on the agreed scope."));
    // `entries` lets a case build an arbitrary transcript (sidechain flags, content blocks); the
    // 2-arg form is the common case. Both suites previously only ever produced the simple shape,
    // which is why several real branches were never exercised in either direction.
    const write = (user, assistantText) => writeEntries([
      { type: "user", message: { role: "user", content: user } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: assistantText }] } },
    ]);
    const writeEntries = (entries) => writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const run = (extra = {}, env = {}) => spawnSync("node", [hook], {
      cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript, ...extra }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    });
    // A CRASH is not an "allow". Mapping any non-block output to allow would let a hook that threw
    // on every input satisfy every fail-open assertion below, so exit status is checked explicitly.
    const decide = (extra = {}, env = {}) => {
      const r = run(extra, env);
      assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
      return r.stdout.includes('"decision":"block"') ? "block" : "allow";
    };
    const LONG = "word ".repeat(400);

    // --- SIZE MISMATCH, both directions ---
    write("AR", LONG);
    assert.equal(decide(), "block", "a declared shorthand QUESTION (gloss ends in '?') over-answered is flagged");
    write("AR", "Yes — closed out and verified on the remote.");
    assert.equal(decide(), "allow", "the same question answered briefly passes (no over-block)");
    write("MIS", LONG);
    assert.equal(decide(), "allow", "MIS is an INSTRUCTION (no '?' in its gloss) — a long work report is fine");
    write("ready to ship?", LONG);
    assert.equal(decide(), "block", "a short yes/no question answered at length is flagged");
    // An explicit REQUEST FOR DETAIL is not over-answered by giving the detail. Blocking it would tell
    // the agent to withhold exactly what the Owner asked for — the sensor working against rule 1.
    for (const q of ["can you give me the full inventory?", "can you give me the details?", "walk me through it?"]) {
      write(q, LONG);
      assert.equal(decide(), "allow", `"${q}" asks FOR detail — answering at length is correct`);
    }
    // …but that exemption must be PHRASES, not bare quantifiers. These are ordinary yes/no questions
    // that merely contain a word like "all" or "summary"; exempting them would silently delete the
    // check for a large class of exactly the questions it exists to protect.
    // The exemption keys on the Owner ASKING for elaboration, never on the topic merely sounding
    // detailed — a noun-phrase list exempted the last two of these.
    for (const q of ["Are all tests passing?", "Is the summary ready?", "Did every check pass?",
      "Are the details correct?", "Is the full report ready?"]) {
      write(q, LONG);
      assert.equal(decide(), "block", `"${q}" is a yes/no question, not a request for elaboration`);
    }

    // --- NARRATION, both directions ---
    write("what changed?", "Let me check the config and report back.");
    assert.equal(decide(), "block", "narration in the FINAL message is flagged");
    // Markdown furniture must not change the verdict — bulleted narration is still narration.
    for (const shape of ["- Let me check the config.", "1. Let me check the config.", "**Let me check the config** now."]) {
      write("what changed?", shape);
      assert.equal(decide(), "block", `narration is caught regardless of markdown shape: ${JSON.stringify(shape)}`);
    }
    for (const fence of ["```", "~~~"]) {
      write("what changed?", `${fence}text\nLet me check the config\n${fence}\nNothing changed.`);
      assert.equal(decide(), "allow", `${fence} fenced evidence is quoted material, not narration`);
    }
    // A FUTURE COMMITMENT is idiomatic and rule-1-compliant; flagging it costs the Owner an extra
    // message, which is the noise this hook exists to cut.
    for (const closing of [
      "Yes, safe. I will run the deploy once you say go.",
      "Yes, done. I'll check back tomorrow with the numbers.",
    ]) {
      write("safe?", closing);
      assert.equal(decide(), "allow", `a deferred commitment is not narration: ${JSON.stringify(closing)}`);
    }
    // The two branches are deliberately asymmetric, and BOTH directions of that asymmetry are pinned
    // here. "I'll …" is ambiguous — announcing work now vs promising it later — so it consults the
    // deferral list. "Let me …" is narration under every reading, so it never does. Sharing one
    // exemption between them let the first sentence below through on the word "then".
    for (const narrating of [
      "Let me check the config, then I'll report back.",
      "Let me verify that once the build finishes.",
    ]) {
      write("what changed?", narrating);
      assert.equal(decide(), "block", `"Let me …" is narration regardless of any deferral word: ${JSON.stringify(narrating)}`);
    }
    write("what changed?", "Config is unchanged. I'll check the logs, then send you the summary.");
    assert.equal(decide(), "allow", `"I'll … then …" chains a COMMITMENT about later work, not narration of work now`);
    write("what changed?", "I'll check the config.");
    assert.equal(decide(), "block", `"I'll check …" with no deferral IS narration`);
    // An explicit "now" beats a deferral word that belongs to a different clause of the same sentence.
    write("what changed?", "I'll check the config now; if you have questions, ask.");
    assert.equal(decide(), "block", `an unrelated "if you" must not excuse present-tense narration`);

    // --- harness-injected blocks must not silently disable the size check ---
    // The harness wraps the Owner's turn routinely. Discarding the whole turn (or letting the block
    // inflate the word count) removed the check on exactly the short-question turns it targets.
    write("<system-reminder>project context blob</system-reminder>\nAR", LONG);
    assert.equal(decide(), "block", "a LEADING system-reminder is stripped, not treated as the Owner's words");
    write("AR\n<system-reminder>project context blob</system-reminder>", LONG);
    assert.equal(decide(), "block", "a TRAILING system-reminder is stripped (it must not inflate the word count)");
    write("<system-reminder>nothing was typed</system-reminder>", LONG);
    assert.equal(decide(), "allow", "a turn with NO Owner-typed text has no question to size against");
    // An UNCLOSED block (a truncated tail) must be stripped too, and from either end. Handling only
    // the leading case left a truncated trailing block inflating the word count instead.
    write("AR\n<system-reminder>truncated context that never closes", LONG);
    assert.equal(decide(), "block", "an unclosed TRAILING harness block is stripped, not counted as the Owner's words");
    write("<system-reminder>truncated and never closed", LONG);
    assert.equal(decide(), "allow", "an unclosed LEADING block leaves no Owner text, so there is no question");
    // …but an INLINE mention of a tag is the Owner's own words. Stripping from it would truncate the
    // question, drop its "?", and silently disable the size check on a genuine short question.
    write("Is `<system-reminder>` supported?", LONG);
    assert.equal(decide(), "block", "an inline tag MENTION is Owner text, not an injected block");
    // A CLOSED tag pair inline in the Owner's sentence is their text too (v1.5.1). The unanchored
    // strip this pins against erased the Owner's words from around the pair, shrinking a long
    // question below the short-question ceiling and arming the size check where it must stay
    // silent — a FALSE BLOCK, the direction that costs the Owner most.
    const w30 = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    write(`Is <system-reminder>${w30}</system-reminder> fine?`, LONG);
    assert.equal(decide(), "allow", "a long question stays long — an inline CLOSED pair is not stripped");
    // When such a question IS short the size check fires fairly — and quotes the Owner's words
    // intact, which the unanchored strip erased from the echo.
    write("Is <system-reminder>this component</system-reminder> supported?", LONG);
    assert.equal(decide(), "block", "a SHORT question with a short inline closed pair is still sized");
    assert.match(JSON.parse(run().stdout).reason, /this component/,
      "the Owner's inline words survive into the echoed question");
    // The line anchor tolerates the harness's own indentation: a genuine own-line block still strips
    // (the leading/trailing rows above pin the unindented shape).
    write("  <system-reminder>project context blob</system-reminder>\nAR", LONG);
    assert.equal(decide(), "block", "an INDENTED own-line injected block is still stripped");
    // Two closed blocks GLUED on one line: stripping the first leaves a space, so the second then
    // begins the line. A single strip pass left it for the UNCLOSED rule, whose to-end-of-turn
    // sweep erased the Owner's REAL question after it — the size check silently off (cold seat,
    // executed). The fixpoint loop strips them all; the Owner's text survives.
    write("<system-reminder>a</system-reminder> <task-notification>b</task-notification>\nAR", LONG);
    assert.equal(decide(), "block", "adjacent glued blocks are BOTH stripped and the question survives");
    write("<system-reminder>a</system-reminder><task-notification>b</task-notification>", LONG);
    assert.equal(decide(), "allow", "glued blocks with nothing typed leave no question to size");
    // CHARACTERIZATION (anchor boundary, fails open): a closed block GLUED to the Owner's text with
    // no separator does not begin a line, so it reads as Owner text — the harness emits injected
    // blocks on their own lines, the principle both strip rules encode. Pinned so a harness
    // formatting change flips this visibly instead of silently.
    write("AR<system-reminder>project context blob</system-reminder>", LONG);
    assert.equal(decide(), "allow", "a block glued to Owner text with no separator reads as Owner text (documented boundary)");

    // --- a subagent's prompt must not be mistaken for the Owner's message ---
    writeEntries([
      { type: "user", message: { role: "user", content: "AR" } },
      { type: "user", isSidechain: true, message: { role: "user", content: `subagent brief: ${LONG}` } },
      { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "subagent result" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: LONG }] } },
    ]);
    assert.equal(decide(), "block",
      "a sidechain (subagent) prompt is skipped — otherwise every turn that spawns an agent loses the size check");

    // --- fail-open paths: each MUST allow, and exit 0, or the sensor could wedge a session ---
    write("AR", LONG);
    assert.equal(decide({ stop_hook_active: true }), "allow", "loop safety: stop_hook_active always allows");
    assert.equal(decide({}, { WORKFLOW_KIT_COMMS_GUARD: "false" }), "allow", "the off switch allows");
    assert.equal(decide({ transcript_path: "/nonexistent/nope.jsonl" }), "allow", "an unreadable transcript allows");
    const garbage = spawnSync("node", [hook], { cwd: dir, encoding: "utf8", input: "NOT JSON{", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(garbage.status, 0, "malformed stdin exits 0");
    assert.ok(!garbage.stdout.includes("block"), "malformed stdin allows");

    // --- the block REASON must be true, not just present ---
    write("AR", LONG);
    const reason = JSON.parse(run().stdout).reason;
    assert.match(reason, /Alex/, "the reason names the actual Owner from the generated doc");
    assert.match(reason, /ALREADY SEEN/, "the reason states the honest limit: the message cannot be retracted");
    assert.match(reason, /SIZE MISMATCH/, "the reason names the check that actually fired");

    // --- DORMANT, proven by reverting the arming condition ---
    writeFileSync(doc, readFileSync(doc, "utf8").replace(/Alex/g, "{{OWNER_NAME}}"));
    assert.equal(decide(), "allow", "an unfilled {{OWNER_NAME}} leaves the sensor DORMANT (allows unconditionally)");
    // A heading the hook cannot parse is ALSO dormant — and init reports it that way (test below).
    writeFileSync(doc, readFileSync(doc, "utf8").replace(/^## How to talk to.*$/m, "## Owner notes"));
    assert.equal(decide(), "allow", "a retitled heading leaves the sensor DORMANT");
    rmSync(doc);
    assert.equal(decide(), "allow", "an ABSENT core/OWNER_COMMS.md allows (no contract, no nudge)");
  } finally { cleanup(); }
});

test("init's armed/dormant report comes from the hook's own predicate, so it cannot drift", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const initSays = () => execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt"], { encoding: "utf8" })
      .split("\n").find((l) => l.includes("core/OWNER_COMMS.md:")) ?? "";
    // For each shape, init's WORD and the hook's BEHAVIOUR must agree. A paraphrased predicate here
    // announced ARMED for headings the hook could not parse — a false statement about a control.
    const shapes = [
      ["## How to talk to Alex — Owner, not a developer", true, "the shipped heading"],
      ["## How to talk to Alex - Owner, not a developer", false, "em dash normalized to a hyphen"],
      ["## How to talk to Alex", false, "heading tidied"],
      ["## Owner notes", false, "heading retitled"],
      ["## How to talk to {{OWNER_NAME}} — Owner, not a developer", false, "name never filled"],
    ];
    const original = readFileSync(doc, "utf8");
    for (const [heading, wantArmed, label] of shapes) {
      writeFileSync(doc, original.replace(/^## How to talk to.*$/m, heading));
      const armedPerHook = ownerContract(dir) !== null;
      assert.equal(armedPerHook, wantArmed, `hook: ${label} ⇒ ${wantArmed ? "armed" : "dormant"}`);
      const line = initSays();
      assert.equal(/is ARMED/.test(line), wantArmed, `init AGREES with the hook for ${label}: ${line.trim()}`);
      assert.equal(/DORMANT/.test(line), !wantArmed, `init says dormant exactly when the hook is dormant (${label})`);
    }
  } finally { cleanup(); }
});

test("the template's EXAMPLE shorthand is never harvested as the Owner's own vocabulary", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    // Armed on the name alone, but {{OWNER_SHORTHAND}} is still unfilled: the only `TOKEN` = gloss
    // rows in the file are the template's fenced EXAMPLES. Harvesting those would hand this Owner
    // someone else's vocabulary and make the sensor act on shorthand they never use.
    assert.deepEqual(ownerContract(dir).questionTokens, [],
      "fenced example rows contribute no question tokens");
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`LE` = loose ends pending? — what is still open.\n`CMPD` = commit, merge, push, deploy."));
    const tokens = ownerContract(dir).questionTokens;
    assert.deepEqual(tokens, ["LE"], "real rows outside the fence ARE harvested, and only the ones that ask");
  } finally { cleanup(); }
});

test("the shorthand harvest is UNANCHORED (inline-prose rows covered), and an empty harvest WARNS instead of silently disarming", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const original = readFileSync(doc, "utf8");
    const transcript = path.join(dir, "transcript.jsonl");
    const LONG = "word ".repeat(400);
    const write = (user, assistantText) => writeFileSync(transcript, [
      { type: "user", message: { role: "user", content: user } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: assistantText }] } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n");
    // Crash-aware, and it returns stderr too — the WARN channel is part of the contract under test.
    const run = () => {
      const r = spawnSync("node", [path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs")], {
        cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
      assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
      return { decision: r.stdout.includes('"decision":"block"') ? "block" : "allow", stderr: r.stderr };
    };

    // (1) INLINE-PROSE rows — a real adopter format (the executed downstream failure: a doc in this
    // shape harvested ZERO tokens under the line-anchored rule, and "AR" + a 430-word inventory
    // sailed through). The harvest must not require one-row-per-line, and the LIVE hook must act on
    // what it harvested.
    writeFileSync(doc, original.replace("{{OWNER_SHORTHAND}}",
      "Alex types `RD` = report done? — is the report finished. Alex also types `MIS` = make it so — proceed on the agreed scope."));
    assert.deepEqual(ownerContract(dir).questionTokens, ["RD"], "inline-prose rows are harvested, and only the one that asks");
    assert.equal(ownerContract(dir).shorthandUnharvested, false, "a working harvest raises no warning flag");
    write("RD", LONG);
    let r = run();
    assert.equal(r.decision, "block", "the LIVE hook enforces a question token harvested from inline prose");
    assert.doesNotMatch(r.stderr, /WARN/, "no coverage warning while coverage exists");
    write("MIS", LONG);
    assert.equal(run().decision, "allow", "an inline-prose INSTRUCTION (no '?' in its gloss) still earns a work report");

    // (2) FENCED-EXAMPLES-ONLY — the pristine generated doc, armed by name but {{OWNER_SHORTHAND}}
    // never filled. Definition-shaped rows exist (the template's fenced examples) yet NONE parse
    // outside the fence: question coverage is OFF and the kit has no fallback vocabulary to fail
    // toward, so the hook must SAY so — stderr, non-blocking — instead of running silently uncovered.
    writeFileSync(doc, original.replace("{{OWNER_SHORTHAND}}", ""));
    assert.equal(ownerContract(dir).shorthandUnharvested, true, "fenced-examples-only sets the warning flag");
    write("AR", LONG);
    r = run();
    assert.equal(r.decision, "allow", "the warning never blocks — the sensor still fails open");
    assert.match(r.stderr, /guard-owner-comms WARN/, "the empty harvest is announced on stderr");
    assert.match(r.stderr, /coverage is OFF/, "…and the warning says what is actually off");

    // (2b) A row a human plainly WROTE as a definition but the parser cannot read — double
    // backticks, the fence deleted. Not harvestable (single backticks are the documented format),
    // so it must at least WARN: zero parsed definitions while the doc visibly tries to define
    // shorthand is exactly the silently-blind state the warning exists for (cold seat, executed).
    writeFileSync(doc, "## How to talk to Alex — Owner, not a developer\n\n``AR`` = archive ready? — closed out on the remote.\n");
    assert.deepEqual(ownerContract(dir).questionTokens, [], "a double-backtick row does not parse (single backticks are the format)");
    assert.equal(ownerContract(dir).shorthandUnharvested, true, "…but it is visibly definition-shaped, so the flag is raised");
    write("AR", LONG);
    r = run();
    assert.equal(r.decision, "allow", "unparsed vocabulary cannot block");
    assert.match(r.stderr, /guard-owner-comms WARN/, "…and the blindness is announced, never silent");

    // (3) An ALL-INSTRUCTION vocabulary parsed fine — question coverage is legitimately empty, not
    // lost, so warning here would be a perpetual false alarm for that adopter.
    writeFileSync(doc, original.replace("{{OWNER_SHORTHAND}}", "`CMPD` = commit, merge, push, deploy."));
    assert.equal(ownerContract(dir).shorthandUnharvested, false, "a parsed instruction-only vocabulary is not a failed harvest");
    write("AR", LONG);
    assert.doesNotMatch(run().stderr, /WARN/, "no warning when the harvest worked and the Owner just has no question shorthand");

    // (4) NO shorthand section at all (the template says to delete it when the Owner has none):
    // nothing definition-shaped anywhere, so silence is the truthful report.
    const cut = original.slice(0, original.indexOf("**Alex's shorthand"));
    assert.notEqual(cut, original, "the generated doc carries the shorthand section marker this case removes");
    writeFileSync(doc, cut);
    assert.equal(ownerContract(dir).shorthandUnharvested, false, "no shorthand section, no warning flag");
    write("AR", LONG);
    r = run();
    assert.equal(r.decision, "allow", "no section means no question tokens — AR is not shorthand here");
    assert.doesNotMatch(r.stderr, /WARN/, "an Owner with no shorthand section is a legitimate state, not a warning");

    // (5) CRLF line endings (a doc edited on Windows). A blank CRLF line must still terminate a
    // gloss: without \r in the boundary class, a "?" in unrelated LATER prose bled into an
    // instruction's gloss and turned it into a question token — a false block (found by
    // cross-family review, confirmed by execution both ways). The question row still harvests.
    writeFileSync(doc, "## How to talk to Alex — Owner, not a developer\r\n\r\n" +
      "`MIS` = make it so — proceed.\r\n\r\nDo you want examples?\r\n\r\n`AR` = archive ready? — closed out.\r\n");
    assert.deepEqual(ownerContract(dir).questionTokens, ["AR"],
      "CRLF: the question row harvests and the instruction stays an instruction");
    write("MIS", LONG);
    assert.equal(run().decision, "allow", "CRLF: a '?' beyond a blank CRLF line does not bleed into MIS's gloss");
    write("AR", LONG);
    assert.equal(run().decision, "block", "CRLF: AR is still a covered question token");

    // (6) DOCUMENTED RESIDUAL (accepted — delete if the harvest is ever section-scoped): the
    // `TOKEN` = gloss shape is RESERVED NOTATION throughout this doc (the template says so). An
    // incidental backticked ALL-CAPS mention in unrelated prose harvests exactly as a line-start
    // one already did pre-v1.5.1 — the unanchored harvest WIDENS that pre-existing exposure to
    // mid-prose, it does not create the class (executed both ways against the old hook). Bounded:
    // a false block also needs the Owner to type that token alone as a whole turn, and the sensor
    // stays fail-open, one nudge per turn max.
    writeFileSync(doc, original
      .replace("{{OWNER_SHORTHAND}}", "")
      .replace("Explaining more is not dumbing down",
        "By default the `PORT` = 8080? staging value applies. Explaining more is not dumbing down"));
    assert.deepEqual(ownerContract(dir).questionTokens, ["PORT"],
      "RESERVED NOTATION: an incidental backticked ALL-CAPS mention in prose harvests (documented residual)");
    // …and the same reserved shape INSIDE another token's gloss splits it: the embedded mention
    // reads as the NEXT definition (ending AR's gloss before its "?") and harvests itself. Inherent
    // to inline-prose support — a next definition mid-prose IS a gloss boundary — so the template
    // documents it (keep the shape out of glosses) rather than the parser guessing. Executed both
    // ways: the old line-anchored harvest read the whole line as AR's gloss (cold seat finding).
    writeFileSync(doc, "## How to talk to Alex — Owner, not a developer\n\n`AR` = the config uses `ENV` = prod, is it ready?\n");
    assert.deepEqual(ownerContract(dir).questionTokens, ["ENV"],
      "RESERVED NOTATION in a gloss reads as the next definition (documented residual)");
  } finally { cleanup(); }
});

test("DEFERRED — not desired; delete when fixed: nested injected blocks hide the question token", () => {
  // A block nested INSIDE another block of the same tag defeats the lazy matcher: the strip ends at
  // the inner closer, the residue keeps `AR` from standing alone, and the size check skips. This
  // asserts the CURRENT behavior (allow — a missed advisory nudge, failing OPEN), which is identical
  // in this hook, its pre-v1.5.1 version, and the downstream adopter's merged baseline. It is NOT
  // the desired behavior; a fix needs a balanced scanner, deferred as new surface for a harness
  // shape never observed in the wild (same ruling as the downstream port's ratified DEFER).
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`AR` = archive ready? — is this thread closed out on the remote."));
    const transcript = path.join(dir, "transcript.jsonl");
    const nested = "<system-reminder>outer\n<system-reminder>inner</system-reminder>\nouter</system-reminder>\nAR";
    writeFileSync(transcript, [
      { type: "user", message: { role: "user", content: nested } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "word ".repeat(400) }] } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const r = spawnSync("node", [path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs")], {
      cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
    assert.ok(!r.stdout.includes('"decision":"block"'),
      "characterization: the nested-block residue hides AR and the size check skips (fails open)");
  } finally { cleanup(); }
});

test("FM1: init sets core.hooksPath; the portable FM1 test goes RED when it is unset", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adopt-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    // --skip-codex-prompt keeps `npm test` HERMETIC: init otherwise defaults to the user-global
    // ~/.codex/prompts and this test would write there (a real side effect outside any scratch dir).
    execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--skip-codex-prompt"],
      { stdio: "ignore" });
    // init applied the FM1 mitigation
    const hp = execFileSync("git", ["-C", dir, "config", "core.hooksPath"], { encoding: "utf8" }).trim();
    assert.equal(hp, ".githooks", "init must set core.hooksPath=.githooks");
    // install the portable FM1 test into the adopter and prove it discriminates
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    copyFileSync(path.join(KIT, "templates", "kit-precommit.test.mjs"), path.join(dir, "tests", "kit-precommit.test.mjs"));
    const env = cleanTestEnv();
    const green = spawnSync("node", ["--test", "tests/kit-precommit.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.equal(green.status, 0, `FM1 test should PASS when core.hooksPath is set:\n${green.stdout}`);
    // PLANT THE BUG: unset core.hooksPath -> the FM1 test must go RED
    execFileSync("git", ["-C", dir, "config", "--unset", "core.hooksPath"]);
    const red = spawnSync("node", ["--test", "tests/kit-precommit.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.notEqual(red.status, 0, "FM1 test must FAIL when core.hooksPath is unset (else the mitigation is fiction)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("v2.0 Codex lane: the assets install, the model is [G], and --skip-codex-lane leaves no residue", () => {
  // These are CONVENIENCES, not controls — v2.0 registers no Codex hooks (PORTABILITY.md § Why the
  // Codex lane is unguarded). What is gated here is the WIRING, the same way the /thread-restart
  // nudge is gated: the files land, the [G] placeholder behaves, and the opt-out is total.
  const mk = () => { const d = mkdtempSync(path.join(os.tmpdir(), "kit-codex-")); execFileSync("git", ["init", "-q", d]); return d; };
  const run = (d, extra) => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", d,
    "--repo-name", "demo", "--skip-codex-prompt", ...extra], { encoding: "utf8" });

  const filled = mk(), unfilled = mk(), skipped = mk();
  try {
    // 1. WITH the flag: the seat's model is bound.
    assert.equal(run(filled, ["--codex-cold-model", "some-model-v1"]).status, 0);
    assert.ok(existsSync(path.join(filled, ".codex", "config.toml")), "config.toml installs");
    const seat = readFileSync(path.join(filled, ".codex", "agents", "cold-reviewer.toml"), "utf8");
    assert.match(seat, /^model = "some-model-v1"$/m, "--codex-cold-model fills the seat");
    assert.doesNotMatch(seat, /\{\{CODEX_COLD_MODEL\}\}/, "no placeholder survives once filled");
    // The shipped config must not register hooks: Codex warns when both it and hooks.json declare
    // them, and v2.0 deliberately registers none at all.
    assert.doesNotMatch(readFileSync(path.join(filled, ".codex", "config.toml"), "utf8"),
      /^\s*\[{1,2}\s*hooks[.\]]/m, "the shipped config.toml declares NO hooks");

    // 2. WITHOUT it: the placeholder SURVIVES and init reports the file as incomplete. An unfilled
    // model must be visible, never silently substituted with someone else's.
    const r2 = run(unfilled, []);
    assert.equal(r2.status, 0);
    assert.match(readFileSync(path.join(unfilled, ".codex", "agents", "cold-reviewer.toml"), "utf8"),
      /\{\{CODEX_COLD_MODEL\}\}/, "the placeholder survives when unfilled");
    assert.match(r2.stdout, /Complete the placeholders in:.*cold-reviewer\.toml/,
      "…and init's checklist NAMES the incomplete file (an unusable seat must not look finished)");

    // 3. Opt-out is TOTAL — not a partial tree the adopter has to clean up by hand.
    assert.equal(run(skipped, ["--skip-codex-lane"]).status, 0);
    assert.equal(existsSync(path.join(skipped, ".codex")), false, "--skip-codex-lane writes no .codex at all");

    // 4. Idempotent: a re-run keeps a hand-edited seat rather than clobbering the adopter's binding.
    writeFileSync(path.join(filled, ".codex", "agents", "cold-reviewer.toml"), "# hand-edited\n");
    assert.equal(run(filled, ["--codex-cold-model", "some-model-v1"]).status, 0);
    assert.equal(readFileSync(path.join(filled, ".codex", "agents", "cold-reviewer.toml"), "utf8"),
      "# hand-edited\n", "a re-run without --force keeps the adopter's edit");
  } finally { for (const d of [filled, unfilled, skipped]) rmSync(d, { recursive: true, force: true }); }
});

test("--codex-cold-model is validated: it lands inside a TOML string, so it cannot be allowed to escape one", () => {
  // The value is interpolated as `model = "<value>"` into a file that ALSO carries
  // `sandbox_mode = "read-only"`. An unvalidated value containing a quote and a newline closes the
  // string and the remainder becomes TOML — so a mistyped or pasted flag could silently re-cage the
  // review seat. Refused in argument parsing, before anything is written.
  const mk = () => { const d = mkdtempSync(path.join(os.tmpdir(), "kit-ccm-")); execFileSync("git", ["init", "-q", d]); return d; };
  const run = (d, model) => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", d,
    "--repo-name", "x", "--skip-codex-prompt", "--codex-cold-model", model], { encoding: "utf8" });

  const bad = mk();
  try {
    const r = run(bad, 'm"\nsandbox_mode = "danger-full-access');
    assert.equal(r.status, 2, "a value that escapes the TOML string is refused");
    assert.match(r.stderr, /--codex-cold-model must be a plain model name/, "and the refusal names the rule");
    assert.equal(existsSync(path.join(bad, ".codex", "agents", "cold-reviewer.toml")), false,
      "…having written NO seat: the refusal happens in parsing, before any file is created");
  } finally { rmSync(bad, { recursive: true, force: true }); }

  // The other direction, and it matters as much: an over-strict rule that rejected real model names
  // would push adopters to hand-edit the seat, which is how the validation gets routed around.
  for (const model of ["gpt-5.6-terra", "claude-opus-5", "some.model_v2-x", "openai/gpt-x"]) {
    const ok = mk();
    try {
      assert.equal(run(ok, model).status, 0, `a legitimate model name is accepted: ${model}`);
      const seat = readFileSync(path.join(ok, ".codex", "agents", "cold-reviewer.toml"), "utf8");
      assert.match(seat, new RegExp(`^model = "${model.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"$`, "m"), "…and lands verbatim");
      assert.match(seat, /^sandbox_mode = "read-only"$/m, "…with the seat's own cage intact");
    } finally { rmSync(ok, { recursive: true, force: true }); }
  }
});

test("a broken .codex path warns and the adopt CONTINUES — the Codex lane cannot take the guards down", () => {
  // init SAYS the adopt continues if the Codex lane fails. That sentence was false: the cold-review
  // seat is generated in the shared [G] template loop, which is deliberately NOT failure-isolated,
  // so a regular file sitting at `.codex` threw ENOTDIR and killed the run with a raw stack trace —
  // AFTER the guards were registered. Not the zero-registration fail-open, but a partial adopt
  // contradicting its own contract. Found by the cross-family seat.
  //
  // v2.1 CHANGED WHAT THIS COSTS, so the assertion changed with it. Through v2.0 the `.codex/`
  // assets were CONVENIENCES and the warning said so. They now carry the lane's write ENFORCEMENT,
  // so the same failure means the Codex lane is UNGUARDED — and a warning that still called it a
  // lost convenience would be the understatement this suite exists to catch. What must NOT change is
  // the isolation itself: a broken Codex lane may never take the Claude guards or the commit floor
  // down with it.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codexbroken-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(path.join(dir, ".codex"), "a regular file, not a directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "x", "--skip-codex-prompt"], { encoding: "utf8" });

    assert.equal(r.status, 0, `the adopt completes despite an unusable .codex: ${r.stderr}`);
    assert.match(r.stderr, /\.codex\/ lane could not be installed/, "…and says so plainly");
    assert.match(r.stderr, /CODEX LANE IS UNGUARDED/,
      "…naming the real cost now that this lane carries enforcement, not a lost convenience");
    assert.match(r.stderr, /no write guards, no registration, no cold-review seat/, "…and what is missing");

    // The load-bearing half: everything that actually enforces must still be in place. A warning is
    // worth nothing if the run stopped before the controls landed.
    const settings = readFileSync(path.join(dir, ".claude", "settings.json"), "utf8");
    assert.match(settings, /guard-lane-authoring/, "the Claude guards are still registered");
    assert.ok(existsSync(path.join(dir, ".githooks", "pre-commit")), "the every-lane commit floor still installed");
    assert.ok(existsSync(path.join(dir, "core", "BINDINGS.md")), "the other [G] docs were still generated");
    assert.ok(existsSync(path.join(dir, "core", "GATES.md")), "the [P] method docs still landed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("round-2 seat findings: removed-flag `=` spelling, the hooks DETECTOR, and an honest skip message", () => {
  const mk = () => { const d = mkdtempSync(path.join(os.tmpdir(), "kit-r2-")); execFileSync("git", ["init", "-q", d]); return d; };
  const init = (d, ...extra) => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", d,
    "--repo-name", "x", "--skip-codex-prompt", ...extra], { encoding: "utf8" });

  // 1. `--flag=value` fell through to the generic "unknown argument", so the adopter most likely to
  // have SCRIPTED the flag was the one who got no migration sentence.
  const eq = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--risk-tokens=billing"], { encoding: "utf8" });
  assert.equal(eq.status, 2, "the `=` spelling still exits 2");
  assert.match(eq.stderr, /--risk-tokens was REMOVED at v2\.0/, "…and now gets the migration message, not 'unknown argument'");

  // 2. The "your config declares hooks" warning is a DETECTOR, and it only matched a TOML table
  // header. `hooks = "./hooks.json"` is the spelling Codex's own schema uses, so the likeliest one
  // went undetected — a fail-open in the thing whose job is to notice.
  for (const spelling of ['hooks = "./hooks.json"\n', "[hooks]\n", "hooks.pre_tool_use = [{}]\n"]) {
    const d = mk();
    try {
      mkdirSync(path.join(d, ".codex"), { recursive: true });
      writeFileSync(path.join(d, ".codex", "config.toml"), spelling);
      assert.match(init(d).stderr, /DECLARES HOOKS/,
        `an adopter config using ${JSON.stringify(spelling.trim())} is detected`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // …and it must not cry wolf on the kit's own shipped config, or the warning trains adopters to ignore it.
  const clean = mk();
  try {
    assert.equal(init(clean).status, 0);
    assert.doesNotMatch(init(clean).stderr, /DECLARES HOOKS/, "the kit's own config.toml does NOT trip the detector");
  } finally { rmSync(clean, { recursive: true, force: true }); }

  // 3. `--skip-codex-lane` printed "SKIPPED" unconditionally — including over a .codex/ that a
  // previous adopt had already written and that this run left sitting there.
  const reran = mk();
  try {
    assert.equal(init(reran, "--codex-cold-model", "m-1").status, 0);
    assert.ok(existsSync(path.join(reran, ".codex", "config.toml")), "first adopt wrote .codex/");
    const second = init(reran, "--skip-codex-lane");
    assert.match(second.stdout, /ALREADY EXISTS here and was left untouched/,
      "a re-run with the skip flag says the .codex/ is still there rather than implying it is absent");
    assert.ok(existsSync(path.join(reran, ".codex", "config.toml")), "…and it genuinely is still there");
  } finally { rmSync(reran, { recursive: true, force: true }); }
});
