# PORTABILITY — what the kit binds, and what it does not

> Read this before you rely on any control. A kit that is *believed* to enforce something it does not
> is worse than no kit — it manufactures assurance (`core/INVARIANTS.md` epistemic rules 2 & 10).

## The enforcement asymmetry (the load-bearing caveat)

The three guard hooks are **Claude Code `PreToolUse` registrations** in `.claude/settings.json`,
invoked by the **Claude Code harness**. A Codex / non-Claude agent — and a human with an editor —
never loads that hook system.

| Control | Claude Code lane | Codex / other agent | Human by hand |
|---|---|---|---|
| `guard-cross-repo-writes` (writes outside repo blocked) | **enforced** | not enforced | not enforced |
| `guard-lane-authoring` (declaration before a code write) | **enforced** | not enforced | not enforced |
| `guard-gate-ladder` (surfaces the tier's ladder; sensor) | **enforced** | not enforced | not enforced |
| `.githooks/pre-commit` (declaration + scope, at commit) | **enforced** | **enforced** | **enforced** |

**What binds every lane** is (1) **prose** — `AGENTS.md` + `core/*` + the required PM-disposition
emission, which a cooperative agent follows — and (2) the **`pre-commit` hook**, the one deterministic
layer no harness routes around, because *all* writers (Claude Write/Edit, Claude Bash redirection,
Codex, a human editor) converge at the commit. So a non-Claude PM gets the same **judgment** from the
method but a **weaker enforcement floor**: it is caught at the commit, not at the write.

This is why `init` installs the harness-agnostic `pre-commit` hook and sets `core.hooksPath`, not just
the Claude PreToolUse hooks. Do not tell your team the PreToolUse guards protect a Codex lane. They
do not.

### FM1 — the pre-commit hook fails OPEN on a fresh clone unless configured

`core.hooksPath` is **local git config, not tracked**. A fresh clone, a new worktree, or a CI checkout
has no hooks configured **and no error** — the control is silently absent, in exactly the state a new
contributor starts from. Mitigations, both shipped:
- `init` runs `git config core.hooksPath .githooks` at adoption.
- `init` installs `tests/kit-precommit.test.mjs` into your repo; it asserts `core.hooksPath` resolves
  to the tracked `.githooks` directory (and the hook exists + is executable), so an unconfigured clone
  goes **RED** on your standing mechanical gate rather than silently unguarded. **Wire
  `test:kit-controls` (`node --test tests/*.test.mjs`) into CI** — that is what makes FM1 loud.

`--no-verify` bypasses the pre-commit hook, exactly as the PreToolUse guards are bypassable. That is an
accepted class: gates are **seatbelts for cooperative-but-fallible agents, not intrusion detection**
(`core/WORKFLOW.md` § threat-model calibration). What the hook buys is that *forgetting* is caught
while *deliberately overriding* is a visible, deliberate act.

## Cosmetic origin naming in the gate runners (`--with-gate-runners`)

The Codex/Gemini gate runners are copied **verbatim** and are functionally repo-agnostic (the repo is
passed via `-C` / cwd). Two names still carry the origin repo's prefix and are **functionally inert**
(they are an env-var name and a git-ref namespace, not a path — they work identically in any repo):
- env var `PIL_BLOCK_CLAUDE_COMPANION` / `PIL_GUARD_HIT_FILE` (in `codex-gate.sh` + its guard shim),
- git ref namespace `refs/pil/gate-artifacts/*` (in `cold-review-gemini.sh` + `gemini-gate-slices.mjs`).

They are **not renamed in v1.0** (renaming would churn the selftests that assert the exact strings for
no behavioral gain — bounded > tidy). A later version may neutralize the prefix.

## External tool dependencies (only if you use the shipped runners)

The gate runners are optional (`init --with-gate-runners`). They need tools you provide:
- `codex-gate.sh` → the `codex` CLI (a ChatGPT-subscription session).
- `cold-review-gemini.sh` → the `agy` CLI (an Antigravity / Google AI Pro session).

Their **selftests are NOT wired into the kit's default `test:kit-controls`** (they need those tools or
their fakes). If you gate by hand instead, record that in `core/BINDINGS.md § Tool bindings` and treat
`core/GATES.md` as the doctrine (freeze the artifact · require a verdict not just a receipt · exit 3 is
never a pass) rather than a script you must run.

## What is portable verbatim vs generated

- `[P]` (verbatim): `core/*` method docs, the three hooks, `pre-commit`, `check-doc-size.mjs`,
  `settings.json`, the gate runners.
- `[G]` (generated per repo, never copied): `CLAUDE.md`, `AGENTS.md`, `core/BINDINGS.md`,
  `core/REPO_INVARIANTS.md`, `core/SYSTEM_MAP.md`, `.claude/kit.config.json`.

Copying one repo's `[G]` files into another re-creates the cross-repo confusion the identity
fingerprint exists to prevent. `init` generates them; you never copy them.
