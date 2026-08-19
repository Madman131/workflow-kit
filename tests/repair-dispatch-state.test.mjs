import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeRepairPathOwners, confirmRepairBrief, deriveRepairState, gitSubjectPresent,
  loadRepairEventsForProject, readRepairEvents, recordAdherenceAudit, recordOwnerExtension,
  recordRepairClose, recordRootCauseExit, recordRoundDisposition, recordWorkerVerification,
  repairLedgerPath, validateRepairDispatch, verifyRepairBriefReceipt, verifyRepairWorkerWrite,
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
// The controller's own event-id rule, restated here ON PURPOSE: a test that forges a ledger row must
// forge it the way the format demands, or it proves only that a malformed row is rejected.
const forgedId = (event) => {
  const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
    : (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype)
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`
      : JSON.stringify(v);
  return createHash("sha256").update(stable(event)).digest("hex");
};
const mutate = (dir, n) => writeFileSync(path.join(dir, "src", "x.mjs"), `export const x = ${n};\n`);
// Distinct classes per round, EXCEPT that round 3 repeats round 2's — which fires the mechanical
// recurrence trigger (two consecutive NO-GOs sharing a finding class) and makes a root exit owed
// after round 3. Tests below need a history where the root exit is legitimately required; they used
// to get there because the controller triggered on the round NUMBER, and that positional trigger is
// gone. The subject of those tests is concurrency and first-wins, not how the trigger fired.
const recurringClass = (n) => (n === 3 ? "class-2" : `class-${n}`);

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

test("the root-cause exit follows the TRIGGER, and no round NUMBER gates anything", () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    // POLARITY ONE — the deleted gate. Three NO-GO rounds of DISTINCT finding classes, none
    // repair-introduced. Under the linear ladder this reached "round 3 is the soft stop" and owed a
    // root exit; the cadence is circular now, a cycle boundary falls at a round number this module
    // cannot know, and deciding it here gated repos by a shape they had stopped having.
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `class-${n}`, ...authority }), options(dir)).ok, true);
      authority = dispatchNext(dir);
    }
    assert.equal(state(dir).derived.root_cause_required, false,
      "a round NUMBER must not owe a root-cause exit — that is the procedure's cadence call, not this module's");
    mutate(dir, 4);
    assert.equal(recordRoundDisposition(round(4, { finding_class: "class-4", ...authority }), options(dir)).ok, true,
      "round 4 proceeds on an untriggered history with no root-cause exit anywhere");
    // ...and no round number gates the far end either: reach round 9 with no adherence audit and no
    // Owner extension in the ledger. Those two gates keyed on absolute 7 and 9.
    for (let n = 5; n <= 9; n += 1) {
      authority = dispatchNext(dir);
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: `class-${n}`, ...authority }), options(dir)).ok, true,
        `round ${n} must not be gated by an absolute round number`);
    }
    const far = state(dir).derived;
    assert.equal(far.latest.round, 9);
    assert.equal(far.audit, null, "no adherence audit was ever minted, and none was demanded");
    assert.equal(far.round_extension, null, "no Owner round-extension was ever minted, and none was demanded");
  } finally { cleanup(); }
});

test("POLARITY: each MECHANICAL root-cause trigger still fires, and its exit is exact typed evidence", () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    // A repair-INTRODUCED harm is a mechanical trigger on its own, at whatever round it lands.
    mutate(dir, 1);
    assert.equal(recordRoundDisposition(round(1, { finding_class: "class-1" }), options(dir)).ok, true);
    authority = dispatchNext(dir);
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2, {
      finding_class: "class-2", introduced_by_prior_repair: true, ...authority,
    }), options(dir)).ok, true);
    assert.equal(state(dir).derived.root_cause_required, true,
      "a repair-introduced harm owes a root-cause exit — a MECHANICAL trigger, kept");
    assert.equal(state(dir).derived.trigger_round, 2, "the trigger is dated to the round that fired it");
  } finally { cleanup(); }
});

test("the recurrence trigger fires on two consecutive same-class NO-GOs, and its exit is exact typed evidence", () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: recurringClass(n), ...authority }), options(dir)).ok, true);
      if (n < 3) authority = dispatchNext(dir);
    }
    let current = state(dir).derived;
    assert.equal(current.root_cause_required, true,
      "two consecutive NO-GOs sharing a finding class owe a root-cause exit — the other MECHANICAL trigger");
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
    // The audit and the Owner extension are still RECORDABLE — they are evidence the procedure
    // chose to leave — but they no longer unlock a round, so they are minted where the cadence
    // actually put them rather than at a number this module picked. Round 7 needs neither.
    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id });
    mutate(dir, 7);
    assert.equal(recordRoundDisposition(round(7, { finding_class: "root-7", ...authority }), options(dir)).ok, true,
      "round 7 no longer demands an after-round-6 audit — a position the circular cadence does not use");
    const audit = recordAdherenceAudit({
      type: "adherence_audit", task_id: "task-1", changeset_id: "changeset-1", after_round: 7,
      rule1: "pass", gate_accounting: "pass", root_cause_discipline: "pass",
    }, options(dir));
    assert.equal(audit.ok, true, "an audit is recordable at the round the cadence chose, not only after round 6");
    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id, adherence_audit_event_id: audit.event_id });
    mutate(dir, 8);
    assert.equal(recordRoundDisposition(round(8, { finding_class: "root-8", ...authority }), options(dir)).ok, true);
    const extension = recordOwnerExtension({
      type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1", after_round: 8,
      authority_kind: "rounds", owner_evidence: "Owner authorized two further rounds after the internal audit",
    }, options(dir));
    assert.equal(extension.ok, true);
    authority = dispatchNext(dir, { root_cause_exit_event_id: exit.event_id, adherence_audit_event_id: audit.event_id });
    mutate(dir, 9);
    assert.equal(recordRoundDisposition(round(9, { finding_class: "root-9", ...authority }), options(dir)).ok, true,
      "round 9 no longer demands an Owner extension — when the rounds stop is the procedure's call");
    current = state(dir).derived;
    assert.equal(current.audit.event_id, audit.event_id, "the audit is still surfaced as evidence");
    assert.equal(current.exits[0].event_id, exit.event_id);
    assert.equal(current.extensions.some((e) => e.event_id === extension.event_id), true);
  } finally { cleanup(); }
});

test("concurrent incompatible root exits are first-wins and a losing replay stays conflict", async () => {
  const { dir, cleanup } = repo();
  try {
    let authority = {};
    for (let n = 1; n <= 3; n += 1) {
      mutate(dir, n);
      assert.equal(recordRoundDisposition(round(n, { finding_class: recurringClass(n), ...authority }), options(dir)).ok, true);
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
      assert.equal(recordRoundDisposition(round(n, { finding_class: recurringClass(n), ...authority }), options(dir)).ok, true);
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
      assert.equal(recordRoundDisposition(round(n, { ...authority, finding_class: recurringClass(n) }), options(dir)).ok, true);
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

// ── KO17: the write-lockout, its in-band exit, and the blind posture ────────────────────────────

test("A NON-REMEDIATE disposition holds NOTHING open — the reproduced repo lockout, cured", () => {
  // THE BUG, exactly as reproduced at v2.12.0: one recorded round-1 NO-GO whose disposition was
  // DEFER — a first-class disposition the PM contract encourages — denied EVERY source write in the
  // lane, including paths the repair never claimed, and denied the claimed path even from a lane
  // that had been relabelled or never declared at all. The only exit was deleting the ledger.
  for (const disposition of ["DEFER", "DECLINE", "ESCALATE", "NOTE"]) {
    const { dir, cleanup } = repo();
    try {
      assert.equal(recordRoundDisposition(round(1, { disposition }), options(dir)).ok, true);
      const derived = state(dir).derived;
      assert.equal(derived.latest.verdict, "NO-GO", `${disposition}: the verdict is still NO-GO`);
      assert.equal(derived.active, false,
        `${disposition} authorizes no repair, so it binds no worker and owns no path`);
      // The claimed path, from the lane that recorded it.
      assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/x.mjs" },
        { projectRoot: dir }).ok, true, `${disposition}: the lane's own write must not be denied`);
      // A path the repair never claimed — denied too, before the fix.
      assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/unrelated.mjs" },
        { projectRoot: dir }).ok, true, `${disposition}: an unclaimed path was never this control's business`);
      // No lane declared, and a relabelled lane: both were denied by global path ownership.
      assert.equal(verifyRepairWorkerWrite({ session_id: "s9", target: "src/x.mjs" },
        { projectRoot: dir }).ok, true, `${disposition}: an undeclared lane must not be locked out`);
      assert.equal(verifyRepairWorkerWrite({ task_id: "other-task", session_id: "s9", target: "src/x.mjs" },
        { projectRoot: dir }).ok, true, `${disposition}: another task must not be locked out`);
      assert.deepEqual(activeRepairPathOwners(state(dir).loaded.events, "src/x.mjs").owners, [],
        `${disposition}: a program that authorized no repair owns no path globally`);
    } finally { cleanup(); }
  }
});

test("POLARITY: a REMEDIATE program still binds every write until the worker is admitted", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);   // disposition REMEDIATE
    assert.equal(state(dir).derived.active, true);
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/x.mjs" },
      { projectRoot: dir }).state, "repair-worker-verification-missing",
      "an authorized repair still demands a verified worker admission — the control must not have been gutted");
    assert.equal(verifyRepairWorkerWrite({ task_id: "other-task", session_id: "s9", target: "src/x.mjs" },
      { projectRoot: dir }).state, "repair-task-relabel-path-owned",
      "and its claimed path is still globally owned against a lane relabel");
    assert.equal(activeRepairPathOwners(state(dir).loaded.events, "src/x.mjs").owners.length, 1);
  } finally { cleanup(); }
});

test("THE REMEDY THE DENY NAMES ACTUALLY WORKS — confirm, verify, write, executed end to end", () => {
  // The shipped guard named `confirm-repair-brief --verify` as the way out of
  // repair-worker-verification-missing, and that command FAILED on the state it was printed for.
  // A remedy is a claim about the system; this executes it.
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const blocked = verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-7", target: "src/x.mjs" },
      { projectRoot: dir });
    assert.equal(blocked.state, "repair-worker-verification-missing");

    const authority = dispatchNext(dir);                       // orchestrator: --confirm
    const admitted = recordWorkerVerification({                // worker: --verify, THIS session
      task_id: "task-1", repair_dispatch_event_id: authority.repair_dispatch_event_id,
    }, { projectRoot: dir, sessionId: "worker-7" });
    assert.equal(admitted.ok, true, admitted.state);

    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-7", target: "src/x.mjs" },
      { projectRoot: dir }).ok, true, "the named remedy must actually admit the write it promised");
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-7", target: "src/other.mjs" },
      { projectRoot: dir }).state, "repair-worker-path-unauthorized",
      "and it admits ONLY the exact authorized path — the remedy works without becoming a bypass");
  } finally { cleanup(); }
});

test("an abandoned REMEDIATE program is closed IN BAND, on a recorded authorization, never by deleting history", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/x.mjs" },
      { projectRoot: dir }).ok, false, "the program is active, so the write is bound");

    // A close naming no close-authorization row is refused. (What the eligibility test compares is
    // session IDS, not actors — see the ELIGIBLE CLOSE definition in the controller.)
    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "abandoning this repair",
      owner_close_event_id: "f".repeat(64),
    }, options(dir)).state, "repair-close-unauthorized");
    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "abandoning this repair",
    }, options(dir)).state, "repair-close-invalid", "a close with no authorization ID at all is malformed");

    const authorization = recordOwnerExtension({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, authority_kind: "close",
      owner_evidence: "Owner: this repair is abandoned, release the paths",
    }, options(dir));
    assert.equal(authorization.ok, true, authorization.state);

    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 2, reason: "wrong round",
      owner_close_event_id: authorization.event_id,
    }, options(dir)).state, "repair-close-invalid", "a close must name the CURRENT round");

    const closed = recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "abandoning this repair",
      owner_close_event_id: authorization.event_id,
    }, options(dir));
    assert.equal(closed.ok, true, closed.state);
    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "abandoning this repair",
      owner_close_event_id: authorization.event_id,
    }, options(dir)).idempotent, true, "an uncertain close can be retried safely");

    const derived = state(dir).derived;
    assert.equal(derived.active, false, "a closed program binds no writes");
    assert.equal(derived.close.reason, "abandoning this repair", "and the ledger keeps WHY, which deleting it destroyed");
    assert.equal(derived.verdicts.length, 1, "the history the old recovery would have destroyed is still here");
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/x.mjs" },
      { projectRoot: dir }).ok, true);
    assert.deepEqual(activeRepairPathOwners(state(dir).loaded.events, "src/x.mjs").owners, []);
  } finally { cleanup(); }
});

test("a closed program REOPENS on the next recorded round — a close ends a repair, not a changeset", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const authorization = recordOwnerExtension({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, authority_kind: "close",
      owner_evidence: "Owner: pause this repair",
    }, options(dir));
    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "paused",
      owner_close_event_id: authorization.event_id,
    }, options(dir)).ok, true);
    assert.equal(state(dir).derived.active, false);

    const authority = dispatchNext(dir);
    mutate(dir, 2);
    assert.equal(recordRoundDisposition(round(2, authority), options(dir)).ok, true);
    assert.equal(state(dir).derived.active, true,
      "the close named round 1; a round 2 result is a live repair again and binds writes again");
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/x.mjs" },
      { projectRoot: dir }).ok, false);
  } finally { cleanup(); }
});

test("NO SUBJECT is not the same failure as NO ACCESS — and only the first may relieve a write", () => {
  // Shipped behavior: ANY git-resolution failure denied every source write, even where no ledger
  // could exist. A control that cannot see must say so; it must not deny-all silently.
  const outside = mkdtempSync(path.join(os.tmpdir(), "repair-no-subject-"));
  try {
    assert.equal(gitSubjectPresent(outside, { env: {} }), false);
    assert.equal(loadRepairEventsForProject(outside, { env: {} }).state, "repair-ledger-no-subject");

    const { dir, cleanup } = repo();
    try {
      // A real repository. Git is unavailable to the hook, but a ledger COULD exist here.
      const brokenGit = () => { throw new Error("git: command not found"); };
      assert.equal(gitSubjectPresent(dir, { env: {} }), true, "a `.git` above the root is a subject");
      assert.equal(loadRepairEventsForProject(dir, { execGit: brokenGit, env: {} }).state,
        "repair-ledger-unavailable", "git off the PATH inside a real repo still DENIES — the subject may exist");

      // THE ENVIRONMENT OVERRIDE. `git rev-parse` honours GIT_DIR, so a work tree can have its
      // Git-common directory selected with no `.git` under the walk root at all. A filesystem-only
      // test would call that "no subject" and hand back a write it had not checked.
      for (const name of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE"]) {
        assert.equal(gitSubjectPresent(outside, { env: { [name]: path.join(dir, ".git") } }), true,
          `${name} selects a repository elsewhere — that is a subject, so it must not be relieved`);
        assert.equal(loadRepairEventsForProject(outside, { execGit: brokenGit, env: { [name]: path.join(dir, ".git") } }).state,
          "repair-ledger-unavailable", `${name} set must DENY, never fall through to no-subject`);
      }
      assert.equal(gitSubjectPresent(outside, { env: { GIT_DIR: "   " } }), false,
        "an empty-but-present override is not a repository selection");
    } finally { cleanup(); }
  } finally { rmSync(outside, { recursive: true, force: true }); }
});

test("POLARITY: a corrupt ledger inside a real repo still DENIES, and says how to repair it", () => {
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const ledger = repairLedgerPath(dir);
    writeFileSync(ledger, `${readFileSync(ledger, "utf8")}{"event_id":"nonsense"}\n`);
    const loaded = loadRepairEventsForProject(dir);
    assert.equal(loaded.state, "repair-ledger-unavailable",
      "a ledger that EXISTS and cannot be trusted is a subject this control cannot read — deny");
    assert.notEqual(loaded.state, "repair-ledger-no-subject",
      "corruption must never be mistaken for absence: that is the one confusion that would hand back an unchecked write");
  } finally { cleanup(); }
});

test("THE CONSTRAINED SESSION CANNOT CLOSE ITS OWN PROGRAM — the panel's bypass, shut", () => {
  // Found by a cold seat on round 1: the first close design took a close-authorization row by exact
  // event ID and checked nothing about WHO recorded it, so the admitted worker could mint the
  // authorization itself, close the program, and write the path it had just been refused. The
  // ledger's admitted worker sessions are the one identity signal that is actually IN the ledger,
  // so a close may come from neither the authorizing nor the closing side of an admitted session.
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const authority = dispatchNext(dir);
    assert.equal(recordWorkerVerification({
      task_id: "task-1", repair_dispatch_event_id: authority.repair_dispatch_event_id,
    }, { projectRoot: dir, sessionId: "worker-7" }).ok, true);

    // The worker mints its own close-authorization row and tries to release itself.
    const selfMinted = recordOwnerExtension({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, authority_kind: "close",
      owner_evidence: "Owner approved (claimed by the worker)",
    }, { projectRoot: dir, sessionId: "worker-7" });
    assert.equal(selfMinted.state, "repair-close-self-authorized",
      "the session the program constrains cannot mint its own release");
    assert.equal(state(dir).derived.active, true, "and the program is still live");

    // The legitimate shape: an authorization from a session that holds no worker admission.
    const owner = recordOwnerExtension({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, authority_kind: "close",
      owner_evidence: "Owner: abandon this repair",
    }, options(dir));
    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "abandoned",
      owner_close_event_id: owner.event_id,
    }, options(dir)).ok, true);
    assert.equal(state(dir).derived.active, false);

    assert.equal(state(dir).derived.close.reason, "abandoned");
  } finally { cleanup(); }
});

test("a closed program stops gating ORDINARY work, not just source writes", () => {
  // The panel found the build-brief path still reasoning from the bare verdict, so a closed program
  // released its paths while ordinary brief writing stayed trapped — the same lockout, one surface
  // over. Asserted through the sidecar contract the guard actually evaluates.
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1, { disposition: "DEFER" }), options(dir)).ok, true);
    const { derived } = state(dir);
    assert.equal(derived.latest.verdict, "NO-GO");
    assert.equal(derived.active, false,
      "a DEFER authorizes no repair, so an ordinary build brief is ordinary work — the guard keys on this");
  } finally { cleanup(); }
});

test("a hand-appended close from the constrained session is INERT — not authority, and not a brick", () => {
  // The authority check is a post-pass rather than an in-loop rejection for one reason: a
  // `repair_close` row is something any caller can append. If an unauthorized one FAILED the
  // history closed, appending a single row would seal the exit permanently — the lockout shape this
  // event exists to remove, rebuilt on the way out. So it must be ignored, and only ignored.
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const authority = dispatchNext(dir);
    assert.equal(recordWorkerVerification({
      task_id: "task-1", repair_dispatch_event_id: authority.repair_dispatch_event_id,
    }, { projectRoot: dir, sessionId: "worker-7" }).ok, true);
    const latest = state(dir).derived.latest;

    const stamp = (event) => ({ event_id: forgedId(event), event });
    const auth = { type: "owner_extension", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2026-08-19T00:00:00.000Z", session_id: "worker-7", after_round: 1,
      candidate_sha: latest.candidate_sha, authority_kind: "close",
      owner_evidence: "Owner approved (forged by the worker)" };
    const ledger = repairLedgerPath(dir);
    appendFileSync(ledger, `${JSON.stringify(stamp(auth))}\n`);
    const close = { type: "repair_close", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2026-08-19T00:00:01.000Z", session_id: "worker-7", after_round: 1,
      candidate_sha: latest.candidate_sha, reason: "releasing myself",
      owner_close_event_id: forgedId(auth) };
    appendFileSync(ledger, `${JSON.stringify(stamp(close))}\n`);

    // A close from a NON-admitted session resting on the worker's forged authorization — this
    // isolates the AUTHORIZATION half of the check, which the paired case above would mask.
    const launderedClose = { type: "repair_close", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2026-08-19T00:00:02.000Z", session_id: "an-innocent-session", after_round: 1,
      candidate_sha: latest.candidate_sha, reason: "closing on their behalf",
      owner_close_event_id: forgedId(auth) };
    appendFileSync(ledger, `${JSON.stringify(stamp(launderedClose))}\n`);

    const loaded = loadRepairEventsForProject(dir);
    assert.equal(loaded.ok, true, "the ledger stays readable — a forged row is data, not corruption");
    const derived = deriveRepairState(loaded.events, "task-1");
    assert.equal(derived.ok, true, "and derivation stays alive: an inert row must never brick a repo");
    assert.equal(derived.close, null,
      "neither forged close carries authority: not the one from the constrained session, and not the " +
      "laundered one resting on an authorization that session minted for itself");
    assert.equal(derived.active, true, "so the program is still live and still binds its paths");
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "s9", target: "src/x.mjs" },
      { projectRoot: dir }).ok, false);

    // ...and the slot it tried to squat is still available to a real authorization.
    const real = recordOwnerExtension({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, authority_kind: "close",
      owner_evidence: "Owner: abandon it",
    }, options(dir));
    assert.equal(real.ok, true, real.state);
    // ...and the OTHER half in isolation: a close from the constrained session resting on a
    // perfectly legitimate authorization is still refused.
    const workerClose = { type: "repair_close", task_id: "task-1", changeset_id: "changeset-1",
      recorded_at: "2026-08-19T00:00:03.000Z", session_id: "worker-7", after_round: 1,
      candidate_sha: latest.candidate_sha, reason: "using the real authorization",
      owner_close_event_id: real.event_id };
    appendFileSync(ledger, `${JSON.stringify(stamp(workerClose))}\n`);
    assert.equal(state(dir).derived.close, null,
      "a real authorization does not let the constrained session close its own program");
    assert.equal(state(dir).derived.active, true);
    const reclose = recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "abandoned",
      owner_close_event_id: real.event_id,
    }, options(dir));
    assert.equal(reclose.ok, true, `one appended row must not be able to seal the exit (got ${reclose.state})`);
    assert.equal(state(dir).derived.active, false);
  } finally { cleanup(); }
});

test("THE RESIDUAL, PINNED: an alias defeats the close check, and the code says so", () => {
  // Two cold seats walked this and were right both times. `session_id` is caller-supplied, so an
  // admitted worker that passes a name it has not used satisfies both session checks and closes the
  // program constraining it. This test asserts the HOLE, deliberately: the kit's rule is that a
  // residual is named rather than implied, and a limitation nobody executes is a limitation nobody
  // believes. If a later change closes this for real, THIS TEST GOES RED — which is the moment to
  // rewrite it and the comments that disclose it, together.
  //
  // ⚠ A GREEN RUN HERE MEANS THE HOLE IS STILL OPEN AND STILL DISCLOSED. It is not a security
  // property, and a suite summary that says "214 passing" says nothing about this one being safe.
  // One fresh alias is enough for both events; two are used below only to keep the sequence legible.
  const { dir, cleanup } = repo();
  try {
    assert.equal(recordRoundDisposition(round(1), options(dir)).ok, true);
    const authority = dispatchNext(dir);
    assert.equal(recordWorkerVerification({
      task_id: "task-1", repair_dispatch_event_id: authority.repair_dispatch_event_id,
    }, { projectRoot: dir, sessionId: "worker-7" }).ok, true);
    assert.equal(verifyRepairWorkerWrite({ task_id: "task-1", session_id: "worker-7", target: "src/other.mjs" },
      { projectRoot: dir }).ok, false, "the worker is constrained to its authorized path set");

    // The same actor, a name it has not used before.
    const alias = recordOwnerExtension({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, authority_kind: "close",
      owner_evidence: "Owner approved (in fact the worker, under another name)",
    }, { projectRoot: dir, sessionId: "worker-7-alias-a" });
    assert.equal(alias.ok, true, "an unadmitted NAME is accepted — nothing here authenticates anyone");
    assert.equal(recordRepairClose({
      task_id: "task-1", changeset_id: "changeset-1", after_round: 1, reason: "closing under an alias",
      owner_close_event_id: alias.event_id,
    }, { projectRoot: dir, sessionId: "worker-7-alias-b" }).ok, true);
    assert.equal(state(dir).derived.active, false, "and the program really is released — this is the residual");

    // What the design buys, stated at exactly its strength. A cold seat corrected an earlier version
    // of this comment, and the correction matters: the surviving row does NOT make an improper
    // release detectable. The alias here is self-revealing because a test wrote it; a real one would
    // read `owner-approver` and nothing in the ledger would contradict it. What survives is an
    // UNAUTHENTICATED CLAIM plus the history around it — better for recovery and for audit than a
    // deleted file, and not evidence of who did it.
    const derived = state(dir).derived;
    assert.equal(derived.close.reason, "closing under an alias");
    assert.equal(derived.close.session_id, "worker-7-alias-b",
      "the row records the name the release CLAIMED, which is all a caller-supplied id can ever be");
    assert.equal(derived.verdicts.length, 1, "every round of history survives an improper close");
    assert.equal(derived.dispatches.length, 1);
    assert.equal(derived.worker_verifications.length, 1,
      "and the admission survives too — recoverable context, NOT attribution: it does not tie the alias to the worker");

    // And the disclosure is IN THE SOURCE, not only in a review transcript.
    const source = readFileSync(new URL("../hooks/repair-dispatch-state.mjs", import.meta.url), "utf8");
    assert.match(source, /THE RESIDUAL, NAMED/,
      "the module must disclose this limitation where the next reader will meet it");
    assert.match(source, /THE LEDGER RECORDS; IT DOES NOT DETER/,
      "and must not describe the check as an authorization boundary");
  } finally { cleanup(); }
});
