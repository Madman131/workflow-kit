# thread-restart (Codex) — smart thread compaction + fresh restart

Perform a **smart thread compaction + fresh restart**: preserve every pertinent detail of THIS Codex
conversation in a durable **digest**, so a fresh conversation can continue with a small context window and
lose nothing essential. This is NOT `/compact` (a lossy auto-summary) — it is a controlled, verified extraction.
Optional focus from the user follows this line, if any.

## Step 1 — Build the digest (a control, not a summary)
Write a durable digest document with these sections:
1. **Read-first pointers** — the durable docs/files/code where the truth ALREADY lives. Point at them; do NOT
   re-copy their content ("read these, don't re-derive"). This is what keeps the digest small.
2. **Decisions & synthesis not yet written down anywhere** — the rulings, reasoning, and conclusions from THIS
   conversation that are not yet in any durable doc. **This is the part that is LOST on a reset** — capture it
   in full, with the WHY, not just the what.
3. **Live open items / next decisions** — what's in flight, queued, or awaiting a decision, with owners and
   exact identifiers (branches, SHAs, ticket/task ids).
4. **Key principles / context** — the durable lessons and constraints this conversation established or reinforced.
5. **How to use** — one line telling a fresh conversation how to boot from this digest.

Quality rules (these are what make it *smart*):
- **Index, don't duplicate.** If a detail already lives in a durable doc, point at it instead of restating it.
- **VERIFY before finalizing — do not trust your in-conversation memory; it may be stale.** Re-check every
  state claim (shipped SHAs, task/branch status, file contents, what is open vs closed) against the CURRENT
  repo and tools, and fix any drift you find. State one line confirming you ran this pass. (An unverified
  digest silently ships a stale "fact" — this step is the whole point.)
- **Drop operational noise** — the shell/git mechanics and exploratory dead-ends. Keep decisions and their
  rationale, not the keystrokes.
- **Preserve exactly:** identifiers (SHAs, paths, ids), numeric values, the reasoning behind each decision,
  and anything a fresh conversation must have to act without re-deriving it.

Write it to a **dedicated `thread-restarts/` folder** — create one if needed (e.g. `docs/thread-restarts/`,
or a repo-root `thread-restarts/`). **NEVER write it into `docs/journal/` or the main docs tree** — digests
must stay corralled in their own folder so they don't junk up the docs. Give it a descriptive, dated name.
**Prefer gitignoring this folder** — digests are transient handoffs; commit one only if you deliberately want
it durable/shared. **Do NOT auto-commit or auto-push;** report the path and let the user decide.

## Step 2 — Guide the restart
After writing the digest, tell the user concisely:
- the digest path,
- to **start a new Codex conversation** (`/new`, or exit and relaunch `codex`), and
- the exact one-line seed for the fresh conversation: **"Read `<digest path>` and continue."**

## Honest limit
You cannot reset the context yourself — that is a user action. Your job is the verified durable digest + the
restart seed; the user starts the new conversation. Never claim the context was reset.
