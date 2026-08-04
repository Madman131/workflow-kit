---
name: orchestrate
description: Run a program too large for one thread as sequential CHIPS — one orchestrator, one worker per changeset, an Owner who holds intent and the merge-GO. Use when work spans many separately gated changesets, or when asked how to split and sequence a program across sessions.
---

# /orchestrate — one writer, one ladder, one GO

Word budget: 750 (body; `CHIP_BRIEF.md` and `PROTOCOLS.md` beside it, each with its own number).
Doctrine: `core/MULTI_AGENT.md` § Delegation · § Multi-writer checkout ·
§ Task-lane declaration · `core/WORKFLOW.md` § Gate · `core/REVIEW.md` § Decorrelation.
Owner-facing formatting: `core/OWNER_COMMS.md`.

## When
A program too large for one thread whose parts each deserve their own gate. Split it into **chips**:
one chip = one changeset = one version, in its own session. Chips run in a stated ORDER; each
verifies the previous chip's version actually landed before starting.

Never for: work one thread can gate — a chip has real overhead — or two chips writing one repo at
once (§ One writer per repo).

## The three roles
| Role | Owns | Never |
|---|---|---|
| **Owner** | intent, risk acceptance, spawning chips, the merge/push **GO** | asked to run the method |
| **Orchestrator** | briefs, rulings, fold-checks, merge diligence, the lesson bank | gives a merge-GO |
| **Worker** | its own gate ladder, its PR, its post-merge verification | merges without the Owner's GO |

**The GO is the Owner's alone**, and it may arrive DIRECTLY to a worker — a direct Owner
instruction outranks any routing preference; the worker acts on it and tells the orchestrator
promptly. **A GO ratifies a specific artifact:** if the changeset gains a commit afterwards the GO
is void until re-confirmed on the new head. Pin heads by **SHA**, never by branch name — a chip's
branch can fork mid-life.

**Everything else consults the orchestrator first**; the worker keeps working while it waits.
Nothing but intent, risk and the GO reaches the Owner.

## One writer per repo
Before a chip writes, it proves it is the sole writer by reading the repo's own **lane
declarations** — `.claude/task-lane.json` in the main checkout AND in every worktree — never a list
of sessions, which reports liveness, not intent. An open PR is a live writer too.

## The chip cycle
1. **Startup gate** — sole-writer proof, the version confirmed against the repo's real head, scope
   acknowledged back to the orchestrator.
2. **Budget-free rungs first.** Every deterministic check runs and is fixed BEFORE a review seat is
   spawned. A clean free pass never lightens the panel.
3. **FREEZE, then seat.** Each seat verifies the frozen SHA itself; editing while seats are live is
   its own NO-GO. Freeze compliance is checked by the panel, never promised by the author.
4. **Decorrelate on four axes** — family, charter, ENVIRONMENT, and installed LAYOUT. Cold seats
   default to the workhorse tier at standard effort; evidence escalates them, appetite does not.
5. **One frontier firing per changeset**, and its default consumer is the orchestrator's
   **fold-check** on the remediation delta (`/frontier-review`). Repeated NO-GO rounds on ONE class
   escalate rather than repeat.
6. **PR, then independent diligence.** The orchestrator re-runs the evidence on the final head —
   not the worker's summary of it.
7. **GO ask → merge → verify on merged main BY EXECUTION** → fast-forward the primary clone →
   report residue: branches, worktrees, processes.

*The brief a chip is spawned with — and what every brief must carry —
`.agents/skills/orchestrate/CHIP_BRIEF.md`. The incidents each rule above was bought with, one line
each: `.agents/skills/orchestrate/PROTOCOLS.md`; read it before writing a brief.*

## Honest limits
**The METHOD is portable; the PLUMBING is not.** Clickable chips and cross-session messaging are
harness features this kit does not ship and must not assume.

**Degraded mode — files and a shared record, which loses nothing essential:** the program record
becomes one append-only file both sides write; a brief is a file handed to a fresh session; a
consult is an entry in it, answered there. What degrades is LATENCY, not the role split — and the
role split is what the method is.

⚠ **Nothing on this page is enforced.** No control counts rounds, reads a freeze, or checks who
gave a GO (`core/WORKFLOW.md` § Gate). The two things the kit does enforce are the task-lane
declaration and the commit floor; everything else here is honour-system, and a rung you did not
name is a rung you did not run.
