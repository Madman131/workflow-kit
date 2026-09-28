// v2.36.0 release wording: each operative sentence an adopter or agent acts on, pinned by its words.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

test("the v2.36.0 note says the controller changed, v5 is one-way, and every worktree upgrades in one step", () => {
  const readme = read("README.md");
  const note = flat(readme.slice(readme.indexOf("## What's new in v2.36.0"), readme.indexOf("## What's new in v2.35.0")));
  assert.match(note, /\*\*This release changes the repair controller\.\*\* v2\.35\.0's controller was byte-identical to v2\.33\.x; v2\.36\.0's is not\./);
  assert.match(note, /\*\*A v4 reader rejects a v5 ledger row, and rolling that ledger back to v4 is unsupported\.\*\*/);
  assert.match(note, /in \*\*every worktree of the repository in one step\*\*, in the order v2\.33\.1's note gives/);
  assert.match(note, /`init`'s mixed-controller check compares bytes, not version labels, and refuses a mixed install\./);
});
