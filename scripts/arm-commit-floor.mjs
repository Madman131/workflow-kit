#!/usr/bin/env node
// workflow-kit — arm THIS repository's own every-lane commit floor.
//
// FM1, turned on the kit itself: `core.hooksPath` is LOCAL git config, never tracked, so a fresh
// clone of this repository has it UNSET and git looks in `.git/hooks/` — where the kit's tracked
// `githooks/pre-commit` is not. The floor is then silently absent, which is the one failure mode
// the floor exists to prevent. Nothing tracked could fix that, so this script is tracked and npm
// runs it as `prepare` on `npm install`.
//
// It is BEST-EFFORT by design: every state it can detect — no checkout, no git, a checkout nested
// inside a larger repository, a hooks directory somebody else configured, a refused write — is
// reported and returns 0, because failing `npm install` over a git setting would be a worse outcome
// than an unarmed floor. (Only an error the process cannot report at all, such as a broken stdout,
// escapes that; there is nothing useful to do about it here.)
//
// The ASSERTION lives in `tests/kit-commit-floor.test.mjs`, which goes RED whenever the floor is not
// armed — so a state this script could not reach is loud at the next `npm test` rather than silent.

import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = "githooks";
const HOOK_FILE = "pre-commit";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function note(message) {
  process.stdout.write(`arm-commit-floor: ${message}\n`);
}

function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// The configured value EXACTLY as git stores it, with ONLY the single "\n" git appends to its own
// output removed — not `\r\n`, because a carriage return at the end of the value is part of the
// value and git keeps it. Trimming is a lie in the one direction that matters: a stored "githooks "
// or "githooks\r" finds no hook at all (measured: the commit succeeds, and `git hook run` says it
// cannot find a hook), while a trimmed read reports the floor as armed. Whitespace here is a dead
// floor, not a formatting detail.
function hooksPath() {
  try { return git(["config", "--get", "core.hooksPath"]).replace(/\n$/, ""); } catch { return ""; }
}

// What git itself makes of that value as a PATH: `--path` performs the `~` expansion git performs,
// so `~/hooks` is compared against the user's home directory rather than against a literal `~`
// directory under this checkout. It does not collapse `..`, which is exactly right — git does not
// either.
function hooksPathAsPath() {
  try { return git(["config", "--path", "--get", "core.hooksPath"]).replace(/\n$/, ""); } catch { return ""; }
}

function main() {
  const hook = path.join(ROOT, HOOK_DIR, HOOK_FILE);
  try {
    if (!statSync(hook).isFile()) throw new Error("not a file");
  } catch {
    note(`no ${HOOK_DIR}/${HOOK_FILE} beside this script — nothing to arm.`);
    return;
  }

  // Arm THIS repository or nothing. `git config` writes to whichever repository contains the cwd,
  // so an unguarded write from a checkout nested inside a LARGER repo (this package unpacked into
  // someone's `node_modules`, a vendored copy, a subdirectory adoption) would point THAT repo's
  // core.hooksPath at a `githooks/` it does not have — disarming a stranger's hooks to install
  // none of ours. `bin/init.mjs` refuses the same shape when it adopts a subdirectory.
  let top;
  try { top = git(["rev-parse", "--show-toplevel"]).trim(); }
  catch {
    note("not a git repository — the commit floor arms itself only in a checkout.");
    return;
  }
  let sameRepo = false;
  try { sameRepo = realpathSync(top) === realpathSync(ROOT); } catch { sameRepo = false; }
  if (!sameRepo) {
    note(`REFUSED: this package sits inside another git repository (${top}) — arming would point ` +
      `that repository at a ${HOOK_DIR}/ it does not have. Left untouched.`);
    return;
  }

  const before = hooksPath();
  if (before === HOOK_DIR) {
    note(`already armed: core.hooksPath=${HOOK_DIR} (the tracked ${HOOK_DIR}/${HOOK_FILE} runs on every commit).`);
    return;
  }

  // NEVER replace a hooks directory that is actually THERE. `npm install` is an ordinary,
  // unremarkable command; a deliberate `core.hooksPath` pointing at a real directory is somebody's
  // working configuration, possibly carrying controls this script knows nothing about, and in a
  // linked worktree the setting it would overwrite is shared with every other checkout of the
  // repository. This script exists to fill an EMPTY slot — unset, or naming a directory that is not
  // there, which is the state that silently disables hooks. Anything else is reported, not taken.
  if (before) {
    // Taken through git's own path interpretation, then joined WITHOUT normalisation and
    // deliberately not through `path.resolve`. git stores the
    // value literally, so `githooks/nonexistent/..` is a directory git cannot find while
    // `path.resolve` collapses it to one that exists — normalising here would read a dead
    // configuration as a live one and refuse to fix exactly the state this script is for. Letting
    // the OS walk the path segment by segment gives git's answer, not a tidied one.
    const asPath = hooksPathAsPath() || before;
    const literal = path.isAbsolute(asPath) ? asPath : `${ROOT}/${asPath}`;
    let present = false;
    try { present = statSync(literal).isDirectory(); } catch { present = false; }
    if (present) {
      note(`LEFT ALONE: core.hooksPath is already "${before}", a directory that exists — this script ` +
        `never replaces a working hooks configuration. To run the kit's own commit floor instead, ` +
        `run: git config core.hooksPath ${HOOK_DIR}`);
      return;
    }
  }

  try { git(["config", "core.hooksPath", HOOK_DIR]); }
  catch { /* fall through to the read-back, which reports the real state */ }

  // Certify by asking git, never by trusting the write.
  const after = hooksPath();
  if (after !== HOOK_DIR) {
    note(`COULD NOT ARM the commit floor (core.hooksPath is ${after ? `"${after}"` : "unset"}). ` +
      `Run: git config core.hooksPath ${HOOK_DIR}`);
    return;
  }
  note(before
    ? `armed: core.hooksPath ${before} -> ${HOOK_DIR}. The old value named a directory that is not ` +
      `there, so git was finding no hooks at all.`
    : `armed: core.hooksPath=${HOOK_DIR} — the tracked ${HOOK_DIR}/${HOOK_FILE} now runs on every commit.`);
}

try { main(); } catch (e) {
  note(`skipped (${e && e.message ? e.message : "unexpected error"}). Run: git config core.hooksPath ${HOOK_DIR}`);
}
