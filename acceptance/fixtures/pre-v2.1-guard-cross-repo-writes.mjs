// RETAINED FIXTURE — the PRE-v2.1 guard-cross-repo-writes.mjs, verbatim.
//
// PROVENANCE (reproducible): `git show dbe14a1:hooks/guard-cross-repo-writes.mjs`, where dbe14a1 is
// the v2.0.0 release commit. Extracted, never hand-edited. It exists so the claim "v2.1 changes no
// Claude-lane decision except on payload shapes the harness cannot produce" is a RECEIPT that runs,
// not an assertion: tests/kit-controls.test.mjs executes this file and the shipped guard side by
// side over one corpus and compares every decision. Do not "fix" anything in here — its value is
// being exactly what shipped.

// Claude Code PreToolUse hook: block file-writing tools outside this repo.
//
// WHY THIS EXISTS (2026-06-11): a sibling-repo thread (research-tool-v2) ran
// with a shared parent-directory grant and overwrote a file in THIS repo
// (docs/journal/Project_Review_Fable5_2026-06-10.md) with its own content.
// Working-tree only — caught before commit — but only because the diff was
// read before trusting it. This hook makes the harness enforce the boundary.
//
// Allowed write roots:
//   - this project directory (CLAUDE_PROJECT_DIR, falling back to cwd)
//   - ~/.claude/**            (auto-memory + Claude config live here)
//   - /tmp, /private/tmp      (scratch; selftests use Bash subprocesses anyway)
// Everything else → permissionDecision "deny" with an explanatory reason.
//
// Scope note: this guards the Write/Edit/MultiEdit/NotebookEdit TOOLS — the
// realistic cross-repo failure mode. Bash redirection is not covered (Bash has
// its own permission flow). To intentionally write elsewhere: use Bash with
// explicit user approval, or temporarily disable in .claude/settings.json.

import path from "node:path";
import os from "node:os";

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const target = input?.tool_input?.file_path || input?.tool_input?.notebook_path;
  if (!target) process.exit(0);

  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const abs = path.resolve(projectRoot, String(target));
  const roots = [
    projectRoot,
    path.join(os.homedir(), ".claude"),
    "/tmp",
    "/private/tmp"
  ];
  const within = (root) => abs === root || abs.startsWith(root + path.sep);
  if (roots.some(within)) process.exit(0);

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Cross-repo write blocked by ${projectRoot}/.claude/hooks/guard-cross-repo-writes.mjs: ` +
        `target ${abs} is outside this repo (allowed: project dir, ~/.claude, /tmp). ` +
        `This guard exists because a sibling-repo thread once overwrote files here (2026-06-11). ` +
        `If this write is genuinely intended, use a Bash command (explicit user approval) or ask Josh ` +
        `to temporarily disable the hook in .claude/settings.json.`
    }
  }));
  process.exit(0);
});
