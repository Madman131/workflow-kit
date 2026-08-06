// workflow-kit — the pre-send verification rung's control suite.
//
// The rule this guards is `.agents/skills/orchestrate/PROTOCOLS.md` § Coordination: a load-bearing
// dispatch is verified BEFORE it is sent. These tests exist in two layers on purpose. The pure layer
// drives `sidecarState` directly so every branch is reachable without a tree — including the ones a
// tree makes awkward (a payload with no session id, a sidecar 31 minutes old). The adopter layer
// then EXECUTES the installed hook from where `init` puts it, because presence and registration are
// the two lies this kit has already shipped, one release apart.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOW_STATES, briefTargets, denyReason, isBriefPath, isSendTool, loadBriefConfig, sidecarState,
  spentNoncesFrom, withLedgerLock, LOCK_UNAVAILABLE,
} from "../hooks/guard-brief-rung.mjs";
import { toRepoRelative } from "../hooks/payload-targets.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEND = { kind: "send", target: "local_dest" };
const BRIEF = { kind: "brief", target: "briefs/cs1.md" };
const OK_CHECK = [{ command: "wc -w PROTOCOLS.md", output: "1987" }];
const fresh = (over = {}) => ({ sessionId: "s1", target: "briefs/cs1.md", nonce: "n1", checks: OK_CHECK, ...over });
const state = (sidecar, over = {}) =>
  sidecarState(sidecar, { ageMin: 1, sessionId: "s1", dispatch: BRIEF, ...over }).state;

// ---------------------------------------------------------------- scope: what owes the rung

test("a BRIEF is recognised by its directory OR its name — and a shipped instruction artifact is not one", () => {
  // Clause (a): the configured/default brief directory.
  assert.equal(isBriefPath("briefs/cs1.md"), true);
  assert.equal(isBriefPath("dispatches/cs1.md"), false, "an unconfigured directory is out of scope…");
  assert.equal(isBriefPath("dispatches/cs1.md", ["dispatches"]), true, "…until kit.config.json names it");
  // Clause (b): the basename, so the control is not inert in an adopter who configured nothing —
  // which is the state EVERY adopter starts in.
  assert.equal(isBriefPath("docs/chip-brief-cs1.md"), true);
  assert.equal(isBriefPath("docs/CHIP_BRIEF_cs1.md"), true, "…case-insensitively");
  assert.equal(isBriefPath("docs/design.md"), false);
  assert.equal(isBriefPath("briefs/notes.txt"), false, "a non-markdown file is not a brief");
  // The exclusion, and it is load-bearing: /orchestrate SHIPS `CHIP_BRIEF.md` as a template. Gating
  // it would make routine skill maintenance owe a dispatch ritual — the unaffordable-rule failure
  // mode, shipped by the very release that warns about it.
  for (const root of [".agents", ".claude", ".codex", "agents", "commands", "skills", "skill-shims", "templates"]) {
    assert.equal(isBriefPath(`${root}/orchestrate/CHIP_BRIEF.md`), false,
      `${root}/ holds governed instruction artifacts, not dispatches`);
  }
  // …but the exclusion is ROOT-anchored, so an adopter's own brief that merely mentions one is in.
  assert.equal(isBriefPath("briefs/skills-rewrite-brief.md"), true);
});

test("the SEND half binds a send tool and nothing else — harness-specific by construction", () => {
  assert.equal(isSendTool("mcp__ccd_session_mgmt__send_message"), true);
  assert.equal(isSendTool("send_message"), true);
  assert.equal(isSendTool("Write"), false);
  assert.equal(isSendTool("apply_patch"), false);
  assert.equal(isSendTool(undefined), false);
});

test("briefTargets reads BOTH lane payload shapes through the shared grammar, and dedupes", () => {
  const root = "/repo";
  const opts = { root, patchBase: root, briefPathDirs: [], toRepoRelative };
  // Claude shape.
  assert.deepEqual(
    briefTargets({ tool_name: "Write", tool_input: { file_path: "/repo/briefs/a.md" } }, opts),
    ["briefs/a.md"]);
  // Codex shape — a MULTI-TARGET envelope, the case a per-lane copy of this guard would have missed.
  const command = "*** Begin Patch\n*** Add File: briefs/a.md\n+x\n*** Add File: briefs/b.md\n+y\n" +
    "*** Add File: src/x.mjs\n+z\n*** End Patch";
  assert.deepEqual(
    briefTargets({ tool_name: "apply_patch", cwd: root, tool_input: { command } }, opts),
    ["briefs/a.md", "briefs/b.md"], "every brief in the envelope, and only the briefs");
  // No write intent ⇒ nothing owed.
  assert.deepEqual(briefTargets({ tool_name: "Read", tool_input: {} }, opts), []);
});

// ---------------------------------------------------------------- the sidecar, state by state

test("the sidecar's ALLOW states are exactly two, and every other state denies", () => {
  assert.deepEqual([...ALLOW_STATES].sort(), ["receipted", "status-declared"]);
});

test("absent / malformed / stale all deny — malformed is never read as satisfied", () => {
  assert.equal(state(undefined), "absent");
  assert.equal(state(null), "malformed", "unparseable, symlinked or non-regular arrives as null");
  assert.equal(state([1, 2]), "malformed", "an array is not a sidecar object");
  assert.equal(state(fresh({ class: "urgent" })), "malformed", "an unknown class is malformed, not ignored");
  assert.equal(state(fresh(), { ageMin: 31 }), "stale");
  // A FUTURE-dated sidecar is the freshness window's own bypass: push the mtime forward and it
  // never expires. It gets its OWN state, because a deny saying "N minutes old" about a file dated
  // tomorrow would misdescribe the input it just read. Small tolerance for ordinary clock skew.
  assert.equal(state(fresh(), { ageMin: -1440 }), "future-dated");
  assert.equal(state(fresh(), { ageMin: -0.5 }), "receipted", "…but a few seconds of skew is not an attack");
  assert.equal(state(fresh(), { ageMin: 29 }), "receipted", "…and 29 minutes is still fresh (both sides of the window)");
});

test("SESSION BINDING FAILS CLOSED — the divergence from the reference implementation", () => {
  // The reference read `if (sidecar.sessionId && sessionId && sidecar.sessionId !== sessionId)`, a
  // truthiness read on a load-bearing field (INVARIANTS rule 3's class). Its consequence: a sidecar
  // that OMITS sessionId skips the check, so the forgery the binding exists to stop is performed by
  // deleting a field. All three shapes must deny here.
  assert.equal(state(fresh({ sessionId: undefined })), "session-missing");
  assert.equal(state(fresh({ sessionId: "" })), "session-missing", "empty is absent, not a wildcard");
  assert.equal(state(fresh({ sessionId: "other" })), "session-mismatch");
  // And a payload carrying no session cannot CORROBORATE a binding — that is not a match either.
  assert.equal(state(fresh(), { sessionId: undefined }), "session-unverifiable");
  assert.equal(state(fresh(), { sessionId: "" }), "session-unverifiable");
  // The permitting direction, so this is a discriminating test and not a blanket deny.
  assert.equal(state(fresh()), "receipted");
});

test("TARGET BINDING is what makes freshness mean anything — copied and re-touched sidecars deny", () => {
  // `cp` gives a copy a NEW mtime and `touch` clears staleness without re-running a single check, so
  // an mtime window alone lets one honest ritual authorize unlimited unchecked dispatches. The
  // sidecar names the ONE dispatch its checks were run for.
  assert.equal(state(fresh({ target: undefined })), "target-missing");
  assert.equal(state(fresh({ target: "" })), "target-missing");
  assert.equal(state(fresh({ target: "briefs/OTHER.md" })), "target-mismatch");
  assert.equal(state(fresh({ target: "local_dest" }), { dispatch: SEND }), "receipted",
    "a send binds to its DESTINATION session");
  assert.equal(state(fresh({ target: "local_other" }), { dispatch: SEND }), "target-mismatch");
});

test("a receipt must carry a command AND its captured output — a bare declaration is refused", () => {
  assert.equal(state(fresh({ checks: [] })), "no-executed-check");
  assert.equal(state(fresh({ checks: undefined })), "no-executed-check");
  assert.equal(state(fresh({ checks: "I checked everything" })), "no-executed-check", "a string is not a check list");
  assert.equal(state(fresh({ checks: [{ command: "wc -w x" }] })), "no-executed-check", "a command with no OUTPUT is a claim");
  assert.equal(state(fresh({ checks: [{ output: "1987" }] })), "no-executed-check", "an output with no COMMAND is unattributed");
  assert.equal(state(fresh({ checks: [{ command: "  ", output: "  " }] })), "no-executed-check", "whitespace is not a receipt");
  assert.equal(state(fresh({ checks: [{ command: "x", output: "y" }] })), "receipted");
});

test("the STATUS escape is available to a send and refused to a brief", () => {
  // Rule 1 binds LOAD-BEARING dispatches, not every status message — and a hook must not make that
  // semantic call itself (INVARIANTS rule 1), so the author declares it and the ledger records it.
  const s = fresh({ class: "status", checks: undefined, target: "local_dest" });
  assert.equal(state(s, { dispatch: SEND }), "status-declared", "a status send needs no receipts…");
  assert.equal(state(fresh({ class: "status", checks: undefined }), { dispatch: BRIEF }), "status-not-available",
    "…and a brief cannot declare its way out: it is load-bearing by definition");
  // An explicit load-bearing class still owes receipts — the field cannot be used to skip them.
  assert.equal(state(fresh({ class: "load-bearing", checks: [] })), "no-executed-check");
});

test("CONSUME ON USE — one ritual, one dispatch, and the repeat is the dangerous case", () => {
  // Target-binding kills the COPIED and the RE-TOUCHED sidecar. It does NOT kill a SECOND dispatch
  // to the SAME target inside the freshness window — and that repeat is the sharp one: a brief
  // re-edited at the same path carries text the original ritual never saw, riding receipts minted
  // for different content. Freshness cannot see it and target-binding cannot see it.
  assert.equal(state(fresh({ nonce: undefined })), "nonce-missing");
  assert.equal(state(fresh({ nonce: "   " })), "nonce-missing", "whitespace is not a nonce");
  assert.equal(state(fresh(), { spentNonces: new Set(["n1"]) }), "rung-already-spent");
  assert.equal(state(fresh(), { spentNonces: new Set(["other"]) }), "receipted",
    "…and an UNRELATED spent nonce does not block this one (both directions)");
  // The status route consumes nothing, and the asymmetry is deliberate: it presented no receipts,
  // so it has none to spend. What it leaves is a legible ledger row.
  assert.equal(
    sidecarState(fresh({ class: "status", checks: undefined, nonce: undefined, target: "local_dest" }),
      { ageMin: 1, sessionId: "s1", dispatch: SEND, spentNonces: new Set() }).state,
    "status-declared", "a status send needs no nonce because it spends nothing");
});

test("spentNoncesFrom reads the audit trail, and fails CLOSED on one it cannot read", () => {
  assert.deepEqual([...spentNoncesFrom(undefined)], [], "no ledger yet ⇒ nothing spent");
  const rows = [
    JSON.stringify({ control: "brief-rung", nonce: "a" }),
    JSON.stringify({ control: "lane-authoring", nonce: "ignored" }),
    JSON.stringify({ control: "brief-rung", nonce: "b" }),
  ].join("\n") + "\n";
  assert.deepEqual([...spentNoncesFrom(rows)].sort(), ["a", "b"], "only THIS control's nonces count");
  // Unreadable ⇒ null ⇒ the caller denies. If the record of what is spent cannot be read, nothing
  // can honestly be called unspent.
  assert.equal(spentNoncesFrom("{not json}\n"), null);
  assert.equal(spentNoncesFrom('{"control":"brief-rung"}'), null, "a missing trailing newline is a truncated trail");
  assert.equal(spentNoncesFrom("[1,2]\n"), null, "a non-object row is a corrupt trail");
  // The DEFENSIVE branch, pinned rather than left unproven: `readFileSync(…, "utf8")` always hands
  // back a string today, so this is unreachable in practice — and an unpinned defensive branch is
  // exactly what a mutation battery finds SURVIVING. It did; this is the assertion that kills it.
  assert.equal(spentNoncesFrom(123), null, "a non-string ledger is unreadable, not empty");
  assert.equal(spentNoncesFrom(null), null);
});

test("every deny state produces a message that names the state's OWN remediation", () => {
  // A control that misdescribes the input it just read teaches its reader to discount it. Each
  // string is asserted on the phrase that DISCRIMINATES it, never on the shared ritual template.
  const cases = {
    absent: /has not run for this dispatch/,
    malformed: /MALFORMED/,
    stale: /belong to another dispatch's ritual/,
    "session-missing": /not a binding/,
    "session-unverifiable": /cannot be corroborated/,
    "session-mismatch": /another lane's ritual/,
    "target-missing": /copying a sidecar gives it a NEW mtime/,
    "target-mismatch": /one ritual authorizes one dispatch/,
    "status-not-available": /load-bearing by definition/,
    "future-dated": /ahead of the clock is not fresh/,
    "lock-unavailable": /An unserialised consume is not a consume/,
    "nonce-missing": /needs a value to spend/,
    "rung-already-spent": /One ritual authorizes ONE dispatch/,
    "no-executed-check": /assert-without-executing/,
    "kit-config-malformed": /must never silently narrow a control's scope/,
    "ledger-error": /fails CLOSED when it cannot record a trace/,
  };
  for (const [s, re] of Object.entries(cases)) {
    assert.match(denyReason(s, { dispatch: BRIEF, detail: "x" }), re, `${s} owes its own remediation`);
  }
  // The DISCLOSED LIMITS travel with the control, in the text the author actually reads.
  const r = denyReason("absent", { dispatch: BRIEF });
  // The honesty half, and it is deliberately WEAKER than "the ritual ran": a fabricated sidecar
  // satisfies this guard, because nothing here executes a receipt or compares it to reality. The
  // stronger claim is the exact over-claim class the rung exists to catch, so the control must not
  // make it about itself — that is what this assertion pins.
  assert.match(r, /proves such a RECORD EXISTS/, "it claims a record exists, not that checks ran");
  assert.match(r, /not that its commands were run/, "…and says so in the words an author reads");
  assert.doesNotMatch(r, /proves the ritual RAN/, "the over-claim must not return");
  assert.match(r, /shell\s+write bypasses it/, "it is tool-bound");
  assert.match(r, /tripwire rather than a floor/, "it is a tripwire, not a floor");
  // …and the two IO-failure states deliberately do NOT append the ritual: re-running the rung does
  // not fix a corrupt config or an unwritable ledger, and telling the author it might is a lie.
  assert.doesNotMatch(denyReason("ledger-error", { dispatch: BRIEF }), /OPEN every citation/);
  assert.doesNotMatch(denyReason("kit-config-malformed", { dispatch: BRIEF }), /OPEN every citation/);
});

test("a corrupt kit.config.json fails CLOSED rather than silently narrowing scope", () => {
  const read = (v) => () => v;
  assert.deepEqual(loadBriefConfig("/r", { readConfig: read(undefined) }), { ok: true, briefPathDirs: [] },
    "absent config ⇒ portable defaults, a legitimate minimal state");
  assert.deepEqual(loadBriefConfig("/r", { readConfig: read('{"briefPathDirs":["d"]}') }), { ok: true, briefPathDirs: ["d"] });
  for (const bad of ["{oops", "[]", '"str"', '{"briefPathDirs":"d"}', '{"briefPathDirs":["a/b"]}', '{"briefPathDirs":[""]}']) {
    assert.equal(loadBriefConfig("/r", { readConfig: read(bad) }).ok, false, `${bad} must fail closed`);
  }
});

// ---------------------------------------------------------------- installed · registered · RUNS

function adopt() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-rung-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-rung-codex-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://example.com/a.git"]);
  execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
    "--owner-name", "T", "--codex-prompts-dir", codexDir], { stdio: "ignore" });
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("THE GUARD IS INSTALLED, REGISTERED, AND RUNS IN A REAL ADOPTER TREE — proven both ways", () => {
  // Presence and registration are the two lies this kit shipped one release apart (v2.1.0's probe,
  // v2.2.0's sensor). So this adopts, asserts the file is THERE, asserts BOTH lanes REGISTER it, and
  // then EXECUTES it from its installed location in both directions.
  const { dir, cleanup } = adopt();
  try {
    // 1. INSTALLED — in both lanes, byte-identically (the anti-refork property).
    const claudeHook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const codexHook = path.join(dir, ".codex", "hooks", "guard-brief-rung.mjs");
    assert.equal(readFileSync(claudeHook, "utf8"), readFileSync(path.join(KIT, "hooks", "guard-brief-rung.mjs"), "utf8"),
      "the installed Claude-lane hook is the kit's file");
    assert.equal(readFileSync(codexHook, "utf8"), readFileSync(claudeHook, "utf8"),
      "…and the two lanes receive byte-identical copies");

    // 1b. GITIGNORED. The sidecar is an AUTHORIZATION artifact, and a committed one travels to every
    // clone where no ledger records its nonce as spent and `git checkout` mints it a fresh mtime.
    // Session binding would still refuse it, but this kit does not ship a committed authorization
    // artifact and rely on the last check standing.
    const gi = readFileSync(path.join(dir, ".gitignore"), "utf8");
    for (const p of [".claude/task-lane.json", ".claude/lane-ledger.jsonl", ".claude/brief-rung.json"]) {
      assert.ok(gi.split("\n").includes(p), `${p} is per-session state and must be gitignored`);
    }

    // 2. REGISTERED — in the generated registration each lane actually reads.
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const commands = JSON.stringify(settings.hooks.PreToolUse);
    assert.match(commands, /guard-brief-rung\.mjs/, "registered in the Claude lane");
    const writeGroup = settings.hooks.PreToolUse.find((g) => /Write/.test(g.matcher));
    assert.ok(writeGroup.hooks.some((h) => /guard-brief-rung/.test(h.command)), "…on the write matcher");
    const sendGroup = settings.hooks.PreToolUse.find((g) => /send_message/.test(g.matcher));
    assert.ok(sendGroup && sendGroup.hooks.some((h) => /guard-brief-rung/.test(h.command)),
      "…and on a matcher that reaches the send tool, or the send half is registered nowhere");
    const codexReg = JSON.parse(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"));
    assert.match(JSON.stringify(codexReg), /guard-brief-rung\.mjs/, "registered in the Codex lane too");

    // 3. RUNS — executed from the INSTALLED location, both directions.
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    const run = (payload, hook = claudeHook) => spawnSync(
      process.execPath, [hook, "--project-dir", dir],
      { input: JSON.stringify(payload), encoding: "utf8" });
    const briefWrite = {
      session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: path.join(dir, "briefs", "cs1.md") },
    };

    // BLOCKING direction: no sidecar ⇒ denied, and the message is the ritual, not a stack trace.
    const denied = run(briefWrite);
    assert.equal(denied.status, 0, `the guard must exit 0 and speak through its payload: ${denied.stderr}`);
    assert.doesNotMatch(denied.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/,
      "it must resolve its imports from an ADOPTER layout, not only the kit's");
    assert.match(denied.stdout, /"permissionDecision":"deny"/);
    assert.match(denied.stdout, /has not run for this dispatch/);

    // PERMITTING direction: a fresh, session-bound, target-bound sidecar with a real receipt.
    const sidecar = path.join(dir, ".claude", "brief-rung.json");
    writeFileSync(sidecar, JSON.stringify({
      sessionId: "s1", target: "briefs/cs1.md", nonce: "rung-1",
      checks: [{ command: "wc -w skills/orchestrate/PROTOCOLS.md", output: "1987" }],
    }));
    const allowed = run(briefWrite);
    assert.equal(allowed.status, 0);
    assert.doesNotMatch(allowed.stdout, /"permissionDecision":"deny"/, "a satisfied rung PERMITS the write");

    // …and the allow left an audit row the Owner can spot-check.
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((r) => JSON.parse(r)).filter((r) => r.control === "brief-rung");
    assert.equal(rows.length, 1, "one row per allowed dispatch");
    assert.equal(rows[0].state, "receipted");
    assert.equal(rows[0].target, "briefs/cs1.md");
    // CLEAR TEXT, both fields: the ledger's named consumer is the Owner's spot-check, and a
    // spot-check cannot read a digest. The declared CLASS is what makes the status escape honest —
    // it is not stopped mechanically, so it must at least be COUNTABLE by a human.
    assert.equal(rows[0].class, "load-bearing");
    assert.equal(rows[0].nonce, "rung-1", "the spent nonce IS the consumption record");

    // The CODEX-lane copy runs from ITS installed location too — byte-identity is a claim about
    // installation, not execution, and only running each where it installs settles it.
    const codexDenied = spawnSync(process.execPath, [codexHook, "--project-dir", dir], {
      input: JSON.stringify({
        session_id: "s2", tool_name: "apply_patch", cwd: dir,
        tool_input: { command: "*** Begin Patch\n*** Add File: briefs/cs2.md\n+x\n*** End Patch" },
      }), encoding: "utf8",
    });
    assert.equal(codexDenied.status, 0, `the Codex-lane copy must run: ${codexDenied.stderr}`);
    assert.match(codexDenied.stdout, /"permissionDecision":"deny"/,
      "the brief-WRITE half binds the Codex lane through the shared envelope grammar");
  } finally { cleanup(); }
});

test("one sidecar authorizes ONE dispatch — a two-brief envelope cannot ride a single ritual", () => {
  // A patch envelope is applied as a unit, so deciding on the first match would let the second brief
  // ride the first one's sidecar. Every target is judged before anything is allowed.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "brief-rung.json"), JSON.stringify({
      sessionId: "s1", target: "briefs/a.md", nonce: "rung-1", checks: [{ command: "c", output: "o" }],
    }));
    const r = spawnSync(process.execPath, [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir], {
      input: JSON.stringify({
        session_id: "s1", tool_name: "apply_patch", cwd: dir,
        tool_input: { command: "*** Begin Patch\n*** Add File: briefs/a.md\n+x\n*** Add File: briefs/b.md\n+y\n*** End Patch" },
      }), encoding: "utf8",
    });
    assert.match(r.stdout, /"permissionDecision":"deny"/, "the SECOND brief is uncovered, so the call is denied");
    assert.match(r.stdout, /one ritual authorizes one dispatch/);
  } finally { cleanup(); }
});

test("A SECOND DISPATCH CANNOT RIDE THE FIRST RITUAL — allow, then deny, same target, executed", () => {
  // The walk-through case consumption exists for, proven END TO END rather than in the pure layer:
  // same session, same target, same sidecar, well inside the freshness window. Before consumption
  // this pair was allow/allow, and the second write is precisely the dangerous one — a brief
  // re-edited at that path carries text the first ritual never verified.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    const sidecar = path.join(dir, ".claude", "brief-rung.json");
    const payload = JSON.stringify({
      session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: "briefs/cs1.md" },
    });
    const run = () => spawnSync(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: payload, encoding: "utf8" });
    const write = (nonce) => writeFileSync(sidecar, JSON.stringify({
      sessionId: "s1", target: "briefs/cs1.md", nonce,
      checks: [{ command: "wc -w x", output: "1987" }],
    }));

    write("rung-1");
    assert.doesNotMatch(run().stdout, /"permissionDecision":"deny"/, "first dispatch: the ritual is spent on it");
    const second = run();
    assert.match(second.stdout, /"permissionDecision":"deny"/, "SECOND dispatch on the SAME sidecar is refused");
    assert.match(second.stdout, /ALREADY been spent/);
    // …and the cure is the rule, not a workaround: run the rung again, write a new nonce.
    write("rung-2");
    assert.doesNotMatch(run().stdout, /"permissionDecision":"deny"/, "a NEW ritual authorizes the next dispatch");
    // Exactly two allows, each with its own spent nonce in clear text.
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((r) => JSON.parse(r)).filter((r) => r.control === "brief-rung");
    assert.deepEqual(rows.map((r) => r.nonce), ["rung-1", "rung-2"]);
  } finally { cleanup(); }
});

test("A CORRUPT kit.config FAILS CLOSED FOR THE ADOPTERS IT EXISTS TO PROTECT", () => {
  // Found by the cross-family seat, reproduced before fixing. Evaluating a corrupt-config payload
  // against the DEFAULT brief dirs is not fail-closed — it only looks like it. An adopter who
  // configured `dispatches/` loses enforcement on exactly their brief directory at exactly the
  // moment their config broke: the branch fails OPEN for the only adopters it is for.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "dispatches"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), '{"briefPathDirs":');   // corrupt
    const r = spawnSync(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
        tool_input: { file_path: "dispatches/cs1.md" } }), encoding: "utf8" });
    assert.match(r.stdout, /"permissionDecision":"deny"/, "an unanswerable brief-path question denies");
    assert.match(r.stdout, /MALFORMED/);
    // …and the over-broad direction stops at the shipped instruction roots, so fixing config is the
    // only thing this blocks — not every file in the tree.
    const skill = spawnSync(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
        tool_input: { file_path: ".agents/skills/orchestrate/CHIP_BRIEF.md" } }), encoding: "utf8" });
    assert.doesNotMatch(skill.stdout, /"permissionDecision":"deny"/,
      "a shipped instruction artifact is still not a dispatch, even with config corrupt");
  } finally { cleanup(); }
});

test("CONSUMPTION IS SERIALISED — six concurrent dispatches on one nonce yield exactly one allow", () => {
  // Measured on this changeset BEFORE the lock existed: five of six were allowed and five rows
  // carried the same nonce. Atomicity of the ledger APPEND is not atomicity of the DECISION —
  // consumption is read-validate-append, and concurrent hook processes interleave inside it.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "brief-rung.json"), JSON.stringify({
      sessionId: "s1", target: "briefs/cs1.md", nonce: "race", checks: [{ command: "c", output: "o" }],
    }));
    const payload = JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: "briefs/cs1.md" } });
    const runs = Array.from({ length: 6 }, () => spawnSync(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: payload, encoding: "utf8" }));
    const allowed = runs.filter((r) => !/"permissionDecision":"deny"/.test(r.stdout)).length;
    assert.equal(allowed, 1, `exactly one dispatch may spend one ritual, got ${allowed}`);
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((r) => JSON.parse(r)).filter((r) => r.nonce === "race");
    assert.equal(rows.length, 1, "and the audit trail records exactly one spend");
  } finally { cleanup(); }
});

test("the lock is a SENTINEL, not a truthiness read — 'could not lock' never reads as 'allowed'", () => {
  // `withLedgerLock` returns null for ALLOWED and a symbol for COULD-NOT-LOCK. Collapsing those
  // with a truthiness test would map lock-failure onto allow, which is the fail-open the lock is for.
  const { dir, cleanup } = adopt();
  try {
    assert.equal(withLedgerLock(dir, () => null), null, "fn's null (allowed) passes through");
    assert.equal(withLedgerLock(dir, () => "x"), "x");
    // A lock held by someone else, never released and NOT stale, is refused rather than waited out.
    writeFileSync(path.join(dir, ".claude", "brief-rung.lock"), "");
    assert.equal(withLedgerLock(dir, () => null), LOCK_UNAVAILABLE, "a held lock denies");
    assert.notEqual(LOCK_UNAVAILABLE, null, "…and the two outcomes are distinguishable");

    // END TO END, and it pins the MESSAGE rather than only the decision. Dropping the call-site
    // branch still denies — the symbol falls through and `outcome.state` is undefined — so the
    // behaviour stays fail-closed while the author is told "sidecar state is undefined". A control
    // that misdescribes the input it just read teaches its reader to discount it, and a mutation
    // proved nothing here caught that until this assertion existed.
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "brief-rung.json"), JSON.stringify({
      sessionId: "s1", target: "briefs/cs1.md", nonce: "n", checks: [{ command: "c", output: "o" }],
    }));
    const held = spawnSync(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
        tool_input: { file_path: "briefs/cs1.md" } }), encoding: "utf8" });
    assert.match(held.stdout, /"permissionDecision":"deny"/, "a held lock denies the dispatch…");
    assert.match(held.stdout, /An unserialised consume is not a consume/, "…and SAYS why");
    assert.doesNotMatch(held.stdout, /sidecar state is undefined/, "never a fallthrough message");
  } finally { cleanup(); }
});

test("an unreadable payload DENIES — the reference's exit(0) is the fail-open CS5b killed", () => {
  const { dir, cleanup } = adopt();
  try {
    const r = spawnSync(process.execPath, [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: "{not json", encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /"permissionDecision":"deny"/, "a call this guard cannot SEE is not a call it permits");
    assert.match(r.stdout, /not evidence that nothing was dispatched/);
  } finally { cleanup(); }
});

test("a SYMLINKED sidecar is malformed, not satisfied — and a stale one is refused by real mtime", () => {
  // Both are exercised through the filesystem rather than the pure layer, because both are claims
  // about how the hook READS the tree, which the pure layer cannot make.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    const sidecar = path.join(dir, ".claude", "brief-rung.json");
    const outside = path.join(dir, "elsewhere.json");
    const good = JSON.stringify({ sessionId: "s1", target: "briefs/cs1.md", nonce: "rung-1", checks: [{ command: "c", output: "o" }] });
    const run = () => spawnSync(process.execPath, [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir, tool_input: { file_path: "briefs/cs1.md" } }),
      encoding: "utf8",
    });

    writeFileSync(outside, good);
    symlinkSync(outside, sidecar);
    assert.match(run().stdout, /MALFORMED/, "a symlinked sidecar cannot authorize a dispatch from outside the repo");

    rmSync(sidecar);
    writeFileSync(sidecar, good);
    assert.doesNotMatch(run().stdout, /"permissionDecision":"deny"/, "…the same content as a REGULAR file is fine");

    const old = Date.now() / 1000 - 31 * 60;
    utimesSync(sidecar, old, old);
    const stale = run();
    assert.match(stale.stdout, /"permissionDecision":"deny"/, "…and 31 minutes old is refused by real mtime");
    assert.match(stale.stdout, /belong to another dispatch's ritual/);
  } finally { cleanup(); }
});
