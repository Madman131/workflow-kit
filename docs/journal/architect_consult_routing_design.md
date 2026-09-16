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

**Intent:** add one portable consult-routing policy with two destinations and a small
`/architect-build` companion skill. The skill establishes, reuses, or recovers the persistent
architect and hands an approved baseline to a separate `/orchestrate` PM. A compact core anchor points
to one installed skill reference layer rather than duplicating the routing rule. Neither artifact creates a second controller, scheduler,
review path, or implementation authority.

**Done:** a future implementation makes the destination decision unambiguous, establishes a clean
architect-to-PM handoff, and preserves the existing fourth-gate and frontier-budget rules. It keeps
architectural continuity in a durable record, lets routine CHIP progress update that record without
contacting the architect, and uses architect reasoning only at meaningful milestones or qualifying
architectural triggers. It supports an approved-baseline recovery when an architect task is missing;
the PM remains the sole execution command chain. Program-specific task names and model bindings stay
outside kit doctrine.

**Proof required before the implementation is accepted:**

1. Core-document T2 rungs enumerated by citation from `core/WORKFLOW.md` § Steer and § Gate;
   pre-code cross-family contract lens, cold panel, cross-family lens where available, Owner wording
   sign-off, and the required adversarial walk-through all have receipts.
2. Static checks and focused tests prove that the one-home rule is represented once, the companion
   skill and both harness shims install and resolve, pointers do not contradict the core rule, no
   second discretionary frontier firing is introduced, and no text implies transport, automation, or
   authority that does not exist.
3. A reviewer can trace each routing example below to its required fresh response or responses and confirm that neither
   destination authorizes implementation, a push, deployment, a live write, or a tier change.
4. A reviewer can trace establishment, reuse, and recovery to one durable record and confirm that a
   restart neither creates a duplicate architect/PM nor treats a pending recommendation as an approved
   decision.

No push, publication, merge, deployment, model invocation, or live-data action is authorized by this
brief. Any remote publication still needs a fresh Owner GO for the exact head and target.

## Proposed portable policy

### One policy, two destinations

`core/WORKFLOW.md` will retain the compact authority and command-chain rule; the installed
`skills/architect-build/ROUTING.md` reference layer will be the one detailed authority for routing.

1. **Internal active consult** is the default: a bounded, current-candidate consultation inside the
   approved chip. It has no durable work authority.
2. **Persistent architect** is a durable program-level task and record for questions that outgrow the
   chip. It preserves a recommendation and unresolved decisions for later Owner/PM consideration. It is
   advisory, not a scheduler, controller, or second implementation lane; the separate PM remains the
   single execution command chain.

Internal triggers are a current-chip design tradeoff, root-cause correction, required gate/process
checkpoint, disputed technical ruling, or another bounded question inside approved scope. Routine
debugging, gathering, and mechanical checks do not trigger Astra.

Persistent triggers are explicit: program inception or baseline; terminal STOP; a material pivot;
engine/provider/foundation selection or replacement; a cross-repo authority or ownership change; a major
sequencing amendment; a meaningful milestone or planned phase boundary before the next phase; and the
first safe checkpoint after five active workdays with project work since the last program-alignment
review. A change is material when it alters accepted outcomes, acceptance criteria, foundation,
ownership, dependency order, authority, or budget. A phase boundary is a planned capability or adoption
milestone, not each commit, round, or model switch. Routine CHIP progress updates the durable record and
does not contact the architect.

At a normal checkpoint, use the internal active consult. A bounded below-trigger question does not contact
the persistent architect unless an existing gate independently requires its own seat. At every cumulative
gate ordinal divisible by four, combine a persistent-trigger packet only when that architect independently
satisfies every existing process-review eligibility and freshness requirement. The combined response then
uses the existing process-review procedure unchanged: verified model/effort, purpose/outcome, receipt,
controller recording, current candidate, panel close, lineage, and proposed action remain required. If it
does not independently qualify, keep the fresh process review and route the architecture question
separately. Earlier advice never discharges a later checkpoint; no path adds a round, batch, authority, or
frontier firing.

### Cadence, packet, response, and disposition

At the first safe checkpoint after **five active workdays with project work** and no program-alignment
review, run the program-alignment review and record the last check; coalesce it with any owed qualifying
checkpoint. A material trigger may require it earlier. Quiet means no routine polling or status messages,
and no repeated review of the same unresolved decision; it does not suppress this explicitly due review.
The cadence creates no background monitor, timed task, message transport, or automatic decision.

Both destinations receive one common packet: question; scope; current frozen head/tree where applicable;
source citations; constraints; alternatives; assumptions; unresolved risks; and either the exact
Owner-reserved decision sought or `none — PM disposition within existing authority`. A gate-bound packet
additionally names current gate/round, candidate, panel close, lineage, and proposed action. A persistent
packet additionally carries the durable baseline, latest decisions, and the last program-alignment check.

A response must state a recommendation, supporting evidence, tradeoffs, unresolved risks, confidence or
insufficiency, Rule #1/KISS/root-cause assessment, program fit, the smallest next action, stop condition,
and the Owner-reserved decision when one exists. It must state the exact decision boundary it does not
cross. The PM records **adopt / adapt / decline**, with reason, outcome, and next evidence. Portable core
wording names the PM role, not a model. A response is advisory input, never an instruction or
implementation authorization.

### Continuity, establishment, and recovery

The durable record minimally names the program/repository identity; architect and active-PM locator, or
their file-only equivalents; approved baseline and source pointers; accepted decisions separately from
pending recommendations; current phase/CHIP; unresolved decisions; last alignment check; and any
reconciliation owed. `/architect-build` inspects that record before creating a task. It establishes an
architect during planning, reuses an existing architect when its identity and approved baseline are
current, or recovers a file-based architect from the record and current evidence. Recovery never promotes
pending advice to an approved decision or creates a second PM chain. It holds only dependent decisions
whose current authority cannot be established, while independent authorized work continues. The PM records
later dispositions/outcomes and reconciles them at the next meaningful checkpoint.

### Authority, fallback, and portability

The Owner retains intent and critical design decisions, material scope or budget, risk acceptance,
credentials, irreversible or live writes, tier changes where Owner ratification is required, pushes,
deployments, and unresolved terminal decisions. The PM retains only ordinary in-scope disposition and
local execution authority already granted by the method.

If the persistent architect is unavailable, do not mint an acting architect. Continue independent authorized
work and hold only the dependent decision. An existing defined consult can be advisory input but neither
replaces persistent continuity nor discharges it; an existing gate review keeps its own obligation. Later
reconcile the record, PM disposition, and outcomes with the persistent architect. If an active consult is
unavailable when a gate requires it, existing fail-closed gate and Owner-escalation rules apply.

Cross-session messaging is optional harness plumbing. In a portable or degraded environment, the durable
record, file brief, and consult entry are the record of continuity. The policy must not claim an automated
handoff, controller, scheduler, or service that Workflow-Kit does not ship.

## Planned amendment surface

| Planned file | Purpose |
| --- | --- |
| `core/WORKFLOW.md` | Compact authoritative anchor: the installed companion reference owns detailed routing; PM stays the execution chain. |
| `skills/architect-build/ROUTING.md` | Installed reference layer for triggers, packet currency, fourth-gate eligibility, advisory authority, cadence, and fallback. |
| `skills/orchestrate/SKILL.md` | A short operational pointer to the core rule, durable baseline/latest-decision record, and degraded reconciliation practice. |
| `skills/architect-build/SKILL.md` | Establish, reuse, or recover the persistent architect; maintain the durable record; produce the approved-baseline handoff to a separate PM; point to the core routing rule. |
| `skill-shims/claude/architect-build.md` and `skill-shims/codex/architect-build.md` | Discover the one canonical companion-skill body in each harness. |
| Existing user-skill sync surface, package scripts, and focused tests as proven necessary | Keep the new companion available beside `/orchestrate` without generic-renaming churn; pin one-home, lifecycle, installation, parity, and no duplicate budget/transport claims. |

**Explicit cuts from the source proposal:**

- `core/GATES.md` is cut unless implementation uncovers an actual ambiguity in budget accounting. The
  proposed rule changes routing semantics, not runner invocation or budget arithmetic; duplicating it in
  the tool manual would create two authorities.
- `skills/frontier-review/SKILL.md` is cut unless its existing wording cannot point to the authoritative
  rule without contradicting it. The active-consult budget remains there; detailed destination policy
  belongs in the installed `/architect-build` reference layer.
- `templates/BINDINGS.md.tmpl`, `agents/frontier-consult.md`, and any model-specific binding are cut.
  The policy requires no new portable role field, and exact model identity is adopter data.
- No program task name, including the NexusBot architect task, belongs in Workflow-Kit core. Program
  binding and operating records remain with the adopting program.
- No controller, scheduler, daemon, transport, or new review seat is planned. Existing review and
  disposition mechanics remain authoritative.

## Adversarial walkthrough cases

| Case | Required result |
| --- | --- |
| A current candidate reaches cumulative gate four while a material architecture pivot is also present. | Combine only if the persistent architect independently meets every existing process-review eligibility and freshness rule; otherwise preserve the fresh process review and consult architecture separately. |
| A broad question looks convenient to answer inside a normal current-chip review. | Use the internal consult; below-trigger questions do not contact the persistent architect unless an existing gate owes its own seat. |
| Routine CHIP progress is recorded with no material trigger or meaningful milestone. | Update the durable record without contacting the architect. |
| The persistent architect is unavailable at the first safe checkpoint after five active workdays. | Continue independent authorized work, hold only the dependent decision, and reconcile the record and outcome with the persistent architect when available; do not create a replacement architect. |
| A consult recommends changing scope, tier, live behavior, or publication. | Treat it as advisory; stop at the relevant Owner boundary rather than executing or treating the response as a verdict. |
| A degraded adopter has no cross-session message transport. | Preserve the common packet and disposition in the durable record/file brief; do not imply a scheduler or automatic handoff. |
| A repair round attempts to count a persistent response and an active consult as two frontier firings. | Use one combined response where overlap is present; do not spend or duplicate discretionary frontier budget, add a batch, or grant authority. |
| A restart finds a stale architect locator or an unresolved recommendation. | Inspect the durable record and current evidence before creating/reusing a seat; preserve one PM chain, keep the recommendation pending, and hold only dependent authority until reconciliation. |

## Stop rules for implementation

Stop and return to the Owner before implementation if the proposed text requires a new model binding,
transport mechanism, scheduler/controller, a second review seat, a change to the existing frontier budget,
or a program-specific authority decision. Stop if core and skill wording cannot be made one-home-per-rule,
or if any gate finding shows an implementer could use the text to bypass a required review or Owner
boundary. This brief itself authorizes neither implementation nor publication.
