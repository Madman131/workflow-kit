<!-- workflow-kit:thread-restart-pointer -->
## Thread restart — durable digest, then a fresh session
To restart, write a durable, **verified digest**, then continue in a fresh context: follow [`.claude/commands/thread-restart.md`](.claude/commands/thread-restart.md).
It is plain markdown, so any agent can READ and run it. Claude Code and Codex: `/thread-restart`.
**Honest limit:** the agent writes the digest
and restart seed; the USER performs `/clear` (Claude) or `/new` (Codex). No agent
resets its own context — never claim it did.
