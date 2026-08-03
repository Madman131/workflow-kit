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
| `.githooks/pre-commit` (declaration, at commit) | **enforced** | **enforced** | **enforced** |
| `guard-owner-comms` (Stop; comms nudge) — **sensor, fails OPEN** | *nudge only* | not present | not present |

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
(`core/FOUNDATIONS.md` § Principles, Threat-model calibration). What the hook buys is that *forgetting* is caught
while *deliberately overriding* is a visible, deliberate act.

## The `/thread-restart` dual-harness asset (v1.1)

`/thread-restart` is the kit's **reference implementation of the dual-harness pattern**: a portable
*method* wrapped in per-harness *plumbing*. The method — index-don't-duplicate · a mandatory
VERIFY-before-finalize pass · drop-operational-noise — is the load-bearing part and is the **same in
both assets**, lightly adapted per harness in wording (memory nouns like *in-thread* vs
*in-conversation*, the example identifier sets, and a Claude-only fresh-session spawn offer) plus the
restart verb; `init` installs each asset **verbatim** (`copyFileSync`, no per-repo rewrite).

| | Claude command | Codex prompt |
|---|---|---|
| Source (`[P]`) | `commands/claude/thread-restart.md` | `commands/codex/thread-restart.md` |
| Installs to | `.claude/commands/thread-restart.md` (repo-local) | your Codex prompts dir (`~/.codex/prompts/` default) |
| Wrapper | YAML frontmatter + `$ARGUMENTS` | plain markdown, no frontmatter |
| Restart verb | user runs `/clear` | user runs `/new` (or relaunches `codex`) |

Beyond the wrapper and restart verb, the differences are wording only — the five digest sections and the
three load-bearing rules are present in both.

**Why dual-shipped rather than one asset.** Slash-command plumbing is harness-specific — a Claude
command is not a Codex prompt — but the digest METHOD is not. Shipping one asset strands the other
harness; re-deriving the method per harness lets the two drift. So the method lives as one file per
harness, kept in lockstep (same sections, same load-bearing rules) and adapted only in wording, never
re-derived, and each ships verbatim. The one literally single-sourced piece is the **`AGENTS.md`
fallback pointer** (`commands/agents-pointer.md`, appended idempotently by `init`) — the third leg: it
points any lane at the repo-local `.claude/commands/thread-restart.md`, which is plain markdown a Codex /
non-Claude agent can READ and follow even where custom slash-commands are unsupported.

**It is a productivity NUDGE, not a control.** It ships no enforcement and has no fail-closed behavior,
so — unlike every control in the table above — it carries **no planted-bug proof**. What the acceptance
suite gates is the **`init` wiring**: the three assets land in the right places, are syntactically
valid, the method text is present verbatim, and a re-run is idempotent (no clobber, no duplicate
pointer). `--codex-prompts-dir` keeps that run hermetic — the Codex prompt is user-global, *outside* the
repo, so the acceptance harness points it at a scratch dir and never touches a real `~/.codex/prompts`.

**Honest limit — no agent resets its own context.** The command produces the verified digest and the
one-line restart seed (`"Read <digest path> and continue."`). The **user** performs the `/clear`
(Claude) or `/new` (Codex); the agent cannot, and the command text says so plainly. Treating the digest
as "the context was reset" would be the same manufactured-assurance failure this kit exists to stop — the
restart is a user action the asset only prepares.

## Owner communication (v1.3) — a `[G]` doc, `[P]` skills, and a sensor that enforces nothing

### `core/OWNER_COMMS.md` is `[G]`, and that is not a formality

It **names a person**. Copying one repo's into another puts the wrong Owner's name, profile,
irreversible asset, and shorthand in front of an agent that will act on them — the same cross-repo
confusion the identity fingerprint exists to prevent, in the one file whose whole subject is *who you
are talking to*. `init` generates it from `templates/OWNER_COMMS.md.tmpl`; you never copy it.

`--owner-name` fills `{{OWNER_NAME}}`. Three placeholders are left for you deliberately, because each
is a judgment no flag can supply — `{{OWNER_PROFILE}}` (who they are and how they read),
`{{IRREVERSIBLE_ASSET}}` (the thing in *your* repo that cannot be restored, which is what makes rule 4
concrete), and `{{OWNER_SHORTHAND}}` (the tokens they actually type). `init` names each in its
post-run checklist. The generated file declares `CLASS: BINDING`, so `check-doc-size` governs it
automatically at the 20 KiB method cap along with every other `core/*.md`.

### The skills are `[P]`, but they depend on that `[G]` doc

`skills/humanize/` ships verbatim to every adopter and contains **no Owner-specific text** — it
refers to the contract by *section shape* (`## How to talk to … — Owner, not a developer`), never by
name, which is why it can be portable at all. The dependency runs one way: **the skill is inert
without the generated doc.** `/humanize` on a repo whose `core/OWNER_COMMS.md` is missing or still
full of placeholders has no rules to rewrite against. Adopt both or neither.

The install mechanism is the `/thread-restart` dual-harness pattern with the duplication removed.
There, one *method* lives as two files kept in lockstep. Here there is literally **one body** —
`.agents/skills/<name>/` — and each harness gets a shim whose only job is to point at it:

| | Shared body | Claude shim | Codex shim |
|---|---|---|---|
| Source (`[P]`) | `skills/<name>/` | `skill-shims/claude/<name>.md` | `skill-shims/codex/<name>.md` |
| Installs to | `.agents/skills/<name>/` (repo-local) | `.claude/skills/<name>/SKILL.md` (repo-local) | your Codex prompts dir (user-global) |
| Holds rules? | **yes — the only copy** | no | no |

Both sides are **discovered from disk**, so adding a skill is dropping a body dir and a shim per lane,
with no `init` change. Shims are enumerated separately from bodies rather than derived from them,
because a shim need not have a body: `humanize-bullet` is an **alias** that points at `humanize`'s.
`init` checks at adopt time that every shim's `.agents/skills/…` reference resolves on disk, so a
renamed body surfaces as a warning instead of a command that dead-ends. The Codex shims are
user-global writes and are **failure-isolated** exactly like the `/thread-restart` prompt — an
unwritable `~/.codex` warns and the repo-local adopt completes.

### `guard-owner-comms.mjs` is a SENSOR. It fails OPEN. Do not call it enforcement.

This is the one hook in the kit that is **not a control**, and the distinction is the whole point of
this document. Three separate reasons it cannot enforce anything:

1. **It fails open by design.** Every parse error, missing field, unreadable transcript, absent or
   unfinished `core/OWNER_COMMS.md`, and unrecognized shape **allows**. The write guards fail *closed*
   because a wrong write is unrecoverable; here a wrong *block* wedges a session that cannot finish a
   turn. A comms nudge must never be able to stop work. **So a clean run proves nothing.**
2. **It fires too late to prevent anything.** A Stop hook runs *after* the final message is generated
   and shown. Blocking does not retract it — it forces an *additional* message. The Owner sees the
   over-long answer and then a corrected one. That round-trip *is* the benefit, and it is also the
   ceiling: the bad message was still sent.
3. **It is dormant until armed, and only ever samples two failure modes.** With `{{OWNER_NAME}}`
   unfilled it allows unconditionally. Armed, it checks two things — narration in the closing message,
   and a short question answered past ~350 words of prose — out of seven rules. Rules 2 through 6 are
   not mechanically checkable and are not checked.

What binds the agent is the **prose in `core/OWNER_COMMS.md`**, exactly as with every other method
doc. The sensor catches one habitual miss, late, sometimes. Off switch:
`WORKFLOW_KIT_COMMS_GUARD="false"` (explicit string compare — the string `"false"` is truthy, so a
truthiness read there would be a bug).

**Parameterization.** The hook hardcodes no Owner. It reads the name from the
`## How to talk to <name> — Owner, not a developer` heading, and harvests the Owner's *question*
shorthand from the `` `TOKEN` = gloss `` rows — **a gloss containing "?" marks a question** (`AR` =
"archive ready?"), which is what lets a bare `AR` count as a short question despite carrying no "?"
and no opener word. A gloss without "?" is an **instruction** (`MIS` = "make it so"), and an
instruction fairly earns a full work report. Two consequences worth knowing:

- **The heading shape is exact.** Retitle it, or let an editor normalize the em dash to a hyphen, and
  the sensor goes dormant. It will not guess. `init` reports armed/dormant using the hook's **own
  imported predicate** — not a paraphrase — so init's word and the hook's behavior cannot drift apart;
  when they were two hand-written copies, init announced ARMED on repos where the hook allowed
  everything.
- **The template's example rows are FENCED, and that fence is load-bearing.** Rows inside a code fence
  are not harvested, so an adopter who never filled `{{OWNER_SHORTHAND}}` does not silently inherit
  someone else's vocabulary. Write your real rows *outside* the fence, in that exact backticked shape,
  or the sensor will not recognize them — which, being fail-open, costs you a nudge and nothing else.

**ARMED is not COMPLETE.** The sensor arms on the *name* alone, because that is the only part `init`
can fill. A doc that is armed but still carries `{{OWNER_PROFILE}}` / `{{IRREVERSIBLE_ASSET}}` /
`{{OWNER_SHORTHAND}}` is a contract an agent will be pointed at while rule 4 still literally reads
"this touches `{{IRREVERSIBLE_ASSET}}`". `init` warns when it sees that combination; finish the doc.

**Proof obligation.** Like `/thread-restart`, and unlike every control, this ships no fail-closed
behavior — but it is not proof-free either, because it *does* make decisions. Both suites gate it on
**both directions of every decision it makes**: dormant-allows vs armed-blocks; shorthand undeclared
vs declared; a short question over-answered vs answered briefly; one of the Owner's *questions* vs one
of their *instructions*; a question that asks FOR detail (never flagged — telling an agent to withhold
what was just asked for would be the sensor working against rule 1); narration in the closing message,
including in a bullet or bold, vs the same words inside a backtick or tilde fence, vs a deferred
commitment like "I'll deploy once you approve" (not narration); a harness-injected `<system-reminder>`
block leading *and* trailing the Owner's turn (stripped, never allowed to delete the check); a
subagent's sidechain prompt (skipped); the block *reason* text itself; and the loop-safety, off-switch,
unreadable-transcript and malformed-input allows — each asserted to exit 0, because a crash silently
classified as "allow" would let a hook that threw on every input pass every fail-open test. A sensor
only ever seen allowing is a sensor never observed working.

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

## Known limitations (v1.0) — scoped by the threat model

These were surfaced by the v1.0 gate and consciously left as-is; they are recorded here rather than
hidden. The stated threat model is **cooperative-but-fallible agents, not intrusion detection**
(`core/FOUNDATIONS.md` § Principles, Threat-model calibration) — hostile-evasion hardening needs explicit scope.

- **Symlink hardening in the working-tree guards is incomplete (hostile-evasion).** The `pre-commit`
  hook `lstat`-rejects a symlinked declaration and a symlinked `kit.config.json` (fail-closed), and the
  loaders reject a symlinked config. But `guard-cross-repo-writes.mjs` uses a **lexical** root check, so
  a symlinked *in-repo directory* pointing outside the repo is not caught at write time, and
  `guard-lane-authoring.mjs` does not reject a symlinked *declaration* (the commit-time `pre-commit`
  does). Deliberately following a symlink to escape a boundary is hostile-evasion, out of the stated
  model; the every-lane commit floor is the backstop. Characterized (not fixed) in
  `acceptance/plant-the-bug.sh` § F12 so a future hardening flips the assertion visibly.
- **The cross-repo guard ships scratch roots.** `guard-cross-repo-writes.mjs` allows writes to the
  project dir, `~/.claude`, and `/tmp` / `/private/tmp` (the last two so Claude worktrees under `/tmp`
  work). An adopter inherits those exemptions — if your workflow never uses `/tmp` worktrees you may
  tighten them, but the method's private-worktree pattern relies on them.
- **A few `[P]` method docs carry illustrative origin-repo names.** `core/ARTIFACT_CLASS.md` cites
  `pil/` as a code-dir example; `core/README.md` names `docs/PIL_ARCHITECTURE.md` / `docs/open_work_current_state.md`
  as layer-model examples an adopter won't have; and several method docs cite a `docs/journal/*.md`
  file for the postmortem a rule came from, which an adopter also won't have. These are illustrative
  prose and provenance only — **no control has a functional dependency on the origin repo** (verified:
  repo is passed via `-C`/cwd; no hardcoded absolute paths in any portable script).
  Same class as the cosmetic gate-runner naming above.

## What is portable verbatim vs generated

- `[P]` (verbatim): `core/*` method docs, the three PreToolUse hooks, the `guard-owner-comms` Stop
  sensor, `pre-commit`, `check-doc-size.mjs`, `settings.json`, the gate runners, the `commands/*`
  dual-harness assets (`/thread-restart`), and the `skills/*` bodies + `skill-shims/*` (`/humanize`).
- `[G]` (generated per repo, never copied): `CLAUDE.md`, `AGENTS.md`, `core/BINDINGS.md`,
  `core/REPO_INVARIANTS.md`, `core/SYSTEM_MAP.md`, `core/OWNER_COMMS.md`, `.claude/kit.config.json`.

Copying one repo's `[G]` files into another re-creates the cross-repo confusion the identity
fingerprint exists to prevent. `init` generates them; you never copy them.

**What the kit deliberately does NOT ship.** The origin repo carries a per-repo Codex-lane binding doc
(`core/LANE_CODEX.md`) holding the concrete Codex-as-Builder seats, the `codex-heavy` compute-weather
flip, and that repo's effort policy. It is `[G]` for the same reason `BINDINGS.md` is — it names
specific models and specific budgets — so it is **not** part of the kit. If you run a Codex builder
lane, bind its seats in your generated `core/BINDINGS.md`; the method itself is model-agnostic
(`core/MULTI_AGENT.md` § Onboarding a new model).
