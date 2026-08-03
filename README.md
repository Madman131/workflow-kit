# workflow-kit — v1.4.0

A portable, versioned kit for building **production-critical systems with AI agents** under tiered,
decorrelated, fail-closed gates. It is the extracted, stable method + enforcement controls from a repo
that used it in anger for months (Workflow v2, Phase 6). **Pin a version; diff when you upgrade.**

## What's new in v1.4

**The method set was re-cut from 3 files into 6, and the cost-inversion lane was retired.** No rule
changed in the split: the same doctrine, at the same total size, divided at concept seams instead of
at the point where one file once got too long to read. The three new docs are `FOUNDATIONS.md`
(the principles and roles every other doc uses without redefining them — so it is read first),
`ARTIFACT_CLASS.md` (how a finding is weighed and tiered depending on whether the artifact is run by
a machine or by an LLM), and `MULTI_AGENT.md` (everything about working alongside other agents:
delegation, shared-checkout staging, the task-lane declaration, onboarding a new model).

- **Why split at all.** Each of the three originals had grown to carry two unrelated jobs, and the
  terms the whole method leans on — the principles, the roles — were defined two thirds of the way
  into the first file, after several rules had already used them. The new boot order fixes that:
  `FOUNDATIONS` → `WORKFLOW` → `REVIEW` → `ARTIFACT_CLASS` → `OPERATE` → `MULTI_AGENT` → `BINDINGS`
  → `SYSTEM_MAP` → `OWNER_COMMS`. **No RULE was reworded or relaxed** — verified by byte-diffing each
  relocated section against v1.3. Two deliberate exceptions, both listed in `core/README.md`
  § Provenance rather than folded into the "nothing changed" claim: the retired lane's section was
  rewritten rather than moved, and the onboarding read order gained `OWNER_COMMS.md`.
- **`core/LANES.md` is retired**, by Owner ruling, and the file is gone. The lane let a cheaper model
  author spec-able T0/T1 work from a falsifiable ticket. Measured on the work it actually governed,
  the cheaper builder spent *more* tokens than the frontier model and produced less — and since
  building is only a small fraction of a changeset's cost, a thinner build simply buys review rounds
  that cost more than either build. It had a kill-criterion so that it could fail, and it did.
  What went with it, and what survived generally, is recorded in `core/README.md` § Provenance.
- **Authoring is in-thread.** The task-lane declaration itself is unchanged and still fails closed —
  it now lives in `core/MULTI_AGENT.md` § Task-lane declaration.
- **`core/OWNER_COMMS.md` joins the boot set.** v1.3 shipped the doc but never added it to the entry
  stubs' read-this-first list, so an agent only met it by accident. It is now step 9.

### Upgrading an existing adopter to v1.4

**This is the first release that RESTRUCTURES `core/`, so a plain re-run is NOT enough — it leaves you
silently broken.** `init` never overwrites a file it did not write this run. That is the right default
for an additive release and the wrong one here: a plain re-run installs the three new docs and *keeps*
your v1.3 copies of the five that were slimmed. Measured on a real two-version adopt, you get
`core/OPERATE.md` and `core/MULTI_AGENT.md` both carrying the multi-writer section and both calling
themselves "the authoritative text", three new BINDING docs that no boot set points at, and a live
`core/BINDINGS.md` pointer to a `core/LANES.md` that should be gone. **Nothing errors** — `doc:size`
still exits 0. The agent just reads contradictory doctrine, which is exactly the fail-invisibly mode
`core/README.md` warns about.

Do this instead:

1. **Re-run `init` with your original flags PLUS `--force`.** This is what actually replaces the eight
   `[P]` method docs and regenerates the `[G]` files, which is what moves your entry stubs and
   `core/BINDINGS.md` onto the new nine-step boot order. Read the `--force` warning in the v1.3 notes
   below first: it is global, so it also rewrites a hand-authored `core/OWNER_COMMS.md` and resets
   `.claude/kit.config.json`. **Commit before you run it.** `init` writes a `.bak` and prints the path
   only for the six **generated `[G]`** files; the **portable `[P]`** files — every `core/*.md`, the
   hooks, `pre-commit`, `scripts/` — are overwritten with **no backup**, so local edits to those are
   recoverable only from git. Re-apply your own content from the `.bak` files afterwards.
2. **Delete `core/LANES.md` by hand.** `--force` does *not* remove it; `init` only ever writes files,
   it never deletes them. This is the one step no flag does for you.
3. **Repoint your own local text** — a runbook, custom `CLAUDE.md` additions — from `core/OPERATE.md`
   § Multi-writer checkout / § Delegation to `core/MULTI_AGENT.md`.

**Verify the upgrade landed** (all three must hold):

```bash
for f in core/FOUNDATIONS.md core/ARTIFACT_CLASS.md core/MULTI_AGENT.md CLAUDE.md AGENTS.md core/BINDINGS.md; do
  test -f "$f" || { echo "FAIL missing: $f"; exit 1; }
done
test -e core/LANES.md && { echo "FAIL still present: core/LANES.md"; exit 1; }
for f in CLAUDE.md AGENTS.md core/BINDINGS.md; do
  grep -q "core/LANES.md" "$f" && { echo "FAIL stale pointer in: $f"; exit 1; }
done
echo "v1.4 upgrade verified"
```

It greps only the three files that *route* an agent — `core/README.md` still mentions `LANES.md` on
purpose, in the retirement record, and that mention is correct. **It tests each file for existence
first, deliberately:** a bare `! grep ... a b c` returns success when a file is merely *missing*
(grep exits 2, and `!` turns that into a pass), which would report a half-upgraded repo as clean —
the exact green-on-broken failure this release exists to remove.

## What's new in v1.3

**Owner communication — the method finally says how to talk to the human it reports to.** Every other
doc in this kit tells an agent how to *build*; none told it how to *report*. A technically sharp Owner
who does not write code was getting five hundred words of inventory in answer to a three-word
question. v1.3 adds the missing half: a generated contract, a skill that repairs a message against it,
and a sensor that notices the most common miss.

- **`core/OWNER_COMMS.md`** — seven rules for writing to a decision-maker rather than a fellow
  engineer: answer first in one sentence · define every term on first use · give the background · say
  why it matters to *them* · a decision means the choice, each option's cost, and a recommendation ·
  plain language · and `/humanize` to repair a message that missed. It is **`[G]` (generated per
  repo, never copied)** — it names a person, and copying one repo's Owner into another re-creates the
  cross-repo confusion the identity fingerprint exists to prevent. `init --owner-name <name>` fills
  the name; the profile, the irreversible asset, and the Owner's shorthand are judgment calls `init`
  lists in its checklist for you to complete.
- **`/humanize` and `/humanize-bullet`** — the Owner types one when a message did not land, and the
  agent rewrites its own last message against those rules (bullet mode also restructures it). Same
  conclusion, same asks, no new facts, and never cutting a risk or a blocker.
- **The shared-body dual-lane skill mechanism** — the `/thread-restart` dual-harness pattern taken one
  step further. Instead of two copies of a method kept in lockstep, there is now **one body**:
  `init` installs the canonical skill to `.agents/skills/<name>/`, then writes a thin shim per harness
  that does nothing but point at it — `.claude/skills/<name>/SKILL.md` for Claude, `<name>.md` in your
  Codex prompts dir for Codex (same `--codex-prompts-dir` / `--skip-codex-prompt` flags). Both sides
  are discovered from disk, so a future skill is two files dropped in, not an `init` edit; and `init`
  verifies at adopt time that every shim's body reference actually resolves, rather than shipping a
  menu entry that dead-ends.
- **`.claude/hooks/guard-owner-comms.mjs` — a Stop-event SENSOR that FAILS OPEN.** It reads the final
  message of a turn and flags two things: narrating the work instead of reporting the result, and
  answering a short question at length. **It is not enforcement and must never be described as such.**
  A Stop hook fires *after* the message is already sent, so blocking cannot retract it — it can only
  prompt a corrected follow-up, which is the "give me the short version" round-trip an Owner was
  making by hand. Every parse error, missing field, or unreadable file ALLOWS, so a clean run proves
  nothing. It stays **dormant** until `{{OWNER_NAME}}` is filled, and reads the Owner's own question
  shorthand out of the generated doc rather than hardcoding anyone's.

**v1.3 adds no `core/` method doc changes.** The existing method docs are untouched; `core/OWNER_COMMS.md`
is new and generated, and (like every `core/*.md`) is automatically governed by `doc:size` at the
20 KiB BINDING-method cap.

### Upgrading an existing adopter to v1.3

Re-run `init` against your repo with the same flags you originally used, plus `--owner-name`. Existing
files are **kept**, so the new pieces (the Stop hook file, the skills, `core/OWNER_COMMS.md`) install
while everything you already have is left alone — and `init` now lists the specific placeholders still
unfilled **on every run**, reading them from the files on disk rather than only from what that run
wrote.

The one thing to know: **`--force` is global.** It is also the remedy `init` recommends for a stale
hook, and it regenerates *every* `[G]` file — including a `core/OWNER_COMMS.md` you hand-wrote and a
`.claude/kit.config.json` whose deny-set you configured (regenerating that with no family flags resets
it to `{}`, which *widens* your lane guards). Since v1.3, `init` writes a `.bak` beside any such file
before overwriting it and says so on the console, so the upgrade path is recoverable rather than
silently destructive. Prefer a re-run without `--force` unless you actually want the kit's versions
back.

## What's new in v1.2.1

**`init --with-gate-runners` now gitignores `.gemini-gate/`.** The v1.2 Gemini-gate doctrine treats the
one sanctioned in-repo gate-artifact prefix as gitignored (the common-case layer that keeps
`cold-review-gemini.sh`'s `git add -A` freeze from ever staging it; the freeze-index `rm` + the
validator's exact-path exclusion remain the defense-in-depth net). Adopting an existing repo missed the
ignore entry — `init` only managed the per-session lane files. Now, when gate runners are installed, the
adopter's `.gitignore` gets `.gemini-gate/` too (idempotent; runners-only, so a no-gate adopt is
unchanged). Re-run `node bin/init.mjs --with-gate-runners` on an already-adopted repo to add just the
entry — the already-present runner scripts and `core/` docs are kept untouched.

## What's new in v1.2

**Gemini-gate runner hardening — post-extraction refinements that ran in anger downstream, now folded
back into the source of truth.** Three files change: `scripts/gemini-gate-slices.mjs`,
`scripts/cold-review-gemini.sh`, and the matching doctrine in `core/GATES.md`.

- **Gate artifacts must resolve OUTSIDE the repository** (or under the one canonical, gitignored
  `.gemini-gate/` prefix). `fingerprint`'s `--out-dir` is now optional and defaults to a fresh
  system-temp dir; an in-repo `--out-dir` is rejected *before* any evidence is written. This is
  load-bearing: an in-repo out-dir writes untracked files that `freeze_artifact`'s `git add -A` would
  otherwise bake into the review snapshot as a **false changed surface**. The refusal is symlink-safe
  (canonicalizes the longest existing ancestor) and treats the repo root itself as inside.
- **The validator excludes by RECOGNIZED EXACT PATH** — the durable log, the manifest, and the canonical
  `.gemini-gate/` dir — **never** by "is this file untracked". An untracked-ness test would fail *open*:
  an unknown untracked sibling (stray debug file, secrets, editor temp) would silently drop from the
  reviewed surface. Now it stays in scope, fails closed, and is journaled to the durable log as a
  non-verdict `SCOPE_MISMATCH_DIAGNOSTIC`.
- **`cold-review-gemini.sh` refuses a repo-internal `$TMPDIR`** before the freeze and drops a real
  physical `.gemini-gate/` directory (guarded `-d && ! -L`, so a bare file or symlink of that name stays
  in scope and fails closed) from the freeze index — defense-in-depth matching the validator's exclusion.

**v1.2 refines one core doc.** Unlike v1.1, this release touches `core/GATES.md` (the fingerprint/validator
doctrine above). The other `core/` method docs remain unchanged from v1.0.

## What's new in v1.1

**`/thread-restart` — a dual-harness command asset.** A "smart thread compaction + fresh restart":
distil the current agent thread into a durable, **verified** digest, then continue in a fresh context
window that loses nothing essential. It embodies the kit's efficiency principle — a durable handoff plus
a fresh, task-bounded session — and is a productivity **nudge, not a control** (it ships no enforcement,
so it carries no fail-closed behavior; `init`'s *wiring* is what the acceptance suite gates, not the
command's advice).

`init` installs it into **both** harnesses: the Claude command → `.claude/commands/thread-restart.md`,
the Codex prompt → your Codex prompts dir (`~/.codex/prompts/` by default; `--codex-prompts-dir` to
override, `--skip-codex-prompt` to opt out), plus a short fallback pointer appended to `AGENTS.md` so a
Codex / non-Claude lane finds the procedure even where custom slash-commands are unsupported.

**The dual-harness pattern — this is its reference implementation: the *method* is portable, the
*plumbing* is dual-shipped.** The load-bearing part — index-don't-duplicate · a mandatory
VERIFY-before-finalize pass · drop-operational-noise — is the **same method** in both, lightly adapted
per harness in wording (memory nouns like *in-thread* vs *in-conversation*, the example identifier sets,
a Claude-only fresh-session spawn offer, and the restart verb `/clear` vs `/new`); `init` installs each
asset **verbatim** — `copyFileSync`, no per-repo rewrite. A third harness is a new wrapper over the same
method, never a re-derivation. See `PORTABILITY.md`.

**Honest limit.** The agent produces the digest and the one-line restart seed; the **user** performs the
`/clear` (Claude) or `/new` (Codex). No agent resets its own context — the command never claims it did.

**v1.1 is additive.** The `core/` method docs are unchanged from v1.0 and remain marked `v1.0` — the
method is stable; v1.1 adds only the `/thread-restart` asset and its `init` wiring.

## What you get

**The method** (`core/`, portable — copies verbatim, versioned `v1.0`):
- `FOUNDATIONS.md` — the principles (P1–P3) and roles every other doc presupposes. Read first.
- `WORKFLOW.md` — Steer (tier classification) + the Gate ladder + PM dispositions.
- `REVIEW.md` — how a review is constructed and judged (cold payload, decorrelation, cross-family lens).
- `ARTIFACT_CLASS.md` — how findings are weighed and tiered for CODE vs INSTRUCTION artifacts.
- `OPERATE.md` — execution protocol, invariants, closeout, working norms.
- `MULTI_AGENT.md` — delegation, multi-writer staging, the task-lane declaration, onboarding.
- `INVARIANTS.md` — the epistemic rules + failure classes shipped to every reviewer (machine payload).
- `GATES.md` — the Codex / Gemini gate tool manuals (reference).
- `README.md` — the layer model + staged read.

**The controls** (installed into your repo by `init`):
- `.claude/hooks/guard-cross-repo-writes.mjs` — blocks Write/Edit outside the repo *(Claude lane)*.
- `.claude/hooks/guard-lane-authoring.mjs` — blocks an undeclared code write *(Claude lane)*.
- `.claude/hooks/guard-gate-ladder.mjs` — surfaces the tier's owed ladder on a gate command *(Claude lane, sensor)*.
- `.githooks/pre-commit` — blocks an undeclared / out-of-scope code **commit** *(**every** lane — see PORTABILITY.md)*.
- `scripts/check-doc-size.mjs` — caps the BINDING method docs by role; fail-closed on a bad config.

**The one sensor** (installed alongside the controls, but categorically different — read the distinction):
- `.claude/hooks/guard-owner-comms.mjs` — a **Stop**-event nudge toward `core/OWNER_COMMS.md` rule 1.
  It **fails OPEN**, fires only *after* the message is already sent, and is dormant until you name your
  Owner. **It enforces nothing.** A clean run proves nothing about a message *(Claude lane, sensor)*.

**The generators** (`templates/`, `[G]` — `init` fills them per repo, never copies verbatim):
root `CLAUDE.md` / `AGENTS.md` entry stubs, `core/BINDINGS.md`, `core/REPO_INVARIANTS.md`,
`core/SYSTEM_MAP.md`, `core/OWNER_COMMS.md`, and `.claude/kit.config.json` (your repo-specific families).

**The commands** (`commands/`, `[P]` dual-harness assets — `init` installs them into an adopting repo):
- `commands/claude/thread-restart.md` — the `/thread-restart` Claude command → `.claude/commands/`.
- `commands/codex/thread-restart.md` — the same procedure as a Codex prompt → your Codex prompts dir.
- `commands/agents-pointer.md` — the `AGENTS.md` fallback pointer (appended idempotently).

**The skills** (`skills/` + `skill-shims/`, `[P]` — one shared body, a thin shim per harness):
- `skills/humanize/SKILL.md` + `BULLET.md` — the canonical `/humanize` procedure → `.agents/skills/humanize/`.
- `skill-shims/claude/*.md` → `.claude/skills/<name>/SKILL.md`; `skill-shims/codex/*.md` → your Codex
  prompts dir. `humanize-bullet` ships in both lanes as an **alias** shim with no body of its own.

## Adopt in three steps

```
git clone <this kit> /path/to/workflow-kit
cd /path/to/your-repo
node /path/to/workflow-kit/bin/init.mjs \
  --repo-name your-repo --remote-url git@github.com:you/your-repo.git \
  --owner-name "Your Name" \
  --source-dirs src,lib --risk-tokens billing,migrations
```

`init` copies the `[P]` files in, generates the `[G]` files from templates, installs the shared skill
bodies and their per-harness shims, **merges** the three PreToolUse registrations *and* the Stop-event
sensor into `.claude/settings.json`, installs the `pre-commit` hook and sets `core.hooksPath=.githooks`,
writes `.claude/kit.config.json` from your flags, and prints a checklist. Then: complete the
`{{PLACEHOLDER}}`s in the generated `[G]` files, and wire `doc:size` + `test:kit-controls` into your CI
(`node bin/init.mjs --print-package-scripts`). `node bin/init.mjs --help` lists every flag.

## The one thing you must not miss

**Enforcement is asymmetric. The three PreToolUse hooks bind ONLY the Claude Code lane.** A Codex or
other non-Claude agent never loads them. What binds *every* lane is the prose in `AGENTS.md` + the
`pre-commit` hook. **Read `PORTABILITY.md` before you tell your team the guards protect them.**

## Parameterization is fail-closed by design

`init` never rewrites hook *source* from your inputs — the mechanism copies verbatim and only *data*
(`.claude/kit.config.json`) is per-repo. Each control **fails CLOSED** on a config it cannot read
(symlinked, permission-denied, or malformed JSON) or that is malformed in a field **that control
uses** — a mis-parameterized deny-set blocks, it never silently permits. (A field a control does not
use cannot make *that* control fail open; and even with no config at all, the `pre-commit` floor gates
every non-docs path, so an *undeclared code commit* is blocked regardless.)

**Coverage: a tripwire and a floor.** The Claude `guard-lane-authoring` write-time gate is a *tripwire*
— it catches undeclared writes to known code extensions and to your configured/default source dirs, but
it is not exhaustive (an unusual extension outside a source dir may slip it). The harness-agnostic
`pre-commit` hook is the *floor*: it treats **every** non-docs path as code, so an undeclared/out-of-scope
code **commit** is blocked for every lane. Rely on the commit floor for completeness; the write-time
guards are early, best-effort convenience.

Proven by `acceptance/plant-the-bug.sh` and the `tests/` suite, each of which observes every control
**both** blocking and permitting — a control only ever seen green is a control never observed working.

## License
`init`-generated files are yours. The kit files carry no license header; pick a license for your fork
(the `package.json` field is `UNLICENSED` as a deliberate placeholder).
