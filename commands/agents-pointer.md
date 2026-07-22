<!-- workflow-kit:thread-restart-pointer -->
## Thread restart — durable digest, then a fresh session
To restart a thread cleanly — distil it into a durable, **verified digest**, then continue in a fresh
context window that loses nothing essential — follow the procedure in
[`.claude/commands/thread-restart.md`](.claude/commands/thread-restart.md). It is plain markdown: any
agent can READ and run it even where custom slash-commands are unsupported. Claude Code: `/thread-restart`.
Codex: `/thread-restart` (installed into your Codex prompts dir, default `~/.codex/prompts/`) — or just
read the repo file above. **Honest limit:** the agent produces the digest + the one-line restart seed;
the USER performs the `/clear` (Claude) or `/new` (Codex). No agent resets its own context — never claim
it did.
