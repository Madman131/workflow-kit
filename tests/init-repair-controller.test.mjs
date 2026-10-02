// v2.43.0: `init` keeps an existing repair-controller user opted in (the controller is otherwise OFF by
// default). It writes `repairController: true` ONLY when the target's Git-common repair ledger exists and is
// non-empty AND the key is absent, says so in one line, and never flips an explicit value — through a plain
// run or a --force rewrite. Stake (a): a silent loss of enforcement for a repo with a live ledger on upgrade.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
const LINE = /repairController: true — this repo already has a repair ledger/;

function target({ ledger, config } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-rc-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-rc-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  if (ledger !== undefined) {
    mkdirSync(path.join(dir, ".git", "workflow-kit"), { recursive: true });
    writeFileSync(path.join(dir, ".git", "workflow-kit", "repair-events-v1.jsonl"), ledger);   // init never reads its content
  }
  const cfg = path.join(dir, ".claude", "kit.config.json");
  if (config !== undefined) { mkdirSync(path.dirname(cfg), { recursive: true }); writeFileSync(cfg, config); }
  const run = (args = []) => spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, ...args],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  const read = () => JSON.parse(readFileSync(cfg, "utf8"));
  return { dir, cfg, run, read, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("fresh install: a non-empty ledger writes repairController true and says why; no ledger, or an empty one, writes nothing", () => {
  for (const [name, ledger, expected] of [["non-empty", '{"row":1}\n', true], ["absent", undefined, undefined], ["empty", "", undefined]]) {
    const t = target({ ledger });
    try {
      const r = t.run();
      assert.equal(r.status, 0, `${name}: ${r.stderr}`);
      const cfg = t.read();
      assert.equal(cfg.repairController, expected, `${name} ledger`);
      if (expected) assert.match(r.stdout, LINE);
      else assert.doesNotMatch(r.stdout, LINE, `${name}: no note when nothing was written`);
    } finally { t.cleanup(); }
  }
});

test("a plain run over an existing config without the key adds ONLY the key (backup kept) when a ledger exists", () => {
  const t = target({ ledger: '{"row":1}\n', config: JSON.stringify({ briefPathDirs: ["dispatches"], stateDocs: ["docs/S.md"] }) });
  try {
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(t.read(), { briefPathDirs: ["dispatches"], stateDocs: ["docs/S.md"], repairController: true });
    assert.match(r.stdout, LINE);
    assert.ok(existsSync(`${t.cfg}.bak`), "the original was backed up first");
  } finally { t.cleanup(); }
});

test("a plain run over an existing config without the key and WITHOUT a ledger leaves the file untouched", () => {
  const original = JSON.stringify({ briefPathDirs: ["dispatches"] });
  const t = target({ config: original });
  try {
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(t.cfg, "utf8"), original);
    assert.doesNotMatch(r.stdout, LINE);
  } finally { t.cleanup(); }
});

test("an explicit value is never flipped, plain or --force, with or without a ledger", () => {
  for (const value of [false, true]) {
    for (const ledger of [undefined, '{"row":1}\n']) {
      for (const args of [[], ["--force"]]) {
        const t = target({ ledger, config: JSON.stringify({ repairController: value }) });
        try {
          const r = t.run(args);
          assert.doesNotMatch(r.stdout + r.stderr, /REFUSED/, `${value}/${ledger === undefined ? "no ledger" : "ledger"}/${args.join("")}`);
          assert.equal(t.read().repairController, value, `explicit ${value} survives ${args.join(" ") || "a plain run"}`);
          assert.doesNotMatch(r.stdout, LINE, "init claims to have written nothing it did not write");
        } finally { t.cleanup(); }
      }
    }
  }
});

test("--force over an existing config without the key and a ledger carries the opt-in through the rewrite", () => {
  const t = target({ ledger: '{"row":1}\n', config: "{}" });
  try {
    const r = t.run(["--force"]);   // exit status is the host's Codex armed-check, not this test's subject
    assert.doesNotMatch(r.stdout + r.stderr, /REFUSED/);
    assert.equal(t.read().repairController, true);
    assert.match(r.stdout, LINE);
  } finally { t.cleanup(); }
});

test("--force does not report the key as an unrecognised one it drops", () => {
  const t = target({ config: JSON.stringify({ repairController: false }) });
  try {
    const r = t.run(["--force"]);
    assert.doesNotMatch(r.stdout + r.stderr, /"repairController".*(?:init does not recognise|DROPS)/);
  } finally { t.cleanup(); }
});

test("a malformed existing value is carried as-is by --force, so the guard still fails closed on it", () => {
  const t = target({ ledger: '{"row":1}\n', config: JSON.stringify({ repairController: "yes" }) });
  try {
    const r = t.run(["--force"]);
    assert.doesNotMatch(r.stdout + r.stderr, /REFUSED/);
    assert.equal(t.read().repairController, "yes", "init does not repair or reinterpret adopter data");
  } finally { t.cleanup(); }
});
