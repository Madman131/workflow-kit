---
name: frontier-review
description: Spend the changeset's one frontier firing on a single distilled decision question — by default the fold-check on a remediation delta. The workhorse builds a sufficiency-tested packet; the frontier seat judges only that packet; the workhorse resumes as decider. Use when the Owner types /frontier-review, or before a fold-check, design gate, or escalation past a ladder's soft stop.
---

# /frontier-review — packet in, judgment out

Word budget: 850. Doctrine: `core/FOUNDATIONS.md` § P2/P3 · `core/REVIEW.md` (payload contract;
`free` vs `folded`) · `core/GATES.md` § Model · effort matrix. Roles (frontier judge · workhorse ·
Codex-lane frontier) bind in `core/BINDINGS.md`; alias the command to your model's name if you
prefer.

## When to invoke
**One firing per changeset, and the Owner holds the second.** Default consumer: the **fold-check**
on a remediation delta, before the cross-family bookend. A discretionary consumer — a design gate,
a rare-cell gate — **spends that same firing**. A second needs an Owner GO; **you may request one
at any time with a reason, and requesting is not authorizing.** **Outside the cap:** the escalation
past the ladder's soft stop, an Owner-typed `/frontier-review`, the pinned decider seat (P3).

⚠ This cap is a rule of THIS skill, not of `core/`, and **nothing counts it** — round count is a
conversation fact, no hook reads it (`core/WORKFLOW.md` § Gate). You are its only enforcement:
name the exemption you claim, or you are spending an unbudgeted seat.

Never for: boot or gathering, mechanical work, or as a substitute for a cross-family seat — a
consult shares its lane's family and buys no decorrelation.

## 1. Frame ONE question
A single decision the thread is blocked on. If you cannot state it in ≤3 sentences, you are not
ready to spend the seat.

## 2. Build the packet — CUT ON RELEVANCE, NEVER ON VOLUME
Starvation, not verbosity, is the known failure (`core/REVIEW.md` § Cross-family lens). Include
everything needed to **falsify** the claim, not merely state it:
1. The artifact — the design doc, or the contested code **in full**, not an excerpt.
2. Every path the claim runs through — call sites, callers, the data it reads.
3. The contract clause allegedly violated + the invariants — **and, since the seat cannot read
   them, the doctrine excerpts it is judged against** (`free` vs `folded`, P2/P3).
4. The test that should have caught it (or the fact that none exists).
5. On an escalation only: what the prior rounds concluded and why it recurred.
6. The question, plus the live options with each option's cost.
7. Any cheap-tier pre-pass output, as **advisory input** — it never gates whether this seat runs.

**Sufficiency test — mandatory:** *could a reader who knows nothing else DISPROVE this claim from
what is here?* If no, add what is missing.

**Carry evidence, never your conclusion** — a packet that frames the answer buys ratification
(`core/REVIEW.md` § Decorrelation).

**Record the pass-type.** A packet carrying item 5 is **folded**, never `free`. An unrecorded
folded seat reads as stronger than it is.

## 3. Invoke — per lane
**Claude lane:** spawn ONE subagent via the Agent tool with `subagent_type: "frontier-consult"` —
**never an inline frontier-model call**, which drops the seat's limits. Send the packet as the
whole prompt. That definition holds `tools: []`, which the harness documents as *no tools at all*.
**The kit ships and install-checks that declaration; it does not execute the enforcement** — so
treat packet-only as verifiable, not as seen firing here.

⚠ The cage is **silent, not honest**: a caged seat can still fabricate tool calls. A confident
answer is NOT evidence the packet sufficed — § 2 still binds. Two false alarms, neither meaning
the limit is gone: "agent type not found" right after editing the definition is a **stale session**
(they load at session start), and the listing renders an empty list as `(Tools: All tools)`. Start
fresh; check `tool_uses` = 0.

**Codex lane — ⚠ NOT packet-only.** Its frontier is reached through the gate runner
(`init --with-gate-runners`; needs the `codex` CLI — `PORTABILITY.md`), which hands the seat the
**repository**, not just your packet, and demands a GO/NO-GO verdict — so neither the cage nor
`INSUFFICIENT PACKET` applies. Use it as a cross-family gate on the same question; do not record it
as this seat. Run it per `core/GATES.md` (detached; never hand-rolled `codex exec`; exit ≠ 0 or a
missing receipt is a fail-closed non-pass).

## 4. Hand back — the thread stays the decider
- INPUT, not an instruction (P3). The PM dispositions each point.
- **`INSUFFICIENT PACKET` is a success** — add what it named, re-send ONCE.
- **Cost:** your bindings' most expensive seat. It normally leaves the external-gate budget
  untouched; on an irreversible/money/auth change it **consumes** that budget. It never *satisfies*
  the external gate — it shares the lane's family, and a critical gate keeps P3's **hard family
  floor** (≥1 full-independent seat, fails closed).
- Family: record a gate-feeding consult as a reduced same-family read.
