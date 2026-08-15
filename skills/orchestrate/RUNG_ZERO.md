# RUNG ZERO — the six checks that run before any gate

Word budget: 2925 (**Owner-ratified 2026-08-12**, twice: from an author-set 2650, then 2900; its own number,
never summed with the body's. **Why:** the first number was set before any reviewer had run and gate
findings cost words to fix; after eight cuts the only material left was the incident bank, and **a cap
may never force deleting doctrine.** Headroom is for the editor after you. *2900→2925 bought the screen below.*)

Reference layer for `.agents/skills/orchestrate/SKILL.md`. **Run this BEFORE the deterministic rungs
and before any seat is spawned.**

⚠ **Read the incidents below as anonymised illustrative lessons, not as receipts.** Each came from a
real program, but anonymising strips what an observation demands — a named artifact — so these are
shapes to recognise, not evidence you can check. **A rule here is load-bearing once your own repo
gives it an artifact.**

**Why it exists.** Deep gates get spent on artifacts a five-minute check would have rejected or
reshaped first. The rounds that follow are not too careful — they are aimed at the wrong thing, and
they find real defects in work that should not have reached them. Rung zero is those checks.

**RULE #1 screens first** (`core/FOUNDATIONS.md`): a finding blocks only by naming harm to the
Owner/user, the product's usability, or the code's FUNCTIONALITY, plus its mechanism. Precedence and the
carve-outs (irreversible · prod write · gate-ran-lighter-than-mandate) screen FIRST and never exit as
a NOTE. Everything else is a NOTE — **recorded**, never dropped. **Noting is free; chasing owes the
work.**

---

## 0.1 THE TIER IS SET, NOT DERIVED

**The tier is SET IN THE BRIEF, at spawn** — by whoever writes the brief, and **ratified by the Owner
before any T2/T3 gate** (`core/WORKFLOW.md` § Steer: *"Builder proposes the tier; Owner ratifies
before any T2/T3 gate"*). The worker VERIFIES the artifact matches the declared tier and **never
re-derives it**. A chip that argues its own tier spends rounds on a question that costs one sentence
at spawn time. *Do not read "set at spawn" as "set by the Owner" — the ratification is the Owner's,
the proposal is not.*

**One escalation path, and only one:** if the artifact stops matching its declared tier — a prose chip
that grows control code, **or one that stays the same class while gaining a gate, emit or stop
semantic** — the worker **STOPS and says so**. It never silently re-tiers, in either direction.
**The trigger is the MISMATCH, not a change of class.**

**STOPS WHAT, AND TELLS WHOM.** Stop *the affected artifact* — freeze it, make no edit against the
disputed reading, and seat no reviewer on it. **Keep building everything the question does not touch;**
a chip that idles its whole scope on one open question converts a ruling into calendar. **This
separates JUDGING from LANDING** — the unfrozen half is gated alone but still lands with the frozen
half or not at all (§ 0.2). Report to
**the orchestrator**, not the Owner: give the stop condition that fired, the artifact it fired on,
options with costs, and a recommendation. **A mis-tier is not discharged by reporting it: the target
repo's rung is *"escalate and RESTART the required gates"* (`core/WORKFLOW.md` § Gate), so the gates
already run at the wrong tier do not count.** **Which decisions are the Owner's, and how even those route
through the orchestrator, is `.agents/skills/orchestrate/SKILL.md` § Routing — do not carry a second
copy of that list here, and do not assume it is shorter than it is.**

| Tier | What it is |
|---|---|
| **T0** | **Local, NON-CODE** — docs, comments, a log string, a memory pointer |
| **T1** | **Local, touches no live prod** — a test, a local tool or script, a local-DB mutation, a *bounded* read-only prod query · prose and instruction artifacts changing **no** gate/emit/stop semantics |
| **T2** | New or changed gate/emit/stop semantics · live control code · **a REVERSIBLE write to live prod** · live-behaviour-path or chain/stateful logic |
| **T3** | Controlling-doc restructure · **an IRREVERSIBLE write to live prod** · an **unbounded** prod read |

**⚠ THIS TABLE NAMES WHAT A TIER IS. IT DELIBERATELY DOES NOT NAME WHAT EACH TIER'S GATE RUNS.**
A ladder is per-repo; a portable table that named one would be a **more convincing wrong answer** in
any repo whose ladder differs, and it would offer exactly the recall path § 0.4 forbids. **Read the
target repo's own ladder and cite it — § 0.4.** Verifying a declared tier needs to know what the
tier IS; it never needs a summary of the rungs.

**TWO QUALIFIERS THE ROWS ABOVE DO NOT CARRY, AND BOTH FAIL CLOSED:**
- **On a controlling doc, UNSURE-whether-semantic ⇒ T2** (`core/ARTIFACT_CLASS.md` rule 6). **Unsure
  resolves UPWARD. Read "use T1" below as advice for work you have already classified, never as the
  answer to a question you cannot settle.**
- **An instruction file that DIRECTS PROD WRITES tiers by the WRITE IT DIRECTS, never as "just
  docs"** — so it does not sit in the T0 row it otherwise matches, and its push is not free.

**Reversibility splits the last two rows; "prod write" alone does not.** Reversible means a tested,
named restore-to-prior-state handle the Owner confirmed at classify-time — not a backup you assume
works.

**PUSH IS A SEPARATE AXIS FROM THE TIER, AND THIS TABLE DOES NOT SET IT.** Read the target repo's own
push rule; in the repos this method came from, **any push containing code needs the Owner's push-GO
regardless of tier**, docs-only pushes are free at T0 only, and a **core-document amendment's Owner
wording sign-off IS its push-GO** — one decision, not two. Do not infer from the rows above that only
T3 needs the Owner; that reading is wrong and it is the kind of wrong that pushes code.

**Use T1. It is the honest tier for most instruction work and it is the one that goes unused.**
**T3 is rare by construction:** a restructure or an irreversible write, not "this feels important."

## 0.2 TIER PURITY — one changeset, one tier

**Does this changeset contain more than one tier, and are they SEPARABLE? If yes, SPLIT BEFORE
GATING.** If genuinely inseparable, the whole takes the highest tier — the target repo's own escape,
not a loophole — but **say WHICH and why**: "inseparable" is the word a bundle hides behind.

A T1 prose change bundled with a T2 gate change or with live control code **inherits the highest
tier for all of it**. This is the single largest source of wasted gate depth: most changesets carry
no control code at all, yet run at T2 or T3 because each bundled one thing that deserved it.

### SPLIT INTO WHAT — commits by default, chips by exception

**The default is SEPARATELY-GATED COMMITS INSIDE ONE CHIP, not two chips.** This is the target repos'
own wording and the noun is load-bearing: *"A change bundling **separable** tiers → split into
**separately-gated commits**; only when inseparable does the whole take the highest tier"*
(`core/WORKFLOW.md` § Steer) — **quoted to the end of the sentence, because the clause that follows
the comma is the exception, and a quotation that stops before it changes the rule.**
**The rest of this subsection is THIS FILE'S policy, not § Steer's:** one chip owns both halves;
each commit is gated as its own artifact at its own tier — the T2 commit takes the mandated panel,
the T1 commit its single cross-family seat; they land together and are judged apart.

**Split into separate CHIPS only when one of these holds — and name which:**
- the halves need genuinely different context, expertise, or repo;
- one half is **blocked or banked** while the other should ship now (a banked artifact is not a sibling
  chip — bank it with its reproducible breaking case and let a successor inherit it);
- one half would exhaust a context window on its own.

**Never split to launder a finding.** A known finding must travel verbatim into the new brief. A split
that leaves a finding behind is a gate bypassed by bookkeeping.

*Incident A: two prose bullets got a control-code panel four times, because they shipped alongside a
gate-changing bullet and a live guard. Split, they would have been one T1 round.*
*Incident B: this section once said only "SPLIT BEFORE GATING" and closed with "split at spawn". A chip
read it correctly, inferred two chips, and priced a doc/code drift window it never needed to accept.
**A summary that drops the precise noun of the rule it summarises licenses the wrong action** — the
target repo's own text said "commits" the whole time.*

## 0.3 THE SEMANTIC CHECK — can a predicate even answer this?

**Does any control here require a JUDGMENT rather than a mechanical fact?** If yes, it is not a
predicate. It is one of:

- a **DECLARATION** — the author declares the semantic fact and the control enforces the declaration
  mechanically. A wrong declaration is then **a statement its author made and can be held to, rather
  than a parsing accident.** *(Available whenever the artifact is structured and the author writes it.)*
- a **SENSOR** — advisory, surfaces candidates, never claims prevention. *(For arbitrary artifacts,
  where no declaration point exists.)*

**A DECLARATION IS ONLY STRONGER THAN A SENSOR IF YOU NAME A CONSUMER WHO READS IT.** Declared,
compared by a checker, backstopped by "spot-check" — and nobody spot-checks: the semantic decision has
moved from the predicate to the declarer and is now unchecked in a new place. **Name the reader, or
ship the sensor.** Do not claim a wrong declaration is "a deliberate false statement" — that is an
over-claim about a cooperative-but-fallible author, and it was caught in the clause that made it.

## 0.4 MANDATED RUNGS, ENUMERATED BY CITATION

**List every rung the TARGET repo's own doctrine mandates for the declared tier AND the artifact's
class — before the gate runs.** Not from memory, and not from a brief whose gate spec is lighter than
the mandate.

**CITE BY FILE AND SECTION NAME, QUOTING ENOUGH OF THE CLAUSE TO SURVIVE RENUMBERING. A line number
alone is a moving reference** — another amendment inserts lines above it and your citation silently
resolves to different text while you were fully compliant.

**Enumerate against the artifact's CLASS and file set, not the tier row alone.** The rung most often
missed is the one a general tier row does not mention because **a narrower clause elsewhere adds it** —
a core-document amendment's Owner wording sign-off, or a single seat's cross-family requirement losing
its escape on `core/` files.

*Incident: a mandated adversarial walk-through went unrun for three rounds; the first time a seat
ran it, it killed the clause in minutes — a clause that had already survived three full panels.*

## 0.5 PACKET DRY-RUN

**Before spawning any seat, check the packet against the repo's own packet rules.**

**A PACKET RULE HAS TWO HALVES AND AUTHORS ONLY REMEMBER THE PROHIBITION. Check BOTH:**
- **CARRY** — every changed file in full, the pre-change text of anything deleted, the **outputs** of
  commands the seat would otherwise have to predict against (it holds no shell), and **the governing
  clauses whatever claim you are asking it to judge rests on.** A diffstat is not a diff, and
  `git diff` omits untracked files.
- **EXCLUDE** — no append-only review artifacts. A diff carrying prior verdicts ships them to a seat
  that must not see them.

**VERIFY THE ASSEMBLED BYTES, NOT YOUR BUILD COMMAND.** A packet is complete when you have read what
actually went out — not when you wrote a line intending to include something. *(A truncating `cut`
removed half a section, taking exactly the clauses the claim under review rested on; the author
certified it from the build script and reported the rung discharged.)*

**A filename blocklist is not exclusion. Only packet CONTENTS are.** Asking a seat to ignore what it
was handed does not un-hand it.

**THE PACKET IS NOT THE ONLY CHANNEL.** A clean packet still folds a seat if the **task prompt** you
spawn it with carries prior advocacy, a paraphrased earlier finding, or your own framing of the answer.
Check what you are about to say to the seat, not only what you are about to hand it.

**A packet is not complete in the abstract — it is complete relative to the claim the seat must judge.**
Each round's packet can be complete against last round's finding and incomplete in a new way.

## 0.6 NEIGHBOURHOOD SWEEP

**For any doc or doctrine change: which OTHER lines assert something this change makes false?** Sweep
the same file, the same section, and any sibling doc this changeset also edits.

**Sweep by CLAIM, never by authorship or filename** — and remember a number has multiple spellings
(`44,790 B`, `41.7 KB`, "past its threshold" are one claim in three renderings, and grepping one
proves nothing about the others). **A grep proves a SPELLING, never a claim, and an "absent" result
earns one look at the raw material before you believe it.**

**STATE THE LIMIT, because this sweep is narrower than it sounds: a surface the changeset does NOT
edit is OUTSIDE it** and stays hand-synchronised. Saying so is the point — a sweep believed to be
wider than it is closes a gap it never covered.

---

## The orchestrator's three rules

1. **NO MEASURED NUMBERS IN RULINGS — name the command that produces the number.** A word count, test
   total, file size or branch count goes stale between composing a message and sending it. "Derive it
   from `git show origin/main:<file>` at the moment you act" cannot go stale; "41" can.
   **The exception, and it is not a loophole: a number that IDENTIFIES an artifact is a PIN, not a
   measurement — pin it.** A freeze SHA, a PR number, a squash commit must be quoted exactly, because
   their whole job is to name one immutable thing; "the branch" is what goes stale there. **Test:
   would re-running a command change this number? Then name the command. Does it name a thing that
   cannot change? Then write it down.**
2. **NEVER SPECIFY A GATE LIGHTER THAN THE TARGET REPO'S MANDATE.** Read it, cite it. Economizing on
   prior rounds is not a ruling. **TWO instruments legitimately change which gate applies, and naming
   only one makes the other read as a violation: an explicit TIER CHANGE, and the OWNER'S RISK
   ACCEPTANCE of a named rung.** *(A higher authority changing the MANDATE is not a third instrument —
   it changes the premise, after which you cite the new mandate and lighten nothing.)* The second is
   never yours to grant, and holds only while **all FIVE do: EXPLICIT · PINNED TO A SHA** — a PR
   number keeps its name while its payload changes — **· VOID IF THE HEAD MOVES · READ BY A NAMED
   CONSUMER WHO STILL HAS A RUNG TO RUN** — recorded where nobody downstream remains is a log, and it
   is emptiest exactly when the exempted rung is the LAST one — **· AND ASKED ON A PREMISE YOU DID NOT
   SUPPLY: an acceptance you engineered is one you granted yourself.**
   **⚠ THE FIRST INSTRUMENT NEEDS GUARDING TOO, and it is the cheaper route to a lighter gate:** a
   tier CHANGE is not yours to declare either — `core/WORKFLOW.md` § Steer, *"lowering mid-task
   requires the Owner's confirmed reversibility handle… and is recorded in the PM disposition."*
   **An exception logged as a default stops being asked about.**
3. **STATE-AT-SEND-TIME IN EVERY DISPATCH, AND BATCH RULINGS.** Every report opens with the state it
   was composed against. And chips advance only when messaged, so **message count is elapsed time**:
   five messages where one would do is five turns of calendar.

## Reach — what this file binds, and what it does not

**This file binds a session that LOADS it.** Honest limits, because assuming otherwise is the defect
this whole method exists to delete:

- It does **not** retroactively bind a chip already running — that chip has its brief. Ongoing work
  gets these rules by **message**, not by this file existing.
- It is **not** a repo's gate doctrine. The mandated rungs live in each repo's `core/WORKFLOW.md
  § Gate`, `core/REVIEW.md` and `core/ARTIFACT_CLASS.md`. **To change how a repo's gates run, the
  same rules must land in that repo's own docs** — a skill file cannot do it from outside them.
- ⚠ **So read "run this before any gate" narrowly: it binds the session that LOADS this file and is
  NOT a rung a repo's gate can require.** Wider, and this file demands compliance with a procedure
  it has just admitted it cannot instantiate. **The gap that leaves, named rather than implied: this
  file is in no repo's core-document inventory and cannot put itself there**, so a reader of a repo's
  declared doctrine never learns these checks exist and no control detects the mismatch. Closing it
  means landing these rules in a repo's own docs — **a controlling-document change owing its own
  tier.**
- Nothing here is mechanically enforced. `core/WORKFLOW.md § Gate` says the rounds half outright —
  *"No hook infers it; a round-counting hook was retired"*. **That no control reads a freeze or checks
  who gave a GO is an OBSERVATION about the shipped controls, not a clause you can cite** — check it
  against your own repo rather than inheriting it here. **Rung zero is cheap because it is honest
  about being a checklist, not a control.**
