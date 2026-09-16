# Architect consult routing — pre-implementation T2 brief

**Status:** pre-implementation design; no doctrine, skill, template, test, controller, or scheduler
has changed.
**Source packet:** `/private/tmp/workflow-kit-architect-consult-policy/`, SHA-256 verified on
2026-09-16. The packet informs this design; it is not adopted wording.
**Candidate base:** `332da81d71842841e51ecc26db6c129cb0026b59`.

## Rung Zero — classification, intent, and proof

The Owner requested this as a **T2 core-document/gate-policy** change. It changes text agents will
follow when selecting a consult, including a gate checkpoint, so it is FULL T2 under
`core/WORKFLOW.md` § Steer, “Core-document amendments are never T0.” That clause requires a panel,
Owner wording sign-off, and an adversarial walk-through for gate machinery. The same section requires
the T2 pre-code contract lens before code exists; this brief is that contract, not a discharged gate.

**Intent:** add one portable consult-routing policy with two destinations, without creating a second
controller, scheduler, review path, or implementation authority.

**Done:** a future implementation makes the destination decision unambiguous and preserves the
existing fourth-gate and frontier-budget rules. It leaves program-specific task names and model bindings
outside kit doctrine.

**Proof required before the implementation is accepted:**

1. Core-document T2 rungs enumerated by citation from `core/WORKFLOW.md` § Steer and § Gate;
   pre-code cross-family contract lens, cold panel, cross-family lens where available, Owner wording
   sign-off, and the required adversarial walk-through all have receipts.
2. Static checks and focused tests prove that the one-home rule is represented once, pointers do not
   contradict it, no second discretionary frontier firing is introduced, and no text implies transport,
   automation, or authority that does not exist.
3. A reviewer can trace each routing example below to exactly one destination and confirm that neither
   destination authorizes implementation, a push, deployment, a live write, or a tier change.

No push, publication, merge, deployment, model invocation, or live-data action is authorized by this
brief. Any remote publication still needs a fresh Owner GO for the exact head and target.

## Proposed portable policy

### One policy, two destinations

`core/WORKFLOW.md` will be the sole authoritative home for the routing rule.

1. **Active consult** is a bounded, current-candidate consultation attached to a current changeset,
   gate, design ambiguity, root-cause escalation, process question, fold-check, or required fourth-gate
   checkpoint. It has no durable work authority.
2. **Persistent architecture record** is a durable program-level question and record that spans
   changesets, sessions, or repositories. It preserves a recommendation and unresolved decisions for
   later Owner/PM consideration. It is not a scheduler, controller, or second implementation lane.

For a single consult question, evaluate broader/persistent triggers first. If any applies, route the
question to the persistent architecture record; otherwise route it to the active consult. Persistent
triggers are: multiple changesets or repositories; a program-shape or authority-boundary change; an
architecture decision that must survive the current changeset; or a question that cannot be answered
without creating a second design lineage.

The fourth-gate obligation is separate and remains current-candidate gate work. At every cumulative gate
ordinal divisible by four, its required fresh frontier/process review routes **only to the active
consult** for that frozen candidate. The persistent record can later receive the resulting disposition as
evidence, but can neither satisfy, waive, duplicate, nor replace that gate review. Thus each question or
required review has one destination; a broader architecture question does not silently consume the
fourth-gate review, and the fourth-gate review does not create a duplicate architecture review.

### Cadence, packet, response, and disposition

An unresolved persistent architecture record is reconsidered every **five active workdays**. A material
new architecture fact may wake it earlier. Unchanged state remains quiet; the cadence does not create a
background worker, timed task, message transport, or automatic decision.

Both destinations receive one common packet: question; scope; current frozen head/tree where applicable;
source citations; constraints; alternatives; assumptions; unresolved risks; and the exact Owner decision
sought. The active consult additionally names the current gate/round, candidate, and required decision.
The persistent record additionally carries prior dispositions, cross-session continuity, and its
five-workday next-review marker.

A response must state a recommendation, supporting evidence, tradeoffs, unresolved risks, confidence or
insufficiency, and the exact decision boundary it does not cross. The active PM decides whether to adopt,
adapt, or decline it and records the reason and next evidence. In the initiating program, the Sol PM is
expected to make that **adopt / adapt / decline** disposition; portable core wording names the PM role,
not a model. A response is advisory input, never an instruction or implementation authorization.

### Authority, fallback, and portability

The Owner retains intent and critical design decisions, material scope or budget, risk acceptance,
credentials, irreversible or live writes, tier changes where Owner ratification is required, pushes,
deployments, and unresolved terminal decisions. The PM retains only ordinary in-scope disposition and
local execution authority already granted by the method.

If an architect or persistent record is unavailable, the PM continues routine in-scope work, records the
deferred architecture question and missing evidence in the durable program record, and does not substitute
a lower-authority architecture decision. Reconcile it when the architect becomes available: submit the
preserved packet, response gap, intervening decisions, and current state; then record adopt/adapt/decline.
If an active consult is unavailable when a gate requires it, existing fail-closed gate and Owner-escalation
rules apply.

Cross-session messaging is optional harness plumbing. In a portable or degraded environment, the durable
record, file brief, and consult entry are the record of continuity. The policy must not claim an automated
handoff, controller, scheduler, or service that Workflow-Kit does not ship.

## Planned amendment surface

| Planned file | Purpose |
| --- | --- |
| `core/WORKFLOW.md` | One authoritative destination rule, trigger precedence, fourth-gate exclusivity, advisory authority, and fallback. |
| `skills/orchestrate/SKILL.md` | A short operational pointer to the core rule, packet fields, degraded durable-record practice, and the existing fourth-gate route. |
| Focused doctrine/skill tests as proven necessary | Pin the authoritative wording and prevent duplicate budget or transport claims. |

**Explicit cuts from the source proposal:**

- `core/GATES.md` is cut unless implementation uncovers an actual ambiguity in budget accounting. The
  proposed rule changes routing semantics, not runner invocation or budget arithmetic; duplicating it in
  the tool manual would create two authorities.
- `skills/frontier-review/SKILL.md` is cut unless its existing wording cannot point to the authoritative
  rule without contradicting it. The active-consult budget remains there; destination policy belongs in
  `core/WORKFLOW.md`.
- `templates/BINDINGS.md.tmpl`, `agents/frontier-consult.md`, and any model-specific binding are cut.
  The policy requires no new portable role field, and exact model identity is adopter data.
- No program task name, including the NexusBot architect task, belongs in Workflow-Kit core. Program
  binding and operating records remain with the adopting program.
- No controller, scheduler, daemon, transport, or new review seat is planned. Existing review and
  disposition mechanics remain authoritative.

## Adversarial walkthrough cases

| Case | Required result |
| --- | --- |
| A current candidate reaches cumulative gate four while a broad architecture question is already open. | Run one fresh active consult for the frozen candidate; the persistent record may receive its result later and cannot count as that gate. |
| A broad question looks convenient to answer inside the current review. | Persistent triggers win for that question; record it durably and do not mint a second active review. |
| The persistent architect is unavailable on its five-day review date. | Keep routine work moving only within existing authority, write the deferred question and evidence gap, then reconcile when available. |
| A consult recommends changing scope, tier, live behavior, or publication. | Treat it as advisory; stop at the relevant Owner boundary rather than executing or treating the response as a verdict. |
| A degraded adopter has no cross-session message transport. | Preserve the common packet and disposition in the durable record/file brief; do not imply a scheduler or automatic handoff. |
| A repair round attempts to count the persistent response and a fourth-gate active consult as two frontier firings. | Count only the mandated active fourth-gate review; do not spend or duplicate discretionary frontier budget. |

## Stop rules for implementation

Stop and return to the Owner before implementation if the proposed text requires a new model binding,
transport mechanism, scheduler/controller, a second review seat, a change to the existing frontier budget,
or a program-specific authority decision. Stop if core and skill wording cannot be made one-home-per-rule,
or if any gate finding shows an implementer could use the text to bypass a required review or Owner
boundary. This brief itself authorizes neither implementation nor publication.
