// PORTABILITY.md is the kit's own contract about what its controls do NOT cover, and it stays in the
// kit: installing it at an adopter's root was tried and withdrawn in review (a generic filename the
// kit cannot occupy without overwriting, bricking, or mis-pointing). So every pointer the kit SHIPS
// must say where the file actually is. A bare "see PORTABILITY.md" in an installed surface reads as
// "there is a fuller model somewhere here", which is assurance by belief — the thing the file exists
// to kill. This pins both halves: the pointers name the kit, and an adopt installs no root copy.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);

// Every shipped surface that cites the file. Listed, not discovered: a new citation in a new file
// should be added here deliberately, with its wording.
const CITING = [
  "templates/CLAUDE.md.tmpl", "templates/AGENTS.md.tmpl", "templates/BINDINGS.md.tmpl", "templates/kit-precommit.test.mjs",
  "skills/frontier-review/INVOKE.md", "skills/orchestrate/SKILL.md",
  "hooks/guard-cross-repo-writes.mjs", "hooks/guard-owner-comms.mjs", "codex/config.toml", "bin/init.mjs",
];

test("every shipped citation of PORTABILITY.md says it is the kit's, in the kit — never a bare filename an adopter would look for locally", () => {
  const bare = [];
  for (const rel of CITING) {
    const lines = readFileSync(path.join(KIT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("PORTABILITY.md")) return;
      // bin/init.mjs is never installed: its code COMMENTS are read in the kit, where the file sits
      // at the root, so only its PRINTED strings (log/warn/item) are pointers an adopter reads.
      if (rel === "bin/init.mjs" && /^\s*\/\//.test(line)) return;
      if (/KIT_ROOT|path\.join/.test(line)) return;
      if (!/kit's|workflow-kit repository|in the kit\b/.test(line)) bare.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bare, [], "bare citations (add 'the kit's' / 'workflow-kit repository'):\n" + bare.join("\n"));
});

test("an adopt installs NO PORTABILITY.md at the root, and the checklist points at the kit's", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-portability-cite-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-portability-cite-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync(process.execPath,
      [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, "--skip-codex-lane"],
      { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(dir, "PORTABILITY.md")), "nothing is installed at the adopter's root under that name");
    assert.match(r.stdout + r.stderr, /READ the kit's PORTABILITY\.md \(in the workflow-kit repository; it is NOT installed here/, "the checklist says where it is");
    assert.doesNotMatch(r.stdout + r.stderr, /installed at your repo root|PORTABILITY\.md: installed/, "…and never claims an install");
    // The generated stubs carry the retargeted pointer, under the entry cap.
    for (const stub of ["CLAUDE.md", "AGENTS.md"]) {
      const text = readFileSync(path.join(dir, stub), "utf8");
      assert.match(text, /kit's `PORTABILITY\.md`/, `${stub} points at the kit's file`);
      assert.ok(Buffer.byteLength(text) <= 8192, `${stub} stays under the 8 KiB entry cap (${Buffer.byteLength(text)} B)`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
});
