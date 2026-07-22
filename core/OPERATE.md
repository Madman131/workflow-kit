# OPERATE — execution, invariants, closeout, and working norms

> **CLASS: BINDING** — read it whole; missing a section means violating a rule without knowing.
> **Kit v1.0** (portable). Companion to `core/WORKFLOW.md` (classify + the ladder) and
> `core/REVIEW.md` (how a review is built). Split out of one oversized method doc; no rule changed.

*Once a change is classified and gated, this file governs how it is **run**, what is **always true**
while running it, how the work is **closed**, and the norms the Owner and Builder operate under —
including delegation, multi-writer staging, and the cost-inversion lane.*

## Execution protocol — ad-hoc prod writes
**Execution protocol — every *ad-hoc* prod write (T2 reversible / T3 irreversible), per write:**
1. **Named GO** from the Owner (T3: per write; T2: may cover a *bounded batch* = a finite, pre-named set the Owner sees in full at GO-time).
2. **Preflight.** *Enter the maintenance window* — **capture the current flag state**, set the maintenance flags, and **wait for the service to quiesce** (it releases its own write lock; never delete a lock to *bypass a running service* — but clearing a *confirmed-orphaned* lock after an aborted write, service stopped, is recovery per the Runbook). Reversible → capture the restore handle + record its id. Irreversible → a pre-write backup is mandatory + the Owner explicitly acks *there is no rollback*. State expected postconditions + stop conditions.
3. **One step** — the Builder emits one command; the **Owner runs it** + reports (destructive prod writes are Owner-run, never agent-autonomous).
4. **Verify** with the standing mechanical gate; if it can't run or is suspect → **fail closed** + escalate.
5. **On failure** → reversible: restore from the handle — **if it succeeds**, exit the window (Step 6); **if the restore itself fails**, escalate to irreversible (do **not** exit the window). Irreversible: stop + hold for the Owner — recovery is a manual Owner-led rebuild (no automated break-glass lane yet — see `core/BINDINGS.md` § Known gaps). Never continue a partially-failed sequence on momentum.
6. **On success → exit the maintenance window** — restore the **pre-window flag state** (captured at preflight — not assumed defaults, which could clobber an intentional setting) and confirm the service recovered — **if it fails to recover, RE-ASSERT the maintenance flags first (re-quiesce: with normal flags restored a crash-looping service is retrying against live traffic), then stop + escalate to Owner-led recovery (the Step-5 irreversible branch); the window stays open**. The write isn't done until the window is closed.

*This protocol states the **principle**; the detailed prod-write **procedure** (exact flag commands, orphaned-lock recovery, partial-failure handling) lives in the project runbook named in `core/BINDINGS.md`. The doctrine is the invariant; the Runbook is the steps.*

**Recurring scheduler writes** are authorized once (code gate at deploy + the Owner enabling the schedule via flag), runtime-gated by the standing mechanical gate, **not** a per-write GO — the prod-side sibling of the T0/T1 bounded loop. (Outside an active maintenance window the scheduler is the live default.)

## Delegation — Gather / Review / Author
Subagent use *inside* the tiers; changes no tier, no gate. Classify by effect on **authoritative detail** (the shipped artifact + the facts a decision rests on):

| Role | Dir | Owns | Fan out |
|---|---|---|---|
| **Gather** | context in | nothing — conclusions + pointers; source stays authoritative | freely (non-authoring) |
| **Review** | verdict in | nothing — findings; PM dispositions | freely (non-deciding — IO) |
| **Author** | artifact out | the shipped artifact | **no** for live-path / T2 / T3 — in-thread |

**Retention guarantee.** The authoritative build of anything that can carry a *silent degenerative bug* never leaves the Builder's context: (1) no load-bearing fact may exist only as an agent's summary — if it gates a decision, touches the corpus, or rides the live-behavior path, the Builder reads raw source/diff and re-derives it; (2) authoring of T2/T3/live-path code stays in-thread; agents author only T0/T1 work, which the Builder re-reads raw and owns.

**Rule:** Gather + Review → delegate freely; Author → keep, gated by tier. Delegation never raises a tier, substitutes for a mandated gate, or lets a summary stand for a source — it front-loads Steer (classify with full context) and thickens Gate (more cold checks, earlier).

## Garden — keep the system legible *(live = running · target = design intent, not yet built)*
1. **Repository is the system of record** *(live).* If the agent can't see it in-context, it doesn't exist. Memory = progressive disclosure: a one-line-pointer index, one fact per file. *A norm that lives only in one model's private memory is illegible to a new model — promote it here.*
2. **Remediation-carrying errors** *(target).* Mechanical failures embed the fix inline. **Sensors, not actuators** (IO) — a check reports / surfaces the cure, never enacts; the string is a suggestion the intelligent reader decides on, never a trigger. No clean cure ⇒ "investigate — see X."
3. **Tracked debt ledger** *(target).* Versioned, agent-updated, drained on a GC cadence.
4. **Bounded autonomous loop** *(target).* Unattended operational act→check→fix→re-check **only in the T0/T1 zone**, **capped at 3 attempts → stop + escalate** (an unfixable systemic failure must not spin); the instant a fix is T2/T3, stop + escalate. Gate-review rounds follow their soft-stop rule above. The agent is the actuator; the deterministic check verifies invariants — neither usurps the other (IO, both directions).

## Invariants — always on
- **IO (the librarian rule)** — see P2. Root of the next two + sensors-not-actuators (Garden §2).
- **Exact provenance** — every derived label maps exactly to its source, or is NULL. Never guessed.
- **No fabricated answers** — abstain over a confident-but-wrong answer.
- **Verify the mitigation (executed proof)** — a documented mitigation/backstop is **FAIL until proven by execution**. For each "X is safe because Y catches it" the Builder produces a **mitigation-claims table** row: risk · mitigation · same-path-or-independent · a **risk-isomorphic canary** (an instance of the *named* risk on the same ingress/egress path — incl. a *positive/in-band* case where applicable, not a generic failure) · a **control** showing the canary *passes* when the backstop is disabled · the **command + output** · confirmed source lines. **A canary the backstop catches but that doesn't reproduce the *named* risk proves nothing — run it.** A reviewer owns *mitigation-integrity* and FAILs any unproven claim or backstop sharing the risk's path. **This is reviewer rigor, not machinery:** the reviewer *constructs* the failing case and **traces it through the real code** (or runs it where trivially feasible) — accepting nothing on the doc's say-so — and the **Owner spot-checks** the mitigation verdicts. A rigorous reviewer catches a positive/in-band miss by reasoning ("does the `>0` guard catch `364980`? no"); no execution harness needed.
- **Verify the active target** before any commit/push/deploy.
- **Push autonomy by tier** — the Builder may push **docs-only (T0)** without a GO **only if the branch has no unpushed code commits** (a push ships the *whole* branch to the auto-deploy target, so a docs push sitting behind un-GO'd code waits for the Owner's GO too); **any push containing code needs an Owner GO regardless of tier**; every T2/T3 push waits for the Owner's GO. (*Push-ready* = the tier's code gate has passed + the active target is verified.)
- **Plan first, verify claims** — understand before acting; don't assert what you haven't checked.
- **Retention guarantee** — authoring of live-path/T2/T3 never leaves the Builder; no load-bearing fact lives only as an agent summary (see § Delegation).

## End-of-work closeout — terminal phrases are lifecycle commands
When the Owner imperatively says **finish**, **finish up**, **wrap up**, **tie up loose ends**, or **close this task/thread**, complete the **full safe delivery lifecycle for the active scope** — not merely "branch ready." Unless explicitly limited (`do not push` · `do not merge` · `draft only`), the phrase is also named **push-GO for already-scoped, properly gated changes in that task**, including an auto-deploy target. A question asking whether work is **ready to archive** is receipt-only: inspect and report, but do not mutate without an imperative phrase or explicit push/merge authorization. Neither form authorizes new scope, any prod data write or execution-GO, force-push, bypassing a failed check/conflict/protection, or touching another lane's artifacts.

**Required closeout:** inventory relevant dirty files, commits, task-owned stashes, local/remote branches, worktrees, and PRs. Unknown or unreconciled task state halts before any VCS mutation. If no task mutation or retained state exists, skip inapplicable VCS stages. Otherwise: commit surgically → reconcile with the current target and rerun decisive checks → push → open/update the PR when applicable → merge/land → verify the remote target and required checks/deploy state. An explicit Owner endpoint (`draft only` · `do not merge`) ends the authorized lifecycle there; an explicit discard/abandon skips landing. Name every intentionally retained or discarded artifact. Absent such an endpoint, anything not landed and verified is **unfinished**.

Only after landing or the explicit endpoint is verified may task-owned temporary state with confirmed provenance be removed; cleanup fails closed on uncommitted/untracked content absent explicit discard authorization. The final receipt MUST begin `CLOSEOUT: ARCHIVE-READY` only when the applicable lifecycle succeeded, inventory shows no unknown required work, and its endpoint plus intentional residuals are named. Otherwise it MUST begin `CLOSEOUT: NOT ARCHIVE-READY`, list every blocker/residual and location, and avoid completion language. Keep the task active until the lifecycle finishes or a concrete contraindication is visible to the Owner.

## Working norms *(how the Owner + Builder operate — portable)*
- **One step at a time** for operational runbooks: one command → stop → the Owner runs it + reports → next. Never dump a multi-step runbook.
- **Commit when push-ready;** the Builder commits routine work and may push only qualifying T0 docs-only changes; every code push and every T1–T3 push requires Owner push-GO. Staging is task-scoped per the multi-writer norm below. Gated work stays uncommitted until its gate passes.
- **Recommend the intelligence tier** before each task — escalate hard/high-stakes, economize on trivial.
- **Cost discipline:** use cheap models to locate/classify/parse and the frontier model to decide; reserve the metered API for what's mechanically unavoidable. (Which model is free vs metered — `core/BINDINGS.md`.)
- **Compute-weather (Owner dial):** plan budgets are metered per family and expire — when the default Builder's family runs low, or another family's is flush/expiring, the Owner may declare a **temporary shift of the heavy tokenized work to the flush family**. This is a **role-swap, never a gate-drop**: the gate ladder flips so review stays cross-family to whoever now builds (the swapped-in Builder's own binding applies — named in `core/BINDINGS.md`), and tiers / invariants / NO-GO conditions are untouched. Surplus compute buys **wider and deeper work under the same gates — never a laxer gate**; any decorrelation reduction the swap forces is recorded per the substitution rule.
- **Excellent docs:** update the current-state / open-work doc + journal at every checkpoint; promote findings to tracked items — don't leave them in memory only.
- **Config-flag discipline:** boolean config reads use explicit string compare (a `"false"` string is truthy); flags are toggled, never deleted.
- **Cross-thread / multi-writer coordination:** if multiple agent lanes share the repo, a push ships *everyone's* unpushed commits (and auto-deploys) — coordinate, never rewrite another lane's commits, and verify the active target before every commit/push. Where a second lane **writes the same checkout**: staging is task-scoped and verified per commit (blanket staging — `add -A` / `add .` / `commit -a` — is forbidden); foreign dirty files are untouchable (never stage, stash, revert, or edit them — a needed-but-foreign file stops for Owner coordination); substantial concurrent work goes through a private worktree with the full mechanical/test gate on the **merged** result run in the isolated worktree — never the shared checkout — before it lands on the shared branch; dependency-manifest changes are single-lane, a merge touching the lockfile clean-installs exactly from it before the merged-result test, and a lockfile conflict is resolved by running the package manager's install with the conflicted lockfile IN PLACE (it resolves the markers, preserving unrelated pins) — never hand-merged, never deleted-and-regenerated. *(Canonical agent-facing text: § Multi-writer checkout below; the root `CLAUDE.md`/`AGENTS.md` stubs summarise it.)*

## Multi-writer checkout — surgical staging only
*Canonical for ALL agent lanes writing one checkout. The repo entry stubs (`CLAUDE.md` / `AGENTS.md`) summarise these; this is the authoritative text.*

Two agent lanes (Claude Code + Codex) write this checkout at the same time; agents (not the
Owner) do the committing.

1. **NEVER blanket-stage:** no `git add -A`, `git add .`, or `git commit -a`. Stage explicit paths your
   task touched — nothing else.
2. **Verify before every commit:** run `git status`; every staged file must belong to YOUR task.
   Unexplained dirty files are the other lane's in-flight work — never stage, stash, revert, or edit them.
   If YOUR task needs a file the other lane has dirtied, STOP and ask the Owner — never interleave two
   lanes in one file.
3. **Substantial concurrent work → private worktree under `/tmp`** (never inside the checkout). When
   unsure whether the other lane is live, use the worktree — fail closed. Commit early and often there:
   `/tmp` is purged on reboot; only commits survive it (main object store).
4. **Merge + test in the worktree, never in the shared checkout:** merge the shared branch INTO your
   worktree, install deps there (`npm ci` if the merge touched `package-lock.json` — a clean install of
   exactly the merged lockfile), run the full `npm test` THERE, and only then land the merge on the
   shared branch. The shared checkout's foreign dirty files make any test run there unrepresentative.
5. **Dependency changes are single-lane:** while a `package.json`/lockfile change is in flight, no other
   lane writes the repo. A lockfile CONFLICT → keep the conflicted lockfile and run `npm install`
   (it resolves the markers, preserving pins); never hand-merge or delete-and-regenerate.
6. **Pushing the deploy branch auto-deploys to the live service.** Only a T0 docs-only push is GO-free; ANY
   push containing code — and any T1–T3 push, code OR instruction — needs the Owner's push-GO first
   (framework: "Pushing is a separate axis"). A push ships the WHOLE branch, including the OTHER lane's
   unpushed commits: before any push, check `git log origin/main..HEAD` for ungated work from ANY lane.


## Optional build lanes — the binding facts
*A lane is an **allowance**, never a mandate, and never lowers a tier or replaces a mandated gate. Full procedures: `core/LANES.md`.*

- **The cost-inversion lane** (a cheaper model authors from a falsifiable ticket) applies to **spec-able T0/T1 work only**. Files on the live-behavior path or the chain/stateful set are **lane-INELIGIBLE**, screened mechanically; a mis-tier discovered mid-task **STOPS the lane** and the tier full ladder applies.
- **A declaration is required and fails closed.** The task-lane declaration binds session id + kebab task id and names exactly one route (`lane` · `in-thread` · `exempt`); undeclared, malformed, stale, session-mismatched, or out-of-scope ⇒ **BLOCK**. The hook enforces the declaration; it never classifies semantics (IO).
- **No per-file disposition record ⇒ the lane is VOID** and the task re-gates as ordinary work.
- **The cold pass reviewer is never weaker than the builder**, and the lane still closes on the full test suite + the normal push rules (any push containing code needs the Owner push-GO).
- **The lane seat is RECORDED REDUCED (same-family)** — a builder's own family reviewing its own output. Sanctioned at T0/T1 only: the "a family cannot gate itself" restriction binds the T2/T3 *independent cross-family* seat, and P3's full-independent floor binds *critical* gates; a lane T0/T1 verdict is neither. **Recording the reduction is not optional** — an unrecorded reduced seat reads as a full-independent one.
- **Escapes are first-class** (`codex-down` / `codex-quota` / `trivial-edit`) — work never stalls on an unavailable seat — but every escape is ledgered.
- **The lane carries a KILL-CRITERION.** Each lane task journals builder model·effort, principal fix count, cold-pass findings, and a bounce grade. A bounce rate that erodes the savings **retires the lane** — it is an experiment that must be able to fail, not a permanent fixture.

## Onboarding a new model
*To plug a new model into a role, bind it in `BINDINGS.md` and give it the role's access: a **reviewer**
needs repo read access + the role's payload + its own review credential; a **Builder** additionally
needs write/push/deploy access, the repo identity ritual, and the maintenance-window mechanic
(`BINDINGS.md` § Access). The gate machinery is model-agnostic.*

- **Read in this order:** repo **identity** (`CLAUDE.md`/`AGENTS.md`) → **method** (`WORKFLOW.md` →
  `REVIEW.md` → `OPERATE.md`) → **bindings** (`BINDINGS.md`) → **architecture** → **runbook** →
  **current-state / open-work**.
- **The four gate types:** **mechanical** (a deterministic health check, must be 0-FAIL) · **cold
  panel** (fresh **blind** same-family agents — artifact + invariants + claimed tier, never the build
  conversation) · **cross-family lens** (a different-family reviewer) · **external** (an independent
  reviewer, handed the code + the design-as-contract).
- **Reviewer payload:** the artifact + the standing invariants files + the claimed tier — never the
  build conversation. The **folded** pass also gets the prior same-family findings; the **free pass
  gets none** (+ a redacted contract — see `REVIEW.md` § Decorrelation).
- **Access categories to credential:** the **repo** (remote + identity) · the **deploy target** (how it
  deploys; the write-gate; the maintenance-window mechanic) · the **review tools** (the cross-family
  CLI / key). Specifics in `BINDINGS.md`.
