# workflow-kit — v1.0

A portable, versioned kit for building **production-critical systems with AI agents** under tiered,
decorrelated, fail-closed gates. It is the extracted, stable method + enforcement controls from a repo
that used it in anger for months (Workflow v2, Phase 6). **Pin a version; diff when you upgrade.**

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
(`.claude/kit.config.json`) is per-repo. Every control **fails CLOSED** on a malformed config (a
mis-parameterized deny-set blocks, it does not silently permit). Proven by `acceptance/plant-the-bug.sh`
and the `tests/` suite, each of which observes every control **both** blocking and permitting — a
control only ever seen green is a control never observed working.

## License
`init`-generated files are yours. The kit files carry no license header; pick a license for your fork
(the `package.json` field is `UNLICENSED` as a deliberate placeholder).
