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
  activeRepairPathOwners, confirmRepairBrief, deriveAggregateRepairState, fingerprintCandidate,
  gitSubjectPresent, loadRepairEventsForProject, recordAggregateChildContinuation,
  recordAggregateClose, recordAggregateDisposition, recordAggregateLegacyHandoff,
  recordAggregatePanelClose, recordAggregatePanelOpen, recordAggregateRootExit,
  recordAggregateWorkerHandoff, recordWorkerVerification, repairLedgerPath,
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

    // Disabled arm: removing the terminal guards resurrects ownership under CLOSED. The late
    // disposition is DOUBLY blocked — the close reservation over the program's own ground shadows
    // the terminality guard — so the honest mutant disables both arms; each arm's own necessity
    // is proven by its own test, and this one proves that with neither, the resurrection is real.
    const mutant = await importMutant(mutantDir, [
      ["      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_open_event_id || \"\")) continue;",
        "      if (!state || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_open_event_id || \"\")) continue;"],
      ["      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_close_event_id || \"\") || !pmFindingsShape(row.pm_findings)) continue;",
        "      if (!state || state.changeset_id !== row.changeset_id ||\n          !ID64.test(row.panel_close_event_id || \"\") || !pmFindingsShape(row.pm_findings)) continue;"],
      ["            stoppedPathOverlap(paths, dispositionLineage?.parent_task_id ?? null) ||\n",
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
    // (c) THE PRE-MINT WINDOW: a session records its close FIRST and mints its admission row
    // AFTER it. The admitted set is scanned from the FULL ledger before replay, so the later
    // admission still refuses the earlier close.
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
    // The SAME close with the admission minted AFTER it: the full-ledger pre-scan refuses it.
    const preMint = deriveAggregateRepairState(
      [...loaded.aggregate_events, sneakClose, sneakAdmission], "task-1",
      { standardEvents: loaded.events });
    assert.equal(preMint.terminal, null,
      "minting the admission AFTER the close gains nothing — the pre-scan reads the whole ledger");
    assert.equal(preMint.closes.length, 0, "the pre-mint close is inert, not history-breaking");
    assert.equal(preMint.active, true, "…and the program's authority is NOT released");
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
