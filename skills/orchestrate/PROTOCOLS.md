# PROTOCOLS — the rules, and the incident each one cost

Word budget: 1300 (author-set for this new reference layer — no Owner ruling names a number for it;
its own number, never summed with its body). It is a BANK: entries are added as incidents are paid
for, so the number is expected to move, and moving it is an Owner call once this one is spent.

Reference layer for `.agents/skills/orchestrate/SKILL.md`. Read it before writing a brief: a brief
that omits one of these hands the worker the incident again. Every line below is an ANONYMISED
report from a real program — the shape is the portable part, not the repo it happened in.

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

## Evidence discipline
- **The raw-look habit: any verification returning "absent", "zero" or "clean" earns ONE look at
  the raw material before it is believed.** In a single changeset four CHECKS were broken rather
  than the things they checked — a grep that returned zero because the phrase wrapped a line, a
  probe that inferred a mechanism from an outcome, a probe pair differing in two variables, and a
  mutation canary grepping for a string its test runner never prints.
- **The dead-sensor canary: never accept "did not reproduce" without proving the checking mechanism
  was LIVE.** Paired trap: a mutation runner must verify its ANCHOR EXISTS and report
  ANCHOR-MISSING as an outcome distinct from SURVIVED — they mean opposite things, look identical,
  and the failure flatters the author into deleting a "useless" assertion.
- **An observation NAMES THE ARTIFACT it was observed on; anything without a named artifact is a
  HYPOTHESIS, whoever wrote it.** The recurring failure is a claim phrased in the register of an
  observation.
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
  allow-listed scratch root) — or pin the sensitivity with a test. A suite green under one regime
  proved the rig, not the suite.
- **`installed · registered · RUNS-in-the-adopter-tree`, each proven by execution.** Presence and
  registration are the two lies shipped one release apart.
- **Read pipeline exit codes honestly.** `$?` after a pipe is the LAST command's status, and under
  `pipefail` an early-exiting consumer can poison a producer's status. Three misreads in one chip.

## Shipping and merging
- **The upgrade instruction is DERIVED PER RELEASE from what the diff actually EDITS.** Verbatim-
  file edits make a forced re-install mandatory; a new-files-only release makes it FORBIDDEN — there
  it would buy a version stamp and destroy hand-authored generated content while exiting 0. Execute
  both directions. To break a CLI contract, break it LOUDLY: exit non-zero, name the flag, name the
  version, and carry the remediation — while still tolerating the old config KEY so an existing
  adopter is not bricked.
- **Proving a change landed has TWO forms, and using the wrong one fails in the direction that
  looks safe.** A true merge: the head is an ancestor of the target. A SQUASH merge: the PR state is
  MERGED *and* the tree matches the squash commit — "ancestor-of" is permanently false there.
- **On any merge-command error, check PR STATE FIRST.** In a worktree layout the local branch-delete
  step can fail AFTER the remote merge succeeded; read that as "merge failed" and you double-merge.
- **If the harness blocks a merge or push, STOP and report the exact command to the Owner — never
  route around it.** Merging locally and pushing reaches the same irreversible target by a side
  door: a BIGGER action than the one refused, not a smaller one.
- **Consent is never automated.** Knowing where a peer tool's trust grant lives never licenses
  writing it — that is forging consent through a quieter door. The arming path is documentation plus
  a verification probe.

## Coordination
- **A sole-writer check reads the repo's LANE DECLARATIONS — main checkout and every worktree —
  never the session list**, which reports liveness and not intent. A repo was two-writer while a
  session-list check called it clear.
- **Repeat a ruling that matters; messages CROSS.** Long worker turns delay queued messages, so a
  ruling can arrive after the decision it governs. Restate it in the next message rather than
  assuming delivery — and when a worker's premise contradicts yours, re-verify before ruling: the
  worker may have fresher Owner contact than you do.
- **A new chip MAY be seated in a prior chip's worktree.** Before removing one, run the OCCUPANCY
  CHECK: tree-equality and a merged branch prove the TREE is done, not the DIRECTORY unoccupied.
  Resolve every live session's working directory and refuse to remove an occupied tree.
- **Residue ritual at chip close:** prune, then enumerate remote branches from the SERVER (a local
  mirror listing is not the server), delete merged ones, and sweep processes — including any whose
  working directory names a deleted worktree.
- **Killing a task strands its children.** Roughly 140 orphaned test processes accumulated across
  one program, some days old, degrading the machine. A post-kill process sweep joins the ritual.
- **A `pgrep -f`-shaped waiter MATCHES ITS OWN SHELL'S ARGV**, so "still running" is
  self-manufactured — it never errors and looks exactly like a hang. The same self-match in a
  residue SWEEP manufactures PHANTOM residue instead. Wait on the captured PID, and resolve any
  count to real PIDs before believing it.
