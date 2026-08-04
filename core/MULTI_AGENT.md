# MULTI_AGENT — delegation, shared checkouts, the task-lane declaration, and onboarding

> **CLASS: BINDING** — read it whole; missing a section means violating a rule without knowing.
> **Kit v1.0** (portable). Companion to `core/OPERATE.md`, which governs how ONE agent runs a change.
> Split out of `core/OPERATE.md`. **Delegation, Multi-writer checkout and Onboarding moved verbatim.
> Two things did NOT: § Task-lane declaration was REWRITTEN when the build lane was retired, and the
> Onboarding read order gained `OWNER_COMMS.md`. Both are recorded in `core/README.md` § Provenance.**

## Delegation — Gather / Review / Author
Subagent use *inside* the tiers; changes no tier, no gate. Classify by effect on **authoritative detail** (the shipped artifact + the facts a decision rests on):

| Role | Dir | Owns | Fan out |
|---|---|---|---|
| **Gather** | context in | nothing — conclusions + pointers; source stays authoritative | freely (non-authoring) |
| **Review** | verdict in | nothing — findings; PM dispositions | freely (non-deciding — IO) |
| **Author** | artifact out | the shipped artifact | **no** for live-path / T2 / T3 — in-thread |

**Retention guarantee.** The authoritative build of anything that can carry a *silent degenerative bug* never leaves the Builder's context: (1) no load-bearing fact may exist only as an agent's summary — if it gates a decision, touches the corpus, or rides the live-behavior path, the Builder reads raw source/diff and re-derives it; (2) authoring of T2/T3/live-path code stays in-thread; agents author only T0/T1 work, which the Builder re-reads raw and owns.

**Rule:** Gather + Review → delegate freely; Author → keep, gated by tier. Delegation never raises a tier, substitutes for a mandated gate, or lets a summary stand for a source — it front-loads Steer (classify with full context) and thickens Gate (more cold checks, earlier).

## Multi-writer checkout — surgical staging only
*Canonical for ALL agent lanes writing one checkout. The repo entry stubs (`CLAUDE.md` / `AGENTS.md`) summarise these; this is the authoritative text.*

Two agent lanes (Claude Code + Codex) write this checkout at the same time; agents (not the
Owner) do the committing.

1. **NEVER blanket-stage:** no `git add -A`, `git add .`, or `git commit -a`. Stage explicit paths your
   task touched — nothing else.
2. **Verify before every commit:** run `git status`; every staged file must belong to YOUR task.
   Unexplained dirty files are the other lane's in-flight work — never stage, stash, revert, or edit them.
   If YOUR task needs a file the other lane has dirtied, STOP and ask the Owner — never interleave two
   lanes in one file.
3. **Substantial concurrent work → private worktree under `/tmp`** (never inside the checkout). When
   unsure whether the other lane is live, use the worktree — fail closed. Commit early and often there:
   `/tmp` is purged on reboot; only commits survive it (main object store).
4. **Merge + test in the worktree, never in the shared checkout:** merge the shared branch INTO your
   worktree, install deps there (`npm ci` if the merge touched `package-lock.json` — a clean install of
   exactly the merged lockfile), run the full `npm test` THERE, and only then land the merge on the
   shared branch. The shared checkout's foreign dirty files make any test run there unrepresentative.
5. **Dependency changes are single-lane:** while a `package.json`/lockfile change is in flight, no other
   lane writes the repo. A lockfile CONFLICT → keep the conflicted lockfile and run `npm install`
   (it resolves the markers, preserving pins); never hand-merge or delete-and-regenerate.
6. **Pushing the deploy branch auto-deploys to the live service.** Only a T0 docs-only push is GO-free; ANY
   push containing code — and any T1–T3 push, code OR instruction — needs the Owner's push-GO first
   (framework: "Pushing is a separate axis"). A push ships the WHOLE branch, including the OTHER lane's
   unpushed commits: before any push, check `git log origin/main..HEAD` for ungated work from ANY lane.

## Task-lane declaration — the binding fact
*The optional cost-inversion build lane was **RETIRED** by Owner ruling — **authoring is in-thread**.
What the route carried, what was dropped with it, and what survived generally: `core/README.md`
§ Provenance.*

- **A declaration is required and fails closed.** It binds session id + kebab task id and names
  exactly one route; undeclared, malformed, stale, or session-mismatched ⇒ **BLOCK**. The hook
  enforces the declaration; it never classifies semantics (IO).
- **Two routes exist — `in-thread` (with the tier) and `exempt` (with a ledgered reason).**
  A third, `lane`, belonged to the retired build lane and is **REFUSED by both controls with an
  explicit `lane-retired` state** — at write time and at commit time; the block says the route is
  RETIRED and points back here. History: `core/README.md` § Provenance.
- **Escapes are first-class** (`codex-down` / `codex-quota` / `trivial-edit`) — work never stalls on
  an unavailable seat. **An exemption declares the TIER too, and it never skips a gate:** the reason
  names which review SEAT is unavailable, which says nothing about how risky the work is — so build
  in-thread, still run the tier's normal cold pass (substituting seats per `core/REVIEW.md` § External
  gate), and ledger the escape. No free-text reason is accepted, and an exemption whose tier is
  missing OR invalid BLOCKS.
- **Gated decisions are ledgered, and the ledger FAILS CLOSED.** A gated decision appends its exact
  path with an append+sync write; concurrent processes may duplicate a row but can never replace
  another process's row. **Symlink traversal and any ledger-write failure BLOCK** — so no route, an
  exemption included, can proceed unlogged. **A PERMITTED write's row also carries a
  `declarationHash`** — a digest over the declaration's canonical fields — so the Owner can spot-check
  which exact declaration authorized a write, and a declaration edited mid-task shows as a new hash.
  Rows for BLOCKED writes carry no hash. **The tier is also in CLEAR TEXT, because a hash is not a
  tier of record to the human reading these rows:** a permitted exemption's row carries `tier`
  (`in-thread` already states its tier inside `state`), and a row blocked for a bad exemption tier
  carries `declaredTier` — the value that was REJECTED, absent from the row only when the declaration
  truly carried no tier at all. That distinction is what keeps "no tier" and "a tier I refused"
  separable when spot-checking; both forms of block are otherwise identical rows.

## Onboarding a new model
*To plug a new model into a role, bind it in `BINDINGS.md` and give it the role's access: a **reviewer**
needs repo read access + the role's payload + its own review credential; a **Builder** additionally
needs write/push/deploy access, the repo identity ritual, and the maintenance-window mechanic
(`BINDINGS.md` § Access). The gate machinery is model-agnostic.*

- **Read in this order:** repo **identity** (`CLAUDE.md`/`AGENTS.md`) → **method**
  (`FOUNDATIONS.md` → `WORKFLOW.md` → `REVIEW.md` → `ARTIFACT_CLASS.md` → `OPERATE.md` →
  `MULTI_AGENT.md`) → **bindings** (`BINDINGS.md`) → **architecture snapshot** (`SYSTEM_MAP.md`) →
  **owner comms** (`OWNER_COMMS.md`) → **runbook** → **current-state / open-work**.
- **The four gate types:** **mechanical** (a deterministic health check, must be 0-FAIL) · **cold
  panel** (fresh **blind** same-family agents — artifact + invariants + claimed tier, never the build
  conversation) · **cross-family lens** (a different-family reviewer) · **external** (an independent
  reviewer, handed the code + the design-as-contract).
- **Reviewer payload:** the artifact + the standing invariants files + the claimed tier — never the
  build conversation. The **folded** pass also gets the prior same-family findings; the **free pass
  gets none** (+ a redacted contract — see `REVIEW.md` § Decorrelation).
- **Access categories to credential:** the **repo** (remote + identity) · the **deploy target** (how it
  deploys; the write-gate; the maintenance-window mechanic) · the **review tools** (the cross-family
  CLI / key). Specifics in `BINDINGS.md`.
