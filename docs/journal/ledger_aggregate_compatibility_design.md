# Ledger aggregate compatibility — pre-code design

**Tier:** T2 gate machinery. **Base:** Workflow-Kit `16a4804a6b1a94ccaf7b979e31a553a6c3e6af76` / tree `1f4a698b921c2ed459512e5fb39cc8babacb5fa4`.

## Intent and Rule #1 harm

An adopter's append-only repair ledger contains 13 correctly hashed rows. Three rows use event names minted by an experimental aggregate controller: `panel_close`, `evidence_rerun`, and `child_continuation`. Current Workflow-Kit rejects every unknown event name while reading, so the whole ledger becomes unavailable. Its write guard then denies unrelated product work.

The harmed targets are product functionality and Owner usability: valid historical evidence makes the repository unwritable even though the current controller neither needs nor should trust those three rows. Deleting/resetting the ledger or working from a separate Git common directory would erase or evade the subject and is forbidden.

## Smallest replacement

Keep one append-only ledger and split event recognition into two sets:

- **authoritative/writable:** the current seven controller event types;
- **read-only compatibility:** exactly `panel_close`, `evidence_rerun`, and `child_continuation`.

The physical parser accepts either set only when the stored SHA-256 event identifier matches the canonical event bytes. Before its result crosses the existing `readRepairEvents` boundary, it projects only authoritative rows; derivation and every existing consumer therefore retain the current output shape. The append path continues to accept only the authoritative set. The recorder remains unchanged and therefore cannot mint a compatibility event. Each row identifier hashes only that row's event; this ledger has no parent-tip hash chain.

This is deliberately not an aggregate-controller implementation. Compatibility rows create no round, finding, dispatch, worker, owner, close, scope, or path authority. Arbitrary unknown types, malformed JSON, wrong hashes, partial final lines, symlinks, and unreadable files remain fail-closed.

After adoption, an old standard `NO-GO / REMEDIATE` program may still truthfully own paths. Releasing it is a separate append-only operation using the existing eligible `owner_extension{authority_kind:"close"}` plus `repair_close`; this patch does not auto-close or reinterpret it.

## Zoom in / zoom out / KISS

**Zoom in:** the defect is one reader predicate conflating “event I do not execute” with “ledger bytes I cannot authenticate.” The repair separates authenticated preservation from execution authority.

**Zoom out:** Workflow-Kit is a multiplied-radius control. Importing the stopped aggregate controller would add a new panel/state machine and its unresolved gate history merely to read three historical row types. The compatibility set is smaller, portable, reversible, and leaves the later bounded-controller successor as a separate changeset. No product code, adopter ledger bytes, doctrine, recorder API, store, daemon, migration, or authority is added.

## Acceptance and discriminating controls

1. A synthetic 13-row ledger with valid standard history interleaved with the three compatibility types loads without byte changes; `readRepairEvents` returns only the standard projection and derived state is identical with and without those rows.
2. Compatibility rows for the same task/changeset and hostile-looking authority fields remain inert: no path owner, round, dispatch, worker, extension, or close changes.
3. Public append/record surfaces refuse all three compatibility types. A mutation that admits them to the writable set turns this control red.
4. An arbitrary fourth unknown type or one corrupted compatibility event hash makes the ledger unavailable.
5. Partial-line, malformed-JSON, symlink, concurrency, and first-wins controls remain green.
6. A normal standard REMEDIATE still owns its exact path and denies an unrelated task. An eligible standard close releases it; an admitted-worker/self close remains refused.
7. In the adopter, the unchanged real 13-row ledger loads, then the standard append-only close releases the obsolete F-B ownership. No row is edited or deleted.

## Bounds and delivery

Owned source is `hooks/repair-dispatch-state.mjs`; owned evidence is `tests/repair-dispatch-state.test.mjs` plus this design and a concise implementation record. Target is at most +20 net controller lines, +90 net test lines, and 1,200 words across the two new records. No dependency or lockfile change.

Run the pre-code Gemini design lens before source writes. After implementation: focused controller tests, full `npm test`, diff/doc checks, cold panel, independent code gate, PM disposition, then Owner push-GO. Adoption into the product repo and its ledger close happen only after the upstream candidate is gated. No product, config, deploy, or live-data action is authorized by this design.
