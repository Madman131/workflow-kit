# CHIP_BRIEF — what a worker is handed, and what it may not be left to infer

Word budget: 1000 (**Owner-ratified 2026-08-11**, raised from an author-set 600 when § 2 and § 7
gained the routing completion; its own number, never summed with the body's).

Reference layer for `.agents/skills/orchestrate/SKILL.md`. A brief goes to a session with **no
memory of the program**. Everything needed on its first turn is in the brief or referenced record.

## The nine sections
1. **Identity and order** — which chip this is, which chips must have landed first, and the
   VERSION this one ships. State the version as a rule ("bump the minor from the repo's real head"),
   not only as a number: a printed number goes stale the moment another chip lands, and a worker
   that trusts it ships a wrong stamp.
2. **The program record** — the one file holding the program's state and rulings. **NAME THE ENTRIES
   this chip needs; never say "read it whole."** **The binding lessons are not there anyway** — they live
   in `.agents/skills/orchestrate/PROTOCOLS.md` and `RUNG_ZERO.md`; the record is where they were
   DISCOVERED, not where they live.
3. **Startup gate** — the sole-writer CHECK, never called a proof (lane declarations, main checkout
   and every worktree; it finds writers who DECLARED, and the body states what it misses),
   and a startup confirmation back to the orchestrator naming the base SHA, the version, and the
   scope as the worker understood it. **An unacknowledged brief is unconfirmed, not undelivered** —
   messages cross and long turns delay them, so chase it rather than re-send blind or record a
   delivery failure that did not happen.
4. **Scope** — what ships, user-visible done, its proof, and what does NOT. Name artifacts.
5. **Process** — ordered rungs and pre-decided skips. **Every brief names the Builder's model and
   effort; every same-family seat runs at or above that model** (`core/REVIEW.md` peer tier), **reporting expected and observed
   model+effort and any mismatch rather than silently substituting.** Aggregate repair briefs declare
   `aggregate_controller:"aggregate_v2"`, task, changeset, the exact PM disposition and panel-close
   event IDs, next round, repeated-mechanism boolean, root-exit ID for a root-kind dispatch, and any required
   frontier process-review ID. **Review logs never ride in the changeset under review.** **A Builder the
   Owner cannot address (a subagent) never holds a GO:** the PM pushes on the Owner's relayed GO and SHA. Stored standard programs are
   replay/close-only and enter the aggregate ladder through `legacy_handoff`; never mint another
   standard round. The orchestrator confirms bytes (`confirm-repair-brief --confirm`), sending
   receipt/path. Ordinary workers include `session_id` in `--verify`; guard binds authorized
   paths. Completion-brief bytes bind at `child_continuation`, with no new `--confirm`: PM supplies
   event id; child worker uses it as `repair_dispatch_event_id` for `--verify` with child task/session.
6. **Standing rules** — binding every chip: surgical staging, the identity ritual,
   generalization rules, read-only sources.
7. **Consult protocol** — route questions to the orchestrator with stage, question, options with
   costs, and a recommendation. **Never end a turn on a consult:** name what you are doing while you
   wait, and state the addressee in visible output. **After ONE turn, a known ordinary PM-owned consult may proceed
   only on the worker's already-submitted recommendation: reversible local work within the current CHIP's approved
   paths and existing execution/review authority. Report it; a later PM ruling supersedes.**
   **⚠ The timeout requires that you KNOW the question was the orchestrator's. If you were UNSURE
   which bucket it fell in, the timeout does not apply — unsure is not a licence to proceed, it is
   the reason to wait.** Every other unsure in this method fails closed; this one does too.
   **It NEVER reaches a Principal-required ruling, Owner reservation, external/live/irreversible action, missing
   gate/admission, or stopped/revoked authority. The examples below are
   EXAMPLES, not a closed set** — a repo reserves what it reserves, and any list a portable file
   ships is short in every repo it is wrong about. **Short used to mean "ask the Owner"; keyed to a
   timeout it means "proceed without them", so the property is what binds, never the count.** A ratification that did not arrive did
   not happen: waiting on one, you keep building everything it does not touch and you seat nothing
   that depends on it.
   **For a delegated program, cite the Principal decision/record and its limits; it binds execution but
   never supplies Owner GO. Name target-repo Owner reservations, including merge/push GO, material intent
   or risk, live WRITE-GO, credentials, terminal exception and budget exceptions; all route THROUGH PM.**
   **Give the orchestrator-facing
   labels (`CONSULT:` / `RULING NEEDED:`). The generated `core/OWNER_COMMS.md` rule 8 is the sole
   source for Owner-facing labels and form; do not duplicate its list in this portable brief.
8. **Accumulated corrections** — the rulings and lessons this chip inherits, especially any that
   CONTRADICT what the brief said when it was first written. A superseded instruction left standing
   in a brief will be executed.
9. **The banked traps** — `.agents/skills/orchestrate/PROTOCOLS.md`, or the subset this chip can
   actually hit.

## Three failures worth designing against
- **A brief re-presented after a delay carries stale facts.** Version numbers, chip ids and "the
  next chip is X" all rot. Mark every volatile field as verify-on-arrival, and have the worker
  confirm them in its startup message rather than acting on them.
- **Verbatim is not safe by default.** A clause that is TRUE in the source repo can be FALSE in the
  target, because the doctrine around it differs. Check every ported claim against the TARGET's
  doctrine, not merely for leaked names. Likewise, when a claim's provenance receipt is stripped
  because it does not belong in the target, DOWNGRADE the claim with it — a stripped receipt
  silently converts a proven claim into an asserted one.
- **Adapt the remedy to the target's defect surface.** A source fix ported whole can carry machinery
  the target does not need; the target may already be immune for its own reasons. Port the half that
  applies, and pin the accidental immunity so a future change reddens it.
