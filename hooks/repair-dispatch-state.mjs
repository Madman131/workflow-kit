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
const REPLAY_ONLY_EVENT_TYPES = new Set(["panel_close", "evidence_rerun", "child_continuation"]);
const AGGREGATE_EVENT_TYPE = "aggregate_v2";
const AGGREGATE_KINDS = new Set([
  "panel_open", "panel_close", "disposition", "root_exit", "dispatch", "worker",
  "worker_handoff", "child_continuation", "legacy_handoff", "close",
]);
const READ_EVENT_TYPES = new Set([...EVENT_TYPES, ...REPLAY_ONLY_EVENT_TYPES, AGGREGATE_EVENT_TYPE]);
const AUTHORITY_KINDS = ["rounds", "scope", "close"];
const DISPOSITIONS = new Set(["REMEDIATE", "DEFER", "DECLINE", "ESCALATE", "NOTE"]);
const GIT_SHA = /^[0-9a-f]{40}$/;
const ID64 = /^[0-9a-f]{64}$/;
const TIER_RANK = { T2: 2, T3: 3 };

// EVERY event is normalized through a JSON round-trip BEFORE it is hashed or written. `stable()`
// renders an explicitly-undefined key into the HASH while `JSON.stringify` omits it from the
// BYTES — so without this, the write path itself could mint a row the reader permanently rejects,
// bricking the whole ledger from one idiomatic caller input. A value JSON cannot carry (a cycle,
// a BigInt) returns null and the recorder refuses with a typed -malformed state instead of
// throwing.
function jsonNormalize(event) {
  try { return JSON.parse(JSON.stringify(event)); } catch { return null; }
}

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
function validAggregateEnvelope(event) {
  return plain(event) && event.type === AGGREGATE_EVENT_TYPE && AGGREGATE_KINDS.has(event.kind) &&
    text(event.task_id, 120) && text(event.changeset_id, 120) && text(event.recorded_at, 100) &&
    text(event.session_id, 200) && validAggregateKindShape(event);
}

const nullableId = (value) => value === null || ID64.test(value || "");
function validAggregateKindShape(event) {
  switch (event.kind) {
    case "panel_open":
      { const paths = sortedPaths(event.changed_paths); return Number.isSafeInteger(event.round) &&
        event.round >= 1 && event.round <= 4 && ["repair_round", "final_bookend"].includes(event.phase) &&
        ["T2", "T3"].includes(event.tier) &&
        GIT_SHA.test(event.frozen_commit || "") && GIT_SHA.test(event.frozen_tree || "") &&
        validBaseRef(event.base_ref) && GIT_SHA.test(event.base_commit || "") && paths &&
        same(paths, event.changed_paths) && expectedPanelShape(event.tier, event.expected_seats, paths) &&
        nullableId(event.incoming_dispatch_event_id) && nullableId(event.incoming_worker_event_id) &&
        nullableId(event.child_continuation_event_id) && nullableId(event.legacy_handoff_event_id) &&
        !(event.child_continuation_event_id && event.legacy_handoff_event_id); }
    case "panel_close":
      return ID64.test(event.panel_open_event_id || "") && receivedSeatsShape(event.received_seats);
    case "disposition":
      // Every field is PROVEN before it is dereferenced — `authorized_paths.length` on an unproven
      // array was a reachable TypeError that escaped the ledger reader and crashed its caller
      // (a hash-valid malformed row must fail the ledger CLOSED with a typed result, never throw).
      return ID64.test(event.panel_close_event_id || "") && pmFindingsShape(event.pm_findings) &&
        findingPartitionShape(event.finding_dispositions) && ["CONTINUE", "GO", "STOP"].includes(event.terminal_state) &&
        (event.remediation_kind === null || text(event.remediation_kind, 60)) &&
        Array.isArray(event.authorized_paths) &&
        (event.authorized_paths.length === 0 || Boolean(sortedPaths(event.authorized_paths)));
    case "root_exit":
      return ID64.test(event.disposition_event_id || "") && text(event.shared_mechanism, 1000) &&
        text(event.symptom_explanation, 1000) && strings(event.owner_state_yield_seams, { itemMax: 500 }) &&
        text(event.replacement, 1200) && strings(event.removed_workarounds, { itemMax: 500 }) &&
        strings(event.trigger_matrix, { itemMax: 700 });
    case "dispatch":
      return ID64.test(event.disposition_event_id || "") && ID64.test(event.panel_close_event_id || "") &&
        Number.isSafeInteger(event.source_round) && Number.isSafeInteger(event.next_round) &&
        Array.isArray(event.authorized_paths) &&
        (event.authorized_paths.length === 0 || Boolean(sortedPaths(event.authorized_paths))) &&
        nullableId(event.root_exit_event_id) &&
        event.target_kind === "brief" && strings([event.target], { paths: true, itemMax: 500 }) &&
        ID64.test(event.brief_sha256 || "") && Number.isSafeInteger(event.brief_size) && event.brief_size >= 0;
    case "worker":
      return ID64.test(event.dispatch_event_id || "") && text(event.worker_session_id, 200) &&
        Boolean(sortedPaths(event.authorized_paths)) && strings([event.brief_path], { paths: true, itemMax: 500 }) &&
        ID64.test(event.brief_sha256 || "");
    case "worker_handoff":
      return ID64.test(event.dispatch_event_id || "") && ID64.test(event.prior_worker_event_id || "") &&
        text(event.new_worker_session_id, 200) && text(event.owner_evidence, 1000);
    case "child_continuation":
      // trigger_ids may be EMPTY: a GO-lineage follow-on with no routed adjacents carries none.
      // The anchor is the parent's latest disposition — or, for a no-disposition CLOSED parent
      // (a collected panel abandoned before adjudication), its winning panel_open, mirroring
      // the close event's own anchor rule below.
      return ((ID64.test(event.parent_disposition_event_id || "") && event.parent_panel_open_event_id === undefined) ||
        (event.parent_disposition_event_id === null && ID64.test(event.parent_panel_open_event_id || ""))) &&
        GIT_SHA.test(event.parent_frozen_commit || "") && GIT_SHA.test(event.parent_frozen_tree || "") &&
        Array.isArray(event.trigger_ids) &&
        // 2600 = the exact-carry bound the grammar itself admits: a disposition's id universe
        // is seat ids (12 x 100) PLUS PM findings (100) = 1300, and the CLOSED floor is additive
        // across two of those universes (accepted ∪ a later round's undisposed ground). The sole
        // exit must never be SHAPE-impossible for a mandatory carry — a 1300-id STOP was executed
        // against the prior 1200 cap.
        event.trigger_ids.length <= 2600 && new Set(event.trigger_ids).size === event.trigger_ids.length &&
        event.trigger_ids.every((id) => text(id, 300)) &&
        ["split", "new_changeset", "material_scope"].includes(event.continuation_kind) &&
        Array.isArray(event.children) && event.children.length > 0 && event.children.every(aggregateChildShape) &&
        text(event.owner_evidence, 1000);
    case "legacy_handoff":
      return text(event.parent_task_id, 120) && text(event.parent_changeset_id, 120) &&
        ID64.test(event.parent_disposition_event_id || "") && Number.isSafeInteger(event.parent_round) &&
        ID64.test(event.parent_candidate_sha || "") && Boolean(sortedPaths(event.authorized_paths)) &&
        aggregateChildShape(event.child) && text(event.owner_evidence, 1000);
    case "close":
      return ((ID64.test(event.disposition_event_id || "") && event.panel_open_event_id === undefined) ||
        (event.disposition_event_id === null && ID64.test(event.panel_open_event_id || ""))) &&
        text(event.reason, 1000) && text(event.owner_evidence, 1000);
    default:
      return false;
  }
}

// Git's own location overrides. `git rev-parse` honours these, so a real work tree can have its
// Git-common directory selected with NO `.git` anywhere under the project root — which is exactly
// what makes a filesystem-only "is there a subject here" test unsafe on its own.
const GIT_LOCATION_ENV = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE"];

/**
 * Can this control SEE a repair-ledger subject for this tree? Blindness is a property of what the
 * control can SEE, never of what can EXIST — a spoofed Git location makes it read a different
 * subject while the real one stands, so no answer here proves absence in the world; it proves
 * absence in this control's view. The question still separates "no subject in view" from "cannot
 * read the subject in view", and only the FIRST may ever relieve a write. It answers WITHOUT
 * running git, because the case it exists for is the one where git could not be run. Every
 * uncertainty — including any Git location override in the environment — resolves to TRUE (a
 * subject may be present), so the relief is granted only when this control's own walk finds
 * nothing it could ever have read.
 */
export function gitSubjectPresent(projectRoot, { env = process.env } = {}) {
  if (GIT_LOCATION_ENV.some((name) => typeof env?.[name] === "string" && env[name].trim() !== "")) return true;
  let dir;
  try { dir = realpathSync(projectRoot); } catch { return true; }
  for (;;) {
    // lstat, not stat: a SYMLINKED `.git` is a subject that may be present, and it is also the
    // tamper shape the ledger reader already fails closed on. Both reasons point the same way.
    // ONLY ENOENT continues the walk. Any other error — EACCES, ELOOP, ENOTDIR — is a subject
    // this control could not SEE, and unseen resolves toward PRESENT: an unreadable ancestor
    // must never buy the blind relief.
    try { lstatSync(path.join(dir, ".git")); return true; }
    catch (error) { if (error?.code !== "ENOENT") return true; }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function gitLocationOverrides(env = process.env) {
  return GIT_LOCATION_ENV.filter((name) => typeof env?.[name] === "string" && env[name].trim() !== "");
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

function readRepairLedgerRows(file) {
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
    if (!plain(row) || !plain(row.event) || !READ_EVENT_TYPES.has(row.event.type) ||
        (row.event.type === AGGREGATE_EVENT_TYPE && !validAggregateEnvelope(row.event)) ||
        row.event_id !== eventId(row.event)) return null;
    // `seq` is the row's LEDGER POSITION — the one total order both grammars share. Cross-stream
    // predicates evaluate against it, so appending a row never re-adjudicates an earlier one.
    if (!seen.has(row.event_id)) { row.seq = rows.length; rows.push(row); }
    seen.add(row.event_id);
  }
  return rows;
}

export function readRepairEvents(file) {
  const rows = readRepairLedgerRows(file);
  return rows === null ? null : rows.filter((row) => EVENT_TYPES.has(row.event.type));
}

export function readAggregateRepairEvents(file) {
  const rows = readRepairLedgerRows(file);
  return rows === null ? null : rows.filter((row) => row.event.type === AGGREGATE_EVENT_TYPE);
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

function readRepairLedgerRowsSettled(file) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = readRepairLedgerRows(file);
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

function appendTypedEvent(file, event, allowed) {
  if (!file || !plain(event) || !allowed(event) || !safeLedgerDir(file)) return { ok: false, state: "repair-ledger-unavailable" };
  const before = readRepairLedgerRowsSettled(file);
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
  const after = readRepairLedgerRowsSettled(file);
  if (after === null || !after.some((r) => r.event_id === id)) return { ok: false, state: "repair-ledger-unavailable" };
  return { ok: true, event_id: id, idempotent: false };
}

function appendRepairEvent(file, rawEvent) {
  const event = jsonNormalize(rawEvent);
  if (!event) return { ok: false, state: "repair-round-malformed" };
  return appendTypedEvent(file, event, (candidate) => EVENT_TYPES.has(candidate.type));
}

function appendAggregateEvent(file, event) {
  return appendTypedEvent(file, event, validAggregateEnvelope);
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

function exactGitCandidate(projectRoot, commit, tree, { execGit = execFileSync } = {}) {
  if (!GIT_SHA.test(commit || "") || !GIT_SHA.test(tree || "")) return null;
  try {
    const head = String(execGit("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" })).trim();
    const headTree = String(execGit("git", ["rev-parse", "HEAD^{tree}"], { cwd: projectRoot, encoding: "utf8" })).trim();
    return head === commit && headTree === tree ? { commit, tree } : null;
  } catch { return null; }
}

function cleanGitCandidate(projectRoot, commit, tree, options = {}) {
  const candidate = exactGitCandidate(projectRoot, commit, tree, options);
  if (!candidate) return null;
  try {
    // TRACKED cleanliness only. An untracked file cannot alter the committed candidate the seats
    // review, and requiring `-uall`-clean made the controller unusable in any tree holding rig
    // material or scratch notes — this repository included. What untracked files a packet may
    // expose to a seat is packet discipline, not candidate identity.
    const dirty = String((options.execGit || execFileSync)("git",
      ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" }))
      .split("\n").filter((line) => line && !line.startsWith("?? "));
    return dirty.length ? null : candidate;
  } catch { return null; }
}

function sortedPaths(value, max = 500) {
  if (!Array.isArray(value) || value.length === 0 || value.length > max ||
      !value.every((entry) => strings([entry], { paths: true, itemMax: 500 }) &&
        !entry.includes("\\") && path.posix.normalize(entry) === entry)) return null;
  const sorted = [...new Set(value)].sort();
  return sorted.length === value.length ? sorted : null;
}

function validBaseRef(value) {
  return text(value, 200) && !value.startsWith("-") && !value.includes("..") &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

// Evidence derives from the IMMUTABLE (base_commit, frozen_commit) PAIR — never from live HEAD.
// The prior form read merge-base and the changed-path diff against HEAD in separate git calls, so a
// concurrent HEAD move could bind frozen commit A to changed paths from B and permanently reserve
// an unusable first panel (the snapshot TOCTOU). Commit-addressed queries cannot mix snapshots;
// whether the CALLER is actually standing at the frozen candidate is `cleanGitCandidate`'s check,
// taken before AND after this capture by the recording site.
function panelGitEvidence(projectRoot, baseRef, baseCommit, frozenCommit,
  { execGit = execFileSync, anchorToRef = true } = {}) {
  if (!validBaseRef(baseRef) || !GIT_SHA.test(baseCommit || "") || !GIT_SHA.test(frozenCommit || "")) return null;
  try {
    // The REF anchoring (merge-base against the moving base ref) binds only at OPEN time. Later
    // recomputations — panel_close, dispositions — anchor to the recorded base COMMIT alone: the
    // ref legitimately advances (the frozen commit may even land on it), and an immutable pair
    // must never be refused because the world moved on around it.
    const anchor = anchorToRef ? baseRef : baseCommit;
    const mergeBase = String(execGit("git", ["merge-base", frozenCommit, anchor],
      { cwd: projectRoot, encoding: "utf8" })).trim();
    if (mergeBase !== baseCommit || frozenCommit === baseCommit) return null;
    const paths = String(execGit("git", ["diff", "--name-only", "-z", "--no-renames", `${baseCommit}..${frozenCommit}`],
      { cwd: projectRoot, encoding: "utf8" })).split("\0").filter(Boolean);
    const changedPaths = sortedPaths(paths);
    return changedPaths ? { base_ref: baseRef, base_commit: baseCommit, changed_paths: changedPaths } : null;
  } catch { return null; }
}

function expectedSeatShape(seat, changedPaths) {
  if (!plain(seat) || !text(seat.seat_id, 120) || !text(seat.role, 120) ||
      !text(seat.family, 120) || !["free", "folded"].includes(seat.pass_type)) return false;
  const paths = sortedPaths(seat.paths);
  if (!paths || paths.some((entry) => !changedPaths.includes(entry))) return false;
  if (seat.substitution === undefined || seat.substitution === null) return true;
  return plain(seat.substitution) && seat.substitution.replaced_family === seat.family &&
    text(seat.substitution.actual_family, 120) && seat.substitution.actual_family !== seat.family &&
    text(seat.substitution.owner_evidence, 1000) &&
    ["full", "one-family", "same-family-only"].includes(seat.substitution.decorrelation_level);
}

function receivedSeatShape(received) {
  return plain(received) && text(received.seat_id, 120) && text(received.role, 120) &&
    text(received.family, 120) && ["free", "folded"].includes(received.pass_type) &&
    Boolean(sortedPaths(received.inspected_paths)) && GIT_SHA.test(received.reviewed_commit || "") &&
    GIT_SHA.test(received.reviewed_tree || "") && ["GO", "NO-GO"].includes(received.verdict) &&
    Array.isArray(received.raw_finding_ids) && received.raw_finding_ids.length <= 100 &&
    new Set(received.raw_finding_ids).size === received.raw_finding_ids.length &&
    received.raw_finding_ids.every((id) => text(id, 300)) &&
    (received.verdict !== "NO-GO" || received.raw_finding_ids.length > 0) &&
    text(received.artifact_receipt, 500) && ID64.test(received.artifact_sha256 || "") &&
    // pre_loaded is a LOG the Owner spot-checks, never one bit: false, true, or the seat's own
    // disclosure text of what arrived that nobody sent.
    (typeof received.pre_loaded === "boolean" || text(received.pre_loaded, 500)) &&
    ["candidate-only", "folded-history"].includes(received.packet_scope);
}

function receivedSeatsShape(value) {
  return Array.isArray(value) && value.length >= 4 && value.length <= 12 &&
    new Set(value.map((seat) => seat?.seat_id)).size === value.length && value.every(receivedSeatShape);
}

function expectedPanelShape(tier, seats, changedPaths) {
  if (!["T2", "T3"].includes(tier) || !Array.isArray(seats) || seats.length < 4 || seats.length > 12 ||
      new Set(seats.map((seat) => seat?.seat_id)).size !== seats.length ||
      !seats.every((seat) => expectedSeatShape(seat, changedPaths))) return false;
  const angles = new Set(seats.filter((seat) => seat.role.startsWith("angle:")).map((seat) => seat.role));
  const free = seats.find((seat) => seat.role === "free");
  // FAMILY FLOOR: T2/T3 owe cross-family decorrelation, so a roster whose every seat declares one
  // family cannot open — UNLESS a seat carries the Owner-authorized `same-family-only`
  // substitution `core/REVIEW.md` § External gate defines: when every other family is out, the
  // reduced state is RECORDED, never walled out and never taken silently. Family names stay data —
  // the floor counts DISTINCT values case-insensitively (substitution's actual family where
  // present); it never recognises brands. Exactly ONE seat may hold the free role.
  const families = new Set(seats.map((seat) =>
    String(seat.substitution?.actual_family || seat.family).toLowerCase()));
  const sameFamilyAuthorized = seats.some((seat) =>
    seat.substitution?.decorrelation_level === "same-family-only");
  return free?.pass_type === "free" && same(free.paths, changedPaths) &&
    seats.filter((seat) => seat.role === "free").length === 1 &&
    seats.filter((seat) => seat.role.startsWith("angle:")).every((seat) => seat.pass_type === "free") &&
    seats.some((seat) => seat.role === "external") && angles.size >= (tier === "T3" ? 3 : 2) &&
    (families.size >= 2 || sameFamilyAuthorized);
}

function receivedSeatMatches(expected, received, commit, tree) {
  const allowedFamily = expected.substitution?.actual_family || expected.family;
  return plain(received) && received.seat_id === expected.seat_id && received.role === expected.role &&
    received.family === allowedFamily && received.pass_type === expected.pass_type &&
    same(received.inspected_paths, expected.paths) && received.reviewed_commit === commit &&
    received.reviewed_tree === tree && ["GO", "NO-GO"].includes(received.verdict) &&
    Array.isArray(received.raw_finding_ids) && received.raw_finding_ids.length <= 100 &&
    new Set(received.raw_finding_ids).size === received.raw_finding_ids.length &&
    received.raw_finding_ids.every((id) => text(id, 300)) &&
    (received.verdict !== "NO-GO" || received.raw_finding_ids.length > 0) &&
    text(received.artifact_receipt, 500) && ID64.test(received.artifact_sha256 || "") &&
    (typeof received.pre_loaded === "boolean" || text(received.pre_loaded, 500)) &&
    ["candidate-only", "folded-history"].includes(received.packet_scope) &&
    (received.pass_type !== "free" || received.packet_scope === "candidate-only");
}

function aggregatePanelComplete(open, close) {
  if (!open || !close || !Array.isArray(close.received_seats) ||
      close.received_seats.length !== open.expected_seats.length ||
      new Set(close.received_seats.map((seat) => seat?.seat_id)).size !== close.received_seats.length) return false;
  // Cross-seat finding ids must be globally unique AT CLOSE, while the close is still refusable
  // and recomposable. Enforced only at disposition time, a collision landed a durable close no
  // disposition could ever cite — a permanent, in-band-unrecoverable deadlock two independent
  // seats each labelling their first finding "F1" would wander into.
  const allIds = close.received_seats.flatMap((seat) => Array.isArray(seat?.raw_finding_ids) ? seat.raw_finding_ids : []);
  if (new Set(allIds).size !== allIds.length) return false;
  const received = new Map(close.received_seats.map((seat) => [seat.seat_id, seat]));
  if (!open.expected_seats.every((seat) => receivedSeatMatches(seat, received.get(seat.seat_id),
    open.frozen_commit, open.frozen_tree))) return false;
  const covered = new Set(close.received_seats.flatMap((seat) => seat.inspected_paths));
  return open.changed_paths.every((entry) => covered.has(entry));
}

function pmFindingsShape(value) {
  return Array.isArray(value) && value.length <= 100 &&
    new Set(value.map((finding) => finding?.id)).size === value.length &&
    value.every((finding) => plain(finding) && text(finding.id, 300) && text(finding.harm, 1000) &&
      text(finding.mechanism, 1000) && text(finding.trigger, 1000));
}

function findingPartition(ids, partition) {
  if (!findingPartitionShape(partition)) return null;
  const followupIds = partition.followup.map((entry) => entry.id);
  const all = [...partition.accepted, ...partition.declined, ...partition.note, ...followupIds];
  return all.length === ids.length && new Set(all).size === all.length &&
    ids.every((id) => all.includes(id)) ? {
      accepted: [...partition.accepted], declined: [...partition.declined], note: [...partition.note],
      followup: structuredClone(partition.followup),
    } : null;
}

// FOUR disjoint buckets. `accepted` means BLOCKING-accepted (changed-feature / contract-invariant /
// Critical-fail-open — the PM's declaration); a REAL but NON-BLOCKING, safely separable adjacent
// finding is a `followup`, and each followup entry carries its routing INLINE (successor changeset
// or named backlog). Embedded here rather than as a separate event because a follow-on event citing
// the GO disposition would be a content-hash cycle in this append-only ledger — unconstructible —
// and a routing that cannot be recorded is a routing that silently does not happen.
function followupEntryShape(entry) {
  return plain(entry) && text(entry.id, 300) && text(entry.route, 300);
}
function findingPartitionShape(partition) {
  return plain(partition) && Object.keys(partition).length === 4 &&
    ["accepted", "declined", "note"].every((key) =>
      Array.isArray(partition[key]) && new Set(partition[key]).size === partition[key].length &&
      partition[key].every((id) => text(id, 300))) &&
    Array.isArray(partition.followup) && partition.followup.every(followupEntryShape) &&
    new Set(partition.followup.map((entry) => entry.id)).size === partition.followup.length;
}

function baseEvent(type, input, sessionId, now) {
  if (!text(input?.task_id, 120) || !text(input?.changeset_id, 120) || !text(sessionId, 200)) return null;
  return { type, task_id: input.task_id, changeset_id: input.changeset_id, recorded_at: now, session_id: sessionId };
}

function aggregateRows(events) {
  return events.filter((row) => row?.event?.type === AGGREGATE_EVENT_TYPE)
    .map((row) => ({ ...row.event, event_id: row.event_id, seq: row.seq }));
}

function aggregateChildShape(child) {
  const paths = sortedPaths(child?.authorized_paths);
  return plain(child) && text(child.task_id, 120) && text(child.changeset_id, 120) &&
    ["T2", "T3"].includes(child.tier) && text(child.budget, 300) &&
    paths && same(paths, child.authorized_paths);
}

function aggregateWorld(events, standardEvents = []) {
  if (!Array.isArray(events) || !events.every((row) => plain(row) && validAggregateEnvelope(row.event) &&
      row.event_id === eventId(row.event))) return null;
  const programs = new Map(), accepted = new Map(), continuations = new Map(), childLineage = new Map();
  const standardIdentities = standardEvents.filter((row) => row?.event?.type === "round_disposition" &&
    row.event.round === 1).filter((row, index, all) => all.findIndex((candidate) =>
    candidate.event.task_id === row.event.task_id || candidate.event.changeset_id === row.event.changeset_id) === index);
  const legacyHandedOff = new Set();
  // CROSS-STREAM ORDER: every ledger row carries `seq`, its position in the one shared file.
  // Standard-derived predicates evaluate AS OF the consulting aggregate row's position, so replay
  // is prefix-stable: appending a row — to either grammar — can never re-adjudicate a row already
  // accepted, and the measured fail-open (an out-of-band standard append retroactively erasing an
  // aggregate program's terminal state, its STOP reservation, and its lineage) is impossible by
  // construction. A row WITHOUT seq is synthetic: a standard row predates everything (-1), an
  // aggregate row — the prospective candidate at record time — sees the full stream (Infinity).
  const stdSeq = (row) => (Number.isSafeInteger(row.seq) ? row.seq : -1);
  const stdTaskUsed = (id, atSeq) => standardIdentities.some((row) => stdSeq(row) < atSeq && row.event.task_id === id);
  const stdChangesetUsed = (id, atSeq) => standardIdentities.some((row) => stdSeq(row) < atSeq && row.event.changeset_id === id);
  const usedTasks = new Set(), usedChangesets = new Set();
  const parentContinuations = new Map(), standardStates = new Map(), standardPrefixes = new Map();
  // REPLAY CONSISTENCY: any standard identity whose derivation FAILS poisons the whole world —
  // fail CLOSED, matching activeRepairPathOwners' direction. Silently dropping the failed task
  // instead made one bad standard row erase a legacy child's entire lineage (fail-OPEN) while
  // the ownership query on the same input denied everything.
  let poisoned = false;
  const getStandard = (taskId, atSeq = Infinity) => {
    const key = `${atSeq}:${taskId}`;
    if (!standardStates.has(key)) {
      if (!standardPrefixes.has(atSeq)) {
        standardPrefixes.set(atSeq, atSeq === Infinity ? standardEvents
          : standardEvents.filter((row) => stdSeq(row) < atSeq));
      }
      standardStates.set(key, deriveRepairState(standardPrefixes.get(atSeq), taskId));
    }
    const derived = standardStates.get(key);
    if (!derived?.ok) poisoned = true;
    return derived;
  };
  // Poisoning is UNCONDITIONAL: every standard identity derives up front, so a broken standard
  // history fails the world closed whether or not an aggregate row happens to consult it.
  for (const identity of standardIdentities) getStandard(identity.event.task_id);
  // THE ADMITTED SET per task, accumulated AS ROWS ARE ACCEPTED — as-of by construction, like
  // every other predicate in this derivation. Close eligibility compares against every session
  // ADMITTED BEFORE the close's own ledger position (verifications AND handoff replacements;
  // admissions accumulate — a handoff revokes authority, never membership). The earlier
  // whole-ledger pre-scan was the ONE predicate outside the as-of discipline, and it re-created
  // the measured fail-open: a LATER admission row naming the closer's session retro-refused an
  // ACCEPTED close, resurrecting the program and erasing its successor lineage. Forward
  // adjudication needs no pre-scan: a session not yet admitted at close time is genuinely not a
  // worker (intent is not fact — records-not-deters), and its later self-admission refuses on
  // the terminality the accepted close created.
  const admittedByTask = new Map();
  const admitSession = (taskId, sessionId) => {
    if (!admittedByTask.has(taskId)) admittedByTask.set(taskId, new Set());
    admittedByTask.get(taskId).add(sessionId);
  };
  const overlaps = (left, right) => left.some((candidate) => right.includes(candidate));
  // THE PATHS A PROGRAM BINDS, in every pre-terminal state. An ACTIVE program binds its
  // authorized repair set; a program still mid-round — an open or collected-but-undisposed panel —
  // binds the UNION of its opens' changed paths. Binding nothing until the first disposition was
  // the measured reset: a second program on the identical surface opened freely while the first
  // panel was still reviewing it.
  const programBoundPaths = (program) => {
    if (program.terminal) return [];
    // An ACTIVE program binds its authorized repair set PLUS any undisposed open's changed
    // paths: a later round's panel mid-review is as bound as the first round's — leaving it
    // unbound let a concurrent open wedge a live program out of remediating its own reviewed
    // surface (a measured defect).
    const undisposed = program.panels_open.filter((open) =>
      !program.dispositions.some((disposition) => disposition.round === open.round))
      .flatMap((open) => open.changed_paths);
    if (program.active) return [...new Set([...program.authorized_paths, ...undisposed])];
    return [...new Set(program.panels_open.flatMap((open) => open.changed_paths))];
  };
  const activePathOverlap = (paths, exceptTask = null, atSeq = Infinity) => {
    for (const identity of standardIdentities) {
      if (stdSeq(identity) >= atSeq) continue;
      if (identity.event.task_id === exceptTask || legacyHandedOff.has(identity.event.task_id)) continue;
      const legacy = getStandard(identity.event.task_id, atSeq);
      if (legacy?.ok && legacy.active && overlaps(paths, legacy.latest.authorized_paths)) return true;
    }
    return [...programs.values()].some((program) => program.task_id !== exceptTask &&
      overlaps(paths, programBoundPaths(program)));
  };
  // A terminal reservation yields to TWO things only: the reserving program's own lineage (a
  // child whose continuation names THAT parent), and a lineage DESCENDANT that reached
  // TERMINAL-GO — a successful repair through the sanctioned exit LIFTS the reservation, or a
  // stopped surface would stay bricked one generation after its reason was fixed. The lift is
  // COVERAGE-SCOPED: a DIRECT lineage child reaching TERMINAL-GO lifts only the paths inside
  // ITS OWN declared budget — never the whole union. A narrowly-scoped first child must not
  // release its siblings' never-repaired surfaces to unrelated programs (measured by
  // independent executions). A grandchild chain lifts nothing here by design: each
  // generation's reservation is its own, exited through its own direct children.
  const liftedPaths = (program) => {
    const lifted = new Set();
    for (const lineage of childLineage.values()) {
      if (lineage.parent_task_id !== program.task_id) continue;
      const child = programs.get(lineage.task_id);
      if (child?.terminal !== "GO") continue;
      // Budget ∩ OPENED COVERAGE: a wide budget is a plan, not a repair — the lift releases only
      // what the GO child's panels actually reviewed (the measured gap: a child
      // declared wide, opened narrow, and its GO released never-reviewed reserved surface).
      const repaired = new Set(child.panels_open.flatMap((open) => open.changed_paths));
      for (const entry of lineage.authorized_paths) if (repaired.has(entry)) lifted.add(entry);
    }
    return lifted;
  };
  // The FULL ancestor chain of a lineage child, for the reservation exception: a grandchild
  // working its parent's reserved slice is also working its grandparent's — excepting only the
  // direct parent made the exit lattice one-shot (the measured nested lockout:
  // the grandchild refused forever on the grandparent's unliftable reservation).
  const lineageAncestors = (taskId) => {
    const ancestors = new Set();
    let current = childLineage.get(taskId)?.parent_task_id ?? null;
    while (current !== null && !ancestors.has(current)) {
      ancestors.add(current);
      current = childLineage.get(current)?.parent_task_id ?? null;
    }
    return ancestors;
  };
  const stoppedPathOverlap = (paths, exceptParents = null) => [...programs.values()].some((program) => {
    if (!(program.terminal === "STOP" || (program.terminal === "CLOSED" && program.stopped_paths?.length)) ||
        exceptParents?.has(program.task_id)) return false;
    const lifted = liftedPaths(program);
    return (program.stopped_paths || []).some((entry) => !lifted.has(entry) && paths.includes(entry));
  });
  // A PENDING lineage child's declared budget binds from the moment of its declaration until
  // its own program exists: the child's IDENTITIES were already reserved, but its PATHS were
  // not, and the window between a handoff (or an out-of-reservation continuation) and the
  // child's first open let a concurrent unrelated program snipe the surface and lock the child
  // out of its own lineage (a measured defect). The exit is the child opening.
  const pendingLineageOverlap = (paths, exceptTask = null) => [...childLineage.values()].some((lineage) =>
    lineage.task_id !== exceptTask && !programs.has(lineage.task_id) &&
    overlaps(paths, lineage.authorized_paths));
  // The declaration-time reservation exception: the declarer plus every ancestor reachable
  // without passing a TERMINAL-GO node (a GO ended that lineage's claim on reserved surface).
  const declarationExceptions = (taskId) => {
    const except = new Set([taskId]);
    let current = taskId;
    while (programs.get(current)?.terminal !== "GO") {
      const parent = childLineage.get(current)?.parent_task_id ?? null;
      if (parent === null || except.has(parent)) break;
      except.add(parent);
      current = parent;
    }
    return except;
  };
  const lineageChangesetUsed = (changesetId) => [...childLineage.values()]
    .some((lineage) => lineage.changeset_id === changesetId);
  const accept = (row) => { accepted.set(row.event_id, row); return row; };

  for (const row of aggregateRows(events)) {
    const state = programs.get(row.task_id) || null;
    const rowSeq = Number.isSafeInteger(row.seq) ? row.seq : Infinity;
    if (row.kind === "panel_open") {
      const paths = sortedPaths(row.changed_paths);
      if (!Number.isSafeInteger(row.round) || row.round < 1 || row.round > 4 ||
          !["repair_round", "final_bookend"].includes(row.phase) || !["T2", "T3"].includes(row.tier) ||
          !GIT_SHA.test(row.frozen_commit || "") || !GIT_SHA.test(row.frozen_tree || "") ||
          !validBaseRef(row.base_ref) || !GIT_SHA.test(row.base_commit || "") || !paths ||
          !same(paths, row.changed_paths) || !expectedPanelShape(row.tier, row.expected_seats, paths)) continue;
      if (!state) {
        const lineageId = row.child_continuation_event_id ?? row.legacy_handoff_event_id ?? null;
        // Identity squats are judged against what was VISIBLE at this row's ledger position. A
        // standard row appended later never re-adjudicates the program (order is restored by
        // seq), and a row colliding with an identity that preceded it was never recordable —
        // audit residue, inert, per the wrong-reference bound.
        if (usedTasks.has(row.task_id) || usedChangesets.has(row.changeset_id) ||
            stdTaskUsed(row.task_id, rowSeq) || stdChangesetUsed(row.changeset_id, rowSeq)) continue;
        const lineage = lineageId !== null ? childLineage.get(row.task_id) : null;
        if (row.round !== 1 || row.phase !== "repair_round" || row.incoming_dispatch_event_id !== null ||
            row.incoming_worker_event_id !== null || activePathOverlap(paths, row.task_id, rowSeq) ||
            pendingLineageOverlap(paths, row.task_id) ||
            (lineageId === null && stoppedPathOverlap(paths))) continue;
        if (lineageId !== null) {
          // A child's opened paths are a SUBSET of its declared lineage budget — exact equality
          // demanded predicting the child's future diff at continuation time, and a wrong guess
          // burned the one continuation forever.
          if (!lineage || lineage.event_id !== lineageId || lineage.changeset_id !== row.changeset_id ||
              lineage.tier !== row.tier ||
              !paths.every((entry) => lineage.authorized_paths.includes(entry))) continue;
          if (stoppedPathOverlap(paths, lineageAncestors(row.task_id))) continue;
        } else if (childLineage.has(row.task_id) || lineageChangesetUsed(row.changeset_id)) {
          // A declared lineage child's identities are RESERVED: an unrelated program claiming the
          // child's changeset id would permanently kill the one exit from a terminal reservation.
          continue;
        }
        const created = { ok: true, task_id: row.task_id, changeset_id: row.changeset_id, tier: row.tier,
          panels_open: [], panels_close: [], dispositions: [], root_exits: [], dispatches: [],
          workers: [], worker_handoffs: [], latest: null, active_dispatch: null, active_worker: null,
          closes: [], terminal: null, active: false, authorized_paths: [], stopped_paths: [],
          lineage_event_id: lineageId };
        programs.set(row.task_id, created); usedTasks.add(row.task_id); usedChangesets.add(row.changeset_id);
      } else {
        // A REFREEZE SUPERSEDE: the same round re-opened on a DIFFERENT frozen candidate while
        // the prior panel never closed — the cure for a mid-panel contaminated candidate, which
        // would otherwise reserve an unusable panel forever. FOUR bounds keep it from becoming
        // the un-batched repair loop this model retires: (1) at most ONE supersede per round —
        // repeated contamination is rig-class harm, and the exit is close+successor, never a
        // grind; (2) NEVER at the final bookend — a contaminated bookend ends via close+
        // successor, or the bookend would be refreezable-to-green; (3) the ROSTER and the
        // CHANGED-PATH SET are pinned to the superseded open — a refreeze changes candidate
        // BYTES, never membership or scope; (4) both path-overlap checks re-run. It grants
        // nothing: no disposition was reached, no batch is consumed, the round does not move.
        const priorOpens = state.panels_open.filter((open) => open.round === row.round);
        const prior = priorOpens.at(-1);
        const roundClosed = prior && state.panels_close.some((close) =>
          state.panels_open.find((open) => open.event_id === close.panel_open_event_id)?.round === row.round);
        if (prior && !state.terminal && !roundClosed && state.changeset_id === row.changeset_id &&
            priorOpens.length < 2 && prior.phase !== "final_bookend" &&
            (row.frozen_commit !== prior.frozen_commit || row.frozen_tree !== prior.frozen_tree) &&
            row.phase === prior.phase && row.tier === prior.tier &&
            row.base_ref === prior.base_ref && row.base_commit === prior.base_commit &&
            same(row.expected_seats, prior.expected_seats) &&
            same(paths, prior.changed_paths) &&
            !activePathOverlap(paths, row.task_id, rowSeq) &&
            !pendingLineageOverlap(paths, row.task_id) &&
            !stoppedPathOverlap(paths, state.lineage_event_id ? lineageAncestors(row.task_id) : null) &&
            row.incoming_dispatch_event_id === prior.incoming_dispatch_event_id &&
            row.incoming_worker_event_id === prior.incoming_worker_event_id &&
            row.child_continuation_event_id === prior.child_continuation_event_id &&
            row.legacy_handoff_event_id === prior.legacy_handoff_event_id) {
          state.panels_open.push(accept(row));
          continue;
        }
        // TIER CONTINUITY: a later round may ESCALATE the tier, never lower it — without this a
        // T3 program's terminal panel could be a T2 panel, with no batch spent and no record.
        // AND the SAME authority checks the first open owed: a later round's candidate can widen
        // scope, so the overlap checks, the terminal reservations, and (for a lineage child) the
        // declared budget all re-run against the new round's derived paths — a round-2 candidate
        // is not a skeleton key over what round 1 could not touch.
        const ownLineage = state.lineage_event_id ? childLineage.get(row.task_id) : null;
        if (state.changeset_id !== row.changeset_id || state.terminal || !state.latest ||
            state.latest.terminal_state !== "CONTINUE" || row.round !== state.latest.round + 1 ||
            // THE BASE IS THE CHANGESET'S, NOT THE ROUND'S: every later round re-derives its
            // changed paths from ROUND 1's exact base, or a moved base reviews only the last
            // delta while the GO — and the lift's "opened coverage" — certifies the whole
            // candidate (a measured defect: "immutable base..frozen
            // pair" was claimed but never enforced across rounds).
            row.base_ref !== state.panels_open[0].base_ref ||
            row.base_commit !== state.panels_open[0].base_commit ||
            row.phase !== (row.round === 4 ? "final_bookend" : "repair_round") ||
            (TIER_RANK[row.tier] ?? 0) < (TIER_RANK[state.tier] ?? 0) ||
            activePathOverlap(paths, row.task_id, rowSeq) ||
            pendingLineageOverlap(paths, row.task_id) ||
            stoppedPathOverlap(paths, ownLineage ? lineageAncestors(row.task_id) : null) ||
            (ownLineage && !paths.every((entry) => ownLineage.authorized_paths.includes(entry))) ||
            row.incoming_dispatch_event_id !== state.active_dispatch?.event_id ||
            row.incoming_worker_event_id !== state.active_worker?.event_id ||
            row.child_continuation_event_id !== null || row.legacy_handoff_event_id !== null) continue;
      }
      const current = programs.get(row.task_id);
      if (!current.panels_open.some((open) => open.round === row.round)) {
        current.panels_open.push(accept(row));
        // Escalation lands only with an ACCEPTED row — a rejected duplicate must mutate nothing.
        if (state && (TIER_RANK[row.tier] ?? 0) > (TIER_RANK[current.tier] ?? 0)) current.tier = row.tier;
      }
    } else if (row.kind === "panel_close") {
      // TERMINALITY DOMINATES DELAYED EVENTS: a panel opened before the program went terminal must
      // not close after it — a late close feeding a late disposition was the measured path that
      // resurrected ownership under a CLOSED program.
      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||
          !ID64.test(row.panel_open_event_id || "")) continue;
      const open = state.panels_open.find((candidate) => candidate.event_id === row.panel_open_event_id);
      // The WINNING open for a round is the LATEST accepted one — a refreeze supersede displaces
      // its predecessor, and the superseded open can no longer close.
      const winningOpen = open && [...state.panels_open].reverse().find((candidate) => candidate.round === open.round);
      if (!open || winningOpen?.event_id !== open.event_id ||
          state.panels_close.some((close) => close.panel_open_event_id === open.event_id) ||
          !aggregatePanelComplete(open, row)) continue;
      state.panels_close.push(accept(row));
    } else if (row.kind === "disposition") {
      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||
          !ID64.test(row.panel_close_event_id || "") || !pmFindingsShape(row.pm_findings)) continue;
      const close = state.panels_close.find((candidate) => candidate.event_id === row.panel_close_event_id);
      const open = close && state.panels_open.find((candidate) => candidate.event_id === close.panel_open_event_id);
      if (!close || !open || state.dispositions.some((candidate) => candidate.round === open.round)) continue;
      const ids = [...close.received_seats.flatMap((seat) => seat.raw_finding_ids),
        ...row.pm_findings.map((finding) => finding.id)];
      if (new Set(ids).size !== ids.length) continue;
      const partition = findingPartition(ids, row.finding_dispositions);
      const paths = Array.isArray(row.authorized_paths)
        ? (row.authorized_paths.length === 0 ? [] : sortedPaths(row.authorized_paths)) : null;
      if (!partition || !paths || paths.some((entry) => !open.changed_paths.includes(entry))) continue;
      const acceptedCount = partition.accepted.length;
      let valid = false;
      if (open.round === 4 && open.phase === "final_bookend") {
        // TOTAL by construction: `accepted` means BLOCKING-accepted, so the bookend is GO xor STOP
        // with no third case — a real non-blocking adjacent lives in `followup`, already routed.
        valid = row.remediation_kind === null && row.authorized_paths.length === 0 &&
          row.terminal_state === (acceptedCount ? "STOP" : "GO");
      } else if (!acceptedCount) {
        valid = row.terminal_state === "GO" && row.remediation_kind === null && row.authorized_paths.length === 0;
      } else if (row.terminal_state === "STOP") {
        // The PM may DECLARE STOP at any round — an accepted Critical / fail-open-in-a-shipped-
        // control harm the batch model must not carry forward. Declared, never inferred.
        valid = row.remediation_kind === null && row.authorized_paths.length === 0;
      } else if (open.round < 3) {
        // Same-class or repair-generated recurrence may force the terminal kind EARLY — the PM
        // may declare a root kind at R1/R2; bounded stays the default.
        valid = row.terminal_state === "CONTINUE" &&
          ["bounded", "root_replacement", "simplification", "split"].includes(row.remediation_kind) &&
          paths.length > 0;
      } else if (open.round === 3) {
        valid = row.terminal_state === "CONTINUE" &&
          ["root_replacement", "simplification", "split"].includes(row.remediation_kind) && paths.length > 0;
      }
      if (!valid) continue;
      if (row.terminal_state === "CONTINUE") {
        const dispositionLineage = state.lineage_event_id ? childLineage.get(row.task_id) : null;
        if (activePathOverlap(paths, row.task_id, rowSeq) ||
            pendingLineageOverlap(paths, row.task_id) ||
            stoppedPathOverlap(paths, dispositionLineage ? lineageAncestors(row.task_id) : null) ||
            (dispositionLineage && paths.length &&
              !paths.every((entry) => dispositionLineage.authorized_paths.includes(entry)))) continue;
      }
      const disposition = accept({ ...row, round: open.round, phase: open.phase,
        finding_dispositions: partition, all_finding_ids: ids });
      state.dispositions.push(disposition); state.latest = disposition;
      state.authorized_paths = [...paths]; state.active = disposition.terminal_state === "CONTINUE";
      state.active_dispatch = null; state.active_worker = null;
      if (["GO", "STOP"].includes(disposition.terminal_state)) {
        state.terminal = disposition.terminal_state;
        // The reservation covers every surface the program GROUND — the union of its opens'
        // changed paths — not only the final round's. A batch that reverted a file must not
        // release a surface a full panel reviewed.
        if (state.terminal === "STOP") {
          state.stopped_paths = [...new Set(state.panels_open.flatMap((o) => o.changed_paths))];
        }
      }
    } else if (row.kind === "close") {
      // ABANDON, reworked on three measured defects. (1) Eligibility compares against EVERY
      // admitted worker session — verifications AND handoff replacements — not the one current
      // worker, which was null in the window right after a disposition (any constrained session
      // could release itself). (2) A program with NO disposition — an unassemblable roster, a
      // cancelled round — closes by citing its winning panel_open; before, such a program was
      // permanently unabandonable. (3) A close after any COLLECTED panel RESERVES the union of
      // the program's opens' changed paths exactly as a STOP does: close-then-relabel was an
      // unlimited fresh-budget restart over the same paths, and ground findings are not released
      // by abandoning them before the disposition. A truly virgin close (no panel ever
      // collected) reserves nothing — nothing was ground. The session comparison remains
      // records-not-deters: it refuses the admitted ID, never the actor behind it.
      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||
          !text(row.reason, 1000) || !text(row.owner_evidence, 1000)) continue;
      // Eligibility is decided against every session admitted BEFORE this row's position —
      // as-of, like every predicate here. A session not yet admitted is genuinely not a worker
      // (intent is not fact), and its later self-admission refuses on the terminality this
      // close creates — so the old whole-ledger pre-scan bought nothing and cost replay
      // stability (a later admission row retro-refused an accepted close).
      if (admittedByTask.get(row.task_id)?.has(row.session_id)) continue;
      const latestOpen = state.panels_open.at(-1) || null;
      const citesDisposition = state.latest && row.disposition_event_id === state.latest.event_id &&
        row.panel_open_event_id === undefined;
      const citesOpen = !state.latest && latestOpen && row.disposition_event_id === null &&
        row.panel_open_event_id === latestOpen.event_id;
      if (!citesDisposition && !citesOpen) continue;
      state.closes.push(accept(row)); state.terminal = "CLOSED"; state.active = false;
      // The reservation discriminator is WAS A RECEIPT RECORDED, not was a disposition recorded:
      // a close after a collected NO-GO panel abandons GROUND findings, and releasing that
      // surface free was the measured un-batched escape. A truly virgin program — no panel ever
      // collected — reserves nothing.
      if (state.panels_close.length) {
        state.stopped_paths = [...new Set(state.panels_open.flatMap((o) => o.changed_paths))];
      }
      state.authorized_paths = []; state.active_dispatch = null; state.active_worker = null;
    } else if (row.kind === "root_exit") {
      // ONE exit PER ROOT-KIND DISPOSITION — never one per program: an early root kind must not
      // spend the slot the mandatory round-3 root batch will need.
      if (!state || state.terminal || state.changeset_id !== row.changeset_id ||
          !ID64.test(row.disposition_event_id || "") ||
          state.root_exits.some((exit) => exit.disposition_event_id === row.disposition_event_id) ||
          !text(row.shared_mechanism, 1000) ||
          !text(row.symptom_explanation, 1000) || !strings(row.owner_state_yield_seams, { itemMax: 500 }) ||
          !text(row.replacement, 1200) ||
          !strings(row.removed_workarounds, { itemMax: 500 }) ||
          !strings(row.trigger_matrix, { itemMax: 700 })) continue;
      const disposition = state.dispositions.find((candidate) => candidate.event_id === row.disposition_event_id);
      if (disposition?.terminal_state === "CONTINUE" &&
          ["root_replacement", "simplification", "split"].includes(disposition.remediation_kind)) state.root_exits.push(accept(row));
    } else if (row.kind === "dispatch") {
      if (!state || state.changeset_id !== row.changeset_id || state.terminal || state.active_dispatch ||
          !ID64.test(row.disposition_event_id || "") || !ID64.test(row.panel_close_event_id || "") ||
          !Number.isSafeInteger(row.next_round) || row.target_kind !== "brief" ||
          !strings([row.target], { paths: true, itemMax: 500 }) || !ID64.test(row.brief_sha256 || "") ||
          !Number.isSafeInteger(row.brief_size) || row.brief_size < 0) continue;
      const disposition = state.dispositions.find((candidate) => candidate.event_id === row.disposition_event_id);
      if (!disposition || disposition.event_id !== state.latest?.event_id ||
          disposition.panel_close_event_id !== row.panel_close_event_id ||
          disposition.terminal_state !== "CONTINUE" || row.source_round !== disposition.round ||
          row.next_round !== disposition.round + 1 || !same(row.authorized_paths, disposition.authorized_paths)) continue;
      if (["root_replacement", "simplification", "split"].includes(disposition.remediation_kind)) {
        const exit = state.root_exits.find((candidate) => candidate.event_id === row.root_exit_event_id);
        if (!exit || exit.disposition_event_id !== disposition.event_id) continue;
      } else if (row.root_exit_event_id !== null) continue;
      state.active_dispatch = accept(row); state.dispatches.push(row);
    } else if (row.kind === "worker") {
      if (state?.terminal) continue;
      if (!state || state.changeset_id !== row.changeset_id || state.active_worker ||
          !ID64.test(row.dispatch_event_id || "") || !text(row.worker_session_id, 200)) continue;
      const dispatch = state.dispatches.find((candidate) => candidate.event_id === row.dispatch_event_id);
      if (!dispatch || dispatch.event_id !== state.active_dispatch?.event_id ||
          !same(row.authorized_paths, dispatch.authorized_paths) || row.brief_path !== dispatch.target ||
          row.brief_sha256 !== dispatch.brief_sha256) continue;
      state.active_worker = accept(row); state.workers.push(row);
      admitSession(row.task_id, row.worker_session_id);
    } else if (row.kind === "worker_handoff") {
      if (!state || state.terminal || state.changeset_id !== row.changeset_id || !ID64.test(row.dispatch_event_id || "") ||
          !ID64.test(row.prior_worker_event_id || "") || !text(row.new_worker_session_id, 200) ||
          !text(row.owner_evidence, 1000) || row.new_worker_session_id === state.active_worker?.worker_session_id ||
          row.dispatch_event_id !== state.active_dispatch?.event_id ||
          row.prior_worker_event_id !== state.active_worker?.event_id) continue;
      state.active_worker = accept({ ...row, worker_session_id: row.new_worker_session_id,
        authorized_paths: [...state.active_dispatch.authorized_paths], brief_path: state.active_dispatch.target,
        brief_sha256: state.active_dispatch.brief_sha256 });
      state.worker_handoffs.push(row);
      admitSession(row.task_id, row.new_worker_session_id);
    } else if (row.kind === "child_continuation") {
      // The ONE successor mechanism, and it anchors only to a TERMINAL parent — GO, STOP, or an
      // Owner-closed program. A non-terminal (or held) state can never seed a child's baseline.
      // trigger rules per terminal: STOP inherits the accepted set EXACTLY; GO may carry only
      // routed follow-ups; CLOSED must CARRY the accepted set (a floor — an empty trigger list
      // must not inherit the exit while shedding the harms) and may add routed follow-ups.
      if (!state || state.changeset_id !== row.changeset_id || !state.terminal ||
          !["split", "new_changeset", "material_scope"].includes(row.continuation_kind) ||
          !text(row.owner_evidence, 1000) || !Array.isArray(row.children)) continue;
      const parentOpen = state.panels_open.at(-1);
      // ONE LIVE continuation per anchor — not one EVER. A standing continuation blocks a new
      // one unless every declared child is TERMINAL and at least one ended as a VIRGIN close
      // (opened, collected nothing, closed — so it holds no anchor of its own and its slice of
      // the parent's reservation would otherwise be stranded forever; the measured brick was
      // that brick). A GO child needs no re-declaration (its coverage lifted); a STOP or
      // collected-CLOSED child carries its own anchor and exits through its own lineage.
      const anchorConsumed = (anchorId) => {
        const standing = parentContinuations.get(anchorId);
        if (!standing) return false;
        const children = standing.children.map((child) => programs.get(child.task_id));
        const allTerminal = children.every((child) => child?.terminal);
        const anyVirgin = children.some((child) =>
          child?.terminal === "CLOSED" && !child.panels_close.length);
        // Reopening VIA remainder requires the NEW declaration to actually TARGET the
        // remainder: an executed grind kept the anchor open indefinitely by declaring fresh
        // unrelated budgets while the reserved surface sat untouched. The virgin route is
        // unchanged (a stranded slice reopens regardless of the successor's budget).
        const targetsRemainder = row.children.some((child) =>
          (state.stopped_paths || []).some((entry) =>
            !liftedPaths(state).has(entry) && child.authorized_paths.includes(entry)));
        // A successful PARTIAL repair must not lock the rest: when un-lifted remainder survives
        // on this parent's own reservation, the anchor reopens even with no virgin child
        // (measured: an all-GO split's narrow coverage stranded the remainder).
        const lifted = liftedPaths(state);
        const remainder = (state.stopped_paths || []).some((entry) => !lifted.has(entry));
        return !(allTerminal && (anyVirgin || (remainder && targetsRemainder)));
      };
      // The freshest un-discharged harms ride the lineage: panels COLLECTED after the anchor
      // disposition but never adjudicated carry ground the successor must not shed (the R4
      // bookend executed the shedding: the honest successor refused, the shedding one recorded).
      const undisposedGround = [...new Set(state.panels_close
        .filter((close) => {
          const open = state.panels_open.find((candidate) => candidate.event_id === close.panel_open_event_id);
          return open && !state.dispositions.some((disposition) => disposition.round === open.round);
        })
        .flatMap((close) => close.received_seats.flatMap((seat) => seat.raw_finding_ids)))];
      // Set-equality is ORDER-INSENSITIVE — a successor listing the identical ids in another
      // order is the same declaration, not a different one.
      let triggerOk;
      if (row.parent_disposition_event_id !== null) {
        if (row.parent_disposition_event_id !== state.latest?.event_id ||
            anchorConsumed(row.parent_disposition_event_id)) continue;
        const accepted = state.latest.finding_dispositions.accepted;
        const followupIds = state.latest.finding_dispositions.followup.map((entry) => entry.id);
        triggerOk = state.terminal === "STOP"
          ? same([...row.trigger_ids].sort(), [...accepted].sort())
          : state.terminal === "GO"
            ? row.trigger_ids.every((id) => followupIds.includes(id))
            : [...accepted, ...undisposedGround].every((id) => row.trigger_ids.includes(id)) &&
              row.trigger_ids.every((id) => accepted.includes(id) || followupIds.includes(id) ||
                undisposedGround.includes(id));
      } else {
        // The WINNING-OPEN anchor: only a CLOSED parent with NO disposition and a COLLECTED
        // panel — the reserving case whose reservation previously had NO constructible exit
        // (the anchor demanded a disposition id that does not exist — a measured brick). It mirrors
        // the close event's own anchor rule, and the successor inherits the un-adjudicated
        // GROUND: the union of the collected panels' raw finding ids.
        if (state.terminal !== "CLOSED" || state.latest !== null || !state.panels_close.length ||
            !parentOpen || row.parent_panel_open_event_id !== parentOpen.event_id ||
            anchorConsumed(row.parent_panel_open_event_id)) continue;
        const ground = [...new Set(state.panels_close.flatMap((close) =>
          close.received_seats.flatMap((seat) => seat.raw_finding_ids)))];
        triggerOk = same([...row.trigger_ids].sort(), ground.sort());
      }
      if (!triggerOk) continue;
      // The successor binds the exact parent terminal candidate — lineage anchored to bytes, not
      // only to an event id.
      if (!parentOpen || row.parent_frozen_commit !== parentOpen.frozen_commit ||
          row.parent_frozen_tree !== parentOpen.frozen_tree) continue;
      const countOk = row.continuation_kind === "split"
        ? row.children.length >= 2 && row.children.length <= 8 : row.children.length === 1;
      if (!countOk || !row.children.every(aggregateChildShape)) continue;
      // NO LOWER BASELINE: a child never declares a tier below the parent's — the successor
      // inherits the absolute cadence, it does not restart below it.
      const tierRank = { T2: 2, T3: 3 };
      const parentTier = Math.max(0, ...state.panels_open.map((open) => tierRank[open.tier] ?? 0));
      if (!row.children.every((child) => (tierRank[child.tier] ?? 0) >= parentTier)) continue;
      const childTasks = row.children.map((child) => child.task_id);
      const childChangesets = row.children.map((child) => child.changeset_id);
      const childPaths = row.children.flatMap((child) => child.authorized_paths);
      if (new Set(childTasks).size !== childTasks.length || new Set(childChangesets).size !== childChangesets.length ||
          new Set(childPaths).size !== childPaths.length ||
          childTasks.some((id) => usedTasks.has(id) || stdTaskUsed(id, rowSeq) || childLineage.has(id)) ||
          childChangesets.some((id) => usedChangesets.has(id) || stdChangesetUsed(id, rowSeq) ||
            lineageChangesetUsed(id)) ||
          // Two PENDING budgets overlapping would deadlock both children (each blocks the
          // other's open forever) — refuse the collision at declaration, where it is cheap.
          row.children.some((child) => pendingLineageOverlap(child.authorized_paths, child.task_id)) ||
          // A pending budget over a LIVE program's bound surface wedges the victim's own
          // disposition and next open with a generic conflict, composing to a mutual brick (the
          // measured in both directions) — the same refuse-at-declaration courtesy,
          // pending-vs-active.
          row.children.some((child) => activePathOverlap(child.authorized_paths, row.task_id, rowSeq)) ||
          // …and pending-vs-STOPPED: a budget over another program's un-lifted reservation would
          // permanently destroy that reservation's sole lineage exit (a measured defect). The
          // exception is the declarer's own NON-GO lineage chain — a STOP/CLOSED lineage
          // declares over its own and its non-GO ancestors' reservations (its anchors carry the
          // harm context down), while a GO node ENDS its lineage's claim: the GO-hop springboard
          // refuses at declaration, and the reserving ancestor's own re-openable anchor is the
          // only door, carrying its accepted set exactly.
          row.children.some((child) => stoppedPathOverlap(child.authorized_paths, declarationExceptions(row.task_id)))) continue;
      const continuation = accept(row); continuations.set(row.event_id, continuation);
      parentContinuations.set(row.parent_disposition_event_id ?? row.parent_panel_open_event_id, row);
      for (const child of row.children) {
        childLineage.set(child.task_id, { ...child, event_id: row.event_id, parent_task_id: row.task_id });
      }
    } else if (row.kind === "legacy_handoff") {
      if (!text(row.parent_task_id, 120) || !text(row.parent_changeset_id, 120) ||
          !text(row.owner_evidence, 1000) || !aggregateChildShape(row.child) ||
          legacyHandedOff.has(row.parent_task_id) || usedTasks.has(row.child.task_id) ||
          stdTaskUsed(row.child.task_id, rowSeq) || childLineage.has(row.child.task_id) ||
          usedChangesets.has(row.child.changeset_id) || stdChangesetUsed(row.child.changeset_id, rowSeq) ||
          lineageChangesetUsed(row.child.changeset_id) ||
          pendingLineageOverlap(row.child.authorized_paths, row.child.task_id)) continue;
      // Bound to the WINNING standard disposition AS OF THIS ROW'S LEDGER POSITION — never an
      // arbitrary historical prefix, and never rows that landed after it. The binding is the
      // LATEST ROUND row visible at the handoff's seq: a stale citation refuses because a newer
      // round preceding the handoff makes `latest` a different row, while a standard row appended
      // AFTER the handoff — an Owner close of the emptied program, or an out-of-band forgery —
      // can never retroactively unmake the child's lineage, because it is not in the handoff's
      // prefix. ACTIVENESS is likewise enforced at record time only (`recordAggregateLegacyHandoff`
      // refuses an inactive parent). New standard rounds cannot legally follow a handoff (minting
      // is retired; the handed-off task's writes refuse), and a hand-forged authority chain
      // appended out-of-band is the ledger's standing records-not-deters bound.
      const standard = getStandard(row.parent_task_id, rowSeq);
      // ACTIVENESS binds at the handoff's own position now, not only at record time: the as-of
      // ordering makes it safe (a post-handoff close is invisible to this prefix), and without
      // it a planted hash-valid row citing an INACTIVE parent minted lineage (a measured defect). A
      // pending child budget over a live program's surface refuses here for the same reason it
      // does at a continuation declaration.
      if (!standard?.ok || !standard.active || standard.changeset_id !== row.parent_changeset_id ||
          activePathOverlap(row.child.authorized_paths, row.parent_task_id, rowSeq) ||
          stoppedPathOverlap(row.child.authorized_paths) ||
          standard.latest?.event_id !== row.parent_disposition_event_id ||
          standard.latest.round !== row.parent_round || row.parent_candidate_sha !== standard.latest.candidate_sha ||
          !same(row.authorized_paths, standard.latest.authorized_paths) ||
          !same(row.child.authorized_paths, row.authorized_paths)) continue;
      const handoff = accept(row); legacyHandedOff.add(row.parent_task_id);
      childLineage.set(row.child.task_id, { ...row.child, event_id: row.event_id, parent_task_id: row.parent_task_id });
      continuations.set(row.event_id, handoff);
    }
  }
  return poisoned ? null : { programs, accepted, continuations, childLineage, legacyHandedOff };
}

export function deriveAggregateRepairState(events, taskId, { standardEvents = [] } = {}) {
  if (!text(taskId, 120)) return { ok: false, state: "repair-history-invalid" };
  const world = aggregateWorld(events, standardEvents);
  if (!world) return { ok: false, state: "repair-history-invalid" };
  return world.programs.get(taskId) || { ok: true, task_id: taskId, changeset_id: null, tier: null,
    panels_open: [], panels_close: [], dispositions: [], root_exits: [], dispatches: [],
    workers: [], worker_handoffs: [], closes: [], latest: null, active_dispatch: null, active_worker: null,
    terminal: null, active: false, authorized_paths: [], stopped_paths: [], lineage_event_id: null };
}

// The PENDING lineage budgets — declared children whose programs do not exist yet. A diagnosis
// surface, never authority: the world's own replay enforces the holds; this names them.
export function derivePendingLineageBudgets(events, { standardEvents = [] } = {}) {
  const world = aggregateWorld(events, standardEvents);
  if (!world) return null;
  return [...world.childLineage.values()].filter((lineage) => !world.programs.has(lineage.task_id))
    .map((lineage) => ({ task_id: lineage.task_id, parent_task_id: lineage.parent_task_id,
      authorized_paths: [...lineage.authorized_paths] }));
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

function transitionWinner(events, event, key, eligible = null) {
  return events.find((row) => row.event.type === event.type && row.event.task_id === event.task_id &&
    row.event.changeset_id === event.changeset_id && key(row.event) === key(event) &&
    (!eligible || eligible(row))) || null;
}

function finishExclusiveTransition(file, appended, event, key, equivalent, conflictState, eligible = null) {
  if (!appended.ok) return appended;
  const after = readRepairEventsSettled(file);
  if (after === null) return { ok: false, state: "repair-ledger-unavailable" };
  // The SAME eligibility the pre-check used. Adjudicating the winner without it would re-admit the
  // row the pre-check just ruled out, and the caller would read a conflict against an event that
  // was never authority in the first place.
  const winner = transitionWinner(after, event, key, eligible);
  if (!winner) return { ok: false, state: "repair-ledger-unavailable" };
  if (winner.event_id === appended.event_id) return appended;
  return equivalent(winner.event, event)
    ? { ok: true, event_id: winner.event_id, idempotent: true }
    : { ok: false, state: conflictState, winner_event_id: winner.event_id };
}

// Replay helper for stored standard histories only. New programs use aggregate-v2's positional
// R3 root/split boundary; this preserves the old rows' declared early-root triggers without
// reopening the retired standard minting path.
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

function sameAggregateDispatch(a, b) {
  return a?.kind === "dispatch" && b?.kind === "dispatch" && a.task_id === b.task_id &&
    a.changeset_id === b.changeset_id && a.disposition_event_id === b.disposition_event_id &&
    a.panel_close_event_id === b.panel_close_event_id && a.source_round === b.source_round &&
    a.next_round === b.next_round && same(a.authorized_paths, b.authorized_paths) &&
    a.root_exit_event_id === b.root_exit_event_id && a.target_kind === b.target_kind &&
    a.target === b.target && a.brief_sha256 === b.brief_sha256 && a.brief_size === b.brief_size;
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
  // STORED-HISTORY REPLAY ONLY. New standard rounds are retired; the live cadence is the
  // aggregate controller's, which WALLS the count mechanically — four rounds, three batches, one
  // terminal bookend. What survives here is replay integrity for pre-existing programs: a root
  // exit is owed once a MECHANICAL trigger fired, sequence and exact-reference binding hold, and
  // refreeze invalidation stands. Nothing in this function decides how long a LIVE ladder runs —
  // the aggregate grammar does, by refusing a fifth round outright.
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
      // CLOSE authorizations are deliberately exempt from the first-wins transition key. Whether one
      // carries authority depends on the admitted worker sessions, which are not all known until
      // this loop ends — so keying the slot here would let the FIRST row take it and an
      // unauthorized row could then squat the exit for that round permanently. They are all kept;
      // the post-pass below picks the first ELIGIBLE one. `rounds` and `scope` keep first-wins,
      // because nothing about their validity depends on rows that come later.
      if (row.authority_kind === "close") { extensions.push(row); continue; }
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
      // A close names the round it ends and the close-authorization row it rests on. Both are exact
      // references, which is the only kind of authority this module has ever accepted.
      // SHAPE only. Whether this close is ELIGIBLE (the term is defined once, at the post-pass
      // below) is decided AFTER the loop, once every worker admission in the ledger is known — and
      // an ineligible close is INERT rather than history-breaking, because a row anyone can append
      // must never be able to brick a repo.
      const at = verdicts.find((v) => v.round === row.after_round);
      if (!at || row.candidate_sha !== at.candidate_sha || !text(row.reason, 1000) ||
          !/^[0-9a-f]{64}$/.test(row.owner_close_event_id || "")) {
        return { ok: false, state: "repair-history-invalid" };
      }
      // Kept unkeyed for the same reason as the authorization above: eligibility is not knowable
      // until every worker admission has been read, so first-wins here would let an ineligible row
      // take the slot. First ELIGIBLE wins, decided below.
      closes.push(row);
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
  // ⚠ ELIGIBLE CLOSE — THE ONE DEFINITION. Every other surface in this kit points at this term
  // instead of restating it, because four review rounds were spent on surfaces that each spelled
  // the idea slightly stronger than the code.
  //
  // A close is ELIGIBLE when it names a `close`-kind `owner_extension` at the same round and
  // candidate, and NEITHER row carries a session id the program has admitted as a worker. That is
  // the whole test. It compares SESSION IDS, which are supplied by the caller — so it refuses the
  // admitted id, never the actor behind it, and it is not Owner attribution. See the residual block
  // above `recordRepairClose`.
  //
  // Decided in one post-pass against every admission in the ledger, so pre-minting before verifying
  // as a worker gains nothing. An INELIGIBLE close is INERT: it neither ends the program nor
  // invalidates the history, and it does not consume the round's slot, so an eligible one can still
  // be recorded. (Failing it closed here would hand any caller a fresh lockout: append one bogus
  // row and the exit is sealed. That is the defect this event exists to remove.)
  const admittedSessions = new Set(workerVerifications.map((row) => row.worker_session_id));
  const authorizedClose = (candidate) => {
    if (!candidate || admittedSessions.has(candidate.session_id)) return null;
    const authorization = extensions.find((e) => e.event_id === candidate.owner_close_event_id &&
      e.authority_kind === "close" && e.after_round === candidate.after_round &&
      e.candidate_sha === candidate.candidate_sha && !admittedSessions.has(e.session_id));
    return authorization ? candidate : null;
  };
  // A program is ACTIVE — and so owns writes — only while a repair is actually authorized: the
  // latest verdict is NO-GO, its disposition is REMEDIATE, and no ELIGIBLE close has ended it. A
  // NO-GO dispositioned DEFER/DECLINE/ESCALATE/NOTE authorizes no repair, mints no brief, and binds
  // no worker, so there is nothing for it to hold open.
  // FIRST eligible close wins, matching every other transition in this file: an ELIGIBLE close
  // cannot be superseded by a later one, and an ineligible one cannot displace it.
  const close = latest
    ? closes.filter((e) => e.after_round === latest.round).map(authorizedClose).find(Boolean) || null
    : null;
  const active = Boolean(latest && latest.verdict === "NO-GO" && latest.disposition === "REMEDIATE" && !close);
  return { ok: true, task_id: taskId, changeset_id: changesetId, verdicts, latest, trigger_round: triggerRound,
    root_cause_required: triggerRound > 0 && !rootExit, root_exit: rootExit, audit, round_extension: roundExtension,
    scope_extension: scopeExtension, dispatches, worker_verifications: workerVerifications,
    close, active, exits, audits, extensions, closes };
}

function controllerRows(file) {
  const all = readRepairLedgerRowsSettled(file);
  if (all === null) return null;
  return { all, standard: all.filter((row) => EVENT_TYPES.has(row.event.type)),
    aggregate: all.filter((row) => row.event.type === AGGREGATE_EVENT_TYPE) };
}

function appendEligibleAggregate(file, rawEvent, conflictState = "aggregate-transition-conflict") {
  // Normalized at the boundary: what is HASHED is exactly what is WRITTEN (see jsonNormalize).
  const event = jsonNormalize(rawEvent);
  if (!event || !validAggregateEnvelope(event)) {
    // One spelling per kind: the recorder's pre-checks and this derived name must agree, or a
    // caller greps for a state that exists in two forms (R4 note).
    const kindName = rawEvent?.kind === "child_continuation" ? "continuation"
      : String(rawEvent?.kind ?? "event").replace(/_/g, "-");
    return { ok: false, state: `aggregate-${kindName}-malformed` };
  }
  const before = controllerRows(file);
  if (!before) return { ok: false, state: "repair-ledger-unavailable" };
  if (aggregateWorld(before.aggregate, before.standard) === null &&
      (before.aggregate.length || before.standard.length)) {
    // A POISONED world is a ledger-integrity fault, not a transition conflict — the operator
    // needs row-level repair guidance, not a retry.
    return { ok: false, state: "repair-history-invalid" };
  }
  const id = eventId(event);
  // A RETRY differing only in its timestamp (a caller that died between write and read-back and
  // re-recorded) is the SAME transition — return the standing winner idempotently rather than a
  // conflict no caller can interpret.
  const logicalTwin = (candidateRow) => {
    if (candidateRow.event.kind !== event.kind) return false;
    const a = { ...candidateRow.event, recorded_at: null };
    const b = { ...event, recorded_at: null };
    return same(a, b);
  };
  const priorWorld = aggregateWorld(before.aggregate, before.standard);
  const priorTwin = before.aggregate.find((candidateRow) => priorWorld?.accepted.has(candidateRow.event_id) && logicalTwin(candidateRow));
  if (priorTwin) return { ok: true, event_id: priorTwin.event_id, idempotent: true };
  const candidate = { event_id: id, event };
  const prospective = aggregateWorld([...before.aggregate, candidate], before.standard);
  if (!prospective?.accepted.has(id)) return { ok: false, state: conflictState };
  const appended = appendAggregateEvent(file, event);
  if (!appended.ok) return appended;
  const after = controllerRows(file);
  const world = after && aggregateWorld(after.aggregate, after.standard);
  if (world?.accepted.has(id)) return { ok: true, event_id: id, idempotent: appended.idempotent };
  const winner = after?.aggregate.find((candidateRow) => world?.accepted.has(candidateRow.event_id) && logicalTwin(candidateRow));
  return winner ? { ok: true, event_id: winner.event_id, idempotent: true } : { ok: false, state: conflictState };
}

export function recordAggregatePanelOpen(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  // The clean-candidate check brackets the evidence capture: BEFORE proves the caller stands at the
  // declared freeze when capture starts, AFTER proves nothing moved under it while it ran. The
  // evidence itself is commit-addressed (see panelGitEvidence), so the bracket closes the one
  // remaining seam — a caller not actually at the bytes its seats are about to read.
  const candidate = base && cleanGitCandidate(projectRoot, input.frozen_commit, input.frozen_tree, { execGit });
  const evidence = candidate && panelGitEvidence(projectRoot, input.base_ref, input.base_commit, candidate.commit, { execGit });
  const still = evidence && cleanGitCandidate(projectRoot, input.frozen_commit, input.frozen_tree, { execGit });
  if (!base || !candidate || !evidence || !still ||
      !expectedPanelShape(input.tier, input.expected_seats, evidence.changed_paths)) {
    // One state, ~12 causes: `detail` names the failed precondition CLASS so the operator starts
    // at the right one instead of rederiving the whole chain from a bare state string.
    const detail = !base ? "event envelope/base fields (task, changeset, session, shape)"
      : !candidate ? "clean-candidate check: the working tree is not at the declared frozen commit/tree, or is dirty"
      : !evidence ? "git evidence capture: the base ref/commit did not resolve, or the base..frozen diff failed or exceeded bounds"
      : !still ? "post-capture recheck: the working tree MOVED while evidence was being captured"
      : "expected-seat roster shape: tier floors (4-12 seats, free seat at full coverage, angle roles, one external, two distinct family values)";
    return { ok: false, state: "aggregate-panel-open-malformed", detail };
  }
  const event = { ...base, kind: "panel_open", round: input.round, phase: input.phase, tier: input.tier,
    frozen_commit: candidate.commit, frozen_tree: candidate.tree, ...evidence,
    expected_seats: input.expected_seats,
    incoming_dispatch_event_id: input.incoming_dispatch_event_id ?? null,
    incoming_worker_event_id: input.incoming_worker_event_id ?? null,
    child_continuation_event_id: input.child_continuation_event_id ?? null,
    legacy_handoff_event_id: input.legacy_handoff_event_id ?? null };
  const file = repairLedgerPath(projectRoot, { execGit });
  const result = appendEligibleAggregate(file, event, "aggregate-panel-open-conflict");
  if (result.ok || result.state !== "aggregate-panel-open-conflict") return result;
  // The conflict state collapses ~15 mechanical causes into one string; the two an honest caller
  // hits most get their own names so the refusal is diagnosable without reading the derivation.
  const rows = controllerRows(file);
  const state = rows && deriveAggregateRepairState(rows.aggregate, input.task_id, { standardEvents: rows.standard });
  if (state?.ok && state.terminal) return { ok: false, state: "aggregate-terminal", terminal: state.terminal };
  if (state?.ok && state.latest?.terminal_state === "CONTINUE" && state.active_dispatch && !state.active_worker) {
    return { ok: false, state: "aggregate-worker-required", dispatch_event_id: state.active_dispatch.event_id };
  }
  // A refusal caused by a PENDING lineage budget was undiagnosable — the victim met a generic
  // conflict naming nothing (a measured defect). Name the holder; the refusal itself stays the world's.
  const pending = rows && derivePendingLineageBudgets(rows.aggregate, { standardEvents: rows.standard });
  // Matched against the DERIVED changed paths — a roster's seat order is legal input, and the
  // seat-0 proxy returned the bare conflict for any roster not free-seat-first (measured: the
  // earlier cure was conditionally inert).
  const holder = pending?.find((entry) => entry.task_id !== input.task_id &&
    entry.authorized_paths.some((entry2) => (evidence?.changed_paths ?? []).includes(entry2)));
  if (holder) {
    return { ...result, detail: `a PENDING lineage child (${holder.task_id}, parent ${holder.parent_task_id}) holds a declared budget over these paths until it opens` };
  }
  // The base pin's refusal was BARE — the panel that accepted the pin also executed its failure
  // mode: a rebased/merged lane refuses with a generic conflict and no stated exit.
  const firstOpen = state?.ok ? state.panels_open[0] : null;
  if (firstOpen && (input.base_ref !== firstOpen.base_ref || input.base_commit !== firstOpen.base_commit)) {
    return { ...result, detail: `this changeset's base is pinned to round 1's (${firstOpen.base_ref} @ ${String(firstOpen.base_commit).slice(0, 12)}…): a rebased or merged lane is a NEW candidate lineage — continue on the original base, or close and declare a successor` };
  }
  return result;
}

export function recordAggregatePanelClose(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const file = repairLedgerPath(projectRoot, { execGit });
  const rows = controllerRows(file);
  const open = rows?.aggregate.find((row) => row.event_id === input?.panel_open_event_id)?.event;
  const candidate = open && cleanGitCandidate(projectRoot, open.frozen_commit, open.frozen_tree, { execGit });
  const evidence = open && panelGitEvidence(projectRoot, open.base_ref, open.base_commit, open.frozen_commit,
    { execGit, anchorToRef: false });
  const still = evidence && cleanGitCandidate(projectRoot, open.frozen_commit, open.frozen_tree, { execGit });
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base || !open || !candidate || !evidence || !still || !same(evidence.changed_paths, open.changed_paths) ||
      !Array.isArray(input.received_seats)) return { ok: false, state: "aggregate-panel-close-malformed" };
  const event = { ...base, kind: "panel_close", panel_open_event_id: input.panel_open_event_id,
    received_seats: input.received_seats };
  return appendEligibleAggregate(file, event, "aggregate-panel-close-conflict");
}

export function recordAggregateDisposition(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const file = repairLedgerPath(projectRoot, { execGit });
  const rows = controllerRows(file);
  const close = rows?.aggregate.find((row) => row.event_id === input?.panel_close_event_id)?.event;
  const open = close && rows.aggregate.find((row) => row.event_id === close.panel_open_event_id)?.event;
  const candidate = open && cleanGitCandidate(projectRoot, open.frozen_commit, open.frozen_tree, { execGit });
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base || !close || !open || !candidate || !pmFindingsShape(input.pm_findings ?? []) ||
      !plain(input.finding_dispositions) || !Array.isArray(input.authorized_paths)) {
    return { ok: false, state: "aggregate-disposition-malformed" };
  }
  const event = { ...base, kind: "disposition", panel_close_event_id: input.panel_close_event_id,
    pm_findings: input.pm_findings ?? [],
    finding_dispositions: input.finding_dispositions,
    terminal_state: input.terminal_state, remediation_kind: input.remediation_kind ?? null,
    authorized_paths: [...input.authorized_paths] };
  return appendEligibleAggregate(file, event, "aggregate-disposition-conflict");
}

export function recordAggregateRootExit(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base || !Array.isArray(input.removed_workarounds) || !Array.isArray(input.trigger_matrix)) {
    return { ok: false, state: "aggregate-root-exit-malformed" };
  }
  const event = { ...base, kind: "root_exit", disposition_event_id: input.disposition_event_id,
    shared_mechanism: input.shared_mechanism, symptom_explanation: input.symptom_explanation,
    owner_state_yield_seams: input.owner_state_yield_seams,
    replacement: input.replacement,
    removed_workarounds: input.removed_workarounds,
    trigger_matrix: input.trigger_matrix };
  return appendEligibleAggregate(repairLedgerPath(projectRoot, { execGit }), event,
    "aggregate-root-exit-conflict");
}

export function recordAggregateWorkerHandoff(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base) return { ok: false, state: "aggregate-worker-handoff-malformed" };
  const event = { ...base, kind: "worker_handoff", dispatch_event_id: input.dispatch_event_id,
    prior_worker_event_id: input.prior_worker_event_id, new_worker_session_id: input.new_worker_session_id,
    owner_evidence: input.owner_evidence };
  return appendEligibleAggregate(repairLedgerPath(projectRoot, { execGit }), event,
    "aggregate-worker-handoff-conflict");
}

export function recordAggregateChildContinuation(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base || !Array.isArray(input.trigger_ids) || !Array.isArray(input.children) ||
      !input.children.every(aggregateChildShape)) {
    return { ok: false, state: "aggregate-continuation-malformed" };
  }
  // The parent terminal candidate is DERIVED, never caller-supplied — callers do not mint
  // trusted pointers.
  const file = repairLedgerPath(projectRoot, { execGit });
  const rows = controllerRows(file);
  if (!rows) return { ok: false, state: "repair-ledger-unavailable" };
  const state = deriveAggregateRepairState(rows.aggregate, input.task_id, { standardEvents: rows.standard });
  const parentOpen = state.ok ? (state.panels_open ?? []).at(-1) : null;
  if (!parentOpen) return { ok: false, state: "aggregate-continuation-malformed" };
  // The anchor is derived from the parent's actual terminal shape: its latest disposition, or —
  // for a no-disposition CLOSED parent whose panel was collected — its winning panel_open. The
  // caller's own citation is accepted only when it matches the derived truth (replay re-checks).
  const anchor = state.latest
    ? { parent_disposition_event_id: input.parent_disposition_event_id }
    : { parent_disposition_event_id: null, parent_panel_open_event_id: parentOpen.event_id };
  const event = { ...base, kind: "child_continuation", ...anchor,
    parent_frozen_commit: parentOpen.frozen_commit, parent_frozen_tree: parentOpen.frozen_tree,
    trigger_ids: input.trigger_ids,
    continuation_kind: input.continuation_kind, children: input.children,
    owner_evidence: input.owner_evidence };
  return appendEligibleAggregate(file, event, "aggregate-continuation-conflict");
}

export function recordAggregateClose(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base || !text(input.reason, 1000) || !text(input.owner_evidence, 1000)) {
    return { ok: false, state: "aggregate-close-malformed" };
  }
  const file = repairLedgerPath(projectRoot, { execGit });
  const rows = controllerRows(file);
  if (!rows) return { ok: false, state: "repair-ledger-unavailable" };
  const state = deriveAggregateRepairState(rows.aggregate, input.task_id, { standardEvents: rows.standard });
  if (state.ok) {
    const admitted = new Set([
      ...(state.workers ?? []).map((worker) => worker.worker_session_id),
      ...(state.worker_handoffs ?? []).map((handoff) => handoff.new_worker_session_id),
    ]);
    // Named at record time so the refusal is diagnosable; the derivation enforces it regardless.
    if (admitted.has(sessionId)) return { ok: false, state: "aggregate-close-self-authorized" };
  }
  const event = { ...base, kind: "close",
    disposition_event_id: input.disposition_event_id ?? null,
    ...(input.panel_open_event_id !== undefined ? { panel_open_event_id: input.panel_open_event_id } : {}),
    reason: input.reason, owner_evidence: input.owner_evidence };
  return appendEligibleAggregate(file, event, "aggregate-close-conflict");
}

export function recordAggregateLegacyHandoff(input,
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  const file = repairLedgerPath(projectRoot, { execGit });
  const rows = controllerRows(file);
  if (!rows) return { ok: false, state: "repair-ledger-unavailable" };
  const parent = deriveRepairState(rows.standard, input?.parent_task_id);
  const base = baseEvent(AGGREGATE_EVENT_TYPE, input, sessionId, now);
  if (!base || !parent.ok || !parent.active || !parent.latest ||
      !Array.isArray(input.authorized_paths) || !plain(input.child)) {
    return { ok: false, state: "aggregate-legacy-handoff-malformed" };
  }
  const event = { ...base, kind: "legacy_handoff", parent_task_id: input.parent_task_id,
    parent_changeset_id: input.parent_changeset_id, parent_candidate_sha: input.parent_candidate_sha,
    parent_disposition_event_id: parent.latest.event_id, parent_round: parent.latest.round,
    authorized_paths: structuredClone(input.authorized_paths), child: structuredClone(input.child),
    owner_evidence: input.owner_evidence };
  return appendEligibleAggregate(file, event, "aggregate-legacy-handoff-conflict");
}

export function recordAggregateEvent(input, options = {}) {
  if (input?.type !== AGGREGATE_EVENT_TYPE) return { ok: false, state: "repair-event-type-unsupported" };
  return ({
    panel_open: recordAggregatePanelOpen,
    panel_close: recordAggregatePanelClose,
    disposition: recordAggregateDisposition,
    root_exit: recordAggregateRootExit,
    worker_handoff: recordAggregateWorkerHandoff,
    child_continuation: recordAggregateChildContinuation,
    legacy_handoff: recordAggregateLegacyHandoff,
    close: recordAggregateClose,
  }[input.kind] || (() => ({ ok: false, state: "repair-event-type-unsupported" })))(input, options);
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
  return { ok: false, state: "standard-mint-retired" };
}

export function recordRootCauseExit(_input, { sessionId } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  return { ok: false, state: "standard-mint-retired" };
}

export function recordAdherenceAudit(_input, { sessionId } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  return { ok: false, state: "standard-mint-retired" };
}

export function recordOwnerExtension(input, { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  if (input?.authority_kind !== "close") return { ok: false, state: "standard-mint-retired" };
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
  const admitted = new Set(state.worker_verifications.map((row) => row.worker_session_id));
  if (input.authority_kind === "close" && admitted.has(sessionId)) {
    return { ok: false, state: "repair-close-self-authorized" };
  }
  const key = (e) => `${e.after_round}:${e.authority_kind}`;
  const equivalent = (a, b) => a.candidate_sha === b.candidate_sha && a.owner_evidence === b.owner_evidence &&
    same(a.added_paths, b.added_paths);
  // First-wins is per (round, kind) — but a CLOSE authorization recorded by a session the program
  // has admitted as a worker carries no authority, so it must not win the slot either. Letting it
  // would turn one appended row into a permanent seal on the exit: the very lockout shape being
  // removed, rebuilt on the way out.
  const eligible = input.authority_kind === "close" ? (row) => !admitted.has(row.event.session_id) : null;
  const prior = transitionWinner(events, event, key, eligible);
  if (prior) return equivalent(prior.event, event)
    ? { ok: true, event_id: prior.event_id, idempotent: true }
    : { ok: false, state: "repair-owner-extension-conflict", winner_event_id: prior.event_id };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event, key, equivalent, "repair-owner-extension-conflict", eligible);
}

/**
 * End an authorized repair program IN BAND. Without this the only exit from an abandoned REMEDIATE
 * program was deleting the ledger — destroying every round's history to unblock one write.
 *
 * It requires an ELIGIBLE CLOSE — the term is defined in one place, at the post-pass in
 * `deriveRepairState`, and this comment deliberately does not restate its conditions. Releasing a
 * program also releases its global path ownership, and the party most motivated to release it is
 * the one the program constrains, which is what that test is shaped around.
 *
 * ⚠ THE RESIDUAL, NAMED — read this before relying on that check. `session_id` is SUPPLIED BY THE
 * CALLER (`scripts/record-repair-event.mjs` takes it from the input or the environment), so an
 * admitted worker that passes a NAME IT HAS NOT USED BEFORE satisfies both checks and closes the
 * program constraining it. Two cold review seats walked exactly that sequence. So the check stops
 * the LITERAL case — a session releasing itself, which is what a careless agent actually does — and
 * stops nothing that picks a new string. It is not an authorization boundary and this comment will
 * not call it one: THE LEDGER RECORDS; IT DOES NOT DETER, the sentence the nonce trail already
 * applies to itself.
 *
 * The comparison that decides whether this event belongs here is not close-versus-perfect-authority,
 * it is close-versus-the-alternative. Before it, an abandoned repair could be escaped only by
 * DELETING the ledger — available to the same caller, needing no alias, and destroying every round
 * of history on the way out. A forged close leaves a row naming the round, the reason, and the
 * authorization it claims to rest on, and it leaves the rest of the history standing.
 *
 * Be exact about what that is worth, because the obvious overstatement is wrong: it does NOT make an
 * improper release DETECTABLE. An alias can be any string — `owner-approver` reads as credible — and
 * nothing in the ledger ties it back to the admitted worker. What survives is an unauthenticated
 * CLAIM plus the surrounding history, which is better for recovery and for audit than a deleted
 * file, and is not evidence of who did it. That, and nothing more, is the claim.
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
  const admitted = new Set(state.worker_verifications.map((row) => row.worker_session_id));
  if (admitted.has(authorization.session_id) || admitted.has(sessionId)) {
    return { ok: false, state: "repair-close-self-authorized" };
  }
  const event = { ...base, after_round: input.after_round, candidate_sha: state.latest.candidate_sha,
    reason: input.reason, owner_close_event_id: input.owner_close_event_id };
  const key = (e) => String(e.after_round);
  const equivalent = (a, b) => a.candidate_sha === b.candidate_sha && a.reason === b.reason &&
    a.owner_close_event_id === b.owner_close_event_id;
  // A close row that carries no authority does not win the slot either — same reason as the
  // authorization above. Otherwise one hand-appended row seals the exit for that round, which is
  // the lockout being removed, rebuilt one layer down.
  const eligible = (row) => !admitted.has(row.event.session_id) && state.extensions.some((e) =>
    e.event_id === row.event.owner_close_event_id && e.authority_kind === "close" &&
    !admitted.has(e.session_id));
  const prior = transitionWinner(events, event, key, eligible);
  if (prior) return equivalent(prior.event, event)
    ? { ok: true, event_id: prior.event_id, idempotent: true }
    : { ok: false, state: "repair-close-conflict", winner_event_id: prior.event_id };
  const appended = appendRepairEvent(file, event);
  return finishExclusiveTransition(file, appended, event, key, equivalent, "repair-close-conflict", eligible);
}

export function validateAggregateDispatch(declaration,
  { aggregateEvents, standardEvents = [], taskId, targetKind, target }) {
  if (!plain(declaration) || declaration.aggregate_controller !== AGGREGATE_EVENT_TYPE ||
      declaration.task_id !== taskId || !text(declaration.changeset_id, 120) ||
      !ID64.test(declaration.disposition_event_id || "") || !ID64.test(declaration.panel_close_event_id || "") ||
      !Number.isSafeInteger(declaration.next_round) || !Array.isArray(aggregateEvents)) {
    return { ok: false, state: "aggregate-dispatch-malformed" };
  }
  const state = deriveAggregateRepairState(aggregateEvents, taskId, { standardEvents });
  if (!state.ok) return { ok: false, state: state.state };
  const disposition = state.dispositions?.find((row) => row.event_id === declaration.disposition_event_id);
  if (!disposition || state.changeset_id !== declaration.changeset_id ||
      disposition.event_id !== state.latest?.event_id || disposition.terminal_state !== "CONTINUE" ||
      disposition.panel_close_event_id !== declaration.panel_close_event_id ||
      declaration.next_round !== disposition.round + 1 || targetKind !== "brief") {
    return { ok: false, state: "aggregate-dispatch-unavailable" };
  }
  if (["root_replacement", "simplification", "split"].includes(disposition.remediation_kind)) {
    const exit = state.root_exits.find((row) => row.event_id === declaration.root_exit_event_id &&
      row.disposition_event_id === disposition.event_id);
    if (!exit) return { ok: false, state: "aggregate-root-exit-required" };
  } else if (declaration.root_exit_event_id !== undefined && declaration.root_exit_event_id !== null) {
    return { ok: false, state: "aggregate-root-exit-unexpected" };
  }
  return { ok: true, state, repair: { ...declaration,
    source_round: disposition.round, authorized_paths: [...disposition.authorized_paths],
    root_exit_event_id: declaration.root_exit_event_id ?? null }, target_kind: targetKind, target };
}

export function validateRepairDispatch(declaration, { events, aggregateEvents = [], taskId, targetKind, target }) {
  if (declaration?.aggregate_controller === AGGREGATE_EVENT_TYPE) {
    return validateAggregateDispatch(declaration, {
      aggregateEvents, standardEvents: events, taskId, targetKind, target,
    });
  }
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
  return { ok: false, state: "standard-mint-retired" };
}

export function confirmRepairBrief({ declaration, brief_path: briefPath } = {},
  { projectRoot, sessionId, now = new Date().toISOString(), execGit } = {}) {
  if (!text(sessionId, 200)) return { ok: false, state: "repair-session-missing" };
  const file = repairLedgerPath(projectRoot, { execGit });
  const rows = controllerRows(file);
  if (!rows) return { ok: false, state: "repair-ledger-unavailable" };
  const current = rows.standard;
  const validated = validateRepairDispatch(declaration, {
    events: current, aggregateEvents: rows.aggregate,
    taskId: declaration?.task_id, targetKind: "brief", target: briefPath,
  });
  if (!validated.ok) return validated;
  const brief = readRegularRepoFile(projectRoot, briefPath);
  if (!brief) return { ok: false, state: "repair-brief-unconfirmed" };
  const r = validated.repair;
  if (declaration.aggregate_controller === AGGREGATE_EVENT_TYPE) {
    const base = baseEvent(AGGREGATE_EVENT_TYPE, declaration, sessionId, now);
    const event = { ...base, kind: "dispatch", disposition_event_id: r.disposition_event_id,
      panel_close_event_id: r.panel_close_event_id, source_round: r.source_round, next_round: r.next_round,
      authorized_paths: [...r.authorized_paths], root_exit_event_id: r.root_exit_event_id,
      target_kind: "brief", target: brief.path, brief_sha256: brief.sha256, brief_size: brief.size };
    const active = validated.state.active_dispatch;
    if (active) {
      return sameAggregateDispatch(active, event)
        ? { ok: true, event_id: active.event_id, idempotent: true }
        : { ok: false, state: "aggregate-dispatch-conflict", winner_event_id: active.event_id };
    }
    const appended = appendEligibleAggregate(file, event, "aggregate-dispatch-conflict");
    if (appended.ok) return appended;
    const after = controllerRows(file);
    const winner = after && deriveAggregateRepairState(after.aggregate, event.task_id, {
      standardEvents: after.standard,
    }).active_dispatch;
    return sameAggregateDispatch(winner, event)
      ? { ok: true, event_id: winner.event_id, idempotent: true }
      : appended;
  }
  // No standard-grammar append arm exists here: `validateRepairDispatch` never returns ok for a
  // standard declaration (minting is retired), so this line is unreachable for that path — the
  // dead append arm that once followed was removed rather than left as a false affordance.
  return { ok: false, state: "standard-mint-retired" };
}

export function verifyRepairBriefReceipt({ task_id: taskId, repair_dispatch_event_id: eventId } = {},
  { projectRoot, execGit } = {}) {
  if (!text(taskId, 120) || !/^[0-9a-f]{64}$/.test(eventId || "")) {
    return { ok: false, state: "repair-brief-receipt-missing" };
  }
  const loaded = loadRepairEventsForProject(projectRoot, { execGit });
  if (!loaded.ok) return loaded;
  const aggregateReceipt = loaded.aggregate_events.find((row) =>
    row.event_id === eventId && row.event.kind === "dispatch")?.event;
  if (aggregateReceipt) {
    const state = deriveAggregateRepairState(loaded.aggregate_events, taskId, { standardEvents: loaded.events });
    if (!state.ok || !state.dispatches.some((row) => row.event_id === eventId)) {
      return { ok: false, state: "repair-brief-receipt-missing" };
    }
    const receipt = { ...aggregateReceipt, event_id: eventId };
    const brief = readRegularRepoFile(projectRoot, receipt.target);
    if (!brief || brief.sha256 !== receipt.brief_sha256 || brief.size !== receipt.brief_size) {
      return { ok: false, state: "repair-brief-changed" };
    }
    return { ok: true, state: "repair-brief-confirmed", receipt, brief };
  }
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
  const receipt = verified.receipt;
  if (receipt.type === AGGREGATE_EVENT_TYPE && receipt.kind === "dispatch") {
    const rows = controllerRows(file);
    const state = rows && deriveAggregateRepairState(rows.aggregate, taskId, { standardEvents: rows.standard });
    // ORDER MATTERS. (1) The CURRENT admitted session — by worker row OR by handoff — repeats
    // idempotently. (2) A session that WAS admitted but was handed off is REVOKED: its old worker
    // row must not answer a stale success. (3) Only then does a plain prior-row lookup stand.
    if (state?.active_worker?.worker_session_id === sessionId &&
        state.active_dispatch?.event_id === eventId) {
      return { ok: true, event_id: state.active_worker.event_id, idempotent: true };
    }
    const superseded = state?.worker_handoffs?.some((handoff) => handoff.dispatch_event_id === eventId) &&
      state?.active_worker && state.active_worker.worker_session_id !== sessionId &&
      state.workers.some((row) => row.dispatch_event_id === eventId && row.worker_session_id === sessionId);
    if (superseded) return { ok: false, state: "aggregate-worker-superseded" };
    const prior = state?.workers.find((row) => row.dispatch_event_id === eventId &&
      row.worker_session_id === sessionId);
    if (prior) return { ok: true, event_id: prior.event_id, idempotent: true };
    const event = { type: AGGREGATE_EVENT_TYPE, kind: "worker", task_id: taskId,
      changeset_id: receipt.changeset_id, recorded_at: now, session_id: sessionId,
      dispatch_event_id: eventId, worker_session_id: sessionId,
      authorized_paths: [...receipt.authorized_paths], brief_path: receipt.target,
      brief_sha256: receipt.brief_sha256 };
    return appendEligibleAggregate(file, event, "aggregate-worker-conflict");
  }
  const prior = current.find((row) => row.event.type === "worker_verification" &&
    row.event.task_id === taskId && row.event.repair_dispatch_event_id === eventId &&
    row.event.worker_session_id === sessionId);
  if (prior) return { ok: true, event_id: prior.event_id, idempotent: true };
  return { ok: false, state: "standard-mint-retired" };
}

/**
 * Return every accepted, still-NO-GO repair program whose latest exact authorized-path set owns
 * `target`. Round-1 losers remain audit evidence but never become owners. This is deliberately
 * global: a task-lane relabel cannot make another active program's path look unrelated.
 */
export function activeRepairPathOwners(events, target, { aggregateEvents = [] } = {}) {
  if (!Array.isArray(events) || !strings([target], { paths: true, itemMax: 500 })) {
    return { ok: false, state: "repair-history-invalid", owners: [] };
  }
  const aggregate = aggregateWorld(aggregateEvents, events);
  if (!aggregate) return { ok: false, state: "repair-history-invalid", owners: [] };
  const identities = events.filter((row) => row?.event?.type === "round_disposition" && row.event.round === 1);
  const accepted = identities.filter((row) => identities.find((candidate) =>
    candidate.event.task_id === row.event.task_id || candidate.event.changeset_id === row.event.changeset_id) === row);
  const owners = [];
  for (const identity of accepted) {
    const state = deriveRepairState(events, identity.event.task_id);
    if (!state.ok) return { ok: false, state: state.state, owners: [] };
    if (state.active && !aggregate.legacyHandedOff.has(state.task_id) &&
        state.latest.authorized_paths.includes(target)) owners.push(state);
  }
  for (const state of aggregate.programs.values()) {
    if (state.active && state.authorized_paths.includes(target)) owners.push({ ...state,
      aggregate_controller: AGGREGATE_EVENT_TYPE });
  }
  return { ok: true, state: "repair-path-owners-derived", owners,
    handed_off_task_ids: [...aggregate.legacyHandedOff] };
}

export function verifyRepairWorkerWrite({ task_id: taskId, session_id: sessionId, target } = {},
  { projectRoot, execGit } = {}) {
  if (!strings([target], { paths: true, itemMax: 500 })) {
    return { ok: false, state: "repair-worker-path-unauthorized" };
  }
  const loaded = loadRepairEventsForProject(projectRoot, { execGit });
  if (!loaded.ok) return loaded;
  const ownership = activeRepairPathOwners(loaded.events, target, { aggregateEvents: loaded.aggregate_events });
  if (!ownership.ok) return ownership;
  if (ownership.handed_off_task_ids.includes(taskId)) {
    return { ok: false, state: "repair-program-handed-off" };
  }
  if (ownership.owners.length > 1) {
    return { ok: false, state: "repair-worker-path-owner-conflict",
      owner_task_ids: ownership.owners.map((owner) => owner.task_id) };
  }
  const owner = ownership.owners[0] || null;
  if (owner && owner.task_id !== taskId) {
    return { ok: false, state: "repair-task-relabel-path-owned", owner_task_id: owner.task_id };
  }
  if (!text(taskId, 120)) return { ok: true, state: "not-repair-write" };
  // RESOLVE THE ACTIVE AGGREGATE PROGRAM BY TASK FIRST. Ownership above is derived BY TARGET, so a
  // task whose active program authorizes only OTHER paths finds no owner here — and falling
  // through to the standard grammar answered `not-repair-write` for exactly the write the active
  // program does NOT authorize (the reproduced fail-open). An active program's write outside its
  // own authorized set REFUSES; it never falls through to legacy or non-repair behavior.
  const aggregateOwn = owner?.aggregate_controller === AGGREGATE_EVENT_TYPE
    ? owner
    : deriveAggregateRepairState(loaded.aggregate_events, taskId, { standardEvents: loaded.events });
  if (!aggregateOwn.ok) return aggregateOwn;
  if (aggregateOwn.active) {
    if (!text(sessionId, 200)) return { ok: false, state: "repair-worker-session-missing" };
    if (!aggregateOwn.active_dispatch || !aggregateOwn.active_worker ||
        aggregateOwn.active_worker.worker_session_id !== sessionId) {
      return { ok: false, state: "repair-worker-verification-missing" };
    }
    if (!aggregateOwn.authorized_paths.includes(target)) {
      return { ok: false, state: "repair-worker-path-unauthorized", authorized_paths: aggregateOwn.authorized_paths };
    }
    const verified = verifyRepairBriefReceipt({
      task_id: taskId, repair_dispatch_event_id: aggregateOwn.active_dispatch.event_id,
    }, { projectRoot, execGit });
    if (!verified.ok) return verified;
    return { ok: true, state: "repair-worker-write-authorized",
      admission: aggregateOwn.active_worker, receipt: verified.receipt };
  }
  const state = (owner && owner.aggregate_controller !== AGGREGATE_EVENT_TYPE)
    ? owner : deriveRepairState(loaded.events, taskId);
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
  const rows = file === null ? null : readRepairLedgerRowsSettled(file);
  if (rows !== null) return { ok: true, file,
    events: rows.filter((row) => EVENT_TYPES.has(row.event.type)),
    aggregate_events: rows.filter((row) => row.event.type === AGGREGATE_EVENT_TYPE) };
  // TWO different failures wearing one name until now. A ledger that exists and cannot be trusted
  // is a control that cannot READ ITS SUBJECT — deny. A tree in which this control's walk finds no
  // subject IT CAN SEE has nothing in view to enforce, so denying every write there is a pure
  // false positive. Both still fail; only the second may be relieved, and only by a consumer that
  // says out loud that it is BLIND — never one that claims nothing exists, which is more than any
  // walk can prove. `gitSubjectPresent` resolves every uncertainty toward "a subject may be
  // present", so the relief needs the walk to come up empty, not the world to be empty.
  const subject = file !== null || gitSubjectPresent(projectRoot, options);
  return { ok: false, state: subject ? "repair-ledger-unavailable" : "repair-ledger-no-subject",
    observed_overrides: gitLocationOverrides(options.env ?? process.env), events: null };
}
