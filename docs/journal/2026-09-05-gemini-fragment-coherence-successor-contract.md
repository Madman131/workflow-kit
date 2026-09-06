# Gemini fragment-coherence successor contract

This successor is pinned to parent `2faff14809304e505f4a75f508e8ca6b9be60fc2`. It makes three
measured repairs to the existing frozen Gemini runner and adds no skill, framework, provider path,
or semantic-boundary automation.

## Root cause and corrected presentation

The measured `coverage-001` receipt was a valid range-bound fragment packet, but the prompt rendered
the supplied diff bytes like an unlabeled truncation. Gemini therefore issued a procedural NO-GO for
the cut hunk. Fragment blocks now state their path, component kind, complete byte length/hash, exact
half-open range, fragment hash, and whether verified offsets prove a whole or partial component. The
normalized inspected scope carries the same descriptors, `slice_kind`, and `material_mode`; a reply
must copy that exact scope. A fragment prompt says that external bytes are expected in ordered
companion slices and range cuts alone are not NO-GO grounds. Visible defects and genuinely insufficient
cross-boundary evidence remain substantive NO-GO grounds.

## Mechanical DRAFT coverage

`--generate-slice-plan .gemini-gate/<name>.json --context <candidate-context>` is a local-only
frozen-runner operation. It validates the exact tuple, reads/hashes/scans the same committed material,
serializes and measures the real envelopes, then writes deterministic coverage fragments. It neither
resolves provider credentials, calls a provider, appends a journal receipt, nor approves a plan.

Whole components fit in a fresh envelope when possible. Diff preambles and complete `@@` hunks are
kept whole when they fit; a fitting hunk moves to a fresh slice instead of being cut to occupy residual
space. An oversized source or hunk splits at a newline. Only a single oversized line may split at a
UTF-8 boundary, and every forced split is named in the DRAFT summary for PM review. Coverage remains
lexical, ordered, gap-free, and reconstructible; each generated envelope remains below 81,920 bytes.

The final `cross-boundary-DRAFT` deliberately has no selected fragments or boundary claims. It blocks
fingerprint and execution until a human selects its ranges, writes all five semantic rationales, and
removes the draft marker. Operator flow: generate the DRAFT; inspect its byte/call summary and complete
the cross-boundary selection; fingerprint; set `approval.status=APPROVED` and copy the exact plan ID;
run the approved manifest.

## Terminal NO-GO

After a valid slice NO-GO receipt is fsynced, the runner exits nonzero immediately. It does not call a
later slice, publish an incomplete aggregate, or cache the NO-GO as a transport failure. The all-GO
aggregate path is unchanged.

This supersedes the parent contract's decline of automatic range generation: the measured fragment
coherence failure showed that a narrow, deterministic byte-packing repair is needed.
