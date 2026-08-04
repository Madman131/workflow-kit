# PROTOCOLS — the rules, and the incident each one cost

Word budget: 2000 (author-set at first release — no Owner ruling names a number for this file; its
own number, never summed with its body). **The number moved from 1300 to 2000 before shipping**, as
the bank absorbed a further round of banked incidents; that is the initial number still being set,
not a ratchet being loosened, and it is disclosed rather than quietly rewritten. **From this release
it is a ratchet: raising it again is an Owner call.** Deliberately NOT split — a bank is a flat list
whose only seam is the section headings it already has, and two half-banks would be two files to
forget instead of one to read.

Reference layer for `.agents/skills/orchestrate/SKILL.md`. Read it before writing a brief: one that
omits any of these hands the worker the incident again.

⚠ **Read these as anonymised illustrative lessons, not as receipts.** Each came from a real program,
but anonymising strips what § Evidence discipline demands of an observation — a named artifact — so
these are shapes to recognise, not evidence you can check. **A rule here is load-bearing once your
own repo gives it an artifact.** That is the same standard, applied to itself.

## Freeze and the panel
- **Freeze compliance is PANEL-ENFORCED, not willpower.** Three separate changesets edited the
  artifact while seats were live before the rule stuck; each disclosed it, and disclosure is not a
  control. Give every seat the frozen SHA and have it verify that SHA itself.
- **ENVIRONMENT is a decorrelation axis**, alongside family and charter. One changeset ran four
  independent seats that all shared the author's temp-directory regime; a defect visible only in the
  other regime survived all four. Vary a seat's rig, or run the mechanical rungs twice.
- **Vary the installed LAYOUT too.** A sensor was inert in every adopted repo — it resolved a
  sibling path that exists only in the source tree. Four rounds missed it because every observer
  stood in the one tree where the bug is invisible.
- **A bounded continuation past a soft stop needs BOTH halves:** pre-commit that round N is the last
  whatever it says (which stops verdict-chasing), AND carve out the one severity that can never ship
  under that bound — a fail-open in a shipped control stops the PR and escalates (which stops the
  bound becoming a loophole).
- **When ONE class survives repeated rounds, diagnose PLUMBING or CONCEPT before re-fixing.** If the
  recurrence is bespoke logic sitting beside the real grammar, relocating it INTO that one shared
  grammar may resolve the duplicate-logic objection — then RE-EVALUATE the original objection, since
  the shared grammar can carry the same defect; if the concept is wrong, no relocation saves it.
  Two NO-GO rounds on one class is the trigger to ask, and the adjudication is the orchestrator's.

## Seats and runners
- **Pass the model and effort EXPLICITLY; never inherit a runner's default.** A gate runner shipped
  a default one tier above the effort its own doctrine named as standard, so anyone who simply ran
  it gated at the exception tier believing they were at the norm. Announce what you passed.
- **Every round carries a fresh random receipt the seat must echo**, and the seat verifies the
  FROZEN SHA itself rather than being told it. A receipt proves the reply completed; it says nothing
  about whether a decision was stated, so require an explicit verdict and an inspected-scope line
  too, and fail closed when either is missing.
- **A warm delta round may write no thread sidecar of its own** — chain every resume from the
  ORIGINAL cold round's sidecar, and refuse an empty id rather than silently starting a new thread.
- **A cross-family seat returning a tool-failure with a DIFFERENT denied tool each attempt MAY be
  agentic drift** — changing sandbox policy, runner state or a genuine missing prerequisite produce
  the same shape, so the pattern does not settle the cause. Either way record it as "unreliable
  here", never "categorically unavailable", cap the retries, and receipt them. **Never widen tool permissions to buy a green
  rung** — that trades the gate's meaning for its colour.
- **A read-only seat cannot execute the suite.** Its "tests fail" may be a COVERAGE judgment, not a
  result — read the receipt, not the label, and always pair it with a seat that executes.
- **Deviating TOWARD a repo's stricter contract, over a non-Owner instruction to do the looser
  thing, is correct** — and is disclosed, not done quietly. When the conflict is with an OWNER
  instruction it is not yours to resolve: surface the contract and consult.

## Evidence discipline
- **The raw-look habit: any verification returning "absent", "zero" or "clean" earns ONE look at the
  raw material before it is believed.** In one changeset four CHECKS were broken rather than the
  things they checked — a grep returning zero on a line-wrapped phrase, a probe inferring mechanism
  from outcome, a probe pair differing in two variables, and a mutation canary grepping for a string
  its test runner never prints.
- **The dead-sensor canary: never accept "did not reproduce" without proving the checking mechanism
  was LIVE.** Paired trap: a mutation runner must verify its ANCHOR EXISTS and report
  ANCHOR-MISSING as an outcome distinct from SURVIVED — they mean opposite things, look identical,
  and the failure flatters the author into deleting a "useless" assertion.
- **An observation NAMES THE ARTIFACT it was observed on; anything without one is a HYPOTHESIS,
  whoever wrote it.** The recurring failure is a claim phrased in the register of an observation.
- **One variable per probe.** A canary proves the MECHANISM is live, never the ATTRIBUTION: a probe
  pair that differed in two ways was reported as evidence for one of them.
- **A probe observes the control's OWN SIGNATURE, never infers mechanism from outcome.** A guard's
  ledger row is its signature; "the file is absent" is not — the write had failed for an unrelated
  reason. A model's narration of WHY something failed is not evidence about the mechanism either.
- **"Absence is not evidence" applies to BOTH verdicts, not only the flattering one.** A probe
  reported NOT ARMED against provably-blocking hooks because the write was never attempted. A false
  alarm is not the safe direction: told a working control is dead, an adopter switches it off.
- **Audit the RIG before the CONTROL when a verdict surprises you.** A rig LACKING a property real
  repos have, or GAINING one they lack, mints confident findings about the control that are findings
  about the rig. Both directions were observed one release apart.
- **A doc-pinning assertion is decoration until you strike the EXACT PHRASE and watch it go red** —
  if the spelling occurs innocently elsewhere in scope, the assertion pins nothing. Mutate the
  phrase, assert the sentence, never the word.
- **Run suites under a scratch temp directory, and under BOTH regimes** (inside and outside any
  allow-listed scratch root) — or pin the sensitivity. A suite green under one regime proved the
  rig, not the suite.
- **`installed · registered · RUNS-in-the-adopter-tree`, each proven by execution.** Presence and
  registration are the two lies shipped one release apart.
- **Read pipeline exit codes honestly.** `$?` after a pipe is the LAST command's status, and under
  `pipefail` an early-exiting consumer can poison a producer's status. Three misreads in one chip.
- **"Byte-identical" is a claim about INSTALLATION, not execution.** Two copies proven identical can
  still fail in one location and not the other; only running each where it installs settles it.
- **A fix DESCRIBED as "mechanical" invites execution without re-verification.** One banked
  "mechanical" substitution would have cured a single false version stamp by rewriting two TRUE
  historical claims into false ones. Re-derive the fix from the artifact before believing the word.

## Shipping and merging
- **The upgrade instruction is DERIVED PER RELEASE from what the diff actually EDITS.** Verbatim-
  file edits make a forced re-install mandatory; a new-files-only release makes it FORBIDDEN — there
  it buys a version stamp and destroys hand-authored generated content while exiting 0. Execute both
  directions. To break a CLI contract, break it LOUDLY: exit non-zero, name the flag and version,
  carry the remediation — while tolerating the old config KEY so an existing adopter is not bricked.
- **If an artifact must ship at exactly its budget, flag the NUMBER to the Owner.** Zero headroom
  pressures the next editor to raise the cap rather than cut. It is a state you may inherit under a
  parity constraint; it is never one you mint on a new artifact.
- **Proving a change landed has TWO forms, and using the wrong one fails in the direction that
  looks safe.** A true merge: the head is an ancestor of the target. A SQUASH merge: the PR state is
  MERGED *and* the tree matches the squash commit — "ancestor-of" is permanently false there.
- **On any merge-command error, check PR STATE FIRST.** In a worktree layout the local branch-delete
  step can fail AFTER the remote merge succeeded; read that as "merge failed" and you double-merge.
- **If the harness blocks a merge or push, STOP and report the exact command to the Owner — never
  route around it.** Merging locally and pushing reaches the same irreversible target by a side
  door: a BIGGER action than the one refused, not a smaller one.
- **Consent is never automated.** Knowing where a peer tool's trust grant lives never licenses
  writing it — that is forging consent through a quieter door. Arm by documentation plus a probe.

## Coordination
- **A sole-writer check reads the repo's LANE DECLARATIONS — main checkout and every worktree —
  never the session list**, which reports liveness and not intent. A repo was two-writer while a
  session-list check called it clear.
- **Repeat a ruling that matters; messages CROSS.** Long worker turns delay queued messages, so a
  ruling can arrive after the decision it governs. Restate it in the next message rather than
  assuming delivery — and when a worker's premise contradicts yours, re-verify before ruling: the
  worker may have fresher Owner contact than you do.
- **Pin every head by SHA, never by "the branch"** — a chip's branch forks mid-life when a hotfix
  is cut. Name the head you HAVE and re-verify it immediately before writing about it: composing a
  long message takes long enough for the head to move. **And when two sources disagree, FIRST check
  you asked them the same question** — a "three endpoints, three answers" contradiction turned out
  to be one observer comparing two different branches.
- **A new chip MAY be seated in a prior chip's worktree.** Before removing one, run the OCCUPANCY
  CHECK: tree-equality and a merged branch prove the TREE is done, not the DIRECTORY unoccupied.
  **The check must GATE the removal — refuse, never merely report.** The decorative form was shipped
  once: it printed a count of 1 and removed the tree anyway.
- **Residue ritual at chip close:** prune, enumerate remote branches from the SERVER (a local mirror
  listing is not the server), delete merged ones, and sweep processes — including any whose working
  directory names a deleted worktree. **Enumerate every worktree you CREATED, scratch registrations
  included**: a throwaway checkout registered against the shared repo outlives the session silently
  and is missed by otherwise exemplary residue reports. **A sweep's count excludes the sweep's own
  pipeline** — its grep included, or the count is self-manufactured.
- **Killing a task strands its children.** ~140 orphaned test processes accumulated across one
  program, some days old, degrading the machine. A post-kill process sweep joins the ritual.
- **A `pgrep -f`-shaped waiter MATCHES ITS OWN SHELL'S ARGV**, so "still running" is
  self-manufactured — it never errors and looks exactly like a hang. The same self-match in a
  residue SWEEP manufactures PHANTOM residue instead. Wait on the captured PID, and resolve any
  count to real PIDs before believing it.
