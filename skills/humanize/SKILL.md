---
name: humanize
description: Rewrite the previous message to obey the "How to talk to the Owner" rules in core/OWNER_COMMS.md. Use when the Owner types /humanize or /humanize bullet, or asks to humanize something.
---

# /humanize — rewrite the last message for the Owner

Word budget: 450 words, whole file. Do not defend the message, re-explain, or apologize. Rewrite it.

**Modes.** Plain `/humanize` runs everything below. Bullet mode fires when the Owner ASKS FOR bullets
or a table (`/humanize bullet`, "humanize that in bullets") and NOT when they want fewer or complain —
`/humanize no bullets` and `/humanize bullets made it worse` are plain `/humanize`. **If both readings
fit, do not fire**, and a mention inside the message being rewritten never triggers. `/humanize-bullet`
enters pre-triggered, but the negation rule still applies. When bullet mode fires, run the Procedure,
then follow `.agents/skills/humanize/BULLET.md`. The rest of the line is a focus hint.

## Procedure
1. Re-read `core/OWNER_COMMS.md` § "How to talk to … — Owner, not a developer" (that heading names
   YOUR Owner). **That section is the contract** — every rule, not a subset. The list below only
   reminds.
2. The input is your OWN last message — unless the Owner named another or pasted text.
3. Rewrite it whole: same conclusion, same asks, **no new facts**. ADD what the section requires and
   the message lacks. CUT what they do not need NOW — status recitals, proofs, unrequested detail —
   offering it in one clause. **Never cut a risk, blocker, partial failure, or anything they must
   decide**; those lead.
4. Output ONLY the rewrite. No preamble, no list of changes.

## The usual misses — check each against the section
- **Answer buried** — it belongs in the first sentence (rule 1).
- **Over-answered** (rule 1; the most common failure). A small question drew an inventory. Cut every
  line narrating or re-classifying the question. A mandated sweep (`core/OPERATE.md` § closeout) is
  still DONE — its completeness is not a word count.
- **A wall of text** — long, with no bullet or table (rule 9).
- **Undefined terms**, or shorthand you coined (rule 2).
- **Missing background** — where it sits, what depends on it (rule 3).
- **Missing consequence** — what it costs or protects for THEM (rule 4).
- **A decision with no recommendation** (rule 5).
- **Jargon, long sentences, bloat** (rule 6).
- **A buried ask** — a question, recommendation, or decision left mid-paragraph, unbolded (rule 8):
  pull it out, bold it, label it.

## Then check
Could they reasonably reply "give me the short version", re-read a sentence, look up a word, or meet
a paragraph block where a list belonged? If so, it is not done.
