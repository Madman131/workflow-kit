---
name: closeout
description: Close a working thread — inventory, gate-ladder check, surgical staging, worktree merge+test, Owner push authorization, push, verify on the actual remote ref, receipt. Use when the Owner says finish, wrap up, or close this, or a changeset is ready to land.
---

# /closeout — "finish" means shipped, verified on the remote, and receipted

Word budget: 550. The PROCEDURE over `core/OPERATE.md` § End-of-work closeout and
`core/MULTI_AGENT.md` § Multi-writer checkout — where they differ from this file, they win.

## 0. Preconditions
- **Inventory first:** dirty files, commits, task-owned stashes, local/remote branches,
  worktrees, PRs. **Unknown or unreconciled task state HALTS before any VCS mutation.**
- The tier's gate ladder is CLOSED — every verdict dispositioned; an open ladder runs first.
- **Push authorization:** an imperative **finish / wrap up / close this** from the Owner *is
  itself* the push-GO for already-scoped, properly gated changes in this task — do not re-ask.
  It never authorizes new scope, a prod-data write, force-push, or another lane's artifacts.
  Absent it, push autonomy follows the tier rules (`core/OPERATE.md` § Invariants). "Ready to archive?" is receipt-only: inspect and report, mutate nothing.
  **Pushing the deploy branch has the effect your entry stub names.**

## 1. Identity ritual — before every commit/push
**In the checkout you are about to push from**, run `git remote get-url origin` and
`git branch --show-current`; confirm both against the entry stub's fingerprint. Deliberately
not path-pinned: inside a worktree, a path-pinned command reports the MAIN checkout's branch
— the wrong branch for the push that matters most.

## 2. Stage surgically
`git status` first; stage explicit paths only — never blanket-stage (`add -A` / `add .` /
`commit -a`). Unexplained dirty files are another lane's in-flight work: never stage, stash,
revert, or edit them; a needed-but-foreign file STOPS for Owner coordination.

## 3. Merge and test in isolation
Merge the shared branch INTO your worktree; clean-install if the merge touched the lockfile;
run the full suite THERE; only then land on the shared branch.

## 4. Pre-push sweep
`git log <target-ref>..HEAD` — a push ships EVERY lane's unpushed commits. Any ungated
foreign commit → STOP and coordinate with the Owner.

## 5. Push, then verify on the REMOTE
Push only with the step-0 authorization. Then confirm it landed on **the ref you actually
pushed**: `git fetch origin && git log origin/<branch> -1 --oneline`.
Your SHA on that ref = landed; unverified = not landed.

## 6. Land the record
Update the current-state / open-work docs and memory your repo names (`core/OPERATE.md`
§ Working norms).

## 7. Emit the receipt — mandatory
Begin the final message **`CLOSEOUT: ARCHIVE-READY`** only if the lifecycle succeeded,
inventory shows no unknown required work, and the endpoint plus intentional residuals are
named. Otherwise begin **`CLOSEOUT: NOT ARCHIVE-READY`**, list every blocker/residual and its
location, and avoid completion language. Remove task-owned temporary state only after a
verified landing or an explicit Owner endpoint; cleanup fails closed on uncommitted content.
**Perform the whole sweep; REPORT the verdict:** the receipt is the marker line, the
blockers/residuals, and what the Owner must decide — swept detail is OFFERED in one clause,
never dumped. A one-line question takes a short receipt: completeness is a property of the
SWEEP, not the word count (`core/OWNER_COMMS.md` rule 1).
