---
name: lane-declare
description: Write the task-lane declaration in both places it is read, per task, before the first code write. Use at every task boundary, in a fresh worktree, or whenever either reader blocks a write or commit.
---

# /lane-declare — one declaration, two readers

Word budget: 350. Doctrine: `core/MULTI_AGENT.md` § Task-lane declaration. Both readers fail
CLOSED — an undeclared, malformed, stale, or session-mismatched declaration BLOCKS; re-declare,
never work around.

## The two readers
1. **The PreToolUse guard** (Claude Write/Edit lane only): reads `.claude/task-lane.json` under
   `$CLAUDE_PROJECT_DIR` (the process cwd when unset) — wherever you are writing.
2. **`.githooks/pre-commit`** (every lane): reads `.claude/task-lane.json` in the checkout being
   committed. A private worktree has its OWN copy — write it there too.

## Format — exactly one of
```json
{"mode":"in-thread","sessionId":"<session>","taskId":"<kebab-task>","tier":"T2"}
{"mode":"exempt","sessionId":"<session>","taskId":"<kebab-task>","reason":"codex-down","tier":"T1"}
```
`tier` (both modes, REQUIRED): `T0`–`T3` — an exemption whose tier is missing OR invalid blocks
(`exempt-tier-missing`). `reason` (exempt only, REQUIRED): `codex-down` | `codex-quota` |
`trivial-edit`. `exempt` is an **escape**, not a co-equal route: the reason names an unavailable
review SEAT, says nothing about risk, and never skips a gate. The retired `lane` route is
REFUSED (`lane-retired`). Optional `maxAgeHours` (default 24): a non-number, or a value outside
(0, 168], reads as `malformed` — and the deny message does NOT say so. The file's **mtime** is
the staleness clock; rewriting it refreshes it.

## Rules
- **Re-declare at EVERY task boundary.** A matching sessionId is NOT a matching task.
- Session id: take it from the guard's deny message, never a guess.
- **`ledger-error` is NOT a declaration problem** — re-declaring will not clear it. The guard
  appends every gated decision to `.claude/lane-ledger.jsonl` and fails CLOSED when it cannot:
  a symlinked ledger, a corrupt row, or a truncated final line (no trailing newline) blocks
  every gated write until you fix or move that file.
- Never clobber a fresh declaration naming another lane's task — use a private worktree, or ask
  the Owner. Every state change is ledgered for Owner spot-check.
