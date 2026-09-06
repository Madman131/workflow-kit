# Gemini change-attribution successor contract

Parent: `6b95b2f546d705ab63a4584575e8aab4dcf18856` (the receipt-preservation terminal commit).
This is a narrow frozen-runner correction: no new skill, framework, transport, provider action, or
semantic-boundary automation.

## Measured receipt and disposition

Live plan `02334ddaa43200c2d3aa134feca1ba532cea42b16c9b1a3dbe890937faaa687a` recorded three
`PASS_VERDICT` slice receipts followed by `coverage-004` `NO_GO`; it made no later call and no
aggregate. The two inherited-control claims in that reply were declined: the Owner-comms Stop hook is
an explicit fail-open sensor, not a control, and the other inherited limitation did not become a
candidate-introduced harm. The journal remains evidence and is unchanged by this successor.

The accepted process defect was attribution: a source-only fragment prompt allowed an unqualified
NO-GO for any visible inherited limitation, even though its packet supplied no exact transition bytes.

## Corrected rule

The normalized scope names every frozen review a `base..candidate_change` gate. Fragment scopes bind
`exact_per_file_diff_transition_evidence`. A valid NO-GO needs concrete reachable harm introduced or
worsened by changed diff evidence, newly exposed or relied upon by the candidate, or a false candidate
mitigation/public claim. Unchanged inherited limits are `PREEXISTING/NONBLOCKING` only. A source-only
fragment with no exact transition evidence cannot establish attribution by itself; a later diff or
final slice still may. Candidate exposure, worsening, reliance, or a false claim remains blocking
regardless of the underlying limitation's age. This is deterministic: after exact scope and receipt
verification, a source-only `NO-GO` becomes `FAILED_CANDIDATE_RESPONSE` before a durable verdict;
full and diff-bearing packets retain ordinary valid-NO-GO handling.
