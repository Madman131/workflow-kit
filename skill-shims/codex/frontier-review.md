# /frontier-review — bring the frontier seat in for one distilled judgment call

Codex-lane entry point to the shared frontier-consult procedure. The workhorse seat (whichever
build seat is active) gathers and frames the packet; the Codex-lane frontier model — bound in
`core/BINDINGS.md` — judges it; the workhorse resumes as decider.

**Read and follow `.agents/skills/frontier-review/SKILL.md`** in the repo you are working in — the
Codex-lane sections. That file is the single canonical body shared with the Claude lane's
`/frontier-review`. Do not restate its content here: this file exists only so Codex can discover
the procedure by name.

## Install note
Codex reads prompts from your Codex prompts dir (`~/.codex/prompts` by default), which is
USER-GLOBAL — outside any repo. workflow-kit `init` installs this file there as a **real copy,
never a symlink** (Codex skips symlinks, so a symlinked prompt resolves on disk yet the command
still does not exist). Re-run `init --force` to update it. Maintainer note only — not an
instruction to the agent reading this file.

Optional focus from the user follows this line, if any.
