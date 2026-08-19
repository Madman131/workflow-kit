#!/usr/bin/env node
// Shared, unregistered repair-round controller. Hooks import it; init installs it beside them.
// Semantic labels remain author declarations. This module enforces only durable continuity,
// evidence shape, exact references, and transition order.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync, constants as fsConstants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, writeSync,
} from "node:fs";
import path from "node:path";

export const REPAIR_LEDGER_REL = path.join("workflow-kit", "repair-events-v1.jsonl");
const EVENT_TYPES = new Set([
  "round_disposition", "root_cause_exit", "adherence_audit", "owner_extension", "repair_dispatch",
  "worker_verification", "repair_close",
]);
const AUTHORITY_KINDS = ["rounds", "scope", "close"];
const DISPOSITIONS = new Set(["REMEDIATE", "DEFER", "DECLINE", "ESCALATE", "NOTE"]);

function plain(v) { return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype; }
function text(v, max = 500) { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
function strings(v, { max = 100, itemMax = 300, paths = false } = {}) {
  if (!Array.isArray(v) || v.length === 0 || v.length > max || new Set(v).size !== v.length) return false;
  return v.every((x) => text(x, itemMax) && (!paths || (!path.isAbsolute(x) && !x.includes("\0") && !x.split(/[\\/]/).includes(".."))));
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function eventId(event) { return createHash("sha256").update(stable(event)).digest("hex"); }
function same(a, b) { return stable(a) === stable(b); }
function manifestDigest(records) {
  return createHash("sha256").update(records.map((r) => `${r.path}\0${r.oid}\n`).join("")).digest("hex");
}

function readRegularRepoFile(projectRoot, rel) {
  if (!text(rel, 500) || !strings([rel], { paths: true })) return null;
  let fd;
  try {
    const root = realpathSync(projectRoot);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(`${root}${path.sep}`) || realpathSync(abs) !== abs) return null;
    const lst = lstatSync(abs);
    if (!lst.isFile() || lst.isSymbolicLink()) return null;
    fd = openSync(abs, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const bytes = readFileSync(fd);
    return { path: rel, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  } catch { return null; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}
function validManifest(records, digest) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 500 || !/^[0-9a-f]{64}$/.test(digest || "")) return false;
  const paths = records.map((r) => r?.path);
  if (!records.every((r) => plain(r) && strings([r.path], { paths: true }) && /^[0-9a-f]{40,64}$/.test(r.oid || "")) ||
      new Set(paths).size !== paths.length || !same(paths, [...paths].sort())) return false;
  return manifestDigest(records) === digest;
}

// Git's own location overrides. `git rev-parse` honours these, so a real work tree can have its
// Git-common directory selected with NO `.git` anywhere under the project root — which is exactly
// what makes a filesystem-only "is there a subject here" test unsafe on its own.
const GIT_LOCATION_ENV = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE"];

/**
 * Could a repair ledger exist for this tree AT ALL? This is the question that separates "the
 * control has no subject" from "the control cannot read its subject", and only the first one may
 * ever relieve a write. It answers WITHOUT running git, because the case it exists for is the one
 * where git could not be run. Every uncertainty resolves to TRUE (a subject may be present), so the
 * relief is granted only when a subject is provably impossible.
 */
export function gitSubjectPresent(projectRoot, { env = process.env } = {}) {
  if (GIT_LOCATION_ENV.some((name) => typeof env?.[name] === "string" && env[name].trim() !== "")) return true;
  let dir;
  try { dir = realpathSync(projectRoot); } catch { return true; }
  for (;;) {
    // lstat, not stat: a SYMLINKED `.git` is a subject that may be present, and it is also the
    // tamper shape the ledger reader already fails closed on. Both reasons point the same way.
    try { lstatSync(path.join(dir, ".git")); return true; } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function resolveGitCommon(projectRoot, { execGit = execFileSync } = {}) {
  let raw;
  try {
    raw = String(execGit("git", ["rev-parse", "--git-common-dir"], { cwd: projectRoot, encoding: "utf8" })).trim();
  } catch { return null; }
  if (!raw) return null;
  const resolved = path.resolve(projectRoot, raw);
  try {
    const st = lstatSync(resolved);
    if (!st.isDirectory() || st.isSymbolicLink()) return null;
    return realpathSync(resolved);
  } catch { return null; }
}

export function repairLedgerPath(projectRoot, options = {}) {
  const common = resolveGitCommon(projectRoot, options);
  return common ? path.join(common, REPAIR_LEDGER_REL) : null;
}

export function readRepairEvents(file) {
  if (!file) return null;
  let raw;
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    return null;
  }
  if (raw && !raw.endsWith("\n")) return null;
  const rows = [];
  const seen = new Set();
  for (const line of raw.split("\n").filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { return null; }
    if (!plain(row) || !plain(row.event) || !EVENT_TYPES.has(row.event.type) || row.event_id !== eventId(row.event)) return null;
    if (!seen.has(row.event_id)) rows.push(row);
    seen.add(row.event_id);
  }
  return rows;
}

// A reader can arrive after another process extends the append-only file but before that one small
// write is complete. That is not durable corruption, and treating the transient missing newline as
// such makes a concurrent loser report "ledger unavailable" instead of reaching first-wins
// adjudication. Retry for a bounded 40 ms; a truly corrupt/symlinked ledger still fails closed.
const SETTLE_WORD = new Int32Array(new SharedArrayBuffer(4));
function readRepairEventsSettled(file) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = readRepairEvents(file);
    if (rows !== null) return rows;
    if (attempt < 19) Atomics.wait(SETTLE_WORD, 0, 0, 2);
  }
  return null;
}

function safeLedgerDir(file) {
  const dir = path.dirname(file);
  const parent = path.dirname(dir);
  try {
    const parentSt = lstatSync(parent);
    if (!parentSt.isDirectory() || parentSt.isSymbolicLink()) return false;
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { mode: 0o700 }); }
      catch (error) { if (error?.code !== "EEXIST") return false; }
    }
    const st = lstatSync(dir);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch { return false; }
}

function appendRepairEvent(file, event) {
  if (!file || !plain(event) || !EVENT_TYPES.has(event.type) || !safeLedgerDir(file)) return { ok: false, state: "repair-ledger-unavailable" };
  const before = readRepairEventsSettled(file);
  if (before === null) return { ok: false, state: "repair-ledger-unavailable" };
  const id = eventId(event);
  const existing = before.find((r) => r.event_id === id);
  if (existing) return { ok: true, event_id: id, idempotent: true };
  let fd;
  try {
    fd = openSync(file, "a", 0o600);
    const line = `${JSON.stringify({ event_id: id, event })}\n`;
    if (writeSync(fd, line) !== Buffer.byteLength(line)) return { ok: false, state: "repair-ledger-unavailable" };
    fsyncSync(fd);
  } catch { return { ok: false, state: "repair-ledger-unavailable" }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
  const after = readRepairEventsSettled(file);
  if (after === null || !after.some((r) => r.event_id === id)) return { ok: false, state: "repair-ledger-unavailable" };
  return { ok: true, event_id: id, idempotent: false };
}

export function fingerprintCandidate(projectRoot, candidatePaths, { execGit = execFileSync } = {}) {
  if (!strings(candidatePaths, { paths: true })) return null;
  const records = [];
  for (const rel of [...candidatePaths].sort()) {
    const abs = path.resolve(projectRoot, rel);
    if (!abs.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) return null;
    try {
      const st = lstatSync(abs);
      if (!st.isFile() || st.isSymbolicLink()) return null;
      const oid = String(execGit("git", ["hash-object", "--no-filters", "--", rel], { cwd: projectRoot, encoding: "utf8" })).trim();
      if (!/^[0-9a-f]{40,64}$/.test(oid)) return null;
      records.push({ path: rel, oid });
    } catch { return null; }
  }
  const digest = manifestDigest(records);
  return { digest, records };
}

function baseEvent(type, input, sessionId, now) {
  if (!text(input?.task_id, 120) || !text(input?.changeset_id, 120) || !text(sessionId, 200)) return null;
  return { type, task_id: input.task_id, changeset_id: input.changeset_id, recorded_at: now, session_id: sessionId };
}

function rowsFor(events, taskId) { return events.filter((r) => r.event.task_id === taskId).map((r) => ({ ...r.event, event_id: r.event_id })); }

function identityConflict(events, taskId, changesetId, eventId = null) {
  const first = events.find((row) => row.event.type === "round_disposition" && row.event.round === 1 &&
    (row.event.task_id === taskId || row.event.changeset_id === changesetId));
  if (!first) return null;
  if (first.event.task_id !== taskId || first.event.changeset_id !== changesetId ||
      (eventId !== null && first.event_id !== eventId)) return first;
  return null;
}

function transitionWinner(events, event, key) {
  return events.find((row) => row.event.type === event.type && row.event.task_id === event.task_id &&
    row.event.changeset_id === event.changeset_id && key(row.event) === key(event)) || null;
}

function finishExclusiveTransition(file, appended, event, key, equivalent, conflictState) {
  if (!appended.ok) return appended;
  const after = readRepairEventsSettled(file);
  if (after === null) return { ok: false, state: "repair-ledger-unavailable" };
  const winner = transitionWinner(after, event, key);
  if (!winner) return { ok: false, state: "repair-ledger-unavailable" };
  if (winner.event_id === appended.event_id) return appended;
  return equivalent(winner.event, event)
    ? { ok: true, event_id: winner.event_id, idempotent: true }
    : { ok: false, state: conflictState, winner_event_id: winner.event_id };
}

// The MECHANICAL triggers, and only those. A root assessment is owed when a repair introduced the
// harm, or when two consecutive NO-GOs share a finding class — conditions the events themselves
// declare. What is NOT here, deliberately: the round's POSITION. A trigger that fires because the
// absolute count reached some number is software deciding the cadence, which is the procedure's
// call and not this module's; the cadence is also circular now, so a fixed position tracks it only
// by coincidence. Removing the position leaves the two triggers that still mean what they say.
function rootTriggerRound(verdicts) {
  let triggerRound = 0;
  for (let i = 0; i < verdicts.length; i += 1) {
    const v = verdicts[i];
    if (v.verdict === "NO-GO" && (v.introduced_by_prior_repair ||
        (i > 0 && verdicts[i - 1].verdict === "NO-GO" && v.finding_class === verdicts[i - 1].finding_class))) {
      triggerRound = v.round;
    }
  }
  return triggerRound;
}

function sameRepairDispatch(a, b) {
  return a.task_id === b.task_id && a.changeset_id === b.changeset_id &&
    a.source_round === b.source_round && a.next_round === b.next_round &&
    a.candidate_sha === b.candidate_sha && same(a.finding_ids, b.finding_ids) &&
    same(a.authorized_paths, b.authorized_paths) && a.target_kind === b.target_kind &&
    a.target === b.target && a.brief_sha256 === b.brief_sha256 && a.brief_size === b.brief_size &&
    a.root_cause_exit_event_id === b.root_cause_exit_event_id &&
    a.adherence_audit_event_id === b.adherence_audit_event_id &&
    a.owner_extension_event_id === b.owner_extension_event_id &&
    a.owner_scope_event_id === b.owner_scope_event_id;
}

function addedExactPaths(previous, next) {
  const accepted = new Set(previous);
  return next.filter((candidate) => !accepted.has(candidate)).sort();
}

function normalizedExactPathSet(value) {
  if (!strings(value, { paths: true })) return null;
  if (value.some((candidate) => candidate.includes("\\") || candidate === "." ||
      path.posix.normalize(candidate) !== candidate)) return null;
  return [...value].sort();
}

function nextRoundAuthority({ verdicts, exits, extensions, dispatches }, nextRound, evidence = {},
  { requireDispatch = false } = {}) {
  const latest = verdicts.at(-1) || null;
  if (nextRound === 1) return latest ? { ok: false, state: "repair-round-nonsequential" } : { ok: true };
  if (!latest || nextRound !== latest.round + 1 || latest.verdict !== "NO-GO") {
    return { ok: false, state: "repair-history-mismatch" };
  }
  if (latest.disposition !== "REMEDIATE") return { ok: false, state: "repair-disposition-not-authorized" };
  const triggerRound = rootTriggerRound(verdicts);
  const rootExit = [...exits].reverse().find((e) => e.after_round >= triggerRound && e.after_round <= latest.round) || null;
  // A round result may expand the exact repair-path set only after the preceding accepted round's
  // Owner scope extension. Dispatch revalidates the same event carried by that accepted result;
  // otherwise a forged `new_scope:false` row could become worker authority on the following round.
  const expansion = requireDispatch ? evidence : latest;
  const preceding = requireDispatch ? latest : verdicts.at(-2) || null;
  const addedPaths = preceding && Array.isArray(expansion.authorized_paths)
    ? addedExactPaths(preceding.authorized_paths, expansion.authorized_paths)
    : [];
  const scopeExtension = addedPaths.length > 0
    ? [...extensions].reverse().find((e) => e.after_round === preceding.round && e.authority_kind === "scope") || null
    : null;
  // THE ONE ROUND-THRESHOLD GATE LEFT, and it is not a threshold: a root exit is owed once a
  // MECHANICAL trigger has fired, at whatever round that happened. The round >= 4 / >= 7 / >= 9
  // walls that used to stand here decided the cadence, which is the procedure's call — they were
  // written against a linear ladder the procedure no longer runs, so they gated a repo by a shape
  // it had stopped having. Sequence, exact-reference binding and refreeze invalidation stay: those
  // enforce that the history is intact, never how long it may get.
  if (triggerRound > 0 && (!rootExit || evidence.root_cause_exit_event_id !== rootExit.event_id)) {
    return { ok: false, state: "repair-root-cause-exit-missing" };
  }
  if (addedPaths.length > 0 && (expansion.new_scope !== true || !scopeExtension ||
      !same(addedPaths, scopeExtension.added_paths) ||
      expansion.owner_scope_event_id !== scopeExtension.event_id ||
      (!requireDispatch && evidence.owner_scope_event_id !== scopeExtension.event_id))) {
    return { ok: false, state: "repair-scope-unapproved" };
  }
  if (requireDispatch) {
    const brief = dispatches.find((d) => d.event_id === evidence.repair_dispatch_event_id &&
      d.source_round === latest.round && d.next_round === nextRound && d.target_kind === "brief" &&
      d.candidate_sha === latest.candidate_sha && same(d.finding_ids, latest.finding_ids));
    if (!brief) return { ok: false, state: "repair-brief-receipt-missing" };
    return { ok: true, rootExit, scopeExtension, brief };
  }
  return { ok: true, rootExit, scopeExtension };
}

export function deriveRepairState(events, taskId) {
  if (!Array.isArray(events) || !text(taskId, 120)) return { ok: false, state: "repair-history-invalid" };
  if (!events.every((row) => plain(row) && plain(row.event) && EVENT_TYPES.has(row.event.type) &&
      row.event_id === eventId(row.event))) return { ok: false, state: "repair-history-invalid" };
  const taskRows = rowsFor(events, taskId);
  const taskIdentity = taskRows.find((row) => row.type === "round_disposition" && row.round === 1) || null;
  if (taskIdentity) {
    const globalWinner = events.find((row) => row.event.type === "round_disposition" && row.event.round === 1 &&
      (row.event.task_id === taskId || row.event.changeset_id === taskIdentity.changeset_id));
    if (!globalWinner || globalWinner.event_id !== taskIdentity.event_id) {
      return { ok: false, state: "repair-identity-conflict" };
    }
  }
  // A concurrently appended losing Round-1 relabel remains audit evidence but cannot poison the
  // winner's derived history. Only the first global task<->changeset identity participates.
  const rows = taskRows.filter((row) => !(row.type === "round_disposition" && row.round === 1 &&
    taskIdentity && row.event_id !== taskIdentity.event_id));
  const verdicts = [];
  const exits = [];
  const audits = [];
  const extensions = [];
  const dispatches = [];
  const closes = [];
  const workerVerifications = [];
  const transitionKeys = new Set();
  let changesetId = null;
  for (const row of rows) {
    if (!text(row.changeset_id, 120)) return { ok: false, state: "repair-history-invalid" };
    if (changesetId === null) changesetId = row.changeset_id;
    if (row.changeset_id !== changesetId) return { ok: false, state: "repair-changeset-reset" };
    if (row.type === "round_disposition") {
      const noGo = row.verdict === "NO-GO";
      const findingShape = noGo
        ? strings(row.finding_ids) && text(row.finding_class, 120) && text(row.ownership_area, 180) &&
          text(row.original_trigger, 500) && strings(row.authorized_paths, { paths: true }) &&
          typeof row.introduced_by_prior_repair === "boolean" && typeof row.new_scope === "boolean" &&
          DISPOSITIONS.has(row.disposition)
        : row.verdict === "GO" && same(row.finding_ids, []) && row.finding_class === null &&
          text(row.ownership_area, 180) && row.original_trigger === null && same(row.authorized_paths, []) &&
          row.introduced_by_prior_repair === false && row.new_scope === false && row.disposition === "NOTE";
      if (!Number.isSafeInteger(row.round) || row.round !== verdicts.length + 1 ||
          !validManifest(row.candidate_manifest, row.candidate_sha) || !findingShape) {
        if (Number.isSafeInteger(row.round) && row.round >= 1 && row.round <= verdicts.length &&
            validManifest(row.candidate_manifest, row.candidate_sha) && findingShape) continue;
        return { ok: false, state: "repair-history-invalid" };
      }
      const authority = nextRoundAuthority({ verdicts, exits, audits, extensions, dispatches }, row.round, row,
        { requireDispatch: row.round > 1 });
      if (!authority.ok) return { ok: false, state: "repair-history-invalid" };
      verdicts.push(row);
    } else if (row.type === "root_cause_exit") {
      const at = verdicts.find((v) => v.round === row.after_round);
      if (!at || row.candidate_sha !== at.candidate_sha || !text(row.shared_mechanism, 1000) ||
          !text(row.symptom_explanation, 1000) || !strings(row.owner_state_yield_seams, { itemMax: 500 }) ||
          !text(row.replacement, 1200) || !strings(row.removed_workarounds, { itemMax: 500 }) ||
          !strings(row.trigger_matrix, { itemMax: 700 })) return { ok: false, state: "repair-history-invalid" };
      const key = `root:${row.after_round}`;
      if (!transitionKeys.has(key)) { transitionKeys.add(key); exits.push(row); }
    } else if (row.type === "adherence_audit") {
      const at = verdicts.find((v) => v.round === row.after_round);
      if (!at || row.candidate_sha !== at.candidate_sha || row.rule1 !== "pass" || row.gate_accounting !== "pass" ||
          row.root_cause_discipline !== "pass") return { ok: false, state: "repair-history-invalid" };
      const key = `audit:${row.after_round}`;
      if (!transitionKeys.has(key)) { transitionKeys.add(key); audits.push(row); }
    } else if (row.type === "owner_extension") {
      const at = verdicts.find((v) => v.round === row.after_round);
      const addedPaths = row.authority_kind === "scope" ? normalizedExactPathSet(row.added_paths) : null;
      if (!at || row.candidate_sha !== at.candidate_sha || !AUTHORITY_KINDS.includes(row.authority_kind) ||
          !text(row.owner_evidence, 1000) ||
          (row.authority_kind === "scope" ? !addedPaths || !same(row.added_paths, addedPaths) : row.added_paths !== undefined)) {
        return { ok: false, state: "repair-history-invalid" };
      }
      const key = `extension:${row.after_round}:${row.authority_kind}`;
      if (!transitionKeys.has(key)) { transitionKeys.add(key); extensions.push(row); }
    } else if (row.type === "repair_dispatch") {
      const at = verdicts.find((v) => v.round === row.source_round);
      if (!at || row.next_round !== row.source_round + 1 || row.candidate_sha !== at.candidate_sha ||
          !same(row.finding_ids, at.finding_ids) || !same(row.authorized_paths, at.authorized_paths) ||
          row.target_kind !== "brief" || !strings([row.target], { paths: true, itemMax: 500 }) ||
          !/^[0-9a-f]{64}$/.test(row.brief_sha256 || "") ||
          !Number.isSafeInteger(row.brief_size) || row.brief_size < 0) return { ok: false, state: "repair-history-invalid" };
      const authority = nextRoundAuthority({ verdicts, exits, extensions, dispatches }, row.next_round, row);
      if (!authority.ok) return { ok: false, state: "repair-history-invalid" };
      if (!dispatches.some((existing) => sameRepairDispatch(existing, row))) dispatches.push(row);
    } else if (row.type === "repair_close") {
      // A close names the round it ends and the Owner authorization that permits it. Both are exact
      // references, which is the only kind of authority this module has ever accepted.
      const at = verdicts.find((v) => v.round === row.after_round);
      const authorization = extensions.find((e) => e.event_id === row.owner_close_event_id &&
        e.authority_kind === "close" && e.after_round === row.after_round);
      if (!at || row.candidate_sha !== at.candidate_sha || !text(row.reason, 1000) || !authorization ||
          authorization.candidate_sha !== at.candidate_sha) return { ok: false, state: "repair-history-invalid" };
      const key = `close:${row.after_round}`;
      if (!transitionKeys.has(key)) { transitionKeys.add(key); closes.push(row); }
    } else if (row.type === "worker_verification") {
      const receipt = dispatches.find((d) => d.event_id === row.repair_dispatch_event_id);
      if (!receipt || row.candidate_sha !== receipt.candidate_sha ||
          !same(row.authorized_paths, receipt.authorized_paths) || row.brief_sha256 !== receipt.brief_sha256 ||
          row.brief_path !== receipt.target || !text(row.worker_session_id, 200)) {
        return { ok: false, state: "repair-history-invalid" };
      }
      const key = `${row.repair_dispatch_event_id}:${row.worker_session_id}`;
      if (!transitionKeys.has(`worker:${key}`)) {
        transitionKeys.add(`worker:${key}`);
        workerVerifications.push(row);
      }
    }
  }
  const firstRound = verdicts[0];
  if (firstRound && identityConflict(events, taskId, firstRound.changeset_id, firstRound.event_id)) {
    return { ok: false, state: "repair-identity-conflict" };
  }
  const latest = verdicts.at(-1) || null;
  const triggerRound = rootTriggerRound(verdicts);
  const rootExit = [...exits].reverse().find((e) => e.after_round >= triggerRound && e.after_round <= (latest?.round || 0)) || null;
  // The audit is EVIDENCE the procedure chose to record, at whatever round its own cadence put it.
  // It used to be looked up at `after_round === 6` because it unlocked round 7 — it no longer
  // unlocks anything, so pinning the lookup to a round would only hide audits taken elsewhere from
  // anyone reading this state.
  const audit = audits.at(-1) || null;
  const roundExtension = [...extensions].reverse().find((e) => e.after_round === latest?.round && e.authority_kind === "rounds") || null;
  const scopeExtension = [...extensions].reverse().find((e) => e.after_round === latest?.round && e.authority_kind === "scope") || null;
  // A program is ACTIVE — and so owns writes — only while a repair is actually authorized: the
  // latest verdict is NO-GO, its disposition is REMEDIATE, and no Owner-authorized close has ended
  // it. A NO-GO dispositioned DEFER/DECLINE/ESCALATE/NOTE authorizes no repair, mints no brief, and
  // binds no worker, so there is nothing for it to hold open.
  const close = [...closes].reverse().find((e) => e.after_round === latest?.round) || null;
  const active = Boolean(latest && latest.verdict === "NO-GO" && latest.disposition === "REMEDIATE" && !close);
  return { ok: true, task_id: taskId, changeset_id: changesetId, verdicts, latest, trigger_round: triggerRound,
    root_cause_required: triggerRound > 0 && !rootExit, root_exit: rootExit, audit, round_extension: roundExtension,
    scope_extension: scopeExtension, dispatches, worker_verifications: workerVerifications,
    close, active, exits, audits, extensions, closes };
}

function normalizedRoundFields(input) {
  if (!Number.isSafeInteger(input?.round) || input.round < 1) return null;
  if (input.verdict === "GO") {
    if ((input.finding_ids !== undefined && !same(input.finding_ids, [])) ||
        (input.introduced_by_prior_repair !== undefined && input.introduced_by_prior_repair !== false) ||
        (input.new_scope !== undefined && input.new_scope !== false)) return null;
    return { finding_ids: [], finding_class: null, ownership_area: text(input.ownership_area, 180) ? input.ownership_area : "gate",
      original_trigger: null, authorized_paths: [], introduced_by_prior_repair: false, new_scope: false, disposition: "NOTE" };
  }
  if (input.verdict !== "NO-GO" || !DISPOSITIONS.has(input.disposition) || !strings(input.finding_ids) ||
      !text(input.finding_class, 120) || !text(input.ownership_area, 180) || !text(input.original_trigger, 500) ||
      !strings(input.authorized_paths, { paths: true }) || typeof input.introduced_by_prior_repair !== "boolean" ||
      typeof input.new_scope !== "boolean") return null;
  return { finding_ids: [...input.finding_ids], finding_class: input.finding_class, ownership_area: input.ownership_area,
    original_trigger: input.original_trigger, authorized_paths: [...input.authorized_paths],
    introduced_by_prior_repair: input.introduced_by_prior_repair, new_scope: input.new_scope, disposition: input.disposition };
}

export function recordRoundDisposition(input, { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const base = baseEvent("round_disposition", input, sessionId, now);
  const file = repairLedgerPath(projectRoot, { execGit });
  const events = readRepairEventsSettled(file);
  const fields = normalizedRoundFields(input);
  if (!base || events === null || !fields) return { ok: false, state: "repair-round-malformed" };
  if (identityConflict(events, input.task_id, input.changeset_id)) {
    return { ok: false, state: "repair-identity-conflict" };
  }
  const current = deriveRepairState(events, input.task_id);
  if (!current.ok) return current;
  const existingRound = rowsFor(events, input.task_id).find((row) => row.type === "round_disposition" && row.round === input.round);
  if (existingRound) {
    if (input.round > 1) {
      const verified = verifyRepairBriefReceipt({
        task_id: input.task_id, repair_dispatch_event_id: input.repair_dispatch_event_id,
      }, { projectRoot, execGit });
      if (!verified.ok) return verified;
    }
    const candidate = fingerprintCandidate(projectRoot, input.candidate_paths, { execGit });
    if (!candidate) return { ok: false, state: "repair-candidate-unverified" };
    const equivalent = existingRound.changeset_id === input.changeset_id && existingRound.candidate_sha === candidate.digest &&
      existingRound.verdict === input.verdict && existingRound.disposition === fields.disposition &&
      same(existingRound.finding_ids, fields.finding_ids) && existingRound.finding_class === fields.finding_class &&
      existingRound.ownership_area === fields.ownership_area && existingRound.original_trigger === fields.original_trigger &&
      same(existingRound.authorized_paths, fields.authorized_paths) &&
      existingRound.introduced_by_prior_repair === fields.introduced_by_prior_repair && existingRound.new_scope === fields.new_scope &&
      existingRound.repair_dispatch_event_id === (input.round === 1 ? null : input.repair_dispatch_event_id) &&
      existingRound.root_cause_exit_event_id === (input.root_cause_exit_event_id ?? null) &&
      existingRound.adherence_audit_event_id === (input.adherence_audit_event_id ?? null) &&
      existingRound.owner_extension_event_id === (input.owner_extension_event_id ?? null) &&
      existingRound.owner_scope_event_id === (input.owner_scope_event_id ?? null);
    return equivalent ? { ok: true, event_id: existingRound.event_id, idempotent: true }
      : { ok: false, state: "repair-round-conflict" };
  }
  if (current.ok && current.changeset_id && current.changeset_id !== input.changeset_id) return { ok: false, state: "repair-changeset-reset" };
  const expected = current.ok ? current.verdicts.length + 1 : 1;
  if (input.round !== expected) return { ok: false, state: "repair-round-nonsequential", expected };
  if (current.ok && current.latest?.verdict === "GO") return { ok: false, state: "repair-changeset-closed" };
  const authority = nextRoundAuthority(current, input.round, input, { requireDispatch: input.round > 1 });
  if (!authority.ok) return authority;
  if (input.round > 1) {
    const verified = verifyRepairBriefReceipt({
      task_id: input.task_id, repair_dispatch_event_id: input.repair_dispatch_event_id,
    }, { projectRoot, execGit });
    if (!verified.ok) return verified;
  }
  const candidate = fingerprintCandidate(projectRoot, input.candidate_paths, { execGit });
  if (!candidate) return { ok: false, state: "repair-candidate-unverified" };
  const event = { ...base, round: input.round, candidate_sha: candidate.digest, candidate_manifest: candidate.records,
    verdict: input.verdict, ...fields,
    repair_dispatch_event_id: input.round === 1 ? null : input.repair_dispatch_event_id,
    root_cause_exit_event_id: input.root_cause_exit_event_id ?? null,
    adherence_audit_event_id: input.adherence_audit_event_id ?? null,
    owner_extension_event_id: input.owner_extension_event_id ?? null,
    owner_scope_event_id: input.owner_scope_event_id ?? null };
  const appended = appendRepairEvent(file, event);
  if (!appended.ok) return appended;
  const after = readRepairEventsSettled(file);
  if (after === null) return { ok: false, state: "repair-ledger-unavailable" };
  const winner = input.round === 1
    ? after.find((row) => row.event.type === "round_disposition" && row.event.round === 1 &&
      (row.event.task_id === input.task_id || row.event.changeset_id === input.changeset_id))
    : rowsFor(after, input.task_id).find((row) => row.type === "round_disposition" && row.round === input.round);
  if (!winner) return { ok: false, state: "repair-ledger-unavailable" };
  const winnerEvent = winner.event ?? winner;
  if (winner.event_id === appended.event_id) return appended;
  const equivalent = winnerEvent.task_id === input.task_id && winnerEvent.changeset_id === input.changeset_id &&
    winnerEvent.candidate_sha === candidate.digest && winnerEvent.verdict === input.verdict &&
    winnerEvent.disposition === fields.disposition && same(winnerEvent.finding_ids, fields.finding_ids) &&
    winnerEvent.finding_class === fields.finding_class && winnerEvent.ownership_area === fields.ownership_area &&
    winnerEvent.original_trigger === fields.original_trigger && same(winnerEvent.authorized_paths, fields.authorized_paths) &&
    winnerEvent.introduced_by_prior_repair === fields.introduced_by_prior_repair && winnerEvent.new_scope === fields.new_scope &&
    winnerEvent.repair_dispatch_event_id === (input.round === 1 ? null : input.repair_dispatch_event_id) &&
    winnerEvent.root_cause_exit_event_id === (input.root_cause_exit_event_id ?? null) &&
    winnerEvent.adherence_audit_event_id === (input.adherence_audit_event_id ?? null) &&
    winnerEvent.owner_extension_event_id === (input.owner_extension_event_id ?? null) &&
    winnerEvent.owner_scope_event_id === (input.owner_scope_event_id ?? null);
  return equivalent ? { ok: true, event_id: winner.event_id, idempotent: true }
    : { ok: false, state: "repair-round-conflict" };
}

export function recordRootCauseExit(input, { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const base = baseEvent("root_cause_exit", input, sessionId, now);
  const file = repairLedgerPath(projectRoot, { execGit });
  const events = readRepairEventsSettled(file);
  const state = events === null ? null : deriveRepairState(events, input?.task_id);
  if (!base || !state?.ok || !state.latest || input.after_round !== state.latest.round ||
      !text(input.shared_mechanism, 1000) || !text(input.symptom_explanation, 1000) ||
      !strings(input.owner_state_yield_seams, { itemMax: 500 }) || !text(input.replacement, 1200) ||
      !strings(input.removed_workarounds, { itemMax: 500 }) || !strings(input.trigger_matrix, { itemMax: 700 })) {
    return { ok: false, state: "repair-root-exit-invalid" };
  }
  const event = { ...base, after_round: input.after_round, candidate_sha: state.latest.candidate_sha,
    shared_mechanism: input.shared_mechanism, symptom_explanation: input.symptom_explanation,
    owner_state_yield_seams: [...input.owner_state_yield_seams], replacement: input.replacement,
    removed_workarounds: [...input.removed_workarounds], trigger_matrix: [...input.trigger_matrix] };
  const key = (e) => String(e.after_round);
  const equivalent = (a, b) => a.candidate_sha === b.candidate_sha && a.shared_mechanism === b.shared_mechanism &&
    a.symptom_explanation === b.symptom_explanation && same(a.owner_state_yield_seams, b.owner_state_yield_seams) &&
    a.replacement === b.replacement && same(a.removed_workarounds, b.removed_workarounds) &&
    same(a.trigger_matrix, b.trigger_matrix);
  const prior = transitionWinner(events, event, key);
  if (prior) return equivalent(prior.event, event)
    ? { ok: true, event_id: prior.event_id, idempotent: true }
    : { ok: false, state: "repair-root-exit-conflict", winner_event_id: prior.event_id };
  if (!state.root_cause_required) return { ok: false, state: "repair-root-exit-invalid" };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event, key, equivalent, "repair-root-exit-conflict");
}

export function recordAdherenceAudit(input, { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const base = baseEvent("adherence_audit", input, sessionId, now);
  const file = repairLedgerPath(projectRoot, { execGit });
  const events = readRepairEventsSettled(file);
  const state = events === null ? null : deriveRepairState(events, input?.task_id);
  if (!base || !state?.ok || !state.latest || input.after_round !== state.latest.round ||
      input.rule1 !== "pass" || input.gate_accounting !== "pass" || input.root_cause_discipline !== "pass") {
    return { ok: false, state: "repair-audit-invalid" };
  }
  const event = { ...base, after_round: input.after_round, candidate_sha: state.latest.candidate_sha,
    rule1: "pass", gate_accounting: "pass", root_cause_discipline: "pass" };
  const key = (e) => String(e.after_round);
  const equivalent = (a, b) => a.candidate_sha === b.candidate_sha && a.rule1 === b.rule1 &&
    a.gate_accounting === b.gate_accounting && a.root_cause_discipline === b.root_cause_discipline;
  const prior = transitionWinner(events, event, key);
  if (prior) return equivalent(prior.event, event)
    ? { ok: true, event_id: prior.event_id, idempotent: true }
    : { ok: false, state: "repair-audit-conflict", winner_event_id: prior.event_id };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event, key, equivalent, "repair-audit-conflict");
}

export function recordOwnerExtension(input, { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const base = baseEvent("owner_extension", input, sessionId, now);
  const file = repairLedgerPath(projectRoot, { execGit });
  const events = readRepairEventsSettled(file);
  const state = events === null ? null : deriveRepairState(events, input?.task_id);
  const addedPaths = input?.authority_kind === "scope" ? normalizedExactPathSet(input.added_paths) : null;
  if (!base || !state?.ok || !state.latest || input.after_round !== state.latest.round ||
      !AUTHORITY_KINDS.includes(input.authority_kind) || !text(input.owner_evidence, 1000) ||
      (input.authority_kind === "scope" ? !addedPaths : input.added_paths !== undefined)) {
    return { ok: false, state: "repair-owner-extension-invalid" };
  }
  const event = { ...base, after_round: input.after_round, candidate_sha: state.latest.candidate_sha,
    authority_kind: input.authority_kind, owner_evidence: input.owner_evidence,
    ...(addedPaths ? { added_paths: addedPaths } : {}) };
  const key = (e) => `${e.after_round}:${e.authority_kind}`;
  const equivalent = (a, b) => a.candidate_sha === b.candidate_sha && a.owner_evidence === b.owner_evidence &&
    same(a.added_paths, b.added_paths);
  const prior = transitionWinner(events, event, key);
  if (prior) return equivalent(prior.event, event)
    ? { ok: true, event_id: prior.event_id, idempotent: true }
    : { ok: false, state: "repair-owner-extension-conflict", winner_event_id: prior.event_id };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event, key, equivalent, "repair-owner-extension-conflict");
}

/**
 * End an authorized repair program IN BAND. Without this the only exit from an abandoned REMEDIATE
 * program was deleting the ledger — destroying every round's history to unblock one write.
 *
 * It takes an Owner authorization (`owner_extension` with `authority_kind: "close"`) and names its
 * exact event ID, because a close is operational PERMISSION, not evidence: releasing a program also
 * releases its global path ownership, and the party most motivated to release it is the worker the
 * program constrains. Nothing here authenticates anyone — this is procedural attribution, and the
 * value is that the release is attributable to the Owner rather than to the constrained party.
 */
export function recordRepairClose(input, { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const base = baseEvent("repair_close", input, sessionId, now);
  const file = repairLedgerPath(projectRoot, { execGit });
  const events = readRepairEventsSettled(file);
  const state = events === null ? null : deriveRepairState(events, input?.task_id);
  if (!base || !state?.ok || !state.latest || input.after_round !== state.latest.round ||
      !text(input.reason, 1000) || !/^[0-9a-f]{64}$/.test(input.owner_close_event_id || "")) {
    return { ok: false, state: "repair-close-invalid" };
  }
  const authorization = state.extensions.find((e) => e.event_id === input.owner_close_event_id &&
    e.authority_kind === "close" && e.after_round === state.latest.round &&
    e.candidate_sha === state.latest.candidate_sha);
  if (!authorization) return { ok: false, state: "repair-close-unauthorized" };
  const event = { ...base, after_round: input.after_round, candidate_sha: state.latest.candidate_sha,
    reason: input.reason, owner_close_event_id: input.owner_close_event_id };
  const key = (e) => String(e.after_round);
  const equivalent = (a, b) => a.candidate_sha === b.candidate_sha && a.reason === b.reason &&
    a.owner_close_event_id === b.owner_close_event_id;
  const prior = transitionWinner(events, event, key);
  if (prior) return equivalent(prior.event, event)
    ? { ok: true, event_id: prior.event_id, idempotent: true }
    : { ok: false, state: "repair-close-conflict", winner_event_id: prior.event_id };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event, key, equivalent, "repair-close-conflict");
}

export function validateRepairDispatch(declaration, { events, taskId, targetKind, target }) {
  if (!plain(declaration) || declaration.task_id !== taskId || !text(declaration.changeset_id, 120) ||
      !Number.isSafeInteger(declaration.round) || declaration.round < 1 || !/^[0-9a-f]{64}$/.test(declaration.candidate_sha || "") ||
      !strings(declaration.finding_ids) || !text(declaration.finding_class, 120) || !text(declaration.ownership_area, 180) ||
      !text(declaration.original_trigger, 500) || !strings(declaration.authorized_paths, { paths: true }) ||
      typeof declaration.introduced_by_prior_repair !== "boolean" || typeof declaration.new_scope !== "boolean") {
    return { ok: false, state: "repair-declaration-malformed" };
  }
  const state = deriveRepairState(events, taskId);
  if (!state.ok || !state.latest || state.changeset_id !== declaration.changeset_id || state.latest.verdict !== "NO-GO") {
    return { ok: false, state: "repair-history-mismatch" };
  }
  const v = state.latest;
  if (targetKind !== "brief") return { ok: false, state: "repair-brief-required" };
  if (v.disposition !== "REMEDIATE") return { ok: false, state: "repair-disposition-not-authorized" };
  if (declaration.round !== v.round + 1 || declaration.candidate_sha !== v.candidate_sha ||
      !same(declaration.finding_ids, v.finding_ids) || declaration.finding_class !== v.finding_class ||
      declaration.ownership_area !== v.ownership_area || declaration.original_trigger !== v.original_trigger ||
      !same(declaration.authorized_paths, v.authorized_paths) || declaration.introduced_by_prior_repair !== v.introduced_by_prior_repair ||
      declaration.new_scope !== v.new_scope) return { ok: false, state: "repair-history-mismatch" };
  const authority = nextRoundAuthority(state, declaration.round, declaration);
  if (!authority.ok) return authority;
  return { ok: true, state, repair: { ...declaration }, target_kind: targetKind, target };
}

export function confirmRepairBrief({ declaration, brief_path: briefPath } = {},
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const file = repairLedgerPath(projectRoot, { execGit });
  const current = readRepairEventsSettled(file);
  if (current === null) return { ok: false, state: "repair-ledger-unavailable" };
  const validated = validateRepairDispatch(declaration, {
    events: current, taskId: declaration?.task_id, targetKind: "brief", target: briefPath,
  });
  if (!validated.ok) return validated;
  const brief = readRegularRepoFile(projectRoot, briefPath);
  if (!brief) return { ok: false, state: "repair-brief-unconfirmed" };
  const r = validated.repair;
  const logical = { type: "repair_dispatch", task_id: r.task_id, changeset_id: r.changeset_id,
    source_round: r.round - 1, next_round: r.round, candidate_sha: r.candidate_sha,
    finding_ids: [...r.finding_ids], authorized_paths: [...r.authorized_paths],
    target_kind: "brief", target: brief.path, brief_sha256: brief.sha256, brief_size: brief.size,
    ...(r.root_cause_exit_event_id ? { root_cause_exit_event_id: r.root_cause_exit_event_id } : {}),
    ...(r.adherence_audit_event_id ? { adherence_audit_event_id: r.adherence_audit_event_id } : {}),
    ...(r.owner_extension_event_id ? { owner_extension_event_id: r.owner_extension_event_id } : {}),
    ...(r.owner_scope_event_id ? { owner_scope_event_id: r.owner_scope_event_id } : {}) };
  const prior = current.find((row) => row.event.type === "repair_dispatch" &&
    sameRepairDispatch(row.event, logical));
  if (prior) return { ok: true, event_id: prior.event_id, idempotent: true };
  const appended = appendRepairEvent(file, { ...logical, recorded_at: now, session_id: sessionId });
  if (!appended.ok) return appended;
  const after = readRepairEventsSettled(file);
  if (after === null) return { ok: false, state: "repair-ledger-unavailable" };
  const winner = after.find((row) => row.event.type === "repair_dispatch" &&
    sameRepairDispatch(row.event, logical));
  if (!winner) return { ok: false, state: "repair-ledger-unavailable" };
  return { ok: true, event_id: winner.event_id, idempotent: winner.event_id !== appended.event_id };
}

export function verifyRepairBriefReceipt({ task_id: taskId, repair_dispatch_event_id: eventId } = {},
  { projectRoot, execGit } = {}) {
  if (!text(taskId, 120) || !/^[0-9a-f]{64}$/.test(eventId || "")) {
    return { ok: false, state: "repair-brief-receipt-missing" };
  }
  const loaded = loadRepairEventsForProject(projectRoot, { execGit });
  if (!loaded.ok) return loaded;
  const state = deriveRepairState(loaded.events, taskId);
  if (!state.ok) return state;
  const receipt = state.dispatches.find((row) => row.event_id === eventId);
  if (!receipt) return { ok: false, state: "repair-brief-receipt-missing" };
  const brief = readRegularRepoFile(projectRoot, receipt.target);
  if (!brief || brief.sha256 !== receipt.brief_sha256 || brief.size !== receipt.brief_size) {
    return { ok: false, state: "repair-brief-changed" };
  }
  return { ok: true, state: "repair-brief-confirmed", receipt, brief };
}

export function recordWorkerVerification({ task_id: taskId, repair_dispatch_event_id: eventId } = {},
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-worker-session-missing" };
  const verified = verifyRepairBriefReceipt({ task_id: taskId, repair_dispatch_event_id: eventId },
    { projectRoot, execGit });
  if (!verified.ok) return verified;
  const file = repairLedgerPath(projectRoot, { execGit });
  const current = readRepairEventsSettled(file);
  if (current === null) return { ok: false, state: "repair-ledger-unavailable" };
  const state = deriveRepairState(current, taskId);
  const receipt = verified.receipt;
  if (!state.ok || !state.latest || state.latest.verdict !== "NO-GO" ||
      receipt.source_round !== state.latest.round || receipt.next_round !== state.latest.round + 1 ||
      receipt.candidate_sha !== state.latest.candidate_sha) {
    return { ok: false, state: "repair-worker-candidate-stale" };
  }
  const event = { type: "worker_verification", task_id: taskId, changeset_id: state.changeset_id,
    recorded_at: now, session_id: sessionId, worker_session_id: sessionId,
    repair_dispatch_event_id: eventId, candidate_sha: receipt.candidate_sha,
    authorized_paths: [...receipt.authorized_paths], brief_path: receipt.target,
    brief_sha256: receipt.brief_sha256 };
  const prior = current.find((row) => row.event.type === "worker_verification" &&
    row.event.task_id === taskId && row.event.repair_dispatch_event_id === eventId &&
    row.event.worker_session_id === sessionId);
  if (prior) return { ok: true, event_id: prior.event_id, idempotent: true };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event,
    (e) => `${e.repair_dispatch_event_id}:${e.worker_session_id}`,
    (a, b) => a.candidate_sha === b.candidate_sha && same(a.authorized_paths, b.authorized_paths) &&
      a.brief_path === b.brief_path && a.brief_sha256 === b.brief_sha256,
    "repair-worker-verification-conflict");
}

/**
 * Return every accepted, still-NO-GO repair program whose latest exact authorized-path set owns
 * `target`. Round-1 losers remain audit evidence but never become owners. This is deliberately
 * global: a task-lane relabel cannot make another active program's path look unrelated.
 */
export function activeRepairPathOwners(events, target) {
  if (!Array.isArray(events) || !strings([target], { paths: true, itemMax: 500 })) {
    return { ok: false, state: "repair-history-invalid", owners: [] };
  }
  const identities = events.filter((row) => row?.event?.type === "round_disposition" && row.event.round === 1);
  const accepted = identities.filter((row) => identities.find((candidate) =>
    candidate.event.task_id === row.event.task_id || candidate.event.changeset_id === row.event.changeset_id) === row);
  const owners = [];
  for (const identity of accepted) {
    const state = deriveRepairState(events, identity.event.task_id);
    if (!state.ok) return { ok: false, state: state.state, owners: [] };
    if (state.active && state.latest.authorized_paths.includes(target)) owners.push(state);
  }
  return { ok: true, state: "repair-path-owners-derived", owners };
}

export function verifyRepairWorkerWrite({ task_id: taskId, session_id: sessionId, target } = {},
  { projectRoot, execGit } = {}) {
  if (!strings([target], { paths: true, itemMax: 500 })) {
    return { ok: false, state: "repair-worker-path-unauthorized" };
  }
  const loaded = loadRepairEventsForProject(projectRoot, { execGit });
  if (!loaded.ok) return loaded;
  const ownership = activeRepairPathOwners(loaded.events, target);
  if (!ownership.ok) return ownership;
  if (ownership.owners.length > 1) {
    return { ok: false, state: "repair-worker-path-owner-conflict",
      owner_task_ids: ownership.owners.map((owner) => owner.task_id) };
  }
  const owner = ownership.owners[0] || null;
  if (owner && owner.task_id !== taskId) {
    return { ok: false, state: "repair-task-relabel-path-owned", owner_task_id: owner.task_id };
  }
  if (!text(taskId, 120)) return { ok: true, state: "not-repair-write" };
  const state = owner || deriveRepairState(loaded.events, taskId);
  if (!state.ok) return state;
  if (!state.active) return { ok: true, state: "not-repair-write" };
  if (!text(sessionId, 200)) return { ok: false, state: "repair-worker-session-missing" };
  const admissions = state.worker_verifications.filter((row) => row.worker_session_id === sessionId);
  const admission = [...admissions].reverse().find((row) => row.candidate_sha === state.latest.candidate_sha &&
    state.dispatches.some((receipt) => receipt.event_id === row.repair_dispatch_event_id &&
      receipt.source_round === state.latest.round && receipt.next_round === state.latest.round + 1));
  if (!admission) {
    return { ok: false, state: admissions.length ? "repair-worker-candidate-stale" : "repair-worker-verification-missing" };
  }
  if (!admission.authorized_paths.includes(target)) {
    return { ok: false, state: "repair-worker-path-unauthorized", authorized_paths: admission.authorized_paths };
  }
  const verified = verifyRepairBriefReceipt({
    task_id: taskId, repair_dispatch_event_id: admission.repair_dispatch_event_id,
  }, { projectRoot, execGit });
  if (!verified.ok) return verified;
  return { ok: true, state: "repair-worker-write-authorized", admission, receipt: verified.receipt };
}

export function loadRepairEventsForProject(projectRoot, options = {}) {
  const file = repairLedgerPath(projectRoot, options);
  const events = file === null ? null : readRepairEventsSettled(file);
  if (events !== null) return { ok: true, file, events };
  // TWO different failures wearing one name until now. A ledger that exists and cannot be trusted
  // is a control that cannot READ ITS SUBJECT — deny. A tree that cannot hold a ledger at all is a
  // control with NO SUBJECT: no repair program can exist there, so there is nothing to enforce and
  // denying every write is a pure false positive. Both still fail; only the second may be relieved,
  // and only by a consumer that says out loud that it is blind. `gitSubjectPresent` resolves every
  // uncertainty toward "a subject may be present", so the relief needs a provable absence.
  const subject = file !== null || gitSubjectPresent(projectRoot, options);
  return { ok: false, state: subject ? "repair-ledger-unavailable" : "repair-ledger-no-subject", events: null };
}
