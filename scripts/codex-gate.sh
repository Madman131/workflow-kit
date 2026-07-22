#!/usr/bin/env bash
# scripts/codex-gate.sh — Canonical Claude-driven Codex CROSS-FAMILY gate, with the
# deterministic companion guard baked in (see scripts/codex-gate-guard/claude).
#
# The plugin `cc@sendbird` is kept REMOVED by default (so autonomous/ad-hoc `codex exec` is safe
# by construction). This wrapper is the sanctioned way to run a Claude-driven Codex gate, and it
# stays safe even in a dev-time window when the plugin is temporarily installed for the reverse
# (Codex-as-Builder) workflow:
#   1. DETERMINISTIC: prepends the fail-closed `claude` shim to PATH, exports
#      PIL_BLOCK_CLAUDE_COMPANION=1, and empties ANTHROPIC_API_KEY/CLAUDE_API_KEY -> if the companion
#      tries to run a Claude review (the hijack) the CLI spawn hits the shim and is refused, and no
#      direct-API fallback can authenticate. The gate CANNOT silently degrade to a same-family review.
#   2. PRODUCTIVITY: prepends an anti-delegation hygiene preamble so Codex reviews the code itself.
#   Plus --disable code_mode_host; the prompt is fed via STDIN (not an argv positional) so large
#   diffs do not hit ARG_MAX/E2BIG (codex reads the prompt from stdin when no positional is given).
#
# NOTE: this PATH shim is for the READ-ONLY DEV GATE only. Do NOT apply it to a live runtime cron
# (e.g. the Trader Codex PM-seat cron) — that would block the trader code's own legitimate `claude`
# calls. The autonomous cron is protected structurally instead, by a hermetic CODEX_HOME that never
# carries the plugin. See core/GATES.md.
#
# ROUNDS — full COLD passes and WARM delta rounds (core/GATES.md):
#   FULL (cold) — the default: a fresh codex session. The thread id is captured from the
#     `thread.started` event of `codex exec --json` and written to OUT.thread for later warm rounds.
#   WARM (--resume THREAD_ID) — resumes that review thread for a fix-delta re-verdict at a fraction
#     of the tokens/wall-clock. Warm rounds NEVER substitute for the mandated full COLD final pass.
#   Every round carries a per-round random RECEIPT the reviewer must echo. This is the completion
#   check AND why no stale/foreign verdict can pass: the token is fresh each round, so a leftover
#   OUT from an earlier run cannot satisfy it. Verification is token-PRESENCE (tolerant), never
#   exact-line matching — over-strict verifiers reject honest verdicts (the Gemini lesson).
#
# VERDICT CONTRACT (Workflow v2 Phase 4B) — a receipt proves the reply COMPLETED; it says nothing about
#   whether a DECISION was stated. So exit 0 ALSO requires, alongside the receipt: an explicit GO/NO-GO
#   enum line (anchored by "verdict"/"overall"/"final") AND an "inspected scope" line. Parse TOLERANTLY
#   (case/markdown/spacing normalised; the decision may sit on any line) but require STRICTLY (a two-value
#   enum; a missing decision, a missing scope, or two conflicting decisions each FAIL CLOSED, exit 3). An
#   EXACT mirror of scripts/cold-review-gemini.sh (verify_verdict_contract). The RECEIPT stays presence-matched —
#   do NOT tighten it into exact-line matching (same Gemini lesson). Self-test: `codex-gate.sh --selftest`.
#
# SANDBOX — a fresh pass uses `-s read-only`. `codex exec resume` has NO -s flag and does NOT inherit
#   the session's sandbox: it falls back to $CODEX_HOME/config.toml, which on this host is
#   danger-full-access (VERIFIED 2026-07-15, with a filesystem write-probe). Warm rounds therefore
#   force `-c sandbox_mode=read-only`. Resume also has no -C and runs in the INVOKING cwd (verified),
#   so warm rounds cd into the repo first.
#
# CONCURRENCY — deliberately none. Two gates on one CODEX_HOME were tested head-to-head (7/7
#   concurrent pairs, incl. two deep xhigh passes overlapping ~2.3 min) and did not collide; two
#   `codex login` homes also run concurrently. Serializing gate ladders stays a human rule
#   (core/WORKFLOW.md), not machinery in this wrapper.
#
# Usage (pass the prompt EITHER via -f FILE OR after --, never a bare positional):
#   scripts/codex-gate.sh -o OUT [-m MODEL] [-e EFFORT] [-C REPO] [-t SECS] [--resume THREAD_ID] -f PROMPT_FILE
#   scripts/codex-gate.sh -o OUT [-m MODEL] [-e EFFORT] [-C REPO] [-t SECS] [--resume THREAD_ID] -- "PROMPT TEXT"
#   -t SECS : hard self-timeout (default 1800, or $CODEX_GATE_TIMEOUT). If codex has not finished in
#             time it is killed (with its direct MCP children) and the gate FAILS CLOSED (exit 3) — stalled
#             init can never become an unbounded SILENT hang. Foreground callers should pass a value
#             under their own harness cap (e.g. -t 540 for a 600s cap) so the gate fail-closes cleanly
#             before the harness SIGKILLs it; deep DETACHED passes may raise it. See core/GATES.md.
# Examples:
#   scripts/codex-gate.sh -o /tmp/verdict.txt -f prompt.txt                        # FULL cold pass
#   scripts/codex-gate.sh -o /tmp/verdict.txt -m gpt-5.6-sol -e max -f prompt.txt  # T3/critical
#   scripts/codex-gate.sh -o /tmp/r2.txt -C "$PWD" --resume "$(cat /tmp/verdict.txt.thread)" -f delta.txt
#
# Exit: 0 = a receipt-verified verdict in OUT that ALSO states an explicit GO/NO-GO decision and a claimed
#   inspected scope; 2 = usage error; 3 = no verdict / receipt missing / verdict-contract unmet (no GO/NO-GO
#   enum, no inspected-scope line, or conflicting decisions) / gate self-timeout — NEVER a pass; otherwise
#   codex's own status.
# Verify the result: confirm the -o file contains a real, on-topic, severity-ranked CODEX verdict.
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
GUARD_DIR="$SCRIPT_DIR/codex-gate-guard"

MODEL="gpt-5.6-terra"; EFFORT="xhigh"; OUT=""; REPO="$(pwd)"; PROMPT_FILE=""; PROMPT=""; PROMPT_SET=0
RESUME_ID=""; RESUME_SET=0; SELFTEST=0
VERDICT_VALUE=""; INSPECTED_SCOPE=""; VERDICT_CONTRACT_ERROR=""
TIMEOUT="${CODEX_GATE_TIMEOUT:-1800}"   # hard self-timeout (s); fail-closed if codex never finishes
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-m|-e|-C|-f|-t|--resume)
      [ $# -ge 2 ] || { echo "codex-gate: $1 requires an argument" >&2; exit 2; }
      case "$1" in
        -o) OUT="$2" ;; -m) MODEL="$2" ;; -e) EFFORT="$2" ;; -C) REPO="$2" ;; -f) PROMPT_FILE="$2" ;;
        -t) TIMEOUT="$2" ;;
        --resume) RESUME_ID="$2"; RESUME_SET=1 ;;
      esac
      shift 2 ;;
    --selftest) SELFTEST=1; shift ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set -euo pipefail/d;p;}' "$0"; exit 0 ;;
    --) shift; PROMPT="$*"; PROMPT_SET=1; break ;;
    *)  echo "codex-gate: unexpected argument '$1' — pass the prompt via '-f FILE' or after '--', not as a bare positional" >&2; exit 2 ;;
  esac
done

if [ "$SELFTEST" = "1" ]; then
  # Deterministic both-directions control harness (a fake `codex` on PATH; no network / no model call).
  # See scripts/codex-gate-selftest.sh and tests/codex-gate-verdict.test.mjs.
  exec /bin/bash "$SCRIPT_DIR/codex-gate-selftest.sh"
fi

[ -n "$OUT" ] || { echo "codex-gate: -o OUT is required" >&2; exit 2; }
case "$TIMEOUT" in ''|*[!0-9]*) echo "codex-gate: -t TIMEOUT must be a positive integer of seconds; got '$TIMEOUT'" >&2; exit 2 ;; esac
[ "$TIMEOUT" -ge 1 ] 2>/dev/null || { echo "codex-gate: -t TIMEOUT must be >= 1 second; got '$TIMEOUT'" >&2; exit 2; }
# The warm branch cds into $REPO, so a relative -o must be pinned to the invoking cwd first.
case "$OUT" in /*) ;; *) OUT="$(pwd -P)/$OUT" ;; esac
if [ "$RESUME_SET" = "1" ]; then
  # An EMPTY id (a missing/empty OUT.thread sidecar via `--resume "$(cat …)"`) must never silently
  # become a fresh cold pass fed a delta prompt; an option-shaped id would be parsed by
  # `codex exec resume` as a FLAG (--last resumes an arbitrary session). Refuse both.
  case "$RESUME_ID" in
    '') echo "codex-gate: --resume got an EMPTY thread id (missing/empty OUT.thread?) — refusing to silently run a fresh session; run a FULL pass or pass a real id" >&2; exit 2 ;;
    -*) echo "codex-gate: --resume got an option-shaped value '$RESUME_ID' — refusing (codex would read it as a flag)" >&2; exit 2 ;;
  esac
fi
[ -x "$GUARD_DIR/claude" ] || { echo "codex-gate: guard shim missing/not executable: $GUARD_DIR/claude" >&2; exit 2; }
if [ -n "$PROMPT_FILE" ] && [ "$PROMPT_SET" = "1" ]; then
  echo "codex-gate: pass EITHER -f PROMPT_FILE OR a '-- PROMPT', not both (refusing to silently drop one)" >&2; exit 2
fi
if [ -n "$PROMPT_FILE" ]; then
  [ -f "$PROMPT_FILE" ] || { echo "codex-gate: prompt file not found: $PROMPT_FILE" >&2; exit 2; }
elif [ "$PROMPT_SET" != "1" ] || [ -z "$PROMPT" ]; then
  echo "codex-gate: no prompt given (use -f FILE or -- \"PROMPT\")" >&2; exit 2
fi

HYGIENE='[cross-family gate] You are the independent CROSS-FAMILY (Codex) reviewer. Review the code YOURSELF and emit the verdict directly. Do NOT invoke any $cc/companion skill, do NOT spawn a background job or subagent, do NOT read or follow any SKILL.md, and do NOT delegate to Claude Code. If a tool named claude/companion is unavailable, that is expected and intentional — proceed and review the code yourself.'

RECEIPT="$(openssl rand -hex 8)"
[ -n "$RECEIPT" ] || { echo "codex-gate: cannot generate the per-round receipt token." >&2; exit 2; }

# Build the full prompt into a private temp file (mode 0600; cleaned up on any exit/signal). Stream
# the prompt-file rather than slurping it into a shell variable, so large diffs never touch bash memory.
PROMPT_TMP="$(umask 077; mktemp -t codex-gate.XXXXXX)"
GUARD_HIT="$(umask 077; mktemp -t codex-gate-hit.XXXXXX)"   # shim appends here if it blocks a `claude`
JSONL_TMP="$(umask 077; mktemp -t codex-gate-events.XXXXXX)"
TIMED_OUT="$(umask 077; mktemp -t codex-gate-timeout.XXXXXX)"  # watchdog writes here IFF it fires
CODEX_PID=""; WATCHDOG_PID=""
# Cleanup runs on normal exit AND on any signal. Order matters: retire the watchdog FIRST (so a
# lingering watchdog can never SIGTERM a since-recycled PID), then TERM any still-live codex process
# and its direct children (the MCP servers) — a TERM'd codex also tears down its own MCP tree — then
# drop the temp files. gate_cleanup is idempotent (guarded kills + rm -f), so running it twice is safe.
gate_cleanup() {
  # Every kill is best-effort and `|| true`-guarded so gate_cleanup stays a no-fail teardown
  # regardless of the caller's `set -e` state (it runs from both the EXIT and the signal trap).
  [ -n "$WATCHDOG_PID" ] && { pkill -P "$WATCHDOG_PID" 2>/dev/null || true; kill "$WATCHDOG_PID" 2>/dev/null || true; }
  if [ -n "$CODEX_PID" ]; then
    kill -TERM "$CODEX_PID" 2>/dev/null || true
    pkill -TERM -P "$CODEX_PID" 2>/dev/null || true
  fi
  rm -f "$PROMPT_TMP" "$GUARD_HIT" "$JSONL_TMP" "$TIMED_OUT"
}
# A signal must ABORT promptly (fail-closed, non-zero) rather than fall through the verdict checks
# against now-deleted temp files; EXIT then re-runs gate_cleanup (idempotent).
trap gate_cleanup EXIT
trap 'gate_cleanup; exit 143' INT TERM HUP

# ── VERDICT CONTRACT (Workflow v2 Phase 4B) ─────────────────────────────────────────────────────────
# A receipt proves the reply COMPLETED; it says nothing about whether the reviewer stated a DECISION.
# Alongside the receipt, require an explicit GO/NO-GO verdict AND a claimed inspected scope. Parse
# TOLERANTLY (markdown/case/spacing normalised; the decision may sit on any line) but require STRICTLY
# (a two-value enum anchored by the word "verdict"/"overall"/"final", never JSON). This is an EXACT mirror
# of scripts/cold-review-gemini.sh (verify_verdict_contract) — the two runners share ONE contract on
# purpose. A bare unanchored `GO`/`NO-GO` is deliberately NOT a match: review targets here contain literal
# GO/NO-GO tokens (this gate reviews go/no-go gate code), so a quoted enum must not be read as a decision,
# and a review that merely quotes both tokens must not trip conflict detection (cold-panel finding
# 2026-07-21). Do NOT reuse this for the receipt: that stays presence-matched.
normalise_verdict_line() {
  printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z-]+/ /g; s/^ +//; s/ +$//'
}

# Reads the verdict file line by line; sets VERDICT_VALUE + INSPECTED_SCOPE, or returns non-zero with a
# reason in VERDICT_CONTRACT_ERROR. Two DIFFERENT explicit decisions are ambiguous → reject (safe).
verify_verdict_contract() {
  local file="$1" line norm candidate scope_body
  VERDICT_VALUE=""; INSPECTED_SCOPE=""; VERDICT_CONTRACT_ERROR=""
  while IFS= read -r line || [ -n "$line" ]; do
    norm="$(normalise_verdict_line "$line")"
    candidate=""
    case "$norm" in
      'verdict go'|'verdict is go'|'overall verdict go'|'overall verdict is go'|'final verdict go'|'final verdict is go')
        candidate=GO ;;
      'verdict no-go'|'verdict no go'|'verdict is no-go'|'verdict is no go'|'overall verdict no-go'|'overall verdict no go'|'overall verdict is no-go'|'overall verdict is no go'|'final verdict no-go'|'final verdict no go'|'final verdict is no-go'|'final verdict is no go')
        candidate=NO-GO ;;
    esac
    if [ -n "$candidate" ]; then
      if [ -n "$VERDICT_VALUE" ] && [ "$VERDICT_VALUE" != "$candidate" ]; then
        VERDICT_CONTRACT_ERROR="conflicting explicit verdict lines ($VERDICT_VALUE and $candidate)"
        return 1
      fi
      VERDICT_VALUE="$candidate"
    fi
    case "$norm" in
      'inspected scope '*) scope_body="${norm#inspected scope }" ;;
      'scope inspected '*) scope_body="${norm#scope inspected }" ;;
      *) scope_body="" ;;
    esac
    if [[ "$scope_body" == *[a-z]* ]]; then INSPECTED_SCOPE="$line"; fi
  done < "$file"
  if [ -z "$VERDICT_VALUE" ]; then
    VERDICT_CONTRACT_ERROR="missing explicit VERDICT: GO or VERDICT: NO-GO line"
    return 1
  fi
  if [ -z "$INSPECTED_SCOPE" ]; then
    VERDICT_CONTRACT_ERROR="missing nonempty INSPECTED SCOPE line"
    return 1
  fi
  return 0
}
{
  printf '%s\n\n' "$HYGIENE"
  if [ -n "$PROMPT_FILE" ]; then cat -- "$PROMPT_FILE"; else printf '%s\n' "$PROMPT"; fi
  printf '\n\n--- GATE VERDICT CONTRACT (required — a receipt alone is NOT a verdict) ---\n'
  printf 'End your review with an explicit decision and the scope you actually inspected, as two plain lines\n'
  printf '(no bullet, no code fence, no JSON):\n'
  printf 'VERDICT: GO          (or exactly  VERDICT: NO-GO)\n'
  printf 'INSPECTED SCOPE: <the specific files, diff, and context you actually read or ran>\n'
  printf '\n--- GATE RECEIPT (mechanical completion check) ---\n'
  printf 'Then, as the very last line of your final message, echo this exact line:\nRECEIPT: %s\n' "$RECEIPT"
} > "$PROMPT_TMP"

# A sidecar, when present, must always name the thread of the run that produced OUT — otherwise the
# documented warm recipe could resume an EARLIER ladder's (live) thread. Clear it before every run.
rm -f "$OUT.thread"

MODE_LABEL="FULL(cold)"; [ -n "$RESUME_ID" ] && MODE_LABEL="WARM(resume=$RESUME_ID)"
echo "codex-gate: mode=$MODE_LABEL model=$MODEL effort=$EFFORT repo=$REPO out=$OUT guard=ON (PIL_BLOCK_CLAUDE_COMPANION=1; shim=$GUARD_DIR/claude; anthropic keys emptied)" >&2

# Codex runs in the BACKGROUND so an independent watchdog can enforce a hard self-timeout: a stalled
# init (20-27 min silent hangs were seen on some CLI/host states) becomes a BOUNDED, LOUD, fail-closed
# exit instead of an unbounded silent block. The watchdog TERM/KILLs codex and its direct MCP children.
set +e
if [ -n "$RESUME_ID" ]; then
  # `codex exec resume` has no -s and no -C: force the sandbox via config, and cd into the repo.
  # CDPATH= : an exported CDPATH could otherwise send a relative -C to a different same-named dir.
  # `exec` REPLACES the cd-subshell with codex, so $! below is codex's own PID (not a wrapper
  # subshell's) — the watchdog then TERM/KILLs codex directly, symmetric with the fresh branch.
  ( CDPATH= cd -- "$REPO" && PATH="$GUARD_DIR:$PATH" PIL_BLOCK_CLAUDE_COMPANION=1 PIL_GUARD_HIT_FILE="$GUARD_HIT" ANTHROPIC_API_KEY="" CLAUDE_API_KEY="" \
      exec codex exec resume "$RESUME_ID" -c sandbox_mode=read-only --disable code_mode_host \
        -m "$MODEL" -c model_reasoning_effort="$EFFORT" -o "$OUT" - < "$PROMPT_TMP" ) &
else
  # --json puts the event stream on stdout (captured) so the thread id is machine-readable; the
  # verdict still lands in -o and live progress stays on stderr.
  PATH="$GUARD_DIR:$PATH" PIL_BLOCK_CLAUDE_COMPANION=1 PIL_GUARD_HIT_FILE="$GUARD_HIT" ANTHROPIC_API_KEY="" CLAUDE_API_KEY="" \
    codex exec -s read-only --disable code_mode_host -m "$MODEL" -c model_reasoning_effort="$EFFORT" \
      -C "$REPO" --json -o "$OUT" < "$PROMPT_TMP" > "$JSONL_TMP" &
fi
CODEX_PID=$!
# Independent watchdog: after $TIMEOUT, if codex is still alive, TERM then KILL it and its direct
# children. The TIMED_OUT marker is ADVISORY — it only selects the "timed out" error message; SAFETY
# never depends on it. A watchdog-killed codex yields a non-zero `wait` status (exit "$rc" below), and
# exit 0 additionally requires a fresh-receipt-verified verdict in OUT, so no marker state can produce
# a false GO. Accepted, bounded limits of a pure-bash watchdog: the microsecond `&`->`$!` and
# kill-0->kill windows are irreducible (worst case a rare orphan, or — only under near-impossible PID
# reuse — a stray signal; never a false GO), and an MCP server nested under a non-exec shell/runner is
# a grandchild `pkill -P` won't reach (codex's own TERM tears its tree down). A verdict landing the
# instant the deadline expires may be discarded — safe-direction. Raise -t for legitimately deep passes.
( sleep "$TIMEOUT"
  kill -0 "$CODEX_PID" 2>/dev/null || exit 0
  printf 'timeout\n' > "$TIMED_OUT"
  kill -TERM "$CODEX_PID" 2>/dev/null; pkill -TERM -P "$CODEX_PID" 2>/dev/null
  sleep 5
  kill -KILL "$CODEX_PID" 2>/dev/null; pkill -KILL -P "$CODEX_PID" 2>/dev/null ) &
WATCHDOG_PID=$!
wait "$CODEX_PID"; rc=$?
# codex is done (or was killed): retire the watchdog so it can't later fire against a recycled PID.
# pkill -P first kills the watchdog's live `sleep` child — killing only the subshell would orphan it,
# leaking a `sleep $TIMEOUT` until its natural deadline. A woken watchdog then hits kill-0 on the
# now-dead codex and exits without acting.
pkill -P "$WATCHDOG_PID" 2>/dev/null; kill "$WATCHDOG_PID" 2>/dev/null; wait "$WATCHDOG_PID" 2>/dev/null
WATCHDOG_PID=""; CODEX_PID=""
set -e

if [ -s "$TIMED_OUT" ]; then
  echo "codex-gate: ERROR — the gate hit its ${TIMEOUT}s self-timeout with no completed verdict; codex was killed (fail-closed). Do NOT treat this as a GO. For a legitimately deep pass raise -t (or \$CODEX_GATE_TIMEOUT), and/or launch the gate DETACHED and poll (core/GATES.md)." >&2
  exit 3
fi

# Fail LOUD if the gate did not actually produce a Codex verdict — a blocked hijack (or a codex error)
# can leave an empty/absent -o that must NOT be silently read as a pass.
if [ -s "$GUARD_HIT" ]; then
  echo "codex-gate: WARNING — the Claude companion was BLOCKED mid-run (a review hijack was attempted; the cc@sendbird plugin is installed). Scrutinize the verdict, and ideally remove the plugin (it is dev-time-only)." >&2
fi
if [ ! -s "$OUT" ]; then
  if [ -n "$RESUME_ID" ]; then
    echo "codex-gate: ERROR — the warm resume produced no verdict (codex exit $rc). If codex reported 'no rollout found', the thread id is STALE/DEAD — do NOT retry it; run a fresh FULL pass." >&2
  else
    echo "codex-gate: ERROR — no verdict was written to $OUT (codex exit $rc). The gate produced no Codex review — do NOT treat this as a pass." >&2
  fi
  exit 3
fi
# The receipt is per-round, so this also rejects a stale OUT left by an earlier run.
if ! grep -qF -- "$RECEIPT" "$OUT"; then
  echo "codex-gate: ERROR — verdict written but this round's RECEIPT is MISSING (agentic drift / incomplete run, or a stale $OUT). Do NOT treat this as a pass; re-run the round." >&2
  exit 3
fi

# Workflow v2 Phase 4B — the receipt proves the reply COMPLETED, not that a DECISION was stated. Require
# an explicit GO/NO-GO verdict AND a claimed inspected scope, or FAIL CLOSED (exit 3 — the same class as a
# missing receipt). This binds BOTH warm and full rounds: a warm re-verdict must still state a decision.
if ! verify_verdict_contract "$OUT"; then
  echo "codex-gate: ERROR — output written and this round's RECEIPT verified, but the VERDICT CONTRACT is unmet: $VERDICT_CONTRACT_ERROR. A receipt proves the reply completed, not that a decision was stated. Do NOT treat this as a pass — re-run the round and ensure the reviewer emits an explicit 'VERDICT: GO'/'VERDICT: NO-GO' line and an 'INSPECTED SCOPE:' line." >&2
  exit 3
fi
echo "codex-gate: verdict contract OK — decision=$VERDICT_VALUE; inspected scope stated." >&2

if [ -n "$RESUME_ID" ]; then
  echo "codex-gate: WARM round complete (receipt verified) on thread $RESUME_ID." >&2
  echo "codex-gate: REMINDER — warm rounds NEVER substitute for the mandated full COLD final pass (core/GATES.md)." >&2
else
  THREAD_ID="$(grep -m1 '"thread.started"' "$JSONL_TMP" 2>/dev/null | grep -o '"thread_id":"[^"]*"' | head -n 1 | cut -d'"' -f4 || true)"
  if [ -n "$THREAD_ID" ]; then
    printf '%s\n' "$THREAD_ID" > "$OUT.thread"
    echo "codex-gate: FULL pass complete (receipt verified). thread=$THREAD_ID (sidecar: $OUT.thread)" >&2
    echo "codex-gate: warm delta rounds: scripts/codex-gate.sh -o OUT2 -C REPO --resume $THREAD_ID -f DELTA_PROMPT" >&2
  else
    echo "codex-gate: WARNING — thread id not captured; warm resume unavailable for this run (verdict unaffected)." >&2
  fi
fi
exit "$rc"
