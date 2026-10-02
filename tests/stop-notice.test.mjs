// workflow-kit — tests for the Codex Stop sensor (hooks/sensor-stop-notice.mjs). Silent-failure surface, so BOTH polarities:
//   · every bad input is ALLOWED (exit 0, EMPTY stdout);
//   · a real block names the thread and the four fields, and fires ONCE (stop_hook_active ⇒ allow);
//   · each trigger blocks on its positive and stays silent on its negative;
//   · init registers the Stop entry exactly once, and --force does not duplicate it.
// Transcript records come from tests/stop-notice-fixtures.mjs, which copies the shapes of real Codex rollouts.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { endsWithLabel, hasLabel } from "../hooks/sensor-stop-notice.mjs";
import * as F from "./stop-notice-fixtures.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(KIT, "hooks", "sensor-stop-notice.mjs");
const T1 = "01a0f4b0-ddaa-7820-ae21-1a5b2b480dc0";   // the turn being stopped
const T0 = "01a0f490-e119-75c3-b726-41d2c914c51c";   // an earlier turn
const CALL = "call_CVaRgrUcdfM4FMOHnSWkUTF7";

function cleanEnv(extra = {}) {
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST") || k.startsWith("WORKFLOW_KIT_STOP")) delete e[k];
  return { ...e, ...extra };
}
function withDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-stop-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function run(payload, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], { encoding: "utf8", input: typeof payload === "string" ? payload : JSON.stringify(payload), env: cleanEnv(env) });
  assert.equal(r.status, 0, `exit 0 on every path: ${r.stderr}`);
  return r;
}
// Writes the transcript, runs the hook with a Stop payload shaped like the observed one.
function stop(dir, lines, final, extra = {}, env = {}) {
  const file = path.join(dir, "rollout.jsonl");
  writeFileSync(file, F.transcript(...lines, F.assistant(T1, final)));
  return run({ session_id: "s", turn_id: T1, transcript_path: file, cwd: dir, hook_event_name: "Stop", model: "gpt-test", permission_mode: "default", stop_hook_active: false, last_assistant_message: final, ...extra }, env);
}
const blocks = (r) => { assert.notEqual(r.stdout, "", "expected a block"); const j = JSON.parse(r.stdout); assert.equal(j.decision, "block"); return j.reason; };
const allows = (r, why) => assert.equal(r.stdout, "", why || "expected silence");
const start = (turn = T1) => [F.agentsMd(turn), F.taskStarted(turn)];

test("every bad input is ALLOWED: empty, non-JSON, wrong shapes, missing/unreadable/symlinked/garbled transcripts, no turn start, turn mismatch", () => withDir((dir) => {
  const good = [...start(), F.delegation(T1, F.ARCHITECT)];
  allows(run(""), "empty stdin");
  allows(run("not json {"), "non-JSON");
  allows(run("null"), "null");
  allows(run("[]"), "array");
  allows(run("42"), "number");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "x" }), "no transcript_path");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: path.join(dir, "absent.jsonl"), last_assistant_message: "x" }), "missing transcript");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: dir, last_assistant_message: "x" }), "a directory");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: 7, last_assistant_message: "x" }), "non-string path");
  const file = path.join(dir, "ok.jsonl");
  writeFileSync(file, F.transcript(...good));
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: file }), "no last_assistant_message");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: file, last_assistant_message: 5 }), "non-string last_assistant_message");
  allows(run({ hook_event_name: "PreToolUse", stop_hook_active: false, transcript_path: file, last_assistant_message: "x" }), "not a Stop event");
  allows(run({ stop_hook_active: false, transcript_path: file, last_assistant_message: "x" }), "no event name");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, agent_id: "a", transcript_path: file, last_assistant_message: "x" }), "a subagent payload");
  const link = path.join(dir, "link.jsonl"); symlinkSync(file, link);
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, turn_id: T1, transcript_path: link, last_assistant_message: "x" }), "a symlinked transcript is not read");
  writeFileSync(path.join(dir, "garbage.jsonl"), "{{{{\nnot json\n\"task_started\" \"function_call_output\"\n");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, turn_id: T1, transcript_path: path.join(dir, "garbage.jsonl"), last_assistant_message: "x" }), "garbled lines");
  writeFileSync(path.join(dir, "nostart.jsonl"), F.transcript(F.delegation(T1, F.ARCHITECT)));
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, turn_id: T1, transcript_path: path.join(dir, "nostart.jsonl"), last_assistant_message: "x" }), "no turn start in the transcript");
  allows(run({ hook_event_name: "Stop", stop_hook_active: false, turn_id: "some-other-turn", transcript_path: file, last_assistant_message: "x" }), "payload turn differs from the transcript's last turn");
  const unreadable = path.join(dir, "locked.jsonl"); writeFileSync(unreadable, F.transcript(...good)); chmodSync(unreadable, 0o000);
  try { if (process.getuid && process.getuid() !== 0) allows(run({ hook_event_name: "Stop", stop_hook_active: false, turn_id: T1, transcript_path: unreadable, last_assistant_message: "x" }), "unreadable transcript"); } finally { chmodSync(unreadable, 0o600); }
  // Only an explicit boolean false may block: absent or non-boolean stop_hook_active fails OPEN.
  const noActive = { hook_event_name: "Stop", turn_id: T1, transcript_path: file, last_assistant_message: "x" };
  allows(run({ ...noActive }), "stop_hook_active absent");
  for (const v of [null, "false", 0, "", [], {}]) allows(run({ ...noActive, stop_hook_active: v }), `stop_hook_active ${JSON.stringify(v)}`);
  allows(run({ ...noActive, stop_hook_active: true }), "stop_hook_active true");
  // The same good input does block — so the silences above are the guards, not a dead sensor.
  blocks(run({ ...noActive, stop_hook_active: false }));
  allows(run({ ...noActive, stop_hook_active: false }, { WORKFLOW_KIT_STOP_NOTICE_SENSOR: "false" }), "off switch");
}));

test("a block names the thread and the four fields, and fires ONCE: stop_hook_active ⇒ allow", () => withDir((dir) => {
  const lines = [...start(), F.delegation(T1, F.ARCHITECT), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)];
  const reason = blocks(stop(dir, lines, "The question is pending."));
  assert.ok(reason.includes(F.ARCHITECT), "names the delegating thread id");
  assert.match(reason, /STOP: <reason>; next action: <action>; actor: <who must act>/, "reason, next action, who must act");
  assert.match(reason, /\*\*DECISION NEEDED:\*\*.*\*\*AUTHORIZATION NEEDED\*\*/, "the Owner ask under a rule-8 label");
  assert.match(reason, /\*\*KIT GAP-ACTION NEEDED:\*\*/, "the forced reply names the KIT GAP label too (v2.41.0)");
  assert.match(reason, /END the message with it/);
  // The "Send thread …" line names the thread even when only trigger (b) fired.
  const askOnly = [...start(), F.delegation(T1, F.ARCHITECT), F.sent(T1, F.ARCHITECT), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)];
  assert.ok(blocks(stop(dir, askOnly, "Pending.")).includes(`Send thread ${F.ARCHITECT} one message`), "the send instruction names the thread");
  // The continuation's Stop carries stop_hook_active:true — never block again, even though every trigger still holds.
  allows(stop(dir, lines, "The question is pending.", { stop_hook_active: true }), "no loop");
  // …and the continuation, once it has done what was asked, passes.
  const done = [...lines, F.sent(T1, F.ARCHITECT), F.hookPrompt(T1, reason)];
  allows(stop(dir, done, "Notice sent.\n\n**DECISION NEEDED:** Authorize the scoped review?"), "satisfied");
}));

test("trigger (a): the latest delegation's thread must receive a send this turn", () => withDir((dir) => {
  const base = [...start(), F.delegation(T1, F.ARCHITECT)];
  assert.ok(blocks(stop(dir, base, "Done.")).includes(F.ARCHITECT), "POSITIVE: delegation, no send");
  allows(stop(dir, [...base, F.sent(T1, F.ARCHITECT)], "Done."), "NEGATIVE: a completed send to that thread this turn");
  blocks(stop(dir, [...base, F.sent(T1, F.OTHER)], "Done."));                                  // a send to a different thread does not count
  blocks(stop(dir, [...base, F.sent(T1, F.ARCHITECT, "failed")], "Done."));                    // a failed send delivered nothing
  blocks(stop(dir, [...base, F.sent(T1, F.ARCHITECT, "completed", "read_thread")], "Done."));    // reading the thread is not notifying it
  blocks(stop(dir, [F.agentsMd(T0), F.taskStarted(T0), F.sent(T0, F.ARCHITECT), F.assistant(T0, "x"), F.taskStarted(T1), F.delegation(T1, F.ARCHITECT)], "Done."));   // a send in an EARLIER turn does not count
  blocks(stop(dir, [...base, F.execSendJs(T1, F.ARCHITECT)], "Done."));                        // the JS spelling is not a structured send
  allows(stop(dir, start(), "Done."), "NEGATIVE: no delegation anywhere");
  // the LATEST delegation decides
  const twoThreads = [...start(), F.delegation(T1, F.ARCHITECT), F.delegation(T1, F.OTHER, "create_thread")];
  assert.ok(blocks(stop(dir, [...twoThreads, F.sent(T1, F.ARCHITECT)], "Done.")).includes(F.OTHER));
  allows(stop(dir, [...twoThreads, F.sent(T1, F.OTHER)], "Done."));
  // F1: only a delegation that arrived IN THIS TURN counts. An Owner-initiated turn after an earlier delegation owes nothing.
  const afterDelegation = [F.agentsMd(T0), F.taskStarted(T0), F.delegation(T0, F.ARCHITECT), F.assistant(T0, "Working."), F.taskStarted(T1), F.envContext(T1)];
  allows(stop(dir, [...afterDelegation, F.ownerSays(T1, "where are we?\n")], "On track, building."), "NEGATIVE: Owner-initiated turn (Architect side, earlier delegation)");
  allows(stop(dir, [...afterDelegation, F.ownerSays(T1, "pause here and wait for me\n")], "Paused at a safe checkpoint."), "NEGATIVE: Owner-pause turn");
  assert.ok(blocks(stop(dir, [...afterDelegation, F.delegation(T1, F.ARCHITECT)], "Done.")).includes(F.ARCHITECT), "POSITIVE: the same thread, delegating again IN this turn");
}));

test("trigger (a): a notice owes no reply (STOP:, STATUS:), a CONSULT:, RULING NEEDED: or directive does", () => withDir((dir) => {
  const turn = (input, name) => [...start(), F.delegation(T1, F.ARCHITECT, name || "send_message_to_thread", input)];
  allows(stop(dir, turn("STOP: fourth-round dispatch held; next action: Principal decide; actor: Principal"), "Done."), "STOP: notice (real lead)");
  allows(stop(dir, turn("\n   STOP: indented after the tag, trimmed"), "Done."), "STOP: after whitespace");
  allows(stop(dir, turn("STATUS: build green at the frozen head"), "Done."), "STATUS: notice (D-109)");
  allows(stop(dir, turn("STOP: a notice sent through create_thread", "create_thread"), "Done."), "either tool name");
  assert.ok(blocks(stop(dir, turn("CONSULT: Builder readiness. My real thread ID is REDACTED."), "Done.")).includes(F.ARCHITECT), "CONSULT: owes a reply (real lead)");
  blocks(stop(dir, turn("RULING NEEDED on exact bookend seat/packet before dispatch"), "Done."));
  blocks(stop(dir, turn("ARCHITECT_STATUS_V1\nRead-only disposition: REDACTED"), "Done."));            // a real lead that is not STATUS:
  blocks(stop(dir, turn("Resume the approved build NOW."), "Done."));
  blocks(stop(dir, turn("stop: lowercase is not the notice lead"), "Done."));
  blocks(stop(dir, turn("Do NOT STOP: this is mid-text"), "Done."));
  blocks(stop(dir, turn(""), "Done."));
  // a directive plus a later notice from the same thread: the directive still owes its reply
  assert.ok(blocks(stop(dir, [...turn("Resume the approved build NOW."), F.delegation(T1, F.ARCHITECT, "send_message_to_thread", "STOP: ack")], "Done.")).includes(F.ARCHITECT));
  // the delegation filter requires the codex_app namespace
  allows(stop(dir, [...start(), F.delegation(T1, F.ARCHITECT, "send_message_to_thread", "Resume NOW.", "some_other_app")], "Done."), "NEGATIVE: another namespace is not a thread delegation");
  allows(stop(dir, [...start(), F.delegation(T1, F.ARCHITECT, "read_thread")], "Done."), "NEGATIVE: another tool name");
}));

test("trigger (b): an async Owner ask with no recorded answer needs a rule-8 label in the final message", () => withDir((dir) => {
  const ask = [...start(), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)];
  const reason = blocks(stop(dir, ask, "The question is pending."));            // POSITIVE: the ack is not an answer
  assert.match(reason, /request_user_input_async/);
  allows(stop(dir, ask, "Status.\n\n**DECISION NEEDED:** Authorize the scoped review?"), "NEGATIVE: the final carries a label");
  allows(stop(dir, ask, "**AUTHORIZATION NEEDED** approve the push to origin."), "AUTHORIZATION NEEDED takes no colon");
  allows(stop(dir, [...ask, F.questionReply(T1, CALL)], "Continuing."), "NEGATIVE: the Owner answered this call");
  allows(stop(dir, [...ask, F.ownerSays(T1, "yes, authorized\n")], "Continuing."), "NEGATIVE (F3): any later Owner message answers the ask");
  allows(stop(dir, [...ask, F.questionReply(T1, "call_someOtherCall")], "Continuing."), "NEGATIVE: a question reply is an Owner message");
  blocks(stop(dir, [...start(), F.ownerSays(T1, "go ahead\n"), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)], "Pending."));   // an Owner message BEFORE the ask does not answer it
  blocks(stop(dir, [...ask, F.envContext(T1), F.openPage(T1), F.hookPrompt(T1, "x")], "Pending."));                           // host-injected user messages do not answer it
  allows(stop(dir, [F.taskStarted(T0), F.asyncAsk(T0, CALL), F.asyncAck(T0, CALL), F.assistant(T0, "x"), ...start()], "Continuing."), "NEGATIVE: the ask belongs to an earlier turn");
  allows(stop(dir, ask, "Status.\n\n**KIT GAP-ACTION NEEDED:** the kit lacks a route; evidence docs/x.md; the project holds only the blocked step."), "(b) NEGATIVE: a KIT GAP-ACTION NEEDED label counts (v2.41.0)");
  blocks(stop(dir, ask, "Plain text. DECISION NEEDED: not bold, not a line start"));        // a bare mention is not a label
}));

test("trigger (c): an unanswered labeled ask stays LAST — the final message must END with a rule-8 label", () => withDir((dir) => {
  const earlier = [F.agentsMd(T0), F.taskStarted(T0), F.assistant(T0, "Reviews done.\n\n**DECISION NEEDED:** Authorize the Astra process review?"), F.taskStarted(T1), F.agentsMd(T1), F.envContext(T1)];
  const reason = blocks(stop(dir, earlier, "No change: the recorded authorization blocker remains."));   // POSITIVE: a heartbeat-style status
  assert.match(reason, /does not END with a rule-8 label/);
  allows(stop(dir, earlier, "No change.\n\n**DECISION NEEDED:** Authorize the Astra process review?"), "NEGATIVE: re-ends with the ask");
  allows(stop(dir, earlier, "No change.\n\n- **ACTION NEEDED:** run the handed-over command\n  then reply done"), "a bulleted label paragraph counts");
  allows(stop(dir, earlier, "No change.\n\n**KIT GAP-ACTION NEEDED:** forward the gap to the Workflow-Kit Architect"), "(c) NEGATIVE: a final that ENDS with a KIT GAP-ACTION NEEDED label passes (v2.41.0)");
  blocks(stop(dir, earlier, "**KIT GAP-ACTION NEEDED:** forward the gap\n\nStatus text after it."));          // buried above status text still blocks
  blocks(stop(dir, earlier, "**DECISION NEEDED:** Authorize the Astra process review?\n\nAutomatic approval rejected the payload. Nothing else changed."));   // buried above status text
  allows(stop(dir, [...earlier, F.ownerSays(T1, "yes, authorized\n")], "Working on it."), "NEGATIVE: an Owner message came since");
  allows(stop(dir, [F.taskStarted(T0), F.assistant(T0, "**QUESTION:** which branch?"), F.ownerSays(T0, "main\n"), F.taskStarted(T1)], "Working."), "NEGATIVE: answered inside the earlier turn");
  allows(stop(dir, [F.taskStarted(T0), F.assistant(T0, "All done, nothing owed."), F.taskStarted(T1), F.envContext(T1), F.openPage(T1), F.hookPrompt(T1, "x")], "Still done."), "NEGATIVE: no earlier labeled ask");
  allows(stop(dir, [F.taskStarted(T0), F.assistant(T0, "**QUESTION:** which branch?", "commentary"), F.taskStarted(T1)], "Working."), "NEGATIVE: only a FINAL message is an ask");
  allows(stop(dir, start(), "**DECISION NEEDED:** pick one\n\nMore status text."), "NEGATIVE: this turn's own ask is not an EARLIER ask");
  // host-injected user messages are not Owner messages; a question reply is
  allows(stop(dir, [...earlier, F.questionReply(T1, CALL)], "Working."), "NEGATIVE: a question reply is an Owner message");
}));

test("NB-K2 (v2.42.0): trigger (c) needs a label WITH text at the END; a RELAYED Owner answer counts as answered (fail open)", () => withDir((dir) => {
  const earlier = [F.agentsMd(T0), F.taskStarted(T0), F.assistant(T0, "Ready.\n\n**AUTHORIZATION NEEDED:** push 97b3b1a to origin."), F.taskStarted(T1), F.agentsMd(T1), F.envContext(T1)];
  // (i) a bare label names no action: it blocks; the same label with text passes.
  blocks(stop(dir, earlier, "No change.\n\n**ACTION NEEDED:**"));
  blocks(stop(dir, earlier, "No change.\n\n- **DECISION NEEDED:**  "));
  allows(stop(dir, earlier, "No change.\n\n**ACTION NEEDED:** run the handed-over command"), "label with text on the same line");
  allows(stop(dir, earlier, "No change.\n\n**ACTION NEEDED:**\nrun the handed-over command"), "text on the next line of the same paragraph counts");
  allows(stop(dir, earlier, "No change.\n\n**DECISION NEEDED: approve or decline**"), "text inside the bold counts");
  // (ii) a relayed answer clears only from the thread that OPENED the ask's turn. T0 below is opened by ARCHITECT's directive.
  const opened = [F.agentsMd(T0), F.taskStarted(T0), F.delegation(T0, F.ARCHITECT, "send_message_to_thread", "DIRECTIVE: build it"), F.assistant(T0, "Ready.\n\n**AUTHORIZATION NEEDED:** push 97b3b1a to origin."), F.taskStarted(T1), F.agentsMd(T1)];
  const reply = (from, text, to = from) => [F.delegation(T1, from, "send_message_to_thread", text), F.sent(T1, to)];
  allows(stop(dir, [...opened, ...reply(F.ARCHITECT, "DIRECTIVE: Josh's push GO, relayed. Josh's words: \"Approved push\".")], "Pushed."), "(a) a same-thread relay clears (c)");
  allows(stop(dir, [...opened, ...reply(F.ARCHITECT, "CONSULT: which branch?")], "Replied."), "(a) ANY non-notice message from the opening thread clears it: fail open");
  // Opus's scenario: the PM messages a WORKER, the WORKER replies "DONE:" -> that is not an answer.
  blocks(stop(dir, [...opened, F.sent(T1, F.OTHER), F.delegation(T1, F.OTHER, "send_message_to_thread", "DONE: tests green"), ], "Worker finished."));
  blocks(stop(dir, [...opened, ...reply(F.OTHER, "CONSULT: another Architect asks something", F.OTHER)], "Replied."));      // (b) a different thread does not clear it
  // (c) an ask made in an Owner-initiated turn stays open after a PM delegation; an Owner message still answers it.
  const ownerTurn = [F.agentsMd(T0), F.taskStarted(T0), F.ownerSays(T0, "go\n"), F.assistant(T0, "Ready.\n\n**AUTHORIZATION NEEDED:** push 97b3b1a to origin."), F.taskStarted(T1), F.agentsMd(T1)];
  blocks(stop(dir, [...ownerTurn, ...reply(F.ARCHITECT, "DIRECTIVE: go")], "Pushed."));
  allows(stop(dir, [...ownerTurn, F.ownerSays(T1, "approved\n")], "Pushed."), "an Owner message answers an Owner-turn ask");
  // (d) a notice never answers, from any thread; a delegation BEFORE the ask is not an answer.
  blocks(stop(dir, [...opened, F.delegation(T1, F.ARCHITECT, "send_message_to_thread", "STATUS: Josh merged PR #25.")], "Closed out."));
  blocks(stop(dir, [...opened, F.delegation(T1, F.ARCHITECT, "send_message_to_thread", "STOP: paused; next action: wait; actor: Owner")], "Closed out."));
  // tail-capped text (the ask's turn start is absent) cannot name an opener: fail OPEN for any non-notice delegation.
  allows(stop(dir, [F.assistant(T0, "Ready.\n\n**AUTHORIZATION NEEDED:** push 97b3b1a to origin."), F.taskStarted(T1), F.agentsMd(T1), ...reply(F.OTHER, "DIRECTIVE: go")], "Pushed."), "unknown opener fails open");
  // (b) is NOT loosened: a relayed message does not answer an async ask.
  blocks(stop(dir, [...start(), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL), F.delegation(T1, F.ARCHITECT, "send_message_to_thread", "DIRECTIVE: go"), F.sent(T1, F.ARCHITECT)], "Pending."));
}));

test("label helpers: a label opens a line; the last paragraph decides END", () => {
  assert.equal(hasLabel("**DECISION NEEDED:** x"), true);
  assert.equal(hasLabel("a\n- **ACTION NEEDED:** x"), true);
  assert.equal(hasLabel("**AUTHORIZATION NEEDED**"), true);
  assert.equal(hasLabel("**QUESTION:** x"), true);
  assert.equal(hasLabel("**RECOMMENDATION:** x"), false, "a recommendation is not an Owner ask");
  assert.equal(hasLabel("**KIT GAP-ACTION NEEDED:** x"), true, "v2.41.0 label");
  assert.equal(hasLabel("a\n- **KIT GAP-ACTION NEEDED:** x"), true);
  assert.equal(hasLabel("**KIT GAP ACTION NEEDED:** x"), false, "Josh's label has the hyphen; a spaced spelling is not it");
  assert.equal(hasLabel("**KIT GAP:** x"), false, "the bare prefix is not the label");
  assert.equal(hasLabel("mid-line **KIT GAP-ACTION NEEDED:** x"), false);
  assert.equal(endsWithLabel("status\n\n**KIT GAP-ACTION NEEDED:** the gap\ndetail"), true);
  assert.equal(endsWithLabel("**KIT GAP-ACTION NEEDED:** the gap\n\nstatus"), false);
  assert.equal(hasLabel("mid-line **DECISION NEEDED:** x"), false);
  assert.equal(hasLabel(null), false);
  assert.equal(endsWithLabel("status\n\n**DECISION NEEDED:** x\ndetail"), true);
  assert.equal(endsWithLabel("**DECISION NEEDED:** x\n\nstatus"), false);
  assert.equal(endsWithLabel(""), false);
  assert.equal(endsWithLabel("s\n\n**ACTION NEEDED:**"), false, "v2.42.0: a bare label does not count");
  assert.equal(endsWithLabel("s\n\n**ACTION NEEDED:** run x"), true);
});

test("init registers the Stop entry exactly once; --force does not duplicate it; the installed hook is byte-identical", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-stop-init-"));
  const prompts = mkdtempSync(path.join(os.tmpdir(), "kit-stop-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const initRun = (args = []) => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", prompts, ...args],
      { encoding: "utf8", env: { ...process.env, PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter) } });
    const first = initRun();
    assert.equal(first.status, 0, first.stderr);
    const hooksJson = path.join(dir, ".codex", "hooks.json");
    const stopGroups = () => JSON.parse(readFileSync(hooksJson, "utf8")).hooks.Stop;
    const entries = () => stopGroups().flatMap((g) => g.hooks).filter((h) => /sensor-stop-notice\.mjs/.test(h.command));
    assert.equal(stopGroups().length, 1, "one Stop group");
    assert.equal(entries().length, 1, "one sensor-stop-notice entry");
    assert.equal("matcher" in stopGroups()[0], false, "Stop takes no matcher");
    assert.match(entries()[0].command, /\.codex\/hooks\/sensor-stop-notice\.mjs --project-dir/);
    for (const lane of [".claude", ".codex"]) assert.equal(readFileSync(path.join(dir, lane, "hooks", "sensor-stop-notice.mjs"), "utf8"), readFileSync(HOOK, "utf8"), `${lane} copy is the kit's, byte for byte`);
    for (let i = 0; i < 2; i++) {
      const again = initRun(["--force"]);
      assert.doesNotMatch(again.stdout + again.stderr, /RE-TRUST NOW/, "an unchanged registration owes no re-trust");
      assert.equal(entries().length, 1, `--force #${i + 1} leaves exactly one entry`);
      assert.equal(stopGroups().length, 1);
    }
    // A v2.39.x-shaped registration (no Stop group): --force adds it once and says to re-trust.
    const reg = JSON.parse(readFileSync(hooksJson, "utf8")); delete reg.hooks.Stop;
    writeFileSync(hooksJson, JSON.stringify(reg, null, 2) + "\n");
    const upgraded = initRun(["--force"]);
    assert.match(upgraded.stdout + upgraded.stderr, /RE-TRUST NOW: run `codex` in this repo interactively/);
    assert.match(upgraded.stdout + upgraded.stderr, /the v2\.40\.0 Stop entry is new/);
    assert.equal(entries().length, 1, "added once");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(prompts, { recursive: true, force: true }); }
});
