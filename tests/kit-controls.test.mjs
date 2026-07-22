// workflow-kit — the kit's own control gate (`npm test`). It (1) runs the full plant-the-bug
// acceptance harness and asserts it passes, (2) unit-tests the fail-closed config loader, and (3)
// proves the portable FM1 test itself discriminates (goes RED when core.hooksPath is unset).

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("FM1: init sets core.hooksPath; the portable FM1 test goes RED when it is unset", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adopt-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter"],
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
