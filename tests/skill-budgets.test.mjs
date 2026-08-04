// workflow-kit — governance tests for the v1.7 machinery, four groups:
//   (1) the skill-budget checker: the kit's own tree passes, and the CLI is observed FAILING on
//       planted defects (over-budget, undeclared, over-cap, marker-in-shim, empty class) — a
//       checker only ever seen green is a checker never observed working;
//   (2) the boot-set consistency assertion: the boot-order enumerations in the entry-stub
//       templates, core/README.md, core/MULTI_AGENT.md, core/WORKFLOW.md and the /boot skill all
//       agree with one canon — nothing else asserts these stay in agreement, so adding or
//       renaming a method doc could otherwise let them silently drift;
//   (3) init wiring for the three ritual skills (placement, shim resolution, idempotency, hermetic
//       Codex dir);
//   (4) the [P]-upgrade rule: a plain init re-run ships NONE of this release's edits to existing
//       [P] files, so the v1.7 release note must say --force — executed both ways, note pinned.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = path.join(KIT, "scripts", "check-skill-budgets.mjs");

// A nested `node --test` inherits the parent runner's env (NODE_TEST_CONTEXT / NODE_OPTIONS) and
// then SKIPS its files with a warning instead of running them — so an inner suite would look green
// while executing nothing. Strip those so the child's own exit code and output are trustworthy.
// (Same helper, same reason, as tests/kit-controls.test.mjs.)
function cleanTestEnv(extra = {}) {
  const e = { ...process.env, ...extra };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST")) delete e[k];
  return e;
}

// ---------------------------------------------------------------------------------------------
// (1) the budget checker
// ---------------------------------------------------------------------------------------------

test("the kit's own tree passes the budget checker, and npm test actually runs it", () => {
  const r = spawnSync("node", [CHECKER], { encoding: "utf8" });
  assert.equal(r.status, 0, `the kit's own governed files must be within budget:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /governed file\(s\) OK/, "the summary line reports the pass positively");
  // Every governed class contributes rows — a class silently dropping out of discovery would
  // otherwise pass unnoticed (absence is not a pass).
  for (const probe of ["skills/boot/SKILL.md", "skill-shims/claude/boot.md", "agents/cold-reviewer.md"]) {
    assert.match(r.stdout, new RegExp(probe.replace(/[/.]/g, "\\$&")), `${probe} appears in the report`);
  }
  // EVERY GOVERNED CLASS contributes rows, INCLUDING the reference layer. A checker that governed
  // only `*/SKILL.md` would un-govern INVOKE.md/BULLET.md — the split the doctrine prefers — and
  // the class-probe list above would not notice, because it named only bodies (found by a cold
  // seat's mutation battery: that mutation SURVIVED).
  for (const probe of ["skills/frontier-review/INVOKE.md", "skills/humanize/BULLET.md",
    "commands/claude/thread-restart.md"]) {
    assert.match(r.stdout, new RegExp(probe.replace(/[/.]/g, "\\$&")), `${probe} is governed`);
  }
  // THE WIRING IS THE SENSOR'S LIVENESS: a checker no script runs is dead machinery. Assert the
  // runner ACTUALLY EXECUTES it, not merely that a script string contains its name — `echo
  // check-skill-budgets.mjs` satisfied the old regex while running nothing.
  const pkg = JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8"));
  assert.match(pkg.scripts["check:skill-budgets"] ?? "", /check-skill-budgets\.mjs/, "the npm script exists");
  const runner = spawnSync("node", [path.join(KIT, "scripts", "check-skill-budgets.mjs")], { encoding: "utf8" });
  assert.match(runner.stdout, /governed file\(s\) OK/, "the budget rung produces real output when run");
  // The RUNNER must name it as a rung it executes — asserted against the runner source, since
  // executing the runner from inside itself recurses.
  const runnerSrc = readFileSync(path.join(KIT, "scripts", "run-checks.mjs"), "utf8");
  assert.match(runnerSrc, /check-skill-budgets\.mjs/, "run-checks invokes the budget rung");
  assert.match(pkg.scripts.test ?? "", /run-checks\.mjs/, "npm test is the runner (both rungs, combined exit)");
});

test("npm test runs BOTH rungs: a red budget rung must not preempt the control suite", () => {
  // With `a && b`, one word over budget stops the enforcement suite, the acceptance harness and
  // the FM1 guard from running at all — a prose notice preempting the proof that the controls
  // work. run-checks runs both and combines the exit code; this pins both halves.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-rungs-"));
  try {
    // A MINIMAL tree, not a copy of the kit. Copying the kit would make this test spawn the kit's
    // whole suite — which contains THIS test — and recurse without bound (it did, once).
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    mkdirSync(path.join(dir, "skills", "x"), { recursive: true });
    mkdirSync(path.join(dir, "skill-shims", "claude"), { recursive: true });
    mkdirSync(path.join(dir, "agents"), { recursive: true });
    mkdirSync(path.join(dir, "commands"), { recursive: true });
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    cpSync(path.join(KIT, "scripts", "run-checks.mjs"), path.join(dir, "scripts", "run-checks.mjs"));
    cpSync(CHECKER, path.join(dir, "scripts", "check-skill-budgets.mjs"));
    writeFileSync(path.join(dir, "skill-shims", "claude", "x.md"), "pointer\n");
    writeFileSync(path.join(dir, "agents", "seat.md"), "seat\n");
    writeFileSync(path.join(dir, "commands", "c.md"), "cmd\n");
    // A stand-in control suite whose only job is to be OBSERVED RUNNING after the red rung.
    writeFileSync(path.join(dir, "tests", "stub.test.mjs"),
      'import { test } from "node:test";\ntest("stand-in control suite ran", () => {});\n');
    // …and the budget rung FAILS: a skill 400 words past its declared budget.
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 10\n" + "word ".repeat(400) + "\n");
    const r = spawnSync("node", [path.join(dir, "scripts", "run-checks.mjs")], { encoding: "utf8", cwd: dir, env: cleanTestEnv() });
    assert.notEqual(r.status, 0, "an over-budget file makes npm test RED");
    assert.match(r.stdout, /OVER budget/, "…the budget rung reported it");
    // THE POINT: the control suite still ran. Its own output must be present despite the red rung.
    assert.match(r.stdout + r.stderr, /kit control suite/, "the control suite rung still ran");
    assert.match(r.stdout + r.stderr, /tests \d+/, "…and produced a real test tally, not a skipped rung");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A healthy planted tree carrying EVERY governed class — a fixture missing one would make that
// class's row an EMPTY-CLASS failure and mask whatever the case under test is really asserting.
// Word counts are whole-file `wc -w`, so content is generated arithmetically ("Word budget: 50"
// itself counts 3 words).
function plantTree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-budget-"));
  mkdirSync(path.join(dir, "skills", "x"), { recursive: true });
  mkdirSync(path.join(dir, "skill-shims", "claude"), { recursive: true });
  mkdirSync(path.join(dir, "agents"), { recursive: true });
  mkdirSync(path.join(dir, "commands", "claude"), { recursive: true });
  writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 50\n" + "word ".repeat(20) + "\n");
  writeFileSync(path.join(dir, "skill-shims", "claude", "x.md"), "Pointer at .agents/skills/x/SKILL.md — no rules here.\n");
  writeFileSync(path.join(dir, "agents", "seat.md"), "A small reviewer seat definition.\n");
  writeFileSync(path.join(dir, "commands", "claude", "cmd.md"), "A small command asset.\n");
  return dir;
}

function checkerOn(dir, args = []) {
  return spawnSync("node", [CHECKER, ...args], {
    encoding: "utf8",
    env: { ...process.env, SKILL_BUDGETS_ROOT: dir },
  });
}

test("the checker's exit code is provable BOTH ways on planted trees", () => {
  const dir = plantTree();
  try {
    // Healthy → green, and the override is announced so a planted run can't pass as a real one.
    let r = checkerOn(dir);
    assert.equal(r.status, 0, `healthy planted tree must pass:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /planted tree, debt ledger NOT applied/, "the root override is announced, never silent");

    // OVER a declared skill budget → red, named.
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 10\n" + "word ".repeat(40) + "\n");
    r = checkerOn(dir);
    assert.equal(r.status, 1, "an over-budget skill fails the run");
    assert.match(r.stdout, /OVER budget/, "…and the state names the defect");

    // UNDECLARED skill → red. A budget line BEYOND the head window must not count as declared —
    // scanning the whole file would let a quoted example satisfy the check.
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "filler\n".repeat(12) + "Word budget: 50\n" + "word ".repeat(5) + "\n");
    r = checkerOn(dir);
    assert.equal(r.status, 1, "a marker outside the first 12 lines is UNDECLARED");
    assert.match(r.stdout, /UNDECLARED/, "…with the ungoverned-by-omission state");
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 50\n" + "word ".repeat(20) + "\n"); // restore

    // NEAR-CAP is a WARN, not a failure: headroom under the margin still exits 0.
    mkdirSync(path.join(dir, "skills", "y"), { recursive: true });
    writeFileSync(path.join(dir, "skills", "y", "SKILL.md"), "Word budget: 40\n" + "word ".repeat(30) + "\n");
    r = checkerOn(dir);
    assert.equal(r.status, 0, "a near-cap file is a notice, not a failure");
    assert.match(r.stdout, /WARN\s+33 \/ 40/, "…reported as WARN with the numbers");
    rmSync(path.join(dir, "skills", "y"), { recursive: true, force: true });

    // A shim over the CLASS cap → red.
    writeFileSync(path.join(dir, "skill-shims", "claude", "x.md"), "word ".repeat(260) + "\n");
    r = checkerOn(dir);
    assert.equal(r.status, 1, "a shim past the class cap fails");
    assert.match(r.stdout, /OVER the class cap/, "…and the reason names the class-cap policy");

    // A shim DECLARING a budget → red (the shared-body invariant, mechanical).
    writeFileSync(path.join(dir, "skill-shims", "claude", "x.md"), "Word budget: 100\nPointer only.\n");
    r = checkerOn(dir);
    assert.equal(r.status, 1, "a shim declaring a budget fails");
    assert.match(r.stdout, /MARKER-IN-SHIM/, "…as MARKER-IN-SHIM, pointing rules back to the body");
    writeFileSync(path.join(dir, "skill-shims", "claude", "x.md"), "Pointer at .agents/skills/x/SKILL.md.\n"); // restore

    // An agent over its class cap → red.
    writeFileSync(path.join(dir, "agents", "seat.md"), "word ".repeat(510) + "\n");
    r = checkerOn(dir);
    assert.equal(r.status, 1, "an agent past the class cap fails");
    writeFileSync(path.join(dir, "agents", "seat.md"), "Small seat.\n"); // restore

    // A class with ZERO files → red: governing nothing is never a pass.
    rmSync(path.join(dir, "agents"), { recursive: true, force: true });
    r = checkerOn(dir);
    assert.equal(r.status, 1, "an empty class fails the run");
    assert.match(r.stdout, /EMPTY-CLASS/, "…named as an ungoverned class, not silently skipped");
    mkdirSync(path.join(dir, "agents"));
    writeFileSync(path.join(dir, "agents", "seat.md"), "Small seat.\n");

    // --json mirrors the same verdicts machine-readably — BOTH ways. Asserting only the healthy
    // direction leaves `process.exit(0)` hardcoded in the JSON branch fully green (a surviving
    // mutation), so the failing direction is pinned too.
    r = checkerOn(dir, ["--json"]);
    assert.equal(r.status, 0, "healthy tree under --json passes");
    let parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true, "--json reports ok:true");
    assert.ok(Array.isArray(parsed.results) && parsed.results.length >= 3, "…with a row per governed file");
    // The override must be visible to a MACHINE reader too. On the text path it prints a banner;
    // under --json it previously left no trace at all, so a consumer could not tell a planted run
    // (debt ledger emptied) from a real one.
    assert.equal(parsed.planted, true, "--json states it ran against a planted root");
    assert.equal(parsed.debtLedgerApplied, false, "…and that the debt ledger was NOT applied");
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 10\n" + "word ".repeat(40) + "\n");
    r = checkerOn(dir, ["--json"]);
    assert.equal(r.status, 1, "a violating tree under --json EXITS 1, not just reports ok:false");
    parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false, "…and says so in the payload");
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 50\n" + "word ".repeat(20) + "\n");

    // A budget that is not a USABLE BOUND must not pass. `Number("9".repeat(400))` is Infinity and
    // every finite count is below it, so a marker-shaped line would satisfy the gate while
    // bounding nothing — a fail-OPEN (found by the cross-family seat, reproduced here).
    for (const [bogus, label] of [["9".repeat(400), "an Infinity-valued budget"], ["0", "a zero budget"]]) {
      writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), `Word budget: ${bogus}\n` + "word ".repeat(60) + "\n");
      r = checkerOn(dir);
      assert.equal(r.status, 1, `${label} must not pass`);
      assert.match(r.stdout, /UNDECLARED/, `…it is treated as NO usable bound, not as a budget that always passes`);
    }
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 50\n" + "word ".repeat(20) + "\n");

    // UNREADABLE is a FAILURE, both for a file and for a directory. Flipping either to ok:true was
    // a surviving mutation: an unreadable artifact is UNGOVERNED, which must be loud.
    const dangling = path.join(dir, "skills", "x", "GHOST.md");
    symlinkSync(path.join(dir, "skills", "x", "nothing-here.md"), dangling);
    r = checkerOn(dir);
    assert.equal(r.status, 1, "a dangling symlink under a governed root FAILS");
    assert.match(r.stdout, /UNREADABLE/, "…as a structured UNREADABLE row, never a silent skip");
    rmSync(dangling, { force: true });
    assert.equal(checkerOn(dir).status, 0, "…and removing it restores green (the row was the cause)");

    // An unreadable FILE is a different path from a dangling symlink: discovery SUCCEEDS and the
    // read fails later, in checkDeclared. Flipping that branch to ok:true survived the battery
    // until this case existed — an artifact the checker cannot read is UNGOVERNED, which must be
    // loud whichever layer notices.
    const unreadable = path.join(dir, "skills", "x", "SKILL.md");
    chmodSync(unreadable, 0o000);
    try {
      const r2 = checkerOn(dir);
      // Skip rather than false-pass if the runner can read it anyway (root / permissive FS): a
      // case that cannot fail must not be reported as a case that passed.
      if (!/UNREADABLE/.test(r2.stdout)) {
        assert.equal(r2.status, 0, "environment can read a 0o000 file (root?) — case not exercised");
      } else {
        assert.equal(r2.status, 1, "an unreadable governed FILE fails the run");
      }
    } finally { chmodSync(unreadable, 0o644); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reference layer the body never points at is UNREACHABLE, and a bodyless skill dir fails", () => {
  // The doctrine prefers splitting an over-budget body into a sibling over raising its number —
  // but a sibling the body never names is a layer no executor is told to load, so anything moved
  // there is invisible. This is the STRUCTURAL half of "a correction may never move to a layer the
  // executor might not load"; the semantic half (is this sentence a correction?) stays a
  // review-time judgment and is deliberately NOT claimed here.
  const dir = plantTree();
  try {
    const body = path.join(dir, "skills", "x", "SKILL.md");
    const ref = path.join(dir, "skills", "x", "REF.md");
    writeFileSync(ref, "Word budget: 60\n" + "word ".repeat(20) + "\n");
    // POINTED AT → fine.
    writeFileSync(body, "Word budget: 60\nDetails live in REF.md beside this file.\n");
    assert.equal(checkerOn(dir).status, 0, "a sibling the body NAMES is a legitimate reference layer");
    // ORPHANED → fail, named.
    writeFileSync(body, "Word budget: 60\nThis body points at nothing.\n");
    const orphan = checkerOn(dir);
    assert.equal(orphan.status, 1, "an orphaned sibling FAILS");
    assert.match(orphan.stdout, /UNREACHABLE-LAYER/, "…under its own state");
    assert.match(orphan.stdout, /REF\.md/, "…naming the unreachable file");
    // NO BODY AT ALL → fail: the shims point at <name>/SKILL.md, so the command dead-ends.
    rmSync(body, { force: true });
    const bodyless = checkerOn(dir);
    assert.equal(bodyless.status, 1, "a skill directory with no SKILL.md FAILS");
    assert.match(bodyless.stdout, /NO-BODY/, "…under its own state");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the kit's own reference layers are reachable from their bodies", () => {
  // The live instances of the rule above: both real splits in this kit must stay pointed-at.
  for (const [body, sibling] of [
    ["skills/frontier-review/SKILL.md", "INVOKE.md"],
    ["skills/humanize/SKILL.md", "BULLET.md"],
  ]) {
    assert.match(readFileSync(path.join(KIT, body), "utf8"), new RegExp(sibling.replace(".", "\\.")),
      `${body} must point at its reference layer ${sibling}`);
  }
});

test("the CLI runs when invoked through a symlink — isMain uses realpath, not resolve", () => {
  // `path.resolve` !== the realpath of a symlinked invocation, so main() would never run: the CLI
  // exits 0 printing NOTHING, a false green on a violating tree. The kit's own header calls this
  // trap out; nothing pinned it (surviving mutation, cold seat).
  const dir = plantTree();
  const linkDir = mkdtempSync(path.join(os.tmpdir(), "kit-symlink-"));
  try {
    writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 10\n" + "word ".repeat(40) + "\n");
    const link = path.join(linkDir, "checker-link.mjs");
    symlinkSync(CHECKER, link);
    const r = spawnSync("node", [link], { encoding: "utf8", env: { ...process.env, SKILL_BUDGETS_ROOT: dir } });
    assert.notEqual(r.stdout.trim(), "", "the CLI must produce output through a symlinked path (not a silent exit)");
    assert.equal(r.status, 1, "…and still FAIL on the violating tree");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(linkDir, { recursive: true, force: true });
  }
});

test("the ratchet: recorded debt may hold or shrink, never grow, and exemptions cannot go stale silently", async () => {
  const { checkDeclared, checkAll, countWords } = await import(CHECKER);
  const dir = plantTree();
  try {
    const rel = "skills/x/SKILL.md";
    const file = path.join(dir, rel);
    const seed = { declared: 50, measured: 60, since: "2026-08-04" };
    const known = new Map([[rel, seed]]);
    const write = (n) => writeFileSync(file, "Word budget: 50\n" + "word ".repeat(n - 3) + "\n"); // whole-file = n words

    write(55); // over budget but under the recorded debt
    assert.deepEqual(
      (({ state, ok, warn }) => ({ state, ok, warn }))(checkDeclared(rel, { root: dir, known })),
      { state: "KNOWN-OVER", ok: true, warn: true },
      "debt at or under its recorded level is a WARN, not a failure",
    );
    write(65); // debt grew
    assert.equal(checkDeclared(rel, { root: dir, known }).state, "DEBT-GREW", "grown debt FAILS");
    assert.equal(checkDeclared(rel, { root: dir, known }).ok, false);
    write(40); // back within budget
    assert.equal(checkDeclared(rel, { root: dir, known }).state, "STALE-EXEMPTION",
      "an entry outliving its debt FAILS until deleted — a permanent exemption is a lie");
    // Raising the declared number is the one-edit escape the ratchet pins. THE NUMBERS MATTER:
    // an earlier draft raised 50→90 with the file at 55 words, so disabling this very branch let
    // the NEXT branch (measured <= declared) return STALE-EXEMPTION anyway and the assertion
    // passed for the wrong reason — the mutation SURVIVED (my own battery). Here the raise leaves
    // the file still OVER the new number and at exactly its recorded debt, so with the branch
    // disabled the result is KNOWN-OVER (a pass) and the assertion genuinely discriminates.
    writeFileSync(file, "Word budget: 58\n" + "word ".repeat(57) + "\n"); // 60 words, budget 58
    assert.equal(countWords(readFileSync(file, "utf8")), 60, "fixture sanity: measured is exactly the recorded debt");
    assert.equal(checkDeclared(rel, { root: dir, known }).state, "STALE-EXEMPTION",
      "a changed declared budget under recorded debt FAILS (take the number to the Owner)");
    // An exemption whose file is GONE fails the whole run rather than silently excusing a future file.
    write(55);
    const ghost = new Map([[rel, seed], ["skills/gone/SKILL.md", seed]]);
    const rows = checkAll({ root: dir, known: ghost });
    assert.ok(rows.some((r) => r.path === "skills/gone/SKILL.md" && r.state === "STALE-EXEMPTION" && !r.ok),
      "a KNOWN_OVER entry with no file is a STALE-EXEMPTION failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (2) boot-set consistency
// ---------------------------------------------------------------------------------------------

// The nine boot-set docs, in the canonical order (core/README.md § the staged read).
const CANON = ["FOUNDATIONS", "WORKFLOW", "REVIEW", "ARTIFACT_CLASS", "OPERATE", "MULTI_AGENT",
  "BINDINGS", "SYSTEM_MAP", "OWNER_COMMS"];
const IDENTITY_DOCS = new Set(["CLAUDE", "AGENTS"]); // the entry stubs are the identity leg, not method order

const extractOrder = (text) =>
  [...text.matchAll(/([A-Z][A-Z_]*)\.md/g)].map((m) => m[1]).filter((n) => !IDENTITY_DOCS.has(n));

function sliceBetween(text, startRe, endRe, label) {
  const start = text.search(startRe);
  assert.notEqual(start, -1, `${label}: the start anchor ${startRe} must exist (renamed section?)`);
  const rest = text.slice(start);
  const end = rest.search(endRe);
  assert.notEqual(end, -1, `${label}: the end anchor ${endRe} must exist (renamed section?)`);
  return rest.slice(0, end);
}

test("every boot-order enumeration agrees with the canon — and the extractor provably detects drift", () => {
  const read = (p) => readFileSync(path.join(KIT, p), "utf8");
  // EVERY enumeration in the kit, found by sweeping for the shape rather than by memory. The
  // BINDINGS template was missed on the first pass — it carries a seventh enumeration under its
  // own heading, and a reorder there survived the whole suite (cold seat, executed). It spells
  // the bindings slot as "this file", so its expected list omits BINDINGS and the slot is
  // asserted separately.
  const CANON_NO_BINDINGS = CANON.filter((n) => n !== "BINDINGS");
  const sources = [
    // [file, start anchor, end anchor, expected]
    ["templates/CLAUDE.md.tmpl", /## Read this first/, /\nOn demand/, CANON],
    ["templates/AGENTS.md.tmpl", /## Read this first/, /\nOn demand/, CANON],
    ["core/README.md", /The stub names the \*\*boot set\*\*/, /Everything else loads/, CANON],
    ["core/MULTI_AGENT.md", /\*\*Read in this order:\*\*/, /The four gate types/, CANON],
    // WORKFLOW enumerates only the six METHOD files — the boot set's head, in the same order.
    ["core/WORKFLOW.md", /The six METHOD files/, /What each file carries/, CANON.slice(0, 6)],
    ["templates/BINDINGS.md.tmpl", /\*\*Boot set \(read whole\):\*\*/, /\*\*On demand:\*\*/, CANON_NO_BINDINGS],
    ["skills/boot/SKILL.md", /\*\*Boot set, in order, whole:\*\*/, /Do NOT/, CANON],
  ];
  for (const [file, startRe, endRe, expected] of sources) {
    const found = extractOrder(sliceBetween(read(file), startRe, endRe, file));
    assert.deepEqual(found, expected,
      `${file}: its boot-order enumeration must match the canon exactly (order AND membership)`);
  }
  // BINDINGS.tmpl names itself in the bindings slot rather than by filename — assert the slot is
  // still THERE and still between MULTI_AGENT and SYSTEM_MAP, or a deletion would read as clean.
  const bindingsSlice = sliceBetween(read("templates/BINDINGS.md.tmpl"),
    /\*\*Boot set \(read whole\):\*\*/, /\*\*On demand:\*\*/, "templates/BINDINGS.md.tmpl");
  assert.match(bindingsSlice, /`core\/MULTI_AGENT\.md`\s*→\s*bindings = \*\*this file\*\*\s*→\s*`core\/SYSTEM_MAP\.md`/,
    "BINDINGS.tmpl keeps its self-reference in the bindings slot, in position");

  // THE CANON MUST NAME FILES THAT EXIST. Six enumerations agreeing with each other says nothing
  // about whether they point at anything: renaming core/FOUNDATIONS.md left this test green while
  // every enumeration in the kit named a missing file (cold seat, reproduced). Consistency and
  // resolvability are different properties and both are owed.
  for (const name of CANON) {
    const inCore = existsSync(path.join(KIT, "core", `${name}.md`));
    const generated = existsSync(path.join(KIT, "templates", `${name}.md.tmpl`));
    assert.ok(inCore || generated,
      `the canon names ${name}.md, which must exist as core/${name}.md ([P]) or templates/${name}.md.tmpl ([G])`);
  }

  // BOTH WAYS: the comparator must be able to see drift, or the assertions above are vacuous
  // against an extractor that returns the canon unconditionally.
  const reordered = "`FOUNDATIONS.md` → `WORKFLOW.md` → `OPERATE.md` → `ARTIFACT_CLASS.md` → " +
    "`REVIEW.md` → `MULTI_AGENT.md` → `BINDINGS.md` → `SYSTEM_MAP.md` → `OWNER_COMMS.md`";
  assert.notDeepEqual(extractOrder(reordered), CANON, "a planted REORDER is detected");
  const dropped = "`FOUNDATIONS.md` → `WORKFLOW.md` → `REVIEW.md` → `ARTIFACT_CLASS.md` → " +
    "`OPERATE.md` → `MULTI_AGENT.md` → `BINDINGS.md` → `OWNER_COMMS.md`";
  assert.notDeepEqual(extractOrder(dropped), CANON, "a planted OMISSION is detected");
});

// ---------------------------------------------------------------------------------------------
// (3) init wiring for the three ritual skills
// ---------------------------------------------------------------------------------------------

// Adopt into a fresh scratch repo. Codex prompts are user-global, so ALWAYS point init at a
// scratch dir — a test that writes to a real ~/.codex/prompts is not hermetic.
function adopt(extraArgs = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ritual-"));
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

test("init installs the three ritual skills through the shared-body mechanism, idempotently", () => {
  const { dir, codexDir, run, cleanup } = adopt();
  try {
    const names = ["boot", "closeout", "lane-declare"];
    const bodies = names.map((n) => path.join(dir, ".agents", "skills", n, "SKILL.md"));
    const claudeShims = names.map((n) => path.join(dir, ".claude", "skills", n, "SKILL.md"));
    const codexShims = names.map((n) => path.join(codexDir, `${n}.md`));
    for (const p of [...bodies, ...claudeShims, ...codexShims]) {
      assert.ok(existsSync(p), `installed: ${p}`);
    }
    for (const [i, n] of names.entries()) {
      const claude = readFileSync(claudeShims[i], "utf8");
      const codex = readFileSync(codexShims[i], "utf8");
      assert.match(claude, /^---\n/, `${n}: Claude shim opens with YAML frontmatter`);
      assert.match(codex, /^# /, `${n}: Codex prompt opens with a markdown H1`);
      // Every shim points at a body that exists (a dangling pointer is a command that dead-ends),
      // and carries no rules of its own — the shared-body invariant.
      for (const shim of [claude, codex]) {
        const refs = [...shim.matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
        assert.ok(refs.length > 0, `${n}: the shim names a shared body`);
        for (const [, skill, file] of refs) {
          assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
            `${n}: .agents/skills/${skill}/${file} resolves on disk`);
        }
        assert.doesNotMatch(shim, /Word budget/, `${n}: the shim must not duplicate the body's rules`);
      }
      // The installed BODY is the governed artifact: it declares its budget in its head.
      assert.match(readFileSync(bodies[i], "utf8"), /^Word budget: \d+/m, `${n}: the installed body declares its budget`);
    }
    // The INSTALLED /boot body enumerates the same boot order as the kit canon — consistency must
    // hold in the artifact adopters actually load, not only in the kit's source copy.
    const bootInstalled = sliceBetween(readFileSync(bodies[0], "utf8"), /\*\*Boot set, in order, whole:\*\*/, /Do NOT/, "installed boot");
    assert.deepEqual(extractOrder(bootInstalled), CANON, "the installed /boot enumerates the canonical boot order");

    // Idempotent: a re-run keeps user edits (mutated first — hashing a pristine install would stay
    // green even if copyGuarded regressed to overwrite, since a re-copy is byte-identical).
    const edited = {};
    for (const p of [bodies[0], claudeShims[1], codexShims[2]]) {
      edited[p] = readFileSync(p, "utf8") + "\n<!-- user edit: keep me -->\n";
      writeFileSync(p, edited[p]);
    }
    run();
    for (const p of Object.keys(edited)) {
      assert.equal(readFileSync(p, "utf8"), edited[p], `re-run KEEPS the user-edited ${p} (no clobber without --force)`);
    }
  } finally { cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// (4) the [P]-upgrade rule for this release's edits to EXISTING portable files
// ---------------------------------------------------------------------------------------------

test("a plain init re-run ships NONE of v1.7's edits to existing [P] files — so the v1.7 note must say --force", () => {
  // v1.7 edits two files an existing adopter ALREADY has: core/ARTIFACT_CLASS.md (the budget
  // citation) and .agents/skills/frontier-review/INVOKE.md (its budget marker). `init` never
  // overwrites a file it did not write this run, so a plain re-run leaves both stale while
  // exiting 0 — the release note is the only channel the fix travels through, and it must say
  // --force or it ships nothing. Both halves executed; the note itself pinned.
  const { dir, run, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const targets = [
      path.join(dir, "core", "ARTIFACT_CLASS.md"),
      path.join(dir, ".agents", "skills", "frontier-review", "INVOKE.md"),
    ];
    const marker = "<!-- PRE-UPGRADE MARKER -->\n";
    for (const t of targets) writeFileSync(t, marker + readFileSync(t, "utf8"));
    run(["--skip-codex-prompt"]);
    for (const t of targets) {
      assert.ok(readFileSync(t, "utf8").startsWith(marker),
        `a plain re-run KEEPS the already-installed ${path.basename(t)} (this is why --force is required)`);
    }
    run(["--skip-codex-prompt", "--force"]);
    for (const [t, src] of [
      [targets[0], path.join(KIT, "core", "ARTIFACT_CLASS.md")],
      [targets[1], path.join(KIT, "skills", "frontier-review", "INVOKE.md")],
    ]) {
      assert.equal(readFileSync(t, "utf8"), readFileSync(src, "utf8"),
        `--force is what actually installs the kit's current ${path.basename(t)} ([P]: overwritten, no .bak)`);
    }
    // The note carries the instruction. Scoped to the v1.7 section so a neighbouring release's
    // instruction cannot satisfy it.
    const readme = readFileSync(path.join(KIT, "README.md"), "utf8");
    const start = readme.indexOf("## What's new in v1.7");
    const end = readme.indexOf("## What's new in v1.6.1");
    assert.ok(start !== -1 && end > start, "the v1.7 section exists above the v1.6.1 section");
    assert.match(readme.slice(start, end), /--force/,
      "the v1.7 upgrade instruction must require --force for the two existing-[P] edits, or it installs neither");
  } finally { cleanup(); }
});
