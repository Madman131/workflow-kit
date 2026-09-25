// workflow-kit — the pre-send verification rung's control suite.
//
// The rule this guards is `.agents/skills/orchestrate/PROTOCOLS.md` § Coordination: a load-bearing
// dispatch is verified BEFORE it is sent. These tests exist in two layers on purpose. The pure layer
// drives `sidecarState` directly so every branch is reachable without a tree — including the ones a
// tree makes awkward (a payload with no session id, a sidecar 31 minutes old). The adopter layer
// then EXECUTES the installed hook from where `init` puts it, because presence and registration are
// the two lies this kit has already shipped, one release apart.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOW_STATES, briefTargets, denyReason, isBriefPath, isSendTool, loadBriefConfig, sidecarState,
  adjudicateFirst, ledgerRows, repairDeclarationState, writeLedger,
} from "../hooks/guard-brief-rung.mjs";
import { toRepoRelative } from "../hooks/payload-targets.mjs";
import {
  confirmRepairBrief, deriveRepairState, fingerprintCandidate, loadRepairEventsForProject,
  recordAggregateDisposition, recordAggregatePanelClose, recordAggregatePanelOpen,
  recordWorkerVerification, repairLedgerPath,
} from "../hooks/repair-dispatch-state.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEND = { kind: "send", target: "local_dest" };
const BRIEF = { kind: "brief", target: "briefs/cs1.md" };
const OK_CHECK = [{ command: "wc -w PROTOCOLS.md", output: "1987" }];
const FAKE_MANIFEST = [{ path: "src/x.mjs", oid: "1".repeat(40) }];
const FAKE_CANDIDATE = createHash("sha256").update(`src/x.mjs\0${"1".repeat(40)}\n`).digest("hex");
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v !== null && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
    : JSON.stringify(v);
const fresh = (over = {}) => ({ sessionId: "s1", target: "briefs/cs1.md", nonce: "n1", checks: OK_CHECK,
  dispatch_kind: "build", task_id: "task1", ...over });
const validRepair = (over = {}) => ({
  task_id: "task1",
  changeset_id: "cs1",
  candidate_sha: FAKE_CANDIDATE,
  round: 2,
  finding_ids: ["F1"],
  finding_class: "writer-liveness",
  ownership_area: "writer-authority",
  original_trigger: "process death leaves a durable writer lease blocking successors",
  authorized_paths: ["pil/operator/writer_authority.mjs"],
  introduced_by_prior_repair: false,
  new_scope: false,
  ...over,
});
const verdictEvent = (over = {}) => {
  const event = { type: "round_disposition", task_id: "task1", changeset_id: "cs1",
    recorded_at: "2026-08-15T00:00:00.000Z", session_id: "s1", round: 1,
    candidate_sha: FAKE_CANDIDATE, candidate_manifest: FAKE_MANIFEST, verdict: "NO-GO",
    finding_ids: ["F1"], finding_class: "writer-liveness", ownership_area: "writer-authority",
    original_trigger: "process death leaves a durable writer lease blocking successors",
    authorized_paths: ["pil/operator/writer_authority.mjs"], introduced_by_prior_repair: false,
    new_scope: false, disposition: "REMEDIATE", ...over };
  return { event_id: createHash("sha256").update(stable(event)).digest("hex"), event };
};
const repairEvents = [verdictEvent()];
const state = (sidecar, over = {}) =>
  sidecarState(sidecar, { ageMin: 1, sessionId: "s1", dispatch: BRIEF, events: [], taskId: "task1", ...over }).state;
const architectPrompt = "Proceed with the approved bounded chip.";
const architectScreen = (over = {}) => ({
  promptSha256: createHash("sha256").update(architectPrompt).digest("hex"),
  decisionId: "chip-1-direction",
  action: {
    approvedOutcome: "Deliver the approved chip without changing its endpoint.",
    blueprintAlignment: "The step implements the approved architecture path.",
    smallestAction: "Change only the named chip files.",
    kiss: "Reuse the existing guard and record.",
    zoomOut: "This is still the shortest path to the release outcome.",
    rootCause: "The current dispatch lacks a checked screening record.",
    cost: "One bounded edit and its existing review gate.",
    evaluation: {
      observedEvidence: "The approved chip and current gate receipt identify this bounded step.",
      noAction: "The approved result remains delayed while the PM waits.",
    },
    alternatives: [
      { route: "proceed", tradeoff: "Finish the bounded chip with its existing gate." },
      { route: "defer", tradeoff: "Avoid work now but delay the approved result." },
    ],
    choice: "proceed",
    choiceReason: "The bounded step preserves the approved outcome and passes its existing gate.",
  },
  findings: [],
  ...over,
});

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
  assert.equal(isSendTool("mcp__codex_app__send_message_to_thread"), true);
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
  // The tolerance is FIVE SECONDS and the assertions say so in the same unit the code uses. A first
  // cut allowed a full minute (`ageMin: -0.5` = 30s) under a comment reading "a few seconds" — the
  // wording and the number disagreeing, which is the boundary a reader relies on.
  assert.equal(state(fresh(), { ageMin: -4 / 60 }), "receipted", "4s of filesystem granularity is fine");
  assert.equal(state(fresh(), { ageMin: -30 / 60 }), "future-dated", "30s ahead is NOT 'a few seconds'");
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
  const s = fresh({ class: "status", dispatch_kind: "status", task_id: undefined, checks: undefined, target: "local_dest" });
  assert.equal(state(s, { dispatch: SEND }), "status-declared", "a status send needs no receipts…");
  assert.equal(state(fresh({ class: "status", dispatch_kind: "status", task_id: undefined, checks: undefined }), { dispatch: BRIEF }), "status-not-available",
    "…and a brief cannot declare its way out: it is load-bearing by definition");
  // An explicit load-bearing class still owes receipts — the field cannot be used to skip them.
  assert.equal(state(fresh({ class: "load-bearing", checks: [] })), "no-executed-check");
});

test("an Architect direction owes a prompt-bound action screen even when there are no findings", () => {
  const dispatch = { kind: "send", target: "pm-thread", architectPrompt };
  const base = fresh({ target: "pm-thread" });
  assert.equal(state(base, { dispatch }), "architect-screen-missing");
  assert.equal(state({ ...base, architectScreen: architectScreen({ promptSha256: "0".repeat(64) }) }, { dispatch }),
    "architect-prompt-mismatch");
  assert.equal(state({ ...base, architectScreen: architectScreen({ action: { ...architectScreen().action, kiss: "" } }) },
    { dispatch }), "architect-screen-incomplete");
  const action = architectScreen().action;
  for (const invalid of [
    { evaluation: undefined }, { evaluation: { observedEvidence: "x" } },
    { evaluation: { observedEvidence: "", noAction: "delay" } },
    { evaluation: { observedEvidence: "receipt", noAction: "" } },
    { alternatives: undefined }, { alternatives: [] },
    { alternatives: [action.alternatives[0]] },
    { alternatives: [action.alternatives[0], { ...action.alternatives[0] }] },
    { alternatives: [{ route: "proceed", tradeoff: "" }, action.alternatives[1]] },
    { choice: "approve" }, { choice: "stop" }, { choiceReason: "" },
  ]) {
    assert.equal(state({ ...base, architectScreen: architectScreen({ action: { ...action, ...invalid } }) },
      { dispatch }), "architect-screen-incomplete", JSON.stringify(invalid));
  }
  assert.equal(state({ ...base, architectScreen: architectScreen({ action: {
    ...action, smallestAction: "Reuse the existing guard for this chip.",
    choiceReason: "Both can deliver the chip; reuse has the smaller review surface.",
    alternatives: [
      { route: "proceed", tradeoff: "Reuse existing guard with a smaller review surface." },
      { route: "proceed", tradeoff: "Replace coordinator with a larger migration." },
    ],
  } }) }, { dispatch }), "receipted", "distinct substantive options may share a proceed disposition");
  for (const choice of ["proceed", "simplify", "defer", "stop", "escalate"]) {
    assert.equal(state({ ...base, architectScreen: architectScreen({ action: {
      ...action, choice, reservedBoundary: choice === "escalate" ? "New scope requires Owner approval." : undefined,
      alternatives: [
        { route: choice, tradeoff: "Named consequence of this route." },
        { route: choice === "proceed" ? "defer" : "proceed", tradeoff: "Compared consequence of the other route." },
      ],
    } }) }, { dispatch }), "receipted", choice);
  }
  assert.equal(state({ ...base, architectScreen: architectScreen({ action: {
    ...action, choice: "escalate", alternatives: [
      { route: "escalate", tradeoff: "Wait for Owner's reserved decision." }, action.alternatives[0],
    ],
  } }) }, { dispatch }), "architect-screen-incomplete", "escalation owes its actual reserved boundary");
  assert.equal(state({ ...base, architectScreen: architectScreen() }, { dispatch }), "receipted");
  assert.equal(state({ ...base, architectScreen: architectScreen({ action: {
    ...architectScreen().action, approvedOutcome: "x".repeat(4000),
  } }) }, { dispatch }), "architect-screen-too-large", "the existing audit append remains small");
  assert.equal(state({ ...base, class: "status", dispatch_kind: "status", architectScreen: undefined },
    { dispatch }), "architect-status-marker-missing", "direction text cannot use class:status alone");
  assert.equal(state({ ...base, class: "status", dispatch_kind: "status", architectScreen: undefined },
    { dispatch: { ...dispatch, architectPrompt: "ARCHITECT_STATUS_V1\nProgress only." } }), "status-declared");
  assert.equal(state({ ...base, class: "status", dispatch_kind: "status", architectScreen: architectScreen() },
    { dispatch }), "architect-status-conflict", "a direction receipt cannot be relabelled as status");
});

test("Architect findings obey first-exit order and name the failed trigger before being screened out", () => {
  const dispatch = { kind: "send", target: "pm-thread", architectPrompt };
  const base = fresh({ target: "pm-thread" });
  const pass = (evidence) => ({ result: "pass", evidence });
  const fail = (evidence, failedTrigger) => ({ result: "fail", evidence, failedTrigger });
  const finding = {
    id: "F1", harm: pass("Owner loses the approved outcome because the send changes scope."),
    real: pass("The changed scope reaches the supported paired PM task."),
    scope: pass("The finding concerns the requested feature."),
    worthIt: pass("The bounded correction is cheaper than another wrong build."),
    disposition: "REMEDIATE",
  };
  assert.equal(state({ ...base, architectScreen: architectScreen({ findings: [finding] }) }, { dispatch }), "receipted");
  for (const [field, disposition] of [["harm", "NOTE"], ["real", "DEFER"], ["scope", "DECLINE"], ["worthIt", "DEFER"]]) {
    const fields = ["harm", "real", "scope", "worthIt"];
    const screened = { id: "F1", disposition };
    for (const key of fields.slice(0, fields.indexOf(field))) screened[key] = finding[key];
    screened[field] = fail("The original case misses the named supported target.", "Replayed original trigger against the target and observed no impact.");
    assert.equal(state({ ...base, architectScreen: architectScreen({ findings: [screened] }) }, { dispatch }), "receipted", field);
    assert.equal(state({ ...base, architectScreen: architectScreen({ findings: [{ ...screened, [field]: { ...screened[field], failedTrigger: "" } }] }) },
      { dispatch }), "architect-screen-incomplete", `${field} cannot screen out on a bare assertion`);
    if (field !== "worthIt") assert.equal(state({ ...base, architectScreen: architectScreen({ findings: [{ ...screened, [fields[fields.indexOf(field) + 1]]: pass("filler") }] }) },
      { dispatch }), "architect-screen-incomplete", "downstream answers after first exit are filler");
  }
});

test("retired standard repair declarations refuse while active legacy state still blocks ordinary repair work", () => {
  assert.equal(repairDeclarationState({}).state, "dispatch-kind-missing");
  assert.equal(state(fresh({ dispatch_kind: "repair", repair: validRepair() }), { events: repairEvents }),
    "standard-mint-retired");
  assert.equal(state(fresh({ dispatch_kind: "repair", repair: validRepair(), target: "local_dest" }),
    { events: repairEvents, dispatch: SEND }), "standard-mint-retired",
    "retired standard authority cannot be revived through a transport message");

  const malformed = [
    { changeset_id: "" },
    { candidate_sha: "not-a-digest" },
    { round: 0 },
    { finding_ids: ["F1", "F1"] },
    { authorized_paths: ["../outside.mjs"] },
    { introduced_by_prior_repair: "no" },
    { new_scope: "no" },
  ];
  assert.equal(repairDeclarationState({ dispatch_kind: "repair", task_id: "task1" },
    { events: repairEvents, taskId: "task1", dispatch: BRIEF }).state, "repair-declaration-malformed");
  for (const over of malformed) {
    assert.equal(
      repairDeclarationState({ dispatch_kind: "repair", task_id: "task1", repair: { ...validRepair(), ...over } },
        { events: repairEvents, taskId: "task1", dispatch: BRIEF }).state,
      "repair-declaration-malformed",
    );
  }
  assert.equal(repairDeclarationState({ dispatch_kind: "status", class: "status", repair: validRepair() },
    { events: repairEvents, taskId: "task1", dispatch: SEND }).state, "dispatch-kind-conflict");
  assert.equal(repairDeclarationState({ dispatch_kind: "build", task_id: "task1", repair: validRepair() },
    { events: repairEvents, taskId: "task1", dispatch: BRIEF }).state, "dispatch-kind-conflict");
  assert.equal(repairDeclarationState({ dispatch_kind: "build", task_id: "task1" },
    { events: repairEvents, taskId: "task1", dispatch: BRIEF }).state, "repair-dispatch-required");
});

test("a retired standard declaration cannot be laundered into the brief-rung audit ledger", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "brief-rung-repair-"));
  try {
    mkdirSync(path.join(dir, ".claude"));
    const declared = repairDeclarationState({ dispatch_kind: "repair", task_id: "task1", repair: validRepair() },
      { events: repairEvents, taskId: "task1", dispatch: BRIEF });
    assert.equal(declared.state, "standard-mint-retired");
    assert.equal(writeLedger(dir, {
      decision: "allow", state: "receipted", kind: "brief", target: "briefs/cs1.md",
      sessionId: "s1", checks: 1, cls: "load-bearing", nonce: "n1", attempt: "a1",
      ...(declared.ok ? { repair: declared.repair } : {}),
    }), true);
    const row = JSON.parse(readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8"));
    assert.equal(row.repair, undefined, "refused authority is never persisted as an admitted repair");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CONSUME ON USE — one ritual, one dispatch, and the repeat is the dangerous case", () => {
  // Target-binding kills the COPIED and the RE-TOUCHED sidecar. It does NOT kill a SECOND dispatch
  // to the SAME target inside the freshness window — and that repeat is the sharp one: a brief
  // re-edited at that path carries text the original ritual never saw.
  assert.equal(state(fresh({ nonce: undefined })), "nonce-missing");
  assert.equal(state(fresh({ nonce: "   " })), "nonce-missing", "whitespace is not a nonce");
  assert.equal(state(fresh()), "receipted", "a nonce-bearing sidecar passes the SIDECAR check…");
  // …and whether it may SPEND that nonce is adjudicated from the trail, not decided here.
  assert.equal(
    sidecarState(fresh({ class: "status", dispatch_kind: "status", task_id: undefined,
      checks: undefined, nonce: undefined, target: "local_dest" }),
      { ageMin: 1, sessionId: "s1", dispatch: SEND, events: [], taskId: "task1" }).state,
    "status-declared", "a status send needs no nonce because it spends nothing");
});

test("ADJUDICATION IS FIRST-ROW-WINS, and per-attempt identity is what makes it decidable", () => {
  // Consumption is a property of the TRAIL's append order. Two rounds of review died on a lock built
  // beside the ledger; this deletes that mechanism rather than hardening it.
  const row = (nonce, attempt) => ({ control: "brief-rung", decision: "attempt", nonce, attempt });
  const rows = [row("n1", "A"), row("n1", "B"), row("n2", "C")];
  assert.equal(adjudicateFirst(rows, "n1", "A").won, true, "the FIRST attempt row wins");
  assert.equal(adjudicateFirst(rows, "n1", "B").won, false, "a later attempt on the same nonce loses");
  assert.equal(adjudicateFirst(rows, "n1", "B").winner, "A", "…and the deny can name who won");
  assert.equal(adjudicateFirst(rows, "n2", "C").won, true, "a different nonce is unaffected");
  // Our own row missing means the append did not land — fail closed, never "nobody claimed it".
  assert.equal(adjudicateFirst([], "n1", "A").won, false);
  assert.equal(adjudicateFirst([], "n1", "A").reason, "no-attempt-row");
  // Only THIS control's attempt rows count; an allow/deny row is a resolution, not a claim.
  const noise = [{ control: "lane-authoring", decision: "attempt", nonce: "n1", attempt: "X" },
                 { control: "brief-rung", decision: "allow", nonce: "n1", attempt: "X" },
                 row("n1", "A")];
  assert.equal(adjudicateFirst(noise, "n1", "A").won, true, "resolutions and other controls do not claim");
});

test("ledgerRows fails CLOSED on a trail it cannot trust", () => {
  assert.deepEqual(ledgerRows(undefined), [], "no ledger yet ⇒ no rows");
  assert.equal(ledgerRows('{"a":1}\n').length, 1);
  assert.equal(ledgerRows("{not json}\n"), null);
  assert.equal(ledgerRows('{"a":1}'), null, "a missing trailing newline is a truncated trail");
  assert.equal(ledgerRows("[1,2]\n"), null, "a non-object row is a corrupt trail");
  assert.equal(ledgerRows(123), null, "a non-string ledger is unreadable, not empty");
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
    "repair-disposition-not-authorized": /mint no worker authority/,
    "repair-brief-required": /Persist the actionable repair as a receipted brief/,
    "repair-brief-receipt-missing": /exact prior repair-brief receipt/,
    "future-dated": /ahead of the clock is not fresh/,
    "adjudication-unreadable": /An unadjudicated consume is not a consume/,
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
  const corrupt = denyReason("kit-config-malformed", { dispatch: BRIEF });
  assert.match(corrupt, /repair.*in place.*restore.*pairedPmThreadId.*preserve other valid fields/i,
    "a corrupt configured pair must be repaired without removing its scope");
  assert.match(corrupt, /if this checkout is paired/i,
    "ordinary unpaired adopters must not be told they necessarily have a PM pair");
  assert.doesNotMatch(corrupt, /delete it|re-run `node bin\/init\.mjs`/i,
    "the diagnostic cannot recommend an opt-out as a recovery path");
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
  writeFileSync(path.join(dir, ".claude", "task-lane.json"), JSON.stringify({
    mode: "in-thread", sessionId: "s1", taskId: "task1", tier: "T1",
  }));
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

function seedStoredLegacy(dir, {
  taskId = "task1", changesetId = "cs1", workerSession = null,
  authorizedPaths = ["src/x.mjs"],
} = {}) {
  const candidate = fingerprintCandidate(dir, authorizedPaths);
  const round = {
    type: "round_disposition", task_id: taskId, changeset_id: changesetId,
    recorded_at: "2026-08-15T00:00:00.000Z", session_id: "stored-orchestrator", round: 1,
    candidate_sha: candidate.digest, candidate_manifest: candidate.records, verdict: "NO-GO",
    finding_ids: ["F1"], finding_class: "writer-liveness", ownership_area: "writer-authority",
    original_trigger: "dead writer blocks successors", authorized_paths: authorizedPaths,
    introduced_by_prior_repair: false, new_scope: false, disposition: "REMEDIATE",
    repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
    owner_extension_event_id: null, owner_scope_event_id: null,
  };
  const rows = [round];
  let dispatch = null;
  if (workerSession) {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    const brief = "stored repair brief\n";
    writeFileSync(path.join(dir, "briefs", "fix.md"), brief);
    dispatch = {
      type: "repair_dispatch", task_id: taskId, changeset_id: changesetId,
      recorded_at: "2026-08-15T00:00:01.000Z", session_id: "stored-orchestrator",
      source_round: 1, next_round: 2, candidate_sha: round.candidate_sha,
      finding_ids: [...round.finding_ids], authorized_paths: [...authorizedPaths],
      target_kind: "brief", target: "briefs/fix.md",
      brief_sha256: createHash("sha256").update(brief).digest("hex"), brief_size: Buffer.byteLength(brief),
    };
    const dispatchId = createHash("sha256").update(stable(dispatch)).digest("hex");
    rows.push(dispatch, {
      type: "worker_verification", task_id: taskId, changeset_id: changesetId,
      recorded_at: "2026-08-15T00:00:02.000Z", session_id: workerSession,
      worker_session_id: workerSession, repair_dispatch_event_id: dispatchId,
      candidate_sha: round.candidate_sha, authorized_paths: [...authorizedPaths],
      brief_path: dispatch.target, brief_sha256: dispatch.brief_sha256,
    });
  }
  const file = repairLedgerPath(dir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, rows.map((event) => JSON.stringify({
    event_id: createHash("sha256").update(stable(event)).digest("hex"), event,
  })).join("\n") + "\n", { flag: "a" });
  return { round, dispatch };
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
      dispatch_kind: "build", task_id: "task1",
      checks: [{ command: "wc -w skills/orchestrate/PROTOCOLS.md", output: "1987" }],
    }));
    const allowed = run(briefWrite);
    assert.equal(allowed.status, 0);
    assert.doesNotMatch(allowed.stdout, /"permissionDecision":"deny"/, "a satisfied rung PERMITS the write");

    // …and the allow left an audit row the Owner can spot-check.
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((r) => JSON.parse(r)).filter((r) => r.control === "brief-rung");
    // TWO rows per load-bearing dispatch: the ATTEMPT that claims the nonce, and the RESOLUTION that
    // records how adjudication went. Both are the trail's, not a side file's.
    assert.deepEqual(rows.map((r) => r.decision), ["attempt", "allow"]);
    const allow = rows.find((r) => r.decision === "allow");
    assert.equal(allow.state, "receipted");
    assert.equal(allow.target, "briefs/cs1.md");
    assert.equal(rows[0].attempt, allow.attempt, "the resolution names the attempt it resolves");
    // CLEAR TEXT, both fields: the ledger's named consumer is the Owner's spot-check, and a
    // spot-check cannot read a digest. The declared CLASS is what makes the status escape honest —
    // it is not stopped mechanically, so it must at least be COUNTABLE by a human.
    assert.equal(allow.class, "load-bearing");
    assert.equal(allow.nonce, "rung-1", "the spent nonce IS the consumption record");

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

test("the installed Codex thread-send guard scopes one declared PM and checks current direction screening", () => {
  const { dir, cleanup } = adopt();
  try {
    const registration = JSON.parse(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"));
    const sendGroup = registration.hooks.PreToolUse.find((group) =>
      group.matcher === "mcp__codex_app__send_message_to_thread");
    assert.equal(sendGroup.hooks.length, 1, "the generated registration names one exact send guard");
    const command = sendGroup.hooks[0].command;
    const laneFile = path.join(dir, ".claude", "task-lane.json");
    const configFile = path.join(dir, ".claude", "kit.config.json");
    const sidecarFile = path.join(dir, ".claude", "brief-rung.json");
    const payload = (threadId = "pm-thread", prompt = architectPrompt, extra = {}) => ({
      session_id: "s1", tool_name: "mcp__codex_app__send_message_to_thread", cwd: dir,
      tool_input: { threadId, prompt, ...extra },
    });
    const run = (input) => spawnSync("sh", ["-c", command], {
      input: JSON.stringify(input), encoding: "utf8",
    });
    const lane = JSON.parse(readFileSync(laneFile, "utf8"));
    const config = { ...JSON.parse(readFileSync(configFile, "utf8")), briefPathDirs: ["dispatches"] };
    writeFileSync(configFile, JSON.stringify(config));
    const setPair = (value) => writeFileSync(configFile, JSON.stringify({ ...config, pairedPmThreadId: value }));
    const setSidecar = (over = {}) => writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "pm-thread", nonce: "architect-1", dispatch_kind: "build", task_id: "task1",
      checks: OK_CHECK, architectScreen: architectScreen(), ...over,
    }));

    assert.equal(run(payload()).stdout, "", "without a configured pair the Codex send remains out of scope");
    const plainInit = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"),
      "--target", dir, "--repo-name", "adopter", "--skip-codex-prompt", "--skip-codex-lane",
      "--paired-pm-thread-id", "pm-thread"], { encoding: "utf8" });
    assert.equal(plainInit.status, 0, plainInit.stderr);
    assert.deepEqual(JSON.parse(readFileSync(configFile, "utf8")), config,
      "plain init keeps an existing config even when the new flag is present");
    const routing = readFileSync(path.join(KIT, "skills", "architect-build", "ROUTING.md"), "utf8");
    assert.match(routing, /existing.*config.*in place.*preserv.*other fields/is,
      "the documented existing-adopter route must not rely on plain init to add the pair");
    setPair(123);
    const malformed = run(payload()).stdout;
    assert.match(malformed, /"permissionDecision":"deny"/, "a malformed selector cannot silently narrow coverage");
    assert.doesNotMatch(malformed, /delete it|re-run `node bin\/init\.mjs`/i,
      "the exact installed hook cannot recommend silently opting out of the configured pair");
    setPair(" pm-thread ");
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "whitespace cannot turn a configured pair into an unmatched quiet route");
    setPair("pm-thread");
    assert.deepEqual(JSON.parse(readFileSync(configFile, "utf8")), { ...config, pairedPmThreadId: "pm-thread" },
      "repairing in place retains the unrelated field and the intended pair");
    writeFileSync(laneFile, JSON.stringify(lane));
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/,
      "a normal task-lane refresh retains the durable pair and still demands a sidecar");
    const holdPrompt = "Hold chip pending Owner scope approval.";
    const portable = readFileSync(path.join(KIT, "PORTABILITY.md"), "utf8");
    const exampleMatch = /Minimal `architectScreen`[\s\S]*?```json\n([\s\S]*?)\n```/.exec(portable);
    assert.ok(exampleMatch, "producer reference includes literal screen JSON");
    const holdScreen = JSON.parse(exampleMatch[1]);
    setSidecar({ nonce: "hold-1", architectScreen: { ...holdScreen, action: {
      ...holdScreen.action, evaluation: { ...holdScreen.action.evaluation, observedEvidence: "" },
    } } });
    const incompleteScreen = run(payload("pm-thread", holdPrompt)).stdout;
    assert.match(incompleteScreen, /"permissionDecision":"deny"/, "malformed published shape denies");
    assert.match(incompleteScreen, /PORTABILITY\.md.*minimal/, "deny points to exact JSON shape");
    setSidecar({ nonce: "hold-1", class: "status", dispatch_kind: "status", architectScreen: holdScreen });
    const statusConflict = run(payload("pm-thread", holdPrompt)).stdout;
    assert.match(statusConflict, /"permissionDecision":"deny"/, "screened escalation cannot use status class");
    assert.match(statusConflict, /Keep the decision screen.*screened non-status direction/,
      "denial preserves the high-value escalation screen");
    setSidecar({ nonce: "hold-1", architectScreen: holdScreen });
    assert.equal(run(payload("pm-thread", holdPrompt)).stdout, "", "published screened hold passes as direction");
    const holdRows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map(JSON.parse).filter((row) => row.control === "brief-rung");
    assert.deepEqual(holdRows.at(-1).architectScreen, holdScreen, "hold direction retains its decision screen in audit");
    assert.equal(run(payload("another-thread")).stdout, "", "an unrelated Codex send stays outside the paired guard");
    assert.match(run(payload("pm-thread", architectPrompt, { model: "gpt-6-astra" })).stdout, /quietly change the PM's model/,
      "a paired send cannot quietly change its model");
    assert.match(run(payload("pm-thread", architectPrompt, { thinking: "max" })).stdout, /quietly change the PM's model/,
      "a paired send cannot quietly change its reasoning effort");
    assert.equal(run(payload("another-thread", architectPrompt, { model: "gpt-6-astra" })).stdout, "",
      "an unrelated send keeps its existing behavior");
    const missing = run(payload()).stdout;
    assert.match(missing, /"permissionDecision":"deny"/, "the covered PM send needs a sidecar");
    for (const question of ["HARM?", "REAL?", "SCOPE?", "WORTH IT?", "root replacement"]) {
      assert.ok(missing.includes(question), `the paired deny surfaces the existing PM CONTRACT's ${question}`);
    }
    setSidecar({ architectScreen: architectScreen({ findings: [
      { id: "F1", harm: { result: "fail", evidence: "No target was reached." }, disposition: "NOTE" },
    ] }) });
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "an incomplete first-exit finding cannot pass");
    setSidecar({ architectScreen: architectScreen({ promptSha256: "0".repeat(64) }) });
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "the screen must bind exact prompt bytes");
    setSidecar();
    assert.match(run(payload("pm-thread", architectPrompt + " Changed.")).stdout, /"permissionDecision":"deny"/,
      "a changed message cannot ride the old decision digest");
    setSidecar();
    utimesSync(sidecarFile, new Date(Date.now() - 31 * 60_000), new Date(Date.now() - 31 * 60_000));
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "an old decision screen cannot pass");
    setSidecar({ target: "wrong-thread" });
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "the existing target binding still applies");
    setSidecar({ class: "status", dispatch_kind: "status" });
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "a direction receipt may not take the status route");
    setSidecar();
    assert.equal(run(payload()).stdout, "", "the current screen permits exactly the paired direction");
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "the existing nonce is single use");
    setSidecar({ class: "status", dispatch_kind: "status", architectScreen: undefined, checks: undefined, nonce: undefined });
    assert.match(run(payload()).stdout, /"permissionDecision":"deny"/, "direction text cannot take the status route");
    assert.equal(run(payload("pm-thread", "ARCHITECT_STATUS_V1\nProgress only.")).stdout, "",
      "marked declared status remains available and auditable");
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map(JSON.parse).filter((row) => row.control === "brief-rung");
    assert.equal(rows.at(-1).class, "status");
    assert.equal(rows.at(-1).target, "pm-thread");
  } finally { cleanup(); }
});

test("AN INSTALLED GUARD carries aggregate sidecar through confirm, verify, and source write", () => {
  const { dir, cleanup } = adopt();
  try {
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "base", "-m", "entry: none"], { cwd: dir });
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", base], { cwd: dir });
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "x.mjs"), "export const x = 1;\n");
    execFileSync("git", ["add", "src/x.mjs"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "candidate", "-m", "entry: none"], { cwd: dir });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir, encoding: "utf8" }).trim();
    const paths = ["src/x.mjs"];
    const expected = [
      { seat_id: "free", role: "free", family: "codex", pass_type: "free", paths },
      { seat_id: "a", role: "angle:a", family: "codex", pass_type: "free", paths },
      { seat_id: "b", role: "angle:b", family: "codex", pass_type: "free", paths },
      { seat_id: "external", role: "external", family: "claude", pass_type: "folded", paths },
    ];
    const options = { projectRoot: dir, sessionId: "orchestrator" };
    const opened = recordAggregatePanelOpen({
      type: "aggregate_v2", kind: "panel_open", task_id: "task1", changeset_id: "cs1",
      round: 1, phase: "repair_round", tier: "T2", frozen_commit: commit, frozen_tree: tree,
      base_ref: "origin/main", base_commit: base, expected_seats: expected,
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    }, options);
    assert.equal(opened.ok, true, opened.state);
    const received = expected.map((seat, index) => ({
      seat_id: seat.seat_id, role: seat.role, family: seat.family, pass_type: seat.pass_type,
      inspected_paths: paths, reviewed_commit: commit, reviewed_tree: tree,
      verdict: index === 1 ? "NO-GO" : "GO", raw_finding_ids: index === 1 ? ["F1"] : [],
      artifact_receipt: `receipt-${seat.seat_id}`, artifact_sha256: String(index + 1).repeat(64),
      pre_loaded: false, packet_scope: "candidate-only",
    }));
    const closed = recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task1", changeset_id: "cs1",
      panel_open_event_id: opened.event_id, received_seats: received,
    }, options);
    assert.equal(closed.ok, true, closed.state);
    const decided = recordAggregateDisposition({
      type: "aggregate_v2", kind: "disposition", task_id: "task1", changeset_id: "cs1",
      panel_close_event_id: closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] },
      terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: paths,
      same_mechanism_repeated: false,
    }, options);
    assert.equal(decided.ok, true, decided.state);

    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, "briefs", "fix.md"), "aggregate repair\n");
    writeFileSync(path.join(dir, ".claude", "task-lane.json"), JSON.stringify({
      mode: "in-thread", sessionId: "s1", taskId: "task1", tier: "T2",
    }));
    writeFileSync(path.join(dir, ".claude", "kit.pair.json"), JSON.stringify({ pairedPmThreadId: "pm-thread" }));
    const sidecarFile = path.join(dir, ".claude", "brief-rung.json");
    writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "pm-thread", nonce: "consult-rung", checks: OK_CHECK,
      dispatch_kind: "build", task_id: "task1", architectScreen: architectScreen(),
    }));
    const codexSend = spawnSync(process.execPath,
      [path.join(dir, ".codex", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir], {
        input: JSON.stringify({ session_id: "s1", tool_name: "mcp__codex_app__send_message_to_thread", cwd: dir,
          tool_input: { threadId: "pm-thread", prompt: architectPrompt } }), encoding: "utf8",
      });
    assert.match(codexSend.stdout, /declares a new build while this task's durable controller/,
      "an old build receipt cannot silently become an aggregate-repair consult");
    writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "pm-thread", nonce: "consult-rung", checks: OK_CHECK,
      dispatch_kind: "architect-direction", task_id: "task1", architectScreen: architectScreen(),
    }));
    const admittedConsult = spawnSync(process.execPath,
      [path.join(dir, ".codex", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir], {
        input: JSON.stringify({ session_id: "s1", tool_name: "mcp__codex_app__send_message_to_thread", cwd: dir,
          tool_input: { threadId: "pm-thread", prompt: architectPrompt } }), encoding: "utf8",
      });
    assert.equal(admittedConsult.stdout, "", "an explicit screened Architect consult remains possible during active aggregate repair");
    assert.ok(readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map(JSON.parse).some((row) =>
        row.control === "brief-rung" && row.decision === "allow" && row.nonce === "consult-rung"),
    "the active-round consult must actually pass the guard and leave its receipt");
    writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "briefs/fix.md", nonce: "build-not-repair", checks: OK_CHECK,
      dispatch_kind: "build", task_id: "task1",
    }));
    const hook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const run = (target) => spawnSync(process.execPath, [hook, "--project-dir", dir], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
        tool_input: { file_path: path.join(dir, target) } }), encoding: "utf8",
    });
    writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "briefs/fix.md", nonce: "consult-not-brief", checks: OK_CHECK,
      dispatch_kind: "architect-direction", task_id: "task1", architectScreen: architectScreen(),
    }));
    assert.match(run("briefs/fix.md").stdout, /Architect direction cannot carry repair authority/,
      "a direction declaration cannot authorize an aggregate repair brief");
    assert.match(run("src/x.mjs").stdout, /no typed worker-verification event/,
      "a direction declaration cannot authorize a source write");
    writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "briefs/fix.md", nonce: "build-not-repair", checks: OK_CHECK,
      dispatch_kind: "build", task_id: "task1",
    }));
    assert.match(run("briefs/fix.md").stdout, /repair-dispatch-required|repair and must bind/,
      "the Architect consult does not admit a build brief during repair");
    assert.match(run("src/x.mjs").stdout, /no typed worker-verification event/,
      "the Architect consult does not admit a source write");
    const repair = {
      aggregate_controller: "aggregate_v2", task_id: "task1", changeset_id: "cs1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
      next_round: 2, root_exit_event_id: null,
    };
    writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "briefs/fix.md", nonce: "aggregate-rung", checks: OK_CHECK,
      dispatch_kind: "repair", task_id: "task1", repair,
    }));
    assert.equal(run("briefs/fix.md").stdout, "", "aggregate declaration passes the installed guard");
    const dispatch = confirmRepairBrief({ declaration: repair, brief_path: "briefs/fix.md" }, options);
    assert.equal(dispatch.ok, true, dispatch.state);
    const worker = recordWorkerVerification({
      task_id: "task1", repair_dispatch_event_id: dispatch.event_id,
    }, { projectRoot: dir, sessionId: "s1" });
    assert.equal(worker.ok, true, worker.state);
    assert.equal(run("src/x.mjs").stdout, "", "verified aggregate worker may write its exact path");
  } finally { cleanup(); }
});

test("AN INSTALLED GUARD honors stored worker authority and still refuses repair authority in a send", () => {
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "x.mjs"), "export const x = 1;\n");
    const seeded = seedStoredLegacy(dir, { workerSession: "s1" });
    const loaded = loadRepairEventsForProject(dir);
    const latest = deriveRepairState(loaded.events, "task1").latest;
    const repair = {
      task_id: "task1", changeset_id: "cs1", candidate_sha: latest.candidate_sha, round: 2,
      finding_ids: latest.finding_ids, finding_class: latest.finding_class,
      ownership_area: latest.ownership_area, original_trigger: latest.original_trigger,
      authorized_paths: latest.authorized_paths, introduced_by_prior_repair: false, new_scope: false,
    };
    const hook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const run = (payload) => spawnSync(process.execPath, [hook, "--project-dir", dir], {
      input: JSON.stringify(payload), encoding: "utf8",
    });
    writeFileSync(path.join(dir, ".claude", "brief-rung.json"), JSON.stringify({
      sessionId: "s1", target: "worker-1", nonce: "send-1", checks: OK_CHECK,
      dispatch_kind: "repair", task_id: "task1", repair,
    }));
    const denied = run({ session_id: "s1", tool_name: "send_message", tool_input: { session_id: "worker-1" } });
    assert.match(denied.stdout, /new standard repair rounds are retired/);
    const taskLaneBootstrap = run({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: path.join(dir, ".claude", "task-lane.json") } });
    assert.equal(taskLaneBootstrap.stdout, "", "task-lane bootstrap must not require its own worker receipt");
    const allowedSource = run({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: path.join(dir, "src", "x.mjs") } });
    assert.equal(allowedSource.stdout, "", "the verified worker session may write the exact authorized path");
    const wrongSession = run({ session_id: "s2", tool_name: "Write", cwd: dir,
      tool_input: { file_path: path.join(dir, "src", "x.mjs") } });
    assert.match(wrongSession.stdout, /no typed worker-verification event/);
    const wrongPath = run({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: path.join(dir, "src", "outside.mjs") } });
    assert.match(wrongPath.stdout, /outside the exact authorized-path set/);
    assert.equal(deriveRepairState(loadRepairEventsForProject(dir).events, "task1").worker_verifications.length, 1);
    writeFileSync(path.join(dir, seeded.dispatch.target), "changed after worker verification\n");
    const changedBrief = run({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: path.join(dir, "src", "x.mjs") } });
    assert.match(changedBrief.stdout, /no longer matches the bytes/);
  } finally { cleanup(); }
});

test("GLOBAL ACTIVE PATH OWNERSHIP survives lane relabel without freezing unrelated work", () => {
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "x.mjs"), "export const x = 1;\n");
    const hook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const run = (target, session = "s2") => spawnSync(process.execPath, [hook, "--project-dir", dir], {
      input: JSON.stringify({ session_id: session, tool_name: "Write", cwd: dir,
        tool_input: { file_path: path.join(dir, target) } }), encoding: "utf8",
    });
    seedStoredLegacy(dir);

    writeFileSync(path.join(dir, ".claude", "task-lane.json"), JSON.stringify({
      mode: "in-thread", sessionId: "s2", taskId: "task2", tier: "T1",
    }));
    const relabelled = run("src/x.mjs");
    assert.match(relabelled.stdout, /owned by another ACTIVE repair program/,
      "a valid task-lane relabel cannot abandon the active path owner");
    assert.equal(run("src/unrelated.mjs").stdout, "",
      "a distinct task remains free to write an unrelated exact path");

    rmSync(path.join(dir, ".claude", "task-lane.json"));
    const undeclared = run("src/x.mjs");
    assert.match(undeclared.stdout, /owned by another ACTIVE repair program/,
      "an empty task declaration cannot erase global active-path ownership");
    writeFileSync(path.join(dir, ".claude", "task-lane.json"), JSON.stringify({
      mode: "in-thread", sessionId: "s2", taskId: "task2", tier: "T1",
    }));

    seedStoredLegacy(dir, { taskId: "task2", changesetId: "cs2" });
    const overlap = run("src/x.mjs");
    assert.match(overlap.stdout, /claimed by multiple active NO-GO repair programs/,
      "overlapping active owners fail closed instead of selecting one by lane label");
  } finally { cleanup(); }
});

test("one sidecar authorizes ONE dispatch — a two-brief envelope cannot ride a single ritual", () => {
  // A patch envelope is applied as a unit, so deciding on the first match would let the second brief
  // ride the first one's sidecar. Every target is judged before anything is allowed.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "brief-rung.json"), JSON.stringify({
      sessionId: "s1", target: "briefs/a.md", nonce: "rung-1", dispatch_kind: "build", task_id: "task1",
      checks: [{ command: "c", output: "o" }],
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
      dispatch_kind: "build", task_id: "task1",
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
    // The whole story is legible in the trail: rung-1 claimed and allowed, rung-1 claimed again and
    // REFUSED, rung-2 claimed and allowed. The refusal is a row, not a silence.
    assert.deepEqual(rows.map((r) => `${r.nonce}:${r.decision}`),
      ["rung-1:attempt", "rung-1:allow", "rung-1:attempt", "rung-1:deny", "rung-2:attempt", "rung-2:allow"]);
  } finally { cleanup(); }
});

test("A CORRUPT kit.config FAILS CLOSED FOR THE ADOPTERS IT EXISTS TO PROTECT", () => {
  // Evaluating a corrupt-config payload
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

test("CONSUMPTION IS SERIALISED — six overlapping dispatches on one nonce yield exactly one allow", async () => {
  // Measured on this changeset BEFORE the lock existed: five of six allowed, five rows carrying the
  // same nonce. Atomicity of the ledger APPEND is not atomicity of the DECISION.
  //
  // THIS TEST WAS DECORATIVE ON ITS FIRST CUT. It used `spawnSync`
  // inside `Array.from` — `spawnSync` BLOCKS, so the six ran strictly one after another and the
  // first spent the nonce before the second started. It reported "1 of 6" with the lock removed
  // just as happily as with it: a concurrency test containing no concurrency, asserting the
  // property it could not observe. `spawn` + `Promise.all` is what makes them overlap.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "brief-rung.json"), JSON.stringify({
      sessionId: "s1", target: "briefs/cs1.md", nonce: "race", dispatch_kind: "build", task_id: "task1",
      checks: [{ command: "c", output: "o" }],
    }));
    const payload = JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: "briefs/cs1.md" } });
    // A RELEASE BARRIER, not merely async spawning. The hook does nothing until its stdin closes, so
    // every child is started FIRST and only then are all six payloads released together. Without the
    // barrier the children can simply run to completion one after another on a busy scheduler, and
    // the test would pass for the wrong reason — the sharper form of the decorative-test defect
    // above. What this proves is OVERLAP, not a guaranteed interleaving: the
    // discriminating proof is the mutation that neuters adjudication, which reddens this test.
    const children = Array.from({ length: 6 }, () => spawn(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir]));
    const settled = children.map((p) => new Promise((resolve) => {
      let out = "";
      p.stdout.on("data", (d) => { out += d; });
      p.on("close", () => resolve(out));
    }));
    for (const p of children) p.stdin.end(payload);       // release them together
    const outs = await Promise.all(settled);
    const allowed = outs.filter((o) => !/"permissionDecision":"deny"/.test(o)).length;
    assert.equal(allowed, 1, `exactly one dispatch may spend one ritual, got ${allowed}`);
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((r) => JSON.parse(r)).filter((r) => r.nonce === "race");
    assert.equal(rows.filter((r) => r.decision === "allow").length, 1, "exactly one spend recorded");
    // N−1 LEGIBLE REFUSALS. The losers are not silent: each stands in the trail as its own row, which
    // is the observability the lock design never had.
    assert.equal(rows.filter((r) => r.decision === "deny").length, 5, "and five legible refusals");
    assert.equal(rows.filter((r) => r.decision === "attempt").length, 6, "one attempt row each");
  } finally { cleanup(); }
});

test("THE CRASH RESIDUAL: a burned nonce denies, and the cure is ONE RITUAL — never a brick", () => {
  // The residual changed SHAPE when the lock was deleted, and the disclosure changed with it. Under
  // the lock, a crashed holder left a file a human had to delete before ANY brief could move. Now a
  // process killed after its attempt row lands has burned only THAT nonce, and re-running the rung
  // clears it. Strictly cheaper, still real, and asserted rather than asserted-about.
  const { dir, cleanup } = adopt();
  try {
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    const payload = JSON.stringify({ session_id: "s1", tool_name: "Write", cwd: dir,
      tool_input: { file_path: "briefs/cs1.md" } });
    const run = () => spawnSync(process.execPath,
      [path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs"), "--project-dir", dir],
      { input: payload, encoding: "utf8" });
    const sidecar = (nonce) => writeFileSync(path.join(dir, ".claude", "brief-rung.json"),
      JSON.stringify({ sessionId: "s1", target: "briefs/cs1.md", nonce, dispatch_kind: "build", task_id: "task1",
        checks: [{ command: "c", output: "o" }] }));

    // A process that appended its attempt and then died: the row is there, the dispatch never was.
    writeFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"),
      JSON.stringify({ ts: "t", control: "brief-rung", decision: "attempt", state: "receipted",
        kind: "brief", target: "briefs/cs1.md", sessionId: "s1", class: "load-bearing",
        nonce: "burned", attempt: "9999-dead" }) + "\n");
    sidecar("burned");
    assert.match(run().stdout, /ALREADY been spent/, "the burned nonce is refused…");

    sidecar("fresh-one");
    assert.doesNotMatch(run().stdout, /"permissionDecision":"deny"/,
      "…and re-running the rung with a NEW nonce moves immediately — no file to delete by hand");
    // And nothing was left behind to clean up: the lock class is deleted, not minimised.
    assert.ok(!existsSync(path.join(dir, ".claude", "brief-rung.lock")), "no lock file exists at all");
  } finally { cleanup(); }
});

test("an unreadable payload DENIES — the reference's exit(0) is a fail-open", () => {
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
    const good = JSON.stringify({ sessionId: "s1", target: "briefs/cs1.md", nonce: "rung-1",
      dispatch_kind: "build", task_id: "task1", checks: [{ command: "c", output: "o" }] });
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

// ── KO17 round 1: what the cold panel said the tests did not cover ─────────────────────────────

test("THE INSTALLED GUARD, in a tree with no Git subject: it ANNOUNCES that it is blind and admits the write", () => {
  // The controller-level classification was tested; the panel pointed out that proves nothing about
  // what the registered hook DOES with it. This runs the installed hook. It would fail if the guard
  // still denied here, and equally if it had turned every controller failure into a notice.
  const { dir, cleanup } = adopt();
  try {
    rmSync(path.join(dir, ".git"), { recursive: true, force: true });   // no subject can exist here
    const hook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const run = (target) => spawnSync(process.execPath, [hook, "--project-dir", dir], {
      input: JSON.stringify({ session_id: "s2", tool_name: "Write", cwd: dir,
        tool_input: { file_path: path.join(dir, target) } }), encoding: "utf8",
      env: { ...process.env, GIT_DIR: "", GIT_COMMON_DIR: "", GIT_WORK_TREE: "" },
    });
    const out = run("src/x.mjs");
    assert.doesNotMatch(out.stdout, /"permissionDecision":"deny"/,
      "a tree that cannot hold a repair ledger cannot hold a repair program — denying every write there is a false positive");
    assert.match(out.stdout, /BLIND/,
      "and the relief is ANNOUNCED — a control that quietly stops checking is indistinguishable from one that passed");
  } finally { cleanup(); }
});

test("POLARITY: the installed guard still DENIES a source write when the ledger exists and cannot be read", () => {
  const { dir, cleanup } = adopt();
  try {
    const hook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const ledgerDir = path.join(dir, ".git", "workflow-kit");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(path.join(ledgerDir, "repair-events-v1.jsonl"), "{not json at all\n");
    const out = spawnSync(process.execPath, [hook, "--project-dir", dir], {
      input: JSON.stringify({ session_id: "s2", tool_name: "Write", cwd: dir,
        tool_input: { file_path: path.join(dir, "src/x.mjs") } }), encoding: "utf8",
    });
    assert.match(out.stdout, /"permissionDecision":"deny"/,
      "a ledger that EXISTS and cannot be read is a subject this control cannot see — that must deny");
    assert.match(out.stdout, /PRESERVE it and repair it/,
      "and the remedy must be preservation, never the deletion that discards every round's history");
    assert.match(out.stdout, /could not be RUN|git rev-parse/,
      "the message must also name the OTHER cause of this state — git unavailable — since repairing a healthy ledger would not fix that");
  } finally { cleanup(); }
});

test("a build brief is gated by the ACTIVE program, not by the bare verdict", () => {
  // Found by a cold seat: the source-write path learned the new predicate and this one did not, so a
  // DEFER or a closed program released its paths while ORDINARY brief writing stayed trapped — the
  // same lockout, one surface over. This is the guard's own sidecar contract, not the controller's.
  assert.equal(state(fresh({ dispatch_kind: "build" }), { events: [verdictEvent()] }),
    "repair-dispatch-required",
    "a LIVE repair still refuses an ordinary build brief — it must be dispatched as a repair");
  for (const disposition of ["DEFER", "DECLINE", "ESCALATE", "NOTE"]) {
    assert.equal(state(fresh({ dispatch_kind: "build" }), { events: [verdictEvent({ disposition })] }),
      "receipted",
      `a NO-GO dispositioned ${disposition} authorizes no repair, so ordinary work stays ordinary`);
  }
  assert.equal(state(fresh({ dispatch_kind: "build" }), { events: [verdictEvent({ verdict: "GO", disposition: "NOTE",
    finding_ids: [], finding_class: null, original_trigger: null, authorized_paths: [] })] }),
    "receipted", "and a GO was never a repair program at all");
});

test("every deny that asks for a RECORDED event names the command that records it", () => {
  // This chip exists because a deny message sent a blocked worker to a command that failed on the
  // state it was printed for. The close route then repeated the shape more quietly: it described
  // two events correctly and named nothing runnable, so the reader still had to go find HOW. A
  // remedy the reader cannot execute is not a remedy.
  //
  // Driven from the message TABLE, not from a list written here, so a state added later with an
  // unrunnable remedy goes red on its own.
  const RECORDED_EVENT = /`?(owner_extension|repair_close|root-cause exit|adherence_audit)`?/;
  const RECORDER = /record-repair-event\.mjs|confirm-repair-brief\.mjs/;
  const states = [
    "repair-worker-verification-missing", "repair-close-invalid", "repair-close-self-authorized",
    "repair-close-unauthorized", "repair-root-cause-exit-missing", "repair-worker-candidate-stale",
    "repair-worker-path-unauthorized", "repair-brief-changed", "repair-worker-session-missing",
  ];
  const gaps = [];
  for (const state of states) {
    const message = denyReason(state, { dispatch: { kind: "source", target: "src/x.mjs" } });
    assert.doesNotMatch(message, /sidecar state is /,
      `${state} has no message of its own — it would deny with a bare token`);
    if (RECORDED_EVENT.test(message) && !RECORDER.test(message)) gaps.push(state);
  }
  assert.deepEqual(gaps, [],
    `these denials ask the reader to record a typed event but name no command that records one: ` +
    `${gaps.join(", ")}. Name \`record-repair-event.mjs\` (or the brief confirmer) in the message — ` +
    `the reader is standing in a denial, not in the docs.`);

  // CANARY — the pin is decoration unless it can catch the shape it forbids.
  const planted = "record an `owner_extension` with the close authority, then a `repair_close`.";
  assert.ok(RECORDED_EVENT.test(planted) && !RECORDER.test(planted),
    "the detector must flag a remedy that names events but nothing runnable");
  const cured = `${planted} Record both with \`node scripts/record-repair-event.mjs --event <json>\`.`;
  assert.ok(RECORDER.test(cured), "…and must clear once the command is named");
});
