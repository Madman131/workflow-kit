#!/usr/bin/env bash
# cold-review-gemini.sh — CROSS-FAMILY cold review via Gemini (Antigravity CLI / `agy`).
#
# Its value is DECORRELATED blind spots: a different weight family catches what same-family Opus reviewers miss alike.
# Two modes — pick by what you're gating:
#
#   CODE gate (a real code diff exists) — DEFAULT:
#       bash scripts/cold-review-gemini.sh --context docs/journal/<feature>_design.md
#     Snapshots the caller tree into a SHA-pinned detached worktree, then reviews that artifact's
#     diff against: PIL invariants + the design + the FULL changed files.
#
#   DESIGN gate (NO code yet — reviewing a design/spec doc itself) — USE --design:
#       bash scripts/cold-review-gemini.sh --design docs/journal/<feature>_design.md \
#                                          --folded docs/journal/<feature>_cold_review.md
#     Feeds the DESIGN as THE ARTIFACT under review + PIL invariants + "what same-family reviewers already folded
#     (hunt what they MISSED)". This is where the lens earns its keep.
#
# ⚠ LESSON (2026-06-26): diff-mode on a DOCS-ONLY changeset with TRACKED doc edits grades ONLY the doc diff (the
# wrong lens — no code artifact) and returns an unhelpful "docs only, SAFE" (a purely-UNTRACKED doc change is an
# empty diff → exits early, nothing reviewed). At a design gate you MUST use --design. The diff run found nothing useful; the --design run
# caught FIVE real issues the 3-person Opus panel missed (unbounded proposal growth; FTS rebuild inside the global
# write lock; silent dedupe data-loss; validate-vs-stamp timing break; an §8↔§12 lock contradiction). Crystallized here.
#
# READ-ONLY w.r.t. caller code/git/Render. A real invocation first builds a private-index snapshot
# commit and reviews only its detached worktree; the caller tree may change without changing the
# artifact. Persistent side-effect: appends a typed attempt to docs/journal/gemini_review_log.md
# (excluded from the diff payload) for the payload-tuning loop — suppress with --no-log. For a large
# payload it also writes a short-lived temp file (mktemp -d, removed on exit) that agy reads via --add-dir.
# Auth/model use your own Google AI Pro session cached by `agy`.
#
#   --dry-run   print the assembled payload+prompt, don't call Gemini
#   --no-log    don't append a durable attempt record (diagnostics only; not a release receipt)
#   --slice-manifest <json> --slice <name>
#               run one slice from a PM-approved, complete coverage plan
#   --selftest  run the deterministic fake-agy reliability harness (no network/model call)
set -uo pipefail

MODEL="Gemini 3.1 Pro (High)"
MAX_FILE_BYTES=120000
CANARY_SPAN=32768
CANARY_MIN=2
CANARY_MAX=32
INLINE_INGEST_MAX_DEFAULT=81920

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO_ROOT="$(cd -P "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$SOURCE_REPO_ROOT"
REVIEW_SCRIPT_DIR="$SCRIPT_DIR"
cd "$REPO_ROOT"

# ---- args ----
CONTEXT_FILE="${GEMINI_REVIEW_CONTEXT:-}"
DESIGN_FILE=""; DESIGN_FILE_CANONICAL=""; FOLDED_SRC=""; FOLDED_SRC_CANONICAL=""; FOLDED_IS_FILE=0; CONTEXT_FILE_CANONICAL=""; SLICE_MANIFEST=""; SLICE_MANIFEST_CANONICAL=""; SLICE_NAME=""; FINALIZE_SLICES=0; DRY_RUN=0; DO_LOG=1; SELFTEST=0
require_option_value() {
  [ "$#" -ge 2 ] || { echo "cold-review-gemini: $1 requires a value." >&2; exit 2; }
}
while [ $# -gt 0 ]; do
  case "$1" in
    --context) require_option_value "$@"; CONTEXT_FILE="$2"; shift 2 ;;
    --design)  require_option_value "$@"; DESIGN_FILE="$2"; shift 2 ;;
    --folded)  require_option_value "$@"; FOLDED_SRC="$2"; shift 2 ;;
    --slice-manifest) require_option_value "$@"; SLICE_MANIFEST="$2"; shift 2 ;;
    --slice) require_option_value "$@"; SLICE_NAME="$2"; shift 2 ;;
    --finalize-slices) FINALIZE_SLICES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-log)  DO_LOG=0; shift ;;
    --selftest) SELFTEST=1; shift ;;
    *) echo "cold-review-gemini: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

if [ "$SELFTEST" = "1" ]; then
  [ "$#" -eq 0 ] || { echo "cold-review-gemini: --selftest does not accept additional arguments." >&2; exit 2; }
  exec /bin/bash "$SCRIPT_DIR/cold-review-gemini-selftest.sh"
fi

if [ "$FINALIZE_SLICES" = "1" ]; then
  [ -n "$SLICE_MANIFEST" ] && [ -z "$SLICE_NAME" ] || { echo "cold-review-gemini: --finalize-slices requires --slice-manifest and forbids --slice." >&2; exit 2; }
  [ "$DRY_RUN" = "0" ] && [ "$DO_LOG" = "1" ] && [ -z "$CONTEXT_FILE" ] && [ -z "$FOLDED_SRC" ] || { echo "cold-review-gemini: --finalize-slices is a durable aggregate only; do not combine it with --dry-run, --no-log, --context, or --folded." >&2; exit 2; }
elif { [ -n "$SLICE_MANIFEST" ] && [ -z "$SLICE_NAME" ]; } || { [ -z "$SLICE_MANIFEST" ] && [ -n "$SLICE_NAME" ]; }; then
  echo "cold-review-gemini: --slice-manifest and --slice must be used together." >&2; exit 2
fi
if [ -n "$DESIGN_FILE" ] && [ -n "$SLICE_MANIFEST" ]; then
  echo "cold-review-gemini: slicing is code-mode only; do not combine --design with --slice-manifest." >&2; exit 2
fi

# ── CODE MODE IS RESERVED FOR THE CODEX-AS-BUILDER LADDER (owner decision, 2026-07-15) ──
# Claude is the Builder → the code gate is CODEX (scripts/codex-gate.sh).
# CODEX is the Builder  → Codex cannot gate itself, so GEMINI *is* the cross-family
#                         lens (core/BINDINGS.md); run it with
#                         GEMINI_ALLOW_CODE_MODE=1. That is SANCTIONED, not a hack.
#
# WHY, from this log's own 113 attempts: design mode holds the one documented
# breakthrough (5 real issues an Opus panel missed, 2026-06-26); code mode holds
# the documented "the diff run found nothing useful", and its last outing returned
# two LOWs — one a comment nit the Builder had already predicted, one declined —
# on the same change where Codex found a BLOCKER + a HIGH that three Claude
# reviewers missed.
#
# WHY IT IS STRUCTURAL, not a tuning problem: `agy` is an AGENT HARNESS, not a
# review endpoint — `--help` offers no way to disable tool use (`--mode plan` and
# `--sandbox` restrain the loop; they do not remove it). Sat in a repo with
# `npm test` in reach, it drifts: the 2026-07-15 failure delivered its payload
# fine (it quoted the frozen SHA back) and then spent its whole --print-timeout
# "executing npm test" and "switching the repository to the frozen SHA", never
# emitted the receipt, and CONFABULATED test results it never produced. Three
# hardening passes targeted DELIVERY — the axis that was already working. A design
# payload is a document with nothing to run, which is the mode that fits the tool.
#
# The receipt still fail-closes either way; this refuses BEFORE spending the call.
if [ -z "$DESIGN_FILE" ] && [ "$SELFTEST" = "0" ] && [ "$DRY_RUN" = "0" ] && [ -z "${GEMINI_ALLOW_CODE_MODE:-}" ]; then
  cat >&2 <<'MSG'
cold-review-gemini: CODE MODE is reserved — pick by WHO BUILT the change.

  Design gate (any Builder):
    bash scripts/cold-review-gemini.sh --design docs/journal/<feature>_design.md \
                                       --folded docs/journal/<feature>_cold_review.md

  Code gate, CLAUDE-as-Builder → use CODEX (core/GATES.md):
    scripts/codex-gate.sh -o OUT -m gpt-5.6-terra -e xhigh -C <repo> -f PROMPT.md

  Code gate, CODEX-as-Builder → Codex cannot gate itself, so GEMINI IS the
  cross-family lens here (core/BINDINGS.md). SANCTIONED:
    GEMINI_ALLOW_CODE_MODE=1 bash scripts/cold-review-gemini.sh --context <design.md>

Rationale: for a CLAUDE-built change Codex is measurably the better code gate (it
found a BLOCKER + HIGH that three Claude reviewers missed, where Gemini returned
two LOWs). `agy` is also an agent harness with no tool-disable flag, so in a repo
it can drift off-task and confabulate — the receipt fail-closes that. Neither fact
removes Gemini's role when CODEX is the Builder. See core/GATES.md.
MSG
  exit 2
fi

START_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ATTEMPT_ID="PIL-GATE-$(date +%s)-$$-${RANDOM}${RANDOM}"
HEAD_SHA="$(git -C "$SOURCE_REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
ARTIFACT_BASE_SHA="$HEAD_SHA"; ARTIFACT_SHA=""; ARTIFACT_REF=""; FROZEN_WORKTREE=""; ARTIFACT_WAS_DETACHED=0; FREEZE_INDEX=""
LOG="$SOURCE_REPO_ROOT/docs/journal/gemini_review_log.md"
TMPD=""; LOCK_DIR=""; LOCK_HELD=0; SUPERVISOR_PID=""; ATTEMPT_RECORDED=0
DELIVERY="UNSELECTED"; PAYLOAD_BYTES=0; COMBINED_BYTES=0; FILE_BYTES=0; REVIEW=""; RECEIPT=""
SLICE_NORMALIZED=""; ATTEMPT_DETAIL=""
PLAN_ID=""; RECORD_KIND="FULL_REVIEW"; RELEASE_GATE="YES"
VERDICT_VALUE=""; INSPECTED_SCOPE=""; VERDICT_CONTRACT_ERROR=""

# Gate inputs are part of the artifact, not ambient caller-tree state. MODEL 1 is the realistic PIL
# multi-writer caller tree: an attacker can change it during the gate but cannot change private
# $TMPD frozen bytes. MODEL 2 also reaches the frozen worktree mid-review; re-resolving and reading
# one canonical pathname closes those windows in defense in depth. Capture every file-valued argument
# as a source-root-relative path before snapshotting; after the detached checkout those same relative
# paths name only frozen bytes. This also rejects absolute/out-of-repo paths and symlinks that escape
# the artifact instead of silently treating them as review material.
resolve_inside_repo() {
  local variable="$1" source_path="$2" root="$3" label="$4" root_label="$5" canonical_variable="${6:-}" canonical root_canonical resolved_relative
  root_canonical="$(perl -MCwd=abs_path -e 'my $path = abs_path($ARGV[0]); exit 1 unless defined $path; print $path' "$root")" \
    || { ATTEMPT_DETAIL="cannot canonicalize $root_label root: $root"; return 1; }
  canonical="$(perl -MCwd=abs_path -e 'my $path = abs_path($ARGV[0]); exit 1 unless defined $path; print $path' "$source_path")" \
    || { ATTEMPT_DETAIL="cannot canonicalize $label: $source_path"; return 1; }
  case "$canonical" in
    "$root_canonical"/*) resolved_relative="${canonical#"$root_canonical"/}" ;;
    *) ATTEMPT_DETAIL="$label must resolve inside the $root_label: $source_path"; return 1 ;;
  esac
  printf -v "$variable" '%s' "$resolved_relative"
  [ -z "$canonical_variable" ] || printf -v "$canonical_variable" '%s' "$canonical"
  return 0
}

bind_frozen_repo_file() {
  local variable="$1" label="$2" value source_path relative
  value="${!variable}"
  [ -n "$value" ] || return 0
  case "$value" in
    /*) source_path="$value" ;;
    *) source_path="$SOURCE_REPO_ROOT/$value" ;;
  esac
  [ -f "$source_path" ] || { ATTEMPT_DETAIL="$label file not found: $value"; return 1; }
  resolve_inside_repo relative "$source_path" "$SOURCE_REPO_ROOT" "$label file" "caller repository" || return 1
  if [ "$relative" = "docs/journal/gemini_review_log.md" ]; then
    ATTEMPT_DETAIL="the durable Gemini review log is never a review input: $value"
    return 1
  fi
  printf -v "$variable" '%s' "$relative"
}

bind_frozen_inputs() {
  bind_frozen_repo_file DESIGN_FILE '--design' || return 1
  bind_frozen_repo_file CONTEXT_FILE '--context' || return 1
  bind_frozen_repo_file SLICE_MANIFEST '--slice-manifest' || return 1
  [ -n "$FOLDED_SRC" ] || return 0
  local folded_candidate
  case "$FOLDED_SRC" in
    /*) folded_candidate="$FOLDED_SRC" ;;
    *) folded_candidate="$SOURCE_REPO_ROOT/$FOLDED_SRC" ;;
  esac
  if [ -f "$folded_candidate" ]; then
    bind_frozen_repo_file FOLDED_SRC '--folded' || return 1
    FOLDED_IS_FILE=1
  fi
}

rebind_frozen_repo_file() {
  local variable="$1" label="$2" value relative canonical_variable
  value="${!variable}"
  [ -n "$value" ] || return 0
  canonical_variable="${variable}_CANONICAL"
  resolve_inside_repo relative "$REPO_ROOT/$value" "$REPO_ROOT" "$label file" "frozen repository" "$canonical_variable" || {
    ATTEMPT_DETAIL="$label file must resolve to a regular file inside the frozen repository: $value"
    return 1
  }
  [ -f "${!canonical_variable}" ] || {
    ATTEMPT_DETAIL="$label file must resolve to a regular file inside the frozen repository: $value"
    return 1
  }
  return 0
}

rebind_frozen_inputs() {
  # MODEL 1 can swap an accepted caller-tree path before git add -A snapshots it. Containment is a
  # frozen-artifact property, so rebind every post-freeze file input to the frozen canonical path.
  # MODEL 2 can retarget a symbolic path in the frozen worktree; later reads use these canonicals.
  rebind_frozen_repo_file DESIGN_FILE '--design' || return 1
  rebind_frozen_repo_file CONTEXT_FILE '--context' || return 1
  rebind_frozen_repo_file SLICE_MANIFEST '--slice-manifest' || return 1
  if [ "$FOLDED_IS_FILE" = "1" ]; then
    rebind_frozen_repo_file FOLDED_SRC '--folded' || return 1
  fi
  return 0
}

refuse_hardlinked_durable_log() {
  # D3: a hardlink alias shares the log's inode/bytes under a different PATH, so a path-only exclusion
  # misses it and `git add -A` bakes the log content into the snapshot under the alias. Forbid extra
  # hard links so no alias can carry the log bytes into ANY payload route (CLI, changed-source, slice).
  [ -f "$LOG" ] || return 0
  local nlink
  nlink="$(stat -f %l "$LOG" 2>/dev/null || stat -c %h "$LOG" 2>/dev/null || echo 1)"
  case "$nlink" in ''|*[!0-9]*) nlink=1 ;; esac
  if [ "$nlink" -gt 1 ]; then
    ATTEMPT_DETAIL="the durable Gemini review log has $nlink hard links; refuse until the extra link(s) are removed (a hardlink alias could deliver the log bytes as review material)"
    return 1
  fi
  return 0
}

lock_owner_value() {
  local key="$1"
  [ -f "$LOCK_DIR/owner" ] || return 1
  sed -n "s/^${key}=//p" "$LOCK_DIR/owner" | head -n 1
}

recover_stale_lock() {
  local moved="${LOCK_DIR}.stale.$$.$RANDOM"
  if mv "$LOCK_DIR" "$moved" 2>/dev/null; then
    rm -rf "$moved"
    echo "cold-review-gemini: recovered stale single-flight guard." >&2
    return 0
  fi
  return 1
}

acquire_single_flight() {
  local common owner_tmp owner_pid owner_start owner_repo owner_command owner_pid_live supervisor_owner_pid supervisor_owner_start supervisor_owner_command current_start current_command self_start self_command attempt age now mtime
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || { echo "cold-review-gemini: cannot resolve git common directory." >&2; exit 2; }
  case "$common" in /*) ;; *) common="$REPO_ROOT/$common" ;; esac
  common="$(cd "$common" 2>/dev/null && pwd -P)" || { echo "cold-review-gemini: cannot canonicalize git common directory." >&2; exit 2; }
  self_start="$(ps -p $$ -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//')"
  [ -n "$self_start" ] || { echo "cold-review-gemini: cannot establish process-start identity for the single-flight guard." >&2; exit 3; }
  self_command="$(ps -p $$ -o command= 2>/dev/null | sed 's/^ *//;s/ *$//')"
  [ -n "$self_command" ] || { echo "cold-review-gemini: cannot establish process-command identity for the single-flight guard." >&2; exit 3; }
  LOCK_DIR="$common/cold-review-gemini.lock"
  attempt=0
  while [ "$attempt" -lt 4 ]; do
    attempt=$((attempt + 1))
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      owner_tmp="$LOCK_DIR/owner.tmp.$$"
      {
        echo "pid=$$"
        echo "start=$self_start"
        echo "repo=$common"
        echo "script=$SCRIPT_DIR/cold-review-gemini.sh"
        echo "command=$self_command"
      } > "$owner_tmp" || { rm -rf "$LOCK_DIR"; echo "cold-review-gemini: cannot write single-flight owner record." >&2; exit 3; }
      mv "$owner_tmp" "$LOCK_DIR/owner" || { rm -rf "$LOCK_DIR"; echo "cold-review-gemini: cannot publish single-flight owner record." >&2; exit 3; }
      LOCK_HELD=1
      return 0
    fi

    if [ ! -f "$LOCK_DIR/owner" ]; then
      now="$(date +%s)"; mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo "$now")"
      age=$((now - mtime))
      if [ "$age" -lt 10 ]; then
        echo "cold-review-gemini: another invocation is acquiring the per-repo single-flight guard; retry shortly ($LOCK_DIR)." >&2
        exit 4
      fi
      recover_stale_lock && continue
      continue
    fi

    owner_pid="$(lock_owner_value pid || true)"; owner_start="$(lock_owner_value start || true)"; owner_repo="$(lock_owner_value repo || true)"; owner_command="$(lock_owner_value command || true)"
    case "$owner_pid" in ''|*[!0-9]*) recover_stale_lock && continue; continue ;; esac
    owner_pid_live=0
    if kill -0 "$owner_pid" 2>/dev/null; then
      owner_pid_live=1
      current_start="$(ps -p "$owner_pid" -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//')"
      current_command="$(ps -p "$owner_pid" -o command= 2>/dev/null | sed 's/^ *//;s/ *$//')"
      if [ "$owner_repo" = "$common" ] && [ -n "$owner_start" ] && [ "$current_start" = "$owner_start" ] && [ -n "$owner_command" ] && [ "$current_command" = "$owner_command" ]; then
        echo "cold-review-gemini: another live invocation owns this repository gate (pid $owner_pid). Wait for it or terminate that exact runner; guard: $LOCK_DIR" >&2
        exit 4
      fi
    fi
    supervisor_owner_pid="$(lock_owner_value supervisor_pid || true)"; supervisor_owner_start="$(lock_owner_value supervisor_start || true)"; supervisor_owner_command="$(lock_owner_value supervisor_command || true)"
    case "$supervisor_owner_pid" in ''|*[!0-9]*) ;; *)
      if kill -0 "$supervisor_owner_pid" 2>/dev/null; then
        current_start="$(ps -p "$supervisor_owner_pid" -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//')"
        current_command="$(ps -p "$supervisor_owner_pid" -o command= 2>/dev/null | sed 's/^ *//;s/ *$//')"
        if [ "$owner_repo" = "$common" ] && [ -n "$supervisor_owner_start" ] && [ "$current_start" = "$supervisor_owner_start" ] && [ -n "$supervisor_owner_command" ] && [ "$current_command" = "$supervisor_owner_command" ]; then
          echo "cold-review-gemini: a live supervisor still owns or is tearing down this repository gate (pid $supervisor_owner_pid). Wait for its targeted cleanup; guard: $LOCK_DIR" >&2
          exit 4
        fi
      fi
      ;;
    esac
    if [ "$owner_pid_live" = "0" ]; then
      now="$(date +%s)"; mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo "$now")"
      age=$((now - mtime))
      if [ "$age" -lt 10 ]; then
        echo "cold-review-gemini: a fresh owner died during supervisor startup; refusing overlap until the bounded handoff settles ($LOCK_DIR)." >&2
        exit 4
      fi
    fi
    recover_stale_lock && continue
  done
  echo "cold-review-gemini: could not safely acquire the per-repo single-flight guard: $LOCK_DIR" >&2
  exit 4
}

record_attempt() {
  local status="$1" body="${2:-}" end_time context_label append_rc effective_release
  [ "$ATTEMPT_RECORDED" = "0" ] || return 0
  ATTEMPT_RECORDED=1
  [ "$DO_LOG" = "1" ] || return 0
  end_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  effective_release="$RELEASE_GATE"
  [ "$status" = "PASS_VERDICT" ] || effective_release=NO
  context_label="${DESIGN_FILE:+design:$DESIGN_FILE}${CONTEXT_FILE:+ context:$CONTEXT_FILE}"
  [ -n "$context_label" ] || context_label="(none)"
  {
    echo
    echo "## Gemini gate attempt — $status — $end_time"
    echo
    echo "- Status: \`$status\`"
    echo "- Attempt-ID: \`$ATTEMPT_ID\`"
    echo "- Record-Kind: \`$RECORD_KIND\`"
    echo "- Release-Gate: \`$effective_release\`"
    [ -n "$PLAN_ID" ] && echo "- Plan-ID: \`$PLAN_ID\`"
    echo "- Delivery: \`$DELIVERY\`"
    echo "- Bytes: raw_payload=${RAW_PAYLOAD_BYTES:-0}; instrumented_payload=$PAYLOAD_BYTES; inline_combined=$COMBINED_BYTES; file=$FILE_BYTES"
    echo "- Ingestion proof: EOF receipt + ${CANARY_N:-0} distributed random canary token(s)"
    echo "- Model: $MODEL"
    echo "- Context/design: $context_label"
    echo "- HEAD: \`$HEAD_SHA\`"
    echo "- Artifact-Base: \`${ARTIFACT_BASE_SHA:-unfrozen}\`"
    echo "- Artifact-SHA: \`${ARTIFACT_SHA:-unfrozen}\`"
    [ -n "$ARTIFACT_REF" ] && echo "- Artifact-Ref: \`$ARTIFACT_REF\`"
    echo "- Artifact-Worktree: \`$([ "${ARTIFACT_WAS_DETACHED:-0}" = "1" ] && printf detached || printf none)\`"
    [ -n "$VERDICT_VALUE" ] && echo "- Gate-Verdict: \`$VERDICT_VALUE\`"
    [ -n "$INSPECTED_SCOPE" ] && echo "- Inspected-Scope: $INSPECTED_SCOPE"
    echo "- Start: $START_TIME"
    echo "- End: $end_time"
    if [ -n "$SLICE_NAME" ]; then echo "- Slice: \`$SLICE_NAME\` from \`$SLICE_MANIFEST\`"; else echo "- Slice: (none; full artifact)"; fi
    if [ -n "$SLICE_NORMALIZED" ] && [ -f "$SLICE_NORMALIZED" ]; then
      echo
      echo "### Normalized slice manifest"
      echo
      sed 's/^/    /' "$SLICE_NORMALIZED"
    fi
    echo
    if [ "$status" = "PASS_VERDICT" ] && [ "$RECORD_KIND" = "SLICE_RESULT" ]; then echo "### Verified slice verdict — NOT A COMPLETE GATE"
    elif [ "$status" = "PASS_VERDICT" ] && [ "$RECORD_KIND" = "SLICE_SET" ]; then echo "### Verified bounded-slice-set verdict"
    elif [ "$status" = "PASS_VERDICT" ]; then echo "### Verified review verdict"
    else echo "### Diagnostic output — NOT A VERDICT"; fi
    echo
    if [ -n "$body" ]; then printf '%s\n' "$body" | sed 's/^/    /'; else echo "    (no output)"; fi
  } >> "$LOG"
  append_rc=$?
  if [ "$append_rc" -ne 0 ]; then
    echo "cold-review-gemini: could not append durable $status attempt to $LOG; this run is NOT a release verdict." >&2
    return 1
  fi
  echo "[cold-review-gemini] recorded $status in $LOG" >&2
}

run_gc_sweep() {
  # D4: opportunistic lifecycle GC of refs/pil/gate-artifacts/*. Best-effort maintenance — it must
  # NEVER turn a verified verdict into a failure, so it is fully non-fatal. $SCRIPT_DIR (not the frozen
  # REVIEW_SCRIPT_DIR, which is gone after cleanup) is the stable tool path; $SOURCE_REPO_ROOT owns the
  # refs. The current run's artifact is protected so its just-written receipt still resolves. Failed runs
  # deliberately leave their refs for the next successful sweep; the age net is the final backstop.
  [ -n "$ARTIFACT_SHA" ] || return 0
  node "$SCRIPT_DIR/gemini-gate-slices.mjs" gc --repo "$SOURCE_REPO_ROOT" --log "$LOG" \
    --protect-sha "$ARTIFACT_SHA" --prune 1>&2 2>&1 || true
}

freeze_artifact() {
  local snapshot_tree
  ARTIFACT_BASE_SHA="$(git -C "$SOURCE_REPO_ROOT" rev-parse HEAD 2>/dev/null)" \
    || { ATTEMPT_DETAIL="cannot resolve caller HEAD for the frozen review artifact"; return 1; }
  FREEZE_INDEX="$TMPD/review-artifact.index"
  rm -f "$FREEZE_INDEX" "$FREEZE_INDEX.lock"
  GIT_INDEX_FILE="$FREEZE_INDEX" git -C "$SOURCE_REPO_ROOT" read-tree "$ARTIFACT_BASE_SHA" \
    || { ATTEMPT_DETAIL="cannot seed the private review-artifact index"; return 1; }
  # Snapshot the caller tree without touching its real index. The durable Gemini log is a prior
  # verdict record, never review material; retain its base-tree entry so it cannot pollute a later
  # gate or make a reviewer repeat a stale verdict.
  GIT_INDEX_FILE="$FREEZE_INDEX" git -C "$SOURCE_REPO_ROOT" add -A -- . \
    || { ATTEMPT_DETAIL="cannot stage the private review-artifact index"; return 1; }
  if git -C "$SOURCE_REPO_ROOT" cat-file -e "$ARTIFACT_BASE_SHA:docs/journal/gemini_review_log.md" 2>/dev/null; then
    GIT_INDEX_FILE="$FREEZE_INDEX" git -C "$SOURCE_REPO_ROOT" reset -q "$ARTIFACT_BASE_SHA" -- docs/journal/gemini_review_log.md \
      || { ATTEMPT_DETAIL="cannot exclude the durable Gemini log from the review artifact"; return 1; }
  else
    GIT_INDEX_FILE="$FREEZE_INDEX" git -C "$SOURCE_REPO_ROOT" rm -q --cached --ignore-unmatch -- docs/journal/gemini_review_log.md \
      || { ATTEMPT_DETAIL="cannot exclude an untracked Gemini log from the review artifact"; return 1; }
  fi
  snapshot_tree="$(GIT_INDEX_FILE="$FREEZE_INDEX" git -C "$SOURCE_REPO_ROOT" write-tree 2>/dev/null)" \
    || { ATTEMPT_DETAIL="cannot write the frozen review-artifact tree"; return 1; }
  ARTIFACT_SHA="$(printf 'PIL Gemini gate review artifact\n' | \
    GIT_AUTHOR_NAME='PIL gate snapshot' GIT_AUTHOR_EMAIL='pil-gate@invalid' \
    GIT_COMMITTER_NAME='PIL gate snapshot' GIT_COMMITTER_EMAIL='pil-gate@invalid' \
    git -C "$SOURCE_REPO_ROOT" commit-tree "$snapshot_tree" -p "$ARTIFACT_BASE_SHA" 2>/dev/null)" \
    || { ATTEMPT_DETAIL="cannot create the frozen review-artifact commit"; return 1; }
  case "$ARTIFACT_SHA" in [0-9a-f][0-9a-f]*) ;; *) ATTEMPT_DETAIL="frozen review-artifact commit did not return a SHA"; return 1 ;; esac
  FROZEN_WORKTREE="$TMPD/review-artifact-worktree"
  git -C "$SOURCE_REPO_ROOT" worktree add --detach "$FROZEN_WORKTREE" "$ARTIFACT_SHA" >/dev/null 2>&1 \
    || { ATTEMPT_DETAIL="cannot create the detached review-artifact worktree"; return 1; }
  ARTIFACT_WAS_DETACHED=1
  ARTIFACT_REF="refs/pil/gate-artifacts/$ARTIFACT_SHA"
  git -C "$SOURCE_REPO_ROOT" update-ref "$ARTIFACT_REF" "$ARTIFACT_SHA" \
    || { ATTEMPT_DETAIL="cannot retain the frozen review-artifact commit"; return 1; }
  REPO_ROOT="$FROZEN_WORKTREE"
  REVIEW_SCRIPT_DIR="$REPO_ROOT/scripts"
  HEAD_SHA="$ARTIFACT_SHA"
  cd "$REPO_ROOT" || { ATTEMPT_DETAIL="cannot enter the detached review-artifact worktree"; return 1; }
}

run_slice_tool() {
  if [ -n "$ARTIFACT_SHA" ]; then
    GEMINI_GATE_ARTIFACT_PARENT="$ARTIFACT_BASE_SHA" node "$REVIEW_SCRIPT_DIR/gemini-gate-slices.mjs" "$@"
  else
    node "$REVIEW_SCRIPT_DIR/gemini-gate-slices.mjs" "$@"
  fi
}

cleanup_frozen_artifact() {
  [ -n "${FROZEN_WORKTREE:-}" ] || return 0
  cd "$SOURCE_REPO_ROOT" 2>/dev/null \
    || { ATTEMPT_DETAIL="cannot return to the caller repository for frozen-artifact cleanup"; return 1; }
  git -C "$SOURCE_REPO_ROOT" worktree remove --force "$FROZEN_WORKTREE" >/dev/null 2>&1 \
    || { ATTEMPT_DETAIL="cannot remove the frozen review-artifact worktree"; return 1; }
  FROZEN_WORKTREE=""
  if [ -n "${FREEZE_INDEX:-}" ]; then
    rm -f "$FREEZE_INDEX" "$FREEZE_INDEX.lock" \
      || { ATTEMPT_DETAIL="cannot remove the private frozen-artifact index"; return 1; }
    FREEZE_INDEX=""
  fi
}

cleanup() {
  if [ -n "${SUPERVISOR_PID:-}" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    kill -TERM "$SUPERVISOR_PID" 2>/dev/null || true
    wait "$SUPERVISOR_PID" 2>/dev/null || true
  fi
  if ! cleanup_frozen_artifact; then
    echo "cold-review-gemini: $ATTEMPT_DETAIL; preserving the temporary artifact for manual cleanup." >&2
  fi
  if [ -z "${FROZEN_WORKTREE:-}" ] && [ -n "${TMPD:-}" ] && [ -d "$TMPD" ]; then rm -rf "$TMPD"; fi
  if [ "${LOCK_HELD:-0}" = "1" ] && [ -d "$LOCK_DIR" ] && [ "$(lock_owner_value pid 2>/dev/null || true)" = "$$" ]; then rm -rf "$LOCK_DIR"; fi
}

on_signal() {
  local signal="$1" code="$2"
  ATTEMPT_DETAIL="runner received $signal; owned process tree was terminated and reaped"
  if [ -n "${SUPERVISOR_PID:-}" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    kill -"$signal" "$SUPERVISOR_PID" 2>/dev/null || kill -TERM "$SUPERVISOR_PID" 2>/dev/null || true
    wait "$SUPERVISOR_PID" 2>/dev/null || true
    SUPERVISOR_PID=""
  fi
  [ -n "$TMPD" ] && [ -f "$TMPD/review.out" ] && REVIEW="$(<"$TMPD/review.out")"
  record_attempt FAILED_TOOL "$ATTEMPT_DETAIL${REVIEW:+
$REVIEW}"
  exit "$code"
}

trap cleanup EXIT
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM

if [ "$DRY_RUN" = "0" ]; then acquire_single_flight; fi
TMPD="$(mktemp -d)" || { ATTEMPT_DETAIL="could not create a temp dir"; echo "cold-review-gemini: $ATTEMPT_DETAIL." >&2; record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"; exit 3; }
if [ "$DRY_RUN" = "0" ]; then
  if ! refuse_hardlinked_durable_log; then
    echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
    record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
    exit 3
  fi
  if ! bind_frozen_inputs; then
    echo "cold-review-gemini: $ATTEMPT_DETAIL; refusing to review ambient or out-of-artifact input." >&2
    record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
    exit 3
  fi
  if ! freeze_artifact; then
    echo "cold-review-gemini: $ATTEMPT_DETAIL; refusing to review a mutable or unpinned artifact." >&2
    record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
    exit 3
  fi
  if ! rebind_frozen_inputs; then
    echo "cold-review-gemini: $ATTEMPT_DETAIL; refusing to review out-of-artifact input." >&2
    record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
    exit 3
  fi
fi

if [ "$FINALIZE_SLICES" = "1" ]; then
  [ -f "$SLICE_MANIFEST" ] || { ATTEMPT_DETAIL="slice manifest not found: $SLICE_MANIFEST"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
  mkdir -p "$TMPD/slice"
  if ! run_slice_tool finalize --repo "$REPO_ROOT" --manifest "$SLICE_MANIFEST" --log "$LOG" --out-dir "$TMPD/slice" > "$TMPD/finalize.out" 2> "$TMPD/finalize.err"; then
    ATTEMPT_DETAIL="bounded slice-set finalization failed — NOT A VERDICT
$(<"$TMPD/finalize.err")"
    DELIVERY=AGGREGATE; RECORD_KIND=SLICE_SET; RELEASE_GATE=NO
    record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"
    cat "$TMPD/finalize.err" >&2
    exit 3
  fi
  PLAN_ID="$(<"$TMPD/slice/plan-id.txt")"
  SLICE_NORMALIZED="$TMPD/slice/manifest.json"
  SLICE_NAME="(aggregate)"
  DELIVERY=AGGREGATE; RECORD_KIND=SLICE_SET; RELEASE_GATE=YES
  ATTEMPT_DETAIL="$(<"$TMPD/finalize.out")

Aggregate receipts:
$(<"$TMPD/slice/aggregate.json")"
  if ! cleanup_frozen_artifact; then
    ATTEMPT_DETAIL="bounded slice-set finalization succeeded, but frozen-artifact cleanup failed: $ATTEMPT_DETAIL; output is NOT A VERDICT"
    echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
    record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
    exit 3
  fi
  record_attempt PASS_VERDICT "$ATTEMPT_DETAIL" || exit 3
  run_gc_sweep
  printf '%s\n' "$ATTEMPT_DETAIL"
  exit 0
fi

# The reviewer payload's invariants half. TWO files by design (Workflow v2 Phase 2):
# core/INVARIANTS.md is PORTABLE (epistemic rules + generic failure classes, kit-clean) and
# core/REPO_INVARIANTS.md holds THIS repo's concrete invariants (write lock, DuckDB index rule,
# consent gating). Both ship or the gate is not the gate it reports being.
#
# FAIL CLOSED, and to the OPERATOR. Losing ONE file is the dangerous case, not losing both: the
# payload still carries a full, plausible-looking invariants section while every rule from the
# missing half is gone, so the reviewer cannot tell and returns a confident verdict on a
# short-changed payload. A note addressed to the model is a prompt, not a control — so this refuses
# to build a payload at all, on stderr, with a nonzero exit.
INVARIANTS_FILES="core/INVARIANTS.md core/REPO_INVARIANTS.md"
missing_invariants=""
for f in $INVARIANTS_FILES; do
  [ -f "$f" ] || missing_invariants="$missing_invariants $f"
done
if [ -n "$missing_invariants" ]; then
  echo "cold-review-gemini: REFUSING to build a payload — missing invariants file(s):$missing_invariants" >&2
  echo "cold-review-gemini: the reviewer would receive a payload that LOOKS complete while the rules from the missing half are absent. Restore the file(s), or update INVARIANTS_FILES if they were deliberately renamed." >&2
  exit 2
fi
refuse_invariants_payload() {
  local detail="$1"
  ATTEMPT_DETAIL="REFUSING to build a payload — $detail"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  printf '%s\n' "$ATTEMPT_DETAIL" > "$TMPD/invariants-refusal" || true
  return 1
}
invariants() {
  local f invariant_relative invariant_canonical
  for f in $INVARIANTS_FILES; do
    resolve_inside_repo invariant_relative "$REPO_ROOT/$f" "$REPO_ROOT" "invariants file" "frozen repository" invariant_canonical \
      || { refuse_invariants_payload "$ATTEMPT_DETAIL"; return 1; }
    cat "$invariant_canonical" || { refuse_invariants_payload "cannot read invariants file: $f"; return 1; }
    echo
  done
}
# --folded may be a file path or literal text.
folded_notes() {
  local folded_path="${FOLDED_SRC_CANONICAL:-$FOLDED_SRC}"
  [ -n "$FOLDED_SRC" ] || { echo "(none provided — assume the same-family panel found nothing; hunt broadly)"; return; }
  if [ "$FOLDED_IS_FILE" = "1" ] || { [ "$DRY_RUN" = "1" ] && [ -f "$FOLDED_SRC" ]; }; then
    [ -f "$folded_path" ] || return 1
    echo "(from $FOLDED_SRC)"; echo; cat "$folded_path"
  else
    printf '%s\n' "$FOLDED_SRC"
  fi
}

is_code() { case "$1" in *.mjs|*.cjs|*.js|*.ts|*.sql|*.py|*.sh|*.go|*.yaml|*.yml) return 0 ;; *) return 1 ;; esac; }

# Delivery and ingestion are separate. Receipts prove EOF reach; these exact byte-position random
# markers sample regions from head through tail. Both transports use the same instrumentation.
canary_count_for_bytes() {
  local bytes="$1" count
  case "$bytes" in ''|*[!0-9]*) bytes=0 ;; esac
  count=$(( (bytes + CANARY_SPAN - 1) / CANARY_SPAN + 1 ))
  [ "$count" -lt "$CANARY_MIN" ] && count="$CANARY_MIN"
  [ "$count" -gt "$CANARY_MAX" ] && count="$CANARY_MAX"
  printf '%s' "$count"
}

make_canary_token() {
  local index="$1" random
  random="$(LC_ALL=C od -An -tx1 -N5 /dev/urandom 2>/dev/null | tr -d ' \n')"
  [ "${#random}" -eq 10 ] || return 1
  printf 'PIL-INGEST-%02d%s' "$index" "$random"
}

plan_canaries() {
  local raw="$1" index offset token
  CANARY_N="$(canary_count_for_bytes "$raw")"
  CANARY_TOKENS=(); CANARY_MAP=""
  index=0
  while [ "$index" -lt "$CANARY_N" ]; do
    token="$(make_canary_token "$((index + 1))")" || return 1
    CANARY_TOKENS+=("$token")
    offset=$(( index * raw / (CANARY_N - 1) ))
    CANARY_MAP="${CANARY_MAP:+$CANARY_MAP,}${offset}:${token}"
    index=$((index + 1))
  done
}

instrument_canaries() {
  local LC_ALL=C
  local payload="$1" map="$2" output="" previous=0 index=0 total length offset token entry oldifs
  local probe=$'\303\251'
  local -a entries
  [ "${#probe}" -eq 2 ] || { echo "cold-review-gemini: byte-indexed slicing unavailable; cannot place ingestion canaries." >&2; return 1; }
  oldifs="$IFS"; IFS=','; set -f; entries=( $map ); set +f; IFS="$oldifs"
  total=${#entries[@]}; length=${#payload}
  [ "$total" -ge "$CANARY_MIN" ] || return 1
  for entry in "${entries[@]}"; do
    index=$((index + 1)); offset="${entry%%:*}"; token="${entry#*:}"
    case "$offset" in ''|*[!0-9]*) return 1 ;; esac
    { [ "$offset" -ge "$previous" ] && [ "$offset" -le "$length" ]; } || return 1
    while [ "$offset" -lt "$length" ]; do
      case "${payload:offset:1}" in [$'\x80'-$'\xbf']) offset=$((offset + 1)) ;; *) break ;; esac
    done
    output="${output}${payload:previous:offset-previous}"$'\n'"[[PIL-INGEST-CANARY ${index}/${total} ${token}]]"$'\n'
    previous="$offset"
  done
  INSTRUMENTED_PAYLOAD="${output}${payload:previous}"
  return 0
}

# Ingestion proof = every canary token present, IN ENCOUNTER ORDER. Nothing more.
#
# This used to be `grep -Fqx "CANARIES: t1 t2 … tN"` — ONE line, single-spaced,
# exact. That rejected reviews that had DEMONSTRABLY read the whole artifact: the
# model listed every token but split them across lines, and the gate threw the
# review away. The rejection was self-refuting — its own diagnostic loop (which
# uses substring matching) printed "0/8 distributed canary token(s) absent ()".
# Zero absent. Full ingestion proven, discarded on line breaks. Two clean reviews
# and ~15 minutes were lost to that in one session.
#
# So: collapse whitespace and walk the reply consuming each expected token in
# turn. Presence AND order still hold — which IS the proof ("read head to tail,
# report the markers in encounter order") — while wrapping, bullets, newlines and
# double spaces can no longer fail a proof that succeeded. It is not weaker: a
# model that never read the payload has NO tokens to echo (they are random), so
# the drift catch is untouched; a missing or out-of-order token still fails.
all_canaries_present() {
  local reply="$1" rest token
  shift
  rest="$(printf '%s' "$reply" | tr -s '[:space:]' ' ')"
  for token in "$@"; do
    case "$rest" in
      *"$token"*) rest="${rest#*"$token"}" ;;  # consume through it → later tokens must follow
      *) return 1 ;;                            # absent, or out of order
    esac
  done
}

# The EOF receipt: the token, optionally carrying the SAME `RECEIPT:` label the
# payload used to present it.
#
# The payload's final line is literally `RECEIPT: <token>`, and the instruction
# says to begin the reply with "the exact random receipt token on that final
# line". A model that copies the line it was shown emits `RECEIPT: <token>` — and
# exact whole-line equality then rejected it. The tool set that trap itself.
#
# The tolerance is deliberately NARROW: only the literal `RECEIPT:` label. An
# arbitrary wrapper (`prefix-<token>-suffix`) still fails, because that is a
# separate, pinned decision (see the embedded_receipt selftest) — a model mangling
# the token is not the same as one echoing the label it was given.
receipt_line_ok() {
  local line="$1" token="$2"
  [ "$line" = "$token" ] && return 0
  [[ "$line" =~ ^RECEIPT:[[:space:]]*${token}$ ]] && return 0
  return 1
}

# A receipt proves that a response completed; it says nothing about whether the model actually
# reviewed the artifact. Require an explicit decision and a claimed inspected scope, but do not
# make typography a gate. Markdown, case, separators, and the two natural scope-label orders are
# normalised; the decision itself remains a strict two-value enum, never JSON.
normalise_verdict_line() {
  printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z-]+/ /g; s/^ +//; s/ +$//'
}

verify_verdict_contract() {
  local line norm candidate scope_body
  VERDICT_VALUE=""; INSPECTED_SCOPE=""; VERDICT_CONTRACT_ERROR=""
  while IFS= read -r line || [ -n "$line" ]; do
    norm="$(normalise_verdict_line "$line")"
    candidate=""
    case "$norm" in
      'verdict go'|'verdict is go'|'overall verdict go'|'overall verdict is go'|'final verdict go'|'final verdict is go') candidate=GO ;;
      'verdict no-go'|'verdict no go'|'verdict is no-go'|'verdict is no go'|'overall verdict no-go'|'overall verdict no go'|'overall verdict is no-go'|'overall verdict is no go'|'final verdict no-go'|'final verdict no go'|'final verdict is no-go'|'final verdict is no go') candidate=NO-GO ;;
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
  done <<< "$REVIEW"
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

emit_rejected_output() {
  [ -n "${REVIEW:-}" ] || return 0
  {
    echo "----- Diagnostic model output — NOT A VERDICT -----"
    printf '%s\n' "$REVIEW"
    echo "----- End diagnostic output — NOT A VERDICT -----"
  } >&2
}

# =========================== DESIGN MODE ===========================
if [ -n "$DESIGN_FILE" ]; then
  [ -f "${DESIGN_FILE_CANONICAL:-$DESIGN_FILE}" ] || { echo "cold-review-gemini: --design file not found: $DESIGN_FILE" >&2; exit 2; }
  LABEL="design:$DESIGN_FILE"
  build_payload() {
    echo "=== PIL PROJECT INVARIANTS (the design must not violate these) ==="; invariants || return 1
    echo; echo "=== WHAT SAME-FAMILY REVIEWERS ALREADY FOUND + FOLDED (hunt what they MISSED, not these) ==="; folded_notes || return 1
    echo; echo "=== THE DESIGN / SPEC UNDER REVIEW: $DESIGN_FILE ==="; cat "${DESIGN_FILE_CANONICAL:-$DESIGN_FILE}"
  }
  PROMPT='You are an independent CROSS-FAMILY reviewer auditing a DESIGN / SPEC (there is NO code yet — do NOT ask for a diff). Same-family (Claude/Opus) reviewers have ALREADY reviewed this and folded the fixes listed in the "ALREADY FOUND + FOLDED" section. Your job is to find what they MISSED — your value is decorrelated blind spots, so hunt the classes a same-family panel tends to wave through.

Hunt, ranked by severity (BLOCKER / HIGH / MEDIUM / LOW), each with the exact §section, the concrete failure scenario, why it matters, and the fix:
1. INTER-SECTION CONTRADICTIONS — two sections that specify incompatible behavior (e.g. "outside the lock" in one section vs "under the lock" in another). Read the WHOLE doc and cross-check sections against each other.
2. UNBOUNDED GROWTH / RESOURCE EXHAUSTION — a table/file/queue that accumulates with no reaper or cap (esp. staging/proposal rows that carry large payloads); anything that defeats a stated TTL/size ceiling, especially on a small (2 GB) box.
3. CONCURRENCY / LOCK HAZARDS — O(N)-growing or network/IO work done INSIDE the one process-wide write lock (FTS/index rebuilds, embeddings, large copies) that blocks ALL writers; TOCTOU between propose and confirm; non-transactional multi-step writes that orphan.
4. MECHANISM CORRECTNESS — does the described flow actually do what the doc claims? Silent data-loss (dedupe that drops a changed re-save; a write that overwrites a snapshot the design calls immutable); validate-at-X-but-stamp-at-Y timing mismatches; off-by-one / wrong-key joins.
5. DATA-SAFETY / LOSS WINDOWS — irreplaceable data with a gap between create and durable backup; "reversible by rm" claims on precious data; missing fail-closed.
6. INVARIANT VIOLATIONS (the section above) + DEPLOY/MIGRATION ORDERING (a flag/column referenced before the step that creates it; an unsafe migrate↔flag↔backfill order).
7. COMPLETENESS GAPS — a state or failure mode the design never handles; a tool/acceptance criterion missing.

Then: an overall GO / NO-GO for the design, and the single highest-risk thing to resolve first.

Before the response-completion token, emit these two standalone control lines:
VERDICT: GO  (or VERDICT: NO-GO)
INSPECTED SCOPE: <the specific design sections and artifact you inspected>

Discipline:
- You have the full design + the invariants + what was already folded. Judge the MECHANISM, not prose style. Cross-reference sections — the best catches are contradictions and missed failure modes, not typos.
- Do NOT re-report anything already in the "ALREADY FOUND + FOLDED" list. Find NEW issues.
- Separate CONFIRMED problems from suspicions; abstain over guessing — a confident wrong finding is the worst outcome. If the design is genuinely sound, say so plainly. Rank by severity. No filler.'

# =========================== CODE MODE (default) ===========================
else
  LABEL="diff${SLICE_NAME:+:slice:$SLICE_NAME}"
  SLICE_CONTEXTS=""
  SLICE_FILES_MAP=""
  SLICE_DIFF=""
  if [ -n "$SLICE_MANIFEST" ]; then
    [ -f "$SLICE_MANIFEST" ] || { echo "cold-review-gemini: slice manifest not found: $SLICE_MANIFEST" >&2; exit 2; }
    mkdir -p "$TMPD/slice"
    run_slice_tool validate --repo "$REPO_ROOT" --manifest "$SLICE_MANIFEST" --slice "$SLICE_NAME" --out-dir "$TMPD/slice" \
      || { ATTEMPT_DETAIL="slice plan validation failed — NOT A VERDICT"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
    SLICE_FILES_MAP="$TMPD/slice/files.txt"
    FILES="$(cut -f1 "$SLICE_FILES_MAP" | sed '/^$/d')"
    SLICE_DIFF="$TMPD/slice/diff.txt"
    SLICE_CONTEXTS="$TMPD/slice/contexts.txt"
    SLICE_NORMALIZED="$TMPD/slice/manifest.json"
    SLICE_BASE="$(<"$TMPD/slice/base.txt")"
    PLAN_ID="$(<"$TMPD/slice/plan-id.txt")"
    RECORD_KIND=SLICE_RESULT
    RELEASE_GATE=NO
  fi
  collect_diff() {
    local untracked f
    # Exclude THIS script's own verdict log from the tracked diff. It is a tracked file
    # that is frequently dirty (an earlier run's append, or a sibling thread's uncommitted
    # edit), and dumping it into the payload makes the reviewer audit a STALE prior review
    # instead of the actual code change (observed 2026-07-09: a polluted run re-emitted an
    # old news-TTL verdict against a trader-only diff). changed_files() already drops it
    # (not code), so this makes the header's "excluded from the diff payload" claim true.
    if [ -n "$SLICE_MANIFEST" ]; then
      [ -f "$SLICE_DIFF" ] || return 1
      cat "$SLICE_DIFF" || return 1
    elif [ -n "$ARTIFACT_SHA" ]; then
      git diff "$ARTIFACT_BASE_SHA" "$ARTIFACT_SHA" -- . ':(exclude)docs/journal/gemini_review_log.md' || return 1
    else
      git diff HEAD -- . ':(exclude)docs/journal/gemini_review_log.md' || return 1
      untracked="$(git ls-files --others --exclude-standard)" || return 1
      printf '%s\n' "$untracked" > "$TMPD/untracked-files.txt" || return 1
      while IFS= read -r f; do
        is_code "$f" || continue
        [ -f "$f" ] && [ "$(wc -c < "$f")" -lt 300000 ] || continue
        git diff --no-index /dev/null "$f" 2>/dev/null || true
      done < "$TMPD/untracked-files.txt"
    fi
    return 0
  }
  changed_files() {
    local tracked untracked f relative changed_canonical
    : > "$TMPD/review-files.txt" || return 1
    if [ -n "$ARTIFACT_SHA" ]; then
      git diff --name-only "$ARTIFACT_BASE_SHA" "$ARTIFACT_SHA" > "$TMPD/changed-files.txt" || return 1
    else
      tracked="$(git diff --name-only HEAD)" || return 1
      untracked="$(git ls-files --others --exclude-standard)" || return 1
      { printf '%s\n' "$tracked"; printf '%s\n' "$untracked"; } | sort -u > "$TMPD/changed-files.txt" || return 1
    fi
    while IFS= read -r f; do
      is_code "$f" || continue
      # A deleted path is the one legitimate no-file case. Every present entry, including a
      # symlink (even one whose target is a directory), must resolve to a regular file inside
      # the frozen worktree before it can be considered a payload source.
      if [ -L "$f" ] || [ -e "$f" ]; then
        resolve_inside_repo relative "$f" "$REPO_ROOT" "changed source file" "frozen repository" changed_canonical || return 1
        [ -f "$changed_canonical" ] || {
          ATTEMPT_DETAIL="changed source file must resolve to a regular file inside the frozen repository: $f"
          return 1
        }
        printf '%s\t%s\n' "$f" "$changed_canonical" >> "$TMPD/review-files.txt" || return 1
      fi
    done < "$TMPD/changed-files.txt"
    return 0
  }
  DIFF="$(collect_diff)"; discovery_rc=$?
  if [ "$discovery_rc" -ne 0 ]; then ATTEMPT_DETAIL="git diff/file discovery failed — NOT A VERDICT"; record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"; exit 3; fi
  if [ -z "$(printf '%s' "$DIFF" | tr -d '[:space:]')" ]; then echo "No uncommitted code changes to review." >&2; exit 0; fi
  if [ -z "$SLICE_MANIFEST" ]; then
    changed_files; discovery_rc=$?
    if [ "$discovery_rc" -ne 0 ]; then
      ATTEMPT_DETAIL="${ATTEMPT_DETAIL:-git changed-file discovery failed} — NOT A VERDICT"
      record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
      exit 3
    fi
    FILES="$(<"$TMPD/review-files.txt")"
  fi
  # Guard the lesson: if the diff touches NO code files, the reviewer can't do its job.
  if ! printf '%s' "$FILES" | grep -q .; then
    echo "cold-review-gemini: the changeset has NO code files (docs-only) — code-mode grades only the doc diff (the wrong lens; expect an unhelpful 'docs only, SAFE')." >&2
    echo "  If you are gating a DESIGN, use:  --design <doc> --folded <cold_review_record>" >&2
    echo "  Continuing anyway (will grade the doc edits)..." >&2
  fi
  build_payload() {
    echo "=== PIL PROJECT INVARIANTS (judge the diff against these) ==="; invariants || return 1
    echo; echo "=== DESIGN / ACCEPTANCE CONTEXT (what this change is supposed to do) ==="
    if [ -n "$SLICE_MANIFEST" ]; then
      echo "(PM-approved normalized slice manifest)"; cat "$SLICE_NORMALIZED"
      echo; echo "=== CONTRACT CONTEXT FOR THIS SLICE ==="
      while IFS=$'\t' read -r context snapshot; do
        [ -n "$context" ] && [ -n "$snapshot" ] || continue
        echo "----- CONTEXT: $context (validator snapshot) -----"
        cat "$snapshot"
        echo
      done < "$SLICE_CONTEXTS"
    elif [ -n "$CONTEXT_FILE" ]; then
      [ -f "${CONTEXT_FILE_CANONICAL:-$CONTEXT_FILE}" ] || return 1
      echo "(from $CONTEXT_FILE)"; echo; cat "${CONTEXT_FILE_CANONICAL:-$CONTEXT_FILE}"
    else echo "(none provided — judge against the invariants + the full changed files + the diff)"; fi
    echo; echo "=== FULL CONTENT OF CHANGED FILES (surrounding context for the diff) ==="
    if [ -n "$SLICE_MANIFEST" ]; then
      while IFS=$'\t' read -r f snapshot exists; do
        [ -n "$f" ] || continue
        echo "----- FILE: $f (validator snapshot) -----"
        if [ "$exists" = "1" ] && [ -n "$snapshot" ] && [ -f "$snapshot" ]; then
          sz="$(wc -c < "$snapshot" 2>/dev/null || echo 0)"
          if [ "$sz" -le "$MAX_FILE_BYTES" ]; then cat "$snapshot"; else echo "(file snapshot is ${sz} bytes — over the ${MAX_FILE_BYTES} cap; see the approved diff snapshot below)"; fi
        elif [ "$exists" = "0" ]; then
          echo "(file deleted in this approved snapshot; see the approved diff snapshot below)"
        else
          return 1
        fi
        echo
      done < "$SLICE_FILES_MAP"
    else
      printf '%s\n' "$FILES" | while IFS=$'\t' read -r f canon; do
        [ -n "$f" ] || continue; sz="$(wc -c < "$canon" 2>/dev/null || echo 0)"; echo "----- FILE: $f -----"
        if [ "$sz" -le "$MAX_FILE_BYTES" ]; then cat "$canon"; else echo "(file is ${sz} bytes — over the ${MAX_FILE_BYTES} cap; see the diff hunks below)"; fi; echo
      done
    fi
    echo "=== THE DIFF (what changed — review THIS, using the context above) ==="; printf '%s\n' "$DIFF"
  }
  PROMPT='You are a senior engineer doing an independent CROSS-FAMILY cold review before this change is committed/deployed. You are NOT the author; your value is catching what same-family reviewers miss alike. You are NOT working blind — you are given: (1) PIL PROJECT INVARIANTS, (2) the DESIGN/ACCEPTANCE CONTEXT, (3) the FULL CONTENT of every changed file, (4) THE DIFF. Review the DIFF, but USE (1)-(3) to judge it.

Find, ranked by severity (BLOCKER / HIGH / MEDIUM / LOW), each with file:line, what is wrong, why it matters, and the single check that confirms or refutes it:
1. INVARIANT VIOLATIONS — esp. boolean env reads mishandling the string "false" (truthy!); holding the write lock across a network/LLM call; a non-ADDITIVE change to a cached tool output shape; rendering a value from a derived source when an authoritative source-of-truth column exists; consent gating; migration / deploy-order safety; DuckDB gotchas; the librarian / exact-provenance rules.
2. CONTRACT-vs-DESIGN DRIFT — does the change contradict the DESIGN/ACCEPTANCE CONTEXT? A hunk can look fine in isolation yet violate the intended contract — check against the stated design.
3. CORRECTNESS — logic errors, off-by-one, inverted conditionals, unhandled null/error, broken async/await, idempotency / partial-failure, resource leaks.
4. RISKY / IRREVERSIBLE — schema/migrations, destructive ops, data loss, anything that breaks the running service.
5. SECURITY — injection, leaked secrets, unsafe input.

Then an overall read: blast radius, reversibility, and the one thing to double-check first.

Before the response-completion token, emit these two standalone control lines:
VERDICT: GO  (or VERDICT: NO-GO)
INSPECTED SCOPE: <the specific files, diff, and context you inspected>

Discipline: you HAVE surrounding context — use it; do not excuse a miss with "diff-only". Separate CONFIRMED bugs from suspicions; abstain over guessing. If clean, say so plainly. Rank by severity. No filler.'
fi

PAYLOAD="$(build_payload)"; payload_rc=$?
if [ "$payload_rc" -ne 0 ]; then
  if [ -s "$TMPD/invariants-refusal" ]; then ATTEMPT_DETAIL="$(<"$TMPD/invariants-refusal")"; else ATTEMPT_DETAIL="approved payload snapshot assembly failed — NOT A VERDICT"; fi
  record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"
  exit 3
fi
RAW_PAYLOAD_BYTES="$(printf '%s' "$PAYLOAD" | wc -c | tr -d '[:space:]')"
case "$RAW_PAYLOAD_BYTES" in
  ''|*[!0-9]*) ATTEMPT_DETAIL="could not measure payload for ingestion-canary planning"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3 ;;
esac
plan_canaries "$RAW_PAYLOAD_BYTES" \
  || { ATTEMPT_DETAIL="secure random ingestion-canary generation failed"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
instrument_canaries "$PAYLOAD" "$CANARY_MAP" \
  || { ATTEMPT_DETAIL="ingestion-canary instrumentation failed"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
[ "${#CANARY_TOKENS[@]}" -ge "$CANARY_MIN" ] \
  || { ATTEMPT_DETAIL="canary planning produced fewer than $CANARY_MIN probes"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
for canary_token in "${CANARY_TOKENS[@]}"; do
  [[ "$INSTRUMENTED_PAYLOAD" == *"$canary_token"* ]] \
    || { ATTEMPT_DETAIL="ingestion-canary instrumentation dropped a token"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
done
PAYLOAD="$INSTRUMENTED_PAYLOAD"
PROMPT="$PROMPT

--- INGESTION COVERAGE HANDSHAKE (delivery-integrity metadata, not review material) ---
The artifact contains exactly ${CANARY_N} marker lines of the form [[PIL-INGEST-CANARY k/${CANARY_N} <TOKEN>]], distributed from head through tail. Read the entire artifact. Near the start of your reply, output one line beginning CANARIES: followed by every TOKEN in encounter order. Copy only tokens you actually saw; never guess or reconstruct a missing one. The gate rejects the response if any token is absent. Do not treat marker lines as code, design text, or findings."
RECEIPT="PIL-RCPT-$(LC_ALL=C od -An -tx1 -N12 /dev/urandom 2>/dev/null | tr -d ' \n')"
if ! [[ "$RECEIPT" =~ ^PIL-RCPT-[0-9a-f]{24}$ ]]; then ATTEMPT_DETAIL="secure random EOF-receipt generation failed"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; fi
RESPONSE_DONE="PIL-DONE-$(LC_ALL=C od -An -tx1 -N12 /dev/urandom 2>/dev/null | tr -d ' \n')"
if ! [[ "$RESPONSE_DONE" =~ ^PIL-DONE-[0-9a-f]{24}$ ]]; then ATTEMPT_DETAIL="secure random response-completion generation failed"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; fi
RECEIPT_INSTRUCTION="--- DELIVERY RECEIPT (mandatory) ---
Read the complete artifact through its final line. Begin your reply with the exact random receipt token on that final line. After the substantive review and overall verdict, end your reply with the exact response-completion token '$RESPONSE_DONE' as the final nonblank line. A reply missing either boundary token is NOT a verdict."
INLINE_COMBINED="$PROMPT

$RECEIPT_INSTRUCTION

$PAYLOAD

===END OF REVIEW PAYLOAD===
RECEIPT: $RECEIPT"
PAYLOAD_BYTES="$(printf '%s' "$PAYLOAD" | wc -c | tr -d '[:space:]')"
COMBINED_BYTES="$(printf '%s' "$INLINE_COMBINED" | wc -c | tr -d '[:space:]')"
FILE_BYTES="$( { printf '%s\n' "$PAYLOAD"; printf '\n===END OF REVIEW PAYLOAD===\nRECEIPT: %s\n' "$RECEIPT"; } | wc -c | tr -d '[:space:]')"

# INLINE is gate-valid only below BOTH the OS argv budget and the separately verified Gemini
# contiguous-ingestion ceiling. ARG_MAX proves execve delivery; it says nothing about model ingestion.
ARG_MAX_BYTES="$(getconf ARG_MAX 2>/dev/null || true)"
case "$ARG_MAX_BYTES" in
  ''|*[!0-9]*|0*|??????????*) ARG_MAX_BYTES=262144 ;;
esac
if [ -n "${GEMINI_OS_ARG_MAX+x}" ]; then
  case "$GEMINI_OS_ARG_MAX" in
    ''|*[!0-9]*|0*|??????????*) echo "cold-review-gemini: GEMINI_OS_ARG_MAX must be a plain positive integer of 1–9 digits." >&2; exit 2 ;;
  esac
  ARG_MAX_BYTES="$GEMINI_OS_ARG_MAX"
fi
OS_INLINE_MAX=$(( ARG_MAX_BYTES > 262144 ? ARG_MAX_BYTES - 262144 : ARG_MAX_BYTES / 2 ))
INLINE_DELIVERY_MAX="$OS_INLINE_MAX"
if [ -n "${GEMINI_INLINE_MAX+x}" ]; then
  case "$GEMINI_INLINE_MAX" in
    ''|*[!0-9]*|0*|??????????*)
      echo "cold-review-gemini: GEMINI_INLINE_MAX must be a plain positive integer of 1–9 digits (got '$GEMINI_INLINE_MAX')." >&2; exit 2 ;;
  esac
  INLINE_DELIVERY_MAX=$(( GEMINI_INLINE_MAX < OS_INLINE_MAX ? GEMINI_INLINE_MAX : OS_INLINE_MAX ))
fi
INLINE_INGEST_MAX="$INLINE_INGEST_MAX_DEFAULT"
if [ -n "${GEMINI_INLINE_INGEST_MAX+x}" ]; then
  case "$GEMINI_INLINE_INGEST_MAX" in
    ''|*[!0-9]*|0*|??????????*)
      echo "cold-review-gemini: GEMINI_INLINE_INGEST_MAX must be a plain positive integer of 1–9 digits (got '$GEMINI_INLINE_INGEST_MAX')." >&2; exit 2 ;;
  esac
  INLINE_INGEST_MAX="$GEMINI_INLINE_INGEST_MAX"
fi
INLINE_MAX=$(( INLINE_DELIVERY_MAX < INLINE_INGEST_MAX ? INLINE_DELIVERY_MAX : INLINE_INGEST_MAX ))

VERIFIED_MAX=3000000
FILE_MAX="$VERIFIED_MAX"
if [ -n "${GEMINI_FILE_MAX+x}" ]; then
  case "$GEMINI_FILE_MAX" in
    ''|*[!0-9]*|0*|??????????*)
      echo "cold-review-gemini: GEMINI_FILE_MAX must be a plain positive integer of 1–9 digits (got '$GEMINI_FILE_MAX')." >&2; exit 2 ;;
  esac
  FILE_MAX="$GEMINI_FILE_MAX"
fi
GATE_MAX=$(( FILE_MAX < VERIFIED_MAX ? FILE_MAX : VERIFIED_MAX ))

TIMEOUT_SECONDS="${GEMINI_TIMEOUT_SECONDS:-600}"
GRACE_SECONDS="${GEMINI_TERMINATE_GRACE_SECONDS:-2}"
for timeout_value in "$TIMEOUT_SECONDS" "$GRACE_SECONDS"; do
  case "$timeout_value" in ''|*[!0-9]*|0*|??????????*) echo "cold-review-gemini: timeout/grace values must be plain positive integers of 1–9 digits." >&2; exit 2 ;; esac
done

if [ "$DRY_RUN" = "1" ]; then
  echo "===== DRY RUN ($LABEL): payload that would be sent to $MODEL ====="
  echo "----- PROMPT -----"; printf '%s\n\n' "$PROMPT"
  if [ "$COMBINED_BYTES" -le "$INLINE_MAX" ]; then DELIV="INLINE --print arg (receipt-required; GATE-VALID)"
  elif [ "$FILE_BYTES" -le "$GATE_MAX" ]; then DELIV="FILE-BASED via --add-dir (receipt-verified; GATE-VALID)"
  elif [ "$FILE_BYTES" -le "$FILE_MAX" ]; then DELIV="FILE-BASED ADVISORY (file > verified ${VERIFIED_MAX} B; delivered but NON-GATING — exit 3, typed log)"
  else DELIV="TOO LARGE — would REFUSE (exit 3); slice for a gate-valid review, or raise GEMINI_FILE_MAX for a non-gating advisory read"; fi
  echo "----- DELIVERY DECISION -----"
  echo "  payload:      ${PAYLOAD_BYTES} bytes (instrumented with ${CANARY_N} distributed canary token(s))"
  echo "  combined:     ${COMBINED_BYTES} bytes (prompt + payload; INLINE argv size)"
  echo "  file bytes:   ${FILE_BYTES} bytes (payload + receipt trailer; FILE-mode read size)"
  echo "  OS argv cap:  ${OS_INLINE_MAX} bytes (ARG_MAX=${ARG_MAX_BYTES} after headroom)"
  echo "  delivery cap: ${INLINE_DELIVERY_MAX} bytes (min(OS argv cap, GEMINI_INLINE_MAX when set))"
  echo "  ingest cap:   ${INLINE_INGEST_MAX} bytes (80 KiB default; Gemini inline attention ceiling)"
  echo "  inline cap:   ${INLINE_MAX} bytes (min(delivery cap, ingestion cap))"
  echo "  gate cap:     ${GATE_MAX} bytes (gate-valid file ≤ this; VERIFIED_MAX=${VERIFIED_MAX})"
  echo "  file cap:     ${FILE_MAX} bytes (absolute file ceiling; (gate cap, file cap] = NON-GATING advisory)"
  echo "  timeout:      ${TIMEOUT_SECONDS}s (applies to INLINE and FILE)"
  echo "  → delivery:   ${DELIV}"
  echo "  → proof:      first-line EOF receipt + exact ordered ${CANARY_N}-token line + final response token"
  if [ "$COMBINED_BYTES" -gt "$INLINE_MAX" ] && [ "$FILE_BYTES" -le "$FILE_MAX" ]; then
    echo "----- FILE-MODE: what actually gets sent (payload goes to a temp file, NOT inline) -----"
    echo "  • --print arg = the PROMPT above + this appended note:"
    echo "      \"…the review materials are in review_payload.txt in your workspace (absolute path"
    echo "       <tmpdir>/review_payload.txt). Read it IN FULL; its last line is 'RECEIPT: <token>';"
    echo "       begin your reply with that exact token to confirm EOF reach, then review.\""
    echo "  • review_payload.txt = the PAYLOAD below, with this trailer appended:"
    echo "      ===END OF REVIEW PAYLOAD==="
    echo "      RECEIPT: <random token — the reply MUST echo it or the run is rejected (exit 3)>"
  fi
  echo "----- INLINE EOF RECEIPT (included in combined bytes; exact token redacted) -----"
  echo "  RECEIPT: PIL-RCPT-<random>"
  echo "----- PAYLOAD (${PAYLOAD_BYTES} bytes) -----"; printf '%s\n' "$PAYLOAD"
  exit 0
fi

resolve_agy() {
  AGY="${GEMINI_AGY_BIN:-$(command -v agy || true)}"; [ -n "$AGY" ] || AGY="$HOME/.local/bin/agy"
  [ -x "$AGY" ] || return 127
}

run_supervised() {
  local wait_rc context_label slice_label
  : > "$TMPD/review.out"; : > "$TMPD/review.err"
  context_label="${DESIGN_FILE:+design:$DESIGN_FILE}${CONTEXT_FILE:+ context:$CONTEXT_FILE}"
  [ -n "$context_label" ] || context_label="(none)"
  if [ -n "$SLICE_NAME" ]; then slice_label="\`$SLICE_NAME\` from \`$SLICE_MANIFEST\`"; else slice_label="(none; full artifact)"; fi
  {
    echo "attempt_id=$ATTEMPT_ID"
    echo "record_kind=$RECORD_KIND"
    echo "do_log=$DO_LOG"
    echo "plan_id=$PLAN_ID"
    echo "delivery=$DELIVERY"
    echo "raw_payload=${RAW_PAYLOAD_BYTES:-0}"
    echo "payload=$PAYLOAD_BYTES"
    echo "combined=$COMBINED_BYTES"
    echo "file=$FILE_BYTES"
    echo "canaries=${CANARY_N:-0}"
    echo "model=$MODEL"
    echo "context=$context_label"
    echo "head=$HEAD_SHA"
    echo "start=$START_TIME"
    echo "slice=$slice_label"
  } > "$TMPD/parent-loss.meta" || return 3
  node "$REVIEW_SCRIPT_DIR/gemini-gate-supervisor.mjs" \
    --timeout-seconds "$TIMEOUT_SECONDS" --grace-seconds "$GRACE_SECONDS" \
    --stdout "$TMPD/review.out" --stderr "$TMPD/review.err" --pid-file "$TMPD/agy.pid" --parent-pid "$$" \
    --temp-dir "$TMPD" --lock-dir "$LOCK_DIR" --attempt-log "$LOG" --parent-loss-meta "$TMPD/parent-loss.meta" \
    -- "$@" &
  SUPERVISOR_PID=$!
  wait "$SUPERVISOR_PID"; wait_rc=$?
  if kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    kill -TERM "$SUPERVISOR_PID" 2>/dev/null || true
    wait "$SUPERVISOR_PID" 2>/dev/null || true
  fi
  AGY_RC="$wait_rc"
  SUPERVISOR_PID=""
  [ -s "$TMPD/review.err" ] && cat "$TMPD/review.err" >&2
  REVIEW="$(<"$TMPD/review.out")"
  return "$AGY_RC"
}

AGY_RC=0
GATE_VALID=1
if [ "$COMBINED_BYTES" -le "$INLINE_MAX" ]; then
  DELIVERY=INLINE
  if ! resolve_agy; then ATTEMPT_DETAIL="'agy' not found on PATH or at ~/.local/bin/agy"; record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"; exit 127; fi
  run_supervised "$AGY" --model "$MODEL" --print-timeout "${TIMEOUT_SECONDS}s" --print "$INLINE_COMBINED" || AGY_RC=$?
else
  DELIVERY=FILE
  printf '%s\n' "$PAYLOAD" > "$TMPD/review_payload.txt" \
    || { ATTEMPT_DETAIL="failed to write review payload"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
  printf '\n===END OF REVIEW PAYLOAD===\nRECEIPT: %s\n' "$RECEIPT" >> "$TMPD/review_payload.txt" \
    || { ATTEMPT_DETAIL="failed to append review receipt"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
  FILE_ACTUAL="$(wc -c < "$TMPD/review_payload.txt" | tr -d '[:space:]')" \
    || { ATTEMPT_DETAIL="could not measure review file"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3; }
  case "$FILE_ACTUAL" in
    ''|*[!0-9]*) ATTEMPT_DETAIL="invalid measured review file size: $FILE_ACTUAL"; record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"; exit 3 ;;
  esac
  FILE_BYTES="$FILE_ACTUAL"
  if [ "$FILE_ACTUAL" -gt "$FILE_MAX" ]; then
    DELIVERY=REFUSED
    ATTEMPT_DETAIL="review file ${FILE_ACTUAL} B exceeds absolute file cap ${FILE_MAX} B; nothing was reviewed"
    echo "cold-review-gemini: $ATTEMPT_DETAIL — NOT A VERDICT" >&2
    record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL"
    exit 3
  fi
  [ "$FILE_ACTUAL" -le "$GATE_MAX" ] || GATE_VALID=0
  if ! resolve_agy; then ATTEMPT_DETAIL="'agy' not found on PATH or at ~/.local/bin/agy"; record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"; exit 127; fi
  FILE_PROMPT="$PROMPT

--- HOW THE MATERIALS ARE DELIVERED (read this first) ---
The full review materials (the PIL invariants, the design/acceptance context, the FULL content of every changed file, and THE DIFF) are in a file named review_payload.txt in your workspace — absolute path ${TMPD}/review_payload.txt; it is the only file in the directory added for this review. They are NOT inline in this message. Read that file IN FULL, end to end, before you review. Its last line is 'RECEIPT: <token>'. Begin your reply with that exact token on its own line to confirm you reached the payload EOF; the distributed random canaries prove sampled regions across the payload. Then produce your review exactly as instructed above."
  FILE_PROMPT="$FILE_PROMPT

After the substantive review and overall verdict, end your reply with the exact response-completion token '$RESPONSE_DONE' as the final nonblank line."
  run_supervised "$AGY" --model "$MODEL" --add-dir "$TMPD" --mode plan --sandbox --print-timeout "${TIMEOUT_SECONDS}s" --print "$FILE_PROMPT" || AGY_RC=$?
fi

if [ "$AGY_RC" -eq 124 ]; then
  ATTEMPT_DETAIL="agy timed out after ${TIMEOUT_SECONDS}s; output is NOT a verdict"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_TIMEOUT "$ATTEMPT_DETAIL${REVIEW:+
$REVIEW}"
  exit 3
fi
if [ "$AGY_RC" -ne 0 ]; then
  ATTEMPT_DETAIL="agy exited $AGY_RC; output is NOT a verdict"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_TOOL "$ATTEMPT_DETAIL${REVIEW:+
$REVIEW}"
  case "$AGY_RC" in 130|143) exit "$AGY_RC" ;; *) exit 3 ;; esac
fi

if [ -z "$(printf '%s' "$REVIEW" | tr -d '[:space:]')" ]; then
  ATTEMPT_DETAIL="empty reply from $MODEL; output is NOT a verdict"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  record_attempt FAILED_TOOL "$ATTEMPT_DETAIL"
  exit 3
fi

FIRST_NONBLANK="$(printf '%s\n' "$REVIEW" | awk 'NF { print; exit }')"
LAST_NONBLANK="$(printf '%s\n' "$REVIEW" | awk 'NF { line=$0 } END { print line }')"
if ! receipt_line_ok "$FIRST_NONBLANK" "$RECEIPT"; then
  ATTEMPT_DETAIL="$DELIVERY payload EOF was not confirmed: exact receipt absent; response is NOT A VERDICT"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL
$REVIEW"
  exit 3
fi

if ! all_canaries_present "$REVIEW" "${CANARY_TOKENS[@]}"; then
  missing_count=0; missing_tokens=""
  for canary_token in "${CANARY_TOKENS[@]}"; do
    if [[ "$REVIEW" != *"$canary_token"* ]]; then
      missing_count=$((missing_count + 1))
      missing_tokens="${missing_tokens:+$missing_tokens }$canary_token"
    fi
  done
  if [ "$missing_count" -eq 0 ]; then
    ATTEMPT_DETAIL="$DELIVERY ingestion proof failed: all ${CANARY_N} canary tokens are present but NOT in encounter order; response is NOT A VERDICT"
  else
    ATTEMPT_DETAIL="$DELIVERY ingestion coverage incomplete: ${missing_count}/${CANARY_N} distributed canary token(s) absent (${missing_tokens}); response is NOT A VERDICT"
  fi
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL
$REVIEW"
  exit 3
fi

if [ "$LAST_NONBLANK" != "$RESPONSE_DONE" ]; then
  ATTEMPT_DETAIL="$DELIVERY response completion was not confirmed: exact final token absent; response is truncated or incomplete and NOT A VERDICT"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_DELIVERY "$ATTEMPT_DETAIL
$REVIEW"
  exit 3
fi

if ! verify_verdict_contract; then
  ATTEMPT_DETAIL="$DELIVERY response passed delivery checks but failed the verdict contract: $VERDICT_CONTRACT_ERROR; response is NOT A VERDICT"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_VERDICT "$ATTEMPT_DETAIL
$REVIEW"
  exit 3
fi

if [ "$GATE_VALID" = "0" ]; then
  ATTEMPT_DETAIL="EOF receipt, ordered distributed canaries, and response completion verified, but file exceeds verified ${VERIFIED_MAX} B contiguous-read envelope; ADVISORY ONLY — NOT A VERDICT"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt ADVISORY_ONLY "$ATTEMPT_DETAIL
$REVIEW"
  exit 3
fi

if ! cleanup_frozen_artifact; then
  ATTEMPT_DETAIL="$DELIVERY response passed verification, but frozen-artifact cleanup failed: $ATTEMPT_DETAIL; output is NOT A VERDICT"
  echo "cold-review-gemini: $ATTEMPT_DETAIL" >&2
  emit_rejected_output
  record_attempt FAILED_TOOL "$ATTEMPT_DETAIL
$REVIEW"
  exit 3
fi

record_attempt PASS_VERDICT "$REVIEW" || { emit_rejected_output; exit 3; }
if [ "$RECORD_KIND" = "FULL_REVIEW" ]; then run_gc_sweep; fi
if [ "$DO_LOG" = "0" ]; then
  echo "cold-review-gemini: input and response-completion proofs verified, but --no-log makes this diagnostic-only; it is not a durable release-gate receipt." >&2
fi
printf '%s\n' "$REVIEW"
