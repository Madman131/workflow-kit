# GATES — cross-family gate tool manual

> **CLASS: REFERENCE (lookup-only).** **Kit v1.0** (portable). Loaded **only when a gate actually
> runs** — grep to the section you need. It is not part of the boot read-set.
>
> **Read `## Non-negotiable gate contract` before any invocation below.** The gate *doctrine* — the
> ladder, decorrelation, free-vs-folded passes, PM dispositions and the 3-round stop — is
> `core/WORKFLOW.md` § Gate and `core/REVIEW.md`, both BINDING. This file is **how to invoke**:
> runners, flags, receipts, exit codes, traps. Missing a section here costs you an invocation
> detail, never a rule — **except `## PM disposition — riders on a DEFER`: two binding riders kept
> here for gate-time reachability (the disposition *doctrine* stays in `core/WORKFLOW.md` § Gate).**
>
> Merged 2026-07-18 from `docs/CODEX_GATE_PROTOCOL.md` + `docs/GEMINI_GATE_PROTOCOL.md`; the routing
> banner and the model·effort matrix each existed in four places and are now stated once.

## Contents
- [Non-negotiable gate contract](#non-negotiable-gate-contract) — do NOT weaken
- [PM disposition — riders on a DEFER](#pm-disposition--riders-on-a-defer) — self-contradiction escalates · behavioral defers get a labeled test
- [Routing — which family gates what](#routing--which-family-gates-what) — pick by WHO BUILT
- [Model · effort matrix](#model--effort-matrix) — change class → model · effort
- [Codex gate](#codex-gate) — what it does · how to run · rounds & receipts · retired mechanisms · traps
- [Gemini cross-family gate](#gemini-cross-family-gate) — purpose · commands · delivery vs ingestion ·
  transport tiers · finite runtime · durable records · bounded slicing · exit codes & traps

*Every subsection below sits under one of those two `##` headings; grep the heading text to jump.*

## Non-negotiable gate contract

*Repo-agnostic. Applies to every gate below, whichever family runs it.*

- **Drive it on the CODE/DIFF + the design-as-contract — NEVER an advocacy ticket as the primary artifact.** A
  ticket of "what passed / cases I pinned" anchors a false clear (correlated framing → confident-wrong GO). The
  *code* is the artifact; the *design* is the contract whose claims are hypotheses to falsify. (This is the
  single most important rule — a review framed on your own advocacy is not a decorrelated check.)
- **External gate XOR advisory lens for the same artifact — never both.** If Codex is the authority pass, don't
  also count its cheap MCP pass as the independent lens.
- **Free pass vs folded pass:** the **free/blind pass** gets the redacted contract + invariants and **no prior
  findings/verdicts/rationale** (posture-decorrelation); a later **folded pass** may receive prior findings to
  hunt the gaps. A critical/autonomous gate is NO-GO unless a genuinely free pass is named.
- **Read-only, verify-not-trust:** Codex checks mitigation claims *against the code*, never accepts them on the
  doc's word. The Owner spot-checks that the free pass was truly unframed.

## PM disposition — riders on a DEFER

*Two riders on the PM `DEFER` disposition, read at disposition time — what a legitimate `DEFER`
additionally owes. The disposition **doctrine** (the rubric, **Precedence**, the 3-round soft stop) is
`core/WORKFLOW.md` § Gate. Distinct from **Precedence** — which forbids `DEFER`ring a *confirmed
material* failure at all; these two fire on a `DEFER` that is individually legitimate.*

- **Self-contradiction ESCALATEs — never a silent PM-DEFER.** Before finalizing any `DEFER`, ask:
  *does deferring this leave the change contradicting its own stated purpose, or a named invariant it
  claims?* If yes → `ESCALATE` the fix-now-vs-defer trade to the Owner, don't PM-`DEFER` it. Scope the
  **check** to the change's stated purpose so it fires rarely, not on every deferrable edge.
- **A behavioral DEFER gets a labeled characterization test.** When the deferred item is a *behavioral*
  limitation (not a build-it-later feature), add a test asserting the **current** behavior, labeled
  `DEFERRED — not desired; see <ticket>; delete when fixed`. The label is load-bearing: unlabeled, the
  test reads as *spec* and discourages the very fix it documents; labeled, a future fix flips it visibly
  instead of silently passing.

## Routing — which family gates what

### ⚠ CODE MODE IS RESERVED — pick by WHO BUILT the change (owner decision, 2026-07-15; corrected same day)
**Design gate → Gemini** (any Builder). **Code gate, CLAUDE-as-Builder → Codex** (`scripts/codex-gate.sh`).
**Code gate, CODEX-as-Builder → Gemini IS the cross-family lens** (Codex cannot gate itself —
`core/BINDINGS.md` § When Codex is the Builder); run it with `GEMINI_ALLOW_CODE_MODE=1`. That is **sanctioned**.
`scripts/cold-review-gemini.sh` refuses an unqualified code-mode run (rc2) so the choice is deliberate.

**CORRECTION (same day, from evidence):** the first framing said code mode was *retired* because `agy` drifts.
That over-generalised from ONE drift instance and ignored the Codex ladder. The log's own tally that day was
**10 PASS / 6 FAIL**, and the dominant failure was **the verifier rejecting proofs that had SUCCEEDED** — it
demanded one exact `CANARIES:` line and a bare receipt while the payload itself presents `RECEIPT: <token>`.
One rejection literally read *"0/8 distributed canary token(s) absent ()"* — zero absent, full ingestion proven,
thrown away on line breaks. That cost a Codex thread two clean reviews and ~15 min. **Fixed** (order-tolerant
canary walk + narrow `RECEIPT:` label tolerance; both selftest-pinned, controls discriminate).

**Why — the failure is AGENTIC DRIFT, not delivery.** Three hardening passes targeted delivery
(INLINE↔FILE, argv caps, the 80 KiB ingest ceiling, receipts). Delivery was never the problem. `agy` is an
**agent harness, not a review endpoint** — `--help` exposes no way to disable tool use (`--mode plan` and
`--sandbox` restrain the loop; they do not remove it). Sat in a repo with `npm test` in reach it goes off-task:
the 2026-07-15 run **delivered its payload fine** (it quoted the frozen SHA back), then burned its entire
`--print-timeout` "executing `npm test`" and "switching the repository to the frozen SHA", never emitted the
receipt, and **confabulated test results it never produced**. The receipt caught it (`FAILED_DELIVERY`) — that is
the only reason it was not a false GO — but nothing *prevents* the drift.

**Why design mode survives:** the artifact is a document with nothing to run, and it holds this log's one
starred breakthrough (5 real issues an Opus panel missed, 2026-06-26). Code mode holds the opposite record
("the diff run found nothing useful"); its last outing returned two LOWs — one a comment nit the Builder had
already predicted, one declined — on the very change where **Codex found a BLOCKER + a HIGH that three Claude
reviewers missed**. Play each family to its measured strength.

The receipt/canary/completion-token contract below still applies **unconditionally** to design mode.


### Evidence — design mode vs diff mode
**Hard lesson (2026-06-26, crystallized):** running the **diff** reviewer on a **docs-only** changeset at a design gate
returns an unhelpful NOTHING ("docs only, SAFE") — it at most grades a tracked doc *diff* (the wrong lens), not the design
as an artifact. The **`--design`** run of the same model on the same
design caught **5 real issues a 3-person Opus panel missed** (unbounded proposal-table growth · FTS rebuild inside the
global write lock · silent dedupe data-loss · validate-vs-stamp timing break · an §8↔§12 lock contradiction). So at a
**design gate, always use `--design` + `--folded`**, never the bare diff. The lens is most valuable on the **artifact**
(design or code), with the prior same-family findings supplied so it hunts the decorrelated remainder.

## Model · effort matrix
*Change class → model · effort. The cell names a **capability tier**; the concrete model IDs are a binding (`core/BINDINGS.md`) and drift — confirm against the runtime config.*

*Lineup (GPT-5.6): **sol** (`gpt-5.6-sol`, frontier) · **terra** (`gpt-5.6-terra`, balanced workhorse) · **luna** (`gpt-5.6-luna`, fast/cheap). Effort dial `low→medium→high→xhigh→max→ultra` (`ultra` = max reasoning + auto-delegation; sol only). Claude lineup maps by role: **opus** = frontier (≈sol) · **sonnet** = workhorse (≈terra) · **haiku** = fast/cheap (≈luna). **The gate floor is the workhorse** (`terra` / `sonnet`): the fast/cheap tier never gates.*

**POLICY — DEFAULT LOW, ESCALATE ON EVIDENCE (Owner ruling 2026-07-21).** A gate that is *unavailable*
because it burned the quota is worse than an adequate gate that is *present*. Gate strength across the
whole ladder — cold panel + PM dispositions + the independent cross-family seat — never rested on
reasoning-effort alone; high effort is a rare pressure-relief valve, not the standing posture.

**SCOPE: this governs the DEV / build-review gate ladder** (gates reviewing changes to *this* repo).
**Autonomous *runtime* gates on live money — e.g. the Trader IC (`docs/claude_trader/`) — are OUT OF
SCOPE** and governed by their own subsystem design; an autonomous + irreversible + money seat is the
one place `max` reasoning can earn its cost, so it may keep a higher floor. If such a gate should also
be lowered, that is a separate reconciliation with that lane, not this amendment. So, for dev gates:

| Change class | Codex gate | Claude gate (when Codex builds) |
|---|---|---|
| **Any T2, or routine T3** (incl. reversible prod, chain/stateful) | **terra · xhigh** | **sonnet · xhigh** |
| **Irreversible prod write · money-ledger · auth/credential** (rare, catastrophic-if-wrong) | **sol · xhigh** | **opus · xhigh** |

- **`max` and `ultra` are NOT standing defaults for any dev gate.** They are **escalation-only**, and
  the trigger is concrete but is a **JUDGMENT control, not mechanical** (the round-counter hook was
  retired — round count is a conversation fact, not a tree fact): **after 2 NO-GO rounds that touch the
  same finding-class** — counted by the *recurrence of the finding*, not by whether the PM labels the
  round "contested" — the PM MUST either (a) request escalation (Owner-approved) or (b) stop-and-escalate
  the scope call. On the **Codex** side escalation raises effort to `max`; on the **Claude** side, whose
  effort is already capped at `xhigh`, it raises the *model* (`sonnet`→`opus`). Never silently grind at
  the floor — and the WORKFLOW soft-stop (round 4+) is the backstop when the judgment control is dodged.
  `ultra` is retired from standing use; Owner-invoked last resort only. *(4A ground four rounds at the
  floor; under this policy it escalates once instead — which, since review dominates gate cost, plausibly
  costs less.)*
- **The rare cell inherits Steer's classification — it is not a fresh judgment at gate time.** Whether
  a change is "irreversible / money / auth" is the *tier* decision (`core/WORKFLOW.md` § Steer +
  Owner ratification), so the strong-gate cell cannot be dodged by re-labelling at the gate; a
  mis-set tier is caught upstream where it is already governed.
- **This policy sets the CROSS-FAMILY GATE seat's model·effort, not the same-family cold panel.** The
  blind cold panel (`core/BINDINGS.md` § Roles — currently a blind Opus 4.8 panel) is the same-family
  spine, a distinct seat; whether *it* also drops to the workhorse (`sonnet`) to conserve budget is a
  separate Owner call, not folded in here.
- **The rare cell keeps the stronger MODEL at the capped effort** (`sol`/`opus` · xhigh), never higher
  effort — so the strongest gate stays on the one irrecoverable category without any `max`/`ultra`
  spend. That cell fires rarely, so it barely touches aggregate burn.
- **Escalation is a FOLDED ADJUDICATION, not a blind re-review.** The escalated pass is handed the
  contested finding PLUS the original artifact: *"`terra` rejected this for X; here is the change — is
  it right?"* Never a finding-only vacuum (it can't adjudicate a technical claim without the code), and
  never a clean-slate pass (a blind re-gate lets the stronger model silently *erase* a valid finding —
  approval-shopping).
- **Objective triggers, not vibes.** The rare cell is set by *properties of the change* — an
  **auth/credential boundary** (any diff size — a 5-line scope change can be catastrophic), **moving
  money / a ledger**, or an **irreversible prod write** — never by effort-vibes (P1: gate ∝ blast-radius).
- **Always pass `-m` AND `-e` explicitly** — never inherit the config default (`~/.codex/config.toml`
  ships `terra`/`xhigh`, so an un-pinned *build* silently runs the gate ceiling; see the builder policy
  in `core/BINDINGS.md`). The verdict record stamps `{model · effort · tier · contributing-families}`,
  each family **runtime-stamped from the model actually invoked** (`-m`/API key), not self-reported.
  The Owner spot-check covers **tier-appropriate model** AND **gate-family ∉ contributing-families**.
  ⚠ Subagent cold panels must stamp their model too — Phase 4A's panels were unstamped, so
  "was the gate model appropriate?" was unauditable from the repo. Bounded-retention (TTL / row-cap).

## Codex gate

### What it does
Codex is a **different model family** from Claude, so it catches blind spots a same-family Claude panel misses.
Two roles (pick ONE per artifact — never both for the same review):
- **External gate** — the authority review at T2/T3, *after* the same-family cold passes. Consumes the external-gate
  budget; its verdict is consumed under the project's collaboration framework.
- **Budget-free cross-family lens** — a cheap shift-left advisory read (not the
  authority). Gemini is the *default* budget-free lens; use Codex here when you want a second family cheaply.

Read-only: run it in a sandbox that cannot write code/git. Its output is a review, not a change.

### How to run
Two transports:
- **MCP tool `mcp__codex__codex`** — quick, scoped passes. Has a short per-call timeout cap (~2 min observed on this host), so keep it
  **lean and diff-scoped**; it will KILL a deep pass. Good for a fast advisory lens.
- **`codex exec` via Bash** — deep gates; **avoids the MCP per-call timeout cap** (use it for long/deep passes). Reads design + code at full reasoning. This is the
  form for a real gate. Canonical invocation:

```
codex exec -s read-only --disable code_mode_host -m <model> -c model_reasoning_effort=<effort> \
  -C <repo> -o <out_file> "<prompt>" </dev/null
```
  - `-s read-only` — sandbox: Codex may read/execute but not write. **Never** `--dangerously-bypass-approvals-and-sandbox` for a gate.
  - `--disable code_mode_host` — **keep it (defensive), but it is version-specific.** On 0.144-alpha it was REQUIRED (without it a missing helper binary killed every run). On **0.145-alpha.18 it is BENIGN, not required** — verified 2026-07-17: `code_mode_host` is a real `stable` feature (default ON), `--disable` correctly flips it OFF (`codex features list`), and runs succeed with it ON *or* OFF (foreground/background, tool-use included). It is **not** a hang cause on 0.145. Keep it as cheap cross-version insurance (a later CLI may reintroduce an eager host-spawn that misbehaves headless); do not drop it without re-verifying on the then-current CLI.
  - `-m <model>` / `-c model_reasoning_effort=<effort>` — pick per the matrix below. **Always set `-m` explicitly** — the config default drifts.
  - `-C <repo>` — run in the repo root. `-o <out_file>` — write the final agent message (the verdict) to a file. `</dev/null` — closes stdin so any inherited/piped stdin is NOT appended to the prompt (`codex exec` appends piped stdin even when an explicit prompt is supplied).
  - **Companion-plugin guard (when a Claude-companion plugin like `cc@sendbird` may be installed):** primary defense is **keep the plugin removed by default** — then a bare `codex exec` cannot be hijacked (safe by construction). It is a dev-time-only tool; install on-demand for a Codex-as-Builder session. As defense-in-depth for that window, run gates through a **guarded wrapper** that (1) prepends a fail-closed `claude` shim to PATH, (2) exports `PIL_BLOCK_CLAUDE_COMPANION=1`, (3) prepends anti-delegation hygiene. PIL implements this as `scripts/codex-gate.sh` (+ `scripts/codex-gate-guard/claude`); to port, copy both. The shim refuses `claude` while the var is set, so the companion physically cannot produce a same-family review; hygiene keeps Codex reviewing directly. **The shim is for a READ-ONLY dev gate.** An autonomous runtime cron that must stay pure-Codex (e.g. a "run the analysis in Codex" seat) should NOT use the shim — it would block the cron's own legitimate `claude` calls — but run in a **hermetic `CODEX_HOME`** (no dev plugins) so the companion can never load there.
  - **Self-timeout (fail-closed):** `scripts/codex-gate.sh` enforces a hard `-t SECS` (default 1800, or `$CODEX_GATE_TIMEOUT`). If codex stalls (20-27 min *silent* init hangs have been seen on some CLI/host states) it is killed (with its direct MCP children — codex's own TERM tears down deeper ones) and the gate exits **3** — a hang can never become an unbounded silent block. Foreground callers should pass a `-t` under their harness cap so the gate fail-closes cleanly before the harness SIGKILLs it.
  - **Launch mode matters when an agent runs the gate.** A foreground harness call is time-capped (~10 min in Claude Code) and a *plain* background task can be SIGTERM'd by a runner cap on long runs. For any **deep/long** gate, launch it **backgrounded/detached** — `nohup scripts/codex-gate.sh … &` (macOS has no `setsid`; use `nohup`, or the agent's own background-task mechanism) — and **watch the PROCESS** (`wait`/`kill -0`), not just poll the verdict file: the gate FAILS CLOSED (exit 3, no OUT) on a timeout/auth-death, so a file-only poll would hang forever — the caller-side twin of the wrapper hang this change kills. Break on process exit; treat a nonzero exit or a missing receipt in OUT as a non-pass. **Short gates run fine foreground.** (Verified 2026-07-17 on 0.145-alpha.18: single-threaded *and* 3-way-concurrent gates complete in seconds; the earlier failures were a background/runner wall-clock cap on long runs, and cross-thread Codex-session contention. Concurrent Codex gates are ALLOWED as of 2026-07-18 — see § Rounds — but two DEEP passes are still better serialised.)

### Rounds — full COLD passes vs WARM delta rounds
`scripts/codex-gate.sh` wraps the invocation above with the companion guard, a per-round receipt, and
a warm-resume mode (to port: copy it + `scripts/codex-gate-guard/claude`):

```
scripts/codex-gate.sh -o OUT [-m MODEL] [-e EFFORT] [-C REPO] [-t SECS] -f PROMPT_FILE            # FULL cold pass
scripts/codex-gate.sh -o OUT2 -C REPO [-t SECS] --resume "$(cat OUT.thread)" -f DELTA_PROMPT_FILE # WARM delta round
# deep/long gate — do not block a time-capped foreground call: launch detached, then WAIT ON THE
# PROCESS (not just the file). (macOS has NO setsid; nohup is portable; an agent may use its own
# background mechanism.) CRITICAL: the gate FAILS CLOSED (exit 3, OUT absent) on a self-timeout or an
# auth death, so a poll that only waits for OUT to appear would hang FOREVER — break on the process
# exit; a nonzero exit OR a missing receipt in OUT is a fail-closed non-pass, never "keep polling".
nohup scripts/codex-gate.sh -o OUT -m gpt-5.6-sol -e xhigh -t 2400 -f PROMPT_FILE >OUT.log 2>&1 &  # edge-cell binding; effort capped at xhigh (max = escalation-only)
gate_pid=$!; wait "$gate_pid"; gate_rc=$?   # rc 0 AND receipt in OUT = verdict; else fail-closed (see OUT.log)
```

- **Ladder shape: full COLD pass → warm delta rounds → full COLD final pass.** A warm round resumes
  the reviewer's thread (`codex exec resume`), so a fix-delta re-verdict costs a fraction of a full
  pass. Warm rounds **never substitute for the mandated cold re-run**: a warm thread accumulates the
  author's framing round over round — that is both the point (cheap deltas) and the risk (an
  anchored reviewer), so the closing pass is always cold and fresh.
- **Per-round receipt, both modes:** each invocation appends a fresh random token the reviewer must
  echo; the wrapper checks the output for the token's **presence** (tolerant — never exact-line
  matching, which false-rejects honest verdicts) and exits 3 when absent. Because the token is fresh
  per round, this also rejects a **stale `OUT`** left by an earlier run — no extra machinery needed.
  **It proves COMPLETION, not substance:** a refusal or an off-topic answer that echoes the token
  still exits 0. Nothing mechanical can judge a verdict's quality (a deterministic layer must not
  decide for the higher one) — **you** confirm `-o` holds a real, on-topic, severity-ranked verdict.
- **Thread id capture:** a FULL pass runs `--json`, reads the `thread.started` event, and writes the
  id to `OUT.thread` — cleared before every run, so **that path's** sidecar is never stale: it names
  the thread of the run that produced *that* `OUT`, or is absent. (Sidecars beside *other* `-o` paths
  are untouched and remain valid for their own runs.) Pass the same `-C REPO` on warm rounds:
  `resume` has no `-C` and would otherwise run in the invoking cwd.
- **Empty/dead ids fail loud:** an empty `--resume` (missing sidecar via `$(cat …)`) or an
  option-shaped value is refused at parse (exit 2) — a warm round can never silently degrade into a
  fresh session. A dead id makes codex exit nonzero with no verdict → exit 3; do **not** retry it
  (a resume that errors having done zero work is a dead session) — run a fresh FULL pass.
- **Ids are home-bound, not ladder-bound:** codex refuses rollouts its home doesn't hold, but an old
  *live* id from a previous ladder resumes fine. Always source `--resume` from the current ladder's
  `OUT.thread`.
- **CONCURRENT CODEX GATES ARE ALLOWED** (Owner ruling 2026-07-18) — no concurrency machinery, and
  none needed. Evidence: two gates on one `CODEX_HOME` tested head-to-head (7/7 concurrent pairs,
  including two deep xhigh passes overlapping ~2.3 min) without collision; two `codex login` homes
  also run concurrently; and on 2026-07-18 two gates from **different worktrees of the same repo**
  (`sol`·max and `terra`·xhigh, launched ~4 min apart by separate agent lanes) **both returned
  receipt-verified verdicts.** Two lanes may therefore run Codex gates at the same time.
  **What is still true, and is the cost you are accepting:** quota is **ONE pool** — concurrent deep
  passes are *parallel-but-throttled*, run slower, and drain a shared budget, so exhaustion hits both
  lanes at once. Cross-thread session contention has been seen to stall at init on some CLI/host
  states; the `-t` fail-closed self-timeout is the backstop that keeps such a stall bounded rather
  than silent. Prefer serialising **deep `sol`·xhigh passes** (the edge-cell binding) when both lanes need one.
  **This licence does NOT extend to the Gemini gate** — see the note under § Gemini, which refuses a
  second live invocation *mechanically*.
- **Exit codes:** 0 = receipt-verified verdict in OUT; 2 = usage error; 3 = no verdict / receipt
  missing / **gate self-timeout** (**never** a pass); otherwise codex's own status.

### Retired: the gate-manifest verifier (2026-07-18)
`scripts/verify-codex-gate-manifest.mjs` and `tests/codex-gate-manifest.test.mjs` were **deleted** in
Workflow v2 Phase 1, and the CI step that ran them was removed (the surrounding `npm ci` + `npm test`
job was **kept**). **Why:** the workflow bound `pull_request` only, while shipping here is
direct-to-main — so it verified nothing on the actual path while implying manifests were enforced.
Exactly one manifest was ever produced, and the last several real code commits carried none. **A
dormant control is worse than no control: it manufactures assurance.** Consequence to be explicit
about: the frontier-thin / cost-inversion lanes lose their *mechanical* release check and fall back to
the standard ladder + push-GO. `docs/journal/gate_manifests/` is kept as a historical artifact.
**Do not rebuild it** without first wiring it to the path work actually ships on (a pre-push hook).

### Gotchas / traps
- **MCP tool's short per-call cap (~2 min observed) kills deep passes** — use `codex exec` via Bash for anything real; MCP only for a fast, diff-scoped lens.
- **`codex exec resume` does NOT inherit the session's sandbox — force it.** A fresh pass runs `-s read-only`, but `resume` has no `-s` flag and falls back to `$CODEX_HOME/config.toml` (here: `danger-full-access`). VERIFIED 2026-07-15 with a filesystem write-probe: a session created read-only resumed as danger-full-access. Every warm round must pass `-c sandbox_mode=read-only` (the wrapper does). `resume` also has no `-C` and runs in the **invoking cwd**.
- **`--disable code_mode_host` — keep it, but it is version-specific.** REQUIRED on 0.144-alpha (a missing helper binary killed every run); **benign on 0.145-alpha.18** (verified 2026-07-17: real `stable` feature, default ON, `--disable` correctly flips it OFF, runs pass with it either way — **not** a hang cause). Keep as cross-version insurance; re-verify before dropping.
- **A hung gate is now bounded, not silent.** The wrapper's `-t` self-timeout kills a stalled codex (+ its direct MCP children) and fail-closes (exit 3) instead of hanging forever. For a **deep** gate, launch it backgrounded/detached (`nohup … &`, or the agent's background mode) and poll the **process** (`wait`/`kill -0`), not just OUT — the gate fail-closes with no OUT on a timeout/auth-death, so a file-only poll hangs forever. A foreground harness call is time-capped and a plain background task can be SIGTERM'd by a runner cap on long runs. **Concurrent Codex gates across threads are ALLOWED** (Owner ruling 2026-07-18; see § Codex gate → Rounds for the evidence) — but they share ONE quota pool, run throttled, and have been seen to stall at init on some CLI/host states, so prefer serialising two *deep* passes and rely on `-t` to bound a stall. **Gemini is the exception: its runner enforces single-flight per repo (exit 4) and cannot be run concurrently.**
- **Always `-m`** — the config default drifts; an un-pinned gate can silently run a weaker model.
- **`</dev/null`** — closes stdin so inherited/piped stdin isn't appended to the prompt (`codex exec` appends piped stdin even with an explicit prompt given).
- **Auth:** Codex uses the Owner's cached ChatGPT-subscription session. If it fails on **AUTH**, re-login; an **MCP** call that fails on timeout is hitting the per-call cap — switch to `codex exec`.
- **A Claude-companion Codex plugin (e.g. `cc@sendbird`) can SILENTLY degrade a Codex run to same-family — keep it removed by default, and guard controlled sites deterministically.** Its `review`/`adversarial-review` skills grab review-shaped prompts and route into `claude-companion.mjs`, which runs a **real Claude review** — non-empty and on-topic, so a "verify `-o` non-empty" check *passes it* and the run silently becomes Claude-reviewing-Claude (a false GO on a gate; a mis-attributed run on a runtime seat). Soft prompt hygiene cannot *guarantee* this never fires; a per-invocation wrapper is deterministic only *if used* (an LLM or an autonomous cron can run a bare `codex exec`). **PRIMARY FIX = absence:** the plugin is only needed for the reverse Codex-as-Builder workflow (`core/BINDINGS.md` § When Codex is the Builder), so keep it **removed by default** and install on-demand for that dev-time session — a bare `codex exec` then can't be hijacked at all. **DEFENSE-IN-DEPTH (deterministic, verified 2026-07-13)** for the on-demand window: every controlled pure-Codex site prepends a fail-closed `claude` shim (`scripts/codex-gate-guard/claude`) to PATH and exports `PIL_BLOCK_CLAUDE_COMPANION=1`; because the companion spawns `claude` by bare name inheriting `process.env`, the shim refuses it (exit 97) → the companion **cannot** run a same-family review. Controlled sites: the read-only dev gate `scripts/codex-gate.sh` (shim + var + emptied `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY` + hygiene); an autonomous runtime cron uses a **hermetic `CODEX_HOME`** instead of the shim (the shim would block its own legitimate `claude` calls). Note `-c 'plugins."<plugin>".enabled=false'` is **inert** (disables neither hooks nor skills). **Migration ordering** to re-enable Workflow B: keep the plugin removed until controlled pure-Codex sites carry the guard — INCLUDING any autonomous runtime cron, which must run in a **hermetic `CODEX_HOME`** (isolated config, no dev plugins) so a shared-`~/.codex/` install can neither hijack nor DOS it. Clean rule: *cron hermetic ⇒ on-demand installs safe; else keep removed.* Installing/removing the shared plugin is deliberate (never per-gate — that races the reverse workflow). Still: **confirm `-o` is a real, on-topic CODEX verdict.**
- **Never on an advocacy ticket** (repeated because it's the trap that produced a real false-clean).

### Portability
The invocation, the model/effort matrix, and the usage contract are repo-agnostic. Per repo, only the **prompt**
you hand Codex is localized: drive it on that repo's diff + design-as-contract + its `core/INVARIANTS.md` + `core/REPO_INVARIANTS.md`
(the failure-classes to check against). Codex reads the repo directly, so there is no payload-delivery contract to
port (contrast the Gemini gate, which must ship the payload to `agy` — see § Gemini cross-family gate below).

## Gemini cross-family gate

Copy `scripts/cold-review-gemini.sh`, `scripts/gemini-gate-supervisor.mjs`, `scripts/gemini-gate-slices.mjs`, and this file together. The runner is model-agnostic except for the `agy` invocation.

### Purpose

`scripts/cold-review-gemini.sh` uses Gemini 3.1 Pro High through the Antigravity CLI to cold-review a design or code changeset before commit/deploy. Its value is decorrelated blind spots. It is read-only with respect to code, Git, and production; its default durable side effect is an append to `docs/journal/gemini_review_log.md`.

Before every real model invocation, the runner creates a private-index snapshot commit from the caller's
current artifact and checks it out in a temporary **detached worktree**. Payload assembly, Git discovery,
full-file reads, and slice validation run only there; the durable attempt records the base SHA and snapshot
SHA. The pre-existing Gemini review log retains its base-tree entry and is never part of the next payload.
Snapshot or worktree setup failure exits nonzero before `agy` runs. `--dry-run` is diagnostic-only and does
not create a gate artifact.

Every file-valued gate input (`--design`, `--context`, `--folded` when it names a file, and
`--slice-manifest`) is rebound to a path inside that snapshot before the model runs. Slice contract contexts
are repository-relative and must also resolve inside the frozen worktree; absolute or escaping paths fail
closed rather than supplying mutable ambient bytes. A verified response is recorded only after the registered
temporary worktree and private index have been removed successfully. The inspected-scope line may use normal
Markdown or punctuation but must contain a real word token; punctuation alone is not a claimed scope.
Each artifact is retained locally under `refs/pil/gate-artifacts/<artifact-sha>` and named in the durable
attempt record, so ordinary Git garbage collection cannot erase the bytes behind a logged review SHA.

### Commands

- Code gate: `bash scripts/cold-review-gemini.sh --context <design.md>`
- Design gate: `bash scripts/cold-review-gemini.sh --design <doc> --folded <prior_review.md>`
- Dry-run: add `--dry-run` to print the exact routing decision and payload without `agy`.
- Diagnostic only: add `--no-log`. A receipt-verified `--no-log` run is not a release-gate receipt.
- Bounded slice: `bash scripts/cold-review-gemini.sh --slice-manifest <plan.json> --slice <name>`
- Finalize a fully successful slice set: `bash scripts/cold-review-gemini.sh --slice-manifest <plan.json> --finalize-slices`
- Deterministic harness: `bash scripts/cold-review-gemini-selftest.sh` (fake `agy`; no network or model quota).
- Compatibility selftest entrypoint: `bash scripts/cold-review-gemini.sh --selftest` delegates to the same deterministic harness.

At a design gate, use `--design`; a diff review of a docs-only changeset is the wrong artifact. Code mode reviews the uncommitted diff, full changed code files up to 120 KB each, untracked code files below 300 KB, invariants, and optional contract context.

Authentication is out-of-band through the cached Antigravity/Google AI Pro session. No API key is expected. `GEMINI_AGY_BIN` is a test/diagnostic executable override.

### Delivery and ingestion are different proofs

The gate must prove both:

1. **Delivery:** the intended bytes reached the model transport.
2. **Ingestion coverage:** the model attended to the artifact from head through middle to tail.

`ARG_MAX` proves only that `execve` accepted an argv. It does not prove Gemini retained the contiguous artifact. A 2026-07-14 run delivered roughly 340 KB inline but Gemini omitted later sections; an approximately 83 KB rerun ingested them. An EOF token alone can also miss a windowed read that jumps from head to tail.

Every real model run therefore has three independent token mechanisms:

- A fixed-width random EOF `PIL-RCPT-*` receipt is appended to **INLINE and FILE** artifacts and must be the reply's first nonblank line.
- `N = clamp(ceil(raw payload bytes / 32,768) + 1, 2, 32)` fixed-width, index-distinct random `PIL-INGEST-*` canaries are inserted at exact byte positions spanning offset zero through EOF. Offsets that land inside UTF-8 continuation bytes snap forward to a valid character boundary. This preserves head-to-tail geometry even for minified or otherwise long single-line files; corrupt/non-monotonic maps fail closed. The reply must contain every token in encounter order; wrapping, bullets, and whitespace are tolerated, while a missing/reordered middle or tail token is `FAILED_DELIVERY`, never a verdict. The 32-probe cap keeps gaps at or below 32 KiB through roughly 1 MiB and below roughly 99 KiB at the 3 MB gate ceiling.
- A separate random `PIL-DONE-*` token supplied in the instruction must be the reply's final nonblank line after the substantive verdict. This rejects output truncated after the receipt/canary handshake.

Delivery proof is necessary but not a review verdict. Before the completion token, the reply must also give an
explicit `GO` or `NO-GO` verdict and a nonempty inspected-scope line. The verifier accepts harmless casing,
Markdown, punctuation, and the two natural scope-label orders, but requires one unambiguous enum and scope;
receipt-only output is `FAILED_VERDICT` (exit 3). A mechanically valid `NO-GO` is still a delivered review
for PM disposition, never a clearance.

Secure-entropy failure is fail-closed; there is no variable-width fallback. The boundary tokens prove input reach/coverage and output completion, not the semantic quality of the review, which remains a reviewer/PM judgment.

These are random-token checks, not a natural-language truncation regex. Do not add a prose drop regex; legitimate reviews can discuss a “missing diff” or “not provided” value.

### Transport tiers

The runner never uses stdin.

### INLINE

INLINE sends `prompt + instrumented payload + EOF receipt` as the `--print` argument. Selection uses the smallest of:

- OS argv budget: `ARG_MAX` less conservative environment/argument headroom;
- optional legacy operator cap: `GEMINI_INLINE_MAX`;
- Gemini inline ingestion ceiling: `GEMINI_INLINE_INGEST_MAX`, default **81,920 bytes (80 KiB)**.

The combined-byte measurement includes the receipt instruction, canary handshake, instrumented payload, and EOF trailer. The 80 KiB default is deliberately below the observed approximately 83 KB good run; change it only with empirical evidence. `GEMINI_OS_ARG_MAX` exists for deterministic routing tests.

### FILE

Larger payloads are written to a mode-`0600` temp file and exposed only through `--add-dir <temp> --mode plan --sandbox`. The file contains the instrumented payload and EOF receipt. Actual written bytes are measured with `wc -c`; write or measurement errors fail closed.

- At or below 3,000,000 bytes (`VERIFIED_MAX`): gate-valid if `agy` exits zero, reply is non-empty, EOF receipt is first, the exact ordered canary line is present, and the response-completion token is last.
- Above 3,000,000 bytes but at or below an explicitly raised `GEMINI_FILE_MAX`: `ADVISORY_ONLY`, exit nonzero, durably labeled, never a verdict.
- Above `GEMINI_FILE_MAX`: `FAILED_DELIVERY`; `agy` is not called.

Do not raise the 3 MB gate-valid envelope without a new contiguous-read experiment. EOF plus distributed canaries detects sampled skipped regions but is not permission to claim an untested arbitrarily large context.

### Finite runtime and process ownership

`GEMINI_TIMEOUT_SECONDS` defaults to **600 seconds** and applies to INLINE and FILE. `GEMINI_TERMINATE_GRACE_SECONDS` defaults to 2 seconds.

`scripts/gemini-gate-supervisor.mjs` publishes its PID, process-start stamp, and exact command into the owned lock **before** it can spawn `agy`, then starts `agy` in a dedicated process group. On timeout, `INT`, `TERM`, loss of the runner parent, or normal CLI exit with lingering descendants, it sends targeted TERM then KILL to that group and waits for closure. On abrupt parent loss it additionally appends a typed failure and removes only the temp directory and lock whose owner PID matches that parent. It never uses `pkill` or a process-name pattern.

> **⚠ GEMINI IS NOT CONCURRENT-SAFE, AND THAT IS ENFORCED, NOT ADVISED.** The 2026-07-18 ruling that
> permits concurrent **Codex** gates does **not** apply here: the runner takes a per-repo single-flight
> lock and a second live invocation **exits 4** — including from a sibling worktree of the same repo.
> Two lanes cannot both hold a Gemini gate; the second must wait. This is a mechanism, not a norm.

The runner owns a per-repository lock under the canonical Git common directory, so sibling worktrees cannot run duplicate reviews against one repository. The owner record binds the runner and its supervisor by PID, process start stamp, exact command, and common-directory identity. A live supervisor retains ownership throughout parent-loss TERM→KILL teardown, so a dead Bash parent cannot admit a duplicate `agy`. A second matching live owner exits immediately with code 4. A freshly dead runner without a published supervisor is held for a bounded startup grace instead of being stolen; this closes the scheduler window between launching the supervisor and its atomic publication. Older dead, malformed, or PID-reused ownership is recovered by atomic rename; stale recovery never signals the recorded PID. An owner file still being initialized is not stolen.

### Durable attempt records

Unless `--no-log` is set, every owned real attempt has exactly one typed record:

- `PASS_VERDICT`
- `FAILED_DELIVERY`
- `FAILED_TIMEOUT`
- `FAILED_TOOL`
- `FAILED_VERDICT`
- `ADVISORY_ONLY`

Each record includes attempt ID, record kind, release-gate eligibility, transport, raw/instrumented/combined/file byte counts, ingestion proof count, model, context/design path, base SHA, frozen artifact SHA, start/end times, and normalized slice manifest when applicable. A valid review also records its enum and inspected scope. A full pass uses `Verified review verdict`; an individual slice uses `Verified slice verdict — NOT A COMPLETE GATE`; only the aggregate uses `Verified bounded-slice-set verdict`. Failed/rejected model output is emitted only with an adjacent `NOT A VERDICT` label and is indented under `Diagnostic output — NOT A VERDICT` in the log.

A documented release gate requires all three machine fields: `Status: PASS_VERDICT`, `Release-Gate: YES`, and `Record-Kind: FULL_REVIEW` or `SLICE_SET`. A `SLICE_RESULT` is never a release receipt even though it is a valid verdict on that slice. `--no-log` is retained for diagnostics and live interruption tests only, including abrupt parent loss.

### Bounded slicing

Slicing is a coverage strategy, not an automatic remediation loop. The pinned frontier PM approves the plan before model calls.

The JSON manifest must contain:

```json
{
  "version": 2,
  "approval": { "status": "DRAFT", "by": "frontier-pm", "expected_plan_id": "" },
  "scope": { "base_commit": "0123456789abcdef0123456789abcdef01234567", "files": ["exact/changed/file"] },
  "uncovered": [],
  "slices": [
    {
      "name": "named-coverage",
      "kind": "coverage",
      "files": ["exact/changed/file"],
      "contract_context": ["docs/contract.md"]
    },
    {
      "name": "cross-boundary",
      "kind": "cross_boundary",
      "files": ["exact/changed/file"],
      "contract_context": ["docs/contract.md"],
      "boundaries": {
        "public_contract": { "status": "covered", "scope_files": ["exact/changed/file"], "contract_context": ["docs/contract.md"], "rationale": "public contract seam" },
        "storage_migration": { "status": "not_applicable", "scope_files": [], "contract_context": ["docs/contract.md"], "rationale": "contract proves no storage or migration surface" },
        "write_path": { "status": "covered", "scope_files": ["exact/changed/file"], "contract_context": ["docs/contract.md"], "rationale": "write seam" },
        "read_path": { "status": "covered", "scope_files": ["exact/changed/file"], "contract_context": ["docs/contract.md"], "rationale": "read seam" },
        "doctor_parity": { "status": "not_applicable", "scope_files": [], "contract_context": ["docs/contract.md"], "rationale": "contract proves no doctor surface" }
      }
    }
  ]
}
```

Replace the example commit with the exact 40-hex output of `git rev-parse HEAD`; symbolic refs such as `HEAD` are rejected. First run `node scripts/gemini-gate-slices.mjs fingerprint --repo "$PWD" --manifest plan.json --out-dir /tmp/gemini-plan`. `--out-dir` **must resolve OUTSIDE the repository** (or under the one canonical `.gemini-gate/` prefix); an in-repo `--out-dir` is rejected before any evidence is written, and an omitted `--out-dir` defaults to a fresh system-temp dir (printed as `Artifacts written under:`). This is load-bearing: an in-repo `--out-dir` writes untracked files that `freeze_artifact`'s `git add -A` would bake into the review snapshot as a false changed surface. The frontier PM reviews that exact base/scope/slice/context plan, then changes `status` to `APPROVED` and copies the emitted `plan-id.txt` value into `expected_plan_id`. `validate` and `finalize` reject any later base, diff, context-byte, HEAD, or plan-shape change until the PM approves the new fingerprint.

The validator compares `scope.files` with the exact tracked/untracked surface (excluding, by RECOGNIZED EXACT PATH, the durable log, the manifest, and the one canonical `.gemini-gate/` artifact dir — never by "is this file untracked", which would fail open: an unknown untracked sibling still fails closed and is journaled to the durable log), requires the coverage union to equal scope, rejects overlapping-only slices, requires `uncovered: []`, and makes the final entry the single cross-boundary slice. A `covered` boundary requires selected scope-file evidence; a `not_applicable` boundary requires contract evidence and rationale. PM approval remains the semantic truth check.

Every slice record contains the entire normalized plan, exact diff ranges plus diff hashes, full-file hashes, canonical context paths plus byte hashes, current HEAD, pinned base commit, and the PM-approved SHA-256 plan ID. During one validator run, each selected full file and contract context is read once into a byte buffer; that same buffer is hashed and written to a private snapshot, while each computed diff is likewise cached and snapshotted. The runner consumes only those approved full-file, diff, and context snapshots—never a later live reread—so mutation after validation cannot alter the reviewed bytes under an old plan ID. An individual successful slice is `Record-Kind: SLICE_RESULT`, `Release-Gate: NO`. After every named coverage slice and a later final cross-boundary slice has a durable pass under the same plan ID, `--finalize-slices` emits the sole `SLICE_SET` release receipt with all contributing attempt IDs. Missing, failed, out-of-order, stale-HEAD, mutated-context, or differently hashed slices make finalization fail before any release verdict.

### Exit codes and traps

- `0`: a full/aggregate release receipt, an explicitly non-release slice result, dry-run, or confirmed no code changes. For a delivered review, exit 0 means it was delivered; read the log's `Gate-Verdict` field for GO vs NO-GO (the exit code does not encode the verdict). Git discovery failure is never “no changes.”
- `2`: bad arguments or invalid environment value.
- `3`: not a verdict—artifact-freeze failure, delivery/ingestion failure, timeout, tool failure, empty response, missing/malformed verdict contract, advisory, or refusal.
- `4`: single-flight refusal.
- `127`: `agy` unavailable.
- `130` / `143`: direct `INT` / `TERM` paths may preserve the signal code; always non-verdict.

Never re-add stdin; never treat OS argv acceptance as ingestion; never omit EOF, ordered distributed tokens, or response completion; never broaden process cleanup beyond the owned group/verified lock; never let rejected output appear unqualified; never present `--no-log` or individual/incomplete slices as the release gate.

History: `docs/journal/gemini_gate_inline_only_fix.md`, `docs/journal/gemini_gate_filemode.md`, and `docs/journal/gemini_gate_reliability_remediation_design.md` (which records the held upstream ingestion-canary evidence reconciled here).
