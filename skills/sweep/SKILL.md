---
name: sweep
description: Run the sweep sensor — ONE mechanical question over an explicit file list, answered by a cheap read-only seat with fail-closed coverage accounting. Use for enumeration questions and pre-fold dependency checks on controlling docs.
---

# sweep — enumeration is a sensor's job

Word budget: 300 (author-set for this new skill — no Owner ruling names a number for it; the
originating repo's 250 assumed a body that could defer detail to journal docs this kit does not
ship). Tool: `scripts/sweep.mjs`. Doctrine: `core/WORKFLOW.md` § Gate.

## When
- **Pre-fold (load-bearing):** before editing a rule in a `CLASS: BINDING` doc, sweep every clause
  depending on it — vocabulary AND premise-sharers.
- Drift patrol on names, seats, numbers. It surfaces candidates; the PM decides.

## Invoke
```
node scripts/sweep.mjs --question "<ONE mechanical question>" --repo <abs repo path> \
  --files <path> [--files <path>]... [--out <new path inside --repo>]
```
- Explicit files only (≤40 default; no globs) — the sweep never invents its list.
- **Seat:** `--seat model:effort`, or `sweepSeat` in `.claude/kit.config.json`. No seat ⇒
  fail-closed; this kit hardcodes no model id. Bind a **fast-cheap** tier: a sensor, not a gate.
- Exit `0` = all swept · `1` = swept, unreadables declared · `2` = fail-closed. A failed sweep is
  information, never "try reading instead."

## Read the report honestly
The DENOMINATOR is wrapper-verified: it proves each file readable and fails unless every one
returns `scanned`. Per-file `scanned` is the **model's attestation** — no in-band check can prove
a read, since any verifiable probe tells the model what to fetch. So **a zero-finding sweep is not
a clear**, and the report closes nothing alone: its file list was chosen by whoever ran it. Cite
it in the disposition, then decide.
