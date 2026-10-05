// v2.44.0: findings-only seats (HARM vs NOTE, a derived verdict), a lighter standard T2 (two cold seats, two
// families; flagged or high-stakes work keeps the full depth) and no seat for a byte-copy port. Prose, one printed
// string and tests: this file pins the new anchors, the ABSENCE of the removed sentence, the budgets, the version,
// and that no controller or runner code changed.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");
const words = (rel) => read(rel).split(/\s+/).filter(Boolean).length;
const blob = (rel) => { const b = readFileSync(path.join(KIT, rel)); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };

test("findings-only seats: HARM is a reachable failure, the verdict is derived, only a CONFIRMED HARM stops work", () => {
  const r = flat("core/REVIEW.md");
  assert.match(r, /\*\*A seat returns findings or `NO FINDINGS`, each HARM or a NOTE\.\*\* \*\*HARM\*\* is a concrete reachable failure: the inputs and state the system actually produces → what breaks, with file:line\./);
  assert.match(r, /a harm claim with no reachable failure is a NOTE/);
  assert.match(r, /a harm claim with no reachable failure is a NOTE\. An unproven mitigation or backstop claim is a HARM \(name the check that would prove it\)\./);
  assert.match(r, /a finding that needs an input the system cannot produce is a NOTE/);
  assert.match(r, /The verdict line stays \(the runners read it as proof the seat judged\) but is mechanical: \*\*`NO-GO` iff ≥1 HARM finding\*\*/);
  assert.match(r, /a NO-GO naming no HARM reads as GO plus notes/);
  assert.match(r, /Only a \*\*CONFIRMED\*\* \(PM-accepted\) HARM stops work or opens a round\./);
  assert.doesNotMatch(r, /any FAIL ⇒ overall NO-GO/);
  assert.match(flat("agents/cold-reviewer.md"), /each is HARM \(a reachable failure\) or a NOTE; `NO-GO` iff ≥1 HARM/);
  assert.match(flat("templates/codex-cold-reviewer.toml.tmpl"), /The verdict line is mechanical: NO-GO iff ≥1 HARM\./);
});

test("the lighter T2: two cold seats from different families; a flag or declared stakes add the full depth; the controller floor stays", () => {
  const w = flat("core/WORKFLOW.md");
  assert.match(w, /\| \*\*T2\*\* \| pre-flight → contract lens, PRE-CODE \*\(new design only; not fixes or ports\)\* → \*\*2 cold seats, different families, one the free adversary\*\* → Owner push-GO; a flag or declared stakes ADD the depth above \|/);
  assert.match(w, /\*\*Each flag, or Principal-declared stakes, ADDS the full depth: ≥2 angles \+ free, a REQUIRED cross-family lens\*\* \(same-family-only never discharges it\), \*\*the external gate\*\* and the \*\*frontier · xhigh\*\* gate/);
  assert.match(w, /Review weight follows stakes: a standard T2 is two cold seats; a flag or declared stakes keeps the full depth\./);
  assert.match(w, /Historical T3 retains its original depth\./);
  const r = flat("core/REVIEW.md");
  assert.match(r, /\*\*Panel WEIGHT scales to residual risk — UP with stakes and action flags — and a tier's FLOOR never drops\.\*\* The T2 floor is two cold seats from different families, one the free adversary; a flag or declared stakes ADD the depth in `core\/WORKFLOW\.md` § Steer, and an ON repair controller keeps its 4–12 seat roster floor\./);
  assert.match(r, /\(\*\*1 at a standard T2\*\*, ≥2 at a flagged or high-stakes T2, ≥3 at historical T3\)/);
  assert.match(r, /\*\*External gate \(flagged or high-stakes T2 \/ historical T3, \*after\* cold passes\)\.\*\*/);
  assert.match(r, /At unflagged T2 it is the second seat \(no other family available ⇒ the availability route records same-family-only\)/);
  assert.match(r, /A new controlling-document restructure receives the normal T2 review\./);
  assert.match(flat("core/README.md"), /T2 two cold seats from different families, a flag or declared stakes adding the full depth;/);
});

test("the removed sentence is absent from every governed doc, seat file, template, skill and hook", () => {
  const files = [];
  const walk = (dir) => { for (const e of readdirSync(path.join(KIT, dir))) {
    const rel = path.join(dir, e), st = statSync(path.join(KIT, rel));
    if (st.isDirectory()) walk(rel); else files.push(rel);
  } };
  for (const d of ["core", "agents", "templates", "skills", "hooks", "commands", "skill-shims", "codex"]) walk(d);
  files.push("README.md", "PORTABILITY.md");
  for (const rel of files) {
    const t = read(rel).replace(/\s+/g, " ");
    assert.doesNotMatch(t, /cutting seats is the misreading/, `${rel} must not carry the superseded sentence`);
    assert.doesNotMatch(t, /RULE #1 cuts REPAIRS, never review DEPTH/, `${rel} must not carry the superseded WORKFLOW clause`);
  }
});

test("the gate-ladder sensor prints the lighter T2 and keeps the tier enum", () => {
  const h = read("hooks/guard-gate-ladder.mjs");
  assert.match(h, /T2: "2 cold seats, different families, one the free adversary → fresh Owner remote GO \(exact head \+ target\); an action flag or declared stakes ADD ≥2 angles \+ free, a REQUIRED cross-family lens, the external gate and frontier · xhigh",/);
  assert.doesNotMatch(h, /cold panel \(≥2 angle seats \+ 1 free adversary\)/);
  assert.match(h, /const TIERS = \["T0", "T1", "T2", "T3"\];/, "no new tier label");
});

test("ports need no seat: the clause is in REVIEW, with the gate-machinery exception and without the old half-list", () => {
  assert.doesNotMatch(flat("core/REVIEW.md"), /unless it sets a tier, trigger or NO-GO condition/);
  assert.match(flat("core/ARTIFACT_CLASS.md"), /\*\*T2\*\* \(its T2 seats, wording approval/);
  assert.doesNotMatch(flat("core/ARTIFACT_CLASS.md"), /full normal panel/);
  assert.match(flat("core/REVIEW.md"), /\*\*Ports need no seat\.\*\* Byte-copying kit text or hook blobs already gated at the kit owes no seat: the proof is blob identity, the target's free rungs and the Principal's read of the diff\. A hand-adapted sentence in a target gets one cold seat \(T1\), unless it is gate machinery \(`core\/WORKFLOW\.md` core-document rule\)\./);
});

test("no controller or runner code changed: the blobs are the v2.43.0 blobs", () => {
  assert.equal(blob("hooks/repair-dispatch-state.mjs"), "2d16801483a2bf4b2a7cc4713d905dae89617c83");
  assert.equal(blob("scripts/record-repair-event.mjs"), "843086041d0a9e917413e32521545b3c337c8c2e");
  assert.equal(blob("scripts/confirm-repair-brief.mjs"), "279dd2d2fe969131fd9c9f0dbe110c98442f556f");
  assert.equal(blob("bin/init.mjs"), "38d4af1c61077eaff24d4daeb72cd3215e5f97ce");
  assert.equal(blob("scripts/codex-gate.sh"), "10b843e0a691577b25dfbde539fd52762a767e50");
});

test("budgets were trimmed to fit, never raised", () => {
  assert.ok(Buffer.byteLength(read("core/WORKFLOW.md")) <= 25600, "core/WORKFLOW.md stays within the 25600 B method cap");
  assert.ok(Buffer.byteLength(read("core/REVIEW.md")) <= 25600, "core/REVIEW.md stays within the 25600 B method cap");
  assert.match(read("skills/orchestrate/SKILL.md"), /Word budget: 1400/);
  assert.ok(words("skills/orchestrate/SKILL.md") <= 1400, `SKILL is ${words("skills/orchestrate/SKILL.md")} words`);
  assert.match(read("skills/orchestrate/CHIP_BRIEF.md"), /Word budget: 1000 /);
  assert.ok(words("skills/orchestrate/CHIP_BRIEF.md") <= 1000, `CHIP_BRIEF is ${words("skills/orchestrate/CHIP_BRIEF.md")} words`);
  assert.ok(words("agents/cold-reviewer.md") <= 500, `cold-reviewer is ${words("agents/cold-reviewer.md")} words`);
  assert.doesNotMatch(read("scripts/check-doc-size.mjs"), /2560[1-9]|256[1-9]\d\d|25[7-9]\d\d\d/, "the doc-size caps were not raised");
});

test("the README note says what changed and what did NOT", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.44.0"), r.indexOf("## What's new in v2.43.0"));
  assert.ok(n.length > 500, "the v2.44.0 note sits above v2.43.0's");
  assert.match(n, /No controller code, no runner and no verdict schema changed, and there is no new tier label/);
  assert.match(n, /`NO-GO` iff at least one HARM finding/);
  assert.match(n, /two cold seats from different families \(one the free adversary\)/);
  assert.match(n, /ADDS the old depth: at least two angles plus the free adversary, a REQUIRED cross-family lens, the external gate and frontier · xhigh/);
  assert.match(n, /Where the repair controller is on, its 4-12 seat roster floor still applies/);
  assert.match(n, /\*\*Ports need no seat\.\*\*/);
  assert.match(n, /`scripts\/codex-gate\.sh` keep their v2\.43\.0 blobs/);
  assert.match(n, /tests\/release-v2440-docs\.test\.mjs/);
  assert.match(n, /- \*\*Upgrading\.\*\* Re-run `init --force`\./);
});

test("version is 2.44.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.44.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.44.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.44\.0$/m);
});
