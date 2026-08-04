// workflow-kit — CAPTURED Codex hook payloads. EVIDENCE, not a control.
//
// PROVENANCE — every object below was captured from a REAL `codex exec` run against
// codex-cli 0.146.0-alpha.9.2 on 2026-08-04, by registering a hook that logged its stdin verbatim.
// None of it is hand-written or inferred. This file exists because the v2.0 findings in
// PORTABILITY.md § Why the Codex lane is unguarded rest on these shapes, and a claim about a payload
// should be checkable against the payload.
//
// NOTHING IN v2.0 READS THIS. It is the handoff to the in-flight Codex-guard changeset, which needs
// exactly these shapes as its test fixtures. Keeping it beside the acceptance suite (rather than in a
// PR body that scrolls away) is deliberate: a fixture that can be imported cannot drift from the
// claims it supports the way a quoted snippet can.
//
// THE FOUR LOAD-BEARING OBSERVATIONS, each visible in the data:
//  1. A write is `tool_name: "apply_patch"` and there is NO `file_path` / `notebook_path` key. The
//     paths live INSIDE `tool_input.command`, as a patch envelope.
//  2. ONE envelope can carry MANY targets, and four different directives. A guard that gates only the
//     first target fails open on the rest.
//  3. `*** Move to:` names a DESTINATION while the enclosing `*** Update File:` names the SOURCE.
//     Both are targets: a rename can carry a file out of a gated directory, so gating only the source
//     is a fail-open.
//  4. A shell command is `tool_name: "Bash"` with `tool_input.command` — Claude-compatible, which is
//     why the gate-ladder sensor's matcher works unchanged while the write guards' do not.

// A single-file add — the minimal envelope.
export const APPLY_PATCH_ADD = {
  session_id: "019fccf3-7fb7-7b42-a46d-27b4119ffb02",
  turn_id: "019fccf3-805d-7ae2-9d99-6cacafc09b31",
  cwd: "<repo-root>",
  hook_event_name: "PreToolUse",
  permission_mode: "bypassPermissions",
  tool_name: "apply_patch",
  tool_input: { command: "*** Begin Patch\n*** Add File: hello2.txt\n+canary\n*** End Patch" },
  tool_use_id: "exec-3e025a4b-f18b-43f8-9f23-744f3524004e",
};

// THE MULTI-TARGET FIXTURE — all four directives in ONE envelope, captured verbatim. Five distinct
// paths must be gated here: new.txt, tochange.txt, todelete.txt, and BOTH old.txt (source) and
// renamed.txt (destination).
export const APPLY_PATCH_MULTI = {
  session_id: "019fccf6-6e13-7842-81d8-f62d2a521bc4",
  cwd: "<repo-root>",
  hook_event_name: "PreToolUse",
  tool_name: "apply_patch",
  tool_input: {
    command:
      "*** Begin Patch\n" +
      "*** Add File: new.txt\n+NEW\n" +
      "*** Update File: tochange.txt\n@@\n-x\n+CHANGED\n" +
      "*** Delete File: todelete.txt\n" +
      "*** Update File: old.txt\n*** Move to: renamed.txt\n@@\n-one\n+one\n" +
      "*** End Patch",
  },
  tool_use_id: "exec-9e37e37d-db00-44a3-a200-25e0f841eebc",
};
export const APPLY_PATCH_MULTI_EXPECTED_TARGETS = [
  "new.txt", "tochange.txt", "todelete.txt", "old.txt", "renamed.txt",
];

// A shell invocation. Codex normalizes its shell tool to the NAME `Bash`, so a matcher and a
// `tool_input.command` read work unchanged from the Claude lane.
export const BASH_CALL = {
  session_id: "019fccf6-6e13-7842-81d8-f62d2a521bc4",
  cwd: "<repo-root>",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "sed -n '1,40p' tochange.txt; sed -n '1,40p' old.txt" },
};

// Shell commands Codex reached for UNPROMPTED while asked only to create or inspect a file. They are
// recorded because they are the evidence for the shell-write residual: each of these mutates or reads
// a file WITHOUT going through apply_patch, so no PreToolUse write guard sees the write at all.
// NOTE the scope: only the FIRST entry mutates. `sed -n` / `od` were also run freely but only READ,
// and citing a read as write evidence would be the over-claim the docs here exist to correct.
export const OBSERVED_SHELL_WRITES = [
  // Captured verbatim, including the shell wrapper Codex chose:
  "/bin/zsh -lc 'truncate -s 5 hello.txt && wc -c hello.txt && od -An -tx1 hello.txt'",
];
export const OBSERVED_SHELL_READS_ONLY = [
  "sed -n '1,40p' tochange.txt; sed -n '1,40p' old.txt",
];

// The refusal Codex emits when its OWN sandbox rejects a path — NOT a hook decision. Recorded because
// mistaking it for one produced a false ARMED reading during v2.0's work, and Codex's own narration
// misattributed it the same way ("The hook blocked the file creation"). Any future arming check must
// key on OUR control's signature, never on a write having failed.
export const CODEX_SANDBOX_REFUSAL =
  "patch rejected: writing outside of the project; rejected by user approval settings";

// ── HANDOFF: the ARMING-VERIFICATION PROBE ────────────────────────────────────────────────────────
// The probe was written and three-quarters proven during v2.0's work, then deliberately NOT shipped:
// its load-bearing direction (ARMED) is provable only against kit-installed, TRUSTED hooks, which do
// not exist until the Codex-guard changeset lands. The kit does not ship a control whose main
// direction is unproven. Recover the full script from git — it is not dead code, it is early work:
//
//   git show adb0a4e:scripts/check-codex-hooks-armed.mjs
//
// ALREADY PROVEN, do not re-litigate: NOT ARMED → exit 1 (against a repo with genuinely untrusted
// hooks) · NOT INSTALLED → exit 2 · codex CLI absent → exit 2. STILL OWED: the ARMED direction.
//
// RATIFIED CONTRACT it must keep:
//  · ABSTAIN IS EXIT 2, NEVER 0. An unanswered question is not a pass — reporting "unknown" as
//    "armed" is the precise failure the probe exists to prevent.
//  · IT NEVER GRANTS TRUST. Not via `--dangerously-bypass-hook-trust`, and not by writing
//    `trusted_hash` itself. Knowing where a consent grant lives does not license writing it;
//    automating another tool's consent store is forging consent through a quieter door.
//  · IT OBSERVES THE CONTROL, NOT THE OUTCOME. Evidence is the guard's OWN signature — a new row in
//    `.claude/lane-ledger.jsonl`, which guard-lane-authoring appends for every gated decision, allow
//    or deny. See CODEX_SANDBOX_REFUSAL above for why: the first draft inferred "guard denied" from
//    "file absent" and certified hooks that were provably untrusted, because the write had failed for
//    an unrelated reason. A file can be absent for at least four reasons and only one of them is ours.
//  · ITS PROBE TARGET MUST BE GATED BY US **AND** WRITABLE BY CODEX. A root-level `.mjs` satisfies
//    both. `.codex/` does NOT — Codex treats it as outside the writable project, which is exactly the
//    trap that produced the false green.
