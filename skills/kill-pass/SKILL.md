---
name: kill-pass
description: The builder's own self-attack on a candidate before it is frozen for review. Use after the build is believed complete and before panel_open or any cold seat, and whenever a repair delta is about to be re-frozen.
---

# /kill-pass — break it yourself before a seat is paid to

Word budget: 700. Doctrine: `core/REVIEW.md` § Decorrelation ("Builder kill-pass BEFORE
`panel_open`") names the step; this is its checklist. It strengthens the candidate; it never
lightens the panel (`core/WORKFLOW.md` § Steer, rung-order rule 2).

## Rules that bind every step
- **The repo's own contract is the authority.** Its standing mechanical gate is named in
  `core/BINDINGS.md`; run that. Never import a coverage number or a stack's ritual from elsewhere.
- **Gate on the runner's exit code, never a filter's.** `node --test … | grep …` returns the grep's
  status; a red suite passed a commit that way once in this kit's lane (its untracked failure log,
  entry FM-2026-09-03-20). Run to a file or the terminal, then test the status.
- **Report every step, PASS / FAIL / N-A, with the command and its exit code.** An omitted step is
  indistinguishable from a passed one.

## The pass, in order
1. **Mechanical gate.** The repo's 0-FAIL health check, exactly as bound.
2. **Build · typecheck · lint** — only the scripts the repo actually declares (`package.json`,
   `Makefile`, CI). Absent ⇒ N-A, stated.
3. **Full suite, in your worktree**, clean-installed if the lockfile moved.
4. **Residue grep over the candidate's ADDED lines** — commit first, then
   `git diff <base>...HEAD -U0 --output-indicator-new='~' | grep '^~'` (the custom indicator cannot
   collide with a source line, unlike `+`) — plus every path `git status --short` lists as
   untracked or modified, read whole (an uncommitted file is invisible to the diff and visible to
   the next `git add`): secrets and tokens, debug prints, `TODO`/`FIXME` minted by this change,
   absolute home paths, an Owner's name.
5. **Read your own diff as the contract's adversary.** Every hunk against the acceptance criteria
   and the invariants: what did the contract promise that this hunk does not do, and what does the
   hunk do that nothing asked for?
6. **RED / GREEN on every control or test you touched.** Plant the failure it exists to catch and
   watch it go red; restore and watch it go green (`sensor-mutation-owed` demands both polarities).
   Restore from a COMMIT, never from memory, and commit first if the candidate is only in the tree
   (the lane's failure log, FM-2026-08-29-19).
7. **Freeze readiness.** `git status --short`: no unexplained dirty files, no untracked payload a
   later `git add` could sweep in (the lane's failure log, FM-2026-08-25-13), a lane declaration for
   this task.

## Output — before `panel_open`
```
KILL-PASS · <changeset> · <sha or "unfrozen">
1 mechanical gate   PASS|FAIL|N-A  <command> → exit <n>
2 build/type/lint   …
3 suite             …
4 residue grep      …  (hits: <n>)
5 diff-as-adversary …  (findings: <list or none>)
6 red/green         …  (controls: <n>, both polarities: yes|no)
7 freeze readiness  …
FREEZE: ready | not ready — <what blocks, or what is NAMED and left>
```
This report is a DECLARATION, not a gate: it adds no stop the method does not already have. A FAIL
the candidate caused is yours to fix before the freeze; a FAIL the candidate did not cause (a
pre-existing red, an environment defect) is NAMED in the report and left alone — widening scope to
clear it is the trap. The report travels with the candidate into `panel_open`. A clean pass proves
the builder tried; it certifies nothing to the panel, which runs at its full floor regardless.

*Origin: forked from ECC `skills/verification-loop` (affaan-m/ECC @ 22e8cf0, MIT) — its build →
typecheck → lint → test → secrets → diff sequence, with its coverage target and stack commands
removed and this kit's contract, RED/GREEN and freeze rules put in their place.*
