// workflow-kit v2.46.0 KIT-OWNER-DIVIDER — rule 10 of core/OWNER_COMMS.md and its two Stop sensors.
//   · the predicate (hooks/guard-owner-comms.mjs hasOwnerDivider), present and absent forms;
//   · the Claude lane: guard-owner-comms.mjs on a REAL-shaped Stop payload (Claude Code 2.1.312);
//   · the Codex lane: sensor-stop-notice.mjs check (d), gated on the rollout's session_meta;
//   · the collisions: ONE correct divider message must pass every other trigger of both sensors.
// Silent-failure surface, so every run asserts exit 0 (a crash is not an allow). No test calls a real Codex or Claude CLI.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasOwnerDivider, dividerReason, lastDividerIndex } from "../hooks/guard-owner-comms.mjs";
import { endsWithLabel, hasLabel } from "../hooks/sensor-stop-notice.mjs";
import * as F from "./stop-notice-fixtures.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(KIT, "hooks", "guard-owner-comms.mjs");
const SENSOR = path.join(KIT, "hooks", "sensor-stop-notice.mjs");
const T1 = "01a0f4b0-ddaa-7820-ae21-1a5b2b480dc0", T0 = "01a0f490-e119-75c3-b726-41d2c914c51c", CALL = "call_CVaRgrUcdfM4FMOHnSWkUTF7";
const STARS = "*********************";
const ONE = "*******INFORMATION FOR JOSH********";
const SECTION = [ONE, "", "**Status:** Done", "", "**What happened**", "- built it", "", "**Nothing needed from you.**"].join("\n");

function cleanEnv(extra = {}) {
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST") || k.startsWith("WORKFLOW_KIT_") || k === "CLAUDE_PROJECT_DIR") delete e[k];
  return { ...e, ...extra };
}
function withDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-divider-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const armed = (dir, name = "Josh") => { mkdirSync(path.join(dir, "core"), { recursive: true }); writeFileSync(path.join(dir, "core", "OWNER_COMMS.md"), `# x\n\n## How to talk to ${name} — Owner, not a developer\n`); };
function spawn(script, payload, env, cwd, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd, input: typeof payload === "string" ? payload : JSON.stringify(payload), env: cleanEnv(env) });
  assert.equal(r.status, 0, `exit 0 on every path: ${r.stderr}`);
  return r;
}
const blocks = (r) => { assert.notEqual(r.stdout, "", "expected a block"); const j = JSON.parse(r.stdout); assert.equal(j.decision, "block"); return j.reason; };
const allows = (r, why) => assert.equal(r.stdout, "", why || "expected silence");

test("predicate: present in plain, fenced, bold, heading, CRLF, lower-case and blank-line forms", () => {
  const yes = {
    oneLine: `notes\n${ONE}\n`,
    oneLineOtherCounts: `***INFORMATION FOR JOSH***\n`,
    oneLineUneven: `*INFORMATION FOR JOSH************\n`,
    oneLineSpaces: `   ******* INFORMATION FOR JOSH ********   \n`,
    oneLineFenced: `\`\`\`\n${ONE}\n\`\`\`\n`,
    oneLineLower: `*******information for josh********`,
    oneLineCrlf: `x\r\n${ONE}\r\n`,
    legacyPlain: `notes\n${STARS}\nINFORMATION FOR JOSH\n`,
    fenced: `notes\n\`\`\`\n${STARS}\nINFORMATION FOR JOSH\n\`\`\`\n`,
    boldColonInside: `${STARS}\n**INFORMATION FOR JOSH:**\n`,
    boldColonOutside: `${STARS}\n**INFORMATION FOR JOSH**:\n`,
    heading: `${STARS}\n## INFORMATION FOR JOSH\n`,
    headingBold: `${STARS}\n### **INFORMATION FOR JOSH**\n`,
    underscore: `${STARS}\n__INFORMATION FOR JOSH__\n`,
    crlf: `x\r\n${STARS}\r\nINFORMATION FOR JOSH\r\n`,
    lower: `${STARS}\ninformation for josh\n`,
    mixed: `${STARS}\nInformation For Josh\n`,
    blankBetween: `${STARS}\n\n  \nINFORMATION FOR JOSH\n`,
    threeStars: `***\nINFORMATION FOR JOSH`,
    padded: `  ${STARS}  \n  INFORMATION FOR JOSH  `,
    noTrailingNewline: `${STARS}\nINFORMATION FOR JOSH`,
  };
  for (const [k, t] of Object.entries(yes)) assert.equal(hasOwnerDivider(t, "Josh"), true, k);
  assert.equal(hasOwnerDivider(`${STARS}\nINFORMATION   FOR\tMARY  ANN\n`, "Mary Ann"), true, "internal whitespace in a two-word name is flexible");
});

test("predicate: absent when there is no asterisk line, only an inline mention, another name, extra text, or asterisks with no INFORMATION line", () => {
  const no = {
    noAsterisks: "INFORMATION FOR JOSH\n",
    starsLeftOnly: "*******INFORMATION FOR JOSH\n",
    starsRightOnly: "INFORMATION FOR JOSH********\n",
    wordsInside: "*** INFORMATION FOR JOSH NOW ***\n",
    oneLineOtherName: "*******INFORMATION FOR MARY********\n",
    oneLinePrefixName: "*******INFORMATION FOR JOSHUA********\n",
    oneLineProse: "I end with *******INFORMATION FOR JOSH******** always.\n",
    dashes: "---------------------\nINFORMATION FOR JOSH\n",
    twoAsterisks: "**\nINFORMATION FOR JOSH\n",
    inlineProse: `I will end with ${STARS} and INFORMATION FOR JOSH next time.\n`,
    sameLineAsStars: `${STARS} INFORMATION FOR JOSH\n`,
    otherName: `${STARS}\nINFORMATION FOR MARY\n`,
    prefixName: `${STARS}\nINFORMATION FOR JOSHUA\n`,
    extraText: `${STARS}\nINFORMATION FOR JOSH and the team\n`,
    extraTextBefore: `${STARS}\nREAD: INFORMATION FOR JOSH\n`,
    starsNoInfo: `${STARS}\n**Status:** Done\n`,
    starsAtEnd: `INFORMATION FOR JOSH\n${STARS}\n`,
    nonBlankBetween: `${STARS}\nsomething\nINFORMATION FOR JOSH\n`,
    empty: "",
  };
  for (const [k, t] of Object.entries(no)) assert.equal(hasOwnerDivider(t, "Josh"), false, k);
  assert.equal(hasOwnerDivider(`${STARS}\nINFORMATION FOR JOSH`, "Mary"), false, "the name must be the contract's");
  // Fail open: a non-string text or an empty name is true.
  for (const t of [undefined, null, 5, {}, []]) assert.equal(hasOwnerDivider(t, "Josh"), true, `text ${JSON.stringify(t)}`);
  for (const n of ["", "   ", undefined, null, 7]) assert.equal(hasOwnerDivider("no divider", n), true, `name ${JSON.stringify(n)}`);
  assert.equal(hasOwnerDivider("x", "A.B"), false, "regex characters in a name are escaped, never interpreted");
  assert.equal(hasOwnerDivider(`${STARS}\nINFORMATION FOR AXB`, "A.B"), false);
});

test("dividerReason names the rule, the Owner in capitals, the four headings, numbering, lettering and the empty case", () => {
  const r = dividerReason("Josh");
  for (const needle of ["rule 10", ONE, "LAST message", "ONE follow-up", "Status", "What happened", "What you need to know", "What I need from you", "numbered 1, 2, 3", "a), b), c)", "Nothing needed from you", "once per turn"]) assert.ok(r.includes(needle), needle);
  assert.ok(!r.includes("INFORMATION FOR Josh"), "capitals");
  assert.ok(!r.includes(STARS), "the retired two-line form is not taught");
});

// ---------- Claude lane ----------
function claudeRun(dir, { final, user = "please build the divider check and then tell me when you are finished with it, in full", extra = {}, payload = {}, env = {}, transcript = true, contract = true }) {
  if (contract) armed(dir);
  const file = path.join(dir, "transcript.jsonl");
  if (transcript) writeFileSync(file, [{ type: "user", message: { role: "user", content: user } }, { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: final }] } }].map((e) => JSON.stringify(e)).join("\n") + "\n");
  // The REAL Claude Code 2.1.312 Stop payload (PM probe, 2026-11-21): a main-session Stop carries no agent_id and no agent_type.
  const base = { session_id: "s", transcript_path: file, cwd: dir, scratchpad_dir: path.join(dir, "scratch"), prompt_id: "p", permission_mode: "default", effort: { level: "medium" }, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: final, background_tasks: [], session_crons: [] };
  return spawn(GUARD, { ...base, ...extra, ...payload }, { CLAUDE_PROJECT_DIR: dir, ...env }, dir);
}

test("Claude lane: a final with the divider is allowed; one without blocks naming the divider only", () => withDir((dir) => {
  allows(claudeRun(dir, { final: `Done.\n\n${SECTION}` }), "divider present");
  const reason = blocks(claudeRun(dir, { final: "Done. Built and tested." }));
  assert.match(reason, /OWNER DIVIDER MISSING/);
  assert.match(reason, /INFORMATION FOR JOSH/);
  assert.doesNotMatch(reason, /Cut the narration|rule 1\)/, "a divider-only block is not the rule-1 text");
}));

test("Claude lane: the second stop (stop_hook_active true), a subagent event and a Stop with agent_id all allow", () => withDir((dir) => {
  const final = "Done. Built and tested.";
  allows(claudeRun(dir, { final, payload: { stop_hook_active: true } }), "second stop");
  allows(claudeRun(dir, { final, payload: { hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "general-purpose", agent_transcript_path: path.join(dir, "sub.jsonl") } }), "SubagentStop");
  allows(claudeRun(dir, { final, payload: { agent_id: "a1" } }), "a Stop that carries agent_id");
  allows(claudeRun(dir, { final, payload: { hook_event_name: "SubagentStop" } }), "SubagentStop without agent_id is still not a Stop");
  for (const v of [undefined, null, "false", 0]) allows(claudeRun(dir, { final, payload: { stop_hook_active: v } }), `stop_hook_active ${JSON.stringify(v)} is not an explicit false`);
}));

test("Claude lane: a main session started with --agent (agent_type, no agent_id) IS checked", () => withDir((dir) => {
  const reason = blocks(claudeRun(dir, { final: "Done. Built and tested.", payload: { agent_type: "general-purpose" } }));
  assert.match(reason, /OWNER DIVIDER MISSING/);
  allows(claudeRun(dir, { final: `Done.\n\n${SECTION}`, payload: { agent_type: "general-purpose" } }));
}));

test("Claude lane: every unreadable or unrecognised shape allows and exits 0", () => withDir((dir) => {
  armed(dir);
  allows(spawn(GUARD, "", { CLAUDE_PROJECT_DIR: dir }, dir), "empty stdin");
  allows(spawn(GUARD, "not json {", { CLAUDE_PROJECT_DIR: dir }, dir), "malformed stdin");
  allows(spawn(GUARD, "null", { CLAUDE_PROJECT_DIR: dir }, dir), "null");
  allows(claudeRun(dir, { final: "no divider", transcript: false, payload: { transcript_path: path.join(dir, "absent.jsonl") } }), "missing transcript");
  allows(claudeRun(dir, { final: "no divider", payload: { last_assistant_message: undefined } }), "payload without last_assistant_message");
  allows(claudeRun(dir, { final: "no divider", payload: { last_assistant_message: 7 } }), "non-string last_assistant_message");
  allows(claudeRun(dir, { final: "no divider", env: { WORKFLOW_KIT_OWNER_DIVIDER: "false" } }), "divider off switch");
  allows(claudeRun(dir, { final: "no divider", env: { WORKFLOW_KIT_COMMS_GUARD: "false" } }), "whole-guard off switch");
  // "FALSE" or "0" is not the explicit string: the check still runs.
  assert.match(blocks(claudeRun(dir, { final: "no divider", env: { WORKFLOW_KIT_OWNER_DIVIDER: "0" } })), /OWNER DIVIDER MISSING/);
}));

test("Claude lane: a dormant contract allows (no file, no heading, unfilled placeholder)", () => withDir((dir) => {
  allows(claudeRun(dir, { final: "no divider", contract: false }), "no core/OWNER_COMMS.md");
  mkdirSync(path.join(dir, "core"), { recursive: true });
  writeFileSync(path.join(dir, "core", "OWNER_COMMS.md"), "# x\n\n## How to talk to {{OWNER_NAME}} — Owner, not a developer\n");
  allows(claudeRun(dir, { final: "no divider", contract: false }), "unfilled {{OWNER_NAME}}");
}));

test("Claude lane: rule-1 narration AND no divider give ONE block carrying both", () => withDir((dir) => {
  const reason = blocks(claudeRun(dir, { final: "Let me check the config and report back." }));
  assert.match(reason, /narrates the work/);
  assert.match(reason, /OWNER DIVIDER MISSING/);
  assert.match(reason, /ONE follow-up that fixes both and ends with that section/);
  // rule-1 only (divider present): the old block, no divider text.
  const only = blocks(claudeRun(dir, { final: `Let me check the config and report back.\n\n${SECTION}` }));
  assert.match(only, /narrates the work/);
  assert.doesNotMatch(only, /OWNER DIVIDER MISSING/);
}));

// ---------- Codex lane ----------
function codexStop(dir, lines, final, { meta = F.sessionMeta(), extra = {}, env = {}, contract = true, script = SENSOR, args = [], contractDir = dir } = {}) {
  if (contract) armed(contractDir);
  const file = path.join(dir, "rollout.jsonl");
  writeFileSync(file, F.transcript(...(meta ? [meta] : []), ...lines, F.assistant(T1, final)));
  return spawn(script, { session_id: "s", turn_id: T1, transcript_path: file, cwd: dir, hook_event_name: "Stop", model: "gpt-test", permission_mode: "default", stop_hook_active: false, last_assistant_message: final, ...extra }, env, os.tmpdir(), args);
}
const turn = (t = T1) => [F.agentsMd(t), F.taskStarted(t)];

test("Codex lane: a Desktop session with no divider blocks on the divider only; with the divider it allows", () => withDir((dir) => {
  const reason = blocks(codexStop(dir, turn(), "Done. Built and tested."));
  assert.match(reason, /OWNER DIVIDER MISSING/);
  assert.match(reason, /INFORMATION FOR JOSH/);
  assert.doesNotMatch(reason, /STOP NOTICE OWED|send thread|STOP: <reason>/, "no stop-notice lines when only (d) fires");
  allows(codexStop(dir, turn(), `Done.\n\n${SECTION}`));
  allows(codexStop(dir, turn(), `Done.\n\n${SECTION}`, { meta: F.sessionMeta({ originator: "codex_work_desktop" }) }), "the other observed Desktop originator");
  assert.match(blocks(codexStop(dir, turn(), "Done.", { meta: F.sessionMeta({ originator: "codex_work_desktop" }) })), /OWNER DIVIDER MISSING/);
}));

test("Codex lane: headless exec seats, Claude's codex plugin, no session_meta and a non-user thread allow", () => withDir((dir) => {
  const none = "Done. Built and tested.";
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ originator: "codex_exec", source: "exec", thread_source: "user" }) }), "the observed exec seat");
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ source: "exec" }) }), "source exec alone");
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ originator: "codex_exec" }) }), "originator codex_exec alone");
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ originator: "Claude Code", source: "vscode", thread_source: undefined }) }), "Claude's codex plugin");
  allows(codexStop(dir, turn(), none, { meta: null }), "no session_meta");
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ source: null }) }), "a non-string source");
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ thread_source: "subagent" }) }), "a spawned thread");
  assert.match(blocks(codexStop(dir, turn(), none, { meta: F.sessionMeta({ thread_source: undefined }) })), /OWNER DIVIDER MISSING/, "an absent thread_source is a user session");
}));

test("Codex lane: the second stop, the off switch, a dormant contract and a missing contract all allow", () => withDir((dir) => {
  const none = "Done. Built and tested.";
  allows(codexStop(dir, turn(), none, { extra: { stop_hook_active: true } }), "second stop");
  allows(codexStop(dir, turn(), none, { env: { WORKFLOW_KIT_OWNER_DIVIDER: "false" } }), "divider off switch");
  allows(codexStop(dir, turn(), none, { env: { WORKFLOW_KIT_STOP_NOTICE_SENSOR: "false" } }), "whole-sensor off switch");
  withDir((bare) => allows(codexStop(bare, turn(), none, { contract: false }), "no contract: dormant"));
  // cwd absent: the root falls back to process.cwd() (os.tmpdir() here, which has no contract) — silence, never a crash.
  allows(codexStop(dir, turn(), none, { extra: { cwd: undefined } }), "no cwd");
}));

test("Codex lane: (a) and (d) together give ONE block carrying both; (a) alone is byte-identical to today", () => withDir((dir) => {
  const both = blocks(codexStop(dir, [...turn(), F.delegation(T1, F.ARCHITECT)], "Done. Built and tested."));
  assert.match(both, /STOP NOTICE OWED/);
  assert.ok(both.includes(`this turn received a message from thread ${F.ARCHITECT} and sent it none`));
  assert.match(both, /OWNER DIVIDER MISSING/);
  assert.equal((both.match(/Then end the turn\./g) || []).length, 1);
  const aOnly = blocks(codexStop(dir, [...turn(), F.delegation(T1, F.ARCHITECT)], `Done.\n\n${SECTION}`));
  assert.doesNotMatch(aOnly, /OWNER DIVIDER MISSING/);
  assert.match(aOnly, /STOP NOTICE OWED/);
}));

test("Codex lane: the sensor copied ALONE (no sibling) still runs (a)-(c), skips (d) and exits 0", () => withDir((dir) => {
  const solo = path.join(dir, "solo", ".codex", "hooks"); mkdirSync(solo, { recursive: true });
  copyFileSync(SENSOR, path.join(solo, "sensor-stop-notice.mjs"));
  const script = path.join(solo, "sensor-stop-notice.mjs");
  const a = blocks(codexStop(dir, [...turn(), F.delegation(T1, F.ARCHITECT)], "Done.", { script }));
  assert.match(a, /STOP NOTICE OWED/);
  assert.doesNotMatch(a, /OWNER DIVIDER MISSING/);
  allows(codexStop(dir, turn(), "Done. Built and tested.", { script }), "(d) alone is skipped without the sibling");
}));

// ---------- trigger (c) with numbered asks ----------
test("(c): numbered asks count as labels; a divider moves the region to after the last divider", () => {
  assert.equal(hasLabel("1. **DECISION NEEDED:** go?"), true);
  assert.equal(hasLabel("2) **ACTION NEEDED:** run it"), true);
  assert.equal(hasLabel("**1) DECISION NEEDED:** go?"), true);
  assert.equal(hasLabel("   - **QUESTION:** why?"), true, "the bulleted form is unchanged");
  assert.equal(hasLabel("1. DECISION NEEDED: go?"), false, "unbolded stays unlabeled");
  assert.equal(endsWithLabel(`${ONE}\n\n1. **DECISION NEEDED:** go?\n   a) yes\n\nReply like 1) a`), true, "the one-line divider moves the region too");
  assert.equal(endsWithLabel(`**ACTION NEEDED:** old\n\n${ONE}\n\n**Nothing needed from you.**`), false, "one-line: the region after the divider holds no label");
  assert.equal(endsWithLabel(`${STARS}\nINFORMATION FOR JOSH\n\n1. **DECISION NEEDED:** go?\n   a) yes\n\nReply like 1) a`), true, "a closing reply line after a numbered ask passes");
  assert.equal(endsWithLabel(`${STARS}\nINFORMATION FOR JOSH\n\n**ACTION NEEDED:**\n\nrun this`), false, "a bare label does not count");
  assert.equal(endsWithLabel(`**ACTION NEEDED:** old ask\n\n${STARS}\nINFORMATION FOR MARY\n\n**Nothing needed from you.**`), false, "the region after the LAST divider holds no label");
  assert.equal(endsWithLabel(`${STARS}\nINFORMATION FOR X\n\n1. **ACTION NEEDED:** a\n\n${STARS}\nINFORMATION FOR X\n\n**Nothing needed from you.**`), false, "only the last divider counts");
  assert.equal(endsWithLabel("intro\n\n**ACTION NEEDED:** run it\n"), true, "no divider: the last-paragraph rule stands");
  assert.equal(endsWithLabel("**ACTION NEEDED:** run it\n\nclosing line"), false, "no divider: a closing paragraph still defeats it");
});

// ---------- the collision: ONE correct divider message passes everything ----------
const CORRECT = [
  "Progress notes: the hook change is built and the suite is green.",
  "- Edited two files.",
  "- Ran the checks.",
  "",
  ONE,
  "",
  "**Status:** Waiting on you",
  "",
  "**What happened**",
  "- The divider check is built in both lanes.",
  "",
  "**What you need to know**",
  "- Nothing is pushed; the branch holds two commits.",
  "",
  "**What I need from you**",
  "",
  "1. **DECISION NEEDED:** ship it as v2.46.0?",
  "   a) yes, push now",
  "   b) wait for the review",
  "",
  "2. **ACTION NEEDED:** run this in the primary clone:",
  "",
  "```",
  "git pull --ff-only",
  "```",
  "",
  "Reply like 1) a 2) done",
].join("\n");
const WITHOUT = CORRECT.split("\n").filter((l) => l !== ONE).join("\n");
const CORRECT_LEGACY = CORRECT.replace(ONE, `${STARS}\nINFORMATION FOR JOSH`);

test("collision, Claude lane: the correct message passes narration and size with a non-short user prompt; without its divider it blocks once on the divider only", () => withDir((dir) => {
  allows(claudeRun(dir, { final: CORRECT }));
  allows(claudeRun(dir, { final: CORRECT, user: "ready to ship?" }), "even answering a short question: the section is under the size ceiling");
  assert.equal(hasOwnerDivider(WITHOUT, "Josh"), false, "the fixture really has no divider");
  const reason = blocks(claudeRun(dir, { final: WITHOUT }));
  assert.match(reason, /OWNER DIVIDER MISSING/);
  assert.doesNotMatch(reason, /narrates|SIZE MISMATCH/);
}));

test("collision, legacy two-line form: still passes both sensors in v2.46.0", () => withDir((dir) => {
  assert.equal(hasOwnerDivider(CORRECT_LEGACY, "Josh"), true);
  allows(claudeRun(dir, { final: CORRECT_LEGACY }));
  allows(codexStop(dir, [...turn(), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)], CORRECT_LEGACY), "(b)");
  allows(codexStop(dir, [F.agentsMd(T0), F.taskStarted(T0), F.assistant(T0, "Waiting.\n\n**ACTION NEEDED:** run the build."), ...turn()], CORRECT_LEGACY), "(c)");
}));

test("collision, Codex lane: the correct message passes (b) and (c) and (d); without its divider it blocks once on the divider only", () => withDir((dir) => {
  // (b): an async Owner ask in this turn, never answered. The numbered labels count as a rule-8 label.
  allows(codexStop(dir, [...turn(), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)], CORRECT), "(b) with an unanswered async ask");
  // (c): an earlier labeled final, no Owner message since.
  const early = [F.agentsMd(T0), F.taskStarted(T0), F.assistant(T0, "Waiting.\n\n**ACTION NEEDED:** run the build."), ...turn()];
  allows(codexStop(dir, early, CORRECT), "(c) with an earlier labeled final and no Owner message since");
  // The same message minus its divider: (d) only. Its last paragraph is not a label, but (c) is silent without an earlier ask.
  const reason = blocks(codexStop(dir, [...turn(), F.asyncAsk(T1, CALL), F.asyncAck(T1, CALL)], WITHOUT));
  assert.match(reason, /OWNER DIVIDER MISSING/);
  assert.doesNotMatch(reason, /STOP NOTICE OWED/, "(b) is satisfied by the labels, so only the divider is owed");
  // And a bare 'Reply like' ending after an earlier ask WITHOUT a divider is today's (c) behaviour, unchanged.
  const c = blocks(codexStop(dir, early, WITHOUT));
  assert.match(c, /STOP NOTICE OWED/);
  assert.match(c, /OWNER DIVIDER MISSING/);
}));

test("kill-pass: a second stop after either block never blocks again (no wedge), in both lanes", () => withDir((dir) => {
  allows(claudeRun(dir, { final: "Let me check the config.", payload: { stop_hook_active: true } }));
  allows(codexStop(dir, [...turn(), F.delegation(T1, F.ARCHITECT)], "Done.", { extra: { stop_hook_active: true } }));
}));

// ---------- R1 repair batch ----------
const LATE = [F.agentsMd(T0), F.taskStarted(T0), F.assistant(T0, "Waiting.\n\n**ACTION NEEDED:** run the build."), F.agentsMd(T1), F.taskStarted(T1)];

test("R1-a: the Codex contract root follows --project-dir, so a session in a subdirectory is still checked", () => withDir((repo) => {
  const sub = path.join(repo, "packages", "app"); mkdirSync(sub, { recursive: true });
  const reason = blocks(codexStop(sub, turn(), "Done. Built and tested.", { contractDir: repo, args: ["--project-dir", repo], extra: { cwd: sub } }));
  assert.match(reason, /OWNER DIVIDER MISSING/);
  allows(codexStop(sub, turn(), `Done.\n\n${SECTION}`, { contractDir: repo, args: ["--project-dir", repo], extra: { cwd: sub } }));
  allows(codexStop(sub, turn(), "Done.", { contractDir: repo, args: [], extra: { cwd: sub } }), "without --project-dir the root is the session cwd, which holds no contract");
}));

test("R1-b: (d) runs only for the vscode and cli sources; mcp, unknown and missing are silent", () => withDir((dir) => {
  const none = "Done. Built and tested.";
  for (const source of ["mcp", "unknown", "", null, 7]) allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ source }) }), `source ${JSON.stringify(source)}`);
  assert.match(blocks(codexStop(dir, turn(), none, { meta: F.sessionMeta({ source: "cli" }) })), /OWNER DIVIDER MISSING/, "cli is the TUI: checked");
  assert.match(blocks(codexStop(dir, turn(), none, { meta: F.sessionMeta({ source: "vscode" }) })), /OWNER DIVIDER MISSING/);
  allows(codexStop(dir, turn(), none, { meta: F.sessionMeta({ source: "cli", originator: "Claude Code" }) }), "the originator denies still apply");
}));

test("R1-c: every divider pattern is linear, in both lanes (each under 1 s)", () => {
  const bad = [`${STARS}\nINFORMATION FOR JOSH${" ".repeat(100000)}x`, "*".repeat(100000), `*INFORMATION FOR X${"*".repeat(100000)}a`, `*INFORMATION FOR JOSH${" ".repeat(100000)}x`, `*****\n${"#".repeat(50000)} INFORMATION FOR JOSH`, `${"*".repeat(50000)}${" ".repeat(50000)}INFORMATION FOR`, `**INFORMATION FOR JOSH${" *".repeat(50000)}x`];
  for (const t of bad) {
    for (const [name, fn] of [["hasOwnerDivider", () => hasOwnerDivider(t, "Josh")], ["lastDividerIndex", () => lastDividerIndex(t, "Josh")], ["hasOwnerDivider X", () => hasOwnerDivider(t, "X")], ["endsWithLabel", () => endsWithLabel(t)], ["endsWithLabel strict", () => endsWithLabel(t, "Josh", lastDividerIndex)]]) {
      const t0 = Date.now(); fn(); assert.ok(Date.now() - t0 < 1000, `${name} on ${JSON.stringify(t.slice(0, 30))}… took ${Date.now() - t0} ms`);
    }
  }
  // every accepted form still accepted
  for (const t of [ONE, `***INFORMATION FOR JOSH***`, `   ******* INFORMATION FOR JOSH ********   `, `${STARS}\n**INFORMATION FOR JOSH:**`, `${STARS}\n## INFORMATION FOR JOSH`]) assert.equal(hasOwnerDivider(t, "Josh"), true, t);
});

test("R1-c: both hooks, spawned, finish on the hostile inputs and still exit 0", () => withDir((dir) => {
  const hostile = `${STARS}\nINFORMATION FOR JOSH${" ".repeat(100000)}x`;
  const t0 = Date.now();
  assert.match(blocks(claudeRun(dir, { final: hostile })), /OWNER DIVIDER MISSING/);
  assert.match(blocks(codexStop(dir, turn(), hostile)), /OWNER DIVIDER MISSING/);
  assert.ok(Date.now() - t0 < 20000);
}));

test("R1-d: with a contract, (c) needs the OWNER's divider; without one it stays name-agnostic", () => withDir((dir) => {
  const near = "Done.\n\n***** INFORMATION FOR JOSH now *****\n\n1. **DECISION NEEDED:** go?\n   a) yes\n\nReply like 1) a";
  const r = blocks(codexStop(dir, LATE, near));
  assert.match(r, /an earlier labeled Owner ask is still unanswered/, "a near-miss line is not a divider, so the last-paragraph rule blocks");
  withDir((bare) => allows(codexStop(bare, LATE, near, { contract: false }), "no contract: name-agnostic, the region after the line holds a numbered ask"));
  const ctx = codexStop(dir, LATE, "**ACTION NEEDED:** run X\n*Information for context*");
  assert.doesNotMatch(blocks(ctx), /earlier labeled Owner ask/, "the italic line is no divider: the label-with-text paragraph passes (c) as with no divider");
  assert.equal(endsWithLabel("**ACTION NEEDED:** run X\n*Information for context*"), false, "agnostic: that line IS read as a divider with an empty region");
  allows(codexStop(dir, LATE, CORRECT), "the real divider still passes (c) with a contract");
}));

test("R1-e: an AUTHORIZATION NEEDED label's text runs past a blank line to the next label or the end of the section", () => withDir((dir) => {
  for (const ask of ["1. **AUTHORIZATION NEEDED**\n\nPush v2.46.0 to origin?", "**AUTHORIZATION NEEDED**\n\nPush v2.46.0 to origin?"]) {
    allows(codexStop(dir, LATE, `Done.\n\n${ONE}\n\n**Status:** Waiting on you\n\n${ask}`), JSON.stringify(ask));
  }
  assert.equal(endsWithLabel(`${ONE}\n\n**ACTION NEEDED:**\n\nrun this`), false, "the other labels keep the blank-line rule");
  assert.equal(endsWithLabel(`${ONE}\n\n**AUTHORIZATION NEEDED**\n\n`), false, "a bare AUTHORIZATION label with nothing after it still fails");
}));

test("R1-f: the rule-1 block text always tells the follow-up to END with the divider section", () => withDir((dir) => {
  const r = blocks(claudeRun(dir, { final: `Let me check the config and report back.\n\n${SECTION}` }));
  assert.match(r, /narrates the work/);
  assert.match(r, /Cut the narration and the unrequested inventory; offer it in one clause\. Do not apologise or explain the correction; just send the better answer\./, "the existing sentences are unchanged");
  assert.match(r, /must END with the rule 10 divider section: \*{7}INFORMATION FOR JOSH\*{8}/);
}));

test("R1-g: a stale v2.45.0 sibling skips (d), says so on stderr, and exits 0", () => withDir((dir) => {
  let old; try { old = execFileSync("git", ["-C", KIT, "show", "4037608a4f4a26c5ca7295785bb9016d7ed6ddf1:hooks/guard-owner-comms.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return; }   // no v2.45.0 object here
  const h = path.join(dir, "stale", ".codex", "hooks"); mkdirSync(h, { recursive: true });
  writeFileSync(path.join(h, "guard-owner-comms.mjs"), old);
  for (const f of ["sensor-stop-notice.mjs", "payload-targets.mjs"]) copyFileSync(path.join(KIT, "hooks", f), path.join(h, f));
  const r = codexStop(dir, turn(), "Done. Built and tested.", { script: path.join(h, "sensor-stop-notice.mjs") });
  allows(r, "(d) skipped");
  assert.match(r.stderr, /guard-owner-comms\.mjs is stale/);
  const a = blocks(codexStop(dir, [...turn(), F.delegation(T1, F.ARCHITECT)], "Done.", { script: path.join(h, "sensor-stop-notice.mjs") }));
  assert.match(a, /STOP NOTICE OWED/, "(a)-(c) still run");
}));

test("R1-h: the divider spelled with the name in capitals always passes (Weiß, ﬁona)", () => {
  for (const name of ["Weiß", "ﬁona", "Josh", "Mary Ann"]) {
    const taught = `*******INFORMATION FOR ${name.toUpperCase()}********`;
    assert.equal(hasOwnerDivider(taught, name), true, name);
    assert.ok(dividerReason(name).includes(taught), `${name}: the block text teaches exactly that spelling`);
    assert.equal(hasOwnerDivider(`${STARS}\nINFORMATION FOR ${name.toUpperCase()}`, name), true, `${name} legacy`);
  }
  assert.equal(hasOwnerDivider("*******INFORMATION FOR OTHER********", "Weiß"), false);
});
