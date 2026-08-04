---
name: closeout
description: Close a working thread — inventory, gate ladder, staging, worktree merge+test, push authorization, land the PR, verify the target, receipt. Use when the Owner says finish, wrap up, or close this.
---

# /closeout — "finish" means landed, verified on the remote, and receipted

Word budget: 600 (Owner-ratified 2026-08-04). The PROCEDURE over `core/OPERATE.md` § End-of-work closeout and
`core/MULTI_AGENT.md` § Multi-writer checkout — where they differ from this file, they win.

## 0. Preconditions
- **Inventory first:** dirty files, commits, task-owned stashes, local/remote branches,
  worktrees, PRs. **Unknown or unreconciled state HALTS before any VCS mutation.**
- The tier's gate ladder is CLOSED — every verdict dispositioned; an open ladder runs first.
- **Push authorization. Unless explicitly limited** (`do not push` · `do not merge` ·
  `draft only` — a limit ENDS the authorized lifecycle there), an imperative **finish / wrap
  up / close this** *is itself* the push-GO for already-scoped, properly gated changes in
  this task; don't re-ask. It never authorizes new scope, a prod write or execution-GO,
  force-push, **bypassing a failed check, a conflict, or a branch protection**, or another
  lane's artifacts. Absent such a phrase, push autonomy follows the tier rules
  (`core/OPERATE.md` § Invariants). "Ready to archive?" is receipt-only: inspect and report,
  mutate nothing. **Pushing the deploy branch has the effect your entry stub names.**

## 1. Identity ritual — before every commit/push
**In the checkout you are pushing from**, run `git remote get-url origin` and
`git branch --show-current`; confirm both against the entry stub's fingerprint. Not
path-pinned — a pinned path reports the MAIN checkout's branch from inside a worktree.

## 2. Stage, merge, sweep
*Rules: `core/MULTI_AGENT.md` § Multi-writer checkout (boot-read). The unrecoverable three:*
- **Stage surgically:** `git status` first, explicit paths only — never `add -A` / `add .` /
  `commit -a`. Unexplained dirty files are another lane's: never stage, stash, revert, or
  edit them; a needed-but-foreign file STOPS for the Owner.
- **Merge and test in your worktree**, never the shared checkout; clean-install if the merge
  touched the lockfile; full suite THERE before it lands.
- **Pre-push sweep:** `git log <target-ref>..HEAD` — a push ships EVERY lane's unpushed
  commits; any ungated foreign commit STOPS.

## 3. Push, then verify on the REMOTE
Push only with the step-0 authorization, then confirm it landed on **the ref you actually
pushed**: `git fetch origin && git log origin/<branch> -1 --oneline`. Unverified = not landed.

## 4. Open or update the PR, then LAND it
Where the repo works that way. Merge only with the step-0 authorization — never over a failed
check, an unresolved conflict, or a branch protection.

## 5. Verify the TARGET
Confirm the merge is on the target branch on the remote, that required checks passed THERE,
and — if the push has a deploy effect — that the deploy reached the state your stub names.

## 6. Land the record, then receipt — mandatory
Update the current-state / open-work docs and memory your repo names. Begin the final message
**`CLOSEOUT: ARCHIVE-READY`** only if every applicable stage succeeded, inventory shows no
unknown required work, and the endpoint plus intentional residuals are named — **an unmerged
PR or an unverified target is NOT ARCHIVE-READY**. Otherwise begin **`CLOSEOUT: NOT
ARCHIVE-READY`**, list every blocker/residual and its location, and avoid completion
language. Remove task-owned temporary state only after a verified landing or an explicit
Owner endpoint; cleanup fails closed on uncommitted content. Report the VERDICT, not the
sweep (`core/OWNER_COMMS.md` rule 1).
