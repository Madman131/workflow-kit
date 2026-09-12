# Cost-conscious execution and bounded completion contract

Date: 2026-09-12. T2 design for the approved Workflow-Kit amendment. This file is the
pre-code review artifact, not evidence that implementation or review is complete.

## Outcome and scope

The Owner can approve a plan and let a workhorse PM complete ordinary local build work without
repeated permission requests or a continuously active frontier build conversation. A terminal
review can allow one explicitly approved small finish without restarting the repair ladder.

Amend existing core method, generated bindings and entry templates, affected orchestration and
closeout skills, the existing repair controller, its tests, and the adopter handoff documents.
No new policy engine, ledger, scheduler, provider integration, or runtime-model migration.
No changes to other repositories, provider accounts, credentials, live systems or deployment.

## Model roles and continuity

- The Owner plans with a frontier planning model and approves intent, scope, risk/tier and
  falsifiable acceptance evidence before implementation.
- A consistent workhorse PM owns the active implementation conversation, decisions on findings,
  worker briefs, review administration, allowed repairs, local integration and reporting.
- A designated code Builder writes code, tests and repairs. Raw T2/T3/live-path source and decisive
  facts remain available in that Builder's own context; this is retention, not exclusive access.
  The PM has direct read-only access to the shared source, diffs and decisive evidence and inspects
  them independently; a worker summary alone cannot discharge that responsibility.
- Gathering workers locate, extract and organize evidence and do well-specified bulk work. They
  do not silently become architectural deciders, product-code repair authors or cheaper gate seats.
- Frontier consultations are bounded to critical decisions, design ambiguity, root-cause/course
  correction and mandatory process checkpoints. They do not turn the frontier into a standing PM.
- For the approved Codex profile, the requested labels are Astra planning/consultation, Sol PM,
  Terra code Builder and Luna gathering. Portable doctrine describes responsibilities; each adopter's
  dated bindings record actual model IDs, effort, access and invocation. Explicitly select and
  verify the active model at handoff and worker dispatch. Names alone are not evidence; missing
  access must be reported, never silently substituted. Preserve review history across handoffs.

Existing gate floors and independence requirements remain. Token economy reduces unnecessary
context and repairs, not required review depth. Required planning/process consultations remain
outside the discretionary frontier-review cap; discretionary use does not become unlimited.

## Routine authority and Owner boundaries

Within approved scope, existing access and budget, the PM may inspect, dispatch workers, run tests,
make local commits and eligible local integrations, prepare Gemini slices/packets, send in-scope
review artifacts through authorized Gemini/Claude routes, adjudicate findings and dispatch allowed
repair batches. One approval covers its ordinary dependent steps; do not re-ask unchanged authority.
Review packets exclude secrets, live data and unrelated material.

The PM may draft and link follow-up tickets. That does not authorize implementing new scope or
reopening a terminal parent. Local integration is not remote PR merge, push, deploy, activation or
live write. A casual request to finish is not fresh publication authorization.

The Owner retains initial plan/risk approval, critical design/intent or risk changes, material
scope/budget decisions, new credentials, destructive or irreversible acts, fresh push/deploy GO,
required named live-write/activation GO, and unresolved terminal/recursive-gating choices. Platform
permissions, hook trust and sign-ins remain genuine human steps; repo prose cannot bypass them.

## Finite controller and one completion exception

Ordinary aggregate rounds remain finite: Round 1 permits one bounded repair batch; repeated
mechanisms and harm-bearing Round 2 require a shared-cause correction; Round 3 tests it; a fresh
frontier process review precedes work leading into the terminal Round 4 bookend. Early GO is
allowed; three rounds are not compulsory. A round collects a full panel on one frozen candidate,
not one reviewer, Gemini slice, test or transport attempt. Parent Round 4 has no outgoing repair.

After terminal Round 4 STOP, a genuinely small remaining defect may justify a bounded completion
exception. A fresh frontier zoom-out and PM recommendation must identify surviving concrete harm,
the smallest correction, fixed scope/paths and explicit completion evidence. The Owner approves
that exact bounded proposal once. The PM then handles routine implementation and review steps.

Use the existing parent-linked child-continuation mechanism with an explicit completion-exception
subtype. The parent remains closed. The exception retains the parent's evidence and cumulative
gate history; checkpoints at each cumulative multiple of four remain mandatory. It cannot lower
the parent's tier or omit required reviewers. The child gets exactly one repair batch followed by
the required final review, not a new four-round allowance. Its internal event sequence must reflect
this limit without inventing review receipts or counting a bootstrap event as a completed review.

If the exception fails, needs a second batch or expands scope, stop. No automatic repeated
exception, child of an exception, cycle reset or relabeling as ordinary continuation may turn this
same finishing authorization into another repair allowance. The previously supported route for
genuinely new, separately Owner-approved successor scope remains; a PM cannot self-classify the
same unfinished repair as new scope to bypass the limit. Controls validate records and mechanical
bounds, not the truth of semantic declarations or the identity behind human approval evidence.

## Falsifiable acceptance evidence

1. An approved local build reaches ordinary tests, permitted review transmission and eligible local
   integration without a new Owner ask. Changing intent, budget, credentials or remote/live effects
   produces the specific Owner boundary instead. Finishing does not imply push permission.
2. A code Builder can own T2 work while retaining raw source in its own context. A gathering worker
   cannot satisfy the code Builder or mandatory reviewer role by a cheaper-model substitution.
3. A worker with a friendly role name but a different actual model is reported as a mismatch.
   Planning-to-implementation handoff explicitly verifies the active model and retains gate history.
4. Missing Owner evidence, missing fresh frontier review, wrong parent/anchor, changed proposal,
   missing completion proof, a nonterminal/non-R4-STOP parent, or a lowered child tier refuses the
   completion exception before work authority. Existing supported ordinary successors still work.
5. A valid exception permits its single scoped repair batch and required final full review while
   the original parent remains terminal. The original defect trigger is rerun. No accepted blocker
   yields GO; surviving protected harm yields STOP, never a false pass.
6. A second repair batch, expanded paths, extra ordinary round, refreeze-as-new-budget, repeat child,
   or descendant repair using the exhausted exception is refused. Restart/replay and sibling
   worktrees preserve the limit; tests distinguish a refused event from an admitted transition.
7. Cumulative history remains correct; an exception whose next ordinal is divisible by four still
   requires the checkpoint. For example, an ordinary descendant starting with inherited ordinal 3
   reaches cumulative ordinal 7 at its local Round 4; its exception's real final review is ordinal 8.
   Starting a child or authorizing a repair does not itself count as a review. Individual review
   seats and failed transmissions do not add rounds.
8. Test the intended block and allow paths using existing controller APIs and an installed-adopter
   layout where relevant. Run focused tests, skill budgets, full source checks and acceptance tests.
   Do not weaken unrelated historical controller behavior or claim user-installed hooks are armed
   merely because source files changed.
9. Sweep affected method, bindings and skill claims for contradictory frontier-PM, authoring,
   merge/push authority or repair-budget instructions. Review a concrete compliant-yet-failing
   scenario against the amended gate mechanics. Human-facing documents describe the same behavior
   without a wholesale rewrite or loss of the Owner's formatting.

## Bootstrap exception already approved

The ordinary Gemini design runner failed before provider invocation because its lock-record
writer ended in a false conditional status. The Owner explicitly approved the narrow neutral-return
shell correction and regression test before resuming the normal design gate. This authorizes no
other review bypass, provider substitution or reduction in review depth. Failed attempts are not
verdicts. Broader controller implementation follows the required pre-code contract review.
