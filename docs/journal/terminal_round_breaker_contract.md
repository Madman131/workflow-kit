# Terminal round breaker — formal contract and transition table

**CLASS: BINDING DESIGN · T3 (tier Owner-ratified).** Base
`956c62c4201cd9292704895c061545651b01b5eb`. Changeset `terminal-round-breaker`, ships
`2.15.0 → 2.16.0`. Gate-round narration lives in
`docs/journal/terminal_round_breaker_gate_record.md` and NEVER here — a spec narrating its own
review history folds every seat that reads it. Predecessor material (evidence, not authority):
the experimental aggregate-controller branch at `bdaf4332…`, adopted read-only and reworked under
this contract.

## 0 · Owner rulings of record

The batch model and the supersession of the circular cadence's CONTINUATION MECHANICS (the
process-audit two-cycle-window loop) were Owner-ratified 2026-08-22 — verbatim **"amend and
ratify"**, practice basis *"we have been running this in the llmpb and mrr repos.. it has been
working"* — recorded in the handoff ticket's § 7 and carried here so no repo holds two live
rulings that disagree. The cadence's surviving spirit — bounded harm-bearing work, terminal root
replacement, Owner-held continuation — lives in this model. Tier T3 was ratified in the same
ruling. **Still owed at the end of this changeset:** the Owner's core-document wording sign-off
(which stands as its push-GO) and the merge GO on the exact frozen SHA.

## 1 · Intent and boundary

Replace the circular cycle/window continuation model with one absolute terminal controller. One
gate round = one frozen candidate + the complete expected panel + all terminal receipts + one
aggregate PM disposition. A seat pass is never a round. Exactly one remediation batch may cite a
round; at most three batches per changeset; batch three — declarable EARLY on same-class or
repair-generated recurrence — is the terminal root replacement, simplification, or split, with a
recorded root exit. After the terminal batch: exactly one final aggregate bookend — GO closes,
any PM-accepted (blocking) harm records STOP, and neither state permits another dispatch. Owner
continuation is a typed, parent-linked successor changeset; it never resets or rewrites the
parent's lifetime count.

The controller proves candidate identity, panel completeness, durable PM partition, sequence,
batch consumption, and repair ownership. It never infers Rule #1, scope, severity, semantic
sameness, or PM judgment — those stay human declarations (`core/FOUNDATIONS.md` P2). The
records-not-deters residual (Owner-accepted) bounds every event's claim: session ids and Owner
evidence are caller-supplied strings, so no event asserts an authorization boundary the mechanism
does not provide — each guard below that compares session ids refuses the ADMITTED id, never the
actor behind it. Threat model: cooperative-but-fallible agents, not hostile evasion.

## 2 · Event grammar — one envelope, closed kinds

Every new event ships in the `type:"aggregate_v2"` envelope with a closed `kind`. The upgraded
reader filters the envelope out of the standard projection; **a pre-2.16.0 reader fails CLOSED on
the first aggregate row it meets — deliberately**: the safe direction for an old reader meeting a
grammar it cannot judge is denial, and the cure is upgrading (one `init --force` updates BOTH
lanes' hook copies in the same run, so a shared-ledger repo does not run mixed for longer than
its own upgrade). The three bare compatibility names (`panel_close`, `evidence_rerun`,
`child_continuation` as TYPES) stay replay-only forever; the aggregate `child_continuation` KIND
lives inside the `aggregate_v2` envelope and never collides with the bare type. No second ledger,
daemon, store, or parallel authority. Every event is JSON-normalized at the append boundary —
what is hashed is exactly what is written (an explicitly-undefined key must never live in the
hash and not in the bytes) — and a value JSON cannot carry refuses with a typed `-malformed`
state, never a throw. A retry differing only in its timestamp converges idempotently on the
standing winner.

Kinds (each totally shape-validated before ANY field dereference):

| kind | binds | authority it creates |
|---|---|---|
| `panel_open` | task · changeset · round (1–4) · phase · tier · frozen commit+tree · base ref + base commit · changed paths (derived from the immutable base..frozen pair) · complete expected seat roster {seat_id, role, family, pass_type, paths, substitution?} | reserves the round; first eligible open wins; membership authority. **Floors fixed for the DECLARED tier** (tier itself is declared and Owner-ratified upstream): free seat at full path coverage · ≥2 (T2) / ≥3 (T3) distinct angle roles, all `free` · one external · **≥2 distinct family values** (names are data; distinctness is the floor) |
| `panel_close` | its `panel_open` event id · received seat outcomes {id, role, family, pass_type, inspected_paths, reviewed commit+tree, verdict, finding ids, artifact receipt+sha256, packet_scope, pre_loaded} | the round's review receipt — received ≡ expected exactly, every changed path covered, and **finding ids globally unique across seats** (a collision refuses HERE, while the close is still recomposable). `pre_loaded` is a LOG (false · true · the seat's disclosure text), never a certification; seat outcomes are records, unauthenticated by construction |
| `disposition` | one unused `panel_close` of the current round · complete disjoint FOUR-bucket partition of every seat and PM finding id — **`accepted`** (BLOCKING: the bucket IS the declaration that a harm is changed-feature/contract-invariant class or Critical/fail-open) · **`followup`** (real, non-blocking, safely separable adjacent; each entry `{id, route}` with its routing text inline — embedded because a separate event citing the GO would be a content-hash cycle) · **`declined`** · **`note`** · terminal_state · remediation_kind · authorized paths ⊆ the open's changed paths | GO (zero accepted; followups routed) · CONTINUE (authorizes at most one batch) · STOP (declarable at ANY round) |
| `dispatch` | exactly one accepted CONTINUE disposition + its panel_close · next round · brief path+sha256+size · authorized paths · for a ROOT-KIND disposition (any round): the `root_exit` event id | the batch — one per disposition, ever |
| `root_exit` | the root-kind disposition · shared mechanism · why prior fixes were symptoms · owner/state/yield seams · one replacement · removed workarounds · trigger matrix | unlocks only that disposition's dispatch |
| `worker` | dispatch event id · session | admits ONE worker session; the handoff-admitted session's own `--verify` is idempotent |
| `worker_handoff` | Owner evidence · the immutable active dispatch · the prior worker's exact admission · new session | replaces the worker; revokes the old session in the same transition |
| `close` | Owner evidence · reason · the latest disposition — or, for a program with NO disposition, its winning `panel_open` | ABANDON: releases active authority; **eligibility = session ∉ every admitted worker session** (verifications and handoff replacements); after ≥1 disposition the close RESERVES the latest open's changed paths exactly as STOP does (close-then-relabel is not a fresh budget); a virgin close reserves nothing |
| `child_continuation` | parent task/changeset · parent's latest disposition id · the parent terminal candidate (frozen commit+tree, controller-derived) · continuation kind `split` \| `new_changeset` \| `material_scope` · children (split: 2–8 disjoint; else one), each {task, changeset, tier ≥ parent tier, budget, authorized-path SUPERSET the child's opens must stay inside} · trigger ids (STOP: the accepted set, order-insensitive; GO: routed follow-ups only; CLOSED: accepted ∪ follow-ups) · Owner evidence | lineage ONLY — no ownership, no verdict, no dispatch; the ONE successor mechanism; anchors only to a TERMINAL parent (GO, STOP, or CLOSED — a non-terminal or held state can never seed a child) |
| `legacy_handoff` | the CURRENT winning standard disposition/candidate/round · one declared child | atomically ends standard ownership, creates lineage; the recorder derives the citation itself (callers never mint trusted pointers); replay binds the latest ROUND row, so a post-handoff close of the emptied program cannot retroactively unmake the lineage |

Refusal states are the shipped ones: `aggregate-<kind>-conflict` for a transition the derivation
refuses, `aggregate-<kind>-malformed` for shape, plus the named diagnoses `aggregate-terminal`,
`aggregate-worker-required`, `aggregate-close-self-authorized`, `aggregate-root-exit-required`,
`aggregate-dispatch-unavailable`, `repair-worker-path-unauthorized`, and the recorder's
`repair-controller-version-skew`. Every one has remediation text in the write guard or recorder.

## 3 · Transition table

States per (task, changeset): `unopened` → `open(r)` → `closed(r)` → `disposed(r)` →
[`dispatched(r)` → `open(r+1)` …] → `TERMINAL-GO` | `TERMINAL-STOP` | `CLOSED`. Rounds are
absolute; a refreeze changes the candidate, never the round count.

| # | From | Event | Guard (all mechanical) | To |
|---|---|---|---|---|
| T1 | `unopened` | `panel_open` r=1 | identity globally unclaimed; no ACTIVE program of either grammar owns any declared path; no terminal reservation covers them (exception: the child's OWN lineage parent's reservation); evidence commit-addressed with the clean-candidate bracket before AND after capture | `open(1)` |
| T2 | `open(r)` | `panel_close` | cites the round's WINNING open (a superseded open can never close); received ≡ expected; cross-seat finding ids unique; recorder stands at the frozen candidate (tracked-clean; untracked files are packet discipline, not candidate identity), bracket re-checked after receipt assembly | `closed(r)` |
| T3 | `open(r)` | rig failure, candidate bytes UNCHANGED | a NON-EVENT by design: the panel has not closed; the failed seat attempt reruns (§ 5) | `open(r)` — consumes nothing |
| T3b | `open(r)` unclosed | `panel_open` r (REFREEZE) | AT MOST ONCE per round · NEVER at the final bookend (a contaminated bookend exits via close+successor) · roster and changed-path set PINNED to the superseded open · tier pinned · both overlap checks re-run · the superseded open can no longer close. No disposition was reached ⇒ nothing consumed; a refreeze never grants a batch or resets the count — and the bound is what keeps that sentence true | `open(r)` on the new candidate |
| T4 | `closed(r)` | `disposition` GO | four-bucket partition complete + disjoint; zero `accepted`; every followup routed inline | `TERMINAL-GO` (any round) |
| T5 | `closed(r)`, r<3 | `disposition` CONTINUE | accepted ids present; kind `bounded`, or a ROOT kind declared early on recurrence | `disposed(r)` |
| T6 | `closed(3)` | `disposition` CONTINUE | kind MUST be `root_replacement` \| `simplification` \| `split` | `disposed(3)` |
| T7 | `closed(r)` | `disposition` STOP | any round; accepted ids present; the PM's declaration of a Critical/fail-open or otherwise unforwardable blocking harm | `TERMINAL-STOP` |
| T8 | `disposed(r)` | `dispatch` | first eligible wins; cites THAT disposition; a root-kind disposition's dispatch requires its `root_exit` at ANY round; every accepted finding of the disposition rides this ONE batch | `dispatched(r)` |
| T9 | `dispatched(r)` | `worker` / `worker_handoff` | one admitted session; Owner-evidenced handoff replaces and revokes atomically; the admitted session's repeat `--verify` is idempotent | worker owns exact paths |
| T10 | `dispatched(r)` | `panel_open` r+1 | new candidate from the batch; r+1 ≤ 4 (round 4 = `final_bookend`); **tier may ESCALATE, never lower**; the worker admission is part of the entry chain (a lone worker verifies from its own session) | `open(r+1)` |
| T11 | `closed(4)` | bookend `disposition` | TOTAL by construction: zero accepted → `TERMINAL-GO` (followups routed as everywhere); ANY accepted → `TERMINAL-STOP`; no batch kind is legal | terminal |
| T11b | `disposed(r)` root-kind | `root_exit` | cites that disposition; all six evidence fields complete | unchanged — enables T8 |
| T12 | any non-terminal | `close` | Owner-evidenced; session ∉ admitted set; cites the latest disposition or (virgin) the winning open; reserves after ≥1 disposition | `CLOSED` |
| T13 | `TERMINAL-*` / `CLOSED` | `child_continuation` | terminal parent only; candidate-anchored; trigger rules per terminal kind; children globally unique, tier-floored, budget-declared, path-superset-declared | lineage row |
| T14 | terminal | ANY panel/disposition/dispatch/root_exit row | refused at record, inert on replay — terminality dominates delayed events | unchanged |
| T15 | active standard program | `legacy_handoff` | current-winning-state bound; atomic; ordinary overlapping aggregate starts still refuse | standard ended, child lineage |

**Resolution order:** every write-authority query resolves the ACTIVE aggregate program BY TASK
first, then decides target scope — an active program's write outside its authorized set refuses
(`repair-worker-path-unauthorized`); `not-repair-write` is reachable only when the DECLARED task
has no active program of either grammar. A write with no task-lane declaration cannot name a
program to check — the lane declaration is the standing prerequisite the sibling guards enforce.

**Terminal reservations, disclosed in full:** a STOP — and a close after any disposition —
reserves the latest winning open's ENTIRE changed-path set, permanently, repo-wide, in the
shared Git-common ledger. The sole exit is the reserving parent's own lineage (T13), whose
children carry declared path SUPERSETS their opens stay inside — so the successor needs a budget,
not a prophecy. An unrelated program's lineage child is NOT an exception. This permanence is the
design: a stopped surface is worked again only through the lineage that owns why it stopped.

**Lone worker:** the terminal bookend needs no counterpart session — a lone worker records its
own terminal GO/STOP, and verifies its own dispatches from its own session. Only the ABANDON path
requires a session outside the admitted set; in degraded mode that is the Owner's keyboard.

**Replay stability:** a legitimately recorded history derives identically forever. A standard
identity whose derivation fails, or that collides with an existing aggregate program, poisons the
WHOLE derivation closed — fail-closed in the same direction as the ownership query, never a
silent drop that would erase a terminal state or its reservation.

## 4 · S1a — the subject-blindness decision (implemented as stated)

(a) The no-subject relief exists only on provable absence-in-view: any `GIT_DIR` /
`GIT_COMMON_DIR` / `GIT_WORK_TREE` override ⇒ subject assumed present ⇒ deny path; an unreadable
ancestor (EACCES-class) also resolves to present — only ENOENT continues the walk. (b) The prose
claims speak SEE-semantics everywhere ("no subject this control can see", never "cannot exist");
the state identifier `repair-ledger-no-subject` is deliberately retained — renaming it would
break adopter contracts for a wording gain the prose already delivers. (c) The deny result names
the location overrides it observed (`observed_overrides`), so the operator learns WHY the
assumption was forced. The residual, stated: a spoofed location that RESOLVES points the control
at the subject the spoof selects — blindness is a property of what the control can SEE, and no
walk detects a working spoof; that is the records-not-deters class, not new machinery.

## 5 · Rig-vs-candidate discriminator

Unchanged candidate bytes + repaired EXTERNAL environment = rig: rerun the same round free (T3).
A candidate contaminated MID-PANEL takes the ONE bounded refreeze (T3b) — same roster, same
scope, nothing consumed. A candidate-owned defect FOUND BY THE PANEL — fixture, assertion,
packet, receipt binder, evidence-producing script — is a finding: it rides the disposition and
its repair consumes the batch. Repeated rig-class harm replaces or rejects the rig — a declared
judgment. The discriminator is a declaration with named consumers (the PM's partition and the
refreeze bound), never an inferring predicate.

## 6 · Doctrine surfaces (instruction class, same changeset)

`core/WORKFLOW.md` § Gate: the cadence paragraph (finite aggregate model, refreeze bound, early
root kinds, "each" on the R1/R2 allowance), the authors-declare paragraph (four-bucket
vocabulary), the Git-common controller paragraph (aggregate first-wins + replay-only standard),
and the final-gate paragraph. `skills/orchestrate/SKILL.md` step 5, `PROTOCOLS.md` (the terminal
bookend bullet, now also carrying the post-GO NEW-SCOPE rule and pinned by the cross-surface
cadence tokens), `CHIP_BRIEF.md` § 5, `RUNG_ZERO.md` (the screening back-port; the honest-limits
quote corrected to WORKFLOW's actual words). `hooks/guard-gate-ladder.mjs` CONTRACT prints the
same cadence including the refreeze bound. The design journal carries the supersession banner
pointing here; § 0 above records the ruling it cites. `README.md` gains the v2.16.0 release
section with the upgrade instructions. Generalization holds: no Owner names, no model brands, no
adopter paths in shipped text.

## 7 · Adopter upgrade rung

A plain `init` rerun that keeps byte-differing MECHANISM files FAILS (exit 1) naming them and the
remedy — never a silent claim. Mechanism = controller, guards, recorder, scripts, core docs,
installed tests, AND the gate-machinery skills (`orchestrate`, `frontier-review`) with their
shims and the reviewer agents. Adopter-personal surfaces (the thread-restart commands, the Codex
lane config, humanize and the ritual skills) stay plain keeps. Under `--force`, a DIFFERING
mechanism file is backed up to `<file>.bak` before overwrite (backup failure refuses); identical
files get no backup noise. After a `--force` with the Codex lane installed, init runs the
armed-check and reports a disarmed lane out loud. The recorder refuses aggregate events against a
pre-aggregate controller with `repair-controller-version-skew`. Full adopter upgrades remain
separate chips (Peripheral Brain first, then PIL — Owner sequencing).

## 8 · Mutation matrix — proven red-then-green

Ticket-named six: **M1** incomplete/shrunk/recomposed panel close → refuses
(`aggregate-panel-close-conflict`). **M2** second dispatch citing one disposition → inert/
`aggregate-dispatch-conflict`. **M3** fourth batch by any route → `aggregate-dispatch-unavailable`.
**M4** count reset by refreeze/rename/new-scope → candidate changes, count survives; relabel
refuses (`aggregate-panel-open-conflict`). **M5** post-terminal dispatch/panel/disposition →
refused/`aggregate-terminal` (T14). **M6** successor lacking parent terminal id, candidate,
Owner evidence, tier floor, or budget → `aggregate-continuation-malformed`/`-conflict`, inert.

Loose ends: **M7** active program, out-of-scope write → `repair-worker-path-unauthorized`, never
`not-repair-write`; disabled arm reproduces the fail-open. **M8** stale legacy-handoff citation
inert on replay; the recorder stamps the current winner itself. **M9** pre-terminal rows after a
close → inert; ownership stays released; disabled arms resurrect it. **M10** hash-valid malformed
rows → typed ledger refusal, no throw; the disabled `Array.isArray` arm throws. **M11** evidence
is commit-addressed (no HEAD in the diff/merge-base commands) with the before/after bracket.
**M12** plain init rerun over stale mechanism keeps (hooks OR skills) → exit 1 naming `--force`.

Evidence-fold rows: **M13** rig rerun on an unchanged candidate consumes nothing; a mid-panel
candidate change takes the ONE refreeze; a panel-found candidate defect consumes its batch.
**M14** an unpartitioned or double-bucketed finding id refuses the disposition. **M15** a
non-terminal parent cannot seed a successor; a child below the parent's tier refuses. **M16** a
followup entry without its inline route refuses — silent adjacent survival is the failure.
**M17** the 12-round and 20-round replay fixtures STOP at the terminal bookend — prior rows
preserved, three batches ever, every later route refused — asserting TERMINATION, never batch
composition.

Round-1 batch rows: **M23** refreeze — one supersede accepted; a second refuses; the bookend
refuses; a recomposed roster refuses; disabled arm deadlocks the round. **M24** close — an
admitted worker session (any round, any window) → `aggregate-close-self-authorized`; a
non-admitted close after dispositions reserves the paths (relabel refused); a virgin close
releases cleanly via its winning open. **M25** tier continuity — a lower-tier later round
refuses; escalation accepted. **M26** serialization — an explicitly-undefined key round-trips
(the ledger stays readable); a cyclic input refuses typed; a timestamp-differing retry converges
idempotently on the standing winner. **M27** cross-seat duplicate finding ids refuse AT CLOSE and
recompose. **M28** early root kind at R1 accepted; its dispatch owes the root exit. **M29** a
lineage child opens on a SUBSET of its declared budget. **M30** the reservation yields only to
the reserving parent's own lineage — an unrelated parent's child refuses. **M31** an unreadable
ancestor never buys the blind relief; observed overrides are named in the deny result. **M32**
the recorder's version-skew refusal is typed, never a TypeError. **M33** the family floor — a
single-family T2/T3 roster cannot open.

Regression rows from the predecessor evidence (behavioral): empty-seat-plus-PM-blocker closes
STOP, never GO · a dead worker is replaced only by an Owner-evidenced handoff that revokes the
old session · a declared two-child split admits both exact children and refuses an undeclared
third · an authorized family substitution closes and the same mismatch without its receipt
refuses.

Preserved behavior (characterization): unknown/hash-corrupt rows fail the ledger closed —
GLOBALLY for the aggregate grammar, by the corrupt-state invariant (the boundary normalization
removes the accidental route; a hand-appended malformed row is a repo-wide deny in the SAFE
direction, repaired by fixing the row, never by deleting the ledger); well-shaped wrong
references stay inert; replay-only legacy history; linked-worktree Git-common resolution;
unrelated-path availability; first-wins adjudication.

## 8c · Cross-surface sweep — mechanical half, and the stated limit

The cadence's cross-surface agreement is pinned mechanically (`tests/gating-doctrine.test.mjs` ·
`tests/orchestrate-skill.test.mjs`) across `core/WORKFLOW.md`, the guard's printed CONTRACT, and
`PROTOCOLS.md`, with a retired-spelling absence pin proven against the exact retired text.
**The limit:** surfaces this changeset does not edit stay hand-synchronised — the user-level
skill installs (`~/.agents/skills/orchestrate`, synced byte-identical at release per
`sync-user-orchestrate-skill.mjs`, a RELEASE-COMPLETENESS blocker discharged at landing, plus the
separately-maintained `~/.claude` copy with its own documented divergences) and every adopter
repo (their upgrades are the sequenced follow-on chips).

## 9 · Acceptance

Focused controller tests + the matrix above (every row exercised, disabled arms red) + replay
fixtures + full `npm test` + `npm run acceptance` + doc-size/skill budgets + installation/sync
parity + the real installed-package rung when available. Raw-look every zero/clean result.
Freeze; complete T3 instruction/control panel (free seat + ≥3 angles + both cross-family
families + the adversarial walk-through — this IS gate machinery); all seats collected before any
repair; accepted harms batched ONCE; the batch's bookend per the final-gate rule. The new rule is
never used to excuse its own gate. Owner boundaries: tier ratified (§ 0); core-doc wording
sign-off; push/merge GO on the exact frozen SHA. No push, release, adopter upgrade, or
user-install mutation inside the changeset.
