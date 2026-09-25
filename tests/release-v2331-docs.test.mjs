// tests/release-v2331-docs.test.mjs — v2.33.1 B2 / B4 / P4: documentation that must stay tied to
// what the code does, or to the other surface that states the same rule.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { AGGREGATE_POLICY_VERSION } from "../hooks/repair-dispatch-state.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

test("core/WORKFLOW.md names the policy version the controller actually mints — derived from the code", () => {
  const workflow = flat(read("core/WORKFLOW.md"));
  assert.ok(workflow.includes(`v${AGGREGATE_POLICY_VERSION} mints explicitly`),
    `WORKFLOW must say v${AGGREGATE_POLICY_VERSION} mints (the controller's AGGREGATE_POLICY_VERSION)`);
  for (let v = 1; v < AGGREGATE_POLICY_VERSION; v++) {
    assert.ok(!workflow.includes(`v${v} mints explicitly`), `a superseded v${v} must not be named as minting`);
  }
});

test("the recorder documents both caller fields, and its refusal hint names them", () => {
  const recorder = read("scripts/record-repair-event.mjs");
  const header = recorder.slice(0, recorder.indexOf("import "));
  assert.match(header, /`authority_route`/, "the header names authority_route");
  assert.match(header, /`proposed_transition\.policy_version`/, "the header names the proposal's policy_version");
  assert.match(flat(header), /3 when the task's existing program .* otherwise 4/, "…and how to derive 3 vs 4");
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-recorder-hint-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const event = path.join(dir, "ev.json");
    writeFileSync(event, JSON.stringify({ type: "aggregate_v2", kind: "process_review", task_id: "t1",
      changeset_id: "c1", session_id: "s1", purpose: "child_continuation", proposed_transition: { policy_version: 3 } }));
    const r = spawnSync(process.execPath, [path.join(KIT, "scripts", "record-repair-event.mjs"), "--event", event],
      { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /aggregate-process-review-malformed/);
    assert.match(r.stderr, /proposed_transition\.policy_version must EQUAL/, "the hint names policy_version");
    assert.match(r.stderr, /authority_route/, "the hint names authority_route");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("How to start a build: README states it first, and both skills point at it", () => {
  const readme = read("README.md");
  const heading = "## How to start a build";
  const at = readme.indexOf(heading);
  assert.ok(at !== -1 && at < readme.indexOf("## What's new"), "the block sits above every release note");
  const block = flat(readme.slice(at, readme.indexOf("## What's new")));
  assert.match(block, /Run `init` in the target repository first/);
  assert.match(block, /3 or more CHIPs · more than about a week · more than one repository · a blueprint that must survive thread restarts/);
  assert.match(block, /mixed pair[\s\S]*file-only/);
  assert.match(flat(read("skills/orchestrate/SKILL.md")), /\*\*Start:\*\* run `init` in the target repo; route per workflow-kit README § How to start a build\./);
  assert.match(flat(read("skills/architect-build/SKILL.md")),
    /\*\*Start:\*\* run `init` in the target repo\. Use this skill when ANY: 3\+ CHIPs · over about a week · 2\+ repos · a blueprint that must survive restarts; otherwise `\/orchestrate` alone/);
});

test("the reviewer availability route is stated BOTH ways round on all three surfaces", () => {
  const review = flat(read("core/REVIEW.md"));
  const gates = flat(read("core/GATES.md"));
  const bindings = flat(read("templates/BINDINGS.md.tmpl"));
  // Codex-built change, Claude seat unavailable (pre-existing direction).
  assert.match(review, /Astra on a Codex build is \*\*same-family-only\*\*/);
  assert.match(gates, /The preferred Claude code seat is not an exclusive or wait condition/);
  assert.match(bindings, /For a seat concretely bound to \*\*Claude\*\*/);
  // Claude-built change, Codex seat unavailable (the v2.33.1 mirror).
  assert.match(review, /The mirror, on a Claude build:\*\* an unavailable Codex seat takes the same route/);
  assert.match(review, /fresh cold Claude frontier pass recorded \*\*same-family-only\*\*/);
  assert.match(gates, /\*\*Mirror:\*\* on a Claude build an unavailable Codex seat/);
  assert.match(gates, /spends the changeset's one discretionary frontier firing/);
  assert.match(bindings, /The mirror, for a seat concretely bound to \*\*Codex\*\* on a \*\*Claude\*\*-built change/);
  for (const [name, text] of [["REVIEW", review], ["GATES", gates], ["BINDINGS", bindings]]) {
    assert.match(text, /scripts\/codex-gate\.sh/, `${name} says how a Claude lane reaches the Codex seat`);
    assert.match(text, /--with-gate-runners/, `${name} names the install flag`);
  }
});

// ---- R2 root exits: each corrected instruction is pinned on the sentence that carries it.

test("R2-1: the existing-config instruction names BOTH lanes' pair keys, never Codex alone", () => {
  const routing = flat(read("skills/architect-build/ROUTING.md"));
  assert.match(routing, /Pair keys: Codex `pairedPmThreadId`; Claude `pairedPmClaudeTarget` \(ref\/id\) plus `pairedPmClaudeName`\./);
  assert.match(routing, /existing pair: edit only that lane's keys there in place/);
  for (const rel of ["skills/architect-build/ROUTING.md", "skills/architect-build/SKILL.md", "README.md", "PORTABILITY.md",
    "templates/BINDINGS.md.tmpl", "templates/CLAUDE.md.tmpl", "templates/AGENTS.md.tmpl"]) {
    assert.doesNotMatch(flat(read(rel)), /set only `pairedPmThreadId`/, `${rel} must not tell a Claude Architect to set only the Codex key`);
  }
  assert.match(flat(read("templates/BINDINGS.md.tmpl")), /optional `pairedPmThreadId`, `pairedPmClaudeTarget`, `pairedPmClaudeName`\)/,
    "the generated family list names the Claude keys");
});

test("R2-3: an upgrade from v2.32.x is told to re-trust the send entry the armed check cannot probe", () => {
  const readme = flat(read("README.md"));
  assert.match(readme, /No Codex `\.codex\/hooks\.json` entry changed since v2\.33\.0/);
  assert.match(readme, /Upgrading from v2\.32\.x: re-grant Codex hook trust interactively for the `mcp__codex_app__send_message_to_thread` entry v2\.33\.0 added — the armed check probes only `apply_patch`/);
  assert.match(flat(read("PORTABILITY.md")),
    /The probe covers `apply_patch` only\.\*\* An upgrade that ADDS an entry on another matcher — v2\.33\.0 added `mcp__codex_app__send_message_to_thread`, so every upgrade from v2\.32\.x — needs that entry re-trusted interactively/);
});

test("R2-2 (D-15): a spent frontier firing turns the mirror fallback into an Owner-routed second firing", () => {
  assert.match(flat(read("core/REVIEW.md")),
    /if that firing is already spent, the fallback is a second firing and routes to the Owner \(through the Architect\/PM, rule-8 form\) — the existing Owner reservation, not a new rule\./);
  assert.match(flat(read("templates/BINDINGS.md.tmpl")),
    /if it is already spent, the fallback is a second firing and goes to the Owner through the Architect\/PM \(rule-8 form\) — the existing reservation, not a new rule\./);
  assert.match(flat(read("core/GATES.md")), /frontier firing \(§ Model · effort matrix\); spent ⇒ an Owner-routed second firing\./);
});
