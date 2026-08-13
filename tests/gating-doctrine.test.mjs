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

// What a `.mjs` decision-time surface PRINTS, as opposed to how it is TYPED.
//
// ⚠ WHY THIS EXISTS, and it is the same reflow trap `read()` closes for docs — left open on `.mjs`
// because that was read raw. The hook's contract is a CONCATENATION of template literals, so a
// sentence wrapping across two of them ("…Soft stop after 3 NO-GO\n` + `rounds…") is not a
// substring of the source at all. An ABSENCE pin over the raw text therefore passes while the
// retired rule still reaches the agent — fail-OPEN, the dangerous direction. PROVEN BY MUTATION:
// a retired soft-stop rule planted across two literals printed at decision time with every
// absence pin green. A presence pin has the mirror defect and fails closed (a spurious red), which
// this file's header records as a measured false alarm.
//
// Segments are joined edge-to-edge, `\n` escapes are resolved the way the runtime resolves them,
// and whitespace is flattened — the same normalisation `read()` applies to prose, so both surface
// classes are now pinned on their MEANING rather than on their typography.
const printed = (rel) => {
  const decl = /const CONTRACT =[\s\S]*?;\n/.exec(raw(rel))?.[0] ?? "";
  return [...decl.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("")
    .replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
};

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

test("same-class recurrence enters root cause and does not mint a frontier firing", () => {
  const g = read("core/GATES.md");
  const f = read("skills/frontier-review/SKILL.md");
  assert.match(g, /Same-class recurrence or a repair-introduced harm enters `core\/WORKFLOW\.md`'s root-cause queue/);
  assert.match(g, /does \*\*not\*\* mint a frontier firing or fresh authority/);
  assert.match(g, /A frontier consult still consumes the cap below unless the Owner explicitly invokes it/);
  assert.doesNotMatch(g, /same-class-recurrence firing per changeset/);
  assert.match(f, /Same-class recurrence enters the root-cause queue; it never mints a firing/);
  assert.doesNotMatch(f, /same-class-recurrence escalation/);
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

// ---------------------------------------------------------------- RULE #1 (the harm screen)

test("RULE #1 ships with all THREE harm targets, on every surface that applies it", () => {
  // WHY THIS IS PINNED THREE-WAYS. The rule was first relayed with ONE target ("harm to the user"),
  // and under that narrow form a crash nobody is watching hits nothing and banks. The Owner's own
  // wording carries three, and the third is the one that keeps crashes blocking. A pin on "harm"
  // alone would pass against the narrow form — which is the exact regression that matters — so each
  // assertion names the code-functionality target explicitly.
  const f = read("core/FOUNDATIONS.md");
  assert.match(f, /RULE #1 — no harm to the end product ⇒ no NO-GO, no chase/);
  assert.match(f, /\(1\) the Owner\/user · \(2\) the usability of the product · \(3\) the FUNCTIONALITY of the code/);
  assert.match(f, /a crash nobody is currently watching harms target 3 and \*\*BLOCKS\*\*/,
    "the narrow-form regression must be named, not merely avoided");
  // Instruction artifacts are the class this kit IS, so its own harm mapping must ship.
  assert.match(f, /an ambiguity admitting a harmful reading counts, because the implementer picks/);
  // The misreading that would make this rule harmful: cutting seats instead of repairs.
  assert.match(f, /It reduces the number of REPAIRS, never the DEPTH of review — cutting seats is the misreading/);

  // The ladder's emission is where the rule is actually EXECUTED, so the funnel and its ratio pin here.
  const w = read("core/WORKFLOW.md");
  assert.match(w, /does this hurt \*\*\(1\) the Owner\/user, \(2\) the usability of the product, or \(3\) the FUNCTIONALITY of the code\*\*/);
  assert.match(w, /\*\*Blank ⇒ NOTE\*\* \*\(Precedence below and the carve-outs — irreversible · prod write · gate-ran-lighter-than-mandate — screen FIRST; none exit here\)\*: recorded here/);
  assert.match(w, /The pricing flip: dropping a harmless finding is FREE; chasing one owes the work/);
  // The RATIO is the self-policing half — a principle without a reported number is not checkable.
  assert.match(w, /HARM-PASSING <h> · NOTES <k>/);
  assert.match(w, /The ratio is not optional — a round without it is unscreened/);
  // HARM+TRIGGER must bind EVERY artifact class — binding only CODE is the defect that let every
  // prose nit through the old contract owing nothing.
  assert.match(w, /Every `REMEDIATE` — CODE, PROSE, DOCTRINE, EVERY class — carries `HARM:` \*and\* `TRIGGER:`/);
  assert.match(w, /for prose \*\*who reads it and what wrong action follows\*\*/);
  // A self-authored invariant costs a sentence, not a round — three of four NO-GOs in the measured
  // instance were the changeset breaking invariants it had written about itself.
  assert.match(w, /fix the SENTENCE, never the code/);

  // ⚠ THE EXECUTION AXIS. Without this sentence the chip ships a licence to loosen a DATA gate:
  // some readers hold no code/data separation, and "gates got cheaper" reads as "all gates".
  assert.match(w, /it does NOT touch the EXECUTION gate — per-write Owner authorization at the moment of a live-data write is unchanged/);

  // The seat contract must apply the threshold WITHOUT inviting seats to self-censor: a suppressed
  // finding is deleted, not noted, and under-reporting is the failure mode this rule creates.
  const r = read("core/REVIEW.md");
  assert.match(r, /a finding that blocks must name the harm — to the Owner\/user, to the usability of the product, or to the FUNCTIONALITY of the code/);
  assert.match(r, /Report everything you find anyway: the DISPOSITION applies the threshold, not the seat/);
  assert.match(r, /under-reporting is the failure mode this rule creates/);
});

test("the retired chase machinery is gone and the bounded root-cause controller replaces it", () => {
  // A ladder doc that carries BOTH contracts is worse than one carrying the old one: the reader
  // meets whichever comes first. These are absence pins, so each names a spelling the OLD text
  // actually used — an absence pin whose phrase never appeared would be green by construction.
  const w = read("core/WORKFLOW.md");
  assert.doesNotMatch(w, /Soft stop after 3 NO-GO rounds/i, "the 3-round soft stop is retired");
  assert.doesNotMatch(w, /PAST-SOFT-STOP/, "the round-4 justification emission is retired");
  assert.doesNotMatch(w, /GATE ROUND <n>\/3/, "the emission header no longer promises three rounds");
  assert.doesNotMatch(w, /BOUNDED\?/, "BOUNDED? is retired — HARM? screens before it");
  assert.doesNotMatch(w, /what breaks if you DECLINE\?/i,
    "the open-referent WORTH IT? is retired: it let the process answer about itself");
  // …and the replacement is present, or the assertions above pass on a gutted file.
  assert.match(w, /Rounds continue only while each new one is warranted by NEW HARM-passing findings/);
  assert.match(w, /Rounds 1–3 are ordinary/);
  assert.match(w, /Rounds 4–6/);
  assert.match(w, /PASS.*Rounds 7–8/);
  assert.match(w, /Round 9 returns to the Owner/);
  // THE TIER ROW, Owner-ruled at v2.9.0 after two seats independently flagged the T1-for-all-core-docs
  // row as the seat cut FOUNDATIONS calls the misreading. The SPLIT is the rule — depth follows
  // whether anything is built from the text — so pin both halves, not the prose around them.
  assert.match(w, /Text something follows — gate machinery, seat definitions, designs and plans code will implement, binding templates → FULL T2: panel \+ Owner wording sign-off/);
  assert.match(w, /Text nothing follows — records, history, README-class description → ONE blind cold reviewer/);
  // The one-round rule became a warrant test at v2.9.0; the Owner gate moved to round 3 and is
  // HARD. Pinned in the amended test above — this older pin named the retired sentence.
});

test("failure-mode evidence promotes mechanisms instead of accumulating a diary", () => {
  const o = read("core/OPERATE.md");
  assert.match(o, /Log only demonstrated failures or near-misses/);
  assert.match(o, /Count is a sensor, never an automatic rule/);
  assert.match(o, /test\/control for mechanics, binding rule for behavior, architecture for product invariants/);
  assert.match(o, /gitignored local log aids continuity but is never authority in a fresh clone/);
});

test("Precedence screens BEFORE the NOTE exit, and the carve-outs survive the rule", () => {
  // WHY THIS EXISTS, and it is the defect the panel caught. Making HARM? the first question with
  // "first exit wins" created a FOURTH exit — NOTE — that owes nothing. Every brake the design kept
  // is keyed to a disposition NAME (DEFER/DECLINE for the symmetric brake and Precedence,
  // all-REMEDIATE for the self-audit), and NOTE is none of them. Precedence protects ten classes;
  // the carve-out list names three. Left unscreened, "the deploy script prints the API token"
  // is blank on all three targets and ships as a NOTE. The repair is a SCREEN, not a longer list:
  // a list has to be maintained at ten and drifts; a screen composes.
  const w = read("core/WORKFLOW.md");
  assert.match(w, /Precedence below and the carve-outs — irreversible · prod write · gate-ran-lighter-than-mandate — screen FIRST; none exit here/,
    "the NOTE exit must not outrank Precedence OR the carve-outs — the credential-leak hole and its second key");
  // THE KEYSTONE of round 2: the brake binds to the NOTE exit itself. Round 1 patched surfaces;
  // this binds the exit once, so a reviewer-rated BLOCKER screened to NOTE leaves an auditable
  // record instead of nothing. It is also what reconciles the funnel with the final-gate rule.
  assert.match(w, /Symmetric brake — a `NOTE`, `DEFER` or `DECLINE` of a reviewer-rated BLOCKER\/HIGH owes the failed case: for a NOTE the FAILED HARM/);
  // The carve-outs are acceptance-critical and were entirely unpinned until now.
  const f = read("core/FOUNDATIONS.md");
  assert.match(f, /anything \*\*irreversible\*\*, any\s*\*\*prod write\*\*, and any \*\*gate-ran-lighter-than-its-mandate\*\* finding escalates to the Owner regardless/,
    "RULE #1 must not swallow the escalation path");
  // The self-audit must fire on an all-NOTE round too. It previously triggered only on
  // over-blocking (all-REMEDIATE, >1 finding), so the direction this rule actually creates —
  // under-blocking — was the one direction nothing watched, and single-finding rounds were exempt.
  // "a round with NO notes" caught the clean round too, taxing the success path in a changeset
  // built to cut gate cost. It must mean "found things, screened them all out".
  assert.match(w, /A round with findings but NO notes, or whose findings are \*every\* `REMEDIATE`, pauses/);
});

test("the rule's surfaces DERIVE from its canonical home, so drift reddens instead of accumulating", () => {
  // WHY THIS SHAPE. Round 1 repaired the NOTE-exit hole by patching prose on two surfaces, and the
  // bookend found the identical hole on four more — because a rule stated in six places with
  // nothing binding them regenerates the defect faster than patching removes it. That is this
  // repo's own invariant ("a rule lives in one place and other files point at it") arriving as a
  // measured cost. Until the restatements are reduced, this test is the binding.
  const canon = read("core/FOUNDATIONS.md");
  // ⚠ THIS BLOCK ONCE LIED, AND THE LIE IS WHY IT IS WRITTEN THIS WAY NOW. The previous cut
  // captured the canonical enumeration into a variable, NEVER USED IT, and checked a hand-written
  // list — under a comment claiming it derived. A bookend proved it by renaming the targets in the
  // canon and watching this test stay GREEN, which is worse than not deriving: after a rename it
  // would have enforced the RETIRED names against the new canon. The mutation battery missed it
  // because it mutated the SURFACES and never the CANON. Mutate the source of truth, not only its
  // copies. The keys below are now COMPUTED from the capture groups — rename a target in
  // FOUNDATIONS and this list changes with it, which is the entire point.
  const m = /\(1\) ([^·]+) · \(2\) ([^·]+) · \(3\) ([^*]+)\*\*/.exec(canon);
  assert.ok(m, "the canonical three-target enumeration must be findable in FOUNDATIONS");
  const keys = [1, 2, 3].map((i) =>
    m[i].replace(/[*_`]/g, "").split(/[^A-Za-z/]+/).filter(Boolean)
        .sort((x, y) => y.length - x.length)[0]);
  assert.equal(keys.length, 3, `expected three derived target keys, got ${keys.join(", ")}`);
  assert.ok(keys.every((k) => k && k.length > 3),
    `each target must yield a distinctive noun, got: ${keys.join(", ")}`);

  // (a) Every surface that STATES the rule carries all three targets.
  for (const surface of ["core/WORKFLOW.md", "core/REVIEW.md", "agents/cold-reviewer.md",
                         "templates/codex-cold-reviewer.toml.tmpl",
                         "skills/orchestrate/RUNG_ZERO.md", "hooks/guard-gate-ladder.mjs"]) {
    const t = read(surface);
    for (const k of keys) {
      assert.ok(new RegExp(k.replace(/[/]/g, "\\/"), "i").test(t),
        `${surface} states rule #1 and must carry the canonical target "${k}"`);
    }
  }

  // (b) Every surface that describes the NOTE EXIT carries the SCREEN. A seat file describes a
  // REPORTING threshold and already tells the seat to report regardless, so it owes no screen —
  // that distinction is deliberate, and collapsing it would demand text those files cannot hold.
  for (const surface of ["core/WORKFLOW.md", "core/FOUNDATIONS.md",
                         "skills/orchestrate/RUNG_ZERO.md", "hooks/guard-gate-ladder.mjs"]) {
    const t = read(surface);
    assert.match(t, /screen(s)? (FIRST|BEFORE)/i,
      `${surface} describes the NOTE exit, so it must carry the screen — an unscreened exit is the hole`);
    assert.match(t, /gate-ran-lighter-than/i,
      `${surface} must name the carve-out that no Precedence class covers — it was the second key`);
  }
});

test("the round controller is stated in one shape everywhere it is stated at all", () => {
  // THIRD RECURRENCE OF ONE CLASS, and this pin is the answer to it. The rounds rule was amended
  // in core/WORKFLOW.md and left standing in its retired form on three other surfaces — the hook
  // (printed at decision time), core/OPERATE.md (BINDING, citing § Gate as its authority) and
  // core/REVIEW.md. All three AGREED before the amendment; the amendment broke the agreement and
  // 161 green tests shipped over it. Patching the statements is what kept regenerating this; the
  // rule still lives on too many surfaces (banked as its own chip), so until that is fixed THIS
  // is the binding that makes drift red instead of silent.
  // ⚠ KO15 REBASE (Owner ruling (b), base-drift split, custodian order): the rounds-specific
  // derive-pin that lived here (canon-derived stop number, `atRound` proximity, the warrant/
  // harm-passing component checks) is BANKED to a follow-on chip — its subject left this changeset
  // when the Owner's own root-cause controller replaced the hard-stop rounds policy on main. What
  // survives the split is the READING MECHANISM, which is non-rounds: for the hook, pin what it
  // PRINTS via `printed()` (the real `buildAdditionalContext()` output), never a source-text regex
  // extraction — the exact defect class (H1-H4) this changeset exists to delete. Main's own
  // `contractOf` still used the old regex extraction below, because the controller was authored
  // from the pre-repair base, not because anyone re-decided the extraction question — a naive
  // "rounds content wins" would have silently reverted the extraction fix along with the banked
  // policy text, so the mechanism is kept and only the rounds-specific assertions are banked.
  //
  // ⚠ THE TWO LISTS ARE THE CURE AND ITS BOUND. A surface either STATES the rule, or it POINTS and
  // carries NO component of it. Those are the only two legal shapes, and a surface moves between
  // them by a deliberate edit HERE, which is the point: the conversion is what a reviewer should
  // have to see.
  //
  // NOT derived from the tree, deliberately. A list computed by scanning for surfaces that mention
  // the rule would go VACUOUS the moment a surface lost it entirely — the surface drops out of its
  // own denominator and the pin passes by finding nothing, which is this repo's named fail-open
  // (a blind verification tool returns success). A maintained list cannot fail that way.
  const STATES = ["core/WORKFLOW.md", "hooks/guard-gate-ladder.mjs"];
  const POINTS = ["core/OPERATE.md"];

  const contractOf = (rel) => rel.endsWith(".mjs") ? printed(rel) : read(rel);
  for (const rel of STATES) {
    const t = contractOf(rel);
    assert.ok(t, `${rel}: nothing extracted to pin — re-point this test`);
    assert.match(t, /root-cause/i, `${rel} states the round controller and must carry the root-cause boundary`);
    // The retired shape must be GONE from every one of them, or a reader meets whichever they open.
    assert.doesNotMatch(t, /ONE remediation round; a second is the Owner's call/i,
      `${rel} still prints the retired rounds rule`);
  }

  // A POINTER NAMES WHERE THE RULE LIVES AND NO COMPONENT OF IT — that is the whole reason a
  // pointer cannot go stale when the rule changes, and a pointer that restates is the defect
  // wearing the cure's name. core/OPERATE.md is the measured instance: it cited § Gate as its
  // authority AND restated both components, so the v2.9.0 amendment left it contradicting canon
  // while every test stayed green. Citing an authority is not pointing at it.
  for (const rel of POINTS) {
    const t = read(rel);
    assert.match(t, /`core\/WORKFLOW\.md` § Gate/,
      `${rel} must name WHERE the round policy lives`);
    assert.doesNotMatch(t, /hard stop/i,
      `${rel} points at the rounds rule and must not restate its stop`);
    assert.doesNotMatch(t, /rounds continue only while/i,
      `${rel} must not restate the warrant condition either`);
  }
  // core/REVIEW.md must not re-assert the seat count the tier split replaced.
  assert.doesNotMatch(read("core/REVIEW.md"), /which since v2\.9\.0 is every core-doc amendment/,
    "REVIEW.md restored the seat cut the tier split closed");
  // The discharge clause, on both the capped doc (short) and the uncapped decision-time surface (full).
  assert.match(read("core/WORKFLOW.md"),
    /A REMEDIATE discharges only when the finding's OWN trigger is re-run and no longer fires/);
  assert.ok(printed("hooks/guard-gate-ladder.mjs").includes("the ORIGINAL reproduction, dead, is"),
    "the decision-time surface carries the full discharge sentence — it is uncapped, so it can");
});

test("the hook's printed contract tracks WORKFLOW's emission block, or drift reddens", () => {
  // WHY. This string is what an agent is HANDED at gate time — the LOUDER surface, because the doc
  // is read when someone opens it and the hook arrives unprompted at the moment of decision. It is
  // a hand-maintained mirror of core/WORKFLOW.md § Gate and NOTHING kept the two synchronised: it
  // had already gone stale, printing a retired funnel and a retired round count while the doc said
  // otherwise, and every existing hook test checks registration or firing, never the text. The
  // staleness was the symptom; the unpinned mirror was the defect. Fixing the text without pinning
  // it re-arms the identical failure for whoever changes the contract next.
  // ⚠ SCOPED TO WHAT THE HOOK PRINTS, on both counts, and the previous cut was scoped to neither.
  //   (1) These presence checks read the WHOLE FILE — the exact defect the sibling ROUNDS test
  //       warns about two tests above ("a first cut checked the whole file and passed while the
  //       printed contract had lost the rule entirely"). The hook's comments discuss the funnel and
  //       name the harm targets, so every assertion below could have been satisfied by the file's
  //       own history narrative while the CONTRACT shipped without them.
  //   (2) Raw text is reflow-blind: this contract is concatenated template literals, so a clause
  //       wrapping across two of them is not a substring of the source. See `printed()`.
  // The agent acts on the printed string, so the printed string is what must be pinned.
  const hook = printed("hooks/guard-gate-ladder.mjs");
  assert.ok(hook, "the CONTRACT constant must be findable — re-point this test");
  const w = read("core/WORKFLOW.md");
  // DERIVED from the doc rather than hand-listed here — a hand-listed copy would be a third mirror.
  const emission = /GATE ROUND[\s\S]*?LADDER: continue/.exec(w)?.[0] ?? "";
  assert.ok(emission, "the emission block must be findable in core/WORKFLOW.md — re-point this test");
  const questions = [...emission.matchAll(/\*\*([A-Z][A-Z ]*\?)\*\*/g)].map((m) => m[1]);
  assert.ok(questions.length >= 4,
    `expected the funnel's questions in the emission line, parsed: ${questions.join(", ")}`);
  for (const q of questions) {
    assert.ok(hook.includes(q),
      `the hook must print "${q}" — an agent acts on what the hook hands it, not on the doc`);
  }
  for (const t of ["the Owner/user", "the usability of the product", "the FUNCTIONALITY of the code"]) {
    assert.ok(hook.includes(t), `the hook's contract must name the harm target "${t}"`);
  }
  assert.ok(hook.includes("A NOTE on a reviewer-rated BLOCKER/HIGH owes the FAILED HARM"),
    "the decision-time surface must carry the brake binding, or the NOTE exit prints as free");
  assert.ok(/Precedence AND the carve-outs[\s\S]*?screen FIRST/.test(hook),
    "the decision-time surface must carry the Precedence screen, or it prints the hole");
  // The retired contract must be GONE from what the hook PRINTS. Both shipping is worse than
  // either alone: the reader meets whichever arrives first, and the hook arrives first.
  // These are the ABSENCE pins, so they are the ones the reflow gap failed OPEN on — `printed()`
  // is what makes a wrapped re-add visible to them.
  for (const dead of ["GATE ROUND <n>/3", "Soft stop after 3 NO-GO rounds", "PAST-SOFT-STOP", "BOUNDED?"]) {
    assert.ok(!hook.includes(dead), `the hook must not print the retired "${dead}"`);
  }

  // …and the canary, because the four assertions above are decoration if the extractor cannot see
  // a wrapped re-add. This is the planted mutation that proved the gap: the retired rule split
  // across two template literals exactly as the surrounding contract is typed. It must be VISIBLE
  // to `printed()` — if this ever stops matching, the extractor has regressed and the absence pins
  // above are green for the wrong reason.
  const wrapped = "const CONTRACT =\n"
    + "  `Soft stop after 3 NO-GO\\n` +\n"
    + "  `rounds applies.\\n`;\n";
  const decl = /const CONTRACT =[\s\S]*?;\n/.exec(wrapped)?.[0] ?? "";
  const flat = [...decl.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("")
    .replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  assert.ok(flat.includes("Soft stop after 3 NO-GO rounds"),
    "the extractor must see a retired rule wrapped across two literals — the fail-open this closes");
  assert.ok(!wrapped.includes("Soft stop after 3 NO-GO rounds"),
    "…and a RAW scan must NOT see it, or this canary is not reproducing the gap it documents");
});

test("every surface that APPLIES rule #1 states all three targets, not a pointer", () => {
  // The three-target pin previously covered FOUNDATIONS/WORKFLOW/REVIEW while the test claimed
  // "every surface that applies it". Three more apply it. This gap was not theoretical: to fit a
  // 500-word cap the Claude-lane seat had been reduced to a pointer, and all three panel seats
  // reported the harness injecting the SUPERSEDED one-target form — so a seat that did not follow
  // the pointer had exactly one available definition of harm and it was the regression.
  for (const surface of ["agents/cold-reviewer.md",
                         "templates/codex-cold-reviewer.toml.tmpl",
                         "skills/orchestrate/RUNG_ZERO.md"]) {
    const t = read(surface);
    assert.match(t, /Owner\/user/, `${surface} must name harm target 1`);
    assert.match(t, /usability of the product|product's usability/i, `${surface} must name harm target 2`);
    assert.match(t, /FUNCTIONALITY of the code|code's FUNCTIONALITY/i,
      `${surface} must name target 3 — the one the narrow form drops, and the one that keeps crashes blocking`);
  }
  // A NOTE is RECORDED. Compression once cut that word here to save four words against the cap,
  // leaving "dropping is free" on the one surface that runs before any gate record exists —
  // where a dropped finding is deleted, not noted, and nobody downstream can tell the difference.
  assert.match(read("skills/orchestrate/RUNG_ZERO.md"), /\*\*recorded\*\*, never dropped/);
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
  assert.match(g, /This is why `core\/WORKFLOW\.md` § Gate says no hook infers rounds/);
  assert.match(read("core/WORKFLOW.md"), /no hook infers it/);
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
