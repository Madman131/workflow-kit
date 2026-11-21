// v2.47.0 KIT-THREAD-HYGIENE: the archive step and its two scripts, the Codex-seat doctrine, the Deploy-line sentences,
// the budgets and the version. The scripts' behaviour is pinned in tests/archive-plan.test.mjs and tests/doctor-orphans.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const flat = (p) => read(p).replace(/\s+/g, " ");
const words = (p) => read(p).split(/\s+/).filter(Boolean).length;
const note = () => { const r = flat("README.md"); return r.slice(r.indexOf("## What's new in v2.47.0"), r.indexOf("## What's new in v2.46.0")); };

test("(a) ARCHIVE.md carries the six steps, the standing-yes gate, the report-only cases, the limits, the owner reap and the Remote Control remedy", () => {
  const a = flat("skills/closeout/ARCHIVE.md");
  assert.match(read("skills/closeout/ARCHIVE.md"), /^Word budget: 650, whole file\./m);
  assert.ok(words("skills/closeout/ARCHIVE.md") <= 650);
  assert.match(a, /A PM archives each session it started once that session's work is landed, verified and has nothing left to do/);
  assert.match(a, /An Architect archives each PM it started once that PM's chip is closed out: landed, verified, digest written, no unpushed work, nothing waiting on the Owner/);
  assert.match(a, /Never the Architect thread, a session you did not start, unpushed work, or anything the Owner is waiting on/);
  assert.match(a, /Archive only when your instructions carry the Owner's standing yes for it; an adopter's Owner must grant it, and you never infer it\. Without it, do steps 2–4 and 6 as a REPORT and archive nothing/);
  assert.match(a, /`list_sessions \{"limit": 200\}` \(NOT `linked`, so sessions that share a worktree but are not yours are visible; a row with no `startedBy` is "not started by you"\), and `get_session self` for your id and cwd\. A host without session tools, and a Codex lane \(it has no archive tool\), REPORT/);
  assert.match(a, /node scripts\/archive-plan\.mjs --sessions <list\.json> --me <your id> --me-cwd <your cwd> --list-limit 200 --done <id>… --waiting <id>… --owner-yes --json/);
  assert.match(a, /an Architect asserts it for each PM AND each of that PM's finished side sessions, or the cascade keeps the PM/);
  assert.match(a, /A list of 200 entries may be cut short and plans nothing: re-list with a larger limit\. Report mode is the same command without `--owner-yes`; a missing script means REPORT, not archive/);
  assert.match(a, /\*\*Doctor\.\*\* Run `node scripts\/doctor-orphans\.mjs` and put its report in the receipt\. It stops nothing: it lists the Codex plugin brokers and Claude processes still resident and flags likely leftovers \(owner gone, older than 24 h\)\. Surface that list to the Owner under the divider as an item for the Owner to decide, with no command to run\. Run it again after the archive\. A missing doctor means say "brokers not checked"\. Never `kill` or `pkill` anything yourself/);
  assert.doesNotMatch(a, /--reap|--stop|stop line|run exactly those lines/, "no stop instruction survives");
  assert.match(a, /The host asks for explicit agreement per session; the Owner's standing yes is that agreement for the sessions the plan lists/);
  assert.match(a, /If it refuses because a Remote Control client is attached \(the plan flags `needsRemoteControlOff`\), turning Remote Control off for that session is part of the archive ONLY where the Owner's standing yes says so; then retry once\. Otherwise KEEP the session and report "needs Remote Control off"\. A refusal for live work keeps it/);
  assert.match(a, /every archived session \(name and id\), every kept one \(name, id, why\), the doctor's report with its likely leftovers, and any Remote Control action/);
});

test("(a) /closeout § 7 points at ARCHIVE.md, reconciles 'Ready to archive?' and stays inside its budget", () => {
  const c = flat("skills/closeout/SKILL.md");
  assert.ok(words("skills/closeout/SKILL.md") <= 600);
  assert.match(c, /"Ready to archive\?" inspects and reports; archiving acts only under § 7\./);
  assert.doesNotMatch(c, /"Ready to archive\?" is receipt-only/);
  assert.match(c, /## 7\. Archive step After the receipt, run `\.agents\/skills\/closeout\/ARCHIVE\.md`: archive the finished sessions you started and put the doctor's report in the receipt; leftovers go to the Owner\. `ARCHIVE-READY` is receipt-only until the Owner's standing yes exists\./);
  assert.match(flat("core/OPERATE.md"), /Where the Owner has granted a standing yes, the lifecycle ends with the archive step \(`skills\/closeout\/ARCHIVE\.md`: finished sessions you started, the process report to the Owner\); without it `ARCHIVE-READY` stays a receipt\./);
});

test("(b) GATES states the Codex-seat doctrine; REVIEW, BINDINGS and the seat template point at it; REVIEW did not grow", () => {
  const g = flat("core/GATES.md");
  assert.match(g, /### Codex seats and brokers A Codex gate seat runs ONLY through `scripts\/codex-gate\.sh`/);
  assert.match(g, /its SessionEnd hook tears down only the broker keyed to the SESSION's cwd, so a seat run with `--cwd <packet dir>` is never found/);
  assert.match(g, /A Codex gate seat runs ONLY through `scripts\/codex-gate\.sh` \(`codex exec`\); the Claude `openai-codex` plugin is \*\*never\*\* used for a gate seat/);
  assert.match(g, /always `detached` \(so \*\*every broker has ppid 1 from birth\*\*\)/);
  assert.match(g, /\*\*The kit stops nothing\.\*\* `node scripts\/doctor-orphans\.mjs` is report-only/);
  assert.match(g, /It prints no stop command and has no stop flag\. Stopping a process is the Owner's call/);
  assert.doesNotMatch(g.slice(g.indexOf("### Codex seats and brokers"), g.indexOf("### How to run")), /--reap|--stop|stops its own broker/, "no stop doctrine survives in the section");
  assert.match(g, /- \[Codex gate\]\(#codex-gate\) — what it does · Codex seats and brokers · how to run/);
  assert.match(flat("core/REVIEW.md"), /A Codex seat runs ONLY through `scripts\/codex-gate\.sh`, never the Claude `openai-codex` plugin \(`core\/GATES\.md` § Codex seats and brokers\)\./);
  assert.match(flat("templates/BINDINGS.md.tmpl"), /A gate seat NEVER uses the Claude `openai-codex` plugin \(`core\/GATES\.md` § Codex seats and brokers\)\./);
  assert.match(read("templates/codex-cold-reviewer.toml.tmpl"), /never the Claude `openai-codex` plugin, whose\n# broker outlives the thread \(core\/GATES\.md § Codex seats and brokers\)\./);
  assert.match(flat("core/REVIEW.md"), /the changed code files\*\* \(each under a per-file cap\) — \*\*but those are assembly limits, not an ingestion budget:/);
  const reviewBytes = statSync(new URL("../core/REVIEW.md", import.meta.url)).size;
  assert.ok(reviewBytes <= 25597, `REVIEW net <= 0 against v2.46.0 (25,597 B); is ${reviewBytes}`);
  assert.ok(reviewBytes <= 25600, "REVIEW is inside the 25,600 B method cap");
});

test("(c)(d) the doctor is report-only and the plan script archives nothing, in their own headers and code", () => {
  const d = read("scripts/doctor-orphans.mjs").replace(/\n\/\/ ?/g, " "), a = read("scripts/archive-plan.mjs").replace(/\n\/\/ ?/g, " ");
  assert.match(d, /THIS TOOL NEVER STOPS A PROCESS, with no exception and no flag/);
  assert.match(d, /export const NOTICE = "Stopping a process is the Owner's call; this tool never does it\.";/);
  assert.doesNotMatch(d, /process\.kill|\bkill\s*\(|SIGTERM|SIGKILL/);
  assert.match(a, /A PURE DECISION SCRIPT/);
  assert.match(a, /GUARD 9\./);
  assert.doesNotMatch(a, /\b(unlink|rmSync|writeFileSync|kill)\b/, "the plan script has no write or signal call");
});

test("(d) the push-effect sentences follow the BINDINGS Deploy line, and every 'auto-deploy' in the kit is conditional", () => {
  assert.match(flat("core/MULTI_AGENT.md"), /6\. \*\*Pushing the deploy branch has the effect the BINDINGS Deploy line names — in some repos, an auto-deploy to the live service\.\*\* EVERY remote push or publication needs a fresh Owner GO/);
  assert.doesNotMatch(flat("core/MULTI_AGENT.md"), /Pushing the deploy branch auto-deploys/);
  assert.match(flat("core/OPERATE.md"), /a push ships \*everyone's\* unpushed commits \(and has the effect the BINDINGS Deploy line names, in some repos an auto-deploy\)/);
  assert.doesNotMatch(flat("core/OPERATE.md"), /unpushed commits \(and auto-deploys\)/);
  assert.match(flat("core/REVIEW.md"), /runs \*after\* the deploy; guard or flag-gate it|runs after the deploy; guard or flag-gate it/);
  // WORKFLOW's two mentions say "where the target auto-deploys" and "the live / auto-deploy target": conditional on the target
  assert.match(flat("core/WORKFLOW.md"), /where the target auto-deploys/);
});

test("PORTABILITY states the two scripts' platform scope and the lane facts", () => {
  const p = flat("PORTABILITY.md");
  assert.match(p, /## The archive step's two scripts \(v2\.47\.0\) — platform scope and lane facts/);
  assert.match(p, /\*\*Neither stops or archives anything\.\*\* The doctor is report-only with no stop mode/);
  assert.match(p, /reads the process table with `\/bin\/ps`, a broker's environment with `ps -wwE` \(macOS\) or `\/proc\/<pid>\/environ` \(Linux\), and a shared-root hint with `lsof -a -d cwd`/);
  assert.match(p, /The environment is readable only for processes your user owns\. It was measured on macOS; Linux was not exercised\./);
  assert.match(p, /The Codex lane has no archive tool, and a Claude host without session tools has none either: both REPORT what they would archive/);
  assert.match(p, /The host archives, and only under the Owner's standing yes/);
});

test("(e) the README note says what changed, the measured leak, the residuals and what adopters copy", () => {
  const n = note();
  assert.ok(n.length > 1500, "the v2.47.0 note sits above v2.46.0's");
  assert.match(n, /its SessionEnd hook tears down only the broker keyed to the SESSION's cwd/);
  assert.match(n, /\*\*`scripts\/doctor-orphans\.mjs` is REPORT-ONLY, with no exceptions \(D-290\)\.\*\*/);
  assert.match(n, /\*\*Stopping a process is the Owner's call; this tool never does it\.\*\*/);
  assert.match(n, /It has no stop or reap mode, prints no stop command, makes no signal call and never touches `pkill`; a stop-shaped flag is a usage error \(exit 2\)/);
  assert.match(n, /three review rounds each found a new hole in a heuristic for "whose live process may the kit kill"/i);
  assert.match(n, /The root cause was never the missing killer; it is plugin gate seats, which are now forbidden\. The Owner stops a leftover by hand from the report/);
  assert.match(n, /`list_sessions \{"limit": 200\}` \(not `linked`/);
  assert.match(n, /`architect\(\?!ur\)`, so `architect_kit` and `architects` are kept and "architecture docs" is archivable/);
  assert.match(n, /\(`--me-cwd`, which must be an existing directory\)/);
  assert.match(n, /Archive mode needs `--owner-yes`, `--me-cwd` and `--list-limit`; without them it is report-only/);
  assert.match(n, /turning Remote Control off for that session is part of the archive only where the Owner's standing yes says so/);
  assert.match(n, /Ignored files are not checked; a branch squash-merged and then pruned reads as unpushed and stays kept/);
  assert.match(n, /a broker whose pid file the plugin deleted fails the shape check/);
  assert.doesNotMatch(n, /--reap|--stop/, "the note offers no stop command");
  assert.match(n, /Nine guards each keep a session/);
  assert.match(n, /It acts only when your instructions carry the Owner's standing yes/);
  assert.match(n, /The only `bin\/init\.mjs` change is that it now installs the two new scripts\./);
  assert.match(n, /`init --force` now installs the two scripts; an existing adopter can also byte-copy them\./);
  assert.match(n, /\*\*The push-effect sentences follow your Deploy line \(D-264, D-279\)\.\*\*/);
  assert.match(n, /\*\*Adopters\.\*\* Byte-copy `scripts\/doctor-orphans\.mjs`, `scripts\/archive-plan\.mjs`, `skills\/closeout\/SKILL\.md`, `skills\/closeout\/ARCHIVE\.md`, `core\/MULTI_AGENT\.md` and `core\/GATES\.md`/);
});

test("version is 2.47.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.47.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.47.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.47\.0$/m);
});

const KIT = fileURLToPath(new URL("..", import.meta.url));
const BASE = "3e4958fe8ee28558adcb0b118c6365f923465729";   // v2.46.0

test("no registration and no budgeted template changed: settings.json, codex/, hooks/ and the two stub templates are byte-identical to v2.46.0, and init changes ONLY by the two script copies and their log line", () => {
  let names, initDiff;
  try {
    names = execFileSync("git", ["-C", KIT, "diff", "--name-only", BASE, "--", "templates/settings.json", "codex", "templates/CLAUDE.md.tmpl", "templates/AGENTS.md.tmpl", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    initDiff = execFileSync("git", ["-C", KIT, "diff", "-U0", BASE, "--", ["bin", "init" + ".mjs"].join("/")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch { return; }   // no v2.46.0 object here (a tarball, a shallow clone, or a later release has moved the base): nothing to compare
  assert.equal(names.trim(), "", "no Stop registration moved, and the 8,192 B stubs did not grow");
  const lines = initDiff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  const removed = lines.filter((l) => l[0] === "-"), added = lines.filter((l) => l[0] === "+");
  assert.equal(removed.length, 1, "only the scripts/: log line is rewritten");
  assert.match(removed[0], /scripts\/: check-doc-size\.mjs/);
  assert.equal(added.length, 4, "a comment, two copyGuarded lines and the log line");
  assert.ok(added.some((l) => /copyGuarded\(path\.join\(KIT_ROOT, "scripts", "doctor-orphans\.mjs"\), path\.join\(T, "scripts", "doctor-orphans\.mjs"\), force\);/.test(l)));
  assert.ok(added.some((l) => /copyGuarded\(path\.join\(KIT_ROOT, "scripts", "archive-plan\.mjs"\), path\.join\(T, "scripts", "archive-plan\.mjs"\), force\);/.test(l)));
  assert.ok(added.some((l) => /doctor-orphans\.mjs \(report-only unless given an explicit --stop\/--reap\) \+ archive-plan\.mjs \(archives nothing\)/.test(l)));
});

test("a fresh init installs both scripts and ARCHIVE.md, and every script ARCHIVE.md cites resolves and runs in that adopter", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-v2470-adopter-")), prompts = mkdtempSync(path.join(os.tmpdir(), "kit-v2470-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const hermetic = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
    const r = spawnSync(process.execPath, [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", prompts], { encoding: "utf8", env: { ...process.env, PATH: hermetic } });
    assert.equal(r.status, 0, r.stderr);
    for (const f of ["scripts/doctor-orphans.mjs", "scripts/archive-plan.mjs", ".agents/skills/closeout/ARCHIVE.md", ".agents/skills/closeout/SKILL.md"]) assert.ok(existsSync(path.join(dir, f)), `${f} installed`);
    assert.equal(readFileSync(path.join(dir, "scripts/archive-plan.mjs"), "utf8"), read("scripts/archive-plan.mjs"), "byte-identical copy");
    assert.equal(readFileSync(path.join(dir, "scripts/doctor-orphans.mjs"), "utf8"), read("scripts/doctor-orphans.mjs"), "byte-identical copy");
    const cited = [...new Set([...readFileSync(path.join(dir, ".agents/skills/closeout/ARCHIVE.md"), "utf8").matchAll(/\b(?:scripts|core|skills)\/[\w./-]+\.(?:mjs|md)\b/g)].map((m) => m[0]))];
    assert.ok(cited.includes("scripts/archive-plan.mjs") && cited.includes("scripts/doctor-orphans.mjs"));
    for (const c of cited) assert.ok([dir, path.join(dir, ".agents")].some((root) => existsSync(path.join(root, c))), `ARCHIVE.md cites ${c}; it must exist in the adopter`);
    // the installed copies run: an empty list plans nothing, and a bad flag is a usage error, not a crash
    const plan = spawnSync(process.execPath, [path.join(dir, "scripts/archive-plan.mjs"), "--me", "x", "--json"], { input: "[]", encoding: "utf8" });
    assert.equal(plan.status, 0); assert.deepEqual(JSON.parse(plan.stdout).archive, []);
    assert.equal(spawnSync(process.execPath, [path.join(dir, "scripts/doctor-orphans.mjs"), "--bogus"], { encoding: "utf8" }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(prompts, { recursive: true, force: true }); }
});
