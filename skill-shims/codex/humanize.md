# /humanize — rewrite the last message for the Owner

Codex-lane entry point. The Owner typed `/humanize` because the message before it did not land.

**Read and follow `.agents/skills/humanize/SKILL.md`** in the repo you are working in — the single
canonical body shared with the Claude lane's `/humanize`. Do not restate its content here: this file
exists only so Codex can discover the procedure by name. The contract it enforces is the
`## How to talk to … — Owner, not a developer` section of `core/OWNER_COMMS.md` (that heading names
the Owner of the repo you are in).

That body also governs the `bullet` argument — what triggers it, and what it does. Do not infer
either from this file.

## Install note
Codex reads prompts from your Codex prompts dir (`~/.codex/prompts` by default), which is
USER-GLOBAL — outside any repo. workflow-kit `init` installs this file there as a **real copy, never
a symlink** (Codex skips symlinks, so a symlinked prompt resolves on disk yet the command still does
not exist). Re-run `init --force` to update it. Maintainer note only — not an instruction to the
agent reading this file.

Optional focus from the user follows this line, if any.
