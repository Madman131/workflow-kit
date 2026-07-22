#!/usr/bin/env node
// .claude/hooks/guard-gate-ladder.mjs — PreToolUse(Bash). Tests: tests/gate-ladder-hook.test.mjs
// Design contract + gate record: docs/journal/workflow_v2_phase3_design.md
//
// WHY THIS EXISTS: the PM-disposition rule and the 3-round checkpoint were already in the framework
// on 2026-07-15, and a 20-round ladder blew through both — not from disagreement, but because the
// rule was read once at the start and never re-encountered at the moment of the decision. Prose that
// is not in front of you when you decide is not a control.
//
// WHAT IT DOES: on a gate-runner invocation it resolves the DECLARED tier from .claude/task-lane.json
// (FAIL-CLOSED to T3) and surfaces the ladder that tier owes plus the PM disposition contract.
//
// WHAT IT DELIBERATELY DOES NOT DO — it is a SENSOR, NOT AN ACTUATOR (core/OPERATE.md Garden §2:
// "a check reports / surfaces the cure, never enacts"). It NEVER denies, and it keeps NO durable
// state. Two things were built here and removed after review; both removals are load-bearing, so
// do not reintroduce either without re-reading the gate record:
//
//   1. A ROUND COUNTER (retired 2026-07-18, Owner ruling). It counted gate-runner invocations and
//      reported them as `GATE ROUND n/3`. Those are different quantities: a gate ROUND is a
//      CONVERSATION fact (a verdict the PM dispositioned); an invocation is a TREE fact, including
//      --dry-run probes and reviewer subagents' probes. It read "ROUND 11/3" against a real ladder
//      of two. A hook cannot observe reviewer verdicts, so it must not assert a number. The required
//      emission FORMAT is still surfaced below — including the `GATE ROUND <n>/3` line, because that
//      line is the contract — but <n> is left to the PM, and the text says so.
//
//   2. A TIER PIN that denied a mid-task tier downgrade (built and removed in the same changeset,
//      2026-07-19, on a 4-seat NO-GO). It kept $HOME-global state keyed by taskId. Measured
//      failures: concurrent gate runs — which core/GATES.md and CLAUDE.md rule 6 explicitly allow —
//      lost the pin in 21/25 and 15/40 trials, silently permitting the exact downgrade it existed to
//      refuse; a pin-write failure failed OPEN with no warning; one corrupt read destroyed every
//      sibling task's pin and then self-healed, so the next downgrade passed unremarked; a bare
//      taskId key collided across repos and worktrees sharing one $HOME. Decisively, it also DENIED
//      a downgrade that core/WORKFLOW.md § Steer explicitly authorises ("Builder proposes T3 until
//      the Owner confirms a handle to downgrade") — a lower layer overriding the Owner, which is the
//      IO line. And it was bypassable in one step by a cooperative agent following its own deny
//      message. The rule it tried to enforce lives in core/WORKFLOW.md § Steer, where the PM and
//      Owner apply it — the same status it has in the Codex lane, which no hook binds at all.
//
// THE REVIEWER-INJECTION FIX (do not regress). This hook used to inject "YOU ARE THE PM. The
// reviewer advises; you decide" into additionalContext on EVERY matched Bash call, including calls
// made by reviewer seats. Two of three Phase-2 cold reviewers flagged it unprompted and refused it
// as prompt injection; a reviewer that silently switches into PM mode stops being an independent
// seat (core/REVIEW.md § Decorrelation). Three independent guards now, because a reviewer seat is
// not one shape:
//   a. MEASURED, not assumed — a probe on 2026-07-19 dumped raw PreToolUse input from the main
//      thread and from a subagent: the subagent row carries `agent_id`/`agent_type`, the main-thread
//      row carries neither. Presence of `agent_id` suppresses the emission entirely.
//   b. A cold reviewer is often a fresh MAIN-THREAD session (core/BINDINGS.md), which carries no
//      `agent_id`. So the PM contract and the remediation are emitted ONLY to a seat holding a
//      valid, current, THIS-session declaration — the only seat we can positively identify. Every
//      other state is treated as possibly-a-reviewer. (A first version tested for `session-mismatch`
//      alone; the cross-family gate found that a reviewer where the file is merely ABSENT — the
//      common case — still got the PM contract plus an instruction to write the declaration with its
//      own session id. A reviewer that complied would have acted as PM and broken the real PM's
//      next gate.)
//   c. TEXTUAL — the emission assigns no role at all, so no combination of the above can deliver one.
// Guard (a) is a harness field and could change; (c) does not depend on any field. Do not describe
// (a) as fail-safe on its own — if `agent_id` ever stops being set, (a) fails toward EMITTING, and
// (b)+(c) are what hold.
//
// HONEST LIMITS (tripwire, not fortress):
//  - It binds gate commands run through Claude's Bash tool. A bare `codex exec` typed elsewhere, a
//    gate routed through a skill or MCP runtime, or a shell form the matcher does not recognise
//    (`timeout …`, `env …`, a loop or `if` body, command substitution) is simply not surfaced. That
//    costs ONE reminder — nothing is enforced here, so a miss disables nothing. Telling those forms
//    apart needs real shell parsing, an unbounded chase deliberately refused.
//  - It CANNOT verify a cold panel ran, that a verdict was returned, or that the declared tier is
//    the RIGHT tier. The tier is the PM's self-report; the emission says so rather than laundering
//    it into a resolved fact. Owner ratification (core/WORKFLOW.md § Steer) is what makes a T2/T3
//    tier trustworthy — not this hook.
//  - The declaration parse is intentionally duplicated from guard-lane-authoring.mjs rather than
//    shared: that hook guards every code write, and refactoring it would widen this changeset's
//    blast radius into a live control. Drift toward stricter only over-gates. Two shared quirks are
//    known and deferred to a joint changeset: a future mtime never goes stale, and a symlinked
//    declaration is honoured.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DECLARATION = join(".claude", "task-lane.json");
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
const TIERS = ["T0", "T1", "T2", "T3"];
const STRICTEST = "T3";

// A gate INVOCATION — never a mere mention. `git diff -- scripts/codex-gate.sh`, `grep`, `cat`, `rg`
// talk ABOUT the runners constantly; firing on those would surface noise on ordinary work, which
// trains the reader to disable the hook — how controls actually die. So the runner must sit in
// COMMAND POSITION: at the start, or right after a separator (; && || | & newline) or an
// env-assignment / `bash` / `sh` / `exec` / `time` / `nohup` prefix.
// UNCHANGED as of 2026-07-19 and verified byte-identical — the Phase-1 claim that it "counts Bash
// invocations" was wrong; it already excludes mentions.
const CMD_START = String.raw`(?:^|[;&|\n]|\|\||&&)\s*`;
// Interpreter flags deliberately exclude anything containing `n`: `bash -n script` is a SYNTAX
// CHECK, not a run, and it is one of the most common things typed while editing these very files.
const PREFIX = String.raw`(?:(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*(?:(?:command|exec|time|nohup)\s+)?(?:(?:bash|sh|zsh)\s+(?:-[^n\s]+\s+)*)?)`;
const RUNNERS = String.raw`(?:codex\s+exec\b|\S*codex-gate\.sh\b|\S*cold-review-gemini\.sh\b)`;
const GATE_RE = new RegExp(CMD_START + PREFIX + RUNNERS);

// The ladder each tier owes — a transcription of core/WORKFLOW.md § Gate's tier table, not an
// inference. Concrete model families are a per-repo binding (core/BINDINGS.md § Roles → models), so
// this text stays family-neutral and points there.
const LADDER = {
  T0: "self-check → proceed",
  T1: "one blind cold reviewer → proceed",
  T2: "cold panel (≥2 angle seats + 1 free adversary) → cross-family lens [if available] → external gate → Owner push-GO",
  T3: "cold panel (≥3 angle seats + 1 free adversary) → BOTH cross-family families (lens + external, lens REQUIRED) → Owner push-GO",
};

function isPlainObject(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

// Resolve the DECLARED tier. Every failure path returns T3 — there is deliberately NO path that
// resolves to T0 by default. An over-eager default to T0 fails OPEN, the dangerous direction.
function resolveTier(projectRoot, sessionId) {
  const file = join(projectRoot, DECLARATION);
  if (!existsSync(file)) return { tier: STRICTEST, failClosed: "undeclared" };

  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return { tier: STRICTEST, failClosed: "unreadable" }; }

  let decl;
  try { decl = JSON.parse(raw); } catch { return { tier: STRICTEST, failClosed: "malformed" }; }
  if (!isPlainObject(decl)) return { tier: STRICTEST, failClosed: "malformed" };

  const maxAgeHours = decl.maxAgeHours === undefined ? 24 : decl.maxAgeHours;
  if (typeof maxAgeHours !== "number" || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 168) {
    return { tier: STRICTEST, failClosed: "malformed" };
  }
  try {
    const age = Date.now() - statSync(file).mtimeMs;
    // Checked in BOTH directions. A FUTURE mtime is not "fresh" — it is a broken clock or a touched
    // file — and honouring it is a route to a LOWER tier, i.e. fail-OPEN, which would falsify this
    // hook's headline claim that no input resolves below T3 by default. A small negative tolerance
    // absorbs filesystem/NTP jitter. (guard-lane-authoring.mjs still has the one-sided form; that
    // divergence is deliberate and toward STRICTER here — its joint fix is a separate changeset.)
    if (age > maxAgeHours * 3600_000 || age < -300_000) return { tier: STRICTEST, failClosed: "stale" };
  } catch {
    return { tier: STRICTEST, failClosed: "unreadable" };
  }

  if (typeof sessionId !== "string" || !sessionId) return { tier: STRICTEST, failClosed: "missing-session" };
  // session-mismatch is special: the declaration belongs to ANOTHER session, so the reader is very
  // likely a fresh reviewer seat rather than the declaring PM. See guard (b) in the header.
  if (decl.sessionId !== sessionId) return { tier: STRICTEST, failClosed: "session-mismatch" };
  if (typeof decl.taskId !== "string" || !TASK_ID_RE.test(decl.taskId)) return { tier: STRICTEST, failClosed: "bad-task-id" };

  // `lane` and `exempt` carry no tier. Doctrine restricts a lane to T0/T1, so assuming T3 here
  // OVER-gates rather than under-gates — the correct direction to be wrong in. Because nothing is
  // persisted, this guess stays corrigible: declaring a real tier next call simply supersedes it.
  if (decl.mode !== "in-thread") return { tier: STRICTEST, failClosed: "no-tier", taskId: decl.taskId };
  if (!TIERS.includes(decl.tier)) return { tier: STRICTEST, failClosed: "no-tier", taskId: decl.taskId };

  return { tier: decl.tier, taskId: decl.taskId };
}

const CONTRACT =
  `PM DISPOSITION CONTRACT (core/WORKFLOW.md § Gate) — after EVERY verdict and BEFORE any edit,\n` +
  `the changeset's PM record must carry this complete block:\n\n` +
  `GATE ROUND <n>/3 · changeset <name> · verdict <GO|NO-GO>\n` +
  `  <finding> — <severity>\n` +
  `    REAL?     does this failure actually occur, in the STATED threat model? reachable?\n` +
  `    SCOPE?    is this the FEATURE asked for, or machinery introduced along the way?\n` +
  `    BOUNDED?  small and final — or does it mint new surface to review?\n` +
  `    WORTH IT? what breaks if it is DECLINEd? who would ever hit it?\n` +
  `    → REMEDIATE | DEFER | DECLINE | ESCALATE (+ reason)\n` +
  `  LADDER: continue | STOP-AND-ESCALATE\n\n` +
  `No emission ⇒ no fix; an undispositioned fix is out-of-process. DECLINE and DEFER are first-class:\n` +
  `a ladder where everything was REMEDIATE means the PM never engaged. A ladder ends on a JUDGMENT,\n` +
  `never on reviewer silence — an adversarial reviewer never runs out of findings, so "no findings\n` +
  `left" is not reachable. Soft stop after 3 NO-GO rounds per CHANGESET; round 4+ additionally emits\n` +
  `PAST-SOFT-STOP: CONTINUE | STOP-AND-ESCALATE + a specific JUSTIFICATION.\n\n` +
  `<n> is a CONVERSATION fact — the number of reviewer verdicts dispositioned for this changeset.\n` +
  `This hook does not observe it and deliberately does not supply it.\n`;

// The self-report caveat. The hook's only input for "is this the right tier?" is the answer to that
// very question, so it must surface the question rather than answer it (IO). Without this line the
// emission reads as corroboration of a classification nothing checked.
const SELF_REPORT =
  `This tier is the declaration's SELF-REPORT, not a verified fact — this hook cannot tell a\n` +
  `correctly-tiered changeset from a mis-tiered one. Re-derive it against core/WORKFLOW.md § Steer\n` +
  `before relying on the row above: anything touching live-path, chain/stateful, schema, or deploy\n` +
  `code is at least T2, and a T2/T3 tier is only settled once the Owner has RATIFIED it. The tier may\n` +
  `be escalated mid-task at any time; lowering one mid-task needs the Owner's confirmation (§ Steer's\n` +
  `reversibility handle) and belongs in the PM disposition record.\n`;

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let ev;
  try { ev = JSON.parse(input); } catch { process.exit(0); }          // never break the tool on parse
  const cmd = ev?.tool_input?.command ?? "";
  if (!GATE_RE.test(cmd)) process.exit(0);

  // Guard (a): subagent invocations carry `agent_id` (and `agent_type`); main-thread invocations
  // carry neither. Tested for KEY PRESENCE — `in`, not a value comparison — because ANY value under
  // that key marks a subagent-shaped event, including `null`. An earlier version excluded `null`
  // explicitly while its own comment claimed "presence"; the cold gate then produced
  // `{"agent_id":null,"agent_type":"general-purpose",...}` and got the full PM contract. `agent_type`
  // is checked too, so either marker alone suppresses.
  if (ev !== null && typeof ev === "object" && ("agent_id" in ev || "agent_type" in ev)) process.exit(0);

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { tier, failClosed, taskId } = resolveTier(projectRoot, ev?.session_id);

  // Guard (b): PM material goes ONLY to a confirmed PM — a declaration that is valid, current, and
  // bound to THIS session. Any other state (foreign session, undeclared, malformed, stale, missing
  // session id) may be a fresh reviewer seat, which is a MAIN THREAD and so carries no `agent_id`.
  // An earlier version suppressed only on `session-mismatch`; a reviewer working where the file is
  // simply absent — the common case — still received the PM contract AND an instruction to write the
  // declaration with its own session id. A reviewer that complied would have acted as PM and broken
  // the real PM's next gate. So the test is now "is this provably the PM?", not "is this provably a
  // reviewer?" — the PM is the only seat we can positively identify, so it is the only one served.
  const isDeclaredPM = !failClosed;

  const head = isDeclaredPM
    ? `GATE LADDER — declared tier ${tier} · task ${taskId}\n`
    : `GATE LADDER — FAIL-CLOSED to ${tier}: no valid tier declaration for THIS session (${failClosed}).\n` +
      `If you are a reviewer seat, no action is required — do NOT write ${DECLARATION}.\n` +
      `The declaring PM re-declares per core/OPERATE.md § Optional build lanes.\n`;

  const body = `REQUIRED LADDER for ${tier} (families bound in core/BINDINGS.md):\n` +
    `  ${LADDER[tier]}\n` +
    `Any push containing code additionally requires the Owner's push-GO, regardless of tier.\n`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: isDeclaredPM ? `${head}${body}\n${SELF_REPORT}\n${CONTRACT}` : `${head}${body}`,
    },
  }));
  console.error(failClosed
    ? `GATE LADDER: no valid tier declaration (${failClosed}) — FAIL-CLOSED to ${tier}; required ladder surfaced.`
    : `GATE LADDER: declared tier ${tier} · task ${taskId} — required ladder surfaced.`);
  process.exit(0);                                                     // continue normal permission flow
});
