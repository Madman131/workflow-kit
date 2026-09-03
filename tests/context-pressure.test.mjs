// workflow-kit — tests for the context-pressure PreToolUse sensor. Both polarities: a planted
// transcript at pressure produces the reminder as additionalContext (and only on bucket
// transitions), and every silence branch — below threshold, subagent payload, Codex-shaped
// payload, missing transcript, off switch — is observed as exit 0 with an EMPTY stdout.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketOf, resolveWindow } from "../hooks/sensor-context-pressure.mjs";

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
  assert.equal(bucketOf(99_999, 200_000, 50, 10), -1);
  assert.equal(bucketOf(100_000, 200_000, 50, 10), 0);
  assert.equal(bucketOf(139_999, 200_000, 50, 10), 1);
  assert.equal(bucketOf(180_000, 200_000, 50, 10), 4);
});

test("the sensor speaks at the threshold as additionalContext, once per bucket, and is silent on every other path", () => {
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
    assert.match(out.hookSpecificOutput.additionalContext, /thread-restart/);
    assert.match(out.hookSpecificOutput.additionalContext, /50%/);
    assert.match(out.hookSpecificOutput.additionalContext, /assumed 200k/);
    assert.match(r.stderr, /CONTEXT PRESSURE/, "the same text goes to stderr for the transcript view");
    // Same bucket again: silent (one reminder per bucket).
    writeFileSync(transcript, usageLine(115_000) + "\n");
    assert.equal(speaks(run(base)), false, "still bucket 0 — no repeat");
    // Next bucket: speaks again.
    writeFileSync(transcript, usageLine(121_000) + "\n");
    r = run(base); assert.equal(speaks(r), true); assert.match(r.stdout, /61%/);
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
