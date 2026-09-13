# Ticket: Guided Mac Setup and Workflow-Kit Adoption

Copy this entire ticket into a local Codex task. No Git, Node.js, Codex CLI, provider integration,
or existing project repository is assumed. If a target project is already known, open its folder;
otherwise start in a separate setup folder, not inside the received Workflow-Kit source. Codex must
help discover or choose the target before installing the kit. Unknown inputs are allowed.

If no local Codex session can run yet, use the sender's first-start instructions to get one open.
Codex cannot inspect a Mac from a conversation that has no access to it. If local access is missing,
explain that limitation and guide the Owner through enabling the supported local environment, or
through one read-only check at a time; never claim an inspection you could not perform.

## How to guide this Owner

The Owner is technically literate but is not a coder. They may not know which tools, versions,
accounts, subscriptions, or integrations are already configured on any of their Macs. Discover
those facts rather than asking them to produce a technical inventory.

- Explain each unfamiliar term when it first matters: for example, a repository is a project folder
  with Git history; a CLI is a tool run through Terminal; a hook is an automatic check before an action.
- Begin with a short roadmap: discover this Mac → fill missing prerequisites → install into one
  project → enable reviewers and hooks → verify together. Do not present the entire procedure as a
  list of homework for the Owner.
- Run safe checks and authorized local work yourself. Reuse working installations and skip steps
  already verified; do not reinstall or upgrade everything by default.
- When the Owner must act, give one actionable step: why it is needed, exactly where to click or
  what command to run, what success looks like, and any cost or system change. Fill in known paths
  yourself. Explain how to open Terminal or find a folder if needed; do not hand them placeholders.
- Wait for the result of that human step, verify it, and then give the next dependent step. If it
  fails, explain and diagnose that failure before proceeding. Continue unrelated safe work meanwhile.
- Keep a short checklist with VERIFIED, NEEDS SETUP, WAITING FOR OWNER, or BLOCKED for each component.
  Separate installed, signed in, configured, and tested. Before any restart, give a resumable summary
  of completed checks, pending actions, the Mac, and the exact project folder.
- Start with one Mac and one target project. Ask which Mac is first if that is unclear. Other Macs
  require their own inventory, sign-ins, path bindings, and hook verification; do not assume they
  match or copy credentials or per-checkout hook files between them.

## Inputs

```text
Workflow-Kit source path: <WORKFLOW_KIT_PATH>
Source delivery: <PRIVATE_CLONE_URL or ZIP_PATH, or UNKNOWN>
ZIP SHA-256 if applicable: <CHECKSUM_FROM_SENDER or NOT_APPLICABLE>
Expected handoff commit: <HANDOFF_SHA_FROM_SENDER>
Expected kit version: <VERSION_FROM_SENDER>
Target repository path: <TARGET_REPOSITORY_PATH or HELP_ME_CHOOSE_OR_CREATE>
Mac to set up first: <CURRENT_MAC or OWNER_CHOICE_NEEDED>
Owner name: <OWNER_NAME>
Target remote URL: <URL or UNKNOWN>
Deploy branch and effect: <branch and what a push does, or UNKNOWN>
```

## Objective

Guide the Owner from an unknown Mac setup to a verified local adoption. Discover and complete the
prerequisites, adopt the received Workflow-Kit into one agreed target repository, configure it for
this repository and this Mac, prove its mechanical controls, and leave a receipt that distinguishes:

- Mac compatibility and the actual Git, Node.js/npm, and Codex CLI installations verified;
- files installed;
- Git commit-hook floor configured;
- Codex hooks trusted and verified armed;
- Claude and Gemini review seats available and bound;
- review methodology documented;
- the Astra planning → Sol supervision → Terra code / Luna gathering profile configured and tested;
- push, deployment, activation, and live writes, none of which are implied by local setup.

Continue through every safe, local, reversible step. Stop only for a genuine Owner action or
decision, while continuing unrelated setup work that does not depend on it.

## Authority and hard boundaries

You may inspect both repositories, create a task branch or private task worktree, run the installer,
edit the target repository's generated configuration and documentation, merge package scripts with
care, and run local tests.

Within the approved setup scope, existing access, and agreed provider budget, also handle worker
dispatch, local commits and eligible local integrations, review preparation and permitted in-scope
Gemini/Claude transmissions without asking permission for each step. Capture that authority once;
do not repeat an unchanged approval request. A local integration is not a remote PR merge, push,
deployment, activation, or live write. Exclude secrets, live data, and unrelated material from
review packets. Drafting a linked successor ticket does not authorize executing it.

You may also perform scoped, read-only checks of the current Mac's relevant tools and non-secret
configuration. Inspect only setup-relevant locations, not unrelated personal files or credential
stores. Explain and obtain approval for a prerequisite installation or a change outside the target
repository before doing it; then carry out the approved work when your tools permit it. A missing
prerequisite is a setup step to guide, not a reason to abandon the ticket.

Do **not**:

- modify the received Workflow-Kit source;
- copy generated `[G]` files from any other adopter repository;
- use `--force` for a first installation;
- overwrite unexplained dirty work or another lane's files;
- replace a working toolchain, edit global Git identity or shell startup files, install a package
  manager, or change another project's configuration without approval for that specific change;
- install system/global software, authenticate a provider, spend unapproved metered API credit, push, remotely merge,
  deploy, or perform a live/production write without the Owner's explicit approval for that act;
- ask the Owner to paste credentials into chat or expose a token in a command transcript;
- silently substitute another model or model family when a required gate seat is unavailable;
- report a provider as enabled merely because a script, hook, or configuration file exists.

The Owner performs GUI approvals, administrator-password entry, and provider sign-ins directly.
Queue those actions only when the next verification needs them, using one short instruction at a
time. Never disable macOS security, bypass organizational restrictions, or weaken gate controls to
make setup pass. A managed-Mac restriction requires the appropriate administrator's help.

## Definition of done

The adoption is locally complete only when all applicable items below have evidence. A missing
required tool, unverified hook, or unavailable required reviewer leaves the overall result HOLD,
even when the remaining local installation work is finished.

1. This Mac's prerequisite checklist is verified: compatible runtime, working Git, Node.js/npm,
   Codex CLI and sign-in, and the dependencies actually required by the selected review routes.
   The received Workflow-Kit source matches the supplied SHA and version and passes its own tests.
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
8. The same-family cold reviewer, Claude Code, and Gemini have each produced a harmless, non-release
   verification receipt through the configured route. Any unavailable state and exact remaining
   Owner action are recorded as HOLD, without weakening the gate.
9. No secret, provider session, per-checkout hook registration, local ledger, `.bak`, or temporary
   review packet is staged.
10. The final report states whether the work is only local, committed, merged, pushed, deployed,
    activated, or live-proven. Never collapse these states.

## Procedure

### 0. Discover this Mac and guide the missing prerequisites

Do this before running Git, npm, or installation commands from later steps. First confirm the
current machine and the folder you can access, and read any applicable local instructions. Ask
about the intended project in ordinary language; do not assume the setup folder is the target.

#### A. Inspect before installing

Build a compact inventory from read-only evidence:

| Component | What to establish |
| --- | --- |
| Mac and access | macOS version, Apple Silicon or Intel, current shell, relevant folder permissions, and whether an administrator must approve installations. No serial number is needed. |
| Git | Actual executable and version; whether Apple's developer tools are usable; existing project history and local commit identity when a target is known. Git software and a Git-host account are separate things. |
| Node.js and npm | Actual executable paths and versions, installation manager if any, and compatibility with the received kit. Node runs the kit's scripts; npm runs its named checks. |
| Local Codex and Codex CLI | The running application's local access, the separately invocable `codex` command and version, non-secret sign-in status, and support for the kit's required hooks and review commands. A working app does not prove the CLI works. |
| Existing install tools | Relevant developer tools, package managers, and version managers already in use. Do not introduce a second installation route merely because it is familiar. |
| Claude and Gemini | Installed tools where relevant, available account access, selected review transport, and what still needs sign-in or permission. Do not inspect private sessions or infer account access from app icons. |
| Kit and target project | Where the delivered source is, whether private Git access or a ZIP is being used, and which separate project folder will adopt the method. |

Use simple checks such as `sw_vers`, `uname -m`, `command -v`, and a tool's `--version` only where
supported. Check command availability before invoking it; a missing command is an expected inventory
result. A Mac may have an Apple Git stub that requests developer tools on first use: treat the
prompt as a guided installation, not as proof Git is ready. Do not dump environment variables,
authentication files, or full configuration containing secrets. If `rg` or another convenience tool
is absent, use an available equivalent; install it only if the chosen workflow truly requires it.

Read available kit metadata and relevant runner requirements before selecting versions. Inspect
required helper commands too; do not invent a dependency from habit. Verify installation and
authentication instructions against current official provider documentation, with the URL and
check date in the setup record. Starting points for OpenAI are the
[desktop setup guide](https://learn.chatgpt.com/docs/app) and
[Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli). For other tools, use their own official
documentation. If the needed capability is undocumented or unavailable, say so rather than trying
historical commands or unapproved alternatives.

#### B. Fill gaps in dependency order, one guided step at a time

1. Resolve any local-access or compatibility problem first. Explain the smallest supported route;
   request approval before an OS change, administrative install, or replacement of working software.
2. Install or repair Git if needed, using an official route suitable for this Mac. Verify that
   `git --version` actually succeeds. Guide Git-host sign-in only if the chosen private delivery needs
   it; do not require GitHub, SSH keys, or the `gh` CLI for a local-only or ZIP delivery.
3. Install or repair a compatible Node.js and npm if needed. Preserve the existing version manager
   where practical. Verify `node --version` and `npm --version` in the environment Codex actually
   uses. If an app restart or shell refresh is required, guide it and resume the checklist afterward.
4. Install or repair the Codex CLI if needed, using the current official route and Owner approval.
   Do not assume the desktop application made `codex` available on the command search path. Verify
   the executable, version, sign-in, and required CLI features; guide browser login directly. Distinguish
   existing subscription access from paid API access, and never choose the latter without approval.
5. Inventory Claude and Gemini access now, but perform their guided installation/sign-in and actual
   route checks in steps 8–9, once the kit's bindings are prepared. These steps are part of setup,
   not work to defer until the Owner later encounters a failed gate.

Do not require Homebrew, a full Xcode installation, a Gemini CLI, or a paid API account unless the
chosen supported route needs it. Installing npm packages may run installation scripts; explain and
approve that software installation just as you would any other. Before a provider test, explain
what non-sensitive material will be sent and whether it uses subscription allowance or metered
credit, and obtain any required authorization.

#### C. Locate the source and choose one target project

Help retrieve the private source or locate the received ZIP. Verify the sender's checksum before
extracting a ZIP into a new, dedicated folder; never extract over existing work. If source identity
details are missing, obtain them from the sender before running kit scripts.

Explain the difference between the Workflow-Kit source (the reusable installer and method) and the
target repository (the Owner's project). Help the Owner locate an existing project, clone an agreed
remote into a new folder, or choose a new local project folder. If they have no project yet, propose
a harmless local practice project and obtain approval; do not invent a product or adopt into their
home folder, Downloads, or the kit source. Remote publication is not required for local adoption.

Open or continue the task in the agreed target folder before kit installation, carrying forward the
verified checklist. Record the kit-source and target paths separately. If this requires a new task,
give an exact continuation prompt so the Owner does not have to repeat discovery.

### 1. Establish identity and a clean working lane

Read the target repository's existing `AGENTS.md` and other binding instructions first. Then record:

```sh
pwd
git status --short --branch
git remote -v
git rev-parse HEAD
git branch --show-current
```

If the directory is not a Git repository, explain and ask whether to initialize Git before kit
installation. For a newly initialized repository, a missing `HEAD` is expected; do not invent a
commit SHA or attempt a worktree until there is a commit. Explain and obtain approval for any needed
initial checkpoint, stage only the agreed files, and verify the identity used for it. Prefer
repository-local Git identity changes over altering the Owner's global settings.
If there are unexplained changes or a competing writer, do not stash, revert, move, delete, or stage
their work. Use the repository's required private-worktree policy or ask the Owner if one file must
be shared.

For a substantial adoption, prefer a dedicated `codex/workflow-kit-adoption` branch in a private
Codex-owned worktree. Respect any existing worktree layout. Remember that each checkout needs its
own path-baked `.codex/hooks.json`; after a reviewed adoption is landed, run the initializer once in
the canonical checkout as well, without `--force`, then re-arm and re-check hooks there.

### 2. Verify the received kit before using it

From `<WORKFLOW_KIT_PATH>`, after prerequisites are verified, check Git identity only for a Git
delivery (not an extracted ZIP):

```sh
git status --short --branch
git rev-parse HEAD
```

For either delivery, check the version and run the source checks:

```sh
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

Also record the target's existing test baseline before adoption changes, using its documented
toolchain. If dependencies are missing, guide their approved installation first. Do not create a
fake application test suite for an empty practice project; record that no pre-existing suite exists.

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

Configure the agreed execution profile: the Owner plans with Astra; after plan approval, Sol owns
the ongoing implementation conversation. Terra is the code/test/repair Builder; Luna handles
gathering, extraction, inventory, and well-specified bulk work. Astra returns for bounded critical
decisions and mandatory process reviews, not continuous build supervision. Verify the active model
at the handoff and each worker's actual model and effort; a worker named “Terra” may inherit Sol
unless explicitly configured. Preserve the approved plan, acceptance evidence, tier, exclusions,
gate history, and remaining authority across the model change. Missing model access is a named
setup gap, not permission to substitute silently or keep all implementation in Astra.

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

Verify that the running clients actually discover the installed skills, prompts, and reviewer
definitions. Check the received kit's portability notes for dependencies the installer does not
copy; for example, the v2.30.1 `sweep` skill needs its runner and `sweepSeat` binding arranged
separately. Resolve required setup dependencies or record a specific HOLD; a copied skill file is
not proof that its command can run.

Find unfinished placeholders with:

```sh
rg -n '\{\{[A-Z0-9_]+\}\}' AGENTS.md CLAUDE.md core .codex/agents
```

Do not replace portable `[P]` doctrine with personal preferences. Put repository/model/tool facts in
the generated bindings. Keep history out of the current architecture snapshot. Name known gaps
plainly instead of filling them with guesses.

Bind planning, implementation PM, code Builder, gathering worker, frontier consultation, and each
independent review role separately. Record exact model IDs, effort, verified access, and invocation.
Terra must retain the raw source needed for its assigned T2/T3 authoring; Sol must inspect the actual
changes and decisive evidence, not only worker summaries. Luna's economy does not lower the gate
floor. Record Owner approval of the plan, tier/risk and routine local/review authority together.
Critical design/intent changes, material scope/budget, new credentials, destructive acts, fresh
push/deploy GO, and required live-write/activation GO remain Owner decisions. Platform trust and
security prompts cannot be bypassed by this standing authority.

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

The installer cannot grant consent. Explain what hook trust permits, show the exact target folder,
and guide the Owner through opening Terminal and entering an exact `cd` command if needed. Then tell
them the next step, using the actual installed client's supported trust interface:

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

If the documented prompt does not appear, inspect the installed version and current official hook
instructions; do not repeatedly ask the Owner to look for a missing button or use a bypass. Verify
the trust and arming state in the exact checkout they will use, not just the setup worktree.

### 8. Guide Claude Code setup and verify its review route

When local installation and target bindings are otherwise ready, inspect whether Claude Code is
already installed and signed in without exposing credential material. If it is missing or cannot
authenticate, queue one Owner action using current official installation/sign-in instructions. The
Owner signs into their own account directly.

Explain that a Claude website login or desktop app alone does not establish a working Claude Code
review command. Configure the supported invocation Codex will actually use. If it depends on an
optional plugin, explain that dependency and request installation approval; do not assume the
sender's plugins exist or install unrelated integrations. A direct supported CLI route may be
sufficient. Keep this bounded to the binding chosen for this adopter.

For a Codex-built change, `core/BINDINGS.md` must name a concrete Claude Code code-gate invocation,
current model ID, and explicit effort. Reload or start a fresh Claude Code session after the installer
merges `.claude/settings.json`. Prove the lane against a harmless, deliberately blocked file-tool
probe and record whether the hook actually fired; installed configuration alone is not an armed
runtime receipt. If a safe live probe is not possible, record that limitation instead of claiming it.

Then, with permission for the provider use, invoke the configured Claude review route from this
Codex workflow against a small, non-sensitive local example. Verify that Claude itself inspected the
intended material and returned a usable result. A login or version check is not that review receipt.
Also verify the configured fresh Codex same-family cold-review route; Claude does not replace it.

Claude quota exhaustion or unavailability is not a verdict. Follow the repository's documented
substitution/escalation rule or HOLD; do not silently count another Codex pass as cross-family.

### 9. Guide Gemini setup and practice the review handoff

Use the Owner's Gemini subscription through the documented automated `agy` frozen-review transport
for approved nonpublic review packets, or choose its strict manual handoff for high-sensitivity work.
Verify the current official CLI and authentication flow before asking the Owner to install or sign in.
Do not request `GEMINI_API_KEY`: the current frozen route has no supported API/REST option.

The current kit routes Gemini to the **design-as-contract**, not the code diff. For frozen
exact-candidate packets, use the normal subscription-only `agy` transport in its disposable
request-review rig; the runner verifies the frozen tuple, transport identity, response structure, and
receipt. Use `core/GATES.md`'s strict manual export/import procedure instead for high-sensitivity
work; the manual UI account and model selection remain operator-attested, not cryptographically
verified by the runner.

Practice the chosen route with a small, non-sensitive packet and provider permission. For automated
use, verify the exact `agy` rig and receipt; for manual fallback, open the correct service, select the
required model, submit ordered packets, save each reply unedited, and verify import before continuing.
Do not request an API key for either route.

If the model named by the received kit is unavailable, stop that gate with
`HOLD: REQUIRED GEMINI SEAT UNAVAILABLE`. Do not silently change models or revive a historical transport command. A model
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
6. Verify an explicitly selected Terra worker and Luna gathering worker through harmless scoped
   tasks, and confirm Sol is the implementation PM. Preserve the evidence of actual model identity.
7. Explain the finite controller using its installed tests: a panel is one aggregate round, not
   one round per reviewer; Round 4 remains terminal, with required fresh Astra review beforehand.
   After terminal Round 4 STOP, the exception requires a fresh Astra zoom-out and Sol recommendation
   naming concrete harm, the smallest correction, fixed scope, and completion proof. The Owner
   approves that bounded packet once. The linked successor gets one repair batch and the required
   final review, preserving the closed parent and cumulative history. It grants no fresh
   four-round budget, repeat exception, or automatic scope expansion. Verify the shipped deny/allow
   tests for this limit; do not manufacture approvals or repair-ledger events in the real project.
8. End before push, deployment, or any live write.

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
Mac: <Owner-friendly label> · macOS <version> · architecture <value>
Prerequisites: Git <path/version/result>; Node/npm <paths/versions/results>; Codex CLI <path/version/sign-in/result>
Kit: version <v> · source <sha/checksum>
Target: <remote> · branch <branch> · target head <sha>
Installed: <summary of P and G surfaces>
Placeholders: zero | <exact remaining list>
Mechanical: target suite <result>; doc:size <result>; kit controls <result>
Pre-commit floor: core.hooksPath=<value> · control test <result>
Codex hooks: installed <yes/no> · trusted <yes/no> · armed probe <result>
Cold same-family seat: bound <exact route/model or HOLD> · practice receipt <result>
Claude seat: bound <exact model/invocation or HOLD> · live receipt <result>
Gemini seat: bound <exact model/transport or HOLD> · live receipt <result>
Lifecycle: local only | committed | merged | pushed | deployed | activated | live-proven
Secrets/residue: <none, or exact paths excluded>
Owner decisions/actions still needed: <exact list>
Next use: <exact project folder and how to start>; next pending setup step <action or NONE>
```

Lead with a short plain-language explanation of what the Owner can safely use now, what is still
pending, and their next action. Keep the technical receipt underneath it. Finish with a brief
walkthrough of starting the next project task, recognizing a hook approval or review request, and
resuming if a provider is unavailable. A second Mac is a separate setup, not automatically complete.

Do not push, merge, deploy, or activate as part of this ticket unless the Owner separately and
explicitly authorizes the named action on the reviewed candidate.

## Upgrade rule after adoption

A future upgrade is not “run the installer again and hope.” Read the new release's upgrade section.
When `--force` is required, first read every existing family from `.claude/kit.config.json`, pass all
of those families explicitly, review the `.bak` files, restore intentional repository-owned text,
and re-grant Codex hook trust because changed hook bytes disarm the lane. A plain re-run that reports
stale mechanism files is a failed upgrade, not a warning.
