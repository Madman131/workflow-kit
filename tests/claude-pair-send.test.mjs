// tests/claude-pair-send.test.mjs — v2.33.1 P1/P2: the Architect decision screen binds a Claude PM.
//
// The Codex pair (`pairedPmThreadId`, the exact Codex app thread-send tool) is proven in
// brief-rung.test.mjs and is unchanged here. This file proves the Claude lane: Claude Code's
// `SendMessage` (addressed by `to`) and the older `…send_message` tool (addressed by `session_id`),
// paired by `pairedPmClaudeTarget` — the PM's STABLE ListAgents ref or session/agent id — so a
// renamed session title can never silently switch the screen off.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { claudePairMatches, denyReason, loadBriefConfig } from "../hooks/guard-brief-rung.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OK_CHECK = [{ command: "wc -w PROTOCOLS.md", output: "1987" }];
const PROMPT = "Proceed with the approved bounded chip.";
const screen = (prompt = PROMPT) => ({
  promptSha256: createHash("sha256").update(prompt).digest("hex"),
  decisionId: "chip-1-direction",
  action: {
    approvedOutcome: "Deliver the approved chip without changing its endpoint.",
    blueprintAlignment: "The step implements the approved architecture path.",
    smallestAction: "Change only the named chip files.",
    kiss: "Reuse the existing guard and record.",
    zoomOut: "This is still the shortest path to the release outcome.",
    rootCause: "The current dispatch lacks a checked screening record.",
    cost: "One bounded edit and its existing review gate.",
    evaluation: {
      observedEvidence: "The approved chip and current gate receipt identify this bounded step.",
      noAction: "The approved result remains delayed while the PM waits.",
    },
    alternatives: [
      { route: "proceed", tradeoff: "Finish the bounded chip with its existing gate." },
      { route: "defer", tradeoff: "Avoid work now but delay the approved result." },
    ],
    choice: "proceed",
    choiceReason: "The bounded step preserves the approved outcome and passes its existing gate.",
  },
  findings: [],
});

test("the pair matches the whole address, the ref inside a trailing [ref], or the bare name — nothing looser", () => {
  assert.equal(claudePairMatches("3fa9c1", "3fa9c1"), true, "an id or ref sent bare");
  assert.equal(claudePairMatches("PM Kit [3fa9c1]", "3fa9c1"), true, "a name carrying the configured ref");
  assert.equal(claudePairMatches("Renamed title [3fa9c1]", "3fa9c1"), true, "a RENAMED title keeps the same ref and still pairs");
  assert.equal(claudePairMatches("PM Kit [3fa9c1]", "PM Kit"), true, "bare-name fallback for an operator who configured a name");
  assert.equal(claudePairMatches("PM Kit", "PM Kit"), true);
  assert.equal(claudePairMatches("Other [aaaaaa]", "3fa9c1"), false, "another agent's ref never pairs");
  assert.equal(claudePairMatches("PM Kit [3fa9c1] extra", "3fa9c1"), false, "the ref must be the trailing bracket");
  assert.equal(claudePairMatches("3fa9c1x", "3fa9c1"), false, "no substring match");
  assert.equal(claudePairMatches(undefined, "3fa9c1"), false);
  assert.equal(claudePairMatches("PM", ""), false);
});

test("pairedPmClaudeTarget: valid forms load; malformed ones fail CLOSED; a Codex-only config reads as before", () => {
  const read = (v) => () => v;
  assert.deepEqual(loadBriefConfig("/r", { readConfig: read('{"pairedPmClaudeTarget":"PM Kit [3fa9c1]"}') }),
    { ok: true, briefPathDirs: [], pairedPmClaudeTarget: "PM Kit [3fa9c1]", pairSource: "tracked" }, "inner spaces are legal in a Claude name");
  assert.deepEqual(loadBriefConfig("/r", { readConfig: read('{"pairedPmClaudeTarget":"3fa9c1","pairedPmClaudeName":"Probe PM"}') }),
    { ok: true, briefPathDirs: [], pairedPmClaudeTarget: "3fa9c1", pairedPmClaudeName: "Probe PM", pairSource: "tracked" }, "ref and current name load together");
  for (const bad of ["", " Probe PM", "a\nb", 7]) {
    assert.equal(loadBriefConfig("/r", { readConfig: read(JSON.stringify({ pairedPmClaudeName: bad })) }).ok, false,
      `name ${JSON.stringify(bad)} must fail closed`);
  }
  assert.deepEqual(loadBriefConfig("/r", { readConfig: read('{"pairedPmThreadId":"pm-thread"}') }),
    { ok: true, briefPathDirs: [], pairedPmThreadId: "pm-thread", pairSource: "tracked" }, "a 2.33.0 config still loads (read as the tracked fallback)");
  for (const bad of [123, "", " x", "x ", "a\nb", "x".repeat(301), null]) {
    assert.equal(loadBriefConfig("/r", { readConfig: read(JSON.stringify({ pairedPmClaudeTarget: bad })) }).ok, false,
      `${JSON.stringify(bad)} must fail closed`);
  }
});

function adopt(extraArgs = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-claude-pair-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-claude-pair-codex-"));
  execFileSync("git", ["init", "-q", dir]);
  const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
    "--owner-name", "T", "--codex-prompts-dir", codexDir, ...extraArgs], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(path.join(dir, ".claude", "task-lane.json"), JSON.stringify({
    mode: "in-thread", sessionId: "s1", taskId: "task1", tier: "T1",
  }));
  return { dir, codexDir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("init writes the pair to the per-checkout kit.pair.json (gitignored), never adds it to the tracked config", () => {
  const { dir, codexDir, cleanup } = adopt(["--paired-pm-claude-target", "3fa9c1", "--paired-pm-claude-name", "Probe PM"]);
  try {
    const cfg = path.join(dir, ".claude", "kit.config.json");
    const pairFile = path.join(dir, ".claude", "kit.pair.json");
    assert.deepEqual(JSON.parse(readFileSync(pairFile, "utf8")), { pairedPmClaudeTarget: "3fa9c1", pairedPmClaudeName: "Probe PM" });
    const tracked = existsSync(cfg) ? JSON.parse(readFileSync(cfg, "utf8")) : {};
    assert.ok(!("pairedPmClaudeTarget" in tracked) && !("pairedPmClaudeName" in tracked), "no pair key is added to the tracked config");
    assert.equal(spawnSync("git", ["-C", dir, "check-ignore", "-q", ".claude/kit.pair.json"]).status, 0, "the pair file is gitignored");
    const init = (...extra) => spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--skip-codex-lane",
      "--codex-prompts-dir", codexDir, ...extra], { encoding: "utf8" });
    init("--force");
    assert.deepEqual(JSON.parse(readFileSync(pairFile, "utf8")), { pairedPmClaudeTarget: "3fa9c1", pairedPmClaudeName: "Probe PM" },
      "a --force run naming no pair flag leaves the per-checkout pair alone");
    const partial = init("--force", "--paired-pm-claude-name", "Renamed PM");
    assert.match(`${partial.stdout}${partial.stderr}`, /REFUSED to overwrite .*kit\.pair\.json: it holds pairedPmClaudeTarget/,
      "a --force naming only part of the pair refuses rather than dropping the ref");
    assert.equal(JSON.parse(readFileSync(pairFile, "utf8")).pairedPmClaudeName, "Probe PM", "…and leaves the file unchanged");
    const renamed = init("--force", "--paired-pm-claude-target", "3fa9c1", "--paired-pm-claude-name", "Renamed PM");
    assert.equal(renamed.status, 0, renamed.stderr);
    assert.equal(JSON.parse(readFileSync(pairFile, "utf8")).pairedPmClaudeName, "Renamed PM", "the full re-run updates the name");
    const bad = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--codex-prompts-dir", codexDir, "--paired-pm-claude-target", " padded"], { encoding: "utf8" });
    assert.equal(bad.status, 2, "an unusable address is refused before anything is written");
  } finally { cleanup(); }
});

test("a TRACKED pair is kept, still screens in a checkout with no kit.pair.json, and every such send says it travels", () => {
  const { dir, codexDir, cleanup } = adopt();
  const second = mkdtempSync(path.join(os.tmpdir(), "kit-claude-pair-wt-"));
  try {
    const cfg = path.join(dir, ".claude", "kit.config.json");
    const base = existsSync(cfg) ? JSON.parse(readFileSync(cfg, "utf8")) : {};
    writeFileSync(cfg, JSON.stringify({ ...base, pairedPmClaudeTarget: "3fa9c1", pairedPmClaudeName: "Travelled PM" }));
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]); execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "adopt with a tracked pair", "-m", "entry: none"]);
    // A SECOND checkout of the same repo: the tracked pair arrives with the branch, no local file.
    const wt = path.join(second, "wt");
    execFileSync("git", ["-C", dir, "worktree", "add", "-q", "--detach", wt]);
    assert.ok(!existsSync(path.join(wt, ".claude", "kit.pair.json")), "the second checkout has no per-checkout pair");
    const hook = path.join(wt, ".claude", "hooks", "guard-brief-rung.mjs");
    const run = (toolInput) => spawnSync(process.execPath, [hook], { cwd: wt, encoding: "utf8",
      input: JSON.stringify({ tool_name: "SendMessage", session_id: "s1", cwd: wt, tool_input: toolInput }) });
    const toPm = run({ to: "PM Kit [3fa9c1]", message: "Build the next item." });
    assert.match(toPm.stdout, /"permissionDecision":"deny"/, "the tracked pair still screens an unscreened PM direction");
    assert.match(toPm.stdout, /read from the TRACKED[\s\S]*kit\.pair\.json[\s\S]*only then remove/,
      "…and the deny carries the migration notice once");
    const other = run({ to: "Builder [aaaaaa]", message: "hi" });
    assert.equal((other.stdout.match(/hookSpecificOutput/g) || []).length, 1, "one stdout object, notices folded");
    assert.match(other.stdout, /NOT screened[\s\S]*kit\.config\.json[\s\S]*read from the TRACKED/);
    // init keeps the tracked key: --force naming the flag writes it back AND writes the local file.
    const forced = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--skip-codex-lane",
      "--codex-prompts-dir", codexDir, "--force", "--paired-pm-claude-target", "3fa9c1", "--paired-pm-claude-name", "Travelled PM"], { encoding: "utf8" });
    assert.equal(JSON.parse(readFileSync(cfg, "utf8")).pairedPmClaudeTarget, "3fa9c1", "init never deletes a tracked pair key");
    assert.equal(JSON.parse(readFileSync(path.join(dir, ".claude", "kit.pair.json"), "utf8")).pairedPmClaudeTarget, "3fa9c1");
    assert.match(`${forced.stdout}${forced.stderr}`, /TRACKED config still screens[\s\S]*only then remove[\s\S]*IGNORED here/,
      "init warns, names the removal order, and says the tracked keys are ignored where a local file exists");
    // Whole-file precedence: a local pair file is the pair; the tracked key does not also screen.
    writeFileSync(path.join(wt, ".claude", "kit.pair.json"), JSON.stringify({ pairedPmClaudeTarget: "bbbbbb" }));
    assert.doesNotMatch(run({ to: "PM Kit [3fa9c1]", message: "x" }).stdout, /"permissionDecision":"deny"/,
      "with a local pair file, the travelled tracked key no longer screens here");
    assert.match(run({ to: "Local PM [bbbbbb]", message: "x" }).stdout, /"permissionDecision":"deny"/, "the local pair screens");
    assert.doesNotMatch(run({ to: "Travelled PM", message: "x" }).stdout, /"permissionDecision":"deny"/,
      "WHOLE-FILE precedence: a tracked key the local file lacks does not fill the gap");
  } finally {
    try { execFileSync("git", ["-C", dir, "worktree", "remove", "--force", path.join(second, "wt")]); } catch {}
    rmSync(second, { recursive: true, force: true }); cleanup();
  }
});

test("a non-string SendMessage address in a paired checkout DENIES; unpaired it stays outside the guard", () => {
  const { dir, cleanup } = adopt();
  try {
    const hook = path.join(dir, ".claude", "hooks", "guard-brief-rung.mjs");
    const run = (toolInput) => spawnSync(process.execPath, [hook], { cwd: dir, encoding: "utf8",
      input: JSON.stringify({ tool_name: "SendMessage", session_id: "s1", cwd: dir, tool_input: toolInput }) });
    assert.equal(run({ to: { name: "PM" }, message: "x" }).stdout, "", "unpaired: outside the guard, as before");
    writeFileSync(path.join(dir, ".claude", "kit.pair.json"), JSON.stringify({ pairedPmClaudeTarget: "3fa9c1" }));
    for (const to of [{ name: "PM" }, ["3fa9c1"], 7]) {
      const r = run({ to, message: "x" });
      assert.match(r.stdout, /"permissionDecision":"deny"/, `paired: to=${JSON.stringify(to)} denies`);
      assert.match(r.stdout, /not a string/, "…naming why");
    }
    assert.match(run({ to: "Builder", recipient: { id: 1 }, message: "x" }).stdout, /"permissionDecision":"deny"/,
      "a non-string recipient beside a string to also denies");
  } finally { cleanup(); }
});

test("a malformed pair or config names the FILE and the KEY that failed", () => {
  const read = (v) => () => v;
  const bad = (cfg, pair) => loadBriefConfig("/r", { readConfig: read(cfg), readPair: read(pair) });
  assert.deepEqual(bad('{"pairedPmClaudeName":" x"}', undefined), { ok: false, file: ".claude/kit.config.json", key: "pairedPmClaudeName" });
  assert.deepEqual(bad('{"briefPathDirs":"d"}', undefined), { ok: false, file: ".claude/kit.config.json", key: "briefPathDirs" });
  assert.deepEqual(bad("{}", '{"pairedPmThreadId":"a b"}'), { ok: false, file: ".claude/kit.pair.json", key: "pairedPmThreadId" });
  assert.deepEqual(bad("{}", "{oops"), { ok: false, file: ".claude/kit.pair.json", key: null });
  assert.deepEqual(bad("{}", '{"pairedPmClaudeTarget":"abc"}'), { ok: true, briefPathDirs: [], pairedPmClaudeTarget: "abc", pairSource: "local" });
  const msg = (state, config) => denyReason(state, { dispatch: { kind: "send", target: "x" }, config });
  assert.match(msg("claude-pair-malformed", { file: ".claude/kit.config.json", key: "pairedPmClaudeName" }),
    /`pairedPmClaudeName` in \.claude\/kit\.config\.json/, "the Claude pair message names the failing key");
  assert.match(msg("kit-config-malformed", { file: ".claude/kit.config.json", key: "briefPathDirs" }), /`briefPathDirs` in/);
  assert.match(msg("architect-pair-malformed", { file: ".claude/kit.pair.json", key: "pairedPmThreadId" }),
    /`pairedPmThreadId` in \.claude\/kit\.pair\.json/);
  assert.match(msg("claude-pair-malformed", { file: ".claude/kit.pair.json", key: null }), /kit\.pair\.json as a whole/);
});

test("THE INSTALLED GUARD screens a Claude Architect's send to its PM — registered, and RUNS, both tools", () => {
  const { dir, cleanup } = adopt();
  try {
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const groups = settings.hooks.PreToolUse;
    const sendGroup = groups.find((g) => g.matcher === "SendMessage");
    assert.ok(sendGroup, "the SendMessage bucket is registered");
    assert.equal(groups.filter((g) => g.matcher === ".*send_message").length, 1, "the old bucket is unchanged, not duplicated");
    const command = sendGroup.hooks[0].command;
    const run = (tool_name, tool_input) => spawnSync("sh", ["-c", command], {
      input: JSON.stringify({ session_id: "s1", tool_name, cwd: dir, tool_input }), encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    const deny = (r) => /"permissionDecision":"deny"/.test(r.stdout);
    const configFile = path.join(dir, ".claude", "kit.config.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    const pairFile = path.join(dir, ".claude", "kit.pair.json");
    const sidecarFile = path.join(dir, ".claude", "brief-rung.json");
    const setSidecar = (over = {}) => writeFileSync(sidecarFile, JSON.stringify({
      sessionId: "s1", target: "3fa9c1", nonce: `n-${Math.random()}`, dispatch_kind: "build", task_id: "task1",
      checks: OK_CHECK, architectScreen: screen(), ...over,
    }));

    // Unpaired: a SendMessage is outside the guard, exactly as before this release.
    const unpaired = run("SendMessage", { to: "PM Kit [3fa9c1]", message: PROMPT });
    assert.equal(unpaired.stdout, "", "no pair configured ⇒ no deny and no notice");

    writeFileSync(pairFile, JSON.stringify({ pairedPmClaudeTarget: "3fa9c1" }));
    assert.ok(deny(run("SendMessage", { to: "PM Kit [3fa9c1]", message: PROMPT })), "an unscreened direction to the pair is denied");
    assert.ok(deny(run("SendMessage", { to: "Renamed Title [3fa9c1]", message: PROMPT })),
      "a RENAMED title with the same ref is still the pair — the screen does not switch off");
    assert.ok(deny(run("SendMessage", { to: "3fa9c1", message: PROMPT })), "the bare ref is the pair");
    assert.ok(deny(run("mcp__ccd_session_mgmt__send_message", { session_id: "3fa9c1", message: PROMPT })),
      "the older ccd send to the pair owes the same screen");

    setSidecar();
    assert.equal(run("SendMessage", { to: "Renamed Title [3fa9c1]", message: PROMPT }).stdout, "",
      "a current prompt-bound screen permits the paired direction");
    const rows = readFileSync(path.join(dir, ".claude", "lane-ledger.jsonl"), "utf8").split("\n").filter(Boolean)
      .map(JSON.parse).filter((row) => row.control === "brief-rung");
    assert.equal(rows.at(-1).target, "3fa9c1", "the audit row names the configured pair, whatever address form was used");
    assert.deepEqual(rows.at(-1).architectScreen, screen(), "the audit row carries the screen");
    assert.ok(deny(run("SendMessage", { to: "Renamed Title [3fa9c1]", message: PROMPT })), "the receipt is single use");
    setSidecar();
    assert.ok(deny(run("SendMessage", { to: "3fa9c1", message: `${PROMPT} Changed.` })), "the screen binds the exact bytes");

    setSidecar({ class: "status", dispatch_kind: "status", architectScreen: undefined, checks: undefined, nonce: undefined });
    assert.ok(deny(run("SendMessage", { to: "3fa9c1", message: PROMPT })), "direction text cannot take the status route");
    assert.equal(run("SendMessage", { to: "3fa9c1", message: "ARCHITECT_STATUS_V1\nProgress only." }).stdout, "",
      "marked status remains available");

    for (const key of ["model", "thinking", "effort"]) {
      setSidecar();
      const r = run("SendMessage", { to: "3fa9c1", message: PROMPT, [key]: "x" });
      assert.ok(deny(r) && /quietly change the PM's model/.test(r.stdout), `a paired send cannot carry ${key}`);
    }
    assert.equal(run("SendMessage", { to: "3fa9c1", message: "" }).stdout, "", "an empty message directs nothing");
    assert.equal(run("SendMessage", { to: "3fa9c1", notify_when_idle: true }).stdout, "", "a pure idle subscription directs nothing");
    assert.ok(deny(run("SendMessage", { to: "3fa9c1", message: 42 })), "an unreadable message cannot be screened");

    // The shape Claude Code 2.1.270 actually hands the hook (P5 live capture): `recipient` and
    // `content` ride beside `to` and `message`, and the model addresses by bare NAME unless told
    // to use the ref form.
    const captured = (to, message) => ({ to, summary: "probe", message, type: "message", recipient: to, content: message });
    rmSync(sidecarFile, { force: true });
    assert.ok(deny(run("SendMessage", captured("Probe PM [3fa9c1]", PROMPT))), "the captured shape, ref form: screened");
    setSidecar();
    assert.equal(run("SendMessage", captured("Probe PM [3fa9c1]", PROMPT)).stdout, "", "the captured shape passes with a screen");
    assert.ok(deny(run("SendMessage", { to: "Someone", recipient: "Probe PM [3fa9c1]", message: PROMPT })),
      "either address naming the PM makes it the PM's send");
    setSidecar();
    assert.ok(deny(run("SendMessage", { to: "3fa9c1", message: PROMPT, content: "Something else." })),
      "two different bodies make the screened bytes ambiguous");
    const bareName = run("SendMessage", captured("Probe PM", PROMPT));
    assert.doesNotMatch(bareName.stdout, /"permissionDecision":"deny"/, "a bare title is not the ref-configured pair…");
    assert.match(bareName.stdout, /NOT screened/, "…and the paired checkout is told so");

    // D-11: the pair also stores the PM's CURRENT name, because models address by bare name.
    rmSync(sidecarFile, { force: true });
    writeFileSync(pairFile, JSON.stringify({ pairedPmClaudeTarget: "3fa9c1", pairedPmClaudeName: "Probe PM" }));
    assert.ok(deny(run("SendMessage", captured("Probe PM", PROMPT))), "a bare-name `to` equal to the stored name is screened");
    assert.ok(deny(run("SendMessage", captured("Probe PM [ffffff]", PROMPT))), "the stored name before any ref is screened");
    setSidecar();
    assert.equal(run("SendMessage", captured("Probe PM", PROMPT)).stdout, "", "…and passes with a screen, target = the stored ref");
    // After a rename, before the name is re-set: the ref still pairs; a bare new title is the residual.
    assert.ok(deny(run("SendMessage", captured("New Title [3fa9c1]", PROMPT))), "after a rename, `<new title> [<ref>]` is still screened");
    const renamedBare = run("SendMessage", captured("New Title", PROMPT));
    assert.doesNotMatch(renamedBare.stdout, /"permissionDecision":"deny"/, "a bare new title is unscreened (documented residual)…");
    assert.match(renamedBare.stdout, /NOT screened[\s\S]*update pairedPmClaudeName/, "…and the notice says how to repair the stale name");
    // Name only, no ref: the name still pairs.
    writeFileSync(pairFile, JSON.stringify({ pairedPmClaudeName: "Probe PM" }));
    rmSync(sidecarFile, { force: true });
    assert.ok(deny(run("SendMessage", captured("Probe PM", PROMPT))), "a name-only pair still screens the bare name");
    writeFileSync(pairFile, JSON.stringify({ pairedPmClaudeTarget: "3fa9c1" }));

    const other = run("SendMessage", { to: "Builder [aaaaaa]", message: PROMPT });
    assert.doesNotMatch(other.stdout, /"permissionDecision":"deny"/, "a send to another agent is not denied");
    assert.match(other.stdout, /NOT screened[\s\S]*3fa9c1[\s\S]*kit\.pair\.json/,
      "…but a paired checkout is TOLD it was not screened, so a mis-addressed PM send is never silent");

    writeFileSync(configFile, "{oops");
    assert.ok(deny(run("SendMessage", { to: "Builder [aaaaaa]", message: PROMPT })),
      "a corrupt config cannot say which send is the PM's — fail closed");
  } finally { cleanup(); }
});

test("the Codex registration is unchanged: the generated hooks.json entries equal 2.33.0's (hook trust stays ARMED)", () => {
  // Codex keys hook trust to each .codex/hooks.json ENTRY (command, timeout, statusMessage). This
  // release must change none, so an upgraded Codex lane needs no re-trust. The expected entries are
  // the 2.33.0 shape, stated here for a checkout path; only `description` carries the version.
  const { dir, cleanup } = adopt();
  try {
    const reg = JSON.parse(readFileSync(path.join(dir, ".codex", "hooks.json"), "utf8"));
    const cmd = (f) => `node ${path.join(dir, ".codex", "hooks", f)} --project-dir ${dir}`;
    const e = (f, statusMessage) => ({ type: "command", command: cmd(f), timeout: 10, statusMessage });
    assert.deepEqual(reg.hooks, { PreToolUse: [
      { matcher: "apply_patch", hooks: [
        e("guard-cross-repo-writes.mjs", "Checking every patch target stays inside this repo…"),
        e("guard-lane-authoring.mjs", "Checking the task's lane declaration…"),
        e("guard-brief-rung.mjs", "Checking the pre-send verification rung for this brief…"),
        e("sensor-sweep-owed.mjs", "Checking whether this edit owes a pre-fold dependency sweep…"),
        e("sensor-mutation-owed.mjs", "Checking whether this edit owes a two-sided mutation record…"),
      ] },
      { matcher: "mcp__codex_app__send_message_to_thread", hooks: [
        e("guard-brief-rung.mjs", "Checking the Architect decision screen for this PM send…"),
      ] },
      { matcher: "Bash", hooks: [
        e("guard-gate-ladder.mjs", "Resolving the declared tier; surfacing the ladder it owes…"),
      ] },
    ] });
  } finally { cleanup(); }
});

test("upgrading a 2.33.0 settings.json adds ONE SendMessage bucket and duplicates nothing", () => {
  const { dir, codexDir, cleanup } = adopt();
  try {
    const file = path.join(dir, ".claude", "settings.json");
    const s = JSON.parse(readFileSync(file, "utf8"));
    s.hooks.PreToolUse = s.hooks.PreToolUse.filter((g) => g.matcher !== "SendMessage"); // the 2.33.0 shape
    writeFileSync(file, JSON.stringify(s, null, 2));
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--force", "--skip-codex-lane",
      "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const after = JSON.parse(readFileSync(file, "utf8")).hooks.PreToolUse;
    const matchers = after.map((g) => g.matcher);
    assert.equal(new Set(matchers).size, matchers.length, "one bucket per matcher");
    assert.equal(after.find((g) => g.matcher === "SendMessage").hooks.length, 1);
    assert.equal(after.find((g) => g.matcher === ".*send_message").hooks.length, 1, "the old bucket still runs the guard once");
  } finally { cleanup(); }
});
