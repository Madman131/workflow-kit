// v2.39.0: Codex-lane continuity — the shared snapshot block, the AGENTS twin, the retired scope-out sentence.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(path.join(KIT, rel), "utf8").replace(/\s+/g, " ");
const section = (s, from) => { const i = s.indexOf(from); assert.ok(i >= 0, `${from} present`); return s.slice(i, i + 1600); };

test("core/README STATE defines the snapshot block once", () => {
  const s = flat("core/README.md");
  const i = s.indexOf("Its top block is the current-state snapshot");
  assert.ok(i >= 0, "snapshot definition present");
  const b = s.slice(i, i + 900);
  assert.match(b, /approved objective \+ scope · active Architect\/PM\/Builder identities · current task, checkout, branch, candidate SHA/);
  assert.match(b, /verified completed work, with evidence links · remaining work and any genuine blocker · next actor \+ exact next action/);
  assert.match(b, /authorization boundaries \(a pointer to the Owner-reserved list, never a copy\) · last-verified date/);
  assert.match(b, /Superseded instructions ARE history: they move to `docs\/journal\/`/);
  assert.match(b, /never erases evidence, approvals, failures or review history/);
  assert.equal(s.split("Its top block is the current-state snapshot").length, 2, "defined exactly once");
});

test("AGENTS template carries the Codex thread-restart twin", () => {
  const s = section(flat("templates/AGENTS.md.tmpl"), "## Thread restart");
  assert.match(s, /After any auto-compaction re-read the snapshot \(`core\/README\.md` § STATE\) and the governing procedure; never resume superseded work/);
  assert.match(s, /Run `\/thread-restart` \(`commands\/codex\/thread-restart\.md`\) at EVERY chip landing and when a corrected thread returns to obsolete work/);
  assert.match(s, /Never interrupt an active write, test or review; one execution owner during handoff/);
  assert.match(s, /No token sensor, so no percentage trigger/);
});

test("Codex thread-restart prompt refreshes the snapshot first", () => {
  const s = flat("commands/codex/thread-restart.md");
  assert.match(s, /First refresh the current-state snapshot block \(`core\/README\.md` § STATE\) so the digest can point at it/);
});

test("closeout points at the snapshot when updating state", () => {
  assert.match(flat("skills/closeout/SKILL.md"), /Update the current-state \/ open-work docs \(refresh the snapshot block, `core\/README\.md` § STATE\)/);
});

test("the 'out of scope until measured' claim is retired from every surface", () => {
  for (const rel of ["skills/orchestrate/SKILL.md", "skills/architect-build/SKILL.md", "templates/CLAUDE.md.tmpl", "templates/AGENTS.md.tmpl", "commands/claude/thread-restart.md", "commands/codex/thread-restart.md", "core/README.md"]) {
    assert.doesNotMatch(flat(rel), /out of scope until measured|Claude lane only; the Codex lane's self-compacting/, `${rel} still carries the retired claim`);
  }
});

test("the README note records the compact_prompt measurement and the unchanged config", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.39.0"), r.indexOf("## What's new in v2.38.0"));
  assert.match(n, /codex-cli 0\.158\.0-alpha\.2\.1/);
  assert.match(n, /`encrypted_content` only/);
  assert.match(n, /So `codex\/config\.toml` is unchanged/);
  assert.doesNotMatch(readFileSync(path.join(KIT, "codex", "config.toml"), "utf8"), /^\s*(experimental_)?compact_prompt/m, "no unproven compact_prompt key ships");
});

test("version is 2.39.0 everywhere", () => {
  assert.equal(readFileSync(path.join(KIT, "VERSION"), "utf8").trim(), "2.39.0");
  assert.equal(JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8")).version, "2.39.0");
  assert.match(readFileSync(path.join(KIT, "README.md"), "utf8"), /^# workflow-kit — v2\.39\.0$/m);
});
