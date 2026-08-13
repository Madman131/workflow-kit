---
name: frontier-review
description: Spend the changeset's one frontier firing on a single distilled decision question. The workhorse builds a sufficiency-tested packet; the frontier seat judges only that packet; the workhorse stays decider. Use when the Owner types /frontier-review, or before a fold-check, design gate, or a same-class-recurrence escalation.
---

# /frontier-review — packet in, judgment out

Word budget: 750 (body; mechanics in `INVOKE.md` beside it). Doctrine: `core/FOUNDATIONS.md`
§ P2/P3 · `core/REVIEW.md` (payload contract; `free` vs `folded`) · `core/GATES.md` § Model ·
effort matrix. Roles bind in `core/BINDINGS.md`; alias the command to your model's name.

## When to invoke
**One firing per changeset, and the Owner holds the second.** Default consumer: the **fold-check**
on a remediation delta, before the cross-family bookend. A discretionary consumer — a design gate,
a rare-cell gate — **spends that same firing**. A second needs an Owner GO; **requesting one is not
authorizing it.** **Outside the cap:** the same-class-recurrence escalation, an Owner-typed
`/frontier-review`, the pinned decider seat (P3).

⚠ This cap is a rule of THIS skill, not of `core/`, and **nothing counts it** — round count is a
conversation fact, no hook reads it (`core/WORKFLOW.md` § Gate). You are its only enforcement:
name the exemption you claim, or you spend an unbudgeted seat.

Never for: boot, gathering, mechanical work, or as a substitute for a cross-family seat — a consult
shares its lane's family and buys no decorrelation.

## 1. Frame ONE question
A single decision the thread is blocked on. If you cannot state it in ≤3 sentences, you are not
ready to spend it.

## 2. Build the packet — CUT ON RELEVANCE, NEVER ON VOLUME
Starvation, not verbosity, is the known failure (`core/REVIEW.md` § Cross-family lens). Include
what is needed to **falsify** the claim, not merely state it:
1. The artifact — the design doc, or the contested code **in full**, not an excerpt.
2. Every path the claim runs through — call sites, callers, the data it reads.
3. The contract clause allegedly violated + the invariants — **and, since the seat cannot read
   them, the doctrine excerpts it is judged against** (`free` vs `folded`, P2/P3).
4. The test that should have caught it (or that none exists).
5. On an escalation only: what the prior rounds concluded and why it recurred.
6. The question, plus the live options with each option's cost.
7. Any cheap-tier pre-pass output, as **advisory input** — it never gates whether this seat runs.

**Sufficiency test — mandatory:** *could a reader who knows nothing else DISPROVE this claim from
what is here?* If no, add what is missing.

**Carry evidence, never your conclusion** — a packet framing the answer buys ratification
(`core/REVIEW.md` § Decorrelation).

**Record the pass-type.** A packet carrying item 5 is **folded**, never `free`; an unrecorded
folded seat reads as stronger than it is.

## 3. Invoke — per lane
**Claude lane:** spawn ONE subagent via the Agent tool with `subagent_type: "frontier-consult"` —
**never an inline frontier-model call**, which drops the seat's limits. Send the packet as the
whole prompt. That definition holds `tools: []` — a cage on REACH, **not a packet-only guarantee:
nothing bounds what the harness PRE-LOADS.** The kit install-checks the declaration; it
does not execute the enforcement.

⚠ The cage is **silent, not honest**: a caged seat can still fabricate tool calls. A confident
answer is NOT evidence the packet sufficed — § 2 still binds.

**Codex lane — ⚠ NOT packet-only.** Its frontier comes through the gate runner, which hands the
seat the **repository**, not just your packet, and demands a GO/NO-GO verdict — so neither the tool
limit nor `INSUFFICIENT PACKET` applies. Use it as a cross-family gate; never record it as this
seat.

*Per-lane mechanics — the false alarms that are not a lost cage, and launching the Codex runner:
`.agents/skills/frontier-review/INVOKE.md`.*

## 4. Hand back — the thread stays the decider
- INPUT, not an instruction (P3). The PM dispositions each point.
- **`INSUFFICIENT PACKET` is a success** — add what it named, re-send ONCE.
- **Cost — budget accounting, never seat substitution.** Normally this consult leaves the
  external-gate budget untouched. On an irreversible/money/auth change **the gate seats themselves
  bind the frontier model** (`core/BINDINGS.md`), so the firing is spent **by the gate**. A consult
  **never substitutes** for a cross-family or external seat: it shares the lane's family, and P3's
  family floor is **fail-closed** (≥1 full-independent seat).
- Family: record a gate-feeding consult as a reduced same-family read.
