# Workflow-Kit Factsheet

## What it is

Workflow-Kit is a portable working method for building and operating important software with AI
agents. It is not an application, cloud service, or autonomous deployment system. Its installer
copies a reviewed method and local controls into another Git repository, then generates that
repository's own model, tool, architecture, access, and Owner bindings.

Its core loop is **Steer → Gate → Garden**:

- **Steer:** define visible “done,” classify the risk, and decide the smallest justified review
  ladder before building.
- **Gate:** run deterministic checks and independent review in a fixed order, then have the project
  manager disposition findings against evidence.
- **Garden:** keep current state, failure knowledge, worktrees, and operational records legible after
  the change.

The method is designed for cooperative but fallible agents. It is not an intrusion-detection or
hostile-agent security system.

## What it gates

Every change starts ungated and answers four entry questions: is it irreversible/live, capable of a
silent failure, multiplied beyond one repository, or instruction text someone will implement? Four
“no” answers use the cheap mechanical path. Any “yes” answer enters the tier ladder.

| Path | Typical change | Review shape |
|---|---|---|
| **Ungated** | All four entry questions are “no” | Commit, run, and reversibility are the mechanical gate |
| **T0** | Admitted local non-code | Pre-flight and self-check |
| **T1** | Admitted local code or bounded local/read-only work | Pre-flight and one blind cold review |
| **T2** | Reversible production, live-path, or state/control logic | Pre-code contract lens, cold panel, cross-family/external review, Owner push approval |
| **T3** | Irreversible production write or equivalent critical act | Strongest multi-family ladder, Owner push approval, and named approval for each live write |

Tier depth is based on blast radius and irreversibility, not on how many hours the work took. A push
and a live write are separate decisions: permission to push or deploy never automatically permits a
production mutation.

## How a gate works

The main strategies are:

- **Design before code:** at T2/T3, a different-family model challenges the falsifiable contract
  before implementation exists.
- **Freeze the candidate:** reviewers inspect an exact commit/tree and scope, not a moving branch.
- **Blind discovery first:** a free pass receives the artifact, invariants, tier, and redacted
  contract—not the builder's rationale or earlier verdicts.
- **Decorrelation:** review varies model family, reviewer charter, execution environment, and
  installed layout so several seats do not share one blind spot.
- **Verify, do not trust:** a completed model response is only a delivery receipt. A real gate also
  needs a verdict, inspected scope, and evidence checked against the artifact.
- **One writer per repository:** substantial concurrent work uses separate tool-owned worktrees;
  staging is surgical, and unexplained files are never touched.
- **Separate states:** designed, implemented, reviewed, committed, merged, pushed, deployed,
  activated, and live-proven are reported independently.

When Codex builds, Gemini reviews the design and Claude Code supplies the independent code gate.
When Claude builds, Gemini still reviews the design and Codex supplies the code gate. Concrete model
IDs and commands belong in each adopter repository's dated `core/BINDINGS.md`, because provider
lineups change.

## How it avoids recursive gating loops

Workflow-Kit does not try to reach the impossible state where an adversarial reviewer can find
nothing else to say. It ends on a judgment.

Its brakes are explicit:

1. **A verdict is evidence, not repair authority.** The project manager screens every finding for
   concrete harm, a real trigger, task scope, and whether fixing it is worth the cost.
2. **Rule #1:** a finding blocks only when it identifies harm to the Owner/user, product usability,
   or code functionality and explains the mechanism. Harmless inconsistencies become recorded
   notes, not new repair work. Irreversible acts, production writes, under-gating, and other protected
   correctness classes still escalate first.
3. **One bounded repair batch per round.** Reviewers do not trigger seat-by-seat edits and rechecks.
4. **Root-cause escalation replaces repeated patching.** Round 1 permits one bounded batch. Repeated
   mechanisms or harm-bearing Round 2 require a single root replacement, simplification, or split.
   Round 3 tests that consolidated correction.
5. **Round 4 is terminal.** A fresh process review may permit one bounded finish, move useful work to
   a later Owner-approved successor, or return the decision to the Owner. Round 4 closes GO or STOP;
   there is no Round 5, reset, cycle, or reopened terminal parent.
6. **No new harm means no new round.** The final bookend retests accepted blockers against the
   candidate as it will ship. Work that is useful but not blocking becomes a separately scoped
   successor, not another turn of the same loop.
7. **KISS and zoom-out are binding decision lenses.** If remediation is becoming the product, the
   dominant defect source, or a defense for machinery created only by earlier remediation, the
   method narrows, deletes, splits, or escalates instead of growing the gate.

## What the controls really enforce

Workflow-Kit deliberately distinguishes guards, sensors, and human-followed method:

- The Git **pre-commit hook** is the broad mechanical floor. It binds every writer once
  `core.hooksPath=.githooks` is configured and blocks a code-bearing commit without a valid task-lane
  declaration.
- Claude and Codex **write guards** catch some problems earlier, but they bind supported tool calls,
  not every shell write or human editor.
- Codex hooks are installed but **inert until a human grants hook trust interactively**. Untrusted
  hooks may be skipped silently. The required proof is
  `node scripts/check-codex-hooks-armed.mjs`.
- Sensors can remind, measure, or surface a ladder. They never deny and must not be described as
  enforcement.
- No mechanism can judge whether a tier is honestly chosen, a task is semantically in scope, a
  review is wise, or a human really gave approval. Those remain inspectable records and Owner
  spot-checks.

Every clone needs its local Git-hook configuration, and every checkout that uses Codex's path-baked
registration needs its own setup and arming verification. A committed hook file alone is not proof
that the hook runs.

## What the human Owner must do

The Owner keeps intent and the consequential decisions:

- answer the few questions Codex cannot discover from the repository;
- ratify T2/T3 classification;
- approve Codex hook trust, then require the arming probe;
- sign in to their own Claude and Gemini accounts when Codex queues those setup steps;
- approve installation of external tools or metered API use;
- approve code/T1–T3 pushes on the exact reviewed candidate;
- give separate named approval for production or irreversible writes;
- decide risk acceptance, destructive operations, and material scope or budget expansion.

Never send another person's API key, login session, browser cookie, or provider configuration. A
missing or exhausted provider is an availability problem, not a passing verdict. The workflow holds
or uses its documented substitution path; it does not quietly replace the required family.

## Initial setup on a Mac

The recipient needs Git, Node.js, Codex, and a target Git repository. Claude Code and Gemini become
necessary when the selected tier requires their independent seats. The recommended setup sequence is:

1. Verify the Workflow-Kit commit/version and run its tests.
2. Run Workflow-Kit's `bin/init.mjs` against the target repository with repository-specific flags.
3. Complete the generated bindings and wire the installed checks into the target's normal tests/CI.
4. Verify `core.hooksPath=.githooks`.
5. Open Codex interactively in that checkout, approve hook trust, and run the arming probe.
6. When queued by Codex, install/sign in to Claude Code and Gemini using current official flows,
   then record and test their exact review bindings.
7. Exercise one harmless local workflow. Do not push, deploy, or touch live data merely to prove
   setup.

The detailed, copy-paste procedure is in [`CODEX_ADOPTION_TICKET.md`](CODEX_ADOPTION_TICKET.md).
