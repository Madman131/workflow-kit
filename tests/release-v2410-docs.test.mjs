// v2.41.0: the KIT GAP-ACTION NEEDED label, "a kit gap is never a project dependency", the Owner replacement-design route, the sensor label.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");

test("OWNER_COMMS rule 8 names KIT GAP-ACTION NEEDED, its content, and counts it as an outstanding Owner action", () => {
  const t = flat("templates/OWNER_COMMS.md.tmpl");
  assert.match(t, /A defect or missing route in the installed workflow kit goes under `\*\*KIT GAP-ACTION NEEDED:\*\*`: name the gap, its evidence path and the project action it holds, if any\. The Owner forwards it to the Workflow-Kit Architect for remediation\./);
  assert.match(t, /\(a `\*\*KIT GAP-ACTION NEEDED:\*\*` line is one until the Owner has forwarded it\)/);
  assert.match(t, /`\*\*ACTION NEEDED:\*\*` \(a step only the Owner can perform, such as running a handed-over command\)/, "the v2.39.2 label text is unchanged");
});

test("ROUTING § Authority carries the kit-gap rule, and the orchestrate SKILL gained no words", () => {
  const r = flat("skills/architect-build/ROUTING.md");
  assert.match(r, /A kit gap is never a project dependency\. Report it once under `KIT GAP-ACTION NEEDED`; never design, build or co-design the kit fix inside a project chip or with a kit thread\. The project continues covered work, holds only the blocked action, or proceeds under an Owner-owned recorded exception\./);
  assert.ok(r.indexOf("A kit gap is never a project dependency") > r.indexOf("## Authority"), "the rule sits under § Authority");
  assert.ok(!/KIT GAP/.test(read("skills/orchestrate/SKILL.md")), "no kit-gap text was added to the SKILL (its word budget is spent)");
});

test("WORKFLOW carries the Owner replacement-design route at the reserved-paths sentence, as doctrine only", () => {
  const w = flat("core/WORKFLOW.md");
  assert.match(w, /STOP or a collected-panel close reserves reviewed paths; only an Owner child or T2 Principal-evidenced split\/new child confined to opened paths can rework them\. Without typed parent records, only an Owner-recorded replacement reworks them: a FRESH program disclosing the parent in the current-state snapshot, brief and every commit body, fabricating, reconstructing or backfilling no record; a typed parent keeps the Owner-child route\./);
  // The push-GO rule the trimmed restatements duplicated is still stated where it governs.
  assert.match(w, /\*\*every remote push or publication needs a fresh Owner GO for the exact head and target, regardless of tier or file type\*\*/);
  assert.match(w, /needs the applicable code gate plus a \*\*fresh named Owner GO\*\* for the exact head and target\./);
  assert.match(w, /That approval closes the core-document gate only; it is never a review or remote-publication GO\./);
});

test("the stop sensor recognises the label and its forced reply names it", () => {
  const h = read("hooks/sensor-stop-notice.mjs");
  assert.match(h, /AUTHORIZATION NEEDED\|DECISION NEEDED\|KIT GAP-ACTION NEEDED\|ACTION NEEDED\|QUESTION/);
  assert.match(h, /\*\*QUESTION:\*\*, \*\*KIT GAP-ACTION NEEDED:\*\* or \*\*AUTHORIZATION NEEDED\*\*/);
});

test("the README note names the changes, the new tests and the upgrade steps", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.41.0"), r.indexOf("## What's new in v2.40.0"));
  assert.match(n, /`\*\*KIT GAP-ACTION NEEDED:\*\*` label/);
  assert.match(n, /A kit gap is never a project dependency/);
  assert.match(n, /Owner replacement-design route/);
  assert.match(n, /no controller or guard code changed/);
  assert.match(n, /tests\/release-v2410-docs\.test\.mjs/);
  assert.match(n, /hand-edits rule 8 of their existing `core\/OWNER_COMMS\.md`/);
  assert.match(n, /existing `scripts\/codex-gate\.sh` copies have the same dead `--selftest`/);
  assert.match(n, /never shipped before v2\.41\.0/);
});

test("the older releases' Upgrading bullets are unchanged (a replace-all must not recur) and the WORKFLOW-trim sentence is exact", () => {
  const r = flat("README.md");
  for (const [from, to, first] of [
    ["v2.40.0", "v2.39.2", "Re-run `init --force` and re-trust the hooks as above; an adopter hand-edits rule 8 of their existing `core/OWNER_COMMS.md` (a per-repo file; D-106)."],
    ["v2.39.2", "v2.39.1", "Re-run `init --force`; `OWNER_COMMS` is a per-repo file, so an adopter hand-edits rule 8."],
    ["v2.39.1", "v2.39.0", "Re-run `init --force`."],
    ["v2.39.0", "v2.38.0", "Re-run `init --force` (or copy the `## Thread restart` section into `AGENTS.md`)."],
    ["v2.38.0", "v2.37.1", "Re-run `init --force` to refresh the template, or copy the three sections by hand."],
    ["v2.37.1", "v2.37.0", "`init --force` adds the `UserPromptSubmit` group and the Stop registration exactly once and never duplicates them or the existing `PreToolUse` group. Without `init`, copy"],
  ]) {
    const sec = r.slice(r.indexOf(`## What's new in ${from}`), r.indexOf(`## What's new in ${to}`));
    assert.ok(sec.includes(`- **Upgrading.** ${first}`), `${from}'s Upgrading bullet is intact`);
    assert.ok(!sec.includes("ROUTING's Authority section"), `${from} carries no v2.41.0 text`);
  }
  assert.match(r, /three restatements of the push-GO rule .* and the clause "; the parent stays terminal" \(L97; L101 still says it\) were removed to make room: each idea survives elsewhere in the file and no rule changed/);
});

test("version is 2.41.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.41.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.41.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.41\.0$/m);
});

test("the wrapper's --selftest target ships and init installs it", () => {
  assert.ok(read("bin/init.mjs").includes('"codex-gate-selftest.sh"'), "init --with-gate-runners installs the selftest the wrapper execs");
  assert.match(read("scripts/codex-gate-selftest.sh"), /VERDICT: NO-GO/);
});

test("REVIEW's Standing review authorization yields to BINDINGS reservations", () => {
  assert.match(flat("core/REVIEW.md"), /through push-ready, subject to the adopter's BINDINGS substitution reservations; the push GO stays the Owner's\./);
});
