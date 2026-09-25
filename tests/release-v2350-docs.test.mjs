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

test("the v2.35.0 note gives the one-step upgrade, the unchanged Codex entries, and the v2.32.x re-trust step", () => {
  const readme = read("README.md");
  const note = flat(readme.slice(readme.indexOf("## What's new in v2.35.0"), readme.indexOf("## What's new in v2.34.0")));
  assert.match(note, /From \*\*v2\.33\.x\*\*, go straight to v2\.35\.0 with one `node <kit>\/bin\/init\.mjs --target <repo> --force`/);
  assert.match(note, /The repair controller is byte-identical to v2\.33\.x, so worktrees need no ordered upgrade/);
  assert.match(note, /No `\.codex\/hooks\.json` entry changes in v2\.34\.0 or v2\.35\.0:\*\* only hook scripts change/);
  assert.match(note, /\*\*re-trust Codex hooks interactively\*\* \(run `codex` in the repo, answer "Trust all and continue"\) even if the armed check reads ARMED/);
  assert.match(note, /give every paired checkout its own file \(`init --paired-pm-…` there\), \*\*then\*\* remove the `pairedPm\*` keys/);
  assert.match(note, /A pair already in the tracked `\.claude\/kit\.config\.json` \*\*keeps working\*\* where no local file exists, and `init` never deletes it/);
});

test("PORTABILITY states the pair migration order and the record check's reach", () => {
  const p = flat(read("PORTABILITY.md"));
  assert.match(p, /give every paired checkout its own `kit\.pair\.json`, \*\*then\*\* remove the tracked keys by hand in one commit; removing them first unpairs every checkout still reading them/);
  assert.match(p, /a key it lacks is never filled from the tracked config/);
  assert.match(p, /It runs at write time only — replay never re-reads a file that may since have changed — so a hand-written ledger row skips it/);
  assert.match(p, /a commit body must carry `entry: none` or `entry: class-N\[,N…\]` \(N = 1–4\), checked for presence and shape only/);
});

test("the generated docs and the Architect routing name the per-checkout pair file", () => {
  assert.match(flat(read("templates/BINDINGS.md.tmpl")), /per-checkout, in gitignored `\.claude\/kit\.pair\.json` — tracked keys read only where it is absent — the optional `pairedPmThreadId`/);
  assert.match(read("templates/CLAUDE.md.tmpl"), /`pairedPmThreadId` in this checkout's `\.claude\/kit\.pair\.json`/);
  assert.match(read("templates/AGENTS.md.tmpl"), /`pairedPmThreadId` in this checkout's `\.claude\/kit\.pair\.json`/);
  assert.match(flat(read("skills/architect-build/ROUTING.md")), /Set them via `init` \(per-checkout `\.claude\/kit\.pair\.json`\); existing pair: edit only that lane's keys there in place/);
});
