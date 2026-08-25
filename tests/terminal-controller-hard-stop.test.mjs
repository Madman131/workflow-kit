import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeRepairPathOwners, confirmRepairBrief, deriveAggregateRepairState, fingerprintCandidate,
  loadRepairEventsForProject, readRepairEvents, recordAggregateChildContinuation,
  recordAggregateClose, recordAggregateDisposition, recordAggregateLegacyHandoff, recordAggregatePanelClose,
  recordAggregatePanelOpen, recordAggregateRootExit, recordAggregateWorkerHandoff,
  recordOwnerExtension, recordRepairClose, recordRoundDisposition, recordWorkerVerification,
  repairLedgerPath, verifyRepairWorkerWrite,
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "terminal-controller-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
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

function expectedSeats(paths, substitute = false) {
  const seat = (seat_id, role, family, pass_type, substitution) => ({
    seat_id, role, family, pass_type, paths,
    ...(substitution ? { substitution } : {}),
  });
  return [
    seat("free", "free", "codex", "free"),
    seat("correctness", "angle:correctness", "codex", "free"),
    seat("controls", "angle:controls", "codex", "free"),
    seat("external", "external", "claude", "folded", substitute ? {
      replaced_family: "claude", actual_family: "gemini", owner_evidence: "Owner substituted Gemini",
      decorrelation_level: "full",
    } : null),
  ];
}

function receivedSeats(expected, findingId = null) {
  return expected.map((seat, index) => ({
    seat_id: seat.seat_id, role: seat.role,
    family: seat.substitution?.actual_family || seat.family, pass_type: seat.pass_type,
    inspected_paths: seat.paths, reviewed_commit: null, reviewed_tree: null,
    verdict: index === 1 && findingId ? "NO-GO" : "GO",
    raw_finding_ids: index === 1 && findingId ? [findingId] : [],
    artifact_receipt: `receipt-${seat.seat_id}`, artifact_sha256: String(index + 1).repeat(64),
    pre_loaded: index !== 0, packet_scope: "candidate-only",
  }));
}

function openPanelInput(ctx, candidate, task = {}, incoming = {}, substitute = false, round = 1) {
  const expected = expectedSeats(candidate.paths, substitute);
  return {
    type: "aggregate_v2", kind: "panel_open", task_id: task.task_id || "task-1",
    changeset_id: task.changeset_id || "changeset-1", round,
    phase: round === 4 ? "final_bookend" : "repair_round", tier: task.tier || "T2",
    frozen_commit: candidate.commit, frozen_tree: candidate.tree,
    base_ref: "origin/main", base_commit: ctx.base, expected_seats: expected,
    incoming_dispatch_event_id: incoming.dispatch ?? null,
    incoming_worker_event_id: incoming.worker ?? null,
    child_continuation_event_id: task.child_continuation_event_id ?? null,
    legacy_handoff_event_id: task.legacy_handoff_event_id ?? null,
  };
}

function openPanel(ctx, round, candidate, incoming = {}, substitute = false, task = {}) {
  const input = openPanelInput(ctx, candidate, task, incoming, substitute, round);
  const expected = input.expected_seats;
  const opened = recordAggregatePanelOpen(input, options(ctx.dir));
  assert.equal(opened.ok, true, opened.state);
  return { opened, input, expected };
}

function closePanel(ctx, opened, expected, candidate, findingId = null, task = {}) {
  const received = receivedSeats(expected, findingId).map((seat) => ({
    ...seat, reviewed_commit: candidate.commit, reviewed_tree: candidate.tree,
  }));
  const closed = recordAggregatePanelClose({
    type: "aggregate_v2", kind: "panel_close", task_id: task.task_id || "task-1",
    changeset_id: task.changeset_id || "changeset-1",
    panel_open_event_id: opened.event_id, received_seats: received,
  }, options(ctx.dir));
  assert.equal(closed.ok, true, closed.state);
  return { closed, received };
}

function disposition(ctx, closed, {
  task_id = "task-1", changeset_id = "changeset-1", accepted = [], declined = [], note = [],
  followup = [], pm_findings = [], terminal_state = "CONTINUE", remediation_kind = "bounded",
  authorized_paths = ["src/x.mjs"],
} = {}) {
  return recordAggregateDisposition({
    type: "aggregate_v2", kind: "disposition", task_id, changeset_id,
    panel_close_event_id: closed.event_id, pm_findings,
    finding_dispositions: { accepted, declined, note, followup }, terminal_state, remediation_kind,
    authorized_paths,
  }, options(ctx.dir));
}

function dispatch(ctx, dispositionId, panelId, nextRound, rootExitId = null) {
  mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
  const brief = `briefs/round-${nextRound}.md`;
  writeFileSync(path.join(ctx.dir, brief), `repair ${nextRound}\n`);
  const receipt = confirmRepairBrief({ declaration: {
    aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
    disposition_event_id: dispositionId, panel_close_event_id: panelId,
    next_round: nextRound, root_exit_event_id: rootExitId,
  }, brief_path: brief }, options(ctx.dir));
  assert.equal(receipt.ok, true, receipt.state);
  const worker = recordWorkerVerification({
    task_id: "task-1", repair_dispatch_event_id: receipt.event_id,
  }, options(ctx.dir, `worker-${nextRound}`));
  assert.equal(worker.ok, true, worker.state);
  return { dispatch: receipt.event_id, worker: worker.event_id };
}

test("aggregate controller enforces PM authority, three batches, final STOP, handoff, and split lineage", () => {
  const ctx = repo();
  try {
    let candidate = commit(ctx.dir, 1);
    const missingDecorrelation = openPanelInput(ctx, candidate, {}, {}, true);
    delete missingDecorrelation.expected_seats.at(-1).substitution.decorrelation_level;
    assert.equal(recordAggregatePanelOpen(missingDecorrelation, options(ctx.dir)).state,
      "aggregate-panel-open-malformed", "a substitution must record its decorrelation level");
    const angleMasqueradingAsFree = openPanelInput(ctx, candidate);
    angleMasqueradingAsFree.expected_seats[0].role = "angle:failure-mode";
    assert.equal(recordAggregatePanelOpen(angleMasqueradingAsFree, options(ctx.dir)).state,
      "aggregate-panel-open-malformed", "a free pass must occupy the dedicated free role");
    let panel = openPanel(ctx, 1, candidate, {}, true);
    const wrongFamily = receivedSeats(panel.expected).map((seat) => ({
      ...seat, reviewed_commit: candidate.commit, reviewed_tree: candidate.tree,
    }));
    wrongFamily.at(-1).family = "claude";
    assert.equal(recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "changeset-1",
      panel_open_event_id: panel.opened.event_id, received_seats: wrongFamily,
    }, options(ctx.dir)).state, "aggregate-panel-close-conflict");

    let closed = closePanel(ctx, panel.opened, panel.expected, candidate);
    const pm = { id: "PM-1", harm: "false release", mechanism: "manual blocker absent",
      trigger: "empty seats plus PM blocker" };
    let decided = disposition(ctx, closed.closed, { accepted: ["PM-1"], pm_findings: [pm] });
    assert.equal(decided.ok, true, decided.state);
    assert.equal(recordAggregatePanelOpen({
      ...panel.input, task_id: "overlap", changeset_id: "overlap-change",
    }, options(ctx.dir)).state, "aggregate-panel-open-conflict",
    "a second aggregate program cannot start over an active owner's path");
    let authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 2);
    const workerRetry = recordWorkerVerification({
      task_id: "task-1", repair_dispatch_event_id: authority.dispatch,
    }, options(ctx.dir, "worker-2"));
    assert.equal(workerRetry.ok, true);
    assert.equal(workerRetry.idempotent, true, "worker verification retries are idempotent");
    assert.equal(workerRetry.event_id, authority.worker);
    const retry = confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 2,
      root_exit_event_id: null,
    }, brief_path: "briefs/round-2.md" }, options(ctx.dir, "retry-orchestrator"));
    assert.equal(retry.ok, true, retry.state);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.event_id, authority.dispatch);
    writeFileSync(path.join(ctx.dir, "briefs", "round-2.md"), "conflicting repair\n");
    assert.equal(confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 2,
      root_exit_event_id: null,
    }, brief_path: "briefs/round-2.md" }, options(ctx.dir, "conflicting-orchestrator")).state,
    "aggregate-dispatch-conflict");
    writeFileSync(path.join(ctx.dir, "briefs", "round-2.md"), "repair 2\n");
    const handoff = recordAggregateWorkerHandoff({
      type: "aggregate_v2", kind: "worker_handoff", task_id: "task-1", changeset_id: "changeset-1",
      dispatch_event_id: authority.dispatch, prior_worker_event_id: authority.worker,
      new_worker_session_id: "replacement-worker", owner_evidence: "Owner worker replacement",
    }, options(ctx.dir));
    assert.equal(handoff.ok, true, handoff.state);
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "worker-2", target: "src/x.mjs",
    }, { projectRoot: ctx.dir }).state, "repair-worker-verification-missing");
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "replacement-worker", target: "src/x.mjs",
    }, { projectRoot: ctx.dir }).ok, true);
    authority.worker = handoff.event_id;

    for (const round of [2, 3]) {
      candidate = commit(ctx.dir, round);
      panel = openPanel(ctx, round, candidate, authority);
      closed = closePanel(ctx, panel.opened, panel.expected, candidate, `F${round}`);
      decided = disposition(ctx, closed.closed, {
        accepted: [`F${round}`], remediation_kind: round === 3 ? "root_replacement" : "bounded",
      });
      assert.equal(decided.ok, true, decided.state);
      let root = null;
      if (round === 3) {
        const exit = recordAggregateRootExit({
          type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
          disposition_event_id: decided.event_id, shared_mechanism: "one shared controller defect",
          replacement: "one finite state machine", removed_workarounds: ["circular cadence"],
          trigger_matrix: ["R4 has no outgoing dispatch"],
        }, options(ctx.dir));
        assert.equal(exit.ok, true, exit.state); root = exit.event_id;
      }
      authority = dispatch(ctx, decided.event_id, closed.closed.event_id, round + 1, root);
    }

    candidate = commit(ctx.dir, 4);
    panel = openPanel(ctx, 4, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "FINAL-1");
    decided = disposition(ctx, closed.closed, {
      accepted: ["FINAL-1"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [],
    });
    assert.equal(decided.ok, true, decided.state);
    const terminal = deriveAggregateRepairState(
      loadRepairEventsForProject(ctx.dir).aggregate_events, "task-1",
      { standardEvents: loadRepairEventsForProject(ctx.dir).events });
    assert.equal(terminal.terminal, "STOP");
    assert.equal(recordAggregatePanelOpen({
      ...openPanelInput(ctx, candidate), task_id: "renamed-task", changeset_id: "renamed-change",
    }, options(ctx.dir)).state, "aggregate-panel-open-conflict",
    "a STOP cannot be reset by renaming both task and changeset over the same paths");
    assert.equal(confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 5,
    }, brief_path: "briefs/round-4.md" }, options(ctx.dir)).state, "aggregate-dispatch-unavailable");

    const continuation = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: decided.event_id, trigger_ids: ["FINAL-1"],
      continuation_kind: "split", owner_evidence: "Owner split",
      children: [
        { task_id: "child-a", changeset_id: "child-a-change", tier: "T2", authorized_paths: candidate.paths },
        { task_id: "child-b", changeset_id: "child-b-change", tier: "T2", authorized_paths: ["src/y.mjs"] },
      ],
    }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
    const legacyManifest = fingerprintCandidate(ctx.dir, ["briefs/round-4.md"]);
    const legacyEvent = {
      type: "round_disposition", task_id: "collision-parent", changeset_id: "collision-parent-change",
      round: 1, candidate_sha: legacyManifest.digest, candidate_manifest: legacyManifest.records,
      verdict: "NO-GO", disposition: "REMEDIATE", finding_ids: ["COLLISION"],
      finding_class: "identity", ownership_area: "controller", original_trigger: "reserved child collision",
      authorized_paths: ["briefs/round-4.md"], introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null,
      recorded_at: "2099-01-01T00:00:20.000Z", session_id: "legacy-parent",
    };
    writeFileSync(repairLedgerPath(ctx.dir), JSON.stringify(stamped(legacyEvent)) + "\n", { flag: "a" });
    assert.equal(recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "collision-parent",
      changeset_id: "collision-parent-change", parent_task_id: "collision-parent",
      parent_changeset_id: "collision-parent-change", parent_candidate_sha: legacyManifest.digest,
      authorized_paths: ["briefs/round-4.md"], owner_evidence: "collision attempt",
      child: { task_id: "collision-child", changeset_id: "child-a-change", tier: "T2",
        authorized_paths: ["briefs/round-4.md"] },
    }, options(ctx.dir)).state, "aggregate-legacy-handoff-conflict",
    "legacy handoff cannot overwrite a continuation's pending child changeset");
    const collisionCloseAuthority = recordOwnerExtension({
      task_id: "collision-parent", changeset_id: "collision-parent-change", after_round: 1,
      authority_kind: "close", owner_evidence: "fixture cleanup",
    }, options(ctx.dir, "collision-owner"));
    assert.equal(recordRepairClose({
      task_id: "collision-parent", changeset_id: "collision-parent-change", after_round: 1,
      reason: "collision fixture complete", owner_close_event_id: collisionCloseAuthority.event_id,
    }, options(ctx.dir, "collision-closer")).ok, true);
    assert.equal(recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: decided.event_id, trigger_ids: ["FINAL-1"],
      continuation_kind: "split", owner_evidence: "conflicting child reservation",
      children: [
        { task_id: "child-c", changeset_id: "child-a-change", tier: "T2", authorized_paths: ["src/z.mjs"] },
        { task_id: "child-d", changeset_id: "child-d-change", tier: "T2", authorized_paths: ["src/w.mjs"] },
      ],
    }, options(ctx.dir)).state, "aggregate-continuation-conflict",
    "a continuation reserves child changeset ids before panel open");
    const wrongPathOpen = stamped({
      ...openPanelInput(ctx, candidate, {
        task_id: "child-a", changeset_id: "child-a-change",
        child_continuation_event_id: continuation.event_id,
      }),
      recorded_at: "2099-01-01T00:00:10.000Z", session_id: "wrong-path",
      changed_paths: ["src/not-declared.mjs"], expected_seats: expectedSeats(["src/not-declared.mjs"]),
    });
    const beforeChild = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...beforeChild.aggregate_events, wrongPathOpen], "child-a", {
      standardEvents: beforeChild.events,
    }).lineage_event_id, null, "a child cannot widen or replace its declared path set");
    const wrongTier = openPanelInput(ctx, candidate, {
      task_id: "child-a", changeset_id: "child-a-change", tier: "T3",
      child_continuation_event_id: continuation.event_id,
    });
    wrongTier.expected_seats.splice(3, 0, {
      seat_id: "security", role: "angle:security", family: "codex", pass_type: "free",
      paths: candidate.paths,
    });
    assert.equal(recordAggregatePanelOpen(wrongTier, options(ctx.dir)).state, "aggregate-panel-open-conflict");
    assert.equal(openPanel(ctx, 1, candidate, {}, false, {
      task_id: "child-a", changeset_id: "child-a-change", child_continuation_event_id: continuation.event_id,
    }).opened.ok, true);
    execFileSync("git", ["checkout", "-qb", "child-b-test", "origin/main"], { cwd: ctx.dir });
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    execFileSync("git", ["add", "src/y.mjs"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "child-b-candidate"], { cwd: ctx.dir });
    const childBCandidate = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["src/y.mjs"],
    };
    assert.equal(openPanel(ctx, 1, childBCandidate, {}, false, {
      task_id: "child-b", changeset_id: "child-b-change", child_continuation_event_id: continuation.event_id,
    }).opened.ok, true);
  } finally { ctx.cleanup(); }
});

test("panel reservation, configured target, free coverage, and aggregate abandonment are fail closed", () => {
  const ctx = repo();
  try {
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    execFileSync("git", ["add", "src/y.mjs"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "candidate-two-paths"], { cwd: ctx.dir });
    const candidate = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["src/y.mjs"],
    };
    execFileSync("git", ["update-ref", "refs/remotes/upstream/release", ctx.base], { cwd: ctx.dir });
    const input = openPanelInput(ctx, candidate);
    input.base_ref = "upstream/release";
    const foldedAngle = structuredClone(input);
    foldedAngle.expected_seats[1].pass_type = "folded";
    assert.equal(recordAggregatePanelOpen(foldedAngle, options(ctx.dir)).state,
      "aggregate-panel-open-malformed");
    const partialFree = structuredClone(input);
    partialFree.expected_seats[0].paths = [];
    assert.equal(recordAggregatePanelOpen(partialFree, options(ctx.dir)).state,
      "aggregate-panel-open-malformed");
    const first = recordAggregatePanelOpen(input, options(ctx.dir));
    assert.equal(first.ok, true, first.state);
    const replacement = structuredClone(input);
    replacement.expected_seats[1].seat_id = "replacement-angle";
    assert.equal(recordAggregatePanelOpen(replacement, options(ctx.dir, "later")).state,
      "aggregate-panel-open-conflict", "the first eligible panel roster wins");
    const closed = closePanel(ctx, first, input.expected_seats, candidate, "ABANDON");
    const decided = disposition(ctx, closed.closed, {
      accepted: ["ABANDON"], authorized_paths: candidate.paths,
    });
    assert.equal(decided.ok, true, decided.state);
    const close = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, reason: "changeset abandoned",
      owner_evidence: "Owner standing close authority",
    }, options(ctx.dir, "closer"));
    assert.equal(close.ok, true, close.state);
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/y.mjs", {
      aggregateEvents: loaded.aggregate_events,
    }).owners, [], "aggregate close releases abandoned paths");
  } finally { ctx.cleanup(); }
});

test("disabled completeness, partition, batch-3, final-dispatch, and first-winner arms all turn red", async () => {
  const ctx = repo();
  const mutantDir = mkdtempSync(path.join(os.tmpdir(), "terminal-controller-mutants-"));
  try {
    let candidate = commit(ctx.dir, 1);
    const firstInput = openPanelInput(ctx, candidate);
    firstInput.expected_seats.push({
      seat_id: "security", role: "angle:security", family: "codex", pass_type: "free",
      paths: candidate.paths,
    });
    const firstOpen = recordAggregatePanelOpen(firstInput, options(ctx.dir));
    assert.equal(firstOpen.ok, true, firstOpen.state);
    let panel = { opened: firstOpen, input: firstInput, expected: firstInput.expected_seats };
    const seats = receivedSeats(panel.expected, "F1").map((seat) => ({
      ...seat, reviewed_commit: candidate.commit, reviewed_tree: candidate.tree,
    }));
    const incompleteClose = stamped({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "mutant",
      panel_open_event_id: panel.opened.event_id, received_seats: seats.slice(0, 4),
    });
    let loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, incompleteClose], "task-1", {
      standardEvents: loaded.events,
    }).panels_close.length, 0);
    let mutant = await importMutant(mutantDir, [[
      /function aggregatePanelComplete\(open, close\) \{[\s\S]*?\n\}/,
      "function aggregatePanelComplete() { return true; }",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, incompleteClose], "task-1", {
      standardEvents: loaded.events,
    }).panels_close.length, 1, "removing panel completeness accepts the shrunk panel");

    let closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const omittedPartition = stamped({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:01.000Z", session_id: "mutant",
      panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: [], declined: [], note: [], followup: [] },
      terminal_state: "GO", remediation_kind: null, authorized_paths: [],
    });
    loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, omittedPartition], "task-1", {
      standardEvents: loaded.events,
    }).dispositions.length, 0);
    mutant = await importMutant(mutantDir, [[
      /function findingPartition\(ids, partition\) \{[\s\S]*?\n\}/,
      "function findingPartition(_ids, partition) { return { accepted: [...partition.accepted], declined: [...partition.declined], note: [...partition.note], followup: [] }; }",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, omittedPartition], "task-1", {
      standardEvents: loaded.events,
    }).terminal, "GO", "removing partition completeness launders an omitted finding");

    let decided = disposition(ctx, closed.closed, { accepted: ["F1"] });
    let authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 2);
    candidate = commit(ctx.dir, 2);
    panel = openPanel(ctx, 2, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F2");
    decided = disposition(ctx, closed.closed, { accepted: ["F2"] });
    authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 3);
    candidate = commit(ctx.dir, 3);
    panel = openPanel(ctx, 3, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F3");
    const boundedR3 = stamped({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:02.000Z", session_id: "mutant",
      panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F3"], declined: [], note: [], followup: [] },
      terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: ["src/x.mjs"],
    });
    loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, boundedR3], "task-1", {
      standardEvents: loaded.events,
    }).dispositions.length, 2);
    mutant = await importMutant(mutantDir, [[
      '["root_replacement", "simplification", "split"].includes(row.remediation_kind)',
      '["root_replacement", "simplification", "split", "bounded"].includes(row.remediation_kind)',
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, boundedR3], "task-1", {
      standardEvents: loaded.events,
    }).dispositions.length, 3, "weakening the third-batch kind admits a bounded batch 3");

    decided = disposition(ctx, closed.closed, { accepted: ["F3"], remediation_kind: "root_replacement" });
    const exit = recordAggregateRootExit({
      type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, shared_mechanism: "one root",
      replacement: "one replacement", removed_workarounds: ["patch loop"], trigger_matrix: ["final stop"],
    }, options(ctx.dir));
    assert.equal(exit.ok, true, exit.state);
    authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 4, exit.event_id);
    candidate = commit(ctx.dir, 4);
    panel = openPanel(ctx, 4, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "FINAL");
    decided = disposition(ctx, closed.closed, {
      accepted: ["FINAL"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [],
    });
    const finalDispatch = stamped({
      type: "aggregate_v2", kind: "dispatch", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:03.000Z", session_id: "mutant",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
      source_round: 4, next_round: 5, authorized_paths: [], root_exit_event_id: null,
      target_kind: "brief", target: "briefs/round-5.md", brief_sha256: "a".repeat(64), brief_size: 1,
    });
    loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, finalDispatch], "task-1", {
      standardEvents: loaded.events,
    }).dispatches.length, 3);
    mutant = await importMutant(mutantDir, [
      ["state.terminal || state.active_dispatch ||", "state.active_dispatch ||"],
      ['disposition.terminal_state !== "CONTINUE" || row.source_round', 'false || row.source_round'],
    ]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, finalDispatch], "task-1", {
      standardEvents: loaded.events,
    }).dispatches.length, 4, "removing final dispatch denial creates a fourth repair dispatch");

    const continuation = (trigger, child, at) => stamped({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: at, session_id: "mutant", parent_disposition_event_id: decided.event_id,
      trigger_ids: [trigger], continuation_kind: "new_changeset", owner_evidence: "Owner continuation",
      children: [{ task_id: child, changeset_id: `${child}-change`, tier: "T2", authorized_paths: candidate.paths }],
    });
    const wrong = continuation("WRONG", "wrong-child", "2099-01-01T00:00:04.000Z");
    const correct = continuation("FINAL", "correct-child", "2099-01-01T00:00:05.000Z");
    const childOpen = (task_id, continuationId, at) => stamped({
      type: "aggregate_v2", kind: "panel_open", task_id, changeset_id: `${task_id}-change`,
      recorded_at: at, session_id: "mutant", round: 1, phase: "repair_round", tier: "T2",
      frozen_commit: candidate.commit, frozen_tree: candidate.tree,
      base_ref: "origin/main", base_commit: ctx.base, changed_paths: candidate.paths,
      expected_seats: expectedSeats(candidate.paths), incoming_dispatch_event_id: null,
      incoming_worker_event_id: null, child_continuation_event_id: continuationId,
      legacy_handoff_event_id: null,
    });
    const wrongOpen = childOpen("wrong-child", wrong.event_id, "2099-01-01T00:00:04.500Z");
    const correctOpen = childOpen("correct-child", correct.event_id, "2099-01-01T00:00:05.500Z");
    const lineageRows = [...loaded.aggregate_events, wrong, wrongOpen, correct, correctOpen];
    const current = deriveAggregateRepairState(lineageRows, "correct-child", {
      standardEvents: loaded.events,
    });
    assert.equal(current.lineage_event_id, correct.event_id);
    mutant = await importMutant(mutantDir, [[
      "if (!triggerOk) continue;",
      "if (false) continue;",
    ]]);
    assert.equal(mutant.deriveAggregateRepairState(lineageRows, "wrong-child", {
      standardEvents: loaded.events,
    }).lineage_event_id, wrong.event_id,
    "removing eligibility lets the first wrong continuation seize the transition");
  } finally {
    ctx.cleanup();
    rmSync(mutantDir, { recursive: true, force: true });
  }
});

test("legacy rows replay and close or atomically hand off, but new standard minting is retired", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const manifest = fingerprintCandidate(ctx.dir, ["src/x.mjs"]);
    const event = {
      type: "round_disposition", task_id: "legacy", changeset_id: "legacy-change", round: 1,
      candidate_sha: manifest.digest, candidate_manifest: manifest.records, verdict: "NO-GO",
      disposition: "REMEDIATE", finding_ids: ["LEGACY-1"], finding_class: "legacy",
      ownership_area: "controller", original_trigger: "legacy active owner",
      authorized_paths: ["src/x.mjs"], introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null,
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "legacy-session",
    };
    const ledger = repairLedgerPath(ctx.dir);
    mkdirSync(path.dirname(ledger), { recursive: true });
    writeFileSync(ledger, JSON.stringify({ event_id: eventId(event), event }) + "\n");
    assert.deepEqual(activeRepairPathOwners(loadRepairEventsForProject(ctx.dir).events, "src/x.mjs")
      .owners.map((owner) => owner.task_id), ["legacy"]);
    assert.equal(recordRoundDisposition({
      ...event, candidate_paths: ["src/x.mjs"], recorded_at: undefined, session_id: undefined,
    }, options(ctx.dir)).idempotent, true);
    assert.equal(recordRoundDisposition({
      ...event, round: 2, candidate_paths: ["src/x.mjs"], recorded_at: undefined, session_id: undefined,
    }, options(ctx.dir)).state, "standard-mint-retired");

    const blocked = recordAggregatePanelOpen(openPanelInput(ctx, candidate, {
      task_id: "aggregate-before-handoff", changeset_id: "aggregate-before-handoff-change",
    }), options(ctx.dir));
    assert.equal(blocked.state, "aggregate-panel-open-conflict",
      "active legacy ownership blocks an overlapping aggregate start");

    assert.equal(recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-change",
      parent_task_id: "legacy", parent_changeset_id: "legacy-change",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "legacy", changeset_id: "reused-change", tier: "T2",
        authorized_paths: ["src/x.mjs"] }, owner_evidence: "invalid identity reuse",
    }, options(ctx.dir)).state, "aggregate-legacy-handoff-conflict");
    assert.equal(recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-change",
      parent_task_id: "legacy", parent_changeset_id: "legacy-change",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "unique-child", changeset_id: "legacy-change", tier: "T2",
        authorized_paths: ["src/x.mjs"] }, owner_evidence: "invalid changeset reuse",
    }, options(ctx.dir)).state, "aggregate-legacy-handoff-conflict");

    const handoff = recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-change",
      parent_task_id: "legacy", parent_changeset_id: "legacy-change",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "aggregate-child", changeset_id: "aggregate-change", tier: "T2",
        authorized_paths: ["src/x.mjs"] }, owner_evidence: "Owner legacy handoff",
    }, options(ctx.dir));
    assert.equal(handoff.ok, true, handoff.state);
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(readRepairEvents(ledger).length, 1, "aggregate envelope stays out of the standard projection");
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/x.mjs", {
      aggregateEvents: loaded.aggregate_events,
    }).owners, [], "handoff ends legacy ownership atomically without granting child repair authority");
    assert.equal(verifyRepairWorkerWrite({
      task_id: "legacy", session_id: "legacy-session", target: "src/x.mjs",
    }, { projectRoot: ctx.dir }).state, "repair-program-handed-off",
    "the old standard worker cannot keep writing after handoff");
    const owner = recordOwnerExtension({
      task_id: "legacy", changeset_id: "legacy-change", after_round: 1,
      authority_kind: "close", owner_evidence: "Owner closes after handoff",
    }, options(ctx.dir, "owner"));
    assert.equal(owner.ok, true, owner.state);
    assert.equal(recordRepairClose({
      task_id: "legacy", changeset_id: "legacy-change", after_round: 1,
      reason: "closed after durable handoff", owner_close_event_id: owner.event_id,
    }, options(ctx.dir, "closer")).ok, true);
    const afterClose = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState(afterClose.aggregate_events, "aggregate-child", {
      standardEvents: afterClose.events,
    }).lineage_event_id, null, "lineage is reserved before its first panel opens");
    assert.equal(openPanel(ctx, 1, candidate, {}, false, {
      task_id: "aggregate-child", changeset_id: "aggregate-change",
      legacy_handoff_event_id: handoff.event_id,
    }).opened.ok, true);
    assert.equal(readFileSync(ledger, "utf8").split("\n").filter(Boolean).length, 5);
  } finally { ctx.cleanup(); }
});
