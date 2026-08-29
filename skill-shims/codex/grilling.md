# /grilling — settle intent before the build, not at the gate

Codex-lane entry point. **Read and follow `.agents/skills/grilling/SKILL.md`** in the repo you are
working in — the single canonical body shared with the Claude lane's `/grilling`. Do not restate its
content here: this file exists only so Codex can discover the procedure by name.

That body also governs how each round is shaped and which lenses choose its questions. Do not infer
either from this file.

## Lane note — maintainer note only, not an instruction to the agent reading this file
Codex prompts fire only when the Owner types them. In the Claude lane this skill is model-invoked, so
the agent queues it unprompted; here it waits to be called. A pointer line in the repo's `AGENTS.md`
is the way to approximate that auto-fire.

Optional focus from the user follows this line, if any.
