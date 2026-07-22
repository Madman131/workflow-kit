#!/usr/bin/env node
// scripts/check-doc-size.mjs — the size-cap check for the canonical method set (Workflow v2 Phase 2).
//
// WHY THIS EXISTS: a doc that must be read WHOLE costs its full length on every read; a doc you
// *query* costs only the section you land on. The cap makes that cost bounded and visible.
//
// WHAT THE CAP IS NOT — measured 2026-07-18, data in docs/journal/read_limit_measurements.md:
// it is NOT a truncation threshold. The Read tool's cap is 25,000 TOKENS (~66 KB of this prose
// class), truncation is ANNOUNCED rather than silent, and bytes do not predict it — a 48,913 B file
// read whole in the same probe where a 32,724 B file truncated. 20 KiB carries roughly 3x headroom
// and exists to bound the BOOT CONTEXT BUDGET (~72 KB / 27K tokens spent before any work) and to
// keep instruction artifacts short enough to be read WELL, not merely to fit.
//
// Bytes remain the right unit despite the cap being token-derived: tokenizers differ per model
// family (the same filler measured ~1.0 B/token on one and ~4.0 on another), nothing here can count
// tokens portably, and bytes never under-count the way characters do on the em-dashes and middots
// these docs are full of.
//
// THE TIGHTEST READER WINS, and it is not always Read: core/INVARIANTS.md + core/REPO_INVARIANTS.md
// are cat'd into the Gemini gate payload, whose INLINE ceiling is 80 KiB for the ENTIRE payload.
// At 20 KiB each they would eat half of it before any diff. Keep that pair well under this cap.
//
// SO THE CAP KEYS ON ACCESS PATTERN, NOT ON SIZE, and the access pattern is DECLARED, never inferred:
//   CLASS: BINDING    → read whole; missing a section means violating a rule → hard cap (20 KiB).
//   CLASS: REFERENCE  → looked up; missing a section just means you look it up later → no size cap,
//                       but it MUST carry the lookup-only marker and a table of contents.
//
// "It's just reference" is exactly the excuse that lets a binding doc grow unchecked, so the marker
// is mandatory: an undeclared or unparseable file is a FAIL, never a skip. FAIL CLOSED.
//
// A cap may never force deleting doctrine. If honest consolidation lands over budget, SPLIT at a
// concept seam (and record the split) or push detail to docs/journal/ — never cut a rule to hit a
// number. Raising a cap is an Owner decision, not a build-time convenience.
//
// Usage: node scripts/check-doc-size.mjs [--json]
// Exit 0 = every governed doc passes. Exit 1 = at least one FAIL.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// CAPS BY ROLE, each derived from the TIGHTEST SURFACE that must read that doc whole. One flat
// number was wrong in both directions: too loose for the machine-payload pair, too loose for the
// entry stubs. Bytes, not characters (characters under-count the em-dashes and middots these docs
// are full of); bytes, not tokens (tokenizers differ per family — measured ~1.0 B/token on one and
// ~4.0 on another for identical content, so a token cap would be false precision).
export const ROLE_CAPS = {
  // Read at boot by EVERY session, in addition to the method set. Should stay tiny.
  entry: 8 * 1024,
  // Bounded by the BOOT CONTEXT BUDGET (~72 KB / ~27K tokens spent before any work begins),
  // not by truncation — the Read cap is 25,000 tokens ~= 66 KB of this prose class.
  method: 20 * 1024,
  // Cat'd into EVERY Gemini gate payload. Two constraints bind here and both are tighter than
  // `method`: the 80 KiB INLINE ingestion ceiling, and signal-to-noise — on a small design gate
  // these files are ~97% of the payload, so every wasted byte displaces the artifact under review.
  payload: 8 * 1024,
  // The regenerated boot architecture snapshot (core/SYSTEM_MAP.md): tighter than a method doc so the
  // boot read stays cheap; it summarizes docs/PIL_ARCHITECTURE.md (REFERENCE) rather than duplicating it.
  snapshot: 8 * 1024,
};
// Back-compat for callers/tests that referred to the single old constant.
export const BINDING_CAP_BYTES = ROLE_CAPS.method;

// ADVISORY thresholds — a WARN, never a hard FAIL (Workflow v2 Phase 5).
// A CLASS: STATE doc (a regenerated current-state head) legitimately grows between regenerations, so a
// hard cap would block an unrelated commit. Over-threshold ⇒ WARN (regenerate); still exit 0.
export const STATE_WARN_BYTES = 40 * 1024;
// External per-machine memory caps for the opt-in `--memory` advisory (never wired into `npm test`).
export const MEMORY_TOPIC_CAP = 12 * 1024;
export const MEMORY_INDEX_CAP = 18 * 1024;
// [P] KIT PARAMETERIZATION — repo-specific STATE docs + the external memory dir come from
// .claude/kit.config.json (a [G] binding `init` writes). The portable GOVERNED_DOCS floor + the
// core/ auto-discovery walk stay repo-agnostic. A MALFORMED config FAILS CLOSED (the CLI exits 1);
// an ABSENT config ⇒ no repo STATE docs + no default memory dir (both legitimate minimal states).
// `KIT_MEMORY_DIR` env overrides the configured memory dir; `--memory=<dir>` overrides everything.
function isPlainObjectC(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}
function isRepoPathArray(v) {
  return Array.isArray(v) && v.every((s) => {
    if (typeof s !== "string" || s.length === 0 || s.startsWith("/") || s.includes("\\")) return false;
    // Reject any path that ESCAPES the repo root — including an EMBEDDED `..` such as
    // "docs/../../outside.md" (normalize collapses it to "../outside.md"), not just a leading "../".
    // An escaping stateDoc would make check-doc-size govern (and pass on) a file OUTSIDE the repo,
    // leaving the intended in-repo doc ungoverned — a fail-open.
    const norm = path.posix.normalize(s);
    return norm !== ".." && !norm.startsWith("../") && !path.posix.isAbsolute(norm);
  });
}
export function loadKitConfig(root = REPO_ROOT) {
  const file = path.join(root, ".claude", "kit.config.json");
  let st;
  try { st = lstatSync(file); }
  catch (e) {
    // Only ENOENT (truly absent) ⇒ no repo STATE docs. A permission/IO error means the config exists
    // but is unreadable ⇒ FAIL CLOSED (CLI exits 1), never report green on a config it could not read.
    if (e && e.code === "ENOENT") return { ok: true, stateDocs: [], memoryDir: null };
    return { ok: false, error: `${file} exists but is unreadable (${e && e.code ? e.code : "error"}) — failing closed` };
  }
  // A SYMLINKED/non-regular config FAILS CLOSED (CLI exits 1), not treated as absent — consistent with
  // the write-gates; a dangling/injected symlink config must not silently change what is governed.
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, error: `${file} is a symlink or non-regular file — refusing (fail closed)` };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); }
  catch { return { ok: false, error: `${file} is present but not valid JSON` }; }
  if (!isPlainObjectC(parsed)) return { ok: false, error: `${file} is not a JSON object` };
  const stateDocs = parsed.stateDocs === undefined ? [] : parsed.stateDocs;
  if (!isRepoPathArray(stateDocs)) return { ok: false, error: `${file}: stateDocs must be an array of repo-relative paths` };
  let memoryDir = parsed.memoryDir === undefined ? null : parsed.memoryDir;
  if (memoryDir !== null && (typeof memoryDir !== "string" || !memoryDir)) return { ok: false, error: `${file}: memoryDir must be a non-empty string` };
  if (process.env.KIT_MEMORY_DIR) memoryDir = process.env.KIT_MEMORY_DIR;
  return { ok: true, stateDocs, memoryDir };
}

const ENTRY_DOCS = new Set(["CLAUDE.md", "AGENTS.md"]);
const PAYLOAD_DOCS = new Set(["core/INVARIANTS.md", "core/REPO_INVARIANTS.md"]);
const SNAPSHOT_DOCS = new Set(["core/SYSTEM_MAP.md"]);

export function roleFor(relPath) {
  if (ENTRY_DOCS.has(relPath)) return "entry";
  if (PAYLOAD_DOCS.has(relPath)) return "payload";
  if (SNAPSHOT_DOCS.has(relPath)) return "snapshot";
  return "method"; // any newly discovered core/*.md defaults to the boot-method cap
}
// The marker must appear in the head of the file, where a reader actually meets it.
const MARKER_SCAN_LINES = 12;
const CLASS_RE = /\bCLASS:\s*(BINDING|REFERENCE|STATE)\b/;
// A REFERENCE doc is only safe to leave uncapped if it is genuinely navigable.
const TOC_RE = /^#{2,3}\s+(contents|table of contents)\b/im;

// SCOPE: the CANONICAL set — core/ plus the two pinned root entry stubs. Nothing outside core/ and
// the pinned files is canonical (blueprint §2.2), so docs/journal/ is deliberately NOT swept: it is
// append-only history, and the transitional plan doc there declares BINDING while knowingly sitting
// over cap. Governing it would make this check red on a doc it does not govern.
//
// The list below is a FLOOR, not the population. `governedDocs()` unions it with every core/*.md on
// disk, because a hand-maintained allowlist fails OPEN in the one direction that matters: removal is
// caught (a missing path FAILs), but ADDITION is invisible — a new core doc would be uncapped by
// omission, which is exactly the silent-growth failure this check exists to stop.
export const GOVERNED_DOCS = [
  "CLAUDE.md",
  "AGENTS.md",
  "core/README.md",
  "core/WORKFLOW.md",
  "core/REVIEW.md",
  "core/OPERATE.md",
  "core/BINDINGS.md",
  "core/GATES.md",
  "core/LANES.md",
  "core/INVARIANTS.md",
  "core/REPO_INVARIANTS.md",
  // Repo-specific CLASS: STATE current-state heads (e.g. docs/open_work_current_state.md) are NOT in
  // this portable floor — a fresh adopter may not have one. They are added at runtime from
  // .claude/kit.config.json `stateDocs` (see governedDocs), where a declared-but-missing STATE doc
  // then FAILs, exactly as a missing floor doc does.
];

export function classify(text) {
  const head = text.split(/\r?\n/, MARKER_SCAN_LINES).join("\n");
  const match = CLASS_RE.exec(head);
  return match ? match[1] : null;
}

export function checkDoc(relPath, { root = REPO_ROOT, stateDocs = [] } = {}) {
  const abs = path.join(root, relPath);
  if (!existsSync(abs)) {
    return { path: relPath, ok: false, reason: `governed doc is MISSING (moved or renamed without updating this list?)` };
  }
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    // FAIL CLOSED with a STRUCTURED result, never an uncaught throw: a governed doc that exists but
    // cannot be read (it is a directory, a permission error, …) must be a clean FAIL, not a crash.
    return { path: relPath, ok: false, reason: `governed doc is UNREADABLE (${e.code ?? e.message}) — failing closed.` };
  }
  const bytes = Buffer.byteLength(text, "utf8");
  const declared = classify(text);

  if (!declared) {
    return {
      path: relPath,
      bytes,
      ok: false,
      reason:
        `no CLASS marker in the first ${MARKER_SCAN_LINES} lines. Declare exactly one of ` +
        `"CLASS: BINDING" (read whole — capped at ${BINDING_CAP_BYTES} bytes) or ` +
        `"CLASS: REFERENCE (lookup-only)" (uncapped, needs a "## Contents" section). ` +
        `Undeclared fails closed — the class is never inferred.`,
    };
  }

  if (declared === "BINDING") {
    const role = roleFor(relPath);
    const cap = ROLE_CAPS[role];
    // FAIL CLOSED on an unknown/misspelled role: `bytes > undefined` is `false`, so a missing cap would
    // let a BINDING doc PASS at any size — the exact silent fail-open a size control must never have.
    if (cap === undefined) {
      return {
        path: relPath,
        bytes,
        class: declared,
        role,
        ok: false,
        reason:
          `BINDING doc has role '${role}', which has no configured cap in ROLE_CAPS — failing closed. ` +
          `A size control must never pass a doc it cannot bound; add the role's cap or fix the mapping.`,
      };
    }
    if (bytes > cap) {
      const why = {
        entry: "an entry stub is read at the start of EVERY session; it must stay small",
        method: "the boot set is read whole before any work begins, and this is the budget that bounds it",
        payload: "this file is cat'd into EVERY gate payload, where it competes with the artifact under review",
        snapshot: "this is the regenerated boot architecture snapshot; keep it tight so the boot read stays cheap",
      }[role];
      return {
        path: relPath,
        bytes,
        class: declared,
        role,
        cap,
        ok: false,
        reason:
          `BINDING doc (role=${role}) is ${bytes} bytes, over its ${cap}-byte cap by ${bytes - cap} — ${why}. ` +
          `SPLIT it at a concept seam and record the split, or move detail to docs/journal/ — ` +
          `do NOT delete doctrine to fit.`,
      };
    }
    return { path: relPath, bytes, class: declared, role, cap, ok: true };
  }

  if (declared === "STATE") {
    // STATE is advisory (WARN, never a hard cap) — so a CAPPED boot doc (an entry stub or any core/*.md)
    // must NOT be allowed to declare STATE to dodge its cap. Only a doc the repo EXPLICITLY declared as a
    // STATE doc in kit.config.json `stateDocs` may carry CLASS: STATE; any other doc doing so FAILS.
    if (!stateDocs.includes(relPath)) {
      return {
        path: relPath,
        bytes,
        class: declared,
        ok: false,
        reason:
          `CLASS: STATE is only permitted for a doc declared in kit.config.json "stateDocs" — ${relPath} is ` +
          `not one, so declaring STATE here would evade its hard size cap. Use CLASS: BINDING or ` +
          `CLASS: REFERENCE, or declare this path as a stateDoc if it is genuinely a regenerated state head.`,
      };
    }
    // A CLASS: STATE doc is a regenerated current-state head (e.g. docs/open_work_current_state.md). It
    // legitimately grows between regenerations, so its size is ADVISORY (a WARN), never a hard cap that
    // would block an unrelated commit. It still FAILS CLOSED on missing/unreadable (handled above by the
    // existsSync + readFileSync guards), so the exit-0 leniency is strictly the size-vs-threshold.
    const warn =
      bytes > STATE_WARN_BYTES
        ? `state doc is ${bytes} B, over the ${STATE_WARN_BYTES}-byte WARN threshold — REGENERATE it: ` +
          `archive the current bytes verbatim to docs/journal/, then rewrite the bounded head.`
        : null;
    return { path: relPath, bytes, class: declared, ok: true, warn };
  }

  // REFERENCE: uncapped, but it must actually be navigable, or "look it up later" is a fiction.
  if (!TOC_RE.test(text)) {
    return {
      path: relPath,
      bytes,
      class: declared,
      ok: false,
      reason:
        `REFERENCE doc has no "## Contents" section. An uncapped doc is only safe if it can be ` +
        `navigated to an anchor instead of read whole.`,
    };
  }
  return { path: relPath, bytes, class: declared, ok: true };
}

// The actual governed population: the declared floor UNION every markdown file in core/. Discovering
// core/ from disk is what makes an added doc governed automatically instead of uncapped by omission.
export function governedDocs({ root = REPO_ROOT, stateDocs = [] } = {}) {
  const found = new Set(GOVERNED_DOCS);
  // Repo-specific STATE docs from .claude/kit.config.json. A declared-but-missing one FAILs in
  // checkDoc (existsSync guard), same as any floor doc — a config that names a doc that does not
  // exist is a real error, not silently skipped.
  for (const s of stateDocs) found.add(s);
  // RECURSIVE: a one-level scan would let core/anything/RULES.md declare BINDING, exceed the cap,
  // and pass silently — the same uncapped-by-omission hole one directory deeper.
  // Symlinked entries are NOT followed (withFileTypes reports the link itself, not its target), so a
  // link cannot smuggle a file in from outside core/ or spin a cycle.
  const walk = (relDir) => {
    const absDir = path.join(root, relDir);
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = path.posix.join(relDir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.add(rel);
    }
  };
  walk("core");
  return [...found].sort();
}

export function checkAll(opts = {}) {
  return (opts.docs ?? governedDocs(opts)).map((d) => checkDoc(d, opts));
}

// Opt-in advisory scan of the EXTERNAL, per-machine memory store. Never wired into `npm test`. It is
// FAIL-CLOSED when the caller explicitly requested it but the target dir is missing/unreadable (an
// explicitly requested control must not report green without inspecting), and advisory (WARN, exit 0)
// on over-cap topic/index files. Absent flag ⇒ not called at all (clean skip).
export function checkMemory(dir) {
  if (!dir) {
    return { ok: false, error: `no memory dir configured — set kit.config.json "memoryDir" or KIT_MEMORY_DIR, or pass --memory=<dir>`, warnings: [] };
  }
  if (!existsSync(dir)) {
    return { ok: false, error: `memory dir not found: ${dir}`, warnings: [] };
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: `memory dir unreadable: ${dir} (${e.code ?? e.message})`, warnings: [] };
  }
  const warnings = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    let bytes;
    try {
      bytes = statSync(path.join(dir, entry.name)).size;
    } catch (e) {
      // SURFACE, never silently skip: an explicitly requested scan must not report green on a file it
      // could not inspect (a concurrent deletion / permission race after readdirSync).
      warnings.push(`${entry.name} could not be inspected (${e.code ?? e.message}).`);
      continue;
    }
    const isIndex = entry.name === "MEMORY.md";
    const cap = isIndex ? MEMORY_INDEX_CAP : MEMORY_TOPIC_CAP;
    if (bytes > cap) {
      warnings.push(
        `${entry.name} is ${bytes} B, over its ${cap}-byte ${isIndex ? "index" : "topic"} cap — ` +
          `${isIndex ? "compact the index" : "split the topic (archive detail to docs/journal/)"}.`,
      );
    }
  }
  return { ok: true, error: null, warnings };
}

// Clean-skip requires the COMPLETE ABSENCE of --memory. Any `--memory` (bare ⇒ default dir, or
// `--memory=<dir>`) requests the check; a missing/unreadable resolved dir then FAILs (checkMemory).
export function parseMemoryArg(argv, defaultDir = null) {
  for (const a of argv) {
    if (a === "--memory") return { requested: true, dir: defaultDir };
    if (a.startsWith("--memory=")) return { requested: true, dir: a.slice("--memory=".length) };
  }
  return { requested: false, dir: null };
}

function main() {
  const asJson = process.argv.includes("--json");
  // DOC_SIZE_ROOT lets a test drive the real CLI against a planted tree, so the exit code itself is
  // provable. Without it the CLI can only ever be asserted green, which proves it runs, not that it
  // fails when it should.
  const root = process.env.DOC_SIZE_ROOT ? path.resolve(process.env.DOC_SIZE_ROOT) : REPO_ROOT;
  const cfg = loadKitConfig(root);
  if (!cfg.ok) {
    // FAIL CLOSED: a governance check whose own config is corrupt must not report green.
    console.error(`check-doc-size: kit config error — ${cfg.error}. Fix .claude/kit.config.json or delete it to use portable defaults.`);
    process.exit(1);
  }
  const results = checkAll({ root, stateDocs: cfg.stateDocs });
  const mem = parseMemoryArg(process.argv, cfg.memoryDir);
  const memResult = mem.requested ? checkMemory(mem.dir) : null;

  if (asJson) {
    console.log(JSON.stringify({ roleCaps: ROLE_CAPS, results, memory: memResult }, null, 2));
  } else {
    for (const r of results) {
      const size = r.bytes === undefined ? "     ?" : String(r.bytes).padStart(6);
      const cls = `${r.class ?? "UNDECLARED"}${r.role ? "/" + r.role : ""}`.padEnd(17);
      const verdict = r.ok ? (r.warn ? "WARN" : "PASS") : "FAIL";
      const note = r.ok ? (r.warn ? `\n        ⚠ ${r.warn}` : "") : `\n        → ${r.reason}`;
      console.log(`${verdict}  ${size} B  ${cls}  ${r.path}${note}`);
    }
    if (memResult) {
      if (memResult.error) {
        console.log(`FAIL       ?  MEMORY/advisory    ${mem.dir}\n        → ${memResult.error}`);
      } else if (memResult.warnings.length) {
        for (const w of memResult.warnings) console.log(`WARN          MEMORY/advisory    ${w}`);
      } else {
        console.log(`memory advisory: ${mem.dir} — all files under cap.`);
      }
    }
  }

  const failures = results.filter((r) => !r.ok);
  const memFailed = Boolean(memResult && memResult.error);
  if (failures.length || memFailed) {
    if (failures.length) console.error(`\ncheck-doc-size: ${failures.length} FAIL of ${results.length} governed docs.`);
    if (memFailed) console.error(`check-doc-size: memory advisory FAILED — ${memResult.error}`);
    process.exit(1);
  }
  if (asJson) return; // --json emits PURE JSON (above) so it stays machine-parseable — no human summary.
  const warnCount = results.filter((r) => r.warn).length + (memResult ? memResult.warnings.length : 0);
  console.log(
    `\ncheck-doc-size: ${results.length} governed docs OK` +
      (warnCount ? ` · ${warnCount} WARN` : "") +
      ` (caps: entry ${ROLE_CAPS.entry} · method ${ROLE_CAPS.method} · payload ${ROLE_CAPS.payload} · ` +
      `snapshot ${ROLE_CAPS.snapshot} bytes · STATE WARN ${STATE_WARN_BYTES}).`,
  );
}

// realpathSync, NOT path.resolve: resolve() does not follow symlinks while fileURLToPath() yields a
// realpath, so under a symlinked invocation path (macOS /tmp -> private/tmp, where worktrees live)
// they differ, main() never runs, and the CLI exits 0 with no output — a false green.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
