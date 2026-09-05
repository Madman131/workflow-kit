import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "scripts", "gemini-frozen-gate.mjs");
const wrapper = path.join(root, "scripts", "cold-review-gemini.sh");
function git(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim(); }
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-gate-"));
  git(dir, ["init", "-q"]); git(dir, ["config", "user.email", "test@example.invalid"]); git(dir, ["config", "user.name", "Test"]);
  mkdirSync(path.join(dir, "core"), { recursive: true }); mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "core", "INVARIANTS.md"), "portable invariant\n");
  writeFileSync(path.join(dir, "core", "REPO_INVARIANTS.md"), "repo invariant\n");
  writeFileSync(path.join(dir, "docs", "contract.md"), "acceptance context\n");
  writeFileSync(path.join(dir, "src.mjs"), "export const before = 1;\n");
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "base"]); const base = git(dir, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(dir, "src.mjs"), "export const after = 2;\n");
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "candidate"]);
  return { dir, base, candidate: git(dir, ["rev-parse", "HEAD"]), tree: git(dir, ["rev-parse", "HEAD^{tree}"]) };
}
function run(f, extra = []) { return spawnSync(process.execPath, [runner, "--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--context", "docs/contract.md", "--dry-run", ...extra], { encoding: "utf8" }); }

test("frozen direct dry-run reads only the exact committed candidate and stays below the serialized cap", () => {
  const f = fixture(); try {
    const r = run(f); assert.equal(r.status, 0, r.stderr); const out = JSON.parse(r.stdout);
    assert.equal(out.frozen.candidate, f.candidate); assert.ok(out.envelopes[0].bytes < 81920);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("wrong tree and dirty checkout refuse before a provider call", () => {
  const f = fixture(); try {
    assert.notEqual(run(f, ["--tree", "0".repeat(40)]).status, 0);
    writeFileSync(path.join(f.dir, "unrelated.txt"), "not committed\n");
    assert.notEqual(run(f).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("public selftest is installed-script scoped and makes no provider call", () => {
  const r = spawnSync("bash", [wrapper, "--selftest"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /no network/);
});
test("gate-runner installation includes the public frozen runner and its selftest", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-install-"));
  try {
    git(dir, ["init", "-q"]);
    const r = spawnSync(process.execPath, [path.join(root, "bin", "init.mjs"), "--target", dir, "--repo-name", "fixture", "--owner-name", "Fixture", "--with-gate-runners", "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dir, "scripts", "gemini-frozen-gate.mjs")));
    assert.ok(existsSync(path.join(dir, "scripts", "cold-review-gemini-selftest.sh")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
