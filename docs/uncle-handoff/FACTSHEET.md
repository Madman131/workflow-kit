# Workflow-Kit Factsheet

Handoff edition · 13 September 2026 · Kit v2.32.0

## Purpose

Workflow-Kit helps AI agents build reliable software without letting review and repair become
an endless project of their own. It combines a working method, independent reviews, and
automatic checks that keep changes tied to the human's intent.

A **repository** is a project's files and version-controlled history. The kit installs its
instructions and controls into that repository, then adapts the configuration to your project,
computer, and AI accounts. It is not a standalone application or an autonomous deployment service.

## Core loop: Plan → Gate → Maintain

- **Plan:** agree on the outcome, how to prove it works, and how much review the risk requires.
- **Gate:** review the plan and implementation, assess findings, and authorize justified repairs.
  A gate is a checkpoint; passing it does not authorize every later action.
- **Maintain:** keep current state, decisions, and failure knowledge readable so the next AI
  conversation can continue accurately.

The repository calls these stages **Steer → Gate → Garden**. This factsheet uses the
plain-language names; the underlying method is the same.

## Roles: who does what

- **Owner — you:** plan with Astra, approve the plan and risk, decide critical design changes,
  and authorize publishing and live actions.
- **Astra — planning and consultation:** help design the project, then advise at critical decisions
  and required process checkpoints. Astra is a **frontier model**, the highest-capability class;
  it does not remain the ongoing build conversation.
- **Sol — Orchestrator / Project Manager (PM):** run implementation, coordinate workers and reviews,
  decide which findings need repair, and inspect the actual changes and decisive evidence.
- **Terra — Builder:** write code, tests, and repairs, keeping the relevant source in its own
  conversation. Its self-check is not independent review.
- **Luna — gathering and bulk work:** find, extract, and organize information for the other roles;
  it does not replace required reviewers or decide architecture.
- **Reviewers — fresh AI conversations:** challenge the plan or implementation and report evidence.
  They identify problems; they do not authorize repairs.

Larger projects are divided into **chips**: bounded tasks with a named outcome, scope, and proof
of completion. Workers cannot independently expand those tasks or start chains of repairs.

Within the approved plan, Sol handles tests, local commits and eligible local merges, review
requests, in-scope Gemini/Claude transmissions, and permitted repairs without asking you at every
step. It can draft linked follow-up tickets, but cannot use them to start unapproved work. You
retain new scope or budget, credentials, destructive actions, terminal exceptions, and fresh
push/deploy and required live-write approvals. Software permission prompts may still require you.

## Gate Categories

Every proposed change is screened with four questions:

1. **Irreversible or live:** could it perform a consequential action that cannot simply be undone?
2. **Silent failure:** could it fail while appearing successful, like a broken check or alarm?
3. **Spread beyond this repository:** could an error propagate through a template or installer?
4. **Instructions someone will implement:** will a person or AI act on these words, including resolving ambiguity?

Four **NOs** use ordinary build, test, and reversibility checks without an AI panel. Any **YES**
enters the categories below; uncertainty counts as YES. The repository calls these categories
**tiers**. Production means the live system and its real data, rather than a test copy.

| Category | Typical admitted change | Review depth |
| --- | --- | --- |
| T0 — Trivial | Local, non-code work | Checks before work and a self-check. |
| T1 — Minor | Local code, tools, or bounded read-only work | One fresh reviewer, cross-family by default. |
| T2 — Major | Reversible production changes, live behavior, or stateful control logic | Pre-code design review, cold panel, cross-family lens when available, and external code gate. |
| T3 — Critical | Irreversible production writes, including code that will perform them | Strongest panel; both different-family review roles required. |

Risk depends on consequences and recovery, not change size. **Reversible** means a named, tested
way to restore the previous state, confirmed by the Owner; an untested backup is insufficient.
Unbounded production reads can also be T3 because they can exhaust resources. The Owner ratifies
T2/T3 and separately authorizes code pushes and live writes.

Instructions are assessed by what someone would do after following them. Binding plans and process
changes receive a full T2 design panel and Owner wording sign-off, with deeper review for higher
risk. Prose is reviewed as a design, not through a code-only gate that ignores it; embedded
executable content still owes its code gate. Gate-rule changes also require a concrete test of
whether an AI could follow the rule and still cause the failure.

## How gating works

### Plan and design before code

At T2/T3, a different-family model challenges the project plan and its **falsifiable contract**:
requirements precise enough that a test or counterexample can show a violation. “Retrying must not
create a second payment” is testable; “handle retries safely” is too vague.

The reviewer challenges the requirements as well as the solution. **Invariants** are properties
that must remain true, such as not charging twice. Before independent implementation review, the
builder runs tests and a **kill-pass** — a deliberate attempt to break its own work. This does not
reduce the required panel.

### Review the exact work with fresh context

A **frozen candidate** is the exact version under review, identified by a Git fingerprint
(a **SHA**) and a defined file scope. A **review packet** supplies the actual files, requirements,
and rules, excluding credentials, live data, and unrelated material. New code does not inherit
an old version's approval.

**Cold Review (a fresh review by an AI from the same model family as the builder):**
The reviewer examines the work, its requirements, and the rules it must follow in a new
conversation. It receives no build history, builder's reasoning, or earlier review verdicts,
helping it form its own assessment. For example, a fresh Codex reviewer checks work built by Codex.

That describes the T2/T3 same-family panel; T1's single cold reviewer is cross-family by default.
Known history or memory injected by the tool must be recorded: a fresh conversation is not a
guarantee of zero prior exposure.

**Blind discovery** is the first pass, without earlier findings or the builder's rationale.
One **free-roaming adversary** looks for any failure, including requirements the plan omitted.
Other reviewers cover assigned angles such as correctness, security, and recovery. The cold-panel
minimum is that free reviewer plus two angle reviewers at T2, or three at T3. A later
**folded review** may use earlier findings to check repairs; it cannot replace blind discovery.

### Add a different model family

**Cross-Family Review** uses another model family to catch blind spots shared by the builder and
its fresh reviewers. For T2/T3 code work, the normal route is:

| Builder | Pre-code design | Same-family cold panel | External code gate |
| --- | --- | --- | --- |
| Codex | Gemini | Fresh Codex reviewers | Claude Code |
| Claude | Gemini | Fresh Claude reviewers | Codex |

Gemini also provides a code-stage lens against the contract: when available at T2, required at T3.
The external code gate is the separate concluding review after cold passes. Neither replaces
the same-family panel, and design approval is not implementation approval.

**Decorrelation** means reducing shared blind spots by varying context, family, and review angle.
Evidence must also come from the real target environment: an installer should be tested in an
adopter repository, not only in its own checkout. The orchestrator verifies reviewer identity,
source access, and findings; a completed model response alone is not a passed gate.

## How it avoids recursive gating loops

An adversarial reviewer can always suggest another improvement. The process ends on an
evidence-based decision, not on reviewers running out of comments.

A **changeset** is the bounded task under review, not each new file version. A **round** collects
one full panel's results. T3 is a risk category; Round 3 is a review cycle. The finite repair
controller below governs T2/T3 work.

### 1. Only the orchestrator decides what needs repair

A **finding disposition** is the orchestrator's recorded decision after a verdict and before any
repair. It asks these questions in order; the first justified exit prevents unnecessary work.

| Question | What the orchestrator must establish |
| --- | --- |
| HARM? | Does this hurt the Owner/user, product usability, or code functionality? By what mechanism? |
| REAL? | Can it happen within the supported uses and risks — the **declared threat model**? What inputs or sequence trigger it? |
| SCOPE? | Does it concern the requested feature or a genuine requirement, rather than rules or repair machinery the AI invented? |
| WORTH IT? | Does the likely harm outweigh the time, model cost, complexity, and new defects the repair could introduce? |

The decisions are **REMEDIATE** (fix now), **NOTE** (no demonstrated harm), **DEFER** (a justified
later or out-of-model route), **DECLINE** (false or unsupported), or **ESCALATE** (the Owner must
decide intent or risk). A reviewer's “NO-GO” is evidence, not a work order.

This is **Rule #1**: “a reviewer mentioned it” is not enough to trigger another build. If the
problem exists only in an invented process sentence, correct that sentence instead of complicating
working software. Genuine safety requirements cannot be removed this way.

Safeguards prevent dismissing real failures:

- Irreversible actions, production-write boundaries, and insufficient review are screened before
  the harmless-note exit. Confirmed material correctness, security, safety, recovery, contract,
  data-origin, or control failures must be repaired or held and escalated.
- Every REMEDIATE names **HARM** and **TRIGGER**. For instructions, that means who follows the words
  and what wrong action results. A fix closes only when its original trigger is retested and no
  longer fails; an unrelated passing test is insufficient.
- Rejecting or deferring a serious finding requires the strongest case tried and why its harm
  or trigger does not hold. “I disagree” is insufficient.
- Findings with no notes, or a round marking everything REMEDIATE, require an in-thread self-audit.
  They do not automatically interrupt the Owner.

### 2. One repair batch per round, then address the shared cause

Collect the full panel before authorizing one bounded repair batch. Do not fix and rerun reviewers
one by one.

| Round | What can happen |
| --- | --- |
| Round 1 | One bounded repair batch. Repeated underlying mechanisms require a shared-cause correction immediately. |
| Round 2 | Remaining harm requires one root replacement, simplification, or split, with explicit completion evidence. |
| Round 3 | Test that consolidated correction. Obtain frontier process review before authorizing work leading into Round 4. |
| Round 4 | Final review of this changeset. No outgoing repair batch: GO if no accepted blocker survives; otherwise STOP. No Round 5 within the same changeset. |

A **root-cause correction** replaces or simplifies the shared failure mechanism, removes obsolete
workarounds, and retests the original triggers. It is not a collection of symptom patches renamed
“root cause.”

Work can close earlier without accepted harm, or stop earlier for critical harm. Another ordinary
round needs new harm-bearing findings; Round 4, once reached, is mandatory. Root-replacement
candidates and the final check receive the full panel agreed in advance.

At the final check, blockers whose triggers no longer apply are recorded as such. A trigger that
still produces a protected material failure forces STOP; it cannot be relabeled harmless to obtain GO.

**Bounded completion exception:** a small, real defect may justify finishing after terminal Round 4 STOP. Astra
reviews the situation; Sol recommends named defects, the smallest correction, fixed scope, and
proof of completion. You approve once. A separate **parent-linked successor** keeps the original
task closed and carries its review history. It gets **one repair batch and the required final
review**, not four fresh rounds. Sol handles the routine steps. If it fails or grows, work stops;
there is no automatic repeat or “Cycle 2.”

### 3. Frontier review before progressing beyond Round 3

A **frontier process review** is a fresh, highest-capability review of the repair plan and whether
to continue — not merely another code review. It checks the original user outcome, the root
correction, and whether further work is justified.

For this handoff, the designated frontier names are **Astra for Codex** and **Fable for Claude**.
Setup must verify account access and concrete model IDs in the adopter's dated
`core/BINDINGS.md`; the portable requirement is the capability, not a permanent model name.

Before authorizing repair leading into Round 4, obtain a fresh ruling tied to the exact candidate,
latest panel, and proposed action:

- **Finish the bounded root correction:** permit that one specific finish.
- **Successor:** stop current repair. Later work requires terminal closure of the parent and
  explicit Owner authorization for a separate, linked task.
- **Owner decision:** no current repair dispatch is authorized.

Consult the frontier earlier at Round 2 if the correction changes the design, makes a product
tradeoff, or needs more than one additional repair round.

Renaming tasks, swapping reviewers, or freezing another version does not reset the count.
Successors retain their **lineage** — linked history and cumulative gate count. Before cumulative
gates **4, 8, 12, and so on**, a fresh process review is required. These are checkpoints across
linked tasks, not permission to run Round 8 of a task that should have stopped at Round 4.

### 4. Screen the next action too

An **ACTION-SCREEN** records the surviving defect, harm, real trigger, and smallest useful action
behind a NO-GO, continuation, successor, or added control. Creating another task is not an escape
from proving the work is needed.

**Zoom-in** checks the local fix. **Zoom-out** checks the original user outcome.
**KISS — Keep It Simple** favors deletion, simplification, or narrower scope when these solve the
problem. If repairs become the main product or defect source, narrow, simplify, split, or escalate.

### 5. Enforce the recorded sequence with the compliance hook

A **hook** runs automatically before a supported action. The compliance hook,
`guard-brief-rung.mjs`, works with a **repair controller** and durable **ledger** (recorded history)
to check whether another repair is permitted:

1. Record the frozen version and full reviewer roster, then collect its results.
2. Record the orchestrator's decision for every finding and any required root correction or frontier ruling.
3. Prepare a **repair brief** — the worker's written instructions — with a fresh, session-specific
   verification record, command/output evidence, and a single-use identifier.
4. Confirm the actual brief text, candidate, and authorized paths. The worker verifies that receipt
   from its own session before editing.
5. Check supported writes against that permission and the controller's current state.

This can block incomplete panels, stale or mismatched receipts, second repair batches, missing
required reviews, and continuation of terminal tasks. The ledger spans the repository's worktrees;
a new working folder does not reset the history. An Owner-linked successor needs its own
authorization and action-screen record, cannot lower the parent's tier, and leaves the parent closed.

The hook verifies records, not whether the reasoning or claimed review is truthful. It covers
supported tools, not arbitrary shell writes or human editors. Evidence checks and Owner spot-checks
remain essential; installed hooks must also be enabled. The reference section below explains those limits.

## What gets installed, and how the method stays usable

The kit separates reusable method from project-specific facts:

- **Entry instructions:** root `AGENTS.md` and `CLAUDE.md` tell each AI where to start.
- **Portable method:** reviewed rules in `core/`, reused unchanged between projects.
- **Project bindings:** `BINDINGS.md` maps models, tools, access, and commands;
  `REPO_INVARIANTS.md` states must-hold properties; `SYSTEM_MAP.md` describes current architecture;
  `OWNER_COMMS.md` sets your communication preferences. These files are generated for your project,
  not copied from the sender's.
- **Working tools:** hooks, tests, skills, and selected review runners. A runner's installation
  does not install or authenticate its provider.

Each skill has one shared body under `.agents/skills/`. Claude receives repository-local
**shims** (pointers to it); Codex receives matching user-level prompt files, outside the repository
by default. Setup must verify what the client actually loaded, including existing files the
installer preserved.

Maintenance keeps current state separate from history, records demonstrated failures and recovery,
and provides verified handoffs to new conversations. Binding instructions stay bounded and are
read completely; reference manuals are consulted when needed. No autonomous maintenance scheduler
is installed.

Three principles keep the method proportionate:

- **The librarian rule:** scripts store, route, and check objective facts; AI judges meaning.
  Checking that a HARM field exists is not deciding whether the harm is real.
- **Diverse inputs, consistent decisions:** different families can generate alternatives to hard
  questions, while the lead AI remains the decider. Critical review retains a family that did not
  help generate the proposal.
- **Cost discipline:** use inexpensive models for gathering and workhorse models (balanced cost
  and capability) for routine cross-family gates; exceptional irreversible, money, or credential risks use frontier models.
  Plan with Astra, then use Sol to supervise Terra and Luna; do not keep the build in Astra.
  One discretionary frontier review is allowed per changeset; further discretionary use needs
  Owner approval. Required planning and process consultations are outside that cap, including
  triggered Round 2 reviews, cumulative 4/8/12 checkpoints, and a proposed completion exception.

## What you need to do on your Mac

Give Codex the [adoption ticket](CODEX_ADOPTION_TICKET.md). It will check each item below, reuse what
already works, and guide missing setup one step at a time. You do not need to prepare a technical
inventory. Codex verifies each result and repeats machine-specific checks on each Mac.

- **A compatible Mac and local access:** the environment where the kit operates. Codex checks
  compatibility, folder access, and developer-tool requirements, and identifies any administrator
  approval needed.
- **Git:** records project history and exact review versions, and supports recovery. Codex verifies
  Git and helps choose or create the project repository that will use the kit.
- **Node.js and npm:** run the kit’s scripts, automatic checks, and tests. Codex checks compatible
  versions, guides any missing setup, and verifies that the commands run.
- **Codex access and the Codex CLI:** support orchestration, review runners, and hook checks. Setup
  verifies sign-in, the CLI, and actual model access: Astra for planning and consultation, Sol for
  supervision, Terra for code, and Luna for gathering. It also tests the separate fresh same-family
  Cold Review route.
- **Claude Code and your own Claude account:** provide independent cross-family code review when
  Codex builds. Codex checks installation, sign-in, and model access, then configures and tests its
  Claude review route.
- **Gemini access and `agy`:** provide cross-family review of the plan and contract. Codex verifies
  the subscription-only disposable request-review rig and preserves strict manual browser handoff for
  high-sensitivity work. Neither route needs an API key.
- **The kit’s hooks, skills, and review runners:** supply automatic controls and reusable procedures.
  Codex installs and configures them, guides your hook-trust approval, and tests that the controls
  and review tools work.
- **Git-host access, only when needed:** a service such as GitHub provides private source access or
  code sharing. Codex checks the chosen delivery’s requirements; local projects and ZIP delivery
  do not themselves require an account.

Extra tools or plugins depend on your project and review route; Homebrew, full Xcode, and paid APIs
are not assumed. Codex checks required model access, including frontier reviews, and names anything
still pending.

You approve installations and costs and sign in directly. Keep passwords, tokens, and sessions out
of chat and the package. Setup alone authorizes no purchases, API spending, publishing, deployment,
activation, or live-data writes.

After setup, approval to push code is still separate from permission to write live data.
One-off production writes require a recovery plan, an Owner-run command, and verification before
continuing. T2 can authorize a pre-named bounded batch; T3 requires approval per write. Failures mean
restore safely or stop. Recurring production jobs need their own explicit enablement and runtime controls.

Ask for separate status on **implemented, reviewed, committed, merged, pushed, deployed, activated, and live-proven**.
A reviewed change is not necessarily running; an installed feature is not necessarily enabled.

## Included skills and commands

A **skill** is a reusable procedure, not another model or an automatic barrier. These nine skills
ship with the kit; ask the AI to use one by name, or use the command exposed by your client.

| Skill | Purpose and when to use it |
| --- | --- |
| [boot](../../skills/boot/SKILL.md) | Start a session: verify the repository, read required instructions, check for other writers, and classify the task. |
| [grilling](../../skills/grilling/SKILL.md) | Settle a plan before building: ask decision questions in dependency order, recommend answers, and investigate discoverable facts without asking you. |
| [lane-declare](../../skills/lane-declare/SKILL.md) | Before code writes or task changes, record the task, session, authoring mode, and category for the guards. |
| [orchestrate](../../skills/orchestrate/SKILL.md) | Coordinate scoped tasks, the planning-to-build model handoff, worker roles, routine PM authority, finite repairs, and final-version verification. |
| [kill-pass](../../skills/kill-pass/SKILL.md) | Before independent review, test and attack the builder's own work, including failure/allow cases for controls. It never replaces the panel. |
| [frontier-review](../../skills/frontier-review/SKILL.md) | Put one difficult design or repair decision to a highest-capability reviewer with sufficient evidence. The orchestrator keeps decision authority. |
| [sweep](../../skills/sweep/SKILL.md) | Find potentially affected clauses or inconsistencies across named files. It reports candidates and coverage, not an all-clear. |
| [humanize](../../skills/humanize/SKILL.md) | Rewrite a message with the answer first, unfamiliar terms explained, and risks and decisions preserved. |
| [closeout](../../skills/closeout/SKILL.md) | Complete the authorized delivery lifecycle, verify where changes landed, and report remaining work without disturbing another task. |

Also included:

- **humanize-bullet / humanize bullet:** [humanize's structured mode](../../skills/humanize/BULLET.md),
  using lists and tables where helpful; not a tenth skill body.
- **thread-restart:** a [handoff command](../../commands/codex/thread-restart.md) that writes a verified
  digest of decisions, source pointers, and open work. You start the new conversation; it does not
  reset context or automatically commit/push the digest.

**Closeout convention:** “finish,” “wrap up,” or “close this” means complete authorized work.
Publishing or deployment still needs a fresh Owner GO for the reviewed version; local completion
is not that approval. “Is it ready to archive?” is only a status question. None authorizes a
production-data write.

### Dependencies to verify during setup

- **orchestrate:** messaging and clickable task coordination belong to the AI application.
  Written briefs and a shared record are the fallback.
- **frontier-review:** Claude's restricted-tool consult and Codex's repository-aware gate runner
  are different implementations. Bind and record the actual role and model; they are not interchangeable.
- **sweep:** v2.32.0 installs the skill but does not copy `scripts/sweep.mjs`. Arrange the runner
  from the verified kit source, bind its inexpensive `sweepSeat` model, and test it before claiming readiness.
- **humanize and grilling:** complete `core/OWNER_COMMS.md` with your communication preferences.

The shipped **cold-reviewer** and **frontier-consult** agent definitions are reviewer presets,
not extra skills. Their model bindings also need verification.

## Reference: other controls and their limits

These support the main process rather than replacing its judgments.

- **Task-lane and commit guard:** with `core.hooksPath=.githooks`, the pre-commit hook blocks
  code-bearing commits lacking a valid task declaration. It does not certify reviews or approvals.
- **Write guards and worktrees:** supported AI edits are checked for repository boundaries and
  task permission. Substantial concurrent work uses separate working folders (**worktrees**);
  each worker prepares only its own changes for a commit.
- **Sensors:** report reminders, not prohibitions. Despite its name, `guard-gate-ladder.mjs`
  is a sensor and never blocks.
- **Hook trust and arming:** each checkout needs human Codex hook trust. Run
  `node scripts/check-codex-hooks-armed.mjs`: ARMED proves the lane guard ran on that invocation,
  not that every control passed. UNKNOWN or NOT_ARMED is not a pass. Test other controls and reverify
  after updates. Checkout-specific `.codex/hooks.json` must not be shared or committed.
- **Verify the verifier:** a **canary** deliberately reproduces the failure a control claims to
  catch. Test both blocked and allowed cases, with a control-disabled comparison, to show that
  the intended check caused the result. “The tool ran” or “nothing was found” is insufficient.
- **Reports:** `worktree-census.mjs` lists working copies; `token-report.mjs` summarizes Claude-lane
  usage. Neither cleans up nor caps spending. The kit's skill word-budget checker is not installed
  as an adopter control.

These controls support cooperative agents, not hostile agents forging records. Classification,
review quality, and genuine approvals still need Owner spot-checks.

Source references: [Workflow](../../core/WORKFLOW.md) · [Reviews](../../core/REVIEW.md) ·
[Models](../../core/GATES.md) · [Hook](../../hooks/guard-brief-rung.mjs) ·
[Controller](../../hooks/repair-dispatch-state.mjs) · [Portability](../../PORTABILITY.md) ·
[File map](../../core/README.md) · [Sender checklist](SENDER_CHECKLIST.md).
