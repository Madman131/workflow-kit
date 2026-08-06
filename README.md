# workflow-kit — v2.4.0

## What's new in v2.4.0 — the pre-send verification rung, and the control that makes it bite

**`/orchestrate` shipped a method in which the orchestrator's own outbound text was the one artifact
nothing checked.** Briefs, rulings and GO asks carry numbers, citations and claims about frozen
documents — and they reach the artifacts they authorise before any seat sees them. Two independent
programs produced the same defect class repeatedly inside a single day: a count asserted over a
table that contradicted it, a budget asserted from a heuristic, a date asserted without opening the
section cited, an elapsed time off by an order of magnitude, a stale premise ratified into a
mis-scoped carve-out. One `grep -c`, or one opened line, would have killed each. Every one was
caught late — by a worker's raw look or the Owner's — never by anything checking the outbound text.

**The doctrine (`PROTOCOLS.md` § Coordination), in one line each.** Verify a load-bearing dispatch
BEFORE you send it: every citation opened at its line, every number recomputed by execution. Scope
it to load-bearing dispatches — briefs, rulings, GO asks — and no wider, because a rule that taxes
every status message is one nobody can afford, and an unaffordable rule gets switched off. A brief
POINTS at a landed form and its line; it never DICTATES wording, which is unreviewed authoring
smuggled in with the orchestrator's authority. Cold seats stay reserved for orchestrator-authored
doctrine; a brief gets the rung, not a seat.

**And because a prompt is not a control, the rung ships with one.** `hooks/guard-brief-rung.mjs` is
a PreToolUse guard that denies a brief write or a cross-session send unless a verification sidecar
(`.claude/brief-rung.json`) is fresh, names THIS session, names THIS dispatch, and carries at least
one executed check — a command AND its captured output. A send that is genuinely not load-bearing
may declare `{"class":"status"}` instead, and that declaration is LEDGERED for the Owner's
spot-check: the guard does not decide what is load-bearing, because that is a semantic call a hook
must not make for its consumer (`core/INVARIANTS.md` rule 1).

**One ritual authorizes one dispatch**, because freshness and target-binding together still let a
SECOND dispatch to the same target ride the first ritual — and that repeat is the dangerous one,
carrying text the original checks never saw. Consumption is a property of the AUDIT TRAIL: each
attempt appends a row carrying a unique token and then reads back, the first row bearing that nonce
wins, and the losers stand in the trail as legible refusals. No lock, so nothing to leave behind —
and the atomicity is the ledger's own, so the kit takes on no new platform assumption. Residual,
named: a process killed after its row lands burns that nonce without dispatching, and the cure is
re-running the rung. The ledger row records the declared class and the target in clear text, never
hashed, because its named consumer is the Owner's spot-check. That ledger **records; it does not
deter**: an orchestrator who declares everything `status` is not stopped mechanically, exactly as
`exempt` is not, and the compensation is that each declaration is a row a human can count.

**Its limits ship with it, in the deny text an author actually reads.** It proves a session- and
dispatch-bound RECORD of checks EXISTS — not that the commands were ever run, and not that they were
the right ones. Nothing executes a receipt or compares it to reality, so a fabricated sidecar
satisfies it: what it buys is a raised cost and an auditable trace, never impossibility. Saying
instead that it "proves the ritual ran" would be the very over-claim the rung exists to catch, so
the control does not say it. It is TOOL-BOUND — a shell redirection writes a brief without
passing it, exactly as every sibling guard is bypassed. It is a TRIPWIRE, not a floor. Its
cross-session SEND half binds a `…send_message` tool the Claude harness has and Codex does not, so
in the Codex lane that half is inert BY ABSENCE while the brief-write half binds through the shared
envelope grammar — stated in `PORTABILITY.md` rather than left to an adopter to infer.

**This release also corrects a sentence it falsifies.** `/orchestrate` shipped a blanket claim that
none of its rungs were enforced. One now is, so the body states exactly how much is — one rung, and
no more — and the retracted spelling joined the cross-surface retraction test — the maintenance rule v2.3.0 shipped, applied to the first
claim that came due under it. A pre-existing miss went with it: `PORTABILITY.md` had understated the
Codex registration since v2.2.0, naming the write guards and the gate-ladder sensor while omitting
the two `apply_patch` sensors that release registered.

## What's new in v2.3.0 — `/orchestrate`, the method for work too big for one thread

**The kit could gate a changeset but said nothing about running a PROGRAM.** Everything shipped so
far assumes one thread building one thing. The method that produced the last seven releases is
different: an Owner who holds intent and the merge-GO, an orchestrator session that briefs and
fold-checks and never merges, and one worker per changeset that owns its own gate ladder. That
split was carried in a private note and re-derived by hand for every chip. `/orchestrate` is it,
written down.

**What it says, in one line each.** One chip = one changeset = one version, in its own session, run
in a stated order — one way only, since a session can ship a second version when post-merge
execution finds a defect. The GO belongs to the Owner alone — and it may come straight to a worker, which
outranks any routing preference. **A GO ratifies a specific artifact**: if the changeset gains a
commit afterwards it is void until re-confirmed, and heads are pinned by SHA because a chip's branch
can fork mid-life. Before writing, a chip looks for competing writers in the repo's **lane
declarations** — not a list of sessions, which reports liveness and not intent, and which called a
repo single-writer while two lanes were committing to it. That check finds writers who **declared**;
an undeclared lane is invisible to it, so it is a check and not a proof, and the unclear case fails
closed into a private worktree.

**Two reference layers.** `CHIP_BRIEF.md` is what a worker is handed — nine sections, and the three
failures worth designing against (a re-presented brief carries stale facts; verbatim is not safe by
default; adapt the remedy to the target's defect surface). `PROTOCOLS.md` is a **bank**: every rule
with the incident that bought it, anonymised — the freeze that took three violations to stick, the
probe that certified a mechanism it never observed, the waiter that matched its own shell, the
merge proof that is permanently false for squash merges.

**Read the limit it states about itself.** The METHOD is portable; the PLUMBING is not. Clickable
task chips and cross-session messaging are harness features this kit does not ship and does not
assume, so the body names a degraded mode — a shared append-only record, briefs as files, consults
as entries in it — and says plainly that what degrades is latency, not the role split. **Nothing in
the skill is enforced**, and it says so: no control counts rounds, reads a freeze, or checks who
gave a GO. The kit still ships controls for the task-lane declaration and the commit floor — with
the lane, trust, fresh-clone and `--no-verify` limits PORTABILITY has always named.

**Also fixed, and it is the same class the last release shipped:** `PORTABILITY.md`'s `[P]`
inventory — the adopter-facing list of what gets copied verbatim — never gained `/sweep` when
v2.2.0 shipped it, so for a whole release the document was wrong about the tree it describes.
Adding a skill is precisely when nobody re-reads that line, so `tests/orchestrate-skill.test.mjs`
now derives the list from disk and reddens if any shipped skill is missing from it.

**The tests are doc pins, and the sentence pins are self-canaried.** A pinning assertion is
decoration when its spelling occurs innocently elsewhere in scope, so every pin routed through the
`pin()` helper strikes its exact phrase and fails unless the strike turns it red — a phrase
occurring twice is reported as a DEAD PIN rather than passed. **The structural assertions (the
reference-layer pointers, the `[P]` enumeration) do not carry that canary**; they are covered by the
mutation battery instead, which is a build-time rig and not part of `npm test`. Mutations against
the shipped text all killed, against a green positive control. Three gaps were found that way and
fixed: a pointer assertion a bare filename satisfied after the loadable path was deleted; an
enumeration check that searched a broad slice rather than parsing the list, so a reshaped inventory
could stay green; and the helper's own canary, which in its first draft stripped every occurrence
and so could never fire.

**Upgrading: a plain `init` re-run — do NOT pass `--force`.** This release adds files and edits
nothing an adopter already has, so a plain re-run ships the repo-local half in full: the body, both
reference layers and the Claude shim all land, and a hand-edited `[P]` file is preserved (executed
on an adopter created from v2.2.1). `--force` would buy nothing here and **destroys hand-edited
`[P]` content with no `.bak`** — also executed.

**One qualification, found by the review seat and then reproduced.** The Codex prompt installs into
a **user-global, flat** prompts directory shared by every repo, and `init` never overwrites a file
it did not write that run. So if a file named `orchestrate.md` already sits there, the plain re-run
**keeps yours and the Codex prompt does not land** — `init` says so on stderr (`! exists, kept`),
and it is the one asset whose delivery a plain re-run cannot promise. Read that line, and if it
names `orchestrate.md`, rename your file or pass `--codex-prompts-dir` at a directory you control.

# workflow-kit — v2.2.1

## What's new in v2.2.1 — a hotfix, and the check that should have caught it

**`sensor-sweep-owed` was inert in every adopter tree.** v2.2.0 shipped it importing
`"../scripts/check-doc-size.mjs"`. In the **kit** tree `hooks/` and `scripts/` are siblings, so that
resolves. In an **adopter** the hook installs to `.claude/hooks/`, where `../scripts/` means
`.claude/scripts/` — which does not exist. Every governed write in every adopted repo hit
`ERR_MODULE_NOT_FOUND`: the sensor printed a stack trace instead of its reminder, and never ran the
check it exists to run. `sensor-mutation-owed` was unaffected — it imports only a sibling in its own
directory.

**Fixed** by loading the module at runtime from the **project root**, where `scripts/` sits in both
layouts, and by **degrading instead of crashing**: if the module cannot be loaded the sensor keeps
its skill-path coverage, says once on stderr that the `CLASS: BINDING` half did not run, and still
exits 0. A top-level static import made that fallback unreachable — the failure happened before any
of the file's own error handling could run.

**Why four review rounds missed it, since that is the part worth keeping.** Every observer stood in
the kit tree, where the path works: the cross-family seat reviewed the kit checkout, the unit tests
import from the kit checkout, and the generated-adopter check verified **presence and registration**
— never **execution**. v2.2.0's own release notes warn that an installed-but-unregistered hook is
inert; this shipped one that was installed, registered, and crashing, which is the same failure one
door over. It was found by post-merge verification *by execution*, which is the only step that could
have found it.

**The real deliverable is the missing test**: `tests/sweep-sensor.test.mjs` now adopts into a scratch
repo and **runs both installed hooks from their installed location**, asserting exit 0, no
module-resolution error, no degradation, and that the sweep sensor actually emits on a governed
`CLASS: BINDING` doc and stays quiet on ordinary code. Proven against the defect: restoring the
v2.2.0 import turns it red.

**Upgrading:** `--force`, as for any `[P]` control change — and re-grant Codex hook trust afterwards,
since editing a hook disarms it until re-approved.

# workflow-kit — v2.2.0

A portable, versioned kit for building **production-critical systems with AI agents** under tiered,
decorrelated, fail-closed gates. It is the extracted, stable method + enforcement controls from a repo
that used it in anger for months (Workflow v2, Phase 6). **Pin a version; diff when you upgrade.**

## What's new in v2.2.0

**The gating doctrine catches up with what months of running it actually taught — and the two habits
that kept failing get an external trigger instead of a rule.**

- **Gemini reviews DESIGNS, not diffs.** The routing table is now keyed on who BUILT the change, and
  both lanes point the cross-family lens at the design-as-contract. Two measured reasons: transport
  reliability is a function of payload size and code gates are always large (a 461 KB code-mode run
  echoed 15 of 16 canaries — the tail and the receipt absent — and still emitted a confident,
  specific `NO-GO` from a partial read), and code mode was the lower-yield lens besides. Code mode
  survives as a **documented escape** inside the inline envelope, not as the standing route.
  **The release says plainly that this REDUCES cross-family coverage of the code** rather than
  calling the new shape equivalent, and names what a design lens cannot catch: an implementation
  defect with no design-level shadow. It also carries the **precondition** — the Codex cold panel
  must run through a guarded site, or the route quietly collapses to one family with every box ticked.
- **The frontier tier is capped at ONE firing per changeset**, "changeset" meaning the task rather
  than the file version, so re-freezing after a fix does not mint a second allowance. Default
  consumer is the fold-check on a remediation delta; discretionary consumers **compete for that one
  budget and are never additive**; the round-3 escalation, an Owner-initiated review, and the pinned
  decider seat sit outside it. Round-3 escalation is now **one rung, folded, on a mechanical
  trigger** — worst case two firings, and only where one finding-class has failed twice.
- **Rung ORDER binds** (`core/WORKFLOW.md` § Steer): the budget-free rungs run first, including one
  cross-family firing on the contract **before any code exists**, and the discovery rung runs `free`.
  The clause says which of its two rules is mechanically checkable and which is self-report only,
  rather than implying both are covered.
- **The alias-entitlement trap.** An entitlement error is not a reviewer verdict — and whether you
  retry at all depends on *which* id failed. There is no blanket retry, and it is never a pass.
- **`/sweep` — enumeration becomes a sensor's job.** `scripts/sweep.mjs` asks ONE mechanical question
  over an EXPLICIT file list at a cheap read-only seat, with a **wrapper-verified denominator**: the
  wrapper proves each file readable itself and fails the run unless every readable file comes back
  `scanned`. The per-file status is still the model's attestation, and the docs say so — **a
  zero-finding sweep is not a clear.** The kit hardcodes no model id; bind the seat with `--seat` or
  `sweepSeat` in `.claude/kit.config.json`, and a run with no seat fails closed.
- **Two PreToolUse sensors, because self-keyed triggers fail and externally-forced ones work.**
  `sensor-sweep-owed` fires when you are about to edit a `CLASS: BINDING` document or a skill body
  and reminds you the pre-fold dependency sweep is owed. `sensor-mutation-owed` fires when you are
  about to edit a check, a gate hook, or a control's test, and demands **both** polarities — a
  planted case that reddens AND a clean case that stays green, because fixing a false CLEAR is how a
  false FAIL gets minted. Both **print and never deny**, keep no state, and say outright that they
  cannot tell whether you ran anything.
- **A retired control, recorded so it is not rebuilt.** Commit-time gate-adjudication records were
  built, NO-GO'd twice and discarded: round counting is a *conversation* fact, not a *tree* fact, and
  the measured refutation was one permit followed by 8 accepted commits with zero dispositions. It is
  why `core/WORKFLOW.md` says no hook counts rounds, and it bounds what `pre-commit` may claim: **a
  commit-time hook is a tripwire for forgetting, never a boundary.**
- **Two stale claims corrected while in the neighbourhood.** `core/WORKFLOW.md` said the gate-ladder
  sensor was "Claude lane only" — it has registered in **both** lanes since v2.1 — and described the
  `exempt` tier as honoured when the hook deliberately does not honour it (honouring it would route
  to a *lower* tier, i.e. fail-open in a sensor).

**What this release deliberately does NOT ship.** The originating repo's census fix, which taught a
checker to count untracked files. Its census enumerated with `git ls-files`, so a file being ADDED
was invisible during its own build. **This kit never had that defect** — its checkers walk the
filesystem — so porting the fix would have been porting a remedy for a defect that is not here. What
ships instead is a **characterization test** pinning the filesystem enumeration, so a future refactor
to `git ls-files` reddens rather than silently reintroducing it.

### Upgrading to v2.2.0

**`--force` is REQUIRED for the doctrine, and this one is unusually easy to half-do.** Derived from
what the diff edits, and **executed both ways against a real v2.1.1 adopter** rather than assumed:

| Re-run | New sensors + `/sweep` installed and REGISTERED | Edited `[P]` core docs (`GATES` · `WORKFLOW` · `REVIEW`) |
|---|---|---|
| plain `init` | **yes** (new files; `settings.json` registrations merge) | **NO — exits 0 having shipped none of the doctrine** |
| `init --force` | yes | yes |

**That split is the hazard.** A plain re-run leaves you with sensors that fire correctly and cite
`core/WORKFLOW.md` § Gate and `/sweep` — while the WORKFLOW clause they point at is still the v2.1.1
text that does not contain it. The machinery arrives without the doctrine that explains it. Use
`--force`, or expect a reminder that references a rule your tree does not have.

**`--force` is GLOBAL, and its costs are unchanged from v2.1.1** — re-read that section below before
running it. In short: every `[P]` file that run installs is overwritten with **no `.bak`**;
`.claude/kit.config.json` is rewritten from the flags you pass **this** run, so omitting a family flag
you originally adopted with resets `executedPathDirs` to `{}` and **widens** the write guard; the
`[G]` files (`AGENTS.md`, `CLAUDE.md`, `core/OWNER_COMMS.md`) are regenerated with a `.bak` and your
hand-written paragraphs go back to placeholders. **Commit before you run it.**

**⚠ `--force` DISARMS the Codex lane until you re-grant trust.** This release edits the hook set, and
Codex re-arms its review prompt whenever a hook's contents change — an upgraded hook is skipped
**silently** until a human approves it in an interactive session. Migration order is therefore:
**upgrade → re-grant hook trust interactively → run the arming probe.**

**Verify it landed — a green `init` exit is not evidence:**

```bash
test -f core/GATES.md || { echo "FAIL no GATES doc"; exit 1; }
grep -q 'GEMINI REVIEWS DESIGNS, NOT DIFFS' core/GATES.md || { echo "FAIL routing reversal absent — did you use --force?"; exit 1; }
grep -q 'CAPPED AT ONE FIRING PER CHANGESET' core/GATES.md || { echo "FAIL frontier cap absent"; exit 1; }
test -f core/WORKFLOW.md || { echo "FAIL no WORKFLOW doc"; exit 1; }
grep -q 'Rung ORDER binds' core/WORKFLOW.md || { echo "FAIL rung-order rule absent"; exit 1; }
test -f .agents/skills/sweep/SKILL.md || { echo "FAIL /sweep body missing"; exit 1; }
test -f .claude/hooks/sensor-sweep-owed.mjs || { echo "FAIL sweep sensor missing"; exit 1; }
grep -q 'sensor-sweep-owed' .claude/settings.json || { echo "FAIL sensor INSTALLED but NOT REGISTERED — inert"; exit 1; }
grep -q 'sensor-mutation-owed' .claude/settings.json || { echo "FAIL mutation sensor not registered"; exit 1; }
echo "v2.2.0 verified — if you use the Codex lane, re-grant hook trust and re-run the arming probe"
```

Existence is tested **before** content, and the registration is checked separately from the file: an
installed-but-unregistered hook is on disk and inert, which is the failure this kit has shipped once
already.

## What's new in v2.1.1

**An ask stops hiding in a paragraph.** `core/OWNER_COMMS.md` gains an **eighth rule**: any question
for the Owner, any recommendation, and any decision they have to make appears **bolded, on its own
bulleted line, with a labeled lead** — `**QUESTION:**`, `**RECOMMENDATION:**`, `**DECISION NEEDED:**`.
Prose may still explain; the ask itself has to be findable by skimming alone. The failure it names is
specific and common: a well-written report that answers first, defines its terms and gives the
background, and then buries the one sentence the Owner has to act on in the middle of paragraph four.
Skim-findable or it is not formatted.

`/humanize` gains the matching miss — **a buried ask** — so the repair pass looks for it alongside the
seven it already checked. Nothing else changes: no new machinery, no control, no flag. The sensor
`guard-owner-comms.mjs` does **not** check rule 8, and `PORTABILITY.md` now says so in the same breath
as the rules it cannot check, with the distinction kept honest — five of those rules are out of a
sensor's reach, this one is merely unbuilt.

### Upgrading to v2.1.1

**`--force` is REQUIRED this release.** Derived, as always, from what the diff edits rather than from
habit: v2.1.1 changes two files you already have — the `[G]` `core/OWNER_COMMS.md` and the `[P]`
`.agents/skills/humanize/SKILL.md` — and `init` never overwrites a file it did not write in that run.
Executed both ways against a real v2.1.0 adopter: a plain re-run **exits 0 having shipped nothing** —
no rule 8, no `/humanize` line, and the doc still stamped `v2.1.0` — while `--force` lands both.

**`--force` is GLOBAL. It is not scoped to this release's two files.** It overwrites **every `[P]`
file that run installs** — the `core/*.md` method docs, the hooks, `scripts/`, `commands/`, `skills/`,
the shims, `agents/`, and the user-global Codex prompts — **with no `.bak` at all**, so any local edit
to those is recoverable only from git. (*That run* is the qualifier that matters: `--force` does not
choose WHICH assets are installed, your flags do. `--skip-codex-prompt`, `--skip-codex-lane` and a
missing `--with-gate-runners` each leave a family out entirely, so it is untouched rather than
protected.) It also rewrites `.claude/kit.config.json` from the flags you pass **this** run: omit the
`--source-dirs` (or other family) flags you originally adopted with and `executedPathDirs` resets to
`{}`, which **widens** the write guard until you restore it. All of this is executed, not inferred,
and pinned by test: a `--force` re-run on an adopter carrying hand-edited `[P]` files destroys them
with no backup and resets a configured `executedPathDirs: ["app"]` to `{}`. (`kit.config.json` and
the `[G]` files do get a `.bak` — but only when their new content actually DIFFERS; identical content
is rewritten with the same bytes and gets none.) **Commit before you run it.**

**What it costs for this release's own two files.** `core/OWNER_COMMS.md` is regenerated from the
template, so your `{{OWNER_PROFILE}}`, `{{IRREVERSIBLE_ASSET}}` and shorthand rows are replaced by
placeholders again. The previous file is saved to `core/OWNER_COMMS.md.bak`, `init` prints that path,
and it separately warns that the doc is ARMED with unfilled placeholders — but the sensor's shorthand
coverage is gone until you re-apply from the `.bak`, and a sensor that fails open reports nothing when
it does. The `[P]` `/humanize` body is overwritten with **no** `.bak`, which is intended: it is the
kit's file, not yours.

So there are two honest paths, and for a repo whose Owner doc is heavily hand-written the second is
smaller:

1. **`--force`** — re-run `init` with **every** flag you originally adopted with, the family flags
   included, plus `--force`. Then re-apply your profile, irreversible asset and shorthand rows from
   `core/OWNER_COMMS.md.bak`, and diff your `[P]` files against git rather than trusting the exit code.
2. **Hand-add rule 8** — paste the rule below into your `core/OWNER_COMMS.md` after rule 7, replacing
   `<Owner>` with your Owner's name, and paste the `/humanize` bullet into
   `.agents/skills/humanize/SKILL.md`. `--force` has no per-file form — it applies to everything that
   run installs — so for a customized adopter this is the smaller operation, and it is not
   second-class: nothing mechanical reads the rule count.

```markdown
8. **Questions and recommendations never blend in.** Any question for <Owner>, any recommendation,
   and any decision they must make appears **bolded, on its own bulleted line, with a labeled lead** —
   `**QUESTION:**`, `**RECOMMENDATION:**`, or `**DECISION NEEDED:**` — never buried mid-paragraph.
   Prose may explain; the ask itself must be findable by skimming alone. If <Owner> could scroll past
   it without seeing it, it is not formatted.
```

…and, in `.agents/skills/humanize/SKILL.md`, after the "Jargon, long sentences, bloat" bullet:

```markdown
- **A buried ask** — a question, recommendation, or decision left mid-paragraph, unbolded (rule 8):
  pull it out, bold it, label it.
```

**Verify it landed — a green `init` exit is not evidence:**

```bash
test -f core/OWNER_COMMS.md || { echo "FAIL no Owner contract"; exit 1; }
grep -q 'DECISION NEEDED' core/OWNER_COMMS.md || { echo "FAIL rule 8 not in the Owner contract"; exit 1; }
test -f .agents/skills/humanize/SKILL.md || { echo "FAIL humanize body missing"; exit 1; }
grep -q 'buried ask' .agents/skills/humanize/SKILL.md || { echo "FAIL /humanize still checks seven misses"; exit 1; }
echo "v2.1.1 verified — if you used --force, now diff core/OWNER_COMMS.md.bak and restore your own paragraphs"
```

Existence is tested **before** content: `grep` against a missing file exits non-zero for the wrong
reason, and a `!`-negated check would read that as clean.

## What's new in v2.1

**The Codex lane gets real write-time enforcement — and one command to prove it is on.** v2.0 measured
why a *port* was impossible: a Codex write carries no `file_path`, so the existing guards would either
allow everything or block everything. v2.1 ships the control those findings called for.

- **One guard file, both lanes, branching on payload shape.** `init` installs the same hooks to
  `.claude/hooks/` and `.codex/hooks/` — byte-identically — and registers them per lane. There is no
  Codex *copy* of a guard to drift out of date, which is precisely how the origin repo's Codex hooks
  rotted 48 hours out of step with their Claude twins without anyone noticing.
- **A real patch-envelope parser** (`hooks/payload-targets.mjs`) gating **every** target in one
  `apply_patch` call — including **both endpoints of a rename**, since `*** Move to:` can carry a file
  out of a gated directory as easily as into one. An envelope it cannot fully account for is
  **denied**, never partly trusted.
- **The registration uses the canonical Codex tool names** (`apply_patch`, `Bash`) — the names every
  captured payload actually carries. The accepted `.codex/hooks.json` schema was determined by
  **executing** Codex's own parser, which rejects the Claude-shaped file outright. (v2.0 said the
  Claude matcher spelling "matches nothing" in Codex; a review seat contested that with an alias
  claim this work could not reproduce, so `PORTABILITY.md` now records it as open. The canonical
  names are correct either way.)
- **A narrow, deliberate polarity change.** `guard-cross-repo-writes` used to `exit 0` whenever it
  found no target. That is invisible in the Claude lane and a total fail-open in the Codex lane, where
  *every* write lands in that branch. It is now three named classes: extractable ⇒ gate ·
  **write-shaped-but-unreadable ⇒ DENY** · no write intent ⇒ exit 0. A test executes the shipped guard
  and the retained v2.0 guard side by side over one corpus and proves **no Claude-lane decision
  changes** except on payloads the harness cannot produce.
- **One ledger row per target.** A five-target envelope writes five rows, in the v1.6.1 row shape,
  with no new fields. A patch applies as a unit, so one denying target denies the call — and every
  row records that, rather than claiming a permission that was never exercised.
- **`node scripts/check-codex-hooks-armed.mjs` — the arming probe.** It reports **ARMED** only on the
  guard's *own* signature (a new ledger row), never by inferring "blocked" from "the file is missing";
  an earlier design did the latter and certified hooks that were provably untrusted, because Codex's
  own sandbox had refused the write and Codex's narration misattributed it. Exits: armed 0 · not
  armed 1 · not installed 2 · `codex` CLI absent 2 · **nothing-was-tested 2** — every 2 an
  **abstain, never a pass**. That last exit exists because running the probe for real caught it
  calling a provably-armed lane UNGUARDED: Codex had read the repo's own `AGENTS.md`, declined on an
  identity precondition, and never attempted the write, so no hook could fire. It now tells "the
  guard did not stop it" apart from "nothing was tried" and abstains on the second.

**Read this part before you tell anyone the Codex lane is guarded.** The guards are
**installed · fail-closed by design · INERT unless your Codex run carries hook trust.** Codex will not
run a repo's hooks until a human approves them in an **interactive** session, and `codex exec` skips
unapproved hooks **silently** — no prompt, no warning, no exit-code change. The kit will never grant
that for you: it does not write Codex's trust store and does not use
`--dangerously-bypass-hook-trust`, because automating another tool's consent is forging consent, and
that flag would arm every hook from every source. **And the guards bind write *tools*: a Codex write
issued through a plain shell command is invisible to them, which in that lane is a main road, not a
corner case.** `.githooks/pre-commit` is still the only floor every writer converges at.
`PORTABILITY.md` § The enforcement asymmetry is the full account.

**Corrected from v2.0:** a repo-level `.codex/agents/` **is** a real Codex discovery root — v2.0
recorded, against its own artifact, that it might not be and that the shipped cold-review seat could
be inert. Executed since: Codex parses `.codex/agents/*.toml` and reports a malformed one, and the
kit's shipped template is valid to that parser.

### Upgrading to v2.1

**`--force` is REQUIRED this release**, and the reason is mechanical rather than habitual: v2.1
**edits `[P]` files you already have** — all three guard hooks — and `init` never overwrites a file it
did not write in that run. (v2.0's note said the opposite, correctly, because *that* release added
only new files. The rule is derived per release from what the diff actually edits; do not carry either
instruction forward.)

Executed against a real v2.0 adopter, a plain re-run leaves the lanes **split**: `.claude/hooks/`
already exists so its guards are kept at v2.0, while `.codex/hooks/` is brand new so its guards are
written at v2.1. `init` now **detects that split and warns**, naming the files and the fix — but it
still exits 0, so read the output.

1. **Re-run `init` with your original flags plus `--force`.** It overwrites the `[P]` guard hooks with
   this version. Note what `--force` costs elsewhere: your `[G]` files are regenerated from templates,
   so hand-authored content in `core/OWNER_COMMS.md` and any families you hand-added to
   `.claude/kit.config.json` are replaced. Both are backed up to `.bak` first and warned about — but
   check them afterwards rather than trusting the exit code. (Hook files are `[P]` and are overwritten
   with **no** `.bak`; that is intended — they are the kit's, not yours.)
2. **Re-grant Codex hook trust, interactively.** An edited or upgraded hook is marked CHANGED and is
   **DISARMED** until a human approves it again. Run `codex` in the repo once and answer "Hooks need
   review" with "Trust all and continue". Order matters: trusting before upgrading arms the old file.
3. **Verify:** `node scripts/check-codex-hooks-armed.mjs`. Exit 0 is ARMED; **exit 2 is an abstain,
   not a pass.**

**Verify it landed — a green `init` exit is not evidence:**

```bash
test -f .codex/hooks.json || { echo "FAIL missing Codex registration"; exit 1; }
test -f .codex/hooks/payload-targets.mjs || { echo "FAIL Codex guards not installed"; exit 1; }
test -f scripts/check-codex-hooks-armed.mjs || { echo "FAIL arming probe not installed"; exit 1; }
grep -q apply_patch .codex/hooks.json || { echo "FAIL registration uses the wrong tool names"; exit 1; }
diff -r .claude/hooks .codex/hooks || { echo "FAIL the two lanes have drifted — re-run init --force"; exit 1; }
echo "v2.1 adopt verified — now grant hook trust and run scripts/check-codex-hooks-armed.mjs"
```

Each check tests existence **before** content: a `grep` against a missing file exits non-zero for the
wrong reason, which a `!`-negated check would read as clean. The last line is deliberate — the checks
above prove the files are *installed*, which is not the same as *armed*, and only the probe answers
that. (If you passed `--skip-codex-lane`, none of these apply: that flag omits the Codex guards, the
registration and the probe, and `init` says so.)

## What's new in v2.0

**The enforcement asymmetry is now MEASURED, not assumed — and it is worse than the caveat said.**
Every version through v1.7 told you the PreToolUse guards bind only the Claude lane. That was an
inference from how the guards are registered. v2.0 replaces it with executed findings against a real
`codex-cli` (0.146.0-alpha.9.2, measured 2026-08-04). The conclusion held; the reasons did not survive
contact. **The full account is `PORTABILITY.md` § Why the Codex lane is unguarded — read it before you
describe your Codex lane to anyone.** The headlines:

- **The origin repo's Codex hooks never ran — not once.** Two independent reasons, either sufficient:
  their matchers (`Write|Edit|MultiEdit|NotebookEdit`) name tools **Codex does not have** (it writes
  via `apply_patch` and runs commands via `Bash`), and hook **trust was never granted**. Those files
  were also gitignored, so they were never committed, reviewed, or run in CI.
- **A Codex write carries no `file_path`.** It is a patch envelope that can add, update, delete and
  rename several files at once. Ported unchanged, `guard-cross-repo-writes` would take its no-target
  branch and **allow everything** — an installed control that silently permits — while
  `guard-lane-authoring` would deny *every* write including docs. So v2.0 ships **no Codex hooks at
  all** rather than a port that manufactures assurance.
- **Codex hooks are trust-gated, and the skip is SILENT.** Codex will not run a repo's hooks until a
  human approves them in an **interactive** session. In `codex exec` — the mode the kit's own gate
  runners use — an unapproved hook is skipped with no prompt, no warning, and no exit-code change.
  This is a platform property: it will apply to *any* Codex hook you install, ours or yours. Never
  reach for `--dangerously-bypass-hook-trust`; assume unarmed until you have watched one fire.
- **Shell writes are a main road in the Codex lane**, not the footnote they are in the Claude lane.
  Asked only to create a file, Codex reached unprompted for a shell command that MUTATED it
  (`truncate …`, receipt retained in `acceptance/fixtures/codex-payload-samples.mjs`). No PreToolUse
  write guard sees that.
- **The `.githooks/pre-commit` floor remains the only harness-agnostic mechanical floor.**
  Unchanged, and now load-bearing for a documented reason rather than by default. It is deliberately
  not called a *guarantee*: it is silently absent on a fresh clone until `core.hooksPath` is
  configured, and `--no-verify` bypasses it.

A kit-built Codex-lane guard, designed around the payload shape measured here, is **in flight as its
own gated changeset**. It is not in v2.0, and nothing in v2.0 depends on it.
**↑ Superseded at v2.1: that guard SHIPPED — see "What's new in v2.1". The trust gate, the silent
skip and the shell-write road all still apply to it, which is why they are stated above as platform
properties rather than as v2.0 limitations. Two v2.0 sentences are now wrong and are corrected there:
"v2.0 ships no Codex hooks at all" describes v2.0 only, and the Codex-lane `.codex/` files are no
longer all conveniences — the guards and their registration are controls.**

**BREAKING — `init --risk-tokens` is REMOVED.** Deprecated at v1.5.0 when the cost-inversion `lane`
route was retired, with a stated removal horizon of v2.0; this is that removal. It now **exits 2**
instead of being silently swallowed, and the message names the flag, the version and the fix. **The
flag and the config key are separate contracts and only the flag changed:** a legacy `laneRiskTokens`
key already in your `.claude/kit.config.json` stays **tolerated** — ignored, never fatal — so you do
not need to edit that file. (Executed against the write guard, the control that reads that config
most closely; the commit floor and the other guards never read the key at all.)

**New Codex-lane files — conveniences, NOT controls.** `init` now installs `.codex/config.toml` (pins
`GIT_PAGER=cat`, removing the default pager as a hang risk in a non-interactive run — nothing
verifies Codex loaded it, and a command can still set its own) and generates
`.codex/agents/cold-reviewer.toml`, a cold-review seat whose model is `[G]` — fill it with
`--codex-cold-model <name>`, or the `{{CODEX_COLD_MODEL}}` placeholder survives and `init`'s checklist
names it. **Neither enforces anything.** `--skip-codex-lane` omits both.

### Upgrading to v2.0

1. **Drop `--risk-tokens` from your saved `init` invocation.** This is no longer optional — the run
   now fails with exit 2. Nothing replaces it; leave your `kit.config.json` alone.
2. **Re-run `init` with your original flags — and do NOT add `--force`.** Unlike v1.7, this release
   edits **no** `[P]` file you already have: the entire installable delta is two brand-new files, and
   `init` writes new files without `--force`. So `--force` buys you only a refreshed version stamp in
   `core/OWNER_COMMS.md`, and it **costs** you the hand-authored content of every `[G]` file —
   your completed Owner contract is reverted to the raw template, and `.claude/kit.config.json` is
   rewritten from flags, silently dropping any family you added by hand. Both leave a `.bak` and warn,
   and `init` still exits 0. Most adopters should skip `--force` entirely. (Earlier releases DID need
   it, which is why the v1.7 and v1.4 notes say so; the rule is per-release, not permanent.)
3. Read `PORTABILITY.md` § Why the Codex lane is unguarded, and **correct anything your team believes
   about Codex-lane enforcement.** If anyone is relying on those origin-repo `.codex/hooks/*` files,
   they are relying on scripts that have never executed.

**Verify it landed — a green `init` exit is not evidence:**

Run this **in your adopted repo** (if you passed `--skip-codex-lane`, omit the first two lines **and
the `grep` line** — that `grep` reads one of the files you chose not to install):

```bash
test -f .codex/config.toml || { echo "FAIL missing .codex/config.toml"; exit 1; }
test -f .codex/agents/cold-reviewer.toml || { echo "FAIL missing cold-review seat"; exit 1; }
test -f core/GATES.md || { echo "FAIL core/ not adopted"; exit 1; }
grep -q 'CODEX_COLD_MODEL' .codex/agents/cold-reviewer.toml && echo "NOTE: cold-review seat model still unfilled"
echo "v2.0 adopt verified"
```

Each check tests existence **before** content: a `grep` against a missing file exits non-zero for the
wrong reason, which a `!`-negated check would read as clean. (`--risk-tokens` cannot be checked from
the adopted repo — `bin/init.mjs` ships only in the kit checkout. Verify it there:
`node bin/init.mjs --risk-tokens x; echo $?` must print `2`.)

## What's new in v1.7

**The three ritual skills — `/boot`, `/closeout`, `/lane-declare` — plus the word-budget gate
that governs the kit's own instruction artifacts.** The origin repo ran these rituals saturated
with its own names, paths, and deploy target; the kit ships the portable skeleton: each skill is
a checklist over doctrine the kit already carries, never a restatement of it.

- **Three new shared-body dual-lane skills** (the v1.3 mechanism, unchanged — one canonical body
  under `.agents/skills/<name>/`, a thin shim per harness, zero `init` edits):
  - **`/boot`** — the start-of-session ritual: the identity fingerprint (`git remote get-url
    origin` against the entry stub's table — never a path), the nine-doc boot set read in order,
    the other-lane dirty-file check, the task-lane declaration, and the tier recommendation
    (`core/WORKFLOW.md` § Steer) before the first write.
  - **`/closeout`** — the PROCEDURE over `core/OPERATE.md` § End-of-work closeout: inventory →
    gate-ladder check → surgical staging → worktree merge+test → the Owner's push authorization →
    push → **verify on the ref you actually pushed** → the `CLOSEOUT: ARCHIVE-READY |
    NOT ARCHIVE-READY` receipt. The doctrine stays in `core/`; where they differ, `core/` wins.
  - **`/lane-declare`** — writes `.claude/task-lane.json` for the two readers that actually
    enforce it, and says **which reader enforces what**: both block an undeclared, malformed or
    stale declaration, but **only the Claude-lane write guard binds the session** — the
    every-lane commit floor has no live session to compare against, so another thread's leftover
    declaration still passes it. Cures for `stale`, session-mismatch and `ledger-error` are
    described from the kit's own controls (a `ledger-error` here is any ledger write the guard
    refuses — a symlinked ledger, a corrupt row, or a missing trailing newline — not only a
    failed append).
- **`scripts/check-skill-budgets.mjs` — budget is now a GATE for the kit's own artifacts, not an
  honour system.** `npm test` runs it and FAILS the build on a violation, governing **four**
  classes: `skills/**` (each file declares `Word budget: N` in its head; **marker-less is RED**,
  never skipped), `skill-shims/**` (class cap 250 — and a shim *declaring* a budget fails too:
  rules worth budgeting belong in the body), `agents/*.md` (500), and `commands/**` (650). Each
  file carries its OWN number — a body and its reference layer are never summed. The unit is
  `wc -w` over the whole file, checkable by hand in one command. Honest limits, stated in the
  file head: a `skills/` number is **self-declared** (the ratchet pins *recorded* debt only, and
  the class caps are author-set, not Owner-ratified); the four roots are all it governs —
  `core/` docs are `doc:size`'s job; and the checker governs the **kit repo only**, `init` does
  not install it into adopters.
- **`npm test` is now `scripts/run-checks.mjs`, which runs both rungs and combines their exit
  codes.** Chained with `&&`, one word over budget would have stopped the control suite, the
  acceptance harness and the FM1 guard from running at all — a prose notice preempting the proof
  that the controls work. Both always run; `npm test` is red if either is.
- **The boot-order enumerations are now asserted in lockstep.** The kit enumerates the boot set
  in **seven** places — both entry-stub templates, `core/README.md`, `core/MULTI_AGENT.md`,
  `core/WORKFLOW.md`'s six-method list, `templates/BINDINGS.md.tmpl`, and the new `/boot` —
  and nothing asserted they agree, so renaming or adding a method doc could silently drift them
  apart. A suite test pins every one to a single canon, proves it detects a planted reorder and
  omission in each real source, **and** asserts every name in the canon resolves to a file on
  disk (consistency and resolvability are different properties; agreeing on a doc that no longer
  exists is not a pass).
- **`core/ARTIFACT_CLASS.md`'s budget citation is repaired, and so is its twin.** Rule 1 pointed
  at `core/REPO_INVARIANTS.md` § Instruction-artifact word budgets — a section the generated
  template does not carry, so the pointer dangled in every adopted repo. `core/README.md`'s file
  table carried the same claim and is fixed with it. Rule 1 now describes the records that
  actually exist — the artifact's own `Word budget:` line where it has one, otherwise the
  mechanical cap its class is governed by — without naming a script adopters never receive.

**A correction this release ships, and the gap it exposes.** `core/MULTI_AGENT.md` said a
declaration blocks when it is "undeclared, malformed, stale, or **session-mismatched**" — stated
about the declaration, i.e. about both controls. Execution disproves the last one for the commit
floor: `.githooks/pre-commit` requires only that `sessionId` be a present, non-empty string, and
git exposes no live session for it to compare against, so **a declaration carrying another
thread's session id passes the every-lane commit floor** (reproduced with a real commit). The
doc and the new skill now attribute session binding to the write guard alone and say plainly
what the floor does instead. **The underlying gap is pre-existing (since v1.0), is not closed
here, and is now honestly documented** — closing it needs a binding mechanism the floor does not
have (mtime, branch, or other), which is new design and an Owner decision, not a v1.7 change.

**One open Owner decision, recorded rather than silently resolved.** `/closeout` (573/550)
absorbed gate-mandated corrections its author-set budget predates. Raising a budget to fit a fold
is an Owner call, so instead of rewriting the number the overage is **booked as ratcheted debt**:
it prints on every run, it may only shrink, and it is either ratified as a higher number or the
text comes down. Silently changing `550` to `573` is the move the checker exists to make
expensive. (`/lane-declare` was booked the same way and then cut back under its budget, so its
entry was deleted — which the checker's `STALE-EXEMPTION` state would have forced anyway.)

**Upgrading — two different rules, read both.** The three skills are NEW files: a plain `init`
re-run with your original flags installs them (bodies, shims, and the Codex prompts unless
`--skip-codex-prompt`). But v1.7 also edits two `[P]` files an existing adopter ALREADY has —
`core/ARTIFACT_CLASS.md` (the citation repair) and `.agents/skills/frontier-review/INVOKE.md`
(its budget marker) — and `init` never overwrites a file it did not write this run: without
`--force` those two stay stale while `init` exits 0. So: commit first, then re-run with your
original flags **plus `--force`** (the `--force` warnings in the v1.4/v1.3 notes apply — `[G]`
files get a `.bak`, **`[P]` files do not**; your commit is the backup).

**Verify it landed — a green `init` exit is not evidence:**

```bash
for f in .agents/skills/boot/SKILL.md .agents/skills/closeout/SKILL.md \
         .agents/skills/lane-declare/SKILL.md .agents/skills/frontier-review/INVOKE.md \
         core/ARTIFACT_CLASS.md core/MULTI_AGENT.md; do
  test -f "$f" || { echo "FAIL missing: $f"; exit 1; }
done
grep -q 'Word budget' .agents/skills/frontier-review/INVOKE.md || { echo "FAIL stale INVOKE.md"; exit 1; }
grep -q 'Instruction-artifact word budgets' core/ARTIFACT_CLASS.md && { echo "FAIL stale citation"; exit 1; }
grep -q 'session-mismatched' core/MULTI_AGENT.md && { echo "FAIL stale session claim"; exit 1; }
echo "v1.7 upgrade verified"
```

Each line tests existence **before** grepping, deliberately: a bare `! grep -q X f` *succeeds*
when `f` is merely missing (grep exits 2), which is how a half-upgraded repo reads as clean —
the same trap the v1.4 verification block documents.

## What's new in v1.6.1

**Three honesty fixes to the enforcement surfaces: the controls stop misdescribing the declaration
they just read, and the audit ledger records the tier its named reader can actually see.** No
enforcement decision changes — every allow stays an allow, every block stays a block, and the
gate-ladder sensor still fails closed to T3 on an exemption. What changes is what the controls
*say*, and what the ledger *records*. Found by an adopter back-porting the v1.5.0 exempt-tier work,
then reproduced against live hooks here before any edit.

- **`hooks/guard-lane-authoring.mjs` — the block text admits both polarities.** One state,
  `exempt-tier-missing`, covers an **absent** tier and a **present-but-invalid** one (`"tier":"T9"`),
  but the text asserted only that the tier was *MISSING* — false against a file visibly carrying
  one. It now reads **MISSING OR INVALID**. A control that misdescribes its own input trains the
  reader to discount it.
- **`hooks/guard-gate-ladder.mjs` — a true cause for a tiered exemption.** The sensor deliberately
  does **not** honour an exemption's tier (honouring it would route to a *lighter* ladder exactly
  when a review seat is already down) — **that resolution is unchanged: still T3, still fail-closed.**
  But it reported the cause `no-tier` and printed *"no valid tier declaration"* about a declaration
  that carries one. A tiered, sanctioned-reason exemption now gets its own cause,
  **`exempt-tier-not-honoured`**, whose text states the tier was read and deliberately not honoured.
  An **unsanctioned** reason still falls through to the generic cause — both enforcement controls
  reject it as malformed, so calling it a valid exemption would be the same false-cause defect one
  branch over.
- **The exempt ledger row carries the tier in clear text.** In-thread rows already recorded
  `state:"in-thread:T2"`; exempt rows recorded a bare `state:"exempt"` with the tier only inside
  `declarationHash` — and the ledger's named consumer is the **Owner's spot-check**, who cannot read
  a hash. An exempt ALLOW row now carries `tier`; a tier-rejecting DENY row carries `declaredTier`
  (the value rejected), which is **also in the dedupe key** — it is the only field distinguishing a
  tier-less deny from a `T9` deny, so without it the second was silently swallowed as a repeat.
  `declarationHash` is unchanged and still covers the tier.

The same *MISSING*-only wording was live at the **commit floor** (`githooks/pre-commit`) and is fixed
there too — fixing one layer and leaving its twin lying is the failure mode this release is about.
`writeLedger` now takes **one named object** instead of a widened positional list, the mechanism that
corrupted a real audit row in the adopter repo.

Two neighbours of the same defect are fixed with it, because leaving them is the thing this release
argues against. The **generic** sensor head said *"no valid tier declaration"* — false of a retired
`lane` route or an unsanctioned reason that carries a perfectly good `tier`, and self-contradicting on
`bad-task-id`, which named its real cause in the parenthetical; it now says *no tier this sensor can
use*. And `core/MULTI_AGENT.md`, the page that tells the Owner **what a ledger row contains**, now
documents `tier` and `declaredTier` — a release note is not the row contract.

**The gate caught this fix committing its own defect three times.** The first cut of `declaredTier`
took only *string* tiers and truncated them bluntly, so `tier: 7` — present and rejected — was
recorded as though absent and then deduped away against a genuinely tier-less row, and two over-long
values collapsed onto one: the same swallow the field exists to prevent, one *type* and one *length*
over. Rejected values now carry their type (`7 (number)`) and truncation is marked and digest-backed.
Worse, the new exempt head closed with *"Declare `in-thread` with the tier"* — one sentence after
*"it does not lower the ladder"*, and that edit **is** the lowering, T3 to the exemption's own tier,
on the mode chosen when a review seat is already down. A sensor must not print the bypass of the
fail-closed it just applied; the line is gone and the reviewer-protective *"do NOT write
`.claude/task-lane.json`"* it had dropped is back.

**Known divergence, deliberately not fixed here:** the gate-ladder sensor still honours a *symlinked*
declaration that both enforcement controls reject as malformed, so on that one input it describes a
declaration the controls refuse. It is pre-existing, already listed among the quirks the hook's own
header defers to a joint changeset, and the resolution is still T3 either way — but the alignment
this release buys is **per-field, not total**, and a characterization test pins the gap so it stays
visible rather than implied-absent. Also unchanged and pre-existing: three input-shaped deny states
(`malformed-hook-input`, `malformed-hook-path`, `missing-hook-path`) write no ledger row while the
deny text says every state change is appended. Nothing proceeds unlogged; the string over-promises.

Both suites extended; every new assertion mutation-proven — **twenty-two** reverts, each turning its
test red, restored green — including one pinning the fail-closed resolution itself. Two of those
mutations initially *survived*: a first draft of the field-scoping negative control asserted "every
row satisfies X" over a ledger holding only one row shape, so it was vacuously true. It now builds a
ledger containing all four shapes before asserting.

**Upgrading — `--force` is REQUIRED here, and a plain re-run silently gives you nothing.** Every file
this release changes (`hooks/guard-lane-authoring.mjs`, `hooks/guard-gate-ladder.mjs`,
`githooks/pre-commit`) is a **`[P]`** file, and `init` never overwrites a file it did not write this
run: a plain re-run prints `exists, kept`, **exits 0, and leaves you running the exact controls that
misdescribe their input** — the ones this release exists to fix. So:

1. **Commit first**, then re-run `init` with your original flags **plus `--force`**.
2. `--force` is global — read the `--force` warning in the v1.4/v1.3 notes below: it also rewrites a
   hand-authored `core/OWNER_COMMS.md` and resets `.claude/kit.config.json`. **`[P]` files get no
   `.bak`**; the `.bak` is written only for the generated `[G]` files. Your commit is the backup.
3. Verify the fixes actually landed — a green exit is not evidence:
   `grep -c 'MISSING OR INVALID' .claude/hooks/guard-lane-authoring.mjs .githooks/pre-commit` and
   `grep -c 'exempt-tier-not-honoured' .claude/hooks/guard-gate-ladder.mjs` must all be non-zero.

Existing ledger rows are never rewritten. One wrinkle worth knowing if you upgrade mid-task: a row
already written by v1.6.0 for the same task, session and path no longer suppresses the v1.6.1 row —
`tier` is part of the dedupe key, so the first write after upgrading appends a row carrying it.

## What's new in v1.6

**The frontier consult — a review seat that judges a packet, not a repo — plus the two reviewer
agent definitions that make its limits mechanical.** The origin repo ran this seat under model-named
commands; the kit ships it de-model-named as **`/frontier-review`**, with the models behind it bound
as ROLES in your generated `core/BINDINGS.md` (adopters may alias the command to their own frontier
model's name).

- **`skills/frontier-review/` — a new shared-body dual-lane skill** (the v1.3 mechanism, unchanged:
  one canonical body → `.agents/skills/frontier-review/`, a thin shim per harness). The procedure:
  spend the changeset's **one frontier firing** on a **single distilled decision question** — by
  default the fold-check on a remediation delta. The workhorse seat builds a **sufficiency-tested
  packet** (could a reader who knows nothing else *disprove* the claim from what is here?), the
  frontier seat judges **only that packet**, and the workhorse resumes as decider
  (`core/FOUNDATIONS.md` § Principles P3: pin the decider). **`INSUFFICIENT PACKET` is a
  first-class answer** — the seat names the gap and the skill re-sends once; it never fills gaps.
- **`agents/` — a new `[P]` asset class: reviewer seat definitions, installed to
  `.claude/agents/`.** Two ship: `cold-reviewer.md` (the blind cold seat — payload-only, read
  tools, defaults `model: opus`) and `frontier-consult.md` (the consult seat, defaults
  `model: fable`). The consult seat's frontmatter holds **`tools: []`**, which the Claude harness
  documents as *no tools at all*. **What v1.6 ships and proves is the declaration, not the
  enforcement**: `init` copies agents verbatim, checks the line survived into the installed file's
  **frontmatter**, warns when it did not, and warns when the seat the skill names is missing
  entirely; both suites discriminate on all three. Whether your harness then denies the seat every
  tool is its behavior to verify, not something this kit observes — `PORTABILITY.md` § the consult
  seat is explicit about that. Like the skills, discovery is from disk — a future agent is one file
  dropped in `agents/`, no `init` edit.
- **`core/BINDINGS.md` gains the consult-role rows** (`{{FRONTIER_MODEL}}`,
  `{{CODEX_FRONTIER_MODEL}}`): the skill names roles — frontier judge · workhorse · Codex-lane
  frontier — and the generated bindings say which concrete models hold them.
- **The Codex lane is referenced generically — and is NOT packet-only.** The shipped gate runner
  (needs `init --with-gate-runners` + the `codex` CLI — see `PORTABILITY.md`) hands its seat the
  repository and requires a GO/NO-GO verdict, so neither the tool restriction nor `INSUFFICIENT
  PACKET` carries across; there it is a cross-family gate on the same question. The skill says so
  at the point of use. The origin repo's Codex agent config (`.codex/agents/*.toml`) is **not** in
  this release — it ships with the Codex-lane enforcement work reserved for v2.0.
  **↑ Superseded: v2.0 shipped the agent config but NOT Codex-lane enforcement — the two were
  separated once the enforcement was measured. See "What's new in v2.0". Do not read this sentence
  as a claim that v2.0 guards the Codex lane; it does not.**

**v1.6 adds no `core/` method doc changes** — the skill and agents cite the existing doctrine
(`core/REVIEW.md` payload contract and pass-types, `core/GATES.md` § Model · effort matrix,
`core/WORKFLOW.md` § Gate). **One rule here is genuinely new and lives only in the skill body**: the
one-firing-per-changeset budget. It is not in `core/`, and **nothing counts it** — round count is a
conversation fact, so the cap binds the agent that reads it and nothing else. The skill says so
where it states the cap, rather than implying a hook enforces it.

Upgrading: re-run `init` with your original flags (no `--force` needed — the new files simply
install); then fill the two new placeholders in `core/BINDINGS.md`.

## What's new in v1.5.1

**Two executed-verified fixes to the Owner-comms Stop sensor (`hooks/guard-owner-comms.mjs`), both
exposed by a real adopter's back-port evidence.** Both move the sensor toward allowing or warning.
The one behavioral widening — the reserved `TOKEN`-definition shape now harvests from mid-prose,
glosses included — is documented in the template and pinned by test (see the second bullet).

- **An inline `<system-reminder>…</system-reminder>` pair in the Owner's own sentence is no longer
  stripped.** The closed-tag strip rule is now line-start anchored, like the unclosed rule always
  was (the kit's own principle: an injected block begins its own line). Unanchored, it erased the
  Owner's words from around a mid-sentence pair — shrinking a long question below the short-question
  ceiling and **falsely blocking** a correct answer. Genuine own-line injected blocks (leading,
  trailing, indented) are stripped exactly as before, and the strip iterates to a fixpoint so
  several blocks glued onto one line all strip. Two boundaries are documented and pinned by test,
  both failing open: a block glued directly onto the Owner's own text with no separator reads as
  Owner text (the own-line principle), and a *nested* block of the same tag still defeats the lazy
  matcher, so the size check skips (the harness has never been observed to emit either shape; the
  nested case carries a labeled "DEFERRED — delete when fixed" characterization test).
- **The question-shorthand harvest no longer requires one row per line — and an empty harvest warns
  instead of silently disarming.** The line-anchored harvest read ZERO tokens from a doc whose
  `` `TOKEN` = gloss `` definitions sit inline in prose (a real adopter format), so question
  coverage was off with no sign anywhere. The harvest is now unanchored (a gloss runs to the next
  definition or a blank line); the template's fenced format examples are still never mistaken for
  the Owner's vocabulary, and its prose format mention is stripped too. When a named-Owner doc
  carries definition-shaped rows but NONE parse outside the fence — including a row written with
  double backticks, which a human reads as a definition but the parser cannot — the hook emits a
  **non-blocking stderr warning**: the kit has no fallback vocabulary to fail toward, so it says it
  is uncovered rather than pretending otherwise. A doc with no shorthand section at all stays
  silent (that is a legitimate state), as does an all-instruction vocabulary. One shape is reserved
  doc-wide and now documented in the template: a backticked ALL-CAPS token followed by `=` harvests
  wherever it appears — mid-prose (as it already did at a line start) and even inside another
  token's gloss, where it ends that gloss and starts the next definition. Keep the shape out of
  unrelated prose and out of glosses; the template says so, and both behaviors are pinned by
  labeled residual tests.

No control tightens; no adopter action required. Re-run `init --force` (see the v1.3 `--force`
notes) or hand-copy `hooks/guard-owner-comms.mjs` into `.claude/hooks/` to pick up the fixed sensor.

## What's new in v1.5

**The cost-inversion lane's retirement is now mechanical, not just doctrinal.** v1.4 retired the lane
in the METHOD (deleted `core/LANES.md`) while both enforcement controls still *accepted* a
`mode:"lane"` declaration — a documented doc/machinery inconsistency. v1.5 completes the retirement
in the machinery itself:

- **Both controls now REFUSE the route with an explicit named state.** A `mode:"lane"` declaration is
  blocked at write time (`guard-lane-authoring.mjs`) and at commit time (`.githooks/pre-commit`) with
  a `lane-retired` state and a remediation that says WHY — the route is RETIRED, not that your JSON
  is wrong — and points at the two live routes (`in-thread` with the tier · `exempt` with a ledgered
  reason). The refusal is ledgered like every other gated decision.
- **The dead lane-eligibility machinery is removed.** The risk-token deny-set (`laneRiskTokens` and
  the built-in token defaults) had exactly one consumer — lane-eligibility screening — so it is gone
  from both hooks. The fail-closed posture is UNCHANGED: a structurally corrupt
  `.claude/kit.config.json` (bad JSON, not an object, symlinked, unreadable) still blocks a code
  write *and* a code commit, and a malformed `executedPathDirs` still blocks the write guard.
- **`init --risk-tokens` is DEPRECATED, not removed** (flag removal is a breaking CLI change reserved
  for v2.0): still parsed so a saved init invocation keeps working, warns loudly that it configures
  nothing, and no longer writes `laneRiskTokens`. Every control **tolerates** a legacy
  `laneRiskTokens` key in an older adopter's config — ignored, never fatal.
  **↑ Superseded at v2.0: the flag is now REMOVED and exits 2. See "What's new in v2.0". The legacy
  `laneRiskTokens` KEY is still tolerated — only the flag went away.**
- **`exempt` now declares a tier — the one behavior change to a LIVE route.** It was the only route
  carrying no tier, which meant a reason set entirely about review-seat availability (`codex-down` /
  `codex-quota` / `trivial-edit`) silently selected the mode that skipped tier declaration. Which seat
  is unavailable says nothing about how risky the work is. Both controls now require
  `"tier":"T0".."T3"` on `exempt` exactly as on `in-thread`, and a pre-v1.5 tier-less exemption is
  **not grandfathered**: it blocks with an explicit `exempt-tier-missing` state naming the field to
  add. `in-thread` is unchanged.
- **The refusal is observed both ways at both layers.** The acceptance suite blocks a `mode:"lane"`
  declaration at write *and* commit time with the retirement string asserted, and permits the same
  write/commit under a documented route — likewise for the tier-less exemption.

### Upgrading an existing adopter to v1.5

Re-run `init` with your original flags plus `--force` (read the `--force` warning in the v1.3 notes
first — commit before you run it; `[G]` files get a `.bak`, `[P]` files do not). Then:

- **If you use `exempt`, add a tier to it.** This is the one change that can block work you were
  doing before: a tier-less exemption now fails closed at both the write guard and the commit floor.
  The block names the missing field.
- Dropping `--risk-tokens` from your saved invocation is optional — it now just warns. A stale
  `laneRiskTokens` entry in your `kit.config.json` is harmless: every control ignores it.
  (**At v2.0 dropping it is no longer optional** — the flag exits 2. The stale key stays harmless.)
- If anything was still using the `lane` route (v1.4 already said not to), re-declare it `in-thread`
  with the tier.

## What's new in v1.4

**The method set was re-cut from 3 files into 6, and the cost-inversion lane was retired.** No rule
changed in the split: the same doctrine, at the same total size, divided at concept seams instead of
at the point where one file once got too long to read. The three new docs are `FOUNDATIONS.md`
(the principles and roles every other doc uses without redefining them — so it is read first),
`ARTIFACT_CLASS.md` (how a finding is weighed and tiered depending on whether the artifact is run by
a machine or by an LLM), and `MULTI_AGENT.md` (everything about working alongside other agents:
delegation, shared-checkout staging, the task-lane declaration, onboarding a new model).

- **Why split at all.** Each of the three originals had grown to carry two unrelated jobs, and the
  terms the whole method leans on — the principles, the roles — were defined two thirds of the way
  into the first file, after several rules had already used them. The new boot order fixes that:
  `FOUNDATIONS` → `WORKFLOW` → `REVIEW` → `ARTIFACT_CLASS` → `OPERATE` → `MULTI_AGENT` → `BINDINGS`
  → `SYSTEM_MAP` → `OWNER_COMMS`. **No RULE was reworded or relaxed** — verified by byte-diffing each
  relocated section against v1.3. Two deliberate exceptions, both listed in `core/README.md`
  § Provenance rather than folded into the "nothing changed" claim: the retired lane's section was
  rewritten rather than moved, and the onboarding read order gained `OWNER_COMMS.md`.
- **`core/LANES.md` is retired**, by Owner ruling, and the file is gone. The lane let a cheaper model
  author spec-able T0/T1 work from a falsifiable ticket. **Retired by Owner ruling on pilot evidence
  measured in the repo this method was extracted from — that data does not travel with the kit, so
  this is a decision of record, not a claim the kit can substantiate for you.** The reported basis
  was cost: the cheaper builder did not save enough to pay for the review rounds a thinner build
  buys. Note the lane's own kill-criterion keyed on *bounce grade*, not on cost, so this was a
  judgement against the lane's purpose rather than that criterion firing.
  What went with it, and what survived generally, is recorded in `core/README.md` § Provenance.
- **Authoring is in-thread.** The task-lane declaration itself is unchanged and still fails closed —
  it now lives in `core/MULTI_AGENT.md` § Task-lane declaration.
- **`core/OWNER_COMMS.md` joins the boot set.** v1.3 shipped the doc but never added it to the entry
  stubs' read-this-first list, so an agent only met it by accident. It is now step 9.

### Upgrading an existing adopter to v1.4

**This is the first release that RESTRUCTURES `core/`, so a plain re-run is NOT enough — it leaves you
silently broken.** `init` never overwrites a file it did not write this run. That is the right default
for an additive release and the wrong one here: a plain re-run installs the three new docs and *keeps*
your v1.3 copies of the five that were slimmed. Measured on a real two-version adopt, you get
`core/OPERATE.md` and `core/MULTI_AGENT.md` both carrying the multi-writer section and both calling
themselves "the authoritative text", three new BINDING docs that no boot set points at, and a live
`core/BINDINGS.md` pointer to a `core/LANES.md` that should be gone. **Nothing errors** — `doc:size`
still exits 0. The agent just reads contradictory doctrine, which is exactly the fail-invisibly mode
`core/README.md` warns about.

Do this instead:

1. **Re-run `init` with your original flags PLUS `--force`.** This is what actually replaces the eight
   `[P]` method docs and regenerates the `[G]` files, which is what moves your entry stubs and
   `core/BINDINGS.md` onto the new nine-step boot order. Read the `--force` warning in the v1.3 notes
   below first: it is global, so it also rewrites a hand-authored `core/OWNER_COMMS.md` and resets
   `.claude/kit.config.json`. **Commit before you run it.** `init` writes a `.bak` and prints the path
   only for the seven **generated `[G]`** files (the two entry stubs, four `core/*.md`, and
   `.claude/kit.config.json`), and only when the content actually differs; the **portable `[P]`** files — every `core/*.md`, the
   hooks, `pre-commit`, `scripts/` — are overwritten with **no backup**, so local edits to those are
   recoverable only from git. Re-apply your own content from the `.bak` files afterwards.
2. **Delete `core/LANES.md` by hand.** `--force` does *not* remove it; `init` only ever writes files,
   it never deletes them. This is the one step no flag does for you.
3. **Repoint your own local text** — a runbook, custom `CLAUDE.md` additions — from `core/OPERATE.md`
   § Multi-writer checkout / § Delegation to `core/MULTI_AGENT.md`.

**Verify the upgrade landed** (all three must hold):

```bash
for f in core/FOUNDATIONS.md core/ARTIFACT_CLASS.md core/MULTI_AGENT.md \
         core/WORKFLOW.md core/REVIEW.md core/OPERATE.md \
         core/SYSTEM_MAP.md core/OWNER_COMMS.md CLAUDE.md AGENTS.md core/BINDINGS.md; do
  test -f "$f" || { echo "FAIL missing: $f"; exit 1; }
done
test -e core/LANES.md && { echo "FAIL still present: core/LANES.md"; exit 1; }
for f in CLAUDE.md AGENTS.md core/BINDINGS.md; do
  grep -q "core/LANES.md" "$f" && { echo "FAIL stale pointer in: $f"; exit 1; }
done
grep -q "^## Multi-writer checkout" core/OPERATE.md  && { echo "FAIL stale v1.3 doc: core/OPERATE.md"; exit 1; }
grep -q "^## Principles"            core/WORKFLOW.md && { echo "FAIL stale v1.3 doc: core/WORKFLOW.md"; exit 1; }
grep -q "^## Artifact-class review physics — code" core/REVIEW.md && { echo "FAIL stale v1.3 doc: core/REVIEW.md"; exit 1; }
echo "v1.4 upgrade verified"
```

Three things about that block are deliberate, and each closes a way it previously reported green on a
broken repo:

- **It tests existence before grepping.** A bare `! grep ... a b c` *succeeds* when a file is merely
  **missing** (grep exits 2, and `!` turns that into a pass), so a half-upgraded repo read as clean.
- **It greps for stale pointers only in the three files that ROUTE an agent.** `core/README.md` still
  mentions `LANES.md` on purpose, in the retirement record, and that mention is correct.
- **The last three lines are a CONTENT probe, and they are the only thing that can catch the most
  likely failure** — the five slimmed `[P]` docs not actually being replaced. Every `[P]` doc declares
  `Kit v1.0` at **both** v1.3 and v1.4 by design (`core/README.md` § Versioning: a version says
  *current until superseded*), so nothing can tell the two apart by reading a version marker. Those
  three headings exist in v1.3 and are gone in v1.4, which makes them the available discriminator.

## What's new in v1.3

**Owner communication — the method finally says how to talk to the human it reports to.** Every other
doc in this kit tells an agent how to *build*; none told it how to *report*. A technically sharp Owner
who does not write code was getting five hundred words of inventory in answer to a three-word
question. v1.3 adds the missing half: a generated contract, a skill that repairs a message against it,
and a sensor that notices the most common miss.

- **`core/OWNER_COMMS.md`** — seven rules (v2.1.1 adds an eighth) for writing to a decision-maker
  rather than a fellow engineer: answer first in one sentence · define every term on first use ·
  give the background · say
  why it matters to *them* · a decision means the choice, each option's cost, and a recommendation ·
  plain language · and `/humanize` to repair a message that missed. It is **`[G]` (generated per
  repo, never copied)** — it names a person, and copying one repo's Owner into another re-creates the
  cross-repo confusion the identity fingerprint exists to prevent. `init --owner-name <name>` fills
  the name; the profile, the irreversible asset, and the Owner's shorthand are judgment calls `init`
  lists in its checklist for you to complete.
- **`/humanize` and `/humanize-bullet`** — the Owner types one when a message did not land, and the
  agent rewrites its own last message against those rules (bullet mode also restructures it). Same
  conclusion, same asks, no new facts, and never cutting a risk or a blocker.
- **The shared-body dual-lane skill mechanism** — the `/thread-restart` dual-harness pattern taken one
  step further. Instead of two copies of a method kept in lockstep, there is now **one body**:
  `init` installs the canonical skill to `.agents/skills/<name>/`, then writes a thin shim per harness
  that does nothing but point at it — `.claude/skills/<name>/SKILL.md` for Claude, `<name>.md` in your
  Codex prompts dir for Codex (same `--codex-prompts-dir` / `--skip-codex-prompt` flags). Both sides
  are discovered from disk, so a future skill is two files dropped in, not an `init` edit; and `init`
  verifies at adopt time that every shim's body reference actually resolves, rather than shipping a
  menu entry that dead-ends.
- **`.claude/hooks/guard-owner-comms.mjs` — a Stop-event SENSOR that FAILS OPEN.** It reads the final
  message of a turn and flags two things: narrating the work instead of reporting the result, and
  answering a short question at length. **It is not enforcement and must never be described as such.**
  A Stop hook fires *after* the message is already sent, so blocking cannot retract it — it can only
  prompt a corrected follow-up, which is the "give me the short version" round-trip an Owner was
  making by hand. Every parse error, missing field, or unreadable file ALLOWS, so a clean run proves
  nothing. It stays **dormant** until `{{OWNER_NAME}}` is filled, and reads the Owner's own question
  shorthand out of the generated doc rather than hardcoding anyone's.

**v1.3 adds no `core/` method doc changes.** The existing method docs are untouched; `core/OWNER_COMMS.md`
is new and generated, and (like every `core/*.md`) is automatically governed by `doc:size` at the
20 KiB BINDING-method cap.

### Upgrading an existing adopter to v1.3

Re-run `init` against your repo with the same flags you originally used, plus `--owner-name`. Existing
files are **kept**, so the new pieces (the Stop hook file, the skills, `core/OWNER_COMMS.md`) install
while everything you already have is left alone — and `init` now lists the specific placeholders still
unfilled **on every run**, reading them from the files on disk rather than only from what that run
wrote.

The one thing to know: **`--force` is global.** It is also the remedy `init` recommends for a stale
hook, and it regenerates *every* `[G]` file — including a `core/OWNER_COMMS.md` you hand-wrote and a
`.claude/kit.config.json` whose families you configured (regenerating that with no family flags resets
it to `{}`, which *widens* your write guard). Since v1.3, `init` writes a `.bak` beside any such file
before overwriting it and says so on the console, so the upgrade path is recoverable rather than
silently destructive. Prefer a re-run without `--force` unless you actually want the kit's versions
back.

## What's new in v1.2.1

**`init --with-gate-runners` now gitignores `.gemini-gate/`.** The v1.2 Gemini-gate doctrine treats the
one sanctioned in-repo gate-artifact prefix as gitignored (the common-case layer that keeps
`cold-review-gemini.sh`'s `git add -A` freeze from ever staging it; the freeze-index `rm` + the
validator's exact-path exclusion remain the defense-in-depth net). Adopting an existing repo missed the
ignore entry — `init` only managed the per-session lane files. Now, when gate runners are installed, the
adopter's `.gitignore` gets `.gemini-gate/` too (idempotent; runners-only, so a no-gate adopt is
unchanged). Re-run `node bin/init.mjs --with-gate-runners` on an already-adopted repo to add just the
entry — the already-present runner scripts and `core/` docs are kept untouched.

## What's new in v1.2

**Gemini-gate runner hardening — post-extraction refinements that ran in anger downstream, now folded
back into the source of truth.** Three files change: `scripts/gemini-gate-slices.mjs`,
`scripts/cold-review-gemini.sh`, and the matching doctrine in `core/GATES.md`.

- **Gate artifacts must resolve OUTSIDE the repository** (or under the one canonical, gitignored
  `.gemini-gate/` prefix). `fingerprint`'s `--out-dir` is now optional and defaults to a fresh
  system-temp dir; an in-repo `--out-dir` is rejected *before* any evidence is written. This is
  load-bearing: an in-repo out-dir writes untracked files that `freeze_artifact`'s `git add -A` would
  otherwise bake into the review snapshot as a **false changed surface**. The refusal is symlink-safe
  (canonicalizes the longest existing ancestor) and treats the repo root itself as inside.
- **The validator excludes by RECOGNIZED EXACT PATH** — the durable log, the manifest, and the canonical
  `.gemini-gate/` dir — **never** by "is this file untracked". An untracked-ness test would fail *open*:
  an unknown untracked sibling (stray debug file, secrets, editor temp) would silently drop from the
  reviewed surface. Now it stays in scope, fails closed, and is journaled to the durable log as a
  non-verdict `SCOPE_MISMATCH_DIAGNOSTIC`.
- **`cold-review-gemini.sh` refuses a repo-internal `$TMPDIR`** before the freeze and drops a real
  physical `.gemini-gate/` directory (guarded `-d && ! -L`, so a bare file or symlink of that name stays
  in scope and fails closed) from the freeze index — defense-in-depth matching the validator's exclusion.

**v1.2 refines one core doc.** Unlike v1.1, this release touches `core/GATES.md` (the fingerprint/validator
doctrine above). The other `core/` method docs remain unchanged from v1.0.

## What's new in v1.1

**`/thread-restart` — a dual-harness command asset.** A "smart thread compaction + fresh restart":
distil the current agent thread into a durable, **verified** digest, then continue in a fresh context
window that loses nothing essential. It embodies the kit's efficiency principle — a durable handoff plus
a fresh, task-bounded session — and is a productivity **nudge, not a control** (it ships no enforcement,
so it carries no fail-closed behavior; `init`'s *wiring* is what the acceptance suite gates, not the
command's advice).

`init` installs it into **both** harnesses: the Claude command → `.claude/commands/thread-restart.md`,
the Codex prompt → your Codex prompts dir (`~/.codex/prompts/` by default; `--codex-prompts-dir` to
override, `--skip-codex-prompt` to opt out), plus a short fallback pointer appended to `AGENTS.md` so a
Codex / non-Claude lane finds the procedure even where custom slash-commands are unsupported.

**The dual-harness pattern — this is its reference implementation: the *method* is portable, the
*plumbing* is dual-shipped.** The load-bearing part — index-don't-duplicate · a mandatory
VERIFY-before-finalize pass · drop-operational-noise — is the **same method** in both, lightly adapted
per harness in wording (memory nouns like *in-thread* vs *in-conversation*, the example identifier sets,
a Claude-only fresh-session spawn offer, and the restart verb `/clear` vs `/new`); `init` installs each
asset **verbatim** — `copyFileSync`, no per-repo rewrite. A third harness is a new wrapper over the same
method, never a re-derivation. See `PORTABILITY.md`.

**Honest limit.** The agent produces the digest and the one-line restart seed; the **user** performs the
`/clear` (Claude) or `/new` (Codex). No agent resets its own context — the command never claims it did.

**v1.1 is additive.** The `core/` method docs are unchanged from v1.0 and remain marked `v1.0` — the
method is stable; v1.1 adds only the `/thread-restart` asset and its `init` wiring.

## What you get

**The method** (`core/`, portable — copies verbatim, versioned `v1.0`):
- `FOUNDATIONS.md` — the principles (P1–P3) and roles every other doc presupposes. Read first.
- `WORKFLOW.md` — Steer (tier classification) + the Gate ladder + PM dispositions.
- `REVIEW.md` — how a review is constructed and judged (cold payload, decorrelation, cross-family lens).
- `ARTIFACT_CLASS.md` — how findings are weighed and tiered for CODE vs INSTRUCTION artifacts.
- `OPERATE.md` — execution protocol, invariants, closeout, working norms.
- `MULTI_AGENT.md` — delegation, multi-writer staging, the task-lane declaration, onboarding.
- `INVARIANTS.md` — the epistemic rules + failure classes shipped to every reviewer (machine payload).
- `GATES.md` — the Codex / Gemini gate tool manuals (reference).
- `README.md` — the layer model + staged read.

**The controls** (installed into your repo by `init`):
- `.claude/hooks/guard-cross-repo-writes.mjs` — blocks Write/Edit outside the repo *(Claude lane)*.
- `.claude/hooks/guard-lane-authoring.mjs` — blocks an undeclared code write *(Claude lane)*.
- `.claude/hooks/guard-gate-ladder.mjs` — surfaces the tier's owed ladder on a gate command *(Claude lane, sensor)*.
- `.githooks/pre-commit` — blocks an undeclared code **commit** *(**every** lane — see PORTABILITY.md)*.
- `scripts/check-doc-size.mjs` — caps the BINDING method docs by role; fail-closed on a bad config.

**The one sensor** (installed alongside the controls, but categorically different — read the distinction):
- `.claude/hooks/guard-owner-comms.mjs` — a **Stop**-event nudge toward `core/OWNER_COMMS.md` rule 1.
  It **fails OPEN**, fires only *after* the message is already sent, and is dormant until you name your
  Owner. **It enforces nothing.** A clean run proves nothing about a message *(Claude lane, sensor)*.

**The generators** (`templates/`, `[G]` — `init` fills them per repo, never copies verbatim):
root `CLAUDE.md` / `AGENTS.md` entry stubs, `core/BINDINGS.md`, `core/REPO_INVARIANTS.md`,
`core/SYSTEM_MAP.md`, `core/OWNER_COMMS.md`, and `.claude/kit.config.json` (your repo-specific families).

**The commands** (`commands/`, `[P]` dual-harness assets — `init` installs them into an adopting repo):
- `commands/claude/thread-restart.md` — the `/thread-restart` Claude command → `.claude/commands/`.
- `commands/codex/thread-restart.md` — the same procedure as a Codex prompt → your Codex prompts dir.
- `commands/agents-pointer.md` — the `AGENTS.md` fallback pointer (appended idempotently).

**The skills** (`skills/` + `skill-shims/`, `[P]` — one shared body, a thin shim per harness):
- `skills/humanize/SKILL.md` + `BULLET.md` — the canonical `/humanize` procedure → `.agents/skills/humanize/`.
- `skills/frontier-review/SKILL.md` — the canonical `/frontier-review` consult procedure →
  `.agents/skills/frontier-review/`.
- `skills/boot/` · `skills/closeout/` · `skills/lane-declare/` — the ritual skills (v1.7) →
  `.agents/skills/<name>/`.
- `skill-shims/claude/*.md` → `.claude/skills/<name>/SKILL.md`; `skill-shims/codex/*.md` → your Codex
  prompts dir. `humanize-bullet` ships in both lanes as an **alias** shim with no body of its own.
- `scripts/check-skill-budgets.mjs` — the KIT repo's own word-budget gate over `skills/`,
  `skill-shims/`, `agents/` and `commands/` (the first rung of the kit's `npm test`; **not**
  installed by `init` — see `PORTABILITY.md`).

**The agents** (`agents/`, `[P]` — reviewer seat definitions → `.claude/agents/`, Claude lane only):
- `agents/cold-reviewer.md` — the blind cold seat (payload-only mandate; `tools: Read, Grep, Glob`).
- `agents/frontier-consult.md` — the consult seat; its `tools: []` is the harness-enforced
  packet-only cage the `/frontier-review` skill relies on. Never remove that line.

## Adopt in three steps

```
git clone <this kit> /path/to/workflow-kit
cd /path/to/your-repo
node /path/to/workflow-kit/bin/init.mjs \
  --repo-name your-repo --remote-url git@github.com:you/your-repo.git \
  --owner-name "Your Name" \
  --source-dirs src,lib
```

`init` copies the `[P]` files in, generates the `[G]` files from templates, installs the shared skill
bodies and their per-harness shims, **merges** the five PreToolUse registrations (three fail-closed
guards + two never-denying sensors) *and* the Stop-event
sensor into `.claude/settings.json`, installs the `pre-commit` hook and sets `core.hooksPath=.githooks`,
writes `.claude/kit.config.json` from your flags, and prints a checklist. Then: complete the
`{{PLACEHOLDER}}`s in the generated `[G]` files, and wire `doc:size` + `test:kit-controls` into your CI
(`node bin/init.mjs --print-package-scripts`). `node bin/init.mjs --help` lists every flag.

## The one thing you must not miss

**Enforcement is still asymmetric, and v2.1 narrowed the gap without closing it.** The PreToolUse
guards now register in the Codex lane too — but they are **INERT there until a human grants Codex
hook trust in an interactive session**, and an untrusted hook is skipped **silently**. They also bind
write *tools* only: a write issued through a plain shell command is invisible to them, and in the
Codex lane that is a main road. A human with an editor loads nothing at all. What binds *every* lane
is the prose in `AGENTS.md` + the `pre-commit` hook. **Read `PORTABILITY.md`, and run
`node scripts/check-codex-hooks-armed.mjs`, before you tell your team the guards protect them.**

## Parameterization is fail-closed by design

`init` never rewrites hook *source* from your inputs — the mechanism copies verbatim and only *data*
(`.claude/kit.config.json`) is per-repo. Each control **fails CLOSED** on a config it cannot read
(symlinked, permission-denied, or malformed JSON) or that is malformed in a field **that control
uses** — a mis-parameterized `executedPathDirs` blocks the write guard, it never silently permits.
(A field a control does not use cannot make *that* control fail open — which is also why a legacy
`laneRiskTokens` key from a pre-v1.5 adopt is ignored, never fatal; and even with no config at all,
the `pre-commit` floor gates every non-docs path, so an *undeclared code commit* is blocked
regardless.)

**Coverage: a tripwire and a floor.** The Claude `guard-lane-authoring` write-time gate is a *tripwire*
— it catches undeclared writes to known code extensions and to your configured/default source dirs, but
it is not exhaustive (an unusual extension outside a source dir may slip it). The harness-agnostic
`pre-commit` hook is the *floor*: it treats **every** non-docs path as code, so an undeclared
code **commit** is blocked for every lane. Rely on the commit floor for completeness; the write-time
guards are early, best-effort convenience. **What no control checks is task SCOPE** — since v1.5.0
the per-file allowlist retired with the `lane` route, so "only the files my task touches" is a
method rule (`core/MULTI_AGENT.md` § Multi-writer checkout), not a mechanical one.

Proven by `acceptance/plant-the-bug.sh` and the `tests/` suite, each of which observes every control
**both** blocking and permitting — a control only ever seen green is a control never observed working.

## License
`init`-generated files are yours. The kit files carry no license header; pick a license for your fork
(the `package.json` field is `UNLICENSED` as a deliberate placeholder).
