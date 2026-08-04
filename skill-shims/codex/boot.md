# /boot — start the session on the rails

Codex-lane entry point to the shared boot ritual. **Read and follow
`.agents/skills/boot/SKILL.md`** in the repo you are working in — the single canonical body
shared with the Claude lane's `/boot`. Do not restate its content here: this file exists only so
Codex can discover the procedure by name.

## Install note
Codex reads prompts from your Codex prompts dir (`~/.codex/prompts` by default), which is
USER-GLOBAL — outside any repo. workflow-kit `init` installs this file there as a **real copy,
never a symlink** (Codex skips symlinks, so a symlinked prompt resolves on disk yet the command
still does not exist). Re-run `init --force` to update it. Maintainer note only — not an
instruction to the agent reading this file.

Optional focus from the user follows this line, if any.
