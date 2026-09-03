// workflow-kit — tests for the token-ledger Stop sensor and its report. Both polarities: a planted
// transcript yields the EXACT sums (dedupe by message.id, main/sidechain split, lane attribution),
// and every fail-open branch is observed allowing WITHOUT writing a row — a sensor that wrote a row
// on garbage would be manufacturing a measurement.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTranscript } from "../hooks/sensor-token-ledger.mjs";
import { aggregate, loadLatestPerSession, render } from "../scripts/token-report.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(KIT, "hooks", "sensor-token-ledger.mjs");
const REPORT = path.join(KIT, "scripts", "token-report.mjs");

function cleanTestEnv(extra = {}) {
  // Strip the runner's own env AND any ledger switches the operator's shell carries, THEN apply the
  // case's own values — the other order silently deleted the off switch a case was setting.
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST")) delete e[k];
  delete e.WORKFLOW_KIT_TOKEN_LEDGER;
  delete e.WORKFLOW_KIT_TOKEN_LEDGER_PATH;
  return { ...e, ...extra };
}

const line = (o) => JSON.stringify(o);
const assistant = (id, usage, extra = {}) => line({ type: "assistant", message: { id, role: "assistant", model: "claude-test-1", usage, content: [{ type: "text", text: "x" }] }, ...extra });

// One assistant message written as THREE lines (one per content block) — the shape that over-counts
// when summed per line — plus a second message, a sidechain seat, a user turn and a broken line.
const PLANTED = [
  line({ type: "user", message: { role: "user", content: "go" } }),
  assistant("m1", { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000 }),
  assistant("m1", { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000 }),
  assistant("m1", { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000 }),
  "{not json",
  assistant("s1", { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 7 }, { isSidechain: true }),
  assistant("m2", { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 3, cache_read_input_tokens: 2000 }),
].join("\n") + "\n";

test("summarizeTranscript dedupes by message.id, splits sidechain turns, and reports the latest context size", () => {
  const s = summarizeTranscript(PLANTED);
  assert.deepEqual(s.main, { input: 300, output: 30, cache_creation: 8, cache_read: 3000, messages: 2 }, "m1 counted ONCE despite three lines");
  assert.deepEqual(s.sidechain, { input: 50, output: 5, cache_creation: 0, cache_read: 7, messages: 1 });
  assert.equal(s.model, "claude-test-1");
  assert.equal(s.context_now, 200 + 3 + 2000, "context_now is the newest usage record's prompt size");
  assert.equal(s.unkeyed, 0);
  // The polarity that matters: the naive per-line sum is WRONG, and this function does not produce it.
  assert.notEqual(s.main.input, 500, "a per-line sum would report 500; the dedupe reports 300");
  // An id-less record is counted once and REPORTED as unkeyed, never silently dropped or merged.
  const noId = summarizeTranscript(line({ type: "assistant", message: { role: "assistant", usage: { input_tokens: 9, output_tokens: 1 } } }) + "\n");
  assert.equal(noId.main.input, 9); assert.equal(noId.unkeyed, 1);
});

test("the Stop sensor appends a lane-attributed row, fails open on every bad input, and honours the off switch", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-"));
  try {
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "task-lane.json"), line({ mode: "in-thread", sessionId: "sess-1", taskId: "ecc-test", tier: "T1" }));
    const transcript = path.join(dir, "t.jsonl");
    writeFileSync(transcript, PLANTED);
    const ledger = path.join(dir, ".claude", "metrics", "tokens.jsonl");
    const run = (payload, env = {}) => spawnSync(process.execPath, [HOOK], {
      cwd: dir, encoding: "utf8", input: typeof payload === "string" ? payload : JSON.stringify(payload),
      env: cleanTestEnv({ CLAUDE_PROJECT_DIR: dir, ...env }),
    });
    const rows = () => (existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

    let r = run({ transcript_path: transcript, session_id: "sess-1", stop_hook_active: false });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, "", "a sensor prints nothing on stdout");
    assert.equal(rows().length, 1, "one row per Stop");
    const row = rows()[0];
    assert.equal(row.session_id, "sess-1"); assert.equal(row.task_id, "ecc-test"); assert.equal(row.tier, "T1"); assert.equal(row.mode, "in-thread");
    assert.deepEqual(row.main, { input: 300, output: 30, cache_creation: 8, cache_read: 3000, messages: 2 });
    assert.deepEqual(row.sidechain, { input: 50, output: 5, cache_creation: 0, cache_read: 7, messages: 1 });
    assert.equal(row.context_now, 2203); assert.equal(row.truncated, false); assert.equal(row.model, "claude-test-1");
    assert.equal(row.transcript, "t.jsonl", "the row carries the transcript's basename only");

    // A second Stop appends a second CUMULATIVE row; the report keeps the latest per session.
    r = run({ transcript_path: transcript, session_id: "sess-1", stop_hook_active: true });
    assert.equal(r.status, 0); assert.equal(rows().length, 2); assert.equal(rows()[1].stop_hook_active, true);

    // FAIL OPEN, WRITE NOTHING: each branch exits 0 and adds no row.
    const before = rows().length;
    for (const [label, payload] of [
      ["garbage stdin", "{nope"],
      ["no transcript_path", { session_id: "sess-1" }],
      ["missing transcript", { transcript_path: path.join(dir, "absent.jsonl"), session_id: "sess-1" }],
    ]) {
      r = run(payload);
      assert.equal(r.status, 0, `${label}: exit 0 (${r.stderr})`);
      assert.equal(rows().length, before, `${label}: no row written`);
    }
    r = run({ transcript_path: transcript, session_id: "sess-1" }, { WORKFLOW_KIT_TOKEN_LEDGER: "false" });
    assert.equal(r.status, 0); assert.equal(rows().length, before, "off switch: no row");

    // No lane declared ⇒ null attribution, still a row (the measurement does not depend on the lane).
    rmSync(path.join(dir, ".claude", "task-lane.json"));
    r = run({ transcript_path: transcript, session_id: "sess-2" });
    assert.equal(r.status, 0);
    const last = rows().at(-1);
    assert.equal(last.session_id, "sess-2"); assert.equal(last.task_id, null); assert.equal(last.tier, null);

    // Ledger path override lands the row elsewhere.
    const alt = path.join(dir, "alt.jsonl");
    r = run({ transcript_path: transcript, session_id: "sess-3" }, { WORKFLOW_KIT_TOKEN_LEDGER_PATH: alt });
    assert.equal(r.status, 0); assert.ok(existsSync(alt), "override honoured");

    // The report: latest snapshot per session, grouped by task, with a main/side split.
    const out = spawnSync(process.execPath, [REPORT, "--ledger", ledger], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /2 session\(s\)/, "sess-1 (two rows) and sess-2 collapse to two sessions");
    assert.match(out.stdout, /ecc-test/); assert.match(out.stdout, /\(undeclared\)/);
    assert.match(out.stdout, /3,308/, "main prompt for ecc-test = 300 + 8 + 3000");
    assert.match(out.stdout, /Codex CLI seats are not in this ledger/, "the limit is printed with the numbers");
    const js = spawnSync(process.execPath, [REPORT, "--ledger", ledger, "--by", "session", "--json"], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(js.status, 0, js.stderr);
    const parsed = JSON.parse(js.stdout);
    assert.equal(parsed.sessions, 2);
    assert.equal(parsed.groups.find((g) => g.key === "sess-1").side_prompt, 57);
    // A missing ledger is an error with the path in it, never an empty report that reads as "no spend".
    const none = spawnSync(process.execPath, [REPORT, "--ledger", path.join(dir, "nope.jsonl")], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(none.status, 1); assert.match(none.stderr, /no ledger at/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the report's aggregation keeps the LATEST row per session and never sums snapshots", () => {
  const rows = loadLatestPerSession([
    line({ ts: "2026-09-03T01:00:00Z", session_id: "a", task_id: "t", main: { input: 10, output: 1, cache_creation: 0, cache_read: 0, messages: 1 }, sidechain: { input: 0, output: 0, cache_creation: 0, cache_read: 0, messages: 0 } }),
    line({ ts: "2026-09-03T02:00:00Z", session_id: "a", task_id: "t", main: { input: 30, output: 3, cache_creation: 0, cache_read: 0, messages: 3 }, sidechain: { input: 5, output: 1, cache_creation: 0, cache_read: 0, messages: 1 } }),
    "broken line",
  ].join("\n"));
  assert.equal(rows.length, 1); assert.equal(rows[0].main.input, 30, "latest snapshot wins; 10 is never added to 30");
  const g = aggregate(rows, "task");
  assert.deepEqual(g.map((x) => [x.key, x.main_prompt, x.side_prompt]), [["t", 30, 5]]);
  assert.match(render(g, "task"), /TOTAL\s+1\s+30\s+3\s+5\s+1\s+14%/);
});

test("init installs the Stop sensor file and registers it once, alongside guard-owner-comms", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-adopt-"));
  try {
    const init = () => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8", env: cleanTestEnv() });
    let r = init(); assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "sensor-token-ledger.mjs")), "hook file installed by disk discovery");
    const count = () => (JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8")).hooks?.Stop ?? [])
      .flatMap((g) => g.hooks ?? []).filter((h) => String(h.command).includes("sensor-token-ledger.mjs")).length;
    assert.equal(count(), 1, "registered exactly once");
    r = init(); assert.equal(r.status, 0, r.stderr);
    assert.equal(count(), 1, "a re-run does not duplicate the registration");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
