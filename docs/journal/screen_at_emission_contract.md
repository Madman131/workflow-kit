# Contract — screen the RECOMMENDATION, not just the finding (v2.19.0)

**Origin (Owner-shown, 2026-08-26).** Live from MRR: a successor gate ran to **Round 26**, hit a
"terminal STOP," and proposed a GO to build ANOTHER successor adding elaborate source-analysis machinery
("reject any enclosing try/catch"). The Owner had to ASK "do these meet RULE #1 / KISS / zoom-out?" — only
THEN did the agent screen and reverse itself: the candidate code was correct; the NO-GO concerned a
**hypothetical future wrapper the candidate doesn't exhibit**; the proposed control was **test machinery,
not repair**. Owner: *"the repos are not asking themselves about the core rules before making a suggestion
to me — I need to ask it, and THEN it decides the recommended action does not meet criteria."*

## The defect (not missing doctrine — un-applied doctrine)

RULE #1 (`core/FOUNDATIONS.md`), the per-finding screen (`core/WORKFLOW.md` § Gate: HARM?/REAL?/SCOPE?/
WORTH-IT?), the disposition brake, and the zoom-out/KISS lens ALL exist and would have caught Round 26
(REAL? defers a hypothetical; zoom-out forbids growing machinery a repair introduced). They were applied
**reactively (when the Owner asked)**, never at the **emission boundary** — the moment a NO-GO closes or a
successor/added-control is proposed TO the Owner. Under gate-momentum ("found a gap → propose a fix"), the
agent skips the screen and the Owner becomes it. The model applies the screen correctly WHEN it runs it;
the gap is purely that nothing forces the run before the recommendation ships.

## The fix — RULE #1 binds the RECOMMENDATION, and the screen is EMITTED

One clause completing RULE #1 in `core/FOUNDATIONS.md` (WORKFLOW.md is at its size cap — 10 B headroom;
FOUNDATIONS is RULE #1's home, a boot doc, 16 KB headroom):

**RULE #1 (+ REAL + zoom-out/KISS) binds the ACTION you recommend to the Owner, not only the findings.**
Before a NO-GO closes, or a successor / continuation / added control is proposed, screen the PROPOSED
ACTION and EMIT that screen in the record. Two named defaults, each an existing rule made unskippable at
this boundary:
- **A finding about a HYPOTHETICAL the candidate does not exhibit** — a future restructuring, a wrapper
  that is not in the code — is NOT in the declared threat model ⇒ **DEFER, never a blocker** (RULE #1's
  own "a future reader might misread" ⇒ NOTE, and § Gate's REAL? ⇒ DEFER). The candidate being correct is
  the answer, not a springboard to invent a different future implementation to fail.
- **A remediation that ADDS a control / test / machinery** rather than fixing a LOCATED product defect is
  the zoom-out case ⇒ **narrow, delete, or escalate — never grow** (KISS: the control must not become the
  product or the dominant defect source).

**Enforcement (honour-but-visible, like `pass-type` / `entry:`):** the screen is a REQUIRED emitted part of
any NO-GO close / continuation proposal; **no emitted screen ⇒ the recommendation is out-of-process.** The
Owner reads a decision with its screen attached, and its ABSENCE is the signal — he never has to request it.

## Acceptance criteria (falsifiable)

- **AC1:** the clause states the screen binds the RECOMMENDATION/continuation, not only findings, at the
  emission-to-Owner boundary.
- **AC2:** the hypothetical-the-candidate-doesn't-exhibit default = DEFER/out-of-model is stated explicitly.
- **AC3:** the add-machinery-vs-located-defect default = zoom-out (narrow/delete/escalate, never grow) is stated.
- **AC4:** the screen is REQUIRED and EMITTED (visible), with "no screen ⇒ out-of-process."
- **AC5:** it does NOT weaken RULE #1's harm test or its carve-outs (irreversible/prod-write/gate-ran-lighter
  still screen FIRST), and does NOT create a bogus-DEFER path — a DEFER of a reviewer-rated blocker still
  owes the failed trigger (§ Gate symmetric brake), so "call it hypothetical" cannot waive a real defect.
- **AC6:** `tests/gating-doctrine.test.mjs` still green — esp. "every surface that APPLIES rule #1 states all
  three targets" (the three targets stay intact) — plus a NEW pin for the screen-at-emission clause so it
  cannot silently drop. Doc-size gate green (FOUNDATIONS well under cap).

## Adversarial seeds (comply-yet-fail to pre-empt)

- **Bogus-DEFER:** an agent labels a REAL defect "hypothetical" to DEFER it. → Fence: the hypothetical
  default applies only when the candidate provably does NOT exhibit it; a DEFER of a rated blocker owes the
  strongest trigger + why it's out-of-model (existing symmetric brake) — the screen must SHOW it, not assert it.
- **Screen-as-ritual:** an agent emits an empty/rubber-stamp screen. → It's honour-but-visible (same as
  pass-type); the Owner/orchestrator spot-checks, and the emitted screen forces the thought. Not claimed as
  mechanical proof.
- **Collision with "any accepted blocker closes STOP" (§ Gate Final-gate):** does DEFERring a hypothetical
  contradict it? No — a hypothetical the candidate doesn't exhibit is not an ACCEPTED blocker; it's
  out-of-model. The clause routes it to DEFER *before* it becomes "accepted." Reconcile in wording.
- **Does it duplicate the disposition brake (§ Gate line 83)?** The brake is an internal self-audit on
  all-REMEDIATE rounds; this makes the screen EMITTED and adds the successor/NO-GO/add-machinery triggers +
  the two defaults. Complementary, not contradictory — sweep both.
- **Findability:** the rule lives in FOUNDATIONS but fires at the WORKFLOW § Gate disposition. RULE #1 is
  already cited there per-finding, so the linkage exists; if the walk-through finds the linkage too weak, add
  a tight trigger-pointer in § Gate (needs ~150 B trim, WORKFLOW being full).

## Sweep surface (this changeset's edits; others hand-synced)
`core/FOUNDATIONS.md` RULE #1 (the clause), `tests/gating-doctrine.test.mjs` (a new pin + confirm the
three-target pin holds), this contract, VERSION/README/package.json to 2.19.0. Check whether the RULE #1
mirror-surfaces test ("every surface that APPLIES rule #1") requires the new clause on other surfaces or
only the three targets (it pins the targets; the new clause is FOUNDATIONS-canonical unless the test says
otherwise). No mechanism/hook change (doctrine only) — unless the Owner wants the optional armed sensor.

## Gate record

Frozen v1 candidate `35cb761`. Builder kill-pass: full suite green. Then the mandated adversarial
walk-through + a cross-family Codex seat — **both landed the same verdict: v1 was decorative.**
- **CRITICAL (both) — placement/forcing-function.** v1 put the obligation in FOUNDATIONS (a boot doc) while
  the emission template the agent fills (`WORKFLOW:81`) was unchanged and had no slot. "No emitted screen ⇒
  out-of-process" was weaker than `pass-type` (no reserved field + no teeth at the emission surface), so
  absence was invisible and it degraded to the same "should" that failed at Round 26.
- **HIGH (both) — label-based, not evidence-based.** The defaults ("hypothetical", "added machinery") were
  self-judged: an agent could downgrade-then-relabel a real defect, or call a legitimate located-defect fix
  "added machinery" to dodge warranted work.
- Contradiction/precedence checks: no collision (RANK-4 LOW).

**Batch-1 remediation (all applied):** mirror `pass-type` exactly — a reserved **`ACTION-SCREEN` slot** in
`WORKFLOW:81`'s emission line (absence now a visible empty slot; two redundant clauses trimmed to fit the
25,088 B cap, headroom 37 B), the **VOID-without-it teeth** in `core/REVIEW.md` beside the free-pass rule,
and the rule made **evidence-bound** in FOUNDATIONS: a defect reachable *as-shipped* is REMEDIATE regardless
of framing, any trigger that fires on the candidate forbids DEFER, and a proportionate fix for a *located*
defect is allowed (only hypothetical/non-located machinery is the zoom-out case). Carve-outs still screen
first. Full suite green after remediation.

**R2 — fold-check on the delta pending; then Owner wording sign-off (= push-GO).** No hook ripple (the
hook-contract test pins only the bold funnel questions + the block up to "LADDER: continue"; the slot is
neither). Note the WORKFLOW cap is at 37 B headroom — flag a small Owner cap-raise as optional hygiene, the
fix fits without it.
