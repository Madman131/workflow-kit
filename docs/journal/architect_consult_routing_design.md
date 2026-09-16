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
3. A reviewer can trace each routing example below to one fresh response and confirm that neither
   destination authorizes implementation, a push, deployment, a live write, or a tier change.

No push, publication, merge, deployment, model invocation, or live-data action is authorized by this
brief. Any remote publication still needs a fresh Owner GO for the exact head and target.

## Proposed portable policy

### One policy, two destinations

`core/WORKFLOW.md` will be the sole authoritative home for the routing rule.

1. **Internal active consult** is the default: a bounded, current-candidate consultation inside the
   approved chip. It has no durable work authority.
2. **Persistent architect** is a durable program-level task and record for questions that outgrow the
   chip. It preserves a recommendation and unresolved decisions for later Owner/PM consideration. It is
   not a scheduler, controller, or second implementation lane.

Internal triggers are a current-chip design tradeoff, root-cause correction, required gate/process
checkpoint, disputed technical ruling, or another bounded question inside approved scope. Routine
debugging, gathering, and mechanical checks do not trigger Astra.

Persistent triggers are explicit: program inception or baseline; terminal STOP; a material pivot;
engine/provider/foundation selection or replacement; a cross-repo authority or ownership change; a major
sequencing amendment; and a planned phase boundary before the next phase. A change is material when it
alters accepted outcomes, acceptance criteria, foundation, ownership, dependency order, authority, or
budget. A phase boundary is a planned capability or adoption milestone, not each commit, round, or model
switch.

At a normal checkpoint, use the internal active consult. If a persistent trigger is also present, route
**one combined packet** to the persistent architect instead. For every cumulative gate ordinal divisible
by four, a fresh response from that combined packet may discharge both obligations only when it explicitly
binds the required current candidate, panel close, lineage, and proposed action, and separately addresses
the process checkpoint and program alignment. Earlier architecture advice cannot discharge a later
checkpoint. Do not make a second Astra call merely for the other label, and do not add a round, batch, or
authority. If no persistent trigger is present, the required fourth-gate response remains one fresh
internal active consult on the frozen candidate.

### Cadence, packet, response, and disposition

At the first safe checkpoint after **five active workdays with project work** and no program-alignment
review, run the program-alignment review and record the last check. A material trigger may require it
earlier. This is not repeated polling of an unresolved record; unchanged state remains quiet, and the
cadence creates no background monitor, timed task, message transport, or automatic decision.

Both destinations receive one common packet: question; scope; current frozen head/tree where applicable;
source citations; constraints; alternatives; assumptions; unresolved risks; and the exact Owner decision
sought. A gate-bound packet additionally names current gate/round, candidate, panel close, lineage, and
proposed action. A persistent packet additionally carries the durable baseline, latest decisions, and the
last program-alignment check.

A response must state a recommendation, supporting evidence, tradeoffs, unresolved risks, confidence or
insufficiency, Rule #1/KISS/root-cause assessment, program fit, the smallest next action, stop condition,
and the Owner-reserved decision. It must state the exact decision boundary it does not cross. The PM
records **adopt / adapt / decline**, with reason and next evidence. In the initiating program, Sol is the
PM expected to make that disposition; portable core wording names the PM role, not a model. A response is
advisory input, never an instruction or implementation authorization.

### Authority, fallback, and portability

The Owner retains intent and critical design decisions, material scope or budget, risk acceptance,
credentials, irreversible or live writes, tier changes where Owner ratification is required, pushes,
deployments, and unresolved terminal decisions. The PM retains only ordinary in-scope disposition and
local execution authority already granted by the method.

If the persistent architect is unavailable, use **one fresh internal frontier consult as acting
architect** with the durable baseline, latest decisions, current packet, and honest model/effort record;
never claim it inherited context. Later send the memo, PM disposition, and outcomes to the persistent
architect for reconciliation. That is a context update, not a repeat review; reopen only for a newly
identified material conflict. If no eligible route is available, continue independent authorized work and
hold only the dependent decision. If an active consult is unavailable when a gate requires it, existing
fail-closed gate and Owner-escalation rules apply.

Cross-session messaging is optional harness plumbing. In a portable or degraded environment, the durable
record, file brief, and consult entry are the record of continuity. The policy must not claim an automated
handoff, controller, scheduler, or service that Workflow-Kit does not ship.

## Planned amendment surface

| Planned file | Purpose |
| --- | --- |
| `core/WORKFLOW.md` | One authoritative rule for triggers, combined fourth-gate routing, packet/response requirements, advisory authority, cadence, and fallback. |
| `skills/orchestrate/SKILL.md` | A short operational pointer to the core rule, durable baseline/latest-decision record, and degraded reconciliation practice. |
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
| A current candidate reaches cumulative gate four while a material architecture pivot is also present. | Send one combined packet to the persistent architect; its fresh response binds candidate, panel close, lineage, and proposed action, and separately covers the process checkpoint and program alignment. |
| A broad question looks convenient to answer inside a normal current-chip review. | Use the internal consult unless an explicit persistent trigger applies; then route one combined packet to the persistent architect and do not mint a duplicate call. |
| The persistent architect is unavailable at the first safe checkpoint after five active workdays. | Use one fresh internal frontier consult as acting architect with honest model/effort and no inherited-context claim; later reconcile by memo, PM disposition, and outcomes. |
| A consult recommends changing scope, tier, live behavior, or publication. | Treat it as advisory; stop at the relevant Owner boundary rather than executing or treating the response as a verdict. |
| A degraded adopter has no cross-session message transport. | Preserve the common packet and disposition in the durable record/file brief; do not imply a scheduler or automatic handoff. |
| A repair round attempts to count a persistent response and an active consult as two frontier firings. | Use one combined response where overlap is present; do not spend or duplicate discretionary frontier budget, add a batch, or grant authority. |

## Stop rules for implementation

Stop and return to the Owner before implementation if the proposed text requires a new model binding,
transport mechanism, scheduler/controller, a second review seat, a change to the existing frontier budget,
or a program-specific authority decision. Stop if core and skill wording cannot be made one-home-per-rule,
or if any gate finding shows an implementer could use the text to bypass a required review or Owner
boundary. This brief itself authorizes neither implementation nor publication.
