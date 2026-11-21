// v2.47.0 KIT-THREAD-HYGIENE: scripts/doctor-orphans.mjs reports by default, stops only on --stop/--reap, and proves a
// process is a broker before it signals it. Every process here is spawned by this file (a fake broker is a node
// script named app-server-broker.mjs); no test touches a process it did not start, and `finally` cleans them all up.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argvFlag, parseEtime, parsePs } from "../scripts/doctor-orphans.mjs";

const DOCTOR = fileURLToPath(new URL("../scripts/doctor-orphans.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAlive = (pid) => { try { process.kill(pid, 0); } catch { return false; } return !/^Z/.test(spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" }).stdout.trim()) && spawnSync("ps", ["-p", String(pid), "-o", "pid="], { encoding: "utf8" }).stdout.trim() !== ""; };

const FAKE_BROKER = `
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
const a = process.argv.slice(2);
if (a[0] !== "serve") process.exit(3);
const pidFile = a[a.indexOf("--pid-file") + 1];
writeFileSync(pidFile, String(process.pid));
// a child whose command reads \`codex app-server\`, which this broker deliberately does NOT take down with it
const kid = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)", "codex", "app-server"], { stdio: "ignore" });
writeFileSync(pidFile + ".child", String(kid.pid));
const shutdown = () => { try { unlinkSync(pidFile); } catch {} process.exit(0); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
setInterval(() => {}, 1e6);
`;

function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), "doctor-orphans-"));
  const pids = new Set();
  const track = (p) => { if (p) pids.add(p); return p; };
  const cleanup = () => {
    for (const p of pids) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
    rmSync(root, { recursive: true, force: true });
  };
  const script = path.join(root, "app-server-broker.mjs");
  writeFileSync(script, FAKE_BROKER);
  async function broker(name, cwd) {
    const dir = path.join(root, name); mkdirSync(dir, { recursive: true });
    const pidFile = path.join(dir, "broker.pid");
    const p = spawn(process.execPath, [script, "serve", "--endpoint", `unix:${dir}/broker.sock`, "--cwd", cwd, "--pid-file", pidFile], { stdio: "ignore" });
    track(p.pid);
    for (let i = 0; i < 100 && !existsSync(pidFile + ".child"); i++) await sleep(50);
    assert.ok(existsSync(pidFile + ".child"), "the fake broker came up");
    const kid = track(Number(readFileSync(pidFile + ".child", "utf8")));
    return { pid: p.pid, kid, pidFile, dir };
  }
  const doctor = (args) => spawnSync(process.execPath, [DOCTOR, ...args], { encoding: "utf8" });
  return { root, track, cleanup, broker, doctor };
}

test("parsers: etime forms, ps rows, and a --cwd with spaces survives argvFlag", () => {
  assert.equal(parseEtime("05:09"), 309);
  assert.equal(parseEtime("01:02:03"), 3723);
  assert.equal(parseEtime("2-01:00:00"), 2 * 86400 + 3600);
  assert.equal(parseEtime("garbage"), null);
  const rows = parsePs("  12   1 S    02:00   2048 node /x/app-server-broker.mjs serve --cwd /a b/c --pid-file /t/p\n  13  12 Ss  01:00   1024 codex app-server\n");
  assert.deepEqual(rows.map((r) => [r.pid, r.ppid, r.stat, r.age, r.rssKb]), [[12, 1, "S", 120, 2048], [13, 12, "Ss", 60, 1024]]);
  assert.equal(argvFlag(rows[0].command, "--cwd"), "/a b/c");
  assert.equal(argvFlag(rows[0].command, "--pid-file"), "/t/p");
});

test("default is REPORT ONLY: a fake broker and its child are listed with the exact stop command and are NOT killed", async () => {
  const s = sandbox();
  try {
    const cwd = path.join(s.root, "gone"); mkdirSync(cwd);
    const b = await s.broker("a", cwd);
    rmSync(cwd, { recursive: true });                           // the --cwd no longer exists ⇒ an orphan by rule
    const r = s.doctor(["--json"]);
    assert.equal(r.status, 0);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.mode, "report-only");
    const row = rep.brokers.find((x) => x.pid === b.pid);
    assert.ok(row, "listed");
    assert.equal(row.identityProven, true);
    assert.equal(row.cwdExists, false);
    assert.equal(row.orphan, true);
    assert.match(row.orphanReasons.join(), /--cwd is gone/);
    assert.equal(row.pidFile, b.pidFile);
    assert.deepEqual(row.children.map((c) => c.pid), [b.kid]);
    assert.ok(row.treeRssMb > 0);
    assert.equal(row.stopCommand, `node ${DOCTOR.includes(" ") ? `'${DOCTOR}'` : DOCTOR} --stop --pid-file ${b.pidFile}`);
    assert.ok(isAlive(b.pid) && isAlive(b.kid), "report-only killed nothing");
    const text = s.doctor([]).stdout;
    assert.match(text, /REPORT ONLY \(nothing is signalled\)/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
    // a healthy broker (cwd exists, young, parent alive) is listed but gets no stop command
    const live = await s.broker("b", s.root);
    const row2 = JSON.parse(s.doctor(["--json"]).stdout).brokers.find((x) => x.pid === live.pid);
    assert.equal(row2.orphan, false);
    assert.equal(row2.stopCommand, null);
  } finally { s.cleanup(); }
});

test("--stop --pid-file stops the broker AND its codex app-server child", async () => {
  const s = sandbox();
  try {
    const b = await s.broker("a", s.root);
    const r = s.doctor(["--stop", "--pid-file", b.pidFile, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const res = JSON.parse(r.stdout).results[0];
    assert.equal(res.stopped, true);
    assert.deepEqual(res.children, [{ pid: b.kid, how: "SIGTERM" }]);
    assert.equal(isAlive(b.pid), false);
    assert.equal(isAlive(b.kid), false);
  } finally { s.cleanup(); }
});

test("a pid file whose pid is a DIFFERENT live process is REFUSED and that process survives", async () => {
  const s = sandbox();
  try {
    const sl = spawn("sleep", ["300"], { stdio: "ignore" }); s.track(sl.pid);
    const pf = path.join(s.root, "stale.pid"); writeFileSync(pf, String(sl.pid));
    const r = s.doctor(["--stop", "--pid-file", pf]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /REFUSED.*argv is not/);
    assert.ok(isAlive(sl.pid), "the unrelated process was not signalled");
    // a pid file holding a REAL broker's pid, but not the file that broker's argv names, is also refused
    const b = await s.broker("a", s.root);
    const other = path.join(s.root, "other.pid"); writeFileSync(other, String(b.pid));
    const r2 = s.doctor(["--stop", "--pid-file", other]);
    assert.equal(r2.status, 1);
    assert.match(r2.stdout, /different pid file/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
    // a missing pid file and a dead pid are refused, not errors
    assert.equal(s.doctor(["--stop", "--pid-file", path.join(s.root, "nope.pid")]).status, 1);
    writeFileSync(pf, "999999"); assert.match(s.doctor(["--stop", "--pid-file", pf]).stdout, /REFUSED.*no such process/);
  } finally { s.cleanup(); }
});

test("--reap --cwd A stops only the broker whose --cwd is exactly A (never A-suffix, never B)", async () => {
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
    // nothing matches ⇒ nothing stopped, exit 0
    const none = s.doctor(["--reap", "--cwd", path.join(s.root, "nowhere")]);
    assert.equal(none.status, 0); assert.match(none.stdout, /nothing stopped/);
  } finally { s.cleanup(); }
});

test("--reap matches by realpath in both directions (a symlinked --cwd, a symlinked argument)", async () => {
  const s = sandbox();
  try {
    const real = path.join(s.root, "real"), link = path.join(s.root, "link"), real2 = path.join(s.root, "real2"), link2 = path.join(s.root, "link2");
    mkdirSync(real); mkdirSync(real2); symlinkSync(real, link); symlinkSync(real2, link2);
    const viaLink = await s.broker("a", link);      // broker started with the symlink path, reaped by the real path
    const viaReal = await s.broker("b", real2);     // broker started with the real path, reaped by the symlink
    assert.equal(s.doctor(["--reap", "--cwd", real]).status, 0);
    assert.equal(isAlive(viaLink.pid), false); assert.equal(isAlive(viaLink.kid), false);
    assert.ok(isAlive(viaReal.pid));
    assert.equal(s.doctor(["--reap", "--cwd", link2]).status, 0);
    assert.equal(isAlive(viaReal.pid), false); assert.equal(isAlive(viaReal.kid), false);
  } finally { s.cleanup(); }
});

test("--reap refuses a broker whose identity is not proven (its pid file is gone) and leaves it running", async () => {
  const s = sandbox();
  try {
    const A = path.join(s.root, "A"); mkdirSync(A);
    const b = await s.broker("a", A);
    rmSync(b.pidFile);
    const r = s.doctor(["--reap", "--cwd", A]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /REFUSED.*pid file named in argv does not exist/);
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
    writeFileSync(b.pidFile, "1");                                     // exists but holds another pid
    assert.match(s.doctor(["--reap", "--cwd", A]).stdout, /REFUSED.*holds 1, not/);
    assert.ok(isAlive(b.pid));
  } finally { s.cleanup(); }
});

test("a process whose argv only MENTIONS a broker script is not a broker (a node -e one-liner whose arguments imitate it)", async () => {
  const s = sandbox();
  try {
    const A = path.join(s.root, "A"); mkdirSync(A);
    const pf = path.join(s.root, "mimic.pid");
    const mimic = spawn(process.execPath, ["-e", "setInterval(()=>{},1e6)", "app-server-broker.mjs", "serve", "--cwd", A, "--pid-file", pf], { stdio: "ignore" }); s.track(mimic.pid);
    writeFileSync(pf, String(mimic.pid));
    assert.equal(s.doctor(["--reap", "--cwd", A]).stdout.includes("STOPPED"), false);
    assert.equal(s.doctor(["--stop", "--pid-file", pf]).status, 1);
    assert.ok(isAlive(mimic.pid));
  } finally { s.cleanup(); }
});

test("Claude session processes are reported with transcript and idleness, and never signalled", async () => {
  const s = sandbox();
  try {
    const id = "0b9d3c52-1f4e-4a7b-9c11-2d5e8a6f7b30";
    const bin = path.join(s.root, "claude");
    writeFileSync(bin, "#!/usr/bin/env node\nsetInterval(()=>{},1e6)\n"); chmodSync(bin, 0o755);
    const cd = path.join(s.root, "dotclaude", "projects", "-some-slug"); mkdirSync(cd, { recursive: true });
    const tr = path.join(cd, `${id}.jsonl`); writeFileSync(tr, "{}\n");
    const old = new Date(Date.now() - 3 * 86400_000); utimesSync(tr, old, old);
    const p = spawn(bin, ["--output-format", "stream-json", `--resume=${id}`], { stdio: "ignore" }); s.track(p.pid);
    await sleep(300);
    const rep = JSON.parse(s.doctor(["--json", "--claude-dir", path.join(s.root, "dotclaude")]).stdout);
    const row = rep.claudeSessions.find((x) => x.pid === p.pid);
    assert.ok(row, "listed");
    assert.equal(row.sessionId, id);
    assert.equal(row.transcript, tr);
    assert.equal(row.idle, true);
    assert.equal(JSON.parse(s.doctor(["--json", "--idle-hours", "100", "--claude-dir", path.join(s.root, "dotclaude")]).stdout).claudeSessions.find((x) => x.pid === p.pid).idle, false);
    assert.ok(isAlive(p.pid), "the Claude process was not signalled");
    // --reap and --stop never take a Claude process either
    s.doctor(["--reap", "--cwd", s.root]); assert.ok(isAlive(p.pid));
  } finally { s.cleanup(); }
});

test("bad arguments exit 2 and signal nothing", async () => {
  const s = sandbox();
  try {
    const b = await s.broker("a", s.root);
    for (const args of [["--stop"], ["--reap"], ["--stop", "--reap", "--pid-file", b.pidFile], ["--pid-file", b.pidFile], ["--bogus"], ["--broker-hours", "x"]]) {
      assert.equal(s.doctor(args).status, 2, args.join(" "));
    }
    assert.ok(isAlive(b.pid) && isAlive(b.kid));
  } finally { s.cleanup(); }
});
