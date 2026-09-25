# v2.33.1 design contract — safe adoption of v2.33 and Claude Code parity

**Status:** PRE-CODE design contract (CHIP B of the post-v2.33 kit program). Tier **T2**, entry
`class-2,3,4`. Base `origin/main` `594cb730906252b0ec85d9a1088ffd70bd89237d` (`package.json` 2.33.0).
Version rule: this changeset bumps the PATCH from the real `origin/main` head at build time (expected
2.33.0 → 2.33.1). The build rebases onto the head that carries the test-file split (CHIP A) before any
source, test or template edit; every line number below is at `594cb73` and must be re-verified then.

Every claim in this document is a hypothesis for review to falsify. Line citations were opened at
`594cb73` unless a different commit is named.

---

## 1 · Scope, and what is out

**In scope (eleven items):** B1 mixed-version ledger guard · B2 recorder contract + the `core/WORKFLOW.md`
version sentence · B3 release note · B4 "How to start a build" · B5 controller freeze rule · P1 Claude Code
send screen · P2 pairing records lane + id · P3 mixed Claude↔Codex pair is file-only · P4 reviewer
availability route both ways round · P5 live proof of the Claude tool payloads and one real screened send ·
P6 (covered by B4).

**Out of scope:** action flags replacing T3, a Principal record check, skill-budget headroom, a commit-msg
`entry:` hook (all a later changeset); ledger migration or any rewrite of existing ledger rows; splitting
`core/GATES.md`; test pruning; any adopter repository. **No change to `hooks/repair-dispatch-state.mjs`**
(the controller) — every item below lives outside it, which is also what B5's freeze rule asks.

**Tier purity (RUNG_ZERO § 0.2).** The changeset mixes T2 control code (B1, P1, P2) with prose (B2–B5, P3,
P4). The prose is not separable in practice: B3's release note, B1's upgrade-order rule and P1–P3's
documentation describe the control code's behaviour and must land with it. Default is separately-gated
commits inside one chip; this contract proposes **one T2 changeset** because every prose item either
documents a control shipped here or changes gate-routing semantics (P4 is itself T2: a changed gate
route). The PM may split prose-only commits out if a reviewer shows one is separable.

---

## 2 · Invariants the build must hold

- **I1** — No existing ledger row is rewritten, re-hashed, migrated or deleted. The controller file
  `hooks/repair-dispatch-state.mjs` is byte-unchanged in this changeset.
- **I2** — The Codex lane's send path behaves byte-for-byte as at `594cb73`: same `.codex/hooks.json`
  entries (matcher, command, timeout, statusMessage) for an unchanged checkout path, same decisions for
  `mcp__codex_app__send_message_to_thread`, same `pairedPmThreadId` semantics and init flag.
- **I3** — Every existing `kit.config.json` stays valid; `pairedPmThreadId` keeps working unchanged. A
  config written by 2.33.0 is read identically by 2.33.1.
- **I4** — No new send is DENIED that 2.33.0 allowed, except a send to a newly configured Claude PM pair
  (which only exists if the operator configures it) and — build delta, § 10 — a Claude send in a checkout
  whose `kit.config.json` is malformed (the guard cannot tell which send is the PM's, so it fails closed,
  as it already does for brief writes).
- **I5** — Skill word budgets are not raised: `skills/architect-build/SKILL.md` ≤ 550, `ROUTING.md` ≤ 900,
  `skills/orchestrate/SKILL.md` ≤ 1400 (all three at cap today — § 5).
- **I6** — `core/WORKFLOW.md` stays within its doc-size cap (25,600 B; it is 25,599 B at `594cb73`).
- **I7** — Every test that runs `init` passes an isolated `--codex-prompts-dir`; no test touches the
  real `~/.codex/prompts` or the real `~/.codex/config.toml`.
- **I8** — Fail-closed stays fail-closed: every new refusal/deny exits the way its neighbours do (init:
  nonzero with the reason and remedy; hook: a well-formed PreToolUse deny).

---

## 3 · Items

### B1 · Mixed-version ledger

**Harm (functionality, reproduced by the program's evaluation).** The repair ledger lives in the Git
common directory (`hooks/repair-dispatch-state.mjs:14` `REPAIR_LEDGER_REL`; `:426` `repairLedgerPath` joins
it to `git rev-parse --git-common-dir`), so **every worktree of a repository shares one ledger**. v2.33
mints aggregate rows with `policy_version: 4` (`:26`), or 3 on a historical v3/T3 lineage (`:787–791`). The
v2.32.1 reader (`fa92aa5:hooks/repair-dispatch-state.mjs:86`) accepts only an absent field or its own
version 2; one unknown row makes `readRepairLedgerRows` return `null` for the whole file, so
`loadRepairEventsForProject` reports `repair-ledger-unavailable` and v2.32's `guard-brief-rung`
(`fa92aa5:hooks/guard-brief-rung.mjs:615–616`) **denies every tool-bound source write** in every v2.32
worktree of that repo — permanently, since the row cannot be removed (I1). The trigger is ordinary: an
adopter upgrades one worktree, records one gate round there, and every sibling worktree still carrying the
old hook bytes (tracked `.claude/hooks/` on an un-merged branch, or a per-checkout gitignored
`.codex/hooks/` copy that a merge does not refresh) is locked out.

**Options weighed.**

| Option | Closes the harm? | Cost / risk |
|---|---|---|
| (a) Documentation only (upgrade-order rule + release note) | No mechanism; depends on the operator reading it | Cheapest; the harm is silent until the lockout |
| (b) Make the new writer mint rows the old reader accepts | Only by writing v4 semantics under a v2 marker — a lie in a ledger; forbidden in spirit by I1 | Rejected |
| (c) Runtime check in the controller before the first v3/v4 append | Yes, at the exact moment of harm, including worktrees created later | Adds a controller feature, a Git enumeration on the write path, and violates B5's freeze; rejected |
| (d) **`init` guard (brief's form):** before writing anything, compare the controller bytes about to be installed with the installed controller in every other worktree of the target; refuse with the list and remedy unless an explicit flag acknowledges | Yes for every worktree that exists at upgrade time — the moment the operator is choosing to create the hazard | One Git call + ≤2 file hashes per worktree at init time; residual: worktrees created or checked out later (§ 7) |
| (e) (d) but comparing the controller's *accepted policy set* (regex the other file's `AGGREGATE_POLICY_VERSION`) instead of bytes | Same, with fewer false positives on byte-only patches | Reads semantics out of code text with a regex; an unknown shape must fail closed anyway, so it only helps where a byte-different controller is fully compatible — rare under B5's freeze |

**Chosen: (d), byte comparison, plus (a).** It is the simplest mechanism that closes the harm at the
decision point, it lives outside the controller (B5), and it never touches a ledger row (I1). (e) is
recorded as the upgrade path if byte-only controller patches become common.

**Mechanism.**
1. At the start of `init` — after argument parsing and target resolution, **before any file is written** —
   run `git -C <target> worktree list --porcelain`. If Git cannot answer (not a repository, Git absent), the
   guard has nothing to compare and says so in one line (first adoption of a non-Git directory is legal
   today); it does not refuse.
2. For each listed worktree whose realpath differs from the target's: if the directory is missing
   (`prunable`), note it and skip (it cannot run hooks). Otherwise hash
   `<wt>/.claude/hooks/repair-dispatch-state.mjs` and `<wt>/.codex/hooks/repair-dispatch-state.mjs` when each
   exists as a regular file (lstat; a symlink is read as "unreadable"). Absent in both ⇒ that worktree has no
   controller and cannot be locked out by this hazard — skip.
3. Compare each hash with the kit's own `hooks/repair-dispatch-state.mjs` (the bytes `init` would install).
   Any mismatch, or any present-but-unreadable file, is a **mixed-controller finding**.
4. With ≥1 finding and no acknowledgement flag: print every finding (worktree path, branch or `detached`,
   which copy, first 12 hex of its hash vs the kit's), the harm in one sentence, and the remedy — then
   **exit nonzero with nothing written**. The remedy is an ORDER, because `init` upgrades one worktree per
   run and each not-yet-upgraded worktree would otherwise refuse on the others (a sequential upgrade would
   loop): *upgrade every listed worktree now, one after another, before any worktree records a gate round —
   pass `--allow-mixed-repair-controllers` on every run except the last (the last run finds no mismatch);
   for tracked hooks, merging the upgrade commit into a worktree's branch is that worktree's upgrade;
   per-checkout `.codex/hooks/` copies need `init --force` there; or finish/remove the worktree instead.*
   The refusal text names the flag verbatim.
5. New flag **`--allow-mixed-repair-controllers`** (name open to the PM): proceeds, and prints the same list
   as a WARN so the acknowledgement is visible in the run's output. The flag is added to the known-flag
   table (`bin/init.mjs:46`) so the value-parsing guard treats it correctly.
6. Documentation (a): an **upgrade-order rule** in `PORTABILITY.md` § Retained repair-controller boundary —
   upgrade all worktrees of a repo together; a v2.32 worktree is denied every source write once any worktree
   records a v2.33 gate round; recovery for a worktree already locked out is to bring its hook bytes to the
   new version (`git merge` of the upgrade is a Bash operation the write guard does not bind; per-checkout
   `.codex/hooks/` copies need `init --force` in that worktree) — no ledger edit is ever the fix. Same rule in
   the B3 release note.

**RED tests (new file, not a file CHIP A split, to avoid rebase conflict — proposed
`tests/init-mixed-controller.test.mjs`).** Each builds a scratch Git repo with a second worktree
(`git worktree add`) under a temp dir, runs `bin/init.mjs --target <wt1> --codex-prompts-dir <tmp>`:
- second worktree carries a byte-different `.claude/hooks/repair-dispatch-state.mjs` ⇒ exit ≠ 0, stderr names
  that worktree and the remedy, and **wt1 has no new files** (directory listing equal before/after). RED at
  `594cb73`: init exits 0 and installs.
- same with a differing `.codex/hooks/` copy only ⇒ refused (covers the gitignored per-checkout case).
- second worktree carries identical bytes ⇒ proceeds.
- second worktree has no controller ⇒ proceeds.
- differing bytes + `--allow-mixed-repair-controllers` ⇒ proceeds and prints the WARN list.
- the refusal's stderr names `--allow-mixed-repair-controllers` verbatim (mutation: drop the flag from the
  message ⇒ red).
- **sequential upgrade** (Gemini design-gate F1): two worktrees both carrying an older controller; `init` in
  wt1 with the flag ⇒ succeeds; `init` in wt2 without the flag ⇒ succeeds (wt1 now matches); a run without the
  flag while wt2 is still old ⇒ refuses naming the flag.
- the second worktree's directory deleted (prunable) ⇒ proceeds with a skip note.
- a symlinked controller in the second worktree ⇒ refused (unreadable ⇒ finding).
Each assertion is struck-phrase-checked (PROTOCOLS § Evidence: a pin is real only if mutating the guard
turns it red) — the mutation is "delete the refusal branch" and "compare only `.claude/`".

**Files:** `bin/init.mjs`, the new test file, `PORTABILITY.md`, `README.md`.

### B2 · Recorder contract

**Harm (usability → functionality).** A caller of `scripts/record-repair-event.mjs` must supply two fields
nothing documents: `authority_route` (`"owner"` | `"principal"`) on a v3/v4 `child_continuation` and inside a
`process_review`'s `proposed_transition` for that purpose (`hooks/repair-dispatch-state.mjs:161–169`,
`:2337–2352`), and `proposed_transition.policy_version`, which must equal the version the recorder is about
to mint (`:2225–2227`). A wrong or missing value returns the generic `aggregate-process-review-malformed` /
`aggregate-continuation-malformed`, whose CLI hint (`scripts/record-repair-event.mjs:83–84`) names neither
field. Separately, `core/WORKFLOW.md:100` says "v3 mints explicitly" while the code mints 4 for new work.

**How a caller picks 3 vs 4 (to be documented, derived from `aggregateBaseEvent`, `:787–791`):** 3 when the
task's existing program — or, with no program, its pending child lineage — is a policy-3 lineage or tier
T3; otherwise 4. A new program is always 4. The caller does not choose; it must *match*, and the doc will
say to derive it the same way.

**Mechanism.**
1. Document both fields where recorder callers read: the recorder's usage header comment and its `--help`
   text in `scripts/record-repair-event.mjs`, and `PORTABILITY.md` § Retained repair-controller boundary
   (one paragraph). `skills/orchestrate/SKILL.md:96` already points callers at the recorder; no skill words
   are added.
2. Add field-specific hints to the recorder CLI's action map for the two `-malformed` states when the input
   lacks `authority_route` or carries a `proposed_transition.policy_version` different from the minted one —
   computed by the CLI calling the controller's exported read functions, **not** by changing the controller.
   If computing the minted version from the CLI needs an export the controller does not have, drop this step
   and keep the documentation only (I1 forbids touching the controller).
3. `core/WORKFLOW.md:100`: correct the version sentence **byte-neutrally**. Proposed:
   "absent/v2 history replays unchanged and v3 mints explicitly" →
   "absent/v2/v3 history replays unchanged; v4 mints explicitly" (+3 B for `/v3`, −3 B for ` and`→`;`).
   Exact wording is the Owner's (D-02).

**RED tests.** (i) A test that imports `AGGREGATE_POLICY_VERSION` from the controller and asserts
`core/WORKFLOW.md` contains `v${AGGREGATE_POLICY_VERSION} mints` and does not contain `v3 mints` — tied to the
code, so the next version bump reddens it. RED at `594cb73`. (ii) A recorder CLI test: a `process_review`
input with a wrong `policy_version` ⇒ stderr names `policy_version`; missing `authority_route` ⇒ stderr names
`authority_route` (only if step 2 survives). (iii) `node scripts/check-doc-size.mjs` still PASSes
`core/WORKFLOW.md`.

**Files:** `scripts/record-repair-event.mjs`, `PORTABILITY.md`, `core/WORKFLOW.md` **(core — D-02)**, a test.

### B3 · Release note

**Harm (usability).** The v2.33.0 section of `README.md` (lines 3–14) describes only `/architect-build`. An
adopter upgrading from v2.32.x is not told about: T3 retired for new work; the reviewer availability route;
Principal completion children; the recorder API (B2); the mixed-version hazard (B1); the retained-controller
upgrade limit already in `PORTABILITY.md` § Retained repair-controller boundary.

**Mechanism.** A new `## What's new in v2.33.1` section at the top of `README.md` (below B4's block) covering
this changeset *and* a "Missed in the v2.33.0 note" list covering the six items above. **Every bullet is
derived from bytes**, per `skills/orchestrate/PROTOCOLS.md` § Shipping: the build runs
`git diff fa92aa5..<head> --stat` (v2.32.1 → candidate) and maps each adopter-visible changed file to a
bullet or to an explicit "internal, no adopter action". The upgrade instruction is derived the same way:
which installed files changed (so `init --force` is required), which templates changed (so generated files
need a reviewed scoped replacement), and whether any `.codex/hooks.json` **entry** changed (§ P1/P2: it must
not; the note says "no hook registration entry changed" only if the test in P1 proves it).

**Proof.** No doc-pin test (a wording pin is decoration unless mutation-checked, and this is a one-time
note). Proof is the byte-derived mapping table, carried in the freeze packet for the panel, and a reviewer
check of every "installed" claim against `bin/init.mjs`'s actual copy list (FM-class: a release note written
from the plan, not the final diff). The existing version-consistency checks (README title vs `package.json`)
must stay green.

**Files:** `README.md`, `package.json` (version), `VERSION` if present in the copy list.

### B4 · "How to start a build" (also P6)

**Harm (usability).** Nothing tells a new user that skills are repo-local (so `init` must run in the target
repo first) or when to choose Architect-led vs PM-led.

**Mechanism.**
- `README.md`, directly under the title: a short block — run `init` in the target repo first; **Architect-led**
  (`/architect-build`, then `/orchestrate` under it) when ANY of: 3+ CHIPs · more than about a week · more
  than one repo · a blueprint that must survive thread restarts; **PM-led** (`/orchestrate` alone)
  otherwise; both lanes supported; a mixed Claude/Codex pair runs file-only (P3).
- One pointer line at the top of `skills/orchestrate/SKILL.md` and of `skills/architect-build/SKILL.md`
  naming the README block (≤ 14 words each).

**Word-budget arithmetic (measured at `594cb73` with `node scripts/check-skill-budgets.mjs`):**

| File | Now / cap | Add | Must cut | Proposed source of the cut |
|---|---|---|---|---|
| `skills/architect-build/SKILL.md` | 550 / 550 | ≤ 14 | ≥ the added count | The 19 words at `SKILL.md:15–16` ("File-only launch hands off. Without launch, preserve planning continuity only. Existing authorized execution does not need a renewed launch.") restate `ROUTING.md:10` ("…Without launch, preserve planning continuity only. Authorized execution needs no relaunch.") and ROUTING's file-only launch sentence at `:9–10` — the rule keeps one home, in ROUTING |
| `skills/architect-build/ROUTING.md` | 900 / 900 | P2's Claude flag name (≈ 6) | ≥ the added count | A duplicate inside ROUTING itself, found at build by the neighbourhood sweep; if none is found without losing a rule, P2's flag is documented in `PORTABILITY.md` only and ROUTING points there by replacing its Codex-only flag clause (net ≤ 0) |
| `skills/orchestrate/SKILL.md` | 1400 / 1400 | ≤ 14 | ≥ the added count | A duplicate pointer — `core/OWNER_COMMS.md` is cited at `:11` and again at `:44`; further words from any sentence that restates a sibling file verbatim. **No rule is deleted to hit the number** (the file's own policy). |

Rule for every cut: the removed text must exist verbatim-in-meaning at a named authoritative home, proven
by opening that line, and the panel receives each cut as a before/after pair. If a file cannot reach
net-zero without deleting doctrine, the build STOPS and reports (raising a cap is an Owner call).
**Alternative for the PM:** the Claude/Codex skill shims (`skill-shims/*/orchestrate.md` 85 and 74 / 250;
`skill-shims/*/architect-build.md` 47 and 50 / 250) have headroom and are what an invocation loads first; the
pointer could live there instead of in the SKILL bodies, avoiding any cut. That deviates from the brief's
named location, so it needs a PM ruling.

**RED tests.** `check-skill-budgets` staying green is a guard, not RED. One test asserts both SKILL files
(or shims, per ruling) carry a line pointing at the README block's heading and that the README block's
heading exists — mutation-checked by renaming the heading.

**Files:** `README.md`, `skills/orchestrate/SKILL.md`, `skills/architect-build/SKILL.md`,
`skills/architect-build/ROUTING.md` (cut side), a test.

### B5 · Controller freeze rule

**Harm (functionality, prospective).** The controller is the largest single file in the kit (3,026 lines)
and every feature added to it has cost gate rounds; without a stated freeze, the next defect fix adds
another mechanism.

**Mechanism.** Two sentences in `PORTABILITY.md` § Retained repair-controller boundary: no new controller
feature without Owner approval; a change to the controller deletes about as much as it adds. **Proof:** none
beyond the panel (a rule for humans; no predicate can judge "feature"). **Files:** `PORTABILITY.md`.

### P1 · Claude Code send screen

**Harm (functionality of a control).** The Architect decision screen binds only the Codex tool
`mcp__codex_app__send_message_to_thread` (`hooks/guard-brief-rung.mjs:206`, `:648–672`). In the Claude lane:
(i) Claude Code's `SendMessage` tool is not matched by the settings matcher `.*send_message`
(`templates/settings.json:57`), so the hook never runs on it; (ii) the older
`mcp__ccd_session_mgmt__send_message` does reach the hook, but only the generic brief rung
(`:674–679`, target `session_id`), never the Architect screen. A Claude Architect can therefore direct a Claude
PM with no screen at all.

**Field names (from the tools' published schemas, to be confirmed by P5):**
`SendMessage` — `to` (string ≤ 300, a name, `name [ref]`, `main`, or an agent id), `message` (string, default
`""`), optional `summary` (not transmitted), optional `notify_when_idle`. `mcp__ccd_session_mgmt__send_message`
— `session_id` (a session id, or within a linked family a short name or `"parent"`), `message`.

**Mechanism.**
1. `templates/settings.json`: **add a new PreToolUse bucket with matcher `SendMessage`** registering
   `guard-brief-rung.mjs`; leave the `.*send_message` bucket byte-unchanged. Not "edit the existing matcher to
   `.*send_message|SendMessage`": init's settings merge keys buckets by exact matcher string
   (`bin/init.mjs:667`), so an edited matcher would add a second bucket on upgrade while the old one stays —
   the guard would run twice on every `*send_message` call, and the brief-rung receipt is single-use, so the
   second run could deny a correctly verified send. A separate bucket adds exactly one bucket on upgrade.
2. `hooks/guard-brief-rung.mjs`: a Claude-pair branch beside the Codex one. Resolve the Claude pair from
   config (P2). For `SendMessage`: the send is **to the pair** if ANY of these equals the configured target —
   the whole `to` string; `to` with one trailing ` [ref]` suffix removed; or the content inside that trailing
   bracket (Gemini design-gate F2: a mismatch fails open, so the match takes every form the address can carry).
   Prompt = `message`. The real `to` forms observed in the P5 capture are pinned in a test. For `mcp__ccd_session_mgmt__send_message`: destination = `session_id`; prompt = `message`.
   - Destination equals the configured Claude pair ⇒ identical handling to the Codex pair: deny if
     `tool_input` has `model`, `thinking` or `effort`; deny if the prompt is not a string; otherwise push the
     dispatch `{kind: "send", target, architectPrompt: prompt}` into the existing sidecar/screen path
     (`ARCHITECT_STATUS_V1` status marker, `architect-direction` receipt, prompt-bound screen) — no new
     screen grammar.
   - `SendMessage` to any other destination ⇒ **allow, as today** (today the hook never sees it; I4).
   - `mcp__ccd_session_mgmt__send_message` to any other destination ⇒ the generic brief rung, unchanged.
   - Config malformed ⇒ deny with the existing `architect-pair-malformed`/`kit-config-malformed` reasons.
3. The Codex branch is not edited (I2).

**Decisions inside P1 the PM must confirm (defaults proposed):**
- **D-P1a** Non-pair `SendMessage` stays unscreened (allow). The alternative — apply the generic brief rung
  to every `SendMessage` — would make every PM→Builder continuation owe a sidecar or status declaration: a
  new lockout surface not in scope.
- **D-P1b** A `SendMessage` to the pair with an empty or absent `message` (a pure `notify_when_idle`
  subscription) sends no direction ⇒ allow. Alternative: deny as `architect-prompt-missing` (stricter,
  blocks a harmless subscription).
- **D-P1c** The override block checks `model`, `thinking` and `effort` keys (Codex checks the first two).
  Alternative: deny any key outside the tool's known field set — catches future override fields but turns a
  benign harness schema addition into a total block of Architect→PM sends.

**RED tests (in `tests/brief-rung.test.mjs`, which CHIP A does not split — re-verify after rebase).**
With a Claude pair configured: `SendMessage` to the pair, unscreened direction ⇒ deny (RED at `594cb73`:
the hook's `SendMessage` path allows); screened direction with a valid sidecar ⇒ allow; `ARCHITECT_STATUS_V1`
status ⇒ allow with a status receipt; `to: "<pair>"`, `to: "<pair> [abc123]"` and `to: "<name> [<pair>]"` ⇒ each treated as
the pair; `to: "<other> [abc123]"` ⇒ not the pair; `model`/`thinking`/
`effort` present ⇒ deny; `SendMessage` to another name ⇒ allow; ccd send to the pair unscreened ⇒ deny; ccd
send elsewhere ⇒ generic rung exactly as before. Settings: the shipped template has a `SendMessage` bucket;
merging the 2.33.1 template into a 2.33.0-generated `settings.json` yields exactly one bucket per matcher and
no duplicated command. Codex: a test that the generated `.codex/hooks.json` `hooks` object for a fixed path is
deep-equal to 2.33.0's (description string excluded — it carries the version) — this is I2's proof and the
basis of the hook-trust statement below. All existing Codex-pair tests unchanged and green.

**Files:** `hooks/guard-brief-rung.mjs`, `templates/settings.json` **(template — D-02)**, tests.

### P2 · Pairing records lane + id

**Harm (functionality).** `kit.config.json` can name only a Codex thread (`pairedPmThreadId`,
`hooks/guard-brief-rung.mjs:162–165`; `init --paired-pm-thread-id`, `bin/init.mjs:112–118`), so no Claude
pair can be configured and P1 has nothing to match.

**Options.** (a) **A second flat key, `pairedPmClaudeTarget`** (lane encoded in the key), with init flag
`--paired-pm-claude-target <name-or-id>`. (b) A structured key `pairedPm: {lane: "claude"|"codex", id}` with
`pairedPmThreadId` read as `{lane: "codex"}`. (a) mirrors the existing key, changes no existing parse path,
needs no precedence rule between two representations of the Codex pair, and keeps I3 trivially. **Chosen:
(a)** (name open to the PM). The record still states lane + id: the key names the lane.

**Mechanism.** `loadBriefConfig` validates `pairedPmClaudeTarget` when present: a string of 1–300 characters,
no CR/LF, no leading/trailing whitespace (Claude names may contain inner spaces — unlike Codex thread ids,
which keep their no-whitespace rule). Present-but-invalid ⇒ `ok: false` (fail closed, as for the Codex key).
Both keys may be present; each scopes its own tool. `init`: new flag, added to the known-flag table, the HELP
text, `config` assembly (`:1597`) and the refuse-to-drop family list (`:1599–1604`) so `--force` never silently
drops it. Documentation: `PORTABILITY.md` pairing paragraph (`:359–386`), `skills/architect-build/ROUTING.md`
(budget per B4), templates `CLAUDE.md.tmpl`/`AGENTS.md.tmpl`/`BINDINGS.md.tmpl` where they describe the pair.
Guidance written into the docs: configure the PM's stable session id (`local_…`) where the harness exposes
one, and address the PM with exactly that string — titles are renamed.

**RED tests.** Config with a valid Claude target ⇒ pair configured (RED: key ignored today); malformed values
(empty, newline, 301 chars, leading space, non-string) ⇒ `kit-config-malformed` deny; a 2.33.0 config with only
`pairedPmThreadId` ⇒ identical decisions to today; `init --paired-pm-claude-target X` writes it; `init --force`
without the flag on a config holding it ⇒ refused with the flag named (mirrors the existing
`pairedPmThreadId` refusal test).

**Files:** `hooks/guard-brief-rung.mjs`, `bin/init.mjs`, `PORTABILITY.md`, `ROUTING.md`, templates
**(D-02)**, tests.

### P3 · Mixed Claude↔Codex pair is file-only

**Harm (usability).** Nothing says what to do when the Architect and PM run in different harnesses. There
is no shared messaging tool, so no pair can be configured and no send screen can bind.

**Mechanism.** State it in `PORTABILITY.md` (pairing paragraph), the B4 README block and the templates'
pairing sentences: a mixed pair runs **file-only** — the durable program record carries directions and
consults; no `pairedPm*` key is configured; the hook screen does not apply and nothing claims it does.
No skill words (budget). **Proof:** panel only. **Files:** `PORTABILITY.md`, `README.md`, templates
**(D-02)**.

### P4 · Reviewer availability route, both ways round

**Harm (usability → gate integrity).** `core/REVIEW.md` § Required-review availability route (`:64–72`),
`core/GATES.md` § Routing (`:118–121`) and `templates/BINDINGS.md.tmpl:21–28` state the fallback only for an
unavailable **Claude** seat on a **Codex** build. On a Claude build whose Codex code-gate seat is unavailable,
an operator has no stated route and may wait, skip, or silently substitute.

**Mechanism.** Add the mirror route in the same three places, same shape and receipt fields: Codex seat
unavailable on a Claude build (capacity, outage, unsupported runtime — never a substantive `NO-GO`) ⇒ record
no verdict; use the Gemini lens only when its verified binding and transport cover the full artifact and
scope; otherwise a fresh cold **same-family Claude frontier pass** recorded `same-family-only`, never called
cross-family. And state how a Claude lane reaches the GPT seat: the Codex runner installed by
`init --with-gate-runners` (`scripts/codex-gate.sh`). The template gains the Claude-build paragraph with its
own placeholders only if a placeholder is needed; prefer reusing existing ones.

**Constraints.** `core/REVIEW.md` is 22,881 / 25,600 B — room exists; `core/GATES.md` is REFERENCE (no cap).
The frontier pass in this route is an availability substitute, not a discretionary firing; whether it
counts against the one-firing-per-changeset cap (`core/GATES.md` § Model · effort matrix) is **D-P4a for the
PM/Owner** — proposed: it counts, because the cap is about cost and this is a frontier firing.

**RED tests.** A doc test that each of the three files names both directions (asserting the sentence, not a
word, and mutation-checked by striking each direction's sentence). **Files:** `core/REVIEW.md`,
`core/GATES.md` **(core — D-02)**, `templates/BINDINGS.md.tmpl` **(template — D-02)**, a test.

### P5 · Live proof (not reading)

**Purpose.** P1's field names come from tool schemas, not from an observed hook payload. The proof records
what a real PreToolUse hook receives, then one real screened Architect→PM send.

**Plan.**
1. **Scratch repo:** `git init` under the session scratchpad (never in a kit or adopter checkout); adopt
   it with the **candidate** kit: `node <candidate>/bin/init.mjs --target <scratch> --codex-prompts-dir
   <scratch-tmp> --skip-codex-prompt` (the Codex lane is not under test here).
2. **Capture:** add a temporary PreToolUse bucket with matcher `SendMessage` and a second with
   `.*send_message` running a 10-line capture script that writes its raw stdin (sha256 + bytes) to
   `<scratch>/.capture/<n>.json` and exits 0 without output — ordered before the guard so a deny does not hide
   the payload. Then, from a Claude Code session whose project root is the scratch repo, fire one `SendMessage`
   and one `mcp__ccd_session_mgmt__send_message` at a scratch receiver session (content: a one-line test
   message). Record `tool_name` and every `tool_input` key and value type.
3. **Screened send:** remove the capture buckets; configure `pairedPmClaudeTarget` to the receiver's address;
   send (i) a direction with no sidecar ⇒ expect the deny, captured from the tool result; (ii) the same
   direction with a valid sidecar and Architect screen bound to the exact message bytes ⇒ expect delivery.
   Receipt each: tool result text, the `.claude/lane-ledger.jsonl` row the guard appends (its own signature,
   PROTOCOLS § Evidence), the sidecar's sha256, and the kit candidate SHA.
4. **If P5 disagrees with the schema names** (e.g. `SendMessage` arrives under another `tool_name`, or
   fields differ), P1's code and tests follow the observed payload and the freeze packet says so.

**Feasibility, stated.** A background subagent cannot open a Claude Code session in another directory; the
hook set is fixed at session start from that session's project. Step 2–3 therefore need either (a) a headless
`claude -p` run with its project root in the scratch repo, if that mode exposes `SendMessage` (to be tried
first, cheaply), or (b) two Desktop sessions opened on the scratch repo by the PM or the Owner. Which route
ran is recorded in the receipt. The ccd tool is documented as unavailable in unattended sessions, so its
capture may need (b) even if (a) works for `SendMessage`.

### P6 · covered by B4.

---

## 4 · Codex hook-trust consequence

Codex keys trust to each `.codex/hooks.json` **entry** (command, timeout, statusMessage), not to the hook
script (v2.32.1 note; measured then with the arming probe). This design changes **no Codex entry**: P1 adds a
Claude-only settings bucket; P2 adds a config key and an init flag; the Codex matcher, command strings,
timeouts and status messages are unchanged (I2), and P1's deep-equality test proves it for a fixed checkout
path. The top-level `description` string changes with the version as in every release; it is not part of an
entry. **Consequence: a script-only upgrade; hooks stay ARMED.** The release note says so only if that test
is green on the frozen candidate, and tells adopters to run `node scripts/check-codex-hooks-armed.mjs` after
upgrading, re-trusting only on NOT ARMED. If the build finds any Codex entry must change, the note instead
says that entry is NOT ARMED until re-trusted, and the PM is told before freeze.

Claude-lane note: Claude Code reads project hook settings at session start, so an upgraded adopter's
`SendMessage` screen binds only sessions started after the merge; the release note says so.

---

## 5 · Files touched, and which need the Owner's wording sign-off (D-02)

| File | Items | D-02 |
|---|---|---|
| `bin/init.mjs` | B1, P2 | — |
| `hooks/guard-brief-rung.mjs` | P1, P2 | — |
| `scripts/record-repair-event.mjs` | B2 | — |
| `templates/settings.json` | P1 | **yes (template)** |
| `templates/BINDINGS.md.tmpl` | P2, P3, P4 | **yes (template)** |
| `templates/CLAUDE.md.tmpl`, `templates/AGENTS.md.tmpl` | P1, P2, P3 | **yes (template)** |
| `core/WORKFLOW.md` | B2 | **yes (core)** |
| `core/REVIEW.md`, `core/GATES.md` | P4 | **yes (core)** |
| `PORTABILITY.md` | B1, B2, B5, P1, P2, P3 | — |
| `README.md` | B3, B4, P3 | — |
| `skills/orchestrate/SKILL.md`, `skills/architect-build/SKILL.md`, `skills/architect-build/ROUTING.md` | B4, P2 | — (net-zero budget, § B4) |
| `package.json` (+ `VERSION` if tracked) | version | — |
| tests: new `tests/init-mixed-controller.test.mjs`; `tests/brief-rung.test.mjs`; one doc test file | all | — |

Not touched: `hooks/repair-dispatch-state.mjs`, any `.codex/hooks.json` entry shape, any ledger.

---

## 6 · Threat model

**In model:** cooperative-but-fallible agents and operators — a worktree upgraded out of order; a
recorder caller guessing fields; an Architect sending a direction without a screen, by habit or by using a
different send tool; a harness addressing the PM by an alias; an upgrade re-run that duplicates a settings
bucket; a reviewer seat unavailable mid-program.

**Out of model:** a deliberately adversarial agent (a fabricated sidecar already satisfies the brief rung —
its header states this); shell writes and shell-launched sends (tool-bound hooks never see them); a user who
edits hook files by hand; another repository's ledger (ledgers are per Git common dir).

**Mitigation claims (each a hypothesis to falsify):**

| Claim | Mechanism | Where it could fail |
|---|---|---|
| An upgrade cannot silently strand an existing worktree | B1 refusal before any write | Worktrees created/checked out after the upgrade; worktrees in another clone that shares the common dir by `GIT_COMMON_DIR` override |
| A Claude Architect's direction to its configured PM owes a screen | P1 pair branch on both tools | Alias addressing (`to` by title vs id; `"parent"`); a third send tool; the hook not registered in a session started before upgrade |
| The Codex lane is unchanged | I2 + deep-equality test | A shared helper edited for P1 changes Codex decisions — covered by the unchanged Codex test set |
| No new lockout for ordinary work | D-P1a/D-P1b defaults | A config accidentally carrying `pairedPmClaudeTarget` in the PM's own checkout (the key is tracked with the config) — the PM's sends to *itself* never happen, so only sends *to* that name are screened |
| Budgets not raised | check-skill-budgets + cut rule | A "duplicate" cut that was the loaded layer's only copy of a rule |

---

## 7 · Residuals (accepted, named)

- **R1 (B1)** The guard is point-in-time. A worktree created or an old branch checked out *after* the
  upgrade carries old hook bytes and is locked out once a v3/v4 row exists. Documented as the upgrade-order
  rule; recovery path documented; no mechanism (a runtime check would be a controller feature — B5).
- **R2 (B1)** Byte comparison refuses a byte-different but compatible controller; the flag is the escape and
  prints the list. Option (e) is the named upgrade path.
- **R3 (B1)** Worktrees sharing the common dir from outside `git worktree list` (manual `GIT_DIR`/
  `GIT_COMMON_DIR` setups) are invisible to the guard.
- **R4 (P1)** Alias addressing not covered by the match forms (a bare title when a ref or id is configured,
  or ccd `"parent"`) is outside the pair screen (a non-pair `SendMessage` is allowed; a non-pair ccd send gets
  only the generic rung). **P5 measured that this is the model's default:** asked to message "the agent named
  Probe PM", it wrote `to: "Probe PM"` with no ref. Mitigation (Principal D-10): the pair is keyed to the
  stable ref/id, so a rename never switches it off for a ref-form address; and in a paired checkout every
  unmatched `SendMessage` prints a notice naming the configured ref and the `"<name> [<ref>]"` form, so an
  unscreened PM send is never silent. It is still unscreened — see § 10 for the fail-closed alternative.
- **R5 (P1)** Future override fields beyond `model`/`thinking`/`effort` are not blocked (D-P1c).
- **R6 (P5)** `mcp__ccd_session_mgmt__send_message` is not exposed to a headless `claude -p` session, so
  its hook field names (`session_id`, `message`) remain schema-derived; `SendMessage`'s were observed.
- **R7 (P4)** A same-family fallback on a Claude build has no cross-family decorrelation; it is recorded
  `same-family-only` and never reported as cross-family.

---

## 8 · Gate plan (brief § 5, `core/GATES.md` § Pre-flight and § Routing)

1. Pre-flight (done before this doc): `§` references in this doc checked by hand at `594cb73`;
   `node scripts/check-doc-size.mjs` run — all ten kit-shipped governed docs PASS; the five FAILs are
   adopter-generated files the kit repo does not carry (`AGENTS.md`, `CLAUDE.md`, `core/BINDINGS.md`,
   `core/OWNER_COMMS.md`, `core/SYSTEM_MAP.md`). `core/WORKFLOW.md` has 1 byte of headroom (I6).
2. **Gemini design gate** on this document (`scripts/cold-review-gemini.sh --design`), free pass — no prior
   findings exist. PM disposition of its verdict before any build.
3. Rebase onto the post-CHIP-A head; re-verify every cited line; build each item RED → GREEN; `/kill-pass`;
   the recurring-defect sweep (`core/GATES.md` § Pre-flight step 4) against the diff.
4. Freeze (one freeze for all prose). Cold Claude panel: ≥ 2 angle seats + a free adversary; one angle owns
   the gate-machinery **adversarial walk-through** for B4/P4 (does any text now route a gate lighter than the
   mandate, or contradict § Routing?). Every seat is given the frozen SHA to verify and a fresh receipt;
   expected and observed model + effort recorded per seat.
5. **Codex code gate** (cross-family; `scripts/codex-gate.sh`, explicit `-m`/`-e`, workhorse · high per the
   matrix — this changeset is not money/credential/irreversible).
6. PM disposition after every verdict (`core/WORKFLOW.md` § Gate emission). One review round is the target.
7. **Owner wording sign-off** on every `core/` and template diff (§ 5 table).
8. P5 live proof receipted before the Owner push/PR GO. Push, PR and merge are Owner GOs.

---

## 9 · Decisions this contract asks the PM / Principal to confirm

| Id | Decision | Proposed |
|---|---|---|
| D-B1a | B1 mechanism | (d) init guard, byte comparison, flag `--allow-mixed-repair-controllers`; (e) recorded as upgrade path |
| D-B1b | Non-Git target | no refusal; one-line note |
| D-B2a | Recorder CLI hints | only if computable without touching the controller; else docs only |
| D-B4a | Pointer location | SKILL bodies with net-zero cuts (brief); alternative: skill shims (headroom, no cuts) |
| D-P1a | Non-pair `SendMessage` | allow, unscreened (as today) |
| D-P1b | Empty/absent `message` to the pair | allow (no direction sent) |
| D-P1c | Override fields | deny `model`, `thinking`, `effort` |
| D-P2a | Config shape | flat `pairedPmClaudeTarget` + `--paired-pm-claude-target` |
| D-P4a | Frontier fallback vs the one-firing cap | counts against the cap |
| D-P5a | Who opens the P5 sessions | try headless first; else PM/Owner opens two scratch Desktop sessions |
| D-T | Tier purity | one T2 changeset (prose documents the controls) unless a reviewer shows a separable prose commit |

**PM rulings (2026-09-25):** D-B1a, D-B1b, D-B2a, D-P1a, D-P1b, D-P1c, D-P2a, D-P4a and D-T confirmed as
proposed. D-B4a: pointer in the SKILL bodies, net-zero in all three files (a cut that would remove a binding
rule is a STOP-and-CONSULT, not a cut). D-P5a: routed to the Architect; P5 is the last proof before freeze.
Gemini design-gate findings F1 (B1 sequential-upgrade refusal loop) and F2 (P1 address forms) remediated
above in § B1 steps 4–5 and tests, § P1 step 2 and tests, and § 7 R4.

## 10 · Build deltas (recorded after the build; each folds into the same commit series)

- **Principal requirement D-10 (session-title rename must not silently switch off the screen).**
  `pairedPmClaudeTarget` holds the PM's stable `ListAgents` `[ref]` or session/agent id. Match forms: the
  whole address, the content of one trailing ` [ref]` (so `"<any title> [<ref>]"` pairs after a rename),
  or the name before it (the bare-name fallback, used only if an operator configured a name). A paired
  checkout gets a PreToolUse notice (`additionalContext`, never a deny) on every unmatched `SendMessage`,
  naming the configured ref and the address form that pairs. RED test: pair configured by ref, `to` carries
  a new title with the same ref ⇒ screened (`tests/claude-pair-send.test.mjs`). **Stronger alternative, not
  built (CONSULT at freeze):** in a paired checkout, treat an unmatched bare-name `SendMessage` as possibly
  the PM and require a screen or the status marker. It closes R4 but costs a status marker on every other
  Architect send, and — because `.claude/kit.config.json` is tracked — could reach a PM checkout on the
  same branch and gate the PM's own sends to builders.
- **P5 capture (method (a), Principal D-10).** Scratch repo adopted with the candidate; a logging
  PreToolUse hook on `.*` (denying every send after recording it, so nothing was delivered); headless
  `claude -p` (Claude Code 2.1.270). Observed `tool_name: "SendMessage"`; `tool_input` keys `to`, `summary`,
  `message`, `type`, `recipient`, `content`, with `recipient` = `to` and `content` = `message`. The ccd tool
  was not exposed. Consequences built: an address in `to` **or** `recipient` naming the PM makes it the
  PM's send; differing `message`/`content` deny as ambiguous; `content` is read when `message` is absent.
  The captured shape is pinned in the test. Replay of the captured payloads through the candidate's
  installed guard: ref-form without a screen ⇒ deny; with a prompt-bound screen ⇒ allow plus a
  `brief-rung` ledger row (target = configured ref); bare-name form ⇒ allow with the notice.
- **Deny message wording.** `architect-status-marker-missing` said "a configured-PM Codex send"; it now says
  "a configured-PM send" because the Claude pair reaches it. Decision unchanged (I2 holds on decisions and on
  every `.codex/hooks.json` entry).
- **`kit-config-malformed` and three new deny states** (`claude-pair-malformed`, `claude-send-override`,
  `claude-prompt-missing`) name `pairedPmClaudeTarget`; the Codex-pair states are unchanged.
- **B4 cuts, all duplicates with a named surviving home:** `orchestrate/SKILL.md` — the budget line's
  "body only — the three siblings each carry their own number" (the checker counts the whole file), the
  Doctrine line's `core/OWNER_COMMS.md` pointer (rule 8 is still cited at the Routing paragraph), and the
  Standing-duties PROTOCOLS pointer (still cited under the chip cycle). `architect-build/SKILL.md` — the
  record-contents list, whose authoritative copy is `ROUTING.md` § Lifecycle. `ROUTING.md` — "Record
  locators." (restated by the list above it) and "Authorized execution needs no relaunch." (pinned in
  `SKILL.md`, the loaded layer). No test-pinned sentence was cut.
- **`tests/kit-controls-init.test.mjs`** counted `guard-brief-rung` PreToolUse registrations as 5; the new
  `SendMessage` bucket makes it 6 (three matchers). The count assertion was updated, not removed.
- **Principal ruling D-11 (option C), built after the first freeze `064e45b` (no panel had run).** The pair
  stores the stable ref/id (`pairedPmClaudeTarget`, `--paired-pm-claude-target`) AND the PM's current name
  (`pairedPmClaudeName`, `--paired-pm-claude-name`; same validation: 1–300 characters, one line, no edge
  whitespace; malformed fails closed; `--force` refuses to drop it). A `SendMessage` is the PM's when any
  match form (whole address, name before a trailing ` [ref]`, bracket content) equals EITHER stored value,
  in `to` or `recipient`. The sidecar target is the stored ref, or the stored name when no ref is set.
  Unmatched sends keep the notice, which now also says to update `pairedPmClaudeName` after a rename. RED
  tests, confirmed failing on the exact assertion at `064e45b`: a bare `to` equal to the stored name is
  screened; after a rename `"<new title> [<ref>]"` is still screened; a bare new title is unscreened and
  gets the notice (the residual). **R4 now reads:** after a PM rename the stored name is stale until
  re-set — `node <kit>/bin/init.mjs --target <repo> --force --paired-pm-claude-target <ref-or-id>
  --paired-pm-claude-name "<new name>"` plus every other kit-config family held, or an in-place edit of
  `pairedPmClaudeName`; the ref match and the notice remain. R6 (ccd field names schema-derived) stands.
  Option B (screen every unmatched bare-name send) and moving the pair out of the tracked
  `kit.config.json` into per-checkout state are filed for CHIP C. `ROUTING.md` went 900 → 898 words.
- **Round 2 batch (panel on `d3f7052`; three PM REMEDIATE findings, one batch).** R2-1: `ROUTING.md`'s
  existing-config instruction named only `pairedPmThreadId`; it now names both lanes' keys (and the generated
  `BINDINGS.md` family list names the Claude keys). R2-3: the upgrade note's "no entry changed" held only from
  v2.33.0; README and PORTABILITY now tell a v2.32.x upgrade to re-trust the send entry, which the armed check
  (apply_patch only) cannot see. R2-2 (Principal D-15, option (a)): D-P4a stands; `core/REVIEW.md` and
  `BINDINGS.md.tmpl` add that a spent discretionary firing makes the mirror fallback an Owner-routed second
  firing (the existing reservation), and `core/GATES.md` adds "spent ⇒ an Owner-routed second firing". Each
  corrected sentence is pinned in `tests/release-v2331-docs.test.mjs` and mutation-checked.
