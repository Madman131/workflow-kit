# Bullet mode — the `/humanize bullet` pass

Word budget: 425 words, whole file. Reference layer: loaded ONLY when
the `bullet` argument fires, so bare `/humanize` never pays for it. Run this AFTER the Procedure in
`.agents/skills/humanize/SKILL.md`, on the finished rewrite. It changes SHAPE only — step 3 still
binds, so **no new facts**.

## First: what must be SAID in sentences
Read this before converting anything. These six are carried by a sentence, not by a list. Each may
still ALSO appear as a row or a bullet — the point is that a reader who skips every list still
gets them:

1. the one-sentence answer, first line of the message (rule 1);
2. any risk, blocker, partial failure, bad news, or anything they must decide;
3. the recommendation and its reason (rule 5);
4. why it matters to THEM (rule 4);
5. a term's first-use definition (rule 2);
6. the background a point needs to make sense — where it sits, what depends on it (rule 3).

So a status table keeps its "blocked" row and a comparison table keeps its risk column — but each
is also stated in prose above the table. Never let a list be the only place one of the six appears.

## Then: convert
Turn into a bullet or a table anything that is:
- a **set of two or more** — options, files, things you checked;
- a **comparison** — that is a **table**, the axes as columns;
- a **sequence** — steps, what happens next;
- a **status** — what is done, what is open.

Never invent a cell to fill a grid; write `— not stated`.

## How much
Default every set, comparison, sequence and status to a bullet or a table unless one of the six
above claims it. That default is the rule; it typically lands around three quarters of the message
in structure, but do not count words — the default is what you follow. A short message may have
nothing to convert; that is a pass, not a miss.

No one-item lists, and no thought split across two bullets; both are sentences. Lead each bullet
with the thing itself in **bold**.

## Then
Can they skim the bold plus the first line and know what happened and what you owe them? If not, the
structure is decoration. Then run `.agents/skills/humanize/SKILL.md` § Then check before you send.
