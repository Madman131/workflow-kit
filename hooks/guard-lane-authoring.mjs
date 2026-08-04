#!/usr/bin/env node
// .claude/hooks/guard-lane-authoring.mjs — PreToolUse(Write|Edit|MultiEdit|NotebookEdit).
//
// WHY THIS EXISTS: core/MULTI_AGENT.md — "Task-lane declaration" says "a prompt is not a control".
// The declaration is prose until a deterministic layer checks that one exists. This hook makes an
// undeclared code write visible at the point it is attempted.
//
// WHAT IT DOES (enforce, never classify — the IO rule): it enforces the DECLARED task disposition
// for source/config code paths. Declarations are session/task-bound and name exactly one route:
// `in-thread` (with the tier) or `exempt` (with a ledgered reason). The retired `lane` route is
// REFUSED with an explicit `lane-retired` state, never a fall-through to "malformed".
//
// HONEST LIMITS (tripwire, not fortress): it binds only Write/Edit-family TOOLS. Bash redirection
// and codex exec writes are not covered, the same accepted class as guard-cross-repo-writes. It
// cannot distinguish the main session from subagents, so it gates the superset. A declaration is
// self-declared: a wrong semantic classification is visible in the ledger, not proven false here.
// Ledger IO fails closed so an exemption cannot proceed without its required trace.

import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import path from "node:path";

const DECLARATION = path.join(".claude", "task-lane.json");
const LEDGER = path.join(".claude", "lane-ledger.jsonl");
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
const CODE_EXT_RE = /\.(?:bash|c|cc|cfg|cjs|conf|cpp|cs|css|dart|exs?|fish|fsx?|go|gradle|graphql|gql|groovy|h|htm|html|ini|ipynb|java|js|json|jsx|kts?|less|lua|m|mjs|mm|php|pl|pm|proto|py|r|rb|rs|scala|scss|sh|sol|sql|svelte|swift|tf|tfvars|toml|ts|tsx|vue|ya?ml|zig)$/i;
const CODE_BASENAME_RE = /^(?:\.[^./][^/]*|bun\.lockb?|Cargo\.lock|composer\.lock|Dockerfile(?:\..*)?|.*\.Dockerfile|Gemfile\.lock|GNUmakefile|Makefile|npm-shrinkwrap\.json|package-lock\.json|Pipfile\.lock|pnpm-lock\.ya?ml|poetry\.lock|Procfile|requirements(?:-[^/]+)?\.txt|uv\.lock|yarn\.lock)$/i;
const GOVERNED_CONTROL_TREE_RE = /^\.(?:agents|claude|codex)\//i;
const EXEMPT_REASONS = new Set(["codex-down", "codex-quota", "trivial-edit"]);

// [P] KIT PARAMETERIZATION — the source-tree dirs are the ONLY repo-shaped data in this hook. They
// come from .claude/kit.config.json (a [G] binding `init` writes), UNIONed onto portable defaults,
// so the MECHANISM copies verbatim and only the DATA is per-repo. A MALFORMED config FAILS CLOSED
// (blocks a gated write below) — a mis-parameterized deny-set must never fail open (blueprint
// § Phase 6). EXECUTED_PATH_RE is built per-invocation in the handler from loadKitConfig();
// declared `let` here so isGatedPath closes over it. (The `laneRiskTokens` family died with the
// retired `lane` route: an older adopter's config may still CARRY the key, and it is IGNORED — a
// field no control reads cannot make a control fail open — but a structurally corrupt file still
// blocks.)
const KIT_CONFIG = path.join(".claude", "kit.config.json");
// Portable default source-tree roots (the generic set — no repo-specific dir like `pil`).
const DEFAULT_EXECUTED_PATH_DIRS = [".github", "bin", "config", "lib", "ops", "schema", "schemas", "src", "tools", "vendor"];
let EXECUTED_PATH_RE;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Single path segment (no `/`), non-empty — a config value that is not this is malformed, not silently dropped.
function isSegmentArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && !s.includes("/"));
}
// Absent config ⇒ defaults-only (a legitimate minimal state). Present-but-corrupt ⇒ { ok:false } so the
// handler fails CLOSED on a gated write. Partial config (one field absent) is fine (⇒ that field empty).
function loadKitConfig(projectRoot) {
  const file = path.join(projectRoot, KIT_CONFIG);
  let st;
  try { st = lstatSync(file); }
  catch (e) {
    // ONLY a truly-absent file (ENOENT) falls back to defaults. A permission/IO error (EACCES/EIO/…)
    // means the config EXISTS but cannot be read — FAIL CLOSED (INVARIANTS rule 5: cannot-read-input ⇒
    // abstain, never green), never silently drop the repo-specific deny families.
    if (e && e.code === "ENOENT") return { ok: true, executedPathDirs: [] };
    return { ok: false };
  }
  // A SYMLINKED (or non-regular) config is FAIL-CLOSED, not treated as absent: a dangling symlink
  // would otherwise read as "absent ⇒ defaults" and silently DROP the repo-specific deny families
  // (a fail-open), and a symlink to an external file is config injection. Matches pre-commit's and
  // check-doc-size's handling of the declaration file.
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { return { ok: false }; }
  if (!isPlainObject(parsed)) return { ok: false };
  const dirs = parsed.executedPathDirs === undefined ? [] : parsed.executedPathDirs;
  if (!isSegmentArray(dirs)) return { ok: false };
  // Any other key — including a legacy `laneRiskTokens` left by a pre-v1.5 adopt — is deliberately
  // NOT validated here: this hook no longer reads it, and a field a control does not use cannot make
  // that control fail open. Structural corruption (handled above) still fails closed.
  return { ok: true, executedPathDirs: dirs };
}
function buildExecutedPathRe(dirs) {
  return new RegExp("^(?:" + dirs.map(escapeRe).join("|") + ")/", "i");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

// The config-INDEPENDENT "definitely not gated" set — docs/memory + the declaration/ledger files.
// On a MALFORMED config, EXECUTED_PATH_RE cannot be trusted to identify a config-gated source dir, so
// the handler blocks everything NOT in this static set (fail closed) instead of relying on isGatedPath.
function isStaticallySafe(rel) {
  const folded = rel.toLowerCase();
  return folded === DECLARATION || folded === LEDGER || folded.startsWith("docs/") || folded.startsWith("memory/");
}
function isGatedPath(rel) {
  const folded = rel.toLowerCase();
  if (isStaticallySafe(rel)) return false;
  return CODE_EXT_RE.test(rel) || CODE_BASENAME_RE.test(path.posix.basename(rel)) ||
    EXECUTED_PATH_RE.test(rel) || folded.startsWith("scripts/") || folded.startsWith("tests/") ||
    GOVERNED_CONTROL_TREE_RE.test(rel) || !path.posix.basename(rel).includes(".");
}

function hasSymlinkTraversal(projectRoot, abs) {
  const relative = path.relative(projectRoot, abs);
  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (!stat) break;
      if (stat.isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function declarationHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function declarationState(projectRoot, sessionId) {
  const file = path.join(projectRoot, DECLARATION);
  // A symlinked / non-regular declaration is FAIL-CLOSED (malformed), matching the pre-commit hook and
  // the kit.config.json loader: a symlinked declaration must not authorize writes via an external file,
  // and an unreadable one must not read as "undeclared". Only ENOENT is a true "undeclared".
  let dstat;
  try { dstat = lstatSync(file); }
  catch (e) { if (e && e.code === "ENOENT") return { state: "undeclared" }; return { state: "malformed" }; }
  if (dstat.isSymbolicLink() || !dstat.isFile()) return { state: "malformed" };

  let declaration;
  try {
    declaration = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { state: "malformed" };
  }
  if (!isPlainObject(declaration)) return { state: "malformed" };

  const maxAgeHours = declaration.maxAgeHours === undefined ? 24 : declaration.maxAgeHours;
  if (typeof maxAgeHours !== "number" || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 168) {
    return { state: "malformed" };
  }

  try {
    if (Date.now() - statSync(file).mtimeMs > maxAgeHours * 3600_000) return { state: "stale" };
  } catch {
    return { state: "malformed" };
  }

  if (typeof sessionId !== "string" || !sessionId) return { state: "missing-session" };
  if (declaration.sessionId !== sessionId) return { state: "session-mismatch" };
  if (typeof declaration.taskId !== "string" || !TASK_ID_RE.test(declaration.taskId)) return { state: "malformed" };

  // RETIRED with the cost-inversion build lane (doctrine at kit v1.4.0, mechanism at v1.5.0). An
  // explicit state, not a fall-through to "malformed": the agent must be told the route is GONE,
  // not that its JSON is wrong.
  if (declaration.mode === "lane") return { state: "lane-retired", taskId: declaration.taskId, sessionId };
  if (declaration.mode === "in-thread") {
    if (["T0", "T1", "T2", "T3"].includes(declaration.tier)) {
      return {
        state: `in-thread:${declaration.tier}`,
        taskId: declaration.taskId,
        sessionId,
        declarationHash: declarationHash({
          mode: "in-thread",
          sessionId,
          taskId: declaration.taskId,
          tier: declaration.tier,
          maxAgeHours,
        }),
      };
    }
    return { state: "malformed" };
  }
  // An exemption declares WHICH SEAT is unavailable, which says nothing about how risky the work is.
  // Before v1.5.0 `exempt` was the one route that carried no tier, so the reason set (all about review-seat
  // availability) silently selected the mode that skipped tier declaration — a category error. The tier is
  // now required exactly as `in-thread` requires it. An OLD tier-less exemption is NOT grandfathered: it
  // gets its own explicit state so the remediation can name the field that is missing.
  if (declaration.mode === "exempt") {
    if (!EXEMPT_REASONS.has(declaration.reason)) return { state: "malformed" };
    if (!["T0", "T1", "T2", "T3"].includes(declaration.tier)) return { state: "exempt-tier-missing" };
    return {
      state: "exempt",
      reason: declaration.reason,
      taskId: declaration.taskId,
      sessionId,
      declarationHash: declarationHash({
        mode: "exempt",
        sessionId,
        taskId: declaration.taskId,
        reason: declaration.reason,
        tier: declaration.tier,
        maxAgeHours,
      }),
    };
  }
  return { state: "malformed" };
}

function writeLedger(projectRoot, decision, state, reason, rel, taskId, sessionId, hash) {
  const ledger = path.join(projectRoot, LEDGER);
  let fd;
  try {
    // A SYMLINKED ledger would send the append (and any exemption's audit row) OUTSIDE the repo. Reject
    // it (fail closed → the caller denies). ENOENT is fine — the O_APPEND open creates a regular file.
    try { const ls = lstatSync(ledger); if (ls.isSymbolicLink() || !ls.isFile()) return false; }
    catch (e) { if (e && e.code !== "ENOENT") return false; }
    let previous;
    if (existsSync(ledger)) {
      const existing = readFileSync(ledger, "utf8");
      if (existing.length > 0 && !existing.endsWith("\n")) return false;
      const rows = existing.split("\n").filter(Boolean);
      const parsed = [];
      for (const row of rows) {
        try {
          const value = JSON.parse(row);
          if (!isPlainObject(value)) return false;
          parsed.push(value);
        } catch {
          return false;
        }
      }
      previous = parsed.at(-1); // Dedupe deliberately examines only the last valid row.
    }
    if (previous?.state === state && previous?.decision === decision && previous?.reason === reason &&
      previous?.taskId === taskId && previous?.sessionId === sessionId && previous?.path === rel &&
      previous?.declarationHash === hash) {
      return true;
    }

    const row = { ts: new Date().toISOString(), decision, state, taskId, sessionId, path: rel };
    if (hash) row.declarationHash = hash;
    if (state === "exempt") row.reason = reason;
    // One O_APPEND write prevents concurrent hook processes from replacing one another's rows.
    // fsync makes an allowed exemption fail closed unless its local audit row reaches disk.
    fd = openSync(ledger, "a", 0o600);
    const line = `${JSON.stringify(row)}\n`;
    if (writeSync(fd, line) !== Buffer.byteLength(line)) return false;
    fsyncSync(fd);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* the write result already determines allow/deny */ }
    }
  }
}

function deny(projectRoot, rel, state, sessionId) {
  const session = typeof sessionId === "string" && sessionId ? sessionId : "<hook-session-id>";
  if (state === "kit-config-malformed") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `guard-lane-authoring.mjs blocked ${rel}: ${path.join(projectRoot, KIT_CONFIG)} is present but ` +
          `MALFORMED (not valid JSON, not an object, or executedPathDirs is not an array of non-empty ` +
          `path segments). This code write is BLOCKED (fail-closed) — a corrupt repo-specific deny-set ` +
          `must never silently permit writes. Remediate by fixing that file to shape ` +
          `\`{"executedPathDirs":["<dir>"]}\` (optional), by deleting it to fall back to the kit's ` +
          `portable defaults, or by re-running \`node bin/init.mjs\`.`,
      },
    }));
    return;
  }
  const reason =
    `guard-lane-authoring.mjs blocked ${rel}: declaration state is ${state}; this code write is BLOCKED. ` +
    `See core/MULTI_AGENT.md — "Task-lane declaration". ` +
    `Remediate by writing ${path.join(projectRoot, DECLARATION)} as ONE of the two DOCUMENTED routes: ` +
    `\`{"mode":"in-thread","sessionId":"${session}","taskId":"<kebab-task>","tier":"T0"|"T1"|"T2"|"T3"}\` · ` +
    `\`{"mode":"exempt","sessionId":"${session}","taskId":"<kebab-task>","reason":"codex-down"|"codex-quota"|"trivial-edit","tier":"T0"|"T1"|"T2"|"T3"}\`; ` +
    'optional `"maxAgeHours"` defaults to 24. ' +
    'The declaration is session/task-bound and gitignored; each state change is appended and synced to ' +
    `${path.join(projectRoot, LEDGER)} for Owner spot-check.` +
    (state === "exempt-tier-missing"
      ? ' This exemption is MISSING its `"tier"`. Since kit v1.5.0 `exempt` declares a tier exactly as `in-thread` does: the reason names the unavailable SEAT, which says nothing about how risky the work is. Add `"tier":"T0"|"T1"|"T2"|"T3"`. A pre-v1.5 tier-less exemption is not grandfathered.'
      : "") +
    (state === "lane-retired"
      ? " The `lane` route was RETIRED with the cost-inversion build lane (doctrine at kit v1.4.0, mechanism at v1.5.0) — it is not an available route. Declare `in-thread` with the tier."
      : "") +
    (state === "stale"
      ? " A stale declaration is treated as absent — re-declare for the CURRENT task (the file's mtime is the staleness clock; rewriting it refreshes it)."
      : "");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  // Build the parameterized regex: portable defaults UNION the (valid) config family. On a
  // MALFORMED config we build from defaults only (so code paths are still IDENTIFIED as gated) and
  // block any gated write below — never silently trust a corrupt deny-set.
  const kitConfig = loadKitConfig(projectRoot);
  EXECUTED_PATH_RE = buildExecutedPathRe(DEFAULT_EXECUTED_PATH_DIRS.concat(kitConfig.ok ? kitConfig.executedPathDirs : []));
  let input;
  try { input = JSON.parse(raw); } catch {
    deny(projectRoot, "<unknown-path>", "malformed-hook-input");
    process.exit(0);
  }
  const rawFilePath = input?.tool_input?.file_path;
  const rawNotebookPath = input?.tool_input?.notebook_path;
  const target = typeof rawFilePath === "string" && rawFilePath
    ? rawFilePath
    : typeof rawNotebookPath === "string" && rawNotebookPath
      ? rawNotebookPath
      : null;
  if (!target) {
    const malformedPath = rawFilePath !== undefined || rawNotebookPath !== undefined;
    deny(projectRoot, "<unknown-path>", malformedPath ? "malformed-hook-path" : "missing-hook-path", input?.session_id);
    process.exit(0);
  }

  const abs = path.resolve(projectRoot, target);
  let rel = path.relative(projectRoot, abs);
  // Outside-repo test must not swallow an in-repo file whose NAME starts with ".." (e.g. root
  // "..x.mjs") — a bare startsWith("..") would let it bypass the gate, failing open.
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) process.exit(0);
  rel = rel.split(path.sep).join("/");

  const symlinkPath = hasSymlinkTraversal(projectRoot, abs);

  // FAIL CLOSED on a corrupt config BEFORE the not-gated early-exit. On a malformed config
  // EXECUTED_PATH_RE falls back to defaults, so a path gated ONLY by a config-added source dir is not
  // identified as gated and would slip through the early-allow below (a fail-open). When the config is
  // unreadable we cannot trust that identification, so we block everything NOT statically safe
  // (only the docs/ and memory/ SUBTREES + the declaration + the ledger — config-independent). Note
  // this is broader than "docs proceed": a ROOT-level doc (README.md, LICENSE) and every code path
  // fail closed until the config is fixed. Fail-CLOSED is the correct direction; the deny message
  // points remediation at Bash / re-running init (the Write tool itself is blocked while corrupt).
  if (!kitConfig.ok && !isStaticallySafe(rel)) {
    const logged = writeLedger(projectRoot, "deny", "kit-config-malformed", undefined, rel, undefined, input?.session_id, undefined);
    if (!logged) deny(projectRoot, rel, "ledger-error", input?.session_id);
    else deny(projectRoot, rel, "kit-config-malformed", input?.session_id);
    process.exit(0);
  }

  if (!symlinkPath && !isGatedPath(rel)) process.exit(0);

  const sessionId = input?.session_id;
  const result = declarationState(projectRoot, sessionId);
  let state = result.state;
  let decision = ["in-thread:T0", "in-thread:T1", "in-thread:T2", "in-thread:T3", "exempt"].includes(state)
    ? "allow"
    : "deny";
  if (symlinkPath) {
    state = "symlink-path";
    decision = "deny";
  }
  const logged = writeLedger(
    projectRoot,
    decision,
    state,
    result.reason,
    rel,
    result.taskId,
    result.sessionId ?? sessionId,
    result.declarationHash,
  );
  if (!logged) {
    deny(projectRoot, rel, "ledger-error", sessionId);
    process.exit(0);
  }
  if (decision === "deny") deny(projectRoot, rel, state, sessionId);
  process.exit(0);
});
