---
name: boot
description: Start-of-session ritual — identity fingerprint, the boot-set read in order, the other-lane check, the tier recommendation. Use at the start of any working session, before any read or write of substance.
---

# /boot — start the session on the rails

Word budget: 250. This is the checklist form of the repo's entry stub (`CLAUDE.md` /
`AGENTS.md`); the stub stays canonical for the rules.

1. **Identity.** Run `git remote get-url origin` and compare it to the fingerprint table in
   the entry stub — never trust a path. A mismatch means the wrong checkout: STOP.
2. **Boot set, in order, whole:** `CLAUDE.md` (Claude) / `AGENTS.md` (Codex) →
   `core/FOUNDATIONS.md` → `core/WORKFLOW.md` → `core/REVIEW.md` → `core/ARTIFACT_CLASS.md` →
   `core/OPERATE.md` → `core/MULTI_AGENT.md` → `core/BINDINGS.md` → `core/SYSTEM_MAP.md` →
   `core/OWNER_COMMS.md` (governs your FIRST message — read before sending one). Do NOT
   read everything in `core/`. Not boot-read but named, so nothing there is unaccounted for:
   `core/README.md` · `core/GATES.md` (on demand, when a gate runs) ·
   `core/INVARIANTS.md` + `core/REPO_INVARIANTS.md` (reviewer payload, never builder-read).
3. **Other-lane check.** `git status --short` — unexplained dirty files are another lane's
   work, untouchable. Read `.claude/task-lane.json`: fresh and naming another lane's
   task ⇒ plan on a private worktree (`core/MULTI_AGENT.md` § Multi-writer checkout).
4. **Declare the task** before the first code write, and re-declare at every task boundary —
   `/lane-declare`.
5. **Classify** per `core/WORKFLOW.md` § Steer and recommend the intelligence tier to the
   Owner before starting.
