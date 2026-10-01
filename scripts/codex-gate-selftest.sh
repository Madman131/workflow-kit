#!/usr/bin/env bash
# scripts/codex-gate-selftest.sh — deterministic both-directions harness for scripts/codex-gate.sh (`codex-gate.sh --selftest`).
# A fake `codex` first on PATH writes a receipt-bearing verdict and replays a canned `--json` event stream: no network,
# no model call, no CODEX_HOME. It pins the v2.41.0 SEAT COVERAGE contract (`--expect-files`): every spelling of an
# under-read seat exits 3 with "UNDER-READ: no verdict", a full read exits 0, and without the option nothing changes.
# The canned records copy the shape OBSERVED in a real `codex exec --json` run (codex-cli 0.159.2): a completed
# `command_execution` item with `command` and `aggregated_output`. See docs/journal/2026-10-01-codex-exec-events-receipt.md.
set -uo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
GATE="$HERE/codex-gate.sh"
[ -f "$GATE" ] || { echo "codex-gate-selftest: cannot find $GATE" >&2; exit 2; }
WORK="$(mktemp -d -t codex-gate-selftest.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/repo" "$WORK/bin"
printf 'alpha line number one\nalpha line number two\nalpha line number three\nalpha line number four\n' > "$WORK/repo/a.txt"
printf 'bravo line number one\nbravo line number two\nbravo line number three\nbravo line number four\n' > "$WORK/repo/b.txt"
printf 'Review the files.\n' > "$WORK/prompt.txt"

cat > "$WORK/bin/codex" <<'FAKE'
#!/usr/bin/env bash
# fake codex: `exec ... -o OUT ...` (cold) or `exec resume ID ... -o OUT -` (warm); prompt on stdin.
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
prompt="$(cat)"
receipt="$(printf '%s\n' "$prompt" | sed -n 's/^RECEIPT: //p' | tail -n 1)"
printf 'Review.\nVERDICT: GO\nINSPECTED SCOPE: a.txt, b.txt\nRECEIPT: %s\n' "$receipt" > "$out"
if [ -n "${FAKE_EVENTS:-}" ] && [ -f "$FAKE_EVENTS" ]; then cat "$FAKE_EVENTS"; fi
exit 0
FAKE
chmod +x "$WORK/bin/codex"

A='alpha line number one\nalpha line number two\nalpha line number three\nalpha line number four\n'
B='bravo line number one\nbravo line number two\nbravo line number three\nbravo line number four\n'
THREAD='{"type":"thread.started","thread_id":"selftest-thread"}'
# cmd_record COMMAND OUTPUT — one completed command_execution item, as observed. Arguments are JSON-ready (no quotes inside).
cmd_record() { printf '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"%s","aggregated_output":"%s","exit_code":0,"status":"completed"}}\n' "$1" "$2"; }
# started_record — the in_progress twin: empty output, no credit.
started_record() { printf '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"%s","aggregated_output":"","exit_code":null,"status":"in_progress"}}\n' "$1"; }

pass=0; fail=0
expect() {  # expect NAME WANT_EXIT ERR_REGEX -- gate args...
  local name="$1" want="$2" re="$3"; shift 4
  local err rc
  err="$WORK/err.txt"; : > "$err"
  PATH="$WORK/bin:$PATH" bash "$GATE" -o "$WORK/out.txt" -m selftest -e low -C "$WORK/repo" "$@" >/dev/null 2>"$err"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$re" ] || grep -Eq -- "$re" "$err"; }; then
    pass=$((pass + 1)); echo "ok   $name (exit $rc)"
  else
    fail=$((fail + 1)); echo "FAIL $name: wanted exit $want${re:+ matching /$re/}, got $rc"; sed 's/^/     | /' "$err"
  fi
}
events() { FAKE_EVENTS="$WORK/events.jsonl"; export FAKE_EVENTS; : > "$FAKE_EVENTS"; for l in "$@"; do printf '%s\n' "$l" >> "$FAKE_EVENTS"; done; }

printf 'a.txt\nb.txt\n' > "$WORK/both.txt"

events
expect "no --expect-files, no events: behaviour unchanged" 0 "verdict contract OK" -- -f "$WORK/prompt.txt"

events "$THREAD" "$(cmd_record "/bin/zsh -lc cat a.txt b.txt" "$A$B")"
expect "full read of every listed file" 0 "seat coverage OK" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

events "$THREAD" "$(cmd_record "/bin/zsh -lc cat a.txt b.txt" "$A")"
expect "one named file whose content never appears" 3 "UNDER-READ: no verdict" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"
grep -q "^  b.txt" "$WORK/err.txt" && ! grep -q "^  a.txt" "$WORK/err.txt" && { pass=$((pass + 1)); echo "ok   the missing path is printed, the read one is not"; } || { fail=$((fail + 1)); echo "FAIL missing-path listing"; sed 's/^/     | /' "$WORK/err.txt"; }

events "$THREAD"
expect "no command records at all" 3 "UNDER-READ: no verdict" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

: > "$WORK/events.empty"; FAKE_EVENTS="$WORK/events.empty"; export FAKE_EVENTS
expect "an empty event stream" 3 "UNDER-READ: no verdict" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

events "$THREAD" "$(cmd_record "/bin/zsh -lc cat a.txt b.txt >/dev/null" "")"
expect "paths named, output discarded (the observed trap)" 3 "UNDER-READ: no verdict" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

events "$THREAD" "$(cmd_record "/bin/zsh -lc cat a.txt" "$A")" "$(cmd_record "/bin/zsh -lc rg -n alpha b.txt" "1:bravo line number one")"
expect "a single grep hit is not an open" 3 "UNDER-READ: no verdict" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

events "$THREAD" "$(started_record "/bin/zsh -lc cat a.txt b.txt")"
expect "an in_progress record earns no credit" 3 "UNDER-READ: no verdict" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

events "$THREAD" "$(cmd_record "/bin/zsh -lc cat a.txt" "$A")" "$(cmd_record "/bin/zsh -lc sed -n 1,3p b.txt" 'bravo line number one\nbravo line number two\nbravo line number three\n')"
expect "files read by separate commands, a ranged read counts" 0 "seat coverage OK" -- --expect-files "$WORK/both.txt" -f "$WORK/prompt.txt"

printf 'a.txt\nmissing-file.txt\n' > "$WORK/gone.txt"
events "$THREAD" "$(cmd_record "/bin/zsh -lc cat a.txt missing-file.txt" "$A")"
expect "a listed file that does not exist cannot be evidenced" 3 "missing-file.txt" -- --expect-files "$WORK/gone.txt" -f "$WORK/prompt.txt"

: > "$WORK/empty.txt"; printf '# only a comment\n\n' > "$WORK/blank.txt"
expect "an empty list is a usage error, never a vacuous pass" 2 "names no paths" -- --expect-files "$WORK/empty.txt" -f "$WORK/prompt.txt"
expect "a comment-only list is a usage error" 2 "names no paths" -- --expect-files "$WORK/blank.txt" -f "$WORK/prompt.txt"
printf '../outside.txt\n' > "$WORK/esc.txt"
expect "a path escaping the repo is refused" 2 "escapes the repo" -- --expect-files "$WORK/esc.txt" -f "$WORK/prompt.txt"
expect "a missing list file is a usage error" 2 "list not found" -- --expect-files "$WORK/nope.txt" -f "$WORK/prompt.txt"
expect "--expect-files with --resume is refused" 2 "COLD pass" -- --expect-files "$WORK/both.txt" --resume some-thread -f "$WORK/prompt.txt"

echo "codex-gate-selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
