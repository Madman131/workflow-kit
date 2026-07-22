# core/ — the canonical method set

> **CLASS: REFERENCE (lookup-only).** **Kit v1.0.** A **map for a human**, or for an agent that lands
> in this folder without going through the root entry stub. It is **not** an instruction to read
> everything here — doing that re-creates the exact failure this layout fixes (a large corpus
> half-read and silently half-applied). **The read is STAGED — see below.**

## Contents
- [Do NOT "read everything in core/"](#do-not-read-everything-in-core) — the staged read
- [The layer model](#the-layer-model) — ENTRY · METHOD · BINDINGS · STATE
- [The files](#the-files) — what each doc carries, its class, and whether it is portable
- [The pipeline](#the-pipeline) — the whole method as one line
- [Size discipline](#size-discipline) — how the caps work and why they key on access pattern
- [Versioning and dating](#versioning-and-dating) — version the method, date the state
- [Provenance](#provenance) — what this set was consolidated from

## Do NOT "read everything in core/"

1. `CLAUDE.md` / `AGENTS.md` **auto-load** at the repo root. You point at nothing.
2. The stub names the **boot set**: `WORKFLOW.md` → `REVIEW.md` → `OPERATE.md` → `BINDINGS.md` →
   `SYSTEM_MAP.md`. Each is individually under the single-read limit; read them whole.
3. Everything else loads **only when relevant**: `GATES.md` when a gate actually runs, `LANES.md`
   when you choose to use a lane. `INVARIANTS.md` + `REPO_INVARIANTS.md` are shipped to the
   **reviewer** by the gate runner and are never read by the builder at all.

## The layer model

Four layers, distinguished by **change rate** and **audience**. Mixing them is what let every
unbounded doc grow.

| Layer | Files | Change rate | Read by |
|---|---|---|---|
| **ENTRY** | `CLAUDE.md` · `AGENTS.md` (repo ROOT — pinned) | rare | each agent at boot (per-reader twins) |
| **METHOD** (portable) | `WORKFLOW.md` · `REVIEW.md` · `OPERATE.md` → `GATES.md` · `LANES.md` · `INVARIANTS.md` | rare | boot (first three) · on-demand · **machine** (INVARIANTS) |
| **BINDINGS** (repo) | `BINDINGS.md` · `REPO_INVARIANTS.md` | occasional | boot · machine |
| **STATE** | `SYSTEM_MAP.md` (regenerated snapshot) · `docs/PIL_ARCHITECTURE.md` (deep, REFERENCE) · `docs/open_work_current_state.md` (CLASS: STATE head) · `docs/journal/` (append-only) · memory | constant | **boot** (SYSTEM_MAP) · on demand (rest) |

Dependencies run one way: **ENTRY → METHOD + BINDINGS + STATE.** The rule that keeps every file
bounded: **STATE never contains method · METHOD never contains repo facts · history never lives in a
current-state doc.** Every overflow is a violation of one of those three.

## The files

| File | Class | Portable? | What it carries |
|---|---|---|---|
| `WORKFLOW.md` | BINDING | `[P]` | Principles · Roles · **Steer** (classify) · **Gate** (the ladder, PM dispositions, 3-round stop, shipping) |
| `REVIEW.md` | BINDING | `[P]` | cold-review payload contract · decorrelation · cross-family lens · external gate · artifact-class review physics |
| `OPERATE.md` | BINDING | `[P]` | execution protocol · **delegation** (Gather / Review / Author) · Garden · Invariants · end-of-work closeout · working norms · multi-writer staging · lane binding facts · **onboarding a new model** |
| `BINDINGS.md` | BINDING | `[G]` | roles→models · Codex-as-Builder · compute-weather · tool bindings · read-order · gates/deploy/data · access · known gaps |
| `INVARIANTS.md` | BINDING | `[P]` | epistemic rules + portable invariants + failure classes. **MACHINE PAYLOAD** |
| `REPO_INVARIANTS.md` | BINDING | `[G]` | this repo's concrete invariants + word budgets. **MACHINE PAYLOAD** |
| `GATES.md` | REFERENCE | `[P]` | gate contract · routing · model·effort matrix · Codex + Gemini tool manuals |
| `LANES.md` | REFERENCE | `[P]` | optional build lanes (the cost-inversion lane procedure) |
| `SYSTEM_MAP.md` | BINDING | `[G]` | the bounded, `as-of`-dated **architecture snapshot** — the boot-set map over `docs/PIL_ARCHITECTURE.md` (REFERENCE, deep). Regenerated on architectural change; **snapshot** role (8 KiB). |

`[P]` portable — copies verbatim to another repo. `[G]` generated per-repo — **never copied.**

**Pinned paths that CANNOT move into `core/`** (harnesses look for these exact locations):
`CLAUDE.md` and `AGENTS.md` at the repo root (Claude Code auto-loads one; Codex reads the other —
moving them breaks the method read **invisibly**: nothing errors, the agent simply never reads it) ·
`.claude/hooks/` (the harness only fires hooks from there) · `scripts/` (named by path in allow-rules
and in `GATES.md`) · `docs/journal/` (append-only history).

## The pipeline

The whole method as one line, for orientation — each stage is a section in the METHOD files above.

**Pipeline (the map):** classify (Builder proposes → Owner ratifies) → **code gate** for tier (T0 self-check · T1 cold · T2/T3 cold-panel → cross-family capstone[if avail] → external) → **frontier PM dispositions findings** (remediate · defer · decline · escalate) **+ Owner push-GO for any code push** → if it runs a prod write, **execution protocol** (named-GO → preflight → one-step → verify → success-exit / fail-branch) → **Garden** (update memory + docs; ledger/remediation where adopted).

## Size discipline

Caps key on **access pattern**, not on size. A doc that must be read **whole** costs its full length
every time it is read; a doc you *query* costs only the section you land on. So each file **declares
its class in a marker on line 3**, and `scripts/check-doc-size.mjs` reads that marker:

- **BINDING** — read whole; missing a section means violating a rule → **capped BY ROLE**, each
  number derived from the tightest surface that must read that doc whole:

  | Role | Docs | Cap | Derived from |
  |---|---|---|---|
  | **entry** | `CLAUDE.md` · `AGENTS.md` | **8 KiB** | read at the start of every session |
  | **method** | `WORKFLOW` · `REVIEW` · `OPERATE` · `BINDINGS` | **20 KiB** | the boot budget (~72 KB / ~27K tokens) |
  | **payload** | `INVARIANTS` · `REPO_INVARIANTS` | **8 KiB** | the Gemini 80 KiB INLINE ceiling + signal-to-noise |
  | **snapshot** | `SYSTEM_MAP.md` | **8 KiB** | a boot-read architecture snapshot; keep it tight so boot stays cheap |

  A newly added `core/*.md` defaults to **method** — capped, never uncapped by omission.
- **STATE** — a regenerated current-state head (`docs/open_work_current_state.md`): structurally
  validated (it must declare its class and exist — fail-closed), but its **size is ADVISORY** (a WARN
  at 40 KiB, never a hard cap — a current-state doc legitimately grows between regenerations).
- **REFERENCE** — looked up; missing a section just means you look it up later → **no size cap**, but
  it must carry a lookup-only marker, stable headings, and a table of contents.

**The test: if missing a section would make you violate a rule, it is BINDING.** *"It's just
reference"* is exactly the excuse that lets a binding doc grow unchecked — the class is **declared**,
never inferred, and an undeclared file **fails the check** rather than being skipped.

**A cap may never force deleting doctrine.** If honest consolidation lands over budget, split at a
concept seam and record the split, or push detail to `docs/journal/` — never cut a rule to hit a
number.

**What 20 KiB is, and is NOT — measured 2026-07-18, full data in
`docs/journal/read_limit_measurements.md`.** It is **not** a truncation threshold. The `Read` tool's
real cap is **25,000 TOKENS**, which for this prose class (~2.64 bytes/token) is ≈ **66 KB** — so the
cap carries ~3× headroom. Bytes do not predict truncation at all: a 48,913 B file read whole in the
same probe where a 32,724 B file truncated. There is no line-count cap. And truncation is
**ANNOUNCED**, not silent — the notice states shown/total lines, the token count, the cap, and the
exact `offset` to continue.

So the cap exists for two *other* reasons, and they are the ones to weigh before changing it:
- **Boot budget.** The boot set is ~72 KB ≈ 27K tokens spent before any work starts. That is the cost
  the cap actually controls.
- **Attention.** An instruction artifact is run by an interpreter whose attention degrades with length
  (§ Artifact-class review physics). Fitting in one read is not the same as being read well.

**The tightest reader wins, and it is not always `Read`.** `INVARIANTS.md` + `REPO_INVARIANTS.md` are
cat'd into the Gemini gate payload, whose INLINE ceiling is **80 KiB for the whole payload**. Today
they use 14% of it; at the 20 KiB cap they would use 50% before any diff. **Their real budget comes
from that ceiling, not from this cap** — treat 20 KiB as an upper bound they should stay far below.

## Versioning and dating

- `WORKFLOW.md` · `REVIEW.md` · `OPERATE.md` · `GATES.md` · `LANES.md` · `INVARIANTS.md` · this file
  carry a **kit version** (`v1.0`), no date. A date on a contract invites *"is this still true?"*; a
  version says **current until superseded**, and lets a consuming repo pin and diff.
- `BINDINGS.md` and `REPO_INVARIANTS.md` carry a version **+ a `last-verified` date** — they make
  falsifiable claims about the environment that rot silently.
- `docs/journal/` is inherently dated (append-only by construction).

## Provenance
Consolidated 2026-07-18 (Workflow v2 Phase 2) from `docs/COLLABORATION_FRAMEWORK.md`,
`docs/COLLABORATION_FRAMEWORK_CODEX.md`, `docs/CODEX_GATE_PROTOCOL.md`,
`docs/GEMINI_GATE_PROTOCOL.md`, `docs/REVIEW_INVARIANTS.md`, `docs/COST_INVERSION_LANE.md`, and the
staging rules from `AGENTS.md`. Header-by-header destination map:
`docs/journal/workflow_v2_phase2_section_inventory.md`. Plan: `docs/journal/workflow_v2_blueprint.md`.
