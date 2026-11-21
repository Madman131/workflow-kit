// v2.47.0 KIT-THREAD-HYGIENE (+R1): scripts/doctor-orphans.mjs reports by default, decides orphan by OWNER (the Claude session named in
// the broker's environment), and stops a broker only on a named, proven target. Every process here is spawned by this file; a fake
// broker is a node script named app-server-broker.mjs launched DETACHED + unref'd by a launcher that exits, so it has ppid 1 from
// birth like a real plugin broker. No test touches a process it did not start, and `finally` cleans them all up.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrokerArgv, parseEtime, parsePs, rp } from "../scripts/doctor-orphans.mjs";

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
  async function broker(name, cwd, { owner, transcript, mode = "codex" } = {}) {
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
  async function claude(id) {                                           // a fake Claude Desktop session process: `claude … --resume=<id>`
    const bin = path.join(root, `claude-${id.slice(0, 8)}`, "claude"); mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(bin, 0o755);
    const p = spawn(bin, ["--output-format", "stream-json", `--resume=${id}`], { stdio: "ignore" }); track(p.pid);
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

test("default is REPORT ONLY; ppid 1 is information: a broker whose owner is a LIVE session is not an orphan and gets no stop line", async () => {
  const s = sandbox();
  try {
    const owner = U(1), cl = await s.claude(owner);
    const b = await s.broker("a", s.root, { owner });
    const rep = s.report();
    const row = rep.brokers.find((x) => x.pid === b.pid);
    assert.ok(row, "listed");
    assert.equal(row.ppid, 1, "detached: ppid 1 from birth, as the real plugin spawns it");
    assert.equal(row.identityProven, true);
    assert.deepEqual([row.owner.sessionId, row.owner.state, row.owner.via], [owner, "alive", "process"]);
    assert.equal(row.orphan, false); assert.equal(row.stopCommand, null);
    assert.deepEqual(row.children.map((c) => c.pid), [b.kid]);
    assert.ok(row.treeRssMb > 0);
    assert.match(s.doctor(["--claude-dir", path.join(s.root, "dotclaude")]).stdout, /REPORT ONLY \(nothing is signalled\)/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid) && isAlive(cl.pid), "report-only killed nothing");
  } finally { s.cleanup(); }
});

test("owner GONE (process dead, transcript missing or stale) is an ORPHAN with the exact stop line; a fresh transcript keeps it alive", async () => {
  const s = sandbox();
  try {
    const owner = U(2), cl = await s.claude(owner);
    const b = await s.broker("a", s.root, { owner });
    process.kill(cl.pid, "SIGKILL"); await sleep(400);
    let row = s.report().brokers.find((x) => x.pid === b.pid);
    assert.deepEqual([row.owner.state, row.owner.sessionId, row.orphan], ["gone", owner, true]);
    assert.deepEqual(row.orphanReasons, ["its owner session is gone"]);
    assert.equal(row.stopCommand, `node ${DOCTOR.includes(" ") ? `'${DOCTOR}'` : DOCTOR} --stop --pid-file ${b.pidFile}`);
    // a stale transcript is still gone; a recent one means the session may still be there
    const tdir = path.join(s.root, "dotclaude", "projects", "-slug"); mkdirSync(tdir, { recursive: true });
    const tr = path.join(tdir, `${owner}.jsonl`); writeFileSync(tr, "{}\n");
    const old = new Date(Date.now() - 3 * 86400_000); utimesSync(tr, old, old);
    row = s.report().brokers.find((x) => x.pid === b.pid);
    assert.equal(row.owner.state, "gone"); assert.equal(row.owner.transcript, tr);
    utimesSync(tr, new Date(), new Date());
    row = s.report().brokers.find((x) => x.pid === b.pid);
    assert.deepEqual([row.owner.state, row.owner.via, row.orphan, row.stopCommand], ["alive", "transcript", false, null]);
    assert.ok(isAlive(b.pid) && isAlive(b.kid), "still nothing signalled");
  } finally { s.cleanup(); }
});

test("owner UNKNOWN (no variable): orphan only when its --cwd is gone or it is older than --broker-hours", async () => {
  const s = sandbox();
  try {
    const cwd = path.join(s.root, "will-go"); mkdirSync(cwd);
    const gone = await s.broker("a", cwd), young = await s.broker("b", s.root);
    rmSync(cwd, { recursive: true });
    let rep = s.report();
    const g = rep.brokers.find((x) => x.pid === gone.pid), y = rep.brokers.find((x) => x.pid === young.pid);
    assert.deepEqual([g.owner.state, g.orphan, g.orphanReasons], ["unknown", true, ["owner unknown and --cwd is gone"]]);
    assert.ok(g.stopCommand);
    assert.deepEqual([y.owner.state, y.orphan, y.stopCommand], ["unknown", false, null]);
    await sleep(1300);
    rep = s.report(["--broker-hours", "0.0001"]);
    assert.equal(rep.brokers.find((x) => x.pid === young.pid).orphan, true);
    assert.match(rep.brokers.find((x) => x.pid === young.pid).orphanReasons[0], /owner unknown and older than 0.0001 h/);
  } finally { s.cleanup(); }
});

test("--stop --pid-file stops the broker AND its direct `codex app-server` child", async () => {
  const s = sandbox();
  try {
    const b = await s.broker("a", s.root);
    const r = s.doctor(["--stop", "--pid-file", b.pidFile, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const res = JSON.parse(r.stdout).results[0];
    assert.equal(res.stopped, true);
    assert.deepEqual(res.children, [{ pid: b.kid, how: "SIGTERM" }]);
    assert.equal(isAlive(b.pid), false); assert.equal(isAlive(b.kid), false);
  } finally { s.cleanup(); }
});

test("a child that is not a DIRECT `codex app-server` is never signalled (a non-codex child, and a codex grandchild)", async () => {
  const s = sandbox();
  try {
    const other = await s.broker("a", s.root, { mode: "other" });
    assert.equal(s.doctor(["--stop", "--pid-file", other.pidFile]).status, 0);
    assert.equal(isAlive(other.pid), false); assert.ok(isAlive(other.kid), "a direct child that is not codex survives");
    const grand = await s.broker("b", s.root, { mode: "grand" });
    assert.equal(s.doctor(["--stop", "--pid-file", grand.pidFile]).status, 0);
    assert.equal(isAlive(grand.pid), false); assert.ok(isAlive(grand.kid), "the non-codex wrapper survives"); assert.ok(isAlive(grand.grand), "a codex GRANDchild survives");
  } finally { s.cleanup(); }
});

test("a pid file whose pid is a DIFFERENT live process is REFUSED and that process survives", async () => {
  const s = sandbox();
  try {
    const sl = spawn("sleep", ["300"], { stdio: "ignore" }); s.track(sl.pid);
    const pf = path.join(s.root, "stale.pid"); writeFileSync(pf, String(sl.pid));
    const r = s.doctor(["--stop", "--pid-file", pf]);
    assert.equal(r.status, 1); assert.match(r.stdout, /REFUSED.*argv is not exactly/);
    assert.ok(isAlive(sl.pid));
    const b = await s.broker("a", s.root);
    const other = path.join(s.root, "other.pid"); writeFileSync(other, String(b.pid));
    const r2 = s.doctor(["--stop", "--pid-file", other]);
    assert.equal(r2.status, 1); assert.match(r2.stdout, /different pid file/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
    assert.equal(s.doctor(["--stop", "--pid-file", path.join(s.root, "nope.pid")]).status, 1);
    writeFileSync(pf, "999999"); assert.match(s.doctor(["--stop", "--pid-file", pf]).stdout, /REFUSED.*no such process/);
  } finally { s.cleanup(); }
});

test("--reap --cwd A stops only the broker whose --cwd is exactly A (never A-suffix, A/child or B)", async () => {
  const s = sandbox();
  try {
    const A = path.join(s.root, "A"), AS = path.join(s.root, "A-suffix"), AC = path.join(s.root, "A", "child"), B = path.join(s.root, "B");
    for (const d of [A, AS, AC, B]) mkdirSync(d, { recursive: true });
    const ba = await s.broker("a", A), bs = await s.broker("b", AS), bc = await s.broker("c", AC), bb = await s.broker("d", B);
    const r = s.doctor(["--reap", "--cwd", A, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).results.map((x) => x.pid), [ba.pid]);
    assert.equal(isAlive(ba.pid), false); assert.equal(isAlive(ba.kid), false);
    for (const x of [bs, bc, bb]) assert.ok(isAlive(x.pid) && isAlive(x.kid), "left alone");
    const none = s.doctor(["--reap", "--cwd", path.join(s.root, "nowhere")]);
    assert.equal(none.status, 0); assert.match(none.stdout, /nothing stopped/);
  } finally { s.cleanup(); }
});

test("--reap --cwd REFUSES a broker whose owner is another LIVE session, and stops it when the owner is `self`", async () => {
  const s = sandbox();
  try {
    const mine = U(3), theirs = U(4);
    await s.claude(mine); await s.claude(theirs);
    const A = path.join(s.root, "A"), B = path.join(s.root, "B"); mkdirSync(A); mkdirSync(B);
    const foreign = await s.broker("a", A, { owner: theirs }), own = await s.broker("b", B, { owner: mine });
    let r = s.doctor(["--reap", "--cwd", A], { CODEX_COMPANION_SESSION_ID: mine });
    assert.equal(r.status, 1); assert.match(r.stdout, /REFUSED.*another live session's broker/);
    assert.ok(isAlive(foreign.pid) && isAlive(foreign.kid));
    r = s.doctor(["--reap", "--cwd", B], { CODEX_COMPANION_SESSION_ID: mine });
    assert.equal(r.status, 0, r.stdout); assert.equal(isAlive(own.pid), false); assert.equal(isAlive(own.kid), false);
    // with no CODEX_COMPANION_SESSION_ID at all, a live owner is still not mine
    assert.equal(s.doctor(["--reap", "--cwd", A]).status, 1); assert.ok(isAlive(foreign.pid));
  } finally { s.cleanup(); }
});

test("--reap --owner self stops only the brokers whose environment names this session, wherever their --cwd is", async () => {
  const s = sandbox();
  try {
    const mine = U(5), theirs = U(6);
    await s.claude(mine); await s.claude(theirs);
    const m1 = await s.broker("a", s.root, { owner: mine }), m2 = await s.broker("b", path.join(s.root, "a"), { owner: mine.toUpperCase() });
    const t1 = await s.broker("c", s.root, { owner: theirs }), none = await s.broker("d", s.root);
    let r = s.doctor(["--reap", "--owner", "self", "--json"], { CODEX_COMPANION_SESSION_ID: mine });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).results.map((x) => x.pid).sort(), [m1.pid, m2.pid].sort());
    for (const x of [m1, m2]) { assert.equal(isAlive(x.pid), false); assert.equal(isAlive(x.kid), false); }
    for (const x of [t1, none]) assert.ok(isAlive(x.pid) && isAlive(x.kid), "another owner's, and an ownerless, broker is untouched");
    // `self` with the variable unset or malformed is a usage error and signals nothing
    assert.equal(s.doctor(["--reap", "--owner", "self"]).status, 2);
    assert.equal(s.doctor(["--reap", "--owner", "self"], { CODEX_COMPANION_SESSION_ID: "not-a-uuid" }).status, 2);
    assert.equal(s.doctor(["--reap", "--owner", "nope"]).status, 2);
    // an explicit uuid works the same way (the Architect stopping an archived PM's seats)
    assert.equal(s.doctor(["--reap", "--owner", theirs]).status, 0); assert.equal(isAlive(t1.pid), false); assert.ok(isAlive(none.pid));
  } finally { s.cleanup(); }
});

test("--reap matches by realpath: a symlinked --cwd, a symlinked argument, and a deleted dir under /var vs /private/var", async () => {
  const s = sandbox();
  try {
    const real = path.join(s.root, "real"), link = path.join(s.root, "link"), real2 = path.join(s.root, "real2"), link2 = path.join(s.root, "link2");
    mkdirSync(real); mkdirSync(real2); symlinkSync(real, link); symlinkSync(real2, link2);
    const viaLink = await s.broker("a", link), viaReal = await s.broker("b", real2);
    assert.equal(s.doctor(["--reap", "--cwd", real]).status, 0);
    assert.equal(isAlive(viaLink.pid), false); assert.equal(isAlive(viaLink.kid), false); assert.ok(isAlive(viaReal.pid));
    assert.equal(s.doctor(["--reap", "--cwd", link2]).status, 0);
    assert.equal(isAlive(viaReal.pid), false);
    // a directory that no longer exists: the same path spelled through the symlinked and the canonical ancestor is one path
    const gone = path.join(s.root, "deleted-dir"); mkdirSync(gone);
    const b = await s.broker("c", gone); rmSync(gone, { recursive: true });
    const canonical = path.join(realpathSync(s.root), "deleted-dir");
    assert.equal(rp(gone), rp(canonical));
    assert.equal(s.doctor(["--reap", "--cwd", canonical]).status, 0); assert.equal(isAlive(b.pid), false);
  } finally { s.cleanup(); }
});

test("--reap refuses a broker whose identity is not proven (pid file gone, or holding another pid) and leaves it running", async () => {
  const s = sandbox();
  try {
    const A = path.join(s.root, "A"); mkdirSync(A);
    const b = await s.broker("a", A);
    rmSync(b.pidFile);
    const r = s.doctor(["--reap", "--cwd", A]);
    assert.equal(r.status, 1); assert.match(r.stdout, /REFUSED.*pid file named in argv does not exist/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
    writeFileSync(b.pidFile, "1");
    assert.match(s.doctor(["--reap", "--cwd", A]).stdout, /REFUSED.*holds 1, not/);
    assert.equal(s.doctor(["--reap", "--owner", U(9)]).status, 0, "an unproven process is never matched by owner");
    assert.ok(isAlive(b.pid));
  } finally { s.cleanup(); }
});

test("a process that only MENTIONS a broker script is not a broker (a node -e one-liner, with and without its own pid file)", async () => {
  const s = sandbox();
  try {
    const A = path.join(s.root, "A"); mkdirSync(A);
    const pf = path.join(s.root, "mimic.pid");
    const mimic = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)", "app-server-broker.mjs", "serve", "--endpoint", "e", "--cwd", A, "--pid-file", pf], { stdio: "ignore" }); s.track(mimic.pid);
    writeFileSync(pf, String(mimic.pid));
    await sleep(200);
    assert.equal(s.doctor(["--reap", "--cwd", A]).stdout.includes("STOPPED"), false);
    assert.equal(s.doctor(["--stop", "--pid-file", pf]).status, 1);
    assert.ok(isAlive(mimic.pid));
  } finally { s.cleanup(); }
});

test("a Claude process is never signalled, even when its argv is broker-shaped and its own pid file names it", async () => {
  const s = sandbox();
  try {
    const odd = path.join(s.root, `x claude --resume=${U(7)}`); mkdirSync(odd);          // a --cwd directory whose NAME reads like a Claude argv
    const b = await s.broker("a", odd);
    const row = s.report().brokers.find((x) => x.pid === b.pid);
    assert.equal(row, undefined, "a Claude-shaped command is not even listed as a broker");
    const r = s.doctor(["--stop", "--pid-file", b.pidFile]);
    assert.equal(r.status, 1); assert.match(r.stdout, /REFUSED.*Claude process/);
    assert.equal(s.doctor(["--reap", "--cwd", odd]).stdout.includes("STOPPED"), false);
    assert.equal(s.doctor(["--reap", "--owner", U(7)]).stdout.includes("STOPPED"), false);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
  } finally { s.cleanup(); }
});

test("Claude session processes are reported once each (the desktop `disclaimer --pgroup` wrapper row is dropped) and never signalled", async () => {
  const s = sandbox();
  try {
    const id = U(8), cd = path.join(s.root, "dotclaude", "projects", "-slug"); mkdirSync(cd, { recursive: true });
    const tr = path.join(cd, `${id}.jsonl`); writeFileSync(tr, "{}\n"); const old = new Date(Date.now() - 3 * 86400_000); utimesSync(tr, old, old);
    const cl = await s.claude(id);
    const wrapper = path.join(s.root, "disclaimer"); writeFileSync(wrapper, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(wrapper, 0o755);
    const w = spawn(wrapper, ["--pgroup", path.join(s.root, "claude"), "--output-format", "stream-json", `--resume=${id}`], { stdio: "ignore" }); s.track(w.pid);
    await sleep(300);
    const rep = s.report();
    const rows = rep.claudeSessions.filter((x) => x.sessionId === id);
    assert.equal(rows.length, 1); assert.equal(rows[0].pid, cl.pid);
    assert.deepEqual([rows[0].transcript, rows[0].idle], [tr, true]);
    assert.equal(s.report(["--idle-hours", "100"]).claudeSessions.find((x) => x.sessionId === id).idle, false);
    s.doctor(["--reap", "--cwd", s.root]); s.doctor(["--reap", "--owner", id]);
    assert.ok(isAlive(cl.pid) && isAlive(w.pid), "no Claude process or wrapper was signalled");
  } finally { s.cleanup(); }
});

test("a process table that cannot be read: --stop and --reap exit 1 and signal nothing; a report says so and exits 0", async () => {
  const s = sandbox();
  try {
    const b = await s.broker("a", s.root);
    const env = { WORKFLOW_KIT_DOCTOR_PS: "/nonexistent/ps" };
    let r = s.doctor(["--stop", "--pid-file", b.pidFile], env); assert.equal(r.status, 1); assert.match(r.stdout, /cannot read the process table/);
    r = s.doctor(["--reap", "--cwd", s.root], env); assert.equal(r.status, 1);
    r = s.doctor(["--reap", "--owner", U(1)], env); assert.equal(r.status, 1);
    r = s.doctor([], env); assert.equal(r.status, 0); assert.match(r.stdout, /cannot read the process table/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
  } finally { s.cleanup(); }
});

test("bad arguments exit 2 and signal nothing (usage, empty paths, zero or negative hours)", async () => {
  const s = sandbox();
  try {
    const b = await s.broker("a", s.root);
    for (const args of [["--stop"], ["--reap"], ["--stop", "--reap", "--pid-file", b.pidFile], ["--pid-file", b.pidFile], ["--bogus"], ["--broker-hours", "x"], ["--broker-hours", "0"], ["--broker-hours", "-1"], ["--idle-hours", "-5"], ["--idle-hours", "0"],
      ["--reap", "--cwd", ""], ["--stop", "--pid-file", ""], ["--cwd", s.root], ["--owner", U(1)]]) {
      assert.equal(s.doctor(args).status, 2, args.join(" "));
    }
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
  } finally { s.cleanup(); }
});
