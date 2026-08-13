// tests/gating-doctrine.test.mjs — the v2.2 settled-gating-doctrine port.
//
// ⚠ HOW THESE ASSERTIONS ARE BUILT, AND WHY IT MATTERS (lesson: a doc-pinning grep is DECORATIVE
// when its spelling occurs innocently elsewhere in scope). Every assertion below names a PHRASE
// long enough to be unique to the clause it pins, and each was proven by STRIKING THAT EXACT PHRASE
// from the document and watching this file go red. A pin on a single word — "frontier", "sweep",
// "cap" — would pass against a document that had lost the rule entirely, because those words occur
// innocently in a dozen other sentences. Pin the SENTENCE, never the word.
//
// What these DO and DO NOT prove: they prove a clause is PRESENT and reachable in the shipped text.
// They cannot prove it is followed — no test can, and `core/GATES.md` § Retired before shipping
// records the control that tried and was discarded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { governedFiles } from "../scripts/check-skill-budgets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Whitespace-FLATTENED on purpose. A clause that wraps across a line still matches, so these pins
// survive a reflow — and a pin that broke on rewrapping would be pinning typography, not the rule.
// (This is a measured trap: a grep once returned zero on a correct document purely because the
// phrase had wrapped, which — believed — would have had an agent "fix" a file that was already right.)
const raw = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
// Line-leading blockquote markers are stripped for the same reason: `> ` is how a callout is
// TYPED, not part of the rule, and a clause that wraps inside a blockquote would otherwise read as
// "Do > not read it…".
const read = (rel) => raw(rel).replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");

// ---------------------------------------------------------------- routing reversal

test("GATES routes Gemini to DESIGNS and states the coverage REDUCTION instead of glossing it", () => {
  const g = read("core/GATES.md");
  assert.match(g, /GEMINI REVIEWS DESIGNS, NOT DIFFS/);
  // ⚠ PIN THE TABLE ROWS, NOT ONLY THE PROSE AROUND THEM. The routing decision LIVES in the table;
  // a future edit could reverse or delete either row while every explanatory sentence below stayed
  // intact, and a prose-only pin would pass against a document that had lost the actual routing.
  // (An earlier cut of this test named the rule and asserted everything except it.)
  assert.match(g, /\| \*\*Claude\*\* \| \*\*Gemini\*\* \(`--design`\) \| \*\*Codex\*\*/,
    "Claude-built: design gate → Gemini in DESIGN mode, code gate → Codex");
  assert.match(g, /\| \*\*Codex\*\* \| \*\*Gemini\*\* \(`--design`\) \| \*\*Claude Code\*\*/,
    "Codex-built: Gemini STILL design-mode, and the code gate moves to Claude — Codex cannot gate itself");
  // The honesty clause is the load-bearing half. A routing change that quietly calls the new shape
  // "equivalent" is the failure this sentence exists to prevent.
  assert.match(g, /THIS IS A REDUCTION IN CROSS-FAMILY COVERAGE OF THE CODE — say so, do not call it equivalent/);
  assert.match(g, /Accepted because an unreliable seat is not coverage/);
  // …and it must say WHAT the reduced lens can no longer catch, or "reduction" is an empty word.
  assert.match(g, /it cannot catch an implementation defect with no design-level shadow/);

  // The precondition. Without it the route collapses to one family with every box ticked.
  assert.match(g, /PRECONDITION — the Codex COLD PANEL must be hijack-proofed, or this route collapses to one family/);
  assert.match(g, /MUST run through a guarded site/);

  // Code mode survives only as a bounded escape, not as the standing route.
  assert.match(g, /is DEMOTED to a documented escape — no longer the standing route/);
  assert.match(g, /only within the INLINE envelope/);

  // The superseding is EXPLICIT: the old blocks stay for their evidence but must not read as live.
  assert.match(g, /SUPERSEDED 2026-07-28 — read the ruling above first/);
  assert.match(g, /Do not read it as licence to run a code-mode gate/);
});

// ---------------------------------------------------------------- the frontier cap

test("the one-frontier-firing cap names its default consumer, its carve-outs, and its own weak point", () => {
  const g = read("core/GATES.md");
  assert.match(g, /THE FRONTIER TIER IS CAPPED AT ONE FIRING PER CHANGESET/);
  // "Changeset" must be pinned to the TASK, or re-freezing after a fix mints a fresh allowance.
  assert.match(g, /the task, not the file version/);
  assert.match(g, /Default consumer: the fold-check on a remediation delta/);
  // Competition, not addition — the sentence that stops the cap being read as "one EACH".
  assert.match(g, /compete for that one budget and are never additive/);
  assert.match(g, /requesting is not authorizing/);
  // The carve-outs, each of which would otherwise be unreachable or double-counted.
  assert.match(g, /the cap governs REVIEW and CONSULT firings, and a decider is neither/);
  // A cap nobody counts is not a control — the sentence that keeps this from being decorative.
  assert.match(g, /A cap with no recorded count is not a control/);
});

test("round-3 escalation is ONE rung, exempt from the cap, and bounded by a mechanical trigger", () => {
  const g = read("core/GATES.md");
  assert.match(g, /Escalation is ONE rung: the seat moves to the frontier tier at `high`, on round 3/);
  // Without the exemption this rung could never fire — the fold-check has already spent the budget.
  assert.match(g, /EXEMPT from the one-per-changeset cap/);
  assert.match(g, /worst case two firings, and only where one finding-class has failed twice/);
  // Escalation must not become approval-shopping.
  assert.match(g, /Escalation is a FOLDED ADJUDICATION, not a blind re-review/);
});

// ---------------------------------------------------------------- the alias-entitlement trap

test("an entitlement error is not a verdict, and the retry branches on WHICH id failed", () => {
  const g = read("core/GATES.md");
  assert.match(g, /AN ENTITLEMENT ERROR IS NOT A REVIEWER VERDICT/);
  assert.match(g, /WHICH ID FAILED DECIDES WHETHER YOU RETRY AT ALL. THERE IS NO BLANKET RETRY/);
  // The concrete-id branch is the one that gets this wrong in practice: a re-run cannot discriminate.
  assert.match(g, /an identical re-run cannot discriminate and only manufactures the appearance of a second data point/);
  // And the whole clause is worthless without this: an error is never a pass.
  assert.match(g, /no verdict still means no pass/);
  assert.match(g, /Always pass the effort flag explicitly/);
});

test("the model·effort matrix names capability TIERS, not vendor model ids", () => {
  const g = read("core/GATES.md");
  assert.match(g, /MAP THE TIERS BY CAPABILITY, NOT BY ROLE NAME/);
  assert.match(g, /Standing effort is `high`/);
  // A portable kit must not bind an adopter to one vendor's lineup in a [P] doc. The matrix rows
  // are the place that regresses first, so pin the rows themselves.
  assert.match(g, /\*\*Any T2, or routine T3\*\*.*\|\s*\*\*workhorse · high\*\*\s*\|\s*\*\*workhorse · high\*\*\s*\|/);
  assert.match(g, /\*\*Irreversible prod write.*\|\s*\*\*frontier · xhigh\*\*\s*\|\s*\*\*frontier · xhigh\*\*\s*\|/);
});

// ---------------------------------------------------------------- rung order (WORKFLOW)

test("rung ORDER binds, and says WHICH of its two rules is mechanically checkable", () => {
  const w = read("core/WORKFLOW.md");
  assert.match(w, /Rung ORDER binds — two rules, wherever a tier has that rung/);
  // The honesty half: claiming both rules are covered when only one is recorded would be exactly
  // the "manufactured assurance" this corpus keeps paying for.
  assert.match(w, /they are NOT equally checkable — say which is which rather than implying both are covered/);
  assert.match(w, /so it is \*\*self-report only\*\*/);
  assert.match(w, /The BUDGET-FREE rungs run FIRST/);
  assert.match(w, /before any code exists/);
  // The rule that stops a cheap green from buying a lighter panel.
  assert.match(w, /"The budget-free rungs cleared it, so the panel can be lighter" is FORBIDDEN/);
  // The tier table must actually carry the rungs the block governs, or the rule points at nothing.
  assert.match(w, /\*\*T2\*\*\s*\|\s*pre-flight → \*\*contract lens, PRE-CODE\*\* → cold panel/);
  assert.match(w, /\*\*T1\*\*\s*\|\s*pre-flight → one blind cold reviewer \(\*\*cross-family by default\*\*\)/);
});

test("WORKFLOW describes the gate-ladder sensor as it ACTUALLY behaves since v2.1", () => {
  const w = read("core/WORKFLOW.md");
  // Two claims that were stale: the exempt tier, and "Claude lane only".
  assert.match(w, /including a tiered `exempt`, whose tier it deliberately does \*\*not\*\* honour/);
  assert.match(w, /Since kit v2\.1 it registers in \*\*both\*\* lanes/);
  assert.match(w, /the Codex-lane registration is inert until a human grants hook trust/);
  assert.doesNotMatch(w, /Claude lane only\./,
    "the sensor has registered in both lanes since v2.1 — this claim shipped stale for one release");
});

test("the pre-fold sweep is stated as a CEREMONY, never as a proof", () => {
  const w = read("core/WORKFLOW.md");
  assert.match(w, /Amending a `CLASS: BINDING` document owes a dependency sweep before the edit is folded/);
  // The half that keeps a sweep report from being read as a clear.
  assert.match(w, /It is a ceremony, not a proof: the sweep's file list is chosen by whoever runs it, so a report closes nothing on its own/);
  // The skill it names must exist in BOTH lanes, or the instruction dead-ends.
  assert.match(w, /`\/sweep`/);
  for (const p of ["skills/sweep/SKILL.md", "skill-shims/claude/sweep.md", "skill-shims/codex/sweep.md"]) {
    assert.ok(existsSync(path.join(ROOT, p)), `${p} must exist or /sweep dead-ends`);
  }
});

// ---------------------------------------------------------------- REVIEW

test("REVIEW bounds a code-mode cross-family run by TRANSPORT, not by assembly limits", () => {
  const r = read("core/REVIEW.md");
  assert.match(r, /those are assembly limits, not an ingestion budget/);
  assert.match(r, /an ESCAPE bounded by the transport's inline envelope or an approved slice plan/);
  // The substitution path is where this is most often forgotten.
  assert.match(r, /A design-mode lens substituting into a CODE seat is bounded by transport/);
  assert.match(r, /never an unqualified swap/);
});

test("REVIEW names contract OMISSION as the residual only the free adversary defends against", () => {
  const r = read("core/REVIEW.md");
  assert.match(r, /The residual only the free adversary defends against is contract OMISSION/);
  // The argument, not just the label: every other seat is pointed at something that EXISTS.
  assert.match(r, /Every other seat is pointed at something that EXISTS/);
  assert.match(r, /A clause the contract never wrote has no line to review, no spelling to match and no finding to fold/);
  // …which is WHY the free adversary owns no dimension. Without this the two facts look unrelated.
  assert.match(r, /owning one would point it at something that exists/);
});

test("REVIEW's single-reviewer seat is cross-family by default, with no escape on a core/ file", () => {
  const r = read("core/REVIEW.md");
  assert.match(r, /that seat is CROSS-FAMILY by default/);
  assert.match(r, /the escape is unavailable on any `core\/` file/);
  // The named gap — an accepted weakness must never read as a cleared one.
  assert.match(r, /"T1 passed" must never be read as "T1 was decorrelated"/);
});

test("REVIEW's packet rules survive the two ways they are usually broken", () => {
  const r = read("core/REVIEW.md");
  assert.match(r, /A filename blocklist is not exclusion; only packet CONTENTS are/);
  assert.match(r, /The packet MUST carry every new or changed file in full/);
  // The counter-intuitive one, and the reason it is stated at all.
  assert.match(r, /Do not answer a leak risk by taking the seat's tools away/);
  assert.match(r, /trades a bounded leak for an unbounded blind spot/);
  assert.match(r, /No unproven universals/);
});

// ---------------------------------------------------------------- the retired-adjudication lesson

test("the retired commit-time adjudication control is recorded as DO NOT REBUILD, with its reason", () => {
  const g = read("core/GATES.md");
  assert.match(g, /Retired before shipping: commit-time gate-adjudication records/);
  assert.match(g, /Round counting is a \*\*conversation\*\* fact, not a \*\*tree\*\* fact/);
  // The measured result is what makes this a finding rather than an opinion.
  assert.match(g, /8 consecutive code commits, all accepted, 1 permit in history, zero dispositions recorded/);
  // The generalisation that bounds what the kit's own commit floor may claim.
  assert.match(g, /A commit-time hook is a tripwire for \*forgetting\*, never a boundary/);
  // …and it must connect to the WORKFLOW clause it justifies, or the two drift apart.
  assert.match(g, /This is why `core\/WORKFLOW\.md` § Gate says no hook counts rounds/);
  assert.match(read("core/WORKFLOW.md"), /No hook counts it/);
});

test("the shipped gate runner's DEFAULT effort agrees with the matrix it serves", () => {
  // A runner whose default contradicts the doctrine it serves is the sharpest form of a doc lie:
  // an adopter who simply runs it gates at the RARE-cell effort believing they are at the norm.
  // This shipped `xhigh` while the matrix names `high` as standing effort — caught by being bitten
  // (this kit's own release gate was launched on the default and had to be relaunched).
  //
  // Scoped to the ASSIGNMENT, not to the file: `xhigh` legitimately appears in this script's own
  // documentation of the rare cell, so a whole-file grep would prove a spelling, not the default.
  const sh = raw("scripts/codex-gate.sh");
  const assign = /^MODEL="[^"]+"; EFFORT="([a-z]+)"/m.exec(sh);
  assert.ok(assign, "the runner still declares its seat default in one place");
  assert.equal(assign[1], "high", "standing effort per core/GATES.md § Model · effort matrix");

  // …and inheriting a seat must be VISIBLE, because the same matrix says to bind -m/-e explicitly.
  assert.match(sh, /MODEL_SET=1/);
  assert.match(sh, /EFFORT_SET=1/);
  assert.match(sh, /seat NOT fully bound on the command line/);
  // Behavioural proof was executed by hand BOTH ways (unbound ⇒ effort=high + the NOTE; bound ⇒ no
  // NOTE) and is recorded in the PR. It is not re-run here because reaching that line spends a real
  // model call — stating the limit rather than implying this test covers it.
});

// ---------------------------------------------------------------- coverage honesty, the kit's own shape

test("CHARACTERIZATION: the kit's governed-file census reads the FILESYSTEM, so it sees untracked files", () => {
  // WHY THIS TEST EXISTS, and why it is a characterization rather than a fix.
  //
  // The repo this method came from had a real defect here: its census enumerated with `git
  // ls-files`, i.e. TRACKED files only, so a file being ADDED was invisible to every run during its
  // own build — a checker that reported "0 problems" on a tree whose new file was the problem.
  //
  // The kit does NOT have that defect: `governedFiles()` walks the filesystem. Porting the census
  // fix would therefore be porting a remedy for a defect this kit never had. What IS worth having
  // is a PIN: today's immunity is an accident of implementation, and a future refactor to `git
  // ls-files` would reintroduce the defect silently. This test makes that refactor loud.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-census-"));
  try {
    mkdirSync(path.join(dir, "skills", "brand-new"), { recursive: true });
    writeFileSync(path.join(dir, "skills", "brand-new", "SKILL.md"), "---\nname: x\n---\nbody");
    // No `git init`, no `git add` — this file is untracked by construction, which is exactly the
    // state a file is in while the changeset that introduces it is being checked.
    const { files } = governedFiles("skills", { root: dir });
    assert.ok(files.includes("skills/brand-new/SKILL.md"),
      "an UNTRACKED governed file must be inside the denominator — a census that misses it clears its own build");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- v2.6.0 claim honesty

test("PORTABILITY states EXACTLY what each of the Owner's three requests got, and cannot over-claim in either direction", () => {
  // WHY A PIN. v2.6.0 ships doctrine for three things the Owner asked for and a mechanism for
  // almost none of them. A reader who meets "the sensor was extended" without the breakdown infers
  // the complaint was mechanized.
  //
  // ⚠ AND WHY THIS PIN IS SHAPED THE WAY IT IS. Its first version pinned the sentence "NONE of those
  // three gets a mechanical check", which was FALSE — the size-mismatch check had been testing a
  // narrow case of succinctness since v1.3, and this same file says so four paragraphs earlier. The
  // pin hardened the falsehood. So this version pins
  // BOTH directions: the claim may not shrink (a check that exists must stay named) and it may not
  // grow (a check that does not exist must not appear). A disclosure can over-claim its own modesty.
  const p = read("PORTABILITY.md");
  // The one check that DOES exist must be named, with the condition that bounds it — an unbounded
  // "succinctness is checked" would be the opposite over-claim.
  assert.match(p, /the size-mismatch check — it fires \*\*only\*\* when the Owner asked a question of 12 words or fewer/,
    "the ONE existing check is named, with the condition under which it fires");
  // The two that do NOT exist must stay marked as absent.
  assert.match(p, /\| avoid walls of text \| \*\*none\*\* \|/, "walls of text: no mechanism, stated");
  assert.match(p, /\| use bullet points and tables \| \*\*none\*\* \|/, "bullets and tables: no mechanism, stated");
  assert.match(p, /So one of the three has a narrow check and two have nothing — and this release adds no check at\s+all\./,
    "…and the summary states BOTH the split and that this release adds nothing to it");
  // The release ships doctrine and no mechanism. That is the fact most likely to be quietly rounded
  // up later into "the sensor was extended", which is what the whole disclosure exists to prevent.
  // Copied from the source, not from memory: writing a needle from recollection has produced four
  // false alarms in this file's history — wrong article, wrong asterisk placement, a curly
  // apostrophe. Pin the load-bearing GENERALISATION, which is the sentence a later editor would
  // most want to drop, rather than the narrative around it.
  assert.match(p, /check was\s+built, reviewed, and withdrawn/,
    "…records that a check was built and dropped, so 'unbuilt' cannot be read as 'never attempted'");
  assert.match(p, /A predicate over an\s+unbounded input space cannot be completed by widening/,
    "…and states WHY, in the form a successor can act on");
  // Rule 8 must stay a FOURTH thing, or "one of three" reads as "the release did nothing".
  assert.match(p, /came out of the same feedback but is a fourth\s+thing/,
    "rule 8 is named as a fourth thing, not as one of the three");
  // THE RETRACTION ITSELF IS PINNED. The false sentence must not return, and the record of why it
  // was false must not be quietly dropped — a correction deleted is a correction that never happened.
  assert.doesNotMatch(p, /NONE of those three gets a mechanical check/,
    "the false categorical must not return");
  assert.match(p, /A disclosure can over-claim its own modesty, and that is still an\s+over-claim/,
    "the retraction stays in the file, with its reason");
  // CROSS-SURFACE. The false categorical was written on THREE surfaces and corrected on one at a
  // time; a pin on a single file passes while the other two still ship it. This is the mirror of the
  // kit's own cross-surface retraction rule: a correction that lands on one surface and not its
  // mirrors leaves the old claim shipping.
  for (const [file, text] of [["README.md", read("README.md")], ["hooks/guard-owner-comms.mjs", read("hooks/guard-owner-comms.mjs")]]) {
    assert.doesNotMatch(text, /none of the three gets a mechanical check/i,
      `${file} must not carry the retracted categorical`);
    assert.doesNotMatch(text, /All three (?:are|get) doctrine only/i,
      `${file} must not carry its second half either`);
  }
  // …and the canary: the patterns must still bite, or the two assertions above are decoration.
  for (const decoy of ["none of the three gets a mechanical check", "All three are doctrine only"]) {
    assert.ok(/none of the three gets a mechanical check/i.test(decoy) || /All three (?:are|get) doctrine only/i.test(decoy),
      "the retraction patterns still match their own retracted spelling");
  }

  // Hedges in the other direction stay barred.
  for (const hedge of [/sensor (?:now )?covers (?:the |all )?(?:wall|brevity)/i, /partially mechanized/i]) {
    assert.doesNotMatch(p, hedge, `the disclosure must not be hedged by "${hedge}"`);
  }
});

// ---------------------------------------------------------------- the blinded seat

// MEASURED IN THIS REPO, 2026-08-12, on codex-cli 0.147.0-alpha.6.5, one variable changed:
//   with `--disable code_mode_host` the seat answered CANNOT-READ (router: `error=code-mode host
//   is disabled`) and the process EXITED 0; without it, same prompt/model/repo/sandbox, it quoted
//   the requested line byte-for-byte. `codex features list` reports code_mode_host stable+default-on.
// The flag is therefore a FAIL-OPEN: the payload still reaches the seat over the prompt, so a
// blinded gate seat returns a fluent, on-topic, severity-ranked verdict resting on nothing it
// could check, and nothing in the exit code distinguishes it from a healthy gate.

test("no shipped runner disables the seat's file access", () => {
  // Pin the ABSENCE in the runners and the PROHIBITION in the doc — never the absence alone. An
  // absence pin passes just as well against a file someone deleted, and it cannot say WHY.
  //
  // Zero occurrences, not "no --disable pairing": the spelling is short enough that a partial
  // pattern would let a reformatted re-add (a variable, a line continuation, an array element)
  // slip through. core/GATES.md states the same check as `grep -n code_mode_host <runner>` must
  // return nothing, so this is that documented check's mechanical twin.
  for (const runner of ["scripts/codex-gate.sh", "scripts/sweep.mjs"]) {
    assert.doesNotMatch(raw(runner), /code_mode_host/,
      `${runner} must not disable code mode — it blinds the seat and still exits 0`);
  }

  // …and the canary, because the two assertions above are decoration if the pattern cannot bite.
  // This is the exact text that shipped at e782f15, in both of its shipped spellings (shell argv
  // and the JS array element in sweep.mjs).
  for (const decoy of [
    'codex exec -s read-only --disable code_mode_host -m "$MODEL"',
    '"-s", "read-only", "-C", repoAbs, "--disable", "code_mode_host"',
  ]) {
    assert.match(decoy, /code_mode_host/, "the absence pattern still matches its own removed spelling");
  }
});

test("GATES states the flag as a PROHIBITION with its measurement, not as defensive insurance", () => {
  const g = read("core/GATES.md");

  // The canonical invocation is the line a reader PASTES — the exposed operator is the careful one
  // who follows the documented hand-run instead of the tooling. Pin the block itself, not the prose
  // around it: an edit could correct every rationale below and leave the paste line blinding.
  assert.match(g, /codex exec -s read-only -m <model> -c model_reasoning_effort=<effort>/,
    "the copy-paste invocation must not carry the flag");
  assert.doesNotMatch(g, /codex exec -s read-only --disable code_mode_host/,
    "…and the blinding form must not survive anywhere in the doc as a pasteable line");

  // The instruction must be a prohibition. "keep it (defensive)" is the exact compressed form that
  // shipped, and it is what made a correctly-verified 0.144 finding into a live defect.
  assert.doesNotMatch(g, /keep it \(defensive\)/i, "the retracted instruction must not still ship");
  assert.doesNotMatch(g, /Keep (?:it )?as (?:cheap )?cross-version insurance/i,
    "…nor its second spelling in Gotchas — a correction on one surface only leaves the other shipping");
  assert.match(g, /DO NOT PASS IT/);

  // The MEASUREMENT is load-bearing: without the version and the exit code this reads as taste.
  assert.match(g, /0\.147\.0-alpha\.6\.5/, "the version the measurement was taken on");
  assert.match(g, /still exited 0/, "the fail-open, which is the whole reason it went unnoticed");

  // ⚠ THE GENERAL RULE LIVES IN WORKFLOW, AND GATES MUST NOT MIRROR IT.
  // GATES.md declares itself CLASS: REFERENCE — "missing a section here costs you an invocation
  // detail, never a rule" — with a single enumerated exception. A rule shipped here would be an
  // unlisted second exception, i.e. the file contradicting its own class declaration. And a COPY is
  // a second thing to keep in step: the mirror class is what the previous release spent most of its
  // findings on. So this asserts BOTH halves — the rule is in WORKFLOW, and GATES points rather
  // than restates. Either half alone passes on the broken arrangement.
  const w = read("core/WORKFLOW.md");
  assert.match(w, /RE-VERIFY A VERSION-SPECIFIC FLAG BEFORE RELYING ON IT, NOT ONLY BEFORE DROPPING IT/i,
    "the RULE belongs in core/WORKFLOW.md § Gate, which is BINDING");
  assert.doesNotMatch(g, /re-verify a version-specific flag before RELYING on it/i,
    "core/GATES.md must POINT at the rule, never carry a copy of it — a copy is a new mirror");
  assert.match(g, /is `core\/WORKFLOW\.md` § Gate\. It is a RULE, not an invocation detail/,
    "…and the pointer must say WHY it is not here, or a later editor helpfully copies it back");

  // The rule has to state the asymmetry, or it is the same one-directional clause it replaces.
  assert.match(w, /never fires, because nobody drops a flag they were told to keep/i);
  // …and carry the fact that makes it more than taste: the original verification was CORRECT.
  assert.match(w, /CORRECT WHEN MADE/i);

  // ⚠ THE GENERAL FORM, landed beside the dependency sweep because that is where it bit. A control
  // that cannot reach its target reports "nothing found", which is shaped exactly like "all clear".
  // Pinned in WORKFLOW because it is a rule about controls, not an invocation detail.
  assert.match(w, /A BLIND VERIFICATION TOOL RETURNS SUCCESS/);
  assert.match(w, /Prove the tool can see before you believe what it did not find/i);
  // The instance must travel with it — the sweeper itself was the blind verifier, found inside its
  // own fix. Without the instance the rule reads as a maxim nobody has paid for.
  assert.match(w, /the sweep runner itself was launching its seat with file access disabled/i);

  // A re-add must cost evidence, or the prohibition decays back into "keep it, defensive".
  assert.match(g, /re-add it only with a canary proving the seat can still quote a file it was NOT given/i);
});

test("GATES' traps entry gives the SYMPTOM, the detection, and the caveat that makes detection work", () => {
  const g = read("core/GATES.md");

  // The symptom, stated as the three properties a blinded seat still satisfies — this is the
  // sentence that connects the trap to the sufficiency test.
  assert.match(g, /A BLINDED SEAT EXITS 0, AND ITS VERDICT IS REAL, ON-TOPIC AND SEVERITY-RANKED/);

  // The detection.
  assert.match(g, /ask the seat to quote an exact line of a file \*\*that was not in its payload\*\*|quote an exact line of a file that was not in its payload/i);

  // ⚠ THE CAVEAT IS THE LOAD-BEARING HALF. Without it the detection silently fails: the packet
  // contract carries every changed file IN FULL, so a blinded seat quotes a changeset file from
  // what it was handed and passes the check. A detection method that can be satisfied by the
  // failure it targets is not a control at all — it is the failure wearing the control's uniform.
  assert.match(g, /A file from the changeset does not work/i);

  // The flag can arrive in a runner you copied rather than a command you typed — this is how it
  // reached three call sites here and why the check names the runner, not the invocation.
  assert.match(g, /the flag can hide in a runner you copied rather than a command you typed/i);

  // ⚠ THE CLAIM MUST CARRY ITS EVIDENCE, because this exact sentence shipped as an INFERENCE stated
  // in a measurement's voice and was corrected mid-changeset. A doctrine page asserting that a
  // blinded verdict is indistinguishable, with no citation, is the thing it warns against.
  assert.match(g, /MEASURED 2026-08-12, not inferred/i, "the silence claim must name itself as measured");
  assert.match(g, /n=3 per arm/i, "…with the sample size, because n=1 is not a difference");

  // The finding that defeats the obvious objection ("surely the seat would say something"). Its
  // hedging is accurate — about packet gaps. That is why blindness is invisible from inside.
  assert.match(g, /hedging tracks PACKET completeness, not SOURCE access/i);

  // The bound travels with the claim or the claim over-reaches.
  assert.match(g, /proves the CAPABILITY is gone, not that blinding harms a review with no planted defect/i);

  // ⚠ A RULE WAS REMOVED FROM HERE, DELIBERATELY. An earlier cut of this changeset added an
  // "ask for the receipt" obligation binding reviewers, lanes and orchestrators — a RULE, in a file
  // whose own header declares CLASS: REFERENCE, "never a rule", with one enumerated exception.
  // A cold seat caught it as an invariant FAIL and was right: pre-existing class doctrine outranks
  // a good addition. Relocating it was not available either — core/WORKFLOW.md has 93 bytes of
  // headroom. So it was deleted rather than moved or softened, and this asserts it stays deleted.
  assert.doesNotMatch(g, /owes the receipt on request/i,
    "core/GATES.md is CLASS: REFERENCE — it must not re-acquire a rule binding people");

  // ⚠ THE ANTI-INSTRUCTION. The measured hedging behaviour makes "look for hedging" an actively
  // WRONG reading of this trap, and it is the reading a hurried editor will reach for. Stating the
  // finding is not enough — the wrong conclusion has to be closed off by name.
  assert.match(g, /NEVER WRITE THIS CHECK AS "LOOK FOR HEDGING"/);
  assert.match(g, /it is not the signal/i);

  // A seat can confabulate its METHOD, not only its findings — which retires any control that reads
  // the seat's own account of its work. A self-reported scope line is written just as fluently by a seat that read nothing.
  assert.match(g, /checking the contract directly against the current source/i,
    "the confabulated-process instance, quoted, because the general claim is unbelievable without it");
  assert.match(g, /Check the artifact, never the account/);

  // A detected-blind run is VOID and must be re-run COLD. Resuming inherits the thread, not the
  // eyesight — a warm re-ask of a blinded thread launders the same blindness into a second verdict.
  assert.match(g, /re-run it cold, never `--resume` it|A run detected blind is VOID/i);
});

// ------------------------------------------------- the sufficiency test, and what it cannot reach

test("the sufficiency test demands evidence the payload could NOT have supplied", () => {
  // THE DEFECT THIS FIXES: "real, on-topic, severity-ranked" are exactly the three properties a
  // BLINDED seat still produces from the payload alone. The kit's stated test for a bankable
  // verdict could not discriminate the failure it most needed to catch — and the agy lane's
  // fail-open (exit 0, empty stdout) produces no output to apply the test to at all.
  const g = read("core/GATES.md");
  const sh = read("scripts/codex-gate.sh");

  // ⚠ COUNT, DO NOT MATCH. GATES.md carries the sufficiency test at TWO sites in two spellings
  // (:505's variant had already dropped "severity-ranked"). A single `assert.match` is satisfied by
  // EITHER, so striking one leaves the test green while that surface still ships the old rule —
  // proven by mutation: two separate strikes both passed against a one-match assertion. That is the
  // cross-surface failure this kit names by name, committed inside the pin meant to prevent it.
  const CITES = /cit(?:es|ing) evidence the payload did not contain/gi;
  assert.equal((g.match(CITES) || []).length, 2,
    "BOTH of GATES.md's sufficiency sites must carry it — a one-match pin passes on a half-corrected doc");
  assert.match(sh, CITES, "the runner's own verify comment must carry it too");

  // The discrimination sentence — without it, the new clause reads as one more adjective rather
  // than as the only one of the four that can fail a blinded seat.
  assert.match(g, /only the last discriminates/i);

  // ⚠ THE HONEST BOUNDARY, and it is the half most likely to be dropped as pedantry. The
  // cite-outside test catches BLINDING and does NOT catch FAMILY DEGRADATION: a hijacked
  // Claude-companion review holds real tools, reads real files, and cites evidence outside the
  // payload perfectly. Landing the new test beside the degradation passage without saying so
  // would imply one detector covers both failures. It covers one.
  // Both surfaces asserted separately, for the reason above — and `\*{0,2}` because `read()`
  // collapses whitespace but keeps emphasis markers, so a bolded "not" is not the word "not".
  // (A first cut of this pin matched only the second surface and reported the first as proven.)
  assert.match(g, /does \*{0,2}not\*{0,2} detect a silent\s+degradation to another family/i,
    "the paste-block site must state what the new test does NOT reach");
  assert.match(g, /it cannot discriminate a hijacked run at all/i,
    "…and so must the companion-degradation site, where the confusion actually lands");
});

test("the seat definitions claim a bounded REACH, never a proven INPUT SET", () => {
  // MEASURED: a seat at `tools: []`, proven tool_uses:0 against a paired control, still received
  // the user's MEMORY.md in an auto-injected system-reminder plus a gitStatus block carrying the
  // last five commit SUBJECTS. Re-measured here from this worktree: the injection is
  // WORKTREE-rooted (it reported this branch, not main), so it follows a seat into any checkout.
  const fc = read("agents/frontier-consult.md");
  const cr = read("agents/cold-reviewer.md");

  // The retracted mechanism claim must not still ship. `tools: []` bounds what a seat can REACH;
  // nothing bounds what is PUT IN FRONT OF IT, and reach was never the exposure.
  assert.doesNotMatch(fc, /the packet-only limit is mechanical, not a promise/i,
    "the false mechanism claim must not survive — it is shipped verbatim to every adopter");

  // ⚠ TWO SURFACES AGAIN, and they are read by different people. The DESCRIPTION is what an
  // orchestrator sees when picking a seat; the BODY is what the seat itself is told. A pin that
  // matches either passes on a file where only one was corrected — proven by mutation, where
  // striking the body's clause left this green off the description's copy.
  const desc = /description:[^\n]*/i.exec(raw("agents/frontier-consult.md"))?.[0] ?? "";
  assert.match(desc, /cannot REACH beyond the packet/i, "the seat's description states the bound");
  assert.match(desc, /never a proven INPUT SET/i, "…and states what it is NOT");
  assert.match(fc, /bounds your REACH, not your INPUTS/i, "the body tells the seat the same thing");

  // Both seats must ASK. A seat that cannot enumerate its own inputs must at least be asked to
  // log them — two harnesses gave two different answers to this one question, which is the only
  // reason they were distinguishable at all.
  for (const [where, text] of [["frontier-consult", fc], ["cold-reviewer", cr]]) {
    assert.match(text, /I cannot distinguish pre-loaded content from my prompt/i,
      `${where} must name the "I cannot tell" answer as acceptable — an unaskable seat is unmeasurable`);
    assert.match(text, /no exposure/i,
      `${where} must give an explicit empty answer, or silence reads as a clean report`);
  }

  // Report a LOG, not a JUDGMENT. "Were you independent?" asks a seat to certify something it
  // cannot observe; "name what reached you" asks for something it can.
  assert.match(fc, /log|disclose/i);

  // ⚠ THE MIRROR SURFACE, and a claim-sweep found it where a filename-sweep would not. README
  // described the same cage as a "harness-enforced packet-only cage" — the identical overclaim in
  // the file an adopter reads FIRST. Correcting the seat and leaving the README is how a retracted
  // claim keeps shipping; this kit has a named rule about exactly that.
  const rm = read("README.md");
  assert.doesNotMatch(rm, /harness-enforced\s+packet-only cage/i,
    "README must not still describe the reach cage as a packet-only guarantee");
  assert.match(rm, /cage on\s+what the seat can \*\*REACH\*\*/i, "…it states what the cage actually bounds");
  assert.match(rm, /never a proven input set/i, "…and what it does not");

  // ⚠ A FOURTH SURFACE, which a dependency sweep surfaced and a grep for the phrase had missed.
  // PORTABILITY carried the identical formula — "…so 'judge only the packet' is mechanical, not a
  // promise" — inside a section whose own subject is honesty notes. Four surfaces carried one false
  // mechanism claim; correcting three of them is what leaves it shipping.
  // ⚠ A FIFTH SURFACE, found by a cold seat after four had been corrected — and it was the worst
  // placed of the five: skills/frontier-review/SKILL.md is the file that SEATS the agent, the file
  // frontier-consult.md points every orchestrator to, and a [P] asset installed into every adopter.
  // It said "packet-only is verifiable" — the retracted claim in a stronger form than the four that
  // were fixed. My dependency sweep did not reach it because I did not put it on the file list:
  // a dry-run cannot find what is not on your list. Correcting n−1 surfaces is what leaves a claim
  // shipping, and that sentence is this changeset's own thesis.
  const fr = read("skills/frontier-review/SKILL.md");
  assert.doesNotMatch(fr, /packet-only is verifiable/i,
    "the seating skill must not assert packet-only is verifiable — it is the fifth surface");
  assert.match(fr, /a cage on REACH, \*\*not a packet-only guarantee/i, "…it states what the cage bounds");
  assert.match(fr, /nothing bounds what the harness PRE-LOADS/i, "…and what it does not");

  const p2 = read("PORTABILITY.md");
  assert.doesNotMatch(p2, /"judge only the packet" is mechanical, not a\s*promise/i,
    "PORTABILITY must not still ship the retracted mechanism claim");
  assert.match(p2, /its \*\*REACH\*\* is mechanically bounded rather\s+than merely requested/i,
    "…it states the bound that IS real");
  assert.match(p2, /not a packet-only guarantee/i, "…and denies the one that is not");
});

test("the packet rules bar the one flag that would ship the whole review history", () => {
  // The subject-vs-body discipline CREATES this hole: once findings are deliberately moved out of
  // subjects into bodies, the bodies hold everything a seat must not see — so `git log -p` at
  // packet-build time defeats the control at the last step. Pinned in REVIEW because it is a rule
  // about what a packet may contain, which is REVIEW's subject.
  const r = read("core/REVIEW.md");
  assert.match(r, /A PACKET THAT SHIPS\s+COMMIT BODIES SHIPS THE REVIEW HISTORY/i);
  assert.match(r, /`git diff`, never `git log -p`/,
    "…and it must name the command, or it is an aspiration");
  // The reason has to travel, or a later editor reads it as a style preference and drops it.
  assert.match(r, /the failure mode the subject-vs-body discipline CREATES/i);
});

test("the fail-open family is stated as a COUNT, with the rule left in one place", () => {
  // A rule stated twice is a mirror. The rule lives in WORKFLOW; GATES carries the instances,
  // because four instances on four surfaces in one day is the argument, and the argument is what
  // makes anyone apply the rule to a step they did not think of as a control.
  const g = read("core/GATES.md");
  assert.match(g, /THE FAILURE STATE PRODUCING THE SAME ARTIFACT AS SUCCESS/);
  assert.match(g, /Four instances surfaced in a single day/i);
  // The generalising question is the actionable half — without it this is a war story.
  assert.match(g, /if this had silently failed, would its output be distinguishable from success\?/i);
  // ⚠ ANTI-MIRROR: GATES must carry the instances and POINT at the rule, never restate it.
  assert.match(g, /The governing rule is `core\/WORKFLOW\.md` § Gate/);
  assert.doesNotMatch(g, /A BLIND VERIFICATION TOOL RETURNS SUCCESS/,
    "GATES must not carry a second copy of WORKFLOW's rule");
});

test("the manifest's pre-loaded field is named by the BINDING contract, not only by the seat", () => {
  // A seat emitting a field its contract does not name is a doc/behaviour divergence, and where a
  // doc and a behaviour disagree the doc is what the next reader obeys. Both surfaces or neither.
  for (const [where, text] of [["core/REVIEW.md", read("core/REVIEW.md")],
                               ["agents/cold-reviewer.md", read("agents/cold-reviewer.md")]]) {
    assert.match(text, /role · family · files · pass-type ·\s*(?:\*\*)?pre-loaded/i,
      `${where} must carry the five-field manifest — a contract and a seat that disagree is the divergence class`);
  }
  const r = read("core/REVIEW.md");
  // The empty answer must be MANDATORY, or an omitted field reads as a clean one — which is the
  // same fail-open as an exit code that cannot tell "passed" from "never ran".
  assert.match(r, /`no exposure` must be written explicitly when there is none/i);
  // …and the field must be scoped as a LOG. "Were you independent" asks a seat to certify what it
  // cannot observe; "name what reached you" asks for something it can.
  assert.match(r, /is a LOG, never a certification/i);
  assert.match(r, /DECLARED with its known injections named and never CERTIFIED unframed/i);
});

test("PORTABILITY's honesty-note count matches the notes it lists", () => {
  // Caught while editing the paragraph above: the shipped text said "Three honesty notes" and listed
  // FOUR. Pre-existing and unrelated to the mechanism claim — recorded rather than silently fixed.
  // Pinned as a COUNT derived from the document, not as a literal, so the assertion cannot go stale
  // against a future fifth note the way the prose did.
  const raws = raw("PORTABILITY.md");
  const sec = raws.slice(raws.indexOf("### The `tools: []` cage is a Claude-harness control"));
  const body = sec.slice(0, sec.indexOf("\n### ", 10));
  const stated = /(\w+) honesty notes/.exec(body)?.[1]?.toLowerCase();
  const listed = (body.match(/^- \*\*/gm) || []).length;
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  assert.ok(stated, "the section still states how many honesty notes it carries");
  assert.equal(WORDS[stated], listed,
    `PORTABILITY says "${stated} honesty notes" but lists ${listed} — a count that describes nothing`);
});

test("what a seat RETURNS is left alone — only what a verifier ACCEPTS was changed", () => {
  // TWO DIFFERENT CHANGES WEAR THE SAME PHRASE. "severity-ranked" appears in an OUTPUT SPEC (what
  // the seat is told to emit) and in a SUFFICIENCY TEST (what a verifier may bank). Only the
  // second is the defect. The output-spec sites sit close to text this changeset does edit —
  // frontier-consult's is nine lines from the mechanism claim above — so proximity, not analysis,
  // is what would edit them. This asserts they still ship UNCHANGED.
  // ⚠ PIN THE SENTENCE, NOT THE TOKEN. An earlier cut asserted only /severity-ranked/ — a presence
  // check on one hyphenated word — while this comment claimed it asserted unchangedness. A rewrite
  // that gutted the output spec and kept the word would have passed green. A cold seat caught it:
  // "a grep proves a SPELLING, never a claim", committed inside the pin written to prevent it.
  for (const [site, spec] of [
    ["agents/cold-reviewer.md", /`GO` \| `GO-WITH-CHANGES` \| `NO-GO` \| `HOLD`, with severity-ranked findings, each carrying evidence/],
    ["agents/frontier-consult.md", /\*\*Return\*\*: severity-ranked findings, each tied to specific packet content, and ONE recommendation/],
    ["templates/codex-cold-reviewer.toml.tmpl", /GO-WITH-CHANGES, NO-GO, or HOLD with severity-ranked exact file\/line evidence/],
  ]) {
    assert.match(read(site), spec,
      `${site}'s OUTPUT SPEC must survive VERBATIM — it says what a seat RETURNS, not what a verifier ACCEPTS`);
  }
});