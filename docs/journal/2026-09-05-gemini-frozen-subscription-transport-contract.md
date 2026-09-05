# Frozen Gemini subscription transport successor contract

## Parent and bounded purpose

This is a parent-linked successor to `b1e19ac3c3f6def108fb7d14f9ce09ba41c4d51d`. It preserves the
frozen exact-object envelope, complete screening, ordered fragment/slice execution, final aggregate
receipt, credential firewall, lock, timeout, cache, and endpoint/tree recheck controls. It adds one
ordinary non-API transport: an existing Antigravity subscription command (`agy`). Direct Gemini REST
remains an explicit optional `api` transport. There is no fallback between transports.

Measured diagnostic evidence for the subscription rig was `agy 1.1.27` with Gemini 3.1 Pro High in a
fresh temporary cwd using `--sandbox --disable-slash-commands` and JSON output. A
synthetic `read_file` request was denied before execution (`CANCELED`, empty response,
`denied_actions=[read_file]`, canaries unchanged). A fully inline synthetic review succeeded with the
exact receipt, canaries, one `GO`, and a completion token, without workspace mutation. `--mode plan`
warned that it has no effect when slash expansion is disabled and is deliberately omitted. Later
headless documentation established that `stream-json` emits one `init`, step events, and one result;
the runner uses it as the local tool/subagent execution record. The response completion token is
validated as the final non-whitespace token.

## Subscription execution and failure boundary

The runner passes each already-screened, bounded, complete review request as exactly one NDJSON
standard-input user event to a validated `agy` binary in a newly-created disposable empty workspace. It
must use a validated Gemini 3.1 Pro High model identifier and `--input-format stream-json --sandbox
--disable-slash-commands --output-format stream-json --print-timeout <N>s`. It never supplies
`--new-project` (which creates persistent global project records), `--add-dir`,
a repository cwd, a prompt command-line argument, permission bypass, broad permission configuration,
or `--mode plan`. It
preflights the normal Antigravity settings file: only absent or `request-review` tool permission,
absent/false non-workspace access, and an absent/empty allow list are accepted. The disposable
workspace is removed and the source repository endpoint/tree is checked before and after the call.
Subscription execution fails closed on Windows until owned process-group teardown is implemented there.

The stream must name the real disposable cwd, model, and request-review mode, and end in one successful
nonempty result. Any tool event or tool output, subagent event, denied action, stderr diagnostic,
workspace mutation, nonzero exit, signal, timeout, bounded-output overflow, malformed/unknown event,
or receipt/canary/scope/verdict/completion mismatch is a non-verdict failure. Accepted stream structures
are allowlisted; a nonempty advertised `init.tools` list is permitted because tool availability is not
tool execution, but unknown or execution-like step/result fields are refused. A `CANCELED` tool request
is not a verdict. On timeout, output overflow, or an interrupted runner the owned detached process group
gets TERM then KILL; the runner waits through teardown before cleanup and records an interrupted attempt
as non-verdict evidence where the journal remains available. It never retries by changing permissions. Cache and
receipt identity include the stable transport name, `agy` version, settings fingerprint, model, and
nonsecret rig ID without retaining an absolute local binary path.

## Residual activation hold

The stream plus restrictive settings preflight establish the runner's prevention policy without relying
on absent `denied_actions`; deterministic fakes also prove rejection of a stream-recorded tool action,
workspace write, and owned descendant timeout. They do not prove current-account eligibility, a live
provider's behavior, or useful review quality. Activation therefore remains HOLD until an Owner
separately authorizes live use and retains a current-rig preflight and review receipt. This successor
does not modify the existing `.gemini-gate` live plan or use credentials.

## Acceptance

Deterministic fake-`agy` tests cover a verified successful subscription reply, CANCELED denied action,
nonzero, timeout, malformed JSON, missing receipt material, command restrictions, disposable cwd and
repository non-mutation, exact tuple/fragments/final aggregate behavior, cache identity, and the
installed wrapper path. No live provider test is part of acceptance.

## Round 1 dependency sweep and declines

Dependency sweep claim: the frozen gate's default transport is the disposable subscription stream and
direct REST is explicit-only. Coverage was `core/REPO_INVARIANTS.md` (the changed binding),
`core/GATES.md` (operator contract), this successor contract, `README.md`, the public wrapper, runner,
and focused tests. The stale direct-only assertion was corrected only in the binding; the operator
contract and runner already agreed with subscription-default behavior. No other direct-only claim was
found in the changed surfaces.

The runner deliberately permits a nonempty `init.tools` list: measured Antigravity exposes available
tools even under restrictive headless settings, and empty availability would make the real rig unusable
without strengthening the execution boundary. It rejects actual tool/subagent events and tool-like
stream fields instead. We declined a scanner/binary/settings TOCTOU framework, environment scrubbing,
automatic plan generation, and Windows task-tree implementation: none fixes a newly demonstrated path
within this successor. Windows is held closed instead.

The final candidate is expected to use approximately twelve bounded calls (eleven coverage slices and
one cross-boundary slice) packed at or below 79,999 bytes per envelope. We declined multi-turn session
reuse: a fresh `agy` process per slice preserves independent failure and receipt isolation, while
deterministic packing addresses the measured subscription cost without introducing session state.

### Typed Round 1 disposition

`GATE ROUND 1 · changeset gemini-frozen-subscription-transport · verdict NO-GO · HARM-PASSING 6 ·
NOTES 5 · ACTION-SCREEN remediate bounded transport controls; LADDER continue`.

1. **REMEDIATE — HARM:** a local process observer can recover private review material from `agy -p
   <prompt>` arguments. **TRIGGER:** a frozen invocation passes its complete envelope as an argv value.
   The runner now sends one stream-JSON user event over standard input and tests that argv contains no
   prompt.
2. **REMEDIATE — HARM:** a false direct-only invariant is injected into each review envelope, so a
   reviewer can assess the wrong transport boundary. **TRIGGER:** `core/REPO_INVARIANTS.md` still names
   direct text despite subscription-default dispatch. The binding and aligned operator claims now agree;
   the dependency sweep above records its coverage.
3. **REMEDIATE — HARM:** a concurrent live subscription gate can be mistaken for stale ownership and
   have its lock recovered. **TRIGGER:** a same-repository `kind=subscription` owner has a live PID but
   a nonmatching command. The wrapper now rejects either live frozen owner kind before command matching.
4. **REMEDIATE — HARM:** a TERM-ignoring child can make the parent buffer arbitrarily large output while
   teardown waits. **TRIGGER:** output continues after the configured cap. Captures now stop at cap plus
   a 1 KiB sentinel, mark overflow, and terminate the owned group.
5. **REMEDIATE — HARM:** interrupting the runner can leave its detached provider group alive and later
   allow unsafe stale-lock recovery. **TRIGGER:** SIGINT or SIGTERM arrives during subscription execution.
   Scoped handlers now TERM then KILL the group, await teardown, produce a non-verdict receipt, restore
   listeners, and exit 130 or 143.
6. **REMEDIATE — HARM:** an execution-like field nested in an otherwise accepted stream event can be
   ignored and a forged GO accepted. **TRIGGER:** `agent_response.tool_output` or a result extra field
   accompanies an otherwise valid stream. Init, step, and result fields are now strict allowlists.

#### Pre-R2 compatibility completion for item 6

The first allowlist used a simplified nested-result fixture and would reject the documented/current
Antigravity 1.1.27 stream before it could judge a candidate. **TRIGGER:** a normal stream has top-level
`init.conversation_id`, `step_update.conversation_id`/`step_index` plus optional response telemetry,
and a top-level terminal result with duration, turn count, and usage. The parser now accepts only those
precise shapes, binds one stable nonempty conversation ID from init through result, and validates the
closed nonnegative usage object (`input_tokens`, `output_tokens`, `thinking_tokens`,
`cache_read_tokens`, `total_tokens`). The fake success path now emits that complete shape; mismatched
conversation IDs and unexpected fields still fail closed. This completes the admitted stream-schema
repair; it does not widen the transport or introduce a new review round.

The scoped signal handler now owns group termination before it is attached, closing the immediate
interrupt window. A fake that signals the runner immediately after provider startup proves the 130
receipt and descendant teardown. The runner also consumes asynchronous stdin write errors such as EPIPE
as a transport failure and waits for the owned child to close, so an early provider exit cannot crash or
orphan the runner.

### Typed Round 2 disposition

`GATE ROUND 2 · changeset gemini-frozen-subscription-transport · verdict NO-GO · HARM-PASSING 2 ·
NOTES 4 · ACTION-SCREEN remediate bounded signal and doctrine drift; LADDER continue`.

1. **REMEDIATE — HARM:** a second termination signal can invoke Node's default handler during the
   two-second TERM→KILL interval, ending the runner before it kills a TERM-ignoring provider group.
   **TRIGGER:** SIGINT starts teardown and SIGTERM follows while the provider and a descendant ignore
   TERM. Scoped persistent listeners now coalesce repeats, preserve the first signal's 130/143 exit
   code, and are removed only after teardown; the regression proves a 130 non-verdict receipt and
   descendant death.
2. **REMEDIATE — HARM:** an operator following unqualified legacy doctrine can remove the frozen
   subscription input channel and break the private-prompt transport. **TRIGGER:** `core/GATES.md`
   stated both “The runner never uses stdin” and “Never re-add stdin” without limiting them to legacy
   INLINE/FILE routing. Both statements now preserve the subscription's one NDJSON standard-input event,
   and the exit-code wording names subscription-only handled signals.

We declined requiring empty `init.tools`: actual Antigravity advertises available tools, while actual
execution remains rejected by the stream and schema boundary. We also declined local-hostile
binary/settings TOCTOU controls, a Windows task-tree implementation (subscription remains HOLD there),
and multi-turn reuse; none is a new demonstrated reachable harm within this candidate, and fresh
per-slice process isolation remains the bounded cost control.
