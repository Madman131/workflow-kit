# Contract — proportional panel weight + builder kill-pass (core/WORKFLOW.md § Gate)

**Origin.** Cross-lane 2026-08-25 (`gating-efficiency-proportional-panel-weight.md`): three lanes running
the terminal aggregate controller each hit the SAME over-gating class. The controller bounds the number
of ROUNDS (≤3 batches + bookend) but says nothing about PANEL WEIGHT scaling to residual risk, and does
not mandate a builder self-attack before freezing. So a continuation whose findings had collapsed to one
peripheral doc sentence still drew a full 7-seat mixed-fleet panel, and formal panels did discovery work
a builder self-attack should have exhausted. The gates caught genuine harm — the panels STAY; the waste
was CADENCE.

**Tier: T2 core-document amendment to GATE MACHINERY** (`core/WORKFLOW.md` § Gate sets the cadence a gate
runs at). Owed: cross-family panel, an adversarial walk-through, a `/sweep` dependency sweep before fold,
and the Owner's wording sign-off (which is its push-GO). No external gate (prose/idea). Owner said "do it";
Owner EXCLUDED the standing q6h recurring audit from doctrine ("not sure I want this across the board for
all repos — might be overkill"). This chip lands the CADENCE, never the audit.

## The collision this must resolve (the whole reason it is gated)

The doctrine says, in THREE places, that the panel never lightens:
- `§ Steer` rung-order rule 2: *"a budget-free rung ... never reduces the panel's depth, scope, or seat count."*
- `§ Gate` enumerate-rungs: *"Prior rounds are never a reason to run a lighter one."*
- `FOUNDATIONS` RULE #1: *"It reduces the number of REPAIRS, never the DEPTH of review — cutting seats is the misreading."*

"Panel weight scaled to residual risk" collides with all three if read carelessly. **The resolution — the
axis they operate on differs:**
- The MANDATED FLOOR (the tier's seat counts + cross-family requirement, `core/REVIEW.md` § Decorrelation:
  ≥2 angle reviewers + free adversary at T2, ≥3 + both families at T3) is a FLOOR that never drops — not
  for a clean free rung, not for good prior rounds. The three clauses protect this floor. UNTOUCHED.
- What SCALES to residual risk is the weight PROVISIONED ABOVE that floor: an inflated mixed-fleet roster,
  extra seats beyond the mandate, added at appetite. A first round or one carrying real unresolved harm
  earns the full roster; a continuation/bookend whose accepted findings have collapsed to peripheral,
  contained residue precommits the MANDATED seats, not the inflated roster.

**Two guards make it un-abusable:**
1. It keys on RESIDUAL RISK carried BETWEEN rounds — never on a clean budget-free pass (that never lightens
   anything: rung-order rule 2 stands).
2. It never runs below the mandate; "prior rounds went well" is still not a reason to under-run the floor.

It is NOT a seat cut: the seats that catch harm STAY (RULE #1). It removes the EXCESS provisioned past the
floor on a low-residual-risk candidate, where an adversarial panel (which never runs out of findings) buys
refutations, not safety — negative expected value.

## What changes

**Placement (decided during build):** the doctrine lands in `core/REVIEW.md` § Decorrelation, NOT the
`core/WORKFLOW.md` controller ¶ — because (a) `core/WORKFLOW.md` was at 25078/25088 B (10 B headroom; a
1.3 KB addition cannot fit without a cap raise), and (b) § Decorrelation is the MORE natural home: it
already defines the seat counts (≥2 T2 / ≥3 T3 + free adversary) that ARE the "mandated floor," so
"weight above the floor scales to residual risk" belongs beside them. `core/WORKFLOW.md` is untouched.
One new paragraph after the § Decorrelation paragraph, before § Cross-family lens:
1. **Builder kill-pass BEFORE `panel_open`.** The builder runs one rigorous local self-attack + the focused
   RED/GREEN controls before freezing. The panel is the independent check on a candidate the builder
   already tried to break — not the builder's first attack surface.
2. **Panel WEIGHT scales to residual risk, the FLOOR never does.** The excess provisioned ABOVE the tier
   floor scales to the residual risk the prior round left; the floor (§ Decorrelation's own seat counts +
   the cross-family requirement) never drops. Two fences stated inline (keys on residual risk not a free
   pass; never below the mandate). NOT the seat cut RULE #1 forbids.

*(Item 3 from the origin memo — "never re-run the exact-clone suite for prose" — and the external-gate
caching are HELD as a small separate follow-up; this chip is scoped to the panel-weight + kill-pass
doctrine, one coherent concern, to keep the amendment tight.)*

## Acceptance criteria (falsifiable)

- **AC1:** the amendment states the kill-pass as a PRE-freeze builder step, distinct from the panel.
- **AC2:** it states panel weight scales to residual risk AND that this never drops the mandated tier floor
  (naming REVIEW § Decorrelation's seat counts), AND that it is not triggered by a clean free rung, AND that
  it is not the seat-cut RULE #1 forbids. All four fences present, or it is under-specified.
- **AC3:** it does NOT introduce or mandate the q6h recurring audit.
- **AC4:** no existing clause is left contradicted — the three no-lighten clauses stay TRUE and are
  reconciled, not overwritten (neighbourhood sweep by claim).
- **AC5:** `tests/gating-doctrine.test.mjs` still green (esp. the "round controller is stated in one shape
  everywhere", "finite aggregate cadence agrees between every live surface", and the hook-contract pins),
  plus any new pin this amendment needs so the surfaces cannot drift.
- **AC6:** the doc-size budget gate stays green for `core/WORKFLOW.md`.

## Adversarial walk-through seeds (an agent complies yet the failure recurs)

- A builder reads "weight sized to residual risk" as license to drop from the T2-mandated 3 seats to 1 on a
  "low-risk" first round. → The floor fence must make this a MANDATE violation (gate-ran-lighter carve-out).
- A builder claims "my free rung passed, so residual risk is low" to shrink the panel. → Guard 1 (keys on
  between-round residual, never on a free pass) must forbid this by name.
- A bookend on a STOP-reserved changeset is lightened below the mandate. → The bookend ALWAYS runs at the
  mandated floor; only excess above it scales.

## Sweep surface (files this changeset edits; others stay hand-synced)

`core/REVIEW.md` § Decorrelation (the one new paragraph — the actual edit surface), this contract. The
efficiency MEMORY entry is updated to point at the landed doctrine (out of repo). `core/WORKFLOW.md` is NOT
edited (it was at its size cap), so its controller/Final-gate clauses stay hand-synced — the amendment
CITES them rather than editing them.

## Gate record

Frozen-candidate work in `claude/proportional-panel-weight` from `94f2fac`. Full suite green at each step.

**R1 — adversarial walk-through (mandated for a gate-machinery amendment).** A blind seat constructed
comply-yet-fail scenarios and found FIVE issues, two HIGH:
- **#1/#2 [HIGH, accepted → REMEDIATE].** The draft reconciled the three no-lighten clauses its own AC4
  sweep named (§ Steer rung-order rule 2, § Gate enumerate-rungs, RULE #1) but MISSED the two that govern
  the terminal bookend — the § Gate **Final-gate rule** ("full precommitted panel") and the controller's
  **"complete expected seat set."** As written, an agent could run the R4 bookend, or a fresh R3
  root-replacement, at the FLOOR on a self-judged "collapsed residual" label — and a fresh rewrite has zero
  *findings* only because it has had zero *review*. That is the seat cut RULE #1 forbids, re-entering
  through the bookend. **The AC4 sweep was INCOMPLETE — the walk-through is exactly the control that caught
  it** (a design-mode reconciliation missed two colliding clauses on an unedited surface).
- **#3 [MED, REMEDIATE].** Fence (1) named only "the budget-free rung," so a clean kill-pass could be used
  to argue "residual is low."
- **#4 [MED, REMEDIATE].** The kill-pass was framed as a mandatory freeze-precondition but anchored nowhere
  enumerable — an orphan mandate.
- **#5 [MED-LOW, REMEDIATE].** "mixed-fleet" (droppable excess) sat one word from "cross-family" (floor).
- #6/#7 (below-floor seat cut; first-round under-weight): HELD — the floor language stopped them.

**Batch-1 remediation (all in the one paragraph):** the terminal R4 bookend AND any root-replacement
candidate ALWAYS receive the full precommitted panel, citing the Final-gate rule + controller inline;
"collapsed residual" anchored to REVIEWED residual (R1→R2 continuation), with "zero findings on unreviewed
code = absence of review, not absence of risk" stated; fence (b) excludes the builder's kill-pass/RED-GREEN
as a lightening basis; kill-pass demoted from orphan mandate to the builder's discipline that "never
lightens the panel"; cross-family made explicitly FLOOR, "never the droppable mixed-fleet excess."

**R2 — fold-check** on the remediation delta: verifying each finding closed + no new hole (in flight).
Then `/sweep` by claim, then the Owner's wording sign-off (= push-GO). No external gate (prose/idea).
