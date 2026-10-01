// v2.41.0: the KIT GAP-ACTION NEEDED label, "a kit gap is never a project dependency", the Owner replacement-design route, the sensor label, SEAT-COVERAGE.
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

test("GATES and REVIEW carry SEAT-COVERAGE, its measured reason and its limits", () => {
  const g = flat("core/GATES.md");
  assert.match(g, /SEAT-COVERAGE, v2\.41\.0/);
  assert.match(g, /`scripts\/codex-gate\.sh --expect-files FILE`/);
  assert.match(g, /exit 3, `UNDER-READ: no verdict`/);
  assert.match(g, /An under-read seat is \*\*UNAVAILABLE, not a GO\*\*/);
  assert.match(g, /sent three of them to `\/dev\/null` and then reported all four as read/);
  assert.match(g, /a `--expect-files` list that omits a file is a seat that was never required to open it/);
  const r = flat("core/REVIEW.md");
  assert.match(r, /pass it `--expect-files` with the changed files, and a seat whose event stream shows a listed file unopened exits 3 `UNDER-READ: no verdict` and is unavailable, not a GO/);
});

test("codex-gate.sh documents --expect-files and is installed with its selftest", () => {
  const sh = read("scripts/codex-gate.sh");
  assert.match(sh, /\[--expect-files FILE\]/);
  assert.match(sh, /UNDER-READ: no verdict/);
  assert.ok(read("bin/init.mjs").includes('"codex-gate-selftest.sh"'), "init --with-gate-runners installs the selftest the wrapper execs");
});

test("PORTABILITY states the SEAT-COVERAGE limits", () => {
  const p = flat("PORTABILITY.md");
  assert.match(p, /\*\*SEAT-COVERAGE \(`codex-gate\.sh --expect-files`, v2\.41\.0\) measures that a file's text reached the seat's tool output, nothing more\.\*\*/);
  assert.match(p, /an event shape the check does not know earns no credit, so a changed Codex client fails CLOSED/);
  assert.match(p, /Cold passes only/);
  assert.match(p, /`cold-review-gemini\.sh` has no such stream and is not mirrored/);
});

test("the events receipt is kept in the journal", () => {
  const j = flat("docs/journal/2026-10-01-codex-exec-events-receipt.md");
  assert.match(j, /codex-cli` 0\.159\.2/);
  assert.match(j, /\*\*Run 1 — the trap this chip is built around|Run 1 — the trap this chip is built around/);
  assert.match(j, /`aggregated_output`/);
});

test("the README note names the changes, the new tests and the upgrade steps", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.41.0"), r.indexOf("## What's new in v2.40.0"));
  assert.match(n, /`\*\*KIT GAP-ACTION NEEDED:\*\*` label/);
  assert.match(n, /A kit gap is never a project dependency/);
  assert.match(n, /Owner replacement-design route/);
  assert.match(n, /no controller or guard code changed/);
  assert.match(n, /\*\*SEAT-COVERAGE\.\*\* `scripts\/codex-gate\.sh --expect-files FILE`/);
  assert.match(n, /tests\/codex-gate-seat-coverage\.test\.mjs/);
  assert.match(n, /tests\/release-v2410-docs\.test\.mjs/);
  assert.match(n, /hand-edits rule 8 of their existing `core\/OWNER_COMMS\.md`/);
  assert.match(n, /pass `--expect-files` with the changed files/);
  assert.match(n, /existing `scripts\/codex-gate\.sh` copies have the same dead `--selftest`/);
  assert.match(n, /never shipped before v2\.41\.0/);
});

test("version is 2.41.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.41.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.41.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.41\.0$/m);
});
