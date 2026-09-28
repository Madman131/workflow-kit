# Owner-only terminal reauthorization — design contract

**Status:** T2 design after the accepted pre-code lens. This is a prospective v5 controller transition. It is not Owner evidence, a dispatch, a gate result, a publication grant, or a retrofit of recorded v2–v4 history.

## Intent and compatibility hold

A completed `completion_exception` child that reaches its only final bookend with `STOP` remains terminal. The exceptional route permits one further, Owner-only, exact-surface correction after that state. It reuses the existing completion-batch worker verification and final-panel machinery; it changes no ordinary continuation, replay, STOP reservation, or default authorization.

The append-only `aggregate_v2` v5 `child_continuation` has `continuation_kind: "terminal_reauthorization"`. A v5 reader replays v2–v4 records unchanged; a v4 reader rejects v5. Therefore only an explicit terminal-reauthorization proposal and its child lineage mint v5; ordinary work continues to mint v4. Before any real first v5 append, adopters follow the existing `bin/init.mjs` mixed-controller findings and `PORTABILITY.md` coordinated-upgrade procedure, refresh long-lived readers, and record that v4 rollback on the same ledger is unsupported. Those scans are procedural evidence, not a mechanical fleet certification. This changes no adopter and grants no activation. A synthetic frozen-v4-reader fixture proves refusal safely.

## Admission record and mechanical invariants

The new event is legal only when its direct parent is a v4 T2 `completion_exception` child whose only panel is a `final_bookend` and whose terminal disposition is `STOP`. Parent terminality remains intact: existing child-continuation traversal already treats terminal parents as anchors.

The event binds, hash-included and shape-validated before state mutation:

- `authority_route: "owner"`, nonempty direct `owner_evidence`, and a nonempty `owner_decision_id`. Principal evidence or missing evidence/id refuses. Unused v5 reviews remain immutable evidence for their exact proposal; only the first eligible admitted terminal-reauthorization child spends the original-root and Owner-decision one-use constraint. The controller records supplied evidence; it cannot authenticate the human source.
- The direct stopped completion-child continuation id, its terminal STOP disposition id, and the controller-derived frozen commit/tree from its final bookend.
- A sorted exact `surviving_finding_ids` set equal to both the parent STOP `finding_dispositions.accepted` set and `action_screen.surviving_finding_ids`; in this controller accepted findings are the unresolved blockers. A sorted exact `opened_paths` set equals the stopped child union of opened paths. The corrective child authorized paths equal it: no omitted survivor, added path, renamed surface, or path release.
- A frozen correction-batch brief (path, SHA-256, size), named worker session, and matching authorized paths, using the existing completion-batch confirmation/worker receipt flow.
- A prior frozen `process_review` with an `owner_decision` ruling. Its proposed-transition projection hashes the owner decision id, parent identity and stopped disposition/head/tree, exact paths, survivor set/action screen, brief metadata, worker session, and proposed child task/changeset identity. It hashes child identity fields, not the future continuation event hash; the review event can exist before the continuation cites it.

The stopped completion child has current ordinal **N**. Its reauthorization child takes **N** as base, and its single final-bookend panel is next ordinal **N+1**; the review binds **N+1**. After the named worker verifies the frozen brief, exactly one local correction batch and one full panel may occur. Its final disposition is GO or STOP. Admission itself releases no path. A final GO retains the controller's existing coverage-scoped direct-child lift: only paths in that child's authorized budget which its panels actually opened and reviewed are lifted from that direct parent's STOP reservation. STOP, unreviewed or unrelated paths, ancestor and independent reservations, and later descendants retain their existing behavior; no recursive lift, parent reopen, reset, dispatch, sibling, ordinary descendant, completion exception, terminal reauthorization, or publication authority follows.

State derivation retains the append-only first-wins model. Per original root, only the first eligible terminal-reauthorization event wins; same-event retry is idempotent. A simultaneous two-decision synthetic fixture must accept one winner and refuse the loser. No database, lock service, or parallel authority is introduced.

## Acceptance matrix

Synthetic ledger fixtures—not production or imported history—will prove:

1. The exact Owner-bound STOPPED-completion case admits, verifies its worker, performs one correction batch and one full final panel at N+1.
2. Admission refuses absent, Principal-only, or malformed Owner authority; a hash-valid v4 or unbound v5 review; an older matching hold; racing/repeated root-lineage or Owner-decision use after child admission; wrong child/disposition/head/tree; altered survivor/action-screen set; expanded/altered paths; changed brief bytes; wrong worker; or an unbound/non-`owner_decision` process review. A corrected unused proposal may obtain a fresh exact v5 Owner review, but an old review never authorizes it.
3. Final freeze blocks writes, refreezes, dispatches, further panels, siblings, generic descendants, completion exceptions, terminal reauthorizations, resets, and publication effects.
4. Existing v2–v4 replay fixtures retain their inputs and outcomes. Existing completion-child STOPs and unrelated stopped paths remain denied. A frozen v4 reader refuses a v5 row; before any real v5 mint, adoption follows the existing `bin/init.mjs` mixed-controller scan and `PORTABILITY.md` coordinated-upgrade procedure. That is a procedural hold, not a new compatibility record, flag, callback, or fleet-certification control.

Mutation checks remove each new eligibility arm or binding comparison and require its corresponding refusal to fail. The harness uses temporary repositories, committed fixture candidates, and generated local briefs only.

## Threat and mitigation boundary

This reduces cooperative-but-fallible controller errors: stale anchors, partial finding carry, scope laundering, duplicate recovery, changed briefs, worker substitution, final-freeze bypass, and unsafe mixed-reader minting. It cannot prove that free-text evidence was supplied by the Owner, that a reviewer made a sound judgment, or that shell writes honored the guard. No live write, remote push, deployment, ledger import, hook activation, or adopter change is part of this changeset.
