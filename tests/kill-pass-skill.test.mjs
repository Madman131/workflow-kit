// workflow-kit — the /kill-pass skill ships as one body plus a shim per lane, and both install.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("kill-pass: body declares its budget, both shims point at the body, and init installs all three", () => {
  const body = readFileSync(path.join(KIT, "skills", "kill-pass", "SKILL.md"), "utf8");
  const budget = Number((body.match(/^Word budget: (\d+)\./m) || [])[1]);
  assert.ok(budget > 0, "the body declares a word budget");
  assert.ok(body.split(/\s+/).filter(Boolean).length <= budget, "and is within it");
  assert.match(body, /DECLARATION, not a gate/, "the report is a declaration; the skill adds no stop of its own");
  for (const lane of ["claude", "codex"]) {
    const shim = readFileSync(path.join(KIT, "skill-shims", lane, "kill-pass.md"), "utf8");
    assert.match(shim, /\.agents\/skills\/kill-pass\/SKILL\.md/, `${lane} shim points at the shared body`);
    assert.doesNotMatch(shim, /Word budget:/, `${lane} shim carries no budget line (rules live in the body)`);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-killpass-adopt-"));
  try {
    const env = { ...process.env }; delete env.NODE_OPTIONS; for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST")) delete env[k];
    const prompts = path.join(dir, "codex-prompts");   // a scratch Codex prompts dir, so the real ~/.codex/prompts is never touched
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", prompts, "--skip-codex-lane"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(dir, ".agents", "skills", "kill-pass", "SKILL.md")), "shared body installed");
    assert.ok(existsSync(path.join(dir, ".claude", "skills", "kill-pass", "SKILL.md")), "Claude shim installed");
    assert.ok(existsSync(path.join(prompts, "kill-pass.md")), "Codex shim installed into the prompts dir");
    assert.match(r.stdout + r.stderr, /all resolve on disk/, "init verified every installed shim resolves");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
