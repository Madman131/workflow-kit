# Contract — the terminal STOP is never a bare dead-end (v2.20.0)

**Origin (Owner-directed 2026-08-26):** reviewing the LPB terminal-cadence port, the Owner named the seam:
*"if it runs 3 rounds and the bookend then stops, we need a mechanism for a good rec for my approval — a
FRESH LOOK with zoom-out, RULE #1, and KISS, and a rec given to me."* Kit-first (root enabler before the
LPB port resumes), so all three repos inherit it.

**Tier: T2** core-doc gate-machinery amendment (the terminal bookend + RULE #1). Owed: the mandated
adversarial walk-through, cross-family, `/sweep`, Owner wording sign-off. It EXTENDS two already-gated
doctrines (v2.16 terminal controller + v2.19 screen-at-emission) — low-ish residual risk; gate scaled to it.

## The change (marries v2.16 bookend to v2.19 ACTION-SCREEN)

- **`core/WORKFLOW.md` § Gate controller ¶ (the bookend):** a short pointer — "Before it closes, the bookend
  runs the fresh-look `ACTION-SCREEN` on each accepted blocker (`core/FOUNDATIONS.md` RULE #1): one that
  FAILS it closes GO as a named residual, one that SURVIVES closes STOP carrying the Owner a screened
  recommendation — never a bare dead-end." (WORKFLOW at cap; kept lean; detail lives in FOUNDATIONS.)
- **`core/FOUNDATIONS.md` RULE #1 / ACTION-SCREEN clause:** the detail — at a bookend STOP the same screen
  re-screens each accepted blocker; a FAIL (mis-accepted / hypothetical the candidate does not exhibit) ⇒
  the correct close is GO with it a named residual (the Round-26 case); a SURVIVOR ⇒ STOP carrying ONE
  recommendation for the Owner's approval: a narrow continuation on only the located defect (never machinery
  for a hypothetical), or abandon.

## Terminality safety (the key design point)

The fresh look is PART OF THE BOOKEND'S OWN DISPOSITION, not a re-opening of a closed panel. It does not
violate terminality: it ensures the GO/STOP call is correctly RULE #1-screened (a mis-accepted "blocker"
that fails the fresh screen was never a real blocker, so the correct close was always GO), and where a real
harm survives it produces the Owner-facing recommendation. A STOP still permanently reserves the paths;
rework past it is still only an Owner continuation. Nothing lets a closed STOP re-open in place.

## Acceptance criteria
- **AC1:** the bookend states it runs the fresh-look ACTION-SCREEN before closing.
- **AC2:** a mis-accepted/hypothetical blocker ⇒ GO-with-residual; a surviving one ⇒ STOP + one screened
  recommendation (narrow continuation on the located defect, or abandon) for the Owner.
- **AC3:** terminality preserved — the fresh look is bookend disposition, not a re-open; STOP still reserves
  paths + Owner-continuation-only.
- **AC4:** does not re-introduce the label-based dodge (the fresh screen is the v2.19 evidence-bound one:
  reachable-as-shipped ⇒ REMEDIATE; a firing trigger forbids the GO-with-residual escape).
- **AC5:** `tests/gating-doctrine.test.mjs` green (controller-¶ FINITE_CADENCE pins + RULE #1 pins intact +
  the 3 new bookend pins); full `npm test` green; docs under the 25600 cap (WORKFLOW headroom ~250).

## Adversarial seeds
- **GO-with-residual as an escape:** could an agent call a REAL blocker "mis-accepted" to force GO? Fence:
  the fresh screen is evidence-bound (v2.19) — a trigger that FIRES on the candidate forbids the GO route.
- **Terminality breach:** does "close GO" after a STOP re-open a closed panel? No — the fresh look runs
  BEFORE the close, as the disposition; it determines the close, not a re-open. Verify the wording can't be
  read as re-opening.
- **Cross-doc split:** pointer in WORKFLOW, detail in FOUNDATIONS — same pattern as the ACTION-SCREEN
  itself; the WORKFLOW pointer names the rule + FOUNDATIONS, findable.
