---
name: grilling
description: Interview the Owner round by round until a plan or design is settled. Use before minting a chip brief, before acting on a plan whose scope has more than one reading, and when the Owner asks to be grilled or to stress-test an idea.
---

# /grilling — settle intent before the build, not at the gate

Word budget: 500. Doctrine: `core/FOUNDATIONS.md` RULE #1, and `core/WORKFLOW.md` § Round/root-cause
controller for zoom-out and KISS. Those hold the tests; this says how they choose questions.

**Why early.** Misalignment reaching a gate costs panel rounds and removes scope; reaching this skill
it costs one round of questions.

## The mechanic

Map the work as a **design tree**: every decision branches into the decisions hanging off it.

The **frontier** is every decision whose prerequisites are already settled — the questions answerable
now, without guessing at answers you have not heard. **Ask the whole frontier in one round**, then
wait. Each set of answers pushes the frontier outward; recompute it and ask the next round.

## Which questions earn a round — three lenses, in this order

The order is the lever: a question that could end the line of work outranks every question that
refines it.

1. **Zoom out, first.** Is this still the asked-for work? Is it proportional? Would deleting the thing
   remove the problem?
2. **RULE #1.** A question earns its place when the answer changes what reaches the Owner, the
   usability of the product, or the functionality of the code. A question bearing only on the record,
   the contract, or consistency is a **NOTE** — state your assumption in one clause and carry on.
3. **KISS.** Prefer the question that could delete a branch to the question that adds machinery.

## Facts are yours; decisions are theirs

A question answerable from the repo, the git history, or a tool is a **fact**: dispatch a subagent and
go find it. Put decisions to the Owner. A running exploration is an unsettled prerequisite, so its
dependants wait for the subagent while the rest of the frontier goes out now.

Every question carries **your recommended answer**, so "your rec" is always a complete reply.

## Shape

Format each round with `/humanize bullet`; `.agents/skills/humanize/SKILL.md` governs it, including
what the `bullet` argument does. Where `core/OWNER_COMMS.md` is absent the contract is dormant — keep
the round's shape (the answer first, every ask bold and labelled, a set of two or more as a list) and
say the contract file was not found.

Each question reads:

```
❓ **Q1 — <title>**: <the question, and the choices>

➡️ <your recommended answer>
```

## Done when

The frontier is empty: every branch visited, nothing silently assumed. When what remains only refines
a decision already made, say so and stop there. Then put the shared understanding to the Owner and
hold for confirmation before acting.
