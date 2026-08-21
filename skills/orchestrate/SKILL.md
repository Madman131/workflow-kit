---
name: orchestrate
description: Run a program too large for one thread as sequential CHIPS — one orchestrator, one worker per changeset, an Owner who holds intent and the merge-GO. Use when work spans many separately gated changesets, or when asked how to split and sequence a program across sessions.
---

# /orchestrate — one writer, one ladder, one GO

Word budget: 1400 (**Owner-ratified 2026-08-11**; body only — the three siblings each carry their own number. **Raising it again is an Owner call.**)
Doctrine:
`core/MULTI_AGENT.md` § Delegation · § Multi-writer checkout · § Task-lane declaration ·
`core/WORKFLOW.md` § Gate · `core/REVIEW.md` § Decorrelation · `core/OWNER_COMMS.md` (Owner-facing
formatting).

## When
For a multi-thread program whose parts need separate gates. One chip = one changeset = one version,
in stated order; each verifies its predecessor landed. Never use two chips to write one repo at once.

## The three roles
| Role | Owns | Never |
|---|---|---|
| **Owner** | spawning chips, and the decisions § Routing reserves | asked to run the method |
| **Orchestrator** | briefs, rulings, fold-checks, merge diligence, the lesson bank | gives a merge-GO |
| **Worker** | its own gate ladder, its PR, its post-merge verification | merges without the Owner's GO |

**The GO is the Owner's alone**, and may arrive DIRECTLY to a worker — a direct Owner instruction
outranks any routing preference; the worker acts and tells the orchestrator promptly. **A GO
ratifies a specific artifact:** if the changeset gains a commit the GO is void until re-confirmed on
the new head. Pin heads by **SHA**, never by branch name — a chip's branch can fork mid-life.

### Routing — the Owner is not a queue
**The Owner's set is whatever YOUR REPO reserves to them — read it there. These five are the ones
this method always needs, and they are EXAMPLES, not the closure:** the **merge/push GO** · **intent or risk acceptance** · the **tier
ratification** (`core/WORKFLOW.md` § Steer — *"Builder proposes the tier; Owner ratifies before any
T2/T3 gate"*) · the **wording sign-off on a core-document amendment** (§ Core-document amendments,
which also stands as its push-GO) · and the **named WRITE-GO for each prod write**, which a push-GO
never covers — *"the push-GO authorizes the deploy only… the two are never merged"* (`core/WORKFLOW.md` § Shipping). **A chip sends even these five to the
ORCHESTRATOR, who takes them to the Owner and relays the answer.** **Unsure which bucket? Route it to the orchestrator AND wait for an answer**
— an unsure consult never times out, because the timeout assumes you knew whose question it was.
*An incomplete reserved list routes to the human by default; keyed to a timeout it routes AWAY from them — which is why the property binds, not the count.*

**Three rules:**
1. **Every label rule 8 defines is OWNER-FACING — `QUESTION:`, `RECOMMENDATION:`, `DECISION NEEDED:`
   (`core/OWNER_COMMS.md` rule 8, and take the list from THERE, not from here) — never
   chip→orchestrator.** The Owner watches the chip's terminal and reads a labelled lead as theirs;
   note a consult carries a recommendation, so that label is the easy one to fire by accident. Use
   **`CONSULT:`** or **`RULING NEEDED:`**.
2. **Never end a turn on a consult.** Send it, name **what you are doing while you wait**, and do it.
3. **State the addressee in visible output** — one line.

**Everything else consults the orchestrator first**; it keeps working while it waits.

## Standing duties
- Near merge readiness, ask the Owner to delegate named-chip push/merge authority. It is SHA-pinned,
  conditioned on orchestrator diligence, void when head moves, and remains an exception.
- Surface landed/stale worktrees and branches; ask before removal. Use the merge-type proof and
  occupancy refusal in `.agents/skills/orchestrate/PROTOCOLS.md`.

## One writer per repo
Before writing, a chip looks for competing writers in the repo's own **lane declarations** —
`.claude/task-lane.json` in the main checkout AND in every worktree — never a list of sessions,
which reports liveness, not intent. An open PR is a live writer too. **This finds DECLARED writers
only**, so it is a check, not a proof: an undeclared lane is invisible to it. Unsure ⇒ fail closed,
into a private worktree.

## The chip cycle
0. **RUNG ZERO — six checks before any gate** (`.agents/skills/orchestrate/RUNG_ZERO.md`): the tier
   is **SET IN THE BRIEF, never derived by the chip** · **one changeset, one tier — split before
   gating, into separately-gated COMMITS by default and separate CHIPS only by a named exception**
   (§ 0.2) · a control needing a JUDGMENT is a declaration or a sensor, never a predicate · the
   target repo's mandated rungs enumerated BY CITATION · the packet dry-run and the neighbourhood
   sweep. **Use T1: it is the honest tier for most instruction work.**
1. **Startup gate** — the sole-writer check, the version confirmed against the repo's real head,
   the DECLARED tier verified against the artifact, scope acknowledged back.
2. **Budget-free rungs first.** Every deterministic check runs and is fixed BEFORE any seat is
   spawned. A clean free pass never lightens the panel.
3. **FREEZE, then seat.** Each seat verifies the frozen SHA itself; editing while seats are live is
   its own NO-GO. Freeze compliance is checked by the panel, never promised by the author. **A
   receipt proves a reply COMPLETED, not that it judged** — demand a verdict and its inspected scope.
4. **Decorrelate on four axes** — family, charter, ENVIRONMENT, installed LAYOUT. Cold seats
   default to the workhorse tier at standard effort; **evidence escalates them, appetite does not.**
5. **One frontier firing per changeset**; default consumer is the orchestrator's remediation-delta
   fold-check (`/frontier-review`). Ledger every round by changeset. Rounds run in cycles of at most
   three harm-bearing rounds (the CIRCULAR cadence); at each soft stop, one root assessment + one
   bounded remediation, whose NO-GO bookend is the next cycle's round 1. Enter root assessment
   earlier on two consecutive same-class Rule-1 harms or a repair-introduced harm. After two
   completed cycles, a process audit on the exact bytes gates continuation — its GO buys one more
   two-cycle window, its NO-GO or window exhaustion returns to the Owner. The absolute count never
   resets. **Conditional on its COMPANIONS** (`core/WORKFLOW.md` § Gate): **both
   lenses on every scope/disposition/root call, zoomed-out CONTROLS; KISS; RULE #1 screens first**
   (`core/FOUNDATIONS.md`; cite document+section, never bare "rule 1"). Round events:
   `scripts/record-repair-event.mjs`. After writing a repair brief, confirm its actual bytes
   (`confirm-repair-brief.mjs --confirm`); worker `--verify` first. The write guard
   rechecks session, candidate, bytes and paths. Status sends carry no repair authority; shell
   writes escape this guard.
6. **PR, then independent diligence.** The orchestrator re-runs the evidence on the final head, not
   the summary.
7. **GO ask → merge → verify on merged main BY EXECUTION** → **fast-forward the primary clone ONLY
   if it is clean, on the target branch, and the update is a pure fast-forward — otherwise REPORT and
   let the Owner decide** → report residue.

*What every brief must carry: `.agents/skills/orchestrate/CHIP_BRIEF.md`. The incident behind each
rule above: `.agents/skills/orchestrate/PROTOCOLS.md` — read it before writing a brief.*

## Honest limits
**The METHOD is portable; the PLUMBING is not.** Clickable chips and cross-session messaging are
harness features this kit does not ship and must not assume.

**Degraded mode — files and a shared record:** the program record becomes one append-only file both
sides write; a brief is a file handed to a fresh session; a consult is an entry answered in it. The
ROLE SPLIT survives intact; what degrades is LATENCY. **Integrity of the shared file is yours to provide** — two writers appending owe the staging
discipline of any shared checkout.

⚠ **One rung on this page is enforced WHEN ITS HOOK IS ARMED; the rest is honour-system. That rung
is TRUST-GATED: upgrading a hook marks it CHANGED and DISARMS it until re-approved, and an untrusted
hook is skipped SILENTLY — so an upgrade turns it off until you approve it again.** The controller reads
typed author-recorded rounds; no hook infers them, reads a freeze, or checks who gave a GO — except
`guard-brief-rung`, which denies a brief WRITE lacking a fresh, session- and
target-bound, SINGLE-USE record of executed checks — proving such a RECORD EXISTS, never that its
commands were run or were the right ones. The kit ships controls for the declaration and the commit
floor, and their lane, trust, fresh-clone and bypass limits are in `PORTABILITY.md` — and a rung you
did not name is a rung you did not run.
