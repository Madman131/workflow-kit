# v2.34.0 design contract — C-DOC: action flags, skill headroom, two restored/clarified clauses, brief template

**Status:** PRE-CODE design contract (CHIP C-DOC of the post-v2.33 kit program). Tier **T2** (gate
machinery prose), entry `class-2,3,4`. Base `origin/main` `e764f38ac6f795b5e2db6323554ed982b1c647ec`
(VERSION 2.33.1). Version rule: bump the MINOR from the real `origin/main` head at freeze (expected
2.33.1 → 2.34.0). Every line number below was opened at `e764f38`; re-verify at build.

Every claim here is a hypothesis for review to falsify. The proposed wording in § 3 is a draft for
review and for the Owner's wording sign-off (D-02); it is not yet approved text.

---

## 1 · Scope, and what is out

**In scope (four items):**
1. **T3 → action flags (D-03).** New work stays T0/T1/T2. Three flags — irreversible · money/ledger ·
   auth/credential — each ADD a required cross-family lens, the frontier · xhigh gate, and a named
   Owner GO per write.
2. **Skill headroom to about 85%** for `skills/orchestrate/SKILL.md` (1400/1400),
   `skills/architect-build/SKILL.md` (549/550) and `skills/architect-build/ROUTING.md` (899/900), by
   cutting duplicates only; plus **restore** the PROTOCOLS pointer on the stale-worktrees duty.
3. **`core/WORKFLOW.md:100`** — say that a v3 (or T3) lineage keeps minting v3.
4. **`skills/orchestrate/CHIP_BRIEF.md` § 5** — Builder model/effort named; seats at or above the
   Builder; review logs never committed into the changeset under review; a subagent Builder cannot
   receive an Owner GO, so the PM pushes on a relayed GO.

Plus the release mechanics every release owes: VERSION + `package.json` to the new MINOR, and a
README v2.34.0 note naming the adopter-visible changes and the files an adopter's port must copy.

**Out of scope:** everything in brief § 4 (C-CODE); CHIP B's pure NOTEs (S2-2, S2-3, N2, N3, N4) except
where a line is already being edited; any code under `hooks/`, `scripts/`, `bin/` (see decision **Q4**
on the gate-ladder hook's printed T2 ladder); ledger migration; `core/GATES.md` split; wording-pin
pruning; any adopter.

**Tier purity (RUNG_ZERO § 0.2).** All four items are prose. Item 1 changes a gate trigger (T2, gate
machinery, owes the adversarial walk-through). Items 2–4 are T2-adjacent: item 2 edits controlling
skills (unsure-whether-semantic ⇒ T2), item 3 is a controller-contract sentence, item 4 is a brief
template. One T2 changeset; no code, so **no external gate** (`core/WORKFLOW.md` § Steer, prose cap).

---

## 2 · Invariants the build must hold

- **I1** — No file under `hooks/`, `scripts/`, `bin/`, `templates/` changes. (Tests change.)
- **I2** — `core/` net word count ≤ 0 across the changeset (brief § 3 item 1).
- **I3** — `core/WORKFLOW.md` stays ≤ 25,600 bytes (the `method` role cap in
  `scripts/check-doc-size.mjs` `ROLE_CAPS`; it is **25,599 today, one byte of headroom**). An
  adopter's `doc:size` rung would go red on any net growth. `core/REVIEW.md` (23,523) stays under the
  same cap.
- **I4** — No binding rule is deleted. Every cut sentence is a duplicate; § 4 names where each still
  lives. The kill-pass re-runs the FM-25 test on every cut before freeze: *would an agent following the
  file behave differently without this sentence, given the named home is loaded?*
- **I5** — No skill budget number is raised. `RUNG_ZERO.md` (2910/2925) and `CHIP_BRIEF.md`
  (992/1000) end at or below today's count. `PROTOCOLS.md` (2399/2400) is not edited.
- **I6** — Historical T3 keeps its original depth and obligations; nothing here reclassifies a
  historical lineage.
- **I7** — Suite green; test-name set changes only by the named additions (and named pin edits in
  § 5). Tests that run `init` pass `--skip-codex-lane --codex-prompts-dir <tmp>` (FM-41).
- **I8** — The Gemini review log never enters this branch (D-13): after each Gemini run the appended
  entry is copied to the Builder's scratch and `docs/journal/gemini_review_log.md` is restored with
  `git checkout --`.

---

## 3 · Items

### Item 1 — T3 → action flags

**Harm today (who reads it, what wrong action follows).** A Builder or PM classifying new work that
moves money, changes credentials, or makes an irreversible write reads:
- `core/WORKFLOW.md:30` — *"New T3-class work gets the full normal T2 panel, **not the former third
  angle or required extra lens**"*;
- `core/WORKFLOW.md:36` — T2 row, *"cross-family lens **[if avail]**"*;
- `core/REVIEW.md:59` — *"At T2 it is **skipped cleanly when unavailable**"*.

So the most catastrophic class can ship with its cross-family lens skipped whenever the other family
is down or out of quota — reviewed by one family only, with every rung "passed". That contradicts
D-03 (flags add a **required** cross-family lens). Second harm: the obligations are scattered across
five sentences with three different lists (`WORKFLOW.md:21` names irreversible only; `:24` names all
three; `REVIEW.md:15` names "controlling-document restructure or irreversible action"; `RUNG_ZERO.md:75-76`
splits them again), so a reader of one surface gets a different set of obligations than a reader of
another.

**Mechanism.** One canonical definition in `core/WORKFLOW.md` § Steer; every other surface points to
it or names the flag, and the T2 row and REVIEW's lens clause say REQUIRED under a flag.

**Draft wording (for review and Owner sign-off):**

`core/WORKFLOW.md` § Steer
- `:21` *"No handle ⇒ **irreversible**: new review stays T2; per-write Owner GO, frontier gate and
  execution safeguards remain."* → *"No handle ⇒ **irreversible** (an action flag, below)."*
- `:24` drop the second sentence (*"Irreversible, money/ledger and auth/credential effects also
  trigger frontier and exact Owner decisions."*) — replaced by the definition below.
- New paragraph after the decision tree (after `:28`):
  > **Action flags**, from concrete effects, never labels: **irreversible** · **money/ledger** ·
  > **auth/credential**. A flagged change is at least T2; each flag ADDS a **REQUIRED cross-family
  > lens** (same-family-only never discharges it), the **frontier · xhigh** gate (`core/GATES.md`
  > matrix) and a **named Owner GO per write**.
- `:30` *"New T3-class work gets the full normal T2 panel, not the former third angle or required
  extra lens; T2 rungs, frontier/xhigh action gates and Owner GO remain."* → *"New work is never T3:
  it is T2 plus its action flags."* (the pinned *"RULE #1 cuts REPAIRS, never review DEPTH"* clause and
  *"Historical T3 retains its original depth"* are untouched).
- `:36` T2 row *"cross-family lens [if avail]"* → *"cross-family lens [if avail; REQUIRED if flagged]"*.
- `:66` *"the **cross-family lens stays REQUIRED at T3** — the T3 row bundles both seats in one cell, so
  reading the cap across it would drop one that is not capped."* → *"the **cross-family lens stays
  REQUIRED under an action flag or at historical T3**."* (the cited "T3 row" no longer exists in the
  table — a stale reference fixed in passing on a line already edited).

`core/REVIEW.md`
- `:13-16` → *"For **new work**, T0/T1/T2 are the available tiers. Every T3 roster and count below
  applies only to an independently proven accepted historical T3 lineage through closure. The required
  cross-family lens applies there and under an **action flag** (`core/WORKFLOW.md` § Steer), which also
  adds the frontier · xhigh gate and per-write Owner GO. A new controlling-document restructure
  receives the full normal T2 panel."*
- `:59` *"**At T2 it is skipped cleanly when unavailable; at T3 it is REQUIRED** (…), so an unavailable
  lens at T3 takes the substitution rule below, and if no different family can be seated, the recorded
  availability route governs; outside it the artifact is **not gradable at T3** → Owner, and a reduced
  verdict is never full."* → *"**At unflagged T2 it is skipped cleanly when unavailable; under an action
  flag or at historical T3 it is REQUIRED** (`core/WORKFLOW.md` § Steer), so an unavailable required lens
  takes the substitution rule below. At T3, if no different family can be seated, the recorded
  availability route governs; outside it the artifact is **not gradable at T3** → Owner. **A flagged
  change has no same-family discharge:** with no different family seated it is **not gradable** →
  Owner. A reduced verdict is never full."*
- `:75` (availability route's closing list) *"… critical boundaries and T3 honesty remain."* → *"…
  critical boundaries, T3 honesty and a flagged change's cross-family lens remain."* — without this, the
  route's *"A valid fallback discharges the seat"* (`:73`) would let a same-family Astra/Claude pass
  discharge a flagged lens, contradicting `:59`. (Found by walking the compliant-yet-defeating path; see
  § 6 W2.)

`core/GATES.md` § Model · effort matrix
- `:273` row label *"**Irreversible prod write · money-ledger · auth/credential**"* → *"**Action flag:
  irreversible · money/ledger · auth/credential**"* (cells unchanged: frontier · xhigh both columns).
- `:289-291` *"Whether a change is irreversible, money-ledger, or auth/credential work is decided from its
  concrete effects at classification under `core/WORKFLOW.md` § Steer; the strong-gate cell cannot be
  dodged by re-labelling at the gate."* → *"The flag is set from concrete effects under
  `core/WORKFLOW.md` § Steer; re-labelling at the gate cannot dodge it."* (pinned lead-in *"The rare cell
  follows the actual action, not the T2 label"* untouched; the cap text at `:304` — *"on an
  irreversible/money/auth change the rare-cell gate seat **is** the firing"* — is untouched and already
  consistent.)

`core/README.md:76` (pipeline map — found by the claim sweep, not in the brief's touch list):
*"cross-family capstone[if avail]"* → *"cross-family capstone[if avail; REQUIRED if flagged]"*.

`skills/orchestrate/RUNG_ZERO.md` § 0.1
- Table: add a row *"| **Action flag** *(not a tier)* | Concrete effect is irreversible, money/ledger or
  auth/credential; never below T2; what it adds is `core/WORKFLOW.md` § Steer |"* — names what a flag
  IS, not what its gate runs (the table's own rule, `:60-64`).
- `:75-76` *"An irreversible ad-hoc write needs named Owner GO per write, backup and no-rollback
  acknowledgment; money/ledger and auth/credential work retain the action-triggered frontier/xhigh
  gate."* → *"An irreversible ad-hoc write also needs backup and no-rollback acknowledgment."*
- `:86` drop *"A T3 task-lane declaration does not prove historical lineage."* (duplicate — lives at
  `core/WORKFLOW.md:38` *"declarations cannot prove T3 lineage"* and `skills/lane-declare/SKILL.md`).

**Historical T3 lineage text stays** (`WORKFLOW.md:38`, `REVIEW.md` rosters/counts, `GATES.md:272` row,
the ROUTING T3-roster pin).

### Item 2 — skill headroom to about 85%, and the restored pointer

**Harm.** Three skills sit at 100%/99.8%/99.9% of budget. The next editor who must add a binding
correction either raises an Owner-ratified number or cuts under pressure — FM-25 (a byte-cap cut
dropped doctrine twice) and the `orchestrate-skill.test.mjs:150` incident (a rule DELETED during a
budget-driven cut) are this repo's receipts. And CHIP B's net-zero cut (`1f9568f`) dropped the
PROTOCOLS pointer from the stale-worktrees duty: a PM surfacing or removing a worktree no longer
meets the merge-type proof (`ancestor-of` is permanently false after a SQUASH merge) or the occupancy
refusal (`PROTOCOLS.md` § Shipping and merging, § Coordination) — the two checks whose absence causes a
false "not landed" or removal of an occupied worktree.

**Mechanism.** Cut duplicates of text whose home is loaded in the same situation (the METHOD core docs
read at boot, or the skill's own reference layer the body already names). The cut list and homes are
§ 4. Restore the pointer in the same line CHIP B shortened.

**Targets (words, `wc -w` whole file, drafted and measured on a scratch copy of `e764f38`):**

| File | Budget | Now | Draft | % | Delta |
|---|---|---|---|---|---|
| `skills/orchestrate/SKILL.md` | 1400 | 1400 | ~1205 | 86% | −195 (incl. +12 pointer) |
| `skills/architect-build/SKILL.md` | 550 | 549 | ~463 | 84% | −86 |
| `skills/architect-build/ROUTING.md` | 900 | 899 | ~765 | 85% | −134 (817 drafted; § 4 lists the remaining ~52) |

### Item 3 — `core/WORKFLOW.md:100`, the v3 lineage clause

**Harm.** A caller writing a `process_review` for a task whose program is policy-3 (or tier T3) reads
*"absent/v2/v3 history replays unchanged; v4 mints explicitly"*, supplies
`proposed_transition.policy_version: 4`, and is refused `aggregate-process-review-malformed` — a
stalled continuation at a terminal checkpoint. The code (`hooks/repair-dispatch-state.mjs:787-791`)
mints 3 for a policy-3 or T3 program (or, with none, pending child lineage), else 4; the recorder
header (`scripts/record-repair-event.mjs:10-14`) and `PORTABILITY.md:785-790` already say so.

**Draft:** *"absent/v2/v3 history replays unchanged; a v3 or T3 lineage keeps minting v3; otherwise v4
mints explicitly."* — keeps the pinned phrase `v4 mints explicitly` (`tests/release-v2331-docs.test.mjs:18`).

### Item 4 — brief template, `CHIP_BRIEF.md` § 5

**Harm (receipts: program record D-13, D-14, CHIP A lesson).** (a) CHIP B seated Sonnet cold seats
under an Opus Builder — a peer-tier floor breach (`core/REVIEW.md` *"peer tier (never below the
Builder)"*) because no brief named the Builder's model; (b) the committed Gemini log put prior findings
before the free seat, so no seat met `free`; (c) a subagent Builder has no Owner channel, so a brief
that tells it to await the Owner's GO stalls or invites self-authorisation.

**Draft** (in § 5, replacing *"expected **and observed** model+effort, reporting any mismatch rather
than silently substituting."*):
> the Builder's model and effort, by name; every same-family seat at or above the Builder's model
> (`core/REVIEW.md` peer tier) at the standing effort; expected **and observed** model+effort, reporting
> any mismatch rather than silently substituting. **Review logs never ride in the changeset under
> review** — a committed log puts prior findings before every seat. **A Builder the Owner cannot address
> (a subagent) never holds a GO:** the PM pushes on the Owner's GO relayed with the Owner's words and SHA.

Consistency check: `skills/orchestrate/SKILL.md:26-27` (*"A remote GO … may arrive DIRECTLY to a
Builder"*) still holds for an addressable Builder; the new clause covers the one that cannot be
addressed. **Room:** +~55 words against 8 of headroom — see decision **Q3**.

---

## 4 · Cut list (FM-25: listed before the freeze, reviewed as its own artifact)

Each row: the sentence cut, the home where it still lives, and why an agent behaves the same.

**`skills/orchestrate/SKILL.md`**

| # | Cut | Still lives | Words |
|---|---|---|---|
| O1 | Step 0's inline summary of the six checks (*"the tier is SET IN THE BRIEF … neighbourhood sweep … Use T1 …"*), keeping *"RUNG ZERO — six checks before any gate (RUNG_ZERO.md §§ 0.1–0.6). Define user-visible done and its proof."* | `RUNG_ZERO.md` §§ 0.1–0.6 and `:85` (*"Use T1…"*), which the step points to and which binds "BEFORE … any seat" | ~−55 |
| O2 | *"Owner terminal children use fixed authorized scope; bounded T2 Principal children use opened-only scope. This controller-record ceiling never narrows the Principal's broader delegated program authority; never current-chip dispatch."* | `PROTOCOLS.md` (pinned: *"Owner terminal children use fixed authorized scope and bounded T2 Principal children opened-only scope; this controller-record ceiling never narrows…"*); `core/WORKFLOW.md:100` | ~−30 |
| O3 | *"One R4 STOP exception child … genuinely new Owner-approved work begins separately only on disjoint surfaces."* → pointer *"R4 STOP completion children: `core/WORKFLOW.md` § Gate and PROTOCOLS."* | `PROTOCOLS.md` (pinned, same sentences); `core/WORKFLOW.md:100`; `README.md` | ~−55 |
| O4 | *"Conditional on its COMPANIONS … carve-outs before RULE #1."* and *"After writing a repair brief, confirm its actual bytes … The write guard rechecks session, candidate, bytes and paths."* → *"repair-brief byte confirmation is CHIP_BRIEF § 5"* | `core/WORKFLOW.md` § Gate (zoom-in/zoom-out, KISS, Precedence), `RUNG_ZERO.md:22-27` (carve-outs first); `CHIP_BRIEF.md` § 5 (`confirm-repair-brief --confirm`, `--verify`, guard binds paths); `core/WORKFLOW.md:100` (guard rechecks) | ~−45 |
| O5 | *"Keep routine CHIP progress in its durable record; consult only at listed triggers. Principal's Quad Mandate directs completion; PM is the single execution chain."* | `core/WORKFLOW.md` § Architectural consult routing (the same line still points there), `ROUTING.md` § Continuity, `core/FOUNDATIONS.md:35` | ~−25 |
| O+ | Restore: *"Surface stale worktrees (merge-type proof, occupancy refusal: `.agents/skills/orchestrate/PROTOCOLS.md`)"* | — | +12 |

Kept on purpose: the cadence tokens R1…R4 in step 5 (SKILL stays a STATES surface in
`gating-doctrine.test.mjs` "one shape everywhere"), *"runtime model/effort is procedure, not
controller-authenticated identity"* (no other home), the § Routing Owner list, the GO paragraph, the
enforcement and honest-limits paragraphs (all pinned as body rules).

**`skills/architect-build/SKILL.md`**

| # | Cut | Still lives | Words |
|---|---|---|---|
| A1 | § Quiet continuity trigger list and packet-currency sentence, keeping the durable-record rule and the pinned Principal-direction trigger, pointing to `ROUTING.md` § Continuity | `ROUTING.md` § Continuity (full trigger list), § Packets and consults (packet currency, pinned) | ~−45 |
| A2 | Packet paragraph (*"A packet identifies … Owner once through Principal."*), keeping *"Do not create polling, scheduler, transport, review seat, or model binding."* | `ROUTING.md` § Packets and consults (packet fields, adopt/adapt/decline), § Authority (rejected-method hold, pinned) | ~−41 |

**`skills/architect-build/ROUTING.md`**

| # | Cut | Still lives | Words |
|---|---|---|---|
| R1 | Owner authorization form (*"`core/OWNER_COMMS.md` rule 8 requires **AUTHORIZATION NEEDED**, concrete question, …"*) → *"Owner authorization form: `core/OWNER_COMMS.md` rule 8 alone; delegated work proceeds."* | `core/OWNER_COMMS.md` rule 8 — the sole source by the kit's own rule (orchestrate `SKILL.md:44`, pinned "not mirrored here"); this cut removes a mirror | ~−30 |
| R2 | Availability paragraph (*"Within recorded Owner availability policy, Principal routes a required unavailable review … still needs Owner evidence."*) → pointer to `core/REVIEW.md` § Required-review availability route and its mirror | `core/REVIEW.md:64-80` (no verdict; Gemini then Astra; receipt; never bypass host denial; NO-GO is not unavailability; next unstarted seat); `REVIEW.md:62` (Owner-evidenced reduction) | ~−52 |
| R3 | The enumeration after *"use the existing process-review procedure unchanged:"* (*"eligible seat, verified model/effort, … proposed action all remain required."*) | "unchanged" already binds it; the requirements live in `core/WORKFLOW.md` § Gate (fresh frontier review bound to the latest close and frozen candidate) and `core/GATES.md` | ~−20 |
| R4 | *"defer/stop holds dependent work; escalate asks Owner;"* and *"avoid unrelated work/retries without new evidence; route unresolved reserved decisions to Owner."* | `architect-build/SKILL.md:13-14` (pinned: *"avoid unrelated work or repeated attempts without new evidence"*, *"return only unresolved reserved decisions to Owner"*, *"defer/stop holds, escalate asks Owner"*) | ~−20 |
| R5 | *"Prove exact-send real-tool Source, Command and Trust; apply_patch checker does not prove interception."* | `templates/BINDINGS.md.tmpl:74-75` § Enforcement asymmetry (generated `core/BINDINGS.md`) | ~−12 |

**`core/`** (word budget I2 and byte cap I3)

| # | Cut | Still lives |
|---|---|---|
| C1 | `WORKFLOW.md:60` *"Since kit v2.1 it registers in **both** lanes, but read `core/BINDINGS.md` § Enforcement asymmetry as part of that: the Codex-lane registration is inert until a human grants hook trust, and an untrusted hook is skipped silently."* → *"Lanes and hook trust: `core/BINDINGS.md` § Enforcement asymmetry."* | `templates/BINDINGS.md.tmpl:70-75`, which calls itself *"the canonical statement"*; orchestrate `SKILL.md:113-116` |
| C2 | `GATES.md:289-291` (item 1 text above) | the new flag definition in `WORKFLOW.md` § Steer |
| C3 | `RUNG_ZERO.md:75-76`, `:86` (item 1 text above) | the flag definition and row; `WORKFLOW.md:38`; `lane-declare/SKILL.md` |

---

## 5 · Pin plan (mutation-checked; a flipped operative word must go RED)

New file `tests/release-v2340-docs.test.mjs`, whitespace-flattened matching, one test per rule. **The
CHIP B lesson (N2): a pin must reach the operative word** — each pattern below includes the word whose
flip changes the rule, and the mutation battery flips exactly that word.

| Pin | Asserts (operative word in CAPS) | Mutation that must turn RED |
|---|---|---|
| K1 | WORKFLOW § Steer defines the three flags and that each ADDS a REQUIRED cross-family lens, frontier · xhigh, named Owner GO per write; flagged ⇒ at LEAST T2 | REQUIRED→optional; ADDS→may add; "at least T2"→"at least T1"; drop one flag name |
| K2 | WORKFLOW: *"same-family-only NEVER discharges it"* | never→may |
| K3 | WORKFLOW T2 row: *"[if avail; REQUIRED if flagged]"* | REQUIRED→optional |
| K4 | WORKFLOW `:66`: lens *"stays REQUIRED under an action flag or at historical T3"* | REQUIRED→optional |
| K5 | REVIEW: *"under an action flag or at historical T3 it is REQUIRED"*; *"A flagged change has NO same-family discharge"*; *"NOT gradable → Owner"* | REQUIRED→optional; no→a; not gradable→gradable |
| K6 | REVIEW availability route: *"a flagged change's cross-family lens REMAIN"* | remain→lapse / delete clause |
| K7 | GATES matrix row: *"Action flag: irreversible · money/ledger · auth/credential"* with both cells frontier · xhigh (updates the existing pin at `gating-doctrine.test.mjs:268`) | xhigh→high in either cell |
| K8 | RUNG_ZERO row names the three flags and *"NEVER below T2"*, points to WORKFLOW § Steer | never→sometimes |
| K9 | core README map: *"[if avail; REQUIRED if flagged]"* | REQUIRED→optional |
| K10 | WORKFLOW `:100`: *"a v3 or T3 lineage KEEPS minting v3"*, with the 3 derived from `PRINCIPAL_AGGREGATE_POLICY_VERSION` read from the controller source (and 4 from the exported constant, as today) | keeps→stops; v3→v4 |
| K11 | CHIP_BRIEF § 5: Builder model named; same-family seat *"at or ABOVE the Builder"*; review logs *"NEVER ride in the changeset under review"*; subagent Builder *"NEVER holds a GO"*, PM pushes on a relayed GO | above→below; never→may (each) |
| K12 | orchestrate SKILL stale-worktrees duty names PROTOCOLS with *"merge-type proof"* and *"occupancy refusal"* | delete either term |
| K13 | Negative: no surface says new work gets *"not the former third angle or required extra lens"* or T2 lens *"skipped cleanly"* without "unflagged" (walks `core/`, `skills/`, `templates/`); canary proves the regex fires on the old sentence | re-insert the old sentence ⇒ RED |

**Existing pins that move (named, not silently weakened):**
- `gating-doctrine.test.mjs:268` (matrix row regex) → K7's row label.
- `gating-doctrine.test.mjs:279` *"New T3-class work gets the full normal T2 panel"* → *"New work is never T3: it is T2 plus its action flags"*.
- `gating-doctrine.test.mjs:283` *"new controlling-document restructure or irreversible action receives the full normal T2 panel"* → *"new controlling-document restructure receives the full normal T2 panel"* (the irreversible half moves to K5).
- `gating-doctrine.test.mjs:158-161` two assertions on orchestrate `SKILL.md` for O2/O3 sentences are removed; the parallel PROTOCOLS assertions in the same test (`:162-165`) stay and are the rule's pin at its home. Replaced by a pin that the SKILL points to PROTOCOLS for completion children.
- `release-v2331-docs.test.mjs:18` keeps passing (`v4 mints explicitly` retained).

**Mutation battery (FM-19).** Commit the candidate first; each case mutates one operative word in the
committed file, runs the pin file, requires RED, then restores **from the committed candidate** and
asserts the file's hash equals the candidate's. Output (case → RED/GREEN) is saved to the Builder's
scratch and reported at STOP 2; it is not committed.

---

## 6 · Adversarial walk-through (for the panel angle that owns it; the Builder's own first pass)

Compliant-yet-defeating paths for item 1, each with the text that closes it:
- **W1 — tier dodge.** A credential-rotation script is classed T1 ("local tool"). Closed by *"A flagged
  change is at least T2"* and "from concrete effects, never labels"; the gate-time dodge is closed by
  GATES *"re-labelling at the gate cannot dodge it"*.
- **W2 — availability-route discharge.** Codex/Gemini down; the availability route's *"A valid fallback
  discharges the seat"* lets a same-family pass discharge the lens. Closed by REVIEW `:59` (no
  same-family discharge) **and** the `:75` clause (the route's own list names the flagged lens).
- **W3 — prose cap.** A flagged change's doc amendment claims the prose cap ("no external gate") also
  dropped the lens. Closed by WORKFLOW `:66` (the cap never reaches the lens under a flag).
- **W4 — flag omitted at classification.** Nothing mechanical reads a flag (see residual R1): the same
  honesty surface as the tier declaration today; the commit-body `entry:` line and the PM/Owner review
  are the catch.
- **W5 — "the lens fired at design, so the code-stage lens is optional".** Rung-order rule 1's one
  contract-lens firing is not the code-stage lens (`WORKFLOW.md:47-51`, unchanged); the T2 row marks the
  code-stage lens REQUIRED under a flag.
- **W6 — frontier firing budget.** A flagged change also wants a fold-check. GATES `:304` already says
  the rare-cell seat **is** the one discretionary firing; a second needs Owner GO. Unchanged.

---

## 7 · Residuals (accepted, named)

- **R1** — Flags are a declaration, like the tier: no control reads or verifies them. C-CODE's
  commit-msg hook checks `entry:` presence only; a flag field is not proposed.
- **R2** — `hooks/guard-gate-ladder.mjs:125` prints the T2 ladder with *"cross-family lens [if
  available]"* and does not mention flags. Not a regression (today's doctrine says the same); see **Q4**.
- **R3** — Adopters see none of this until CHIP D ports it; the release note names the files.

---

## 8 · Files touched, and which need the Owner's wording sign-off (D-02)

| File | Class | Owner wording sign-off |
|---|---|---|
| `core/WORKFLOW.md` | core, BINDING method | **yes** |
| `core/REVIEW.md` | core, BINDING method | **yes** |
| `core/GATES.md` | core, REFERENCE | **yes** |
| `core/README.md` | core, REFERENCE | **yes** |
| `skills/orchestrate/SKILL.md` | skill body | **yes** |
| `skills/orchestrate/RUNG_ZERO.md` | skill reference layer | **yes** |
| `skills/orchestrate/CHIP_BRIEF.md` | skill reference layer (brief template) | **yes** |
| `skills/architect-build/SKILL.md` | skill body | **yes** |
| `skills/architect-build/ROUTING.md` | skill reference layer | **yes** |
| `templates/**` | — | none touched |
| `README.md` (root, release note), `VERSION`, `package.json` | release | no (release metadata; PM review) |
| `tests/release-v2340-docs.test.mjs` (new), `tests/gating-doctrine.test.mjs` (pin moves) | tests | no |
| this design doc | journal | no |

Word arithmetic for `core/` (drafted on a scratch copy of `e764f38`, `wc -w`-equivalent split):
WORKFLOW 3875 → ~3850 (−25; bytes 25,599 → ~25,478, headroom 122 B) · REVIEW 3595 → ~3628 (+33 with the
`:75` clause; bytes → ~23,720) · GATES 12853 → ~12839 (−14) · README 2319 → ~2322 (+3) · **net ≈ −3**.
The build re-measures; if the net goes positive, the fallback is a further duplicate cut in `GATES.md`
(REFERENCE, no byte cap), named in the build delta.

---

## 9 · Gate plan

Pre-flight (done, below) → this contract → Gemini design gate (`--design`, this doc) → **STOP 1** →
PM disposition → build, RED/GREEN per item → `/kill-pass` (incl. the § 4 FM-25 re-check) → FREEZE →
**STOP 2** → PM seats the cold Claude panel (≥2 angles + free adversary; one angle owns § 6's walk) at
or above Opus 5.5, effort high → PM disposition → Owner wording sign-off (D-02, via the Architect) → PR.
No external gate (pure prose). Never pushed by the Builder.

**Pre-flight record (`core/GATES.md` § Pre-flight):**
1. `§` references this design will add or touch, checked by hand at `e764f38`: `core/WORKFLOW.md`
   § Steer (`## Steer — classify before building`, :18) · § Gate (:77) · § Architectural consult
   routing (:68) · `core/GATES.md` § Model · effort matrix (:241) · `core/REVIEW.md` § Required-review
   availability route (bold lead-in, :64) · `core/BINDINGS.md` § Enforcement asymmetry
   (`templates/BINDINGS.md.tmpl:70`) · `ROUTING.md` § Continuity (:24), § Packets and consults (:34),
   § Authority (:53) · `CHIP_BRIEF.md` § 5 (numbered item, :27) · `RUNG_ZERO.md` §§ 0.1–0.6 (:31–:187).
   All resolve.
2. `node scripts/check-doc-size.mjs` at `e764f38`: WORKFLOW 25,599 B / 25,600 (PASS, 1 B headroom),
   REVIEW 23,523 B (PASS); 5 FAILs are the kit repo's absent generated docs (`OWNER_COMMS.md`,
   `SYSTEM_MAP.md`, …), pre-existing and not this changeset's.
3. `node scripts/check-skill-budgets.mjs` at `e764f38`: all PASS; the three item-2 files, `RUNG_ZERO`
   2910/2925, `CHIP_BRIEF` 992/1000, `PROTOCOLS` 2399/2400 as stated above.

---

## 10 · Decisions this contract asks the PM / Principal to confirm

- **Q1 (item 1, substance of D-03).** Under a flag, may the recorded availability route's
  **same-family-only** fallback discharge the required lens? **Recommend no** — "required
  cross-family (not 'if available')" read literally; with no different family seated the flagged change
  is not gradable and goes to the Owner (wait, or accept the reduction as Owner risk acceptance).
  Alternative: mirror historical T3 (the availability route governs, recorded same-family-only) — fewer
  Owner stops, but the lens then behaves as "if available" in exactly the outage case D-03 names.
- **Q2 (item 1).** *"A flagged change is at least T2."* Recommend yes (closes W1; matches decision-tree
  row 1, which already places most flagged effects at T2). Alternative: flags ride any tier — a flagged
  T1 then owes a frontier cross-family seat on a one-seat ladder, which is incoherent.
- **Q3 (item 4, room in `CHIP_BRIEF.md`).** 8 words of headroom; the addition is ~55. CHIP_BRIEF has no
  duplicates to cut (checked: its sentences have no second home). Options: **(a)** cut two rationale
  sentences that are not rules — *"A record grows until reading it whole is most of a context window spent
  on closed history."* / *"A brief that says 'read it whole' has not decided what its chip needs."* and
  *"Timing out an Owner rung is self-authorisation wearing initiative's clothes, and the gate it skips is
  the one whose whole reason is that the call is not yours."* (~65 words; the rules they justify stay) —
  ends ~982/1000; **(b)** raise the budget 1000 → ~1060 (Owner-ratified number ⇒ Owner call via the
  Architect). **Recommend (a)**; it cuts rationale, not duplicates, so it departs from the brief's
  "duplicates only" wording and needs the PM's confirmation.
- **Q4 (R2, the hook's printed T2 ladder).** Recommend **defer to C-CODE** as a one-string change
  (`guard-gate-ladder.mjs:125` gains "REQUIRED if flagged") under its code gate. Alternative: include it
  here — then C-DOC carries executable content and owes a Codex code gate for that portion
  (`core/WORKFLOW.md:66` exception), which the brief's C-DOC gate shape does not have.
- **Q5 (scope note).** `core/README.md:76` is outside the brief's touch list; the claim sweep found it
  (it states the same "[if avail]" ladder). Recommend include (+3 words).
