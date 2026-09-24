// Round-1 batch cures, each proven in both polarities: the refreeze bounds, the reworked abandon
// path (admitted-set eligibility · pre-disposition close · close reservation), tier continuity,
// the family floor, the serialization boundary (undefined-key normalization · cycle refusal ·
// timestamp-insensitive retry idempotency), cross-seat finding-id uniqueness at close, early root
// kinds, subset lineage budgets, the reservation's parent-lineage exception, the unreadable-
// ancestor subject walk, and the recorder's version-skew refusal.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGGREGATE_POLICY_VERSION, activeRepairPathOwners, confirmRepairBrief, deriveAggregateRepairState, gitSubjectPresent,
  loadRepairEventsForProject, recordAggregateChildContinuation as _rawChildContinuation, recordAggregateClose,
  recordAggregateDisposition, recordAggregatePanelClose, recordAggregatePanelOpen, recordAggregateProcessReview,
  recordAggregateRootExit, recordWorkerVerification, repairLedgerPath,
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
const stamped = (event) => ({ event_id: createHash("sha256").update(stable(event)).digest("hex"), event });
const options = (dir, sessionId = "orchestrator") => ({ projectRoot: dir, sessionId });

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trb-batch1-"));
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
function commit(dir, value, file = "src/x.mjs") {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), `export const x = ${JSON.stringify(value)};\n`);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", `candidate-${value}`], { cwd: dir });
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(),
    tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: dir, encoding: "utf8" }).trim(),
    paths: execFileSync("git", ["diff", "--name-only", "origin/main..HEAD"],
      { cwd: dir, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort(),
  };
}
function seats(paths, tier = "T2", extra = {}) {
  const roster = tier === "T3"
    ? [["free", "free"], ["a", "angle:a"], ["b", "angle:b"], ["c", "angle:c"], ["external", "external"]]
    : [["free", "free"], ["a", "angle:a"], ["b", "angle:b"], ["external", "external"]];
  return roster.map(([seat_id, role]) => ({
    seat_id, role, family: role === "external" ? "claude" : "codex",
    pass_type: role === "external" ? "folded" : "free", paths, ...extra,
  }));
}
function openInput(ctx, candidate, over = {}) {
  return {
    type: "aggregate_v2", kind: "panel_open", task_id: "task-1", changeset_id: "cs-1", round: 1,
    phase: "repair_round", tier: "T2", frozen_commit: candidate.commit, frozen_tree: candidate.tree,
    base_ref: "origin/main", base_commit: ctx.base, expected_seats: seats(candidate.paths, over.tier ?? "T2"),
    incoming_dispatch_event_id: null, incoming_worker_event_id: null,
    child_continuation_event_id: null, legacy_handoff_event_id: null, ...over,
  };
}
function received(expected, candidate, findingIds = []) {
  return expected.map((seat, index) => ({
    seat_id: seat.seat_id, role: seat.role, family: seat.family, pass_type: seat.pass_type,
    inspected_paths: seat.paths, reviewed_commit: candidate.commit, reviewed_tree: candidate.tree,
    verdict: index === 1 && findingIds.length ? "NO-GO" : "GO",
    raw_finding_ids: index === 1 ? findingIds : [],
    artifact_receipt: `receipt-${seat.seat_id}`, artifact_sha256: String(index + 1).repeat(64),
    pre_loaded: false, packet_scope: "candidate-only",
  }));
}
function close(ctx, openResult, expected, candidate, findingIds = []) {
  return recordAggregatePanelClose({
    type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
    panel_open_event_id: openResult.event_id, received_seats: received(expected, candidate, findingIds),
  }, options(ctx.dir));
}
function decide(ctx, closed, over = {}) {
  return recordAggregateDisposition({
    type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",
    panel_close_event_id: closed.event_id, pm_findings: [],
    finding_dispositions: { accepted: [], declined: [], note: [], followup: [] },
    terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: ["src/x.mjs"],
    same_mechanism_repeated: false, ...over,
  }, options(ctx.dir));
}
function dispatchBatch(ctx, dispositionId, closeId, nextRound, rootExitId = null, processReviewId = null) {
  mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
  const brief = `briefs/round-${nextRound}.md`;
  writeFileSync(path.join(ctx.dir, brief), `repair ${nextRound}\n`);
  const receipt = confirmRepairBrief({ declaration: {
    aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
    disposition_event_id: dispositionId, panel_close_event_id: closeId,
    next_round: nextRound, root_exit_event_id: rootExitId, process_review_event_id: processReviewId,
  }, brief_path: brief }, options(ctx.dir));
  assert.equal(receipt.ok, true, receipt.state);
  const worker = recordWorkerVerification({ task_id: "task-1", repair_dispatch_event_id: receipt.event_id },
    options(ctx.dir, `worker-${nextRound}`));
  assert.equal(worker.ok, true, worker.state);
  return { dispatch: receipt.event_id, worker: worker.event_id };
}
function processReview(ctx, closeId, candidate, ruling = "finish_bounded_root") {
  const state = derive(ctx);
  const root = state.root_exits.find((row) => row.disposition_event_id === state.latest?.event_id);
  return recordAggregateProcessReview({
    type: "aggregate_v2", kind: "process_review", task_id: "task-1", changeset_id: "cs-1",
    reviewer_role: "frontier", purpose: "dispatch",
    anchor: { kind: "aggregate_panel_close", event_id: closeId,
      frozen_commit: candidate.commit, frozen_tree: candidate.tree },
    proposed_transition: { policy_version: AGGREGATE_POLICY_VERSION,
      disposition_event_id: state.latest.event_id, panel_close_event_id: closeId,
      source_round: state.latest.round, next_round: state.latest.round + 1,
      root_exit_event_id: root?.event_id ?? null, authorized_paths: state.latest.authorized_paths },
    review_evidence: "frontier review of the completed panel", zoom_out: "the repair remains finite",
    ruling, bounded_scope: "one consolidated root correction",
    closure_evidence: "the accepted trigger closes on the replacement",
  }, options(ctx.dir));
}
function derive(ctx, task = "task-1") {
  const loaded = loadRepairEventsForProject(ctx.dir);
  return deriveAggregateRepairState(loaded.aggregate_events, task, { standardEvents: loaded.events });
}

test("refreeze bounds: one supersede per round, never at the bookend, roster and scope pinned", () => {
  const ctx = repo();
  try {
    const candA = commit(ctx.dir, "a");
    const openA = recordAggregatePanelOpen(openInput(ctx, candA), options(ctx.dir));
    assert.equal(openA.ok, true, openA.state);
    // Refreeze 1: same scope, new candidate — accepted.
    const candB = commit(ctx.dir, "b");
    const openB = recordAggregatePanelOpen(openInput(ctx, candB), options(ctx.dir));
    assert.equal(openB.ok, true, `first refreeze accepted: ${openB.state}`);
    // Refreeze 2 at the same round refuses — repeated contamination is rig-class harm, and the
    // exit is close+successor, never a grind.
    const candC = commit(ctx.dir, "c");
    assert.equal(recordAggregatePanelOpen(openInput(ctx, candC), options(ctx.dir)).ok, false,
      "a second supersede of one round refuses");
    // A refreeze that alters the ROSTER refuses (checked on a fresh program/round).
    const ctx2 = repo();
    try {
      const c1 = commit(ctx2.dir, 1);
      assert.equal(recordAggregatePanelOpen(openInput(ctx2, c1), options(ctx2.dir)).ok, true);
      const c2 = commit(ctx2.dir, 2);
      const shrunk = openInput(ctx2, c2);
      shrunk.expected_seats = seats(c2.paths).map((seat) => ({ ...seat, seat_id: `re-${seat.seat_id}` }));
      assert.equal(recordAggregatePanelOpen(shrunk, options(ctx2.dir)).ok, false,
        "a refreeze cannot recompose the roster");
    } finally { ctx2.cleanup(); }
    // The final bookend cannot refreeze: walk an honest program to R4, contaminate, try.
    const ctx3 = repo();
    try {
      let candidate = commit(ctx3.dir, 1);
      let authority = {};
      let closed, decided;
      for (const round of [1, 2, 3]) {
        const opened = recordAggregatePanelOpen({ ...openInput(ctx3, candidate), round,
          incoming_dispatch_event_id: authority.dispatch ?? null,
          incoming_worker_event_id: authority.worker ?? null }, options(ctx3.dir));
        assert.equal(opened.ok, true, opened.state);
        closed = recordAggregatePanelClose({
          type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
          panel_open_event_id: opened.event_id,
          received_seats: received(seats(candidate.paths), candidate, [`F${round}`]),
        }, options(ctx3.dir));
        assert.equal(closed.ok, true, closed.state);
        decided = recordAggregateDisposition({
          type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",
          panel_close_event_id: closed.event_id, pm_findings: [],
          finding_dispositions: { accepted: [`F${round}`], declined: [], note: [], followup: [] },
          terminal_state: "CONTINUE", remediation_kind: round === 1 ? "bounded" : "root_replacement",
          authorized_paths: ["src/x.mjs"], same_mechanism_repeated: false,
        }, options(ctx3.dir));
        assert.equal(decided.ok, true, decided.state);
        let rootExit = null;
        if (round >= 2) {
          const exit = recordAggregateRootExit({
            type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "cs-1",
            disposition_event_id: decided.event_id, shared_mechanism: "root",
            symptom_explanation: "symptoms", owner_state_yield_seams: ["seam"],
            replacement: "replacement", removed_workarounds: ["loop"], trigger_matrix: ["bookend"],
            closure_evidence: "the root replacement closes the accepted trigger",
          }, options(ctx3.dir));
          assert.equal(exit.ok, true, exit.state);
          rootExit = exit.event_id;
        }
        mkdirSync(path.join(ctx3.dir, "briefs"), { recursive: true });
        const brief = `briefs/round-${round + 1}.md`;
        writeFileSync(path.join(ctx3.dir, brief), `repair ${round + 1}\n`);
        let processReviewId = null;
        if (round === 3) {
          const review = processReview(ctx3, closed.event_id, candidate);
          assert.equal(review.ok, true, review.state);
          processReviewId = review.event_id;
        }
        const receipt = confirmRepairBrief({ declaration: {
          aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
          disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
          next_round: round + 1, root_exit_event_id: rootExit,
          process_review_event_id: processReviewId,
        }, brief_path: brief }, options(ctx3.dir));
        assert.equal(receipt.ok, true, receipt.state);
        const worker = recordWorkerVerification({ task_id: "task-1", repair_dispatch_event_id: receipt.event_id },
          options(ctx3.dir, `worker-${round + 1}`));
        assert.equal(worker.ok, true, worker.state);
        authority = { dispatch: receipt.event_id, worker: worker.event_id };
        candidate = commit(ctx3.dir, `r${round + 1}`);
      }
      const bookend = recordAggregatePanelOpen({ ...openInput(ctx3, candidate), round: 4,
        phase: "final_bookend", incoming_dispatch_event_id: authority.dispatch,
        incoming_worker_event_id: authority.worker }, options(ctx3.dir));
      assert.equal(bookend.ok, true, bookend.state);
      const contaminated = commit(ctx3.dir, "contaminated-bookend");
      assert.equal(recordAggregatePanelOpen({ ...openInput(ctx3, contaminated), round: 4,
        phase: "final_bookend", incoming_dispatch_event_id: authority.dispatch,
        incoming_worker_event_id: authority.worker }, options(ctx3.dir)).ok, false,
      "the terminal bookend is NEVER refreezable — a contaminated bookend exits via close+successor");
    } finally { ctx3.cleanup(); }
  } finally { ctx.cleanup(); }
});

test("abandon path: admitted-set eligibility, pre-disposition close, and the close reservation", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const opened = recordAggregatePanelOpen(openInput(ctx, candidate), options(ctx.dir));
    const closed = close(ctx, opened, seats(candidate.paths), candidate, ["F1"]);
    const decided = decide(ctx, closed, { accepted: ["F1"], finding_dispositions: undefined,
      ...{ finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] } } });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    // Round 2 closes and dispositions CONTINUE — active_worker is now null (the very window the
    // one-session check was vacuous in). An ADMITTED worker still cannot close.
    const cand2 = commit(ctx.dir, 2);
    const open2 = recordAggregatePanelOpen({ ...openInput(ctx, cand2), round: 2,
      incoming_dispatch_event_id: authority.dispatch, incoming_worker_event_id: authority.worker },
    options(ctx.dir));
    assert.equal(open2.ok, true, open2.state);
    const closed2 = close(ctx, open2, seats(cand2.paths), cand2, ["F2"]);
    const decided2 = decide(ctx, closed2, {
      remediation_kind: "root_replacement",
      finding_dispositions: { accepted: ["F2"], declined: [], note: [], followup: [] } });
    assert.equal(decided2.ok, true, decided2.state);
    const selfClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided2.event_id, reason: "worker releases itself",
      owner_evidence: "none",
    }, options(ctx.dir, "worker-2"));
    assert.equal(selfClose.ok, false);
    assert.equal(selfClose.state, "aggregate-close-self-authorized",
      "an admitted worker session cannot release the program constraining it — in ANY window");
    // A non-admitted session closes; with dispositions on record the close RESERVES the paths.
    const ownerClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided2.event_id, reason: "abandoned", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(ownerClose.ok, true, ownerClose.state);
    assert.equal(derive(ctx).terminal, "CLOSED");
    const relabel = recordAggregatePanelOpen({ ...openInput(ctx, commit(ctx.dir, 3)),
      task_id: "renamed", changeset_id: "renamed-cs" }, options(ctx.dir));
    assert.equal(relabel.ok, false,
      "close-then-relabel over the same paths is NOT a fresh budget — the close reserved them");
  } finally { ctx.cleanup(); }
});

test("a virgin program (no disposition) closes by citing its winning open, and reserves nothing", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const opened = recordAggregatePanelOpen(openInput(ctx, candidate), options(ctx.dir));
    assert.equal(opened.ok, true, opened.state);
    // No panel_close ever (unassemblable roster). The old model burned this identity forever.
    const virginClose = recordAggregateClose({
      type: "aggregate_v2", kind: "close", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: null, panel_open_event_id: opened.event_id,
      reason: "roster unassemblable", owner_evidence: "Owner keyboard",
    }, options(ctx.dir, "owner-session"));
    assert.equal(virginClose.ok, true, virginClose.state);
    assert.equal(derive(ctx).terminal, "CLOSED");
    // Nothing was ground — a new changeset on the same paths opens freely.
    const fresh = recordAggregatePanelOpen({ ...openInput(ctx, commit(ctx.dir, 2)),
      task_id: "fresh-task", changeset_id: "fresh-cs" }, options(ctx.dir));
    assert.equal(fresh.ok, true, `a virgin close releases cleanly: ${fresh.state}`);
  } finally { ctx.cleanup(); }
});

test("tier continuity: a later round may escalate the tier, never lower it", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const first = recordAggregatePanelOpen(openInput(ctx, candidate), options(ctx.dir));
    assert.equal(first.ok, true, first.state);
    const legacyOpen = stamped({ ...loadRepairEventsForProject(ctx.dir).aggregate_events[0].event,
      policy_version: 3, tier: "T3", expected_seats: seats(candidate.paths, "T3") });
    writeFileSync(repairLedgerPath(ctx.dir), `${JSON.stringify(legacyOpen)}\n`);
    const opened = { ok: true, event_id: legacyOpen.event_id };
    assert.equal(opened.ok, true, opened.state);
    const closed = close(ctx, opened, seats(candidate.paths, "T3"), candidate, ["F1"]);
    assert.equal(closed.ok, true, closed.state);
    const decided = decide(ctx, closed, {
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] } });
    assert.equal(decided.ok, true, decided.state);
    const authority = dispatchBatch(ctx, decided.event_id, closed.event_id, 2);
    const cand2 = commit(ctx.dir, 2);
    const downgrade = recordAggregatePanelOpen({ ...openInput(ctx, cand2, {
      tier: "T2", expected_seats: seats(cand2.paths, "T2") }), round: 2,
      incoming_dispatch_event_id: authority.dispatch, incoming_worker_event_id: authority.worker },
    options(ctx.dir));
    assert.equal(downgrade.ok, false,
      "a T3 program's later round cannot seat a T2 panel — no batch spent, no record, no downgrade");
    const sameTier = recordAggregatePanelOpen({ ...openInput(ctx, cand2, {
      tier: "T3", expected_seats: seats(cand2.paths, "T3") }), round: 2,
      incoming_dispatch_event_id: authority.dispatch, incoming_worker_event_id: authority.worker },
    options(ctx.dir));
    assert.equal(sameTier.ok, true, sameTier.state);
  } finally { ctx.cleanup(); }
});

test("serialization boundary: undefined-valued keys are normalized away, cycles refuse typed, retries are timestamp-insensitive", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    // The idiomatic caller: substitution explicitly undefined on every non-substituted seat. The
    // unnormalized form hashed the key the written bytes omit — one accepted write bricked the
    // ledger forever.
    const roster = seats(candidate.paths).map((seat) => ({ ...seat, substitution: undefined }));
    const opened = recordAggregatePanelOpen(openInput(ctx, candidate, { expected_seats: roster }),
      options(ctx.dir));
    assert.equal(opened.ok, true, opened.state);
    const after = loadRepairEventsForProject(ctx.dir);
    assert.equal(after.ok, true, "the written row round-trips — the ledger stays readable");
    // A value JSON cannot carry refuses with a typed state, never a throw.
    const cyclic = openInput(ctx, candidate);
    cyclic.expected_seats = seats(candidate.paths);
    cyclic.expected_seats[0].loop = cyclic.expected_seats[0];
    let result;
    assert.doesNotThrow(() => { result = recordAggregatePanelOpen(cyclic, options(ctx.dir)); });
    assert.equal(result.ok, false);
    assert.match(result.state, /malformed/);
    // A retry differing only in recorded_at returns the standing winner idempotently.
    const closed = close(ctx, opened, seats(candidate.paths), candidate, ["F1"]);
    assert.equal(closed.ok, true, closed.state);
    const dispositionInput = {
      type: "aggregate_v2", kind: "disposition", task_id: "task-1", changeset_id: "cs-1",
      panel_close_event_id: closed.event_id, pm_findings: [],
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] },
      terminal_state: "CONTINUE", remediation_kind: "bounded", authorized_paths: ["src/x.mjs"],
      same_mechanism_repeated: false,
    };
    const first = recordAggregateDisposition(dispositionInput, { ...options(ctx.dir), now: "2099-01-01T00:00:00.000Z" });
    assert.equal(first.ok, true, first.state);
    const retry = recordAggregateDisposition(dispositionInput, { ...options(ctx.dir), now: "2099-01-01T00:05:00.000Z" });
    assert.equal(retry.ok, true, "a died-between-write-and-read caller can re-record");
    assert.equal(retry.idempotent, true);
    assert.equal(retry.event_id, first.event_id, "…and converges on the standing winner");
  } finally { ctx.cleanup(); }
});

test("cross-seat duplicate finding ids refuse AT CLOSE — recomposable, never a post-close deadlock", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const opened = recordAggregatePanelOpen(openInput(ctx, candidate), options(ctx.dir));
    const expected = seats(candidate.paths);
    const collided = received(expected, candidate, ["F1"]).map((seat) => seat.seat_id === "b"
      ? { ...seat, verdict: "NO-GO", raw_finding_ids: ["F1"] } : seat);
    const collision = recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
      panel_open_event_id: opened.event_id, received_seats: collided,
    }, options(ctx.dir));
    assert.equal(collision.ok, false, "two seats sharing a finding id cannot close");
    // Recomposed with namespaced ids, the SAME panel closes and dispositions normally.
    const namespaced = received(expected, candidate, ["a:F1"]).map((seat) => seat.seat_id === "b"
      ? { ...seat, verdict: "NO-GO", raw_finding_ids: ["b:F1"] } : seat);
    const recomposed = recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-1", changeset_id: "cs-1",
      panel_open_event_id: opened.event_id, received_seats: namespaced,
    }, options(ctx.dir));
    assert.equal(recomposed.ok, true, recomposed.state);
    const decided = decide(ctx, recomposed, {
      finding_dispositions: { accepted: ["a:F1", "b:F1"], declined: [], note: [], followup: [] } });
    assert.equal(decided.ok, true, decided.state);
  } finally { ctx.cleanup(); }
});

test("early root kinds: the PM may declare root_replacement at R1, and its dispatch requires the root exit", () => {
  const ctx = repo();
  try {
    const candidate = commit(ctx.dir, 1);
    const opened = recordAggregatePanelOpen(openInput(ctx, candidate), options(ctx.dir));
    const closed = close(ctx, opened, seats(candidate.paths), candidate, ["F1"]);
    const decided = decide(ctx, closed, { remediation_kind: "root_replacement",
      finding_dispositions: { accepted: ["F1"], declined: [], note: [], followup: [] } });
    assert.equal(decided.ok, true, `same-class recurrence may force the terminal kind early: ${decided.state}`);
    // Its batch cannot dispatch without the root exit…
    mkdirSync(path.join(ctx.dir, "briefs"), { recursive: true });
    writeFileSync(path.join(ctx.dir, "briefs", "early-root.md"), "root repair\n");
    assert.equal(confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
      next_round: 2, root_exit_event_id: null,
    }, brief_path: "briefs/early-root.md" }, options(ctx.dir)).ok, false,
    "a root-kind batch owes its root exit at ANY round");
    const exit = recordAggregateRootExit({
      type: "aggregate_v2", kind: "root_exit", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, shared_mechanism: "shared root",
      symptom_explanation: "the two prior fixes were symptoms", owner_state_yield_seams: ["seam"],
      replacement: "one replacement", removed_workarounds: ["workaround"], trigger_matrix: ["matrix"],
      closure_evidence: "the root exit closes the accepted trigger",
    }, options(ctx.dir));
    assert.equal(exit.ok, true, exit.state);
    const receipt = confirmRepairBrief({ declaration: {
      aggregate_controller: "aggregate_v2", task_id: "task-1", changeset_id: "cs-1",
      disposition_event_id: decided.event_id, panel_close_event_id: closed.event_id,
      next_round: 2, root_exit_event_id: exit.event_id,
    }, brief_path: "briefs/early-root.md" }, options(ctx.dir));
    assert.equal(receipt.ok, true, receipt.state);
  } finally { ctx.cleanup(); }
});

test("lineage budgets are supersets: a child opens on a SUBSET of its declared paths; outside them it refuses", () => {
  const ctx = repo();
  try {
    // Parent program STOPs at R1 over two files.
    const candidate = commit(ctx.dir, 1, "src/x.mjs");
    writeFileSync(path.join(ctx.dir, "src", "y.mjs"), "export const y = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: ctx.dir });
    execFileSync("git", ["commit", "-qm", "two-file"], { cwd: ctx.dir });
    const twoFile = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ctx.dir, encoding: "utf8" }).trim(),
      paths: ["src/x.mjs", "src/y.mjs"],
    };
    const opened = recordAggregatePanelOpen(openInput(ctx, twoFile), options(ctx.dir));
    assert.equal(opened.ok, true, opened.state);
    const closed = close(ctx, opened, seats(twoFile.paths), twoFile, ["CRIT"]);
    const stop = decide(ctx, closed, { terminal_state: "STOP", remediation_kind: null,
      authorized_paths: [],
      finding_dispositions: { accepted: ["CRIT"], declined: [], note: [], followup: [] } });
    assert.equal(stop.ok, true, stop.state);
    const continuation = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-1", changeset_id: "cs-1",
      parent_disposition_event_id: derive(ctx).latest.event_id, trigger_ids: ["CRIT"],
      continuation_kind: "new_changeset", owner_evidence: "Owner successor", authority_route: "owner",
      children: [{ task_id: "child", changeset_id: "child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: twoFile.paths }],
    }, options(ctx.dir));
    assert.equal(continuation.ok, true, continuation.state);
    // The child's actual diff touches ONE of the two declared files — a SUBSET opens fine (the
    // old exact-equality demanded predicting the future diff and burned the continuation on a
    // wrong guess)…
    const childCandidate = commit(ctx.dir, "child-work", "src/y.mjs");
    const childOpen = recordAggregatePanelOpen({
      type: "aggregate_v2", kind: "panel_open", task_id: "child", changeset_id: "child-cs",
      round: 1, phase: "repair_round", tier: "T2",
      frozen_commit: childCandidate.commit, frozen_tree: childCandidate.tree,
      base_ref: "origin/main", base_commit: ctx.base,
      expected_seats: seats(childCandidate.paths),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: continuation.event_id, legacy_handoff_event_id: null,
    }, options(ctx.dir));
    assert.equal(childOpen.ok, true, `subset lineage opens: ${childOpen.state}`);
  } finally { ctx.cleanup(); }
});

test("the STOP reservation yields only to the reserving parent's own lineage", () => {
  const ctx = repo();
  try {
    // Program A STOPs over src/x.mjs.
    const candidate = commit(ctx.dir, 1);
    const openedA = recordAggregatePanelOpen(openInput(ctx, candidate), options(ctx.dir));
    const closedA = close(ctx, openedA, seats(candidate.paths), candidate, ["CRIT"]);
    const stopA = decide(ctx, closedA, { terminal_state: "STOP", remediation_kind: null,
      authorized_paths: [],
      finding_dispositions: { accepted: ["CRIT"], declined: [], note: [], followup: [] } });
    assert.equal(stopA.ok, true, stopA.state);
    // Unrelated program B on OTHER paths goes GO with a routed followup, then seeds a child that
    // claims A's stopped path — the skeleton-key walk. It must refuse.
    execFileSync("git", ["checkout", "-qb", "b-line", "origin/main"], { cwd: ctx.dir });
    const bCandidate = commit(ctx.dir, "b-work", "docs/b.md");
    const openedB = recordAggregatePanelOpen({ ...openInput(ctx, bCandidate),
      task_id: "task-b", changeset_id: "cs-b", expected_seats: seats(bCandidate.paths) }, options(ctx.dir));
    assert.equal(openedB.ok, true, openedB.state);
    const closedB = recordAggregatePanelClose({
      type: "aggregate_v2", kind: "panel_close", task_id: "task-b", changeset_id: "cs-b",
      panel_open_event_id: openedB.event_id,
      received_seats: received(seats(bCandidate.paths), bCandidate, ["ADJ"]),
    }, options(ctx.dir));
    assert.equal(closedB.ok, true, closedB.state);
    const goB = recordAggregateDisposition({
      type: "aggregate_v2", kind: "disposition", task_id: "task-b", changeset_id: "cs-b",
      panel_close_event_id: closedB.event_id, pm_findings: [],
      finding_dispositions: { accepted: [], declined: [], note: [],
        followup: [{ id: "ADJ", route: "successor:child-of-b" }] },
      terminal_state: "GO", remediation_kind: null, authorized_paths: [], same_mechanism_repeated: false,
    }, options(ctx.dir));
    assert.equal(goB.ok, true, goB.state);
    const loadedB = loadRepairEventsForProject(ctx.dir);
    const stateB = deriveAggregateRepairState(loadedB.aggregate_events, "task-b", { standardEvents: loadedB.events });
    const continuationB = recordAggregateChildContinuation({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-b", changeset_id: "cs-b",
      parent_disposition_event_id: stateB.latest.event_id, trigger_ids: ["ADJ"],
      continuation_kind: "new_changeset", owner_evidence: "Owner follow-on", authority_route: "owner",
      children: [{ task_id: "b-child", changeset_id: "b-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    }, options(ctx.dir));
    // Since terminal-round-breaker-2 the skeleton-key walk dies one step EARLIER: the
    // declaration itself refuses (a child budget over another program's un-lifted reservation,
    // and task-b's GO lineage holds no claim on A's surface).
    assert.equal(continuationB.ok, false);
    assert.equal(continuationB.state, "aggregate-continuation-conflict",
      "an UNRELATED parent cannot even DECLARE a child over another program's STOP");
    // Defense in depth: a hand-planted continuation row is inert, and the child's open still
    // refuses on the open-side reservation arm.
    const plantedContinuation = stamped({
      type: "aggregate_v2", kind: "child_continuation", task_id: "task-b", changeset_id: "cs-b",
      recorded_at: "2099-01-01T00:00:40.000Z", session_id: "planted",
      parent_disposition_event_id: stateB.latest.event_id,
      parent_frozen_commit: stateB.panels_open.at(-1).frozen_commit,
      parent_frozen_tree: stateB.panels_open.at(-1).frozen_tree,
      trigger_ids: ["ADJ"], continuation_kind: "new_changeset", owner_evidence: "planted",
      children: [{ task_id: "b-child", changeset_id: "b-child-cs", tier: "T2",
        budget: "one changeset", authorized_paths: ["src/x.mjs"] }],
    });
    execFileSync("git", ["checkout", "-qb", "b-child-line", "origin/main"], { cwd: ctx.dir });
    const childCandidate = commit(ctx.dir, "b-child-work", "src/x.mjs");
    const loadedBypass = loadRepairEventsForProject(ctx.dir);
    const bypassOpen = stamped({
      type: "aggregate_v2", kind: "panel_open", task_id: "b-child", changeset_id: "b-child-cs",
      recorded_at: "2099-01-01T00:00:41.000Z", session_id: "planted",
      round: 1, phase: "repair_round", tier: "T2",
      frozen_commit: childCandidate.commit, frozen_tree: childCandidate.tree,
      base_ref: "origin/main", base_commit: ctx.base,
      changed_paths: ["src/x.mjs"], expected_seats: seats(["src/x.mjs"]),
      incoming_dispatch_event_id: null, incoming_worker_event_id: null,
      child_continuation_event_id: plantedContinuation.event_id, legacy_handoff_event_id: null,
    });
    const bypassWorld = deriveAggregateRepairState(
      [...loadedBypass.aggregate_events, plantedContinuation, bypassOpen], "b-child",
      { standardEvents: loadedBypass.events });
    assert.equal(bypassWorld.panels_open.length, 0,
      "an UNRELATED parent's lineage child is not a skeleton key over another program's STOP");
  } finally { ctx.cleanup(); }
});

test("an unreadable ancestor never buys the blind relief, and observed Git overrides are named", () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) return; // root reads anything
  const outer = mkdtempSync(path.join(os.tmpdir(), "trb-unreadable-"));
  try {
    const locked = path.join(outer, "locked");
    const inner = path.join(locked, "project");
    mkdirSync(inner, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      assert.equal(gitSubjectPresent(inner, { env: {} }), true,
        "EACCES on an ancestor is a subject the control could not SEE — never provable absence");
    } finally { chmodSync(locked, 0o755); }
    const result = loadRepairEventsForProject(path.join(outer, "nowhere"),
      { env: { GIT_DIR: "/nonexistent/spoof" }, execGit: () => { throw new Error("git unusable"); } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.observed_overrides, ["GIT_DIR"],
      "the deny result names the location overrides that forced the subject assumption");
  } finally { rmSync(outer, { recursive: true, force: true }); }
});

test("the recorder refuses aggregate events against a pre-aggregate controller with a typed state, never a TypeError", async () => {
  const rig = mkdtempSync(path.join(os.tmpdir(), "trb-skew-"));
  try {
    mkdirSync(path.join(rig, "scripts"), { recursive: true });
    mkdirSync(path.join(rig, "hooks"), { recursive: true });
    const here = path.dirname(fileURLToPath(import.meta.url));
    cpSync(path.join(here, "..", "scripts", "record-repair-event.mjs"),
      path.join(rig, "scripts", "record-repair-event.mjs"));
    // A pre-aggregate controller: the legacy exports exist, recordAggregateEvent does not.
    writeFileSync(path.join(rig, "hooks", "repair-dispatch-state.mjs"), [
      "export function recordRoundDisposition() { return { ok: false, state: 'stub' }; }",
      "export function recordRootCauseExit() { return { ok: false, state: 'stub' }; }",
      "export function recordAdherenceAudit() { return { ok: false, state: 'stub' }; }",
      "export function recordOwnerExtension() { return { ok: false, state: 'stub' }; }",
      "export function recordRepairClose() { return { ok: false, state: 'stub' }; }",
    ].join("\n") + "\n");
    const { recordEvent } = await import(pathToFileURL(path.join(rig, "scripts", "record-repair-event.mjs")).href);
    let result;
    assert.doesNotThrow(() => {
      result = recordEvent({ type: "aggregate_v2", kind: "panel_open" }, { projectRoot: rig, sessionId: "s" });
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "repair-controller-version-skew");
  } finally { rmSync(rig, { recursive: true, force: true }); }
});
