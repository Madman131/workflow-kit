// The terminal-round-breaker mutation matrix — the rows the aggregate controller's own suite does
// not carry: the seven handoff loose ends (path fail-open · stale legacy handoff · close
// resurrection · malformed-row throw · snapshot TOCTOU), the evidence-fold requirements
// (four-bucket partition with inline followup routing · successor tier floor · GO-lineage
// successors · declared STOP), and the 12/20-round replay fixtures that assert TERMINATION at the
// terminal bookend — never a specific batch composition. Disabled-arm mutants prove each new
// mechanism's original trigger goes red when its arm is removed.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeRepairPathOwners, confirmRepairBrief, deriveAggregateRepairState, fingerprintCandidate,
  loadRepairEventsForProject, recordAggregateChildContinuation, recordAggregateClose,
  recordAggregateDisposition, recordAggregateLegacyHandoff, recordAggregatePanelClose,
  recordAggregatePanelOpen, recordAggregateRootExit, recordWorkerVerification, repairLedgerPath,
  verifyRepairWorkerWrite,
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

function openPanel(ctx, round, candidate, { task = "task-1", changeset = "cs-1", tier = "T2",
  incoming = {}, lineage = {} } = {}) {
  const expected = expectedSeats(candidate.paths, tier);
  const opened = recordAggregatePanelOpen({
    type: "aggregate_v2", kind: "panel_open", task_id: task, changeset_id: changeset, round,
    phase: round === 4 ? "final_bookend" : "repair_round", tier,
    frozen_commit: candidate.commit, frozen_tree: candidate.tree,
    base_ref: "origin/main", base_commit: ctx.base, expected_seats: expected,
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

    // Disabled arm: removing the terminal guards resurrects ownership under CLOSED.
    const mutant = await importMutant(mutantDir, [
      ["      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_open_event_id || \"\")) continue;",
        "      if (!state || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_open_event_id || \"\")) continue;"],
      ["      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_close_event_id || \"\") || !pmFindingsShape(row.pm_findings)) continue;",
        "      if (!state || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_close_event_id || \"\") || !pmFindingsShape(row.pm_findings)) continue;"],
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

      // The history's remaining rounds try to continue — every route fails closed, every time.
      for (let attempt = 5; attempt <= rounds; attempt += 1) {
        candidate = commit(ctx.dir, attempt * 100);
        const again = openPanel(ctx, Math.min(attempt, 4), candidate, { incoming: authority });
        assert.equal(again.opened.ok, false, `round ${attempt}: no panel after the terminal bookend`);
        const redispatch = confirmRepairBrief({ declaration: {
          aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
          disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
          next_round: 5, root_exit_event_id: null,
        }, brief_path: "briefs/round-2.md" }, options(ctx.dir));
        assert.equal(redispatch.ok, false, `round ${attempt}: no dispatch after STOP`);
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
