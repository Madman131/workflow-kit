// PreToolUse write guard: block file-writing tools outside this repo. BOTH LANES — registered on
// Write|Edit|MultiEdit|NotebookEdit in the Claude lane and on apply_patch in the Codex lane, from
// ONE file that branches on payload shape (see payload-targets.mjs).
//
// WHY THIS EXISTS (2026-06-11): a sibling-repo thread (research-tool-v2) ran with a shared
// parent-directory grant and overwrote a file in THIS repo with its own content. Working-tree only
// — caught before commit — but only because the diff was read before trusting it. This hook makes
// the harness enforce the boundary.
//
// Allowed write roots:
//   - this project directory (CLAUDE_PROJECT_DIR, falling back to cwd)
//   - ~/.claude/**            (auto-memory + Claude config live here)
//   - /tmp, /private/tmp      (scratch; selftests use Bash subprocesses anyway)
//   - every absolute path listed in `.claude/kit.config.json` `worktreeRoots` (adopter-declared)
// Everything else → permissionDecision "deny" with an explanatory reason.
//
// WHY `worktreeRoots` EXISTS (2026-09-03, found by adopting v2.26.0 into a repo whose worktrees do
// not live under /tmp). The method sends substantial concurrent work into a PRIVATE WORKTREE, and
// this guard hard-coded the two scratch roots as the only places one could sit. An adopter who keeps worktrees
// anywhere else got a session that could not write its OWN worktree with the file tools — so the
// portable doctrine and the shipped control contradicted each other, and the entry stubs had to
// carry the contradiction. The root set is now DATA the adopter declares, exactly the
// `executedPathDirs` seam: the MECHANISM is copied verbatim and only `.claude/kit.config.json` is
// per-repo. Absent config ⇒ the shipped roots alone. Present-but-corrupt ⇒ DENY — a widened
// allowlist that cannot be read must never fall back to a set the adopter did not choose.
//
// THE NO-TARGET BRANCH CHANGED POLARITY AT v2.1, and that is the point of this file. It used to
// read `if (!target) process.exit(0)` — harmless in the Claude lane, where a write tool always
// carries a `file_path`, and a total fail-open in the Codex lane, where NO write ever does: every
// apply_patch envelope landed in that branch, so an installed, healthy-looking guard permitted
// every cross-repo write. The one predicate is now three named classes (payload-targets.mjs):
// extractable ⇒ gate every target · write-shaped-but-unextractable ⇒ DENY · no write intent ⇒
// exit 0. Each class is pinned by a mutation-proven test, and the Claude lane's decisions are
// unchanged on every payload the harness actually produces (side-by-side receipt in the suite).
//
// AN ENVELOPE IS ATOMIC AND SO IS THIS DECISION: one apply_patch call can name several paths, and
// a deny on ANY of them denies the call. Gating only the first target would leave the rest
// unguarded, which is the fail-open a multi-target payload is built to exploit.
//
// SCOPE, UNCHANGED AND WORTH RE-READING IN THE CODEX LANE: this guards write TOOLS. A write issued
// through a plain SHELL command is not covered — and in the Codex lane that is a main road, not a
// corner case (the kit's PORTABILITY.md § The enforcement asymmetry, in the workflow-kit repository). Treat this as a tripwire; the
// `.githooks/pre-commit` floor is what binds every lane.

import path from "node:path";
import os from "node:os";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractTargets, resolvePatchBase, resolveProjectRoot } from "./payload-targets.mjs";

const KIT_CONFIG = path.join(".claude", "kit.config.json");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
// ABSOLUTE paths, not path segments — the sibling families (`executedPathDirs`, `briefPathDirs`)
// name directories INSIDE the repo, while a worktree root names a place OUTSIDE it. A relative
// entry would resolve against whatever cwd the harness happened to hand this hook, which is the
// same wrong-base fail-open `resolvePatchBase` exists to stop, so it is REFUSED rather than guessed.
function isAbsolutePathArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && path.isAbsolute(s));
}
// Absent config ⇒ the shipped roots only (a legitimate minimal state). Present-but-corrupt ⇒
// { ok:false } so the handler DENIES. Same lstat-before-read discipline as guard-lane-authoring's
// loader, and for the same two reasons: a permission/IO error means the file EXISTS but cannot be
// read (cannot-read-input ⇒ abstain, never green), and a SYMLINKED config is config injection that
// must not read as "absent".
function loadWorktreeRoots(projectRoot) {
  const file = path.join(projectRoot, KIT_CONFIG);
  let st;
  try { st = lstatSync(file); }
  catch (e) {
    if (e && e.code === "ENOENT") return { ok: true, worktreeRoots: [] };
    return { ok: false };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { return { ok: false }; }
  if (!isPlainObject(parsed)) return { ok: false };
  const declared = parsed.worktreeRoots === undefined ? [] : parsed.worktreeRoots;
  if (!isAbsolutePathArray(declared)) return { ok: false };
  // Every other key is deliberately NOT validated here: a field this hook does not read cannot make
  // this hook fail open. Structural corruption (handled above) still fails closed.
  return { ok: true, worktreeRoots: declared };
}

const SELF = fileURLToPath(import.meta.url);   // names the RUNNING file, so the message is lane-correct

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  // UNREADABLE INPUT IS AN UNREADABLE WRITE. This line used to `process.exit(0)` — the very
  // "cannot read it ⇒ permit it" shape the rest of this file was rewritten to eliminate, left
  // untouched at the outermost parse because the rewrite never looked above the target extraction.
  // Its sibling guard has denied on this input for releases (`malformed-hook-input`), so the two
  // controls on the same matcher disagreed about the same bytes, and only the sibling's deny kept
  // the pair honest. Empty stdin is still not an error: it parses as `{}` and
  // falls through to "no write intent" exactly as before.
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    deny(
      `Write blocked by ${SELF}: the hook input could not be parsed as JSON, so this guard cannot ` +
      `tell what is being written or where. It fails CLOSED rather than permitting a write it never ` +
      `read. If a harness is sending a payload shape this guard does not understand, report it — do ` +
      `not disable the guard.`
    );
  }

  const result = extractTargets(input);
  // WRITE-SHAPED BUT UNREADABLE ⇒ DENY. Narrow by construction: it needs an `apply_patch` tool name
  // or a path key that is present and unusable. A payload with no write intent never reaches here.
  if (!result.ok) {
    deny(
      `Write blocked by ${SELF}: this payload is a WRITE but its target could not be determined — ` +
      `${result.reason}. This guard fails CLOSED on a write it cannot read, because the alternative ` +
      `is permitting a write to a path nothing checked. If this is a legitimate patch shape this ` +
      `guard does not understand, report it rather than disabling the guard.`
    );
  }
  if (result.shape === "none") process.exit(0);          // no write intent — unchanged behavior

  const projectRoot = resolveProjectRoot(input);
  const config = loadWorktreeRoots(projectRoot);
  if (!config.ok) {
    deny(
      `Write blocked by ${SELF}: ${path.join(projectRoot, KIT_CONFIG)} is present but MALFORMED (not ` +
      `valid JSON, not an object, symlinked, unreadable, or \`worktreeRoots\` is not an array of ` +
      `non-empty ABSOLUTE paths). This guard reads that file for the adopter's declared worktree ` +
      `roots, so it fails CLOSED rather than gate against a root set it could not read. Fix that ` +
      `file with a SHELL command (this guard binds write TOOLS, not the shell), delete it to fall ` +
      `back to the kit's shipped roots, or re-run \`node bin/init.mjs --worktree-roots <abs>,<abs>\`.`
    );
  }
  const roots = [
    projectRoot,
    path.join(os.homedir(), ".claude"),
    "/tmp",
    "/private/tmp",
    // The adopter's declared worktree roots. path.resolve normalises a trailing separator, which the
    // prefix test below would otherwise turn into a root that matches nothing.
    ...config.worktreeRoots.map((r) => path.resolve(r)),
  ];
  const within = (root, abs) => abs === root || abs.startsWith(root + path.sep);

  // A RELATIVE target resolves against the APPLIER's working directory, not against the repo root —
  // they differ whenever the session runs in a subdirectory. Resolving against the wrong base checks
  // a path that will never be written while the real one goes unchecked.
  const patchBase = resolvePatchBase(input, projectRoot);
  const outside = [];
  for (const target of result.targets) {
    const abs = path.resolve(patchBase, String(target));
    if (!roots.some((root) => within(root, abs))) outside.push(abs);
  }
  if (!outside.length) process.exit(0);

  deny(
    `Cross-repo write blocked by ${SELF}: ` +
    `${outside.length === 1 ? `target ${outside[0]} is` : `${outside.length} of ${result.targets.length} targets are`} ` +
    // This list reads as exhaustive and the remediation below is built on it, so it must name every
    // entry of the `roots` array above. It omitted /private/tmp, which is where a macOS adopter's
    // /tmp worktree actually resolves — sending them to relocate a worktree the guard already allows.
    `outside this repo (allowed: project dir, ~/.claude, /tmp, /private/tmp${config.worktreeRoots.length ? `, plus the ${config.worktreeRoots.length} declared worktreeRoots` : ""})${outside.length === 1 ? "" : ` — ${outside.join(", ")}`}. ` +
    `This guard exists because a sibling-repo thread once overwrote files here (2026-06-11). ` +
    `A patch envelope is applied as a unit, so one out-of-repo target denies the whole call. ` +
    `If this write is genuinely intended, use a shell command (explicit user approval), declare the ` +
    `root in \`.claude/kit.config.json\` \`worktreeRoots\` (\`init --worktree-roots <abs>\`) when it is a ` +
    `worktree of THIS repo, or ask the Owner to temporarily disable the hook in the registration for ` +
    `your lane.`
  );
});
