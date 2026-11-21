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
  assert.match(t, /do not repeat the section: write the divider and ONE line, \*\*No change since my last message\.\*\*/);
  assert.doesNotMatch(t, /EVERY later final response ENDS/, "D-267: the repeat clause is gone");
  assert.match(t, /a turn where nothing changed has that single line as its section \(rule 8\)/);
  assert.match(t, /This is no licence to re-issue tool prompts, retry a rejected transmission or widen an authorization/);
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

test("the README note states the no-repeat change, the (c) narrowing and the SKILL line (D-267)", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.46.0"), r.indexOf("## What's new in v2.45.0"));
  assert.match(n, /\*\*No repeats \(D-267\)\.\*\*/);
  assert.match(n, /\*\*No change since my last message\.\*\*/);
  assert.match(n, /trigger \(c\) now applies only to a final with no divider/);
  assert.match(n, /`skills\/orchestrate\/SKILL\.md` line "and is re-listed only when something changed \(rule 8\)"/);
  assert.match(flat("PORTABILITY.md"), /trigger \(c\) applies only to a final with NO divider/);
});

test("the README note says what changed, the measured facts, the residuals and what adopters copy", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.46.0"), r.indexOf("## What's new in v2.45.0"));
  assert.ok(n.length > 1500, "the v2.46.0 note sits above v2.45.0's");
  assert.match(n, /\*\*The one-line form is canonical\.\*\* The sensor also still accepts the earlier two-line form .* in v2\.46\.0 only, so sessions already using it are not bounced; it will be dropped in a later release/);
  assert.match(n, /`\*{7}INFORMATION FOR <OWNER>\*{8}`/);
  assert.match(n, /Claude Code 2\.1\.312's `Stop` payload carries `last_assistant_message`/);
  assert.match(n, /129 Codex sessions/);
  assert.match(n, /In a headless `claude -p` run in an adopter the follow-up becomes the printed result; a stop while background agents run is a stop and gets one nudge; the Codex subagent `session_meta` shape is unobserved/);
  assert.match(n, /runs only for the `vscode` \(Codex Desktop\) and `cli` \(the TUI\) sources/);
  assert.match(n, /`--project-dir`, then `CLAUDE_PROJECT_DIR`, then the payload `cwd`/);
  assert.match(n, /Byte-copy `hooks\/guard-owner-comms\.mjs` and `hooks\/sensor-stop-notice\.mjs` into BOTH `\.claude\/hooks\/` and `\.codex\/hooks\/`/);
  assert.match(n, /Hand-edit rule 10, the rule-8 no-repeat clause and sentences, and the header note into your own `core\/OWNER_COMMS\.md`/);
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

test("the v2.46.0 release note is still in the README (the version stamp itself moves with each release; v2.47.0 pins the current one)", () => {
  assert.match(read("README.md"), /^## What's new in v2\.46\.0 — every stop ends with the Owner divider/m);
});

test("no registration changed: init (which writes the .codex/hooks.json entry), the Claude settings template and the Codex config are byte-identical to v2.45.0", () => {
  let diff = "";
  try { diff = execFileSync("git", ["-C", new URL("..", import.meta.url).pathname, "diff", "--name-only", "4037608a4f4a26c5ca7295785bb9016d7ed6ddf1", "--", ["bin", "init" + ".mjs"].join("/"), "templates/settings.json", "codex"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return; }   // no v2.45.0 object here (a tarball, a shallow clone, or a later release has moved the base): nothing to compare
  assert.equal(diff.trim(), "", "the Stop registrations (command, timeout, statusMessage) are unchanged, so no adopter re-trusts");
});
