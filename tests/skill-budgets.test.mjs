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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = path.join(KIT, "scripts", "check-skill-budgets.mjs");

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
  // THE WIRING IS THE SENSOR'S LIVENESS: a checker no script runs is dead machinery. `npm test`
  // must invoke it (budget-free deterministic rung first), and the named script must exist.
  const pkg = JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8"));
  assert.match(pkg.scripts["check:skill-budgets"] ?? "", /check-skill-budgets\.mjs/, "the npm script exists");
  assert.match(pkg.scripts.test ?? "", /check-skill-budgets\.mjs/, "npm test runs the checker (liveness, not just presence)");
});

// A healthy planted tree: one budgeted skill, one shim per lane, one agent. Word counts are
// whole-file `wc -w`, so content is generated arithmetically ("Word budget: 50" itself counts 3).
function plantTree() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-budget-"));
  mkdirSync(path.join(dir, "skills", "x"), { recursive: true });
  mkdirSync(path.join(dir, "skill-shims", "claude"), { recursive: true });
  mkdirSync(path.join(dir, "agents"), { recursive: true });
  writeFileSync(path.join(dir, "skills", "x", "SKILL.md"), "Word budget: 50\n" + "word ".repeat(20) + "\n");
  writeFileSync(path.join(dir, "skill-shims", "claude", "x.md"), "Pointer at .agents/skills/x/SKILL.md — no rules here.\n");
  writeFileSync(path.join(dir, "agents", "seat.md"), "A small reviewer seat definition.\n");
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

    // --json mirrors the same verdicts machine-readably.
    r = checkerOn(dir, ["--json"]);
    assert.equal(r.status, 0, "healthy tree under --json passes");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true, "--json reports ok:true");
    assert.ok(Array.isArray(parsed.results) && parsed.results.length >= 3, "…with a row per governed file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the ratchet: recorded debt may hold or shrink, never grow, and exemptions cannot go stale silently", async () => {
  const { checkDeclared, checkAll } = await import(CHECKER);
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
    // Raising the declared number is the one-edit escape the ratchet pins.
    writeFileSync(file, "Word budget: 90\n" + "word ".repeat(52) + "\n");
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
  const sources = [
    // [file, start anchor, end anchor, expected]
    ["templates/CLAUDE.md.tmpl", /## Read this first/, /\nOn demand/, CANON],
    ["templates/AGENTS.md.tmpl", /## Read this first/, /\nOn demand/, CANON],
    ["core/README.md", /The stub names the \*\*boot set\*\*/, /Everything else loads/, CANON],
    ["core/MULTI_AGENT.md", /\*\*Read in this order:\*\*/, /The four gate types/, CANON],
    // WORKFLOW enumerates only the six METHOD files — the boot set's head, in the same order.
    ["core/WORKFLOW.md", /The six METHOD files/, /What each file carries/, CANON.slice(0, 6)],
    ["skills/boot/SKILL.md", /\*\*Boot set, in order, whole:\*\*/, /Do NOT/, CANON],
  ];
  for (const [file, startRe, endRe, expected] of sources) {
    const found = extractOrder(sliceBetween(read(file), startRe, endRe, file));
    assert.deepEqual(found, expected,
      `${file}: its boot-order enumeration must match the canon exactly (order AND membership)`);
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
