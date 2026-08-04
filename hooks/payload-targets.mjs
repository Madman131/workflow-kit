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
//   1. `--project-dir` argv — what the registration this repo generated says, baked in at install
//      time and therefore not forgeable from a payload.
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

// WHAT DO RELATIVE PATCH PATHS RESOLVE AGAINST? Not necessarily the repo root — and conflating the
// two is a fail-open. `resolveProjectRoot` answers "which repo am I guarding" (where the declaration
// and ledger live, and what counts as inside). This answers a DIFFERENT question: the applier
// resolves a relative path in the envelope against ITS OWN working directory, which the payload
// reports as `cwd`. Those diverge whenever a session runs in a SUBDIRECTORY of the repo — an
// ordinary monorepo case needing no attacker at all: the guard would evaluate `<repo>/src/x.mjs`
// while the applier writes `<repo>/packages/foo/src/x.mjs`, a path nothing checked. (Found by the
// adversarial review seat, which demonstrated it reaching an out-of-repo location through a symlink.)
//
// Using the payload's `cwd` as the resolution base is also the FAIL-CLOSED choice, which is why it
// is safe to take it from the payload: if `cwd` pointed somewhere outside the repo, every relative
// target resolves outside too — and an out-of-repo target is exactly what guard-cross-repo-writes
// DENIES. A forged `cwd` therefore blocks the write; it does not smuggle one past.
export function resolvePatchBase(input, projectRoot) {
  const cwd = input?.cwd;
  return typeof cwd === "string" && cwd ? path.resolve(cwd) : projectRoot;
}

/**
 * A write target as a repo-relative POSIX path, or null when it lands outside the repo.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN PER CONSUMER. Any rule that compares a target against
 * canonical paths (`core/WORKFLOW.md`, `.agents/skills/…`, `githooks/pre-commit`) must canonicalise
 * it first, and skipping that fails SILENTLY: a perfectly ordinary `./core/WORKFLOW.md` matches no
 * canonical entry, so a sensor exits 0 having said nothing — a miss that looks exactly like "nothing
 * was owed". Found by a cross-family seat against the v2.2.0 sensors, reproduced in one call.
 * It lives here, beside the extractor that produces those targets, so the two sensors cannot drift.
 */
export function toRepoRelative(target, root, base) {
  if (typeof target !== "string" || !target) return null;
  const abs = path.isAbsolute(target) ? target : path.resolve(base, target);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..")) return null;
  return rel.split(path.sep).join("/");
}

// Directives that NAME A TARGET.
//
// LEADING WHITESPACE IS PART OF THE DIRECTIVE, and getting this wrong was a real fail-open. Codex's
// own patch parser TRIMS each line before classifying it as a header, so `␠*** Add File: x` IS a
// directive to the applier. A first cut here anchored on `^\*\*\* ` at column 0, which meant an
// indented directive was read as hunk CONTENT and its target silently dropped from the list — while
// Codex went on to write the file. That is the exact shape this guard exists to prevent: an envelope
// that parses clean and touches a path nobody gated. Found by the cross-family review seat and
// corroborated against the shipped CLI's own patch grammar.
//
// So the rule is: match what the APPLIER matches. Leading whitespace is stripped before the test;
// any other prefix is not. That still keeps a payload line like `+*** Add File: evil.txt` as
// CONTENT — `+` is not whitespace — so a patch that merely quotes patch syntax does not gate a
// phantom path. Both directions are pinned by test.
const DIRECTIVE_RE = /^\*\*\* (Add File|Update File|Delete File|Move to): ?(.*)$/;
// Directives that are real grammar but name NO target. Both are in the shipped CLI's patch
// vocabulary. Treating them as "unknown" would fail CLOSED on a perfectly legal patch — safe in
// direction but a brick, and a control that blocks legitimate work is a control someone turns off
// (the frustrated-adopter failure mode this kit takes seriously).
const NON_TARGET_DIRECTIVE_RE = /^\*\*\* (?:End of File|Environment ID:.*)$/;
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
  // A line terminator this parser does not split on, but some line-splitter somewhere might, is a
  // way to hide a directive inside what we read as one opaque content line — the target would never
  // reach the list while an applier that DID split there would write the file. Rather than guess
  // which splitters agree with us, refuse the envelope: "cannot fully account for it" is the same
  // rule every other unparseable shape gets here, and these characters have no business in a patch.
  if (/[\u2028\u2029]/.test(command) || /\r(?!\n)/.test(command)) {
    return fail("apply_patch", "the patch envelope contains a line terminator this guard does not split on (U+2028, U+2029, or a lone CR), so a directive could be hidden inside a line it reads as content");
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
    // trimStart, not trim: the applier ignores INDENTATION when classifying a header, so we must
    // too or an indented directive's target vanishes from this list while the file still gets
    // written. A `+`/`-` prefix is not whitespace and still marks the line as hunk content.
    const line = lines[i].trimStart();
    if (!line.startsWith("*** ")) continue;              // hunk content — prefixed, never a directive
    if (NON_TARGET_DIRECTIVE_RE.test(line.trimEnd())) continue;   // real grammar, names no path
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
