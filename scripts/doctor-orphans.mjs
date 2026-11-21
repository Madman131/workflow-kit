#!/usr/bin/env node
// workflow-kit — scripts/doctor-orphans.mjs. Report the Codex plugin brokers and Claude session processes
// on this host, and stop a broker ONLY when told to, by name, with its identity proven first.
//
//   node scripts/doctor-orphans.mjs [--json] [--broker-hours N] [--idle-hours N] [--claude-dir <dir>]
//   node scripts/doctor-orphans.mjs --stop --pid-file <file>      stop the ONE broker that file names
//   node scripts/doctor-orphans.mjs --reap --cwd <dir> [<dir>…]   stop every broker whose --cwd IS one of these dirs
//
// DEFAULT = REPORT ONLY. No flag but --stop or --reap ever signals anything, and nothing here ever signals a
// Claude process, runs `pkill`, or matches a process by name. A signal goes to a process only when ALL of these
// hold at the moment before it is sent: (1) its argv is `node …app-server-broker.mjs serve …`; (2) its argv names a
// --pid-file that exists and holds exactly that pid; (3) for --stop, that argv pid file is the file the caller
// named (compared after realpath); for --reap, its argv --cwd realpath equals a named dir EXACTLY (never a
// prefix). Anything else is REFUSED with the reason and the process is left alone. After the broker exits, each
// child recorded BEFORE the signal whose command is `codex app-server` and which is still alive gets one SIGTERM.
// There is no SIGKILL: a process that survives SIGTERM is reported, not escalated.
//
// WHY THIS EXISTS (measured 2026-11-21). The Claude `openai-codex` plugin starts one broker per cwd and its
// SessionEnd hook tears down only the broker keyed to the SESSION's cwd; a seat run with `--cwd <packet dir>`
// is never found, so finished threads left 24 broker trees (3.2 GB) behind. The real shape:
//   node …/openai-codex/codex/<ver>/scripts/app-server-broker.mjs serve --endpoint unix:<tmp>/cxc-XXXXXX/broker.sock
//        --cwd <dir> --pid-file <tmp>/cxc-XXXXXX/broker.pid        (child: `codex app-server`)
// SIGTERM/SIGINT run the broker's own shutdown() (closes the client, unlinks socket and pid file) and exit 0.
//
// A process table is read with `ps -A -ww -o pid=,ppid=,stat=,etime=,rss=,command=` (macOS and Linux). Any other
// platform reports that and exits 0. Residual: the proof and the signal are two steps, so a pid reused between
// them is possible in principle; the proof is re-run immediately before the signal, which shrinks the window to
// microseconds and is the most a userland check can do.
//
// Exit: 0 on a report; for --stop/--reap 0 when every named target was stopped or nothing matched, 1 when a
// stop was refused or a process survived, 2 on bad arguments.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const BROKER_RE = /(?:^|[\/\s])node(?:js)?(?:\s+--\S+)*\s+(?!-)(?:\S|\s(?!-))*?\/app-server-broker\.mjs\s+serve(?:\s|$)/;
const CHILD_RE = /(?:^|[\/\s])codex\s+app-server(?:\s|$)/;
const CLAUDE_RE = /(?:^|[\/\s])claude(?:\.exe)?\s+--/;
const RESUME_RE = /--resume[= ]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

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
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,stat=,etime=,rss=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { error: String(r.error?.message ?? r.stderr ?? "ps failed").trim() };
  return { rows: parsePs(r.stdout) };
}

const alive = (row) => row && !row.stat.startsWith("Z");
const rp = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };

// The value after a flag runs to the next known flag or the end, so a path with spaces survives.
export function argvFlag(command, flag) {
  const m = new RegExp(`\\s${flag}\\s+(.*?)(?=\\s--(?:endpoint|cwd|pid-file)\\s|\\s*$)`).exec(command);
  return m ? m[1] : null;
}

export function readPidFile(file) {
  try { const m = /^\s*(\d+)\s*$/.exec(readFileSync(file, "utf8")); return m ? +m[1] : null; } catch { return null; }
}

// Identity proof for one broker row. Returns { proven, reason }.
export function proveBroker(row) {
  if (!alive(row)) return { proven: false, reason: "process is not running" };
  if (!BROKER_RE.test(row.command)) return { proven: false, reason: "argv is not `app-server-broker.mjs serve`" };
  const pidFile = argvFlag(row.command, "--pid-file");
  if (!pidFile) return { proven: false, reason: "argv names no --pid-file" };
  if (!path.isAbsolute(pidFile)) return { proven: false, reason: "argv --pid-file is not an absolute path" };
  if (!existsSync(pidFile)) return { proven: false, reason: "the pid file named in argv does not exist" };
  const held = readPidFile(pidFile);
  if (held !== row.pid) return { proven: false, reason: `the pid file holds ${held ?? "no pid"}, not ${row.pid}` };
  return { proven: true, reason: "pid file exists, holds this pid and is named in argv" };
}

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

// ---------- report ----------
export function buildReport(rows, { brokerHours = 24, idleHours = 24, claudeDir = path.join(os.homedir(), ".claude") } = {}) {
  const brokers = rows.filter((r) => BROKER_RE.test(r.command)).map((r) => {
    const cwd = argvFlag(r.command, "--cwd"), pidFile = argvFlag(r.command, "--pid-file");
    const kids = descendants(rows, r.pid);
    const id = proveBroker(r);
    const cwdExists = cwd ? existsSync(cwd) : false;
    const old = r.age != null && r.age > brokerHours * 3600;
    const why = [r.ppid === 1 ? "ppid 1 (orphaned)" : null, cwd && !cwdExists ? "--cwd is gone" : null, old ? `older than ${brokerHours} h` : null].filter(Boolean);
    return {
      pid: r.pid, ppid: r.ppid, ageSeconds: r.age, treeRssMb: Math.round((r.rssKb + kids.reduce((s, k) => s + k.rssKb, 0)) / 1024),
      children: kids.map((k) => ({ pid: k.pid, command: k.command.slice(0, 120), rssMb: Math.round(k.rssKb / 1024) })),
      cwd, pidFile, identityProven: id.proven, identityReason: id.reason, cwdExists, olderThanThreshold: old,
      orphan: why.length > 0, orphanReasons: why,
      stopCommand: id.proven && why.length > 0 ? `node ${shq(SELF)} --stop --pid-file ${shq(pidFile)}` : null,
    };
  });
  const sessions = [];
  const projects = path.join(claudeDir, "projects");
  let slugs = []; try { slugs = readdirSync(projects); } catch { /* none */ }
  for (const r of rows) {
    if (!alive(r) || !CLAUDE_RE.test(r.command)) continue;
    const m = RESUME_RE.exec(r.command);
    const sessionId = m ? m[1] : null;
    let transcript = null, lastActivity = null;
    if (sessionId) for (const s of slugs) {
      const f = path.join(projects, s, `${sessionId}.jsonl`);
      try { lastActivity = statSync(f).mtime.toISOString(); transcript = f; break; } catch { /* next */ }
    }
    const idle = lastActivity ? Date.now() - Date.parse(lastActivity) > idleHours * 3600_000 : null;
    sessions.push({ pid: r.pid, ageSeconds: r.age, rssMb: Math.round(r.rssKb / 1024), sessionId, transcript, lastActivity, idle });
  }
  return { mode: "report-only", brokerHours, idleHours, brokers, claudeSessions: sessions };
}

function shq(s) { return /^[A-Za-z0-9_\/.:@%+=,-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`; }

function printReport(rep) {
  const L = [];
  L.push(`doctor-orphans: REPORT ONLY (nothing is signalled). Codex plugin brokers: ${rep.brokers.length}; Claude session processes: ${rep.claudeSessions.length}.`);
  for (const b of rep.brokers) {
    L.push(`  broker pid ${b.pid} ppid ${b.ppid} age ${b.ageSeconds == null ? "?" : Math.round(b.ageSeconds / 3600 * 10) / 10 + " h"} tree ${b.treeRssMb} MB`);
    L.push(`    cwd ${b.cwd} (${b.cwdExists ? "exists" : "GONE"})  pid-file ${b.pidFile}`);
    L.push(`    identity ${b.identityProven ? "PROVEN" : "NOT PROVEN: " + b.identityReason}; ${b.orphan ? "ORPHAN: " + b.orphanReasons.join(", ") : "not an orphan"}`);
    if (b.stopCommand) L.push(`    stop: ${b.stopCommand}`);
  }
  for (const s of rep.claudeSessions) {
    L.push(`  claude pid ${s.pid} ${s.rssMb} MB session ${s.sessionId ?? "?"} last activity ${s.lastActivity ?? "unknown"}${s.idle ? " (IDLE)" : ""}`);
  }
  return L.join("\n");
}

// ---------- stop ----------
// Stops ONE broker row. `pidFileArg` (optional) is the file the caller named; the argv pid file must equal it.
async function stopBroker(pid, expectCommand, pidFileArg) {
  const res = { pid, pidFile: null, stopped: false, refused: null, children: [], survivors: [] };
  let t = readTable();
  if (!t.rows) { res.refused = t.error ?? `unsupported platform ${t.unsupported}`; return res; }
  let row = t.rows.find((r) => r.pid === pid);
  if (!row) { res.refused = "no such process"; return res; }
  if (expectCommand && row.command !== expectCommand) { res.refused = "the process changed since it was identified"; return res; }
  const id = proveBroker(row);
  if (!id.proven) { res.refused = id.reason; return res; }
  const pidFile = argvFlag(row.command, "--pid-file");
  res.pidFile = pidFile;
  if (pidFileArg && rp(pidFile) !== rp(pidFileArg)) { res.refused = "the broker's argv names a different pid file than the one given"; return res; }
  res.cwd = argvFlag(row.command, "--cwd");
  const kids = descendants(t.rows, pid).filter((k) => CHILD_RE.test(k.command));
  // Re-prove immediately before the signal.
  t = readTable();
  const again = t.rows?.find((r) => r.pid === pid);
  if (!again || again.command !== row.command || !proveBroker(again).proven) { res.refused = "identity could not be re-proven before the signal"; return res; }
  try { process.kill(pid, "SIGTERM"); } catch (e) { res.refused = `signal failed: ${e.code ?? e.message}`; return res; }
  const gone = async (p, cmd, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const x = readTable().rows?.find((r) => r.pid === p);
      if (!alive(x) || (cmd && x.command !== cmd)) return true;
      await sleep(100);
    }
    const x = readTable().rows?.find((r) => r.pid === p);
    return !alive(x) || (cmd && x.command !== cmd);
  };
  res.stopped = await gone(pid, row.command, 5000);
  if (!res.stopped) return res;
  for (const k of kids) {
    const x = readTable().rows?.find((r) => r.pid === k.pid);
    if (!alive(x) || x.command !== k.command || !CHILD_RE.test(x.command)) { res.children.push({ pid: k.pid, how: "already gone" }); continue; }
    try { process.kill(k.pid, "SIGTERM"); } catch { /* raced */ }
    if (await gone(k.pid, k.command, 3000)) res.children.push({ pid: k.pid, how: "SIGTERM" });
    else { res.children.push({ pid: k.pid, how: "survived SIGTERM" }); res.survivors.push(k.pid); }
  }
  return res;
}

// ---------- main ----------
function usage(msg) { console.error(`doctor-orphans: ${msg}\nusage: doctor-orphans.mjs [--json] [--broker-hours N] [--idle-hours N] | --stop --pid-file <file> | --reap --cwd <dir>…`); process.exit(2); }

async function main(argv) {
  const o = { json: false, stop: false, reap: false, pidFile: null, cwds: [], brokerHours: 24, idleHours: 24, claudeDir: path.join(os.homedir(), ".claude") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--stop") o.stop = true;
    else if (a === "--reap") o.reap = true;
    else if (a === "--pid-file") o.pidFile = argv[++i];
    else if (a === "--cwd") { while (argv[i + 1] && !argv[i + 1].startsWith("--")) o.cwds.push(argv[++i]); }
    else if (a === "--broker-hours") o.brokerHours = Number(argv[++i]);
    else if (a === "--idle-hours") o.idleHours = Number(argv[++i]);
    else if (a === "--claude-dir") o.claudeDir = argv[++i];
    else usage(`unknown argument ${a}`);
  }
  if ((o.pidFile !== null && !o.pidFile) || o.cwds.some((d) => !d)) usage("--pid-file and --cwd take a non-empty path (an empty one would resolve to the current directory)");
  if (!Number.isFinite(o.brokerHours) || !Number.isFinite(o.idleHours)) usage("--broker-hours and --idle-hours take a number");
  if (o.stop && o.reap) usage("--stop and --reap are separate runs");
  if (o.stop && !o.pidFile) usage("--stop needs --pid-file <file>");
  if (o.reap && o.cwds.length === 0) usage("--reap needs --cwd <dir>");
  if (!o.stop && !o.reap && (o.pidFile || o.cwds.length)) usage("--pid-file and --cwd go with --stop or --reap");
  const emit = (obj, text) => console.log(o.json ? JSON.stringify(obj, null, 2) : text);

  const t = readTable();
  if (!t.rows) {
    emit({ mode: "report-only", unsupported: true, reason: t.unsupported ? `platform ${t.unsupported}` : t.error }, `doctor-orphans: cannot read the process table (${t.unsupported ? "platform " + t.unsupported : t.error}); nothing to report.`);
    return 0;
  }

  if (o.stop) {
    const held = readPidFile(o.pidFile);
    if (held == null) { const r = { mode: "stop", results: [{ pidFile: o.pidFile, stopped: false, refused: "the pid file is missing or does not hold a pid" }] }; emit(r, `REFUSED ${o.pidFile}: ${r.results[0].refused}`); return 1; }
    const res = await stopBroker(held, null, o.pidFile);
    emit({ mode: "stop", results: [res] }, summarize(res));
    return res.stopped && !res.survivors.length ? 0 : 1;
  }

  if (o.reap) {
    const wanted = new Set(o.cwds.map(rp));
    const results = [];
    for (const r of t.rows) {
      if (!BROKER_RE.test(r.command)) continue;
      const cwd = argvFlag(r.command, "--cwd");
      if (!cwd || !wanted.has(rp(cwd))) continue;
      results.push(await stopBroker(r.pid, r.command, null));
    }
    emit({ mode: "reap", dirs: [...wanted], results }, results.length ? results.map(summarize).join("\n") : `doctor-orphans: no broker has --cwd ${[...wanted].join(" or ")}; nothing stopped.`);
    return results.every((x) => x.stopped && !x.survivors.length) ? 0 : 1;
  }

  const rep = buildReport(t.rows, o);
  emit(rep, printReport(rep));
  return 0;
}

function summarize(res) {
  if (res.refused) return `REFUSED broker ${res.pid}${res.pidFile ? " (" + res.pidFile + ")" : ""}: ${res.refused}`;
  if (!res.stopped) return `broker ${res.pid} (${res.pidFile}) is STILL ALIVE after SIGTERM; not escalated`;
  return `STOPPED broker ${res.pid} (pid-file ${res.pidFile}); children: ${res.children.length ? res.children.map((c) => `${c.pid} ${c.how}`).join(", ") : "none"}`;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF);
if (isMain) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`doctor-orphans: ${e.stack ?? e}`); process.exit(2); });
