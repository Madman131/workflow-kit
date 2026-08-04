#!/usr/bin/env node
// scripts/check-skill-budgets.mjs — word budgets over the KIT's instruction-artifact classes.
//
// WHY THIS EXISTS. core/ARTIFACT_CLASS.md calls budget a GATE for instruction artifacts, and the
// skill bodies declare `Word budget: N` in their heads — but nothing enforced those numbers:
// `scripts/check-doc-size.mjs` measures BYTES against role caps over an ADOPTED repo's core/ docs
// and has never looked at the kit's own skills, shims, or agents. The honour system is the known
// loser here (the origin repo shipped with two of six skill files over their own declared numbers
// before its checker existed). This is the kit-repo governance gate: it runs first in `npm test`.
//
// THREE CLASSES, three policies — the class fix, not one instance:
//   skills/**       DECLARED — every .md (canonical bodies AND reference-layer siblings, e.g.
//                   INVOKE.md) declares `Word budget: N` in its head. UNDECLARED is RED, never
//                   skipped: a skill carrying no budget line is ungoverned by omission, the
//                   addition-is-invisible failure check-doc-size documents for GOVERNED_DOCS.
//                   Each file carries its OWN number — a body and its reference layer are never
//                   summed (a checker must not punish the split the doctrine prefers).
//   skill-shims/**  CLASS CAP (SHIM_CAP). A shim is a pointer holding no rules of its own, so it
//                   declares no budget — and a shim that DOES carry a `Word budget:` line FAILS
//                   (`MARKER-IN-SHIM`): rules worth budgeting belong in the shared body. This is
//                   the shared-body invariant the install tests pin for two shims, made mechanical
//                   for all of them.
//   agents/*.md     CLASS CAP (AGENT_CAP). Reviewer seat definitions are system prompts; length
//                   is a first-order cost (ARTIFACT_CLASS instruction physics).
//
// ⚠ WHAT THIS DOES **NOT** CLOSE. A skills/ file declares its own limit, so an author may still
// raise the number to fit the fold — the very failure that motivates the check. KNOWN_OVER pins the
// declared budget of a file carrying recorded debt, but every other number is self-set; catching
// THAT needs an Owner-ratified registry outside the artifact, which is an Owner decision, not a
// checker. The class caps below are likewise numbers of record until the Owner changes them.
//
// THE UNIT IS `wc -w` OVER THE WHOLE FILE, frontmatter included — whole-file wins because it is
// what `wc -w <file>` prints with no flags, so any number here is checkable by hand in one command.
// CAVEAT: JS `\s` treats NBSP and friends (U+00A0, U+2000-200A, U+3000, U+FEFF) as separators and
// `wc -w` does not, so a file containing them counts HIGHER here — a false FAIL, never a false pass.
//
// DISCOVERY IS RECURSIVE AND FROM DISK, following symlinked directories (Dirent.isDirectory() is
// false for a symlink-to-dir, which would silently un-govern a subtree). An unreadable directory or
// a dangling symlink is a STRUCTURED error, never a silent skip. A class whose root yields ZERO
// files FAILS — this check governing nothing is never a pass.
//
// Usage: node scripts/check-skill-budgets.mjs [--json]
// Env:   SKILL_BUDGETS_ROOT — drive the CLI against a planted tree so its EXIT CODE is provable
//        both ways (the convention check-doc-size.mjs states for DOC_SIZE_ROOT). Under it the debt
//        ledger is emptied — announced, never silent — so a planted tree is judged on its own files.
// Exit 0 = every governed file within budget, no stale exemption. Exit 1 = anything else.

import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = process.env.SKILL_BUDGETS_ROOT
  ? path.resolve(process.env.SKILL_BUDGETS_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The three governed classes. Caps are Owner-ratified numbers of record (v1.7.0): the largest shim
// ships at ~200 words and the largest agent at ~375, so the caps leave real headroom without
// letting a pointer quietly become a body or a seat definition become a doctrine file.
export const SHIM_CAP = 250;
export const AGENT_CAP = 500;
export const CLASSES = [
  { name: "skills", root: "skills", policy: "declared" },
  { name: "skill-shims", root: "skill-shims", policy: "cap", cap: SHIM_CAP, forbidMarker: true },
  { name: "agents", root: "agents", policy: "cap", cap: AGENT_CAP },
];

// The budget line lives in the file head, where a reader meets it (line 3-9 in the current tree —
// NOT a fixed line; do not tighten the window). Scanning the whole file would let a quoted
// "Word budget:" in an example satisfy the check.
const MARKER_SCAN_LINES = 12;
const BUDGET_RE = /^Word budget:\s*(\d+)/m;

// A NOTICE BAND, so a bare `if (measured > declared)` cannot take a file PASS → hard FAIL on one
// added word with no warning. An ABSOLUTE margin, not a ratio: skill budgets are set near the
// measured length, so a 15% band would fire on almost every file — a notice that always fires is
// not a notice. What matters is room to add a sentence, which is roughly constant in words.
const WARN_MARGIN_WORDS = 15;

// ── THE RATCHET ─────────────────────────────────────────────────────────────────────────────────
// Recorded budget debt: an entry may hold or shrink, never grow; it FAILS as stale once the file is
// back under budget, or if the file's declared budget changes (raising the number would otherwise
// neutralise the ratchet in one edit — `declared` is load-bearing, not a comment). EMPTY at v1.7.0:
// every governed file ships within budget. The mechanism stays, exercised by test via the
// injectable `known`, so future debt is recorded here instead of the check being loosened.
export const KNOWN_OVER = new Map([]);

/** `wc -w` semantics: whitespace-delimited tokens over the entire file. */
export function countWords(text) {
  return text.split(/\s+/).filter((t) => t.length > 0).length;
}

export function declaredBudget(text) {
  const head = text.split(/\r?\n/, MARKER_SCAN_LINES).join("\n");
  const match = BUDGET_RE.exec(head);
  return match ? Number(match[1]) : null;
}

/**
 * Discover every .md under `root/classRoot`, recursively, following symlinked directories.
 * Returns { files, errors } — an unreadable subtree is unGOVERNED, which must be loud, so it
 * becomes a structured error rather than an uncaught throw or a silent skip.
 */
export function governedFiles(classRoot, { root = DEFAULT_ROOT } = {}) {
  const base = path.join(root, classRoot);
  const files = [];
  const errors = [];
  if (!existsSync(base)) return { files, errors };

  const seen = new Set(); // realpath guard: a symlink cycle must terminate, not hang.
  const walk = (abs) => {
    let real;
    try {
      real = realpathSync(abs);
    } catch (e) {
      errors.push({ path: path.relative(root, abs), state: "UNREADABLE", ok: false, reason: `cannot resolve: ${e.code || e.message}` });
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);

    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      errors.push({ path: path.relative(root, abs), state: "UNREADABLE", ok: false, reason: `cannot read directory: ${e.code || e.message}` });
      return;
    }

    for (const entry of entries) {
      const child = path.join(abs, entry.name);
      let st;
      try {
        // statSync follows symlinks, so a symlinked dir is walked like a real one; a DANGLING
        // symlink throws here and is reported rather than crashing the scan.
        st = statSync(child);
      } catch (e) {
        errors.push({ path: path.relative(root, child), state: "UNREADABLE", ok: false, reason: `cannot stat: ${e.code || e.message} (dangling symlink?)` });
        continue;
      }
      if (st.isDirectory()) walk(child);
      else if (st.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(path.relative(root, child).split(path.sep).join("/"));
      }
    }
  };

  walk(base);
  return { files: files.sort(), errors };
}

// skills/ policy: the file's own declared number governs, ratchet-aware. `known` is injectable so
// a caller (and the tests) can judge a tree against ITS OWN debt ledger.
export function checkDeclared(relPath, { root = DEFAULT_ROOT, known = KNOWN_OVER } = {}) {
  const abs = path.join(root, relPath);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    return { path: relPath, state: "UNREADABLE", ok: false, reason: `cannot read: ${e.code || e.message}` };
  }

  const declared = declaredBudget(text);
  const measured = countWords(text);

  if (declared === null) {
    return {
      path: relPath, state: "UNDECLARED", ok: false, measured,
      reason: `no \`Word budget: N\` in the first ${MARKER_SCAN_LINES} lines — measures ${measured} words. ` +
        `A skill file declaring no budget is ungoverned by omission; declare one (core/ARTIFACT_CLASS.md: budget is a gate).`,
    };
  }

  const exempt = known.get(relPath);

  if (exempt) {
    // Checked FIRST: raising the declared number is the one-edit escape from the ratchet.
    if (declared !== exempt.declared) {
      return {
        path: relPath, state: "STALE-EXEMPTION", ok: false, declared, measured,
        reason: `declared budget CHANGED ${exempt.declared} → ${declared} while carrying recorded debt. ` +
          `Raising a budget does not clear a debt: take the new number to the Owner, then re-seed or ` +
          `delete its KNOWN_OVER entry in scripts/check-skill-budgets.mjs.`,
      };
    }
    if (measured <= declared) {
      return {
        path: relPath, state: "STALE-EXEMPTION", ok: false, declared, measured,
        reason: `now WITHIN budget (${measured}/${declared}) but still listed in KNOWN_OVER. ` +
          `Delete its entry — a permanent exemption is a lie.`,
      };
    }
    if (measured > exempt.measured) {
      return {
        path: relPath, state: "DEBT-GREW", ok: false, declared, measured,
        reason: `recorded debt GREW: ${exempt.measured} → ${measured} words (budget ${declared}, since ` +
          `${exempt.since}). Debt may shrink or hold, never increase — cut back to at most ${exempt.measured}.`,
      };
    }
    return {
      path: relPath, state: "KNOWN-OVER", ok: true, warn: true, declared, measured,
      reason: `${measured}/${declared} — recorded debt since ${exempt.since}, ${measured - declared} over. May only shrink.`,
    };
  }

  if (measured > declared) {
    return {
      path: relPath, state: "OVER", ok: false, declared, measured,
      reason: `${measured}/${declared} words — ${measured - declared} OVER budget. Cut it back, or take ` +
        `a new number to the Owner (core/ARTIFACT_CLASS.md: budget is a gate).`,
    };
  }

  if (declared - measured < WARN_MARGIN_WORDS) {
    return {
      path: relPath, state: "NEAR-CAP", ok: true, warn: true, declared, measured,
      reason: `${measured}/${declared} — only ${declared - measured} word(s) of headroom. Displace text ` +
        `before adding more, or take a new number to the Owner.`,
    };
  }

  return { path: relPath, state: "OK", ok: true, declared, measured };
}

// Class-cap policy (shims, agents): the CLASS's cap governs; the file declares nothing. For shims a
// `Word budget:` marker is itself a failure — a pointer with rules enough to budget is a body in
// the wrong place.
export function checkCapped(relPath, { root = DEFAULT_ROOT, cap, forbidMarker = false } = {}) {
  const abs = path.join(root, relPath);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    return { path: relPath, state: "UNREADABLE", ok: false, reason: `cannot read: ${e.code || e.message}` };
  }

  const measured = countWords(text);

  if (forbidMarker && declaredBudget(text) !== null) {
    return {
      path: relPath, state: "MARKER-IN-SHIM", ok: false, declared: cap, measured,
      reason: `a shim declares a \`Word budget:\` line. Shims are pointers carrying no rules of their ` +
        `own (the shared-body invariant) — move the content to the skill's body under skills/, ` +
        `which declares its own budget.`,
    };
  }

  if (measured > cap) {
    return {
      path: relPath, state: "OVER", ok: false, declared: cap, measured,
      reason: `${measured}/${cap} words — ${measured - cap} OVER the class cap. A file this long is ` +
        `outgrowing its class: move rules into a skills/ body (its own declared budget), or take a ` +
        `new class cap to the Owner.`,
    };
  }

  if (cap - measured < WARN_MARGIN_WORDS) {
    return {
      path: relPath, state: "NEAR-CAP", ok: true, warn: true, declared: cap, measured,
      reason: `${measured}/${cap} — only ${cap - measured} word(s) below the class cap.`,
    };
  }

  return { path: relPath, state: "OK", ok: true, declared: cap, measured };
}

export function checkAll({ root = DEFAULT_ROOT, known = KNOWN_OVER } = {}) {
  const results = [];
  const skillFilesPresent = new Set();

  for (const cls of CLASSES) {
    const { files, errors } = governedFiles(cls.root, { root });
    results.push(...errors);
    if (files.length === 0 && errors.length === 0) {
      results.push({
        path: `${cls.root}/`, state: "EMPTY-CLASS", ok: false,
        reason: `no .md files found under ${cls.root}/ — the ${cls.name} class is ungoverned, which is never a pass. ` +
          `If the class was deliberately retired, remove it from CLASSES in scripts/check-skill-budgets.mjs (an Owner call).`,
      });
      continue;
    }
    for (const f of files) {
      if (cls.policy === "declared") {
        skillFilesPresent.add(f);
        results.push(checkDeclared(f, { root, known }));
      } else {
        results.push(checkCapped(f, { root, cap: cls.cap, forbidMarker: cls.forbidMarker }));
      }
    }
  }

  // An exemption outliving its subject would silently excuse a future file at the same path.
  for (const relPath of known.keys()) {
    if (!skillFilesPresent.has(relPath)) {
      results.push({
        path: relPath, state: "STALE-EXEMPTION", ok: false,
        reason: `listed in KNOWN_OVER but no such governed file exists (moved or deleted?). Remove the entry.`,
      });
    }
  }
  return results;
}

function main() {
  const json = process.argv.includes("--json");
  // The debt ledger describes THIS repo's files; against a planted tree its entries would all read
  // as STALE-EXEMPTION, so a clean planted tree would FAIL and the exit code would prove nothing.
  // Under the override the ledger is therefore empty — announced, never silent.
  const planted = Boolean(process.env.SKILL_BUDGETS_ROOT);
  const results = checkAll(planted ? { known: new Map() } : {});
  if (planted && !json) {
    console.log(`check-skill-budgets: SKILL_BUDGETS_ROOT=${DEFAULT_ROOT} — planted tree, debt ledger NOT applied.`);
  }

  // `[].every()` is true, so an empty result set would otherwise print ok and exit 0 — a false
  // green on zero inspected files. Unreachable while CLASSES is non-empty (EMPTY-CLASS rows), kept
  // as the last-resort floor.
  if (results.length === 0) {
    const msg = `check-skill-budgets: FAIL — nothing inspected. This check governs nothing, which is never a pass.`;
    if (json) console.log(JSON.stringify({ ok: false, results: [], reason: msg }, null, 2));
    else console.error(msg);
    process.exit(1);
  }

  const ok = results.every((r) => r.ok);

  if (json) {
    console.log(JSON.stringify({ ok, results }, null, 2));
    process.exit(ok ? 0 : 1);
  }

  for (const r of results) {
    const size = r.declared === undefined ? "" : `${String(r.measured).padStart(4)} / ${String(r.declared).padEnd(4)}`;
    const label = !r.ok ? "FAIL" : r.warn ? "WARN" : "PASS";
    // Name the STATE on every non-OK row: "FAIL" alone does not say which failure, and the state
    // names (UNDECLARED, MARKER-IN-SHIM, EMPTY-CLASS, …) are the greppable vocabulary the tests
    // and the release notes use.
    const tag = r.state === "OK" ? "" : `  [${r.state}]`;
    console.log(`${label.padEnd(5)} ${size.padEnd(13)} ${r.path}${tag}`);
    if (r.reason) console.log(`      ${r.reason}`);
  }

  const bad = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.warn);
  if (bad.length) {
    console.error(`\ncheck-skill-budgets: ${bad.length} problem(s) in ${results.length} governed file(s).`);
    process.exit(1);
  }
  console.log(`\ncheck-skill-budgets: ${results.length} governed file(s) OK` +
    (warned.length ? ` · ${warned.length} on notice (recorded debt or near cap)` : "") +
    ` — unit is \`wc -w\` over the whole file; skills declare their own budgets, shims (cap ${SHIM_CAP})` +
    ` and agents (cap ${AGENT_CAP}) are class-capped. Does NOT govern core/ docs (that is doc:size in an adopted repo).`);
}

// realpathSync, not resolve(): under a symlinked invocation path the two differ and main() would
// never run — the CLI would exit 0 with no output, a false green. Same trap as check-doc-size.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
