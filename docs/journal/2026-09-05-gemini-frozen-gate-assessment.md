# Gemini frozen-candidate gate: incident and options assessment

Date: 2026-09-05. Status: Owner authorized direct API implementation; all live API calls held for separate approval.
Write lane: Workflow-Kit only. Base: `5e3058627c058159cf27603d1e853260caeb4d6d`.
Branch: `codex/gemini-frozen-gates`.

## Incident and measured causes

The Owner's LLMPB incident names base `3b5d6450ac1187d882965b3e11305fc4ef98e8a4`, candidate
`8b406e8e62ec17ab5dfed11c636e0136408d91c5`, tree `96dfee4c423c1bd49d32980248060e8ae6b0d057`.
Read-only Git inspection in this assessment verified the candidate object, exact tree, and 16 changed
files. The ticket reports a roughly 374 KB projected payload, an initial `No uncommitted code changes
to review.`, then headless command denial and `FAILED_TOOL`. Those error receipts are ticket-supplied;
this assessment did not repeat a paid review or send LLMPB material to a provider.

The kit runner's `freeze_artifact` seeds a private index from caller HEAD, stages the working tree,
then creates a synthetic commit and temporary detached worktree. Code-mode scope derives from that
working-tree projection. It does not accept an exact committed base/candidate tuple. The transport
branch uses inline content up to 81,920 bytes, then asks the agent to read a temporary file with
`--add-dir`. That is why freezing a committed candidate requires manual work and large payloads
encounter a tool permission boundary. The current inline path also runs in the frozen repository;
it gives the agent ambient context even when the payload itself is inline.

A new synthetic transport probe tested installed Antigravity CLI 1.1.27 in an otherwise empty
scratch workspace. The workspace custom agent declared `tools: []`, `commandExecutionPolicy: off`,
empty MCP/skills/plugins lists, and prohibited tool use. The runner started in plan/sandbox mode,
with slash expansion disabled, in streaming-input mode. No user message or repository payload was
sent. The startup event identified the requested agent but advertised `run_command`, `view_file`,
`write_to_file`, `call_mcp_tool`, browser operations, and `invoke_subagent`, among others. Therefore
this configuration does not remove access tools. The process was terminated after startup inspection.
The result disproves this candidate isolation mechanism; it does not claim that every possible future
Antigravity configuration is incapable of isolation.

A separate zero-call startup error rejected `--effort medium` for `Gemini 3.1 Pro (High)`.
The corrected probe omitted that incompatible flag. Model/effort bindings must be validated rather
than blindly adding a generic effort option. No global Gemini settings, permissions, credentials,
or adopter files were changed.

## Astra's smallest-change answer

Repair the existing gate entrypoint and slice machinery; do not create a skill. Assemble the exact
Git-object artifact locally, then send bounded inline text through a transport that exposes no tools.
The supplied artifact must include the full changed-source coverage, its diff, and frozen contract
and invariants. Reuse the existing receipt and ordered-slice concepts. A workflow instruction cannot
repair a missing endpoint argument, prevent silent truncation, or remove tools the runtime exposes.

The originally attractive plan to retain `agy` with an empty custom tool list failed the live
preflight. Do not implement that plan as if prompt restrictions were a security boundary. The
smallest remaining candidate is a direct Gemini text-generation API request with no tool
configuration or function-call execution loop. This retains the Gemini family while removing the
agent harness. Credential/billing authorization is a separate Owner decision; do not extract the
Antigravity login, inspect credential stores, or silently charge an API account.

| Option | Assessment |
| --- | --- |
| Native exact base/candidate support | Required. Read immutable Git objects; avoid manual worktrees and caller-tree snapshots. This alone does not fix oversized delivery or ambient tools. |
| Oversized file/stdin delivery through current agent | FILE requires access tools. Streaming stdin fixes transport size but does not establish reliable ingestion above the verified ceiling or remove tools. Reject as a standalone fix. |
| Existing approved slices, automated execution/finalization | Preferred coverage mechanism. Bind plan and receipts to repository/base/candidate/tree; preflight every complete inline envelope; run in order and finalize once. Do not mistake a slice GO for a release GO. |
| Direct Gemini API, no tools | Preferred transport if authorized. Same different-family lens, explicit API billing/credential boundary. Live proof is still required; no fake-provider test can certify it. |
| Retire Gemini code mode entirely | Existing default already limits Gemini to design review, with code mode a deliberate escape. Retiring the escape does not solve the request. Claude can preserve different-family code review where available; Astra/Terra cannot silently replace Gemini with equivalent decorrelation. |

## Proposed contract and controls

- Exact lowercase 40-hex base, candidate, and expected tree; verify commit types, base ancestry,
  candidate tree, repository root/common Git identity. Disable replacement-object/external-diff/textconv
  influence. Pin caller endpoint state and revalidate before transmission and release finalization.
- Assemble from Git objects only, including complete text of new/changed files and old deleted content.
  Reject dirty required inputs, escaping paths, symlink/submodule/binary inputs that cannot be reviewed
  under the supported contract, and known secret patterns. Secret scanning is a bounded detector,
  not a proof that arbitrary text contains no private information. Standard review-artifact exclusions
  must be explicit and must not hide source changes.
- Keep prompt, contract, invariants, canaries, receipt, completion instruction and content together
  strictly below the verified inline ceiling. No environment variable may raise a gate above it.
- For oversized artifacts, validate a complete deterministic approved slice plan before the first
  call. Full content must not disappear behind per-file limits or diff-only fallback. Oversized
  individual files need declared complete ranges or a refusal; do not silently invent partial coverage.
- Preserve full ordered coverage and a final cross-boundary review. Boundary selection is a PM
  judgment; a byte-union test cannot certify semantic interface coverage. Plans that cannot fit
  required boundary context must fail before calls. Ordinary execution should be one invocation
  consuming the approved plan and finalizing it automatically.
- Each slice is explicitly NOT A RELEASE RECEIPT. Aggregate validity requires all ordered,
  non-duplicated, candidate/plan-bound receipts, a final boundary review, and verified endpoint state.
- Preserve random canaries, EOF receipt, completion token, explicit single GO/NO-GO and checked
  inspected scope. Empty, conflicting, malformed, incomplete, denied-tool and timed-out responses
  remain NOT A VERDICT with nonzero exit.
- Cache provider/rig failures against effective transport/model/configuration identity. Candidate
  changes alone must not trigger repeated calls against an unchanged broken rig. Expose explicit
  recovery after a relevant condition changes; never cache a failure as GO or endlessly auto-retry.
- No service, permission system, controller, event family, parallel release ledger, shell allow-rule,
  dangerous permission flag, or implicit provider substitution. Backward-compatible legacy inputs
  remain where they do not conflict with the new frozen contract; document limits honestly.

## Gate and authority plan

This changes gate semantics and portable machinery: T2; admission class 2 (silent failure), also
classes 3 and 4. The ticket explicitly authorizes local design, Terra implementation, tests, local
commits and prescribed reviews, and reserves final publication and material scope/credential decisions.
The implementation and its operating instructions are inseparable at T2.

Mandated rungs: `core/WORKFLOW.md` Steer/Gate (pre-code contract lens, deterministic checks, cold
panel, cross-family lens when available, external adversary, Owner push-GO);
`core/REVIEW.md` Decorrelation (two assigned angles plus a free adversary, input/pre-loaded record);
`core/WORKFLOW.md` Core-document amendments (gate-machinery adversarial walk-through and final
wording sign-off); `core/GATES.md` Routing (Gemini design lens, Claude code gate for Codex build).
Use cold workhorse seats at standard effort; bound aggregate repairs by the existing four-round
policy. Do not substitute a same-family seat for unavailable Claude without Owner authorization.

Test matrix: clean committed review; wrong tree; changed endpoint; inline and oversized payloads;
complete ordered plan and finalization; missing/malformed/duplicate/reordered slices; headless denial;
empty reply; missing/conflicting verdict; receipt/canary/scope mismatch; timeout; no Git mutation or
unrelated content; no broad permissions; unchanged rig failure makes no repeat call; and installed
adopter-layout execution. Run full `npm test` and the Gemini deterministic harness before paid gates.

## Adoption and current stopping point

No LLMPB edits. After a kit release is authorized and lands, update through Workflow-Kit's normal
installer with gate runners enabled. Because existing runner files change, follow the installer's
normal forced-update/backup procedure, preserve generated adopter bindings, inspect the actual diff,
and verify execution in the adopter layout. Installation is not activation or live gate proof.

The Owner selected direct API implementation in this task. No live API calls are authorized. The
pre-code Gemini lens is unavailable under the verified CLI restriction and API hold; record that
T2 omission explicitly under core/REVIEW.md Cross-family lens. No implementation candidate exists
yet and no push-GO is requested.
Target base is pinned above; final candidate/tree must be supplied only after implementation, full
verification, and the prescribed reviews.

ACTION-SCREEN: failed `tools: []` startup restriction leaves access tools active, directly violating
the requested no-ambient-access behavior. The smallest action is to select a tool-free transport
before implementation, preserving the existing slice/finalization machinery. Adding a skill or
widening command permissions would not fix that located failure. KISS rejects either detour.

## Sources

- Local code: `scripts/cold-review-gemini.sh`, `scripts/gemini-gate-slices.mjs` at the pinned kit base.
- Owner's attached incident ticket and read-only LLMPB Git object checks.
- https://antigravity.google/docs/cli/headless/ (streaming startup metadata and input).
- https://antigravity.google/docs/subagents (documented custom-agent tool list).
- https://antigravity.google/docs/cli/permissions/ (workspace access and permission defaults).
