#!/usr/bin/env node
// scripts/sweep.mjs — the sweep sensor: ONE mechanical question over an EXPLICIT file list,
// answered by a single cheap read-only seat, surfacing candidates for a human.
// A SENSOR, NEVER A JUDGE. Doctrine: core/WORKFLOW.md § Gate (the pre-fold sweep is a ceremony,
// not a proof) and core/GATES.md § Pre-flight.
//
// WHAT THE ATTESTATION MEANS — claim exactly what is proven, no more:
//   · The DENOMINATOR is wrapper-verified: this wrapper resolves the list, proves each file
//     readable ITSELF, pre-marks what it cannot read, and fails the run unless every readable
//     file is accounted for by the model with status `scanned`.
//   · The per-file `scanned` status is the MODEL'S ATTESTATION, not a wrapper-verified fact.
//     No in-band check can prove a file was READ — any verifiable probe tells the model what to
//     fetch, proving access at most. Thoroughness is measured out-of-band (a planted-defect
//     corpus), never by this exit code.
// A zero-finding sweep is therefore NOT a clear. Cite the report in the disposition; decide with
// your own judgment.
//
// WHAT THE BANNER PROVES, AND WHAT IT DOES NOT (found by this release's adversarial walk-through).
// The seat check below reads the CLI's own banner rather than the model's self-report, which is the
// right source — but it proves the CLI's CONFIGURATION (model, effort, sandbox, workdir), not the
// AUTHORSHIP of the answer. A Claude-companion plugin that hijacks review-shaped prompts runs its
// substitute review INSIDE a session whose banner is already printed and still correct, so a
// hijacked run would pass every clause here while the report's `seat:` line mis-attributes the
// answer (core/GATES.md § Gotchas / traps). The consequence is bounded — this is a SENSOR whose
// output is candidates for a human, never a decorrelated gate seat — but if such a plugin may be
// installed, run the sweep through the guarded wrapper (`scripts/codex-gate.sh`'s shim + env var)
// and treat the attribution as unverified otherwise.
//
// Usage:
//   node scripts/sweep.mjs --question "<one mechanical question>" --repo <dir>
//                          --files <path> [--files <path>]...
//                          [--seat model:effort] [--out report.md] [--max-files N]
//   --files resolve against --repo (REQUIRED — never inferred from cwd; a spawned agent must
//   never be aimed at whatever checkout the operator happens to be standing in).
// Exit: 0 = every listed file swept · 1 = swept, but listed unreadables declared · 2 = fail-closed.
// Finding COUNT never changes the exit — a sensor that exits nonzero on findings would be a gate.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBanner } from "./codex-banner.mjs";

const DEFAULT_MAX_FILES = 40; // the coverage block is O(files) in model OUTPUT tokens — capped, not implied
const SPAN_PRINT_CAP = 160;   // report hygiene: model-authored spans are truncated for display

// ---------------------------------------------------------------------------- seat binding
//
// THE KIT HARDCODES NO MODEL ID. A portable kit that shipped one would bind every adopter to one
// vendor's lineup and rot the moment that lineup moves (core/GATES.md § Model · effort matrix:
// map by capability, and keep concrete ids in core/BINDINGS.md). The seat is resolved in this
// order, and a run with no resolvable seat FAILS CLOSED rather than guessing:
//   1. --seat model:effort
//   2. `sweepSeat` in .claude/kit.config.json, e.g. {"sweepSeat": "some-cheap-model:high"}
// The sweep is a SENSOR, not a gate, so the fast-cheap tier is the right seat for it — that is
// precisely the tier core/GATES.md forbids from gating.
export function resolveSeat(cliSeat, repoAbs, { readFile = fs.readFileSync } = {}) {
  if (cliSeat) return { seat: cliSeat, source: "--seat" };
  try {
    const raw = readFile(path.join(repoAbs, ".claude", "kit.config.json"), "utf8");
    const val = JSON.parse(raw).sweepSeat;
    if (typeof val === "string" && val.trim()) {
      const parts = val.split(":");
      if (parts.length === 2 && parts.every((p) => p.trim())) {
        return { seat: { model: parts[0], effort: parts[1] }, source: ".claude/kit.config.json sweepSeat" };
      }
      return { seat: null, problem: `kit.config.json sweepSeat is not "model:effort": ${val}` };
    }
  } catch (e) {
    // A MALFORMED config is not the same as an ABSENT one: absent means "no default configured"
    // (the usage error below names both fixes), malformed means a file the adopter believes is
    // configuring this run is not. Say which, or a typo reads as "you never set it".
    if (e instanceof SyntaxError) return { seat: null, problem: `.claude/kit.config.json is not valid JSON (${e.message})` };
  }
  return { seat: null };
}

// ---------------------------------------------------------------------------- argv

function usage(msg) {
  if (msg) process.stderr.write(`sweep: ${msg}\n`);
  process.stderr.write(
    'usage: node scripts/sweep.mjs --question "<q>" --repo <dir> --files <path> [--files <path>]...\n' +
      "                              [--seat model:effort] [--out report.md] [--max-files N]\n"
  );
  process.exit(2);
}

export function parseArgs(argv, { onError = usage } = {}) {
  const out = { files: [], seat: null, maxFiles: DEFAULT_MAX_FILES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) onError(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--question": out.question = next(); break;
      case "--files": out.files.push(next()); break;
      case "--out": out.out = next(); break;
      case "--repo": out.repo = next(); break;
      case "--max-files": {
        const v = Number(next());
        if (!Number.isInteger(v) || v <= 0) onError("--max-files must be a positive integer");
        out.maxFiles = v;
        break;
      }
      case "--seat": {
        const parts = String(next()).split(":");
        if (parts.length !== 2 || parts.some((p) => !p)) onError("--seat expects model:effort");
        out.seat = { model: parts[0], effort: parts[1] };
        break;
      }
      case "-h": case "--help": onError(); break;
      default: onError(`unknown argument "${a}"`);
    }
  }
  if (!out.question || !out.question.trim()) onError("--question is required");
  if (out.files.length === 0) onError("--files is required — the sweep never invents its own list");
  if (!out.repo) onError("--repo is required — never inferred from the invoking directory");
  const dupes = out.files.filter((f, i) => out.files.indexOf(f) !== i);
  if (dupes.length) onError(`duplicate --files entry: ${dupes[0]}`);
  return out;
}

// ---------------------------------------------------------------------------- file list

// The wrapper owns the coverage denominator: it proves each listed file readable itself, dedupes
// on the RESOLVED path (so `a.md` and `./a.md` cannot inflate the count), and a file it cannot
// read is pre-marked and never shown to the model.
export function resolveFiles(files, repo) {
  const readable = [];
  const unreadable = [];
  const seen = new Set();
  for (const f of files) {
    const abs = path.resolve(repo, f);
    if (seen.has(abs)) { unreadable.push({ file: f, reason: "duplicate of an earlier entry" }); continue; }
    seen.add(abs);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) unreadable.push({ file: f, reason: "not a regular file" });
      else { fs.accessSync(abs, fs.constants.R_OK); readable.push(f); }
    } catch (e) {
      unreadable.push({ file: f, reason: e.code || "unreadable" });
    }
  }
  return { readable, unreadable };
}

// ---------------------------------------------------------------------------- prompt + parse

export function buildPrompt(question, readable, nonce) {
  // The markers are given INLINE in prose, never on their own line: the prompt is echoed verbatim
  // into the transcript, and a line-anchored marker in the echo would form a fake answer region.
  return [
    "You are a mechanical SWEEP over an explicit file list. Answer ONE question about every file.",
    "Do not fix anything, do not judge severity, do not expand or shrink the list.",
    "",
    `QUESTION: ${question}`,
    "",
    "FILES (read each one in full — every file below exists and is readable):",
    ...readable.map((f) => `  - ${f}`),
    "",
    `Wrap your ENTIRE answer between the two marker lines SWEEP-BEGIN-${nonce} and ` +
      `SWEEP-END-${nonce}, each alone on its own line. Inside the region emit ONLY these two line`,
    "forms and nothing else:",
    '  FINDING: <file> :: <line> :: "<ONE representative line, quoted exactly>" :: <one-line answer>',
    "  COVERAGE: <file> :: scanned",
    "One FINDING line per finding — never a multi-line quote. Exactly one COVERAGE line per listed",
    "file. Every file is readable — a sweep that cannot scan a file is a FAILED sweep, not an",
    "excusable one. Files outside the list are out of scope.",
  ].join("\n");
}

/**
 * Every complete nonce-delimited region, in order. The echo cannot form one (its markers sit
 * mid-sentence, and the anchors here are whole-line). Real transcripts may repeat the final
 * message after the token trailer, so more than one region is LEGITIMATE — the honesty rule is
 * that all regions must parse to identical records (regionsAgree below), never first- or
 * last-wins, either of which silently accepts a swap.
 */
export function allRegions(logText, nonce) {
  const lines = String(logText).split("\n");
  const begin = new RegExp(`^\\s*SWEEP-BEGIN-${nonce}\\s*$`);
  const end = new RegExp(`^\\s*SWEEP-END-${nonce}\\s*$`);
  const regions = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1 && begin.test(lines[i])) { start = i; continue; }
    if (start !== -1 && end.test(lines[i])) { regions.push(lines.slice(start + 1, i).join("\n")); start = -1; }
  }
  return { regions, danglingBegin: start !== -1 };
}

/**
 * Parse contract lines. Tolerant on whitespace, strict on shape — and a line that LOOKS like a
 * contract line but fails the shape is recorded, never silently dropped: a mangled FINDING that
 * vanishes silently manufactures a false "no findings". Other non-blank lines are counted as
 * prose; tolerated, but reported.
 */
export function parseSweepOutput(text) {
  const findings = [];
  const coverage = new Map();
  const duplicates = [];
  const badContract = [];
  let proseLines = 0;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const f = line.match(/^\s*FINDING:\s*(.+?)\s*::\s*(\d+)\s*::\s*"(.*)"\s*::\s*(.+?)\s*$/);
    if (f) { findings.push({ file: f[1], line: Number(f[2]), span: f[3], answer: f[4] }); continue; }
    const c = line.match(/^\s*COVERAGE:\s*(.+?)\s*::\s*(scanned|unreadable\([^)]*\))\s*$/);
    if (c) {
      if (coverage.has(c[1])) duplicates.push(c[1]);
      coverage.set(c[1], c[2]);
      continue;
    }
    // A non-parsing line CONTAINING a contract keyword is a mangled record, not commentary —
    // a leading bullet or reflow must fail loudly, never read as tolerated prose.
    if (/\b(FINDING|COVERAGE)\b/i.test(line)) badContract.push(line.trim());
    else proseLines++;
  }
  return { findings, coverage, duplicates, badContract, proseLines };
}

/** Do two parsed regions carry identical records? (Order-insensitive on coverage, sensitive on findings.) */
export function regionsAgree(a, b) {
  const canon = (p) => JSON.stringify({
    f: p.findings, c: [...p.coverage.entries()].sort(), d: [...p.duplicates].sort(), b: p.badContract,
  });
  return canon(a) === canon(b);
}

/**
 * The honesty check — pure, so tests bite directly. Empty list = honest. Every readable file needs
 * exactly one coverage line with status `scanned` (the wrapper proved readability, so a
 * model-declared unreadable is a refusal, not an excuse); findings may name files the model was
 * shown, and nothing else; a malformed contract-shaped line is a hard problem.
 */
export function coverageProblems({ readable, unreadable, findings, coverage, duplicates = [], badContract = [] }) {
  const problems = [];
  const listed = new Set([...readable, ...unreadable.map((u) => u.file)]);
  const readableSet = new Set(readable);
  for (const b of badContract) problems.push(`contract-shaped line failed to parse: ${b.slice(0, 120)}`);
  for (const f of readable) {
    if (!coverage.has(f)) problems.push(`listed file has NO coverage line: ${f}`);
    else if (coverage.get(f) !== "scanned") {
      problems.push(`model declared a wrapper-readable file unreadable: ${f} — the sweep is incomplete`);
    }
  }
  for (const [f] of coverage) {
    if (!listed.has(f)) problems.push(`coverage claims a file OUTSIDE the list: ${f}`);
    else if (!readableSet.has(f)) problems.push(`model claims a file the wrapper pre-marked unreadable: ${f}`);
  }
  for (const d of duplicates) problems.push(`more than one coverage line for: ${d}`);
  for (const fd of findings) {
    if (!readableSet.has(fd.file)) {
      problems.push(`finding names a file the model was never shown: ${fd.file} — fabricated evidence`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------- run

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Guard for --out: never clobber, and never write into a git checkout other than --repo — this
 * process writes with its own fs, so the repo's agent-level write guards do not cover it.
 */
export function outPathProblem(outPath, repoReal) {
  const abs = path.resolve(outPath);
  if (fs.existsSync(abs)) return `--out already exists, refusing to overwrite: ${abs}`;
  let dir = path.dirname(abs);
  try { dir = fs.realpathSync(dir); } catch { return `--out directory does not exist: ${dir}`; }
  const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status === 0) {
    const outRepo = (() => { try { return fs.realpathSync(top.stdout.trim()); } catch { return top.stdout.trim(); } })();
    if (outRepo !== repoReal) return `--out is inside a DIFFERENT git checkout (${outRepo}); refusing`;
  }
  return null;
}

export function run(cfg, { stdout = process.stdout, stderr = process.stderr } = {}) {
  // Realpath BEFORE handing the repo to the seat: /tmp is a symlink on macOS, and the banner echoes
  // whatever -C received — an unresolved -C against a resolved expectation false-fails every /tmp repo.
  const repoAbs = (() => { try { return fs.realpathSync(path.resolve(cfg.repo)); } catch { return path.resolve(cfg.repo); } })();

  const { seat, source: seatSource, problem: seatProblem } = resolveSeat(cfg.seat, repoAbs);
  if (!seat) {
    stderr.write(
      `sweep: FAIL-CLOSED — no seat.${seatProblem ? ` ${seatProblem}.` : ""}\n` +
        '  This kit hardcodes no model id. Either pass --seat model:effort, or set "sweepSeat":\n' +
        '  "<model>:<effort>" in .claude/kit.config.json. Bind a FAST-CHEAP tier here: the sweep is a\n' +
        "  sensor, not a gate (core/GATES.md § Model · effort matrix).\n"
    );
    return 2;
  }

  const { readable, unreadable } = resolveFiles(cfg.files, repoAbs);
  if (readable.length === 0) {
    stderr.write("sweep: FAIL-CLOSED — no readable file in the list; nothing to sweep.\n");
    for (const u of unreadable) stderr.write(`  - ${u.file}: ${u.reason}\n`);
    return 2;
  }
  if (readable.length > (cfg.maxFiles ?? DEFAULT_MAX_FILES)) {
    stderr.write(
      `sweep: FAIL-CLOSED — ${readable.length} files exceeds the cap of ${cfg.maxFiles ?? DEFAULT_MAX_FILES}. ` +
        "The coverage block costs model OUTPUT tokens per file; split the sweep, or raise --max-files deliberately.\n"
    );
    return 2;
  }
  if (cfg.out) {
    const p = outPathProblem(cfg.out, repoAbs);
    if (p) { stderr.write(`sweep: FAIL-CLOSED — ${p}\n`); return 2; }
  }

  const nonce = randomBytes(6).toString("hex");
  const prompt = buildPrompt(cfg.question, readable, nonce);
  // One interleaved stream (2>&1 inside the shell): arrival order is what makes banner-first a
  // real property — concatenating stdout after stderr would let forged text precede the banner.
  const cmd =
    ["codex", "exec", "-m", seat.model, "-c", `model_reasoning_effort=${seat.effort}`,
     "-s", "read-only", "-C", repoAbs, "--disable", "code_mode_host"].map(shq).join(" ") + " 2>&1";
  const res = spawnSync("sh", ["-c", cmd],
    { input: prompt, encoding: "utf8", timeout: 900_000, maxBuffer: 32 * 1024 * 1024 });

  if (res.error) {
    const why = res.error.code === "ETIMEDOUT" ? "the seat hit the 900s timeout"
      : res.error.code === "ENOBUFS" ? "output exceeded the capture buffer"
      : `spawn failed: ${res.error.code || res.error.message}`;
    stderr.write(`sweep: FAIL-CLOSED — ${why}.\n`);
    return 2;
  }
  const log = res.stdout || "";
  if (res.status !== 0) {
    stderr.write(`sweep: FAIL-CLOSED — the seat exited ${res.status ?? "by signal"}` +
      `${/command not found|not found/i.test(log) ? " (is the CLI installed?)" : ""}.\n`);
    return 2;
  }

  // Seat verification — the banner, never the model's self-report. Every clause fails CLOSED,
  // and the workdir is realpath'd on BOTH sides before comparing.
  const banner = parseBanner(log);
  const bannerWorkdirReal = banner.workdir === null ? null
    : (() => { try { return fs.realpathSync(path.resolve(banner.workdir)); } catch { return path.resolve(banner.workdir); } })();
  if (banner.model !== seat.model || banner.effort !== seat.effort ||
      banner.sandbox !== "read-only" ||
      bannerWorkdirReal === null || bannerWorkdirReal !== repoAbs) {
    stderr.write(
      `sweep: FAIL-CLOSED — seat UNVERIFIED (banner model=${banner.model} effort=${banner.effort} ` +
        `sandbox=${banner.sandbox} workdir=${banner.workdir}; ` +
        `requested ${seat.model}/${seat.effort}/read-only in ${repoAbs}).\n`
    );
    return 2;
  }

  const { regions, danglingBegin } = allRegions(log, nonce);
  if (regions.length === 0 || danglingBegin) {
    stderr.write("sweep: FAIL-CLOSED — no complete delimited answer region in the transcript.\n");
    return 2;
  }
  const parsedAll = regions.map(parseSweepOutput);
  for (let i = 1; i < parsedAll.length; i++) {
    if (!regionsAgree(parsedAll[0], parsedAll[i])) {
      stderr.write(`sweep: FAIL-CLOSED — the transcript carries ${regions.length} answer regions ` +
        "with DIFFERING records; a swapped or truncated answer cannot be told from an honest one.\n");
      return 2;
    }
  }
  const parsed = parsedAll[0];
  const problems = coverageProblems({ readable, unreadable, ...parsed });
  if (problems.length) {
    stderr.write('sweep: FAIL-CLOSED — coverage is not honest; "no findings" would be meaningless:\n');
    for (const p of problems) stderr.write(`  - ${p}\n`);
    return 2;
  }

  // ---------------------------------------------------------------- report
  const clip = (s) => (s.length > SPAN_PRINT_CAP ? s.slice(0, SPAN_PRINT_CAP) + "…" : s);
  const lines = [];
  lines.push(`# Sweep report`);
  lines.push(``);
  lines.push(`- question: ${cfg.question}`);
  lines.push(`- seat: ${banner.model} · effort ${banner.effort} · read-only · workdir verified (banner-confirmed) · bound via ${seatSource}`);
  lines.push(`- tokens: ${banner.tokens ?? "NOT read"}`);
  lines.push(`- files listed: ${cfg.files.length} · model-attested scanned: ${readable.length} · wrapper-pre-marked unreadable: ${unreadable.length}`);
  if (parsed.proseLines) lines.push(`- note: the answer region carried ${parsed.proseLines} non-contract prose line(s), ignored`);
  lines.push(``);
  lines.push(`## Findings (${parsed.findings.length}) — model-reported candidates for a human; the sweep decides nothing`);
  for (const f of parsed.findings) lines.push(`- ${f.file}:${f.line} :: "${clip(f.span)}" :: ${clip(f.answer)}`);
  if (!parsed.findings.length) {
    lines.push(unreadable.length === 0
      ? `- none — all ${readable.length} listed files are model-attested scanned, with wrapper-verified completeness`
      : `- none among the ${readable.length} swept files (${unreadable.length} listed file(s) were unreadable to the wrapper and NOT swept)`);
  }
  lines.push(``);
  lines.push(`## Coverage — denominator wrapper-verified; per-file status is the MODEL'S attestation`);
  for (const f of readable) lines.push(`- ${f} :: ${parsed.coverage.get(f)}`);
  for (const u of unreadable) lines.push(`- ${u.file} :: unreadable(${u.reason}) [wrapper pre-marked, not swept]`);
  const report = lines.join("\n") + "\n";

  if (cfg.out) {
    try { fs.writeFileSync(cfg.out, report, { flag: "wx" }); } // wx: no-clobber at the syscall too
    catch (e) {
      stderr.write(`sweep: FAIL-CLOSED — could not write --out ${cfg.out} (${e.code || e.message}).\n`);
      return 2;
    }
  } else stdout.write(report);
  // Exit contract: 0 only when EVERY listed file was swept. Pre-marked unreadables are declared
  // in the report, but a PIPELINE reads only the exit code — returning 0 over a narrowed
  // denominator fails open when composed. 1 = swept-with-unreadables.
  return unreadable.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------- entry
// fileURLToPath + realpath — path.resolve does not follow symlinks and /tmp is one on macOS; a
// naive compare makes a sibling CLI a silent exit-0 no-op under a /tmp invocation. Guarding the
// entry under isMain is load-bearing: without it, a TEST that imports this module would RUN the
// sweep (kit lesson — an unguarded main() made an import adopt the importer's own checkout).
const entry = process.argv[1]
  ? (() => { try { return fs.realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })()
  : null;
if (entry && entry === fileURLToPath(import.meta.url)) {
  process.exitCode = run(parseArgs(process.argv.slice(2)));
}
