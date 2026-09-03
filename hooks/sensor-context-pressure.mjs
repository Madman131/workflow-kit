#!/usr/bin/env node
// workflow-kit — .claude/hooks/sensor-context-pressure.mjs. PreToolUse on a write (Claude lane).
// Tests: tests/context-pressure.test.mjs · Doctrine: the thread-restart digest (commands/*/thread-restart.md)
//
// WHY THIS EXISTS: the thread-restart digest is the method's answer to a long thread — a verified
// extraction, written on purpose, instead of the lossy auto-summary compaction produces. But nothing
// says WHEN. It is judgment-triggered, and the standing diagnosis of controls that stopped working is
// that SELF-KEYED TRIGGERS FAIL WHILE EXTERNALLY-FORCED ONES WORK (sensor-sweep-owed.mjs). This is the
// external force: it reads the REAL context size of the session and says, at evidence-based points,
// that the digest is owed — before compaction writes one for you.
//
// THIS IS A SENSOR, NOT A CONTROL. It never denies, exits 0 on every path, and FAILS OPEN — an
// unreadable transcript, a missing field, a subagent payload all produce silence. Silence therefore
// proves nothing about the context; only a message is evidence.
//
// THE MEASUREMENT: the newest MAIN-session assistant `usage` record in the transcript (a subagent's
// turns land in the same file with their own context and possibly their own model, and are ignored
// here); input + cache_creation + cache_read tokens partition the prompt, so their sum is the context
// size of that turn (shared with the token ledger — one function, one fact). Only the transcript
// TAIL (4 MiB) is read, so the hook stays cheap on a large session — if more than that of subagent
// records follows the newest main turn, the sensor is silent until the next main turn writes a
// fresh record; it fails open, and a burst of subagent output is not the moment the digest is due.
//
// THE WINDOW is the denominator, and it is the least certain number here. Order of trust:
//   1. WORKFLOW_KIT_CONTEXT_WINDOW (tokens) — an operator's explicit override wins;
//   2. a `[1m]` marker in the model id;
//   3. a family known to ship a 1M window (KNOWN_1M below — a dated list, expected to lag; the
//      override exists because it will);
//   4. an observed size above 200k, which implies a larger window without saying which;
//   5. otherwise 200k, ASSUMED. The message says which of these it used, because a percentage
//      against a guessed denominator is a number that looks more exact than it is.
//
// WHEN IT SPEAKS: at WORKFLOW_KIT_CONTEXT_THRESHOLD_PCT (default 50) of the window, then once per
// further WORKFLOW_KIT_CONTEXT_STEP_PCT (default 10) — bucket transitions only, tracked in a tiny
// per-session file under the OS temp dir (WORKFLOW_KIT_CONTEXT_STATE_DIR overrides). Declared
// state, deliberately: a stateless sensor would fire on every edit past the threshold, and a hook
// that fires on ordinary work is the hook the reader switches off.
//
// HOW IT REACHES THE MODEL: `hookSpecificOutput.additionalContext` on stdout, which Claude Code
// feeds to the model on an exit-0 PreToolUse hook; the same text also goes to stderr for the
// transcript view. (The kit's older sensors write stderr only; whether that text reaches the model
// is a harness fact this file does not assert about them.)
//
// CODEX LANE: the payload carries no transcript_path, so this exits silently there; it installs
// (the two hook trees stay byte-identical) and is not registered, like the Stop sensors.
//
// OFF SWITCH: WORKFLOW_KIT_CONTEXT_SENSOR="false" (explicit string compare).
//
// Origin: the transcript-tail read, the prompt-size sum, the window inference and the bucket
// re-reminder are ECC's scripts/lib/transcript-context.js + scripts/hooks/suggest-compact.js
// (affaan-m/ECC @ 22e8cf0, MIT); rewritten in this kit's hook idiom, pointed at the digest rather
// than at /compact, and defaulted to 50% rather than 80% because the digest is written BEFORE
// pressure, not at it.

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeTranscript } from "./sensor-token-ledger.mjs";

const ALLOW = () => process.exit(0);
const TAIL_BYTES = 4 * 1024 * 1024;   // the newest usage record is what matters; a single record over 4 MiB is out of model
const STANDARD_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;
// Families known to ship a 1M window as of 2026-09-03 (Anthropic's model docs). Matched on BOTH
// boundaries: the family must start the id or follow a non-alphanumeric character, and a `-mini` or
// other letter suffix does not match while a dated suffix (`-20260115`) does. EXPECTED TO LAG; the
// override exists because it will.
const KNOWN_1M = ["claude-opus-5", "claude-fable-5", "claude-mythos-5", "claude-sonnet-5"];

function readTail(file, maxBytes) {
  const size = statSync(file).size;
  if (size <= maxBytes) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    const tail = buf.toString("utf8");
    return tail.slice(tail.indexOf("\n") + 1);
  } finally { closeSync(fd); }
}

function familyMatch(model, family) {
  let from = 0;
  for (;;) {
    const i = model.indexOf(family, from);
    if (i === -1) return false;
    const before = i === 0 ? "" : model[i - 1];
    const rest = model.slice(i + family.length);
    if (!/[A-Za-z0-9]/.test(before) && !/^[A-Za-z0-9]/.test(rest) && !/^-[A-Za-z]/.test(rest)) return true;
    from = i + 1;
  }
}

// EXPORTED for the test. Returns { window, source } where source names which rule decided.
export function resolveWindow(tokens, model, env = process.env) {
  const override = /^\d+$/.test(env.WORKFLOW_KIT_CONTEXT_WINDOW || "") ? Number(env.WORKFLOW_KIT_CONTEXT_WINDOW) : NaN;
  if (Number.isInteger(override) && override > 0) return { window: override, source: "override" };
  const m = typeof model === "string" ? model : "";
  if (m.includes("[1m]")) return { window: LARGE_WINDOW, source: "model marker" };
  if (KNOWN_1M.some((f) => familyMatch(m, f))) return { window: LARGE_WINDOW, source: "known family" };
  if (Number.isFinite(tokens) && tokens > STANDARD_WINDOW) return { window: LARGE_WINDOW, source: "inferred from size (assumed 1M)" };
  return { window: STANDARD_WINDOW, source: "assumed 200k — set WORKFLOW_KIT_CONTEXT_WINDOW" };
}

function pct(env, key, dflt) {
  const raw = env[key] || "";
  const v = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(v) && v > 0 && v <= 100 ? v : dflt;
}

// EXPORTED for the test: the bucket a context size falls in (-1 below threshold; 0 at threshold;
// +1 per step of growth). The sensor speaks only when the bucket rises.
export function bucketOf(tokens, window, thresholdPct, stepPct) {
  const p = (100 * tokens) / window;
  if (!(p >= thresholdPct)) return -1;
  return Math.floor((p - thresholdPct) / stepPct);
}

export function message({ tokens, window, source, percent }) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  return `CONTEXT PRESSURE — ~${k(tokens)} of ${k(window)} tokens (${percent}%) in this session's context ` +
    `(window: ${source}). The thread-restart digest is OWED at the next phase boundary: write it ` +
    `deliberately (/thread-restart) before auto-compaction writes a lossy one. Finish the step in ` +
    `hand, land or note anything only this thread knows, then restart. This sensor only reports; ` +
    `it will speak again after each further ${pct(process.env, "WORKFLOW_KIT_CONTEXT_STEP_PCT", 10)}% of growth.`;
}

function main(raw) {
  if (process.env.WORKFLOW_KIT_CONTEXT_SENSOR === "false") return ALLOW();
  let ev;
  try { ev = JSON.parse(raw); } catch { return ALLOW(); }
  if (ev === null || typeof ev !== "object") return ALLOW();
  if ("agent_id" in ev || "agent_type" in ev) return ALLOW();      // never nag a subagent
  const file = ev.transcript_path;
  if (typeof file !== "string" || !file) return ALLOW();          // Codex payloads land here
  let text;
  try { if (!lstatSync(file).isFile()) return ALLOW(); text = readTail(file, TAIL_BYTES); } catch { return ALLOW(); }   // symlinked transcript: out of model, not read
  const sum = summarizeTranscript(text);
  // The MAIN session's newest record. A subagent's turn lands in the same transcript with its own,
  // unrelated context size; measuring that would silence or fire this sensor on the wrong number.
  const tokens = sum.context_now_main;
  if (!(tokens > 0)) return ALLOW();
  const { window, source } = resolveWindow(tokens, sum.model_main);   // the MAIN session's model sets the denominator
  const threshold = pct(process.env, "WORKFLOW_KIT_CONTEXT_THRESHOLD_PCT", 50);
  const step = pct(process.env, "WORKFLOW_KIT_CONTEXT_STEP_PCT", 10);
  const bucket = bucketOf(tokens, window, threshold, step);
  if (bucket < 0) return ALLOW();
  // Bucket state, per session. Unreadable/unwritable state ⇒ speak (fail toward the reminder, which
  // costs a line, rather than toward silence, which costs the digest).
  const key = (typeof ev.session_id === "string" && ev.session_id) || path.basename(file);
  const stateDir = process.env.WORKFLOW_KIT_CONTEXT_STATE_DIR || os.tmpdir();
  const stateFile = path.join(stateDir, `workflow-kit-context-${key.replace(/[^A-Za-z0-9._-]/g, "_")}`);
  // State = "<bucket>:<window>". A bucket earned against one denominator means nothing against
  // another (a session that switches from a 200k to a 1M model must not have its 1M reminders
  // suppressed by a 200k bucket), so a window change resets the memory.
  let last = -1;
  try {
    const [b, w] = readFileSync(stateFile, "utf8").trim().split(":");
    if (/^-?\d+$/.test(b || "") && Number(w) === window) last = Number(b);
  } catch { /* first time */ }
  if (bucket <= last) return ALLOW();
  try {
    mkdirSync(stateDir, { recursive: true });
    let lst = null; try { lst = lstatSync(stateFile); } catch { /* absent */ }
    if (!lst || lst.isFile()) writeFileSync(stateFile, `${bucket}:${window}`);   // never through a symlink
  } catch { /* speak anyway */ }
  const percent = Math.round((100 * tokens) / window);
  const text2 = message({ tokens, window, source, percent });
  try { process.stderr.write(`sensor-context-pressure: ${text2}\n`); } catch { /* ignore */ }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text2 } }));
  process.exit(0);
}

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
