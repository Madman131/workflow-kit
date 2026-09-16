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
grammar it cannot judge is denial, and the cure is upgrading (one `init --force` updates both
lanes' hook copies IN THAT CHECKOUT; every worktree shares the ledger but carries its OWN hook
copies, so a multi-worktree repo runs mixed — failing CLOSED, never open — until each checkout
is upgraded, as the ledger-unavailable deny text's third cause states). The three bare compatibility names (`panel_close`, `evidence_rerun`,
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
| `panel_open` | task · changeset · round (1–4) · phase · tier · frozen commit+tree · base ref + base commit · changed paths (derived from the immutable base..frozen pair) · complete expected seat roster {seat_id, role, family, pass_type, paths, substitution?} | reserves the round; first eligible open wins; membership authority. **Floors fixed for the DECLARED tier** (tier itself is declared and Owner-ratified upstream): free seat at full path coverage · ≥2 (T2) / ≥3 (T3) distinct angle roles, all `free` · one external · **≥2 distinct family values** — OR a roster below two families admitted through an
Owner-evidenced `same-family-only` seat substitution (`core/REVIEW.md`'s reduced-decorrelation
state; a caller-supplied declaration per the records-not-deters bound), recorded, never silent |
| `panel_close` | its `panel_open` event id · received seat outcomes {id, role, family, pass_type, inspected_paths, reviewed commit+tree, verdict, finding ids, artifact receipt+sha256, packet_scope, pre_loaded} | the round's review receipt — received ≡ expected exactly, every changed path covered, and **finding ids globally unique across seats** (a collision refuses HERE, while the close is still recomposable). `pre_loaded` is a LOG (false · true · the seat's disclosure text), never a certification; seat outcomes are records, unauthenticated by construction |
| `disposition` | one unused `panel_close` of the current round · complete disjoint FOUR-bucket partition of every seat and PM finding id — **`accepted`** (BLOCKING: the bucket IS the declaration that a harm is changed-feature/contract-invariant class or Critical/fail-open) · **`followup`** (real, non-blocking, safely separable adjacent; each entry `{id, route}` with its routing text inline — embedded because a separate event citing the GO would be a content-hash cycle) · **`declined`** · **`note`** · terminal_state · remediation_kind · authorized paths ⊆ the open's changed paths | GO (zero accepted; followups routed) · CONTINUE (authorizes at most one batch) · STOP (declarable at ANY round) |
| `dispatch` | exactly one accepted CONTINUE disposition + its panel_close · next round · brief path+sha256+size · authorized paths · for a ROOT-KIND disposition (any round): the `root_exit` event id | the batch — one per disposition, ever |
| `root_exit` | the root-kind disposition · shared mechanism · why prior fixes were symptoms · owner/state/yield seams · one replacement · removed workarounds · trigger matrix | unlocks only that disposition's dispatch |
| `worker` | dispatch event id · session | admits ONE worker session; the handoff-admitted session's own `--verify` is idempotent |
| `worker_handoff` | Owner evidence · the immutable active dispatch · the prior worker's exact admission · new session | replaces the worker; revokes the old session in the same transition |
| `close` | Owner evidence · reason · the latest disposition — or, for a program with NO disposition, its winning `panel_open` | ABANDON: releases active authority; **eligibility = session ∉ every admitted worker session** (verifications and handoff replacements); after any RECORDED panel receipt the close RESERVES the UNION of the program's opens' changed paths exactly as STOP does (close-then-relabel is not a fresh budget, and RECORDED ground is not released by abandoning it before the disposition); a close with no receipt on record reserves nothing — the open-to-receipt window is a disclosed records-not-deters seam: seats' collected-in-fact-but-unrecorded artifacts are invisible to a controller that can only read rows |
| `child_continuation` | parent task/changeset · the anchor: parent's latest disposition id — or, for a no-disposition CLOSED parent with a collected panel, its winning `panel_open` id (mirroring the close event's own anchor rule; without it that reservation had no constructible exit) · the parent terminal candidate (frozen commit+tree, controller-derived) · continuation kind `split` \| `new_changeset` \| `material_scope` · children (split: 2–8 disjoint; else one), each {task, changeset, tier ≥ parent tier, budget, authorized-path SUPERSET the child's opens must stay inside; a pending budget binds until the child opens, and two pending budgets never overlap} · trigger ids (STOP: the accepted set, order-insensitive — routed follow-ups deliberately ride the DISPOSITION row, whose inline routes survive; the trigger set is the lineage's CAUSE, not the successor's workload; GO: routed follow-ups only; CLOSED: a SUPERSET of the accepted set PLUS every collected-but-undisposed panel's raw finding ids — the freshest un-discharged ground cannot be shed — with routed follow-ups optional; winning-open anchor: the union of the collected panels' raw finding ids; cap 2600 = the union bound: a disposition's 1300-id universe (12×100 seat ids + 100 PM
findings) plus the one possible undisposed panel's 1200-id seat ground — the maximum mandatory
carry is 2500, so the sole exit is never shape-impossible) · Owner evidence | lineage ONLY — no ownership, no verdict, no dispatch; the ONE successor mechanism; anchors only to a TERMINAL parent (GO, STOP, or CLOSED — a non-terminal or held state can never seed a child) |
| `legacy_handoff` | the CURRENT winning standard disposition/candidate/round · one declared child | atomically ends standard ownership, creates lineage; the recorder derives the citation itself (callers never mint trusted pointers); replay binds the latest ROUND row AND the parent's ACTIVENESS as of the handoff's own ledger position (cross-stream order by `seq` — § 3 Replay stability; a planted row citing an inactive parent is inert), so neither a post-handoff close of the emptied program nor an out-of-band standard append can retroactively unmake the lineage; the child budget refuses when it overlaps a pending hold or a live program's surface |

Refusal states are the shipped ones: `aggregate-<kind>-conflict` for a transition the derivation
refuses, `aggregate-<kind>-malformed` for shape (one deliberate unification: the
`child_continuation` kind spells both as `aggregate-continuation-…`), plus the named diagnoses `aggregate-terminal`,
`aggregate-worker-required`, `aggregate-close-self-authorized`, `aggregate-root-exit-required`,
`aggregate-root-exit-unexpected`, `aggregate-worker-superseded`,
`aggregate-dispatch-unavailable`, `repair-worker-path-unauthorized`, and the recorder's
`repair-controller-version-skew`. Every one has remediation text in the write guard or recorder.

## 3 · Transition table

States per (task, changeset): `unopened` → `open(r)` → `closed(r)` → `disposed(r)` →
[`dispatched(r)` → `open(r+1)` …] → `TERMINAL-GO` | `TERMINAL-STOP` | `CLOSED`. Rounds are
absolute; a refreeze changes the candidate, never the round count.

| # | From | Event | Guard (all mechanical) | To |
|---|---|---|---|---|
| T1 | `unopened` | `panel_open` r=1 | identity globally unclaimed; no ACTIVE program of either grammar owns any declared path; no terminal reservation covers them (exception: the reservations of the child's OWN lineage ANCESTOR CHAIN — direct-parent-only was the executed nested lockout, M42); evidence commit-addressed with the clean-candidate bracket before AND after capture | `open(1)` |
| T2 | `open(r)` | `panel_close` | cites the round's WINNING open (a superseded open can never close); received ≡ expected; cross-seat finding ids unique; recorder stands at the frozen candidate (tracked-clean; untracked files are packet discipline, not candidate identity), bracket re-checked after receipt assembly | `closed(r)` |
| T3 | `open(r)` | rig failure, candidate bytes UNCHANGED | a NON-EVENT by design: the panel has not closed; the failed seat attempt reruns (§ 5) | `open(r)` — consumes nothing |
| T3b | `open(r)` unclosed | `panel_open` r (REFREEZE) | AT MOST ONCE per round · NEVER at the final bookend (a contaminated bookend exits via close+successor) · roster and changed-path set PINNED to the superseded open · tier pinned · both overlap checks re-run · the superseded open can no longer close. No disposition was reached ⇒ nothing consumed; a refreeze never grants a batch or resets the count — and the bound is what keeps that sentence true | `open(r)` on the new candidate |
| T4 | `closed(r)` | `disposition` GO | four-bucket partition complete + disjoint; zero `accepted`; every followup routed inline | `TERMINAL-GO` (any round) |
| T5 | `closed(r)`, r<3 | `disposition` CONTINUE | accepted ids present; kind `bounded`, or a ROOT kind declared early on recurrence | `disposed(r)` |
| T6 | `closed(3)` | `disposition` CONTINUE | kind MUST be `root_replacement` \| `simplification` \| `split` | `disposed(3)` |
| T7 | `closed(r)` | `disposition` STOP | any round; accepted ids present; the PM's declaration of a Critical/fail-open or otherwise unforwardable blocking harm | `TERMINAL-STOP` |
| T8 | `disposed(r)` | `dispatch` | first eligible wins; cites THAT disposition; a root-kind disposition's dispatch requires its `root_exit` at ANY round; every accepted finding of the disposition rides this ONE batch | `dispatched(r)` |
| T9 | `dispatched(r)` — and `open(r+1)`, where the dispatch stays ACTIVE until the next disposition clears it (a stalled worker is replaceable mid-panel) | `worker` / `worker_handoff` | one admitted session; Owner-evidenced handoff replaces and revokes atomically; the admitted session's repeat `--verify` is idempotent | worker owns exact paths |
| T10 | `dispatched(r)` | `panel_open` r+1 | the batch's candidate, bound by the ENTRY CHAIN (dispatch + worker ids) — byte-difference is deliberately NOT a predicate: a legitimate repair may restore prior bytes, and semantic sameness is declared, never inferred; r+1 ≤ 4 (round 4 = `final_bookend`); **tier may ESCALATE, never lower**; the worker admission is part of the entry chain (a lone worker verifies from its own session) | `open(r+1)` |
| T11 | `closed(4)` | bookend `disposition` | TOTAL by construction: zero accepted → `TERMINAL-GO` (followups routed as everywhere); ANY accepted → `TERMINAL-STOP`; no batch kind is legal | terminal |
| T11b | `disposed(r)` root-kind | `root_exit` | cites that disposition; all six evidence fields complete | unchanged — enables T8 |
| T12 | any non-terminal | `close` | Owner-evidenced; session ∉ the set admitted BEFORE this row's position (as-of — a later admission never re-adjudicates it); cites the latest disposition or (if none exists) the winning open; reserves after any recorded receipt | `CLOSED` |
| T13 | `TERMINAL-*` / `CLOSED` | `child_continuation` | terminal parent only; anchored to the latest disposition or (no-disposition CLOSED, collected) the winning open; candidate-anchored; trigger rules per terminal kind incl. the CLOSED accepted-set floor; children globally unique, tier-floored, budget-declared (pending budgets bind and never overlap), path-superset-declared | lineage row |
| T14 | terminal | ANY panel/disposition/dispatch/root_exit row | refused at record, inert on replay — terminality dominates delayed events | unchanged |
| T15 | active standard program | `legacy_handoff` | current-winning-state bound; atomic; ordinary overlapping aggregate starts still refuse | standard ended, child lineage |

**Resolution order:** every write-authority query resolves the ACTIVE aggregate program BY TASK
first, then decides target scope — an active program's write outside its authorized set refuses
(`repair-worker-path-unauthorized`); `not-repair-write` is reachable only when the DECLARED task
has no active program of either grammar. A write with no task-lane declaration cannot name a
program to check — the lane declaration is the standing prerequisite the sibling guards enforce.

**Terminal reservations, disclosed in full:** a STOP — and a close after any RECORDED panel receipt —
reserves the UNION of the program's opens' changed-path sets, permanently, repo-wide, in the
shared Git-common ledger. The sole exit is the reserving parent's own lineage (T13), whose
children carry declared path SUPERSETS their opens stay inside — so the successor needs a budget,
not a prophecy. An unrelated program's lineage child is NOT an exception. A DIRECT lineage child
reaching TERMINAL-GO lifts the reservation over its declared budget INTERSECTED with the paths
its own panels actually opened — a wide budget is a plan, not a repair, and the never-reviewed
remainder stays reserved. A lineage child's OPEN excepts its whole ANCESTOR chain (a grandchild
working its parent's reserved slice is also working its grandparent's — excepting only the direct
parent made the lattice one-shot) — but the LIFT stays with direct children: a grandchild's GO
lifts only its own parent's reservation, never across generations; each reservation exits
through its own direct children. One LIVE continuation per anchor, not one ever: a new
continuation is admissible when every child of the standing one is terminal AND either one ended
as a VIRGIN close (opened, collected nothing — its slice would otherwise strand; that ritual
open-then-virgin-close is also the ONE exit from an abandoned pending declaration, stated here
rather than left to be discovered) OR un-lifted remainder survives on the parent's own
reservation AND the new declaration's budget SHARES a path with that remainder (a budget sharing
nothing with the remainder refuses; a budget that shares one but whose child then opens
elsewhere is a fully-reviewed no-op successor, not a release — the reservation is never lifted
without a GO child that actually OPENED the freed path, so unbounded reviewed successors cost
namespace and Owner evidence but never surrender the surface) — a successful PARTIAL repair must not lock the rest. A PENDING child's declared
budget binds from declaration until the child opens — and is refused AT declaration when it
overlaps another pending budget, a live program's bound surface, OR another program's un-lifted
reservation; the reservation exception at declaration is the declarer's own NON-GO lineage chain
(a GO node ends its lineage's claim, so reach-back through a GO hop refuses and the reserving
ancestor's own re-openable anchor is the only door). Every round of one changeset derives its
changed paths from ROUND 1's exact base ref and commit — the base is the CHANGESET's, not the
round's, enforced at open and refreeze alike, so a moved base can never shrink a later panel's
view to the last delta. THE COST, disclosed: a lane that rebases onto (or merges) an advanced
base mid-changeset is a NEW candidate lineage — its later rounds refuse (the diagnosis names
the pinned base and both exits), and the honest discipline is that a GATED lane's base is
frozen; integrate upstream AFTER terminal, or exit via close+successor. The base REF must also
keep resolving with its merge-base at round 1's commit for evidence capture — a deleted or
rewound ref wedges recording until restored (fail-closed, recoverable). This permanence is the design: a stopped surface is worked again only
through the lineage that owns why it stopped, and released only where that lineage repaired it
to GO.

**Lone worker:** the terminal bookend needs no counterpart session — a lone worker records its
own terminal GO/STOP, and verifies its own dispatches from its own session. Only the ABANDON path
requires a session outside the admitted set; in degraded mode that is the Owner's keyboard.

**Replay stability:** a legitimately recorded history derives identically forever — BY
CONSTRUCTION, not by heuristic. Every ledger row carries `seq`, its position in the one shared
file, and every cross-stream predicate (legacy path availability, standard-identity squats, a
legacy handoff's parent binding) evaluates against the standard rows VISIBLE AT THE CONSULTING
ROW'S POSITION. Appending a row — to either grammar — can therefore never re-adjudicate a row
already accepted: an out-of-band standard append cannot erase a terminal state, its reservation,
or a child's lineage (the measured fail-open), and a planted row whose binding fails at its own
position is inert audit residue, never history-breaking. New admissions evaluate at the ledger's
end and DO see every standard row, so the availability protections stay live at record time.
Close eligibility follows the same discipline: the admitted worker set is accumulated AS ROWS
ARE ACCEPTED, so a close is judged against admissions BEFORE its own position and a later
admission row can never retro-refuse it — the pre-mint window needs no backward scan, because a
session not yet admitted is genuinely not a worker and its post-close self-admission refuses on
the terminality the close created. The
one remaining poison is a standard identity whose derivation fails — fail-closed in the same
direction as the ownership query. Two earlier in-flight poison heuristics (identity-collision
poison, legacy-binding-mismatch poison) are REMOVED as superseded: ordering makes their trigger
scenarios impossible for recorded rows and inert for planted ones.

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
scope, nothing consumed; the refreeze's changed paths are RE-DERIVED from the new candidate's
immutable base..frozen pair and must EQUAL the superseded open's, so a candidate whose footprint
grew cannot ride the refreeze past the panel's declared scope (it refuses). A candidate-owned defect FOUND BY THE PANEL — fixture, assertion,
packet, receipt binder, evidence-producing script — is a finding: it rides the disposition and
its repair consumes the batch. Repeated rig-class harm replaces or rejects the rig — a declared
judgment. A REBASED OR MERGED LANE is neither rig nor refreeze: the candidate lineage itself
changed, the base pin refuses it by design, and the exits are continuing on the original base
or close+successor (§ 3). The discriminator is a declaration with named consumers (the PM's partition and the
refreeze bound), never an inferring predicate.

## 6 · Doctrine surfaces (instruction class, same changeset)

`core/WORKFLOW.md` § Gate: the cadence paragraph (finite aggregate model, refreeze bound, early
root kinds, "each" on the R1/R2 allowance), the authors-declare paragraph (four-bucket
vocabulary), the Git-common controller paragraph (aggregate first-wins + replay-only standard),
and the final-gate paragraph. `skills/orchestrate/SKILL.md` step 5, `PROTOCOLS.md` (the terminal
bookend bullet, now also carrying the post-GO NEW-SCOPE rule and pinned by the cross-surface
cadence tokens), `CHIP_BRIEF.md` § 5, `RUNG_ZERO.md` (the screening back-port; the honest-limits passage REWRITTEN — the stale
quotation was deleted, not corrected). `hooks/guard-gate-ladder.mjs` CONTRACT prints the
same cadence including the refreeze bound and the STOP-reservation disclosure; `core/GATES.md`'s
round-inference paragraph and `hooks/guard-brief-rung.mjs`'s deny-text table are edited
instruction surfaces too. The design journal carries the supersession banner
pointing here; § 0 above records the ruling it cites. `README.md` gains the v2.16.0 release
section with the upgrade instructions. Generalization holds: no Owner names, no model brands, no
adopter paths in shipped text. One RIG surface, named per the sweep rule: the untracked
`core/REPO_INVARIANTS.md` states cadence components for THIS repo's own gate runs (its item 5 is
the refreeze bound). It is not a shipped surface and rides no review packet; it IS a member of `check-doc-size.mjs`'s governed floor (reported `BINDING/payload`), which is where its own budget is enforced. `init`'s
`copyTree(core/)` filters the `[G]`-generated names (§ 7), so even an init run FROM a working
copy holding the rig file cannot ship it; it stays untracked besides, so a released clone never
carries it at all.

## 7 · Adopter upgrade rung

A plain `init` rerun that keeps byte-differing MECHANISM files FAILS (exit 1) naming them and the
remedy — never a silent claim. Mechanism = controller, guards, recorder, scripts, core docs,
installed tests, AND the gate-machinery skills (`orchestrate`, `frontier-review`) with their
shims and the reviewer agents. Adopter-personal surfaces (the thread-restart commands, the Codex
lane config, humanize and the ritual skills) stay plain keeps. Under `--force`, EVERY
DIFFERING file it overwrites — mechanism and personal alike — is backed up to `<file>.bak`
before overwrite; a backup that cannot be taken refuses the overwrite, and every refusal is
counted, named in the end-of-run report, and forces exit 1 (a mixed-version tree never reads as
a clean adopt). A SYMLINK at the destination or at its `.bak` — DANGLING links included, checked
lstat-first on plain AND forced runs — refuses the write; every overwrite's destination parent
must realpath inside the install's declared write roots (the repo target and the prompts dir;
an unresolvable root set fails closed, and a DANGLING ancestor link refuses TYPED and counted,
never a raw throw); the root-level appends (`.gitignore`, the AGENTS.md pointer) carry the same
lstat refusal; and the `git config` write is guarded two ways: the target's `.git` is refused up front when it
is a symlink or a regular-file pointer resolving outside the install, and any Git-location
environment override (`GIT_DIR`/`GIT_COMMON_DIR`/`GIT_WORK_TREE`) is refused before the write
(named like the controller's own `observed_overrides`); then, categorically, the value is READ
BACK from the target's own config file (via `git config --file <resolved>`, immune to
`GIT_CONFIG`) and the run REFUSES, counted, exit 1, if it did not land in the target — so no
environment can UNDETECTABLY arm a foreign repo or leave the target falsely armed. The one
residual, disclosed: a `GIT_CONFIG` redirect writes `core.hooksPath` into the redirected config
ONCE before the read-back refuses (reversible, signaled) — detection, not yet prevention; pinning
the write to `--file <resolved>` is the banked prevention follow-up.
**[RESOLVED 2026-08-25, v2.17.0 — the write is now pinned to `--file <resolved>`; under `GIT_CONFIG`
init arms the target's OWN config with no stray write. The refuse-under-`GIT_CONFIG` behavior this
paragraph records is superseded. See `git_config_write_pin_contract.md`; this disclosure is kept as
history.]** A
symlinked `.claude/settings.json` refuses the merge (plain: a named warning printing the
RESOLVED target; forced: counted, exit 1); a present-but-unparseable one is backed up
byte-for-byte before regeneration, and a forced merge that would CHANGE a regular settings
file's bytes backs it up first — no overwrite path bypasses the backup machinery. An existing
`.bak` whose bytes differ from what this run would save is ROTATED to the first free
`<file>.bak.<n>` before saving — nothing is ever destroyed, hand edits keep every generation,
and repeat upgrades flow; a rotation that cannot be taken refuses and counts. Identical bytes
pass idempotently, and identical files get no backup noise. A skip flag that omits a mechanism family
PRESENT on disk still runs the read-only stale-keep comparison for it — the Codex lane's hooks
and armed-check probe, the gate runners, and the two mechanism prompt shims (orchestrate,
frontier-review; personal prompts stay plain keeps) — byte-differing keeps named KEPT BUT STALE,
exit 1 (the skip suppresses writes, never the accounting). `copyTree(core/)` filters the
`[G]`-generated names, so a kit checkout's own rig or generated copies can never ship verbatim
into an adopter. After a `--force` with the Codex lane installed, init runs the armed-check; a
lane it cannot verify armed is named AND exits 1. Disclosed limits: the convenience-class
Codex thread-restart prompt is outside the skip accounting by design, and a real worktree
adoptee is ADOPTED whether its `.git` is a file or a hand-replaced symlink — `escapingGitDir`
resolves the `<common>/worktrees/<name>` nesting rather than keying on link shape, so the old
false positive is gone; only a plain pointer resolving outside the install is refused. The upgrade is NOT atomic: a mid-run failure leaves earlier files
already replaced — recoverable file-by-file from their `.bak`s, loudly, at exit 1 — and a
staging-directory atomic swap is a banked successor, not this changeset's machinery. The recorder refuses aggregate events against a
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

**M23** refreeze — one supersede accepted; a second refuses; the bookend
refuses; a recomposed roster refuses; disabled arm deadlocks the round. **M24** close — an
admitted worker session (any round, any window) → `aggregate-close-self-authorized`; a
non-admitted close after any RECORDED receipt reserves the paths (relabel refused — a
no-disposition receipted close reserves, proven by the H3c fixture); a close with no receipt on
record releases cleanly via its winning open (the open-to-receipt seam, disclosed at § 2's
close row). **M25** tier continuity — a lower-tier later round
refuses; escalation accepted. **M26** serialization — an explicitly-undefined key round-trips
(the ledger stays readable); a cyclic input refuses typed; a timestamp-differing retry converges
idempotently on the standing winner. **M27** cross-seat duplicate finding ids refuse AT CLOSE and
recompose. **M28** early root kind at R1 accepted; its dispatch owes the root exit. **M29** a
lineage child opens on a SUBSET of its declared budget. **M30** the reservation yields only to
the reserving parent's own lineage — an unrelated parent's child refuses. **M31** an unreadable
ancestor never buys the blind relief; observed overrides are named in the deny result. **M32**
the recorder's version-skew refusal is typed, never a TypeError. **M33** the family floor — a
single-family T2/T3 roster cannot open, EXCEPT through a declared `same-family-only`
substitution with Owner evidence (both polarities and the escape tested). **M34** ledger order is authority — an out-of-band
standard append leaves every persisted aggregate row's adjudication untouched (ownership,
dispositions, reservations intact) while a NEW admission on the appended row's path refuses;
disabled arm: stripping the seq prefix from the legacy check erases the whole program. **M48**
the cross-round base pin — a later open or refreeze declaring any base but ROUND 1's refuses,
both at record and on replay; disabled arm: the moved-base open lands and reviews only the last
delta. **M49** cap truth at the executed shape — the 12×100+100 STOP (1300 accepted ids)
records and its exact carry accepts; disabled arm: restoring the old 1200 cap makes the
recorded row unreadable (whole-ledger repair-history-invalid). **M50** declaration-time stopped
refusal — a GO hop cannot reach back over an ancestor's remainder (empty-trigger transport
refused at declaration); the reserving ancestor's own re-continuation accepts. **M51** the
remainder-reopen boundary — a fully-lifted parent's third continuation refuses (nothing
stranded). **M52** the pending-hold diagnosis names the holder for ANY legal roster order.
**M53** the legacy-handoff reservation guard — a handoff child budget over a STOPped surface
refuses; disjoint accepts; disabled arm: the squat lands and both exits brick. **M54** the
remainder-share gate — a re-continuation whose budget shares NO path with the un-lifted remainder
refuses; one that shares a remainder path is admitted (its child does its own gated work; a
no-op successor releases nothing); the virgin route unchanged; disabled arm: the unrelated-path
grind reopens the anchor indefinitely. **M55** the honest remainder-share guarantee — a
re-continuation whose budget SHARES the un-lifted remainder is ADMITTED (a reviewed no-op
successor is permitted; unbounded gated successors cost namespace but never release the surface),
one sharing nothing REFUSES, and the reservation lifts only when a GO child actually OPENED the
freed path. **M35**
the lift is coverage-scoped — a GO child releases exactly its own budget: the sibling's
never-repaired stopped surface still refuses an unrelated open, the repaired surface admits one,
and the sibling still enters through its lineage; disabled arm: a whole-union lift readmits the
unrelated open on the never-repaired path. **M36** a CLOSED parent's successor carries the
accepted set as a floor — an empty trigger list refuses, the accepted set accepts, an id outside
accepted ∪ follow-ups refuses. **M37** a no-disposition collected close anchors its successor by
the winning open — the ground finding set is carried exactly, an empty list refuses, and one
successor per anchor. **M38** close adjudication is forward — an accepted close STANDS against a
later worker/handoff row naming its session (the late row loses at its own position; the
continuation and child lineage are untouched). **M39** a pending lineage child's declared budget
binds — an unrelated open on it refuses, the child's own open accepts and converts the hold, and
two overlapping pending budgets refuse at declaration. **M40** an active program binds its
undisposed opens' changed paths — a concurrent open on a mid-review surface refuses; before the
panel opens, only the authorized set binds. **M41** the lift intersects budget with OPENED
coverage — a wide-budget narrow-open GO releases only what it reviewed; disabled arm: the
un-intersected lift releases the remainder. **M42** a lineage open excepts its whole ancestor
chain — the grandchild opens the doubly-reserved slice, the stranger still refuses; disabled arm:
direct-parent-only reproduces the nested brick. **M43** re-continuation — admissible when all
children are terminal AND (one is a virgin close, OR un-lifted remainder survives and the new
budget SHARES a path with it); refused while a child lives, when everything lifted, or when the
new budget shares nothing with the remainder (M54). A budget that shares a remainder path but
whose child opens elsewhere is a reviewed no-op successor, never a release. **M44** pending-vs-active refuses at declaration on both successor kinds, and the
pending refusal is DIAGNOSED (the deny names the holding child). **M45** the CLOSED floor
carries collected-but-undisposed ground — the shedding successor refuses, the honest one
records. **M46** legacy activeness binds as-of — a planted inactive-parent handoff is inert; a
recorded handoff survives the parent's later close. **M47** the 2600 trigger cap — a 101-id
exact carry accepts, 2601 refuses on shape under the unified spelling; the 1300-id
STOP carry accepts (M49), and the old 1200 cap did worse than refuse: it made a recorded
1300-id row unreadable, failing the whole ledger (M49's disabled arm).

**M56** Principal review-seat substitution: only the external seat may carry it; family identity is
trimmed/case-folded for every comparison while recorded bytes remain intact; observed provider/model
must be nonblank and exactly match the planned tuple at close. Builder-family free/angle seats,
semantic one-family rosters, mismatched evidence, and missing/mismatched runtime tuples refuse.

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
`tests/orchestrate-skill.test.mjs`) across ALL FIVE stating surfaces — `core/WORKFLOW.md`, the
guard's printed CONTRACT, `PROTOCOLS.md`, `SKILL.md` (concept tokens), and `CHIP_BRIEF.md` (the
root-kind component pin, agreed against the guard's deny texts) — with the STATES/POINTS/NEITHER
accounting edited deliberately and a retired-spelling absence pin proven against the exact
retired text.
**The limit:** surfaces this changeset does not edit stay hand-synchronised — the user-level
skill installs (`~/.agents/skills/orchestrate`, synced byte-identical at release per
`sync-user-orchestrate-skill.mjs`, a RELEASE-COMPLETENESS blocker discharged at landing, plus the
separately-maintained `~/.claude` copy with its own documented divergences) and every adopter
repo (their upgrades are the sequenced follow-on chips).

## 9 · Acceptance

Focused controller tests + the matrix above (every row exercised, disabled arms red) + replay
fixtures + full `npm test` (green modulo the user-install parity rung on a host holding the
install — that rung is the § 8c release-completeness blocker, discharged at landing) +
`npm run acceptance` + doc-size/skill budgets + the real installed-package rung when available. Raw-look every zero/clean result.
Freeze; complete T3 instruction/control panel (free seat + ≥3 angles + both cross-family
families + the adversarial walk-through — this IS gate machinery); all seats collected before any
repair; accepted harms batched ONCE; the batch's bookend per the final-gate rule. The new rule is
never used to excuse its own gate. Owner boundaries: tier ratified (§ 0); core-doc wording
sign-off; push/merge GO on the exact frozen SHA. No push, release, adopter upgrade, or
user-install mutation inside the changeset. Disclosed bounds: ≤500 changed paths per candidate
(and per manifest), 4–12 seats per panel, ≤100 finding ids per seat, 2–8 split children; panel
git evidence is captured from a WORKING TREE standing at the declared frozen pair, bracketed by
clean-candidate checks before and after — commit-addressed afterward, but the capture itself
runs where the caller stands.
