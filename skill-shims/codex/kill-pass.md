# /kill-pass — break it yourself before a seat is paid to

Codex-lane entry point. **Read and follow `.agents/skills/kill-pass/SKILL.md`** in the repo you are
working in — the single canonical body shared with the Claude lane's `/kill-pass`. Do not restate its
content here: this file exists only so Codex can discover the procedure by name.

Run it after the build is believed complete and before any cold seat or `panel_open`, and again on a
repair delta before it is re-frozen. The body carries the order of steps and the report shape; do not
infer either from this file.

## Lane note — maintainer note only, not an instruction to the agent reading this file
Codex prompts fire only when the Owner types them. In the Claude lane this skill is model-invoked; here
it waits to be called. A pointer line in the repo's `AGENTS.md` is the way to approximate that auto-fire.

Optional focus from the user follows this line, if any.
