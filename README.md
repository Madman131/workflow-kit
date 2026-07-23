# workflow-kit — v1.2

A portable, versioned kit for building **production-critical systems with AI agents** under tiered,
decorrelated, fail-closed gates. It is the extracted, stable method + enforcement controls from a repo
that used it in anger for months (Workflow v2, Phase 6). **Pin a version; diff when you upgrade.**

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
- `WORKFLOW.md` — Steer (tier classification) + the Gate ladder + PM dispositions.
- `REVIEW.md` — how a review is constructed and judged (cold payload, decorrelation, cross-family lens).
- `OPERATE.md` — execution protocol, invariants, closeout, working norms, multi-writer staging.
- `INVARIANTS.md` — the epistemic rules + failure classes shipped to every reviewer (machine payload).
- `GATES.md` — the Codex / Gemini gate tool manuals (reference).
- `LANES.md` — the optional cost-inversion lane (reference).
- `README.md` — the layer model + staged read.

**The controls** (installed into your repo by `init`):
- `.claude/hooks/guard-cross-repo-writes.mjs` — blocks Write/Edit outside the repo *(Claude lane)*.
- `.claude/hooks/guard-lane-authoring.mjs` — blocks an undeclared code write *(Claude lane)*.
- `.claude/hooks/guard-gate-ladder.mjs` — surfaces the tier's owed ladder on a gate command *(Claude lane, sensor)*.
- `.githooks/pre-commit` — blocks an undeclared / out-of-scope code **commit** *(**every** lane — see PORTABILITY.md)*.
- `scripts/check-doc-size.mjs` — caps the BINDING method docs by role; fail-closed on a bad config.

**The generators** (`templates/`, `[G]` — `init` fills them per repo, never copies verbatim):
root `CLAUDE.md` / `AGENTS.md` entry stubs, `core/BINDINGS.md`, `core/REPO_INVARIANTS.md`,
`core/SYSTEM_MAP.md`, and `.claude/kit.config.json` (your repo-specific families).

**The commands** (`commands/`, `[P]` dual-harness assets — `init` installs them into an adopting repo):
- `commands/claude/thread-restart.md` — the `/thread-restart` Claude command → `.claude/commands/`.
- `commands/codex/thread-restart.md` — the same procedure as a Codex prompt → your Codex prompts dir.
- `commands/agents-pointer.md` — the `AGENTS.md` fallback pointer (appended idempotently).

## Adopt in three steps

```
git clone <this kit> /path/to/workflow-kit
cd /path/to/your-repo
node /path/to/workflow-kit/bin/init.mjs \
  --repo-name your-repo --remote-url git@github.com:you/your-repo.git \
  --source-dirs src,lib --risk-tokens billing,migrations
```

`init` copies the `[P]` files in, generates the `[G]` files from templates, **merges** the three
PreToolUse registrations into `.claude/settings.json`, installs the `pre-commit` hook and sets
`core.hooksPath=.githooks`, writes `.claude/kit.config.json` from your flags, and prints a checklist.
Then: complete the `{{PLACEHOLDER}}`s in the generated `[G]` files, and wire `doc:size` +
`test:kit-controls` into your CI (`node bin/init.mjs --print-package-scripts`). `node bin/init.mjs
--help` lists every flag.

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
