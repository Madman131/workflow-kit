// workflow-kit — control suite, part: what `bin/init.mjs` accepts and writes. Its flags and their
// validation, `kit.config.json` handling, `--force` backups and refusals, the Stop registration, and
// the Codex-lane install. Split out of tests/kit-controls.test.mjs so the suite's files run in
// parallel; the test bodies are unchanged.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { adopt } from "./kit-controls-helpers.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("init installs the /thread-restart dual-harness assets + AGENTS pointer, idempotently", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-cmd-"));
  // Codex prompts are user-global; point init at a scratch dir so this test never touches ~/.codex.
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    const run = () => execFileSync(
      "node",
      [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir],
      { stdio: "ignore" },
    );
    run();
    const claudeCmd = path.join(dir, ".claude", "commands", "thread-restart.md");
    const codexCmd = path.join(codexDir, "thread-restart.md");
    const agents = path.join(dir, "AGENTS.md");
    // lands in the right place
    assert.ok(existsSync(claudeCmd), "Claude command installed under .claude/commands/");
    assert.ok(existsSync(codexCmd), "Codex prompt installed into the overridable --codex-prompts-dir");
    // syntactically valid per harness + the load-bearing method text copied verbatim into both
    const claudeText = readFileSync(claudeCmd, "utf8");
    const codexText = readFileSync(codexCmd, "utf8");
    assert.match(claudeText, /^---\n/, "Claude command opens with YAML frontmatter");
    assert.match(codexText, /^# /, "Codex prompt opens with a markdown H1");
    for (const [name, t] of [["Claude", claudeText], ["Codex", codexText]]) {
      assert.match(t, /VERIFY before finalizing/, `${name} asset: the mandatory verify pass is preserved`);
      assert.match(t, /Index, don't duplicate/, `${name} asset: index-don't-duplicate is preserved`);
    }
    // AGENTS fallback pointer appended exactly once
    const marker = "workflow-kit:thread-restart-pointer";
    const occurrences = (s) => s.split(marker).length - 1;
    assert.equal(occurrences(readFileSync(agents, "utf8")), 1, "AGENTS.md carries the pointer exactly once");
    // idempotent: a second run neither clobbers a USER-EDITED command nor duplicates the pointer.
    // Plant a real edit first — hashing the pristine install would pass even if copyGuarded regressed
    // to overwrite (a re-copy is byte-identical to the source), so it must be MUTATED to be a real test.
    const editedClaude = readFileSync(claudeCmd, "utf8") + "\n<!-- user edit: keep me -->\n";
    const editedCodex = readFileSync(codexCmd, "utf8") + "\n<!-- user edit: keep me -->\n";
    writeFileSync(claudeCmd, editedClaude);
    writeFileSync(codexCmd, editedCodex);
    const agentsBefore = readFileSync(agents, "utf8");
    run();
    assert.equal(readFileSync(claudeCmd, "utf8"), editedClaude, "re-run KEEPS a user-edited Claude command (no clobber without --force)");
    assert.equal(readFileSync(codexCmd, "utf8"), editedCodex, "re-run KEEPS a user-edited Codex prompt (no clobber without --force)");
    assert.equal(readFileSync(agents, "utf8"), agentsBefore, "AGENTS.md unchanged on re-run");
    assert.equal(occurrences(readFileSync(agents, "utf8")), 1, "pointer still appears exactly once after re-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
});

test("init rejects a flag-shaped value for every value-taking flag", () => {
  // `--target -h` must not adopt into a directory literally named "-h" while silently swallowing the
  // help flag. Single-dash flags are real (-h), so rejecting only "--" prefixes left this open.
  for (const argv of [["--target"], ["--target", "-h"], ["--target", "--help"], ["--repo-name", "--force"],
    ["--owner-name", "--force"], ["--codex-prompts-dir", ""], ["--memory-dir", "--target"]]) {
    // kit-guard:no-install — every argv here exits 2 on argument validation, before any install runs.
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), ...argv], { encoding: "utf8" });
    assert.equal(r.status, 2, `${argv.join(" ")} must exit 2, not proceed (got ${r.status})`);
    assert.doesNotMatch(r.stderr, /ERR_INVALID_ARG_TYPE|at ModuleLoader/, "and it must be a clean message, not a stack trace");
  }
  // …but a legitimate value that merely starts with a dash must still work. Rejecting every leading
  // "-" also rejected `--source-dirs -generated`, a directory name the config loaders accept and
  // which has no alternative spelling (slashes are separately forbidden).
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-dash-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--source-dirs", "-generated", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a dash-leading directory name is a legitimate value: ${r.stderr}`);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ".claude", "kit.config.json"), "utf8")).executedPathDirs,
      ["-generated"], "and it reaches kit.config.json intact");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--worktree-roots reaches kit.config.json, and a RELATIVE root is refused before anything is written", () => {
  // The installer half of the worktreeRoots family. guard-cross-repo-writes DENIES every gated write
  // on a config it cannot read, so a relative entry written here would hand the adopter a repo whose
  // file tools are dead until they hand-edit JSON — which is why the refusal lives in arg parsing.
  const { dir, cleanup } = adopt(["--worktree-roots", "/opt/worktrees,/srv/lanes"]);
  try {
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ".claude", "kit.config.json"), "utf8")).worktreeRoots,
      ["/opt/worktrees", "/srv/lanes"], "both declared roots reach the config intact");
  } finally { cleanup(); }

  const rel = mkdtempSync(path.join(os.tmpdir(), "kit-wtrel-"));
  try {
    execFileSync("git", ["init", "-q", rel]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", rel, "--repo-name",
      "adopter", "--skip-codex-prompt", "--worktree-roots", "../worktrees"], { encoding: "utf8" });
    assert.equal(r.status, 2, `a relative --worktree-roots entry must exit 2: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /ABSOLUTE/, "and the message must say what shape it wanted");
    assert.equal(existsSync(path.join(rel, ".claude", "kit.config.json")), false,
      "…and it must abort in arg parsing, before anything is written");
  } finally { rmSync(rel, { recursive: true, force: true }); }
});

test("--force REFUSES to rewrite a kit.config.json holding families this run did not name", () => {
  // `init --force --worktree-roots <abs>` — the command this kit's own upgrade paragraph prescribes
  // — rebuilt this file from THIS run's flags ALONE and dropped the adopter's other three families:
  // a widened write guard, shrunken doc-size governance, a lost memory default, all under exit 0.
  // The cure is a REFUSAL, never a merge: an installer that reads-modifies-writes adopter data owns
  // every property of that data. The refusal names the missing families and the flag that fills
  // each, and reads out NONE of the file's values — rendering those into a line the adopter pastes
  // would make init answerable for that data all over again, one layer out.
  const { dir, codexDir, cleanup } = adopt(["--skip-codex-lane", "--source-dirs", "app,lib"]);
  try {
    const cfg = path.join(dir, ".claude", "kit.config.json");
    // Distinctive values, so "no value is rendered" is checkable rather than asserted. An
    // unrecognized key rides along too: the answer for one is neither "carry it" nor "block".
    const SENTINEL_DOC = "docs/SENTINEL-VALUE.md", SENTINEL_MEM = "sentinel-memory";
    // A key name is adopter-authored text headed for a terminal. This one carries an ESC and a
    // newline, so a bare join would let a config forge lines around init's own warning.
    const HOSTILE_KEY = "evil\u001b[2K\nkey";
    writeFileSync(cfg, JSON.stringify({ executedPathDirs: ["app", "lib"], stateDocs: [SENTINEL_DOC],
      memoryDir: SENTINEL_MEM, laneRiskTokens: ["legacy"], [HOSTILE_KEY]: 1 }, null, 2));
    const before = readFileSync(cfg);
    const roots = path.join(dir, "wt");
    // EVERY spawn below names the scratch --codex-prompts-dir. A run left pointing at the real
    // ~/.codex can exit 1 on an unrelated stale shim, which would satisfy the exit-code assertions
    // for the wrong reason and hide exactly the false-success this test exists to pin.
    const initArgs = (...extra) => [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--codex-prompts-dir", codexDir, "--skip-codex-lane", "--force", ...extra];
    const partial = spawnSync("node", initArgs("--worktree-roots", roots), { encoding: "utf8" });
    const out = partial.stdout + partial.stderr;
    // Assert on the MESSAGE first: the exit code alone cannot say WHICH condition produced it.
    assert.match(out, /REFUSED to overwrite[^\n]*kit\.config\.json: it holds executedPathDirs, stateDocs, memoryDir/,
      `the refusal must name the families this run would have dropped: ${out}`);
    assert.equal(partial.status, 1, `…and a refusal must FAIL the run, not warn under exit 0: ${out}`);
    assert.deepEqual(readFileSync(cfg), before, "…and the existing file is left byte-for-byte unchanged");
    assert.equal(existsSync(`${cfg}.bak`), false, "…with no .bak, because no overwrite was attempted");
    // A family named without its flag is a name the adopter has to go look up; the flag is the
    // whole remediation. One line per missing family, and the flag has to be ON it.
    for (const [key, flag] of [["executedPathDirs", "--source-dirs"], ["stateDocs", "--state-docs"],
      ["memoryDir", "--memory-dir"]]) {
      assert.match(out, new RegExp(`${flag}\\s+<the ${key} value in kit\\.config\\.json>`),
        `the refusal must name ${flag} as the flag that fills ${key}: ${out}`);
    }
    assert.doesNotMatch(out, /--worktree-roots\s+<the/,
      "…and must NOT name the family this run DID pass a flag for — that one is not missing");
    // The point of the narrowed form: init reads this file to LIST what it holds, never to reprint
    // what is IN it. A value it re-renders is a value it can quietly change (comma-split, trimmed,
    // rejected by the flag's own validation, or not expressible as an OS argument at all).
    for (const value of [SENTINEL_DOC, SENTINEL_MEM]) {
      assert.doesNotMatch(out, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `no VALUE out of the config may be rendered into the message — ${value} leaked: ${out}`);
    }
    assert.match(out, /laneRiskTokens[^\n]*does not recognise/,
      "an unrecognized key is NAMED as droppable — not carried forward, and not blocked on");
    // …and named SAFELY. The key's bytes are the adopter's; the terminal they land on is not, so a
    // key carrying an ESC or a newline must arrive escaped rather than able to draw its own lines
    // around init's warning.
    assert.doesNotMatch(out, /\u001b\[2K/,
      "a control sequence in a key name must not reach the terminal raw");
    assert.match(out, /evil\\u001b\[2K\\nkey/,
      `…it must appear escaped instead, still readable as the key it is: ${out}`);

    // The control: name every family and the same run exits 0 and lands all four. Without it the
    // exit 1 above is attributable to the refusal only by inspection.
    const full = spawnSync("node", initArgs("--source-dirs", "app,lib", "--state-docs", SENTINEL_DOC,
      "--memory-dir", SENTINEL_MEM, "--worktree-roots", roots), { encoding: "utf8" });
    const fullOut = full.stdout + full.stderr;
    assert.equal(full.status, 0, `a run naming every family has nothing to refuse and exits 0: ${fullOut}`);
    assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")),
      { executedPathDirs: ["app", "lib"], stateDocs: [SENTINEL_DOC], memoryDir: SENTINEL_MEM, worktreeRoots: [roots] },
      "…and lands all four families, fully specified by flags");
    assert.match(fullOut, /laneRiskTokens[^\n]*does not recognise/,
      "…and the run that DOES rewrite still says the unrecognized key is being dropped — silence there is how adopter data disappears");
  } finally { cleanup(); }
});

test("a kit.config.json init cannot read as a JSON object is never overwritten, even under --force", () => {
  // The other half of the refusal: init reads this file only to LIST the families it holds, so a
  // file it cannot list is a file it must not replace. Fail CLOSED, like every other refusal here.
  const { dir, codexDir, cleanup } = adopt(["--skip-codex-lane", "--source-dirs", "app"]);
  try {
    const cfg = path.join(dir, ".claude", "kit.config.json");
    // Every family named on every spawn, so the ONLY thing left to refuse on is the file itself —
    // and the scratch --codex-prompts-dir on each, so no exit 1 can come from the real ~/.codex.
    const forceEveryFamily = () => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target",
      dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, "--skip-codex-lane", "--force",
      "--source-dirs", "app", "--state-docs", "docs/x.md", "--memory-dir", "memory",
      "--worktree-roots", dir], { encoding: "utf8" });
    // The first content carries a sentinel because a JSON parse error QUOTES the offending file
    // back inside its own message ("Unexpected token 'N', \"NOT JSON{\" is not valid JSON"). Passing
    // that message through would print the contents of the very file this branch refuses to read.
    // Short and leading, because V8 quotes only the first few bytes and elides the rest: a sentinel
    // buried later in the file would make this assertion pass without proving anything.
    const MALFORMED_SENTINEL = "LEAKME";
    for (const raw of [`${MALFORMED_SENTINEL}{`, "NOT JSON{", "[]", '"a string"', "42", "null"]) {
      writeFileSync(cfg, raw);
      const before = readFileSync(cfg);
      const r = forceEveryFamily();
      const out = r.stdout + r.stderr;
      assert.match(out, /REFUSED to overwrite[^\n]*kit\.config\.json: it (?:parses as JSON but is not a JSON object|could not be read or parsed as JSON)/,
        `${JSON.stringify(raw)} must be refused, by name: ${out}`);
      assert.doesNotMatch(out, new RegExp(MALFORMED_SENTINEL),
        `…without quoting the file's own bytes back: ${JSON.stringify(raw)} leaked into the message: ${out}`);
      assert.match(out, /Repair it \(or move it aside\) and re-run/,
        `…and must say what to DO about ${JSON.stringify(raw)}, since there is no flag that fixes it: ${out}`);
      assert.equal(r.status, 1, `…and that refusal must fail the run: ${out}`);
      assert.deepEqual(readFileSync(cfg), before, `…and ${JSON.stringify(raw)} is left byte-for-byte unchanged`);
      assert.equal(existsSync(`${cfg}.bak`), false,
        `…with no .bak for ${JSON.stringify(raw)} either — a backup here would mean an overwrite was attempted`);
    }
    // Unreadable, not merely unparseable: a directory in this file's place is an EISDIR on the read
    // itself. The parse branch cannot cover this one, and a crash here would take down a whole run
    // over a file init was only ever going to LIST.
    rmSync(cfg, { force: true });
    mkdirSync(cfg);
    const asDir = forceEveryFamily();
    const asDirOut = asDir.stdout + asDir.stderr;
    assert.match(asDirOut, /REFUSED to overwrite[^\n]*kit\.config\.json: it could not be read or parsed as JSON/,
      `a config that cannot be READ is refused by name, not crashed on: ${asDirOut}`);
    assert.equal(asDir.status, 1, `…and that refusal fails the run too: ${asDirOut}`);
    assert.deepEqual(readdirSync(cfg), [], "…and the directory in its place is untouched");
    assert.equal(existsSync(`${cfg}.bak`), false, "…with no .bak, because no overwrite was attempted");
  } finally { cleanup(); }
});

test("--risk-tokens is REMOVED (v2.0): the flag fails LOUDLY and names the migration", () => {
  // v1.5.0 deprecated it (parse-warn-ignore) and printed a removal horizon of v2.0; this is that
  // removal. A breaking CLI change must BREAK — a silently-ignored flag would let an adopter keep a
  // saved invocation forever believing it configured something. exit 2, not 0.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-rm-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--risk-tokens", "billing", "--source-dirs", "app", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 2, "a removed flag is a clean exit 2, never a silent ignore");
    assert.match(r.stderr, /--risk-tokens was REMOVED at v2\.0/, "the failure names the flag and the version");
    // The message must carry the FIX, not just the refusal — this is the error an adopter meets while
    // already frustrated, and every other refusal in this kit names its remediation.
    assert.match(r.stderr, /Drop the flag/, "…and tells them what to do instead");
    assert.match(r.stderr, /TOLERATED/, "…and says an existing laneRiskTokens key needs no edit");
    // It must not have adopted a half-tree on the way out: the parser rejects BEFORE any write.
    assert.equal(existsSync(path.join(dir, ".claude", "kit.config.json")), false,
      "the run aborts in argument parsing, so nothing was written");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("…while a legacy laneRiskTokens KEY in an adopter's config stays TOLERATED (the flag died, the key did not)", () => {
  // The two are separate contracts and only one changed. An older adopter's kit.config.json still
  // carries laneRiskTokens; every control ignores it rather than treating it as corrupt. Removing the
  // flag must not turn those existing configs into fail-closed bricks — that would be a silent,
  // repo-wide outage delivered by an upgrade.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-legacy-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--source-dirs", "app", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a clean invocation still adopts: ${r.stderr}`);
    // Hand-write the legacy shape an older adopt would have left behind, then prove the write guard
    // still ALLOWS a declared write rather than reading the stale key as config corruption.
    writeFileSync(path.join(dir, ".claude", "kit.config.json"),
      '{"executedPathDirs":["app"],"laneRiskTokens":["billing"]}\n');
    const sid = "legacy-session-id";
    writeFileSync(path.join(dir, ".claude", "task-lane.json"),
      JSON.stringify({ mode: "in-thread", sessionId: sid, taskId: "legacy-key-check", tier: "T1" }));
    const g = spawnSync("node", [path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs")], {
      input: JSON.stringify({ session_id: sid, tool_input: { file_path: "app/x.mjs" } }),
      cwd: dir, encoding: "utf8",
    });
    assert.equal(g.status, 0, "the guard exits cleanly");
    assert.doesNotMatch(g.stdout, /"permissionDecision":"deny"/,
      "a legacy laneRiskTokens key is IGNORED, never read as a malformed config");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the Stop registration merges into settings.json exactly once, confirmed by read-back", () => {
  const { dir, run, cleanup } = adopt();
  try {
    const settingsPath = path.join(dir, ".claude", "settings.json");
    const countStop = () => {
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      return (s.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? [])
        .filter((h) => String(h.command).includes("guard-owner-comms.mjs")).length;
    };
    // Counts REGISTRATIONS, not distinct guards: `guard-brief-rung` is registered THREE times on
    // purpose — on the write matcher, the `.*send_message` matcher and (v2.33.1) the separate
    // `SendMessage` matcher — so the expected total is 6 for 4 guards. The send groups are exactly
    // where a duplicate would hide, because `mergeSettings` dedupes by matcher first and then by
    // command string, and each send matcher is a NEW matcher.
    const countPreToolUse = () => {
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      return (s.hooks?.PreToolUse ?? []).flatMap((g) => g.hooks ?? [])
        .filter((h) => /guard-(cross-repo-writes|lane-authoring|gate-ladder|brief-rung)\.mjs/.test(String(h.command))).length;
    };
    assert.equal(countStop(), 1, "Stop sensor registered once on disk");
    assert.equal(countPreToolUse(), 6, "the 4 PreToolUse guards (brief-rung three times) are still registered alongside it");
    run(); // merging is idempotent — a re-run must not duplicate the registration
    assert.equal(countStop(), 1, "re-run does not duplicate the Stop registration");
    assert.equal(countPreToolUse(), 6, "re-run does not duplicate the PreToolUse registrations, both send matchers included");
    // the hook file itself landed and is executable-ish (copied like every other hook)
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs")), "the Stop hook file is installed");

    // MERGED, not REPLACED. Counting only our own registrations would stay green against a
    // mergeSettings that overwrote the file wholesale — the assertion would be about the template,
    // not about the merge. Plant settings a real adopter would have and require they survive.
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.env = { KIT_MERGE_SENTINEL: "keep-me" };           // a top-level key we know nothing about
    settings.hooks.Stop.push({ hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff" }] });
    settings.hooks.PreToolUse.push({ matcher: "WebFetch", hooks: [{ type: "command", command: "node ./mine.mjs" }] });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    run();
    const after = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(after.env?.KIT_MERGE_SENTINEL, "keep-me", "an unrelated top-level setting SURVIVES the merge (not replaced)");
    const allCommands = [...(after.hooks?.Stop ?? []), ...(after.hooks?.PreToolUse ?? [])].flatMap((g) => g.hooks ?? []).map((h) => h.command);
    assert.ok(allCommands.some((c) => c.includes("afplay")), "the adopter's own Stop hook SURVIVES the merge");
    assert.ok(allCommands.some((c) => c.includes("./mine.mjs")), "the adopter's own PreToolUse hook SURVIVES the merge");
    assert.equal(countStop(), 1, "our Stop registration is still present exactly once");
    assert.equal(countPreToolUse(), 6, "our 4 PreToolUse guards are still present");
  } finally { cleanup(); }
});

test("init --force backs up hand-authored [G] content instead of destroying it", () => {
  const { dir, run, cleanup } = adopt(["--owner-name", "Alex", "--source-dirs", "app"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const cfg = path.join(dir, ".claude", "kit.config.json");
    // Complete the contract the way an adopter must, then take the upgrade path init itself
    // recommends for a stale hook ("re-run with --force"). --force is GLOBAL, so without a backup it
    // silently destroys the hand-written Owner doc.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_PROFILE}}", "They read fast and hate preamble."));
    // No --owner-name and no family flags this time. Exit 1 since v2.16.0 (hermetic armed-check);
    // the subject is the backups, which land regardless.
    spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--force"], { encoding: "utf8" });
    assert.ok(existsSync(`${doc}.bak`), "--force leaves a .bak of the previous OWNER_COMMS");
    assert.match(readFileSync(`${doc}.bak`, "utf8"), /They read fast and hate preamble\./,
      "the hand-written Owner profile is recoverable, not lost");
    // The config family is a DIFFERENT class and no longer relies on a .bak to survive: a --force
    // run naming no --source-dirs now REFUSES to rewrite this file rather than resetting it to {}
    // and leaving the adopter a backup to notice. Nothing was overwritten, so there is nothing to
    // recover FROM — the widening it used to cause is prevented, not merely reversible.
    assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")).executedPathDirs, ["app"],
      "the configured executedPathDirs family SURVIVES a forced rerun that did not name it");
    assert.equal(existsSync(`${cfg}.bak`), false, "…and no .bak exists, because no overwrite was attempted");

    // If the backup CANNOT be written, the overwrite must not happen either. Warning about a failed
    // backup and then destroying the file anyway is worse than not offering backups at all, because
    // the console says the upgrade path is recoverable.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{IRREVERSIBLE_ASSET}}", "the customer corpus"));
    rmSync(`${doc}.bak`, { force: true });
    mkdirSync(`${doc}.bak`);          // a directory here makes the backup write fail
    // --source-dirs app FULLY specifies the config this adopter holds, so step 6 has nothing to
    // refuse. Without it the config refusal would ALSO produce exit 1 and the assertion below
    // would no longer be attributable to the failed backup it is about.
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt", "--force", "--source-dirs", "app"], { encoding: "utf8" });
    // Since v2.16.0 a refused backup is COUNTED into a nonzero exit — a mixed-version tree must
    // not read as a clean adopt (the rest of the run still completes; the exit names the state).
    assert.equal(r.status, 1, "a run containing a refused backup exits 1, never 0");
    assert.match(r.stderr, /REFUSED to overwrite/, "init says plainly that it refused");
    assert.match(readFileSync(doc, "utf8"), /the customer corpus/,
      "the un-backup-able file is left UNCHANGED rather than destroyed");
    // …and the SUMMARY must not describe the refused file as backed up. Folding a refusal into the
    // "kept" count printed "your version is backed up first" about the one file whose backup failed,
    // and hid that the tree is now a mix of regenerated and stale [G] files.
    assert.match(r.stderr, /generation is INCOMPLETE/, "init flags the mixed-version tree explicitly");
    assert.match(r.stdout, /1 REFUSED \(NOT backed up, NOT overwritten\)/, "the summary counts the refusal separately");
  } finally { cleanup(); }
});

test("v2.0 Codex lane: the assets install, the model is [G], and --skip-codex-lane leaves no residue", () => {
  // These are CONVENIENCES, not controls — v2.0 registers no Codex hooks (PORTABILITY.md § Why the
  // Codex lane is unguarded). What is gated here is the WIRING, the same way the /thread-restart
  // nudge is gated: the files land, the [G] placeholder behaves, and the opt-out is total.
  const mk = () => { const d = mkdtempSync(path.join(os.tmpdir(), "kit-codex-")); execFileSync("git", ["init", "-q", d]); return d; };
  const run = (d, extra) => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", d,
    "--repo-name", "demo", "--skip-codex-prompt", ...extra], { encoding: "utf8" });

  const filled = mk(), unfilled = mk(), skipped = mk();
  try {
    // 1. WITH the flag: the seat's model is bound.
    assert.equal(run(filled, ["--codex-cold-model", "some-model-v1"]).status, 0);
    assert.ok(existsSync(path.join(filled, ".codex", "config.toml")), "config.toml installs");
    const seat = readFileSync(path.join(filled, ".codex", "agents", "cold-reviewer.toml"), "utf8");
    assert.match(seat, /^model = "some-model-v1"$/m, "--codex-cold-model fills the seat");
    assert.doesNotMatch(seat, /\{\{CODEX_COLD_MODEL\}\}/, "no placeholder survives once filled");
    // The shipped config must not register hooks: Codex warns when both it and hooks.json declare
    // them, and v2.0 deliberately registers none at all.
    assert.doesNotMatch(readFileSync(path.join(filled, ".codex", "config.toml"), "utf8"),
      /^\s*\[{1,2}\s*hooks[.\]]/m, "the shipped config.toml declares NO hooks");

    // 2. WITHOUT it: the placeholder SURVIVES and init reports the file as incomplete. An unfilled
    // model must be visible, never silently substituted with someone else's.
    const r2 = run(unfilled, []);
    assert.equal(r2.status, 0);
    assert.match(readFileSync(path.join(unfilled, ".codex", "agents", "cold-reviewer.toml"), "utf8"),
      /\{\{CODEX_COLD_MODEL\}\}/, "the placeholder survives when unfilled");
    assert.match(r2.stdout, /Complete the placeholders in:.*cold-reviewer\.toml/,
      "…and init's checklist NAMES the incomplete file (an unusable seat must not look finished)");

    // 3. Opt-out is TOTAL — not a partial tree the adopter has to clean up by hand.
    assert.equal(run(skipped, ["--skip-codex-lane"]).status, 0);
    assert.equal(existsSync(path.join(skipped, ".codex")), false, "--skip-codex-lane writes no .codex at all");

    // 4. Idempotent: a re-run keeps a hand-edited seat rather than clobbering the adopter's binding.
    writeFileSync(path.join(filled, ".codex", "agents", "cold-reviewer.toml"), "# hand-edited\n");
    assert.equal(run(filled, ["--codex-cold-model", "some-model-v1"]).status, 0);
    assert.equal(readFileSync(path.join(filled, ".codex", "agents", "cold-reviewer.toml"), "utf8"),
      "# hand-edited\n", "a re-run without --force keeps the adopter's edit");
  } finally { for (const d of [filled, unfilled, skipped]) rmSync(d, { recursive: true, force: true }); }
});

test("generated BINDINGS binds every execution role by exact model and effort", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-bindings-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const args = [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "demo",
      "--skip-codex-prompt", "--skip-codex-lane",
      "--pm-model", "gpt-5.6-sol", "--pm-effort", "high",
      "--builder-model", "gpt-5.6-terra", "--builder-effort", "high",
      "--gather-model", "gpt-5.6-luna", "--gather-effort", "medium",
      "--astra-consult-model", "gpt-6-astra", "--astra-consult-effort", "xhigh"];
    const result = spawnSync("node", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const bindings = readFileSync(path.join(dir, "core", "BINDINGS.md"), "utf8");
    for (const token of ["PM_MODEL_ID", "PM_EFFORT", "BUILDER_MODEL_ID", "BUILDER_EFFORT",
      "GATHER_MODEL_ID", "GATHER_EFFORT", "ASTRA_CONSULT_MODEL_ID", "ASTRA_CONSULT_EFFORT"]) {
      assert.doesNotMatch(bindings, new RegExp(`\\{\\{${token}\\}\\}`), `{{${token}}} is filled in a configured adopter`);
    }
    assert.match(bindings, /PM = \*\*gpt-5\.6-sol\*\* at \*\*high\*\*/);
    assert.match(bindings, /Builder =\s*\*\*gpt-5\.6-terra\*\* at\s*\*\*high\*\*/);
    assert.match(bindings, /Gather =\s*\*\*gpt-5\.6-luna\*\* at\s*\*\*medium\*\*/);
    assert.match(bindings, /Astra consult =\s*\*\*gpt-6-astra\*\* at\s*\*\*xhigh\*\*/);
    assert.match(bindings, /runtime model and effort; friendly role\s+names are not evidence, and unavailable configured seats are reported, never silently substituted/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--codex-cold-model is validated: it lands inside a TOML string, so it cannot be allowed to escape one", () => {
  // The value is interpolated as `model = "<value>"` into a file that ALSO carries
  // `sandbox_mode = "read-only"`. An unvalidated value containing a quote and a newline closes the
  // string and the remainder becomes TOML — so a mistyped or pasted flag could silently re-cage the
  // review seat. Refused in argument parsing, before anything is written.
  const mk = () => { const d = mkdtempSync(path.join(os.tmpdir(), "kit-ccm-")); execFileSync("git", ["init", "-q", d]); return d; };
  const run = (d, model) => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", d,
    "--repo-name", "x", "--skip-codex-prompt", "--codex-cold-model", model], { encoding: "utf8" });

  const bad = mk();
  try {
    const r = run(bad, 'm"\nsandbox_mode = "danger-full-access');
    assert.equal(r.status, 2, "a value that escapes the TOML string is refused");
    assert.match(r.stderr, /--codex-cold-model must be a plain model name/, "and the refusal names the rule");
    assert.equal(existsSync(path.join(bad, ".codex", "agents", "cold-reviewer.toml")), false,
      "…having written NO seat: the refusal happens in parsing, before any file is created");
  } finally { rmSync(bad, { recursive: true, force: true }); }

  // The other direction, and it matters as much: an over-strict rule that rejected real model names
  // would push adopters to hand-edit the seat, which is how the validation gets routed around.
  for (const model of ["gpt-5.6-terra", "claude-opus-5", "some.model_v2-x", "openai/gpt-x"]) {
    const ok = mk();
    try {
      assert.equal(run(ok, model).status, 0, `a legitimate model name is accepted: ${model}`);
      const seat = readFileSync(path.join(ok, ".codex", "agents", "cold-reviewer.toml"), "utf8");
      assert.match(seat, new RegExp(`^model = "${model.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"$`, "m"), "…and lands verbatim");
      assert.match(seat, /^sandbox_mode = "read-only"$/m, "…with the seat's own cage intact");
    } finally { rmSync(ok, { recursive: true, force: true }); }
  }
});

test("a broken .codex path warns and the adopt CONTINUES — the Codex lane cannot take the guards down", () => {
  // init SAYS the adopt continues if the Codex lane fails. That sentence was false: the cold-review
  // seat is generated in the shared [G] template loop, which is deliberately NOT failure-isolated,
  // so a regular file sitting at `.codex` threw ENOTDIR and killed the run with a raw stack trace —
  // AFTER the guards were registered. Not the zero-registration fail-open, but a partial adopt
  // contradicting its own contract.
  //
  // v2.1 CHANGED WHAT THIS COSTS, so the assertion changed with it. Through v2.0 the `.codex/`
  // assets were CONVENIENCES and the warning said so. They now carry the lane's write ENFORCEMENT,
  // so the same failure means the Codex lane is UNGUARDED — and a warning that still called it a
  // lost convenience would be the understatement this suite exists to catch. What must NOT change is
  // the isolation itself: a broken Codex lane may never take the Claude guards or the commit floor
  // down with it.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-codexbroken-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(path.join(dir, ".codex"), "a regular file, not a directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "x", "--skip-codex-prompt"], { encoding: "utf8" });

    assert.equal(r.status, 0, `the adopt completes despite an unusable .codex: ${r.stderr}`);
    assert.match(r.stderr, /\.codex\/ lane could not be installed/, "…and says so plainly");
    assert.match(r.stderr, /CODEX LANE IS UNGUARDED/,
      "…naming the real cost now that this lane carries enforcement, not a lost convenience");
    assert.match(r.stderr, /no write guards, no registration, no cold-review seat/, "…and what is missing");

    // The load-bearing half: everything that actually enforces must still be in place. A warning is
    // worth nothing if the run stopped before the controls landed.
    const settings = readFileSync(path.join(dir, ".claude", "settings.json"), "utf8");
    assert.match(settings, /guard-lane-authoring/, "the Claude guards are still registered");
    assert.ok(existsSync(path.join(dir, ".githooks", "pre-commit")), "the every-lane commit floor still installed");
    assert.ok(existsSync(path.join(dir, "core", "BINDINGS.md")), "the other [G] docs were still generated");
    assert.ok(existsSync(path.join(dir, "core", "GATES.md")), "the [P] method docs still landed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("removed-flag `=` spelling, the hooks DETECTOR, and an honest skip message", () => {
  const mk = () => { const d = mkdtempSync(path.join(os.tmpdir(), "kit-r2-")); execFileSync("git", ["init", "-q", d]); return d; };
  const init = (d, ...extra) => spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", d,
    "--repo-name", "x", "--skip-codex-prompt", ...extra], { encoding: "utf8" });

  // 1. `--flag=value` fell through to the generic "unknown argument", so the adopter most likely to
  // have SCRIPTED the flag was the one who got no migration sentence.
  // kit-guard:no-install — a removed flag; exits 2 before any install runs.
  const eq = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--risk-tokens=billing"], { encoding: "utf8" });
  assert.equal(eq.status, 2, "the `=` spelling still exits 2");
  assert.match(eq.stderr, /--risk-tokens was REMOVED at v2\.0/, "…and now gets the migration message, not 'unknown argument'");

  // 2. The "your config declares hooks" warning is a DETECTOR, and it only matched a TOML table
  // header. `hooks = "./hooks.json"` is the spelling Codex's own schema uses, so the likeliest one
  // went undetected — a fail-open in the thing whose job is to notice.
  for (const spelling of ['hooks = "./hooks.json"\n', "[hooks]\n", "hooks.pre_tool_use = [{}]\n"]) {
    const d = mk();
    try {
      mkdirSync(path.join(d, ".codex"), { recursive: true });
      writeFileSync(path.join(d, ".codex", "config.toml"), spelling);
      assert.match(init(d).stderr, /DECLARES HOOKS/,
        `an adopter config using ${JSON.stringify(spelling.trim())} is detected`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // …and it must not cry wolf on the kit's own shipped config, or the warning trains adopters to ignore it.
  const clean = mk();
  try {
    assert.equal(init(clean).status, 0);
    assert.doesNotMatch(init(clean).stderr, /DECLARES HOOKS/, "the kit's own config.toml does NOT trip the detector");
  } finally { rmSync(clean, { recursive: true, force: true }); }

  // 3. `--skip-codex-lane` printed "SKIPPED" unconditionally — including over a .codex/ that a
  // previous adopt had already written and that this run left sitting there.
  const reran = mk();
  try {
    assert.equal(init(reran, "--codex-cold-model", "m-1").status, 0);
    assert.ok(existsSync(path.join(reran, ".codex", "config.toml")), "first adopt wrote .codex/");
    const second = init(reran, "--skip-codex-lane");
    assert.match(second.stdout, /ALREADY EXISTS here and was left untouched/,
      "a re-run with the skip flag says the .codex/ is still there rather than implying it is absent");
    assert.ok(existsSync(path.join(reran, ".codex", "config.toml")), "…and it genuinely is still there");
  } finally { rmSync(reran, { recursive: true, force: true }); }
});
