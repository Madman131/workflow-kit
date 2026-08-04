#!/usr/bin/env node
// workflow-kit — sensor-mutation-owed.mjs. PreToolUse on a write, BOTH LANES.
// Tests: tests/sensor-mutation-owed.test.mjs · Doctrine: core/INVARIANTS.md rule 1.
//
// WHY THIS EXISTS. One changeset in the originating repo shipped four defects of a single shape: a
// property of a check ASSERTED BY INFERENCE and never OBSERVED BY EXECUTION at the claim's boundary.
// Two of the four were canaries that guarded nothing — deleting the guard reddened zero tests. All
// four were caught by reviewer seats; none by the builder, and none by a rule.
//
// A RULE WAS ALREADY THERE AND DID NOT BIND. `core/INVARIANTS.md` already says: plant the bug the
// control claims to catch and watch it go red; a check never observed failing is vacuous. The
// builder QUOTED that rule in the changeset's own documents and violated it twice in the same
// changeset. The standing diagnosis (sensor-sweep-owed.mjs, same week) is that SELF-KEYED TRIGGERS
// FAIL WHILE EXTERNALLY-FORCED ONES WORK. This is the external force.
//
// WHY PreToolUse. The obligation is on the evidence you are about to write, so the useful moment is
// BEFORE the edit, while the mutation is still cheap to run — not after, when the record already
// says whatever it says.
//
// TWO-SIDED ON PURPOSE, and this is what a one-sided version gets wrong. The four defects were NOT
// one polarity: three were coverage NARROWER than claimed (a false CLEAR), the fourth was a match
// set WIDER than intended (a false FAIL) — and the fourth was introduced BY the fix for the third,
// precisely because that fix was made with only the false-clear side in view. So the emission asks
// for both: a planted case that REDDENS, and a clean case that STAYS GREEN. A one-sided remedy
// reproduces the missed side.
//
// SENSOR, NOT ACTUATOR (core/FOUNDATIONS.md P2). It never denies, keeps no state, and certifies
// nothing. It cannot tell whether a mutation was actually run — and that is not a gap to close
// later: `core/GATES.md` § Retired before shipping records a control that tried to mechanically
// enforce that a gate step happened, was NO-GO'd twice and DISCARDED, on the finding that counting
// records is not counting verdicts. A checker can see that a record EXISTS; it can never see that
// the record is TRUE. The reminder is the honest ceiling.
//
// SCOPE IS NARROW BY DESIGN. A hook that fires on ordinary work trains the reader to switch it off —
// how controls actually die. It fires only on files that ARE controls, or their tests.

import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractTargets, resolveProjectRoot, resolvePatchBase, toRepoRelative } from "./payload-targets.mjs";

/** Files whose edit creates the obligation: a check, a gate hook, or a test for either. */
export function owesMutationRecord(rel) {
  if (typeof rel !== "string" || rel === "") return null;
  const p = rel.replaceAll("\\", "/");
  const base = path.posix.basename(p);
  // A checker script. `check-*.mjs` is this kit's naming convention for every mechanical control.
  if (/^scripts\/check-[\w.-]+\.m?js$/.test(p)) return "a mechanical check";
  // A guard or sensor hook — same physics: a control whose coverage is asserted, not observed.
  // BOTH the kit's own source tree (`hooks/`) and an adopter's installed trees (`.claude/hooks/`,
  // `.codex/hooks/`) — the kit ships ONE hook source to two lanes, so all three spellings name the
  // same control and a rule matching only one of them would go quiet in the others.
  if (/^(hooks|\.claude\/hooks|\.codex\/hooks)\/(guard|sensor)-[\w.-]+\.m?js$/.test(p)) return "a gate hook";
  // THE COMMIT FLOOR. Found by the adversarial walk-through for this release: every pattern here
  // was keyed to a FILE-NAMING convention, and the kit's single most important control — the one
  // layer no harness routes around, because every writer converges at the commit — is named
  // `pre-commit` and lives in `githooks/`, matching none of them. A sensor that covers the tripwires
  // and goes silent on the floor is exactly inverted.
  if (/^(githooks|\.githooks)\/pre-commit$/.test(p)) return "the every-lane commit floor";
  // The test file for either. Named separately because a canary that guards nothing is a TEST-side
  // defect: two of the four measured instances lived in tests, not in the checker.
  if (/^tests\/.+\.test\.m?js$/.test(p) && /^(check|sensor|guard|gate|kit)/.test(base)) return "a control's test";
  return null;
}

export function emissionText(rel, kind) {
  return (
    `MUTATION RECORD OWED — ${rel} is ${kind}. Before folding, the changeset's evidence owes ` +
    `BOTH sides, each with the command and its output:\n` +
    `  (1) POSITIVE — delete the guard / plant a case AT THE CLAIM'S BOUNDARY, and name which test ` +
    `reddened. A control never observed failing is vacuous (core/INVARIANTS.md rule 1).\n` +
    `  (2) NEGATIVE — a clean, correct input that STAYS GREEN. Fixing a false CLEAR is how a false ` +
    `FAIL gets minted; that is exactly how the fourth measured defect arrived.\n` +
    `Boundary, not interior: the untracked file, the non-triggering value, the dotted name, the ` +
    `adjacent-names input were each the edge case nobody ran.\n` +
    `And prove the RUNNER is live before believing a negative: a mutation battery whose harness ` +
    `greps for the wrong failure string reports live assertions as vacuous.\n` +
    `Advisory: this sensor reports, it never blocks, and it CANNOT tell whether you ran anything.`
  );
}

// ---------------------------------------------------------------------------- entry

export function main({ stdin = process.stdin, stderr = process.stderr, cwd = process.cwd() } = {}) {
  let input = "";
  stdin.on("data", (d) => (input += d));
  stdin.on("end", () => {
    let ev;
    try { ev = JSON.parse(input); } catch { process.exit(0); }   // never break the tool on a parse failure
    if (ev !== null && typeof ev === "object" && ("agent_id" in ev || "agent_type" in ev)) process.exit(0);

    const extracted = extractTargets(ev);
    if (!extracted?.ok || !extracted.targets?.length) process.exit(0);

    // Canonicalise before matching: every pattern below names a repo-relative POSIX path, so an
    // ordinary `./githooks/pre-commit` would otherwise match nothing and the sensor would exit 0
    // having said nothing. Same defect the cross-family seat found in the sweep sensor.
    const root = resolveProjectRoot(ev) || cwd;
    const patchBase = resolvePatchBase(ev, root);
    const hits = [];
    for (const target of extracted.targets) {
      const rel = toRepoRelative(target, root, patchBase);
      if (rel === null) continue;
      const kind = owesMutationRecord(rel);
      if (kind && !hits.some((h) => h.rel === rel)) hits.push({ rel, kind });
    }
    if (!hits.length) process.exit(0);

    for (const h of hits) stderr.write(emissionText(h.rel, h.kind) + "\n");
    process.exit(0);   // NEVER denies — exit 0 on every path, including the emitting one.
  });
}

// isMain guard, realpath'd on both sides: /tmp is a symlink on macOS, and without this an importing
// TEST would RUN the sensor and consume its own stdin.
const entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })()
  : null;
if (entry && entry === fileURLToPath(import.meta.url)) main();
