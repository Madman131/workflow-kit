#!/usr/bin/env node
// workflow-kit — scripts/archive-plan.mjs. Decide which of the sessions THIS session started may be archived now.
// A PURE DECISION SCRIPT: it reads a host session list, runs `git` read-only against each session's cwd, prints a
// plan, and never archives, stops, signals or writes anything. The host's archive tool does the archiving, once per
// planned id, after skills/closeout/ARCHIVE.md's other steps. THE HOST'S ARCHIVE CALL CLEANS UP THE ARCHIVED SESSION'S
// WORKTREE, so every guard below exists to keep work from being lost with it.
//
//   node scripts/archive-plan.mjs --me <my session id> --me-cwd <my cwd> --list-limit <N> [--sessions <file> | stdin]
//                                 [--done <id>]… [--waiting <id>]… [--owner-yes] [--json]
//
//   --sessions    the host's session list as JSON: an array of entries shaped like
//                 { "sessionId":"local_…", "title":"…", "name":"pm-x", "cwd":"…", "isArchived":false, "isRunning":true,
//                   "prNumber":48, "prState":"MERGED", "lastActivityAt":"…", "startedBy":"local_…", "remoteControlActive":false }
//                 (or { "sessions": [ … ] }). The host EXCLUDES the CURRENT session from its own list.
//   --me-cwd      this session's cwd (`get_session self`; an existing directory). Its worktree STAYS: no session sharing it is archived.
//   --list-limit  the `limit` the agent passed to `list_sessions`. A list holding that many entries or more may be cut
//                 short (the host's default limit is 20), which would hide side sessions and sharers: nothing is planned.
//   --done        the agent asserts: that session's work is landed, verified, and has nothing left to do. Repeatable.
//   --waiting     that session is waiting on the Owner. Repeatable. (A --done id that is also --waiting is KEPT.)
//   --owner-yes   the standing Owner yes is in force. ARCHIVE MODE also needs --me-cwd and --list-limit; without any of
//                 the three the plan is REPORT-ONLY (what would be archived is listed under `reportOnly`, `archive` is
//                 empty, and the notes say why).
//
// THE GUARDS — each one KEEPS the session, and the first that fires names the reason:
//   1 startedBy is not --me · 2 it is this session · 3 already archived (skipped) · 4 an Architect thread (title or name
//   matches /architect(?!ur)/i: architect_kit, Architect2, KitArchitect and architects, not architecture) · 5 not asserted --done · 6 --waiting · 7 it has a PR that is not MERGED or CLOSED (OPEN, DRAFT,
//   a PR number with no state, anything else) · 8 its cwd cannot be VERIFIED clean and pushed (no cwd, a relative or ~ cwd, a
//   cwd and parent both missing, a git dir or bare repo, uncommitted or untracked changes, commits on no remote, an index
//   flag that hides changes, a submodule with either, or git failing) · 9 THE CASCADE.
// A cwd that is absolute, does not exist, and has an existing parent passes 8 with a note (the worktree is already gone);
// an existing non-git cwd passes. GIT FACTS ARE TAKEN WITH `--untracked-files=all` and with GIT_DIR / GIT_CONFIG_* removed
// from the environment, so neither `status.showUntrackedFiles=no` nor an inherited variable can make a dirty tree read clean.
// GUARD 9. The host's archive call ALSO archives the session's side sessions (those that share its worktree or have
// finished) and cleans up its worktree. So a session is kept when any descendant in the list (anyone whose startedBy
// chain leads to it) is not already archived and fails 4–8, or when the linked worktree of the session, or of a side session
// taken along with it, is also the worktree of a session that STAYS (this session, or any kept one). Removing a session
// can strand its parent, so the plan repeats to a fixpoint. An archived entry lists `alsoTaken`, so the receipt can name them.
// RESIDUALS (kept, documented): ignored files are not checked; a branch squash-merged and then pruned reads as unpushed
// and stays kept (it fails safe); the host's cleanup of a primary
// checkout is not modelled (only LINKED worktrees are compared).
// An entry whose `remoteControlActive` is true (or the string "true"), or whose taken-along side session has it, carries `needsRemoteControlOff: true` and the note to turn Remote Control
// off first (the host refuses to archive a session with a Remote Control client attached).
//
// Exit 0 always for a plan; 2 for malformed input or arguments (an error message, nothing planned).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

class Usage extends Error {}
const fail = (msg) => { throw new Usage(msg); };

// ---------- git facts ----------
// Every variable that relocates git or injects config is removed: an inherited GIT_DIR would make `git -C <cwd>` read ANOTHER
// repo, and GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n can set status.showUntrackedFiles=no.
const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_GLOBAL|CONFIG_SYSTEM|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(k)) delete e[k];
  return e;
};
const git = (cwd, args) => spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", env: cleanEnv(), maxBuffer: 256 * 1024 * 1024 });
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const truthy = (v) => v === true || (typeof v === "string" && /^(true|1|yes|on)$/i.test(v.trim()));
const rp = (p) => { try { return realpathSync(p); } catch { return p; } };

const cannot = (why) => ({ pass: false, why: `cannot verify: ${why}` });
const gitFailed = (what, r) => ({ pass: false, why: `unpushed work cannot be verified (${what}${r?.error ? `: ${r.error.code ?? r.error.message}` : ""})` });

// Returns { pass:boolean, why, note }. Never throws.
export function unpushedCheck(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return cannot("no cwd is recorded for the session");
  if (cwd.startsWith("~") || !path.isAbsolute(cwd)) return cannot(`its cwd is not an absolute path (${cwd})`);
  if (!existsSync(cwd)) return existsSync(path.dirname(cwd)) ? { pass: true, note: "worktree already removed" } : cannot("its cwd and the cwd's parent directory are both missing");
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree", "--is-inside-git-dir", "--is-bare-repository"]);
  if (inside.error) return gitFailed("git", inside);
  if (inside.status !== 0 && /not a git repository/i.test(inside.stderr ?? "")) return { pass: true, note: "not a git work tree" };
  if (inside.status !== 0) return gitFailed(`git: ${(inside.stderr ?? "").trim().split("\n")[0] || "failed"}`);
  const [work, gitdir, bare] = inside.stdout.trim().split("\n");
  if (gitdir === "true" || bare === "true") return cannot("its cwd is a git directory or a bare repository, not a work tree");
  if (work !== "true") return cannot("git does not report its cwd as a work tree");
  const st = git(cwd, ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"]);
  if (st.status !== 0) return gitFailed("git status failed");
  if (st.stdout.trim() !== "") return { pass: false, why: "unpushed work: uncommitted or untracked changes in its worktree" };
  const lf = git(cwd, ["ls-files", "-v"]);
  if (lf.status !== 0) return gitFailed("git ls-files failed");
  if (lf.stdout.split("\n").some((l) => /^[a-zS] /.test(l))) return cannot("index flags (assume-unchanged or skip-worktree) hide changes");
  const rl = git(cwd, ["rev-list", "HEAD", "--not", "--remotes"]);
  if (rl.status !== 0) return gitFailed("git rev-list failed");
  const n = rl.stdout.split("\n").filter(Boolean).length;
  if (n > 0) return { pass: false, why: `unpushed work: ${n} commit(s) on no remote` };
  const sm = git(cwd, ["submodule", "foreach", "--quiet", "--recursive", "git status --porcelain --untracked-files=all --ignore-submodules=none; git rev-list HEAD --not --remotes"]);
  if (sm.status !== 0) return gitFailed("git submodule foreach failed");
  if (sm.stdout.trim() !== "") return { pass: false, why: "unpushed work: a submodule has uncommitted changes or commits on no remote" };
  return { pass: true };
}

// A LINKED worktree (git dir differs from the common dir) is one the host may clean up; a primary checkout is not.
// Returns the worktree's top-level realpath when it is a LINKED worktree (so two sessions in different subdirectories of one
// worktree still match), else null.
function linkedWorktreeRoot(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || !existsSync(cwd)) return null;
  const a = git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]), b = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), t = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (a.status !== 0 || b.status !== 0 || t.status !== 0 || a.stdout.trim() === b.stdout.trim()) return null;
  return rp(t.stdout.trim());
}

// ---------- the plan ----------
const prVerdict = (s) => {
  const num = s.prNumber, st = String(s.prState ?? "").trim().toUpperCase(), hasNum = num != null && String(num).trim() !== "";
  if (!hasNum && st === "") return null;                                   // no PR at all
  if (st === "OPEN") return `PR open${hasNum ? ` (#${num})` : ""}`;
  if (st === "MERGED" || st === "CLOSED") return null;
  return `PR not MERGED or CLOSED (${st || "state unknown"}${hasNum ? `, #${num}` : ""})`;
};

export function plan(list, { me, meCwd = null, listLimit = null, done = [], waiting = [], ownerYes = false } = {}) {
  const sessions = list.filter((s) => s && typeof s === "object");
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const doneSet = new Set(done), waitingSet = new Set(waiting);
  const notes = [];
  for (const id of done) if (!byId.has(id)) notes.push(`--done ${id}: not in the session list (ignored)`);
  for (const id of waiting) if (!byId.has(id)) notes.push(`--waiting ${id}: not in the session list (ignored)`);
  const label = (s) => s.name || s.title || s.sessionId;
  const entry = (s, why, extra = {}) => ({ sessionId: s.sessionId, name: s.name ?? null, title: s.title ?? null, why, ...extra });
  const isArchitect = (s) => /architect(?!ur)/i.test(`${s.title ?? ""}\n${s.name ?? ""}`);

  // Archive mode needs the three facts that make it safe; without them the same plan is a report.
  let act = ownerYes;
  if (ownerYes) {
    const missing = [];
    if (typeof meCwd !== "string" || !path.isAbsolute(meCwd) || !isDir(meCwd)) missing.push("--me-cwd <this session's absolute cwd, an existing directory>");
    if (!Number.isInteger(listLimit) || listLimit < 1) missing.push("--list-limit <the limit passed to list_sessions>");
    if (missing.length) { act = false; notes.push(`archive mode needs ${missing.join(" and ")}: REPORT-ONLY`); }
  } else notes.push("no --owner-yes: nothing is to be archived; this lists what would be");

  const truncated = Number.isInteger(listLimit) && listLimit > 0 && sessions.length >= listLimit;
  const TRUNC = "the list may be truncated; re-list with a larger limit";
  if (truncated) notes.push(`the list holds ${sessions.length} entries, the limit passed was ${listLimit}: ${TRUNC}`);

  const cacheC = new Map(), cacheK = new Map();
  const facts = (s) => { const k = typeof s.cwd === "string" ? rp(s.cwd) : `\0${s.sessionId}`; if (!cacheC.has(k)) cacheC.set(k, unpushedCheck(s.cwd)); return cacheC.get(k); };
  const wtKey = (cwd) => { if (typeof cwd !== "string") return null; const k = rp(cwd); if (!cacheK.has(k)) cacheK.set(k, linkedWorktreeRoot(cwd)); return cacheK.get(k); };

  // Guards 4–8: "is this session itself finished?" (the part that applies to a descendant too).
  const finishedWhy = (s) => {
    if (isArchitect(s)) return "an Architect thread (never archived)";
    if (!doneSet.has(s.sessionId)) return "not asserted landed and verified";
    if (waitingSet.has(s.sessionId)) return "waiting on the Owner";
    const pr = prVerdict(s); if (pr) return pr;
    const g = facts(s);
    return g.pass ? null : g.why;
  };

  // Guards 1–3 first, then 4–8.
  const kept = new Map();          // id -> why
  const cand = new Set();
  for (const s of sessions) {
    let why = null;
    if (!s.startedBy || s.startedBy !== me) why = "not started by you";
    else if (s.sessionId === me) why = "this session";
    else if (s.isArchived === true) why = "already archived (skipped)";
    else if (truncated) why = TRUNC;
    else why = finishedWhy(s);
    if (why) kept.set(s.sessionId, why); else cand.add(s.sessionId);
  }

  // Descendants: every session whose startedBy chain leads to `id` (cycle-safe).
  const children = new Map();
  for (const s of sessions) if (s.startedBy) { if (!children.has(s.startedBy)) children.set(s.startedBy, []); children.get(s.startedBy).push(s); }
  const descendantsOf = (id) => {
    const out = [], seen = new Set([id]); const stack = [id];
    while (stack.length) for (const c of children.get(stack.pop()) ?? []) if (!seen.has(c.sessionId)) { seen.add(c.sessionId); out.push(c); stack.push(c.sessionId); }
    return out;
  };
  const liveDesc = (id) => descendantsOf(id).filter((d) => d.isArchived !== true && d.sessionId !== me);
  const meKey = typeof meCwd === "string" ? wtKey(meCwd) : null;

  // Guard 9, to a fixpoint.
  const alsoTaken = new Map();
  for (let changed = true; changed;) {
    changed = false;
    const takenIds = new Set(); for (const id of cand) for (const d of liveDesc(id)) takenIds.add(d.sessionId);
    const staying = new Map();                                            // worktree key -> who stays there
    if (meKey) staying.set(meKey, "this session");
    for (const o of sessions) {
      if (o.isArchived === true || o.sessionId === me || cand.has(o.sessionId) || takenIds.has(o.sessionId)) continue;
      const k = wtKey(o.cwd); if (k && !staying.has(k)) staying.set(k, `${label(o)} (${o.sessionId})`);
    }
    for (const s of sessions) {
      if (!cand.has(s.sessionId)) continue;
      const desc = liveDesc(s.sessionId);
      let block = null;
      if (descendantsOf(s.sessionId).some((d) => d.sessionId === me)) block = "this session is one of its side sessions";
      for (const d of desc) {
        if (block) break;
        const w = finishedWhy(d);
        if (w) block = `a side session it would take with it is not finished: ${label(d)} (${d.sessionId}): ${w}`;
      }
      if (!block) for (const x of [s, ...desc]) {
        const k = wtKey(x.cwd), who = k ? staying.get(k) : null;
        if (who) { block = `${x === s ? "it" : `a side session it would take with it (${label(x)})`} shares a worktree with ${who}, which stays`; break; }
      }
      if (block) { cand.delete(s.sessionId); kept.set(s.sessionId, block); changed = true; }
      else alsoTaken.set(s.sessionId, desc);
    }
  }

  const archive = [], keep = [];
  for (const s of sessions) {
    if (cand.has(s.sessionId)) {
      const g = facts(s);
      const taken = (alsoTaken.get(s.sessionId) ?? []).map((d) => ({ sessionId: d.sessionId, name: d.name ?? null, ...(truthy(d.remoteControlActive) ? { needsRemoteControlOff: true } : {}) }));
      const e = entry(s, `started by you; asserted landed and verified; ${g.note ? g.note : "its worktree is clean and pushed"}`, { alsoTaken: taken });
      if (truthy(s.remoteControlActive) || taken.some((t) => t.needsRemoteControlOff)) { e.needsRemoteControlOff = true; e.note = "turn Remote Control off first"; }
      archive.push(e);
    } else keep.push(entry(s, kept.get(s.sessionId)));
  }
  return act
    ? { mode: "archive", me, archive, reportOnly: [], keep, notes }
    : { mode: "report-only", me, archive: [], reportOnly: archive, keep, notes };
}

function render(p) {
  const L = [`archive-plan: mode ${p.mode.toUpperCase()}${p.mode === "report-only" ? " (nothing to be archived from this plan)" : ""}`];
  const rows = (title, xs) => {
    L.push(`${title} (${xs.length})`);
    for (const x of xs) {
      L.push(`  ${x.name ?? x.title ?? x.sessionId}  [${x.sessionId}]  ${x.why}${x.needsRemoteControlOff ? `  (${x.note})` : ""}`);
      for (const a of x.alsoTaken ?? []) L.push(`      also taken by the host: ${a.name ?? "?"} [${a.sessionId}]${a.needsRemoteControlOff ? "  (turn Remote Control off first)" : ""}`);
    }
  };
  rows(p.mode === "archive" ? "ARCHIVE" : "WOULD ARCHIVE", p.mode === "archive" ? p.archive : p.reportOnly);
  rows("KEEP", p.keep);
  for (const n of p.notes) L.push(`note: ${n}`);
  return L.join("\n");
}

// ---------- CLI ----------
// Output goes through the write callback: process.exit() right after a large console.log truncates a pipe at 64 KiB.
const finish = (text, err, code) => { if (err) process.stderr.write(`${err}\n`); process.stdout.write(text ? `${text}\n` : "", () => process.exit(code)); };

function main(argv) {
  const o = { me: null, meCwd: null, listLimit: null, sessions: null, done: [], waiting: [], ownerYes: false, json: false };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i], next = () => (i + 1 < argv.length ? argv[++i] : fail(`${a} needs a value`));
      if (a === "--me") o.me = next();
      else if (a === "--me-cwd") o.meCwd = next();
      else if (a === "--list-limit") { const v = next(); if (!/^[1-9]\d*$/.test(v)) fail("--list-limit takes a positive integer"); o.listLimit = Number(v); }
      else if (a === "--sessions") o.sessions = next();
      else if (a === "--done") o.done.push(next());
      else if (a === "--waiting") o.waiting.push(next());
      else if (a === "--owner-yes") o.ownerYes = true;
      else if (a === "--json") o.json = true;
      else fail(`unknown argument ${a}`);
    }
    if (!o.me) fail("--me <this session's id> is required");
    let raw;
    try { raw = o.sessions ? readFileSync(o.sessions, "utf8") : readFileSync(0, "utf8"); } catch (e) { fail(`cannot read the session list: ${e.code ?? e.message}`); }
    let data;
    try { data = JSON.parse(raw); } catch (e) { fail(`the session list is not valid JSON (${e.message})`); }
    const list = Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : null;
    if (!list) fail("the session list must be a JSON array (or an object with a `sessions` array)");
    const seen = new Set();
    list.forEach((s) => { if (s && typeof s.sessionId === "string") { if (seen.has(s.sessionId)) fail(`session ${s.sessionId} appears twice in the list`); seen.add(s.sessionId); } });
    list.forEach((s, i) => { if (!s || typeof s !== "object" || typeof s.sessionId !== "string" || !s.sessionId) fail(`session list entry ${i} has no sessionId`); });
    const p = plan(list, { me: o.me, meCwd: o.meCwd, listLimit: o.listLimit, done: o.done, waiting: o.waiting, ownerYes: o.ownerYes });
    finish(o.json ? JSON.stringify(p, null, 2) : render(p), null, 0);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    finish(o.json || argv.includes("--json") ? JSON.stringify({ error: e.message, mode: "error", archive: [], reportOnly: [], keep: [] }, null, 2) : "", `archive-plan: ${e.message}`, 2);
  }
}

const isMain = process.argv[1] && rp(process.argv[1]) === rp(fileURLToPath(import.meta.url));
if (isMain) main(process.argv.slice(2));
