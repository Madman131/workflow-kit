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
