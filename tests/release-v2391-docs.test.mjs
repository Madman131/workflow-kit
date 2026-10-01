// v2.39.1: dead installed citations fixed, Claude thread-restart refreshes the snapshot, README note.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(path.join(KIT, rel), "utf8").replace(/\s+/g, " ");

test("Claude thread-restart refreshes the snapshot block first, as the Codex copy does", () => {
  const s = flat("commands/claude/thread-restart.md");
  assert.match(s, /## Step 1 — Build the digest \(a control, not a summary\) First refresh the current-state snapshot block \(`core\/README\.md` § STATE\) so the digest can point at it\. Write a durable digest/);
});

test("the sweep skill says the tool is not installed by init", () => {
  assert.match(flat("skills/sweep/SKILL.md"), /`scripts\/sweep\.mjs` \(workflow-kit repository; init does not install it\)/);
});

test("the README note names the new test", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.39.1"), r.indexOf("## What's new in v2.39.0"));
  assert.match(n, /tests\/installed-citations\.test\.mjs/);
});
