# Frozen committed Gemini review contract

## Intent and scope

Extend the existing Gemini gate command to review exact committed candidates without worktree
projection or model access to tools. The frozen path uses the Gemini REST API; legacy design/working
tree paths remain explicitly legacy. No service, skill, permission framework, controller, parallel
release ledger, provider substitution, global permission change, or adopter mutation is in scope.

## Inputs and artifact

The frozen public invocation accepts exact lowercase 40-hex `--base`, `--candidate`, `--tree`, a
nonsecret `--rig-id`, and candidate-relative contract context. Reject symbolic refs, incorrect object
types, tree mismatch, non-ancestor base, repository identity change, replacement-object influence,
unsupported entries, and dirty/untracked source state except sanctioned gate artifacts and the existing
review journal. Freeze and recheck the initial checkout endpoint before any provider call and before
finalization; a new checkout endpoint requires a new invocation. Neither a clean checkout nor a
branch name substitutes for the supplied object tuple.

Read Git blobs and no-external-diff/no-textconv diffs directly from the exact endpoints. Include full
new/changed files and deleted old content, full applicable diff, portable and repository invariants,
and candidate-bound contract context. No synthetic commit, private-index staging, checkout switch,
uncommitted projection, truncation, or diff-only fallback. Reject binary/non-UTF8, symlink, submodule,
unsupported type/rename states, escaping paths, and known secret patterns before transmitting.
Review-history exclusions must be explicit; never exclude ordinary source merely because it is large.
Secret detection is bounded and supplements scoped human authorization; it cannot certify arbitrary
text as nonprivate.

## Transport and completion

Use Node native fetch to a fixed official HTTPS generateContent endpoint, with a validated Gemini
model ID, redirects refused, a bounded timeout, one candidate requested, text contents, and no tools
or function-call execution loop. Read the API key only for authorized live execution; do not log,
hash, expose, or recover credentials. Dry-run and deterministic tests never read credentials or call
a live provider. Model access to the source repository, filesystem, shell, browser and MCP is absent.
Returned tool calls are errors, never executed. Require exactly one response candidate, STOP finish
reason, and text-only content. Refuse empty or interrupted output.

Instrument the entire supplied review content with random ordered canaries, an EOF receipt, and a
response completion token. Validate those plus one unambiguous GO/NO-GO and the claimed inspected
scope bound to this artifact/slice. A completion marker alone is not a verdict. A valid NO-GO is a
completed review but is not a passing release gate; failed verification remains NOT A VERDICT.

## Size and slice plan

The complete serialized request including prompt, metadata, full contract/invariants, source/diff,
canaries and receipt instructions must be strictly below 81,920 bytes. No environment override may
raise that gate bound. A full payload above it requires a complete manifest. The measured fragment
coherence successor supersedes this contract's earlier decline of automatic range generation: its
narrow native DRAFT generator mechanically partitions exact source/diff bytes by measured envelopes,
but never claims cross-boundary semantic coverage or approves a plan. See
`2026-09-05-gemini-fragment-coherence-successor-contract.md`.

Extend the existing v2 slice-plan contract with exact candidate/tree fields in the frozen path.
Bind plan identity to repository/base/candidate/tree and all reviewed bytes. Preserve complete scope
union, uniquely named coverage slices, and exactly one final cross-boundary slice with declared
boundary coverage. Fingerprinting/preflight checks every complete envelope before approval/execution.
Boundary coverage remains a PM judgment backed by full selected content, not a property certified by
hashes. Missing, malformed, duplicate, reordered, incomplete or mismatched plan/receipt input refuses.

The ordinary approved-plan execution is one `cold-review-gemini.sh` invocation with the exact tuple,
context, manifest and `--run-slices`. It validates, executes each coverage slice in order, runs the
final cross-boundary review and finalizes once. Each individual slice is non-release. Only a complete,
ordered, tuple/plan-bound, verified aggregate can constitute a full gate. A valid slice NO-GO is
durable evidence and stops execution before any later call or incomplete aggregate.

## Durable state and retries

Use the existing Gemini review journal for attempts and aggregate receipts. Record transport,
nonsecret rig ID, exact tuple, plan/slice identity, payload identity, inspected scope and verdict.
A partial run or interrupted journal append cannot become a complete aggregate. Do not publish
success until endpoint and receipt validation is complete. Concurrent runs must not mix slices.

Cache classified auth/provider/transport/tool/timeout unavailability by effective nonsecret
transport/endpoint/model/rig identity so changing a code candidate does not repeat an unchanged
broken-provider call. Candidate-specific delivery/verdict failures may be cached only against that
candidate/plan/slice/payload identity. An explicit changed rig declaration after a real configuration
or availability change permits recovery; no automatic retry loop or cached failure becomes GO.

## Acceptance and residuals

Deterministic tests must exercise the public entrypoint and installed layout; clean committed input;
wrong tree and changed endpoint; inline and oversized multi-file paths; complete ordered finalization;
all missing/malformed/duplicate/reordered cases; denied tool response, empty/missing/conflicting
verdict, receipt/canary/scope mismatch, timeout, no unrelated inclusion or repository mutation,
no dangerous/broad permissions and no repeat call under unchanged rig failure.

Live Gemini API authorization is a separate boundary. Fake-provider tests prove local behavior,
not API access, billing, model availability, live ingestion or useful review quality. Legacy agent
paths do not inherit the frozen path's no-tools guarantee. No change to family-decorrelation rules.
