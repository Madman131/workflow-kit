#!/usr/bin/env node
// workflow-kit — check-codex-hooks-armed.mjs. Prove whether this repo's CODEX-lane hooks actually RUN.
//
// WHY THIS EXISTS — a platform property, measured against codex-cli 0.146.0-alpha.9.2: Codex will
// not run a repo's hooks until a human has REVIEWED AND TRUSTED them, and that review happens only
// in the interactive TUI ("Hooks need review" → "Trust all and continue"). In `codex exec` — the
// non-interactive mode the kit's own gate runners use — an untrusted hook is skipped SILENTLY: no
// prompt, no warning, no exit-code change. Observed directly: a guard that hard-blocked a write when
// trusted allowed the identical write when untrusted, and the full run output contained ZERO
// mentions of hooks being skipped.
//
// That is manufactured assurance as a PLATFORM property — installed control, believing adopter,
// nothing anywhere saying otherwise. The kit cannot fix Codex, so it ships the antidote: a check
// that makes the armed/unarmed state OBSERVABLE. This is the kit's dead-sensor rule (never accept
// "it didn't fire" without proving the mechanism was live) turned into a tool you can run.
//
// WHAT IT OBSERVES, AND WHY IT IS THE LEDGER AND NOT THE FILE. The obvious probe — "ask Codex to
// write something the guard forbids, then see if the file appeared" — IS WRONG, and this script was
// written that way first and caught in testing. A file can be absent for many reasons that have
// nothing to do with our guard: the model declines, the patch is malformed, or — the case actually
// hit — CODEX'S OWN SANDBOX refuses the path ("patch rejected: writing outside of the project"). The
// first draft targeted `.codex/`, which Codex treats as outside the writable project, so it reported
// ARMED against hooks that were provably untrusted: a false green in the very check whose job is to
// stop false greens. Worse, Codex's own narration said "The hook blocked the file creation" — so the
// agent's account of WHY was wrong too, and believing it would have laundered the error. A model's
// story about a mechanism is not evidence about that mechanism.
//
// So this check requires POSITIVE EVIDENCE THAT OUR CONTROL RAN, not the absence of an outcome:
// `guard-lane-authoring.mjs` appends a row to `.claude/lane-ledger.jsonl` for EVERY gated decision,
// allow or deny. A new row is the guard's own signature.
//   · ledger grew      ⇒ the guard ran ⇒ ARMED (the row also records what it decided).
//   · ledger unchanged ⇒ the guard never ran ⇒ NOT ARMED.
// The target is a root-level `.mjs`, which the guard gates as code AND which sits inside Codex's
// writable project scope — so the guard is the only thing that can intervene. It works whatever your
// declaration says: an undeclared write is DENIED and ledgered, a declared one is ALLOWED and
// ledgered. Both are rows; both prove the guard ran.
//
// HONEST LIMITS, because this check is itself a control and owes them:
//  · It needs the `codex` CLI, a working session, and ONE model call. There is no way to prove a
//    hook fires without running the harness that fires it; a static file check proves only presence.
//  · ARMED means "the guard ran on THIS invocation, in this repo, for this trust state". It says
//    nothing about whether the guard's DECISIONS are right — that is the test suite's job.
//  · It exercises the apply_patch path. A Codex write issued through a plain shell command is not
//    covered by these hooks at all (PORTABILITY.md); this check cannot make that gap visible.
//  · A ledger that cannot be APPENDED TO (symlinked, unwritable) makes the guard fail closed with no
//    row, which reads here as NOT ARMED. That direction is safe — it never reports a false ARMED —
//    but if you see NOT ARMED on hooks you know are trusted, check the ledger file itself.
//  · It never grants trust and never passes `--dangerously-bypass-hook-trust`. Trust is the human's
//    informed consent to let hooks run outside the sandbox; a kit that auto-granted it — by the flag
//    or by writing `trusted_hash` itself — would be forging that consent, not delivering a control.
//    Knowing where a consent grant lives never licenses writing it.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEDGER_REL = path.join(".claude", "lane-ledger.jsonl");
const PROBE_REL = "kit-armed-probe.mjs";   // gated as code, and inside Codex's writable project scope

// Count COMPLETE rows ABOUT THIS PROBE'S OWN TARGET. Two separate reasons, and the second is a
// false-green route:
//  · A partial trailing line is not a decision the guard finished recording, so only parseable rows
//    count — otherwise a torn write reads as evidence the control ran.
//  · Counting EVERY row means any unrelated guarded write happening in this repo at the same time
//    (another agent, another terminal, a background task) inflates the count and the probe reports
//    ARMED without our probe write ever having been seen. "The ledger grew" is not the guard's
//    signature; "the ledger grew A ROW ABOUT THE FILE I ASKED FOR" is.
function ledgerRows(abs) {
  if (!existsSync(abs)) return 0;
  let text;
  try { text = readFileSync(abs, "utf8"); }
  catch { return -1; }                      // unreadable ⇒ caller ABSTAINS rather than guessing
  let n = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }   // torn/partial line: not a finished decision
    if (row && typeof row === "object" && row.path === PROBE_REL) n++;
  }
  return n;
}

// Does this `.codex/config.toml` REGISTER HOOKS? A DELIBERATE SECOND COPY of `bin/init.mjs`'s
// function of the same name, and the duplication is forced rather than lazy: this script installs
// into an adopter's `scripts/` where `bin/init.mjs` does not exist, so it cannot import it. The kit's
// rule about hand-kept copies still applies, so the two are pinned EQUAL over a shared corpus by
// tests/codex-guard.test.mjs — if they ever disagree, the suite goes red.
//
// The TABLE CONTEXT is the point. A line-shaped `hooks\s*=` regex matches `hooks = true` under
// `[features]`, an ordinary Codex feature flag that registers nothing — and reading that as "the
// adopter registered their own hooks" makes this probe excuse an unregistered lane. Only a
// `[hooks…]` table header or a TOP-LEVEL `hooks` key counts.
export function tomlDeclaresHooks(text) {
  let table = "";
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\[?\s*([^\]]*?)\s*\]\]?/.exec(line);
    if (header) {
      table = header[1];
      if (table === "hooks" || table.startsWith("hooks.")) return true;
      continue;
    }
    if (table === "" && /^hooks\s*(?:=|\.)/.test(line)) return true;
  }
  return false;
}

// THE VERDICT, as a pure function of what was observed — extracted so every branch is testable
// without a model call. Three inputs, three answers, and the middle one is the whole point:
//   ledger grew                  ⇒ ARMED      (the guard's own signature; exit 0)
//   no row, but the file LANDED  ⇒ NOT ARMED  (the write happened and nothing stopped it; exit 1)
//   no row and no file           ⇒ UNKNOWN    (nothing was tested; ABSTAIN, exit 2)
// Did the probe target land, and clear it either way. ONE operation, so the observation cannot be
// ordered after the cleanup that destroys it. Exported so the suite can pin both directions without
// a model call — the rest of this script's glue cannot be reached that cheaply.
export function observeAndClear(abs) {
  const existed = existsSync(abs);
  if (existed) rmSync(abs, { force: true });
  return existed;
}

export function verdictFor({ before, after, wrote }) {
  if (after > before) return "ARMED";
  return wrote ? "NOT_ARMED" : "UNKNOWN";
}

function main() {
  const repo = path.resolve(process.argv[2] || process.cwd());
  const ledgerAbs = path.join(repo, LEDGER_REL);
  const probeAbs = path.join(repo, PROBE_REL);

  if (!existsSync(path.join(repo, ".codex", "hooks.json"))) {
    console.log(`NOT INSTALLED — .codex/hooks.json is absent in ${repo}.`);
    // The kit deliberately writes NO hooks.json when the adopter's own config.toml already declares
    // hooks (Codex wants a single representation for this layer). Saying only "absent" there would
    // send someone to re-run init, which will decline again for the same reason and look broken.
    const cfg = path.join(repo, ".codex", "config.toml");
    let theirs = false;
    try { theirs = tomlDeclaresHooks(readFileSync(cfg, "utf8")); } catch { /* absent */ }
    if (theirs) {
      console.log(`  Your .codex/config.toml declares hooks ITSELF, so the kit did not add a second`);
      console.log(`  registration. Those hooks are yours: this check cannot speak for them.`);
    } else {
      console.log(`  Run: node bin/init.mjs --target ${repo}   (then grant trust — see below)`);
    }
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

  // Whether the write actually landed is EVIDENCE — it separates "nothing stopped it" from "it was
  // never attempted" below — and the cleanup destroys it. Observing and clearing are therefore ONE
  // operation rather than two statements in a fragile order: written as two, inverting them is a
  // silent, plausible edit that turns the evidence into a constant `false`, and no test can catch it
  // because this glue only runs behind a real model call. Made structurally impossible instead.
  const wrote = observeAndClear(probeAbs);
  if (r.error) {
    console.log(`UNKNOWN — could not run \`codex exec\` (${r.error.code || r.error.message}). ABSTAIN, not a pass.`);
    process.exit(2);
  }

  const after = ledgerRows(ledgerAbs);
  const verdict = verdictFor({ before, after, wrote });
  if (verdict === "ARMED") {
    console.log(`ARMED — the lane guard ran: ${LEDGER_REL} gained ${after - before} row(s) during a real Codex write attempt.`);
    console.log("  That row is the control's own signature, so this is positive evidence, not an inference from a missing file.");
    process.exit(0);
  }

  // NO LEDGER ROW IS NOT YET AN ANSWER, and reporting it as one is this check's own trap in mirror
  // image. Two very different worlds produce it:
  //   · Codex ATTEMPTED the write and no guard intervened  ⇒ genuinely NOT ARMED.
  //   · Codex never attempted the write at all             ⇒ NOTHING was tested.
  // The second is not hypothetical and not rare: an adopted repo carries this kit's own AGENTS.md,
  // and an agent that reads it may decline the write on an identity or declaration check before any
  // tool call happens. Observed exactly that — "the required identity check failed because this
  // checkout has no `origin` remote" — against a lane that was provably armed and blocking, which
  // this check then called UNGUARDED. A false alarm is not the safe direction it looks like: an
  // adopter who is told a working control is dead disables it, or stops believing this check.
  //
  // The PROBE FILE settles it. It is deleted before the run, so afterwards:
  //   · file EXISTS  ⇒ the write really happened and nothing stopped it ⇒ NOT ARMED, confidently.
  //   · file ABSENT  ⇒ we cannot tell an inert guard from a write never attempted (Codex's own
  //     sandbox can also refuse a path — see the fixture) ⇒ ABSTAIN, and show the run's own tail so
  //     a human can see which it was.
  if (verdict === "UNKNOWN") {
    console.log("UNKNOWN — no ledger row appeared, but the probe file was never created either, so it is");
    console.log("  NOT possible to tell an inert guard from a write Codex never attempted. ABSTAIN, not a verdict.");
    console.log("  The usual cause is the agent declining before any tool call — an identity or declaration");
    console.log("  check in this repo's own AGENTS.md, or Codex's sandbox refusing the path. The tail of the");
    console.log("  run is below: if it shows the model choosing not to write, fix that precondition (a repo");
    console.log("  with a real `origin` remote and a valid .claude/task-lane.json is the usual fix) and re-run.");
    const tail = `${r.stdout || ""}\n${r.stderr || ""}`.split("\n").filter((l) => l.trim()).slice(-12);
    for (const line of tail) console.log(`    | ${line}`);
    process.exit(2);
  }

  console.log("NOT ARMED — Codex WROTE the probe file and the lane guard left NO ledger row. Your Codex lane is UNGUARDED.");
  console.log("  Codex does not run a repo's hooks until a human reviews and trusts them, and in");
  console.log("  `codex exec` it skips them SILENTLY — which is why this check exists.");
  console.log("  Fix: run `codex` INTERACTIVELY in this repo once. It shows \"Hooks need review\";");
  console.log("  choose \"Trust all and continue\". Trust then persists for non-interactive runs too.");
  console.log("  Note: editing or upgrading a hook (e.g. `init --force`) marks it CHANGED and");
  console.log("  DISARMS it until you approve again — re-run this check after any kit upgrade.");
  console.log("  Do NOT use --dangerously-bypass-hook-trust: it arms every hook from every source.");
  process.exit(1);
}

// Run ONLY as a CLI, so the suite can import `tomlDeclaresHooks` and pin it against init's twin
// without this script spawning a real `codex exec` during `npm test`.
//
// realpathSync, NOT path.resolve — the same trap check-doc-size.mjs documents: resolve() does not
// follow symlinks while fileURLToPath() yields a realpath, so under a symlinked invocation path
// (macOS /tmp -> /private/tmp, where worktrees live) they differ, main() never runs, and the CLI
// exits 0 with NO OUTPUT. For a probe whose entire job is answering "is this armed?", exiting 0 in
// silence is the worst possible failure: it is a pass.
function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) main();
