# Gate-loop prevention — design and decision receipt

## Status and decision source

This is the pre-code T2 design and acceptance contract for the external
`2026-09-05-orchestrate-gate-loop-prevention-ticket.md`. The Sol orchestrator reduced the current
workflow-kit behavior and source layout to a decision packet. Astra reviewed that packet and ruled
for one aggregate-v2 policy upgrade, with portable doctrine naming the **frontier role** rather than
a provider model.

The existing terminal controller remains the only live controller. Stored standard history and
aggregate rows minted before this policy continue to replay under their original rules.

## User-visible outcome and proof

An orchestrator can finish a bounded feature once its stated acceptance evidence is green, while
real repeated harm is consolidated before another branch repair and useful non-blocking work is
recorded as a successor. Proof is an executed controller walk showing:

1. two different symptoms declared to share a mechanism cannot authorize another bounded branch
   repair after the second harm-bearing round;
2. the consolidated root exit names the exact evidence that closes the correction;
3. work leading into local Round 4 has a fresh frontier process review tied to the latest completed
   panel and frozen candidate;
4. a process-review ruling of `finish_bounded_root` authorizes the one bounded finish before the
   terminal Round 4 bookend; `successor` and `owner_decision` authorize no current-chip dispatch,
   but after terminal close an Owner-evidenced child continuation may cite either ruling;
5. descendants inherit the cumulative gate ordinal, refreezes do not increment it, and ordinals
   4, 8, 12, and so on require a fresh process review without granting an extra round; and
6. old aggregate and standard fixtures still replay unchanged.

## Event contract

New aggregate-v2 events carry the current live policy version. Once a program or its lineage has
adopted that version, a lower or absent version cannot take control of a later transition. A newly
minted child inherits at least its parent's policy and cumulative completed-gate count.

A new-policy disposition declares `same_mechanism_repeated` as a boolean. Accepted harm in Round 2
must choose `root_replacement`, `simplification`, or `split`; Round 1 must do the same when that
declaration is true. Every root-kind dispatch retains the existing exact root-exit requirement. A
new-policy root exit also records `closure_evidence`, the exact proof that ends the correction.

A new `process_review` event records:

- the portable `frontier` reviewer role;
- the latest completed panel, its frozen commit and tree, and the derived next gate ordinal;
- review evidence and a zoomed-out proportionality judgment;
- one ruling: `finish_bounded_root`, `successor`, or `owner_decision`;
- the bounded scope and closing evidence.

The controller derives the ordinal; callers cannot choose it. The review is fresh only for its exact
panel and frozen candidate.

## Transition rules

Round 3 to Round 4 always requires the matching process review. `finish_bounded_root` permits that
single dispatch; Round 4 remains a mandatory terminal GO/STOP bookend with no outgoing dispatch.
`successor` stops the current repair path and records future work only after the current program is
terminal. `owner_decision` grants no current-chip dispatch and leaves the decision at the existing
Owner boundary; after terminal close, the Owner-evidenced child continuation may cite it.

Independently of local round number, any work-authorizing transition whose next cumulative gate
ordinal is divisible by four requires a matching fresh process review. A child continuation is such
a transition when its first gate reaches that boundary. This periodic check grants no arbitrary
continuation: it cannot create Round 5, reopen a terminal parent, bypass reservations, lower a child
tier, or replace Owner evidence.

## Doctrine boundary

The method states the smallest user-visible definition of done and closing evidence before work,
screens every finding for concrete reachable harm, and sends green non-blocking improvements to a
parent-linked successor. Design review, implementation review, deployment, activation, and live
proof are separate gates and rerun only when their own input materially changes. Instructions use
plain language for a technically literate reader.

Provider bindings remain generated per repository. For this decision Sol was the orchestrator,
Terra the implementation worker, and Astra the frontier process reviewer; portable sources retain
only those capability roles.

## Preserved boundaries

This change does not alter push, deploy, credential, live/private-data, destructive-action, material
scope, or budget authority. It does not install user copies, retrofit adopter repositories, create a
second controller, weaken adversarial review, or change terminal Round 4/no-R5 behavior.
