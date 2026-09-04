// PORTABILITY.md is the file every installed surface cites for what the controls do NOT cover —
// both entry stubs, both reviewer skills, two guards' own headers, codex/config.toml and init's
// end-of-run summary — and until v2.28.0 no run of init put it anywhere the reader could open it.
// A citation to a missing file reads as "there is a fuller model somewhere": assurance by belief,
// the exact thing the file exists to kill. It installs verbatim as [P] at the adopter's root and is
// MECHANISM, like core/: a stale copy mis-states which lane a control binds, so it follows the
// same three-branch contract as a guard — fresh ⇒ byte-identical; edited + plain re-run ⇒ kept
// and the run FAILS naming --force; --force ⇒ replaced, the edit preserved in .bak.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);

test("init installs PORTABILITY.md verbatim at the root, keeps-and-fails on a stale copy, and --force replaces it with a .bak", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-portability-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-portability-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    // --skip-codex-lane keeps the run hermetic (no post-force armed-check, so --force can exit 0
    // and the subject here — the bytes — is what the exit code reports on).
    const run = (args = []) => spawnSync(process.execPath,
      [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir, "--skip-codex-lane", ...args],
      { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
    const installed = path.join(dir, "PORTABILITY.md");
    const kitBytes = readFileSync(path.join(KIT, "PORTABILITY.md"));

    const fresh = run();
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.ok(existsSync(installed), "PORTABILITY.md is installed at the adopter's ROOT — where every citation points");
    assert.ok(readFileSync(installed).equals(kitBytes), "…byte-identical to the kit's");
    assert.match(fresh.stdout + fresh.stderr, /PORTABILITY\.md: installed at the repo root/, "the install log names it");
    assert.match(fresh.stdout + fresh.stderr, /READ PORTABILITY\.md \(installed at your repo root\)/, "the end-of-run pointer says where it is");

    const marker = "\n<!-- adopter edit -->\n";
    writeFileSync(installed, kitBytes.toString("utf8") + marker);
    const stale = run();
    assert.equal(stale.status, 1, "a plain re-run over a stale copy FAILS — the same contract as a stale guard");
    assert.match(stale.stdout + stale.stderr, /KEPT BUT STALE[^\n]*PORTABILITY\.md/, "…naming this file as the stale keep");
    assert.ok(readFileSync(installed, "utf8").endsWith(marker), "…and the edited copy is KEPT, not silently replaced");

    const forced = run(["--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.ok(readFileSync(installed).equals(kitBytes), "--force is what replaces it");
    assert.ok(readFileSync(`${installed}.bak`, "utf8").endsWith(marker), "…and the adopter's edited version is preserved beside it");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(codexDir, { recursive: true, force: true }); }
});
