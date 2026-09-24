---
name: orchestrate
description: Run a program as sequential CHIPS with an active workhorse PM, designated Builder, and Owner-held reserved decisions. Use when work spans separately gated changesets or needs sequencing across sessions.
---

# /orchestrate — one writer, one ladder, one GO

Word budget: 1400 (**Owner-ratified 2026-08-11**; body only — the three siblings each carry their own number. **Raising it again is an Owner call.**)
Doctrine:
`core/MULTI_AGENT.md` § Delegation · § Multi-writer checkout · § Task-lane declaration ·
`core/WORKFLOW.md` § Gate · `core/REVIEW.md` § Decorrelation · `core/OWNER_COMMS.md` (Owner-facing
formatting).

## When
For a multi-thread program with gates. One chip = one changeset = one version,
ordered; each verifies its predecessor landed. Never let two chips write one repo.

## The roles
| Role | Owns | Never |
|---|---|---|
| **Owner** | approved plan and the decisions § Routing reserves | asked to run the method |
| **Principal** | delegated program direction, continuity and closeout | worker dispatch, protected source, remote GO |
| **Workhorse PM** | worker/chip dispatch, briefs, rulings, fold-checks, local integration, lesson bank | authors designated Builder source or gives remote GO |
| **Builder** | its raw T2 and historical T3 source, tests, repairs and gate evidence | merges/pushes without fresh Owner GO |

**A remote GO is the Owner's alone**, and may arrive DIRECTLY to a Builder — a direct Owner instruction
outranks any routing preference; the Builder acts and tells the PM promptly. **A GO
ratifies a specific artifact:** if the changeset gains a commit the GO is void until re-confirmed on
the new head. Pin heads by **SHA**, never by branch name — a chip's branch can fork mid-life.

### Routing — the Owner is not a queue
Within approved plan, access and budget, PM may dispatch ordinary workers/reviews, approve Gemini
slices and in-scope transmission, disposition findings/repairs, test, make local commits/integration
and draft tickets. PM may inspect/integrate Builder bytes; never author designated T2 or historical T3 source. One
approval captures routine authority; a ticket never authorizes implementation or relabels repair scope.

For a delegated program, Principal decides nonreserved in-envelope questions; directives bind PM and reviews remain
evidence. PM proceeds on covered work and returns safeguards, never silently declines. A rejected method is held with
exact evidence for Principal-supported-method diagnosis; a valid ordinary retry proceeds, otherwise an unresolved reserved
exception reaches Owner once through Principal. Owner alone decides critical product intent/risk, material scope/budget,
credentials/access change, money/new-spend, destructive/irreversible acts, named live-write GO, remote push/deploy GO,
terminal exception except bounded T2 Principal completion, gate waiver, max/ultra, second frontier firing and cap increase. A chip routes
those calls through PM using `CONSULT:` or `RULING NEEDED:`; the
Owner-facing labels and form are governed solely by `core/OWNER_COMMS.md` rule 8, not mirrored here.
An unsure consult never times out, waiting rather than becoming authority. **Never end a turn on a
consult or a wait:** send it, name what you do meanwhile, and do it. Review availability follows
`core/REVIEW.md` § External gate; it does not change authority.

## Standing duties
- Before PM local integration in a primary clone: clean, on the target branch, pure fast-forward; otherwise
  Principal selects reconciliation or Owner decision.
- Surface stale worktrees, use `.agents/skills/orchestrate/PROTOCOLS.md`, and route persistent-architect
  work through `core/WORKFLOW.md` § Architectural consult routing. Keep routine CHIP progress in its
  durable record; consult only at listed triggers. Principal's Quad Mandate directs completion; PM is the single execution chain.

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
   sweep. Define user-visible done and its proof. **Use T1: it is the honest tier for most instruction work.**
1. **Startup gate** — the sole-writer check, the version confirmed against the repo's real head,
   the DECLARED tier verified against the artifact, scope acknowledged back.
2. **Budget-free rungs first.** Every deterministic check runs and is fixed BEFORE any seat is
   spawned. A clean free pass never lightens the panel.
3. **FREEZE, then seat.** Each seat verifies the frozen SHA itself; editing while seats are live is
   its own NO-GO. Freeze compliance is checked by the panel, never promised by the author. **A
   receipt proves a reply COMPLETED, not that it judged** — demand a verdict and its inspected scope.
4. **Decorrelate on four axes** — family, charter, ENVIRONMENT, installed LAYOUT. Cold seats
   default to the workhorse tier at standard effort; **evidence escalates them, appetite does not.**
5. **One discretionary frontier firing per changeset**; default is the PM's fold-check
   (`/frontier-review`). Required planning/process consults are outside it, never review loops.
   Precommit, collect, disposition one panel.
   Verdicts are evidence, never repair authority: require concrete supported-use harm; route green
   non-blockers to parent-linked successors. R1 permits one bounded batch unless the mechanism
   repeated; harm-bearing R2 and repeated R1 require one root kind plus a root exit with closure
   proof. R3 tests that consolidated correction. Dispatch into R4 requires a fresh frontier process
   review: finish once, successor after terminal close, or Owner decision with no dispatch. Owner terminal children use fixed
   authorized scope; bounded T2 Principal children use opened-only scope. This controller-record ceiling never narrows the
Principal's broader delegated program authority; never current-chip dispatch. Every fourth gate repeats it without granting a round.
   R4 is the final GO/STOP bookend; no R5. One R4 STOP exception child fixes Owner-authorized or Principal-opened-only paths/proof: one verified batch then one full final
   review; parent terminal and inherited checkpoints remain. Its failed/STOP surface stays closed: final STOP, second batch,
scope growth, reset/relabel/repeat STOP; genuinely new Owner-approved work begins separately only on disjoint surfaces. The controller binds typed
   `owner_decision`/`successor` review and exact continuation proposal; runtime model/effort is
   procedure, not controller-authenticated identity.
   **Conditional on its COMPANIONS** (`core/WORKFLOW.md` § Gate): both
   lenses; zoom-out controls disagreement; KISS; carve-outs before RULE #1. Round events:
   `scripts/record-repair-event.mjs`. After writing a repair brief, confirm its actual bytes
   (`confirm-repair-brief.mjs --confirm`); worker `--verify` first. The write guard
   rechecks session, candidate, bytes and paths.
6. **PM diligence.** Re-run evidence on the final head, not the summary; remote stages await fresh GO.

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
is TRUST-GATED: an untrusted hook is skipped SILENTLY, and Codex keys trust to the `hooks.json`
entry, not the script — a changed entry is NOT ARMED until re-approved; after any upgrade, run
`check-codex-hooks-armed.mjs`.** The controller reads
typed author-recorded rounds, `panel_open` DOES read its freeze, and for a RECORDED program the
armed hook walls the cadence (terminal states, batch caps, path ownership). No control checks who
gave a GO. `guard-brief-rung` denies a brief WRITE lacking a fresh, session- and
target-bound, SINGLE-USE record of executed checks — proving such a RECORD EXISTS, never that its
commands were run or were the right ones. The kit ships controls for the declaration and the commit
floor, and their lane, trust, fresh-clone and bypass limits are in workflow-kit's `PORTABILITY.md` — and a rung you
did not name is a rung you did not run.
