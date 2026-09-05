// PORTABILITY.md is the kit's own contract about what its controls do NOT cover, and it stays in the
// kit: installing it at an adopter's root was tried and withdrawn in review (a generic filename the
// kit cannot occupy without overwriting, bricking, or mis-pointing). So every pointer the kit SHIPS
// must say where the file actually is. A bare "see PORTABILITY.md" in an installed surface reads as
// "there is a fuller model somewhere here", which is assurance by belief — the thing the file exists
// to kill.
//
// NO ALLOW-LIST. The first version of this test named the citing files, and the bookend found one it
// had not named (the Codex arming probe, which init copies). An allow-list is an undeclared narrowing:
// the surfaces are DISCOVERED here by adopting into a temp dir and walking every file init wrote.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
const LOCATED = /kit's|workflow-kit repository|in the kit\b|workflow-kit's/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

function adopt(extra = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-portability-cite-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-portability-cite-prompts-"));
  execFileSync("git", ["init", "-q", dir]);
  const r = spawnSync(process.execPath,
    [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, "--with-gate-runners", ...extra],
    { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
  return { dir, codexDir, r, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); } };
}

test("every file init installs that mentions PORTABILITY.md says it is the kit's, in the kit — discovered by walking the installed tree, not by a list", () => {
  const { dir, codexDir, r, cleanup } = adopt();
  try {
    assert.equal(r.status, 0, r.stderr);
    const bare = [];
    for (const root of [dir, codexDir]) {
      for (const f of walk(root)) {
        if (statSync(f).size > 2_000_000) continue;
        let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
        if (!text.includes("PORTABILITY.md")) continue;
        text.split("\n").forEach((line, i) => {
          if (line.includes("PORTABILITY.md") && !LOCATED.test(line)) bare.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
      }
    }
    assert.deepEqual(bare, [], "bare citations in INSTALLED files (say the kit's / workflow-kit):\n" + bare.join("\n"));
    assert.ok(!existsSync(path.join(dir, "PORTABILITY.md")), "nothing is installed at the adopter's root under that name");
    const out = r.stdout + r.stderr;
    assert.match(out, /READ the kit's PORTABILITY\.md \(in the workflow-kit repository; it is NOT installed here\)/, "the checklist says where it is");
    assert.doesNotMatch(out, /installed at your repo root|PORTABILITY\.md: installed|pointer in the installed method means/, "…claims no install and carries no obsolete translation clause");
    for (const stub of ["CLAUDE.md", "AGENTS.md"]) {
      const text = readFileSync(path.join(dir, stub), "utf8");
      assert.match(text, /kit's `PORTABILITY\.md`/, `${stub} points at the kit's file`);
      assert.ok(Buffer.byteLength(text) <= 8192, `${stub} stays under the 8 KiB entry cap (${Buffer.byteLength(text)} B)`);
    }
  } finally { cleanup(); }
});

test("the kit's own printed strings in bin/init.mjs are located too (init is not installed, so its comments are exempt)", () => {
  const lines = readFileSync(path.join(KIT, "bin", "init.mjs"), "utf8").split("\n");
  const bare = [];
  lines.forEach((line, i) => {
    if (!line.includes("PORTABILITY.md") || /^\s*\/\//.test(line) || /KIT_ROOT|path\.join/.test(line)) return;
    if (!LOCATED.test(line)) bare.push(`bin/init.mjs:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  assert.deepEqual(bare, [], "bare printed pointers:\n" + bare.join("\n"));
});
