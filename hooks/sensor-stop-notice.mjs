#!/usr/bin/env node
// workflow-kit — .codex/hooks/sensor-stop-notice.mjs. Stop (Codex lane; registered in .codex/hooks.json).
// Tests: tests/stop-notice.test.mjs · Doctrine: skills/orchestrate/SKILL.md "No silent stop", core/OWNER_COMMS.md rule 8
// Probe receipt (what the Stop payload and the transcript really look like): docs/journal/2026-09-30-codex-stop-probe-receipt.md
//
// WHY THIS EXISTS: a Codex PM ended turns with work owed and told nobody. Measured on one Codex thread in one
// day: it never sent its delegating Architect a notice, and an Owner ask it made only through the async question
// tool never surfaced. A rule an agent must remember at the moment it stops is the self-keyed trigger this kit
// keeps finding fails; this reads the transcript at the stop and forces the notice once.
//
// THIS IS A SENSOR THAT BLOCKS ONCE. It exits 0 on every path and FAILS OPEN: empty or non-JSON stdin, a missing,
// unreadable, symlinked or malformed transcript, no turn start in it, a turn id that disagrees with the payload —
// all produce silence. Silence proves nothing; only a block is evidence. It blocks at most once per turn
// (`stop_hook_active` true ⇒ allow, never repeats) and keeps no state, so it cannot wedge a session.
//
// OBSERVED SHAPES (codex-cli 0.159.2, 2026-09-30; every one below is copied from a real rollout, see the receipt):
//   Stop payload: session_id, turn_id, transcript_path, cwd, hook_event_name:"Stop", model, permission_mode,
//     stop_hook_active, last_assistant_message. The final message is already in the transcript when the hook runs.
//   Transcript line: {timestamp, ordinal, type, payload}. Turn start: type "event_msg", payload.type "task_started",
//     payload.turn_id (equal to the Stop payload's turn_id).
//   A message FROM another thread: type "response_item", payload.type "function_call_output", namespace "codex_app",
//     name "create_thread" or "send_message_to_thread", output "<codex_delegation><source_thread_id>ID</source_thread_id>…".
//   A message this thread SENT: NEVER a function_call named send_message_to_thread. It is type "event_msg",
//     payload.type "item_completed", payload.item {type:"McpToolCall", server:"codex_app", tool:"send_message_to_thread",
//     status:"completed", arguments:{threadId, prompt}}. (The same send also appears as an `exec` custom_tool_call whose
//     input is JavaScript; this sensor does not parse that.)
//   An async Owner ask: type "response_item", payload.type "function_call", name "request_user_input_async", call_id.
//     Its function_call_output is only {"accepted":true} — an acknowledgement, NOT an answer. The answer arrives later
//     as a role:"user" message whose text is <send_user_message_question_reply> naming that call_id.
//   An Owner message: a role:"user" response_item message whose text does not open with "<" (environment context, hook
//     prompts, open-page markers, skill bodies) or "# AGENTS.md instructions"; a question reply counts as one.
//   A final message: response_item, role "assistant", payload.phase "final_answer".
//
// THE THREE TRIGGERS (one block, reasons combined):
//   (a) the transcript's LATEST delegation names a thread, this turn sent nothing to it, and the turn is not the
//       Owner-ended final close. NOT CODED: the Owner-ended close — no transcript shape for it was observed, so a final
//       close is nudged once like any stop, and block-once keeps that cheap. The delegating thread is NOT assumed to be
//       an Architect: a reply from a thread the PM itself messaged also names that thread.
//   (b) this turn has a request_user_input_async call with no recorded ANSWER (the observed output is only the
//       acknowledgement) and the final message carries no rule-8 label.
//   (c) an earlier final message carried a labeled Owner ask, no Owner message has come since, and this final message does
//       not END with a rule-8 label (its last paragraph holds no label line). UNOBSERVED: how a scheduled heartbeat
//       arrives; if one arrives as a plain user message it reads as an Owner message and (c) stays silent for it.
//
// OFF SWITCH: WORKFLOW_KIT_STOP_NOTICE_SENSOR="false" (explicit string compare).

import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW = () => process.exit(0);
const MAX_BYTES = 64 * 1024 * 1024;   // a real day-long PM rollout is ~15 MB; a larger one is read from its tail, and a missing turn start fails open

// A rule-8 label opens a (possibly bulleted) line. AUTHORIZATION NEEDED carries no colon in its rule-8 form.
const LABEL_LINE = /^[ \t]*(?:[-*+][ \t]+)?\*\*[ \t]*(?:AUTHORIZATION NEEDED|DECISION NEEDED|ACTION NEEDED|QUESTION)\b/m;

export const hasLabel = (text) => typeof text === "string" && LABEL_LINE.test(text);
export function endsWithLabel(text) {
  if (typeof text !== "string") return false;
  const paragraphs = text.trim().split(/\n[ \t]*\n/);
  return LABEL_LINE.test(paragraphs[paragraphs.length - 1]);
}

function readCapped(file) {
  const size = lstatSync(file).size;
  if (size <= MAX_BYTES) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(MAX_BYTES);
    readSync(fd, buf, 0, MAX_BYTES, size - MAX_BYTES);
    const tail = buf.toString("utf8");
    return tail.slice(tail.indexOf("\n") + 1);
  } finally { closeSync(fd); }
}

const textOf = (content) => Array.isArray(content) ? content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("") : "";
const isOwnerMessage = (text) => {
  const t = text.trimStart();
  if (t.startsWith("<send_user_message_question_reply>")) return true;
  return t.length > 0 && !t.startsWith("<") && !t.startsWith("# AGENTS.md instructions");
};

// EXPORTED for the test. Reads the transcript text into the few facts the triggers need, in file order.
export function scan(text) {
  const out = { turnStart: -1, turnId: null, delegations: [], sends: [], asks: [], replies: [], owners: [], finals: [] };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Cheap pre-filters keep a 15 MB rollout fast: token and reasoning lines are never parsed.
    if (!(line.includes('"task_started"') || line.includes('"function_call_output"') || line.includes('"McpToolCall"') ||
          line.includes('"request_user_input_async"') || line.includes('"role":"user"') || line.includes('"final_answer"'))) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o && o.payload;
    if (!p || typeof p !== "object") continue;
    if (o.type === "event_msg") {
      if (p.type === "task_started") { out.turnStart = i; out.turnId = typeof p.turn_id === "string" ? p.turn_id : null; }
      else if (p.type === "item_completed" && p.item && p.item.type === "McpToolCall" && p.item.server === "codex_app" &&
               p.item.tool === "send_message_to_thread" && p.item.status === "completed" && p.item.arguments &&
               typeof p.item.arguments.threadId === "string") out.sends.push({ i, tid: p.item.arguments.threadId });
      continue;
    }
    if (o.type !== "response_item") continue;
    if (p.type === "function_call_output" && p.namespace === "codex_app" && (p.name === "create_thread" || p.name === "send_message_to_thread") && typeof p.output === "string") {
      const m = /<codex_delegation>[\s\S]*?<source_thread_id>\s*([^<\s]+)\s*<\/source_thread_id>/.exec(p.output);
      if (m) out.delegations.push({ i, tid: m[1] });
    } else if (p.type === "function_call" && p.name === "request_user_input_async" && typeof p.call_id === "string") {
      out.asks.push({ i, callId: p.call_id });
    } else if (p.type === "message" && p.role === "user") {
      const t = textOf(p.content);
      if (t.startsWith("<send_user_message_question_reply>")) for (const m of t.matchAll(/request_user_input_async\W{1,8}(call_[A-Za-z0-9_-]+)/g)) out.replies.push({ i, callId: m[1] });
      if (isOwnerMessage(t)) out.owners.push(i);
    } else if (p.type === "message" && p.role === "assistant" && p.phase === "final_answer") {
      out.finals.push({ i, text: textOf(p.content) });
    }
  }
  return out;
}

// EXPORTED for the test. Returns the list of reasons the stop owes a notice (empty ⇒ allow).
export function evaluate(sc, finalText) {
  const reasons = [];
  const ts = sc.turnStart;
  const last = sc.delegations.length ? sc.delegations[sc.delegations.length - 1] : null;
  if (last && !sc.sends.some((s) => s.i > ts && s.tid === last.tid)) {
    reasons.push(`this turn sent thread ${last.tid} no message (its latest message to you came from that thread)`);
  }
  const unanswered = sc.asks.filter((a) => a.i > ts && !sc.replies.some((r) => r.i > a.i && r.callId === a.callId));
  if (unanswered.length && !hasLabel(finalText)) {
    reasons.push("this turn asked the Owner through request_user_input_async (an acknowledgement is not an answer) and your final message carries no rule-8 label");
  }
  const earlierAsk = [...sc.finals].reverse().find((f) => f.i < ts && hasLabel(f.text));
  if (earlierAsk && !sc.owners.some((o) => o > earlierAsk.i) && !endsWithLabel(finalText)) {
    reasons.push("an earlier labeled Owner ask is still unanswered and your final message does not END with a rule-8 label");
  }
  return { reasons, thread: last ? last.tid : null };
}

export function blockReason({ reasons, thread }) {
  const to = thread ? `thread ${thread}` : "your delegating Architect thread";
  return [
    "STOP NOTICE OWED (workflow-kit sensor; it fires once). Before you end this turn:",
    ...reasons.map((r) => `- ${r}.`),
    `- Send ${to} one message: \`STOP: <reason>; next action: <action>; actor: <who must act>\`, unless the work is fully closed and you say so.`,
    "- Put any Owner ask in your FINAL message under a bold rule-8 label (**DECISION NEEDED:**, **ACTION NEEDED:**, **QUESTION:** or **AUTHORIZATION NEEDED**) and END the message with it, never only in an async question tool.",
    "Then end the turn.",
  ].join("\n");
}

function main(raw) {
  if (process.env.WORKFLOW_KIT_STOP_NOTICE_SENSOR === "false") return ALLOW();
  let ev;
  try { ev = JSON.parse(raw); } catch { return ALLOW(); }
  if (ev === null || typeof ev !== "object") return ALLOW();
  if (ev.hook_event_name !== "Stop") return ALLOW();
  if ("agent_id" in ev || "agent_type" in ev) return ALLOW();       // never nag a subagent
  if (ev.stop_hook_active) return ALLOW();                          // already continuing from a block — never loop
  const file = ev.transcript_path;
  const finalText = ev.last_assistant_message;
  if (typeof file !== "string" || !file || typeof finalText !== "string") return ALLOW();
  let text;
  try { if (!lstatSync(file).isFile()) return ALLOW(); text = readCapped(file); } catch { return ALLOW(); }   // symlinked transcript: out of model, not read
  const sc = scan(text);
  if (sc.turnStart < 0) return ALLOW();
  if (typeof ev.turn_id === "string" && sc.turnId && ev.turn_id !== sc.turnId) return ALLOW();   // the transcript is not at this turn: say nothing
  const verdict = evaluate(sc, finalText);
  if (!verdict.reasons.length) return ALLOW();
  process.stdout.write(JSON.stringify({ decision: "block", reason: blockReason(verdict) }));
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
