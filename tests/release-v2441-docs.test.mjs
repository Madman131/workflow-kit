// v2.44.1: the two cold-reviewer seat definitions POINT at core/REVIEW.md § Cold review for HARM and NOTE
// instead of copying part of the definition (the copy dropped "an unproven mitigation is a HARM"). This file
// pins the pointer in both files, the ABSENCE of the old partial phrase, the release note and the version.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");

test("both seat definitions defer to REVIEW for HARM and NOTE and carry no partial copy of the definition", () => {
  const claude = flat("agents/cold-reviewer.md");
  const codex = flat("templates/codex-cold-reviewer.toml.tmpl");
  assert.match(claude, /each is HARM or a NOTE exactly as `core\/REVIEW\.md` § Cold review defines them; `NO-GO` iff ≥1 HARM/);
  assert.match(codex, /A finding is HARM or a NOTE exactly as core\/REVIEW\.md § Cold review defines them; read that section before judging\. None ⇒ NO FINDINGS\. The verdict line is mechanical: NO-GO iff ≥1 HARM\./);
  for (const [name, t] of [["agents/cold-reviewer.md", claude], ["templates/codex-cold-reviewer.toml.tmpl", codex]]) {
    assert.doesNotMatch(t, /reachable failure/, `${name} must not copy part of REVIEW's HARM definition`);
  }
});

test("REVIEW still defines HARM with the unproven-mitigation clause the seats now defer to", () => {
  assert.match(flat("core/REVIEW.md"), /An unproven mitigation or backstop claim is a HARM \(name the check that would prove it\)\./);
});

test("the README note says what changed and that adopters byte-copy the two files", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.44.1"), r.indexOf("## What's new in v2.44.0"));
  assert.ok(n.length > 300, "the v2.44.1 note sits above v2.44.0's");
  assert.match(n, /exactly as `core\/REVIEW\.md` § Cold review defines them/);
  assert.match(n, /Adopters byte-copy those two files/);
});

test("version is 2.44.1 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.44.1");
  assert.equal(JSON.parse(read("package.json")).version, "2.44.1");
  assert.match(read("README.md"), /^# workflow-kit — v2\.44\.1$/m);
});
