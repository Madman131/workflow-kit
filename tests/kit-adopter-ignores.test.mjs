// workflow-kit — the kit's own .gitignore must NAME every family the installer appends to an
// adopter's.
//
// Why this exists. `bin/init.mjs` appends a set of paths to an adopter's .gitignore because they are
// per-session or per-checkout working state the installer itself writes. The kit's own .gitignore
// ignores all of `.claude/` in one blanket line, so most of those paths are ignored HERE for a
// reason that has nothing to do with the installer knowing about them. That asymmetry has already
// cost a release: a sensor's output file was documented as untracked, verified in the kit's tree
// where the blanket rule made it trivially true, and shipped — while no adopter ignored it at all.
// What the kit's own layout hides, no check run inside the kit can see.
//
// So this test does not compare behaviour; it compares LISTS. And it learns the installer's list by
// RUNNING THE INSTALLER into a scratch adopter and reading the file it produced — never by reading
// the installer's source. Source reading was tried first and abandoned: a regex over JavaScript
// cannot tell `[...]` from `[...].concat([...])`, does not see a call written across a comment, and
// reads a commented-out example as a real append. Each of those was a way for this check to certify
// a parity it had not established, or to demand a path nothing writes. What the installer ACTUALLY
// appends is not a matter of interpretation, so it is observed rather than inferred.
//
// The scratch adopter is a fresh `git init` with no .gitignore of its own, so every non-comment line
// in the resulting file was put there by the installer. Flags are chosen to produce the MAXIMAL set
// this profile can produce: `--with-gate-runners` adds the gate-artifact directory, and the Codex
// lane (on by default) adds the per-checkout registration. `--codex-prompts-dir` points at a scratch
// directory because Codex prompts are user-global and a test that writes to a real one is not
// hermetic. Both subprocesses run with every `GIT_*` variable dropped and the global and system git
// config pointed at an empty file this test owns — an inherited `GIT_TEMPLATE_DIR` or config
// override would otherwise decide whether a correct candidate passes.
//
// HONEST LIMIT. This is ONE installation profile. A family the installer appends only on some other
// path — a different flag, an upgrade branch, a second .gitignore — is not observed here, and the
// count floor below would still be satisfied. This check pins the profile it runs; it is not proof
// that no unnamed family can exist.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the kit's own .gitignore names every family the installer appends to an adopter's", () => {
  // One scratch root, so a failure anywhere leaves exactly one directory to remove.
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kit-ignores-"));
  try {
    const adopter = path.join(scratch, "adopter");
    const codexDir = path.join(scratch, "codex-prompts");
    const emptyConfig = path.join(scratch, "gitconfig");
    writeFileSync(emptyConfig, "");
    const env = Object.fromEntries([
      ...Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
      ["GIT_CONFIG_GLOBAL", emptyConfig],
      ["GIT_CONFIG_SYSTEM", emptyConfig],
    ]);
    execFileSync("git", ["init", "-q", adopter], { env });
    const run = spawnSync(process.execPath, [
      path.join(KIT, "bin", "init.mjs"),
      "--target", adopter, "--repo-name", "adopter",
      "--codex-prompts-dir", codexDir, "--with-gate-runners",
    ], { encoding: "utf8", env });
    assert.equal(run.status, 0,
      `the installer must run for this check to learn anything; it exited ${run.status}:\n${run.stderr}`);

    // Every non-comment line the installer left in a .gitignore that had none.
    const appended = readFileSync(path.join(adopter, ".gitignore"), "utf8")
      .split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    // Fail closed. A rung that governs nothing is never a pass: if the installer stopped appending,
    // or wrote somewhere this check does not read, an empty list would otherwise be a green.
    assert.ok(appended.length >= 5,
      `the installer appended only ${appended.length} paths (${appended.join(", ")}) to a scratch ` +
      `adopter — expected the lane declaration, the ledger, the rung sidecar, the metrics dir and ` +
      `the per-checkout Codex registration at minimum. Read this as a broken observation first and ` +
      `a shortened installer list second.`);

    const own = readFileSync(path.join(KIT, ".gitignore"), "utf8")
      .split(/\r?\n/).map((line) => line.trim());
    const missing = appended.filter((p) => !own.includes(p));
    assert.deepEqual(missing, [],
      `the installer appends ${missing.join(", ")} to an ADOPTER's .gitignore, and the kit's own ` +
      `.gitignore does not name ${missing.length === 1 ? "it" : "them"}. The blanket .claude/ rule ` +
      `may already ignore the path here — that is exactly the blindness this check exists for, ` +
      `because it makes the kit's tree a place where "this file is untracked" is true for a reason ` +
      `no adopter shares. Add ${missing.length === 1 ? "the line" : "the lines"} to .gitignore with ` +
      `the reason.`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
