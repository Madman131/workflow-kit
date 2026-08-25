// The terminal-round-breaker mutation matrix — the rows the aggregate controller's own suite does
// not carry: the seven handoff loose ends (path fail-open · stale legacy handoff · close
// resurrection · malformed-row throw · snapshot TOCTOU), the evidence-fold requirements
// (four-bucket partition with inline followup routing · successor tier floor · GO-lineage
// successors · declared STOP), and the 12/20-round replay fixtures that assert TERMINATION at the
// terminal bookend — never a specific batch composition. Disabled-arm mutants prove each new
// mechanism's original trigger goes red when its arm is removed.

import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeRepairPathOwners, confirmRepairBrief, deriveAggregateRepairState,
  derivePendingLineageBudgets, deriveRepairState, fingerprintCandidate,
  gitSubjectPresent, loadRepairEventsForProject, recordAggregateChildContinuation,
  recordAggregateClose, recordAggregateDisposition, recordAggregateLegacyHandoff,
  recordAggregatePanelClose, recordAggregatePanelOpen, recordAggregateRootExit,
  recordAggregateWorkerHandoff, recordOwnerExtension, recordRepairClose,
  recordWorkerVerification, repairLedgerPath, verifyRepairWorkerWrite,
} from "../hooks/repair-dispatch-state.mjs";

const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const eventId = (event) => createHash("sha256").update(stable(event)).digest("hex");
const stamped = (event) => ({ event_id: eventId(event), event });
const options = (dir, sessionId = "orchestrator") => ({ projectRoot: dir, sessionId });

async function importMutant(dir, replacements) {
  let source = readFileSync(new URL("../hooks/repair-dispatch-state.mjs", import.meta.url), "utf8");
  for (const [pattern, replacement] of replacements) {
    const changed = source.replace(pattern, replacement);
    assert.notEqual(changed, source, `mutation must match: ${pattern}`);
    source = changed;
  }
  const file = path.join(dir, `mutant-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
}

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "terminal-breaker-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "x.mjs"), "export const x = 0;\n");
  execFileSync("git", ["add", "src/x.mjs"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", base], { cwd: dir });
  return { dir, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function commit(dir, value) {
  writeFileSync(path.join(dir, "src", "x.mjs"), `export const x = ${value};\n`);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", `candidate-${value}`], { cwd: dir });
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir, encoding: "utf8" }).trim(),
    paths: execFileSync("git", ["diff", "--name-only", "origin/main..HEAD"],
      { cwd: dir, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort(),
  };
}

const TIER_SEATS = {
  T2: [["free", "free"], ["a", "angle:a"], ["b", "angle:b"], ["external", "external"]],
  T3: [["free", "free"], ["a", "angle:a"], ["b", "angle:b"], ["c", "angle:c"], ["external", "external"]],
};
function expectedSeats(paths, tier = "T2") {
  // The external seat carries a second family: T2/T3 rosters owe the mechanical family floor
  // (two distinct family values), matching the decorrelation the tier exists for.
  return TIER_SEATS[tier].map(([seat_id, role]) => ({
    seat_id, role, family: role === "external" ? "claude" : "codex",
    pass_type: role === "external" ? "folded" : "free", paths,
  }));
}
function receivedSeats(expected, candidate, findingIds = []) {
  return expected.map((seat, index) => ({
    seat_id: seat.seat_id, role: seat.role, family: seat.family, pass_type: seat.pass_type,
    inspected_paths: seat.paths, reviewed_commit: candidate.commit, reviewed_tree: candidate.tree,
    verdict: index === 1 && findingIds.length ? "NO-GO" : "GO",
    raw_finding_ids: index === 1 ? findingIds : [],
    artifact_receipt: `receipt-${seat.seat_id}`, artifact_sha256: String(index + 1).repeat(64),
    pre_loaded: false, packet_scope: "candidate-only",
  }));
}

// `baseRef`/`baseCommit` default to the ONE base every panel here declares; M48 varies them to
// pin the cross-round base, and nothing else may.
function openPanel(ctx, round, candidate, { task = "task-1", changeset = "cs-1", tier = "T2",
  incoming = {}, lineage = {}, baseRef = "origin/main", baseCommit = ctx.base } = {}) {
  const expected = expectedSeats(candidate.paths, tier);
  const opened = recordAggregatePanelOpen({
    type: "aggregate_v2", kind: "panel_open", task_id: task, changeset_id: changeset, round,
    phase: round === 4 ? "final_bookend" : "repair_round", tier,
    frozen_commit: candidate.commit, frozen_tree: candidate.tree,
    base_ref: baseRef, base_commit: baseCommit, expected_seats: expected,
    incoming_dispatch_event_id: incoming.dispatch ?? null,
    incoming_worker_event_id: incoming.worker ?? null,
    child_continuation_event_id: lineage.continuation ?? null,
    legacy_handoff_event_id: lineage.handoff ?? null,
  }, options(ctx.dir));
  return { opened, expected };
}

function closePanel(ctx, panel, candidate, findingIds = [], { task = "task-1", changeset = "cs-1" } = {}) {
  return recordAggregatePanelClose({
    type: "aggregate_v2", kind: "panel_close", task_id: task, changeset_id: changeset,
    panel_open_event_id: panel.opened.event_id,
    received_seats: receivedSeats(panel.expected, candidate, findingIds),
  }, options(ctx.dir));
}

function decide(ctx, closed, { task = "task-1", changeset = "cs-1", accepted = [], declined = [],
  note = [], followup = [], pm_findings = [], terminal_state = "CONTINUE",
  remediation_kind = "bounded", authorized_paths = ["src/x.mjs"] } = {}) {
  return recordAggregateDisposition({
    type: "aggregate_v2", kind: "disposition", task_id: task, changeset_id: changeset,
    panel_close_event_id: closed.event_id, pm_findings,
    finding_dispositions: { accepted, declined, note, followup }, terminal_state, remediation_kind,
    authorized_paths,
  }, options(ctx.dir));
}

function dispatchBatch(ctx, dispositionId, closeId, nextRound, rootExitId = null,
  { task = "task-1", changeset = "cs-1" } = {}) {
  mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
  const brief = `briefs/round-${nextRound}.md`;
  writeFileSync(path.join(ctx.dir, brief), `repair ${nextRound}\n`);
  const receipt = confirmRepairBrief({ declaration: {
    aggregate_controller: "aggregate_v2", task_id: task, changeset_id: changeset,
    disposition_event_id: dispositionId, panel_close_event_id: closeId,
    next_round: nextRound, root_exit_event_id: rootExitId,
  }, brief_path: brief }, options(ctx.dir));
  assert.equal(receipt.ok, true, receipt.state);
  const worker = recordWorkerVerification({ task_id: task, repair_dispatch_event_id: receipt.event_id },
    options(ctx.dir, `worker-${nextRound}`));
  assert.equal(worker.ok, true, worker.state);
  return { dispatch: receipt.event_id, worker: worker.event_id };
}

function derive(ctx, task = "task-1") {
  const loaded = loadRepairEventsForProject(ctx.dir);
  return deriveAggregateRepairState(loaded.aggregate_events, task, { standardEvents: loaded.events });
}

test("LE1: an active aggregate program's write OUTSIDE its authorized set REFUSES — never not-repair-write", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    assert.equal(closed.ok, true, closed.state);
    const decided = decide(ctx, closed, { accepted: ["F1"] });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);

    // In scope: authorized.
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-2",
      target: "src/x.mjs" }, { projectRoot: ctx.dir }).ok, true);
    // Out of scope: a path NO program owns. The reproduced fail-open answered
    // {ok:true, state:"not-repair-write"} here by resolving ownership BY TARGET first.
    const outside = verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-2",
      target: "docs/unrelated.md" }, { projectRoot: ctx.dir });
    assert.equal(outside.ok, false, "an active program cannot write outside its own set");
    assert.equal(outside.state, "repair-worker-path-unauthorized");
    // An unrelated TASK on the unowned path stays free (unrelated-path availability preserved).
    assert.equal(verifyRepairWorkerWrite({ task_id: "other-task", session_id: "s",
      target: "docs/unrelated.md" }, { projectRoot: ctx.dir }).state, "not-repair-write");

    // Disabled arm: skip the task-first resolution and the original fail-open returns.
    const mutant = await importMutant(mutantDir, [[
      ": deriveAggregateRepairState(loaded.aggregate_events, taskId, { standardEvents: loaded.events });",
      ": { ok: true, active: false };",
    ]]);
    assert.equal(mutant.verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-2",
      target: "docs/unrelated.md" }, { projectRoot: ctx.dir }).state, "not-repair-write",
    "removing task-first resolution reproduces the measured fail-open");
    void authority;
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("LE4: a hash-valid malformed aggregate row fails the ledger CLOSED with a typed result — never a throw", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    commit(ctx.dir, 1);
    // Well-hashed disposition row whose authorized_paths is MISSING — the field the shipped
    // validator dereferenced before proving an array.
    const malformed = stamped({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "m",
      panel_close_event_id: "a".repeat(64), pm_findings: [],
      finding_dispositions: { accepted: [], declined: [], note: [], followup: [] },
      terminal_state: "GO", remediation_kind: null,
    });
    const ledger = repairLedgerPath(ctx.dir);
    mkdirSync(path.dirname(ledger), { recursive: true });
    writeFileSync(ledger, JSON.stringify(malformed) + "\n");
    let loaded;
    assert.doesNotThrow(() => { loaded = loadRepairEventsForProject(ctx.dir); },
      "a malformed row must produce a typed refusal, not an exception");
    assert.equal(loaded.ok, false);
    assert.equal(loaded.state, "repair-ledger-unavailable", "hash-valid malformed rows fail the ledger closed");

    // Disabled arm: removing the Array.isArray proof restores the reachable TypeError.
    const mutant = await importMutant(mutantDir, [[
      "Array.isArray(event.authorized_paths) &&\n        (event.authorized_paths.length === 0",
      "(event.authorized_paths.length === 0",
    ]]);
    assert.throws(() => mutant.loadRepairEventsForProject(ctx.dir),
      TypeError, "the unproven dereference was a real, reachable throw");

    // A FULLY SHAPED row with a wrong exact reference stays INERT, not history-breaking.
    const wrongRef = stamped({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:00:01.000Z", session_id: "m",
      panel_close_event_id: "b".repeat(64), pm_findings: [],
      finding_dispositions: { accepted: [], declined: [], note: [], followup: [] },
      terminal_state: "GO", remediation_kind: null, authorized_paths: [],
    });
    writeFileSync(ledger, JSON.stringify(wrongRef) + "\n");
    const after = loadRepairEventsForProject(ctx.dir);
    assert.equal(after.ok, true, "a shaped wrong-reference row does not poison the ledger");
    assert.equal(derive(ctx).dispositions.length, 0, "…and creates no authority");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("S1a: the subject-relief claims SEE-semantics on every surface, and the retracted spelling cannot return", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const controller = readFileSync(path.join(here, "..", "hooks", "repair-dispatch-state.mjs"), "utf8");
  const guard = readFileSync(path.join(here, "..", "hooks", "guard-brief-rung.mjs"), "utf8");
  for (const [name, text] of [["repair-dispatch-state.mjs", controller], ["guard-brief-rung.mjs", guard]]) {
    assert.doesNotMatch(text, /no repair ledger can exist/,
      `${name}: the refuted claim — blindness is a property of what the control can SEE, never of what can exist`);
  }
  assert.match(guard, /can SEE no repair ledger/, "the notice announces blindness in see-semantics");
  assert.match(guard, /not proven absent/, "…and says what a walk cannot prove");
});

test("LE3 + M23: terminality dominates delayed events, and a refreeze supersedes an unclosed panel without consuming anything", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // --- LE3: a panel opened before the Owner close must not resurrect ownership after it.
    const candidate = commit(ctx.dir, 1);
    const p1 = openPanel(ctx, 1, candidate);
    assert.equal(p1.opened.ok, true, p1.opened.state);
    const c1 = closePanel(ctx, p1, candidate, ["F1"]);
    const d1 = decide(ctx, c1, { accepted: ["F1"] });
    assert.equal(d1.ok, true, d1.state);
    const authority = dispatchBatch(ctx, d1.event_id, c1.event_id, 2);
    const cand2 = commit(ctx.dir, 2);
    const p2 = openPanel(ctx, 2, cand2, { incoming: authority });
    assert.equal(p2.opened.ok, true, p2.opened.state);
    const close = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: d1.event_id, reason: "abandoned mid-round-2",
      owner_evidence: "Owner close authority",
    }, options(ctx.dir, "owner-session"));
    assert.equal(close.ok, true, close.state);
    assert.equal(derive(ctx).terminal, "CLOSED");
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/x.mjs",
      { aggregateEvents: loaded.aggregate_events }).owners, [], "close releases the paths");

    // The pre-close panel arriving late: refused at record, inert on replay.
    const late = closePanel(ctx, p2, cand2, ["F2"]);
    assert.equal(late.ok, false, "a pre-terminal panel cannot close after the program ended");
    const lateClose = stamped({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:00:02.000Z", session_id: "late",
      panel_open_event_id: p2.opened.event_id,
      received_seats: receivedSeats(p2.expected, cand2, ["F2"]),
    });
    const lateDecide = stamped({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:00:03.000Z", session_id: "late",
      panel_close_event_id: lateClose.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F2"], declined: [], note: [], followup: [] },
      terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: ["src/x.mjs"],
    });
    const world = deriveAggregateRepairState(
      [...loaded.aggregate_events, lateClose, lateDecide], "task-1", { standardEvents: loaded.events });
    assert.equal(world.terminal, "CLOSED", "terminality dominates the delayed rows");
    assert.equal(world.active, false, "…so ownership is NOT resurrected");
    assert.equal(world.dispositions.length, 1, "…and the late disposition is inert");

    // Disabled arm: removing the terminal guards resurrects ownership under CLOSED. The late
    // disposition is DOUBLY blocked — the close reservation over the program's own ground shadows
    // the terminality guard — so the honest mutant disables both arms; each arm's own necessity
    // is proven by its own test, and this one proves that with neither, the resurrection is real.
    const mutant = await importMutant(mutantDir, [
      ["      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_open_event_id || \"\")) continue;",
        "      if (!state || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_open_event_id || \"\")) continue;"],
      ["      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_close_event_id || \"\") || !pmFindingsShape(row.pm_findings)) continue;",
        "      if (!state || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_close_event_id || \"\") || !pmFindingsShape(row.pm_findings)) continue;"],
      ["            stoppedPathOverlap(paths, dispositionLineage ? lineageAncestors(row.task_id) : null) ||\n",
        ""],
    ]);
    const resurrected = mutant.deriveAggregateRepairState(
      [...loaded.aggregate_events, lateClose, lateDecide], "task-1", { standardEvents: loaded.events });
    assert.equal(resurrected.active, true,
      "without terminality dominance the late rows resurrect ownership under a CLOSED program");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M23: a contaminated unclosed panel is superseded by a refreeze at the same round — nothing consumed, nothing reset", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const candA = commit(ctx.dir, 1);
    const pA = openPanel(ctx, 1, candA);
    assert.equal(pA.opened.ok, true, pA.opened.state);
    // Mid-panel contamination: the candidate changes before the panel could close.
    const candB = commit(ctx.dir, 2);
    const pB = openPanel(ctx, 1, candB);
    assert.equal(pB.opened.ok, true, `refreeze supersede must be accepted: ${pB.opened.state}`);
    // The superseded open can no longer close.
    assert.equal(closePanel(ctx, pA, candA, ["F1"]).ok, false,
      "a superseded panel_open cannot close");
    // The winning open closes and dispositions normally; no batch was consumed by the refreeze.
    const cB = closePanel(ctx, pB, candB, ["F1"]);
    assert.equal(cB.ok, true, cB.state);
    const dB = decide(ctx, cB, { accepted: ["F1"] });
    assert.equal(dB.ok, true, dB.state);
    const state = derive(ctx);
    assert.equal(state.dispositions.length, 1, "round count did not move");
    assert.equal(state.dispatches.length, 0, "the refreeze consumed NO batch");

    // Disabled arm: without the supersede, the contaminated round is bricked forever.
    const mutant = await importMutant(mutantDir, [[
      "(row.frozen_commit !== prior.frozen_commit || row.frozen_tree !== prior.frozen_tree) &&",
      "false &&",
    ]]);
    const loaded = loadRepairEventsForProject(ctx.dir);
    const refreeze = loaded.aggregate_events.find((row) => row.event.kind === "panel_open" &&
      row.event.frozen_commit === candB.commit);
    const withoutArm = mutant.deriveAggregateRepairState(
      loaded.aggregate_events.filter((row) => row !== refreeze).concat([refreeze]), "task-1",
      { standardEvents: loaded.events });
    assert.equal(withoutArm.panels_open.length, 1,
      "removing the supersede arm refuses the refreeze — the deadlock this transition cures");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("LE2: a legacy handoff binds the CURRENT winning standard disposition — a stale citation refuses", () => {
  const ctx = repo();
  try {
    commit(ctx.dir, 1);
    const manifest = fingerprintCandidate(ctx.dir, ["src/x.mjs"]);
    const round1 = {
      type: "round_disposition", task_id: "legacy", changeset_id: "legacy-cs", round: 1,
      candidate_sha: manifest.digest, candidate_manifest: manifest.records, verdict: "NO-GO",
      disposition: "REMEDIATE", finding_ids: ["L1"], finding_class: "class-a",
      ownership_area: "controller", original_trigger: "trigger one",
      authorized_paths: ["src/x.mjs"], introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null,
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "legacy-s",
    };
    const r1 = stamped(round1);
    const dispatchRow = stamped({
      type: "repair_dispatch", task_id: "legacy", changeset_id: "legacy-cs",
      source_round: 1, next_round: 2, candidate_sha: manifest.digest,
      finding_ids: ["L1"], authorized_paths: ["src/x.mjs"], target_kind: "brief",
      target: "briefs/legacy.md", brief_sha256: "c".repeat(64), brief_size: 7,
      recorded_at: "2099-01-01T00:00:01.000Z", session_id: "legacy-s",
    });
    const r2 = stamped({
      ...round1, round: 2, finding_ids: ["L2"], finding_class: "class-b",
      original_trigger: "trigger two", repair_dispatch_event_id: dispatchRow.event_id,
      recorded_at: "2099-01-01T00:00:02.000Z",
    });
    const ledger = repairLedgerPath(ctx.dir);
    mkdirSync(path.dirname(ledger), { recursive: true });
    writeFileSync(ledger, [r1, dispatchRow, r2].map((row) => JSON.stringify(row)).join("\n") + "\n");

    const handoff = (dispositionId, round) => recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-cs",
      parent_task_id: "legacy", parent_changeset_id: "legacy-cs",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "agg-child", changeset_id: "agg-cs", tier: "T2", budget: "one changeset", authorized_paths: ["src/x.mjs"] },
      owner_evidence: "Owner handoff", parent_disposition_event_id: dispositionId, parent_round: round,
    }, options(ctx.dir));
    // The recorder derives current state itself; the derivation is what must refuse a stale replay
    // row — plant one directly and prove it stays inert.
    const staleRow = stamped({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-cs",
      recorded_at: "2099-01-01T00:00:03.000Z", session_id: "legacy-s",
      parent_task_id: "legacy", parent_changeset_id: "legacy-cs",
      parent_disposition_event_id: r1.event_id, parent_round: 1,
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "stale-child", changeset_id: "stale-cs", tier: "T2", budget: "one changeset", authorized_paths: ["src/x.mjs"] },
      owner_evidence: "stale citation",
    });
    const loaded = loadRepairEventsForProject(ctx.dir);
    const staleWorld = deriveAggregateRepairState([...loaded.aggregate_events, staleRow], "stale-child",
      { standardEvents: loaded.events });
    assert.equal(staleWorld.lineage_event_id, null,
      "a handoff citing round 1 while round 2 is the current winning state is INERT");
    // The record path cannot even be HANDED a stale citation: the recorder derives the current
    // winning disposition itself and stamps that — callers never mint trusted pointers.
    const recorded = handoff(r1.event_id, 1);
    assert.equal(recorded.ok, true, recorded.state);
    const rows = loadRepairEventsForProject(ctx.dir).aggregate_events;
    const row = rows.find((candidateRow) => candidateRow.event.kind === "legacy_handoff");
    assert.equal(row.event.parent_disposition_event_id, r2.event_id,
      "the recorded handoff cites the CURRENT winner regardless of what the caller named");
    assert.equal(row.event.parent_round, 2);
  } finally { ctx.cleanup(); }
});

test("four-bucket partition: followups carry inline routing, accepted means blocking, and the bookend is total", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const p1 = openPanel(ctx, 1, candidate);
    const c1 = closePanel(ctx, p1, candidate, ["ADJ-1", "REAL-1"]);
    assert.equal(c1.ok, true, c1.state);
    // A followup entry with no routing refuses — silent survival is the failure this row exists for.
    assert.equal(decide(ctx, c1, { declined: ["REAL-1"], followup: [{ id: "ADJ-1" }],
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] }).ok, false,
    "a followup without its inline route refuses");
    // A finding id missing from every bucket refuses (dribble is the measured failure).
    assert.equal(decide(ctx, c1, { declined: ["REAL-1"],
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] }).ok, false,
    "an unpartitioned finding refuses — every id resolves in THIS disposition");
    // An id in two buckets refuses.
    assert.equal(decide(ctx, c1, { declined: ["REAL-1", "ADJ-1"],
      followup: [{ id: "ADJ-1", route: "successor:next" }],
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] }).ok, false,
    "a double-bucketed finding refuses");
    // GO with accepted ids refuses — accepted means BLOCKING-accepted.
    assert.equal(decide(ctx, c1, { accepted: ["REAL-1"], followup: [{ id: "ADJ-1", route: "successor:next" }],
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] }).ok, false,
    "GO with an accepted blocking id refuses (D1's empty-seat/PM-blocker class)");
    // The legal GO: blocking finding declined as false positive, real adjacent routed inline.
    const go = decide(ctx, c1, { declined: ["REAL-1"],
      followup: [{ id: "ADJ-1", route: "successor:follow-on-chip" }],
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(go.ok, true, go.state);
    const state = derive(ctx);
    assert.equal(state.terminal, "GO");
    assert.deepEqual(state.latest.finding_dispositions.followup,
      [{ id: "ADJ-1", route: "successor:follow-on-chip" }],
      "the followup row IS the durable typed relation, embedded in the disposition");

    // GO-lineage successor: only routed followups may seed it; tier may never drop below parent.
    const successor = (trigger_ids, tier) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: state.latest.event_id, trigger_ids,
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on",
      children: [{ task_id: "next-task", changeset_id: "next-cs", tier, budget: "one follow-on changeset", authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    assert.equal(successor(["REAL-1"], "T2").ok, false,
      "a GO successor cannot inherit a non-followup id");
    const ok = successor(["ADJ-1"], "T2");
    assert.equal(ok.ok, true, ok.state);
  } finally { ctx.cleanup(); }
});

test("declared STOP at any round + the successor tier floor (no lower baseline)", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const p1 = openPanel(ctx, 1, candidate, { tier: "T3" });
    assert.equal(p1.opened.ok, true, p1.opened.state);
    const c1 = closePanel(ctx, p1, candidate, ["CRIT-1"]);
    assert.equal(c1.ok, true, c1.state);
    // The PM declares STOP at round 1 — a Critical / fail-open harm the batch model must not
    // carry forward. Declared, never inferred.
    const stop = decide(ctx, c1, { accepted: ["CRIT-1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(stop.ok, true, stop.state);
    const state = derive(ctx);
    assert.equal(state.terminal, "STOP", "Critical/fail-open always stops — at ANY round");

    const successor = (tier) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: state.latest.event_id, trigger_ids: ["CRIT-1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner continuation",
      children: [{ task_id: "next-task", changeset_id: "next-cs", tier, budget: "one follow-on changeset", authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    assert.equal(successor("T2").ok, false, "a T3 parent's successor cannot declare a T2 baseline");
    const ok = successor("T3");
    assert.equal(ok.ok, true, ok.state);
  } finally { ctx.cleanup(); }
});

for (const rounds of [12, 20]) {
  test(`replay fixture: a ${rounds}-round history STOPS at the terminal bookend — prior rows preserved, no continuation granted`, () => {
    // The lanes' own cap-mappings of the measured Round-12 and Round-20 incidents. The fixture
    // asserts TERMINATION at the terminal bookend — never a specific batch composition: however
    // the finding stream partitions into the three batches, round 4 is the last round and every
    // later dispatch attempt fails closed.
    const ctx = repo();
    try {
      let candidate = commit(ctx.dir, 1);
      let authority = {};
      let closed, decided;
      for (const round of [1, 2, 3]) {
        const panel = openPanel(ctx, round, candidate, { incoming: authority });
        assert.equal(panel.opened.ok, true, panel.opened.state);
        closed = closePanel(ctx, panel, candidate, [`F${round}`]);
        assert.equal(closed.ok, true, closed.state);
        decided = decide(ctx, closed, { accepted: [`F${round}`],
          remediation_kind: round === 3 ? "root_replacement" : "bounded" });
        assert.equal(decided.ok, true, decided.state);
        let rootExit = null;
        if (round === 3) {
          const exit = recordAggregateRootExit({
            type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "cs-1",
            disposition_event_id: decided.event_id, shared_mechanism: "one shared root",
            symptom_explanation: "earlier fixes were symptoms", owner_state_yield_seams: ["state seam"],
            replacement: "one replacement", removed_workarounds: ["the cycle"],
            trigger_matrix: ["terminal bookend"],
          }, options(ctx.dir));
          assert.equal(exit.ok, true, exit.state);
          rootExit = exit.event_id;
        }
        authority = dispatchBatch(ctx, decided.event_id, closed.event_id, round + 1, rootExit);
        candidate = commit(ctx.dir, round + 1);
      }
      const bookend = openPanel(ctx, 4, candidate, { incoming: authority });
      assert.equal(bookend.opened.ok, true, bookend.opened.state);
      closed = closePanel(ctx, bookend, candidate, ["FINAL"]);
      decided = decide(ctx, closed, { accepted: ["FINAL"], terminal_state: "STOP",
        remediation_kind: null, authorized_paths: [] });
      assert.equal(decided.ok, true, decided.state);

      // The history's remaining rounds try to continue — every route fails closed, every time,
      // and the refusal is a NAMED diagnosis, never a bare ok:false: the open names terminality
      // and CARRIES the terminal state; the dispatch names its own unavailability (M17).
      for (let attempt = 5; attempt <= rounds; attempt += 1) {
        candidate = commit(ctx.dir, attempt * 100);
        const again = openPanel(ctx, Math.min(attempt, 4), candidate, { incoming: authority });
        assert.equal(again.opened.ok, false, `round ${attempt}: no panel after the terminal bookend`);
        assert.equal(again.opened.state, "aggregate-terminal",
          `round ${attempt}: the refusal NAMES terminality`);
        assert.equal(again.opened.terminal, "STOP", "…and carries the terminal state it enforces");
        const redispatch = confirmRepairBrief({ declaration: {
          aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
          disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
          next_round: 5, root_exit_event_id: null,
        }, brief_path: "briefs/round-2.md" }, options(ctx.dir));
        assert.equal(redispatch.ok, false, `round ${attempt}: no dispatch after STOP`);
        assert.equal(redispatch.state, "aggregate-dispatch-unavailable",
          `round ${attempt}: the dispatch refusal is the named diagnosis`);
      }
      const state = derive(ctx);
      assert.equal(state.terminal, "STOP", "the terminal bookend holds");
      assert.equal(state.dispositions.length, 4, "prior rows preserved — the count never reset");
      assert.equal(state.dispatches.length, 3, "exactly three batches were ever consumed");
    } finally { ctx.cleanup(); }
  });
}

test("LE5: panel evidence is commit-addressed — the changed-path set derives from the frozen pair, never live HEAD", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const calls = [];
    const spyGit = (cmd, args, opts) => { calls.push(args.join(" ")); return execFileSync(cmd, args, opts); };
    const expected = expectedSeats(candidate.paths);
    const opened = recordAggregatePanelOpen({
      type: "aggregate_v2", kind: "panel_open", task_id: "task-1", changeset_id: "cs-1", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: candidate.commit, frozen_tree: candidate.tree,
      base_ref: "origin/main", base_commit: ctx.base, expected_seats: expected,
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    }, { ...options(ctx.dir), execGit: spyGit });
    assert.equal(opened.ok, true, opened.state);
    const diffCalls = calls.filter((line) => line.startsWith("diff "));
    assert.ok(diffCalls.length > 0, "evidence capture ran a diff");
    for (const line of diffCalls) {
      assert.doesNotMatch(line, /HEAD/,
        "the changed-path diff is commit-addressed (base..frozen), never HEAD-relative");
      assert.match(line, new RegExp(`${ctx.base}\\.\\.${candidate.commit}`),
        "…and names the exact immutable pair");
    }
    const mergeBase = calls.filter((line) => line.startsWith("merge-base "));
    assert.ok(mergeBase.every((line) => !line.includes("HEAD")),
      "merge-base is asked about the frozen commit, not HEAD");
    // The clean-candidate bracket runs BEFORE and AFTER capture: two status reads.
    assert.ok(calls.filter((line) => line.startsWith("status ")).length >= 2,
      "the clean-candidate check brackets the evidence capture");
  } finally { ctx.cleanup(); }
});

test("M34: ledger order is authority — an out-of-band standard append never re-adjudicates persisted aggregate rows", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const candidate = commit(ctx.dir, 1);
    const p1 = openPanel(ctx, 1, candidate);
    assert.equal(p1.opened.ok, true, p1.opened.state);
    const c1 = closePanel(ctx, p1, candidate, ["F1"]);
    const d1 = decide(ctx, c1, { accepted: ["F1"] });
    assert.equal(d1.ok, true, d1.state);
    assert.equal(derive(ctx).active, true);

    // A standard round-1 row lands out-of-band AFTER the program's rows, claiming the program's
    // path plus one of its own. Minting is retired, so no recorder can produce this row — its
    // only source is a raw write. Every cross-stream predicate evaluates at each aggregate row's
    // ledger position, so the append changes nothing already adjudicated.
    const manifest = fingerprintCandidate(ctx.dir, ["src/x.mjs"]);
    const intruder = stamped({
      type: "round_disposition", task_id: "intruder", changeset_id: "intruder-cs", round: 1,
      candidate_sha: manifest.digest, candidate_manifest: manifest.records, verdict: "NO-GO",
      disposition: "REMEDIATE", finding_ids: ["I1"], finding_class: "class-i",
      ownership_area: "controller", original_trigger: "out-of-band append",
      authorized_paths: ["src/x.mjs", "src/z.mjs"], introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null,
      recorded_at: "2099-01-01T00:00:30.000Z", session_id: "intruder-s",
    });
    writeFileSync(repairLedgerPath(ctx.dir), JSON.stringify(intruder) + "\n", { flag: "a" });

    const after = derive(ctx);
    assert.equal(after.active, true, "an out-of-band standard append must not erase live ownership");
    assert.equal(after.dispositions.length, 1, "the accepted history is untouched");
    assert.deepEqual(after.authorized_paths, ["src/x.mjs"]);

    // …but a NEW admission evaluates at the END of the ledger and sees the intruder: a fresh
    // program on the intruder's OWN path refuses for the legacy-availability reason alone
    // (task-1 holds src/x.mjs only, so nothing shadows this check).
    execFileSync("git", ["checkout", "-qb", "z-candidate", "origin/main"], { cwd: ctx.dir });
    writeFileSync(path.join(ctx.dir, "src", "z.mjs"), "export const z = 1;\n");
    execFileSync("git", ["add", "src/z.mjs"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "z-candidate"], { cwd: ctx.dir });
    const zCandidate = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["src/z.mjs"],
    };
    const refused = openPanel(ctx, 1, zCandidate, { task: "task-2", changeset: "cs-2" });
    assert.equal(refused.opened.ok, false, "a NEW program on a live legacy path must refuse");

    // Disabled arm: strip the seq prefix so the legacy check reads the FULL stream during replay —
    // the append retroactively refuses the program's round-1 open and the whole program, its
    // disposition, and its ownership evaporate. The fail-open this ordering cures.
    const mutant = await importMutant(mutantDir, [
      ["      if (stdSeq(identity) >= atSeq) continue;\n", ""],
      ["      const legacy = getStandard(identity.event.task_id, atSeq);",
        "      const legacy = getStandard(identity.event.task_id);"],
    ]);
    const loaded = loadRepairEventsForProject(ctx.dir);
    const erased = mutant.deriveAggregateRepairState(loaded.aggregate_events, "task-1",
      { standardEvents: loaded.events });
    assert.equal(erased.dispositions.length, 0,
      "without ledger order the out-of-band append erases the program");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

// ── GG · the R2-accepted test gap fills (gate record, cluster GG) ──────────────────────────────

test("H1: two concurrent appenders race conflicting-but-valid dispositions — first wins, the loser gets a TYPED conflict, the ledger survives", async () => {
  const ctx = repo();
  const scratch = mkdtempSync(path.join(os.tmpdir(), "breaker-race-"));
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    assert.equal(closed.ok, true, closed.state);
    // Two child PROCESSES — real concurrent appenders, not two calls in one loop — each recording
    // an individually valid disposition for the same panel_close: one GO (F1 declined), one
    // CONTINUE (F1 accepted). Only one transition can win the contested slot.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const hooksHref = pathToFileURL(path.join(here, "..", "hooks", "repair-dispatch-state.mjs")).href;
    const racer = path.join(scratch, "racer.mjs");
    writeFileSync(racer, [
      "const [hooksHref, projectRoot, panelCloseId, mode] = process.argv.slice(2);",
      "const { recordAggregateDisposition } = await import(hooksHref);",
      "const result = recordAggregateDisposition({",
      '  type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",',
      "  panel_close_event_id: panelCloseId, pm_findings: [],",
      '  finding_dispositions: mode === "go"',
      '    ? { accepted: [], declined: ["F1"], note: [], followup: [] }',
      '    : { accepted: ["F1"], declined: [], note: [], followup: [] },',
      '  terminal_state: mode === "go" ? "GO" : "CONTINUE",',
      '  remediation_kind: mode === "go" ? null : "bounded",',
      '  authorized_paths: mode === "go" ? [] : ["src/x.mjs"],',
      "}, { projectRoot, sessionId: `racer-${mode}` });",
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n") + "\n");
    const run = (mode) => new Promise((resolve, reject) => {
      execFile(process.execPath, [racer, hooksHref, ctx.dir, closed.event_id, mode],
        { encoding: "utf8" }, (error, stdout) =>
          error ? reject(error) : resolve(JSON.parse(stdout)));
    });
    // No sleeps, no forced interleaving: whatever the schedule, the OUTCOME contract is fixed —
    // both callers get typed results (a child that threw would exit nonzero and fail this test).
    const [goResult, continueResult] = await Promise.all([run("go"), run("continue")]);
    for (const result of [goResult, continueResult]) {
      assert.equal(typeof result.ok, "boolean", "every racer gets a typed result");
    }
    const winners = [goResult, continueResult].filter((result) => result.ok);
    const losers = [goResult, continueResult].filter((result) => !result.ok);
    assert.equal(winners.length, 1, "exactly one racer wins the contested transition");
    assert.equal(losers[0].state, "aggregate-disposition-conflict",
      "the loser's refusal is the typed conflict — never a throw, never ledger-unavailable");
    // The ledger stayed fully readable, and the derived world matches the winner exactly — a
    // losing row that reached the file is inert audit residue.
    const after = loadRepairEventsForProject(ctx.dir);
    assert.equal(after.ok, true, "the contested ledger is fully readable afterward");
    const world = derive(ctx);
    assert.equal(world.dispositions.length, 1, "exactly one disposition holds the round");
    assert.equal(world.latest.event_id, winners[0].event_id, "…and it is the winner's");
    if (goResult.ok) assert.equal(world.terminal, "GO");
    else { assert.equal(world.terminal, null); assert.equal(world.active, true); }
  } finally { ctx.cleanup(); rmSync(scratch, { recursive: true, force: true }); }
});

test("H2: close eligibility against the FULL admitted set — verification, handoff replacement, and the pre-mint window, each with its positive control", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"] });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2); // admits worker-2
    const closeAs = (sessionId) => recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, reason: "release attempt", owner_evidence: "claimed",
    }, options(ctx.dir, sessionId));
    // (a) A session admitted via WORKER VERIFICATION cannot close the program constraining it.
    const viaVerification = closeAs("worker-2");
    assert.equal(viaVerification.ok, false);
    assert.equal(viaVerification.state, "aggregate-close-self-authorized",
      "a verification-admitted worker cannot release its own program");
    // (b) A session admitted via a WORKER HANDOFF replacement is equally ineligible — and the
    // REVOKED prior session stays ineligible too: admission is forever, not merely current.
    const handoff = recordAggregateWorkerHandoff({
      type: "aggregate_v2", kind: "worker_handoff", task_id: "task-1", changeset_id: "cs-1",
      dispatch_event_id: authority.dispatch, prior_worker_event_id: authority.worker,
      new_worker_session_id: "worker-2b", owner_evidence: "Owner handoff",
    }, options(ctx.dir, "owner-session"));
    assert.equal(handoff.ok, true, handoff.state);
    const viaHandoff = closeAs("worker-2b");
    assert.equal(viaHandoff.ok, false);
    assert.equal(viaHandoff.state, "aggregate-close-self-authorized",
      "a handoff-admitted replacement cannot release the program either");
    assert.equal(closeAs("worker-2").state, "aggregate-close-self-authorized",
      "…and the revoked prior worker remains in the admitted set");
    // (c) THE PRE-MINT WINDOW, adjudicated FORWARD — as-of, like every other predicate. A
    // session not yet admitted at close time is genuinely not a worker (intent is not fact,
    // per records-not-deters), so its close ACCEPTS; its later self-admission then refuses on
    // the terminality that close created. The earlier whole-ledger pre-scan resolved this
    // backward — a LATER admission row retro-refused an ACCEPTED close, resurrecting the
    // program and erasing its successors: the measured fail-open, executed by the R3 panel.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const dispatchRow = loaded.aggregate_events.find((row) => row.event.kind === "dispatch").event;
    const sneakClose = stamped({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:00:10.000Z", session_id: "sneak",
      disposition_event_id: decided.event_id, reason: "pre-mint escape", owner_evidence: "claimed",
    });
    const sneakAdmission = stamped({
      type: "aggregate_v2", kind: "worker", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:00:11.000Z", session_id: "sneak",
      dispatch_event_id: authority.dispatch, worker_session_id: "sneak",
      authorized_paths: [...dispatchRow.authorized_paths], brief_path: dispatchRow.target,
      brief_sha256: dispatchRow.brief_sha256,
    });
    // Positive control FIRST: the identical close row from a session with NO admission anywhere
    // in the ledger closes the program — an unadmitted session's close succeeds.
    const unadmitted = deriveAggregateRepairState(
      [...loaded.aggregate_events, sneakClose], "task-1", { standardEvents: loaded.events });
    assert.equal(unadmitted.terminal, "CLOSED", "an unadmitted session's close takes effect");
    // The SAME close with the admission minted AFTER it: the close STANDS (replay stability —
    // appending a row never re-adjudicates an accepted one) and the late admission is the row
    // that loses, refused by the terminality the close created.
    const preMint = deriveAggregateRepairState(
      [...loaded.aggregate_events, sneakClose, sneakAdmission], "task-1",
      { standardEvents: loaded.events });
    assert.equal(preMint.terminal, "CLOSED",
      "the accepted close STANDS — a later admission row never re-adjudicates it");
    assert.equal(preMint.closes.length, 1, "the close remains the accepted terminal row");
    assert.equal(preMint.active, false, "…the program stays released");
    assert.equal(preMint.workers.length, 1,
      "…and the post-close self-admission is the row that loses (only the real worker's row stands)");
    // Record-path positive control: a genuinely outside session closes the real program.
    const ownerClose = closeAs("owner-session");
    assert.equal(ownerClose.ok, true, ownerClose.state);
    assert.equal(derive(ctx).terminal, "CLOSED");
  } finally { ctx.cleanup(); }
});

test("H3a: the refreeze cap on replay — a planted SECOND same-round supersede is refused at record and inert on replay", () => {
  const ctx = repo();
  try {
    const candA = commit(ctx.dir, "a");
    assert.equal(openPanel(ctx, 1, candA).opened.ok, true);
    const candB = commit(ctx.dir, "b");
    assert.equal(openPanel(ctx, 1, candB).opened.ok, true, "the ONE supersede is accepted");
    // Record path: the grind's next supersede refuses.
    const candC = commit(ctx.dir, "c");
    assert.equal(openPanel(ctx, 1, candC).opened.ok, false,
      "a second same-round supersede refuses at record");
    // Replay path: the same row PLANTED (raw, bypassing the recorder) is inert — the world keeps
    // the first supersede's winner, so the cap cannot be ground through the file either.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const winning = loaded.aggregate_events.find((row) =>
      row.event.kind === "panel_open" && row.event.frozen_commit === candB.commit).event;
    const planted = stamped({ ...winning, frozen_commit: candC.commit, frozen_tree: candC.tree,
      recorded_at: "2099-01-01T00:00:20.000Z", session_id: "grinder" });
    const world = deriveAggregateRepairState(
      [...loaded.aggregate_events, planted], "task-1", { standardEvents: loaded.events });
    assert.equal(world.panels_open.length, 2, "the planted third open lands nowhere");
    assert.equal(world.panels_open.at(-1).frozen_commit, candB.commit,
      "…and the first supersede remains the round's winner");
  } finally { ctx.cleanup(); }
});

// The R1 gate record's grind walks (cluster A; the record labels them by their finding ids —
// WALK-F1's compliant refreeze/roster/scope grind and WALK-F2's close-restart — carried into
// batch 2 as the V1/V2 walks). Each step of each walk must refuse exactly as recorded there.
test("H3b · V1 (WALK-F1): the compliant grind — roster rewrite, scope widening, then the refreeze cap — grinds NOTHING", () => {
  const ctx = repo();
  try {
    const candA = commit(ctx.dir, "a1");
    assert.equal(openPanel(ctx, 1, candA).opened.ok, true);
    // Step 1 — the roster is NOT re-writable: a new candidate arriving with a recomposed seat
    // list is refused (the walk's membership rewrite).
    const candR = commit(ctx.dir, "a2");
    const recomposed = recordAggregatePanelOpen({
      type: "aggregate_v2", kind: "panel_open", task_id: "task-1", changeset_id: "cs-1", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: candR.commit, frozen_tree: candR.tree,
      base_ref: "origin/main", base_commit: ctx.base,
      expected_seats: expectedSeats(candR.paths).map((seat) => ({ ...seat, seat_id: `re-${seat.seat_id}` })),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    }, options(ctx.dir));
    assert.equal(recomposed.ok, false, "a refreeze cannot recompose the roster");
    // Step 2 — the SCOPE is not re-writable: a candidate widening the changed-path set is refused.
    writeFileSync(path.join(ctx.dir, "src", "extra.mjs"), "export const extra = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "widened"], { cwd: ctx.dir });
    const widened = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["src/extra.mjs", "src/x.mjs"],
    };
    assert.equal(openPanel(ctx, 1, widened).opened.ok, false,
      "a refreeze cannot widen the changed-path set");
    // The one HONEST refreeze — same scope, same roster, new bytes — still works after the
    // refused grind steps (they consumed nothing, in either direction).
    execFileSync("git", ["rm", "-q", "src/extra.mjs"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "narrowed-back"], { cwd: ctx.dir });
    const candB = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["src/x.mjs"],
    };
    assert.equal(openPanel(ctx, 1, candB).opened.ok, true, "the honest supersede is accepted");
    // Step 3 — the cap: the walk's endless-refreeze loop stops at ONE.
    const candC = commit(ctx.dir, "a3");
    assert.equal(openPanel(ctx, 1, candC).opened.ok, false, "the refreeze loop is bounded at one");
    // The walk ground NOTHING: one round open, no disposition, no batch. (The bookend half of
    // WALK-F1 is pinned by the batch-1 bookend-refreeze bound and the replay fixtures' named
    // aggregate-terminal refusals above.)
    const state = derive(ctx);
    assert.equal(state.panels_open.length, 2, "original open + the one supersede, nothing more");
    assert.equal(state.dispositions.length, 0);
    assert.equal(state.dispatches.length, 0, "no batch was consumed by any grind step");
  } finally { ctx.cleanup(); }
});

test("H3b · V2 (WALK-F2): close-then-fresh-budget restart is refused at record AND inert on replay", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["G1"]);
    const decided = decide(ctx, closed, { accepted: ["G1"] });
    assert.equal(decided.ok, true, decided.state);
    // The walk: abandon the ground program, restart on the same surface with a fresh label and a
    // fresh budget. The close itself is legitimate (outside session, real citation)…
    const close = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, reason: "walk abandons", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(close.ok, true, close.state);
    assert.deepEqual(derive(ctx).stopped_paths, ["src/x.mjs"], "…and it RESERVES the ground");
    // Record path: the fresh-label restart refuses.
    const regrind = commit(ctx.dir, "regrind");
    assert.equal(openPanel(ctx, 1, regrind, { task: "regrind", changeset: "regrind-cs" }).opened.ok,
      false, "close-then-relabel is not a fresh budget at record");
    // Replay path: the same restart row planted raw is inert — no program materializes.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const planted = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "regrind", changeset_id: "regrind-cs",
      recorded_at: "2099-01-01T00:00:30.000Z", session_id: "grinder", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: regrind.commit, frozen_tree: regrind.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/x.mjs"],
      expected_seats: expectedSeats(["src/x.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    const world = deriveAggregateRepairState(
      [...loaded.aggregate_events, planted], "regrind", { standardEvents: loaded.events });
    assert.equal(world.panels_open.length, 0, "the planted restart is inert on replay");
    // Polarity: the reservation is SCOPED — an unrelated surface still opens freely.
    execFileSync("git", ["checkout", "-qb", "side", "origin/main"], { cwd: ctx.dir });
    mkdirSync(path.join(ctx.dir, "docs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "docs", "side.md"), "side\n");
    execFileSync("git", ["add", "-A"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "side"], { cwd: ctx.dir });
    const side = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["docs/side.md"],
    };
    assert.equal(openPanel(ctx, 1, side, { task: "elsewhere", changeset: "elsewhere-cs" }).opened.ok,
      true, "the reservation binds the ground surface, not the repository");
  } finally { ctx.cleanup(); }
});

test("H3c: a close after a COLLECTED panel (no disposition) reserves the ground — the discriminator is panels collected", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["C1"]);
    assert.equal(closed.ok, true, closed.state);
    // NO disposition — the close cites the winning open (the virgin route), but the panel WAS
    // collected: findings were ground, and abandoning them must not release the surface free.
    const close = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: null, panel_open_event_id: panel.opened.event_id,
      reason: "abandoned after collection", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(close.ok, true, close.state);
    const state = derive(ctx);
    assert.equal(state.terminal, "CLOSED");
    assert.deepEqual(state.stopped_paths, ["src/x.mjs"],
      "a collected panel is the reservation discriminator — not a recorded disposition");
    // Close-then-relabel over the reserved ground refuses at record and stays inert on replay.
    const relabel = commit(ctx.dir, 2);
    assert.equal(openPanel(ctx, 1, relabel, { task: "relabel", changeset: "relabel-cs" }).opened.ok,
      false, "a fresh program over the collected-then-closed paths refuses");
    const loaded = loadRepairEventsForProject(ctx.dir);
    const planted = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "relabel", changeset_id: "relabel-cs",
      recorded_at: "2099-01-01T00:00:40.000Z", session_id: "grinder", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: relabel.commit, frozen_tree: relabel.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/x.mjs"],
      expected_seats: expectedSeats(["src/x.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    const world = deriveAggregateRepairState(
      [...loaded.aggregate_events, planted], "relabel", { standardEvents: loaded.events });
    assert.equal(world.panels_open.length, 0, "…and the planted relabel is inert on replay");
    // The truly-virgin polarity — no panel ever collected, close releases cleanly — is pinned by
    // the batch-1 virgin-close test; here the SAME route with a collected panel reserves.
  } finally { ctx.cleanup(); }
});

test("M11: the clean-candidate bracket is ARMED — dirty before capture refuses, movement during capture refuses", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const input = () => ({
      type: "aggregate_v2", kind: "panel_open", task_id: "task-1", changeset_id: "cs-1", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: candidate.commit, frozen_tree: candidate.tree,
      base_ref: "origin/main", base_commit: ctx.base, expected_seats: expectedSeats(candidate.paths),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    // BEFORE arm: a tracked modification standing when capture starts refuses the open. (LE5
    // proves the evidence is commit-addressed; this is the bracket's other polarity — it FIRES.)
    writeFileSync(path.join(ctx.dir, "src", "x.mjs"), "export const x = 'dirty';\n");
    const dirty = recordAggregatePanelOpen(input(), options(ctx.dir));
    assert.equal(dirty.ok, false);
    assert.equal(dirty.state, "aggregate-panel-open-malformed",
      "a caller not standing clean at the declared freeze cannot open");
    execFileSync("git", ["checkout", "--", "src/x.mjs"], { cwd: ctx.dir });
    // AFTER arm: the tree moves UNDER the capture — clean at the first status, dirtied right
    // after the changed-path diff runs — and the re-check refuses. This is the seam the bracket
    // exists for; without the second check the open would bind evidence from a tree that moved.
    const sabotage = (cmd, args, opts) => {
      const out = execFileSync(cmd, args, opts);
      if (args[0] === "diff") {
        writeFileSync(path.join(ctx.dir, "src", "x.mjs"), "export const x = 'moved';\n");
      }
      return out;
    };
    const moved = recordAggregatePanelOpen(input(), { ...options(ctx.dir), execGit: sabotage });
    assert.equal(moved.ok, false);
    assert.equal(moved.state, "aggregate-panel-open-malformed",
      "movement during capture is caught by the AFTER check of the bracket");
    execFileSync("git", ["checkout", "--", "src/x.mjs"], { cwd: ctx.dir });
    // Positive control: the identical input at a genuinely clean freeze opens.
    const clean = recordAggregatePanelOpen(input(), options(ctx.dir));
    assert.equal(clean.ok, true, clean.state);
  } finally { ctx.cleanup(); }
});

test("M13: a rig rerun on the unchanged candidate consumes NOTHING, while a panel-found candidate defect consumes its batch", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const first = openPanel(ctx, 1, candidate);
    assert.equal(first.opened.ok, true, first.opened.state);
    // Direction 1 — RIG failure, candidate bytes unchanged (T3): the rerun's re-record converges
    // idempotently on the standing open. No refreeze is spent, no round moves, nothing consumed.
    const rerun = openPanel(ctx, 1, candidate);
    assert.equal(rerun.opened.ok, true, rerun.opened.state);
    assert.equal(rerun.opened.idempotent, true, "an unchanged-candidate rerun is a NON-EVENT");
    assert.equal(rerun.opened.event_id, first.opened.event_id, "…converging on the standing open");
    const before = derive(ctx);
    assert.equal(before.panels_open.length, 1, "no supersede was spent");
    assert.equal(before.dispatches.length, 0, "no batch was consumed");
    // Direction 2 — a CANDIDATE-OWNED defect found by the panel is a finding: it rides the
    // disposition and its repair consumes the batch. (The middle case — mid-panel contamination
    // taking the ONE refreeze — is M23's own test.)
    const closed = closePanel(ctx, first, candidate, ["FIXTURE-DEFECT"]);
    assert.equal(closed.ok, true, closed.state);
    const decided = decide(ctx, closed, { accepted: ["FIXTURE-DEFECT"] });
    assert.equal(decided.ok, true, decided.state);
    dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    assert.equal(derive(ctx).dispatches.length, 1,
      "the panel-found candidate defect consumed exactly its one batch");
  } finally { ctx.cleanup(); }
});

test("M15: a NON-terminal parent cannot seed a successor — before any disposition, and after a CONTINUE alike", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const successor = (dispositionId, triggerIds) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: dispositionId, trigger_ids: triggerIds,
      continuation_kind: "new_changeset", owner_evidence: "Owner continuation",
      children: [{ task_id: "heir", changeset_id: "heir-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    // Open, no disposition: nothing to anchor to.
    const preDisposition = successor("f".repeat(64), ["F1"]);
    assert.equal(preDisposition.ok, false);
    assert.equal(preDisposition.state, "aggregate-continuation-conflict",
      "an undisposed program cannot seed a child");
    // Disposed CONTINUE — a REAL disposition id, still non-terminal: mid-ladder is not an exit.
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"] });
    assert.equal(decided.ok, true, decided.state);
    const midLadder = successor(decided.event_id, ["F1"]);
    assert.equal(midLadder.ok, false);
    assert.equal(midLadder.state, "aggregate-continuation-conflict",
      "a CONTINUE disposition is not a terminal parent — no successor from mid-ladder");
    // Positive control: the SAME program gone terminal seeds the successor it refused above.
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    const cand2 = commit(ctx.dir, 2);
    const p2 = openPanel(ctx, 2, cand2, { incoming: authority });
    assert.equal(p2.opened.ok, true, p2.opened.state);
    const c2 = closePanel(ctx, p2, cand2, ["F2"]);
    const stop = decide(ctx, c2, { accepted: ["F2"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(stop.ok, true, stop.state);
    const seeded = successor(stop.event_id, ["F2"]);
    assert.equal(seeded.ok, true, seeded.state);
  } finally { ctx.cleanup(); }
});

test("M17 companion: the entry chain names its missing link — aggregate-worker-required carries the dispatch id", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"] });
    assert.equal(decided.ok, true, decided.state);
    // Dispatch WITHOUT the worker admission — the half-built entry chain.
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs", "round-2.md"), "repair 2\n");
    const receipt = confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
      next_round: 2, root_exit_event_id: null,
    }, brief_path: "briefs/round-2.md" }, options(ctx.dir));
    assert.equal(receipt.ok, true, receipt.state);
    const cand2 = commit(ctx.dir, 2);
    const premature = openPanel(ctx, 2, cand2, { incoming: { dispatch: receipt.event_id } });
    assert.equal(premature.opened.ok, false);
    assert.equal(premature.opened.state, "aggregate-worker-required",
      "the refusal NAMES the missing admission, not a bare conflict");
    assert.equal(premature.opened.dispatch_event_id, receipt.event_id,
      "…and carries the dispatch id the admission must cite");
    // Positive control: with the admission recorded, the same open enters.
    const worker = recordWorkerVerification({ task_id: "task-1", repair_dispatch_event_id: receipt.event_id },
      options(ctx.dir, "worker-2"));
    assert.equal(worker.ok, true, worker.state);
    const entered = openPanel(ctx, 2, cand2,
      { incoming: { dispatch: receipt.event_id, worker: worker.event_id } });
    assert.equal(entered.opened.ok, true, entered.opened.state);
  } finally { ctx.cleanup(); }
});

test("M29: the lineage budget binds EVERY round — an outside-budget first open refuses, and a later round cannot expand past it", () => {
  const ctx = repo();
  try {
    const snap = (paths) => ({
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths,
    });
    // Parent STOPs over two files; its continuation declares the child budget EXACTLY those two.
    commit(ctx.dir, "parent");
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "parent-two-file"], { cwd: ctx.dir });
    const parentCand = snap(["src/x.mjs", "src/y.mjs"]);
    const panel = openPanel(ctx, 1, parentCand);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const closed = closePanel(ctx, panel, parentCand, ["CRIT"]);
    const stop = decide(ctx, closed, { accepted: ["CRIT"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(stop.ok, true, stop.state);
    const continuation = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: derive(ctx).latest.event_id, trigger_ids: ["CRIT"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "child", changeset_id: "child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs", "src/y.mjs"] }],
    }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
    const childOpts = { task: "child", changeset: "child-cs" };
    // (a) An OUTSIDE-BUDGET first open refuses: the child's candidate touches a path the declared
    // budget never covered.
    execFileSync("git", ["checkout", "-qb", "child-bad", "origin/main"], { cwd: ctx.dir });
    writeFileSync(path.join(ctx.dir, "src", "z.mjs"), "export const z = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "child-outside"], { cwd: ctx.dir });
    const outside = openPanel(ctx, 1, snap(["src/z.mjs"]),
      { ...childOpts, lineage: { continuation: continuation.event_id } });
    assert.equal(outside.opened.ok, false);
    assert.equal(outside.opened.state, "aggregate-panel-open-conflict",
      "a lineage child cannot open outside its declared budget");
    // (b) A SUBSET opens (the budget is a superset, not a prophecy)…
    execFileSync("git", ["checkout", "-qb", "child-line", "origin/main"], { cwd: ctx.dir });
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 2;\n");
    execFileSync("git", ["add", "-A"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "child-subset"], { cwd: ctx.dir });
    const subsetCand = snap(["src/y.mjs"]);
    const childPanel = openPanel(ctx, 1, subsetCand,
      { ...childOpts, lineage: { continuation: continuation.event_id } });
    assert.equal(childPanel.opened.ok, true, `subset lineage opens: ${childPanel.opened.state}`);
    const childClosed = closePanel(ctx, childPanel, subsetCand, ["CF1"], childOpts);
    assert.equal(childClosed.ok, true, childClosed.state);
    const childDecided = decide(ctx, childClosed,
      { ...childOpts, accepted: ["CF1"], authorized_paths: ["src/y.mjs"] });
    assert.equal(childDecided.ok, true, childDecided.state);
    const authority = dispatchBatch(ctx, childDecided.event_id, childClosed.event_id, 2, null, childOpts);
    // …but the ROUND-2 candidate cannot expand past the budget: a child's later-round diff
    // including a path outside its declared lineage budget refuses (the Codex R2 CRITICAL — a
    // round-2 candidate is not a skeleton key over what round 1 could not touch).
    writeFileSync(path.join(ctx.dir, "src", "z.mjs"), "export const z = 2;\n");
    execFileSync("git", ["add", "src/z.mjs"], { cwd: ctx.dir }); // NOT -A: the brief stays untracked
    execFileSync("git", ["commit", "-qm", "child-expands-outside"], { cwd: ctx.dir });
    const expanded = openPanel(ctx, 2, snap(["src/y.mjs", "src/z.mjs"]),
      { ...childOpts, incoming: authority });
    assert.equal(expanded.opened.ok, false);
    assert.equal(expanded.opened.state, "aggregate-panel-open-conflict",
      "a round-2 expansion beyond the lineage budget refuses");
    // Positive control: widening WITHIN the budget is fine — the boundary is the budget, not the
    // round-1 footprint.
    execFileSync("git", ["rm", "-q", "src/z.mjs"], { cwd: ctx.dir });
    writeFileSync(path.join(ctx.dir, "src", "x.mjs"), "export const x = 'child-round-2';\n");
    execFileSync("git", ["add", "src/x.mjs"], { cwd: ctx.dir }); // NOT -A: the brief stays untracked
    execFileSync("git", ["commit", "-qm", "child-within-budget"], { cwd: ctx.dir });
    const within = openPanel(ctx, 2, snap(["src/x.mjs", "src/y.mjs"]),
      { ...childOpts, incoming: authority });
    assert.equal(within.opened.ok, true, `within-budget widening opens: ${within.opened.state}`);
  } finally { ctx.cleanup(); }
});

test("S1a: the env arm on a REAL directory — a Git location override forces subject-present and is NAMED in the deny", () => {
  // A real directory and the real git binary — no execGit stub, no mocked walk. (The unreadable-
  // ancestor and spoofed-path arms are the batch-1 test's; this is the env arm, run for real.)
  const real = mkdtempSync(path.join(os.tmpdir(), "trb-s1a-real-"));
  try {
    if (gitSubjectPresent(real, { env: {} })) return; // an ancestor .git above tmpdir — premise unavailable here
    // The walk itself, on the real tree: nothing in view without an override…
    assert.equal(gitSubjectPresent(real, { env: {} }), false,
      "the real walk finds no subject it could ever have read");
    // …and ANY location override resolves to PRESENT before a single filesystem step is taken.
    assert.equal(gitSubjectPresent(real, { env: { GIT_DIR: "/somewhere/else" } }), true,
      "an override means a subject may be selected elsewhere — the walk must not conclude absence");
    assert.equal(gitSubjectPresent(real, { env: { GIT_WORK_TREE: "   " } }), false,
      "a blank override is no override");
    // End to end on the same real directory: with the override the load DENIES (never the blind
    // relief), and the deny NAMES the override it observed, per § 4(c).
    const denied = loadRepairEventsForProject(real, { env: { GIT_DIR: "/somewhere/else" } });
    assert.equal(denied.ok, false);
    assert.equal(denied.state, "repair-ledger-unavailable",
      "an override forces subject-assumed-present — the deny path, not the relief");
    assert.deepEqual(denied.observed_overrides, ["GIT_DIR"],
      "the deny result names the location override that forced the assumption");
    // Polarity: the same real directory with a clean environment earns the blind relief.
    const blind = loadRepairEventsForProject(real, { env: {} });
    assert.equal(blind.ok, false);
    assert.equal(blind.state, "repair-ledger-no-subject",
      "with nothing in view and no override, the control says it is BLIND — not that nothing exists");
    assert.deepEqual(blind.observed_overrides, []);
  } finally { rmSync(real, { recursive: true, force: true }); }
});

// ── R3 accepted findings — the M35–M40 pins ────────────────────────────────────────────────────

// A candidate on its own branch from origin/main touching EXACTLY the named files — staged per
// file, never -A, so rig material (briefs, scratch) can never leak into a candidate's diff.
function sideCandidate(ctx, branch, files) {
  execFileSync("git", ["checkout", "-qb", branch, "origin/main"], { cwd: ctx.dir });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(ctx.dir, rel)), { recursive: true });
    writeFileSync(path.join(ctx.dir, rel), content);
    execFileSync("git", ["add", rel], { cwd: ctx.dir });
  }
  execFileSync("git", ["commit", "-qm", branch], { cwd: ctx.dir });
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
    paths: Object.keys(files).sort(),
  };
}

test("M35: the reservation lift is COVERAGE-SCOPED — a child's GO releases its own budget, never its siblings' surfaces", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // Parent STOPs over {x, y}; the Owner splits the exit: child-a owns x, child-b owns y.
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    const parentCand = commit(ctx.dir, "p35");
    const panel = openPanel(ctx, 1, parentCand);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const closed = closePanel(ctx, panel, parentCand, ["F1"]);
    const stop = decide(ctx, closed, { accepted: ["F1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(stop.ok, true, stop.state);
    const split = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: stop.event_id, trigger_ids: ["F1"],
      continuation_kind: "split", owner_evidence: "Owner split",
      children: [
        { task_id: "child-a", changeset_id: "child-a-cs", tier: "T2", budget: "the x half",
          authorized_paths: ["src/x.mjs"] },
        { task_id: "child-b", changeset_id: "child-b-cs", tier: "T2", budget: "the y half",
          authorized_paths: ["src/y.mjs"] },
      ],
    }, options(ctx.dir));
    assert.equal(split.ok, true, split.state);
    // child-a runs to GO on x only.
    const aCand = sideCandidate(ctx, "a-line", { "src/x.mjs": "export const x = 'a';\n" });
    const aOpen = openPanel(ctx, 1, aCand, { task: "child-a", changeset: "child-a-cs",
      lineage: { continuation: split.event_id } });
    assert.equal(aOpen.opened.ok, true, aOpen.opened.state);
    const aClosed = closePanel(ctx, aOpen, aCand, [], { task: "child-a", changeset: "child-a-cs" });
    assert.equal(aClosed.ok, true, aClosed.state);
    const aGo = decide(ctx, aClosed, { task: "child-a", changeset: "child-a-cs",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(aGo.ok, true, aGo.state);
    assert.equal(derive(ctx, "child-a").terminal, "GO");
    // child-b can still open y through its OWN lineage…
    const bCand = sideCandidate(ctx, "b-line", { "src/y.mjs": "export const y = 'b';\n" });
    const bOpen = openPanel(ctx, 1, bCand, { task: "child-b", changeset: "child-b-cs",
      lineage: { continuation: split.event_id } });
    assert.equal(bOpen.opened.ok, true, `the sibling's own door stays open: ${bOpen.opened.state}`);
    // …and is then virgin-closed (no panel collected: reserves nothing, binds nothing), so every
    // y-probe below reads the PARENT reservation alone — no pending budget, no active binding.
    const bClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "child-b", changeset_id: "child-b-cs",
      disposition_event_id: null, panel_open_event_id: bOpen.opened.event_id,
      reason: "roster unassemblable", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-b"));
    assert.equal(bClose.ok, true, bClose.state);
    // The sibling's never-repaired surface stays reserved…
    const yProbe = sideCandidate(ctx, "y-outsider", { "src/y.mjs": "export const y = 'out';\n" });
    assert.equal(openPanel(ctx, 1, yProbe, { task: "outsider-y", changeset: "outsider-y-cs" }).opened.ok,
      false, "child-a's GO must not release the sibling's y");
    // …while the GO child's own budget is released.
    const xProbe = sideCandidate(ctx, "x-outsider", { "src/x.mjs": "export const x = 'out';\n" });
    assert.equal(openPanel(ctx, 1, xProbe, { task: "outsider-x", changeset: "outsider-x-cs" }).opened.ok,
      true, "the repaired surface IS lifted");
    // Disabled arm: whole-union lift again (one child's GO lifts the parent's ENTIRE stopped
    // set) and the y-open lands — the R3 hole, four independent reproductions.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const plantedY = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "planted-y", changeset_id: "planted-y-cs",
      recorded_at: "2099-01-01T00:00:50.000Z", session_id: "outsider", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: yProbe.commit, frozen_tree: yProbe.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/y.mjs"],
      expected_seats: expectedSeats(["src/y.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, plantedY], "planted-y",
      { standardEvents: loaded.events }).panels_open.length, 0, "replay refuses the y-open too");
    const mutant = await importMutant(mutantDir, [[
      "for (const entry of lineage.authorized_paths) if (repaired.has(entry)) lifted.add(entry);",
      "for (const entry of (program.stopped_paths || [])) lifted.add(entry);",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, plantedY], "planted-y",
      { standardEvents: loaded.events }).panels_open.length, 1,
    "the whole-union lift reproduces the R3 hole: one narrow GO releases the sibling's surface");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M36: the CLOSED trigger floor — the accepted set must be CARRIED, and only accepted ∪ followups are admissible", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["F1", "ADJ"]);
    const decided = decide(ctx, closed, { accepted: ["F1"],
      followup: [{ id: "ADJ", route: "successor:next" }] });
    assert.equal(decided.ok, true, decided.state);
    const ownerClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, reason: "abandoned", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(ownerClose.ok, true, ownerClose.state);
    const window = loadRepairEventsForProject(ctx.dir); // pre-successor rows, for the mutant pair
    const successor = (trigger_ids) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: decided.event_id, trigger_ids,
      continuation_kind: "new_changeset", owner_evidence: "Owner continuation",
      children: [{ task_id: "m36-child", changeset_id: "m36-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    // An empty trigger list must not inherit the exit while shedding the harms…
    const shed = successor([]);
    assert.equal(shed.ok, false);
    assert.equal(shed.state, "aggregate-continuation-conflict",
      "a CLOSED successor cannot carry NOTHING");
    // …an invented id is outside the admissible set…
    assert.equal(successor(["F1", "not-a-real-id"]).ok, false,
      "only accepted ∪ followups are admissible");
    // …and the floor is the ACCEPTED set: a followup alone still sheds the harms.
    assert.equal(successor(["ADJ"]).ok, false, "the accepted set must be carried, not just adjacents");
    const carried = successor(["F1"]);
    assert.equal(carried.ok, true, carried.state);
    // Disabled arm: drop the floor half and the []-trigger continuation rides the exit — plant it
    // with its child's open; the shipped floor refuses both, the mutant accepts both.
    const parentOpenRow = window.aggregate_events.find((row) => row.event.kind === "panel_open").event;
    const plantedShed = stamped({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:01:00.000Z", session_id: "planter",
      parent_disposition_event_id: decided.event_id,
      parent_frozen_commit: parentOpenRow.frozen_commit, parent_frozen_tree: parentOpenRow.frozen_tree,
      trigger_ids: [], continuation_kind: "new_changeset", owner_evidence: "shed the harms",
      children: [{ task_id: "m36-shed", changeset_id: "m36-shed-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    });
    const plantedChildOpen = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "m36-shed", changeset_id: "m36-shed-cs",
      recorded_at: "2099-01-01T00:01:01.000Z", session_id: "planter", round: 1,
      phase: "repair_round", tier: "T2",
      frozen_commit: parentOpenRow.frozen_commit, frozen_tree: parentOpenRow.frozen_tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/x.mjs"],
      expected_seats: expectedSeats(["src/x.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: plantedShed.event_id, legacy_handoff_event_id: null,
    });
    const rows = [...window.aggregate_events, plantedShed, plantedChildOpen];
    assert.equal(deriveAggregateRepairState(rows, "m36-shed", { standardEvents: window.events })
      .panels_open.length, 0, "the shipped floor keeps the harm-shedding exit shut");
    const mutant = await importMutant(mutantDir, [[
      "[...accepted, ...undisposedGround].every((id) => row.trigger_ids.includes(id)) &&",
      "true &&",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState(rows, "m36-shed", { standardEvents: window.events })
      .panels_open.length, 1,
    "without the floor, [] inherits the exit while shedding every accepted harm");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M37: a no-disposition close anchors its successor at the WINNING OPEN — ground carried, one successor per anchor", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closedPanel = closePanel(ctx, panel, candidate, ["G1"]);
    assert.equal(closedPanel.ok, true, closedPanel.state);
    // Collected panel, NO disposition, Owner close citing the winning open: the reserving case
    // whose reservation previously had no constructible exit (T13 demanded a disposition id that
    // does not exist — the R3 finding).
    const ownerClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: null, panel_open_event_id: panel.opened.event_id,
      reason: "abandoned after collection", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(ownerClose.ok, true, ownerClose.state);
    assert.deepEqual(derive(ctx).stopped_paths, ["src/x.mjs"], "the close reserved the ground");
    const successor = (trigger_ids, child) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: null, trigger_ids,
      continuation_kind: "new_changeset", owner_evidence: "Owner successor", children: [child],
    }, options(ctx.dir));
    const heir = { task_id: "heir37", changeset_id: "heir37-cs", tier: "T2",
      budget: "one changeset", authorized_paths: ["src/x.mjs"] };
    // The un-adjudicated GROUND must be carried — the collected panels' raw finding ids.
    const shed = successor([], heir);
    assert.equal(shed.ok, false);
    assert.equal(shed.state, "aggregate-continuation-conflict",
      "an empty trigger list cannot carry the ground");
    const carried = successor(["G1"], heir);
    assert.equal(carried.ok, true, carried.state);
    // ONE successor per anchor — the second refuses even with a NON-overlapping child budget,
    // so nothing but the consumed anchor can be the refuser.
    const second = successor(["G1"], { task_id: "heir37-b", changeset_id: "heir37-b-cs",
      tier: "T2", budget: "another", authorized_paths: ["docs/elsewhere.md"] });
    assert.equal(second.ok, false);
    assert.equal(second.state, "aggregate-continuation-conflict", "one successor per anchor");
    // The child opens the RESERVED path through its lineage — the exit is constructible now.
    const heirCand = sideCandidate(ctx, "heir37-line", { "src/x.mjs": "export const x = 'h';\n" });
    const heirOpen = openPanel(ctx, 1, heirCand, { task: "heir37", changeset: "heir37-cs",
      lineage: { continuation: carried.event_id } });
    assert.equal(heirOpen.opened.ok, true, heirOpen.opened.state);
    // Disabled arm: without the winning-open anchor branch, the recorded continuation and the
    // child's open both evaporate on replay — the reservation is un-exitable again (R3 deadlock).
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState(loaded.aggregate_events, "heir37",
      { standardEvents: loaded.events }).panels_open.length, 1);
    const mutant = await importMutant(mutantDir, [[
      "if (row.parent_disposition_event_id !== null) {",
      "if (true) {",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState(loaded.aggregate_events, "heir37",
      { standardEvents: loaded.events }).panels_open.length, 0,
    "removing the anchor branch re-bricks the reservation: no successor can exist");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M38: close replay stability — a LATE handoff naming the closer's session loses at its own position; close, lineage, child all stand", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"] });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    // Owner close by "owner-z" — not admitted at this position — accepts; the successor lineage
    // builds on it; the child opens the reserved surface.
    const ownerClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, reason: "abandoned", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-z"));
    assert.equal(ownerClose.ok, true, ownerClose.state);
    const cont = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: decided.event_id, trigger_ids: ["F1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "heir38", changeset_id: "heir38-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    assert.equal(cont.ok, true, cont.state);
    const heirCand = sideCandidate(ctx, "heir38-line", { "src/x.mjs": "export const x = 'h8';\n" });
    const heirOpen = openPanel(ctx, 1, heirCand, { task: "heir38", changeset: "heir38-cs",
      lineage: { continuation: cont.event_id } });
    assert.equal(heirOpen.opened.ok, true, heirOpen.opened.state);
    // The state-machine seat's A3 walk, now the STABILITY polarity: a worker_handoff naming
    // "owner-z" lands raw AFTER everything (no recorder would produce it). Forward adjudication:
    // the late row loses at ITS OWN position — it must not retro-refuse the accepted close,
    // resurrect the program, or erase the successor lineage.
    const late = stamped({
      type: "aggregate_v2", kind: "worker_handoff", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:02:00.000Z", session_id: "revisionist",
      dispatch_event_id: authority.dispatch, prior_worker_event_id: authority.worker,
      new_worker_session_id: "owner-z", owner_evidence: "late relabel",
    });
    writeFileSync(repairLedgerPath(ctx.dir), JSON.stringify(late) + "\n", { flag: "a" });
    const parent = derive(ctx);
    assert.equal(parent.terminal, "CLOSED", "the accepted close STANDS");
    assert.equal(parent.closes.length, 1, "exactly the one close row holds");
    assert.equal(parent.worker_handoffs.length, 0, "the late handoff lost at its own position");
    const child = derive(ctx, "heir38");
    assert.equal(child.panels_open.length, 1, "the child's program is untouched");
    assert.equal(child.lineage_event_id, cont.event_id, "…and its lineage still stands");
  } finally { ctx.cleanup(); }
});

test("M39: a PENDING lineage budget binds from declaration to first open — snipes refused, collisions refused at declaration", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // Parent runs to GO. GO carries NO reservation, so between the continuation's declaration
    // and the child's first open, ONLY the pending budget protects src/z.mjs.
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, []);
    assert.equal(closed.ok, true, closed.state);
    const go = decide(ctx, closed, { terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(go.ok, true, go.state);
    const cont = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: go.event_id, trigger_ids: [],
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on",
      children: [{ task_id: "z-child", changeset_id: "z-child-cs", tier: "T2",
        budget: "the z follow-on", authorized_paths: ["src/z.mjs"] }],
    }, options(ctx.dir));
    assert.equal(cont.ok, true, cont.state);
    // BEFORE the child opens: an unrelated program cannot snipe the declared surface…
    const snipe = sideCandidate(ctx, "sniper", { "src/z.mjs": "export const z = 'snipe';\n" });
    assert.equal(openPanel(ctx, 1, snipe, { task: "sniper", changeset: "sniper-cs" }).opened.ok,
      false, "the pending budget holds the surface for the child");
    // …and a SECOND parent cannot declare a COLLIDING pending budget — two pending budgets
    // overlapping would deadlock both children, so the collision refuses at declaration.
    const p2Cand = sideCandidate(ctx, "p2-line", { "docs/p2.md": "p2\n" });
    const p2Open = openPanel(ctx, 1, p2Cand, { task: "task-p2", changeset: "cs-p2" });
    assert.equal(p2Open.opened.ok, true, p2Open.opened.state);
    const p2Closed = closePanel(ctx, p2Open, p2Cand, [], { task: "task-p2", changeset: "cs-p2" });
    const p2Go = decide(ctx, p2Closed, { task: "task-p2", changeset: "cs-p2",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(p2Go.ok, true, p2Go.state);
    const collision = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-p2", changeset_id: "cs-p2",
      parent_disposition_event_id: p2Go.event_id, trigger_ids: [],
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on",
      children: [{ task_id: "z2-child", changeset_id: "z2-child-cs", tier: "T2",
        budget: "colliding", authorized_paths: ["src/z.mjs"] }],
    }, options(ctx.dir));
    assert.equal(collision.ok, false);
    assert.equal(collision.state, "aggregate-continuation-conflict",
      "an overlapping pending budget refuses at declaration, where the deadlock is cheap to stop");
    // The pre-open window, kept for the mutant pair below.
    const window = loadRepairEventsForProject(ctx.dir);
    const plantedSnipe = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "planted-z", changeset_id: "planted-z-cs",
      recorded_at: "2099-01-01T00:03:00.000Z", session_id: "sniper", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: snipe.commit, frozen_tree: snipe.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/z.mjs"],
      expected_seats: expectedSeats(["src/z.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    // The child's own open on z passes — the hold excepts its own lineage…
    const zCand = sideCandidate(ctx, "z-line", { "src/z.mjs": "export const z = 1;\n" });
    const zOpen = openPanel(ctx, 1, zCand, { task: "z-child", changeset: "z-child-cs",
      lineage: { continuation: cont.event_id } });
    assert.equal(zOpen.opened.ok, true, zOpen.opened.state);
    // …and once the child EXISTS, the surface is still refused — now by the child's own binding.
    const snipe2 = sideCandidate(ctx, "sniper-after", { "src/z.mjs": "export const z = 2;\n" });
    assert.equal(openPanel(ctx, 1, snipe2, { task: "sniper-after", changeset: "sniper-after-cs" }).opened.ok,
      false, "after the open the hold has CONVERTED to the child's active binding");
    // Disabled arm, both windows: pre-open, ONLY the pending arm stands between the sniper and
    // the surface — disabling it reproduces the R3 snipe. Post-open, the same disabled arm
    // changes nothing: the hold genuinely converted, it did not linger.
    const finalRows = loadRepairEventsForProject(ctx.dir);
    const plantedAfter = stamped({ ...plantedSnipe.event, task_id: "planted-after",
      changeset_id: "planted-after-cs", frozen_commit: snipe2.commit, frozen_tree: snipe2.tree,
      recorded_at: "2099-01-01T00:03:01.000Z" });
    const mutant = await importMutant(mutantDir, [[
      "lineage.task_id !== exceptTask && !programs.has(lineage.task_id) &&",
      "false &&",
    ]]);
    assert.equal(deriveAggregateRepairState([...window.aggregate_events, plantedSnipe], "planted-z",
      { standardEvents: window.events }).panels_open.length, 0, "the shipped arm refuses the snipe");
    assert.equal(mutant.deriveAggregateRepairState([...window.aggregate_events, plantedSnipe], "planted-z",
      { standardEvents: window.events }).panels_open.length, 1,
    "without the pending arm the pre-open snipe lands — the R3 lockout of the child");
    assert.equal(mutant.deriveAggregateRepairState([...finalRows.aggregate_events, plantedAfter], "planted-after",
      { standardEvents: finalRows.events }).panels_open.length, 0,
    "post-open the refusal is the child's own binding — the pending arm no longer carries it");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M40: an ACTIVE program binds its authorized set PLUS any undisposed open — and EXACTLY the authorized set before one opens", async () => {
  // Fixture A: r2's panel is OPEN (undisposed) over {x, y} while the authorized set is [x] —
  // an unrelated open on y must refuse, or a concurrent program wedges the live program out of
  // remediating its own reviewed surface (the executed R3 finding).
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    const cand1 = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, cand1);
    const closed = closePanel(ctx, panel, cand1, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"], authorized_paths: ["src/x.mjs"] });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 2;\n");
    const cand2 = commit(ctx.dir, 2);
    const p2 = openPanel(ctx, 2, cand2, { incoming: authority });
    assert.equal(p2.opened.ok, true, p2.opened.state);
    const yCand = sideCandidate(ctx, "wedge-y", { "src/y.mjs": "export const y = 'w';\n" });
    assert.equal(openPanel(ctx, 1, yCand, { task: "task-p2", changeset: "cs-p2" }).opened.ok,
      false, "a mid-review surface cannot be wedged away from the program reviewing it");
    // Disabled arm: bind only the authorized set (the pre-R3 form) and the wedge lands.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const plantedWedge = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "planted-p2", changeset_id: "planted-p2-cs",
      recorded_at: "2099-01-01T00:04:00.000Z", session_id: "wedge", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: yCand.commit, frozen_tree: yCand.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/y.mjs"],
      expected_seats: expectedSeats(["src/y.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, plantedWedge], "planted-p2",
      { standardEvents: loaded.events }).panels_open.length, 0, "the union arm refuses the wedge");
    const mutant = await importMutant(mutantDir, [[
      "if (program.active) return [...new Set([...program.authorized_paths, ...undisposed])];",
      "if (program.active) return program.authorized_paths;",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, plantedWedge], "planted-p2",
      { standardEvents: loaded.events }).panels_open.length, 1,
    "binding only the authorized set reproduces the R3 wedge");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
  // Fixture B: the SAME walk stopped at the CONTINUE + dispatch, r2 never opened — the bound is
  // exactly the authorized set, so the unrelated y-open ACCEPTS. The polarity that keeps the
  // union from quietly becoming a whole-repo freeze.
  const ctxB = repo();
  try {
    writeFileSync(path.join(ctxB.dir, "src", "y.mjs"), "export const y = 1;\n");
    const cand1 = commit(ctxB.dir, 1);
    const panel = openPanel(ctxB, 1, cand1);
    const closed = closePanel(ctxB, panel, cand1, ["F1"]);
    const decided = decide(ctxB, closed, { accepted: ["F1"], authorized_paths: ["src/x.mjs"] });
    assert.equal(decided.ok, true, decided.state);
    dispatchBatch(ctxB, decided.event_id, closed.event_id, 2);
    const yCand = sideCandidate(ctxB, "free-y", { "src/y.mjs": "export const y = 'f';\n" });
    const free = openPanel(ctxB, 1, yCand, { task: "task-p2", changeset: "cs-p2" });
    assert.equal(free.opened.ok, true,
      `before a panel opens, the bound is exactly the authorized set: ${free.opened.state}`);
  } finally { ctxB.cleanup(); }
});

// ── terminal-round-breaker-2 · R4 accepted findings — the M41–M47 pins ─────────────────────────

test("M41: the lift is budget ∩ OPENED COVERAGE — a wide budget is a plan, not a repair", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // Parent STOPs over {x, y}; ONE child declares the WHOLE budget {x, y} but opens only x.
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    const parentCand = commit(ctx.dir, "p41");
    const panel = openPanel(ctx, 1, parentCand);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const closed = closePanel(ctx, panel, parentCand, ["F1"]);
    const stop = decide(ctx, closed, { accepted: ["F1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(stop.ok, true, stop.state);
    const cont = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: stop.event_id, trigger_ids: ["F1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "c41", changeset_id: "c41-cs", tier: "T2", budget: "wide plan",
        authorized_paths: ["src/x.mjs", "src/y.mjs"] }],
    }, options(ctx.dir));
    assert.equal(cont.ok, true, cont.state);
    const cCand = sideCandidate(ctx, "c41-line", { "src/x.mjs": "export const x = 'c41';\n" });
    const cOpen = openPanel(ctx, 1, cCand, { task: "c41", changeset: "c41-cs",
      lineage: { continuation: cont.event_id } });
    assert.equal(cOpen.opened.ok, true, cOpen.opened.state);
    const cClosed = closePanel(ctx, cOpen, cCand, [], { task: "c41", changeset: "c41-cs" });
    const cGo = decide(ctx, cClosed, { task: "c41", changeset: "c41-cs",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(cGo.ok, true, cGo.state);
    assert.equal(derive(ctx, "c41").terminal, "GO");
    // The never-REVIEWED budget remainder stays reserved…
    const yProbe = sideCandidate(ctx, "m41-y", { "src/y.mjs": "export const y = 'out';\n" });
    assert.equal(openPanel(ctx, 1, yProbe, { task: "m41-out-y", changeset: "m41-out-y-cs" }).opened.ok,
      false, "the GO lifted only what the child's panels actually reviewed — never the plan");
    // …while the reviewed slice is released.
    const xProbe = sideCandidate(ctx, "m41-x", { "src/x.mjs": "export const x = 'out';\n" });
    assert.equal(openPanel(ctx, 1, xProbe, { task: "m41-out-x", changeset: "m41-out-x-cs" }).opened.ok,
      true, "the reviewed slice IS lifted");
    // Disabled arm: lift the whole declared budget without the repaired.has filter — the R4
    // wide-budget gap: a child declared wide, opened narrow, and its GO released never-reviewed
    // reserved surface.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const plantedY = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "m41-planted", changeset_id: "m41-planted-cs",
      recorded_at: "2099-01-01T00:05:00.000Z", session_id: "outsider", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: yProbe.commit, frozen_tree: yProbe.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/y.mjs"],
      expected_seats: expectedSeats(["src/y.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, plantedY], "m41-planted",
      { standardEvents: loaded.events }).panels_open.length, 0, "replay refuses the y-open too");
    const mutant = await importMutant(mutantDir, [[
      "for (const entry of lineage.authorized_paths) if (repaired.has(entry)) lifted.add(entry);",
      "for (const entry of lineage.authorized_paths) lifted.add(entry);",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, plantedY], "m41-planted",
      { standardEvents: loaded.events }).panels_open.length, 1,
    "lifting the un-reviewed budget remainder reproduces the R4 gap");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M42: the reservation exception walks the FULL ancestor chain — a grandchild is not locked out by its grandparent", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // P STOPs on x → child C opens x, collects ground, is Owner-closed via its winning open
    // (C now reserves x too) → C's continuation seeds grandchild G on the same slice.
    const pCand = commit(ctx.dir, 1);
    const pPanel = openPanel(ctx, 1, pCand);
    const pClosed = closePanel(ctx, pPanel, pCand, ["P1"]);
    const pStop = decide(ctx, pClosed, { accepted: ["P1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(pStop.ok, true, pStop.state);
    const contPC = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: pStop.event_id, trigger_ids: ["P1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "c42", changeset_id: "c42-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    assert.equal(contPC.ok, true, contPC.state);
    const cCand = sideCandidate(ctx, "c42-line", { "src/x.mjs": "export const x = 'c42';\n" });
    const cOpen = openPanel(ctx, 1, cCand, { task: "c42", changeset: "c42-cs",
      lineage: { continuation: contPC.event_id } });
    assert.equal(cOpen.opened.ok, true, cOpen.opened.state);
    const cClosed = closePanel(ctx, cOpen, cCand, ["C1"], { task: "c42", changeset: "c42-cs" });
    assert.equal(cClosed.ok, true, cClosed.state);
    const cClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "c42", changeset_id: "c42-cs",
      disposition_event_id: null, panel_open_event_id: cOpen.opened.event_id,
      reason: "abandoned after collection", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(cClose.ok, true, cClose.state);
    const contCG = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "c42", changeset_id: "c42-cs",
      parent_disposition_event_id: null, trigger_ids: ["C1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "g42", changeset_id: "g42-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    assert.equal(contCG.ok, true, contCG.state);
    // G's open on x ACCEPTS — the exception excepts BOTH C (parent) and P (grandparent).
    const gCand = sideCandidate(ctx, "g42-line", { "src/x.mjs": "export const x = 'g42';\n" });
    const gOpen = openPanel(ctx, 1, gCand, { task: "g42", changeset: "g42-cs",
      lineage: { continuation: contCG.event_id } });
    assert.equal(gOpen.opened.ok, true,
      `the grandchild works its whole ancestor chain's slice: ${gOpen.opened.state}`);
    // Control: an UNRELATED program's open on x still refuses — the chain is an exception for
    // descendants, not a release.
    const outCand = sideCandidate(ctx, "m42-out", { "src/x.mjs": "export const x = 'out';\n" });
    assert.equal(openPanel(ctx, 1, outCand, { task: "m42-out", changeset: "m42-out-cs" }).opened.ok,
      false, "outside the lineage, x stays reserved");
    // Disabled arm: except only the DIRECT parent (drop the while-walk) and G's recorded open
    // evaporates on replay — the R4 nested lockout, the exit lattice one-shot again.
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState(loaded.aggregate_events, "g42",
      { standardEvents: loaded.events }).panels_open.length, 1);
    const mutant = await importMutant(mutantDir, [[
      "    while (current !== null && !ancestors.has(current)) {\n      ancestors.add(current);\n      current = childLineage.get(current)?.parent_task_id ?? null;\n    }",
      "    if (current !== null) ancestors.add(current);",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState(loaded.aggregate_events, "g42",
      { standardEvents: loaded.events }).panels_open.length, 0,
    "excepting only the direct parent re-bricks the grandchild on the grandparent's reservation");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M43: ONE LIVE continuation per anchor — a stranded virgin child reopens the anchor; a GO child does not", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const pCand = commit(ctx.dir, 1);
    const pPanel = openPanel(ctx, 1, pCand);
    const pClosed = closePanel(ctx, pPanel, pCand, ["F1"]);
    const pStop = decide(ctx, pClosed, { accepted: ["F1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(pStop.ok, true, pStop.state);
    const successor = (task, paths) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: pStop.event_id, trigger_ids: ["F1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: task, changeset_id: `${task}-cs`, tier: "T2", budget: "one changeset",
        authorized_paths: paths }],
    }, options(ctx.dir));
    const first = successor("c43a", ["src/x.mjs"]);
    assert.equal(first.ok, true, first.state);
    // While the declared child is PENDING (no program yet), a second continuation refuses — the
    // disjoint budget leaves the standing-anchor rule as the only possible refuser.
    const whilePending = successor("c43b", ["docs/m43.md"]);
    assert.equal(whilePending.ok, false);
    assert.equal(whilePending.state, "aggregate-continuation-conflict",
      "a standing continuation with a pending child blocks a second declaration");
    // While the child is OPEN and non-terminal: still refused.
    const cCand = sideCandidate(ctx, "c43a-line", { "src/x.mjs": "export const x = 'c43';\n" });
    const cOpen = openPanel(ctx, 1, cCand, { task: "c43a", changeset: "c43a-cs",
      lineage: { continuation: first.event_id } });
    assert.equal(cOpen.opened.ok, true, cOpen.opened.state);
    assert.equal(successor("c43b", ["docs/m43.md"]).ok, false,
      "a live, non-terminal child still holds the anchor");
    // The child VIRGIN-closes — opened, collected nothing, closed. Its slice of the parent's
    // reservation would be stranded forever; the anchor REOPENS for a fresh child identity.
    const cClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "c43a", changeset_id: "c43a-cs",
      disposition_event_id: null, panel_open_event_id: cOpen.opened.event_id,
      reason: "roster unassemblable", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(cClose.ok, true, cClose.state);
    const reopened = successor("c43c", ["src/x.mjs"]);
    assert.equal(reopened.ok, true,
      `a stranded slice is re-declarable with a fresh child identity: ${reopened.state}`);
    // Anti-spam polarity, separate parent: when the only child ran to GO nothing is stranded —
    // the second continuation refuses.
    const wCand = sideCandidate(ctx, "p43g-line", { "docs/w43.md": "w43\n" });
    const wPanel = openPanel(ctx, 1, wCand, { task: "p43g", changeset: "cs-p43g" });
    assert.equal(wPanel.opened.ok, true, wPanel.opened.state);
    const wClosed = closePanel(ctx, wPanel, wCand, ["G1"], { task: "p43g", changeset: "cs-p43g" });
    const wStop = decide(ctx, wClosed, { task: "p43g", changeset: "cs-p43g", accepted: ["G1"],
      terminal_state: "STOP", remediation_kind: null, authorized_paths: [] });
    assert.equal(wStop.ok, true, wStop.state);
    const goSuccessor = (task, paths) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "p43g", changeset_id: "cs-p43g",
      parent_disposition_event_id: wStop.event_id, trigger_ids: ["G1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: task, changeset_id: `${task}-cs`, tier: "T2", budget: "one changeset",
        authorized_paths: paths }],
    }, options(ctx.dir));
    const goCont = goSuccessor("c43g", ["docs/w43.md"]);
    assert.equal(goCont.ok, true, goCont.state);
    const gCand = sideCandidate(ctx, "c43g-line", { "docs/w43.md": "repaired\n" });
    const gOpen = openPanel(ctx, 1, gCand, { task: "c43g", changeset: "c43g-cs",
      lineage: { continuation: goCont.event_id } });
    assert.equal(gOpen.opened.ok, true, gOpen.opened.state);
    const gClosed = closePanel(ctx, gOpen, gCand, [], { task: "c43g", changeset: "c43g-cs" });
    const gGo = decide(ctx, gClosed, { task: "c43g", changeset: "c43g-cs",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(gGo.ok, true, gGo.state);
    const antiSpam = goSuccessor("c43h", ["docs/m43b.md"]);
    assert.equal(antiSpam.ok, false);
    assert.equal(antiSpam.state, "aggregate-continuation-conflict",
      "a GO child strands nothing — its anchor stays consumed");
    // Disabled arm: revert to one-EVER (anchorConsumed always true for a standing continuation)
    // and the accepted re-continuation evaporates on replay — the R4 stranded-slice brick.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const pendingReal = derivePendingLineageBudgets(loaded.aggregate_events,
      { standardEvents: loaded.events });
    assert.ok(pendingReal.some((entry) => entry.task_id === "c43c"),
      "the re-declared child holds its pending budget");
    const mutant = await importMutant(mutantDir, [[
      "        return !(allTerminal && (anyVirgin || remainder));",
      "        return true;",
    ]]);
    const pendingMutant = mutant.derivePendingLineageBudgets(loaded.aggregate_events,
      { standardEvents: loaded.events });
    assert.ok(!pendingMutant.some((entry) => entry.task_id === "c43c"),
      "one-ever anchors re-brick the stranded slice: the re-continuation is refused on replay");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M44: pending-vs-active refuses AT DECLARATION — continuation and legacy handoff alike — and the pending hold is NAMED in the deny", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // Program task-1 is ACTIVE on x.
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel, candidate, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"], authorized_paths: ["src/x.mjs"] });
    assert.equal(decided.ok, true, decided.state);
    dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    // An unrelated parent runs to GO on its own surface.
    const pCand = sideCandidate(ctx, "p44-line", { "docs/p44.md": "p44\n" });
    const pPanel = openPanel(ctx, 1, pCand, { task: "p44", changeset: "cs-p44" });
    assert.equal(pPanel.opened.ok, true, pPanel.opened.state);
    const pClosed = closePanel(ctx, pPanel, pCand, [], { task: "p44", changeset: "cs-p44" });
    const pGo = decide(ctx, pClosed, { task: "p44", changeset: "cs-p44",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(pGo.ok, true, pGo.state);
    const window = loadRepairEventsForProject(ctx.dir); // anchor still free, for the mutant pair
    const declare = (task, paths) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "p44", changeset_id: "cs-p44",
      parent_disposition_event_id: pGo.event_id, trigger_ids: [],
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on",
      children: [{ task_id: task, changeset_id: `${task}-cs`, tier: "T2", budget: "one changeset",
        authorized_paths: paths }],
    }, options(ctx.dir));
    // A pending budget over a LIVE program's bound surface would wedge the victim — refused at
    // declaration, where the mutual brick is cheap to stop…
    const wedge = declare("c44x", ["src/x.mjs"]);
    assert.equal(wedge.ok, false);
    assert.equal(wedge.state, "aggregate-continuation-conflict",
      "a child budget over an active program's surface refuses at declaration");
    // Disabled arm: drop the declaration-time active check and the wedge declaration lands.
    const p44Open = derive(ctx, "p44").panels_open.at(-1);
    const plantedWedge = stamped({
      type: "aggregate_v2", kind: "child_continuation", task_id: "p44", changeset_id: "cs-p44",
      recorded_at: "2099-01-01T00:06:00.000Z", session_id: "planter",
      parent_disposition_event_id: pGo.event_id,
      parent_frozen_commit: p44Open.frozen_commit, parent_frozen_tree: p44Open.frozen_tree,
      trigger_ids: [], continuation_kind: "new_changeset", owner_evidence: "wedge",
      children: [{ task_id: "c44x", changeset_id: "c44x-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }],
    });
    const wedgeRows = [...window.aggregate_events, plantedWedge];
    assert.ok(!derivePendingLineageBudgets(wedgeRows, { standardEvents: window.events })
      .some((entry) => entry.task_id === "c44x"), "the shipped check keeps the wedge out");
    const mutant = await importMutant(mutantDir, [[
      "          row.children.some((child) => activePathOverlap(child.authorized_paths, row.task_id, rowSeq)) ||",
      "          false ||",
    ]]);
    assert.ok(mutant.derivePendingLineageBudgets(wedgeRows, { standardEvents: window.events })
      .some((entry) => entry.task_id === "c44x"),
    "without the declaration-time check the wedge lands — the R4 mutual brick");
    // …while a DISJOINT budget declares freely.
    const disjoint = declare("c44d", ["docs/c44.md"]);
    assert.equal(disjoint.ok, true, disjoint.state);
    // THE DIAGNOSIS: an open refused by the pending hold names the holder and its parent.
    const probeCand = sideCandidate(ctx, "c44-probe", { "docs/c44.md": "probe\n" });
    const refused = openPanel(ctx, 1, probeCand, { task: "m44-victim", changeset: "m44-victim-cs" });
    assert.equal(refused.opened.ok, false);
    assert.equal(refused.opened.state, "aggregate-panel-open-conflict");
    assert.match(refused.opened.detail ?? "", /c44d/, "the deny names the pending child");
    assert.match(refused.opened.detail ?? "", /p44/, "…and the parent whose lineage holds it");
    // The SAME pending-vs-active check on the legacy_handoff child (LE2-style standard fixture):
    // a handoff whose child budget covers the active program's x refuses; a disjoint one lands.
    const manifest = fingerprintCandidate(ctx.dir, ["src/x.mjs"]);
    const standardRow = (task, cs, authorized, at) => stamped({
      type: "round_disposition", task_id: task, changeset_id: cs, round: 1,
      candidate_sha: manifest.digest, candidate_manifest: manifest.records, verdict: "NO-GO",
      disposition: "REMEDIATE", finding_ids: [`${task}-L1`], finding_class: "class-a",
      ownership_area: "controller", original_trigger: "legacy trigger",
      authorized_paths: authorized, introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null,
      recorded_at: at, session_id: "legacy-s",
    });
    const legacyX = standardRow("legacy-x", "legacy-x-cs", ["src/x.mjs"], "2099-01-01T00:06:10.000Z");
    const legacyD = standardRow("legacy-d", "legacy-d-cs", ["docs/l44.md"], "2099-01-01T00:06:11.000Z");
    writeFileSync(repairLedgerPath(ctx.dir),
      [legacyX, legacyD].map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "a" });
    const handoff = (parent, cs, paths, child) => recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: parent, changeset_id: cs,
      parent_task_id: parent, parent_changeset_id: cs, parent_candidate_sha: manifest.digest,
      authorized_paths: paths, owner_evidence: "Owner handoff",
      child: { task_id: child, changeset_id: `${child}-cs`, tier: "T2", budget: "one changeset",
        authorized_paths: paths },
    }, options(ctx.dir));
    const legacyWedge = handoff("legacy-x", "legacy-x-cs", ["src/x.mjs"], "lh44x");
    assert.equal(legacyWedge.ok, false);
    assert.equal(legacyWedge.state, "aggregate-legacy-handoff-conflict",
      "a handoff child budget over an active program's surface refuses at declaration too");
    const legacyOk = handoff("legacy-d", "legacy-d-cs", ["docs/l44.md"], "lh44d");
    assert.equal(legacyOk.ok, true, legacyOk.state);
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M45: the CLOSED floor carries the UNDISPOSED GROUND — collected-but-unadjudicated harms ride the lineage", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // r1 CONTINUE accepts H1; r2 collects NEW ground H9 that is never adjudicated; the Owner
    // closes citing the r1 disposition (the latest — r2 never got one).
    const cand1 = commit(ctx.dir, 1);
    const p1 = openPanel(ctx, 1, cand1);
    const c1 = closePanel(ctx, p1, cand1, ["H1"]);
    const d1 = decide(ctx, c1, { accepted: ["H1"] });
    assert.equal(d1.ok, true, d1.state);
    const authority = dispatchBatch(ctx, d1.event_id, c1.event_id, 2);
    const cand2 = commit(ctx.dir, 2);
    const p2 = openPanel(ctx, 2, cand2, { incoming: authority });
    assert.equal(p2.opened.ok, true, p2.opened.state);
    const c2 = closePanel(ctx, p2, cand2, ["H9"]);
    assert.equal(c2.ok, true, c2.state);
    const ownerClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: d1.event_id, reason: "abandoned mid-r2", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(ownerClose.ok, true, ownerClose.state);
    const window = loadRepairEventsForProject(ctx.dir); // pre-successor rows, for the mutant pair
    const successor = (trigger_ids) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: d1.event_id, trigger_ids,
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "c45", changeset_id: "c45-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    // Carrying only the ACCEPTED set sheds the r2 ground…
    const shed = successor(["H1"]);
    assert.equal(shed.ok, false);
    assert.equal(shed.state, "aggregate-continuation-conflict",
      "the successor must not shed the collected-but-undisposed H9");
    // …an invented id stays inadmissible…
    assert.equal(successor(["H1", "H9", "unknown"]).ok, false,
      "only accepted ∪ followups ∪ undisposed ground are admissible");
    // …and accepted + ground lands.
    const carried = successor(["H1", "H9"]);
    assert.equal(carried.ok, true, carried.state);
    // Disabled arm (the ground half — M36 pins the accepted half): strip undisposedGround from
    // the floor and the H1-only successor lands with its child, shedding H9 — the R4 shed.
    const r2Open = derive(ctx).panels_open.at(-1);
    const plantedShed = stamped({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:07:00.000Z", session_id: "planter",
      parent_disposition_event_id: d1.event_id,
      parent_frozen_commit: r2Open.frozen_commit, parent_frozen_tree: r2Open.frozen_tree,
      trigger_ids: ["H1"], continuation_kind: "new_changeset", owner_evidence: "shed the ground",
      children: [{ task_id: "c45-shed", changeset_id: "c45-shed-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    });
    const plantedChildOpen = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "c45-shed", changeset_id: "c45-shed-cs",
      recorded_at: "2099-01-01T00:07:01.000Z", session_id: "planter", round: 1,
      phase: "repair_round", tier: "T2",
      frozen_commit: r2Open.frozen_commit, frozen_tree: r2Open.frozen_tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["src/x.mjs"],
      expected_seats: expectedSeats(["src/x.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: plantedShed.event_id, legacy_handoff_event_id: null,
    });
    const rows = [...window.aggregate_events, plantedShed, plantedChildOpen];
    assert.equal(deriveAggregateRepairState(rows, "c45-shed", { standardEvents: window.events })
      .panels_open.length, 0, "the shipped floor refuses the ground-shedding successor");
    const mutant = await importMutant(mutantDir, [[
      "[...accepted, ...undisposedGround].every((id) => row.trigger_ids.includes(id)) &&",
      "[...accepted].every((id) => row.trigger_ids.includes(id)) &&",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState(rows, "c45-shed", { standardEvents: window.events })
      .panels_open.length, 1,
    "without the ground half of the floor, the H1-only successor sheds H9 — the R4 shed");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M46: legacy activeness binds AS-OF — an inactive-parent handoff is inert, and a post-handoff close cannot unmake lineage", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const candidate = commit(ctx.dir, 1);
    const manifest = fingerprintCandidate(ctx.dir, ["src/x.mjs"]);
    const standardRow = (task, cs, disposition, authorized, at) => stamped({
      type: "round_disposition", task_id: task, changeset_id: cs, round: 1,
      candidate_sha: manifest.digest, candidate_manifest: manifest.records, verdict: "NO-GO",
      disposition, finding_ids: [`${task}-L1`], finding_class: "class-a",
      ownership_area: "controller", original_trigger: "legacy trigger",
      authorized_paths: authorized, introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null,
      recorded_at: at, session_id: "legacy-s",
    });
    // A DEFER-dispositioned parent authorizes no repair — it is INACTIVE. A REMEDIATE parent is
    // active. Same shape, one field apart. DISJOINT surfaces, so the inactive parent's probes
    // read the ACTIVENESS bind alone (an overlapping active parent would shadow the mutant).
    const deferRow = standardRow("leg46-defer", "leg46-defer-cs", "DEFER",
      ["docs/leg46.md"], "2099-01-01T00:08:00.000Z");
    const activeRow = standardRow("leg46b", "leg46b-cs", "REMEDIATE",
      ["src/x.mjs"], "2099-01-01T00:08:01.000Z");
    const ledger = repairLedgerPath(ctx.dir);
    mkdirSync(path.dirname(ledger), { recursive: true });
    writeFileSync(ledger, [deferRow, activeRow].map((row) => JSON.stringify(row)).join("\n") + "\n",
      { flag: "a" });
    // The record path refuses the inactive parent outright…
    const recordRefusal = recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "leg46-defer", changeset_id: "leg46-defer-cs",
      parent_task_id: "leg46-defer", parent_changeset_id: "leg46-defer-cs",
      parent_candidate_sha: manifest.digest, authorized_paths: ["docs/leg46.md"],
      owner_evidence: "Owner handoff",
      child: { task_id: "h46d", changeset_id: "h46d-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["docs/leg46.md"] },
    }, options(ctx.dir));
    assert.equal(recordRefusal.ok, false);
    assert.equal(recordRefusal.state, "aggregate-legacy-handoff-malformed",
      "the recorder refuses an inactive parent");
    // …and a PLANTED hash-valid handoff citing the inactive parent is INERT on replay: its child
    // cannot open through it.
    const loaded = loadRepairEventsForProject(ctx.dir);
    const plantedHandoff = stamped({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "leg46-defer", changeset_id: "leg46-defer-cs",
      recorded_at: "2099-01-01T00:08:02.000Z", session_id: "planter",
      parent_task_id: "leg46-defer", parent_changeset_id: "leg46-defer-cs",
      parent_disposition_event_id: deferRow.event_id, parent_round: 1,
      parent_candidate_sha: manifest.digest, authorized_paths: ["docs/leg46.md"],
      owner_evidence: "planted",
      child: { task_id: "h46d", changeset_id: "h46d-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["docs/leg46.md"] },
    });
    const plantedChildOpen = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "h46d", changeset_id: "h46d-cs",
      recorded_at: "2099-01-01T00:08:03.000Z", session_id: "planter", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: candidate.commit, frozen_tree: candidate.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: ["docs/leg46.md"],
      expected_seats: expectedSeats(["docs/leg46.md"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: plantedHandoff.event_id,
    });
    const inertRows = [...loaded.aggregate_events, plantedHandoff, plantedChildOpen];
    assert.equal(deriveAggregateRepairState(inertRows, "h46d", { standardEvents: loaded.events })
      .panels_open.length, 0, "a handoff citing an inactive parent mints NO lineage on replay");
    // Disabled arm: drop the activeness check and the planted inactive-parent handoff mints the
    // child — the R4 fail-open.
    const mutant = await importMutant(mutantDir, [[
      "if (!standard?.ok || !standard.active || standard.changeset_id !== row.parent_changeset_id ||",
      "if (!standard?.ok || standard.changeset_id !== row.parent_changeset_id ||",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState(inertRows, "h46d", { standardEvents: loaded.events })
      .panels_open.length, 1, "without the activeness bind the planted handoff mints lineage");
    // The SAME handoff against the ACTIVE parent records…
    const recorded = recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "leg46b", changeset_id: "leg46b-cs",
      parent_task_id: "leg46b", parent_changeset_id: "leg46b-cs",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      owner_evidence: "Owner handoff",
      child: { task_id: "h46", changeset_id: "h46-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] },
    }, options(ctx.dir));
    assert.equal(recorded.ok, true, recorded.state);
    // …and a LATER standard close of the parent does not unmake it (the close is after the
    // handoff's seq): the child still opens through the lineage.
    const extension = recordOwnerExtension({ task_id: "leg46b", changeset_id: "leg46b-cs",
      after_round: 1, authority_kind: "close", owner_evidence: "Owner close authority" },
    options(ctx.dir, "owner-46"));
    assert.equal(extension.ok, true, extension.state);
    const stdClose = recordRepairClose({ task_id: "leg46b", changeset_id: "leg46b-cs",
      after_round: 1, reason: "parent emptied by handoff",
      owner_close_event_id: extension.event_id }, options(ctx.dir, "owner-46"));
    assert.equal(stdClose.ok, true, stdClose.state);
    const after = loadRepairEventsForProject(ctx.dir);
    const parentEnd = deriveRepairState(after.events, "leg46b");
    assert.equal(parentEnd.active, false,
      "the standard close LANDED — the parent is inactive at the ledger's end");
    assert.ok(parentEnd.close, "…via the recorded eligible close");
    const childCand = commit(ctx.dir, 2);
    const childOpen = openPanel(ctx, 1, childCand, { task: "h46", changeset: "h46-cs",
      lineage: { handoff: recorded.event_id } });
    assert.equal(childOpen.opened.ok, true,
      `as-of stability: the pre-close handoff still carries the lineage: ${childOpen.opened.state}`);
    assert.equal(derive(ctx, "h46").lineage_event_id, recorded.event_id);
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M47: the trigger cap is the exact-carry bound — a 101-id ground ACCEPTS, 1201 ids refuse on shape", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    // A ground of 101 ids across TWO seats (one seat may carry at most 100): the old 100-id
    // trigger cap made the winning-open exit SHAPE-impossible for this grammar-legal ground —
    // the R4 corner.
    const many = Array.from({ length: 100 }, (_, index) => `W1-${index}`);
    const ground = [...many, "W2-100"];
    const received = receivedSeats(panel.expected, candidate).map((seat) => seat.seat_id === "a"
      ? { ...seat, verdict: "NO-GO", raw_finding_ids: many }
      : seat.seat_id === "b" ? { ...seat, verdict: "NO-GO", raw_finding_ids: ["W2-100"] } : seat);
    const closed = recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
      panel_open_event_id: panel.opened.event_id, received_seats: received,
    }, options(ctx.dir));
    assert.equal(closed.ok, true, closed.state);
    const ownerClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: null, panel_open_event_id: panel.opened.event_id,
      reason: "abandoned after collection", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(ownerClose.ok, true, ownerClose.state);
    const successor = (trigger_ids) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: null, trigger_ids,
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "c47", changeset_id: "c47-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    // 2601 unique ids exceed the exact-carry bound (the 1300-id disposition universe plus a
    // 1300-id undisposed-ground universe, the CLOSED-floor union) — refused on SHAPE, under the
    // ONE unified malformed spelling. 1201 now ACCEPTS: the R1 panel executed a 1300-id
    // mandatory carry against the old 1200 cap.
    const over = successor(Array.from({ length: 2601 }, (_, index) => `Z-${index}`));
    assert.equal(over.ok, false);
    assert.equal(over.state, "aggregate-continuation-malformed",
      "beyond the exact-carry bound is a shape refusal — and the derived name is the unified one");
    // The exact 101-id ground carries.
    const carried = successor(ground);
    assert.equal(carried.ok, true,
      `a grammar-legal ground is never shape-impossible to carry: ${carried.state}`);
  } finally { ctx.cleanup(); }
});

// ── batch 4 · the R1/R4 accepted findings the shipped code now carries ─────────────────────────

test("M48: THE CROSS-ROUND BASE PIN — every later round re-derives from ROUND 1's base, and a refreeze may not move it", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // R1 reviews a candidate touching BOTH x and y, accepts F1, and dispatches the y repair.
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    const r1 = commit(ctx.dir, "p48");
    assert.deepEqual(r1.paths, ["src/x.mjs", "src/y.mjs"]);
    const panel = openPanel(ctx, 1, r1);
    assert.equal(panel.opened.ok, true, panel.opened.state);
    const closed = closePanel(ctx, panel, r1, ["F1"]);
    assert.equal(closed.ok, true, closed.state);
    const decided = decide(ctx, closed, { accepted: ["F1"], authorized_paths: ["src/y.mjs"] });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);

    // The worker repairs y on top of the R1 freeze. TWO honest-looking declarations of the SAME
    // round-2 candidate exist: from R1's own base (the whole candidate: x AND y), or from R1's
    // FROZEN COMMIT as the new base (the delta only: y). The second is the "review only what
    // changed since last round" mistake — and the GO it earns, plus the coverage-scoped lift,
    // would certify x, which no round-2 seat ever read.
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 2;\n");
    execFileSync("git", ["add", "src/y.mjs"], { cwd: ctx.dir }); // NOT -A: the brief stays untracked
    execFileSync("git", ["commit", "-qm", "r2-repair"], { cwd: ctx.dir });
    const r2 = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
    };
    // A real ref at the R1 freeze, so the moved-base declaration is fully WELL-FORMED: its
    // evidence capture succeeds and its roster matches the delta it derives. Only the pin refuses.
    execFileSync("git", ["update-ref", "refs/remotes/origin/r1line", r1.commit], { cwd: ctx.dir });
    const deltaOnly = { commit: r2.commit, tree: r2.tree, paths: ["src/y.mjs"] };
    const wholeCandidate = { commit: r2.commit, tree: r2.tree, paths: ["src/x.mjs", "src/y.mjs"] };
    const moved = openPanel(ctx, 2, deltaOnly, { incoming: { dispatch: authority.dispatch,
      worker: authority.worker }, baseRef: "origin/r1line", baseCommit: r1.commit });
    assert.equal(moved.opened.ok, false, "a round-2 panel may not re-base onto round 1's freeze");
    assert.equal(moved.opened.state, "aggregate-panel-open-conflict");

    // The disabled arm needs the ledger AS OF THE REFUSAL — the refused row never appended, and
    // the accepted pinned open below would mask the mutant's own round-2 acceptance.
    const window = loadRepairEventsForProject(ctx.dir);
    const plantedDelta = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "task-1", changeset_id: "cs-1",
      recorded_at: "2099-01-01T00:07:00.000Z", session_id: "orchestrator", round: 2,
      phase: "repair_round", tier: "T2", frozen_commit: r2.commit, frozen_tree: r2.tree,
      base_ref: "origin/r1line", base_commit: r1.commit, changed_paths: ["src/y.mjs"],
      expected_seats: expectedSeats(["src/y.mjs"]),
      incoming_dispatch_event_id: authority.dispatch, incoming_worker_event_id: authority.worker,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    });
    const deltaRows = [...window.aggregate_events, plantedDelta];
    assert.equal(deriveAggregateRepairState(deltaRows, "task-1",
      { standardEvents: window.events }).panels_open.length, 1,
    "replay refuses the moved-base round-2 open too — the pin is not a record-time courtesy");

    // …and the SAME candidate declared from round 1's exact base_ref + base_commit ACCEPTS, at
    // the full x+y scope round 1 reviewed.
    const pinned = openPanel(ctx, 2, wholeCandidate, { incoming: { dispatch: authority.dispatch,
      worker: authority.worker } });
    assert.equal(pinned.opened.ok, true,
      `the pinned base is the accepting polarity: ${pinned.opened.state}`);
    const afterPinned = derive(ctx);
    assert.equal(afterPinned.panels_open.length, 2);
    assert.deepEqual(afterPinned.panels_open.at(-1).changed_paths, ["src/x.mjs", "src/y.mjs"],
      "round 2 re-derives the WHOLE candidate from round 1's base — never the last delta");

    // ── the refreeze polarity: a same-round supersede may not move the base either ─────────────
    // A second program, disjoint from task-1's bound surface, opens round 1 at origin/main.
    execFileSync("git", ["update-ref", "refs/remotes/origin/mirror48", ctx.base], { cwd: ctx.dir });
    const first = sideCandidate(ctx, "r48-line", { "docs/r48.md": "v1\n" });
    const rPanel = openPanel(ctx, 1, first, { task: "r48", changeset: "cs-r48" });
    assert.equal(rPanel.opened.ok, true, rPanel.opened.state);
    // The refreeze cures contaminated BYTES. Declared from a DIFFERENT ref naming the identical
    // commit — same scope, same roster, same phase, same tier — it still refuses: the base is
    // pinned as a PAIR, and a moved ref is a moved base.
    const refreeze = sideCandidate(ctx, "r48-refreeze", { "docs/r48.md": "v2\n" });
    const movedRefreeze = openPanel(ctx, 1, refreeze, { task: "r48", changeset: "cs-r48",
      baseRef: "origin/mirror48" });
    assert.equal(movedRefreeze.opened.ok, false, "a refreeze may not re-declare its base ref");
    assert.equal(movedRefreeze.opened.state, "aggregate-panel-open-conflict");
    assert.equal(derive(ctx, "r48").panels_open.length, 1, "nothing was consumed by the refusal");
    // The base-pin discriminator: the identical refreeze on the PINNED ref lands (M23 owns the
    // refreeze's general accepting polarity; this pair isolates the base alone).
    const pinnedRefreeze = openPanel(ctx, 1, refreeze, { task: "r48", changeset: "cs-r48" });
    assert.equal(pinnedRefreeze.opened.ok, true,
      `only the base moved: ${pinnedRefreeze.opened.state}`);
    assert.equal(derive(ctx, "r48").panels_open.length, 2);

    // Disabled arm: strip the two cross-round base-pin lines and the delta-only round 2 lands —
    // the R1 finding, the round's deepest: "immutable base..frozen pair" was claimed but never
    // enforced ACROSS rounds, so a moved base reviewed only the last delta while the GO (and the
    // coverage-scoped lift) certified the whole candidate.
    const mutant = await importMutant(mutantDir, [
      ["            row.base_ref !== state.panels_open[0].base_ref ||\n", ""],
      ["            row.base_commit !== state.panels_open[0].base_commit ||\n", ""],
    ]);
    const landed = mutant.deriveAggregateRepairState(deltaRows, "task-1",
      { standardEvents: window.events });
    assert.equal(landed.panels_open.length, 2,
      "without the pin the moved-base round 2 lands — delta-only review under a whole-candidate GO");
    assert.deepEqual(landed.panels_open.at(-1).changed_paths, ["src/y.mjs"],
      "…and x — reviewed at round 1, changed by no round-2 seat — silently leaves the panel's sight");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M49: CAP TRUTH AT THE EXECUTED SHAPE — the R1 panel's own 1300-id STOP carries, and the ledger stays derivable", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // The R1 panel's OWN reproduction: 12 seats × 100 raw ids (both grammar maxima at once) plus
    // 100 PM findings = a 1300-id disposition universe, every one BLOCKING-accepted, terminal STOP.
    const candidate = commit(ctx.dir, 1);
    const paths = candidate.paths;
    const seats = [
      { seat_id: "free", role: "free", family: "codex", pass_type: "free", paths },
      ...Array.from({ length: 10 }, (_, index) => ({ seat_id: `angle-${index}`,
        role: `angle:${index}`, family: "codex", pass_type: "free", paths })),
      { seat_id: "external", role: "external", family: "claude", pass_type: "folded", paths },
    ];
    assert.equal(seats.length, 12, "12 is the roster maximum the grammar admits");
    const opened = recordAggregatePanelOpen({
      type: "aggregate_v2", kind: "panel_open", task_id: "task-1", changeset_id: "cs-1", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: candidate.commit,
      frozen_tree: candidate.tree, base_ref: "origin/main", base_commit: ctx.base,
      expected_seats: seats, incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    }, options(ctx.dir));
    assert.equal(opened.ok, true, `${opened.state}: ${opened.detail ?? ""}`);
    const seatFindings = seats.map((seat, si) =>
      Array.from({ length: 100 }, (_, fi) => `S${si}-F${fi}`));
    const received = seats.map((seat, si) => ({
      seat_id: seat.seat_id, role: seat.role, family: seat.family, pass_type: seat.pass_type,
      inspected_paths: seat.paths, reviewed_commit: candidate.commit, reviewed_tree: candidate.tree,
      verdict: "NO-GO", raw_finding_ids: seatFindings[si],
      artifact_receipt: `receipt-${seat.seat_id}`,
      artifact_sha256: String(si).padStart(2, "0").repeat(32), pre_loaded: false,
      packet_scope: "candidate-only",
    }));
    const closed = recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
      panel_open_event_id: opened.event_id, received_seats: received,
    }, options(ctx.dir));
    assert.equal(closed.ok, true, closed.state);
    assert.equal(derive(ctx).panels_close.length, 1, "the ledger derives with a 1200-id close");

    const pmFindings = Array.from({ length: 100 }, (_, index) => ({ id: `PM-${index}`,
      harm: `harm ${index}`, mechanism: `mechanism ${index}`, trigger: `trigger ${index}` }));
    const everyId = [...seatFindings.flat(), ...pmFindings.map((finding) => finding.id)];
    assert.equal(everyId.length, 1300);
    assert.equal(new Set(everyId).size, 1300);
    const stop = decide(ctx, closed, { accepted: everyId, pm_findings: pmFindings,
      terminal_state: "STOP", remediation_kind: null, authorized_paths: [] });
    assert.equal(stop.ok, true, stop.state);
    const stopped = derive(ctx);
    assert.equal(stopped.terminal, "STOP");
    assert.equal(stopped.latest.all_finding_ids.length, 1300,
      "the whole executed universe is adjudicated, not truncated");

    // THE SOLE EXIT. A STOP successor must carry the accepted set EXACTLY — so the trigger cap
    // must admit the largest set the grammar can mint, or the mandatory carry is SHAPE-impossible
    // and the reservation has no door at all. Order-insensitive: the successor may list them
    // in any order.
    const successor = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: stop.event_id, trigger_ids: [...everyId].reverse(),
      continuation_kind: "new_changeset", owner_evidence: "Owner successor for the 1300 accepted",
      children: [{ task_id: "c49", changeset_id: "c49-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    assert.equal(successor.ok, true,
      `the executed 1300-id STOP carry is not shape-impossible: ${successor.state}`);
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState(loaded.aggregate_events, "task-1",
      { standardEvents: loaded.events }).terminal, "STOP", "the ledger still derives after the carry");
    assert.ok(derivePendingLineageBudgets(loaded.aggregate_events, { standardEvents: loaded.events })
      .some((entry) => entry.task_id === "c49"), "the child holds its declared budget");

    // Disabled arm: restore the prior 1200 cap. The executed row is no longer a VALID ENVELOPE,
    // so the whole ledger fails closed — the reservation's one door was not merely refused, the
    // program's entire history became underivable.
    const mutant = await importMutant(mutantDir, [[
      "        event.trigger_ids.length <= 2600 &&", "        event.trigger_ids.length <= 1200 &&",
    ]]);
    const bricked = mutant.deriveAggregateRepairState(loaded.aggregate_events, "task-1",
      { standardEvents: loaded.events });
    assert.equal(bricked.ok, false);
    assert.equal(bricked.state, "repair-history-invalid",
      "the prior cap makes the executed exit unrecordable AND the ledger unreadable");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

// A STOPs over {x, y}; its continuation seeds child B with the {x} half ONLY; B opens x at full
// coverage and GOes, so x is lifted and y stays reserved on A. The shared world for M50 and M51.
function goHopWorld(ctx) {
  writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
  const aCand = commit(ctx.dir, "a50");
  assert.deepEqual(aCand.paths, ["src/x.mjs", "src/y.mjs"]);
  const aPanel = openPanel(ctx, 1, aCand, { task: "a50", changeset: "a50-cs" });
  assert.equal(aPanel.opened.ok, true, aPanel.opened.state);
  const aClosed = closePanel(ctx, aPanel, aCand, ["A1"], { task: "a50", changeset: "a50-cs" });
  assert.equal(aClosed.ok, true, aClosed.state);
  const aStop = decide(ctx, aClosed, { task: "a50", changeset: "a50-cs", accepted: ["A1"],
    terminal_state: "STOP", remediation_kind: null, authorized_paths: [] });
  assert.equal(aStop.ok, true, aStop.state);
  assert.deepEqual(derive(ctx, "a50").stopped_paths, ["src/x.mjs", "src/y.mjs"]);
  const contAB = recordAggregateChildContinuation({
    type: "aggregate_v2", kind: "child_continuation", task_id: "a50", changeset_id: "a50-cs",
    parent_disposition_event_id: aStop.event_id, trigger_ids: ["A1"],
    continuation_kind: "new_changeset", owner_evidence: "Owner successor: the x half first",
    children: [{ task_id: "b50", changeset_id: "b50-cs", tier: "T2", budget: "the x half",
      authorized_paths: ["src/x.mjs"] }],
  }, options(ctx.dir));
  assert.equal(contAB.ok, true, contAB.state);
  const bCand = sideCandidate(ctx, "b50-line", { "src/x.mjs": "export const x = 'b50';\n" });
  const bOpen = openPanel(ctx, 1, bCand, { task: "b50", changeset: "b50-cs",
    lineage: { continuation: contAB.event_id } });
  assert.equal(bOpen.opened.ok, true, bOpen.opened.state);
  const bClosed = closePanel(ctx, bOpen, bCand, [], { task: "b50", changeset: "b50-cs" });
  assert.equal(bClosed.ok, true, bClosed.state);
  const bGo = decide(ctx, bClosed, { task: "b50", changeset: "b50-cs",
    terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
  assert.equal(bGo.ok, true, bGo.state);
  assert.equal(derive(ctx, "b50").terminal, "GO");
  return { aStop, contAB, bOpen, bGo };
}

test("M50: DECLARATION-TIME STOPPED REFUSAL — a GO ends its lineage's claim, so the GO hop is no springboard", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    const world = goHopWorld(ctx);
    // THE SPRINGBOARD: B reached GO on its own narrow half, and now declares a child over y —
    // its PARENT's still-reserved surface, which no B seat ever read. A GO node's lineage claim
    // ended with its GO; the harm context that reserved y lives on A's anchor, not B's.
    const springboard = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "b50", changeset_id: "b50-cs",
      parent_disposition_event_id: world.bGo.event_id, trigger_ids: [],
      continuation_kind: "new_changeset", owner_evidence: "hop the GO onto the reserved half",
      children: [{ task_id: "d50", changeset_id: "d50-cs", tier: "T2", budget: "the y half",
        authorized_paths: ["src/y.mjs"] }],
    }, options(ctx.dir));
    assert.equal(springboard.ok, false, "a GO child cannot declare over its parent's reservation");
    assert.equal(springboard.state, "aggregate-continuation-conflict");

    // Ledger as of the refusal — the accepting polarities below would mask the mutant's landing.
    const window = loadRepairEventsForProject(ctx.dir);
    const bOpenRow = derive(ctx, "b50").panels_open.at(-1);
    const plantedHop = stamped({
      type: "aggregate_v2", kind: "child_continuation", task_id: "b50", changeset_id: "b50-cs",
      recorded_at: "2099-01-01T00:08:00.000Z", session_id: "planter",
      parent_disposition_event_id: world.bGo.event_id,
      parent_frozen_commit: bOpenRow.frozen_commit, parent_frozen_tree: bOpenRow.frozen_tree,
      trigger_ids: [], continuation_kind: "new_changeset", owner_evidence: "springboard",
      children: [{ task_id: "d50", changeset_id: "d50-cs", tier: "T2", budget: "the y half",
        authorized_paths: ["src/y.mjs"] }],
    });
    const hopRows = [...window.aggregate_events, plantedHop];
    assert.ok(!derivePendingLineageBudgets(hopRows, { standardEvents: window.events })
      .some((entry) => entry.task_id === "d50"), "replay refuses the springboard too");

    // Polarity: B's anchor itself is LIVE — a child over a surface nobody reserved declares
    // freely. Only the reserved-y overlap refused above.
    const virginSide = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "b50", changeset_id: "b50-cs",
      parent_disposition_event_id: world.bGo.event_id, trigger_ids: [],
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on, unreserved surface",
      children: [{ task_id: "d50free", changeset_id: "d50free-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["docs/d50.md"] }],
    }, options(ctx.dir));
    assert.equal(virginSide.ok, true, `B's own anchor is not consumed: ${virginSide.state}`);

    // THE DOOR THAT IS OPEN: A's own anchor reopens on the un-lifted remainder, and A — the
    // reserver, carrying the accepted set exactly — declares y itself.
    const reopen = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "a50", changeset_id: "a50-cs",
      parent_disposition_event_id: world.aStop.event_id, trigger_ids: ["A1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor: now the y half",
      children: [{ task_id: "c50", changeset_id: "c50-cs", tier: "T2", budget: "the y half",
        authorized_paths: ["src/y.mjs"] }],
    }, options(ctx.dir));
    assert.equal(reopen.ok, true,
      `the reserving ancestor's remainder anchor is the only door: ${reopen.state}`);

    // Disabled arm: let the exception chain walk PAST a GO node and the springboard lands — the
    // GO hop launders a narrow GO into a claim over surface it never reviewed.
    const mutant = await importMutant(mutantDir, [[
      "    while (programs.get(current)?.terminal !== \"GO\") {", "    while (true) {",
    ]]);
    assert.ok(mutant.derivePendingLineageBudgets(hopRows, { standardEvents: window.events })
      .some((entry) => entry.task_id === "d50"),
    "a GO-transparent ancestor chain lets the springboard declaration land");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});

test("M51: THE REMAINDER REOPEN vs ANTI-SPAM BOUNDARY — un-lifted remainder reopens the anchor, nothing stranded closes it", () => {
  const ctx = repo();
  try {
    const world = goHopWorld(ctx);
    const reopenA = (task, paths) => recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "a50", changeset_id: "a50-cs",
      parent_disposition_event_id: world.aStop.event_id, trigger_ids: ["A1"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: task, changeset_id: `${task}-cs`, tier: "T2", budget: "one changeset",
        authorized_paths: paths }],
    }, options(ctx.dir));
    // ACCEPT: B's GO lifted x, but y — reserved, never repaired — is stranded remainder. Even
    // with every declared child terminal and none virgin, the anchor reopens.
    const second = reopenA("c51", ["src/y.mjs"]);
    assert.equal(second.ok, true, `un-lifted remainder reopens the anchor: ${second.state}`);
    // C2 repairs y at full coverage and GOes: now every reserved path is lifted.
    const cCand = sideCandidate(ctx, "c51-line", { "src/y.mjs": "export const y = 'c51';\n" });
    const cOpen = openPanel(ctx, 1, cCand, { task: "c51", changeset: "c51-cs",
      lineage: { continuation: second.event_id } });
    assert.equal(cOpen.opened.ok, true, cOpen.opened.state);
    const cClosed = closePanel(ctx, cOpen, cCand, [], { task: "c51", changeset: "c51-cs" });
    assert.equal(cClosed.ok, true, cClosed.state);
    const cGo = decide(ctx, cClosed, { task: "c51", changeset: "c51-cs",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(cGo.ok, true, cGo.state);
    assert.equal(derive(ctx, "c51").terminal, "GO");
    // REFUSE: all children terminal-GO, no virgin close, no un-lifted remainder — nothing is
    // stranded, so the remainder clause is NOT unlimited reopening. This is the polarity that
    // separates the two.
    const third = reopenA("c51b", ["docs/z51.md"]);
    assert.equal(third.ok, false, "with nothing stranded the anchor stays consumed");
    assert.equal(third.state, "aggregate-continuation-conflict");
    // …and the reservation itself is now fully lifted: an unrelated program may work x and y.
    const outsider = sideCandidate(ctx, "out51",
      { "src/x.mjs": "export const x = 'out';\n", "src/y.mjs": "export const y = 'out';\n" });
    assert.equal(openPanel(ctx, 1, outsider, { task: "out51", changeset: "out51-cs" }).opened.ok,
      true, "a fully repaired reservation releases — the anchor closed because nothing was left");
  } finally { ctx.cleanup(); }
});

test("M52: the pending-hold diagnosis survives a NON-free-seat-first roster — the executed R1 shape", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "breaker-mutants-"));
  try {
    // A GO parent declares a follow-on child over src/p.mjs; the child never opens, so its
    // declared budget is a PENDING hold.
    const pCand = sideCandidate(ctx, "p52-line", { "docs/p52.md": "p52\n" });
    const pPanel = openPanel(ctx, 1, pCand, { task: "p52", changeset: "cs-p52" });
    assert.equal(pPanel.opened.ok, true, pPanel.opened.state);
    const pClosed = closePanel(ctx, pPanel, pCand, [], { task: "p52", changeset: "cs-p52" });
    const pGo = decide(ctx, pClosed, { task: "p52", changeset: "cs-p52",
      terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(pGo.ok, true, pGo.state);
    const hold = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "p52", changeset_id: "cs-p52",
      parent_disposition_event_id: pGo.event_id, trigger_ids: [],
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on",
      children: [{ task_id: "c52", changeset_id: "c52-cs", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/p.mjs"] }],
    }, options(ctx.dir));
    assert.equal(hold.ok, true, hold.state);

    // The victim's candidate touches p AND q. Its roster is LEGAL but not free-seat-first: the
    // angle seat at index 0 carries PARTIAL coverage that excludes p entirely, while the free
    // seat — later in the list — carries the full changed set. Seat order is caller input; the
    // executed R1 panel's own roster looked like this.
    const both = ["src/p.mjs", "src/q.mjs"];
    const victim = sideCandidate(ctx, "v52-line",
      { "src/p.mjs": "export const p = 1;\n", "src/q.mjs": "export const q = 1;\n" });
    assert.deepEqual(victim.paths, both);
    const angleFirst = [
      { seat_id: "a", role: "angle:a", family: "codex", pass_type: "free", paths: ["src/q.mjs"] },
      { seat_id: "free", role: "free", family: "codex", pass_type: "free", paths: both },
      { seat_id: "b", role: "angle:b", family: "codex", pass_type: "free", paths: both },
      { seat_id: "external", role: "external", family: "claude", pass_type: "folded", paths: both },
    ];
    const open = (seatList, module = { recordAggregatePanelOpen }) => module.recordAggregatePanelOpen({
      type: "aggregate_v2", kind: "panel_open", task_id: "v52", changeset_id: "v52-cs", round: 1,
      phase: "repair_round", tier: "T2", frozen_commit: victim.commit, frozen_tree: victim.tree,
      base_ref: "origin/main", base_commit: ctx.base, expected_seats: seatList,
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: null, legacy_handoff_event_id: null,
    }, options(ctx.dir));
    const refused = open(angleFirst);
    assert.equal(refused.ok, false, "the pending budget over p refuses the open");
    assert.equal(refused.state, "aggregate-panel-open-conflict");
    assert.match(refused.detail ?? "", /c52/, "the deny names the holding child…");
    assert.match(refused.detail ?? "", /p52/, "…and the parent whose lineage holds it");
    // The other polarity of the same roster axis: free-seat-first is diagnosed identically.
    const freeFirst = open(expectedSeats(both));
    assert.equal(freeFirst.ok, false);
    assert.match(freeFirst.detail ?? "", /c52/, "roster order changes nothing about the diagnosis");

    // Disabled arm: match the pending budget against the FIRST SEAT's paths — the seat-0 proxy.
    // The refusal is identical, but the cure goes conditionally inert for exactly the roster
    // shape the R1 panel ran, and the operator gets a bare conflict naming nothing.
    const mutant = await importMutant(mutantDir, [[
      "(evidence?.changed_paths ?? [])", "(input.expected_seats?.[0]?.paths ?? [])",
    ]]);
    const blind = open(angleFirst, mutant);
    assert.equal(blind.ok, false, "the refusal itself is the world's — the proxy only blinds the deny");
    assert.equal(blind.detail, undefined,
      "the seat-0 proxy loses the holder whenever seat 0 does not carry the held path");
    const stillSeen = open(expectedSeats(both), mutant);
    assert.match(stillSeen.detail ?? "", /c52/,
      "…and it still works free-seat-first, which is why the inertness was invisible");
  } finally { ctx.cleanup(); rmSync(mutantDir, { recursive: true, force: true }); }
});
