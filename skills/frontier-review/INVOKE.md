# Invocation mechanics — reference layer

On-demand detail for `.agents/skills/frontier-review/SKILL.md` § 3. Load it when you are actually
seating a lane; the rules that bind every firing live in the body, not here.

## Claude lane — two false alarms

Neither means the seat's tool limit is gone:

- **"Agent type not found"** right after editing the definition is a **stale session** — subagent
  definitions load at session start. Start a fresh session rather than editing further.
- **The agent listing shows `(Tools: All tools)`** for a seat declaring `tools: []`. That is a
  cosmetic rendering of an empty list, not a report that the seat holds tools. **The listing is
  not the check** — read the installed frontmatter, and confirm the finished run's `tool_uses`
  is 0.

Never fall back to an inline frontier-model call because of either signal: an inline call drops the
seat's limits entirely, which is the failure both signals are mistaken for.

## Codex lane — running the gate runner

The body states the load-bearing fact: that lane is **not packet-only**, so it is a cross-family
gate on your question rather than this seat. Mechanics for running it:

- It ships only with `init --with-gate-runners` and needs the `codex` CLI at runtime
  (`PORTABILITY.md` § External tool dependencies).
- **Launch it detached** and wait on the process, per `core/GATES.md` § How to run. A foreground
  call under the caller's own time cap gets killed before the gate can fail closed.
- **Never hand-rolled `codex exec`** — `core/GATES.md` § Gotchas / traps.
- **Exit ≠ 0, or a receipt with no verdict, is a fail-closed non-pass.** Never "keep polling": the
  runner fails closed by exiting non-zero with no output file, so a poll that waits for the file
  to appear waits forever.
