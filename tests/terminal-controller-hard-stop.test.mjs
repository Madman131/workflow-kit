import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGGREGATE_POLICY_VERSION, activeRepairPathOwners, confirmRepairBrief, deriveAggregateRepairState,
  derivePendingLineageBudgets, fingerprintCandidate,
  loadRepairEventsForProject, readRepairEvents, recordAggregateChildContinuation as _rawChildContinuation,
  recordAggregateClose, recordAggregateDisposition, recordAggregateLegacyHandoff, recordAggregatePanelClose,
  recordAggregatePanelOpen, recordAggregateProcessReview, recordAggregateRootExit, recordAggregateWorkerHandoff,
  recordOwnerExtension, recordRepairClose, recordRoundDisposition, recordWorkerVerification,
  repairLedgerPath, validateAggregateDispatch, verifyRepairWorkerWrite,
} from "../hooks/repair-dispatch-state.mjs";

// A minted successor now REQUIRES a structured action_screen (screen-at-emission enforcement,
// FM-2026-08-27-17). These tests exercise successor MECHANICS, not the screen, so a valid default is
// injected here; a call still overrides it (e.g. `action_screen: undefined` for the refusal case).
const _DEFAULT_CONTINUATION_SCREEN = { surviving_finding_ids: [], harm: "n/a — mechanics fixture",
  trigger: "n/a — mechanics fixture", smallest_action: "the narrow successor", kiss: "no new machinery",
  zoom_out: "still the asked-for work" };
const recordAggregateChildContinuation = (input, opts) =>
  _rawChildContinuation({ action_screen: _DEFAULT_CONTINUATION_SCREEN, ...input }, opts);

const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const eventId = (event) => createHash("sha256").update(stable(event)).digest("hex");
const stamped = (event) => ({ event_id: eventId(event), event });
const options = (dir, sessionId = "orchestrator") => ({ projectRoot: dir, sessionId });

function rewriteAggregateLedgerAsLegacy(dir) {
  const remap = new Map();
  const rewrite = (value) => Array.isArray(value) ? value.map(rewrite)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]))
      : typeof value === "string" ? (remap.get(value) ?? value) : value;
  const rows = loadRepairEventsForProject(dir).aggregate_events.map((row) => {
    const event = rewrite(row.event);
    delete event.policy_version;
    const legacy = stamped(event);
    remap.set(row.event_id, legacy.event_id);
    return legacy;
  });
  writeFileSync(repairLedgerPath(dir), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return remap;
}

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

function processReview(ctx, panelCloseId, candidate, ruling = "finish_bounded_root",
  task_id = "task-1", changeset_id = "changeset-1") {
  return recordAggregateProcessReview({
    type: "aggregate_v2", kind: "process_review", task_id, changeset_id,
    reviewer_role: "frontier", panel_close_event_id: panelCloseId,
    frozen_commit: candidate.commit, frozen_tree: candidate.tree,
    review_evidence: "frontier review of the completed aggregate panel",
    zoom_out: "the correction stays tied to the requested outcome",
    ruling, bounded_scope: "one consolidated correction",
    closure_evidence: "the original accepted triggers no longer fire",
  }, options(ctx.dir));
}

function rootExit(ctx, dispositionId) {
  return recordAggregateRootExit({
    type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
    disposition_event_id: dispositionId, shared_mechanism: "one shared controller defect",
    symptom_explanation: "prior repairs treated symptoms", owner_state_yield_seams: ["owner/state seam"],
    replacement: "one bounded correction", removed_workarounds: ["repeat patch"],
    trigger_matrix: ["the original trigger closes"], closure_evidence: "candidate evidence closes the trigger",
  }, options(ctx.dir));
}

function threeGateParent(ctx, { terminal = false } = {}) {
  let candidate = commit(ctx.dir, 1);
  let panel = openPanel(ctx, 1, candidate);
  let closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
  let decided = disposition(ctx, closed.closed, { accepted: ["F1"] });
  let authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 2);
  candidate = commit(ctx.dir, 2);
  panel = openPanel(ctx, 2, candidate, authority);
  closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F2");
  decided = disposition(ctx, closed.closed, { accepted: ["F2"], remediation_kind: "root_replacement" });
  const roundTwoExit = rootExit(ctx, decided.event_id);
  assert.equal(roundTwoExit.ok, true, roundTwoExit.state);
  authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 3, roundTwoExit.event_id);
  candidate = commit(ctx.dir, 3);
  panel = openPanel(ctx, 3, candidate, authority);
  closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F3");
  decided = disposition(ctx, closed.closed, terminal ? {
    accepted: ["F3"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [],
  } : { accepted: ["F3"], remediation_kind: "root_replacement" });
  assert.equal(decided.ok, true, decided.state);
  const exit = terminal ? null : rootExit(ctx, decided.event_id);
  if (exit) assert.equal(exit.ok, true, exit.state);
  return { candidate, closed: closed.closed, decided, exit };
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
        accepted: [`F${round}`], remediation_kind: "root_replacement",
      });
      assert.equal(decided.ok, true, decided.state);
      let root = null;
      if (round >= 2) {
        const exit = recordAggregateRootExit({
          type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
          disposition_event_id: decided.event_id, shared_mechanism: "one shared controller defect",
          symptom_explanation: "prior fixes patched symptoms", owner_state_yield_seams: ["owner/state seam"],
          replacement: "one finite state machine", removed_workarounds: ["circular cadence"],
          trigger_matrix: ["R4 has no outgoing dispatch"],
          closure_evidence: "the original trigger matrix closes on the replacement candidate",
        }, options(ctx.dir));
        assert.equal(exit.ok, true, exit.state); root = exit.event_id;
      }
      let review = null;
      if (round === 3) {
        const recorded = processReview(ctx, closed.closed.event_id, candidate);
        assert.equal(recorded.ok, true, recorded.state); review = recorded.event_id;
      }
      mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
      const brief = `briefs/round-${round + 1}.md`;
      writeFileSync(path.join(ctx.dir, brief), `repair ${round + 1}\n`);
      const receipt = confirmRepairBrief({ declaration: {
        aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
        disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
        next_round: round + 1, root_exit_event_id: root, process_review_event_id: review,
      }, brief_path: brief }, options(ctx.dir));
      assert.equal(receipt.ok, true, receipt.state);
      const worker = recordWorkerVerification({ task_id: "task-1", repair_dispatch_event_id: receipt.event_id },
        options(ctx.dir, `worker-${round + 1}`));
      assert.equal(worker.ok, true, worker.state);
      authority = { dispatch: receipt.event_id, worker: worker.event_id };
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
        { task_id: "child-a", changeset_id: "child-a-change", tier: "T2", budget: "one changeset", authorized_paths: candidate.paths },
        { task_id: "child-b", changeset_id: "child-b-change", tier: "T2", budget: "one changeset", authorized_paths: ["src/y.mjs"] },
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
        budget: "one changeset", authorized_paths: ["briefs/round-4.md"] },
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
        { task_id: "child-c", changeset_id: "child-a-change", tier: "T2", budget: "one changeset", authorized_paths: ["src/z.mjs"] },
        { task_id: "child-d", changeset_id: "child-d-change", tier: "T2", budget: "one changeset", authorized_paths: ["src/w.mjs"] },
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
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "panel_close", task_id: "task-1", changeset_id: "changeset-1",
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
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "disposition", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:01.000Z", session_id: "mutant",
      panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: [], declined: [], note: [], followup: [] },
      same_mechanism_repeated: false,
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
    decided = disposition(ctx, closed.closed, { accepted: ["F2"], remediation_kind: "root_replacement" });
    let exit = recordAggregateRootExit({
      type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, shared_mechanism: "one root",
      symptom_explanation: "symptoms only", owner_state_yield_seams: ["one seam"],
      replacement: "one replacement", removed_workarounds: ["patch loop"], trigger_matrix: ["final stop"],
      closure_evidence: "the replacement closes the repeated trigger",
    }, options(ctx.dir));
    assert.equal(exit.ok, true, exit.state);
    authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 3, exit.event_id);
    candidate = commit(ctx.dir, 3);
    panel = openPanel(ctx, 3, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F3");
    const boundedR3 = stamped({
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "disposition", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:02.000Z", session_id: "mutant",
      panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F3"], declined: [], note: [], followup: [] },
      same_mechanism_repeated: false,
      terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: ["src/x.mjs"],
    });
    loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, boundedR3], "task-1", {
      standardEvents: loaded.events,
    }).dispositions.length, 2);
    mutant = await importMutant(mutantDir, [[
      'open.round === 3) {\n        valid = row.terminal_state === "CONTINUE" &&\n          ["root_replacement", "simplification", "split"].includes(row.remediation_kind)',
      'open.round === 3) {\n        valid = row.terminal_state === "CONTINUE" &&\n          ["root_replacement", "simplification", "split", "bounded"].includes(row.remediation_kind)',
    ]]);
    assert.equal(mutant.deriveAggregateRepairState([...loaded.aggregate_events, boundedR3], "task-1", {
      standardEvents: loaded.events,
    }).dispositions.length, 3, "weakening the third-batch kind admits a bounded batch 3");

    decided = disposition(ctx, closed.closed, { accepted: ["F3"], remediation_kind: "root_replacement" });
    exit = recordAggregateRootExit({
      type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, shared_mechanism: "one root",
      symptom_explanation: "symptoms only", owner_state_yield_seams: ["one seam"],
      replacement: "one replacement", removed_workarounds: ["patch loop"], trigger_matrix: ["final stop"],
      closure_evidence: "the replacement closes the final repair trigger",
    }, options(ctx.dir));
    assert.equal(exit.ok, true, exit.state);
    const review = processReview(ctx, closed.closed.event_id, candidate);
    assert.equal(review.ok, true, review.state);
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs/round-4.md"), "repair 4\n");
    const round4 = confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
      next_round: 4, root_exit_event_id: exit.event_id, process_review_event_id: review.event_id,
    }, brief_path: "briefs/round-4.md" }, options(ctx.dir));
    assert.equal(round4.ok, true, round4.state);
    const round4Worker = recordWorkerVerification({ task_id: "task-1", repair_dispatch_event_id: round4.event_id },
      options(ctx.dir, "worker-4"));
    assert.equal(round4Worker.ok, true, round4Worker.state);
    authority = { dispatch: round4.event_id, worker: round4Worker.event_id };
    candidate = commit(ctx.dir, 4);
    panel = openPanel(ctx, 4, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "FINAL");
    decided = disposition(ctx, closed.closed, {
      accepted: ["FINAL"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [],
    });
    const finalDispatch = stamped({
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "dispatch", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:03.000Z", session_id: "mutant",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
      source_round: 4, next_round: 5, authorized_paths: [], root_exit_event_id: null,
      process_review_event_id: null,
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
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: at, session_id: "mutant", parent_disposition_event_id: decided.event_id,
      parent_frozen_commit: candidate.commit, parent_frozen_tree: candidate.tree,
      trigger_ids: [trigger], continuation_kind: "new_changeset", owner_evidence: "Owner continuation",
      process_review_event_id: null,
      children: [{ task_id: child, changeset_id: `${child}-change`, tier: "T2", budget: "one changeset", authorized_paths: candidate.paths }],
    });
    const wrong = continuation("WRONG", "wrong-child", "2099-01-01T00:00:04.000Z");
    const correct = continuation("FINAL", "correct-child", "2099-01-01T00:00:05.000Z");
    const childOpen = (task_id, continuationId, at) => stamped({
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "panel_open", task_id, changeset_id: `${task_id}-change`,
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

test("live policy rejects downgrade, repeated R1 bounded repair, and root exit without closure proof", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const oldDisposition = stamped({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "old-writer",
      panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] },
      terminal_state: "CONTINUE", remediation_kind: "root_replacement", authorized_paths: ["src/x.mjs"],
    });
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState([...loaded.aggregate_events, oldDisposition], "task-1", {
      standardEvents: loaded.events,
    }).dispositions.length, 0, "an absent-version row cannot downgrade a live lineage");
    assert.equal(recordAggregateDisposition({
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "changeset-1",
      panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] },
      same_mechanism_repeated: true, terminal_state: "CONTINUE", remediation_kind: "bounded",
      authorized_paths: ["src/x.mjs"],
    }, options(ctx.dir)).ok, false, "declared recurrence at R1 requires a root kind");
    const rootDisposition = disposition(ctx, closed.closed, {
      accepted: ["F1"], remediation_kind: "root_replacement",
    });
    assert.equal(rootDisposition.ok, true, rootDisposition.state);
    const missingClosure = recordAggregateRootExit({
      type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: rootDisposition.event_id, shared_mechanism: "one root",
      symptom_explanation: "the earlier branch was symptomatic", owner_state_yield_seams: ["one seam"],
      replacement: "one replacement", removed_workarounds: ["branch patch"], trigger_matrix: ["original trigger"],
    }, options(ctx.dir));
    assert.equal(missingClosure.state, "aggregate-root-exit-malformed");
  } finally { ctx.cleanup(); }
});

for (const ruling of ["successor", "owner_decision"]) {
  test(`an R2 ${ruling} process ruling binds and cannot be bypassed by an omitted receipt`, () => {
    const ctx = repo();
    try {
      let candidate = commit(ctx.dir, 1);
      let panel = openPanel(ctx, 1, candidate);
      let closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
      let decided = disposition(ctx, closed.closed, { accepted: ["F1"] });
      const authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 2);
      candidate = commit(ctx.dir, 2);
      panel = openPanel(ctx, 2, candidate, authority);
      closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F2");
      assert.equal(disposition(ctx, closed.closed, { accepted: ["F2"] }).ok, false,
        "a harm-bearing R2 cannot remain a bounded branch repair");
      decided = disposition(ctx, closed.closed, { accepted: ["F2"], remediation_kind: "root_replacement" });
      assert.equal(decided.ok, true, decided.state);
      const exit = recordAggregateRootExit({
        type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
        disposition_event_id: decided.event_id, shared_mechanism: "one repeated root",
        symptom_explanation: "two rounds exposed the shared mechanism", owner_state_yield_seams: ["one seam"],
        replacement: "one bounded replacement", removed_workarounds: ["branch repairs"],
        trigger_matrix: ["original harm"], closure_evidence: "the replacement closes the original harm",
      }, options(ctx.dir));
      assert.equal(exit.ok, true, exit.state);
      const review = processReview(ctx, closed.closed.event_id, candidate, ruling);
      assert.equal(review.ok, true, review.state);
      mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
      writeFileSync(path.join(ctx.dir, "briefs/held.md"), "held repair\n");
      for (const processId of [null, review.event_id]) {
        const receipt = confirmRepairBrief({ declaration: {
          aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
          disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
          next_round: 3, root_exit_event_id: exit.event_id, process_review_event_id: processId,
        }, brief_path: "briefs/held.md" }, options(ctx.dir));
        assert.equal(receipt.state, "aggregate-process-review-required");
      }
      if (ruling === "successor") {
        const closedProgram = recordAggregateClose({
          type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "changeset-1",
          disposition_event_id: decided.event_id, reason: "frontier ruled successor",
          owner_evidence: "Owner closes current repair",
        }, options(ctx.dir, "owner"));
        assert.equal(closedProgram.ok, true, closedProgram.state);
        const continuation = recordAggregateChildContinuation({
          type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
          parent_disposition_event_id: decided.event_id, trigger_ids: ["F2"],
          continuation_kind: "new_changeset", owner_evidence: "Owner records future work",
          process_review_event_id: review.event_id,
          children: [{ task_id: "successor", changeset_id: "successor-cs", tier: "T2",
            budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
        }, options(ctx.dir));
        assert.equal(continuation.ok, true, continuation.state);
      }
    } finally { ctx.cleanup(); }
  });
}

test("legacy aggregate replay accepts a root exit that predates closure evidence", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const decided = disposition(ctx, closed.closed, { accepted: ["F1"], remediation_kind: "root_replacement" });
    const exit = recordAggregateRootExit({
      type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, shared_mechanism: "one root", symptom_explanation: "symptoms",
      owner_state_yield_seams: ["seam"], replacement: "replacement", removed_workarounds: ["patch"],
      trigger_matrix: ["trigger"], closure_evidence: "proof",
    }, options(ctx.dir));
    assert.equal(exit.ok, true, exit.state);
    const live = loadRepairEventsForProject(ctx.dir).aggregate_events.map((row) => row.event);
    const oldRows = [];
    const remap = new Map();
    for (const event of live) {
      const old = structuredClone(event);
      delete old.policy_version;
      if (old.panel_open_event_id) old.panel_open_event_id = remap.get(old.panel_open_event_id) ?? old.panel_open_event_id;
      if (old.panel_close_event_id) old.panel_close_event_id = remap.get(old.panel_close_event_id) ?? old.panel_close_event_id;
      if (old.disposition_event_id) old.disposition_event_id = remap.get(old.disposition_event_id) ?? old.disposition_event_id;
      if (old.kind === "root_exit") delete old.closure_evidence;
      const row = stamped(old);
      remap.set(eventId(event), row.event_id);
      oldRows.push(row);
    }
    const replay = deriveAggregateRepairState(oldRows, "task-1");
    assert.equal(replay.root_exits.length, 1, "old replay keeps the pre-field root exit valid");
    assert.equal(replay.policy_version, 1);
  } finally { ctx.cleanup(); }
});

test("the fourth cumulative gate in a descendant needs a fresh process review", () => {
  const ctx = repo();
  try {
    let candidate = commit(ctx.dir, 1);
    let panel = openPanel(ctx, 1, candidate);
    let closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    let decided = disposition(ctx, closed.closed, { accepted: ["F1"] });
    const authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 2);
    candidate = commit(ctx.dir, 2);
    panel = openPanel(ctx, 2, candidate, authority);
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F2");
    decided = disposition(ctx, closed.closed, {
      accepted: ["F2"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [],
    });
    assert.equal(decided.ok, true, decided.state);
    const continuation = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: decided.event_id, trigger_ids: ["F2"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor",
      children: [{ task_id: "child", changeset_id: "child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: candidate.paths }],
    }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
    candidate = commit(ctx.dir, 3);
    panel = openPanel(ctx, 1, candidate, {}, false, {
      task_id: "child", changeset_id: "child-cs", child_continuation_event_id: continuation.event_id,
    });
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F3", {
      task_id: "child", changeset_id: "child-cs",
    });
    decided = disposition(ctx, closed.closed, {
      task_id: "child", changeset_id: "child-cs", accepted: ["F3"],
    });
    assert.equal(decided.ok, true, decided.state);
    let state = deriveAggregateRepairState(loadRepairEventsForProject(ctx.dir).aggregate_events, "child");
    assert.equal(state.current_gate_ordinal, 3);
    assert.equal(state.next_gate_ordinal, 4);
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs/child-2.md"), "child repair\n");
    const declaration = {
      aggregate_controller: "aggregate_v2", task_id: "child", changeset_id: "child-cs",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 2,
      root_exit_event_id: null,
    };
    assert.equal(confirmRepairBrief({ declaration, brief_path: "briefs/child-2.md" },
      options(ctx.dir)).state, "aggregate-process-review-required");
    const review = processReview(ctx, closed.closed.event_id, candidate, "finish_bounded_root", "child", "child-cs");
    assert.equal(review.ok, true, review.state);
    assert.equal(review.next_gate_ordinal, 4);
    assert.equal(confirmRepairBrief({ declaration: { ...declaration, process_review_event_id: review.event_id },
      brief_path: "briefs/child-2.md" }, options(ctx.dir)).ok, true);
  } finally { ctx.cleanup(); }
});

test("a live dispatch cannot bypass the gate-4 review on a pre-policy three-gate parent", () => {
  const ctx = repo();
  try {
    const parent = threeGateParent(ctx);
    const remap = rewriteAggregateLedgerAsLegacy(ctx.dir);
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    const brief = "briefs/legacy-round-4.md";
    writeFileSync(path.join(ctx.dir, brief), "legacy parent repair 4\n");
    const declaration = {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: remap.get(parent.decided.event_id),
      panel_close_event_id: remap.get(parent.closed.event_id), next_round: 4,
      root_exit_event_id: remap.get(parent.exit.event_id),
    };
    let loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(deriveAggregateRepairState(loaded.aggregate_events, "task-1").policy_version, 1);
    assert.equal(validateAggregateDispatch(declaration, {
      aggregateEvents: loaded.aggregate_events, standardEvents: loaded.events,
      taskId: "task-1", targetKind: "brief", target: brief,
    }).state, "aggregate-process-review-required");
    assert.equal(confirmRepairBrief({ declaration, brief_path: brief }, options(ctx.dir)).state,
      "aggregate-process-review-required");

    const bytes = readFileSync(path.join(ctx.dir, brief));
    const planted = {
      type: "aggregate_v2", policy_version: AGGREGATE_POLICY_VERSION, kind: "dispatch",
      task_id: "task-1", changeset_id: "changeset-1", recorded_at: "2099-01-01T00:00:00.000Z",
      session_id: "planted", disposition_event_id: declaration.disposition_event_id,
      panel_close_event_id: declaration.panel_close_event_id, source_round: 3, next_round: 4,
      authorized_paths: parent.candidate.paths, root_exit_event_id: declaration.root_exit_event_id,
      process_review_event_id: null, target_kind: "brief", target: brief,
      brief_sha256: createHash("sha256").update(bytes).digest("hex"), brief_size: bytes.length,
    };
    writeFileSync(repairLedgerPath(ctx.dir), `${JSON.stringify(stamped(planted))}\n`, { flag: "a" });
    loaded = loadRepairEventsForProject(ctx.dir);
    const replay = deriveAggregateRepairState(loaded.aggregate_events, "task-1");
    assert.equal(replay.active_dispatch, null, "the live row is inert when replayed against the old parent");
    assert.equal(replay.dispatches.length, 2, "only the two historical dispatches survive replay");

    const review = processReview(ctx, declaration.panel_close_event_id, parent.candidate);
    assert.equal(review.ok, true, review.state);
    const confirmed = confirmRepairBrief({ declaration: {
      ...declaration, process_review_event_id: review.event_id,
    }, brief_path: brief }, options(ctx.dir));
    assert.equal(confirmed.ok, true, confirmed.state);
  } finally { ctx.cleanup(); }
});

test("a live successor cannot bypass the gate-4 review on a pre-policy three-gate parent", () => {
  const ctx = repo();
  try {
    const parent = threeGateParent(ctx, { terminal: true });
    const remap = rewriteAggregateLedgerAsLegacy(ctx.dir);
    const continuation = {
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: remap.get(parent.decided.event_id), trigger_ids: ["F3"],
      continuation_kind: "new_changeset", owner_evidence: "Owner chose the bounded successor",
      children: [{ task_id: "legacy-child", changeset_id: "legacy-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: parent.candidate.paths }],
    };
    assert.equal(recordAggregateChildContinuation(continuation, options(ctx.dir)).state,
      "aggregate-continuation-conflict");
    const planted = {
      ...continuation, policy_version: AGGREGATE_POLICY_VERSION,
      parent_frozen_commit: parent.candidate.commit, parent_frozen_tree: parent.candidate.tree,
      process_review_event_id: null, action_screen: _DEFAULT_CONTINUATION_SCREEN,
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "planted",
    };
    writeFileSync(repairLedgerPath(ctx.dir), `${JSON.stringify(stamped(planted))}\n`, { flag: "a" });
    let loaded = loadRepairEventsForProject(ctx.dir);
    assert.deepEqual(derivePendingLineageBudgets(loaded.aggregate_events), [],
      "the unreviewed live successor is inert on replay");
    const review = processReview(ctx, remap.get(parent.closed.event_id), parent.candidate, "successor");
    assert.equal(review.ok, true, review.state);
    const recorded = recordAggregateChildContinuation({
      ...continuation, process_review_event_id: review.event_id,
    }, options(ctx.dir));
    assert.equal(recorded.ok, true, recorded.state);
    loaded = loadRepairEventsForProject(ctx.dir);
    assert.deepEqual(derivePendingLineageBudgets(loaded.aggregate_events).map((row) => row.task_id),
      ["legacy-child"]);
  } finally { ctx.cleanup(); }
});

test("owner_decision blocks current dispatch but permits an Owner-evidenced terminal continuation", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const decided = disposition(ctx, closed.closed, { accepted: ["F1"] });
    assert.equal(decided.ok, true, decided.state);
    const review = processReview(ctx, closed.closed.event_id, candidate, "owner_decision");
    assert.equal(review.ok, true, review.state);
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs/owner-decision.md"), "repair\n");
    assert.equal(confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
      next_round: 2, root_exit_event_id: null, process_review_event_id: review.event_id,
    }, brief_path: "briefs/owner-decision.md" }, options(ctx.dir)).state,
    "aggregate-process-review-required");
    const closedProgram = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, reason: "Owner chose a successor instead of current repair",
      owner_evidence: "Owner decision receipt",
    }, options(ctx.dir, "owner"));
    assert.equal(closedProgram.ok, true, closedProgram.state);
    const continuation = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: decided.event_id, process_review_event_id: review.event_id,
      trigger_ids: ["F1"], continuation_kind: "new_changeset", owner_evidence: "Owner decision receipt",
      children: [{ task_id: "owner-child", changeset_id: "owner-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: candidate.paths }],
    }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
  } finally { ctx.cleanup(); }
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
      child: { task_id: "legacy", changeset_id: "reused-change", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }, owner_evidence: "invalid identity reuse",
    }, options(ctx.dir)).state, "aggregate-legacy-handoff-conflict");
    assert.equal(recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-change",
      parent_task_id: "legacy", parent_changeset_id: "legacy-change",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "unique-child", changeset_id: "legacy-change", tier: "T2", budget: "one changeset",
        authorized_paths: ["src/x.mjs"] }, owner_evidence: "invalid changeset reuse",
    }, options(ctx.dir)).state, "aggregate-legacy-handoff-conflict");

    const handoff = recordAggregateLegacyHandoff({
      type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy", changeset_id: "legacy-change",
      parent_task_id: "legacy", parent_changeset_id: "legacy-change",
      parent_candidate_sha: manifest.digest, authorized_paths: ["src/x.mjs"],
      child: { task_id: "aggregate-child", changeset_id: "aggregate-change", tier: "T2", budget: "one changeset",
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
