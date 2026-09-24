# Legacy handoff replay compatibility — Builder receipt

Base: `588593e031f822ed31df6deab1837651b1de9180` (private branch `codex/legacy-handoff-replay-compat`). Tier: T2. Source/test/contract commit: `9dcb3af666e2365cc89ed1e958155e23b3542b39` (tree `67667db3989b74880950fb4c2ee30c74009d5c87`). Contract: `legacy_handoff_replay_compat_contract.md`, SHA-256 `3d9e0c3729b39e70f297456a8ed10faddf1d33174073693a19e1837e9c347779`.

Decision: remove only the outer/parent ID equality predicate from `aggregateWorld`'s `legacy_handoff` replay branch. Keep the current public `recordAggregateLegacyHandoff` equality predicate. Historical policy 1/2/3/4 rows still need the active latest cited standard parent, Owner evidence, exact anchor/candidate/path match, identity and path collision checks, and applicable typed review. An accepted old cross-envelope policy 3 T3 child retains T3 panel strength and STOP reservation; a fresh cross-envelope T3 request is refused without append. The parent is retired at handoff; its later standard close is administrative.

Verification: `node --test tests/terminal-round-breaker.test.mjs tests/terminal-controller-hard-stop.test.mjs` passed 103/103. `npm test` passed 430/430 and all three runner rungs. `node --check` passed for the changed source and test file; authored source/test diff has no whitespace errors. The appended Gemini journal has pre-existing reviewer whitespace in the verbatim receipt and is left untouched.

Residual: ledger replay authenticates record structure and chain, not when or by whom a fully well-formed old-format row was written. Current-writer activation and cutover remain separate operational proof, per the Architect's historical-tier and R4 replay rulings. No push, installed runtime change, or live ledger write occurred in this Builder lane.

## Cold-panel R1 repair receipt

The frozen `9dcb3af` candidate received a T2 cold-panel NO-GO: a valid policy 4 separate-ID handoff could promote an unrelated policy 2 aggregate program named by the outer envelope, silently losing that program's next policy 2 panel close. The bounded correction in `c5885a4b0f6481adc63fd537d2131bdadb401c67` (tree `7b7f8e4cd62917574dc0fd7345f00b53188dac20`) keeps accepted handoff and child lineage while leaving the unrelated program's policy unchanged. A same-input disabled-arm mutant reproduces the lost close and GO. The ordinal-four separate-ID typed-review witness now covers policy 2, 3, and 4. Contract SHA-256: `37873c4c6a0e53e179fd810db89da95552fcbb83a5b67eee7825c55ab50def2e`.

Verification after the correction: focused controller suites 104/104; `npm test` 431/431 and all three runner checks green; changed source/test syntax and authored diff whitespace checks pass. The PM's raw Gemini journal receipt remains unstaged and untouched. This is a local Builder freeze for the next T2 panel, not a gate verdict, push, deployment, or runtime activation.
