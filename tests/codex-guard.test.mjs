// workflow-kit — the v2.1 Codex-lane write guard: the envelope parser, the three-class predicate,
// the one-row-per-target ledger, the generated registration, and the two-lane equality tripwire.
//
// EVERY payload fixture imported here was CAPTURED from a real `codex exec` run (see
// acceptance/fixtures/codex-payload-samples.mjs) rather than written from the docs. The parser is
// the only genuinely new logic in this release, and a parser tested against payloads its own author
// invented proves that the author is self-consistent, not that the parser reads Codex.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractTargets, parseApplyPatchEnvelope, resolveProjectRoot } from "../hooks/payload-targets.mjs";
import {
  APPLY_PATCH_ADD, APPLY_PATCH_MULTI, APPLY_PATCH_MULTI_EXPECTED_TARGETS, BASH_CALL, OBSERVED_SHELL_WRITES,
} from "../acceptance/fixtures/codex-payload-samples.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envelope(...lines) { return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n"); }
function patchCall(command) { return { tool_name: "apply_patch", tool_input: { command } }; }

test("the envelope parser returns EVERY target in a captured multi-target patch, both Move endpoints included", () => {
  // The load-bearing fixture. Five paths, four directives, one call. A guard that gates only the
  // first target fails open on the other four; one that gates only a rename's SOURCE lets a file be
  // carried OUT of a gated directory, and one that gates only its DESTINATION misses the departure.
  const single = extractTargets(APPLY_PATCH_ADD);
  assert.deepEqual(single, { ok: true, shape: "apply_patch", targets: ["hello2.txt"] });

  const multi = extractTargets(APPLY_PATCH_MULTI);
  assert.equal(multi.ok, true);
  assert.deepEqual(multi.targets, APPLY_PATCH_MULTI_EXPECTED_TARGETS,
    "every target the captured envelope names, in order — including old.txt (Move source) AND renamed.txt (Move destination)");
  assert.equal(multi.targets.length, 5, "five distinct paths, not one");

  // A Bash call is NOT a write. Codex normalizes its shell tool to the name `Bash` and passes
  // `tool_input.command` — the same shape the Claude lane sends — so the write guards must read it
  // as "no write intent" and get out of the way, or every shell command in the Codex lane would be
  // gated as a write it cannot parse.
  assert.deepEqual(extractTargets(BASH_CALL), { ok: true, shape: "none", targets: [] });
});

test("the parser is adversarial-hardened: hostile paths, duplicates, and content that impersonates a directive", () => {
  // PATHS WITH SPACES, DOTS AND TRAVERSAL survive verbatim. Extraction must not normalise or reject
  // them here — the CALLERS decide what an escaping path means (guard-cross-repo-writes denies it,
  // guard-lane-authoring skips it as another control's business). A parser that silently dropped a
  // `../` target would hide the single most interesting path in the envelope.
  const hostile = parseApplyPatchEnvelope(envelope(
    "*** Add File: my notes.txt", "+x",
    "*** Update File: ../sibling-repo/steal.mjs", "@@", "-a", "+b",
    "*** Delete File: ...hidden..md",
  ));
  assert.deepEqual(hostile.targets, ["my notes.txt", "../sibling-repo/steal.mjs", "...hidden..md"]);

  // DUPLICATES collapse to one target: the ledger records one row per TARGET, and a path named
  // twice in one envelope is still one target. It must NOT collapse to zero.
  const dupes = parseApplyPatchEnvelope(envelope("*** Add File: a.txt", "+1", "*** Delete File: a.txt"));
  assert.deepEqual(dupes.targets, ["a.txt"]);

  // CONTENT THAT IMPERSONATES A DIRECTIVE. A patch that ADDS a line reading `*** Add File: evil.txt`
  // sends that line prefixed with `+`. It is content, not a directive, and gating a phantom
  // `evil.txt` would be a false BLOCK on every patch that merely quotes patch syntax — which is
  // exactly what a patch to THIS parser's own tests looks like. Both directions matter: the real
  // directive on the line above must still be found.
  const spoof = parseApplyPatchEnvelope(envelope(
    "*** Add File: doc.md", "+*** Add File: evil.txt", "+*** Delete File: also-evil.txt",
  ));
  assert.deepEqual(spoof.targets, ["doc.md"], "prefixed content is content — no phantom target");

  // …and the mirror image: a real directive is found even when a look-alike sits beside it.
  const both = parseApplyPatchEnvelope(envelope("*** Add File: doc.md", "+*** Add File: evil.txt", "*** Delete File: real.txt"));
  assert.deepEqual(both.targets, ["doc.md", "real.txt"]);

  // CRLF. A patch that arrives with Windows line endings must parse identically, or the guard
  // silently stops finding targets on one platform.
  const crlf = parseApplyPatchEnvelope("*** Begin Patch\r\n*** Add File: a.txt\r\n+x\r\n*** End Patch\r\n");
  assert.deepEqual(crlf.targets, ["a.txt"]);
});

test("an envelope the parser cannot fully account for is DENIED, never partially trusted", () => {
  // Every one of these is write-shaped. Returning the targets it happened to understand would be a
  // fail-open with extra steps: the dropped target is the one an attacker puts last.
  const cases = {
    "no closing marker": "*** Begin Patch\n*** Add File: a.txt\n+x",
    "no opening marker": "*** Add File: a.txt\n+x\n*** End Patch",
    "unknown directive": envelope("*** Add File: a.txt", "+x", "*** Rename File: b.txt"),
    "empty path": envelope("*** Add File:"),
    "names nothing": envelope("@@", "-a", "+b"),
    "Move with no source": envelope("*** Move to: dest.txt"),
    "empty command": "",
    "no command at all": undefined,
  };
  for (const [name, command] of Object.entries(cases)) {
    const r = parseApplyPatchEnvelope(command);
    assert.equal(r.ok, false, `${name} ⇒ ok:false`);
    assert.equal(r.shape, "apply_patch", `${name} ⇒ still classified as a WRITE (so callers deny rather than ignore)`);
    assert.deepEqual(r.targets, [], `${name} ⇒ no partial target list`);
    assert.ok(r.reason && r.reason.length > 10, `${name} ⇒ carries a reason a human can act on`);
  }
  // A Move DOES need its source, and consumes it: a second Move after one Update is unaccounted for.
  assert.equal(parseApplyPatchEnvelope(envelope(
    "*** Update File: a.txt", "*** Move to: b.txt", "*** Move to: c.txt",
  )).ok, false, "a second Move with no new source is not silently accepted");
});

test("the THREE CLASSES are distinct, and the middle one is the polarity change v2.1 exists for", () => {
  // extractable ⇒ gate · write-shaped-but-unextractable ⇒ DENY · no-write-intent ⇒ exit 0.
  // Collapsing the last two is what made the ported guard permit every Codex write.
  const extractable = [
    [{ tool_name: "Write", tool_input: { file_path: "src/a.mjs" } }, "claude"],
    [{ tool_name: "NotebookEdit", tool_input: { notebook_path: "n.ipynb" } }, "claude"],
    [APPLY_PATCH_ADD, "apply_patch"],
  ];
  for (const [payload, shape] of extractable) {
    const r = extractTargets(payload);
    assert.equal(r.ok, true);
    assert.equal(r.shape, shape);
    assert.ok(r.targets.length > 0);
  }
  // WRITE-SHAPED BUT UNREADABLE. Each of these has a path key that is PRESENT and unusable, or an
  // apply_patch tool name with an unparseable envelope.
  for (const payload of [
    { tool_name: "Write", tool_input: { file_path: 123 } },
    { tool_name: "Write", tool_input: { file_path: "" } },
    { tool_name: "Write", tool_input: { file_path: null } },
    { tool_name: "NotebookEdit", tool_input: { notebook_path: {} } },
    patchCall("*** Begin Patch\n*** Add File: a.txt"),
  ]) {
    assert.equal(extractTargets(payload).ok, false, `${JSON.stringify(payload.tool_input)} is write-shaped and unreadable ⇒ DENY`);
  }
  // NO WRITE INTENT — the only result that means "get out of the way". Note `tool_input` absent and
  // `tool_input` present-but-empty are both this: no path KEY exists, so nothing was claimed.
  for (const payload of [BASH_CALL, {}, { tool_name: "Bash", tool_input: {} }, { tool_input: { command: "ls" } }]) {
    const r = extractTargets(payload);
    assert.equal(r.shape, "none");
    assert.deepEqual(r.targets, []);
  }
});

test("indented directives, non-target grammar, and hidden separators", () => {
  // 1. AN INDENTED DIRECTIVE IS A DIRECTIVE. Codex's own patch parser trims a line before deciding
  // whether it is a header, so `␠*** Add File: x` names a target to the applier. Anchoring at column
  // 0 meant that target was silently dropped from the gated list while the file still got written —
  // a real fail-open, and precisely the compliance-yet-bypass shape being hunted.
  const indented = parseApplyPatchEnvelope(envelope(
    "*** Add File: docs/safe.md", "+x", " *** Add File: ../sibling/escaped.mjs", "+y",
  ));
  assert.deepEqual(indented.targets, ["docs/safe.md", "../sibling/escaped.mjs"],
    "an indented directive is gated, not read as hunk content");
  // …and the `+`-prefixed spoof must STILL be content, or the fix trades one defect for its mirror.
  assert.deepEqual(parseApplyPatchEnvelope(envelope("*** Add File: doc.md", "+*** Add File: evil.txt")).targets,
    ["doc.md"], "a `+` prefix is not whitespace — quoted patch syntax still gates no phantom path");

  // 2. REAL GRAMMAR THAT NAMES NO PATH. `*** End of File` and `*** Environment ID:` are both in the
  // shipped CLI's patch vocabulary. Rejecting them as "unknown" fails closed — safe in direction,
  // but it BRICKS a legal patch, and a control that blocks legitimate work gets switched off.
  assert.deepEqual(parseApplyPatchEnvelope(envelope("*** Add File: a.txt", "+x", "*** End of File")).targets, ["a.txt"]);
  assert.deepEqual(parseApplyPatchEnvelope(envelope("*** Environment ID: abc-123", "*** Add File: a.txt", "+x")).targets, ["a.txt"]);
  // A genuinely unknown directive still denies — the brick fix must not become a skip-anything rule.
  assert.equal(parseApplyPatchEnvelope(envelope("*** Add File: a.txt", "+x", "*** Rename File: b.txt")).ok, false);

  // 3. LINE TERMINATORS THIS PARSER DOES NOT SPLIT ON. A U+2028 (or lone CR) lets a directive hide
  // inside what we read as one content line. Rather than guess which splitters agree with us, the
  // envelope is refused — the same "cannot fully account for it" rule every other odd shape gets.
  for (const sep of ["\u2028", "\u2029", "\r"]) {
    const smuggled = `*** Begin Patch\n*** Add File: legit.txt\n+hello${sep}*** Add File: evil.txt\n+HACKED\n*** End Patch`;
    const r = parseApplyPatchEnvelope(smuggled);
    assert.equal(r.ok, false, `a ${JSON.stringify(sep)} separator is refused, not silently half-parsed`);
    assert.ok(!r.targets.includes("legit.txt"), "…and no partial target list is handed back");
  }
  // CRLF is a normal line ending and must still parse — the lone-CR rule must not catch it.
  assert.deepEqual(parseApplyPatchEnvelope("*** Begin Patch\r\n*** Add File: a.txt\r\n+x\r\n*** End Patch\r\n").targets, ["a.txt"]);
});

test("relative patch paths resolve against the APPLIER's cwd, not the repo root", () => {
  // `--project-dir` answers "which repo am I guarding"; it does NOT
  // answer "what does `src/x.mjs` mean". The applier resolves a relative path against its own
  // working directory, and those differ whenever a session runs in a SUBDIRECTORY — an ordinary
  // monorepo case, no attacker required. Resolving against the wrong base checks a path that will
  // never be written while the real one goes unchecked.
  const R = guardRepo();
  try {
    mkdirSync(path.join(R.dir, "packages", "foo", "src"), { recursive: true });
    R.clearLedger();
    // Session cwd is packages/foo; the patch says `src/gated.mjs`, meaning packages/foo/src/gated.mjs.
    const r = R.run("guard-lane-authoring.mjs", {
      session_id: "wrong-session", cwd: path.join(R.dir, "packages", "foo"),
      ...patchCall(envelope("*** Add File: src/gated.mjs", "+1")),
    });
    assert.match(r.stdout, /"permissionDecision":"deny"/, "the write is gated where it will actually land");
    assert.equal(R.rows()[0].path, "packages/foo/src/gated.mjs",
      "…and the ledger names the real path, not the one the repo root would have implied");

    // A forged `cwd` pointing OUTSIDE the repo is the fail-closed direction, not an escape: every
    // relative target then resolves outside, and an out-of-repo target is what the cross-repo guard
    // denies. So the payload field is safe to trust as a resolution base.
    // The forged cwd must sit outside EVERY allowed root — the repo, ~/.claude, /tmp and
    // /private/tmp are all legitimate write destinations, so pointing at one of those proves
    // nothing. (A first cut of this assertion used /private/tmp and failed for exactly that reason.)
    const escaped = R.run("guard-cross-repo-writes.mjs", {
      session_id: "s1", cwd: path.join(os.homedir(), "cs5b-forged-elsewhere"),
      ...patchCall(envelope("*** Add File: src/gated.mjs", "+1")),
    });
    assert.match(escaped.stdout, /"permissionDecision":"deny"/, "a forged cwd blocks the write rather than smuggling it past");
    assert.match(escaped.stdout, /outside this repo/);
  } finally { R.cleanup(); }
});

test("an UNREADABLE payload is denied by BOTH write guards, not just one", () => {
  // The cross-repo guard's outermost JSON.parse still did `exit 0` — "cannot read it ⇒ permit it",
  // the exact shape this release exists to remove, surviving at the one place the rewrite never
  // looked. Its sibling had denied on the same bytes for releases, so the pair only stayed honest
  // because any-deny-wins masked it. Each guard must be correct STANDALONE.
  const R = guardRepo();
  try {
    for (const guard of ["guard-cross-repo-writes.mjs", "guard-lane-authoring.mjs"]) {
      const r = spawnSync("node", [path.join(KIT, "hooks", guard)], {
        cwd: R.dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: R.dir },
        input: "not json at all {{{",
      });
      assert.equal(r.status, 0, `${guard} must still exit 0 (a hook that crashes blocks nothing)`);
      assert.match(r.stdout, /"permissionDecision":"deny"/, `${guard} DENIES an unparseable payload`);
    }
    // EMPTY stdin is not an error and must stay an allow — the fix must not brick a probe or a
    // harness that sends nothing.
    const empty = spawnSync("node", [path.join(KIT, "hooks", "guard-cross-repo-writes.mjs")], {
      cwd: R.dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: R.dir }, input: "",
    });
    assert.doesNotMatch(empty.stdout, /"permissionDecision":"deny"/, "empty stdin is still no-write-intent");
  } finally { R.cleanup(); }
});

test("`[features] hooks = true` is NOT a hooks registration — in init AND in the probe", async () => {
  // A line-shaped `hooks\s*=` regex matches an ordinary Codex FEATURE FLAG, and reading that as
  // "the adopter registered their own hooks" makes init skip its registration entirely: guards
  // installed, nothing registered, exit 0. A false positive in this detector is a silent fail-open.
  // Real Codex config files carry that flag.
  const { tomlDeclaresHooks: initSays } = await import(path.join(KIT, "bin", "init.mjs"));
  const { tomlDeclaresHooks: probeSays } = await import(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"));
  const CORPUS = [
    ["[features]\nhooks = true\n", false],
    ["[features]\nhooks = true\n\n[other]\nx = 1\n", false],
    ["[plugins.\"a@b\"]\nhooks = true\n", false],
    ["hooks = \"./hooks.json\"\n", true],
    ["  hooks = \"./hooks.json\"\n", true],
    ["[hooks]\n", true],
    ["[hooks.PreToolUse]\n", true],
    ["[[hooks.PreToolUse]]\nmatcher = \"apply_patch\"\n", true],
    ["hooks.PreToolUse = []\n", true],
    ["# hooks = \"./hooks.json\"\n", false],
    ["[shell_environment_policy]\ninherit = \"core\"\n", false],
    ["", false],
  ];
  for (const [toml, expected] of CORPUS) {
    assert.equal(initSays(toml), expected, `init misreads ${JSON.stringify(toml)}`);
    // The probe ships standalone into an adopter's scripts/ where bin/init.mjs does not exist, so
    // its copy is forced. Pin the two EQUAL rather than trusting them to stay in step by hand.
    assert.equal(probeSays(toml), expected, `the probe's copy disagrees on ${JSON.stringify(toml)}`);
  }

  // …and end to end: a config carrying only the feature flag still gets the kit's registration.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-features-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    mkdirSync(path.join(dir, ".codex"), { recursive: true });
    writeFileSync(path.join(dir, ".codex", "config.toml"), "[features]\nhooks = true\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "f", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dir, ".codex", "hooks.json")),
      "a [features] hooks flag must NOT suppress the kit's registration");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
});

test("no ledger row is not automatically NOT ARMED — the probe abstains when nothing was tested", async () => {
  // THE FAILURE, against hooks a human had just trusted. The probe reported
  // "your Codex lane is UNGUARDED" about a lane that was provably blocking — because Codex had
  // read the adopted repo's own AGENTS.md, decided an identity precondition failed ("this checkout
  // has no `origin` remote"), and **never attempted the write at all**. No attempt ⇒ no hook ⇒ no
  // row. This check's founding rule is that absence is not evidence; it was applying that rule to
  // ARMED and not to NOT ARMED.
  //
  // A false alarm is not the harmless direction it looks like: an adopter told that a working
  // control is dead switches it off, or stops believing the check — which is how controls actually
  // die in this kit's own failure taxonomy.
  const { verdictFor } = await import(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"));
  // The guard's own signature appeared ⇒ ARMED, whatever else happened.
  assert.equal(verdictFor({ before: 0, after: 1, wrote: false }), "ARMED");
  assert.equal(verdictFor({ before: 3, after: 4, wrote: true }), "ARMED");
  // The write LANDED and no guard row appeared ⇒ the write really was unguarded. Confident.
  assert.equal(verdictFor({ before: 0, after: 0, wrote: true }), "NOT_ARMED");
  // No row AND no file ⇒ an inert guard and a write never attempted are indistinguishable. ABSTAIN.
  assert.equal(verdictFor({ before: 0, after: 0, wrote: false }), "UNKNOWN");
  // The abstain must not be reachable from a row that DID appear — that would swallow a real ARMED.
  assert.notEqual(verdictFor({ before: 0, after: 2, wrote: false }), "UNKNOWN");

  // The evidence feeding `wrote` is observed and cleared in ONE operation, because as two statements
  // the order is invertible and the inverted form (clear, then look) silently reports `false`
  // forever — turning every run into an abstain. Both directions are pinned below.
  const { observeAndClear } = await import(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-observe-"));
  try {
    const f = path.join(dir, "kit-armed-probe.mjs");
    assert.equal(observeAndClear(f), false, "absent ⇒ false, and no crash");
    writeFileSync(f, "// probe\n");
    assert.equal(observeAndClear(f), true, "present ⇒ true…");
    assert.equal(existsSync(f), false, "…and it is cleared in the same breath");
    assert.equal(observeAndClear(f), false, "…so a second look reports absent");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the arming probe keys on a row about ITS OWN target, not on the ledger growing", async () => {
  // "The ledger grew" is not the guard's signature — any unrelated guarded write in the same repo
  // (another agent, another terminal) grows it, and the probe would report ARMED without its own
  // write ever being seen. A false green in the check whose whole job is preventing false greens.
  const probeMod = await import(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"));
  assert.equal(typeof probeMod.tomlDeclaresHooks, "function",
    "importing the probe must not execute it — it is a CLI only under isMain()");
  const probeSrc = readFileSync(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"), "utf8");
  assert.match(probeSrc, /row\.path === PROBE_REL/, "rows are counted only when they name the probe's target");
  assert.match(probeSrc, /if \(isMain\(\)\) main\(\);/, "…and the script still runs as a CLI");
  // Executed: a ledger full of UNRELATED rows must read as zero probe rows, so a concurrent write
  // cannot manufacture an ARMED verdict.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-probecount-"));
  try {
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    mkdirSync(path.join(dir, ".codex"), { recursive: true });
    writeFileSync(path.join(dir, ".codex", "hooks.json"), "{}\n");
    writeFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"),
      JSON.stringify({ ts: "t", decision: "allow", state: "in-thread:T2", path: "src/unrelated.mjs" }) + "\n" +
      "{ this line is torn and unparseable\n");
    // With no `codex` on PATH the probe abstains — but the point here is that it never claims ARMED
    // off the back of rows that are not about its target.
    const r = spawnSync(process.execPath, [path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"), dir], {
      encoding: "utf8", env: { ...process.env, PATH: path.join(dir, "nothing-here") },
    });
    assert.equal(r.status, 2);
    assert.doesNotMatch(r.stdout, /^ARMED/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("resolveProjectRoot prefers what it is TOLD over what it can guess — a wrong root is a fail-open", () => {
  // A root that does not match the tree makes in-repo paths resolve as outside the repo, which
  // guard-lane-authoring skips. So precedence is argv → env → payload cwd → process.cwd().
  const saved = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = "/env-root";
    assert.equal(resolveProjectRoot({ cwd: "/payload-root" }, ["--project-dir", "/argv-root"]), path.resolve("/argv-root"));
    assert.equal(resolveProjectRoot({ cwd: "/payload-root" }, []), path.resolve("/env-root"));
    delete process.env.CLAUDE_PROJECT_DIR;
    assert.equal(resolveProjectRoot({ cwd: "/payload-root" }, []), path.resolve("/payload-root"));
    assert.equal(resolveProjectRoot(null, []), path.resolve(process.cwd()));
    // A `--project-dir` with no value must not resolve to undefined and silently become cwd-ish.
    assert.equal(resolveProjectRoot({ cwd: "/payload-root" }, ["--project-dir"]), path.resolve("/payload-root"));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});

// ── the guards, executed as the harness executes them ────────────────────────────────────────────

function guardRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codexguard-"));
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  const declare = (obj) => writeFileSync(path.join(dir, ".claude", "task-lane.json"), JSON.stringify(obj) + "\n");
  declare({ mode: "in-thread", sessionId: "s1", taskId: "codex-guard-task", tier: "T2" });
  const run = (guard, payload, extraArgs = []) => spawnSync(
    "node", [path.join(KIT, "hooks", guard), ...extraArgs],
    { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: JSON.stringify(payload) },
  );
  const rows = () => {
    const f = path.join(dir, ".claude", "lane-ledger.jsonl");
    return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  const clearLedger = () => writeFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "");
  return { dir, run, rows, clearLedger, declare, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("ONE LEDGER ROW PER TARGET on the captured multi-target envelope — not one row for the call", () => {
  const R = guardRepo();
  try {
    // Rebuild the captured envelope against paths that are GATED in this repo, keeping the captured
    // envelope's exact directive structure (four directives, a rename, five targets).
    const command = APPLY_PATCH_MULTI.tool_input.command
      .replace("new.txt", "src/new.mjs").replace("tochange.txt", "src/tochange.mjs")
      .replace("todelete.txt", "src/todelete.mjs")
      .replace("old.txt", "src/old.mjs").replace("renamed.txt", "src/renamed.mjs");
    R.clearLedger();
    const r = R.run("guard-lane-authoring.mjs", { session_id: "s1", ...patchCall(command) });
    assert.equal(r.status, 0, `the guard must exit 0: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/, "a declared T2 task may write all five");

    const paths = R.rows().map((row) => row.path);
    assert.equal(paths.length, 5, `FIVE rows, one per target — got ${paths.length}: ${JSON.stringify(paths)}`);
    assert.deepEqual(paths.sort(), ["src/new.mjs", "src/old.mjs", "src/renamed.mjs", "src/tochange.mjs", "src/todelete.mjs"],
      "including BOTH endpoints of the rename");
    // The v1.6.1 row SHAPE is preserved exactly — this release adds no field to the audit trail.
    for (const row of R.rows()) {
      assert.deepEqual(Object.keys(row).sort(), ["decision", "declarationHash", "path", "sessionId", "state", "taskId", "ts"],
        "the row shape is unchanged from v1.6.1");
      assert.equal(row.state, "in-thread:T2");
    }
  } finally { R.cleanup(); }
});

test("a patch is ATOMIC: one denying target denies the call, and every row says so", () => {
  const R = guardRepo();
  try {
    // An undeclared session: every gated target denies.
    R.clearLedger();
    const denied = R.run("guard-lane-authoring.mjs", {
      session_id: "wrong-session",
      ...patchCall(envelope("*** Add File: src/a.mjs", "+1", "*** Add File: src/b.mjs", "+2")),
    });
    assert.match(denied.stdout, /"permissionDecision":"deny"/);
    assert.match(denied.stdout, /2 gated targets in ONE patch/, "the block says the whole call went down, and why");
    assert.equal(R.rows().length, 2, "still one row per target");

    // THE MIXED CASE, which is where a per-target decision would mislead. `docs/` is not gated, so
    // it contributes no row; the symlinked path denies; the ordinary code path would have been
    // allowed on its own. Because the patch applies as a unit, NOTHING is written — so recording
    // `allow` for the clean target would put a permission in the audit trail that was never
    // exercised. The row carries the CALL's decision and the TARGET's own state.
    R.clearLedger();
    symlinkSync(path.join(R.dir, "src"), path.join(R.dir, "linked"));
    const mixed = R.run("guard-lane-authoring.mjs", {
      session_id: "s1",
      ...patchCall(envelope("*** Add File: src/clean.mjs", "+1", "*** Add File: linked/evil.mjs", "+2", "*** Add File: docs/note.md", "+3")),
    });
    assert.match(mixed.stdout, /"permissionDecision":"deny"/, "the symlinked target denies the call");
    const rows = R.rows();
    assert.equal(rows.length, 2, "docs/ is not gated, so it contributes no row");
    assert.ok(rows.every((row) => row.decision === "deny"), "every row records the CALL's decision — nothing was written");
    assert.deepEqual(rows.map((row) => row.state).sort(), ["in-thread:T2", "symlink-path"],
      "…while each row keeps its OWN state, so the cause stays identifiable");
  } finally { R.cleanup(); }
});

test("the three classes are enforced END TO END by both write guards, each direction executed", () => {
  const R = guardRepo();
  try {
    const denies = (out) => /"permissionDecision":"deny"/.test(out);

    // 1. NO WRITE INTENT ⇒ the cross-repo guard gets out of the way (unchanged behavior).
    assert.equal(denies(R.run("guard-cross-repo-writes.mjs", BASH_CALL).stdout), false);

    // 2. WRITE-SHAPED BUT UNREADABLE ⇒ DENY. This is the branch that used to `exit 0`, and in the
    // Codex lane EVERY apply_patch write landed in it.
    const unreadable = R.run("guard-cross-repo-writes.mjs", patchCall("*** Begin Patch\n*** Add File: a.txt"));
    assert.equal(denies(unreadable.stdout), true, "an unparseable envelope is BLOCKED, not permitted");
    assert.match(unreadable.stdout, /fails CLOSED/);

    // 3. EXTRACTABLE ⇒ every target gated. An in-repo patch passes; a patch that carries ONE target
    // out of the repo is denied even though its other target is fine.
    assert.equal(denies(R.run("guard-cross-repo-writes.mjs", patchCall(envelope("*** Add File: src/ok.mjs", "+1"))).stdout), false);
    // The escape target must land outside EVERY allowed root, and this fixture lives under
    // os.tmpdir() — which on a stock Linux runner (or any rig with TMPDIR unset) IS `/tmp`, one of
    // the guard's own allowed scratch roots. A single `../` therefore escaped the repo but landed
    // back INSIDE the allowlist, where the guard correctly allows, and this assertion went red on
    // every such rig while passing on macOS's /var/folders default. The fixture had gained a
    // property no real adopter repo has. Enough `../` to clamp at the filesystem root fixes it
    // wherever the fixture lives, and keeps the path RELATIVE — which is the load-bearing part,
    // since resolving a relative `*** Move to:` is what is under test. The deny path never writes,
    // so the target not existing is fine.
    const OUTSIDE = `${"../".repeat(12)}kit-test-definitely-outside/stolen.mjs`;
    const escaping = R.run("guard-cross-repo-writes.mjs", patchCall(envelope(
      "*** Add File: src/ok.mjs", "+1", "*** Update File: src/moved.mjs", `*** Move to: ${OUTSIDE}`, "@@", "-a", "+b",
    )));
    assert.equal(denies(escaping.stdout), true, "a rename that carries a file OUT of the repo is blocked");
    assert.match(escaping.stdout, /outside this repo/);
    assert.match(escaping.stdout, /applied as a unit/);

    // The lane guard's two pre-existing no-target states survive BYTE-IDENTICALLY, and the envelope
    // failure is a THIRD state with its own remediation — the declaration is fine, the patch is not.
    assert.match(R.run("guard-lane-authoring.mjs", { session_id: "s1", tool_input: {} }).stdout, /missing-hook-path/);
    assert.match(R.run("guard-lane-authoring.mjs", { session_id: "s1", tool_input: { file_path: 123 } }).stdout, /malformed-hook-path/);
    const envFail = R.run("guard-lane-authoring.mjs", { session_id: "s1", ...patchCall(envelope("*** Rename File: x")) });
    assert.match(envFail.stdout, /"permissionDecision":"deny"/);
    assert.match(envFail.stdout, /unknown patch directive/, "the block names what it could not parse");
    assert.doesNotMatch(envFail.stdout, /task-lane\.json/,
      "…and does NOT send the reader to fix a declaration that is already correct");
  } finally { R.cleanup(); }
});

test("RECEIPT: v2.1 changes no Claude-lane decision except on payloads the harness cannot produce", () => {
  // The pre-v2.1 guard, retained verbatim at acceptance/fixtures/ (provenance:
  // `git show dbe14a1:hooks/guard-cross-repo-writes.mjs`), is executed side by side with the shipped
  // one over ONE corpus. Every difference must be one this test names in advance — otherwise the
  // "narrow polarity change" claim is an assertion rather than a receipt.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-parity-"));
  try {
    const pristine = path.join(KIT, "acceptance", "fixtures", "pre-v2.1-guard-cross-repo-writes.mjs");
    const current = path.join(KIT, "hooks", "guard-cross-repo-writes.mjs");
    const decide = (guard, payload) => {
      const r = spawnSync("node", [guard], {
        cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: JSON.stringify(payload),
      });
      assert.equal(r.status, 0, `guard crashed on ${JSON.stringify(payload)}: ${r.stderr}`);
      return /"permissionDecision":"deny"/.test(r.stdout) ? "deny" : "allow";
    };

    // A corpus covering BOTH lanes' shapes: in-repo, out-of-repo, the allowed roots, adversarial
    // basenames, every write-tool key, and the payload types a malformed call can carry.
    const corpus = [];
    for (const key of ["file_path", "notebook_path"]) {
      for (const p of [
        "src/a.mjs", "docs/x.md", "README.md", "..x.mjs", "a b.txt", "./nested/../a.mjs",
        "../sibling/steal.mjs", "/etc/passwd", "/tmp/scratch.txt", "/private/tmp/s.txt",
        path.join(os.homedir(), ".claude", "memory", "m.md"), path.join(os.homedir(), "other", "x.md"),
      ]) corpus.push({ tool_name: "Write", tool_input: { [key]: p } });
    }
    corpus.push({ tool_name: "Bash", tool_input: { command: "ls" } }, {}, { tool_input: {} },
      { tool_name: "Write", tool_input: {} }, { tool_name: "Write" });
    // The named exceptions: a path KEY that is present and unusable. The pre-v2.1 guard treated
    // these as "no write here" and exited 0; v2.1 treats them as a write it cannot read and denies.
    const EXPECTED_DIFFERENCES = [
      { tool_name: "Write", tool_input: { file_path: "" } },
      { tool_name: "Write", tool_input: { file_path: null } },
      { tool_name: "Write", tool_input: { file_path: 123 } },
      { tool_name: "Write", tool_input: { file_path: ["src/a.mjs"] } },
      { tool_name: "Write", tool_input: { notebook_path: "" } },
      { tool_name: "Write", tool_input: { notebook_path: {} } },
    ];
    const key = JSON.stringify;
    const expected = new Set(EXPECTED_DIFFERENCES.map(key));

    const differed = [];
    for (const payload of [...corpus, ...EXPECTED_DIFFERENCES]) {
      const before = decide(pristine, payload);
      const after = decide(current, payload);
      if (before !== after) differed.push(key(payload));
    }
    // Direction 1: nothing differs that was not declared.
    for (const d of differed) assert.ok(expected.has(d), `UNDECLARED decision change on ${d}`);
    // Direction 2 — the anti-vacuity half. If the exception list named payloads that do NOT actually
    // differ, direction 1 would pass while proving nothing. Every declared exception must really
    // have changed, or the receipt is a list of hypotheticals.
    for (const e of expected) assert.ok(differed.includes(e), `declared exception ${e} did NOT actually change — the receipt is stale`);
    assert.ok(differed.length > 0, "the polarity change is real (a zero-difference run would mean the new guard never loaded)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an out-of-repo target in a multi-target patch SKIPS that target — it does not excuse the others", () => {
  const R = guardRepo();
  try {
    // Pre-v2.1 this hook returned `process.exit(0)` the moment a path resolved outside the repo.
    // With one target that is right: the cross-repo guard owns out-of-repo writes. With an ENVELOPE
    // it is a fail-open — a patch whose FIRST target is `../anything` would wave the gated code
    // through behind it. The out-of-repo target is skipped; the gated one is still gated.
    R.clearLedger();
    const r = R.run("guard-lane-authoring.mjs", {
      session_id: "wrong-session",
      ...patchCall(envelope("*** Add File: ../elsewhere/x.mjs", "+1", "*** Add File: src/gated.mjs", "+2")),
    });
    assert.match(r.stdout, /"permissionDecision":"deny"/,
      "an undeclared write to src/ is still blocked even though an out-of-repo target came first");
    const rows = R.rows();
    assert.equal(rows.length, 1, "the out-of-repo target contributes no row — it is another control's business");
    assert.equal(rows[0].path, "src/gated.mjs");
  } finally { R.cleanup(); }
});

test("the arming probe ABSTAINS rather than passing when it cannot answer the question", () => {
  // An unanswered question is never a pass. The exits this release
  // inherits: not-installed = 2, CLI-absent = 2 (ABSTAIN), armed = 0, not-armed = 1. The two
  // abstain paths are the ones that decide whether a false green is possible at all.
  const probe = path.join(KIT, "scripts", "check-codex-hooks-armed.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-probe-"));
  try {
    // NOT INSTALLED — no .codex/hooks.json.
    const missing = spawnSync("node", [probe, dir], { encoding: "utf8" });
    assert.equal(missing.status, 2, "absent registration ⇒ exit 2, never 0");
    assert.match(missing.stdout, /NOT INSTALLED/);
    assert.match(missing.stdout, /Initialize from your workflow-kit source checkout/,
      "…and says where the initializer exists");
    assert.ok(missing.stdout.includes(`bin/init.mjs with --target ${dir}`),
      "…and keeps the exact missing-registration target");
    assert.match(missing.stdout, /documented\/original initializer arguments/,
      "…and tells the adopter to reuse its original initialization arguments");
    assert.doesNotMatch(missing.stdout, /node bin\/init\.mjs --target/,
      "…and never prescribes a nonexistent adopter-local initializer");

    // The adopter registered hooks THEMSELVES in config.toml, so the kit wrote no hooks.json. Saying
    // only "absent" here sends them to re-run init, which will decline again for the same reason.
    mkdirSync(path.join(dir, ".codex"), { recursive: true });
    writeFileSync(path.join(dir, ".codex", "config.toml"), 'hooks = "./mine.json"\n');
    const theirs = spawnSync("node", [probe, dir], { encoding: "utf8" });
    assert.equal(theirs.status, 2);
    assert.match(theirs.stdout, /declares hooks ITSELF/);
    assert.match(theirs.stdout, /cannot speak for them/, "the probe does not vouch for hooks the kit did not register");

    // CLI ABSENT ⇒ ABSTAIN, exit 2. Reporting "unknown" as "armed" is the precise failure this
    // script exists to prevent, so the exit code must not be 0 even though nothing went wrong.
    writeFileSync(path.join(dir, ".codex", "hooks.json"), "{}\n");
    // Launch node by ABSOLUTE path. Emptying PATH to hide `codex` also hides `node`, so a
    // `spawnSync("node", …)` here exits 127 — and 127 is not 2, so the test failed for a reason that
    // had nothing to do with the branch it was testing. (It failed loudly, which is the point of
    // asserting the exact code rather than "non-zero": a "not 0" assertion would have PASSED on the
    // broken harness and certified an abstain path that never ran.)
    const noCli = spawnSync(process.execPath, [probe, dir], {
      encoding: "utf8", env: { ...process.env, PATH: path.join(dir, "no-tools-here") },
    });
    assert.equal(noCli.status, 2, "a missing codex CLI is an ABSTAIN (exit 2), not a pass");
    assert.match(noCli.stdout, /UNKNOWN/);
    assert.match(noCli.stdout, /ABSTAIN, not a pass/);
    assert.doesNotMatch(noCli.stdout, /\bARMED\b(?!.*NOT)/, "…and it never prints ARMED");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CHARACTERIZATION — the SHELL-WRITE residual: this guard is a tripwire, and here is the road it misses", () => {
  // NOT A BUG REPORT AND NOT A WISH. This pins the accepted limit so it stays VISIBLE. Asked only to
  // create a file, Codex reached UNPROMPTED for a shell command that mutated one (captured in the
  // fixture). A PreToolUse write guard sees `apply_patch`; it does not see that. Telling a
  // file-mutating shell command from a benign one needs real shell parsing — an unbounded chase this
  // kit refuses on purpose — so the honest move is to assert what the guards actually do and keep
  // the `.githooks/pre-commit` floor as the only layer every writer converges at.
  //
  // If a future change makes this test fail, the guards started inspecting shell commands. That is a
  // scope change to a live control, not a bugfix: re-read PORTABILITY.md § The shell-write road
  // before deleting this test, and update that section in the same changeset.
  const R = guardRepo();
  const A = adoptCodex();
  try {
    assert.ok(OBSERVED_SHELL_WRITES.length > 0, "the fixture still carries the captured mutating command");

    // THE RESIDUAL IS IN THE REGISTRATION, which is where it belongs. A shell command reaches Codex
    // as `tool_name: "Bash"`, and the only hook registered for `Bash` is the gate-ladder SENSOR. The
    // write guards are registered for `apply_patch` and never see it.
    const reg = JSON.parse(readFileSync(path.join(A.dir, ".codex", "hooks.json"), "utf8"));
    const bashGroup = reg.hooks.PreToolUse.find((g) => g.matcher === "Bash");
    assert.ok(bashGroup.hooks.every((h) => h.command.includes("guard-gate-ladder")),
      "only the SENSOR is registered for Bash — so nothing on that road can block a shell write");
    assert.ok(!JSON.stringify(bashGroup).includes("guard-lane-authoring"),
      "the write guards are deliberately NOT on the Bash matcher: they treat a shell payload as a " +
      "write with no readable target and would DENY every shell command, bricking the lane");

    // …and the sensor, which is what does fire, permits it — because a sensor never denies.
    for (const command of OBSERVED_SHELL_WRITES) {
      const r = R.run("guard-gate-ladder.mjs", { session_id: "s1", cwd: R.dir, tool_name: "Bash", tool_input: { command } });
      assert.equal(r.status, 0);
      assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/,
        "the captured mutating shell command proceeds — this is the documented residual, not parity");
    }
    // …and the guards DO stop the same mutation when it arrives as a patch, which is what makes the
    // line above a statement about the ROAD rather than about a broken guard.
    const asPatch = R.run("guard-lane-authoring.mjs", {
      session_id: "wrong-session",
      ...patchCall(envelope("*** Update File: src/hello.mjs", "@@", "-a", "+b")),
    });
    assert.match(asPatch.stdout, /"permissionDecision":"deny"/,
      "the identical edit IS blocked when it travels the road the guard watches");
  } finally { R.cleanup(); A.cleanup(); }
});

test("CHARACTERIZATION — `/tmp` and `/private/tmp` are ALLOWED write roots, so escaping INTO them is permitted", () => {
  // PRE-EXISTING v1.x design, both lanes, stated in guard-cross-repo-writes' own header: the allowed
  // roots are the project dir, ~/.claude, /tmp and /private/tmp. A write that leaves the repo for a
  // scratch root is therefore ALLOWED on purpose — scratch is not a place worth guarding.
  //
  // It is pinned here because it surfaced as a phantom bug rather than as a property: this suite's
  // fixtures live under os.tmpdir(), which is `/tmp` on a stock Linux runner and with TMPDIR unset,
  // so a one-level `../` escape landed back inside the allowlist and an escape assertion went red on
  // exactly the rigs adopters use for CI — reading as "the guard is broken" when the guard was
  // right. A property that can masquerade as a defect belongs in a test that names it.
  const R = guardRepo();
  try {
    const denies = (out) => /"permissionDecision":"deny"/.test(out);
    // Explicit, not fixture-dependent: an absolute target in a scratch root is ALLOWED…
    assert.equal(denies(R.run("guard-cross-repo-writes.mjs",
      patchCall(envelope("*** Add File: /private/tmp/kit-scratch-target.mjs", "+1"))).stdout), false,
      "/private/tmp is an allowed write root by design");
    assert.equal(denies(R.run("guard-cross-repo-writes.mjs",
      patchCall(envelope("*** Add File: /tmp/kit-scratch-target.mjs", "+1"))).stdout), false,
      "/tmp likewise");
    // …while a target outside every allowed root is DENIED, which is what makes the two lines above
    // a statement about the ALLOWLIST rather than about a guard that permits everything.
    const denial = R.run("guard-cross-repo-writes.mjs",
      patchCall(envelope("*** Add File: /kit-test-definitely-outside/stolen.mjs", "+1"))).stdout;
    assert.equal(denies(denial), true, "…and anywhere else is still blocked");
    // The denial NAMES its allowed roots, and that list reads as exhaustive — the remediation right
    // after it says to DECLARE a worktreeRoot, so a root left off the list sends an adopter to
    // relocate a worktree the guard already allows, or to declare a root they already have.
    // /private/tmp was missing from it: the very root a macOS adopter's /tmp worktree resolves to,
    // and allowed by the behaviour two assertions above this one the whole time.
    assert.match(denial, /allowed: project dir, ~\/\.claude, \/tmp, \/private\/tmp/,
      `the denial's allowed-root list must name every root the guard actually allows: ${denial}`);
    // The SECOND place this list is spoken to an adopter, and it drifted the same way: init's
    // --worktree-roots help says what you get by omitting the flag. Two renderings of one claim
    // rot independently, so both are pinned here, beside the behaviour they describe.
    // kit-guard:no-install — --help prints and exits before any install path runs.
    const help = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--help"], { encoding: "utf8" });
    assert.match(help.stdout + help.stderr,
      /the shipped roots only \(project dir, ~\/\.claude, \/tmp,\s+\/private\/tmp\)/,
      `init --help must name the same shipped roots the guard allows: ${help.stdout}${help.stderr}`);
  } finally { R.cleanup(); }
});

test("worktreeRoots WIDENS the cross-repo guard to the roots THIS repo declares — and fails CLOSED on a bad one", () => {
  // THE DEFECT (found adopting v2.26.0): `core/MULTI_AGENT.md` sends substantial concurrent work into
  // a private worktree, and this guard shipped the two scratch roots as the only places one could
  // sit. An adopter whose worktrees sit anywhere else had a session that could not write its OWN worktree
  // with the file tools — doctrine and control contradicting each other. The root set is now data.
  //
  // Three polarities, because two of them are the ones that can silently rot: the declared root must
  // be ALLOWED (or the family does nothing), an UNdeclared sibling must still be DENIED (or the
  // family permits everything), and a MALFORMED entry must DENY (or a config nobody can read
  // silently narrows to a root set the adopter did not choose).
  const R = guardRepo();
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-wtroots-"));
  const undeclared = mkdtempSync(path.join(os.tmpdir(), "kit-wtroots-other-"));
  const cfg = path.join(R.dir, ".claude", "kit.config.json");
  const denies = (out) => /"permissionDecision":"deny"/.test(out);
  const write = (abs) => R.run("guard-cross-repo-writes.mjs", patchCall(envelope(`*** Add File: ${abs}/lane.mjs`, "+1")));
  try {
    // Baseline: with NO config both scratch dirs are outside the shipped roots… except on a rig whose
    // os.tmpdir() IS /tmp, where the shipped scratch roots already cover them. Skip the baseline
    // there rather than assert something the allowlist legitimately contradicts (the same masquerade
    // the `/tmp` characterization test above exists to name).
    const shippedScratch = /^\/(private\/)?tmp(\/|$)/.test(outside);
    if (!shippedScratch) {
      assert.equal(denies(write(outside).stdout), true, "precondition: an undeclared root is denied before the family is written");
    }

    writeFileSync(cfg, JSON.stringify({ worktreeRoots: [outside] }) + "\n");
    assert.equal(denies(write(outside).stdout), false, "a DECLARED worktree root is an allowed write root");
    // A path that merely SHARES A PREFIX with the declared root is a different directory, not a
    // child of it. `startsWith(root)` without the separator would let `<root>-evil/` in.
    assert.equal(denies(R.run("guard-cross-repo-writes.mjs",
      patchCall(envelope(`*** Add File: ${outside}-evil/x.mjs`, "+1"))).stdout), true,
      "…and a sibling that merely shares its prefix is NOT inside it");
    if (!shippedScratch) {
      assert.equal(denies(write(undeclared).stdout), true, "…while an UNdeclared root is still denied (the config is load-bearing)");
    }

    // A trailing separator is the same root. path.resolve normalises it; without that, the prefix
    // test builds `<root>//` and matches nothing — a declared root that silently does not work.
    writeFileSync(cfg, JSON.stringify({ worktreeRoots: [outside + path.sep] }) + "\n");
    assert.equal(denies(write(outside).stdout), false, "a declared root with a trailing separator still works");

    // FAIL CLOSED, three ways. A RELATIVE entry is the one an adopter is most likely to type, and it
    // is exactly the wrong-base fail-open resolvePatchBase exists to stop — so it is refused, not
    // resolved against whatever cwd the harness supplied.
    for (const [label, body] of [
      ["a non-absolute entry", JSON.stringify({ worktreeRoots: ["../worktrees"] })],
      ["a non-array value", JSON.stringify({ worktreeRoots: outside })],
      ["unparseable JSON", '{"worktreeRoots":'],
    ]) {
      writeFileSync(cfg, body + "\n");
      const r = write(outside);
      assert.equal(denies(r.stdout), true, `${label} must DENY (fail closed), not fall back to the shipped roots`);
      assert.match(r.stdout, /worktreeRoots/, `${label}: the deny must name the field so the adopter can fix it`);
      // …and the same corrupt config denies an IN-REPO write too: this guard cannot know which roots
      // it is missing, so "fail closed" means every gated write, not only the interesting one.
      assert.equal(denies(R.run("guard-cross-repo-writes.mjs", patchCall(envelope("*** Add File: src/x.mjs", "+1"))).stdout),
        true, `${label}: an in-repo write is denied too — the guard gates against a root set it could not read`);
    }

    // A payload with NO WRITE INTENT never reaches the config at all: a corrupt kit.config.json must
    // not start denying Bash calls.
    assert.equal(denies(R.run("guard-cross-repo-writes.mjs", BASH_CALL).stdout), false,
      "a corrupt config does not turn this guard into a Bash blocker — the no-write-intent branch runs first");
  } finally {
    R.cleanup();
    rmSync(outside, { recursive: true, force: true });
    rmSync(undeclared, { recursive: true, force: true });
  }
});

test("the portable doctrine no longer hard-codes `/tmp` as the only worktree root", () => {
  // The doc half of the same defect. `core/MULTI_AGENT.md` is the CANONICAL multi-writer text every
  // lane is pointed at, and the two entry stubs summarise it; when the guard's root set became data,
  // a doc still naming `/tmp` as the place would have kept sending adopters to a root their own
  // control denies. Pinned so a future edit that reintroduces the hard-coded root goes red here.
  for (const rel of ["core/MULTI_AGENT.md", "templates/AGENTS.md.tmpl", "templates/CLAUDE.md.tmpl"]) {
    const text = readFileSync(path.join(KIT, rel), "utf8");
    assert.match(text, /worktreeRoots/,
      `${rel} must point at the .claude/kit.config.json worktreeRoots family, not at a fixed root`);
    assert.doesNotMatch(text, /worktrees? under `\/tmp`|worktrees go under `\/tmp`/,
      `${rel} must not state that worktrees live under /tmp — that is the default, not the rule`);
  }
});

test("CHARACTERIZATION — PRE-EXISTING gating gaps this release inherits and does NOT close", () => {
  // NOT INTRODUCED HERE and NOT FIXED HERE. `isGatedPath` short-circuits on `isStaticallySafe`, so
  // anything under `docs/` or `memory/` is treated as prose REGARDLESS of extension — including
  // `.mjs` and `.sh` — and the code allowlist has gaps of its own (`CMakeLists.txt` is not in it
  // while `Makefile` is). Both predate v2.1 and bind the CLAUDE lane identically; v2.1 only makes
  // the same predicate apply to a second lane.
  //
  // They are pinned here rather than left implicit for one reason: the Codex lane is new, and a
  // reader who sees "the Codex lane is now guarded" should be able to find out exactly what that
  // does NOT cover without reverse-engineering a regex. Changing the deny-set is a behaviour change
  // to a live control in BOTH lanes and belongs in its own gated changeset — narrowing it here would
  // silently re-scope shapes this changeset never set out to touch.
  //
  // If this test fails, someone changed the gating predicate. That is allowed — but it is a scope
  // change, not a bugfix: update PORTABILITY.md § Known limitations in the same changeset.
  const R = guardRepo();
  try {
    mkdirSync(path.join(R.dir, "memory"), { recursive: true });
    for (const target of ["docs/malicious.sh", "memory/payload.mjs", "CMakeLists.txt", "build/module.cmake"]) {
      const r = R.run("guard-lane-authoring.mjs", {
        session_id: "undeclared-session", cwd: R.dir,
        ...patchCall(envelope(`*** Add File: ${target}`, "+x")),
      });
      assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/,
        `${target} is NOT gated by the write tripwire — pre-existing, and the commit floor is the backstop`);
    }
    // The control that proves the assertions above are about the PREDICATE and not about a broken
    // guard: the same undeclared session writing an ordinary code path IS blocked.
    assert.match(
      R.run("guard-lane-authoring.mjs", { session_id: "undeclared-session", cwd: R.dir, ...patchCall(envelope("*** Add File: src/evil.mjs", "+x")) }).stdout,
      /"permissionDecision":"deny"/, "src/evil.mjs IS gated — the guard is working, the predicate is narrow");
  } finally { R.cleanup(); }
});

test("the gate-ladder SENSOR reads the Codex Bash payload and still never denies", () => {
  const R = guardRepo();
  try {
    // Codex normalizes its shell tool to `Bash` with `tool_input.command`, so the sensor's matcher
    // and command read work unchanged — the one hook that ported without a payload change. The
    // property that must survive the port is that it is a SENSOR: it surfaces, it never blocks.
    for (const command of ["codex exec -s read-only 'review'", "bash scripts/codex-gate.sh", "ls -la", BASH_CALL.tool_input.command]) {
      const r = R.run("guard-gate-ladder.mjs", { session_id: "s1", cwd: R.dir, tool_name: "Bash", tool_input: { command } });
      assert.equal(r.status, 0);
      assert.doesNotMatch(r.stdout, /permissionDecision/,
        `the sensor emitted a permission decision for ${JSON.stringify(command)} — it must never deny`);
    }
    // …and it still fires on a gate invocation (or the "never denies" assertion above would be
    // vacuously true against a sensor that had stopped working entirely).
    const fired = R.run("guard-gate-ladder.mjs", { session_id: "s1", cwd: R.dir, tool_name: "Bash", tool_input: { command: "codex exec -s read-only 'review'" } });
    assert.match(fired.stdout, /GATE LADDER/, "the sensor is LIVE — it surfaces the ladder on a gate invocation");
    // The Codex lane sets no CLAUDE_PROJECT_DIR. Without a working fallback the sensor resolves the
    // wrong tree, finds no declaration, and fail-closes to T3 while a valid T2 declaration sits on
    // disk — a sensor reporting a false cause.
    const noEnv = spawnSync("node", [path.join(KIT, "hooks", "guard-gate-ladder.mjs"), "--project-dir", R.dir], {
      cwd: os.tmpdir(), encoding: "utf8",
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDE_PROJECT_DIR")),
      input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "codex exec 'x'" } }),
    });
    assert.match(noEnv.stdout, /declared tier T2/, "with --project-dir and no CLAUDE_PROJECT_DIR, the sensor still finds the declaration");
  } finally { R.cleanup(); }
});

// ── the install: registration, equality, and the trust doctrine ──────────────────────────────────

function adoptCodex(extraArgs = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-adopt-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  // BOTH STREAMS. init reports kept-vs-written on stdout and every honesty CAVEAT through `warn()`,
  // which writes to stderr — so a test that read stdout alone would silently stop seeing exactly the
  // warnings these assertions exist to check.
  const run = (args = extraArgs) => {
    const r = spawnSync("node",
      [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
      { encoding: "utf8" });
    assert.equal(r.status, 0, `init failed: ${r.stderr}`);
    return `${r.stdout}\n${r.stderr}`;
  };
  const out = run();
  return { dir, out, run, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("init generates .codex/hooks.json with the REAL Codex matcher names and an explicit project dir", () => {
  const A = adoptCodex();
  try {
    const reg = JSON.parse(readFileSync(path.join(A.dir, ".codex", "hooks.json"), "utf8"));
    // The schema Codex actually accepts — verified against the CLI's own parser, which rejects a
    // bare event map with `unknown field 'PreToolUse', expected 'description' or 'hooks'`.
    assert.deepEqual(Object.keys(reg).sort(), ["description", "hooks"]);
    const matchers = reg.hooks.PreToolUse.map((g) => g.matcher);
    assert.deepEqual(matchers, ["apply_patch", "Bash"]);
    // The Claude-lane spelling matches NOTHING in Codex. If this ever reappears here, the guards are
    // installed and registered against tools that do not exist — the origin repo's exact failure.
    const text = readFileSync(path.join(A.dir, ".codex", "hooks.json"), "utf8");
    assert.doesNotMatch(text, /MultiEdit|NotebookEdit/, "the Claude tool names match nothing in Codex");
    for (const group of reg.hooks.PreToolUse) {
      for (const h of group.hooks) {
        assert.equal(h.type, "command");
        assert.ok(h.command.includes(`--project-dir`), "the project root is passed EXPLICITLY (a wrong root is a fail-open)");
        assert.ok(h.command.includes(A.dir), "…and it is this repo's absolute path, which is why the file is [G]");
        // guard- OR sensor-: since v2.2 the apply_patch group carries both, and a regex matching
        // only `guard-` would throw on a sensor rather than check it — which is how a registered
        // file stops being proven installed.
        const file = /hooks\/((?:guard|sensor)-[a-z-]+\.mjs)/.exec(h.command)[1];
        assert.ok(existsSync(path.join(A.dir, ".codex", "hooks", file)), `${file} is registered AND installed`);
      }
    }
    // apply_patch gets ALL THREE write guards AND both sensors; Bash gets the gate-ladder sensor only.
    // `guard-brief-rung` appears here for its brief-WRITE half only: its cross-session send half
    // binds a `…send_message` tool that exists in the Claude harness and not in Codex, so there is
    // no second group for it to join. That asymmetry is a property of the lane, and PORTABILITY.md
    // states it rather than leaving an adopter to infer a symmetry that is not there.
    const applyPatch = reg.hooks.PreToolUse[0].hooks.map((h) => /hooks\/([\w.-]+\.mjs)/.exec(h.command)[1]);
    assert.deepEqual(applyPatch, [
      "guard-cross-repo-writes.mjs",
      "guard-lane-authoring.mjs",
      "guard-brief-rung.mjs",
      "sensor-sweep-owed.mjs",
      "sensor-mutation-owed.mjs",
    ], "an INSTALLED-but-UNREGISTERED sensor is inert — this list is what makes registration provable");
    // …and the Codex registration carries NO send-matcher group, proven rather than assumed: a
    // group appearing here later would mean someone registered a half this lane cannot run.
    assert.equal(reg.hooks.PreToolUse.length, 2, "apply_patch and Bash — no send group in the Codex lane");
    assert.ok(!JSON.stringify(reg).includes("send_message"), "the send half is inert BY ABSENCE here");
    assert.equal(reg.hooks.PreToolUse[1].hooks.length, 1);
    // The probe the checklist tells the adopter to run must be a file init actually wrote.
    assert.ok(existsSync(path.join(A.dir, "scripts", "check-codex-hooks-armed.mjs")));
    assert.match(A.out, /node scripts\/check-codex-hooks-armed\.mjs/);
  } finally { A.cleanup(); }
});

test("the REGISTERED command actually runs the guard — executed verbatim, both execution models", () => {
  // The strongest end-to-end proof available without hook TRUST, which only a human can grant in an
  // interactive Codex session. Everything up to that grant is the kit's responsibility and is
  // checked here: the exact command string Codex would run, fed the exact payload Codex would send,
  // must produce the guard's own ledger signature. A registration that merely LOOKS right — a
  // mis-quoted path, a wrong project dir, a hook file that is not where the command says — would
  // pass every other assertion in this file and then do nothing at all in the real lane.
  const A = adoptCodex();
  try {
    mkdirSync(path.join(A.dir, "src"), { recursive: true });
    writeFileSync(path.join(A.dir, ".claude", "task-lane.json"),
      JSON.stringify({ mode: "in-thread", sessionId: "sX", taskId: "registered-cmd", tier: "T2" }) + "\n");
    const ledger = path.join(A.dir, ".claude", "lane-ledger.jsonl");
    const rowCount = () => (existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter(Boolean).length : 0);

    const reg = JSON.parse(readFileSync(path.join(A.dir, ".codex", "hooks.json"), "utf8"));
    const laneGuard = reg.hooks.PreToolUse[0].hooks.find((h) => h.command.includes("guard-lane-authoring"));
    // The captured envelope shape, retargeted at gated paths in this adopter.
    const payload = JSON.stringify({
      session_id: "sX", cwd: A.dir, hook_event_name: "PreToolUse", tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Add File: src/one.mjs\n+1\n*** Update File: src/two.mjs\n*** Move to: src/three.mjs\n@@\n-a\n+b\n*** End Patch" },
    });

    // MODEL 1 — Codex hands the command to a shell.
    const before = rowCount();
    const viaShell = spawnSync("sh", ["-c", laneGuard.command], { encoding: "utf8", input: payload, cwd: os.tmpdir() });
    assert.equal(viaShell.status, 0, `the registered command failed under a shell: ${viaShell.stderr}`);
    const afterShell = rowCount();
    assert.equal(afterShell - before, 3,
      "the registered command produced the guard's ledger signature — one row per target, all three, from a cwd that is NOT the repo");

    // MODEL 2 — Codex splits the command itself. For an ordinary repo path init writes the command
    // UNQUOTED precisely so both models agree; this asserts that they do, rather than assuming it.
    assert.doesNotMatch(laneGuard.command, /"/, "an ordinary repo path is registered unquoted, so no shell is required");
    const argv = laneGuard.command.split(" ");
    const viaSplit = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", input: payload, cwd: os.tmpdir() });
    assert.equal(viaSplit.status, 0, `the registered command failed under a naive split: ${viaSplit.stderr}`);
    assert.equal(rowCount() - afterShell, 3, "…and the same three rows appear under the other execution model");

    // The rows are real decisions about the right tree, not noise: the project dir came from the
    // registration, since neither CLAUDE_PROJECT_DIR nor the cwd pointed at this repo.
    const rows = readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual([...new Set(rows.map((r) => r.path))].sort(), ["src/one.mjs", "src/three.mjs", "src/two.mjs"]);
    assert.ok(rows.every((r) => r.state === "in-thread:T2" && r.decision === "allow"));
  } finally { A.cleanup(); }
});

test("a repo path needing quotes gets POSIX shell quoting, not JSON quoting", () => {
  // Codex runs a hook command through a shell. JSON.stringify yields DOUBLE quotes, inside which a
  // shell still expands `$VAR` and `$(cmd)` — and a hook that fails to START blocks nothing, so a
  // mangled command string is a fail-open. Single quotes suppress all expansion.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit codex quoted-"));   // deliberate spaces
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "a", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const reg = JSON.parse(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"));
    const cmd = reg.hooks.PreToolUse[0].hooks[0].command;
    assert.match(cmd, /'/, "a path needing quotes is SINGLE-quoted");
    assert.doesNotMatch(cmd, /"/, "…never JSON double-quoted, which leaves shell expansion live");
    assert.match(r.stderr, /shell-QUOTED/, "…and it is disclosed, not buried");
    // Executed through a shell — the way Codex runs it.
    assert.equal(spawnSync("sh", ["-c", cmd], { encoding: "utf8", input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
});

test("a repo path carrying shell metacharacters cannot execute anything when the hook command runs", () => {
  // The sharp end of the quoting fix: `$(...)`/backticks/`$VAR` survive inside double quotes. A repo
  // directory is adopter-chosen, not attacker-chosen, so this is robustness rather than a live
  // threat — but the failure mode is a command that mangles or runs something instead of starting
  // the guard, and a guard that never starts blocks nothing.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-$(touch PWNED)-'q'-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "a", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const cmd = JSON.parse(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8")).hooks.PreToolUse[0].hooks[0].command;
    // A FRESH witness directory as the shell's cwd, so `touch PWNED` would land somewhere this run
    // owns. An earlier version asserted on a fixed `$TMPDIR/PWNED` — and when a mutation reverted the
    // quoting, the substitution really did fire and left that file behind, after which the assertion
    // failed forever for reasons that had nothing to do with the code under test. A test that can be
    // poisoned by its own past runs reports the wrong thing twice: once as a false pass, once as a
    // false fail.
    const witness = mkdtempSync(path.join(os.tmpdir(), "kit-witness-"));
    const run = spawnSync("sh", ["-c", cmd], {
      cwd: witness, encoding: "utf8",
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
    });
    assert.equal(run.status, 0, `the guard must start from a path with metacharacters: ${run.stderr}`);
    assert.deepEqual(readdirSync(witness), [], "…and the command substitution in the path never executed");
    rmSync(witness, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
});

test("the two installed hook trees are BYTE-IDENTICAL — the anti-refork tripwire", () => {
  // The origin repo's `.codex` hooks were stale COPIES of its `.claude` hooks, 48 hours adrift in
  // the dangerous direction, and nothing noticed because nothing compared them. VERIFY BY
  // GENERATING: compare what init actually put on disk, not what the kit ships.
  const A = adoptCodex();
  try {
    const read = (lane) => {
      const d = path.join(A.dir, lane, "hooks");
      return Object.fromEntries(readdirSync(d).sort().map((f) => [f, readFileSync(path.join(d, f), "utf8")]));
    };
    const claude = read(".claude");
    const codex = read(".codex");
    assert.deepEqual(Object.keys(codex), Object.keys(claude), "both lanes hold the same FILES");
    assert.ok(Object.keys(claude).length >= 5, "…and the comparison is not vacuous (an empty tree equals an empty tree)");
    for (const f of Object.keys(claude)) assert.equal(codex[f], claude[f], `${f} differs between the lanes`);

    // MUTATION PROOF: plant ONE divergent byte and the comparison above must fail. Without this the
    // test proves only that two directory listings can be read.
    const victim = path.join(A.dir, ".codex", "hooks", "guard-lane-authoring.mjs");
    writeFileSync(victim, readFileSync(victim, "utf8") + "\n// drift\n");
    const after = read(".codex");
    assert.notEqual(after["guard-lane-authoring.mjs"], claude["guard-lane-authoring.mjs"],
      "the equality check detects a single planted byte of drift");
  } finally { A.cleanup(); }
});

test("UPGRADE: a plain re-run over a v2.0 adopter leaves the lanes SPLIT — and init says so", () => {
  // `.claude/hooks/` already exists
  // on a v2.0 adopter, so every guard there is KEPT at the old version; `.codex/hooks/` is brand new,
  // so every guard there is WRITTEN at the new one. The run exits 0. Without the drift check the
  // adopter ends up with one lane upgraded and one not, and nothing anywhere says so — while the
  // docs claim the two lanes hold byte-identical files.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-upgrade-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-prompts-"));
  // `codex` deliberately OFF the PATH: with the CLI reachable, the post-force armed-check spends a
  // real model call whose verdict tracks this machine's codex auth state, not the code under test.
  // Without it the check ABSTAINS fast — which after --force is a FAILING state (see below).
  const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
  const init = (...extra) => {
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "u", "--codex-prompts-dir", codexDir, ...extra], { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
    // BOTH runs exit 1, each for a reason the body's assertions then distinguish: a plain rerun
    // over the v2.0-shaped adopter is a STALE INSTALL (fails since v2.16.0), and a --force run
    // ends in the post-force armed-check, which cannot verify a hermetic adopter and now FAILS
    // the run rather than warning (exit 0 after --force would claim controls it never verified).
    assert.equal(r.status, 1, r.stderr);
    return `${r.stdout}\n${r.stderr}`;
  };
  try {
    execFileSync("git", ["init", "-q", dir]);
    // Stand up a v2.0-shaped adopter: the guards as they shipped at v2.0, from the retained fixture.
    mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
    const pristine = readFileSync(path.join(KIT, "acceptance", "fixtures", "pre-v2.1-guard-cross-repo-writes.mjs"), "utf8");
    writeFileSync(path.join(dir, ".claude", "hooks", "guard-cross-repo-writes.mjs"), pristine);

    const plain = init();
    const claudeGuard = readFileSync(path.join(dir, ".claude", "hooks", "guard-cross-repo-writes.mjs"), "utf8");
    const codexGuard = readFileSync(path.join(dir, ".codex", "hooks", "guard-cross-repo-writes.mjs"), "utf8");
    assert.notEqual(claudeGuard, codexGuard, "the split is real (this is the state being warned about)");
    assert.match(plain, /two lanes' hooks are NOT identical/, "init DETECTS the split rather than exiting 0 in silence");
    assert.match(plain, /guard-cross-repo-writes\.mjs/, "…and names the file that differs");
    assert.match(plain, /--force/, "…and names the fix");
    assert.match(plain, /then run node scripts\/check-codex-hooks-armed\.mjs and re-trust interactively only if it reports NOT ARMED \(Codex keys trust to each \.codex\/hooks\.json entry, not to the hook script\)/,
      "…and the verify-then-re-trust-only-if-NOT-ARMED order the fix then requires");

    // --force resolves it, and the lanes match again.
    const forced = init("--force");
    assert.equal(
      readFileSync(path.join(dir, ".claude", "hooks", "guard-cross-repo-writes.mjs"), "utf8"),
      readFileSync(path.join(dir, ".codex", "hooks", "guard-cross-repo-writes.mjs"), "utf8"),
      "--force brings both lanes to this kit version");
    assert.doesNotMatch(forced, /two lanes' hooks are NOT identical/, "…and the warning stops (it is not a permanent scold)");
    // The forced run's OWN exit 1 is the armed-check's doing, not a leftover split: the upgraded
    // registration is CURRENT-BUT-UNVERIFIED (no codex CLI here to probe it), and init says so.
    assert.match(forced, /NOT verified armed/, "the post-force armed-check failure is the named cause");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
});

test("ONE REPRESENTATION: an adopter's own hooks declaration is never double-registered", () => {
  // Codex accepts registrations in .codex/config.toml OR .codex/hooks.json and warns when both
  // carry them. Both TOML spellings must be detected — the scalar `hooks = "./hooks.json"` is the
  // one Codex's own schema strings use, and matching only the table header is a fail-open in a
  // DETECTOR: the adopter assumes the kit reconciled hooks it never saw.
  for (const declaration of ['[[hooks.PreToolUse]]\nmatcher = "apply_patch"\n', 'hooks = "./my-hooks.json"\n']) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-conflict-"));
    const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-prompts-"));
    try {
      execFileSync("git", ["init", "-q", dir]);
      mkdirSync(path.join(dir, ".codex"), { recursive: true });
      writeFileSync(path.join(dir, ".codex", "config.toml"), declaration);
      const r = spawnSync("node",
        [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "a", "--codex-prompts-dir", codexDir],
        { encoding: "utf8" });
      assert.equal(r.status, 0, `init failed: ${r.stderr}`);
      const out = `${r.stdout}\n${r.stderr}`;   // the conflict notice is a warn() ⇒ stderr
      assert.ok(!existsSync(path.join(dir, ".codex", "hooks.json")),
        `hooks.json must NOT be written beside a config.toml that declares hooks (${declaration.split("\n")[0]})`);
      assert.match(out, /NOT written/);
      assert.match(out, /SINGLE representation/);
      assert.match(out, /registrations are YOURS/, "…and the adopter is told the kit cannot vouch for their hooks");
      // The kit's own config.toml was NOT force-overwritten, so their declaration survives.
      assert.equal(readFileSync(path.join(dir, ".codex", "config.toml"), "utf8"), declaration);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
  }
});

test("the TRUST caveat ships in the same breath as \"installed\", and the kit never grants trust itself", () => {
  const A = adoptCodex();
  try {
    // The failure this prevents is silent on both sides: untrusted hooks are skipped with no prompt,
    // no warning and no exit-code change. An adopter who reads "installed" and stops reading has an
    // inert control and no way to notice — so the caveat cannot live only in a doc they may not open.
    assert.match(A.out, /INSTALLED but INERT until you grant hook trust/);
    assert.match(A.out, /INTERACTIVE/);
    assert.match(A.out, /skips untrusted hooks\s+SILENTLY/);
    // THE TRUST GRANULARITY, AS MEASURED (2026-09-13, restock-watch, this kit's arming probe): a
    // script-only edit kept the lane ARMED; changing only a hook's statusMessage made it NOT ARMED.
    // Codex keys trust to the hooks.json ENTRY. The migration order follows from that fact.
    assert.match(A.out, /Codex keys trust to each \.codex\/hooks\.json ENTRY \(command, timeout, statusMessage\),\s+not to the hook script: an upgrade that changes only a script stays armed \(and runs\s+the new script WITHOUT re-approval\), while a new or changed entry is NOT ARMED until\s+approved\./,
      "the install-time caveat states what trust is keyed to, including the honest limit");
    assert.match(A.out, /Migration order is: upgrade → re-run that check → re-trust interactively\s+ONLY if it reports NOT ARMED\./,
      "migration order must be stated at install time: verify first, re-trust only on NOT ARMED");
    // THE DOCTRINE, MECHANICALLY. The kit must never write Codex's trust store nor recommend the
    // bypass flag: automating another tool's consent is forging consent, and the flag arms every
    // hook from every source. The only place that flag may appear is a warning NOT to use it.
    const shipped = [
      readFileSync(path.join(KIT, "bin", "init.mjs"), "utf8"),
      readFileSync(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"), "utf8"),
      readFileSync(path.join(A.dir, ".codex", "hooks.json"), "utf8"),
      readFileSync(path.join(A.dir, ".codex", "config.toml"), "utf8"),
    ].join("\n");
    // Both consent-forging routes are checked the same way, and NOT by banning the words: the kit
    // has to be able to SAY "we do not do this" — the doctrine is worthless if it cannot be
    // written down. What must never appear is a line that USES either route. So each mention has to
    // sit on a line that refuses it, and no shipped line may assign a trusted_hash or pass the flag.
    let mentions = 0;
    for (const line of shipped.split("\n")) {
      for (const token of ["trusted_hash", "dangerously-bypass-hook-trust"]) {
        if (!line.includes(token)) continue;
        mentions++;
        assert.match(line, /never|not\b|Do NOT|does not|would be|forging/i,
          `${token} may appear only in a refusal, got: ${line.trim()}`);
      }
      assert.doesNotMatch(line, /trusted_hash\s*=|writeFileSync[^\n]*trusted_hash/,
        `a shipped line WRITES Codex's trust store: ${line.trim()}`);
    }
    assert.ok(mentions >= 2, "the doctrine is stated explicitly, not merely absent (an empty scan would pass vacuously)");
    // …and nothing in the generated tree passes it.
    assert.doesNotMatch(readFileSync(path.join(A.dir, ".codex", "hooks.json"), "utf8"), /--dangerously/);
  } finally { A.cleanup(); }
});

test("the BOOT-READ entry stubs agree with PORTABILITY about what binds the Codex lane", () => {
  // The defect this pins: v2.1 rewrote PORTABILITY.md to say the guards DO bind the Codex lane once
  // trust is granted, while `AGENTS.md`, `CLAUDE.md` and `core/BINDINGS.md` — generated into EVERY
  // adopter, boot-read, marked CLASS: BINDING — still said the opposite, unmarked. An agent reading
  // its own entry stub would have been told a control that binds it does not. Nothing in the suite
  // read generated entry-stub CONTENT before this test, which is why it survived the release that
  // made it false.
  //
  // VERIFY BY GENERATING, not by grepping the templates: the templates are the input, and what an
  // adopter is bound by is the OUTPUT on disk.
  const A = adoptCodex();
  try {
    const stubs = {
      "AGENTS.md": readFileSync(path.join(A.dir, "AGENTS.md"), "utf8"),
      "CLAUDE.md": readFileSync(path.join(A.dir, "CLAUDE.md"), "utf8"),
      "core/BINDINGS.md": readFileSync(path.join(A.dir, "core", "BINDINGS.md"), "utf8"),
    };
    for (const [name, text] of Object.entries(stubs)) {
      // The stale universals, in the spellings the templates actually used.
      assert.doesNotMatch(text, /never loads? them/i, `${name} still says a Codex lane never loads the guards`);
      assert.doesNotMatch(text, /bind ONLY the Claude Code lane/i, `${name} still says the guards bind only Claude`);
      assert.doesNotMatch(text, /do NOT bind a Codex/i, `${name} still says the guards do not bind Codex`);
      // …and each must carry the QUALIFIER, or it swings from understating to overstating.
      assert.match(text, /hook trust/i, `${name} must name the trust gate — "registered" is not "armed"`);
      assert.match(text, /SILENTL?Y|silently/, `${name} must say the skip is silent, or a clean run reads as proof`);
      assert.match(text, /check-codex-hooks-armed/, `${name} must point at the one thing that settles it`);
    }
    // The asymmetry TABLE is the canonical statement, so its Codex column must not still read
    // "NOT enforced" for the three guards.
    const table = stubs["core/BINDINGS.md"];
    for (const guard of ["guard-cross-repo-writes", "guard-lane-authoring", "guard-gate-ladder"]) {
      const row = table.split("\n").find((l) => l.includes(guard) && l.startsWith("|"));
      assert.ok(row, `the asymmetry table still has a row for ${guard}`);
      assert.doesNotMatch(row, /NOT enforced/, `${guard}'s Codex column still says NOT enforced`);
      assert.match(row, /hook trust/, `${guard}'s Codex column must carry the trust qualifier`);
    }
    // No unfilled placeholder in the canonical table — it shipped as a literal `{{OTHER_LANE}}`.
    assert.doesNotMatch(table, /\{\{OTHER_LANE\}\}/, "the asymmetry table's lane column is filled, not a placeholder");
    assert.match(table, /Codex lane/, "…with the lane this kit actually ships hooks for");
  } finally { A.cleanup(); }
});

test("--skip-codex-lane still leaves NO .codex residue now that the lane carries enforcement", () => {
  const A = adoptCodex(["--skip-codex-lane"]);
  try {
    assert.ok(!existsSync(path.join(A.dir, ".codex")), "no .codex/ at all");
    assert.ok(!existsSync(path.join(A.dir, "scripts", "check-codex-hooks-armed.mjs")),
      "…and no arming probe for a lane that was not installed");
    // The Claude lane is untouched by the skip — the guards it registers are the same files.
    assert.ok(existsSync(path.join(A.dir, ".claude", "hooks", "payload-targets.mjs")));
    assert.ok(existsSync(path.join(A.dir, ".claude", "hooks", "guard-lane-authoring.mjs")));
  } finally { A.cleanup(); }
});

test("RETRACTED: no current surface claims that editing or upgrading a hook SCRIPT disarms it", () => {
  // Measured 2026-09-13 (restock-watch, scripts/check-codex-hooks-armed.mjs, the lane guard's ledger
  // row as signature): appending to a hook SCRIPT kept the lane ARMED; changing only that hook's
  // statusMessage in .codex/hooks.json made it NOT ARMED, and restoring it re-armed. Codex keys trust
  // to the hooks.json ENTRY. The old claim shipped on a dozen surfaces; a correction on one surface
  // leaves the rest shipping it, so every tracked current surface is scanned. README release
  // sections and docs/journal/ are HISTORY (what was believed then) and tests/ carry the patterns.
  const retracted = [
    /marks (?:it|a hook) CHANGED/i,
    /upgrades? disarms? hooks/i,
    /changed hook bytes/i,
    /(?:upgraded|changed) hooks? (?:is|are) DISARMED/i,
    /editing or upgrading a hook[^\n]{0,60}DISARM/i,
    /re-trust changed hooks/i,
  ];
  for (const decoy of ["Editing or upgrading a hook marks it CHANGED, which DISARMS it", "upgrades disarm hooks until re-trusted",
    "because changed hook bytes disarm the lane", "an upgraded hook is DISARMED until you do", "changed hooks are DISARMED in the",
    "re-trust changed hooks in the Codex lane"]) {
    assert.ok(retracted.some((re) => re.test(decoy)), `the retraction patterns still bite their own spelling: ${decoy}`);
  }
  const files = execFileSync("git", ["ls-files"], { cwd: KIT, encoding: "utf8" }).split("\n")
    .filter((f) => f && f !== "README.md" && !f.startsWith("docs/journal/") && !f.startsWith("tests/") && /\.(?:md|mjs|js|sh|toml|json|tmpl)$/.test(f));
  assert.ok(files.includes("PORTABILITY.md") && files.includes("bin/init.mjs"), "the scan's denominator includes the surfaces that carried the claim");
  for (const f of files) {
    const text = readFileSync(path.join(KIT, f), "utf8");
    for (const re of retracted) assert.doesNotMatch(text, re, `${f} still carries the retracted trust claim (${re})`);
  }
  // …and the corrected sentence is pinned where operators read it.
  const port = readFileSync(path.join(KIT, "PORTABILITY.md"), "utf8").replace(/\s+/g, " ");
  assert.match(port, /Codex keys trust to each `\.codex\/hooks\.json` ENTRY \(its command, timeout and statusMessage\), not to the hook script's bytes:\*\* an upgrade that changes only a script stays ARMED, while a new or changed registration entry is NOT ARMED until you approve it\./);
  assert.match(port, /\*\*Re-trust, interactively, ONLY if it reports NOT ARMED\*\*/);
  assert.match(port, /an edited hook script runs WITHOUT re-approval/);
  const probe = readFileSync(path.join(KIT, "scripts", "check-codex-hooks-armed.mjs"), "utf8");
  assert.match(probe, /Codex keys trust to each \.codex\/hooks\.json ENTRY, not to the hook script\./);
});

test("the arming check tells the kit SOURCE tree it is not adopted, and still tells an adopter to run init (FM-2026-09-07-32)", async () => {
  // core/REPO_INVARIANTS.md: the kit is never init-adopted. The check used to prescribe
  // `node bin/init.mjs --target <kit>` there. Both branches executed; neither may read green.
  const probe = path.join(KIT, "scripts", "check-codex-hooks-armed.mjs");
  const { isKitSourceTree } = await import(probe);
  const run = (dir) => spawnSync(process.execPath, [probe, dir], { encoding: "utf8", env: { ...process.env, PATH: path.join(dir, "no-codex") } });
  const kitLike = mkdtempSync(path.join(os.tmpdir(), "kit-source-like-"));
  const adopter = mkdtempSync(path.join(os.tmpdir(), "kit-adopter-nohooks-"));
  const ownHooks = mkdtempSync(path.join(os.tmpdir(), "kit-adopter-own-hooks-"));
  const decoy = mkdtempSync(path.join(os.tmpdir(), "kit-decoy-"));
  const ownInstaller = mkdtempSync(path.join(os.tmpdir(), "kit-adopter-own-installer-"));
  try {
    mkdirSync(path.join(kitLike, "bin"), { recursive: true }); mkdirSync(path.join(kitLike, "githooks"), { recursive: true });
    writeFileSync(path.join(kitLike, "bin", "init.mjs"), "// installer\n"); writeFileSync(path.join(kitLike, "githooks", "pre-commit"), "#!/usr/bin/env node\n");
    writeFileSync(path.join(kitLike, "package.json"), JSON.stringify({ name: "workflow-kit" }));
    // An adopter with an installer and a source-spelled hook of its OWN is still an adopter.
    mkdirSync(path.join(ownInstaller, "bin"), { recursive: true }); mkdirSync(path.join(ownInstaller, "githooks"), { recursive: true });
    writeFileSync(path.join(ownInstaller, "bin", "init.mjs"), "// their installer\n"); writeFileSync(path.join(ownInstaller, "githooks", "pre-commit"), "#!/bin/sh\n");
    writeFileSync(path.join(ownInstaller, "package.json"), JSON.stringify({ name: "their-app" }));
    // An adopter's floor lives at .githooks/ and it has no bin/init.mjs — and a lone match is not the kit.
    mkdirSync(path.join(adopter, ".githooks"), { recursive: true }); writeFileSync(path.join(adopter, ".githooks", "pre-commit"), "#!/usr/bin/env node\n");
    mkdirSync(path.join(ownHooks, ".codex"), { recursive: true });
    writeFileSync(path.join(ownHooks, ".codex", "config.toml"), 'hooks = "./their-hooks.json"\n');
    mkdirSync(path.join(decoy, "bin", "init.mjs"), { recursive: true }); mkdirSync(path.join(decoy, "githooks"), { recursive: true });
    writeFileSync(path.join(decoy, "githooks", "pre-commit"), "x\n"); writeFileSync(path.join(decoy, "package.json"), JSON.stringify({ name: "workflow-kit" }));
    assert.equal(isKitSourceTree(KIT), true, "the real kit tree is recognised");
    assert.equal(isKitSourceTree(kitLike), true);
    assert.equal(isKitSourceTree(adopter), false, "an adopter is not the kit");
    assert.equal(isKitSourceTree(decoy), false, "a DIRECTORY named bin/init.mjs is not the installer");
    assert.equal(isKitSourceTree(ownInstaller), false, "an adopter with its own bin/init.mjs and githooks/pre-commit is not the kit");

    for (const dir of [KIT, kitLike]) {
      const r = run(dir);
      assert.equal(r.status, 2, `the kit branch keeps the NOT INSTALLED exit code, never green (${dir})\n${r.stdout}`);
      assert.match(r.stdout, /NOT INSTALLED, BY DESIGN — .* is the workflow-kit SOURCE repository\./);
      assert.match(r.stdout, /The kit is never init-adopted \(core\/REPO_INVARIANTS\.md\), so it has no \.codex\/hooks\.json and\s+no Codex PreToolUse registration\./);
      assert.match(r.stdout, /Do NOT run bin\/init\.mjs against it/);
      assert.doesNotMatch(r.stdout, /Run: node bin\/init\.mjs/, "the forbidden remedy is not printed in the kit");
    }
    for (const dir of [adopter, decoy, ownInstaller]) {
      const r = run(dir);
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stdout, /^NOT INSTALLED — \.codex\/hooks\.json is absent in /m);
      assert.match(r.stdout, /Initialize from your workflow-kit source checkout/, "the remedy identifies where the initializer exists");
      assert.ok(r.stdout.includes(`bin/init.mjs with --target ${dir}`), "the remedy preserves the exact adopter target");
      assert.match(r.stdout, /documented\/original initializer arguments/, "the remedy tells the adopter to reuse its recorded arguments");
      assert.doesNotMatch(r.stdout, /Run: node bin\/init\.mjs --target /, "the nonexistent adopter-local initializer is never prescribed");
      assert.doesNotMatch(r.stdout, /BY DESIGN/);
    }
    const own = run(ownHooks);
    assert.equal(own.status, 2, own.stdout);
    assert.match(own.stdout, /Your \.codex\/config\.toml declares hooks ITSELF/,
      "an adopter-owned hooks registration retains its existing abstain branch");
    assert.doesNotMatch(own.stdout, /workflow-kit source checkout/,
      "an adopter-owned hooks registration does not receive the initializer remedy");
  } finally { for (const d of [kitLike, adopter, ownHooks, decoy, ownInstaller]) rmSync(d, { recursive: true, force: true }); }
});
