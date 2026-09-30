// v2.38.0: the thread-restart practice in its three durable homes. Pinned by the words an agent acts on.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(path.join(KIT, rel), "utf8").replace(/\s+/g, " ");
const section = (s, from) => { const i = s.indexOf(from); assert.ok(i >= 0, `${from} present`); return s.slice(i, i + 1600); };
const LANE = /Claude lane only; the Codex lane's self-compacting ~254k window is out of scope until measured/;

test("PM skill carries clauses 1-4", () => {
  const s = section(flat("skills/orchestrate/SKILL.md"), "## Thread restart");
  assert.match(s, /At EVERY chip landing, after merge and closeout, the PM reports the landing \(landed SHA and actuals\) to the Architect\/Owner, then writes a pointer-style restart digest via `\/thread-restart`/);
  assert.match(s, /"Read <digest> and continue" comes after the context banner line when the sensor owes one/);
  assert.match(s, /at ~50% restart at the next safe breakpoint/);
  assert.match(s, /at ~70% stop and restart before further work/);
  assert.match(s, /node scripts\/token-report\.mjs --by session/);
  assert.match(s, /and this session's own boot cost — the `context_now` of its first row in `\.claude\/metrics\/tokens\.jsonl` \(the first row with this session's `session_id`\)/);
  assert.doesNotMatch(s.slice(s.indexOf("3. The digest"), s.indexOf("4. A Builder")), /at first boot|program record|NEW session/);
  assert.match(s, /Builder \(subagent or headless\) near ~70% gets a fresh session and lane file/);
  assert.match(s, LANE);
});

test("Architect skill carries clauses 1-2", () => {
  const s = section(flat("skills/architect-build/SKILL.md"), "## Thread restart");
  assert.match(s, /At EVERY chip landing, after merge and closeout, the Architect reports the landing \(landed SHA and actuals\) to the Owner, then writes a pointer-style restart digest via `\/thread-restart`/);
  assert.match(s, /comes after the context banner line when the sensor owes one/);
  assert.match(s, /~70% stop and restart before further work/);
  assert.match(s, LANE);
});

test("template carries the summary and pointer", () => {
  const s = section(flat("templates/CLAUDE.md.tmpl"), "## Thread restart");
  assert.match(s, /At EVERY chip landing report the landing, then write a pointer-style digest via `\/thread-restart`/);
  assert.match(s, /~70% context/);
  assert.match(s, /stop and restart/);
  assert.match(s, LANE);
  assert.match(s, /skills\/orchestrate\/SKILL\.md` § Thread restart/);
});

test("the v2.38.0 README note cites the evidence", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.38.0"), r.indexOf("## What's new in v2.37.1"));
  assert.match(n, /~415k to ~194k/);
  assert.match(n, /~692k to ~273k/);
  assert.match(n, /token-report/);
  assert.match(n, /this session's own boot cost/);
  assert.match(n, /`context_now` of its first row in `\.claude\/metrics\/tokens\.jsonl`/);
});

test("version is 2.38.0 everywhere", () => {
  assert.equal(readFileSync(path.join(KIT, "VERSION"), "utf8").trim(), "2.38.0");
  assert.equal(JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8")).version, "2.38.0");
  assert.match(readFileSync(path.join(KIT, "README.md"), "utf8"), /^# workflow-kit — v2\.38\.0$/m);
});

test("Architect skill keeps the two rules the trims once removed", () => {
  const a = flat("skills/architect-build/SKILL.md");
  assert.match(a, /Routine progress adds none unless something changes; no new gate, consult or message\./);
  assert.match(a, /Never duplicate either role\./);
});
