// v2.46.0 KIT-OWNER-DIVIDER: rule 10 (the divider) in the OWNER_COMMS template, the PORTABILITY rows, the README note
// and the version. The hook behaviour is pinned in tests/owner-divider.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const flat = (p) => read(p).replace(/\s+/g, " ");

test("OWNER_COMMS rule 10 carries the divider, the four headings, numbering, lettering and the empty case", () => {
  const raw = read("templates/OWNER_COMMS.md.tmpl"), t = flat("templates/OWNER_COMMS.md.tmpl");
  assert.match(raw, /^ {3}\*{7}INFORMATION FOR \{\{OWNER_NAME\}\}\*{8}$/m, "the literal one-line divider");
  assert.doesNotMatch(raw, /^ *\*{21}$/m, "the retired two-line form is not named in the doctrine");
  assert.match(t, /^.*10\. \*\*End every stop with the divider\.\*\*/);
  assert.match(t, /the house form writes the name in capitals; the sensor matches the name in any case/);
  for (const h of ["**Status**", "**What happened**", "**What you need to know**", "**What I need from you**"]) assert.ok(t.includes(h), h);
  assert.match(t, /\*\*repeated in full, never "as I said above"\*\*/);
  assert.match(t, /Number every ask 1, 2, 3 across the section/);
  assert.match(t, /letter the options inside one ask a\), b\), c\)/);
  assert.match(t, /\*\*Nothing needed from you\.\*\*/);
});

test("OWNER_COMMS reconciles rules 1 and 8 and the header note with rule 10", () => {
  const t = flat("templates/OWNER_COMMS.md.tmpl");
  assert.match(t, /The answer still leads; rule 10 adds the divider section after it\.\*\*/);
  assert.match(t, /brevity below the divider never drops a fact/);
  assert.match(t, /Under rule 10 the labeled asks and the AUTHORIZATION NEEDED form sit in the divider section, numbered 1, 2, 3/);
  assert.match(t, /ENDS with that exact action under its bold label \(a `\*\*KIT GAP-ACTION NEEDED:\*\*` line is one until the Owner has forwarded it\), never a vague "the blocker remains" pointer and never buried above status text\. Under rule 10 that action is a numbered ask in the section below the divider\./);
  assert.match(t.replace(/ > /g, " "), /the divider half of rule 10 is checked by that same hook in Claude and by `\.codex\/hooks\/sensor-stop-notice\.mjs` in Codex/);
});

test("PORTABILITY says what the divider check does, where it is dormant and that it fails open", () => {
  const p = flat("PORTABILITY.md");
  assert.match(p, /`sensor-stop-notice` \(Stop; blocks ONCE so a PM stop reaches its Architect, an Owner ask stays last and, since v2\.46\.0, an Owner-facing final carries the rule-10 divider\)/);
  assert.match(p, /\*\*Rule 10, the divider \(v2\.46\.0\), is a third check, and it is presence only\.\*\*/);
  assert.match(p, /It is dormant without a completed Owner contract and allows on every doubt/);
  assert.match(p, /`--agent` main session sends `agent_type` WITHOUT `agent_id` \(observed\) and is checked/);
  assert.match(p, /skips headless `codex exec` seats/);
  assert.match(p, /`WORKFLOW_KIT_OWNER_DIVIDER="false"`/);
});

test("the README note says what changed, the measured facts, the residuals and what adopters copy", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.46.0"), r.indexOf("## What's new in v2.45.0"));
  assert.ok(n.length > 1500, "the v2.46.0 note sits above v2.45.0's");
  assert.match(n, /\*\*The one-line form is canonical\.\*\* The sensor also still accepts the earlier two-line form .* in v2\.46\.0 only, so sessions already using it are not bounced; it will be dropped in a later release/);
  assert.match(n, /`\*{7}INFORMATION FOR <OWNER>\*{8}`/);
  assert.match(n, /Claude Code 2\.1\.312's `Stop` payload carries `last_assistant_message`/);
  assert.match(n, /129 Codex sessions/);
  assert.match(n, /A headless `claude -p` run in an adopter gets one nudge; a stop while background agents run is a stop and gets one nudge; the Codex subagent `session_meta` shape is unobserved/);
  assert.match(n, /Byte-copy `hooks\/guard-owner-comms\.mjs` and `hooks\/sensor-stop-notice\.mjs` into BOTH `\.claude\/hooks\/` and `\.codex\/hooks\/`/);
  assert.match(n, /Hand-edit rule 10, the rule-8 sentences and the header note into your own `core\/OWNER_COMMS\.md`/);
  assert.match(n, /No settings or `hooks\.json` change and no re-trust expected; confirm with `node scripts\/check-codex-hooks-armed\.mjs`/);
});

test("the hook files carry the shipped contract: exports, the off switch and no new registration", () => {
  const g = read("hooks/guard-owner-comms.mjs"), s = read("hooks/sensor-stop-notice.mjs");
  assert.match(g, /export function hasOwnerDivider\(/);
  assert.match(g, /export function dividerReason\(/);
  assert.match(g, /WORKFLOW_KIT_OWNER_DIVIDER !== "false"/);
  assert.match(s, /WORKFLOW_KIT_OWNER_DIVIDER === "false"/);
  assert.match(s, /import\(new URL\("\.\/guard-owner-comms\.mjs", import\.meta\.url\)\.href\)/);
});

test("version is 2.46.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.46.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.46.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.46\.0$/m);
});

test("no registration changed: init (which writes the .codex/hooks.json entry), the Claude settings template and the Codex config are byte-identical to v2.45.0", () => {
  let diff = "";
  try { diff = execFileSync("git", ["-C", new URL("..", import.meta.url).pathname, "diff", "--name-only", "4037608a4f4a26c5ca7295785bb9016d7ed6ddf1", "--", ["bin", "init" + ".mjs"].join("/"), "templates/settings.json", "codex"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return; }   // no v2.45.0 object here (a tarball, a shallow clone, or a later release has moved the base): nothing to compare
  assert.equal(diff.trim(), "", "the Stop registrations (command, timeout, statusMessage) are unchanged, so no adopter re-trusts");
});
