// workflow-kit — payload-targets.mjs. The ONE write-target extractor, shared by both write guards
// and by BOTH LANES. It is not itself a hook: it is registered nowhere and decides nothing.
//
// WHY IT EXISTS. A Claude write names its target in `tool_input.file_path`. A CODEX write does not
// have a `file_path` key at all — it is `tool_name: "apply_patch"` whose `tool_input.command` is a
// PATCH ENVELOPE that can carry MANY targets in one call. Ported unchanged into the Codex lane, the
// kit's write guards took their no-target branch: `guard-cross-repo-writes` ALLOWED EVERYTHING (an
// installed control that silently permits) and `guard-lane-authoring` denied every write including
// docs. Both failures are the same root cause — a guard reading a payload shape that never arrives.
//
// THE SEAM IS A RUNTIME BRANCH ON PAYLOAD SHAPE, NOT A PER-LANE COPY OF THE GUARD. One file installs
// to `.claude/hooks/` and `.codex/hooks/` byte-identically (pinned by an installed-tree equality
// test), so the two lanes cannot drift the way the origin repo's `.codex` hooks drifted from their
// `.claude` twins — 48 hours apart, in the dangerous direction, unnoticed because nothing compared
// them. Drift here is not policed; it is structurally impossible.
//
// THE THREE CLASSES, and why the middle one is a POLARITY CHANGE. Callers must be able to tell
// "there is no write here" from "there is a write here and I could not read it":
//
//   extractable             → { ok: true,  shape: "claude"|"apply_patch", targets: [...] }  ⇒ GATE each
//   write-shaped, unreadable→ { ok: false, shape, reason }                                  ⇒ DENY
//   no write intent         → { ok: true,  shape: "none", targets: [] }                     ⇒ exit 0
//
// `guard-cross-repo-writes` previously collapsed the last two: `if (!target) process.exit(0)`. In
// the Claude lane that is invisible, because a Write/Edit call always carries a `file_path`. In the
// Codex lane it is the whole ballgame — EVERY apply_patch write lands in that branch, so the guard
// permits every cross-repo write while appearing installed and healthy. Fail-closed on an
// unreadable write is the correct direction, and it is narrow BY CONSTRUCTION: it fires only when
// the payload is positively write-shaped (an `apply_patch` tool name, or a path key that is present
// but not a usable string). A payload with no write intent still exits 0 and always did.
//
// ENVELOPE PARSING IS FAIL-CLOSED. An envelope this parser cannot fully account for — unterminated,
// unknown directive, empty path, no targets at all — is `ok: false`, never a best-effort subset. A
// parser that returns the targets it happened to understand and drops the rest is a fail-open with
// extra steps: the dropped target is exactly the one an attacker puts last.

import path from "node:path";

// WHICH TREE AM I GUARDING? The Claude harness sets CLAUDE_PROJECT_DIR; Codex does not set it or
// anything like it. Getting this wrong is not a cosmetic error — a root that does not match the tree
// makes in-repo paths resolve as OUTSIDE the repo, which guard-lane-authoring skips, so a wrong root
// is a FAIL-OPEN. So the answer is passed EXPLICITLY by the generated `.codex/hooks.json`
// (`--project-dir <abs>`) and never guessed when it can be told.
//
// Precedence, most trustworthy first, each step documented because each is a different kind of claim:
//   1. `--project-dir` argv — what the registration this repo generated says. Deterministic, and it
//      does not depend on the command string being handed to a shell (an assumption about Codex's
//      executor that this kit has NOT verified by execution, so nothing here rests on it).
//   2. CLAUDE_PROJECT_DIR — the Claude harness's own answer.
//   3. the payload's `cwd` — the harness's answer for a hand-written registration that passes
//      neither. Ranked last of the informative sources deliberately: it arrives in the same payload
//      the guard is inspecting.
//   4. process.cwd() — the pre-v2.1 fallback, kept so nothing that worked before stops working.
export function resolveProjectRoot(input, argv = process.argv.slice(2)) {
  const i = argv.indexOf("--project-dir");
  const fromArgv = i !== -1 ? argv[i + 1] : undefined;
  if (typeof fromArgv === "string" && fromArgv) return path.resolve(fromArgv);
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  if (typeof input?.cwd === "string" && input.cwd) return path.resolve(input.cwd);
  return path.resolve(process.cwd());
}

// Directives that NAME A TARGET. Codex's envelope is line-oriented; a directive occupies a whole
// line starting at column 0. Content lines inside a hunk are prefixed (`+`, `-`, ` `, `@@`), which
// is what keeps a payload line like `+*** Add File: evil.txt` from being read as a directive: it is
// added CONTENT, and the `^\*\*\* ` anchor below does not match it. That asymmetry is deliberate and
// is pinned by test in both directions — a parser that matched `*** Add File:` anywhere in the line
// would gate a phantom path on every patch that merely quotes one.
const DIRECTIVE_RE = /^\*\*\* (Add File|Update File|Delete File|Move to): ?(.*)$/;
const BEGIN = "*** Begin Patch";
const END = "*** End Patch";

function fail(shape, reason) { return { ok: false, shape, reason, targets: [] }; }

// Parse ONE apply_patch envelope into every path it touches.
//
// `*** Move to:` CONTRIBUTES BOTH ENDPOINTS. The enclosing `*** Update File:` names the SOURCE and
// the `Move to` names the DESTINATION, and a rename can carry a file OUT of a gated directory just
// as well as into one — so gating only the source is a fail-open, and gating only the destination
// misses the file leaving. Both are targets. (Captured multi-target fixture:
// acceptance/fixtures/codex-payload-samples.mjs.)
export function parseApplyPatchEnvelope(command) {
  if (typeof command !== "string" || !command.trim()) {
    return fail("apply_patch", "the apply_patch payload carries no `command` string to parse");
  }
  const lines = command.split(/\r?\n/);
  // Leading/trailing blank lines are tolerated; anything else outside the markers is not. An
  // envelope whose markers are missing is NOT a patch we understand, and a guard must not guess.
  let start = 0, end = lines.length - 1;
  while (start < lines.length && !lines[start].trim()) start++;
  while (end >= 0 && !lines[end].trim()) end--;
  if (start > end || lines[start].trim() !== BEGIN) {
    return fail("apply_patch", `the patch envelope does not open with "${BEGIN}"`);
  }
  if (lines[end].trim() !== END) {
    return fail("apply_patch", `the patch envelope is UNTERMINATED — no closing "${END}"`);
  }

  const targets = [];
  let lastUpdateSource = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (!line.startsWith("*** ")) continue;              // hunk content — prefixed, never a directive
    const m = DIRECTIVE_RE.exec(line);
    if (!m) {
      // An unknown `*** …` directive means this Codex version speaks a dialect this parser does
      // not. Skipping it would silently drop whatever target it names.
      return fail("apply_patch", `unknown patch directive ${JSON.stringify(line.trim())} — this guard cannot account for every target in the envelope`);
    }
    const [, kind, rawPath] = m;
    const target = rawPath.trim();
    if (!target) return fail("apply_patch", `the "${kind}" directive names no path`);
    if (kind === "Move to") {
      // A destination with no source is a shape this parser does not understand. Fail closed rather
      // than gate half a rename.
      if (lastUpdateSource === null) {
        return fail("apply_patch", `a "*** Move to:" directive appeared with no preceding "*** Update File:" to name its source`);
      }
      lastUpdateSource = null;                            // one destination per source
    } else {
      lastUpdateSource = kind === "Update File" ? target : null;
    }
    targets.push(target);
  }

  // An envelope that names nothing is write-shaped and unreadable, not "no write intent". Returning
  // an empty allow here is precisely the branch that made the ported guard permit everything.
  if (!targets.length) return fail("apply_patch", "the patch envelope names no target path");
  // Dedupe, preserving first-seen order: the ledger records ONE ROW PER TARGET, and a path named
  // twice in one envelope is still one target.
  return { ok: true, shape: "apply_patch", targets: [...new Set(targets)] };
}

// The single entry point. `shape: "none"` is the ONLY result that means "no write here".
export function extractTargets(input) {
  const toolInput = input?.tool_input;

  if (input?.tool_name === "apply_patch") {
    return parseApplyPatchEnvelope(toolInput?.command);
  }

  const filePath = toolInput?.file_path;
  const notebookPath = toolInput?.notebook_path;
  // ABSENT is not the same as PRESENT-BUT-UNUSABLE. `undefined` on both keys with no apply_patch
  // tool name is a payload with no write intent (exit 0, exactly as before). A key that is present
  // but is not a non-empty string is a write whose target we cannot read — fail closed.
  if (filePath === undefined && notebookPath === undefined) {
    return { ok: true, shape: "none", targets: [] };
  }
  const target = typeof filePath === "string" && filePath
    ? filePath
    : typeof notebookPath === "string" && notebookPath
      ? notebookPath
      : null;
  if (target === null) {
    return fail("claude", "a write-tool payload carries a file_path/notebook_path key that is not a usable path string");
  }
  return { ok: true, shape: "claude", targets: [target] };
}
