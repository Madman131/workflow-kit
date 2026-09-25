// tests/release-v2340-docs.test.mjs — v2.34.0 (C-DOC): action flags replace new-work T3, the v3-lineage
// clause, the brief-template rules and the restored PROTOCOLS pointer. Every pattern reaches the
// OPERATIVE word (REQUIRED, never, at least, above …) so flipping that word turns the pin RED — the
// v2.33.1 lesson: a pin that stops before the operative word survives the mutation that matters.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { AGGREGATE_POLICY_VERSION } from "../hooks/repair-dispatch-state.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

test("K1/K2: WORKFLOW § Steer defines the three action flags and what each ADDS", () => {
  const w = flat(read("core/WORKFLOW.md"));
  const steer = w.slice(w.indexOf("## Steer"), w.indexOf("## Gate"));
  assert.match(steer, /\*\*Action flags\*\*, from concrete effects, never labels: \*\*irreversible\*\* · \*\*money\/ledger\*\* · \*\*auth\/credential\*\*\./);
  assert.match(steer, /A flagged change is at least T2;/);
  assert.match(steer, /each flag ADDS a \*\*REQUIRED cross-family lens\*\*/);
  assert.match(steer, /\(same-family-only never discharges it\)/);
  assert.match(steer, /the \*\*frontier · xhigh\*\* gate \(`core\/GATES\.md` matrix\) and a \*\*named Owner GO per write\*\*/);
  assert.match(steer, /New work is never T3: it is T2 plus its action flags\./);
});

test("K3/K4: the T2 row and the prose-cap clause keep the lens REQUIRED under a flag", () => {
  const w = flat(read("core/WORKFLOW.md"));
  assert.match(w, /\| \*\*T2\*\* \|[^|]*cross-family lens \[if avail; REQUIRED if flagged\] → external/);
  assert.match(w, /the \*\*cross-family lens stays REQUIRED under an action flag or at historical T3\*\*/);
});

test("K5/K6: REVIEW makes the flagged lens REQUIRED, with no same-family discharge and no route discharge", () => {
  const r = flat(read("core/REVIEW.md"));
  assert.match(r, /an \*\*action flag\*\* \(`core\/WORKFLOW\.md` § Steer\) makes the cross-family lens below required/);
  assert.match(r, /\*\*At unflagged T2 it is skipped cleanly when unavailable; under an action flag or at historical T3 it is REQUIRED\*\*/);
  assert.match(r, /\*\*A flagged change has no same-family discharge:\*\* with no different family seated it is \*\*not gradable\*\* → Owner/);
  assert.match(r, /critical boundaries, T3 honesty and a flagged change's cross-family lens remain\./);
});

test("K7: the GATES matrix row is the action-flag row, frontier · xhigh in BOTH columns", () => {
  const g = read("core/GATES.md");
  assert.match(g, /\| \*\*Action flag: irreversible · money\/ledger · auth\/credential\*\* \([^)]*\) \| \*\*frontier · xhigh\*\* \| \*\*frontier · xhigh\*\* \|/);
  assert.match(flat(g), /The flag is set from concrete effects under `core\/WORKFLOW\.md` § Steer; re-labelling at the gate cannot dodge it\./);
});

test("K8: RUNG_ZERO names what a flag IS, never below T2, and points to WORKFLOW for what it adds", () => {
  const z = read("skills/orchestrate/RUNG_ZERO.md");
  assert.match(z, /^\| \*\*Action flag\*\* \*\(not a tier\)\* \| [^|]*irreversible[^|]*money\/ledger[^|]*auth\/credential[^|]*never below T2[^|]*`core\/WORKFLOW\.md` § Steer says \|$/m);
});

test("K9: the core README pipeline map carries the flag", () => {
  assert.match(flat(read("core/README.md")), /cross-family capstone\[if avail; REQUIRED if flagged\] → external/);
});

test("K10: WORKFLOW states the v3 lineage clause, derived from the controller's constants", () => {
  const src = read("hooks/repair-dispatch-state.mjs");
  const v3 = Number(/const PRINCIPAL_AGGREGATE_POLICY_VERSION = (\d+);/.exec(src)?.[1]);
  assert.equal(v3, AGGREGATE_POLICY_VERSION - 1, "the lineage version is the one below the current mint");
  const w = flat(read("core/WORKFLOW.md"));
  assert.ok(w.includes(`a v${v3} or T3 program (or, with none, pending lineage) keeps minting v${v3}; ` +
    `otherwise v${AGGREGATE_POLICY_VERSION} mints explicitly`), "WORKFLOW must state the lineage exception exactly");
});

test("K11: the brief template names the Builder's model, seats at or ABOVE it, logs out, and GO routing", () => {
  const b = flat(read("skills/orchestrate/CHIP_BRIEF.md"));
  const five = b.slice(b.indexOf("5. **Process**"), b.indexOf("6. **Standing rules**"));
  // R2-1: a STANDALONE sentence binding every brief, BEFORE the aggregate-repair list — inside that
  // list it binds only repair briefs, and a first-build brief escapes it (CHIP B's sub-peer incident).
  const rule = /(?:^|[.:—] )\*\*Every brief names the Builder's model and effort; every same-family seat runs at or above that model\*\* \(`core\/REVIEW\.md` peer tier\)\./;
  assert.match(five, rule);
  assert.ok(five.search(rule) < five.indexOf("Aggregate repair briefs declare"), "the rule precedes the aggregate-repair list");
  const aggregate = five.slice(five.indexOf("Aggregate repair briefs declare"), five.indexOf("Stored standard programs"));
  assert.doesNotMatch(aggregate, /Builder's model/, "the aggregate-repair sentence must not carry the Builder-model rule");
  assert.match(five, /\*\*Review logs never ride in the changeset under review\.\*\*/);
  assert.match(five, /\*\*A Builder the Owner cannot address \(a subagent\) never holds a GO:\*\* the PM pushes on the Owner's relayed GO and SHA/);
});

test("K12: the stale-worktrees duty points at PROTOCOLS for the merge-type proof and occupancy refusal", () => {
  const s = flat(read("skills/orchestrate/SKILL.md"));
  assert.match(s, /Surface stale worktrees \(merge-type proof, occupancy refusal: `\.agents\/skills\/orchestrate\/PROTOCOLS\.md`\)/);
  const p = flat(read("skills/orchestrate/PROTOCOLS.md"));
  assert.match(p, /Proving a change landed has TWO forms/, "the pointer's target still carries the merge-type proof");
  assert.match(p, /OCCUPANCY CHECK/, "…and the occupancy refusal");
});

test("K13: no shipped surface still grants new work an optional lens under the retired T3 wording", () => {
  const RETIRED = [
    /not the former third angle or required extra lens/,
    /\*\*At T2 it is skipped cleanly when unavailable; at T3 it is REQUIRED\*\*/,
    /the T3 row bundles both seats in one cell/,
  ];
  for (const sample of ["New T3-class work gets the full normal T2 panel, not the former third angle or required extra lens;",
    "**At T2 it is skipped cleanly when unavailable; at T3 it is REQUIRED** (x)",
    "REQUIRED at T3** — the T3 row bundles both seats in one cell, so"]) {
    assert.ok(RETIRED.some((re) => re.test(sample)), `canary: the retired-wording regex must fire on: ${sample}`);
  }
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(KIT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(md|tmpl)$/.test(e.name)) {
        const t = flat(read(rel));
        for (const re of RETIRED) if (re.test(t)) offenders.push(`${rel}: ${re}`);
      }
    }
  };
  for (const root of ["core", "skills", "templates"]) walk(root);
  assert.deepEqual(offenders, []);
});

test("R2-2: the v2.34.0 upgrade note tells adopters to wait for v2.35.0 and run init --force once, there", () => {
  const readme = read("README.md");
  const note = flat(readme.slice(readme.indexOf("## What's new in v2.34.0"), readme.indexOf("## What's new in v2.33.1")));
  assert.match(note, /\*\*Adopters: do not upgrade to v2\.34\.0 on its own\.\*\* Wait for v2\.35\.0 and run `init --force` once, on v2\.35\.0/);
  assert.match(note, /because the gate-ladder hook's printed T2 ladder changes in v2\.35\.0/);
  assert.doesNotMatch(note, /Re-run `init --force`/, "no instruction to upgrade to v2.34.0 alone");
});
