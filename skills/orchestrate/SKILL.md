---
name: orchestrate
description: Run a program too large for one thread as sequential CHIPS — one orchestrator, one worker per changeset, an Owner who holds intent and the merge-GO. Use when work spans many separately gated changesets, or when asked how to split and sequence a program across sessions.
---

# /orchestrate — one writer, one ladder, one GO

Word budget: 750 (body; `CHIP_BRIEF.md` and `PROTOCOLS.md` beside it). Doctrine:
`core/MULTI_AGENT.md` § Delegation · § Multi-writer checkout · § Task-lane declaration ·
`core/WORKFLOW.md` § Gate · `core/REVIEW.md` § Decorrelation · `core/OWNER_COMMS.md` (Owner-facing
formatting).

## When
A program too large for one thread, whose parts each deserve their own gate. Split it into
**chips**: one chip = one changeset = one version, in its own session, in a stated ORDER. Each
verifies the previous chip's version landed first.

Never for: work one thread can gate, or two chips writing one repo at once (§ One writer per repo).

## The three roles
| Role | Owns | Never |
|---|---|---|
| **Owner** | intent, risk acceptance, spawning chips, the merge/push **GO** | asked to run the method |
| **Orchestrator** | briefs, rulings, fold-checks, merge diligence, the lesson bank | gives a merge-GO |
| **Worker** | its own gate ladder, its PR, its post-merge verification | merges without the Owner's GO |

**The GO is the Owner's alone**, and may arrive DIRECTLY to a worker — a direct Owner instruction
outranks any routing preference; the worker acts and tells the orchestrator promptly. **A GO
ratifies a specific artifact:** if the changeset gains a commit the GO is void until re-confirmed on
the new head. Pin heads by **SHA**, never by branch name — a chip's branch can fork mid-life.

**Everything else consults the orchestrator first**; it keeps working while it waits.

## One writer per repo
Before writing, a chip looks for competing writers in the repo's own **lane declarations** —
`.claude/task-lane.json` in the main checkout AND in every worktree — never a list of sessions,
which reports liveness, not intent. An open PR is a live writer too. **This finds DECLARED writers
only**, so it is a check, not a proof: an undeclared lane is invisible to it. Unsure ⇒ fail closed,
into a private worktree.

## The chip cycle
1. **Startup gate** — the sole-writer check, the version confirmed against the repo's real head,
   scope acknowledged back.
2. **Budget-free rungs first.** Every deterministic check runs and is fixed BEFORE any seat is
   spawned. A clean free pass never lightens the panel.
3. **FREEZE, then seat.** Each seat verifies the frozen SHA itself; editing while seats are live is
   its own NO-GO. Freeze compliance is checked by the panel, never promised by the author. **A
   receipt proves a reply COMPLETED, not that it judged** — demand a verdict and its inspected scope.
4. **Decorrelate on four axes** — family, charter, ENVIRONMENT, installed LAYOUT. Cold seats
   default to the workhorse tier at standard effort; **evidence escalates them, appetite does not.**
5. **One frontier firing per changeset**; default consumer is the orchestrator's **fold-check** on
   the remediation delta (`/frontier-review`). Repeated NO-GO rounds on ONE class escalate, not
   repeat.
6. **PR, then independent diligence.** The orchestrator re-runs the evidence on the final head, not
   the summary.
7. **GO ask → merge → verify on merged main BY EXECUTION** → fast-forward the primary clone → report
   residue.

*What every brief must carry: `.agents/skills/orchestrate/CHIP_BRIEF.md`. The incident behind each
rule above: `.agents/skills/orchestrate/PROTOCOLS.md` — read it before writing a brief.*

## Honest limits
**The METHOD is portable; the PLUMBING is not.** Clickable chips and cross-session messaging are
harness features this kit does not ship and must not assume.

**Degraded mode — files and a shared record:** the program record becomes one append-only file both
sides write; a brief is a file handed to a fresh session; a consult is an entry answered in it. The
ROLE SPLIT survives intact; what degrades is LATENCY. **Integrity of the shared file is yours to provide** — two writers appending owe the staging
discipline of any shared checkout.

⚠ **One rung on this page is enforced; the rest is honour-system.** No control counts rounds,
reads a freeze, or checks who gave a GO (`core/WORKFLOW.md` § Gate) — the exception is
`guard-brief-rung`, which denies a brief write or cross-session send lacking a fresh, session- and
target-bound, SINGLE-USE record of executed checks — proving such a RECORD EXISTS, never that its
commands were run or were the right ones. The kit ships controls for the declaration and the commit
floor, and their lane, trust, fresh-clone and bypass limits are in `PORTABILITY.md` — and a rung you
did not name is a rung you did not run.
