# kit v2.35.0 — C-CODE design contract (controls)

Tier **T2** (live control code: hooks, the commit floor, the installer). Base `origin/main` `e764f38`
(v2.33.1); builds on top of C-DOC (v2.34.0) after it lands, and rebases over it before any source edit.
Scope: CHIP C § 4 items 1–5 plus the gate-ladder hook's T2 string that lags C-DOC's doctrine.
Out of scope: the opening-balance ledger migration, splitting `core/GATES.md`, wording-pin pruning,
any adopter port, and review-history text of any kind in this document.

## 0 · Threat model and invariants

**Actors.** The agents the kit governs (Claude and Codex lanes, including an Architect/Principal
session and a PM session) and the operator running `init`. None is malicious; the failure being
controlled is an agent that *confidently does the wrong thing*: invents an authority, skips a
surfaced judgment, or sends a PM direction that nothing screens.

**What these controls are.** Friction and surfacing at the supported entry points — the recorder
CLI, `git commit`, the PreToolUse send hook, `init`. They are not a security boundary. Out of model,
unchanged by this release: `--no-verify`; shell or direct filesystem writes (including a hand-written
ledger row or a hand-edited config file); importing controller functions directly; server-side merges
on the forge (no local hooks run); an agent editing the config that configures its own screen.

**Invariants this changeset must hold.**
- I1 · No ledger row shape changes and no replay rule changes: every ledger valid under v2.34.0
  replays identically under v2.35.0, in both directions.
- I2 · `hooks/repair-dispatch-state.mjs` is byte-unchanged (controller freeze; item 1 is a
  write-time check outside it).
- I3 · No `.codex/hooks.json` entry changes. The registration `init` generates is byte-identical
  to v2.34.0's for the same checkout path.
- I4 · Every new refusal fails closed with a named state or a message naming the file, the key or
  the line it wants; no new silent allow.
- I5 · Pair handling is v2.34.0's: tracked `pairedPm*` keys in `.claude/kit.config.json`, read and
  written exactly as before (items 4b and 4e change only a deny and a message).

**Residual — the PM pair is repository-wide.** A tracked pair applies in every checkout that shares
it. Any session there sending to the PM by a matched address (e.g. a Builder reporting) needs a
decision screen or the `ARCHITECT_STATUS_V1` status marker, or it is denied with guidance. Unmatched
sends get a notice.
- I6 · No test in the suite invokes the operator's real `codex`.

## 1 · Principal record check

**Harm.** A Principal-route aggregate event (`worker_handoff`, `child_continuation`, `close`) is
admitted on `principal_evidence` whose `authority_record` / `decision_id` are free text. An agent can
cite a Principal decision that does not exist and open a successor or close a program on it — the
Owner-delegation boundary rests on a string nothing looks at.

**Mechanism (smallest).** At record time only, in `scripts/record-repair-event.mjs` `recordEvent`,
before an `aggregate_v2` input that carries a `principal_evidence` key (any value) reaches the
controller. Refused with `{ ok: false, state: "principal-authority-record-unconfirmed" }` and a CLI
hint naming both fields, unless all four hold:
1. `principal_evidence` is a plain object — a string, array, number or `null` is refused here even
   where the controller's own shape check would also refuse it downstream;
2. `decision_id` is a string, non-empty after trimming whitespace;
3. `authority_record` names a **git-tracked, regular, non-symlinked file of this repository**:
   repo-relative, resolved under the real project root with no `..` escape, and
   `git ls-files --error-unmatch -- <path>` succeeds from the project root. Tracked-only excludes
   `.git/` internals and untracked scratch; the bytes read are the working-tree file's;
4. `decision_id` occurs in those bytes **on a token boundary** — the characters either side of the
   occurrence (when present) are not `[A-Za-z0-9_-]`, so `D-1` does not match inside `D-12`, while
   `D-12.` and `(D-12)` do.
No ID-format schema beyond that. Records are repo-only: a file outside the checkout is refused.

**Why write time, in the recorder.** The controller REPLAYS history: every hook call re-derives
program state from all ledger rows. A replay-time check reading a mutable file would make a past
event's validity depend on today's contents of that file — replay would stop being deterministic,
and an edited or moved record would retroactively invalidate a program. Write time is the only place
the check can live without that. The recorder is the write path cooperative agents use; the
controller's grammar and bytes are unchanged. **Controller delta +0 / −0.**

**RED tests** (`tests/principal-record-check.test.mjs`, importing `recordEvent`; a temp git repo
with a committed record file): refused with the named state — `principal_evidence` as a string /
array / `null` on the Principal route · `decision_id` `""` and `"   "` · record missing · record
present but untracked · `.git/config` · symlinked record · `../` or absolute path · tracked record
without the id · `D-1` against a record holding only `D-12`. Passing — tracked record containing
`D-12.` / `(D-12)` returns the controller's own result, not the new state. An `owner_evidence` event
is unaffected. Mutations: drop the tracked query (untracked case goes wrong), drop the boundary (`D-1`
case), drop the trim (whitespace case), drop the plain-object test (string case reaches the
controller and returns its state, not the named one).

**Files.** `scripts/record-repair-event.mjs` (+~24). Doc: the recorder's header comment;
`PORTABILITY.md` § The recorder's caller fields (+~3 lines: tracked record, id as a token).

**Residuals.** The check proves an id is *present as a token in a tracked record*, not that the
record authorized *this* transition; an agent could commit a record naming its own id (visible in
history, where the doctrine's later reader looks). A hand-written ledger row, or a direct import of
the controller's recorders, skips the check — outside the declared threat model, since
cooperative-but-fallible agents write through the recorder. Records kept outside the repository
(for example an agent memory directory) must be committed into the checkout to be citable.

## 2 · commit-msg hook: an `entry:` line

**Harm.** The Step 0 triage answer is the only trace of an ungated change's classification, and its
only catch is a later reader. A commit that omits the line leaves that reader nothing to re-ask;
omission is silent today.

**Mechanism.** New `githooks/commit-msg` (Node, same shape as `githooks/pre-commit`), installed by
`init` to `.githooks/commit-msg` beside the pre-commit and bound by the same `core.hooksPath`. It
reads the message file, drops comment lines (`#`), and requires, in the **body** (any line after the
first), one line matching `^entry:\s*(none|class-[1-4](,[1-4])*)\s*$`. Presence and shape only —
never correctness. Exempt: a merge in progress (`MERGE_HEAD` exists), subjects starting `Merge `,
`Revert "`, `fixup! `, `squash! `, `amend! ` (a revert is the gate for ungated work; blocking
`git revert --no-edit` would tax exactly that path). Refusal message names the line and both forms.
In `init`: the pre-commit copy/trust block becomes a loop over `pre-commit` and `commit-msg` (copy,
chmod, kept-and-differs warning); summary line names both.

The kit's own tree runs `core.hooksPath=githooks`, so the hook binds the kit's commits as soon as the
file exists on a branch. The kit's commits already carry the line.

**Doctrine that becomes false and must change.** `core/WORKFLOW.md` § Steer Step 0 says "NO CONTROL
READS THAT LINE, AND NO CONTROL CATCHES A FALSE ONE" and "Its only reader is whoever next reviews the
record". After this item a hook reads it for shape. Byte-neutral replacement (WORKFLOW.md sits 12 B
under its cap after C-DOC): the first clause says a commit hook checks only presence and shape; the
second clause stands; "only reader" becomes "only judge". Owner wording sign-off (§ 8).

**RED tests** (`tests/commit-msg-hook.test.mjs`, temp repo with `core.hooksPath` at a copy of
`githooks/`): no entry line → commit refused, message names the forms · `entry: none` → accepted ·
`entry: class-2,3,4` → accepted · `entry: class-5`, `entry: maybe`, `entry:` → refused · entry line
only in the subject → refused · a real `git merge --no-ff` without the line → accepted · `git revert
--no-edit` → accepted · `fixup!` subject → accepted. `init` installs `.githooks/commit-msg`
executable and warns on a kept-and-different copy. Mutation: widen the class range, or accept the
subject line → a named case goes wrong.

**Files.** `githooks/commit-msg` (new, ~55 incl. header), `bin/init.mjs` (+~12 / −~4),
`core/WORKFLOW.md` (1 sentence, byte-neutral), `README.md`, `PORTABILITY.md` (FM1 section: the floor
now has two hooks).

**Residuals.** `--no-verify`; forge-side merges and squash messages; a false line (by doctrine,
nothing catches it); an adopter's first commit after `init` must carry the line (the install
summary says so). A commit can skip the check by an exempt subject prefix (`fixup! `, `squash! `,
`amend! `, `Revert "`, `Merge `): the line is presence-only surfaced judgment, and an autosquashed
fixup lands under a parent that carries it, so the exemptions stand.

## 3 · Pair scoping — dropped

Item 3 is not built (D-27): the pair stays in the tracked `.claude/kit.config.json` exactly as in
v2.34.0. Its residual is stated in § 0 and in the README note.

## 4 · CHIP B findings carried with a harm

**4a · C1 — `init` lists worktrees with `-z`.** Harm: a sibling worktree path containing a newline
is split and skipped by the mixed-controller check, so a mixed install proceeds (lockout later).
Mechanism: `git worktree list --porcelain -z`, records split on `\0\0`, fields on `\0`; if git
rejects `-z` (older than 2.36) fall back to today's newline parse. RED: a sibling worktree whose path
contains `\n` and holds an old controller copy is listed and refused. Files: `bin/init.mjs`
(+~5 / −~2), `tests/init-mixed-controller.test.mjs`.

**4b · S1-1 — non-string SendMessage address in a paired checkout denies.** Harm: in a paired
checkout a `SendMessage` whose `to` or `recipient` is present but not a string falls through the
matcher and is notice-allowed, so a PM direction can pass unscreened. Mechanism: when a Claude pair
is configured and any present address is not a string, deny with a new named state
`claude-send-address-unreadable`. Unpaired checkouts are unchanged (outside scope). RED: paired
checkout, `to: {…}` → deny; `to: ["pm"]` → deny; unpaired, same input → allow. Files:
`hooks/guard-brief-rung.mjs` (+~5), `tests/claude-pair-send.test.mjs`.

**4c · N1 — explicit Codex re-trust step after `init --force`.** Harm: an adopter coming from
v2.32.x or earlier gets a new `.codex/hooks.json` entry (the v2.33.0 thread-send entry). `init`
prints "re-trust only if NOT ARMED", but the armed check probes `apply_patch` only, so it reads
ARMED while the new send entry is untrusted and skipped silently. Mechanism: when `--force`
rewrites `.codex/hooks.json` and the previous file's `hooks` structure differs (the version-bearing
`description` is ignored), record `hooksEntryChanged`; then print an explicit step — run `codex` here interactively and choose
"Trust all and continue", then run the check — and state that the check covers `apply_patch` only.
When the file was unchanged, keep today's text. RED: an adopt whose `hooks.json` is replaced by an
older registration, then `--force` → output carries the explicit step; an unchanged `--force` →
today's "only if it reports NOT ARMED" line. Files: `bin/init.mjs` (+~10 / −~3),
`tests/init-force.test.mjs`.

**4d · FM-41 — the suite never runs the operator's `codex`.** Harm: tests that run `init --force`
with the Codex lane enabled and `codex` on `PATH` make `init`'s arming probe call the real
`codex` — spend and a live-tool side effect from `npm test`. A lexical guard on call text cannot see
flags passed through a helper. Mechanism, containment first:
- `scripts/run-checks.mjs` puts a stub `codex` first on `PATH` for every rung. The stub appends its
  argv to a log whose path is baked into the stub (so a test that rebuilds its env still logs) and
  exits nonzero, so the real binary is never reached. Before the rungs, the runner calls the stub once
  with a sentinel and refuses to run unless the log shows it (dead-sensor canary); after the rungs,
  any non-sentinel line fails `npm test`, naming the count. Tests that set their own codex-free `PATH`
  are their own containment.
- The tripwire located the reaching call sites: eight direct `init --force` calls in four test files.
  They now run with a codex-free `PATH` (`HERMETIC_ENV`, exported by `tests/kit-controls-helpers.mjs`,
  the same idiom `init-force.test.mjs` uses), which keeps their "armed check unverifiable ⇒ exit 1"
  assertions true.
- The lexical guard `initInvocationOffenders` gains one rule (a direct call with `--force` carries
  `--skip-codex-lane` or a codex-free `PATH`), as a fast in-file hint; the tripwire is the guard.
RED: with the tripwire and before the call-site fix, `npm test` fails naming the invocations; after
it, zero. Limit: the tripwire binds `npm test` only; `node --test <file>` runs without it. Files:
`scripts/run-checks.mjs`, `tests/kit-controls-helpers.mjs`, the eight call sites,
`tests/kit-controls.test.mjs`.

**4e · The malformed-config message names the key that is wrong.** Harm: `claude-pair-malformed`
always names `pairedPmClaudeTarget`, and `kit-config-malformed` never names `pairedPmClaudeName`; an
operator told to repair the wrong key edits a valid one and the deny persists. Mechanism: the loader
returns `{ ok: false, file, key }` for the first failing field (`briefPathDirs`, one of the pair
keys, or `null` for whole-file parse/shape/read failures), and the three messages
(`architect-pair-malformed`, `claude-pair-malformed`, `kit-config-malformed`) print that file and
key. RED: malformed `pairedPmClaudeName` → message names `pairedPmClaudeName`; malformed
`briefPathDirs` → names `briefPathDirs`; unparseable file → names the file only. Files:
`hooks/guard-brief-rung.mjs` (+~6 / −~3), `tests/claude-pair-send.test.mjs`.

## 5 · Option B (per-checkout deny of unmatched SendMessage) — not in scope

An unmatched send in a paired checkout reaches a different recipient or a mis-addressed PM. The notice already covers the mis-addressed case in the transcript,
and a PM that receives an unscreened direction refuses it (program rule D-12). No harm remains that
the notice does not cover; B would add one — every Architect send to a Builder or any non-PM
session in that checkout would be denied. **B is not built.**

## 6 · Gate-ladder hook: T2 string follows C-DOC's doctrine

**Harm.** After C-DOC, `core/WORKFLOW.md`'s T2 row reads "cross-family lens [if avail; REQUIRED if
flagged]". `hooks/guard-gate-ladder.mjs` still prints "cross-family lens [if available]", so the
ladder surfaced at every gate invocation tells an agent the lens is optional on an action-flagged
change.

**Mechanism.** One string, copied exactly from the landed `core/WORKFLOW.md` T2 row: `cross-family lens [if avail; REQUIRED if flagged]`. The hook
cannot know flags; the string carries the condition, as the doctrine row does. The comment above
`LADDER` names § Steer (where the table now lives). RED: a T2 declaration plus a gate command →
the surfaced ladder contains the clause read from the WORKFLOW.md T2 row itself. Files: `hooks/guard-gate-ladder.mjs`
(+1 / −1, comment +1 / −1), `tests/kit-controls-lane.test.mjs` (+~6).

## 7 · Codex hook trust

No `.codex/hooks.json` entry changes (I3): items 4b, 4e and 6 change hook **scripts** only, and
Codex keys trust to the registration entry. An adopter upgrading v2.34.0 → v2.35.0 stays armed and
owes no re-trust; `init --force` prints the unchanged-entries text across that version bump (item 4c). The commit-msg hook
is a Git hook and binds every lane without Codex trust. The release note says both.

## 8 · Wording sign-off (Owner, D-02)

Required: `core/WORKFLOW.md` Step 0 entry-line sentence (item 2).
For the same packet, not core: the printed T2 ladder
string (item 6) · the new refusal/deny messages (items 1, 2, 4b, 4e) · `README.md` v2.35.0 note ·
`PORTABILITY.md` edits.

## 9 · Settled design choices

- **D1 · Record location (item 1).** Repo-only: `authority_record` is a git-tracked file of the
  checkout. A record kept elsewhere (an agent memory directory) must be committed to be citable.
- **D2 · Check placement (item 1).** The recorder, at write time; controller delta 0 / 0. Reason:
  § 1 "Why write time" — replay must stay deterministic.
- **D3 · Match strictness (item 1).** Token boundary (`[A-Za-z0-9_-]` on neither side).
- **D4 · commit-msg exemptions (item 2).** Merge, `Revert "`, `fixup!`/`squash!`/`amend!`; the
  prefix dodge is a declared residual (§ 2).
- **D5 · FM-41 guard shape (item 4d).** The stub-`codex` tripwire in `scripts/run-checks.mjs` fails
  the suite whenever any test spawns `codex` that resolves to the stub (the real binary is never
  reached while the stub is first on `PATH`); plus the helper fix. The lexical rule stays as a hint.

## 10 · Line plan

| Area | Added | Deleted |
|---|---:|---:|
| `hooks/repair-dispatch-state.mjs` (controller) | 0 | 0 |
| `scripts/record-repair-event.mjs` | ~24 | 0 |
| `githooks/commit-msg` (new) | ~55 | 0 |
| `bin/init.mjs` | ~45 | ~21 |
| `hooks/guard-brief-rung.mjs` | ~21 | ~11 |
| `hooks/guard-gate-ladder.mjs` | 2 | 2 |
| `scripts/run-checks.mjs` | ~18 | 0 |
| test helpers and call-site hygiene | ~10 | ~1 |
| **Code total** | **~175** | **~35** |
| Tests (new + extended) | ~280 | ~5 |
| Docs (`core/WORKFLOW.md`, PORTABILITY, README, VERSION) | ~55 | ~5 |

Against a ~150-line code plan this is ~1.2×, under the 2× trip wire. Controller delta 0 / 0.

## 11 · Rebase over C-DOC

Shared files: `README.md` (release notes — additive), `VERSION` / `package.json` (2.34.0 → 2.35.0),
`core/WORKFLOW.md` (C-DOC does not touch the Step 0
paragraph; C-CODE's edit is byte-neutral against C-DOC's 25,588 B). No source, test, template, hook,
script, core or skill file is edited before C-DOC lands. The hook string (item 6) matches C-DOC's
final row text; if C-DOC's wording changes before landing, item 6 follows it.

*Revision 1: item 1 adds the plain-object, non-empty-id, tracked-file and token-boundary conditions and fixes the recorder placement with its replay reason; item 3 never deletes tracked pair keys and adds the migration notice and hand-removal order; § 9 records settled choices.*
*Revision 2: after rebasing on the landed C-DOC, item 6 uses the landed T2 row's clause verbatim; item 4d names the call sites the tripwire located.*
*Revision 3: item 3 dropped (D-27); pair handling is v2.34.0's, with 4b and 4e on the tracked config; 4c compares hook entries only.*
