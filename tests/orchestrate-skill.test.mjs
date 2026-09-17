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
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BODY = path.join(KIT, "skills", "orchestrate", "SKILL.md");
const ARCHITECT_SKILL = path.join(KIT, "skills", "architect-build", "SKILL.md");
const ARCHITECT_ROUTING = path.join(KIT, "skills", "architect-build", "ROUTING.md");

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
  pin(body, "**A remote GO is the Owner's alone**", "GO ownership");
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

test("the body states EXACTLY how much of it is enforced — one rung, and no more", () => {
  const body = readFileSync(BODY, "utf8");
  // The kit's recurring shipped defect is prose claiming enforcement the machinery does not do.
  // This skill enforces NOTHING, and the sentence saying so is load-bearing.
  pin(body, "One rung on this page is enforced WHEN ITS HOOK IS ARMED", "enforcement honesty");
  // The condition is load-bearing and shipped on the WRONG SURFACE once: it landed in PORTABILITY.md,
  // which never installs, while the unconditioned claim shipped in this body, which installs verbatim.
  // A pin on an unconditioned claim HARDENS it, so this pins the condition, not the claim.
  pin(body, "TRUST-GATED", "the enforced rung is trust-gated");
  // Trust granularity, as measured 2026-09-13: Codex keys trust to the hooks.json ENTRY, not the
  // script bytes. The retracted "upgrading a hook DISARMS it" is barred cross-surface in codex-guard.
  pin(body, "Codex keys trust to the `hooks.json`\nentry, not the script — a changed entry is NOT ARMED until re-approved", "trust is keyed to the registration entry");
  // The v2.4 correction's own honesty half. `guard-brief-rung` makes the old blanket "nothing is
  // enforced" false, and the replacement must not over-correct in the other direction: what ships
  // is a tripwire that proves a session- and dispatch-bound RECORD EXISTS — not that its commands
  // ever ran. Both halves are load-bearing, so both are pinned.
  pin(body, "proving such a RECORD EXISTS, never that its\ncommands were run or were the right ones", "the enforced rung claims neither execution nor sufficiency");
  // SINGLE-USE is a property the guard actually enforces (one ritual, one dispatch), so the body
  // may not quietly drop it: a reader told the record is merely "session- and target-bound" would
  // reasonably expect to reuse it inside the freshness window, which is the case consumption closes.
  pin(body, "SINGLE-USE record of executed checks", "the rung is single-use");
  // This sentence originally read "The two things the kit does enforce are the task-lane
  // declaration and the commit floor" — which contradicts the kit's own PORTABILITY.md, where the
  // write guard is inert in the Codex lane until a human grants hook trust, and the commit floor is
  // absent on a fresh clone until `core.hooksPath` is set and is bypassable with `--no-verify`.
  // "Ships controls for" is the supportable verb; the pointer to the limits is the load-bearing half.
  pin(body, "The kit ships controls for the declaration and the commit\nfloor", "what IS shipped");
  // The pointer names the KIT's copy: the file is not installed into adopters (a generic root name a
  // kit cannot occupy safely — withdrawn in v2.28.0 review), so a bare name would send an adopter
  // looking for a file that is not there.
  pin(body, "fresh-clone and bypass limits are in workflow-kit's `PORTABILITY.md`", "limits are pointed at, with the kit named");
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
  pin(body, "**evidence escalates them, appetite does not.**", "evidence not appetite");
});

test("the bank carries the probe-denominator rule and the read-checks-before-merge rule", () => {
  const protocols = readFileSync(path.join(KIT, "skills", "orchestrate", "PROTOCOLS.md"), "utf8");
  // Graduated 2026-09-14 after four probes stood outside their control's denominator (a docs-only
  // floor probe, an untracked file against `git ls-files`, a one-copy parity check, a trust claim
  // relayed without the arming probe) and a red PR was merged because the ritual never read checks.
  pin(protocols, "Name the control's DENOMINATOR before believing a probe, then prove the probe sits inside it.", "probe denominator");
  pin(protocols, "never merge past either without the Owner ruling on that specific failure", "read checks before merge");
  pin(protocols, "first show the target branch fails identically before calling it the host", "red local suite");
});

test("the round controller pins the finite aggregate boundary", () => {
  const body = readFileSync(BODY, "utf8");
  const protocols = readFileSync(path.join(KIT, "skills", "orchestrate", "PROTOCOLS.md"), "utf8");
  pin(body, "R1 permits one bounded batch unless the mechanism", "first bounded repair");
  pin(body, "harm-bearing R2 and repeated R1 require one root kind", "early shared-cause checkpoint");
  pin(body, "R3 tests that consolidated correction", "consolidated root batch");
  pin(body, "finish once, successor after terminal close, or Owner decision with no dispatch", "process rulings");
  pin(body, "R4 is the final GO/STOP bookend; no R5", "terminal bookend");
  pin(body, "fourth gate repeats it without granting a round", "cumulative process review");

  // GRADUATE FM-2026-08-27-16: the pre-terminal CIRCULAR-cadence vocabulary must never creep back
  // into the skill. An LPB port found the installed orchestrate skill still circular because nothing
  // asserted the terminal cadence here. This negative pin reddens if any retired cadence term
  // reappears; the canary proves the regex still fires on a string that DOES carry that vocabulary
  // (so the negative pin is not silently dead).
  const retiredCadence = /CIRCULAR cadence|two-cycle window|process audit on the exact|next cycle's round/i;
  assert.doesNotMatch(body, retiredCadence,
    "the retired circular-cadence vocabulary must not reappear in the /orchestrate skill body");
  assert.match(
    "rounds run in cycles (the CIRCULAR cadence); after two, a process audit on the exact bytes",
    retiredCadence,
    "canary: the retired-cadence regex must still fire on text that carries that vocabulary");

  const brief = readFileSync(path.join(KIT, "skills", "orchestrate", "CHIP_BRIEF.md"), "utf8");
  pin(brief, "Aggregate repair briefs declare",
    "repair dispatch declaration fields");
  pin(brief, "the exact PM disposition and panel-close",
    "typed evidence is procedure-recorded and candidate-bound");
  pin(brief, "Ordinary workers include `session_id` in `--verify`",
    "ordinary workers supply explicit session identity for verification");
  pin(brief, "Completion-brief bytes bind at `child_continuation`, with no new `--confirm`",
    "completion brief bytes are bound at continuation mint, not by a worker confirm step");
  pin(brief, "uses it as `repair_dispatch_event_id` for `--verify` with child task/session",
    "the completion worker handshake binds the child continuation event, task, and session");
  pin(body, "failed/STOP surface stays closed", "completion exception terminal surface remains closed");
  pin(protocols, "a fresh frontier process review bound to the latest frozen panel",
    "the R4 process review is bound to the current frozen panel");
  pin(protocols, "each fourth gate repeats the review", "cumulative cadence retains the gate noun");
  pin(body, "genuinely new Owner-approved work begins separately only on disjoint surfaces",
    "new work is not a relabel of the stopped completion surface");
  pin(body, "exact Astra model/effort is runtime-verified procedure, not controller-authenticated identity",
    "controller evidence binding does not claim provider identity authentication");
  pin(body, "After writing a repair brief, confirm its actual bytes", "pre-write allow is not authority");

  const workflow = readFileSync(path.join(KIT, "core", "WORKFLOW.md"), "utf8");
  assert.match(workflow, /R1 permits one bounded batch unless repeated/);
  assert.match(workflow, /Harm-bearing R2 and repeated R1 require one shared-cause/);
  assert.match(workflow, /R3 tests the consolidated correction/);
  assert.match(workflow, /R4 is the final bookend and has no outgoing dispatch/);
  assert.match(workflow, /No R5, cycle, reset, or audit window/);
  assert.match(workflow, /declares repeated mechanism/,
    "semantic mechanism recurrence remains a PM declaration");
});

test("a receipt is not a verdict — the rule lives in the body, not only in the bank", () => {
  // A seat's receipt proves its reply COMPLETED; it says nothing about whether a decision was
  // stated. Treating one as the other accepts a non-verdict as a pass, which is a correction of a
  // plausible false default — so it may not live only in the on-demand layer, where it started.
  const body = readFileSync(BODY, "utf8");
  pin(body, "receipt proves a reply COMPLETED, not that it judged", "receipt is not a verdict");
  pin(body, "demand a verdict and its inspected scope", "verdict and scope demanded");
});

test("the README/PORTABILITY mirrors carry no claim the body has already retracted", () => {
  // WHY THIS EXISTS — it is the finding of record for this release. The same doctrine is narrated on
  // FOUR surfaces (SKILL.md, CHIP_BRIEF.md, README.md, PORTABILITY.md) and nothing bound them, so
  // every correction had to be hand-propagated to three other places. Twice the propagation was
  // incomplete and nothing said so: "proves it is the sole writer" survived in CHIP_BRIEF after the
  // body was fixed, and the chip/session identity survived in the README after the body dropped it.
  // Neither was reachable by the suite. These are cheap NEGATIVE assertions on the retracted
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
    // Re-pointed each release to the CURRENT release note: that is the surface a correction is
    // most likely to be narrated on and least likely to be swept, and `section` hard-fails rather
    // than searching an empty string if the anchor ever stops resolving.
    // v2.5.0 re-pointed the CURRENT anchor and ADDED to this list rather than swapping the previous
    // entry out: the older sections keep their coverage for free, and a release that silently drops an
    // assertion is indistinguishable from one that never had it.
    // v2.6.1 re-pointed the CURRENT anchor and ADDED, per the rule above — and the v2.6.0 entry's
    // start anchor MOVED from the title line to its own heading, exactly as v2.5.0's did one release
    // earlier: the title now names v2.6.1, and leaving it would silently swallow the new section
    // into the old one's slice.
    // v2.7.0 re-pointed the CURRENT anchor and ADDED, per the rule above — and the v2.6.1 entry's
    // start anchor MOVED from the title line to its own heading, exactly as v2.6.0's and v2.5.0's
    // did before it. The title-line anchor is a MOVING REFERENCE by construction: it carries the
    // version, so it breaks every release. It breaks LOUDLY (`section` hard-fails and says
    // "re-point this test") rather than silently searching an empty string, which is the only
    // reason it is tolerable — and this release's own note was caught by these pins immediately
    // after the re-point, quoting a retracted spelling it was describing.
    // L7 correction (R2): the single VERSION-derived slice spanned every release note down to
    // v2.6.1 under a label that said v2.7.0, and silently re-pointed on each bump. Split: the
    // moving title anchor now covers ONLY the current note (loud-fail on each release, as before),
    // and the v2.7.0 entry gets its own fixed anchors like every other historical section.
    "README.md § current": section(readme, `# workflow-kit — v${readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim()}`, "## What's new in v2.7.0", "README"),
    "README.md § v2.7.0": section(readme, "## What's new in v2.7.0", "## What's new in v2.6.1", "README"),
    "README.md § v2.6.1": section(readme, "## What's new in v2.6.1", "## What's new in v2.6.0", "README"),
    "README.md § v2.6.0": section(readme, "## What's new in v2.6.0", "## What's new in v2.5.0", "README"),
    "README.md § v2.5.0": section(readme, "## What's new in v2.5.0", "## What's new in v2.4.0", "README"),
    "README.md § v2.4.0": section(readme, "## What's new in v2.4.0", "## What's new in v2.3.0", "README"),
    "README.md § v2.3.0": section(readme, "## What's new in v2.3.0", "# workflow-kit — v2.2.1", "README"),
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
    [/nothing on this page is enforced/i, "the blanket claim that NOTHING in /orchestrate is enforced — false since v2.4 shipped guard-brief-rung"],
    // The SAME retraction in the mirror's own wording. v2.4 corrected the body and left PORTABILITY
    // saying "Nothing in it is enforced" — the pattern above misses that by four words, so the
    // claim went on shipping on the surface this test exists to bind. A retraction is not complete
    // until every spelling of it is pinned, not just the one the author happened to be looking at.
    [/nothing in it is enforced/i, "the same blanket claim in the mirror's wording — the spelling that survived the v2.4 correction"],
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
    "the kit's two real controls are still the task-lane declaration",
    "⚠ Nothing on this page is enforced. No control counts rounds",
    "Nothing in it is enforced, and it says so. No control counts gate rounds"];
  for (const [i, [re, what]] of retracted.entries()) {
    assert.match(decoys[i], re, `the pattern for "${what}" must still match its own retracted spelling`);
  }
});

// ── (2) the reference layers, and the enumerations that must agree with the tree ────────────────

test("architect-build routing keeps delegated authority, quiet boundaries, fourth-gate eligibility, and one architect", () => {
  const skill = readFileSync(ARCHITECT_SKILL, "utf8");
  const routing = readFileSync(ARCHITECT_ROUTING, "utf8");
  pin(skill, "Only an Owner launch instruction may activate a `/orchestrate` PM or emit an execution handoff.", "launch gates every PM activation and handoff");
  pin(skill, "Without launch, preserve planning continuity only. Existing authorized execution\ndoes not need a renewed launch.", "no-launch file-only boundary");
  pin(routing, "In file-only mode, a launch emits the same handoff through file-only\nequivalents. Without launch, preserve planning continuity only.", "launch gates file-only handoff");
  pin(routing, "Every Principal packet carries, or consults in the durable record, baseline, delegation/limits, current\ndirectives, and alignment check.", "persistent packet currency and delegation provenance");
  pin(routing, "Below-trigger questions\ndo not contact the persistent architect unless an existing gate independently requires its own seat.", "quiet current-chip boundary");
  const principalDirectionTrigger = "unresolved in-envelope program decision or concrete PM authority, safety, or evidence conflict requiring Principal direction";
  pin(skill, principalDirectionTrigger, "the PM has a durable contact trigger for an uncovered in-envelope decision or concrete conflict");
  pin(routing, principalDirectionTrigger, "the authoritative routing layer cannot drop the Principal-direction trigger");
  pin(routing, "persistent architect independently satisfies every existing process-review eligibility and freshness\nrequirement.", "combined fourth-gate eligibility");
  pin(routing, "Recovery does not promote advice, create an acting architect or second PM, or block covered work.", "recovery preserves one architect chain");
  pin(routing, "With explicit Owner delegation recorded for the program, Architect is Project Principal: accountable for", "delegated Principal owns program continuity");
  pin(routing, "Owner alone retains initial baseline/launch; material outcome/scope/budget/risk; critical product choice;", "Owner reservations remain explicit");
  pin(routing, "When Principal is unavailable, do not create an acting architect.", "unavailable architect does not mint a replacement chain");
  pin(routing, "Controller admission is necessary recorded-shape evidence, never certification of a complete tier roster.", "controller shape is not a full T3 roster certification");
  pin(routing, "T3 roster missing\nits configured lens or external family is not full even if a two-family controller predicate accepts it.", "T3 family assurance stays outside the controller-shape claim");
  pin(routing, "On a rejected execution method, hold its affected action and preserve exact\nevidence for Principal-supported-method diagnosis; a valid ordinary retry proceeds", "rejected-method routing holds only the action and preserves ordinary retry authority");
});

// The list below is the tree's, not a habit: it was ["CHIP_BRIEF.md", "PROTOCOLS.md"] while a THIRD
// layer shipped beside them, so a test named "both reference layers" governed two of three and the
// new one's pointer and budget were unpinned. Add the file here when a layer is added.
test("every reference layer is named by the body and declares its own budget", () => {
  const body = readFileSync(BODY, "utf8");
  for (const sibling of ["CHIP_BRIEF.md", "PROTOCOLS.md", "RUNG_ZERO.md"]) {
    // Scoped to the LOADABLE PATH, not the bare filename. The body names each sibling twice — once
    // in the budget line, once in the pointer — so `includes("CHIP_BRIEF.md")` stays true after the
    // pointer is deleted, which is the mention surviving while the instruction to load it is gone.
    // The bare-filename form stays green under exactly that strike. The budget
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
    // EVERY reference layer travels with the body — a shipped pointer to an uninstalled file is a
    // dead end in the adopter even though it resolves in the kit tree. (This comment said "Both"
    // while the list below it had grown to three: a count in prose beside the list it describes
    // goes stale silently, which is why the list is the thing to read.)
    for (const sibling of ["CHIP_BRIEF.md", "PROTOCOLS.md", "RUNG_ZERO.md"]) {
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
    pin(installed, "**A remote GO is the Owner's alone**", "installed body keeps the GO rule");
    pin(installed, "One rung on this page is enforced WHEN ITS HOOK IS ARMED", "installed body keeps the enforcement honesty");
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

// ── (4) the mirrors this release added, each pinned ────────────────────────────────────────────
// WHY: a v2.7.0 panel found SEVEN instances of one class — an enumeration completed in one place and
// left short in another. Role table vs § Routing, the label forbid-list vs its cited source, the
// release note vs the body. Every one was a HAND-MAINTAINED MIRROR with no mechanism holding it to
// its source. The rule that came out of it: a mirror either goes, or it gets a pin. These are the
// pins. § Routing and § Standing duties — the two sections this release exists for — had none.
test("reserved decisions route through the PM without a portable mirror", () => {
  const body = readFileSync(BODY, "utf8");
  const brief = readFileSync(path.join(KIT, "skills", "orchestrate", "CHIP_BRIEF.md"), "utf8");
  assert.match(body, /Owner alone decides critical product intent\/risk, material scope\/budget,\s+credentials\/access change, money\/new-spend/,
    "§ Routing names the Owner-only boundary without treating Principal delegation as a release waiver");
  assert.match(body, /Principal decides nonreserved in-envelope questions/,
    "§ Routing makes delegated program direction binding rather than advisory");
  assert.match(body, /rejected method is held with\s+exact evidence for Principal-supported-method diagnosis; a valid ordinary retry proceeds, otherwise an unresolved reserved\s+exception reaches Owner once through Principal/,
    "§ Routing gives rejected methods one Principal diagnosis before the unresolved Owner exception");
  assert.match(body, /A chip routes\s+those calls through PM using `CONSULT:` or `RULING NEEDED:`/,
    "§ Routing keeps chip-to-PM consultation distinct from Owner-facing form");
  assert.match(body, /core\/OWNER_COMMS\.md` rule 8, not mirrored here/,
    "§ Routing points to the canonical generated Owner-facing source");
  assert.match(brief, /EXAMPLES, not a closed set/,
    "CHIP_BRIEF must key the carve-out to what the TARGET REPO reserves, never to a shipped count");
  // The role table is the mirror a reader meets FIRST. It must POINT, never re-enumerate: a second
  // copy is the thing that went stale (it listed three of five, sixteen lines above the fix).
  const roleRow = body.split("\n").find((l) => l.startsWith("| **Owner**"));
  assert.ok(roleRow, "the role table has an Owner row");
  assert.ok(/§ Routing/.test(roleRow),
    "the Owner role row must POINT at § Routing rather than restate the reserved set — a restated list is a mirror that goes stale");
});

test("the Owner-facing label rule has one canonical generated source", () => {
  const body = readFileSync(BODY, "utf8");
  const brief = readFileSync(path.join(KIT, "skills", "orchestrate", "CHIP_BRIEF.md"), "utf8");
  for (const [name, text] of [["body", body], ["brief", brief]]) {
    assert.match(text, /core\/OWNER_COMMS\.md` rule 8/, `${name} routes Owner-facing form to generated rule 8`);
    assert.doesNotMatch(text, /`QUESTION:`|`RECOMMENDATION:`|`DECISION NEEDED:`/,
      `${name} does not hand-maintain a partial Owner-facing label mirror`);
  }
});

test("§ Routing and § Standing duties exist in the body — the two sections this release added", () => {
  const body = readFileSync(BODY, "utf8");
  assert.match(body, /^### Routing — the Owner is not a queue$/m, "§ Routing is present");
  assert.match(body, /^## Standing duties/m, "§ Standing duties is present");
  assert.match(body, /An unsure consult never times out/,
    "the consult timeout must fail CLOSED on an unsure classification — the tie-break otherwise routes the uncertain case into the bucket the timeout empties");
  // v2.31 dropped this rule from the body; a background worker then ended its turn "waiting" on a
  // review that had already exited, and nothing woke it.
  assert.match(body, /Never end a turn on a\s+consult or a wait/,
    "a worker must never end a turn on a consult or a wait");
});

test("ordinary consult timeout uses the worker's recommendation and retains every authority boundary", () => {
  const brief = readFileSync(path.join(KIT, "skills", "orchestrate", "CHIP_BRIEF.md"), "utf8");
  pin(brief, "known ordinary PM-owned consult may proceed\n   only on the worker's already-submitted recommendation", "ordinary timeout uses the submitted worker recommendation, not an absent PM reply");
  pin(brief, "reversible local work within the current CHIP's approved\n   paths and existing execution/review authority", "ordinary timeout stays in the approved CHIP and local authority");
  pin(brief, "Report it; a later PM ruling supersedes.", "later PM ruling supersedes the worker fallback");
  pin(brief, "Principal-required ruling, Owner reservation, external/live/irreversible action, missing\n   gate/admission, or stopped/revoked authority", "timeout cannot cross Principal, Owner, action, gate, or revoked-authority boundaries");
  pin(brief, "If you were UNSURE\n   which bucket it fell in, the timeout does not apply", "unknown authority remains held");
});

// ── (5) CROSS-SURFACE SENSOR — derived SURFACE set, ENUMERATED phrase set ──────────────────────
// WHAT THIS IS, STATED AT ITS REAL SIZE. It walks the shipped docs from disk and asks each whether
// it carries a claim's shape, so the SURFACE set is derived and a new file is covered without
// editing this test. That half is real and it is why a closure hiding in CHIP_BRIEF was caught.
//
// ⚠ WHAT IT IS NOT. On the CONTENT axis it is a hand-maintained enumeration — a list of number
// words and three closure phrasings — which is the very defect it was written to catch, one axis
// over. It is a SENSOR (§ 0.3): it surfaces candidates and NEVER claims prevention. Do not read a
// green run as "the class is closed."
//
// ⚠ AND IT UNDER-FIRES, which is the dangerous polarity: a miss is a SILENT GREEN that reads as
// coverage to the next editor. The sibling check this repo already dropped over-fired, and a false
// BLOCK is at least visible.
//
// DEFEATING INPUTS — EXECUTED against this pin, not reasoned about. Each returned GREEN:
//   1. "The reserved set is now **seven items**."      alternation stops at six — and that miss is
//                                                      itself an enumeration short by one.
//   2. "The reserved set is now **5 items**."          digits are outside the alternation.
//   3. "There are exactly five Owner-reserved
//       decisions, and no others."                     gate fires, no shape matches.
//   4. A doc saying "never use labeled leads when addressing the Owner" is never CHECKED at all —
//      test 2's gate requires the "Owner-facing" spelling.
//   5. t.includes("RECOMMENDATION:") is satisfied by the label appearing in an EXAMPLE of the
//      forbidden usage. A grep proves a spelling, never a claim.
//   6. The label harvest drops any label with a hyphen or digit — `FOLLOW-UP:` never matches,
//      EXECUTED and confirmed — and the >= 3 floor stays green when a fourth fails to harvest.
//      A derived set that can silently SHRINK is short-by-one waiting on the next label.
//
// THE HONEST CLASS-CLOSER IS BANKED, NOT BUILT: § 0.3's DECLARATION route — a doc discussing the
// reserved set emits an author-written marker and the control enforces the marker mechanically.
// Bounded input, not a fourth regex pass. The repo's own precondition forbids the fourth pass.
//
// AND ON THE MUTATION PROOFS BELOW: they re-insert phrasings ALREADY INSIDE the matcher, so they
// prove SURFACE reach and say nothing about PHRASE reach. A mutation drawn from inside your own
// matcher tests the matcher's plumbing, not its scope.
//
// (The walk skips a `docs/` directory that does not exist in this kit and is referenced nowhere in
// bin/init.mjs — verified; the skip excludes nothing today.)
function shippedDocs() {
  const out = [];
  // `.claude` holds a lane's WORKING files — gate records, findings, sidecars — not shipped
  // doctrine. Walking it made every lane's own notes answerable to the cross-surface pins below,
  // so a gate record that merely QUOTED a rule could redden a suite it was only reporting on.
  const skip = new Set(["node_modules", ".git", ".claude", "tests", "acceptance", "docs"]);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".tmpl"))) out.push(p);
    }
  };
  walk(KIT);
  return out;
}

test("cross-surface: no shipped doc asserts a CLOSED set of Owner-reserved decisions", () => {
  // The carve-out that lets a worker proceed without an answer is keyed to this set. A closed list
  // is short in every repo it is wrong about, and short stopped meaning "ask the Owner" the moment
  // it was keyed to a timeout. So no surface may assert the closure — not even a release note.
  const offenders = [];
  for (const f of shippedDocs()) {
    const t = flat(readFileSync(f, "utf8"));
    if (!/Owner-reserved|reserved set|things are the Owner's|reserved to the Owner/i.test(t)) continue;
    // A closure is a count asserted AS the set. A count offered as examples is fine and necessary.
    const closes = /reserved set is now \*\*(two|three|four|five|six) items\*\*/i.test(t)
      || /the (two|three|four|five|six) Owner-reserved items\b(?![^.]*example)/i.test(t)
      || /Name the (TWO|THREE|FOUR|FIVE|SIX) items reserved to the Owner/i.test(t);
    if (closes) offenders.push(path.relative(KIT, f));
  }
  assert.deepEqual(offenders, [],
    `these surfaces assert a CLOSED Owner-reserved set: ${offenders.join(", ")}. The set is a ` +
    `property of the TARGET repo; a portable file may give examples, never a closure. A count that ` +
    `DESCRIBES is fine; a count that BINDS is a rule wearing a note's clothes.`);
});
