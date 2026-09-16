---
name: architect-build
description: Establish or recover a persistent architect for a multi-CHIP program, preserve its approved baseline, and hand execution to a separate orchestrator.
---

# /architect-build — persistent architecture, separate execution

Word budget: 550. Doctrine: `core/WORKFLOW.md` § Architectural consult routing and § Gate;
`core/FOUNDATIONS.md` Roles; `.agents/skills/orchestrate/SKILL.md`.

Use for a substantial program that needs one continuing architectural view while a separate PM runs
CHIPS. The architect advises on program fit; `/orchestrate` owns worker dispatch, implementation,
reviews, tests, integration, and all execution authority already granted by the method.

## Establish, reuse, or recover

First inspect the durable record. It names the program/repository, architect and active-PM locator (or
file-only equivalents), approved baseline/source pointers, accepted decisions distinct from pending
recommendations, current phase/CHIP, unresolved decisions, last alignment check, and reconciliation owed.

- **Establish:** use the planning task as architect when practical. Record the intended outcomes,
  acceptance evidence, boundaries, interfaces, constraints, accepted decisions and reasons, rejected
  alternatives that still matter, and unresolved decisions. Obtain the applicable approval for that
  baseline before handing it to a separate `/orchestrate` PM.
- **Reuse:** retain an identified architect only when its baseline is current. Reconcile any pending
  recommendations before treating them as decisions.
- **Recover:** inspect the record and current evidence before creating a replacement. Reconstruct from
  the approved baseline and accepted decisions; identify missing rationale honestly. Never create a
  second PM chain, promote advice to approval, or block independent authorized work. Hold only a
  decision whose current authority cannot be established.

The handoff gives the PM the approved baseline, durable-record location, architect locator or file-only
equivalent, current phase/CHIP, open decisions, and the next intended milestone. It does not authorize a
new scope, tier, push, deployment, or live write.

## Keep continuity without spending a consult

The PM records routine CHIP progress, dispositions, outcomes, and evidence in the durable record without
contacting the architect. Consult only at program inception/baseline, terminal STOP, a material pivot,
foundation/ownership/authority or major sequencing change, a meaningful milestone or planned phase
boundary, or a due five-active-workday alignment review. Read `core/WORKFLOW.md` for the exact material
test, packet, combined fourth-gate rule, and degraded fallback; those rules have one authoritative home.

A consult is advisory. Its packet identifies the question, scope, evidence, alternatives, risks, and
either an Owner-reserved decision or `none — PM disposition within existing authority`. The PM records
adopt/adapt/decline with reason, outcome, and next evidence. Do not create polling, a scheduler, an
automatic handoff, a new transport, a new review seat, or a program-specific model binding.
