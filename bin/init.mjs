#!/usr/bin/env node
// workflow-kit — init.mjs. Adopt the kit into a target repo.
//
// WHAT IT DOES: copies the portable [P] method + controls into <target>, PARAMETERIZES the
// repo-specific families into .claude/kit.config.json (a [G] binding), GENERATES the [G] files
// (entry stubs, BINDINGS, REPO_INVARIANTS, SYSTEM_MAP) from templates with placeholders, MERGES the
// three Claude Code PreToolUse hook registrations into .claude/settings.json, and — crucially —
// installs the HARNESS-AGNOSTIC pre-commit hook and sets core.hooksPath, so a non-Claude lane still
// gets the strongest enforcement floor the kit can give it (see PORTABILITY.md).
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
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { target: process.cwd(), deployBranch: "main", withGateRunners: false, force: false, printPackageScripts: false, help: false };
  const listVal = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--target") out.target = path.resolve(next());
    else if (a === "--repo-name") out.repoName = next();
    else if (a === "--remote-url") out.remoteUrl = next();
    else if (a === "--deploy-branch") out.deployBranch = next();
    else if (a === "--source-dirs") out.sourceDirs = listVal(next());
    else if (a === "--risk-tokens") out.riskTokens = listVal(next());
    else if (a === "--state-docs") out.stateDocs = listVal(next());
    else if (a === "--memory-dir") out.memoryDir = next();
    else if (a === "--with-gate-runners") out.withGateRunners = true;
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
  --remote-url <url>      fills {{REMOTE_URL}} (the identity fingerprint)
  --deploy-branch <b>     fills {{DEPLOY_BRANCH}} (default: main)
  --source-dirs a,b       repo-specific source-tree roots ⇒ kit.config.json executedPathDirs
  --risk-tokens a,b       repo-specific lane risk families ⇒ kit.config.json laneRiskTokens
  --state-docs a,b        repo CLASS: STATE docs governed by doc:size ⇒ kit.config.json stateDocs
  --memory-dir <abs>      external memory dir for the --memory advisory ⇒ kit.config.json memoryDir
  --with-gate-runners     also copy the Codex/Gemini gate runner scripts (need codex/agy at runtime)
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

function appendGitignore(target, lines) {
  const gi = path.join(target, ".gitignore");
  let text = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l));
  if (!add.length) return "unchanged";
  if (text.length && !text.endsWith("\n")) text += "\n";
  text += (text.length ? "\n" : "") + "# workflow-kit: lane declaration + ledger are per-session, gitignored\n" + add.join("\n") + "\n";
  writeFileSync(gi, text);
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
  // path SEGMENTS for source dirs and risk tokens; a nested value like "app/server" would be written to
  // kit.config.json and then rejected as MALFORMED by every control — fail-closed but SILENT, the kind
  // of footgun that gets a frustrated adopter to disable the control (FM5). Catch it here, loudly.
  for (const [flag, list] of [["--source-dirs", args.sourceDirs], ["--risk-tokens", args.riskTokens]]) {
    const bad = (list || []).filter((s) => !isSegment(s));
    if (bad.length) { console.error(`init: ${flag} values must be single path segments (no "/"); got ${JSON.stringify(bad)}. The controls match top-level dirs / word fragments — pass e.g. "app", not "app/server".`); process.exit(2); }
  }
  const badState = (args.stateDocs || []).filter((s) => { const n = path.posix.normalize(s); return s.startsWith("/") || s.includes("\\") || n === ".." || n.startsWith("../"); });
  if (badState.length) { console.error(`init: --state-docs must be in-repo relative paths (no absolute, no escaping ".."); got ${JSON.stringify(badState)}.`); process.exit(2); }

  ensureDir(T);
  log(`workflow-kit init → ${T}`);
  const remaining = []; // unfilled placeholders the adopter must complete

  // 1. [P] core method docs (verbatim).
  const core = copyTree(path.join(KIT_ROOT, "core"), path.join(T, "core"), force);
  log(`  core/ method docs: ${core.filter(([, s]) => s === "written").length} written, ${core.filter(([, s]) => s === "skipped").length} kept`);

  // 2. [P] PreToolUse hooks (verbatim mechanism). Report kept-vs-written honestly: a KEPT (existing)
  // hook may be STALE, so "installed" would over-claim (a control believed current but actually old).
  let hooksKept = 0;
  for (const h of readdirSync(path.join(KIT_ROOT, "hooks"))) {
    const d = path.join(T, ".claude", "hooks", h);
    if (copyGuarded(path.join(KIT_ROOT, "hooks", h), d, force) === "written") chmodX(d); else hooksKept++;
  }
  log(hooksKept
    ? `  .claude/hooks/: ${3 - hooksKept} installed, ${hooksKept} EXISTING kept — may be STALE; re-run with --force to update`
    : `  .claude/hooks/: 3 PreToolUse guards installed`);

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

  // 5. settings.json — MERGE the PreToolUse registrations. HONOR the return: never log "merged" when
  // the guards were not actually registered (that is the "manufactured assurance" fail-open).
  const mergeResult = mergeSettings(path.join(T, ".claude", "settings.json"), path.join(KIT_ROOT, "templates", "settings.json"), force);
  if (mergeResult === "written") log(`  .claude/settings.json: PreToolUse registrations merged`);
  else if (mergeResult === "skipped") warn(`.claude/settings.json: NOT merged (see warning above) — the 3 PreToolUse guards are NOT registered. Fix the file and re-run with --force, or register them by hand.`);
  else warn(`.claude/settings.json: post-write verification FAILED — the guards are NOT confirmed on disk. Inspect ${path.join(T, ".claude", "settings.json")} before trusting the Claude-lane controls.`);

  // 6. .claude/kit.config.json — the [G] repo-specific families (the ONLY parameterized DATA).
  const config = {};
  if (args.sourceDirs) config.executedPathDirs = args.sourceDirs;
  if (args.riskTokens) config.laneRiskTokens = args.riskTokens;
  if (args.stateDocs) config.stateDocs = args.stateDocs;
  if (args.memoryDir) config.memoryDir = args.memoryDir;
  const cfgPath = path.join(T, ".claude", "kit.config.json");
  let cfgKept = false;
  if (existsSync(cfgPath) && !force) { warn(`exists, kept (use --force to overwrite): ${cfgPath}`); cfgKept = true; }
  else { ensureDir(path.dirname(cfgPath)); writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n"); }
  log(cfgKept
    ? `  .claude/kit.config.json: EXISTING kept — on-disk file unchanged; the flags you passed were NOT applied`
    : `  .claude/kit.config.json: ${Object.keys(config).length ? Object.keys(config).join(", ") : "empty (portable defaults)"}`);

  // 7. [G] generated files from templates (placeholders the adopter completes).
  const vars = {
    REPO_NAME: args.repoName || "{{REPO_NAME}}",
    REMOTE_URL: args.remoteUrl || "{{REMOTE_URL}}",
    DEPLOY_BRANCH: args.deployBranch || "main",
  };
  const gen = [
    ["CLAUDE.md.tmpl", "CLAUDE.md"],
    ["AGENTS.md.tmpl", "AGENTS.md"],
    ["BINDINGS.md.tmpl", "core/BINDINGS.md"],
    ["REPO_INVARIANTS.md.tmpl", "core/REPO_INVARIANTS.md"],
    ["SYSTEM_MAP.md.tmpl", "core/SYSTEM_MAP.md"],
  ];
  for (const [tmpl, dst] of gen) {
    const d = path.join(T, dst);
    if (existsSync(d) && !force) { warn(`exists, kept (use --force to overwrite): ${d}`); continue; }
    const text = fillTemplate(path.join(KIT_ROOT, "templates", tmpl), vars);
    ensureDir(path.dirname(d));
    writeFileSync(d, text);
    if (/\{\{[A-Z0-9_]+\}\}/.test(text)) remaining.push(dst); // include digit-bearing tokens ({{INVARIANT_1}})
  }
  log(`  [G] entry stubs + BINDINGS + REPO_INVARIANTS + SYSTEM_MAP generated`);

  // 8. .gitignore (lane declaration + ledger are per-session).
  appendGitignore(T, [".claude/task-lane.json", ".claude/lane-ledger.jsonl"]);

  // 9. Post-init checklist.
  log(`\nAdopted workflow-kit v${readFileSync(path.join(KIT_ROOT, "VERSION"), "utf8").trim()}. Next:`);
  log(`  1. Complete the placeholders in: ${remaining.length ? remaining.join(", ") : "(none — all filled)"}`);
  log(`  2. Add these scripts to package.json:  node bin/init.mjs --print-package-scripts`);
  log(`  3. Wire "doc:size" + "test:kit-controls" into your CI / npm test.`);
  log(`  4. READ PORTABILITY.md — the three PreToolUse hooks bind ONLY the Claude Code lane. A`);
  log(`     Codex / non-Claude lane is bound by AGENTS.md prose + the pre-commit hook you just`);
  log(`     installed — NOT by the PreToolUse guards. Do not imply otherwise to your team.`);
}

main();
