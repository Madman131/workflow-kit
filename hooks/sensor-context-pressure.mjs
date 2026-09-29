#!/usr/bin/env node
// workflow-kit — .claude/hooks/sensor-context-pressure.mjs. PreToolUse on a write, UserPromptSubmit and Stop (Claude lane).
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
// WHEN IT SPEAKS: two levels, each ONCE per session — a warning at WORKFLOW_KIT_CONTEXT_THRESHOLD_PCT
// (default 50) and a HARD STOP at WORKFLOW_KIT_CONTEXT_HARD_PCT (default 70). A session that jumps
// straight past 70 fires only the hard stop (and counts 50 as done). State is a tiny per-session file
// under the OS temp dir (WORKFLOW_KIT_CONTEXT_STATE_DIR overrides), shared by every event.
//
// STOP ENFORCEMENT (Owner ruling D-50: alerts were being blown past unseen): on the Stop event, if a
// level fired and the final message's first line is not that level's banner, block ONCE per level
// ({"decision":"block","reason":…}, exit 0); never when stop_hook_active; fail OPEN on any error. The
// text comes from the Stop payload's last_assistant_message, not from a transcript read.
//
// HOW IT REACHES THE MODEL: `hookSpecificOutput.additionalContext` on stdout, which Claude Code
// feeds to the model on an exit-0 PreToolUse or UserPromptSubmit hook (hookEventName echoes the
// payload's hook_event_name; the level state is shared by every event); the same text also goes to stderr for the
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

// EXPORTED for the test: 0 below the warn threshold, 1 at/above it, 2 at/above the hard-stop threshold.
export function levelOf(tokens, window, warnPct, hardPct) {
  const p = (100 * tokens) / window;
  if (p >= hardPct) return 2;
  if (p >= warnPct) return 1;
  return 0;
}

// EXPORTED for the test: the banner is the FIRST line of the message, exact text.
export function banner(level, percent) {
  return level === 2
    ? `**CONTEXT WINDOW — HARD STOP ~${percent}%: write the restart digest now and restart before further work**`
    : `**CONTEXT WINDOW WARNING — ~${percent}%: restart this thread at the next natural breakpoint (push / chip end)**`;
}

export function message({ tokens, window, source, percent, level }) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  return `${banner(level, percent)}\nPut the line above VERBATIM as the FIRST line of your next message to the Owner.\n` +
    `(${k(tokens)} of ${k(window)} tokens; window: ${source}. This sensor only reports.)`;
}

function stateFileFor(ev) {
  const file = typeof ev.transcript_path === "string" ? ev.transcript_path : "";
  const key = (typeof ev.session_id === "string" && ev.session_id) || (file && path.basename(file));
  if (!key) return null;
  const stateDir = process.env.WORKFLOW_KIT_CONTEXT_STATE_DIR || os.tmpdir();
  return { stateDir, stateFile: path.join(stateDir, `workflow-kit-context-${key.replace(/[^A-Za-z0-9._-]/g, "_")}`) };
}
// State is JSON: { window, fired, surfaced, blocked, banner } — the highest level announced, the highest
// seen as an Owner-message first line, the highest a Stop block was spent on, and the banner text to match.
function readState(stateFile) {
  try {
    const st = JSON.parse(readFileSync(stateFile, "utf8"));
    if (st && typeof st === "object") return st;
  } catch { /* first time */ }
  return null;
}
function writeState(stateDir, stateFile, st) {
  try {
    mkdirSync(stateDir, { recursive: true });
    let lst = null; try { lst = lstatSync(stateFile); } catch { /* absent */ }
    if (!lst || lst.isFile()) writeFileSync(stateFile, JSON.stringify(st));   // never through a symlink
  } catch { /* speak anyway */ }
}

// Stop: the level fired but the Owner-facing message did not open with its banner ⇒ block ONCE.
// Uses last_assistant_message (the docs' most reliable source), never a transcript read. Fails open.
function stopMain(ev) {
  const loc = stateFileFor(ev);
  if (!loc) return ALLOW();
  const st = readState(loc.stateFile);
  if (!st || !(st.fired > (st.surfaced || 0)) || typeof st.banner !== "string") return ALLOW();
  const msg = ev.last_assistant_message;
  if (typeof msg !== "string") return ALLOW();
  if (msg.split("\n")[0].trim() === st.banner.trim()) {
    writeState(loc.stateDir, loc.stateFile, { ...st, surfaced: st.fired });
    return ALLOW();
  }
  if (ev.stop_hook_active) return ALLOW();                  // already continuing from a block — never loop
  if ((st.blocked || 0) >= st.fired) return ALLOW();        // one block per level
  writeState(loc.stateDir, loc.stateFile, { ...st, blocked: st.fired });
  process.stdout.write(JSON.stringify({ decision: "block", reason: `The context-window banner is owed and your message did not open with it. Put this line VERBATIM as the FIRST line of your message to the Owner, then continue:\n${st.banner}` }));
  process.exit(0);
}

function main(raw) {
  if (process.env.WORKFLOW_KIT_CONTEXT_SENSOR === "false") return ALLOW();
  let ev;
  try { ev = JSON.parse(raw); } catch { return ALLOW(); }
  if (ev === null || typeof ev !== "object") return ALLOW();
  if ("agent_id" in ev || "agent_type" in ev) return ALLOW();      // never nag a subagent
  if (ev.hook_event_name === "Stop") return stopMain(ev);
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
  const warn = pct(process.env, "WORKFLOW_KIT_CONTEXT_THRESHOLD_PCT", 50);
  const hard = pct(process.env, "WORKFLOW_KIT_CONTEXT_HARD_PCT", 70);
  const level = levelOf(tokens, window, warn, hard);
  if (level === 0) return ALLOW();
  const loc = stateFileFor(ev);
  if (!loc) return ALLOW();
  // A level earned against one denominator means nothing against another, so a window change resets.
  let st = readState(loc.stateFile);
  if (!st || st.window !== window) st = { window, fired: 0, surfaced: 0, blocked: 0 };
  if (level <= (st.fired || 0)) return ALLOW();            // each level fires once; a jump to 2 marks 1 done too
  const percent = Math.round((100 * tokens) / window);
  const text2 = message({ tokens, window, source, percent, level });
  writeState(loc.stateDir, loc.stateFile, { ...st, fired: level, banner: banner(level, percent) });
  try { process.stderr.write(`sensor-context-pressure: ${text2}\n`); } catch { /* ignore */ }
  const hookEventName = ev.hook_event_name === "UserPromptSubmit" ? "UserPromptSubmit" : "PreToolUse";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text2 } }));
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
