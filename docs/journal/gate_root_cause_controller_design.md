# Gate root-cause controller — contract

## Intent

Keep one repair changeset on one sequential round history across refreezes, require structured
root-cause and adherence evidence before the standing round authority is used, and keep the
user-installed `/orchestrate` package byte-identical to workflow-kit's source.

The controller is a cooperative-agent control, not hostile-evasion security. Authors still declare
semantic sameness (`finding_class`, `ownership_area`, and whether a repair introduced the harm).
The program enforces continuity, evidence shape, exact references, and allowed transitions; it does
not infer those semantic judgments.

## Authority and storage

- The first Round-1 row establishes a global one-to-one `task_id` ↔ `changeset_id` identity. A
  concurrent relabel is append-adjudicated first-wins; its losing row never becomes authority.
- Machine state lives under the Git common directory, outside every review worktree and frozen
  artifact. A review packet therefore cannot leak earlier verdicts through the candidate diff.
- State is an append-only JSON-lines ledger plus a derived transition check. Every accepted event is
  fsync'd. Corrupt, truncated, symlinked, non-regular, or transition-invalid state fails closed.
- A candidate is a SHA-256 over a sorted regular-file manifest of repo-relative path plus Git blob
  ID. Refreezing changes the candidate, never the changeset or round count.

## Events and transitions

1. `round_disposition` is sequential: its round must equal the previous round plus one, and it binds candidate,
   finding IDs, declared class/ownership/trigger, disposition, and repair-introduced/new-scope flags.
   Round 2+ also binds the exact preceding repair-brief receipt and every threshold authority event.
   A new candidate may not lower, reset, or close a round that was never authorized.
> ⚠ **Items 2–5 below describe the ORIGINAL design and are superseded on their round positions.**
> Every fixed round number here — Round 3 as a trigger, the Rounds 4–6 unlock, the after-round-6
> audit, the Round 9+ extension — was DELETED when the cadence became circular. Read them as the
> record of what was built; the postscript at the end of this file has what replaced them. This
> notice sits HERE, beside the claims, because a correction at the tail does not reach a reader who
> stops at item 5.

2. Two consecutive declared same-class NO-GOs, Round 3, or a declared repair-introduced harm in the same
   ownership area, moves the derived state to `root_cause_required`. The sensor compares declared
   fields exactly; semantic near-matches remain the PM's judgment.
3. `root_cause_exit` is accepted only while root cause is required and carries the shared mechanism, why
   prior fixes were symptoms, owner/state/yield seams, one replacement, removed workarounds, and a
   discriminating trigger matrix. It unlocks Rounds 4–6.
4. `adherence_audit` binds Round 6's candidate and records separate PASS results for
   Rule #1, gate accounting, and root-cause discipline. All three PASS unlock Rounds 7–8.
5. `owner_extension` records the Owner-authorized extension needed for Round 9+. It is an auditable
   declaration, not a programmatic proof of human identity.
6. `repair_dispatch` exists only for `REMEDIATE` and binds one persisted repair brief's path,
   byte hash, size, candidate, findings, paths, root exit, audit, and Owner extension. The PreToolUse
   brief guard validates the attempt but creates no controller authority. After the write,
   `confirm-repair-brief --confirm` reads the regular non-symlinked in-repo file itself and returns
   the receipt ID; caller-supplied hashes are never trusted.
7. `worker_verification` is written only by explicit `--verify`. It binds the exact receipt and
   current candidate to one explicit hook session. The already-registered source-write guard then
   rechecks current brief bytes and every target against the receipt's authorized paths.

Active authorized-path ownership is derived globally across every accepted program in the common
ledger. A latest NO-GO owns each exact path it authorizes until a later GO closes that program. A
lane relabel, including an empty task declaration, cannot release that ownership: the owning task's
current verified session is required. Multiple active owners of one exact path fail closed, while a
different task remains free to write unrelated paths. A task that is itself in active repair still
cannot write outside its own authorized set.

Root exits, adherence audits, and each Owner-extension kind are also append-adjudicated first-wins.
Concurrent identical retries converge on the winning ID; incompatible losers return a typed
conflict and are never derived as authority.

Every actionable repair is persisted as a brief before any cross-session send. A repair-class send
is denied; later status-only sends may point to the already persisted brief. Direct status sends
remain available but carry no worker authority. A worker writes
`{"task_id":"…","repair_dispatch_event_id":"…","session_id":"<current hook session>"}` and runs
`node scripts/confirm-repair-brief.mjs --verify verify.json`. A missing session receives a specific
remediation instead of a generic malformed-event error. The write guard refuses a missing, changed,
deleted, symlinked, stale-candidate, wrong-session, or unauthorized-path receipt before every
tool-mediated source write; task-lane, sidecar, and repair-brief creation remain bootstrap-safe.
Shell writes remain an explicitly disclosed bypass. Gate-result
recording repeats that byte check. A crash before confirmation creates no authority; a lost
confirmation response is recovered by an idempotent retry.

## Gate-time and installation rules

- The gate manual, decision-time hook, and `/orchestrate` skill all use the same early root-cause
  triggers. Early recurrence enters analysis; it does not mint a cap-exempt frontier firing.
- Local `npm test` checks the real user installation when that package exists. A clean CI host with
  no user installation skips that environment-specific rung; unit tests still cover drift, install,
  symlink refusal, and missing-target behavior.
- A release touching the canonical `/orchestrate` package is incomplete until the user installation
  is synchronized and the real-target parity check passes.

## Discriminating controls

- Same task, changed changeset ID before close: reject. Same changeset, lower/repeated round: reject.
- Same changeset relabelled to another task, including concurrent Round-1 attempts: exactly one wins.
- Candidate digest with a missing or mismatched manifest: reject.
- Pre-write allow without a file, and changed/deleted/symlinked bytes after confirmation: reject.
- Source write before typed worker verification, from another session, against stale candidate/brief
  bytes, or outside exact authorized paths: reject in the registered Claude and Codex write guard.
- Relabel or clear the task lane while another active program owns the target: reject. An unrelated
  target remains allowed; two active programs claiming one target fail closed.
- Round 4 without the recorded structured exit, Round 7 without the three-part audit, and Round 9
  without the extension event: reject at both brief dispatch and gate-result recording.
- A repair-shaped brief declared `build`, or a repair sidecar declared `status`: reject. A plain
  status update remains allowed but cannot produce a repair authorization receipt.
- Two declared same-class NO-GOs and a repair-introduced harm each enter root-cause-required; a
  different declared class does not get inferred as equivalent.
- Real installed-package drift makes the local required rung red; synchronization makes it green.

## 2026-08-18 · Doctrine moved to the circular cadence — enforcement reconciliation BANKED

`core/WORKFLOW.md` § Gate and `skills/orchestrate/SKILL.md` now state the round/root-cause cadence as
the canonical **circular method**: cycles of at most three harm-bearing rounds; a soft-stop root
assessment plus one bounded remediation, whose NO-GO bookend is the next cycle's round 1; a process
audit on the exact bytes after two completed cycles, whose GO buys one additional two-cycle window and
whose NO-GO (or window exhaustion) returns to the Owner. The absolute round count still never resets.
Authority is the canonical procedure (`docs/gates/ORCHESTRATOR_GATE_PROCEDURE.md`), reread live.

The enforcement machinery this document specifies — `repair-dispatch-state.mjs`, `guard-brief-rung.mjs`
deny strings, `record-repair-event.mjs` — is UNCHANGED here and still gates on the ABSOLUTE round-number
model described above (round ≥ 4 exit, round ≥ 7 audit, round ≥ 9 extension). It remains live and
internally accurate; doctrine and enforcement therefore diverge until the banked successor chip
reconciles the machinery. That reconciliation is the immediate next chip and carries the **§ 7 split**:
the cadence DENY/UNLOCK semantics (the round ≥ 4 / ≥ 7 / ≥ 9 gating) are DELETE candidates, because
software must not encode the cadence; the SEQUENCE/ORDERING checks (one sequential round history,
refreeze invalidates prior receipts, exact-reference and single-writer binding) are § 7-allowed and
STAY. Until it lands, doctrine and enforcement diverge on ROUND POSITION. Two of the machinery's gates
key on FIXED absolute rounds the circular cadence does not: the adherence audit hardcoded at after-round
6 to reach round 7, and the Owner extension at round ≥ 9. The root-cause-exit gate is NOT purely fixed —
it fires at `(nextRound >= 4 || triggerRound > 0)`, so whenever a root trigger has fired (even before
round 4) its trigger-sensitive half TRACKS the cadence (root assessment on a mechanical trigger); only
its round-≥4 floor is fixed. So the successor chip's § 7 split KEEPS that trigger-sensitive half and
deletes the fixed round positions. Because the cadence's cycle and audit boundaries fall at a VARIABLE
absolute round — a cycle can be shorter than three rounds on an early root trigger — the two fixed gates
misalign, bounded and BIDIRECTIONAL. UNDER-enforce, in short cycles: two 2-round cycles complete by
round 4, so the cadence's process audit is due around round 5, but the machinery requires none until
round 7 — it permits a round 5→6 repair the cadence would have gated. OVER-gate, in full three-round
cycles: the machinery demands an after-round-6 audit to reach round 7, which a cadence-following agent
whose audit falls elsewhere can satisfy only by producing that after-round-6 audit — auditing bytes the
cadence did not choose. There is no round-7 Owner-escalation escape: the extension gate is checked only
at round 9, and that round-9 gate is itself fixed while the cadence's window-exhaustion return-to-Owner
lands at a round that varies with cycle length, so the two align only incidentally. Neither direction
lets a DEFECTIVE ARTIFACT reach GO — artifact GO is a separate human judgment the machinery never
decides — but the process-audit and continuation TIMING are not strictly fail-safe until the successor
chip removes these fixed round-number gates. This is the successor chip's motivating harm, not merely
cleanup.

## Postscript — what the successor chip found when it tested the divergence

The paragraph above was written from a reading of the code. The successor chip executed it, and the
record is corrected here rather than left for the next reader to re-derive.

**The over-gate direction reproduces.** `recordAdherenceAudit` accepted an audit only at
`after_round === latest.round`, and only an `after_round === 6` audit unlocked round 7. A repo whose
cycle boundary fell elsewhere had its own audit refused outright — `audit@4` and `audit@5` both
returned `repair-audit-invalid` against a latest round of 6 — and could reach round 7 only by
minting an audit over bytes its cadence had not chosen. That is the harm this note named, and it is
real.

**A stronger reading was tested and did NOT reproduce.** A review panel escalated the divergence to
a DEADLOCK: that once `latest.round` reached 7 the required audit became unmintable and rounds 8+
were refused forever. Walked by execution — r1–r3, root exit, r4–r6, audit@6, r7, audit@7, r8,
Owner extension@8, r9 — every step passed. The `after_round === 6` audit persisted in derived state
and was never re-demanded after round 7, exactly as the code comment beside the lookup claimed. The
premise cannot be constructed either, because round 7 was unreachable WITHOUT that audit: the state
the deadlock needs could only be arrived at through the event that resolves it. A cross-family
review confirmed this independently, walking the concurrency, idempotent-replay and task-relabel
paths as well.

So **"bounded and bidirectional" stands as written** — the divergence mis-timed the process audit
and the continuation gate; it did not strand a repo. The credit still belongs to the panel: the
claim was wrong and the instinct was right. It forced the walk that produced this evidence, and the
walk found the defect that mattered more than either reading — `rootTriggerRound` fired on
`v.round === 3`, a fixed absolute position sitting inside the trigger this note had described as the
cadence-tracking half. That one was invisible to a reading of the gates alone.

**All of it is now moot by deletion, which is the point.** The fixed round positions are gone: no
round number gates a repair, the audit and the Owner extension remain recordable as evidence and
unlock nothing, and the root-cause exit follows only the two mechanical triggers. A divergence
between a doctrine's cadence and a machine's arithmetic cannot mis-time what the machine no longer
counts.
