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
//     the same accepted class as every sibling guard here. `.githooks/pre-commit` remains the only
//     every-lane floor, and it does not bind dispatches at all.
//   · It is a TRIPWIRE, not a floor. Its purpose is to make an unverified dispatch visible at the
//     point it is attempted — not to make one impossible.
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

const SIDECAR = path.join(".claude", "brief-rung.json");
const LEDGER = path.join(".claude", "lane-ledger.jsonl");
const KIT_CONFIG = path.join(".claude", "kit.config.json");

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
export function sidecarState(sidecar, { ageMin, sessionId, dispatch, spentNonces = new Set() }) {
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
  if (spentNonces.has(sidecar.nonce)) return { state: "rung-already-spent", named: sidecar.nonce };

  const checks = Array.isArray(sidecar.checks) ? sidecar.checks : [];
  const executed = checks.filter(
    (c) => isPlainObject(c) &&
      typeof c.command === "string" && c.command.trim() &&
      typeof c.output === "string" && c.output.trim()
  );
  if (executed.length === 0) return { state: "no-executed-check" };
  return { state: "receipted", checks: executed.length };
}

export const ALLOW_STATES = new Set(["receipted", "status-declared"]);

// ------------------------------------------------------------------ ledger

// One row per allowed dispatch, in the lane ledger's shape and with its IO discipline, carrying
// `control` so the Owner's spot-check can tell this control's rows from the lane guard's. A
// STATUS-DECLARED allow is the row that matters: it is the unfalsifiable route, so it must not also
// be the invisible one. Ledger IO fails CLOSED — an allow that cannot record its trace is denied.
export function writeLedger(projectRoot, { decision, state, kind, target, sessionId, checks, cls, nonce }) {
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
 * Every brief-rung nonce this repo has already spent. Read from the ledger rather than a sidecar
 * file of its own: the audit trail is already append-only, fsync'd and integrity-checked on write,
 * so consumption inherits those properties instead of inventing weaker ones beside them.
 *
 * An UNREADABLE ledger yields `null`, and the caller treats that as fail-closed — if the record of
 * what has been spent cannot be read, nothing can be honestly declared unspent.
 */
export function spentNoncesFrom(text) {
  if (text === undefined) return new Set();           // no ledger yet ⇒ nothing spent
  if (typeof text !== "string") return null;
  if (text.length > 0 && !text.endsWith("\n")) return null;
  const out = new Set();
  for (const line of text.split("\n").filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { return null; }
    if (!isPlainObject(row)) return null;
    if (row.control === "brief-rung" && typeof row.nonce === "string" && row.nonce) out.add(row.nonce);
  }
  return out;
}

/**
 * Run `fn` holding an exclusive lock beside the ledger. Returns `null` if the lock cannot be taken,
 * and the caller DENIES on that — an unserialised consume is not a consume.
 *
 * WHY A LOCK AT ALL, when the ledger append is already atomic: atomicity of the WRITE is not
 * atomicity of the DECISION. Consumption is read-validate-append, and concurrent hook processes
 * interleave inside it — measured on this changeset, SIX concurrent dispatches on ONE nonce were
 * allowed FIVE times. "One ritual, one dispatch" was therefore false under the very multi-session
 * model this kit is built around, which makes the lock part of the claim rather than a nicety.
 * (The kit's ledger has no lock of its own — a banked pre-existing gap; this one is scoped to THIS
 * control's critical section and does not pretend to fix that.)
 */
export const LOCK_UNAVAILABLE = Symbol("brief-rung:lock-unavailable");

export function withLedgerLock(projectRoot, fn, { now = () => Date.now() } = {}) {
  const lock = path.join(projectRoot, ".claude", "brief-rung.lock");
  // NO TIME-BASED STALE BREAK, and that is the correction rather than an omission. A first cut broke
  // any lock older than 30s so a crashed holder could not brick the control — and the review seat
  // showed the break IS the race it was meant to survive: a holder paused past the window (a slow
  // ledger parse suffices, no signal needed) has its live lock unlinked by a second process, both
  // then hold "the" lock, and the double-spend the lock exists to stop is back. Worse, the first
  // holder's unconditional unlink then deletes the SECOND holder's lock, admitting a third.
  // So: contention DENIES, and a crashed holder leaves a lock a human removes — loud, fail-closed,
  // and free of the break-race entirely. The deny message names the file to delete.
  const token = `${process.pid}:${createHash("sha256").update(`${process.pid}${now()}`).digest("hex").slice(0, 12)}`;
  let fd;
  try { fd = openSync(lock, "wx", 0o600); }
  catch (e) {
    // EEXIST is contention; anything else is an IO fault. Both fail closed — an unserialised
    // consume is not a consume, and this control never trades that for availability.
    return LOCK_UNAVAILABLE;
  }
  try {
    writeSync(fd, token);
    fsyncSync(fd);
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* the result already decided */ }
    // UNLINK ONLY OUR OWN LOCK, verified by reading the token back. An unconditional unlink deletes
    // whatever file is at that path — including a DIFFERENT holder's lock, if one ever replaced
    // ours. Nothing should replace ours now that the break is gone; this is the belt that makes
    // that guarantee checkable rather than assumed.
    try { if (readFileSync(lock, "utf8") === token) unlinkSync(lock); }
    catch { /* already gone, or not ours — either way, not ours to remove */ }
  }
}

// ------------------------------------------------------------------ deny text

const RITUAL =
  `Before dispatching a brief, a ruling or a GO ask: OPEN every citation at its line and RECOMPUTE ` +
  `every number by execution (never by eye), then write \`${SIDECAR}\` as ` +
  `{"sessionId":"<this session>","target":"<the ONE dispatch these checks were run for>",` +
  `"nonce":"<a value you have not used before>",` +
  `"checks":[{"command":"<what you ran>","output":"<what it returned>"}]} and retry. ` +
  `The nonce is SPENT on the dispatch it authorizes: one ritual, one dispatch, so a second send or ` +
  `a re-edited brief owes its own — the repeat carries text the first ritual never saw. ` +
  `A cross-session send that is NOT load-bearing may instead declare {"class":"status"} with the same ` +
  `sessionId and target — that route is LEDGERED for the Owner's spot-check, and a brief write cannot ` +
  `take it. This guard proves such a RECORD EXISTS — not that its commands were run, nor that they ` +
  `were the right ones; a shell ` +
  `write bypasses it entirely, and it is a tripwire rather than a floor.`;

export function denyReason(state, { dispatch, detail } = {}) {
  const what = dispatch?.kind === "send"
    ? `this cross-session send to ${dispatch.target}`
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
    "future-dated": `${SIDECAR} is dated ${detail} minutes in the FUTURE. A sidecar ahead of the clock is not fresh, it is unusable — and accepting one would hand the freshness window its own bypass, since a timestamp pushed forward never expires.`,
    "nonce-missing": `${SIDECAR} names no \`nonce\`. A rung is SPENT on the dispatch it authorizes, so it needs a value to spend; without one, a single ritual would authorize every dispatch inside the freshness window.`,
    "rung-already-spent": `${SIDECAR}'s nonce ${detail} has ALREADY been spent on an earlier dispatch. One ritual authorizes ONE dispatch — a repeat to the same target is the case this closes, because a re-edited brief at that path carries text the original checks never saw. Re-run the rung and write a NEW nonce.`,
    "no-executed-check": `${SIDECAR} carries no EXECUTED check — each entry needs a non-empty \`command\` AND its captured \`output\`. A bare declaration that the checks happened is precisely the assert-without-executing defect this rung exists to stop.`,
    "kit-config-malformed": `${path.join(KIT_CONFIG)} is present but MALFORMED (not valid JSON, not an object, or \`briefPathDirs\` is not an array of non-empty path segments). This dispatch is BLOCKED (fail-closed) — a corrupt brief-path set must never silently narrow a control's scope. Fix that file, delete it to fall back to the kit's portable defaults, or re-run \`node bin/init.mjs\`.`,
    "lock-unavailable": `the consumption lock beside ${LEDGER} could not be taken, so this dispatch could not be serialised against concurrent ones. An unserialised consume is not a consume — the guard denies rather than allow two dispatches to spend one ritual. Retry; if it persists, remove a stale \`.claude/brief-rung.lock\`.`,
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

export function main({ stdin = process.stdin, cwd = process.cwd(), emit = emitDeny, exit = (c) => process.exit(c) } = {}) {
  let raw = "";
  stdin.on("data", (d) => (raw += d));
  stdin.on("end", () => {
    let input;
    // CANNOT READ THE PAYLOAD ⇒ CANNOT SEE THE DISPATCH. The reference this was modelled on allowed
    // here, reasoning that a broken payload is the harness's defect. But an unparseable payload is
    // exactly the shape a bypass takes, and CS5b killed this same `exit(0)` in guard-cross-repo-writes
    // as one of three fail-opens. Deny is also cheap in the direction that matters: this hook binds a
    // narrow slice of tools, so failing closed on an unreadable payload cannot brick ordinary work.
    try { input = JSON.parse(raw); } catch {
      emit(`guard-brief-rung.mjs blocked this call: its hook payload could not be parsed, so the dispatch it names could not be read. This guard fails CLOSED on a call it cannot see — an unreadable payload is not evidence that nothing was dispatched. ${RITUAL}`);
      return exit(0);
    }

    const root = resolveProjectRoot(input) || cwd;
    const patchBase = resolvePatchBase(input, root);
    const config = loadBriefConfig(root);

    const dispatches = [];
    if (isSendTool(input?.tool_name)) {
      const dest = input?.tool_input?.session_id;
      // A send whose destination cannot be read still owes the rung — it is positively send-shaped.
      // `<unreadable-destination>` can never equal a sidecar's target, so it denies, which is the
      // correct direction for a dispatch this guard cannot identify.
      dispatches.push({ kind: "send", target: typeof dest === "string" && dest ? dest : "<unreadable-destination>" });
    } else if (config.ok) {
      for (const rel of briefTargets(input, { root, patchBase, briefPathDirs: config.briefPathDirs, toRepoRelative })) {
        dispatches.push({ kind: "brief", target: rel });
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
          if (rel === null || INSTRUCTION_ROOT_RE.test(rel) || !/\.md$/i.test(rel)) continue;
          emit(denyReason("kit-config-malformed", { dispatch: { kind: "brief", target: rel } }));
          return exit(0);
        }
      }
    }

    if (!dispatches.length) return exit(0);   // nothing here owes the rung

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

    // READ, JUDGE AND CONSUME UNDER ONE LOCK. Reading the spent set, deciding on it, and appending
    // the row that spends it are one critical section: split them and two concurrent processes both
    // read a nonce as unspent and both allow. Measured before this lock existed: five of six.
    const outcome = withLedgerLock(root, () => {
      let ledgerText;
      try { ledgerText = readFileSync(path.join(root, LEDGER), "utf8"); }
      catch (e) { if (!(e && e.code === "ENOENT")) return { state: "ledger-error", dispatch: dispatches[0] }; }
      const spentNonces = spentNoncesFrom(ledgerText);
      if (spentNonces === null) return { state: "ledger-error", dispatch: dispatches[0] };

      // EVERY dispatch is judged before anything is allowed. A patch envelope is applied as a unit,
      // so deciding on the first match would let a second brief in the same envelope ride the first
      // one's sidecar — the multi-target fail-open the shared grammar exists to prevent.
      const verdicts = dispatches.map((d) => ({ d, v: sidecarState(sidecar, { ageMin: ageMin ?? 0, sessionId: input?.session_id, dispatch: d, spentNonces }) }));
      const blocked = verdicts.find(({ v }) => !ALLOW_STATES.has(v.state));
      if (blocked) {
        return {
          state: blocked.v.state, dispatch: blocked.d,
          detail: blocked.v.named ?? (blocked.v.ageMin !== undefined ? Math.abs(Math.round(blocked.v.ageMin)) : undefined),
        };
      }
      for (const { d, v } of verdicts) {
        const ok = writeLedger(root, {
          decision: "allow", state: v.state, kind: d.kind, target: d.target,
          sessionId: input?.session_id ?? "", checks: v.checks,
          cls: v.state === "status-declared" ? "status" : "load-bearing",
          nonce: v.state === "status-declared" ? undefined : sidecar.nonce,
        });
        if (!ok) return { state: "ledger-error", dispatch: d };
      }
      return null;                                        // allowed
    });
    if (outcome === null && !dispatches.length) return exit(0);
    if (outcome !== null) {
      // `withLedgerLock` returns null for BOTH "allowed" and "could not lock", so the two are
      // distinguished by a sentinel rather than by truthiness — a truthiness read here would map
      // "lock unavailable" onto "allowed", which is the fail-open this lock exists to prevent.
      if (outcome === LOCK_UNAVAILABLE) { emit(denyReason("lock-unavailable", { dispatch: dispatches[0] })); return exit(0); }
      emit(denyReason(outcome.state, { dispatch: outcome.dispatch, detail: outcome.detail }));
      return exit(0);
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
