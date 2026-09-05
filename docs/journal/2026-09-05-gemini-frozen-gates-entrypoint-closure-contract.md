# Frozen Gemini gate entrypoint closure contract

## Parent and scope

Parent candidate: `9ebb05cffa40508dfde0b5efb9e9d7e5f12e04fb` (tree
`6df72abe2abd541060290701dbc08e20dce0c969`). This successor stays in Workflow-Kit on branch
`codex/gemini-frozen-gates-entrypoint-closure`; it does not alter the stopped parent, canonical
checkout, adopters, provider configuration, or live API state.

## Five defect classes and action screen

1. Add the committed kit-local `core/REPO_INVARIANTS.md` required by the existing frozen payload
   contract, with truthful kit facts and no unexpanded adopter template.
2. Extend the final-material credential screen for authorization assignments, deleted forms, and
   quoted Basic authorization headers while preserving placeholder and existing detections.
3. Make `cold-review-gemini.sh` choose one explicit frozen-versus-legacy boundary covering the
   code-mode guard and legacy slice pairing, while preserving the shared lock.
4. Make shell and direct parsers reject missing or option-shaped values before routing; direct
   parsing rejects unknown options and performs no provider call on malformed input.
5. Use one locale-independent lexical path order in direct and slice validation so scope and plan
   identities normalize consistently.

Acceptance is public-wrapper behavior: frozen full dry-run, sliced fingerprint and run-slices via
the wrapper, installed-layout execution with a test-only fake provider, and the original refusal
triggers. Run focused tests, syntax/selftest, diff checks, and the full `npm test`; report any
separate global orchestrate parity result.

## Round 2 approved amendment: deterministic within-file fragments

The existing v2 whole-file path remains compatible. The direct slice mechanism may additionally
carry deterministic UTF-8-safe fragments for one frozen source blob, deleted source blob, or
per-file diff component. Each fragment binds the exact base/candidate/tree tuple, path, component
kind (`frozen_source`, `deleted_source`, or `per_file_diff`), complete component byte length and
SHA-256, byte `start`/`end` offsets, and a fragment hash. Starts and ends must be UTF-8 boundaries.

Before approval or any provider call, the validator proves that every required source and
per-file-diff component has an ordered, gap-free, non-overlapping partition whose concatenation
reconstructs the original bytes and hash exactly. Gaps, overlaps, duplicates, reordering, changed
bytes, unknown paths or kinds, tuple mismatch, and plan mismatch refuse. Invariants, contract
contexts, sources, and diffs are scanned in their complete unpartitioned form before fragmentation;
a credential spanning fragment boundaries therefore refuses before fetch. The final serialized
request for every fragment is preflighted under 81,920 bytes before credential lookup or calls.

Fragment results remain non-release. Only a complete approved ordered fragment set plus one final
`cross_boundary` slice may aggregate. Cross-boundary coverage may select explicit raw ranges from
already covered components with PM semantic sufficiency; it may not use summaries or hash-only
evidence. Existing direct transport, shared lock, timeout, response proof, durable receipts, and
rig-cache behavior remain unchanged. No cap increase, omitted required material, repository-doc
split, service/framework/controller/ledger/provider, adopter, or canonical-main change is allowed.

## Explicit declines and Owner boundaries

Keep the 81,920-byte cap, full selected source, final scan, direct text architecture, and existing
shared lock. Do not add a framework, skill, controller, lock, provider substitution, credential
access, network/model call, push, deploy, adopter change, or canonical-main reconciliation. Live
API authorization, release, push, and deploy remain Owner decisions after this local batch.
