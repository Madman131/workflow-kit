// v2.39.2: ACTION NEEDED joins the Owner labels; CHIP_BRIEF § 5 gains the one-command-per-call landing rule.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(path.join(KIT, rel), "utf8").replace(/\s+/g, " ");

test("CHIP_BRIEF § 5 tells every brief to land with one plain command per call", () => {
  assert.match(flat("skills/orchestrate/CHIP_BRIEF.md"), /The land recipe runs each push, PR-create and merge as one plain command per call — no pipe, shell function or chain — so host allow rules can match it\./);
});

test("OWNER_COMMS rule 8 names ACTION NEEDED and forbids the unlabeled trailing question", () => {
  const t = flat("templates/OWNER_COMMS.md.tmpl");
  assert.match(t, /steps the Owner must take/);
  assert.match(t, /`\*\*ACTION NEEDED:\*\*` \(a step only the Owner can perform, such as running a handed-over command\)/);
  assert.match(t, /never an unlabeled trailing question/);
});

test("the README mirrors list ACTION NEEDED", () => {
  const r = flat("README.md");
  assert.match(r, /`\*\*DECISION NEEDED:\*\*`, `\*\*ACTION NEEDED:\*\*`\. Prose may still/);
  assert.match(r, /`\*\*DECISION NEEDED:\*\*`, or `\*\*ACTION NEEDED:\*\*` — never buried mid-paragraph/);
});

test("the README note names the new test and both changes", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.39.2"), r.indexOf("## What's new in v2.39.1"));
  assert.match(n, /tests\/release-v2392-docs\.test\.mjs/);
  assert.match(n, /`\*\*ACTION NEEDED:\*\*` label/);
  assert.match(n, /one plain command per call/);
});
