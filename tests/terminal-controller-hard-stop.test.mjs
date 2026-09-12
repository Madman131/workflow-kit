import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGGREGATE_POLICY_VERSION, activeRepairPathOwners, aggregateTransitionSha256, confirmRepairBrief, deriveAggregateRepairState,
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
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    if (event.kind === "dispatch") delete event.process_review_event_id;
    if (event.kind === "disposition") delete event.same_mechanism_repeated;
    const legacy = stamped(event);
    remap.set(row.event_id, legacy.event_id);
    return legacy;
  });
  writeFileSync(repairLedgerPath(dir), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return remap;
}

function rewriteAggregateLedgerWithHistoricalUntypedReview(dir) {
  const remap = new Map();
  const rewrite = (value) => Array.isArray(value) ? value.map(rewrite)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]))
      : typeof value === "string" ? (remap.get(value) ?? value) : value;
  const rows = loadRepairEventsForProject(dir).aggregate_events.map((row) => {
    const event = rewrite(row.event);
    if (event.kind === "process_review") {
      event.panel_close_event_id = event.anchor.event_id;
      event.frozen_commit = event.anchor.frozen_commit;
      event.frozen_tree = event.anchor.frozen_tree;
      delete event.anchor;
      delete event.purpose;
      delete event.transition_sha256;
    }
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

function commitSource(dir, value) {
  writeFileSync(path.join(dir, "src", "x.mjs"), `export const x = ${value};\n`);
  execFileSync("git", ["add", "src/x.mjs"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", `source-candidate-${value}`], { cwd: dir });
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir, encoding: "utf8" }).trim(),
    paths: execFileSync("git", ["diff", "--name-only", "origin/main..HEAD"],
      { cwd: dir, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort(),
  };
}

function commitSelected(dir, value, paths) {
  writeFileSync(path.join(dir, "src", "x.mjs"), `export const x = ${value};\n`);
  execFileSync("git", ["add", "src/x.mjs", ...paths], { cwd: dir });
  execFileSync("git", ["commit", "--no-verify", "-qm", `selected-candidate-${value}`], { cwd: dir });
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
  authorized_paths = ["src/x.mjs"], same_mechanism_repeated = false,
} = {}) {
  return recordAggregateDisposition({
    type: "aggregate_v2", kind: "disposition", task_id, changeset_id,
    panel_close_event_id: closed.event_id, pm_findings,
    finding_dispositions: { accepted, declined, note, followup }, terminal_state, remediation_kind,
    authorized_paths, same_mechanism_repeated,
  }, options(ctx.dir));
}

function dispatch(ctx, dispositionId, panelId, nextRound, rootExitId = null, processReviewId = null) {
  mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
  const brief = `briefs/round-${nextRound}.md`;
  writeFileSync(path.join(ctx.dir, brief), `repair ${nextRound}\n`);
  const receipt = confirmRepairBrief({ declaration: {
    aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
    disposition_event_id: dispositionId, panel_close_event_id: panelId,
    next_round: nextRound, root_exit_event_id: rootExitId, process_review_event_id: processReviewId,
  }, brief_path: brief }, options(ctx.dir));
  assert.equal(receipt.ok, true, receipt.state);
  const worker = recordWorkerVerification({
    task_id: "task-1", repair_dispatch_event_id: receipt.event_id,
  }, options(ctx.dir, `worker-${nextRound}`));
  assert.equal(worker.ok, true, worker.state);
  return { dispatch: receipt.event_id, worker: worker.event_id };
}

function dispatchChild(ctx, { task_id, changeset_id, disposition_event_id, panel_close_event_id,
  next_round, root_exit_event_id = null, process_review_event_id = null }) {
  mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
  const brief = `briefs/${task_id}-round-${next_round}.md`;
  writeFileSync(path.join(ctx.dir, brief), `${task_id} repair ${next_round}\n`);
  const receipt = confirmRepairBrief({ declaration: {
    aggregate_controller: "aggregate_v2", task_id, changeset_id, disposition_event_id,
    panel_close_event_id, next_round, root_exit_event_id, process_review_event_id,
  }, brief_path: brief }, options(ctx.dir));
  assert.equal(receipt.ok, true, receipt.state);
  const worker = recordWorkerVerification({ task_id, repair_dispatch_event_id: receipt.event_id },
    options(ctx.dir, `${task_id}-worker-${next_round}`));
  assert.equal(worker.ok, true, worker.state);
  return { dispatch: receipt.event_id, worker: worker.event_id };
}

function rootExitChild(ctx, task_id, changeset_id, disposition_event_id) {
  const result = recordAggregateRootExit({
    type: "aggregate_v2", kind: "root_exit", task_id, changeset_id, disposition_event_id,
    shared_mechanism: "one shared controller defect", symptom_explanation: "prior repairs treated symptoms",
    owner_state_yield_seams: ["owner/state seam"], replacement: "one bounded correction",
    removed_workarounds: ["repeat patch"], trigger_matrix: ["the original trigger closes"],
    closure_evidence: "candidate evidence closes the trigger",
  }, options(ctx.dir));
  assert.equal(result.ok, true, result.state);
  return result;
}

function processReview(ctx, panelCloseId, candidate, ruling = "finish_bounded_root",
  task_id = "task-1", changeset_id = "changeset-1", purpose = "dispatch", proposed = null) {
  const loaded = loadRepairEventsForProject(ctx.dir);
  const state = deriveAggregateRepairState(loaded.aggregate_events, task_id, { standardEvents: loaded.events });
  const root = state.root_exits.find((row) => row.disposition_event_id === state.latest?.event_id);
  const proposed_transition = proposed ?? {
    disposition_event_id: state.latest.event_id, panel_close_event_id: panelCloseId,
    source_round: state.latest.round, next_round: state.latest.round + 1,
    root_exit_event_id: root?.event_id ?? null, authorized_paths: state.latest.authorized_paths,
  };
  return recordAggregateProcessReview({
    type: "aggregate_v2", kind: "process_review", task_id, changeset_id,
    reviewer_role: "frontier", purpose, proposed_transition,
    anchor: purpose === "dispatch"
      ? { kind: "aggregate_panel_close", event_id: panelCloseId,
        frozen_commit: candidate.commit, frozen_tree: candidate.tree }
      : { kind: "aggregate_terminal", event_id: state.terminal === "CLOSED"
          ? state.closes.at(-1).event_id : state.latest.event_id,
        panel_open_event_id: state.panels_open.at(-1).event_id,
        frozen_commit: state.panels_open.at(-1).frozen_commit,
        frozen_tree: state.panels_open.at(-1).frozen_tree },
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

function fourGateStopParent(ctx) {
  const third = threeGateParent(ctx);
  const review = processReview(ctx, third.closed.event_id, third.candidate);
  assert.equal(review.ok, true, review.state);
  const authority = dispatch(ctx, third.decided.event_id, third.closed.event_id, 4, third.exit.event_id, review.event_id);
  const candidate = commit(ctx.dir, 4);
  const panel = openPanel(ctx, 4, candidate, authority);
  const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "FINAL");
  const decided = disposition(ctx, closed.closed, {
    accepted: ["FINAL"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [],
  });
  assert.equal(decided.ok, true, decided.state);
  return { candidate, decided };
}

test("a terminal R4 STOP admits one verified completion batch and one final child review", () => {
  const ctx = repo();
  try {
    const parent = fourGateStopParent(ctx);
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs", "completion.md"), "rerun FINAL after the narrow correction\n");
    const completionPaths = [...parent.candidate.paths, "briefs/completion.md", "src/unused.mjs"].sort();
    const exception = {
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: parent.decided.event_id, trigger_ids: ["FINAL"],
      continuation_kind: "completion_exception", owner_evidence: "Owner approved this exact finish",
      action_screen: { ..._DEFAULT_CONTINUATION_SCREEN, surviving_finding_ids: ["FINAL"] },
      children: [{ task_id: "finish-child", changeset_id: "finish-child-cs", tier: "T2",
        budget: "one repair batch and final review", authorized_paths: completionPaths }],
      completion_exception: { repair_batches: 1, pm_recommendation: "one narrow repair is warranted",
        surviving_harm: "FINAL still harms the terminal outcome", smallest_correction: "repair only src/x.mjs",
        completion_proof: "rerun FINAL and collect the full final panel" },
      completion_batch: { worker_session_id: "finish-worker", brief_path: "briefs/completion.md" },
    };
    assert.doesNotThrow(() => assert.equal(recordAggregateChildContinuation({ ...exception, children: [] }, options(ctx.dir)).state,
      "aggregate-continuation-malformed"), "an empty completion child list is a typed refusal, not a throw");
    assert.equal(recordAggregateChildContinuation({ ...exception, owner_evidence: "" }, options(ctx.dir)).state,
      "aggregate-continuation-conflict", "Owner evidence is mandatory for the exception");
    writeFileSync(path.join(ctx.dir, "briefs", "completion.md"), "changed after the proposal\n");
    assert.equal(recordAggregateChildContinuation(exception, options(ctx.dir)).state, "aggregate-continuation-conflict",
      "a changed brief cannot reuse the proposed exception authority");
    writeFileSync(path.join(ctx.dir, "briefs", "completion.md"), "rerun FINAL after the narrow correction\n");
    assert.equal(recordAggregateChildContinuation(exception, options(ctx.dir)).state,
      "aggregate-continuation-conflict", "fresh Astra review is required before exception work authority");
    const review = processReview(ctx, null, parent.candidate, "owner_decision", "task-1", "changeset-1",
      "child_continuation", exception);
    assert.equal(review.ok, true, review.state);
    writeFileSync(path.join(ctx.dir, "briefs", "completion.md"), "mutated after the approved proposal\n");
    assert.equal(recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id }, options(ctx.dir)).state,
      "aggregate-continuation-conflict", "the approved proposal cannot authorize changed brief bytes");
    writeFileSync(path.join(ctx.dir, "briefs", "completion.md"), "rerun FINAL after the narrow correction\n");
    assert.equal(recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id,
      children: [{ ...exception.children[0], tier: "T1" }] }, options(ctx.dir)).state,
    "aggregate-continuation-malformed", "the exception child cannot lower the terminal parent's tier");
    assert.equal(recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id,
      completion_exception: { ...exception.completion_exception, completion_proof: "" } }, options(ctx.dir)).state,
    "aggregate-continuation-conflict", "completion proof is required before exception work authority");
    assert.equal(recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id,
      owner_evidence: "different Owner evidence" }, options(ctx.dir)).state,
    "aggregate-continuation-conflict", "the review binds the exact Owner evidence for this exception");
    assert.equal(recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id,
      children: [{ ...exception.children[0], authorized_paths: exception.children[0].authorized_paths.filter((entry) => entry !== "src/unused.mjs") }] }, options(ctx.dir)).state,
    "aggregate-continuation-conflict", "a narrower completion re-mint cannot replace the approved ceiling");
    const continuation = recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
    assert.equal(recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id,
      completion_exception: { ...exception.completion_exception, smallest_correction: "changed proposal" } }, options(ctx.dir)).state,
    "aggregate-continuation-conflict", "the Astra review is hash-bound to the exact completion proposal");
    assert.equal(recordWorkerVerification({ task_id: "finish-child", repair_dispatch_event_id: continuation.event_id },
      options(ctx.dir, "wrong-worker")).state, "repair-worker-verification-missing");
    const worker = recordWorkerVerification({ task_id: "finish-child", repair_dispatch_event_id: continuation.event_id },
      options(ctx.dir, "finish-worker"));
    assert.equal(worker.ok, true, worker.state);
    assert.equal(verifyRepairWorkerWrite({ task_id: "finish-child", session_id: "finish-worker", target: "src/x.mjs" },
      { projectRoot: ctx.dir }).ok, true);
    assert.equal(verifyRepairWorkerWrite({ task_id: "finish-child", session_id: "finish-worker", target: "src/outside.mjs" },
      { projectRoot: ctx.dir }).state, "repair-worker-path-unauthorized");
    execFileSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", ctx.dir,
      "--repo-name", "completion-guard", "--skip-codex-prompt", "--skip-codex-lane"], { stdio: "pipe" });
    writeFileSync(path.join(ctx.dir, ".claude", "task-lane.json"), JSON.stringify({
      mode: "in-thread", sessionId: "finish-worker", taskId: "finish-child", tier: "T2",
    }));
    const installedGuard = path.join(ctx.dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const invokeInstalledGuard = (target) => spawnSync(process.execPath, [installedGuard, "--project-dir", ctx.dir], {
      input: JSON.stringify({ session_id: "finish-worker", tool_name: "Write", cwd: ctx.dir,
        tool_input: { file_path: path.join(ctx.dir, target) } }), encoding: "utf8",
    });
    const installedAllow = invokeInstalledGuard("src/x.mjs");
    const installedDeny = invokeInstalledGuard("src/outside.mjs");
    assert.equal(installedAllow.status, 0, `installed guard allow execution failed: ${installedAllow.stderr}`);
    assert.equal(installedDeny.status, 0, `installed guard deny execution failed: ${installedDeny.stderr}`);
    assert.doesNotMatch(installedAllow.stdout, /"permissionDecision":"deny"/,
      "the installed guard admits the verified exception worker before its first child panel");
    assert.match(installedDeny.stdout, /outside the exact authorized-path set/,
      "the installed guard denies the completion batch's expanded path before its first child panel");
    let repaired = commitSelected(ctx.dir, 5, ["briefs/completion.md"]);
    const wrongPanel = openPanelInput(ctx, repaired, {
      task_id: "finish-child", changeset_id: "finish-child-cs", child_continuation_event_id: continuation.event_id,
    }, { worker: worker.event_id });
    const finalPanel = { ...wrongPanel, phase: "final_bookend" };
    const emptyPanel = { ...finalPanel, changed_paths: [],
      expected_seats: finalPanel.expected_seats.map((seat) => ({ ...seat, paths: [] })) };
    assert.equal(recordAggregatePanelOpen(emptyPanel, options(ctx.dir)).state,
      "aggregate-panel-open-malformed", "a completion final panel requires a nonempty frozen changed-path set");
    writeFileSync(path.join(ctx.dir, "src", "outside.mjs"), "export const outside = true;\n");
    const outsideCandidate = commitSelected(ctx.dir, 6, ["src/outside.mjs"]);
    const outsidePanel = { ...openPanelInput(ctx, outsideCandidate, {
      task_id: "finish-child", changeset_id: "finish-child-cs", child_continuation_event_id: continuation.event_id,
    }, { worker: worker.event_id }), phase: "final_bookend" };
    assert.equal(recordAggregatePanelOpen(outsidePanel, options(ctx.dir)).state,
      "aggregate-panel-open-conflict", "a completion final panel refuses an actual frozen path outside its approved ceiling");
    unlinkSync(path.join(ctx.dir, "src", "outside.mjs"));
    execFileSync("git", ["add", "-u", "src/outside.mjs"], { cwd: ctx.dir, stdio: "pipe" });
    repaired = commitSelected(ctx.dir, 7, []);
    const narrowedPanel = { ...openPanelInput(ctx, repaired, {
      task_id: "finish-child", changeset_id: "finish-child-cs", child_continuation_event_id: continuation.event_id,
    }, { worker: worker.event_id }), phase: "final_bookend" };
    assert.equal(recordAggregatePanelOpen({ ...narrowedPanel, incoming_worker_event_id: null }, options(ctx.dir)).state,
      "aggregate-panel-open-conflict", "a completion final panel cannot open without the verified batch worker");
    assert.equal(recordAggregatePanelOpen({ ...narrowedPanel, incoming_worker_event_id: "f".repeat(64) }, options(ctx.dir)).state,
      "aggregate-panel-open-conflict", "a syntactically valid but wrong worker receipt cannot open the completion panel");
    const opened = recordAggregatePanelOpen(narrowedPanel, options(ctx.dir));
    assert.equal(opened.ok, true, opened.state);
    assert.equal(verifyRepairWorkerWrite({ task_id: "finish-child", session_id: "finish-worker", target: "src/x.mjs" },
      { projectRoot: ctx.dir }).state, "completion-batch-finished",
    "opening the final panel ends the one completion batch before disposition");
    assert.equal(verifyRepairWorkerWrite({ task_id: "finish-child", session_id: "finish-worker", target: "src/outside.mjs" },
      { projectRoot: ctx.dir }).state, "completion-batch-finished",
    "opening the final panel denies outside-scope writes as well as in-scope writes");
    const postOpenGuard = invokeInstalledGuard("src/x.mjs");
    assert.equal(postOpenGuard.status, 0, `installed guard post-open execution failed: ${postOpenGuard.stderr}`);
    assert.match(postOpenGuard.stdout, /"permissionDecision":"deny"/,
      "the installed guard denies an in-scope completion write after final-panel open");
    assert.equal(recordAggregateClose({ type: "aggregate_v2", kind: "close", task_id: "finish-child",
      changeset_id: "finish-child-cs", panel_open_event_id: opened.event_id, reason: "worker cannot abandon itself",
      owner_evidence: "Owner close evidence" }, options(ctx.dir, "finish-worker")).state,
    "aggregate-close-self-authorized", "the completion batch worker is admitted into the opened child state");
    const closed = closePanel(ctx, opened, finalPanel.expected_seats, repaired, "FINAL-CHILD",
      { task_id: "finish-child", changeset_id: "finish-child-cs" });
    const final = disposition(ctx, closed.closed, {
      task_id: "finish-child", changeset_id: "finish-child-cs", accepted: ["FINAL-CHILD"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [],
    });
    assert.equal(final.ok, true, final.state);
    const child = deriveAggregateRepairState(loadRepairEventsForProject(ctx.dir).aggregate_events, "finish-child", {
      standardEvents: loadRepairEventsForProject(ctx.dir).events,
    });
    assert.equal(child.current_gate_ordinal, 5, "the child continuation itself did not consume an ordinal");
    assert.equal(child.terminal, "STOP", "the one real final child review may STOP but cannot mint a second batch");
    assert.equal(child.active_dispatch, null, "the stopped child retains no dispatch route for another batch");
    assert.ok(child.workers.some((entry) => entry.worker_session_id === "finish-worker"),
      "replay carries the completion worker into the child worker state");
    assert.equal(verifyRepairWorkerWrite({ task_id: "finish-child", session_id: "finish-worker", target: "src/x.mjs" },
      { projectRoot: ctx.dir }).state, "completion-batch-finished",
    "the completion batch remains closed after terminal STOP");
    const postStopGuard = invokeInstalledGuard("src/x.mjs");
    assert.equal(postStopGuard.status, 0, `installed guard post-STOP execution failed: ${postStopGuard.stderr}`);
    assert.match(postStopGuard.stdout, /"permissionDecision":"deny"/,
      "the installed guard denies the completion worker after terminal STOP");
    assert.equal(recordWorkerVerification({ task_id: "finish-child", repair_dispatch_event_id: continuation.event_id },
      options(ctx.dir, "second-finish-worker")).state, "repair-worker-verification-missing",
    "a second worker session cannot consume the one completion batch");
    const refreezeCandidate = commitSelected(ctx.dir, 6, []);
    const refreezePanel = { ...finalPanel, frozen_commit: refreezeCandidate.commit, frozen_tree: refreezeCandidate.tree };
    assert.equal(recordAggregatePanelOpen(refreezePanel, options(ctx.dir)).state, "aggregate-terminal",
      "a terminal child cannot refreeze or open an extra final panel");
    const restarted = deriveAggregateRepairState(loadRepairEventsForProject(ctx.dir).aggregate_events, "finish-child", {
      standardEvents: loadRepairEventsForProject(ctx.dir).events,
    });
    assert.equal(restarted.terminal, "STOP", "a fresh controller read preserves the terminal child state");
    const sibling = path.join(os.tmpdir(), `completion-sibling-${process.pid}-${Date.now()}`);
    execFileSync("git", ["worktree", "add", "--detach", sibling, "HEAD"], { cwd: ctx.dir, stdio: "pipe" });
    try {
      assert.equal(recordAggregateChildContinuation({ ...exception, children: [{ ...exception.children[0],
        task_id: "finish-sibling", changeset_id: "finish-sibling-cs" }], process_review_event_id: review.event_id }, options(sibling)).state,
      "aggregate-continuation-conflict", "a sibling worktree sees the consumed completion anchor");
    } finally {
      execFileSync("git", ["worktree", "remove", "--force", sibling], { cwd: ctx.dir, stdio: "pipe" });
    }
    assert.equal(recordAggregateChildContinuation({ ...exception, children: [{ ...exception.children[0],
      task_id: "finish-sibling", changeset_id: "finish-sibling-cs" }], process_review_event_id: review.event_id }, options(ctx.dir)).state,
    "aggregate-continuation-conflict", "the parent cannot mint a sibling after its completion exception");
    assert.equal(recordAggregateChildContinuation({ ...exception, task_id: "finish-child", changeset_id: "finish-child-cs",
      parent_disposition_event_id: final.event_id, trigger_ids: [], continuation_kind: "new_changeset",
      children: [{ task_id: "finish-grandchild", changeset_id: "finish-grandchild-cs", tier: "T2",
        budget: "evade", authorized_paths: parent.candidate.paths }], completion_exception: undefined,
      completion_batch: undefined, process_review_event_id: null }, options(ctx.dir)).state,
    "aggregate-continuation-conflict", "an exception child cannot restart through a generic continuation");
  } finally { ctx.cleanup(); }
});

test("completion exception refuses a non-R4 or nonterminal parent before any child authority", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const stopped = disposition(ctx, closed.closed, { accepted: ["F1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs", "completion.md"), "bounded completion\n");
    const exception = { type: "aggregate_v2", kind: "child_continuation", task_id: "task-1",
      changeset_id: "changeset-1", parent_disposition_event_id: stopped.event_id, trigger_ids: ["F1"],
      continuation_kind: "completion_exception", owner_evidence: "Owner exact exception",
      children: [{ task_id: "child", changeset_id: "child-cs", tier: "T2", budget: "one batch",
        authorized_paths: [...candidate.paths, "briefs/completion.md"].sort() }],
      completion_exception: { repair_batches: 1, pm_recommendation: "concrete harm", surviving_harm: "terminal harm",
        smallest_correction: "one path", completion_proof: "one final panel" },
      completion_batch: { worker_session_id: "child-worker", brief_path: "briefs/completion.md" } };
    assert.equal(recordAggregateChildContinuation(exception, options(ctx.dir)).state, "aggregate-continuation-conflict",
      "a terminal STOP before R4 cannot mint a completion exception");
    const live = repo();
    try {
      const liveCandidate = commit(live.dir, 1);
      const livePanel = openPanel(live, 1, liveCandidate);
      const liveClosed = closePanel(live, livePanel.opened, livePanel.expected, liveCandidate, "F1");
      const continued = disposition(live, liveClosed.closed, { accepted: ["F1"] });
      mkdirSync(path.join(live.dir, "briefs"), { recursive: true });
      writeFileSync(path.join(live.dir, "briefs", "completion.md"), "bounded completion\n");
      assert.equal(recordAggregateChildContinuation({ ...exception,
        parent_disposition_event_id: continued.event_id }, options(live.dir)).state, "aggregate-continuation-conflict",
      "a nonterminal parent cannot mint a completion exception");
    } finally { live.cleanup(); }
  } finally { ctx.cleanup(); }
});

test("a base-three parent reaches ordinal eight only through the exception's reviewed final panel", () => {
  const ctx = repo();
  try {
    const ancestor = threeGateParent(ctx, { terminal: true });
    const ordinary = {
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: ancestor.decided.event_id, trigger_ids: ["F3"],
      continuation_kind: "new_changeset", owner_evidence: "Owner-approved new scope",
      action_screen: _DEFAULT_CONTINUATION_SCREEN,
      children: [{ task_id: "local-four", changeset_id: "local-four-cs", tier: "T2",
        budget: "ordinary successor", authorized_paths: [...ancestor.candidate.paths,
          "briefs/local-four-round-2.md", "briefs/local-four-round-3.md", "briefs/local-four-round-4.md"].sort() }],
    };
    const inheritedReview = processReview(ctx, null, ancestor.candidate, "successor", "task-1", "changeset-1",
      "child_continuation", ordinary);
    assert.equal(inheritedReview.ok, true, inheritedReview.state);
    assert.equal(inheritedReview.next_gate_ordinal, 4, "the first inherited checkpoint remains due");
    const lineage = recordAggregateChildContinuation({ ...ordinary, process_review_event_id: inheritedReview.event_id }, options(ctx.dir));
    assert.equal(lineage.ok, true, lineage.state);
    let candidate = commit(ctx.dir, 4);
    let panel = openPanel(ctx, 1, candidate, {}, false, {
      task_id: "local-four", changeset_id: "local-four-cs", child_continuation_event_id: lineage.event_id,
    });
    let closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F4", {
      task_id: "local-four", changeset_id: "local-four-cs",
    });
    let decided = disposition(ctx, closed.closed, {
      task_id: "local-four", changeset_id: "local-four-cs", accepted: ["F4"],
    });
    let authority = dispatchChild(ctx, { task_id: "local-four", changeset_id: "local-four-cs",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 2 });
    candidate = commitSource(ctx.dir, 5);
    panel = openPanel(ctx, 2, candidate, authority, false, { task_id: "local-four", changeset_id: "local-four-cs" });
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F5", { task_id: "local-four", changeset_id: "local-four-cs" });
    decided = disposition(ctx, closed.closed, { task_id: "local-four", changeset_id: "local-four-cs", accepted: ["F5"],
      remediation_kind: "root_replacement" });
    const childRootExit = rootExitChild(ctx, "local-four", "local-four-cs", decided.event_id);
    authority = dispatchChild(ctx, { task_id: "local-four", changeset_id: "local-four-cs",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 3,
      root_exit_event_id: childRootExit.event_id });
    candidate = commitSource(ctx.dir, 6);
    panel = openPanel(ctx, 3, candidate, authority, false, { task_id: "local-four", changeset_id: "local-four-cs" });
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F6", { task_id: "local-four", changeset_id: "local-four-cs" });
    decided = disposition(ctx, closed.closed, { task_id: "local-four", changeset_id: "local-four-cs", accepted: ["F6"],
      remediation_kind: "root_replacement" });
    const terminalRootExit = rootExitChild(ctx, "local-four", "local-four-cs", decided.event_id);
    const localReview = processReview(ctx, closed.closed.event_id, candidate, "finish_bounded_root", "local-four", "local-four-cs");
    assert.equal(localReview.ok, true, JSON.stringify(localReview));
    authority = dispatchChild(ctx, { task_id: "local-four", changeset_id: "local-four-cs",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id, next_round: 4,
      root_exit_event_id: terminalRootExit.event_id, process_review_event_id: localReview.event_id });
    candidate = commit(ctx.dir, 7);
    panel = openPanel(ctx, 4, candidate, authority, false, { task_id: "local-four", changeset_id: "local-four-cs" });
    closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F7", { task_id: "local-four", changeset_id: "local-four-cs" });
    decided = disposition(ctx, closed.closed, { task_id: "local-four", changeset_id: "local-four-cs",
      accepted: ["F7"], terminal_state: "STOP", remediation_kind: null, authorized_paths: [] });
    const parent = deriveAggregateRepairState(loadRepairEventsForProject(ctx.dir).aggregate_events, "local-four", {
      standardEvents: loadRepairEventsForProject(ctx.dir).events,
    });
    assert.equal(parent.current_gate_ordinal, 7, "base three plus local R4 preserves cumulative history");
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs", "ordinal-eight.md"), "one final batch\n");
    const exception = { type: "aggregate_v2", kind: "child_continuation", task_id: "local-four",
      changeset_id: "local-four-cs", parent_disposition_event_id: decided.event_id, trigger_ids: ["F7"],
      continuation_kind: "completion_exception", owner_evidence: "Owner authorized one final completion",
      action_screen: { ..._DEFAULT_CONTINUATION_SCREEN, surviving_finding_ids: ["F7"] },
      children: [{ task_id: "ordinal-eight", changeset_id: "ordinal-eight-cs", tier: "T2", budget: "one batch",
        authorized_paths: [...candidate.paths, "briefs/ordinal-eight.md"].sort() }],
      completion_exception: { repair_batches: 1, pm_recommendation: "concrete final harm", surviving_harm: "F7 remains",
        smallest_correction: "one path", completion_proof: "full final review" },
      completion_batch: { worker_session_id: "ordinal-eight-worker", brief_path: "briefs/ordinal-eight.md" },
    };
    assert.equal(recordAggregateChildContinuation(exception, options(ctx.dir)).state, "aggregate-continuation-conflict",
      "ordinal eight still requires a fresh typed Owner decision review");
    const review = processReview(ctx, null, candidate, "owner_decision", "local-four", "local-four-cs",
      "child_continuation", exception);
    assert.equal(review.ok, true, review.state);
    assert.equal(review.next_gate_ordinal, 8, "the review binds the inherited checkpoint before work authority");
    const continuation = recordAggregateChildContinuation({ ...exception, process_review_event_id: review.event_id }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
    const worker = recordWorkerVerification({ task_id: "ordinal-eight", repair_dispatch_event_id: continuation.event_id },
      options(ctx.dir, "ordinal-eight-worker"));
    assert.equal(worker.ok, true, worker.state);
    candidate = commit(ctx.dir, 8);
    const final = openPanelInput(ctx, candidate, { task_id: "ordinal-eight", changeset_id: "ordinal-eight-cs",
      child_continuation_event_id: continuation.event_id }, { worker: worker.event_id });
    final.phase = "final_bookend";
    const opened = recordAggregatePanelOpen(final, options(ctx.dir));
    assert.equal(opened.ok, true, opened.state);
    const finalClosed = closePanel(ctx, opened, final.expected_seats, candidate, null, {
      task_id: "ordinal-eight", changeset_id: "ordinal-eight-cs",
    });
    const finalDecision = disposition(ctx, finalClosed.closed, { task_id: "ordinal-eight", changeset_id: "ordinal-eight-cs",
      accepted: [], terminal_state: "GO", remediation_kind: null, authorized_paths: [] });
    assert.equal(finalDecision.ok, true, finalDecision.state);
    assert.equal(verifyRepairWorkerWrite({ task_id: "ordinal-eight", session_id: "ordinal-eight-worker", target: "src/x.mjs" },
      { projectRoot: ctx.dir }).state, "completion-batch-finished",
    "the completion batch remains closed after terminal GO");
    const finalState = deriveAggregateRepairState(loadRepairEventsForProject(ctx.dir).aggregate_events, "ordinal-eight", {
      standardEvents: loadRepairEventsForProject(ctx.dir).events,
    });
    assert.equal(finalState.current_gate_ordinal, 8, "only the real final panel increments the inherited ordinal");
    assert.ok(finalClosed.closed.event_id);
  } finally { ctx.cleanup(); }
});

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
        const continuationInput = {
          type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
          parent_disposition_event_id: decided.event_id, trigger_ids: ["F2"],
          continuation_kind: "new_changeset", owner_evidence: "Owner records future work",
          children: [{ task_id: "successor", changeset_id: "successor-cs", tier: "T2",
            budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
        };
        assert.equal(recordAggregateChildContinuation({
          ...continuationInput, process_review_event_id: review.event_id,
        }, options(ctx.dir)).state, "aggregate-continuation-conflict",
        "a dispatch-purpose review cannot authorize a terminal continuation");
        const childReview = processReview(ctx, closed.closed.event_id, candidate, "successor",
          "task-1", "changeset-1", "child_continuation", continuationInput);
        assert.equal(childReview.ok, true, childReview.state);
        const continuation = recordAggregateChildContinuation({
          ...continuationInput, process_review_event_id: childReview.event_id,
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
    const review = processReview(ctx, remap.get(parent.closed.event_id), parent.candidate, "successor",
      "task-1", "changeset-1", "child_continuation", continuation);
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
    const dispatchReview = processReview(ctx, closed.closed.event_id, candidate, "owner_decision");
    assert.equal(dispatchReview.ok, true, dispatchReview.state);
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs/owner-decision.md"), "repair\n");
    assert.equal(confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.closed.event_id,
      next_round: 2, root_exit_event_id: null, process_review_event_id: dispatchReview.event_id,
    }, brief_path: "briefs/owner-decision.md" }, options(ctx.dir)).state,
    "aggregate-process-review-required");
    const closedProgram = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, reason: "Owner chose a successor instead of current repair",
      owner_evidence: "Owner decision receipt",
    }, options(ctx.dir, "owner"));
    assert.equal(closedProgram.ok, true, closedProgram.state);
    const continuationInput = {
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      parent_disposition_event_id: decided.event_id,
      trigger_ids: ["F1"], continuation_kind: "new_changeset", owner_evidence: "Owner decision receipt",
      children: [{ task_id: "owner-child", changeset_id: "owner-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: candidate.paths }],
    };
    const childReview = processReview(ctx, closed.closed.event_id, candidate, "owner_decision",
      "task-1", "changeset-1", "child_continuation", continuationInput);
    assert.equal(childReview.ok, true, childReview.state);
    const continuation = recordAggregateChildContinuation({
      ...continuationInput, process_review_event_id: childReview.event_id,
    }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
  } finally { ctx.cleanup(); }
});

test("historical untyped process reviews replay but cannot grant new typed authority", () => {
  const replay = repo();
  const prospective = repo();
  try {
    const replayCandidate = commit(replay.dir, 1);
    const replayPanel = openPanel(replay, 1, replayCandidate);
    const replayClose = closePanel(replay, replayPanel.opened, replayPanel.expected, replayCandidate, "F1");
    const replayDisposition = disposition(replay, replayClose.closed, { accepted: ["F1"] });
    const replayReview = processReview(replay, replayClose.closed.event_id, replayCandidate);
    const replayAuthority = dispatch(replay, replayDisposition.event_id, replayClose.closed.event_id, 2,
      null, replayReview.event_id);
    const remap = rewriteAggregateLedgerWithHistoricalUntypedReview(replay.dir);
    const replayState = deriveAggregateRepairState(loadRepairEventsForProject(replay.dir).aggregate_events, "task-1");
    assert.equal(replayState.active_dispatch?.event_id, remap.get(replayAuthority.dispatch),
      "an already-recorded untyped review and dispatch retain historical replay authority");

    const candidate = commit(prospective.dir, 1);
    const panel = openPanel(prospective, 1, candidate);
    const closed = closePanel(prospective, panel.opened, panel.expected, candidate, "F1");
    const decided = disposition(prospective, closed.closed, { accepted: ["F1"] });
    const review = processReview(prospective, closed.closed.event_id, candidate);
    const prospectiveRemap = rewriteAggregateLedgerWithHistoricalUntypedReview(prospective.dir);
    mkdirSync(path.join(prospective.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(prospective.dir, "briefs/round-2.md"), "repair 2\n");
    assert.equal(confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: prospectiveRemap.get(decided.event_id),
      panel_close_event_id: prospectiveRemap.get(closed.closed.event_id), next_round: 2,
      root_exit_event_id: null, process_review_event_id: prospectiveRemap.get(review.event_id),
    }, brief_path: "briefs/round-2.md" }, options(prospective.dir)).state,
    "aggregate-process-review-required");
  } finally {
    replay.cleanup();
    prospective.cleanup();
  }
});

test("invalid typed child rulings stay inert and leave the exact proposal available to successor", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const stopped = disposition(ctx, closed.closed, { accepted: ["F1"], terminal_state: "STOP",
      remediation_kind: null, authorized_paths: [] });
    assert.equal(stopped.ok, true, stopped.state);
    const proposal = { parent_disposition_event_id: stopped.event_id, trigger_ids: ["F1"],
      continuation_kind: "new_changeset", children: [{ task_id: "valid-child",
        changeset_id: "valid-child-cs", tier: "T2", budget: "one changeset",
        authorized_paths: candidate.paths }] };
    const anchor = { kind: "aggregate_terminal", event_id: stopped.event_id,
      panel_open_event_id: panel.opened.event_id, frozen_commit: candidate.commit, frozen_tree: candidate.tree };
    const reviewInput = { type: "aggregate_v2", kind: "process_review", task_id: "task-1",
      changeset_id: "changeset-1", reviewer_role: "frontier", purpose: "child_continuation",
      anchor, proposed_transition: proposal, review_evidence: "terminal proposal review",
      zoom_out: "one bounded successor", bounded_scope: "one child",
      closure_evidence: "the parent remains terminal" };
    const ledger = repairLedgerPath(ctx.dir);
    const before = readFileSync(ledger, "utf8").split("\n").filter(Boolean).length;
    assert.equal(recordAggregateProcessReview({ ...reviewInput, ruling: "finish_bounded_root" },
      options(ctx.dir)).state, "aggregate-process-review-malformed");
    assert.equal(readFileSync(ledger, "utf8").split("\n").filter(Boolean).length, before,
      "a new invalid purpose/ruling pair appends nothing");

    const historical = stamped({ type: "aggregate_v2", kind: "process_review",
      policy_version: AGGREGATE_POLICY_VERSION, task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2099-01-01T00:00:00.000Z", session_id: "historical-writer",
      reviewer_role: "frontier", purpose: "child_continuation", anchor,
      transition_sha256: aggregateTransitionSha256("child_continuation", proposal),
      next_gate_ordinal: 2, review_evidence: "historical invalid pair", zoom_out: "historical",
      ruling: "finish_bounded_root", bounded_scope: "one child", closure_evidence: "historical" });
    writeFileSync(ledger, `${JSON.stringify(historical)}\n`, { flag: "a" });
    const loaded = loadRepairEventsForProject(ctx.dir);
    assert.equal(loaded.ok, true, "the hash-valid historical invalid pair remains structurally readable");
    const state = deriveAggregateRepairState(loaded.aggregate_events, "task-1", { standardEvents: loaded.events });
    assert.equal(state.ok, true);
    assert.equal(state.process_reviews.some((review) => review.event_id === historical.event_id), false,
      "the invalid pair is inert in derived authority");
    assert.equal(recordAggregateChildContinuation({ type: "aggregate_v2", kind: "child_continuation",
      task_id: "task-1", changeset_id: "changeset-1", ...proposal,
      owner_evidence: "Owner terminal evidence", process_review_event_id: historical.event_id,
    }, options(ctx.dir)).state, "aggregate-continuation-conflict");

    const successor = recordAggregateProcessReview({ ...reviewInput, ruling: "successor" }, options(ctx.dir));
    assert.equal(successor.ok, true, successor.state);
    const child = recordAggregateChildContinuation({ type: "aggregate_v2", kind: "child_continuation",
      task_id: "task-1", changeset_id: "changeset-1", ...proposal,
      owner_evidence: "Owner terminal evidence", process_review_event_id: successor.event_id,
    }, options(ctx.dir));
    assert.equal(child.ok, true, child.state);
  } finally { ctx.cleanup(); }
});

test("a spent finish review cannot route an abandoned open; an exact terminal-purpose review can", () => {
  const ctx = repo();
  try {
    const candidate1 = commit(ctx.dir, 1);
    const panel1 = openPanel(ctx, 1, candidate1);
    const closed1 = closePanel(ctx, panel1.opened, panel1.expected, candidate1, "F1");
    const decided = disposition(ctx, closed1.closed, { accepted: ["F1"] });
    const finish = processReview(ctx, closed1.closed.event_id, candidate1);
    assert.equal(finish.ok, true, finish.state);
    const authority = dispatch(ctx, decided.event_id, closed1.closed.event_id, 2, null, finish.event_id);
    const candidate2 = commit(ctx.dir, 2);
    const panel2 = openPanel(ctx, 2, candidate2, authority);
    const ended = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: decided.event_id, reason: "Owner ended the open repair",
      owner_evidence: "Owner terminal receipt",
    }, options(ctx.dir, "owner"));
    assert.equal(ended.ok, true, ended.state);
    const proposed = {
      parent_disposition_event_id: decided.event_id, trigger_ids: ["F1"],
      continuation_kind: "new_changeset",
      children: [{ task_id: "terminal-child", changeset_id: "terminal-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: candidate2.paths }],
    };
    assert.equal(recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      ...proposed, owner_evidence: "Owner terminal receipt", action_screen: _DEFAULT_CONTINUATION_SCREEN,
      process_review_event_id: finish.event_id,
    }, options(ctx.dir)).state, "aggregate-continuation-conflict");
    const state = deriveAggregateRepairState(loadRepairEventsForProject(ctx.dir).aggregate_events, "task-1");
    const anchor = { kind: "aggregate_terminal", event_id: ended.event_id,
      panel_open_event_id: panel2.opened.event_id, frozen_commit: candidate2.commit, frozen_tree: candidate2.tree };
    const reviewInput = { type: "aggregate_v2", kind: "process_review", task_id: "task-1",
      changeset_id: "changeset-1", reviewer_role: "frontier", purpose: "child_continuation",
      anchor, proposed_transition: proposed, review_evidence: "terminal review", zoom_out: "still bounded",
      ruling: "successor", bounded_scope: "one child", closure_evidence: "current repair is closed" };
    assert.equal(recordAggregateProcessReview({ ...reviewInput,
      anchor: { ...anchor, frozen_tree: "f".repeat(40) } }, options(ctx.dir)).state,
    "aggregate-process-review-malformed");
    assert.equal(recordAggregateProcessReview({ ...reviewInput,
      anchor: { ...anchor, event_id: closed1.closed.event_id } }, options(ctx.dir)).state,
    "aggregate-process-review-malformed");
    assert.equal(recordAggregateProcessReview({ ...reviewInput, purpose: "dispatch" }, options(ctx.dir)).state,
      "aggregate-process-review-malformed");
    const terminalReview = recordAggregateProcessReview(reviewInput, options(ctx.dir));
    assert.equal(terminalReview.ok, true, terminalReview.state);
    const exactReviewRetry = recordAggregateProcessReview(reviewInput, options(ctx.dir));
    assert.equal(exactReviewRetry.ok, true, exactReviewRetry.state);
    assert.equal(exactReviewRetry.idempotent, true);
    assert.equal(exactReviewRetry.event_id, terminalReview.event_id);
    assert.equal(recordAggregateProcessReview({ ...reviewInput,
      review_evidence: "a conflicting judgment for the same transition" }, options(ctx.dir)).state,
    "aggregate-process-review-conflict");
    assert.equal(recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      ...proposed, children: [{ ...proposed.children[0], budget: "altered budget" }],
      owner_evidence: "Owner terminal receipt", action_screen: _DEFAULT_CONTINUATION_SCREEN,
      process_review_event_id: terminalReview.event_id,
    }, options(ctx.dir)).state, "aggregate-continuation-conflict");
    const child = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "changeset-1",
      ...proposed, owner_evidence: "Owner terminal receipt", action_screen: _DEFAULT_CONTINUATION_SCREEN,
      process_review_event_id: terminalReview.event_id,
    }, options(ctx.dir));
    assert.equal(child.ok, true, child.state);
    assert.equal(state.next_gate_ordinal, 2);
  } finally { ctx.cleanup(); }
});

test("an abandoned R4 needs a fresh terminal-purpose review after its spent finish review", () => {
  const ctx = repo();
  try {
    const parent = threeGateParent(ctx);
    const finish = processReview(ctx, parent.closed.event_id, parent.candidate);
    const authority = dispatch(ctx, parent.decided.event_id, parent.closed.event_id, 4,
      parent.exit.event_id, finish.event_id);
    const candidate4 = commit(ctx.dir, 4);
    const panel4 = openPanel(ctx, 4, candidate4, authority);
    const ended = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "changeset-1",
      disposition_event_id: parent.decided.event_id, reason: "Owner ended the final open",
      owner_evidence: "Owner terminal receipt",
    }, options(ctx.dir, "owner"));
    assert.equal(ended.ok, true, ended.state);
    const proposed = { parent_disposition_event_id: parent.decided.event_id, trigger_ids: ["F3"],
      continuation_kind: "new_changeset",
      children: [{ task_id: "r4-child", changeset_id: "r4-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: candidate4.paths }] };
    const base = { type: "aggregate_v2", kind: "child_continuation", task_id: "task-1",
      changeset_id: "changeset-1", ...proposed, owner_evidence: "Owner terminal receipt",
      action_screen: _DEFAULT_CONTINUATION_SCREEN };
    assert.equal(recordAggregateChildContinuation({ ...base, process_review_event_id: finish.event_id },
      options(ctx.dir)).state, "aggregate-continuation-conflict");
    const terminalReview = processReview(ctx, parent.closed.event_id, candidate4, "successor",
      "task-1", "changeset-1", "child_continuation", proposed);
    assert.equal(terminalReview.ok, true, terminalReview.state);
    assert.equal(recordAggregateChildContinuation({ ...base, process_review_event_id: terminalReview.event_id },
      options(ctx.dir)).ok, true);
    assert.equal(panel4.opened.ok, true);
  } finally { ctx.cleanup(); }
});

test("a round-3 standard handoff requires an exact standard-purpose process review", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const manifest = fingerprintCandidate(ctx.dir, ["src/x.mjs"]);
    const round = (number, finding, dispatchId, at) => stamped({
      type: "round_disposition", task_id: "legacy", changeset_id: "legacy-cs", round: number,
      candidate_sha: manifest.digest, candidate_manifest: manifest.records, verdict: "NO-GO",
      disposition: "REMEDIATE", finding_ids: [finding], finding_class: `class-${number}`,
      ownership_area: "controller", original_trigger: `trigger-${number}`,
      authorized_paths: ["src/x.mjs"], introduced_by_prior_repair: false, new_scope: false,
      repair_dispatch_event_id: dispatchId, root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null, recorded_at: at, session_id: "legacy",
    });
    const dispatchRow = (source, finding, at) => stamped({
      type: "repair_dispatch", task_id: "legacy", changeset_id: "legacy-cs",
      source_round: source, next_round: source + 1, candidate_sha: manifest.digest,
      finding_ids: [finding], authorized_paths: ["src/x.mjs"], target_kind: "brief",
      target: `briefs/legacy-${source + 1}.md`, brief_sha256: String(source).repeat(64), brief_size: 7,
      root_cause_exit_event_id: null, adherence_audit_event_id: null,
      owner_extension_event_id: null, owner_scope_event_id: null, recorded_at: at, session_id: "legacy",
    });
    const r1 = round(1, "L1", null, "2099-01-01T00:00:00.000Z");
    const d2 = dispatchRow(1, "L1", "2099-01-01T00:00:01.000Z");
    const r2 = round(2, "L2", d2.event_id, "2099-01-01T00:00:02.000Z");
    const d3 = dispatchRow(2, "L2", "2099-01-01T00:00:03.000Z");
    const r3 = round(3, "L3", d3.event_id, "2099-01-01T00:00:04.000Z");
    mkdirSync(path.dirname(repairLedgerPath(ctx.dir)), { recursive: true });
    writeFileSync(repairLedgerPath(ctx.dir), [r1, d2, r2, d3, r3].map(JSON.stringify).join("\n") + "\n");
    const proposed = { parent_task_id: "legacy", parent_changeset_id: "legacy-cs",
      parent_disposition_event_id: r3.event_id, parent_round: 3, parent_candidate_sha: manifest.digest,
      authorized_paths: ["src/x.mjs"], child: { task_id: "legacy-child", changeset_id: "legacy-child-cs",
        tier: "T2", budget: "one changeset", authorized_paths: ["src/x.mjs"] } };
    const handoffInput = { type: "aggregate_v2", kind: "legacy_handoff", task_id: "legacy",
      changeset_id: "legacy-cs", ...proposed, owner_evidence: "Owner handoff" };
    assert.equal(recordAggregateLegacyHandoff(handoffInput, options(ctx.dir)).state,
      "aggregate-legacy-handoff-conflict");
    const anchor = { kind: "standard_disposition", event_id: r3.event_id, candidate_sha: manifest.digest };
    const reviewInput = { type: "aggregate_v2", kind: "process_review", task_id: "legacy",
      changeset_id: "legacy-cs", reviewer_role: "frontier", purpose: "legacy_handoff",
      anchor, proposed_transition: proposed, review_evidence: "handoff review", zoom_out: "bounded successor",
      ruling: "successor", bounded_scope: "one child", closure_evidence: "standard parent hands off",
      next_gate_ordinal: 4 };
    const beforeReview = readFileSync(repairLedgerPath(ctx.dir), "utf8").split("\n").filter(Boolean).length;
    assert.equal(recordAggregateProcessReview({ ...reviewInput, ruling: "finish_bounded_root" },
      options(ctx.dir)).state, "aggregate-process-review-malformed");
    assert.equal(readFileSync(repairLedgerPath(ctx.dir), "utf8").split("\n").filter(Boolean).length,
      beforeReview, "a new invalid legacy-handoff ruling appends nothing");
    const historicalInvalid = stamped({ type: "aggregate_v2", kind: "process_review",
      policy_version: AGGREGATE_POLICY_VERSION, task_id: "legacy", changeset_id: "legacy-cs",
      recorded_at: "2099-01-01T00:00:05.000Z", session_id: "historical-writer",
      reviewer_role: "frontier", purpose: "legacy_handoff", anchor,
      transition_sha256: aggregateTransitionSha256("legacy_handoff", proposed), next_gate_ordinal: 4,
      review_evidence: "historical invalid pair", zoom_out: "historical",
      ruling: "finish_bounded_root", bounded_scope: "one child", closure_evidence: "historical" });
    writeFileSync(repairLedgerPath(ctx.dir), `${JSON.stringify(historicalInvalid)}\n`, { flag: "a" });
    assert.equal(loadRepairEventsForProject(ctx.dir).ok, true,
      "the historical invalid boundary review stays structurally readable");
    assert.equal(recordAggregateLegacyHandoff({ ...handoffInput,
      process_review_event_id: historicalInvalid.event_id }, options(ctx.dir)).state,
    "aggregate-legacy-handoff-conflict");
    assert.equal(recordAggregateLegacyHandoff({ ...handoffInput,
      process_review_event_id: "e".repeat(64) }, options(ctx.dir)).state,
    "aggregate-legacy-handoff-conflict");
    assert.equal(recordAggregateProcessReview({ ...reviewInput, next_gate_ordinal: 5 }, options(ctx.dir)).state,
      "aggregate-process-review-malformed");
    assert.equal(recordAggregateProcessReview({ ...reviewInput,
      anchor: { ...anchor, event_id: r2.event_id } }, options(ctx.dir)).state,
    "aggregate-process-review-malformed");
    assert.equal(recordAggregateProcessReview({ ...reviewInput,
      anchor: { ...anchor, candidate_sha: "f".repeat(64) } }, options(ctx.dir)).state,
    "aggregate-process-review-malformed");
    const review = recordAggregateProcessReview(reviewInput, options(ctx.dir));
    assert.equal(review.ok, true, review.state);
    const handoff = recordAggregateLegacyHandoff({
      ...handoffInput, process_review_event_id: review.event_id,
    }, options(ctx.dir));
    assert.equal(handoff.ok, true, handoff.state);
    const opened = openPanel(ctx, 1, candidate, {}, false, {
      task_id: "legacy-child", changeset_id: "legacy-child-cs", legacy_handoff_event_id: handoff.event_id,
    });
    assert.equal(opened.opened.ok, true, opened.opened.state);
  } finally { ctx.cleanup(); }
});

test("an exact active legacy brief retry is idempotent while changed requests take the live path", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const decided = disposition(ctx, closed.closed, { accepted: ["F1"] });
    const authority = dispatch(ctx, decided.event_id, closed.closed.event_id, 2);
    const liveDispatch = loadRepairEventsForProject(ctx.dir).aggregate_events
      .find((row) => row.event_id === authority.dispatch);
    assert.equal(liveDispatch.event.policy_version, AGGREGATE_POLICY_VERSION,
      "genuine new authority remains policy 2");
    const remap = rewriteAggregateLedgerAsLegacy(ctx.dir);
    const declaration = { aggregate_controller: "aggregate_v2", task_id: "task-1",
      changeset_id: "changeset-1", disposition_event_id: remap.get(decided.event_id),
      panel_close_event_id: remap.get(closed.closed.event_id), next_round: 2, root_exit_event_id: null };
    const ledger = repairLedgerPath(ctx.dir);
    const before = readFileSync(ledger, "utf8").split("\n").filter(Boolean).length;
    const exact = confirmRepairBrief({ declaration, brief_path: "briefs/round-2.md" }, options(ctx.dir));
    assert.equal(exact.ok, true, exact.state);
    assert.equal(exact.idempotent, true);
    assert.equal(exact.event_id, remap.get(authority.dispatch));
    assert.equal(readFileSync(ledger, "utf8").split("\n").filter(Boolean).length, before,
      "the compatibility retry appends nothing");
    writeFileSync(path.join(ctx.dir, "briefs/alternate-round-2.md"), "repair 2\n");
    assert.equal(confirmRepairBrief({ declaration,
      brief_path: "briefs/alternate-round-2.md" }, options(ctx.dir)).state,
    "aggregate-dispatch-conflict");
    writeFileSync(path.join(ctx.dir, "briefs/round-2.md"), "changed bytes\n");
    assert.equal(confirmRepairBrief({ declaration, brief_path: "briefs/round-2.md" }, options(ctx.dir)).state,
      "aggregate-dispatch-conflict");
    assert.equal(confirmRepairBrief({ declaration: { ...declaration,
      panel_close_event_id: "f".repeat(64) }, brief_path: "briefs/round-2.md" }, options(ctx.dir)).state,
    "aggregate-dispatch-unavailable");
    assert.equal(confirmRepairBrief({ declaration: { ...declaration,
      process_review_event_id: "e".repeat(64) }, brief_path: "briefs/round-2.md" }, options(ctx.dir)).state,
    "aggregate-process-review-required");
  } finally { ctx.cleanup(); }
});

test("live dispositions require an explicit boolean, while an exact old omitted-field retry survives", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const panel = openPanel(ctx, 1, candidate);
    const closed = closePanel(ctx, panel.opened, panel.expected, candidate, "F1");
    const input = { type: "aggregate_v2", kind: "disposition", task_id: "task-1",
      changeset_id: "changeset-1", panel_close_event_id: closed.closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] },
      terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: ["src/x.mjs"] };
    for (const malformed of [undefined, null, "false", 0]) {
      const attempt = { ...input };
      if (malformed !== undefined) attempt.same_mechanism_repeated = malformed;
      assert.equal(recordAggregateDisposition(attempt, options(ctx.dir)).state,
        "aggregate-disposition-malformed");
    }
    const accepted = recordAggregateDisposition({ ...input, same_mechanism_repeated: false }, options(ctx.dir));
    assert.equal(accepted.ok, true, accepted.state);
    const remap = rewriteAggregateLedgerAsLegacy(ctx.dir);
    const retried = recordAggregateDisposition({
      ...input, panel_close_event_id: remap.get(closed.closed.event_id),
    }, options(ctx.dir));
    assert.equal(retried.ok, true, retried.state);
    assert.equal(retried.idempotent, true);
    assert.equal(retried.event_id, remap.get(accepted.event_id));
  } finally { ctx.cleanup(); }
  const ctxTrue = repo();
  try {
    const candidate = commit(ctxTrue.dir, 1);
    const panel = openPanel(ctxTrue, 1, candidate);
    const closed = closePanel(ctxTrue, panel.opened, panel.expected, candidate, "F1");
    const repeated = disposition(ctxTrue, closed.closed, {
      accepted: ["F1"], same_mechanism_repeated: true,
      remediation_kind: "root_replacement",
    });
    assert.equal(repeated.ok, true, repeated.state);
    const stored = loadRepairEventsForProject(ctxTrue.dir).aggregate_events
      .find((row) => row.event_id === repeated.event_id);
    assert.equal(stored.event.same_mechanism_repeated, true);
  } finally { ctxTrue.cleanup(); }
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
