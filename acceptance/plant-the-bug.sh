#!/usr/bin/env bash
# workflow-kit — Phase 6 acceptance. A scratch repo adopts the kit via init, and EACH control is
# demonstrated failing-first-WITHOUT the kit, then blocking-WITH it (INVARIANTS epistemic rule 1: a
# control only ever seen green is a control never observed working). PreToolUse guards are exercised
# exactly as the harness does — a crafted JSON event on stdin, asserting the JSON decision on stdout.
# The pre-commit control is exercised end-to-end with real `git commit`.
#
# Exit 0 iff every assertion held. Run: bash acceptance/plant-the-bug.sh
set -uo pipefail

KIT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
ADOPTER="$WORK/adopter"
OUTSIDE="$WORK/outside"
# Codex prompts are USER-GLOBAL (~/.codex/prompts). Point init at a scratch dir so the acceptance run
# is HERMETIC — it must never touch a real ~/.codex/prompts on the machine running the suite.
CODEX_PROMPTS="$WORK/codex-prompts"
SID="sess-accept-1"
FAILURES=0
trap 'rm -rf "$WORK"' EXIT

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILURES=$((FAILURES+1)); }
# assert_eq WANT GOT LABEL
assert_eq() { if [ "$2" = "$1" ]; then ok "$3 (=$2)"; else bad "$3 (want $1, got $2)"; fi; }

# Run a PreToolUse guard with a JSON event; echo "deny" if it denied, else "allow".
guard_decision() { # $1=hookfile $2=json $3=cwd
  local out; out="$(printf '%s' "$2" | (cd "$3" && CLAUDE_PROJECT_DIR="$3" node "$1") 2>/dev/null)"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then echo deny; else echo allow; fi
}
# Run guard-gate-ladder; echo its additionalContext (empty if it did not fire).
gate_ladder_ctx() { # $1=hookfile $2=json $3=cwd
  printf '%s' "$2" | (cd "$3" && CLAUDE_PROJECT_DIR="$3" node "$1") 2>/dev/null
}

echo "== workflow-kit acceptance =="
echo "kit=$KIT"
echo "adopter=$ADOPTER"

# ---- adopt ----
mkdir -p "$ADOPTER" "$OUTSIDE"
git init -q "$ADOPTER"
git -C "$ADOPTER" config user.email a@a; git -C "$ADOPTER" config user.name a
node "$KIT/bin/init.mjs" --target "$ADOPTER" --repo-name adopter \
  --remote-url git@github.com:you/adopter.git --source-dirs src,policy \
  --risk-tokens billing --state-docs docs/state.md --memory-dir "$WORK/mem" \
  --codex-prompts-dir "$CODEX_PROMPTS" >/dev/null
mkdir -p "$ADOPTER/src" "$ADOPTER/docs" "$ADOPTER/policy"   # app dirs the adopter would already have
# 'policy' is a CONFIG-ONLY source dir (not a portable default) — used to test that a malformed config
# still fails closed for a path gated SOLELY by config (the F1 fail-open regression).
echo "-- adopted (init ran) --"

echo
echo "(commands) /thread-restart install wiring — a productivity NUDGE, not a control (no block/permit pair)"
# The command ships NO enforcement, so it gets no failing-first/blocking-second proof. What IS gated is
# the init WIRING: the three assets land in the right place, are syntactically valid, carry the
# load-bearing method text verbatim, and a re-run is idempotent.
CMD_CLAUDE="$ADOPTER/.claude/commands/thread-restart.md"
CMD_CODEX="$CODEX_PROMPTS/thread-restart.md"
[ -f "$CMD_CLAUDE" ] && ok "Claude command lands at .claude/commands/thread-restart.md" || bad "Claude command missing at $CMD_CLAUDE"
[ -f "$CMD_CODEX" ]  && ok "Codex prompt lands in the (overridable) codex prompts dir"    || bad "Codex prompt missing at $CMD_CODEX"
# syntactically valid per harness: Claude command opens with YAML frontmatter; Codex prompt with an H1.
head -1 "$CMD_CLAUDE" | grep -q '^---$' && ok "Claude command opens with YAML frontmatter" || bad "Claude command missing YAML frontmatter"
head -1 "$CMD_CODEX"  | grep -q '^# '   && ok "Codex prompt opens with a markdown H1"       || bad "Codex prompt missing an H1"
# The two genuinely-SHARED load-bearing strings are present in BOTH assets. (The rest of the method
# prose is lightly harness-adapted — memory nouns, example ids, a Claude-only spawn offer — so we assert
# only the parts that are byte-identical across harnesses; those are what the digest method rests on.)
check_method_text() { # $1=file $2=harness-label
  if grep -q "VERIFY before finalizing" "$1" && grep -q "Index, don't duplicate" "$1"; then
    ok "shared load-bearing method text (verify-before-finalize + index-don't-duplicate) present in the $2 asset"
  else
    bad "shared method text missing from the $2 asset ($1) — verbatim copy broken?"
  fi
}
check_method_text "$CMD_CLAUDE" "Claude"
check_method_text "$CMD_CODEX"  "Codex"
# the AGENTS.md fallback pointer was appended (idempotent marker), exactly once.
assert_eq "1" "$(grep -c 'workflow-kit:thread-restart-pointer' "$ADOPTER/AGENTS.md")" "AGENTS.md carries the thread-restart fallback pointer (exactly once)"

echo
echo "(commands idempotency) a second init KEEPS user edits — no clobber, no duplicate pointer"
# Plant a real USER EDIT into each installed asset first: a source-identical SHA check would stay GREEN
# even if copyGuarded regressed to overwrite (a re-copy is byte-identical), so the file must be MUTATED
# for the no-clobber assertion to be non-vacuous.
printf '\n<!-- user edit: keep me -->\n' >> "$CMD_CLAUDE"
printf '\n<!-- user edit: keep me -->\n' >> "$CMD_CODEX"
CLAUDE_EDIT_SHA="$(shasum "$CMD_CLAUDE" | awk '{print $1}')"
CODEX_EDIT_SHA="$(shasum "$CMD_CODEX" | awk '{print $1}')"
AGENTS_SHA1="$(shasum "$ADOPTER/AGENTS.md" | awk '{print $1}')"
node "$KIT/bin/init.mjs" --target "$ADOPTER" --repo-name adopter \
  --remote-url git@github.com:you/adopter.git --source-dirs src,policy \
  --risk-tokens billing --state-docs docs/state.md --memory-dir "$WORK/mem" \
  --codex-prompts-dir "$CODEX_PROMPTS" >/dev/null 2>&1 && ok "re-run init exits 0 (idempotent)" || bad "re-run init should exit 0"
assert_eq "1" "$(grep -c 'workflow-kit:thread-restart-pointer' "$ADOPTER/AGENTS.md")" "AGENTS pointer still appears exactly once after re-run (no duplication)"
assert_eq "$CLAUDE_EDIT_SHA" "$(shasum "$CMD_CLAUDE" | awk '{print $1}')" "re-run KEEPS a user-edited Claude command (no clobber without --force)"
assert_eq "$CODEX_EDIT_SHA"  "$(shasum "$CMD_CODEX" | awk '{print $1}')" "re-run KEEPS a user-edited Codex prompt (no clobber without --force)"
assert_eq "$AGENTS_SHA1" "$(shasum "$ADOPTER/AGENTS.md" | awk '{print $1}')" "AGENTS.md unchanged on re-run"

echo
echo "(commands failure-isolation) a blocked user-global Codex write must NOT abort the repo-local adopt"
# The Codex prompt is the ONE out-of-repo write. Point it at a path blocked by a regular FILE (so the
# ensureDir mkdir throws): init must WARN-and-continue, still install the repo-local Claude command +
# AGENTS pointer, and exit 0. If the try/catch around that write regressed, init would abort here.
FRESH="$WORK/fresh"; git init -q "$FRESH"; git -C "$FRESH" config user.email a@a; git -C "$FRESH" config user.name a
touch "$WORK/codex-blocker"
if node "$KIT/bin/init.mjs" --target "$FRESH" --repo-name fresh \
     --remote-url git@github.com:you/fresh.git --codex-prompts-dir "$WORK/codex-blocker" >/dev/null 2>&1; then
  ok "blocked Codex write: init still exits 0 (repo-local adopt not aborted)"
else
  bad "blocked Codex write ABORTED init — failure isolation regressed"
fi
[ -f "$FRESH/.claude/commands/thread-restart.md" ] && ok "blocked Codex write: repo-local Claude command STILL installed" || bad "Claude command missing after a blocked Codex write"
assert_eq "1" "$(grep -c 'workflow-kit:thread-restart-pointer' "$FRESH/AGENTS.md")" "blocked Codex write: AGENTS pointer STILL appended"
[ -f "$WORK/codex-blocker/thread-restart.md" ] && bad "a Codex prompt should NOT exist under the blocked path" || ok "blocked Codex write: no Codex prompt created at the blocked path"

H_XREPO="$ADOPTER/.claude/hooks/guard-cross-repo-writes.mjs"
H_LANE="$ADOPTER/.claude/hooks/guard-lane-authoring.mjs"
H_GATE="$ADOPTER/.claude/hooks/guard-gate-ladder.mjs"
DECL="$ADOPTER/.claude/task-lane.json"

echo
echo "(a) cross-repo write"
# WITHOUT the kit: an unguarded write outside the repo just happens.
touch "$OUTSIDE/evil.md" && [ -f "$OUTSIDE/evil.md" ] && ok "WITHOUT: unguarded write to $OUTSIDE/evil.md succeeded (the danger)" || bad "WITHOUT: expected the unguarded write to succeed"
# WITH the kit: the guard denies that same out-of-repo target, and permits an in-repo one.
assert_eq deny  "$(guard_decision "$H_XREPO" '{"tool_input":{"file_path":"'"$OUTSIDE"'/evil.md"}}' "$ADOPTER")" "WITH: out-of-repo write is BLOCKED"
assert_eq allow "$(guard_decision "$H_XREPO" '{"tool_input":{"file_path":"src/legit.mjs"}}' "$ADOPTER")" "WITH: in-repo write is permitted (no over-block)"

echo
echo "(b1) undeclared code write — Claude PreToolUse lane"
rm -f "$DECL"
touch "$ADOPTER/src/x.mjs"; [ -f "$ADOPTER/src/x.mjs" ] && ok "WITHOUT: unguarded code write to src/x.mjs succeeded (the danger)" || bad "WITHOUT: expected write to succeed"; rm -f "$ADOPTER/src/x.mjs"
assert_eq deny  "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "WITH: undeclared code write is BLOCKED"
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
assert_eq allow "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "WITH + valid T2 declaration: code write permitted"
assert_eq allow "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"docs/notes.md"}}' "$ADOPTER")" "WITH: docs write always permitted (not gated)"

echo
echo "(c) missing tier declaration -> strictest ladder (gate-ladder sensor)"
rm -f "$DECL"
CTX_NODECL="$(gate_ladder_ctx "$H_GATE" '{"session_id":"'"$SID"'","tool_input":{"command":"bash scripts/codex-gate.sh -m x -e xhigh"}}' "$ADOPTER")"
if printf '%s' "$CTX_NODECL" | grep -q "FAIL-CLOSED to T3"; then ok "WITH: no declaration -> FAIL-CLOSED to T3 (strictest ladder surfaced)"; else bad "WITH: expected FAIL-CLOSED to T3; got: $(printf '%s' "$CTX_NODECL" | head -c 120)"; fi
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
CTX_T2="$(gate_ladder_ctx "$H_GATE" '{"session_id":"'"$SID"'","tool_input":{"command":"bash scripts/codex-gate.sh -m x -e xhigh"}}' "$ADOPTER")"
if printf '%s' "$CTX_T2" | grep -q "declared tier T2"; then ok "WITH + valid T2 declaration: surfaces the T2 ladder (contrast direction)"; else bad "WITH+T2: expected 'declared tier T2'"; fi
# a non-gate command must NOT fire the sensor
CTX_NONE="$(gate_ladder_ctx "$H_GATE" '{"session_id":"'"$SID"'","tool_input":{"command":"grep codex-gate.sh README.md"}}' "$ADOPTER")"
assert_eq "" "$CTX_NONE" "WITHOUT a gate command: sensor stays silent (no cry-wolf)"

echo
echo "(param) the lane deny-set is load-bearing (parameterization did not fail open)"
printf '{"mode":"lane","sessionId":"%s","taskId":"accept","allowedFiles":["scripts/billing_job.mjs"]}\n' "$SID" > "$DECL"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"scripts/billing_job.mjs"}}' "$ADOPTER")" "config risk-token 'billing' -> scripts/billing_job.mjs is lane-INELIGIBLE (BLOCKED)"
# remove the token from config -> the SAME lane path becomes eligible (proves the token blocked it)
printf '{"executedPathDirs":["src"],"laneRiskTokens":[],"stateDocs":["docs/state.md"]}\n' > "$ADOPTER/.claude/kit.config.json"
assert_eq allow "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"scripts/billing_job.mjs"}}' "$ADOPTER")" "token removed -> same path is lane-eligible (config is load-bearing)"

echo
echo "(fail-closed) a MALFORMED config blocks a code write (never silently permits)"
printf 'NOT JSON{' > "$ADOPTER/.claude/kit.config.json"
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "malformed kit.config.json -> code write BLOCKED (fail-closed, even with a valid declaration)"
# restore a valid config for the commit tests
printf '{"executedPathDirs":["src"],"laneRiskTokens":["billing"],"stateDocs":["docs/state.md"]}\n' > "$ADOPTER/.claude/kit.config.json"

echo
echo "(b2) undeclared code COMMIT — harness-agnostic pre-commit (binds EVERY lane)"
# FM1 mitigation: init set core.hooksPath.
assert_eq ".githooks" "$(git -C "$ADOPTER" config core.hooksPath)" "FM1: init set core.hooksPath=.githooks (pre-commit is live)"
# Establish a baseline commit (declared) so HEAD tracks the hook.
printf '# state\n\n> CLASS: STATE\n\nx\n' > "$ADOPTER/docs/state.md"
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
git -C "$ADOPTER" add -A
git -C "$ADOPTER" commit -q -m "adopt workflow-kit" && ok "baseline commit (with declaration) succeeded" || bad "baseline commit should have succeeded"
# WITHOUT the kit: unset core.hooksPath, drop the declaration, commit code -> SUCCEEDS.
git -C "$ADOPTER" config --unset core.hooksPath
rm -f "$DECL"
printf 'export const x = 1;\n' > "$ADOPTER/src/feature.mjs"
git -C "$ADOPTER" add src/feature.mjs
if git -C "$ADOPTER" commit -q -m "undeclared code, no hook"; then ok "WITHOUT core.hooksPath: undeclared code commit SUCCEEDED (the danger)"; else bad "WITHOUT: expected the undeclared commit to succeed"; fi
git -C "$ADOPTER" reset -q --soft HEAD~1   # keep src/feature.mjs staged, undo the commit
# WITH the kit: restore core.hooksPath, still no declaration, commit -> BLOCKED.
git -C "$ADOPTER" config core.hooksPath .githooks
if git -C "$ADOPTER" commit -q -m "undeclared code, hook on" 2>/dev/null; then bad "WITH: undeclared code commit should have been BLOCKED"; else ok "WITH core.hooksPath: undeclared code commit is BLOCKED (every lane)"; fi
# and a docs-only commit still passes with the hook on
git -C "$ADOPTER" reset -q src/feature.mjs; rm -f "$ADOPTER/src/feature.mjs"
printf 'note\n' > "$ADOPTER/docs/readme-note.md"; git -C "$ADOPTER" add docs/readme-note.md
if git -C "$ADOPTER" commit -q -m "docs only"; then ok "WITH hook on: docs-only commit passes (no over-block)"; else bad "docs-only commit should pass"; fi

GOODCFG='{"executedPathDirs":["src","policy"],"laneRiskTokens":["billing"],"stateDocs":["docs/state.md"]}'

echo
echo "(F1 regression) malformed config STILL fails closed for a CONFIG-ONLY-gated path"
# policy/authz.rego is gated ONLY via config executedPathDirs and is not a default code extension —
# the exact path that slipped through the early-allow before the fix.
rm -f "$DECL"
printf '%s\n' "$GOODCFG" > "$ADOPTER/.claude/kit.config.json"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"policy/authz.rego"}}' "$ADOPTER")" "valid config, undeclared: config-only-gated policy/authz.rego BLOCKED"
printf 'NOT JSON{' > "$ADOPTER/.claude/kit.config.json"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"policy/authz.rego"}}' "$ADOPTER")" "MALFORMED config: config-only-gated path STILL BLOCKED (fail-open fixed)"

echo
echo "(F5) pre-commit fails closed on a malformed config (code commit blocked)"
# Keep a VALID declaration in place so the undeclared-check passes and the ONLY possible block source
# is the malformed-config check — otherwise this assertion is vacuous (it would stay green even if the
# malformed-config branch were reverted to fail-open). Verified by mutation.
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
printf 'NOT JSON{' > "$ADOPTER/.claude/kit.config.json"
printf 'export const g=1;\n' > "$ADOPTER/src/g.mjs"; git -C "$ADOPTER" add src/g.mjs
if git -C "$ADOPTER" commit -q -m "malformed cfg code" 2>/dev/null; then bad "pre-commit malformed-config: commit should be BLOCKED (with a VALID declaration, only the malformed config can block)"; else ok "pre-commit malformed-config: code commit BLOCKED despite a valid declaration (isolates the malformed-config branch)"; fi
git -C "$ADOPTER" reset -q src/g.mjs 2>/dev/null; rm -f "$ADOPTER/src/g.mjs"

echo
echo "(F5) check-doc-size CLI discriminates (clean pass / over-cap FAIL / malformed FAIL)"
printf '%s\n' "$GOODCFG" > "$ADOPTER/.claude/kit.config.json"
(cd "$ADOPTER" && node scripts/check-doc-size.mjs >/dev/null 2>&1) && ok "check-doc-size: clean adopter tree -> exit 0" || bad "check-doc-size: clean tree should pass"
cp "$ADOPTER/core/WORKFLOW.md" "$WORK/WORKFLOW.bak"; head -c 25000 /dev/zero | tr '\0' 'x' >> "$ADOPTER/core/WORKFLOW.md"
if (cd "$ADOPTER" && node scripts/check-doc-size.mjs >/dev/null 2>&1); then bad "check-doc-size: over-cap core doc should FAIL"; else ok "check-doc-size: over-cap core doc -> exit 1 (discriminates)"; fi
cp "$WORK/WORKFLOW.bak" "$ADOPTER/core/WORKFLOW.md"
printf 'NOT JSON{' > "$ADOPTER/.claude/kit.config.json"
if (cd "$ADOPTER" && node scripts/check-doc-size.mjs >/dev/null 2>&1); then bad "check-doc-size: malformed config should FAIL"; else ok "check-doc-size: malformed config -> exit 1 (fail-closed)"; fi
printf '%s\n' "$GOODCFG" > "$ADOPTER/.claude/kit.config.json"

echo
echo "(F12 characterization — DEFERRED: hostile-evasion, out of stated threat model; revisit when hardened)"
# guard-cross-repo-writes uses a LEXICAL root check, so a symlinked in-repo dir pointing OUTSIDE is not
# caught. This asserts CURRENT (deferred) behavior so a future hardening flips it visibly.
mkdir -p "$OUTSIDE/target"; ln -s "$OUTSIDE/target" "$ADOPTER/escape"
if [ "$(guard_decision "$H_XREPO" '{"tool_input":{"file_path":"escape/x.md"}}' "$ADOPTER")" = "allow" ]; then
  ok "DEFERRED(documented): a symlinked in-repo dir escaping the repo is NOT caught by the lexical cross-repo guard"
else
  ok "cross-repo guard now catches the symlinked escape — hardening landed; update the F12 disposition"
fi
rm -f "$ADOPTER/escape"

echo
echo "(round-3) control files fail closed on symlink / unreadable; write-gate is a tripwire, commit is the floor"
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
# symlinked kit.config.json -> fail-closed deny (dropped tokens would be a fail-open)
rm -f "$ADOPTER/.claude/kit.config.json"; printf '%s' "$GOODCFG" > "$WORK/realcfg.json"; ln -s "$WORK/realcfg.json" "$ADOPTER/.claude/kit.config.json"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "symlinked kit.config.json -> code write BLOCKED (fail-closed)"
rm -f "$ADOPTER/.claude/kit.config.json"; printf '%s\n' "$GOODCFG" > "$ADOPTER/.claude/kit.config.json"
# config path that is a DIRECTORY (not a regular file) -> the !isFile branch -> fail-closed
rm -f "$ADOPTER/.claude/kit.config.json"; mkdir -p "$ADOPTER/.claude/kit.config.json"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "kit.config.json is a DIRECTORY -> code write BLOCKED (!isFile fail-closed)"
rmdir "$ADOPTER/.claude/kit.config.json"; printf '%s\n' "$GOODCFG" > "$ADOPTER/.claude/kit.config.json"
# UNREADABLE config (chmod 000) -> fail-closed deny (EACCES must not read as absent)
chmod 000 "$ADOPTER/.claude/kit.config.json"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "unreadable (chmod 000) config -> code write BLOCKED (EACCES != absent)"
chmod 644 "$ADOPTER/.claude/kit.config.json"
# symlinked DECLARATION -> fail-closed (a symlinked declaration must not authorize writes)
rm -f "$DECL"; printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$WORK/realdecl.json"; ln -s "$WORK/realdecl.json" "$DECL"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "symlinked declaration -> code write BLOCKED (malformed, fail-closed)"
rm -f "$DECL"
# the write-time gate is a tripwire (a root .rego is NOT recognized) but the commit FLOOR catches it
printf 'x\n' > "$ADOPTER/authz.rego"; git -C "$ADOPTER" add authz.rego
if git -C "$ADOPTER" commit -q -m "undeclared root rego" 2>/dev/null; then bad "commit floor: an undeclared root .rego commit should be BLOCKED"; else ok "commit floor: undeclared root .rego (missed by the write-tripwire) is BLOCKED at commit (every-lane floor)"; fi
git -C "$ADOPTER" reset -q authz.rego 2>/dev/null; rm -f "$ADOPTER/authz.rego"

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32mACCEPTANCE PASSED\033[0m — every control observed BOTH permitting and blocking.\n'
  exit 0
else
  printf '\033[31mACCEPTANCE FAILED\033[0m — %s assertion(s) did not hold.\n' "$FAILURES"
  exit 1
fi
