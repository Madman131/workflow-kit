// tests/sweep-sensor.test.mjs — the sweep sensor (scripts/sweep.mjs), the Codex banner reader, and
// the two PreToolUse sensors shipped with it.
//
// EVERY CONTROL HERE IS PROVEN BOTH WAYS. A check never observed failing is vacuous
// (core/INVARIANTS.md rule 1), and a check never observed PASSING on a clean input is how a false
// FAIL gets minted — the exact two-sided obligation sensor-mutation-owed.mjs exists to demand. So
// each block below carries a planted case that must be caught AND a clean case that must not be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseArgs, resolveFiles, resolveSeat, allRegions, parseSweepOutput, regionsAgree,
  coverageProblems, outPathProblem, buildPrompt,
} from "../scripts/sweep.mjs";
import { parseBanner, bannerBlock } from "../scripts/codex-banner.mjs";
import { sweepOwed, classifyFragment, isSkillFile, SKILL_ROOTS, incomingText } from "../hooks/sensor-sweep-owed.mjs";
import { toRepoRelative } from "../hooks/payload-targets.mjs";
import { owesMutationRecord, emissionText } from "../hooks/sensor-mutation-owed.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = () => mkdtempSync(path.join(os.tmpdir(), "kit-sweep-"));

// ---------------------------------------------------------------- seat resolution (fail-closed)

test("the seat is never guessed: --seat wins, config supplies a default, and absence FAILS CLOSED", () => {
  const dir = scratch();
  try {
    // 1. No --seat and no config ⇒ NO seat. This is the load-bearing direction: a kit that
    //    hardcoded a model id would bind every adopter to one vendor's lineup.
    assert.equal(resolveSeat(null, dir).seat, null);

    // 2. --seat wins outright, without reading anything from disk.
    const explicit = resolveSeat({ model: "m", effort: "high" }, dir);
    assert.deepEqual(explicit.seat, { model: "m", effort: "high" });
    assert.equal(explicit.source, "--seat");

    // 3. A well-formed config supplies the default.
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ sweepSeat: "cheap:high" }));
    const fromCfg = resolveSeat(null, dir);
    assert.deepEqual(fromCfg.seat, { model: "cheap", effort: "high" });
    assert.match(fromCfg.source, /kit\.config\.json/);

    // 4. A MALFORMED config is distinguished from an ABSENT one. Collapsing the two would report a
    //    typo as "you never configured it", sending the adopter to fix the wrong thing.
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), "{not json");
    const broken = resolveSeat(null, dir);
    assert.equal(broken.seat, null);
    assert.match(broken.problem, /not valid JSON/);

    // 5. Right file, right key, WRONG SHAPE — must not silently degrade to "absent".
    writeFileSync(path.join(dir, ".claude", "kit.config.json"), JSON.stringify({ sweepSeat: "noeffort" }));
    const shape = resolveSeat(null, dir);
    assert.equal(shape.seat, null);
    assert.match(shape.problem, /model:effort/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the coverage denominator

test("the DENOMINATOR is the wrapper's, not the model's: unreadables are pre-marked, duplicates collapse", () => {
  const dir = scratch();
  try {
    writeFileSync(path.join(dir, "a.md"), "a");
    mkdirSync(path.join(dir, "sub"));
    // CLEAN SIDE: two real files resolve as readable and nothing is pre-marked.
    const clean = resolveFiles(["a.md"], dir);
    assert.deepEqual(clean.readable, ["a.md"]);
    assert.deepEqual(clean.unreadable, []);

    // PLANTED SIDE, three distinct shapes that must NOT inflate the denominator:
    const planted = resolveFiles(["a.md", "./a.md", "missing.md", "sub"], dir);
    assert.deepEqual(planted.readable, ["a.md"], "the same file by two spellings is ONE file");
    const reasons = planted.unreadable.map((u) => u.reason);
    assert.ok(reasons.some((r) => /duplicate/.test(r)), "`./a.md` is deduped on the RESOLVED path");
    assert.ok(reasons.some((r) => /ENOENT|unreadable/.test(r)), "a missing file is pre-marked, not swept");
    assert.ok(reasons.some((r) => /not a regular file/.test(r)), "a directory is not a file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("coverage honesty: an honest answer is clean, and every dishonest shape is caught", () => {
  const readable = ["a.md", "b.md"];
  const unreadable = [{ file: "c.md", reason: "ENOENT" }];
  const cov = (pairs) => new Map(pairs);

  // CLEAN SIDE — every readable file attested `scanned`, findings only on shown files.
  assert.deepEqual(
    coverageProblems({
      readable, unreadable,
      findings: [{ file: "a.md", line: 1, span: "x", answer: "y" }],
      coverage: cov([["a.md", "scanned"], ["b.md", "scanned"]]),
    }),
    [], "an honest sweep reports NO problems — without this the block below proves nothing");

  const problem = (over) => coverageProblems({
    readable, unreadable, findings: [], coverage: cov([["a.md", "scanned"], ["b.md", "scanned"]]), ...over,
  });
  // Each planted shape, one at a time.
  assert.match(problem({ coverage: cov([["a.md", "scanned"]]) })[0], /NO coverage line: b\.md/);
  assert.match(problem({ coverage: cov([["a.md", "scanned"], ["b.md", "unreadable(x)"]]) })[0],
    /declared a wrapper-readable file unreadable/,
    "the wrapper PROVED it readable, so a model-declared unreadable is a refusal, not an excuse");
  assert.match(problem({ coverage: cov([["a.md", "scanned"], ["b.md", "scanned"], ["z.md", "scanned"]]) })[0],
    /OUTSIDE the list: z\.md/);
  assert.match(problem({ coverage: cov([["a.md", "scanned"], ["b.md", "scanned"], ["c.md", "scanned"]]) })[0],
    /pre-marked unreadable: c\.md/, "the model cannot claim a file it was never shown");
  assert.match(problem({ duplicates: ["a.md"] })[0], /more than one coverage line/);
  assert.match(problem({ findings: [{ file: "nope.md", line: 1, span: "", answer: "" }] })[0],
    /never shown: nope\.md — fabricated evidence/);
  assert.match(problem({ badContract: ["- FINDING: mangled"] })[0], /contract-shaped line failed to parse/);
});

test("a mangled contract line fails LOUDLY instead of vanishing into a false 'no findings'", () => {
  // The defect: a reflowed or bulleted FINDING that no longer matches the shape. Dropped silently,
  // it manufactures a clean sweep — the single most dangerous output this tool can produce.
  const mangled = parseSweepOutput('- FINDING: a.md :: 3 :: "x" :: answer');
  assert.equal(mangled.findings.length, 0);
  assert.equal(mangled.badContract.length, 1, "recorded as a mangled record, NOT counted as prose");
  assert.equal(mangled.proseLines, 0);

  // CLEAN SIDE: the well-formed line parses, and ordinary prose is tolerated as prose.
  const ok = parseSweepOutput('FINDING: a.md :: 3 :: "x" :: answer\nCOVERAGE: a.md :: scanned\nchit chat');
  assert.equal(ok.findings.length, 1);
  assert.equal(ok.badContract.length, 0);
  assert.equal(ok.proseLines, 1);
});

test("multiple answer regions must AGREE — first-wins would silently accept a swapped answer", () => {
  const n = "abc123";
  const region = (body) => `SWEEP-BEGIN-${n}\n${body}\nSWEEP-END-${n}`;
  const cover = "COVERAGE: a.md :: scanned";

  const two = allRegions(`noise\n${region(cover)}\ntail\n${region(cover)}`, n);
  assert.equal(two.regions.length, 2);
  assert.equal(two.danglingBegin, false);
  assert.ok(regionsAgree(parseSweepOutput(two.regions[0]), parseSweepOutput(two.regions[1])),
    "identical repeats are LEGITIMATE — transcripts repeat the final message");

  const differing = allRegions(`${region(cover)}\n${region("COVERAGE: b.md :: scanned")}`, n);
  assert.equal(regionsAgree(parseSweepOutput(differing.regions[0]), parseSweepOutput(differing.regions[1])), false);

  // An unterminated region is not an answer.
  assert.equal(allRegions(`SWEEP-BEGIN-${n}\n${cover}`, n).danglingBegin, true);

  // THE ECHO CANNOT FORGE A REGION: the prompt quotes both markers, but inline in prose, and the
  // anchors are whole-line. Without this the nonce would be decorative.
  const prompt = buildPrompt("q?", ["a.md"], n);
  assert.ok(prompt.includes(`SWEEP-BEGIN-${n}`), "the prompt does name the marker…");
  assert.equal(allRegions(prompt, n).regions.length, 0, "…yet echoing the prompt forms NO region");
});

test("--out never clobbers and never escapes into another checkout", () => {
  const dir = scratch();
  try {
    writeFileSync(path.join(dir, "taken.md"), "x");
    assert.match(outPathProblem(path.join(dir, "taken.md"), dir), /already exists/);
    assert.match(outPathProblem(path.join(dir, "no-such-dir", "r.md"), dir), /does not exist/);
    // CLEAN SIDE: a fresh path in an existing dir is allowed.
    assert.equal(outPathProblem(path.join(dir, "fresh.md"), dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("argv: the list is never invented, the repo is never inferred, and duplicates are refused", () => {
  const errs = [];
  const onError = (m) => { errs.push(m); throw new Error("stop"); };
  const bad = (argv) => { errs.length = 0; try { parseArgs(argv, { onError }); } catch {} return errs[0] ?? ""; };

  assert.match(bad(["--question", "q", "--repo", "/r"]), /--files is required/);
  assert.match(bad(["--question", "q", "--files", "a"]), /--repo is required/);
  assert.match(bad(["--repo", "/r", "--files", "a"]), /--question is required/);
  assert.match(bad(["--question", "q", "--repo", "/r", "--files", "a", "--files", "a"]), /duplicate/);
  assert.match(bad(["--question", "q", "--repo", "/r", "--files", "a", "--seat", "nope"]), /model:effort/);

  // CLEAN SIDE: a well-formed invocation parses, and `seat` stays null so resolveSeat decides.
  const ok = parseArgs(["--question", "q", "--repo", "/r", "--files", "a"]);
  assert.equal(ok.seat, null);
  assert.deepEqual(ok.files, ["a"]);
});

// ---------------------------------------------------------------- the banner (seat verification)

test("the seat is read from the BANNER, and an absent field is null — never folded into an OK", () => {
  const log = [
    "OpenAI Codex v1.2.3", "--------", "model: cheap-model", "reasoning effort: high",
    "sandbox: read-only [/repo]", "workdir: /repo", "session id: s-1", "--------", "tokens used", "1,234",
  ].join("\n");
  const b = parseBanner(log);
  assert.equal(b.model, "cheap-model");
  assert.equal(b.effort, "high");
  assert.equal(b.sandbox, "read-only", "the MODE is the first token, not the bracketed roots");
  assert.equal(b.sandboxRoots, "/repo");
  assert.equal(b.tokens, 1234, "commas stripped");

  // PLANTED: no banner at all ⇒ every field null. A caller comparing `banner.model !== seat.model`
  // then fails CLOSED. If this returned an object of empty strings it could compare equal to a
  // seat that was never verified.
  const none = parseBanner("just some output");
  assert.equal(bannerBlock("just some output"), null);
  assert.equal(none.model, null);
  assert.equal(none.sandbox, null);
  assert.equal(none.sandboxRoots, null);

  // PLANTED: an unrecognised sandbox form yields null ROOTS (⇒ unverified), never a partial parse
  // that reads as narrowed.
  const weird = parseBanner(["OpenAI Codex v1", "--------", "sandbox: workspace-write [/a] (network access enabled) [/b]", "--------"].join("\n"));
  assert.equal(weird.sandboxRoots, null);

  // THE SEAT FIELDS ARE BLOCK-SCOPED, AND THAT IS THE WHOLE POINT OF READING A BANNER.
  // The model's own output lands AFTER the closing rule. If the reader took the whole log, a run
  // could print `model: expensive-model` in its answer and forge the very seat the caller is
  // verifying — a self-certifying seat, which is no seat at all. So: a banner naming the CHEAP
  // model, followed by model output claiming an expensive one, must still read as the cheap one.
  const forged = [
    "OpenAI Codex v1.2.3", "--------", "model: cheap-model", "reasoning effort: high",
    "sandbox: read-only [/repo]", "workdir: /repo", "--------",
    "model: expensive-model", "reasoning effort: max", "sandbox: danger-full-access [/]",
  ].join("\n");
  const f = parseBanner(forged);
  assert.equal(f.model, "cheap-model", "a field AFTER the banner block cannot overwrite the seat");
  assert.equal(f.effort, "high");
  assert.equal(f.sandbox, "read-only");
  // And the block itself excludes that forged tail.
  assert.doesNotMatch(bannerBlock(forged), /expensive-model/);
});

// ---------------------------------------------------------------- sensor-sweep-owed

test("classifyFragment scans the WHOLE fragment and prefers BINDING — the promotion case", () => {
  // classify() windows to the first 12 lines, which is right for a DOCUMENT and wrong for a
  // FRAGMENT. A replacement that flips the head marker below line 12 is a real promotion.
  const deep = Array(20).fill("filler").join("\n") + "\n> **CLASS: BINDING** — read it whole";
  assert.equal(classifyFragment(deep), "BINDING", "a marker below line 12 must still be seen");

  // Prefer BINDING even when a non-BINDING marker appears FIRST: the question for a fragment is
  // "does this write introduce BINDING text?", not "what does its head say".
  assert.equal(classifyFragment("CLASS: REFERENCE\nlater CLASS: BINDING"), "BINDING");

  // CLEAN SIDE — no marker, and a non-BINDING marker, are both correctly not-BINDING.
  assert.equal(classifyFragment("ordinary prose"), null);
  assert.equal(classifyFragment(""), null);
  assert.equal(classifyFragment("CLASS: REFERENCE only"), "REFERENCE");
});

test("AC-SKILL-TREES: the skill roots are the adopter's, matched case-insensitively on .md", () => {
  // A FOURTH tree appearing is the drift this pin exists to catch — the scope rule is written out
  // in the hook, so nothing else would notice.
  assert.deepEqual(SKILL_ROOTS, [".agents/skills", ".claude/skills", ".codex/skills"]);

  assert.ok(isSkillFile(".agents/skills/sweep/SKILL.md"));
  assert.ok(isSkillFile(".claude/skills/humanize/BULLET.MD"), "the budget checker lowercases too");
  // PLANTED: the KIT SOURCE tree is NOT an adopter tree, and a non-.md file is not a skill body.
  assert.equal(isSkillFile("skills/sweep/SKILL.md"), false);
  assert.equal(isSkillFile(".agents/skills/sweep/notes.txt"), false);
  assert.equal(isSkillFile(null), false);
});

test("sweepOwed fires on a BINDING doc and a skill body — and stays SILENT on ordinary work", () => {
  const governed = ["core/WORKFLOW.md", "core/GATES.md"];
  const readDoc = (r) => (r === "core/WORKFLOW.md" ? "> **CLASS: BINDING**" : "> **CLASS: REFERENCE**");

  // FIRES: editing a rule in a controlling document.
  assert.equal(sweepOwed("core/WORKFLOW.md", "some edit", { governed, readDoc }).reason, "binding-doc");
  // FIRES: a skill body, which other work depends on by name.
  assert.equal(sweepOwed(".agents/skills/sweep/SKILL.md", "x", { governed, readDoc }).reason, "skill-body");
  // FIRES: a fragment PROMOTING a governed doc to BINDING even though disk still says REFERENCE.
  assert.equal(sweepOwed("core/GATES.md", "> **CLASS: BINDING**", { governed, readDoc }).reason, "binding-doc");

  // SILENT — the scope gate. Without these the hook fires on nearly every file, which trains the
  // reader to switch it off; that is how controls actually die.
  assert.equal(sweepOwed("core/GATES.md", "ordinary edit", { governed, readDoc }), null,
    "a REFERENCE doc does not owe the pre-fold sweep");
  assert.equal(sweepOwed("src/index.mjs", "code", { governed, readDoc }), null, "ungoverned code is out of scope");
  assert.equal(sweepOwed("README.md", "docs", { governed, readDoc }), null, "an ungoverned doc is out of scope");
  assert.equal(sweepOwed("", "x", { governed, readDoc }), null);
});

test("a target is CANONICALISED before it is matched — `./core/X.md` is not a silent miss", () => {
  // Found by the cross-family seat on the frozen changeset. Every scope rule compares against
  // canonical repo-relative paths, so an ordinary `./core/WORKFLOW.md` from an apply_patch envelope
  // matched nothing and the sensor exited 0 having said nothing — a MISS that looks exactly like
  // "nothing was owed". Fails silently, which is the dangerous direction for a reminder.
  const root = "/repo", base = "/repo";
  assert.equal(toRepoRelative("./core/WORKFLOW.md", root, base), "core/WORKFLOW.md");
  assert.equal(toRepoRelative("core/WORKFLOW.md", root, base), "core/WORKFLOW.md");
  assert.equal(toRepoRelative("/repo/core/WORKFLOW.md", root, base), "core/WORKFLOW.md");
  assert.equal(toRepoRelative("./.agents/skills/x/SKILL.md", root, base), ".agents/skills/x/SKILL.md");
  // A relative patch path resolves against the APPLIER's cwd, which diverges from the repo root
  // whenever the session runs in a subdirectory — the reason resolvePatchBase exists.
  assert.equal(toRepoRelative("SKILL.md", root, "/repo/.agents/skills/x"), ".agents/skills/x/SKILL.md");
  // Outside the repo is not this sensor's business, and must not be coerced into a bogus relative.
  assert.equal(toRepoRelative("/elsewhere/x.md", root, base), null);
  assert.equal(toRepoRelative("../escape.md", root, base), null);
  assert.equal(toRepoRelative("", root, base), null);

  // PHYSICAL vs LEXICAL. `/tmp` is a symlink to `/private/tmp` on macOS and this kit's own suites
  // run under /tmp-rooted TMPDIRs, so a root registered through the link and a target reported
  // through the real path produced a `..` relative and BOTH sensors silently skipped the edit — on
  // a layout the kit explicitly supports, not a hostile one. Modelled with an explicit symlink so
  // the test proves the property anywhere, not just where /tmp happens to be linked.
  {
    const base = scratch();
    try {
      const real = path.join(base, "realrepo");
      const link = path.join(base, "linkrepo");
      mkdirSync(path.join(real, "core"), { recursive: true });
      writeFileSync(path.join(real, "core", "WORKFLOW.md"), "x");
      symlinkSync(real, link);
      assert.equal(toRepoRelative(path.join(real, "core", "WORKFLOW.md"), link, link), "core/WORKFLOW.md",
        "a root reached through a symlink still recognises its own file");
      // A file that does not exist YET (the create case) must still resolve — realpath throws on it,
      // and swallowing that would drop every new file.
      assert.equal(toRepoRelative(path.join(real, "core", "NEW.md"), link, link), "core/NEW.md");
      // …and genuinely-outside still returns null. The fix must not widen the sensor's reach.
      assert.equal(toRepoRelative(path.join(base, "elsewhere.md"), link, link), null);
    } finally { rmSync(base, { recursive: true, force: true }); }
  }

  // END TO END through the scope rule: the canonical spelling and the `./` spelling agree.
  const governed = ["core/WORKFLOW.md"];
  const readDoc = () => "> **CLASS: BINDING**";
  const viaDot = sweepOwed(toRepoRelative("./core/WORKFLOW.md", root, base), "edit", { governed, readDoc });
  assert.equal(viaDot?.reason, "binding-doc", "the `./` spelling now reaches the rule it always should have");
});

test("END TO END through main(): a `./`-spelled target still reaches the reminder", () => {
  // The round-1 path fix was proven only through the pure helpers, so REVERTING the call sites in
  // main() left those tests green — decorative for the integration point, as the round-2 seat said.
  // This drives the real stdin handler and asserts on what the hook actually WRITES.
  const dir = scratch();
  try {
    mkdirSync(path.join(dir, "core"), { recursive: true });
    writeFileSync(path.join(dir, "core", "WORKFLOW.md"), "> **CLASS: BINDING**\n\nrules");
    const ev = JSON.stringify({
      tool_name: "apply_patch",
      cwd: dir,
      tool_input: { command: "*** Begin Patch\n*** Update File: ./core/WORKFLOW.md\n+edited\n*** End Patch" },
    });
    const r = spawnSync(process.execPath,
      [path.join(ROOT_DIR, "hooks", "sensor-sweep-owed.mjs"), "--project-dir", dir],
      { input: ev, encoding: "utf8" });
    assert.equal(r.status, 0, "a SENSOR never denies — exit 0 even when it emits");
    assert.match(r.stderr, /SWEEP OWED/, "the `./` spelling reaches the reminder through the real wiring");
    assert.match(r.stderr, /core\/WORKFLOW\.md/, "…naming the canonicalised path, not the raw one");

    // CLEAN SIDE through the same wiring: ordinary ungoverned work stays silent.
    const quiet = JSON.stringify({
      tool_name: "apply_patch", cwd: dir,
      tool_input: { command: "*** Begin Patch\n*** Update File: ./src/app.mjs\n+code\n*** End Patch" },
    });
    const q = spawnSync(process.execPath,
      [path.join(ROOT_DIR, "hooks", "sensor-sweep-owed.mjs"), "--project-dir", dir],
      { input: quiet, encoding: "utf8" });
    assert.equal(q.status, 0);
    assert.doesNotMatch(q.stderr, /SWEEP OWED/, "ungoverned code owes nothing — noise here kills the control");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a DELETED or quoted marker does not promote, and one envelope target cannot speak for another", () => {
  // Both halves found by the cross-family seat. The design's premise is that a sensor firing on
  // ordinary work gets switched off, so a false FIRE here is a real defect, not harmless noise.
  const envDeletes = { tool_input: { command: '*** Update File: core/GATES.md\n-> **CLASS: BINDING** was here\n+plain text\n' } };
  const one = { shape: "apply_patch", targets: ["core/GATES.md"], ok: true };
  assert.doesNotMatch(incomingText(envDeletes, one, "core/GATES.md"), /CLASS: BINDING/,
    "a REMOVED line is not an addition — reading it as one inverts the meaning");

  // …so a REFERENCE doc whose hunk merely deletes the marker stays silent.
  const governed = ["core/GATES.md"];
  const readDoc = () => "> **CLASS: REFERENCE**";
  assert.equal(sweepOwed("core/GATES.md", incomingText(envDeletes, one, "core/GATES.md"), { governed, readDoc }), null);

  // MULTI-target: each file gets ITS OWN section, so the promotion fires on the file being promoted
  // and the sibling stays silent. Getting this wrong failed in BOTH directions one review round
  // apart — first the whole envelope went to every target (false FIRE on siblings), then a
  // multi-target envelope went to nobody (false SILENCE on the load-bearing promotion, since the
  // pre-write disk class still reads REFERENCE and the obligation is PRE-fold). Both are asserted
  // here so neither can come back.
  const multi = { shape: "apply_patch", targets: ["core/GATES.md", "core/WORKFLOW.md"], ok: true };
  const envMulti = { tool_input: { command:
    "*** Begin Patch\n*** Update File: core/GATES.md\n+> **CLASS: BINDING**\n*** Update File: core/WORKFLOW.md\n+unrelated edit\n*** End Patch" } };
  assert.equal(sweepOwed("core/GATES.md", incomingText(envMulti, multi, "core/GATES.md"), { governed, readDoc })?.reason,
    "binding-doc", "the file BEING PROMOTED fires, even though a second file is in the same patch");
  assert.equal(sweepOwed("core/WORKFLOW.md", incomingText(envMulti, multi, "core/WORKFLOW.md"), { governed, readDoc }), null,
    "…and the sibling does NOT inherit the other file's marker");
  // Envelope grammar is nobody's content — a section must not carry the closing marker.
  assert.doesNotMatch(incomingText(envMulti, multi, "core/WORKFLOW.md"), /\*\*\* End Patch/);

  // CLEAN SIDE — the promotion case this fragment exists for still fires on a single-target add.
  const single = { shape: "apply_patch", targets: ["core/GATES.md"], ok: true };
  const promote = { tool_input: { command: '*** Update File: core/GATES.md\n+> **CLASS: BINDING**\n' } };
  assert.equal(sweepOwed("core/GATES.md", incomingText(promote, single, "core/GATES.md"), { governed, readDoc })?.reason,
    "binding-doc", "a real single-target promotion must STILL fire — the fix must not silence it");

  // …and the Claude lane is untouched by any of this.
  assert.equal(incomingText({ tool_input: { new_string: "> **CLASS: BINDING**" } }, { shape: "claude", targets: ["a"] }, "a"),
    "> **CLASS: BINDING**");
});

test("the sweep sensor holds NO class regex of its own — one home for the marker pattern", () => {
  // Two transcriptions of one mechanical fact silently differ. The hook imports CLASS_RE; a second
  // copy here is the drift shape, so this asserts the SENTENCE of the design, not a word.
  const src = readFileSync(new URL("../hooks/sensor-sweep-owed.mjs", import.meta.url), "utf8");
  const body = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(body, /\/\\bCLASS:/, "no inlined CLASS: regex — import it from check-doc-size.mjs");
  assert.match(body, /import \{[^}]*CLASS_RE[^}]*\} from "\.\.\/scripts\/check-doc-size\.mjs"/);
});

// ---------------------------------------------------------------- sensor-mutation-owed

test("owesMutationRecord covers checks, hooks in ALL THREE tree spellings, and control tests", () => {
  // FIRES — a mechanical check.
  assert.equal(owesMutationRecord("scripts/check-doc-size.mjs"), "a mechanical check");
  // FIRES — the same hook file under each of the three roots it legitimately lives at. The kit
  // ships ONE hook source to two lanes, so a rule matching only `.claude/hooks/` goes QUIET in the
  // kit's own tree and in the Codex lane — where the identical control is running.
  for (const root of ["hooks", ".claude/hooks", ".codex/hooks"]) {
    assert.equal(owesMutationRecord(`${root}/guard-lane-authoring.mjs`), "a gate hook", root);
    assert.equal(owesMutationRecord(`${root}/sensor-sweep-owed.mjs`), "a gate hook", root);
  }
  // FIRES — a control's test.
  assert.equal(owesMutationRecord("tests/kit-controls.test.mjs"), "a control's test");
  // FIRES — THE COMMIT FLOOR. Every other pattern here keys on a file-NAMING convention, and the
  // kit's most important control is named `pre-commit` and matches none of them. A sensor covering
  // the tripwires while silent on the floor is exactly inverted. (Adversarial walk-through, v2.2.0.)
  assert.equal(owesMutationRecord("githooks/pre-commit"), "the every-lane commit floor");
  assert.equal(owesMutationRecord(".githooks/pre-commit"), "the every-lane commit floor");

  // SILENT — ordinary work. Narrow scope is what keeps the sensor from being switched off.
  assert.equal(owesMutationRecord("src/app.mjs"), null);
  assert.equal(owesMutationRecord("core/WORKFLOW.md"), null);
  assert.equal(owesMutationRecord("scripts/sweep.mjs"), null, "not a check-* control");
  assert.equal(owesMutationRecord("tests/fixtures.mjs"), null, "not a .test. file");
  assert.equal(owesMutationRecord(""), null);
  assert.equal(owesMutationRecord(null), null);
});

test("the mutation emission demands BOTH polarities and claims no enforcement", () => {
  const t = emissionText("scripts/check-doc-size.mjs", "a mechanical check");
  // The two-sidedness is the whole point: three of the four measured defects were coverage
  // NARROWER than claimed, and the fourth — WIDER — was introduced by the fix for the third.
  assert.match(t, /\(1\) POSITIVE/);
  assert.match(t, /\(2\) NEGATIVE/);
  assert.match(t, /STAYS GREEN/);
  // It must never imply it verified anything.
  assert.match(t, /CANNOT tell whether you ran anything/);
  assert.match(t, /it never blocks/);
});
