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
// usage, summed. Rows are appended per turn, so `scripts/token-report.mjs` takes the LATEST row per
// session and never sums rows (summing would multiply-count). Two sums per row:
//   main      — the session's own turns;
//   sidechain — turns flagged `isSidechain` (Agent-tool subagents: cold seats, panels, explorers),
//               which land in the SAME transcript. Splitting them is what separates gate spend from
//               build spend, the one comparison the method has never had a number for.
// A row also carries the task id and tier from `.claude/task-lane.json` (when declared) so spend is
// attributable per changeset, and `context_now` — the prompt size of the latest turn — so the
// ledger doubles as a record of context pressure.
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
// without `message.id` are counted per line (over-count possible, and the row says how many).
//
// OFF SWITCH: WORKFLOW_KIT_TOKEN_LEDGER="false" (explicit string compare — "false" is truthy).
// LEDGER PATH: WORKFLOW_KIT_TOKEN_LEDGER_PATH overrides `<project>/.claude/metrics/tokens.jsonl`.
//
// Origin: the dedupe rule and the per-Stop snapshot shape come from ECC's scripts/hooks/cost-tracker.js
// (affaan-m/ECC @ 22e8cf0, MIT); rewritten in this kit's hook idiom, with the lane attribution and
// the main/sidechain split added.

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
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
  let latest = null;               // the newest usage record, for context_now
  let model = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const msg = e?.message;
    const role = msg?.role ?? e?.type;
    if (role !== "assistant" || !msg?.usage || typeof msg.usage !== "object") continue;
    const rec = { usage: msg.usage, side: e.isSidechain === true };
    if (typeof msg.model === "string" && msg.model) model = msg.model;
    latest = msg.usage;
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
  const context_now = latest
    ? num(latest.input_tokens) + num(latest.cache_creation_input_tokens) + num(latest.cache_read_input_tokens)
    : 0;
  return { main, sidechain, model, context_now, unkeyed };
}

function readLane(projectRoot) {
  try {
    const l = JSON.parse(readFileSync(path.join(projectRoot, ".claude", "task-lane.json"), "utf8"));
    return { task_id: typeof l.taskId === "string" ? l.taskId : null, tier: typeof l.tier === "string" ? l.tier : null, mode: typeof l.mode === "string" ? l.mode : null };
  } catch { return { task_id: null, tier: null, mode: null }; }
}

function main(raw) {
  if (process.env.WORKFLOW_KIT_TOKEN_LEDGER === "false") return ALLOW();
  let input;
  try { input = JSON.parse(raw); } catch { return ALLOW(); }
  const file = input?.transcript_path;
  if (typeof file !== "string" || !file) return ALLOW();
  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let tail;
  try { tail = readTail(file, MAX_BYTES); } catch { return ALLOW(); }
  const sum = summarizeTranscript(tail.text);
  const row = {
    ts: new Date().toISOString(),
    session_id: typeof input.session_id === "string" ? input.session_id : null,
    ...readLane(projectRoot),
    model: sum.model || null,
    transcript: path.basename(file),
    main: sum.main,
    sidechain: sum.sidechain,
    context_now: sum.context_now,
    unkeyed_messages: sum.unkeyed,
    truncated: tail.truncated,
    stop_hook_active: input.stop_hook_active === true,
  };
  const ledger = process.env.WORKFLOW_KIT_TOKEN_LEDGER_PATH || path.join(projectRoot, ".claude", "metrics", "tokens.jsonl");
  try {
    mkdirSync(path.dirname(ledger), { recursive: true });
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
