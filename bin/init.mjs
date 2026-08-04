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
  "--source-dirs", "--state-docs", "--memory-dir", "--with-gate-runners",
  "--codex-prompts-dir", "--skip-codex-prompt", "--codex-cold-model", "--skip-codex-lane",
  "--force", "--print-package-scripts",
]);

// Flags REMOVED in a major version, kept here only to fail HELPFULLY. A removed flag is still an
// exit(2) — a breaking change must break loudly, never be silently swallowed — but the generic
// "unknown argument" would leave an adopter with a saved invocation guessing at a one-word failure.
// Every other refusal in this kit names the offending field AND the fix; a migration error is the
// one an adopter meets while already frustrated, so it owes that most (FM5: the frustrated adopter
// is how a control gets disabled). The value is the remediation sentence.
const REMOVED_FLAGS = new Map([
  ["--risk-tokens",
    "REMOVED at v2.0. It was deprecated at v1.5.0 when the cost-inversion `lane` route was retired: " +
    "the `laneRiskTokens` family it configured gates nothing, and init stopped writing it then. " +
    "Drop the flag (and its value) from your invocation — nothing replaces it. A legacy " +
    "`laneRiskTokens` key already sitting in your .claude/kit.config.json stays TOLERATED by every " +
    "control (ignored, never fatal), so you do not need to edit that file."],
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
    else if (a === "--state-docs") out.stateDocs = listVal(next());
    else if (a === "--memory-dir") out.memoryDir = next();
    else if (a === "--with-gate-runners") out.withGateRunners = true;
    else if (a === "--codex-prompts-dir") out.codexPromptsDir = path.resolve(next());
    else if (a === "--skip-codex-prompt") out.skipCodexPrompt = true;
    else if (a === "--codex-cold-model") {
      // Shape rules for the same reason --owner-name has them: this value is interpolated into a
      // TOML STRING (`model = "<value>"`). A `"`, a backslash, or a line terminator does not merely
      // look wrong — it CLOSES the string and lets the rest of the value become TOML, which in a
      // file that also carries `sandbox_mode` means a mistyped flag could silently re-cage the
      // review seat. A "{{" would read as a still-unfilled placeholder to init's own scan.
      const v = next();
      // An ALLOWLIST, not a deny-list: a deny-list must enumerate every character that can escape a
      // TOML string, and missing one is the whole bug. Model names are a small, well-behaved
      // alphabet, so anything outside it is refused rather than guessed at.
      if (!/^[A-Za-z0-9._:\/-]+$/.test(v) || v.includes("{{")) {
        console.error(`init: --codex-cold-model must be a plain model name matching [A-Za-z0-9._:/-]+ (got ${JSON.stringify(v)}). It is interpolated into a TOML string, so quotes, backslashes and line breaks are refused rather than escaped.`);
        process.exit(2);
      }
      out.codexColdModel = v;
    }
    else if (a === "--skip-codex-lane") out.skipCodexLane = true;
    else if (a === "--force") out.force = true;
    else if (a === "--print-package-scripts") out.printPackageScripts = true;
    // Match BOTH spellings. An adopter who wrote `--risk-tokens=billing` fell through to the generic
    // "unknown argument" and got no migration sentence — defeating the whole point of this table for
    // exactly the people most likely to have scripted the flag.
    else if (REMOVED_FLAGS.has(a) || REMOVED_FLAGS.has(a.split("=")[0])) {
      const name = REMOVED_FLAGS.has(a) ? a : a.split("=")[0];
      console.error(`init: ${name} was ${REMOVED_FLAGS.get(name)}`);
      process.exit(2);
    }
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
  --state-docs a,b        repo CLASS: STATE docs governed by doc:size ⇒ kit.config.json stateDocs
  --memory-dir <abs>      external memory dir for the --memory advisory ⇒ kit.config.json memoryDir
  --with-gate-runners     also copy the Codex/Gemini gate runner scripts (need codex/agy at runtime)
  --codex-prompts-dir <d> where the Codex prompts install — /thread-restart and the skill shims
                          (default: ~/.codex/prompts, USER-GLOBAL — outside the target repo;
                          parameterize it for a hermetic run)
  --skip-codex-prompt     do not install any Codex prompt (the Claude command, the Claude skill
                          shims, the shared skill bodies and the AGENTS.md pointer still install)
  --codex-cold-model <m>  fills the Codex cold-review seat's {{CODEX_COLD_MODEL}}. Omitted ⇒ the
                          placeholder stays and that seat is UNUSABLE until you fill it by hand
  --skip-codex-lane       do not write <repo>/.codex/ at all (config.toml + the cold-review seat).
                          These are Codex-lane CONVENIENCES — they carry NO enforcement (see
                          PORTABILITY.md § The enforcement asymmetry)
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

// Does this `.codex/config.toml` REGISTER HOOKS? Codex accepts registrations in either that file or
// `.codex/hooks.json` and warns when both carry them, so this decides whether the kit writes its
// registration at all — which makes a false POSITIVE here a silent fail-open: guards installed,
// nothing registered, `init` exits 0 saying the adopter's own hooks are in charge when they have
// none.
//
// THE TABLE CONTEXT IS THE WHOLE POINT, and a line-shaped regex cannot see it. A bare
// `/^\s*hooks\s*[.=]/m` matches `hooks = true` under `[features]` — an ordinary Codex feature flag
// that registers nothing, and one that appears in real config files. (Found by the cross-family
// review seat, against a config that actually carries it.) So the current TABLE is tracked, and only
// two things count: a `[hooks…]`/`[[hooks…]]` table header, or a `hooks` key at TOP LEVEL — the
// scalar `hooks = "./hooks.json"` form Codex's own schema uses.
export function tomlDeclaresHooks(text) {
  let table = "";                       // "" = top level
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\[?\s*([^\]]*?)\s*\]\]?/.exec(line);
    if (header) {
      table = header[1];
      // `[hooks]`, `[hooks.PreToolUse]`, `[[hooks.PreToolUse]]` — the table form of a registration.
      if (table === "hooks" || table.startsWith("hooks.")) return true;
      continue;
    }
    // A `hooks` KEY only registers anything at top level. Under any other table it is that table's
    // field — `[features] hooks = true` being the case that matters.
    if (table === "" && /^hooks\s*(?:=|\.)/.test(line)) return true;
  }
  return false;
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
  //
  // ONE SOURCE, TWO INSTALL TARGETS (v2.1). The same files go to `.claude/hooks/` and, when the
  // Codex lane is enabled, to `.codex/hooks/` — byte-identically, pinned by a mutation-proven
  // equality test. The guards branch on PAYLOAD SHAPE at runtime (hooks/payload-targets.mjs), so
  // there is no per-lane variant to keep in step. This is deliberate history: the origin repo's
  // `.codex` hooks were stale COPIES of its `.claude` hooks, 48 hours adrift in the dangerous
  // direction, and nothing compared them because nothing could.
  const hookFiles = readdirSync(path.join(KIT_ROOT, "hooks")).sort();
  const installHooks = (destDir) => {
    let kept = 0;
    for (const h of hookFiles) {
      const d = path.join(destDir, h);
      if (copyGuarded(path.join(KIT_ROOT, "hooks", h), d, force) === "written") chmodX(d); else kept++;
    }
    return { installed: hookFiles.length - kept, kept };
  };
  const claudeHooks = installHooks(path.join(T, ".claude", "hooks"));
  log(claudeHooks.kept
    ? `  .claude/hooks/: ${claudeHooks.installed} installed, ${claudeHooks.kept} EXISTING kept — may be STALE; re-run with --force to update`
    : `  .claude/hooks/: ${hookFiles.length} files installed — PreToolUse guards (fail CLOSED), the guard-owner-comms Stop sensor (fails OPEN), and payload-targets.mjs, which is a shared MODULE the guards import and is registered nowhere`);

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
  // exists to catch — not hypothetical: every skill added since (v1.6's frontier-review, v1.7's
  // three ritual skills) arrived through this mechanism, with no edit here.
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

  // 4e. AGENTS — the reviewer seat definitions (v1.6): every agents/<name>.md ships VERBATIM to
  // .claude/agents/<name>.md, discovered from disk like the skills. These are Claude-harness assets
  // (the Agent tool's subagent registry; a non-Claude lane never loads them — PORTABILITY.md).
  // copyGuarded refuses to clobber without --force, so re-runs are idempotent. Failure-ISOLATED like
  // the skills block, for the same reason: step 5 below registers the guards (a CONTROL), and an
  // ENOTDIR from a `.claude/agents` that is a regular file must not abort the run before that merge.
  try {
    const agentsSrc = path.join(KIT_ROOT, "agents");
    const agentFiles = existsSync(agentsSrc)
      ? readdirSync(agentsSrc, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort()
      : [];
    let aInstalled = 0, aKept = 0;
    for (const name of agentFiles) {
      if (copyGuarded(path.join(agentsSrc, name), path.join(T, ".claude", "agents", name), force) === "written") aInstalled++; else aKept++;
    }
    if (agentFiles.length) {
      log(`  .claude/agents/: ${aInstalled} review-seat agent(s) installed, ${aKept} kept${aKept ? " — may be STALE; --force to update" : ""} (Claude lane only)`);
    }
    // The frontier-consult seat's `tools: []` line is LOAD-BEARING: the Claude harness reads an empty
    // tools list as no-tools-at-all, which is what the /frontier-review skill's packet-only limit
    // rests on. Read the INSTALLED file (a kept one may be edited or stale — the pcTrusted pattern):
    // if that line is gone from the FRONTMATTER, init must say so rather than certify it.
    //
    // Scoped to the frontmatter deliberately. A whole-file match certified a seat whose frontmatter
    // read `tools: Read, Bash, Write` while a prose line further down happened to spell `tools: []`
    // — the check reporting a cage on an armed seat (found by two cold seats, executed). The harness
    // parses the block between the first two `---` lines; so does this.
    //
    // ABSENCE IS NOT A PASS. If the kit ships a `/frontier-review` skill body naming a
    // `subagent_type` that is not installed, the command dead-ends — the same vacuity § 4d's shim
    // check was hardened against ("zero matches means zero comparisons"). So the seat the skill
    // NAMES is what gets checked, discovered from the installed body rather than hardcoded here.
    const frontmatterOf = (text) => {
      const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      return m ? m[1] : null;
    };
    // Accept every spelling the YAML parser reads as an EMPTY list — `tools: []`, with trailing
    // whitespace, or with a trailing `#` comment. Warning on those would be a false FAIL against a
    // seat the harness does in fact cage, and a check that cries wolf is one adopters learn to
    // ignore. Anything that puts a VALUE in the list (`tools: [Read]`) is correctly not a cage.
    const CAGED_RE = /^tools:[ \t]*\[[ \t]*\][ \t]*(?:#.*)?$/m;
    const skillBody = path.join(T, ".agents", "skills", "frontier-review", "SKILL.md");
    let namedSeat = null;
    if (existsSync(skillBody)) {
      try { namedSeat = (/subagent_type:\s*"([A-Za-z0-9._-]+)"/.exec(readFileSync(skillBody, "utf8")) || [])[1] ?? null; } catch { namedSeat = null; }
    }
    if (namedSeat) {
      const seatDst = path.join(T, ".claude", "agents", `${namedSeat}.md`);
      let cage = "missing";
      if (existsSync(seatDst)) {
        try {
          const fm = frontmatterOf(readFileSync(seatDst, "utf8"));
          cage = fm === null ? "no-frontmatter" : (CAGED_RE.test(fm) ? "ok" : "uncaged");
        } catch { cage = "unreadable"; }
      }
      if (cage === "ok") log(`  .claude/agents/${namedSeat}.md: the packet-only cage ("tools: []") is present in the installed frontmatter`);
      else if (cage === "missing") warn(`the /frontier-review skill names subagent_type "${namedSeat}", but .claude/agents/${namedSeat}.md is NOT installed — that consult would dead-end, and no cage was checked. Re-run with --force, or remove the skill.`);
      else warn(`the installed .claude/agents/${namedSeat}.md does not carry "tools: []" in its FRONTMATTER (${cage}) — the packet-only cage is NOT confirmed (the seat may hold tools). Re-run with --force to restore the kit's version.`);
    }
  } catch (e) {
    warn(`the review-seat agents install failed (${e && (e.code || e.message) || "error"}) — .claude/agents/ may be missing or partial. The guards, the pre-commit floor and the method docs are unaffected and the adopt continues.`);
  }

  // 4f. The CODEX LANE assets (v2.0) — `.codex/config.toml` (`[P]`) and the cold-review seat
  // (`[G]`, generated below with the other templates because it carries a placeholder).
  //
  // READ THE ADJECTIVE: these are CONVENIENCES, not controls. v2.0 registers NO Codex hooks — see
  // PORTABILITY.md § The enforcement asymmetry for the executed reasons. Nothing here narrows the
  // gap between the lanes, and the log line below must never suggest it does. Failure-ISOLATED like
  // the skills and agents blocks: step 5 registers the Claude guards (a CONTROL), and an ENOTDIR
  // from a `.codex` that happens to be a regular file must not abort the run before that merge.
  // Set false if `.codex/` is unusable, so the seat's `[G]` generation below is SKIPPED rather than
  // throwing. That generation runs in the shared template loop, which is deliberately NOT
  // failure-isolated — a `[G]` write that dies must stop the run — but this entry is the one member
  // of that table which is a convenience, not part of the method. Without this flag a regular file
  // sitting at `.codex` killed the whole adopt with a raw ENOTDIR stack trace AFTER the guards were
  // registered: not the zero-registration fail-open, but a partial adopt that flatly contradicts the
  // "carries no enforcement, the adopt continues" contract stated three lines above (found by the
  // cross-family gate seat).
  let codexLaneOk = !args.skipCodexLane;
  if (args.skipCodexLane) {
    // Say what is TRUE of the tree, not merely what this run did. On a re-run over a repo adopted
    // WITHOUT the flag, a bare "SKIPPED" reads as "there is no .codex here" while both files sit on
    // disk. Every other kept-file path in this installer reports honestly; this one did not.
    const existing = existsSync(path.join(T, ".codex"));
    log(existing
      ? `  .codex/: SKIPPED (--skip-codex-lane) — but a .codex/ ALREADY EXISTS here and was left untouched; this run neither wrote nor removed it`
      : `  .codex/: SKIPPED (--skip-codex-lane)`);
  } else {
    try {
      const cfgDst = path.join(T, ".codex", "config.toml");
      // Fail HERE, inside the catch, rather than later in the template loop.
      ensureDir(path.join(T, ".codex", "agents"));
      const codexCfg = copyGuarded(path.join(KIT_ROOT, "codex", "config.toml"), cfgDst, force);
      // A KEPT config.toml may already declare `hooks`. Codex accepts registrations in either that
      // file or `.codex/hooks.json` and warns when both do, so an adopter carrying their own is
      // fine — but they must know the kit did NOT touch it, rather than assume the kit's version won.
      let declaresHooks = false;
      if (codexCfg === "written") {
        log(`  .codex/config.toml: installed (pager + shell-env policy; the ENFORCEMENT is the hooks below)`);
      } else {
        // Every TOML spelling of a hooks registration, not just the table header. The scalar form
        // `hooks = "./hooks.json"` is the one Codex's own schema strings use, so matching only
        // `[hooks]` left the most likely spelling undetected — a fail-open in a DETECTOR, which is
        // how an adopter ends up assuming the kit reconciled hooks it never saw. (Found by a cold seat.)
        try { declaresHooks = tomlDeclaresHooks(readFileSync(cfgDst, "utf8")); } catch { /* reported as kept below */ }
        warn(`.codex/config.toml: EXISTING kept (--force to update)${declaresHooks
          ? " — and it DECLARES HOOKS."
          : ""}`);
      }

      // The arming-verification probe ships WITH the lane it verifies. The post-run checklist tells
      // the adopter to run `node scripts/check-codex-hooks-armed.mjs`, and an instruction naming a
      // file the installer never wrote is the same dead-end the shim check exists to catch.
      copyGuarded(path.join(KIT_ROOT, "scripts", "check-codex-hooks-armed.mjs"), path.join(T, "scripts", "check-codex-hooks-armed.mjs"), force);

      // The Codex-lane guards + their registration (v2.1).
      const codexHooks = installHooks(path.join(T, ".codex", "hooks"));
      log(codexHooks.kept
        ? `  .codex/hooks/: ${codexHooks.installed} installed, ${codexHooks.kept} EXISTING kept — may be STALE; --force to update. The two lanes are meant to hold BYTE-IDENTICAL files; a kept one may have drifted.`
        : `  .codex/hooks/: ${hookFiles.length} files installed — the SAME files as .claude/hooks/, byte for byte`);

      // VERIFY BY COMPARING WHAT IS ON DISK, not by trusting that two copies of one source must
      // match. They can diverge through the documented upgrade path itself, and this is not
      // hypothetical — it is what a plain (no --force) re-run of THIS release does to a v2.0
      // adopter: `.claude/hooks/` already exists so every guard there is KEPT at the old version,
      // while `.codex/hooks/` is brand new so every guard there is WRITTEN at the new one. The run
      // exits 0, and the adopter is left with one lane upgraded and one not, silently. The equality
      // test in the kit's own suite would never see it — it runs against a FRESH adopt.
      const drifted = [];
      for (const h of hookFiles) {
        try {
          if (readFileSync(path.join(T, ".claude", "hooks", h), "utf8") !== readFileSync(path.join(T, ".codex", "hooks", h), "utf8")) drifted.push(h);
        } catch { drifted.push(`${h} (unreadable in one lane)`); }
      }
      if (drifted.length) {
        warn(`the two lanes' hooks are NOT identical: ${drifted.join(", ")} differ between .claude/hooks/ and .codex/hooks/. The guards are ONE source installed twice, so this means one lane is running an older or edited copy — the most likely cause is a re-run without --force, which KEEPS existing files. Re-run with --force to bring both lanes to this kit version, then re-grant Codex hook trust (an upgraded hook is DISARMED until you do).`);
      }

      // ONE REPRESENTATION ONLY. Codex accepts hook registrations in EITHER `.codex/config.toml` or
      // `.codex/hooks.json` and warns when both carry them. If the adopter's kept config already
      // declares hooks — in either spelling — the kit does NOT add a second representation. Their
      // registration wins and they are told exactly what that costs them.
      const hooksJson = path.join(T, ".codex", "hooks.json");
      if (declaresHooks) {
        warn(`.codex/hooks.json: NOT written — your kept .codex/config.toml already declares hooks, and Codex wants a SINGLE representation for this layer. Those registrations are YOURS: the kit did not change them and cannot vouch for them. To adopt the kit's guards instead, remove the hooks declaration from config.toml and re-run init.`);
      } else if (existsSync(hooksJson) && !force) {
        warn(`exists, kept (use --force to overwrite): ${hooksJson} — the Codex guards may be registered from a STALE file`);
      } else {
        // `[G]`, and for a reason that is not stylistic: Codex runs a hook command from a working
        // directory this kit does not control, and NOTHING in the payload can be trusted to name the
        // repo (a wrong project root makes in-repo paths look out-of-repo, which is a fail-OPEN — see
        // hooks/payload-targets.mjs § resolveProjectRoot). So the absolute path of THIS repo is
        // baked in at generation time and passed explicitly.
        //
        // THE MATCHERS ARE THE REAL CODEX TOOL NAMES. The Claude-lane spelling
        // `Write|Edit|MultiEdit|NotebookEdit` matches NOTHING in Codex: writes arrive as
        // `apply_patch` and commands as `Bash`. That mismatch is one of the two independent reasons
        // the origin repo's Codex hooks could never have fired.
        // SHELL QUOTING, because Codex runs a hook `command` through a SHELL. (The shipped CLI's hook
        // command runner sits directly beside its `SHELL` / `-lc` strings; a cross-family review seat
        // independently reported the same from Codex's source. An earlier draft here said the
        // execution model was unknown and hedged by staying unquoted where possible — the hedge was
        // harmless, the reasoning was wrong, and the QUOTING it fell back to was unsafe.)
        //
        // SINGLE quotes, not `JSON.stringify`. JSON gives DOUBLE quotes, inside which a shell still
        // expands `$VAR`, `` `cmd` `` and `$(cmd)` — so a repo path containing any of those would be
        // mangled or would execute something. And a hook that fails to start does not block the tool:
        // Codex only blocks on a well-formed deny, so a broken command string is a FAIL-OPEN. POSIX
        // single quotes suppress all expansion; the `'\''` dance is the only escape they need.
        //
        // An ordinary path still comes out UNQUOTED, which keeps the common case identical under any
        // executor and keeps the generated file readable.
        const SHELL_SAFE = /^[A-Za-z0-9._\/@+=-]+$/;
        const arg = (s) => (SHELL_SAFE.test(s) ? s : `'${String(s).split("'").join(`'\\''`)}'`);
        const needsQuoting = !SHELL_SAFE.test(T);
        const nodeCmd = (file) => `node ${arg(path.join(T, ".codex", "hooks", file))} --project-dir ${arg(T)}`;
        const entry = (file, statusMessage) => ({ type: "command", command: nodeCmd(file), timeout: 10, statusMessage });
        const registration = {
          description: `workflow-kit v${KIT_VERSION} — Codex-lane PreToolUse guards. These do NOT run until you approve them in an INTERACTIVE codex session; codex exec skips untrusted hooks silently. Verify with: node scripts/check-codex-hooks-armed.mjs`,
          hooks: {
            PreToolUse: [
              {
                matcher: "apply_patch",
                hooks: [
                  entry("guard-cross-repo-writes.mjs", "Checking every patch target stays inside this repo…"),
                  entry("guard-lane-authoring.mjs", "Checking the task's lane declaration…"),
                ],
              },
              {
                matcher: "Bash",
                hooks: [entry("guard-gate-ladder.mjs", "Resolving the declared tier; surfacing the ladder it owes…")],
              },
            ],
          },
        };
        // The Stop-event Owner-comms SENSOR is deliberately NOT registered here. Codex does list a
        // `Stop` hook event, but this kit has not observed that payload, and registering a sensor
        // against an unverified payload shape would ship a control whose behaviour nobody has
        // watched. The file installs (the two trees stay byte-identical); only the registration is
        // withheld, and PORTABILITY.md says so.
        if (writeWithBackup(hooksJson, JSON.stringify(registration, null, 2) + "\n")) {
          log(`  .codex/hooks.json: [G] registration written — apply_patch ⇒ 2 write guards (fail CLOSED) · Bash ⇒ the gate-ladder sensor (never denies)`);
          if (needsQuoting) {
            warn(`this repo's path contains characters that had to be shell-QUOTED inside the .codex/hooks.json hook commands (${T}). Codex runs a hook command through a shell, so the single-quoted form written here is correct — but a hook that fails to START does not block anything, so verify rather than assume: run \`node scripts/check-codex-hooks-armed.mjs\` after granting trust. Adopting from a path without spaces or shell metacharacters removes the question entirely.`);
          }
        } else {
          warn(`.codex/hooks.json: REFUSED — the existing file could not be backed up, so it was left UNCHANGED. The Codex guards are registered from whatever that file says, which is not what this run wrote.`);
        }
      }
    } catch (e) {
      codexLaneOk = false;
      // v2.1 changed what this costs, so the wording had to change with it: this block now installs
      // real ENFORCEMENT, and a failure here means the Codex lane is UNGUARDED. It still must not
      // abort the adopt — the Claude guards and the every-lane pre-commit floor are registered
      // around it and are unaffected — but reporting it as a lost convenience would be false.
      warn(`the .codex/ lane could not be installed (${e && (e.code || e.message) || "error"}) — YOUR CODEX LANE IS UNGUARDED: no write guards, no registration, no cold-review seat. The Claude-lane guards, the every-lane pre-commit floor and the method docs are unaffected, so the adopt continues. Fix the path and re-run to arm the Codex lane.`);
    }
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
    // `[G]` for the same reason BINDINGS is: it names a MODEL, which is a per-repo binding, not kit
    // doctrine. Left unfilled the placeholder SURVIVES into the generated file, so the existing
    // unfilled-placeholder scan below reports it and the post-run checklist names it — the seat is
    // visibly incomplete rather than silently mis-modelled.
    CODEX_COLD_MODEL: args.codexColdModel || "{{CODEX_COLD_MODEL}}",
    // The non-Claude lane the asymmetry table names. It shipped as an UNFILLED placeholder in every
    // generated core/BINDINGS.md — no flag, no fill logic, so the "canonical statement of the
    // PM-portability caveat" had a literal `{{OTHER_LANE}}` in its column header. It is not a
    // judgment call the adopter has to make: the lane this kit ships hooks and a review seat for is
    // Codex, so it is filled, not asked for. (Found by a cold seat; pre-existing since the template
    // was written.)
    OTHER_LANE: "Codex",
    KIT_VERSION,
  };
  const gen = [
    ["CLAUDE.md.tmpl", "CLAUDE.md"],
    ["AGENTS.md.tmpl", "AGENTS.md"],
    ["BINDINGS.md.tmpl", "core/BINDINGS.md"],
    ["REPO_INVARIANTS.md.tmpl", "core/REPO_INVARIANTS.md"],
    ["SYSTEM_MAP.md.tmpl", "core/SYSTEM_MAP.md"],
    ["OWNER_COMMS.md.tmpl", "core/OWNER_COMMS.md"],
    // Generated through the SAME path as every other `[G]` file, deliberately: it inherits the
    // .bak-before-overwrite protection, the refused-write accounting, and the placeholder scan
    // rather than needing its own hand-kept copies of all three.
    ...(codexLaneOk ? [["codex-cold-reviewer.toml.tmpl", ".codex/agents/cold-reviewer.toml"]] : []),
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
  // Name the files from the `gen` table rather than a hand-kept prose list: the list drifted the
  // moment a seventh entry was added, and a summary that omits a file it just wrote is the same
  // class of quiet inaccuracy this kit spends its warnings on.
  const genNames = gen.map(([, dst]) => dst).join(", ");
  log(genKept || genRefused
    ? `  [G] ${genNames}: ${genWritten} generated, ${genKept} EXISTING kept${genKept ? " (--force to regenerate; your version is backed up first)" : ""}${genRefused ? `, ${genRefused} REFUSED (NOT backed up, NOT overwritten)` : ""}`
    : `  [G] ${genNames}: all generated`);

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
  // SELF-NUMBERING. One item is conditional (the Codex lane can be skipped), and a hand-numbered
  // list either repeats a number or leaves a hole the moment that happens — both of which read as
  // "an item is missing" in the one output an adopter follows step by step.
  let step = 1;
  const item = (first, ...rest) => { log(`  ${++step}. ${first}`); for (const line of rest) log(`     ${line}`); };
  item(`Add these scripts to package.json:  node bin/init.mjs --print-package-scripts`);
  item(`Wire "doc:size" + "test:kit-controls" into your CI / npm test.`);
  // THE TRUST HEADLINE, IN THE SAME BREATH AS "INSTALLED". This is the single most load-bearing
  // sentence init prints, because the failure it prevents is silent on BOTH sides: Codex does not
  // run a repo's hooks until a human approves them in an interactive session, and in `codex exec`
  // it skips unapproved hooks with no prompt, no warning and no exit-code change. An adopter who
  // reads "installed" above and stops reading has an INERT control and no way to notice. So the
  // caveat ships beside the claim, never in a doc they may not open — and it ends with the one
  // command that answers the question rather than asserting an answer.
  if (codexLaneOk) {
    item(
      `ARM THE CODEX LANE — the guards are INSTALLED but INERT until you grant hook trust.`,
      `Codex runs a repo's hooks only after a human approves them in an INTERACTIVE session:`,
      `run \`codex\` in this repo once, and answer "Hooks need review" with "Trust all and`,
      `continue". \`codex exec\` NEVER prompts and NEVER warns — it skips untrusted hooks`,
      `SILENTLY, so a clean run proves nothing. Then VERIFY, do not assume:`,
      `    node scripts/check-codex-hooks-armed.mjs`,
      `Upgrading a hook (\`init --force\`) marks it CHANGED and DISARMS it until you approve`,
      `again. Migration order is: upgrade → re-trust interactively → re-run that check.`,
      `The kit will never grant this for you: it does not write Codex's trust store and it`,
      `does not use --dangerously-bypass-hook-trust. Automating another tool's consent is`,
      `forging consent, and it would arm every hook from every source, not just ours.`,
    );
  }
  item(
    `READ PORTABILITY.md — what these guards do NOT cover. They bind write TOOLS. A write`,
    `issued through a plain SHELL command is invisible to them, and in the Codex lane that`,
    `is a main road, not a corner case. The pre-commit hook you just installed is the only`,
    `mechanical floor that binds every lane. Do not imply otherwise to your team.`,
  );
  item(
    `The Stop hook guard-owner-comms.mjs is a SENSOR that fails OPEN — it nudges a`,
    `rule-1 miss AFTER the message is already sent, and a clean run proves nothing.`,
    `Never describe it to your team as enforcement. Off switch: WORKFLOW_KIT_COMMS_GUARD=false.`,
  );
}

// RUN ONLY AS A CLI. This file exports `tomlDeclaresHooks` so the suite can pin it against the
// probe's forced copy — and an unguarded `main()` turns that import into a full ADOPT of whatever
// directory the importer happens to be running in. It did exactly that once here: a test imported
// this module and init adopted the KIT'S OWN WORKING TREE, writing entry stubs, a `.codex/` lane and
// `.claude/` registrations into it, and setting `core.hooksPath` in the SHARED git config, which a
// worktree layout propagates to the primary clone. Nothing was lost (every write is refuse-by-
// default without `--force`), but a module whose import has side effects that large has no business
// being importable without this guard.
//
// realpathSync, NOT path.resolve — the trap check-doc-size.mjs documents: resolve() does not follow
// symlinks while fileURLToPath() yields a realpath, so under a symlinked invocation path (macOS
// /tmp -> /private/tmp, where worktrees live) they differ and the CLI would exit 0 doing nothing.
function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) main();
