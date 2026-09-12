# Ticket: Adopt Workflow-Kit on This Mac and Into One Target Repository

Copy this entire ticket into a new Codex task opened from the repository that will adopt
Workflow-Kit. Replace the angle-bracket fields when known; discover the rest locally.

## Inputs

```text
Workflow-Kit source path: <WORKFLOW_KIT_PATH>
Expected handoff commit: <HANDOFF_SHA_FROM_SENDER>
Expected kit version: <VERSION_FROM_SENDER>
Target repository path: <TARGET_REPOSITORY_PATH; normally the Codex task cwd>
Owner name: <OWNER_NAME>
Target remote URL: <URL or UNKNOWN>
Deploy branch and effect: <branch and what a push does, or UNKNOWN>
```

## Objective

Adopt the received Workflow-Kit into this target repository, configure it for this repository and
this Mac, prove its mechanical controls, and leave a receipt that distinguishes:

- files installed;
- Git commit-hook floor configured;
- Codex hooks trusted and verified armed;
- Claude and Gemini review seats available and bound;
- review methodology documented;
- push, deployment, activation, and live writes, none of which are implied by local setup.

Continue through every safe, local, reversible step. Stop only for a genuine Owner action or
decision, while continuing unrelated setup work that does not depend on it.

## Authority and hard boundaries

You may inspect both repositories, create a task branch or private task worktree, run the installer,
edit the target repository's generated configuration and documentation, merge package scripts with
care, and run local tests.

Do **not**:

- modify the received Workflow-Kit source;
- copy generated `[G]` files from any other adopter repository;
- use `--force` for a first installation;
- overwrite unexplained dirty work or another lane's files;
- install system/global software, authenticate a provider, spend metered API credit, push, merge,
  deploy, or perform a live/production write without the Owner's explicit approval for that act;
- ask the Owner to paste credentials into chat or expose a token in a command transcript;
- silently substitute another model or model family when a required gate seat is unavailable;
- report a provider as enabled merely because a script, hook, or configuration file exists.

The Owner performs GUI approvals and provider sign-ins directly. Queue those actions only when the
next verification needs them, using one short instruction at a time.

## Definition of done

The adoption is locally complete only when all applicable items below have evidence:

1. The received Workflow-Kit source matches the supplied SHA and version and passes its own tests.
2. The target repository has a deliberate adoption diff with its `[P]` files installed and its
   repository-specific `[G]` files completed.
3. `core.hooksPath` resolves to `.githooks`, and the installed control test proves the pre-commit
   floor blocks and permits the intended cases.
4. `.codex/hooks.json` is generated for this checkout, ignored, and untracked.
5. The Owner has granted Codex hook trust interactively and
   `node scripts/check-codex-hooks-armed.mjs` passes. If the Owner has not done that, the result is
   `HOLD: CODEX HOOKS INSTALLED BUT INERT`, not completion.
6. The target's normal test command plus `doc:size` and `test:kit-controls` pass, or every baseline
   failure is named with the unchanged reason.
7. `core/BINDINGS.md` records dated, concrete Codex, Claude, and Gemini bindings and the actual
   invocation or manual handoff used for each review role.
8. Claude Code and Gemini have each produced a harmless, non-release verification receipt, or their
   unavailable state and the exact remaining Owner action are recorded without weakening the gate.
9. No secret, provider session, per-checkout hook registration, local ledger, `.bak`, or temporary
   review packet is staged.
10. The final report states whether the work is only local, committed, merged, pushed, deployed,
    activated, or live-proven. Never collapse these states.

## Procedure

### 1. Establish identity and a clean working lane

Read the target repository's existing `AGENTS.md` and other binding instructions first. Then record:

```sh
pwd
git status --short --branch
git remote -v
git rev-parse HEAD
git branch --show-current
```

If the directory is not a Git repository, ask whether to initialize it before any installation.
If there are unexplained changes or a competing writer, do not stash, revert, move, delete, or stage
their work. Use the repository's required private-worktree policy or ask the Owner if one file must
be shared.

For a substantial adoption, prefer a dedicated `codex/workflow-kit-adoption` branch in a private
Codex-owned worktree. Respect any existing worktree layout. Remember that each checkout needs its
own path-baked `.codex/hooks.json`; after a reviewed adoption is landed, run the initializer once in
the canonical checkout as well, without `--force`, then re-arm and re-check hooks there.

### 2. Verify the received kit before using it

From `<WORKFLOW_KIT_PATH>`:

```sh
git status --short --branch
git rev-parse HEAD
sed -n '1p' VERSION
npm test
npm run acceptance
```

For a Git delivery, require a clean checkout and an exact SHA match. For an exact-commit ZIP, require
the sender's ZIP checksum to have been verified and record that Git identity is unavailable inside
the archive. Require the expected `VERSION` either way. A failed or mismatched baseline is a HOLD;
do not install from an unverified source.

Read these source documents before constructing the install command:

- `README.md` sections “Adopt in three steps” and “The one thing you must not miss”;
- `PORTABILITY.md` sections “The enforcement asymmetry,” “External tool dependencies,” and “What is
  portable verbatim vs generated”;
- `bin/init.mjs --help`.

Do not start by reading every file in `core/`; the installed target's generated `AGENTS.md` supplies
the staged boot order.

### 3. Discover target-specific values

Inspect rather than ask for facts available in the repository:

- repository name and exact remote URL;
- default/deploy branch and whether pushing it deploys;
- top-level source directories; `--source-dirs` accepts top-level path segments, not nested paths;
- binding/current-state documents for `--state-docs`;
- existing test/CI commands and package-manager conventions;
- live behavior, production stores, irreversible assets, credentials, and message/send paths;
- existing Codex or Claude configuration that the installer must merge rather than replace;
- existing and intended worktree roots. Values passed to `--worktree-roots` must be absolute.

Ask the Owner only for judgment or access that inspection cannot settle: the preferred Owner name
and shorthand, deployment intent, reversibility claims, live-write boundaries, account availability,
and any risk acceptance.

Choose concrete current model IDs by capability, not friendly aliases. Record the verification date
in `core/BINDINGS.md`. Do not infer that the largest-sounding name is the correct capability tier.

### 4. Construct and review the first-install command

Run the initializer from the Workflow-Kit source, targeting the adopter. The adopter does not have
its own authoritative `bin/init.mjs` before installation.

```sh
node "<WORKFLOW_KIT_PATH>/bin/init.mjs" \
  --target "<TARGET_REPOSITORY_PATH>" \
  --repo-name "<REPOSITORY_NAME>" \
  --owner-name "<OWNER_NAME>" \
  --remote-url "<EXACT_REMOTE_URL>" \
  --deploy-branch "<DEPLOY_BRANCH>" \
  --source-dirs "<COMMA_SEPARATED_TOP_LEVEL_DIRS>" \
  --state-docs "<COMMA_SEPARATED_REPO_RELATIVE_DOCS>" \
  --worktree-roots "<COMMA_SEPARATED_ABSOLUTE_ROOTS>" \
  --with-gate-runners \
  --codex-cold-model "<CONCRETE_CURRENT_CODEX_MODEL>"
```

Omit a family flag only when its portable default is intentionally correct. If there is no remote
or no state-doc family, use only flags the help text supports; do not invent empty values. Do not
add `--force` on the first install. Capture the complete output and exit status because the
installer's post-run checklist is part of the adoption work.

`--with-gate-runners` is appropriate for a full multi-family adoption. It installs runners; it does
not install CLIs, authenticate accounts, grant hook trust, produce a verdict, or enable a provider.

### 5. Complete the generated repository bindings

Resolve every remaining placeholder in the generated `[G]` files, using facts from this target:

- root `AGENTS.md` and `CLAUDE.md`;
- `core/BINDINGS.md`;
- `core/REPO_INVARIANTS.md`;
- `core/SYSTEM_MAP.md`;
- `core/OWNER_COMMS.md`;
- `.claude/kit.config.json`;
- `.codex/agents/cold-reviewer.toml`.

Find unfinished placeholders with:

```sh
rg -n '\{\{[A-Z0-9_]+\}\}' AGENTS.md CLAUDE.md core .codex/agents
```

Do not replace portable `[P]` doctrine with personal preferences. Put repository/model/tool facts in
the generated bindings. Keep history out of the current architecture snapshot. Name known gaps
plainly instead of filling them with guesses.

### 6. Wire mechanical checks

Print the supported package-script fragment from the Workflow-Kit source:

```sh
node <WORKFLOW_KIT_PATH>/bin/init.mjs --print-package-scripts
```

Merge the relevant scripts into the target's existing `package.json`; never replace unrelated
scripts. Wire `doc:size` and `test:kit-controls` into its normal local and CI verification. If the
target is intentionally not an npm project, invoke the underlying Node commands from its native CI
runner and document the equivalent binding rather than creating a fake application toolchain.

Run at least:

```sh
git config --get core.hooksPath
node scripts/check-doc-size.mjs
node --test tests/*.test.mjs
git check-ignore --no-index .codex/hooks.json
git ls-files --error-unmatch .codex/hooks.json
```

Expected results:

- `core.hooksPath` prints `.githooks`;
- document and control tests exit `0`;
- `git check-ignore` exits `0`;
- `git ls-files --error-unmatch` exits nonzero because the per-checkout file must not be tracked.

Also run the target's pre-existing full test command. Compare failures by name and reason against the
pre-adoption baseline; a bare total is not enough.

### 7. Queue and verify Codex hook trust

The installer cannot grant consent. Tell the Owner:

```text
Open an interactive `codex` session from this exact target checkout. When it says “Hooks need
review,” choose “Trust all and continue.” Return here after that succeeds. Do not use a bypass flag.
```

Then run:

```sh
node scripts/check-codex-hooks-armed.mjs
```

Do not treat a clean `codex exec` as evidence: it silently skips untrusted hooks. If any hook bytes
later change, including through `init --force`, the Owner must grant trust again and this probe must
pass again.

### 8. Queue Claude Code only when its independent seat is needed

When local installation and target bindings are otherwise ready, inspect whether Claude Code is
already installed and signed in without exposing credential material. If it is missing or cannot
authenticate, queue one Owner action using current official installation/sign-in instructions. The
Owner signs into their own account directly.

For a Codex-built change, `core/BINDINGS.md` must name a concrete Claude Code code-gate invocation,
current model ID, and explicit effort. Reload or start a fresh Claude Code session after the installer
merges `.claude/settings.json`. Prove the lane against a harmless, deliberately blocked file-tool
probe and record whether the hook actually fired; installed configuration alone is not an armed
runtime receipt. If a safe live probe is not possible, record that limitation instead of claiming it.

Claude quota exhaustion or unavailability is not a verdict. Follow the repository's documented
substitution/escalation rule or HOLD; do not silently count another Codex pass as cross-family.

### 9. Queue Gemini only when its cross-family design seat is needed

Prefer the Owner's own Gemini subscription with a documented manual handoff when that satisfies the
chosen binding; it avoids transferring a secret. If the target deliberately binds the legacy `agy`
design runner, verify the current official CLI and authentication flow before asking the Owner to
install or sign in. Do not request `GEMINI_API_KEY` unless the Owner explicitly chooses a current,
supported API route and its cost.

The current kit routes Gemini to the **design-as-contract**, not the code diff. For strict frozen
exact-candidate packets, follow `core/GATES.md`'s active manual subscription export/import procedure:
the operator selects the specified subscription model, submits numbered packets in order, saves
exact UTF-8 replies, and the runner verifies the frozen tuple and response structure. The runner does
not cryptographically verify the human's account or UI model selection.

If the model named by the received kit is unavailable, stop that gate with `HOLD: REQUIRED GEMINI
SEAT UNAVAILABLE`. Do not silently change models or revive a historical transport command. A model
binding change is its own reviewed change.

### 10. Exercise the workflow without shipping anything

Use one harmless local example to prove the installed procedure:

1. Declare a fresh task lane using the installed `/lane-declare` procedure.
2. Classify the example with the four entry questions; record `entry: none` when it is not admitted,
   or record its tier when it is admitted.
3. Run the deterministic checks first.
4. Show where the cold, Gemini design, and Claude code seats would enter for that tier.
5. Demonstrate that a reviewer verdict is input to the PM's harm/real/scope/worth-it disposition,
   not automatic repair authority.
6. End before push, deployment, or any live write.

Use an example that requires no provider spending if provider enablement is still pending. Do not
manufacture a T2/T3 change merely to demonstrate the ladder.

### 11. Review the adoption diff and report

Before staging, inspect all new and modified files and run a secret/residue check. Stage only files
owned by this adoption; never blanket-stage. Leave these untracked/unstaged as applicable:

- `.codex/hooks.json`;
- local ledgers and `.claude/metrics/`;
- `.gemini-gate/` packets and replies;
- `.bak` files;
- credentials or local provider state.

Return a report in this form:

```text
ADOPTION STATUS: COMPLETE | HOLD
Kit: version <v> · source <sha/checksum>
Target: <remote> · branch <branch> · target head <sha>
Installed: <summary of P and G surfaces>
Placeholders: zero | <exact remaining list>
Mechanical: target suite <result>; doc:size <result>; kit controls <result>
Pre-commit floor: core.hooksPath=<value> · control test <result>
Codex hooks: installed <yes/no> · trusted <yes/no> · armed probe <result>
Claude seat: bound <exact model/invocation or HOLD> · live receipt <result>
Gemini seat: bound <exact model/transport or HOLD> · live receipt <result>
Lifecycle: local only | committed | merged | pushed | deployed | activated | live-proven
Secrets/residue: <none, or exact paths excluded>
Owner decisions/actions still needed: <exact list>
```

Do not push, merge, deploy, or activate as part of this ticket unless the Owner separately and
explicitly authorizes the named action on the reviewed candidate.

## Upgrade rule after adoption

A future upgrade is not “run the installer again and hope.” Read the new release's upgrade section.
When `--force` is required, first read every existing family from `.claude/kit.config.json`, pass all
of those families explicitly, review the `.bak` files, restore intentional repository-owned text,
and re-grant Codex hook trust because changed hook bytes disarm the lane. A plain re-run that reports
stale mechanism files is a failed upgrade, not a warning.
