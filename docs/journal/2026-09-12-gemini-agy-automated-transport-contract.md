# Automated frozen Gemini subscription transport contract

**Date:** 2026-09-12
**Tier:** T2 — changed provider-transport and gate-emission semantics
**Baseline:** `b1d5b40236eef3170bf6e3f981dc6a6d7672e2d3` · `VERSION` `2.31.0`
**Release rule:** derive the next minor from the verified implementation head; `2.32.0` is only the
expected result while this baseline remains current.

## User-visible outcome

An exact frozen Gemini candidate normally receives its subscription review automatically through
`agy`. Strict manual web export/import remains an explicit fallback for high-sensitivity work or an
automated-transport refusal. Neither route may use a REST/API path, an API credential, or a billing
credential.

The automated route remains a review transport, never work authority. A receipt-verified verdict,
its scope, and the existing gate disposition rules still decide whether work may proceed.

## Non-negotiable automated transport shape

`agy` is an agent harness with tools available, not a no-tools cage. The implementation must not
claim that a sandbox flag removes its ability to attempt tools. Instead, each invocation must:

1. Create a fresh, empty, disposable directory and launch from that exact cwd. It may not launch
   from a repository or reuse a prior workspace.
2. Send exactly one complete NDJSON stdin user packet. No review material may appear in an argv
   prompt.
3. Pass the subscription sandbox, disable slash commands, and require `request-review` permission
   behavior. It must select `gemini-3.1-pro-high` and `high` effort explicitly.
4. Never pass a repository cwd, `--add-dir`, `--new-project`, project-selection option, prompt argv,
   broad permission bypass, or an equivalent indirect escape.
5. Snapshot the disposable workspace before launch and compare it after teardown. It must also check
   the designated frozen review checkout before and after the flight with the existing endpoint
   cleanliness and exact base/candidate/tree controls, excluding only sanctioned journal and
   `.gemini-gate` artifacts. Any frozen-checkout mutation is a transport failure, not evidence of a
   review; it does not inventory unrelated worktrees, shared `.git` state, or the whole repository.

The runner must parse its settings before launch and require the request-review posture, no
non-workspace access, and no permissive allow-list. It records the resolved `agy` version, cwd,
settings fingerprint, exact model, and invoked effort in the receipt. It refuses any observed stream
value that differs from the requested value; supported `agy` 1.2.2 may omit `effort` from `init`, so
that field is invocation evidence unless the provider emits it.

## Fail-closed stream and process boundary

The stream contract permits only the documented initialization, user-input, agent-response,
checkpoint, and final-result shapes needed for one review. Unknown, malformed, duplicated,
out-of-order, or incomplete events refuse. A tool call, tool output, subagent event, denied action,
or execution-like field refuses even if a later final message looks valid. Stderr is failure, as are
nonzero exit, signal termination, timeout, output overflow, cwd/settings/version/model/effort
mismatch, mutation, malformed receipt, scope mismatch, canary mismatch, verdict-shape mismatch, or
completion-token mismatch.

The public entrypoint retains the existing per-repository single-flight supervisor identity,
parent-loss handling, and stale-owner recovery. It retains ownership while its child is active and
through verification and record emission. The runner owns only its launched process group. One
always-executed owned teardown path runs after verified normal success and every abnormal path. On
timeout, interrupt, overflow, or abnormal exit, it sends scoped TERM then KILL and waits for group
closure; on every path it verifies the disposable workspace and frozen-checkout endpoint/tuple/tree,
then releases the existing per-repository single-flight ownership. Cleanup removes only the
runner-created disposable workspace and owned temporary records; it never uses process-name killing
or broad cleanup.

Each provider response stays buffered until owned group closure, disposable-workspace verification,
and frozen-checkout endpoint/tuple/tree post-flight checks all pass. Only then may the runner append
that invocation's durable result. It aggregates only after every result is accepted and the final
endpoint check passes. A failure preserves typed diagnostic evidence but cannot emit a release
verdict or a partial durable result.

## Frozen-candidate invariants

Automated subscription transport preserves the existing exact tuple: base commit, candidate commit,
and tree must match at every preflight, launch, and final-record boundary. It preserves the approved
slice plan, plan hash, selected slice order, normalized scope, and ordered canaries. Endpoint
rechecks and cache identity remain tuple- and rig-bound. Durable receipts remain complete,
checksummed, replay-safe records with reply identity, transport/model/effort/settings identity,
scope, verdict, and completion proof.

Attribution semantics do not weaken: only the existing full/slice aggregation rules may produce a
gate verdict; a source-only NO-GO, incomplete reply set, malformed reply, or unresolved attribution
remains non-release evidence. The single-flight lock remains shared with all Gemini routes.

## Manual fallback and no-credential boundary

Manual export/import is preserved unchanged as an explicit strict fallback, not a silent reroute.
The operator supplies numbered UTF-8 replies through the existing import path, which rechecks the
frozen tuple, plan, packets, ordering, scopes, replies, endpoint, canaries, verdict, and completion.
Selecting manual mode is required for high-sensitivity work when automated `agy` is not appropriate.

No code path reads, accepts, logs, or forwards an API key, bearer token, REST endpoint credential,
or billing credential. The subscription transport is not allowed to fall back to direct REST, and a
missing subscription capability is a typed refusal rather than a credential prompt or retry.

## Acceptance and adversarial matrix

| Case | Required proof |
|---|---|
| Valid automated review | Fake `agy` emits the exact allowed stream, matching cwd/settings/version/model, canaries, valid verdict, and terminal completion; effort is pinned in argv and receipt although 1.2.2 may omit it from `init`; one durable subscription receipt is accepted. |
| Tool/subagent/denied action | Each event shape independently fails closed, retains a non-verdict diagnostic, and tears down only its process group. |
| Process/output failures | Stderr, nonzero, signal, timeout, and overflow each refuse and prove scoped teardown plus workspace cleanup. |
| Boundary mismatch | Wrong cwd, settings, version, model, or present effort, tuple, tree, scope, plan/hash/order, canary, verdict, or completion each refuses before a gate receipt. |
| Mutation and malformed stream | Disposable-workspace mutation, frozen-checkout mutation, malformed/unknown/duplicate/out-of-order event, and malformed receipt each refuse. |
| Transport hardening | Invocation inspection proves no repository cwd, directory/project option, prompt argv, broad permission bypass, or API-key path. |
| Version drift | Contract tests characterize supported `agy` `1.2.2` behavior and reject incompatible drift from historical `1.1.27`; no historical assumption silently passes. |
| Installed parity | Source and initialized-adopter runners execute the same fake-`agy` matrix and produce equivalent acceptance/refusal behavior. |
| Supervisor and receipt order | Fake-provider parent loss retains the existing supervisor recovery semantics; a delayed or failed post-flight check proves no durable result or aggregate verdict precedes verification. |
| Manual fallback | Export/import still accepts a complete valid manual reply set and rejects ordering, tuple, scope, canary, verdict, or completion drift. |
| No live provider | Tests use fake `agy` only. Live subscription eligibility, provider quality, and activation require separate Owner authorization and are not established by this chip. |

## Implementation bounds

Implementation and fake acceptance perform no live frozen-candidate or production-gate activation, no
credential setup, and no unbounded provider-credential test. This contract is transmitted through the
standing, bounded, non-sensitive pre-code Gemini design review under PM authority; that review is not
production activation. After its completed, validated verdict, implementation may amend the current
manual-only invariant in `core/REPO_INVARIANTS.md` and add the smallest runner, receipt,
installer-parity, and fake-transport tests needed to satisfy this matrix; it must not weaken manual
export/import or broaden provider authority.
