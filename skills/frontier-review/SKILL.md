---
name: frontier-review
description: Spend the changeset's one frontier firing on a single distilled decision question — by default the fold-check on a remediation delta; a design gate or Owner-named call (/frontier-review) spends the same firing. The escalation past a gate ladder's soft stop is exempt. The workhorse builds a sufficiency-tested packet; the frontier seat judges only that packet; the workhorse resumes as decider.
---

# /frontier-review — packet in, judgment out

Word budget: 750. Doctrine: `core/FOUNDATIONS.md` § Principles P2/P3 · `core/REVIEW.md`
(payload contract; `free` vs `folded`) · `core/GATES.md` § Model · effort matrix. Roles (frontier
judge · workhorse · Codex-lane frontier) bind in `core/BINDINGS.md`; adopters may alias the
command to their model's name.

## When to invoke
**One firing per changeset, and the Owner holds the second.** Default consumer: the **fold-check**
on a remediation delta, before the cross-family bookend. Other discretionary consumers — a design
gate, an Owner-named call — **spend that same single firing**. A second needs an Owner GO;
**you may request one at any time with a reason, and requesting is not authorizing.** **Outside the
cap:** the escalation past the ladder's soft stop (`core/WORKFLOW.md` § Gate — a mechanical
trigger), an Owner-typed `/frontier-review`, and the pinned decider seat (P3).

Never for: boot or gathering, mechanical work, or as a substitute for a cross-family seat — a
consult shares its lane's family and buys no decorrelation.

## 1. Frame ONE question
A single decision the thread is blocked on. If you cannot state it in ≤3 sentences, you are not
ready to spend the seat.

## 2. Build the packet — CUT ON RELEVANCE, NEVER ON VOLUME
Starvation, not verbosity, is the known failure (`core/REVIEW.md` § Cross-family lens). Include
everything needed to **falsify** the claim, not merely to state it:
1. The artifact — the design doc, or the contested code **in full**, not an excerpt.
2. Every path the claim runs through — call sites, callers, the data it reads.
3. The contract clause allegedly violated + the relevant invariants.
4. The test that should have caught it (or the fact that none exists).
5. On an escalation only: what the prior rounds concluded and why it recurred.
6. The question, plus the live options with each option's cost.
7. Any cheap-tier pre-pass output, as **advisory input** — it never gates whether this seat
   runs.

**Sufficiency test before sending — mandatory:** *could a reader who knows nothing else DISPROVE
this claim using only what is here?* If no, add what is missing.

**Carry evidence, never your conclusion** — a packet that frames the answer buys ratification
(`core/REVIEW.md` § Decorrelation).

**Record the pass-type.** A packet carrying item 5 is a **folded** pass, never `free`; record it
as folded in the manifest. An unrecorded folded seat reads as stronger than it is.

## 3. Invoke — per lane
**Claude lane:** spawn ONE subagent via the Agent tool with `subagent_type: "frontier-consult"` —
**never an inline frontier-model call**, which drops the control. That definition holds
`tools: []`, which the harness enforces as *no tools at all*, so packet-only is a control, not a
promise. Send the packet as the whole prompt.

⚠ The cage is **silent, not honest**: a caged seat can fabricate tool calls and claim work that
never happened. A confident answer is NOT evidence the packet sufficed — § 2's sufficiency test
still binds.

⚠ Two false signals, neither meaning the control is gone: "agent type not found" after editing
the definition is a **stale session** (they load at session start), and the agent listing
**mislabels** the seat `(Tools: All tools)` (it renders an empty list as "all"). Start fresh;
verify `tool_uses` = 0; never fall back to inline.

**Codex lane:** the Codex-lane frontier (`core/BINDINGS.md`) judges the packet via the Codex gate
runner (`init --with-gate-runners`; needs the `codex` CLI — `PORTABILITY.md`). Launch detached per
`core/GATES.md` § How to run, or the caller's time cap kills it before it fails closed. Never
hand-rolled `codex exec` (`core/GATES.md` § Gotchas / traps). Exit ≠ 0 or a missing receipt is a
fail-closed non-pass, never "keep polling".

## 4. Hand back — the thread stays the decider
- INPUT, not an instruction (P3). The PM dispositions each point.
- **`INSUFFICIENT PACKET` is a success** — add what it named, re-send ONCE.
- **Cost:** the frontier judge is your bindings' most expensive seat. It normally leaves the
  external-gate budget untouched, but on an irreversible/money/auth change the frontier seat *is*
  that gate.
- Family: record a gate-feeding consult as a reduced same-family read.
