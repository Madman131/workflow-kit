// workflow-kit — tests for the token-ledger Stop sensor and its report. Both polarities: a planted
// transcript yields the EXACT sums (dedupe by message.id, main/sidechain split, session-bound lane
// attribution, per-row delta, skipped-line count), and every fail-open branch — garbage stdin, no
// transcript_path, no session_id, a missing transcript, a non-regular transcript, the off switch —
// is observed allowing WITHOUT writing a row. The report is checked to sum DELTAS per day/task,
// to keep append order, and to announce malformed rows rather than hide them.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTranscript } from "../hooks/sensor-token-ledger.mjs";
import { aggregate, loadRows, render } from "../scripts/token-report.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(KIT, "hooks", "sensor-token-ledger.mjs");
const REPORT = path.join(KIT, "scripts", "token-report.mjs");

function cleanTestEnv(extra = {}) {
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
const MAIN = { input: 300, output: 30, cache_creation: 8, cache_read: 3000, messages: 2 };
const SIDE = { input: 50, output: 5, cache_creation: 0, cache_read: 7, messages: 1 };

test("summarizeTranscript dedupes by message.id, splits sidechain turns, counts skipped lines, and reports the latest context size", () => {
  const s = summarizeTranscript(PLANTED);
  assert.deepEqual(s.main, MAIN, "m1 counted ONCE despite three lines");
  assert.deepEqual(s.sidechain, SIDE);
  assert.equal(s.model, "claude-test-1");
  assert.equal(s.context_now, 200 + 3 + 2000, "context_now is the newest usage record's prompt size");
  assert.equal(s.context_now_main, 2203);
  const sideLast = summarizeTranscript(PLANTED + assistant("s2", { input_tokens: 5, cache_read_input_tokens: 5 }, { isSidechain: true }) + "\n");
  assert.equal(sideLast.context_now, 10, "any-kind newest");
  assert.equal(sideLast.context_now_main, 2203, "the MAIN session's newest is unaffected by a later subagent turn");
  const sideModel = summarizeTranscript(PLANTED + assistant("s3", { input_tokens: 5 }, { isSidechain: true }).replace('"claude-test-1"', '"claude-fable-5-x"') + "\n");
  assert.equal(sideModel.model, "claude-fable-5-x", "any-kind newest model"); assert.equal(sideModel.model_main, "claude-test-1", "the MAIN model is the session's own");
  assert.equal(s.unkeyed, 0);
  assert.equal(s.skipped, 1, "the broken line is COUNTED, not silently dropped");
  assert.notEqual(s.main.input, 500, "a per-line sum would report 500; the dedupe reports 300");
  const noId = summarizeTranscript(line({ type: "assistant", message: { role: "assistant", usage: { input_tokens: 9, output_tokens: 1 } } }) + "\n");
  assert.equal(noId.main.input, 9); assert.equal(noId.unkeyed, 1);
});

test("the Stop sensor appends a session-bound, delta-carrying row, and fails open WITHOUT a row on every bad input", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-"));
  try {
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    const lane = (sessionId) => writeFileSync(path.join(dir, ".claude", "task-lane.json"), line({ mode: "in-thread", sessionId, taskId: "ecc-test", tier: "T1" }));
    lane("sess-1");
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
    let row = rows()[0];
    assert.equal(row.session_id, "sess-1"); assert.equal(row.task_id, "ecc-test"); assert.equal(row.tier, "T1"); assert.equal(row.mode, "in-thread"); assert.equal(row.lane_mismatch, false);
    assert.deepEqual(row.main, MAIN); assert.deepEqual(row.sidechain, SIDE);
    assert.deepEqual(row.delta.main, MAIN, "first row: delta equals the cumulative");
    assert.equal(row.skipped_lines, 1); assert.equal(row.context_now, 2203); assert.equal(row.truncated, false); assert.equal(row.model, "claude-test-1");
    assert.equal(row.transcript, "t.jsonl", "the row carries the transcript's basename only");

    // A second Stop after more usage: cumulative grows, DELTA is only the growth.
    writeFileSync(transcript, PLANTED + assistant("m3", { input_tokens: 40, output_tokens: 4 }) + "\n");
    r = run({ transcript_path: transcript, session_id: "sess-1", stop_hook_active: true });
    assert.equal(r.status, 0); assert.equal(rows().length, 2);
    row = rows()[1];
    assert.equal(row.main.input, 340); assert.equal(row.delta.main.input, 40); assert.equal(row.delta.main.messages, 1);
    assert.deepEqual(row.delta.sidechain, { input: 0, output: 0, cache_creation: 0, cache_read: 0, messages: 0 });
    assert.equal(row.stop_hook_active, true);

    // LANE IS SESSION-BOUND: a declaration for another session yields null attribution + a flag.
    lane("sess-other");
    r = run({ transcript_path: transcript, session_id: "sess-1" });
    assert.equal(r.status, 0); row = rows().at(-1);
    assert.equal(row.task_id, null); assert.equal(row.lane_mismatch, true, "another session's lane is never inherited");
    rmSync(path.join(dir, ".claude", "task-lane.json"));
    r = run({ transcript_path: transcript, session_id: "sess-2" });
    assert.equal(r.status, 0); row = rows().at(-1);
    assert.equal(row.session_id, "sess-2"); assert.equal(row.task_id, null); assert.equal(row.lane_mismatch, false, "no declaration is not a mismatch");

    // FAIL OPEN, WRITE NOTHING: each branch exits 0 and adds no row.
    const before = rows().length;
    for (const [label, payload] of [
      ["garbage stdin", "{nope"],
      ["no transcript_path", { session_id: "sess-1" }],
      ["no session_id", { transcript_path: transcript }],
      ["missing transcript", { transcript_path: path.join(dir, "absent.jsonl"), session_id: "sess-1" }],
      ["non-regular transcript", { transcript_path: dir, session_id: "sess-1" }],
    ]) {
      r = run(payload);
      assert.equal(r.status, 0, `${label}: exit 0 (${r.stderr})`);
      assert.equal(rows().length, before, `${label}: no row written`);
    }
    r = run({ transcript_path: transcript, session_id: "sess-1" }, { WORKFLOW_KIT_TOKEN_LEDGER: "false" });
    assert.equal(r.status, 0); assert.equal(rows().length, before, "off switch: no row");

    // A symlinked transcript is out of model and not read: no row.
    const linkT = path.join(dir, "link.jsonl"); symlinkSync(transcript, linkT);
    { const n = rows().length; r = run({ transcript_path: linkT, session_id: "sess-1" }); assert.equal(r.status, 0); assert.equal(rows().length, n, "symlinked transcript: no row"); }
    // A malformed PREVIOUS row for the session makes the baseline unknown: the next row claims no delta
    // (never a delta equal to the whole cumulative).
    appendFileSync(ledger, JSON.stringify({ session_id: "sess-1", main: "bad", sidechain: "bad" }) + "\n");
    r = run({ transcript_path: transcript, session_id: "sess-1" }); assert.equal(r.status, 0);
    row = rows().at(-1); assert.equal(row.delta, null); assert.match(row.delta_unknown_reason, /previous row unknown/);
    // A ledger PATH that is not a regular file (a directory here; a FIFO would block) is never opened.
    r = run({ transcript_path: transcript, session_id: "sess-1" }, { WORKFLOW_KIT_TOKEN_LEDGER_PATH: dir });
    assert.equal(r.status, 0, "exit 0, promptly");
    // Ledger path override lands the row elsewhere.
    const alt = path.join(dir, "alt.jsonl");
    r = run({ transcript_path: transcript, session_id: "sess-3" }, { WORKFLOW_KIT_TOKEN_LEDGER_PATH: alt });
    assert.equal(r.status, 0); assert.ok(existsSync(alt), "override honoured");

    // The report over the real ledger: deltas summed, both sessions, the task split, the proxy caveat.
    const out = spawnSync(process.execPath, [REPORT, "--ledger", ledger], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /2 session\(s\), 5 row\(s\)/, "the unknown-baseline row is a row; the malformed line is not");
    assert.match(out.stdout, /ecc-test/); assert.match(out.stdout, /\(undeclared\)/);
    // ecc-test = row1 delta (3,308 prompt) + row2 delta (40): 3,348. The mismatch row and sess-2 are undeclared.
    assert.match(out.stdout, /ecc-test\s+1\s+3,348/, "task spend is the SUM OF DELTAS while the session was on that task");
    assert.match(out.stdout, /proxy for/, "the topology caveat is printed with the numbers");
    const js = spawnSync(process.execPath, [REPORT, "--ledger", ledger, "--by", "session", "--json"], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(js.status, 0, js.stderr);
    const parsed = JSON.parse(js.stdout);
    assert.equal(parsed.sessions, 2); assert.equal(parsed.malformed, 1, "the planted bad previous row is counted, not hidden");
    assert.equal(parsed.groups.find((g) => g.key === "sess-1").main_prompt, 3348);
    // Argument hygiene: a missing operand is refused, not silently defaulted.
    const bad = spawnSync(process.execPath, [REPORT, "--ledger"], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(bad.status, 2); assert.match(bad.stderr, /needs a value/);
    const none = spawnSync(process.execPath, [REPORT, "--ledger", path.join(dir, "nope.jsonl")], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(none.status, 1); assert.match(none.stderr, /no ledger at/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the report sums deltas per day and task in append order, counts pre-delta rows once, and announces malformed rows", () => {
  const z = { input: 0, output: 0, cache_creation: 0, cache_read: 0, messages: 0 };
  const d = (input, output = 0) => ({ ...z, input, output, messages: 1 });
  const ledger = [
    line({ ts: "2026-09-03T23:00:00Z", session_id: "a", task_id: "t1", main: d(100), sidechain: z, delta: { main: d(100), sidechain: z } }),
    line({ ts: "2026-09-04T01:00:00Z", session_id: "a", task_id: "t2", main: d(150), sidechain: d(5), delta: { main: d(50), sidechain: d(5) } }),
    line({ ts: "2026-09-04T00:30:00Z", session_id: "a", task_id: "t2", main: d(160), sidechain: d(5), delta: { main: d(10), sidechain: z } }), // clock regression: still counted, in append order
    line({ ts: "2026-09-04T02:00:00Z", session_id: "b", task_id: "t1", main: d(10), sidechain: z }),   // legacy rows (no delta): consecutive
    line({ ts: "2026-09-04T02:30:00Z", session_id: "b", task_id: "t1", main: d(30), sidechain: z }),   //   cumulatives 10 → 30 count as 30, not 40
    "broken line",
    line({ ts: "2026-09-04T03:00:00Z", main: d(999), sidechain: z }),                                    // no session_id ⇒ malformed
    line({ ts: "2026-09-04T03:10:00Z", session_id: "c", delta: { main: {}, sidechain: {} }, main: {} }),   // structurally empty deltas: fine (zeros)
    line({ ts: "2026-09-04T03:20:00Z", session_id: {}, delta: { main: {}, sidechain: {} } }),            // session_id not a string ⇒ malformed
    line({ ts: "2026-09-04T03:30:00Z", session_id: "d", delta: { main: { input: "9" }, sidechain: {} } }), // non-numeric field ⇒ malformed
    line({ ts: "2026-09-04T03:40:00Z", session_id: "f", delta: { main: { input: -9 }, sidechain: {} } }),  // negative field ⇒ malformed
    line({ ts: "2026-09-04T04:00:00Z", session_id: "e", task_id: "t1", main: d(70), sidechain: z, delta: null, truncated: true }), // truncated ⇒ spend unknown
  ].join("\n");
  const { rows, malformed, legacy, truncated } = loadRows(ledger);
  assert.equal(rows.length, 7); assert.equal(malformed, 5); assert.equal(legacy, 2); assert.equal(truncated, 1);
  const byDay = Object.fromEntries(aggregate(rows, "day").map((g) => [g.key, g.main_prompt]));
  assert.deepEqual(byDay, { "2026-09-03": 100, "2026-09-04": 90 }, "day spend = deltas in that day (50 + 10 + legacy 10 + 20); the truncated 70 is NOT counted");
  const byTask = Object.fromEntries(aggregate(rows, "task").map((g) => [g.key, g.main_prompt]));
  assert.deepEqual(byTask, { t1: 130, t2: 60, "(undeclared)": 0 }, "task spend follows the task each delta was recorded under; legacy 10→30 counts 30, never 40");
  const text = render(aggregate(rows, "task"), "task", { malformed, legacy, truncated, sessions: 5 });
  assert.match(text, /WARNING: 5 malformed row\(s\) ignored/);
  assert.match(text, /2 pre-delta row\(s\)/);
  assert.match(text, /1 row\(s\) carry no delta/);
});

test("init installs the Stop sensor file and registers it once, alongside guard-owner-comms", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-adopt-"));
  try {
    const init = () => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8", env: cleanTestEnv() });
    execFileSync("git", ["init", "-q", dir]);   // the git tree exists BEFORE the installer runs, as in an adopter
    let r = init(); assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "sensor-token-ledger.mjs")), "hook file installed by disk discovery");
    const count = () => (JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8")).hooks?.Stop ?? [])
      .flatMap((g) => g.hooks ?? []).filter((h) => String(h.command).includes("sensor-token-ledger.mjs")).length;
    assert.equal(count(), 1, "registered exactly once");
    r = init(); assert.equal(r.status, 0, r.stderr);
    assert.equal(count(), 1, "a re-run does not duplicate the registration");
    // The ledger is described everywhere as UNTRACKED; ask git whether that is true rather than
    // trusting the description. check-ignore exits 0 only when the path IS ignored.
    assert.doesNotMatch(r.stdout + r.stderr, /\.claude\/metrics\/ is ALREADY TRACKED/, "no untrack warning when nothing is indexed");
    assert.equal(spawnSync("git", ["-C", dir, "check-ignore", "-q", ".claude/metrics/tokens.jsonl"]).status, 0,
      "the ledger the sensor writes is gitignored — otherwise a blanket add commits per-turn token rows");
    assert.notEqual(spawnSync("git", ["-C", dir, "check-ignore", "-q", ".claude/settings.json"]).status, 0,
      "…and the registration that arms it is NOT (it must travel with the repo)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init WARNS, with the exact untrack command, when the ledger is already indexed — an ignore rule cannot untrack it", () => {
  // The upgrading cohort: a v2.27.0 adopter committed .claude/metrics/tokens.jsonl before this rule
  // existed. Nothing in a gitignore append reaches the index, so init says so. Fail-open sensor.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-indexed-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    mkdirSync(path.join(dir, ".claude", "metrics"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "metrics", "tokens.jsonl"), '{"ts":"2026-01-01T00:00:00Z","sessionId":"s"}\n');
    execFileSync("git", ["-C", dir, "add", "--", ".claude/metrics/tokens.jsonl"]);
    execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(r.status, 1, "a tracked ledger is a FAILING state, counted at the exit code — not a warning at exit 0");
    assert.match(r.stdout + r.stderr, /\.claude\/metrics\/ is ALREADY TRACKED/, "the refusal names the path");
    assert.match(r.stdout + r.stderr, /git rm --cached -r -- \.claude\/metrics\//, "…carries the exact command (-r: a directory)");
    assert.match(r.stdout + r.stderr, /STILL TRACKED by git, or could not be checked/, "…and is repeated in the end-of-run accounting");
    assert.doesNotMatch(r.stdout + r.stderr, /could NOT be written/, "the rule WAS written here, so the advice does not say otherwise");
    assert.equal(spawnSync("git", ["-C", dir, "ls-files", "--", ".claude/metrics/tokens.jsonl"], { encoding: "utf8" }).stdout.trim(),
      ".claude/metrics/tokens.jsonl", "init did NOT untrack it — that write is the adopter's, not the installer's");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an indexed ledger behind a .gitignore init could not write: the advice says the rule is NOT there, and orders the steps", () => {
  // A symlinked .gitignore is a refused append. Untracking on a rule that was never written re-adds
  // the file on the next blanket add, so the message must not claim "the ignore rule init just wrote".
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-nogi-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-nogi-out-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(path.join(outside, "ignores"), "node_modules\n");
    symlinkSync(path.join(outside, "ignores"), path.join(dir, ".gitignore"));
    mkdirSync(path.join(dir, ".claude", "metrics"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "metrics", "tokens.jsonl"), "{}\n");
    execFileSync("git", ["-C", dir, "add", "--", ".claude/metrics/tokens.jsonl"]);
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout + r.stderr, /\.claude\/metrics\/ is ALREADY TRACKED in this repository, AND the ignore rule for it could NOT be written/, "both facts, in one sentence");
    assert.match(r.stdout + r.stderr, /Fix \.gitignore first, then run  git rm --cached -r -- \.claude\/metrics\//, "…in the right order");
    assert.doesNotMatch(r.stdout + r.stderr, /The ignore rule init just wrote/, "never claims a rule it did not write");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("outside a git repository the index sensor has nothing to ask and says nothing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-ledger-norepo-"));
  try {
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8", env: cleanTestEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /ALREADY TRACKED|could not ask git|REFUSED to certify/, "not a repository is a legitimate absence, not a refusal");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
