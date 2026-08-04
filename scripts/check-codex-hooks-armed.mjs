#!/usr/bin/env node
// workflow-kit — check-codex-hooks-armed.mjs. Prove whether this repo's CODEX-lane hooks actually RUN.
//
// WHY THIS EXISTS — a platform property, measured 2026-08-04 against codex-cli 0.146.0-alpha.9.2:
// Codex will not run a repo's hooks until a human has REVIEWED AND TRUSTED them, and that review
// happens only in the interactive TUI ("Hooks need review" → "Trust all and continue"). In
// `codex exec` — the non-interactive mode the kit's own gate runners use — an untrusted hook is
// skipped SILENTLY: no prompt, no warning, no exit-code change. Observed directly: a guard that
// hard-blocked a write when trusted allowed the identical write when untrusted, and the full run
// output contained ZERO mentions of hooks being skipped.
//
// That is manufactured assurance as a PLATFORM property — installed control, believing adopter,
// nothing anywhere saying otherwise. The kit cannot fix Codex, so it ships the antidote: a check that
// makes the armed/unarmed state OBSERVABLE. This is the kit's dead-sensor rule (never accept "it
// didn't fire" without proving the mechanism was live) turned into a tool an adopter can run.
//
// WHAT IT OBSERVES, AND WHY IT IS THE LEDGER AND NOT THE FILE. The obvious probe — "ask Codex to
// write something the guard forbids, then see if the file appeared" — IS WRONG, and this script was
// written that way first and caught in testing. A file can be absent for many reasons that have
// nothing to do with our guard: the model declines, the patch is malformed, or — the case actually
// hit — CODEX'S OWN SANDBOX refuses the path ("patch rejected: writing outside of the project"). The
// first draft targeted `.codex/`, which Codex treats as outside the writable project, so it reported
// ARMED against hooks that were provably untrusted: a false green in the very check whose job is to
// stop false greens. Worse, Codex's own narration said "The hook blocked the file creation" — so the
// agent's account of WHY was wrong too, and believing it would have laundered the error.
//
// So this check requires POSITIVE EVIDENCE THAT OUR CONTROL RAN, not the absence of an outcome:
// `guard-lane-authoring.mjs` appends one row to `.claude/lane-ledger.jsonl` for EVERY gated decision,
// allow or deny. A new row is the guard's own signature.
//   · ledger grew    ⇒ the guard ran ⇒ ARMED (the row also records what it decided).
//   · ledger unchanged ⇒ the guard never ran ⇒ NOT ARMED.
// The target is a root-level `.mjs`, which the guard gates as code AND which sits inside Codex's
// writable project scope — so the guard is the only thing that can intervene.
//
// HONEST LIMITS, because this check is itself a control and owes them:
//  · It needs the `codex` CLI, a working session, and ONE model call. There is no way to prove a hook
//    fires without running the harness that fires it; a static file check proves only presence.
//  · ARMED means "the guard ran on THIS invocation, in this repo, for this trust state". It says
//    nothing about whether the guard's DECISIONS are right — that is the acceptance suite's job.
//  · It exercises the apply_patch path. A Codex write issued through a plain shell command is not
//    covered by these hooks at all (see PORTABILITY.md); this check cannot make that gap visible.
//  · It never grants trust and never passes `--dangerously-bypass-hook-trust`. Trust is the human's
//    informed consent to let hooks run outside the sandbox; a kit that auto-granted it — by the flag
//    or by writing `trusted_hash` itself — would be forging that consent, not delivering a control.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const LEDGER_REL = path.join(".claude", "lane-ledger.jsonl");
const PROBE_REL = "kit-armed-probe.mjs";   // gated as code, and inside Codex's writable project scope

// Count COMPLETE rows only. A partial trailing line is not a decision the guard finished recording,
// and counting it would let a torn write read as evidence the control ran.
function ledgerRows(abs) {
  if (!existsSync(abs)) return 0;
  try { return readFileSync(abs, "utf8").split("\n").filter((l) => l.trim()).length; }
  catch { return -1; }                      // unreadable ⇒ caller ABSTAINS rather than guessing
}

function main() {
  const repo = path.resolve(process.argv[2] || process.cwd());
  const ledgerAbs = path.join(repo, LEDGER_REL);
  const probeAbs = path.join(repo, PROBE_REL);

  if (!existsSync(path.join(repo, ".codex", "hooks.json"))) {
    console.log(`NOT INSTALLED — .codex/hooks.json is absent in ${repo}.`);
    console.log(`  Run: node bin/init.mjs --target ${repo}   (then grant trust — see below)`);
    process.exit(2);
  }
  try { execFileSync("codex", ["--version"], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch {
    // ABSTAIN, never green. A missing CLI leaves the question UNANSWERED, and "unanswered" reported
    // as "armed" is the exact failure this script exists to prevent.
    console.log("UNKNOWN — the `codex` CLI is not on PATH, so the armed state was NOT determined.");
    console.log("  This is an ABSTAIN, not a pass. Install Codex, or treat the Codex lane as UNGUARDED.");
    process.exit(2);
  }

  const before = ledgerRows(ledgerAbs);
  if (before < 0) {
    console.log(`UNKNOWN — ${LEDGER_REL} exists but could not be read, so the guard's signature is unobservable. ABSTAIN.`);
    process.exit(2);
  }
  if (existsSync(probeAbs)) rmSync(probeAbs, { force: true });   // establish the pre-state, never assume it

  const r = spawnSync("codex", ["exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", repo,
    `Using apply_patch, create the file ${PROBE_REL} containing exactly: // probe. ` +
    `If something blocks it, say so and stop. Do not retry and do not use shell commands instead.`,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], input: "" });

  if (existsSync(probeAbs)) rmSync(probeAbs, { force: true });
  if (r.error) {
    console.log(`UNKNOWN — could not run \`codex exec\` (${r.error.code || r.error.message}). ABSTAIN, not a pass.`);
    process.exit(2);
  }

  const after = ledgerRows(ledgerAbs);
  if (after > before) {
    console.log(`ARMED — the lane guard ran: ${LEDGER_REL} gained ${after - before} row(s) during a real Codex write attempt.`);
    console.log("  That row is the control's own signature, so this is positive evidence, not an inference from a missing file.");
    process.exit(0);
  }

  console.log("NOT ARMED — Codex attempted a gated write and the lane guard left NO ledger row. Your Codex lane is UNGUARDED.");
  console.log("  Codex does not run a repo's hooks until a human reviews and trusts them, and in");
  console.log("  `codex exec` it skips them SILENTLY — which is why this check exists.");
  console.log("  Fix: run `codex` INTERACTIVELY in this repo once. It shows \"Hooks need review\";");
  console.log("  choose \"Trust all and continue\". Trust then persists for non-interactive runs too.");
  console.log("  Note: editing or upgrading a hook (e.g. `init --force`) marks it CHANGED and");
  console.log("  DISARMS it until you approve again — re-run this check after any kit upgrade.");
  console.log("  Do NOT use --dangerously-bypass-hook-trust: it arms every hook from every source.");
  process.exit(1);
}

main();
