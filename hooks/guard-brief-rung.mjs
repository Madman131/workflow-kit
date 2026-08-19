#!/usr/bin/env node
// .claude/hooks/guard-brief-rung.mjs — PreToolUse(Write|Edit|MultiEdit|NotebookEdit · apply_patch · *send_message).
//
// WHY THIS EXISTS: `.agents/skills/orchestrate/PROTOCOLS.md` — "the pre-send verification rung" says
// a load-bearing dispatch is verified BEFORE it is sent: every citation opened at its line, every
// number recomputed by execution. That is prose until a deterministic layer checks that the ritual
// ran. Two independent programs produced the same defect class — orchestrator text asserting numbers
// and citations it never executed, caught late every time by an expensive control, or by the Owner.
// A prompt is not a control; this hook is the control.
//
// WHAT IT ENFORCES (enforce, never classify — INVARIANTS rule 1): a dispatch in scope may proceed
// only when a verification sidecar (`.claude/brief-rung.json`) exists, is FRESH, names THIS session,
// names THIS dispatch, and carries at least one EXECUTED check (a command AND its captured output).
// Whether a dispatch is load-bearing is a SEMANTIC question this hook must not answer for its
// consumer, so it does not guess: a send may instead DECLARE itself a status message, and that
// declaration is ledgered for the Owner's spot-check. That is the `exempt` route's shape, and it
// carries the same honesty: a wrong classification is VISIBLE in the ledger, not proven false here.
//
// HONEST LIMITS — these are the control's, disclosed as part of it, and they do not soften with use:
//   · It proves a session- and dispatch-bound RECORD of checks EXISTS — not that the commands were
//     ever run, and not that they were the right ones. Nothing here executes a receipt or compares
//     it to reality, so a fabricated sidecar satisfies this guard. What it buys is a raised cost and
//     an auditable trace, never impossibility; sufficiency stays with the author and, for doctrine,
//     with the cold seats. The stronger claim — "it proves the ritual ran" — is the one this control
//     must not make about itself, being the exact over-claim class the rung exists to catch.
//   · It is TOOL-BOUND. A shell redirection writes a brief without ever reaching a PreToolUse hook,
//     and a shell source edit bypasses the worker-admission check below, the same accepted class as
//     every sibling guard here. `.githooks/pre-commit` remains the only every-lane floor, and it does
//     not bind dispatches or worker receipt authority.
//   · It is a TRIPWIRE, not a floor. Its purpose is to make an unverified dispatch visible at the
//     point it is attempted — not to make one impossible.
//   · CONSUMPTION'S RESIDUAL, named: a process killed AFTER its attempt row lands has BURNED that
//     nonce without dispatching anything. The cure is re-running the rung and writing a new nonce —
//     one ritual — which is strictly cheaper than the lockfile this replaced, where a crashed holder
//     left a file a human had to delete before ANY brief could be dispatched. Cheaper, still real,
//     and never hidden.
//   · THE ATOMICITY ASSUMPTION IS INHERITED, NOT NEW. Adjudication rests on a single O_APPEND write
//     of a small row being atomic — the property this ledger already stands on, with the same
//     local-filesystem caveat it already carries. The kit gains no new platform surface here.
//   · The SEND half is HARNESS-SPECIFIC. It binds a tool named `…send_message`, which exists in the
//     Claude lane and has no Codex equivalent; in the Codex lane that half is inert by absence, and
//     the brief-WRITE half binds both lanes through the shared payload grammar. Stated, not implied.

import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The SHARED write-target grammar. A consumer IMPORTS patch structure, it never PARSES it — the
// design invariant that closed a two-round recurrence in v2.2.0, and the reason this hook binds the
// Codex lane's multi-target `apply_patch` envelopes without knowing what a patch looks like.
import { extractTargets, resolvePatchBase, resolveProjectRoot, toRepoRelative } from "./payload-targets.mjs";
import {
  deriveRepairState, loadRepairEventsForProject, validateRepairDispatch, verifyRepairWorkerWrite,
} from "./repair-dispatch-state.mjs";

const SIDECAR = path.join(".claude", "brief-rung.json");
const LEDGER = path.join(".claude", "lane-ledger.jsonl");
const KIT_CONFIG = path.join(".claude", "kit.config.json");
const TASK_LANE = path.join(".claude", "task-lane.json");
const WRITE_BOOTSTRAP = new Set([SIDECAR, TASK_LANE]);

// THE FRESHNESS WINDOW IS A CONSTANT, DELIBERATELY UNLIKE THE LANE DECLARATION'S `maxAgeHours`.
// A sidecar that sets its own staleness window is self-certifying: the artifact whose freshness is
// in question would be the authority on how long it stays fresh. The declaration can afford that
// seam because a stale declaration only mis-labels a lane; here the whole claim IS "these checks
// were run for THIS dispatch, JUST NOW".
const MAX_AGE_MIN = 30;
// Five seconds, expressed in the same unit as MAX_AGE_MIN so the two are comparable at a glance.
const MAX_FUTURE_SKEW_MIN = 5 / 60;

// WHICH WRITES ARE BRIEFS? Two clauses, because either alone leaves a real gap.
//   (a) anything under a brief directory — portable default UNION `.claude/kit.config.json`'s
//       `briefPathDirs`, exactly the `executedPathDirs` seam: the MECHANISM copies verbatim and only
//       the DATA is per-repo, so an adopter whose briefs live in `dispatches/` says so in config
//       rather than editing this hook.
//   (b) any `.md` whose BASENAME names a brief — so the control is not inert in an adopter who
//       configured nothing, which is the state every adopter starts in.
const DEFAULT_BRIEF_PATH_DIRS = ["briefs"];
const BRIEF_BASENAME_RE = /brief/i;
// SHIPPED INSTRUCTION ARTIFACTS ARE NOT DISPATCHES. `/orchestrate` ships `CHIP_BRIEF.md`, which
// matches clause (b) by name and is a TEMPLATE — a governed instruction artifact under the budget
// checker, edited as code, never sent to anyone. Gating it would make routine skill maintenance owe
// a dispatch ritual: a control that blocks legitimate work is a control someone switches off, and
// this hook would have shipped that inside the release that warns about it.
const INSTRUCTION_ROOT_RE = /^(?:\.agents|\.claude|\.codex|agents|commands|skills|skill-shims|templates)\//i;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isPlainObject(v) { return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype; }
function isSegmentArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && !s.includes("/"));
}
function nonempty(v, max = 500) { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
/** Mechanical dispatch declaration validation; semantic classifications remain author-owned. */
export function repairDeclarationState(sidecar, { events, taskId, dispatch } = {}) {
  if (!isPlainObject(sidecar) || !["status", "build", "repair"].includes(sidecar.dispatch_kind)) {
    return { ok: false, state: "dispatch-kind-missing" };
  }
  if (sidecar.dispatch_kind === "status") {
    if (sidecar.repair !== undefined || sidecar.class !== "status") return { ok: false, state: "dispatch-kind-conflict" };
    return { ok: true, repair: null };
  }
  if (!nonempty(sidecar.task_id, 120) || sidecar.task_id !== taskId) return { ok: false, state: "dispatch-task-mismatch" };
  if (!Array.isArray(events)) return { ok: false, state: "repair-ledger-unavailable" };
  if (sidecar.dispatch_kind === "build") {
    if (sidecar.repair !== undefined) return { ok: false, state: "dispatch-kind-conflict" };
    const current = deriveRepairState(events, taskId);
    if (!current.ok) return { ok: false, state: current.state };
    if (current.latest?.verdict === "NO-GO") return { ok: false, state: "repair-dispatch-required" };
    return { ok: true, repair: null };
  }
  if (!isPlainObject(sidecar.repair)) return { ok: false, state: "repair-declaration-malformed" };
  const validated = validateRepairDispatch(sidecar.repair, {
    events, taskId, targetKind: dispatch?.kind, target: dispatch?.target,
  });
  return validated.ok
    ? { ok: true, repair: validated.repair, repairValidation: validated }
    : { ok: false, state: validated.state };
}

// Absent config ⇒ portable defaults (a legitimate minimal state). Present-but-corrupt ⇒ ok:false, and
// the caller DENIES a dispatch in scope: a corrupt brief-path set must never silently narrow the
// scope of a control, which is a fail-open wearing a config error's clothes.
export function loadBriefConfig(projectRoot, { readConfig } = {}) {
  const file = path.join(projectRoot, KIT_CONFIG);
  let raw;
  if (readConfig) {
    raw = readConfig(file);
    if (raw === undefined) return { ok: true, briefPathDirs: [] };
    if (raw === null) return { ok: false };
  } else {
    let st;
    try { st = lstatSync(file); }
    catch (e) { if (e && e.code === "ENOENT") return { ok: true, briefPathDirs: [] }; return { ok: false }; }
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false };
    try { raw = readFileSync(file, "utf8"); } catch { return { ok: false }; }
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false }; }
  if (!isPlainObject(parsed)) return { ok: false };
  const dirs = parsed.briefPathDirs === undefined ? [] : parsed.briefPathDirs;
  if (!isSegmentArray(dirs)) return { ok: false };
  return { ok: true, briefPathDirs: dirs };
}

export function loadTaskId(projectRoot, { readTaskLane } = {}) {
  const file = path.join(projectRoot, TASK_LANE);
  let parsed;
  try {
    if (readTaskLane) parsed = readTaskLane(file);
    else {
      const st = lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink()) return null;
      parsed = JSON.parse(readFileSync(file, "utf8"));
    }
  } catch { return null; }
  return isPlainObject(parsed) && nonempty(parsed.taskId, 120) ? parsed.taskId : null;
}

/** Is this repo-relative path a BRIEF for the purposes of the rung? Pure. */
export function isBriefPath(rel, briefPathDirs = []) {
  if (typeof rel !== "string" || !rel) return false;
  if (INSTRUCTION_ROOT_RE.test(rel)) return false;
  if (!/\.md$/i.test(rel)) return false;
  const dirs = DEFAULT_BRIEF_PATH_DIRS.concat(briefPathDirs);
  if (dirs.length && new RegExp("^(?:" + dirs.map(escapeRe).join("|") + ")/", "i").test(rel)) return true;
  return BRIEF_BASENAME_RE.test(path.basename(rel));
}

/** Does this payload name a cross-session send? Harness-specific BY CONSTRUCTION — see the header. */
export function isSendTool(toolName) {
  return typeof toolName === "string" && /send_message$/.test(toolName);
}

/**
 * The DISPATCH this call represents, or null when nothing here owes the rung.
 * `{ kind: "brief", target: <repo-relative path> }` | `{ kind: "send", target: <destination session> }`
 *
 * A MULTI-TARGET ENVELOPE OWES ONE RUNG PER BRIEF IT WRITES, and this returns the FIRST brief target
 * only because the verdict is all-or-nothing: the sidecar names one dispatch, so an envelope writing
 * two different briefs cannot be covered by one sidecar and must be denied on the second. Callers
 * therefore evaluate EVERY target (see `main`), never the first that happens to match.
 */
export function briefTargets(input, { root, patchBase, briefPathDirs, toRepoRelative: toRel }) {
  const extraction = extractTargets(input);
  // A write-shaped payload whose targets cannot be read is NOT this hook's fail-closed to own: the
  // two write GUARDS already deny that shape with the authority and the remediation for it. Denying
  // here too would duplicate their job and give the author two different stories for one payload.
  if (!extraction.ok || extraction.shape === "none") return [];
  const out = [];
  for (const t of extraction.targets) {
    const rel = toRel(t, root, patchBase);
    if (rel === null) continue;             // outside the repo — guard-cross-repo-writes owns that
    if (isBriefPath(rel, briefPathDirs)) out.push(rel);
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------ the sidecar

/**
 * Resolve the sidecar to a STATE. Pure over its injected reads so both polarities of every branch
 * are testable without a tree.
 *
 * FAIL-CLOSED ON A MISSING SESSION BINDING — the one place this deliberately diverges from the
 * reference implementation it was modelled on, which read `if (sidecar.sessionId && sessionId && …)`.
 * That is a TRUTHINESS read on a load-bearing field (INVARIANTS rule 3's class), and its consequence
 * is not cosmetic: a sidecar that simply OMITS `sessionId` skips the session check entirely, so the
 * forgery the binding exists to stop is performed by DELETING A FIELD. Absent is not "no opinion";
 * absent is unbound, and unbound is denied.
 */
export function sidecarState(sidecar, { ageMin, sessionId, dispatch, events = [], taskId = null }) {
  if (sidecar === undefined) return { state: "absent" };
  if (sidecar === null) return { state: "malformed" };
  if (!isPlainObject(sidecar)) return { state: "malformed" };
  if (!(typeof ageMin === "number") || !Number.isFinite(ageMin)) return { state: "malformed" };
  // A FUTURE-dated sidecar is NOT fresh — it is unusable. `ageMin > MAX` alone accepted a file
  // timestamped ahead of now, which is the freshness window's own bypass: touch the mtime forward and
  // it never expires. It gets its OWN state rather than folding into `stale`, because a deny that
  // said "N minutes old" about a file dated tomorrow would misdescribe the input it just read.
  // The tolerance is FIVE SECONDS, named and exact: the mtime and the clock come from the same
  // machine, so this covers filesystem timestamp granularity and nothing else. A first cut allowed
  // a full minute while its comment said "a few seconds" — the wording and the number have to agree,
  // or the boundary a reader relies on is not the boundary that ships.
  if (ageMin < -MAX_FUTURE_SKEW_MIN) return { state: "future-dated", ageMin };
  if (ageMin > MAX_AGE_MIN) return { state: "stale", ageMin };

  if (typeof sidecar.sessionId !== "string" || !sidecar.sessionId) return { state: "session-missing" };
  // A payload that carries no session id cannot corroborate the binding. The sidecar still had to
  // NAME one — that much is checked above — but "the harness told us nothing" must not read as a
  // match, or the binding evaporates in exactly the lane that omits the field.
  if (typeof sessionId !== "string" || !sessionId) return { state: "session-unverifiable" };
  if (sidecar.sessionId !== sessionId) return { state: "session-mismatch", named: sidecar.sessionId };

  // TARGET BINDING is what makes freshness mean anything. `cp` gives a copied sidecar a NEW mtime and
  // `touch` clears staleness while leaving the content untouched — so an mtime window alone lets one
  // honest ritual authorize an unlimited number of unchecked dispatches, and lets another lane's
  // sidecar authorize this one. A sidecar names the ONE dispatch its checks were run for.
  if (typeof sidecar.target !== "string" || !sidecar.target) return { state: "target-missing" };
  if (sidecar.target !== dispatch.target) return { state: "target-mismatch", named: sidecar.target };

  // Classify BEFORE the status escape. Otherwise repair metadata hidden behind `class:"status"`, or
  // relabelled as `build`, bypasses the controller before it is even consulted.
  const dispatchDeclaration = repairDeclarationState(sidecar, { events, taskId, dispatch });
  if (!dispatchDeclaration.ok) return { state: dispatchDeclaration.state };

  // The DECLARED-STATUS route, sends only. A brief is load-bearing by definition — it is the artifact
  // the worker builds from — so there is nothing for a brief write to declare its way out of.
  if (sidecar.class === "status") {
    if (dispatch.kind !== "send") return { state: "status-not-available" };
    // Consumes NOTHING, and the asymmetry is deliberate rather than an oversight: this route
    // presented no receipts, so there are none to spend. What it leaves behind is a legible ledger
    // row, which is the only thing standing between this escape and invisibility.
    return { state: "status-declared" };
  }
  if (sidecar.class !== undefined && sidecar.class !== "load-bearing") return { state: "malformed" };

  // CONSUME ON USE — one ritual, one dispatch.
  //
  // Target-binding kills the COPIED and the RE-TOUCHED sidecar, but it leaves the sharpest case
  // open: a SECOND dispatch to the SAME target inside the freshness window. That repeat is the
  // dangerous one, not a harmless one — a brief re-edited at the same path carries TEXT THE ORIGINAL
  // RITUAL NEVER SAW, riding receipts minted for different content. Freshness cannot see it (the
  // window has not closed) and target-binding cannot see it (the target matches). So the sidecar
  // carries a NONCE, the guard records it on the dispatch it authorizes, and a nonce already spent
  // is refused. That is the rule's actual semantics: every load-bearing dispatch owes its own rung.
  if (typeof sidecar.nonce !== "string" || !sidecar.nonce.trim()) return { state: "nonce-missing" };

  const checks = Array.isArray(sidecar.checks) ? sidecar.checks : [];
  const executed = checks.filter(
    (c) => isPlainObject(c) &&
      typeof c.command === "string" && c.command.trim() &&
      typeof c.output === "string" && c.output.trim()
  );
  if (executed.length === 0) return { state: "no-executed-check" };
  return { state: "receipted", checks: executed.length, repair: dispatchDeclaration.repair,
    repairValidation: dispatchDeclaration.repairValidation };
}

export const ALLOW_STATES = new Set(["receipted", "status-declared"]);

// ------------------------------------------------------------------ ledger

// One row per allowed dispatch, in the lane ledger's shape and with its IO discipline, carrying
// `control` so the Owner's spot-check can tell this control's rows from the lane guard's. A
// STATUS-DECLARED allow is the row that matters: it is the unfalsifiable route, so it must not also
// be the invisible one. Ledger IO fails CLOSED — an allow that cannot record its trace is denied.
export function writeLedger(projectRoot, { decision, state, kind, target, sessionId, checks, cls, nonce, attempt, repair }) {
  const ledger = path.join(projectRoot, LEDGER);
  let fd;
  try {
    try { const ls = lstatSync(ledger); if (ls.isSymbolicLink() || !ls.isFile()) return false; }
    catch (e) { if (e && e.code !== "ENOENT") return false; }
    if (existsSync(ledger)) {
      const existing = readFileSync(ledger, "utf8");
      if (existing.length > 0 && !existing.endsWith("\n")) return false;
      for (const row of existing.split("\n").filter(Boolean)) {
        try { if (!isPlainObject(JSON.parse(row))) return false; } catch { return false; }
      }
    }
    const row = {
      ts: new Date().toISOString(),
      control: "brief-rung",
      decision, state, kind,
      // The dispatch target is unvalidated input landing in an append-only audit file, so it is
      // BOUNDED — and the bound carries a digest, because a bare truncation maps two different
      // targets sharing a prefix onto one string and the trail loses the distinction it exists for.
      target: target.length <= 120
        ? target
        : `${target.slice(0, 120)}…truncated,sha256:${createHash("sha256").update(target).digest("hex").slice(0, 16)}`,
      sessionId,
    };
    // CLEAR TEXT, not a digest. The ledger's named consumer is the OWNER'S SPOT-CHECK, and a
    // spot-check cannot read a hash — the same reasoning that put a clear-text tier on the lane
    // guard's exempt rows. The declared CLASS is the field that matters most here: an orchestrator
    // who declares every dispatch "status" is not stopped mechanically (the same unfalsifiability
    // as `exempt`), so the honest compensation is that each such declaration is a legible row a
    // human can COUNT. The ledger RECORDS; it does not deter, and this control does not claim it.
    row.class = cls;
    if (checks !== undefined) row.checks = checks;
    // The spent nonce IS the consumption record — there is no second file to lose or forge apart
    // from the audit trail itself, and it is append-only and fsync'd for exactly that reason.
    if (nonce !== undefined) row.nonce = nonce;
    if (repair !== undefined && repair !== null) row.repair = repair;
    // The ATTEMPT TOKEN is what makes first-occurrence adjudicable: without per-attempt identity two
    // near-simultaneous rows for one nonce are indistinguishable, and "first" collapses to "any".
    if (attempt !== undefined) row.attempt = attempt;
    fd = openSync(ledger, "a", 0o600);
    const line = `${JSON.stringify(row)}\n`;
    if (writeSync(fd, line) !== Buffer.byteLength(line)) return false;
    fsyncSync(fd);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* the write result already decided */ } }
  }
}

/**
 * ADJUDICATE CONSUMPTION FROM THE AUDIT TRAIL ITSELF. Pure.
 *
 * The rule: among the attempt rows bearing this nonce, the FIRST one wins. Allow iff that first row
 * carries MY attempt token.
 *
 * WHY THIS AND NOT A LOCK. Two rounds of review died on a lock built BESIDE the ledger: the first
 * cut had no serialisation at all (six concurrent dispatches, five allowed), and the second's
 * stale-lock break WAS the race it existed to survive — a holder paused past the window has its live
 * lock unlinked, and its own unconditional release then deletes the next holder's. Every time this
 * program has seen one class survive rounds, the cure was relocating the mechanism INTO the shared,
 * already-hardened store rather than hardening the bespoke one next to it. So consumption becomes a
 * PROPERTY OF THE TRAIL — append order — and there is no second mechanism to coordinate with.
 *
 * THE ATOMICITY ASSUMPTION IS INHERITED, NOT NEW: a single O_APPEND write of a small row is the
 * property this ledger already stands on, with the same local-filesystem caveat it already carries.
 * The kit gains no new platform surface here.
 *
 * PER-ATTEMPT IDENTITY IS LOAD-BEARING. Without a unique token, two near-simultaneous rows for one
 * nonce are indistinguishable on read-back and "first occurrence" collapses into "some row exists".
 */
export function adjudicateFirst(rows, nonce, attempt) {
  const first = rows.find(
    (r) => isPlainObject(r) && r.control === "brief-rung" && r.decision === "attempt" && r.nonce === nonce
  );
  if (!first) return { won: false, reason: "no-attempt-row" };   // our own append vanished ⇒ fail closed
  return { won: first.attempt === attempt, winner: first.attempt };
}

/** Parse the ledger into rows, or null when it cannot be trusted (⇒ the caller denies). */
export function ledgerRows(text) {
  if (text === undefined) return [];
  if (typeof text !== "string") return null;
  if (text.length > 0 && !text.endsWith("\n")) return null;
  const out = [];
  for (const line of text.split("\n").filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { return null; }
    if (!isPlainObject(row)) return null;
    out.push(row);
  }
  return out;
}

// ------------------------------------------------------------------ deny text

const RITUAL =
  `Before dispatching a brief, a ruling or a GO ask: OPEN every citation at its line and RECOMPUTE ` +
  `every number by execution (never by eye), then write \`${SIDECAR}\` as ` +
  `{"sessionId":"<this session>","target":"<the ONE dispatch these checks were run for>",` +
  `"nonce":"<a value you have not used before>","dispatch_kind":"build|repair",` +
  `"task_id":"<current task-lane taskId>",` +
  `"checks":[{"command":"<what you ran>","output":"<what it returned>"}]} and retry. ` +
  `The nonce is SPENT on the dispatch it authorizes: one ritual, one dispatch, so a second send or ` +
  `a re-edited brief owes its own — the repeat carries text the first ritual never saw. ` +
  `A cross-session send that is NOT load-bearing may instead declare ` +
  `{"class":"status","dispatch_kind":"status"} with the same ` +
  `sessionId and target — that route is LEDGERED for the Owner's spot-check, and a brief write cannot ` +
  `take it. This guard proves such a RECORD EXISTS — not that its commands were run, nor that they ` +
  `were the right ones; a shell ` +
  `write bypasses it entirely, and it is a tripwire rather than a floor.`;

export function denyReason(state, { dispatch, detail } = {}) {
  const what = dispatch?.kind === "send"
    ? `this cross-session send to ${dispatch.target}`
    : dispatch?.kind === "source"
      ? `the repair source write ${dispatch.target}`
    : `the brief write ${dispatch?.target ?? "<unknown-path>"}`;
  const head = `guard-brief-rung.mjs blocked ${what}: `;
  const why = {
    absent: `no verification sidecar (${SIDECAR}) — the pre-send rung has not run for this dispatch.`,
    malformed: `${SIDECAR} is present but MALFORMED (not valid JSON, not an object, a symlink, or a \`class\` this guard does not know). Malformed reads as ABSENT here, never as satisfied.`,
    stale: `${SIDECAR} is ${detail} minutes old (limit ${MAX_AGE_MIN}) — receipts that old belong to another dispatch's ritual, not this one's.`,
    "session-missing": `${SIDECAR} names no \`sessionId\`. An UNBOUND sidecar is denied rather than accepted: a binding a caller can switch off by omitting a field is not a binding.`,
    "session-unverifiable": `${SIDECAR} names a session, but this payload carries none, so the binding cannot be corroborated. An unverifiable binding is not a satisfied one.`,
    "session-mismatch": `${SIDECAR} names session ${detail}, not this one — another lane's ritual proves nothing about this dispatch.`,
    "target-missing": `${SIDECAR} names no \`target\`. Freshness alone cannot bind receipts to a dispatch: copying a sidecar gives it a NEW mtime, and re-touching one clears staleness without re-running anything.`,
    "target-mismatch": `${SIDECAR} was written for ${detail}, not for this dispatch — one ritual authorizes one dispatch.`,
    "status-not-available": `${SIDECAR} declares {"class":"status"}, which is available only to a cross-session send. A brief is load-bearing by definition: it is the artifact a worker builds from, so there is nothing here to declare out of scope.`,
    "dispatch-kind-missing": `${SIDECAR} does not explicitly declare \`dispatch_kind\` as status, build, or repair. Missing no longer defaults to build because that let a repair relabel itself out of the controller.`,
    "dispatch-kind-conflict": `${SIDECAR}'s class/kind and repair metadata conflict. A status/build declaration cannot carry repair authority, and a repair cannot take the status escape.`,
    "dispatch-task-mismatch": `${SIDECAR}'s \`task_id\` does not match the current task-lane declaration. Refreezing or relabelling a changeset cannot switch the task identity that owns its round history.`,
    "repair-dispatch-required": `${SIDECAR} declares a new build while this task's durable controller ends on NO-GO. The next actionable brief is a repair and must bind the existing round history.`,
    "repair-disposition-not-authorized": `${SIDECAR} tries to dispatch repair work for a finding disposition that is not REMEDIATE. NOTE, DEFER, DECLINE, and ESCALATE remain durable observations but mint no worker authority.`,
    "repair-brief-required": `${SIDECAR} tries to carry repair authority in a cross-session send. Persist the actionable repair as a receipted brief first; later sends may be status-only pointers to that durable artifact.`,
    "repair-brief-receipt-missing": `this gate result names no exact prior repair-brief receipt for the round it judges. A round cannot close unless the durable controller proves what authorized its candidate.`,
    "future-dated": `${SIDECAR} is dated ${detail} minutes in the FUTURE. A sidecar ahead of the clock is not fresh, it is unusable — and accepting one would hand the freshness window its own bypass, since a timestamp pushed forward never expires.`,
    "nonce-missing": `${SIDECAR} names no \`nonce\`. A rung is SPENT on the dispatch it authorizes, so it needs a value to spend; without one, a single ritual would authorize every dispatch inside the freshness window.`,
    "rung-already-spent": `${SIDECAR}'s nonce has ALREADY been spent — an earlier attempt (${detail}) claimed it first, and this attempt is recorded in the trail as a refused one. One ritual authorizes ONE dispatch: a repeat to the same target is exactly the case this closes, because a re-edited brief at that path carries text the original checks never saw. Re-run the rung and write a NEW nonce.`,
    "adjudication-unreadable": `the dispatch's own attempt row could not be read back from ${LEDGER}, so it is not possible to tell whether this attempt claimed the nonce first. An unadjudicated consume is not a consume — the guard denies rather than guess. Fix that file, re-run the rung, and retry.`,
    "no-executed-check": `${SIDECAR} carries no EXECUTED check — each entry needs a non-empty \`command\` AND its captured \`output\`. A bare declaration that the checks happened is precisely the assert-without-executing defect this rung exists to stop.`,
    "repair-declaration-malformed": `${SIDECAR} declares a repair dispatch but its repair record is incomplete or malformed. Supply the exact task, changeset, computed candidate digest, next round, finding ids/class, ownership area, original trigger, authorized paths, repair-introduced flag, new-scope flag, and required typed evidence event IDs. Semantic sameness remains author-declared.`,
    "repair-history-mismatch": `${SIDECAR}'s repair declaration does not exactly match the latest durable round disposition for this task and changeset. Refreezes may change the candidate, but never reset or relabel the round history.`,
    "repair-history-invalid": `the durable repair history is transition-invalid, so it cannot authorize another dispatch. Inspect the Git-common repair ledger; do not replace it with a fresh changeset.`,
    "repair-changeset-reset": `this task already owns a different durable changeset id. A refreeze, finding split, or reviewer swap cannot mint a new round allowance.`,
    "repair-scope-unapproved": `${SIDECAR} declares new repair scope without the exact typed Owner scope event ID. Scope expansion remains an Owner decision.`,
    "repair-root-cause-exit-missing": `a root-cause trigger has FIRED in this history — a repair introduced the harm, or two consecutive NO-GOs shared a finding class — and ${SIDECAR} names no exact typed root-cause exit event ID. Record the exit for the diagnosed replacement mechanism with \`record-repair-event.mjs\`, then declare its event ID. (This gate follows the TRIGGER, not the round number; how many rounds a cycle runs is the procedure's call, not this hook's.)`,
    "repair-ledger-unavailable": `the Git-common repair-event ledger is corrupt, truncated, symlinked, non-regular, or unwritable — it EXISTS as a subject this control cannot read, so it fails closed. PRESERVE it and repair it: copy the file aside, find the row that will not parse or whose transition is out of order (it is append-only JSONL, one event per line), and fix that row. Do NOT delete the ledger to unblock a write — that discards every round's history to clear one message, and the history is the only thing that can tell you what was authorized.`,
    "repair-close-invalid": `the repair close does not name the CURRENT round, carries no reason, or names no Owner close-authorization event ID. A close ends an authorized repair program in band; it must say which round it ends and why.`,
    "repair-close-unauthorized": `this repair close names no matching Owner authorization. Record an \`owner_extension\` with \`"authority_kind":"close"\` at this round, then have the close name that exact event ID. Closing releases the program's global path ownership, so the release is attributable to the Owner — not to the session the program constrains.`,
    "repair-worker-session-missing": `this repair write has no hook session identity. Run \`confirm-repair-brief.mjs --verify\` with the current session recorded as explicit \`session_id\`, then retry from that same session.`,
    "repair-worker-verification-missing": `this session has no typed worker-verification event for the current repair receipt. TWO routes out, and both work from here: to CONTINUE the repair, have the orchestrator persist the brief and run \`confirm-repair-brief.mjs --confirm\` to mint the receipt, then run \`--verify\` from THIS session before the first source write; to ABANDON it, record an \`owner_extension\` with \`"authority_kind":"close"\` at the current round and then a \`repair_close\` naming that event ID, which ends the program and releases its paths. A repair that is going nowhere is closed, never left holding the repo.`,
    "repair-worker-candidate-stale": `this session verified a receipt for an older candidate or round. Verify the current repair brief receipt; refreezing never lets an earlier worker admission carry forward.`,
    "repair-worker-path-unauthorized": `this source path is outside the exact authorized-path set carried by the current repair brief receipt. Stop and obtain an Owner-authorized scope event when the repair genuinely needs new scope.`,
    "repair-task-relabel-path-owned": `this exact source path is owned by another ACTIVE repair program — one whose latest verdict is NO-GO, whose disposition is REMEDIATE, and which no Owner-authorized close has ended. Re-declare the task lane as that owning task and use its current verified worker session; relabelling the lane cannot abandon repair-path authority.`,
    "repair-worker-path-owner-conflict": `this exact source path is claimed by multiple active NO-GO repair programs. The ownership conflict fails closed; reconcile those programs before any worker writes the path.`,
    "repair-brief-changed": `the persisted repair brief no longer matches the bytes the worker verified. Restore or reconfirm the intended brief, then run \`--verify\` again before writing source.`,
    "repair-dispatch-invalid": `the exact repair dispatch could not be appended to the durable controller after nonce adjudication. No worker authority was issued.`,
    "kit-config-malformed": `${path.join(KIT_CONFIG)} is present but MALFORMED (not valid JSON, not an object, or \`briefPathDirs\` is not an array of non-empty path segments). This dispatch is BLOCKED (fail-closed) — a corrupt brief-path set must never silently narrow a control's scope. Fix that file, delete it to fall back to the kit's portable defaults, or re-run \`node bin/init.mjs\`.`,
    "ledger-error": `the dispatch was otherwise satisfied, but its audit row could not be appended to ${LEDGER} (symlinked, unreadable, a corrupt row, or a missing trailing newline). This control fails CLOSED when it cannot record a trace — re-declaring will not clear it; fix that file.`,
  }[state] ?? `sidecar state is ${state}.`;
  return state === "kit-config-malformed" || state === "ledger-error" ? head + why : head + why + " " + RITUAL;
}

function emitDeny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
}

// ------------------------------------------------------------------ entry

// A NOTICE is not a deny. It rides the same PreToolUse channel `guard-gate-ladder` uses to speak
// without blocking, and it exists for exactly one case: this control admitting, in the transcript,
// that it could not see. A relief taken silently is indistinguishable from a control that passed.
function emitNotice(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason },
  }));
}

export function main({ stdin = process.stdin, cwd = process.cwd(), emit = emitDeny,
  notice = emitNotice, exit = (c) => process.exit(c) } = {}) {
  let raw = "";
  stdin.on("data", (d) => (raw += d));
  stdin.on("end", () => {
    let input;
    // CANNOT READ THE PAYLOAD ⇒ CANNOT SEE THE DISPATCH. The reference this was modelled on allowed
    // here, reasoning that a broken payload is the harness's defect. But an unparseable payload is
    // exactly the shape a bypass takes, and this same `exit(0)` was one of three fail-opens removed
    // from guard-cross-repo-writes. Deny is also cheap in the direction that matters: this hook binds a
    // narrow slice of tools, so failing closed on an unreadable payload cannot brick ordinary work.
    try { input = JSON.parse(raw); } catch {
      emit(`guard-brief-rung.mjs blocked this call: its hook payload could not be parsed, so the dispatch it names could not be read. This guard fails CLOSED on a call it cannot see — an unreadable payload is not evidence that nothing was dispatched. ${RITUAL}`);
      return exit(0);
    }

    const root = resolveProjectRoot(input) || cwd;
    const patchBase = resolvePatchBase(input, root);
    const config = loadBriefConfig(root);

    const dispatches = [];
    const sourceTargets = [];
    if (isSendTool(input?.tool_name)) {
      const dest = input?.tool_input?.session_id;
      // A send whose destination cannot be read still owes the rung — it is positively send-shaped.
      // `<unreadable-destination>` can never equal a sidecar's target, so it denies, which is the
      // correct direction for a dispatch this guard cannot identify.
      dispatches.push({ kind: "send", target: typeof dest === "string" && dest ? dest : "<unreadable-destination>" });
    } else if (config.ok) {
      const briefs = new Set(briefTargets(input, { root, patchBase, briefPathDirs: config.briefPathDirs, toRepoRelative }));
      for (const rel of briefs) {
        dispatches.push({ kind: "brief", target: rel });
      }
      const extracted = extractTargets(input);
      if (extracted.ok && extracted.shape !== "none") {
        for (const target of extracted.targets) {
          const rel = toRepoRelative(target, root, patchBase);
          if (rel !== null && !briefs.has(rel) && !WRITE_BOOTSTRAP.has(rel)) sourceTargets.push(rel);
        }
      }
    } else {
      // A corrupt config cannot say a write is OUT of scope — and evaluating it against the DEFAULTS
      // is not fail-closed, it only looks like it. An adopter who configured `dispatches/` loses
      // enforcement on exactly their brief directory at exactly the moment their config broke: the
      // corrupt-config branch fails OPEN for the only adopters it exists to protect. So when the
      // brief-path question is unanswerable, every markdown write outside the shipped instruction
      // roots is treated as POSSIBLY a brief and denied. Loud and over-broad is the correct
      // direction here, and the remediation names the one file to fix.
      const maybeBriefs = extractTargets(input);
      if (maybeBriefs.ok && maybeBriefs.shape !== "none") {
        for (const t of maybeBriefs.targets) {
          const rel = toRepoRelative(t, root, patchBase);
          if (rel === null) continue;
          if (!INSTRUCTION_ROOT_RE.test(rel) && /\.md$/i.test(rel)) {
            emit(denyReason("kit-config-malformed", { dispatch: { kind: "brief", target: rel } }));
            return exit(0);
          }
          if (!WRITE_BOOTSTRAP.has(rel)) sourceTargets.push(rel);
        }
      }
    }

    let sidecar, ageMin;
    try {
      const ls = lstatSync(path.join(root, SIDECAR));
      if (ls.isSymbolicLink() || !ls.isFile()) sidecar = null;
      else {
        const st = statSync(path.join(root, SIDECAR));
        ageMin = (Date.now() - st.mtimeMs) / 60_000;
        try { sidecar = JSON.parse(readFileSync(path.join(root, SIDECAR), "utf8")); } catch { sidecar = null; }
      }
    } catch (e) {
      // ENOENT is a true "the rung has not run". Any other IO error means the sidecar EXISTS and
      // cannot be read, which must not read as absent — but both directions deny here anyway, so
      // the distinction serves the MESSAGE, which is what the author acts on.
      sidecar = e && e.code === "ENOENT" ? undefined : null;
    }

    const taskId = loadTaskId(root);
    const controller = loadRepairEventsForProject(root);

    // A repair receipt becomes worker authority only after explicit `--verify` records this exact
    // session. The already-registered write hook then rechecks the current candidate, persisted
    // brief bytes, and EACH target against the receipt's authorized path set. Task-lane and sidecar
    // writes are the two bootstraps: requiring an admission to create its own identity or input
    // would be a circular control. Shell writes remain outside this tool-bound tripwire, disclosed
    // in the header rather than hidden behind a universal claim.
    if (sourceTargets.length) {
      // THE ONE SANCTIONED RELIEF, and it is stated out loud rather than taken quietly. A tree that
      // cannot hold a repair ledger — no `.git` anywhere above it and no Git location override set —
      // cannot hold a repair PROGRAM either, so this control has no subject here and denying every
      // write would be a pure false positive. It is the consumer, not the controller, that takes the
      // relief: `loadRepairEventsForProject` still fails closed, and this is the single visible place
      // that reads its verdict as "blind" instead of "violated". Anything else — a ledger that exists
      // and cannot be read, git off the PATH inside a real repo — still denies.
      if (controller.state === "repair-ledger-no-subject") {
        notice(`the repair-round control is BLIND here: no Git repository was found at or above ` +
          `${root}, so no repair ledger can exist and no repair program can be enforced. ` +
          `${sourceTargets.length} source write(s) proceeded UNCHECKED by it. If you expected this ` +
          `tree to be governed, the hook is running somewhere you did not intend.`);
      } else if (!controller.ok) {
        emit(denyReason(controller.state, { dispatch: { kind: "source", target: sourceTargets[0] } }));
        return exit(0);
      } else {
        for (const target of sourceTargets) {
          const admitted = verifyRepairWorkerWrite({
            task_id: taskId, session_id: input?.session_id, target,
          }, { projectRoot: root });
          if (!admitted.ok) {
            emit(denyReason(admitted.state, { dispatch: { kind: "source", target } }));
            return exit(0);
          }
        }
      }
    }

    if (!dispatches.length) return exit(0);   // no brief/send dispatch owes the verification rung

    // JUDGE THE SIDECAR FIRST — every dispatch, before anything touches the trail. A patch envelope
    // is applied as a unit, so deciding on the first match would let a second brief in the same
    // envelope ride the first one's sidecar.
    const verdicts = dispatches.map((d) => ({ d, v: sidecarState(sidecar, {
      ageMin: ageMin ?? 0, sessionId: input?.session_id, dispatch: d,
      events: controller.ok ? controller.events : null, taskId,
    }) }));
    const blocked = verdicts.find(({ v }) => !ALLOW_STATES.has(v.state));
    if (blocked) {
      emit(denyReason(blocked.v.state, {
        dispatch: blocked.d,
        detail: blocked.v.named ?? (blocked.v.ageMin !== undefined ? Math.abs(Math.round(blocked.v.ageMin)) : undefined),
      }));
      return exit(0);
    }

    // APPEND, THEN ADJUDICATE. Consumption is a property of the TRAIL's append order, not of a lock
    // beside it. Each attempt writes its own row carrying a unique token, then reads back: the FIRST
    // attempt row bearing this nonce wins. A loser's ATTEMPT row is already in the trail and stays
    // there, and a `deny` resolution is appended on top of it WHEN THE TRAIL IS WRITABLE — if that
    // second append fails the call still denies (fail-closed), but the trail then shows an
    // unresolved attempt rather than an explicit refusal. Stated precisely because the broader
    // claim — 'every loser leaves a legible refusal' — is not true on that I/O-failure path.
    // There is no critical section to serialise, so there is nothing to leave behind.
    const attempt = `${process.pid}-${createHash("sha256").update(`${process.pid}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12)}`;

    for (const { d, v } of verdicts) {
      // A STATUS-DECLARED send consumes nothing — it presented no receipts, so it claims no nonce and
      // needs no adjudication. One row, and it is the legible declaration the Owner counts.
      if (v.state === "status-declared") {
        if (!writeLedger(root, { decision: "allow", state: v.state, kind: d.kind, target: d.target,
          sessionId: input?.session_id ?? "", cls: "status" })) {
          emit(denyReason("ledger-error", { dispatch: d })); return exit(0);
        }
        continue;
      }

      if (!writeLedger(root, { decision: "attempt", state: v.state, kind: d.kind, target: d.target,
        sessionId: input?.session_id ?? "", checks: v.checks, cls: "load-bearing",
        nonce: sidecar.nonce, attempt, repair: v.repair })) {
        emit(denyReason("ledger-error", { dispatch: d })); return exit(0);
      }

      const rows = ledgerRows((() => {
        try { return readFileSync(path.join(root, LEDGER), "utf8"); } catch { return undefined; }
      })());
      if (rows === null) { emit(denyReason("adjudication-unreadable", { dispatch: d })); return exit(0); }
      const ruling = adjudicateFirst(rows, sidecar.nonce, attempt);
      if (!ruling.won) {
        // Our attempt row is already in the trail and stays there as the refusal's own record.
        if (!writeLedger(root, { decision: "deny", state: "rung-already-spent", kind: d.kind,
          target: d.target, sessionId: input?.session_id ?? "", cls: "load-bearing",
          nonce: sidecar.nonce, attempt })) {
          emit(denyReason("ledger-error", { dispatch: d })); return exit(0);
        }
        emit(denyReason(ruling.reason === "no-attempt-row" ? "adjudication-unreadable" : "rung-already-spent",
          { dispatch: d, detail: ruling.winner }));
        return exit(0);
      }
      if (!writeLedger(root, { decision: "allow", state: v.state, kind: d.kind, target: d.target,
        sessionId: input?.session_id ?? "", checks: v.checks, cls: "load-bearing",
        nonce: sidecar.nonce, attempt, repair: v.repair })) {
        emit(denyReason("ledger-error", { dispatch: d })); return exit(0);
      }
    }
    return exit(0);
  });
}

// isMain guard, realpath'd on BOTH sides: /tmp is a symlink to /private/tmp on macOS, and without
// this an importing TEST would RUN the guard and consume its own stdin (lesson 32).
const entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })()
  : null;
if (entry && entry === fileURLToPath(import.meta.url)) main();
