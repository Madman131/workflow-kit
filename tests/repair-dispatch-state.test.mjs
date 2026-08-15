import { execFileSync, spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeRepairPathOwners, confirmRepairBrief, deriveRepairState, loadRepairEventsForProject, readRepairEvents,
  recordAdherenceAudit, recordOwnerExtension, recordRootCauseExit, recordRoundDisposition,
  recordWorkerVerification, repairLedgerPath, validateRepairDispatch, verifyRepairBriefReceipt,
  verifyRepairWorkerWrite,
} from "../hooks/repair-dispatch-state.mjs";

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

const options = (dir) => ({ projectRoot: dir, sessionId: "session-1" });
const round = (n, over = {}) => ({
  type: "round_disposition", task_id: "task-1", changeset_id: "changeset-1", round: n,
  candidate_paths: ["src/x.mjs"], verdict: "NO-GO", disposition: "REMEDIATE",
  finding_ids: [`F${n}`], finding_class: "writer-liveness", ownership_area: "writer-authority",
  original_trigger: `trigger-${n}`, authorized_paths: ["src/x.mjs"],
  introduced_by_prior_repair: false, new_scope: false, ...over,
});
const mutate = (dir, n) => writeFileSync(path.join(dir, "src", "x.mjs"), `export const x = ${n};\n`);

function state(dir) {
  const loaded = loadRepairEventsForProject(dir);
  assert.equal(loaded.ok, true);
  const derived = deriveRepairState(loaded.events, "task-1");
  assert.equal(derived.ok, true);
  return { loaded, derived };
}

function nextDeclaration(dir, evidence = {}) {
  const { loaded, derived } = state(dir);
  const v = derived.latest;
  const declaration = {
    task_id: "task-1", changeset_id: "changeset-1", candidate_sha: v.candidate_sha, round: v.round + 1,
    finding_ids: v.finding_ids, finding_class: v.finding_class, ownership_area: v.ownership_area,
    original_trigger: v.original_trigger, authorized_paths: v.authorized_paths,
    introduced_by_prior_repair: v.introduced_by_prior_repair, new_scope: v.new_scope, ...evidence,
  };
  return { declaration, loaded, v };
}

function dispatchNext(dir, evidence = {}) {
  const { declaration, loaded, v } = nextDeclaration(dir, evidence);
  const briefPath = `briefs/round-${v.round + 1}.md`;
  const valid = validateRepairDispatch(declaration, {
    events: loaded.events, taskId: "task-1", targetKind: "brief", target: briefPath,
  });
  assert.equal(valid.ok, true, valid.state);
  mkdirSync(path.join(dir, "briefs"), { recursive: true });
  writeFileSync(path.join(dir, briefPath), `repair round ${v.round + 1}\n`);
  const receipt = confirmRepairBrief({ declaration, brief_path: briefPath }, options(dir));
  assert.equal(receipt.ok, true, receipt.state);
  return { ...evidence, repair_dispatch_event_id: receipt.event_id };
}

test("only persisted current brief bytes mint repair authority", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const { declaration } = nextDeclaration(dir);
    const input = { declaration, brief_path: "briefs/fix.md", brief_sha256: "f".repeat(64) };
    assert.equal(confirmRepairBrief(input, options(dir)).state, "repair-brief-unconfirmed",
      "a pre-write admission or caller-supplied hash cannot mint authority");
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2, { repair_dispatch_event_id: "f".repeat(64) }), options(dir)).state,
      "repair-brief-receipt-missing");

    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    symlinkSync("../src/x.mjs", path.join(dir, "briefs", "fix.md"));
    assert.equal(confirmRepairBrief(input, options(dir)).state, "repair-brief-unconfirmed");
    rmSync(path.join(dir, "briefs", "fix.md"));
    const bytes = "exact persisted repair\n";
    writeFileSync(path.join(dir, "briefs", "fix.md"), bytes);
    const first = confirmRepairBrief(input, options(dir));
    assert.equal(first.ok, true);
    const retry = confirmRepairBrief(input, { ...options(dir), sessionId: "session-2", now: "2099-01-01T00:00:00.000Z" });
    assert.equal(retry.event_id, first.event_id, "append-before-response loss is idempotent");
    assert.equal(retry.idempotent, true);
    const confirmed = verifyRepairBriefReceipt({
      task_id: "task-1", repair_dispatch_event_id: first.event_id,
    }, options(dir));
    assert.equal(confirmed.ok, true);
    assert.notEqual(confirmed.receipt.brief_sha256, "f".repeat(64), "the controller hashes file bytes itself");

    writeFileSync(path.join(dir, "briefs", "fix.md"), "changed repair\n");
    assert.equal(verifyRepairBriefReceipt({
      task_id: "task-1", repair_dispatch_event_id: first.event_id,
    }, options(dir)).state, "repair-brief-changed");
    assert.equal(recordRoundDisposition(round(2, { repair_dispatch_event_id: first.event_id }), options(dir)).state,
      "repair-brief-changed", "gate closure rechecks the current brief");

    const second = confirmRepairBrief(input, options(dir));
    assert.equal(second.ok, true);
    assert.notEqual(second.event_id, first.event_id);
    assert.equal(verifyRepairBriefReceipt({
      task_id: "task-1", repair_dispatch_event_id: second.event_id,
    }, options(dir)).ok, true, "only the receipt for current bytes verifies");
    writeFileSync(path.join(dir, "briefs", "fix.md"), bytes);
    assert.equal(recordRoundDisposition(round(2, { repair_dispatch_event_id: first.event_id }), options(dir)).ok, true);
    rmSync(path.join(dir, "briefs", "fix.md"));
    assert.equal(verifyRepairBriefReceipt({
      task_id: "task-1", repair_dispatch_event_id: first.event_id,
    }, options(dir)).state, "repair-brief-changed");
  } finally { cleanup(); }
});

test("concurrent identical brief confirmations converge on one logical receipt", async () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const { declaration } = nextDeclaration(dir);
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, "briefs", "fix.md"), "concurrent repair\n");
    const moduleUrl = new URL("../hooks/repair-dispatch-state.mjs", import.meta.url).href;
    const script = "import { confirmRepairBrief } from " + JSON.stringify(moduleUrl) + ";\n" +
      "const [dir, declaration, session] = process.argv.slice(1);\n" +
      "const result = confirmRepairBrief({declaration:JSON.parse(declaration),brief_path:'briefs/fix.md'}," +
      "{projectRoot:dir,sessionId:session});\nprocess.stdout.write(JSON.stringify(result));";
    const run = (session) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir,
        JSON.stringify(declaration), session], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => run("session-" + i)));
    assert.equal(new Set(results.map((result) => result.event_id)).size, 1);
    assert.equal(state(dir).derived.dispatches.length, 1);
  } finally { cleanup(); }
});

test("typed worker verification binds session, current receipt bytes, candidate, and exact repair paths", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const authority = dispatchNext(dir);
    const input = { task_id: "task-1", repair_dispatch_event_id: authority.repair_dispatch_event_id };
    assert.equal(recordWorkerVerification(input, { projectRoot: dir }).state,
      "repair-worker-session-missing");
    const admission = recordWorkerVerification(input, { projectRoot: dir, sessionId: "worker-1" });
    assert.equal(admission.ok, true);
    assert.equal(recordWorkerVerification(input, { projectRoot: dir, sessionId: "worker-1" }).event_id,
      admission.event_id, "a lost verifier response retries idempotently");
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "worker-1", target: "src/x.mjs",
    }, { projectRoot: dir }).ok, true);
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "other-worker", target: "src/x.mjs",
    }, { projectRoot: dir }).state, "repair-worker-verification-missing");
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "worker-1", target: "src/other.mjs",
    }, { projectRoot: dir }).state, "repair-worker-path-unauthorized");
    writeFileSync(path.join(dir, "briefs", "round-2.md"), "changed after verification\n");
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "worker-1", target: "src/x.mjs",
    }, { projectRoot: dir }).state, "repair-brief-changed");
  } finally { cleanup(); }
});

test("active repair path ownership is global, exact, and first-wins-program derived", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    let loaded = loadRepairEventsForProject(dir);
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/x.mjs").owners.map((s) => s.task_id), ["task-1"]);
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/unrelated.mjs").owners, []);
    assert.equal(recordRoundDisposition(round(1, {
      task_id: "task-2", changeset_id: "changeset-2",
    }), options(dir)).ok, true);
    loaded = loadRepairEventsForProject(dir);
    assert.deepEqual(activeRepairPathOwners(loaded.events, "src/x.mjs").owners.map((s) => s.task_id),
      ["task-1", "task-2"]);
  } finally { cleanup(); }
});

test("round history is sequential, refreeze-safe, idempotent, and changeset-bound", () => {
  const { dir, cleanup } = repo();
  try {
    const r1 = recordRoundDisposition(round(1), options(dir));
    assert.equal(r1.ok, true);
    assert.equal(recordRoundDisposition(round(1), options(dir)).idempotent, true);
    assert.equal(recordRoundDisposition(round(1, { finding_class: "other" }), options(dir)).state,
      "repair-round-conflict");
    assert.equal(recordRoundDisposition(round(3), options(dir)).state, "repair-round-nonsequential");
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2, { changeset_id: "reset" }), options(dir)).state,
      "repair-identity-conflict");
    const authority = dispatchNext(dir);
    assert.equal(recordRoundDisposition(round(2, authority), options(dir)).ok, true);
    const { derived } = state(dir);
    assert.equal(derived.verdicts.length, 2);
    assert.notEqual(derived.verdicts[0].candidate_sha, derived.verdicts[1].candidate_sha,
      "a refreeze changes candidate identity without resetting the round");
    assert.equal(derived.root_cause_required, true, "two consecutive declared same-class NO-GOs trigger root cause");
  } finally { cleanup(); }
});

test("sequential repair scope expansion requires the exact prior Owner event before admission", () => {
  for (const expandedPaths of [["src/b.mjs"], ["src/a.mjs", "src/b.mjs"]]) {
    const { dir, cleanup } = repo();
    try {
      assert.equal(recordRoundDisposition(round(1, { authorized_paths: ["src/a.mjs"] }), options(dir)).ok, true);
      const repair = dispatchNext(dir);
      assert.equal(recordWorkerVerification({
        task_id: "task-1", repair_dispatch_event_id: repair.repair_dispatch_event_id,
      }, { projectRoot: dir, sessionId: "forged-worker" }).ok, true);
      mutate(dir, 2);
      assert.equal(recordRoundDisposition(round(2, {
        ...repair, finding_class: "scope-expansion", authorized_paths: expandedPaths, new_scope: false,
      }), options(dir)).state, "repair-scope-unapproved");
      assert.equal(state(dir).derived.latest.round, 1, "the forged expansion never becomes accepted history");
      assert.equal(verifyRepairWorkerWrite({
        task_id: "task-1", session_id: "forged-worker", target: "src/b.mjs",
      }, { projectRoot: dir }).state, "repair-worker-path-unauthorized",
      "a rejected replacement/addition cannot yield worker authority for the added exact path");
    } finally { cleanup(); }
  }

  for (const { ownerAdded, roundPaths } of [
    { ownerAdded: ["src/a.mjs"], roundPaths: ["src/base.mjs", "src/b.mjs"] },
    { ownerAdded: ["src/a.mjs", "src/b.mjs"], roundPaths: ["src/base.mjs", "src/a.mjs"] },
    { ownerAdded: ["src/a.mjs", "src/b.mjs"], roundPaths: ["src/base.mjs", "src/a.mjs", "src/b.mjs", "src/c.mjs"] },
  ]) {
    const { dir, cleanup } = repo();
    try {
      assert.equal(recordRoundDisposition(round(1, { authorized_paths: ["src/base.mjs"] }), options(dir)).ok, true);
      const repair = dispatchNext(dir);
      const scope = recordOwnerExtension({
        type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 1,
        authority_kind: "scope", owner_evidence: "free-form prose cannot widen this typed set",
        added_paths: ownerAdded,
      }, options(dir));
      assert.equal(scope.ok, true);
      mutate(dir, 2);
      assert.equal(recordRoundDisposition(round(2, {
        ...repair, finding_class: "scope-mismatch", authorized_paths: roundPaths, new_scope: true,
        owner_scope_event_id: scope.event_id,
      }), options(dir)).state, "repair-scope-unapproved",
      "the Owner event must equal the computed additions, not a subset, superset, or different path");
    } finally { cleanup(); }
  }

  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1, { authorized_paths: ["src/base.mjs"] }), options(dir)).ok, true);
    const repair = dispatchNext(dir);
    assert.equal(recordOwnerExtension({
      type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 1,
      authority_kind: "scope", owner_evidence: "untyped path prose is not scope authority",
    }, options(dir)).state, "repair-owner-extension-invalid");
    const scope = recordOwnerExtension({
      type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 1,
      authority_kind: "scope", owner_evidence: "Owner authorized adding exactly src/a.mjs",
      added_paths: ["src/a.mjs"],
    }, options(dir));
    assert.equal(scope.ok, true);
    mutate(dir, 2);
    const expansion = {
      ...repair, finding_class: "scope-expansion", authorized_paths: ["src/base.mjs", "src/a.mjs"], new_scope: true,
    };
    assert.equal(recordRoundDisposition(round(2, expansion), options(dir)).state, "repair-scope-unapproved",
      "missing exact Owner event denies the expanded round");
    assert.equal(recordRoundDisposition(round(2, {
      ...expansion, owner_scope_event_id: "f".repeat(64),
    }), options(dir)).state, "repair-scope-unapproved", "wrong Owner event denies the expanded round");
    const authorizedExpansion = round(2, { ...expansion, owner_scope_event_id: scope.event_id });
    assert.equal(recordRoundDisposition(authorizedExpansion, options(dir)).ok, true);
    assert.equal(recordRoundDisposition(authorizedExpansion, options(dir)).idempotent, true,
      "an uncertain authorized expansion retry converges on its accepted row");

    assert.equal(validateRepairDispatch(nextDeclaration(dir).declaration, {
      events: state(dir).loaded.events, taskId: "task-1", targetKind: "brief", target: "briefs/round-3.md",
    }).state, "repair-scope-unapproved", "dispatch must carry the accepted expansion's exact Owner event");
    const nextRepair = dispatchNext(dir, { owner_scope_event_id: scope.event_id });
    assert.equal(recordWorkerVerification({
      task_id: "task-1", repair_dispatch_event_id: nextRepair.repair_dispatch_event_id,
    }, { projectRoot: dir, sessionId: "expanded-worker" }).ok, true);
    assert.equal(verifyRepairWorkerWrite({
      task_id: "task-1", session_id: "expanded-worker", target: "src/a.mjs",
    }, { projectRoot: dir }).ok, true, "the authorized exact addition reaches worker admission");
  } finally { cleanup(); }
});

test("scope Owner events canonicalize sets, conflict by typed paths, and cannot be reused after a later round", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1, {
      authorized_paths: ["src/base.mjs"], finding_class: "first",
    }), options(dir)).ok, true);
    const repair2 = dispatchNext(dir);
    const scopeInput = {
      type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 1,
      authority_kind: "scope", owner_evidence: "Owner authorized exactly A and B",
      added_paths: ["src/b.mjs", "src/a.mjs"],
    };
    const scope = recordOwnerExtension(scopeInput, options(dir));
    assert.equal(scope.ok, true);
    const retry = recordOwnerExtension({ ...scopeInput, added_paths: ["src/a.mjs", "src/b.mjs"] }, options(dir));
    assert.equal(retry.event_id, scope.event_id, "set order normalizes to one durable authority event");
    assert.equal(retry.idempotent, true);
    assert.equal(recordOwnerExtension({ ...scopeInput, added_paths: ["src/a.mjs"] }, options(dir)).state,
      "repair-owner-extension-conflict", "a different typed set conflicts at the same authority boundary");

    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2, {
      ...repair2, authorized_paths: ["src/base.mjs"], finding_class: "second",
    }), options(dir)).ok, true);
    const repair3 = dispatchNext(dir);
    mutate(dir, 3);
    assert.equal(recordRoundDisposition(round(3, {
      ...repair3, authorized_paths: ["src/base.mjs", "src/a.mjs", "src/b.mjs"], finding_class: "third",
      new_scope: true, owner_scope_event_id: scope.event_id,
    }), options(dir)).state, "repair-scope-unapproved",
    "an exact scope event from an older accepted round is stale at the new boundary");
  } finally { cleanup(); }
});

test("repair scope reductions and unchanged exact sets need no Owner scope event", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1, {
      authorized_paths: ["src/a.mjs", "src/b.mjs"], finding_class: "first",
    }), options(dir)).ok, true);
    let repair = dispatchNext(dir);
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2, {
      ...repair, authorized_paths: ["src/a.mjs"], finding_class: "second", new_scope: false,
    }), options(dir)).ok, true, "a reduction does not require scope authority");
    repair = dispatchNext(dir);
    mutate(dir, 3);
    assert.equal(recordRoundDisposition(round(3, {
      ...repair, authorized_paths: ["src/a.mjs"], finding_class: "third", new_scope: false,
    }), options(dir)).ok, true, "an unchanged set does not require scope authority");
  } finally { cleanup(); }
});

test("a clean GO is recordable and closes the changeset without inventing a finding", () => {
  const { dir, cleanup } = repo();
  try {
    const go = recordRoundDisposition({
      type: "round_disposition", task_id: "task-1", changeset_id: "changeset-1", round: 1,
      candidate_paths: ["src/x.mjs"], verdict: "GO", ownership_area: "repair-controller",
    }, options(dir));
    assert.equal(go.ok, true);
    const { derived } = state(dir);
    assert.equal(derived.latest.verdict, "GO");
    assert.deepEqual(derived.latest.finding_ids, []);
    assert.equal(derived.root_cause_required, false);
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2), options(dir)).state, "repair-changeset-closed");
  } finally { cleanup(); }
});

test("candidate manifest and digest must agree inside durable history", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const { loaded } = state(dir);
    const tampered = structuredClone(loaded.events);
    tampered[0].event.candidate_manifest[0].oid = "f".repeat(40);
    assert.equal(deriveRepairState(tampered, "task-1").state, "repair-history-invalid");
  } finally { cleanup(); }
});

test("root-cause exit, R7 audit, and R9 Owner extension are exact typed evidence", () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `class-${n}`, ...authority }), options(dir)).ok, true);
      if (n < 3) authority = dispatchNext(dir);
    }
    let current = state(dir).derived;
    assert.equal(current.root_cause_required, true, "Round 3 triggers the soft stop even without class recurrence");
    mutate(dir, 4);
    assert.equal(recordRoundDisposition(round(4, { repair_dispatch_event_id: "invented" }), options(dir)).state,
      "repair-root-cause-exit-missing");
    const exit = recordRootCauseExit({
      type: "root_cause_exit", task_id: "task-1", changeset_id: "changeset-1", after_round: 3,
      shared_mechanism: "repair authority was carried only in per-dispatch prose",
      symptom_explanation: "each local patch left the shared transition unbound",
      owner_state_yield_seams: ["Owner declares semantic class", "ledger binds state and yield"],
      replacement: "one Git-common typed event stream consumed by every dispatch",
      removed_workarounds: ["free-form evidence pointers", "round labels in chat"],
      trigger_matrix: ["refreeze cannot reset", "repair relabel cannot bypass"],
    }, options(dir));
    assert.equal(exit.ok, true);
    assert.equal(recordRootCauseExit({
      type: "root_cause_exit", task_id: "task-1", changeset_id: "changeset-1", after_round: 3,
      shared_mechanism: "repair authority was carried only in per-dispatch prose",
      symptom_explanation: "each local patch left the shared transition unbound",
      owner_state_yield_seams: ["Owner declares semantic class", "ledger binds state and yield"],
      replacement: "one Git-common typed event stream consumed by every dispatch",
      removed_workarounds: ["free-form evidence pointers", "round labels in chat"],
      trigger_matrix: ["refreeze cannot reset", "repair relabel cannot bypass"],
    }, options(dir)).idempotent, true, "an uncertain event write can be retried safely");
    current = state(dir).derived;
    assert.equal(current.root_cause_required, false);

    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id });
    for (let n = 4; n <= 6; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `root-${n}`, ...authority }), options(dir)).ok, true);
      if (n < 6) authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id });
    }
    mutate(dir, 7);
    assert.equal(recordRoundDisposition(round(7, {
      root_cause_exit_event_id: exit.event_id, repair_dispatch_event_id: "invented",
    }), options(dir)).state, "repair-adherence-audit-missing");
    const audit = recordAdherenceAudit({
      type: "adherence_audit", task_id: "task-1", changeset_id: "changeset-1", after_round: 6,
      rule1: "pass", gate_accounting: "pass", root_cause_discipline: "pass",
    }, options(dir));
    assert.equal(audit.ok, true);
    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id, adherence_audit_event_id: audit.event_id });
    mutate(dir, 7);
    assert.equal(recordRoundDisposition(round(7, { finding_class: "root-7", ...authority }), options(dir)).ok, true);
    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id, adherence_audit_event_id: audit.event_id });
    mutate(dir, 8);
    assert.equal(recordRoundDisposition(round(8, { finding_class: "root-8", ...authority }), options(dir)).ok, true);
    mutate(dir, 9);
    assert.equal(recordRoundDisposition(round(9, {
      root_cause_exit_event_id: exit.event_id, adherence_audit_event_id: audit.event_id,
      repair_dispatch_event_id: "invented",
    }), options(dir)).state, "repair-owner-extension-missing");
    const extension = recordOwnerExtension({
      type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 8,
      authority_kind: "rounds", owner_evidence: "Owner authorized two further rounds after the internal audit",
    }, options(dir));
    assert.equal(extension.ok, true);
    current = state(dir).derived;
    assert.equal(current.audit.event_id, audit.event_id);
    assert.equal(current.round_extension.event_id, extension.event_id);
  } finally { cleanup(); }
});

test("concurrent incompatible root exits are first-wins and a losing replay stays conflict", async () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `class-${n}`, ...authority }), options(dir)).ok, true);
      if (n < 3) authority = dispatchNext(dir);
    }
    const makeInput = (mechanism) => ({
      type: "root_cause_exit", task_id: "task-1", changeset_id: "changeset-1", after_round: 3,
      shared_mechanism: mechanism, symptom_explanation: `symptoms from ${mechanism}`,
      owner_state_yield_seams: ["Owner", "state", "yield"], replacement: `replace ${mechanism}`,
      removed_workarounds: [`remove ${mechanism}`], trigger_matrix: [`trigger ${mechanism}`],
    });
    const moduleUrl = new URL("../hooks/repair-dispatch-state.mjs", import.meta.url).href;
    const script = `import { recordRootCauseExit } from ${JSON.stringify(moduleUrl)};\n` +
      `const [dir, input] = process.argv.slice(1); const event=JSON.parse(input);` +
      `process.stdout.write(JSON.stringify(recordRootCauseExit(event,{projectRoot:dir,sessionId:event.shared_mechanism})));`;
    const run = (input) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir, JSON.stringify(input)],
        { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    const inputs = [makeInput("mechanism-a"), makeInput("mechanism-b")];
    const results = await Promise.all(inputs.map(run));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.state === "repair-root-exit-conflict").length, 1);
    const losingIndex = results[0].ok ? 1 : 0;
    assert.equal(recordRootCauseExit(inputs[losingIndex], options(dir)).state, "repair-root-exit-conflict",
      "the physically appended loser never becomes idempotent authority on replay");
    assert.equal(state(dir).derived.root_exit.shared_mechanism, inputs[losingIndex === 0 ? 1 : 0].shared_mechanism);
  } finally { cleanup(); }
});

test("concurrent audits converge and incompatible Owner extensions remain first-wins on replay", async () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `class-${n}`, ...authority }), options(dir)).ok, true);
      if (n < 3) authority = dispatchNext(dir);
    }
    const exit = recordRootCauseExit({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 3,
      shared_mechanism: "one controller", symptom_explanation: "local labels did not bind authority",
      owner_state_yield_seams: ["Owner", "state", "yield"], replacement: "typed transitions",
      removed_workarounds: ["chat labels"], trigger_matrix: ["same event key conflicts"],
    }, options(dir));
    assert.equal(exit.ok, true);
    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id });
    for (let n = 4; n <= 6; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `root-${n}`, ...authority }), options(dir)).ok, true);
      if (n < 6) authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id });
    }
    const moduleUrl = new URL("../hooks/repair-dispatch-state.mjs", import.meta.url).href;
    const concurrent = (exportName, inputs) => Promise.all(inputs.map((input, index) => new Promise((resolve, reject) => {
      const script = `const m=await import(${JSON.stringify(moduleUrl)}); const [dir,input,session]=process.argv.slice(1);` +
        `process.stdout.write(JSON.stringify(m[${JSON.stringify(exportName)}](JSON.parse(input),` +
        `{projectRoot:dir,sessionId:session})));`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir,
        JSON.stringify(input), `session-${index}`], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    })));
    const auditInput = { type: "adherence_audit", task_id: "task-1", changeset_id: "changeset-1",
      after_round: 6, rule1: "pass", gate_accounting: "pass", root_cause_discipline: "pass" };
    const audits = await concurrent("recordAdherenceAudit", [auditInput, auditInput]);
    assert.ok(audits.every((result) => result.ok));
    assert.equal(new Set(audits.map((result) => result.event_id)).size, 1,
      "identical concurrent audits converge on the first event");
    const auditId = audits[0].event_id;
    for (let n = 7; n <= 8; n += 1) {
      authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id, adherence_audit_event_id: auditId });
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `root-${n}`, ...authority }), options(dir)).ok, true);
    }
    const extensionInputs = ["evidence-a", "evidence-b"].map((owner_evidence) => ({
      type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 8,
      authority_kind: "rounds", owner_evidence,
    }));
    const extensions = await concurrent("recordOwnerExtension", extensionInputs);
    assert.equal(extensions.filter((result) => result.ok).length, 1);
    assert.equal(extensions.filter((result) => result.state === "repair-owner-extension-conflict").length, 1);
    const losingIndex = extensions[0].ok ? 1 : 0;
    assert.equal(recordOwnerExtension(extensionInputs[losingIndex], options(dir)).state,
      "repair-owner-extension-conflict", "a losing Owner-extension row stays non-authoritative on replay");
    const winnerEvidence = extensionInputs[losingIndex === 0 ? 1 : 0].owner_evidence;
    assert.equal(state(dir).derived.round_extension.owner_evidence, winnerEvidence);
  } finally { cleanup(); }
});

test("repair dispatch must match the latest verdict and every required authority event", () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { ...authority, finding_class: `class-${n}` }), options(dir)).ok, true);
      if (n < 3) authority = dispatchNext(dir);
    }
    const exit = recordRootCauseExit({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 3,
      shared_mechanism: "per-dispatch strings were the only authority",
      symptom_explanation: "renames and refreezes could reset the apparent history",
      owner_state_yield_seams: ["author declaration", "durable transition"],
      replacement: "typed shared ledger",
      removed_workarounds: ["pointer strings"], trigger_matrix: ["round reset denies"],
    }, options(dir));
    assert.equal(exit.ok, true);
    const { loaded, derived } = state(dir);
    const v = derived.latest;
    const declaration = {
      task_id: "task-1", changeset_id: "changeset-1", candidate_sha: v.candidate_sha, round: 4,
      finding_ids: v.finding_ids, finding_class: v.finding_class, ownership_area: v.ownership_area,
      original_trigger: v.original_trigger, authorized_paths: v.authorized_paths,
      introduced_by_prior_repair: v.introduced_by_prior_repair, new_scope: v.new_scope,
      root_cause_exit_event_id: exit.event_id,
    };
    assert.equal(validateRepairDispatch({ ...declaration, root_cause_exit_event_id: "invented" }, {
      events: loaded.events, taskId: "task-1", targetKind: "brief", target: "briefs/fix.md",
    }).state, "repair-root-cause-exit-missing");
    assert.equal(validateRepairDispatch({ ...declaration, authorized_paths: ["src/other.mjs"] }, {
      events: loaded.events, taskId: "task-1", targetKind: "brief", target: "briefs/fix.md",
    }).state, "repair-history-mismatch");
    const valid = validateRepairDispatch(declaration, {
      events: loaded.events, taskId: "task-1", targetKind: "brief", target: "briefs/fix.md",
    });
    assert.equal(valid.ok, true);
    assert.equal(validateRepairDispatch(declaration, {
      events: loaded.events, taskId: "task-1", targetKind: "send", target: "worker-1",
    }).state, "repair-brief-required", "repair authority must first become a durable brief");
    mkdirSync(path.join(dir, "briefs"), { recursive: true });
    writeFileSync(path.join(dir, "briefs", "fix.md"), "repair\n");
    const receipt = confirmRepairBrief({ declaration, brief_path: "briefs/fix.md" }, options(dir));
    assert.equal(receipt.ok, true);
    assert.equal(state(dir).derived.dispatches.length, 3);
  } finally { cleanup(); }
});

test("only REMEDIATE dispositions authorize a repair brief", () => {
  for (const disposition of ["NOTE", "DEFER", "DECLINE", "ESCALATE"]) {
    const { dir, cleanup } = repo();
    try {
      assert.equal(recordRoundDisposition(round(1, { disposition }), options(dir)).ok, true);
      const { loaded, derived } = state(dir);
      const v = derived.latest;
      const declaration = {
        task_id: "task-1", changeset_id: "changeset-1", candidate_sha: v.candidate_sha, round: 2,
        finding_ids: v.finding_ids, finding_class: v.finding_class, ownership_area: v.ownership_area,
        original_trigger: v.original_trigger, authorized_paths: v.authorized_paths,
        introduced_by_prior_repair: false, new_scope: false,
      };
      assert.equal(validateRepairDispatch(declaration, {
        events: loaded.events, taskId: "task-1", targetKind: "brief", target: "briefs/fix.md",
      }).state, "repair-disposition-not-authorized", disposition);
    } finally { cleanup(); }
  }
});

test("a later gate result requires its exact prior repair brief and threshold evidence", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2), options(dir)).state, "repair-brief-receipt-missing");
    const r2Authority = dispatchNext(dir);
    assert.equal(recordRoundDisposition(round(2, r2Authority), options(dir)).ok, true);
    assert.equal(recordRoundDisposition(round(3, { repair_dispatch_event_id: "invented" }), options(dir)).state,
      "repair-root-cause-exit-missing");
    const exit = recordRootCauseExit({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 2,
      shared_mechanism: "the writer accepted gate outcomes without their authorizing brief",
      symptom_explanation: "dispatch-only checks left closure independently permissive",
      owner_state_yield_seams: ["Owner declares class", "controller binds transitions"],
      replacement: "one next-round authority predicate at dispatch and disposition",
      removed_workarounds: ["free-form round labels"], trigger_matrix: ["missing brief denies"],
    }, options(dir));
    assert.equal(exit.ok, true);
    const r3Authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id });
    mutate(dir, 3);
    assert.equal(recordRoundDisposition(round(3, r3Authority), options(dir)).ok, true);
  } finally { cleanup(); }
});

test("concurrent conflicting round writes are first-wins and never poison history", async () => {
  const { dir, cleanup } = repo();
  try {
    const moduleUrl = new URL("../hooks/repair-dispatch-state.mjs", import.meta.url).href;
    const script = `import { recordRoundDisposition } from ${JSON.stringify(moduleUrl)};\n` +
      `const [dir, cls] = process.argv.slice(1);\n` +
      `const input = { task_id:'task-1', changeset_id:'changeset-1', round:1, candidate_paths:['src/x.mjs'],` +
      ` verdict:'NO-GO', disposition:'REMEDIATE', finding_ids:[cls], finding_class:cls, ownership_area:'writer',` +
      ` original_trigger:cls, authorized_paths:['src/x.mjs'], introduced_by_prior_repair:false, new_scope:false };\n` +
      `process.stdout.write(JSON.stringify(recordRoundDisposition(input,{projectRoot:dir,sessionId:cls})));`;
    const run = (cls) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir, cls], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run(`class-${i}`)));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => r.state === "repair-round-conflict").length, 7);
    const { loaded, derived } = state(dir);
    assert.equal(derived.verdicts.length, 1);
    assert.ok(loaded.events.length >= 1, "the first authority row remains durable");
  } finally { cleanup(); }
});

test("concurrent Round-1 task relabels are globally first-wins for one changeset", async () => {
  const { dir, cleanup } = repo();
  try {
    const moduleUrl = new URL("../hooks/repair-dispatch-state.mjs", import.meta.url).href;
    const script = `import { recordRoundDisposition } from ${JSON.stringify(moduleUrl)};\n` +
      `const [dir, task] = process.argv.slice(1);\n` +
      `const input = { task_id:task, changeset_id:'one-program', round:1, candidate_paths:['src/x.mjs'],` +
      ` verdict:'NO-GO', disposition:'REMEDIATE', finding_ids:['F1'], finding_class:'identity',` +
      ` ownership_area:'controller', original_trigger:'task relabel', authorized_paths:['src/x.mjs'],` +
      ` introduced_by_prior_repair:false, new_scope:false };\n` +
      `process.stdout.write(JSON.stringify(recordRoundDisposition(input,{projectRoot:dir,sessionId:task})));`;
    const run = (task) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir, task],
        { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    const results = await Promise.all([run("task-a"), run("task-b")]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.state === "repair-round-conflict").length, 1);
    const events = loadRepairEventsForProject(dir).events;
    const winnerTask = results[0].ok ? "task-a" : "task-b";
    const loserTask = winnerTask === "task-a" ? "task-b" : "task-a";
    assert.equal(deriveRepairState(events, winnerTask).ok, true);
    assert.equal(deriveRepairState(events, loserTask).state, "repair-identity-conflict");
  } finally { cleanup(); }
});

test("concurrent changeset relabels under one task do not poison the winning history", async () => {
  const { dir, cleanup } = repo();
  try {
    const moduleUrl = new URL("../hooks/repair-dispatch-state.mjs", import.meta.url).href;
    const script = `import { recordRoundDisposition } from ${JSON.stringify(moduleUrl)};` +
      `const [dir,cs]=process.argv.slice(1); const input={task_id:'one-task',changeset_id:cs,round:1,` +
      `candidate_paths:['src/x.mjs'],verdict:'NO-GO',disposition:'REMEDIATE',finding_ids:['F1'],` +
      `finding_class:'identity',ownership_area:'controller',original_trigger:'changeset relabel',` +
      `authorized_paths:['src/x.mjs'],introduced_by_prior_repair:false,new_scope:false};` +
      `process.stdout.write(JSON.stringify(recordRoundDisposition(input,{projectRoot:dir,sessionId:cs})));`;
    const run = (cs) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, dir, cs],
        { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    const results = await Promise.all([run("changeset-a"), run("changeset-b")]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.state === "repair-round-conflict").length, 1);
    const derived = deriveRepairState(loadRepairEventsForProject(dir).events, "one-task");
    assert.equal(derived.ok, true);
    assert.equal(derived.verdicts.length, 1, "the losing physical row is evidence, not authority");
  } finally { cleanup(); }
});

test("a fresh adopter receives an executable repair-event recorder", () => {
  const { dir, cleanup } = repo();
  try {
    const codexDir = path.join(dir, "codex-prompts");
    execFileSync(process.execPath, [path.resolve("bin/init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--codex-prompts-dir", codexDir, "--force"], { cwd: path.resolve("."), stdio: "ignore" });
    const recorder = path.join(dir, "scripts", "record-repair-event.mjs");
    assert.equal(lstatSync(recorder).isFile(), true);
    assert.equal(lstatSync(path.join(dir, "scripts", "confirm-repair-brief.mjs")).isFile(), true);
    const eventFile = path.join(dir, "round.json");
    writeFileSync(eventFile, JSON.stringify({
      type: "round_disposition", task_id: "task-1", changeset_id: "changeset-1", round: 1,
      candidate_paths: ["src/x.mjs"], verdict: "GO", ownership_area: "adopter",
    }));
    const { WORKFLOW_KIT_SESSION_ID: _ignoredSession, ...envWithoutSession } = process.env;
    const missingSession = spawnSync(process.execPath, [recorder, "--event", eventFile], {
      cwd: dir, encoding: "utf8", env: envWithoutSession,
    });
    assert.equal(missingSession.status, 1);
    assert.match(missingSession.stderr, /repair-session-missing/);
    assert.match(missingSession.stderr, /add the current session as "session_id"/);
    writeFileSync(eventFile, JSON.stringify({
      type: "round_disposition", task_id: "task-1", changeset_id: "changeset-1", round: 1,
      candidate_paths: ["src/x.mjs"], verdict: "GO", ownership_area: "adopter", session_id: "session-1",
    }));
    const ok = spawnSync(process.execPath, [recorder, "--event", eventFile], {
      cwd: dir, encoding: "utf8", env: envWithoutSession,
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /"ok":true/);
    const bad = spawnSync(process.execPath, [recorder, "--event", eventFile], {
      cwd: dir, encoding: "utf8", env: envWithoutSession,
    });
    assert.equal(bad.status, 0, "an uncertain recorder retry is idempotent");
    writeFileSync(eventFile, JSON.stringify({ type: "unsupported" }));
    const rejected = spawnSync(process.execPath, [recorder, "--event", eventFile], {
      cwd: dir, encoding: "utf8", env: envWithoutSession,
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /repair-event-type-unsupported/);
  } finally { cleanup(); }
});

test("linked worktrees resolve one Git-common repair ledger", () => {
  const { dir, cleanup } = repo();
  const wt = `${dir}-linked`;
  try {
    execFileSync("git", ["worktree", "add", "-q", "-b", "linked-test", wt], { cwd: dir });
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    assert.equal(repairLedgerPath(dir), repairLedgerPath(wt));
    assert.equal(loadRepairEventsForProject(wt).events.length, 1);
  } finally {
    try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: dir }); } catch {}
    rmSync(wt, { recursive: true, force: true });
    cleanup();
  }
});

test("truncated, corrupt, and symlinked ledgers fail closed", () => {
  const { dir, cleanup } = repo();
  try {
    const file = repairLedgerPath(dir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{not json}\n");
    assert.equal(readRepairEvents(file), null);
    writeFileSync(file, JSON.stringify({ event_id: "x", event: {} }));
    assert.equal(readRepairEvents(file), null, "missing trailing newline is a torn row");
    rmSync(file);
    const outside = path.join(dir, "outside.jsonl");
    writeFileSync(outside, "");
    symlinkSync(outside, file);
    assert.equal(readRepairEvents(file), null);
    assert.equal(recordRoundDisposition(round(1), options(dir)).state, "repair-round-malformed");
  } finally { cleanup(); }
});
