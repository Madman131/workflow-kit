# /humanize-bullet — alias for `/humanize bullet`

Codex-lane entry point. **ALIAS. This file holds no rules and no body of its own.**

Do exactly what `/humanize bullet` does: **read and follow `.agents/skills/humanize/SKILL.md`** in
the repo you are working in — the single canonical body shared with the Claude lane. Do not restate
its content here. It governs everything, including how this alias is handled and which file to read
next — do not infer any behaviour from this file. The contract it enforces is the
`## How to talk to … — Owner, not a developer` section of `core/OWNER_COMMS.md` (that heading names
the Owner of the repo you are in).

## Install note
Codex reads prompts from your Codex prompts dir (`~/.codex/prompts` by default), which is
USER-GLOBAL — outside any repo. workflow-kit `init` installs this file there as a **real copy, never
a symlink** (Codex skips symlinks, so a symlinked prompt resolves on disk yet the command still does
not exist). Re-run `init --force` to update it. Maintainer note only — not an instruction to the
agent reading this file.

Optional focus from the user follows this line, if any.
