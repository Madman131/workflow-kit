---
name: architect-build
description: Establish/recover a persistent architect, preserve the approved baseline, and hand execution to a separate orchestrator.
---

# /architect-build — persistent Architect/Principal

Word budget: 550. Doctrine: `core/WORKFLOW.md` § Architectural consult routing and § Gate;
`core/FOUNDATIONS.md` Roles; `.agents/skills/architect-build/ROUTING.md`; `.agents/skills/orchestrate/SKILL.md`.

Use for multi-CHIP programs. With recorded Owner delegation, Architect is Project Principal, accountable for continuity, blueprint/design fit, current outcomes and acceptance evidence, and authorized completion through one separate PM. Its in-envelope decisions bind `/orchestrate`; PM owns execution, workers and reviews. Resolve ordinary conflicts; return only unresolved reserved decisions to Owner. Reuse evidence, batch independent work where useful, and avoid unrelated work or repeated attempts without new evidence. Efficiency never reduces required gates.

Only an Owner launch instruction may activate a `/orchestrate` PM or emit an execution handoff. If the
harness supports task creation, establish/reuse the architect first and, after baseline approval,
create/connect the separate PM; record both locators. In file-only mode, a launch emits that handoff using
file-only equivalents. Without launch, preserve planning continuity only. Existing authorized execution
does not need a renewed launch. Never duplicate an established architect or PM.

## Establish, reuse, or recover

Locate an architecture/current-state record supporting required fields. Otherwise create one
under repository docs/state conventions; record its exact path. Include
the program/repository, architect and active-PM locator (or file-only equivalents), approved
baseline/source pointers, Owner delegation/limits, decisions with id/type/source/scope/evidence/limits/status,
pending or superseded advice kept distinct, current phase/CHIP, unresolved decisions, last alignment check,
and reconciliation owed.

- **Establish:** use the planning task as architect when practical. Record the intended outcomes,
  acceptance evidence, boundaries, interfaces, constraints, accepted decisions and reasons, rejected
  alternatives that still matter, and unresolved decisions. Obtain the applicable approval for that
  baseline before handing it to a separate `/orchestrate` PM.
- **Reuse:** retain an identified architect only when its baseline is current. Reconcile any pending
  recommendations before treating them as decisions.
- **Recover:** inspect record/evidence; preserve context through file-only continuity. Never create an
  acting architect or second PM, or promote advice. Continue covered work and hold only the dependent decision;
  a current in-scope directive survives ordinary commits, while pending/superseded advice grants nothing.

The handoff gives PM baseline, record/location, Principal locator, delegation/limits, phase/CHIP, open
decisions, and next milestone. It does not authorize new scope, push, deployment, or live write.

## Quiet continuity

The PM records routine CHIP progress, dispositions, outcomes, and evidence in the durable record without
contacting the architect. Consult only at program inception/baseline, terminal STOP, a material pivot,
foundation/ownership/authority or major sequencing change, a meaningful milestone or planned phase
boundary, a due five-active-workday alignment review, or an unresolved in-envelope program decision or
concrete PM authority, safety, or evidence conflict requiring Principal direction. Every persistent packet carries, or explicitly
consults in that record, the approved baseline, latest accepted decisions, and last alignment check. The
reference layer has the exact material test, ordinary-consult boundary, combined fourth-gate rule, and
degraded fallback; those rules have one authoritative home.

A packet identifies question, scope, evidence, alternatives, risks, and reserved boundary. Record advice
as adopt/adapt/decline; a delegated decision as acknowledged/executing/completed/stopped with its result.
For a rejected execution method, hold the affected action and send exact evidence to Principal for supported-method
diagnosis; an ordinary valid retry proceeds under existing authority, while an unresolved reserved exception reaches
Owner once through Principal. Do not create polling, scheduler, transport, review seat, or model binding.
