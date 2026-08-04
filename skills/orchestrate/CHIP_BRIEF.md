# CHIP_BRIEF — what a worker is handed, and what it may not be left to infer

Word budget: 600 (author-set for this new reference layer — no Owner ruling names a number for it;
its own number, never summed with its body).

Reference layer for `.agents/skills/orchestrate/SKILL.md`. A brief is written by the orchestrator
and read by a session with **no memory of the program**. Everything the worker needs to act
correctly on its first turn is in the brief or in the shared program record it points at.

## The nine sections
1. **Identity and order** — which chip this is, which chips must have landed first, and the
   VERSION this one ships. State the version as a rule ("bump the minor from the repo's real head"),
   not only as a number: a printed number goes stale the moment another chip lands, and a worker
   that trusts it ships a wrong stamp.
2. **The program record** — the one file holding the program's state and rulings, marked READ THIS
   FIRST AND WHOLE. It is the source material, not background reading.
3. **Startup gate** — the sole-writer proof (lane declarations, main checkout and every worktree),
   and a startup confirmation back to the orchestrator naming the base SHA, the version, and the
   scope as the worker understood it. **An unacknowledged brief is unconfirmed, not undelivered** —
   messages cross and long turns delay them, so chase it rather than re-send blind or record a
   delivery failure that did not happen.
4. **Scope** — what ships, and explicitly what does NOT. Name the artifacts.
5. **Process** — the rungs in order (§ The chip cycle in the body), and which of them this chip's
   gate may skip, decided in advance rather than at the moment the worker is tired.
6. **Standing rules** — the ones that bind every chip in the program: surgical staging, no
   blanket-staging, the identity ritual, generalization rules (no Owner name, no model names, no
   absolute paths) and the repo's own read-only sources.
7. **Consult protocol** — route questions to the orchestrator with stage, question, options with
   costs, and a recommendation; keep working while waiting. Name the exception that is the Owner's
   alone: the merge/push GO and risk acceptance.
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
- **Adapt the remedy to the target's defect surface.** A source fix ported whole can carry
  machinery the target does not need; the target may already be immune for its own reasons. Port
  the half that applies, and pin the accidental immunity with a characterization test so a future
  change reddens it.
