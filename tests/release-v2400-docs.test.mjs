// v2.40.0: record-before-send, no silent PM stop, outstanding Owner action stays last, standing review authorization.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(path.join(KIT, rel), "utf8").replace(/\s+/g, " ");

test("STATE defines record-before-send with its measured reason", () => {
  const s = flat("core/README.md");
  assert.match(s, /\*\*Record before send:\*\* a directive that changes a PM's current task or sets or lifts a pause is written into this block BEFORE it is sent; a receiver whose sender could not write it records it as its first act\./);
  assert.match(s, /Compaction keeps the Owner's own messages but can drop peer- or tool-delivered ones/);
});

test("architect-build ROUTING points at the snapshot rule", () => {
  assert.match(flat("skills/architect-build/ROUTING.md"), /is recorded in the current-state snapshot BEFORE it is sent \(`core\/README\.md` § STATE\)/);
});

test("orchestrate SKILL carries no-silent-stop and the Owner action staying last", () => {
  const s = flat("skills/orchestrate/SKILL.md");
  assert.match(s, /\*\*No silent stop:\*\* a PM ending a turn with work owed first sends its Architect `STOP:` reason, next action, who must act/);
  assert.match(s, /Architect's one-shot idle subscription/);
  assert.match(s, /an Owner pause gets one notice, then quiet/);
  assert.match(s, /never only an async question tool/);
  assert.match(s, /while outstanding ENDS every final response \(rule 8\)/);
  assert.match(s, /ask routing: `core\/REVIEW\.md` § External gate/);
});

test("OWNER_COMMS rule 8 keeps the outstanding Owner action last and bounds the licence", () => {
  const t = flat("templates/OWNER_COMMS.md.tmpl");
  assert.match(t, /While Owner input is outstanding, EVERY later final response ENDS with that exact action under its bold label/);
  assert.match(t, /never a vague "the blocker remains" pointer and never buried above status text/);
  assert.match(t, /stays silent where the host allows it; otherwise it re-ends with the same action/);
  assert.match(t, /no licence to re-issue tool prompts, retry a rejected transmission or widen an authorization/i);
});

test("REVIEW External gate carries the standing authorization and ask routing", () => {
  const r = flat("core/REVIEW.md");
  assert.match(r, /\*\*Standing review authorization, and who an ask goes to\.\*\*/);
  assert.match(r, /A routine delegated review decision goes to the Architect, never to the Owner as a new decision/);
  assert.match(r, /never bypass a host restriction/);
  assert.match(r, /reaches the Owner, once per program, in standing scoped form: packet classes, reviewers, exclusions/);
  assert.match(r, /ASSUMED, not observed/);
});

test("the README note names the new test and the changes", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.40.0"), r.indexOf("## What's new in v2.39.2"));
  assert.match(n, /tests\/release-v2400-docs\.test\.mjs/);
  assert.match(n, /Record before send/);
  assert.match(n, /No silent stop/);
  assert.match(n, /stays last/);
  assert.match(n, /Standing review authorization/);
});

test("the README note carries the Codex re-trust line first and names the Stop sensor", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.40.0"), r.indexOf("## What's new in v2.39.2"));
  assert.doesNotMatch(n, /no Codex re-trust/, "the part-1 'no re-trust' line is gone");
  const head = n.slice(n.indexOf("—") , n.indexOf("- **Record before send.**"));
  assert.match(head, /Codex re-trust owed\./);
  assert.match(head, /new `\.codex\/hooks\.json` entry \(a `Stop` hook\)/);
  assert.match(head, /every adopter that takes it re-approves hooks once/);
  assert.match(head, /FM-40/);
  assert.match(n, /\*\*Codex Stop sensor\.\*\* `hooks\/sensor-stop-notice\.mjs`, registered on Codex `Stop` by `init` exactly once/);
  assert.match(n, /blocks ONCE per turn \(`stop_hook_active` ⇒ allow/);
  assert.match(n, /`tests\/stop-notice\.test\.mjs`/);
  assert.match(n, /hand-edits rule 8 of their existing `core\/OWNER_COMMS\.md`/);
});

test("the Stop-payload claims are corrected to what the probe observed (README v2.37.1, PORTABILITY)", () => {
  const r = flat("README.md");
  const v = r.slice(r.indexOf("## What's new in v2.37.1"), r.indexOf("## What's new in v2.37.0") > 0 ? r.indexOf("## What's new in v2.37.0") : undefined);
  assert.doesNotMatch(v, /receive no transcript and no Stop payload/);
  assert.match(v, /Corrected in v2\.40\.0/);
  assert.match(v, /codex-cli 0\.159\.2/);
  assert.match(v, /`stop_hook_active:true`/);
  assert.match(v, /an untrusted hook is skipped silently/);
  const p = flat("PORTABILITY.md");
  assert.doesNotMatch(p, /this kit has not observed that payload/);
  assert.doesNotMatch(p, /Codex has no observed Stop payload/);
  assert.match(p, /The Codex `Stop` payload WAS observed \(codex-cli 0\.159\.2, 2026-09-30/);
  assert.match(p, /trust is recorded per `hooks\.json` entry and an untrusted hook is skipped silently/);
  assert.match(p, /`sensor-stop-notice` on `Stop`/);
  assert.match(p, /Not coded in `sensor-stop-notice`, because no transcript shape was observed:\*\* the "Owner-ended final close" exemption/);
});

test("the probe receipt is kept in the journal", () => {
  const j = flat("docs/journal/2026-09-30-codex-stop-probe-receipt.md");
  assert.match(j, /codex-cli` 0\.159\.2/);
  assert.match(j, /`stop_hook_active:true`/);
  assert.match(j, /ACKNOWLEDGEMENT/);
});

test("version is 2.40.0 everywhere", () => {
  assert.equal(readFileSync(path.join(KIT, "VERSION"), "utf8").trim(), "2.40.0");
  assert.equal(JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8")).version, "2.40.0");
  assert.match(readFileSync(path.join(KIT, "README.md"), "utf8"), /^# workflow-kit — v2\.40\.0$/m);
});
