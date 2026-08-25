# Terminal round breaker — formal contract, transition table, and mutation matrix

**CLASS: BINDING DESIGN · T3 (Owner-ratified).** Base
`956c62c4201cd9292704895c061545651b01b5eb`. Changeset `terminal-round-breaker`,
ships `2.15.0 → 2.16.0`. Written BEFORE any code, per the ticket's process order; the
cross-family design lens fires on this artifact before implementation begins.

Predecessor material (evidence, not authority): the experimental branch
`codex/terminal-controller-hard-stop` @ `bdaf4332…` — its contract, two disposition rounds
(D1–D5 folded; two roots repaired), and the Owner handoff's seven confirmed loose ends against it.
Those loose ends are REQUIREMENTS here, each with a transition clause and a mutation row.

## 1 · Intent and boundary

Replace the circular cycle/window continuation model with one absolute terminal controller.
One gate round = one frozen candidate + the complete expected panel + all terminal receipts +
one aggregate PM disposition. A seat pass is never a round. Exactly one remediation batch may
cite a round; at most three batches per changeset; batch three is the terminal root
replacement, simplification, or split. After the terminal batch: exactly one final aggregate
bookend — GO closes, PM-accepted blocking harm records STOP, and neither state permits another
dispatch. Owner continuation is a typed, parent-linked successor changeset; it never resets or
rewrites the parent's lifetime count.

The controller proves candidate identity, panel completeness, durable PM partition, sequence,
batch consumption, and repair ownership. It never infers Rule #1, scope, severity, semantic
sameness, or PM judgment — those stay human declarations (`core/FOUNDATIONS.md` P2). The
records-not-deters residual (Owner-accepted) bounds every event's claim: no event asserts an
authorization boundary the mechanism does not provide. Threat model: cooperative-but-fallible
agents, not hostile evasion.

## 2 · Event grammar — one envelope, closed kinds

Every new event ships in the `type:"aggregate_v2"` envelope with a closed `kind`. The public
standard projection filters the envelope out (older readers fail closed on unknown types — the
PR #29 compatibility reader landed for exactly this); a separate aggregate projection validates
and derives it. The three historical names (`panel_close`, `evidence_rerun`,
`child_continuation` as bare types) stay replay-only forever. No second ledger, daemon, store,
or parallel authority.

Kinds (each totally shape-validated before ANY field dereference — loose end 4):

| kind | binds | authority it creates |
|---|---|---|
| `panel_open` | task · changeset · round · tier · frozen candidate manifest+digest · clean HEAD commit+tree · target ref + merge-base · complete changed-path set · complete expected seat roster {id, role, family, pass_type} | reserves the round; first ELIGIBLE open wins; membership authority — a close can never shrink it |
| `panel_close` | its `panel_open` event id · same candidate · received seat outcomes {id, role, family, pass_type, inspected_paths, verdict, finding_ids, artifact receipt+hash, packet_scope, pre_loaded (omission refuses)} | the round's review receipt — received set must EQUAL expected exactly |
| `aggregate_disposition` | one unused `panel_close` · complete disjoint FOUR-bucket partition of every seat AND PM finding id: **`accepted`** (blocking — declared relationship `changed-feature` \| `contract-invariant`, or Critical/fail-open; harm, mechanism, trigger) · **`followup`** (real, non-blocking, safely separable adjacent — each entry carries its routing INLINE: successor changeset or named backlog; this row IS the durable typed relation of § 8.4, embedded here because a separate event citing the GO would be a hash cycle in an append-only content-addressed ledger) · **`declined`** (false positive) · **`note`** · for NO-GO: the batch kind this round permits | GO (zero `accepted` ids; followups permitted and routed) or NO-GO (authorizes at most one batch) |
| `repair_dispatch` | exactly one accepted `aggregate_disposition` + its panel_close · candidate · next round · brief path+sha256+size · authorized exact paths · batch ordinal · for batch 3: the `root_cause_exit` event id | the batch — one per disposition, ever |
| `root_cause_exit` | the batch-3 disposition · shared mechanism · why prior fixes were symptoms · owner/state/yield seams · one replacement · removed workarounds · trigger matrix | unlocks only the batch-3 dispatch |
| `worker_verification` | dispatch event id · current candidate · session | admits ONE worker session to the authorized paths |
| `worker_handoff` | Owner evidence · the immutable dispatch · old session · new session | replaces the worker; revokes the old session in the same transition (D2) |
| `owner_close` + `program_close` | Owner evidence · current winning round/candidate · reason | abandons an ACTIVE program, releases paths, records STOP lineage — one atomic first-class transition (§ 8.1) |
| `successor_link` | parent task/changeset · parent TERMINAL state (GO or STOP) event id · parent candidate · continuation kind `split` \| `new_changeset` \| `material_scope` · complete child entries (split: 2–8 disjoint; else exactly one) · child scope/paths/tier/budget · Owner evidence · inherited absolute cadence baseline | lineage ONLY — no repair ownership, no verdict, no dispatch; the ONE successor mechanism (§ 8.3) |
| `legacy_handoff` | the CURRENT WINNING standard disposition/candidate/round (never a historical prefix — loose end 2) · one declared aggregate child | atomically ends the standard ownership and creates lineage — no unowned or double-owned interval (D4) |

Seat GO/NO-GO labels are evidence, never release authority. Family names are data, never
hardcoded brands. Tier policy is fixed by the controller at `panel_open`, never self-shrunk by a
caller: T2 = free seat + ≥2 distinct angle seats + one external role; T3 = free seat + ≥3
distinct angle seats + one external role. An Owner-authorized substitution keeps the functional
role and records replaced/actual family + decorrelation level + Owner evidence (D5).

## 3 · Transition table

States per (task, changeset): `unopened` → `open(r)` → `closed(r)` → `disposed(r)` →
[`dispatched(r)` → `open(r+1)` …] → `TERMINAL-GO` | `TERMINAL-STOP` | `ABANDONED`. Rounds are
absolute; refreeze changes the candidate, never the round count.

| # | From | Event | Guard (all mechanical) | To |
|---|---|---|---|---|
| T1 | `unopened` | `panel_open` r=1 | global task↔changeset identity unclaimed; **no ACTIVE program of EITHER grammar (standard or aggregate) owns any declared path**; changed paths derived from the immutable `base_commit..frozen_commit` pair — never live HEAD — and current HEAD/tree verified equal to the declared freeze before AND after evidence capture (loose end 5) | `open(1)` |
| T2 | `open(r)` | `panel_close` | cites its exact open; received seats ≡ expected exactly; every outcome complete; candidate unchanged | `closed(r)` |
| T3 | `open(r)` | rig failure, candidate bytes UNCHANGED | **a NON-EVENT by design — nothing is recorded**: the panel simply has not closed; the failed seat attempt reruns (§ 5). Recording it would be a second spelling of "nothing was consumed" | `open(r)` — rerun, consumes NOTHING (§ 8.2) |
| T3b | `open(r)` unclosed | `panel_open` r (REFREEZE) | the prior open's panel never closed AND the new open declares a DIFFERENT frozen candidate; first-wins per (round, candidate); the superseded open can no longer close. Cures mid-panel contamination without a batch: no disposition was reached, so nothing is consumed — and refreezing NEVER grants a batch or resets the round count, so a refreeze loop buys nothing | `open(r)` on the new candidate |
| T4 | `closed(r)` | `aggregate_disposition` GO | four-bucket partition complete + disjoint over every seat and PM finding id; zero `accepted` ids; every `followup` entry carries its routing | `TERMINAL-GO` (any round) |
| T5 | `closed(r)`, r ∈ 1,2 | `aggregate_disposition` NO-GO | accepted ids present; batch kind = bounded repair; changed-feature/contract-invariant harms block; Critical/fail-open always stops → T7 | `disposed(r)` |
| T6 | `closed(3)` | `aggregate_disposition` NO-GO | batch kind MUST be `root_replacement` \| `simplification` \| `split`; same-class or repair-generated recurrence may force this kind at r<3 | `disposed(3)` |
| T7 | `closed(r)` | disposition with accepted Critical/fail-open in a shipped control | records STOP | `TERMINAL-STOP` |
| T8 | `disposed(r)` | `repair_dispatch` batch b=r | first eligible wins; cites THAT disposition; b ≤ 3; batch 3 cites a valid `root_cause_exit`; every accepted finding of the disposition is in this ONE batch or explicitly split — dribble refuses (§ 8.2) | `dispatched(r)` |
| T9 | `dispatched(r)` | `worker_verification` | receipt + brief bytes intact; ONE session | worker owns exact paths |
| T10 | `dispatched(r)` | `panel_open` r+1 | new candidate from the batch; r+1 ≤ 4; round 4 phase = `final_bookend` | `open(r+1)` |
| T11 | `closed(4)` | bookend disposition | **total by construction**: zero `accepted` ids → `TERMINAL-GO` (followups routed as everywhere); ANY `accepted` id → `TERMINAL-STOP` — `accepted` means blocking-accepted, so no third case exists; NO batch kind is legal at r=4 | terminal |
| T11b | `disposed(3)` | `root_cause_exit` | cites the batch-3 disposition; shared mechanism + symptoms + seams + one replacement + removed workarounds + trigger matrix complete | `disposed(3)` — evidence recorded; enables T8's batch-3 dispatch |
| T11c | `dispatched(r)` | `worker_handoff` | Owner evidence; cites the immutable active dispatch + the prior worker's exact admission; new session ≠ old | `dispatched(r)` — replacement owns the paths, old session revoked in the same transition |
| T12 | any active | `owner_close`+`program_close` | Owner-attributed; session ∉ admitted workers; releases paths + STOP lineage atomically (§ 8.1) | `ABANDONED` |
| T13 | `TERMINAL-*` / `ABANDONED` | `successor_link` | parent terminal event cited exactly; GO-lineage-only import — a HOLD or non-terminal state cannot seed a child baseline; no lower baseline; absolute cadence inherited; children globally unique/disjoint | lineage row |
| T14 | `TERMINAL-*` / `ABANDONED` | ANY panel/disposition/dispatch row | **refused or inert — terminality dominates delayed events (loose end 3): a pre-terminal `panel_open` cannot close, disposition, or resurrect ownership after the terminal row wins** | unchanged |
| T15 | active standard program | `legacy_handoff` | binds the CURRENT winning standard state (loose end 2); atomic transfer; ordinary overlapping aggregate starts still refuse | standard ended, child lineage |

**Resolution order (loose end 1):** every write-authority query resolves the ACTIVE aggregate
program by task/session FIRST, and only then decides whether the target is in scope. An active
program's write to a path outside its authorized set REFUSES (`aggregate-path-unauthorized`);
it never falls through to legacy/non-repair behavior. `{ok:true, state:"not-repair-write"}` is
reachable only when the task has NO active program of either grammar.

**Lone worker (§ 7.4, stated, not rediscovered):** the terminal bookend (T11) needs no
counterpart session — a lone worker records its own terminal GO/STOP. Only the ABANDON path
(T12) requires a session distinct from every admitted worker; in degraded mode that is the
Owner's keyboard. The eligibility test compares supplied session ids — the ledger RECORDS, it
does not DETER (Owner-accepted residual); no event claims otherwise.

**Zoom-out (deletions taken):** no `evidence_rerun` kind — T3 makes a rig rerun a non-event on
an unchanged candidate, so recording it adds a second spelling of "nothing was consumed."
No standard-grammar minting: new Round-1 standard rows, standard dispatches, and later standard
rounds refuse — stored standard history stays replayable and closable. No time-based leases, no
retry queue, no semantic parser. `adherence_audit`/`owner_extension(rounds)` lose their unlock
role entirely (already inert since the fixed-round deletion) and are not re-minted in
aggregate_v2 — the batch cap is the cadence now.

## 4 · S1a — the subject-blindness truth-fix (§ 7.1, decided here)

The shipped relief claim ("no repair ledger can exist") is FALSE as worded — blindness is a
property of what the control can SEE, not of what can EXIST (LPB reproduction, 2026-08-21:
env-var-spoofed git location makes the control read a different subject while the real one
stands). **Decision: DENY, and ANNOUNCE the blindness — not detect it.** (a) The no-subject
relief stays available only on provable absence with unspoofed location (any `GIT_DIR`/
`GIT_COMMON_DIR`/`GIT_WORK_TREE` present ⇒ subject assumed present ⇒ deny path, as today);
(b) the relief state and its prose claim are renamed to say what is true — the control found
no subject IT CAN SEE; (c) the deny result carries the env-var names it observed when location
overrides forced the assumption, so the operator learns WHY without any new detection
machinery. No authorization-boundary claim is added anywhere (records-not-deters).

## 5 · Rig-vs-candidate discriminator (§ 8.5, codified)

Unchanged candidate bytes + repaired EXTERNAL environment (host, runner, transport, model
availability, output-format failure) = **rig**: rerun the same round free (T3). ANY change to a
fixture, assertion, packet, receipt binder, or evidence-producing script = **candidate-owned**:
the artifact changed, the repair consumes the batch (T8). A rig result invalidates a panel only
when it prevented or contaminated inspection of the bound candidate. Repeated rig-class harm
replaces or rejects the rig — a declared judgment, not an inferred one.

## 6 · Doctrine surfaces (instruction class, same changeset)

`core/WORKFLOW.md` § Gate — the circular-cadence paragraph is REPLACED by the terminal batch
model (three batches, terminal bookend, Owner-held successor); rounds-count-per-changeset and
Git-common controller paragraphs updated to the aggregate grammar. `skills/orchestrate/SKILL.md`
step 5, `PROTOCOLS.md` (the bounded-continuation bullet), `CHIP_BRIEF.md` § 5 (aggregate brief
declarations; test pins retargeted deliberately, sweep by CLAIM — § 7.2), `RUNG_ZERO.md` (the
MRR screening-sentence back-port — § 7.3: the FULL Precedence set cited, "a FINDING in those
classes never exits as a NOTE"). The design journal gains the supersession record so no repo
carries two live Owner rulings that disagree (ticket § 7). Generalization holds: no Owner
names, no model brands, no adopter paths, no incident-specific policy in shipped text.

## 7 · Adopter upgrade path (loose end 6, bounded)

The release changes portable controller, guard, recorder, doctrine, and orchestrate assets. A
plain `init` rerun keeping old files while exiting 0 is the defect. Shipped cure, KISS: the
release's upgrade rung — parity check extended so an adopter tree holding the OLD controller
grammar against a NEW kit reports drift as a FAILING check naming `--force` and the risk
(global overwrite, no backup, Codex hook re-trust required after changed hooks); the
installed-byte parity + real installed-execution rungs prove the claim both directions. Proof
obligation in tests: a plain rerun over an old install CANNOT silently claim the new
controller. Full adopter upgrades remain separate chips (LPB first, then MRR/PIL — Owner
sequencing).

## 8 · Mutation matrix — every row fails closed, proven red-then-green

Ticket-named six: **M1** seat-by-seat/incomplete closure (received ⊂ expected; a shrunk close)
→ refuse `aggregate-panel-incomplete`. **M2** two dispatches citing one disposition → second
inert `aggregate-batch-consumed`. **M3** fourth dispatch (any route: r4 batch kind, extra
NO-GO, split findings) → `aggregate-batches-exhausted`. **M4** count reset by refreeze /
task rename / new-scope relabel → candidate changes, round count survives; relabel refuses
`aggregate-identity-conflict`. **M5** post-bookend dispatch (after GO, STOP, or close) →
`aggregate-terminal` (T14). **M6** unlinked successor (missing parent terminal id, candidate,
Owner evidence, tier, or budget) → `aggregate-successor-unlinked`, inert.

Loose ends: **M7** active program, write to an out-of-scope path → refuses; never
`not-repair-write` (LE1). **M8** a `legacy_handoff` row citing a stale standard round while a
newer round is the current winner is INERT on replay; the RECORDER derives the current winning
disposition itself and stamps that — callers never mint trusted pointers, so a stale citation
cannot even be handed in. Activeness is enforced at record time; on replay the binding is the
latest ROUND row, so a post-handoff Owner close of the emptied standard program does not
retroactively unmake the child's lineage (LE2). **M9** pre-terminal panel closing after Owner close /
terminal row → inert; ownership stays released (LE3). **M10** every aggregate kind × each
authority field {missing, null, wrong-type, non-array} → typed refusal, no throw (LE4;
TypeError = red). **M11** HEAD moved between identity and evidence capture → open refuses;
no permanently reserved unusable panel (LE5). **M12** plain init rerun over old install →
failing parity naming `--force` (LE6).

§ 8 requirements: **M13** rig-invalid panel on unchanged candidate consumes nothing; same
repair with a changed fixture consumes the batch (§ 8.2/8.5, both directions). **M14** a
disposition leaving one accepted finding unbatched and unsplit → refuse (dribble, § 8.2).
**M15** successor importing from a non-terminal/HOLD lineage, or declaring a lower baseline →
refuse (§ 8.3). **M16** a `followup` entry lacking its inline routing, or a finding id missing
from all four buckets, or in two → disposition refuses (§ 8.4 — the followup row IS the durable
relation, so an unrouted or unpartitioned adjacent cannot silently survive a GO). **M23** an
unclosed panel superseded by a refreeze open at the same round: the new open works and consumes
nothing; the SUPERSEDED open's close now refuses; a third refreeze still grants no batch and no
round reset (T3b). **M17** replay of LPB-mapped 12-round
and MRR-mapped 20-round histories → each STOPS at the terminal bookend, prior rows preserved,
no continuation granted; fixtures assert TERMINATION, never batch composition (§ 8.6).

Regression rows from the experimental dispositions: **M18** empty seat set + one PM-accepted
blocker → STOP, never GO (D1). **M19** dead worker + Owner `worker_handoff` → replacement owns
paths, old session revoked; same handoff without Owner evidence refuses (D2). **M20** declared
two-child split admits both exact children, refuses an undeclared third (D3). **M21**
authorized family substitution closes; the same mismatch without its receipt refuses (D5).
**M22** disabled-arm control per accepted mechanism (panel completeness, partition
completeness, third-batch kind, terminal denial, first-winner filtering, resolution order,
terminality dominance): each arm off ⇒ its original trigger goes red.

Preserved behavior (characterization, not mutation): unknown/hash-corrupt rows fail the ledger
closed; well-shaped wrong references stay inert; replay-only legacy history; linked-worktree
Git-common resolution; unrelated-path availability for other tasks; first-wins adjudication
with idempotent identical retries.

## 8b · Design-lens round (pre-code, cross-family)

`GATE ROUND design-1 · changeset terminal-round-breaker · verdict NO-GO · HARM-PASSING 5 ·
NOTES 0` — Gemini design lens on this artifact, 2026-08-24 (receipt in
`docs/journal/gemini_review_log.md`). All five REMEDIATE, folded into this contract before any
code: (1) BLOCKER — `separate_successor_finding` citing the GO disposition was a content-hash
cycle (unconstructible in an append-only hashed ledger) → deleted the kind; routing embedded in
the disposition's `followup` bucket. **HARM:** TERMINAL-GO unreachable whenever an adjacent
finding exists. **TRIGGER:** any GO with a routed adjacent. (2) BLOCKER — `root_cause_exit` /
`worker_handoff` had no transition rows and T3 implied vocabulary that did not exist → T11b,
T11c added; T3 restated as a deliberate non-event. (3) HIGH — mid-panel candidate contamination
deadlocked `open(r)` forever → T3b refreeze-supersede. (4) HIGH — R4 orphaned a non-blocking
accepted harm → resolved by bucket semantics (`accepted` = blocking; adjacents are `followup`),
making T11 total. (5) MEDIUM — T1 checked only standard-program overlap → both grammars.
`LADDER: continue.`

## 8c · Neighbourhood sweep — mechanical half, and the stated limit

The cadence's cross-surface agreement is pinned MECHANICALLY: `tests/gating-doctrine.test.mjs`
and `tests/orchestrate-skill.test.mjs` assert the same finite-cadence tokens across
`core/WORKFLOW.md`, the skill layer, and the guard's CONTRACT text — my R3-kind amendment turned
all three red until every spelling agreed, which is the sweep working as a control rather than a
ceremony. **The limit, stated:** surfaces this changeset does NOT edit stay hand-synchronised —
the user-level `~/.claude/skills/orchestrate` copy (its header documents its deliberate
divergences and the re-apply obligation) and every adopter repo (their upgrades are the separate
sequenced chips: Peripheral Brain first, then PIL).

## 9 · Acceptance

Focused controller tests + the matrix above (each mutation exercised red-then-green) + replay
fixtures + full `npm test` + `npm run acceptance` + doc-size/skill budgets + installation/sync
parity + the real installed-package rung when available. Raw-look every zero/clean result.
Freeze once; complete T3 instruction/control panel (free seat + ≥3 angles + both cross-family
families per `core/WORKFLOW.md` § Steer; adversarial walk-through — this IS gate machinery);
all seats collected before any repair; accepted harms batched ONCE. The new rule is not used to
excuse its own gate. Owner boundaries unchanged: tier already ratified; core-doc wording
sign-off; push/merge GO on the exact frozen SHA. No push, release, adopter upgrade, or
user-install mutation inside the changeset.
