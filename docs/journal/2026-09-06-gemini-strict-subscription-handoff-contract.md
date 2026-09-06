# Strict manual Gemini subscription handoff — successor contract

Parent: `94db69748f8a0bfbf38d9d6b62adc8ffce578e36`. Its terminal subscription
review plan `36be53d6fad10412da0ed0dced9ee98f2a41e696d29c219486d6718a59cf5e37`
ended at call `coverage-011` with durable `NO_GO`; the preceding source-only
`coverage-003` observation remains historical evidence. The Owner supersedes
the automated frozen transport decision with a strict manual Gemini
subscription handoff.

The frozen runner still assembles and verifies the exact base, candidate, tree,
approved plan, fragment coverage, envelope cap, inspected scope, ingestion
proof, response completion, attribution hold, and durable receipt rules. It
never starts `agy`, reads provider settings or credentials, or calls a REST
provider. Export writes the exact packets for an operator to submit through the
chosen Gemini subscription UI. Import accepts only the matching, complete,
non-symlink handoff state and exact UTF-8 replies, then reuses the frozen
verifier and receipt sequence. The UI/model selection is operator-attested;
the runner cannot cryptographically verify a browser or provider identity.

An approved source-only `NO-GO` stays `UNRESOLVED_ATTRIBUTION` and cannot end a
prefix. A later diff-bearing or full verified `NO-GO` ends the ordered prefix
without an aggregate. All replies with unresolved observations end in
`ATTRIBUTION_HOLD`; they never create a release GO. Reusing a completed
Handoff-ID, altered packets, tuple, plan, endpoint, or reply set refuses before
journal mutation. This is a strict handoff procedure, not a new skill, service,
controller, ledger, or automatic provider path.

If a process stops after complete slice receipts but before its terminal record,
the same Handoff-ID may retry only after those records exactly match the ordered
expected prefix; import appends the remaining expected records. A mismatched,
extra, out-of-order, or incomplete prefix still refuses.
