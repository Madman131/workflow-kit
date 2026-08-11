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
  // (Found by the cross-family seat: this test named the rule and asserted everything except it.)
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
  // pin hardened the falsehood, and two independent cold reviewers found it. So this version pins
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