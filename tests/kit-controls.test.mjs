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
