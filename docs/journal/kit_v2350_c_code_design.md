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
on the forge (no local hooks run); an agent editing the per-checkout file that configures its own
screen.

**Invariants this changeset must hold.**
- I1 · No ledger row shape changes and no replay rule changes: every ledger valid under v2.34.0
  replays identically under v2.35.0, in both directions.
- I2 · `hooks/repair-dispatch-state.mjs` is byte-unchanged (controller freeze; also keeps `init`'s
  mixed-controller check silent for this upgrade — see item 1).
- I3 · No `.codex/hooks.json` entry changes. The registration `init` generates is byte-identical
  to v2.34.0's for the same checkout path.
- I4 · Every new refusal fails closed with a named state or a message naming the file, the key or
  the line it wants; no new silent allow.
- I5 · Old configuration still works: a pair held in the tracked `.claude/kit.config.json` keeps
  screening until it is moved.
- I6 · No test in the suite invokes the operator's real `codex`.

## 1 · Principal record check

**Harm.** A Principal-route aggregate event (`worker_handoff`, `child_continuation`, `close`) is
admitted on `principal_evidence` whose `authority_record` / `decision_id` are free text. An agent can
cite a Principal decision that does not exist and open a successor or close a program on it — the
Owner-delegation boundary rests on a string nothing looks at.

**Mechanism (smallest).** At record time only, in `scripts/record-repair-event.mjs` `recordEvent`,
before handing an `aggregate_v2` input to the controller: when `input.principal_evidence` is a plain
object, `authority_record` must name a **regular, non-symlinked file inside the project root**
(repo-relative, resolved under the real root, no `..` escape) and the file's bytes must contain
`decision_id` as a substring. Otherwise return `{ ok: false, state:
"principal-authority-record-unconfirmed" }`, with a CLI hint naming both fields. No schema beyond
"file exists + id string occurs". Replay is untouched (I1): a row already in a ledger is never
re-checked against a file that may since have moved.

**Why the recorder, not the controller.** The recorder is the only production caller of the
aggregate recorders; the controller's replay grammar needs no change. Placing the check in the
controller would change its bytes, which (a) is a controller feature under the freeze and (b) makes
`init`'s byte-compare mixed-controller check refuse every multi-worktree adopter until all worktrees
upgrade together — a cost this check does not need. Controller delta: **+0 / −0**. The alternative
placement (controller dispatcher `recordAggregateEvent`, reading bytes through an optional flag on
`readRegularRepoFile`) costs +6 / −2 controller lines and triggers that ceremony; it is listed as a
decision in § 9.

**RED tests** (`tests/principal-record-check.test.mjs`, importing `recordEvent`): record missing →
refused with the named state · file present without the id → refused · symlinked record → refused ·
`../` escape or absolute path → refused · file with the id → the controller's own result is returned
(not the new state) · an `owner_evidence` event is unaffected. Mutation: drop the substring test →
the "without the id" case goes GREEN-wrong.

**Files.** `scripts/record-repair-event.mjs` (+~16). Doc: the recorder's header comment;
`PORTABILITY.md` § The recorder's caller fields (+2 lines).

**Residuals.** A substring match accepts an id that is a prefix of another (`D-1` inside `D-12`);
the check proves an id is *present in a record*, not that the record authorized *this* transition.
A direct import of the controller, or a hand-appended row, bypasses it (out of model). Records kept
outside the repository (for example an agent memory directory) are refused; the record must be
copied or committed into the checkout (§ 9, D1).

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
summary says so).

## 3 · Pair scoping: the pair leaves the tracked config

**Harm.** `pairedPm*` keys live in `.claude/kit.config.json`, which adopters track. A pairing
committed in one checkout travels on a branch into another: that checkout then screens sends to a PM
it does not work with and leaves its own PM unscreened (only a notice), and merges fight over the key.

**Mechanism.** A new per-checkout, gitignored file **`.claude/kit.pair.json`** holds the three keys
(`pairedPmThreadId`, `pairedPmClaudeTarget`, `pairedPmClaudeName`) with today's validation.
- **Reader** (`hooks/guard-brief-rung.mjs` `loadBriefConfig`): if `kit.pair.json` exists it is the
  whole pair for this checkout (same lstat / regular-file / JSON-object rules; malformed ⇒ `ok:false`
  naming that file and key). If it does not exist, pair keys in `kit.config.json` are still read
  (I5). Whole-file precedence, not per-key fallback: a per-key fallback would let a travelled key
  fill a gap in the local pair.
- **Writer** (`bin/init.mjs`): `--paired-pm-*` flags write `kit.pair.json`, never `kit.config.json`.
  `init` appends `.claude/kit.pair.json` to `.gitignore` and certifies it ignored (existing
  `appendGitignore` + `certifyIgnored`). Existing pair file: kept without `--force`; under `--force`
  it is rewritten from the flags only when every key it holds is named (the FM-23 refusal rule,
  factored into one helper used by both files).
- **Upgrade of old tracked keys.** Under `--force`, a legacy pair key in `kit.config.json` whose flag
  is passed is **moved** (written to `kit.pair.json`, left out of the rewritten `kit.config.json`);
  one whose flag is not passed **refuses** the run with the flag names (existing refusal). Without
  `--force`, `init` warns that the tracked pair still works but travels, and names the command.
  When both files hold pair keys, `init` warns that the tracked ones are ignored.

**RED tests** (extend `tests/claude-pair-send.test.mjs`, `tests/codex-guard.test.mjs`,
`tests/init-force.test.mjs`): a pair only in `kit.pair.json` screens a matching send · a pair in
both files screens the `kit.pair.json` target and not the tracked one · a legacy-only pair still
screens (I5) · malformed `kit.pair.json` denies, naming the file and the key · `init
--paired-pm-claude-target X` writes `kit.pair.json`, leaves `kit.config.json` without the key, and
`git check-ignore` confirms the ignore · `--force` over a legacy key without its flag refuses; with
its flag, moves it · the Codex thread-send path reads the same file.

**Files.** `hooks/guard-brief-rung.mjs` (+~18 / −~4), `bin/init.mjs` (+~28 / −~6), templates
`BINDINGS.md.tmpl`, `CLAUDE.md.tmpl`, `AGENTS.md.tmpl` (one clause each: the file name),
`skills/architect-build/ROUTING.md` lines 16–17, `PORTABILITY.md` § Claude pair, `README.md`.

**Residuals.** A checkout without `kit.pair.json` whose tracked keys were removed by another
checkout's migration commit is unpaired after merging it (the release note tells operators to run
the pairing in every paired checkout, which is normally one: the Architect's). A PM rename still
leaves the name key stale (D-11 residual, unchanged). An agent can edit the file that configures its
own screen (out of model; unchanged from today).

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
rewrites `.codex/hooks.json` and the previous file existed with different bytes, record
`hooksEntryChanged`; then print an explicit step — run `codex` here interactively and choose
"Trust all and continue", then run the check — and state that the check covers `apply_patch` only.
When the file was unchanged, keep today's text. RED: an adopt whose `hooks.json` is replaced by an
older registration, then `--force` → output carries the explicit step; an unchanged `--force` →
today's "only if it reports NOT ARMED" line. Files: `bin/init.mjs` (+~10 / −~3),
`tests/init-force.test.mjs`.

**4d · FM-41 — the suite never runs the operator's `codex`.** Harm: tests that run `init --force`
with the Codex lane enabled and `codex` on `PATH` make `init`'s arming probe call the real
`codex exec` — spend and a live-tool side effect from `npm test`. Observed live on this machine on
2026-09-25 at 14:57 EDT: a `codex exec … -C …/kit-adopt-…` process spawned by `bin/init.mjs` from a
suite run, via the shared `adopt()` helper in `tests/kit-controls-helpers.mjs`. A lexical guard on
`spawnSync`/`execFileSync` call text cannot see flags passed through a helper, so it would not have
caught that process. Mechanism, containment first:
- `scripts/run-checks.mjs` puts a stub `codex` first on `PATH` for the suite rung. The stub appends
  its argv to a log named by an environment variable and exits nonzero. Before the rung, the runner
  calls the stub once with a sentinel and checks the log shows it (dead-sensor canary); after the
  rung, any non-sentinel line fails the run, naming the count. Tests that override `PATH`
  (`init-force.test.mjs`'s hermetic `PATH`) are unaffected.
- Fix the leaks it finds: `adopt()` in `tests/kit-controls-helpers.mjs` runs `init` with codex off
  `PATH` (the `HERMETIC_PATH` idiom `init-force.test.mjs` already uses); the eight direct call sites
  that pass `--force` without `--skip-codex-lane` get `--skip-codex-lane` unless they test the lane,
  in which case they take the hermetic `PATH`.
- The lexical guard `initInvocationOffenders` gains one rule (a direct call with `--force` carries
  `--skip-codex-lane` or a hermetic `PATH`), as a fast in-file hint; the tripwire is the guard.
RED: with the tripwire and without the helper fix, `npm test` fails naming the invocations; after
the fix, zero. Honest limit: the tripwire binds `npm test` only; `node --test <file>` runs without
it. Files: `scripts/run-checks.mjs` (+~18), `tests/kit-controls-helpers.mjs` (+2 / −1), eight test
call sites (+8), `tests/kit-controls.test.mjs` (+~6).

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

With the pair per-checkout (item 3), an unmatched send in a paired checkout reaches a different
recipient or a mis-addressed PM. The notice already covers the mis-addressed case in the transcript,
and a PM that receives an unscreened direction refuses it (program rule D-12). No harm remains that
the notice does not cover; B would add one — every Architect send to a Builder or any non-PM
session in that checkout would be denied. **B is not built.**

## 6 · Gate-ladder hook: T2 string follows C-DOC's doctrine

**Harm.** After C-DOC, `core/WORKFLOW.md`'s T2 row reads "cross-family lens [if avail; REQUIRED if
flagged]". `hooks/guard-gate-ladder.mjs` still prints "cross-family lens [if available]", so the
ladder surfaced at every gate invocation tells an agent the lens is optional on an action-flagged
change.

**Mechanism.** One string: `cross-family lens [if available; REQUIRED if action-flagged]`. The hook
cannot know flags; the string carries the condition, as the doctrine row does. The comment above
`LADDER` names § Steer (where the table now lives). RED: a T2 declaration plus a gate command →
the surfaced ladder contains `REQUIRED if action-flagged`. Files: `hooks/guard-gate-ladder.mjs`
(+1 / −1, comment +1 / −1), `tests/kit-controls-lane.test.mjs` (+~6).

## 7 · Codex hook trust

No `.codex/hooks.json` entry changes (I3): items 3, 4b, 4e and 6 change hook **scripts** only, and
Codex keys trust to the registration entry. An adopter upgrading v2.34.0 → v2.35.0 stays armed and
owes no re-trust; `init --force` will print the unchanged-entries text (item 4c). The commit-msg hook
is a Git hook and binds every lane without Codex trust. The release note says both.

## 8 · Wording sign-off (Owner, D-02)

Required: `core/WORKFLOW.md` Step 0 entry-line sentence (item 2) · `templates/BINDINGS.md.tmpl`,
`templates/CLAUDE.md.tmpl`, `templates/AGENTS.md.tmpl` pair-file clauses (item 3).
For the same packet, not core: `skills/architect-build/ROUTING.md` 16–17 · the printed T2 ladder
string (item 6) · the new refusal/deny messages (items 1, 2, 4b, 4e) · `README.md` v2.35.0 note ·
`PORTABILITY.md` edits.

## 9 · Decisions owed before build

- **D1 · Record location (item 1).** Records must be inside the checkout. This program's own Principal
  record lives in an agent memory directory outside the repo; under this rule it must be copied or
  committed into the checkout to be citable. Alternative: also accept a path under `memoryDir` from
  `kit.config.json` (+~4 lines, a second root to validate). Recommendation: repo-only.
- **D2 · Check placement (item 1).** Recorder (controller Δ 0; no mixed-controller ceremony) versus
  controller dispatcher (+6 / −2 controller lines; every multi-worktree adopter must upgrade all
  worktrees together). Recommendation: recorder. This departs from the brief's "touches
  `repair-dispatch-state.mjs`".
- **D3 · Match strictness (item 1).** Plain substring (brief) versus a token-boundary match (same
  line count, rejects `D-1` inside `D-12`). Recommendation: token boundary.
- **D4 · commit-msg exemptions (item 2).** Merge, `Revert "`, `fixup!`/`squash!`/`amend!`.
  Recommendation: as listed.
- **D5 · FM-41 guard shape (item 4d).** Suite tripwire plus helper fix (catches helper-routed calls)
  versus the lexical guard alone (the brief's "guard test"; blind to the observed leak).
  Recommendation: tripwire, lexical rule kept as a hint.

## 10 · Line plan

| Area | Added | Deleted |
|---|---:|---:|
| `hooks/repair-dispatch-state.mjs` (controller) | 0 | 0 |
| `scripts/record-repair-event.mjs` | ~16 | 0 |
| `githooks/commit-msg` (new) | ~55 | 0 |
| `bin/init.mjs` | ~57 | ~15 |
| `hooks/guard-brief-rung.mjs` | ~29 | ~7 |
| `hooks/guard-gate-ladder.mjs` | 2 | 2 |
| `scripts/run-checks.mjs` | ~18 | 0 |
| test helpers and call-site hygiene | ~10 | ~1 |
| **Code total** | **~187** | **~25** |
| Tests (new + extended) | ~260 | ~5 |
| Docs (`core/WORKFLOW.md` byte-neutral, templates, ROUTING, PORTABILITY, README, VERSION) | ~45 | ~10 |

Against a ~150-line code plan this is ~1.25×, under the 2× trip wire. Controller delta 0 / 0 under
D2's recommendation; +6 / −2 under the alternative.

## 11 · Rebase over C-DOC

Shared files: `README.md` (release notes — additive), `VERSION` / `package.json` (2.34.0 → 2.35.0),
`skills/architect-build/ROUTING.md` (C-DOC rewrites nearby lines; C-CODE edits lines 16–17 after
rebase; budget 779 / 900 after C-DOC), `core/WORKFLOW.md` (C-DOC does not touch the Step 0
paragraph; C-CODE's edit is byte-neutral against C-DOC's 25,588 B). No source, test, template, hook,
script, core or skill file is edited before C-DOC lands. The hook string (item 6) matches C-DOC's
final row text; if C-DOC's wording changes before landing, item 6 follows it.
