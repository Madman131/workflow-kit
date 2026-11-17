// v2.45.0 KIT-REVIEW-HYGIENE: the identity check reads the stored remote URL, REVIEW states the runner's
// frozen-tree exclusion, the README note says what adopters byte-copy versus hand-edit, and the version
// moves. The runner behaviour is pinned in tests/cold-review-hygiene.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const flat = (p) => read(p).replace(/\s+/g, " ");

test("the identity check uses the stored URL at every shipped site, never the rewritten one", () => {
  for (const f of ["skills/boot/SKILL.md", "skills/closeout/SKILL.md", "templates/AGENTS.md.tmpl", "templates/BINDINGS.md.tmpl", "templates/CLAUDE.md.tmpl"]) assert.doesNotMatch(flat(f), /get-url/, `${f} must not run get-url`);
  const readme = flat("README.md"), note = readme.slice(readme.indexOf("## What's new in v2.45.0"), readme.indexOf("## What's new in v2.44.2"));
  assert.doesNotMatch(readme.replace(note, ""), /remote get-url/, "outside the v2.45.0 note (which names the old form to explain the change) the README has no get-url");
  assert.match(readme, /the identity fingerprint \(`git config --get remote\.origin\.url` against the entry stub's table/);
  assert.match(flat("skills/boot/SKILL.md"), /Run `git config --get remote\.origin\.url` and compare it to the fingerprint/);
  assert.match(flat("skills/closeout/SKILL.md"), /run `git config --get remote\.origin\.url` and/);
  assert.match(flat("templates/AGENTS.md.tmpl"), /`git config --get remote\.origin\.url` → `\{\{REMOTE_URL\}\}`/);
  assert.equal((read("templates/BINDINGS.md.tmpl").match(/git -C \{\{REPO_ROOT_PATH\}\} config --get remote\.origin\.url && git -C \{\{REPO_ROOT_PATH\}\} branch --show-current/g) || []).length, 1);
  const claude = read("templates/CLAUDE.md.tmpl");
  assert.match(claude, /`git -C <path> config --get remote\.origin\.url` and read it\./);
  assert.match(claude, /`git -C \{\{REPO_ROOT_PATH\}\} config --get remote\.origin\.url && git -C \{\{REPO_ROOT_PATH\}\} branch --show-current`/);
});

test("REVIEW says the runner drops the Gemini log and declared reviewRecordPaths, and that this is not certification", () => {
  const r = flat("core/REVIEW.md");
  assert.match(r, /The Gemini runner omits its own log and the adopter-declared `reviewRecordPaths` records from its frozen tree \(a path in the candidate diff stays\); that narrows the leak, certifies nothing, and the `pre-loaded` residual stands\./);
});

test("the README note says what changed, why, and what adopters byte-copy versus hand-edit", () => {
  const r = flat("README.md");
  const n = r.slice(r.indexOf("## What's new in v2.45.0"), r.indexOf("## What's new in v2.44.2"));
  assert.ok(n.length > 1500, "the v2.45.0 note sits above v2.44.2's");
  assert.match(n, /`reviewRecordPaths` in `\.claude\/kit\.config\.json`/);
  assert.match(n, /`reason` mandatory/);
  assert.match(n, /Byte-copy `scripts\/cold-review-gemini\.sh`/);
  assert.match(n, /Hand-edit the adopted `CLAUDE\.md`, `AGENTS\.md` and `BINDINGS\.md` copies and the ID card/);
  assert.match(n, /`init` does not write the key/);
});

test("version is 2.45.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.45.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.45.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.45\.0$/m);
});
