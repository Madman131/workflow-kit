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
# Same, but echo the guard's raw JSON output — for asserting the deny REASON, not just the decision.
guard_output() { # $1=hookfile $2=json $3=cwd
  printf '%s' "$2" | (cd "$3" && CLAUDE_PROJECT_DIR="$3" node "$1") 2>/dev/null
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
# --risk-tokens is passed DELIBERATELY: since v1.5.0 it is deprecated (the lane route is retired), so
# the contract under test is parse-warn-ignore — an adopter's saved init invocation keeps working, the
# warning is loud, and the dead family is NOT written to kit.config.json.
INIT_OUT="$(node "$KIT/bin/init.mjs" --target "$ADOPTER" --repo-name adopter \
  --remote-url git@github.com:you/adopter.git --source-dirs src,policy \
  --risk-tokens billing --state-docs docs/state.md --memory-dir "$WORK/mem" \
  --codex-prompts-dir "$CODEX_PROMPTS" 2>&1)" || bad "init with the deprecated --risk-tokens flag must still exit 0"
mkdir -p "$ADOPTER/src" "$ADOPTER/docs" "$ADOPTER/policy"   # app dirs the adopter would already have
# 'policy' is a CONFIG-ONLY source dir (not a portable default) — used to test that a malformed config
# still fails closed for a path gated SOLELY by config (the F1 fail-open regression).
echo "-- adopted (init ran) --"

echo
echo "(deprecation) --risk-tokens parses, warns loudly, and writes NOTHING"
printf '%s' "$INIT_OUT" | grep -q 'risk-tokens is DEPRECATED' && ok "init warns that --risk-tokens is DEPRECATED (parse-warn-ignore, removal reserved for v2.0)" || bad "init must warn about the deprecated --risk-tokens flag"
grep -q 'laneRiskTokens' "$ADOPTER/.claude/kit.config.json" && bad "init must NOT write laneRiskTokens (the family gates nothing)" || ok "kit.config.json carries NO laneRiskTokens (the dead family is not written)"
grep -q '"executedPathDirs"' "$ADOPTER/.claude/kit.config.json" && ok "…while executedPathDirs (a live family) IS written" || bad "executedPathDirs missing from kit.config.json"

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
echo "(skills) shared-body dual-lane install wiring — also a NUDGE, not a control (no block/permit pair)"
# ONE canonical body under .agents/skills/, a thin shim per harness pointing at it. Same proof shape as
# the commands: the assets land, the shims resolve to a body that EXISTS, and a re-run is idempotent.
SK_BODY="$ADOPTER/.agents/skills/humanize/SKILL.md"
SK_BULLET="$ADOPTER/.agents/skills/humanize/BULLET.md"
SK_CLAUDE="$ADOPTER/.claude/skills/humanize/SKILL.md"
SK_ALIAS="$ADOPTER/.claude/skills/humanize-bullet/SKILL.md"
SK_CODEX="$CODEX_PROMPTS/humanize.md"
SK_CODEX_ALIAS="$CODEX_PROMPTS/humanize-bullet.md"
[ -f "$SK_BODY" ]        && ok "shared body lands at .agents/skills/humanize/SKILL.md"        || bad "shared body missing at $SK_BODY"
[ -f "$SK_BULLET" ]      && ok "the body's sibling reference layer (BULLET.md) lands with it" || bad "BULLET.md missing at $SK_BULLET"
[ -f "$SK_CLAUDE" ]      && ok "Claude shim lands at .claude/skills/humanize/SKILL.md"        || bad "Claude shim missing at $SK_CLAUDE"
[ -f "$SK_ALIAS" ]       && ok "ALIAS shim (humanize-bullet, no body of its own) lands too"   || bad "alias shim missing at $SK_ALIAS"
[ -f "$SK_CODEX" ]       && ok "Codex skill prompt lands in the (overridable) prompts dir"    || bad "Codex skill prompt missing at $SK_CODEX"
[ -f "$SK_CODEX_ALIAS" ] && ok "Codex ALIAS prompt lands in the prompts dir"                  || bad "Codex alias prompt missing at $SK_CODEX_ALIAS"
# syntactically valid per harness, same convention as the commands.
head -1 "$SK_CLAUDE" | grep -q '^---$' && ok "Claude skill shim opens with YAML frontmatter" || bad "Claude skill shim missing YAML frontmatter"
head -1 "$SK_CODEX"  | grep -q '^# '   && ok "Codex skill prompt opens with a markdown H1"    || bad "Codex skill prompt missing an H1"
# THE LOAD-BEARING ONE: every shim points at a body that EXISTS. A shim naming a moved or renamed body
# is a menu entry that dead-ends — the failure this mechanism must not be able to ship silently.
SHIM_REFS_OK=1
for shim in "$SK_CLAUDE" "$SK_ALIAS" "$SK_CODEX" "$SK_CODEX_ALIAS"; do
  REFS="$(grep -oE '\.agents/skills/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.md' "$shim" | sort -u)"
  # A shim that names NO body is a FAILURE, not a pass. Without this, the loop below runs zero times
  # and the whole check reports success for precisely the broken artifact it exists to catch — and
  # that vacuum is what a later stage adding its own skill would land in.
  [ -n "$REFS" ] || { bad "shim $shim names NO .agents/skills/... body (vacuous pass)"; SHIM_REFS_OK=0; }
  for ref in $REFS; do
    [ -f "$ADOPTER/$ref" ] || { bad "shim $shim points at $ref, which is NOT installed"; SHIM_REFS_OK=0; }
  done
done
[ "$SHIM_REFS_OK" = 1 ] && ok "every shim names a body AND that body resolves on disk (both lanes)"
# …and init itself must REPORT a broken installed shim rather than certify it. Verified against a
# throwaway adopter so the main one stays healthy for the rest of the suite.
SHIMTEST="$WORK/shimtest"; git init -q "$SHIMTEST"; git -C "$SHIMTEST" config user.email a@a; git -C "$SHIMTEST" config user.name a
node "$KIT/bin/init.mjs" --target "$SHIMTEST" --repo-name shimtest --skip-codex-prompt >/dev/null 2>&1
printf -- '---\nname: humanize\n---\nRead `.agents/skills/gone-forever/SKILL.md`.\n' > "$SHIMTEST/.claude/skills/humanize/SKILL.md"
SHIM_RERUN="$(node "$KIT/bin/init.mjs" --target "$SHIMTEST" --repo-name shimtest --skip-codex-prompt 2>&1)"
if printf '%s' "$SHIM_RERUN" | grep -q "which is NOT installed"; then
  ok "init reads the INSTALLED shim: a kept, dangling shim is REPORTED (not certified from kit source)"
else
  bad "init certified a kept shim pointing at a missing body — it validated the kit's copy, not the adopter's"
fi
printf '%s' "$SHIM_RERUN" | grep -q "all resolve on disk" && bad "init printed a clean bill of health alongside a dangling shim" || ok "init does NOT also claim every reference resolves"
# and the shims carry NO rules of their own — the whole point of one shared body.
if grep -q "Word budget" "$SK_CLAUDE" || grep -q "Word budget" "$SK_CODEX"; then
  bad "a shim duplicates the body's rules — the shared-body invariant is broken"
else
  ok "shims hold no rules of their own (the body is the only copy)"
fi

echo
echo "(commands + skills idempotency) a second init KEEPS user edits — no clobber, no duplicate pointer"
# Plant a real USER EDIT into each installed asset first: a source-identical SHA check would stay GREEN
# even if copyGuarded regressed to overwrite (a re-copy is byte-identical), so the file must be MUTATED
# for the no-clobber assertion to be non-vacuous.
printf '\n<!-- user edit: keep me -->\n' >> "$CMD_CLAUDE"
printf '\n<!-- user edit: keep me -->\n' >> "$CMD_CODEX"
printf '\n<!-- user edit: keep me -->\n' >> "$SK_BODY"
printf '\n<!-- user edit: keep me -->\n' >> "$SK_CLAUDE"
printf '\n<!-- user edit: keep me -->\n' >> "$SK_CODEX"
CLAUDE_EDIT_SHA="$(shasum "$CMD_CLAUDE" | awk '{print $1}')"
CODEX_EDIT_SHA="$(shasum "$CMD_CODEX" | awk '{print $1}')"
SK_BODY_SHA="$(shasum "$SK_BODY" | awk '{print $1}')"
SK_CLAUDE_SHA="$(shasum "$SK_CLAUDE" | awk '{print $1}')"
SK_CODEX_SHA="$(shasum "$SK_CODEX" | awk '{print $1}')"
AGENTS_SHA1="$(shasum "$ADOPTER/AGENTS.md" | awk '{print $1}')"
node "$KIT/bin/init.mjs" --target "$ADOPTER" --repo-name adopter \
  --remote-url git@github.com:you/adopter.git --source-dirs src,policy \
  --risk-tokens billing --state-docs docs/state.md --memory-dir "$WORK/mem" \
  --codex-prompts-dir "$CODEX_PROMPTS" >/dev/null 2>&1 && ok "re-run init exits 0 (idempotent)" || bad "re-run init should exit 0"
assert_eq "1" "$(grep -c 'workflow-kit:thread-restart-pointer' "$ADOPTER/AGENTS.md")" "AGENTS pointer still appears exactly once after re-run (no duplication)"
assert_eq "$CLAUDE_EDIT_SHA" "$(shasum "$CMD_CLAUDE" | awk '{print $1}')" "re-run KEEPS a user-edited Claude command (no clobber without --force)"
assert_eq "$CODEX_EDIT_SHA"  "$(shasum "$CMD_CODEX" | awk '{print $1}')" "re-run KEEPS a user-edited Codex prompt (no clobber without --force)"
assert_eq "$SK_BODY_SHA"   "$(shasum "$SK_BODY" | awk '{print $1}')"   "re-run KEEPS a user-edited shared skill BODY (no clobber without --force)"
assert_eq "$SK_CLAUDE_SHA" "$(shasum "$SK_CLAUDE" | awk '{print $1}')" "re-run KEEPS a user-edited Claude skill shim (no clobber without --force)"
assert_eq "$SK_CODEX_SHA"  "$(shasum "$SK_CODEX" | awk '{print $1}')"  "re-run KEEPS a user-edited Codex skill prompt (no clobber without --force)"
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

echo
echo "(settings) the Stop registration is MERGED and confirmed by read-back, exactly once"
# init's mergeSettings re-reads the file it just wrote and reports verify-failed if a registration is
# missing. Assert the on-disk result directly — "init said it merged" is not evidence that it did.
STOP_CMD='guard-owner-comms.mjs'
assert_eq "1" "$(node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const groups = (s.hooks && s.hooks.Stop) || [];
  let n = 0;
  for (const g of groups) for (const h of (g.hooks || [])) if (String(h.command).includes(process.argv[2])) n++;
  console.log(n);
' "$ADOPTER/.claude/settings.json" "$STOP_CMD")" "Stop hook registered exactly once on disk after TWO init runs (merge is idempotent)"
# the three PreToolUse guards are still registered alongside it (the new event did not displace them)
assert_eq "3" "$(node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const groups = (s.hooks && s.hooks.PreToolUse) || [];
  let n = 0;
  for (const g of groups) for (const h of (g.hooks || [])) if (/guard-(cross-repo-writes|lane-authoring|gate-ladder)\.mjs/.test(String(h.command))) n++;
  console.log(n);
' "$ADOPTER/.claude/settings.json")" "the 3 PreToolUse guards remain registered after the Stop merge"

echo
echo "(comms sensor) guard-owner-comms — a Stop SENSOR that FAILS OPEN; proven in BOTH directions"
# NOT a control: it cannot prevent anything (a Stop hook fires after the message is already sent) and
# every error path allows. But it DOES make decisions, so each decision is observed both ways. The
# WITHOUT/WITH pair here is the sensor's own arming condition: an unfilled {{OWNER_NAME}} = dormant.
H_COMMS="$ADOPTER/.claude/hooks/guard-owner-comms.mjs"
TRANSCRIPT="$WORK/transcript.jsonl"
# build a two-entry transcript: the Owner's message, then the agent's final answer
mk_transcript() { # $1=user text  $2=assistant text
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1],
      JSON.stringify({ type: "user", message: { role: "user", content: process.argv[2] } }) + "\n" +
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: process.argv[3] }] } }) + "\n");
  ' "$TRANSCRIPT" "$1" "$2"
}
# echo "block" if the sensor blocked, "allow" if it cleanly allowed, "CRASH" on a non-zero exit.
# A crash must NOT read as "allow": mapping every failure to allow would let a hook that threw on
# every input satisfy each fail-open assertion below without ever running its logic.
comms_decision() { # $1=extra json fields (may be empty)  $2=env assignments (may be empty)
  local out rc
  out="$(printf '{"transcript_path":"%s"%s}' "$TRANSCRIPT" "$1" \
    | (cd "$ADOPTER" && env CLAUDE_PROJECT_DIR="$ADOPTER" $2 node "$H_COMMS") 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then echo "CRASH(rc=$rc)"; return; fi
  if printf '%s' "$out" | grep -q '"decision":"block"'; then echo block; else echo allow; fi
}
LONG_ANSWER="$(node -e 'console.log("word ".repeat(400))')"
mk_transcript "AR" "$LONG_ANSWER"
# WITHOUT an armed contract: {{OWNER_NAME}} is still unfilled, so the sensor is DORMANT and the
# over-answer sails through. This is the "danger" half — and it is also the SHIPPED default.
grep -q '{{OWNER_NAME}}' "$ADOPTER/core/OWNER_COMMS.md" && ok "adopted without --owner-name: core/OWNER_COMMS.md still carries {{OWNER_NAME}}" || bad "expected an unfilled {{OWNER_NAME}} before arming"
assert_eq allow "$(comms_decision "" "")" "WITHOUT a named Owner: sensor DORMANT — a 400-word answer to a 1-word question passes (the danger)"
# ARM IT exactly as an adopter would: name the Owner AND declare their shorthand. Naming alone arms
# the sensor but teaches it no vocabulary — the template's example rows are FENCED precisely so one
# Owner's shorthand is never silently attributed to another, so real rows go outside the fence.
sed -i.bak 's/{{OWNER_NAME}}/Alex/g' "$ADOPTER/core/OWNER_COMMS.md" && rm -f "$ADOPTER/core/OWNER_COMMS.md.bak"
assert_eq allow "$(comms_decision "" "")" "armed but shorthand UNDECLARED: 'AR' is not yet one of Alex's tokens (fenced examples are not their vocabulary)"
node -e '
  const fs = require("fs"), p = process.argv[1];
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("{{OWNER_SHORTHAND}}",
    "`AR` = archive ready? — is this thread closed out on the remote.\n`MIS` = make it so — proceed on the agreed scope."));
' "$ADOPTER/core/OWNER_COMMS.md"
assert_eq block "$(comms_decision "" "")" "shorthand DECLARED: the SAME transcript is now flagged (SIZE MISMATCH on Alex's own question token)"
# --- each decision, both directions ---
mk_transcript "AR" "Yes — closed out and verified on the remote."
assert_eq allow "$(comms_decision "" "")" "armed: a SHORT answer to the same question passes (no over-block)"
mk_transcript "MIS" "$LONG_ANSWER"
assert_eq allow "$(comms_decision "" "")" "armed: MIS is an INSTRUCTION (its gloss carries no '?') — a long work report is fine"
mk_transcript "ready to ship?" "$LONG_ANSWER"
assert_eq block "$(comms_decision "" "")" "armed: a short yes/no question answered at length is flagged"
mk_transcript "go ahead and refactor the whole billing module please, take your time" "$LONG_ANSWER"
assert_eq allow "$(comms_decision "" "")" "armed: a LONG instruction answered at length passes (not a short question)"
mk_transcript "can you give me the full inventory?" "$LONG_ANSWER"
assert_eq allow "$(comms_decision "" "")" "armed: a request FOR detail is not over-answered by giving it (never tell the agent to withhold what was asked for)"
mk_transcript "what changed?" "Let me check the config and report back."
assert_eq block "$(comms_decision "" "")" "armed: narration in the FINAL message is flagged"
mk_transcript "what changed?" "- Let me check the config and report back."
assert_eq block "$(comms_decision "" "")" "armed: narration is caught in a BULLET too (markdown shape must not change the verdict)"
mk_transcript "safe?" "Yes, safe. I will run the deploy once you say go."
assert_eq allow "$(comms_decision "" "")" "armed: a deferred COMMITMENT is not narration (idiomatic close, not work-announcing)"
mk_transcript "what changed?" '```
Let me check the config
```
Nothing changed.'
assert_eq allow "$(comms_decision "" "")" "armed: the same words inside a CODE FENCE are evidence, not narration (no false positive)"
mk_transcript "what changed?" '~~~
Let me check the config
~~~
Nothing changed.'
assert_eq allow "$(comms_decision "" "")" "armed: TILDE fences are stripped too (both CommonMark fence styles)"
# The harness injects <system-reminder> blocks into the Owner's turn routinely. Discarding the turn —
# or letting a trailing block inflate the word count — silently removed the size check on exactly the
# short-question turns this sensor exists for. Both orderings must survive.
mk_transcript "<system-reminder>project context blob</system-reminder>
AR" "$LONG_ANSWER"
assert_eq block "$(comms_decision "" "")" "armed: a LEADING system-reminder is stripped, not treated as the Owner's words"
mk_transcript "AR
<system-reminder>project context blob</system-reminder>" "$LONG_ANSWER"
assert_eq block "$(comms_decision "" "")" "armed: a TRAILING system-reminder is stripped (it must not inflate the word count)"
mk_transcript "<system-reminder>nothing was typed</system-reminder>" "$LONG_ANSWER"
assert_eq allow "$(comms_decision "" "")" "armed: a turn with NO Owner-typed text has no question to size against"
# --- fail-open paths: every one of these must allow, or the sensor could wedge a session ---
mk_transcript "AR" "$LONG_ANSWER"
assert_eq allow "$(comms_decision ',"stop_hook_active":true' "")" "loop safety: stop_hook_active always allows (one block per turn, max)"
assert_eq allow "$(comms_decision "" "WORKFLOW_KIT_COMMS_GUARD=false")" "off switch: WORKFLOW_KIT_COMMS_GUARD=false allows"
# Route this through the crash-aware helper too. Grepping for the absence of "block" would report a
# hook that THREW on malformed input as a clean "allow" — the same conflation the helper exists to stop.
MALFORMED_OUT="$(printf 'NOT JSON{' | (cd "$ADOPTER" && CLAUDE_PROJECT_DIR="$ADOPTER" node "$H_COMMS" 2>/dev/null))"
MALFORMED_RC=$?
if [ "$MALFORMED_RC" -ne 0 ]; then
  bad "malformed stdin CRASHED the hook (rc=$MALFORMED_RC) — a crash is not a clean fail-open"
elif printf '%s' "$MALFORMED_OUT" | grep -q '"decision":"block"'; then
  bad "malformed stdin must ALLOW (the sensor fails OPEN)"
else ok "fail-open: malformed stdin allows cleanly (exit 0, no block)"; fi
mv "$ADOPTER/core/OWNER_COMMS.md" "$WORK/OWNER_COMMS.hidden"
assert_eq allow "$(comms_decision "" "")" "fail-open: an ABSENT core/OWNER_COMMS.md allows (no contract, no nudge)"
mv "$WORK/OWNER_COMMS.hidden" "$ADOPTER/core/OWNER_COMMS.md"
# A heading the hook cannot parse is DORMANT — and init must SAY dormant for the same file. init and
# the hook share one imported predicate; when they were two hand-kept copies, init announced ARMED on
# repos where the hook allowed unconditionally. Assert the AGREEMENT, not just each half.
cp "$ADOPTER/core/OWNER_COMMS.md" "$WORK/OWNER_COMMS.armed"
sed -i.bak 's/^## How to talk to Alex — Owner, not a developer$/## Owner notes/' "$ADOPTER/core/OWNER_COMMS.md" && rm -f "$ADOPTER/core/OWNER_COMMS.md.bak"
mk_transcript "AR" "$LONG_ANSWER"
assert_eq allow "$(comms_decision "" "")" "a RETITLED heading leaves the sensor dormant (it parses one exact shape)"
INIT_SAYS="$(node "$KIT/bin/init.mjs" --target "$ADOPTER" --repo-name adopter --codex-prompts-dir "$CODEX_PROMPTS" 2>&1 | grep 'core/OWNER_COMMS.md:')"
if printf '%s' "$INIT_SAYS" | grep -q 'DORMANT'; then
  ok "init AGREES with the hook on a retitled heading (reports DORMANT, not a false ARMED)"
else
  bad "init disagrees with the hook: it reported '$(printf '%s' "$INIT_SAYS" | head -c 90)' while the hook allows unconditionally"
fi
cp "$WORK/OWNER_COMMS.armed" "$ADOPTER/core/OWNER_COMMS.md"
# and the doc it reads is governed like every other core/*.md — CLASS: BINDING declares the access
# pattern, and check-doc-size's core/ auto-discovery is what actually governs it (asserted below).
grep -q 'CLASS: BINDING' "$ADOPTER/core/OWNER_COMMS.md" && ok "generated core/OWNER_COMMS.md declares CLASS: BINDING (the access pattern doc:size caps on)" || bad "generated OWNER_COMMS.md must declare CLASS: BINDING"
cp "$ADOPTER/core/OWNER_COMMS.md" "$WORK/OWNER_COMMS.sized"
head -c 25000 /dev/zero | tr '\0' 'x' >> "$ADOPTER/core/OWNER_COMMS.md"
if (cd "$ADOPTER" && node scripts/check-doc-size.mjs >/dev/null 2>&1); then
  bad "an over-cap core/OWNER_COMMS.md should FAIL doc:size — the governance claim is fiction"
else
  ok "doc:size GOVERNS the generated OWNER_COMMS (over-cap -> exit 1, via core/ auto-discovery)"
fi
cp "$WORK/OWNER_COMMS.sized" "$ADOPTER/core/OWNER_COMMS.md"

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
# (v1.5.0) The token deny-set's block/permit pair died with the `lane` route it screened. The route's
# own REFUSAL is the demonstration now, and the parameterized-config both-ways proof is anchored on
# executedPathDirs (the F1 policy-dir pattern below).
echo "(retired route) a mode:\"lane\" declaration is REFUSED at write time — explicit state, says WHY"
printf '{"mode":"lane","sessionId":"%s","taskId":"accept","allowedFiles":["src/x.mjs"]}\n' "$SID" > "$DECL"
LANE_OUT="$(guard_output "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")"
printf '%s' "$LANE_OUT" | grep -q '"permissionDecision":"deny"' && ok "write-time: mode:\"lane\" code write is BLOCKED" || bad "write-time: mode:\"lane\" must be blocked (got: $(printf '%s' "$LANE_OUT" | head -c 100))"
printf '%s' "$LANE_OUT" | grep -q 'lane-retired' && ok "the deny names the EXPLICIT lane-retired state (not a fall-through to malformed)" || bad "the deny must name the lane-retired state"
if printf '%s' "$LANE_OUT" | grep -q 'RETIRED' && printf '%s' "$LANE_OUT" | grep -q 'not an available route'; then
  ok "the remediation says WHY (route RETIRED, not available) and points at the live routes"
else
  bad "the deny must carry the retirement remediation string"
fi
grep -q '"state":"lane-retired"' "$ADOPTER/.claude/lane-ledger.jsonl" && ok "the refusal is LEDGERED (state lane-retired)" || bad "the lane-retired refusal must append a ledger row"
# the two DOCUMENTED routes still permit the SAME write — the refusal does not over-block
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
assert_eq allow "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "in-thread still permits the SAME write (no over-block)"
printf '{"mode":"exempt","sessionId":"%s","taskId":"accept","reason":"trivial-edit"}\n' "$SID" > "$DECL"
assert_eq allow "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "exempt still permits the SAME write (no over-block)"

echo
echo "(fail-closed) a MALFORMED config blocks a code write (never silently permits)"
printf 'NOT JSON{' > "$ADOPTER/.claude/kit.config.json"
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
assert_eq deny "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "malformed kit.config.json -> code write BLOCKED (fail-closed, even with a valid declaration)"
# restore a valid config for the commit tests. It DELIBERATELY carries a legacy laneRiskTokens key
# (a pre-v1.5 adopter's config): tolerated means IGNORED-not-fatal, while a structurally corrupt
# file (just proven above) still blocks. Distinct properties; both must hold.
printf '{"executedPathDirs":["src"],"laneRiskTokens":["billing"],"stateDocs":["docs/state.md"]}\n' > "$ADOPTER/.claude/kit.config.json"
assert_eq allow "$(guard_decision "$H_LANE" '{"session_id":"'"$SID"'","tool_input":{"file_path":"src/x.mjs"}}' "$ADOPTER")" "a legacy laneRiskTokens key in an older adopter's config is TOLERATED (ignored, not fatal)"

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

echo
echo "(retired route, commit floor) mode:\"lane\" is REFUSED at commit time too — every lane"
printf '{"mode":"lane","sessionId":"%s","taskId":"accept","allowedFiles":["src/feature2.mjs"]}\n' "$SID" > "$DECL"
printf 'export const y = 2;\n' > "$ADOPTER/src/feature2.mjs"
git -C "$ADOPTER" add src/feature2.mjs
if LANE_COMMIT_ERR="$(git -C "$ADOPTER" commit -q -m "retired route" 2>&1)"; then
  bad "commit floor: a mode:\"lane\" declaration must BLOCK a code commit"
else
  ok "commit floor: mode:\"lane\" code commit is BLOCKED"
fi
printf '%s' "$LANE_COMMIT_ERR" | grep -q 'retired `lane` route' && ok "the block names the retired route explicitly (not a generic malformed)" || bad "the commit block must name the retired lane route"
printf '%s' "$LANE_COMMIT_ERR" | grep -q 'RETIRED' && ok "the block carries the retirement remediation (says WHY, points at in-thread)" || bad "the commit block must carry the retirement string"
# the SAME staged file commits under a documented route (no over-block)
printf '{"mode":"in-thread","sessionId":"%s","taskId":"accept","tier":"T2"}\n' "$SID" > "$DECL"
if git -C "$ADOPTER" commit -q -m "same file, documented route"; then ok "the SAME staged file commits under in-thread (no over-block)"; else bad "in-thread commit of the same file should pass"; fi

GOODCFG='{"executedPathDirs":["src","policy"],"laneRiskTokens":["billing"],"stateDocs":["docs/state.md"]}'
# GOODCFG keeps the legacy laneRiskTokens key on purpose — every fail-closed proof below runs against
# a config that ALSO carries the tolerated dead key, so tolerance and fail-closed are proven together.

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
