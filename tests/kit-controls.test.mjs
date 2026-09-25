// workflow-kit — the kit's CONTROL suite: one of the two rungs `npm test` runs (the other is the
// budget gate; `scripts/run-checks.mjs` runs both and combines their exit codes). It (1) runs the
// full plant-the-bug acceptance harness and asserts it passes, (2) unit-tests the fail-closed
// config loader, and (3) proves the portable FM1 test itself discriminates (goes RED when
// core.hooksPath is unset).
// The init, lane and skills parts of the suite live in tests/kit-controls-{init,lane,skills}.test.mjs.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { adopt } from "./kit-controls-helpers.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ROLE_CAPS } = await import(new URL("../scripts/check-doc-size.mjs", import.meta.url).href);
// The method cap, spelled either way round, with the cap-word vocabulary this repo actually uses.
// `[^.\n]{0,60}` keeps the two halves inside one sentence so an unrelated KiB figure two sentences
// away cannot pair with the word "cap" and produce a phantom offender.
const CAP_WORD = "(?:cap|limit|ceiling|budget|maximum|max|allowance|allocation)";
const CAP_BEFORE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*KiB[^.\\n]{0,60}?(?:BINDING-)?method\\s*${CAP_WORD}`, "gi");
const CAP_AFTER = new RegExp(`(?:BINDING-)?method\\s*${CAP_WORD}[^.\\n]{0,60}?(\\d+(?:\\.\\d+)?)\\s*KiB`, "gi");

// A nested `node --test` inherits the parent runner's env (NODE_TEST_CONTEXT / NODE_OPTIONS) and then
// reports up over IPC instead of exiting non-zero — so a failing inner run would look green. Strip
// those so the child's own exit code is trustworthy.
function cleanTestEnv() {
  const e = { ...process.env };
  delete e.NODE_OPTIONS;
  for (const k of Object.keys(e)) if (k.startsWith("NODE_TEST")) delete e[k];
  return e;
}

test("acceptance/plant-the-bug.sh passes — every control observed both blocking and permitting", () => {
  const r = spawnSync("bash", [path.join(KIT, "acceptance", "plant-the-bug.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, `acceptance harness failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ACCEPTANCE PASSED/);
});

test("check-doc-size loadKitConfig is fail-closed: absent -> defaults, malformed -> not ok", async () => {
  const { loadKitConfig } = await import(path.join(KIT, "scripts", "check-doc-size.mjs"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-cfg-"));
  try {
    // absent config -> ok with empty repo-specific families
    let c = loadKitConfig(dir);
    assert.equal(c.ok, true);
    assert.deepEqual(c.stateDocs, []);
    assert.equal(c.memoryDir, null);
    // malformed config -> NOT ok (fail closed)
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), "NOT JSON{");
    c = loadKitConfig(dir);
    assert.equal(c.ok, false, "a malformed config must be reported not-ok (fail closed)");
    // wrong-typed field -> NOT ok
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ stateDocs: "nope" }));
    assert.equal(loadKitConfig(dir).ok, false, "a wrong-typed stateDocs must be not-ok");
    // valid partial config -> ok
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ stateDocs: ["docs/s.md"] }));
    c = loadKitConfig(dir);
    assert.equal(c.ok, true);
    assert.deepEqual(c.stateDocs, ["docs/s.md"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init generates core/OWNER_COMMS.md as [G]; --owner-name fills only the name", () => {
  const plain = adopt();
  try {
    const doc = path.join(plain.dir, "core", "OWNER_COMMS.md");
    assert.ok(existsSync(doc), "core/OWNER_COMMS.md is generated");
    const text = readFileSync(doc, "utf8");
    assert.match(text, /CLASS: BINDING/, "declares CLASS: BINDING so check-doc-size governs it automatically");
    assert.match(text, /\{\{OWNER_NAME\}\}/, "without --owner-name the placeholder stays (sensor dormant)");
    // The kit must NEVER ship a concrete Owner: [G] means generated, never copied.
    assert.ok(!existsSync(path.join(KIT, "core", "OWNER_COMMS.md")),
      "the kit itself must not ship a concrete core/OWNER_COMMS.md — it names a person ([G])");
  } finally { plain.cleanup(); }

  const named = adopt(["--owner-name", "Alex"]);
  try {
    const text = readFileSync(path.join(named.dir, "core", "OWNER_COMMS.md"), "utf8");
    assert.match(text, /^## How to talk to Alex — Owner, not a developer$/m, "--owner-name fills the heading the sensor parses");
    // The three judgment-call placeholders are deliberately LEFT for the adopter.
    for (const tok of ["OWNER_PROFILE", "IRREVERSIBLE_ASSET", "OWNER_SHORTHAND"]) {
      assert.match(text, new RegExp(`\\{\\{${tok}\\}\\}`), `{{${tok}}} is left for manual completion`);
    }
  } finally { named.cleanup(); }
});

test("rules 8 and 9 ship in the GENERATED Owner contract and in the INSTALLED /humanize body", () => {
  // Read what an ADOPTER gets, never the template: a rule that survives in templates/ and dies in
  // generation is the failure this whole [G] path can have, and grepping the source would miss it.
  const named = adopt(["--owner-name", "Alex"]);
  try {
    const doc = readFileSync(path.join(named.dir, "core", "OWNER_COMMS.md"), "utf8");
    // Whitespace-FLATTENED for the clause pins below: every one of these rules wraps across lines in
    // the shipped file, so an unflattened pin would be pinning typography and would go red on a
    // reflow that changed no rule. (Same reasoning as tests/gating-doctrine.test.mjs's `read`.)
    const flat = doc.replace(/\s+/g, " ");
    const rule8 = /^8\. \*\*Questions and recommendations never blend in\.\*\*([\s\S]*?)(?=^9\. )/m.exec(doc);
    assert.ok(rule8, "the generated contract carries rule 8");
    for (const lead of ["**QUESTION:**", "**RECOMMENDATION:**", "**DECISION NEEDED:**"]) {
      assert.ok(rule8[0].includes(lead), `rule 8 names the ${lead} lead verbatim — the label IS the rule`);
    }

    // ---- rule 9 (v2.6.0): brevity and structure as a STANDING default, not a permission.
    // WHY EACH PIN IS THE SENTENCE AND NOT A WORD: "bullet", "table" and "structure" all occur
    // innocently elsewhere in this contract (rule 1 points at rule 9; rule 7 points at BULLET.md),
    // so a word-level pin would pass against a document that had lost rule 9 entirely.
    const rule9 = /^9\. \*\*A wall of text is a defect, not thoroughness\.\*\*([\s\S]*?)(?=\n\n)/m.exec(doc);
    assert.ok(rule9, "the generated contract carries rule 9");
    const rule9flat = rule9[0].replace(/\s+/g, " ");
    assert.match(rule9flat, /Structure is the DEFAULT, not a favour you do them when the news is complicated/,
      "rule 9 states structure as the DEFAULT — a permission ('whenever they help') is the thing it replaces");
    assert.match(rule9flat, /a message past roughly \*\*200 words\*\* with \*\*no bullet and no table\*\* in it is not finished/,
      "…and names the observable condition, or it is a sentiment rather than a rule");
    // WORDS, NOT LINES. A line-measured floor is cleared by wrapping rather than by structuring:
    // three 200-word lines are a 600-word wall that satisfies "past a few lines" trivially. The unit
    // is the rule here — a display-dependent trigger is not an observable condition at all.
    assert.match(rule9flat, /Words, not lines: three 200-word lines are a 600-word wall/,
      "…and says why the unit is words, so the display-dependent form cannot come back");
    assert.doesNotMatch(rule9flat, /past a few lines/,
      "the display-dependent trigger is gone, not merely supplemented");
    // A HEADING MUST NOT SATISFY IT. A heading is decoration: a 700-word wall opening with
    // "## Update" carries one, would satisfy a condition that accepted headings, and is still a
    // wall. Decorative structure is the common case, so a condition that accepts it is a binary
    // whose common case is neither branch.
    assert.match(rule9flat, /\*\*a heading does not count, and neither does a single bullet\.\*\*/,
      "rule 9 excludes decorative structure — the walk-through case that killed its first version");
    // AND IT MUST DECLARE ITSELF A FLOOR. Prose cannot add a missing state: no countable condition
    // is sufficient for "is this a wall", so a rule that implies its condition IS sufficient is
    // making the over-claim this release exists to refuse. Pinning the disclaimer is what stops a
    // later edit from quietly promoting the floor back into a test.
    assert.match(rule9flat, /\*\*Clearing the floor is not proof the message is not a wall\.\*\*/,
      "rule 9 states that its own condition is not sufficient");
    assert.match(rule9flat, /That judgment stays yours/,
      "…and says where the judgment actually lives");
    // Rule 9 no longer NAMES the Owner: the clause that did ("Keep what {{OWNER_NAME}} must know or
    // act on now") duplicated rule 1 and was cut by the subtractive leg. The name-substitution
    // property is positively pinned in the preamble assertion above. What is pinned HERE is that
    // whatever placeholders rule 9 does or does not use, none may reach an adopter
    // unsubstituted — a rule shipping "{{OWNER_NAME}}" addresses nobody.
    assert.ok(!rule9flat.includes("{{"),
      "rule 9 carries no unsubstituted {{placeholder}} in the generated contract");
    // Rule 9 must POINT at the conversion procedure, never carry it: BULLET.md is a reference layer
    // loaded only when `/humanize bullet` fires, and rule 7 says in terms "Do not restate those
    // rules here". A rule 9 that inlined the four conversion categories would put the kit's own
    // duplication rule in violation the day it shipped.
    assert.match(rule9flat, /`\.agents\/skills\/humanize\/BULLET\.md` \(rule 7\) — loaded on demand, and not restated here/,
      "rule 9 points at BULLET.md and disclaims restating it");
    // ⚠ WHAT THIS ASSERTION DOES AND DOES NOT PROVE — do not read it as covering rule 7.
    // It rejects three LITERAL fragments of BULLET.md and cannot see a paraphrase. Conversion-
    // direction prose in rule 9 — phrasings like "offer the rest" or "put any ask where skimming
    // finds it" — would restate BULLET.md while passing this check, even as the rule claims at its
    // own tail to be "not restated here". Such clauses are kept OUT of rule 9, and the gap in the
    // checker stays: **whether rule 9
    // paraphrases BULLET.md is a REVIEWER's judgment, and no assertion here discharges it.**
    // "not restated here" in the rule is a directive to a future editor, never a proven property.
    assert.doesNotMatch(rule9flat, /set of two or more|a \*\*comparison\*\*|Never invent a cell/,
      "rule 9 does not copy BULLET.md's conversion rules VERBATIM — literal check only, paraphrase is unproven");

    // ---- the two clauses that were READ AS LICENSING LENGTH. These are the half of this change
    // that has no new text to find: the defect was existing sentences, so the only way to pin the
    // fix is to pin BOTH the new wording's presence AND the old wording's absence. A presence-only
    // pin passes against a document carrying both readings at once, which is the state the Owner
    // actually met.
    assert.match(flat, /completeness is a property of the work, not the word count \(`core\/OPERATE\.md` § closeout\), \*\*which licenses the SWEEP and never the REPORT\.\*\*/,
      "rule 1's completeness clause is scoped to the sweep, so it cannot be read as licensing a long report");
    assert.match(flat, /Being understood beats being TERSE — but length is not what makes you understood/,
      "rule 6 keeps 'do not sacrifice clarity' while denying that length delivers it");
    // A trailing "— cut words, never facts" is deliberately absent: it repeats rule 1's reporting
    // constraint ("Offer the detail… but a RISK, BLOCKER… is never 'detail'"). The load-bearing
    // half is the licence denial, which is what stays pinned.
    assert.match(flat, /\*\*Neither half is a licence to write more\.\*\*/,
      "…and says so in terms, because the old closing clause is what the length grew under");
    assert.doesNotMatch(flat, /Being understood beats being brief/,
      "the superseded wording is GONE — the sentence the length grew under cannot survive alongside its own fix");
    assert.doesNotMatch(flat, /Bullets and tables whenever they help/,
      "…and so is the permissive spelling rule 9 replaces");
    assert.match(flat, /\*\*Bullets and tables by default \(rule 9\)\.\*\*/,
      "rule 1 now POINTS at rule 9 rather than restating or permitting");

    // ---- the scope statement. The measured lapse was that the rules were honoured in formal
    // reports and dropped in chat replies, so "which messages does this bind" was the load-bearing
    // gap — it is pinned in the PREAMBLE, above rule 1, where a reader meets it before any rule.
    const preamble = doc.slice(0, doc.search(/^1\. \*\*Answer first/m));
    assert.match(preamble.replace(/\s+/g, " "),
      /\*\*Every rule below binds every message Alex reads — an ordinary chat reply exactly as much as a formal report, a status update or a hand-off\.\*\*/,
      "the contract states that it binds chat replies, and states it BEFORE rule 1");

    assert.doesNotMatch(doc, /^10\. /m, "the rules stop at 9 — a duplicate would renumber silently");
    // The labels alone are not the rule. Pin both the nonauthorization bullet shape and the
    // authorization block order so neither can disappear while the labels remain.
    assert.match(rule8[0], /bold, standalone bulleted line led by/,
      "other questions and decisions still require a bold standalone bullet");
    assert.match(rule8[0], /\*\*AUTHORIZATION NEEDED\*\*[\s\S]*?\*\*Rule #1:\*\*[\s\S]*?\*\*KISS \/ Root cause:\*\*[\s\S]*?\*\*Zoom Out:\*\*[\s\S]*?\*\*My recommendation:/,
      "rule 8 states the authorization request shape, not only the labels");

    // The count sweep, made mechanical on the GENERATED side: the claim in the release note is that
    // no artifact an adopter receives states a rule TOTAL, so a later edit that reintroduces one
    // (in the contract or in the skill that repairs against it) must go red here, not in review.
    // A detector must OVER-trigger relative to the thing it warns about, or it is decoration. The
    // first cut matched "eight rules" and "rules 1-8" and sailed past "eight numbered rules",
    // "rules 1 through 8" and "rules 1 to 8" — all three. It allows up to two words
    // between the number and "rules", and spells the range separators out. It is still a blacklist
    // of spellings, not a proof: a genuinely novel phrasing of a total would pass, and the sweep in
    // the release note is what covers that.
    const COUNT_CLAIM = /\b(six|seven|eight|nine|ten|\d+)\s+(?:\w+\s+){0,2}rules\b|\brules\s*1\s*(?:[-–—]|through|thru|to)\s*\d/i;
    for (const rel of [["core", "OWNER_COMMS.md"], [".agents", "skills", "humanize", "SKILL.md"],
      [".agents", "skills", "humanize", "BULLET.md"]]) {
      const generated = readFileSync(path.join(named.dir, ...rel), "utf8");
      assert.doesNotMatch(generated, COUNT_CLAIM,
        `${path.join(...rel)} states no rule TOTAL — a count is what goes stale when a rule is added`);
    }

    // The skill that repairs a message against these rules must know about the new one, or /humanize
    // certifies as clean a message rule 8 rejects. The SAME obligation is what makes rule 9's entry
    // below non-optional rather than a nicety: the repair pass is the only place an agent re-reads
    // these rules after the fact, so a rule missing from the miss list is a rule /humanize clears.
    const skill = readFileSync(path.join(named.dir, ".agents", "skills", "humanize", "SKILL.md"), "utf8");
    assert.match(skill, /buried ask/, "the /humanize miss list checks for a buried ask");
    assert.match(skill, /\(rule 8\)/, "…and points at the rule it comes from");
    assert.match(skill.replace(/\s+/g, " "), /- \*\*A wall of text\*\* — long, with no bullet or table \(rule 9\)\./,
      "the miss list carries rule 9, or /humanize clears the message rule 9 rejects");
    assert.match(skill.replace(/\s+/g, " "),
      /re-read a sentence, look up a word, or meet a paragraph block where a list belonged\?/,
      "…and the closing check tests for it too, which is the gate the whole pass ends on");
  } finally { named.cleanup(); }
});

test("guard-owner-comms is a FAIL-OPEN sensor: dormant until named, then it discriminates", () => {
  const { dir, cleanup } = adopt(["--owner-name", "Alex"]);
  try {
    const hook = path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs");
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const transcript = path.join(dir, "transcript.jsonl");
    // Complete the contract as an adopter must: real shorthand rows OUTSIDE the template's example
    // fence. Until this is done the sensor knows no question tokens — see the dedicated test below.
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`AR` = archive ready? — is this thread closed out on the remote.\n`MIS` = make it so — proceed on the agreed scope."));
    // `entries` lets a case build an arbitrary transcript (sidechain flags, content blocks); the
    // 2-arg form is the common case. Both suites previously only ever produced the simple shape,
    // which is why several real branches were never exercised in either direction.
    const write = (user, assistantText) => writeEntries([
      { type: "user", message: { role: "user", content: user } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: assistantText }] } },
    ]);
    const writeEntries = (entries) => writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const run = (extra = {}, env = {}) => spawnSync("node", [hook], {
      cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript, ...extra }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    });
    // A CRASH is not an "allow". Mapping any non-block output to allow would let a hook that threw
    // on every input satisfy every fail-open assertion below, so exit status is checked explicitly.
    const decide = (extra = {}, env = {}) => {
      const r = run(extra, env);
      assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
      return r.stdout.includes('"decision":"block"') ? "block" : "allow";
    };
    const LONG = "word ".repeat(400);

    // --- SIZE MISMATCH, both directions ---
    write("AR", LONG);
    assert.equal(decide(), "block", "a declared shorthand QUESTION (gloss ends in '?') over-answered is flagged");
    write("AR", "Yes — closed out and verified on the remote.");
    assert.equal(decide(), "allow", "the same question answered briefly passes (no over-block)");
    write("MIS", LONG);
    assert.equal(decide(), "allow", "MIS is an INSTRUCTION (no '?' in its gloss) — a long work report is fine");
    write("ready to ship?", LONG);
    assert.equal(decide(), "block", "a short yes/no question answered at length is flagged");
    // An explicit REQUEST FOR DETAIL is not over-answered by giving the detail. Blocking it would tell
    // the agent to withhold exactly what the Owner asked for — the sensor working against rule 1.
    for (const q of ["can you give me the full inventory?", "can you give me the details?", "walk me through it?"]) {
      write(q, LONG);
      assert.equal(decide(), "allow", `"${q}" asks FOR detail — answering at length is correct`);
    }
    // …but that exemption must be PHRASES, not bare quantifiers. These are ordinary yes/no questions
    // that merely contain a word like "all" or "summary"; exempting them would silently delete the
    // check for a large class of exactly the questions it exists to protect.
    // The exemption keys on the Owner ASKING for elaboration, never on the topic merely sounding
    // detailed — a noun-phrase list exempted the last two of these.
    for (const q of ["Are all tests passing?", "Is the summary ready?", "Did every check pass?",
      "Are the details correct?", "Is the full report ready?"]) {
      write(q, LONG);
      assert.equal(decide(), "block", `"${q}" is a yes/no question, not a request for elaboration`);
    }

    // --- NARRATION, both directions ---
    write("what changed?", "Let me check the config and report back.");
    assert.equal(decide(), "block", "narration in the FINAL message is flagged");
    // Markdown furniture must not change the verdict — bulleted narration is still narration.
    for (const shape of ["- Let me check the config.", "1. Let me check the config.", "**Let me check the config** now."]) {
      write("what changed?", shape);
      assert.equal(decide(), "block", `narration is caught regardless of markdown shape: ${JSON.stringify(shape)}`);
    }
    for (const fence of ["```", "~~~"]) {
      write("what changed?", `${fence}text\nLet me check the config\n${fence}\nNothing changed.`);
      assert.equal(decide(), "allow", `${fence} fenced evidence is quoted material, not narration`);
    }
    // A FUTURE COMMITMENT is idiomatic and rule-1-compliant; flagging it costs the Owner an extra
    // message, which is the noise this hook exists to cut.
    for (const closing of [
      "Yes, safe. I will run the deploy once you say go.",
      "Yes, done. I'll check back tomorrow with the numbers.",
    ]) {
      write("safe?", closing);
      assert.equal(decide(), "allow", `a deferred commitment is not narration: ${JSON.stringify(closing)}`);
    }
    // The two branches are deliberately asymmetric, and BOTH directions of that asymmetry are pinned
    // here. "I'll …" is ambiguous — announcing work now vs promising it later — so it consults the
    // deferral list. "Let me …" is narration under every reading, so it never does. Sharing one
    // exemption between them let the first sentence below through on the word "then".
    for (const narrating of [
      "Let me check the config, then I'll report back.",
      "Let me verify that once the build finishes.",
    ]) {
      write("what changed?", narrating);
      assert.equal(decide(), "block", `"Let me …" is narration regardless of any deferral word: ${JSON.stringify(narrating)}`);
    }
    write("what changed?", "Config is unchanged. I'll check the logs, then send you the summary.");
    assert.equal(decide(), "allow", `"I'll … then …" chains a COMMITMENT about later work, not narration of work now`);
    write("what changed?", "I'll check the config.");
    assert.equal(decide(), "block", `"I'll check …" with no deferral IS narration`);
    // An explicit "now" beats a deferral word that belongs to a different clause of the same sentence.
    write("what changed?", "I'll check the config now; if you have questions, ask.");
    assert.equal(decide(), "block", `an unrelated "if you" must not excuse present-tense narration`);

    // --- harness-injected blocks must not silently disable the size check ---
    // The harness wraps the Owner's turn routinely. Discarding the whole turn (or letting the block
    // inflate the word count) removed the check on exactly the short-question turns it targets.
    write("<system-reminder>project context blob</system-reminder>\nAR", LONG);
    assert.equal(decide(), "block", "a LEADING system-reminder is stripped, not treated as the Owner's words");
    write("AR\n<system-reminder>project context blob</system-reminder>", LONG);
    assert.equal(decide(), "block", "a TRAILING system-reminder is stripped (it must not inflate the word count)");
    write("<system-reminder>nothing was typed</system-reminder>", LONG);
    assert.equal(decide(), "allow", "a turn with NO Owner-typed text has no question to size against");
    // An UNCLOSED block (a truncated tail) must be stripped too, and from either end. Handling only
    // the leading case left a truncated trailing block inflating the word count instead.
    write("AR\n<system-reminder>truncated context that never closes", LONG);
    assert.equal(decide(), "block", "an unclosed TRAILING harness block is stripped, not counted as the Owner's words");
    write("<system-reminder>truncated and never closed", LONG);
    assert.equal(decide(), "allow", "an unclosed LEADING block leaves no Owner text, so there is no question");
    // …but an INLINE mention of a tag is the Owner's own words. Stripping from it would truncate the
    // question, drop its "?", and silently disable the size check on a genuine short question.
    write("Is `<system-reminder>` supported?", LONG);
    assert.equal(decide(), "block", "an inline tag MENTION is Owner text, not an injected block");
    // A CLOSED tag pair inline in the Owner's sentence is their text too (v1.5.1). The unanchored
    // strip this pins against erased the Owner's words from around the pair, shrinking a long
    // question below the short-question ceiling and arming the size check where it must stay
    // silent — a FALSE BLOCK, the direction that costs the Owner most.
    const w30 = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    write(`Is <system-reminder>${w30}</system-reminder> fine?`, LONG);
    assert.equal(decide(), "allow", "a long question stays long — an inline CLOSED pair is not stripped");
    // When such a question IS short the size check fires fairly — and quotes the Owner's words
    // intact, which the unanchored strip erased from the echo.
    write("Is <system-reminder>this component</system-reminder> supported?", LONG);
    assert.equal(decide(), "block", "a SHORT question with a short inline closed pair is still sized");
    assert.match(JSON.parse(run().stdout).reason, /this component/,
      "the Owner's inline words survive into the echoed question");
    // The line anchor tolerates the harness's own indentation: a genuine own-line block still strips
    // (the leading/trailing rows above pin the unindented shape).
    write("  <system-reminder>project context blob</system-reminder>\nAR", LONG);
    assert.equal(decide(), "block", "an INDENTED own-line injected block is still stripped");
    // Two closed blocks GLUED on one line: stripping the first leaves a space, so the second then
    // begins the line. A single strip pass left it for the UNCLOSED rule, whose to-end-of-turn
    // sweep erased the Owner's REAL question after it — the size check silently off. The fixpoint
    // loop strips them all; the Owner's text survives.
    write("<system-reminder>a</system-reminder> <task-notification>b</task-notification>\nAR", LONG);
    assert.equal(decide(), "block", "adjacent glued blocks are BOTH stripped and the question survives");
    write("<system-reminder>a</system-reminder><task-notification>b</task-notification>", LONG);
    assert.equal(decide(), "allow", "glued blocks with nothing typed leave no question to size");
    // CHARACTERIZATION (anchor boundary, fails open): a closed block GLUED to the Owner's text with
    // no separator does not begin a line, so it reads as Owner text — the harness emits injected
    // blocks on their own lines, the principle both strip rules encode. Pinned so a harness
    // formatting change flips this visibly instead of silently.
    write("AR<system-reminder>project context blob</system-reminder>", LONG);
    assert.equal(decide(), "allow", "a block glued to Owner text with no separator reads as Owner text (documented boundary)");

    // --- a subagent's prompt must not be mistaken for the Owner's message ---
    writeEntries([
      { type: "user", message: { role: "user", content: "AR" } },
      { type: "user", isSidechain: true, message: { role: "user", content: `subagent brief: ${LONG}` } },
      { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "subagent result" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: LONG }] } },
    ]);
    assert.equal(decide(), "block",
      "a sidechain (subagent) prompt is skipped — otherwise every turn that spawns an agent loses the size check");

    // --- fail-open paths: each MUST allow, and exit 0, or the sensor could wedge a session ---
    write("AR", LONG);
    assert.equal(decide({ stop_hook_active: true }), "allow", "loop safety: stop_hook_active always allows");
    assert.equal(decide({}, { WORKFLOW_KIT_COMMS_GUARD: "false" }), "allow", "the off switch allows");
    assert.equal(decide({ transcript_path: "/nonexistent/nope.jsonl" }), "allow", "an unreadable transcript allows");
    const garbage = spawnSync("node", [hook], { cwd: dir, encoding: "utf8", input: "NOT JSON{", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(garbage.status, 0, "malformed stdin exits 0");
    assert.ok(!garbage.stdout.includes("block"), "malformed stdin allows");

    // --- the block REASON must be true, not just present ---
    write("AR", LONG);
    const reason = JSON.parse(run().stdout).reason;
    assert.match(reason, /Alex/, "the reason names the actual Owner from the generated doc");
    assert.match(reason, /ALREADY SEEN/, "the reason states the honest limit: the message cannot be retracted");
    assert.match(reason, /SIZE MISMATCH/, "the reason names the check that actually fired");

    // --- DORMANT, proven by reverting the arming condition ---
    writeFileSync(doc, readFileSync(doc, "utf8").replace(/Alex/g, "{{OWNER_NAME}}"));
    assert.equal(decide(), "allow", "an unfilled {{OWNER_NAME}} leaves the sensor DORMANT (allows unconditionally)");
    // A heading the hook cannot parse is ALSO dormant — and init reports it that way (test below).
    writeFileSync(doc, readFileSync(doc, "utf8").replace(/^## How to talk to.*$/m, "## Owner notes"));
    assert.equal(decide(), "allow", "a retitled heading leaves the sensor DORMANT");
    rmSync(doc);
    assert.equal(decide(), "allow", "an ABSENT core/OWNER_COMMS.md allows (no contract, no nudge)");
  } finally { cleanup(); }
});

test("init's armed/dormant report comes from the hook's own predicate, so it cannot drift", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const initSays = () => execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt"], { encoding: "utf8" })
      .split("\n").find((l) => l.includes("core/OWNER_COMMS.md:")) ?? "";
    // For each shape, init's WORD and the hook's BEHAVIOUR must agree. A paraphrased predicate here
    // announced ARMED for headings the hook could not parse — a false statement about a control.
    const shapes = [
      ["## How to talk to Alex — Owner, not a developer", true, "the shipped heading"],
      ["## How to talk to Alex - Owner, not a developer", false, "em dash normalized to a hyphen"],
      ["## How to talk to Alex", false, "heading tidied"],
      ["## Owner notes", false, "heading retitled"],
      ["## How to talk to {{OWNER_NAME}} — Owner, not a developer", false, "name never filled"],
    ];
    const original = readFileSync(doc, "utf8");
    for (const [heading, wantArmed, label] of shapes) {
      writeFileSync(doc, original.replace(/^## How to talk to.*$/m, heading));
      const armedPerHook = ownerContract(dir) !== null;
      assert.equal(armedPerHook, wantArmed, `hook: ${label} ⇒ ${wantArmed ? "armed" : "dormant"}`);
      const line = initSays();
      assert.equal(/is ARMED/.test(line), wantArmed, `init AGREES with the hook for ${label}: ${line.trim()}`);
      assert.equal(/DORMANT/.test(line), !wantArmed, `init says dormant exactly when the hook is dormant (${label})`);
    }
  } finally { cleanup(); }
});

test("the template's EXAMPLE shorthand is never harvested as the Owner's own vocabulary", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    // Armed on the name alone, but {{OWNER_SHORTHAND}} is still unfilled: the only `TOKEN` = gloss
    // rows in the file are the template's fenced EXAMPLES. Harvesting those would hand this Owner
    // someone else's vocabulary and make the sensor act on shorthand they never use.
    assert.deepEqual(ownerContract(dir).questionTokens, [],
      "fenced example rows contribute no question tokens");
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`LE` = loose ends pending? — what is still open.\n`CMPD` = commit, merge, push, deploy."));
    const tokens = ownerContract(dir).questionTokens;
    assert.deepEqual(tokens, ["LE"], "real rows outside the fence ARE harvested, and only the ones that ask");
  } finally { cleanup(); }
});

test("the shorthand harvest is UNANCHORED (inline-prose rows covered), and an empty harvest WARNS instead of silently disarming", async () => {
  const { ownerContract } = await import(path.join(KIT, "hooks", "guard-owner-comms.mjs"));
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    const original = readFileSync(doc, "utf8");
    const transcript = path.join(dir, "transcript.jsonl");
    const LONG = "word ".repeat(400);
    const write = (user, assistantText) => writeFileSync(transcript, [
      { type: "user", message: { role: "user", content: user } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: assistantText }] } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n");
    // Crash-aware, and it returns stderr too — the WARN channel is part of the contract under test.
    const run = () => {
      const r = spawnSync("node", [path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs")], {
        cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
      assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
      return { decision: r.stdout.includes('"decision":"block"') ? "block" : "allow", stderr: r.stderr };
    };

    // (1) INLINE-PROSE rows — a real adopter format (the executed downstream failure: a doc in this
    // shape harvested ZERO tokens under the line-anchored rule, and "AR" + a 430-word inventory
    // sailed through). The harvest must not require one-row-per-line, and the LIVE hook must act on
    // what it harvested.
    writeFileSync(doc, original.replace("{{OWNER_SHORTHAND}}",
      "Alex types `RD` = report done? — is the report finished. Alex also types `MIS` = make it so — proceed on the agreed scope."));
    assert.deepEqual(ownerContract(dir).questionTokens, ["RD"], "inline-prose rows are harvested, and only the one that asks");
    assert.equal(ownerContract(dir).shorthandUnharvested, false, "a working harvest raises no warning flag");
    write("RD", LONG);
    let r = run();
    assert.equal(r.decision, "block", "the LIVE hook enforces a question token harvested from inline prose");
    assert.doesNotMatch(r.stderr, /WARN/, "no coverage warning while coverage exists");
    write("MIS", LONG);
    assert.equal(run().decision, "allow", "an inline-prose INSTRUCTION (no '?' in its gloss) still earns a work report");

    // (2) FENCED-EXAMPLES-ONLY — the pristine generated doc, armed by name but {{OWNER_SHORTHAND}}
    // never filled. Definition-shaped rows exist (the template's fenced examples) yet NONE parse
    // outside the fence: question coverage is OFF and the kit has no fallback vocabulary to fail
    // toward, so the hook must SAY so — stderr, non-blocking — instead of running silently uncovered.
    writeFileSync(doc, original.replace("{{OWNER_SHORTHAND}}", ""));
    assert.equal(ownerContract(dir).shorthandUnharvested, true, "fenced-examples-only sets the warning flag");
    write("AR", LONG);
    r = run();
    assert.equal(r.decision, "allow", "the warning never blocks — the sensor still fails open");
    assert.match(r.stderr, /guard-owner-comms WARN/, "the empty harvest is announced on stderr");
    assert.match(r.stderr, /coverage is OFF/, "…and the warning says what is actually off");

    // (2b) A row a human plainly WROTE as a definition but the parser cannot read — double
    // backticks, the fence deleted. Not harvestable (single backticks are the documented format),
    // so it must at least WARN: zero parsed definitions while the doc visibly tries to define
    // shorthand is exactly the silently-blind state the warning exists for.
    writeFileSync(doc, "## How to talk to Alex — Owner, not a developer\n\n``AR`` = archive ready? — closed out on the remote.\n");
    assert.deepEqual(ownerContract(dir).questionTokens, [], "a double-backtick row does not parse (single backticks are the format)");
    assert.equal(ownerContract(dir).shorthandUnharvested, true, "…but it is visibly definition-shaped, so the flag is raised");
    write("AR", LONG);
    r = run();
    assert.equal(r.decision, "allow", "unparsed vocabulary cannot block");
    assert.match(r.stderr, /guard-owner-comms WARN/, "…and the blindness is announced, never silent");

    // (3) An ALL-INSTRUCTION vocabulary parsed fine — question coverage is legitimately empty, not
    // lost, so warning here would be a perpetual false alarm for that adopter.
    writeFileSync(doc, original.replace("{{OWNER_SHORTHAND}}", "`CMPD` = commit, merge, push, deploy."));
    assert.equal(ownerContract(dir).shorthandUnharvested, false, "a parsed instruction-only vocabulary is not a failed harvest");
    write("AR", LONG);
    assert.doesNotMatch(run().stderr, /WARN/, "no warning when the harvest worked and the Owner just has no question shorthand");

    // (4) NO shorthand section at all (the template says to delete it when the Owner has none):
    // nothing definition-shaped anywhere, so silence is the truthful report.
    const cut = original.slice(0, original.indexOf("**Alex's shorthand"));
    assert.notEqual(cut, original, "the generated doc carries the shorthand section marker this case removes");
    writeFileSync(doc, cut);
    assert.equal(ownerContract(dir).shorthandUnharvested, false, "no shorthand section, no warning flag");
    write("AR", LONG);
    r = run();
    assert.equal(r.decision, "allow", "no section means no question tokens — AR is not shorthand here");
    assert.doesNotMatch(r.stderr, /WARN/, "an Owner with no shorthand section is a legitimate state, not a warning");

    // (5) CRLF line endings (a doc edited on Windows). A blank CRLF line must still terminate a
    // gloss: without \r in the boundary class, a "?" in unrelated LATER prose bled into an
    // instruction's gloss and turned it into a question token — a false block. The question row
    // still harvests.
    writeFileSync(doc, "## How to talk to Alex — Owner, not a developer\r\n\r\n" +
      "`MIS` = make it so — proceed.\r\n\r\nDo you want examples?\r\n\r\n`AR` = archive ready? — closed out.\r\n");
    assert.deepEqual(ownerContract(dir).questionTokens, ["AR"],
      "CRLF: the question row harvests and the instruction stays an instruction");
    write("MIS", LONG);
    assert.equal(run().decision, "allow", "CRLF: a '?' beyond a blank CRLF line does not bleed into MIS's gloss");
    write("AR", LONG);
    assert.equal(run().decision, "block", "CRLF: AR is still a covered question token");

    // (6) DOCUMENTED RESIDUAL (accepted — delete if the harvest is ever section-scoped): the
    // `TOKEN` = gloss shape is RESERVED NOTATION throughout this doc (the template says so). An
    // incidental backticked ALL-CAPS mention in unrelated prose harvests exactly as a line-start
    // one already did pre-v1.5.1 — the unanchored harvest WIDENS that pre-existing exposure to
    // mid-prose, it does not create the class; the old hook exposed it too. Bounded:
    // a false block also needs the Owner to type that token alone as a whole turn, and the sensor
    // stays fail-open, one nudge per turn max.
    writeFileSync(doc, original
      .replace("{{OWNER_SHORTHAND}}", "")
      .replace("Explaining more is not dumbing down",
        "By default the `PORT` = 8080? staging value applies. Explaining more is not dumbing down"));
    assert.deepEqual(ownerContract(dir).questionTokens, ["PORT"],
      "RESERVED NOTATION: an incidental backticked ALL-CAPS mention in prose harvests (documented residual)");
    // …and the same reserved shape INSIDE another token's gloss splits it: the embedded mention
    // reads as the NEXT definition (ending AR's gloss before its "?") and harvests itself. Inherent
    // to inline-prose support — a next definition mid-prose IS a gloss boundary — so the template
    // documents it (keep the shape out of glosses) rather than the parser guessing. The old
    // line-anchored harvest read the whole line as AR's gloss.
    writeFileSync(doc, "## How to talk to Alex — Owner, not a developer\n\n`AR` = the config uses `ENV` = prod, is it ready?\n");
    assert.deepEqual(ownerContract(dir).questionTokens, ["ENV"],
      "RESERVED NOTATION in a gloss reads as the next definition (documented residual)");
  } finally { cleanup(); }
});

test("DEFERRED — not desired; delete when fixed: nested injected blocks hide the question token", () => {
  // A block nested INSIDE another block of the same tag defeats the lazy matcher: the strip ends at
  // the inner closer, the residue keeps `AR` from standing alone, and the size check skips. This
  // asserts the CURRENT behavior (allow — a missed advisory nudge, failing OPEN), which is identical
  // in this hook, its pre-v1.5.1 version, and the downstream adopter's merged baseline. It is NOT
  // the desired behavior; a fix needs a balanced scanner, deferred as new surface for a harness
  // shape never observed in the wild (same ruling as the downstream port's ratified DEFER).
  const { dir, cleanup } = adopt(["--owner-name", "Alex", "--skip-codex-prompt"]);
  try {
    const doc = path.join(dir, "core", "OWNER_COMMS.md");
    writeFileSync(doc, readFileSync(doc, "utf8").replace("{{OWNER_SHORTHAND}}",
      "`AR` = archive ready? — is this thread closed out on the remote."));
    const transcript = path.join(dir, "transcript.jsonl");
    const nested = "<system-reminder>outer\n<system-reminder>inner</system-reminder>\nouter</system-reminder>\nAR";
    writeFileSync(transcript, [
      { type: "user", message: { role: "user", content: nested } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "word ".repeat(400) }] } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const r = spawnSync("node", [path.join(dir, ".claude", "hooks", "guard-owner-comms.mjs")], {
      cwd: dir, encoding: "utf8", input: JSON.stringify({ transcript_path: transcript }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
    assert.ok(!r.stdout.includes('"decision":"block"'),
      "characterization: the nested-block residue hides AR and the size check skips (fails open)");
  } finally { cleanup(); }
});

test("FM1: init sets core.hooksPath; the portable FM1 test goes RED when it is unset", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adopt-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    // --skip-codex-prompt keeps `npm test` HERMETIC: init otherwise defaults to the user-global
    // ~/.codex/prompts and this test would write there (a real side effect outside any scratch dir).
    execFileSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--skip-codex-prompt"],
      { stdio: "ignore" });
    // init applied the FM1 mitigation
    const hp = execFileSync("git", ["-C", dir, "config", "core.hooksPath"], { encoding: "utf8" }).trim();
    assert.equal(hp, ".githooks", "init must set core.hooksPath=.githooks");
    // install the portable FM1 test into the adopter and prove it discriminates
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    copyFileSync(path.join(KIT, "templates", "kit-precommit.test.mjs"), path.join(dir, "tests", "kit-precommit.test.mjs"));
    const env = cleanTestEnv();
    const green = spawnSync("node", ["--test", "tests/kit-precommit.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.equal(green.status, 0, `FM1 test should PASS when core.hooksPath is set:\n${green.stdout}`);
    // PLANT THE BUG: unset core.hooksPath -> the FM1 test must go RED
    execFileSync("git", ["-C", dir, "config", "--unset", "core.hooksPath"]);
    const red = spawnSync("node", ["--test", "tests/kit-precommit.test.mjs"], { cwd: dir, encoding: "utf8", env });
    assert.notEqual(red.status, 0, "FM1 test must FAIL when core.hooksPath is unset (else the mitigation is fiction)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── KO17: two numbers that drifted because prose restated them ─────────────────────────────────

test("the shipped version is DERIVED from VERSION, never hand-kept beside it", () => {
  // package.json said 2.6.1 against a VERSION of 2.12.0 — six releases of silent drift, because
  // nothing compared them. Whoever bumps VERSION now learns immediately if they missed the mirror.
  const version = readFileSync(path.join(KIT, "VERSION"), "utf8").trim();
  const pkg = JSON.parse(readFileSync(path.join(KIT, "package.json"), "utf8"));
  assert.match(version, /^\d+\.\d+\.\d+$/, "VERSION is the source of truth and must be a plain semver line");
  assert.equal(pkg.version, version,
    `package.json says ${pkg.version} and VERSION says ${version}. One of them is lying to every reader ` +
    `and every tool that resolves the package.`);
});

test("no shipped doc restates a method-cap number that disagrees with the checker", () => {
  // The cap moved 20480 -> 21504 -> 23040 -> 24064 -> 25088 while three docs still said "20 KiB".
  // A number copied into prose has no way to learn it changed, so the durable cure is this pin:
  // state the cap in ONE place, and let any other spelling of a KiB figure near cap vocabulary
  // answer to the checker's own value.
  const capBytes = ROLE_CAPS.method;
  const capKiB = capBytes / 1024;
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", ".claude", "tests", "acceptance"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".tmpl"))) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(CAP_BEFORE)) {
          if (Number(m[1]) !== capKiB) offenders.push(`${path.relative(KIT, p)}: "${m[0].trim()}"`);
        }
        for (const m of text.matchAll(CAP_AFTER)) {
          if (Number(m[1]) !== capKiB) offenders.push(`${path.relative(KIT, p)}: "${m[0].trim()}"`);
        }
      }
    }
  };
  walk(KIT);
  // The bound, stated in the assertion itself: this catches the cap-word VOCABULARY below, in both
  // word orders, within one sentence. It cannot close the paraphrase space — a grep proves a
  // spelling, never a claim — and it has been walked past twice already ("limit", then "maximum"),
  // each time by a reviewer rather than by a release. Read it as a ratchet on known spellings, not
  // as proof that no surface disagrees.
  assert.deepEqual(offenders, [],
    `these surfaces state a method cap other than ${capKiB} KiB (${capBytes} B), which is what ` +
    `scripts/check-doc-size.mjs actually enforces: ${offenders.join(" · ")}`);

  // CANARY — an absence pin is decoration unless its regex can match the thing it forbids. Prove it
  // against the stale spellings this chip removed AND against the paraphrase a cold seat used to
  // walk past the first version of this check: it required the literal word "cap", so "the method
  // LIMIT remains 20 KiB" made the identical stale claim and passed. Enumeration cannot close a
  // paraphrase space, but a bare-word ban is worse; the vocabulary below is the narrowest set that
  // covers how this repo actually writes the sentence.
  const stale = [
    "governed at the 20 KiB method cap along with",
    "the BINDING-method cap of 20 KiB.",
    "The method limit remains 20 KiB.",
    "a method ceiling of 20 KiB",
    "the method budget is 20 KiB",
    "The method maximum remains 20 KiB.",     // a cold seat's second bypass of this pin
    "The method allocation remains 20 KiB.",  // and its third — see the bound stated below
  ];
  for (const sample of stale) {
    const hits = [...sample.matchAll(CAP_BEFORE), ...sample.matchAll(CAP_AFTER)];
    assert.ok(hits.length > 0, `the cap-drift regex must match the spelling it forbids: ${sample}`);
  }
  // ...and the other polarity: the CURRENT spellings must NOT be flagged, or the pin is a nuisance
  // that gets switched off.
  for (const fine of [`the ${capKiB} KiB method cap`, `method cap of ${capKiB} KiB`]) {
    // Both regexes capture the NUMBER as group 1 — the word-order halves are non-capturing, so a
    // refactor cannot silently shift the group index and turn every reading into NaN.
    const hits = [...fine.matchAll(CAP_BEFORE)].map((m) => Number(m[1]))
      .concat([...fine.matchAll(CAP_AFTER)].map((m) => Number(m[1])));
    assert.ok(hits.every((n) => n === capKiB), `a correct spelling must not be flagged: ${fine}`);
  }
});

// One matcher, used by BOTH the guard and its canary. It was two copies in the first cut, and a cold
// seat noted the copies could drift while both tests stayed green — so the canary proved only that a
// duplicate recognised its own fixtures. This is the single source of truth for both.
//
// WHAT IT IS, STATED HONESTLY: a LEXICAL scan for a direct `spawnSync`/`execFileSync` call whose
// argument text names init.mjs. It is a checklist, not a containment boundary. It does NOT see:
// `spawn`/`execSync`/`fork`/`execa`/async `execFile`, a path hoisted into a const or helper, a shell
// string, or a flag that is present as text but never reaches the child argv. Those gaps are the
// reason `docs/` carries the containment proposal (run the suite under a scratch HOME) as the real
// fix; this guard catches the shape that ACTUALLY leaked (FM-2026-08-29-18) and fails closed on what
// it cannot parse.
export function initInvocationOffenders(dir) {
  const offenders = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { walk(abs, `${rel}${e.name}/`); continue; }
      if (!/\.(mjs|cjs|js|ts)$/.test(e.name)) continue;
      const src = readFileSync(abs, "utf8");
      const re = /(spawnSync|execFileSync)\s*\(/g;
      let m;
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length, depth = 1, end = -1;
        while (i < src.length && i < m.index + 4000) {
          const c = src[i];
          if (c === "(") depth++;
          else if (c === ")") { depth--; if (!depth) { end = i; break; } }
          i++;
        }
        const line = () => src.slice(0, m.index).split("\n").length;
        // FAIL CLOSED on an unparseable call. The first cut left `end` at src.length here, so a call
        // whose closing paren was past the window swept in every later flag in the file and exempted
        // itself. An unterminated call we cannot read is an offender, not a pass.
        if (end === -1) {
          if (/init\.mjs/.test(src.slice(m.index, m.index + 4000))) {
            offenders.push(`${rel}${e.name}:${line()} (unparseable call — could not find its closing paren)`);
          }
          continue;
        }
        const call = src.slice(m.index, end);
        if (!/init\.mjs/.test(call)) continue;
        if (/--codex-prompts-dir|--skip-codex-prompt/.test(call)) continue;
        // The marker must be a COMMENT, on the SINGLE line directly above, carrying a reason after
        // the dash. A bare token in a string does not exempt anything, and neither does a marker
        // written for a neighbouring call: a two-line window let one marker exempt the call beneath
        // it AND the next one, which is how an unmarked invocation rides in behind a marked one.
        const above = src.slice(0, m.index).split("\n").slice(-2, -1);
        if (above.some((l) => /^\s*\/\/\s*kit-guard:no-install\s+—\s+\S/.test(l))) continue;
        offenders.push(`${rel}${e.name}:${line()}`);
      }
    }
  };
  walk(dir, "tests/");
  return offenders;
}

test("no DIRECT spawnSync/execFileSync of bin/init.mjs under tests/ may install into the operator's real ~/.codex/prompts", () => {
  // The failure this exists to stop, executed on this release: tests/sweep-sensor.test.mjs adopted a
  // scratch repo with neither --codex-prompts-dir nor --skip-codex-prompt, so init.mjs fell back to
  // DEFAULT_CODEX_PROMPTS_DIR (bin/init.mjs:39) and `node scripts/run-checks.mjs` INSTALLED a new
  // shim into the operator's user-global prompts dir — a write no `git status` or revert reaches.
  // copyGuarded's refusal to clobber kept the blast radius to one file and hid it until /grilling
  // shipped a new shim (FAILURE_MODES.md FM-2026-08-29-18).
  //
  // The test NAME states the scope on purpose. This catches the direct-call shape that leaked; it is
  // not a proof that nothing writes to the operator's home. See initInvocationOffenders' header for
  // what it cannot see, and prefer the scratch-HOME containment boundary when that lands.
  assert.deepEqual(initInvocationOffenders(path.join(KIT, "tests")), [],
    "these make a direct spawnSync/execFileSync of bin/init.mjs with neither --codex-prompts-dir nor " +
    "--skip-codex-prompt, so they install into the operator's real ~/.codex/prompts. Pass a scratch " +
    "dir, or, if the call cannot reach the install at all, declare why directly above it with " +
    "`// kit-guard:no-install — <reason>`");
});

test("the ~/.codex/prompts guard CAN FAIL — the REAL matcher catches a leak, is not fooled by a mention, and fails closed", () => {
  // A guard that cannot fail proves nothing. This drives the SAME function the guard uses, over a
  // planted tree on disk, so the two cannot drift apart.
  //
  // The fixtures assemble the filename at runtime. Spelled literally, this test's own planted sources
  // are real matches in this file and the guard above flags them line by line — which it did, the
  // first time this was written.
  const F = ["init", "mjs"].join(".");
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-guard-"));
  const plant = (name, body) => { writeFileSync(path.join(dir, name), body); };
  const only = (body) => {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    plant("a.mjs", body);
    return initInvocationOffenders(dir).length;
  };
  try {
    assert.equal(only(`spawnSync("node", [path.join(K, "bin", "${F}"), "--owner-name", "T"]);`), 1,
      "an unflagged invocation must be caught");
    assert.equal(only(`spawnSync("node", [path.join(K, "bin", "${F}"), "--codex-prompts-dir", d]);`), 0,
      "a flagged invocation must pass");
    assert.equal(only(`execFileSync(p, [path.join(K, "bin", "${F}"), "--skip-codex-prompt"]);`), 0,
      "a skipped invocation must pass");
    assert.equal(only(`const { x } = await import(path.join(KIT, "bin", "${F}"));`), 0,
      "an import() of the file is not an invocation");
    assert.equal(only(`readFileSync(path.join(KIT, "bin", "${F}"), "utf8")`), 0,
      "a readFileSync of the file is not an invocation");
    assert.equal(only(`  // kit-guard:no-install — exits 2\n  spawnSync("node", [path.join(K, "bin", "${F}"), "--bad"]);`), 0,
      "a declared no-install call, with a reason, must pass");
    assert.equal(only(`  const s = "kit-guard:no-install";\n  spawnSync("node", [path.join(K, "bin", "${F}"), "--bad"]);`), 1,
      "the marker must be a COMMENT — a bare token in a string must not exempt anything");
    assert.equal(only(`  // kit-guard:no-install\n  spawnSync("node", [path.join(K, "bin", "${F}"), "--bad"]);`), 1,
      "the marker must carry a reason after the dash");
    assert.equal(only(`spawnSync("node", [path.join(K, "bin", "${F}"), "${"x".repeat(4100)}"]);`), 1,
      "an unparseable call must FAIL CLOSED, not sweep in a later flag");
    assert.equal(only(
      `  // kit-guard:no-install — exits 2\n` +
      `  spawnSync("node", [path.join(K, "bin", "${F}"), "--bad"]);\n` +
      `  spawnSync("node", [path.join(K, "bin", "${F}"), "--owner-name", "T"]);`), 1,
      "one marker exempts ONLY the call directly beneath it — the next call must still be caught");
    // discovery: a nested file and a non-.mjs extension are both in scope
    rmSync(dir, { recursive: true, force: true }); mkdirSync(path.join(dir, "support"), { recursive: true });
    plant("support/helper.cjs", `spawnSync("node", [path.join(K, "bin", "${F}"), "--owner-name", "T"]);`);
    assert.equal(initInvocationOffenders(dir).length, 1, "a nested, non-.mjs helper is still scanned");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
