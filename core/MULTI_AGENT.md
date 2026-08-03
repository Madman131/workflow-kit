# MULTI_AGENT — delegation, shared checkouts, the task-lane declaration, and onboarding

> **CLASS: BINDING** — read it whole; missing a section means violating a rule without knowing.
> **Kit v1.0** (portable). Companion to `core/OPERATE.md`, which governs how ONE agent runs a change.
> Split out of `core/OPERATE.md`; no rule changed in the move.

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
- **Two routes are DOCUMENTED — `in-thread` (with the tier) and `exempt` (with a ledgered reason).**
  A third, `lane`, belonged to the retired build lane: **the controls still accept it — they do NOT
  block it** — and nothing here describes how to run it, so do not start new work on that route. It
  is not a hole (exact-file allowlisted · screened · ledgered · fail-closed to the strictest ladder by
  the gate-ladder sensor); its mechanical retirement is a tracked follow-up. History:
  `core/README.md` § Provenance.
- **Escapes are first-class** (`codex-down` / `codex-quota` / `trivial-edit`) — work never stalls on
  an unavailable seat — but every escape is ledgered.

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
