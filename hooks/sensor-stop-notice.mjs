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
// (anything but an explicit `stop_hook_active:false` ⇒ allow, never repeats) and keeps no state, so it cannot wedge a session.
//
// OBSERVED SHAPES (codex-cli 0.159.2, 2026-09-30; every one below is copied from a real rollout, see the receipt):
//   NOT OBSERVED: whether Stop fires for a subagent turn, and any agent_id/agent_type on a Stop payload. The subagent
//     guard below is a guess; it fails open and block-once bounds it.
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
//     as a role:"user" message whose text is <send_user_message_question_reply> naming that call_id (an Owner message).
//   An Owner message: a role:"user" response_item message whose text does not open with "<" (environment context, hook
//     prompts, open-page markers, skill bodies) or "# AGENTS.md instructions"; a question reply counts as one.
//   A final message: response_item, role "assistant", payload.phase "final_answer".
//
// SESSION SHAPE (v2.46.0, for check (d)). The FIRST line of every rollout is {"type":"session_meta","payload":{…,"originator":…,
//   "source":…,"thread_source":…}}. Measured over 129 rollouts under ~/.codex/sessions (2026-11-21, the probe receipt for (d)):
//     headless seat (scripts/codex-gate.sh, `codex exec -C <repo> -o OUT`):  originator "codex_exec",   source "exec",   thread_source "user"
//     Claude's codex plugin (its last message returns to a Claude session):  originator "Claude Code",  source "vscode", no thread_source
//     Codex Desktop:                                                           originator "Codex Desktop" or "codex_work_desktop", source "vscode", thread_source "user"
//   A Codex subagent's session_meta is UNOBSERVED; an unobserved thread_source fails toward silence (see (d)).
//
// THE FOUR CHECKS (one block, reasons combined; (a)-(c) are the original three):
//   (a) a delegation ARRIVED IN THIS TURN (an earlier turn's, or an Owner-initiated turn with none, never counts), it is
//       not a notice, and this turn sent nothing to its thread. A notice owes no reply: an <input> that, trimmed, opens
//       with `STOP:` or `STATUS:` (ping-pong breaker, D-108/D-109); `CONSULT:`, `RULING NEEDED:` and directives still owe
//       one. NOT CODED: the Owner-ended final close — no transcript shape for it was observed, so a final close is nudged
//       once like any stop, and block-once keeps that cheap. The delegating thread is NOT assumed to be an Architect: a
//       reply from a thread the PM itself messaged also names that thread.
//   (b) this turn has a request_user_input_async call with no recorded ANSWER (the observed output is only the
//       acknowledgement; ANY Owner message after the call answers it, a question reply included) and the final message
//       carries a rule-8 label NOWHERE (trigger (c) is stricter: the label must END the message).
//   (c) an earlier final message carried a labeled Owner ask, no Owner message has come since, and this final message does
//       not END with a rule-8 label that carries text (its last paragraph holds no label line with text after it; a bare
//       label does not count). A relayed Owner answer is NOT recognised (deferred until a Codex relay rollout is observed).
//       UNOBSERVED: how a scheduled heartbeat arrives; if one arrives as a plain user message it reads as an Owner message and
//       (c) stays silent for it.
//
//   (c) (v2.46.0) is reconciled with rule 10: a numbered ask counts as a label line (`1. **DECISION NEEDED:** …`, `2) **ACTION NEEDED:** …`,
//       `**1) DECISION NEEDED:**`), and when the final holds a divider (the one-line `*****INFORMATION FOR <any name>*****` or the legacy asterisks-only line then `INFORMATION FOR <any name>`; name-agnostic
//       because (c) works without an Owner contract) the region that must hold a label with text is everything AFTER THE LAST divider, so a
//       numbered ask list followed by a closing "Reply like 1) a" line passes. With no divider the last-paragraph rule is unchanged.
//   (d) (v2.46.0, rule 10) the final message of an OWNER-FACING session has no `INFORMATION FOR <Owner>` divider. It runs only when: its own off
//       switch is unset; the transcript's first session_meta was found (the 64 MB tail read can drop it: silence); `source` is a string and not
//       "exec"; `originator` is neither "codex_exec" (a headless seat: `-o` keeps the LAST message, so a block would replace the verdict) nor
//       "Claude Code" (the plugin's last message returns to a Claude session, never to the Owner); `thread_source` is absent or "user" (a spawned
//       thread is unobserved and fails toward silence). The predicate and the Owner's name come from the sibling guard-owner-comms.mjs, loaded
//       dynamically: a missing sibling skips (d) only. No Owner contract in `cwd` (dormant) also skips it.
//
// OFF SWITCHES: WORKFLOW_KIT_STOP_NOTICE_SENSOR="false" (all of this file) and WORKFLOW_KIT_OWNER_DIVIDER="false" (check (d) only); explicit string compares.

import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW = () => process.exit(0);
const MAX_BYTES = 64 * 1024 * 1024;   // a real day-long PM rollout is ~15 MB; a larger one is read from its tail, and a missing turn start fails open

// A rule-8 label opens a (possibly bulleted) line. AUTHORIZATION NEEDED carries no colon in its rule-8 form. KIT GAP-ACTION NEEDED
// (v2.41.0) is the Owner's label for a defect in the installed kit; it is an Owner action until forwarded, so it counts like the others.
// v2.46.0: a numbered ask also opens one: an ordered marker before the bold (`1. **…`, `2) **…`) or a number inside it (`**1) …`).
const LABEL_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?\*\*[ \t]*(?:\d+[.)]?[ \t]*)?(?:AUTHORIZATION NEEDED|DECISION NEEDED|KIT GAP-ACTION NEEDED|ACTION NEEDED|QUESTION)\b/m;

export const hasLabel = (text) => typeof text === "string" && LABEL_LINE.test(text);
// The final must END with a label that CARRIES TEXT (v2.42.0): a bare label line ("**ACTION NEEDED:**" and nothing after it in the
// last paragraph) names no action and does not count. The text is whatever follows the label token, up to the next label line or the end
// of the last paragraph, and it must hold a letter or digit.
// A divider, name-agnostic here: the one-line form (asterisks, `INFORMATION FOR <anything>`, asterisks) or the legacy two-line form (an
// asterisks-only line, 3 or more, then as the next non-blank line `INFORMATION FOR <anything>`; accepted in v2.46.0 only).
const ASTERISK_LINE = /^[ \t]*\*{3,}[ \t]*$/;
const INFO_LINE = /^[ \t]*(?:#{1,6}[ \t]+)?[*_]{0,3}[ \t]*INFORMATION[ \t]+FOR[ \t]+\S[^\n]*$/i;
const ONE_LINE_DIVIDER = /^[ \t]*\*+[ \t]*INFORMATION[ \t]+FOR[ \t]+\S.*?\*+[ \t]*$/i;
// The text after the LAST divider line, or null when there is none.
function afterLastDivider(text) {
  const lines = text.split(/\r?\n/);
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (ONE_LINE_DIVIDER.test(lines[i])) { at = i; continue; }
    if (!ASTERISK_LINE.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length && INFO_LINE.test(lines[j])) { at = j; i = j; }
  }
  return at < 0 ? null : lines.slice(at + 1).join("\n");
}
export function endsWithLabel(text) {
  if (typeof text !== "string") return false;
  const region = afterLastDivider(text);
  if (region !== null) {
    // Rule 10: each label's text runs to the next label line or the next blank line; a bare label does not count.
    const marks = [...region.matchAll(new RegExp(LABEL_LINE.source, "gm"))];
    return marks.some((m, k) => {
      const from = m.index + m[0].length;
      let to = k + 1 < marks.length ? marks[k + 1].index : region.length;
      const blank = region.slice(from, to).search(/\n[ \t\r]*\n/);
      if (blank !== -1) to = from + blank;
      return /[\p{L}\p{N}]/u.test(region.slice(from, to));
    });
  }
  const paragraphs = text.trim().split(/\n[ \t]*\n/);
  const last = paragraphs[paragraphs.length - 1];
  const starts = [...last.matchAll(new RegExp(LABEL_LINE.source, "gm"))];
  return starts.some((m, k) => {
    const from = m.index + m[0].length;
    const to = k + 1 < starts.length ? starts[k + 1].index : last.length;
    return /[\p{L}\p{N}]/u.test(last.slice(from, to));
  });
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

const NOTICE_LEAD = /^(?:STOP|STATUS):/;
const textOf = (content) => Array.isArray(content) ? content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("") : "";
const isOwnerMessage = (text) => {
  const t = text.trimStart();
  if (t.startsWith("<send_user_message_question_reply>")) return true;
  return t.length > 0 && !t.startsWith("<") && !t.startsWith("# AGENTS.md instructions");
};

// EXPORTED for the test. Reads the transcript text into the few facts the triggers need, in file order.
export function scan(text) {
  const out = { turnStart: -1, turnId: null, meta: null, delegations: [], sends: [], asks: [], owners: [], finals: [] };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Cheap pre-filters keep a 15 MB rollout fast: token and reasoning lines are never parsed.
    if (!(line.includes('"task_started"') || line.includes('"function_call_output"') || line.includes('"McpToolCall"') ||
          line.includes('"request_user_input_async"') || line.includes('"role":"user"') || line.includes('"final_answer"') || line.includes('"session_meta"'))) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o && o.payload;
    if (!p || typeof p !== "object") continue;
    if (o.type === "session_meta") {   // the FIRST one is the session's own; a later mention never replaces it
      if (!out.meta) out.meta = { originator: p.originator, source: p.source, thread_source: p.thread_source };
      continue;
    }
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
      if (m) out.delegations.push({ i, tid: m[1], notice: NOTICE_LEAD.test((/<input>\s*([\s\S]{0,16})/.exec(p.output) || [])[1] || "") });
    } else if (p.type === "function_call" && p.name === "request_user_input_async" && typeof p.call_id === "string") {
      out.asks.push({ i, callId: p.call_id });
    } else if (p.type === "message" && p.role === "user") {
      const t = textOf(p.content);
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
  const inTurn = sc.delegations.filter((d) => d.i > ts && !d.notice);
  const last = inTurn.length ? inTurn[inTurn.length - 1] : null;
  if (last && !sc.sends.some((s) => s.i > ts && s.tid === last.tid)) {
    reasons.push(`this turn received a message from thread ${last.tid} and sent it none`);
  }
  const unanswered = sc.asks.filter((a) => a.i > ts && !sc.owners.some((o) => o > a.i));
  if (unanswered.length && !hasLabel(finalText)) {
    reasons.push("this turn asked the Owner through request_user_input_async (an acknowledgement is not an answer) and your final message carries no rule-8 label");
  }
  const earlierAsk = [...sc.finals].reverse().find((f) => f.i < ts && hasLabel(f.text));
  if (earlierAsk && !sc.owners.some((o) => o > earlierAsk.i) && !endsWithLabel(finalText)) {
    reasons.push("an earlier labeled Owner ask is still unanswered and your final message does not END with a rule-8 label");
  }
  return { reasons, thread: last ? last.tid : null };
}

export function blockReason({ reasons, thread }, extra = []) {
  const to = thread ? `thread ${thread}` : "your delegating Architect thread";
  return [
    "STOP NOTICE OWED (workflow-kit sensor; it fires once). Before you end this turn:",
    ...reasons.map((r) => `- ${r}.`),
    `- Send ${to} one message: \`STOP: <reason>; next action: <action>; actor: <who must act>\`, unless the work is fully closed and you say so.`,
    "- Put any Owner ask in your FINAL message under a bold rule-8 label (**DECISION NEEDED:**, **ACTION NEEDED:**, **QUESTION:**, **KIT GAP-ACTION NEEDED:** or **AUTHORIZATION NEEDED**) and END the message with it, never only in an async question tool.",
    ...extra,
    "Then end the turn.",
  ].join("\n");
}

// Check (d). Returns the divider block text, or null (owed nothing / cannot tell). Never throws: every doubt is silence.
async function dividerOwed(ev, sc) {
  if (process.env.WORKFLOW_KIT_OWNER_DIVIDER === "false") return null;
  const m = sc.meta;
  if (!m) return null;                                   // no session_meta (a tail read dropped it, or an odd rollout): cannot tell
  if (typeof m.source !== "string" || m.source === "exec") return null;   // headless `codex exec`: `-o` keeps the LAST message, a block would replace the verdict
  if (m.originator === "codex_exec") return null;        // the same headless seat, spelled by originator
  if (m.originator === "Claude Code") return null;       // Claude's codex plugin: the last message returns to a Claude session, never to the Owner
  if (m.thread_source !== undefined && m.thread_source !== "user") return null;   // a spawned thread: unobserved, fails toward silence
  try {
    const g = await import(new URL("./guard-owner-comms.mjs", import.meta.url).href);   // dynamic: a missing sibling skips only this check
    const root = typeof ev.cwd === "string" && ev.cwd ? ev.cwd : process.cwd();
    const contract = g.ownerContract(root);
    if (!contract) return null;                          // dormant: no completed Owner contract
    return g.hasOwnerDivider(ev.last_assistant_message, contract.ownerName) ? null : g.dividerReason(contract.ownerName);
  } catch { return null; }
}

async function main(raw) {
  if (process.env.WORKFLOW_KIT_STOP_NOTICE_SENSOR === "false") return ALLOW();
  let ev;
  try { ev = JSON.parse(raw); } catch { return ALLOW(); }
  if (ev === null || typeof ev !== "object") return ALLOW();
  if (ev.hook_event_name !== "Stop") return ALLOW();
  if ("agent_id" in ev || "agent_type" in ev) return ALLOW();       // never nag a subagent
  if (ev.stop_hook_active !== false) return ALLOW();                // block only on an explicit false: true means already continuing from a block (never loop); absent or non-boolean fails open
  const file = ev.transcript_path;
  const finalText = ev.last_assistant_message;
  if (typeof file !== "string" || !file || typeof finalText !== "string") return ALLOW();
  let text;
  try { if (!lstatSync(file).isFile()) return ALLOW(); text = readCapped(file); } catch { return ALLOW(); }   // symlinked transcript: out of model, not read
  const sc = scan(text);
  if (sc.turnStart < 0) return ALLOW();
  if (typeof ev.turn_id === "string" && sc.turnId && ev.turn_id !== sc.turnId) return ALLOW();   // the transcript is not at this turn: say nothing
  const verdict = evaluate(sc, finalText);
  const divider = await dividerOwed(ev, sc);
  if (!verdict.reasons.length && !divider) return ALLOW();
  // Only (d): its text alone, with no "send thread X a STOP notice" lines. (a)-(c) as well: today's lines unchanged plus the divider instruction.
  process.stdout.write(JSON.stringify({ decision: "block", reason: verdict.reasons.length ? blockReason(verdict, divider ? [`- ${divider}`] : []) : divider }));
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
  process.stdin.on("end", () => { main(raw).catch(ALLOW); });
  process.stdin.on("error", ALLOW);
}
