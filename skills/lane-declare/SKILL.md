---
name: lane-declare
description: Declare the task lane for both readers before code writes, at each task boundary, in fresh worktrees, or when blocked.
---

# /lane-declare — one declaration, two readers

Word budget: 350. Doctrine: `core/MULTI_AGENT.md` § Task-lane declaration (boot-read): reader behavior and limits. Both fail CLOSED on absent, malformed or stale declarations.

## The two readers
1. **The PreToolUse guard** (Claude Write/Edit only): reads `.claude/task-lane.json` under
   `$CLAUDE_PROJECT_DIR` (process cwd when unset). The **only** reader binding the SESSION;
   exempts `docs/` and `memory/`.
2. **`.githooks/pre-commit`** (every lane): reads the copy in the checkout being committed — a
   worktree needs its OWN. Every staged non-`.md`-class path is code-bearing. Binds **no**
   session and writes **no ledger row**.

## Format — exactly one of
```json
{"mode":"in-thread","sessionId":"<session>","taskId":"<kebab-task>","tier":"T2"}
{"mode":"exempt","sessionId":"<session>","taskId":"<kebab-task>","reason":"codex-down","tier":"T1"}
```
`tier` (both modes, REQUIRED): new work uses `T0`, `T1`, or `T2`; `T3` is accepted only for an independently proven historical lineage. Missing OR invalid blocks (`exempt-tier-missing`). The declaration is a self-report and cannot prove that lineage.
`reason` (exempt only, REQUIRED): `codex-down` | `codex-quota` | `trivial-edit`. `exempt` is an
**escape**: it names an unavailable review SEAT, says nothing about risk, never skips a gate.
The retired `lane` route is REFUSED (`lane-retired`). Optional `maxAgeHours` (default 24): a
non-number or a value outside (0, 168] reads as `malformed`, and the deny message does not say
so. The **mtime** is the staleness clock.

## Rules
- **Re-declare at EVERY task boundary** — NEW values for YOUR session and YOUR task. **Not**
  re-touching the file: that clears `stale` while leaving a wrong `sessionId`/`taskId` intact,
  and neither reader binds the task id.
- **Session id:** use the guard's deny message; never guess or copy another lane's file value. No
  control catches that mistake. Without a guard, use your own run identifier.
- **`ledger-error` is NOT a declaration problem**; re-declaring will not clear it. The guard
  fails CLOSED when it cannot ledger — a symlinked ledger, a corrupt row, or a missing trailing
  newline blocks every gated write until you fix that file.
- Never clobber a fresh declaration naming another lane's task — use a worktree.
