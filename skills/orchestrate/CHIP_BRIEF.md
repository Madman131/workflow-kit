# CHIP_BRIEF — what a worker is handed, and what it may not be left to infer

Word budget: 1000 (**Owner-ratified 2026-08-11**, raised from an author-set 600 when § 2 and § 7
gained the routing completion; its own number, never summed with the body's).

Reference layer for `.agents/skills/orchestrate/SKILL.md`. A brief is written by the orchestrator
and read by a session with **no memory of the program**. Everything the worker needs to act
correctly on its first turn is in the brief or in the shared program record it points at.

## The nine sections
1. **Identity and order** — which chip this is, which chips must have landed first, and the
   VERSION this one ships. State the version as a rule ("bump the minor from the repo's real head"),
   not only as a number: a printed number goes stale the moment another chip lands, and a worker
   that trusts it ships a wrong stamp.
2. **The program record** — the one file holding the program's state and rulings. **NAME THE ENTRIES
   this chip needs; never say "read it whole."** A record grows until reading it whole is most of a
   context window spent on closed history. **The binding lessons are not there anyway** — they live
   in `.agents/skills/orchestrate/PROTOCOLS.md` and `RUNG_ZERO.md`; the record is where they were
   DISCOVERED, not where they live. A brief that says "read it whole" has not decided what its chip
   needs.
3. **Startup gate** — the sole-writer CHECK, never called a proof (lane declarations, main checkout
   and every worktree; it finds writers who DECLARED, and the body states what it misses),
   and a startup confirmation back to the orchestrator naming the base SHA, the version, and the
   scope as the worker understood it. **An unacknowledged brief is unconfirmed, not undelivered** —
   messages cross and long turns delay them, so chase it rather than re-send blind or record a
   delivery failure that did not happen.
4. **Scope** — what ships, and explicitly what does NOT. Name the artifacts.
5. **Process** — the rungs in order (§ The chip cycle in the body), and which of them this chip's
   gate may skip, decided in advance rather than at the moment the worker is tired.
6. **Standing rules** — the ones binding every chip: surgical staging, the identity ritual,
   generalization rules (no Owner name, no model names, no absolute paths), read-only sources.
7. **Consult protocol** — route questions to the orchestrator with stage, question, options with
   costs, and a recommendation. **Never end a turn on a consult:** name what you are doing while you
   wait, and state the addressee in visible output. **A consult older than ONE of your turns is
   already answered** — proceed on your own recommendation and say so; a queued ruling supersedes.
   **⚠ The timeout requires that you KNOW the question was the orchestrator's. If you were UNSURE
   which bucket it fell in, the timeout does not apply — unsure is not a licence to proceed, it is
   the reason to wait.** Every other unsure in this method fails closed; this one does too.
   **And it NEVER reaches a decision the TARGET REPO reserves to the Owner. The five below are
   EXAMPLES, not a closed set** — a repo reserves what it reserves, and any list a portable file
   ships is short in every repo it is wrong about. **Short used to mean "ask the Owner"; keyed to a
   timeout it means "proceed without them", so the property is what binds, never the count.** A ratification that did not arrive did
   not happen: waiting on one, you keep building everything it does not touch and you seat nothing
   that depends on it. Timing out an Owner rung is self-authorisation wearing initiative's clothes,
   and the gate it skips is the one whose whole reason is that the call is not yours.
   **Name what the TARGET REPO reserves, and give these five as EXAMPLES, not a closure — merge/push
   GO · intent or risk acceptance · tier ratification · core-doc wording sign-off · and the named
   WRITE-GO for each prod write, which a push-GO never covers — and say that even those route THROUGH
   the orchestrator, who relays**; the write-GO is the one whose omission routes a live production
   write. **Give the orchestrator-facing
   labels (`CONSULT:` / `RULING NEEDED:`) and forbid EVERY Owner-facing label rule 8 defines — `QUESTION:` · `RECOMMENDATION:` ·
   `DECISION NEEDED:`, and take that list from rule 8 rather than from here**, which the Owner reads as theirs off the chip's terminal. Do not restate the list
   by pointer alone: a chip reads its brief and may never load the body.
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
