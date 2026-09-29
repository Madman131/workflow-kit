// v2.35.0 release wording: each operative sentence an adopter or agent acts on, pinned by its words.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

test("WORKFLOW Step 0 says a hook checks the entry line's shape and nothing catches a false one", () => {
  const w = flat(read("core/WORKFLOW.md"));
  assert.match(w, /A COMMIT HOOK CHECKS ONLY ITS SHAPE; NO CONTROL CATCHES A FALSE ONE\.\*\* Its only judge is whoever next reviews the record/);
  assert.doesNotMatch(w, /NO CONTROL READS THAT LINE/, "the retracted claim cannot return");
});

test("the v2.35.0 note gives the one-step upgrade, the unchanged Codex entries, the v2.32.x re-trust step, and no pair residual", () => {
  const readme = read("README.md");
  const note = flat(readme.slice(readme.indexOf("## What's new in v2.35.0"), readme.indexOf("## What's new in v2.34.0")));
  assert.match(note, /From \*\*v2\.33\.x\*\*, go straight to v2\.35\.0 with one `node <kit>\/bin\/init\.mjs --target <repo> --force`/);
  assert.match(note, /The repair controller is byte-identical to v2\.33\.x, so worktrees need no ordered upgrade/);
  assert.match(note, /No `\.codex\/hooks\.json` entry changes in v2\.34\.0 or v2\.35\.0:\*\* only hook scripts change/);
  assert.match(note, /\*\*re-trust Codex hooks interactively\*\* \(run `codex` in the repo, answer "Trust all and continue"\) even if the armed check reads ARMED/);
  assert.doesNotMatch(note, /tracked pair|ARCHITECT_STATUS_V1/, "the pair residual described removed behaviour and is gone (v2.37.0)");
  assert.doesNotMatch(flat(readme), /kit\.pair\.json/, "the dropped per-checkout pair file is named nowhere");
});

test("PORTABILITY states the record check's reach and the commit-msg hook's scope", () => {
  const p = flat(read("PORTABILITY.md"));
  assert.match(p, /It runs at write time only — replay never re-reads a file that may since have changed — so a hand-written ledger row skips it/);
  assert.match(p, /a commit body must carry `entry: none` or `entry: class-N\[,N…\]` \(N = 1–4\), checked for presence and shape only/);
});
