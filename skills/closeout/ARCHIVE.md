# Archive step — the last act of a closed chip

Word budget: 650, whole file. Reference layer for `.agents/skills/closeout/SKILL.md` § 7. A finished thread's Claude process and
its Codex plugin brokers stay resident until the session is archived; one host reached 36 Claude processes and 24 orphaned
broker trees (3.2 GB) that way. The host's archive call also cleans up the session's worktree, so the plan below refuses
anything it cannot prove clean and pushed.

**Who archives what.** A PM archives each session it started once that session's work is landed, verified and has nothing
left to do. An Architect archives each PM it started once that PM's chip is closed out: landed, verified, digest written,
no unpushed work, nothing waiting on the Owner. Never the Architect thread, a session you did not start, unpushed work, or
anything the Owner is waiting on.

1. **Authority.** Archive only when your instructions carry the Owner's standing yes for it; an adopter's Owner must grant
   it, and you never infer it. Without it, do steps 2–4 and 6 as a REPORT and archive nothing.
2. **Host.** `list_sessions {"linked": true, "limit": 200}`, and `get_session self` for your id and cwd. A host without
   session tools, and a Codex lane (it has no archive tool), REPORT what it would archive and say why it did not.
3. **Plan.** `node scripts/archive-plan.mjs --sessions <list.json> --me <your id> --me-cwd <your cwd> --list-limit 200 --done <id>… --waiting <id>… --owner-yes --json`.
   `--done` is YOUR assertion that the session is landed, verified and finished; an Architect asserts it for each PM AND each
   of that PM's finished side sessions, or the cascade keeps the PM. `--waiting` names what waits on the Owner. The script only
   decides: it keeps a session that is not yours, an Architect, not asserted done, waiting, has a PR not MERGED or CLOSED,
   cannot be verified clean and pushed, shares a worktree with a session that stays (yours included), or whose side session
   is unfinished. A list of 200 entries may be cut short and plans nothing: re-list with a larger limit. Report mode is the
   same command without `--owner-yes`; a missing script means REPORT, not archive.
4. **Brokers.** A PM stops its own seats' brokers first: `node scripts/doctor-orphans.mjs --reap --owner self`. After the
   archive, run the doctor again with no flag: a broker whose owner session is now GONE carries a stop line; run exactly those
   lines. In report mode run the doctor with no flag only. A missing doctor means say "brokers not checked". It refuses any
   process it cannot prove is a broker; never `kill` or `pkill` by hand and never touch another session's.
5. **Archive.** Call the host archive tool once per `archive[]` id, with a reason. The host asks for explicit agreement per
   session; the Owner's standing yes is that agreement for the sessions the plan lists. The host cleans up the worktree and
   also archives the entry's `alsoTaken` side sessions. If it refuses because a Remote Control client is attached (the plan
   flags `needsRemoteControlOff`), turning Remote Control off for that session is part of the archive ONLY where the Owner's
   standing yes says so; then retry once. Otherwise KEEP the session and report "needs Remote Control off". A refusal for live
   work keeps it.
6. **Receipt**, in the closeout message: every archived session (name and id), every kept one (name, id, why), the brokers
   stopped (pid and pid file), the doctor's report, and any Remote Control action.

**Codex gate seats** run through the gate runner, never the Claude `openai-codex` plugin, so they leave no broker
(`core/GATES.md` § Codex seats and brokers).
