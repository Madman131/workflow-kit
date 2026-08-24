# Ledger aggregate compatibility — implementation record

**Base:** `16a4804a6b1a94ccaf7b979e31a553a6c3e6af76`
**Frozen code candidate:** `7ebef764a35cd0dd3e94c81b7a5530cc966a9d6e` / tree `814a72d43132602325cac1adfa1f9c54787348e7`

The candidate changes only `hooks/repair-dispatch-state.mjs`, its focused test, and the design/reporting records. Controller delta is +9/-2; test delta is +42. Focused tests passed 36/36, full `npm test` passed 216/216, `git diff --check` was clean, and the unchanged adopter 13-row ledger projected eight standard rows while preserving its old standard path owner.

## Aggregate gate round 1 disposition

`GATE ROUND 1 · changeset ledger-aggregate-compatibility · verdict NO-GO · HARM-PASSING 1 · NOTES 2`

1. **WK-LAC-E1 — direct reader assertion missing — REMEDIATE (evidence only).** HARM: a future implementation could move filtering downstream while the test still clears, exposing compatibility enums to direct `readRepairEvents` consumers. REAL: the mixed-ledger assertion currently checks `loadRepairEventsForProject(...).events.length`, not the public reader result. SCOPE: exact acceptance boundary. WORTH IT: one direct assertion. TRIGGER: the mixed 13-row fixture must prove `readRepairEvents(ledger).length === 10`; a downstream-only filter must turn the control red.
2. **WK-LAC-S1 — contract-only slice omitted code — DECLINE.** The slice was explicitly non-release and selected only the contract/invariant files; the approved coverage union assigns implementation and tests to other slices. Its claimed missing-input harm is not real for a bounded slice set.
3. **WK-LAC-N1 — standard append proof — NOTE.** The free reviewer independently appended a standard event after a compatibility row and preserved the prefix. Existing standard append controls plus that frozen probe show no functionality harm; no extra candidate machinery is warranted.

Two code-mode packet attempts were rig-invalid and count-free: one reviewed only the temporary invariant file; one full review used the non-crediting oversized FILE route. Neither changed candidate bytes. The approved bounded plan is `8c149a51830c12faae90a6bb8830bdd8c0c755385892fc36f31ffa629b094b8b`. Controller and cross-boundary slices were GO; evidence was NO-GO only for WK-LAC-E1. The contract-only NO-GO is declined above. One consolidated evidence repair is authorized; no controller or authority change.

**LADDER: continue to the single Round-1 evidence repair, then refreeze and rerun the original trigger plus affected gates.**

## Final affected-gate bookend

`GATE ROUND 2 · changeset ledger-aggregate-compatibility · verdict GO · HARM-PASSING 0 · NOTES 2`

Gemini slice-set receipt `PIL-GATE-1787596317-34457-541327995` binds approved plan `a0bf5c81136ad579213f76e9f7cf6f4c6a58062147eb9cb3eacafbb65662d55b`; both the public-reader and cross-boundary slices are GO. Its two suggestions are NOTES: a `null.length` TypeError still turns parser rejection red rather than falsely passing, and the existing downstream derivation/path-owner assertions prevent a wrong ten-row projection from clearing. The exact downstream-only-filter mutation failed `13 !== 10`. Focused tests passed 36/36 and full `npm test` passed 216/216.

**LADDER: aggregate GO; stop for Owner push-GO.**
