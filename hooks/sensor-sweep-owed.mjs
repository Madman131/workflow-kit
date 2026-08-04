#!/usr/bin/env node
// workflow-kit — sensor-sweep-owed.mjs. PreToolUse on a write, BOTH LANES.
// Tests: tests/sensor-sweep-owed.test.mjs · Doctrine: core/WORKFLOW.md § Gate (the pre-fold sweep).
//
// WHY THIS EXISTS: `scripts/sweep.mjs` ships with NO invocation trigger — no npm script, no CI step.
// A tool with no trigger fires only when an agent happens to remember it, and the standing diagnosis
// of controls that quietly stopped working is that SELF-KEYED TRIGGERS FAIL WHILE EXTERNALLY-FORCED
// ONES WORK. This is the external force: it prints whether or not you remembered.
//
// WHY PreToolUse AND NOT PostToolUse: the obligation is PRE-FOLD. At the moment this fires nothing
// has been folded, so there is no diff — the only input that exists is the write about to happen.
// PostToolUse fires AFTER the write, which defeats the very obligation it would report.
//
// WHAT IT DELIBERATELY DOES NOT DO — SENSOR, NOT ACTUATOR (core/FOUNDATIONS.md P2: a lower layer
// surfaces and verifies; it never decides for the layer above). It NEVER denies, and it keeps NO
// durable state. Statelessness is a decision, not an omission: a hook that fires on ordinary work
// trains the reader to switch the hook off, which is how controls actually die. What makes
// statelessness affordable is the SCOPE GATE below — governed documents plus the skill trees, not
// the whole repo. Without that gate this emits on nearly every file.
//
// IT BINDS WRITE TOOLS ONLY, like every PreToolUse control in this kit. A rule rewritten by a plain
// shell command (`sed -i`, a heredoc, `git apply`) reaches no PreToolUse hook at all, so this sensor
// is silent on it — and silence here is not "nothing was owed". The commit floor is the only layer
// every writer converges at (core/BINDINGS.md § Enforcement asymmetry).
//
// IT REPORTS AN OBLIGATION, IT DOES NOT REPORT THAT THE OBLIGATION WAS MET. Nothing here observes
// whether a sweep ran; it cannot, and a line claiming otherwise would be the "prose naming a
// mechanism nothing reads" shape this kit pays for repeatedly. The sweep itself is a ceremony whose
// file list is chosen by whoever runs it — so neither this sensor nor a sweep report closes anything.
//
// ONE SOURCE PER MECHANICAL FACT: `classify`, `governedDocs` and `CLASS_RE` are IMPORTED from
// scripts/check-doc-size.mjs, which already owns "which documents are governed" and "what a class
// marker looks like". Do not inline a second CLASS: regex or a second governed-doc list here — two
// transcriptions of one population silently differ, and a test asserts this file contains no such
// regex of its own.

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, governedDocs, CLASS_RE, loadKitConfig } from "../scripts/check-doc-size.mjs";
import { extractTargets } from "./payload-targets.mjs";

// The two skill trees an ADOPTER carries (`bin/init.mjs`): `.agents/skills/` holds the canonical
// shared bodies, `.claude/skills/` the Claude entry stubs. `.codex/skills/` is listed because the
// Codex lane may carry its own stubs; a tree that does not exist simply never matches.
//
// This is a PATH rule, not a copied list — a new skill is in scope the moment it exists. It is
// written out here rather than imported because the kit's own `check-skill-budgets.mjs` governs the
// KIT SOURCE tree (`skills/`, `skill-shims/`), which is not where an adopter's installed skills
// live. `AC-SKILL-TREES` in the test file fails if a fourth tree ever appears, which is the only
// thing keeping this line from going stale silently.
export const SKILL_ROOTS = [".agents/skills", ".claude/skills", ".codex/skills"];

// `.toLowerCase()` is not defensive noise — it mirrors the budget checker's own predicate, which
// walks with `entry.name.toLowerCase().endsWith(".md")`. A case-SENSITIVE test here would re-create,
// on the extension, the same two-transcriptions-of-one-population disagreement.
export const isSkillFile = (rel) =>
  typeof rel === "string" && rel.toLowerCase().endsWith(".md") && SKILL_ROOTS.some((r) => rel.startsWith(`${r}/`));

/**
 * The class a WRITE FRAGMENT declares — deliberately a different window from `classify()`.
 *
 * `classify()` windows to the first 12 lines, which is right for a DOCUMENT (the class a reader
 * meets in the head) and a CATEGORY ERROR for a fragment, whose line 1 is wherever the edit happens
 * to start. Windowing a fragment lets a realistic promotion escape: a replacement that rewrites a
 * section and flips the head marker puts that marker below line 12, `classify()` returns null, and a
 * document being promoted to BINDING is silent. So scan the WHOLE fragment. Over-reading costs one
 * extra reminder; under-reading costs the control.
 */
export function classifyFragment(text) {
  if (typeof text !== "string" || text === "") return null;
  // PREFER BINDING over an earlier non-BINDING match. In a document "first wins" is right — the
  // class is what a reader meets in the head. In a FRAGMENT there is no head, and the question is
  // "does this write introduce BINDING text?", so a BINDING marker anywhere in it wins.
  const all = String(text).match(new RegExp(CLASS_RE.source, "g")) || [];
  if (all.some((m) => /BINDING/.test(m))) return "BINDING";
  const first = CLASS_RE.exec(text);
  return first ? first[1] : null;
}

/**
 * Does this write owe a pre-fold sweep? Pure, so tests bite directly.
 *
 * Two independent triggers, either sufficient:
 *   · the target is a GOVERNED doc that is (or is being made) CLASS: BINDING — editing a rule in a
 *     controlling document is the load-bearing pre-fold case;
 *   · the target is a skill file — a skill body is a rule other work depends on by name.
 *
 * `governed` and `readDoc` are injected so a test can drive this without a tree on disk.
 */
export function sweepOwed(rel, fragment, { governed = [], readDoc = () => "" } = {}) {
  if (typeof rel !== "string" || !rel) return null;
  if (isSkillFile(rel)) return { reason: "skill-body", rel };
  if (!governed.includes(rel)) return null;
  // The fragment can PROMOTE a document to BINDING even when the file on disk is not yet one, so
  // check the incoming text first and fall back to the file's current class. Absence of both is not
  // a trigger: a REFERENCE or STATE doc does not owe the pre-fold sweep.
  const declared = classifyFragment(fragment) ?? classify(readDoc(rel) || "");
  return declared === "BINDING" ? { reason: "binding-doc", rel } : null;
}

const REMINDER = (hits) =>
  `SWEEP OWED — pre-fold dependency check (core/WORKFLOW.md § Gate)\n\n` +
  hits.map((h) => `  · ${h.rel} — ${h.reason === "skill-body" ? "skill body" : "CLASS: BINDING document"}\n`).join("") +
  `\nBefore this edit is folded, sweep for every clause that DEPENDS on the rule you are changing —\n` +
  `vocabulary AND premise-sharers, not just the words you edited. A grep matches SPELLINGS; the\n` +
  `dependency you are looking for may share a premise and no vocabulary at all.\n\n` +
  `  /sweep   or   node scripts/sweep.mjs --question "<ONE mechanical question>" \\\n` +
  `             --repo <abs repo path> --files <path> [--files <path>]...\n\n` +
  `This sensor does NOT observe whether you ran one, and a sweep does not close the question either:\n` +
  `its file list is chosen by whoever runs it, and a zero-finding sweep is not a clear. The report is\n` +
  `evidence for your disposition, never a substitute for it.\n`;

// ---------------------------------------------------------------------------- entry

export function main({ stdin = process.stdin, stderr = process.stderr, cwd = process.cwd() } = {}) {
  let input = "";
  stdin.on("data", (d) => (input += d));
  stdin.on("end", () => {
    let ev;
    try { ev = JSON.parse(input); } catch { process.exit(0); }   // never break the tool on a parse failure

    // A sensor must not shout at a subagent that cannot act on it. Presence of either subagent
    // marker suppresses — tested with `in`, not a value comparison, because ANY value under that
    // key marks a subagent-shaped event, `null` included.
    if (ev !== null && typeof ev === "object" && ("agent_id" in ev || "agent_type" in ev)) process.exit(0);

    const extracted = extractTargets(ev);
    // NO WRITE INTENT ⇒ nothing owed. An UNREADABLE write-shaped payload is also not this sensor's
    // business: it is a SENSOR, and the two write GUARDS already fail closed on that shape. Denying
    // or shouting here would duplicate their job with none of their authority.
    if (!extracted?.ok || !extracted.targets?.length) process.exit(0);

    const root = cwd;
    let governed = [];
    try {
      const cfg = loadKitConfig(root);
      governed = governedDocs({ root, stateDocs: cfg?.stateDocs ?? [] });
    } catch {
      // A tree this sensor cannot enumerate yields no governed list. It still checks the skill-path
      // rule, which needs no tree — degrade to less coverage, never to a crash that breaks the write.
      governed = [];
    }

    // `extractTargets` returns target PATHS (strings). The incoming text differs per lane: a Claude
    // write carries it under `new_string`/`content`; an apply_patch write carries every target's new
    // content inside the ONE envelope command, so the envelope itself is the fragment for each of
    // its targets. Over-attributing a marker across targets in one envelope costs an extra
    // reminder — the direction this sensor is allowed to be wrong in.
    const envelopeText = extracted.shape === "apply_patch" ? (ev?.tool_input?.command ?? "") : "";
    const claudeText = ev?.tool_input?.new_string ?? ev?.tool_input?.content ?? "";
    const fragment = envelopeText || claudeText;

    const hits = [];
    for (const target of extracted.targets) {
      const rel = path.isAbsolute(target) ? path.relative(root, target) : target;
      const hit = sweepOwed(rel, fragment, {
        governed,
        readDoc: (r) => { try { return readFileSync(path.join(root, r), "utf8"); } catch { return ""; } },
      });
      if (hit && !hits.some((h) => h.rel === hit.rel)) hits.push(hit);
    }
    if (!hits.length) process.exit(0);

    stderr.write(REMINDER(hits));
    process.exit(0);   // NEVER denies — exit 0 on every path, including the emitting one.
  });
}

// isMain guard, realpath'd on both sides: /tmp is a symlink on macOS, and without this an importing
// TEST would RUN the sensor and consume its own stdin.
const entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })()
  : null;
if (entry && entry === fileURLToPath(import.meta.url)) main();
