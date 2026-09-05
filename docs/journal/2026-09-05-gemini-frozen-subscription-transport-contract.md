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

The runner passes each already-screened, bounded, complete review request inline to a validated `agy`
binary in a newly-created disposable empty workspace. It must use a validated Gemini 3.1 Pro High
model identifier and `--sandbox --disable-slash-commands --output-format stream-json --print-timeout
<N>s`. It never supplies `--new-project` (which creates persistent global project records), `--add-dir`,
a repository cwd, permission bypass, broad permission configuration, stdin, or `--mode plan`. It
preflights the normal Antigravity settings file: only absent or `request-review` tool permission,
absent/false non-workspace access, and an absent/empty allow list are accepted. The disposable
workspace is removed and the source repository endpoint/tree is checked before and after the call.

The stream must name the real disposable cwd, model, and request-review mode, and end in one successful
nonempty result. Any tool event or tool output, subagent event, denied action, stderr diagnostic,
workspace mutation, nonzero exit, signal, timeout, bounded-output overflow, malformed/unknown event,
or receipt/canary/scope/verdict/completion mismatch is a non-verdict failure. A `CANCELED` tool request
is not a verdict. On timeout or output overflow the owned detached process group gets TERM then KILL;
the runner waits through teardown before cleanup. It never retries by changing permissions. Cache and
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
