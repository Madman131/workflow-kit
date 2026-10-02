#!/usr/bin/env bash
# scripts/codex-gate-selftest.sh — deterministic both-directions harness for scripts/codex-gate.sh (`codex-gate.sh --selftest`).
# A fake `codex` first on PATH writes a receipt-bearing reply; no network, no model call, no CODEX_HOME. It pins the verdict
# contract: a receipt plus an explicit GO or NO-GO line plus an INSPECTED SCOPE line exits 0; a missing receipt, a missing
# decision, a missing scope, or conflicting decisions each exit 3, never 0.
set -uo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
GATE="$HERE/codex-gate.sh"
[ -f "$GATE" ] || { echo "codex-gate-selftest: cannot find $GATE" >&2; exit 2; }
WORK="$(mktemp -d -t codex-gate-selftest.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/repo" "$WORK/bin"
printf 'Review the files.\n' > "$WORK/prompt.txt"

cat > "$WORK/bin/codex" <<'FAKE'
#!/usr/bin/env bash
# fake codex: `exec ... -o OUT ...`; prompt on stdin. FAKE_BODY is the reply text; @RECEIPT@ becomes this round's token.
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
prompt="$(cat)"
receipt="$(printf '%s\n' "$prompt" | sed -n 's/^RECEIPT: //p' | tail -n 1)"
printf '%b' "${FAKE_BODY//@RECEIPT@/$receipt}" > "$out"
exit 0
FAKE
chmod +x "$WORK/bin/codex"

pass=0; fail=0
expect() {  # expect NAME WANT_EXIT ERR_REGEX BODY
  local name="$1" want="$2" re="$3" body="$4" rc err="$WORK/err.txt"
  FAKE_BODY="$body" PATH="$WORK/bin:$PATH" bash "$GATE" -o "$WORK/out.txt" -m selftest -e low -C "$WORK/repo" -f "$WORK/prompt.txt" >/dev/null 2>"$err"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$re" ] || grep -Eq -- "$re" "$err"; }; then
    pass=$((pass + 1)); echo "ok   $name (exit $rc)"
  else
    fail=$((fail + 1)); echo "FAIL $name: wanted exit $want${re:+ matching /$re/}, got $rc"; sed 's/^/     | /' "$err"
  fi
}

expect "GO with scope and receipt" 0 "decision=GO" 'Review.\nVERDICT: GO\nINSPECTED SCOPE: a.txt\nRECEIPT: @RECEIPT@\n'
expect "NO-GO with scope and receipt" 0 "decision=NO-GO" 'Review.\nVERDICT: NO-GO\nINSPECTED SCOPE: a.txt\nRECEIPT: @RECEIPT@\n'
expect "markdown-decorated verdict is read tolerantly" 0 "decision=GO" 'Review.\n**Verdict:** GO\n**Inspected scope:** a.txt\nRECEIPT: @RECEIPT@\n'
expect "receipt missing" 3 "RECEIPT is MISSING" 'Review.\nVERDICT: GO\nINSPECTED SCOPE: a.txt\nRECEIPT: not-the-token\n'
expect "no decision line" 3 "missing explicit VERDICT" 'Review.\nINSPECTED SCOPE: a.txt\nRECEIPT: @RECEIPT@\n'
expect "no inspected-scope line" 3 "missing nonempty INSPECTED SCOPE" 'Review.\nVERDICT: GO\nRECEIPT: @RECEIPT@\n'
expect "conflicting decisions" 3 "conflicting explicit verdict" 'Review.\nVERDICT: GO\nVERDICT: NO-GO\nINSPECTED SCOPE: a.txt\nRECEIPT: @RECEIPT@\n'
expect "an unanchored GO token is not a decision" 3 "missing explicit VERDICT" 'The gate says GO or NO-GO in prose.\nINSPECTED SCOPE: a.txt\nRECEIPT: @RECEIPT@\n'

echo "codex-gate-selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
