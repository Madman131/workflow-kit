import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SOURCE, ORCHESTRATE_FILES, compareInstalled, installOrchestrate,
} from "../scripts/sync-user-orchestrate-skill.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(KIT, "scripts", "sync-user-orchestrate-skill.mjs");

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "orchestrate-sync-"));
  return { root, target: path.join(root, "installed"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("install copies the complete canonical package and check detects exact drift", () => {
  const f = fixture();
  try {
    assert.deepEqual(compareInstalled({ target: f.target }), { ok: false, drift: ["<directory>"] });
    assert.equal(installOrchestrate({ target: f.target }).ok, true);
    for (const name of ORCHESTRATE_FILES) {
      assert.deepEqual(readFileSync(path.join(f.target, name)), readFileSync(path.join(DEFAULT_SOURCE, name)), name);
    }
    writeFileSync(path.join(f.target, "SKILL.md"), "stale\n");
    assert.deepEqual(compareInstalled({ target: f.target }), { ok: false, drift: ["SKILL.md"] });
    const cli = spawnSync(process.execPath, [CLI, "--check", "--target", f.target], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /SKILL\.md/);
  } finally { f.cleanup(); }
});

test("a symlinked target or package member fails closed", () => {
  const f = fixture();
  try {
    const outside = path.join(f.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, f.target);
    assert.throws(() => installOrchestrate({ target: f.target }), /real directories/);
  } finally { f.cleanup(); }

  const g = fixture();
  try {
    installOrchestrate({ target: g.target });
    rmSync(path.join(g.target, "SKILL.md"));
    const outside = path.join(g.root, "outside.md");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, path.join(g.target, "SKILL.md"));
    assert.throws(() => installOrchestrate({ target: g.target }), /not a regular file/);
  } finally { g.cleanup(); }
});

test("the CLI installs and then verifies a custom target", () => {
  const f = fixture();
  try {
    execFileSync(process.execPath, [CLI, "--install", "--target", f.target]);
    execFileSync(process.execPath, [CLI, "--check", "--target", f.target]);
  } finally { f.cleanup(); }
});
