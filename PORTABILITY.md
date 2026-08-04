# PORTABILITY — what the kit binds, and what it does not

> Read this before you rely on any control. A kit that is *believed* to enforce something it does not
> is worse than no kit — it manufactures assurance (`core/INVARIANTS.md` epistemic rules 2 & 10).

## The enforcement asymmetry (the load-bearing caveat)

The guard hooks are `PreToolUse` registrations. Since **v2.1** they are registered in **both** lanes —
`.claude/settings.json` for Claude Code, a generated `.codex/hooks.json` for Codex — from **one set of
files** that branches on payload shape at runtime. A human with an editor still loads neither.

The Codex column is not the Claude column. Read the qualifier in it as part of the value:

| Control | Claude Code lane | Codex lane | Human by hand |
|---|---|---|---|
| `guard-cross-repo-writes` (writes outside repo blocked) | **enforced** | **enforced — only once hook trust is granted** | not enforced |
| `guard-lane-authoring` (declaration before a code write) | **enforced** | **enforced — only once hook trust is granted** | not enforced |
| `guard-gate-ladder` (surfaces the tier's ladder; sensor) | **enforced** | **enforced — only once hook trust is granted** | not enforced |
| `.githooks/pre-commit` (declaration, at commit) | **enforced** | **enforced** | **enforced** |
| `guard-owner-comms` (Stop; comms nudge) — **sensor, fails OPEN** | *nudge only* | *installed, NOT registered* | not present |

The formula for the Codex write guards, in full, because every word of it is load-bearing:
**installed · fail-closed by design · INERT unless your Codex run carries hook trust.**

"Fail-closed **by design**" is a statement about the guards' own decisions — given a payload they
read, an input they cannot account for produces a deny. It is **not** a claim that every failure mode
ends in a block, and one distinction matters: Codex blocks a tool call on a well-formed *deny*, so a
hook that never STARTS (a broken command string, a missing interpreter, a timeout) blocks nothing at
all. Fail-closed logic inside a hook cannot save a hook that did not run — which is the same reason
the trust gate matters, and the same reason the answer is a probe rather than an assurance.

Two things that qualifier does *not* mean. It is not a soft caveat you can assume away: an untrusted
hook is skipped **silently**, so a clean run is not evidence of anything (§ The trust gate). And it is
not something the kit can fix for you — arming it is a human act, by design (§ Why the kit will never
arm it for you). One command answers the question:

```bash
node scripts/check-codex-hooks-armed.mjs
```

**What binds every lane** is still (1) **prose** — `AGENTS.md` + `core/*` + the required
PM-disposition emission, which a cooperative agent follows — and (2) the **`pre-commit` hook**, the
one deterministic layer no harness routes around, because *all* writers (Claude Write/Edit, Claude
Bash redirection, Codex `apply_patch`, Codex shell commands, a human editor) converge at the commit.
**v2.1 does not change that**, and the reason is § The shell-write road below: the Codex write guard
is a tripwire on one road, and that lane has another.

This is why `init` installs the harness-agnostic `pre-commit` hook and sets `core.hooksPath` whatever
else you skip. What you may now tell your team: the PreToolUse guards bind a Codex lane **that has
been armed and verified**. What you may not tell them: that installing the kit did it.

### What the Codex lane now enforces — MEASURED, not assumed (v2.1, 2026-08-04)

Through v1.7 the "not enforced" column was an **assumption**: the guards are Claude registrations, so
presumably nothing else loads them. v2.0 replaced the assumption with findings executed against
`codex-cli 0.146.0-alpha.9.2`, and concluded that a *port* was impossible — the payload has no
`file_path`, so the ported guards would fail open or brick. v2.1 builds the control those findings
called for. Everything below is against that same CLI version.

**PROVENANCE — read this before relying on any claim below, because the claims are not all the same
kind.** Three classes, and this section marks which is which:
1. **Checkable in this repo, right now.** Everything about how the KIT's own code behaves: that
   `hooks/payload-targets.mjs` returns all five targets of the captured multi-target envelope
   including both ends of a rename, that an unparseable envelope is denied rather than partly
   trusted, that the two installed hook trees are byte-identical, that the generated
   `.codex/hooks.json` names `apply_patch`/`Bash`, and that the **registered command string, executed
   verbatim with a captured payload, writes the guard's ledger rows**. Read the files; run
   `npm test`; `tests/codex-guard.test.mjs` is that receipt.
2. **Checkable against a retained receipt.** The Codex payload SHAPES — `apply_patch`, the patch
   envelope, multi-target patches, `Bash` for shell, and the sandbox refusal that is *not* a hook
   decision — are captured verbatim in `acceptance/fixtures/codex-payload-samples.mjs`. The pre-v2.1
   guard is retained at `acceptance/fixtures/pre-v2.1-guard-cross-repo-writes.mjs` so the claim that
   v2.1 changes no Claude-lane decision is a test that runs, not an assertion. These are recordings:
   they authenticate the shapes and nothing more.
3. **Checkable against the Codex CLI on your machine, by a route that costs nothing.** New in v2.1:
   Codex **parses and validates `.codex/hooks.json` before it needs auth, trust, or a model call**,
   and warns on stderr. That makes several claims here reproducible in seconds — put a candidate file
   in a scratch repo and run any `codex exec`:
   - a bare event map is rejected: `unknown field 'PreToolUse', expected 'description' or 'hooks'`
     (this is how the accepted schema was determined — the Claude shape is *not* it);
   - an invalid matcher is rejected: `invalid matcher "[unclosed" … regex parse error`, which is how
     `apply_patch` and `Bash` were confirmed to be accepted matcher values;
   - **a repo-level `.codex/agents/*.toml` is parsed too** — `Ignoring malformed agent role
     definition: failed to parse agent role file at …`. See § The Codex review seat: this reverses a
     v2.0 disclosure.
   Validation is **shallow**, and that limit matters: an unknown EVENT name, an unknown handler
   field, and a missing matcher all pass with no warning. So this route proves the envelope and the
   matcher, never that a registration will actually fire.
4. **NOT checkable from this repo at all — observed once, in a session whose transcript is not
   shipped.** The trust gate, the silent skip in `codex exec`, `trust_level` ≠ hook trust, the
   unprompted shell write, and every statement about the origin repo. They are reported here because
   they change what an adopter should do, not because this artifact proves them. **Reproduce them
   yourself before betting on them** — and for the one that matters most, you do not have to
   improvise: `scripts/check-codex-hooks-armed.mjs` is that reproduction, packaged.

**How the hook command is executed, and why the quoting matters.** Codex runs a hook `command`
through a **shell** (the shipped CLI's hook command runner sits directly beside its `SHELL`/`-lc`
strings; a cross-family review seat reported the same from Codex's source). An earlier draft of this
section said the execution model was unknown — that was wrong, and it mattered, because the fallback
quoting it chose was JSON double-quotes, inside which a shell still expands `$VAR` and `$(cmd)`. The
generated command now uses POSIX **single** quotes, and only when the repo path needs them; an
ordinary path is written unquoted. **A hook that fails to START does not block anything** — Codex
blocks on a well-formed deny, not on a broken command — so a mis-quoted path would be a fail-open,
which is why `init` warns when it had to quote and why the arming probe is the thing that settles it.

**One claim this release DOWNGRADES rather than repeats.** v2.0 said the origin repo's
`Write|Edit|MultiEdit|NotebookEdit` matchers "match nothing" in Codex. What is *observed* is
narrower: every captured write arrived as `apply_patch` and every command as `Bash`. A cross-family
seat asserted that Codex additionally exposes `Write`/`Edit` as **aliases** for `apply_patch`; that
was not reproducible against the CLI on this machine, and it is not settled here. It does not change
what the kit does — the canonical names are correct under either answer, and v2.0's conclusion rested
on the trust gate independently — but if the alias claim is true, then "those matchers select
nothing" is too strong, and it is recorded here as **open** rather than repeated as fact.

The origin repo is a private repository not distributed with this kit, so its `.gitignore` line
numbers below are cited for the author's audit trail, not as something you can resolve.

The origin repo this kit was extracted from *did* attempt a Codex lane: it carries
`.codex/hooks/{guard-cross-repo-writes,guard-lane-authoring,guard-gate-ladder}.mjs` plus a
`.codex/hooks.json` registering them. **No version of those files that can be inspected today could
have run, and the current one cannot.** (Stated at that strength deliberately: the files are
gitignored, so their history is unrecoverable — the same fact that makes reason 3 damning makes a
flat "never, not once" unprovable. What can be shown is that the registration as it stands selects
nothing and is untrusted.) Two independent reasons, either sufficient on its own:

1. **The matchers do not name the tools Codex was observed to use.** That registration listens for
   `Write|Edit|MultiEdit|NotebookEdit`. Across every invocation observed, a file write arrived as
   `tool_name: "apply_patch"` and a command as `tool_name: "Bash"` — never those names. (An absence
   over observed runs, not a proof that no such tool exists anywhere in Codex. **Weakened at v2.1**:
   a cross-family seat asserted Codex aliases `Write`/`Edit` onto `apply_patch`, which was not
   reproducible here — see the provenance note above. If that is true, this reason is wrong and
   reason 2 carries the conclusion alone.)
2. **Trust was never granted** (see below). Even with correct matchers, they would have been skipped.

Two further facts made that attempt unrepairable by copying rather than rebuilding — they are why
v2.0 shipped **no Codex hooks at all**, and why what v2.1 ships is **new control code** rather than a
port:

- **No observed Codex write carried a `file_path`.** The payload is a patch envelope —
  `tool_input: {command: "*** Begin Patch\n*** Add File: x.txt\n+…\n*** End Patch"}` — and one
  envelope can add, update, delete and rename **several** files at once. Both write guards key on
  `tool_input.file_path`. Ported as-is, `guard-cross-repo-writes` takes its no-target branch and
  **allows everything** (fail-OPEN — the worst outcome, an installed control that silently permits),
  while `guard-lane-authoring` denies **every** write including `docs/`, which an adopter disables
  within a day. Guarding the Codex lane needs a real envelope parser gating every target in it, which
  is new control code, not a port. **That parser is what v2.1 adds** (`hooks/payload-targets.mjs`):
  one extractor, shared by both guards, returning *every* path an envelope touches — including
  **both endpoints of a rename**, because a `*** Move to:` can carry a file out of a gated directory
  just as easily as into one, so gating only the source is a fail-open and gating only the
  destination misses the departure. An envelope it cannot fully account for is **denied**, never
  partly trusted: a parser that returns the targets it happened to understand is a fail-open with
  extra steps, and the dropped target is the one an attacker puts last.
- **Those files were never committed.** They are gitignored in the origin repo
  (`.gitignore:33-35`), so they were never reviewed, never in CI, and never version-controlled. That
  repo's own `core/LANE_CODEX.md` said Codex-hook enforcement was "UNVERIFIED — assume none; that is
  the fail-safe read". These measurements promote that caution to **fact**. It was right.

**The trust gate, and why it is the sharpest fact here.** Codex does not run a repo's hooks until a
human has reviewed and trusted them, and that review happens **only in the interactive TUI**
("Hooks need review" → "Trust all and continue"). In `codex exec` — the non-interactive mode the
kit's own gate runners use — an untrusted hook is skipped **silently**: no prompt, no warning, no
exit-code change. Measured directly: a hook that hard-blocked a write when trusted allowed the
identical write when untrusted, and the entire run output contained **zero** mentions of hooks being
skipped. Note also that marking a project `trust_level = "trusted"` does **not** arm hooks; project
trust and hook trust are different grants.

That is manufactured assurance as a **platform property**, and it outlives any particular kit
version: *any* Codex-lane hook you install, ours or your own, is inert until a human approves it in an
interactive session, and nothing will tell you it is inert. Two rules follow, and v2.1 — which ships
hooks that live under exactly this gate — operationalizes both rather than restating them:

- **Never bypass it.** `--dangerously-bypass-hook-trust` arms every hook from every source without
  review. And knowing where the trust record lives does not license writing it: automating another
  tool's consent store is forging consent through a quieter door. The kit does neither, and the test
  suite pins it: no shipped file writes `trusted_hash`, and neither that token nor the bypass flag
  may appear in a shipped line except in a sentence refusing it.
- **Assume unarmed until you have watched it fire.** A hook file on disk is not a running control —
  the kit's own dead-sensor rule, now with a platform-level example.

**Why the kit will never arm it for you, and what it does instead.** Arming is a human act because
the grant being made is a human's: *let code from this repo run on my machine, outside the sandbox*.
A kit that granted that on your behalf would not be delivering a control, it would be forging your
consent — and the quiet route (writing the trust record directly) is the same act as the loud one
(`--dangerously-bypass-hook-trust`), which additionally arms every hook from every source, not just
this kit's. So the kit's arming path is **documentation plus a verification probe**:

1. **Upgrade** — `node bin/init.mjs --target <repo> --force` when a release changes a hook.
2. **Re-trust, interactively** — run `codex` in the repo once and answer "Hooks need review" with
   "Trust all and continue". Editing or upgrading a hook marks it CHANGED, which **DISARMS** it until
   you approve again. This step is why the order matters: trusting before upgrading arms the old file.
3. **Verify** — `node scripts/check-codex-hooks-armed.mjs`.

**The probe observes the control, not the outcome — and that distinction is the whole design.** It
does not ask "did the forbidden write fail?", because a write can fail for at least four reasons and
only one of them is ours. Its first draft did ask that, and reported **ARMED against hooks that were
provably untrusted**: the write had failed because Codex's *own sandbox* refused the path, and Codex's
narration then said "The hook blocked the file creation" — a second witness confirming the wrong
cause. A model's account of *why* something failed is not evidence about the mechanism. So the probe
requires the guard's **own signature**: `guard-lane-authoring` appends a row to
`.claude/lane-ledger.jsonl` for every gated decision, allow or deny, and a new row is proof the guard
ran. Its exits are deliberate: **armed 0 · not armed 1 · not installed 2 · `codex` CLI absent 2 ·
nothing-was-tested 2**. Every 2 is an **ABSTAIN, and abstain is never 0** — an unanswered question
reported as a pass is the precise failure the probe exists to prevent.

**That last exit was added after running the probe for real, and it is the outcome you are most
likely to meet first.** Against hooks a human had just trusted, the probe reported NOT ARMED about a
lane that was provably blocking — because Codex had read the adopted repo's own `AGENTS.md`, decided
an identity precondition failed (*"this checkout has no `origin` remote"*), and **never attempted the
write**. No attempt means no hook, which means no ledger row. The check was applying "absence is not
evidence" to ARMED and not to NOT ARMED. It now distinguishes the two by whether the probe file
actually landed: file written and no guard row ⇒ genuinely NOT ARMED; **no row and no file ⇒
UNKNOWN**, printing the tail of the run so you can see the agent declining. If you see UNKNOWN, fix
the precondition it names (usually a real `origin` remote and a valid `.claude/task-lane.json`) and
re-run. A false alarm is not the safe direction it appears to be: an adopter told a working control
is dead switches it off.

**The shell-write road — a main road in this lane, not a footnote.** In the Claude lane
"Bash redirection is not covered" is a small accepted class. In the Codex lane it is routine: while
being asked only to create a file, Codex reached unprompted for a shell command that MUTATED it:
`truncate -s 5 hello.txt && wc -c hello.txt && od -An -tx1 hello.txt` (retained verbatim in
`acceptance/fixtures/codex-payload-samples.mjs`). A PreToolUse write guard sees `apply_patch`; it does
not see a shell command that rewrites a file. So the guard v2.1 ships — correct and armed — is a
**tripwire materially leakier than its Claude twin**, and it must never be described as parity. This
is not a gap awaiting a fix in the next release: telling a file-mutating shell command from a benign
one needs real shell parsing, an unbounded chase this kit refuses on purpose. The residual is pinned
by a characterization test (`tests/codex-guard.test.mjs`) so that it stays *visible* rather than
quietly assumed away — the test asserts the write guards permit the captured mutating shell command,
which is the honest description of what they do.
(Scoped to what the retained receipt actually shows: one mutating command. Codex also ran `sed -n`
and `od` freely, but those only READ — citing them as write evidence would be the same over-claim
this section exists to correct.)

**What this means for you today.** The Codex lane now has write-time enforcement on the
`apply_patch` road, once armed — and the paragraph above is how you find out whether it is. The
`.githooks/pre-commit` floor remains the only **harness-agnostic mechanical floor**, and v2.1 does
not demote it: the write guard covers one road in a lane with two, so the floor is still the only
layer *every* writer converges at. It is deliberately not called a *guarantee*, because it is not
one: it is silently absent on a fresh clone until `core.hooksPath` is configured (§ FM1 below) and it
is bypassable with `--no-verify`. It is the strongest every-lane mechanism available, once configured
and verified, which is exactly why `init` installs it and sets `core.hooksPath` whatever else you
skip.

**What `init` writes into `.codex/`, and which of it is a control.** The guards
(`.codex/hooks/*.mjs`) and their registration (`.codex/hooks.json`) are **controls**, subject to the
trust gate above. `.codex/config.toml` is a **convenience**: a pager pin that removes the DEFAULT
pager as a hang risk in a non-interactive run — nothing verifies Codex loaded it, and a command can
still set its own `GIT_PAGER`. `.codex/agents/cold-reviewer.toml` is a **review seat**, whose model
is yours to bind; it enforces nothing. `--skip-codex-lane` omits **all of these**, plus the arming
probe, and says so; the Codex PROMPTS `init` also writes are user-global, live outside the repo, and
are omitted by `--skip-codex-prompt` instead.

**One registration, not two.** Codex accepts hook registrations in either `.codex/config.toml` or
`.codex/hooks.json` and warns when both carry them ("prefer a single representation for this layer").
If your kept `config.toml` already declares hooks — in **either** spelling, the `[[hooks.PreToolUse]]`
table or the scalar `hooks = "./hooks.json"` that Codex's own schema uses — `init` writes **no**
`hooks.json`, tells you so, and leaves your registration alone. Those hooks are then yours: the kit
did not change them and the arming probe will not vouch for them.

**Registered in the Codex lane: the two write guards and the gate-ladder sensor. Not the Owner-comms
Stop sensor.** Codex does list a `Stop` hook event, but this kit has not observed that payload, and
registering a sensor against an unverified payload shape would ship a control nobody has watched. The
file installs — the two hook trees are byte-identical by construction — and only the registration is
withheld.

**The Codex review seat — a v2.0 disclosure this release CORRECTS.** v2.0 recorded, against its own
artifact, that a repo-level `.codex/agents/` was "*not* something this work verified as a discovery
root, so the seat may be inert where the kit puts it". **That has now been checked by execution, and
the seat is not inert.** With a deliberately malformed `.codex/agents/cold-reviewer.toml` in a scratch
repo, Codex printed `warning: Ignoring malformed agent role definition: failed to parse agent role
file at …` — it reads and parses that directory. Two independent live controls in the same run
(a `.codex/hooks.json` parse warning and a `.codex/skills` loader error) rule out a silent harness.
The kit's shipped template was then run through that same parser with a malformed canary beside it:
exactly one warning, naming the canary, so **`templates/codex-cold-reviewer.toml.tmpl` is valid to
Codex's own role parser**. Scope this honestly — it proves the file is **discovered and parsed**, not
that a seat spawned from it behaves as the instructions say. The seat's **second** v2.0 limit stands
unchanged: its `developer_instructions` **restate** the cold-review mandate `agents/cold-reviewer.md`
already carries for the Claude lane, with nothing pinning the two together, so they can still drift
apart unnoticed.

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
   and a short question answered past ~350 words of prose — out of eight rules. Rules 2 through 6 are
   not mechanically checkable and are not checked. Rule 8 (an ask must be bolded, bulleted and
   labeled) **is** checkable in principle — a Stop hook can see whether a question mark outside a
   fence sits on an unbolded line — and this sensor does not check it either. Do not read the two
   cases as one: five rules are out of reach, one is merely unbuilt.

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

## The `/frontier-review` consult seat and the reviewer agents (v1.6)

### The `tools: []` cage is a Claude-harness control — and only there

`agents/frontier-consult.md` installs to `.claude/agents/`, the **Claude Code subagent registry**.
Its frontmatter `tools: []` is enforced by that harness as *no tools at all*: the consult seat
cannot read files, run commands, or spawn agents, so "judge only the packet" is mechanical, not a
promise. Three honesty notes, same spirit as the enforcement-asymmetry table:

- **No other lane has the cage, and the Codex path is not packet-only at all.** A Codex /
  non-Claude lane has no `.claude/agents/` registry. Its consult path is the gate runner
  (`--with-gate-runners` + the `codex` CLI), which hands the seat the **repository** and requires a
  GO/NO-GO verdict — so it is a cross-family gate on the same question, not this seat: neither the
  tool restriction nor `INSUFFICIENT PACKET` carries across. The skill says so at the point of use.
- **The cage is silent, not honest.** A caged seat can still *fabricate* claimed tool use. An
  enforced empty list means no tool ran; it does not make the answer well-grounded — the skill's
  sufficiency test is what carries that.
- **The kit does not execute the enforcement, and says so.** What v1.6 ships and proves is the
  *declaration*: `tools: []` is present in the installed frontmatter, and `init` plus both suites
  discriminate when it is not. Whether the harness then denies the seat every tool is the
  **harness's documented behavior, not an observation this kit makes** — nothing here spawns a
  subagent and checks its tool-use count. Treat it as a control you can verify in your own harness
  (fire the seat, confirm zero tool uses), not one the kit has watched fire. Note the listing
  cosmetically renders an empty list as `(Tools: All tools)`, so the UI is not the check.
- **`init` verifies the INSTALLED file.** A kept `.claude/agents/frontier-consult.md` may be
  edited or stale; if the literal `tools: []` line is gone, `init` warns that the cage is NOT
  confirmed rather than certifying a seat it never looked at (the same pattern as the pre-commit
  `pcTrusted` check and the shim read-back).

### Re-binding a seat is an edit to a `[P]` file — `--force` reverts it, with no `.bak`

The agent `model:` values (`fable`, `opus`) are **Claude-harness aliases, not kit doctrine** — the
roles they hold are bound per repo in `core/BINDINGS.md` (`{{FRONTIER_MODEL}}`,
`{{CODEX_FRONTIER_MODEL}}`). An adopter whose harness uses different model names must edit the
frontmatter of `.claude/agents/*.md` too, and **that is a local edit to a portable file**: like
every `[P]` asset — the hooks, `pre-commit`, `core/*.md` — a `--force` re-run overwrites it with
the kit's version and writes **no backup** (only `[G]` files get a `.bak`). Since `--force` is also
the remedy `init` prints for a stale hook or a lost cage, record your binding in
`core/BINDINGS.md`, which *is* `[G]`, and treat the frontmatter edit as re-appliable rather than
durable. Never remove `frontier-consult`'s `tools: []` line when you re-bind it.

The skill is deliberately de-model-named: `/frontier-review` names the ROLE; alias it to your
model's name if your team prefers.

## The ritual skills (v1.7) — `[P]` procedures over facts your `[G]` files supply

`/boot`, `/closeout`, and `/lane-declare` ship verbatim through the shared-body mechanism and
contain no repo-specific text — they lean on the `[G]` files for every concrete fact, the same
one-way dependency `/humanize` has on `core/OWNER_COMMS.md`:

- **`/boot`** checks identity against **the fingerprint table in your generated entry stub** and
  walks the boot set. On a repo whose `CLAUDE.md`/`AGENTS.md` placeholders were never completed,
  step 1 has nothing to compare against — the skill is a checklist over a contract you still owe.
- **`/closeout`** takes its push-authorization semantics from `core/OPERATE.md` (`[P]`), but the
  *effect* of pushing — "the deploy branch does X" — is whatever your entry stub names. It never
  claims your repo auto-deploys; it tells the agent to read what you wrote there.
- **`/lane-declare` documents the kit's own two controls** — the Claude-lane PreToolUse guard and
  the every-lane `pre-commit` — including the enforcement asymmetry (the guard binds only the
  Claude lane; the commit floor binds everyone). If you have replaced or locally edited those
  controls, the skill's description of their behavior no longer matches your repo: it describes
  the kit's shipped versions, not whatever sits at those paths.

**A second asymmetry, inside the declaration itself (v1.7, newly documented — the behavior is
unchanged since v1.0).** The two readers do not fail closed on the same things. Both block an
undeclared, malformed or stale declaration. **Only the PreToolUse guard binds the SESSION:** it
compares the declared `sessionId` to the live session and blocks a mismatch. The `pre-commit`
floor requires the field to be present and well-formed but has no live session to compare
against, so **a declaration left over from another thread still permits a commit** — verified by
executing a real commit against an adopted repo, not by reading the code. Re-declaring at every
task boundary is what actually closes that, and no control checks that you did. Closing it
mechanically would need a binding the floor does not have (file mtime, branch, or similar); that
is unbuilt design, not a shipped control, and it is recorded here rather than implied away.

**The budget checker is kit-repo governance, not an installed control.** `scripts/check-skill-budgets.mjs`
gates the KIT's own tree (`skills/`, `skill-shims/`, `agents/`, `commands/`) as the first rung of
the kit's `npm test`; `init` does **not** copy it into adopters, and nothing in an adopted repo
runs it. The installed skill
bodies still carry their `Word budget:` lines — in your repo those are declared numbers with no
mechanical enforcement unless you wire your own (copying the checker and re-pointing its class
roots at `.agents/skills/` etc. is a hand adaptation, not a supported path).

## `/orchestrate` (v2.3) — a portable METHOD over plumbing the kit does not ship

`/orchestrate` describes how a program too large for one thread is run as sequential **chips**: one
orchestrator session, one worker per changeset, and an Owner who holds intent, risk and the
merge-GO. It is `[P]` and names no repo, model or person.

**Read the split it states about itself.** The METHOD — the role boundaries, the one-writer rule,
the freeze, the GO discipline, the chip cycle — is portable and is what the skill is for. The
**PLUMBING it was extracted from is not shipped and is not assumed**: clickable task chips and
cross-session messaging are harness features, not kit features. The body therefore names a
**degraded mode** — a shared append-only program record, briefs as files, consults as entries in
that record — and states plainly that what degrades is latency, not the role split.

**It has the same one-way `[G]` dependency `/humanize` has.** The body cites `core/OWNER_COMMS.md`
for how an ask to the Owner is formatted, and that file is generated per repo — on an adopter whose
`OWNER_COMMS.md` is missing or still carries its placeholders, that pointer resolves to nothing and
the skill's Owner-facing half is a procedure over a contract you still owe. The dependency runs one
way only: nothing in `core/OWNER_COMMS.md` depends on `/orchestrate`.

**Nothing in it is enforced, and it says so.** No control counts gate rounds, reads a freeze, or
checks who gave a GO; the controls the kit does ship are the task-lane declaration and the commit
floor, each with the limits recorded above (§ The enforcement asymmetry, § FM1). Treat the skill as doctrine your agents follow because you told them to, exactly like the
gate ladder in `core/WORKFLOW.md` — not as a mechanism. Its two reference layers (`CHIP_BRIEF.md`,
`PROTOCOLS.md`) are loaded on demand from the body; `PROTOCOLS.md` is a **bank of incidents**, so it
is expected to grow, and its word budget is author-set rather than Owner-ratified.

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

- **Symlink hardening in the working-tree guards is incomplete (hostile-evasion).** Both the
  `pre-commit` hook and `guard-lane-authoring.mjs` `lstat`-reject a symlinked declaration and a
  symlinked `kit.config.json` (fail-closed; both asserted in `acceptance/plant-the-bug.sh` § round-3).
  But `guard-cross-repo-writes.mjs` uses a **lexical** root check, so a symlinked *in-repo directory*
  pointing outside the repo is not caught at write time. Deliberately following a symlink to escape a
  boundary is hostile-evasion, out of the stated model; the every-lane commit floor is the backstop.
  Characterized (not fixed) in `acceptance/plant-the-bug.sh` § F12 so a future hardening flips the
  assertion visibly.
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

- `[P]` (verbatim): `core/*` method docs, the three PreToolUse guards, the two PreToolUse sensors
  (`sensor-sweep-owed`, `sensor-mutation-owed` — they print, never deny), the `guard-owner-comms` Stop
  sensor, `pre-commit`, `check-doc-size.mjs`, `settings.json`, the gate runners, the `commands/*`
  dual-harness assets (`/thread-restart`), the `skills/*` bodies + `skill-shims/*` (`/humanize`,
  `/frontier-review`, `/boot`, `/closeout`, `/lane-declare`, `/sweep`, `/orchestrate`), the
  `agents/*` reviewer seat
  definitions (→ `.claude/agents/`), and `codex/config.toml` (→ `.codex/config.toml`).
- `[G]` (generated per repo, never copied): `CLAUDE.md`, `AGENTS.md`, `core/BINDINGS.md`,
  `core/REPO_INVARIANTS.md`, `core/SYSTEM_MAP.md`, `core/OWNER_COMMS.md`, `.claude/kit.config.json`,
  and `.codex/agents/cold-reviewer.toml` — `[G]` for the same reason `BINDINGS.md` is: it names a
  **model**, which is a per-repo binding, not kit doctrine. Left unfilled, `{{CODEX_COLD_MODEL}}`
  survives into the generated file and `init`'s placeholder checklist names it, so the seat is
  visibly incomplete rather than silently mis-modelled.

Copying one repo's `[G]` files into another re-creates the cross-repo confusion the identity
fingerprint exists to prevent. `init` generates them; you never copy them.

**What the kit deliberately does NOT ship.** The origin repo carries a per-repo Codex-lane binding doc
(`core/LANE_CODEX.md`) holding the concrete Codex-as-Builder seats, the `codex-heavy` compute-weather
flip, and that repo's effort policy. It is `[G]` for the same reason `BINDINGS.md` is — it names
specific models and specific budgets — so it is **not** part of the kit. If you run a Codex builder
lane, bind its seats in your generated `core/BINDINGS.md`; the method itself is model-agnostic
(`core/MULTI_AGENT.md` § Onboarding a new model).
