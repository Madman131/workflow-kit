#!/usr/bin/env node
// workflow-kit — scripts/doctor-orphans.mjs. REPORT the Codex plugin brokers and Claude session processes on this host.
// THIS TOOL NEVER STOPS A PROCESS, with no exception and no flag: it has no stop mode, signals nothing and prints no stop
// command. Stopping a process is the Owner's call, made by hand from this report.
//
//   node scripts/doctor-orphans.mjs [--json] [--broker-hours N] [--idle-hours N] [--claude-dir <dir>]
//
// WHY IT EXISTS (measured 2026-11-21). The Claude `openai-codex` plugin starts one `app-server-broker.mjs` per cwd, always
// detached (so EVERY broker has ppid 1 from birth), and its SessionEnd hook tears down only the broker keyed to the SESSION's
// cwd; a gate seat run through the plugin with `--cwd <packet dir>` is never found, so finished threads left 24 broker trees
// (3.2 GB) behind. The cure is doctrine, not a killer: Codex gate seats run ONLY through `scripts/codex-gate.sh` (`core/GATES.md`
// § Codex seats and brokers), so no seat leaves a broker. This report shows what is still resident so the Owner can decide.
// (Three rounds of review found a new hole in every heuristic for "whose live process may the kit kill"; the kit now kills none.)
//
// WHAT IT LISTS
//   brokers   pid, ppid (information only), age, tree RSS, --cwd (and whether it exists), pid file, the identity-SHAPE check (argv
//             is exactly the plugin's `node …/app-server-broker.mjs serve --endpoint … --cwd … --pid-file …` and the pid file holds
//             this pid), the owner session uuid from the broker's environment (CODEX_COMPANION_SESSION_ID; `ps -wwE` on macOS,
//             /proc/<pid>/environ on Linux), whether that owner LOOKS alive (a live Claude process with `--resume=<owner>`, else
//             a transcript written within --idle-hours, else GONE; UNKNOWN when the environment cannot be read), and a
//             shared-root hint (another live Claude process's cwd is inside the broker's --cwd; `lsof -a -d cwd`, else unknown).
//   LIKELY LEFTOVER = identity shape proven AND owner GONE AND older than --broker-hours (default 24). A hint, never a verdict.
//   claude    each live Claude session process (pid, session id from `--resume=`, transcript, last activity, idle after
//             --idle-hours); the desktop `disclaimer --pgroup` wrapper rows are dropped so a session counts once.
//
// A process table is read with `/bin/ps -A -ww -o pid=,ppid=,stat=,etime=,rss=,command=` (macOS and Linux; the PATH ps only if
// /bin/ps is absent). Any other platform, or a ps that fails, reports that and exits 0. Every run prints, verbatim, the sentence
// in NOTICE below (text and JSON). RESIDUALS: the environment is readable only for processes you own; a --pid-file path with a
// space, or a --cwd directory named like ` --pid-file `, fails the shape check; an owner can look alive through a recent transcript
// after its process is gone. Exit 0 for every report; 2 for a bad or stop-shaped argument.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NOTICE = "Stopping a process is the Owner's call; this tool never does it.";
const PS = existsSync("/bin/ps") ? "/bin/ps" : "ps";
const BROKER_ARGV = /^(?:\S*\/)?node(?:js)? (?:\S*\/)?app-server-broker\.mjs serve --endpoint (\S+) --cwd ((?:(?! --(?:cwd|pid-file|endpoint) ).)+) --pid-file (\S+)$/;
const BROKER_LOOSE = /app-server-broker\.mjs\s+serve(?:\s|$)/;
const CLAUDE_RE = /(?:^|[\/\s])claude(?:\.exe)?\s+--/;
const WRAPPER_RE = /(?:^|[\/\s])disclaimer\s+--pgroup(?:\s|$)/;
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
  const r = spawnSync(PS, ["-A", "-ww", "-o", "pid=,ppid=,stat=,etime=,rss=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { error: String(r.error?.message ?? r.stderr ?? "ps failed").trim() };
  return { rows: parsePs(r.stdout) };
}

const alive = (row) => !!row && !row.stat.startsWith("Z");

// The plugin's exact broker argv, or null. cwd may contain spaces; nothing else may.
export function parseBrokerArgv(command) {
  const m = BROKER_ARGV.exec(command);
  return m ? { endpoint: m[1], cwd: m[2], pidFile: m[3] } : null;
}

export function readPidFile(file) {
  try { const m = /^\s*(\d+)\s*$/.exec(readFileSync(file, "utf8")); return m ? +m[1] : null; } catch { return null; }
}

const isClaude = (command) => CLAUDE_RE.test(command) || WRAPPER_RE.test(command);

// The identity-SHAPE check for one broker row: { proven, reason, argv }.
export function proveBroker(row) {
  if (!alive(row)) return { proven: false, reason: "process is not running" };
  if (isClaude(row.command)) return { proven: false, reason: "the command is a Claude process" };
  const a = parseBrokerArgv(row.command);
  if (!a) return { proven: false, reason: "argv is not exactly `node …/app-server-broker.mjs serve --endpoint … --cwd … --pid-file …`" };
  if (!path.isAbsolute(a.pidFile)) return { proven: false, reason: "argv --pid-file is not an absolute path" };
  if (!existsSync(a.pidFile)) return { proven: false, reason: "the pid file named in argv does not exist" };
  const held = readPidFile(a.pidFile);
  if (held !== row.pid) return { proven: false, reason: `the pid file holds ${held ?? "no pid"}, not ${row.pid}` };
  return { proven: true, reason: "argv is the plugin's shape; the pid file exists, holds this pid and is named in argv", argv: a };
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

// cwd of each live Claude process, via `lsof -a -d cwd -Fpn`; null when lsof is unavailable or fails.
function claudeCwds(pids) {
  if (!pids.length) return new Map();
  const r = spawnSync("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", pids.join(",")], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error || (r.status !== 0 && r.status !== 1)) return null;
  const out = new Map(); let cur = null;
  for (const l of r.stdout.split("\n")) { if (l.startsWith("p")) cur = Number(l.slice(1)); else if (l.startsWith("n") && cur != null) out.set(cur, l.slice(1)); }
  return out;
}
const canon = (p) => { try { return realpathSync(p); } catch { return p; } };       // lsof prints real paths; /var and /private/var must compare equal
const inside = (dir, root) => dir === root || dir.startsWith(root.endsWith("/") ? root : `${root}/`);

// ---------- report ----------
export function buildReport(rows, { brokerHours = 24, idleHours = 24, claudeDir = path.join(os.homedir(), ".claude") } = {}) {
  const sessionRows = claudeSessionRows(rows);
  const cwds = claudeCwds(sessionRows.map((r) => r.pid));
  const brokers = rows.filter((r) => BROKER_LOOSE.test(r.command) && !isClaude(r.command)).map((r) => {
    const id = proveBroker(r), a = parseBrokerArgv(r.command);
    const kids = descendants(rows, r.pid);
    const cwd = a?.cwd ?? null, pidFile = a?.pidFile ?? null;
    const owner = id.proven ? ownerState(readOwnerEnv(r.pid), rows, { claudeDir, idleHours }) : { sessionId: null, state: "unknown", via: null, transcript: null, lastActivity: null };
    const old = r.age != null && r.age > brokerHours * 3600;
    const sharedRoot = !cwd || !cwds ? "unknown" : [...cwds.values()].some((c) => inside(canon(c), canon(cwd))) ? "yes" : "no";
    return {
      pid: r.pid, ppid: r.ppid, ageSeconds: r.age, treeRssMb: Math.round((r.rssKb + kids.reduce((s, k) => s + k.rssKb, 0)) / 1024),
      cwd, cwdExists: cwd ? existsSync(cwd) : false, pidFile, identityShapeOk: id.proven, identityReason: id.reason,
      owner, olderThanBrokerHours: old, sharedRoot, likelyLeftover: id.proven && owner.state === "gone" && old,
    };
  });
  const sessions = sessionRows.map((r) => {
    const sessionId = RESUME_RE.exec(r.command)[1].toLowerCase();
    const tr = findTranscript(sessionId, claudeDir, null);
    return { pid: r.pid, ageSeconds: r.age, rssMb: Math.round(r.rssKb / 1024), sessionId, transcript: tr?.path ?? null, lastActivity: tr ? new Date(tr.mtimeMs).toISOString() : null, idle: tr ? Date.now() - tr.mtimeMs > idleHours * 3600_000 : null };
  });
  return { mode: "report-only", notice: NOTICE, brokerHours, idleHours, brokers, claudeSessions: sessions };
}

function printReport(rep) {
  const L = [`doctor-orphans: REPORT ONLY. Codex plugin brokers: ${rep.brokers.length}; Claude session processes: ${rep.claudeSessions.length}.`, NOTICE];
  for (const b of rep.brokers) {
    L.push(`  broker pid ${b.pid} ppid ${b.ppid} (information only: every plugin broker is detached) age ${b.ageSeconds == null ? "?" : Math.round(b.ageSeconds / 3600 * 10) / 10 + " h"} tree ${b.treeRssMb} MB${b.likelyLeftover ? "  LIKELY LEFTOVER" : ""}`);
    L.push(`    cwd ${b.cwd} (${b.cwdExists ? "exists" : "GONE"})  pid-file ${b.pidFile}  shared-root hint: ${b.sharedRoot}`);
    L.push(`    owner ${b.owner.sessionId ? `${b.owner.sessionId} ${b.owner.state === "alive" ? "LOOKS ALIVE" : "GONE"}${b.owner.via ? " via " + b.owner.via : ""}  transcript ${b.owner.transcript ?? "none"}  last activity ${b.owner.lastActivity ?? "unknown"}` : "UNKNOWN"}`);
    L.push(`    identity shape ${b.identityShapeOk ? "OK" : "NOT OK: " + b.identityReason}`);
  }
  for (const s of rep.claudeSessions) L.push(`  claude pid ${s.pid} ${s.rssMb} MB session ${s.sessionId} last activity ${s.lastActivity ?? "unknown"}${s.idle ? " (IDLE)" : ""}`);
  const lo = rep.brokers.filter((b) => b.likelyLeftover);
  if (lo.length) L.push(`Likely leftover brokers (owner gone, older than ${rep.brokerHours} h): ${lo.map((b) => b.pid).join(", ")}. Whether to stop them is the Owner's decision.`);
  return L.join("\n");
}

// ---------- main ----------
class Usage extends Error {}
const usage = (msg) => { throw new Usage(msg); };
const USAGE = "usage: doctor-orphans.mjs [--json] [--broker-hours N] [--idle-hours N] [--claude-dir <dir>]  (report only; this tool never stops a process)";
const STOP_SHAPED = new Set(["--stop", "--reap", "--kill", "--terminate", "--signal", "--force", "--pid-file", "--owner", "--cwd", "--yes", "--sigkill"]);
const finish = (text, err, code) => { if (err) process.stderr.write(`${err}\n`); process.stdout.write(text ? `${text}\n` : "", () => process.exit(code)); };

function main(argv) {
  const o = { json: false, brokerHours: 24, idleHours: 24, claudeDir: path.join(os.homedir(), ".claude") };
  const hours = (v, flag) => { const n = Number(v); if (!(Number.isFinite(n) && n > 0)) usage(`${flag} takes a number greater than zero`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--broker-hours") o.brokerHours = hours(argv[++i], "--broker-hours");
    else if (a === "--idle-hours") o.idleHours = hours(argv[++i], "--idle-hours");
    else if (a === "--claude-dir") o.claudeDir = argv[++i] ?? usage("--claude-dir needs a value");
    else if (STOP_SHAPED.has(a)) usage(`${a}: this tool never stops a process (stopping one is the Owner's call)`);
    else usage(`unknown argument ${a}`);
  }
  const t = readTable();
  if (!t.rows) {
    const reason = t.unsupported ? `platform ${t.unsupported}` : t.error;
    return finish(o.json ? JSON.stringify({ mode: "report-only", notice: NOTICE, unsupported: !!t.unsupported, reason, brokers: [], claudeSessions: [] }, null, 2) : `doctor-orphans: cannot read the process table (${reason}); nothing to report.\n${NOTICE}`, null, 0);
  }
  const rep = buildReport(t.rows, o);
  return finish(o.json ? JSON.stringify(rep, null, 2) : printReport(rep), null, 0);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try { main(process.argv.slice(2)); } catch (e) {
    if (e instanceof Usage) finish("", `doctor-orphans: ${e.message}\n${USAGE}`, 2);
    else { console.error(`doctor-orphans: ${e.stack ?? e}`); process.exit(2); }
  }
}
