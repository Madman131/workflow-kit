// v2.44.2: the Gemini cross-family seat is rebound from the retired Gemini 3.1 Pro (High) to Gemini 3.8 Flash (High).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("both Gemini scripts and GATES.md bind the 3.8 Flash model", () => {
  assert.match(read("scripts/cold-review-gemini.sh"), /^MODEL="Gemini 3\.8 Flash \(High\)"  # gate-binding-ok:/m);
  assert.match(read("scripts/gemini-frozen-gate.mjs"), /SUBSCRIPTION_MODEL = "gemini-3\.8-flash-high", SUBSCRIPTION_EFFORT = "high"/);
  const g = read("core/GATES.md");
  assert.match(g, /uses Gemini 3\.8 Flash High through the Antigravity CLI/);
  assert.match(g, /^`gemini-3\.8-flash-high` at `high` effort/m);
});

test("no live script or GATES.md still names the retired model", () => {
  for (const f of ["scripts/cold-review-gemini.sh", "scripts/gemini-frozen-gate.mjs", "core/GATES.md"]) {
    assert.doesNotMatch(read(f), /3\.1 ?pro|pro-high|Pro \(High\)/i, f);
  }
});

test("the README carries the v2.44.2 note above v2.44.1's", () => {
  const r = read("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.44.2"), r.indexOf("## What's new in v2.44.1"));
  assert.ok(n.length > 200);
  assert.match(n, /Adopters byte-copy those two scripts and `core\/GATES\.md`/);
});

test("version is 2.44.2 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.44.2");
  assert.equal(JSON.parse(read("package.json")).version, "2.44.2");
  assert.match(read("README.md"), /^# workflow-kit — v2\.44\.2$/m);
});

test("the no-tool sentence opens the INLINE message only: absent from both PROMPT strings and from FILE_PROMPT", () => {
  const sentence = "Do not call any tool or run any command: everything you need is in this message, and tool calls are denied. Reply in text only. ";
  const sh = read("scripts/cold-review-gemini.sh");
  const starts = [...sh.matchAll(/^  PROMPT='(.*)/gm)].map((m) => m[1]);
  assert.equal(starts.length, 2, "exactly the design and code PROMPT assignments");
  for (const t of starts) assert.ok(!t.includes("tool calls are denied"), "PROMPT must not carry the no-tool sentence (FILE mode inherits it)");
  const inline = sh.match(/^INLINE_COMBINED="(.*)$/m);
  assert.ok(inline && inline[1].startsWith(sentence + "$PROMPT"), "INLINE_COMBINED must open with the sentence, then $PROMPT");
  const file = sh.slice(sh.indexOf('FILE_PROMPT="'));
  assert.ok(!file.slice(0, 600).includes("tool calls are denied"), "FILE_PROMPT must not carry the inline sentence");
  assert.ok(file.startsWith('FILE_PROMPT="Do not run any command; read review_payload.txt only with your file-reading tool. Reply in text only. $PROMPT'), "FILE_PROMPT must open with the file-read-only sentence");
  assert.equal(sh.split("tool calls are denied").length - 1, 1, "the sentence appears exactly once in the script");
  assert.match(read("README.md"), /the inline review message now forbids tool calls because Gemini 3\.8 Flash calls tools/);
});
