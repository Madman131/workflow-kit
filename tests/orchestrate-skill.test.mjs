// tests/orchestrate-skill.test.mjs — the /orchestrate skill (v2.3).
//
// WHAT IS WORTH PINNING HERE, and what is not. The skill is DOCTRINE: it ships no code, and no
// control enforces a word of it. So these tests do not pretend to verify behaviour. They pin the
// two properties that CAN fail silently:
//
//   (1) THE LOAD-BEARING CORRECTIONS STAY IN THE BODY. `core/ARTIFACT_CLASS.md` prefers splitting an
//       over-budget body into a reference layer — but a correction of a FALSE or dangerous default
//       may never move to a layer the executor might not load. `/orchestrate` sits one word under
//       its budget, so the next edit is under pressure to displace something; these assertions say
//       WHICH sentences may not be the thing displaced.
//   (2) THE SHIPPED ENUMERATIONS AGREE WITH THE SHIPPED TREE. A skill added to `skills/` while
//       `PORTABILITY.md`'s `[P]` list is left alone makes the doc lie about the artifact — the
//       failure found on this release (`/sweep` shipped in v2.2.0 and was never added to that list).
//
// EVERY PIN IS SELF-CANARIED. A doc-pinning assertion is decoration when its spelling occurs
// innocently elsewhere in scope: two of five such assertions on an earlier release were dead on
// their first cut and were caught only by striking the exact phrase. So each pin below is run a
// second time against a copy of the file with THAT EXACT PHRASE removed, and the test fails unless
// the removal turns it red. A pin that cannot be reddened is reported as DEAD, not as passing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BODY = path.join(KIT, "skills", "orchestrate", "SKILL.md");

// Whitespace-flatten before matching: a phrase that WRAPS a line is present to a reader and absent
// to a naive substring search, which produces a false RED here and (worse) a false "already fixed"
// when the same technique is used to check a repair.
const flat = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Assert `phrase` is present in `text`, then PROVE the assertion is live by deleting that exact
 * phrase and requiring the same predicate to fail. `label` names what the sentence protects.
 */
function pin(text, phrase, label) {
  const present = flat(text).includes(flat(phrase));
  assert.ok(present, `${label}: the body must state — "${phrase}"`);
  // The canary. Strike the FIRST occurrence only — striking every occurrence would leave the
  // predicate false no matter what, which is a canary that can never fire (this helper shipped
  // that way for one draft). If the phrase still matches after one strike it occurs elsewhere in
  // scope, so deleting the load-bearing sentence would NOT redden the assertion: a dead pin.
  const struck = flat(text).replace(flat(phrase), " ");
  assert.equal(struck.includes(flat(phrase)), false,
    `${label}: DEAD PIN — the phrase occurs more than once in scope, so striking the sentence this ` +
    `assertion exists to protect would leave it green. Pin a longer, unique sentence.`);
}

// ── (1) the corrections that may not be displaced into a reference layer ────────────────────────

test("the GO discipline is stated IN THE BODY — who gives it, and when it goes stale", () => {
  const body = readFileSync(BODY, "utf8");
  // The single most expensive thing to get wrong: a worker that merges on anyone else's word, or
  // on a GO given for an earlier head. Both halves are corrections of a plausible default, so both
  // stay in the executor-loaded body.
  pin(body, "**The GO is the Owner's alone**", "GO ownership");
  pin(body, "a direct Owner\ninstruction outranks any routing preference", "Owner-direct-to-worker");
  pin(body, "**A GO ratifies a specific artifact:**", "stale-GO discipline");
  pin(body, "the GO\nis void until re-confirmed on the new head", "stale-GO consequence");
  pin(body, "Pin heads by **SHA**, never by branch name", "SHA-not-branch");
});

test("the sole-writer check names the ARTIFACT it reads, not the convenient one", () => {
  const body = readFileSync(BODY, "utf8");
  // A session list is the thing an agent reaches for first and it answers a different question.
  // A repo was two-writer while a session-list check reported it clear.
  pin(body, "lane declarations**", "lane declarations named");
  pin(body, "never a list of sessions,\nwhich reports liveness, not intent", "session list refused");
  // The check was originally described as PROVING sole-writership. It cannot: reading declarations
  // finds writers who DECLARED, and an undeclared lane is exactly the one that is invisible. The
  // kit's own MULTI_AGENT.md says neither reader binds the task and a stale declaration can be
  // refreshed, so "proof" was unsupportable in the doctrine the body cites two lines above.
  pin(body, "**This finds DECLARED writers\nonly**", "declared-only, not proof");
  pin(body, "Unsure ⇒ fail closed", "fail closed when unclear");
});

test("the honest limits stay in the body — the method/plumbing split and the named degraded mode", () => {
  const body = readFileSync(BODY, "utf8");
  // An adopter reading only the body must not conclude the kit ships chips or messaging.
  pin(body, "**The METHOD is portable; the PLUMBING is not.**", "method/plumbing split");
  pin(body, "harness features this kit does not ship and must not assume", "no-assumed-plumbing");
  pin(body, "**Degraded mode", "degraded mode named");
  pin(body, "The ROLE SPLIT survives intact", "what survives");
  pin(body, "what degrades is LATENCY", "what degrades");
  // The claim was originally "a shared record, which loses nothing essential" — an unverifiable
  // guarantee, since the kit ships no shared-record implementation and no atomicity rules for two
  // writers appending to one file. The narrowed form hands that duty to the reader, and THAT is
  // what must not quietly revert to a promise.
  pin(body, "**Integrity of the shared file is yours to provide**", "record integrity is the reader's");
});

test("the body admits that none of it is enforced", () => {
  const body = readFileSync(BODY, "utf8");
  // The kit's recurring shipped defect is prose claiming enforcement the machinery does not do.
  // This skill enforces NOTHING, and the sentence saying so is load-bearing.
  pin(body, "**Nothing on this page is enforced.**", "enforcement honesty");
  // This sentence originally read "The two things the kit does enforce are the task-lane
  // declaration and the commit floor" — which contradicts the kit's own PORTABILITY.md, where the
  // write guard is inert in the Codex lane until a human grants hook trust, and the commit floor is
  // absent on a fresh clone until `core.hooksPath` is set and is bypassable with `--no-verify`.
  // "Ships controls for" is the supportable verb; the pointer to the limits is the load-bearing half.
  pin(body, "The kit ships controls for the declaration and the commit\nfloor", "what IS shipped");
  pin(body, "fresh-clone and bypass limits are in `PORTABILITY.md`", "limits are pointed at");
});

test("the freeze rule is stated as panel-enforced, not as an intention", () => {
  const body = readFileSync(BODY, "utf8");
  pin(body, "Freeze compliance is checked by the panel, never promised by the author",
    "freeze is panel-enforced");
});

test("the escalation rule stays in the body — it is a rule, not rationale that may be displaced", () => {
  // This clause was DELETED, not moved, during a budget-driven cut, and the commit message for that
  // cut described it as a displacement to the reference layer. It bounds when a seat may be run
  // hotter than the default, so it is an anti-arbitrary-escalation RULE: the reference-layer rule
  // forbids moving it to a layer the executor might not load, and deleting it is worse than moving.
  const body = readFileSync(BODY, "utf8");
  pin(body, "**evidence\n   escalates them, appetite does not.**", "evidence not appetite");
});

test("the README/PORTABILITY mirrors carry no claim the body has already retracted", () => {
  // WHY THIS EXISTS — it is the finding of record for this release. The same doctrine is narrated on
  // FOUR surfaces (SKILL.md, CHIP_BRIEF.md, README.md, PORTABILITY.md) and nothing bound them, so
  // every correction had to be hand-propagated to three other places. It was missed three times in
  // three rounds: "proves it is the sole writer" survived in CHIP_BRIEF after the body was fixed,
  // and the chip/session identity survived in the README after the body dropped it. Each was found
  // by a review seat, never by the suite. These are cheap NEGATIVE assertions on the retracted
  // spellings — they cannot prove the surfaces agree in general, only that the specific claims this
  // release retracted stay retracted everywhere.
  // SCOPED TO THE SECTION, not the whole file. The first cut searched README.md entire and fired on
  // a pre-existing /thread-restart sentence that happens to spell "loses nothing essential" — a
  // guard against a false CLEAR minting a false FAIL, matching a spelling rather than a claim. A
  // section that cannot be located is a hard failure, never a silently empty search.
  const section = (text, start, end, label) => {
    const from = text.indexOf(start);
    assert.notEqual(from, -1, `${label}: could not locate "${start}" — re-point this test`);
    const rest = text.slice(from + start.length);
    const to = end ? rest.indexOf(end) : -1;
    const body = to === -1 ? rest : rest.slice(0, to);
    assert.ok(body.trim().length > 200, `${label}: located section is suspiciously short — re-point this test`);
    return body;
  };
  const readme = readFileSync(path.join(KIT, "README.md"), "utf8");
  const portability = readFileSync(path.join(KIT, "PORTABILITY.md"), "utf8");
  const surfaces = {
    "README.md § v2.3.0": section(readme, "# workflow-kit — v2.3.0", "# workflow-kit — v2.2.1", "README"),
    "PORTABILITY.md § /orchestrate": section(portability, "## `/orchestrate` (v2.3)", "\n## ", "PORTABILITY"),
    "skills/orchestrate/SKILL.md": readFileSync(BODY, "utf8"),
    "skills/orchestrate/CHIP_BRIEF.md": readFileSync(path.join(KIT, "skills", "orchestrate", "CHIP_BRIEF.md"), "utf8"),
  };
  const retracted = [
    [/prove[sd]?\s+it\s+is\s+the\s+sole\s+writer/i, "reading lane declarations PROVES sole-writership (it finds declared writers only)"],
    [/sole-writer proof/i, "calling the sole-writer check a PROOF"],
    [/one version\s*=\s*one session/i, "the chip/session identity asserted in BOTH directions"],
    [/loses nothing essential/i, "the degraded mode GUARANTEEING nothing essential is lost"],
    [/two (?:real )?controls (?:are|remain)/i, "naming two things the kit ENFORCES rather than ships controls for"],
  ];
  for (const [file, text] of Object.entries(surfaces)) {
    for (const [re, what] of retracted) {
      assert.doesNotMatch(text, re,
        `${file} still carries a claim this release retracted — ${what}. A correction that lands on ` +
        `one surface and not its mirrors leaves the old claim shipping.`);
    }
  }
  // The canary: these assertions are worthless if the patterns match nothing anywhere. Prove each
  // one still BITES by running it against text that does contain the retracted spelling.
  const decoys = ["a chip proves it is the sole writer by reading", "the sole-writer proof (lane declarations)",
    "one chip = one changeset = one version = one session", "a shared record, which loses nothing essential",
    "the kit's two real controls are still the task-lane declaration"];
  for (const [i, [re, what]] of retracted.entries()) {
    assert.match(decoys[i], re, `the pattern for "${what}" must still match its own retracted spelling`);
  }
});

// ── (2) the reference layers, and the enumerations that must agree with the tree ────────────────

test("both reference layers are named by the body and declare their own budgets", () => {
  const body = readFileSync(BODY, "utf8");
  for (const sibling of ["CHIP_BRIEF.md", "PROTOCOLS.md"]) {
    // Scoped to the LOADABLE PATH, not the bare filename. The body names each sibling twice — once
    // in the budget line, once in the pointer — so `includes("CHIP_BRIEF.md")` stays true after the
    // pointer is deleted, which is the mention surviving while the instruction to load it is gone.
    // (Found by mutation: the bare-filename form survived exactly that strike.) The budget
    // checker's generic reachability rule has the same shape; this is the tighter local pin.
    assert.ok(body.includes(`.agents/skills/orchestrate/${sibling}`),
      `the body must point at .agents/skills/orchestrate/${sibling} — a bare mention is not an instruction to load it`);
    const layer = readFileSync(path.join(KIT, "skills", "orchestrate", sibling), "utf8");
    assert.match(layer, /^Word budget: \d+/m, `${sibling} declares its own budget`);
  }
});

test("the corrections inside CHIP_BRIEF are pinned too — a reference layer can carry the old lie", () => {
  // The failure this exists to stop, and it happened here: the sole-writer over-claim was fixed in
  // the body and in the README while CHIP_BRIEF.md went on saying "the sole-writer proof". Fixing a
  // claim in one place and leaving its twin standing is the recurring shape; the layer that briefs
  // every worker is the worst place to leave it.
  const brief = readFileSync(path.join(KIT, "skills", "orchestrate", "CHIP_BRIEF.md"), "utf8");
  pin(brief, "the sole-writer CHECK, never called a proof", "brief calls it a check");
  pin(brief, "**An unacknowledged brief is unconfirmed, not undelivered**", "unacknowledged ≠ undelivered");
  assert.doesNotMatch(brief, /sole-writer proof/,
    "CHIP_BRIEF must not call the sole-writer check a PROOF — the body says it is not one");
});

test("PORTABILITY's [P] enumeration names EVERY shipped skill — a doc that omits one lies about the tree", () => {
  // The failure this exists to stop, executed on this release: `/sweep` shipped in v2.2.0 and the
  // `[P]` list was never updated, so the adopter-facing inventory of what gets copied verbatim was
  // wrong for a whole release. Adding a skill is exactly when nobody re-reads that line.
  const portability = readFileSync(path.join(KIT, "PORTABILITY.md"), "utf8");
  // Parse the SKILL LIST ITSELF, not a broad slice of the [P] bullet. An earlier cut matched from
  // the `[P]` phrase through the next `[G]` item and then searched that whole range for names —
  // so a reshaped or emptied skill list stayed green as long as the names appeared ANYWHERE in
  // between (the guards, sensors and runners are enumerated in that same range). Anchor on the
  // parenthesised list that follows the `skill-shims/*` mention and read only its `/name` tokens.
  // Anchor inside the [P] BULLET, not on the first `skill-shims/*` text anywhere in the file: an
  // unanchored match could bind to a decoy list elsewhere and stay green after the real inventory
  // was reshaped or removed. Bound the search to the [P] item, then find the list within it.
  const flatText = portability.replace(/\s+/g, " ");
  const pBullet = /`\[P\]` \(verbatim\):(.*?)- `\[G\]`/.exec(flatText);
  assert.ok(pBullet, "the [P] bullet must be findable — its shape changed, re-point this test");
  const listed = /`skill-shims\/\*`\s*\(([^)]*)\)/.exec(pBullet[1]);
  assert.ok(listed, "the skills enumeration must sit INSIDE the [P] bullet — re-point this test");
  const named = new Set([...listed[1].matchAll(/`\/([A-Za-z0-9._-]+)`/g)].map((m) => m[1]));
  assert.ok(named.size >= 7, `the parsed list must be non-empty and plural — parsed ${named.size}`);
  const shipped = execFileSync("ls", [path.join(KIT, "skills")], { encoding: "utf8" }).trim().split("\n");
  assert.ok(shipped.length >= 7, `sanity: expected the shipped skills to be discovered, got ${shipped.length}`);
  for (const name of shipped) {
    assert.ok(named.has(name),
      `PORTABILITY.md's [P] skill list must name /${name} — it ships verbatim to every adopter ` +
      `(parsed: ${[...named].join(", ")})`);
  }
});

// ── (3) the skill actually installs into an adopter, both lanes ─────────────────────────────────

test("a fresh adopt lands the /orchestrate body and BOTH lane shims, and every pointer resolves", () => {
  // Presence and registration are the two lies this program shipped one release apart, so the
  // assertion is not "the file exists" alone: every body reference in every installed shim must
  // resolve ON DISK IN THE ADOPTER, which is where the path is different from the kit tree.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-orch-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-orch-cx-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--codex-prompts-dir", codexDir], { stdio: "ignore" });

    const body = path.join(dir, ".agents", "skills", "orchestrate", "SKILL.md");
    const claudeShim = path.join(dir, ".claude", "skills", "orchestrate", "SKILL.md");
    const codexShim = path.join(codexDir, "orchestrate.md");
    for (const [label, p] of [["shared body", body], ["Claude shim", claudeShim], ["Codex prompt", codexShim]]) {
      assert.ok(existsSync(p), `${label} installed at ${p}`);
    }
    // Both reference layers travel with the body — a shipped pointer to an uninstalled file is a
    // dead end in the adopter even though it resolves in the kit tree.
    for (const sibling of ["CHIP_BRIEF.md", "PROTOCOLS.md"]) {
      assert.ok(existsSync(path.join(dir, ".agents", "skills", "orchestrate", sibling)),
        `${sibling} installs beside the body (the body points at it)`);
    }
    assert.match(readFileSync(claudeShim, "utf8"), /^---\n/, "Claude shim opens with YAML frontmatter");
    assert.match(readFileSync(codexShim, "utf8"), /^# /, "Codex prompt opens with a markdown H1");
    for (const shim of [claudeShim, codexShim]) {
      const text = readFileSync(shim, "utf8");
      const refs = [...text.matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
      assert.ok(refs.length > 0, `${shim} names a shared body`);
      for (const [, skill, file] of refs) {
        assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
          `${shim}: .agents/skills/${skill}/${file} resolves in the ADOPTER`);
      }
      assert.doesNotMatch(text, /Word budget/, `${shim} carries no rules of its own`);
    }
    // The installed body is the governed artifact, and the corrections must survive the copy: an
    // install that silently truncated or templated the file would still pass an existence check.
    const installed = readFileSync(body, "utf8");
    assert.equal(installed, readFileSync(BODY, "utf8"), "the installed body is byte-identical to the kit's");
    pin(installed, "**The GO is the Owner's alone**", "installed body keeps the GO rule");
    pin(installed, "**Nothing on this page is enforced.**", "installed body keeps the enforcement honesty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
});

// ── (4) the canary's own canary ─────────────────────────────────────────────────────────────────

test("the pin helper reports a DEAD pin instead of passing it", () => {
  // The countermeasure only works if `pin` actually fails on a phrase it cannot redden. Proven
  // with a phrase that appears TWICE — the exact shape that made two real assertions decorative.
  assert.throws(
    () => pin("alpha REPEATED beta REPEATED gamma", "REPEATED", "self-test"),
    /DEAD PIN/,
    "a phrase occurring twice must be reported as a dead pin, not silently passed",
  );
  // …and the healthy direction still passes, so the helper is not simply always-throwing.
  assert.doesNotThrow(() => pin("alpha UNIQUE beta", "UNIQUE", "self-test"));
  // A phrase that is ABSENT fails as a missing pin, not as a dead one.
  assert.throws(() => pin("alpha beta", "MISSING", "self-test"), /must state/);
});
