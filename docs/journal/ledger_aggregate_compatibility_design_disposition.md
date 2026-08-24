# Ledger aggregate compatibility — pre-code design disposition

**Gemini receipt:** `PIL-RCPT-7268e8cbd33ceeaed28fecfb` · design artifact `fb3b9872c5f11e4b28f7b4db1a874023e38e0c3c` · verified ingestion canaries `PIL-INGEST-0134c8e0619d`, `PIL-INGEST-0241925ee075`.

`GATE ROUND: PRE-CODE LENS · changeset ledger-aggregate-compatibility · verdict GO · HARM-PASSING 1 · NOTES 0`

1. **Claimed hash-chain corruption — DECLINE.** HARM target asserted: repository writability. The trigger fails at its mechanism: the ledger has no parent/tip field or chain check. `eventId(event)` hashes only the canonical bytes of that event, and `appendRepairEvent` never reads a prior event identifier when constructing a new row. Filtering a compatibility row cannot create the claimed broken link.
2. **Reader output-shape change — REMEDIATE in the design.** HARM: an unchanged direct consumer could encounter an event enum it does not handle. TRIGGER: a valid compatibility row reaches `readRepairEvents`' exported result. The bounded correction validates all physical rows internally, then projects only standard rows before the existing reader boundary. This preserves the public/internal output shape while retaining fail-closed hash validation.
3. **First-winner rewrite — DECLINE.** HARM target asserted: repair authority. The trigger is unreachable in the current controller: compatibility types share no standard transition key, are not accepted by its append path, and never participated in its standard first-winner rules. Validating then omitting them cannot make a later standard row win a transition they previously occupied.

**Rule #1 / zoom / KISS:** only finding 2 names a reachable consumer harm, and one boundary projection resolves it. No recorder change, chain mechanism, sequence model, aggregate state machine, ledger edit, migration, or product change is warranted.

**LADDER: continue to bounded implementation.**
