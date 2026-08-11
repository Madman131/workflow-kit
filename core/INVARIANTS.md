# INVARIANTS — the standing checklist every cold review checks an artifact against

> **CLASS: BINDING** · **Kit v1.0** (portable — contains no repo-specific fact by design).
>
> **This file is MACHINE PAYLOAD.** The gate runner cats it into *every* reviewer payload, so its
> size is a recurring per-gate token cost and anything repo-specific in it pollutes the reviewer's
> context. Keep it short and high-signal. Add a line only when a *new class* of real failure gets
> through a gate. The repo's own concrete invariants ship alongside it from `core/REPO_INVARIANTS.md`.

## How to use this
Read the artifact (diff, full changed files, and design context when provided) and ask, per hunk:
*does this violate a rule below, or contradict the stated design?* Report confirmed violations with
`file:line` + the confirming check. **Abstain over guessing — a confident wrong finding is the worst
outcome.** You are checking these, not hunting generic bugs.

## Epistemic rules — how to know a check is real
*These govern the reviewer's own reasoning. Most were learned by a control failing silently.*

1. **A control must DISCRIMINATE.** Plant the bug the control claims to catch and watch it go red. A
   check never observed failing when it should is **vacuous** — it proves nothing about the run that
   passed. "It passed" is evidence only if failing was possible.
2. **A prompt is not a control.** A stated policy is unenforced until a deterministic layer checks
   it. Make outputs *checkable* — an id, an enum, a receipt — not merely labelled. Instructions
   restrain a cooperative agent; they do not bind one that drifts.
3. **A canary proves ONE leg.** Find where the probe actually **returns**; everything downstream of
   that point is unproven. A generic canary proves nothing about a *named* risk — the canary must be
   **risk-isomorphic** (the named failure, on the same ingress/egress path). A backstop that shares
   the risk's path is not a backstop.
4. **Silence is not success — but a RECORDED failure is not silence.** Absence of an alarm may mean
   the alarm is dark. Conversely, do not relabel a captured, typed failure as "probably fine."
5. **Cannot read your input ⇒ ABSTAIN, never green.** A verifier that cannot see the artifact
   returns "unknown", never "pass". **Fail closed**: no verdict = no pass; a timeout = no pass.
6. **Freeze the artifact before gating.** Reviewers judge a pinned revision, not a moving tree. A
   tree edited mid-review produced two real false verdicts. Run controls on a scratch copy.
7. **Never gate on your own advocacy.** Review the raw artifact adversarially. A ticket of "what I
   verified / cases I pinned" is correlated framing and yields confident-wrong clears. Verify that a
   claimed mitigation actually mitigates — trace it through the real code.
8. **Verify against the CODE, not a grep.** A literal that appears absent may be applied via
   interpolation or indirection (and vice versa). Refute a finding against the construct that
   executes, not against a text search.
9. **Check REACHABILITY before hardening.** Ask first whether the code is live/imported at all. Dead
   code should be deleted, not hardened — hardening it manufactures assurance.
10. **A dormant control is worse than no control.** It manufactures assurance while binding nothing.
    Verify a check runs on the path work actually ships on.
11. **Scope-gated tests miss cross-file breakage.** A diff-scoped gate cannot see what a change broke
    elsewhere; the full suite is the check that does.

## Non-negotiable invariants — an artifact MUST NOT violate these

1. **Intelligence-ordering (the librarian rule).** A lower layer (deterministic code OR a cheaper
   model) may locate / classify / verify-invariants / enforce-safety-bounds / surface-options — it
   MUST NOT decide the substance for, or cap, a higher-intelligence consumer downstream. A backend
   label is an advisory input the frontier model can override, never binding. Sharp line: enforce a
   mechanical invariant — yes; make the semantic decision — no.
2. **Exact provenance / no fabricated answers.** Every derived label maps EXACTLY to its source or is
   NULL — never guessed or fuzzy. When a classifier cannot tell, abstain (indeterminate); never force
   a confident wrong label.
3. **Boolean config reads use explicit string compare** (`=== "true"` / `=== "false"`), NEVER
   truthiness. Where flags are toggled rather than deleted, the string `"false"` is truthy → a stuck
   switch. Any `if (process.env.X)` on a flag is a bug.
4. **Deploy-order safety.** Code — including a mechanical gate itself — must not assume a migration,
   column, or flag created by a step that runs *after* the deploy. Guard it or flag-gate it.
5. **Contract / additive safety.** A change to an output shape a consumer caches must be ADDITIVE (a
   new field), never a breaking flip. Authoritative source-of-truth fields stay authoritative — never
   rendered from a derived copy.
6. **Fail closed.** Undeclared, malformed, stale, or unreadable input to a control ⇒ BLOCK, never
   proceed. Never fail open to the most permissive state.

## Failure classes that have actually gotten through a gate — hunt these
- **Contract-vs-design drift:** the diff looks fine in isolation but violates the *stated design
  intent*. Always check the diff against the design/acceptance context when one is provided.
- **Deploy-order / flag-gating:** a new column or flag referenced by live code before the step that
  creates it; a comment or code documenting an unsafe migrate↔flag↔backfill order.
- **Ordering / precedence bugs:** a `CASE` whose precedence masks "pointer resolves to nothing"
  behind a mere "content changed" (order the gone-kinds first); inner joins that silently drop
  source-gone rows (must be LEFT); naive `<>` instead of NULL-safe `IS DISTINCT FROM`.
- **Idempotency / partial-failure:** a re-run double-inserts; a skip-check that tests "has any rows"
  instead of "count == expected" (the partial-crash trap); a non-transactional multi-step write that
  leaves orphans.
- **Arg-order footguns** at call sites — a self-contained class a cross-family lens catches well.
- **False-FAIL checks** on legitimate data (e.g. a zero-length list the check assumes is non-empty) —
  these train the reader to ignore the control.
- **Over-abort orphaning state:** a per-item failure that aborts the whole batch, leaving a
  bookkeeping table claiming work is in flight forever. Per-item try/catch + always-finish.
