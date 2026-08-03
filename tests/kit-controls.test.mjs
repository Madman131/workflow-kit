// workflow-kit — the kit's own control gate (`npm test`). It (1) runs the full plant-the-bug
// acceptance harness and asserts it passes, (2) unit-tests the fail-closed config loader, and (3)
// proves the portable FM1 test itself discriminates (goes RED when core.hooksPath is unset).

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A nested `node --test` inherits the parent runner's env (NODE_TEST_CONTEXT / NODE_OPTIONS) and then
// reports up over IPC instead of exiting non-zero — so a failing inner run would look green. Strip
// those so the child's own exit code is trustworthy.
function cleanTestEnv() {
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST")) delete e[k];
  return e;
}

test("acceptance/plant-the-bug.sh passes — every control observed both blocking and permitting", () => {
  const r = spawnSync("bash", [path.join(KIT, "acceptance", "plant-the-bug.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, `acceptance harness failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ACCEPTANCE PASSED/);
});

test("check-doc-size loadKitConfig is fail-closed: absent -> defaults, malformed -> not ok", async () => {
  const { loadKitConfig } = await import(path.join(KIT, "scripts", "check-doc-size.mjs"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-cfg-"));
  try {
    // absent config -> ok with empty repo-specific families
    let c = loadKitConfig(dir);
    assert.equal(c.ok, true);
    assert.deepEqual(c.stateDocs, []);
    assert.equal(c.memoryDir, null);
    // malformed config -> NOT ok (fail closed)
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), "NOT JSON{");
    c = loadKitConfig(dir);
    assert.equal(c.ok, false, "a malformed config must be reported not-ok (fail closed)");
    // wrong-typed field -> NOT ok
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ stateDocs: "nope" }));
    assert.equal(loadKitConfig(dir).ok, false, "a wrong-typed stateDocs must be not-ok");
    // valid partial config -> ok
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ stateDocs: ["docs/s.md"] }));
    c = loadKitConfig(dir);
    assert.equal(c.ok, true);
    assert.deepEqual(c.stateDocs, ["docs/s.md"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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

// Adopt into a fresh scratch repo. Codex prompts are user-global, so ALWAYS point init at a scratch
// dir — a test that writes to a real ~/.codex/prompts is not hermetic.
function adopt(extraArgs = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adopt-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-codex-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  const run = (args = extraArgs) => execFileSync(
    "node",
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
    { stdio: "ignore" },
  );
  run();
  return { dir, codexDir, run, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("init rejects a flag-shaped value for every value-taking flag", () => {
  // `--target -h` must not adopt into a directory literally named "-h" while silently swallowing the
  // help flag. Single-dash flags are real (-h), so rejecting only "--" prefixes left this open.
  for (const argv of [["--target"], ["--target", "-h"], ["--target", "--help"], ["--repo-name", "--force"],
    ["--owner-name", "--force"], ["--codex-prompts-dir", ""], ["--memory-dir", "--target"]]) {
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

test("--risk-tokens is DEPRECATED (v1.5.0): parses, warns loudly, and the dead family is not written", () => {
  // The lane route this flag parameterized was retired; removal of the flag itself is a breaking CLI
  // change reserved for v2.0. Until then the contract is parse-warn-ignore: a saved init invocation
  // keeps working, the warning is loud, and laneRiskTokens never reaches kit.config.json.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-dep-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name",
      "adopter", "--risk-tokens", "billing", "--source-dirs", "app", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a saved init invocation with --risk-tokens must keep working: ${r.stderr}`);
    assert.match(r.stderr, /--risk-tokens is DEPRECATED/, "the warning is loud (stderr, not buried in the log)");
    assert.match(r.stderr, /removed at v2\.0/, "and it states the removal horizon");
    const cfg = JSON.parse(readFileSync(path.join(dir, ".claude", "kit.config.json"), "utf8"));
    assert.equal(cfg.laneRiskTokens, undefined, "the dead family is NOT written");
    assert.deepEqual(cfg.executedPathDirs, ["app"], "…while the live family still is");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init installs the dual-lane skills: one shared body, a shim per harness, idempotently", () => {
  const { dir, codexDir, run, cleanup } = adopt();
  try {
    const body = path.join(dir, ".agents", "skills", "humanize", "SKILL.md");
    const bullet = path.join(dir, ".agents", "skills", "humanize", "BULLET.md");
    const claudeShim = path.join(dir, ".claude", "skills", "humanize", "SKILL.md");
    const aliasShim = path.join(dir, ".claude", "skills", "humanize-bullet", "SKILL.md");
    const codexShim = path.join(codexDir, "humanize.md");
    const codexAlias = path.join(codexDir, "humanize-bullet.md");
    for (const [label, p] of [["shared body", body], ["body sibling BULLET.md", bullet], ["Claude shim", claudeShim],
      ["Claude alias shim", aliasShim], ["Codex shim", codexShim], ["Codex alias shim", codexAlias]]) {
      assert.ok(existsSync(p), `${label} installed at ${p}`);
    }
    assert.match(readFileSync(claudeShim, "utf8"), /^---\n/, "Claude skill shim opens with YAML frontmatter");
    assert.match(readFileSync(codexShim, "utf8"), /^# /, "Codex skill prompt opens with a markdown H1");
    // THE load-bearing property: every shim points at a body that EXISTS. A shim naming a renamed or
    // dropped body ships a command that dead-ends, which is the failure this mechanism must not hide.
    for (const shim of [claudeShim, aliasShim, codexShim, codexAlias]) {
      const refs = [...readFileSync(shim, "utf8").matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
      assert.ok(refs.length > 0, `${shim} names a shared body`);
      for (const [, skill, file] of refs) {
        assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
          `${shim} points at .agents/skills/${skill}/${file}, which must exist`);
      }
    }
    // The shims carry NO rules of their own — that is the point of a single shared body.
    for (const shim of [claudeShim, codexShim]) {
      assert.doesNotMatch(readFileSync(shim, "utf8"), /Word budget/, `${shim} must not duplicate the body's rules`);
    }
    // Idempotent: plant a real USER EDIT first. Hashing a pristine install would stay green even if
    // copyGuarded regressed to overwrite (a re-copy is byte-identical), so it must be MUTATED.
    const edited = {};
    for (const p of [body, claudeShim, codexShim]) {
      edited[p] = readFileSync(p, "utf8") + "\n<!-- user edit: keep me -->\n";
      writeFileSync(p, edited[p]);
    }
    run();
    for (const p of [body, claudeShim, codexShim]) {
      assert.equal(readFileSync(p, "utf8"), edited[p], `re-run KEEPS the user-edited ${p} (no clobber without --force)`);
    }
  } finally { cleanup(); }
});

test("init generates core/OWNER_COMMS.md as [G]; --owner-name fills only the name", () => {
  const plain = adopt();
  try {
    const doc = path.join(plain.dir, "core", "OWNER_COMMS.md");
    assert.ok(existsSync(doc), "core/OWNER_COMMS.md is generated");
    const text = readFileSync(doc, "utf8");
    assert.match(text, /CLASS: BINDING/, "declares CLASS: BINDING so check-doc-size governs it automatically");
    assert.match(text, /\{\{OWNER_NAME\}\}/, "without --owner-name the placeholder stays (sensor dormant)");
    // The kit must NEVER ship a concrete Owner: [G] means generated, never copied.
    assert.ok(!existsSync(path.join(KIT, "core", "OWNER_COMMS.md")),
      "the kit itself must not ship a concrete core/OWNER_COMMS.md — it names a person ([G])");
  } finally { plain.cleanup(); }

  const named = adopt(["--owner-name", "Alex"]);
  try {
    const text = readFileSync(path.join(named.dir, "core", "OWNER_COMMS.md"), "utf8");
    assert.match(text, /^## How to talk to Alex — Owner, not a developer$/m, "--owner-name fills the heading the sensor parses");
    // The three judgment-call placeholders are deliberately LEFT for the adopter.
    for (const tok of ["OWNER_PROFILE", "IRREVERSIBLE_ASSET", "OWNER_SHORTHAND"]) {
      assert.match(text, new RegExp(`\\{\\{${tok}\\}\\}`), `{{${tok}}} is left for manual completion`);
    }
  } finally { named.cleanup(); }
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
    const countPreToolUse = () => {
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      return (s.hooks?.PreToolUse ?? []).flatMap((g) => g.hooks ?? [])
        .filter((h) => /guard-(cross-repo-writes|lane-authoring|gate-ladder)\.mjs/.test(String(h.command))).length;
    };
    assert.equal(countStop(), 1, "Stop sensor registered once on disk");
    assert.equal(countPreToolUse(), 3, "the 3 PreToolUse guards are still registered alongside it");
    run(); // merging is idempotent — a re-run must not duplicate the registration
    assert.equal(countStop(), 1, "re-run does not duplicate the Stop registration");
    assert.equal(countPreToolUse(), 3, "re-run does not duplicate the PreToolUse registrations");
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
    assert.equal(countPreToolUse(), 3, "our 3 PreToolUse guards are still present");
  } finally { cleanup(); }
});

test("init --force backs up hand-authored [G] content instead of destroying it", () => {
  const { dir, run, cleanup } = adopt(["--owner-name", "Alex", "--source-dirs", "app"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const cfg = path.join(dir, ".claude", "kit.config.json");
    // Complete the contract the way an adopter must, then take the upgrade path init itself
    // recommends for a stale hook ("re-run with --force"). --force is GLOBAL, so without a backup it
    // silently destroys the hand-written Owner doc AND resets the source-dir family to defaults.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_PROFILE}}", "They read fast and hate preamble."));
    run(["--force"]);   // note: no --owner-name and no family flags this time
    assert.ok(existsSync(`${doc}.bak`), "--force leaves a .bak of the previous OWNER_COMMS");
    assert.match(readFileSync(`${doc}.bak`, "utf8"), /They read fast and hate preamble\./,
      "the hand-written Owner profile is recoverable, not lost");
    assert.ok(existsSync(`${cfg}.bak`), "--force leaves a .bak of the previous kit.config.json");
    assert.match(readFileSync(`${cfg}.bak`, "utf8"), /app/,
      "the configured executedPathDirs family is recoverable — a silent reset to {} WIDENS the write guard");

    // If the backup CANNOT be written, the overwrite must not happen either. Warning about a failed
    // backup and then destroying the file anyway is worse than not offering backups at all, because
    // the console says the upgrade path is recoverable.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{IRREVERSIBLE_ASSET}}", "the customer corpus"));
    rmSync(`${doc}.bak`, { force: true });
    mkdirSync(`${doc}.bak`);          // a directory here makes the backup write fail
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt", "--force"], { encoding: "utf8" });
    assert.equal(r.status, 0, "init still completes the rest of the adopt");
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

test("init verifies the INSTALLED shims, and a shim naming no body is a failure not a pass", () => {
  const { dir, run, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const shim = path.join(dir, ".claude", "skills", "humanize", "SKILL.md");
    // BOTH streams: init's log() goes to stdout but warn() goes to stderr, and the dangling-shim
    // report is a warning. Reading stdout alone would make every assertion below unfalsifiable.
    const runOut = (args) => {
      const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
        "--repo-name", "adopter", "--skip-codex-prompt", ...args], { encoding: "utf8" });
      assert.equal(r.status, 0, `init should exit 0: ${r.stderr}`);
      return r.stdout + r.stderr;
    };
    assert.match(runOut([]), /body reference\(s\).*all resolve on disk/, "a healthy install reports resolution");
    // A KEPT shim is the one the harness loads. Point it at a body that does not exist: init must
    // read the INSTALLED file, not the kit's pristine source, or it certifies a shim it never saw.
    writeFileSync(shim, "---\nname: humanize\n---\nRead `.agents/skills/gone-forever/SKILL.md`.\n");
    const out = runOut([]);
    assert.match(out, /gone-forever\/SKILL\.md, which is NOT installed/, "a dangling INSTALLED shim is reported");
    assert.match(out, /do NOT resolve/, "and the summary line says so rather than claiming success");
    assert.doesNotMatch(out, /all resolve on disk/, "init must not also print a clean bill of health");
    // A shim naming NO body at all: zero matches must not read as zero failures.
    writeFileSync(shim, "---\nname: humanize\n---\nNo body reference here at all.\n");
    assert.match(runOut([]), /names NO \.agents\/skills/, "a shim with zero body references is a failure, not a vacuous pass");
    run(["--force"]); // restore for any later assertions in this test file
  } finally { cleanup(); }
});

test("guard-owner-comms is a FAIL-OPEN sensor: dormant until named, then it discriminates", () => {
  const { dir, cleanup } = adopt(["--owner-name", "Alex"]);
  try {
    const hook = path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs");
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const transcript = path.join(dir, "transcript.jsonl");
    // Complete the contract as an adopter must: real shorthand rows OUTSIDE the template's example
    // fence. Until this is done the sensor knows no question tokens — see the dedicated test below.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`AR` = archive ready? — is this thread closed out on the remote.\n`MIS` = make it so — proceed on the agreed scope."));
    // `entries` lets a case build an arbitrary transcript (sidechain flags, content blocks); the
    // 2-arg form is the common case. Both suites previously only ever produced the simple shape,
    // which is why several real branches were never exercised in either direction.
    const write = (user, assistantText) => writeEntries([
      { type: "user", message: { role: "user", content: user } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: assistantText }] } },
    ]);
    const writeEntries = (entries) => writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const run = (extra = {}, env = {}) => spawnSync("node", [hook], {
      cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript, ...extra }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    });
    // A CRASH is not an "allow". Mapping any non-block output to allow would let a hook that threw
    // on every input satisfy every fail-open assertion below, so exit status is checked explicitly.
    const decide = (extra = {}, env = {}) => {
      const r = run(extra, env);
      assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
      return r.stdout.includes('"decision":"block"') ? "block" : "allow";
    };
    const LONG = "word ".repeat(400);

    // --- SIZE MISMATCH, both directions ---
    write("AR", LONG);
    assert.equal(decide(), "block", "a declared shorthand QUESTION (gloss ends in '?') over-answered is flagged");
    write("AR", "Yes — closed out and verified on the remote.");
    assert.equal(decide(), "allow", "the same question answered briefly passes (no over-block)");
    write("MIS", LONG);
    assert.equal(decide(), "allow", "MIS is an INSTRUCTION (no '?' in its gloss) — a long work report is fine");
    write("ready to ship?", LONG);
    assert.equal(decide(), "block", "a short yes/no question answered at length is flagged");
    // An explicit REQUEST FOR DETAIL is not over-answered by giving the detail. Blocking it would tell
    // the agent to withhold exactly what the Owner asked for — the sensor working against rule 1.
    for (const q of ["can you give me the full inventory?", "can you give me the details?", "walk me through it?"]) {
      write(q, LONG);
      assert.equal(decide(), "allow", `"${q}" asks FOR detail — answering at length is correct`);
    }
    // …but that exemption must be PHRASES, not bare quantifiers. These are ordinary yes/no questions
    // that merely contain a word like "all" or "summary"; exempting them would silently delete the
    // check for a large class of exactly the questions it exists to protect.
    // The exemption keys on the Owner ASKING for elaboration, never on the topic merely sounding
    // detailed — a noun-phrase list exempted the last two of these.
    for (const q of ["Are all tests passing?", "Is the summary ready?", "Did every check pass?",
      "Are the details correct?", "Is the full report ready?"]) {
      write(q, LONG);
      assert.equal(decide(), "block", `"${q}" is a yes/no question, not a request for elaboration`);
    }

    // --- NARRATION, both directions ---
    write("what changed?", "Let me check the config and report back.");
    assert.equal(decide(), "block", "narration in the FINAL message is flagged");
    // Markdown furniture must not change the verdict — bulleted narration is still narration.
    for (const shape of ["- Let me check the config.", "1. Let me check the config.", "**Let me check the config** now."]) {
      write("what changed?", shape);
      assert.equal(decide(), "block", `narration is caught regardless of markdown shape: ${JSON.stringify(shape)}`);
    }
    for (const fence of ["```", "~~~"]) {
      write("what changed?", `${fence}text\nLet me check the config\n${fence}\nNothing changed.`);
      assert.equal(decide(), "allow", `${fence} fenced evidence is quoted material, not narration`);
    }
    // A FUTURE COMMITMENT is idiomatic and rule-1-compliant; flagging it costs the Owner an extra
    // message, which is the noise this hook exists to cut.
    for (const closing of [
      "Yes, safe. I will run the deploy once you say go.",
      "Yes, done. I'll check back tomorrow with the numbers.",
    ]) {
      write("safe?", closing);
      assert.equal(decide(), "allow", `a deferred commitment is not narration: ${JSON.stringify(closing)}`);
    }
    // The two branches are deliberately asymmetric, and BOTH directions of that asymmetry are pinned
    // here. "I'll …" is ambiguous — announcing work now vs promising it later — so it consults the
    // deferral list. "Let me …" is narration under every reading, so it never does. Sharing one
    // exemption between them let the first sentence below through on the word "then".
    for (const narrating of [
      "Let me check the config, then I'll report back.",
      "Let me verify that once the build finishes.",
    ]) {
      write("what changed?", narrating);
      assert.equal(decide(), "block", `"Let me …" is narration regardless of any deferral word: ${JSON.stringify(narrating)}`);
    }
    write("what changed?", "Config is unchanged. I'll check the logs, then send you the summary.");
    assert.equal(decide(), "allow", `"I'll … then …" chains a COMMITMENT about later work, not narration of work now`);
    write("what changed?", "I'll check the config.");
    assert.equal(decide(), "block", `"I'll check …" with no deferral IS narration`);
    // An explicit "now" beats a deferral word that belongs to a different clause of the same sentence.
    write("what changed?", "I'll check the config now; if you have questions, ask.");
    assert.equal(decide(), "block", `an unrelated "if you" must not excuse present-tense narration`);

    // --- harness-injected blocks must not silently disable the size check ---
    // The harness wraps the Owner's turn routinely. Discarding the whole turn (or letting the block
    // inflate the word count) removed the check on exactly the short-question turns it targets.
    write("<system-reminder>project context blob</system-reminder>\nAR", LONG);
    assert.equal(decide(), "block", "a LEADING system-reminder is stripped, not treated as the Owner's words");
    write("AR\n<system-reminder>project context blob</system-reminder>", LONG);
    assert.equal(decide(), "block", "a TRAILING system-reminder is stripped (it must not inflate the word count)");
    write("<system-reminder>nothing was typed</system-reminder>", LONG);
    assert.equal(decide(), "allow", "a turn with NO Owner-typed text has no question to size against");
    // An UNCLOSED block (a truncated tail) must be stripped too, and from either end. Handling only
    // the leading case left a truncated trailing block inflating the word count instead.
    write("AR\n<system-reminder>truncated context that never closes", LONG);
    assert.equal(decide(), "block", "an unclosed TRAILING harness block is stripped, not counted as the Owner's words");
    write("<system-reminder>truncated and never closed", LONG);
    assert.equal(decide(), "allow", "an unclosed LEADING block leaves no Owner text, so there is no question");
    // …but an INLINE mention of a tag is the Owner's own words. Stripping from it would truncate the
    // question, drop its "?", and silently disable the size check on a genuine short question.
    write("Is `<system-reminder>` supported?", LONG);
    assert.equal(decide(), "block", "an inline tag MENTION is Owner text, not an injected block");

    // --- a subagent's prompt must not be mistaken for the Owner's message ---
    writeEntries([
      { type: "user", message: { role: "user", content: "AR" } },
      { type: "user", isSidechain: true, message: { role: "user", content: `subagent brief: ${LONG}` } },
      { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "subagent result" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: LONG }] } },
    ]);
    assert.equal(decide(), "block",
      "a sidechain (subagent) prompt is skipped — otherwise every turn that spawns an agent loses the size check");

    // --- fail-open paths: each MUST allow, and exit 0, or the sensor could wedge a session ---
    write("AR", LONG);
    assert.equal(decide({ stop_hook_active: true }), "allow", "loop safety: stop_hook_active always allows");
    assert.equal(decide({}, { WORKFLOW_KIT_COMMS_GUARD: "false" }), "allow", "the off switch allows");
    assert.equal(decide({ transcript_path: "/nonexistent/nope.jsonl" }), "allow", "an unreadable transcript allows");
    const garbage = spawnSync("node", [hook], { cwd: dir, encoding: "utf8", input: "NOT JSON{", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(garbage.status, 0, "malformed stdin exits 0");
    assert.ok(!garbage.stdout.includes("block"), "malformed stdin allows");

    // --- the block REASON must be true, not just present ---
    write("AR", LONG);
    const reason = JSON.parse(run().stdout).reason;
    assert.match(reason, /Alex/, "the reason names the actual Owner from the generated doc");
    assert.match(reason, /ALREADY SEEN/, "the reason states the honest limit: the message cannot be retracted");
    assert.match(reason, /SIZE MISMATCH/, "the reason names the check that actually fired");

    // --- DORMANT, proven by reverting the arming condition ---
    writeFileSync(doc, readFileSync(doc, "utf8").replace(/Alex/g, "{{OWNER_NAME}}"));
    assert.equal(decide(), "allow", "an unfilled {{OWNER_NAME}} leaves the sensor DORMANT (allows unconditionally)");
    // A heading the hook cannot parse is ALSO dormant — and init reports it that way (test below).
    writeFileSync(doc, readFileSync(doc, "utf8").replace(/^## How to talk to.*$/m, "## Owner notes"));
    assert.equal(decide(), "allow", "a retitled heading leaves the sensor DORMANT");
    rmSync(doc);
    assert.equal(decide(), "allow", "an ABSENT core/OWNER_COMMS.md allows (no contract, no nudge)");
  } finally { cleanup(); }
});

test("init's armed/dormant report comes from the hook's own predicate, so it cannot drift", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const initSays = () => execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt"], { encoding: "utf8" })
      .split("\n").find((l) => l.includes("core/OWNER_COMMS.md:")) ?? "";
    // For each shape, init's WORD and the hook's BEHAVIOUR must agree. A paraphrased predicate here
    // announced ARMED for headings the hook could not parse — a false statement about a control.
    const shapes = [
      ["## How to talk to Alex — Owner, not a developer", true, "the shipped heading"],
      ["## How to talk to Alex - Owner, not a developer", false, "em dash normalized to a hyphen"],
      ["## How to talk to Alex", false, "heading tidied"],
      ["## Owner notes", false, "heading retitled"],
      ["## How to talk to {{OWNER_NAME}} — Owner, not a developer", false, "name never filled"],
    ];
    const original = readFileSync(doc, "utf8");
    for (const [heading, wantArmed, label] of shapes) {
      writeFileSync(doc, original.replace(/^## How to talk to.*$/m, heading));
      const armedPerHook = ownerContract(dir) !== null;
      assert.equal(armedPerHook, wantArmed, `hook: ${label} ⇒ ${wantArmed ? "armed" : "dormant"}`);
      const line = initSays();
      assert.equal(/is ARMED/.test(line), wantArmed, `init AGREES with the hook for ${label}: ${line.trim()}`);
      assert.equal(/DORMANT/.test(line), !wantArmed, `init says dormant exactly when the hook is dormant (${label})`);
    }
  } finally { cleanup(); }
});

test("the template's EXAMPLE shorthand is never harvested as the Owner's own vocabulary", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    // Armed on the name alone, but {{OWNER_SHORTHAND}} is still unfilled: the only `TOKEN` = gloss
    // rows in the file are the template's fenced EXAMPLES. Harvesting those would hand this Owner
    // someone else's vocabulary and make the sensor act on shorthand they never use.
    assert.deepEqual(ownerContract(dir).questionTokens, [],
      "fenced example rows contribute no question tokens");
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`LE` = loose ends pending? — what is still open.\n`CMPD` = commit, merge, push, deploy."));
    const tokens = ownerContract(dir).questionTokens;
    assert.deepEqual(tokens, ["LE"], "real rows outside the fence ARE harvested, and only the ones that ask");
  } finally { cleanup(); }
});

test("FM1: init sets core.hooksPath; the portable FM1 test goes RED when it is unset", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adopt-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    // --skip-codex-prompt keeps `npm test` HERMETIC: init otherwise defaults to the user-global
    // ~/.codex/prompts and this test would write there (a real side effect outside any scratch dir).
    execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--skip-codex-prompt"],
      { stdio: "ignore" });
    // init applied the FM1 mitigation
    const hp = execFileSync("git", ["-C", dir, "config", "core.hooksPath"], { encoding: "utf8" }).trim();
    assert.equal(hp, ".githooks", "init must set core.hooksPath=.githooks");
    // install the portable FM1 test into the adopter and prove it discriminates
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    copyFileSync(path.join(KIT, "templates", "kit-precommit.test.mjs"), path.join(dir, "tests", "kit-precommit.test.mjs"));
    const env = cleanTestEnv();
    const green = spawnSync("node", ["--test", "tests/kit-precommit.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.equal(green.status, 0, `FM1 test should PASS when core.hooksPath is set:\n${green.stdout}`);
    // PLANT THE BUG: unset core.hooksPath -> the FM1 test must go RED
    execFileSync("git", ["-C", dir, "config", "--unset", "core.hooksPath"]);
    const red = spawnSync("node", ["--test", "tests/kit-precommit.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.notEqual(red.status, 0, "FM1 test must FAIL when core.hooksPath is unset (else the mitigation is fiction)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
