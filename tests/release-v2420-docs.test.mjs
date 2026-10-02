// v2.42.0: the gating budget (CHIP_BRIEF § 5 + the AGENTS/CLAUDE twins), no scheduled check-ins, NB-K2 (Stop sensor), NB-K5 (templates),
// NB-K6 + NB-K8 (core/README STATE wording and fallback). The sensor's behaviour is pinned in tests/stop-notice.test.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");
const words = (rel) => read(rel).split(/\s+/).filter(Boolean).length;

test("CHIP_BRIEF § 5 carries the gating budget: precommit, stakes, 2x trip wire, the Quad Mandate in order, and no scheduled check-ins", () => {
  const b = flat("skills/orchestrate/CHIP_BRIEF.md");
  const i = b.indexOf("**Gating budget:**");
  assert.ok(i > b.indexOf("5. **Process**") && i < b.indexOf("6. **Standing rules**"), "the clause sits in § 5");
  const g = b.slice(i, b.indexOf("Aggregate repair briefs"));
  assert.match(g, /precommits seats, maximum rounds and the STAKES \(what a wrong ship costs; live or irreversible state touched\); stakes size the budget above the tier floor, never below\./);
  assert.match(g, /Past 2× the plan the PM stops and the Principal decides, never another repair round, answering in order and recording each:/);
  const order = ["(1) RULE #1", "(2) Root cause", "(3) KISS", "(4) Zoom Out"].map((t) => g.indexOf(t));
  assert.ok(order.every((n) => n >= 0) && order.every((n, k) => k === 0 || n > order[k - 1]), "the four questions appear in the fixed order");
  assert.match(g, /whole not worth its cost ⇒ Owner DECISION NEEDED\./);
  assert.match(g, /\*\*No scheduled check-ins;\*\* speak when something changes\./);
});

test("the budgets held: CHIP_BRIEF within 1000 words, the SKILL gained nothing", () => {
  assert.ok(words("skills/orchestrate/CHIP_BRIEF.md") <= 1000, `CHIP_BRIEF is ${words("skills/orchestrate/CHIP_BRIEF.md")} words`);
  assert.match(read("skills/orchestrate/CHIP_BRIEF.md"), /Word budget: 1000 /, "the declared number was not raised");
  assert.match(read("skills/orchestrate/SKILL.md"), /Word budget: 1400/, "the SKILL's declared number was not raised");
  assert.ok(words("skills/orchestrate/SKILL.md") <= 1400);
  assert.ok(!/STAKES|scheduled check-ins|Gating budget/.test(read("skills/orchestrate/SKILL.md")), "no gating-budget text was added to the SKILL");
  // The trimmed ideas that stay: the three failures remain designed against.
  const b = flat("skills/orchestrate/CHIP_BRIEF.md");
  for (const t of ["A re-presented brief carries stale facts", "Verbatim is not safe", "Adapt the remedy to the target's defect surface"]) assert.ok(b.includes(t), t);
});

test("the Codex and Claude entry templates carry the twin, and no longer call every Stop sensor Claude-only", () => {
  for (const rel of ["templates/AGENTS.md.tmpl", "templates/CLAUDE.md.tmpl"]) {
    const t = flat(rel);
    assert.match(t, /## Gating budget and check-ins/, rel);
    assert.match(t, /the brief precommits seats, rounds and the STAKES; past 2× that plan the PM stops and the Principal runs RULE #1 → root cause → KISS → Zoom Out, recording each answer, never another repair round\./, rel);
    assert.match(t, /No scheduled check-ins; a heartbeat that arrives anyway follows `core\/OWNER_COMMS\.md` rule 8\./, rel);
    assert.match(t, /`\.agents\/skills\/orchestrate\/CHIP_BRIEF\.md` § 5/, rel);
    assert.ok(!/both Stop sensors remain Claude-only|the two Stop sensors \(Owner-comms, token ledger\) are Claude-lane only/.test(t), `${rel} lost the stale all-Stop-sensors-are-Claude-only claim`);
  }
  assert.match(flat("templates/AGENTS.md.tmpl"), /On Stop it registers one more SENSOR, `sensor-stop-notice` \(blocks once, fails open\)\./);
  assert.match(flat("templates/CLAUDE.md.tmpl"), /`sensor-stop-notice` is registered on Codex `Stop` only\./);
});

test("core/README names no adopter's files, gives the STATE fallback, and keeps git and the PR as the source for gate status", () => {
  const r = flat("core/README.md");
  assert.ok(!/PIL_ARCHITECTURE|open_work_current_state/.test(r), "no origin-repo file names remain in core/README.md");
  assert.match(r, /the repo's deep architecture REFERENCE and its CLASS: STATE head, as `BINDINGS\.md` names them/);
  assert.match(r, /A repo with no snapshot block records it in its STATE head per `BINDINGS\.md`; with no idle backstop, the `STOP:` notice is the only signal that a PM stopped\./);
  assert.match(r, /The snapshot never records gate, GO or merge status as current fact: git and the PR are the source, and a snapshot written before a merge says "pending merge, check git"\./);
  assert.ok(!/`core\/README\.md` names `docs\/PIL_ARCHITECTURE/.test(flat("PORTABILITY.md")), "PORTABILITY no longer lists core/README.md as carrying origin names");
});

test("the sensor header states the closing-label and relayed-answer rules, and its installed copies stay identical", () => {
  const h = read("hooks/sensor-stop-notice.mjs");
  assert.match(h, /a relayed answer, i\.e\. a non-notice\s*\/\/\s*delegation after the ask, counts as one/);
  assert.match(h, /label that carries text/);
});

test("the README note names what ships and not what was dropped, and the older Upgrading bullets are unchanged", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.42.0"), r.indexOf("## What's new in v2.41.0"));
  assert.match(n, /Gating budget\.\*\* `skills\/orchestrate\/CHIP_BRIEF\.md` § 5/);
  assert.match(n, /No scheduled check-ins\./);
  assert.match(n, /The `\/orchestrate` SKILL is unchanged \(0 words added\)/);
  assert.match(n, /trigger \(c\): the final must END with a rule-8 label that carries text/);
  assert.match(n, /RELAYED by the delegating thread/);
  assert.match(n, /Trigger \(b\) is unchanged\./);
  assert.match(n, /\(NB-K5\)/);
  assert.match(n, /\(NB-K6, NB-K8\)/);
  assert.match(n, /tests\/release-v2420-docs\.test\.mjs/);
  assert.match(n, /re-approve hooks if Codex prompts/);
  assert.ok(!/relayed push GO|typed records|progress = code/i.test(n), "the note claims nothing that did not ship");
  for (const [from, to, first] of [
    ["v2.41.0", "v2.40.0", "Re-run `init --force` (add `--with-gate-runners` if you use the runners). An adopter hand-edits rule 8 of their existing `core/OWNER_COMMS.md` (a per-repo file) and ROUTING's Authority section"],
    ["v2.40.0", "v2.39.2", "Re-run `init --force` and re-trust the hooks as above; an adopter hand-edits rule 8 of their existing `core/OWNER_COMMS.md` (a per-repo file; D-106)."],
    ["v2.39.2", "v2.39.1", "Re-run `init --force`; `OWNER_COMMS` is a per-repo file, so an adopter hand-edits rule 8."],
    ["v2.39.1", "v2.39.0", "Re-run `init --force`."],
  ]) {
    const sec = r.slice(r.indexOf(`## What's new in ${from}`), r.indexOf(`## What's new in ${to}`));
    assert.ok(sec.includes(`- **Upgrading.** ${first}`), `${from}'s Upgrading bullet is intact`);
    assert.ok(!sec.includes("Gating budget and check-ins"), `${from} carries no v2.42.0 text`);
  }
});

test("version is 2.42.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.42.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.42.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.42\.0$/m);
});
