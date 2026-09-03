#!/usr/bin/env node
// workflow-kit — .claude/hooks/sensor-token-ledger.mjs. A Claude Code **Stop** hook that appends one
// row of token usage per turn to an UNTRACKED ledger, `.claude/metrics/tokens.jsonl`.
// Tests: tests/token-ledger.test.mjs · Report: scripts/token-report.mjs
//
// THIS IS A SENSOR, NOT A CONTROL. It FAILS OPEN — every parse error, missing field, unreadable
// transcript or unwritable ledger ALLOWS silently (exit 0, nothing on stdout). It never blocks a
// turn and never changes a decision. A missing row therefore proves nothing about a session.
//
// WHY IT EXISTS: this kit's whole efficiency argument (RULE #1, the entry rule, proportional panel
// weight) is about the cost of gates — and the cost was only ever counted in ROUNDS and VERDICTS
// by hand, never in tokens. A number nobody measures cannot be tuned. This writes the number.
//
// WHAT A ROW IS: a CUMULATIVE snapshot of the session at this Stop — every assistant message's
// usage, summed — PLUS the DELTA since this session's previous row in the same ledger, so a report
// can attribute spend to the day and task in which it happened rather than to whichever row came
// last. Two sums per row, each with cumulative and delta:
//   main      — the session's own turns;
//   sidechain — turns flagged `isSidechain` (Agent-tool subagents), which land in the SAME
//               transcript. This is a TOPOLOGY split, not a purpose split: in this method the cold
//               seats and panels run as subagents, so it is a usable proxy for gate spend versus
//               build spend — a proxy, and the report says so.
// A row carries the task id and tier from `.claude/task-lane.json` ONLY when that declaration's
// sessionId matches the Stop payload's session_id (a lane belongs to one session; a mismatch is
// recorded as `lane_mismatch: true` with null attribution), and `context_now` — the prompt size of
// the latest turn — so the ledger doubles as a record of context pressure. It also records
// `skipped_lines` (unparseable transcript lines) so a partial count is visible as partial.
//
// DEDUPE BY message.id — load-bearing. Claude Code writes one JSONL line per content block, each
// repeating the SAME `message.usage`; summing lines over-counts ~2.5-3× (ECC measured a session at
// $867 line-summed vs $333 deduped). Usage is counted once per id; the last line seen wins.
//
// TOKENS ONLY, NO DOLLARS. A price table in a shipped file is a hand-kept mirror of a vendor page,
// and a mirror goes stale silently; tokens are the ground truth and are what the Owner is billed in.
//
// LIMITS, stated: Codex CLI seats run outside this transcript and are not captured; a transcript
// over MAX_BYTES is read from its tail and the row says `truncated: true`; older transcript shapes
// without `message.id` are counted per line (over-count possible, and the row says how many); a
// Stop payload without a session_id writes NO row (rows are keyed by session, and a null key would
// merge unrelated sessions); a transcript path that is not a regular file is not read.
//
// OFF SWITCH: WORKFLOW_KIT_TOKEN_LEDGER="false" (explicit string compare — "false" is truthy).
// LEDGER PATH: WORKFLOW_KIT_TOKEN_LEDGER_PATH overrides `<project>/.claude/metrics/tokens.jsonl`.
//
// Origin: the dedupe rule and the per-Stop snapshot shape come from ECC's scripts/hooks/cost-tracker.js
// (affaan-m/ECC @ 22e8cf0, MIT); rewritten in this kit's hook idiom, with the lane attribution and
// the main/sidechain split added.

import { appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW = () => process.exit(0);
const MAX_BYTES = 64 * 1024 * 1024;

function readTail(file, maxBytes) {
  const size = statSync(file).size;
  if (size <= maxBytes) return { text: readFileSync(file, "utf8"), truncated: false };
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    const tail = buf.toString("utf8");
    return { text: tail.slice(tail.indexOf("\n") + 1), truncated: true };
  } finally { closeSync(fd); }
}

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const emptySum = () => ({ input: 0, output: 0, cache_creation: 0, cache_read: 0, messages: 0 });

// EXPORTED so the test drives the same function the hook runs.
export function summarizeTranscript(text) {
  const byId = new Map();          // message.id → { usage, side }
  let unkeyed = 0;                 // lines with usage but no id — counted once each, and reported
  const unkeyedRows = [];
  let latest = null;               // the newest usage record of any kind, for context_now
  let latestMain = null;           // the newest MAIN (non-sidechain) record — the session's own context
  let model = "";
  let modelMain = "";              // the MAIN session's model — a subagent may run a different one
  let skipped = 0;                 // unparseable lines — reported, never hidden inside a clean-looking row
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { skipped++; continue; }
    const msg = e?.message;
    const role = msg?.role ?? e?.type;
    if (role !== "assistant" || !msg?.usage || typeof msg.usage !== "object") continue;
    const rec = { usage: msg.usage, side: e.isSidechain === true };
    if (typeof msg.model === "string" && msg.model) { model = msg.model; if (!rec.side) modelMain = msg.model; }
    latest = msg.usage;
    if (!rec.side) latestMain = msg.usage;
    if (typeof msg.id === "string" && msg.id) byId.set(msg.id, rec);
    else { unkeyed++; unkeyedRows.push(rec); }
  }
  const main = emptySum(), sidechain = emptySum();
  for (const { usage, side } of [...byId.values(), ...unkeyedRows]) {
    const t = side ? sidechain : main;
    t.input += num(usage.input_tokens);
    t.output += num(usage.output_tokens);
    t.cache_creation += num(usage.cache_creation_input_tokens);
    t.cache_read += num(usage.cache_read_input_tokens);
    t.messages += 1;
  }
  const size = (u) => (u ? num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens) : 0);
  return { main, sidechain, model, model_main: modelMain, context_now: size(latest), context_now_main: size(latestMain), unkeyed, skipped };
}

// The previous row for this session. Read from a bounded tail (PREV_TAIL) so a Stop never scans an
// unbounded file; if the ledger is larger than the tail and no prior row for this session is in it,
// the baseline is UNKNOWN and no delta is claimed — never "zero", which would re-count the whole
// cumulative. A prior row whose sums are not valid numbers is likewise unknown.
const PREV_TAIL = 8 * 1024 * 1024;
const SUM_KEYS = ["input", "output", "cache_creation", "cache_read", "messages"];
const validSum = (o) => o && typeof o === "object" && SUM_KEYS.every((k) => Number.isFinite(o[k]) && o[k] >= 0);
function previousRow(ledger, sessionId) {
  let tail;
  try { if (!lstatSync(ledger).isFile()) return { known: true, row: null }; tail = readTail(ledger, PREV_TAIL); } catch { return { known: true, row: null }; }
  let prev = null;
  for (const line of tail.text.split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && r.session_id === sessionId) prev = r; } catch { /* skip */ }
  }
  if (!prev) return tail.truncated ? { known: false, row: null } : { known: true, row: null };
  if (!validSum(prev.main) || !validSum(prev.sidechain)) return { known: false, row: null };
  return { known: true, row: prev };
}

const delta = (cur, prev) => {
  const d = emptySum();
  for (const k of Object.keys(d)) d[k] = Math.max(0, (cur?.[k] || 0) - (prev?.[k] || 0));
  return d;
};

// Lane attribution is bound to the SESSION: the declaration names the session it belongs to, and a
// row is tagged only when that matches the payload's session_id (hooks/guard-lane-authoring.mjs
// binds the same way). Anything else is null attribution plus a visible mismatch flag.
function readLane(projectRoot, sessionId) {
  const none = { task_id: null, tier: null, mode: null, lane_mismatch: false };
  try {
    const l = JSON.parse(readFileSync(path.join(projectRoot, ".claude", "task-lane.json"), "utf8"));
    if (typeof l.sessionId !== "string" || l.sessionId !== sessionId) return { ...none, lane_mismatch: true };
    return { task_id: typeof l.taskId === "string" ? l.taskId : null, tier: typeof l.tier === "string" ? l.tier : null, mode: typeof l.mode === "string" ? l.mode : null, lane_mismatch: false };
  } catch { return none; }
}

function main(raw) {
  if (process.env.WORKFLOW_KIT_TOKEN_LEDGER === "false") return ALLOW();
  let input;
  try { input = JSON.parse(raw); } catch { return ALLOW(); }
  const file = input?.transcript_path;
  if (typeof file !== "string" || !file) return ALLOW();
  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : null;
  if (!sessionId) return ALLOW();                                 // no key ⇒ no row (never merge sessions)
  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let tail;
  try { if (!lstatSync(file).isFile()) return ALLOW(); tail = readTail(file, MAX_BYTES); } catch { return ALLOW(); }   // a symlinked transcript is out of model: not read
  const sum = summarizeTranscript(tail.text);
  const ledger = process.env.WORKFLOW_KIT_TOKEN_LEDGER_PATH || path.join(projectRoot, ".claude", "metrics", "tokens.jsonl");
  const prev = previousRow(ledger, sessionId);
  const row = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    ...readLane(projectRoot, sessionId),
    model: sum.model || null,
    transcript: path.basename(file),
    main: sum.main,
    sidechain: sum.sidechain,
    // A truncated read is a sliding window, not a cumulative: its difference from the previous row
    // is not a delta, so none is claimed and the report counts the row as spend-unknown.
    delta: (tail.truncated || !prev.known) ? null : { main: delta(sum.main, prev.row?.main), sidechain: delta(sum.sidechain, prev.row?.sidechain) },
    delta_unknown_reason: tail.truncated ? "transcript truncated" : (!prev.known ? "previous row unknown or invalid" : null),
    context_now: sum.context_now,
    unkeyed_messages: sum.unkeyed,
    skipped_lines: sum.skipped,
    truncated: tail.truncated,
    stop_hook_active: input.stop_hook_active === true,
  };
  try {
    mkdirSync(path.dirname(ledger), { recursive: true });
    let lst = null; try { lst = lstatSync(ledger); } catch { /* absent: will be created */ }
    if (lst && !lst.isFile()) return ALLOW();                        // a FIFO/symlink/dir ledger path: never open it
    appendFileSync(ledger, JSON.stringify(row) + "\n");
  } catch { /* fail open */ }
  ALLOW();
}

// Run ONLY as a script (the test imports summarizeTranscript). Realpath compare: on macOS /tmp and
// /var are symlinks into /private, where this kit's worktrees live — see guard-owner-comms.mjs.
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const resolve = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
  } catch { return false; }
})();

if (isMain) {
  let raw = "";
  process.stdin.on("data", (c) => { raw += c; });
  process.stdin.on("end", () => { try { main(raw); } catch { ALLOW(); } });
  process.stdin.on("error", ALLOW);
}
