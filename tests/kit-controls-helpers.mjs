// Shared by the tests/kit-controls*.test.mjs files. Not a test file: scripts/run-checks.mjs runs only
// tests/*.test.mjs, so this module executes only when one of those imports it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Adopt into a fresh scratch repo. Codex prompts are user-global, so ALWAYS point init at a scratch
// dir — a test that writes to a real ~/.codex/prompts is not hermetic.
export function adopt(extraArgs = []) {
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
