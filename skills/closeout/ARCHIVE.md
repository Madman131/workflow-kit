# Archive step — the last act of a closed chip

Word budget: 450, whole file. Reference layer for `.agents/skills/closeout/SKILL.md` § 7. A finished thread's Claude process and
its Codex plugin brokers stay resident until the session is archived; one host reached 36 Claude processes and 24 orphaned
broker trees (3.2 GB) that way.

**Who archives what.** A PM archives each session it started once that session's work is landed, verified and has nothing
left to do. An Architect archives each PM it started once that PM's chip is closed out: landed, verified, digest written,
no unpushed work, nothing waiting on the Owner. Never the Architect thread, a session you did not start, unpushed work, or
anything the Owner is waiting on.

1. **Authority.** Archive only when your instructions carry the Owner's standing yes for it; an adopter's Owner must grant
   it, and you never infer it. Without it, do steps 2–4 and 6 as a REPORT and archive nothing.
2. **Host.** Get the session list (`list_sessions`) and your own id (`get_session self`). A host without session tools, and
   a Codex lane (it has no archive tool), REPORT what it would archive and say why it did not.
3. **Plan.** `node scripts/archive-plan.mjs --sessions <list.json> --me <your id> --done <id>… --waiting <id>… --owner-yes --json`.
   `--done` is YOUR assertion that the session is landed, verified and finished; `--waiting` names what waits on the Owner.
   The script only decides. Each guard KEEPS a session: not started by you, you, already archived, an Architect, not
   asserted done, waiting, PR open, unpushed or unverifiable work, and a side session it would take with it that is
   unfinished. Leave `--owner-yes` off to get the same plan as a report. A missing script means REPORT, not archive.
4. **Brokers first.** For each planned session, stop the Codex plugin brokers its seats left:
   `node scripts/doctor-orphans.mjs --reap --cwd <each packet dir it ran seats in>` (or `--stop --pid-file <file>`). The
   doctor refuses any process it cannot prove is a broker; never `kill` or `pkill` by hand and never touch another
   session's. With no flag it reports.
5. **Archive.** Call the host archive tool once per `archive[]` id, with a reason. It cleans up the session's worktree and
   also archives its `alsoTaken` side sessions. A refusal (mid-turn, live background work) keeps that session: record it.
6. **Receipt**, in the closeout message: every archived session (name and id), every kept one (name, id, why), the brokers
   stopped (pid and pid file) and the doctor's report.

**Codex gate seats** run through the gate runner, never the Claude `openai-codex` plugin, so they leave no
broker (`core/GATES.md` § Codex seats and brokers). A plugin seat used anyway stops its own broker on return.
