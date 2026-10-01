// workflow-kit — tests for the context-pressure PreToolUse sensor. Both polarities: a planted
// transcript at pressure produces the reminder as additionalContext (and only on bucket
// transitions), and every silence branch — below threshold, subagent payload, Codex-shaped
// payload, missing transcript, off switch — is observed as exit 0 with an EMPTY stdout.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { banner, levelOf, resolveWindow } from "../hooks/sensor-context-pressure.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(KIT, "hooks", "sensor-context-pressure.mjs");

function cleanEnv(extra = {}) {
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST") || k.startsWith("WORKFLOW_KIT_CONTEXT")) delete e[k];
  return { ...e, ...extra };
}
const usageLine = (tokens, model = "claude-test-1", extra = {}) => JSON.stringify({ type: "assistant", message: { id: `m${tokens}`, role: "assistant", model, usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 1000, output_tokens: 5 }, content: [{ type: "text", text: "x" }] }, ...extra });

test("resolveWindow trusts the override, then the marker, then the family list, then the size, then assumes", () => {
  assert.deepEqual(resolveWindow(10, "claude-test", { WORKFLOW_KIT_CONTEXT_WINDOW: "400000" }), { window: 400000, source: "override" });
  assert.equal(resolveWindow(10, "claude-sonnet-4-5 [1m]", {}).window, 1_000_000);
  assert.equal(resolveWindow(10, "us.anthropic.claude-fable-5-20260115-v1:0", {}).source, "known family");
  assert.equal(resolveWindow(10, "claude-fable-5-mini", {}).window, 200_000, "a letter suffix is a different model");
  assert.equal(resolveWindow(10, "claude-sonnet-5", {}).source, "known family", "Sonnet 5 ships a 1M window");
  assert.equal(resolveWindow(10, "notclaude-opus-5-20260115", {}).window, 200_000, "the family must start at a boundary, not mid-word");
  assert.equal(resolveWindow(10, "x", { WORKFLOW_KIT_CONTEXT_WINDOW: "1e6" }).source.startsWith("assumed"), true, "a malformed override is ignored, not parsed as 1");
  assert.equal(resolveWindow(350_000, "mystery", {}).source, "inferred from size (assumed 1M)");
  assert.match(resolveWindow(10, "mystery", {}).source, /assumed 200k/);
  assert.equal(levelOf(99_999, 200_000, 50, 70), 0);
  assert.equal(levelOf(100_000, 200_000, 50, 70), 1);
  assert.equal(levelOf(139_999, 200_000, 50, 70), 1);
  assert.equal(levelOf(140_000, 200_000, 50, 70), 2);
});

test("the sensor speaks at the threshold as additionalContext, once per level, and is silent on every other path", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ctx-"));
  try {
    const transcript = path.join(dir, "t.jsonl");
    const state = path.join(dir, "state");
    const run = (payload, env = {}) => {
      const r = spawnSync(process.execPath, [HOOK], { cwd: dir, encoding: "utf8", input: typeof payload === "string" ? payload : JSON.stringify(payload),
        env: cleanEnv({ CLAUDE_PROJECT_DIR: dir, WORKFLOW_KIT_CONTEXT_STATE_DIR: state, ...env }) });
      assert.equal(r.status, 0, `exit 0 always: ${r.stderr}`);
      return r;
    };
    const speaks = (r) => r.stdout.includes("additionalContext");
    const base = { transcript_path: transcript, session_id: "sess-A", tool_name: "Edit", tool_input: { file_path: path.join(dir, "x.md") } };

    // Below threshold (200k assumed window, 50%): silent.
    writeFileSync(transcript, usageLine(80_000) + "\n");
    assert.equal(speaks(run(base)), false, "80k of 200k is below 50%");
    // At threshold: speaks, names the digest and the assumed window.
    writeFileSync(transcript, usageLine(100_000) + "\n");
    let r = run(base);
    assert.equal(speaks(r), true);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(out.hookSpecificOutput.additionalContext, /^\*\*CONTEXT WINDOW WARNING — ~50%/);
    assert.match(out.hookSpecificOutput.additionalContext, /assumed 200k/);
    assert.match(r.stderr, /CONTEXT WINDOW WARNING/, "the same text goes to stderr for the transcript view");
    // Same level again: silent (each level fires once).
    writeFileSync(transcript, usageLine(115_000) + "\n");
    assert.equal(speaks(run(base)), false, "still level 1 — no repeat");
    writeFileSync(transcript, usageLine(121_000) + "\n");
    assert.equal(speaks(run(base)), false, "no 10%-step re-reminders any more");
    // 70%: the hard stop fires once.
    writeFileSync(transcript, usageLine(141_000) + "\n");
    r = run(base); assert.equal(speaks(r), true); assert.match(r.stdout, /HARD STOP ~71%/);
    writeFileSync(transcript, usageLine(170_000) + "\n");
    assert.equal(speaks(run(base)), false, "hard stop already fired");
    // A different session has its own state: speaks at its first crossing.
    assert.equal(speaks(run({ ...base, session_id: "sess-B" })), true);
    // Window detection changes the denominator: a 1M family at 121k is 12% — silent.
    writeFileSync(transcript, usageLine(121_000, "claude-fable-5-20260101") + "\n");
    assert.equal(speaks(run({ ...base, session_id: "sess-C" })), false);
    writeFileSync(transcript, usageLine(520_000, "claude-fable-5-20260101") + "\n");
    r = run({ ...base, session_id: "sess-C" }); assert.equal(speaks(r), true); assert.match(r.stdout, /known family/);
    // Thresholds are tunable.
    writeFileSync(transcript, usageLine(45_000) + "\n");
    assert.equal(speaks(run({ ...base, session_id: "sess-D" }, { WORKFLOW_KIT_CONTEXT_THRESHOLD_PCT: "20" })), true, "20% of 200k is 40k");
    // A SUBAGENT's newest record does not measure the main session: main at 150k, then a sidechain
    // turn at 10k → still 75% → speaks; and a sidechain record at 190k after a main one at 20k → silent.
    writeFileSync(transcript, usageLine(150_000) + "\n" + usageLine(10_000, "claude-test-1", { isSidechain: true }) + "\n");
    r = run({ ...base, session_id: "sess-G" }); assert.equal(speaks(r), true); assert.match(r.stdout, /75%/);
    writeFileSync(transcript, usageLine(20_000) + "\n" + usageLine(190_000, "claude-test-1", { isSidechain: true }) + "\n");
    assert.equal(speaks(run({ ...base, session_id: "sess-H" })), false, "a subagent's context is not this session's pressure");
    // …nor does a subagent's MODEL pick the denominator: main 150k on a 200k model, then a sidechain
    // turn on a 1M family → still 75% of 200k → speaks.
    writeFileSync(transcript, usageLine(150_000) + "\n" + usageLine(10_000, "claude-fable-5-20260101", { isSidechain: true }) + "\n");
    r = run({ ...base, session_id: "sess-J" }); assert.equal(speaks(r), true, "the main session's model sets the window"); assert.match(r.stdout, /75%/);
    // A symlinked transcript path is out of model: silent.
    const linkT = path.join(dir, "link.jsonl"); symlinkSync(transcript, linkT);
    assert.equal(speaks(run({ ...base, session_id: "sess-K", transcript_path: linkT })), false, "symlinked transcript: silent");
    // A WINDOW CHANGE resets the bucket memory: 180k on a 200k model (bucket 4), then the same session
    // on a 1M model at 520k (bucket 0 of a different window) must speak, not be suppressed.
    writeFileSync(transcript, usageLine(180_000) + "\n");
    assert.equal(speaks(run({ ...base, session_id: "sess-I" })), true);
    writeFileSync(transcript, usageLine(520_000, "claude-fable-5-20260101") + "\n");
    r = run({ ...base, session_id: "sess-I" }); assert.equal(speaks(r), true, "a new denominator starts a new bucket series"); assert.match(r.stdout, /52%/);

    // SILENCE branches — exit 0 and EMPTY stdout, never a partial JSON.
    writeFileSync(transcript, usageLine(150_000) + "\n");
    for (const [label, payload, env] of [
      ["subagent payload (agent_id)", { ...base, session_id: "sess-E", agent_id: "sub-1" }, {}],
      ["subagent payload (agent_type)", { ...base, session_id: "sess-E", agent_type: "Explore" }, {}],
      ["non-regular transcript path", { ...base, session_id: "sess-E", transcript_path: dir }, {}],
      ["JSON primitive on stdin", "42", {}],
      ["Codex-shaped payload (no transcript_path)", { session_id: "sess-E", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch" } }, {}],
      ["missing transcript", { ...base, session_id: "sess-E", transcript_path: path.join(dir, "absent.jsonl") }, {}],
      ["garbage stdin", "{nope", {}],
      ["off switch", { ...base, session_id: "sess-E" }, { WORKFLOW_KIT_CONTEXT_SENSOR: "false" }],
    ]) {
      r = run(payload, env);
      assert.equal(r.stdout, "", `${label}: silent`);
    }
    // …and the same session, with the switch back on, DOES speak — proving the silence above was the switch.
    assert.equal(speaks(run({ ...base, session_id: "sess-E" })), true);
    // A transcript with no usage record at all: silent (nothing to measure is not "under pressure").
    writeFileSync(transcript, JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n");
    assert.equal(speaks(run({ ...base, session_id: "sess-F" })), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init installs the sensor and registers it on the write matcher once", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ctx-adopt-"));
  try {
    const init = () => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8", env: cleanEnv() });
    let r = init(); assert.equal(r.status, 0, r.stderr);
    const settings = () => JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const count = () => (settings().hooks?.PreToolUse ?? []).flatMap((g) => (g.matcher || "").includes("Edit") ? g.hooks ?? [] : [])
      .filter((h) => String(h.command).includes("sensor-context-pressure.mjs")).length;
    assert.equal(count(), 1, "registered once on the write matcher");
    r = init(); assert.equal(r.status, 0, r.stderr);
    assert.equal(count(), 1, "re-run does not duplicate");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("read-only state after the level fires: Stop never blocks, but the announcement still appears", () => {
  const t = rig();
  try {
    t.at(100_000); t.run(t.ups("ro"));
    const f = path.join(t.dir, "s", "workflow-kit-context-ro");
    assert.ok(existsSync(f), "the level fired and persisted");
    chmodSync(f, 0o444);
    let writable = true; try { writeFileSync(f, readFileSync(f)); } catch { writable = false; }
    if (!writable) {   // (skipped only where a superuser can write through 0444)
      for (let i = 0; i < 3; i++) assert.equal(t.run(t.stop("no banner", "ro")).stdout, "", `Stop ${i}: allow, never a repeat block`);
    }
    // (b) An announcement never blocks, so it still appears when its level cannot be remembered.
    t.at(150_000);
    assert.equal(t.ctx(t.run(t.ups("ro"))).split("\n")[0], HARD(75), "the hard stop is still announced with unwritable state");
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});

const WARN = (n) => `**CONTEXT WINDOW WARNING — ~${n}%: restart this thread at the next natural breakpoint (push / chip end)**`;
const HARD = (n) => `**CONTEXT WINDOW — HARD STOP ~${n}%: write the restart digest now and restart before further work**`;
function rig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ctx-lv-"));
  const transcript = path.join(dir, "t.jsonl");
  const state = path.join(dir, "s");
  const run = (payload, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK], { cwd: dir, encoding: "utf8", input: typeof payload === "string" ? payload : JSON.stringify(payload),
      env: cleanEnv({ WORKFLOW_KIT_CONTEXT_STATE_DIR: state, ...env }) });
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  const at = (tokens) => writeFileSync(transcript, usageLine(tokens) + "\n");
  const ups = (sid = "s1") => ({ transcript_path: transcript, session_id: sid, hook_event_name: "UserPromptSubmit", prompt: "go" });
  const pre = (sid = "s1") => ({ transcript_path: transcript, session_id: sid, hook_event_name: "PreToolUse", tool_name: "Edit" });
  const stop = (msg, sid = "s1", extra = {}) => ({ transcript_path: transcript, session_id: sid, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: msg, ...extra });
  const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  return { dir, run, at, ups, pre, stop, ctx };
}

test("both banner texts are pinned verbatim, first line, with the verbatim instruction", () => {
  assert.equal(banner(1, 52), WARN(52));
  assert.equal(banner(2, 71), HARD(71));
  const t = rig();
  try {
    t.at(100_000);
    let c = t.ctx(t.run(t.ups()));
    assert.equal(c.split("\n")[0], WARN(50));
    assert.match(c, /^Put the line above VERBATIM as the FIRST line of your next message to the Owner\.$/m);
    t.at(150_000);
    c = t.ctx(t.run(t.ups()));
    assert.equal(c.split("\n")[0], HARD(75));
    assert.match(c, /^Put the line above VERBATIM as the FIRST line of your next message to the Owner\.$/m);
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});

test("50 then 70 each fire once, across events; a direct jump to 70 fires only the hard stop and marks 50 done", () => {
  const t = rig();
  try {
    t.at(100_000);
    assert.equal(JSON.parse(t.run(t.ups()).stdout).hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.equal(t.run(t.pre()).stdout, "", "PreToolUse after UserPromptSubmit at the same level: silent");
    t.at(145_000);
    assert.equal(t.ctx(t.run(t.pre())).split("\n")[0], HARD(73), "70 fires after 50");
    assert.equal(JSON.parse(t.run(t.pre()).stdout || "{}").hookSpecificOutput, undefined);
    // Direct jump on a fresh session.
    t.at(150_000);
    assert.equal(t.ctx(t.run(t.pre("j"))).split("\n")[0], HARD(75), "only the hard stop");
    t.at(100_000);
    assert.equal(t.run(t.pre("j")).stdout, "", "50 is marked done too (never fires after a jump)");
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});

test("Stop blocks when the banner is missing, allows and marks surfaced when present, blocks once, respects stop_hook_active, fails open", () => {
  const t = rig();
  try {
    t.at(100_000); t.run(t.ups());
    // Missing banner ⇒ block, with the banner in the reason.
    let r = t.run(t.stop("Done with the step."));
    let out = JSON.parse(r.stdout);
    assert.equal(out.decision, "block");
    assert.ok(out.reason.includes(WARN(50)));
    // One block per level: the same missing banner again is allowed.
    assert.equal(t.run(t.stop("Still no banner.")).stdout, "", "block cap: one per level");
    // Present banner (first line, trimmed) ⇒ allowed and surfaced.
    assert.equal(t.run(t.stop(`  ${WARN(50)}  \nrest`)).stdout, "");
    // Surfaced ⇒ a later message without the banner is not blocked.
    assert.equal(t.run(t.stop("plain")).stdout, "", "surfaced level never blocks again");
    // Surfaced without any block spent: the banner alone marks it, so a later bare message is not blocked.
    t.run(t.ups("q"));
    assert.equal(t.run(t.stop(WARN(50), "q")).stdout, "");
    assert.equal(t.run(t.stop("bare", "q")).stdout, "", "surfaced by the banner itself, no block was ever spent");
    // A banner that is not the FIRST line does not count (fresh session, exact first-line match).
    t.run(t.ups("k"));
    assert.equal(JSON.parse(t.run(t.stop(`intro\n${WARN(50)}`, "k")).stdout).decision, "block", "must be the first line");
    // stop_hook_active ⇒ allow, even with a missing banner and no block spent.
    t.run(t.ups("m"));
    assert.equal(t.run(t.stop("no banner", "m", { stop_hook_active: true })).stdout, "");
    assert.equal(JSON.parse(t.run(t.stop("no banner", "m")).stdout).decision, "block", "the active-skip spent nothing");
    // A hard stop after a surfaced warning blocks afresh, once.
    t.at(150_000); t.run(t.ups());
    out = JSON.parse(t.run(t.stop(WARN(50))).stdout);
    assert.equal(out.decision, "block");
    assert.ok(out.reason.includes(HARD(75)));
    // Fail-open: empty/malformed stdin, missing last_assistant_message, no state, off switch.
    t.run(t.ups("n"));
    for (const [label, payload, env] of [
      ["empty stdin", "", {}], ["malformed stdin", "{nope", {}],
      ["missing last_assistant_message", { transcript_path: "x", session_id: "n", hook_event_name: "Stop" }, {}],
      ["non-string last_assistant_message", t.stop(42, "n"), {}],
      ["no state for the session", t.stop("x", "never-seen"), {}],
      ["off switch", t.stop("x", "n"), { WORKFLOW_KIT_CONTEXT_SENSOR: "false" }],
      ["subagent payload", t.stop("x", "n", { agent_id: "a" }), {}],
    ]) assert.equal(t.run(payload, env).stdout, "", `${label}: exit 0, no block`);
    assert.equal(JSON.parse(t.run(t.stop("x", "n")).stdout).decision, "block", "…and the state was untouched by those");
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});

test("init registers the sensor on UserPromptSubmit and Stop exactly once, upgrades an older settings file once, and re-init does not duplicate", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ctx-ups-init-"));
  try {
    const prompts = path.join(dir, "codex-prompts");
    const init = (...more) => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane", "--codex-prompts-dir", prompts, ...more], { encoding: "utf8", env: cleanEnv() });
    const file = path.join(dir, ".claude", "settings.json");
    const settings = () => JSON.parse(readFileSync(file, "utf8"));
    const cmd = (event) => (settings().hooks?.[event] ?? []).flatMap((g) => g.hooks ?? []).filter((h) => String(h.command).includes("sensor-context-pressure.mjs")).length;
    let r = init(); assert.equal(r.status, 0, r.stderr);
    assert.equal(cmd("UserPromptSubmit"), 1);
    assert.equal(cmd("Stop"), 1);
    assert.equal(cmd("PreToolUse"), 1);
    // Upgrade path: an adopter file that has the v2.37.0 shape (no UserPromptSubmit group).
    const s = settings(); delete s.hooks.UserPromptSubmit;
    s.hooks.Stop[0].hooks = s.hooks.Stop[0].hooks.filter((h) => !String(h.command).includes("sensor-context-pressure")); writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
    assert.equal(cmd("UserPromptSubmit"), 0); assert.equal(cmd("Stop"), 0);
    r = init("--force"); assert.equal(r.status, 0, r.stderr);
    assert.equal(cmd("UserPromptSubmit"), 1, "the upgrade adds the group once");
    r = init("--force"); assert.equal(r.status, 0, r.stderr);
    assert.equal(cmd("UserPromptSubmit"), 1, "re-init --force does not duplicate it");
    assert.equal(cmd("Stop"), 1, "the upgrade adds the Stop registration once; re-init does not duplicate it");
    assert.equal(settings().hooks.Stop.length, 1, "merged into the one Stop group");
    assert.equal(cmd("PreToolUse"), 1, "…nor the PreToolUse group");
    assert.equal(settings().hooks.UserPromptSubmit.length, 1, "one group, not several");
    // Never registered on Bash or send_message for this sensor.
    for (const g of settings().hooks.PreToolUse) if (g.matcher === "Bash" || String(g.matcher).includes("send_message")) assert.equal(JSON.stringify(g).includes("sensor-context-pressure"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("v2.37.1 release: note wording and the paste-in snippet", () => {
  const readme = readFileSync(path.join(KIT, "README.md"), "utf8");
  const note = readme.slice(readme.indexOf("## What's new in v2.37.1"), readme.indexOf("## What's new in v2.37.0")).replace(/\s+/g, " ");
  assert.match(note, /\*\*Claude lane only\.\*\* This sensor is not registered in the Codex lane\. \(Corrected in v2\.40\.0: this bullet first said Codex sends no Stop payload\./);
  assert.match(note, /No `\.codex\/hooks\.json` entry changed in v2\.37\.1, so \*\*no re-trust\*\* then/);
  assert.match(note, /"UserPromptSubmit": \[/);
  assert.match(note, /"Stop": \[/);
  assert.match(note, /sensor-context-pressure\.mjs/);
});
