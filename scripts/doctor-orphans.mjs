#!/usr/bin/env node
// workflow-kit — scripts/doctor-orphans.mjs. Report the Codex plugin brokers and Claude session processes
// on this host, and stop a broker ONLY when told to, by name, with its identity AND its owner checked first.
//
//   node scripts/doctor-orphans.mjs [--json] [--broker-hours N] [--idle-hours N] [--claude-dir <dir>]
//   node scripts/doctor-orphans.mjs --stop --pid-file <file>          stop the ONE broker that file names
//   node scripts/doctor-orphans.mjs --reap --owner <uuid|self>        stop every proven broker owned by that Claude session
//   node scripts/doctor-orphans.mjs --reap --cwd <dir> [<dir>…]       stop every proven broker whose --cwd IS one of these dirs
//
// DEFAULT = REPORT ONLY. No flag but --stop or --reap ever signals anything, and nothing here ever signals a Claude process,
// runs `pkill`, or matches a process by name alone. A signal goes to a process only when ALL of these hold at the moment before
// it is sent: (1) its argv is EXACTLY the plugin's shape — `<node> <…/app-server-broker.mjs> serve --endpoint <e> --cwd <dir>
// --pid-file <f>` — with no node flag, no extra token, no repeated flag and no `=` form; (2) the --pid-file it names exists and
// holds exactly that pid; (3) for --stop, that file is the one the caller named (realpath); for --reap --cwd its --cwd realpath
// equals a named dir EXACTLY (never a prefix) and its owner is not another LIVE session; for --reap --owner its environment
// names that owner; (4) its command is not a Claude process. After the broker exits, each DIRECT child recorded BEFORE the
// signal whose command is `codex app-server …` and which is still alive gets one SIGTERM. There is no SIGKILL: a process that
// survives SIGTERM is reported, not escalated.
//
// OWNER. The plugin exports CODEX_COMPANION_SESSION_ID (the owning Claude session's uuid) and CODEX_COMPANION_TRANSCRIPT_PATH
// into every broker's environment (read with `ps -wwE` on macOS, /proc/<pid>/environ on Linux). The owner is ALIVE when a live
// Claude process has `--resume=<owner>` OR its transcript was written within --idle-hours; GONE when the owner is known, no such
// process exists and the transcript is missing or older; UNKNOWN when the environment is unreadable or lacks the variable.
// A broker is an ORPHAN, and gets a stop line, only when its identity is proven AND (its owner is GONE, or its owner is UNKNOWN
// and its --cwd is gone or it is older than --broker-hours). ppid 1 is information only: the plugin spawns every broker
// detached, so EVERY broker has ppid 1 from birth.
//
// WHY THIS EXISTS (measured 2026-11-21). The Claude `openai-codex` plugin starts one broker per cwd and its SessionEnd hook tears
// down only the broker keyed to the SESSION's cwd; a seat run with `--cwd <packet dir>` is never found, so finished threads left
// 24 broker trees (3.2 GB) behind. SIGTERM/SIGINT run the broker's own shutdown() (closes the client, unlinks socket and pid
// file) and exit 0.
//
// A process table is read with `/bin/ps -A -ww -o pid=,ppid=,stat=,etime=,rss=,command=` (macOS and Linux; the PATH ps only if
// /bin/ps is absent; WORKFLOW_KIT_DOCTOR_PS overrides it, for tests). Any other platform reports that and exits 0.
// RESIDUALS: the proof and the signal are two steps, so a pid reused between them is possible in principle; the proof is re-run
// immediately before the signal, which shrinks the window to microseconds. An orphan whose pid file the plugin already deleted
// cannot be proven and is reported, never stopped. A --pid-file path containing a space is unprovable (a --cwd may contain
// spaces, but a directory named like ` --pid-file ` is not supported). The environment is readable only for processes you own.
//
// Exit: 0 on a report; for --stop/--reap 0 when every target was stopped or nothing matched, 1 when a stop was refused, a process
// survived, or the process table could not be read; 2 on bad arguments.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const PS = process.env.WORKFLOW_KIT_DOCTOR_PS || (existsSync("/bin/ps") ? "/bin/ps" : "ps");
const BROKER_ARGV = /^(?:\S*\/)?node(?:js)? (?:\S*\/)?app-server-broker\.mjs serve --endpoint (\S+) --cwd ((?:(?! --(?:cwd|pid-file|endpoint) ).)+) --pid-file (\S+)$/;
const BROKER_LOOSE = /app-server-broker\.mjs\s+serve(?:\s|$)/;
const CHILD_ARGV = /^(?:\S*\/)?codex app-server(?: |$)/;
const CLAUDE_RE = /(?:^|[\/\s])claude(?:\.exe)?\s+--/;
const WRAPPER_RE = /(?:^|[\/\s])disclaimer\s+--pgroup(?:\s|$)/;
const RESUME_RE = /--resume[= ]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- process table ----------
export function parseEtime(s) {                    // [[dd-]hh:]mm:ss -> seconds
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s ?? "");
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

export function parsePs(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], stat: m[3], age: parseEtime(m[4]), rssKb: +m[5], command: m[6] });
  }
  return rows;
}

function readTable() {
  if (process.platform !== "darwin" && process.platform !== "linux") return { unsupported: process.platform };
  const r = spawnSync(PS, ["-A", "-ww", "-o", "pid=,ppid=,stat=,etime=,rss=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { error: String(r.error?.message ?? r.stderr ?? "ps failed").trim() };
  return { rows: parsePs(r.stdout) };
}

const alive = (row) => !!row && !row.stat.startsWith("Z");
// Canonicalize the nearest existing ancestor and keep the remainder, so a deleted directory under /tmp compares equal to the
// same path under /private/tmp.
export function rp(p) {
  const abs = path.resolve(p), rest = [];
  for (let cur = abs; ;) {
    try { return path.join(realpathSync(cur), ...rest); } catch { /* climb */ }
    const par = path.dirname(cur);
    if (par === cur) return abs;
    rest.unshift(path.basename(cur)); cur = par;
  }
}

// The plugin's exact broker argv, or null. cwd may contain spaces; nothing else may.
export function parseBrokerArgv(command) {
  const m = BROKER_ARGV.exec(command);
  return m ? { endpoint: m[1], cwd: m[2], pidFile: m[3] } : null;
}

export function readPidFile(file) {
  try { const m = /^\s*(\d+)\s*$/.exec(readFileSync(file, "utf8")); return m ? +m[1] : null; } catch { return null; }
}

const isClaude = (command) => CLAUDE_RE.test(command) || WRAPPER_RE.test(command);

// Identity proof for one broker row. Returns { proven, reason, argv }.
export function proveBroker(row) {
  if (!alive(row)) return { proven: false, reason: "process is not running" };
  if (isClaude(row.command)) return { proven: false, reason: "the command is a Claude process (never signalled)" };
  const a = parseBrokerArgv(row.command);
  if (!a) return { proven: false, reason: "argv is not exactly `node …/app-server-broker.mjs serve --endpoint … --cwd … --pid-file …`" };
  if (!path.isAbsolute(a.pidFile)) return { proven: false, reason: "argv --pid-file is not an absolute path" };
  if (!existsSync(a.pidFile)) return { proven: false, reason: "the pid file named in argv does not exist" };
  const held = readPidFile(a.pidFile);
  if (held !== row.pid) return { proven: false, reason: `the pid file holds ${held ?? "no pid"}, not ${row.pid}` };
  return { proven: true, reason: "argv is the plugin's shape; the pid file exists, holds this pid and is named in argv", argv: a };
}

const directChildren = (rows, pid) => rows.filter((r) => r.ppid === pid);
function descendants(rows, pid) {
  const out = [], seen = new Set([pid]);
  let frontier = [pid];
  while (frontier.length) {
    const next = [];
    for (const r of rows) if (!seen.has(r.pid) && frontier.includes(r.ppid)) { seen.add(r.pid); out.push(r); next.push(r.pid); }
    frontier = next;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- owner ----------
// { readable, sessionId, transcript } from the process environment. macOS: `ps -wwE` prints argv then the environment.
export function readOwnerEnv(pid) {
  const none = { readable: false, sessionId: null, transcript: null };
  try {
    if (process.platform === "linux") {
      const vars = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      const get = (k) => { const v = vars.find((x) => x.startsWith(`${k}=`)); return v ? v.slice(k.length + 1) : null; };
      return { readable: true, sessionId: get("CODEX_COMPANION_SESSION_ID"), transcript: get("CODEX_COMPANION_TRANSCRIPT_PATH") };
    }
    const r = spawnSync(PS, ["-wwE", "-o", "command=", "-p", String(pid)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) return none;
    const text = r.stdout.replace(/\n$/, "");
    const id = /(?:^| )CODEX_COMPANION_SESSION_ID=([0-9a-fA-F-]{36})(?= |$)/.exec(text);
    const tr = /(?:^| )CODEX_COMPANION_TRANSCRIPT_PATH=(.*?)(?= [A-Za-z_][A-Za-z0-9_]*=|$)/.exec(text);
    return { readable: true, sessionId: id ? id[1].toLowerCase() : null, transcript: tr ? tr[1] : null };
  } catch { return none; }
}

const claudeSessionRows = (rows) => rows.filter((r) => alive(r) && CLAUDE_RE.test(r.command) && !WRAPPER_RE.test(r.command) && RESUME_RE.test(r.command));

function findTranscript(sessionId, claudeDir, hint) {
  if (hint) { try { return { path: hint, mtimeMs: statSync(hint).mtimeMs }; } catch { /* fall through */ } }
  let slugs = []; try { slugs = readdirSync(path.join(claudeDir, "projects")); } catch { return null; }
  for (const s of slugs) { const f = path.join(claudeDir, "projects", s, `${sessionId}.jsonl`); try { return { path: f, mtimeMs: statSync(f).mtimeMs }; } catch { /* next */ } }
  return null;
}

// state: "alive" | "gone" | "unknown"
export function ownerState(env, rows, { claudeDir, idleHours }) {
  if (!env.readable || !env.sessionId) return { sessionId: null, state: "unknown", via: null, transcript: null, lastActivity: null };
  const id = env.sessionId.toLowerCase();
  const tr = findTranscript(id, claudeDir, env.transcript);
  const base = { sessionId: id, transcript: tr?.path ?? env.transcript ?? null, lastActivity: tr ? new Date(tr.mtimeMs).toISOString() : null };
  if (claudeSessionRows(rows).some((r) => RESUME_RE.exec(r.command)[1].toLowerCase() === id)) return { ...base, state: "alive", via: "process" };
  if (tr && Date.now() - tr.mtimeMs <= idleHours * 3600_000) return { ...base, state: "alive", via: "transcript" };
  return { ...base, state: "gone", via: null };
}

// ---------- report ----------
function shq(s) { return /^[A-Za-z0-9_\/.:@%+=,-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`; }

export function buildReport(rows, { brokerHours = 24, idleHours = 24, claudeDir = path.join(os.homedir(), ".claude") } = {}) {
  const brokers = rows.filter((r) => BROKER_LOOSE.test(r.command) && !isClaude(r.command)).map((r) => {
    const id = proveBroker(r), a = parseBrokerArgv(r.command);
    const kids = descendants(rows, r.pid);
    const cwd = a?.cwd ?? null, pidFile = a?.pidFile ?? null;
    const owner = id.proven ? ownerState(readOwnerEnv(r.pid), rows, { claudeDir, idleHours }) : { sessionId: null, state: "unknown", via: null, transcript: null, lastActivity: null };
    const cwdExists = cwd ? existsSync(cwd) : false;
    const old = r.age != null && r.age > brokerHours * 3600;
    const why = owner.state === "gone" ? ["its owner session is gone"]
      : owner.state === "unknown" ? [cwd && !cwdExists ? "owner unknown and --cwd is gone" : null, old ? `owner unknown and older than ${brokerHours} h` : null].filter(Boolean) : [];
    const orphan = id.proven && why.length > 0;
    return {
      pid: r.pid, ppid: r.ppid, ageSeconds: r.age, treeRssMb: Math.round((r.rssKb + kids.reduce((s, k) => s + k.rssKb, 0)) / 1024),
      children: kids.map((k) => ({ pid: k.pid, command: k.command.slice(0, 120), rssMb: Math.round(k.rssKb / 1024) })),
      cwd, pidFile, identityProven: id.proven, identityReason: id.reason, cwdExists, olderThanThreshold: old,
      owner, orphan, orphanReasons: orphan ? why : [],
      stopCommand: orphan ? `node ${shq(SELF)} --stop --pid-file ${shq(pidFile)}` : null,
    };
  });
  const sessions = [];
  for (const r of claudeSessionRows(rows)) {
    const sessionId = RESUME_RE.exec(r.command)[1].toLowerCase();
    const tr = findTranscript(sessionId, claudeDir, null);
    sessions.push({ pid: r.pid, ageSeconds: r.age, rssMb: Math.round(r.rssKb / 1024), sessionId, transcript: tr?.path ?? null, lastActivity: tr ? new Date(tr.mtimeMs).toISOString() : null, idle: tr ? Date.now() - tr.mtimeMs > idleHours * 3600_000 : null });
  }
  return { mode: "report-only", brokerHours, idleHours, brokers, claudeSessions: sessions };
}

function printReport(rep) {
  const L = [`doctor-orphans: REPORT ONLY (nothing is signalled). Codex plugin brokers: ${rep.brokers.length}; Claude session processes: ${rep.claudeSessions.length}.`];
  for (const b of rep.brokers) {
    L.push(`  broker pid ${b.pid} ppid ${b.ppid} (information only: every plugin broker is detached) age ${b.ageSeconds == null ? "?" : Math.round(b.ageSeconds / 3600 * 10) / 10 + " h"} tree ${b.treeRssMb} MB`);
    L.push(`    cwd ${b.cwd} (${b.cwdExists ? "exists" : "GONE"})  pid-file ${b.pidFile}`);
    L.push(`    owner ${b.owner.sessionId ? `${b.owner.sessionId} ${b.owner.state.toUpperCase()}${b.owner.via ? " via " + b.owner.via : ""}  transcript ${b.owner.transcript ?? "none"}  last activity ${b.owner.lastActivity ?? "unknown"}` : "UNKNOWN"}`);
    L.push(`    identity ${b.identityProven ? "PROVEN" : "NOT PROVEN: " + b.identityReason}; ${b.orphan ? "ORPHAN: " + b.orphanReasons.join(", ") : "not an orphan"}`);
    if (b.stopCommand) L.push(`    stop: ${b.stopCommand}`);
  }
  for (const s of rep.claudeSessions) L.push(`  claude pid ${s.pid} ${s.rssMb} MB session ${s.sessionId} last activity ${s.lastActivity ?? "unknown"}${s.idle ? " (IDLE)" : ""}`);
  return L.join("\n");
}

// ---------- stop ----------
// Stops ONE broker row. `refuse(parsedArgv, ownerInfo)` lets a caller veto after identity is proven.
async function stopBroker(pid, expectCommand, { pidFileArg = null, refuse = null, claudeDir, idleHours } = {}) {
  const res = { pid, pidFile: null, stopped: false, refused: null, children: [], survivors: [] };
  const table = () => { const t = readTable(); return t.rows ? t.rows : null; };
  let rows = table();
  if (!rows) { res.refused = "could not read the process table"; return res; }
  const row = rows.find((r) => r.pid === pid);
  if (!row) { res.refused = "no such process"; return res; }
  if (expectCommand && row.command !== expectCommand) { res.refused = "the process changed since it was identified"; return res; }
  const id = proveBroker(row);
  if (!id.proven) { res.refused = id.reason; return res; }
  res.pidFile = id.argv.pidFile; res.cwd = id.argv.cwd;
  if (pidFileArg && rp(id.argv.pidFile) !== rp(pidFileArg)) { res.refused = "the broker's argv names a different pid file than the one given"; return res; }
  if (refuse) { const why = refuse(id.argv, ownerState(readOwnerEnv(pid), rows, { claudeDir, idleHours })); if (why) { res.refused = why; return res; } }
  const kids = directChildren(rows, pid).filter((k) => alive(k) && CHILD_ARGV.test(k.command) && !isClaude(k.command));
  // Re-prove immediately before the signal.
  rows = table();
  const again = rows?.find((r) => r.pid === pid);
  if (!again || again.command !== row.command || !proveBroker(again).proven) { res.refused = "identity could not be re-proven before the signal"; return res; }
  try { process.kill(pid, "SIGTERM"); } catch (e) { res.refused = `signal failed: ${e.code ?? e.message}`; return res; }
  // true = gone, false = still there after the wait, null = the process table could not be read (never "stopped")
  const gone = async (p, cmd, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const t = table();
      if (!t) return null;
      const x = t.find((r) => r.pid === p);
      if (!alive(x) || (cmd && x.command !== cmd)) return true;
      if (Date.now() >= end) return false;
      await sleep(100);
    }
  };
  const g = await gone(pid, row.command, 5000);
  if (g === null) { res.refused = "could not verify: the process table became unreadable after the signal"; return res; }
  res.stopped = g;
  if (!g) return res;
  for (const k of kids) {
    const t = table();
    if (!t) { res.children.push({ pid: k.pid, how: "could not verify" }); res.survivors.push(k.pid); continue; }
    const x = t.find((r) => r.pid === k.pid);
    if (!alive(x) || x.command !== k.command || !CHILD_ARGV.test(x.command) || isClaude(x.command)) { res.children.push({ pid: k.pid, how: "already gone" }); continue; }
    try { process.kill(k.pid, "SIGTERM"); } catch { /* raced */ }
    const gk = await gone(k.pid, k.command, 3000);
    if (gk === true) res.children.push({ pid: k.pid, how: "SIGTERM" });
    else { res.children.push({ pid: k.pid, how: gk === null ? "could not verify" : "survived SIGTERM" }); res.survivors.push(k.pid); }
  }
  return res;
}

// ---------- main ----------
class Usage extends Error {}
const usage = (msg) => { throw new Usage(msg); };
const USAGE = "usage: doctor-orphans.mjs [--json] [--broker-hours N] [--idle-hours N] | --stop --pid-file <file> | --reap (--owner <uuid|self> | --cwd <dir>…)";
const finish = (text, err, code) => { if (err) process.stderr.write(`${err}\n`); process.stdout.write(text ? `${text}\n` : "", () => process.exit(code)); };

async function main(argv) {
  const o = { json: false, stop: false, reap: false, pidFile: null, cwds: [], owner: null, brokerHours: 24, idleHours: 24, claudeDir: path.join(os.homedir(), ".claude") };
  const hours = (v, flag) => { const n = Number(v); if (!(Number.isFinite(n) && n > 0)) usage(`${flag} takes a number greater than zero`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--stop") o.stop = true;
    else if (a === "--reap") o.reap = true;
    else if (a === "--pid-file") o.pidFile = argv[++i] ?? usage("--pid-file needs a value");
    else if (a === "--owner") o.owner = argv[++i] ?? usage("--owner needs a value");
    else if (a === "--cwd") { while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) o.cwds.push(argv[++i]); if (!o.cwds.length) usage("--cwd needs a directory"); }
    else if (a === "--broker-hours") o.brokerHours = hours(argv[++i], "--broker-hours");
    else if (a === "--idle-hours") o.idleHours = hours(argv[++i], "--idle-hours");
    else if (a === "--claude-dir") o.claudeDir = argv[++i] ?? usage("--claude-dir needs a value");
    else usage(`unknown argument ${a}`);
  }
  if ((o.pidFile !== null && !o.pidFile) || o.cwds.some((d) => !d)) usage("--pid-file and --cwd take a non-empty path (an empty one would resolve to the current directory)");
  if (o.stop && o.reap) usage("--stop and --reap are separate runs");
  if (o.stop && !o.pidFile) usage("--stop needs --pid-file <file>");
  if (o.reap && o.cwds.length === 0 && !o.owner) usage("--reap needs --owner <uuid|self> or --cwd <dir>");
  if (!o.reap && (o.cwds.length || o.owner)) usage("--cwd and --owner go with --reap");
  if (!o.stop && o.pidFile) usage("--pid-file goes with --stop");
  let owner = null;
  if (o.owner) {
    owner = (o.owner === "self" ? process.env.CODEX_COMPANION_SESSION_ID : o.owner) ?? "";
    if (!UUID_RE.test(owner)) usage(o.owner === "self" ? "--owner self needs CODEX_COMPANION_SESSION_ID set to this session's uuid (it is unset or malformed here)" : "--owner takes a session uuid or `self`");
    owner = owner.toLowerCase();
  }
  const selfId = UUID_RE.test(process.env.CODEX_COMPANION_SESSION_ID ?? "") ? process.env.CODEX_COMPANION_SESSION_ID.toLowerCase() : null;
  const emit = (obj, text) => (o.json ? JSON.stringify(obj, null, 2) : text);
  const acting = o.stop || o.reap;
  const common = { claudeDir: o.claudeDir, idleHours: o.idleHours };

  const t = readTable();
  if (!t.rows) {
    const reason = t.unsupported ? `platform ${t.unsupported}` : t.error;
    return finish(emit({ mode: acting ? (o.stop ? "stop" : "reap") : "report-only", unsupported: !!t.unsupported, reason, results: [] }, acting ? `doctor-orphans: cannot read the process table (${reason}); nothing was stopped.` : `doctor-orphans: cannot read the process table (${reason}); nothing to report.`), null, acting && !t.unsupported ? 1 : 0);
  }

  if (o.stop) {
    const held = readPidFile(o.pidFile);
    if (held == null) { const r = { mode: "stop", results: [{ pidFile: o.pidFile, stopped: false, refused: "the pid file is missing or does not hold a pid" }] }; return finish(emit(r, `REFUSED ${o.pidFile}: ${r.results[0].refused}`), null, 1); }
    const res = await stopBroker(held, null, { pidFileArg: o.pidFile, ...common });
    return finish(emit({ mode: "stop", results: [res] }, summarize(res)), null, res.stopped && !res.survivors.length ? 0 : 1);
  }

  if (o.reap) {
    const wanted = new Set(o.cwds.map(rp));
    const results = [];
    for (const r of t.rows) {
      if (!BROKER_LOOSE.test(r.command) || isClaude(r.command)) continue;
      const a = parseBrokerArgv(r.command), id = proveBroker(r);
      if (o.cwds.length && !(a && wanted.has(rp(a.cwd)))) continue;
      if (owner) {
        if (!id.proven) continue;                                        // an unproven process is never matched by an owner it merely claims
        const env = readOwnerEnv(r.pid);
        if (!env.readable || !env.sessionId || env.sessionId.toLowerCase() !== owner) continue;
      }
      const refuse = o.cwds.length && !owner ? (_argv, st) => (st.state === "alive" && st.sessionId !== selfId ? `another live session's broker (owner ${st.sessionId} is ${st.via === "process" ? "running" : "recently active"})` : null) : null;
      results.push(await stopBroker(r.pid, r.command, { refuse, ...common }));
    }
    const what = owner ? `owner ${owner}` : `--cwd ${[...wanted].join(" or ")}`;
    return finish(emit({ mode: "reap", owner, dirs: [...wanted], results }, results.length ? results.map(summarize).join("\n") : `doctor-orphans: no broker matches ${what}; nothing stopped.`), null, results.every((x) => x.stopped && !x.survivors.length) ? 0 : 1);
  }

  const rep = buildReport(t.rows, o);
  return finish(emit(rep, printReport(rep)), null, 0);
}

function summarize(res) {
  if (res.refused) return `REFUSED broker ${res.pid}${res.pidFile ? " (" + res.pidFile + ")" : ""}: ${res.refused}`;
  if (!res.stopped) return `broker ${res.pid} (${res.pidFile}) is STILL ALIVE after SIGTERM; not escalated`;
  return `STOPPED broker ${res.pid} (pid-file ${res.pidFile}); children: ${res.children.length ? res.children.map((c) => `${c.pid} ${c.how}`).join(", ") : "none"}`;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF);
if (isMain) main(process.argv.slice(2)).catch((e) => {
  if (e instanceof Usage) return finish("", `doctor-orphans: ${e.message}\n${USAGE}`, 2);
  console.error(`doctor-orphans: ${e.stack ?? e}`); process.exit(2);
});
