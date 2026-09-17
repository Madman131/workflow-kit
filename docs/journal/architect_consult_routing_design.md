# Architect project-principal routing — T2 design contract

**Status:** design contract; implementation is under final review. The original pre-code base, receipt,
and source-packet provenance below remain historical evidence; that receipt did not review code. This
supersedes the earlier advisory-architect proposal.
**Source packet:** `/private/tmp/workflow-kit-architect-consult-policy/`, SHA-256 verified on
2026-09-16. The packet informs this design; it is not adopted wording.
**Candidate base:** `b091afce029a025b6df6d14198f6acb438e060a9`.

## Rung Zero — classification, intent, and proof

The Owner requested this as a **T2 core-document/gate-policy** change. It changes text agents will
follow when selecting a consult, including a gate checkpoint, so it is FULL T2 under
`core/WORKFLOW.md` § Steer, “Core-document amendments are never T0.” That clause requires a panel,
wording approval under recorded authority, and an adversarial walk-through for gate machinery. The same
section requires the T2 pre-code contract lens before code exists; this brief is that contract, and its
receipt covers the contract rather than implementation.

**Intent:** establish one persistent **Architect / Project Principal** as the Owner's delegated general
contractor. It holds the approved blueprint/endpoints/acceptance evidence, drives the project through
completion, directs a separate `/orchestrate` PM, and makes bounded nonreserved program decisions. The PM
remains the sole execution and worker-command chain; the Builder retains protected source authoring. The
Principal is not a second PM, scheduler, or implementation lane.

**Done:** the implementation under final review makes the destination decision unambiguous, establishes a clean
architect-to-PM handoff, and preserves the existing fourth-gate and frontier-budget rules. It keeps
architectural continuity in a durable record, lets routine CHIP progress proceed without contacting either
Principal or Owner, and routes nonroutine program decisions to the Principal. It supports an
approved-baseline recovery when the Principal task is missing; valid directives remain usable and no acting
Principal or second PM is minted. Program-specific task names and model bindings stay outside kit doctrine.

**Proof required before the implementation is accepted:**

1. Core-document T2 rungs enumerated by citation from `core/WORKFLOW.md` § Steer and § Gate;
   pre-code cross-family contract lens, cold panel, cross-family lens where available, wording approval
   under recorded authority, and the required adversarial walk-through all have receipts.
2. Static checks and focused tests prove that the one-home rule is represented once, the companion
   skill and both harness shims install and resolve, pointers do not contradict the core rule, no
   second discretionary frontier firing is introduced, and no text implies transport, automation, or
   authority that does not exist.
3. A reviewer can trace each routing example below to its required fresh response or responses and confirm that
   advice alone authorizes neither execution nor a tier change; a recorded Principal directive may authorize
   ordinary in-envelope execution, tier, or wording through the PM, while Owner-reserved actions stay reserved.
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
2. **Persistent Architect / Project Principal** is the durable program-level task and record for questions
   that outgrow the chip. It is the Owner's delegated general contractor: within the accepted baseline it
   directs the PM, settles ordinary program judgment, issues bounded directives/permits, and carries the
   blueprint through completion. It is not a scheduler, second PM, or source-authoring lane; the separate
   PM remains the single execution command chain.

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

A Principal response states its directive or decision, supporting evidence, tradeoffs, unresolved risks,
Rule #1/KISS/root-cause assessment, program fit, smallest next action, stop condition, and any
Owner-reserved decision. The PM records execution/disposition, reason, outcome, and next evidence. A
valid Principal directive binds the PM inside its stated envelope; ordinary reviews and consults remain
advisory evidence only.

### Continuity, establishment, and recovery

The durable record names the Owner delegation source; program/repository and outcome boundaries;
architect and active-PM locator, or file-only equivalents; approved baseline/source pointers; applicable
access/egress and budget limits; active directives separately from pending/superseded advice; current phase/CHIP;
unresolved decisions; last alignment check; and reconciliation owed. Each material decision records its
id/date/type (`advice`, `architect-decision`, or `owner-required`), decision-maker/delegation reference,
program/baseline/scope, question, evidence, limits/stop condition, active/pending/superseded status, PM
execution status, and resulting evidence. A current directive remains usable only inside its recorded envelope;
ordinary commits do not stale it, and pending/superseded advice never becomes authority.
`/architect-build` inspects that record before creating a task. It establishes an
architect during planning, reuses an existing architect when its identity and approved baseline are
current, or reconstructs file-only continuity from the record and current evidence. Recovery never
promotes pending advice to an approved decision, creates a replacement or acting architect, or creates a
second PM chain. It holds only dependent decisions whose current authority cannot be established, while
independent authorized work continues. The PM records later dispositions/outcomes and reconciles them at
the next meaningful checkpoint.

### Authority, fallback, and portability

The Owner retains initial intent/outcomes/acceptance/baseline/launch; material intent, outcome, scope, or
budget changes; truly critical product decisions; credentials; destructive/irreversible acts; explicit risk
acceptance; exact push/deploy/publication and production/live/external-write GOs; and the terminal
exhausted-surface completion exception. The Principal is the Owner's project agent/general contractor: it
directs and completes all ordinary in-scope completion work through the PM. Local source edits, tests,
repairs, reviews, authorized packets, commits, and eligible local integration illustrate that authority;
they are not an allowlist. It decides in-baseline tier, topology, model/seat, gate-routing, ordinary
successor/worker-continuation, sequencing, and bounded private external-gate transmission. The PM
automatically performs routine reversible baseline work and executes valid Principal directives, but holds
only the conflicting/uncovered dependency.

No generic permit/controller subsystem is added. The only demonstrated controller mismatch is a review-seat
substitution that accepts only `owner_evidence`. `seat.substitution.architect_evidence` is its narrow,
mutually exclusive alternative: it requires `authority_record`, `decision_id`, literal
`scope:"review-seat-substitution"`, and exact `seat_id`, `replaced_family`, `actual_family`,
`decorrelation_level`, `provider`, and `model` bindings. It is documentary provenance, not authenticated
identity or Owner evidence. It is valid only for an eligible external/cross-family substitute that preserves the
required family floor: the free and `angle:*` Builder-family seats never accept architect evidence, and it
rejects `same-family-only` and an all-one-family roster. Planned and observed provider/model tuples bind at
close for this Principal-only path. Legacy
Owner evidence remains compatible with the existing expressly Owner-authorized reduction. Existing role,
family, effort, scope, packet, decorrelation, and budget checks remain. Terminal child/close,
`owner_decision`, gate waiver, Owner extension, release, deployment, publication, and live writes never
read architect evidence.

If the Principal is unavailable, do not mint an acting architect. Continue independent authorized work and
execute still-valid recorded decisions; hold only the dependent action whose authority is unresolved. An existing defined consult
is evidence, neither replacement Principal nor discharge of continuity; an existing gate keeps its own
obligation. A rejected execution/admission method holds its affected action and goes with exact evidence to
Principal for supported-method diagnosis. A valid ordinary retry proceeds under existing authority; neither role
may use an equivalent workaround, fabricate a receipt, or override a platform restriction. If reconciliation
finds a conflict, preserve/verify state and hold the affected dependency; restore only under existing authority,
continue independent covered work, and send an unresolved reserved exception once through Principal to Owner.
If an active consult is unavailable when a gate requires it, existing fail-closed gate rules apply.

Controller admission is necessary recorded-shape evidence, not proof that every configured tier obligation was
met. PM and Principal verify actual required roles/families and independent eligibility against WORKFLOW/REVIEW/GATES.
A T2 Builder-family plus eligible cross-family reviewer can satisfy both the recorded shape and its configured
obligations. A T3 roster with only Builder family plus one other actual family may satisfy a two-family controller
predicate yet is not a full T3 gate when its configured lens or external family is absent. Only applicable Owner
evidence permits a recorded reduction; it is never relabeled full.

Cross-session messaging is optional harness plumbing. In a portable or degraded environment, the durable
record, file brief, and consult entry are the record of continuity. The policy must not claim an automated
handoff, controller, scheduler, or service that Workflow-Kit does not ship.

## Planned amendment surface

| Planned file | Purpose |
| --- | --- |
| `core/WORKFLOW.md` | Compact authoritative anchor: the installed companion reference owns detailed routing; PM stays the execution chain. |
| `skills/architect-build/ROUTING.md` | Installed reference layer for triggers, packet currency, fourth-gate eligibility, delegated authority, cadence, and fallback. |
| `skills/orchestrate/SKILL.md` | A short operational pointer to the core rule, durable baseline/latest-decision record, and degraded reconciliation practice. |
| `skills/architect-build/SKILL.md` | Establish, reuse, or recover the persistent architect; maintain the durable record; produce the approved-baseline handoff to a separate PM; point to the core routing rule. |
| `skill-shims/claude/architect-build.md` and `skill-shims/codex/architect-build.md` | Discover the one canonical companion-skill body in each harness. |
| Existing repository adoption mechanism and focused tests | Discover and install the companion body, reference layer, and both harness shims through `bin/init.mjs`; no user-global architecture sync surface is added. |

**Explicit cuts from the source proposal:**

- `core/GATES.md` receives only any required compact pointer; it remains the runner/budget authority.
- `skills/frontier-review/SKILL.md` is cut unless its existing wording cannot point to the authoritative
  rule without contradicting it. The active-consult budget remains there; detailed destination policy
  belongs in the installed `/architect-build` reference layer.
- `templates/BINDINGS.md.tmpl`, `agents/frontier-consult.md`, and any model-specific binding are cut.
  The policy requires no new portable role field, and exact model identity is adopter data.
- No program task name, including the NexusBot architect task, belongs in Workflow-Kit core. Program
  binding and operating records remain with the adopting program.
- No scheduler, daemon, transport, generic permission service, or new review seat is planned. Existing
  review and disposition mechanics remain authoritative except the narrow substitution receipt.

## Adversarial walkthrough cases

| Case | Required result |
| --- | --- |
| A current candidate reaches cumulative gate four while a material architecture pivot is also present. | Combine only if the persistent architect independently meets every existing process-review eligibility and freshness rule; otherwise preserve the fresh process review and consult architecture separately. |
| A broad question looks convenient to answer inside a normal current-chip review. | Use the internal consult; below-trigger questions do not contact the persistent architect unless an existing gate owes its own seat. |
| Routine CHIP progress is recorded with no material trigger or meaningful milestone. | Update the durable record without contacting the architect. |
| The persistent architect is unavailable at the first safe checkpoint after five active workdays. | Continue independent authorized work, hold only the dependent decision, and reconcile the record and outcome with the persistent architect when available; do not create a replacement architect. |
| A Principal decides an in-envelope implementation direction or eligible substitution. | PM records `acknowledged/executing/completed` and executes through normal gates; it returns any concrete safeguard conflict rather than silently declining. |
| Architect evidence is missing, has forged scope, or binds the wrong seat, model, family, or provider. | Refuse the substitution; provenance must match the exact planned replacement. |
| Architect-only evidence would make the roster `same-family-only` or all one family. | Refuse it; preserving the independent family floor is not delegated risk acceptance. |
| A terminal child, `owner_decision`, waiver, release, or live action carries architect evidence. | Refuse it; those paths continue to require their existing Owner evidence/GO. |
| A legacy eligible substitution carries valid `owner_evidence`. | Preserve its existing compatibility, including the explicitly Owner-authorized reduction. |
| A Principal proposes an outcome/scope/risk, live behavior, or publication change. | Stop at the Owner boundary; Principal authority does not cross it. |
| An execution/admission method is rejected. | Hold that action and give Principal exact evidence; diagnose a supported method, use a valid ordinary retry under existing authority, and raise only an unresolved reserved exception once through Principal to Owner. |
| A T3 roster has Builder family plus only one other actual family. | Treat controller two-family acceptance as shape evidence only; it is not a full T3 gate if a configured lens or external family is missing. |
| A degraded adopter has no cross-session message transport. | Preserve the common packet and disposition in the durable record/file brief; do not imply a scheduler or automatic handoff. |
| A repair round attempts to count a persistent response and an active consult as two frontier firings. | Use one combined response where overlap is present; do not spend or duplicate discretionary frontier budget, add a batch, or grant authority. |
| A restart finds a stale architect locator or an unresolved recommendation. | Inspect the durable record and current evidence before creating/reusing a seat; preserve one PM chain, keep the recommendation pending, and hold only dependent authority until reconciliation. |

## Stop rules for implementation

Stop and return to the Owner before implementation if the proposed text requires a new model binding,
transport mechanism, scheduler/controller beyond the demonstrated substitution receipt, a second review
seat, or a change to the existing frontier budget. Stop if core and skill wording cannot be made one-home-per-rule,
or if any gate finding shows an implementer could use the text to bypass a required review or Owner
boundary. This record itself grants no publication GO: advice alone grants no execution or tier authority;
a recorded Principal directive may authorize ordinary in-envelope execution, tier, or wording through the
PM, while Owner-reserved actions remain reserved.
