import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeRepairPathOwners, deriveAggregateRepairState, deriveRepairState, fingerprintCandidate, gitSubjectPresent,
  loadRepairEventsForProject, readAggregateRepairEvents, readRepairEvents,
  recordAdherenceAudit, recordOwnerExtension, recordRepairClose, recordRootCauseExit,
  recordRoundDisposition, recordWorkerVerification, repairLedgerPath,
  verifyRepairBriefReceipt, verifyRepairWorkerWrite,
} from "../hooks/repair-dispatch-state.mjs";

const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const stamp = (event) => ({
  event_id: createHash("sha256").update(stable(event)).digest("hex"), event,
});

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "repair-controller-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "x.mjs"), "export const x = 1;\n");
  execFileSync("git", ["add", "src/x.mjs"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function seedLegacy(dir) {
  mkdirSync(path.join(dir, "briefs"), { recursive: true });
  const brief = "bounded legacy repair\n";
  writeFileSync(path.join(dir, "briefs", "fix.md"), brief);
  const candidate = fingerprintCandidate(dir, ["src/x.mjs"]);
  const round = {
    type: "round_disposition", task_id: "legacy-task", changeset_id: "legacy-change",
    recorded_at: "2026-01-01T00:00:00.000Z", session_id: "legacy-orchestrator", round: 1,
    candidate_sha: candidate.digest, candidate_manifest: candidate.records,
    verdict: "NO-GO", disposition: "REMEDIATE", finding_ids: ["LEGACY-1"],
    finding_class: "legacy-replay", ownership_area: "controller", original_trigger: "stored legacy trigger",
    authorized_paths: ["src/x.mjs"], introduced_by_prior_repair: false, new_scope: false,
    repair_dispatch_event_id: null, root_cause_exit_event_id: null, adherence_audit_event_id: null,
    owner_extension_event_id: null, owner_scope_event_id: null,
  };
  const dispatch = {
    type: "repair_dispatch", task_id: round.task_id, changeset_id: round.changeset_id,
    recorded_at: "2026-01-01T00:00:01.000Z", session_id: "legacy-orchestrator",
    source_round: 1, next_round: 2, candidate_sha: round.candidate_sha,
    finding_ids: [...round.finding_ids], authorized_paths: [...round.authorized_paths],
    target_kind: "brief", target: "briefs/fix.md",
    brief_sha256: createHash("sha256").update(brief).digest("hex"), brief_size: Buffer.byteLength(brief),
  };
  const worker = {
    type: "worker_verification", task_id: round.task_id, changeset_id: round.changeset_id,
    recorded_at: "2026-01-01T00:00:02.000Z", session_id: "legacy-worker",
    worker_session_id: "legacy-worker", repair_dispatch_event_id: stamp(dispatch).event_id,
    candidate_sha: round.candidate_sha, authorized_paths: [...round.authorized_paths],
    brief_path: dispatch.target, brief_sha256: dispatch.brief_sha256,
  };
  const file = repairLedgerPath(dir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, [round, dispatch, worker].map((event) => JSON.stringify(stamp(event))).join("\n") + "\n");
  return { file, round, dispatch, worker };
}

test("stored standard history replays, pre-issued worker authority works, and new standard minting is retired", () => {
  const { dir, cleanup } = repo();
  try {
    const seeded = seedLegacy(dir);
    const loaded = loadRepairEventsForProject(dir);
    assert.equal(loaded.ok, true);
    const state = deriveRepairState(loaded.events, "legacy-task");
    assert.equal(state.ok, true);
    assert.equal(state.active, true);
    assert.equal(state.verdicts.length, 1);
    assert.equal(verifyRepairBriefReceipt({
      task_id: "legacy-task", repair_dispatch_event_id: stamp(seeded.dispatch).event_id,
    }, { projectRoot: dir }).ok, true);
    assert.equal(verifyRepairWorkerWrite({
      task_id: "legacy-task", session_id: "legacy-worker", target: "src/x.mjs",
    }, { projectRoot: dir }).ok, true);
    assert.equal(verifyRepairWorkerWrite({
      task_id: "legacy-task", session_id: "other-worker", target: "src/x.mjs",
    }, { projectRoot: dir }).state, "repair-worker-verification-missing");
    assert.equal(verifyRepairWorkerWrite({
      task_id: "legacy-task", session_id: "legacy-worker", target: "src/other.mjs",
    }, { projectRoot: dir }).state, "repair-worker-path-unauthorized");
    assert.equal(recordRoundDisposition({
      ...seeded.round, candidate_paths: ["src/x.mjs"], recorded_at: undefined, session_id: undefined,
    }, { projectRoot: dir, sessionId: "retry" }).idempotent, true,
    "an exact stored round remains replay-idempotent");
    assert.equal(recordRoundDisposition({
      ...seeded.round, task_id: "new-task", changeset_id: "new-change", candidate_paths: ["src/x.mjs"],
      recorded_at: undefined, session_id: undefined,
    }, { projectRoot: dir, sessionId: "new" }).state, "standard-mint-retired");
    assert.equal(recordRoundDisposition({
      ...seeded.round, round: 2, candidate_paths: ["src/x.mjs"],
      repair_dispatch_event_id: stamp(seeded.dispatch).event_id,
      recorded_at: undefined, session_id: undefined,
    }, { projectRoot: dir, sessionId: "legacy-orchestrator" }).state, "standard-mint-retired");
    assert.equal(recordRootCauseExit({}, { projectRoot: dir, sessionId: "legacy-orchestrator" }).state,
      "standard-mint-retired");
    assert.equal(recordAdherenceAudit({}, { projectRoot: dir, sessionId: "legacy-orchestrator" }).state,
      "standard-mint-retired");
    assert.equal(recordOwnerExtension({ authority_kind: "scope" }, {
      projectRoot: dir, sessionId: "legacy-orchestrator",
    }).state, "standard-mint-retired");
    assert.equal(recordWorkerVerification({
      task_id: "legacy-task", repair_dispatch_event_id: stamp(seeded.dispatch).event_id,
    }, { projectRoot: dir, sessionId: "new-worker" }).state, "standard-mint-retired");
    assert.equal(recordWorkerVerification({
      task_id: "legacy-task", repair_dispatch_event_id: stamp(seeded.dispatch).event_id,
    }, { projectRoot: dir, sessionId: "legacy-worker" }).idempotent, true);
  } finally { cleanup(); }
});

test("append-only Owner close releases a stored legacy owner without deleting history", () => {
  const { dir, cleanup } = repo();
  try {
    seedLegacy(dir);
    const owner = recordOwnerExtension({
      task_id: "legacy-task", changeset_id: "legacy-change", after_round: 1,
      authority_kind: "close", owner_evidence: "Owner closes the obsolete standard program",
    }, { projectRoot: dir, sessionId: "owner" });
    assert.equal(owner.ok, true, owner.state);
    const close = recordRepairClose({
      task_id: "legacy-task", changeset_id: "legacy-change", after_round: 1,
      reason: "handoff to aggregate controller", owner_close_event_id: owner.event_id,
    }, { projectRoot: dir, sessionId: "closer" });
    assert.equal(close.ok, true, close.state);
    const loaded = loadRepairEventsForProject(dir);
    const state = deriveRepairState(loaded.events, "legacy-task");
    assert.equal(state.active, false);
    assert.equal(state.verdicts.length, 1);
    assert.equal(state.close.reason, "handoff to aggregate controller");
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/x.mjs", {
      aggregateEvents: loaded.aggregate_events,
    }).owners, []);
    assert.equal(verifyRepairWorkerWrite({
      task_id: "legacy-task", session_id: "unverified", target: "src/x.mjs",
    }, { projectRoot: dir }).state, "not-repair-write");
  } finally { cleanup(); }
});

test("historical extension rows replay inert while unknown types and bad hashes fail closed", () => {
  const { dir, cleanup } = repo();
  try {
    const { file } = seedLegacy(dir);
    const historical = ["panel_close", "evidence_rerun", "child_continuation"].map((type, index) => ({
      type, task_id: "legacy-task", changeset_id: "legacy-change",
      recorded_at: `2026-01-01T00:00:1${index}.000Z`, session_id: "historical",
    }));
    const original = readFileSync(file, "utf8");
    writeFileSync(file, original + historical.map((event) => JSON.stringify(stamp(event))).join("\n") + "\n");
    assert.equal(readRepairEvents(file).length, 3);
    assert.equal(readAggregateRepairEvents(file).length, 0);
    assert.equal(loadRepairEventsForProject(dir).ok, true);
    const unknown = { ...historical[0], type: "aggregate_unknown" };
    writeFileSync(file, `${original}${JSON.stringify(stamp(unknown))}\n`);
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable");
    writeFileSync(file, `${original}${JSON.stringify({ event_id: "0".repeat(64), event: historical[0] })}\n`);
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable");
  } finally { cleanup(); }
});

test("well-hashed malformed aggregate kinds fail globally while wrong references stay inert", () => {
  const { dir, cleanup } = repo();
  try {
    const { file } = seedLegacy(dir);
    const original = readFileSync(file, "utf8");
    const malformed = {
      type: "aggregate_v2", kind: "panel_close", task_id: "aggregate", changeset_id: "change",
      recorded_at: "2026-01-01T00:01:00.000Z", session_id: "orchestrator",
      panel_open_event_id: "a".repeat(64),
    };
    writeFileSync(file, original + JSON.stringify(stamp(malformed)) + "\n");
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable",
      "a valid hash cannot make a malformed aggregate kind replayable");
    const malformedPartition = {
      type: "aggregate_v2", kind: "disposition", task_id: "aggregate", changeset_id: "change",
      recorded_at: "2026-01-01T00:01:01.000Z", session_id: "orchestrator",
      panel_close_event_id: "b".repeat(64), pm_findings: [], finding_dispositions: {},
      terminal_state: "GO", remediation_kind: null, authorized_paths: [],
    };
    writeFileSync(file, original + JSON.stringify(stamp(malformedPartition)) + "\n");
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable",
      "nested aggregate authority shape is validated before reference eligibility");

    const wrongReference = { ...malformed, received_seats: ["free", "a", "b", "external"].map((seat, i) => ({
      seat_id: seat, role: seat === "free" ? "free" : seat === "external" ? "external" : `angle:${seat}`,
      family: "codex", pass_type: seat === "external" ? "folded" : "free",
      inspected_paths: ["src/x.mjs"], reviewed_commit: "1".repeat(40), reviewed_tree: "2".repeat(40),
      verdict: "GO", raw_finding_ids: [], artifact_receipt: `receipt-${seat}`,
      artifact_sha256: String(i + 1).repeat(64), pre_loaded: false, packet_scope: "candidate-only",
    })) };
    writeFileSync(file, original + JSON.stringify(stamp(wrongReference)) + "\n");
    const loaded = loadRepairEventsForProject(dir);
    assert.equal(loaded.ok, true);
    const state = deriveAggregateRepairState(loaded.aggregate_events, "aggregate", {
      standardEvents: loaded.events,
    });
    assert.equal(state.ok, true);
    assert.equal(state.panels_close.length, 0, "a well-shaped wrong reference remains inert");
  } finally { cleanup(); }
});

test("truncated, corrupt, and symlinked ledgers fail closed; no Git subject remains distinguishable", () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), "repair-no-subject-"));
  const { dir, cleanup } = repo();
  try {
    assert.equal(gitSubjectPresent(outside, { env: {} }), false);
    assert.equal(loadRepairEventsForProject(outside, {
      env: {}, execGit: () => { throw new Error("not a Git worktree"); },
    }).state, "repair-ledger-no-subject");
    const { file } = seedLegacy(dir);
    const valid = readFileSync(file, "utf8");
    writeFileSync(file, valid.trimEnd());
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable");
    writeFileSync(file, `${valid}{not-json}\n`);
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable");
    rmSync(file);
    const target = path.join(outside, "ledger");
    writeFileSync(target, valid);
    symlinkSync(target, file);
    assert.equal(lstatSync(file).isSymbolicLink(), true);
    assert.equal(loadRepairEventsForProject(dir).state, "repair-ledger-unavailable");
  } finally {
    cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("linked worktrees share one Git-common append-only ledger", () => {
  const { dir, cleanup } = repo();
  const linked = mkdtempSync(path.join(os.tmpdir(), "repair-linked-"));
  rmSync(linked, { recursive: true, force: true });
  try {
    seedLegacy(dir);
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked-test", linked], { cwd: dir });
    assert.equal(repairLedgerPath(linked), repairLedgerPath(dir));
    const loaded = loadRepairEventsForProject(linked);
    assert.equal(loaded.ok, true);
    assert.equal(deriveRepairState(loaded.events, "legacy-task").active, true);
  } finally {
    try { execFileSync("git", ["worktree", "remove", "--force", linked], { cwd: dir }); } catch {}
    cleanup();
  }
});
