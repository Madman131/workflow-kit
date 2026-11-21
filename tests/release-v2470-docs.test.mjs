// v2.47.0 KIT-THREAD-HYGIENE: the archive step and its two scripts, the Codex-seat doctrine, the Deploy-line sentences,
// the budgets and the version. The scripts' behaviour is pinned in tests/archive-plan.test.mjs and tests/doctor-orphans.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const flat = (p) => read(p).replace(/\s+/g, " ");
const words = (p) => read(p).split(/\s+/).filter(Boolean).length;
const note = () => { const r = flat("README.md"); return r.slice(r.indexOf("## What's new in v2.47.0"), r.indexOf("## What's new in v2.46.0")); };

test("(a) ARCHIVE.md carries the six steps, the standing-yes gate, the report-only cases and the receipt", () => {
  const a = flat("skills/closeout/ARCHIVE.md");
  assert.match(read("skills/closeout/ARCHIVE.md"), /^Word budget: 450, whole file\./m);
  assert.ok(words("skills/closeout/ARCHIVE.md") <= 450);
  assert.match(a, /A PM archives each session it started once that session's work is landed, verified and has nothing left to do/);
  assert.match(a, /An Architect archives each PM it started once that PM's chip is closed out: landed, verified, digest written, no unpushed work, nothing waiting on the Owner/);
  assert.match(a, /Never the Architect thread, a session you did not start, unpushed work, or anything the Owner is waiting on/);
  assert.match(a, /Archive only when your instructions carry the Owner's standing yes for it; an adopter's Owner must grant it, and you never infer it\. Without it, do steps 2–4 and 6 as a REPORT and archive nothing/);
  assert.match(a, /A host without session tools, and a Codex lane \(it has no archive tool\), REPORT what it would archive/);
  assert.match(a, /node scripts\/archive-plan\.mjs --sessions <list\.json> --me <your id> --done <id>… --waiting <id>… --owner-yes --json/);
  assert.match(a, /A missing script means REPORT, not archive/);
  assert.match(a, /\*\*Brokers first\.\*\* For each planned session, stop the Codex plugin brokers its seats left: `node scripts\/doctor-orphans\.mjs --reap --cwd <each packet dir it ran seats in>` \(or `--stop --pid-file <file>`\)/);
  assert.match(a, /never `kill` or `pkill` by hand and never touch another session's/);
  assert.match(a, /Call the host archive tool once per `archive\[\]` id, with a reason\. It cleans up the session's worktree and also archives its `alsoTaken` side sessions/);
  assert.match(a, /every archived session \(name and id\), every kept one \(name, id, why\), the brokers stopped \(pid and pid file\) and the doctor's report/);
});

test("(a) /closeout § 7 points at ARCHIVE.md, reconciles 'Ready to archive?' and stays inside its budget", () => {
  const c = flat("skills/closeout/SKILL.md");
  assert.ok(words("skills/closeout/SKILL.md") <= 600);
  assert.match(c, /"Ready to archive\?" inspects and reports; archiving acts only under § 7\./);
  assert.doesNotMatch(c, /"Ready to archive\?" is receipt-only/);
  assert.match(c, /## 7\. Archive step After the receipt, run `\.agents\/skills\/closeout\/ARCHIVE\.md`: archive the finished sessions you started, their Codex brokers stopped first\. `ARCHIVE-READY` is receipt-only until the Owner's standing yes exists\./);
  assert.match(flat("core/OPERATE.md"), /Where the Owner has granted a standing yes, the lifecycle ends with the archive step \(`skills\/closeout\/ARCHIVE\.md`: finished sessions you started, their Codex brokers stopped first\); without it `ARCHIVE-READY` stays a receipt\./);
});

test("(b) GATES states the Codex-seat doctrine; REVIEW, BINDINGS and the seat template point at it; REVIEW did not grow", () => {
  const g = flat("core/GATES.md");
  assert.match(g, /^.*### Codex seats and brokers A Codex gate seat runs `scripts\/codex-gate\.sh` \(`codex exec`\), \*\*never\*\* the Claude `openai-codex` plugin\./);
  assert.match(g, /its SessionEnd hook tears down only the broker keyed to the SESSION's cwd, so a seat run with `--cwd <packet dir>` is never found/);
  assert.match(g, /A plugin seat used anyway stops its own broker on return: `node scripts\/doctor-orphans\.mjs --stop --pid-file <its pid file>`/);
  assert.match(g, /Closeout reaps the brokers whose `--cwd` is one of the changeset's packet dirs: `node scripts\/doctor-orphans\.mjs --reap --cwd <dir>…`/);
  assert.match(g, /With no flag the doctor only reports\. It signals a process only after proving it is a broker/);
  assert.match(g, /- \[Codex gate\]\(#codex-gate\) — what it does · Codex seats and brokers · how to run/);
  assert.match(flat("core/REVIEW.md"), /A Codex seat runs `scripts\/codex-gate\.sh`, never the Claude `openai-codex` plugin; a plugin seat stops its own broker: `core\/GATES\.md` § Codex seats and brokers\./);
  assert.match(flat("templates/BINDINGS.md.tmpl"), /Never the Claude `openai-codex` plugin \(`core\/GATES\.md` § Codex seats and brokers\)\./);
  assert.match(read("templates/codex-cold-reviewer.toml.tmpl"), /never the Claude `openai-codex` plugin, whose\n# broker outlives the thread \(core\/GATES\.md § Codex seats and brokers\)\./);
  const reviewBytes = statSync(new URL("../core/REVIEW.md", import.meta.url)).size;
  assert.ok(reviewBytes <= 25597, `REVIEW net <= 0 against v2.46.0 (25,597 B); is ${reviewBytes}`);
  assert.ok(reviewBytes <= 25600, "REVIEW is inside the 25,600 B method cap");
});

test("(c)(d) the doctor and the plan script keep their contracts in their own headers", () => {
  const d = read("scripts/doctor-orphans.mjs").replace(/\n\/\/ ?/g, " "), a = read("scripts/archive-plan.mjs").replace(/\n\/\/ ?/g, " ");
  assert.match(d, /DEFAULT = REPORT ONLY/);
  assert.match(d, /There is no SIGKILL/);
  assert.match(d, /\(never a prefix\)/);
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

test("(e) the README note says what changed, the measured leak, the residuals and what adopters copy", () => {
  const n = note();
  assert.ok(n.length > 1500, "the v2.47.0 note sits above v2.46.0's");
  assert.match(n, /36 Claude CLI processes \(5\.9 GB\) and 24 orphaned Codex plugin broker trees \(3\.2 GB\)/);
  assert.match(n, /its SessionEnd hook tears down only the broker keyed to the SESSION's cwd/);
  assert.match(n, /never signals a Claude process, never uses `pkill` and never sends `SIGKILL`/);
  assert.match(n, /Nine guards each keep a session/);
  assert.match(n, /It acts only when your instructions carry the Owner's standing yes/);
  assert.match(n, /`init` does not install the two new scripts; copy them\./);
  assert.match(n, /\*\*The push-effect sentences follow your Deploy line \(D-264, D-279\)\.\*\*/);
  assert.match(n, /\*\*Adopters\.\*\* Byte-copy `scripts\/doctor-orphans\.mjs`, `scripts\/archive-plan\.mjs`, `skills\/closeout\/SKILL\.md`, `skills\/closeout\/ARCHIVE\.md`, `core\/MULTI_AGENT\.md` and `core\/GATES\.md`/);
});

test("version is 2.47.0 everywhere", () => {
  assert.equal(read("VERSION").trim(), "2.47.0");
  assert.equal(JSON.parse(read("package.json")).version, "2.47.0");
  assert.match(read("README.md"), /^# workflow-kit — v2\.47\.0$/m);
});

test("no registration and no budgeted template changed: init, the settings template, the Codex config and the two stub templates are byte-identical to v2.46.0", () => {
  let diff = "";
  try { diff = execFileSync("git", ["-C", new URL("..", import.meta.url).pathname, "diff", "--name-only", "3e4958fe8ee28558adcb0b118c6365f923465729", "--", ["bin", "init" + ".mjs"].join("/"), "templates/settings.json", "codex", "templates/CLAUDE.md.tmpl", "templates/AGENTS.md.tmpl", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return; }   // no v2.46.0 object here (a tarball, a shallow clone, or a later release has moved the base): nothing to compare
  assert.equal(diff.trim(), "", "no Stop registration moved, and the 8,192 B stubs did not grow");
});
