// v2.37.0 release wording: the removal of the Architect-to-PM send screens, D-41/D-43 Owner reservations,
// and the committed-adoption rule carried from the unreleased v2.36.1. Pinned by the words an agent acts on.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(KIT, rel), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

test("VERSION, package.json and the README title agree on 2.37.0", () => {
  assert.equal(read("VERSION").trim(), "2.37.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.37.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.37\.0$/m);
});

test("the v2.37.0 note: a removal, no Codex re-trust, pair keys retired, committed adoption included", () => {
  const readme = read("README.md");
  const note = flat(readme.slice(readme.indexOf("## What's new in v2.37.0"), readme.indexOf("## What's new in v2.36.0")));
  assert.match(note, /\*\*A removal\.\*\* No hook stands between an Architect and its PM any more\./);
  assert.match(note, /\*\*No Codex re-trust\.\*\* No `\.codex\/hooks\.json` entry changed/);
  assert.match(note, /`pairedPmThreadId`, `pairedPmClaudeTarget` and `pairedPmClaudeName` in `\.claude\/kit\.config\.json` are tolerated and ignored, never a malformed-config deny/);
  assert.match(note, /`init` still accepts `--paired-pm-thread-id`/);
  assert.match(note, /push\/deploy\/publication GOs, irreversible or live acts, money, credentials or access, and a change of direction or scope/);
  assert.match(note, /v2\.36\.1's committed-adoption rule is included/);
});

test("PORTABILITY says session chat is not a dispatch, and controller bytes move only by committed adoption", () => {
  const p = flat(read("PORTABILITY.md"));
  assert.match(p, /Session chat is NOT a dispatch and passes untouched: Claude's `SendMessage`, the desktop app's forwarding of it as `mcp__ccd_session_mgmt__send_message`, and the Codex app's `mcp__codex_app__send_message_to_thread`\./);
  assert.match(p, /No hook stands between an Architect and its PM\./);
  assert.doesNotMatch(p, /minimal `architectScreen`|ARCHITECT_STATUS_V1` line/i, "the removed screen's producer instructions are gone");
  const at = p.indexOf("Controller and recorder bytes reach an adopter only through a committed adoption");
  assert.ok(at > p.indexOf("## Retained repair-controller boundary"));
  const s = p.slice(at, at + 600);
  assert.match(s, /only through a committed adoption, never as uncommitted copies across worktrees/);
  assert.match(s, /a restore or checkout in any one worktree silently reverts them to the old controller \(lesson FM-42\)/);
  assert.match(s, /copying its changed files, committing, and diff-proving them against the kit release/);
});

test("WORKFLOW scopes the flag's Owner GO to the live effect, and ROUTING lists the five Owner reservations", () => {
  const w = flat(read("core/WORKFLOW.md"));
  assert.match(w, /a \*\*named Owner GO for the flagged live effect\*\* \(irreversible act, money movement, credential change\), not for building or committing\./);
  assert.match(w, /push\/deploy\/publication GO; irreversible or live acts; money; credentials\/access; change of direction or scope/);
  assert.match(w, /\*\*fresh named Owner GO\*\* for the exact head and target/, "the push GO clause is unchanged");
  const r = flat(read("skills/architect-build/ROUTING.md"));
  assert.match(r, /Owner alone retains: push\/deploy\/publication GO; irreversible or live acts \(including live\/external-data writes\); money\/new spend; credentials\/access; a change of direction or scope\. Everything else is the Principal's/);
  assert.doesNotMatch(r, /gate waiver|baseline\/launch;|critical choice/, "the superseded Owner list cannot return");
});
