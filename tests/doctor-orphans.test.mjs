// v2.47.0 KIT-THREAD-HYGIENE (+R1): scripts/doctor-orphans.mjs is REPORT-ONLY (D-290): it lists brokers and Claude processes, flags likely leftovers by OWNER,
// prints the Owner-decides sentence, and never signals anything. Every process here is spawned by this file; a fake
// broker is a node script named app-server-broker.mjs launched DETACHED + unref'd by a launcher that exits, so it has ppid 1 from
// birth like a real plugin broker. No test touches a process it did not start, and `finally` cleans them all up.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTICE, parseBrokerArgv, parseEtime, parsePs } from "../scripts/doctor-orphans.mjs";

const DOCTOR = fileURLToPath(new URL("../scripts/doctor-orphans.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = (n) => `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;   // a session uuid
const psStat = (pid) => spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" }).stdout.trim();
const isAlive = (pid) => { const s = psStat(pid); return s !== "" && !s.startsWith("Z"); };
const baseEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith("CODEX_COMPANION_")) delete e[k]; return e; };

const FAKE_BROKER = `
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
const a = process.argv.slice(2);
if (a[0] !== "serve") process.exit(3);
const pidFile = a[a.indexOf("--pid-file") + 1], dir = path.dirname(pidFile);
writeFileSync(pidFile, String(process.pid));
const mode = process.env.FAKE_MODE || "codex";
let kid;
if (mode === "codex") kid = spawn(process.execPath, ["app-server"], { cwd: dir, argv0: "codex", stdio: "ignore" });            // a DIRECT child whose command reads \`codex app-server\`
else if (mode === "other") kid = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)", "not-codex"], { stdio: "ignore" });  // a direct child that is not codex
else kid = spawn(process.execPath, [path.join(dir, "wrap.mjs")], { cwd: dir, stdio: "ignore" });                                // a direct non-codex wrapper with a codex GRANDchild
writeFileSync(pidFile + ".child", String(kid.pid));
const shutdown = () => { try { unlinkSync(pidFile); } catch {} process.exit(0); };      // like the real broker: leaves its child running
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
setInterval(() => {}, 1e6);
`;
const LAUNCHER = `
const { spawn } = require("node:child_process");
const [script, ...rest] = process.argv.slice(1);
const p = spawn(process.execPath, [script, ...rest], { detached: true, stdio: "ignore", env: process.env });
p.unref();
`;
const WRAP = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["app-server"], { argv0: "codex", stdio: "ignore" });
writeFileSync("grand.pid", String(g.pid));
setInterval(() => {}, 1e6);
`;

function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), "doctor-orphans-"));
  const pids = new Set();
  const track = (p) => { if (Number.isInteger(p) && p > 1) pids.add(p); return p; };
  const cleanup = () => { for (const p of pids) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } } rmSync(root, { recursive: true, force: true }); };
  const script = path.join(root, "app-server-broker.mjs");
  writeFileSync(script, FAKE_BROKER);
  let gone = 800;
  // `owner` omitted = a GONE owner (a uuid no process or transcript backs); `owner: null` = UNKNOWN (no variable in its environment)
  async function broker(name, cwd, { owner = U(gone++), transcript, mode = "codex" } = {}) {
    const dir = path.join(root, name); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "app-server"), "setInterval(()=>{},1e6)\n"); writeFileSync(path.join(dir, "wrap.mjs"), WRAP);
    const pidFile = path.join(dir, "broker.pid");
    const env = { ...baseEnv(), FAKE_MODE: mode, ...(owner ? { CODEX_COMPANION_SESSION_ID: owner } : {}), ...(transcript ? { CODEX_COMPANION_TRANSCRIPT_PATH: transcript } : {}) };
    const l = spawnSync(process.execPath, ["-e", LAUNCHER, script, "serve", "--endpoint", `unix:${dir}/broker.sock`, "--cwd", cwd, "--pid-file", pidFile], { env, encoding: "utf8" });
    assert.equal(l.status, 0, l.stderr);
    const num = (f) => (existsSync(f) && /^\d+$/.test(readFileSync(f, "utf8")) ? Number(readFileSync(f, "utf8")) : null);
    for (let i = 0; i < 200 && !(num(pidFile) && num(pidFile + ".child") && (mode !== "grand" || num(path.join(dir, "grand.pid")))); i++) await sleep(50);
    const pid = track(num(pidFile)), kid = track(num(pidFile + ".child")), grand = mode === "grand" ? track(num(path.join(dir, "grand.pid"))) : null;
    assert.ok(pid && kid, "the fake broker came up");
    return { pid, kid, grand, pidFile, dir };
  }
  async function claude(id, cwd) {                                           // a fake Claude Desktop session process: `claude … --resume=<id>`
    const bin = path.join(root, `claude-${id.slice(0, 8)}`, "claude"); mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(bin, 0o755);
    const p = spawn(bin, ["--output-format", "stream-json", `--resume=${id}`], { stdio: "ignore", ...(cwd ? { cwd } : {}) }); track(p.pid);
    await sleep(300);
    return p;
  }
  const doctor = (args, env = {}) => spawnSync(process.execPath, [DOCTOR, ...args], { encoding: "utf8", env: { ...baseEnv(), ...env } });
  const report = (args = [], env) => JSON.parse(doctor(["--json", "--claude-dir", path.join(root, "dotclaude"), ...args], env).stdout);
  return { root, track, cleanup, broker, claude, doctor, report };
}

test("parsers: etime forms, ps rows, the plugin's exact broker argv (and what it refuses)", () => {
  assert.equal(parseEtime("05:09"), 309); assert.equal(parseEtime("01:02:03"), 3723); assert.equal(parseEtime("2-01:00:00"), 2 * 86400 + 3600); assert.equal(parseEtime("garbage"), null);
  const rows = parsePs("  12   1 S    02:00   2048 node /x/app-server-broker.mjs serve --endpoint unix:/t/s --cwd /a b/c --pid-file /t/p\n  13  12 Ss  01:00   1024 codex app-server\n");
  assert.deepEqual(rows.map((r) => [r.pid, r.ppid, r.stat, r.age, r.rssKb]), [[12, 1, "S", 120, 2048], [13, 12, "Ss", 60, 1024]]);
  assert.deepEqual(parseBrokerArgv(rows[0].command), { endpoint: "unix:/t/s", cwd: "/a b/c", pidFile: "/t/p" });
  const ok = "/opt/node/bin/node /h/.claude/plugins/x/scripts/app-server-broker.mjs serve --endpoint unix:/t/s --cwd /w --pid-file /t/p";
  assert.deepEqual(parseBrokerArgv(ok), { endpoint: "unix:/t/s", cwd: "/w", pidFile: "/t/p" });
  for (const bad of [ok.replace("node /h", "node --inspect /h"), "env X=1 " + ok, ok + " extra", ok.replace("--cwd /w", "--cwd=/w"), ok.replace("--pid-file /t/p", "--pid-file=/t/p"),
    ok.replace("--cwd /w", "--cwd /w --cwd /v"), ok.replace("--pid-file /t/p", "--pid-file /t/p --pid-file /t/q"), ok.replace("node ", "nodemon "), "node -e x app-server-broker.mjs serve --endpoint e --cwd /w --pid-file /t/p"]) {
    assert.equal(parseBrokerArgv(bad), null, bad);
  }
});

test("the doctor can never stop anything: its source has no signal call and no stop mode (D-290)", () => {
  const src = readFileSync(DOCTOR, "utf8");
  assert.doesNotMatch(src, /process\.kill|\bkill\s*\(|\bpkill\b|killall|SIGTERM|SIGKILL|SIGINT/, "no signal call, no kill command, no signal name");
  assert.doesNotMatch(src, /WORKFLOW_KIT_DOCTOR_PS/, "no override of ps");
  assert.doesNotMatch(src, /stopBroker|reapBrokers|function stop/, "no stop function");
  // every child_process call in the file runs ps or lsof and nothing else
  const calls = [...src.matchAll(/spawnSync\(\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual([...new Set(calls)].sort(), ['"lsof"', "PS"]);
  assert.equal(JSON.stringify(NOTICE), '"Stopping a process is the Owner\'s call; this tool never does it."');
});

test("a report lists a detached fake broker with its owner, prints the Owner-decides sentence in text and JSON, and leaves every process running", async () => {
  const s = sandbox();
  try {
    const owner = U(1), cl = await s.claude(owner);
    const b = await s.broker("a", s.root, { owner });
    const rep = s.report();
    assert.equal(rep.notice, NOTICE); assert.equal(rep.mode, "report-only");
    const row = rep.brokers.find((x) => x.pid === b.pid);
    assert.ok(row, "listed");
    assert.equal(row.ppid, 1, "detached: ppid 1 from birth, as the real plugin spawns it");
    assert.equal(row.identityShapeOk, true); assert.equal(row.pidFile, b.pidFile); assert.equal(row.cwd, s.root); assert.equal(row.cwdExists, true);
    assert.deepEqual([row.owner.sessionId, row.owner.state, row.owner.via], [owner, "alive", "process"]);
    assert.equal(row.likelyLeftover, false); assert.ok(row.treeRssMb > 0);
    assert.equal(JSON.stringify(row).includes("stopCommand"), false, "no stop command in the data");
    const text = s.doctor(["--claude-dir", path.join(s.root, "dotclaude")]);
    assert.equal(text.status, 0);
    assert.ok(text.stdout.includes(NOTICE), "the sentence is in the text output");
    assert.match(text.stdout, /REPORT ONLY/); assert.doesNotMatch(text.stdout, /\bstop: |--stop|--reap/, "no stop line or command anywhere in the output");
    assert.match(text.stdout, new RegExp(`owner ${owner} LOOKS ALIVE via process`));
    assert.ok(isAlive(b.pid) && isAlive(b.kid) && isAlive(cl.pid), "report-only killed nothing");
  } finally { s.cleanup(); }
});

test("likely leftover = identity shape OK and owner GONE and older than --broker-hours; an alive, young or unknown-owner broker is not flagged", async () => {
  const s = sandbox();
  try {
    const live = U(2), cl = await s.claude(live);
    const tdir = path.join(s.root, "dotclaude", "projects", "-slug"); mkdirSync(tdir, { recursive: true });
    const stale = U(3), fresh = U(4);
    for (const [id, old] of [[stale, true], [fresh, false]]) { const f = path.join(tdir, `${id}.jsonl`); writeFileSync(f, "{}\n"); if (old) { const d = new Date(Date.now() - 3 * 86400_000); utimesSync(f, d, d); } }
    const goneOld = await s.broker("a", s.root, { owner: U(5) }), staleOwner = await s.broker("b", s.root, { owner: stale }), freshOwner = await s.broker("c", s.root, { owner: fresh });
    const aliveOwner = await s.broker("d", s.root, { owner: live }), unknown = await s.broker("e", s.root, { owner: null });
    await sleep(1300);
    const by = (rep, b) => rep.brokers.find((x) => x.pid === b.pid);
    let rep = s.report(["--broker-hours", "0.0001"]);
    assert.equal(by(rep, goneOld).likelyLeftover, true, "owner gone (no process, no transcript) and old");
    assert.equal(by(rep, staleOwner).likelyLeftover, true, "a stale transcript is still gone");
    assert.equal(by(rep, freshOwner).likelyLeftover, false); assert.equal(by(rep, freshOwner).owner.via, "transcript");
    assert.equal(by(rep, aliveOwner).likelyLeftover, false);
    assert.equal(by(rep, unknown).owner.state, "unknown"); assert.equal(by(rep, unknown).likelyLeftover, false, "an unknown owner is never called a leftover");
    assert.match(s.doctor(["--broker-hours", "0.0001", "--claude-dir", path.join(s.root, "dotclaude")]).stdout, /Likely leftover brokers \(owner gone, older than 0\.0001 h\): \d+.*Whether to stop them is the Owner's decision\./);
    rep = s.report();                                                   // the default 24 h: nothing is that old
    assert.ok(rep.brokers.every((x) => x.likelyLeftover === false));
    for (const b of [goneOld, staleOwner, freshOwner, aliveOwner, unknown]) assert.ok(isAlive(b.pid) && isAlive(b.kid), "still running");
    assert.ok(isAlive(cl.pid));
  } finally { s.cleanup(); }
});

test("the shared-root hint: a live Claude process whose cwd is inside the broker's --cwd", async () => {
  const lsof = spawnSync("lsof", ["-v"], { encoding: "utf8" });
  const s = sandbox();
  try {
    const root = path.join(s.root, "shared"), inner = path.join(root, "work"), other = path.join(s.root, "elsewhere");
    for (const d of [inner, other]) mkdirSync(d, { recursive: true });
    const b1 = await s.broker("a", root), b2 = await s.broker("b", other);
    await s.claude(U(6), inner);
    const rep = s.report();
    const h1 = rep.brokers.find((x) => x.pid === b1.pid).sharedRoot, h2 = rep.brokers.find((x) => x.pid === b2.pid).sharedRoot;
    if (lsof.error) { assert.deepEqual([h1, h2], ["unknown", "unknown"]); return; }
    assert.deepEqual([h1, h2], ["yes", "no"]);
  } finally { s.cleanup(); }
});

test("a broker-shaped but unproven process is listed with its reason (no pid file, a node -e mimic is not listed), and a Claude-shaped command is not a broker", async () => {
  const s = sandbox();
  try {
    const A = path.join(s.root, "A"); mkdirSync(A);
    const b = await s.broker("a", A);
    rmSync(b.pidFile);
    const mimic = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)", "app-server-broker.mjs", "serve", "--endpoint", "e", "--cwd", A, "--pid-file", path.join(s.root, "m.pid")], { stdio: "ignore" }); s.track(mimic.pid);
    const odd = path.join(s.root, `x claude --resume=${U(7)}`); mkdirSync(odd);
    const c = await s.broker("c", odd);
    await sleep(200);
    const rep = s.report();
    const row = rep.brokers.find((x) => x.pid === b.pid);
    assert.equal(row.identityShapeOk, false); assert.match(row.identityReason, /pid file named in argv does not exist/); assert.equal(row.likelyLeftover, false);
    const m = rep.brokers.find((x) => x.pid === mimic.pid);
    assert.equal(m.identityShapeOk, false); assert.match(m.identityReason, /argv is not exactly/);
    assert.equal(rep.brokers.find((x) => x.pid === c.pid), undefined, "a Claude-shaped command is not listed as a broker");
    for (const x of [b, c]) assert.ok(isAlive(x.pid) && isAlive(x.kid)); assert.ok(isAlive(mimic.pid));
  } finally { s.cleanup(); }
});

test("Claude session processes are reported once each (the desktop `disclaimer --pgroup` wrapper row is dropped), with transcript and idleness", async () => {
  const s = sandbox();
  try {
    const id = U(8), cd = path.join(s.root, "dotclaude", "projects", "-slug"); mkdirSync(cd, { recursive: true });
    const tr = path.join(cd, `${id}.jsonl`); writeFileSync(tr, "{}\n"); const old = new Date(Date.now() - 3 * 86400_000); utimesSync(tr, old, old);
    const cl = await s.claude(id);
    const wrapper = path.join(s.root, "disclaimer"); writeFileSync(wrapper, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(wrapper, 0o755);
    const w = spawn(wrapper, ["--pgroup", path.join(s.root, "claude"), "--output-format", "stream-json", `--resume=${id}`], { stdio: "ignore" }); s.track(w.pid);
    await sleep(300);
    const rows = s.report().claudeSessions.filter((x) => x.sessionId === id);
    assert.equal(rows.length, 1); assert.equal(rows[0].pid, cl.pid);
    assert.deepEqual([rows[0].transcript, rows[0].idle], [tr, true]);
    assert.equal(s.report(["--idle-hours", "100"]).claudeSessions.find((x) => x.sessionId === id).idle, false);
    assert.ok(isAlive(cl.pid) && isAlive(w.pid));
  } finally { s.cleanup(); }
});

test("a stop-shaped flag is a usage error (exit 2, 'this tool never stops a process') and every bad argument signals nothing", async () => {
  const s = sandbox();
  try {
    const b = await s.broker("a", s.root);
    for (const flag of ["--stop", "--reap", "--kill", "--terminate", "--signal", "--force", "--pid-file", "--owner", "--cwd", "--yes", "--sigkill"]) {
      const r = s.doctor([flag, b.pidFile]);
      assert.equal(r.status, 2, flag); assert.match(r.stderr, /this tool never stops a process/, flag);
    }
    for (const args of [["--bogus"], ["--broker-hours", "x"], ["--broker-hours", "0"], ["--broker-hours", "-1"], ["--idle-hours", "-5"], ["--idle-hours", "0"], ["--claude-dir"]]) assert.equal(s.doctor(args).status, 2, args.join(" "));
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
  } finally { s.cleanup(); }
});

// ---------- D-292: every live Claude process is listed, with its session from --resume, else the host-session env, else unknown ----------
async function bareClaude(s, name, envExtra) {                           // a fake desktop process: `claude --output-format stream-json`, NO --resume
  const bin = path.join(s.root, name, "claude"); mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(bin, 0o755);
  const p = spawn(bin, ["--output-format", "stream-json"], { stdio: "ignore", env: (() => { const e = { ...baseEnv(), ...envExtra }; if (!envExtra.CLAUDE_CODE_HOST_SESSION_ID) delete e.CLAUDE_CODE_HOST_SESSION_ID; return e; })() }); s.track(p.pid);   // the host shell may carry one
  await sleep(300);
  return p;
}

test("D-292 every live Claude process is listed: a --resume uuid, no --resume but CLAUDE_CODE_HOST_SESSION_ID, and neither", async () => {
  const s = sandbox();
  try {
    const id = U(20), host = "local_4a3359c0-aaaa-4aaa-8aaa-000000000001";
    const tdir = path.join(s.root, "dotclaude", "projects", "-slug"); mkdirSync(tdir, { recursive: true });
    const tr = path.join(tdir, `${id}.jsonl`); writeFileSync(tr, "{}\n");
    const withResume = await s.claude(id), withHost = await bareClaude(s, "h", { CLAUDE_CODE_HOST_SESSION_ID: host }), neither = await bareClaude(s, "n", {});
    const wrapper = path.join(s.root, "disclaimer"); writeFileSync(wrapper, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(wrapper, 0o755);
    const w = spawn(wrapper, ["--pgroup", path.join(s.root, "claude"), "--output-format", "stream-json"], { stdio: "ignore" }); s.track(w.pid);
    await sleep(300);
    const rep = s.report();
    const by = (p) => rep.claudeSessions.find((x) => x.pid === p.pid);
    assert.deepEqual([by(withResume).sessionId, by(withResume).sessionSource, by(withResume).transcript], [id, "resume", tr]);
    assert.equal(typeof by(withResume).idle, "boolean");
    const h = by(withHost);
    assert.deepEqual([h.sessionId, h.sessionSource, h.transcript, h.lastActivity, h.idle], [host, "env", "unknown", "unknown", "unknown"], "an env session id has no known transcript: never guessed");
    const n = by(neither);
    assert.deepEqual([n.sessionId, n.sessionSource, n.transcript, n.lastActivity, n.idle], ["unknown", "unknown", "unknown", "unknown", "unknown"]);
    assert.equal(by(w), undefined, "the disclaimer --pgroup wrapper row stays dropped");
    const text = s.doctor(["--claude-dir", path.join(s.root, "dotclaude")]).stdout;
    assert.match(text, new RegExp(`claude pid ${withHost.pid} \\d+ MB session ${host} \\(from CLAUDE_CODE_HOST_SESSION_ID\\) last activity unknown`));
    assert.match(text, new RegExp(`claude pid ${neither.pid} \\d+ MB session unknown last activity unknown`));
    assert.match(text, new RegExp(`claude pid ${withResume.pid} \\d+ MB session ${id}`));
    assert.ok([withResume, withHost, neither, w].every((x) => isAlive(x.pid)), "nothing was signalled");
  } finally { s.cleanup(); }
});
