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
// Everything else → permissionDecision "deny" with an explanatory reason.
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
// corner case (PORTABILITY.md § The enforcement asymmetry). Treat this as a tripwire; the
// `.githooks/pre-commit` floor is what binds every lane.

import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { extractTargets, resolveProjectRoot } from "./payload-targets.mjs";

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
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); }

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
  const roots = [
    projectRoot,
    path.join(os.homedir(), ".claude"),
    "/tmp",
    "/private/tmp",
  ];
  const within = (root, abs) => abs === root || abs.startsWith(root + path.sep);

  const outside = [];
  for (const target of result.targets) {
    const abs = path.resolve(projectRoot, String(target));
    if (!roots.some((root) => within(root, abs))) outside.push(abs);
  }
  if (!outside.length) process.exit(0);

  deny(
    `Cross-repo write blocked by ${SELF}: ` +
    `${outside.length === 1 ? `target ${outside[0]} is` : `${outside.length} of ${result.targets.length} targets are`} ` +
    `outside this repo (allowed: project dir, ~/.claude, /tmp)${outside.length === 1 ? "" : ` — ${outside.join(", ")}`}. ` +
    `This guard exists because a sibling-repo thread once overwrote files here (2026-06-11). ` +
    `A patch envelope is applied as a unit, so one out-of-repo target denies the whole call. ` +
    `If this write is genuinely intended, use a shell command (explicit user approval) or ask the ` +
    `Owner to temporarily disable the hook in the registration for your lane.`
  );
});
