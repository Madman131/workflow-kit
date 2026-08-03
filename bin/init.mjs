#!/usr/bin/env node
// workflow-kit — init.mjs. Adopt the kit into a target repo.
//
// WHAT IT DOES: copies the portable [P] method + controls into <target>, PARAMETERIZES the
// repo-specific families into .claude/kit.config.json (a [G] binding), GENERATES the [G] files
// (entry stubs, BINDINGS, REPO_INVARIANTS, SYSTEM_MAP, OWNER_COMMS) from templates with placeholders,
// installs the dual-lane SKILLS (one shared body under .agents/skills/, a thin shim per harness),
// MERGES the Claude Code hook registrations into .claude/settings.json — three PreToolUse guards plus
// the Stop-event Owner-comms SENSOR, which fails OPEN — and, crucially, installs the HARNESS-AGNOSTIC
// pre-commit hook and sets core.hooksPath, so a non-Claude lane still gets the strongest enforcement
// floor the kit can give it (see PORTABILITY.md).
//
// SAFETY: it refuses to overwrite an existing generated file without --force (except settings.json,
// which is MERGED, and .gitignore, which is APPENDED). init never writes hook SOURCE from parameters
// — the mechanism copies verbatim and only DATA (.claude/kit.config.json) is per-repo, so a mis-run
// cannot corrupt a control into failing open. The controls themselves fail CLOSED on a malformed
// config (blueprint § Phase 6).

import { execFileSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ONE predicate for "is the Owner-comms sensor armed?", imported from the hook that enforces it —
// never a second hand-kept copy here. A paraphrase drifted from the original once already and made
// init announce ARMED on repos where the hook was unconditionally dormant.
import { ownerContract } from "../hooks/guard-owner-comms.mjs";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The Codex prompt is USER-GLOBAL (Codex reads prompts from ~/.codex/prompts, not the repo). Default
// there, but NEVER hardcode it un-overridably — --codex-prompts-dir parameterizes it and
// --skip-codex-prompt opts out, so init can run hermetically (tests) and on machines with no Codex.
const DEFAULT_CODEX_PROMPTS_DIR = path.join(os.homedir(), ".codex", "prompts");
// Read once: it stamps the generated core/OWNER_COMMS.md and closes the post-run checklist.
const KIT_VERSION = readFileSync(path.join(KIT_ROOT, "VERSION"), "utf8").trim();

// Every flag this parser accepts. Used to reject a flag that appears where a VALUE was expected.
const KNOWN_FLAGS = new Set([
  "--help", "-h", "--target", "--repo-name", "--owner-name", "--remote-url", "--deploy-branch",
  "--source-dirs", "--risk-tokens", "--state-docs", "--memory-dir", "--with-gate-runners",
  "--codex-prompts-dir", "--skip-codex-prompt", "--force", "--print-package-scripts",
]);

function parseArgs(argv) {
  const out = { target: process.cwd(), deployBranch: "main", withGateRunners: false, force: false, printPackageScripts: false, help: false, codexPromptsDir: DEFAULT_CODEX_PROMPTS_DIR, skipCodexPrompt: false };
  const listVal = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // EVERY value-taking flag goes through this. A bare/trailing flag, an empty value, or a value
    // that is itself a flag is a clean exit(2) — never `path.resolve(undefined)` throwing a raw stack
    // trace, never a repo whose name is literally "--force" while the swallowed flag silently changes
    // overwrite semantics, and never `--codex-prompts-dir ""` resolving to the CWD and writing
    // "USER-GLOBAL" prompts into the repo root. Validating two flags and not their siblings is how
    // the second footgun survives the fix for the first, so this is uniform by construction.
    const next = () => {
      const v = argv[++i];
      // Reject a value that is a KNOWN FLAG (so `--target -h` cannot swallow the help flag and adopt
      // into a directory named "-h"), or any unrecognized `--long` form. Matching on the flag TABLE
      // rather than on a leading "-" is deliberate: a blanket dash rule also rejects a legitimate
      // `--source-dirs -generated`, which `isSegment()` accepts and which has no alternative spelling
      // because slashes are separately forbidden.
      if (v === undefined || !v.trim() || KNOWN_FLAGS.has(v) || v.startsWith("--")) {
        console.error(`init: ${a} requires a value, and it must not be another flag (got ${v === undefined ? "nothing" : JSON.stringify(v)})`);
        process.exit(2);
      }
      return v;
    };
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--target") out.target = path.resolve(next());
    else if (a === "--repo-name") out.repoName = next();
    else if (a === "--owner-name") {
      // Extra shape rules beyond non-empty: this value becomes the `## How to talk to <name> — Owner,
      // not a developer` heading that the Stop sensor parses. ANY line terminator splits that heading
      // — and JavaScript's `^`/`$` under /m break on U+2028/U+2029 too, not just CR/LF — so the sensor
      // would report as named-and-armed while never matching. A "{{" would read as still-unfilled.
      const v = next();
      if (/[\r\n\u2028\u2029]/.test(v) || v.includes("{{")) {
        console.error(`init: --owner-name requires a plain one-line name (got ${JSON.stringify(v)})`);
        process.exit(2);
      }
      out.ownerName = v.trim();
    }
    else if (a === "--remote-url") out.remoteUrl = next();
    else if (a === "--deploy-branch") out.deployBranch = next();
    else if (a === "--source-dirs") out.sourceDirs = listVal(next());
    else if (a === "--risk-tokens") out.riskTokens = listVal(next());
    else if (a === "--state-docs") out.stateDocs = listVal(next());
    else if (a === "--memory-dir") out.memoryDir = next();
    else if (a === "--with-gate-runners") out.withGateRunners = true;
    else if (a === "--codex-prompts-dir") out.codexPromptsDir = path.resolve(next());
    else if (a === "--skip-codex-prompt") out.skipCodexPrompt = true;
    else if (a === "--force") out.force = true;
    else if (a === "--print-package-scripts") out.printPackageScripts = true;
    else { console.error(`init: unknown argument ${JSON.stringify(a)} (try --help)`); process.exit(2); }
  }
  return out;
}

const HELP = `workflow-kit init — adopt the kit into a target repo.

Usage: node bin/init.mjs [--target <dir>] [options]

  --target <dir>          repo to adopt into (default: cwd)
  --repo-name <name>      fills the [G] templates' {{REPO_NAME}}
  --owner-name <name>     fills core/OWNER_COMMS.md's {{OWNER_NAME}} — the person the agent reports
                          to. Omitted ⇒ the placeholder stays and the Owner-comms Stop SENSOR stays
                          DORMANT (it allows unconditionally until the Owner is named)
  --remote-url <url>      fills {{REMOTE_URL}} (the identity fingerprint)
  --deploy-branch <b>     fills {{DEPLOY_BRANCH}} (default: main)
  --source-dirs a,b       repo-specific source-tree roots ⇒ kit.config.json executedPathDirs
  --risk-tokens a,b       DEPRECATED, accepted but IGNORED: the lane route was retired (v1.5.0), so
                          laneRiskTokens gates nothing and is no longer written; the flag will be
                          removed at v2.0
  --state-docs a,b        repo CLASS: STATE docs governed by doc:size ⇒ kit.config.json stateDocs
  --memory-dir <abs>      external memory dir for the --memory advisory ⇒ kit.config.json memoryDir
  --with-gate-runners     also copy the Codex/Gemini gate runner scripts (need codex/agy at runtime)
  --codex-prompts-dir <d> where the Codex prompts install — /thread-restart and the skill shims
                          (default: ~/.codex/prompts, USER-GLOBAL — outside the target repo;
                          parameterize it for a hermetic run)
  --skip-codex-prompt     do not install any Codex prompt (the Claude command, the Claude skill
                          shims, the shared skill bodies and the AGENTS.md pointer still install)
  --force                 overwrite existing generated files (settings.json is always merged)
  --print-package-scripts print the npm scripts to add to your package.json, then exit
  -h, --help              this help

Every family is OPTIONAL — omitted ⇒ the kit's portable defaults. See PORTABILITY.md for the
enforcement asymmetry (the PreToolUse hooks bind only the Claude Code lane; the pre-commit hook and
AGENTS.md prose are what bind every lane).`;

const PACKAGE_SCRIPTS = {
  "doc:size": "node scripts/check-doc-size.mjs",
  "test:kit-controls": "node --test tests/*.test.mjs",
};

function log(msg) { console.log(msg); }
function warn(msg) { console.warn(`  ! ${msg}`); }

function isPlainObject(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}
// Single non-empty path segment (no separators) — the shape the loaders' isSegmentArray requires.
function isSegment(s) { return typeof s === "string" && s.length > 0 && !s.includes("/") && !s.includes("\\"); }

function ensureDir(abs) { mkdirSync(abs, { recursive: true }); }

// Copy refusing to clobber unless force. Returns "written" | "skipped".
function copyGuarded(src, dst, force) {
  if (existsSync(dst) && !force) { warn(`exists, kept (use --force to overwrite): ${dst}`); return "skipped"; }
  ensureDir(path.dirname(dst));
  copyFileSync(src, dst);
  return "written";
}

// --force is GLOBAL and it is also the remedy init itself recommends for a stale hook ("re-run with
// --force to update"). That combination silently destroys hand-authored content in the `[G]` files —
// most painfully core/OWNER_COMMS.md, whose whole value is the paragraphs a human wrote about a
// person, and .claude/kit.config.json, whose loss quietly WIDENS the write guard back to defaults.
// Before overwriting a file whose content differs from what we are about to write, keep a .bak beside
// it and say so. Cheap, reversible, and it makes the documented upgrade path non-destructive.
// Returns "not-needed" (no existing file, or identical content) | "backed-up" | "FAILED".
// FAILED is load-bearing: the caller MUST NOT overwrite. A backup that silently does not happen is
// worse than no backup at all, because the console says the upgrade path is recoverable.
function backupBeforeOverwrite(dst, nextText) {
  if (!existsSync(dst)) return "not-needed";
  let current;
  // Unreadable but present: we cannot preserve it, so we must not destroy it either.
  try { current = readFileSync(dst, "utf8"); } catch { return "FAILED"; }
  if (current === nextText) return "not-needed";  // identical — nothing to preserve
  const bak = `${dst}.bak`;
  try { writeFileSync(bak, current); } catch { return "FAILED"; }
  warn(`OVERWROTE ${dst} (--force); your previous version is saved at ${bak}`);
  return "backed-up";
}

// Write `text` to `dst`, but never destroy differing content we failed to preserve. Returns whether
// the write happened, so callers report honestly rather than assuming.
function writeWithBackup(dst, text) {
  if (backupBeforeOverwrite(dst, text) === "FAILED") {
    warn(`REFUSED to overwrite ${dst}: its previous content could not be backed up (is ${dst}.bak writable?). The existing file is UNCHANGED — move it aside yourself, then re-run.`);
    return false;
  }
  ensureDir(path.dirname(dst));
  writeFileSync(dst, text);
  return true;
}

function copyTree(srcDir, dstDir, force, filter = () => true) {
  const results = [];
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) results.push(...copyTree(s, d, force, filter));
    else if (entry.isFile() && filter(entry.name, s)) results.push([d, copyGuarded(s, d, force)]);
  }
  return results;
}

function chmodX(abs) { try { chmodSync(abs, 0o755); } catch { /* best-effort */ } }

function fillTemplate(tmplPath, vars) {
  let text = readFileSync(tmplPath, "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  return text;
}

// Merge our three PreToolUse registrations into an existing settings.json, or create it.
function mergeSettings(targetSettings, kitSettings, force) {
  let existing = {};
  if (existsSync(targetSettings)) {
    try { existing = JSON.parse(readFileSync(targetSettings, "utf8")); }
    catch {
      if (!force) { warn(`existing ${targetSettings} is not valid JSON — left untouched (use --force to replace)`); return "skipped"; }
      existing = {};
    }
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) existing = {};
  }
  const kit = JSON.parse(readFileSync(kitSettings, "utf8"));
  // VALIDATE SHAPE, never trust it — a parseable-but-non-standard settings.json must not silently
  // swallow our registrations. `existing.hooks` as an ARRAY (or string/number) would take the
  // registrations as named properties that JSON.stringify DROPS → guards written to disk but never
  // registered (a silent fail-open). A non-array event bucket would crash `.find`. Reset any
  // non-standard shape to the expected type, loudly, and install ours.
  if (!isPlainObject(existing.hooks)) {
    if (existing.hooks !== undefined) warn(`existing ${targetSettings} had a non-standard "hooks" (${Array.isArray(existing.hooks) ? "array" : typeof existing.hooks}) — replacing it with the standard object shape so the guards register`);
    existing.hooks = {};
  }
  const dest = existing.hooks;
  for (const event of Object.keys(kit.hooks)) {
    if (!Array.isArray(dest[event])) {
      if (dest[event] !== undefined) warn(`existing ${targetSettings} "hooks.${event}" was not an array — replacing it`);
      dest[event] = [];
    }
    for (const group of kit.hooks[event]) {
      // Merge by matcher; dedupe hook entries by command string.
      let bucket = dest[event].find((g) => isPlainObject(g) && g.matcher === group.matcher);
      if (!bucket) { bucket = { matcher: group.matcher, hooks: [] }; dest[event].push(bucket); }
      if (!Array.isArray(bucket.hooks)) bucket.hooks = [];
      for (const h of group.hooks) {
        if (!bucket.hooks.some((x) => isPlainObject(x) && x.command === h.command)) bucket.hooks.push(h);
      }
    }
  }
  ensureDir(path.dirname(targetSettings));
  writeFileSync(targetSettings, JSON.stringify(existing, null, 2) + "\n");
  // Post-write self-check: confirm every registration we intended is actually present on disk, so a
  // future serialization surprise can never let init report success on an unprotected repo.
  const roundtrip = JSON.parse(readFileSync(targetSettings, "utf8"));
  for (const event of Object.keys(kit.hooks)) {
    for (const group of kit.hooks[event]) {
      for (const h of group.hooks) {
        const present = Array.isArray(roundtrip?.hooks?.[event]) &&
          roundtrip.hooks[event].some((g) => Array.isArray(g?.hooks) && g.hooks.some((x) => x?.command === h.command));
        if (!present) return "verify-failed";
      }
    }
  }
  return "written";
}

function appendGitignore(target, lines, comment = "workflow-kit: lane declaration + ledger are per-session, gitignored") {
  const gi = path.join(target, ".gitignore");
  let text = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l));
  if (!add.length) return "unchanged";
  if (text.length && !text.endsWith("\n")) text += "\n";
  text += (text.length ? "\n" : "") + `# ${comment}\n` + add.join("\n") + "\n";
  writeFileSync(gi, text);
  return "written";
}

// Append the /thread-restart fallback pointer to AGENTS.md if absent (idempotent via a stable marker,
// same shape as appendGitignore). The pointer text is a single [P] source (commands/agents-pointer.md)
// so the Claude command, the Codex prompt, and this pointer never drift. A re-run — or an AGENTS.md that
// already carries the marker — is a clean no-op, and the block is short enough to keep AGENTS.md (an
// 8 KiB-capped entry doc) well under cap.
function appendAgentsPointer(target, kitRoot) {
  const agents = path.join(target, "AGENTS.md");
  if (!existsSync(agents)) return "absent"; // init generates AGENTS.md before this runs; guard anyway
  const fragment = readFileSync(path.join(kitRoot, "commands", "agents-pointer.md"), "utf8");
  const marker = "workflow-kit:thread-restart-pointer";
  let text;
  try { text = readFileSync(agents, "utf8"); } catch { return "read-failed"; }
  if (text.includes(marker)) return "unchanged";
  if (text.length && !text.endsWith("\n")) text += "\n";
  text += "\n" + fragment.trimEnd() + "\n";
  // Failure-ISOLATED like the Codex-prompt write: a read-only / unwritable AGENTS.md (an adopter can
  // legitimately have one) must NOT abort a mostly-complete adopt after the load-bearing hooks +
  // commands + pre-commit have already installed. Warn-and-continue via the return; main() logs it.
  try { writeFileSync(agents, text); } catch { return "write-failed"; }
  return "written";
}

function gitConfig(target, key, value) {
  try {
    execFileSync("git", ["-C", target, "config", key, value], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch { return false; }
}

// Compare paths by realpath so the macOS /tmp -> /private/tmp symlink (where worktrees live) does not
// read as a spurious subdir mismatch. Falls back to path.resolve if realpath fails.
function realpathOrSelf(p) {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}

function isGitRepo(target) {
  try {
    execFileSync("git", ["-C", target, "rev-parse", "--git-dir"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch { return false; }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (args.printPackageScripts) { console.log(JSON.stringify(PACKAGE_SCRIPTS, null, 2)); return; }

  const T = args.target;
  const force = args.force;

  // Validate the repo-specific families UP FRONT (before writing anything). The loaders require single
  // path SEGMENTS for source dirs; a nested value like "app/server" would be written to
  // kit.config.json and then rejected as MALFORMED by every control — fail-closed but SILENT, the kind
  // of footgun that gets a frustrated adopter to disable the control (FM5). Catch it here, loudly.
  {
    const bad = (args.sourceDirs || []).filter((s) => !isSegment(s));
    if (bad.length) { console.error(`init: --source-dirs values must be single path segments (no "/"); got ${JSON.stringify(bad)}. The controls match top-level dirs — pass e.g. "app", not "app/server".`); process.exit(2); }
  }
  // DEPRECATED, not removed (removal is a breaking CLI change reserved for v2.0): the flag still
  // parses so an adopter's saved init invocation keeps working, but it configures nothing — the
  // `lane` route it parameterized was retired, so the family is no longer written. Loud, so nobody
  // believes a deny-set is armed when it gates nothing.
  if (args.riskTokens) {
    warn(`--risk-tokens is DEPRECATED and was IGNORED: the lane route was retired (kit v1.5.0), laneRiskTokens gates nothing and is no longer written to kit.config.json. This flag will be removed at v2.0.`);
  }
  const badState = (args.stateDocs || []).filter((s) => { const n = path.posix.normalize(s); return s.startsWith("/") || s.includes("\\") || n === ".." || n.startsWith("../"); });
  if (badState.length) { console.error(`init: --state-docs must be in-repo relative paths (no absolute, no escaping ".."); got ${JSON.stringify(badState)}.`); process.exit(2); }

  ensureDir(T);
  log(`workflow-kit init → ${T}`);
  const remaining = []; // generated files still carrying unfilled placeholders
  const remainingTokens = new Map(); // dst -> the specific placeholder names still unfilled

  // 1. [P] core method docs (verbatim).
  const core = copyTree(path.join(KIT_ROOT, "core"), path.join(T, "core"), force);
  log(`  core/ method docs: ${core.filter(([, s]) => s === "written").length} written, ${core.filter(([, s]) => s === "skipped").length} kept`);

  // 2. [P] Claude-lane hooks (verbatim mechanism): the three PreToolUse guards, which fail CLOSED,
  // plus the Stop-event Owner-comms SENSOR, which fails OPEN and is a nudge, not enforcement (see
  // PORTABILITY.md § the Owner-comms sensor). Report kept-vs-written honestly: a KEPT (existing) hook
  // may be STALE, so "installed" would over-claim (a control believed current but actually old).
  const hookFiles = readdirSync(path.join(KIT_ROOT, "hooks")).sort();
  let hooksKept = 0;
  for (const h of hookFiles) {
    const d = path.join(T, ".claude", "hooks", h);
    if (copyGuarded(path.join(KIT_ROOT, "hooks", h), d, force) === "written") chmodX(d); else hooksKept++;
  }
  log(hooksKept
    ? `  .claude/hooks/: ${hookFiles.length - hooksKept} installed, ${hooksKept} EXISTING kept — may be STALE; re-run with --force to update`
    : `  .claude/hooks/: ${hookFiles.length} hooks installed — PreToolUse guards (fail CLOSED) + the guard-owner-comms Stop sensor (fails OPEN)`);

  // 3. Harness-agnostic pre-commit hook + core.hooksPath (binds EVERY lane, not just Claude).
  const pc = path.join(T, ".githooks", "pre-commit");
  const kitPc = path.join(KIT_ROOT, "githooks", "pre-commit");
  const pcResult = copyGuarded(kitPc, pc, force);
  // `pcTrusted` = the every-lane floor is provably the kit's control. Written ⇒ trusted; kept ⇒ trusted
  // ONLY if its CONTENT matches the kit's. A kept-but-different hook (stale / a no-op) must NEVER be
  // reported as "binds every lane" — that is the assurance-manufacturing fail this kit exists to stop.
  let pcTrusted = pcResult === "written";
  if (pcResult === "written") chmodX(pc);
  else {
    let same = false;
    try { same = readFileSync(pc, "utf8") === readFileSync(kitPc, "utf8"); } catch { same = false; }
    pcTrusted = same;
    if (same) warn(`existing .githooks/pre-commit KEPT — its content matches the kit's version (OK).`);
    else warn(`existing .githooks/pre-commit KEPT and its content DIFFERS from the kit's — the every-lane commit floor is NOT the kit's control (it may be stale or a no-op that lets undeclared commits through). Re-run with --force to install the kit's version.`);
  }
  if (isGitRepo(T)) {
    // FM3/subdir footgun: `git config` writes to the repo the target belongs to. If T is a SUBDIR of a
    // larger repo, core.hooksPath is set on the PARENT pointing at parent/.githooks while the hook was
    // written under T/.githooks — unreachable. Warn rather than silently misconfigure.
    let top = null;
    try { top = execFileSync("git", ["-C", T, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); } catch { /* handled below */ }
    if (top && realpathOrSelf(top) !== realpathOrSelf(T)) {
      warn(`${T} is a SUBDIRECTORY of git repo ${top} — core.hooksPath would be set on the parent and miss ${T}/.githooks. Adopt at the repo ROOT, or configure the hook manually.`);
    } else if (gitConfig(T, "core.hooksPath", ".githooks")) {
      log(pcTrusted
        ? `  .githooks/pre-commit installed + core.hooksPath=.githooks (binds every lane)`
        : `  core.hooksPath=.githooks set — but the pre-commit is an EXISTING, UNVERIFIED hook (see warning above); the every-lane guarantee depends on it, NOT confirmed`);
    } else {
      warn(`could not set core.hooksPath — run: git -C ${T} config core.hooksPath .githooks`);
    }
  } else {
    warn(`${T} is not a git repo yet — after 'git init', run: git config core.hooksPath .githooks (FM1: unset ⇒ the pre-commit control is silently absent)`);
  }

  // 4. scripts: the doc-size control (+ optional gate runners).
  copyGuarded(path.join(KIT_ROOT, "scripts", "check-doc-size.mjs"), path.join(T, "scripts", "check-doc-size.mjs"), force);
  if (args.withGateRunners) {
    const runners = ["codex-gate.sh", "cold-review-gemini.sh", "gemini-gate-supervisor.mjs", "gemini-gate-slices.mjs"];
    for (const r of runners) {
      const d = path.join(T, "scripts", r);
      if (copyGuarded(path.join(KIT_ROOT, "scripts", r), d, force) === "written" && r.endsWith(".sh")) chmodX(d);
    }
    const guard = path.join(T, "scripts", "codex-gate-guard", "claude");
    if (copyGuarded(path.join(KIT_ROOT, "scripts", "codex-gate-guard", "claude"), guard, force) === "written") chmodX(guard);
    log(`  scripts/: check-doc-size.mjs + gate runners (need codex/agy at runtime — see PORTABILITY.md)`);
  } else {
    log(`  scripts/: check-doc-size.mjs (gate runners skipped; pass --with-gate-runners to include them)`);
  }

  // 4b. Portable FM1 test → the adopter's tests/, so the adopter's CI goes RED if core.hooksPath is
  // ever unset (the pre-commit control silently absent). PORTABILITY.md § FM1.
  const fm1Result = copyGuarded(path.join(KIT_ROOT, "templates", "kit-precommit.test.mjs"), path.join(T, "tests", "kit-precommit.test.mjs"), force);
  log(fm1Result === "written"
    ? `  tests/kit-precommit.test.mjs: FM1 guard installed (wire test:kit-controls into CI)`
    : `  tests/kit-precommit.test.mjs: EXISTING kept (may be stale; --force to update) — wire test:kit-controls into CI`);

  // 4c. /thread-restart — the dual-harness command asset (v1.1). A productivity NUDGE, not a control:
  // it ships no enforcement, so it carries no fail-closed behavior. Each asset carries the SAME digest
  // METHOD (index-don't-duplicate + the mandatory VERIFY-before-finalize pass + drop-operational-noise),
  // lightly harness-adapted in wording (memory nouns, example ids, a Claude-only spawn offer); init
  // copies each VERBATIM (no per-repo rewrite). See README/PORTABILITY § dual-harness. copyGuarded
  // refuses to clobber without --force, so re-runs are idempotent.
  const claudeCmdDst = path.join(T, ".claude", "commands", "thread-restart.md");
  const claudeCmdResult = copyGuarded(path.join(KIT_ROOT, "commands", "claude", "thread-restart.md"), claudeCmdDst, force);
  log(claudeCmdResult === "written"
    ? `  .claude/commands/thread-restart.md: /thread-restart installed (Claude lane)`
    : `  .claude/commands/thread-restart.md: EXISTING kept (--force to update)`);
  if (args.skipCodexPrompt) {
    log(`  Codex prompt: SKIPPED (--skip-codex-prompt) — the Claude command + AGENTS.md pointer still install`);
  } else {
    const codexDst = path.join(args.codexPromptsDir, "thread-restart.md");
    // The Codex prompt is the ONE install target OUTSIDE the repo (user-global). A failure writing it
    // (unwritable ~/.codex, a non-directory in the way) must NOT abort the repo-local adopt — the
    // Claude command + AGENTS.md pointer are the load-bearing install. Warn and continue.
    try {
      const codexResult = copyGuarded(path.join(KIT_ROOT, "commands", "codex", "thread-restart.md"), codexDst, force);
      log(codexResult === "written"
        ? `  ${codexDst}: /thread-restart Codex prompt installed (USER-GLOBAL, OUTSIDE the repo — override with --codex-prompts-dir, opt out with --skip-codex-prompt)`
        : `  ${codexDst}: EXISTING kept (--force to update)`);
    } catch (e) {
      warn(`could not install the Codex prompt to ${codexDst} (${e && (e.code || e.message) || "error"}) — the repo-local Claude command + AGENTS.md pointer are unaffected; pass --codex-prompts-dir <writable dir> or --skip-codex-prompt to silence this`);
    }
  }

  // 4d. SKILLS — the shared-body dual-lane install (v1.3). ONE canonical body per skill lives at
  // .agents/skills/<name>/ (harness-neutral); each harness gets a THIN SHIM that does nothing but
  // point at it. Same reasoning as the /thread-restart dual-harness asset — the plumbing is
  // harness-specific, the METHOD must not be re-derived per harness — taken one step further: here
  // the method is not merely kept in lockstep across two copies, it is literally ONE file.
  //
  // THIS IS THE MECHANISM, NOT A ONE-OFF. Both sides are DISCOVERED FROM DISK, so adding a skill to
  // the kit means dropping a body dir in `skills/<name>/` and a shim in `skill-shims/<lane>/<name>.md`
  // — no edit here. Shims are enumerated SEPARATELY from bodies rather than derived from them,
  // because a shim need not have a body of its own: `humanize-bullet` is an ALIAS pointing at
  // `humanize`'s body. copyGuarded refuses to clobber without --force, so re-runs are idempotent.
  const skillsSrc = path.join(KIT_ROOT, "skills");
  const shimsSrc = path.join(KIT_ROOT, "skill-shims");
  const subdirsOf = (dir) => (existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
  const shimNamesFor = (lane) => {
    const dir = path.join(shimsSrc, lane);
    return existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.slice(0, -".md".length)).sort()
      : [];
  };

  const bodyNames = subdirsOf(skillsSrc);
  const claudeShims = shimNamesFor("claude");
  const codexShims = shimNamesFor("codex");
  // Track the INSTALLED shim path per lane+name, so verification below reads what the harness will
  // actually load rather than what the kit shipped.
  const installedShims = [];
  // Failure-ISOLATED like the Codex prompt, and for a sharper reason: this whole block is a NUDGE,
  // and step 5 below — registering the guards in settings.json — is a CONTROL. An ENOTDIR from a
  // `.claude/skills` that happens to be a regular file, or a broken symlink under `.agents/skills`,
  // must not abort the run before the guards are registered, which would leave hook files on disk
  // with zero registrations: exactly the silent fail-open mergeSettings' own read-back exists to stop.
  try {
    for (const name of bodyNames) copyTree(path.join(skillsSrc, name), path.join(T, ".agents", "skills", name), force);
    for (const name of claudeShims) {
      const dst = path.join(T, ".claude", "skills", name, "SKILL.md");
      copyGuarded(path.join(shimsSrc, "claude", `${name}.md`), dst, force);
      installedShims.push(["claude", name, dst]);
    }
    log(bodyNames.length || claudeShims.length
      ? `  skills: ${bodyNames.length} shared body(ies) → .agents/skills/ · ${claudeShims.length} Claude shim(s) → .claude/skills/<name>/SKILL.md (existing files kept; --force to update)`
      : `  skills: none shipped in this kit version`);
  } catch (e) {
    warn(`the repo-local skills install failed (${e && (e.code || e.message) || "error"}) — /humanize and any other skill may be missing or partial. This is a NUDGE, not a control: the guards, the pre-commit floor and the method docs are unaffected and the adopt continues.`);
  }

  if (args.skipCodexPrompt) {
    log(`  Codex skill prompts: SKIPPED (--skip-codex-prompt) — the shared bodies + Claude shims still install`);
  } else {
    let cInstalled = 0, cKept = 0, cFailed = 0;
    for (const name of codexShims) {
      const dst = path.join(args.codexPromptsDir, `${name}.md`);
      // The Codex prompts dir is a FLAT, user-global namespace shared with the command prompts
      // (/thread-restart). A skill whose name collides would silently replace a command under --force.
      // Refuse rather than clobber: a kit-authoring mistake, caught at the one moment anyone is looking.
      if (existsSync(path.join(KIT_ROOT, "commands", "codex", `${name}.md`))) {
        warn(`skill shim "${name}" collides with the Codex COMMAND prompt of the same name — skipped. Rename the skill in skill-shims/codex/ (this dir is a flat user-global namespace).`);
        cFailed++;
        continue;
      }
      // Failure-ISOLATED, exactly like the /thread-restart Codex prompt: this is the ONE install
      // target outside the repo, and an unwritable ~/.codex must never abort a mostly-complete adopt.
      try {
        if (copyGuarded(path.join(shimsSrc, "codex", `${name}.md`), dst, force) === "written") cInstalled++; else cKept++;
        installedShims.push(["codex", name, dst]);
      } catch (e) {
        cFailed++;
        warn(`could not install the Codex skill prompt ${dst} (${e && (e.code || e.message) || "error"}) — the repo-local bodies + Claude shims are unaffected; pass --codex-prompts-dir <writable dir> or --skip-codex-prompt to silence this`);
      }
    }
    if (codexShims.length) {
      log(`  ${args.codexPromptsDir}: ${cInstalled} Codex skill prompt(s) installed, ${cKept} kept${cFailed ? `, ${cFailed} FAILED (see warning)` : ""} (USER-GLOBAL, OUTSIDE the repo)`);
    }
  }

  // A shim is worthless if the body it names is not on disk — it becomes a menu entry that dead-ends.
  //
  // Read the INSTALLED shim, never the kit's source copy. Without --force an existing shim is KEPT,
  // so the file the harness loads may be an edited or stale one this run never wrote; validating the
  // kit's pristine copy instead would certify a shim we never looked at — the stale-asset trap init
  // already handles honestly for hooks (`may be STALE`) and the pre-commit floor (`pcTrusted`).
  //
  // And a shim naming NO body at all is a FAILURE, not a pass. Zero matches means zero comparisons,
  // so "no dangling reference" would be vacuously true for precisely the broken artifact this check
  // exists to catch — a live risk because two later work-stages add skills through this mechanism.
  const BODY_REF_RE = /\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g;
  let dangling = 0, verified = 0;
  for (const [lane, name, dst] of installedShims) {
    let text;
    try { text = readFileSync(dst, "utf8"); }
    catch { warn(`${lane} skill shim "${name}" could not be read back at ${dst} — its body reference is UNVERIFIED`); dangling++; continue; }
    const refs = [...text.matchAll(BODY_REF_RE)];
    if (!refs.length) {
      warn(`${lane} skill shim "${name}" names NO .agents/skills/<name>/<file>.md body — a shim carries no rules of its own, so this command would dead-end`);
      dangling++;
      continue;
    }
    for (const m of refs) {
      if (existsSync(path.join(T, ".agents", "skills", m[1], m[2]))) { verified++; continue; }
      warn(`${lane} skill shim "${name}" points at .agents/skills/${m[1]}/${m[2]}, which is NOT installed — that command would dead-end`);
      dangling++;
    }
  }
  if (installedShims.length) {
    log(dangling
      ? `  skills: ${dangling} shim reference(s) do NOT resolve (see warnings above) — those commands dead-end`
      : `  skills: ${verified} body reference(s) across ${installedShims.length} installed shim(s) all resolve on disk`);
  }

  // 5. settings.json — MERGE the PreToolUse registrations. HONOR the return: never log "merged" when
  // the guards were not actually registered (that is the "manufactured assurance" fail-open).
  const mergeResult = mergeSettings(path.join(T, ".claude", "settings.json"), path.join(KIT_ROOT, "templates", "settings.json"), force);
  if (mergeResult === "written") log(`  .claude/settings.json: PreToolUse + Stop registrations merged (verified by read-back)`);
  else if (mergeResult === "skipped") warn(`.claude/settings.json: NOT merged (see warning above) — the 3 PreToolUse guards and the Stop sensor are NOT registered. Fix the file and re-run with --force, or register them by hand.`);
  else warn(`.claude/settings.json: post-write verification FAILED — the registrations are NOT confirmed on disk. Inspect ${path.join(T, ".claude", "settings.json")} before trusting the Claude-lane controls.`);

  // 6. .claude/kit.config.json — the [G] repo-specific families (the ONLY parameterized DATA).
  const config = {};
  if (args.sourceDirs) config.executedPathDirs = args.sourceDirs;
  // laneRiskTokens is deliberately NOT written (deprecated with the retired lane route, v1.5.0). An
  // EXISTING key in an older adopter's config is tolerated by every control: ignored, never fatal.
  if (args.stateDocs) config.stateDocs = args.stateDocs;
  if (args.memoryDir) config.memoryDir = args.memoryDir;
  const cfgPath = path.join(T, ".claude", "kit.config.json");
  let cfgKept = false;
  if (existsSync(cfgPath) && !force) { warn(`exists, kept (use --force to overwrite): ${cfgPath}`); cfgKept = true; }
  else {
    ensureDir(path.dirname(cfgPath));
    const cfgText = JSON.stringify(config, null, 2) + "\n";
    // A --force re-run with no family flags rewrites this to `{}`, silently WIDENING the write guard
    // (an executedPathDirs family the adopter configured simply disappears). Keep the previous
    // version, and refuse the overwrite outright if it cannot be kept.
    if (!writeWithBackup(cfgPath, cfgText)) cfgKept = true;
  }
  log(cfgKept
    ? `  .claude/kit.config.json: EXISTING kept — on-disk file unchanged; the flags you passed were NOT applied`
    : `  .claude/kit.config.json: ${Object.keys(config).length ? Object.keys(config).join(", ") : "empty (portable defaults)"}`);

  // 7. [G] generated files from templates (placeholders the adopter completes).
  const vars = {
    REPO_NAME: args.repoName || "{{REPO_NAME}}",
    REMOTE_URL: args.remoteUrl || "{{REMOTE_URL}}",
    DEPLOY_BRANCH: args.deployBranch || "main",
    // core/OWNER_COMMS.md is `[G]` because it NAMES A PERSON — copying one repo's into another
    // re-creates exactly the cross-repo confusion the identity fingerprint exists to prevent. Only
    // the name is fillable from a flag; {{OWNER_PROFILE}}, {{IRREVERSIBLE_ASSET}} and
    // {{OWNER_SHORTHAND}} are judgment calls the adopter completes by hand (listed in the checklist).
    OWNER_NAME: args.ownerName || "{{OWNER_NAME}}",
    KIT_VERSION,
  };
  const gen = [
    ["CLAUDE.md.tmpl", "CLAUDE.md"],
    ["AGENTS.md.tmpl", "AGENTS.md"],
    ["BINDINGS.md.tmpl", "core/BINDINGS.md"],
    ["REPO_INVARIANTS.md.tmpl", "core/REPO_INVARIANTS.md"],
    ["SYSTEM_MAP.md.tmpl", "core/SYSTEM_MAP.md"],
    ["OWNER_COMMS.md.tmpl", "core/OWNER_COMMS.md"],
  ];
  let genWritten = 0, genKept = 0, genRefused = 0;
  for (const [tmpl, dst] of gen) {
    const d = path.join(T, dst);
    if (existsSync(d) && !force) { warn(`exists, kept (use --force to overwrite): ${d}`); genKept++; continue; }
    const text = fillTemplate(path.join(KIT_ROOT, "templates", tmpl), vars);
    // --force must not destroy hand-authored [G] content — and must not proceed if it cannot preserve it.
    if (writeWithBackup(d, text)) genWritten++; else genRefused++;
  }
  // Count a REFUSED write separately from a KEPT one. Folding them together produced a summary that
  // said "your version is backed up first" about the one file whose backup had just failed — and left
  // the tree MIXED (later docs regenerated, that one not), which the reader has to know to fix.
  if (genRefused) {
    warn(`[G] generation is INCOMPLETE: ${genWritten} regenerated, ${genRefused} REFUSED (see above). The tree now MIXES kit-current and older [G] files. Resolve the refused file(s), then re-run --force.`);
  }
  log(genKept || genRefused
    ? `  [G] CLAUDE + AGENTS + BINDINGS + REPO_INVARIANTS + SYSTEM_MAP + OWNER_COMMS: ${genWritten} generated, ${genKept} EXISTING kept${genKept ? " (--force to regenerate; your version is backed up first)" : ""}${genRefused ? `, ${genRefused} REFUSED (NOT backed up, NOT overwritten)` : ""}`
    : `  [G] entry stubs + BINDINGS + REPO_INVARIANTS + SYSTEM_MAP + OWNER_COMMS generated`);

  // Scan the files ON DISK for unfilled placeholders — NOT the text this run happened to write.
  // A kept file contributed nothing to that text, so a re-run (the documented upgrade path) reported
  // "(none — all filled)" while the doc on disk still literally read "this touches
  // {{IRREVERSIBLE_ASSET}}". The checklist is the ONLY thing that surfaces the three flag-unfillable
  // OWNER tokens, so a false all-clear there is the difference between a completed contract and a
  // template nobody finished.
  for (const [, dst] of gen) {
    let text;
    try { text = readFileSync(path.join(T, dst), "utf8"); } catch { continue; }
    const unfilled = [...new Set([...text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]))]; // digit-bearing too ({{INVARIANT_1}})
    if (unfilled.length) { remaining.push(dst); remainingTokens.set(dst, unfilled); }
  }

  // Report the sensor's state using the HOOK'S OWN predicate (imported, not paraphrased) against the
  // file on disk. Both halves matter. Re-deriving the test here drifted from the hook and announced
  // ARMED for a heading the hook could not parse — a retitled section, an em dash normalized to a
  // hyphen, or no heading at all. And reading the FLAG rather than the file would announce ARMED on a
  // re-run where `--owner-name` was passed but the existing doc was kept. Either is a false statement
  // about a control's state, which this kit treats as worse than having no control.
  const contract = ownerContract(T);
  const ownerDoc = path.join(T, "core", "OWNER_COMMS.md");
  log(!existsSync(ownerDoc)
    ? `  core/OWNER_COMMS.md: NOT present — the Stop sensor is DORMANT (it allows unconditionally)`
    : contract
      ? `  core/OWNER_COMMS.md: Owner "${contract.ownerName}", ${contract.questionTokens.length} question-shorthand token(s) — the Stop sensor is ARMED. It fails OPEN, so a clean run still proves nothing.`
      : `  core/OWNER_COMMS.md: the Stop sensor is DORMANT (it allows unconditionally) — no "## How to talk to <name> — Owner, not a developer" heading with the name filled in. Pass --owner-name, or fix that heading by hand.`);
  // ARMED is not COMPLETE. The sensor arms on the NAME alone, but rules 4 and 7 read as boilerplate
  // until the rest is written, and the block text it emits points the agent at this very doc.
  if (contract && (remainingTokens.get("core/OWNER_COMMS.md") || []).length) {
    warn(`core/OWNER_COMMS.md is ARMED but still has unfilled placeholders (${(remainingTokens.get("core/OWNER_COMMS.md") || []).map((t) => `{{${t}}}`).join(", ")}) — the contract an agent is pointed at is incomplete. See the checklist below.`);
  }

  // 7b. AGENTS.md fallback pointer — so a Codex / non-Claude lane finds the /thread-restart procedure
  // even where custom slash-commands are unsupported (the repo-local .claude/commands/thread-restart.md
  // is plain, readable markdown). Runs AFTER the AGENTS.md generation above; idempotent via its marker.
  const ptr = appendAgentsPointer(T, KIT_ROOT);
  if (ptr === "written") log(`  AGENTS.md: /thread-restart fallback pointer appended`);
  else if (ptr === "unchanged") log(`  AGENTS.md: /thread-restart pointer already present (unchanged)`);
  else if (ptr === "absent") warn(`AGENTS.md absent — /thread-restart pointer NOT appended (generate AGENTS.md, then re-run)`);
  else warn(`could not ${ptr === "read-failed" ? "read" : "write"} AGENTS.md to append the /thread-restart pointer — the rest of the adopt is unaffected; fix AGENTS.md permissions and re-run`);

  // 8. .gitignore (lane declaration + ledger are per-session).
  appendGitignore(T, [".claude/task-lane.json", ".claude/lane-ledger.jsonl"]);
  // With the gate runners installed, gitignore the ONE sanctioned in-repo gate-artifact prefix. The
  // Gemini runner defaults --out-dir to a fresh system-temp dir and REJECTS any other in-repo --out-dir,
  // but `.gemini-gate/` is the allowed in-repo location; it must be gitignored so cold-review-gemini.sh's
  // `git add -A` freeze skips it in the common case (the freeze-index rm + the validator's exact-path
  // exclusion are the defense-in-depth net for a force-added entry). See core/GATES.md § fingerprint.
  if (args.withGateRunners) {
    appendGitignore(T, [".gemini-gate/"], "workflow-kit: gate-runner artifact dir (sanctioned in-repo --out-dir prefix; freeze/validator-excluded)");
  }

  // 9. Post-init checklist.
  log(`\nAdopted workflow-kit v${KIT_VERSION}. Next:`);
  log(`  1. Complete the placeholders in: ${remaining.length ? remaining.join(", ") : "(none — all filled)"}`);
  // Name the OWNER_COMMS placeholders EXPLICITLY. They are the ones an adopter is least likely to
  // guess at from the filename — each is a judgment call about a person, not a repo fact — and the
  // doc is useless (rules 4 and 7 read as boilerplate) until they are answered.
  const OWNER_TOKEN_HELP = {
    OWNER_NAME: `the person the agent reports to (or re-run with --owner-name)`,
    OWNER_PROFILE: `a sentence or two on who they are and how they read`,
    IRREVERSIBLE_ASSET: `the thing in YOUR repo that cannot be restored`,
    OWNER_SHORTHAND: `the tokens they actually type (end a QUESTION's gloss with "?")`,
  };
  for (const tok of remainingTokens.get("core/OWNER_COMMS.md") || []) {
    log(`     · core/OWNER_COMMS.md {{${tok}}} — ${OWNER_TOKEN_HELP[tok] || "complete it"}`);
  }
  log(`  2. Add these scripts to package.json:  node bin/init.mjs --print-package-scripts`);
  log(`  3. Wire "doc:size" + "test:kit-controls" into your CI / npm test.`);
  log(`  4. READ PORTABILITY.md — the three PreToolUse hooks bind ONLY the Claude Code lane. A`);
  log(`     Codex / non-Claude lane is bound by AGENTS.md prose + the pre-commit hook you just`);
  log(`     installed — NOT by the PreToolUse guards. Do not imply otherwise to your team.`);
  log(`  5. The Stop hook guard-owner-comms.mjs is a SENSOR that fails OPEN — it nudges a`);
  log(`     rule-1 miss AFTER the message is already sent, and a clean run proves nothing.`);
  log(`     Never describe it to your team as enforcement. Off switch: WORKFLOW_KIT_COMMS_GUARD=false.`);
}

main();
