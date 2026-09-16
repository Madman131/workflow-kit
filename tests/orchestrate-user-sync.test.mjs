import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARCHITECT_BUILD_FILES, ARCHITECT_BUILD_SOURCE, compareArchitectBuildInstalled,
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

test("the historic default stays orchestrate-only; the explicit architecture pair requires all four copies", () => {
  const f = fixture();
  const env = { ...process.env, HOME: f.root, USERPROFILE: f.root };
  const agents = path.join(f.root, ".agents", "skills", "orchestrate");
  const claude = path.join(f.root, ".claude", "skills", "orchestrate");
  const architectAgents = path.join(f.root, ".agents", "skills", "architect-build");
  const architectClaude = path.join(f.root, ".claude", "skills", "architect-build");
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
  try {
    // Nothing installed: check fails closed rather than passing on an empty set.
    assert.equal(run("--check").status, 1);
    assert.equal(run("--install").status, 0);
    for (const dir of [agents, claude]) {
      assert.deepEqual(compareInstalled({ target: dir }), { ok: true, drift: [] }, dir);
    }
    assert.equal(run("--check").status, 0, "the historic check stays /orchestrate-only");
    assert.equal(run("--check", "--architecture-pair").status, 1, "the explicit pair fails closed while architect-build is absent");
    assert.equal(run("--install", "--architecture-pair").status, 0);
    for (const dir of [architectAgents, architectClaude]) {
      assert.deepEqual(compareArchitectBuildInstalled({ target: dir }), { ok: true, drift: [] }, dir);
      assert.deepEqual(readFileSync(path.join(dir, "SKILL.md")), readFileSync(path.join(ARCHITECT_BUILD_SOURCE, "SKILL.md")));
    }
    // The defect this pins: a stale Claude copy behind an in-sync Codex copy read green.
    writeFileSync(path.join(claude, "SKILL.md"), "stale\n");
    const stale = run("--check", "--architecture-pair");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /\.claude.*SKILL\.md/);
    writeFileSync(path.join(architectAgents, "SKILL.md"), "stale\n");
    const architectStale = run("--check", "--architecture-pair");
    assert.equal(architectStale.status, 1);
    assert.match(architectStale.stderr, /architect-build.*\.agents.*SKILL\.md/);
    writeFileSync(path.join(architectAgents, "SKILL.md"), readFileSync(path.join(ARCHITECT_BUILD_SOURCE, "SKILL.md")));
    // A copy that was never installed is absent, not stale.
    rmSync(claude, { recursive: true, force: true });
    assert.equal(run("--check").status, 0, "historic /orchestrate check permits a never-installed sibling");
    assert.equal(run("--check", "--architecture-pair").status, 1, "pair parity rejects the crossed orchestrate/architect harness installs");
  } finally { f.cleanup(); }
});

test("architect-build sync exposes the complete canonical body", () => {
  assert.deepEqual(ARCHITECT_BUILD_FILES, ["SKILL.md", "ROUTING.md"]);
  assert.ok(readFileSync(path.join(ARCHITECT_BUILD_SOURCE, "SKILL.md"), "utf8").includes("/architect-build"));
  assert.ok(readFileSync(path.join(ARCHITECT_BUILD_SOURCE, "ROUTING.md"), "utf8").includes("persistent architect"));
});

test("architecture-pair install preserves a pre-existing architect-build until an explicit force", () => {
  const f = fixture();
  const env = { ...process.env, HOME: f.root, USERPROFILE: f.root };
  const preexisting = path.join(f.root, ".agents", "skills", "architect-build", "SKILL.md");
  try {
    mkdirSync(path.dirname(preexisting), { recursive: true });
    writeFileSync(preexisting, "user-owned architect skill\n");
    const blocked = spawnSync(process.execPath, [CLI, "--install", "--architecture-pair"], { encoding: "utf8", env });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /refusing to replace existing architect-build/);
    assert.equal(readFileSync(preexisting, "utf8"), "user-owned architect skill\n");
    assert.equal(spawnSync(process.execPath, [CLI, "--install", "--architecture-pair", "--force"], { encoding: "utf8", env }).status, 0);
    assert.deepEqual(compareArchitectBuildInstalled({ target: path.dirname(preexisting) }), { ok: true, drift: [] });
  } finally { f.cleanup(); }
});

test("the CLI installs and then verifies a custom target", () => {
  const f = fixture();
  try {
    execFileSync(process.execPath, [CLI, "--install", "--target", f.target]);
    execFileSync(process.execPath, [CLI, "--check", "--target", f.target]);
  } finally { f.cleanup(); }
});
