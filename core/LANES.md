# LANES — optional build lanes

> **CLASS: REFERENCE (lookup-only).** **Kit v1.0** (portable). Consult a lane when you choose to run
> it; you are never obliged to. The **binding** facts about each lane — when it is permitted, what
> voids it, and what still gates it — are stated in `core/OPERATE.md`; this file is the procedure.
>
> A lane never lowers a tier, never replaces a mandated gate, and never changes push rules.

## Contents
- [The cost-inversion lane](#the-cost-inversion-lane--cheaper-model-as-builder-for-t0t1) — a cheaper
  model authors spec-able T0/T1 work from a falsifiable ticket; the frontier thread owns the diff.

## The cost-inversion lane — cheaper-model-as-Builder for T0/T1


> **⚠ RETIRED MECHANISM (2026-07-18, Workflow v2 Phase 1):** the gate-manifest verifier was
> **DELETED**. **Do not produce a verdict manifest** — every reference to one below is retired.
> **Still binding:** `.claude/hooks/guard-lane-authoring.mjs` is untouched and continues to enforce
> the declaration and the `scripts/**`+`tests/**` path restriction, so the lane keeps its *authoring*
> tripwire. What is lost is the *release-side* mechanical check: the boundary is now full `npm test`
> green · the normal tier ladder · Owner push-GO, and the "gate-family ∉ contributing-families"
> spot-check becomes a PM/Owner judgement. Rationale: `core/GATES.md` § "Retired: the
> gate-manifest verifier".

### When the lane applies
Spec-able T0/T1 tasks only — work whose mechanism can be written as a falsifiable ticket before
coding. **Eligibility screen (deterministic):** the ticket's allowed-file list must not touch the
live-behavior path or chain/stateful set and is mechanically limited to the lane-eligible globs
declared in `core/BINDINGS.md`; any other path or risk-token hit ⇒ lane-INELIGIBLE. A mis-tier
discovered mid-task STOPS the lane — re-classify and restart the required gates. Using the lane is an allowance, never a mandate: solo
in-thread authoring of T0/T1 remains legitimate (declare `in-thread` if the hook asks — see
Enforcement; the declaration names the tier but needs no additional tier justification).

### The five steps
1. **Ticket (frontier thread).** Falsifiable mechanism + hard constraints + an explicit
   allowed-file list + "do not stage or commit" + a demanded final summary (files touched, test
   result, deviations). The ticket is the reviewer's contract later — write it as one.
2. **Build (cheap builder).** Workspace sandbox, **explicit model + effort per `core/BINDINGS.md`**
   (escalate **effort before model**; the cheapest tier only for trivial mechanical sweeps, never as
   standing default: its marginal saving is smaller than one bounce). The repo agent-rules file
   binds the builder automatically.
3. **Whole-diff read (frontier thread).** Read every changed file raw; fix directly. **Emit a
   per-file disposition record** — `file → read+accepted | read+fixed(what)` — into the task's
   journal entry. The record is the checkable artifact that distinguishes a real read from a skim;
   **no record ⇒ the lane is void** and the task re-gates as ordinary work.
4. **Blind cold pass (final tree).** Via the gate runner (`core/GATES.md`) on the post-fix tree.
   **Reviewer model ≥ builder's model AND effort ≥ the review floor; the cheapest tier never reviews.** Warm `--resume`
   delta rounds are for fix-deltas of THIS changeset only — they count toward the 3-round ladder
   cap, and a reviewer thread never spans changesets. A contested verdict escalates as a folded
   adjudication to `sol` per the model matrix.
5. **Mechanical close.** Full `npm test` (never diff-scoped); the tier's normal push rules — any
   push containing code needs the Owner push-GO.

### Gate bookkeeping
The step-4 seat is **recorded reduced (same-family)** — Codex reviews Codex-built code. This is
sanctioned at T0/T1 by Owner ruling (2026-07-16): same-family cold review is the ladder's own spine;
the "Codex can't gate itself" restriction binds the T2/T3 *independent cross-family* seat, and P3's
full-independent hard floor binds *critical* gates — a lane T0/T1 verdict is neither. Coverage =
reduced Codex seat + the step-3 cross-family diff-read + `npm test`, with Owner touchpoints at the
ledger spot-check and the push-GO. **No verdict manifest is produced (RETIRED 2026-07-18); the
standing "gate-family ∉ contributing-families" spot-check is a PM/Owner judgement, not a mechanical
one.**

### Enforcement (the tripwire)
A **PreToolUse hook** gates main-thread Write/Edit source and config
paths; docs/memory and the declaration files are excluded. A fresh **task-lane declaration** must bind
the hook's session id plus a kebab task id and declare exactly one route:
`{mode:"lane", sessionId, taskId, allowedFiles:[...]}` ·
`{mode:"in-thread", sessionId, taskId, tier:"T0".."T3"}` ·
`{mode:"exempt", sessionId, taskId, reason:"codex-down"|"codex-quota"|"trivial-edit"}`.
Undeclared, malformed, stale (default ~24h), session-mismatched, or out-of-scope ⇒ **BLOCK** with
exact remediation. `lane` rejects every path outside the declared lane-eligible globs plus named
live/stateful script families, case-insensitively. **The hook's own `lane` path restriction is now the
only mechanical boundary** (the manifest verifier that shared it was deleted 2026-07-18).
It never classifies semantics (IO: it enforces the declaration). Every decision
appends its exact path, normalized scope, and canonical declaration hash with an append+sync write to
a gitignored lane ledger; concurrent processes may duplicate a row but cannot
replace another process's row. Symlink traversal and ledger failure block, so an exemption cannot
proceed unlogged. The Builder writes the declaration — zero Owner friction.
*(Concrete hook, declaration, ledger, and lane-eligible glob paths: `core/BINDINGS.md`.)*

### Escapes (first-class)
**`codex-down` / `codex-quota`:** the whole lane exempts — build solo in-thread, run the T0/T1 cold
pass same-family (Claude) per the framework's substitution rule, log the exemption. Work never
stalls on an unavailable builder or reviewer. **`trivial-edit`:** small in-conversation fixes skip
lane ceremony, logged. No free-text exemption is accepted; every escape has a synced local ledger row.

### Interactions
Under a declared **compute-weather `codex-heavy`** flip, the CODEX-Builder binding governs the whole
ladder and this lane is **suspended** (its economics are moot when Codex is already the workhorse).
The lane never applies to core-document amendments (those keep the core-doc gate shape).

### Kill-criterion
Each lane task journals: builder model·effort, principal fix count, cold-pass findings, and a bounce
grade (`none` = bounded fixes · `partial` = one component redone · `full` = principal rewrote it).
A bounce rate that erodes the savings (guideline: ≥1 `full` in any 4 consecutive tasks, or `partial`
in half) retires the lane — record the retirement in the framework, keep this doc as history.
