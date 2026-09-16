---
name: architect-build
description: Establish or recover a persistent architect for a multi-CHIP program, preserve its approved baseline, and hand execution to a separate orchestrator.
---

# /architect-build — persistent architecture, separate execution

Word budget: 550. Doctrine: `core/WORKFLOW.md` § Architectural consult routing and § Gate;
`core/FOUNDATIONS.md` Roles; `.agents/skills/architect-build/ROUTING.md`; `.agents/skills/orchestrate/SKILL.md`.

Use for a substantial program needing one continuing architectural view while a separate PM runs CHIPS.
With recorded Owner delegation, the Architect is Project Principal: it owns continuity, design fit and
completion, and its in-envelope decisions bind `/orchestrate`; PM retains execution, workers and reviews.

Only an Owner launch instruction may activate a `/orchestrate` PM or emit an execution handoff. If the
harness supports task creation, establish/reuse the architect first and, after baseline approval,
create/connect the separate PM; record both locators. In file-only mode, a launch emits that handoff using
file-only equivalents. Without launch, preserve planning continuity only. Existing authorized execution
does not need a renewed launch. Never duplicate an established architect or PM.

## Establish, reuse, or recover

First locate the repository's existing architecture/current-state record. If none can carry the required
fields, create one using the repository's normal docs/state convention and record its exact path. It names
the program/repository, architect and active-PM locator (or file-only equivalents), approved
baseline/source pointers, Owner delegation/limits, accepted decisions distinct from pending advice, current
phase/CHIP, unresolved decisions, last alignment check, and reconciliation owed.

- **Establish:** use the planning task as architect when practical. Record the intended outcomes,
  acceptance evidence, boundaries, interfaces, constraints, accepted decisions and reasons, rejected
  alternatives that still matter, and unresolved decisions. Obtain the applicable approval for that
  baseline before handing it to a separate `/orchestrate` PM.
- **Reuse:** retain an identified architect only when its baseline is current. Reconcile any pending
  recommendations before treating them as decisions.
- **Recover:** inspect record/evidence; preserve context through file-only continuity. Never create an
  acting architect or second PM, or promote advice. Continue covered work and hold only the dependent decision.

The handoff gives PM baseline, record/location, Principal locator, delegation/limits, phase/CHIP, open
decisions, and next milestone. It does not authorize new scope, push, deployment, or live write.

## Keep continuity without spending a consult

The PM records routine CHIP progress, dispositions, outcomes, and evidence in the durable record without
contacting the architect. Consult only at program inception/baseline, terminal STOP, a material pivot,
foundation/ownership/authority or major sequencing change, a meaningful milestone or planned phase
boundary, or a due five-active-workday alignment review. Every persistent packet carries, or explicitly
consults in that record, the approved baseline, latest accepted decisions, and last alignment check. The
reference layer has the exact material test, ordinary-consult boundary, combined fourth-gate rule, and
degraded fallback; those rules have one authoritative home.

A packet identifies question, scope, evidence, alternatives, risks, and reserved boundary. Record advice
as adopt/adapt/decline; a delegated decision as acknowledged/executing/completed or concrete blocked
conflict. Do not create polling, scheduler, transport, review seat, or model binding.
