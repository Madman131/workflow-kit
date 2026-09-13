#!/usr/bin/env node
// workflow-kit — init.mjs. Adopt the kit into a target repo.
//
// WHAT IT DOES: copies the portable [P] method + controls into <target>, PARAMETERIZES the
// repo-specific families into .claude/kit.config.json (a [G] binding), GENERATES the [G] files
// (entry stubs, BINDINGS, REPO_INVARIANTS, SYSTEM_MAP, OWNER_COMMS) from templates with placeholders,
// installs the dual-lane SKILLS (one shared body under .agents/skills/, a thin shim per harness),
// MERGES the Claude Code hook registrations into .claude/settings.json — four PreToolUse guards, three
// PreToolUse sensors (they print and never deny), two Stop sensors (comms nudge, token ledger; both fail OPEN)
// — and, crucially, installs the HARNESS-AGNOSTIC
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
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ONE predicate for "is the Owner-comms sensor armed?", imported from the hook that enforces it —
// never a second hand-kept copy here. A paraphrase drifted from the original once already and made
// init announce ARMED on repos where the hook was unconditionally dormant.
import { ownerContract } from "../hooks/guard-owner-comms.mjs";
// Same rule, same source: the controller already owns "which environment variables relocate git",
// and a second hand-kept list here would drift from the one the guards enforce.
import { gitLocationOverrides } from "../hooks/repair-dispatch-state.mjs";

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
  "--source-dirs", "--state-docs", "--memory-dir", "--worktree-roots", "--with-gate-runners",
  "--codex-prompts-dir", "--skip-codex-prompt", "--codex-cold-model", "--skip-codex-lane",
  "--pm-model", "--pm-effort", "--builder-model", "--builder-effort", "--gather-model", "--gather-effort",
  "--astra-consult-model", "--astra-consult-effort",
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
    else if (a === "--worktree-roots") {
      // VALIDATED HERE, not at the guard alone. guard-cross-repo-writes DENIES every write on a
      // config it cannot read, so a relative entry written by this installer would hand the adopter
      // a repo whose file tools are dead until they hand-edit JSON. Refuse it in arg parsing, before
      // anything is written, the way --owner-name and --codex-cold-model refuse their bad shapes.
      const roots = listVal(next());
      const bad = roots.filter((r) => !path.isAbsolute(r));
      if (bad.length) {
        console.error(`init: --worktree-roots takes ABSOLUTE paths (got ${bad.map((b) => JSON.stringify(b)).join(", ")}). A relative root would resolve against whatever working directory the harness hands the guard, which is the wrong-base fail-open the guard refuses — so it is rejected here rather than written into a config that would then block every write.`);
        process.exit(2);
      }
      out.worktreeRoots = roots;
    }
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
    else if (["--pm-model", "--builder-model", "--gather-model", "--astra-consult-model"].includes(a)) {
      const v = next();
      if (!/^[A-Za-z0-9._:\/-]+$/.test(v) || v.includes("{{")) {
        console.error(`init: ${a} must be an exact plain model id matching [A-Za-z0-9._:/-]+ (got ${JSON.stringify(v)}); aliases and placeholders are not bindings.`);
        process.exit(2);
      }
      out[{ "--pm-model": "pmModel", "--builder-model": "builderModel", "--gather-model": "gatherModel", "--astra-consult-model": "astraConsultModel" }[a]] = v;
    }
    else if (["--pm-effort", "--builder-effort", "--gather-effort", "--astra-consult-effort"].includes(a)) {
      const v = next();
      if (!/^(?:none|minimal|low|medium|high|xhigh|max|ultra)$/.test(v)) {
        console.error(`init: ${a} must be an explicit supported effort (none|minimal|low|medium|high|xhigh|max|ultra), not ${JSON.stringify(v)}.`);
        process.exit(2);
      }
      out[{ "--pm-effort": "pmEffort", "--builder-effort": "builderEffort", "--gather-effort": "gatherEffort", "--astra-consult-effort": "astraConsultEffort" }[a]] = v;
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
  --worktree-roots a,b    ABSOLUTE roots where THIS repo's private worktrees live ⇒ kit.config.json
                          worktreeRoots, which guard-cross-repo-writes adds to its allowed write
                          roots. Omitted ⇒ the shipped roots only (project dir, ~/.claude, /tmp,
                          /private/tmp)
  --with-gate-runners     also copy the Codex/Gemini gate runner scripts (need codex/agy at runtime)
  --codex-prompts-dir <d> where the Codex prompts install — /thread-restart and the skill shims
                          (default: ~/.codex/prompts, USER-GLOBAL — outside the target repo;
                          parameterize it for a hermetic run)
  --skip-codex-prompt     do not install any Codex prompt (the Claude command, the Claude skill
                          shims, the shared skill bodies and the AGENTS.md pointer still install)
  --codex-cold-model <m>  fills the Codex cold-review seat's {{CODEX_COLD_MODEL}}. Omitted ⇒ the
                          placeholder stays and that seat is UNUSABLE until you fill it by hand
  --pm-model/--pm-effort <v>
                          bind the PM's exact model and effort in generated BINDINGS.md
  --builder-model/--builder-effort <v>
                          bind the Builder's exact model and effort in generated BINDINGS.md
  --gather-model/--gather-effort <v>
                          bind the Gather seat's exact model and effort in generated BINDINGS.md
  --astra-consult-model/--astra-consult-effort <v>
                          bind the Astra consult seat's exact model and effort in generated BINDINGS.md
  --skip-codex-lane       do not write <repo>/.codex/ at all (config.toml + the cold-review seat).
                          These are Codex-lane CONVENIENCES — they carry NO enforcement (see
                          the kit's PORTABILITY.md § The enforcement asymmetry)
  --force                 overwrite existing generated files (settings.json is always merged; an
                          existing .claude/kit.config.json is REFUSED, not overwritten, unless every
                          family it already holds is named on this command line)
  --print-package-scripts print the npm scripts to add to your package.json, then exit
  -h, --help              this help

Every family is OPTIONAL — omitted ⇒ the kit's portable defaults. That is for a FIRST install: once
.claude/kit.config.json exists, a --force run that omits a family the file already holds is REFUSED
rather than reset to the default. See the kit's PORTABILITY.md for the
enforcement asymmetry (the PreToolUse hooks bind only the Claude Code lane; the pre-commit hook and
AGENTS.md prose are what bind every lane).`;

const PACKAGE_SCRIPTS = {
  "doc:size": "node scripts/check-doc-size.mjs",
  "census:worktrees": "node scripts/worktree-census.mjs",
  "report:tokens": "node scripts/token-report.mjs",
  "confirm:repair-brief": "node scripts/confirm-repair-brief.mjs",
  "record:repair-event": "node scripts/record-repair-event.mjs",
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
// that registers nothing, and one that appears in real config files. So the current TABLE is tracked, and only
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

// lstat, never stat/existsSync — both FOLLOW links, so to the overwrite paths a symlink looks like
// its target: a symlinked dst (or a symlink squatting in the `.bak` slot) turns a --force upgrade
// into a write OUTSIDE this install that exits 0. A dangling link matters too (existsSync says
// false while a write through it still creates the external target), which is why this asks "is a
// LINK here", not "does a file exist here".
function isSymlinkAt(p) { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }

// Where `p` WOULD live, resolved without creating anything: realpath the deepest ancestor that
// already exists, then re-append the segments still missing. A directory that does not exist yet
// has no realpath — realpathOrSelf hands back the literal path, which reads as inside the target
// even when an existing symlinked ancestor (`.claude` → elsewhere) puts it outside. The containment
// check has to answer BEFORE mkdir runs, or the escape is already carved into the external
// directory, so it cannot rely on the parent existing.
//
// The walk is LSTAT-FIRST for the reason every other check here is: existsSync FOLLOWS links, so a
// DANGLING `.claude` read as "nothing here yet", the walk resolved the path INSIDE the target,
// containment passed — and ensureDir then threw a raw ENOENT stack trace, exit 1 with no refusal
// report, after core/ had already been written. A link that resolves NOWHERE is a REFUSAL with a
// sentence, not a crash. Returns { resolved } or { blocked: <why, with the remedy> }.
function resolveWithoutCreating(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    let link = null;
    try { link = lstatSync(cur); } catch { /* nothing at this component at all — keep walking up */ }
    if (link) {
      let real = null;
      try { real = statSync(cur); } catch { /* a link whose target is not there */ }
      if (!real) {
        let to = "?";
        try { to = readlinkSync(cur); } catch { /* unreadable link: the path alone names it */ }
        return { blocked: `is reached through ${cur}, a DANGLING symlink (→ ${to}) that resolves NOWHERE — creating it would build this install's tree at the link's target, outside the repo. Replace the link with a real directory and re-run.` };
      }
      // A REGULAR FILE where a directory must be is deliberately NOT refused here. Two call sites
      // are failure-ISOLATED by design — the agents install and the user-global Codex prompt write
      // let their mkdir throw into their own try/catch, warn, and let the adopt finish — and
      // acceptance pins both. Refusing here would fail the whole run over an isolated write.
      // Only the DANGLING case above is this walk's to answer.
      return { resolved: path.join(realpathOrSelf(cur), ...tail) };
    }
    const up = path.dirname(cur);
    if (up === cur) return { resolved: path.join(cur, ...tail) };   // filesystem root: nothing exists
    tail.unshift(path.basename(cur));
    cur = up;
  }
}

// ONE answer for "may this run create things inside <dir>?" — null when it may, else the sentence
// saying why not, remedy included. Every write path asks this BEFORE its first mkdir.
function writeBlockedReason(dir) {
  const r = resolveWithoutCreating(dir);
  if (r.blocked) return r.blocked;
  const inside = writeRoots.some((root) => {
    const rr = resolveWithoutCreating(root);
    if (rr.blocked) return false;   // a root we cannot resolve contains nothing — fail closed
    return r.resolved === rr.resolved || r.resolved.startsWith(rr.resolved + path.sep);
  });
  return inside ? null
    : `resolves OUTSIDE the install target (${r.resolved}) — a symlinked intermediate directory would carry this write out of the repo. Replace it with a real directory and re-run.`;
}

// The roots this run may write under — the repo target plus the user-global Codex prompts dir —
// set by main() before the first copy. A dst whose REAL parent directory escapes both is being
// routed through a symlinked INTERMEDIATE directory (`.claude/hooks` → elsewhere), which the
// per-file lstat above cannot see: the file inside the linked dir is a regular file. Resolved
// lazily per write, so a root that main() only just created (or one under macOS's /tmp symlink)
// compares by its real path — and by the SAME rule on both sides, so a root that does not exist
// yet is not a spurious mismatch. An empty roots list refuses everything — fail closed, not open.
let writeRoots = [];

// ONE writer for every `<dst>.bak`, preserving rather than damaging — and never at the price of
// the SECOND upgrade. Refusing a differing prior .bak protected the first hand edit and then made
// every later upgrade impossible: V1→V2 leaves .bak=V1, so V2→V3 wants to save V2, finds V1, and
// hard-fails the run forever after. A backup slot that can hold exactly one generation is not a
// backup system. So a differing prior .bak is ROTATED to the first free `<dst>.bak.<n>` and this
// run's copy takes the .bak slot: nothing is destroyed, upgrades flow, and every generation of an
// adopter's edits stays on disk. Ordering: `.bak` always holds THIS run's copy (the newest); the
// numbered slots fill in the order generations were rotated OUT, so `.bak.1` is the OLDEST and a
// HIGHER n is newer (`.bak.1` older than `.bak.2`). The test pins exactly this.
// What still REFUSES is a backup that genuinely cannot be taken: a symlink in the .bak slot or in
// a rotation slot (init does not write through links, and rotating onto one would destroy it), a
// non-regular file squatting in the .bak slot (it is not a backup generation and moving an
// adopter's directory aside is not this function's call), a rotation or write that fails, or
// generations piled past the cap. Identical content passes untouched (an idempotent rerun).
// Returns true when the backup is in place; false = refused, already warned here — the CALLER
// records the refusal and must not overwrite dst.
const BAK_ROTATION_LIMIT = 100;
// The first `<bak>.<n>` with NOTHING at it (lstat, so a dangling link counts as occupied). Returns
// null when the rotation cannot be done safely — warned here.
function freeRotationSlot(bak) {
  for (let n = 1; n <= BAK_ROTATION_LIMIT; n++) {
    const slot = `${bak}.${n}`;
    let st = null;
    try { st = lstatSync(slot); } catch { return slot; }
    if (st.isSymbolicLink()) {
      warn(`REFUSED: ${slot} is a SYMLINK — init does not write through links, and rotating the earlier backup onto it would destroy the link. Move it aside and re-run.`);
      return null;
    }
  }
  warn(`REFUSED: ${bak}.1 through ${bak}.${BAK_ROTATION_LIMIT} are all taken — that is ${BAK_ROTATION_LIMIT} kept backup generations. Move the old ones aside and re-run.`);
  return null;
}
function saveBackup(dst, bytes) {
  const bak = `${dst}.bak`;
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (isSymlinkAt(bak)) {
    warn(`REFUSED: ${bak} is a SYMLINK — init does not write through links. Replace it with a regular file and re-run.`);
    return false;
  }
  if (existsSync(bak)) {
    let same = false;
    try { same = readFileSync(bak).equals(data); } catch { /* unreadable/non-file: not provably same */ }
    if (same) return true;
    let st = null;
    try { st = lstatSync(bak); } catch { /* raced away between the two calls: treated as unrotatable */ }
    if (!st || !st.isFile()) {
      warn(`REFUSED: a prior backup at ${bak} would be destroyed (it is not a regular file, so it cannot be rotated aside) — it may be the only copy of an earlier hand edit. Move it aside first, then re-run.`);
      return false;
    }
    const slot = freeRotationSlot(bak);
    if (!slot) return false;
    try { renameSync(bak, slot); } catch {
      warn(`REFUSED: could not rotate the earlier backup ${bak} to ${slot} — nothing was overwritten. Free ${slot} and re-run.`);
      return false;
    }
    warn(`rotated: the earlier backup is kept at ${slot}; this run's backup takes ${bak}`);
  }
  try { writeFileSync(bak, data); } catch {
    warn(`REFUSED: could not write the backup ${bak} — the existing file is untouched. Free ${bak} and re-run.`);
    return false;
  }
  return true;
}

// Copy refusing to clobber unless force. Returns "written" | "skipped" | "refused".
// A MECHANISM skip COMPARES BYTES: a kept file identical to this kit is a completed install, but a
// kept MECHANISM file that DIFFERS — the controller, guards, recorder, scripts, core doctrine,
// installed tests, and the GATE-MACHINERY skills (orchestrate, frontier-review) with their shims
// and reviewer agents — is a stale install this rerun did not upgrade, and a rerun that keeps old
// mechanism bytes while exiting 0 tells an upgrading adopter the upgrade happened. Those keeps are
// collected and FAIL the run at the end. Convenience surfaces an adopter legitimately localizes —
// the thread-restart commands, the Codex lane config, and the personal skills (humanize and the
// ritual set, which name the adopter's own Owner) — pass `mechanism: false` and stay a plain keep.
// Under --force, ANY existing file whose bytes differ is backed up to `<dst>.bak` BEFORE
// overwrite — mechanism and convenience alike: the files this flag replaces include an adopter's
// customized pre-commit hook, gate runners and personal skills, and destroying the only copy of a
// hand edit is not an upgrade. A backup that cannot be taken REFUSES the overwrite rather than
// proceeding — same rule as the [G] path — and every refusal is collected into the end-of-run
// failure report: a refused upgrade that exits 0 tells an upgrading adopter the upgrade happened.
let staleKept = [];
let backupRefused = [];
// Per-checkout paths init just ignored that git STILL indexes (or could not be checked): an ignore
// rule never untracks a path, and init never untracks one for the adopter, so each is a failing
// state named at the exit code — see certifyIgnored.
let indexedLeaks = [];
function copyGuarded(src, dst, force, mechanism = true) {
  // The symlink refusal runs UNCONDITIONALLY, above both existsSync gates: existsSync FOLLOWS
  // links, so a DANGLING dst symlink read "nothing here", fell through both branches, and the
  // plain write below created the link's external target — on plain and force runs alike. The
  // .bak slot is refused the same way: "backing up" onto a link would send the adopter's bytes
  // into the link's target instead of preserving them beside the file. The link stays untouched.
  if (isSymlinkAt(dst) || isSymlinkAt(`${dst}.bak`)) {
    backupRefused.push(dst);
    warn(`REFUSED: ${isSymlinkAt(dst) ? dst : `${dst}.bak`} is a SYMLINK — init does not write through links. Replace it with a regular file and re-run.`);
    return "refused";
  }
  // An INTERMEDIATE directory symlink routes the whole write outside the install — the file
  // inside the linked dir is a regular file, so only the resolved PARENT exposes it. The check
  // runs BEFORE any mkdir: creating the parent first refused each FILE write but had already built
  // the directory tree inside the external target (with `.claude` linked out, a dozen directories
  // an adopter never asked for, in someone else's repo). A refusal creates nothing.
  const blocked = writeBlockedReason(path.dirname(dst));
  if (blocked) {
    backupRefused.push(dst);
    warn(`REFUSED: the directory holding ${dst} ${blocked}`);
    return "refused";
  }
  ensureDir(path.dirname(dst));
  if (existsSync(dst) && !force) {
    if (mechanism) {
      let differs = true;
      try { differs = !readFileSync(src).equals(readFileSync(dst)); } catch { /* unreadable = differs */ }
      if (differs) {
        staleKept.push(dst);
        warn(`exists, KEPT BUT STALE against this kit (use --force to upgrade): ${dst}`);
        return "skipped";
      }
    }
    warn(`exists, kept (use --force to overwrite): ${dst}`);
    return "skipped";
  }
  if (force && existsSync(dst)) {
    let differs = true;
    try { differs = !readFileSync(src).equals(readFileSync(dst)); } catch { /* unreadable = differs */ }
    if (differs) {
      let cur = null;
      try { cur = readFileSync(dst); } catch { /* unreadable: cannot preserve it */ }
      if (cur === null || !saveBackup(dst, cur)) {
        backupRefused.push(dst);
        if (cur === null) warn(`REFUSED: could not read ${dst} to back it up — the existing file is untouched.`);
        return "refused";
      }
      warn(`backed up: ${dst}.bak (your edited version; the kit's replaces it)`);
    }
  }
  copyFileSync(src, dst);
  return "written";
}
// The gate-machinery skill set — doctrine an agent EXECUTES, upgraded with the kit. The personal
// skills stay adopter-owned.
const MECHANISM_SKILLS = new Set(["orchestrate", "frontier-review"]);

// core/ files the [G] template table GENERATES (step 7). copyTree must never ship a kit-local copy
// of one of these: a [G] doc names THIS repo's bindings and people, and copying one repo's into
// another is exactly the cross-repo confusion the identity fingerprint exists to prevent. The
// shipped kit carries none of them in core/, but a working checkout can (its own gate-rig copy) —
// and before this filter that file rode copyTree into every adopter, then OSCILLATED with the
// generated version on each --force, tripping the prior-backup refusal on a file no adopter wrote.
const GENERATED_CORE = new Set(["BINDINGS.md", "REPO_INVARIANTS.md", "SYSTEM_MAP.md", "OWNER_COMMS.md"]);

// A mechanism family excluded by its skip/omit flag but PRESENT on disk still gets the READ-ONLY
// stale comparison — the same rule the skipped .codex lane follows: this run just KEPT those
// bytes, and exiting 0 over a differing keep claims an upgrade that did not happen. Nothing in
// the skipped family is written.
function staleCheckSkipped(src, dst, remedy) {
  if (!existsSync(dst)) return;   // absent is not a stale KEEP — nothing was kept
  let differs = true;
  try { differs = !readFileSync(src).equals(readFileSync(dst)); } catch { /* unreadable = differs */ }
  if (differs) {
    staleKept.push(dst);
    warn(`exists, KEPT BUT STALE against this kit (${remedy}): ${dst}`);
  }
}

// --force is GLOBAL and it is also the remedy init itself recommends for a stale hook ("re-run with
// --force to update"). That combination silently destroys hand-authored content in the `[G]` files —
// most painfully core/OWNER_COMMS.md, whose whole value is the paragraphs a human wrote about a
// person. (.claude/kit.config.json used to be the other one — a rewrite from a partial flag set
// quietly WIDENED the write guard, and this .bak was all that stood behind it. Step 6 no longer
// relies on that: it REFUSES the overwrite unless every family the file holds was named on the
// command line, so the guard is prevented from widening rather than merely recoverable.)
// Before overwriting a file whose content differs from what we are about to write, keep a .bak beside
// it and say so. Cheap, reversible, and it makes the documented upgrade path non-destructive.
// Returns "not-needed" (no existing file, or identical content) | "backed-up" | "FAILED".
// FAILED is load-bearing: the caller MUST NOT overwrite. A backup that silently does not happen is
// worse than no backup at all, because the console says the upgrade path is recoverable.
function backupBeforeOverwrite(dst, nextText) {
  if (!existsSync(dst)) return "not-needed";
  let current;
  // Read the backup SOURCE as raw BYTES (no encoding), so a non-UTF-8 file is preserved
  // byte-for-byte rather than round-tripped through a lossy utf8 decode — "your previous version is
  // saved" must be literally true. Unreadable but present: we cannot preserve it, so we must not
  // destroy it either.
  try { current = readFileSync(dst); } catch { return "FAILED"; }
  if (current.equals(Buffer.from(nextText))) return "not-needed";  // identical — nothing to preserve
  if (!saveBackup(dst, current)) return "FAILED";  // symlinked/blocked/prior-differing .bak all refuse
  warn(`OVERWROTE ${dst} (--force); your previous version is saved at ${dst}.bak`);
  return "backed-up";
}

// Write `text` to `dst`, but never destroy differing content we failed to preserve. Returns whether
// the write happened, so callers report honestly rather than assuming.
function writeWithBackup(dst, text) {
  // Same symlink refusal as copyGuarded's force path, same reason, same accounting.
  if (isSymlinkAt(dst) || isSymlinkAt(`${dst}.bak`)) {
    backupRefused.push(dst);
    warn(`REFUSED to overwrite ${dst}: ${isSymlinkAt(dst) ? "it" : `${dst}.bak`} is a SYMLINK, and init does not write through links. Replace it with a regular file and re-run.`);
    return false;
  }
  // Same intermediate-directory containment as copyGuarded, same reason, same accounting — and
  // like copyGuarded it answers BEFORE the mkdir, so a refusal leaves no directory behind it.
  const blocked = writeBlockedReason(path.dirname(dst));
  if (blocked) {
    backupRefused.push(dst);
    warn(`REFUSED to overwrite ${dst}: its directory ${blocked}`);
    return false;
  }
  ensureDir(path.dirname(dst));
  if (backupBeforeOverwrite(dst, text) === "FAILED") {
    backupRefused.push(dst);
    warn(`REFUSED to overwrite ${dst}: its previous content could not be backed up (is ${dst}.bak writable?). The existing file is UNCHANGED — move it aside yourself, then re-run.`);
    return false;
  }
  // The final write is guarded too: a raw EACCES here would throw uncaught and kill the end-of-run
  // accounting that runs after every write. A backup is already safely beside it, so this fails
  // CLOSED as a counted refusal, not a crash.
  try { writeFileSync(dst, text); } catch {
    backupRefused.push(dst);
    warn(`REFUSED to overwrite ${dst}: the write itself failed (is ${dst} or its directory writable?). Its previous content is preserved at ${dst}.bak — fix permissions, then re-run.`);
    return false;
  }
  return true;
}

function copyTree(srcDir, dstDir, force, filter = () => true, mechanism = true) {
  const results = [];
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) results.push(...copyTree(s, d, force, filter, mechanism));
    else if (entry.isFile() && filter(entry.name, s)) results.push([d, copyGuarded(s, d, force, mechanism)]);
  }
  return results;
}

function chmodX(abs) { try { chmodSync(abs, 0o755); } catch { /* best-effort */ } }

function fillTemplate(tmplPath, vars) {
  let text = readFileSync(tmplPath, "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  return text;
}

// Merge our PreToolUse registrations (4 guards + 3 sensors) and Stop registrations (2 sensors) into an existing settings.json, or create it.
function mergeSettings(targetSettings, kitSettings, force) {
  // A SYMLINKED settings.json refuses the merge on BOTH paths: the parse-OK branch wrote
  // unconditionally, so a link here had its EXTERNAL target rewritten — no .bak, exit 0, on plain
  // and force runs alike (the one file the backup machinery below never saw). lstat first, so a
  // dangling link cannot read as "absent" and be created through.
  if (isSymlinkAt(targetSettings)) {
    const resolved = realpathOrSelf(targetSettings);
    if (force) {
      backupRefused.push(targetSettings);
      warn(`REFUSED to merge into ${targetSettings}: it is a SYMLINK (resolves to ${resolved}), and init does not write through links. Replace the link with a regular file — or add the registrations to ${resolved} yourself — then re-run.`);
    } else {
      warn(`${targetSettings} is a SYMLINK (resolves to ${resolved}) — left untouched: init does not write through links. Replace the link with a regular file, or add the registrations to ${resolved} yourself.`);
    }
    return "skipped";
  }
  // …and the same INTERMEDIATE-directory containment every other write pays. This one write
  // reached writeFileSync directly, so with `.claude` linked out the registrations were created
  // inside the external directory while every copyGuarded write beside them refused. Checked
  // before the mkdir below, and counted like every other refusal.
  const blockedDir = writeBlockedReason(path.dirname(targetSettings));
  if (blockedDir) {
    backupRefused.push(targetSettings);
    warn(`REFUSED to write ${targetSettings}: its directory ${blockedDir}`);
    return "skipped";
  }
  let existing = {};
  let raw = null;        // the file's current bytes DECODED (for the parse + change comparison)
  let rawBuf = null;     // the file's current RAW bytes — the backup source (byte-for-byte)
  let bakDone = false;   // the corrupt branch backs up early so its console claim is already true
  if (existsSync(targetSettings)) {
    try { rawBuf = readFileSync(targetSettings); raw = rawBuf.toString("utf8"); existing = JSON.parse(raw); }
    catch {
      if (!force) { warn(`existing ${targetSettings} is not valid JSON — left untouched (use --force to replace)`); return "skipped"; }
      // --force REPLACES an unparseable settings.json — adopter-owned bytes nothing here can
      // merge. The original goes to .bak first (as RAW BYTES, so non-UTF-8 adopter content is
      // preserved intact), and a backup that cannot be taken (unreadable file, a blocked or
      // prior-differing .bak slot) refuses the replacement — counted into the same refused-backup
      // accounting as every other overwrite.
      if (rawBuf === null || !saveBackup(targetSettings, rawBuf)) {
        backupRefused.push(targetSettings);
        warn(`REFUSED to replace ${targetSettings}: it is not valid JSON AND its original bytes could not be backed up to ${targetSettings}.bak. The existing file is UNCHANGED — move it aside yourself, then re-run.`);
        return "skipped";
      }
      bakDone = true;
      warn(`replacing ${targetSettings} (--force): it is not valid JSON, so nothing could be merged — your original is saved at ${targetSettings}.bak`);
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
  const out = JSON.stringify(existing, null, 2) + "\n";
  ensureDir(path.dirname(targetSettings));
  if (raw !== out) {
    // A rewrite that CHANGES the file's bytes under --force backs the original up first — the
    // same refusal semantics as every other overwrite. Identical bytes skip the write entirely
    // (no backup noise, and the verify below still reads the file that is already correct).
    if (force && rawBuf !== null && !bakDone) {
      if (!saveBackup(targetSettings, rawBuf)) {
        backupRefused.push(targetSettings);
        warn(`REFUSED to merge into ${targetSettings}: the rewrite would change it and its current bytes could not be backed up (see above). The existing file is UNCHANGED.`);
        return "skipped";
      }
      warn(`merged ${targetSettings} (--force): the rewrite changes it, so your previous version is saved at ${targetSettings}.bak`);
    }
    writeFileSync(targetSettings, out);
  }
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

// The guarded write for the two root-level APPENDS. An append rewrites a file init itself just
// generated (AGENTS.md) or is creating fresh (.gitignore), so it does NOT take a backup — a .bak of
// a file this same run wrote is pure noise (it would litter one on every adopt). It pays the rest of
// the guarded-write discipline every other site pays: the intermediate-directory containment check,
// and a write that FAILS is a typed, COUNTED refusal — never an uncaught throw. That throw is the
// bug ROOT-BATCH names: these appends run BEFORE the end-of-run accounting, so an uncaught EACCES
// here destroyed the refusal report, the stale-keep report and the armed-check along with it. The
// per-file SYMLINK refusal stays at each caller, for its file-specific "REFUSED to append" message.
// Returns true on success; false when refused (already counted + warned here).
function appendWrite(dst, text) {
  const blocked = writeBlockedReason(path.dirname(dst));
  if (blocked) { backupRefused.push(dst); warn(`REFUSED to append to ${dst}: its directory ${blocked}`); return false; }
  ensureDir(path.dirname(dst));
  try { writeFileSync(dst, text); } catch {
    backupRefused.push(dst);
    warn(`REFUSED to append to ${dst}: the write itself failed (is ${dst} or its directory writable?). The existing file is UNCHANGED — fix permissions, then re-run.`);
    return false;
  }
  return true;
}

// The two ROOT-LEVEL APPENDS (.gitignore here, AGENTS.md below) were the last writers reading with
// existsSync and writing with a bare writeFileSync — no lstat, no containment, no I/O guard. A
// symlinked .gitignore or AGENTS.md had its EXTERNAL target rewritten (the two files an adopter is
// most likely to symlink into a dotfiles repo), and an unwritable .gitignore threw uncaught mid-run.
// Both now route their write through appendWrite: symlink refused here, containment + a non-throwing
// counted write inside. Refused, counted and named like every other write. A failure never aborts
// the run — the accounting still prints and the exit code reflects it. Returns "unchanged" |
// "written" | "refused".
function appendGitignore(target, lines, comment = "workflow-kit: lane declaration, ledger and pre-send rung sidecar are per-session, gitignored") {
  const gi = path.join(target, ".gitignore");
  if (isSymlinkAt(gi)) {
    backupRefused.push(gi);
    warn(`REFUSED to append to ${gi}: it is a SYMLINK (resolves to ${realpathOrSelf(gi)}), and init does not write through links. Replace the link with a regular file — or add these entries to ${realpathOrSelf(gi)} yourself — then re-run: ${lines.join(", ")}`);
    return "refused";
  }
  let text = "";
  if (existsSync(gi)) {
    try { text = readFileSync(gi, "utf8"); }
    catch {
      backupRefused.push(gi);
      warn(`REFUSED to append to ${gi}: it exists but could not be read to preserve its contents (is it readable?). Nothing was written — fix permissions, then re-run.`);
      return "refused";
    }
  }
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l));
  if (!add.length) return "unchanged";
  if (text.length && !text.endsWith("\n")) text += "\n";
  text += (text.length ? "\n" : "") + `# ${comment}\n` + add.join("\n") + "\n";
  return appendWrite(gi, text) ? "written" : "refused";
}

// THE SENSOR ASKS GIT, NEVER ITS OWN WRITES. Root-exit record for the per-checkout ignore sensor:
// five findings over three rounds — a silent residual, exit 0 on a tracked path, advice that assumed
// a refused append, a text dedupe that a later negation defeats, a redirected index certified as
// clean — were one class: the sensor trusted what init had written instead of asking git what is in
// effect. So, after each per-checkout ignore append, it asks git two questions about the real path
// the sensor writes, and counts a refusal on any answer that is not "ignored, and not indexed":
//   1. `git check-ignore -q --no-index -- <probe>` — is the rule IN EFFECT? Not the text's presence:
//      a later negation, an overriding rule, or a refused append all read as "not ignored" here.
//   2. `git ls-files -- <rel>` — is the path already INDEXED? An ignore rule never untracks one.
// Posture, the installer's own: not a repository ⇒ nothing to ask (the hooksPath block already said
// so); a git location override (GIT_DIR, GIT_INDEX_FILE, …) redirects what git would answer ⇒ a
// counted refusal naming it, because a certification against a redirected index is no
// certification; git failing to answer ⇒ a counted refusal naming git's error. init never untracks
// a file and never edits a .gitignore line: each refusal carries the exact command instead.
function certifyIgnored(target, rel, probe) {
  if (!isGitRepo(target)) return;
  const here = path.join(target, rel);
  const overrides = gitLocationOverrides(process.env).slice();
  if (typeof process.env.GIT_INDEX_FILE === "string" && process.env.GIT_INDEX_FILE.trim() !== "" && !overrides.includes("GIT_INDEX_FILE")) overrides.push("GIT_INDEX_FILE");
  if (overrides.length) {
    indexedLeaks.push(`${here} (could NOT be certified: ${overrides.join(", ")} redirect what git answers)`);
    warn(`REFUSED to certify ${rel}: ${overrides.join(", ")} ${overrides.length > 1 ? "are" : "is"} set, which redirects the index or repository git would answer about. Unset ${overrides.length > 1 ? "them" : "it"} and re-run, or check yourself: git check-ignore -v -- ${probe}; git ls-files -- ${rel}`);
    return;
  }
  const gitq = (args) => {
    try { execFileSync("git", ["-C", target, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return { status: 0 }; }
    catch (e) { return { status: typeof e?.status === "number" ? e.status : -1, err: String(e && e.stderr ? e.stderr : e).trim().split("\n")[0] }; }
  };
  const ig = gitq(["check-ignore", "-q", "--no-index", "--", probe]);
  if (ig.status === 1) {
    indexedLeaks.push(`${here} (the ignore rule is NOT in effect)`);
    warn(`${rel} is NOT ignored by git after init's append — a later negation or overriding rule, or the append itself was refused (see above). Fix .gitignore so that  git check-ignore -q --no-index -- ${probe}  exits 0, then re-run. init does not edit .gitignore lines for you.`);
  } else if (ig.status !== 0) {
    indexedLeaks.push(`${here} (could NOT be certified: ${ig.err || "git failed"})`);
    warn(`REFUSED to certify ${rel}: git could not say whether it is ignored (${ig.err || "git failed"}). A control that cannot look never reads as green — check it yourself: git check-ignore -v -- ${probe}`);
  }
  let listed;
  try {
    listed = execFileSync("git", ["-C", target, "ls-files", "--", rel], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const why = String(e && e.stderr ? e.stderr : e).trim().split("\n")[0] || "git failed";
    indexedLeaks.push(`${here} (could NOT be certified: ${why})`);
    warn(`REFUSED to certify ${rel}: init could not ask git whether it is already tracked (${why}). Check it yourself: git ls-files -- ${rel}`);
    return;
  }
  if (!listed.trim()) return;
  const cmd = `git rm --cached ${rel.endsWith("/") ? "-r " : ""}-- ${rel}`;
  indexedLeaks.push(here);
  warn(`${rel} is ALREADY TRACKED in this repository. An ignore rule never untracks an indexed path: it keeps changing, and any blanket add keeps committing it, until you run  ${cmd}  and commit${ig.status === 1 ? " — AFTER fixing the ignore rule above, or the next blanket add re-adds it" : ""}. init does not make that change for you.`);
}

// Append the /thread-restart fallback pointer to AGENTS.md if absent (idempotent via a stable marker,
// same shape as appendGitignore). The pointer text is a single [P] source (commands/agents-pointer.md)
// so the Claude command, the Codex prompt, and this pointer never drift. A re-run — or an AGENTS.md that
// already carries the marker — is a clean no-op, and the block is short enough to keep AGENTS.md (an
// 8 KiB-capped entry doc) well under cap.
function appendAgentsPointer(target, kitRoot) {
  const agents = path.join(target, "AGENTS.md");
  // lstat BEFORE existsSync, for appendGitignore's reason and one more: existsSync FOLLOWS links,
  // so a DANGLING AGENTS.md link read "absent" and returned quietly while a write through it would
  // have created the link's external target.
  if (isSymlinkAt(agents)) {
    backupRefused.push(agents);
    warn(`REFUSED to append to ${agents}: it is a SYMLINK (resolves to ${realpathOrSelf(agents)}), and init does not write through links. Replace the link with a regular file — or add the /thread-restart pointer to ${realpathOrSelf(agents)} yourself — then re-run.`);
    return "refused";
  }
  if (!existsSync(agents)) return "absent"; // init generates AGENTS.md before this runs; guard anyway
  const fragment = readFileSync(path.join(kitRoot, "commands", "agents-pointer.md"), "utf8");
  const marker = "workflow-kit:thread-restart-pointer";
  let text;
  try { text = readFileSync(agents, "utf8"); }
  catch {
    backupRefused.push(agents);
    warn(`REFUSED to append to ${agents}: it exists but could not be read to preserve its contents (is it readable?). Nothing was written — fix permissions, then re-run.`);
    return "refused";
  }
  if (text.includes(marker)) return "unchanged";
  if (text.length && !text.endsWith("\n")) text += "\n";
  text += "\n" + fragment.trimEnd() + "\n";
  // Routed through appendWrite (containment + a non-throwing counted write). A failure does NOT
  // abort the adopt — the load-bearing hooks + commands + pre-commit are already installed and the
  // run finishes — but it IS counted, so an unwritable AGENTS.md is a visible exit 1, not a silent
  // exit 0 that claims the fallback pointer landed when it did not.
  return appendWrite(agents, text) ? "written" : "refused";
}

// `git rev-parse <flag>` for the target, trimmed — or null if git cannot answer. rev-parse is
// IMMUNE to GIT_CONFIG (the fail-closed seat verified this), so it resolves where git's writes
// really go regardless of any config-file redirect in the environment.
function gitRevParse(target, flag) {
  try {
    return execFileSync("git", ["-C", target, "rev-parse", flag], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { return null; }
}

// ROOT-BATCH CURE (write-target trust): set a git config key DIRECTLY in the target's OWN config and
// PROVE it landed there — the resolved-EFFECT discipline that replaces trusting a NAME ENUMERATION.
// A bare `git config <key> <value>` obeys GIT_CONFIG (and any future write-redirect var), so it can
// silently land the write in a FOREIGN file. We instead resolve the target's real config path with
// rev-parse (IMMUNE to GIT_CONFIG) FIRST, then pin BOTH the write and the read-back to it with `git
// config --file <that path> …`. `--file` overrides any config-file redirect, so the write lands in
// the target's own config and never escapes, and the read-back (also `--file`, also immune) confirms
// it. This PREVENTS the escape — not merely detects it after one stray write — and closes GIT_CONFIG
// and every future write-redirect var at once, without enumerating any of them. core.hooksPath is a
// --local setting, which for a linked worktree lives in the COMMON config, so the path we resolve and
// write is --git-common-dir's (rev-parse hands back a relative ".git" for a plain repo; resolve it
// against the target). Returns true iff the value provably reads back from the target's own config;
// false when git cannot resolve the target, or cannot write or read it.
function gitConfigVerified(target, key, value) {
  const commonDir = gitRevParse(target, "--git-common-dir");
  if (commonDir === null) return false;
  const configFile = path.resolve(target, commonDir, "config");
  try {
    execFileSync("git", ["-C", target, "config", "--file", configFile, key, value], { stdio: ["ignore", "pipe", "pipe"] });
  } catch { return false; }
  let readBack;
  try {
    readBack = execFileSync("git", ["-C", target, "config", "--file", configFile, "--get", key], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { return false; }   // could not read the target's own config back
  return readBack === value;
}

// Compare paths by realpath so the macOS /tmp -> /private/tmp symlink (where worktrees live) does not
// read as a spurious subdir mismatch. Falls back to path.resolve if realpath fails.
function realpathOrSelf(p) {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}

// The git-dir escape — a write git performs that goes through NONE of this file's protections.
// `git config` writes into whatever git directory the target RESOLVES to, and a `.git` that is
// NOT a plain directory can resolve into another repository entirely: core.hooksPath then landed in
// THAT repo's config, outside the install, from a run that exited 0. No per-file lstat, no
// containment check and no backup covers it, because the write is git's, not ours. This is a fast
// PRE-CHECK with a targeted message; the read-back in gitConfigVerified is the categorical backstop
// (but a `.git` POINTER is followed identically by the read-back's own rev-parse, so the pointer
// escape is caught HERE, not there).
//
// TWO escaping shapes, ONE legitimate shape that must keep working:
//   · `.git` a SYMLINK into another repo's git dir — escape.
//   · `.git` a regular FILE holding `gitdir: /elsewhere` (a plain gitdir pointer) — escape.
//   · `.git` the FILE a `git worktree` writes ("gitdir: <primary>/.git/worktrees/<name>") — NOT an
//     escape: its per-worktree gitdir is NESTED under the common dir's `worktrees/`, and
//     core.hooksPath legitimately writes to that shared COMMON config (the adopter's own repo
//     family). That nesting is the signal that tells a real worktree from a plain pointer — both
//     have a git dir OUTSIDE the target, so location alone cannot, which is why a real worktree
//     adoptee must be recognized by shape, not refused.
// A plain `.git` DIRECTORY writes in place and is checked by the read-back alone. Returns the
// resolved escaping git dir (for the message) when it escapes, else null.
function escapingGitDir(target) {
  const dotgit = path.join(target, ".git");
  let st;
  try { st = lstatSync(dotgit); } catch { return null; }   // no .git here — nothing to resolve
  const isLink = st.isSymbolicLink();
  const isFile = !isLink && st.isFile();
  if (!isLink && !isFile) return null;   // a real .git DIRECTORY: writes land in <target>/.git
  const root = realpathOrSelf(target);
  const absGitDir = gitRevParse(target, "--absolute-git-dir");
  const commonDir = gitRevParse(target, "--git-common-dir");
  if (absGitDir === null || commonDir === null) {
    // git could not resolve it; fall back to the link/file's own realpath (covers a symlink whose
    // target git dir is plain to resolve without git).
    const resolved = realpathOrSelf(dotgit);
    return (resolved === root || resolved.startsWith(root + path.sep)) ? null : resolved;
  }
  const absReal = realpathOrSelf(absGitDir);
  const commonReal = realpathOrSelf(path.resolve(target, commonDir));
  // A linked worktree: per-worktree gitdir nested under <common>/worktrees/. core.hooksPath writes
  // to the common config — allowed, and gitConfigVerified confirms it landed there.
  if (absReal.startsWith(path.join(commonReal, "worktrees") + path.sep)) return null;
  // Otherwise the write lands in the common config; escape if that resolves outside the target.
  return (commonReal === root || commonReal.startsWith(root + path.sep)) ? null : commonReal;
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

  // The FIRST write of the run is ensureDir(T) itself. A dangling symlink in T's own ancestry
  // (a `--target` under a link that resolves nowhere) made mkdir throw a raw ENOENT here — before
  // the accounting even exists — the one dangling-ancestor site the per-write guard could not cover
  // because it runs earlier. Give it the same typed refusal the other sites give, as a hard exit.
  {
    const targetBlocked = resolveWithoutCreating(T).blocked;
    if (targetBlocked) { console.error(`init: cannot create the target ${T}: it ${targetBlocked}`); process.exit(1); }
  }
  ensureDir(T);
  staleKept = [];
  indexedLeaks = [];
  backupRefused = [];
  // The two places this run is allowed to create files: the repo target and the user-global Codex
  // prompts dir. Everything else a write resolves into is an escape (see writeBlockedReason).
  writeRoots = [T, args.codexPromptsDir];
  log(`workflow-kit init → ${T}`);
  const remaining = []; // generated files still carrying unfilled placeholders
  const remainingTokens = new Map(); // dst -> the specific placeholder names still unfilled

  // 1. [P] core method docs (verbatim). The [G]-generated names are EXCLUDED: those are step 7's
  // to write from templates, and a kit checkout carrying its own local copy (see GENERATED_CORE)
  // must not ship that copy into an adopter.
  const core = copyTree(path.join(KIT_ROOT, "core"), path.join(T, "core"), force, (name) => !GENERATED_CORE.has(name));
  log(`  core/ method docs: ${core.filter(([, s]) => s === "written").length} written, ${core.filter(([, s]) => s === "skipped").length} kept`);

  // 2. [P] Claude-lane hooks (verbatim mechanism): the four PreToolUse guards, which fail CLOSED,
  // the two PreToolUse sensors, which never deny,
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
    : `  .claude/hooks/: ${hookFiles.length} files installed — PreToolUse guards (fail CLOSED), the sweep-owed, mutation-owed and context-pressure PreToolUse sensors (print, never deny), the guard-owner-comms and sensor-token-ledger Stop sensors (fail OPEN; the ledger writes .claude/metrics/tokens.jsonl, untracked), and payload-targets.mjs, which is a shared MODULE the guards import and is registered nowhere`);

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
  // ENVIRONMENT BEFORE FILESYSTEM. `git config` resolves its subject from GIT_DIR /
  // GIT_COMMON_DIR / GIT_WORK_TREE before it ever looks for a `.git`, so with any of them set the
  // link-shape refusal below never fires (the target's `.git` is a perfectly ordinary directory)
  // and the setting lands in whatever repository they select — the adopted repo left silently
  // UNARMED while the run printed "binds every lane" and exited 0. Git exports GIT_DIR to its own
  // hooks, so a run from a hook, a `rebase --exec` or a `bisect run` script hits this by accident.
  // Nothing here can tell an intentional override from an inherited one, so the write is refused
  // whenever one is present, naming what it observed — the controller's observed_overrides shape.
  const gitOverrides = gitLocationOverrides(process.env);
  if (gitOverrides.length) {
    backupRefused.push(path.join(T, ".git"));
    warn(`REFUSED to set core.hooksPath: Git LOCATION OVERRIDES are present in this environment (${gitOverrides.join(", ")}), and \`git config\` resolves its target from THOSE before the filesystem — the setting would be written into whatever repository they select, not ${T}, leaving this one silently unarmed. Re-run with them cleared: env -u ${gitOverrides.join(" -u ")} node bin/init.mjs …`);
  } else if (isGitRepo(T)) {
    // FM3/subdir footgun: `git config` writes to the repo the target belongs to. If T is a SUBDIR of a
    // larger repo, core.hooksPath is set on the PARENT pointing at parent/.githooks while the hook was
    // written under T/.githooks — unreachable. Warn rather than silently misconfigure.
    let top = null;
    try { top = execFileSync("git", ["-C", T, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); } catch { /* handled below */ }
    const escaped = escapingGitDir(T);
    if (top && realpathOrSelf(top) !== realpathOrSelf(T)) {
      warn(`${T} is a SUBDIRECTORY of git repo ${top} — core.hooksPath would be set on the parent and miss ${T}/.githooks. Adopt at the repo ROOT, or configure the hook manually.`);
    } else if (escaped) {
      // The remediation deliberately does NOT hand over the `git config` line the branch below
      // prints: running it by hand performs the very write refused here.
      backupRefused.push(path.join(T, ".git"));
      warn(`REFUSED to set core.hooksPath: this repo's git directory resolves OUTSIDE the install target (${escaped}) — ${path.join(T, ".git")} is a symlink, or a \`.git\` file holding \`gitdir: /elsewhere\`, that sends git's writes there. The setting would be written into ANOTHER repository's config, arming its commits with ${T}/.githooks and leaving this one unbound. Replace it with a real .git directory and re-run (a linked \`git worktree\` checkout, whose .git points under its primary's worktrees/, is unaffected).`);
    } else if (gitConfigVerified(T, "core.hooksPath", ".githooks")) {
      log(pcTrusted
        ? `  .githooks/pre-commit installed + core.hooksPath=.githooks (binds every lane)`
        : `  core.hooksPath=.githooks set — but the pre-commit is an EXISTING, UNVERIFIED hook (see warning above); the every-lane guarantee depends on it, NOT confirmed`);
    } else {
      // The write into the target's OWN config, or the read-back from it, failed: git could not
      // resolve --git-common-dir, or could not write/read that file. The write is PINNED to it with
      // --file, so a GIT_CONFIG / write-redirect var can no longer divert it — reaching here means a
      // REAL failure on the target's own config, not an escape. Either way the every-lane floor is
      // NOT set here — a counted refusal, not a soft warn that exits 0 on an unarmed repo.
      backupRefused.push(path.join(T, ".git"));
      warn(`REFUSED to set core.hooksPath: writing it into ${T}'s own git config — or reading it back — failed; git could not resolve or write ${T}'s config file. The every-lane commit floor is NOT set here. Confirm ${T} is a writable git repository and re-run.`);
    }
  } else {
    // isGitRepo(T) came back false — but a Git LOCATION variable set to an EMPTY value makes git
    // itself reject the tree ("not a git repository: ''") even when T IS a repo, so a blanket "not
    // a git repo yet" would misdescribe the cause. gitLocationOverrides only counts NON-empty
    // values (an empty one is not a relocation), so those runs land here; name the real cause.
    const emptyGitVars = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE"].filter((n) => Object.prototype.hasOwnProperty.call(process.env, n) && String(process.env[n]).trim() === "");
    if (emptyGitVars.length) {
      warn(`git could not resolve ${T} as a repository — ${emptyGitVars.join(", ")} ${emptyGitVars.length > 1 ? "are" : "is"} set to an EMPTY value, which git rejects. If ${T} is a git repo, clear the empty variable(s) (unset them, do not blank them) and re-run so core.hooksPath is set; otherwise run 'git init' first. (FM1: unset core.hooksPath ⇒ the pre-commit control is silently absent.)`);
    } else {
      warn(`${T} is not a git repo yet — after 'git init', run: git config core.hooksPath .githooks (FM1: unset ⇒ the pre-commit control is silently absent)`);
    }
  }

  // 4. scripts: portable controls and the repair-event recorder (+ optional gate runners).
  copyGuarded(path.join(KIT_ROOT, "scripts", "check-doc-size.mjs"), path.join(T, "scripts", "check-doc-size.mjs"), force);
  copyGuarded(path.join(KIT_ROOT, "scripts", "record-repair-event.mjs"), path.join(T, "scripts", "record-repair-event.mjs"), force);
  copyGuarded(path.join(KIT_ROOT, "scripts", "confirm-repair-brief.mjs"), path.join(T, "scripts", "confirm-repair-brief.mjs"), force);
  // v2.27: the two REPORT tools. Read-only; they need no binding and never mutate the repo.
  copyGuarded(path.join(KIT_ROOT, "scripts", "worktree-census.mjs"), path.join(T, "scripts", "worktree-census.mjs"), force);
  copyGuarded(path.join(KIT_ROOT, "scripts", "token-report.mjs"), path.join(T, "scripts", "token-report.mjs"), force);
  const runners = ["codex-gate.sh", "cold-review-gemini.sh", "cold-review-gemini-selftest.sh", "gemini-gate-supervisor.mjs", "gemini-gate-slices.mjs", "gemini-frozen-gate.mjs", "gemini-frozen-gate-selftest.mjs"];
  const gateGuardRel = path.join("scripts", "codex-gate-guard", "claude");
  if (args.withGateRunners) {
    for (const r of runners) {
      const d = path.join(T, "scripts", r);
      if (copyGuarded(path.join(KIT_ROOT, "scripts", r), d, force) === "written" && r.endsWith(".sh")) chmodX(d);
    }
    const guard = path.join(T, "scripts", "codex-gate-guard", "claude");
    if (copyGuarded(path.join(KIT_ROOT, "scripts", "codex-gate-guard", "claude"), guard, force) === "written") chmodX(guard);
    log(`  scripts/: check-doc-size.mjs + record-repair-event.mjs + confirm-repair-brief.mjs + worktree-census.mjs + token-report.mjs (report-only) + gate runners (need codex/agy; frozen Gemini normally uses subscription agy with strict manual fallback; no frozen API key or REST route — see the kit's PORTABILITY.md)`);
  } else {
    // Skipped is not UNEXAMINED: runners a previous adopt installed are mechanism kept-files even
    // when this run omits the flag — read-only compared, like the skipped .codex lane below.
    for (const r of runners) {
      staleCheckSkipped(path.join(KIT_ROOT, "scripts", r), path.join(T, "scripts", r), "--with-gate-runners was omitted; re-run --force WITH the flag to upgrade it");
    }
    staleCheckSkipped(path.join(KIT_ROOT, gateGuardRel), path.join(T, gateGuardRel), "--with-gate-runners was omitted; re-run --force WITH the flag to upgrade it");
    log(`  scripts/: check-doc-size.mjs + record-repair-event.mjs + confirm-repair-brief.mjs (gate runners skipped; pass --with-gate-runners to include them)`);
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
  const claudeCmdResult = copyGuarded(path.join(KIT_ROOT, "commands", "claude", "thread-restart.md"), claudeCmdDst, force, false);
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
      const codexResult = copyGuarded(path.join(KIT_ROOT, "commands", "codex", "thread-restart.md"), codexDst, force, false);
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
    for (const name of bodyNames) copyTree(path.join(skillsSrc, name), path.join(T, ".agents", "skills", name), force, () => true, MECHANISM_SKILLS.has(name));
    for (const name of claudeShims) {
      const dst = path.join(T, ".claude", "skills", name, "SKILL.md");
      copyGuarded(path.join(shimsSrc, "claude", `${name}.md`), dst, force, MECHANISM_SKILLS.has(name));
      installedShims.push(["claude", name, dst]);
    }
    log(bodyNames.length || claudeShims.length
      ? `  skills: ${bodyNames.length} shared body(ies) → .agents/skills/ · ${claudeShims.length} Claude shim(s) → .claude/skills/<name>/SKILL.md (existing files kept; --force to update)`
      : `  skills: none shipped in this kit version`);
  } catch (e) {
    warn(`the repo-local skills install failed (${e && (e.code || e.message) || "error"}) — /humanize and any other skill may be missing or partial. This is a NUDGE, not a control: the guards, the pre-commit floor and the method docs are unaffected and the adopt continues.`);
  }

  if (args.skipCodexPrompt) {
    // Skipped is not UNEXAMINED: the MECHANISM shims already sitting in the user-global prompts
    // dir are doctrine an agent executes, read-only compared like the skipped .codex lane. The
    // personal prompts (humanize and the ritual set) stay adopter-owned plain keeps.
    for (const name of codexShims) {
      if (!MECHANISM_SKILLS.has(name)) continue;
      staleCheckSkipped(path.join(shimsSrc, "codex", `${name}.md`), path.join(args.codexPromptsDir, `${name}.md`), "--skip-codex-prompt left it untouched; re-run --force WITHOUT the skip to upgrade it");
    }
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
        if (copyGuarded(path.join(shimsSrc, "codex", `${name}.md`), dst, force, MECHANISM_SKILLS.has(name)) === "written") cInstalled++; else cKept++;
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
    // — the check reporting a cage on an armed seat. The harness
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
  // "carries no enforcement, the adopt continues" contract stated three lines above.
  let codexLaneOk = !args.skipCodexLane;
  // THE ONE PROVENANCE THIS INSTALLER HAS: set at the single site that writes the path-baked Codex
  // registration this run. The .gitignore rule for that file follows this fact and nothing else.
  let kitWroteHooksJson = false;
  if (args.skipCodexLane) {
    // Say what is TRUE of the tree, not merely what this run did. On a re-run over a repo adopted
    // WITHOUT the flag, a bare "SKIPPED" reads as "there is no .codex here" while both files sit on
    // disk. Every other kept-file path in this installer reports honestly; this one did not.
    const existing = existsSync(path.join(T, ".codex"));
    // Skipped is not UNEXAMINED. A present lane's hooks are mechanism files this run just KEPT, so
    // the stale-keep accounting still owes them the byte comparison — otherwise `--force
    // --skip-codex-lane` over a drifted .codex exits 0 while that lane keeps enforcing with old
    // guards. READ-ONLY: nothing in the skipped lane is written, and the armed check stays off
    // (this run changed no hook, so there is nothing newly disarmed to verify). The remedy names
    // the skip, because --force alone cannot reach a lane the flag excludes.
    let laneStale = 0;
    for (const h of hookFiles) {
      const p = path.join(T, ".codex", "hooks", h);
      if (!existsSync(p)) continue;   // absent is not a stale KEEP — nothing was kept
      let differs = true;
      try { differs = !readFileSync(path.join(KIT_ROOT, "hooks", h)).equals(readFileSync(p)); } catch { /* unreadable = differs */ }
      if (differs) {
        laneStale++;
        staleKept.push(p);
        warn(`exists, KEPT BUT STALE against this kit (--skip-codex-lane left it untouched; re-run --force WITHOUT the skip to upgrade it): ${p}`);
      }
    }
    // The lane's arming probe ships WITH the lane, so the same skip leaves it behind too.
    staleCheckSkipped(path.join(KIT_ROOT, "scripts", "check-codex-hooks-armed.mjs"), path.join(T, "scripts", "check-codex-hooks-armed.mjs"), "--skip-codex-lane left it untouched; re-run --force WITHOUT the skip to upgrade it");
    log(existing
      ? `  .codex/: SKIPPED (--skip-codex-lane) — but a .codex/ ALREADY EXISTS here and was left untouched; this run neither wrote nor removed it${laneStale ? ` — and ${laneStale} of its hook file(s) are STALE (see warnings above)` : ""}`
      : `  .codex/: SKIPPED (--skip-codex-lane)`);
  } else {
    try {
      const cfgDst = path.join(T, ".codex", "config.toml");
      // Fail HERE, inside the catch, rather than later in the template loop — but NEVER through a
      // linked `.codex`: a directory created before the containment check is the escape the copy
      // below refuses one line later. Not contained ⇒ create nothing and let that refusal count it.
      const codexAgents = path.join(T, ".codex", "agents");
      if (!writeBlockedReason(codexAgents)) ensureDir(codexAgents);
      const codexCfg = copyGuarded(path.join(KIT_ROOT, "codex", "config.toml"), cfgDst, force, false);
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
        // how an adopter ends up assuming the kit reconciled hooks it never saw.
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
      // The registration is built BEFORE the kept/write branch, because the kept branch needs it too:
      // a plain re-run keeps the file on disk, and the only way to know that kept file is init's own
      // — without reading its content for a guess — is that it equals, byte for byte, what init
      // generates for this checkout right now. Pure computation from T and the kit version.
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
                // The brief-rung guard's WRITE half binds here: a Codex brief arrives as an
                // apply_patch envelope, which the shared grammar reads exactly as it reads a
                // Claude `file_path`. Its SEND half is registered NOWHERE in this lane, and that
                // is a fact about the lane rather than a decision: `send_message` is a tool the
                // Claude harness has and Codex does not, so there is no payload to bind. The half
                // that CAN bind, does; the half that cannot is inert BY ABSENCE, and PORTABILITY.md
                // says so rather than leaving an adopter to infer symmetry that is not there.
                entry("guard-brief-rung.mjs", "Checking the pre-send verification rung for this brief…"),
                // The two SENSORS run alongside the guards on the same matcher. They never deny —
                // registering them here is what stops them being installed-but-inert, which is the
                // failure mode this kit has already shipped once (files on disk, zero
                // registrations, exit 0). Order matters only for readability: a sensor cannot
                // change a guard's decision.
                entry("sensor-sweep-owed.mjs", "Checking whether this edit owes a pre-fold dependency sweep…"),
                entry("sensor-mutation-owed.mjs", "Checking whether this edit owes a two-sided mutation record…"),
              ],
            },
            {
              matcher: "Bash",
              hooks: [entry("guard-gate-ladder.mjs", "Resolving the declared tier; surfacing the ladder it owes…")],
            },
          ],
        },
      };
      const registrationText = JSON.stringify(registration, null, 2) + "\n";
      if (declaresHooks) {
        warn(`.codex/hooks.json: NOT written — your kept .codex/config.toml already declares hooks, and Codex wants a SINGLE representation for this layer. Those registrations are YOURS: the kit did not change them and cannot vouch for them. To adopt the kit's guards instead, remove the hooks declaration from config.toml and re-run init.`);
      } else if (existsSync(hooksJson) && !force) {
        // REGENERATION EQUALITY IS PROVENANCE, NOT A HEURISTIC. A kept file byte-identical to the
        // registration init generates for THIS checkout is init's, exactly; the ignore rule follows.
        let onDisk = null;
        try { if (!isSymlinkAt(hooksJson)) onDisk = readFileSync(hooksJson, "utf8"); } catch { /* unreadable: not equal */ }
        if (onDisk === registrationText) {
          kitWroteHooksJson = true;
          log(`  .codex/hooks.json: EXISTING, byte-identical to the registration init generates for this checkout — nothing to write`);
        } else {
          warn(`exists, kept (use --force to overwrite): ${hooksJson} — the Codex guards may be registered from a STALE file`);
        }
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
        // The Stop-event Owner-comms SENSOR is deliberately NOT registered here. Codex does list a
        // `Stop` hook event, but this kit has not observed that payload, and registering a sensor
        // against an unverified payload shape would ship a control whose behaviour nobody has
        // watched. The file installs (the two trees stay byte-identical); only the registration is
        // withheld, and PORTABILITY.md says so.
        if (writeWithBackup(hooksJson, registrationText)) {
          kitWroteHooksJson = true;
          log(`  .codex/hooks.json: [G] registration written — apply_patch ⇒ 3 write guards (fail CLOSED) + 2 sensors (never deny) · Bash ⇒ the gate-ladder sensor (never denies) · the brief-rung guard's cross-session SEND half is inert in this lane by absence (no such tool) · PER-CHECKOUT: this checkout's absolute path is baked into every command, so the file is gitignored`);
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
  if (mergeResult === "written") log(`  .claude/settings.json: PreToolUse (4 guards + 3 sensors) + Stop (2 sensors) registrations merged (verified by read-back)`);
  else if (mergeResult === "skipped") warn(`.claude/settings.json: NOT merged (see warning above) — the 4 PreToolUse guards, the 3 PreToolUse sensors and the 2 Stop sensors are NOT registered. Fix the file and re-run with --force, or register them by hand.`);
  else warn(`.claude/settings.json: post-write verification FAILED — the registrations are NOT confirmed on disk. Inspect ${path.join(T, ".claude", "settings.json")} before trusting the Claude-lane controls.`);

  // 6. .claude/kit.config.json — the [G] repo-specific families (the ONLY parameterized DATA).
  const config = {};
  if (args.sourceDirs) config.executedPathDirs = args.sourceDirs;
  // laneRiskTokens is deliberately NOT written (deprecated with the retired lane route, v1.5.0). An
  // EXISTING key in an older adopter's config is tolerated by every control: ignored, never fatal.
  if (args.stateDocs) config.stateDocs = args.stateDocs;
  if (args.memoryDir) config.memoryDir = args.memoryDir;
  if (args.worktreeRoots) config.worktreeRoots = args.worktreeRoots;
  const cfgPath = path.join(T, ".claude", "kit.config.json");
  // The four families this file is ALLOWED to hold, each with the flag that fills it. Names and
  // flags only: the refusal below reads this file to LIST what it holds and never to reprint what
  // is IN it (see there).
  const CFG_FAMILIES = [["executedPathDirs", "--source-dirs"], ["stateDocs", "--state-docs"],
    ["memoryDir", "--memory-dir"], ["worktreeRoots", "--worktree-roots"]];
  let cfgKept = false, cfgRefused = false, cfgUnreadable = false;
  if (existsSync(cfgPath) && !force) { warn(`exists, kept (use --force to overwrite): ${cfgPath}`); cfgKept = true; }
  else {
    // --force rewrites this file from THIS RUN'S FLAGS ALONE, so a run naming a PARTIAL set of
    // families silently DROPS every family it did not name: a dropped executedPathDirs WIDENS the
    // write guard, a dropped stateDocs shrinks doc-size governance, a dropped memoryDir loses the
    // memory advisory's default — all under a green "written" line, and all reachable by following
    // this kit's own upgrade instruction (FM-2026-09-05-23).
    // The cure is a REFUSAL, not a merge. init never reads-modifies-writes adopter data: the moment
    // it re-serialises a file it did not receive as flags, every property of that data — whether it
    // parses, its shape, number precision, nesting depth, keys it does not recognise — becomes the
    // installer's problem, and each one is a new way to corrupt the file it promised to preserve.
    // So: either every family the existing file holds is NAMED on this command line, or the file is
    // left exactly as it is and the run FAILS, naming the families it was missing and their flags.
    if (force && existsSync(cfgPath)) {
      let existing = null, unreadable = null;
      try {
        const parsed = JSON.parse(readFileSync(cfgPath, "utf8"));
        if (isPlainObject(parsed)) existing = parsed;
        else unreadable = "it parses as JSON but is not a JSON object";
        // The fs error CODE, never the thrown message: V8 quotes a snippet of the offending file
        // back inside a JSON parse error (Unexpected token 'N', "NOT JSON{" is not valid JSON),
        // which puts this file's own contents on the terminal — the one thing this branch is for.
      } catch (e) { unreadable = `it could not be read or parsed as JSON (${(e && e.code) || "invalid JSON"})`; }
      if (unreadable) {
        // Counted, not merely warned: every other REFUSED write in this file fails the run, and a
        // refusal that exits 0 lets automation record an install that did not happen.
        cfgRefused = true;
        cfgUnreadable = true;
        backupRefused.push(cfgPath);
        warn(`REFUSED to overwrite ${cfgPath}: ${unreadable}, so init cannot tell which repo-specific families it holds — and --force would rewrite it from THIS run's flags alone. The existing file is UNCHANGED. Repair it (or move it aside) and re-run.`);
      } else {
        const dropped = CFG_FAMILIES.filter(([key]) => Object.prototype.hasOwnProperty.call(existing, key) && !(key in config));
        // A key init does not recognise is adopter data too, and the rewrite drops it. Say so
        // WHENEVER the rewrite is going to happen — not only inside the refusal below, or a run
        // that names every family takes the key away in silence.
        const unknown = Object.keys(existing).filter((k) => !CFG_FAMILIES.some(([key]) => key === k));
        const unknownNote = unknown.length
          // JSON.stringify per key, not a bare join: a key name is adopter-authored text going
          // straight to a terminal, and one carrying an ESC or a newline could forge lines around
          // this warning. Quoting also makes an empty or space-padded key visible as itself.
          ? `${unknown.map((k) => JSON.stringify(k)).join(", ")} in ${cfgPath} ${unknown.length > 1 ? "are keys" : "is a key"} init does not recognise, and a --force rewrite DROPS ${unknown.length > 1 ? "them" : "it"}. Re-add by hand afterwards if you rely on ${unknown.length > 1 ? "them" : "it"}.`
          : "";
        if (dropped.length) {
          cfgRefused = true;
          backupRefused.push(cfgPath);
          // NAMES AND FLAGS ONLY — no value out of this file is ever rendered here. The obvious
          // kindness is to print a ready-to-paste re-run command with each family filled in from
          // the file, and that is the merge's own mistake one layer out: rendering adopter data
          // into shell argv makes the installer answerable for every property of that data all
          // over again (does it survive the list flags' comma-split and trim, does the flag's own
          // validation take it, can it be an OS argument at all), and every value the CLI cannot
          // express then needs a placeholder the parser is guaranteed to reject. The file is
          // UNCHANGED and sitting right there, so the adopter reads the values out of it. init
          // says WHICH families are missing and WHICH flag fills each, and stops.
          const width = Math.max(...dropped.map(([, flag]) => flag.length));
          warn(`REFUSED to overwrite ${cfgPath}: it holds ${dropped.map(([key]) => key).join(", ")}, which this run named no flag for. --force rewrites this file from THIS run's flags alone, so writing it now would DROP ${dropped.length > 1 ? "those families" : "that family"} (a dropped executedPathDirs WIDENS the write guard; a dropped stateDocs shrinks doc-size governance; a dropped memoryDir loses the memory advisory's default). The existing file is UNCHANGED, so every value it holds is still there to read. Open it and re-run this same command with ${dropped.length > 1 ? "these flags" : "this flag"} added, each filled from what that file holds:\n`
            + dropped.map(([key, flag]) => `\n    ${flag.padEnd(width)}  <the ${key} value in ${path.basename(cfgPath)}>`).join("")
            + `\n\n  init prints none of that file's values on purpose: a value re-rendered into a command line for you to paste back is a value it could have changed on the way. If a value in there is one no flag can carry (a list entry holding a comma, a shape this CLI does not take), no re-run will reproduce it — repair that file by hand, or move it aside and start from flags.\n`
            + (unknownNote ? `\n  ! …and ${unknownNote}` : ""));
        } else if (unknownNote) {
          // Not a refusal: this run named every family, so the rewrite proceeds (with a .bak) —
          // but it must not take the unrecognised keys away without saying so.
          warn(unknownNote);
        }
      }
    }
    if (!cfgRefused) {
      // No eager ensureDir: writeWithBackup creates the parent itself, AFTER its containment check.
      // A mkdir taken first is the same escape copyGuarded refuses — a directory built inside a
      // linked-out `.claude` by a write that then refuses.
      const cfgText = JSON.stringify(config, null, 2) + "\n";
      if (!writeWithBackup(cfgPath, cfgText)) cfgKept = true;
    }
  }
  log(cfgRefused
    ? (cfgUnreadable
      ? `  .claude/kit.config.json: REFUSED — on-disk file unchanged; init could not read it as a JSON object, so repair or move that file aside (see the warning above), then re-run`
      : `  .claude/kit.config.json: REFUSED — on-disk file unchanged; re-run with every family it holds named on the command line (the warning above names the missing families and the flag that fills each)`)
    : cfgKept
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
    PM_MODEL_ID: args.pmModel || "{{PM_MODEL_ID}}", PM_EFFORT: args.pmEffort || "{{PM_EFFORT}}",
    BUILDER_MODEL_ID: args.builderModel || "{{BUILDER_MODEL_ID}}", BUILDER_EFFORT: args.builderEffort || "{{BUILDER_EFFORT}}",
    GATHER_MODEL_ID: args.gatherModel || "{{GATHER_MODEL_ID}}", GATHER_EFFORT: args.gatherEffort || "{{GATHER_EFFORT}}",
    ASTRA_CONSULT_MODEL_ID: args.astraConsultModel || "{{ASTRA_CONSULT_MODEL_ID}}", ASTRA_CONSULT_EFFORT: args.astraConsultEffort || "{{ASTRA_CONSULT_EFFORT}}",
    // The non-Claude lane the asymmetry table names. It shipped as an UNFILLED placeholder in every
    // generated core/BINDINGS.md — no flag, no fill logic, so the "canonical statement of the
    // PM-portability caveat" had a literal `{{OTHER_LANE}}` in its column header. It is not a
    // judgment call the adopter has to make: the lane this kit ships hooks and a review seat for is
    // Codex, so it is filled, not asked for. (The gap was there from the day the template was
    // written.)
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
  else if (ptr === "refused") { /* refused, warned and counted at the site — surfaced in the end-of-run report */ }

  // 8. .gitignore (lane declaration, ledger and rung sidecar are per-session).
  // The RUNG SIDECAR belongs in this list for the same reason as the declaration, and one reason of
  // its own: it is an AUTHORIZATION artifact. Committed, it travels to every clone — and a fresh
  // clone has no ledger (that is gitignored too), so nothing there records its nonce as spent, while
  // `git checkout` hands the file a brand-new mtime that defeats the freshness window. Session
  // binding still stands between that and a free pass, but a committed authorization artifact is a
  // shape this kit does not ship: keep it out of the tree rather than rely on the last check standing.
  // `.claude/metrics/` rides with the sidecars: `sensor-token-ledger.mjs` (Stop) appends one row per
  // turn to `.claude/metrics/tokens.jsonl`, which every description of it — the sensor's own header,
  // the install summary below, PORTABILITY.md, the README — calls UNTRACKED. Until v2.28.0 nothing made
  // that true: the directory was never ignored, so a blanket add staged per-turn token rows (session
  // ids, task ids, context sizes) into the adopter's history. Same class as the Codex lane below — an
  // installer output that must not be committed and that only the installer knows to ignore.
  appendGitignore(T, [".claude/task-lane.json", ".claude/lane-ledger.jsonl", ".claude/brief-rung.json"]);
  // Its own call and its own comment: an adopter upgrading from v2.27.0 already carries the three
  // sidecar lines, so the ONE new line lands under a header that describes exactly it.
  appendGitignore(T, [".claude/metrics/"], "workflow-kit: the token ledger's metrics dir is per-session, gitignored");
  certifyIgnored(T, ".claude/metrics/", ".claude/metrics/tokens.jsonl");
  // ONLY THE PATH-BAKED FILE, AND ONLY BECAUSE INIT WROTE IT. `.codex/hooks.json` carries the
  // ABSOLUTE path of THIS checkout in every registered command (it must — Codex runs a hook from a
  // working directory the kit does not control, and a wrong project root is a fail-OPEN). Committed,
  // it registers hooks at a path no other clone has, and a hook that fails to START blocks nothing,
  // silently. Nothing else in the lane is path-baked, so nothing else is ignored.
  //
  // THE ONE PROVENANCE THIS INSTALLER HAS IS WHAT IT WROTE THIS RUN. Three rounds of cold seats took
  // apart every content heuristic for "is the file at this path the kit's / path-baked": a stamp
  // anyone can write, a substring a status message can carry, a raw path the generator shell-escapes.
  // Each patch minted the next defect. The heuristic is gone: the rule follows kitWroteHooksJson,
  // set at the single site that writes the registration. A rule written on an earlier run persists
  // in .gitignore by itself. Where init did NOT write the file this run — it preserved an adopter's
  // registration because their config.toml declares hooks — but an ignore rule for it is active, init
  // cannot know whose file sits there now, and says exactly that instead of deciding: leave the rule
  // if it is still the kit's registration, delete the line if it is now theirs. init never removes a
  // line from .gitignore. Under --skip-codex-lane the adopter opted out of lane handling and the lane
  // block already reported the untouched .codex/; nothing more is said here.
  let codexIgnore = "none";
  let staleHooksRule = false;
  const hooksJsonPath = path.join(T, ".codex", "hooks.json");
  const hooksRuleActive = () => {
    if (!isGitRepo(T)) return false;
    try { execFileSync("git", ["-C", T, "check-ignore", "-q", "--no-index", "--", ".codex/hooks.json"], { stdio: ["ignore", "pipe", "pipe"] }); return true; }
    catch { return false; }
  };
  if (kitWroteHooksJson) {
    codexIgnore = appendGitignore(T, [".codex/hooks.json"],
      "workflow-kit: .codex/hooks.json is PER-CHECKOUT — it bakes this checkout's absolute path into every hook command; committed, it registers hooks at a path other clones do not have, and a hook that fails to start blocks nothing (silently). The rest of .codex/ stays tracked");
    certifyIgnored(T, ".codex/hooks.json", ".codex/hooks.json");
  } else if (!args.skipCodexLane && existsSync(hooksJsonPath) && hooksRuleActive()) {
    staleHooksRule = true;
    warn(`a .codex/hooks.json ignore rule is active, but init did not write that file this run (it preserved the registration already there), so it cannot tell whose registration it is now. If it is still the kit's path-baked registration from an earlier run, leave the rule. If it is now YOUR OWN registration, delete the .codex/hooks.json line from .gitignore — while it stands, your file never reaches a clone. init never edits .gitignore lines.`);
  }
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
  // The hooks.json outcome is stated from what THIS run did — wrote it, preserved it, refused — never
  // from what the lane intended.
  if (kitWroteHooksJson && codexIgnore !== "refused") {
    item(
      `DO NOT COMMIT .codex/hooks.json — it is gitignored now. It bakes THIS checkout's absolute`,
      `path into every registered command, so a committed copy registers hooks at a path other`,
      `clones do not have — and a hook that fails to start blocks nothing, silently. Every clone`,
      `and every linked worktree runs its own init. If a previous run's copy is ALREADY tracked,`,
      `an ignore rule does not untrack it: git rm --cached -- .codex/hooks.json, then commit.`,
      `Everything else in .codex/ (config.toml, hooks/, agents/) stays TRACKED.`,
    );
  } else if (codexIgnore === "refused") {
    item(`UNRESOLVED: .codex/hooks.json — its ignore rule could not be written (see the REFUSAL above). Decide it by hand.`);
  } else if (staleHooksRule) {
    item(
      `CHECK .codex/hooks.json: an ignore rule for it is active, but init did not write the file this`,
      `run — it preserved the registration already there (see the warning above). If that is now`,
      `your own registration, delete the .codex/hooks.json line from .gitignore; if it is still the`,
      `kit's path-baked one, leave it. init never edits .gitignore lines.`,
    );
  } else if (!args.skipCodexLane && existsSync(hooksJsonPath)) {
    item(`.codex/hooks.json: init did not write it this run (your registration is preserved) and did not ignore it — it stays TRACKED with the rest of .codex/.`);
  }
  item(
    `READ the kit's PORTABILITY.md (in the workflow-kit repository; it is NOT installed here) — what these guards do NOT cover. They bind write TOOLS. A write`,
    `issued through a plain SHELL command is invisible to them, and in the Codex lane that`,
    `is a main road, not a corner case. The pre-commit hook you just installed is the only`,
    `mechanical floor that binds every lane. Do not imply otherwise to your team.`,
  );
  item(
    `The Stop hook guard-owner-comms.mjs is a SENSOR that fails OPEN — it nudges a`,
    `rule-1 miss AFTER the message is already sent, and a clean run proves nothing.`,
    `Never describe it to your team as enforcement. Off switch: WORKFLOW_KIT_COMMS_GUARD=false.`,
  );

  // A PLAIN RERUN OVER AN OLDER INSTALL IS A FAILING STATE, NOT A WARNING. Every mechanism file
  // kept-but-different above still runs the OLD controller, guard, recorder or doctrine while this
  // run printed the new version's name — exiting 0 here is how an adopter "upgrades" without
  // upgrading and never learns it. The remediation is explicit about its costs because --force is
  // GLOBAL: every kept file whose content differs — [G] doc or portable copy alike — is backed up
  // to .bak first (a backup that cannot be taken REFUSES rather than destroys, and fails the run),
  // and any CHANGED HOOK is DISARMED in the Codex lane until a human re-trusts it interactively —
  // a plain `codex exec` skips an untrusted hook silently.
  // AFTER a --force that replaced Codex-lane hooks, the dangerous state is CURRENT-BUT-DISARMED.
  // Verify out loud, and FAIL the run when the verification does not pass — an exit 0 there told
  // an adopter the upgrade completed while its Codex-lane controls were dead, which is the same
  // manufactured assurance the check itself exists to stop. An ABSTAIN counts as not-verified for
  // the same reason a clean `codex exec` proves nothing.
  if (force && codexLaneOk) {
    const armedCheck = path.join(T, "scripts", "check-codex-hooks-armed.mjs");
    if (existsSync(armedCheck)) {
      try {
        execFileSync(process.execPath, [armedCheck], { cwd: T, stdio: ["ignore", "pipe", "pipe"] });
        log(`  codex hooks: armed-check PASSED after --force`);
      } catch (error) {
        console.error(`\ninit: the Codex lane's hooks are NOT verified armed after this --force ` +
          `upgrade (${String(error?.stdout || error?.message || "check failed").toString().trim().split("\n")[0]}). ` +
          `A changed hook is DISARMED until a human re-trusts it interactively; \`codex exec\` skips ` +
          `untrusted hooks SILENTLY. Re-trust, then: node scripts/check-codex-hooks-armed.mjs`);
        process.exitCode = 1;
      }
    }
  }
  // A REFUSED write is a FAILING state, not a warning: every file it names still carries its OLD
  // content (or its link), so the run did not deliver the install it printed — and the refusal
  // warnings scrolled past hundreds of lines ago. Repeat them where the exit code is decided.
  if (backupRefused.length) {
    console.error(`\ninit: ${backupRefused.length} overwrite(s) were REFUSED (a symlinked target, an escaping directory, a backup that could not be taken, or a kit.config.json init could not read as a JSON object or that holds families this run did not name — see each warning above):`);
    for (const f of backupRefused) console.error(`  · ${f}`);
    console.error(
      `Nothing above was written by this run. Every entry naming a kit FILE is UNCHANGED on disk — ` +
      `still its OLD content, not kit v${KIT_VERSION}; every entry naming something else (a \`.git\` whose ` +
      `core.hooksPath write was refused) never carried kit content at all, and that repository is ` +
      `untouched too. Resolve the cause each warning names (replace the symlink or linked directory, ` +
      `move the blocking .bak aside, clear the Git location overrides, repair or fully specify the ` +
      `kit.config.json its warning names), then re-run.`);
    process.exitCode = 1;
  }
  // A path init just ignored that git still indexes is the same failing shape: the run printed an
  // ignore, and the file keeps entering history anyway. Repeat it where the exit code is decided.
  if (indexedLeaks.length) {
    console.error(`\ninit: ${indexedLeaks.length} per-checkout path(s) init ignores could NOT be certified by git as ignored-and-untracked — an ignore rule is only what git says it is, and never untracks an indexed path:`);
    for (const f of indexedLeaks) console.error(`  · ${f}`);
    console.error(
      `Run the \`git rm --cached\` command each warning above names, then commit. init does not make that ` +
      `change for you: it rewrites what history says about a file, and that is your write to make.`);
    process.exitCode = 1;
  }
  if (staleKept.length) {
    console.error(`\ninit: ${staleKept.length} installed mechanism file(s) are STALE against kit v${KIT_VERSION} and were NOT upgraded:`);
    for (const f of staleKept) console.error(`  · ${f}`);
    console.error(
      `A plain rerun never claims the new controller. To upgrade, re-run with --force — GLOBAL: ` +
      `every kept file whose content differs is backed up to .bak before overwrite (a backup that ` +
      `cannot be taken REFUSES the overwrite and fails the run); changed hooks are DISARMED in the ` +
      `Codex lane until re-trusted interactively (then verify: node scripts/check-codex-hooks-armed.mjs).`);
    process.exitCode = 1;
  }
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
