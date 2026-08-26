# Contract — pin the init `git config` write to `--file <resolved>` (v2.17.0)

**Origin.** terminal-round-breaker R4 disclosed one residual (see
`terminal_round_breaker_contract.md` § residual): the `core.hooksPath` write in `bin/init.mjs`
was a bare `git config <key> <value>`, which obeys `GIT_CONFIG` (and any write-redirect var). Under
`GIT_CONFIG=<foreign>` the write landed ONCE in the foreign file (reversible, signaled) before the
post-write read-back detected the escape and refused. Detection, not prevention. The Owner accepted
GO-with-follow-up and banked the prevention. This changeset lands it.

**Tier: T2** — changed control-arming semantics on the shipped installer; multiplied radius to every
adopter. Owner-ratified 2026-08-25 (behavior fork below decided "Pin + arm").

## Change

`gitConfigVerified(target, key, value)` (`bin/init.mjs`): resolve the target's own config path FIRST
via `git rev-parse --git-common-dir` (immune to `GIT_CONFIG`; caller already refused every
location override), then pin BOTH the write and the read-back to it with `git config --file
<configFile> …`. `--file` overrides any config-file redirect, so the write lands in the target's own
config and NEVER escapes — the "trust the effect, not the name" discipline extended from the
read-back to the write. The read-back stays as the confirmation. Net: the escape is PREVENTED, not
merely detected after one stray write.

**Decided behavior fork (Owner, "Pin + arm"):** with `GIT_CONFIG` set, init now ARMS successfully
into the target's own config (exit 0) instead of refusing — because the write can no longer be
diverted, refusing would be a false alarm. The prior refuse-under-`GIT_CONFIG` contract is
deliberately replaced.

## Acceptance criteria (falsifiable)

- **AC1 (clean env, regression):** no redirect ⇒ arms `core.hooksPath=.githooks` in the target's own
  config, exit 0, prints the binding line. *Unchanged.*
- **AC2 (the fix, RED→GREEN):** `GIT_CONFIG=<foreign>` set ⇒ arms in the TARGET's own config (exit 0,
  binding line printed) AND the foreign sink receives NO write (stays byte-identical). On the old
  code this test goes RED (old: exit 1, "REFUSED", write in the foreign sink).
- **AC3 (linked worktree, regression):** clean worktree adoption arms in the COMMON config, exit 0.
- **AC4 (location overrides, regression):** `GIT_DIR`/`GIT_COMMON_DIR`/`GIT_WORK_TREE` set ⇒ still
  REFUSED before the write (this path is untouched by the change).
- **AC5 (symlink / gitdir-file escape, regression):** a `.git` symlink or a regular-file gitdir
  pointer resolving outside the install ⇒ still REFUSED by the pre-checks.
- **AC6 (genuine write/read failure):** if git cannot write or read the target's own config,
  `gitConfigVerified` returns false and the caller's refusal fires with a message that names a real
  write/read failure — NOT a `GIT_CONFIG` redirect (that message is corrected).

## Adversarial cases considered

- **Ordering:** `--git-common-dir` is resolved before the write; rev-parse is immune to `GIT_CONFIG`
  and the caller (line ~913) already refused any location override, so the resolved path is the
  target's real config. If rev-parse fails, return false without writing (strictly safer than the
  old bare-write-then-fail).
- **`--file` precedence:** an explicit `--file` overrides `GIT_CONFIG`/`GIT_CONFIG_GLOBAL/SYSTEM` for
  both the write and the `--get`. `GIT_CONFIG_COUNT/KEY/VALUE` inject read-time values only; they do
  not redirect a `--file` write, and cannot forge a `.githooks` read-back from the target's own file.
- **Persistent `GIT_CONFIG` at COMMIT time (out of model):** arming the durable real config is
  correct for normal operation (`GIT_CONFIG` unset at commit). A `GIT_CONFIG` that persists through
  commits is a pathological environment the installer does not undertake to defend, same as before.
- **Worktree path:** reuses the already-proven `path.resolve(target, commonDir, "config")`
  construction the read-back used and the worktree polarity test exercises.

## Gate plan (T2, panel scaled to residual risk — low)

Builder kill-pass → RED/GREEN receipt (AC2) → one frozen candidate → one exact-clone full suite →
one cold review (cross-family) → the changeset's frontier firing on the delta → Owner push-GO. No
`core/` amendment; no execution gate (installer run is local). Residual risk is low (one function,
regression-guarded), so the panel is a single cold seat + the frontier fold-check, not the full
roster.

## Doc-truth touched by this changeset

- `bin/init.mjs`: the `gitConfigVerified` comment block and the caller's refusal message (no longer a
  `GIT_CONFIG` redirect message).
- `tests/init-force.test.mjs`: the GIT_CONFIG test + its header comment, rewritten to AC2.
- `terminal_round_breaker_contract.md`: a one-line resolution breadcrumb on the disclosed residual
  (history preserved; the append-only gate record is NOT edited).
- `VERSION`: 2.16.0 → 2.17.0.
